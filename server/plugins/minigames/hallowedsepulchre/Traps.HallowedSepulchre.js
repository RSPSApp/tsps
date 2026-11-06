/**
 * The Sepulchre's traps, as recorded (rsprox 1862 and 3299; hallowed-sepulchre.json `traps`).
 * Every cycle counts from the floor's start, so a floor plays the same each run:
 *
 * - Wizard statues breathe fire down the blast tile in front of them (every 8 ticks on floors
 *   1-2; by tile group on 3-5). Standing in it on its first tick, or stepping in while it burns,
 *   is a hit.
 * - Crossbowman statues shoot a bolt down one lane of three (two on floors 3-5); a bolt sweeps 3 or
 *   4 tiles a tick to its lane's end.
 * - Knight statues throw a spinning sword out to the far point, hold it, and catch it back.
 * - Priest statues strike a checkerboard in front of them: a 2-tick stun, no damage.
 * - Strange tiles push the player on (forward) or back (backward) along their travel, 3-7 tiles.
 *
 * A hit: the damage by tier, the death animation 2 ticks later and the fade, then the player is
 * back at the checkpoint of the corridor they were hit in. The timer doesn't stop.
 *
 * Everything is found in the floor's own instance from the cache map's locs; tiles here are
 * template tiles, turned into the instance's with `area.at`.
 */
const Common = require("./Common.HallowedSepulchre");

/** Rotation -> the way a statue faces: 0 south, 1 west, 2 north, 3 east. */
const FACING = [[0, -1], [-1, 0], [0, 1], [1, 0]];
const SIZE_CHUNKS = 12;
const PLANES = [0, 1, 2, 3];
const SWORD_BLOCK = 3;
/** Blast tile origin from its statue's SW tile, by rotation. */
const BLAST_ORIGIN = [[0, -3], [-3, 1], [1, 2], [2, 0]];

const T = () => Common.data.traps;
const tileKey = (x, y, z) => `${x},${y},${z}`;
const mod = (n, m) => ((n % m) + m) % m;

function inRect([x, y, z], [x0, y0, x1, y1, rz]) {
  return z === rz && x >= Math.min(x0, x1) && x <= Math.max(x0, x1) && y >= Math.min(y0, y1) && y <= Math.max(y0, y1);
}

// ------------------------------------------------------------------ building a floor

/** The trap locs of the floor's instance, by id, with their template tiles (one pass over the floor). */
function scanAll(area) {
  const ids = trapIds();
  const byId = new Map();
  for (const plane of PLANES) {
    for (let cx = 0; cx < SIZE_CHUNKS; cx++) {
      for (let cy = 0; cy < SIZE_CHUNKS; cy++) {
        for (const object of area.getChunkObjects(plane, cx, cy)) {
          const id = object.getId();
          if (!ids.has(id)) continue;
          if (!byId.has(id)) byId.set(id, []);
          byId.get(id).push({ object, id, tile: area.templateOf(object.getLocation()), face: object.getFace() & 3 });
        }
      }
    }
  }
  return byId;
}

let allTrapIds = null;
function trapIds() {
  if (allTrapIds) return allTrapIds;
  const t = T();
  allTrapIds = new Set([
    ...t.fire.active12, ...t.fire.tiered, t.fire.blast, ...Object.keys(t.crossbow.ids).map(Number), ...t.sword.ids,
    ...Object.keys(t.lightning.ids).map(Number), t.pads.backward, t.pads.forward,
  ]);
  return allTrapIds;
}

/** The scanned locs with any of `ids`. */
function scan(found, ids) {
  return [...ids].flatMap((id) => found.get(id) ?? []);
}

function buildFires(floor, found) {
  const fire = T().fire;
  const statues = scan(found, floor <= 2 ? fire.active12 : fire.tiered);
  const blasts = new Map(scan(found, [fire.blast]).map((b) => [tileKey(...b.tile), b]));
  const groups = new Map((fire.groups[String(floor)] ?? []).map(([x, y, z, g]) => [tileKey(x, y, z), g]));
  const [period, a, b] = fire.cycle[String(floor)];
  const tier = T().fireTier[String(floor)];
  const fires = [];
  for (const statue of statues) {
    const [sx, sy, sz] = statue.tile;
    const [ox, oy] = BLAST_ORIGIN[statue.face];
    const blast = blasts.get(tileKey(sx + ox, sy + oy, sz));
    if (!blast || blast.face !== statue.face) continue;
    const [bx, by] = blast.tile;
    const along = statue.face % 2 === 0 ? [0, 1] : [1, 0];
    const tiles = [0, 1, 2].map((i) => [bx + along[0] * i, by + along[1] * i, sz]);
    const group = floor <= 2 ? "A" : groups.get(tileKey(sx, sy, sz)) ?? "X";
    const readies = group === "A" ? [a] : group === "B" ? [b] : [a, b];
    fires.push({ statue: statue.object, blast: blast.object, tiles, keys: new Set(tiles.map((t) => tileKey(...t))), period, readies, tier, at: statue.tile });
  }
  return fires;
}

function buildCrossbows(floor, found) {
  const crossbow = T().crossbow;
  const lanes = scan(found, Object.keys(crossbow.ids).map(Number));
  const statues = [];
  for (const [x0, y0, x1, y1, z, distance] of crossbow.lanes) {
    const members = lanes.filter((lane) => inRect(lane.tile, [x0, y0, x1, y1, z]));
    if (!members.length) continue;
    const tier = crossbow.ids[String(members[0].id)];
    const slow = crossbow.slowLanes.some((rect) => inRect(members[0].tile, rect));
    const [period, ready] = slow ? [6, 1] : crossbow.cycle[String(floor)];
    statues.push({ lanes: members, distance, tier, period, ready, fired: [], at: members[0].tile });
  }
  return statues;
}

function buildSwords(floor, scanned) {
  const sword = T().sword;
  const found = new Map(scan(scanned, sword.ids).map((s) => [tileKey(...s.tile), s]));
  const swords = [];
  for (const [x, y, z, step, far, returnStart, period] of sword.swords) {
    const statue = found.get(tileKey(x, y, z));
    if (!statue) continue;
    const tier = sword.tiers[String(statue.id)];
    // Offsets from the statue along its facing, per tick from the add: out, hold, back.
    const path = [];
    for (let off = SWORD_BLOCK + step; ; off += step) {
      path.push(Math.min(off, far));
      if (off >= far) break;
    }
    while (path.length < returnStart) path.push(far);
    for (let off = far - step; ; off -= step) {
      path.push(Math.max(off, SWORD_BLOCK));
      if (off <= SWORD_BLOCK) break;
    }
    swords.push({
      statue: statue.object, id: statue.id, tile: statue.tile, face: statue.face, tier, period,
      ready: sword.ready[String(floor)], path, npc: null, at: statue.tile,
    });
  }
  return swords;
}

function buildLightning(floor, scanned) {
  const lightning = T().lightning;
  const cycle = lightning.cycle[String(floor)];
  if (!cycle) return [];
  const found = new Map(scan(scanned, Object.keys(lightning.ids).map(Number)).map((s) => [tileKey(...s.tile), s]));
  const statues = [];
  for (const [x, y, z, gap] of lightning.statues) {
    const statue = found.get(tileKey(x, y, z));
    if (!statue) continue;
    const [width, parity] = lightning.ids[String(statue.id)];
    const [dx, dy] = FACING[statue.face];
    const cx = x + 1 + dx * (gap + 3);
    const cy = y + 1 + dy * (gap + 3);
    const half = (width - 1) / 2;
    const tiles = [];
    for (let across = -half; across <= half; across++) {
      for (let depth = -1; depth <= 1; depth++) {
        if (mod(across + depth, 2) !== parity) continue;
        tiles.push(dx !== 0 ? [cx + depth * dx, cy + across, z] : [cx + across, cy + depth * dy, z]);
      }
    }
    statues.push({ statue: statue.object, tiles, keys: new Set(tiles.map((t) => tileKey(...t))), period: cycle[0], start: cycle[1], at: statue.tile });
  }
  return statues;
}

function buildPads(found) {
  const pads = T().pads;
  return scan(found, [pads.backward, pads.forward]).map((pad) => ({
    tile: pad.tile, forward: pad.id === pads.forward, next: Common.randomInt(1, pads.period), last: -100,
  }));
}

/** The floor's traps, found in its instance; the cycles start now. */
function build(run) {
  const floor = run.floorNumber;
  const found = scanAll(run.area);
  run.traps = {
    // Built on the floor's start tick, before the player's turn ticks it to 0.
    tick: -1,
    fires: buildFires(floor, found),
    crossbows: buildCrossbows(floor, found),
    swords: buildSwords(floor, found),
    lightning: buildLightning(floor, found),
    pads: buildPads(found),
    padKeys: null,
    bolts: [],
    pendingHit: null,
    pendingPad: null,
    prev: null,
    lastMove: [0, 1],
    moves: [],
  };
  run.traps.padKeys = new Map(run.traps.pads.map((pad) => [tileKey(...pad.tile), pad]));
}

// ------------------------------------------------------------------ helpers

function near(run, tile) {
  const here = run.traps.here;
  return here && Math.abs(here[0] - tile[0]) <= T().viewDistance && Math.abs(here[1] - tile[1]) <= T().viewDistance;
}

function locAnim(run, object, name, at) {
  if (!name || !near(run, at)) return;
  const id = Common.core.CacheDefinitions.getSeqId(name);
  if (id == null) return;
  run.player.getPacketSender().sendObjectAnimation(object, new Common.core.Animation(id));
}

function tileGraphic(run, id, tile, delay = 0) {
  if (!near(run, tile)) return;
  run.player.getPacketSender().sendGraphic(new Common.core.Graphic(id, delay, 0), run.area.at(tile));
}

function spawn(run, id, tile) {
  const at = run.area.at(tile);
  const npc = Common.api.spawnNpc({ id, x: at.getX(), y: at.getY(), z: at.getZ(), wanderRadius: 0, owner: run.player });
  if (!npc) return null;
  npc.__skipDefaultRespawn = true;
  npc.getMovementQueue?.().setBlockMovement?.(true);
  run.area.add(npc);
  run.area.spawned.push(npc);
  return npc;
}

function despawn(run, npc) {
  if (!npc) return;
  if (run.area) {
    run.area.detach?.(npc);
    run.area.spawned = run.area.spawned.filter((entry) => entry !== npc);
  }
  Common.api.removeNpc(npc);
}

function glide(npc, run, tile, seq) {
  npc.exactMove(run.area.at(tile));
  if (seq) {
    const id = Common.core.CacheDefinitions.getSeqId(seq);
    if (id != null) npc.performAnimation(new Common.core.Animation(id));
  }
}

/** The tiles a straight move from `a` to `b` passes, both ends included. */
function segment(a, b) {
  const tiles = [a];
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const steps = Math.max(Math.abs(dx), Math.abs(dy));
  for (let i = 1; i <= steps; i++) {
    tiles.push([a[0] + Math.sign(dx) * Math.min(i, Math.abs(dx)), a[1] + Math.sign(dy) * Math.min(i, Math.abs(dy)), a[2]]);
  }
  return tiles;
}

/** A 3x3 block's tiles from its SW tile. */
function block([x, y, z]) {
  const tiles = [];
  for (let dx = 0; dx < SWORD_BLOCK; dx++) for (let dy = 0; dy < SWORD_BLOCK; dy++) tiles.push([x + dx, y + dy, z]);
  return tiles;
}

// ------------------------------------------------------------------ each tick

function tickFires(run, danger) {
  const fire = T().fire;
  const t = run.traps.tick;
  for (const trap of run.traps.fires) {
    // The frame of the most recent cycle (X statues start a cycle every half period).
    let frame = null;
    for (const ready of trap.readies) {
      const f = mod(t - ready, trap.period);
      if (f < fire.statue.length && (frame == null || f < frame)) frame = f;
    }
    if (frame == null) continue;
    const previous = frame > 0 ? fire.statue[frame - 1] : null;
    if (fire.statue[frame] !== previous) locAnim(run, trap.statue, fire.statue[frame], trap.at);
    const blastSeq = fire.blastSeqs[frame];
    if (blastSeq && blastSeq !== fire.blastSeqs[frame - 1]) locAnim(run, trap.blast, blastSeq, trap.at);
    if (frame === fire.hitStart) danger.standing.push(...trap.tiles.map((tile) => [tile, trap.tier]));
    if (frame >= fire.hitStart && frame <= fire.hitEnd) danger.entering.push(...trap.tiles.map((tile) => [tile, trap.tier]));
  }
}

function tickCrossbows(run, danger) {
  const crossbow = T().crossbow;
  const t = run.traps.tick;
  const born = [];
  for (const statue of run.traps.crossbows) {
    const f = mod(t - statue.ready, statue.period);
    if (f === 0) {
      const shuffled = [...statue.lanes];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      statue.fired = shuffled.slice(0, crossbow.lanesFired[String(statue.tier)]);
      for (const lane of statue.lanes) locAnim(run, lane.object, crossbow.seqs[0], lane.tile);
    } else if (f < crossbow.seqs.length) {
      for (const lane of statue.fired) locAnim(run, lane.object, crossbow.seqs[f], lane.tile);
    }
    if (f !== 2) continue;
    for (const lane of statue.fired) {
      if (!lane) continue;
      const [dx, dy] = FACING[lane.face];
      const [lx, ly, lz] = lane.tile;
      const at = (d) => [lx + dx * d, ly + dy * d, lz];
      const npc = spawn(run, crossbow.npcs[String(statue.tier)], at(1));
      if (!npc) continue;
      const first = at(crossbow.spawn[String(statue.tier)]);
      glide(npc, run, first, crossbow.boltSeq);
      const bolt = { npc, tile: first, from: at(1), target: at(statue.distance), step: crossbow.step[String(statue.tier)], dir: [dx, dy], tier: statue.tier, done: false };
      born.push(bolt);
      danger.standing.push(...segment(bolt.from, bolt.tile).map((tile) => [tile, bolt.tier]));
      danger.entering.push(...segment(bolt.from, bolt.tile).map((tile) => [tile, bolt.tier]));
    }
  }
  // Bolts already flying: a step a tick to the lane's end, deleted the tick after.
  for (const bolt of [...run.traps.bolts]) {
    if (bolt.done) {
      despawn(run, bolt.npc);
      run.traps.bolts = run.traps.bolts.filter((entry) => entry !== bolt);
      continue;
    }
    const left = Math.abs(bolt.target[0] - bolt.tile[0]) + Math.abs(bolt.target[1] - bolt.tile[1]);
    const move = Math.min(bolt.step, left);
    const next = [bolt.tile[0] + bolt.dir[0] * move, bolt.tile[1] + bolt.dir[1] * move, bolt.tile[2]];
    const swept = segment(bolt.tile, next);
    glide(bolt.npc, run, next, crossbow.boltSeq);
    bolt.tile = next;
    if (move === left) bolt.done = true;
    danger.standing.push(...swept.map((tile) => [tile, bolt.tier]));
    danger.entering.push(...swept.map((tile) => [tile, bolt.tier]));
  }
  run.traps.bolts.push(...born);
}

function tickSwords(run, danger) {
  const sword = T().sword;
  const t = run.traps.tick;
  const { GameObject, ObjectManager } = Common.core;
  for (const trap of run.traps.swords) {
    const f = mod(t - trap.ready, trap.period);
    if (f < sword.seqs.length) locAnim(run, trap.statue, sword.seqs[f], trap.at);
    const k = f - 2;
    const [dx, dy] = FACING[trap.face];
    const sw = (off) => [trap.tile[0] + dx * off, trap.tile[1] + dy * off, trap.tile[2]];
    const swap = (id) => {
      const object = trap.statue;
      ObjectManager.register(new GameObject(id, object.getLocation().clone(), object.getType(), object.getFace(), run.area), true);
    };
    if (k === 0) {
      trap.npc = spawn(run, sword.npcs[String(trap.tier)], sw(SWORD_BLOCK));
      if (trap.npc) glide(trap.npc, run, sw(trap.path[0]), sword.spin);
    } else if (k > 0 && k < trap.path.length) {
      if (trap.npc) glide(trap.npc, run, sw(trap.path[k]), sword.spin);
    }
    if (k === 1) swap(trap.id + sword.thrownOffset);
    if (k === trap.path.length + 1) {
      locAnim(run, trap.statue, sword.catch, trap.at);
      despawn(run, trap.npc);
      trap.npc = null;
    }
    if (k === trap.path.length + 3) swap(trap.id);
    if (k >= 0 && k < trap.path.length) {
      const fromOff = k === 0 ? SWORD_BLOCK : trap.path[k - 1];
      const toOff = trap.path[k];
      const swept = [];
      for (let off = Math.min(fromOff, toOff); off <= Math.max(fromOff, toOff); off++) swept.push(...block(sw(off)));
      danger.standing.push(...swept.map((tile) => [tile, trap.tier]));
      danger.entering.push(...block(sw(toOff)).map((tile) => [tile, trap.tier]));
    }
  }
}

function tickLightning(run, stun) {
  const lightning = T().lightning;
  const t = run.traps.tick;
  for (const trap of run.traps.lightning) {
    const f = mod(t - trap.start, trap.period);
    const seq = lightning.statueSeqs[f];
    if (seq) locAnim(run, trap.statue, seq, trap.at);
    const graphic = f === trap.period - 1 ? "start" : f === 2 ? "strike" : f === 3 ? "end" : null;
    if (graphic) {
      for (const tile of trap.tiles) tileGraphic(run, lightning.graphics[graphic], tile, graphic === "start" ? 30 : 0);
    }
    if (f === 2) stun.push(...trap.tiles);
  }
}

function tickPads(run) {
  const pads = T().pads;
  const t = run.traps.tick;
  const g = pads.graphics;
  for (const pad of run.traps.pads) {
    if (t === pad.next - 1) tileGraphic(run, pad.forward ? g.readyForward : g.readyBackward, pad.tile);
    if (t === pad.next) {
      tileGraphic(run, pad.forward ? g.telegraphForward : g.telegraphBackward, pad.tile);
      pad.last = t;
      pad.next = t + pads.period + (Math.random() < 0.3 ? Common.randomInt(1, 5) : 0);
    }
  }
}

/** A pad's push: along the player's travel (back for a backward pad), 3-7 tiles where walkable. */
function firePad(run, pad) {
  const { RegionManager } = Common.core;
  const pads = T().pads;
  const [ux, uy] = run.traps.lastMove;
  const sign = pad.forward ? 1 : -1;
  const distance = Common.randomInt(...pads.distance);
  let landing = pad.tile;
  for (let i = 1; i <= distance; i++) {
    const from = run.area.at(landing);
    const next = [landing[0] + ux * sign, landing[1] + uy * sign, landing[2]];
    if (!RegionManager.canMove(from.getX(), from.getY(), from.getX() + ux * sign, from.getY() + uy * sign, from.getZ(), 1, 1, run.area)) break;
    landing = next;
  }
  if (landing === pad.tile) return;
  const g = pads.graphics;
  tileGraphic(run, pad.forward ? g.activateForward : g.activateBackward, pad.tile);
  tileGraphic(run, pad.forward ? g.landForward : g.landBackward, landing);
  run.player.getMovementQueue().reset();
  run.player.moveTo(run.area.at(landing));
  run.traps.here = landing;
  run.traps.prev = landing;
}

// ------------------------------------------------------------------ hits

/** The checkpoint for a hit at `tile`: the nearest recorded zone on its plane, else the floor's last landing. */
function checkpoint(run, tile) {
  const { zones, altRespawn, respawn } = T();
  let best = null;
  let bestDistance = Infinity;
  for (const [floor, x0, y0, x1, y1, z, rx, ry, rz] of zones) {
    if (floor !== run.floorNumber || z !== tile[2]) continue;
    const dx = Math.max(x0 - tile[0], 0, tile[0] - x1);
    const dy = Math.max(y0 - tile[1], 0, tile[1] - y1);
    const distance = Math.max(dx, dy);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = [rx, ry, rz];
    }
  }
  if (!best || bestDistance > respawn.zoneReach) return run.lastLanding ?? run.variant.start;
  // Floor 3's level-1 corridor: layout B (the alternate safespot) respawns at the west drop's landing.
  if (run.floorNumber === altRespawn[0] && best[2] === altRespawn[3] && run.variant.varbits.hallowed_alternate_safespot) {
    return [altRespawn[1], altRespawn[2], altRespawn[3]];
  }
  return best;
}

/** The Hallowed ring negates the Sepulchre's environmental trap damage. */
function wearingHallowedRing(player) {
  const { Equipment, ItemIdentifiers } = Common.core;
  const ring = player.getEquipment().getItems?.()[Equipment.RING_SLOT]?.getId?.();
  return ring === ItemIdentifiers.HALLOWED_RING || ring === ItemIdentifiers.HALLOWED_RING_2;
}

function hit(run, tier, tile) {
  const { player } = run;
  const { HitDamage, HitMask } = Common.core;
  const respawn = T().respawn;
  const traps = run.traps;
  traps.recovering = true;
  traps.pendingHit = null;
  traps.pendingPad = null;
  const to = checkpoint(run, tile);
  const protectedByRing = wearingHallowedRing(player);
  if (!protectedByRing) {
    const [low, high] = T().damage[String(tier)];
    player.addTickHit(player.decrementHealth(new HitDamage(Common.randomInt(low, high), HitMask.RED)));
  }
  player.getMovementQueue().reset();
  player.getMovementQueue().setBlockMovement?.(true);
  if (protectedByRing) {
    // The ring saves recovery time. Reuse the modeled checkpoint and omit the
    // normal death/fade sequence; exact retail timing is not captured here.
    player.moveTo(run.area.at(to));
    traps.here = to;
    traps.prev = to;
    traps.recovering = false;
    if (!traps.stunned) {
      player.performAnimation(new Common.core.Animation(-1));
      player.getMovementQueue().setBlockMovement?.(false);
    }
    return;
  }
  run.schedule(respawn.deathAt, () => {
    Common.animate(player, respawn.deathSeq);
    Common.closeHud(player);
    Common.legacyFade(player);
  });
  run.schedule(respawn.moveAt, () => {
    if (run.traps !== traps) return;
    player.moveTo(run.area.at(to));
    traps.here = to;
    traps.prev = to;
    player.performAnimation(new Common.core.Animation(-1));
  });
  run.schedule(respawn.fadeInAt, () => Common.fade(player, false));
  run.schedule(respawn.hudAt, () => {
    Common.closeFade(player);
    if (!run.expired) Common.openHud(player);
    player.getMovementQueue().setBlockMovement?.(false);
    traps.recovering = false;
  });
}

function stunPlayer(run) {
  const { player } = run;
  const lightning = T().lightning;
  Common.spam(player, Common.message("stunned"));
  Common.animate(player, lightning.stunSeq);
  player.performGraphic(new Common.core.Graphic(lightning.stunGraphic, 0, 124));
  player.getMovementQueue().reset();
  player.getMovementQueue().setBlockMovement?.(true);
  run.traps.stunned = true;
  const traps = run.traps;
  run.schedule(lightning.stunTicks + 1, () => {
    traps.stunned = false;
    if (!traps.recovering) player.getMovementQueue().setBlockMovement?.(false);
  });
}

/**
 * One tick of the floor's traps. Recorded: a trap hits a player standing in it this tick, and
 * one who moved into it the tick after.
 */
function tick(run) {
  const traps = run.traps;
  if (!traps || !run.area) return;
  traps.tick++;
  const here = run.area.templateOf(run.player.getLocation());
  const prev = traps.prev ?? here;
  traps.here = here;
  const dx = here[0] - prev[0];
  const dy = here[1] - prev[1];
  const teleported = here[2] !== prev[2] || Math.max(Math.abs(dx), Math.abs(dy)) > 2;
  const moved = !teleported && (dx !== 0 || dy !== 0);
  if (moved) {
    traps.moves.push([dx, dy]);
    if (traps.moves.length > 4) traps.moves.shift();
    const [sx, sy] = traps.moves.reduce(([ax, ay], [mx, my]) => [ax + mx, ay + my], [0, 0]);
    traps.lastMove = Math.abs(sx) >= Math.abs(sy) ? [Math.sign(sx) || 1, 0] : [0, Math.sign(sy)];
  } else if (teleported) {
    traps.moves = [];
    traps.pendingHit = null;
    traps.pendingPad = null;
  }
  const danger = { standing: [], entering: [] };
  const stun = [];
  tickFires(run, danger);
  tickCrossbows(run, danger);
  tickSwords(run, danger);
  tickLightning(run, stun);
  tickPads(run);
  traps.prev = here;
  if (traps.recovering || run.transitioning || run.ended || run.ticks < run.busyUntil) return;

  // A hit moved into last tick lands now.
  if (traps.pendingHit) {
    const [tier, tile] = traps.pendingHit;
    hit(run, tier, tile);
    return;
  }
  const key = tileKey(...here);
  if (teleported) {
    // Arriving by a drop, stairs or a pad is neither standing in a trap nor stepping into one.
  } else if (!moved) {
    const struck = danger.standing.find(([tile]) => tileKey(...tile) === key);
    if (struck) {
      hit(run, struck[1], here);
      return;
    }
  } else {
    const passed = segment(prev, here).slice(1).map((tile) => tileKey(...tile));
    const struck = danger.entering.find(([tile]) => passed.includes(tileKey(...tile)));
    if (struck) traps.pendingHit = [struck[1], here];
  }
  const startKey = tileKey(...prev);
  if (!traps.stunned && stun.some((tile) => tileKey(...tile) === startKey)) stunPlayer(run);

  // Pads: the tick after arriving, unless the pad is resting; then at its next telegraph.
  const pad = traps.padKeys.get(key);
  if (traps.pendingPad && traps.pendingPad.pad !== pad) traps.pendingPad = null;
  if (traps.pendingPad && traps.tick >= traps.pendingPad.at) {
    const { pad: pending } = traps.pendingPad;
    traps.pendingPad = null;
    firePad(run, pending);
  } else if (pad && moved && !traps.pendingPad) {
    const armed = traps.tick - pad.last <= T().pads.inertFrom - 1;
    traps.pendingPad = { pad, at: armed ? traps.tick + 1 : pad.next };
  }
}

/** Ends the floor's traps: their NPCs go with the instance; the cycles stop. */
function clear(run) {
  if (!run.traps) return;
  for (const bolt of run.traps.bolts) despawn(run, bolt.npc);
  for (const sword of run.traps.swords) despawn(run, sword.npc);
  run.traps = null;
}

/** Whether a trap has the player (a hit's recovery or a stun): no obstacle can start then. */
function holding(run) {
  return Boolean(run.traps && (run.traps.recovering || run.traps.stunned));
}

module.exports = { build, tick, clear, checkpoint, segment, holding, FACING };
