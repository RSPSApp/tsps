"use strict";

/**
 * Bounty Hunter bots populate the crater when a real player enters the lobby. They use the
 * PlayerBots runtime's own PvP bots on its "pvp" brain activity, so they fight exactly as
 * they do in the Wilderness (specs, switches, prayers, freezes, eating, retaliation); this
 * unit only adds what Bounty Hunter needs on top:
 *
 *   - a funded coffer and a skull, restored after each death;
 *   - the crater's matchmaking picks their fights: an assigned target becomes the bot's PvP
 *     target and the bot runs across the arena to it (the engine's own Wilderness seek finds
 *     nothing here);
 *   - with no target they go rogue on the nearest player they may attack, bot or not;
 *   - they respawn at their sigil (the runtime's respawn resolver keeps the spawn tile) and
 *     log out when the last real player leaves the crater.
 */

const { getActiveBotRuntime } = require("../../bots/runtime/RuntimeRegistry.PlayerBots");
const { startActivity } = require("../../bots/brain/BrainActivities.PlayerBots");
const { setModePvp } = require("../../bots/behaviours/state/State.PlayerBots");
const { clearMovementRequest, queueRouteAndFlagAppearance } = require("../../bots/behaviours/navigation/Navigation.PlayerBots");
const { getPvpProfile } = require("../../bots/behaviours/pvp/PvpProfileRegistry.PlayerBots");
const { applyGeneratedPvpLoadout } = require("../../bots/behaviours/policies/PvpLoadoutPolicy.PlayerBots");
const { buildRoamingPvpMetadata } = require("../../bots/behaviours/pvp/PvpAssignment.PlayerBots");
const { initPvpTierLoadouts, buildStyle, pickTierChoice, tierCombatLevel, TIER_PROFILE_IDS } = require("../../bots/behaviours/pvp/PvpTierLoadouts.PlayerBots");
const { isFoodItem } = require("../../items/Food.plugin");
const Entry = require("./Entry.BountyHunter");
const Coffer = require("./Coffer.BountyHunter");

const MAX_BOTS = 60;
const BOT_BANDS = [
  { min: 32, max: 80, tier: "novice" },
  { min: 81, max: 100, tier: "intermediate" },
  { min: 101, max: 110, tier: "veteran" },
  { min: 111, max: 120, tier: "veteran" },
  { min: 121, max: 126, tier: "veteran" },
];
// No protection prayers in the arena, so tanks and spec rushers fight as well as switchers.
// ponytail: our estimate of the crater's mix; no published figure exists. Each band keeps it.
const STYLE_WEIGHTS = { melee: 45, range: 30, hybrid: 25 };
const BOT_ATTRIBUTE = "bounty-hunter:bot";
const PVP_ACTIVITY = "pvp";
const TARGET_HOLD_MS = 30 * 60 * 1000; // the target is the crater's to clear, not the engine's timer
const ROGUE_HOLD_MS = 2 * 60 * 1000; // the engine extends it while the fight goes on
const DECIDE_MS = 1800;
const ENGAGE_DISTANCE = 12; // closer than this, the engine's own combat pathing takes over
const CHASE_STEP = 20; // tiles per walk order towards a far quarry
const WANDER_RADIUS = 8;
const RETREAT_FOOD_RESERVE = 6;

let api;
let core;
let bh;

/** The live bot players. */
const bots = new Set();
const botBands = new WeakMap();
const botStyles = new WeakMap();
/** Numbers each spawn: bots despawned a moment ago may still be online under their names. */
let spawnedBots = 0;
let populationTarget = 0;
const nextDecisionAt = new WeakMap();
/** One fight-or-flee decision for each low-food episode; a committed flee lasts until logout. */
const retreatDecisions = new WeakMap();

function isBot(player) {
  return player?.getAttribute?.(BOT_ATTRIBUTE) === true;
}

function stateOf(player) {
  return getActiveBotRuntime().runtime?.botStatesByName?.get(player.getUsername()) ?? null;
}

function realPlayersInCrater() {
  return [...bh.lobby, ...bh.arena].filter((player) => player.isPlayerBot?.() !== true);
}

// --- Population ----------------------------------------------------------------------------

function prepareBot(player) {
  Coffer.fundToMinimum(player);
  if (!player.isSkulled()) {
    core.CombatFactory.skull(player, core.SkullType.WHITE_SKULL, core.CombatFactory.PVP_SKULL_SECONDS);
  }
}

/** The style furthest below its share of the band, counting the bot about to join it. */
function nextStyle(inBand) {
  const total = Object.values(STYLE_WEIGHTS).reduce((sum, weight) => sum + weight, 0);
  const shortfall = (style) => (STYLE_WEIGHTS[style] / total) * (inBand.length + 1)
    - inBand.filter((bot) => botStyles.get(bot) === style).length;
  return Object.keys(STYLE_WEIGHTS).reduce((best, style) => (shortfall(style) > shortfall(best) ? style : best));
}

function spawnBot(runtime, behaviorMode) {
  const counts = BOT_BANDS.map((band) => [...bots].filter((bot) => botBands.get(bot) === band).length);
  const bandIndex = counts.indexOf(Math.min(...counts));
  const band = BOT_BANDS[bandIndex];
  const inBand = [...bots].filter((bot) => botBands.get(bot) === band);
  const style = nextStyle(inBand);
  const profileId = band.min >= 111 && counts[bandIndex] % 2 === 0 ? "elite" : TIER_PROFILE_IDS[band.tier];
  const index = inBand.filter((bot) => botStyles.get(bot) === style).length;
  // A band with no build of that style (only hybrids are maxed) takes its usual pick instead.
  const styled = pickTierChoice(band.tier, { index, build: style, band, profileId, excludeF2p: true });
  const level = styled && tierCombatLevel(styled.entry, getPvpProfile(profileId));
  const choice = level >= band.min && level <= band.max ? styled
    : pickTierChoice(band.tier, { index: counts[bandIndex], band, profileId, excludeF2p: true });
  if (!choice) return;
  const pvpMetadata = {
    ...buildRoamingPvpMetadata({ config: { pvp: {
      profileWeights: [{ value: profileId, weight: 1 }],
      loadoutWeights: [{ value: choice.loadoutId, weight: 1 }],
    } } }),
    combatLevelRange: band,
    generatedArchetypeId: choice.archetypeId,
  };
  const spawn = Entry.spawnTile();
  const bot = runtime.spawnPvpBot(spawn, { username: `BhBot${++spawnedBots}`, mode: behaviorMode.PVP, pvpMetadata });
  const state = bot && stateOf(bot);
  if (!state?.pvp) return;
  bot.setAttribute(BOT_ATTRIBUTE, true);
  prepareBot(bot);
  startActivity(bot, PVP_ACTIVITY, { home: { x: spawn.getX(), y: spawn.getY(), z: spawn.getZ() } });
  bots.add(bot);
  botBands.set(bot, band);
  botStyles.set(bot, buildStyle(choice.entry));
}

function populate({ player }) {
  if (player.isPlayerBot?.() === true || populationTarget > 0) return;
  const { runtime } = getActiveBotRuntime();
  if (!runtime) {
    player.sendMessage("Bots are unavailable on this world.");
    return;
  }
  populationTarget = MAX_BOTS;
}

function despawnAll() {
  populationTarget = 0;
  for (const player of bots) {
    player.getForcedLogoutTimer().start(0);
    player.requestLogout();
  }
  bots.clear();
}

// --- Bounty Hunter on top of the PvP brain -------------------------------------------------

/** The crater's matchmaking gave a bot its target: that is the bot's next fight. */
function huntTarget({ player, target }) {
  if (!isBot(player) || fighting(player)) return;
  const state = stateOf(player);
  if (!state?.pvp || state.pvp.retreat) return;
  const { behaviorMode } = getActiveBotRuntime();
  setModePvp(player, state, target, Date.now(), TARGET_HOLD_MS, behaviorMode, { allowInCombatTransition: true });
}

/** Target gone: drop it; the engine's validation resets the bot to seeking next tick. */
function dropTarget({ player }) {
  if (!isBot(player) || fighting(player)) return;
  const pvp = stateOf(player)?.pvp;
  if (!pvp || pvp.retreat) return;
  pvp.targetUsername = null;
  pvp.targetPlayer = null;
}

function fighting(player) {
  const combat = player.getCombat();
  return alive(combat.getTarget?.()) || alive(combat.getAttacker?.());
}

function alive(mobile) {
  return Boolean(mobile) && mobile.isRegistered?.() !== false && mobile.getHitpoints() > 0;
}

function distance(a, b) {
  const p = a.getLocation();
  const q = b.getLocation();
  return Math.max(Math.abs(p.getX() - q.getX()), Math.abs(p.getY() - q.getY()));
}

/** Single-way arena: someone already fighting another player is not up for grabs. */
function engagedElsewhere(other, bot) {
  const combat = other.getCombat();
  return [combat.getTarget?.(), combat.getAttacker?.()].some((mobile) => mobile !== bot && alive(mobile));
}

function mayAttack(bot, other) {
  const method = core.CombatFactory.getMethod(bot);
  return core.CombatFactory.canAttackPermission(bot, other, false, method) === core.CanAttackResponse.CAN_ATTACK;
}

/** The nearest arena player the bot may attack and who is free: a rogue fight. */
function nearestRogueTarget(bot) {
  let best = null;
  for (const other of bh.arena) {
    if (other === bot || !alive(other) || engagedElsewhere(other, bot)) continue;
    if (best && distance(bot, other) >= distance(bot, best)) continue;
    if (mayAttack(bot, other)) best = other;
  }
  return best;
}

/** Its Bounty Hunter target when it has one in the arena, else a rogue fight. */
function quarryOf(bot) {
  const target = bh.targetOf(bot);
  return target && bh.inArena(target) && alive(target) ? target : nearestRogueTarget(bot);
}

/** One walk order up to CHASE_STEP tiles towards `to`; the engine's pathing does the last stretch. */
function chase(bot, to) {
  const from = bot.getLocation();
  const dx = to.getLocation().getX() - from.getX();
  const dy = to.getLocation().getY() - from.getY();
  const scale = Math.min(1, CHASE_STEP / Math.max(Math.abs(dx), Math.abs(dy), 1));
  bot.setRunning?.(true);
  core.PathFinder.calculateWalkRoute(bot, from.getX() + Math.round(dx * scale), from.getY() + Math.round(dy * scale));
}

function wander(bot) {
  const here = bot.getLocation();
  const x = here.getX() + core.Misc.random(WANDER_RADIUS * 2) - WANDER_RADIUS;
  const y = here.getY() + core.Misc.random(WANDER_RADIUS * 2) - WANDER_RADIUS;
  if (bh.isArenaTile({ x, y, z: 0 })) core.PathFinder.calculateWalkRoute(bot, x, y);
}

/**
 * Out of a fight: hand the quarry to the PvP engine and close the distance; the engine
 * attacks, specs, eats and switches once it is in reach.
 */
function hunt(bot, nowMs) {
  const state = stateOf(bot);
  if (state?.pvp?.retreat || nowMs < (nextDecisionAt.get(bot) ?? 0) || fighting(bot)) return;
  nextDecisionAt.set(bot, nowMs + DECIDE_MS);
  const quarry = quarryOf(bot);
  if (!state?.pvp || !quarry) {
    if (bot.getMovementQueue().size() === 0) wander(bot);
    return;
  }
  if (state.pvp.targetPlayer !== quarry) {
    const hold = bh.targetOf(bot) === quarry ? TARGET_HOLD_MS : ROGUE_HOLD_MS;
    setModePvp(bot, state, quarry, nowMs, hold, getActiveBotRuntime().behaviorMode, { allowInCombatTransition: true });
  }
  if (distance(bot, quarry) > ENGAGE_DISTANCE) chase(bot, quarry);
}

/** Where the bot stands, not area membership: bots are area-processed every third tick. */
function onCraterTile(bot) {
  const location = bot.getLocation();
  return bh.isArenaTile(location) || bh.isLobbyTile(location);
}

/** Bounty Hunter escape replaces the Wilderness teleport/refit with a walk through a real gate. */
function defensiveAction(request) {
  const { player, state, nowMs } = request;
  if (!isBot(player) || !onCraterTile(player)) return;
  const pvp = state.pvp;
  if (pvp.retreat && !pvp.retreat.exit) return;
  // Death can leave coins or one protected item; neither is a usable PvP kit.
  if (!pvp.retreat && !retreatDecisions.has(player) &&
      (pvp.loadoutPending || !player.getEquipment().getItems().some((item) => item?.getId?.() > 0))) {
    const applied = applyGeneratedPvpLoadout(player, state, { api });
    if (!applied) pvp.loadoutPending = true;
    request.result = { handled: true, status: applied ? "success" : "running" };
    return;
  }
  request.result = { handled: false, status: "running" };
  if (!pvp.retreat) {
    const food = player.getInventory().getItems().filter((item) => isFoodItem(item?.getId?.())).length;
    if (food > RETREAT_FOOD_RESERVE) {
      retreatDecisions.delete(player);
      return;
    }
    if (!retreatDecisions.has(player)) {
      retreatDecisions.set(player, Math.random() >= getPvpProfile(pvp.profileId).riskTolerance);
    }
    if (food > 0 && !retreatDecisions.get(player)) return;
    const here = player.getLocation();
    const distanceTo = (exit) => Math.max(Math.abs(here.getX() - exit.x), Math.abs(here.getY() - exit.y));
    const exit = bh.CRATER.exits.reduce((best, next) => distanceTo(next) < distanceTo(best) ? next : best);
    pvp.retreat = { autoRetaliate: player.autoRetaliateReturn(), exit };
    player.setAutoRetaliate(false);
    player.getCombat().reset();
    clearMovementRequest(player);
  }
  request.result.handled = true;
  pvp.phase = "retreating";
  player.setFollowing(null);
  player.setCombatFollowing(null);
  if (player.getCombat().getTarget()) player.getCombat().reset();
  const retreat = pvp.retreat;
  if (bh.isLobbyTile(player.getLocation())) {
    clearMovementRequest(player);
    if (!retreat.logoutRequested) {
      retreat.logoutRequested = true;
      player.requestLogout();
    }
    return;
  }
  const gateAt = new core.Location(retreat.exit.x, retreat.exit.y, 0);
  const gate = core.MapObjects.get(core.ObjectIdentifiers.ARENA_13, gateAt, player.getPrivateArea());
  const definition = gate?.getDefinition();
  if (gate && core.PathFinder.reachedObject(player, retreat.exit.x, retreat.exit.y,
      definition.getSizeX(), definition.getSizeY(), gate.getFace(), gate.getType(), definition.getBlockingMask())) {
    clearMovementRequest(player);
    Entry.exitArena({ player, location: gateAt });
    return;
  }
  player.setRunning(player.getRunEnergy() > 0);
  queueRouteAndFlagAppearance(player, retreat.exit.x, retreat.exit.y, { state, nowMs, basicPather: true, reason: "bounty_hunter_retreat" });
}

function clearRetreat({ player }) {
  if (!isBot(player)) return;
  retreatDecisions.delete(player);
  const pvp = stateOf(player)?.pvp;
  if (!pvp) return;
  if (player.getHitpoints() <= 0 || player.isDyingReturn?.()) pvp.loadoutPending = true;
  if (!pvp.retreat) return;
  player.setAutoRetaliate(pvp.retreat.autoRetaliate);
  pvp.retreat = null;
  clearMovementRequest(player);
}

function tick() {
  if (populationTarget === 0 && bots.size === 0) return;
  if (realPlayersInCrater().length === 0) {
    despawnAll();
    return;
  }
  // Low-food exits must not drain an occupied crater; pace replacements across ticks.
  if (bots.size < populationTarget) {
    const { runtime, behaviorMode } = getActiveBotRuntime();
    if (runtime) spawnBot(runtime, behaviorMode);
  }
  const nowMs = Date.now();
  for (const player of bots) {
    if (player.getHitpoints() <= 0 || player.isDyingReturn?.() === true) continue;
    prepareBot(player);
    if (!onCraterTile(player)) player.moveTo(Entry.spawnTile());
    else if (bh.inArena(player)) hunt(player, nowMs);
  }
}

function forgetBot({ player }) {
  clearRetreat({ player });
  bots.delete(player);
}

function startTask() {
  const task = new core.Task(1);
  task.execute = tick;
  api.getTaskManager?.()?.submit?.(task);
}

module.exports = function attachBots(pluginApi, state) {
  api = pluginApi;
  core = pluginApi.core;
  initPvpTierLoadouts(pluginApi);
  bh = state;
  api.onCustomEvent("bounty-hunter:entered-lobby", populate);
  api.onCustomEvent("bounty-hunter:target-assigned", huntTarget);
  api.onCustomEvent("bounty-hunter:target-cleared", dropTarget);
  api.onCustomEvent("player-bots:pvp-defensive-action", defensiveAction);
  api.onPlayerBeforeDeath(clearRetreat);
  api.onPlayerLogout(forgetBot);
  api.onServerStartup(startTask);
};

Object.assign(module.exports, { _test: { huntTarget, dropTarget, BOT_BANDS, MAX_BOTS, STYLE_WEIGHTS } });
