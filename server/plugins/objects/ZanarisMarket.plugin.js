"use strict";

const { crossingFor } = require("./WallDoor.Doors");
const { startTranscript } = require("../quests/QuestRuntime");

const DOOR_DIALOGUE = "attempting-to-open-the-magic-door";
const SACK_CONDITION = "EhzhNS";
const HAS_DIAMOND = "RuGpH5";
const NO_DIAMOND = "067rrj";
const PAY_AND_ENTER = "8FWu8-";
const pending = new WeakMap();

function hasDiamond(core, player) {
  return player.getInventory().getAmount(core.ItemIdentifiers.DIAMOND) > 0;
}

function enteringMarket(player, door) {
  const crossing = crossingFor(door, player.getLocation());
  return crossing && (crossing.destination.x > crossing.approach.x || crossing.destination.y < crossing.approach.y);
}

function checkFee(api, event) {
  const { ObjectIdentifiers, NpcIdentifiers } = api.core;
  const { objectId, object, player } = event;
  if (event.handled) return;
  if (objectId === ObjectIdentifiers.MAGIC_DOOR_3 || objectId === ObjectIdentifiers.MAGIC_DOOR_5) {
    event.handled = true;
    return;
  }
  if (objectId !== ObjectIdentifiers.MAGIC_DOOR_2 && objectId !== ObjectIdentifiers.MAGIC_DOOR_4) return;
  pending.delete(player);
  if (!enteringMarket(player, object)) return;
  event.handled = true;
  pending.set(player, object);
  // The first branch is the separate sack restriction. This change supplies the diamond toll.
  startTranscript(api, player, NpcIdentifiers.GATEKEEPER, "Gatekeeper", DOOR_DIALOGUE,
    (steps) => steps.filter((step) => step.id !== SACK_CONDITION));
}

function feeCondition(core, { player, npcId, stepId }) {
  if (npcId !== core.NpcIdentifiers.GATEKEEPER || !pending.has(player)) return null;
  if (stepId === HAS_DIAMOND) return hasDiamond(core, player);
  if (stepId === NO_DIAMOND) return !hasDiamond(core, player);
  return null;
}

function payAndEnter(api, event) {
  const { player, npcId, stepId } = event;
  if (event.handled || npcId !== api.core.NpcIdentifiers.GATEKEEPER || stepId !== PAY_AND_ENTER) return;
  const door = pending.get(player);
  pending.delete(player);
  if (!door || !hasDiamond(api.core, player) || player.getMovementQueue().isMovementBlocked()) return;
  const here = player.getLocation();
  const { approach } = crossingFor(door, here);
  if (here.x !== approach.x || here.y !== approach.y || here.z !== approach.z || !enteringMarket(player, door)) return;

  const request = { player, object: door, handled: false };
  api.emitCustomEvent("door:open", request);
  if (!request.handled) return;
  player.getInventory().deleteNumber(api.core.ItemIdentifiers.DIAMOND, 1);
  event.handled = true;
}

module.exports = {
  name: "ZanarisMarket",
  description: "Charges the Gatekeeper's diamond toll when entering the Zanaris market.",
  members: true,
  register(api) {
    api.onCustomEvent("door:toggle", checkFee.bind(null, api));
    api.onNpcDialogueCondition(feeCondition.bind(null, api.core));
    api.onCustomEvent("npc-dialogue:action", payAndEnter.bind(null, api));
  },
};
