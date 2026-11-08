/**
 * The Phantom Muspah's lair, one per player, as captured: past Secrets of the North the crevice in
 * the Ghorrock Dungeon (ghorrock_dungeon_cave_entry) copies the lair's map square into an instance
 * and moves the player in behind a fade; three ticks later the Muspah appears, and the escape
 * crevice with it. Leaving it any way - the escape crevice, a teleport, death, logging out - ends
 * it; a player saved inside comes back by the crevice, and a grave from a death there is left
 * outside it (Wiki).
 */
const Common = require("./Common.PhantomMuspah");
const Fight = require("./Fight.PhantomMuspah");
const Corruption = require("./Corruption.PhantomMuspah");
const Scoreboard = require("./Scoreboard.PhantomMuspah");

const SECRETS_OF_THE_NORTH = "secrets_of_the_north";

/** Per player: their lair while they are in it. */
const sessions = new Map();

let AreaClass = null;

function areaClass() {
  if (AreaClass) return AreaClass;
  const { TemplatedInstanceArea } = Common.core;
  AreaClass = class PhantomMuspahLair extends TemplatedInstanceArea {
    constructor() {
      const { width, height } = Common.data.lair.instance;
      super(width, height);
      this.session = null;
    }

    getName() {
      return "Phantom Muspah's lair";
    }

    /** Leaving ends the lair. Logging out puts the player by the crevice before they're saved. */
    postLeave(mobile, logout) {
      const session = this.session;
      const player = mobile.isPlayer?.() && session?.player === mobile.getAsPlayer() ? mobile.getAsPlayer() : null;
      if (player && logout) player.setLocation(exitLocation());
      if (player) session.end();
      super.postLeave(mobile, logout);
    }
  };
  return AreaClass;
}

const exitLocation = () => {
  const [x, y, z] = Common.data.lair.exit;
  return new Common.core.Location(x, y, z);
};

class Session {
  constructor(player) {
    this.player = player;
    this.area = new (areaClass())();
    this.area.session = this;
    this.copyLair();
    this.fight = null;
    this.ended = false;
    this.escape = null;
  }

  /** Every chunk of the lair's map square, planes 0 and 1, unturned (as captured). */
  copyLair() {
    const { sourceChunkX, sourceChunkY, width, height, planes } = Common.data.lair.instance;
    for (let x = 0; x < width; x++) {
      for (let y = 0; y < height; y++) {
        for (const plane of planes) {
          this.area.setChunk(plane, x, y, {
            sourceChunkX: sourceChunkX + x, sourceChunkY: sourceChunkY + y, rotation: 0, sourcePlane: plane,
          });
        }
      }
    }
  }

  tile(tile) {
    return Common.tileIn(this.area, tile);
  }

  lairTile(location) {
    return Common.lairTile(this.area, location);
  }

  /** The escape crevice, placed with the Muspah (as captured). */
  placeEscape() {
    if (this.escape) return;
    const { GameObject, ObjectManager } = Common.core;
    const { tile, shape, rotation } = Common.data.lair.escape;
    this.escape = new GameObject(Common.data.locs.escape, this.tile(tile), shape, rotation, this.area);
    ObjectManager.register(this.escape, true);
  }

  /** A Muspah for this lair: now, or after `ticks` (its respawn). */
  spawnMuspah(ticks = 0) {
    const start = () => {
      if (this.ended || this.fight) return;
      this.placeEscape();
      Fight.start(this);
    };
    if (ticks > 0) Common.later(ticks, start);
    else start();
  }

  end() {
    if (this.ended) return;
    this.ended = true;
    sessions.delete(this.player);
    this.fight?.stop();
    this.fight = null;
    Corruption.cure(this.player);
    Common.closeOverlay(this.player);
    // A spike's camera shake may still be running.
    this.player.getPacketSender().sendCameraReset();
    this.player.setAttribute(Common.INSIDE_ATTRIBUTE, false);
    if (!this.area.isDestroyed()) this.area.destroy();
  }
}

const sessionOf = (player) => sessions.get(player) ?? null;

function questComplete(player) {
  const request = { player, key: SECRETS_OF_THE_NORTH, complete: false };
  Common.api.emitCustomEvent("quest:is-complete", request);
  return request.complete === true;
}

/** Builds the player's lair and moves them in behind the captured fade. */
function enter(player) {
  if (sessionOf(player)) return;
  const session = new Session(player);
  sessions.set(player, session);
  const { lair } = Common.data;
  player.getMovementQueue().reset();
  player.setPositionToFace(player.getLocation().clone().add(-1, 0));
  Common.travel(player, lair.enterMessage, () => {
    if (session.ended) return;
    session.area.enter(player);
    player.moveTo(session.tile(lair.arrival));
    player.setPositionToFace(session.tile(lair.arrival).clone().add(-1, 0));
    player.setAttribute(Common.INSIDE_ATTRIBUTE, true);
    Common.playMusic(player, lair.music.arrival);
    session.spawnMuspah(lair.spawnTicks);
  });
}

/** Back out by the crevice; the area's postLeave ends the lair. */
function leave(player) {
  player.moveTo(exitLocation());
  sessionOf(player)?.end();
}

/** The crevice into the lair (46597, Enter), once Secrets of the North is done. */
function enterCrevice({ player, objectId }) {
  if (objectId !== Common.data.locs.entry) return false;
  if (!questComplete(player)) return false;
  enter(player);
  return true;
}

/** The escape crevice (46599): out through the same fade. */
function escape({ player }) {
  if (!sessionOf(player)) return false;
  player.getMovementQueue().reset();
  Common.travel(player, Common.data.lair.leaveMessage, () => leave(player));
  return true;
}

function quickEscape({ player }) {
  if (!sessionOf(player)) return false;
  leave(player);
  return true;
}

/** A player saved inside (the server stopped, or they logged out there) comes back by the crevice. */
function recoverOnLogin({ player }) {
  if (!player.getAttribute(Common.INSIDE_ATTRIBUTE) || sessionOf(player)) return;
  player.setAttribute(Common.INSIDE_ATTRIBUTE, false);
  player.moveTo(exitLocation());
}

/**
 * A death ends the lair; the usual respawn takes the player out (and nothing can pull them back).
 * What fell on its floor (the supply pile, unclaimed loot) is carried out by the crevice first, as
 * the grave is, or it would go with the instance.
 */
function endOnDeath({ player }) {
  const session = sessionOf(player);
  if (!session) return;
  const { World } = Common.core;
  const manager = Common.api.getItemOnGroundManager();
  for (const ground of [...World.getItems()]) {
    // A stack picked up this tick is only marked pending until the next ground-item pass: it is in the inventory
    // already, and moving it to the exit as well gave it twice (Gallery.ChampionsChallenge skips these too).
    if (ground.isPendingRemoval?.() || ground.getPrivateArea() !== session.area) continue;
    manager.deregister(ground);
    manager.registerLocation(player, ground.getItem(), exitLocation(), null);
  }
  session.end();
}

/**
 * A death in the lair itself counts on the scoreboard (not one during the fade in, before the
 * move). It is counted on defeat, which every death reaches: onPlayerDeath stops at the first
 * plugin that handles the respawn, as Death's Office does for a first grave.
 */
function diedInLair({ victim: player }) {
  const session = player ? sessionOf(player) : null;
  if (session && player.getPrivateArea() === session.area) Scoreboard.died(player);
}

/** A grave from a death in the lair is left outside it, by the crevice (Wiki). */
function graveOutside(request) {
  const session = request?.player ? sessionOf(request.player) : null;
  if (!session) return;
  const [x, y, z] = Common.data.lair.exit;
  request.tile = { x, y, z };
}

function attachLair(api) {
  api.persistAttribute(Common.INSIDE_ATTRIBUTE, false);
  api.onPlayerLogin(recoverOnLogin);
  api.onObjectInteraction("Crevice", { Enter: enterCrevice, Escape: escape, "Quick-escape": quickEscape });
  api.onCustomEvent("gravestones:grave-location", graveOutside);
  api.onPlayerDefeated(diedInLair);
  api.onPlayerDeath(endOnDeath);
}

module.exports = {
  attachLair, enter, leave, sessionOf, exitLocation, diedInLair,
  /** Tests: stands `player` in a lair whose area is `area`, without building it. */
  _setSession(player, area) { sessions.set(player, { player, area, end() { sessions.delete(player); } }); },
};
