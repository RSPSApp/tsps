"use strict";

/**
 * The ships' supply crates and the water pumps.
 *
 * Captures: Take gives one ("You take a Bucket from the crate.", "You take a Hammer from the
 * crate."), Take-5 five ("You take some Buckets from the crate."), with `human_pickuptable` and
 * sound 2582. A pump fills one bucket a tick until none are empty (captures 552, 1858): each
 * fill plays `human_pickuptable` and sound 4950 and says "You fill the bucket with water.".
 */

const Shared = require("./Shared.Tempoross");
const { coveOf } = require("./Cove.Tempoross");
const { untetherFor } = require("./Tethers.Tempoross");

const { ITEM, ANIM } = Shared;

const SOUND_TAKE = 2582;
const SOUND_PUMP = 4950;

const CRATES = {
  Hammers: { id: ITEM.HAMMER, one: "Hammer", many: "Hammers" },
  Ropes: { id: ITEM.ROPE, one: "Rope", many: "Ropes" },
  Harpoons: { id: ITEM.HARPOON, one: "Harpoon", many: "Harpoons" },
  Buckets: { id: ITEM.BUCKET, one: "Bucket", many: "Buckets" },
};

function take(player, crate, amount) {
  const inventory = player.getInventory();
  const room = Math.min(amount, inventory.getFreeSlots());
  if (room <= 0) {
    inventory.full();
    return;
  }
  Shared.animate(player, ANIM.UNTETHER);
  player.getPacketSender().sendSound(SOUND_TAKE, 100, 0);
  inventory.adds(crate.id, room);
  inventory.refreshItems();
  player.sendMessage(room === 1
    ? `You take a ${crate.one} from the crate.`
    : `You take some ${crate.many} from the crate.`);
}

/** The crate clicked, if it is one of the cove's; null leaves the click to other plugins. */
function crateOf(event) {
  const cove = coveOf(event.player);
  const crate = CRATES[event.definition?.getName?.()];
  if (!cove || !crate || !cove.contains(event.object.getLocation())) return null;
  untetherFor(event.player);
  return crate;
}

function takeOne(event) {
  const crate = crateOf(event);
  if (!crate) return false;
  take(event.player, crate, 1);
  return true;
}

function takeFive(event) {
  const crate = crateOf(event);
  if (!crate) return false;
  take(event.player, crate, 5);
  return true;
}

function takeTen(event) {
  const crate = crateOf(event);
  if (!crate) return false;
  take(event.player, crate, 10);
  return true;
}

function takeX(event) {
  const crate = crateOf(event);
  if (!crate) return false;
  const { player } = event;
  player.getPacketSender().sendEnterAmountPrompt("How many would you like to take?");
  player.setEnteredAmountAction({ execute: (answer) => take(player, crate, Math.max(0, Math.trunc(answer))) });
  return true;
}

function pump(event) {
  const { player, object } = event;
  const cove = coveOf(player);
  const inLobby = Shared.inBox(Shared.DATA.lobby.zone, object.getLocation());
  if (!cove && !inLobby) return false;
  if (cove) untetherFor(player);
  const inventory = player.getInventory();
  const buckets = inventory.getAmount(ITEM.BUCKET);
  if (buckets <= 0) {
    player.sendMessage("You need a bucket to fill with water.");
    return true;
  }
  player.setPositionToFace(object.getLocation());
  Shared.startAction(player, "pump", () => fillBucket(player));
  return true;
}

/** One bucket a tick; the tick after the last one ends the action. */
function fillBucket(player) {
  const inventory = player.getInventory();
  if (inventory.getAmount(ITEM.BUCKET) <= 0) return false;
  Shared.animate(player, ANIM.UNTETHER);
  player.getPacketSender().sendSound(SOUND_PUMP, 100, 0);
  inventory.delete(ITEM.BUCKET, 1);
  inventory.adds(ITEM.BUCKET_OF_WATER, 1);
  inventory.refreshItems();
  player.sendMessage("You fill the bucket with water.");
  return true;
}

function attachSupplies(api) {
  api.onObjectInteraction("Hammers", { Take: takeOne });
  api.onObjectInteraction("Ropes", { Take: takeOne });
  api.onObjectInteraction("Harpoons", { Take: takeOne });
  api.onObjectInteraction("Buckets", { Take: takeOne, "Take-5": takeFive, "Take-10": takeTen, "Take-X": takeX });
  api.onObjectInteraction("Water pump", { Use: pump, "Fill-bucket": pump });
}

module.exports = { attachSupplies };
