/**
 * What the collection log holds, read from the cache (loaded on first use):
 *   tab structs 471-475: param 682 name, 683 enum (category key -> category struct), 684 tab index
 *   category struct:     param 689 name, 690 enum (position -> item)
 * A category's "global" number (the search list's third argument, as captured) is its key plus
 * the key ranges of the tabs before it: bosses 0-56, raids 57-59, clues 60-70, minigames 71-92,
 * other 93-123.
 */
const { CacheDefinitions } = require("../../src/main/typescript/elvarg/game/cache/CacheDefinitions");

const TAB_STRUCTS = [471, 472, 473, 474, 475];

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
    tab.items = new Set(tab.categories.flatMap((category) => category.items));
    offset += tab.maxKey + 1;
    tabs.push(tab);
  }
  tabs.sort((a, b) => a.index - b.index);
  const maxCategorySize = Math.max(...tabs.flatMap((tab) => tab.categories.map((category) => category.items.length)));
  data = { tabs, categoriesByStruct, categoriesByItem, categoryTotal: offset, itemTotal: categoriesByItem.size, maxCategorySize };
  return data;
}

const tabs = () => load().tabs;
const isLogged = (itemId) => load().categoriesByItem.has(itemId);
const categoriesOf = (itemId) => load().categoriesByItem.get(itemId) ?? [];
const categoryByKey = (tab, key) => tab.categories.find((category) => category.key === key) ?? null;
const globalIndex = (category) => category.tab.offset + category.key;

module.exports = { TAB_STRUCTS, load, tabs, isLogged, categoriesOf, categoryByKey, globalIndex };
