/**
 * Civitas illa Fortis's Wealthy citizens: the street urchins' distractions and the house key's
 * dry-streak cap. Lines, ticks and ids are in plugins/skills/data/wealthy-citizen-distractions.json,
 * with their sources (OSRS Wiki: Wealthy citizen; rsprox captures).
 *
 * Every 140-165 ticks, Leo, Julia and Aurelia each start a scene at once. Each one brings
 * its nearest free Wealthy citizen over, and that citizen stays distracted for 40 ticks.
 * Players within 6 tiles of an urchin when it starts are told about it, and only they get the
 * reward: their pickpockets on a distracted citizen always succeed and repeat on their own until
 * the scene ends ("thieving:pickpocket-target" `alwaysSucceeds`, "thieving:done" `again`).
 */
const fs = require("fs");
const path = require("path");

const DATA = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "wealthy-citizen-distractions.json"), "utf8"));
const WEALTHY_CITIZEN_TARGET = "wealthy_citizen";
const KEY_DRY_STREAK_ATTRIBUTE = "thieving:wealthy-citizen-key-dry-streak";
/** NPC.process clears an interaction past 2 tiles unless this flag holds it: the citizen faces its urchin all the way over. */
const KEEP_FACING_FLAG = "interaction:keep";
/** A walk that a passer-by blocks stops short; the citizen tries again until it stands beside the urchin. */
const APPROACH_RETRY_TICKS = 10;

let core;
let pluginApi;
/** Distracted citizen -> { until, witnesses }: pickpockets get the reward before `until`. */
const distracted = new WeakMap();
/** The scenes running now, and when the next one starts. */
const state = { scenes: [], tick: 0, nextStart: 0 };

function pick(list, random = Math.random) {
  return list[Math.floor(random() * list.length)];
}

function idsOf(names, lookup) {
  return new Set(names.map((name) => lookup(name)).filter((id) => id !== null));
}

function nextInterval(random = Math.random) {
  const [low, high] = DATA.intervalTicks;
  return low + Math.floor(random() * (high - low + 1));
}

function chebyshev(a, b) {
  return Math.max(Math.abs(a.getX() - b.getX()), Math.abs(a.getY() - b.getY()));
}

function samePlane(a, b) {
  return a.getZ() === b.getZ();
}

function animation(name, delay = 0) {
  const id = core.CacheDefinitions.getSeqId(name);
  return id === null ? null : new core.Animation(id, delay);
}

function emote(npc, name, delay = 0) {
  const anim = animation(name, delay);
  if (anim && npc.isRegistered()) npc.performAnimation(anim);
}

function sayOver(npc, text) {
  if (npc.isRegistered()) npc.forceChat(text);
}

/** The urchins and the citizens that can be distracted right now. */
function cast() {
  const urchinIds = idsOf(DATA.urchins, (name) => core.CacheDefinitions.getNpcId(name));
  const citizenIds = idsOf(DATA.citizens, (name) => core.CacheDefinitions.getNpcId(name));
  const urchins = [];
  const citizens = [];
  for (const npc of core.World.getNpcs()) {
    if (!npc?.isRegistered?.() || npc.getPrivateArea?.()) continue;
    if (urchinIds.has(npc.getId())) urchins.push(npc);
    else if (citizenIds.has(npc.getId())) citizens.push(npc);
  }
  return { urchins, citizens };
}

/** The nearest citizen to the urchin that isn't already busy or fighting. */
function nearestCitizen(urchin, citizens, taken) {
  let best = null;
  for (const citizen of citizens) {
    if (taken.has(citizen) || core.CombatFactory.inCombat(citizen)) continue;
    const at = citizen.getLocation();
    if (!samePlane(at, urchin.getLocation())) continue;
    const distance = chebyshev(at, urchin.getLocation());
    if (distance > DATA.citizenRadius) continue;
    if (!best || distance < best.distance) best = { citizen, distance };
  }
  return best?.citizen ?? null;
}

/** The free tile next to the urchin nearest the citizen (Ours: the captures only show an adjacent stand). */
function standTile(urchin, citizen) {
  const at = urchin.getLocation();
  const from = citizen.getLocation();
  const sides = [[0, -1], [0, 1], [-1, 0], [1, 0]].map(([dx, dy]) => at.transform(dx, dy));
  sides.sort((a, b) => chebyshev(a, from) - chebyshev(b, from));
  return sides.find((tile) => !core.RegionManager.blocked(tile, null)) ?? sides[0];
}

function hold(npc) {
  npc.setScriptedMovement(true);
  npc.getMovementQueue().reset();
}

function release(npc) {
  if (!npc.isRegistered()) return;
  npc.setScriptedMovement(false);
  npc.setFlag(KEEP_FACING_FLAG, false);
}

function beside(npc, other) {
  return samePlane(npc.getLocation(), other.getLocation()) && chebyshev(npc.getLocation(), other.getLocation()) <= 1;
}

function walkOver(citizen, urchin) {
  const tile = standTile(urchin, citizen);
  core.PathFinder.calculateWalkRoute(citizen, tile.getX(), tile.getY());
}

/** Starts every urchin's scene at once, and tells the players close enough to see it. */
function startScenes(random = Math.random) {
  const { urchins, citizens } = cast();
  const taken = new Set();
  const scenes = [];
  for (const urchin of urchins) {
    const citizen = nearestCitizen(urchin, citizens, taken);
    if (!citizen) continue;
    taken.add(citizen);
    const scenario = pick(DATA.scenarios, random);
    // Ours: each urchin's own watchers (no capture shows whether live keeps them per urchin or per world).
    scenes.push({ urchin, citizen, scenario, commotion: random() < 0.5, witnesses: new WeakSet() });
  }
  if (!scenes.length) return [];
  const until = core.World.getProcessCycle() + DATA.lengthTicks;
  for (const scene of scenes) {
    hold(scene.urchin);
    sayOver(scene.urchin, pick(scene.scenario.open, random));
    distracted.set(scene.citizen, { until, witnesses: scene.witnesses });
  }
  for (const player of core.World.getPlayers()) {
    if (!player?.isRegistered?.()) continue;
    const here = player.getLocation();
    const seen = scenes.filter(({ urchin }) => samePlane(here, urchin.getLocation()) && chebyshev(here, urchin.getLocation()) <= DATA.noticeRadius);
    if (!seen.length) continue;
    for (const scene of seen) scene.witnesses.add(player);
    player.sendMessage(DATA.notice);
    player.getPacketSender().sendSoundEffect(DATA.noticeSound.id, 1, DATA.noticeSound.delay, 255);
  }
  return scenes;
}

/** One tick of a scene, `t` ticks after its opening line. Returns false once it is over. */
function playScene(scene, t, random = Math.random) {
  const { urchin, citizen, scenario } = scene;
  const at = DATA.timeline;
  if (!urchin.isRegistered() || !citizen.isRegistered()) {
    endScene(scene);
    return false;
  }
  if (t === at.approach) {
    hold(citizen);
    citizen.setFlag(KEEP_FACING_FLAG, true);
    citizen.setMobileInteraction(urchin);
    walkOver(citizen, urchin);
    if (scene.commotion) sayOver(citizen, DATA.commotion);
  } else if (t > at.approach && t <= at.approach + APPROACH_RETRY_TICKS && !beside(citizen, urchin) && !citizen.getMovementQueue().hasPendingWork()) {
    walkOver(citizen, urchin);
  }
  if (at.emotes.includes(t)) {
    urchin.setPositionToFace(citizen.getLocation());
    emote(urchin, pick(scenario.urchinEmotes, random));
    emote(citizen, scenario.citizenEmote, DATA.emoteDelay);
  }
  if (t === at.middle) sayOver(urchin, pick(scenario.middle, random));
  if (t === at.reply) sayOver(citizen, pick(DATA.replies[scenario.replies], random));
  if (t === at.end) {
    sayOver(urchin, pick(scenario.end, random));
    emote(citizen, DATA.citizenLastEmote);
  }
  if (t === at.release) {
    citizen.setMobileInteraction(null);
    endScene(scene);
  }
  if (t === at.afterwards) {
    sayOver(citizen, DATA.afterwards);
    return false;
  }
  return true;
}

function endScene(scene) {
  if (distracted.get(scene.citizen)?.witnesses === scene.witnesses) distracted.delete(scene.citizen);
  release(scene.citizen);
  release(scene.urchin);
}

/** The world's clock for the scenes: one runs every 140-165 ticks, start to start. */
function processScenes() {
  const t = state.tick++;
  state.scenes = state.scenes.filter((scene) => playScene(scene, t - scene.startedAt));
  if (t < state.nextStart) return;
  state.nextStart = t + nextInterval();
  for (const scene of startScenes()) {
    scene.startedAt = t;
    state.scenes.push(scene);
  }
}

function startClock() {
  state.nextStart = nextInterval();
  core.TaskManager.submit(new (class extends core.Task {
    constructor() {
      super(1);
    }

    execute() {
      processScenes();
    }
  })());
}

/** Whether the citizen is distracted `ahead` ticks from now, and what this player saw of it. */
function distractionFor(player, npc, ahead = 0) {
  const scene = distracted.get(npc);
  if (!scene || core.World.getProcessCycle() + ahead >= scene.until) return null;
  return { witnessed: scene.witnesses.has(player) };
}

/**
 * "thieving:pickpocket-target": a witness always succeeds on a distracted citizen. One who
 * missed the start gets the sweaty-hands line and an ordinary attempt (Ours: the Wiki's slower
 * automatic pickpocketing for 15 seconds has no rate, so it isn't modelled).
 */
function distractedTarget(request) {
  if (request.target?.key !== WEALTHY_CITIZEN_TARGET) return;
  const distraction = distractionFor(request.player, request.npc);
  if (!distraction) return;
  if (distraction.witnessed) {
    request.alwaysSucceeds = true;
    return;
  }
  if (request.repeat) return;
  // Only for a click that becomes an attempt: `onAttempt` runs after the pickpocket's own checks.
  const before = request.onAttempt;
  const player = request.player;
  request.onAttempt = () => {
    before?.();
    player.sendMessage(DATA.sweatyLine);
  };
}

/**
 * "thieving:done": a witness carries on until the distraction ends. The next attempt starts a
 * tick later, so it is only asked for while the distraction still covers that tick.
 */
function keepPickpocketing(done) {
  if (done.kind !== "pickpocket" || !done.succeeded) return;
  if (distractionFor(done.player, done.npc, 1)?.witnessed) done.again = true;
}

function keyItemId() {
  return core.CacheDefinitions.getObjId(DATA.keyPity.key);
}

function keyPityVarbit() {
  return core.CacheDefinitions.getVarbitId(DATA.keyPity.varbit);
}

function setDryStreak(player, value) {
  player.setAttribute(KEY_DRY_STREAK_ATTRIBUTE, value);
  const varbit = keyPityVarbit();
  if (varbit !== null) player.getPacketSender().sendVarbit(varbit, value);
}

/** "thieving:loot": the dry streak gives the key at its cap, and any key resets it. */
function keyDryStreak(loot) {
  if (loot.target !== "wealthy citizen") return;
  const key = keyItemId();
  if (key === null) return;
  const streak = Number(loot.player.getAttribute(KEY_DRY_STREAK_ATTRIBUTE) ?? 0) || 0;
  // The capped success's loot is the key alone; a clue roll (Ours: never captured at the cap) keeps the clue.
  if (!loot.loot.some((item) => item.id === key || item.clue) && streak >= DATA.keyPity.limit) {
    loot.loot = [...loot.loot.filter((item) => item.id !== core.ItemIdentifiers.COINS), { id: key, amount: 1 }];
  }
  setDryStreak(loot.player, loot.loot.some((item) => item.id === key) ? 0 : Math.min(DATA.keyPity.limit, streak + 1));
}

function syncDryStreak({ player }) {
  const value = Number(player.getAttribute(KEY_DRY_STREAK_ATTRIBUTE) ?? 0) || 0;
  const varbit = keyPityVarbit();
  if (value > 0 && varbit !== null) player.getPacketSender().sendVarbit(varbit, value);
}

function register(api) {
  core = api.core;
  pluginApi = api;
  api.persistAttribute(KEY_DRY_STREAK_ATTRIBUTE, 0);
  api.onServerStartup(startClock);
  api.onPlayerLogin(syncDryStreak);
  api.onCustomEvent("thieving:pickpocket-target", distractedTarget);
  api.onCustomEvent("thieving:done", keepPickpocketing);
  api.onCustomEvent("thieving:loot", keyDryStreak);
}

module.exports = register;
module.exports._test = {
  DATA, state, distracted, startScenes, playScene, processScenes, distractedTarget, keepPickpocketing, keyDryStreak,
  KEY_DRY_STREAK_ATTRIBUTE, get pluginApi() { return pluginApi; },
};
