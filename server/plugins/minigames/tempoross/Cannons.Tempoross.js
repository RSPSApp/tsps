"use strict";

/**
 * The ammunition crates and their harpoonfish cannons, two on each ship.
 *
 * Captures: Fill puts in a fish every 2 ticks ("You start loading harpoonfish into the
 * cannon.", `human_cooking` with delay 1, sound 4959, +65 points cooked / +20 raw); the next
 * tick the cannon plays 8871 (8872 on the east ship's mirrored cannons) with area sounds
 * 4949 and 4945 and throws projectile 525 at Tempoross. Filling after a win: "The cannons
 * aren't needed anymore." Wiki: XP a fish is ten times the catch's (crystallised +20%);
 * raw and crystallised drain 10 energy, cooked 15; fish wait in the crate while Tempoross is
 * under, the crate showing 8 and 15 stored; a torrent disables a cannon for a while.
 */

const Shared = require("./Shared.Tempoross");
const { coveOf, coveOfNpc } = require("./Cove.Tempoross");

const { DATA, ITEM, ANIM, GFX, SOUND } = Shared;
const F = DATA.fight;

/** Raw graphic height of the stun stars: at the head, as every other use of stunned_thieving. */
const STUN_HEIGHT = 124;

const AMMO = {
  [ITEM.COOKED]: { points: DATA.points.loadCooked, damage: DATA.damage.cooked, gfx: GFX.PROJECTILE_COOKED, xp: 1 },
  [ITEM.CRYSTALLISED]: { points: DATA.points.loadCrystallised, damage: DATA.damage.crystallised, gfx: GFX.PROJECTILE_CRYSTALLISED, xp: 1.2 },
  [ITEM.RAW]: { points: DATA.points.loadRaw, damage: DATA.damage.raw, gfx: GFX.PROJECTILE_RAW, xp: 1 },
};

class Cannons {
  constructor(fight) {
    this.fight = fight;
    this.cove = fight.cove;
    /** { data, npc, cannoneer, crateLoc, cannonLoc, queue: fish ids, disabledUntil, nextShot, look } */
    this.crates = [];
  }

  setUp() {
    for (const data of DATA.cove.crates) {
      const crate = {
        data,
        npc: this.cove.spawnNpc(data.npc, data.tile),
        crateLoc: this.cove.templateLoc(data.tile),
        cannonLoc: this.cove.templateLoc(data.cannonTile),
        queue: [],
        disabledUntil: -1,
        nextShot: 0,
        look: 0,
      };
      crate.cannoneer = this.cove.spawnNpc(data.cannoneer[0], [data.cannoneer[1], data.cannoneer[2]]);
      this.crates.push(crate);
    }
  }

  stop() {}

  crateOf(npc) {
    return this.crates.find((crate) => crate.npc === npc) ?? null;
  }

  disabled(crate) {
    return this.fight.ticks < crate.disabledUntil;
  }

  tick() {
    const now = this.fight.ticks;
    for (const crate of this.crates) {
      if (crate.disabledUntil >= 0 && now >= crate.disabledUntil) this.enable(crate);
      if (this.fight.phase === "surfaced" && !this.disabled(crate) && crate.queue.length > 0 && now >= crate.nextShot) {
        this.fire(crate, crate.queue.shift());
        crate.nextShot = now + DATA.ticks.load;
      }
      this.updateLook(crate);
    }
  }

  /**
   * Captured: the projectile leaves the cannon's muzzle tile (DATA crates' `muzzle`) for the
   * middle of Tempoross, heights 57 to 90 over 100 cycles, and the impact graphic goes out with
   * it, delayed 100 cycles.
   */
  fire(crate, fishId) {
    const ammo = AMMO[fishId];
    const cannon = crate.cannonLoc;
    if (!ammo || !cannon || !this.fight.boss) return;
    const mirrored = crate.data.side === "east";
    crate.cannoneer?.setPositionToFace(cannon.getLocation());
    this.cove.locAnim(cannon, mirrored ? ANIM.CANNON_FIRING_MIRROR : ANIM.CANNON_FIRING);
    const muzzle = this.cove.tile([...crate.data.muzzle, 0]);
    const target = this.cove.tile([...DATA.cove.bossCentre, 0]);
    this.cove.areaSound(SOUND.CANNON_FIRE, muzzle, 5);
    this.cove.areaSound(SOUND.CANNON_FIRE_2, muzzle, 5, 9);
    const [startHeight, endHeight] = F.projectileHeights;
    this.cove.projectile(ammo.gfx, muzzle, target, { cycles: F.projectileCycles, startHeight, endHeight });
    this.cove.mapGraphic(GFX.IMPACT, target, 24, F.impactDelay);
    Shared.later(this.fight, F.shotLandsTicks, () => {
      if (!this.fight.stopped) this.fight.damageEnergy(ammo.damage);
    });
  }

  /** The crate loc shows how much is waiting: empty, 8+ or 15+ (Wiki). */
  updateLook(crate) {
    const stored = crate.queue.length;
    const look = stored >= F.crateFull ? 2 : stored >= F.crateMid ? 1 : 0;
    if (look === crate.look || !crate.crateLoc) return;
    crate.look = look;
    crate.crateLoc = this.cove.replaceLoc(crate.crateLoc, crate.data.loc[look]);
  }

  /** A torrent's hit: the cannon is electrified and anyone loading it stops. */
  disable(crate) {
    const index = this.crates.indexOf(crate);
    crate.disabledUntil = this.fight.ticks + F.torrentDisabledTicks;
    crate.cannonLoc = this.cove.replaceLoc(crate.cannonLoc, crate.data.cannon + 4);
    for (const player of this.fight.players) {
      if (player.__temporossLoading === crate && Shared.actionOf(player) === "load") {
        Shared.stopAction(player);
        player.sendMessage("The surge of lightning arcs from the cannon into you...");
        stun(player);
      }
    }
    return index;
  }

  enable(crate) {
    crate.disabledUntil = -1;
    crate.cannonLoc = this.cove.replaceLoc(crate.cannonLoc, crate.data.cannon);
  }
}

/**
 * The zap the torrent leaves on a loader (Wiki: it "stuns any player currently loading the
 * cannon"). The Wiki gives no length, so the player is held only while the stars circle their
 * head, not for the cannon's whole 24-tick disable (#2692).
 */
function stun(player) {
  Shared.animate(player, ANIM.STUNNED);
  Shared.graphic(player, GFX.STUNNED, STUN_HEIGHT);
  player.getMovementQueue().reset();
  player.getMovementQueue().setBlockMovement(true);
  const until = Shared.later(player, F.torrentStunTicks, () => {
    if (player.__temporossStun !== until) return;
    player.__temporossStun = null;
    if (player.isRegistered()) player.getMovementQueue().setBlockMovement(false);
  });
  player.__temporossStun = until;
}

// ------------------------------------------------------------------ filling

function nextFish(player) {
  const items = player.getInventory().getItems();
  for (const item of items) {
    if (item && AMMO[item.getId()]) return item.getId();
  }
  return null;
}

function fill(event) {
  const { player, npc } = event;
  const cove = coveOfNpc(npc);
  if (!cove) return false;
  if (coveOf(player) !== cove || !cove.fight) return true;
  const fight = cove.fight;
  const crate = fight.cannons.crateOf(npc);
  if (!crate) return true;
  if (fight.result) {
    Shared.statement(player, "The cannons aren't needed anymore.");
    return true;
  }
  if (nextFish(player) === null) {
    player.sendMessage("You have no harpoonfish to load.");
    return true;
  }
  if (fight.cannons.disabled(crate)) {
    player.sendMessage("The cannon is electrified; you can't load it right now.");
    return true;
  }
  player.setPositionToFace(npc.getLocation());
  player.sendMessage("You start loading harpoonfish into the cannon.");
  Shared.startAction(player, "load", (ticks) => {
    if (fight.result || fight.cannons.disabled(crate)) return false;
    if (ticks % DATA.ticks.load !== 1) return true;
    const fishId = nextFish(player);
    if (fishId === null) return false;
    load(player, fight, crate, fishId);
    return nextFish(player) !== null;
  });
  player.__temporossLoading = crate;
  return true;
}

function load(player, fight, crate, fishId) {
  const ammo = AMMO[fishId];
  Shared.animate(player, ANIM.COOK);
  player.getPacketSender().sendSound(SOUND.LOAD, 100, 0);
  player.getInventory().delete(fishId, 1);
  player.getInventory().refreshItems();
  crate.queue.push(fishId);
  Shared.addXp(player, "FISHING", (Shared.xpBase(player) / 10) * ammo.xp);
  fight.addPoints(player, ammo.points);
}

function checkAmmo(event) {
  const { player, npc } = event;
  const cove = coveOfNpc(npc);
  if (!cove) return false;
  const crate = cove.fight?.cannons.crateOf(npc);
  if (!crate) return true;
  const stored = crate.queue.length;
  player.sendMessage(stored === 0
    ? "The crate is empty."
    : `The crate holds ${stored} harpoonfish waiting to be fired.`);
  return true;
}

function attachCannons(api) {
  api.onNpcInteraction("<col=00ffff>Ammunition crate</col>", { Fill: fill, "Check-ammo": checkAmmo });
}

module.exports = { Cannons, attachCannons, AMMO };
