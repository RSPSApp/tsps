/**
 * Wine: grapes (or Zamorak's grapes) on a jug of water make unfermented wine, which ferments 20
 * ticks after the last jug was made, in the inventory and the bank alike, into wine or a jug of
 * bad wine. Levels, XP and success chances are the Wiki's (plugins/skills/data/cooking.json);
 * the menu, animation, graphic, sound, line and timing are from rsprox captures (recordings 91,
 * 1105). See docs/cooking.md.
 */
const Common = require("./Common.Cooking");
const Recipes = require("./Recipes.Cooking");

const MAKE_WINE_ANIMATION = "human_make_wine";
const MAKE_WINE_SPOTANIM = "cooking_make_wine_spotanim";
/** With every jug, 2 ticks late (rsprox captures). */
const MAKE_WINE_SOUND = 2489;
const MAKE_WINE_SOUND_DELAY = 2;
/** Once, as the last jug of a batch is made (rsprox captures). */
const FERMENT_MESSAGE = "You squeeze the grapes into the jug. The wine begins to ferment.";
/** A jug every 2 ticks from the choice (rsprox captures). */
const WINE_TIMING = [2, 2];
/** Wiki: one timer for all of a player's wine, back to 20 ticks with every jug made. */
const FERMENT_TICKS = 20;
/** Wiki (Jug of wine, Mod Ash): a stack is rolled as this many batches, plus a roll for each jug left over. */
const FERMENT_BATCHES = 15;
const WATER = "jug_water";

/** Players with wine fermenting, to the ticks left. */
const fermenting = new Map();
let fermentTask = null;

function wineFor(firstId, secondId) {
  const waterId = Common.gameval("obj", WATER);
  const otherId = firstId === waterId ? secondId : secondId === waterId ? firstId : null;
  if (otherId === null) return null;
  return Common.wineData().find(({ grapesId }) => grapesId === otherId) ?? null;
}

function wineRecipe(wine) {
  return {
    productId: wine.unfermentedId,
    level: wine.level,
    xp: 0,
    ingredients: [{ id: wine.grapesId, count: 1 }, { id: Common.gameval("obj", WATER), count: 1 }],
    returns: [],
    timing: WINE_TIMING,
  };
}

function playMakeWine(player) {
  const { Animation, Graphic } = Common.core;
  player.performAnimation(new Animation(Common.gameval("seq", MAKE_WINE_ANIMATION)));
  player.performGraphic(new Graphic(Common.gameval("spotanim", MAKE_WINE_SPOTANIM)));
  player.getPacketSender().sendSound(MAKE_WINE_SOUND, 1, MAKE_WINE_SOUND_DELAY);
}

function makeWine(event) {
  const { player, usedItemId, usedWithItemId } = event;
  const wine = wineFor(usedItemId, usedWithItemId);
  if (!wine) return;
  event.handled = true;
  Recipes.offer(player, wineRecipe(wine), {
    cycle: () => playMakeWine(player),
    made: () => queueFerment(player),
    done: () => Common.spam(player, FERMENT_MESSAGE),
  });
}

/** Wiki (Skilling success chance): the chance out of 256 at this level, from the low and high values. */
function successChance(player, wine) {
  const level = Math.min(99, Common.level(player));
  const [low, high] = wine.chance;
  const value = Math.floor((low * (99 - level)) / 98 + (high * (level - 1)) / 98 + 0.5) + 1;
  return Math.max(0, Math.min(1, value / 256));
}

/** How many of `count` jugs ferment into wine: FERMENT_BATCHES rolls for equal batches, and one for each jug left over. */
function successes(count, chance, random = Math.random) {
  const batch = Math.floor(count / FERMENT_BATCHES);
  let good = 0;
  if (batch > 0) for (let roll = 0; roll < FERMENT_BATCHES; roll++) if (random() < chance) good += batch;
  for (let roll = 0; roll < count - batch * FERMENT_BATCHES; roll++) if (random() < chance) good++;
  return good;
}

function bankTabs(player) {
  const { Bank } = Common.core;
  return player.getBanks().filter((bank, tab) => bank && tab !== Bank.BANK_SEARCH_TAB_INDEX);
}

/** Every banked stack of the item, as { tab, slot }. */
function bankedStacks(tabs, itemId) {
  const stacks = [];
  for (const tab of tabs) {
    tab.getItems().forEach((item, slot) => {
      if (item?.getId() === itemId && item.getAmount() > 0) stacks.push({ tab, slot });
    });
  }
  return stacks;
}

/**
 * Whether the banked jugs' wine and bad wine fit: each output joins a stack the bank holds, or
 * takes the unfermented stack's slot or a free one.
 */
function bankFits(player, tabs, wine, good, bad) {
  const holds = (id) => bankedStacks(tabs, id).length > 0;
  const newStacks = (good > 0 && !holds(wine.wineId) ? 1 : 0) + (bad > 0 && !holds(wine.badId) ? 1 : 0);
  // An existing output stack still needs room for the entire banked result.
  for (const [id, amount] of [[wine.wineId, good], [wine.badId, bad]]) {
    if (amount <= 0) continue;
    const [held] = bankedStacks(tabs, id);
    if (held && held.tab.getAddableAmount(new Common.core.Item(id, amount)) < amount) return false;
  }
  return newStacks <= bankedStacks(tabs, wine.unfermentedId).length + Common.core.Bank.freeSlots(player);
}

/**
 * The banked jugs become `good` wine and `bad` bad wine. A new output stack takes the unfermented
 * stack's own slot first, so the conversion never needs more room than bankFits allowed.
 */
function fermentBanked(player, tabs, wine, good, bad) {
  const { Bank, Item } = Common.core;
  const joining = [];
  const fresh = [];
  for (const [id, amount] of [[wine.wineId, good], [wine.badId, bad]]) {
    if (amount <= 0) continue;
    const [held] = bankedStacks(tabs, id);
    (held ? joining : fresh).push({ held, item: new Item(id, amount) });
  }
  const touched = new Set();
  for (const { tab, slot } of bankedStacks(tabs, wine.unfermentedId)) {
    tab.setItem(slot, fresh.shift()?.item ?? new Item(-1, 0));
    touched.add(tab);
  }
  for (const { held, item } of joining) {
    held.tab.add(item, false);
    touched.add(held.tab);
  }
  for (const { item } of fresh) {
    const tab = player.getBank(Bank.getTabForItem(player, item.getId()));
    tab.add(item, false);
    touched.add(tab);
  }
  for (const tab of touched) tab.sortItems();
  // One refresh sends the whole bank.
  [...touched][0]?.refreshItems();
}

/**
 * Every unfermented jug of this wine, carried and banked, turns into wine or bad wine at once,
 * with all its XP. A bank without room for the outcome keeps its jugs unfermented, for the next
 * timer, rather than lose any.
 */
function fermentWine(player, wine) {
  const { Item, Skill } = Common.core;
  const inventory = player.getInventory();
  const tabs = bankTabs(player);
  const carried = inventory.getAmount(wine.unfermentedId);
  let banked = tabs.reduce((sum, tab) => sum + tab.getAmount(wine.unfermentedId), 0);
  if (carried + banked <= 0) return;
  const chance = successChance(player, wine);
  let good = successes(carried + banked, chance);
  const bankedGood = () => good - Math.min(good, carried);
  if (banked > 0 && !bankFits(player, tabs, wine, bankedGood(), banked - bankedGood())) {
    banked = 0;
    good = successes(carried, chance);
  }

  let carriedGood = Math.min(good, carried);
  const items = inventory.getItems();
  for (let slot = 0; slot < items.length; slot++) {
    if (items[slot]?.getId() !== wine.unfermentedId) continue;
    inventory.setItem(slot, new Item(carriedGood > 0 ? wine.wineId : wine.badId, 1));
    carriedGood--;
  }
  if (carried > 0) inventory.refreshItems();

  if (banked > 0) fermentBanked(player, tabs, wine, bankedGood(), banked - bankedGood());

  if (good <= 0) return;
  Common.addXp(player, good * wine.xp);
  Common.api.emitCustomEvent("skills:produced", { player, skill: Skill.COOKING, itemId: wine.wineId, amount: good, xp: good * wine.xp, kind: "ferment" });
}

function ferment(player) {
  for (const wine of Common.wineData()) fermentWine(player, wine);
}

/** Starts the timer again from FERMENT_TICKS (Wiki: every jug made resets it). */
function queueFerment(player) {
  fermenting.set(player, FERMENT_TICKS);
  if (fermentTask) return;
  const { Task } = Common.core;
  fermentTask = new (class extends Task {
    constructor() { super(1); }
    execute() { fermentTick(); }
  })();
  Common.api.getTaskManager().submit(fermentTask);
}

function fermentTick() {
  for (const [player, ticks] of fermenting) {
    if (!player.isRegistered()) {
      fermenting.delete(player);
    } else if (ticks <= 1) {
      fermenting.delete(player);
      ferment(player);
    } else {
      fermenting.set(player, ticks - 1);
    }
  }
}

/** Wine still unfermented from an earlier session ferments the usual 20 ticks after login. */
function resumeFermenting({ player }) {
  const holds = (id) => player.getInventory().contains(id) || bankTabs(player).some((tab) => tab.getAmount(id) > 0);
  if (Common.wineData().some(({ unfermentedId }) => holds(unfermentedId))) queueFerment(player);
}

function forget({ player }) {
  fermenting.delete(player);
}

module.exports = Object.assign(function attachWine(api) {
  api.onItemOnItem(makeWine, { noted: false });
  api.onPlayerLogin(resumeFermenting);
  api.onPlayerDisconnect(forget);
}, { _test: { successChance, successes, ferment, fermentTick, fermenting, FERMENT_TICKS } });
