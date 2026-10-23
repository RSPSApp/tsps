"use strict";

/**
 * What a player keeps between games: the rifts closed (varp total_gotr_kills), the elemental and
 * catalytic energy banked for the Rewards Guardian ("Total elemental energy" in the end-of-game
 * messages), the times they've searched the rift, and the permanent gotr_perm_0 settings
 * (talisman toggles, the colourful fade, the needle and Cordelia's contact).
 *
 * Varps aren't saved here, so each one is an attribute re-sent at login.
 */

const Shared = require("./Shared.GuardiansOfTheRift");

const RIFTS_CLOSED_ATTRIBUTE = "guardians-of-the-rift:rifts-closed";
const ELEMENTAL_POINTS_ATTRIBUTE = "guardians-of-the-rift:elemental-points";
const CATALYTIC_POINTS_ATTRIBUTE = "guardians-of-the-rift:catalytic-points";
const SEARCHES_ATTRIBUTE = "guardians-of-the-rift:searches";
/** Permanent varbits by gameval name. */
const SETTINGS_ATTRIBUTE = "guardians-of-the-rift:settings";

function number(player, key) {
  return Math.max(0, Math.trunc(Number(player.getAttribute(key)) || 0));
}

function riftsClosed(player) {
  return number(player, RIFTS_CLOSED_ATTRIBUTE);
}

function addRiftClosed(player) {
  const closed = riftsClosed(player) + 1;
  player.setAttribute(RIFTS_CLOSED_ATTRIBUTE, closed);
  Shared.setVarp(player, Shared.VARP.RIFTS_CLOSED, closed);
  return closed;
}

function points(player) {
  return { elemental: number(player, ELEMENTAL_POINTS_ATTRIBUTE), catalytic: number(player, CATALYTIC_POINTS_ATTRIBUTE) };
}

function setPoints(player, elemental, catalytic) {
  player.setAttribute(ELEMENTAL_POINTS_ATTRIBUTE, Math.max(0, elemental));
  player.setAttribute(CATALYTIC_POINTS_ATTRIBUTE, Math.max(0, catalytic));
}

function searches(player) {
  return number(player, SEARCHES_ATTRIBUTE);
}

function addSearches(player, count) {
  player.setAttribute(SEARCHES_ATTRIBUTE, searches(player) + count);
}

function settings(player) {
  const value = player.getAttribute(SETTINGS_ATTRIBUTE);
  return value && typeof value === "object" ? value : {};
}

function setting(player, varbit) {
  return Number(settings(player)[varbit]) || 0;
}

function setSetting(player, varbit, value) {
  const next = { ...settings(player) };
  if (value) next[varbit] = value;
  else delete next[varbit];
  player.setAttribute(SETTINGS_ATTRIBUTE, next);
  Shared.setVarbit(player, varbit, value);
}

function login({ player }) {
  Shared.setVarp(player, Shared.VARP.RIFTS_CLOSED, riftsClosed(player));
  for (const [varbit, value] of Object.entries(settings(player))) Shared.setVarbit(player, varbit, Number(value) || 0);
}

module.exports = {
  RIFTS_CLOSED_ATTRIBUTE, ELEMENTAL_POINTS_ATTRIBUTE, CATALYTIC_POINTS_ATTRIBUTE, SEARCHES_ATTRIBUTE, SETTINGS_ATTRIBUTE,
  riftsClosed, addRiftClosed, points, setPoints, searches, addSearches, setting, setSetting,
  attach(api) {
    api.persistAttribute(RIFTS_CLOSED_ATTRIBUTE, 0);
    api.persistAttribute(ELEMENTAL_POINTS_ATTRIBUTE, 0);
    api.persistAttribute(CATALYTIC_POINTS_ATTRIBUTE, 0);
    api.persistAttribute(SEARCHES_ATTRIBUTE, 0);
    api.persistAttribute(SETTINGS_ATTRIBUTE, {});
    api.onPlayerLogin(login);
  },
};
