"use strict";

const C = require("./Context.Hunter"), { H, ANIM, requireLevel, hasTool, nearby, available, distance, begin, chance, hide } = C;
const Traps = require("./Traps.Hunter");

/*
 * Pitfalls, from rsprox captures (spined larupia: the user's main-game capture hunter/larupia, rev 242; graahk
 * 1108, 1858; kyatt 1757; sunlight antelope 1108, 4046, 4051) and the Wiki (Pitfall trapping). Ticks count from
 * the player's jump.
 * - Tease: the teasing animation with sound 2524 and no message; the creature then follows the player,
 *   stepping every tick, for about 100 ticks (larupia: teased at 252, gave up at 355).
 * - Catch: the creature steps one tile at a time onto the loc's coord, along its row or column (`catchSchedule`:
 *   2 tiles out at +5 and +6, 3 at +3, +5, +6, 4 at +3, +5, +7, +8). Two ticks after its last step the pit's
 *   varbit goes to 2 and it plays its fall, with the collapse graphic 933 or 935 and sound 2638 (+8 from 2 or 3
 *   tiles, +10 from 4). Three ticks later the pit shows full (3 or 4, the same choice as the graphic) with the
 *   creature's sound, and it goes; it is back at its spawn a tick later, its animation reset. The same pit catches
 *   the next creature straight away (1757 ticks 19124, 19143; larupia ticks 201, 229).
 * - Miss (1108 tick 21487; larupia tick 422): one step towards the pit at +3; at +5 the leap animation, sound
 *   2619 and the creature's two leap projectiles (start 53, end 90 cycles) four tiles across; at +7 the creature
 *   lands beyond the pit, knocking a player standing there back two tiles (stumble 5206, sound 513), and follows on.
 * - That creature won't use that pit again, even teased afresh, until it is caught: the player still jumps and
 *   three ticks later gets "The larupia won't jump the same pit twice in a row." (larupia ticks 438, 471).
 */
// Teased creatures by NPC: a player may have several chasing at once (larupia capture ticks 370 and 399).
const teased = new Map();
const lastPit = new WeakMap();
const runs = new Map();
// Timed one-offs: the refusal line, clearing a knock-back's forced movement.
const later = [];
const JUMP_SOUND = 2635;
const COLLAPSE_SOUND = 2638;
const LEAP_SOUND = 2619;
// Live sends the pit's area sounds with range 5; the jump sound plays on the player's start tile (1108 tick 21563).
const SOUND_RANGE = 5;
const KNOCKBACK = { animation: 5206, sound: 513, delay: 14, start: 10, end: 36, tiles: 2, ticks: 2 };
// RuneLite SpotanimID (hunter_<creature>_leaptrap_proj1/2), validated with dump:spotanim; graahk captured (1108).
const LEAP_GRAPHICS = { SABRE_TOOTHED_KYATT: [937, 938], SPINED_LARUPIA: [939, 940], HORNED_GRAAHK: [941, 942],
  SUNLIGHT_ANTELOPE: [2800, 2801], MOONLIGHT_ANTELOPE: [2802, 2803] };
// The creature's sound with the full pit: kyatt 1757, graahk 1108 and 1858, larupia (panther_death, as the graahk),
// sunlight antelope 1108 and 4046. No moonlight antelope catch is captured.
const FULL_SOUNDS = { SABRE_TOOTHED_KYATT: 836, HORNED_GRAAHK: 667, SPINED_LARUPIA: 667, SUNLIGHT_ANTELOPE: 7890 };
const TEASE_SOUND = 2524;
// A miss steps once towards the pit's edge at +3 before it leaps.
const EDGE_TICK = 3;
const LEAP_TICK = 5;
// After the last step the creature falls 2 ticks later and the pit shows full 3 after that.
const FALL_AFTER_STEP = 2;
const FULL_AFTER_FALL = 3;
// The refusal at a pit the creature has leapt: three ticks after the jump.
const REFUSAL_TICKS = 3;
const LAND_TICK = 7;
// hunting_pitfall_collapse_0 with full state 3, _2 with full state 4.
const COLLAPSE_GRAPHICS = { 3: 933, 4: 935 };
// Cache sequences: hunter_bigcat_leap_npc / unicorn_rework_leap_npc. Only the big-cat leap is captured.
const LEAP = { CAT: 5231, ANTELOPE: 10929 };
// Larupia capture: teased at tick 252, still biting at 334 and following at 348, gave up at 355. Ours: the 16-tile
// range (a larupia 12 tiles behind kept following).
const CHASE_TICKS = 100;
const CHASE_RANGE = 16;
// The bite (larupia capture): hunter_big_cat_bite and panther_attack three ticks after the tease, then every four
// ticks while beside the player, who blocks with 511 on a miss or one of human_hit_1-4 (518-521) on a hit.
const BITE = { animation: 5228, sound: 666, first: 3, every: 4, block: 511, hits: [518, 519, 520, 521], soundDelay: 20 };
// The spawn radius the engine keeps NPCs to; lifted while teased so its walk home doesn't fight the chase.
const CHASE_RADIUS = 64;
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
  if (!requireLevel(player, creature.level) || !nearby(player, npc) || !available(npc)) return true;
  const state = { player, npc, creature, due: H.tick + CHASE_TICKS, attack: H.tick + BITE.first, radius: null };
  if (begin(player, 1, ANIM.TEASE, () => {
    if (!available(npc) || !nearby(player, npc) || !requireLevel(player, creature.level)) return;
    H.reserved.set(npc, state); teased.set(npc, state);
    const coordinator = npc.getMovementCoordinator?.();
    if (coordinator) { state.radius = coordinator.getRadius(); coordinator.setRadius(Math.max(state.radius, CHASE_RADIUS)); }
    npc.getMovementQueue().reset();
    npc.setFollowing(player);
  })) player.getPacketSender().sendSound(TEASE_SOUND, 1, 0);
  return true;
}

/** The player's teased creatures. */
function chasing(player) {
  return [...teased.values()].filter(state => state.player === player);
}

/** Ends one creature's chase: it stops following and the engine walks it home again. */
function release(state) {
  if (teased.get(state.npc) !== state) return;
  teased.delete(state.npc);
  if (state.radius != null) state.npc.getMovementCoordinator?.()?.setRadius(state.radius);
  const run = runs.get(state.npc);
  if (run?.kind === "leap") land(state.npc, run);
  if (H.reserved.get(state.npc) === state) H.reserved.delete(state.npc);
  if (runs.has(state.npc)) return;
  state.npc.getMovementQueue().resetFollow();
  state.npc.getMovementQueue().reset();
}

function clear({ player }) {
  for (const state of chasing(player)) release(state);
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
  // The teased creature nearest the pit follows the player over it, one that hasn't just leapt this pit first;
  // only when every one near has does the pit refuse (ours: live captures show one chaser at a time).
  const near = () => {
    const close = chasing(player).filter(s => !runs.has(s.npc) && distance(s.npc.getLocation(), center(trap)) <= 5)
      .sort((a, b) => distance(a.npc.getLocation(), center(trap)) - distance(b.npc.getLocation(), center(trap)));
    return close.find(s => lastPit.get(s.npc) !== trap.base) ?? close[0];
  };
  const state = near();
  // Ours: no capture shows a creature jumped at another creature's pit.
  if (state && !H.core.CacheDefinitions.getObject(trap.base.getId()).transforms?.includes(state.creature.caught)) {
    player.sendMessage("Lure this creature across a different pit."); return true;
  }
  const from = player.getLocation().clone(), dir = heading(trap.base, from);
  const destination = beyond(trap.base, from, dir);
  if (H.core.RegionManager.blocked(destination, trap.area)) { player.sendMessage("You cannot land on the other side of this pit."); return true; }
  const jumpedAt = H.tick;
  const started = begin(player, 2, ANIM.JUMP, () => {
    player.setForceMovement(null);
    if (!H.traps.has(trap) || trap.state !== "idle") return;
    player.moveTo(destination);
    const follower = near();
    if (!follower || distance(follower.npc.getLocation(), center(trap)) > 5) return;
    if (follower !== state && !H.core.CacheDefinitions.getObject(trap.base.getId()).transforms?.includes(follower.creature.caught)) return;
    jumpWith(follower, player, trap, dir, jumpedAt);
  }, () => player.setForceMovement(null));
  if (started) {
    pitSound(trap, JUMP_SOUND, from);
    const delta = new H.core.Location(destination.getX() - from.getX(), destination.getY() - from.getY());
    player.getMovementQueue().reset();
    player.setForceMovement(new H.core.ForceMovement(from.clone(), delta, 0, 60, dir, ANIM.JUMP));
  }
  return true;
}

/** The creature's answer to the jump: refusing a pit it has leapt, or running over it to a catch or a leap. */
function jumpWith(state, player, trap, dir, jumpedAt) {
  if (lastPit.get(state.npc) === trap.base) {
    const text = `The ${shortName(state)} won't jump the same pit twice in a row.`;
    later.push({ due: jumpedAt + REFUSAL_TICKS, run: () => { if (player.isRegistered()) player.sendMessage(text); } });
    return;
  }
  if (!requireLevel(player, state.creature.level)) return;
  const success = chance(player, state.creature, hasTool(player, H.core.ItemIdentifiers.HUNTERS_SPEAR) ? 0.05 : 0);
  run(state, trap, dir, success, jumpedAt);
}

/** "larupia" from "Spined larupia". Ours for the other creatures: only the larupia's line is captured. */
function shortName(state) {
  const name = String(H.core.CacheDefinitions.getNpc(state.npc.getId())?.name ?? state.creature.name ?? "creature");
  return name.split(" ").at(-1).toLowerCase();
}

/**
 * The ticks after the jump a caught creature steps on, from how many tiles it is from the loc coord: one tile
 * every other tick from +3, the last two on consecutive ticks, never before +5 (captures 1108, 1757, 1858 and
 * larupia ticks 201, 229, 506). Ours: a creature already beside or on the loc coord.
 */
function catchSchedule(tiles) {
  if (tiles <= 0) return [];
  if (tiles === 1) return [6];
  const last = Math.max(5, 3 + 2 * (tiles - 2));
  const early = Array.from({ length: Math.max(0, tiles - 2) }, (_, i) => 3 + 2 * i);
  return [...early, last, last + 1];
}

/** Starts the creature over the pit after the player's jump: a catch, or a leap across it. */
function run(state, trap, dir, success, jumpedAt) {
  const npc = state.npc, queue = npc.getMovementQueue();
  queue.resetFollow();
  queue.reset();
  const size = npc.getSize?.() ?? 1, line = crossing(trap.base, dir, size);
  const steps = catchSchedule(distance(npc.getLocation(), line.base));
  const fallAt = Math.max(8, (steps.at(-1) ?? 5) + FALL_AFTER_STEP);
  runs.set(npc, { kind: success ? "catch" : "leap", state, trap, dir, at: jumpedAt, size,
    edge: line.edge, base: line.base, blocked: queue.isMovementBlocked(), steps, fallAt, fullAt: fallAt + FULL_AFTER_FALL,
    landing: line.landing, value: fullValue(trap.base, dir), fallen: false });
  queue.setBlockMovement(true);
  if (success) {
    // The creature is the pit's now; the chase ends but it stays reserved until it falls.
    release(state);
    H.reserved.set(npc, state);
    lastPit.delete(npc);
    trap.state = "closing";
    trap.expires = Math.max(trap.expires, jumpedAt + fallAt + FULL_AFTER_FALL + 2);
  } else lastPit.set(npc, trap.base);
}

/**
 * Moves the creature to `to`, or with `oneTile` a single tile towards it. An exact move keeps it in view: a
 * plain moveTo drops an NPC from every client for a tick (World.staysInViewWhenPlaced).
 */
function moveTowards(npc, to, oneTile = false) {
  const at = npc.getLocation();
  if (at.equals(to)) return;
  npc.exactMove(oneTile ? new H.core.Location(at.getX() + Math.sign(to.getX() - at.getX()),
    at.getY() + Math.sign(to.getY() - at.getY()), at.getZ()) : to.clone());
}

function advance(npc, r) {
  const elapsed = H.tick - r.at;
  if (!npc.isRegistered()) {
    // Gone before it fell (an NPC reload): free the pit for another creature.
    if (r.kind === "catch" && !r.fallen) {
      abort(npc, r);
      if (H.traps.has(r.trap) && r.trap.state === "closing") Traps.setPitState(r.trap, "idle");
    } else runs.delete(npc);
    return;
  }
  if (r.kind === "catch") {
    // Live re-adds the creature at its spawn with its animation cleared (sequence -1).
    if (elapsed > r.fullAt) { runs.delete(npc); npc.performAnimation(H.core.Animation.DEFAULT_RESET_ANIMATION); return; }
    if (!H.traps.has(r.trap) || r.trap.state !== "closing") {
      // The pit went (its owner left): a creature that hadn't fallen yet is free again.
      if (r.fallen) runs.delete(npc); else abort(npc, r);
      return;
    }
    if (r.steps.includes(elapsed)) moveTowards(npc, r.base, true);
    if (elapsed === r.fallAt) { moveTowards(npc, r.base); fall(npc, r); }
    if (elapsed === r.fullAt) {
      Traps.setPitState(r.trap, "caught", r.state.creature, r.value);
      const sound = Object.entries(FULL_SOUNDS).find(([key]) => H.core.NpcIdentifiers[key] === r.state.creature.npc)?.[1];
      if (sound) pitSound(r.trap, sound, r.trap.base.getLocation());
    }
    return;
  }
  if (elapsed === EDGE_TICK) moveTowards(npc, r.edge, true);
  if (elapsed === LEAP_TICK) leap(npc, r);
  if (elapsed >= LAND_TICK) land(npc, r);
}

function leap(npc, r) {
  npc.performAnimation(new H.core.Animation(antelope(r.state.creature) ? LEAP.ANTELOPE : LEAP.CAT));
  npc.setPositionToFace(ahead(r));
  const at = npc.getLocation(), [dx, dy] = STEPS[r.dir], far = r.size - 1;
  const graphics = Object.entries(LEAP_GRAPHICS).find(([key]) => H.core.NpcIdentifiers[key] === npc.getId())?.[1] ?? [];
  // The two halves start on opposite corners of the creature, turned with the leap: heading north proj1 is on
  // its north-east tile and proj2 its south-west (1108 tick 21492), heading east south-east and north-west
  // (larupia tick 427). Both fly four tiles across.
  const corners = [[[1, 1], [0, 0]], [[1, 0], [0, 1]], [[0, 0], [1, 1]], [[0, 1], [1, 0]]][r.dir];
  const starts = corners.map(([cx, cy]) => at.clone().add(cx * far, cy * far));
  for (const viewer of viewers(r.state.player, r.trap)) {
    graphics.forEach((graphic, i) => viewer.getPacketSender().sendProjectile(starts[i], starts[i].clone().add(dx * 4, dy * 4),
      0, 90, graphic, 0, 0, null, 53, 0, 0));
  }
  H.core.Sounds.playAreaSound({ soundId: LEAP_SOUND, x: at.getX(), y: at.getY(), level: at.getZ(), radius: SOUND_RANGE });
}

/** Where a leaping creature faces, at the leap and the landing: 20 tiles on from the edge (larupia tick 427). */
function ahead(r) {
  const [dx, dy] = STEPS[r.dir];
  return r.edge.clone().add(dx * 20, dy * 20);
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
  const movement = player.getForceMovement();
  later.push({ due: H.tick + KNOCKBACK.ticks, run: () => { if (player.getForceMovement() === movement) player.setForceMovement(null); } });
}

function fall(npc, r) {
  const creature = r.state.creature;
  r.fallen = true;
  Traps.setPitState(r.trap, "closing", null);
  npc.performAnimation(new H.core.Animation(antelope(creature) ? ANIM.ANTELOPE_FALL : ANIM.CAT_FALL));
  npc.performGraphic(new H.core.Graphic(COLLAPSE_GRAPHICS[r.value]));
  pitSound(r.trap, COLLAPSE_SOUND);
  npc.getMovementQueue().setBlockMovement(r.blocked);
  // Gone with the full pit, back at its spawn a tick later.
  hide(npc, FULL_AFTER_FALL + 1, FULL_AFTER_FALL);
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
  // Live telejumps it (larupia capture tick 429): it snaps there in view, the leap animation carrying on.
  npc.telejump(r.landing);
  npc.setPositionToFace(ahead(r));
  if (r.state.player.isRegistered()) knockBack(r.state.player, r);
  npc.getMovementQueue().setBlockMovement(r.blocked);
  if (teased.get(npc) === r.state) npc.setFollowing(r.state.player);
}

function pitSound(trap, soundId, at = center(trap)) {
  H.core.Sounds.playAreaSound({ soundId, x: at.getX(), y: at.getY(), level: at.getZ(), radius: SOUND_RANGE });
}

function process() {
  for (const [npc, r] of runs) advance(npc, r);
  for (let i = later.length - 1; i >= 0; i--) if (H.tick >= later[i].due) later.splice(i, 1)[0].run();
  for (const state of [...teased.values()]) {
    const { player, npc } = state;
    if (runs.has(npc)) continue;
    if (H.tick >= state.due || !npc.isRegistered() || !npc.isVisible() || !player.isRegistered()
      || !nearby(player, npc, CHASE_RANGE)) { release(state); continue; }
    if (npc.getFollowing() !== player) npc.setFollowing(player);
    if (H.tick >= state.attack && touching(npc, player) && !player.getForceMovement()) {
      state.attack = H.tick + BITE.every;
      bite(state);
    }
  }
}

/** Whether a creature (of any size) stands next to the player. */
function touching(npc, player) {
  const at = npc.getLocation(), p = player.getLocation(), size = npc.getSize?.() ?? 1;
  if (at.getZ() !== p.getZ() || npc.getPrivateArea() !== player.getPrivateArea()) return false;
  const gap = (point, start) => Math.max(0, start - point, point - (start + size - 1));
  return Math.max(gap(p.getX(), at.getX()), gap(p.getY(), at.getY())) <= 1;
}

function bite({ player, npc, creature }) {
  npc.performAnimation(new H.core.Animation(BITE.animation));
  npc.setPositionToFace(player.getLocation());
  const sender = player.getPacketSender();
  sender.sendSound(BITE.sound, 1, 0);
  const I = H.core.ItemIdentifiers;
  const gear = [[I.KYATT_HAT,I.KYATT_TOP,I.KYATT_LEGS,0.4],[I.GRAAHK_HEADDRESS,I.GRAAHK_TOP,I.GRAAHK_LEGS,0.6],[I.LARUPIA_HAT,I.LARUPIA_TOP,I.LARUPIA_LEGS,0.8]];
  const multiplier = gear.find(set => set.slice(0,3).every(id => player.getEquipment().getItems().some(item => item?.getId() === id)))?.[3] ?? 1;
  const max = [H.core.NpcIdentifiers.SABRE_TOOTHED_KYATT,H.core.NpcIdentifiers.HORNED_GRAAHK].includes(creature.npc) ? 7 : 5;
  const protectedMelee = H.core.PrayerHandler.isActivated(player, H.core.PrayerHandler.PROTECT_FROM_MELEE);
  const damage = protectedMelee ? 0 : Math.floor(C.roll(0, max) * multiplier);
  if (!protectedMelee) player.getCombat().getHitQueue().addPendingDamage([new H.core.HitDamage(damage, H.core.HitMask.RED)]);
  if (!player.getForceMovement() && !H.actions.has(player)) {
    const block = player.getBlockAnim?.();
    if (block >= 0) player.performAnimation(new H.core.Animation(block));
  }
  // Ours: which of the four hit sounds plays.
  sender.sendSound(damage > 0 ? BITE.hits[Math.floor(Math.random() * BITE.hits.length)] : BITE.block, 1, BITE.soundDelay);
}

/** Frees every creature mid-run, so a reload never leaves one blocked. */
function shutdown() {
  for (const [npc, r] of [...runs]) {
    if (r.kind === "leap") land(npc, r);
    else if (!r.fallen) abort(npc, r);
    else runs.delete(npc);
  }
  for (const state of [...teased.values()]) release(state);
  for (const { run } of later.splice(0)) run();
}

module.exports = { build, tease, jump, clear, process, shutdown, heading, beyond, crossing, fullValue, catchSchedule };
