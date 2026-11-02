/**
 * Torfinn's Item Retrieval Service, as recorded (rsprox 227/00543, 00572, 01749, 01851, 01857):
 * - a death in the crater leaves every lost item, untradeables included, with Torfinn instead of a
 *   grave, and once the player is back on their feet: "Torfinn has retrieved some of your items.
 *   You can collect them from him in Rellekka.";
 * - Collect (op 4 on his post-quest form, either side of the crossing) opens
 *   gravestone_retrieval (602) over inv gravestone (525): if1 5 (unpaid) or 6 (paid), the
 *   items' Take/Examine events, and "Stack count / Guide value" for what he holds;
 * - its button first pays the 100,000 coins ("Payment has been taken from your bank: 100,000 x
 *   Coins", if1 6, script 3478), then takes everything that fits; what doesn't fit stays for
 *   later, free. When he holds nothing more, if1 is -1.
 * Wiki (Vorkath, Item Retrieval Service): the fee comes from Death's Coffer or the bank, and any
 * unsafe death loses what he holds. Transcript:Torfinn gives his line when he holds nothing.
 * UNVERIFIED (no recording): Take on one item (op 2) before paying pays first, and the message
 * when nothing covers the fee.
 *
 * This takes the lost items from the death-drops hook before Gravestones does (plugins load in
 * path order: bosses/ before world/).
 */
const Area = require("./Area.Vorkath");
const StorageDeaths = require("../../items/storage/Events.StorageItems");

const ATTR = "vorkath:retrieval";
const OWNER = "vorkath";
const MAX_STACK = 2147483647;
const FEE = 100000;
const INV = 525;
const SLOTS = 120;
const IF1 = { unpaid: 5, paid: 6, empty: -1 };
const PAID_SCRIPT = 3478;
const MAIN_MODAL_OPEN = 2524;
const MODAL = 0;
const TAKE_OP = 2;
const EXAMINE_OP = 10;
const EVENTS = (1 << 2) | (1 << 9) | (1 << 10);
const MESSAGE = {
  retrieved: "Torfinn has retrieved some of your items. You can collect them from him in Rellekka.",
  nothing: "I'm afraid I don't have anything for you [name]. If I did have any of your items, but you died before collecting them, they'll now be lost.",
  cannotPay: "You don't have enough coins with you or in your bank to pay the fee.",
};

let api = null;
let core = null;
const COMPONENT = {};
const VARP = {};

function held(player) {
  const value = player.getAttribute?.(ATTR);
  return Array.isArray(value?.items) && value.items.length > 0 ? value : null;
}

function setHeld(player, value) {
  player.setAttribute(ATTR, value && value.items.length > 0 ? value : null);
}

/** Lost items as stacks, meta kept: two of a potion stay one entry of two, as recorded; at most 2^31-1 a stack. */
function records(items) {
  const out = [];
  for (const item of items) {
    const meta = item.getMeta?.() ?? null;
    const record = { id: item.getId(), amount: item.getAmount() };
    if (meta) record.meta = JSON.parse(JSON.stringify(meta));
    const same = out.find((r) => r.id === record.id && r.amount < MAX_STACK && JSON.stringify(r.meta ?? null) === JSON.stringify(record.meta ?? null));
    if (same) {
      const moved = Math.min(record.amount, MAX_STACK - same.amount);
      same.amount += moved;
      record.amount -= moved;
    }
    if (record.amount > 0) out.push(record);
  }
  return out;
}

/**
 * An unsafe death: in the crater Torfinn keeps what it loses (an earlier lot is gone); anywhere
 * else what he held is lost.
 */
function deathDrops(event) {
  const { player, killer, location } = event;
  player.__vorkathRetrieved = false;
  if (killer && killer !== player) {
    if (held(player)) setHeld(player, null);
    return;
  }
  if (!Area.insideCrater(location)) {
    if (held(player)) setHeld(player, null);
    return;
  }
  // A fish barrel's or tackle box's contents go with it (StorageItems' own hook runs after this).
  StorageDeaths.deathDrops(event);
  const lost = records([...event.items, ...event.untradeables]);
  event.items.length = 0;
  event.untradeables.length = 0;
  setHeld(player, { items: lost, paid: false });
  if (lost.length > 0) player.__vorkathRetrieved = true;
}

/** Recorded the tick the player stands up in Lumbridge. */
function announce({ player }) {
  if (!player.__vorkathRetrieved) return;
  player.__vorkathRetrieved = false;
  player.sendMessage(MESSAGE.retrieved);
}

// ---------------------------------------------------------------- the interface

function isOpen(player) {
  return player.getPacketSender().isSubInterfaceOpen(COMPONENT.items >>> 16);
}

function guideValue(entries) {
  return entries.reduce((sum, { id, amount }) => sum + Math.max(0, core.ItemDefinition.forId(id).getGrandExchangeValue?.() ?? 0) * amount, 0);
}

function summary(entries) {
  const count = `Stack count: <col=ffffff>${entries.length}</col><br>Guide value: <col=ffffff>${guideValue(entries).toLocaleString("en-GB")}</col>`;
  return entries.length > 0 ? `${count} (approximately)` : count;
}

function sendContents(player, lot) {
  const entries = lot?.items ?? [];
  const sender = player.getPacketSender();
  sender.sendInventory(INV, SLOTS, entries);
  sender.sendString(summary(entries), COMPONENT.discard);
}

function open(player) {
  const lot = held(player);
  // The interface is shared (the Theatre of Blood's chest): whichever opened it answers its clicks.
  player.__retrievalOwner = OWNER;
  const sender = player.getPacketSender();
  sender.sendInterfaceRemoval();
  sender.sendConfig(VARP.if2, 0);
  sender.sendConfig(VARP.if1, lot.paid ? IF1.paid : IF1.unpaid);
  sender.sendInventory(INV, SLOTS, lot.items);
  sender.sendInterfaceScript(MAIN_MODAL_OPEN, [-1, -1]);
  sender.sendSubInterface(COMPONENT.mainModal, COMPONENT.items >>> 16, MODAL);
  sender.sendInterfaceFlagsRange(COMPONENT.items, 0, SLOTS - 1, EVENTS);
  sender.sendString(summary(lot.items), COMPONENT.discard);
}

function pay(player, lot) {
  const request = { player, amount: FEE, office: false, source: null, message: null };
  api.emitCustomEvent("gravestones:pay-fee", request);
  if (!request.source) {
    player.sendMessage(MESSAGE.cannotPay);
    return false;
  }
  if (request.message) player.sendMessage(request.message);
  lot.paid = true;
  setHeld(player, lot);
  const sender = player.getPacketSender();
  sender.sendConfig(VARP.if1, IF1.paid);
  sendContents(player, lot);
  sender.sendInterfaceScript(PAID_SCRIPT, [FEE, 0]);
  return true;
}

/** Moves as much of `entry` as fits; returns whether any moved. */
function takeEntry(player, entry) {
  const inventory = player.getInventory();
  const item = new core.Item(entry.id, entry.amount, entry.meta ?? null);
  const count = Math.min(entry.amount, inventory.getAddableAmount(item));
  if (count <= 0) return false;
  inventory.add(new core.Item(entry.id, count, entry.meta ?? null), false);
  entry.amount -= count;
  return true;
}

function finishTaking(player, lot) {
  player.getInventory().refreshItems?.();
  lot.items = lot.items.filter((entry) => entry.amount > 0);
  setHeld(player, lot);
  if (lot.items.length === 0) player.getPacketSender().sendConfig(VARP.if1, IF1.empty);
  sendContents(player, lot);
}

function takeAll(player, lot) {
  for (const entry of lot.items) takeEntry(player, entry);
  finishTaking(player, lot);
}

function button({ player }) {
  if (player.__retrievalOwner !== undefined && player.__retrievalOwner !== OWNER) return false;
  if (!isOpen(player)) return;
  const lot = held(player);
  if (!lot) return false;
  if (!lot.paid) pay(player, lot);
  else takeAll(player, lot);
}

function clickItem(event) {
  const { player } = event;
  if (player.__retrievalOwner !== undefined && player.__retrievalOwner !== OWNER) return false;
  if (!isOpen(player)) return;
  const lot = held(player);
  const entry = lot?.items[Number.isInteger(event.slot) ? event.slot : -1];
  if (!entry) return;
  const op = event.opId ?? event.action;
  if (op === EXAMINE_OP) {
    player.sendMessage(core.ItemDefinition.forId(entry.id).getExamine());
    return;
  }
  if (op !== TAKE_OP) return;
  if (!lot.paid) {
    pay(player, lot);
    return;
  }
  takeEntry(player, entry);
  finishTaking(player, lot);
}

/** Collect: the interface, or his line when he holds nothing (Transcript:Torfinn). */
function collect({ player, npc, definition }) {
  if (held(player)) {
    open(player);
    return true;
  }
  const { DialogueChainBuilder, NpcDialogue } = core;
  const npcId = definition?.getId?.() ?? npc?.getId?.();
  const line = MESSAGE.nothing.replace("[name]", player.getUsername?.() ?? "");
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(new NpcDialogue(0, npcId, line)));
  return true;
}

/** Generic read-only view of what Torfinn holds (clue capacity and the like). */
function retrievalItems(request) {
  for (const { id, amount } of held(request.player)?.items ?? []) request.items.push({ itemId: id, amount });
}

function attach(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
  const { CacheDefinitions } = core;
  COMPONENT.items = CacheDefinitions.getComponentId("gravestone_retrieval:items");
  COMPONENT.button = CacheDefinitions.getComponentId("gravestone_retrieval:button");
  COMPONENT.discard = CacheDefinitions.getComponentId("gravestone_retrieval:discard");
  COMPONENT.mainModal = CacheDefinitions.getComponentId("toplevel_osrs_stretch:mainmodal");
  VARP.if1 = CacheDefinitions.getVarpId("if1");
  VARP.if2 = CacheDefinitions.getVarpId("if2");
  pluginApi.persistAttribute(ATTR);
  pluginApi.onPlayerDeathDrops(deathDrops);
  pluginApi.onPlayerDeath(announce);
  pluginApi.onNpcInteraction("Torfinn", { Collect: collect });
  pluginApi.onInterfaceActionButton(COMPONENT.button, button);
  pluginApi.onInterfaceActionButton(COMPONENT.items, clickItem);
  pluginApi.onCustomEvent("item-retrieval:items", retrievalItems);
}

module.exports = { attach, held, open, collect, button, clickItem, deathDrops, announce, summary, FEE, ATTR };
