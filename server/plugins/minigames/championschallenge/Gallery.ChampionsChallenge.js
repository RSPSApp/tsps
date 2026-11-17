"use strict";

/**
 * The Champions' Guild basement, one per player, as captured (rsprox recordings 2180, 3219):
 * - the trapdoor's "Climb-down" moves the player, a tick later, into their own copy of the
 *   basement by the ladder (3189, 9758), with "Title Fight" playing; the ladder takes them back
 *   up beside the trapdoor (3190, 3356);
 * - the gallery holds Larxus and the six seated Mystery figures; a challenge accepted from
 *   Larxus brings its champion into the arena (3168, 9758) and opens the Champion Statue, the
 *   gate sound playing;
 * - the open statue's "Climb-down" puts the player behind it (3182, 9758); the portcullis lets
 *   them through to the arena (3180, 9758) with "Victory is Mine", or back with "Title Fight",
 *   the grill's loc animation and the gate sound each way;
 * - the arena ladder puts them back in the gallery (3185, 9758) and closes the statue: the fight
 *   is over, won or not (Wiki: leaving keeps the scroll).
 * Teleports are refused ("There's a ladder for a reason."); leaving, dying or logging out ends the
 * basement, and a death's grave goes up on the guild's ground floor (Wiki).
 */
const Common = require("./Common.ChampionsChallenge");
const Rules = require("./Rules.ChampionsChallenge");
const Combat = require("./Combat.ChampionsChallenge");

const CHUNK = 8;
const TELEPORT_REFUSAL = "There's a ladder for a reason.";

/** player -> their basement while they are in it. */
const sessions = new Map();

let AreaClass = null;

function areaClass() {
  if (AreaClass) return AreaClass;
  const { TemplatedInstanceArea } = Common.core;
  AreaClass = class ChampionsBasement extends TemplatedInstanceArea {
    constructor() {
      const { chunks } = Common.DATA.instance;
      super(chunks, chunks);
      this.session = null;
    }

    getName() {
      return "Champions' Challenge";
    }

    allowSummonPet() {
      return false;
    }

    canTeleport(player) {
      if (this.session?.player !== player) return null;
      Common.larxusSays(player, TELEPORT_REFUSAL);
      return false;
    }

    canAttack(attacker, target, method) {
      return Rules.canAttack(this.session, attacker, target, method);
    }

    process(mobile) {
      if (this.session?.champion === mobile) Combat.processChampion(this.session, mobile);
    }

    destroy() {
      if (this.isDestroyed()) return;
      for (const entity of [...this.entities]) {
        if (!entity.isNpc?.()) continue;
        this.detach(entity);
        Common.api.removeNpc(entity);
      }
      super.destroy();
    }

    /** Logging out puts the player by the trapdoor before they're saved. */
    postLeave(mobile, logout) {
      const player = mobile.isPlayer?.() && this.session?.player === mobile.getAsPlayer() ? mobile.getAsPlayer() : null;
      if (player && logout) player.setLocation(Common.toLocation(Common.DATA.tiles.outside));
      if (player) this.session.end();
      super.postLeave(mobile, logout);
    }
  };
  return AreaClass;
}

class Session {
  constructor(player) {
    this.player = player;
    this.area = new (areaClass())();
    this.area.session = this;
    const { sourceChunkX, sourceChunkY, chunks, planes } = Common.DATA.instance;
    for (let plane = 0; plane < planes; plane++) {
      this.area.copySquare(chunks, sourceChunkX, sourceChunkY, plane, 0, 0, plane, 0);
    }
    /** The champion a challenge was accepted for, until the fight is over. */
    this.challenge = null;
    /** The champion Larxus last offered (a scroll used on him, Leon's challenge). */
    this.offer = null;
    /** A scroll for a champion already beaten, which Larxus's "void" line takes. */
    this.voidScroll = null;
    this.champion = null;
    this.ended = false;
  }

  /** The instance's copy of a basement tile. */
  tile([x, y, z]) {
    const { sourceChunkX, sourceChunkY } = Common.DATA.instance;
    return this.area.tile(x - sourceChunkX * CHUNK, y - sourceChunkY * CHUNK, z ?? 0);
  }

  /** The basement tile an instance tile copies. */
  worldTile(location) {
    const { sourceChunkX, sourceChunkY } = Common.DATA.instance;
    return [location.getX() - this.area.getBaseX() + sourceChunkX * CHUNK, location.getY() - this.area.getBaseY() + sourceChunkY * CHUNK];
  }

  inArena(location) {
    const [x, y] = this.worldTile(location);
    const { minX, maxX, minY, maxY } = Common.DATA.arena;
    return x >= minX && x <= maxX && y >= minY && y <= maxY;
  }

  spawn(id, [x, y], extra = {}) {
    const at = this.tile([x, y, 0]);
    const npc = Common.api.spawnNpc({ id, x: at.getX(), y: at.getY(), z: at.getZ(), owner: this.player, wanderRadius: 0, ...extra });
    if (!npc) return null;
    npc.__skipDefaultRespawn = true;
    npc.__championsChallenge = this;
    this.area.add(npc);
    return npc;
  }

  setUp() {
    const { larxus, figures } = Common.DATA.npcs;
    this.spawn(larxus.id, larxus.tile, { wanderRadius: larxus.wanderRadius });
    for (const figure of figures) this.spawn(figure.id, figure.tile);
  }

  /** The loc on a basement tile, as this instance has it now. */
  objectAt(id, tile) {
    const at = this.tile(tile);
    const placed = this.area.getObjects?.().find((object) => object.getId() === id && object.getLocation().equals(at));
    return placed ?? this.area.getTemplateObjects(at).find((object) => object.getId() === id) ?? null;
  }

  /** Swaps the statue for its open or closed form. */
  setStatue(open) {
    const { locs, tiles } = Common.DATA;
    const from = this.objectAt(open ? locs.statueClosed : locs.statueOpen, tiles.statue);
    if (!from) return;
    const { GameObject, ObjectManager } = Common.core;
    ObjectManager.deregister(from, true);
    this.area.detach?.(from);
    const to = new GameObject(open ? locs.statueOpen : locs.statueClosed, from.getLocation().clone(), from.getType(), from.getFace(), this.area);
    ObjectManager.register(to, true);
  }

  /** "Yes, let me at him!": the champion waits in the arena and the statue opens. */
  accept(champion) {
    this.challenge = champion;
    this.offer = null;
    this.removeChampion();
    this.champion = this.spawn(champion.npc, Common.DATA.tiles.championSpawn);
    this.setStatue(true);
    this.player.getPacketSender().sendSound(Common.DATA.sounds.gate, 1, 0);
  }

  removeChampion() {
    const npc = this.champion;
    this.champion = null;
    if (npc?.isRegistered?.() && npc.getHitpoints() > 0) {
      this.area.detach?.(npc);
      Common.api.removeNpc(npc);
    }
  }

  /** The fight is over: won, or left by the arena ladder. */
  endFight() {
    this.challenge = null;
    this.removeChampion();
    this.setStatue(false);
  }

  end() {
    if (this.ended) return;
    this.ended = true;
    sessions.delete(this.player);
    this.player.setAttribute(Common.INSIDE_ATTRIBUTE, false);
    rescueScrolls(this);
    if (!this.area.isDestroyed()) this.area.destroy();
  }
}

/**
 * Wiki: a champion's scroll dropped before the fight can be picked up after it. The basement is
 * a private instance that is torn down on leaving, so a scroll left on its floor would otherwise
 * vanish with it: take it back, or place it beside the trapdoor when the pack is full.
 */
function rescueScrolls(session) {
  const { World, ItemOnGroundManager, Item } = Common.core;
  if (typeof World?.getItems !== "function" || typeof ItemOnGroundManager?.deregister !== "function" || !Item) return;
  const scrollIds = new Set(Common.SCROLL_CHAMPIONS.map((champion) => champion.scroll));
  const player = session.player;
  const outside = Common.toLocation(Common.DATA.tiles.outside);
  for (const ground of [...World.getItems()]) {
    // Native pickup credits the inventory and only marks the ground source pending until the
    // next ground-item pass; recovering it here would award the same scroll twice.
    if (ground?.isPendingRemoval?.() || ground?.getPrivateArea?.() !== session.area) continue;
    const item = ground.getItem?.();
    if (!item || !scrollIds.has(item.getId())) continue;
    if (player.getInventory().getFreeSlots() > 0) {
      ItemOnGroundManager.deregister(ground);
      player.getInventory().adds(item.getId(), item.getAmount());
    } else {
      // The same stack, moved out: it keeps its timer and its owner-only time rather than starting both again.
      ItemOnGroundManager.relocate(ground, outside, null);
    }
  }
}

const sessionOf = (player) => sessions.get(player) ?? null;
const sessionOfNpc = (npc) => npc?.__championsChallenge ?? null;

function playTrack(player, trackId) {
  Common.api.emitCustomEvent("music:unlock-track", { player, trackId });
  player.getPacketSender().sendSong(trackId);
}

/** The basement trapdoor: the player's own copy of the basement, a tick later. */
function climbDownTrapdoor({ player, objectId }) {
  if (objectId !== Common.DATA.locs.trapdoorOpen) return false;
  if (sessionOf(player)) return true;
  player.getMovementQueue().reset();
  Common.later(1, () => {
    if (!player.isRegistered() || sessionOf(player)) return;
    const session = new Session(player);
    sessions.set(player, session);
    session.area.enter(player);
    player.moveTo(session.tile(Common.DATA.tiles.basementArrive));
    player.setAttribute(Common.INSIDE_ATTRIBUTE, true);
    session.setUp();
    Common.sendVarp(player);
    playTrack(player, Common.DATA.music.basement);
  });
  return true;
}

/** The gallery ladder: back up beside the trapdoor. */
function climbUpLadder({ player, objectId }) {
  const session = sessionOf(player);
  if (!session) return false;
  if (objectId === Common.DATA.locs.arenaLadder) return climbArenaLadder(session);
  if (objectId !== Common.DATA.locs.ladderUp) return false;
  player.moveTo(Common.toLocation(Common.DATA.tiles.outside));
  session.end();
  return true;
}

/** The arena ladder: back into the gallery; the fight is over. */
function climbArenaLadder(session) {
  session.player.moveTo(session.tile(Common.DATA.tiles.arenaLadderLanding));
  session.endFight();
  return true;
}

/** The closed statue: Larxus wants a challenge arranged first. */
function openStatue({ player, objectId }) {
  const session = sessionOf(player);
  if (!session || objectId !== Common.DATA.locs.statueClosed) return false;
  if (session.challenge) session.setStatue(true);
  else Common.larxusVariant(player, "climbing-down-the-champion-statue-trying-to-climb-down-champion-statue-without-giving-larxus-a-champion-scroll");
  return true;
}

/** The open statue: down behind it, once the player carries only what the fight allows. */
function climbDownStatue({ player, objectId }) {
  const session = sessionOf(player);
  if (!session || objectId !== Common.DATA.locs.statueOpen) return false;
  if (!session.challenge) {
    Common.larxusVariant(player, "climbing-down-the-champion-statue-trying-to-climb-down-champion-statue-without-giving-larxus-a-champion-scroll");
    return true;
  }
  const refusal = Rules.entryRefusal(session.challenge, player);
  if (refusal) {
    Common.larxusVariant(player, refusal);
    return true;
  }
  Rules.prepare(session.challenge, player);
  player.moveTo(session.tile(Common.DATA.tiles.statueLanding));
  return true;
}

/** The portcullis between the statue and the arena, either way. */
function openPortcullis({ player, object, objectId }) {
  const session = sessionOf(player);
  if (!session || objectId !== Common.DATA.locs.portcullis) return false;
  const { tiles, music, sounds, anims } = Common.DATA;
  const [x] = session.worldTile(player.getLocation());
  const intoArena = x >= tiles.corridorSide[0];
  player.getPacketSender().sendObjectAnimation(object, new Common.core.Animation(anims.portcullis));
  player.getPacketSender().sendSound(sounds.gate, 1, 0);
  player.moveTo(session.tile(intoArena ? tiles.arenaSide : tiles.corridorSide));
  playTrack(player, intoArena ? music.arena : music.basement);
  const champion = session.champion;
  if (intoArena && champion?.getHitpoints() > 0 && session.challenge?.aggressive) champion.getCombat().attack(player);
  return true;
}

/** A player saved inside (the server stopped while they were there) comes back by the trapdoor. */
function recoverOnLogin({ player }) {
  if (!player.getAttribute(Common.INSIDE_ATTRIBUTE) || sessionOf(player)) return;
  player.setAttribute(Common.INSIDE_ATTRIBUTE, false);
  player.moveTo(Common.toLocation(Common.DATA.tiles.outside));
}

/** Wiki: a death in the arena leaves the grave on the guild's ground floor by the trapdoor. */
function graveByTrapdoor(request) {
  if (!sessionOf(request.player)) return;
  const [x, y, z] = Common.DATA.tiles.grave;
  request.tile = { x, y, z };
}

function attachGallery(api) {
  api.persistAttribute(Common.INSIDE_ATTRIBUTE, false);
  api.onObjectInteraction("Trapdoor", { "Climb-down": climbDownTrapdoor });
  api.onObjectInteraction("Ladder", { "Climb-up": climbUpLadder });
  api.onObjectInteraction("Champion Statue", { Open: openStatue, "Climb-down": climbDownStatue });
  api.onObjectInteraction("Portcullis", { Open: openPortcullis });
  api.onPlayerLogin(recoverOnLogin);
  api.onCustomEvent("gravestones:grave-location", graveByTrapdoor);
}

module.exports = { attachGallery, rescueScrolls, sessionOf, sessionOfNpc };
