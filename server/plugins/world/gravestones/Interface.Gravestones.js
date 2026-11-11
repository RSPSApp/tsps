"use strict";

/**
 * The grave's options and its interface (gravestone_generic): Check opens it, Loot takes the
 * free items, both from up to 7 tiles away. In the interface an item click takes it (Examine is
 * op 10), the free button takes every free item, the pay button pays the fee or, once paid,
 * takes the paid items.
 */
const Common = require("./Common.Gravestones");
const Grave = require("./Grave.Gravestones");
const Storage = require("./Storage.Gravestones");
const { examineItem } = require("../../../src/main/typescript/elvarg/game/content/ExaminePrice");

const EXAMINE_OP = 10;
/** All Settings "Show confirmation when paying for items from gravestone" (192): on while 1. */
const PAY_CONFIRM_VARBIT = 13113;
let pluginApi = null;

function reachGrave(event) {
  if (Grave.owns(event.player, event.npc)) event.range = Grave.ACCESS_RANGE;
}

function check({ player, npc }) {
  if (!Grave.owns(player, npc)) return false;
  Grave.open(player);
  return true;
}

function loot({ player, npc }) {
  if (!Grave.owns(player, npc)) return false;
  Grave.loot(player);
  return true;
}

function clickItem(event) {
  const { player } = event;
  if (!Grave.isOpen(player)) return;
  const slot = Number.isInteger(event.slot) ? event.slot : -1;
  if ((event.opId ?? event.action) === EXAMINE_OP) {
    const entry = Storage.grave(player)?.items[slot];
    if (event.itemId > 0) examineItem(player, event.itemId, entry?.id === event.itemId ? entry.amount : 1);
    return;
  }
  Grave.takeSlot(player, slot);
}

function takeFree({ player }) {
  if (Grave.isOpen(player)) Grave.takeFree(player);
}

/**
 * The pay button. With the confirmation on, a fee is paid only once the player says yes, while
 * the fee is unchanged. Answering closes the grave's interface, so either answer brings it back
 * while the player is still within reach of the grave.
 */
function pay({ player }) {
  if (!Grave.isOpen(player)) return;
  const owed = Grave.fee(player);
  if (owed <= 0 || player.getPacketSender().getVarbit?.(PAY_CONFIRM_VARBIT) !== 1 || !pluginApi) {
    Grave.payOrTake(player);
    return;
  }
  // Ours: the question and its options (no capture of the confirmation).
  pluginApi.sendMultiChatboxPrompt(player, `Pay ${owed.toLocaleString("en-US")} coins to retrieve your items?`,
    "Yes", () => { if (reopen(player) && Grave.fee(player) === owed) Grave.payOrTake(player); },
    "No", () => reopen(player));
}

/** Opens the grave's interface again if the player can still reach the grave. */
function reopen(player) {
  const npc = Grave.npcOf(player);
  if (!npc || !player.getLocation().isWithinDistance(npc.getLocation(), Grave.ACCESS_RANGE)) return false;
  if (!Grave.isOpen(player)) Grave.open(player);
  return true;
}

function close({ player }) {
  Grave.close(player);
}

function attach(api) {
  pluginApi = api;
  Common.bind(api);
  api.onNpcRoute(reachGrave);
  api.onNpcInteraction("Grave", { Check: check, Loot: loot });
  api.onInterfaceActionButton([Common.COMPONENT.freeItems, Common.COMPONENT.payItems], clickItem);
  api.onInterfaceActionButton(Common.COMPONENT.freeButton, takeFree);
  api.onInterfaceActionButton(Common.COMPONENT.payButton, pay);
  api.onInterfaceActionButton(Common.COMPONENT.close, close);
}

module.exports = { attach, pay, PAY_CONFIRM_VARBIT };
