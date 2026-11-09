/** Critical content changes share the asynchronous backends and coalesce within an operation. */
const VALUABLE_ITEM_COINS = 10_000_000;
let api;

function bind(pluginApi) { api = pluginApi; }

function request({ player, reason }) {
  if (player) api.core.GameConstants.PLAYER_PERSISTENCE.requestSave(player, reason);
}

function questCompleted({ player }) {
  request({ player, reason: "quest-completion" });
}

function shopPurchase({ player, currency }) {
  if (currency && currency !== "COINS") request({ player, reason: "reward-shop" });
}

function valuable(item, discard = false) {
  const definition = item.getDefinition();
  const collectible = { itemId: definition.unNote(), logged: false };
  const valueDefinition = definition.isNoted()
    ? api.core.ItemDefinition.forId(collectible.itemId) : definition;
  api.emitCustomEvent("collection-log:is-item", collectible);
  return (discard && (!item.isTradeable() || !item.isDropable())) || collectible.logged ||
    valueDefinition.getGrandExchangeValue() * item.getAmount() >= VALUABLE_ITEM_COINS;
}

function discarded({ player, item }) {
  if (valuable(item, true)) request({ player, reason: "valuable-item-discard" });
}

function lootGenerated(event) {
  queueMicrotask(() => {
    if (event.drops?.some(drop => {
      const id = drop.itemId ?? drop.id;
      return id > 0 && drop.amount > 0 && valuable(new api.core.Item(id, drop.amount));
    })) request({ player: event.player, reason: "rare-drop" });
  });
}

module.exports = {
  name: "SaveEvents",
  description: "Requests an immediate player save after important events: quest completions, reward-shop purchases, valuable discards and valuable drops.",
  register(pluginApi) {
    bind(pluginApi);
    pluginApi.onCustomEvent("persistence:save", request);
    pluginApi.onCustomEvent("quest:completed", questCompleted);
    pluginApi.onCustomEvent("shop:purchase", shopPurchase);
    pluginApi.onCustomEvent("item:discarded", discarded);
    pluginApi.onCustomEvent("npc-drops:roll", lootGenerated);
  },
};
