/**
 * Endless gathering for idle accounts (plugins/modes/data/idle-mode.json "gathering"): what the
 * idle skills gather goes to the bank, so a full inventory never stops them; trees and rocks stay
 * standing; fishing spots stay put; and random events leave idle players alone. Everything here
 * answers the skills' own events (`storage:gather`, `storage:room`, `woodcutting:deplete-tree`,
 * `mining:deplete-rock`, `fishing:spot-stays`, `random-events:eligibility`).
 */
const Common = require("./Common.IdleMode");

/** `storage:gather`: whatever an open container did not take goes to the bank. */
function gather(request) {
  if (!Common.data.gathering.bankResources || !Common.idleGather(request.player, request.skill)) return;
  const left = request.amount - request.stored;
  if (left > 0 && Common.bank(request.player, request.itemId, left)) request.stored = request.amount;
}

/** `storage:room`: the bank's room counts, so a full inventory keeps gathering. */
function room(request) {
  if (request.room || !Common.data.gathering.bankResources || !Common.idleGather(request.player, request.skill)) return;
  if (Common.bankHasRoom(request.player, request.itemId)) request.room = true;
}

function keepTree(event) {
  if (!event.handled && Common.data.gathering.endlessResources && Common.idleGather(event.player, Common.core.Skill.WOODCUTTING)) event.handled = true;
}

function keepRock(event) {
  if (!event.handled && Common.data.gathering.endlessResources && Common.idleGather(event.player, Common.core.Skill.MINING)) event.handled = true;
}

function keepSpot(request) {
  if (!request.handled && Common.data.gathering.fishingSpotsStay && Common.idleGather(request.player, Common.core.Skill.FISHING)) request.handled = true;
}

function randomEvents(request) {
  if (request.allowed === null && !Common.data.gathering.randomEvents && Common.isIdle(request.player)) request.allowed = false;
}

module.exports = function attach(api) {
  api.onCustomEvent("storage:gather", gather);
  api.onCustomEvent("storage:room", room);
  api.onCustomEvent("woodcutting:deplete-tree", keepTree);
  api.onCustomEvent("mining:deplete-rock", keepRock);
  api.onCustomEvent("fishing:spot-stays", keepSpot);
  api.onCustomEvent("random-events:eligibility", randomEvents);
};

module.exports.handlers = { gather, room, keepTree, keepRock, keepSpot, randomEvents };
