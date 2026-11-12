/**
 * What the collection log holds, read from the cache (loaded on first use):
 *   tab structs 471-475: param 682 name, 683 enum (category key -> category struct), 684 tab index
 *   category struct:     param 689 name, 690 enum (position -> item)
 * A category's "global" number (the search list's third argument, as captured) is its key plus
 * the key ranges of the tabs before it: bosses 0-56, raids 57-59, clues 60-70, minigames 71-92,
 * other 93-123.
 */
const TAB_STRUCTS = [471, 472, 473, 474, 475];

let CacheDefinitions;
let data = null;

function load() {
  if (data) return data;
  const tabs = [];
  const categoriesByStruct = new Map();
  const categoriesByItem = new Map();
  let offset = 0;
  for (const struct of TAB_STRUCTS) {
    const params = CacheDefinitions.getStructParams(struct);
    const tab = { struct, index: Number(params.get(684)), name: String(params.get(682)), categories: [], offset };
    for (const [key, categoryStruct] of CacheDefinitions.getEnumValues(Number(params.get(683)))) {
      const categoryParams = CacheDefinitions.getStructParams(Number(categoryStruct));
      const items = [...CacheDefinitions.getEnumValues(Number(categoryParams.get(690))).values()].map(Number);
      const category = { key: Number(key), struct: Number(categoryStruct), name: String(categoryParams.get(689)), items, tab };
      tab.categories.push(category);
      categoriesByStruct.set(category.struct, category);
      for (const item of new Set(items)) {
        if (!categoriesByItem.has(item)) categoriesByItem.set(item, []);
        categoriesByItem.get(item).push(category);
      }
    }
    tab.categories.sort((a, b) => a.key - b.key);
    tab.maxKey = Math.max(...tab.categories.map((category) => category.key));
    offset += tab.maxKey + 1;
    tabs.push(tab);
  }
  tabs.sort((a, b) => a.index - b.index);
  // The log counts an item once however many categories list it, and a tab's count takes only the
  // items no earlier tab has: an Abyssal dagger (Abyssal Sire and Slayer) moves Bosses, not Other.
  // As captured, the five tab maximums always add up to collection_count_max.
  const counted = new Set();
  for (const tab of tabs) {
    tab.items = new Set(tab.categories.flatMap((category) => category.items).filter((item) => !counted.has(item)));
    tab.items.forEach((item) => counted.add(item));
  }
  const maxCategorySize = Math.max(...tabs.flatMap((tab) => tab.categories.map((category) => category.items.length)));
  data = { tabs, categoriesByStruct, categoriesByItem, categoryTotal: offset, itemTotal: categoriesByItem.size, maxCategorySize };
  return data;
}

const tabs = () => load().tabs;
const isLogged = (itemId) => load().categoriesByItem.has(itemId);
const categoriesOf = (itemId) => load().categoriesByItem.get(itemId) ?? [];
const categoryByKey = (tab, key) => tab.categories.find((category) => category.key === key) ?? null;
const globalIndex = (category) => category.tab.offset + category.key;

module.exports = function attachData(api) {
  CacheDefinitions = api.core.CacheDefinitions;
};

/** An item's cache name, or undefined. */
function itemName(itemId) {
  return CacheDefinitions.getItem(itemId)?.name;
}

Object.assign(module.exports, { TAB_STRUCTS, itemName, load, tabs, isLogged, categoriesOf, categoryByKey, globalIndex });
