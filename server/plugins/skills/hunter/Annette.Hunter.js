"use strict";

// Annette's drift net storage: her Wiki transcript on Talk-to, and her "Annette's Nets" interface
// (fossil_driftnet_store beside fossil_driftnet_sidestore). The cache scripts draw the stored nets
// from fossil_driftnet_store (varbit 243) with Withdraw-1/5/X/All and Banknote-All, and the
// inventory beside it with Store-1/5/X/All on drift nets, noted or not. She holds up to 2,000.
// https://oldschool.runescape.wiki/w/Annette
const C = require("./Context.Hunter"), { H } = C;
const DriftNets = require("./DriftNets.Hunter");

// Ids from `yarn dump:widget 309` / `307`: script 2140 (309's onload) draws the stored nets into
// component 5 (store), and script 2143 (307's onload) draws the inventory into component 0 (items).
const STORE_INTERFACE = 309; // fossil_driftnet_store
const SIDE_INTERFACE = 307; // fossil_driftnet_sidestore
const STORED_NETS_UID = (STORE_INTERFACE << 16) | 5; // fossil_driftnet_store:store
const SIDE_ITEMS_UID = SIDE_INTERFACE << 16; // fossil_driftnet_sidestore:items
const STORED_VARBIT = 243; // fossil_driftnet_store
const CAPACITY = 2000;
const OPS_1_TO_10 = 0x7fe;
const NETS_INTERFACE = "Annette's Nets";
/** Where each player opened her interface; core doesn't check button packets against it. */
const openedAt = new WeakMap();
/** Op slots as the cache scripts set them. */
const OP = { ONE: 1, FIVE: 2, X: 3, ALL: 4, BANKNOTE: 9, EXAMINE: 10 };

function netIds() {
  const net = H.core.ItemIdentifiers.DRIFT_NET;
  return [net, H.core.ItemDefinition.forId(net).getNoteId()];
}

function sendStored(player) {
  player.getPacketSender().sendVarbit(STORED_VARBIT, DriftNets.state(player).stored);
}

function open(player, annette) {
  const sender = player.getPacketSender();
  openedAt.set(player, annette);
  sendStored(player);
  sender.sendInterfaceSet(STORE_INTERFACE, SIDE_INTERFACE);
  sender.sendInterfaceFlagsRange(STORED_NETS_UID, 0, 0, OPS_1_TO_10);
  sender.sendInterfaceFlagsRange(SIDE_ITEMS_UID, 0, 27, OPS_1_TO_10);
  player.getInventory().refreshItems();
}

function talk({ player, object }) {
  if (!C.nearby(player, object)) return true;
  const request = { player, npcId: H.core.NpcIdentifiers.ANNETTE, variant: "standard-dialogue", handled: false };
  H.api.emitCustomEvent("npc-dialogue:start", request);
  if (request.handled) openedAt.set(player, object);
  else open(player, object);
  return true;
}

function nets({ player, object }) {
  if (C.nearby(player, object)) open(player, object);
  return true;
}

/** Her transcript's "opens Annette's Nets" step. */
function action(event) {
  if (event.npcId !== H.core.NpcIdentifiers.ANNETTE || !String(event.target ?? "").startsWith(NETS_INTERFACE)) return;
  const annette = openedAt.get(event.player);
  event.handled = true;
  event.end = true;
  if (annette && C.nearby(event.player, annette)) open(event.player, annette);
}

/** Her interface is open and she is still in reach (an amount typed in later is checked again). */
function using(player) {
  const annette = openedAt.get(player);
  return !!annette && player.getInterfaceId() === STORE_INTERFACE && C.nearby(player, annette);
}

function store(player, id, wanted) {
  if (using(player)) deposit(player, id, wanted);
}

function deposit(player, id, wanted) {
  const s = DriftNets.state(player);
  const amount = Math.min(wanted, player.getInventory().getAmount(id), CAPACITY - s.stored);
  if (amount <= 0 || !C.exchange(player, [[id, amount]], [])) return;
  s.stored += amount;
  sendStored(player);
}

function withdraw(player, wanted, noted) {
  if (!using(player)) return;
  const s = DriftNets.state(player), [net, note] = netIds();
  const amount = Math.min(wanted, s.stored, noted ? s.stored : player.getInventory().getFreeSlots());
  if (amount <= 0) { if (s.stored > 0) player.getInventory().full(); return; }
  if (!C.exchange(player, [], [[noted ? note : net, amount]])) { player.getInventory().full(); return; }
  s.stored -= amount;
  sendStored(player);
}

function askAmount(player, action) {
  player.setEnteredAmountAction({ execute: amount => action(Math.max(0, Math.trunc(Number(amount) || 0))) });
  player.getPacketSender().sendEnterAmountPrompt("Enter amount:");
}

function examine(player) {
  player.sendMessage(H.core.ItemDefinition.forId(H.core.ItemIdentifiers.DRIFT_NET).getExamine?.() ?? "");
}

function storedClick({ player, opId, action }) {
  if (!using(player)) return true;
  const op = opId ?? action;
  if (op === OP.EXAMINE) examine(player);
  else if (op === OP.X) askAmount(player, amount => withdraw(player, amount, false));
  else if (op === OP.BANKNOTE) withdraw(player, CAPACITY, true);
  else withdraw(player, op === OP.ONE ? 1 : op === OP.FIVE ? 5 : CAPACITY, false);
  return true;
}

function sideClick({ player, opId, action, slot }) {
  if (!using(player)) return true;
  const op = opId ?? action, item = player.getInventory().getItems()[slot ?? -1];
  if (!item || !netIds().includes(item.getId())) return true;
  if (op === OP.EXAMINE) examine(player);
  else if (op === OP.X) askAmount(player, amount => store(player, item.getId(), amount));
  else store(player, item.getId(), op === OP.ONE ? 1 : op === OP.FIVE ? 5 : CAPACITY);
  return true;
}

/** Drift nets used on her are stored, noted or not. */
function use(event) {
  if (!netIds().includes(event.itemId)) return false;
  event.handled = true;
  if (C.nearby(event.player, event.object)) deposit(event.player, event.itemId, CAPACITY);
  return true;
}

module.exports = { talk, nets, action, storedClick, sideClick, use, STORED_NETS_UID, SIDE_ITEMS_UID };
