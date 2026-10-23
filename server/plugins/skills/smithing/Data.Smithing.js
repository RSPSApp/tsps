/**
 * Smithing data. The anvil's products come from the cache: enum 846 (product -> level), 845
 * (-> bars) and 844 (-> amount made), laid out per bar as client script 430 draws them
 * (plugins/skills/data/smithing-anvil-layout.json, written by `yarn dump:smithing`). Furnace
 * recipes and experience, which the cache doesn't hold, are in plugins/skills/data/smithing.json.
 */
const layout = require("../data/smithing-anvil-layout.json");
const data = require("../data/smithing.json");

const AMOUNT_ENUM = 844;
const BARS_ENUM = 845;
const LEVEL_ENUM = 846;
/** Interface component -> the 1-based slot index varbit smithing_item_lasttype holds. */
const ITEM_LASTTYPE_ENUM = 1101;

/** The furnace recipes, filled in by load() so the bots and the Blast Furnace share one array. */
const SMELTING_RECIPES = [];
/** smithing_bar_type value -> bar, and back (enum 1253, as laid out). */
const BAR_TYPE_BY_BAR = new Map(layout.bars.map(({ barType, bar }) => [bar, barType]));

let core = null;
let products = null;
let cannonballList = null;
let spearList = null;

/** The anvil's product grid, interface "smithing". */
function smithingInterface() {
  return core.CacheDefinitions.getInterfaceId("smithing");
}

/** Resolves the item names in smithing.json. Safe to call again; any plugin's `api.core` will do. */
function load(apiCore) {
  if (core) return;
  const item = (name) => {
    const id = apiCore.ItemIdentifiers[name];
    if (!Number.isInteger(id)) throw new Error(`Smithing: unknown item ${name}`);
    return id;
  };
  // Resolve every recipe first: a bad name throws on every load, never leaving a partial list.
  const recipes = data.smelting.map((recipe) => ({
    ...recipe,
    barId: item(recipe.bar),
    ingredients: recipe.ingredients.map(([name, amount]) => [item(name), amount]),
    byproducts: (recipe.byproducts ?? []).map(([name, amount]) => [item(name), amount]),
    skill: recipe.skill ? apiCore.Skill[recipe.skill] : undefined,
  }));
  SMELTING_RECIPES.push(...recipes);
  core = apiCore;
}

/** The bars the furnace's Smelt menu lists, in its order. */
function smeltMenuRecipes() {
  return SMELTING_RECIPES.filter((recipe) => !recipe.notInMenu);
}

/** Every anvil product, by bar: { component, itemId, label, level, bars, amount, xp, members, quest }. */
function productsByBar() {
  if (products) return products;
  const { CacheDefinitions, ItemIdentifiers } = core;
  const levels = CacheDefinitions.getEnumValues(LEVEL_ENUM);
  const bars = CacheDefinitions.getEnumValues(BARS_ENUM);
  const amounts = CacheDefinitions.getEnumValues(AMOUNT_ENUM);
  const slotIndex = CacheDefinitions.getEnumValues(ITEM_LASTTYPE_ENUM);
  const objNames = CacheDefinitions.getObjNames();
  const xpPerBar = new Map(Object.entries(data.xpPerBar).map(([name, xp]) => [ItemIdentifiers[name], xp]));
  const productXp = new Map(Object.entries(data.productXp).map(([name, xp]) => [ItemIdentifiers[name], xp]));
  products = new Map();
  for (const { bar, slots } of layout.bars) {
    products.set(bar, slots.map((slot) => {
      const barsUsed = Number(bars.get(slot.item) ?? 1);
      return {
        barId: bar,
        /** The metal in "You hammer the <metal> and make ...": the bar's gameval without "_bar". */
        metal: String(objNames.get(bar) ?? "").replace(/_bar$/, ""),
        component: slot.component,
        slotIndex: Number(slotIndex.get((smithingInterface() << 16) | slot.component) ?? 0),
        itemId: slot.item,
        label: slot.label,
        phrase: data.objPhrases[slot.obj] ?? data.phrases[slot.label.replace(/ \(\d\)$/, "")] ?? `a ${slot.label.toLowerCase()}`,
        level: Number(levels.get(slot.item)),
        bars: barsUsed,
        amount: Number(amounts.get(slot.item) ?? 1),
        xp: productXp.get(slot.item) ?? (xpPerBar.get(bar) ?? 0) * barsUsed,
        members: slot.members === true,
        quest: slot.quest,
      };
    }));
  }
  return products;
}

/** The cannonball each bar pours into: { ballId, barId, metal, level, xpPerBar }. */
function cannonballs() {
  cannonballList ??= data.cannonballs.map((entry) => ({
    ballId: core.ItemIdentifiers[entry.ball],
    barId: core.ItemIdentifiers[entry.bar],
    metal: entry.bar.replace(/_BAR$/, "").toLowerCase(),
    level: entry.level,
    xpPerBar: entry.xpPerBar,
  }));
  return cannonballList;
}

/** Blurite's anvil products, as anvil products of the blurite bar (The Knight's Sword). */
function bluriteProducts() {
  return data.blurite.map((entry) => ({
    barId: core.ItemIdentifiers.BLURITE_BAR,
    metal: "blurite",
    itemId: core.ItemIdentifiers[entry.item],
    level: entry.level,
    bars: 1,
    amount: entry.amount,
    xp: entry.xp,
    phrase: entry.phrase,
    quest: "the_knights_sword",
  }));
}

/** Barbarian spears and hastas by bar: { barId, logId, level, xp, spearId, hastaId }. */
function spears() {
  const objId = (name) => core.CacheDefinitions.getObjId(name);
  spearList ??= data.spears.map((entry) => ({
    barId: core.ItemIdentifiers[entry.bar],
    logId: core.ItemIdentifiers[entry.log],
    level: entry.level,
    xp: entry.xp,
    spearId: objId(entry.spear),
    hastaId: objId(entry.hasta),
  }));
  return spearList;
}

function questName(key) {
  return data.questNames[key] ?? key;
}

function productsFor(barId) {
  return productsByBar().get(barId) ?? [];
}

/** The bars an anvil works, lowest first (the cache's bar-type order). */
function anvilBars() {
  return layout.bars.map(({ bar }) => bar);
}

module.exports = {
  SMELTING_RECIPES,
  smithingInterface,
  BAR_TYPE_BY_BAR,
  load,
  smeltMenuRecipes,
  productsFor,
  anvilBars,
  questName,
  cannonballs,
  bluriteProducts,
  spears,
};
