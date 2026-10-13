"use strict";

/**
 * Vespula's room: Vespula, four lux grubs she stings and an abyssal portal. The portal's
 * destruction ends the fight; vespine soldiers hatch from neglected grubs and heal her and it.
 *
 * Wiki (Vespula; Lux grub; Abyssal portal; Chambers of Xeric/Strategies, Vespula):
 * - Vespula isn't aggressive but answers attacks with ranged (poison from 20) while stinging
 *   grubs. A stung grub's meter drains; fed medivaemia blossoms it refills; at zero it bursts
 *   into a vespine soldier (melee, poison from 15) that heals Vespula and the portal.
 *   Grubs have 125 hitpoints.
 * - Flying, Vespula (and flying soldiers) can only be hurt by Magic, Ranged or halberds.
 * - From 20% health she may land each time she's hit (certainly at 1 hitpoint) and stays down
 *   ~20 seconds, when the portal can safely be attacked; otherwise she flies again, healed.
 * - Attacking the portal while she flies enrages her: she flies before it stinging anyone in
 *   melee range for 5-20 typeless and stomping those under her for 2-8 a tick.
 * - Septic tendrils close the way in once the fight starts, hurting those passing them.
 * rsprox captures (recordings 820, 843, 3389):
 * - Stinging a grub: 7454 (15 client cycles' delay) and sound 570 (range 8) at the grub, which
 *   turns sickly (7535) the tick after, infected (7536) lower down.
 * - Hitting the portal enrages her (7531) and closes the tendrils; enraged she stings every 3
 *   ticks (7454, sound 819, range 5); every 21 ticks of it she is flying for a tick and, still
 *   provoked, enraged again. The portal fires projectile 1366 every 2 ticks (0 to 60 cycles,
 *   angle 2, heights 140 to 120).
 * - A grub at zero dies (7537) as a soldier hatches beside it (7460, gfx 1365); it is healthy
 *   again 37 ticks later. Soldiers heal every 5 ticks (gfx 1367 at height 200, sound 808).
 * - The portal falling: the grubs go, Vespula and the soldiers die (7459, landed 7458), the roots
 *   empty and the pillars play 7500 on that tick, with "As the link to the Abyss disintegrates,
 *   the abyssal creatures perish."; 2 ticks later they are gone and the boils burst (gfx 240,
 *   sound 1457); the pillars close 2 ticks after that.
 * Not on the Wiki (to check against a capture): the tiles; the portal draining 1 + 3% prayer
 *   (or 1-2 damage with none); soldiers healing 17; Vespula's ranged (anim 7455 / 7450 landed,
 *   projectile 1364 at the target and a tile near it, base 15, poison 1 in 4); landing 7457,
 *   rising 7452; soldiers landing at 20% and exploding 17 ticks later (gfx 1368, 15-30 within
 *   3); blossoms healing a grub 20%; roots regrowing 8 ticks after picking; a stung grub's meter
 *   draining 1 every 4 ticks; landed Vespula staying down 33 ticks (~20 seconds).
 */

const Shared = require("./CoxShared");
const Raid = require("./CoxRaid");
const Monsters = require("./CoxMonsters");

const NPC = { VESPULA: 7530, ENRAGED: 7531, LANDED: 7532, PORTAL: 7533, GRUB: 7534, STUNG: 7535, STUNG_LOW: 7536, BURST: 7537, SOLDIER: 7538, SOLDIER_LANDED: 7539 };
const OBJECT = { TENDRIL: 30024, ROOT: 30068, PICKED_ROOT: 30069, BOIL: 30070, BURST_BOIL: 30071, PILLARS: 30072, GONE_PILLARS: 30073 };
const BLOSSOM = 20892;
const HALBERD = /halberd/i;
const LANDED_TICKS = 33;
const GRUB_DRAIN_TICKS = 4;
const GRUB_REGROW_TICKS = 37;
const ENRAGED_TICKS = 20;
const SOLDIER_HEAL = { EVERY: 5, AMOUNT: 17, GFX: 1367, SOUND: 808 };
const SOUND = { STING: 570, ENRAGED_STING: 819, BOIL: 1457 };

/** Cache tiles by version (centres). */
const GRUB_TILES = [
  [{ x: 3287, y: 5289 }, { x: 3285, y: 5294 }, { x: 3277, y: 5286 }, { x: 3278, y: 5294 }],
  [{ x: 3312, y: 5289 }, { x: 3304, y: 5291 }, { x: 3312, y: 5297 }, { x: 3304, y: 5297 }],
  [{ x: 3344, y: 5294 }, { x: 3337, y: 5286 }, { x: 3337, y: 5294 }, { x: 3334, y: 5290 }],
];
const SOLDIER_TILES = [
  [{ x: 3284, y: 5289 }, { x: 3285, y: 5291 }, { x: 3277, y: 5289 }, { x: 3278, y: 5291 }],
  [{ x: 3309, y: 5289 }, { x: 3307, y: 5291 }, { x: 3309, y: 5297 }, { x: 3307, y: 5297 }],
  [{ x: 3344, y: 5291 }, { x: 3337, y: 5289 }, { x: 3337, y: 5291 }, { x: 3337, y: 5290 }],
];
const BOIL_TILES = [[{ x: 3267, y: 5295 }, { x: 3267, y: 5296 }], [{ x: 3311, y: 5308 }, { x: 3312, y: 5308 }], [{ x: 3356, y: 5296 }, { x: 3356, y: 5295 }]];
const TENDRIL_TILES = [[{ x: 3279, y: 5280 }, { x: 3280, y: 5280 }], [{ x: 3311, y: 5280 }, { x: 3312, y: 5280 }], [{ x: 3343, y: 5280 }, { x: 3344, y: 5280 }]];
const PORTAL_TILES = [{ x: 3281, y: 5300 }, { x: 3318, y: 5291 }, { x: 3339, y: 5300 }];
const VESPULA_TILES = [{ x: 3281, y: 5290 }, { x: 3308, y: 5292 }, { x: 3341, y: 5290 }];
const PORTAL_SHOT_FROM = [{ x: 3282, y: 5302 }, { x: 3320, y: 5292 }, { x: 3341, y: 5302 }];
const PORTAL_HIT_TILES = [[{ x: 3281, y: 5293 }, { x: 3282, y: 5293 }], [{ x: 3311, y: 5293 }, { x: 3311, y: 5292 }], [{ x: 3340, y: 5293 }, { x: 3341, y: 5293 }]];

class VespulaRoom extends Raid.Room {
  constructor(raid, record) {
    super(raid, record);
    this.grubs = [];
    this.tendrils = [];
    this.loaded = false;
  }

  load() {
    const variant = this.record.variant;
    this.portalHitTiles = PORTAL_HIT_TILES[variant].map((spot) => this.tile(spot.x, spot.y));
    this.portalShotFrom = this.tile(PORTAL_SHOT_FROM[variant].x, PORTAL_SHOT_FROM[variant].y);
  }

  combatPoints() {
    const inputs = this.raid.scaling ?? this.raid.scalingInputs();
    const vespula = Monsters.scale(NPC.VESPULA, inputs)?.hitpoints ?? 0;
    const portal = Monsters.scale(NPC.PORTAL, inputs)?.hitpoints ?? 0;
    return Math.floor(5 * (vespula + portal) * 1.05) + 100 * 4 * 4;
  }

  /** The fight is set up when the first raider walks in (not on the Wiki). */
  enter(player) {
    super.enter?.(player);
    if (this.loaded || this.raid.stage === Raid.STAGE.WAITING) return;
    this.loaded = true;
    const variant = this.record.variant;
    for (let i = 0; i < 4; i++) {
      const at = GRUB_TILES[variant][i];
      const grub = this.spawnNpc(NPC.GRUB, this.tile(at.x - 1, at.y - 1, 3), { scale: false });
      if (!grub) continue;
      const soldierAt = SOLDIER_TILES[variant][i];
      grub.__coxSoldierTile = this.tile(soldierAt.x - 1, soldierAt.y - 1, 3);
      grub.getMovementQueue().setBlockMovement?.(true);
      this.grubs.push(grub);
    }
    const { GameObject, ObjectManager } = Shared.core();
    this.boils = BOIL_TILES[variant].map((spot) => {
      const boil = new GameObject(OBJECT.BOIL, this.tile(spot.x, spot.y), 10, 0, this.map);
      ObjectManager.register(boil, true);
      return boil;
    });
    this.roots = this.templateObjects(OBJECT.PICKED_ROOT).map((root) => Shared.replaceObject(this.map, root, OBJECT.ROOT));
    this.pillars = this.templateObjects(OBJECT.PILLARS)[0] ?? null;
    const portal = PORTAL_TILES[variant];
    this.portal = this.spawnNpc(NPC.PORTAL, this.tile(portal.x, portal.y, 6));
    this.portal?.getMovementQueue().setBlockMovement?.(true);
    const spot = VESPULA_TILES[variant];
    this.vespula = this.spawnNpc(NPC.VESPULA, this.tile(spot.x - 2, spot.y - 2, 5));
    this.home = this.vespula?.getLocation().clone();
    this.stingWait = 2;
  }

  alive(npc) {
    return npc?.isRegistered() && npc.getHitpoints() > 0;
  }

  tick() {
    if (!this.loaded || this.completed || !this.alive(this.vespula)) return;
    this.tickGrubs();
    this.tickPortal();
    this.tickVespula();
    for (const grub of this.grubs) {
      const soldier = grub.__coxSoldier;
      if (soldier?.isRegistered() && soldier.getId() === NPC.SOLDIER_LANDED) this.tickLandedSoldier(soldier);
    }
  }

  /** Stung grubs drain; at zero one bursts into a soldier. */
  tickGrubs() {
    for (const grub of this.grubs) {
      if (grub.__coxBurstUntil != null) {
        if (this.raid.ticks >= grub.__coxBurstUntil) {
          grub.__coxBurstUntil = null;
          grub.setNpcTransformationId(-1);
          grub.setHitpoints(grub.getMaxHitpoints());
        }
        continue;
      }
      if (grub.getHitpoints() >= grub.getMaxHitpoints()) {
        if (grub.getNpcTransformationId() > 0) grub.setNpcTransformationId(-1);
        continue;
      }
      if (this.raid.ticks % GRUB_DRAIN_TICKS === 0) grub.setHitpoints(Math.max(0, grub.getHitpoints() - 1));
      grub.setNpcTransformationId(grub.getHitpoints() <= grub.getMaxHitpoints() / 2 ? NPC.STUNG_LOW : NPC.STUNG);
      if (grub.getHitpoints() <= 0) this.burst(grub);
    }
  }

  /** The grub dies as a soldier hatches beside it; it is a healthy grub again 37 ticks later. */
  burst(grub) {
    grub.__coxBurstUntil = this.raid.ticks + GRUB_REGROW_TICKS;
    grub.setNpcTransformationId(NPC.BURST);
    Shared.animate(grub, -1);
    const soldier = this.spawnNpc(NPC.SOLDIER, grub.getLocation().clone());
    if (!soldier) return;
    grub.__coxSoldier = soldier;
    Shared.animate(soldier, 7460);
    soldier.performGraphic(Shared.gfx(1365));
    soldier.__coxHealAt = this.raid.ticks + SOLDIER_HEAL.EVERY;
    Shared.walkStraight(soldier, grub.__coxSoldierTile);
    soldier.__coxDelay = this.raid.ticks + 5;
  }

  liveSoldiers() {
    return this.grubs.map((grub) => grub.__coxSoldier).filter((soldier) => this.alive(soldier));
  }

  tickPortal() {
    const portal = this.portal;
    if (!this.alive(portal)) return;
    for (const soldier of this.liveSoldiers()) {
      if (this.raid.ticks < soldier.__coxHealAt) continue;
      soldier.__coxHealAt = this.raid.ticks + SOLDIER_HEAL.EVERY;
      soldier.performGraphic(Shared.gfx(SOLDIER_HEAL.GFX, { height: 200 }));
      Shared.areaSound(this.raiders(), SOLDIER_HEAL.SOUND, soldier.getLocation(), { range: 6 });
      portal.heal(SOLDIER_HEAL.AMOUNT);
      this.vespula.heal(SOLDIER_HEAL.AMOUNT);
    }
    if (this.raid.ticks % 2 !== 0) return;
    for (const player of this.raiders()) {
      if (!this.portalHitTiles.some((tile) => tile.equals(player.getLocation()))) continue;
      const tile = player.getLocation().clone();
      new (Shared.core().Projectile)(this.portalShotFrom, tile, null, 1366, 0, 60, 35, 30, this.map).withAngle(2).withProgress(128).sendProjectile();
      Shared.later(this.raid, 1, () => {
        if (!player.getLocation().equals(tile)) return;
        const { Skill } = Shared.core();
        const skills = player.getSkillManager();
        const prayer = skills.getCurrentLevel(Skill.PRAYER);
        if (prayer > 0) skills.setCurrentLevel(Skill.PRAYER, Math.max(0, prayer - (1 + Math.round(prayer * 0.03))), true);
        else Shared.damage(player, Shared.random(1, 2));
      });
    }
  }

  portalUnderAttack() {
    return this.portalHitAt != null && this.raid.ticks - this.portalHitAt < ENRAGED_TICKS;
  }

  tickVespula() {
    const vespula = this.vespula;
    if (this.stingWait > 0) {
      this.stingWait--;
      return;
    }
    const form = vespula.getNpcTransformationId() > 0 ? vespula.getNpcTransformationId() : vespula.getId();
    if (form === NPC.LANDED) {
      if (this.raid.ticks >= this.landedUntil) {
        vespula.setHitpoints(vespula.getMaxHitpoints());
        Shared.animate(vespula, 7452);
        vespula.setNpcTransformationId(-1);
      }
      return;
    }
    if (this.portalUnderAttack()) return this.enraged(form);
    if (form === NPC.ENRAGED) vespula.setNpcTransformationId(-1);
    this.enraging = false;
    if (--this.stingDelay > 0) return;
    const grub = this.stinging;
    if (grub && grub.getHitpoints() >= grub.getMaxHitpoints() && grub.__coxBurstUntil == null) {
      if (!vespula.getMovementQueue().isMovings()) {
        this.stinging = null;
        vespula.performAnimation(new (Shared.core().Animation)(7454, 15));
        Shared.areaSound(this.raiders(), SOUND.STING, grub.getLocation(), { delay: 15, range: 8 });
        vespula.setPositionToFace(grub.getLocation());
        Shared.later(this.raid, 1, () => grub.setHitpoints(Math.floor(grub.getMaxHitpoints() / 2)));
        this.stingDelay = 4;
      }
      return;
    }
    if (this.liveSoldiers().length > 0) return;
    const next = this.grubs
      .filter((other) => other.getHitpoints() >= other.getMaxHitpoints() && other.__coxBurstUntil == null)
      .sort((a, b) => b.getLocation().getDistance(vespula.getLocation()) - a.getLocation().getDistance(vespula.getLocation()))[0];
    if (!next) return;
    this.stinging = next;
    vespula.getCombat().reset();
    Shared.core().PathFinder.calculateEntityRoute(vespula, next);
  }

  /** Wiki: before the portal, stinging those in reach (5-20) and stomping those under her (2-8). */
  enraged(form) {
    const vespula = this.vespula;
    const at = vespula.getLocation();
    for (const player of this.raiders()) {
      const x = player.getLocation().getX() - at.getX();
      const y = player.getLocation().getY() - at.getY();
      if (x >= 0 && x < 5 && y >= 0 && y < 5) Shared.damage(player, Shared.random(2, 8));
    }
    if (form !== NPC.ENRAGED) {
      vespula.getCombat().reset();
      if (!this.enraging) {
        this.enraging = true;
        vespula.getMovementQueue().reset();
      }
      if (vespula.getLocation().equals(this.home)) {
        vespula.setNpcTransformationId(NPC.ENRAGED);
        this.enragedAt = this.raid.ticks;
      }
      else if (!vespula.getMovementQueue().isMovings()) Shared.core().PathFinder.calculateWalkRoute(vespula, this.home.getX(), this.home.getY());
      return;
    }
    // Every 21 ticks enraged she is flying for a tick; still provoked, she is enraged again.
    if (this.raid.ticks - this.enragedAt >= ENRAGED_TICKS) {
      vespula.setNpcTransformationId(-1);
      return;
    }
    if (--this.stingDelay > 0) return;
    this.stingDelay = 3;
    const reach = this.raiders().filter((player) => {
      const x = player.getLocation().getX() - at.getX();
      const y = player.getLocation().getY() - at.getY();
      return (x >= -1 && x <= 5 && y >= -1 && y <= 5) && !(x >= 0 && x < 5 && y >= 0 && y < 5);
    });
    if (reach.length === 0) return;
    const tile = Shared.randomOf(reach).getLocation();
    vespula.setPositionToFace(tile);
    Shared.animate(vespula, 7454);
    Shared.areaSound(this.raiders(), SOUND.ENRAGED_STING, tile, { range: 5 });
    const { CombatFactory } = Shared.core();
    for (const player of reach) {
      if (player.getLocation().getDistance(tile) > 1) continue;
      Shared.damage(player, Shared.random(5, 20));
      if (Shared.random(0, 3) === 0) CombatFactory.poisonEntity(player, 20);
    }
  }

  tickLandedSoldier(soldier) {
    soldier.__coxLandedTicks = (soldier.__coxLandedTicks ?? 0) + 1;
    if (!soldier.__coxChasing || !this.raid.players.has(soldier.__coxChasing)) soldier.__coxChasing = Shared.randomOf(this.raiders());
    if (soldier.__coxChasing && !soldier.getMovementQueue().isMovings()) Shared.core().PathFinder.calculateEntityRoute(soldier, soldier.__coxChasing);
    if (soldier.__coxLandedTicks < 17) return;
    const at = soldier.getLocation().clone();
    Shared.graphicAt(this.raiders(), 1368, at);
    for (const player of this.raiders()) {
      Shared.sound(player, 1021);
      if (player.getLocation().getDistance(at) <= 3) Shared.damage(player, Shared.random(15, 30));
    }
    this.removeNpc(soldier);
  }

  /** Vespula's ranged: at the target and a tile near it, poison 1 in 4. */
  attack(npc, player) {
    if (npc === this.vespula) {
      const landed = npc.getNpcTransformationId() === NPC.LANDED;
      Shared.animate(npc, landed ? 7450 : 7455);
      const max = Monsters.maxHitFor(npc, 15, Monsters.LEVELS.RANGED);
      const delay = Shared.projectile(this.map, npc, player, 1364, { delay: landed ? 30 : 60, duration: 24, startHeight: 20, endHeight: 15 });
      Shared.strike(npc, player, "ranged", max, delay, { prayerMultiplier: 0.5 });
      const { Location, CombatFactory } = Shared.core();
      const near = new Location(player.getLocation().getX() + Shared.random(-2, 2), player.getLocation().getY() + Shared.random(-2, 2), player.getLocation().getZ());
      const nearDelay = Shared.projectile(this.map, npc, near, 1364, { delay: landed ? 30 : 60, duration: 24, startHeight: 20, endHeight: 0 });
      Shared.later(this.raid, nearDelay, () => {
        for (const raider of this.raiders()) {
          if (raider.getLocation().getDistance(near) > 1) continue;
          Shared.strike(npc, raider, "ranged", max, 0, { prayerMultiplier: 0.5 });
          if (Shared.random(0, 3) === 0) CombatFactory.poisonEntity(raider, 20);
        }
      });
      return;
    }
    if (npc.getId() === NPC.SOLDIER || npc.getId() === NPC.SOLDIER_LANDED) {
      if (npc.__coxDelay > this.raid.ticks) return;
      Shared.animate(npc, 7454);
      Shared.sound(player, 819);
      Shared.strike(npc, player, "melee", this.raid.challenge ? 21 : 16, 0, { prayerMultiplier: 0.5 });
      if (Shared.random(0, 2) === 0) Shared.core().CombatFactory.poisonEntity(player, 15);
    }
  }

  modifyHit(npc, hit) {
    const { CombatType } = Shared.core();
    const type = hit.getCombatType?.();
    const form = npc.getNpcTransformationId() > 0 ? npc.getNpcTransformationId() : npc.getId();
    if (npc === this.portal) {
      this.portalHitAt = this.raid.ticks;
      this.closeTendrils();
      return;
    }
    // Landed, Vespula and the soldiers can't be reached by Ranged or Magic.
    if ((form === NPC.LANDED || form === NPC.SOLDIER_LANDED) && (type === CombatType.RANGED || type === CombatType.MAGIC)) {
      for (const part of hit.getHits()) part.setDamage(0);
      hit.updateTotalDamage();
      return;
    }
    if (npc === this.vespula && form !== NPC.LANDED) {
      const after = npc.getHitpoints() - hit.getTotalDamage();
      // Wiki: from 20% she may land when hit; she always lands rather than die.
      if (after <= npc.getMaxHitpoints() * 0.2 && (after <= 1 || Shared.random(0, 2) === 0)) {
        if (after < 1) {
          for (const part of hit.getHits()) part.setDamage(0);
          hit.updateTotalDamage();
          npc.setHitpoints(Math.max(1, npc.getHitpoints()));
        }
        this.land();
      }
    }
    const soldier = this.liveSoldiers().includes(npc) ? npc : null;
    if (soldier && form === NPC.SOLDIER && npc.getHitpoints() - hit.getTotalDamage() <= npc.getMaxHitpoints() * 0.2) {
      Shared.animate(npc, 7457);
      npc.setNpcTransformationId(NPC.SOLDIER_LANDED);
      Monsters.restat(npc, NPC.SOLDIER_LANDED, this.raid.scaling);
    }
  }

  land() {
    const vespula = this.vespula;
    Shared.animate(vespula, 7457);
    vespula.setNpcTransformationId(NPC.LANDED);
    vespula.getCombat().reset();
    this.landedUntil = this.raid.ticks + LANDED_TICKS;
  }

  /** Vespula never dies of her wounds; the portal's fall ends her. */
  beforeNpcDeath(npc) {
    if (npc !== this.vespula || this.completed) return false;
    npc.setHitpoints(1);
    if (npc.getNpcTransformationId() !== NPC.LANDED) this.land();
    return true;
  }

  closeTendrils() {
    if (this.tendrils.length || this.completed) return;
    const { GameObject, ObjectManager } = Shared.core();
    this.tendrils = TENDRIL_TILES[this.record.variant].map((spot) => {
      const tendril = new GameObject(OBJECT.TENDRIL, this.tile(spot.x, spot.y), 10, 0, this.map);
      ObjectManager.register(tendril, true);
      return tendril;
    });
  }

  onNpcDeath(npc) {
    if (npc !== this.portal) return;
    this.completed = true;
    const { Animation, ObjectManager } = Shared.core();
    const viewers = this.raiders();
    if (this.pillars) {
      for (const player of viewers) player.getPacketSender().sendObjectAnimation(this.pillars, new Animation(7500));
      const pillars = this.pillars;
      Shared.later(this.raid, 4, () => Shared.replaceObject(this.map, pillars, OBJECT.GONE_PILLARS));
    }
    for (const player of this.raid.players) {
      player.sendMessage("<col=ef20ff>As the link to the Abyss disintegrates, the abyssal creatures perish.</col>");
    }
    const dying = [];
    if (this.alive(this.vespula)) {
      Shared.animate(this.vespula, this.vespula.getNpcTransformationId() === NPC.LANDED ? 7458 : 7459);
      dying.push(this.vespula);
    }
    for (const grub of this.grubs) {
      const soldier = grub.__coxSoldier;
      if (this.alive(soldier)) {
        Shared.animate(soldier, 7459);
        dying.push(soldier);
      }
      this.removeNpc(grub);
    }
    for (const root of this.roots ?? []) Shared.replaceObject(this.map, root, OBJECT.PICKED_ROOT);
    Shared.later(this.raid, 2, () => {
      for (const creature of dying) {
        creature.setHitpoints(0);
        this.removeNpc(creature);
      }
      const now = this.raiders();
      for (const boil of this.boils ?? []) {
        const burst = Shared.replaceObject(this.map, boil, OBJECT.BURST_BOIL);
        Shared.graphicAt(now, 240, burst.getLocation(), { height: 5 });
        Shared.areaSound(now, SOUND.BOIL, burst.getLocation(), { range: 10 });
      }
      for (const tendril of this.tendrils) ObjectManager.deregister(tendril, true);
      this.tendrils = [];
    });
  }

  feed(player, grub) {
    if (grub.getHitpoints() >= grub.getMaxHitpoints() || grub.__coxBurstUntil != null) {
      player.sendMessage("It doesn't look like it needs feeding.");
      return;
    }
    if (!Shared.has(player, BLOSSOM)) {
      Shared.statement(player, "You need some medivaemia roots to feed the grubs.");
      return;
    }
    player.getInventory().delete(BLOSSOM, 1);
    grub.heal(Math.floor(grub.getMaxHitpoints() * 0.2));
    Shared.animate(player, 827);
    Shared.sound(player, 2393);
  }

  pickRoot(player, root) {
    if (this.completed || root.getId() !== OBJECT.ROOT) return;
    if (player.getInventory().getFreeSlots() <= 0) {
      Shared.statement(player, "You don't have space to hold it.");
      return;
    }
    Shared.animate(player, 832);
    Shared.sound(player, 2581);
    Shared.give(player, BLOSSOM);
    const index = this.roots.indexOf(root);
    const picked = Shared.replaceObject(this.map, root, OBJECT.PICKED_ROOT);
    if (index >= 0) this.roots[index] = picked;
    Shared.later(this.raid, 8, () => {
      if (this.completed || index < 0 || this.roots[index] !== picked) return;
      this.roots[index] = Shared.replaceObject(this.map, picked, OBJECT.ROOT);
    });
  }
}

Raid.registerRoom("VESPULA", VespulaRoom);

function roomOf(player) {
  const room = Raid.raidOf(player)?.roomAt(player.getLocation());
  return room instanceof VespulaRoom ? room : null;
}

function vespulaCombat(api) {
  const { CombatMethod, CombatType } = api.core;
  return class VespulaCombat extends CombatMethod {
    type() {
      return CombatType.RANGED;
    }

    attackDistance(npc) {
      return npc.getId() === NPC.VESPULA ? 10 : 1;
    }

    attackSpeed(npc) {
      return npc.getId() === NPC.VESPULA ? 3 : 4;
    }

    canAttack(npc) {
      const room = npc.__coxRoom;
      return room instanceof VespulaRoom && !room.completed && npc.getNpcTransformationId() !== NPC.ENRAGED;
    }

    start(npc, target) {
      const room = npc.__coxRoom;
      if (room instanceof VespulaRoom && target?.isPlayer?.()) room.attack(npc, target.getAsPlayer());
    }

    hits() {
      return [];
    }
  };
}

/** Wiki: flying, she and her soldiers can't be meleed except with a halberd. */
function flyingTooHigh(event) {
  const target = event.target;
  const room = target?.__coxRoom;
  if (!(room instanceof VespulaRoom) || !event.attacker?.isPlayer?.()) return;
  const form = target.getNpcTransformationId() > 0 ? target.getNpcTransformationId() : target.getId();
  if (![NPC.VESPULA, NPC.ENRAGED, NPC.SOLDIER].includes(form)) return;
  const { CombatType, Equipment } = Shared.core();
  if (event.method?.type?.() !== CombatType.MELEE) return;
  const player = event.attacker.getAsPlayer();
  const weapon = player.getEquipment().getItems()[Equipment.WEAPON_SLOT]?.getId?.();
  const name = weapon >= 0 ? Shared.core().ItemDefinition.forId(weapon)?.getName?.() ?? "" : "";
  if (HALBERD.test(name)) return;
  event.allow = false;
  player.sendMessage("The creature is flying too high for you to attack using melee.");
}

function feedGrub(event) {
  const room = event.npc?.__coxRoom;
  if (!(room instanceof VespulaRoom)) return false;
  room.feed(event.player, event.npc);
  return true;
}

function blossomOnGrub(event) {
  const grub = event.target;
  const room = grub?.__coxRoom;
  if (event.handled || !(room instanceof VespulaRoom) || !room.grubs.includes(grub)) return;
  if (event.itemId !== BLOSSOM) {
    event.player.sendMessage("The creature doesn't seem to want that.");
  } else {
    room.feed(event.player, grub);
  }
  event.handled = true;
}

function pickRoot(event) {
  const room = roomOf(event.player);
  if (!room) return false;
  room.pickRoot(event.player, event.object);
  return true;
}

function passTendrils(event) {
  if (!roomOf(event.player)) return false;
  Shared.damage(event.player, Shared.random(5, 10));
  Shared.crossFire(event.player, event.object);
  return true;
}

module.exports = function registerCoxVespula(api) {
  Shared.bind(api);
  api.registerNpcCombatMethodProvider([NPC.VESPULA, NPC.ENRAGED, NPC.LANDED, NPC.SOLDIER, NPC.SOLDIER_LANDED, NPC.PORTAL], vespulaCombat(api));
  Raid.onRaidArea("canAttack", flyingTooHigh);
  api.onNpcInteraction("Lux grub", { Feed: feedGrub });
  api.onItemOnNpc(blossomOnGrub);
  Shared.onObjectIds(api, [OBJECT.ROOT], pickRoot);
  Shared.onObjectIds(api, [OBJECT.TENDRIL], passTendrils);
};

Object.assign(module.exports, { VespulaRoom });
