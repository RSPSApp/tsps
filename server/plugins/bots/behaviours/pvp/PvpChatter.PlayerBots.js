"use strict";

const { randomInRange } = require("../navigation/Navigation.PlayerBots");

const CHATTER_LINES = Object.freeze([
  "Str lvl?", "Strength level?", "Range lvl?", "Range level?", "Prayer lvl?",
  "Pray lvl?", "Prayer Level?", "Noob", "Nice", "Don't tele", "Don't be a noob",
  "Don't run", "Stop", "Wow", "Nice hits", "You call those hits?", "Can you even hit?",
  "You're easy", "Ez", "Easy",
]);
const START_LINES = Object.freeze([
  "Good luck", "GL", "Ready?", "Kk", "Okay", "Ok", "Oh you again?", "Not you again", "Off", "Stop",
]);
const PRAYER_LINES = Object.freeze([
  "Pray off", "Prayer off", "Why u gotta pray?", "Stop praying", "Plz no pray", "Please no pray", "Turn pray off",
]);
const SAFING_LINES = Object.freeze([
  "Safer", "Stop safing", "Why are you safing?", "Don't safe", "Safer noob",
]);
const KILL_LINES = Object.freeze([
  "Ez", "Rekt", "GG", "Gf", "Good fight", "Get dropped", "K0", "koed", "Dropped", "Easy",
]);
const DEATH_LINES = Object.freeze([
  "Nooo", "Nooo!", "Aww", "Dang gg", "What really?", "Lucky hits", "Lucky rng", "You got lucky", "I'll be back",
]);
const CHAT_COOLDOWN_MIN_MS = 9000;
const CHAT_COOLDOWN_MAX_MS = 24000;
const COMBAT_GRACE_MS = 6000;
const OPENING_PRAYER_DELAY_MS = 1800;
// The scheduled task removes ended fights, leaving only active combat to check.
const fights = new Map();
let core;

function isAlive(player) {
  return player?.getHitpoints?.() > 0 && player.isRegistered?.() !== false &&
    player.isDyingReturn?.() !== true && player.isTeleportingReturn?.() !== true;
}

function canChat(player) {
  return player?.isPlayerBot?.() === true && isAlive(player);
}

function hasProtectionPrayer(player) {
  const active = player?.getPrayerActive?.();
  return core.PrayerHandler.PROTECTION_PRAYERS.some(id => active?.[id] === true);
}

function selectChatterLine(lines = CHATTER_LINES) {
  return lines[Math.floor(Math.random() * lines.length)];
}

function chanceLine(lines) {
  return Math.random() < 0.5 ? selectChatterLine(lines) : null;
}

function sayReaction(player, lines) {
  const line = chanceLine(lines);
  if (line) player.forceChat(line);
  return line;
}

function beginFight(player, opponent, nowMs) {
  if (!canChat(player)) return;
  let state = fights.get(player);
  if (!state) {
    state = {
      opponents: new Map(),
      nextChatAt: nowMs + randomInRange(CHAT_COOLDOWN_MIN_MS, CHAT_COOLDOWN_MAX_MS),
    };
    fights.set(player, state);
  }
  const previous = state.opponents.get(opponent);
  if (previous) {
    previous.lastAttackAt = nowMs;
    return;
  }
  const fight = {
    opponent,
    lastAttackAt: nowMs,
    openingPrayer: null,
  };
  state.opponents.set(opponent, fight);
  const greeting = sayReaction(player, START_LINES);
  const prayer = hasProtectionPrayer(opponent) ? chanceLine(PRAYER_LINES) : null;
  // A second forced-chat update in the same tick would hide the greeting.
  if (prayer && greeting) fight.openingPrayer = { line: prayer, at: nowMs + OPENING_PRAYER_DELAY_MS };
  else if (prayer) player.forceChat(prayer);
}

function onAttack({ attacker, target }) {
  if (attacker === target || attacker?.isPlayer?.() !== true || target?.isPlayer?.() !== true ||
      !isAlive(attacker) || !isAlive(target)) return;
  const nowMs = Date.now();
  beginFight(attacker, target, nowMs);
  beginFight(target, attacker, nowMs);
}

function isFighting(player, fight, nowMs) {
  if (!canChat(player) || !isAlive(fight.opponent)) return false;
  const combat = player.getCombat();
  return combat.getTarget() === fight.opponent || combat.getAttacker() === fight.opponent ||
    nowMs - fight.lastAttackAt < COMBAT_GRACE_MS;
}

function fightingBots(player) {
  const nowMs = Date.now();
  return core.World.getNearbyPlayersForUpdate(player).filter(bot => {
    const fight = fights.get(bot)?.opponents.get(player);
    return fight && isFighting(bot, fight, nowMs);
  });
}

function onPrayer({ player, prayerId }) {
  if (!core.PrayerHandler.PROTECTION_PRAYERS.includes(prayerId) || player.getPrayerActive()[prayerId] !== true) return;
  for (const bot of fightingBots(player)) {
    if (sayReaction(bot, PRAYER_LINES)) fights.get(bot).opponents.get(player).openingPrayer = null;
  }
}

function onFood({ player, hitpointsBefore }) {
  const maxHp = player.getSkillManager().getMaxLevel(core.Skill.HITPOINTS);
  if (!Number.isFinite(hitpointsBefore) || maxHp <= 0 || hitpointsBefore * 4 < maxHp * 3) return;
  for (const bot of fightingBots(player)) sayReaction(bot, SAFING_LINES);
}

function onDying({ player, killer }) {
  if (player.isPlayerBot?.() === true) sayReaction(player, DEATH_LINES);
  if (killer !== player && canChat(killer)) sayReaction(killer, KILL_LINES);
  fights.delete(player);
  const state = fights.get(killer);
  if (state) {
    state.opponents.delete(player);
    if (state.opponents.size === 0) fights.delete(killer);
  }
}

function maybeChat({ player }) {
  const state = fights.get(player);
  if (!state) return false;
  const nowMs = Date.now();
  for (const [opponent, fight] of state.opponents) {
    if (!isFighting(player, fight, nowMs)) state.opponents.delete(opponent);
  }
  if (state.opponents.size === 0) {
    fights.delete(player);
    return false;
  }
  for (const fight of state.opponents.values()) {
    if (fight.openingPrayer && nowMs >= fight.openingPrayer.at) {
      const { line } = fight.openingPrayer;
      fight.openingPrayer = null;
      if (hasProtectionPrayer(fight.opponent)) {
        player.forceChat(line);
        return true;
      }
    }
  }
  if (nowMs < state.nextChatAt) return false;
  state.nextChatAt = nowMs + randomInRange(CHAT_COOLDOWN_MIN_MS, CHAT_COOLDOWN_MAX_MS);
  player.forceChat(selectChatterLine());
  return true;
}

function startChatter() {
  core.TaskManager.submit(new (class PvpChatterTask extends core.Task {
    constructor() { super(1); }
    execute() {
      for (const player of fights.keys()) maybeChat({ player });
    }
  })());
}

function registerPvpChatter(api) {
  core = api.core;
  api.onCustomEvent("combat:attack-started", onAttack);
  api.onCustomEvent("prayer:activated", onPrayer);
  api.onCustomEvent("food:eaten", onFood);
  api.onCustomEvent("player:dying", onDying);
  api.onServerStartup(startChatter);
}

module.exports = {
  CHATTER_LINES, START_LINES, PRAYER_LINES, SAFING_LINES, KILL_LINES, DEATH_LINES,
  selectChatterLine, registerPvpChatter,
};
