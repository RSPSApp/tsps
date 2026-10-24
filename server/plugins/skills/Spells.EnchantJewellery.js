let core;
let pluginApi;
const spells = new Map();

function handleSpellOnItem(event) {
  const spell = spells.get(event.spellName?.trim().toLowerCase());
  if (!spell) return;
  event.handled = true;
  const { player, itemId, slot } = event;
  const resultId = spell.results.get(itemId);
  if (resultId === undefined) {
    // "magic:enchant-item": something else this spell works on (the Mage Training Arena's
    // shapes), cast with this spell's own runes, level and XP.
    const other = { player, spell, spellName: spell.data.name, itemId, slot, handled: false };
    pluginApi.emitCustomEvent("magic:enchant-item", other);
    if (!other.handled) player.sendMessage("This spell cannot be cast on that item.");
    return;
  }
  const inventory = player.getInventory();
  if (inventory.getItems()[slot]?.getId() !== itemId || !spell.canCast(player, true)) return;
  player.performAnimation(new core.Animation(spell.data.animation));
  player.performGraphic(new core.Graphic(spell.data.graphic, 0, core.GraphicHeight.HIGH));
  player.getPacketSender().sendSound(spell.data.sound);
  inventory.deleteNumber(itemId, 1);
  inventory.addItem(new core.Item(resultId, 1));
  player.getSkillManager().addExperiences(core.Skill.MAGIC, spell.baseExperience());
}

module.exports = function attach(api) {
  pluginApi = api;
  core = api.core;
  const { ItemIds } = core;
  // Wiki Lvl-1–7 Enchant GIFs/sound files; sequences and graphics verified in cache 241.
  // shortcut: manual gold-gem rings, necklaces and amulets only; add other recipes/autocasting when requested.
  const ENCHANT_SPELLS = [
    {
      name: "Lvl-1 Enchant", animation: 719, graphic: 114, sound: 136, level: 7, xp: 17.5,
      runes: [[ItemIds.COSMIC_RUNE, 1], [ItemIds.WATER_RUNE, 1]],
      items: [
        [ItemIds.SAPPHIRE_RING, ItemIds.RING_OF_RECOIL],
        [ItemIds.SAPPHIRE_NECKLACE, ItemIds.GAMES_NECKLACE_8_],
        [ItemIds.SAPPHIRE_AMULET, ItemIds.AMULET_OF_MAGIC],
      ],
    },
    {
      name: "Lvl-2 Enchant", animation: 720, graphic: 115, sound: 141, level: 27, xp: 37,
      runes: [[ItemIds.COSMIC_RUNE, 1], [ItemIds.AIR_RUNE, 3]],
      items: [
        [ItemIds.EMERALD_RING, ItemIds.RING_OF_DUELING_8_],
        [ItemIds.EMERALD_NECKLACE, ItemIds.BINDING_NECKLACE],
        [ItemIds.EMERALD_AMULET, ItemIds.AMULET_OF_DEFENCE],
      ],
    },
    {
      name: "Lvl-3 Enchant", animation: 721, graphic: 116, sound: 145, level: 49, xp: 59,
      runes: [[ItemIds.COSMIC_RUNE, 1], [ItemIds.FIRE_RUNE, 5]],
      items: [
        [ItemIds.RUBY_RING, ItemIds.RING_OF_FORGING],
        [ItemIds.RUBY_NECKLACE, ItemIds.DIGSITE_PENDANT_5_],
        [ItemIds.RUBY_AMULET, ItemIds.AMULET_OF_STRENGTH],
      ],
    },
    {
      name: "Lvl-4 Enchant", animation: 719, graphic: 153, sound: 137, level: 57, xp: 67,
      runes: [[ItemIds.COSMIC_RUNE, 1], [ItemIds.EARTH_RUNE, 10]],
      items: [
        [ItemIds.DIAMOND_RING, ItemIds.RING_OF_LIFE],
        [ItemIds.DIAMOND_NECKLACE, ItemIds.PHOENIX_NECKLACE],
        [ItemIds.DIAMOND_AMULET, ItemIds.AMULET_OF_POWER],
      ],
    },
    {
      name: "Lvl-5 Enchant", animation: 720, graphic: 154, sound: 139, level: 68, xp: 78,
      runes: [[ItemIds.COSMIC_RUNE, 1], [ItemIds.WATER_RUNE, 15], [ItemIds.EARTH_RUNE, 15]],
      items: [
        [ItemIds.DRAGONSTONE_RING, ItemIds.RING_OF_WEALTH],
        [ItemIds.DRAGON_NECKLACE, ItemIds.SKILLS_NECKLACE],
        [ItemIds.DRAGONSTONE_AMULET, ItemIds.AMULET_OF_GLORY],
      ],
    },
    {
      name: "Lvl-6 Enchant", animation: 721, graphic: 452, sound: 143, level: 87, xp: 97,
      runes: [[ItemIds.COSMIC_RUNE, 1], [ItemIds.FIRE_RUNE, 20], [ItemIds.EARTH_RUNE, 20]],
      items: [
        [ItemIds.ONYX_RING, ItemIds.RING_OF_STONE],
        [ItemIds.ONYX_NECKLACE, ItemIds.BERSERKER_NECKLACE],
        [ItemIds.ONYX_AMULET, ItemIds.AMULET_OF_FURY],
      ],
    },
    {
      name: "Lvl-7 Enchant", animation: 721, graphic: 452, sound: 143, level: 93, xp: 110,
      runes: [[ItemIds.COSMIC_RUNE, 1], [ItemIds.BLOOD_RUNE, 20], [ItemIds.SOUL_RUNE, 20]],
      items: [
        [ItemIds.ZENYTE_RING, ItemIds.RING_OF_SUFFERING],
        [ItemIds.ZENYTE_NECKLACE, ItemIds.NECKLACE_OF_ANGUISH],
        [ItemIds.ZENYTE_AMULET, ItemIds.AMULET_OF_TORTURE],
      ],
    },
  ];

  class JewellerySpell extends core.Spell {
    constructor(data) {
      super();
      this.data = data;
      this.results = new Map(data.items);
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
    getCastCooldown() { return { attribute: "enchant-jewellery:next-cast-at", duration: 1800 }; }
  }
  for (const data of ENCHANT_SPELLS) spells.set(data.name.toLowerCase(), new JewellerySpell(data));
  api.onSpellOnItem(handleSpellOnItem);
};
