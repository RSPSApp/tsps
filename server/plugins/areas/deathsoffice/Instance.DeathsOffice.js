"use strict";

/**
 * Each visit to Death's Office is a private copy of it with its own Death. As captured (rsprox
 * recording 4266, Lumbridge):
 * - the portal: overlay_portal over the game screen (its script with model 39504 and colour
 *   4128927) and sound 3952 on the click's tick, the teleport into the copy (x 3160-3191,
 *   y 5720-5735, planes 0-1) two ticks later with Rest in Peace (midi 679) and the swirl's
 *   removal, the overlay closed a tick after;
 * - the player lands facing Death at (3171, 5726) and walks to his desk, where he greets them
 *   (rsprox recordings 86 and 89: about 5 ticks after the portal's sound);
 * - logging out inside brings the player back to a new copy (the Wiki), at (3173, 5726);
 * - dropping an item asks first: "Are you sure you want to put that down here?<br>If you leave,
 *   it'll be lost.", then "Put it down." / "Don't put it down." (rsprox recording 86); once the
 *   player puts something down, later drops in that visit don't ask.
 */
const Common = require("./Common.DeathsOffice");

const CHUNK = 8;
const INSIDE_ATTRIBUTE = "deaths-office:inside";
const REST_IN_PEACE = 679;
const PORTAL_TELEPORT_TICKS = 2;
const DESK_WALK_TICKS = 10;
const WALK_AFTER_MOVE_TICKS = 2;
const DROP_QUESTION = "Are you sure you want to put that down here?<br>If you leave, it'll be lost.";

/** Per player: their office while they are in it. */
const sessions = new Map();
let OfficeClass = null;
let greet = () => {};
let leaving = () => {};

function officeClass() {
  if (OfficeClass) return OfficeClass;
  const { TemplatedInstanceArea } = Common.core();
  OfficeClass = class DeathsOffice extends TemplatedInstanceArea {
    constructor() {
      const { widthChunks, heightChunks } = Common.DATA.instance;
      super(widthChunks, heightChunks);
      this.session = null;
    }

    getName() {
      return "Death's Office";
    }

    allowSummonPet() {
      return false;
    }

    /** Death and anything put down go with the copy. */
    destroy() {
      if (this.isDestroyed()) return;
      for (const entity of [...this.entities]) {
        if (!entity.isNpc?.()) continue;
        this.detach(entity);
        Common.api().removeNpc(entity);
      }
      super.destroy();
    }

    /**
     * Leaving by any route ends the copy. Logging out keeps the player "inside", at the office's
     * own tile, so the next login builds a new copy around them.
     */
    postLeave(mobile, logout) {
      const player = mobile.isPlayer?.() && this.session?.player === mobile.getAsPlayer() ? mobile.getAsPlayer() : null;
      if (player && logout) player.setLocation(Common.location(Common.DATA.loginArrival));
      if (player) this.session.end(!logout);
      super.postLeave(mobile, logout);
    }
  };
  return OfficeClass;
}

class Session {
  constructor(player) {
    this.player = player;
    this.area = new (officeClass())();
    this.area.session = this;
    this.death = null;
    this.dropAsked = false;
    this.ended = false;
    const { sourceChunkX, sourceChunkY, widthChunks, heightChunks, planes } = Common.DATA.instance;
    for (let plane = 0; plane < planes; plane++) {
      for (let cx = 0; cx < widthChunks; cx++) {
        for (let cy = 0; cy < heightChunks; cy++) {
          this.area.setChunk(plane, cx, cy, { sourceChunkX: sourceChunkX + cx, sourceChunkY: sourceChunkY + cy, sourcePlane: plane, rotation: 0 });
        }
      }
    }
  }

  /** The copy's tile for one of the office's own. */
  tile([x, y, z = 0]) {
    const { sourceChunkX, sourceChunkY } = Common.DATA.instance;
    return this.area.tile(x - sourceChunkX * CHUNK, y - sourceChunkY * CHUNK, z);
  }

  spawnDeath() {
    const { tile, face } = Common.DATA.death;
    const at = this.tile(tile);
    const npc = Common.api().spawnNpc({ id: Common.ID.death, x: at.getX(), y: at.getY(), z: at.getZ(), owner: this.player, wanderRadius: 0, face });
    if (!npc) return;
    npc.__skipDefaultRespawn = true;
    this.area.add(npc);
    this.death = npc;
  }

  end(left = true) {
    if (this.ended) return;
    this.ended = true;
    sessions.delete(this.player);
    if (left) {
      this.player.setAttribute(INSIDE_ATTRIBUTE, null);
      leaving(this.player);
    }
    if (!this.area.isDestroyed()) this.area.destroy();
  }
}

function sessionOf(player) {
  return sessions.get(player) ?? null;
}

function inOffice(player) {
  return sessionOf(player) != null;
}

/** The player's Death, when they are in their office. */
function deathOf(player) {
  return sessionOf(player)?.death ?? null;
}

/** The copy's tile for one of the office's own, for the player's office. */
function tileOf(player, tile) {
  return sessionOf(player)?.tile(tile) ?? null;
}

// ---------------------------------------------------------------- the portal

function portalOverlay(player) {
  const { COMPONENT, PORTAL, SCRIPT } = Common;
  player.getPacketSender().sendSubInterface(COMPONENT.overlayAtmosphere, Common.ID.portalInterface, Common.OVERLAY, {
    postScripts: [{ scriptId: SCRIPT.overlayPortal, args: [COMPONENT.portalBackground, COMPONENT.portalForeground, PORTAL.model, PORTAL.colour, -1, -1] }],
  });
  Common.sound(player, PORTAL.sound);
}

/** The portal's swirl, `move` two ticks later, then the swirl clearing and the overlay closing. */
function throughPortal(player, move) {
  const { COMPONENT, SCRIPT } = Common;
  portalOverlay(player);
  player.getMovementQueue().reset();
  Common.later(player, PORTAL_TELEPORT_TICKS, () => {
    move();
    player.getPacketSender().sendInterfaceScript(SCRIPT.overlayPortalRemove, [COMPONENT.portalBackground, COMPONENT.portalForeground, -1, -1]);
    Common.later(player, 1, () => player.getPacketSender().closeInterface(Common.ID.portalInterface));
  });
}

/** Moves the player into a new copy of the office at `arrival` (office tile), facing Death. */
function enter(player, arrival) {
  sessionOf(player)?.end();
  const session = new Session(player);
  sessions.set(player, session);
  session.spawnDeath();
  session.area.enter(player);
  player.moveTo(session.tile(arrival));
  if (session.death) player.setPositionToFace(session.death.getLocation());
  player.setAttribute(INSIDE_ATTRIBUTE, true);
  player.getPacketSender().sendSong(REST_IN_PEACE);
  return session;
}

/**
 * Walks the player to the tile in front of Death's desk, as a click there would, then `atDesk`
 * (his greeting) on arrival. The walk starts once the teleport's movement reset has gone through
 * (two ticks after the move in); walking elsewhere first cancels the greeting.
 */
function approachDesk(player, atDesk) {
  const session = sessionOf(player);
  if (!session) return;
  const desk = session.tile(Common.DATA.desk);
  let ticks = 0;
  const arrived = () => {
    if (sessionOf(player) !== session) return;
    const here = player.getLocation();
    if (here.getX() === desk.getX() && here.getY() === desk.getY()) {
      if (session.death) player.setPositionToFace(session.death.getLocation());
      atDesk();
      return;
    }
    if (++ticks <= DESK_WALK_TICKS && player.getMovementQueue().isMovings()) Common.later(player, 1, arrived);
  };
  Common.later(player, WALK_AFTER_MOVE_TICKS, () => {
    if (sessionOf(player) !== session) return;
    player.getMovementQueue().requestWalk(desk);
    Common.later(player, 1, arrived);
  });
}

/** Leaves the office for `destination` (a world tile), ending the copy. */
function leave(player, destination) {
  player.moveTo(destination);
  sessionOf(player)?.end();
}

// ---------------------------------------------------------------- logging in, dropping

/** Logged in inside: a new copy, the walk to the desk, and Death speaks again. */
function login({ player }) {
  if (player.getAttribute(INSIDE_ATTRIBUTE) !== true || inOffice(player)) return;
  enterAtLogin(player);
}

function enterAtLogin(player) {
  enter(player, Common.DATA.loginArrival);
  approachDesk(player, () => greet(player, { login: true }));
}

/**
 * `deaths-office:enter` { player }: another plugin puts the player in the office, arriving as a
 * login inside does (a Hardcore character starting out). Sets `entered`.
 */
function enterRequest(request) {
  if (!request?.player || request.entered) return;
  request.entered = true;
  // Already inside (a login inside re-entered it): one copy, one greeting.
  if (inOffice(request.player)) return;
  enterAtLogin(request.player);
}

function dropItem(event) {
  const session = sessionOf(event.player);
  if (!session || session.dropAsked) return;
  event.handled = true;
  const { player, slot, itemId } = event;
  Common.talk(player, [{ statement: DROP_QUESTION }], () => Common.choose(player, "Select an option",
    ["Put it down.", () => putDown(player, slot, itemId)],
    ["Don't put it down.", () => {}],
  ));
}

function putDown(player, slot, itemId) {
  const session = sessionOf(player);
  const item = player.getInventory().getItems()[slot];
  if (!session || !item || item.getId() !== itemId) return;
  const { ItemOnGroundManager, Item, Sound, Sounds } = Common.core();
  session.dropAsked = true;
  ItemOnGroundManager.registers(player, item.clone());
  player.getInventory().setItem(slot, new Item(-1, 0)).refreshItems();
  Sounds.sendSound(player, Sound.DROP_ITEM);
}

/** The office's greeting, set by the Death unit. */
function onGreet(handler) {
  greet = handler;
}

/** Leaving the office by any route but logging out (the tutorial's timer starts then). */
function onLeave(handler) {
  leaving = handler;
}

function attach(api) {
  Common.bind(api);
  api.persistAttribute(INSIDE_ATTRIBUTE);
  api.onPlayerLogin(login);
  api.onItemDropPolicy(dropItem);
  api.onCustomEvent("deaths-office:enter", enterRequest);
}

module.exports = { attach, enter, leave, approachDesk, throughPortal, inOffice, deathOf, tileOf, onGreet, onLeave };
