"use strict";

/**
 * Shared state for Shooting Stars: the data file, attribute and config keys, the one star the
 * world has at a time, and small helpers the units share. See docs/shooting-stars.md.
 */

const DATA = require("../data/shooting-stars.json");

/** Player attributes, persisted. The varbits they mirror are re-sent on login. */
const BONUS_DUST_ATTRIBUTE = "shooting-stars:bonus-dust";
const MINED_ATTRIBUTE = "shooting-stars:mined";
const TRADER_MET_ATTRIBUTE = "shooting-stars:trader-met";
const STARS_FOUND_ATTRIBUTE = "shooting-stars:stars-found";

/** world.json pluginConfig keys. */
const INTERVAL_CONFIG = "ShootingStars:intervalMinutes";
const ANNOUNCE_CONFIG = "ShootingStars:announce";

const TICKS_PER_MINUTE = 100;

let api = null;
let core = null;

/**
 * The world's star, or null. While it lands `landingTicks` counts down on the landing loc; after
 * that `object` is the crashed star of `size` and `percent` is the current layer's progress.
 */
const world = {
  star: null,
  lastSiteIndex: -1,
  ticksToLanding: 0,
  tick: 0,
};

function bind(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
}

function sizeEntry(size) {
  return DATA.sizes.find((entry) => entry.size === size) ?? null;
}

function sizeOfLoc(locId) {
  return DATA.sizes.find((entry) => entry.loc === locId)?.size ?? null;
}

function minutesToTicks(minutes) {
  return Math.max(1, Math.round(minutes * TICKS_PER_MINUTE));
}

function intervalMinutes() {
  const configured = Number(api.getPluginConfig(INTERVAL_CONFIG, DATA.intervalMinutes));
  return Number.isFinite(configured) && configured > 0 ? configured : DATA.intervalMinutes;
}

function isMembersWorld() {
  return core.WorldDefinition.isMembersWorld() !== false;
}

/** The star's 2x2 footprint is reachable from any tile next to it. */
function isNextToStar(player, star) {
  const at = player.getLocation();
  const dx = at.getX() - star.x;
  const dy = at.getY() - star.y;
  return at.getZ() === star.z && dx >= -1 && dx <= 2 && dy >= -1 && dy <= 2;
}

function starCentre(star) {
  return new core.Location(star.x + 1, star.y + 1, star.z);
}

function playersNear(star, radius) {
  return [...core.World.getPlayers()].filter(
    (player) => player && player.getLocation().getZ() === star.z
      && Math.abs(player.getLocation().getX() - star.x) <= radius
      && Math.abs(player.getLocation().getY() - star.y) <= radius
  );
}

function areaSound(star, soundId, radius) {
  core.Sounds.playAreaSound({ soundId, x: star.x, y: star.y, level: star.z, radius });
}

/** A message box with "Click here to continue" (captures: chatbox:chatmodal messagebox). */
function mesbox(player, text) {
  player.getDialogueManager().startDialogues(new core.DialogueChainBuilder().add(new core.StatementDialogue(0, text)));
}

function bonusDust(player) {
  const value = Number(player.getAttribute(BONUS_DUST_ATTRIBUTE));
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function setBonusDust(player, value) {
  player.setAttribute(BONUS_DUST_ATTRIBUTE, value > 0 ? value : null);
  player.getPacketSender().sendVarbit(DATA.varbits.bonusDust, Math.max(0, value));
}

function markMined(player) {
  if (player.getAttribute(MINED_ATTRIBUTE) === true) return;
  player.setAttribute(MINED_ATTRIBUTE, true);
  player.getPacketSender().sendVarbit(DATA.varbits.mined, 1);
}

function hasMined(player) {
  return player.getAttribute(MINED_ATTRIBUTE) === true;
}

/** Dusuri's met state; the client turns her into star_trader_2op (with Trade) from it. */
function markTraderMet(player) {
  player.setAttribute(TRADER_MET_ATTRIBUTE, true);
  player.getPacketSender().sendVarbit(DATA.varbits.traderMet, 1);
}

function hasMetTrader(player) {
  return player.getAttribute(TRADER_MET_ATTRIBUTE) === true;
}

/** The persisted varbits go back to the client on login (varps are cleared on logout). */
function restoreVarbits({ player }) {
  const sender = player.getPacketSender();
  if (hasMined(player)) sender.sendVarbit(DATA.varbits.mined, 1);
  if (hasMetTrader(player)) sender.sendVarbit(DATA.varbits.traderMet, 1);
  if (bonusDust(player) > 0) sender.sendVarbit(DATA.varbits.bonusDust, bonusDust(player));
}

/** Mining level for success rolls: visible level plus invisible boosts ("mining:level-boost"). */
function rollMiningLevel(player) {
  const request = { player, boost: 0 };
  api.emitCustomEvent("mining:level-boost", request);
  return player.getSkillManager().getCurrentLevel(core.Skill.MINING) + Math.max(0, Number(request.boost) || 0);
}

/** The best pickaxe the player can use, answered by the Mining plugin. */
function bestPickaxe(player) {
  const request = { player, pickaxe: null };
  api.emitCustomEvent("mining:best-pickaxe", request);
  return request.pickaxe;
}

function persistAttributes(pluginApi) {
  for (const key of [BONUS_DUST_ATTRIBUTE, MINED_ATTRIBUTE, TRADER_MET_ATTRIBUTE, STARS_FOUND_ATTRIBUTE]) {
    pluginApi.persistAttribute(key);
  }
}

module.exports = {
  DATA,
  BONUS_DUST_ATTRIBUTE,
  MINED_ATTRIBUTE,
  TRADER_MET_ATTRIBUTE,
  STARS_FOUND_ATTRIBUTE,
  INTERVAL_CONFIG,
  ANNOUNCE_CONFIG,
  TICKS_PER_MINUTE,
  world,
  bind,
  sizeEntry,
  sizeOfLoc,
  minutesToTicks,
  intervalMinutes,
  isMembersWorld,
  isNextToStar,
  starCentre,
  playersNear,
  areaSound,
  mesbox,
  bonusDust,
  setBonusDust,
  markMined,
  hasMined,
  markTraderMet,
  hasMetTrader,
  restoreVarbits,
  rollMiningLevel,
  bestPickaxe,
  persistAttributes,
  get api() { return api; },
  get core() { return core; },
};
