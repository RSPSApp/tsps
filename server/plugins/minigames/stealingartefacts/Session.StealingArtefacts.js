"use strict";

/**
 * The run's lifecycle. Teleporting, banking, destroying or losing an artefact ends it: the
 * Wiki says any teleport, random event or logout removes the artefact, and the task then has
 * to be asked for again (Khaled plays the failure line once). Logging out without the artefact
 * leaves the task alone.
 *
 * Wiki: https://oldschool.runescape.wiki/w/Stealing_artefacts
 */

const Common = require("./Common.StealingArtefacts");

/** Teleporting always drops it; the teleport itself still goes ahead. */
function onCanTeleport(event) {
  Common.loseArtefact(event.player);
}

function onCanBankItem(event) {
  if (!Common.isArtefact(event.item?.getId?.())) return;
  event.player.sendMessage(Common.MESSAGES.unbankable);
  event.allow = false;
}

/**
 * Destroy is a drop with no ground pass. The shared DestroyItem confirmation re-emits the
 * policy with dropToGround false; that pass is where the artefact goes for good.
 */
function onItemDropPolicy(event) {
  if (!Common.isArtefact(event.itemId) || event.dropToGround !== false) return;
  event.handled = true;
  event.player.getInventory().deleteAtSlot(event.slot, event.item.getAmount());
  Common.endRun(event.player);
}

function onPlayerLogout(event) {
  Common.loseArtefact(event.player);
  Common.forgetSession(event.player);
}

/** Dying loses the artefact even if the death drop already took it. */
function onPlayerDeath(event) {
  if (Common.taskOf(event.player) && !Common.loseArtefact(event.player)) Common.endRun(event.player);
}

/** A crash left the artefact in the saved inventory; it does not survive the login. */
function onPlayerLogin(event) {
  Common.loseArtefact(event.player);
}

module.exports = function registerSession(api) {
  Common.bind(api);
  api.persistAttribute(Common.TASK_ATTRIBUTE);
  api.persistAttribute(Common.FAILED_ATTRIBUTE);
  api.onCanTeleport(onCanTeleport);
  api.onCanBankItem(onCanBankItem);
  api.onItemDropPolicy(onItemDropPolicy);
  api.onPlayerLogout(onPlayerLogout);
  api.onPlayerDisconnect(onPlayerLogout);
  api.onPlayerDeath(onPlayerDeath);
  api.onPlayerLogin(onPlayerLogin);
};

module.exports._test = { onCanTeleport, onCanBankItem, onItemDropPolicy, onPlayerLogout, onPlayerDeath, onPlayerLogin };
