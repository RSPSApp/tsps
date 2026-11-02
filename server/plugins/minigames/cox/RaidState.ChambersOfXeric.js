"use strict";

/**
 * A raid: its party's private copy of the chambers, who is inside, the stage, points, deaths
 * and the timer. Rooms are classes registered by the room units; every room of the layout gets
 * one, and the raid ticks them.
 *
 * Not on the Wiki (to check against a capture):
 * - Entering builds the layout the first time; everyone lands at the first room's spawn. The
 *   leader starts the raid from the party tab; no one can join after that.
 * - Stages: 1 started, 2 the upper floor done (reaching plane 2), 3 the middle floor done
 *   (Challenge Mode, plane 1), 4 the Olm reached. Each announces "<Floor> level complete!
 *   Duration: mm:ss" and moves the respawn to that floor's start.
 * - The overlay (513) shows total and personal points; the party tab (500) the raiders.
 * - The raid ends when no one left inside can lead it: the leader, or a raider who can kick
 *   from the chat-channel.
 * Wiki:
 * - Deaths are safe. A death costs 40% of the player's points, or 5% of the team's total if
 *   the player had under 5% of it; raid-only items drop where the player died.
 * - Points come from damage dealt (capped per room) and from many activities; personal points
 *   are not capped during the raid (only the loot is, at 131,071).
 * - You can't teleport out.
 */

const Shared = require("./Shared.ChambersOfXeric");
const Monsters = require("./Monsters.ChambersOfXeric");
const Layout = require("./Layout.ChambersOfXeric");
const CoxMap = require("./Map.ChambersOfXeric");
const Parties = require("./Parties.ChambersOfXeric");

const ATTR_RAID = "cox:raid";
const raids = new Set();
/** Raiders who logged out mid-raid: username -> raid, to put them back when they log in. */
const rejoining = new Map();
/** Room key -> Room subclass; the room units fill this in. */
const roomTypes = new Map();

const STAGE = { WAITING: 0, STARTED: 1, UPPER_DONE: 2, MIDDLE_DONE: 3, OLM: 4 };
const DEATH = { personalLoss: 0.4, teamLoss: 0.05, smallShare: 0.05 };
/** Damage points: 5 per hitpoint dealt, each room capped at 5 x its NPCs' hitpoints + 5%. */
const POINTS_PER_DAMAGE = 5;
const ENTER_SOUND = 1952;
const LEAVE_SOUND = 1956;
const BUILD_DELAY = 3;
const TIMER_REFRESH = 100;

function registerRoom(key, RoomClass) {
  roomTypes.set(key, RoomClass);
}

/** Units' per-tick work for every raid: `hook(raid)`. */
const tickHooks = [];

function onTick(hook) {
  tickHooks.push(hook);
}

/** Units' work when a raider leaves the raid for good or logs out: `hook(raid, player, logout)`. */
const leaveHooks = [];

function onLeave(hook) {
  leaveHooks.push(hook);
}

/** Units' work when a raid is completed (the Olm slain): `hook(raid)`. */
const completeHooks = [];

function onComplete(hook) {
  completeHooks.push(hook);
}

function raidOf(player) {
  const raid = player?.getAttribute?.(ATTR_RAID);
  return raid && raids.has(raid) ? raid : null;
}

/** A room of the raid. Room units subclass this; plain rooms (resources, edges) use it as is. */
class Room {
  constructor(raid, record) {
    this.raid = raid;
    this.record = record;
    this.key = record.key;
    this.pointsCap = 0;
    this.npcs = new Set();
  }

  get map() {
    return this.raid.map;
  }

  /** A tile of this room, as it is on the cache's map; `size` for an NPC's south-west tile. */
  tile(x, y, size = 1, sizeY = size) {
    return this.map.roomTile(this.record, x, y, size, sizeY);
  }

  /** One of three tiles by which version of the room this is (the path turning west, north, east). */
  respective(west, north, east) {
    return this.map.respective(this.record, [west, north, east]);
  }

  /** The raid has started: spawn what the room holds. */
  load() {}

  /** Combat points the room can give (5 x its NPCs' hitpoints, an unverified +5%). */
  combatPoints() {
    return 0;
  }

  enter() {}

  tick() {}

  /** The room's template objects with these ids, as the map placed them. */
  templateObjects(ids) {
    const wanted = new Set([].concat(ids));
    const found = [];
    for (let x = 0; x < 4; x++) {
      for (let y = 0; y < 4; y++) {
        for (const object of this.map.getChunkObjects(this.record.plane, this.record.gridX * 4 + x, this.record.gridY * 4 + y)) {
          if (wanted.has(object.getId())) found.push(object);
        }
      }
    }
    return found;
  }

  /** One of the room's NPCs died; `killer` is a player or null. */
  onNpcDeath() {}

  /** One of the room's NPCs is about to die; true keeps it alive. */
  beforeNpcDeath() {
    return false;
  }

  /** A hit about to land on one of the room's NPCs; change its damage here. */
  modifyHit() {}

  /** The room's raiders: players standing in it. */
  raiders() {
    return [...this.raid.players].filter((player) => this.raid.roomAt(player.getLocation()) === this);
  }

  /** Sets an NPC on the nearest raider in the room, if it has no target. */
  engage(npc) {
    if (!npc?.isRegistered?.() || npc.getCombat().getTarget()) return;
    const raiders = this.raiders().filter((player) => player.getHitpoints() > 0);
    if (!raiders.length) return;
    raiders.sort((a, b) => a.getLocation().getDistance(npc.getLocation()) - b.getLocation().getDistance(npc.getLocation()));
    npc.getCombat().attack(raiders[0]);
  }

  /** Whether a player may go through the room's passage onward. */
  canPass() {
    return true;
  }

  spawnNpc(id, tile, options = {}) {
    const location = tile.getX ? tile : this.tile(tile.x, tile.y, options.size ?? 1);
    const npc = Shared.api().spawnNpc({
      id, x: location.getX(), y: location.getY(), z: location.getZ(), wanderRadius: 0, ...options,
    });
    if (!npc) return null;
    npc.__skipDefaultRespawn = true;
    npc.__coxRoom = this;
    if (options.scale !== false) Monsters.apply(npc, this.raid.scaling ?? this.raid.scalingInputs());
    this.map.add(npc);
    this.npcs.add(npc);
    return npc;
  }

  /**
   * Blocks the room's exit with a crystal (30018, 2x2) at one of three cache tiles by the room's
   * version (west, north, east), turned with the room (unverified tiles).
   */
  blockExit(tiles, crystalId = Shared.OBJECT.CRYSTAL) {
    const tile = tiles[this.record.variant];
    if (!tile) return null;
    const { GameObject, ObjectManager } = Shared.core();
    const at = this.tile(tile.x, tile.y, 2);
    this.exitCrystal = new GameObject(crystalId, at, 10, this.record.rotation, this.map);
    ObjectManager.register(this.exitCrystal, true);
    return this.exitCrystal;
  }

  /**
   * The room is done: its crystal shatters (rsprox captures: loc anim 7506, area sounds 1021 and
   * 3821 five cycles later, range 10) and is gone 4 ticks later.
   */
  clearExit() {
    this.completed = true;
    const crystal = this.exitCrystal;
    if (!crystal) return;
    this.exitCrystal = null;
    const { Animation, ObjectManager } = Shared.core();
    const viewers = [...this.raid.players].filter((player) => player.getLocation().getZ() === crystal.getLocation().getZ());
    for (const player of viewers) player.getPacketSender().sendObjectAnimation(crystal, new Animation(7506));
    Shared.areaSound(viewers, 1021, crystal.getLocation(), { range: 10 });
    Shared.areaSound(viewers, 3821, crystal.getLocation(), { delay: 5, range: 10 });
    Shared.later(this.raid, 4, () => ObjectManager.deregister(crystal, true));
  }

  removeNpc(npc) {
    this.npcs.delete(npc);
    if (npc?.isRegistered?.()) Shared.api().removeNpc(npc);
  }

  cleanup() {
    for (const npc of [...this.npcs]) this.removeNpc(npc);
  }
}

/** The first room: no one goes past its passage until the leader starts the raid. */
class EntranceRoom extends Room {
  canPass(player) {
    if (this.raid.stage !== STAGE.WAITING) return true;
    // rsprox captures: the leader is pointed at the side-panel, the rest told to wait.
    if (this.raid.party.isLeader(player)) {
      Shared.statement(player, "Use the controls on the <col=7f0000>side-panel</col><br>when you are ready to begin the raid.");
      Shared.sound(player, 2277);
    } else {
      Shared.statement(player, `You cannot proceed until ${this.raid.party.leader} has started the raid.`);
    }
    return false;
  }
}

registerRoom("RAID_START", EntranceRoom);

class Raid {
  constructor(party, { random = Math.random } = {}) {
    this.party = party;
    this.random = random;
    this.players = new Set();
    this.original = new Set();
    this.points = new Map();
    this.totalPoints = 0;
    this.stage = STAGE.WAITING;
    this.startCycle = 0;
    this.map = null;
    this.rooms = [];
    this.roomOfPlayer = new Map();
    this.respawn = null;
    this.timer = null;
    this.ticks = 0;
    this.destroyed = false;
    this.building = false;
    this.deaths = [];
    raids.add(this);
  }

  get challenge() {
    return this.party.challenge;
  }

  /** How many raiders the raid scales to: those who were there when it started. */
  get scale() {
    return Math.max(1, this.original.size || this.players.size);
  }

  // ---------------------------------------------------------------- building and entering

  build() {
    const layout = this.challenge ? Layout.challengeLayout() : Layout.normalLayout(this.random);
    this.layout = layout;
    this.map = CoxMap.createMap(layout, this.random);
    this.map.raid = this;
    this.rooms = this.map.rooms.map((record) => new (roomTypes.get(record.key) ?? Room)(this, record));
    // The Olm's chamber isn't one of the layout's rooms; its unit registers a room for it.
    const OlmRoom = roomTypes.get("OLM");
    if (OlmRoom) {
      this.olmRoom = new OlmRoom(this, { key: "OLM", index: this.rooms.length, plane: 0, variant: 0, rotation: 0 });
      this.rooms.push(this.olmRoom);
    }
    this.respawn = this.map.startTile();
    this.timer = Shared.repeat(this, 1, () => this.tick());
  }

  /** A raider enters: the raid is built the first time (it takes a moment), then they land. */
  enter(player) {
    if (this.destroyed) return;
    if (this.players.size >= Shared.MAX_RAIDERS) {
      player.sendMessage("The raid is full!");
      return;
    }
    if (!this.map) {
      this.build();
      this.building = true;
      player.sendMessage("Please wait a few moments as your raid is being constructed...");
      Shared.later(this, BUILD_DELAY, () => {
        this.building = false;
        this.admit(player);
      });
    } else {
      this.admit(player);
    }
    for (const member of this.party.members()) {
      if (!Shared.onMount(member)) continue;
      Shared.raidMessage(member, member === player ? "Inviting party..." : `${Shared.displayName(player)} has invited you to their raid party...`);
    }
  }

  admit(player) {
    if (this.destroyed || !player.isRegistered?.()) return;
    this.players.add(player);
    player.setAttribute(ATTR_RAID, this);
    player.setAttribute(Shared.ATTR.INSIDE, true);
    Shared.sound(player, ENTER_SOUND);
    player.getPacketSender().sendVarbit(Shared.VARBIT.ENTERING, 0);
    Shared.fadeMove(player, () => {
      this.map.enter(player);
      player.moveTo(this.respawn);
      this.showRaidHud(player);
    });
    this.refreshTabs();
  }

  /** The party tab replaces the chat-channel tab, and the points overlay goes up. */
  showRaidHud(player) {
    const sender = player.getPacketSender();
    Shared.api().emitCustomEvent("side-channels:replace-chat-channel", {
      player,
      group: Shared.INTERFACE.PARTY_TAB,
      onMount: () => {
        sender.sendInterfaceFlagsRange((Shared.INTERFACE.PARTY_TAB << 16) | 14, 0, 0, Shared.EVENT.OP1);
        this.refreshTab(player);
      },
    });
    sender.sendSubInterface(Shared.OVERLAY_UID, Shared.INTERFACE.OVERLAY, 1);
    sender.sendVarbit(Shared.VARBIT.TAB_ICON, 1).sendVarbit(Shared.VARBIT.TAB_ICON_2, 2);
    this.refreshPoints(player);
  }

  hideRaidHud(player) {
    const sender = player.getPacketSender();
    Shared.api().emitCustomEvent("side-channels:replace-chat-channel", { player, group: null });
    sender.closeSubInterface(Shared.OVERLAY_UID);
    sender.sendVarbit(Shared.VARBIT.TAB_ICON, 0).sendVarbit(Shared.VARBIT.STAGE, 0);
    sender.sendConfig(Shared.VARP.RAID_STATE, 0);
  }

  // ---------------------------------------------------------------- starting and progress

  /** The leader begins the raid: no one can join from here, and the rooms come alive. */
  start() {
    if (this.stage !== STAGE.WAITING || this.destroyed) return;
    this.stage = STAGE.STARTED;
    this.startCycle = Shared.cycle();
    for (const player of this.players) this.original.add(player.getUsername());
    this.scaling = this.scalingInputs();
    for (const room of this.rooms) {
      try {
        room.load();
        room.pointsCap = room.combatPoints();
      } catch (error) {
        console.warn("[cox] room failed to load", room.key, error);
      }
    }
    Parties.delist(this.party);
    for (const player of this.players) Shared.raidMessage(player, "The raid has begun!");
    this.refreshTabs();
  }

  /** What the monsters scale by, fixed when the raid starts (Wiki: the party's highest stats). */
  scalingInputs() {
    const { Skill } = Shared.core();
    const raiders = [...this.players];
    const best = (read) => Math.max(1, ...raiders.map(read));
    const mining = raiders.reduce((sum, player) => sum + player.getSkillManager().getMaxLevel(Skill.MINING), 0);
    return {
      size: this.scale,
      maxCombat: best((player) => player.getSkillManager().getCombatLevel()),
      maxHitpoints: best((player) => player.getSkillManager().getMaxLevel(Skill.HITPOINTS)),
      averageMining: raiders.length ? mining / raiders.length : 1,
      challenge: this.challenge,
    };
  }

  /** The Great Olm is slain: the raid is over, its time fixed; rewards and records follow. */
  complete() {
    if (this.completed || this.destroyed) return;
    this.duration = this.ticksSinceStart();
    this.completed = true;
    for (const player of this.players) player.getPacketSender().sendVarbit(Shared.VARBIT.TIMER, this.duration);
    for (const hook of completeHooks) {
      try {
        hook(this);
      } catch (error) {
        console.warn("[cox] completion hook failed", error);
      }
    }
  }

  ticksSinceStart() {
    if (this.completed) return this.duration;
    return this.stage === STAGE.WAITING ? 0 : Shared.cycle() - this.startCycle + 1;
  }

  tick() {
    if (this.destroyed) return false;
    this.ticks++;
    for (const player of [...this.players]) this.trackRoom(player);
    for (const room of this.rooms) room.tick();
    for (const hook of tickHooks) hook(this);
    if (this.ticks % TIMER_REFRESH === 0) {
      for (const player of this.players) player.getPacketSender().sendVarbit(Shared.VARBIT.TIMER, this.ticksSinceStart());
    }
    return true;
  }

  roomAt(location) {
    if (!this.map) return null;
    if (this.map.inOlmChamber(location)) return this.olmRoom ?? null;
    return this.rooms[this.map.roomAt(location)?.index] ?? null;
  }

  /** Notices a raider moving into another room, and a floor being reached. */
  trackRoom(player) {
    const location = player.getLocation();
    const room = this.roomAt(location);
    const previous = this.roomOfPlayer.get(player) ?? null;
    if (room === previous) return;
    this.roomOfPlayer.set(player, room);
    room?.enter(player);
    if (this.stage === STAGE.WAITING) return;
    const plane = location.getZ();
    if (this.map.inOlmChamber(location)) this.reachStage(STAGE.OLM, this.map.olmEntrance);
    else if (plane === 2) this.reachStage(STAGE.UPPER_DONE, this.floorStart(2));
    else if (plane === 1) this.reachStage(STAGE.MIDDLE_DONE, this.floorStart(1));
  }

  floorStart(plane) {
    const start = this.rooms.find((room) => room.record.plane === plane && room.key === "FLOOR_START_UPSTAIRS");
    const above = start ? this.rooms[start.record.index - 1] : null;
    return above?.record.bound ?? null;
  }

  /** "Upper / Middle / Lower level complete! Duration: mm:ss", and the respawn moves on. */
  reachStage(stage, respawn) {
    if (this.stage >= stage) return;
    this.stage = stage;
    if (respawn) this.respawn = this.map.landing(respawn);
    const prefix = stage === STAGE.UPPER_DONE ? "Upper" : stage === STAGE.OLM || !this.challenge ? "Lower" : "Middle";
    const duration = Shared.formatTicks(this.ticksSinceStart());
    // rsprox captures: "<col=ff289d>Upper level complete! Duration: </col><col=ff0000>9:03</col>".
    for (const player of this.players) player.sendMessage(`<col=ff289d>${prefix} level complete! Duration: </col><col=ff0000>${duration}</col>`);
    this.refreshTabs();
  }

  // ---------------------------------------------------------------- points

  pointsOf(player) {
    return this.points.get(player.getUsername()) ?? 0;
  }

  /** Points for a raider who was there when the raid began. */
  addPoints(player, amount) {
    const name = player.getUsername();
    if (!this.original.has(name) || amount <= 0) return;
    const gained = Math.floor(amount);
    this.points.set(name, this.pointsOf(player) + gained);
    this.totalPoints += gained;
    for (const raider of this.players) this.refreshPoints(raider);
  }

  /** Damage points, within what the player's room still has to give. */
  addCombatPoints(player, amount) {
    const room = this.roomAt(player.getLocation());
    if (!room) return;
    const given = Math.min(Math.floor(amount), room.pointsCap);
    if (given <= 0) return;
    room.pointsCap -= given;
    this.addPoints(player, given);
  }

  refreshPoints(player) {
    player.getPacketSender()
      .sendVarbit(Shared.VARBIT.TOTAL_POINTS, Math.min(this.totalPoints, Shared.MAX_POINTS))
      .sendVarbit(Shared.VARBIT.PERSONAL_POINTS, Math.min(this.pointsOf(player), Shared.MAX_POINTS));
  }

  // ---------------------------------------------------------------- the party tab

  refreshTabs() {
    for (const player of this.players) this.refreshTab(player);
  }

  refreshTab(player) {
    const sender = player.getPacketSender();
    const started = this.stage !== STAGE.WAITING;
    const listed = started ? [...this.players] : this.party.members().filter((member) => raidOf(member) === this || Shared.onMount(member));
    sender.sendVarbit(Shared.VARBIT.TAB_LEADER, this.party.isLeader(player) ? 1 : 0)
      .sendVarbit(Shared.VARBIT.TAB_PLAYERS, this.players.size)
      .sendVarbit(Shared.VARBIT.STAGE, this.stage)
      .sendVarbit(Shared.VARBIT.TIMER, this.ticksSinceStart());
    sender.sendClientScript(Shared.SCRIPT.TAB_SIZE, listed.length);
    listed.forEach((member, index) => {
      const colour = !started || this.players.has(member) ? "ffffff" : "969696";
      const skills = member.getSkillManager();
      sender.sendClientScript(Shared.SCRIPT.TAB_MEMBER, index,
        `<col=${colour}>${Shared.displayName(member)}</col>|${skills.getCombatLevel()}|${skills.getTotalLevel()}`);
    });
    const channel = this.party.channel(player);
    const canKick = channel && channel.rankOf(player) >= channel.kickRank;
    sender.sendClientScript(Shared.SCRIPT.TAB_KICKABLE, canKick ? this.players.size : 0);
  }

  // ---------------------------------------------------------------- deaths

  /**
   * A safe death: 40% of the player's points go (or 5% of the team's if they had under 5% of
   * it), raid-only items drop where they fell, and they wake at the floor's respawn.
   */
  onDeath(player) {
    const deathSpot = player.getLocation().clone();
    const personal = this.pointsOf(player);
    if (this.original.has(player.getUsername())) {
      if (personal >= this.totalPoints * DEATH.smallShare && personal > 0) {
        const lost = Math.floor(personal * DEATH.personalLoss);
        this.points.set(player.getUsername(), personal - lost);
        this.totalPoints -= lost;
      } else {
        this.totalPoints -= Math.floor(this.totalPoints * DEATH.teamLoss);
      }
    }
    const room = this.roomAt(deathSpot);
    this.deaths.push(`${player.getUsername()}: death at ${room?.key ?? (this.map.inOlmChamber(deathSpot) ? "Great Olm" : "the chambers")}`);
    this.dropRaidItems(player, deathSpot);
    player.moveTo(this.respawn);
    for (const raider of this.players) this.refreshPoints(raider);
  }

  dropRaidItems(player, spot) {
    const { ItemOnGroundManager, Item } = Shared.core();
    const inventory = player.getInventory();
    const items = inventory.getItems?.() ?? [];
    let dropped = false;
    items.forEach((item, slot) => {
      if (!item || item.getId() < 0 || !Shared.isRaidItem(item.getId())) return;
      ItemOnGroundManager.registerLocation(player, new Item(item.getId(), item.getAmount()), spot);
      inventory.setItem(slot, new Item(-1, 0));
      dropped = true;
    });
    if (dropped) inventory.refreshItems();
  }

  // ---------------------------------------------------------------- leaving

  /** Out through the steps, or kicked: back to Mount Quidamortem. */
  leave(player, { logout = false } = {}) {
    if (!this.players.has(player)) return;
    this.removePlayer(player, logout);
    if (logout) {
      player.moveTo(Shared.loc(Shared.OUTSIDE));
    } else {
      Shared.fadeMove(player, () => {
        if (this.map?.contains?.(player.getLocation())) this.map.leave(player, false);
        player.moveTo(Shared.loc(Shared.OUTSIDE));
        Shared.sound(player, LEAVE_SOUND);
        this.hideRaidHud(player);
      });
    }
    this.afterSomeoneLeft(player);
  }

  /** The area noticed a raider leaving (a logout, or a move it didn't make itself). */
  playerLeftArea(player, logout) {
    if (!this.players.has(player)) return;
    if (logout && this.stage !== STAGE.WAITING) rejoining.set(player.getUsername(), this);
    this.removePlayer(player, logout);
    if (!logout) this.hideRaidHud(player);
    this.afterSomeoneLeft(player);
  }

  removePlayer(player, logout) {
    this.players.delete(player);
    this.roomOfPlayer.delete(player);
    player.setAttribute(ATTR_RAID, null);
    // Kept through a logout: the player is saved inside, and login puts them back out.
    if (!logout) player.setAttribute(Shared.ATTR.INSIDE, null);
    this.dropRaidItems(player, player.getLocation().clone());
    if (logout) this.hideRaidHud(player);
    for (const hook of leaveHooks) hook(this, player, logout);
  }

  afterSomeoneLeft(player) {
    if (this.party.isLeader(player)) Parties.appointLeader(this.party, player);
    this.refreshTabs();
    if (this.players.size === 0) this.destroy("empty");
    else if (!this.hasLeader()) this.destroy("no-leader");
  }

  /** Someone inside can run the raid: the leader, or a raider who can kick from the channel. */
  hasLeader() {
    for (const player of this.players) {
      if (this.party.isLeader(player)) return true;
      const channel = this.party.channel(player);
      if (channel && channel.rankOf(player) >= channel.kickRank) return true;
    }
    return false;
  }

  destroy(reason) {
    if (this.destroyed) return;
    this.destroyed = true;
    this.timer?.stop?.();
    raids.delete(this);
    if (this.party.raid === this) this.party.raid = null;
    for (const player of [...this.players]) {
      if (reason === "no-leader") player.sendMessage("As there is no one else eligible to kick players from this channel, the raid has been destroyed.");
      this.removePlayer(player, false);
      Shared.fadeMove(player, () => {
        if (this.map?.contains?.(player.getLocation())) this.map.leave(player, false);
        player.moveTo(Shared.loc(Shared.OUTSIDE));
        this.hideRaidHud(player);
      });
    }
    for (const room of this.rooms) room.cleanup();
    Shared.later(this, BUILD_DELAY, () => {
      if (this.map && !this.map.isDestroyed()) this.map.destroy();
    });
  }
}

function all() {
  return [...raids];
}

/** The raid a player logged out of, if it is still going and they were in it from the start. */
function takeRejoin(username) {
  const raid = rejoining.get(username);
  rejoining.delete(username);
  return raid && !raid.destroyed && raid.original.has(username) ? raid : null;
}

module.exports = { ATTR_RAID, STAGE, DEATH, POINTS_PER_DAMAGE, Room, EntranceRoom, Raid, registerRoom, onTick, onComplete, onLeave, onRaidArea: CoxMap.onRaidArea, raidOf, all, takeRejoin, roomTypes };
