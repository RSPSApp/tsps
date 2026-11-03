"use strict";

/**
 * The soldiers training in Burthorpe's square, as captured (rsprox 1445 and 3252, about 300
 * sightings between them):
 * - The drill: Sergeant 4084 faces his ten soldiers (4086) and every 5 ticks plays one of the
 *   unarmed punch, kick, block and defend animations; on the same tick each soldier plays the
 *   same one, 40 client cycles later. Over 281 drills: punch 95, kick 60, block 94, defend 32.
 * - The two soldiers (4087) beside Sergeant 4085 punch or kick east every 4-6 ticks, each on
 *   its own count.
 * - The three soldiers round the table (4089-4091) face its middle and play the sitting-eating
 *   animation. Viewers only had them in sight 5-9 ticks at a time and saw it about once each,
 *   so the 4-7 tick interval is an estimate.
 */

const PUNCH = 422;
const KICK = 423;
const BLOCK = 424;
const DEFEND = 425;
const SITTING_EATING = 1145;

const DRILL_TICKS = 5;
/** The drill moves weighted by how often the captures saw each. */
const DRILL_MOVES = Object.freeze([[PUNCH, 95], [KICK, 60], [BLOCK, 94], [DEFEND, 32]]);
/** The soldiers copy the sergeant 40 client cycles into his move. */
const DRILL_DELAY = 40;

let core;
let SOLDIERS;
let tick = 0;
/** NPC -> the tick it next trains on, for the soldiers on their own count. */
const nextMove = new WeakMap();

function defineSoldiers({ NpcIdentifiers: N, Location }) {
  SOLDIERS = Object.freeze({
    drillSergeant: N.SERGEANT,
    drilled: N.SOLDIER_2,
    sparring: N.SOLDIER_3,
    eating: new Set([N.SOLDIER_5, N.SOLDIER_6, N.SOLDIER_7]),
    center: new Location(2895, 3536, 0),
    // The sergeant's tile is 2893,3541; his soldiers stand in two rows south of him.
    sergeantFaces: [0, -1],
    soldiersFace: [0, 1],
    sparringFace: [1, 0],
    table: [2893, 3532],
  });
}

const RADIUS = 8;

function pickDrillMove(random = Math.random()) {
  const total = DRILL_MOVES.reduce((sum, [, weight]) => sum + weight, 0);
  let roll = random * total;
  for (const [id, weight] of DRILL_MOVES) {
    if ((roll -= weight) < 0) return id;
  }
  return DRILL_MOVES[0][0];
}

const randomBetween = (min, max) => min + Math.floor(Math.random() * (max - min + 1));

function busy(npc) {
  return npc.getCombat?.()?.getTarget?.() != null;
}

function faceBy(npc, [dx, dy]) {
  const at = npc.getLocation();
  npc.setPositionToFace(new core.Location(at.getX() + dx, at.getY() + dy, at.getZ()));
}

function play(npc, id, delay = 0) {
  npc.performAnimation(new core.Animation(id, delay));
}

/** Plays a move when the NPC's own count runs out, then sets the next one. */
function onOwnCount(npc, minTicks, maxTicks, move) {
  const due = nextMove.get(npc);
  if (due == null) {
    nextMove.set(npc, tick + randomBetween(1, maxTicks));
    return;
  }
  if (tick < due) return;
  nextMove.set(npc, tick + randomBetween(minTicks, maxTicks));
  move();
}

function drill(npcs) {
  const sergeant = npcs.find((npc) => npc.getId() === SOLDIERS.drillSergeant);
  if (!sergeant || busy(sergeant)) return;
  const move = pickDrillMove();
  faceBy(sergeant, SOLDIERS.sergeantFaces);
  play(sergeant, move);
  for (const npc of npcs) {
    if (npc.getId() !== SOLDIERS.drilled || busy(npc)) continue;
    faceBy(npc, SOLDIERS.soldiersFace);
    play(npc, move, DRILL_DELAY);
  }
}

function train() {
  tick++;
  const npcs = core.World.getNpcsNear(SOLDIERS.center, RADIUS, null);
  if (tick % DRILL_TICKS === 0) drill(npcs);
  for (const npc of npcs) {
    if (busy(npc)) continue;
    if (npc.getId() === SOLDIERS.sparring) {
      onOwnCount(npc, 4, 6, () => {
        faceBy(npc, SOLDIERS.sparringFace);
        play(npc, Math.random() < 0.5 ? PUNCH : KICK);
      });
    } else if (SOLDIERS.eating.has(npc.getId())) {
      onOwnCount(npc, 4, 7, () => {
        npc.setPositionToFace(new core.Location(SOLDIERS.table[0], SOLDIERS.table[1], npc.getLocation().getZ()));
        play(npc, SITTING_EATING);
      });
    }
  }
}

function startTraining() {
  const task = new core.Task(1, "burthorpe-soldiers", false);
  task.execute = train;
  core.TaskManager.submit(task);
}

module.exports = {
  name: "Burthorpe",
  members: true,
  _test: { pickDrillMove, train, drill },
  register(pluginApi) {
    core = pluginApi.core;
    defineSoldiers(core);
    pluginApi.onServerStartup(startTraining);
  },
};
