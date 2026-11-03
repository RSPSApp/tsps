/**
 * Shops that won't trade, and stock that isn't sold, until a quest is done: Oziach's armour
 * (Dragon Slayer I), Rellekka's traders (The Fremennik Trials), the Sophanem stalls (Contact!)
 * and the rest in ./data/quest-shops.json, from the OSRS Wiki. Every way into a shop goes
 * through ShopManager.open, so the gate holds for Trade, dialogue and plugins alike.
 *
 * - A gated shop refuses with the Wiki's own lines (the trader's speech, a box or a game
 *   message) and stays shut.
 * - Gated stock is hidden from the player ("shop:stock-visible"), so it takes no slot.
 * - Shop versions whose names don't say which quest they follow ("Battle Runes
 *   (Post-miniquest)") are picked here for "npc-dialogue:shop".
 *
 * Not gated: player bots, and quests this server doesn't have (the shop stays open).
 */
const DATA = require("./data/quest-shops.json");

let pluginApi;
/** Shop name -> its gate, built once from the data file. */
let gatesByShop = null;
/** Shop name -> [{ items: Set, quest }] for gated stock. */
let stockByShop = null;

function build() {
  if (gatesByShop) return;
  const { ItemIdentifiers, NpcIdentifiers } = pluginApi.core;
  const item = (name) => {
    const id = ItemIdentifiers[name];
    if (typeof id !== "number") throw new Error(`quest-shops.json: unknown item ${name}`);
    return id;
  };
  gatesByShop = new Map();
  for (const entry of DATA.shops) {
    const npcId = entry.npc ? NpcIdentifiers[entry.npc] : null;
    if (entry.npc && typeof npcId !== "number") throw new Error(`quest-shops.json: unknown NPC ${entry.npc}`);
    const gate = { ...entry, npcId, carrying: entry.carrying ? item(entry.carrying) : null };
    for (const name of entry.shops) gatesByShop.set(name, gate);
  }
  stockByShop = new Map();
  for (const entry of DATA.stock) {
    const list = stockByShop.get(entry.shop) ?? [];
    list.push({ quest: entry.quest, items: new Set(entry.items.map(item)) });
    stockByShop.set(entry.shop, list);
  }
}

/** True when the quest is done (started, with `started`), or when this server has no such quest. */
function questDone(player, quest, started = false) {
  const request = { player, name: quest, complete: null, started: null };
  pluginApi.emitCustomEvent(started ? "quest:is-started" : "quest:is-complete", request);
  return (started ? request.started : request.complete) !== false;
}

function carries(player, itemId) {
  return player.getInventory().contains(itemId) || player.getEquipment().contains(itemId);
}

function shopName(shopId) {
  return pluginApi.core.ShopDefinition.forId(shopId)?.getName?.() ?? null;
}

function gateFor(name) {
  build();
  return gatesByShop.get(name) ?? null;
}

function admits(player, gate) {
  if (player.isPlayerBot?.()) return true;
  if (!questDone(player, gate.quest, gate.started === true)) return false;
  return gate.carrying === null || carries(player, gate.carrying);
}

function refuse(player, gate) {
  const { DialogueChainBuilder, NpcDialogue, StatementDialogue } = pluginApi.core;
  if (gate.message || (!gate.npcId && !gate.statement)) {
    const fallback = gate.started ? DATA.fallbackStarted : DATA.fallback;
    player.sendMessage(gate.message ?? fallback.replace("{quest}", gate.quest));
    return;
  }
  const chain = new DialogueChainBuilder();
  let index = 0;
  for (const line of gate.lines ?? []) chain.add(new NpcDialogue(index++, gate.npcId, line));
  if (gate.statement) chain.add(new StatementDialogue(index++, gate.statement));
  player.getDialogueManager().startDialogues(chain);
}

function canShop(event) {
  if (event.shopId == null) return;
  const gate = gateFor(shopName(event.shopId));
  if (!gate || admits(event.player, gate)) return;
  event.allow = false;
  refuse(event.player, gate);
}

function stockVisible(event) {
  build();
  const gates = stockByShop.get(event.shopName);
  if (!gates || event.player?.isPlayerBot?.()) return;
  if (gates.some((gate) => gate.items.has(event.itemId) && !questDone(event.player, gate.quest))) event.visible = false;
}

/**
 * npc-dialogue:shop: the version in data/quest-shops.json "versions" that applies, `quest` once
 * it is complete and `before` until then. Only for quests this server has.
 */
function pickVersion(request) {
  if (request.shop || !request.player) return;
  const complete = (quest) => {
    const query = { player: request.player, name: quest, complete: null };
    pluginApi.emitCustomEvent("quest:is-complete", query);
    return query.complete;
  };
  const applies = (version) => version.quest ? complete(version.quest) === true : complete(version.before) === false;
  const version = DATA.versions.find((entry) => request.shops?.includes(entry.shop) && applies(entry));
  if (version) request.shop = version.shop;
}

module.exports = function attachShops(api) {
  pluginApi = api;
  api.onCanShop(canShop);
  api.onCustomEvent("shop:stock-visible", stockVisible);
  api.onCustomEvent("npc-dialogue:shop", pickVersion);
};

module.exports._test = { canShop, stockVisible, pickVersion, gateFor, setApi(value) { pluginApi = value; gatesByShop = null; stockByShop = null; } };
