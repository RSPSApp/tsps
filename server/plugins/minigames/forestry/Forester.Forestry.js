"use strict";

/** Friendly Forester: the native reward shop and one-way Ultimate Ironman log storage.
 * https://oldschool.runescape.wiki/w/Friendly_Forester / Forestry_Shop.
 * Stock, prices and currencies come from the cache's omnishop DB rows, not a second catalogue.
 */
const Common = require("./Common.Forestry");

const MET_ATTRIBUTE = "forestry:met-forester";
const LOGS_ATTRIBUTE = "forestry:shop-logs";
const FORESTER_IDS = new Set([12119, 11427, 6724]);
const SHOP = "forestry_shop";
const UIM_SHOP = "forestry_shop_uim";
const LOG_INVENTORY = 815;
const MAX_AMOUNT = 2147483647;
const SERVICE_RANGE = 3;
const SHOP_DESCRIPTION_PARAM = 1784;
const INTRO = "when-spoken-to-for-the-first-time";
let currencies;

const isForester = (event) => FORESTER_IDS.has(event.npcId ?? event.target?.getId?.());
const isShop = (name) => name === SHOP || name === UIM_SHOP;

function isUltimate(player) {
  const query = { player, mode: "none" };
  Common.api.emitCustomEvent("ironman:mode", query);
  return query.mode === "ultimate";
}

/** Only the nine logs actually charged by this shop, with their native noted/unnoted objs. */
function logCurrencies() {
  if (currencies) return currencies;
  const cache = Common.core.CacheDefinitions;
  const table = cache.getDbTableId("omnishop_currency_data");
  const obj = cache.getDbColumn(table, "omnishop_currency_obj");
  const stock = cache.getDbRow(cache.getDbRowId(SHOP));
  const stockColumn = cache.getDbColumn(stock.tableId, "omnishop_shop_stock");
  const costColumn = cache.getDbColumn(cache.getDbTableId("omnishop_stock_data"), "omnishop_stock_cost");
  const charged = new Set(stock.column(stockColumn).flatMap((id) =>
    cache.getDbRow(Number(id)).column(costColumn).filter((_, index) => index % 2 === 0).map(Number)));
  currencies = cache.getDbTableRows(table)
    .filter((row) => charged.has(row.id) && cache.getDbRowName(row.id).startsWith("forestry_shop_currency_log_"))
    .map((row) => ({ currency: row.id, note: Number(row.column(obj)[0]), log: Number(row.column(obj)[1]) }));
  return currencies;
}

function stored(player, log) {
  return player.getAttribute(LOGS_ATTRIBUTE)?.[log] ?? 0;
}

function setStored(player, log, amount) {
  player.setAttribute(LOGS_ATTRIBUTE, { ...(player.getAttribute(LOGS_ATTRIBUTE) ?? {}), [log]: amount });
}

function sendLogs(player) {
  const logs = logCurrencies();
  player.getPacketSender().sendInventory(LOG_INVENTORY, logs.length,
    logs.map(({ log }) => ({ id: log, amount: stored(player, log) })));
}

function login({ player }) {
  player.getPacketSender().sendVarbit(Common.core.CacheDefinitions.getVarbitId("forestry_forester_met"),
    player.getAttribute(MET_ATTRIBUTE) === true ? 1 : 0);
  sendLogs(player);
}

function trade({ player }) {
  sendLogs(player);
  Common.api.emitCustomEvent("omnishop:open", { player, shop: isUltimate(player) ? UIM_SHOP : SHOP });
}

function variant(event) {
  if (isForester(event)) return event.player.getAttribute(MET_ATTRIBUTE) === true ? "standard-dialogue" : INTRO;
}

function condition(event) {
  if (!isForester(event)) return undefined;
  const { player, stepId, npc } = event;
  // The Wiki's other introduction is for the Forester at Nemus Retreat (1352, 3298).
  if (stepId === "30B9Z6" || stepId === "nhRAZq") {
    const location = npc.getLocation();
    const atNemus = location.getZ() === 0 && Math.max(Math.abs(location.getX() - 1352), Math.abs(location.getY() - 3298)) <= SERVICE_RANGE;
    return stepId === "30B9Z6" ? atNemus : !atNemus;
  }
  if (stepId === "Vl2LET" || stepId === "EePSne") {
    const enough = player.getSkillManager().getMaxLevel(Common.core.Skill.WOODCUTTING) >= 15;
    return stepId === "EePSne" ? enough : !enough;
  }
}

function met(event) {
  if (!isForester(event) || !["30B9Z6", "nhRAZq"].includes(event.stepId)) return;
  event.player.setAttribute(MET_ATTRIBUTE, true);
  event.player.getPacketSender().sendVarbit(Common.core.CacheDefinitions.getVarbitId("forestry_forester_met"), 1);
}

function openFromDialogue(event) {
  if (!isForester(event) || event.action !== "open_interface" || event.target !== "Forestry Shop") return;
  event.handled = true;
  event.end = true;
  const { player } = event;
  const at = player.getLocation().clone();
  // The transcript closes its chatbox after this handler; do not overwrite a newer interaction.
  Common.later(1, () => {
    if (player.isRegistered() && player.getLocation().equals(at) && player.getInterfaceId() === -1
        && !player.getDialogueManager().getCurrent()) trade({ player });
  });
}

function describe(event) {
  if (!isShop(event.shop)) return;
  const cache = Common.core.CacheDefinitions;
  const row = cache.getDbRow(cache.getDbRowId(event.stock));
  const item = row.int(cache.getDbColumn(row.tableId, "omnishop_stock_obj"), -1);
  event.description = cache.getItem(item)?.params?.get(SHOP_DESCRIPTION_PARAM)
    ?? Common.core.ItemDefinition.forId(item).getExamine();
}

function canBuy(event) {
  if (!isShop(event.shop)) return;
  if ((event.shop === UIM_SHOP) !== isUltimate(event.player)) {
    event.cancel = true;
  } else if (!Common.core.WorldDefinition.isMembersWorld() && Common.core.CacheDefinitions.getItem(event.itemId).isMembers) {
    event.cancel = true;
    event.player.sendMessage("You need to be on a members' world to buy that.");
  }
}

function canSell(event) {
  if (!isShop(event.shop)) return;
  if ((event.shop === UIM_SHOP) !== isUltimate(event.player)
      || (isUltimate(event.player) && event.stock === "forestry_shop_stock_27")) event.cancel = true;
}

/** UIMs may spend stored logs or notes carried in the inventory; storage is spent first. */
function currency(event) {
  if (event.shop !== UIM_SHOP || !isUltimate(event.player)) return;
  const entry = logCurrencies().find((log) => log.currency === event.currency);
  if (!entry) return;
  const { player } = event;
  const inventory = player.getInventory();
  event.balance = stored(player, entry.log) + inventory.getAmount(entry.note);
  event.inventoryCost = (amount) => Math.max(0, amount - stored(player, entry.log));
  event.set = (balance) => {
    const spend = event.balance - balance;
    const fromStore = Math.min(stored(player, entry.log), spend);
    setStored(player, entry.log, stored(player, entry.log) - fromStore);
    if (spend > fromStore) inventory.delete(entry.note, spend - fromStore);
    inventory.refreshItems();
    sendLogs(player);
  };
}

/**
 * Anima-infused bark pays from the inventory and then from a carried or worn Forestry kit
 * ("storage:amount" / "storage:take"), since event bark goes straight into the kit. Ours: neither
 * the Wiki nor a capture shows the shop spending kit bark.
 */
function barkCurrency(event) {
  if (!isShop(event.shop) || event.itemId !== Common.data.items.bark || typeof event.set === "function") return;
  const { player } = event;
  const inventory = player.getInventory();
  const query = { player, itemId: event.itemId, amount: inventory.getAmount(event.itemId) };
  Common.api.emitCustomEvent("storage:amount", query);
  event.balance = query.amount;
  event.inventoryCost = (amount) => Math.min(amount, inventory.getAmount(event.itemId));
  // A refund is paid into the inventory, so a sale must have room for it.
  event.refundItemId = event.itemId;
  event.set = (balance) => {
    if (balance > event.balance) inventory.adds(event.itemId, balance - event.balance);
    const spend = Math.max(0, event.balance - balance);
    const fromInventory = Math.min(spend, inventory.getAmount(event.itemId));
    if (fromInventory > 0) inventory.delete(event.itemId, fromInventory);
    if (spend > fromInventory) Common.api.emitCustomEvent("storage:take", { player, itemId: event.itemId, amount: spend - fromInventory, taken: 0 });
    inventory.refreshItems();
  };
}

function inReach(player, npc) {
  return player.isRegistered() && npc.isRegistered() && isUltimate(player)
    && player.getPrivateArea() === npc.getPrivateArea()
    && player.getLocation().getZ() === npc.getLocation().getZ()
    && Common.distance(player.getLocation(), npc.getLocation()) <= SERVICE_RANGE;
}

function deposit(player, npc, entries, requested = MAX_AMOUNT) {
  if (!inReach(player, npc)) return;
  const inventory = player.getInventory();
  for (const { log, item } of entries) {
    const count = Math.min(requested, inventory.getAmount(item), MAX_AMOUNT - stored(player, log));
    if (count <= 0) continue;
    inventory.delete(item, count);
    setStored(player, log, stored(player, log) + count);
  }
  inventory.refreshItems();
  sendLogs(player);
  Common.api.emitCustomEvent("persistence:save", { player, reason: "forestry-log-storage" });
}

function checkLogs(player, npc) {
  if (!inReach(player, npc)) return;
  const lines = logCurrencies().map(({ log }) => `${Common.core.ItemDefinition.forId(log).getName()}: ${stored(player, log).toLocaleString("en-GB")}`);
  const { DialogueChainBuilder, StatementDialogue } = Common.core;
  const builder = new DialogueChainBuilder();
  for (let index = 0; index < lines.length; index += 3) {
    builder.add(new StatementDialogue(index / 3, lines.slice(index, index + 3).join("<br>")));
  }
  player.getDialogueManager().startDialogues(builder);
}

/** Wiki documents Check and Deposit-all; the warning's wording is ours (not captured). */
function storage({ player, npc }) {
  if (!inReach(player, npc)) return false;
  Common.api.sendMultiChatboxPrompt(player, "Forestry log storage",
    "Check stored logs", () => checkLogs(player, npc),
    "Deposit all logs", () => {
      if (!inReach(player, npc)) return;
      Common.api.sendMultiChatboxPrompt(player, "Deposits are permanent. Store all logs?",
        "Yes, deposit all logs", () => deposit(player, npc, logCurrencies().flatMap(({ log, note }) => [{ log, item: log }, { log, item: note }])),
        "No", () => {});
    });
}

function useLog(event) {
  if (!isForester(event) || !inReach(event.player, event.target)) return;
  const entry = logCurrencies().find(({ log, note }) => log === event.itemId || note === event.itemId);
  if (!entry) return;
  event.handled = true;
  const { player, target: npc } = event;
  player.setEnteredAmountAction({ execute: (amount) => {
    if (Number.isSafeInteger(amount) && amount > 0) deposit(player, npc, [{ log: entry.log, item: entry.log }], amount);
  } });
  player.getPacketSender().sendEnterAmountPrompt("How many logs? Deposited logs cannot be withdrawn.");
}

function attachForester(api) {
  api.persistAttribute(MET_ATTRIBUTE, false);
  api.persistAttribute(LOGS_ATTRIBUTE, {});
  api.onPlayerLogin(login);
  api.onNpcInteraction("Friendly Forester", { Trade: trade, "Log-storage": storage });
  api.onNpcDialogueVariant(variant);
  api.onNpcDialogueCondition(condition);
  api.onCustomEvent("npc-dialogue:condition", met);
  api.onCustomEvent("npc-dialogue:action", openFromDialogue);
  api.onCustomEvent("omnishop:currency", currency);
  api.onCustomEvent("omnishop:currency", barkCurrency);
  api.onCustomEvent("omnishop:describe", describe);
  api.onCustomEvent("omnishop:can-buy", canBuy);
  api.onCustomEvent("omnishop:can-sell", canSell);
  api.onItemOnNpc(useLog);
}

module.exports = { attachForester };
