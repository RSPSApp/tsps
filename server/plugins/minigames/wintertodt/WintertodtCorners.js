"use strict";

/**
 * The four corners: each brazier's state and its pyromancer's health.
 *
 * Wiki: a pyromancer has 14 health; at 0 she is incapacitated until healed with a dose of
 * rejuvenation potion, and her brazier can't be lit until then. After a brazier is lit or its
 * pyromancer healed she waits roughly 1-5 seconds before she drains the Wintertodt again.
 * Transcript: "Light this brazier!", "Fix this brazier!" and the chant "Yemalo shi cardito!"
 * (anim 4432 in the captures) every 10 to 14 ticks; "Arg, it got me!" as she falls.
 */

const Shared = require("./WintertodtShared");

const PYROMANCER_HITPOINTS = 14;
const RESUME_DELAY = { min: 2, max: 8 };
const CHATTER_TICKS = { min: 10, max: 14 };
const INCAPACITATED_LINES = ["Mummy!", "My flame burns low.", "We are doomed.", "I think I'm dying.", "Ugh, help me!"];
const BRAZIER_LINES = {
  [Shared.BRAZIER.UNLIT]: "Light this brazier!",
  [Shared.BRAZIER.BROKEN]: "Fix this brazier!",
  [Shared.BRAZIER.LIT]: "Yemalo shi cardito!",
};
const BRAZIER_OBJECTS = {
  [Shared.BRAZIER.UNLIT]: Shared.OBJECT.BRAZIER_UNLIT,
  [Shared.BRAZIER.BROKEN]: Shared.OBJECT.BRAZIER_BROKEN,
  [Shared.BRAZIER.LIT]: Shared.OBJECT.BRAZIER_LIT,
};
/** The green bolts fly from the brazier toward the storm, one every other tick. */
const BOLT_PERIOD = 2;
const BOLT_TILES = 9;
const BOLT_TICKS = 7;

const state = Shared.CORNERS.map((corner) => ({
  corner,
  brazier: Shared.BRAZIER.UNLIT,
  pyromancerHealthy: true,
  pyromancerHp: PYROMANCER_HITPOINTS,
  resumeAt: 0,
  chatterAt: 0,
  /** A Wintertodt attack is on its way to this brazier or pyromancer. */
  brazierTargeted: false,
  pyromancerTargeted: false,
}));

let now = 0;

function random(min, max) {
  return min + Math.floor(Math.random() * (max - min + 1));
}

function corner(index) {
  return state[index];
}

function indexOfBrazier(location) {
  return state.findIndex((c) => location.getX() === c.corner.brazier.x && location.getY() === c.corner.brazier.y);
}

/** The corner whose brazier (3x3 from its south-west tile) is nearest the tile. */
function nearestCorner(location) {
  let best = 0;
  let bestDistance = Infinity;
  state.forEach((c, index) => {
    const d = Shared.distance(location, { x: c.corner.brazier.x + 1, y: c.corner.brazier.y + 1 });
    if (d < bestDistance) {
      best = index;
      bestDistance = d;
    }
  });
  return best;
}

function litCount() {
  return state.filter((c) => c.brazier === Shared.BRAZIER.LIT).length;
}

/** Draining: a lit brazier and a healthy pyromancer who has resumed channelling. */
function isDraining(index) {
  const c = state[index];
  return c.brazier === Shared.BRAZIER.LIT && c.pyromancerHealthy && now >= c.resumeAt;
}

function setObject(id, tile) {
  const { GameObject, ObjectManager } = Shared.core();
  ObjectManager.register(new GameObject(id, Shared.loc(tile), 10, 0, null), true);
}

function pyromancerNpc(index) {
  const tile = state[index].corner.pyromancer;
  const { World } = Shared.core();
  for (const npc of World.getNpcs()) {
    if (!npc) continue;
    const at = npc.getLocation();
    if (at.getX() === tile.x && at.getY() === tile.y && at.getZ() === 0) return npc;
  }
  return null;
}

function say(index, text) {
  pyromancerNpc(index)?.forceChat(text);
  state[index].chatterAt = now + random(CHATTER_TICKS.min, CHATTER_TICKS.max);
}

function setBrazier(index, brazier) {
  const c = state[index];
  if (c.brazier === brazier) return;
  c.brazier = brazier;
  setObject(BRAZIER_OBJECTS[brazier], c.corner.brazier);
  if (brazier === Shared.BRAZIER.LIT) c.resumeAt = now + random(RESUME_DELAY.min, RESUME_DELAY.max);
  if (c.pyromancerHealthy) say(index, BRAZIER_LINES[brazier]);
}

/** Shows the pyromancer's health over her head: hits never take her own hitpoints. */
function showHit(npc, damage, hp) {
  npc?.showHitsplat?.(damage, { mine: 16, others: 17 }, { current: hp, max: PYROMANCER_HITPOINTS });
}

/** Returns true if this hit incapacitated her. */
function damagePyromancer(index, damage) {
  const c = state[index];
  if (!c.pyromancerHealthy) return false;
  c.pyromancerHp = Math.max(0, c.pyromancerHp - damage);
  const npc = pyromancerNpc(index);
  showHit(npc, damage, c.pyromancerHp);
  if (c.pyromancerHp > 0) return false;
  c.pyromancerHealthy = false;
  npc?.setNpcTransformationId(Shared.NPC.INCAPACITATED_PYROMANCER);
  if (npc) Shared.animate(npc, Shared.ANIM.PYROMANCER_FALL);
  say(index, "Arg, it got me!");
  return true;
}

function healPyromancer(index) {
  const c = state[index];
  const wasDown = !c.pyromancerHealthy;
  c.pyromancerHp = PYROMANCER_HITPOINTS;
  c.pyromancerHealthy = true;
  c.resumeAt = now + random(RESUME_DELAY.min, RESUME_DELAY.max);
  const npc = pyromancerNpc(index);
  if (wasDown) {
    npc?.setNpcTransformationId(Shared.NPC.PYROMANCER);
    if (npc) Shared.animate(npc, -1);
  }
}

function resetAll() {
  state.forEach((c, index) => {
    c.brazier = Shared.BRAZIER.UNLIT;
    c.brazierTargeted = false;
    c.pyromancerTargeted = false;
    setObject(Shared.OBJECT.BRAZIER_UNLIT, c.corner.brazier);
    if (!c.pyromancerHealthy) healPyromancer(index);
    c.pyromancerHp = PYROMANCER_HITPOINTS;
  });
}

function chatter(index) {
  const c = state[index];
  if (now < c.chatterAt) return;
  if (!c.pyromancerHealthy) {
    say(index, INCAPACITATED_LINES[Math.floor(Math.random() * INCAPACITATED_LINES.length)]);
    return;
  }
  if (c.brazier === Shared.BRAZIER.LIT) {
    const npc = pyromancerNpc(index);
    if (npc) Shared.animate(npc, Shared.ANIM.PYROMANCER_CHANT);
  }
  say(index, BRAZIER_LINES[c.brazier]);
}

/** A bolt from the brazier, walking toward the storm and fading out. */
function fireBolt(index) {
  const api = Shared.api();
  const { brazier } = state[index].corner;
  const from = { x: brazier.x + 1, y: brazier.y + 1 };
  const dx = Math.sign(Shared.STORM_TILE.x + 1 - from.x);
  const dy = Math.sign(Shared.STORM_TILE.y + 1 - from.y);
  const npc = api?.spawnNpc?.({ id: Shared.NPC.FIRE, x: from.x + dx * 2, y: from.y + dy * 2, z: 0, wanderRadius: 0 });
  if (!npc) return;
  npc.setFlag?.("movement:ignore-clipping");
  npc.getMovementQueue().addSteps(Shared.loc({ x: from.x + dx * BOLT_TILES, y: from.y + dy * BOLT_TILES }));
  Shared.later(npc, BOLT_TICKS, () => api.removeNpc(npc));
}

/** Every tick of a round: the pyromancers talk and the draining ones send bolts. */
function tick(ticks) {
  now = ticks;
  state.forEach((c, index) => {
    chatter(index);
    if (isDraining(index) && ticks % BOLT_PERIOD === index % BOLT_PERIOD) fireBolt(index);
  });
}

function setNow(ticks) {
  now = ticks;
}

module.exports = {
  PYROMANCER_HITPOINTS,
  state, corner, indexOfBrazier, nearestCorner, litCount, isDraining,
  setBrazier, damagePyromancer, healPyromancer, resetAll, pyromancerNpc, say, tick, setNow,
};
