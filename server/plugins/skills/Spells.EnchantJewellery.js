/**
 * Lvl-1 to Lvl-7 Enchant on jewellery (docs/jewellery.md). One cast enchants the first
 * piece of that jewellery in the inventory, in its own slot, then repeats every 7 ticks while
 * more of it is carried (Wiki); a cast clicked during the 3-tick delay waits for it.
 */
const { pauseForLevelUp, actionInterval } = require("./SkillActions");

let core;
let pluginApi;
const spells = new Map();

/** Wiki Enchant_jewellery: "if uninterrupted it will automatically cast it again every 7 ticks". */
const REPEAT_TICKS = 7;
/** A cast's own cooldown, 3 ticks. */
const CAST_TICKS = 3;
const TICK_MS = 600;
const COOLDOWN_ATTRIBUTE = "enchant-jewellery:next-cast-at";
const SHARED_CAST_ATTRIBUTE = "magic:next-cast-at";
/** Rings, necklaces, bracelets and silver amulets: human_cast_enchantring, enchant_ring (rsprox). */
const JEWELLERY_ANIMATION = 931;
const JEWELLERY_GRAPHIC = 238;
/** Every enchant graphic sits at height 92 (rsprox: enchant_ring, enchant_amulet_lvl3, enchant_amulet2_lvl4 and _lvl6). */
const GRAPHIC_HEIGHT = 92;
/** toplevel_sidebutton_switch: the cast brings the spellbook back (rsprox: [6] on every enchant click). */
const SIDE_BUTTON_SWITCH_SCRIPT = 915;
const MAGIC_TAB = 6;

/** Each player's repeating enchant, retained while the level-up dialogue is open. */
const repeats = new WeakMap();

/** The product of `itemId` under this spell, with the quest hooks' say ("magic:enchant-item-recipe"). */
function resolveRecipe(player, spell, itemId) {
  const recipe = { player, spellName: spell.data.name, itemId, resultId: spell.results.get(itemId) };
  pluginApi.emitCustomEvent("magic:enchant-item-recipe", recipe);
  return recipe;
}

/** One cast on the first `itemId` in the inventory; false when nothing was enchanted. */
function enchant(player, spell, itemId) {
  const recipe = resolveRecipe(player, spell, itemId);
  if (recipe.declined) {
    if (recipe.message) player.sendMessage(recipe.message);
    return false;
  }
  if (recipe.resultId === undefined) return false;
  const inventory = player.getInventory();
  const slot = inventory.getItems().findIndex((item) => item?.getId() === itemId);
  if (slot < 0 || !spell.canCast(player, true)) return false;
  const look = spell.looks.get(itemId) ?? spell.data;
  player.performAnimation(new core.Animation(look.animation));
  player.performGraphic(new core.Graphic(look.graphic, 0, GRAPHIC_HEIGHT));
  player.getPacketSender().sendSound(look.sound);
  // Content may enchant more than one piece a cast ("magic:enchant-pieces", a league fragment), each with its XP.
  const pieces = { player, spellName: spell.data.name, itemId, pieces: 1 };
  pluginApi.emitCustomEvent("magic:enchant-pieces", pieces);
  const count = Math.max(1, Math.min(inventory.getAmount(itemId), pieces.pieces | 0));
  for (let piece = 0; piece < count; piece++) {
    const at = piece === 0 ? slot : inventory.getItems().findIndex((item) => item?.getId() === itemId);
    if (at < 0) break;
    inventory.setItem(at, new core.Item(recipe.resultId, 1));
    player.getSkillManager().addExperiences(core.Skill.MAGIC, spell.baseExperience());
  }
  inventory.refreshItems();
  pluginApi.emitCustomEvent("magic:enchanted", { player, spellName: spell.data.name, itemId, productId: recipe.resultId });
  pluginApi.emitCustomEvent("magic:enchant-item-cast", recipe);
  if (recipe.message) player.sendMessage(recipe.message);
  return true;
}

/** Ticks until the spell's cast delay lets the next enchant go off. */
function ticksUntilCast(player) {
  const now = core.World.getProcessCycle();
  const next = Math.max(Number(player.getAttribute(COOLDOWN_ATTRIBUTE) ?? 0), Number(player.getAttribute(SHARED_CAST_ATTRIBUTE) ?? 0));
  return Math.max(0, next - now);
}

/**
 * Casts again after `wait` ticks, then every REPEAT_TICKS, while the jewellery lasts. Keyed to the
 * player so a walk stops it; a level-up pop-up pauses it, as it does other skilling.
 */
function keepEnchanting(player, spell, itemId, wait) {
  let remaining = wait;
  const task = new (class extends core.Task {
    constructor() { super(1, player.getIndex(), false); }
    execute() {
      if (!player.isRegistered() || player.getHitpoints() <= 0) return this.stop();
      if (this.levelUpPaused || --remaining > 0) return;
      remaining = repeatTicks(player);
      if (!enchant(player, spell, itemId)) this.stop();
    }
  })();
  repeats.set(player, task);
  core.TaskManager.submit(task);
}

/** Ticks between repeated casts, and a cast's cooldown; content may cast faster ("skills:action-interval", a league relic's 2-tick pace). */
function repeatTicks(player) {
  return actionInterval(pluginApi, player, core.Skill.MAGIC, "enchant", REPEAT_TICKS);
}

function castTicks(player) {
  return actionInterval(pluginApi, player, core.Skill.MAGIC, "enchant", CAST_TICKS);
}

function stopEnchanting(player) {
  repeats.get(player)?.stop();
  repeats.delete(player);
}

function pauseEnchanting(event) {
  pauseForLevelUp(event, repeats, stopEnchanting);
}

function handleSpellOnItem(event) {
  const spell = spells.get(event.spellName?.trim().toLowerCase());
  if (!spell) return;
  event.handled = true;
  const { player, itemId, slot } = event;
  const recipe = resolveRecipe(player, spell, itemId);
  if (recipe.declined) {
    if (recipe.message) player.sendMessage(recipe.message);
    return;
  }
  if (recipe.resultId === undefined) {
    // "magic:enchant-item": something else this spell works on (the Mage Training Arena's
    // shapes), cast with this spell's own runes, level and XP.
    const other = { player, spell, spellName: spell.data.name, itemId, slot, handled: false };
    pluginApi.emitCustomEvent("magic:enchant-item", other);
    if (!other.handled) player.sendMessage("This spell cannot be cast on that item.");
    return;
  }
  if (player.getInventory().getItems()[slot]?.getId() !== itemId) return;
  stopEnchanting(player);
  // Wiki: enchant spells "queue up one spell if you cast them too quickly".
  const wait = ticksUntilCast(player);
  if (wait > 0) {
    if (!spell.canCast(player, false)) return;
    keepEnchanting(player, spell, itemId, wait);
    returnToSpellbook(player);
    return;
  }
  // Register the loop before the cast so its first XP drop can pause it too.
  keepEnchanting(player, spell, itemId, repeatTicks(player));
  if (!enchant(player, spell, itemId)) {
    stopEnchanting(player);
    return;
  }
  returnToSpellbook(player);
}

/** Once per accepted click, cast now or queued; the automatic repeats don't send it (rsprox 4119). */
function returnToSpellbook(player) {
  player.getPacketSender().sendClientScript(SIDE_BUTTON_SWITCH_SCRIPT, MAGIC_TAB);
}

module.exports = function attach(api) {
  pluginApi = api;
  core = api.core;
  const { ItemIds } = core;
  // Wiki Lvl-1–7 Enchant and Enchant_jewellery. Gold amulets play the spell's own sequence,
  // graphic and sound (Wiki GIFs/sound files, rsprox); every other piece plays the ring cast
  // with `jewellerySound` where a capture has it. Sequences and graphics verified in cache 241.
  // Silver amulets play the spell's sequence with the ring graphic (rsprox, jade amulet); the
  // captured silver bracelet does too, with the jewellery sound (rsprox, jade bracelet: 720, 238, 142).
  const ENCHANT_SPELLS = [
    {
      name: "Lvl-1 Enchant", animation: 719, graphic: 114, sound: 136, jewellerySound: 147, level: 7, xp: 17.5,
      runes: [[ItemIds.COSMIC_RUNE, 1], [ItemIds.WATER_RUNE, 1]],
      amulets: [[ItemIds.SAPPHIRE_AMULET, ItemIds.AMULET_OF_MAGIC]],
      silverAmulets: [[ItemIds.OPAL_AMULET, ItemIds.AMULET_OF_BOUNTY]],
      jewellery: [
        [ItemIds.SAPPHIRE_RING, ItemIds.RING_OF_RECOIL],
        [ItemIds.SAPPHIRE_NECKLACE, ItemIds.GAMES_NECKLACE_8_],
        // jewl_sapphire_bracelet (11072, rsprox); SAPPHIRE_BRACELET (11071) is another item of that name.
        [ItemIds.SAPPHIRE_BRACELET_2, ItemIds.BRACELET_OF_CLAY],
        [ItemIds.OPAL_RING, ItemIds.RING_OF_PURSUIT],
        [ItemIds.OPAL_NECKLACE, ItemIds.DODGY_NECKLACE],
        [ItemIds.OPAL_BRACELET, ItemIds.EXPEDITIOUS_BRACELET],
      ],
    },
    {
      name: "Lvl-2 Enchant", animation: 720, graphic: 115, sound: 141, jewellerySound: 142, level: 27, xp: 37,
      runes: [[ItemIds.COSMIC_RUNE, 1], [ItemIds.AIR_RUNE, 3]],
      amulets: [[ItemIds.EMERALD_AMULET, ItemIds.AMULET_OF_DEFENCE]],
      silverAmulets: [[ItemIds.JADE_AMULET, ItemIds.AMULET_OF_CHEMISTRY]],
      silverJewellery: [[ItemIds.JADE_BRACELET, ItemIds.FLAMTAER_BRACELET]],
      jewellery: [
        [ItemIds.EMERALD_RING, ItemIds.RING_OF_DUELING_8_],
        [ItemIds.EMERALD_NECKLACE, ItemIds.BINDING_NECKLACE],
        [ItemIds.EMERALD_BRACELET, ItemIds.CASTLE_WARS_BRACELET_3_],
        [ItemIds.JADE_RING, ItemIds.RING_OF_RETURNING_5_],
        [ItemIds.JADE_NECKLACE, ItemIds.NECKLACE_OF_PASSAGE_5_],
      ],
    },
    {
      name: "Lvl-3 Enchant", animation: 721, graphic: 116, sound: 145, level: 49, xp: 59,
      runes: [[ItemIds.COSMIC_RUNE, 1], [ItemIds.FIRE_RUNE, 5]],
      // The ruby necklace plays the amulet cast (rsprox: human_enchantamuletlvl3, enchant_amulet_lvl3).
      amulets: [[ItemIds.RUBY_AMULET, ItemIds.AMULET_OF_STRENGTH], [ItemIds.RUBY_NECKLACE, ItemIds.DIGSITE_PENDANT_5_]],
      silverAmulets: [[ItemIds.TOPAZ_AMULET, ItemIds.BURNING_AMULET_5_]],
      jewellery: [
        [ItemIds.RUBY_RING, ItemIds.RING_OF_FORGING],
        [ItemIds.RUBY_BRACELET, ItemIds.INOCULATION_BRACELET],
        [ItemIds.TOPAZ_RING, ItemIds.EFARITAYS_AID],
        [ItemIds.TOPAZ_NECKLACE, ItemIds.NECKLACE_OF_FAITH],
        [ItemIds.TOPAZ_BRACELET, ItemIds.BRACELET_OF_SLAUGHTER],
      ],
    },
    {
      name: "Lvl-4 Enchant", animation: 719, graphic: 153, sound: 137, level: 57, xp: 67,
      runes: [[ItemIds.COSMIC_RUNE, 1], [ItemIds.EARTH_RUNE, 10]],
      amulets: [[ItemIds.DIAMOND_AMULET, ItemIds.AMULET_OF_POWER]],
      jewellery: [
        [ItemIds.DIAMOND_RING, ItemIds.RING_OF_LIFE],
        [ItemIds.DIAMOND_NECKLACE, ItemIds.PHOENIX_NECKLACE],
        [ItemIds.DIAMOND_BRACELET, ItemIds.ABYSSAL_BRACELET_5_],
      ],
    },
    {
      name: "Lvl-5 Enchant", animation: 720, graphic: 154, sound: 139, jewellerySound: 140, level: 68, xp: 78,
      runes: [[ItemIds.COSMIC_RUNE, 1], [ItemIds.WATER_RUNE, 15], [ItemIds.EARTH_RUNE, 15]],
      amulets: [[ItemIds.DRAGONSTONE_AMULET, ItemIds.AMULET_OF_GLORY]],
      jewellery: [
        [ItemIds.DRAGONSTONE_RING, ItemIds.RING_OF_WEALTH],
        [ItemIds.DRAGON_NECKLACE, ItemIds.SKILLS_NECKLACE],
        [ItemIds.DRAGONSTONE_BRACELET, ItemIds.COMBAT_BRACELET],
      ],
    },
    {
      name: "Lvl-6 Enchant", animation: 721, graphic: 452, sound: 143, jewellerySound: 144, level: 87, xp: 97,
      runes: [[ItemIds.COSMIC_RUNE, 1], [ItemIds.FIRE_RUNE, 20], [ItemIds.EARTH_RUNE, 20]],
      amulets: [[ItemIds.ONYX_AMULET, ItemIds.AMULET_OF_FURY]],
      jewellery: [
        [ItemIds.ONYX_RING, ItemIds.RING_OF_STONE],
        [ItemIds.ONYX_NECKLACE, ItemIds.BERSERKER_NECKLACE],
        [ItemIds.ONYX_BRACELET, ItemIds.REGEN_BRACELET],
      ],
    },
    {
      name: "Lvl-7 Enchant", animation: 721, graphic: 452, sound: 143, jewellerySound: 144, level: 93, xp: 110,
      runes: [[ItemIds.COSMIC_RUNE, 1], [ItemIds.BLOOD_RUNE, 20], [ItemIds.SOUL_RUNE, 20]],
      amulets: [[ItemIds.ZENYTE_AMULET, ItemIds.AMULET_OF_TORTURE]],
      jewellery: [
        [ItemIds.ZENYTE_RING, ItemIds.RING_OF_SUFFERING],
        [ItemIds.ZENYTE_NECKLACE, ItemIds.NECKLACE_OF_ANGUISH],
        // zenyte_bracelet (19532, rsprox); ZENYTE_BRACELET (19492) is another item of that name.
        [ItemIds.ZENYTE_BRACELET_2, ItemIds.TORMENTED_BRACELET],
      ],
    },
  ];

  class JewellerySpell extends core.Spell {
    constructor(data) {
      super();
      this.data = data;
      const silverAmulets = data.silverAmulets ?? [];
      const silverJewellery = data.silverJewellery ?? [];
      this.results = new Map([...data.amulets, ...silverAmulets, ...silverJewellery, ...data.jewellery]);
      const ring = { animation: JEWELLERY_ANIMATION, graphic: JEWELLERY_GRAPHIC, sound: data.jewellerySound ?? data.sound };
      const silver = { animation: data.animation, graphic: JEWELLERY_GRAPHIC, sound: data.sound };
      this.looks = new Map([
        ...data.jewellery.map(([id]) => [id, ring]),
        ...silverAmulets.map(([id]) => [id, silver]),
        ...silverJewellery.map(([id]) => [id, { ...ring, animation: data.animation }]),
      ]);
      this.members = data.level >= 68;
      const widget = core.CacheDefinitions.getSpellByName(data.name);
      if (!widget) throw new Error(`Missing cache spell: ${data.name}`);
      this.id = widget.widgetId;
    }
    spellId() { return this.id; }
    levelRequired() { return this.data.level; }
    baseExperience() { return this.data.xp; }
    itemsRequired() { return this.data.runes.map(([id, amount]) => new core.Item(id, amount)); }
    equipmentRequired() { return []; }
    startCast() {}
    usesSharedCastDelay() { return true; }
    getCastCooldown(player) { return { attribute: COOLDOWN_ATTRIBUTE, duration: castTicks(player) * TICK_MS }; }
  }
  for (const data of ENCHANT_SPELLS) spells.set(data.name.toLowerCase(), new JewellerySpell(data));
  api.onSpellOnItem(handleSpellOnItem);
  api.onCustomEvent("level-up:popup-opened", pauseEnchanting);
};
