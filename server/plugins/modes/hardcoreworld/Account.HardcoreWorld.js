"use strict";

/**
 * A Hardcore character's login (live 20261104T120418, tick 0): "Welcome to Hardcore Old School
 * RuneScape." as the welcome line, hc_main = 1, and its state's varbits from the save. A brand-new
 * character starts in Death's Office (Arrival): after Tutorial Island where the world runs it,
 * otherwise at once, designing itself there while Death waits to greet it until the character
 * designer (679) has closed. There are no
 * Ironmen on Hardcore worlds: the Ironman setup stays shut and no mode change is allowed.
 */
const Common = require("./Common.HardcoreWorld");
const Arrival = require("./Arrival.HardcoreWorld");
const Choice = require("./Choice.HardcoreWorld");

/** make_over (the character designer) a new account opens with when there's no Tutorial Island. */
const DESIGNER_INTERFACE = 679;
/** Ticks after a new account's login to see whether a designer opened (it mounts after the login). */
const DESIGNER_GRACE_TICKS = 2;

function login({ player, isNewAccount }) {
  if (!Common.isHardcore(player)) return;
  Common.setVarbit(player, "main", 1);
  Common.setVarbit(player, "arrival", Number(player.getAttribute(Common.ARRIVAL_ATTRIBUTE)) || 0);
  Common.setVarbit(player, "resetCount", Common.resetCount(player.getUsername()));
  Common.setVarbit(player, "diedDate", Number(player.getAttribute(Common.DIED_DATE_ATTRIBUTE)) || 0);
  if (player.getAttribute(Common.CHOICE_PENDING_ATTRIBUTE) === true) {
    Choice.resume(player);
    return;
  }
  if (tutorialRuns()) return;
  // Without Tutorial Island the character starts in Death's Office at once (and a relog before it
  // got there puts it there); a new account designs itself there first, and Death waits for it.
  if (isNewAccount) {
    Arrival.holdGreeting(player);
    Arrival.start(player);
    Common.later(player, DESIGNER_GRACE_TICKS, () => {
      if (player.getInterfaceId?.() !== DESIGNER_INTERFACE) Arrival.releaseGreeting(player);
    });
    return;
  }
  if (Number(player.getAttribute(Common.ARRIVAL_ATTRIBUTE)) === 1) Arrival.start(player);
}

/** The new account's character designer closed: Death greets the soul it made. */
function designerClosed({ player, interfaceId }) {
  if (interfaceId === DESIGNER_INTERFACE && Common.isHardcore(player)) Arrival.releaseGreeting(player);
}

/** `ironman:can-open-setup` and `ironman:change-mode`: Hardcore worlds have no Ironmen. */
function refuseIronman(query) {
  if (!Common.isHardcore(query.player)) return;
  query.allowed = false;
  query.reason = Common.DATA.ours.noIronmen;
}

/**
 * `presets:can-use`: presets (this server's PvP loadouts) hand out items, which a Hardcore world's
 * economy can't have; their automatic opening after a death is skipped quietly too.
 */
function refusePresets(request) {
  if (!Common.isHardcore(request.player)) return;
  request.allow = false;
  request.message = Common.DATA.ours.noPresets;
}

/** `bots:pvp-allowed`: a Hardcore world has no PvP bots. */
function refusePvpBots(query) {
  query.allowed = false;
}

/** Whether this world runs Tutorial Island (its plugin answers `tutorial:availability`). */
function tutorialRuns() {
  const query = { available: false };
  Common.api().emitCustomEvent("tutorial:availability", query);
  return query.available === true;
}

function tutorialCompleted({ player }) {
  if (Common.isHardcore(player)) Arrival.start(player);
}

/** `welcome-screen:greeting`: live's line on a Hardcore world. */
function greeting(event) {
  if (!Common.isHardcore(event.player)) return;
  event.text = Common.format(Common.DATA.messages.welcome, { world: event.worldName });
}

module.exports = function attach(api) {
  api.persistAttribute(Common.ARRIVAL_ATTRIBUTE, 0);
  api.persistAttribute(Common.DIED_DATE_ATTRIBUTE, 0);
  api.persistAttribute(Common.CHOICE_PENDING_ATTRIBUTE, false);
  api.persistAttribute(Common.DEATH_OPTION_ATTRIBUTE, 0);
  api.onPlayerLogin(login);
  api.onCustomEvent("tutorial:completed", tutorialCompleted);
  api.onCustomEvent("welcome-screen:greeting", greeting);
  api.onCustomEvent("interface:closed", designerClosed);
  api.onCustomEvent("ironman:can-open-setup", refuseIronman);
  api.onCustomEvent("ironman:change-mode", refuseIronman);
  api.onCustomEvent("presets:can-use", refusePresets);
  api.onCustomEvent("bots:pvp-allowed", refusePvpBots);
};

Object.assign(module.exports, { login, greeting, tutorialCompleted, designerClosed, refuseIronman, refusePresets, refusePvpBots });
