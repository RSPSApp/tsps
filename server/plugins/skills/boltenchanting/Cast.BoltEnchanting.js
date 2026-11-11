/**
 * Crossbow Bolt Enchantments (https://oldschool.runescape.wiki/w/Enchant_Crossbow_Bolt; data in
 * data/bolt-enchanting.json, facts in docs/bolt-enchanting.md): the spellbook entry that turns
 * gem-tipped bolts into enchanted bolts, ten per cast.
 *
 * Clicking it opens the "How many sets of bolts to enchant?" skillmulti menu for the bolts
 * carried, or says "You have no bolts to enchant." The first set is cast on choosing, the second
 * 2 ticks later and the rest every 3 ticks until the sets or the bolts are gone; each cast pays
 * its own runes and XP, plays 4462 with 759 and sound 2921, and says "The magic of the runes
 * coaxes out the true nature of the gem tips." (rsprox recordings 89, 239, 1749, 1102).
 */
const DATA = require("../data/bolt-enchanting.json");

const NO_BOLTS_MESSAGE = "You have no bolts to enchant.";
const SUCCESS_MESSAGE = "The magic of the runes coaxes out the true nature of the gem tips.";
const MENU_TITLE = "How many sets of bolts to enchant?";
/** clientscript 2046's first argument for this menu, and the most sets it offers (rsprox). */
const MENU_MODE = 3;
const MAX_SETS = 10;
const CAST_ANIMATION = 4462;
const CAST_GRAPHIC = 759;
const CAST_SOUND = 2921;
/** The second cast follows 2 ticks after the first, then one every 3 (rsprox 89: 1604, 1606, 1609, 1612). */
const SECOND_CAST_TICKS = 2;
const CAST_TICKS = 3;

let core = null;
let recipes = null;
let outputRecipes = null;
let spellWidget = 0;
/** Each player's running enchant. */
const running = new WeakMap();

function itemId(name) {
  const id = core.ItemIds[name];
  if (!Number.isInteger(id)) throw new Error(`bolt-enchanting.json: unknown item ${name}`);
  return id;
}

/** One recipe per gem and bolt kind: input, output, level, runes and XP. */
function loadRecipes() {
  class BoltSpell extends core.Spell {
    constructor(gem) {
      super();
      this.gem = gem;
      this.members = true;
      this.runeItems = gem.runes.map(([name, amount]) => new core.Item(itemId(name), amount));
    }
    spellId() { return spellWidget; }
    levelRequired() { return this.gem.level; }
    baseExperience() { return this.gem.xp; }
    itemsRequired() { return this.runeItems; }
    equipmentRequired() { return []; }
    startCast() {}
  }
  const list = [];
  for (const gem of DATA.gems) {
    const spell = new BoltSpell(gem);
    for (const [from, to] of gem.bolts) list.push({ spell, level: gem.level, inputId: itemId(from), outputId: itemId(to) });
  }
  return list;
}

function ensureRecipes() {
  if (recipes) return;
  spellWidget = core.CacheDefinitions.getSpellByName(DATA.spell)?.widgetId ?? 0;
  if (!spellWidget) throw new Error(`Missing cache spell: ${DATA.spell}`);
  recipes = loadRecipes();
  outputRecipes = new Map(recipes.map((recipe) => [recipe.outputId, recipe]));
}

function stopEnchanting(player) {
  running.get(player)?.stop();
  running.delete(player);
}

function carried(player, recipe) {
  return player.getInventory().getAmount(recipe.inputId);
}

/** Whether the enchanted bolts of this cast have somewhere to go once the plain ones are taken. */
function hasRoom(player, recipe, count) {
  const inventory = player.getInventory();
  return inventory.contains(recipe.outputId) || carried(player, recipe) <= count || inventory.getFreeSlots() > 0;
}

/** One cast: up to ten bolts, its runes and XP. False when it could not be cast. */
function castOnce(player, recipe) {
  const held = carried(player, recipe);
  if (held <= 0 || !recipe.spell.canCast(player, false)) return false;
  const count = Math.min(held, DATA.boltsPerCast);
  if (!hasRoom(player, recipe, count)) {
    player.sendMessage("You don't have enough inventory space.");
    return false;
  }
  if (!recipe.spell.canCast(player, true)) return false;
  const inventory = player.getInventory();
  inventory.deleteNumber(recipe.inputId, count);
  inventory.adds(recipe.outputId, count);
  inventory.refreshItems();
  player.performAnimation(new core.Animation(CAST_ANIMATION));
  player.performGraphic(new core.Graphic(CAST_GRAPHIC));
  player.getPacketSender().sendSound(CAST_SOUND);
  // A spam (filterable) line, as live sends it (rsprox: type=spam, 118 times; e.g. 227/00089.txt:32033).
  player.getPacketSender().sendTypedMessage(core.ChatType.SPAM, SUCCESS_MESSAGE);
  player.getSkillManager().addExperiences(core.Skill.MAGIC, recipe.spell.baseExperience());
  return true;
}

/** `sets` casts: the first now, the second after 2 ticks, then every 3. */
function startEnchanting(player, recipe, sets) {
  stopEnchanting(player);
  let remaining = Math.max(0, Math.min(MAX_SETS, sets | 0));
  if (remaining <= 0 || !castOnce(player, recipe)) return;
  remaining--;
  if (remaining <= 0) return;
  let wait = SECOND_CAST_TICKS;
  const task = new (class extends core.Task {
    constructor() { super(1, player.getIndex(), false); }
    execute() {
      if (!player.isRegistered() || player.getHitpoints() <= 0) return this.stop();
      if (--wait > 0) return;
      wait = CAST_TICKS;
      if (!castOnce(player, recipe) || --remaining <= 0) this.stop();
    }
  })();
  running.set(player, task);
  core.TaskManager.submit(task);
}

/** The recipes whose bolts are carried and whose level the player has. */
function choicesFor(player) {
  const magic = player.getSkillManager().getCurrentLevel(core.Skill.MAGIC);
  return recipes.filter((recipe) => carried(player, recipe) > 0 && recipe.level <= magic);
}

function openMenu(player, choices) {
  player.getPacketSender().sendCreationMenu(new core.CreationMenu(
    MENU_TITLE,
    choices.map((recipe) => recipe.outputId),
    { execute: (outputId, amount) => { const recipe = outputRecipes.get(outputId); if (recipe) startEnchanting(player, recipe, amount); } },
    { mode: MENU_MODE, maxAmount: MAX_SETS }
  ));
}

function castBoltEnchantments(event) {
  ensureRecipes();
  if (event.spellName?.trim().toLowerCase() !== DATA.spell.toLowerCase()) return;
  event.handled = true;
  const { player } = event;
  if (player.getSpellbook() !== core.MagicSpellbook.NORMAL) return;
  stopEnchanting(player);
  if (!recipes.some((recipe) => carried(player, recipe) > 0)) {
    player.sendMessage(NO_BOLTS_MESSAGE);
    return;
  }
  const choices = choicesFor(player);
  if (choices.length === 0) {
    // Bolts carried, but the Magic level is short of every one of them.
    const lowest = recipes.filter((recipe) => carried(player, recipe) > 0).sort((a, b) => a.level - b.level)[0];
    player.sendMessage(`You need a Magic level of ${lowest.level} to cast this spell.`);
    return;
  }
  openMenu(player, choices);
}

module.exports = function attach(api) {
  core = api.core;
  api.onSpellCast(castBoltEnchantments);
};

Object.assign(module.exports, { castBoltEnchantments, startEnchanting });
