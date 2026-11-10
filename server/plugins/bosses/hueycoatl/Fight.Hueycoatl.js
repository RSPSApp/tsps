/**
 * The fight's phases, as captured (rsprox recordings 3399, 3274, 4054; docs/hueycoatl.md):
 *
 * - Body: five segments lie in their caves on the mountainside. Each one beaten turns to
 *   rubble, its cave plays huey_body_death and turns to a plain cave 3 ticks later, and the
 *   barrier flinches (huey_p2_barrier_damage_01). The last one: the barrier's transition, "The
 *   Hueycoatl shifts, opening a path up the mountain.", a camera shake, and 9 ticks later the
 *   barrier is retracted (walkable). The seer runs up to the pillars (22 ticks) and starts
 *   charging them.
 * - Head: at half health she shields herself (huey_shield_activation, huey_head_invulnerable)
 *   and the tail rises from the western cave (it spawns east, shows west a tick later).
 * - Tail: it slams 2 ticks after showing, stays 36 ticks, sinks for 2 and shows on the other
 *   side. Broken (huey_tail_break), the head screeches; a tick later "The Hueycoatl's shield
 *   falls!", 3 ticks later she is attackable again.
 * - Final: the broken tail slams on alternate sides every 24 ticks (from 18 ticks after it
 *   broke), the head attacks faster.
 * - Defeated: knocked out (huey_knockout, huey_head_defeated), two workers run in; 39 ticks
 *   later "The Hueycoatl begins to awaken...", and 50 ticks after the kill a fresh set
 *   replaces everything, knocking anyone on the summit back to the start.
 *
 * Every session runs on one task: each tick it plays the session's due events, its attack
 * timers and its pillars. A session with nobody in its arena only keeps its respawn going.
 */
const CameraShake = require("../../interface/CameraShake.plugin");
const Shared = require("./Shared.Hueycoatl");
const Attacks = require("./Attacks.Hueycoatl");
const Pillars = require("./Pillars.Hueycoatl");
const Kills = require("./Kills.Hueycoatl");
const Hud = require("./Hud.Hueycoatl");
const Seer = require("./Seer.Hueycoatl");

const BARRIER_RETRACT_TICKS = 9;
const CAVE_EMPTY_TICKS = 3;
const SEER_PILLARS_TICKS = 22;
const TAIL_SHOW_TICKS = 1;
const TAIL_SLAM_TICKS = 2;
const TAIL_STAY_TICKS = 36;
const TAIL_SWAP_TICKS = 2;
const UNSHIELD_MESSAGE_TICKS = 1;
const UNSHIELD_TICKS = 3;
const BROKEN_SINK_TICKS = 4;
const BROKEN_FIRST_TICKS = 18;
const BROKEN_PERIOD_TICKS = 24;
const BROKEN_STAY_TICKS = 6;
const WORKERS_LEAVE_TICKS = 7;
const AWAKEN_WORKERS_TICKS = 38;
const AWAKEN_TICKS = 39;
const RESET_TICKS = 50;
const CAVE_SETTLE_TICKS = 2;
const BARRIER_SETTLE_TICKS = 9;
const GETUP_TICKS = 1;
const CAMERA_SHAKE = Object.freeze([[0, 4], [1, 5], [2, 3]]);

/** The victory workers' run, as captured: in from the cave, out to either side. */
const VICTORY_WORKERS = Object.freeze([
  { id: Shared.NPC.VICTORY_WORKER_1, from: [1510, 3275], to: [1505, 3283] },
  { id: Shared.NPC.VICTORY_WORKER_2, from: [1511, 3275], to: [1519, 3283] },
]);
const AWAKEN_WORKERS = Object.freeze([
  { id: Shared.NPC.VICTORY_WORKER_1, from: [1505, 3283], to: [1519, 3289] },
  { id: Shared.NPC.VICTORY_WORKER_2, from: [1519, 3283], to: [1519, 3289] },
]);
const VICTORY_SHOUTS = Object.freeze(["For Karlo!", "Into the tunnels, quick!", "Let's go!", "Quickly, while it's recovering!", "What's it left this time?"]);
const AWAKEN_SHOUTS = Object.freeze(["It's coming back!", "Prepare yourselves!", "Retreat!", "Run!"]);

let api = null;
let core = null;

/** Head attack intervals per phase, in ticks (captured: the body 20, the head 18/18/24, the
 * shield 15, the final phase 11 x4 then 16). */
const ATTACK_INTERVALS = Object.freeze({
  body: [20],
  head: [18, 18, 24],
  tail: [15],
  final: [11, 11, 11, 11, 16],
});
/** Glowing symbols every 26 ticks (body, head), 36 (tail) and 24 (final), as captured. */
const SYMBOL_INTERVALS = Object.freeze({ body: 26, head: 26, tail: 36, final: 24 });

function now() {
  return core.World.getProcessCycle();
}

/** Runs `action` `ticks` ticks into this fight; dropped if the fight resets first. A tagged
 * event can be dropped on its own (the whole tail's cycle, when it breaks). */
function schedule(session, ticks, action, tag = null) {
  session.schedule(ticks, action, tag);
}

function setPhase(session, phase) {
  const fight = session.fight;
  fight.phase = phase;
  fight.attackStep = 0;
  fight.nextAttack = now() + (ATTACK_INTERVALS[phase]?.[0] ?? 0);
  fight.nextSymbols = now() + (SYMBOL_INTERVALS[phase] ?? 0);
}

function message(session, text) {
  for (const player of session.arenaPlayers()) player.sendMessage(text);
}

function caveLoc(segment, kind) {
  if (kind === "body") return segment.diag ? Shared.LOC.CAVE_DIAG_BODY : Shared.LOC.CAVE_BODY;
  if (kind === "respawn") return segment.diag ? Shared.LOC.CAVE_DIAG_RESPAWN : Shared.LOC.CAVE_RESPAWN;
  return segment.diag ? Shared.LOC.CAVE_DIAG : Shared.LOC.CAVE;
}

/** The boss parts never wander, retaliate, regenerate or follow anyone. */
function bossPart(npc) {
  npc.setFlag("combat:no-retaliate");
  npc.setFlag("combat:no-regen");
  npc.setFlag("combat:keep-facing");
  npc.getMovementQueue().setBlockMovement(true);
  npc.setMultiCombat?.(true);
  return npc;
}

/** A fresh set: head, five segments and the seer at the arena's entrance. */
function spawnSet(session) {
  const fight = session.fight;
  fight.head = bossPart(session.spawnNpc(Shared.NPC.HEAD, Shared.HEAD_TILE));
  fight.head.performAnimation(new core.Animation(Shared.SEQ.AWAKEN_RESET));
  fight.segments = Shared.SEGMENTS.map((segment) => ({
    ...segment,
    npc: bossPart(session.spawnNpc(Shared.NPC.BODY, segment.tile)),
    down: false,
  }));
  fight.seer = Seer.spawn(session);
  fight.spawnedAt = now();
  fight.started = false;
  setPhase(session, "body");
}

function newFight(session) {
  session.fight = {
    generation: 0, events: [], phase: "body", head: null, tail: null, segments: [], seer: null,
    tailSide: "west", tailUp: false, spawnedAt: 0, started: false, attackStep: 0, nextAttack: 0,
    nextSymbols: 0, damage: new Map(), joinedAt: new Map(), killedAt: 0, bodyDoneAt: 0,
  };
  Pillars.reset(session);
  spawnSet(session);
}

/** First player into the arena of a fresh set: the seer runs to the body and the timers start. */
function begin(session) {
  const fight = session.fight;
  if (fight.started || fight.phase !== "body") return;
  fight.started = true;
  setPhase(session, "body");
  Seer.runToBody(session);
}

/** A segment beaten: rubble, the cave's death, the barrier's flinch (or the path, the last). */
function segmentDown(session, npc) {
  const fight = session.fight;
  const segment = fight.segments.find((entry) => entry.npc === npc);
  if (!segment || segment.down) return;
  segment.down = true;
  npc.setNpcTransformationId(Shared.NPC.RUBBLE);
  npc.getCombat().reset();
  session.animateLoc(segment.cave, Shared.SCENERY_SHAPE, segment.diag ? Shared.SEQ.BODY_DEATH_DIAG : Shared.SEQ.BODY_DEATH);
  session.sound(segment.tile, Shared.SOUND.BODY_DEATH);
  schedule(session, CAVE_EMPTY_TICKS, () => session.setLoc(segment.cave, Shared.SCENERY_SHAPE, segment.rotation, caveLoc(segment, "empty")));
  if (fight.segments.some((entry) => !entry.down)) {
    session.animateLoc(Shared.BARRIER_TILE, Shared.SCENERY_SHAPE, Shared.SEQ.BARRIER_DAMAGE);
    Seer.bodyLine(session);
    return;
  }
  openPath(session);
}

function openPath(session) {
  const fight = session.fight;
  fight.bodyDoneAt = now();
  session.animateLoc(Shared.BARRIER_TILE, Shared.SCENERY_SHAPE, Shared.SEQ.BARRIER_TRANSITION);
  for (const player of session.arenaPlayers()) {
    player.sendMessage(Shared.MESSAGE.PATH);
    for (const [slot, random] of CAMERA_SHAKE) CameraShake.send(player.getPacketSender(), "combat", slot, random, 0, 0);
  }
  setPhase(session, "head");
  schedule(session, BARRIER_RETRACT_TICKS, () => {
    session.setLoc(Shared.BARRIER_TILE, Shared.SCENERY_SHAPE, 0, Shared.LOC.BARRIER_RETRACTED);
  });
  Seer.runToPillars(session);
  schedule(session, SEER_PILLARS_TICKS, () => Pillars.start(session));
}

/** Half health: the shield goes up and the tail rises. */
function shield(session) {
  const fight = session.fight;
  const { head } = fight;
  setPhase(session, "tail");
  message(session, Shared.MESSAGE.SHIELD);
  Seer.say(session, "It's shielded itself! You need to break its concentration!");
  head.performAnimation(new core.Animation(Shared.SEQ.SHIELD_ACTIVATION));
  head.setNpcTransformationId(Shared.NPC.HEAD_SHIELDED);
  Hud.retarget(session, head);
  fight.tail = bossPart(session.spawnNpc(Shared.NPC.TAIL, Shared.TAIL_EAST));
  fight.tailSide = "east";
  fight.tailUp = false;
  schedule(session, TAIL_SHOW_TICKS, () => showTail(session, "west", TAIL_STAY_TICKS), "tail");
}

/** The tail shows on a side, slams, and (whole) stays its time before swapping. */
function showTail(session, side, stay) {
  const fight = session.fight;
  const { tail } = fight;
  if (!tail?.isRegistered()) return;
  fight.tailSide = side;
  tail.moveTo(session.tile(side === "west" ? Shared.TAIL_WEST : Shared.TAIL_EAST));
  tail.performAnimation(new core.Animation(Shared.SEQ.TAIL_APPEAR));
  fight.tailUp = fight.phase === "tail";
  schedule(session, TAIL_SLAM_TICKS, () => Attacks.slam(session, side), "tail");
  schedule(session, stay, () => sinkTail(session, side), "tail");
}

function sinkTail(session, side) {
  const fight = session.fight;
  const { tail } = fight;
  if (!tail?.isRegistered()) return;
  fight.tailUp = false;
  tail.performAnimation(new core.Animation(Shared.SEQ.TAIL_DISAPPEAR));
  const other = side === "west" ? "east" : "west";
  if (fight.phase === "tail") {
    Seer.tailLine(session);
    schedule(session, TAIL_SWAP_TICKS, () => showTail(session, other, TAIL_STAY_TICKS), "tail");
  } else if (fight.phase === "final") {
    schedule(session, BROKEN_PERIOD_TICKS - BROKEN_STAY_TICKS, () => showTail(session, other, BROKEN_STAY_TICKS), "tail");
  }
}

/** The tail breaks: the shield falls and the final phase starts. */
function breakTail(session) {
  const fight = session.fight;
  const { tail, head } = fight;
  if (fight.phase !== "tail") return;
  fight.phase = "final-pending";
  fight.tailUp = false;
  tail.getCombat().reset();
  tail.performAnimation(new core.Animation(Shared.SEQ.TAIL_BREAK));
  tail.setNpcTransformationId(Shared.NPC.TAIL_BROKEN);
  session.sound(Shared.TAIL_WEST, Shared.SOUND.TAIL_BREAK);
  head.performAnimation(new core.Animation(Shared.SEQ.SCREECH));
  // The whole tail's cycle ends here: the broken one keeps its own.
  fight.events = fight.events.filter((event) => event.tag !== "tail");
  const side = fight.tailSide;
  schedule(session, UNSHIELD_MESSAGE_TICKS, () => {
    message(session, Shared.MESSAGE.UNSHIELD);
    Seer.say(session, "Well done! Now, let's weaken it a little more!");
  });
  schedule(session, UNSHIELD_TICKS, () => {
    head.performAnimation(new core.Animation(Shared.SEQ.SCREECH_RESET));
    head.setNpcTransformationId(Shared.NPC.HEAD);
    Hud.retarget(session, head);
    setPhase(session, "final");
  });
  schedule(session, BROKEN_SINK_TICKS, () => tail.performAnimation(new core.Animation(Shared.SEQ.TAIL_DISAPPEAR)));
  schedule(session, BROKEN_FIRST_TICKS, () => showTail(session, side === "west" ? "east" : "west", BROKEN_STAY_TICKS), "tail");
}

/** The head beaten: the kill, the workers, then the awakening and a fresh set. */
function defeat(session) {
  const fight = session.fight;
  const { head, tail } = fight;
  if (fight.phase !== "final") return;
  fight.phase = "defeated";
  fight.killedAt = now();
  fight.generation += 1;
  fight.events = [];
  head.getCombat().reset();
  head.performAnimation(new core.Animation(Shared.SEQ.KNOCKOUT));
  head.setNpcTransformationId(Shared.NPC.HEAD_DEFEATED);
  if (tail?.isRegistered()) tail.performAnimation(new core.Animation(Shared.SEQ.TAIL_DISAPPEAR));
  Pillars.stop(session);
  Seer.defeated(session);
  Kills.killed(session);
  Hud.killed(session);
  for (const worker of VICTORY_WORKERS) runWorker(session, worker, VICTORY_SHOUTS);
  schedule(session, AWAKEN_WORKERS_TICKS, () => {
    for (const worker of AWAKEN_WORKERS) runWorker(session, worker, AWAKEN_SHOUTS);
  });
  schedule(session, AWAKEN_TICKS, () => {
    message(session, Shared.MESSAGE.AWAKEN);
    head.performAnimation(new core.Animation(Shared.SEQ.AWAKEN));
  });
  schedule(session, RESET_TICKS, () => reset(session));
}

function runWorker(session, { id, from, to }, shouts) {
  const npc = session.spawnNpc(id, from);
  npc.setMovementSteps(2);
  npc.forceChat(Shared.pick(shouts));
  npc.getMovementQueue().addSteps(session.tile(to));
  schedule(session, WORKERS_LEAVE_TICKS, () => session.removeNpc(npc));
}

/** She recovers: a fresh set, the summit cleared, the caves and barrier back. */
function reset(session) {
  const fight = session.fight;
  for (const npc of [fight.head, fight.tail, ...fight.segments.map((segment) => segment.npc)]) session.removeNpc(npc);
  Seer.remove(session);
  for (const player of session.arenaPlayers()) {
    if (!session.inBounds(player, Shared.SUMMIT_BOUNDS) && !session.inBounds(player, Shared.MOUNTAINSIDE_BOUNDS)) continue;
    knockBack(player, session);
  }
  for (const segment of Shared.SEGMENTS) {
    session.setLoc(segment.cave, Shared.SCENERY_SHAPE, segment.rotation, caveLoc(segment, "respawn"));
  }
  session.setLoc(Shared.BARRIER_TILE, Shared.SCENERY_SHAPE, 0, Shared.LOC.BARRIER_RESPAWN);
  fight.generation += 1;
  fight.events = [];
  fight.tail = null;
  fight.damage = new Map();
  fight.joinedAt = new Map();
  Pillars.reset(session);
  spawnSet(session);
  schedule(session, CAVE_SETTLE_TICKS, () => {
    for (const segment of Shared.SEGMENTS) {
      session.setLoc(segment.cave, Shared.SCENERY_SHAPE, segment.rotation, caveLoc(segment, "body"));
    }
  });
  schedule(session, BARRIER_SETTLE_TICKS, () => session.setLoc(Shared.BARRIER_TILE, Shared.SCENERY_SHAPE, 0, Shared.LOC.BARRIER));
  // The fresh seer is registered next tick; her run starts once she is.
  schedule(session, 1, () => session.arenaPlayers().length > 0 && begin(session));
}

function knockBack(player, session) {
  player.getMovementQueue().reset();
  player.moveTo(session.tile(Shared.KNOCKBACK_TILE));
  player.performAnimation(new core.Animation(Shared.SEQ.KNOCKDOWN));
  Shared.later(GETUP_TICKS, () => player.isRegistered() && player.performAnimation(new core.Animation(Shared.SEQ.GETUP)));
}

/** One tick of a session: due events, the head's attacks, the symbols and the pillars. */
function tick(session) {
  const fight = session.fight;
  if (!fight) return;
  const t = now();
  if (fight.events.length > 0) {
    const due = fight.events.filter((event) => event.at <= t);
    fight.events = fight.events.filter((event) => event.at > t);
    for (const event of due) {
      if (event.generation === fight.generation) event.action();
    }
  }
  const players = session.arenaPlayers();
  if (players.length === 0) return;
  if (!fight.started && fight.phase === "body" && t > fight.spawnedAt) begin(session);
  if (fight.phase === "head" && fight.head.getHitpoints() <= Shared.SHIELD_AT) shield(session);
  const intervals = ATTACK_INTERVALS[fight.phase];
  if (intervals && t >= fight.nextAttack) {
    Attacks.rainFire(session, players, fight.phase === "tail");
    fight.attackStep = (fight.attackStep + 1) % intervals.length;
    fight.nextAttack = t + intervals[fight.attackStep];
  }
  const symbols = SYMBOL_INTERVALS[fight.phase];
  if (symbols && t >= fight.nextSymbols) {
    Attacks.symbols(session, players);
    fight.nextSymbols = t + symbols;
  }
  Pillars.tick(session, players);
}

/** The engine would kill them: segments turn to rubble, the tail breaks, the head is beaten. */
function beforeDeath(event) {
  const { npc } = event;
  const session = Shared.sessionOfNpc(npc);
  if (!session?.fight) return;
  const fight = session.fight;
  const id = npc.getId();
  if (id === Shared.NPC.BODY || id === Shared.NPC.RUBBLE) {
    event.preventDeath = true;
    segmentDown(session, npc);
  } else if (id === Shared.NPC.TAIL || id === Shared.NPC.TAIL_BROKEN) {
    event.preventDeath = true;
    if (npc === fight.tail) breakTail(session);
  } else if (npc === fight.head) {
    event.preventDeath = true;
    npc.setHitpoints(1);
    defeat(session);
  }
}

const sessionTask = () => {
  for (const session of Shared.sessions) tick(session);
};

function attach(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
  pluginApi.onNpcBeforeDeath(beforeDeath);
  pluginApi.onServerStartup(startTask);
}

function startTask() {
  const { Task, TaskManager } = core;
  TaskManager.submit(new (class extends Task {
    constructor() {
      super(1, null, false);
    }
    execute() {
      sessionTask();
    }
  })());
}

module.exports = {
  attach, newFight, begin, tick, schedule, shield, breakTail, defeat, reset, segmentDown, openPath, setPhase, now,
  _test: { ATTACK_INTERVALS, SYMBOL_INTERVALS },
};
