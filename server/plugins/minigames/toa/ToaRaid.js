"use strict";

/**
 * A raid in progress: the party, its private copy of the tombs, the room the party is in,
 * team deaths, the HUD and points. Rooms are classes registered by the room units; the raid
 * builds one when the party enters it and tears it down when the party moves on.
 */

const Shared = require("./ToaShared");
const Parties = require("./ToaParties");

const { ROOMS, VARBIT, SCRIPT, INTERFACE } = Shared;

const ATTR_RAID = "toa:raid";

/** Room key -> Room subclass, filled in by the room units. */
const roomTypes = new Map();
const raids = new Set();
let AreaClass = null;

const STAGE = { IDLE: "idle", STARTED: "started", COMPLETED: "completed" };

/** Item ids that only exist inside the tombs and are taken away on leaving; units add theirs. */
const raidItems = new Set();

function registerRaidItems(...ids) {
  for (const id of ids.flat()) {
    if (Number.isInteger(id) && id > 0) raidItems.add(id);
  }
}

// Raid-scoped rules and per-tick work from the unit files. The raid's area runs them, so
// nobody outside a raid pays for them. canAttack/canTeleport handlers take the old hook event
// ({ attacker, target, allow } / { player, allow }) and the first to set `allow` decides.
const areaHandlers = { canAttack: [], canTeleport: [], process: [], leave: [] };

function onRaidArea(kind, handler) {
  areaHandlers[kind].push(handler);
}

function firstVerdict(handlers, event) {
  for (const handler of handlers) {
    handler(event);
    if (event.allow !== null) return event.allow;
  }
  return null;
}

function registerRoom(key, RoomClass) {
  roomTypes.set(key, RoomClass);
}

function raidOf(player) {
  const raid = player?.getAttribute?.(ATTR_RAID);
  return raid && raids.has(raid) ? raid : null;
}

function roomOf(player) {
  const raid = raidOf(player);
  return raid ? raid.roomFor(player) : null;
}

function areaClass() {
  if (AreaClass) return AreaClass;
  const { PrivateArea, Boundary } = Shared.core();
  const { TOMBS_REGION, TOMBS_PLANES } = Shared;
  AreaClass = class TombsOfAmascutArea extends PrivateArea {
    constructor(raid) {
      super(TOMBS_PLANES.map((z) =>
        new Boundary(TOMBS_REGION.minX, TOMBS_REGION.maxX, TOMBS_REGION.minY, TOMBS_REGION.maxY, z)));
      this.raid = raid;
    }

    getName() {
      return "Tombs of Amascut";
    }

    allowSummonPet() {
      return false;
    }

    postEnter(mobile) {
      super.postEnter(mobile);
      if (mobile.isPlayer?.()) this.raid.onAreaEnter(mobile.getAsPlayer());
    }

    postLeave(mobile, logout) {
      if (mobile.isPlayer?.()) {
        const player = mobile.getAsPlayer();
        this.raid.onAreaLeave(player, logout);
        for (const handler of areaHandlers.leave) handler({ player, logout });
      }
      super.postLeave(mobile, logout);
    }

    process(mobile) {
      this.raid.processOnce();
      if (mobile.isPlayer?.()) {
        const player = mobile.getAsPlayer();
        this.raid.processPlayer(player);
        for (const handler of areaHandlers.process) handler({ player });
      }
    }

    canAttack(attacker, target, method) {
      return firstVerdict(areaHandlers.canAttack, { attacker, target, method, allow: null });
    }

    canTeleport(player, wildernessLevelLimit, destination) {
      return firstVerdict(areaHandlers.canTeleport, { player, wildernessLevelLimit, destination, allow: null });
    }
  };
  return AreaClass;
}

class Member {
  constructor() {
    this.roomKey = null;
    this.deaths = 0;
    // Wiki: everyone starts on 5,000 reward points, taken off again for the loot.
    this.points = START_POINTS;
    /** Points earned in the current room, added to `points` when it's completed. */
    this.roomPoints = 0;
    this.damageDone = 0;
    this.damageTaken = 0;
    this.ghost = false;
    this.canClaimSupplies = false;
    this.supplies = [];
    this.hud = new Map();
  }
}

/** Shared room behaviour: stage, the challenge floor, barriers, teleport crystals, cleanup. */
class Room {
  constructor(raid, def) {
    this.raid = raid;
    this.def = def;
    this.stage = STAGE.IDLE;
    this.npcs = new Set();
    this.objects = new Map();
    this.taskKey = {};
    this.startCycle = 0;
    this.teamSize = raid.original.size;
    this.failed = false;
    this.destroyed = false;
  }

  get area() {
    return this.raid.area;
  }

  get settings() {
    return this.raid.settings;
  }

  get key() {
    return this.def.key;
  }

  isStarted() {
    return this.stage === STAGE.STARTED;
  }

  isCompleted() {
    return this.stage === STAGE.COMPLETED;
  }

  /** Called once after construction: spawn the room's NPCs and objects. */
  build() {}

  onStart() {}

  onComplete() {}

  onReset() {}

  /** Called every tick while anyone is in the raid. */
  tick() {}

  /** Called every tick per player in this room. */
  tickPlayer(_player) {}

  /** Called when a player steps from one tile onto `to` while in this room. */
  onStep(_player, _from, _to) {}

  /** Shows the boss health bar (the BossHud plugin) to everyone in the room. */
  openBossHud(npc) {
    this.closeBossHud();
    this.hudNpc = npc;
    this.hudPlayers = new Set();
    this.updateBossHud();
  }

  hudValues(player) {
    const npc = this.hudNpc;
    return { player, npcId: npc.getId(), current: Math.max(0, npc.getHitpoints()), maximum: npc.getMaxHitpoints() };
  }

  closeBossHud() {
    if (!this.hudNpc) return;
    this.hudNpc = null;
    for (const player of this.hudPlayers) Shared.api().emitCustomEvent("boss-hud:hide", { player });
    this.hudPlayers.clear();
  }

  /** Keeps the health bar in step with the boss (BossHud sends only what changed), shown to anyone who came in since. */
  updateBossHud() {
    if (!this.hudNpc) return;
    for (const player of this.roomPlayers()) {
      const shown = this.hudPlayers.has(player);
      if (!shown) this.hudPlayers.add(player);
      Shared.api().emitCustomEvent(shown ? "boss-hud:update" : "boss-hud:show", this.hudValues(player));
    }
  }

  /** Points per damage on an NPC in this room. */
  pointsPerDamage(npc) {
    return npc.__toaPoints ?? 1;
  }

  /** Players in the party who are standing in this room's challenge area and alive. */
  challengePlayers(filter = () => true) {
    return this.raid.players.filter((player) =>
      this.raid.roomFor(player) === this && player.getHitpoints() > 0 && !this.raid.member(player).ghost
      && this.inChallenge(player) && filter(player));
  }

  /** Every party member currently in this room. */
  roomPlayers() {
    return this.raid.players.filter((player) => this.raid.roomFor(player) === this);
  }

  inChallenge(entity) {
    const bounds = this.def.bounds;
    if (!bounds) return false;
    const location = entity.getLocation();
    if (!Shared.inBox(location, bounds)) return false;
    return !(this.def.excluded ?? []).some((box) => Shared.inBox(location, { ...box, z: bounds.z }));
  }

  later(ticks, action) {
    return Shared.later(this.taskKey, ticks, () => {
      if (!this.destroyed) action();
    });
  }

  repeat(ticks, action) {
    return Shared.repeat(this.taskKey, ticks, () => !this.destroyed && action() !== false);
  }

  cancelTasks() {
    Shared.core().TaskManager.cancelTasks(this.taskKey);
    this.taskKey = {};
  }

  /**
   * Spawns an NPC into the raid, scaled for raid level, party size and (for path bosses) the
   * path level. `points` is the points-per-damage multiplier. `inert` is for things players
   * strike that never fight back (eggs, jugs, siphons, seals, obelisks): they don't retaliate,
   * so they don't turn to face whoever hits them.
   */
  spawn(id, tile, options = {}) {
    const raid = this.raid;
    const npc = Shared.api().spawnNpc({
      id,
      x: tile.x,
      y: tile.y,
      z: tile.z ?? this.def.spawn.z ?? 0,
      face: options.face,
      wanderRadius: 0,
    });
    if (!npc) return null;
    npc.__skipDefaultRespawn = true;
    npc.__toaRoom = this;
    npc.__toaPoints = options.points ?? 1;
    if (options.inert) npc.setFlag("combat:no-retaliate");
    raid.area.add(npc);
    this.npcs.add(npc);
    if (options.scale !== false) raid.scale(npc, options.pathLevel ?? this.pathLevel());
    return npc;
  }

  despawn(npc) {
    if (!npc) return;
    this.npcs.delete(npc);
    this.raid.area.detach(npc);
    Shared.api().removeNpc(npc);
  }

  pathLevel() {
    const path = Shared.PATH_BY_KEY[this.def.path];
    return path ? this.raid.pathLevels[path.index] : 0;
  }

  damageFactor() {
    return this.raid.damageFactor(this.pathLevel());
  }

  maxHit(base) {
    return Math.floor(base * this.damageFactor());
  }

  /**
   * A boss attack in one style: accuracy rolls as normal and damage is capped at `maxHit`
   * (scaled for raid and path level). The matching protection prayer lets through
   * `prayerMultiplier` of it (none by default), plus 10% under Quiet Prayers;
   * `prayable: false` ignores prayer altogether.
   */
  styledHit(npc, target, method, style, baseMaxHit, delay, { prayable = true, scale = true, prayerMultiplier = 0 } = {}) {
    const { PendingHit, CombatFactory } = Shared.core();
    const hit = new PendingHit(npc, target, method, delay);
    CombatFactory.applyStyleDamage(hit, scale ? this.maxHit(baseMaxHit) : baseMaxHit, { bypassProtectionPrayer: true });
    if (prayable && target.isPlayer?.() && Shared.isProtected(target, style)) {
      const through = Math.min(1, prayerMultiplier + (this.settings.isActive("QUIET_PRAYERS") ? 0.1 : 0));
      for (const part of hit.getHits()) part.setDamage(Math.floor(part.getDamage() * through));
      hit.updateTotalDamage();
    }
    return hit;
  }

  /** Queues a styled hit on any player, for attacks that hit more than the NPC's target. */
  strike(npc, player, method, style, baseMaxHit, delay, options) {
    const hit = this.styledHit(npc, player, method ?? styleMethod(style), style, baseMaxHit, delay, options);
    player.getCombat().getHitQueue().addPendingHit(hit, Shared.cycle() + Math.max(0, delay));
    return hit;
  }

  /** Unblockable damage on a player, scaled for raid and path level (rockfalls, bombs). */
  hurt(player, baseDamage, { scale = true } = {}) {
    Shared.damage(player, scale ? this.maxHit(baseDamage) : baseDamage);
  }

  objectKey(location, type) {
    return `${location.getX()},${location.getY()},${location.getZ()},${type}`;
  }

  /** The object currently at a tile for this party: our replacement, or the map's own. */
  objectAt(tile, type) {
    const { MapObjects } = Shared.core();
    const location = Shared.loc(tile, tile.z ?? this.def.spawn.z);
    return this.objects.get(this.objectKey(location, type))?.current
      ?? MapObjects.getType(location, type, null);
  }

  /** Places (or with id -1 clears) an object of a shape at a tile, for this party only. */
  setObject(id, tile, type = 10, face = 0) {
    const { GameObject, ObjectManager, MapObjects } = Shared.core();
    const location = Shared.loc(tile, tile.z ?? this.def.spawn.z);
    const key = this.objectKey(location, type);
    let entry = this.objects.get(key);
    if (!entry) {
      const base = MapObjects.getType(location, type, null);
      entry = { base: base ? { id: base.getId(), face: base.getFace() } : null, current: null };
      this.objects.set(key, entry);
    }
    if (entry.current) {
      ObjectManager.deregister(entry.current, id === -1 && !entry.base);
      this.area.detach(entry.current);
      entry.current = null;
    }
    if (id === -1) {
      if (entry.base) {
        const hidden = new GameObject(entry.base.id, location, type, entry.base.face, this.area);
        ObjectManager.deregister(hidden, true);
        this.area.detach(hidden);
      }
      return null;
    }
    const object = new GameObject(id, location, type, face, this.area);
    ObjectManager.register(object, true);
    entry.current = object;
    return object;
  }

  /** Swaps a map object for another id of the same shape, keeping its rotation. */
  replaceObject(tile, type, idChange) {
    const current = this.objectAt(tile, type);
    if (!current) return null;
    const id = typeof idChange === "function" ? idChange(current.getId()) : current.getId() + idChange;
    return this.setObject(id, tile, type, current.getFace());
  }

  resetObjects() {
    for (const [key, entry] of this.objects) {
      const [x, y, z, type] = key.split(",").map(Number);
      if (entry.base) this.setObject(entry.base.id, { x, y, z }, type, entry.base.face);
      else this.setObject(-1, { x, y, z }, type);
    }
  }

  destroy() {
    if (this.destroyed) return;
    this.closeBossHud();
    this.cancelTasks();
    for (const npc of [...this.npcs]) this.despawn(npc);
    this.resetObjects();
    this.objects.clear();
    this.destroyed = true;
  }

  // ---------------------------------------------------------------- stage

  start() {
    this.stage = STAGE.STARTED;
    this.startCycle = Shared.cycle();
    this.teamSize = this.raid.original.size;
    this.onStart();
  }

  /** NR/OSRS: completing a room revives the dead, resets the camera and reports the times. */
  complete() {
    if (this.isCompleted()) return;
    this.stage = STAGE.COMPLETED;
    const raid = this.raid;
    const duration = Shared.cycle() - this.startCycle;
    raid.results.push({ key: this.key, ticks: duration });
    const total = raid.results.reduce((sum, result) => sum + result.ticks, 0);
    const name = this.challengeName();
    const isEnd = this.key === "WARDENS_P3";
    if (isEnd) raid.setCompletion();
    raid.completeRoomPoints(this);
    if (isEnd) raid.sendContributions();
    for (const player of this.roomPlayers()) {
      raid.revive(player);
      if (this.def.puzzle) Shared.jingle(player, Shared.JINGLE.PUZZLE_DONE);
      if (!this.inChallenge(player) && this.def.challenge) player.moveTo(Shared.loc(this.def.challenge));
      if (!isEnd) {
        player.sendMessage(`Challenge complete: ${name}. Duration: <col=ef1020>${Shared.formatTicks(duration)}</col>. Total: <col=ef1020>${Shared.formatTicks(total)}</col>`);
      } else {
        raid.sendCompletionMessages(player, name, duration, total);
      }
    }
    this.cancelTasks();
    this.closeBossHud();
    this.onComplete();
    if (this.def.osmumten) this.spawnOsmumten();
    this.dropBossLoot();
    if (this.def.boss && this.def.path) raid.completePath(this.def.path);
  }

  reset() {
    this.stage = STAGE.IDLE;
    this.cancelTasks();
    this.closeBossHud();
    const diet = this.settings.isActive("ON_A_DIET");
    for (const player of this.roomPlayers()) {
      if (!diet && !this.failed) this.raid.give(player, Shared.core().ItemIdentifiers.HONEY_LOCUST, Shared.random(4, 6));
    }
    this.onReset();
  }

  challengeName() {
    if (this.def.puzzle) return `Path of ${Shared.PATH_BY_KEY[this.def.path].name}`;
    return this.def.boss ?? this.def.name;
  }

  /** The boss NPC whose damage decides who gets its trophy; boss rooms override this. */
  lootSource() {
    return null;
  }

  /**
   * Wiki: each boss drops its capture book for everyone who doesn't have one (in their bank,
   * inventory or as read), and the path bosses a trophy for whoever dealt them the most damage.
   * They land beside Osmumten (or BOSS_DROPS' tile), visible only to their owner.
   */
  dropBossLoot() {
    const drops = BOSS_DROPS[this.key];
    if (!drops) return;
    const { ItemOnGroundManager, Item } = Shared.core();
    const tile = this.dropTile(drops.tile);
    if (!tile) return;
    const players = this.roomPlayers();
    const drop = (player, id) => ItemOnGroundManager.registerLocation(player, new Item(id, 1), tile, this.raid.area);
    for (const player of players) {
      if (!ownsBook(player, drops.book, drops.bookVarbit)) drop(player, drops.book);
    }
    const damage = this.lootSource()?.__toaDamageBy;
    if (!drops.trophy || !damage) return;
    let hero = null;
    for (const [player, dealt] of damage) {
      if (players.includes(player) && (!hero || dealt > damage.get(hero))) hero = player;
    }
    if (hero) drop(hero, drops.trophy);
  }

  /** The first walkable tile beside Osmumten, or the room's own drop tile. */
  dropTile(fixed) {
    if (fixed) return Shared.loc(fixed);
    const centre = this.def.osmumten;
    if (!centre) return null;
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      const tile = Shared.loc({ x: centre.x + dx, y: centre.y + dy, z: centre.z });
      if (Shared.floorFree(this.area, tile)) return tile;
    }
    return Shared.loc(centre);
  }

  spawnOsmumten() {
    const { NpcIdentifiers } = Shared.core();
    for (const player of this.roomPlayers()) Shared.jingle(player, Shared.JINGLE.OSMUMTEN);
    const npc = this.spawn(NpcIdentifiers.OSMUMTEN, this.def.osmumten, { scale: false });
    npc?.performAnimation(new (Shared.core().Animation)(OSMUMTEN_SPAWN_ANIMATION));
    npc?.getMovementQueue().setBlockMovement(true);
  }

  // ---------------------------------------------------------------- barriers

  /** The barrier into a room's challenge floor: begins the challenge and lets players through. */
  passBarrier(player, object, quick) {
    if (this.raid.member(player).ghost) {
      Shared.statement(player, "A mysterious force prevents you from doing that.");
      return;
    }
    if (this.isCompleted()) {
      walkThrough(player, object);
      return;
    }
    const inside = this.inChallenge(player);
    if (inside && this.isStarted()) {
      Shared.statement(player, "You can't leave until the challenge is over.");
      return;
    }
    if (inside) {
      walkThrough(player, object);
      return;
    }
    const enter = () => {
      if (this.stage === STAGE.IDLE) {
        this.start();
        for (const member of this.raid.players) member.sendMessage(`Challenge started: ${this.challengeName()}`);
      }
      walkThrough(player, object);
    };
    if (this.isStarted()) {
      enter();
    } else if (this.raid.hasStragglers()) {
      this.raid.abandonPrompt(player, "Begin the challenge", enter);
    } else if (!quick) {
      Shared.confirm(player, "Begin the challenge?", enter);
    } else {
      enter();
    }
  }

  /** The boss rooms' teleport crystal: straight onto the arena floor, starting the fight. */
  useTeleportCrystal(player, quick) {
    if (this.raid.member(player).ghost) {
      Shared.statement(player, "A mysterious force prevents you from doing that.");
      return;
    }
    const enter = () => {
      if (!this.def.wardens && this.stage === STAGE.IDLE) {
        this.start();
        for (const member of this.raid.players) member.sendMessage(`Challenge started: ${this.challengeName()}`);
      }
      Shared.sound(player, Shared.SOUND.TELEPORT);
      player.performGraphic(new (Shared.core().Graphic)(Shared.GRAPHIC.TELEPORT));
      player.moveTo(Shared.loc(this.def.challenge));
      player.setRunEnergy(100);
      player.getPacketSender().sendRunEnergy?.();
    };
    if (!this.def.wardens && this.stage === STAGE.IDLE) {
      if (this.raid.hasStragglers()) this.raid.abandonPrompt(player, "Begin the challenge", enter);
      else if (!quick) Shared.confirm(player, "Begin the challenge?", enter);
      else enter();
    } else {
      enter();
    }
  }
}

const OSMUMTEN_SPAWN_ANIMATION = 9795;


/** Crosses a barrier two tiles to the far side. */
function walkThrough(player, object) {
  const location = player.getLocation();
  const objectX = object.getLocation ? object.getLocation().getX() : object.x;
  const dx = objectX < location.getX() ? -2 : 2;
  player.getMovementQueue().reset();
  player.moveTo(location.transform(dx, 0));
}

class Raid {
  constructor(lobby, leader) {
    this.lobby = lobby;
    this.settings = lobby.settings.copy();
    this.leader = leader;
    this.players = [];
    this.original = new Set();
    this.members = new Map();
    this.area = new (areaClass())(this);
    this.rooms = new Map();
    this.roomKey = null;
    this.pathLevels = [0, 0, 0, 0];
    this.pathsCompleted = [];
    this.pathKey = null;
    this.startCycle = 0;
    this.totalTicks = -1;
    this.results = [];
    this.teamDeaths = 0;
    this.totalDeaths = 0;
    this.permittedTeamDeaths = this.settings.permittedTeamDeaths();
    this.timeLimitMinutes = this.settings.timeLimitMinutes();
    this.failedTime = false;
    this.completedRaidLevel = -1;
    this.lastCycle = -1;
    this.over = false;
    lobby.raid = this;
    lobby.unlist();
    for (const player of lobby.players) this.add(player);
    this.original = new Set(this.players.map((player) => player.getUsername()));
    for (const player of this.players) recordStat(player, "attempts", this.settings.mode);
    raids.add(this);
  }

  get raidLevel() {
    return this.completedRaidLevel >= 0 ? this.completedRaidLevel : this.settings.raidLevel;
  }

  member(player) {
    let member = this.members.get(player);
    if (!member) {
      member = new Member();
      this.members.set(player, member);
    }
    return member;
  }

  isLeader(player) {
    return this.leader === player;
  }

  roomFor(player) {
    const key = this.member(player).roomKey;
    return key ? this.rooms.get(key) ?? null : null;
  }

  get room() {
    return this.roomKey ? this.rooms.get(this.roomKey) ?? null : null;
  }

  add(player) {
    if (this.players.includes(player)) return;
    player.setAttribute(ATTR_RAID, this);
    this.players.push(player);
    this.member(player);
    this.refreshHudNames();
  }

  // ---------------------------------------------------------------- scaling

  /** Wiki: +0.4% hitpoints per raid level, +90% per extra player up to three, +60% after. */
  hitpointFactor(pathLevel) {
    const size = Math.max(1, this.original.size);
    const party = 1 + 0.9 * (Math.min(size, 3) - 1) + 0.6 * Math.max(0, size - 3);
    return (1 + 0.004 * this.settings.raidLevel) * party * pathFactor(pathLevel);
  }

  damageFactor(pathLevel) {
    return Math.min(2.5, 1 + 0.004 * this.settings.raidLevel + (pathFactor(pathLevel) - 1));
  }

  scale(npc, pathLevel) {
    const base = npc.getDefinition()?.getHitpoints?.() ?? npc.getHitpoints();
    let hitpoints = base * this.hitpointFactor(pathLevel);
    // The Wiki DPS calculator's rounding: to 10 above 300, to 5 above 100, none below.
    if (hitpoints > 300) hitpoints = Math.round(hitpoints / 10) * 10;
    else if (hitpoints > 100) hitpoints = Math.round(hitpoints / 5) * 5;
    else hitpoints = Math.round(hitpoints);
    hitpoints = Math.max(1, hitpoints);
    npc.setMaxHitpoints(hitpoints);
    npc.setHitpoints(hitpoints);
    // Wiki: accuracy and the defence roll also rise 2% per 5 raid levels (base x (1 + level / 250)).
    npc.setRollFactor(1 + this.settings.raidLevel / 250);
  }

  // ---------------------------------------------------------------- rooms

  /**
   * Moves a player into a room, building it first if the party isn't there yet. The leader
   * decides where the party goes; others may only follow (NR TOAManager.enter).
   */
  enterRoom(player, key, { leaderOnly = true, destination = null } = {}) {
    const def = ROOMS[key];
    const current = this.rooms.get(key);
    if (this.roomKey !== key || !current || current.destroyed) {
      if (leaderOnly && !this.isLeader(player)) {
        Shared.statement(player, `Your leader, ${Shared.displayName(this.leader)}, must enter first.`);
        return false;
      }
      this.buildRoom(key);
    }
    const member = this.member(player);
    if (member.roomKey === null) {
      player.sendMessage(`You enter the Tombs of Amascut (${this.settings.mode} Mode)...`);
      if (this.timeLimitMinutes !== -1) {
        player.sendMessage(`Overall time to beat: <col=ef1020>${this.timeLimitMinutes}:00</col>. The timer starts upon choosing your first path.`);
      }
    }
    if (this.startCycle === 0 && key !== "MAIN_HALL") {
      this.startCycle = Shared.cycle();
      if (this.timeLimitMinutes !== -1) {
        this.broadcast(`Overall time to beat: <col=ef1020>${this.timeLimitMinutes}:00</col>. The timer has started!`);
      }
    }
    member.roomKey = key;
    const target = destination ?? Shared.spread(def.spawn, def.spread);
    Shared.fadeMove(player, () => {
      if (player.getArea?.() !== this.area) this.area.enter(player);
      player.moveTo(target);
      this.rooms.get(key)?.onPlayerArrive?.(player);
      this.sendHud(player);
    });
    this.refreshHudStates();
    return true;
  }

  buildRoom(key) {
    const previous = this.room;
    const RoomClass = roomTypes.get(key) ?? Room;
    const room = new RoomClass(this, ROOMS[key]);
    this.rooms.get(key)?.destroy();
    this.rooms.set(key, room);
    this.roomKey = key;
    if (previous && previous !== room) {
      previous.destroy();
      // Rebuilding the same room keeps its new entry.
      if (previous.key !== key) this.rooms.delete(previous.key);
    }
    room.build();
    return room;
  }

  /** Entry from a puzzle room to its boss (and Wardens P1 to P3). */
  advance(player, quick) {
    const room = this.roomFor(player);
    if (!room?.def.next) return;
    const proceed = () => {
      const before = this.roomKey;
      if (!this.enterRoom(player, room.def.next, { leaderOnly: false })) return;
      if (this.roomKey !== before) {
        this.broadcast(`${Shared.displayName(player)} has proceeded to the next challenge. Join them...`, player);
      }
    };
    if (quick) proceed();
    else Shared.confirm(player, "Are you ready to proceed?", proceed);
  }

  returnToNexus(player) {
    const before = this.roomKey;
    const path = this.pathsCompleted[this.pathsCompleted.length - 1];
    const back = path ? Shared.PATH_BY_KEY[path] : null;
    const destination = back ? Shared.loc({ x: back.back.x + Shared.random(0, back.spread), y: back.back.y }, 0) : null;
    this.enterRoom(player, "MAIN_HALL", { leaderOnly: false, destination });
    if (this.roomKey !== before) {
      this.broadcast(`${Shared.displayName(player)} has returned to the Nexus. Join them...`, player);
    }
  }

  completePath(pathKey) {
    if (!this.pathsCompleted.includes(pathKey)) this.pathsCompleted.push(pathKey);
    this.pathKey = null;
  }

  hasStragglers() {
    if (!this.room) return false;
    return this.players.some((player) => this.member(player).roomKey !== this.roomKey);
  }

  /** "Some of your party don't seem to have arrived yet." */
  abandonPrompt(player, action, proceed) {
    player.sendMessage("Some of your party don't seem to have arrived yet. If you proceed, they will be abandoned.");
    Shared.options(player, `${action}?`,
      "No, wait for any stragglers.", () => {},
      "Yes, abandon any stragglers.", () => {
        for (const straggler of [...this.players]) {
          if (this.member(straggler).roomKey === this.roomKey) continue;
          straggler.sendMessage("Your party moved on without you.");
          this.leave(straggler, { teleport: true });
        }
        proceed();
      });
  }

  // ---------------------------------------------------------------- tick

  processOnce() {
    const now = Shared.cycle();
    if (now === this.lastCycle || this.over) return;
    this.lastCycle = now;
    for (const room of this.rooms.values()) {
      if (room.destroyed) continue;
      room.tick();
      room.updateBossHud();
    }
    if (now % 2 === 0) this.refreshHudStates();
  }

  processPlayer(player) {
    const room = this.roomFor(player);
    if (!room || room.destroyed) return;
    const member = this.member(player);
    const location = player.getLocation();
    const last = member.lastTile;
    if (!last || !last.equals(location)) {
      for (const step of stepsBetween(last, location)) room.onStep(player, last, step);
      member.lastTile = location.clone();
    }
    room.tickPlayer(player);
  }

  // ---------------------------------------------------------------- area

  onAreaEnter(player) {
    if (!this.players.includes(player)) return;
    this.sendHud(player);
  }

  onAreaLeave(player, logout) {
    if (!this.players.includes(player)) return;
    if (logout) {
      this.onLogout(player);
      return;
    }
    // Teleported or walked out of the tombs: that's the end of their raid.
    this.leave(player, { teleport: false });
  }

  onLogout(player) {
    const room = this.roomFor(player);
    if (room?.isStarted() && room.inChallenge(player)) {
      this.member(player).deaths++;
      this.totalDeaths++;
      this.broadcast(`<col=ff0000>${Shared.displayName(player)}</col> has logged out. Total deaths: <col=ff0000>${this.totalDeaths}</col>.`, player);
    }
    this.leave(player, { teleport: false, logout: true });
    player.setLocation(Shared.loc(Shared.LOBBY_RETURN));
  }

  /** Takes a player out of the raid; with `teleport` they are faded back to the lobby. */
  leave(player, { teleport = true, logout = false } = {}) {
    if (!this.players.includes(player)) return;
    this.players = this.players.filter((member) => member !== player);
    if (!logout) this.original.delete(player.getUsername());
    this.revive(player);
    this.members.delete(player);
    player.setAttribute(ATTR_RAID, null);
    this.closeHud(player);
    removeRaidItems(player);
    this.lobby.leave(player, false);
    if (this.leader === player && this.players.length > 0) {
      this.leader = this.players[0];
      this.leader.sendMessage("You have been promoted to the raid party leader.");
    }
    if (teleport) {
      Shared.fadeMove(player, () => {
        if (player.getArea?.() === this.area) this.area.leave(player, false);
        player.moveTo(Shared.loc({ x: Shared.LOBBY_RETURN.x + Shared.random(0, 2), y: Shared.LOBBY_RETURN.y + Shared.random(0, 1) }));
      });
    }
    this.refreshHudNames();
    this.refreshHudStates();
    if (this.players.length === 0) {
      this.dispose();
      return;
    }
    this.room?.isStarted() && this.checkTeamWipe(this.room);
  }

  dispose() {
    if (this.over) return;
    this.over = true;
    for (const room of this.rooms.values()) room.destroy();
    this.rooms.clear();
    if (!this.area.isDestroyed()) this.area.destroy();
    raids.delete(this);
    this.lobby.raid = null;
  }

  broadcast(message, except = null) {
    for (const player of this.players) {
      if (player !== except) player.sendMessage(message);
    }
  }

  give(player, itemId, amount) {
    const { ItemDefinition, ItemOnGroundManager, Item } = Shared.core();
    const inventory = player.getInventory();
    const stackable = ItemDefinition.forId(itemId)?.isStackable?.();
    if ((stackable && inventory.contains(itemId)) || inventory.getFreeSlots() >= (stackable ? 1 : amount)) {
      if (stackable) inventory.adds(itemId, amount);
      else for (let i = 0; i < amount; i++) inventory.adds(itemId, 1);
      return;
    }
    for (let i = 0; i < amount; i++) {
      if (inventory.getFreeSlots() > 0) inventory.adds(itemId, 1);
      else ItemOnGroundManager.registerLocation(player, new Item(itemId, 1), player.getLocation().clone(), this.area);
    }
  }

  // ---------------------------------------------------------------- deaths

  /** After the death animation: OSRS keeps the dead out of the fight until it ends. */
  onPlayerDied(player) {
    const member = this.member(player);
    const room = this.roomFor(player);
    this.totalDeaths++;
    member.deaths++;
    recordStat(player, "deaths", Shared.modeName(this.raidLevel));
    member.points = Math.max(0, member.points - Math.max(1000, Math.floor(member.points * 0.2)));
    player.sendMessage(`You have died. Total deaths: <col=ff0000>${this.totalDeaths}</col>.`);
    if (room?.isStarted() && room.challengePlayers().length > 0) {
      player.sendMessage(this.permittedTeamDeaths === -1 || this.permittedTeamDeaths > this.teamDeaths + 1
        ? "You will respawn when your party completes or fails the challenge."
        : "You will respawn when your party completes the challenge.");
    }
    this.broadcast(`<col=ff0000>${Shared.displayName(player)}</col> has died. Total deaths: <col=ff0000>${this.totalDeaths}</col>.`, player);
    if (!room) {
      player.moveTo(Shared.loc(ROOMS.MAIN_HALL.spawn));
      return;
    }
    if (room.key === "MAIN_HALL" || room.stage !== STAGE.COMPLETED) {
      player.moveTo(Shared.spread(room.def.spawn, room.def.spread));
      if (room.key !== "MAIN_HALL" && room.isStarted()) this.makeGhost(player);
    } else {
      player.moveTo(Shared.loc(room.def.challenge));
    }
    Shared.later(player, 1, () => room.isStarted() && this.checkTeamWipe(room));
  }

  makeGhost(player) {
    const { NpcIdentifiers } = Shared.core();
    this.member(player).ghost = true;
    player.setNpcTransformationId(NpcIdentifiers.GHOST_51);
    player.setUntargetable(true);
    player.getCombat().reset();
    // A ghost has no inventory or worn equipment tabs until it's revived (OpenRune).
    const sender = player.getPacketSender();
    for (const { uid } of GHOST_TABS) sender.closeSubInterface(uid);
    this.refreshHudStates();
  }

  revive(player) {
    const member = this.members.get(player);
    const wasGhost = member?.ghost === true;
    if (member) member.ghost = false;
    if (player.getNpcTransformationId() !== -1) player.setNpcTransformationId(-1);
    player.setUntargetable(false);
    if (!wasGhost) return;
    const sender = player.getPacketSender();
    for (const { uid, group } of GHOST_TABS) sender.sendSubInterface(uid, group, 1);
    player.getInventory().refreshItems();
    player.getEquipment().refreshItems();
  }

  /** Everyone in the fight is down: spend a team life (reset the room) or fail the raid. */
  checkTeamWipe(room) {
    if (!room.isStarted()) return;
    const standing = this.players.some((player) => this.roomFor(player) === room && player.getHitpoints() > 0
      && (room.inChallenge(player) || !this.member(player).ghost) && !this.member(player).ghost);
    if (standing) return;
    this.teamDeaths++;
    const retry = this.permittedTeamDeaths === -1 || this.teamDeaths < this.permittedTeamDeaths;
    if (!retry) room.failed = true;
    for (const player of room.roomPlayers()) {
      Shared.fadeMove(player, () => {
        this.revive(player);
        player.resetAttributes();
        Shared.jingle(player, Shared.JINGLE.FAILURE);
        if (retry) {
          player.sendMessage(`Your party failed to complete the challenge. ${this.permittedTeamDeaths === -1
            ? "You may try again..."
            : `You have <col=ff0000>${this.permittedTeamDeaths - this.teamDeaths}</col> attempts remaining...`}`);
        }
      });
    }
    room.reset();
    if (!retry) Shared.later(this, 3, () => this.fail());
  }

  fail() {
    for (const player of [...this.players]) {
      player.sendMessage("You failed to survive the Tombs of Amascut.");
      Shared.jingle(player, Shared.JINGLE.FAILURE);
      this.leave(player, { teleport: true });
    }
    this.dispose();
  }

  // ---------------------------------------------------------------- completion & points

  setCompletion() {
    this.totalTicks = Shared.cycle() - this.startCycle;
    const level = this.settings.raidLevel;
    this.completedRaidLevel = level;
    if (this.timeLimitMinutes !== -1 && this.totalTicks * 0.6 > this.timeLimitMinutes * 60) {
      this.completedRaidLevel = level - this.settings.timePenalty();
      this.failedTime = true;
    }
  }

  sendCompletionMessages(player, name, duration, total) {
    const mode = Shared.modeName(this.raidLevel);
    player.sendMessage(`Challenge complete: ${name}. Duration: <col=ef1020>${Shared.formatTicks(duration)}</col>`);
    player.sendMessage(`Tombs of Amascut: ${mode} Mode challenge completion time: <col=ef1020>${Shared.formatTicks(total)}</col>`);
    player.sendMessage(`Tombs of Amascut: ${mode} Mode total completion time: <col=ef1020>${Shared.formatTicks(this.totalTicks)}</col>`);
    const count = incrementKillCount(player, mode);
    recordBestTimes(player, mode, this.original.size, total, this.totalTicks);
    player.sendMessage(`Your completed Tombs of Amascut: ${mode} Mode count is: <col=ff0000>${count}</col>.`);
    if (this.timeLimitMinutes !== -1) {
      player.sendMessage(this.failedTime
        ? `<col=FF0000>Your party failed to beat the overall target time of ${this.timeLimitMinutes}:00</col>`
        : `<col=00FF00>Your party beat the overall target time of ${this.timeLimitMinutes}:00!</col>`);
    }
  }

  /**
   * Wiki: room points go to every player's total when the room is completed (capped at 64,000),
   * and whoever scored the most in a puzzle or boss room gets an MVP bonus of 300 x team size.
   * The puzzles' completion points are OpenRune's (the Wiki gives none).
   */
  completeRoomPoints(room) {
    const def = room.def;
    const completion = def.puzzle ? (PUZZLE_POINTS[def.path] ?? 0) : 0;
    let mvp = null;
    if (def.puzzle || def.boss) {
      for (const player of this.players) {
        if (this.member(player).roomPoints > (mvp ? this.member(mvp).roomPoints : 0)) mvp = player;
      }
    }
    for (const player of this.players) {
      const member = this.member(player);
      let earned = member.roomPoints + completion;
      if (player === mvp) earned += MVP_POINTS_PER_PLAYER * this.players.length;
      member.points = Math.min(TOTAL_POINTS_CAP, member.points + earned);
      member.roomPoints = 0;
    }
  }

  /**
   * Room points for the room the player is in (Wiki: capped at 20,000; OpenRune gives the
   * Wardens 60,000). They count once the room is completed.
   */
  addPoints(player, amount) {
    const member = this.members.get(player);
    if (!member) return;
    const cap = this.roomFor(player)?.def.key.startsWith("WARDENS") ? WARDENS_ROOM_POINTS_CAP : ROOM_POINTS_CAP;
    member.roomPoints = Math.min(cap, member.roomPoints + Math.floor(amount));
  }

  /** The points the loot is rolled with: the total less the 5,000 everyone starts with. */
  lootPoints(player) {
    return Math.max(0, this.member(player).points - START_POINTS);
  }

  /** At the end, each player's loot points go to TOA_PERSONAL_CONTRIBUTION (as OpenRune). */
  sendContributions() {
    for (const player of this.players) player.getPacketSender().sendConfig(VARP_PERSONAL_CONTRIBUTION, this.lootPoints(player));
  }

  totalPoints() {
    let total = 0;
    for (const player of this.players) total += this.lootPoints(player);
    return total;
  }

  // ---------------------------------------------------------------- HUD

  sendHud(player) {
    const sender = player.getPacketSender();
    sender.sendSubInterface(Shared.OVERLAY_HUD_UID, INTERFACE.RAID_HUD, 1);
    sender.sendVarbit(VARBIT.HUD_RAID_LEVEL, this.settings.raidLevel);
    this.member(player).hud.clear();
    this.sendHudNames(player);
    this.sendTimer(player);
    for (let i = 0; i < this.pathLevels.length; i++) sender.sendVarbit(VARBIT.HUD_PATH_LEVEL_BASE + i, this.pathLevels[i]);
    this.refreshHudStates();
  }

  closeHud(player) {
    player.getPacketSender().closeSubInterface(Shared.OVERLAY_HUD_UID);
  }

  sendHudNames(player) {
    const names = Array.from({ length: Shared.MAX_PARTY_SIZE }, (_, i) =>
      this.players[i] ? Shared.displayName(this.players[i]) : "");
    player.getPacketSender().sendClientScript(SCRIPT.HUD_PLAYER_NAMES, ...names);
  }

  refreshHudNames() {
    for (const player of this.players) this.sendHudNames(player);
  }

  sendTimer(player) {
    if (this.startCycle <= 0) return;
    const sender = player.getPacketSender();
    if (this.totalTicks !== -1) sender.sendClientScript(SCRIPT.HUD_TIMER, this.totalTicks, 1);
    else sender.sendClientScript(SCRIPT.HUD_TIMER, Shared.cycle() - this.startCycle, 0);
  }

  sendPathLevels() {
    for (const player of this.players) {
      for (let i = 0; i < this.pathLevels.length; i++) {
        player.getPacketSender().sendVarbit(VARBIT.HUD_PATH_LEVEL_BASE + i, this.pathLevels[i]);
      }
    }
  }

  setHudPath(player, value) {
    player.getPacketSender().sendVarbit(VARBIT.HUD_PATH, value);
  }

  /** Each party slot's health orb: 1-29 health, 30 dead, 31 elsewhere, 0 empty. */
  refreshHudStates() {
    for (const viewer of this.players) {
      const member = this.member(viewer);
      const send = (varbit, value) => {
        if (member.hud.get(varbit) === value) return;
        member.hud.set(varbit, value);
        viewer.getPacketSender().sendVarbit(varbit, value);
      };
      for (let i = 0; i < Shared.MAX_PARTY_SIZE; i++) {
        const other = this.players[i];
        if (!other || this.totalTicks !== -1) {
          send(VARBIT.HUD_PLAYER_BASE + i, 0);
          continue;
        }
        if (other === viewer) send(VARBIT.HUD_PLAYER_ME, i + 1);
        const otherMember = this.member(other);
        if (this.roomKey && otherMember.roomKey !== this.roomKey) {
          send(VARBIT.HUD_PLAYER_BASE + i, 31);
        } else if (otherMember.ghost) {
          send(VARBIT.HUD_PLAYER_BASE + i, 30);
        } else {
          const max = Math.max(1, other.getSkillManager().getMaxLevel(Shared.core().Skill.HITPOINTS));
          send(VARBIT.HUD_PLAYER_BASE + i, 1 + Math.min(28, Math.floor((other.getHitpoints() / max) * 28)));
        }
      }
    }
  }
}

const styleMethods = new Map();

/**
 * A bare combat method of one style, for scripted attacks that build their own hits: it only
 * tells the hit its style (protection prayers, hitsplats, XP-free damage).
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

function pathFactor(level) {
  return level > 0 ? 1 + 0.08 + 0.05 * (level - 1) : 1;
}

/** Every tile walked between two positions (a run moves two a tick). */
function stepsBetween(from, to) {
  if (!from || from.getZ() !== to.getZ() || from.getDistance(to) > 2) return [to];
  const steps = [];
  let x = from.getX();
  let y = from.getY();
  while (x !== to.getX() || y !== to.getY()) {
    x += Math.sign(to.getX() - x);
    y += Math.sign(to.getY() - y);
    steps.push(Shared.loc({ x, y, z: to.getZ() }));
  }
  return steps;
}

const ATTR_KILL_COUNTS = "toa:completions";

// The gameframe's inventory (149) and worn equipment (387) tabs.
const GHOST_TABS = [{ uid: (161 << 16) | 79, group: 149 }, { uid: (161 << 16) | 80, group: 387 }];

// Wiki: each boss's capture book (and its "read" varbit, TOA_BOOK_*) and the path bosses'
// trophies for the top damager: Eldritch ashes, Scarab dung, Big banana and Zebak's Fang.
const BOSS_DROPS = {
  HET_BOSS: { book: 27302, bookVarbit: 14452, trophy: 27223 }, // Het's capture, TOA_AKKHA_ASHES
  SCABARAS_BOSS: { book: 27306, bookVarbit: 14449, trophy: 27214 }, // Scabaras' capture, TOA_KEPHRI_POO
  APMEKEN_BOSS: { book: 27304, bookVarbit: 14450, trophy: 27221 }, // Apmeken's capture, TOA_BABA_BANANA
  CRONDIS_BOSS: { book: 27308, bookVarbit: 14451, trophy: 27219, tile: { x: 3927, y: 5408, z: 0 } }, // OpenRune's tile
  WARDENS_P3: { book: 27310, bookVarbit: 14453, tile: { x: 3936, y: 5158, z: 1 } }, // The wardens; the floor's edge
};

/** Already has the book: read (its varbit), or kept in the inventory or bank. */
function ownsBook(player, book, varbit) {
  if (player.getPacketSender().getVarbit?.(varbit) === 1) return true;
  if (player.getInventory().contains(book)) return true;
  const { Bank } = Shared.core();
  for (let tab = 0; tab < Bank.TOTAL_BANK_TABS; tab++) {
    if (player.getBank(tab)?.contains?.(book)) return true;
  }
  return false;
}

const START_POINTS = 5000;
const TOTAL_POINTS_CAP = 64000;
const ROOM_POINTS_CAP = 20000;
const WARDENS_ROOM_POINTS_CAP = 60000;
const MVP_POINTS_PER_PLAYER = 300;
const PUZZLE_POINTS = { SCABARAS: 300, APMEKEN: 450, CRONDIS: 400 };
const VARP_PERSONAL_CONTRIBUTION = 3606;

function incrementKillCount(player, mode) {
  const counts = { entry: 0, normal: 0, expert: 0, ...(player.getAttribute(ATTR_KILL_COUNTS) ?? {}) };
  const key = mode.toLowerCase();
  counts[key] = (counts[key] ?? 0) + 1;
  player.setAttribute(ATTR_KILL_COUNTS, counts);
  return counts[key];
}

/**
 * The lobby scoreboard's personal stats (OpenRune #271's ToaStats): attempts and deaths per
 * mode, and the best challenge and overall times per mode and team size (1-8).
 */
const ATTR_STATS = "toa:stats";
const MAX_TEAM_SIZE = 8;

function statsOf(player) {
  const saved = player.getAttribute(ATTR_STATS);
  return {
    attempts: { ...(saved?.attempts ?? {}) },
    deaths: { ...(saved?.deaths ?? {}) },
    challenge: { ...(saved?.challenge ?? {}) },
    overall: { ...(saved?.overall ?? {}) },
  };
}

function recordStat(player, kind, mode) {
  const stats = statsOf(player);
  const key = String(mode).toLowerCase();
  stats[kind][key] = (stats[kind][key] ?? 0) + 1;
  player.setAttribute(ATTR_STATS, stats);
}

function recordBestTimes(player, mode, teamSize, challengeTicks, overallTicks) {
  const stats = statsOf(player);
  const key = `${String(mode).toLowerCase()}:${Math.max(1, Math.min(MAX_TEAM_SIZE, teamSize))}`;
  for (const [kind, ticks] of [["challenge", challengeTicks], ["overall", overallTicks]]) {
    if (ticks > 0 && (!stats[kind][key] || ticks < stats[kind][key])) stats[kind][key] = ticks;
  }
  player.setAttribute(ATTR_STATS, stats);
}

function killCounts(player) {
  return { entry: 0, normal: 0, expert: 0, ...(player.getAttribute(ATTR_KILL_COUNTS) ?? {}) };
}

function removeRaidItems(player) {
  const inventory = player.getInventory();
  for (const item of inventory.getValidItems()) {
    if (raidItems.has(item.getId())) inventory.delete(item.getId(), item.getAmount());
  }
}

/** Starts a raid for the leader's lobby party and puts them in the Nexus. */
function begin(leader) {
  const lobby = Parties.currentParty(leader);
  if (!lobby) return null;
  if (lobby.raid) return lobby.raid;
  if (!lobby.isLeader(leader)) {
    Shared.statement(leader, `Your leader, ${lobby.leaderName}, must enter first.`);
    return null;
  }
  const raid = new Raid(lobby, leader);
  for (const member of raid.players) {
    if (member === leader) continue;
    member.sendMessage(`${Shared.displayName(leader)} has entered the Tombs of Amascut. Step inside to join them...`);
    member.getPacketSender().sendVarbit(VARBIT.PARTY_STATUS, 2);
  }
  return raid;
}

module.exports = {
  STAGE,
  ATTR_RAID,
  Room,
  Raid,
  registerRoom,
  onRaidArea,
  raidOf,
  roomOf,
  begin,
  raids,
  killCounts,
  statsOf,
  ATTR_STATS,
  MAX_TEAM_SIZE,
  removeRaidItems,
  registerRaidItems,
  styleMethod,
  walkThrough,
  START_POINTS,
  TOTAL_POINTS_CAP,
};
