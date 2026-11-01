/**
 * The collection log (https://oldschool.runescape.wiki/w/Collection_log): what a player has
 * obtained, the log and overview interfaces, and the new-item message and popup. The contents come
 * from the cache (Data.CollectionLog); see docs/collection-log.md for the captured packets.
 *
 * Loot counts the moment it drops: every "npc-drops:roll" (NPC drops, and the rewards of the
 * Gauntlet, Doom, Wintertodt, the Colosseum, the Inferno and ToA) is read once its handlers have
 * finished editing it. Other sources and plugins use events:
 *   api.emitCustomEvent("collection-log:obtain", { player, itemId, amount?, ensure?, silent? })
 *   api.emitCustomEvent("collection-log:count", { player, category: "Zulrah", amount? })
 *   answer "collection-log:category-count" { player, category, struct, count } with a kept count
 *   api.emitCustomEvent("collection-log:open", { player, category? })  open it, at a category by name
 * and it emits "collection-log:new-item" { player, itemId } for an item newly earned, from any source.
 *
 *   ::clog <item name|id> [amount]   obtain through the real path
 *   ::clog count <category> <n>      set a category's count
 *   ::clog reset                     clear the log
 */
const Data = require("./collectionlog/Data.CollectionLog");
const Progress = require("./collectionlog/Progress.CollectionLog");
const Interface = require("./collectionlog/Interface.CollectionLog");
const REWARD_SHOPS = new Set(require("./collectionlog/data/reward-shops.json"));

const USAGE = "Usage: ::clog <item name|id> [amount] | ::clog count <category> <n> | ::clog reset";

function categoriesNamed(name) {
  const wanted = String(name ?? "").toLowerCase();
  return Data.tabs().flatMap((tab) => tab.categories).filter((category) => category.name.toLowerCase() === wanted);
}

/** A loot roll, read once every handler has finished with it. */
function onLoot(event) {
  if (!event?.player || !Array.isArray(event.drops)) return;
  queueMicrotask(() => {
    const { player, drops, npc } = event;
    const name = npc?.getDefinition?.()?.getName?.();
    if (name) for (const category of categoriesNamed(name)) Progress.addCategoryCount(player, category);
    for (const drop of drops) {
      const itemId = Number(drop?.itemId ?? drop?.id);
      const amount = Number(drop?.amount ?? 1);
      if (Number.isInteger(itemId)) Progress.obtain(player, itemId, amount);
    }
  });
}

function onObtain(request) {
  if (request?.player) request.added = Progress.obtain(request.player, Number(request.itemId), Number(request.amount ?? 1), request);
}

function isLoggedItem(request) {
  request.logged = Data.isLogged(request.itemId);
}

function onCount(request) {
  if (!request?.player) return;
  for (const category of categoriesNamed(request.category)) Progress.addCategoryCount(request.player, category, Number(request.amount ?? 1));
}

function onPurchase(event) {
  if (!REWARD_SHOPS.has(event.shopName) || !event.originalStock) return;
  Progress.obtain(event.player, event.itemId, event.amount);
}

function findItem(text) {
  if (/^\d+$/.test(text)) return Number(text);
  const wanted = text.toLowerCase();
  for (const tab of Data.tabs()) {
    for (const category of tab.categories) {
      const match = category.items.find((id) => String(Data.itemName(id) ?? "").toLowerCase() === wanted);
      if (match !== undefined) return match;
    }
  }
  return null;
}

function clogCommand({ player, parts }) {
  const args = parts.slice(1);
  if (args[0]?.toLowerCase() === "reset") {
    Progress.reset(player);
    player.sendMessage("Your collection log has been cleared.");
    return true;
  }
  if (args[0]?.toLowerCase() === "count" && args.length >= 3 && /^\d+$/.test(args.at(-1))) {
    const matches = categoriesNamed(args.slice(1, -1).join(" "));
    if (matches.length === 0) player.sendMessage(`No collection log category is called "${args.slice(1, -1).join(" ")}".`);
    for (const category of matches) Progress.setCategoryCount(player, category, Number(args.at(-1)));
    if (matches.length) player.sendMessage(`${matches[0].name}: ${args.at(-1)}.`);
    return true;
  }
  const amount = args.length > 1 && /^\d+$/.test(args.at(-1)) ? Number(args.pop()) : 1;
  const itemId = args.length ? findItem(args.join(" ")) : null;
  if (itemId === null || !Data.isLogged(itemId)) {
    player.sendMessage(args.length ? `"${args.join(" ")}" is not in the collection log.` : USAGE);
    return true;
  }
  Progress.obtain(player, itemId, amount);
  player.sendMessage(`${Data.itemName(itemId)}: ${Progress.obtained(player, itemId)} obtained.`);
  return true;
}

module.exports = {
  name: "CollectionLog",
  register(api) {
    Data(api);
    Progress(api);
    Interface(api);
    api.onCustomEvent("npc-drops:roll", onLoot);
    api.onCustomEvent("collection-log:obtain", onObtain);
    api.onCustomEvent("collection-log:is-item", isLoggedItem);
    api.onCustomEvent("collection-log:count", onCount);
    api.onCustomEvent("shop:purchase", onPurchase);
    api.registerCommand("clog", clogCommand, api.core.PlayerRights.ADMINISTRATOR, "Collection log: ::clog <item> [amount] | count <category> <n> | reset");
  },
  _test: { onLoot, onObtain, onCount, onPurchase, clogCommand, findItem },
};
