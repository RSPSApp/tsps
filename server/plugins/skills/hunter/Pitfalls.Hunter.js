"use strict";

const C = require("./Context.Hunter"), { H, ANIM, requireLevel, hasTool, nearby, available, distance, begin, chance, hide } = C;
const Traps = require("./Traps.Hunter");

/*
 * Pitfalls, from rsprox captures (graahk 1108, 1858; kyatt 1757; sunlight antelope 1108, 4046, 4051) and the
 * Wiki (Pitfall trapping). Ticks count from the player's jump.
 * - Tease: the teasing animation with sound 2524 and no message; the creature then follows the player,
 *   stepping every tick.
 * - Catch: the creature steps across the pit edge one tile at a time (+3, +5, +6). At +8 the pit's varbit
 *   goes to 2 and the creature plays its fall, with the collapse graphic 933 or 935 and sound 2638. At +11
 *   the pit shows full (3 or 4, the same choice as the graphic) and the creature goes; it is back at its
 *   spawn a tick later, its animation reset. The same pit catches the next creature straight away (1757 ticks 19124, 19143).
 * - The creature crosses on the loc's own row or column and falls on the loc's coord (1108 tick 25272, 1757).
 * - Miss (1108 tick 21487): one step towards the pit at +3; at +5 the leap animation, sound 2619 and the
 *   creature's two leap projectiles (start 53, end 90 cycles) four tiles across; at +7 the creature lands beyond
 *   the pit, knocking a player standing there back two tiles (stumble 5206, sound 513), and follows on. Wiki: "these creatures will not jump the same pit twice in a row",
 *   and 1108 caught that creature at the next, different pit.
 */
const teased = new Map();
const lastPit = new WeakMap();
const runs = new Map();
const JUMP_SOUND = 2635;
const COLLAPSE_SOUND = 2638;
const LEAP_SOUND = 2619;
const KNOCKBACK = { animation: 5206, sound: 513, delay: 14, start: 10, end: 36, tiles: 2 };
// RuneLite SpotanimID (hunter_<creature>_leaptrap_proj1/2), validated with dump:spotanim; graahk captured (1108).
const LEAP_GRAPHICS = { SABRE_TOOTHED_KYATT: [937, 938], SPINED_LARUPIA: [939, 940], HORNED_GRAAHK: [941, 942],
  SUNLIGHT_ANTELOPE: [2800, 2801], MOONLIGHT_ANTELOPE: [2802, 2803] };
// The creature's sound with the full pit (+11): kyatt 1757, graahk 1108 and 1858, sunlight antelope 1108 and 4046.
// No larupia or moonlight antelope catch is captured.
const FULL_SOUNDS = { SABRE_TOOTHED_KYATT: 836, HORNED_GRAAHK: 667, SUNLIGHT_ANTELOPE: 7890 };
const TEASE_SOUND = 2524;
const STEP_TICKS = { catch: [3, 5, 6], leap: [3] };
const FALL_TICK = 8;
const FULL_TICK = 11;
const LEAP_TICK = 5;
const LAND_TICK = 7;
// hunting_pitfall_collapse_0 with full state 3, _2 with full state 4.
const COLLAPSE_GRAPHICS = { 3: 933, 4: 935 };
// Cache sequences: hunter_bigcat_leap_npc / unicorn_rework_leap_npc. Only the big-cat leap is captured.
const LEAP = { CAT: 5231, ANTELOPE: 10929 };
// Ours: no capture shows a teased creature giving up the chase, so it keeps the old 30 seconds and 16 tiles.
const CHASE_TICKS = 50;
const CHASE_RANGE = 16;
const NO_STICK = "I don't want to lose a finger by poking it. Maybe I should get a professional teasing implement instead.";

function build({ player, object }) {
  const def = H.core.CacheDefinitions.getObject(object.getId());
  if (def.transforms?.[0] !== H.core.ObjectIdentifiers.PIT_4) return false;
  Traps.lay(player, "pit", object.getLocation(), object);
  return true;
}

function tease({ player, npc, npcId }) {
  const creature = H.data.creatures.find(c => c.npc === npcId && c.trap === "pit");
  if (!creature) return false;
  if (!hasTool(player, H.core.ItemIdentifiers.TEASING_STICK) && !hasTool(player, H.core.ItemIdentifiers.HUNTERS_SPEAR)) { player.sendMessage(NO_STICK); return true; }
  if (!requireLevel(player, creature.level) || !nearby(player, npc) || !available(npc) || teased.has(player)) return true;
  const state = { player, npc, creature, due: H.tick + CHASE_TICKS, attack: H.tick + 4 };
  if (begin(player, 1, ANIM.TEASE, () => {
    if (!available(npc) || !nearby(player, npc) || !requireLevel(player, creature.level)) return;
    H.reserved.set(npc, state); teased.set(player, state);
    npc.getMovementQueue().reset();
    npc.setFollowing(player);
  })) player.getPacketSender().sendSound(TEASE_SOUND, 1, 0);
  return true;
}

function clear({ player }) {
  const state = teased.get(player);
  if (!state) return;
  const run = runs.get(state.npc);
  if (run?.kind === "leap") land(state.npc, run);
  teased.delete(player);
  lastPit.delete(state.npc);
  if (H.reserved.get(state.npc) === state) H.reserved.delete(state.npc);
  state.npc.getMovementQueue().resetFollow();
  state.npc.getMovementQueue().reset();
}

/** The pit's footprint: the base loc's tiles, turned with its rotation. */
function footprint(base) {
  const def = H.core.CacheDefinitions.getObject(base.getId()), at = base.getLocation();
  const turned = base.getFace() % 2 === 1, sizeX = def?.sizeX ?? 2, sizeY = def?.sizeY ?? 2;
  const width = turned ? sizeY : sizeX, length = turned ? sizeX : sizeY;
  return { x0: at.getX(), y0: at.getY(), x1: at.getX() + width - 1, y1: at.getY() + length - 1, z: at.getZ() };
}

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

/** Which way a jump from `from` crosses the pit: 0 north, 1 east, 2 south, 3 west. */
function heading(base, from) {
  const f = footprint(base), x = from.getX(), y = from.getY();
  const gapX = x < f.x0 ? f.x0 - x : x > f.x1 ? x - f.x1 : 0;
  const gapY = y < f.y0 ? f.y0 - y : y > f.y1 ? y - f.y1 : 0;
  // A corner start crosses along the pit (rotations 0 and 2 run north-south, 1 and 3 east-west).
  const alongY = gapY > gapX || (gapY === gapX && base.getFace() % 2 === 0);
  return alongY ? (y < f.y0 ? 0 : 2) : (x < f.x0 ? 1 : 3);
}

/** The tile beyond the pit on the line through `from`, heading `dir`: live lands three tiles from the edge. */
function beyond(base, from, dir) {
  const f = footprint(base), x = clamp(from.getX(), f.x0, f.x1), y = clamp(from.getY(), f.y0, f.y1);
  return [new H.core.Location(x, f.y1 + 1, f.z), new H.core.Location(f.x1 + 1, y, f.z),
    new H.core.Location(x, f.y0 - 1, f.z), new H.core.Location(f.x0 - 1, y, f.z)][dir];
}

/**
 * Where a creature of `size` crosses a pit heading `dir`: on the loc's own row or column, from the tile before the
 * pit (`edge`) to the loc's coord (`base`, where it falls) or, leaping, to the first tile clear beyond (`landing`).
 */
function crossing(base, dir, size) {
  const f = footprint(base), L = (a, b) => new H.core.Location(a, b, f.z);
  const edge = [L(f.x0, f.y0 - size), L(f.x0 - size, f.y0), L(f.x0, f.y1 + 1), L(f.x1 + 1, f.y0)][dir];
  const landing = [L(f.x0, f.y1 + 1), L(f.x1 + 1, f.y0), L(f.x0, f.y0 - size), L(f.x0 - size, f.y0)][dir];
  return { edge, base: L(f.x0, f.y0), landing };
}

const STEPS = [[0, 1], [1, 0], [0, -1], [-1, 0]];

/** The full pit's varbit value: 3 when the jump runs the loc's own way ((rotation + 2) % 4), 4 the other way. */
function fullValue(base, dir) {
  return dir === (base.getFace() + 2) % 4 ? 3 : 4;
}

function center(trap) {
  const f = footprint(trap.base);
  return new H.core.Location((f.x0 + f.x1) >> 1, (f.y0 + f.y1) >> 1, f.z);
}

function antelope(creature) {
  const N = H.core.NpcIdentifiers;
  return creature.npc === N.SUNLIGHT_ANTELOPE || creature.npc === N.MOONLIGHT_ANTELOPE;
}

function jump({ player, object }) {
  const trap = Traps.owned(player, object);
  if (!trap || trap.kind !== "pit") return false;
  if (!nearby(player, object, 3) || trap.state !== "idle") return true;
  const state = teased.get(player);
  if (state && runs.has(state.npc)) return true;
  if (state && (!H.core.CacheDefinitions.getObject(trap.base.getId()).transforms?.includes(state.creature.caught)
    || lastPit.get(state.npc) === trap.base)) { player.sendMessage("Lure this creature across a different pit."); return true; }
  const from = player.getLocation().clone(), dir = heading(trap.base, from);
  const destination = beyond(trap.base, from, dir);
  if (H.core.RegionManager.blocked(destination, trap.area)) { player.sendMessage("You cannot land on the other side of this pit."); return true; }
  const jumpedAt = H.tick;
  const started = begin(player, 2, ANIM.JUMP, () => {
    player.setForceMovement(null);
    if (!H.traps.has(trap) || trap.state !== "idle") return;
    player.moveTo(destination);
    if (!state || teased.get(player) !== state || runs.has(state.npc) || distance(state.npc.getLocation(), center(trap)) > 5) return;
    if (!requireLevel(player, state.creature.level)) return;
    const success = chance(player, state.creature, hasTool(player, H.core.ItemIdentifiers.HUNTERS_SPEAR) ? 0.05 : 0);
    run(state, trap, dir, success, jumpedAt);
  }, () => player.setForceMovement(null));
  if (started) {
    pitSound(trap, JUMP_SOUND);
    const delta = new H.core.Location(destination.getX() - from.getX(), destination.getY() - from.getY());
    player.getMovementQueue().reset();
    player.setForceMovement(new H.core.ForceMovement(from.clone(), delta, 0, 60, dir, ANIM.JUMP));
  }
  return true;
}

/** Starts the creature over the pit after the player's jump: a catch, or a leap across it. */
function run(state, trap, dir, success, jumpedAt) {
  const npc = state.npc, queue = npc.getMovementQueue();
  queue.resetFollow();
  queue.reset();
  const size = npc.getSize?.() ?? 1, line = crossing(trap.base, dir, size);
  runs.set(npc, { kind: success ? "catch" : "leap", state, trap, dir, at: jumpedAt, size,
    path: success ? [line.edge, line.base] : [line.edge], blocked: queue.isMovementBlocked(),
    landing: line.landing, value: fullValue(trap.base, dir), fallen: false });
  queue.setBlockMovement(true);
  if (success) {
    // The creature is the pit's now; the chase ends but it stays reserved until it falls.
    teased.delete(state.player);
    lastPit.delete(npc);
    trap.state = "closing";
    trap.expires = Math.max(trap.expires, H.tick + FULL_TICK);
  } else lastPit.set(npc, trap.base);
}

/**
 * One tile towards the next tile of the crossing the creature hasn't reached. An exact move keeps it in view:
 * a plain moveTo drops an NPC from every client for a tick (World.staysInViewWhenPlaced).
 */
function step(npc, path) {
  const at = npc.getLocation();
  while (path.length && path[0].equals(at)) path.shift();
  const next = path[0];
  if (!next) return;
  npc.exactMove(new H.core.Location(at.getX() + Math.sign(next.getX() - at.getX()), at.getY() + Math.sign(next.getY() - at.getY()), at.getZ()));
}

function advance(npc, r) {
  const elapsed = H.tick - r.at;
  if (!npc.isRegistered()) { runs.delete(npc); return; }
  if (r.kind === "catch") {
    // Live re-adds the creature at its spawn with its animation cleared (sequence -1).
    if (elapsed > FULL_TICK) { runs.delete(npc); npc.performAnimation(H.core.Animation.DEFAULT_RESET_ANIMATION); return; }
    if (!H.traps.has(r.trap) || r.trap.state !== "closing") {
      // The pit went (its owner left): a creature that hadn't fallen yet is free again.
      if (r.fallen) runs.delete(npc); else abort(npc, r);
      return;
    }
    if (STEP_TICKS.catch.includes(elapsed)) step(npc, r.path);
    if (elapsed === FALL_TICK) fall(npc, r);
    if (elapsed === FULL_TICK) {
      Traps.setPitState(r.trap, "caught", r.state.creature, r.value);
      const sound = Object.entries(FULL_SOUNDS).find(([key]) => H.core.NpcIdentifiers[key] === r.state.creature.npc)?.[1];
      if (sound) pitSound(r.trap, sound, r.trap.base.getLocation());
    }
    return;
  }
  if (STEP_TICKS.leap.includes(elapsed)) step(npc, r.path);
  if (elapsed === LEAP_TICK) leap(npc, r);
  if (elapsed >= LAND_TICK) land(npc, r);
}

function leap(npc, r) {
  npc.performAnimation(new H.core.Animation(antelope(r.state.creature) ? LEAP.ANTELOPE : LEAP.CAT));
  npc.setPositionToFace(r.landing);
  const at = npc.getLocation(), [dx, dy] = STEPS[r.dir], far = r.size - 1;
  const graphics = Object.entries(LEAP_GRAPHICS).find(([key]) => H.core.NpcIdentifiers[key] === npc.getId())?.[1] ?? [];
  // proj1 from the creature's far corner, proj2 from its own tile, both four tiles across (1108 tick 21492).
  const starts = [at.clone().add(far, far), at.clone()];
  for (const viewer of viewers(r.state.player, r.trap)) {
    graphics.forEach((graphic, i) => viewer.getPacketSender().sendProjectile(starts[i], starts[i].clone().add(dx * 4, dy * 4),
      0, 90, graphic, 0, 0, null, 53, 0, 0));
  }
  H.core.Sounds.playAreaSound({ soundId: LEAP_SOUND, x: at.getX(), y: at.getY(), level: at.getZ(), radius: 5 });
}

function viewers(player, trap) {
  return [...new Set([player, ...(H.core.World.getNearbyPlayersForUpdate?.(player) ?? [])])]
    .filter(viewer => viewer.getPrivateArea() === trap.area);
}

/** A creature landing on the player knocks them back two tiles along the leap (1108 tick 21494). */
function knockBack(player, r) {
  const at = player.getLocation(), l = r.landing, [dx, dy] = STEPS[r.dir];
  const under = at.getZ() === l.getZ() && at.getX() >= l.getX() && at.getX() < l.getX() + r.size
    && at.getY() >= l.getY() && at.getY() < l.getY() + r.size;
  if (!under || player.getForceMovement() || H.actions.has(player)) return;
  const to = at.clone().add(dx * KNOCKBACK.tiles, dy * KNOCKBACK.tiles);
  for (let i = 1; i <= KNOCKBACK.tiles; i++) if (H.core.RegionManager.blocked(at.clone().add(dx * i, dy * i), r.trap.area)) return;
  player.getMovementQueue().reset();
  player.setForceMovement(new H.core.ForceMovement(at.clone(), new H.core.Location(to.getX() - at.getX(), to.getY() - at.getY()),
    KNOCKBACK.start, KNOCKBACK.end, r.dir, KNOCKBACK.animation));
  player.moveTo(to);
  player.getPacketSender().sendSound(KNOCKBACK.sound, 1, KNOCKBACK.delay);
}

function fall(npc, r) {
  const creature = r.state.creature;
  r.fallen = true;
  Traps.setPitState(r.trap, "closing", null);
  npc.performAnimation(new H.core.Animation(antelope(creature) ? ANIM.ANTELOPE_FALL : ANIM.CAT_FALL));
  npc.performGraphic(new H.core.Graphic(COLLAPSE_GRAPHICS[r.value]));
  pitSound(r.trap, COLLAPSE_SOUND);
  npc.getMovementQueue().setBlockMovement(r.blocked);
  // Gone with the full pit (+11), back at its spawn a tick later.
  hide(npc, FULL_TICK - FALL_TICK + 1, FULL_TICK - FALL_TICK);
}

/** Frees a creature whose pit went before it fell. */
function abort(npc, r) {
  runs.delete(npc);
  npc.getMovementQueue().setBlockMovement(r.blocked);
  if (H.reserved.get(npc) === r.state) H.reserved.delete(npc);
}

function land(npc, r) {
  runs.delete(npc);
  if (!npc.isRegistered()) return;
  // Live telejumps it; the exact move (ending at once) keeps it in view on our clients.
  npc.exactMove(r.landing, { startCycles: 0, endCycles: 1 });
  if (r.state.player.isRegistered()) knockBack(r.state.player, r);
  npc.getMovementQueue().setBlockMovement(r.blocked);
  if (teased.get(r.state.player) === r.state) npc.setFollowing(r.state.player);
}

function pitSound(trap, soundId, at = center(trap)) {
  H.core.Sounds.playAreaSound({ soundId, x: at.getX(), y: at.getY(), level: at.getZ(), radius: 10 });
}

function process() {
  for (const [npc, r] of runs) advance(npc, r);
  for (const [player, state] of teased) {
    if (runs.has(state.npc)) continue;
    if (H.tick >= state.due || !state.npc.isRegistered() || !state.npc.isVisible() || !player.isRegistered()
      || !nearby(player, state.npc, CHASE_RANGE)) { clear({ player }); continue; }
    if (state.npc.getFollowing() !== player) state.npc.setFollowing(player);
    if (H.tick >= state.attack && nearby(player, state.npc, 1) && !player.getForceMovement()) {
      state.attack = H.tick + 4;
      const protectedMelee = H.core.PrayerHandler.isActivated(player, H.core.PrayerHandler.PROTECT_FROM_MELEE);
      if (!protectedMelee) {
        const I = H.core.ItemIdentifiers;
        const gear = [[I.KYATT_HAT,I.KYATT_TOP,I.KYATT_LEGS,0.4],[I.GRAAHK_HEADDRESS,I.GRAAHK_TOP,I.GRAAHK_LEGS,0.6],[I.LARUPIA_HAT,I.LARUPIA_TOP,I.LARUPIA_LEGS,0.8]];
        const multiplier = gear.find(set => set.slice(0,3).every(id => player.getEquipment().getItems().some(item => item?.getId() === id)))?.[3] ?? 1;
        const max = [H.core.NpcIdentifiers.SABRE_TOOTHED_KYATT,H.core.NpcIdentifiers.HORNED_GRAAHK].includes(state.creature.npc) ? 7 : 5;
        player.getCombat().getHitQueue().addPendingDamage([new H.core.HitDamage(Math.floor(C.roll(0,max) * multiplier),H.core.HitMask.RED)]);
      }
    }
  }
}

/** Frees every creature mid-run, so a reload never leaves one blocked. */
function shutdown() {
  for (const [npc, r] of [...runs]) {
    if (r.kind === "leap") land(npc, r);
    else if (!r.fallen) abort(npc, r);
    else runs.delete(npc);
  }
  for (const player of [...teased.keys()]) clear({ player });
}

module.exports = { build, tease, jump, clear, process, shutdown, heading, beyond, crossing, fullValue };
