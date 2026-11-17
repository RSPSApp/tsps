/**
 * The Mysterious Stranger's deathbank, from the Wiki and Transcript:Mysterious Stranger
 * (Hallowed Sepulchre): a death inside the Sepulchre leaves the lost items with him in the lobby,
 * and Collect opens the shared Item Retrieval Service interface (gravestone_retrieval, 602).
 * A later unsafe death deletes the old lot.
 *
 * The interface and record format are the same as Torfinn's (Retrieval.Vorkath.js): items are
 * stacks with their metadata, and Take moves what fits. The Item Retrieval Service charges the
 * Stranger's 25,000-coin fee (Wiki) through the shared `gravestones:pay-fee` contract; cache
 * enum 1753 gives his unpaid/paid if1 states 29/30.
 */
const Tools = require("./Tools.HallowedSepulchre");
const Run = require("./Run.HallowedSepulchre");

const ATTR = "hallowed-sepulchre:retrieval";
const OWNER = "hallowed-sepulchre";
const MAX_STACK = 2147483647;
const FEE = 25000;
const INV = 525;
const SLOTS = 120;
/** Enum 1753: the Stranger's own unpaid/paid if1 states (29/30), not Torfinn's 5/6. */
const IF1 = { unpaid: 29, paid: 30, empty: -1 };
const PAID_SCRIPT = 3478;
const MODAL = 0;
const MAIN_MODAL_OPEN = 2524;
const TAKE_OP = 2;
const EXAMINE_OP = 10;
const EVENTS = (1 << 2) | (1 << 9) | (1 << 10);
const EMPTY_LINE = "I do not have anything for you. If I did have any of your items, but you died before collecting them, they'll now be lost.";
const CANNOT_PAY = "You don't have enough coins with you or in your bank to pay the fee.";

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

/** Lost items as stacks, metadata kept; at most 2^31-1 a stack. */
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

/** The player is in a Sepulchre floor instance while its area is theirs. */
function inside(player) {
  if (Run.runOf(player)?.area) return true;
  return player.getArea?.()?.getName?.() === "Hallowed Sepulchre";
}

/**
 * A death inside keeps the lost items with the Stranger. A PvP death or any death outside
 * deletes the previous lot, as the Wiki's "unsafe death" rule says.
 */
function deathDrops(event) {
  const { player, killer } = event;
  if (killer && killer !== player) {
    if (held(player)) setHeld(player, null);
    return;
  }
  if (!inside(player)) {
    if (held(player)) setHeld(player, null);
    return;
  }
  const lost = records([...event.items, ...event.untradeables]);
  event.items.length = 0;
  event.untradeables.length = 0;
  setHeld(player, { items: lost, paid: false });
}

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

/** Pays the 25,000 coins through the shared gravestones fee contract; payment stays on the lot. */
function pay(player, lot) {
  const request = { player, amount: FEE, office: false, source: null, message: null };
  api.emitCustomEvent("gravestones:pay-fee", request);
  if (!request.source) {
    player.sendMessage(CANNOT_PAY);
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
    core.examineItem(player, entry.id, entry.amount);
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

/** Collect: the interface, or the Stranger's line when he holds nothing (Transcript). */
function collect({ player, npc, definition }) {
  if (!Tools.isStranger(npc)) return false;
  if (held(player)) {
    open(player);
    return true;
  }
  const { DialogueChainBuilder, NpcDialogue } = core;
  const npcId = definition?.getId?.() ?? npc?.getId?.();
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(new NpcDialogue(0, npcId, EMPTY_LINE)));
  return true;
}

/** Generic read-only view of what the Stranger holds (clue capacity and the like). */
function retrievalItems(request) {
  for (const { id, amount } of held(request.player)?.items ?? []) request.items.push({ itemId: id, amount });
}

/**
 * "group-ironman:wipe-tradeables" { player, lost(id, amount) }: a leaver who stays a ranked
 * Group Ironman loses what the Stranger holds that they lose (Wiki, Group Ironman Mode).
 */
function wipeForGroupIronman({ player, lost }) {
  const lot = held(player);
  if (!lot || typeof lost !== "function") return;
  const left = lot.items.filter((entry) => !(entry && lost(entry.id, entry.amount)));
  if (left.length !== lot.items.length) setHeld(player, { ...lot, items: left });
}

function attachRetrieval(pluginApi) {
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
  pluginApi.onNpcsInteraction(["Mysterious Stranger"], { Collect: collect });
  pluginApi.onInterfaceActionButton(COMPONENT.button, button);
  pluginApi.onInterfaceActionButton(COMPONENT.items, clickItem);
  pluginApi.onCustomEvent("item-retrieval:items", retrievalItems);
  pluginApi.onCustomEvent("group-ironman:wipe-tradeables", wipeForGroupIronman);
}

module.exports = {
  attachRetrieval, held, open, collect, button, clickItem, deathDrops, inside,
  pay, retrievalItems, wipeForGroupIronman, FEE, ATTR,
};
