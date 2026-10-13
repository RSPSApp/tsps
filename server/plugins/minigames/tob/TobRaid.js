"use strict";

/**
 * A raid in progress: the party, its private copy of the theatre, the room it has reached,
 * the HUD, deaths and the jail, wipes, leaving and coming back after a logout.
 *
 * Wiki ("Theatre of Blood"):
 * - The rooms come in a fixed order. Bosses have 75/87.5/100% of their hitpoints for teams of
 *   up to three, four and five.
 * - The dead wait outside the fight and come back only if the rest of the party completes the
 *   room. If everyone dies, unprotected items go to the retrieval chest (Retrieval.*).
 * - Logging out during a fight counts as a death; logging back in returns the player to their
 *   party, among the dead, while the raid lasts. A logout outside a fight is safe.
 * - Teleports are blocked; only escape crystals get out.
 * Captured: the HUD (28) with its varbits (6440-6449) and scripts (2301, 2306, 2307), the
 * entry, barrier and completion messages, the restore on completing a room ("You feel
 * refreshed as your health is replenished."), the completion jingle (250). Estimates: the
 * room flow (the leader starts each fight, the passage needs the room completed), the jail
 * tiles and their stance.
 */

const Shared = require("./TobShared");
const Parties = require("./TobParties");

const { ROOMS, VARBIT, SCRIPT, INTERFACE } = Shared;

const ATTR_RAID = "tob:raid";
/** Persisted: the raid a player logged out of, and whether it was mid-fight. */
const ATTR_LOGOUT = "tob:logout";
/** RuneLite: TOB_PURGATORY_STANCE, the jail's stance, used as a render set (estimate). */
const PURGATORY_STANCE = 8070;
const JAIL_RENDER = Array(7).fill(PURGATORY_STANCE);
/** The gameframe's inventory and worn equipment tabs, closed while jailed (estimate). */
const JAIL_TABS = [{ uid: (161 << 16) | 79, group: 149 }, { uid: (161 << 16) | 80, group: 387 }];
const WIPE_DELAY = 3;
/** As captured: the message and fade, the move a tick later. */
const ENTER_DELAY = 1;
const ENTER_SOUND = 1952;
/** The room bar's maximum: the bar is in thousandths. */
const BAR_SCALE = 1000;
/** The audio setting holding the music player's mode (0 plays each area's track). */
const MUSIC_MODE_SETTING = 18;
/** The jingle when a room is completed, as captured. */
const ROOM_COMPLETE_JINGLE = 250;

const STAGE = { IDLE: "idle", STARTED: "started", COMPLETED: "completed" };

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
  const { THEATRE, THEATRE_PLANES } = Shared;
  AreaClass = class TheatreOfBloodArea extends PrivateArea {
    constructor(raid) {
      super(THEATRE_PLANES.map((z) => new Boundary(THEATRE.minX, THEATRE.maxX, THEATRE.minY, THEATRE.maxY, z)));
      this.raid = raid;
    }

    getName() {
      return "Theatre of Blood";
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

    process(mobile) {
      this.raid.processOnce();
    }

    canTeleport(player) {
      Shared.statement(player, "You can't teleport from the Theatre of Blood.");
      return false;
    }

    /** Scripted NPCs (an entrance, a phase change) and the jailed don't attack. */
    canAttack(attacker) {
      if (attacker?.__tobScripted) return false;
      if (attacker?.isPlayer?.() && this.raid.member(attacker)?.jailed) return false;
      return null;
    }
  };
  return AreaClass;
}

class Member {
  constructor() {
    /** The room the player is in, or null while still on their way in. */
    this.roomKey = null;
    this.jailed = false;
    this.inFight = false;
    this.deaths = 0;
    /** Where the player stood before crossing into the fight: the jail returns them there. */
    this.beforeBarrier = null;
    this.deathTile = null;
    this.hud = new Map();
    /** Supply points (varbit 6460), and a stamina potion bought at the current chest. */
    this.supplyPoints = 0;
    this.staminaBought = false;
    /** Per room key: damage dealt and deaths, for the supply chest's grading. */
    this.rooms = {};
  }

  roomStats(key) {
    return (this.rooms[key] ??= { damage: 0, deaths: 0, fought: false });
  }
}

// ---------------------------------------------------------------- rooms

/** Shared room behaviour: the fight's stage, barriers, the orator, deaths, cleanup. */
class Room {
  constructor(raid, def) {
    this.raid = raid;
    this.def = def;
    this.stage = STAGE.IDLE;
    this.npcs = new Set();
    this.objects = [];
    this.taskKey = {};
    this.startCycle = 0;
    this.deathCount = 0;
    /** Damage each player dealt in this room, for the MVP and the supply points. */
    this.damage = new Map();
    this.destroyed = false;
  }

  get key() {
    return this.def.key;
  }

  get area() {
    return this.raid.area;
  }

  isStarted() {
    return this.stage === STAGE.STARTED;
  }

  isCompleted() {
    return this.stage === STAGE.COMPLETED;
  }

  /** Called once when the party reaches the room: the orator and the room's own things. */
  build() {
    const orator = this.def.orator;
    if (orator) this.placeObject(orator.id, orator, orator.type, orator.face);
    // As captured, the supply chest after Bloat and Sotetseg stands closed through the fight.
    const chest = this.def.chest;
    if (chest) this.supplyChest = this.placeObject(Shared.OBJECT.SUPPLY_CHEST, { ...chest, z: this.def.entrance.z }, 10, chest.face);
    this.onBuild();
  }

  onBuild() {}

  onStart() {}

  onComplete() {}

  tick() {}

  /** The room's health bar, { kind, current, maximum }, or null to hide it. */
  healthBar() {
    return null;
  }

  later(ticks, action) {
    return Shared.later(this.taskKey, ticks, () => {
      if (!this.destroyed) action();
    });
  }

  repeat(ticks, action) {
    return Shared.repeat(this.taskKey, ticks, () => !this.destroyed && action() !== false);
  }

  placeObject(id, tile, type = 10, face = 0) {
    const { GameObject, ObjectManager } = Shared.core();
    const object = new GameObject(id, Shared.loc(tile), type, face, this.area);
    ObjectManager.register(object, true);
    this.objects.push(object);
    return object;
  }

  /**
   * Spawns one of the room's NPCs, its hitpoints scaled for the party's size and mode.
   * `scripted` NPCs move and attack only as their room drives them.
   */
  spawn(id, tile, { scale = true, face, scripted = false } = {}) {
    const npc = Shared.api().spawnNpc({ id, x: tile.x, y: tile.y, z: tile.z ?? 0, wanderRadius: 0, face });
    if (!npc) return null;
    npc.__skipDefaultRespawn = true;
    npc.__tobRoom = this;
    if (scripted) {
      npc.__tobScripted = true;
      npc.setScriptedMovement?.(true);
      npc.setFlag?.("combat:no-retaliate");
    }
    this.area.add(npc);
    this.npcs.add(npc);
    if (scale) this.raid.scale(npc);
    return npc;
  }

  despawn(npc) {
    if (!npc) return;
    this.npcs.delete(npc);
    this.area.detach(npc);
    Shared.api().removeNpc(npc);
  }

  /** Party members in this room, alive and not jailed, who crossed into the fight. */
  fighters() {
    return this.raid.players.filter((player) => {
      const member = this.raid.member(player);
      return member.roomKey === this.key && member.inFight && !member.jailed && player.getHitpoints() > 0;
    });
  }

  roomPlayers() {
    return this.raid.players.filter((player) => this.raid.member(player).roomKey === this.key);
  }

  start() {
    if (this.stage !== STAGE.IDLE) return;
    this.stage = STAGE.STARTED;
    this.startCycle = Shared.cycle();
    this.onStart();
  }

  /**
   * Completing a room restores everyone (captured message) - hitpoints, prayer, special attack and
   * run energy - frees the jailed and reports the times.
   */
  complete() {
    if (this.stage === STAGE.COMPLETED) return;
    this.stage = STAGE.COMPLETED;
    const raid = this.raid;
    const ticks = Shared.cycle() - (this.startCycle || Shared.cycle());
    raid.totalTicks += ticks;
    const duration = `Duration: <col=ff0000>${Shared.formatTicks(ticks)}</col>`;
    const total = `Total: <col=ff0000>${Shared.formatTicks(raid.totalTicks)}</col>`;
    const message = `Wave '${this.def.name}' ${Shared.MODES[raid.mode].tag} complete!<br>${duration} ${total}`;
    for (const player of raid.players) {
      player.getPacketSender().sendJingle?.(ROOM_COMPLETE_JINGLE, 0);
      player.sendMessage(message);
      raid.restore(player);
      if (raid.member(player).jailed) raid.release(player, this);
    }
    this.onComplete();
    if (this.def.chest) {
      raid.grantSupplyPoints(this);
      this.openSupplyChest();
    }
    raid.refreshHealthBars();
  }

  /** The way through a barrier: into the fight (the leader starts it), or out once it's won. */
  passBarrier(player, barrier) {
    const raid = this.raid;
    const member = raid.member(player);
    const at = Shared.tileOf(player);
    const side = { x: barrier.getLocation().getX(), y: barrier.getLocation().getY(), face: barrier.getFace() };
    if (this.def.entering(side, at)) {
      if (this.isCompleted()) {
        cross(player, side);
        return;
      }
      if (this.stage === STAGE.IDLE) {
        if (!raid.party.isLeader(player)) {
          Shared.statement(player, `Your leader, ${Shared.displayName(raid.party.leader)}, must go first.`);
          return;
        }
        const ask = () => Shared.options(player, "Is your party ready to fight?",
          "Yes, let's begin.", () => this.enterFight(player, side),
          "No, don't start yet.", () => {});
        if (raid.players.every((other) => raid.member(other).roomKey === this.key)) {
          ask();
          return;
        }
        const { DialogueChainBuilder, StatementDialogue, ActionDialogue } = Shared.core();
        player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(
          new StatementDialogue(0, "Some of your party don't seem to have arrived yet.<br>If you proceed, they will be abandoned."),
          new ActionDialogue(1, { execute: ask }),
        ));
        return;
      }
      this.enterFight(player, side);
      return;
    }
    if (this.isStarted() && member.inFight) {
      player.sendMessage("You must stay and fight!");
      Shared.npcSay(player, Shared.NPC.VYRE_ORATOR, "You must stay and fight!");
      return;
    }
    member.inFight = false;
    cross(player, side);
  }

  enterFight(player, side) {
    const member = this.raid.member(player);
    member.roomStats(this.key).fought = true;
    this.start();
    member.beforeBarrier = Shared.tileOf(player);
    member.inFight = true;
    cross(player, side);
    this.raid.refreshHealthBars();
  }

  /** The jail tile for the next death, round the room's tiles (estimates). */
  nextJail() {
    const jails = this.def.jails;
    if (!jails.length) return null;
    return jails[this.deathCount++ % jails.length];
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
    player.getCombat().getHitQueue().addPendingHit(hit, Shared.cycle() + Math.max(0, delay));
    return hit;
  }

  /** Damage a party member dealt to one of this room's NPCs. */
  recordDamage(player, amount) {
    if (amount <= 0) return;
    this.damage.set(player, (this.damage.get(player) ?? 0) + amount);
    this.raid.member(player).roomStats(this.key).damage += amount;
  }

  /** Whoever dealt the most damage here. */
  mvp() {
    let best = null;
    for (const [player, dealt] of this.damage) if (!best || dealt > this.damage.get(best)) best = player;
    return best;
  }

  /** The supply chest after this room (Bloat's and Sotetseg's) opens as the room is won, as captured. */
  openSupplyChest() {
    const chest = this.def.chest;
    if (!chest) return;
    const { ObjectManager } = Shared.core();
    if (this.supplyChest) {
      // Removed for the clients first: the client redraws the whole map square for a removal,
      // and only then reliably shows a loc added there (a lone add can stay invisible).
      ObjectManager.deregister(this.supplyChest, true);
      this.objects = this.objects.filter((object) => object !== this.supplyChest);
    }
    this.supplyChest = this.placeObject(Shared.OBJECT.SUPPLY_CHEST_OPEN, { ...chest, z: this.def.entrance.z }, 10, chest.face);
    for (const player of this.roomPlayers()) {
      player.sendMessage("The Vampyres are impressed by your prowess. <col=ef1020>Check the chest</col> to see how many points they've granted you.");
    }
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

/** Steps through a barrier to the tile on its far side. */
function cross(player, barrier) {
  const at = Shared.tileOf(player);
  const across = barrier.face === 0 || barrier.face === 2
    ? { x: at.x, y: barrier.y + (at.y > barrier.y ? -1 : 1), z: at.z }
    : { x: barrier.x + (at.x > barrier.x ? -1 : 1), y: at.y, z: at.z };
  player.getMovementQueue().reset();
  player.moveTo(Shared.loc(across));
}

// ---------------------------------------------------------------- the raid

class Raid {
  constructor(party) {
    this.id = nextRaidId++;
    this.party = party;
    party.raid = this;
    this.mode = party.mode;
    this.players = [];
    this.members = new Map();
    /** Members who logged out, by username: { fight } (see ATTR_LOGOUT). */
    this.away = new Map();
    this.size = party.members.length;
    this.area = new (areaClass())(this);
    this.room = null;
    this.totalTicks = 0;
    this.lastCycle = -1;
    this.over = false;
    this.failed = false;
    for (const player of party.members) this.add(player);
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

  add(player) {
    if (!this.players.includes(player)) this.players.push(player);
    player.setAttribute(ATTR_RAID, this);
    this.member(player);
  }

  /** Wiki: hitpoints by team size (Shared.MODES); the team is whoever started the raid. */
  scale(npc) {
    const base = npc.getDefinition()?.getHitpoints?.() ?? npc.getHitpoints();
    // Rounded down: the Wiki's 11-hitpoint nylocas have 9 for four players and 8 for three.
    const hitpoints = Math.max(1, Math.floor(base * Shared.MODES[this.mode].hitpoints(this.size)));
    npc.setMaxHitpoints?.(hitpoints);
    npc.setHitpoints(hitpoints);
  }

  buildRoom(key) {
    const RoomClass = roomTypes.get(key) ?? Room;
    this.room?.destroy();
    this.room = new RoomClass(this, ROOMS[key]);
    this.room.build();
    return this.room;
  }

  /** The leader steps in first and the theatre opens; everyone else follows the same way. */
  enter(player) {
    if (!this.players.includes(player)) return;
    if (!this.room) this.buildRoom("MAIDEN");
    Shared.sound(player, ENTER_SOUND);
    player.sendMessage(`You enter the Theatre of Blood ${Shared.MODES[this.mode].tag}...`);
    Shared.fade(player, 0, "The Theatre awaits...");
    Shared.later(player, ENTER_DELAY, () => this.arrive(player, this.room));
  }

  /** Puts a player at a room's entrance, faded in with its name. */
  arrive(player, room) {
    if (this.over || !this.players.includes(player)) return;
    const member = this.member(player);
    if (player.getArea?.() !== this.area) this.area.enter(player);
    player.moveTo(Shared.loc(room.def.entrance));
    member.roomKey = room.key;
    member.inFight = false;
    Shared.fade(player, 255, room.def.name);
    this.openHud(player);
    this.playMusic(player, room);
    this.redrawObjects(player, room);
    room.onArrive?.(player);
  }

  /**
   * Workaround for a client bug: a loc added on its own can stay invisible (though clickable)
   * until the client redraws its whole map square, which it does for a removal. So the room's
   * placed objects (the chests) are re-sent to an arriving player as a removal, then an add.
   */
  redrawObjects(player, room) {
    Shared.later(player, 1, () => {
      if (!this.players.includes(player) || this.member(player).roomKey !== room.key) return;
      const sender = player.getPacketSender();
      for (const object of room.objects) {
        sender.sendObjectRemoval(object);
        sender.sendObject(object);
      }
    });
  }

  /**
   * Each room's track, as captured on arrival. Sent a tick later so it follows the region's
   * own music, which the move to the room would otherwise play (Xarpus' region lists another).
   */
  playMusic(player, room) {
    const track = room.def.music;
    if (!track) return;
    Shared.later(player, 1, () => {
      if (!this.players.includes(player) || this.member(player).roomKey !== room.key) return;
      Shared.api().emitCustomEvent("music:unlock-track", { player, trackId: track });
      // Only in the music player's area mode, as the region music.
      if ((player.getAudioSettings?.()?.[MUSIC_MODE_SETTING] ?? 0) === 0) player.getPacketSender().sendSong(track);
    });
  }

  /** A room's passage: on to the next room once this one is completed. */
  advance(player, { force = false } = {}) {
    const room = this.room;
    const member = this.member(player);
    if (!room || member.roomKey !== room.key || !room.def.next) return;
    if (!room.isCompleted() && !force) {
      player.sendMessage("You can't proceed until the challenge is complete.");
      return;
    }
    const next = this.buildRoom(room.def.next);
    for (const other of this.players) {
      if (other !== player) other.sendMessage(`${Shared.displayName(player)} has advanced to Wave ${next.def.wave}. Join ${Shared.objectPronoun(player)}...`);
    }
    this.follow(player);
  }

  /** A player left behind walks through the passage into the room the party has reached. */
  follow(player) {
    const room = this.room;
    Shared.fadeRed(player, "");
    Shared.later(player, ENTER_DELAY, () => this.arrive(player, room));
  }

  // ---------------------------------------------------------------- tick

  processOnce() {
    const now = Shared.cycle();
    if (now === this.lastCycle || this.over) return;
    this.lastCycle = now;
    if (this.room && !this.room.destroyed) this.room.tick();
    this.refreshHealthBars();
    this.refreshStatuses();
  }

  // ---------------------------------------------------------------- HUD

  /** The party HUD (28) with the names, the viewer's slot and each slot's state, as captured. */
  openHud(player) {
    const sender = player.getPacketSender();
    sender.sendSubInterface(Shared.OVERLAY_HUD_UID, INTERFACE.PARTY_HUD, 1);
    sender.sendVarbit(VARBIT.PARTY_STATE, 2);
    sender.sendVarbit(VARBIT.MY_SLOT, this.players.indexOf(player) + 1);
    const names = Array.from({ length: Shared.MAX_PARTY_SIZE }, (_, i) => (this.players[i] ? Shared.displayName(this.players[i]) : ""));
    sender.sendClientScript(SCRIPT.HUD_NAMES, ...names);
    this.member(player).hud.clear();
    this.refreshStatuses();
    this.refreshHealthBars();
  }

  closeHud(player) {
    const sender = player.getPacketSender();
    sender.sendVarbit(VARBIT.HEALTH_BAR, Shared.HEALTH_BAR.REMOVED);
    sender.sendVarbit(VARBIT.PARTY_STATE, 0);
    for (let i = 0; i < Shared.MAX_PARTY_SIZE; i++) sender.sendVarbit(VARBIT.SLOT_BASE + i, 0);
  }

  /** Each slot: 1-27 health, 30 dead or jailed, 31 elsewhere (the captured values). */
  statusOf(player) {
    const member = this.member(player);
    if (!this.room || member.roomKey !== this.room.key) return 31;
    if (member.jailed || player.getHitpoints() <= 0) return 30;
    const { Skill } = Shared.core();
    const max = Math.min(99, Math.max(1, player.getSkillManager().getMaxLevel(Skill.HITPOINTS)));
    const current = Math.min(99, player.getHitpoints());
    return 1 + Math.round(26 * (current / max));
  }

  refreshStatuses() {
    const statuses = Array.from({ length: Shared.MAX_PARTY_SIZE }, (_, i) => (this.players[i] ? this.statusOf(this.players[i]) : 0));
    for (const viewer of this.players) {
      const member = this.member(viewer);
      statuses.forEach((status, i) => {
        const value = this.players[i] === viewer ? 1 : status;
        if (member.hud.get(i) === value) return;
        member.hud.set(i, value);
        viewer.getPacketSender().sendVarbit(VARBIT.SLOT_BASE + i, value);
      });
    }
  }

  /**
   * Varbits 6447-6449 (tob_client_waveprogress_type/val/max) carry the room's bar. As captured,
   * the maximum is always 1000 and the value is the boss's hitpoints in thousandths.
   */
  refreshHealthBars() {
    const bar = this.room?.isStarted() ? this.room.healthBar() : null;
    const value = bar && bar.current > 0
      ? [bar.kind ?? Shared.HEALTH_BAR.REGULAR, Math.max(1, Math.round((BAR_SCALE * bar.current) / Math.max(1, bar.maximum))), BAR_SCALE]
      : [Shared.HEALTH_BAR.REMOVED, 0, 0];
    const key = value.join(",");
    for (const player of this.players) {
      const member = this.member(player);
      const shown = member.roomKey === this.room?.key ? key : "0,0,0";
      if (member.hud.get("bar") === shown) continue;
      member.hud.set("bar", shown);
      const [kind, current, maximum] = shown.split(",").map(Number);
      const sender = player.getPacketSender();
      sender.sendVarbit(VARBIT.HEALTH_BAR, kind);
      if (kind !== Shared.HEALTH_BAR.REMOVED) sender.sendVarbit(VARBIT.HEALTH_CURRENT, current).sendVarbit(VARBIT.HEALTH_MAXIMUM, maximum);
    }
  }

  // ---------------------------------------------------------------- supplies

  /** Each player's points for the chest after `room`; the onion if they died in both rooms. */
  grantSupplyPoints(room) {
    const keys = SUPPLY_ROOMS[room.key] ?? [room.key];
    for (const player of this.players) {
      const member = this.member(player);
      member.staminaBought = false;
      member.onion = keys.every((key) => member.roomStats(key).deaths > 0);
      if (member.onion) continue;
      const [min, max] = SUPPLY_BANDS[supplyGrade(this, player, keys)];
      member.supplyPoints += Shared.random(min, max);
      player.getPacketSender().sendVarbit(VARBIT.SUPPLY_POINTS, member.supplyPoints);
    }
  }

  // ---------------------------------------------------------------- deaths

  /**
   * A death in the theatre. In a fight that isn't won, the player waits in the room's jail
   * until it is (or everyone is down); otherwise they get up at the entrance.
   */
  onPlayerDied(player) {
    const member = this.member(player);
    const room = this.room;
    if (!room || member.roomKey !== room.key || !room.isStarted() || !member.inFight) {
      player.moveTo(Shared.loc(this.room?.def.entrance ?? Shared.OUTSIDE));
      return;
    }
    member.deaths++;
    member.roomStats(room.key).deaths++;
    member.deathTile = Shared.tileOf(player);
    Shared.fade(player, 255, "If your party survives the wave, you will respawn.");
    this.jail(player, room);
    this.checkWipe();
  }

  jail(player, room) {
    const member = this.member(player);
    const tile = room.nextJail() ?? room.def.entrance;
    member.jailed = true;
    member.inFight = false;
    player.moveTo(Shared.loc(tile, tile.z ?? room.def.entrance.z));
    player.getMovementQueue().setBlockMovement(true).reset();
    player.setUntargetable(true);
    player.getCombat().reset();
    player.setRenderAnimations?.(JAIL_RENDER);
    player.getUpdateFlag().flag(Shared.core().Flag.APPEARANCE);
    const sender = player.getPacketSender();
    for (const { uid } of JAIL_TABS) sender.closeSubInterface(uid);
  }

  /** Out of the jail, back where they crossed into the fight (Verzik: where they fell). */
  release(player, room) {
    const member = this.member(player);
    if (!member.jailed) return;
    member.jailed = false;
    player.getMovementQueue().setBlockMovement(false);
    player.setUntargetable(false);
    player.setRenderAnimations?.(null);
    player.getUpdateFlag().flag(Shared.core().Flag.APPEARANCE);
    const sender = player.getPacketSender();
    for (const { uid, group } of JAIL_TABS) sender.sendSubInterface(uid, group, 1);
    player.getInventory().refreshItems();
    player.getEquipment().refreshItems();
    const back = room.key === "VERZIK" ? member.deathTile : member.beforeBarrier;
    player.moveTo(Shared.loc(back ?? room.def.entrance));
  }

  /** Hitpoints, prayer, special attack and run energy back to full, with the captured message. */
  restore(player) {
    const { Skill } = Shared.core();
    const skills = player.getSkillManager();
    for (const skill of [Skill.HITPOINTS, Skill.PRAYER]) {
      if (skills.getCurrentLevel(skill) < skills.getMaxLevel(skill)) skills.setCurrentLevel(skill, skills.getMaxLevel(skill), true);
    }
    player.setSpecialPercentage?.(100);
    Shared.core().CombatSpecial?.updateBar?.(player);
    player.setRunEnergy?.(100);
    player.getPacketSender().sendRunEnergy?.();
    player.sendMessage("You feel refreshed as your health is replenished.");
  }

  /** The raid fails once every member is jailed (or away after dying). */
  checkWipe() {
    if (this.over || this.players.length === 0) return;
    if (this.players.some((player) => !this.member(player).jailed)) return;
    Shared.later(this, WIPE_DELAY, () => {
      if (!this.over && this.players.every((player) => this.member(player).jailed)) this.fail();
    });
  }

  fail() {
    if (this.over) return;
    this.failed = true;
    const Retrieval = require("./Retrieval.TheatreOfBlood");
    for (const player of [...this.players]) {
      Retrieval.storeAfterWipe(player);
      player.sendMessage("A magical chest has retrieved some of your items. You can collect them from it outside of the Theatre of Blood.");
      this.leave(player, "Your party has failed.", { heal: true });
    }
  }

  // ---------------------------------------------------------------- leaving

  /** Out of the theatre to Ver Sinhaza (resigning, an escape crystal, the end, a wipe). */
  leave(player, text, { heal = false } = {}) {
    if (!this.players.includes(player)) return;
    Shared.fadeRed(player, text);
    Shared.later(player, ENTER_DELAY, () => {
      this.remove(player);
      if (player.getArea?.() === this.area) this.area.leave(player, false);
      player.moveTo(Shared.loc(Shared.OUTSIDE));
      Shared.fade(player, 200, text);
      if (heal) this.restore(player);
    });
  }

  /** Takes a player out of the raid and their party. */
  remove(player) {
    const member = this.members.get(player);
    Shared.removeDawnbringer(player);
    if (member?.jailed) {
      member.jailed = false;
      player.getMovementQueue().setBlockMovement(false);
      player.setUntargetable(false);
      player.setRenderAnimations?.(null);
      player.getUpdateFlag().flag(Shared.core().Flag.APPEARANCE);
      const sender = player.getPacketSender();
      for (const { uid, group } of JAIL_TABS) sender.sendSubInterface(uid, group, 1);
    }
    this.players = this.players.filter((other) => other !== player);
    this.members.delete(player);
    player.setAttribute(ATTR_RAID, null);
    player.setAttribute(ATTR_LOGOUT, null);
    this.closeHud(player);
    this.party.remove(player);
    for (const other of this.players) this.openHud(other);
    if (this.players.length === 0 && this.away.size === 0) this.dispose();
    else this.checkWipe();
  }

  onAreaLeave(player, logout) {
    if (!this.players.includes(player)) return;
    if (logout) this.onLogout(player);
  }

  /**
   * Wiki: a logout during a fight is a death; outside one it's safe. Either way the player
   * returns to the party on logging back in, while the raid lasts.
   */
  onLogout(player) {
    const member = this.member(player);
    const fight = !!this.room?.isStarted() && member.inFight && !member.jailed;
    if (fight) member.deaths++;
    this.away.set(player.getUsername(), { fight: fight || member.jailed });
    player.setAttribute(ATTR_LOGOUT, { raid: this.id, fight: fight || member.jailed });
    this.players = this.players.filter((other) => other !== player);
    this.members.delete(player);
    player.setAttribute(ATTR_RAID, null);
    for (const other of this.players) this.openHud(other);
    if (this.players.length === 0) {
      // Nobody left inside: the raid is over for everyone away too.
      this.dispose();
      return;
    }
    this.checkWipe();
  }

  /** Back from a logout: into the room the party is in, among the dead if they died. */
  rejoin(player) {
    const away = this.away.get(player.getUsername());
    if (!away || this.over) return false;
    this.away.delete(player.getUsername());
    player.setAttribute(ATTR_LOGOUT, null);
    this.add(player);
    if (this.party.members.every((member) => member.getUsername() !== player.getUsername())) this.party.members.push(player);
    else this.party.members = this.party.members.map((member) => (member.getUsername() === player.getUsername() ? player : member));
    this.area.enter(player);
    const room = this.room;
    if (away.fight && room?.isStarted()) {
      this.member(player).roomKey = room.key;
      this.jail(player, room);
    } else {
      this.arrive(player, room);
    }
    this.openHud(player);
    Shared.fade(player, 255, "You have rejoined your party.");
    return true;
  }

  dispose() {
    if (this.over) return;
    this.over = true;
    this.room?.destroy();
    this.room = null;
    if (!this.area.isDestroyed()) this.area.destroy();
    raids.delete(this.id);
    // A party ends with its raid: leaving takes each member out of it.
    this.party.raid = null;
    this.party.dispose();
  }
}

/** The leader opens the theatre for the party. */
function begin(leader) {
  const party = Parties.partyOf(leader);
  if (!party) return null;
  if (party.raid) return party.raid;
  const raid = new Raid(party);
  for (const member of raid.players) {
    if (member === leader) continue;
    member.getPacketSender().sendVarbit(VARBIT.PARTY_STATE, 2);
    member.sendMessage(`${Shared.displayName(leader)} has entered the Theatre of Blood ${Shared.MODES[raid.mode].tag}. Step inside to join ${Shared.objectPronoun(leader)}...`);
  }
  return raid;
}

function byId(id) {
  return raids.get(id) ?? null;
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

/**
 * Supply points for the chest after Bloat and Sotetseg (Wiki, "Theatre of Blood/Strategies"):
 * 10-13 above average, 8-11 average, 6-9 below; dying in both rooms since the last chest
 * leaves only an onion. Performance here is a player's share of the damage dealt in those two
 * rooms against the team's average, a band lower per death (an estimate: the Wiki gives the
 * bands, not how they're judged).
 */
const SUPPLY_BANDS = [[6, 9], [8, 11], [10, 13]];
const SUPPLY_ROOMS = { BLOAT: ["MAIDEN", "BLOAT"], SOTETSEG: ["NYLOCAS", "SOTETSEG"] };

function supplyGrade(raid, player, keys) {
  const damageOf = (other) => keys.reduce((sum, key) => sum + raid.member(other).roomStats(key).damage, 0);
  const average = raid.players.reduce((sum, other) => sum + damageOf(other), 0) / Math.max(1, raid.players.length);
  const share = average > 0 ? damageOf(player) / average : 1;
  let grade = share >= 1.25 ? 2 : share <= 0.75 ? 0 : 1;
  for (const key of keys) grade -= raid.member(player).roomStats(key).deaths;
  return Math.max(0, grade);
}

module.exports = {
  STAGE, ATTR_RAID, ATTR_LOGOUT, Room, Raid, registerRoom, raidOf, begin, byId, raids, cross, styleMethod,
  SUPPLY_BANDS, supplyGrade,
};
