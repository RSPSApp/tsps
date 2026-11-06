/**
 * One Shellbane gryphon fight (Wiki: Shellbane_gryphon/Strategies, Whirlwind, Tortugan_shield):
 * - every few attacks a special instead of an auto: the knockback, the corrosive spit or the
 *   whirlwinds (a player at 40 kg worn or more gets the knockback less often - the gryphon
 *   "prioritises" the others, Wiki);
 * - knockback: a player under 40 kg worn is thrown back for up to 30; one at 40 kg or more
 *   stops it, the gryphon left stunned for 2 ticks - hitting it in that window counters the
 *   attack, and if they don't they are thrown back anyway ("regains its focus");
 * - corrosive spit at the player's tile: still standing there, their armour corrodes - 6 hits
 *   of one value from 3 to 12, 5 ticks apart (less the more ranged defence they wear, the Wiki's
 *   captures), ended by taking everything off; with nothing on it's just the one hit;
 * - whirlwinds: one on the player every 3 ticks, up to 5 (one landing on another makes it
 *   stronger); 6 ticks after the last they hurt whoever stands in them each tick, and 15
 *   seconds later they burst, the stronger the wider.
 * Combat.ShellbaneGryphon.js chooses each attack; this runs the specials.
 */
const Common = require("./Common.ShellbaneGryphon");

class Fight {
  constructor(cave, boss, random = Math.random) {
    this.cave = cave;
    this.boss = boss;
    this.random = random;
    this.tickCount = 0;
    this.attacks = 0;
    this.warnedNoShield = false;
    this.knockback = null;
    this.stun = null;
    this.spit = null;
    this.corrosion = null;
    this.whirlwinds = [];
    this.whirling = null;
    this.stopped = false;
  }

  player() {
    return this.cave.players()[0] ?? null;
  }

  // --- Choosing

  /** Which special: the knockback weighted down for a heavy player; no new whirlwinds while some are up. */
  chooseSpecial(player) {
    const heavy = Common.wornWeight(player) >= Common.data.knockback.weight;
    const weights = { knockback: heavy ? Common.data.knockback.heavyWeight : 1, spit: 1, whirlwind: this.whirling ? 0 : 1 };
    const total = Object.values(weights).reduce((sum, w) => sum + w, 0);
    let roll = this.random() * total;
    for (const [kind, weight] of Object.entries(weights)) {
      roll -= weight;
      if (roll < 0) return kind;
    }
    return "spit";
  }

  special(player, kind = this.chooseSpecial(player)) {
    if (kind === "knockback") this.startKnockback(player);
    else if (kind === "spit") this.startSpit(player);
    else this.startWhirlwinds(player);
    return kind;
  }

  // --- Knockback

  startKnockback(player) {
    this.knockback = { lands: this.tickCount + Common.data.knockback.warnTicks };
    this.boss.performAnimation(new Common.core.Animation(Common.ids.seqs.melee));
  }

  tickKnockback(player) {
    if (!this.knockback || this.tickCount < this.knockback.lands) return;
    this.knockback = null;
    const { knockback } = Common.data;
    if (Common.wornWeight(player) >= knockback.weight) {
      player.sendMessage(Common.message("heavyEquipment"));
      this.boss.getCombat?.().extendAttackDelay?.(knockback.stunTicks);
      // The stun is the window to counter-attack in (Wiki): hit it and the knockback is beaten.
      this.stun = { until: this.tickCount + knockback.stunTicks, countered: false };
      return;
    }
    Common.hurtPlayer(player, Common.randomInt(0, knockback.max));
    this.pushAway(player, knockback.push);
  }

  /** The player attacked the gryphon while it was stunned: the knockback is countered. */
  counterKnockback(player) {
    if (!this.stun || this.stun.countered) return false;
    if (player !== this.player()) return false;
    this.stun.countered = true;
    return true;
  }

  /** Not countered in time: thrown back anyway, whatever the player weighs (Wiki). */
  tickStun(player) {
    const stun = this.stun;
    if (!stun || this.tickCount <= stun.until) return;
    this.stun = null;
    if (stun.countered) return;
    player.sendMessage(Common.message("regains"));
    Common.hurtPlayer(player, Common.randomInt(0, Common.data.knockback.max));
    this.pushAway(player, Common.data.knockback.push);
  }

  /** Straight away from the gryphon, stopping at anything in the way; the player can fight on at once. */
  pushAway(player, tiles) {
    const base = this.boss.getLocation();
    const half = (Math.max(1, this.boss.getSize?.() ?? 1) - 1) / 2;
    const at = player.getLocation();
    let dx = Math.sign(at.getX() - (base.getX() + half));
    let dy = Math.sign(at.getY() - (base.getY() + half));
    if (!dx && !dy) dx = -1;
    let to = at;
    for (let i = 0; i < tiles; i++) {
      const next = to.transform(dx, dy);
      if (!this.cave.contains(next) || !walkable(next)) break;
      to = next;
    }
    if (to === at) return;
    player.moveTo(to);
    player.getCombat?.().attack?.(this.boss);
  }

  // --- Corrosive spit

  startSpit(player) {
    const { spit } = Common.data;
    const tile = player.getLocation();
    this.spit = { tile, lands: this.tickCount + spit.landTicks };
    this.boss.performAnimation(new Common.core.Animation(Common.ids.seqs.spit));
    const { Projectile } = Common.core;
    new Projectile(Projectile.centreOf(this.boss), tile, null, Common.ids.spotanims.spitProjectile, 30, spit.landTicks * 30, 60, 0, this.boss.getPrivateArea?.() ?? null).sendProjectile();
  }

  /** One splat, less for more ranged defence worn (about +125 gives 3, the Wiki's talk page). */
  corrosionHit(player) {
    const { spit } = Common.data;
    const { BonusManager } = Common.core;
    const defence = Number(player.getBonusManager?.()?.getDefenceBonus?.()?.[BonusManager?.DEFENCE_RANGE ?? 4]) || 0;
    const share = Math.min(1, Math.max(0, 1 - defence / spit.fullDefence));
    const max = spit.min + Math.round((spit.max - spit.min) * share);
    return Common.randomInt(spit.min, Math.max(spit.min, max));
  }

  tickSpit(player) {
    if (!this.spit || this.tickCount < this.spit.lands) return;
    const { tile } = this.spit;
    this.spit = null;
    Common.tileGraphic(player, tile, Common.ids.spotanims.spitSplash);
    if (Common.chebyshev(player.getLocation(), tile) !== 0) return;
    if (!wearsAnything(player)) {
      Common.hurtPlayer(player, this.corrosionHit(player));
      return;
    }
    const { spit } = Common.data;
    this.corrosion = { left: spit.hits, next: this.tickCount + spit.every, every: spit.every, damage: this.corrosionHit(player) };
    player.sendMessage(Common.message("corroding"));
  }

  tickCorrosion(player) {
    const corrosion = this.corrosion;
    if (!corrosion) return;
    if (!wearsAnything(player)) {
      this.corrosion = null;
      player.sendMessage(Common.message("stopsCorroding"));
      return;
    }
    if (this.tickCount < corrosion.next) return;
    Common.hurtPlayer(player, corrosion.damage);
    corrosion.left -= 1;
    corrosion.next = this.tickCount + corrosion.every;
    if (corrosion.left <= 0) this.corrosion = null;
  }

  // --- Whirlwinds

  startWhirlwinds(player) {
    this.boss.performAnimation(new Common.core.Animation(Common.ids.seqs.whirlwind));
    player.sendMessage(Common.message("whirlwind"));
    this.whirling = { placed: 0, next: this.tickCount, armAt: null, burstAt: null };
  }

  whirlwindAt(tile) {
    return this.whirlwinds.find((w) => w.tile.getX() === tile.getX() && w.tile.getY() === tile.getY()) ?? null;
  }

  setObject(whirlwind, active) {
    const world = this.cave.world;
    if (whirlwind.object) world.removeObject(whirlwind.object);
    const key = `${active ? "whirlwindActive" : "whirlwind"}${whirlwind.strength}`;
    whirlwind.object = world.placeObject(Common.ids.locs[key], whirlwind.tile);
  }

  tickWhirlwinds(player) {
    const whirling = this.whirling;
    if (!whirling) return;
    const { whirlwind } = Common.data;
    if (whirling.placed < whirlwind.count && this.tickCount >= whirling.next) {
      const tile = player.getLocation();
      const existing = this.whirlwindAt(tile);
      if (existing) {
        existing.strength = Math.min(5, existing.strength + 1);
        this.setObject(existing, false);
      } else {
        const created = { tile, strength: 1, object: null };
        this.whirlwinds.push(created);
        this.setObject(created, false);
      }
      whirling.placed += 1;
      whirling.next = this.tickCount + whirlwind.every;
      if (whirling.placed === whirlwind.count) whirling.armAt = this.tickCount + whirlwind.armTicks;
    }
    if (whirling.armAt !== null && this.tickCount === whirling.armAt) {
      for (const w of this.whirlwinds) this.setObject(w, true);
      whirling.burstAt = this.tickCount + whirlwind.burstTicks;
    }
    if (whirling.burstAt !== null && this.tickCount > whirling.armAt && this.tickCount < whirling.burstAt) {
      const under = this.whirlwindAt(player.getLocation());
      if (under) {
        const [min, max] = whirlwind.perTick[under.strength - 1];
        Common.hurtPlayer(player, Common.randomInt(min, max));
      }
    }
    if (whirling.burstAt !== null && this.tickCount >= whirling.burstAt) this.burst(player);
  }

  /** Each whirlwind bursts: its own damage on anyone within its radius (strength 5: the whole cave). */
  burst(player) {
    const { whirlwind } = Common.data;
    player.sendMessage(Common.message("burst"));
    let hit = 0;
    for (const w of this.whirlwinds) {
      if (Common.chebyshev(player.getLocation(), w.tile) > whirlwind.radius[w.strength - 1]) continue;
      const [min, max] = whirlwind.burst[w.strength - 1];
      hit = Math.max(hit, Common.randomInt(min, max));
    }
    if (hit > 0) Common.hurtPlayer(player, hit);
    this.clearWhirlwinds();
  }

  clearWhirlwinds() {
    for (const w of this.whirlwinds) if (w.object) this.cave.world.removeObject(w.object);
    this.whirlwinds = [];
    this.whirling = null;
  }

  // --- A tick

  tick() {
    if (this.stopped) return;
    this.tickCount += 1;
    const player = this.player();
    if (!player) return;
    // Dying (or about to be), its specials go with it.
    if (this.boss.getHitpoints() <= 0 || this.boss.isDyingFunction?.() === true) {
      this.stop();
      return;
    }
    // Immune to poison and venom (Wiki).
    if ((this.boss.getPoisonDamage?.() ?? 0) > 0) this.boss.setPoisonDamage(0);
    this.boss.setVenomed?.(false);
    this.tickKnockback(player);
    this.tickStun(player);
    this.tickSpit(player);
    this.tickCorrosion(player);
    this.tickWhirlwinds(player);
  }

  stop() {
    this.stopped = true;
    this.knockback = null;
    this.stun = null;
    this.spit = null;
    this.corrosion = null;
    this.clearWhirlwinds();
  }
}

/** Nothing in the way on the map (walls, rocks and the like). */
function walkable(tile) {
  const { RegionManager } = Common.core;
  if (!RegionManager?.getClipping) return true;
  return (RegionManager.getClipping(tile.getX(), tile.getY(), tile.getZ(), null) & RegionManager.BLOCKED_MASK) === 0;
}

function wearsAnything(player) {
  return (player.getEquipment?.()?.getItems?.() ?? []).some((item) => (item?.getId?.() ?? -1) >= 0);
}

module.exports = { Fight, wearsAnything };
