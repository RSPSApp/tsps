"use strict";

const data = require("./Data.BarbarianAssault");

const LEGACY_HONOUR_ATTRIBUTE = "barbarian-assault:honour";
const QUEEN_KILLED_ATTRIBUTE = "barbarian-assault:queen-killed";
const HIGH_GAMBLE_COUNT_ATTRIBUTE = "barbarian-assault:high-gambles";
const LAST_ROLE_ATTRIBUTE = "barbarian-assault:last-role";

const QUEEN_KILL_HONOUR = 80;
const HIGH_GAMBLE_COST = 500;
const HIGH_GAMBLE_STEPS = new Set(["nlmkHE", "_is7KI", "WwL0Zn"]);
const PENANCE_PET_ITEM_ID = 12703;
const PET_CHANCE = 1 / 1000;

let api = null;
let core = null;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Math.trunc(Number(value) || 0)));
}

function count(player, key, fallback = 0) {
  const value = Number(player?.getAttribute?.(key));
  return Number.isFinite(value) ? value : fallback;
}

function honourOf(player) {
  return Math.max(0, Math.trunc(Number(player?.getAttribute?.(LEGACY_HONOUR_ATTRIBUTE)) || 0));
}

function setHonour(player, value) {
  player?.setAttribute?.(LEGACY_HONOUR_ATTRIBUTE, Math.max(0, Math.trunc(value)));
}

function points(player, role) {
  return clamp(player?.getAttribute?.(data.ATTRIBUTE.POINTS[role]), 0, data.MAX_HONOUR_PER_ROLE);
}

function setPoints(player, role, value) {
  if (!player || !data.ATTRIBUTE.POINTS[role]) return;
  player.setAttribute(data.ATTRIBUTE.POINTS[role], clamp(value, 0, data.MAX_HONOUR_PER_ROLE));
  syncPoints(player, role);
}

function addPoints(player, role, value) {
  if (!player || !data.ATTRIBUTE.POINTS[role]) return 0;
  const before = points(player, role);
  const after = clamp(before + Math.trunc(value), 0, data.MAX_HONOUR_PER_ROLE);
  setPoints(player, role, after);
  return after - before;
}

function level(player, role) {
  return clamp(player?.getAttribute?.(data.ATTRIBUTE.LEVEL[role]), 1, 5) || 1;
}

function setLevel(player, role, value) {
  if (!player || !data.ATTRIBUTE.LEVEL[role]) return;
  player.setAttribute(data.ATTRIBUTE.LEVEL[role], clamp(value, 1, 5));
  sendVarbit(player, data.VARBIT.LEVEL[role], level(player, role));
}

function upgradeCost(player, role) {
  const current = level(player, role);
  return current >= 5 ? null : data.LEVEL_COSTS[current - 1];
}

function upgradeRole(player, role) {
  const cost = upgradeCost(player, role);
  if (cost == null) {
    player.sendMessage(`Your ${data.ROLE_LABEL[role]} level is already 5.`);
    return false;
  }
  if (points(player, role) < cost) {
    player.sendMessage(`You need ${cost} Honour Points in the ${data.ROLE_LABEL[role]} role to upgrade.`);
    return false;
  }
  addPoints(player, role, -cost);
  setLevel(player, role, level(player, role) + 1);
  player.sendMessage(`Your ${data.ROLE_LABEL[role]} level is now ${level(player, role)}.`);
  return true;
}

function allRoleMinimum(player) {
  return Math.min(...data.ROLES.map((role) => points(player, role)));
}

function addToAllRoles(player, value) {
  for (const role of data.ROLES) addPoints(player, role, value);
}

function removeFromAllRoles(player, value) {
  const amount = Math.max(0, Math.trunc(value));
  if (amount <= 0) return true;
  if (allRoleMinimum(player) < amount) return false;
  for (const role of data.ROLES) addPoints(player, role, -amount);
  return true;
}

function queenKills(player) {
  return Math.max(0, Math.trunc(count(player, data.ATTRIBUTE.QUEEN_KILLS)));
}

function queenKilled(player) {
  return player?.getAttribute?.(QUEEN_KILLED_ATTRIBUTE) === true || queenKills(player) > 0;
}

function setQueenKilled(player, value) {
  player?.setAttribute?.(QUEEN_KILLED_ATTRIBUTE, value === true);
}

function recordQueenKill(player, { legacyHonour = true } = {}) {
  if (!player) return false;
  setQueenKilled(player, true);
  player.setAttribute(data.ATTRIBUTE.QUEEN_KILLS, queenKills(player) + 1);
  if (legacyHonour) setHonour(player, honourOf(player) + QUEEN_KILL_HONOUR);
  sync(player);
  return true;
}

/** Adds one wave's role reward and mirrors the change to the client varbits. */
function award(player, role, amount) {
  if (!player || !data.ROLE_LABEL[role]) return 0;
  player.setAttribute(LAST_ROLE_ATTRIBUTE, role);
  const gained = addPoints(player, role, amount);
  setHonour(player, honourOf(player) + Math.max(0, gained));
  return gained;
}

/** Wave 10: 80 in the player's role and 5 in each other role. */
function awardQueen(player, role) {
  const gains = {};
  for (const other of data.ROLES) {
    const amount = other === role ? 80 : 5;
    gains[other] = award(player, other, amount);
  }
  player.setAttribute(LAST_ROLE_ATTRIBUTE, role);
  return gains;
}

function syncPoints(player, role) {
  if (!player || !data.VARBIT.POINTS[role]) return;
  sendVarbit(player, data.VARBIT.POINTS[role], points(player, role));
}

function sendVarbit(player, varbit, value) {
  try {
    player?.getPacketSender?.()?.sendVarbit?.(varbit, value);
  } catch {
    // A player without a session (lobby/test) has no sender.
  }
}

function sync(player) {
  if (!player) return;
  for (const role of data.ROLES) {
    sendVarbit(player, data.VARBIT.POINTS[role], points(player, role));
    sendVarbit(player, data.VARBIT.LEVEL[role], level(player, role));
  }
  sendVarbit(player, data.VARBIT.QUEEN_KILLS, queenKills(player));
  sendVarbit(player, data.VARBIT.GAMBLE_COUNT, Math.max(0, count(player, HIGH_GAMBLE_COUNT_ATTRIBUTE)));
}

function addLegacyHonour(request) {
  const player = request?.player;
  const amount = Number(request?.points ?? request?.amount);
  if (!player || !Number.isFinite(amount) || amount === 0) return;
  setHonour(player, honourOf(player) + Math.trunc(amount));
  const lastRole = player.getAttribute?.(LAST_ROLE_ATTRIBUTE);
  if (data.ROLE_LABEL[lastRole]) addPoints(player, lastRole, amount);
}

function queenDied({ npc, killer }) {
  if (!killer || npc?.getId?.() !== core?.NpcIdentifiers?.PENANCE_QUEEN) return;
  // The match emits the kill for every member so the role bonus and the legacy
  // gamble flag are paid once; only an unrelated queen death uses this hook.
  if (npc?.__baType === "queen") return;
  recordQueenKill(killer);
}

function queenKillRequest(request) {
  if (!request || request.handled) return;
  recordQueenKill(request.player);
  request.handled = true;
}

function highGamble(player, random = Math.random) {
  if (!player) return { allowed: false, reason: "player", pet: false, awarded: false };
  if (!queenKilled(player)) {
    player.sendMessage?.("You need to defeat the Penance Queen before you can take a high gamble, soldier.");
    return { allowed: false, reason: "queen", pet: false, awarded: false };
  }
  if (honourOf(player) < HIGH_GAMBLE_COST) {
    player.sendMessage?.(`You need ${HIGH_GAMBLE_COST} Honour Points for a high gamble.`);
    return { allowed: false, reason: "points", pet: false, awarded: false };
  }

  setHonour(player, honourOf(player) - HIGH_GAMBLE_COST);
  player.setAttribute?.(HIGH_GAMBLE_COUNT_ATTRIBUTE, count(player, HIGH_GAMBLE_COUNT_ATTRIBUTE) + 1);
  sync(player);

  const won = random() < PET_CHANCE;
  const request = { player, itemId: PENANCE_PET_ITEM_ID, source: "barbarian-assault:high-gamble", awarded: false };
  if (won) api.emitCustomEvent("pets:award", request);
  return { allowed: true, pet: won, awarded: request.awarded === true };
}

function highGambleRequest(request) {
  if (!request || request.handled) return;
  request.result = highGamble(request.player);
  request.handled = true;
}

function highGambleDialogue(request) {
  if (!request || request.npcId !== core?.NpcIdentifiers?.COMMANDER_CONNAD || !HIGH_GAMBLE_STEPS.has(request.stepId)) return;
  request.handled = true;
  request.end = true;
  highGamble(request.player);
}

function highGambleOption(event) {
  if (!event || event.handled) return;
  highGamble(event.player);
  event.handled = true;
}

const roleCurrency = {
  name: "Honour Points",
  amount: allRoleMinimum,
  add: addToAllRoles,
  remove: removeFromAllRoles,
};

function attach(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
  pluginApi.persistAttribute(LEGACY_HONOUR_ATTRIBUTE, 0);
  pluginApi.persistAttribute(QUEEN_KILLED_ATTRIBUTE, false);
  pluginApi.persistAttribute(HIGH_GAMBLE_COUNT_ATTRIBUTE, 0);
  pluginApi.persistAttribute(LAST_ROLE_ATTRIBUTE, "");
  for (const role of data.ROLES) {
    pluginApi.persistAttribute(data.ATTRIBUTE.POINTS[role], 0);
    pluginApi.persistAttribute(data.ATTRIBUTE.LEVEL[role], 1);
  }
  pluginApi.persistAttribute(data.ATTRIBUTE.QUEEN_KILLS, 0);
  pluginApi.registerShopCurrency?.("HONOUR POINTS", roleCurrency);
  pluginApi.onPlayerLogin?.(({ player }) => sync(player));
  pluginApi.onCustomEvent?.("barbarian-assault:honour", addLegacyHonour);
  pluginApi.onCustomEvent?.("barbarian-assault:queen-kill", queenKillRequest);
  pluginApi.onCustomEvent?.("barbarian-assault:gamble-high", highGambleRequest);
  pluginApi.onCustomEvent?.("npc-dialogue:action", highGambleDialogue);
  pluginApi.onNpcInteraction?.("Commander Connad", { Gamble: highGambleOption });
  pluginApi.onNpcDeath?.(queenDied);
}

module.exports = {
  LEGACY_HONOUR_ATTRIBUTE, QUEEN_KILLED_ATTRIBUTE, HIGH_GAMBLE_COUNT_ATTRIBUTE,
  QUEEN_KILL_HONOUR, HIGH_GAMBLE_COST, PENANCE_PET_ITEM_ID, PET_CHANCE,
  honourOf, setHonour, points, setPoints, addPoints, level, setLevel,
  upgradeCost, upgradeRole, allRoleMinimum, addToAllRoles, removeFromAllRoles,
  queenKills, queenKilled, setQueenKilled, recordQueenKill, award, awardQueen,
  sync, roleCurrency, highGamble, attach,
  _test: { HIGH_GAMBLE_STEPS, addLegacyHonour, queenDied },
};
