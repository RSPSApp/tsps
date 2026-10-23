/**
 * The titans' specials and the per-tick fight engine (walks, rows, blast pulses, wall damage).
 *
 * As captured (02283, 03398, 03402): summon01 lays a 5-wide vfx row (fire 3218, ice 3221)
 * the same tick and five hitbox NPCs (14152/14153) stand on it 4 ticks later; rows live ~40
 * ticks unless a strong-enough spell of the opposite element clears the tile hit and its
 * neighbours. Standing on a tile at formation blocks that tile (one wall hit, Wiki).
 * summon02 stands up a column of three elementals 2 ticks later at the caster's end of the
 * lane. The 35% teleport (or the partner's death) moves the titans still fighting to their
 * static tiles. The blast charges (aoe01 + safe tile 56003) and fires 6 ticks later
 * (aoe02), the grids and pulses landing together at +1/+3/+5: fire north of the safe tile's
 * row, ice from it south, only the grids of titans still fighting.
 */
const Shared = require("./Shared.RoyalTitans");
const Minions = require("./Minions.RoyalTitans");
const CombatAchievements = require("./CombatAchievements.RoyalTitans");

const ROW_BAND_MIN = 9562;
const ROW_BAND_MAX = 9572;
/** Standing in a row hurts about every 3 ticks [EST]: the Wiki gives only the max. */
const WALL_DAMAGE_TICKS = 3;
/** Walk plans for mobile titans: npc -> { startAt, dest: {x, y} } (authored tiles). */
const walks = new WeakMap();

let core = null;
/** Area.RoyalTitans's live fights, looked up on the engine's first tick. */
let sessions = null;

const { alive, fighting, tileOf, later, sessionOfNpc } = Shared;

function graphic(id, delay = 0, height = 0) {
  const gfx = new core.Graphic(id);
  gfx.delay = delay;
  gfx.height = height;
  return gfx;
}

/** A map animation every player in the instance sees; x/y are instance tiles. */
function tileGraphic(session, x, y, id, delay = 0) {
  session.players[0]?.getPacketSender().sendGlobalGraphic(graphic(id, delay), new core.Location(x, y, 0));
}

function areaSounds(sounds, x, y, radius) {
  for (const [id, delay] of sounds) {
    core.Sounds.playAreaSound({ soundId: id, x, y, level: 0, delay, radius });
  }
}

/** The instance spot of an authored arena tile, as {x, y}. */
function arenaSpot(session, x, y) {
  const at = Shared.instanceTile(session.area, x, y, 0);
  return { x: at.x, y: at.y };
}

/** A map animation on an authored arena tile (translated for the instance). */
function arenaTileGraphic(session, x, y, id, delay = 0) {
  const at = arenaSpot(session, x, y);
  tileGraphic(session, at.x, at.y, id, delay);
}

/**
 * The titans never face the player (captured face angles): mobile they face straight across
 * the lane (Branda east, Eldric west); static, and as corpses, toward the arena (Branda
 * south, Eldric north). A one-off face, as live's face_angle.
 */
function faceAcross(npc) {
  const at = npc.getLocation();
  const brandaSide = npc.getId() === Shared.BRANDA_ID || npc.getId() === Shared.BRANDA_CORPSE_ID;
  const away = Shared.FACE_ACROSS_TILES;
  const mobile = npc.getAttribute(Shared.TELEPORTED_ATTRIBUTE) !== true && Shared.isLiveTitan(npc.getId());
  const dx = mobile ? (brandaSide ? away : -away) : 1;
  const dy = mobile ? 1 : (brandaSide ? -away : away);
  npc.faceTile(new core.Location(at.getX() + dx, at.getY() + dy, at.getZ()));
}

/** Which of its two spots a mobile titan stands on: its lane edge, or the back. */
function spotOf(npc) {
  const session = sessionOfNpc(npc);
  const bounds = Shared.MOBILE_BOUNDS[npc.getId()];
  const here = Shared.authoredTile(session.area, npc.getLocation().getX(), npc.getLocation().getY());
  const edgeX = npc.getId() === Shared.BRANDA_ID ? bounds.maxX : bounds.minX;
  return here.x === edgeX ? "edge" : "back";
}

function hasOwnMinions(session, npc) {
  const id = npc.getId() === Shared.BRANDA_ID ? Shared.FIRE_MINION_ID : Shared.ICE_MINION_ID;
  return [...session.minions].some((minion) => minion.getId() === id && alive(minion));
}

/**
 * The captured stomp telegraph: graphic 3211 over the whole lane width (x 2909-2913) on the
 * caster's own three rows (93 of 93 stomps), rippling out from it: +2 cycles per tile of
 * distance beyond the first from its body. Static, the whole arena (y 9564-9570, captured).
 * Returns the tiles for the damage roll.
 */
function telegraphMelee(npc) {
  const session = sessionOfNpc(npc);
  const base = tileOf(npc);
  const mobile = npc.getAttribute(Shared.TELEPORTED_ATTRIBUTE) !== true;
  const { minY, maxY } = Shared.BLAST_AREA;
  const rows = [];
  if (mobile) rows.push(base.y, base.y + 1, base.y + 2);
  else for (let y = minY; y <= maxY; y++) rows.push(arenaSpot(session, 0, y).y);
  const tiles = [];
  for (let x = Shared.BLAST_AREA.minX; x <= Shared.BLAST_AREA.maxX; x++) {
    const laneX = arenaSpot(session, x, 0).x;
    for (const y of rows) tiles.push([laneX, y]);
  }
  for (const [x, y] of tiles) {
    const distance = Shared.edgeDistance(Shared.SIZE, base.x, base.y, x, y);
    tileGraphic(session, x, y, Shared.MELEE_TELEGRAPH_GFX, Math.max(0, distance - 1) * 2);
  }
  return tiles;
}

/** Static fight locs (teleport floors/blockers, death floors, row markers) tracked for cleanup. */
function addLoc(session, id, x, y, shape, rotation) {
  const { area } = session;
  if (area.isDestroyed()) return null;
  const object = new core.GameObject(id, new core.Location(x, y, 0), shape, rotation, area);
  core.ObjectManager.register(object, true);
  area.add(object);
  session.staticLocs.push(object);
  return object;
}

function clearStaticLocs(session) {
  for (const object of session.staticLocs) core.ObjectManager.deregister(object, true);
  session.staticLocs = [];
}

/**
 * A row tile's loc (shape 10, as live): the element's vfx while a row stands on it. One loc a
 * tile (session.tileLocs): rows overlapping on a tile share it, so one row going never strips
 * another's graphics. Live swaps a cleared tile to the invisible marker (29733); here the loc
 * is removed instead (`id` null): the same on screen, and our client drew later ground
 * graphics (the stomp telegraph) under the marker.
 */
function setTileLoc(session, x, y, id) {
  if (session.area.isDestroyed()) return;
  const key = Shared.tileKey(x, y);
  const current = session.tileLocs.get(key);
  if (current && current.getId() === id) return;
  if (current) core.ObjectManager.deregister(current, true);
  session.tileLocs.delete(key);
  if (id == null) return;
  const object = new core.GameObject(id, new core.Location(x, y, 0), 10, 0, session.area);
  core.ObjectManager.register(object, true);
  session.area.add(object);
  session.tileLocs.set(key, object);
}

const rowLocId = (kind) => (kind === "fire" ? Shared.FIRE_ROW_OBJECT : Shared.ICE_ROW_OBJECT);

/** addLoc/rows take instance tiles: `spots` holds the authored x-range already mapped. */
function startRow(npc, target) {
  const session = sessionOfNpc(npc);
  if (!fighting(npc)) return;
  const kind = npc.getId() === Shared.BRANDA_ID ? "fire" : "ice";
  const anims = Shared.animationsFor(npc.getId());
  faceAcross(npc);
  npc.performAnimation(new core.Animation(anims.row));
  if (npc.getId() === Shared.BRANDA_ID) {
    npc.performGraphic(new core.Graphic(Shared.BRANDA_CAST_GFX.row));
  }
  const y = Shared.randomBetween(ROW_BAND_MIN, ROW_BAND_MAX);
  const spots = [];
  for (let x = 2909; x <= 2913; x++) {
    const at = arenaSpot(session, x, y);
    spots.push([at.x, at.y]);
    tileGraphic(session, at.x, at.y, Shared.ROW_SPAWN_GFX[kind]);
    areaSounds(Shared.SOUND.rowSpawn[kind], at.x, at.y, Shared.ROW_SOUND_RANGE);
  }
  CombatAchievements.rowSpawned(session, kind);
  // Tiles targeted but not yet formed: the blast steers clear of them too, as live never
  // puts a safe tile on a wall (0 overlaps in 58 blasts, at charge and at fire).
  const pending = { tiles: spots };
  if (!session.pendingRows) session.pendingRows = [];
  session.pendingRows.push(pending);
  later(Shared.ROW_SPAWN_TICKS, () => {
    session.pendingRows = (session.pendingRows ?? []).filter((other) => other !== pending);
    if (!fighting(npc) || session.area.isDestroyed()) return;
    const rowId = kind === "fire" ? Shared.FIRE_ROW_ID : Shared.ICE_ROW_ID;
    const cast = {};
    const occupants = occupantsByTile(session, spots);
    for (const [x, y] of spots) {
      // Fire and ice cancel out: where the other element's row stands, that tile despawns
      // and this one never appears (captured).
      const opposite = rowsAt(session, x, y).filter((other) => other.getAttribute(Shared.ROW_ATTRIBUTE).kind !== kind);
      if (opposite.length > 0) {
        for (const other of opposite) removeRowTile(session, other, true);
        continue;
      }
      // Standing on a tile at formation blocks it: no NPC, no loc, and each occupant
      // takes the wall hit once (Wiki; captured 02283 T1352, 03398). No despawn vfx.
      const standing = occupants.get(Shared.tileKey(x, y));
      if (standing) {
        for (const player of standing) {
          const damage = 1 + core.Misc.getRandom(Shared.WALL_MAX - 1);
          player.getCombat().getHitQueue().addPendingDamage([new core.HitDamage(damage, core.HitMask.RED)]);
          CombatAchievements.avoidableDamage(player, damage, "row");
        }
        continue;
      }
      const hitbox = core.NPC.create(rowId, new core.Location(x, y, 0));
      hitbox.__skipDefaultRespawn = true;
      // Cleared by the first qualifying spell hit (clearRowTile), never by damage; a tile
      // never fights back or moves (Skotizo's altars).
      hitbox.setHitpoints(1000);
      hitbox.setFlag("combat:no-retaliate");
      hitbox.getMovementQueue().setBlockMovement(true).reset();
      hitbox.setAttribute(Shared.ENCOUNTER_ATTRIBUTE, session);
      hitbox.setAttribute(Shared.ROW_ATTRIBUTE, { kind, x, y, cast, expiresAt: core.World.getProcessCycle() + Shared.ROW_LIFETIME_TICKS });
      session.area.add(hitbox);
      core.World.getAddNPCQueue().push(hitbox);
      session.rows.add(hitbox);
      setTileLoc(session, x, y, rowLocId(kind));
    }
  });
}

/** Clicking Douse/Melt with the right element in hand clears the tile; anything else
 * hints, as captured ("...strong enough to..."). */
function tryRowClear({ player, npc }) {
  const kind = npc.getId() === Shared.FIRE_ROW_ID ? "fire" : "ice";
  const session = sessionOfNpc(npc);
  if (session && Minions.clearsRow(player, kind)) {
    clearRowTile(session, npc, true);
    return true;
  }
  player.sendMessage(kind === "fire" ? Shared.FIRE_HINT : Shared.ICE_HINT);
  return true;
}

/**
 * A row tile cleared (by a qualifying spell, or expired): despawn grid and sound, NPC gone,
 * and the tile's loc back to the invisible marker unless another row still stands there.
 */
function clearRowTile(session, hitbox, cleared) {
  const row = hitbox.getAttribute(Shared.ROW_ATTRIBUTE);
  if (cleared) {
    // A spell puts out its tile and the row's tiles either side of it (captured: a hit on
    // x 2911 clears 2910-2912).
    for (const other of [...session.rows]) {
      const near = other.getAttribute(Shared.ROW_ATTRIBUTE);
      if (other !== hitbox && near.cast === row.cast && Math.abs(near.x - row.x) === 1) removeRowTile(session, other, true);
    }
  }
  removeRowTile(session, hitbox, cleared);
  if (cleared) CombatAchievements.rowCleared(session);
  else CombatAchievements.rowExpired(session);
}

function removeRowTile(session, hitbox, cleared) {
  const { kind, x, y } = hitbox.getAttribute(Shared.ROW_ATTRIBUTE);
  tileGraphic(session, x, y, Shared.ROW_DESPAWN_GFX[kind]);
  areaSounds((cleared ? Shared.SOUND.rowDespawn : Shared.SOUND.rowExpire)[kind], x, y, Shared.ROW_SOUND_RANGE);
  session.rows.delete(hitbox);
  if (hitbox.isRegistered()) core.World.getRemoveNPCQueue().push(hitbox);
  const still = rowsAt(session, x, y)[0];
  setTileLoc(session, x, y, still ? rowLocId(still.getAttribute(Shared.ROW_ATTRIBUTE).kind) : null);
}

/** The live row tiles on (x, y). */
function rowsAt(session, x, y) {
  return [...(session.rows ?? [])].filter((hitbox) => {
    const row = hitbox.getAttribute(Shared.ROW_ATTRIBUTE);
    return row.x === x && row.y === y && hitbox.isRegistered();
  });
}

/**
 * Living players standing on the given instance tiles right now, as tile key -> players.
 * A row tile occupied at formation never forms: each occupant takes the wall hit instead
 * (Wiki; captured 02283 T1352, 03398).
 */
function occupantsByTile(session, spots) {
  const wanted = new Set(spots.map(([x, y]) => Shared.tileKey(x, y)));
  const occupants = new Map();
  for (const player of session.players ?? []) {
    if (!alive(player)) continue;
    const pos = tileOf(player);
    if (!pos) continue;
    const key = Shared.tileKey(pos.x, pos.y);
    if (!wanted.has(key)) continue;
    if (!occupants.has(key)) occupants.set(key, []);
    occupants.get(key).push(player);
  }
  return occupants;
}

/** Natural expiry only (spell clears go through clearRowTile with cleared=true). */
function expireRows(session) {
  const now = core.World.getProcessCycle();
  for (const hitbox of [...session.rows]) {
    if (!hitbox.isRegistered() || now >= hitbox.getAttribute(Shared.ROW_ATTRIBUTE).expiresAt) {
      clearRowTile(session, hitbox, false);
    }
  }
}

/** Standing on a live row tile deals the wall hit (Wiki max 12). */
function tickRows(session) {
  // Contact damage pulses about every 3 ticks (rate estimated [EST]): every tick felt
  // like a shredder and the Wiki only gives the 1-12 max, not the interval.
  if (core.World.getProcessCycle() % WALL_DAMAGE_TICKS === 0) {
    for (const player of session.players) {
      if (!alive(player)) continue;
      const pos = tileOf(player);
      if (rowsAt(session, pos.x, pos.y).length === 0) continue;
      const damage = 1 + core.Misc.getRandom(Shared.WALL_MAX - 1);
      player.getCombat().getHitQueue().addPendingDamage([new core.HitDamage(damage, core.HitMask.RED)]);
      CombatAchievements.avoidableDamage(player, damage, "row");
    }
  }
  expireRows(session);
}

/** The minion trio, +2 ticks: a column of three at a random lane x, at the caster's end of
 * the lane while mobile, against its footprint after the teleport (captured). */
function startMinions(npc, target) {
  const session = sessionOfNpc(npc);
  if (!fighting(npc)) return;
  const fire = npc.getId() === Shared.BRANDA_ID;
  const kind = fire ? "fire" : "ice";
  const anims = Shared.animationsFor(npc.getId());
  faceAcross(npc);
  npc.performAnimation(new core.Animation(anims.minions));
  if (fire) npc.performGraphic(new core.Graphic(Shared.BRANDA_CAST_GFX.minions));
  const minionId = fire ? Shared.FIRE_MINION_ID : Shared.ICE_MINION_ID;
  const phase = npc.getAttribute(Shared.TELEPORTED_ATTRIBUTE) === true ? "static" : "mobile";
  const [minY, maxY] = Shared.TRIO_START_Y[phase][kind];
  const x = Shared.randomBetween(Shared.BLAST_AREA.minX, Shared.BLAST_AREA.maxX);
  const y = Shared.randomBetween(minY, maxY);
  const tiles = [0, 1, 2].map((dy) => {
    const at = arenaSpot(session, x, y + dy);
    return [at.x, at.y];
  });
  later(Shared.MINION_SPAWN_TICKS, () => {
    if (!fighting(npc) || session.area.isDestroyed()) return;
    Minions.spawnTrio(session, minionId, tiles);
  });
}

/**
 * Crossing 210 HP, or the partner's death, teleports the titans still fighting onto the
 * arena (captured): shouts, teleport anims + arrival grids, telejumps 3 ticks later with
 * spawn anims, floors and blockers. They stay static for the rest of the fight; the blast
 * cycle starts.
 */
function teleportTitans(trigger) {
  const session = sessionOfNpc(trigger);
  if (!session || session.over === true || session.teleported === true) return;
  const titans = [session.branda, session.eldric].filter(fighting);
  if (titans.length === 0) return;
  // Only when a titan is at or below the threshold (commands included), or one is down.
  const low = titans.some((npc) => npc.getHitpoints() <= Shared.TELEPORT_THRESHOLD);
  if (!low && titans.length === 2) return;
  session.teleported = true;
  for (const npc of titans) {
    npc.setAttribute(Shared.TELEPORTED_ATTRIBUTE, true);
    walks.delete(npc);
    npc.forceChat(Shared.shoutFor(npc.getId(), Shared.TELEPORT_SHOUTS));
  }
  const { branda, eldric } = session;
  if (fighting(branda)) {
    branda.performAnimation(new core.Animation(Shared.BRANDA_ANIMATIONS.teleport));
    branda.performGraphic(new core.Graphic(Shared.BRANDA_CAST_GFX.teleport));
    for (let x = 2909; x <= 2913; x++) {
      for (let y = 9571; y <= 9573; y++) arenaTileGraphic(session, x, y, Shared.TELEPORT_GRID_GFX.fire);
    }
    later(3, () => landTitan(session, branda, Shared.BRANDA_STATIC, Shared.BRANDA_ANIMATIONS.spawn, Shared.BRANDA_CAST_GFX.spawn, [Shared.BRANDA_FLOOR_1, Shared.BRANDA_FLOOR_2]));
  }
  if (fighting(eldric)) {
    later(1, () => {
      if (!fighting(eldric)) return;
      eldric.performAnimation(new core.Animation(Shared.ELDRIC_ANIMATIONS.teleport));
      for (let x = 2909; x <= 2913; x++) {
        for (let y = 9561; y <= 9563; y++) arenaTileGraphic(session, x, y, Shared.TELEPORT_GRID_GFX.ice);
      }
    });
    later(4, () => landTitan(session, eldric, Shared.ELDRIC_STATIC, Shared.ELDRIC_ANIMATIONS.spawn, null, [Shared.ELDRIC_FLOOR_1, Shared.ELDRIC_FLOOR_2]));
  }
  // The first blast comes 10 ticks after the teleport, for both together.
  for (const npc of titans) npc.setAttribute(Shared.BLAST_AT_ATTRIBUTE, core.World.getProcessCycle() + Shared.FIRST_BLAST_TICKS);
}

function landTitan(session, npc, tile, spawnAnim, spawnGfx, floors) {
  if (!fighting(npc) || session.area.isDestroyed()) return;
  const staticTile = Shared.instanceTile(session.area, tile[0], tile[1], tile[2]);
  npc.moveTo(new core.Location(staticTile.x, staticTile.y, staticTile.z));
  // Static for the rest of the fight.
  npc.getMovementQueue().reset();
  npc.performAnimation(new core.Animation(spawnAnim));
  if (spawnGfx != null) npc.performGraphic(new core.Graphic(spawnGfx));
  const floorTiles = [[staticTile.x - 1, staticTile.y], [staticTile.x + 3, staticTile.y]];
  floors.forEach((id, index) => {
    const [x, y] = floorTiles[index] ?? [staticTile.x, staticTile.y];
    addLoc(session, id, x, y, 10, 0);
  });
  for (let dx = 0; dx <= 2; dx++) {
    for (let dy = 0; dy <= 2; dy++) {
      addLoc(session, Shared.BLOCKING_OBJECT, staticTile.x + dx, staticTile.y + dy, 10, 0);
    }
  }
}

/** Whether the surviving titan is enraged by its partner's death (Wiki; unwitnessed). */
function survivorEnraged(session, npc) {
  const other = npc.getId() === Shared.BRANDA_ID ? session.eldric : session.branda;
  return !!other && !fighting(other);
}

/** Post-teleport blast turn, every 22/29/36 ticks for the titans together (captured). */
function takeBlastTurn(npc, target) {
  if (npc.getAttribute(Shared.TELEPORTED_ATTRIBUTE) !== true || !fighting(npc)) return false;
  const now = core.World.getProcessCycle();
  const due = npc.getAttribute(Shared.BLAST_AT_ATTRIBUTE) ?? 0;
  if (now < due) return false;
  const session = sessionOfNpc(npc);
  if (!session || session.blastLock) return false;
  // One shared blast: lock this tick, and move both titans to the next cycle together.
  session.blastLock = npc;
  later(1, () => {
    if (session.blastLock === npc) session.blastLock = null;
  });
  const next = now + Shared.pick(Shared.BLAST_INTERVALS);
  for (const titan of [session.branda, session.eldric]) titan?.setAttribute(Shared.BLAST_AT_ATTRIBUTE, next);
  startBlast(session, target);
  return true;
}

/**
 * The Elemental Blast (captured): charge (aoe01 + safe tile), fire 6 ticks later (aoe02 and
 * the pulse sounds), then grids and pulses together at +1/+3/+5. Each titan still fighting
 * casts and draws its grid: fire north of the safe tile's row, ice on it and south; alone, a
 * titan covers the whole area. Off the safe tile every pulse rolls.
 */
function startBlast(session, target) {
  const casters = [session.branda, session.eldric].filter(fighting);
  if (casters.length === 0) return;
  const safe = blastSafeTile(session);
  session.blastSafe = safe;
  session.blastId = (session.blastId ?? 0) + 1;
  const id = session.blastId;
  for (const npc of casters) {
    const anims = Shared.animationsFor(npc.getId());
    npc.performAnimation(new core.Animation(anims.blastCharge));
    if (npc.getId() === Shared.BRANDA_ID) npc.performGraphic(new core.Graphic(Shared.BRANDA_CAST_GFX.blastCharge));
    npc.forceChat(Shared.shoutFor(npc.getId(), Shared.BLAST_CHARGE_SHOUTS));
  }
  const { area } = session;
  const safeAt = arenaSpot(session, safe.x, safe.y);
  session.safeObject = addLoc(session, Shared.SAFE_TILE_OBJECT, safeAt.x, safeAt.y, 22, 0);
  spawnSafeTimer(session, safeAt);
  CombatAchievements.blastCharged(session, id);
  later(Shared.BLAST_FIRE_TICKS, () => {
    if (session.blastId !== id || area.isDestroyed()) return;
    const firing = casters.filter(fighting);
    for (const npc of firing) {
      const anims = Shared.animationsFor(npc.getId());
      npc.performAnimation(new core.Animation(anims.blastFire));
      if (npc.getId() === Shared.BRANDA_ID) npc.performGraphic(new core.Graphic(Shared.BRANDA_CAST_GFX.blastFire));
      npc.forceChat(Shared.shoutFor(npc.getId(), Shared.BLAST_FIRE_SHOUTS));
    }
    if (firing.length === 0) return;
    for (const player of session.players) {
      if (!player.isRegistered()) continue;
      for (const delay of Shared.BLAST_PULSE_SOUND_DELAYS) {
        player.getPacketSender().sendSoundEffect(Shared.BLAST_PULSE_SOUND, 1, delay);
      }
    }
    const ids = new Set(firing.map((npc) => npc.getId()));
    for (const offset of Shared.BLAST_PULSE_OFFSETS) {
      later(offset, () => blastPulse(session, id, ids));
    }
    later(Shared.BLAST_PULSE_OFFSETS[Shared.BLAST_PULSE_OFFSETS.length - 1] + 2, () => {
      if (session.blastId !== id) return;
      if (session.safeObject) {
        core.ObjectManager.deregister(session.safeObject, true);
        session.safeObject = null;
      }
      CombatAchievements.blastResolved(session, id);
    });
  });
}

/** The safe tile's progress bar: an invisible NPC on it with a filling headbar (captured). */
function spawnSafeTimer(session, at) {
  const timer = core.NPC.create(Shared.SAFE_TIMER_NPC_ID, new core.Location(at.x, at.y, 0));
  timer.__skipDefaultRespawn = true;
  timer.setFlag("combat:no-retaliate");
  timer.getMovementQueue().setBlockMovement(true).reset();
  timer.setAttribute(Shared.ENCOUNTER_ATTRIBUTE, session);
  const { id, fill, endFill, cycles } = Shared.SAFE_TIMER_HEADBAR;
  timer.showHeadbar(id, { fill, endFill, duration: cycles });
  session.area.add(timer);
  core.World.getAddNPCQueue().push(timer);
  later(Shared.SAFE_TIMER_TICKS, () => {
    if (timer.isRegistered()) core.World.getRemoveNPCQueue().push(timer);
  });
}

/**
 * The safe tile, authored: anywhere in the blast area with both titans fighting; with one
 * left, on the row farthest from it (Branda alone: y 9564; Eldric alone: y 9570), random x.
 * Never on a live wall tile, nor on one still forming (captured: 0 overlaps in 58 blasts,
 * at charge and at fire); if walls cover every candidate, any tile (never fail).
 */
function blastSafeTile(session) {
  const { minX, maxX, minY, maxY } = Shared.BLAST_AREA;
  const brandaIn = fighting(session.branda);
  const eldricIn = fighting(session.eldric);
  const rows = [];
  if (brandaIn && !eldricIn) rows.push(minY);
  else if (eldricIn && !brandaIn) rows.push(maxY);
  else for (let y = minY; y <= maxY; y++) rows.push(y);
  const targeted = new Set();
  for (const row of session.pendingRows ?? []) {
    for (const [x, y] of row.tiles) targeted.add(Shared.tileKey(x, y));
  }
  const free = [];
  for (const y of rows) {
    for (let x = minX; x <= maxX; x++) {
      const at = arenaSpot(session, x, y);
      if (targeted.has(Shared.tileKey(at.x, at.y))) continue;
      if (rowsAt(session, at.x, at.y).length === 0) free.push({ x, y });
    }
  }
  if (free.length > 0) return Shared.pick(free);
  const x = Shared.randomBetween(minX, maxX);
  if (brandaIn && !eldricIn) return { x, y: minY };
  if (eldricIn && !brandaIn) return { x, y: maxY };
  return { x, y: Shared.randomBetween(minY, maxY) };
}

/** Which titan's grid an authored blast tile shows, given the casters. */
function gridOwner(ids, safe, y) {
  if (ids.size === 1) return [...ids][0];
  return y > safe.y ? Shared.BRANDA_ID : Shared.ELDRIC_ID;
}

function blastPulse(session, id, ids) {
  if (session.blastId !== id || session.area.isDestroyed()) return;
  const safe = session.blastSafe;
  const { minX, maxX, minY, maxY } = Shared.BLAST_AREA;
  for (let x = minX; x <= maxX; x++) {
    for (let y = minY; y <= maxY; y++) {
      if (x === safe.x && y === safe.y) continue;
      const owner = gridOwner(ids, safe, y);
      arenaTileGraphic(session, x, y, owner === Shared.BRANDA_ID ? Shared.BLAST_FIRE_GFX : Shared.BLAST_ICE_GFX);
    }
  }
  const safeAt = arenaSpot(session, safe.x, safe.y);
  for (const player of session.players) {
    if (!alive(player)) continue;
    const pos = tileOf(player);
    if (pos.x === safeAt.x && pos.y === safeAt.y) continue;
    const damage = core.Misc.getRandom(Shared.BLAST_MAX);
    if (damage <= 0) continue;
    player.getCombat().getHitQueue().addPendingDamage([new core.HitDamage(damage, core.HitMask.RED)]);
    CombatAchievements.avoidableDamage(player, damage, "blast");
  }
  for (const minion of [...session.minions]) {
    if (!alive(minion)) continue;
    const damage = core.Misc.getRandom(Shared.BLAST_MAX);
    if (damage <= 0) continue;
    minion.getCombat().getHitQueue().addPendingDamage([new core.HitDamage(damage, core.HitMask.RED)]);
    CombatAchievements.minionHitByTitan(session, minion, damage);
  }
}

/**
 * A mobile titan's move after an attack (captured): it stays at the edge after a stomp 83% of
 * the time; otherwise, 9 ticks after the attack, it walks a tile a tick to its other spot
 * (from the back 45%, shouting as it sets off) or along its side, 2-6 tiles, and attacks 2
 * ticks after arriving. Returns the steps (0 when it stays, or is static).
 */
function planWalk(npc, spot, choice) {
  if (npc.getAttribute(Shared.TELEPORTED_ATTRIBUTE) === true || !fighting(npc)) return 0;
  if (spot === "edge" && choice === "melee" && Math.random() < Shared.STAY_AFTER_STOMP_CHANCE) return 0;
  const session = sessionOfNpc(npc);
  const bounds = Shared.MOBILE_BOUNDS[npc.getId()];
  const edgeX = npc.getId() === Shared.BRANDA_ID ? bounds.maxX : bounds.minX;
  const backX = npc.getId() === Shared.BRANDA_ID ? bounds.minX : bounds.maxX;
  const advance = spot === "back" && Math.random() < Shared.ADVANCE_CHANCE;
  const x = spot === "edge" || !advance ? backX : edgeX;
  const here = Shared.authoredTile(session.area, npc.getLocation().getX(), npc.getLocation().getY());
  let dest;
  if (advance) {
    // Up to the edge, its middle row on the target's (captured: 64 of 93 stomps lined up).
    const target = npc.getCombat().getTarget();
    const aim = target ? Shared.authoredTile(session.area, target.getLocation().getX(), target.getLocation().getY()) : here;
    const y = Math.max(bounds.minY, Math.min(bounds.maxY, aim.y - 1));
    dest = { x, y, steps: Math.max(Math.abs(x - here.x), Math.abs(y - here.y)) };
  } else {
    const options = [];
    for (let y = bounds.minY; y <= bounds.maxY; y++) {
      const steps = Math.max(Math.abs(x - here.x), Math.abs(y - here.y));
      if (steps >= Shared.WALK_MIN_STEPS && steps <= Shared.WALK_MAX_STEPS) options.push({ x, y, steps });
    }
    if (options.length === 0) return 0;
    dest = Shared.pick(options);
  }
  walks.set(npc, { startAt: core.World.getProcessCycle() + Shared.WALK_DELAY_TICKS, dest, advance, started: false });
  return dest.steps;
}

/** At the lane edge between attacks, a titan keeps its middle row on its target's: one step
 * along y a tick (captured stomps line up with the player). */
function trackRow(session, npc) {
  if (npc.getAttribute(Shared.TELEPORTED_ATTRIBUTE) === true || !fighting(npc) || spotOf(npc) !== "edge") return;
  const combat = npc.getCombat();
  const target = combat.getTarget();
  if (!target || combat.getAttackDelay() <= 1) return;
  const bounds = Shared.MOBILE_BOUNDS[npc.getId()];
  const here = Shared.authoredTile(session.area, npc.getLocation().getX(), npc.getLocation().getY());
  const aim = Shared.authoredTile(session.area, target.getLocation().getX(), target.getLocation().getY());
  const dy = Math.sign(Math.max(bounds.minY, Math.min(bounds.maxY, aim.y - 1)) - here.y);
  if (dy === 0) return;
  combat.preserveMovementForTicks(1);
  npc.getMovementQueue().walkStep(0, dy);
}

/** One step a tick along each titan's walk plan; the engine's own chase stays off. */
function stepTitans(session) {
  const now = core.World.getProcessCycle();
  for (const npc of [session.branda, session.eldric]) {
    if (!npc) continue;
    const walk = walks.get(npc);
    if (!walk) {
      trackRow(session, npc);
      continue;
    }
    if (now < walk.startAt) continue;
    if (!fighting(npc) || npc.getAttribute(Shared.TELEPORTED_ATTRIBUTE) === true) {
      walks.delete(npc);
      continue;
    }
    const here = Shared.authoredTile(session.area, npc.getLocation().getX(), npc.getLocation().getY());
    const dx = Math.sign(walk.dest.x - here.x);
    const dy = Math.sign(walk.dest.y - here.y);
    if (dx === 0 && dy === 0) {
      walks.delete(npc);
      faceAcross(npc);
      continue;
    }
    if (!walk.started) {
      walk.started = true;
      // Coming up to the lane edge, a titan calls out (captured flavour lines).
      if (walk.advance) npc.forceChat(Shared.shoutFor(npc.getId(), Shared.FLAVOR_SHOUTS));
    }
    npc.getCombat().preserveMovementForTicks(1);
    npc.getMovementQueue().walkStep(dx, dy);
  }
}

/** Per-tick engine: rows damage + expiry; minion fuse handled in Minions via the same tick. */
function tickSession(session) {
  if (session.area.isDestroyed()) return;
  stepTitans(session);
  tickRows(session);
  Minions.tickSession(session);
}

function tick() {
  // This runs every tick, fights or not: look the module up once and stop when nobody is fighting.
  sessions ??= require("./Area.RoyalTitans").sessions;
  if (sessions.size === 0) return;
  for (const session of sessions.values()) {
    const live = fighting(session.branda) || fighting(session.eldric);
    if (!live && session.rows.size === 0 && session.minions.size === 0) continue;
    tickSession(session);
  }
}

/** Teardown: rows, vfx, static locs and minions go with the fight. */
function endFight(session) {
  for (const hitbox of session.rows) {
    if (hitbox.isRegistered()) core.World.getRemoveNPCQueue().push(hitbox);
  }
  session.rows.clear();
  for (const minion of session.minions) {
    if (minion.isRegistered()) core.World.getRemoveNPCQueue().push(minion);
  }
  session.minions.clear();
  session.safeObject = null;
  for (const object of session.tileLocs.values()) core.ObjectManager.deregister(object, true);
  session.tileLocs.clear();
  session.pendingRows = [];
  clearStaticLocs(session);
}

/**
 * Rows are spell targets, never melee or ranged ones (asked by RoyalTitansArea.canAttack):
 * Douse/Melt are registered combat options (Nightmare's Charge precedent) so casts route to
 * Minions' row clearing, and anything else is refused with the hint.
 */
function rowAttackAllowed(attacker, target, method) {
  if (method?.type() === core.CombatType.MAGIC) return null;
  attacker.getAsPlayer().sendMessage(target.getId() === Shared.FIRE_ROW_ID ? Shared.FIRE_HINT : Shared.ICE_HINT);
  return false;
}

/** Rows, blasts and elementals for every live fight, once a tick. */
function defineEngineTask() {
  return class RoyalTitansEngine extends core.Task {
    constructor() {
      super(1, null, false);
    }

    execute() {
      tick();
    }
  };
}

function attach(api) {
  core = api.core;
  api.onNpcInteraction(Shared.FIRE_ROW_NAME, { Douse: tryRowClear });
  api.onNpcInteraction(Shared.ICE_ROW_NAME, { Melt: tryRowClear });
  api.registerNpcCombatOption("Douse");
  api.registerNpcCombatOption("Melt");
  core.TaskManager.submit(new (defineEngineTask())());
}

module.exports = {
  attach, areaSounds, telegraphMelee, startRow, clearRowTile, startMinions, teleportTitans,
  survivorEnraged, takeBlastTurn, blastSafeTile, endFight, addLoc, clearStaticLocs,
  rowAttackAllowed, planWalk, faceAcross, spotOf, hasOwnMinions, occupantsByTile,
  _test: { blastSafeTile },
};
