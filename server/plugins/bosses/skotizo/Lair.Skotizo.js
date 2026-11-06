/**
 * Skotizo's lair, one per player, as captured (rsprox recordings 3323, 3329):
 * - a dark totem used on the altar in the centre of the Catacombs: the altar's loc animation and
 *   the player faces it; +1 the necromancy animation, teleport graphic and sound; +3 the fade out;
 *   +6 the totem is gone and the player is in their copy of map square 9048 with Skotizo and the
 *   four sleeping altars; +7 the fade in and the lair's track ("Darkly Altared"); +9 the fade
 *   closes and the altar HUD opens.
 * - the player and Skotizo each land on a random tile of the arena.
 * - the corner portals lead back to the Catacombs (Wiki; not captured, so the fade is ours).
 * Leaving, teleporting, dying or logging out ends the lair; logging back in puts the player by
 * the altar.
 */
const Common = require("./Common.Skotizo");
const { Fight } = require("./Fight.Skotizo");

const CHUNK = 8;
const CATACOMBS_SLAYER_AREA_ID = 1;
/** player -> their lair while they are in it. */
const sessions = new Map();

let AreaClass = null;

function areaClass() {
  if (AreaClass) return AreaClass;
  const { TemplatedInstanceArea } = Common.core;
  AreaClass = class SkotizoLair extends TemplatedInstanceArea {
    constructor() {
      const { chunks } = Common.DATA.instance;
      super(chunks, chunks);
      this.session = null;
    }

    getName() {
      return "Skotizo's lair";
    }

    isMulti() {
      return true;
    }

    allowSummonPet() {
      return false;
    }

    /** A sleeping altar is only scenery. */
    canAttack(attacker, target) {
      const altar = this.session?.fight?.altarOf(target);
      return altar && !altar.awake ? false : null;
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

    /** Logging out puts the player back by the altar before they're saved. */
    postLeave(mobile, logout) {
      const player = mobile.isPlayer?.() && this.session?.player === mobile.getAsPlayer() ? mobile.getAsPlayer() : null;
      if (player && logout) player.setLocation(Common.toLocation(Common.DATA.exit.tile));
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
    this.fight = null;
    this.ended = false;
  }

  /** The instance's copy of a lair tile. */
  tile([x, y, z]) {
    const { sourceChunkX, sourceChunkY } = Common.DATA.instance;
    return this.area.tile(x - sourceChunkX * CHUNK, y - sourceChunkY * CHUNK, z ?? 0);
  }

  /** The lair tile an instance tile copies. */
  worldTile(location) {
    const { sourceChunkX, sourceChunkY } = Common.DATA.instance;
    return [location.getX() - this.area.getBaseX() + sourceChunkX * CHUNK, location.getY() - this.area.getBaseY() + sourceChunkY * CHUNK];
  }

  inArena(location) {
    const [x, y] = this.worldTile(location);
    const { minX, maxX, minY, maxY } = Common.DATA.arena;
    return location.getZ() === 0 && x >= minX && x <= maxX && y >= minY && y <= maxY;
  }

  /** Whether a `size` x `size` footprint from this lair tile is all open floor. */
  open([x, y], size = 1) {
    for (let dx = 0; dx < size; dx++) {
      for (let dy = 0; dy < size; dy++) {
        const tile = this.tile([x + dx, y + dy, 0]);
        if (!this.inArena(tile) || this.area.getClip(tile) !== 0) return false;
      }
    }
    return true;
  }

  /** A random open arena tile for a footprint of `size`, optionally near a lair tile. */
  randomTile(size = 1, near = null, radius = 0) {
    const { minX, maxX, minY, maxY } = Common.DATA.arena;
    for (let attempt = 0; attempt < 200; attempt++) {
      const x = near ? Common.randomInt(near[0] - radius, near[0] + radius) : Common.randomInt(minX, maxX - size + 1);
      const y = near ? Common.randomInt(near[1] - radius, near[1] + radius) : Common.randomInt(minY, maxY - size + 1);
      if (this.open([x, y], size)) return [x, y];
    }
    return null;
  }

  end() {
    if (this.ended) return;
    this.ended = true;
    sessions.delete(this.player);
    this.fight?.stop();
    this.fight?.closeHud();
    this.player.setAttribute(Common.INSIDE_ATTRIBUTE, null);
    if (!this.area.isDestroyed()) this.area.destroy();
  }
}

const sessionOf = (player) => sessions.get(player) ?? null;

function sessionOfNpc(npc) {
  return npc?.__skotizoLair ?? null;
}

/** The move into the lair: the player on a random tile, the fight set up around them. */
function arrive(player) {
  sessionOf(player)?.end();
  const session = new Session(player);
  sessions.set(player, session);
  session.area.enter(player);
  const landing = session.randomTile(1) ?? [Common.DATA.arena.minX, Common.DATA.arena.minY];
  player.moveTo(session.tile([...landing, 0]));
  player.setAttribute(Common.INSIDE_ATTRIBUTE, true);
  session.fight = new Fight(session);
  session.fight.setUp();
  return session;
}

/** Using a dark totem on the catacombs altar. */
function useTotem(event) {
  const { player, object } = event;
  const { DATA, core } = Common;
  if (event.objectId !== DATA.locs.catacombsAltar) return false;
  if (sessionOf(player) || player.getMovementQueue().isMovementBlocked()) return true;
  const { Animation, Graphic, ItemIdentifiers } = core;
  const enter = DATA.enter;
  const altar = object.getLocation();
  const sender = player.getPacketSender();
  const steps = new Map();
  const at = (tick, step) => steps.set(tick, [...(steps.get(tick) ?? []), step]);
  at(0, () => {
    player.setPositionToFace(altar.transform(1, 1, 0));
    sender.sendObjectAnimation(object, new Animation(enter.locAnim));
  });
  at(enter.animTick, () => {
    player.performAnimation(new Animation(enter.anim));
    player.performGraphic(new Graphic(enter.spotanim));
    const here = player.getLocation();
    sender.sendAreaSound(enter.sound, here.getX(), here.getY(), here.getZ(), 1, 0, 10);
  });
  at(enter.fadeOutTick, () => Common.fade(player, true));
  at(enter.moveTick, () => {
    if (!player.getInventory().contains(ItemIdentifiers.DARK_TOTEM)) {
      Common.fade(player, false);
      return;
    }
    player.getInventory().delete(ItemIdentifiers.DARK_TOTEM, 1);
    arrive(player);
  });
  at(enter.fadeInTick, () => {
    if (!sessionOf(player)) return;
    player.performAnimation(new Animation(-1));
    Common.fade(player, false);
    Common.playMusic(player);
  });
  at(enter.hudTick, () => {
    if (!sessionOf(player)) return;
    Common.closeFade(player);
    sessionOf(player).fight?.openHud();
  });
  Common.sequence(player, steps);
  return true;
}

/** A corner portal: back to the Catacombs behind a fade. */
function usePortal({ player, objectId }) {
  const session = sessionOf(player);
  if (objectId !== Common.DATA.locs.portal || !session) return false;
  if (player.getMovementQueue().isMovementBlocked()) return true;
  const { exit } = Common.DATA;
  Common.sequence(player, new Map([
    [exit.fadeOutTick, [() => Common.fade(player, true)]],
    [exit.moveTick, [() => {
      player.moveTo(Common.toLocation(exit.tile));
      session.end();
    }]],
    [exit.fadeInTick, [() => Common.fade(player, false)]],
    [exit.closeTick, [() => Common.closeFade(player)]],
  ]));
  return true;
}

/** A player saved inside (the server stopped while they were there) comes back by the altar. */
function recoverOnLogin({ player }) {
  if (!player.getAttribute(Common.INSIDE_ATTRIBUTE) || sessionOf(player)) return;
  player.setAttribute(Common.INSIDE_ATTRIBUTE, null);
  player.moveTo(Common.toLocation(Common.DATA.exit.tile));
}

/** The active lair is part of the Catacombs for Konar's selected-area rule (Wiki). */
function slayerTaskArea(request) {
  if (request?.area?.id !== CATACOMBS_SLAYER_AREA_ID) return;
  const session = sessionOfNpc(request.npc);
  if (!session || session.ended || sessionOf(request.player) !== session || session.area.isDestroyed()) return;
  if (request.player.getPrivateArea() !== session.area || !session.area.hasMember(request.player)) return;
  if (session.fight?.boss !== request.npc || request.npc.getPrivateArea() !== session.area) return;
  if (session.inArena(request.location)) request.allowed = true;
}

function attachLair(api) {
  api.persistAttribute(Common.INSIDE_ATTRIBUTE);
  api.onItemOnObject("Dark totem", "Altar", useTotem, { noted: false });
  api.onObjectInteraction("Portal", { Use: usePortal });
  api.onPlayerLogin(recoverOnLogin);
  api.onCustomEvent("slayer:task-area-match", slayerTaskArea);
}

module.exports = { attachLair, sessionOf, sessionOfNpc, arrive };
