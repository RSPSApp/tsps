/**
 * One Cerberus fight, from the moment she stands until her arena empties or she dies
 * (Wiki: Cerberus/Strategies):
 * - her attacks are counted from 1; the first and every 10th is the triple attack, and below
 *   400 hitpoints every 7th summons souls, below 200 every 5th spews lava, in that priority;
 *   a due special has a 10% chance to be an ordinary attack instead;
 * - souls: one ranged, one magic and one melee soul in a random order along the row behind her,
 *   each attacking once, west to east; an unprotected hit is 30 (22 when the Elysian spirit
 *   shield's effect fires), a protected one drains 30 prayer instead, 20 with Ward of Arceuus,
 *   halved again by a spectral spirit shield (15 or 10);
 * - lava: three single-tile pools, one under the target and two near them; 10 on whoever stands
 *   on one as it lands, then 15 every 2 ticks while they stay on it - 12 with an anti-dragon
 *   shield (or an antifire potion with Protect from Magic), 11 with a super antifire; the
 *   landing hit isn't reduced (Wiki: Cerberus/Strategies, lava pools);
 * - a wipe, logout or kill clears the souls and pools.
 * What a fight's Combat Achievement tasks read is kept per Cerberus (lifeOf): how many souls she
 * summoned, and per player the soul attacks they prayed against, the lava damage and the melee
 * soul's damage they took. It outlives stop(), so her death's task rules still read it.
 * Combat.Cerberus.js decides each attack; this keeps the count and runs the specials.
 */
const Common = require("./Common.Cerberus");
const { getDragonfireProtectionTier, DragonfireProtectionTier } = require("../../combat/DragonfireProtection");

/** Cerberus npc -> her current fight's record for Combat Achievements (see the header). */
const lives = new WeakMap();

function lifeOf(npc) {
  return lives.get(npc) ?? null;
}

function addTo(map, player, amount) {
  map.set(player, (map.get(player) ?? 0) + amount);
}

class Fight {
  constructor(arena, npc) {
    this.arena = arena;
    this.npc = npc;
    this.attacks = 0;
    this.tickCount = 0;
    this.stopped = false;
    this.souls = [];
    this.pools = [];
    this.target = null;
    this.life = { soulsSummoned: 0, negated: new Map(), lavaDamage: new Map(), meleeSoulDamage: new Map() };
    lives.set(npc, this.life);
  }

  /** The attack the count says is next: "triple", "souls", "lava" or null (an ordinary one). */
  nextSpecial(random = Math.random) {
    const n = this.attacks + 1;
    const { combat } = Common.data;
    const hp = this.npc.getHitpoints();
    if (n === 1 || (n - 1) % combat.tripleEvery === 0) return "triple";
    if (hp < combat.souls.below && n % combat.souls.every === 0) return random() < combat.skipChance ? null : "souls";
    if (hp < combat.lava.below && n % combat.lava.every === 0) return random() < combat.skipChance ? null : "lava";
    return null;
  }

  counted() {
    this.attacks += 1;
  }

  /** Who she fights: the current target while they are in the arena, else the next player. */
  pickTarget(players) {
    if (this.target && players.includes(this.target)) return this.target;
    this.target = players[0] ?? null;
    return this.target;
  }

  forget(player) {
    if (this.target === player) this.target = null;
    for (const soul of this.souls) if (soul.target === player) Common.api.removeNpc(soul.npc);
    this.souls = this.souls.filter((soul) => soul.target !== player);
  }

  tick(players) {
    if (this.stopped) return;
    // Her pools go out and her waiting souls vanish as she dies (Wiki); one already attacking lands.
    if (this.npc.isDyingFunction?.() || this.npc.getHitpoints() <= 0) {
      this.dying();
      return;
    }
    this.tickCount += 1;
    const target = this.pickTarget(players);
    const combat = this.npc.getCombat();
    if (target && combat.getTarget() !== target) combat.attack(target);
    this.tickPools(players);
    this.tickSouls();
  }

  // --- Lava

  spewLava(target) {
    const { lava } = Common.data.combat;
    const { ids } = Common;
    const tiles = [target.getLocation()];
    const base = target.getLocation();
    for (let attempt = 0; tiles.length < lava.pools && attempt < 20; attempt++) {
      const tile = base.transform(Common.randomInt(-lava.spread, lava.spread), Common.randomInt(-lava.spread, lava.spread));
      if (!this.arena.contains(tile) || Common.distanceToFootprint(tile, this.npc) === 0) continue;
      if (tiles.some((other) => other.getX() === tile.getX() && other.getY() === tile.getY())) continue;
      tiles.push(tile);
    }
    const { Projectile } = Common.core;
    for (const tile of tiles) {
      new Projectile(Projectile.centreOf(this.npc), tile, null, ids.spotanims.lavaFlight, 0, lava.landDelay * 30, 80, 0, null).sendProjectile();
      // Specials start in her combat step, before this tick's count: hence the + 1.
      const landAt = this.tickCount + 1 + lava.landDelay;
      this.pools.push({ tile, landAt, until: landAt + lava.lasts });
    }
  }

  tickPools(players) {
    if (this.pools.length === 0) return;
    const { lava } = Common.data.combat;
    const now = this.tickCount;
    for (const pool of this.pools) {
      if (now < pool.landAt) continue;
      const on = players.filter((player) => sameTile(player.getLocation(), pool.tile));
      const age = now - pool.landAt;
      if (age % lava.tickEvery === 0) Common.tileGraphic(this.arena.players(), pool.tile, Common.ids.spotanims.lavaPool);
      if (age === 0) for (const player of on) addTo(this.life.lavaDamage, player, Common.hurtPlayer(player, lava.landDamage));
      else if (age % lava.tickEvery === 0) for (const player of on) addTo(this.life.lavaDamage, player, Common.hurtPlayer(player, lavaTickDamage(player)));
    }
    this.pools = this.pools.filter((pool) => now < pool.until);
  }

  // --- Souls

  summonSouls(target) {
    const { souls } = Common.data.combat;
    const { ids } = Common;
    const kinds = shuffle(["ranged", "magic", "melee"]);
    const base = this.npc.getLocation();
    souls.row.forEach(([dx, dy], index) => {
      const kind = kinds[index];
      const id = kind === "ranged" ? ids.npcs.soulRanged : kind === "magic" ? ids.npcs.soulMagic : ids.npcs.soulMelee;
      const tile = base.transform(dx, dy);
      const npc = Common.api.spawnNpc({ id, x: tile.getX(), y: tile.getY(), z: tile.getZ(), wanderRadius: 0 });
      if (!npc) return;
      if (this.arena.privateArea) this.arena.privateArea.add(npc);
      this.life.soulsSummoned += 1;
      npc.__skipDefaultRespawn = true;
      npc.getMovementQueue().setBlockMovement(true);
      npc.setFlag?.("combat:no-retaliate");
      const attackAt = this.tickCount + 1 + souls.spawnDelay + index * souls.spacing;
      this.souls.push({ npc, kind, target, attackAt, landAt: attackAt + 1, goneAt: attackAt + 2, attacked: false, landed: false, prayed: false, life: this.life });
    });
  }

  tickSouls() {
    if (this.souls.length === 0) return;
    const now = this.tickCount;
    for (const soul of this.souls) {
      if (!soul.target?.isRegistered?.() || soul.target.getHitpoints() <= 0 || !this.arena.contains(soul.target.getLocation())) {
        Common.api.removeNpc(soul.npc);
        soul.goneAt = now;
        continue;
      }
      if (!soul.attacked && now >= soul.attackAt) {
        soul.attacked = true;
        soulAttack(soul);
      }
      if (soul.attacked && !soul.landed && now >= soul.landAt) {
        soul.landed = true;
        soulHit(soul);
      }
      if (now >= soul.goneAt) Common.api.removeNpc(soul.npc);
    }
    this.souls = this.souls.filter((soul) => now < soul.goneAt);
  }

  dying() {
    this.pools = [];
    for (const soul of this.souls) if (!soul.attacked) Common.api.removeNpc(soul.npc);
    this.souls = this.souls.filter((soul) => soul.attacked);
    this.tickCount += 1;
    this.tickSouls();
  }

  stop() {
    this.stopped = true;
    for (const soul of this.souls) Common.api.removeNpc(soul.npc);
    this.souls = [];
    this.pools = [];
    if (this.npc.__cerberusFight === this) this.npc.__cerberusFight = null;
  }
}

function sameTile(a, b) {
  return a.getX() === b.getX() && a.getY() === b.getY() && a.getZ() === b.getZ();
}

function shuffle(list) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Standing in a pool, by fire protection (Wiki: Cerberus/Strategies, lava pools). */
function lavaTickDamage(player) {
  const { lava } = Common.data.combat;
  const tier = getDragonfireProtectionTier(player);
  if (tier >= DragonfireProtectionTier.SUPER_ANTIFIRE) return lava.tickDamageSuperAntifire;
  const shield = Common.core.CombatEquipment.hasDragonProtectionGear(player);
  const prayers = Common.api.getPrayerHandler();
  const magic = prayers.isActivated(player, prayers.PROTECT_FROM_MAGIC);
  if (shield || (tier >= DragonfireProtectionTier.ANTIFIRE && magic)) return lava.tickDamageShielded;
  return lava.tickDamage;
}

const SOUL_PRAYER = { ranged: "PROTECT_FROM_MISSILES", magic: "PROTECT_FROM_MAGIC", melee: "PROTECT_FROM_MELEE" };

function soulAttack(soul) {
  const { ids } = Common;
  const { Animation, Projectile } = Common.core;
  const seq = soul.kind === "ranged" ? ids.seqs.soulRanged : soul.kind === "magic" ? ids.seqs.soulMagic : ids.seqs.soulMelee;
  soul.npc.performAnimation(new Animation(seq));
  if (!soul.target?.isRegistered?.()) return;
  // The prayer that counts is the one up as the soul attacks (Wiki).
  const prayers = Common.api.getPrayerHandler();
  soul.prayed = prayers.isActivated(soul.target, prayers[SOUL_PRAYER[soul.kind]]);
  const projectile = soul.kind === "ranged" ? ids.spotanims.ranged : soul.kind === "magic" ? ids.spotanims.magic : ids.spotanims.soulMelee;
  new Projectile(Projectile.centreOf(soul.npc), soul.target.getLocation(), soul.target, projectile, 0, 30, 40, 31, soul.npc.getPrivateArea?.() ?? null).sendProjectile();
}

/** A soul's hit: 30, or 30 prayer drained when its style is prayed against. */
function soulHit(soul) {
  const player = soul.target;
  if (!player?.isRegistered?.() || player.getHitpoints?.() <= 0) return;
  const { souls } = Common.data.combat;
  if (soul.prayed) {
    const { Skill, applyPrayerDrainModifiers, ArceuusSpells } = Common.core;
    const base = ArceuusSpells?.hasWard?.(player) ? souls.drainWard : souls.drain;
    const drain = applyPrayerDrainModifiers ? applyPrayerDrainModifiers(player, base, { attacker: soul.npc }) : base;
    if (drain > 0) player.getSkillManager().decreaseCurrentLevel(Skill.PRAYER, drain, 0);
    if (soul.life) addTo(soul.life.negated, player, 1);
    return;
  }
  const damage = Common.hurtPlayer(player, Common.elysianCut(player, souls.damage));
  if (soul.kind === "melee" && soul.life) addTo(soul.life.meleeSoulDamage, player, damage);
}

/** Her fight, attached to the NPC for its combat method. */
function begin(arena, npc) {
  const fight = new Fight(arena, npc);
  npc.__cerberusFight = fight;
  return fight;
}

module.exports = { Fight, begin, soulHit, lavaTickDamage, lifeOf, SOUL_PRAYER };
