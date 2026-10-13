"use strict";

/**
 * Vasa Nistirio's room: a pile of rocks that wakes when approached, teleports the party for a
 * blast, then walks to one of four glowing crystals to siphon it while throwing boulders.
 *
 * Wiki (Vasa Nistirio; Glowing crystal):
 * - Waking, he raises a magical fire at the way in and opens with his special: everyone in the
 *   arena is teleported, split evenly between beside him (always, solo) and the walls; those
 *   beside him are stunned and can't pray. He can't be hurt while charging. The blast deals the
 *   total of the hitpoints of those beside him (each one's hitpoints - 5), shared among everyone
 *   then next to him; those who ran in with Protect from Magic take nothing.
 * - Boulders: a ranged attack on everyone within 8 tiles but not under him; standing under him
 *   is stomped (up to 8 a tick).
 * - After the special he picks a crystal and walks to it; there he can't be hurt, healing 1%
 *   every 2 ticks (and Defence by 10% + 1). The first time he reaches one, a 66-67 tick timer
 *   starts, running only while a crystal is active; at zero he leaves it for the centre and his
 *   special. Disabling the crystal first undoes the healing.
 * - The crystals are immune to Ranged and take a third from Magic.
 * rsprox captures (recordings 820, a whole fight with five specials, and 3282):
 * - Woken: 7408 with sounds 1724 and 1595 (range 15); the fire 4 ticks later; 7409 and the
 *   walking form (7566) the tick after. Each special starts with 7409: 3 ticks later the
 *   party is teleported (those beside him: gfx 245, sound 2727), and 2 ticks after that they
 *   are told "Vasa Nistirio has blocked your use of prayers." (sound 2673); 8 ticks after 7409
 *   he explodes (7410, sound 1781) with eight projectiles 1327 (8 client cycles apart, to 125,
 *   heights 420 to 10) landing 4 ticks later as gfx 1328 round him (3 cycles apart; sound 3428)
 *   with the blast. He lights his next crystal about then and walks to it.
 * - Walking he stomps (sound 3834, range 12, twice a tick) and throws boulders every 3 ticks,
 *   one per raider: projectile 1329 (0, 5, 10 cycles to 90, angle 5, heights 150 to 10; sound
 *   781 looped once per boulder) landing 2 ticks later as gfx 1330 with sound 1021.
 * - At the crystal: 7412 and the healing form (7567) on one tick, sound 2885 every 2 ticks;
 *   66-67 ticks later 7414 and walking again, the crystal gone 2 ticks after.
 * - Dying: 7415; he and his crystal go 3 ticks later, as the exit crystals shatter and the fire
 *   goes.
 * Not on the Wiki (to check against a capture): the tiles (the four crystals, the centre, the
 *   fire, the exit crystals 30016); where the far half is sent; the boulder base (18) and its
 *   3x3; stomps 1-5; "The crystal is currently invulerable to damage."; prayers blocked 8 ticks.
 */

const Shared = require("./CoxShared");
const Raid = require("./CoxRaid");
const Monsters = require("./CoxMonsters");

const NPC = { ROCKS: 7565, VASA: 7566, SIPHONING: 7567, CRYSTAL: 7568 };
const OBJECT = { LIT: 29774, DARK: 29775, EXIT: 30016, FIRE: 30019 };
const ANIM = { RISE: 7408, SWIRL: 7409, EXPLODE: 7410, SIPHON: 7412, SIPHONED: 7414 };
const GFX = { STUNNED: 245, FALLING: 1327, EXPLOSION: 1328, BOULDER: 1329, BOULDER_HIT: 1330 };
const SOUND = {
  WAKE: 1724, WAKE_2: 1595, STUNNED: 2727, PRAYERS: 2673, EXPLODE: 1781, BLAST: 3428,
  STEP: 3834, BOULDER: 781, BOULDER_HIT: 1021, SIPHON: 2885,
};
/** Ticks from 7409: the teleport, the prayer message, the explosion, its landing, the next crystal. */
const SPECIAL = { TELEPORT: 3, PRAYERS: 5, EXPLODE: 8, BLAST: 12, CRYSTAL: 13 };
const WAKE = { FIRE: 4, SWIRL: 5 };
const BOULDER_EVERY = 3;
const CRYSTAL_TIMER = [66, 67];
const BOULDER_BASE = 18;
const PRAYER_BLOCK_TICKS = 8;

/** Cache tiles by version. */
const CRYSTAL_TILES = [
  [{ x: 3270, y: 5285 }, { x: 3270, y: 5303 }, { x: 3287, y: 5303 }, { x: 3287, y: 5285 }],
  [{ x: 3301, y: 5285 }, { x: 3301, y: 5302 }, { x: 3319, y: 5302 }, { x: 3319, y: 5285 }],
  [{ x: 3333, y: 5285 }, { x: 3333, y: 5303 }, { x: 3350, y: 5303 }, { x: 3350, y: 5285 }],
];
const EXIT_TILES = [[{ x: 3268, y: 5295 }, { x: 3268, y: 5296 }], [{ x: 3311, y: 5307 }, { x: 3312, y: 5307 }], [{ x: 3355, y: 5296 }, { x: 3355, y: 5295 }]];
const FIRE_TILES = [{ x: 3279, y: 5281 }, { x: 3311, y: 5281 }, { x: 3343, y: 5281 }];
const CENTRE_TILES = [{ x: 3278, y: 5293 }, { x: 3309, y: 5293 }, { x: 3341, y: 5294 }];

class VasaRoom extends Raid.Room {
  constructor(raid, record) {
    super(raid, record);
    this.state = "asleep";
    this.crystals = [null, null, null, null];
    this.crystalObjects = [];
    this.exits = [];
    this.timer = null;
  }

  load() {
    const variant = this.record.variant;
    const { GameObject, ObjectManager } = Shared.core();
    this.crystalTiles = CRYSTAL_TILES[variant].map((spot) => this.tile(spot.x, spot.y, 6));
    this.crystalObjects = this.crystalTiles.map((tile) => {
      const object = new GameObject(OBJECT.DARK, tile, 10, this.record.rotation, this.map);
      ObjectManager.register(object, true);
      return object;
    });
    this.home = this.tile(CENTRE_TILES[variant].x, CENTRE_TILES[variant].y, 6);
    this.vasa = this.spawnNpc(NPC.ROCKS, this.home.clone());
    this.exits = EXIT_TILES[variant].map((spot) => {
      const object = new GameObject(OBJECT.EXIT, this.tile(spot.x, spot.y), 10, this.record.rotation, this.map);
      ObjectManager.register(object, true);
      return object;
    });
  }

  combatPoints() {
    const crystal = Monsters.scale(NPC.CRYSTAL, this.raid.scaling ?? this.raid.scalingInputs())?.hitpoints ?? 0;
    return Math.floor(5 * ((this.vasa?.getMaxHitpoints() ?? 0) + 4 * crystal) * 1.05);
  }

  alive() {
    return this.vasa?.isRegistered() && this.vasa.getHitpoints() > 0;
  }

  centre() {
    const at = this.vasa.getLocation();
    const { Location } = Shared.core();
    return new Location(at.getX() + 2, at.getY() + 2, at.getZ());
  }

  under(player) {
    const at = this.vasa.getLocation();
    const x = player.getLocation().getX() - at.getX();
    const y = player.getLocation().getY() - at.getY();
    return x >= 0 && x < 5 && y >= 0 && y < 5;
  }

  tick() {
    if (!this.alive()) return;
    if (this.state !== "asleep" && this.state !== "waking") {
      for (const player of this.raiders()) if (this.under(player)) Shared.damage(player, Shared.random(1, 5));
    }
    switch (this.state) {
      case "asleep": return this.watch();
      case "waking": return this.wake();
      case "walking": return this.walking();
      case "siphoning": return this.siphon();
      case "returning": return this.returning();
      default: return undefined;
    }
  }

  watch() {
    if (!this.raiders().some((player) => player.getLocation().getDistance(this.centre()) <= 7)) return;
    this.state = "waking";
    this.stage = 0;
  }

  /** 7408 and its sounds; the fire 4 ticks later; 7409 and the walking form, his special. */
  wake() {
    const stage = this.stage++;
    if (stage === 0) {
      Shared.animate(this.vasa, ANIM.RISE);
      Shared.areaSound(this.raiders(), SOUND.WAKE, this.centre(), { range: 15 });
      Shared.areaSound(this.raiders(), SOUND.WAKE_2, this.centre(), { delay: 15, range: 15 });
    } else if (stage === WAKE.FIRE) {
      const spot = FIRE_TILES[this.record.variant];
      const { GameObject, ObjectManager } = Shared.core();
      this.fire = new GameObject(OBJECT.FIRE, this.tile(spot.x, spot.y, 2), 10, this.record.rotation, this.map);
      ObjectManager.register(this.fire, true);
    } else if (stage === WAKE.SWIRL) {
      this.vasa.setNpcTransformationId(NPC.VASA);
      this.special();
    }
  }

  /** 7409; the teleport 3 ticks on, the prayer block 2 after, the explosion at 8, the blast at 12. */
  special() {
    this.state = "special";
    Shared.animate(this.vasa, ANIM.SWIRL);
    Shared.later(this.raid, SPECIAL.TELEPORT, () => this.teleport());
    Shared.later(this.raid, SPECIAL.PRAYERS, () => {
      for (const player of this.near ?? []) {
        if (this.raid.roomAt(player.getLocation()) !== this) continue;
        player.sendMessage("Vasa Nistirio has blocked your use of prayers.");
        Shared.sound(player, SOUND.PRAYERS);
      }
    });
    Shared.later(this.raid, SPECIAL.EXPLODE, () => {
      if (!this.alive()) return;
      Shared.animate(this.vasa, ANIM.EXPLODE);
      Shared.areaSound(this.raiders(), SOUND.EXPLODE, this.centre(), { range: 15 });
      const { Projectile } = Shared.core();
      this.ring().forEach((tile, index) => {
        new Projectile(this.centre(), tile, null, GFX.FALLING, index * 8, 125, 105, 2, this.map)
          .withAngle(0)
          .withProgress(30)
          .sendProjectile();
      });
    });
    Shared.later(this.raid, SPECIAL.BLAST, () => this.explode());
    Shared.later(this.raid, SPECIAL.CRYSTAL, () => this.alive() && this.chooseCrystal());
  }

  /** Half the party beside him, stunned and without prayers; the rest by the walls. */
  teleport() {
    if (!this.alive()) return;
    const raiders = Shared.shuffle(this.raiders().filter((player) => player.getHitpoints() > 0));
    this.near = [];
    this.far = [];
    this.blast = 0;
    if (raiders.length === 0) return;
    this.near.push(raiders.shift());
    for (const player of raiders) (this.far.length < this.near.length ? this.far : this.near).push(player);
    const { CombatFactory, PrayerHandler } = Shared.core();
    const middle = this.centre();
    for (const player of this.far) player.moveTo(this.tileAround(middle, 10, 14));
    for (const player of this.near) {
      player.moveTo(this.tileAround(middle, 3, 4));
      CombatFactory.stun(player, 6, true);
      PrayerHandler.deactivatePrayers(player);
      player.__coxNoPrayerUntil = this.raid.ticks + PRAYER_BLOCK_TICKS;
      player.performGraphic(Shared.gfx(GFX.STUNNED, { height: 124 }));
      Shared.sound(player, SOUND.STUNNED);
      this.blast += Math.max(0, Math.min(99, player.getHitpoints()) - 5);
    }
  }

  /** The eight tiles around him the blast falls on, in the order it lands. */
  ring() {
    const { Location } = Shared.core();
    const at = this.vasa.getLocation();
    const order = [[-1, -1], [2, -1], [5, -1], [5, 2], [5, 5], [2, 5], [-1, 5], [-1, 2]];
    return order.map(([x, y]) => new Location(at.getX() + x, at.getY() + y, at.getZ()));
  }

  explode() {
    if (!this.alive()) return;
    const middle = this.centre();
    const viewers = this.raiders();
    this.ring().forEach((tile, index) => Shared.graphicAt(viewers, GFX.EXPLOSION, tile, { delay: index * 3 }));
    Shared.areaSound(viewers, SOUND.BLAST, middle, { delay: 5, range: 15 });
    const near = this.near ?? [];
    const far = this.far ?? [];
    const close = viewers.filter((player) => player.getLocation().getDistance(middle) <= 4);
    const sharing = Math.max(near.filter((player) => close.includes(player)).length, close.length);
    if (sharing > 0 && this.blast > 0) {
      const damage = Math.min(99, Math.floor(this.blast / sharing));
      for (const player of close) {
        if (far.includes(player) && Shared.isProtected(player, "magic")) continue;
        Shared.damage(player, damage);
      }
    }
  }

  tileAround(middle, min, max) {
    const { Location, RegionManager } = Shared.core();
    for (let tries = 0; tries < 50; tries++) {
      const tile = new Location(middle.getX() + Shared.random(-max, max), middle.getY() + Shared.random(-max, max), middle.getZ());
      if (tile.getDistance(middle) <= min || RegionManager.blocked(tile, this.map) || this.raid.roomAt(tile) !== this) continue;
      return tile;
    }
    return middle;
  }

  /** A live crystal other than the last, or a new one lit when none is left. */
  chooseCrystal() {
    const live = this.crystals.map((crystal, index) => (crystal?.isRegistered() && crystal.getHitpoints() > 0 ? index : -1)).filter((index) => index >= 0);
    const choices = live.filter((index) => index !== this.current);
    if (live.length === 0) {
      const index = Shared.randomOf([0, 1, 2, 3].filter((other) => other !== this.current));
      this.lightCrystal(index);
      this.current = index;
    } else {
      this.current = choices.length ? Shared.randomOf(choices) : live[0];
    }
    this.timer ??= Shared.random(...CRYSTAL_TIMER);
    if (this.timer <= 0) this.timer = Shared.random(...CRYSTAL_TIMER);
    this.state = "walking";
    this.boulderTicks = 0;
    this.stepped = 0;
    this.siphoned = 0;
    Shared.core().PathFinder.calculateEntityRoute(this.vasa, this.crystals[this.current]);
  }

  lightCrystal(index) {
    this.crystalObjects[index] = Shared.replaceObject(this.map, this.crystalObjects[index], OBJECT.LIT);
    const crystal = this.spawnNpc(NPC.CRYSTAL, this.crystalTiles[index].clone());
    if (crystal) crystal.__coxCrystal = index;
    this.crystals[index] = crystal;
  }

  walking() {
    const crystal = this.crystals[this.current];
    if (!crystal?.isRegistered() || crystal.getHitpoints() <= 0) return this.goHome();
    this.boulders();
    if (this.vasa.getMovementQueue().isMovings()) return undefined;
    if (this.vasa.getLocation().getDistance(crystal.getLocation()) > 6) {
      Shared.core().PathFinder.calculateEntityRoute(this.vasa, crystal);
      return undefined;
    }
    this.state = "siphoning";
    this.siphonTicks = 0;
    Shared.animate(this.vasa, ANIM.SIPHON);
    this.vasa.setNpcTransformationId(NPC.SIPHONING);
    return undefined;
  }

  /** Wiki (Mod Ash): 1% every 2 ticks while the crystal stands; the timer runs out, the special. */
  siphon() {
    const crystal = this.crystals[this.current];
    if (!crystal?.isRegistered() || crystal.getHitpoints() <= 0) {
      // Disabled in time: the healing is undone.
      if (this.siphoned > 0) this.vasa.setHitpoints(Math.max(1, this.vasa.getHitpoints() - this.siphoned));
      this.siphoned = 0;
      this.vasa.setNpcTransformationId(NPC.VASA);
      return this.goHome();
    }
    if (++this.siphonTicks % 2 === 0) Shared.areaSound(this.raiders(), SOUND.SIPHON, this.centre(), { range: 12 });
    if (this.siphonTicks % 2 === 0) {
      const before = this.vasa.getHitpoints();
      this.vasa.heal(Math.max(1, Math.floor(this.vasa.getMaxHitpoints() * 0.01)));
      this.siphoned += this.vasa.getHitpoints() - before;
    }
    if (--this.timer <= 0) {
      const index = this.current;
      this.crystals[index] = null;
      Shared.animate(this.vasa, ANIM.SIPHONED);
      this.vasa.setNpcTransformationId(NPC.VASA);
      Shared.later(this.raid, 2, () => {
        this.removeNpc(crystal);
        this.crystalObjects[index] = Shared.replaceObject(this.map, this.crystalObjects[index], OBJECT.DARK);
      });
      this.goHome(true);
    }
    return undefined;
  }

  goHome(special = false) {
    this.state = "returning";
    this.specialNext = special;
    this.waited = 0;
    Shared.core().PathFinder.calculateWalkRoute(this.vasa, this.home.getX(), this.home.getY());
  }

  returning() {
    if (this.vasa.getMovementQueue().isMovings()) {
      this.boulders();
      return;
    }
    if (!this.vasa.getLocation().equals(this.home) && this.waited++ === 0) {
      Shared.walkStraight(this.vasa, this.home);
      return;
    }
    if (this.specialNext) {
      this.special();
      return;
    }
    if (this.waited++ >= 3) this.chooseCrystal();
  }

  /** His footsteps, and every 3 ticks a boulder at each raider within 8 tiles, not under him. */
  boulders() {
    Shared.areaSound(this.raiders(), SOUND.STEP, this.vasa.getLocation(), { range: 12 });
    Shared.areaSound(this.raiders(), SOUND.STEP, this.vasa.getLocation(), { delay: Shared.random(5, 9), range: 12 });
    if (this.boulderTicks++ % BOULDER_EVERY !== 0) return;
    const middle = this.centre();
    const max = Monsters.maxHitFor(this.vasa, BOULDER_BASE, Monsters.LEVELS.RANGED);
    const targets = this.raiders().filter((player) => !this.under(player) && player.getLocation().getDistance(middle) <= 8 + 2);
    if (targets.length === 0) return;
    const { Projectile } = Shared.core();
    Shared.areaSound(this.raiders(), SOUND.BOULDER, middle, { loops: targets.length, range: 15 });
    targets.forEach((player, index) => {
      const tile = player.getLocation().clone();
      new Projectile(middle, tile, null, GFX.BOULDER, index * 5, 90, 37, 2, this.map)
        .withAngle(5)
        .withProgress(30)
        .sendProjectile();
      Shared.later(this.raid, 2, () => {
        if (!this.alive()) return;
        Shared.graphicAt(this.raiders(), GFX.BOULDER_HIT, tile);
        Shared.areaSound(this.raiders(), SOUND.BOULDER_HIT, tile, { range: 8 });
        for (const raider of this.raiders()) {
          if (raider.getLocation().getDistance(tile) <= 1) Shared.strike(this.vasa, raider, "ranged", max, 0, { prayerMultiplier: 1 / 3 });
        }
      });
    });
  }

  modifyHit(npc, hit) {
    const attacker = hit.getAttacker?.()?.isPlayer?.() ? hit.getAttacker().getAsPlayer() : null;
    let factor = 1;
    if (npc === this.vasa) {
      if (this.state === "special" || this.state === "waking") {
        factor = 0;
        attacker?.sendMessage("Vasa Nistirio is preparing a powerful spell and can ignore your puny attack.");
      } else if (npc.getNpcTransformationId() === NPC.SIPHONING) factor = 0;
    } else if (this.crystals.includes(npc)) {
      const { CombatType } = Shared.core();
      if (npc.__coxCrystal !== this.current || this.state !== "siphoning") {
        factor = 0;
        attacker?.sendMessage("The crystal is currently invulerable to damage.");
      } else if (hit.getCombatType?.() === CombatType.RANGED) factor = 0;
      else if (hit.getCombatType?.() === CombatType.MAGIC) factor = 1 / 3;
    } else return;
    if (factor === 1) return;
    for (const part of hit.getHits()) part.setDamage(Math.floor(part.getDamage() * factor));
    hit.updateTotalDamage();
  }

  onNpcDeath(npc) {
    if (npc !== this.vasa) {
      const index = this.crystals.indexOf(npc);
      if (index >= 0) {
        this.crystals[index] = null;
        this.crystalObjects[index] = Shared.replaceObject(this.map, this.crystalObjects[index], OBJECT.DARK);
      }
      return;
    }
    this.state = "dead";
    this.completed = true;
    for (const player of [...(this.near ?? []), ...(this.far ?? [])]) player.__coxNoPrayerUntil = 0;
    const { ObjectManager, Animation } = Shared.core();
    const crystals = this.crystals.filter(Boolean);
    const fire = this.fire;
    this.fire = null;
    Shared.later(this.raid, 3, () => {
      for (const crystal of crystals) this.removeNpc(crystal);
      if (fire) ObjectManager.deregister(fire, true);
      const viewers = this.raiders();
      for (const exit of this.exits) {
        for (const player of viewers) player.getPacketSender().sendObjectAnimation(exit, new Animation(7506));
        Shared.areaSound(viewers, 1021, exit.getLocation(), { range: 10 });
        Shared.areaSound(viewers, 3821, exit.getLocation(), { delay: 5, range: 10 });
        Shared.later(this.raid, 4, () => ObjectManager.deregister(exit, true));
      }
    });
  }
}

Raid.registerRoom("VASA_NISTIRIO", VasaRoom);

/** Vasa's attacks and his crystals are the room's; the core combat stays out. */
function passiveCombat(api) {
  const { CombatMethod, CombatType } = api.core;
  return class VasaPassive extends CombatMethod {
    type() {
      return CombatType.RANGED;
    }

    canAttack() {
      return false;
    }

    hits() {
      return [];
    }
  };
}

function noPrayers(event) {
  const raid = Raid.raidOf(event.player);
  if (!raid || !(event.player.__coxNoPrayerUntil > raid.ticks)) return;
  event.disabled = true;
  event.message = "You have been injured and can't use prayers right now.";
}

function crossFire(event) {
  const room = Raid.raidOf(event.player)?.roomAt(event.player.getLocation());
  if (!(room instanceof VasaRoom)) return false;
  Shared.crossFire(event.player, event.object);
  return true;
}

module.exports = function registerCoxVasa(api) {
  Shared.bind(api);
  api.registerNpcCombatMethodProvider(Object.values(NPC), passiveCombat(api));
  api.onPrayerDisabled(noPrayers);
  Shared.onObjectIds(api, [OBJECT.FIRE], crossFire);
};

Object.assign(module.exports, { VasaRoom });
