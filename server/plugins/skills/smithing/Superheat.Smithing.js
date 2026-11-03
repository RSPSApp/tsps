/**
 * Superheat Item (https://oldschool.runescape.wiki/w/Superheat_Item): 43 Magic, 4 fire and 1
 * nature rune, 53 Magic XP, and the furnace's bar with its Smithing level, coal and XP
 * (Smithing.plugin.js's recipes). Iron ore with two coal (and 30 Smithing) always makes steel,
 * otherwise iron, never failing. A carried coal bag's coal is used after the inventory's
 * (docs/storage-items.md). A carried smithing catalyst works as at a furnace (Wiki: Smithing
 * catalyst): half the coal and double the Smithing XP, not the Magic XP.
 *
 * Captured (rsprox, rev 227, recordings 100, 1749, 1834, 1835): the cast plays sequence 725
 * (human_castsuperheatitem) with spotanim 148 (superheatitem_casting) at height 92, swaps the
 * ores for the bar, switches back to the spellbook tab (script 915, 6), plays sound 190 and
 * gives Magic and Smithing XP on the same tick. Cast on coal (rev 237): "You need to cast
 * superheat item on ore.", spotanim 85 (failedspell_impact) at height 92, the same tab switch and
 * sound 191; no XP.
 */
const SPELL_NAME = "Superheat Item";
const LEVEL = 43;
const MAGIC_XP = 53;
/** Wiki: one cast every 3 ticks. */
const CAST_TICKS = 3;
const TICK_MS = 600;
const CAST_ANIMATION = 725;
const CAST_GRAPHIC = 148;
const FAIL_GRAPHIC = 85;
const CAST_SOUND = 190;
const FAIL_SOUND = 191;
/** toplevel_sidebutton_switch: back to the spellbook tab. */
const SIDEBUTTON_SWITCH_SCRIPT = 915;
const SPELLBOOK_TAB = 6;

const MESSAGE = {
  NOT_ORE: "You need to cast superheat item on ore.",
  /** Wiki. */
  NOT_HOT_ENOUGH: "Even this spell is not hot enough to heat this item.",
};

const { actionInterval } = require("../SkillActions");

let core = null;
let api = null;
let spell = null;

/** The furnace recipe a cast on `oreId` smelts, or null when the item isn't an ore it heats. */
function recipeFor(player, oreId) {
  const { ItemIds } = core;
  const Smithing = require("../Smithing.plugin");
  const byBar = (barId) => Smithing.SMELTING_RECIPES.find((recipe) => recipe.barId === barId);
  if (oreId === ItemIds.IRON_ORE) {
    const steel = Smithing.resolveCatalyst(player, byBar(ItemIds.STEEL_BAR));
    const level = require("./Common.Smithing").smithingLevel(player);
    return level >= steel.level && Smithing.hasIngredients(player, steel) ? steel : { ...byBar(ItemIds.IRON_BAR), successChance: 1 };
  }
  // Coal is in several recipes but is never the ore; molten glass is Crafting, not a bar.
  if (oreId === ItemIds.COAL) return null;
  const recipe = Smithing.SMELTING_RECIPES.find((candidate) => !candidate.skill && candidate.ingredients.some(([id]) => id === oreId));
  return recipe ? Smithing.resolveCatalyst(player, recipe) : null;
}

function fail(player, message) {
  player.sendMessage(message);
  player.performGraphic(new core.Graphic(FAIL_GRAPHIC, 0, core.GraphicHeight.HIGH));
  player.getPacketSender().sendClientScript(SIDEBUTTON_SWITCH_SCRIPT, SPELLBOOK_TAB);
  player.getPacketSender().sendSound(FAIL_SOUND);
}

function castOnItem(event) {
  if (event.spellName?.trim().toLowerCase() !== SPELL_NAME.toLowerCase()) return;
  event.handled = true;
  spell ??= createSpell();
  const { player, itemId, slot } = event;
  const inventory = player.getInventory();
  if (inventory.getItems()[slot]?.getId() !== itemId || !spell.canCast(player, false)) return;
  if (itemId === core.ItemIds.ELEMENTAL_ORE) return fail(player, MESSAGE.NOT_HOT_ENOUGH);
  const recipe = recipeFor(player, itemId);
  if (!recipe) return fail(player, MESSAGE.NOT_ORE);

  const Smithing = require("../Smithing.plugin");
  if (require("./Common.Smithing").smithingLevel(player) < recipe.level) {
    player.sendMessage(`You need a Smithing level of at least ${recipe.level} to smelt this bar.`);
    return;
  }
  if (!Smithing.hasIngredients(player, recipe)) {
    player.sendMessage(recipe.missingMessage ?? "You don't have the required ores to smelt this bar.");
    return;
  }
  if (!spell.canCast(player, true)) return;

  Smithing.consumeIngredients(player, recipe);
  inventory.addItem(new core.Item(recipe.barId, 1));
  player.performAnimation(new core.Animation(CAST_ANIMATION));
  player.performGraphic(new core.Graphic(CAST_GRAPHIC, 0, core.GraphicHeight.HIGH));
  player.getPacketSender().sendClientScript(SIDEBUTTON_SWITCH_SCRIPT, SPELLBOOK_TAB);
  player.getPacketSender().sendSound(CAST_SOUND);
  player.getSkillManager().addExperiences(core.Skill.MAGIC, MAGIC_XP);
  player.getSkillManager().addExperiences(core.Skill.SMITHING, Smithing.smeltingXp(player, recipe));
}

/** Ticks to the next cast; content may cast faster ("skills:action-interval", a league relic's 2-tick pace). */
function castTicks(player) {
  return actionInterval(api, player, core.Skill.MAGIC, "superheat", CAST_TICKS);
}

function createSpell() {
  const { ItemIds } = core;
  class SuperheatItem extends core.Spell {
    constructor() {
      super();
      const widget = core.CacheDefinitions.getSpellByName(SPELL_NAME);
      if (!widget) throw new Error(`Missing cache spell: ${SPELL_NAME}`);
      this.id = widget.widgetId;
    }
    spellId() { return this.id; }
    levelRequired() { return LEVEL; }
    baseExperience() { return MAGIC_XP; }
    itemsRequired() { return [new core.Item(ItemIds.FIRE_RUNE, 4), new core.Item(ItemIds.NATURE_RUNE, 1)]; }
    equipmentRequired() { return []; }
    startCast() {}
    usesSharedCastDelay() { return true; }
    getCastCooldown(player) { return { attribute: "superheat:next-cast-at", duration: castTicks(player) * TICK_MS }; }
  }
  return new SuperheatItem();
}

module.exports = function attach(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
  api.onSpellOnItem(castOnItem);
};

Object.assign(module.exports, { MESSAGE, recipeFor, castOnItem });
