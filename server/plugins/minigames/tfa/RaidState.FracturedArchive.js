"use strict";

/**
 * A raid in progress: the party, its private copy of the Archive, the room it has reached, the
 * HUD (tfa_hud, 974), deaths and spectating, wipes, abandoning and coming back after a logout.
 *
 * Captured (docs/fractured-archive.md):
 * - Entering: "You enter the Archive...", a fade, hpbar_hud_show_extra_bar 0, the move three
 *   ticks later, the fade back two after that and the HUD two after that: 974 on
 *   overlay_atmosphere, the names (10042), the timer (10036) and each slot's state.
 * - A death in a challenge: "You have died. Total deaths: N." (the others see the name), "You
 *   will respawn when your party completes or fails the challenge." while anyone still fights,
 *   then "Spectating the room..." at the room's corner, tfa_client_spectate_mode 1 and the side
 *   tabs back without the inventory and combat tabs. Items are kept.
 * - A wipe, two ticks after the last death: the boss bar cleared, "You failed to survive the
 *   Fractured Archive.", a fade and jingle 90; three ticks later everyone is in the lobby in
 *   front of the door, and their items went as a death would take them (a gravestone there).
 * - Abandoning by the exit: a warning, "Abandon the raid?", "You abandon the raid and leave the
 *   Fractured Archive.", a fade and the move three ticks later.
 * Estimates: who goes in first (the leader, as in the Theatre of Blood), teleports being blocked,
 * a logout in a challenge counting as a death, and what happens when a room is won.
 */

const Shared = require("./Shared.FracturedArchive");
const Parties = require("./Parties.FracturedArchive");

const { SCRIPT, SLOT, TILE, MUSIC } = Shared;

const ATTR_RAID = "fractured-archive:raid";
/** Saved: the raid a player logged out of, and whether they were in a challenge. */
const ATTR_LOGOUT = "fractured-archive:logout";
/** Saved: total deaths, for "Total deaths: N." (it counts across raids on live). */
const ATTR_DEATHS = "fractured-archive:deaths";

/** Captured timings, in ticks. */
const ENTER_MOVE_DELAY = 3;
const ENTER_FADE_IN_DELAY = 5;
const ENTER_HUD_DELAY = 7;
const WIPE_DELAY = 2;
const WIPE_MOVE_DELAY = 3;
const LEAVE_MOVE_DELAY = 3;

/** Between rooms (captured): the move four ticks after the fade, the HUD two ticks later. */
const ROOM_MOVE_DELAY = 4;
const ROOM_HUD_DELAY = 2;
/** The Alliance Navigator steps in three ticks after a boss falls (captured). */
const NAVIGATOR_DELAY = 3;

const STAGE = { IDLE: "idle", STARTED: "started", COMPLETED: "completed" };

/** Ticks as live prints them: m:ss.ss, a tick being 0.6 seconds (.00/.20/.40/.60/.80). */
function formatTime(ticks) {
  const centis = Math.max(0, ticks) * 60;
  const minutes = Math.floor(centis / 6000);
  const seconds = ((centis % 6000) / 100).toFixed(2).padStart(5, "0");
  return `${minutes}:${seconds}`;
}

const raids = new Map();
const roomTypes = new Map();
let nextRaidId = 1;
let AreaClass = null;

function registerRoom(key, RoomClass) {
  roomTypes.set(key, RoomClass);
}

function raidOf(player) {
  const raid = player?.getAttribute?.(ATTR_RAID);
  return raid && raids.get(raid.id) === raid ? raid : null;
}

function areaClass() {
  if (AreaClass) return AreaClass;
  const { PrivateArea, Boundary } = Shared.core();
  const { ARCHIVE_BOXES, ARCHIVE_PLANES } = Shared;
  AreaClass = class FracturedArchiveArea extends PrivateArea {
    constructor(raid) {
      super(ARCHIVE_BOXES.flatMap((box) => ARCHIVE_PLANES.map((z) => new Boundary(box.minX, box.maxX, box.minY, box.maxY, z))));
      this.raid = raid;
    }

    getName() {
      return "The Fractured Archive";
    }

    isMulti() {
      return true;
    }

    allowSummonPet() {
      return false;
    }

    postLeave(mobile, logout) {
      if (mobile.isPlayer?.()) this.raid.onAreaLeave(mobile.getAsPlayer(), logout);
      super.postLeave(mobile, logout);
    }

    process() {
      this.raid.processOnce();
    }

    /** A walk click mid roll or hop: the room may chain another (Ezekiel's rolls, Ocellus' stones). */
    handleForcedWalk(player, destination) {
      return this.raid.room?.forcedWalk?.(player, destination) === true;
    }

    canTeleport(player) {
      Shared.mesbox(player, "You can't teleport out of the Archive.");
      return false;
    }

    /** Spectators and a room's scripted NPCs take no part in the fighting; then the room decides. */
    canAttack(attacker, target, method) {
      if (attacker?.__tfaScripted) return false;
      if (attacker?.isPlayer?.() && this.raid.member(attacker)?.dead) return false;
      if (target?.isPlayer?.() && this.raid.member(target)?.dead) return false;
      return this.raid.room?.canAttack?.(attacker, target, method) ?? null;
    }
  };
  return AreaClass;
}

class Member {
  constructor() {
    /** The room the player is in, or null while still on their way in. */
    this.roomKey = null;
    /** In the challenge since it started (the dead watch until it ends). */
    this.fighting = false;
    this.dead = false;
    /** The party slot spectated (0-7), or -1 for the room. */
    this.spectating = -1;
    this.hud = new Map();
    this.hudOpen = false;
    /** The raid's attempt counted in the records (on the first arrival). */
    this.counted = false;
    /** Between two rooms (the fade): the HUD shows the slot as away. */
    this.moving = false;
  }
}

// ---------------------------------------------------------------- rooms

/** Shared room behaviour: the challenge's stage, its NPCs and locs, deaths, cleanup. */
class Room {
  constructor(raid, def) {
    this.raid = raid;
    this.def = def;
    this.stage = STAGE.IDLE;
    this.npcs = new Set();
    this.objects = [];
    this.taskKey = {};
    this.startCycle = 0;
    /** The party size the room scaled for, fixed as the challenge starts (at least two, Wiki). */
    this.size = 2;
    this.destroyed = false;
  }

  get key() {
    return this.def.key;
  }

  get area() {
    return this.raid.area;
  }

  /** The world tile for one of the room's real-map tiles (the Nexus maps them into its instance). */
  worldLoc(tile) {
    return Shared.loc(tile);
  }

  isStarted() {
    return this.stage === STAGE.STARTED;
  }

  isCompleted() {
    return this.stage === STAGE.COMPLETED;
  }

  /** Called once when the party reaches the room. */
  build() {
    this.size = this.raid.partySize();
    this.onBuild();
  }

  /**
   * A value from a captured per-party-size table ({ 2: ..., 3: ..., 4: ..., 5: ... }). Below
   * two counts as two (Wiki); past the largest captured size it grows by the last step
   * (an estimate).
   */
  scaled(table, size = this.size) {
    const sizes = Object.keys(table).map(Number).sort((a, b) => a - b);
    const wanted = Math.max(sizes[0], size);
    if (table[wanted] !== undefined) return table[wanted];
    const last = sizes[sizes.length - 1];
    const step = table[last] - table[sizes[sizes.length - 2] ?? last];
    return table[last] + step * (wanted - last);
  }

  /** Sets an NPC's maximum and current hitpoints. */
  setHitpoints(npc, hitpoints) {
    npc.setMaxHitpoints(hitpoints);
    npc.setHitpoints(hitpoints);
  }

  onBuild() {}

  onStart() {}

  onComplete() {}

  tick() {}

  later(ticks, action) {
    return Shared.later(this.taskKey, ticks, () => {
      if (!this.destroyed) action();
    });
  }

  repeat(ticks, action) {
    return Shared.repeat(this.taskKey, ticks, () => !this.destroyed && action() !== false);
  }

  placeObject(objectId, tile, type = 10, face = 0) {
    const { GameObject, ObjectManager } = Shared.core();
    const object = new GameObject(objectId, Shared.loc(tile), type, face, this.area);
    ObjectManager.register(object, true);
    this.objects.push(object);
    return object;
  }

  removeObject(object) {
    if (!object) return;
    Shared.core().ObjectManager.deregister(object, true);
    this.objects = this.objects.filter((other) => other !== object);
  }

  /** Swaps a placed loc for another on the same tile (a mushroom growing, a door). */
  replaceObject(object, objectId) {
    const location = object.getLocation();
    const tile = { x: location.getX(), y: location.getY(), z: location.getZ() };
    this.removeObject(object);
    return this.placeObject(objectId, tile, object.getType(), object.getFace());
  }

  /**
   * Spawns one of the room's NPCs. `scripted` NPCs move and attack only as the room drives them;
   * `fadeIn` fades it in over that many client cycles (OSRS npc transparency, as live spawns most
   * of the raid's NPCs).
   */
  spawn(npcId, tile, { face, scripted = false, fadeIn = 0 } = {}) {
    const npc = Shared.api().spawnNpc({ id: npcId, x: tile.x, y: tile.y, z: tile.z ?? 0, wanderRadius: 0, face });
    if (!npc) return null;
    npc.__skipDefaultRespawn = true;
    npc.__tfaRoom = this;
    if (scripted) {
      npc.__tfaScripted = true;
      npc.setScriptedMovement?.(true);
      npc.setFlag?.("combat:no-retaliate");
      // It keeps facing its target at any range (else the engine turns it back to its spawn facing).
      npc.setFlag?.("interaction:keep");
      // Its hitpoints are the room's to keep (the Guardian's shield and health).
      npc.setFlag?.("combat:no-regen");
    }
    this.area.add(npc);
    this.npcs.add(npc);
    if (fadeIn > 0) npc.fade(0, { from: 255, endCycles: fadeIn });
    return npc;
  }

  despawn(npc) {
    if (!npc) return;
    this.npcs.delete(npc);
    this.area.detach(npc);
    Shared.api().removeNpc(npc);
  }

  /** Party members in this room, alive, who are taking part in the challenge. */
  fighters() {
    return this.raid.players.filter((player) => {
      const member = this.raid.member(player);
      return member.roomKey === this.key && member.fighting && !member.dead && player.getHitpoints() > 0
        && this.raid.contains(player);
    });
  }

  roomPlayers() {
    return this.raid.players.filter((player) => this.raid.member(player).roomKey === this.key);
  }

  /**
   * The challenge starts for everyone in the room. Captured: only the Archive Guardian says
   * "Challenge started"; the other bosses just start (their bar and music).
   */
  start() {
    if (this.stage !== STAGE.IDLE) return;
    this.stage = STAGE.STARTED;
    this.startCycle = Shared.cycle();
    this.size = this.raid.partySize();
    for (const player of this.roomPlayers()) {
      this.raid.member(player).fighting = true;
      if (this.def.announce) player.sendMessage(`Challenge started: ${this.def.name}.`);
      if (this.def.music) {
        Shared.api().emitCustomEvent("music:unlock-track", { player, trackId: this.def.music });
        player.getPacketSender().sendSong(this.def.music);
      }
      Shared.api().emitCustomEvent("fractured-archive:record", { player, category: this.key, field: "attempts" });
    }
    this.raid.challengeStarted(this);
    this.onStart();
  }

  /**
   * The challenge is won (captured): "Challenge complete: X. Duration: .. Total: ..", every
   * member back to full health (the dead get up), the music stops, and the Alliance Navigator
   * steps in three ticks later to lead the way back (the Archive Guardian and Ocellus have their
   * own ends).
   */
  complete() {
    if (this.stage !== STAGE.STARTED) return;
    this.stage = STAGE.COMPLETED;
    const raid = this.raid;
    const now = Shared.cycle();
    raid.challengeEnded(this);
    const duration = formatTime(now - this.startCycle);
    const total = formatTime(raid.elapsed());
    for (const player of this.roomPlayers()) {
      const member = raid.member(player);
      member.fighting = false;
      player.sendMessage(`Challenge complete: ${this.def.name}. Duration: <col=ef1020>${duration}</col>. Total: <col=ef1020>${total}</col>`);
      if (member.dead) raid.respawn(player, this);
      raid.restore(player);
      player.getPacketSender().sendSong(MUSIC.IN_RAID);
      Shared.api().emitCustomEvent("fractured-archive:record", { player, category: this.key, field: "completions" });
      Shared.api().emitCustomEvent("fractured-archive:record-time", { player, category: this.key, size: this.size, ticks: now - this.startCycle });
    }
    if (this.def.navigator) this.later(NAVIGATOR_DELAY, () => this.callNavigator());
    this.onComplete();
    raid.roomCompleted(this);
    Shared.api().emitCustomEvent("fractured-archive:room-complete", { raid, room: this.key, players: [...raid.players] });
  }

  /**
   * A player reached the room. A boss room with `autoStart` starts that many ticks after the
   * first arrival (captured for Bork: six; the others' bars started 5-12 ticks in).
   */
  onArrive() {
    if (this.def.autoStart === undefined || this.startScheduled || this.stage !== STAGE.IDLE) return;
    this.startScheduled = true;
    this.later(this.def.autoStart, () => this.start());
  }

  // ---------------------------------------------------------------- the boss bar

  /** The boss bar for everyone fighting here: its npc, maximum and colours (default red/green). */
  showBar(npcId, maximum, colours) {
    this.bar = { npcId, current: maximum, maximum, colours };
    for (const player of this.fighters()) Shared.api().emitCustomEvent("boss-hud:show", { player, npcId, current: maximum, maximum, colours });
  }

  /** The bar's value, sent when it changes. */
  barTo(current, extra = {}) {
    if (!this.bar) return;
    const value = Math.max(0, Math.round(current));
    if (value === this.bar.current && !extra.force) return;
    this.bar.current = value;
    for (const player of this.fighters()) Shared.api().emitCustomEvent("boss-hud:update", { player, current: value, ...extra });
  }

  /** The second bar under the first (the Smorks, Ocellus' first phase). */
  extraBar(current, maximum, colours) {
    for (const player of this.fighters()) Shared.api().emitCustomEvent("boss-hud:extra", { player, current: Math.max(0, Math.round(current)), maximum, colours });
  }

  /** The bars fade out and go (captured: hp_hud_fade_out, then the values cleared). */
  hideBars() {
    this.bar = null;
    for (const player of this.roomPlayers()) Shared.api().emitCustomEvent("boss-hud:hide", { player });
  }

  /** The Alliance Navigator fades in at the arena's edge (captured): "Follow" goes back to the Nexus. */
  callNavigator() {
    this.navigator = this.spawn(Shared.id("npc", "NAVIGATOR"), this.def.navigator, { face: Shared.core().Direction.EAST.getId(), fadeIn: 30 });
  }

  /** The challenge is lost: the room goes quiet (the raid moves everyone out). */
  fail() {
    this.stage = STAGE.COMPLETED;
    Shared.core().TaskManager.cancelTasks(this.taskKey);
    this.onFail?.();
  }

  // ---------------------------------------------------------------- combat helpers

  /**
   * A boss attack in one style: accuracy rolled (unless `accurate`), damage up to `maxHit`.
   * The matching protection prayer lets `prayerMultiplier` of it through (none by default);
   * `prayable: false` ignores prayer.
   */
  styledHit(npc, target, style, maxHit, delay, { accurate = false, prayerMultiplier = 0, prayable = true } = {}) {
    const { PendingHit, CombatFactory } = Shared.core();
    const hit = new PendingHit(npc, target, styleMethod(style), { delay, rollAccuracy: !accurate });
    CombatFactory.applyStyleDamage(hit, Math.max(0, Math.floor(maxHit)), { bypassProtectionPrayer: true });
    if (prayable && target.isPlayer?.() && Shared.isProtected(target, style)) {
      for (const part of hit.getHits()) part.setDamage(Math.floor(part.getDamage() * prayerMultiplier));
      hit.updateTotalDamage();
    }
    return hit;
  }

  /** Queues a styled hit on a player, for attacks outside the boss's own combat swing. */
  strike(npc, player, style, maxHit, delay, options) {
    const hit = this.styledHit(npc, player, style, maxHit, delay, options);
    // Due now, it lands now: queued, it would wait for the player's next turn (a tick late,
    // as rooms tick after it). A later one is due on its own tick's turn, as it should be.
    if (delay <= 0) {
      Shared.core().CombatFactory.executeHit(hit);
      return hit;
    }
    player.getCombat().getHitQueue().addPendingHit(hit, Shared.cycle() + delay);
    return hit;
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    Shared.core().TaskManager.cancelTasks(this.taskKey);
    for (const npc of [...this.npcs]) this.despawn(npc);
    const { ObjectManager } = Shared.core();
    for (const object of this.objects) ObjectManager.deregister(object, true);
    this.objects = [];
  }
}

// ---------------------------------------------------------------- the raid

class Raid {
  constructor(party, leader) {
    this.id = nextRaidId++;
    this.party = party;
    party.raid = this;
    /** The client's tfa_mycontroller while inside (an opaque number on live). */
    this.controller = 0x3000000 + this.id;
    this.players = [];
    this.members = new Map();
    /** Members who logged out, by username: { fight }. */
    this.away = new Map();
    /** The party when the leader went in: the HUD keeps their slots. */
    this.roster = [...party.members];
    this.area = new (areaClass())(this);
    this.room = null;
    /** Every room built and still in use, by key; `room` is the one the party has reached. */
    this.rooms = new Map();
    /** The raid's clock (10036): from the first challenge, never reset, stopped after Ocellus. */
    this.raidStart = -1;
    this.finishedTicks = -1;
    /** Bosses beaten past the Guardian (0-3), and the side taken through each section. */
    this.section = 0;
    this.path = {};
    /** Spectators from outside (Spectate.*), by player: the HUD and room view without fighting. */
    this.watchers = new Map();
    this.lastCycle = -1;
    this.over = false;
    // Only the leader is in; the others join as they go through the door themselves.
    this.add(leader);
    raids.set(this.id, this);
  }

  member(player) {
    let member = this.members.get(player);
    if (!member) {
      member = new Member();
      this.members.set(player, member);
    }
    return member;
  }

  hasMember(player) {
    return this.players.includes(player);
  }

  /** A member's or an outside spectator's HUD state. */
  viewState(player) {
    return this.members.get(player) ?? this.watchers.get(player) ?? null;
  }

  /** Everyone who sees the HUD: the party in the Archive and the outside spectators. */
  viewers() {
    return [...this.players, ...this.watchers.keys()];
  }

  /** Members still outside can go in until the Archive Guardian is touched. */
  canJoin() {
    return !this.over && this.raidStart < 0;
  }

  /** The party size bosses scale for: the members in the raid, at least two (Wiki). */
  partySize() {
    return Math.max(2, this.players.length);
  }

  /** Ticks since the first challenge started (frozen once the raid is finished). */
  elapsed() {
    if (this.raidStart < 0) return 0;
    return this.finishedTicks >= 0 ? this.finishedTicks : Shared.cycle() - this.raidStart;
  }

  add(player) {
    if (!this.players.includes(player)) this.players.push(player);
    player.setAttribute(ATTR_RAID, this);
    this.member(player);
  }

  /** The room for a key, built the first time the party reaches it; it becomes the current one. */
  buildRoom(key) {
    let room = this.rooms.get(key);
    if (!room) {
      const RoomClass = roomTypes.get(key) ?? Room;
      room = new RoomClass(this, ROOMS[key]);
      this.rooms.set(key, room);
      this.room = room;
      room.build();
    }
    this.room = room;
    return room;
  }

  /** Rooms nobody is in any more (and that the party has left behind) are taken down. */
  pruneRooms() {
    for (const [key, room] of [...this.rooms]) {
      if (room === this.room) continue;
      if (this.players.some((player) => this.member(player).roomKey === key)) continue;
      room.destroy();
      this.rooms.delete(key);
    }
  }

  /**
   * From one room to another (captured): a fade, the move four ticks later, the HUD again two
   * ticks after that. `tile` overrides the room's arrival (the Nexus, beside the door taken).
   */
  moveTo(player, key, tile) {
    if (!this.players.includes(player)) return;
    const room = this.buildRoom(key);
    const member = this.member(player);
    member.moving = true;
    Shared.fade(player, true);
    player.getMovementQueue().reset().setBlockMovement(true);
    Shared.later(player, ROOM_MOVE_DELAY, () => {
      if (!this.players.includes(player) || this.over) return;
      member.moving = false;
      member.roomKey = room.key;
      member.fighting = room.isStarted();
      player.getMovementQueue().setBlockMovement(false);
      this.placeIn(player, room, tile ?? room.def.arrival);
      Shared.fade(player, false);
      if (!room.isStarted()) player.getPacketSender().sendSong(MUSIC.IN_RAID);
      Shared.later(player, ROOM_HUD_DELAY, () => {
        if (this.players.includes(player)) this.openHud(player);
      });
      room.onArrive?.(player);
      this.pruneRooms();
      this.followWithWatchers(room);
    });
  }

  /**
   * A member found outside the Archive (alive, in a room, not between rooms) has left it some way
   * the raid didn't see (a death another plugin took, a teleport): they leave the raid, so
   * nothing keeps attacking them or showing them its HUD.
   */
  dropStrays() {
    for (const player of [...this.players]) {
      const member = this.members.get(player);
      if (!member?.roomKey || member.moving || member.dead || player.getForceMovement?.()) continue;
      if (this.contains(player)) continue;
      console.warn(`[FracturedArchive] ${player.getUsername()} left raid ${this.id} from outside it, at ${player.getLocation()}`);
      this.remove(player);
    }
  }

  // ---------------------------------------------------------------- areas

  /** Whether an area is one of this raid's: its own, or a room's instance (the Nexus). */
  ownsArea(area) {
    if (!area) return false;
    if (area === this.area) return true;
    for (const room of this.rooms.values()) if (room.area === area) return true;
    return false;
  }

  /** Whether a player is inside the raid's map (the Archive's squares or a room's instance). */
  contains(player) {
    return Shared.inArchive(player.getLocation()) || this.ownsArea(player.getArea?.());
  }

  /** Into a room's area (leaving another of the raid's) and onto one of its tiles. */
  placeIn(player, room, tile) {
    const target = room.area;
    const current = player.getArea?.();
    if (current !== target) {
      if (this.ownsArea(current) && !current.isDestroyed()) current.leave(player, false);
      target.enter(player);
    }
    player.moveTo(room.worldLoc(tile));
  }

  /** Out of whichever of the raid's areas the player is in. */
  leaveArea(player) {
    const area = player.getArea?.();
    if (this.ownsArea(area) && !area.isDestroyed()) area.leave(player, false);
  }

  // ---------------------------------------------------------------- outside spectators

  /**
   * A spectator from the Strategy board (captured): parked out of sight on local tile 62,1 of
   * the party's room, spectate mode 2, the side tabs closed and the HUD open; the external
   * spectator count (16425) goes up for everyone watching.
   */
  addWatcher(player) {
    if (this.over || this.watchers.has(player)) return false;
    const room = this.room;
    if (!room) return false;
    const watcher = { watcher: true, hud: new Map(), hudOpen: false, moving: true, spectating: -1, roomKey: room.key };
    this.watchers.set(player, watcher);
    Shared.fade(player, true);
    player.getMovementQueue().reset().setBlockMovement(true);
    Shared.later(player, ROOM_MOVE_DELAY, () => {
      if (this.watchers.get(player) !== watcher) return;
      this.park(player, room);
      watchView(player, room);
      watcher.moving = false;
      const sender = player.getPacketSender();
      sender.sendVarbit(Shared.id("varbit", "SPECTATE_MODE"), 2);
      sender.sendVarbit(Shared.id("varbit", "SPECTATE_SLOT"), 0);
      // Live closes side tabs 0-6; the inventory and combat tabs (as for the dead) are what
      // this server can put back afterwards.
      sender.closeSubInterface(Shared.id("component", "SIDE_INVENTORY"));
      sender.closeSubInterface(Shared.id("component", "SIDE_COMBAT"));
      player.sendMessage("Spectating the room. Click a fighting player's health display to spectate them.");
      Shared.fade(player, false);
      Shared.later(player, ROOM_HUD_DELAY, () => {
        if (this.watchers.get(player) === watcher) this.openHud(player);
      });
      this.sendWatcherCount();
    });
    return true;
  }

  park(player, room) {
    const at = room.def.spectate ?? TILE.SPECTATE;
    this.placeIn(player, room, { x: Math.floor(at.x / 64) * 64 + 62, y: Math.floor(at.y / 64) * 64 + 1, z: at.z ?? 0 });
    player.setUntargetable(true);
    player.getCombat().reset();
  }

  /** The party reached another room: the spectators follow, the slot they watched kept. */
  followWithWatchers(room) {
    for (const [player, watcher] of this.watchers) {
      if (watcher.roomKey === room.key) continue;
      watcher.roomKey = room.key;
      const slot = watcher.spectating;
      watcher.moving = true;
      player.getPacketSender().sendVarbit(Shared.id("varbit", "SPECTATE_SLOT"), 0);
      player.sendMessage("Spectating the room. Click a fighting player's health display to spectate them.");
      Shared.fade(player, true);
      Shared.later(player, ROOM_MOVE_DELAY, () => {
        if (this.watchers.get(player) !== watcher) return;
        this.park(player, room);
        watchView(player, room);
        watcher.moving = false;
        Shared.fade(player, false);
        Shared.later(player, ROOM_HUD_DELAY, () => {
          if (this.watchers.get(player) !== watcher) return;
          this.openHud(player);
          if (slot >= 0) this.spectateSlot(player, slot);
        });
      });
    }
  }

  /** The HUD's Leave, a wipe or the party gone: back to the lobby (captured ~4117,5547). */
  removeWatcher(player) {
    const watcher = this.watchers.get(player);
    if (!watcher) return;
    this.watchers.delete(player);
    this.closeHud(player);
    this.leaveArea(player);
    Shared.fade(player, true);
    Shared.later(player, ROOM_MOVE_DELAY, () => {
      player.getMovementQueue().setBlockMovement(false);
      player.setUntargetable(false);
      restoreTabs(player);
      player.moveTo(Shared.loc(TILE.SPECTATOR_LEAVE));
      Shared.fade(player, false);
      player.getPacketSender().sendSong(MUSIC.INTO_THE_ARCHIVE);
    });
    this.sendWatcherCount();
  }

  sendWatcherCount() {
    const count = this.watchers.size;
    for (const viewer of this.viewers()) viewer.getPacketSender().sendVarbit(Shared.named("varbit", "tfa_client_num_external_spectators"), count);
  }

  /** A room's challenge was won: the Nexus' next section opens (Hub.*), the raid ends after Ocellus. */
  roomCompleted(room) {
    if (room.def.section) this.section = Math.max(this.section, room.def.section);
  }

  /** "The Fractured Archive: Total completion time: .." (captured), and the clock stops. */
  finish() {
    if (this.finishedTicks >= 0) return;
    this.finishedTicks = this.elapsed();
    for (const player of this.players) {
      player.sendMessage(`The Fractured Archive: Total completion time: <col=ef1020>${formatTime(this.finishedTicks)}</col>`);
      Shared.api().emitCustomEvent("fractured-archive:record", { player, category: "overall", field: "completions" });
      Shared.api().emitCustomEvent("fractured-archive:record-time", { player, category: "overall", size: this.partySize(), ticks: this.finishedTicks });
    }
  }

  /** Hitpoints and prayer back to full (captured: every slot back to full health on a win). */
  restore(player) {
    const { Skill } = Shared.core();
    const skills = player.getSkillManager();
    for (const skill of [Skill.HITPOINTS, Skill.PRAYER]) {
      if (skills.getCurrentLevel(skill) < skills.getMaxLevel(skill)) skills.setCurrentLevel(skill, skills.getMaxLevel(skill), true);
    }
  }

  /** In through the Archive Door: the fade, then the Archive (all timings captured). */
  enter(player) {
    if (!this.players.includes(player)) {
      if (!this.party.has(player) || !this.canJoin()) return false;
      this.add(player);
    }
    if (this.member(player).roomKey) return false;
    if (!this.room) this.buildRoom("GUARDIAN");
    const sender = player.getPacketSender();
    sender.sendConfig(Shared.id("varp", "SHOW_EXTRA_BAR"), 0);
    player.sendMessage("You enter the Archive...");
    Shared.api().emitCustomEvent("fractured-archive:miniquest-stage", { player, stage: 4 });
    sender.closeSubInterface(Shared.id("component", "OVERLAY_HUD"));
    Shared.fade(player, true);
    Shared.api().emitCustomEvent("boss-hud:reset", { player });
    player.getMovementQueue().reset().setBlockMovement(true);
    Shared.later(player, ENTER_MOVE_DELAY, () => this.arrive(player, this.room));
    return true;
  }

  arrive(player, room) {
    if (this.over || !this.players.includes(player)) return;
    const member = this.member(player);
    if (player.getArea?.() !== this.area) this.area.enter(player);
    player.getMovementQueue().setBlockMovement(false);
    player.moveTo(Shared.loc(room.def.arrival));
    if (!member.counted) {
      member.counted = true;
      record(player, "overall", "attempts");
    }
    member.roomKey = room.key;
    player.getPacketSender().sendConfig(Shared.id("varp", "CONTROLLER"), this.controller);
    player.getPacketSender().sendClientScript(SCRIPT.RAID_ENTER);
    Shared.later(player, ENTER_FADE_IN_DELAY - ENTER_MOVE_DELAY, () => {
      if (!this.players.includes(player)) return;
      Shared.fade(player, false);
      player.getPacketSender().sendSong(MUSIC.IN_RAID);
    });
    Shared.later(player, ENTER_HUD_DELAY - ENTER_MOVE_DELAY, () => {
      if (this.players.includes(player)) this.openHud(player);
    });
    room.onArrive?.(player);
    this.refreshPartyStatus();
  }

  // ---------------------------------------------------------------- tick

  processOnce() {
    const now = Shared.cycle();
    if (now === this.lastCycle || this.over) return;
    this.lastCycle = now;
    this.dropStrays();
    if (this.room && !this.room.destroyed) this.room.tick();
    this.sendTimer();
    this.refreshStatuses();
  }

  // ---------------------------------------------------------------- HUD

  slotOf(player) {
    return this.roster.findIndex((other) => other.getUsername() === player.getUsername());
  }

  /** tfa_hud (974): the eight names, the viewer's slot (1-based), the timer and the slots. */
  openHud(player) {
    const sender = player.getPacketSender();
    const member = this.viewState(player) ?? this.member(player);
    sender.sendSubInterface(Shared.id("component", "OVERLAY_ATMOSPHERE"), Shared.id("iface", "HUD"), 1);
    sender.sendVarbit(Shared.id("varbit", "PARTY_SLOT"), member.watcher ? 0 : this.slotOf(player) + 1);
    const names = Array.from({ length: Shared.MAX_PARTY_SIZE }, (_, i) => (this.roster[i] ? Shared.displayName(this.roster[i]) : ""));
    sender.sendClientScript(SCRIPT.HUD_NAMES, ...names);
    member.hud.clear();
    member.hudOpen = true;
    this.sendTimer(player);
    this.refreshStatuses();
  }

  closeHud(player) {
    const sender = player.getPacketSender();
    const member = this.members.get(player);
    if (member) member.hudOpen = false;
    sender.closeSubInterface(Shared.id("component", "OVERLAY_ATMOSPHERE"));
    sender.sendVarbit(Shared.id("varbit", "PARTY_SLOT"), 0);
    sender.sendVarbit(Shared.id("varbit", "SPECTATE_MODE"), 0);
    sender.sendVarbit(Shared.id("varbit", "SPECTATE_SLOT"), 0);
    for (const varbit of Shared.ids().varbit.SLOTS) sender.sendVarbit(varbit, 0);
  }

  /** 10036 (captured): (0, 1) before the first challenge, (ticks, 0) from then on, (ticks, 1) once finished. */
  sendTimer(only) {
    const running = this.raidStart >= 0 && this.finishedTicks < 0;
    const ticks = this.elapsed();
    for (const player of only ? [only] : this.viewers()) {
      const member = this.viewState(player);
      if (!member?.hudOpen || member.moving) continue;
      player.getPacketSender().sendClientScript(SCRIPT.HUD_TIMER, ticks, running ? 0 : 1);
    }
  }

  challengeStarted() {
    if (this.raidStart < 0) this.raidStart = Shared.cycle();
    this.refreshPartyStatus();
  }

  challengeEnded() {}

  /** A slot: 1-27 health, 30 dead, 31 not in the room (ToB's scale; the HUD script reads it so). */
  statusOf(player) {
    const member = this.members.get(player);
    if (!member || member.moving || !this.room || member.roomKey !== this.room.key) return SLOT.AWAY;
    if (member.dead || player.getHitpoints() <= 0) return SLOT.DEAD;
    const { Skill } = Shared.core();
    const max = Math.max(1, player.getSkillManager().getMaxLevel(Skill.HITPOINTS));
    const current = Math.min(max, player.getHitpoints());
    return 1 + Math.round((SLOT.HEALTH_MAX - 1) * (current / max));
  }

  refreshStatuses() {
    const statuses = Array.from({ length: Shared.MAX_PARTY_SIZE }, (_, i) => {
      const player = this.roster[i];
      if (!player) return SLOT.EMPTY;
      const live = this.players.find((other) => other.getUsername() === player.getUsername());
      return live ? this.statusOf(live) : SLOT.AWAY;
    });
    const varbits = Shared.ids().varbit.SLOTS;
    for (const viewer of this.viewers()) {
      const member = this.viewState(viewer);
      if (!member?.hudOpen) continue;
      statuses.forEach((status, i) => {
        if (member.hud.get(i) === status) return;
        member.hud.set(i, status);
        viewer.getPacketSender().sendVarbit(varbits[i], status);
      });
    }
  }

  /** The lobby overlay's "Step Inside Now!" for members not in yet, while they still can. */
  refreshPartyStatus() {
    for (const player of this.party.members) {
      if (this.hasMember(player)) continue;
      player.getPacketSender().sendVarbit(Shared.id("varbit", "PARTY_STATUS"), this.canJoin() ? 2 : 1);
    }
  }

  /** A member who never came in left the party: their HUD slot goes. */
  dropFromRoster(player) {
    this.roster = this.roster.filter((other) => other.getUsername() !== player.getUsername());
    for (const other of this.players) if (this.member(other).hudOpen) this.openHud(other);
  }

  // ---------------------------------------------------------------- deaths

  /**
   * A death in the Archive. In a challenge that isn't won, the player watches from the corner
   * until it ends; otherwise they get up at the room's entrance.
   */
  onPlayerDied(player) {
    const member = this.member(player);
    const room = this.room;
    const deaths = (Number(player.getAttribute(ATTR_DEATHS)) || 0) + 1;
    player.setAttribute(ATTR_DEATHS, deaths);
    record(player, "overall", "deaths");
    if (room && member.roomKey === room.key) record(player, room.key, "deaths");
    player.sendMessage(`You have died. Total deaths: <col=ff0000>${deaths}</col>.`);
    for (const other of this.players) {
      if (other !== player) other.sendMessage(`<col=ff0000>${Shared.displayName(player)}</col> has died. Total deaths: <col=ff0000>${deaths}</col>.`);
    }
    if (!room || member.roomKey !== room.key || !room.isStarted() || !member.fighting) {
      player.moveTo(Shared.loc(room?.def.arrival ?? TILE.RAID_ARRIVAL));
      return;
    }
    member.dead = true;
    this.deathCount = (this.deathCount ?? 0) + 1;
    if (room.fighters().length > 0) player.sendMessage("You will respawn when your party completes or fails the challenge.");
    this.spectate(player, room);
    this.checkWipe();
  }

  /** At the room's corner, out of the fight, with the inventory and combat tabs closed. */
  spectate(player, room) {
    const member = this.member(player);
    member.spectating = -1;
    player.sendMessage("Spectating the room. Click a fighting player's health display to spectate them.");
    player.moveTo(room.worldLoc(room.def.spectate ?? TILE.SPECTATE));
    watchView(player, room);
    player.getMovementQueue().setBlockMovement(true).reset();
    player.setUntargetable(true);
    player.getCombat().reset();
    const sender = player.getPacketSender();
    sender.sendVarbit(Shared.id("varbit", "SPECTATE_MODE"), 1);
    sender.sendVarbit(Shared.id("varbit", "SPECTATE_SLOT"), 0);
    sender.closeSubInterface(Shared.id("component", "SIDE_INVENTORY"));
    sender.closeSubInterface(Shared.id("component", "SIDE_COMBAT"));
    Shared.api().emitCustomEvent("boss-hud:hide", { player, fade: false, afterTicks: 0 });
  }

  /** The HUD's "Spectate" on a slot (0-7), or the whole room (-1). */
  spectateSlot(player, slot) {
    const member = this.viewState(player);
    if (!member || (!member.dead && !member.watcher)) return;
    const sender = player.getPacketSender();
    const target = slot >= 0 ? this.players.find((other) => other.getUsername() === this.roster[slot]?.getUsername()) : null;
    if (!target || this.member(target).dead) {
      member.spectating = -1;
      watchView(player, this.room);
      sender.sendVarbit(Shared.id("varbit", "SPECTATE_SLOT"), 0);
      player.sendMessage("Spectating the room. Click a fighting player's health display to spectate them.");
      sender.closeSubInterface(Shared.id("component", "SIDE_INVENTORY"));
      return;
    }
    member.spectating = slot;
    watchView(player, this.room, target);
    sender.sendVarbit(Shared.id("varbit", "SPECTATE_SLOT"), slot + 1);
    player.sendMessage(`Spectating ${Shared.displayName(target)}. Click a fighting player's health display to spectate them.`);
    this.sendSpectatedInventory(player, target);
    const items = Shared.id("component", "SPECTATE_ITEMS");
    sender.sendSubInterface(Shared.id("component", "SIDE_INVENTORY"), Shared.id("iface", "SPECTATE_INVENTORY"), 1);
    // interface_invother_init: the spectated inventory (93, sent as another's), 4x7, "Ping".
    sender.sendClientScript(INVOTHER_INIT_SCRIPT, items, INVENTORY_INV, 4, 7, 0, -1, "Ping<col=ff9040>", "", "", "", "", 1);
    sender.sendInterfaceFlagsRange(items, 0, 27, (1 << 1) | (1 << 10));
  }

  /** The spectated player's inventory, as "another's" inventory (93 + 32768), as captured. */
  sendSpectatedInventory(viewer, target) {
    const items = target.getInventory().getItems();
    const slots = Array.from({ length: 28 }, (_, slot) => {
      const item = items[slot];
      return item && item.getId() > 0 && item.getAmount() > 0 ? { id: item.getId(), amount: item.getAmount() } : null;
    });
    viewer.getPacketSender().sendInventory(INVENTORY_INV + OTHER_INVENTORY, 28, slots);
  }

  /** Back on their feet at the room's entrance once the challenge is won. */
  respawn(player, room) {
    const member = this.member(player);
    member.dead = false;
    member.spectating = -1;
    restoreTabs(player);
    player.getMovementQueue().setBlockMovement(false);
    player.setUntargetable(false);
    player.getPacketSender().sendVarbit(Shared.id("varbit", "SPECTATE_MODE"), 0).sendVarbit(Shared.id("varbit", "SPECTATE_SLOT"), 0);
    player.moveTo(Shared.loc(room.def.arrival));
  }

  /** The raid fails once nobody in the challenge is standing. */
  checkWipe() {
    const room = this.room;
    if (this.over || !room?.isStarted()) return;
    if (room.fighters().length > 0) return;
    Shared.later(this, WIPE_DELAY, () => {
      if (!this.over && this.room === room && room.isStarted() && room.fighters().length === 0) this.fail();
    });
  }

  /** Everyone back in the lobby, their items lost as a death would take them (captured). */
  fail() {
    if (this.over) return;
    this.room?.fail();
    const players = [...this.players];
    for (const player of players) {
      Shared.api().emitCustomEvent("boss-hud:hide", { player, fade: false, afterTicks: 0 });
      player.sendMessage("You failed to survive the Fractured Archive.");
      Shared.fade(player, true);
      player.getPacketSender().sendSong(MUSIC.IN_RAID).sendJingle(MUSIC.FAILED_JINGLE, 0);
    }
    Shared.later(this, WIPE_MOVE_DELAY, () => {
      for (const player of players) {
        if (!this.players.includes(player)) continue;
        const fought = this.member(player).fighting;
        record(player, "overall", "wipes");
        record(player, "overall", "failures");
        this.remove(player);
        this.leaveArea(player);
        player.moveTo(Shared.loc(TILE.WIPE_RETURN));
        if (fought) Shared.core().PlayerDeathTask.loseItemsAsDeath(player, Shared.loc(TILE.WIPE_RETURN));
        Shared.fade(player, false);
      }
      this.dispose();
    });
  }

  // ---------------------------------------------------------------- leaving

  /** "Yes, abandon the raid.": out to the lobby; there's no coming back to this run. */
  abandon(player) {
    if (!this.players.includes(player)) return;
    player.sendMessage("You abandon the raid and leave the Fractured Archive.");
    record(player, "overall", "failures");
    Shared.fade(player, true);
    player.getMovementQueue().reset().setBlockMovement(true);
    Shared.later(player, LEAVE_MOVE_DELAY, () => {
      player.getMovementQueue().setBlockMovement(false);
      if (!this.players.includes(player)) return;
      this.remove(player);
      this.leaveArea(player);
      player.moveTo(Shared.loc(TILE.LEAVE));
      Shared.fade(player, false);
      player.getPacketSender().sendSong(MUSIC.INTO_THE_ARCHIVE);
    });
  }

  /** Out through the vault's Rift once the raid is won: back to the lobby, as abandoning moves you. */
  leaveFinished(player) {
    if (!this.players.includes(player)) return;
    Shared.fade(player, true);
    player.getMovementQueue().reset().setBlockMovement(true);
    Shared.later(player, LEAVE_MOVE_DELAY, () => {
      player.getMovementQueue().setBlockMovement(false);
      if (!this.players.includes(player)) return;
      this.remove(player);
      this.leaveArea(player);
      player.moveTo(Shared.loc(TILE.LEAVE));
      Shared.fade(player, false);
      player.getPacketSender().sendSong(MUSIC.INTO_THE_ARCHIVE);
    });
  }

  /** Takes a player out of the raid and their party. */
  remove(player) {
    const member = this.members.get(player);
    if (member?.dead) {
      player.getMovementQueue().setBlockMovement(false);
      player.setUntargetable(false);
      restoreTabs(player);
    }
    this.players = this.players.filter((other) => other !== player);
    this.members.delete(player);
    player.setAttribute(ATTR_RAID, null);
    player.setAttribute(ATTR_LOGOUT, null);
    this.closeHud(player);
    Shared.api().emitCustomEvent("fractured-archive:left", { player, raid: this });
    player.getPacketSender().sendConfig(Shared.id("varp", "CONTROLLER"), -1);
    Shared.api().emitCustomEvent("boss-hud:hide", { player, fade: false, afterTicks: 0 });
    this.party.remove(player);
    // Nobody left inside: the raid ends; anyone logged out finds no party when they return.
    if (this.players.length === 0) this.dispose();
    else this.checkWipe();
  }

  onAreaLeave(player, logout) {
    if (logout && this.watchers.delete(player)) {
      this.sendWatcherCount();
      return;
    }
    if (!this.players.includes(player)) return;
    if (logout) this.onLogout(player);
  }

  /** A logout in a challenge counts as a death (estimate, as the Theatre of Blood); else it's safe. */
  onLogout(player) {
    // Before the save that follows: the room settles what the player is owed (the vault's loot).
    this.room?.onPlayerLogout?.(player);
    const member = this.member(player);
    const fight = !!this.room?.isStarted() && member.fighting && !member.dead;
    this.away.set(player.getUsername(), { fight: fight || member.dead });
    player.setAttribute(ATTR_LOGOUT, { raid: this.id, fight: fight || member.dead });
    this.players = this.players.filter((other) => other !== player);
    this.members.delete(player);
    player.setAttribute(ATTR_RAID, null);
    if (this.players.length === 0) {
      this.dispose();
      return;
    }
    this.checkWipe();
  }

  /** Back from a logout: into the party's room, watching if they fell. */
  rejoin(player) {
    const away = this.away.get(player.getUsername());
    if (!away || this.over) return false;
    this.away.delete(player.getUsername());
    player.setAttribute(ATTR_LOGOUT, null);
    this.add(player);
    this.party.members = this.party.members.map((other) => (other.getUsername() === player.getUsername() ? player : other));
    this.roster = this.roster.map((other) => (other.getUsername() === player.getUsername() ? player : other));
    const room = this.room;
    const member = this.member(player);
    member.roomKey = room.key;
    this.placeIn(player, room, room.def.arrival);
    if (away.fight && room?.isStarted()) {
      member.fighting = true;
      member.dead = true;
      this.spectate(player, room);
    }
    this.openHud(player);
    return true;
  }

  dispose() {
    if (this.over) return;
    for (const player of [...this.watchers.keys()]) this.removeWatcher(player);
    this.over = true;
    Shared.cancel(this);
    this.room?.destroy();
    this.room = null;
    if (!this.area.isDestroyed()) this.area.destroy();
    raids.delete(this.id);
    this.party.raid = null;
    this.party.dispose();
  }
}

/** Counts something in the player's Alliance records (Records.*). */
function record(player, category, field) {
  Shared.api().emitCustomEvent("fractured-archive:record", { player, category, field });
}

/** The inventory (93) and the flag the client reads an inventory as someone else's with. */
const INVENTORY_INV = 93;
const OTHER_INVENTORY = 32768;
/** interface_invother_init. */
const INVOTHER_INIT_SCRIPT = 158;

/** The inventory and combat tabs back after spectating. */
function restoreTabs(player) {
  endWatchView(player);
  const sender = player.getPacketSender();
  sender.sendSubInterface(Shared.id("component", "SIDE_INVENTORY"), Shared.id("iface", "INVENTORY"), 1);
  sender.sendTabInterface(0, Shared.id("iface", "COMBAT"));
  Shared.core().WeaponInterfaceManager.assign(player);
  player.getInventory().refreshItems();
}

/** How far a spectator sees players and NPCs: the room, from its parking spot in the room's map square. */
const WATCH_VIEW_DISTANCE = 64;

/**
 * A spectator's view, the dead's and outside watchers' (captured cam_target): the camera on the
 * room's middle, or on the fighter they follow, with the room's players and NPCs in sight.
 */
function watchView(player, room, target = null) {
  player.setFixedViewDistance?.(WATCH_VIEW_DISTANCE);
  player.setNpcViewDistance?.(WATCH_VIEW_DISTANCE);
  const sender = player.getPacketSender();
  if (target) sender.sendCameraTarget({ player: target.getIndex() });
  else if (room?.def.camera) sender.sendCameraTarget({ x: room.def.camera.x, y: room.def.camera.y, level: room.def.camera.z ?? 0 });
}

/** Back to their own view (captured cam_reset). */
function endWatchView(player) {
  player.setFixedViewDistance?.(null);
  player.setNpcViewDistance?.(null);
  player.getPacketSender().sendCameraReset();
}

/** The dead watch from the south-west corner of their room's map square (captured: local tile 1,1). */
function corner(mx, my, z = 0) {
  return { x: mx * 64 + 1, y: my * 64 + 1, z };
}

/**
 * The rooms, from the captures: where the party arrives, the corner the dead watch from, the
 * tile a spectator's camera looks at (cam_target), the room's music, the Nexus section its boss belongs to, and where the Alliance Navigator appears
 * once it falls. Bosses whose arrival isn't captured carry an estimate.
 */
const ROOMS = {
  GUARDIAN: {
    key: "GUARDIAN", name: "Archive Guardian", announce: true,
    music: MUSIC.ARCHIVE_GUARDIAN,
    arrival: TILE.RAID_ARRIVAL,
    spectate: TILE.SPECTATE,
    camera: { x: 4127, y: 5599, z: 0 },
  },
  HUB: {
    key: "HUB", name: "The Nexus",
    arrival: { x: 4127, y: 5590, z: 2 },
    spectate: corner(64, 87, 2),
    camera: { x: 4127, y: 5599, z: 2 },
  },
  BORK: {
    key: "BORK", name: "Bork", section: 1,
    music: 888,
    arrival: { x: 4173, y: 5599, z: 0 },
    /** The Archive transporter's landing tile in the arena (captured: where fighters first stand). */
    transporter: { x: 4184, y: 5599, z: 0 },
    spectate: corner(65, 87),
    camera: { x: 4191, y: 5599, z: 0 },
    navigator: { x: 4184, y: 5599, z: 0 },
  },
  EZEKIEL: {
    key: "EZEKIEL", name: "Ezekiel", section: 1,
    music: 890,
    arrival: { x: 4079, y: 5536, z: 0 },
    /** The Archive transporter's landing tile in the arena (captured: where fighters first stand). */
    transporter: { x: 4067, y: 5535, z: 0 },
    spectate: corner(63, 86),
    // Estimate: as Bork's, Dreadnoth's and Xarth's (their square + 31,31); not captured.
    camera: { x: 4063, y: 5535, z: 0 },
    navigator: { x: 4067, y: 5535, z: 0 },
  },
  DREADNOTH: {
    key: "DREADNOTH", name: "Dreadnoth the Jellied", section: 2,
    music: 895,
    arrival: { x: 4174, y: 5664, z: 0 },
    /** The Archive transporter's landing tile in the arena (captured: where fighters first stand). */
    transporter: { x: 4184, y: 5663, z: 0 },
    spectate: corner(65, 88),
    camera: { x: 4191, y: 5663, z: 0 },
    navigator: { x: 4184, y: 5663, z: 0 },
  },
  XARTH: {
    key: "XARTH", name: "Xarth", section: 3,
    music: 896,
    arrival: { x: 4175, y: 5535, z: 0 },
    /** The Archive transporter's landing tile in the arena (captured: where fighters first stand). */
    transporter: { x: 4184, y: 5535, z: 0 },
    spectate: corner(65, 86),
    camera: { x: 4191, y: 5535, z: 0 },
    navigator: { x: 4184, y: 5535, z: 0 },
  },
  OCELLUS: {
    key: "OCELLUS", name: "Ocellus",
    music: 893,
    /** Estimate: the spectator only saw the room; this is south of its entrance. */
    arrival: { x: 4127, y: 5656, z: 1 },
    spectate: corner(64, 88, 1),
    camera: { x: 4127, y: 5673, z: 1 },
  },
  VAULT: {
    key: "VAULT", name: "The Vault",
    arrival: { x: 4127, y: 5779, z: 2 },
    spectate: corner(64, 90, 2),
    camera: { x: 4127, y: 5798, z: 2 },
  },
};

/** The leader opens the Archive for the party. */
function begin(leader) {
  const party = Parties.partyOf(leader);
  if (!party) return null;
  if (party.raid) return party.raid;
  const raid = new Raid(party, leader);
  raid.refreshPartyStatus();
  return raid;
}

/** The raid a player watches from outside, if any. */
function watchedBy(player) {
  for (const raid of raids.values()) if (raid.watchers.has(player)) return raid;
  return null;
}

function byId(raidId) {
  return raids.get(raidId) ?? null;
}

const styleMethods = new Map();

/**
 * A bare combat method of one style, for scripted attacks that build their own hits: it only
 * tells the hit its style (protection prayers, hitsplats).
 */
function styleMethod(style) {
  let method = styleMethods.get(style);
  if (!method) {
    const { CombatMethod, CombatType } = Shared.core();
    const type = { melee: CombatType.MELEE, ranged: CombatType.RANGED, magic: CombatType.MAGIC }[style];
    method = new (class extends CombatMethod {
      type() {
        return type;
      }

      hits() {
        return [];
      }
    })();
    styleMethods.set(style, method);
  }
  return method;
}

module.exports = {
  formatTime, STAGE, ATTR_RAID, ATTR_LOGOUT, ATTR_DEATHS, ROOMS, Room, Raid, registerRoom, raidOf, begin, byId, watchedBy, raids, styleMethod,
};
