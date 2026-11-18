"use strict";

const C = require("./Context.Hunter");
const { H, ANIM } = C;

/**
 * The free bird snare on the Isle of Souls, near the spinning wheel (loc
 * hunting_bird_snare_for_taking, 2167,2981; Wiki: Bird snare, "Isle of Souls - near spinning wheel").
 * rsprox.net recording 70 (rev 227, Leagues V), ticks 2603-2627: the player faces the loc and plays
 * human_pickupfloor, and a tick later one bird snare goes in with the pickup sound (2582). Holding
 * three it refuses with "You already have plenty of those." and no animation; with two it gives
 * one again. Each take is its own click.
 * Ours: only the inventory is counted (snares laid or banked are not), and the cap is the one
 * recorded boundary (refused at 3, taken at 2). The full-inventory reply is not recorded.
 */
const NAME = "<col=ff9040>Bird snare";
const CAP = 3;
const REFUSAL = "You already have plenty of those.";
const PICKUP_SOUND = 2582;

function take({ player }) {
  const snare = H.core.ItemIdentifiers.BIRD_SNARE;
  const inventory = player.getInventory();
  if (inventory.getAmount(snare) >= CAP) {
    player.sendMessage(REFUSAL);
    return true;
  }
  if (inventory.getFreeSlots() <= 0) {
    inventory.full();
    return true;
  }
  C.begin(player, 1, ANIM.PICKUP, () => {
    if (inventory.getAmount(snare) >= CAP) return;
    if (inventory.getFreeSlots() <= 0) return void inventory.full();
    inventory.adds(snare, 1);
    player.getPacketSender().sendSound(PICKUP_SOUND, 1, 0);
  }, null, { reset: false });
  return true;
}

function canTakeRootLog(player) {
  const { KNIFE, LOGS } = H.core.ItemIdentifiers;
  const inventory = player.getInventory();
  if (!C.hasTool(player, KNIFE)) {
    player.sendMessage("You need a knife to cut logs from the roots.");
    return false;
  }
  if (inventory.getAmount(LOGS) >= 3) {
    player.sendMessage("You already have some logs. Taking more could risk the stability of the cavern.");
    return false;
  }
  if (inventory.getFreeSlots() <= 0) {
    inventory.full();
    return false;
  }
  return true;
}

/** The Burrow's roots yield one log per click, up to three carried logs (OSRS Wiki). */
function takeRootLog({ player, objectId }) {
  if (objectId !== H.core.ObjectIdentifiers.ROOTS_59) return false;
  if (!canTakeRootLog(player)) return true;
  C.begin(player, 1, null, () => {
    if (!canTakeRootLog(player)) return;
    player.getInventory().adds(H.core.ItemIdentifiers.LOGS, 1);
    player.sendMessage("You manage to ease some logs off the roots.");
  }, null, { reset: false });
  return true;
}

module.exports = { NAME, CAP, REFUSAL, take, takeRootLog };
