/**
 * Ultimate Ironmen can't use the bank, and drop all their items when they die (the Ironman tutor:
 * "Ultimate Ironmen are blocked from using the bank, and they drop all their items when they die").
 */
const Common = require("./Common.Ironman");

/** The Wiki's UIM deathpile: an hour of logged-in time (600 ms ticks). */
const DEATHPILE_TICKS = 6000;
/** The ground stacks this login's UIM deaths left, by username, so logout pauses them. */
const deathpiles = new Map();

function pileOf(name) {
  let pile = deathpiles.get(name);
  if (!pile) deathpiles.set(name, pile = new Set());
  return pile;
}

/** One-hour lifetime for a UIM's death drops. */
function dropOptions({ player, options }) {
  if (Common.modeOf(player) !== "ultimate") return;
  options.despawnDelay = DEATHPILE_TICKS;
}

/** Remember the registered stack so its timer can pause with the owner. */
function rememberDrop({ player, groundItem }) {
  if (Common.modeOf(player) !== "ultimate" || !groundItem) return;
  const name = player.getUsername?.();
  if (name) pileOf(name).add(groundItem);
}

function pausePile({ player }) {
  const pile = deathpiles.get(player?.getUsername?.());
  if (pile) for (const item of pile) item.setAgingPaused?.(true);
}

function resumePile({ player }) {
  const pile = deathpiles.get(player?.getUsername?.());
  if (pile) for (const item of pile) item.setAgingPaused?.(false);
}

function forgetTaken({ groundItem }) {
  if (!groundItem) return;
  for (const pile of deathpiles.values()) pile.delete(groundItem);
}

function bank(event) {
  if (Common.modeOf(event.player) !== "ultimate") return;
  event.allow = false;
  event.player.sendMessage(Common.message("ultimateBank"));
}

function keepOnDeath(event) {
  if (Common.modeOf(event.player) === "ultimate") event.keep = false;
}

function packSet(request) {
  if (Common.modeOf(request.player) !== "ultimate") return;
  request.allow = false;
  request.player.sendMessage("Ultimate Ironmen cannot pack item sets.");
}

module.exports = function attach(api) {
  api.onCanBank(bank);
  api.onShouldKeepItemOnDeath(keepOnDeath);
  api.onCustomEvent("item-sets:can-pack", packSet);
  api.onCustomEvent("player-death:drop-options", dropOptions);
  api.onCustomEvent("player-death:dropped", rememberDrop);
  api.onCustomEvent("ground-items:taken", forgetTaken);
  api.onPlayerLogout(pausePile);
  api.onPlayerLogin(resumePile);
};

module.exports._test = { DEATHPILE_TICKS, deathpiles, dropOptions, rememberDrop, pausePile, resumePile, forgetTaken };
