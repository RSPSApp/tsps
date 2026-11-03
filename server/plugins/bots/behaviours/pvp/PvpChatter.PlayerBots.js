"use strict";

const { randomInRange } = require("../navigation/Navigation.PlayerBots");

const MELEE_QUESTIONS = Object.freeze(["Str lvl?", "Strength level?"]);
const RANGED_QUESTIONS = Object.freeze(["Range lvl?", "Range level?"]);
const CHATTER_LINES = Object.freeze([
  ...MELEE_QUESTIONS, ...RANGED_QUESTIONS, "Prayer lvl?",
  "Pray lvl?", "Prayer Level?", "Noob", "Nice", "Don't tele", "Don't be a noob",
  "Don't run", "Stop", "Wow", "Nice hits", "You call those hits?", "Can you even hit?",
  "You're easy", "Ez", "Easy",
  "Nice spec", "???", "Not even close", "My nan hits harder", "You're shaking",
  "Is this your first time in Wildy?", "My nan clicks faster", "GF bank", "Watch this switch", "Misclick?",
  "Tank test lol", "Free kit", "I'm sleeping", "Waste of my supply", "You are clicking all over the place",
  "1-tick incoming", "Outplayed", "Fake out", "Bad pathing",
]);
const START_LINES = Object.freeze([
  "Good luck", "GL", "Ready?", "Kk", "Okay", "Ok", "Oh you again?", "Not you again", "Off", "Stop",
  "Risk?", "Free loot lol", "Don't spec and run",
]);
const PRAYER_LINES = Object.freeze([
  "Pray off", "Prayer off", "Why u gotta pray?", "Stop praying", "Plz no pray", "Please no pray", "Turn pray off",
  "Nice camping overheads", "Are you hitting through my prayer??",
]);
const SAFING_LINES = Object.freeze([
  "Safer", "Stop safing", "Why are you safing?", "Don't safe", "Safer noob",
  "Are you out of brews already?", "Panic eating",
]);
const KILL_LINES = Object.freeze([
  "Ez", "Rekt", "GG", "Gf", "Good fight", "Get dropped", "K0", "koed", "Dropped", "Easy",
  "Ty for bank", "Sit kid", "Back to lumby", "Easiest fight of my life", "Cya", "Don't come back",
  "Pleae",
]);
const DEATH_LINES = Object.freeze([
  "Nooo", "Nooo!", "Aww", "Dang gg", "What really?", "Lucky hits", "Lucky rng", "You got lucky", "I'll be back",
  "Reported for macro", "Enjoy the 50k", "whatever", "sure",
  "My mouse disconnected", "Nice team...",
]);
const RNG_SPLASH_LINE = "Nice splash";
const RNG_ZERO_LINE = "0-0-0-0 nice RNG";
const RNG_LINES = Object.freeze([
  RNG_ZERO_LINE, "Rambo me then", "Max hit incoming", RNG_SPLASH_LINE,
  "Stop hitting 0s and fight", "Vengeance ready", "Tick ate that",
]);
const LINE_CATEGORIES = Object.freeze({
  chatter: CHATTER_LINES, start: START_LINES, prayer: PRAYER_LINES, safing: SAFING_LINES,
  kill: KILL_LINES, death: DEATH_LINES, rng: RNG_LINES,
});
const CHAT_COOLDOWN_MIN_MS = 15000;
const CHAT_COOLDOWN_MAX_MS = 30000;
const COMBAT_GRACE_MS = 6000;
const OPENING_PRAYER_DELAY_MS = 1800;
const MESSAGE_OFFSET_MS = 1000;
// The scheduled task removes ended fights, leaving only active combat to check.
const fights = new Map();
const lastMessages = new WeakMap();
let pendingMessages = [];
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

function getRandomLine(category, data = {}) {
  if (category === "rng") {
    if (data?.isSplash === true) return RNG_SPLASH_LINE;
    if (data?.isZero === true) return RNG_ZERO_LINE;
  }
  const lines = LINE_CATEGORIES[category];
  return Array.isArray(lines) ? selectChatterLine(lines) : null;
}

function chatterLinesFor(player) {
  const opponents = fights.get(player).opponents;
  const combat = player.getCombat();
  const opponent = [combat.getTarget(), combat.getAttacker(), ...opponents.keys()].find(candidate => {
    const fight = opponents.get(candidate);
    return fight && isFighting(player, fight, Date.now());
  });
  const type = opponent ? core.CombatFactory.getMethod(opponent)?.type() : null;
  return CHATTER_LINES.filter(line =>
    (!MELEE_QUESTIONS.includes(line) || type === core.CombatType.MELEE) &&
    (!RANGED_QUESTIONS.includes(line) || type === core.CombatType.RANGED));
}

function chanceLine(category) {
  return Math.random() < 0.5 ? getRandomLine(category) : null;
}

function deliverMessage(message, nowMs) {
  const after = message.after;
  if (after?.sentAt === null && after.player.isRegistered?.() !== false && after.player.getHitpoints() <= 0) return false;
  if (after?.sentAt != null && nowMs < after.sentAt + MESSAGE_OFFSET_MS) return false;
  if (message.participants.some(participant => {
    const last = lastMessages.get(participant);
    return last && last.player !== message.player && nowMs < last.at + MESSAGE_OFFSET_MS;
  })) return false;
  // Random lines are rolled at delivery so a queued question follows weapon switches.
  message.player.forceChat(message.line ?? selectChatterLine(chatterLinesFor(message.player)));
  message.sentAt = nowMs;
  for (const participant of message.participants) lastMessages.set(participant, { player: message.player, at: nowMs });
  message.onSent?.(nowMs);
  return true;
}

function sendMessage(player, line, options = {}) {
  const state = fights.get(player);
  const message = { player, line, state, sentAt: null, ...options,
    participants: [...new Set([player, ...(state?.opponents.keys() ?? []), options.opponent].filter(Boolean))] };
  if (!deliverMessage(message, Date.now())) {
    if (options.death) pendingMessages.unshift(message);
    else pendingMessages.push(message);
  }
  return message;
}

function processPendingMessages() {
  const nowMs = Date.now();
  pendingMessages = pendingMessages.filter(message => {
    const { player, state, opponent, death, kill, protection } = message;
    if (death) {
      if (player.isRegistered?.() === false || player.getHitpoints() > 0) return false;
    } else {
      if (!canChat(player)) return false;
      if (!kill && (fights.get(player) !== state ||
          ![...(state?.opponents.values() ?? [])].some(fight => isFighting(player, fight, nowMs)))) return false;
      if (!kill && opponent && (!state.opponents.has(opponent) ||
          !isFighting(player, state.opponents.get(opponent), nowMs))) return false;
      if (protection && !hasProtectionPrayer(opponent)) return false;
    }
    return !deliverMessage(message, nowMs);
  });
}

function sayReaction(player, category, options) {
  const line = chanceLine(category);
  return line ? sendMessage(player, line, options) : null;
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
  const greeting = sayReaction(player, "start", { opponent });
  const prayer = hasProtectionPrayer(opponent) ? chanceLine("prayer") : null;
  // A second forced-chat update in the same tick would hide the greeting.
  if (prayer && greeting) fight.openingPrayer = { line: prayer, greeting };
  else if (prayer) sendMessage(player, prayer, { opponent, protection: true });
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
    if (sayReaction(bot, "prayer", { opponent: player, protection: true })) fights.get(bot).opponents.get(player).openingPrayer = null;
  }
}

function onFood({ player, hitpointsBefore }) {
  const maxHp = player.getSkillManager().getMaxLevel(core.Skill.HITPOINTS);
  if (!Number.isFinite(hitpointsBefore) || maxHp <= 0 || hitpointsBefore * 4 < maxHp * 3) return;
  for (const bot of fightingBots(player)) sayReaction(bot, "safing", { opponent: player });
}

function onDying({ player, killer }) {
  pendingMessages = pendingMessages.filter(message => message.player !== player);
  const deathMessage = player.isPlayerBot?.() === true
    ? sayReaction(player, "death", { opponent: killer, death: true }) : null;
  if (killer !== player && canChat(killer)) sayReaction(killer, "kill", { opponent: player, kill: true, after: deathMessage });
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
    if (fight.openingPrayer?.greeting.sentAt != null &&
        nowMs >= fight.openingPrayer.greeting.sentAt + OPENING_PRAYER_DELAY_MS) {
      const { line } = fight.openingPrayer;
      fight.openingPrayer = null;
      if (hasProtectionPrayer(fight.opponent)) {
        sendMessage(player, line, { opponent: fight.opponent, protection: true });
        return true;
      }
    }
  }
  if (nowMs < state.nextChatAt) return false;
  state.nextChatAt = Infinity;
  sendMessage(player, null, {
    onSent: at => { state.nextChatAt = at + randomInRange(CHAT_COOLDOWN_MIN_MS, CHAT_COOLDOWN_MAX_MS); },
  });
  return true;
}

function startChatter() {
  core.TaskManager.submit(new (class PvpChatterTask extends core.Task {
    constructor() { super(1); }
    execute() {
      processPendingMessages();
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
  CHATTER_LINES, START_LINES, PRAYER_LINES, SAFING_LINES, KILL_LINES, DEATH_LINES, RNG_LINES,
  getRandomLine, selectChatterLine, registerPvpChatter,
};
