"use strict";

/**
 * Bounty Hunter targets (https://oldschool.runescape.wiki/w/Bounty_Hunter):
 *
 * - players in the arena are paired with another waiting arena player whose combat level is
 *   from 15 below their own to 5, 10 or 15 above (bh_combat_band, set at the Emblem Trader),
 *   each within the other's range (19 June 2024 update);
 * - a player who died gets no new target for a minute (5 July 2023);
 * - skipping an unskulled target is free; the third skulled skip within 30 minutes blocks
 *   matchmaking for 30 minutes, and the first target kill after that is penalised (halved
 *   points, no emblem - "penalised" on bounty-hunter:target-killed, applied by the Points and
 *   Emblems units). Entering or leaving the arena while blocked, and every 5 minutes, says so;
 * - dying in the lobby counts as skipping the target (25 March 2026);
 * - deaths in the crater emit bounty-hunter:died, plus target-killed or rogue-killed when
 *   another arena player is the killer (the one who dealt the most damage, as core decides).
 *
 * Chat messages have no Wiki source or capture and are our wording.
 */

const Hud = require("./Hud.BountyHunter");
const { band: bandOf } = require("./EmblemTrader.BountyHunter");

const LEVELS_BELOW = 15;
// ponytail: pairing every 3 s; the Wiki gives no cadence.
const MATCH_INTERVAL_TICKS = 5;
const MINUTE_MS = 60_000;
const SKIP_WINDOW_MS = 30 * MINUTE_MS;
const FREE_SKULLED_SKIPS = 2;
const PENALTY_MS = 30 * MINUTE_MS;
const DEATH_COOLDOWN_MS = MINUTE_MS;
const REMINDER_MS = 5 * MINUTE_MS;
const SKIP_BUTTON_UID = (90 << 16) | 16; // pvp_icons:target_skip

const SKULLED_SKIPS_ATTRIBUTE = "bounty-hunter:skulled-skips";
const PENALTY_UNTIL_ATTRIBUTE = "bounty-hunter:penalty-until";
const PENALTY_KILL_ATTRIBUTE = "bounty-hunter:penalty-kill";

/** What the other side of a cleared pair is told; a death is "killed" from their side. */
const PARTNER_REASON = { died: "killed" };
const PARTNER_MESSAGE = {
  skip: "Your target has skipped you. You'll be assigned a new target soon.",
  left: "Your target has left Bounty Hunter. You'll be assigned a new target soon.",
  logout: "Your target has logged out. You'll be assigned a new target soon.",
  killed: "Your target has died. You'll be assigned a new target soon.",
};

let api;
let bh;
const skulledAtDeath = new WeakMap();
const lastReminder = new WeakMap();

// ---------------------------------------------------------------------------
// Rules (pure)
// ---------------------------------------------------------------------------

function inRange(level, other, band) {
  return other >= level - LEVELS_BELOW && other <= level + band;
}

function canPair(a, b, levelOf, bandOf) {
  return inRange(levelOf(a), levelOf(b), bandOf(a)) && inRange(levelOf(b), levelOf(a), bandOf(b));
}

/**
 * Pairs waiting players, longest waiting first, each with the first one after them they suit.
 * ponytail: O(n^2) over the unpaired arena players; bucket by level if a crater ever holds hundreds.
 */
function matchPairs(waiting, { levelOf, bandOf, avoids }) {
  const pairs = [];
  const taken = new Set();
  for (let i = 0; i < waiting.length; i++) {
    const a = waiting[i];
    if (taken.has(a)) continue;
    for (let j = i + 1; j < waiting.length; j++) {
      const b = waiting[j];
      if (taken.has(b) || avoids(a, b) || !canPair(a, b, levelOf, bandOf)) continue;
      pairs.push([a, b]);
      taken.add(a);
      taken.add(b);
      break;
    }
  }
  return pairs;
}

/** Skulled skips still inside the 30-minute window. */
function recentSkips(history, now) {
  return (Array.isArray(history) ? history : []).filter((at) => now - at < SKIP_WINDOW_MS);
}

/**
 * A skip's outcome: the skip history to keep and whether it starts the 30-minute block.
 * Unskulled targets cost nothing (1 June 2023).
 */
function skipOutcome(history, now, skulledTarget) {
  if (!skulledTarget) return { history: recentSkips(history, now), blocks: false };
  const recent = recentSkips(history, now);
  if (recent.length >= FREE_SKULLED_SKIPS) return { history: [], blocks: true };
  return { history: [...recent, now], blocks: false };
}

// ---------------------------------------------------------------------------
// Player state
// ---------------------------------------------------------------------------

function levelOf(player) {
  return player.getSkillManager().getCombatLevel();
}

function avoids(a, b) {
  return bh.skipped.get(a) === b || bh.skipped.get(b) === a;
}

function penaltyLeftMs(player, now = Date.now()) {
  return Math.max(0, (Number(player.getAttribute(PENALTY_UNTIL_ATTRIBUTE)) || 0) - now);
}

function waitingForTarget(player, now) {
  return !bh.targets.has(player)
    && player.isRegistered?.() !== false
    && player.isDyingReturn?.() !== true
    && penaltyLeftMs(player, now) === 0
    && now >= (bh.noTargetUntil.get(player) ?? 0);
}

/** The block's chat line, on entering or leaving the arena and every 5 minutes inside. */
function remindPenalty(player, now = Date.now()) {
  const left = penaltyLeftMs(player, now);
  if (left === 0) return;
  lastReminder.set(player, now);
  const minutes = Math.ceil(left / MINUTE_MS);
  player.sendMessage(`<col=ef1020>You skipped too many targets and won't be assigned a new one for ${minutes} minute${minutes === 1 ? "" : "s"}.</col>`);
}

/** The first target kill after a block ends is the penalised one. */
function takePenalisedKill(player) {
  if (player.getAttribute(PENALTY_KILL_ATTRIBUTE) !== true || penaltyLeftMs(player) > 0) return false;
  player.setAttribute(PENALTY_KILL_ATTRIBUTE, false);
  return true;
}

// ---------------------------------------------------------------------------
// Pairs
// ---------------------------------------------------------------------------

function assign(a, b) {
  for (const [player, target] of [[a, b], [b, a]]) {
    bh.targets.set(player, target);
    bh.skipped.delete(player);
    bh.lobbyTicks.set(player, 0);
    Hud.sendLobbyTimer(player, 0);
    player.sendMessage(`You have been assigned a target: ${target.getDisplayName()}.`);
  }
  for (const [player, target] of [[a, b], [b, a]]) {
    api.emitCustomEvent("bounty-hunter:target-assigned", { player, target });
    Hud.sync(player);
  }
}

/** Ends `player`'s pair; reason is "skip", "left", "logout" or "died", from their side. */
function clearTarget(player, reason) {
  const target = bh.targets.get(player);
  if (!target) return;
  bh.targets.delete(player);
  if (bh.targets.get(target) === player) bh.targets.delete(target);
  const partnerReason = PARTNER_REASON[reason] ?? reason;
  api.emitCustomEvent("bounty-hunter:target-cleared", { player, reason });
  api.emitCustomEvent("bounty-hunter:target-cleared", { player: target, reason: partnerReason });
  target.sendMessage(PARTNER_MESSAGE[partnerReason]);
  Hud.sync(target);
  if (reason !== "logout") Hud.sync(player);
}

function skip(player) {
  const target = bh.targetOf(player);
  if (!target) return;
  const now = Date.now();
  const outcome = skipOutcome(player.getAttribute(SKULLED_SKIPS_ATTRIBUTE), now, target.isSkulled());
  player.setAttribute(SKULLED_SKIPS_ATTRIBUTE, outcome.history);
  bh.skipped.set(player, target);
  clearTarget(player, "skip");
  if (outcome.blocks) {
    player.setAttribute(PENALTY_UNTIL_ATTRIBUTE, now + PENALTY_MS);
    player.setAttribute(PENALTY_KILL_ATTRIBUTE, true);
    remindPenalty(player, now);
  } else {
    player.sendMessage("You have skipped your target.");
  }
}

/** pvp_icons' Skip button; the skip that would start the block asks first (7 June 2023). */
function skipButton({ player }) {
  const target = bh.targetOf(player);
  if (!target) return;
  if (!target.isSkulled() || recentSkips(player.getAttribute(SKULLED_SKIPS_ATTRIBUTE), Date.now()).length < FREE_SKULLED_SKIPS) {
    skip(player);
    return;
  }
  api.sendMultiChatboxPrompt(player, "Skip? You'll get no new target for 30 minutes.",
    "Yes, skip my target.", () => skip(player),
    "No, keep my target.", () => {});
}

function matchTick() {
  if (bh.arena.size === 0) return;
  const now = Date.now();
  const waiting = [...bh.arena].filter((player) => waitingForTarget(player, now));
  for (const [a, b] of matchPairs(waiting, { levelOf, bandOf, avoids })) assign(a, b);
  for (const player of bh.arena) {
    if (now - (lastReminder.get(player) ?? 0) >= REMINDER_MS) remindPenalty(player, now);
  }
}

function startMatching() {
  const { Task, TaskManager } = api.core;
  TaskManager.submit(new (class extends Task {
    constructor() {
      super(MATCH_INTERVAL_TICKS, false);
    }

    execute() {
      matchTick();
    }
  })());
}

// ---------------------------------------------------------------------------
// Deaths
// ---------------------------------------------------------------------------

/** Death resets the skull before the defeat hook runs, so it is read here. */
function rememberSkull({ player }) {
  if (bh.inCrater(player)) skulledAtDeath.set(player, player.isSkulled());
}

function defeated({ killer, victim }) {
  if (!victim?.isPlayer?.() || !bh.inCrater(victim)) return;
  const skulled = skulledAtDeath.get(victim) === true;
  skulledAtDeath.delete(victim);
  if (bh.inLobby(victim)) {
    skip(victim);
    api.emitCustomEvent("bounty-hunter:died", { player: victim, killer: null, skulled });
    return;
  }
  const by = killer && killer !== victim && bh.inArena(killer) ? killer : null;
  if (by && bh.targetOf(by) === victim) {
    api.emitCustomEvent("bounty-hunter:target-killed", {
      killer: by, victim, skulledVictim: skulled, killerSkulled: by.isSkulled(), penalised: takePenalisedKill(by),
    });
  } else if (by) {
    api.emitCustomEvent("bounty-hunter:rogue-killed", { killer: by, victim });
  }
  api.emitCustomEvent("bounty-hunter:died", { player: victim, killer: by, skulled });
  bh.noTargetUntil.set(victim, Date.now() + DEATH_COOLDOWN_MS);
  clearTarget(victim, "died");
}

function answerHasTarget(request) {
  if (request?.player) request.target = bh.targetOf(request.player);
}

module.exports = function attachTargets(pluginApi, state) {
  api = pluginApi;
  bh = state;
  api.persistAttribute(SKULLED_SKIPS_ATTRIBUTE, []);
  api.persistAttribute(PENALTY_UNTIL_ATTRIBUTE, 0);
  api.persistAttribute(PENALTY_KILL_ATTRIBUTE, false);
  api.onServerStartup(startMatching);
  api.onInterfaceActionButton(SKIP_BUTTON_UID, skipButton);
  api.onPlayerBeforeDeath(rememberSkull);
  api.onPlayerDefeated(defeated);
  api.onCustomEvent("bounty-hunter:has-target", answerHasTarget);
};

Object.assign(module.exports, {
  clearTarget,
  remindPenalty,
  _test: { inRange, canPair, matchPairs, recentSkips, skipOutcome, matchTick, defeated, skip, SKIP_WINDOW_MS, FREE_SKULLED_SKIPS },
});
