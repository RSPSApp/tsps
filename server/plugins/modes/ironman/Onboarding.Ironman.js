"use strict";

const Ironman = require("./Common.Ironman");
const PENDING_ATTRIBUTE = "ironman:initial-setup-pending";
const opened = new WeakSet();
const disconnected = new WeakSet();
let api;

function tutorialAvailable() {
  const query = { available: false };
  api.emitCustomEvent("tutorial:availability", query);
  return query.available === true;
}

function finish(player) {
  opened.delete(player);
  player.setAttribute(PENDING_ATTRIBUTE, false);
}

/** The tutorial-off world's initial choice uses the existing tutor's screen, not Adam upgrades. */
function resume(player) {
  if (disconnected.has(player) || !player.isRegistered() || player.getAttribute(PENDING_ATTRIBUTE) !== true) return;
  if (tutorialAvailable() || Ironman.modeOf(player) !== "none") return finish(player);
  if (opened.has(player) || player.getInterfaceId() >= 0) return;
  opened.add(player);
  const request = { player, upgrades: true, initial: true, handled: false, onClosed: () => finish(player) };
  api.emitCustomEvent("ironman:open-setup", request);
  if (!request.handled) finish(player);
}

function schedule(player) { queueMicrotask(() => resume(player)); }

function login({ player, isNewAccount }) {
  disconnected.delete(player);
  if (player.isPlayerBot?.() === true) return;
  if (tutorialAvailable() || Ironman.modeOf(player) !== "none") return finish(player);
  if (isNewAccount === true) player.setAttribute(PENDING_ATTRIBUTE, true);
  // Other login hooks queue the initial character designer. Let those mount first.
  queueMicrotask(() => schedule(player));
}

function closed({ player }) {
  if (player.getAttribute(PENDING_ATTRIBUTE) === true) schedule(player);
}

function logout({ player }) {
  disconnected.add(player);
  opened.delete(player);
}

/** Resolve onboarding before any ordinary world action can close its current modal. */
function worldInput(event) {
  if (event.player.getAttribute(PENDING_ATTRIBUTE) === true) event.handled = true;
}

module.exports = function attach(pluginApi) {
  api = pluginApi;
  api.persistAttribute(PENDING_ATTRIBUTE, false);
  api.onPlayerLogin(login);
  api.onPlayerLogout(logout);
  api.onPlayerDisconnect(logout);
  api.onCustomEvent("interface:closed", closed);
  api.onCustomEvent("player:world-input", worldInput);
};
