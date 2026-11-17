/**
 * The shades, as recorded (rsprox 232/03119 [39]-[170], 227/01846; shades-of-mortton.json
 * `shades`):
 * - a shadow rises into its shade (the same NPC: a transformation, with shade_rise) when it is hit
 *   or when it starts a fight;
 * - a shade with nothing to fight sinks back into its shadow about 68 ticks later;
 * - every shade leaves its remains (Loar remains for a Loar shade...), as its only drop.
 */
const Common = require("./Common.ShadesOfMortton");

/** Risen shades: npc -> the tick of its last fight. */
const risen = new Map();
let tick = 0;
let byShadow = null;
/** The world's shadows, found again every so often (they respawn as new NPCs). */
let shadows = [];
const REFRESH_TICKS = 100;

/** shadow id -> { shade id, remains id }, from the cache's names. */
function pairs() {
  if (byShadow) return byShadow;
  byShadow = new Map();
  for (const { shadow, shade, remains } of Common.data.shades) {
    const shadowId = Common.npcId(shadow);
    if (shadowId != null) byShadow.set(shadowId, { shade: Common.npcId(shade), remains: Common.objId(remains) });
  }
  return byShadow;
}

function pairOf(npcId) {
  for (const [shadow, pair] of pairs()) {
    if (shadow === npcId || pair.shade === npcId) return pair;
  }
  return null;
}

const isShadow = (npc) => pairs().has(npc?.getId?.());
const fighting = (npc) => !!npc.getCombat?.()?.getTarget?.();

/**
 * The shadows in their areas (data `shadowAreas`, widened by `shadowReach`, so a shadow is found
 * wherever it wanders or is led in a fight), from a region query: walking World.getNpcs() steps
 * through every NPC slot (65535) each time it is asked.
 */
function findShadows() {
  const { World, Location } = Common.core;
  const reach = Common.data.shadowReach;
  const found = [];
  for (const [ax0, ay0, ax1, ay1, z] of Common.data.shadowAreas) {
    const [x0, y0, x1, y1] = [ax0 - reach, ay0 - reach, ax1 + reach, ay1 + reach];
    const cx = (x0 + x1 + 1) >> 1;
    const cy = (y0 + y1 + 1) >> 1;
    const radius = Math.max(cx - x0, x1 - cx, cy - y0, y1 - cy);
    for (const npc of World.getNpcsNear?.(new Location(cx, cy, z), radius) ?? []) {
      const at = npc.getLocation();
      if (isShadow(npc) && at.getX() >= x0 && at.getX() <= x1 && at.getY() >= y0 && at.getY() <= y1) found.push(npc);
    }
  }
  return found;
}

/**
 * The shadows to watch from now on: those found, plus every shadow already watched that is still in
 * the world (it is the same NPC wherever it has walked since), lowest index first as before.
 */
function refreshShadows() {
  const next = new Set(findShadows());
  for (const npc of shadows) {
    if (npc?.isRegistered?.() !== false && isShadow(npc)) next.add(npc);
  }
  return [...next].sort((a, b) => a.getIndex() - b.getIndex());
}

/** The shadow becomes its shade where it stands. */
function rise(npc) {
  if (risen.has(npc)) return;
  const pair = pairs().get(npc.getId());
  if (!pair?.shade) return;
  npc.setNpcTransformationId?.(pair.shade);
  npc.performAnimation?.(new Common.core.Animation(Common.data.riseAnimation));
  risen.set(npc, tick);
}

function sink(npc) {
  risen.delete(npc);
  npc.setNpcTransformationId?.(-1);
}

/** Recorded: the first hit on a shadow raises it (that tick or the next). */
function hitTaken({ npc }) {
  if (isShadow(npc)) rise(npc);
}

/** Each tick: shadows that start a fight rise; shades left alone long enough sink. */
function process() {
  tick++;
  if (tick % REFRESH_TICKS === 0 || shadows.length === 0) shadows = refreshShadows();
  for (const npc of shadows) {
    if (!npc?.isRegistered?.() && npc?.isRegistered) continue;
    if (!risen.has(npc)) {
      if (fighting(npc)) rise(npc);
      continue;
    }
    if (fighting(npc)) risen.set(npc, tick);
    else if (tick - risen.get(npc) >= Common.data.revertTicks && npc.getHitpoints?.() > 0) sink(npc);
  }
  return true;
}

/** Their remains are a shade's only drop (Wiki: always). */
function drops(event) {
  const zealot = Common.data.zealot;
  if (event?.drops && zealot.npcs.some((name) => Common.npcId(name) === (event.npcId ?? event.npc?.getId?.()))) {
    // Wiki: an Undead Zealot always drops bleached bones, on top of its tertiary scroll roll.
    event.drops.push({ itemId: Common.objId(zealot.bones), amount: 1 });
    return;
  }
  const pair = pairOf(event?.npcId ?? event?.npc?.getId?.());
  if (!pair?.remains || !event.drops) return;
  event.drops.length = 0;
  event.drops.push({ itemId: pair.remains, amount: 1 });
}

function died({ npc }) {
  risen.delete(npc);
}

function attachShades(api) {
  api.onNpcHitModify(hitTaken);
  api.onNpcDeath(died);
  api.onCustomEvent("npc-drops:roll", drops);
  Common.every(process);
}

/** For tests: the shadows to watch, as if just found. */
function watch(list) {
  shadows = list;
}

module.exports = { attachShades, watch, rise, sink, hitTaken, process, drops, risen, pairOf };
