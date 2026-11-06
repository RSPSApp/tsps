"use strict";

/**
 * The champions' attacks. The melee-only ones (Giant, Zombies, Earth Warrior, Jogre, Leon d'Cour)
 * fight with the core NPC melee and their npc-combat-defs.json animations; these six have ranged
 * or magic attacks, named in the cache (champions_* sequences and spot animations). Styles and
 * max hits are the Wiki's; the Ghoul and the Lesser Demon "will not close in to use [their]
 * melee attack" (Wiki), so they keep their distance and swing only at a player beside them.
 *
 * Projectiles use the engine's launch/travel arc (a thrown weapon for ranged, a spell for magic)
 * and the hit lands when the projectile does. The Goblin's spell drains Prayer (the Wiki gives no
 * amount, so one point), and the Imp teleports within the arena when it is damaged.
 *
 *   { style: "MELEE" | "RANGED" | "MAGIC", anim, maxHit?, npcGfx?, projectile?, targetGfx?,
 *     landingTicks?, drainPrayer? }
 */
const Common = require("./Common.ChampionsChallenge");

const REACH = 7;
const PROJECTILE = { startHeight: 43, endHeight: 31 };
/** A spell's launch delay; a thrown weapon's is 41 cycles (see Projectile.createProjectile). */
const PROJECTILE_DELAY = { RANGED: 41, MAGIC: 51 };
/** The Imp's own teleport, when a hit lands (Wiki: short distances, never outside the arena). */
const IMP_TELEPORT = { chance: 0.33, cooldownTicks: 4, minDistance: 2, maxDistance: 6, attempts: 64 };
/** Ordinary poison stores five severity points per starting damage (CombatPoisonEffect). */
const POISON_SEVERITY_PER_DAMAGE = 5;

const GOBLIN_DRAIN = Common.byKey.get("goblin").prayerDrain;

const IMP = [
  { style: "MELEE", anim: 5285 },
  { style: "RANGED", anim: 2955, npcGfx: 493, projectile: 494 },
];
const GOBLIN = [{ style: "MAGIC", anim: 6134, npcGfx: 488, targetGfx: 489, landingTicks: 2, drainPrayer: GOBLIN_DRAIN }];
const SKELETON = [{ style: "RANGED", anim: 5512, landingTicks: 1 }];
const HOBGOBLIN = [{ style: "RANGED", anim: 2959, npcGfx: 490, projectile: 491 }];
const GHOUL = [
  { style: "MELEE", anim: 2967 },
  { style: "RANGED", anim: 2968, npcGfx: 495, projectile: 496 },
];
const LESSER_DEMON = [
  { style: "MELEE", anim: 4680, maxHit: 15 },
  { style: "MAGIC", anim: 4630, maxHit: 14, npcGfx: 497, projectile: 498 },
];

/** Melee when the target is beside the NPC (either attack then), otherwise the distance one. */
function choose(attacks, npc, target) {
  const ranged = attacks.filter((attack) => attack.style !== "MELEE");
  const melee = attacks.filter((attack) => attack.style === "MELEE");
  if (!ranged.length) return melee[0];
  const { Projectile, Misc } = Common.core;
  const beside = melee.length && Projectile.centreOf(npc).getDistance(Projectile.centreOf(target)) <= npc.getSize();
  const options = beside ? attacks : ranged;
  return options[Misc.randomInclusive(0, options.length - 1)];
}

/** A tile the Imp can reach without leaving the arena or standing in a wall. */
function freeArenaTile(session, x, y, z) {
  const tile = session.tile([x, y, z]);
  if ((session.area.getClip(tile) & Common.core.RegionManager.BLOCKED_MASK) !== 0) return null;
  const player = session.player.getLocation();
  if (tile.equals(player)) return null;
  return tile;
}

function teleportImp(session, npc) {
  const { Misc } = Common.core;
  const location = npc.getLocation();
  const [x0, y0] = session.worldTile(location);
  const z = location.getZ();
  const { minX, maxX, minY, maxY } = Common.DATA.arena;
  for (let attempt = 0; attempt < IMP_TELEPORT.attempts; attempt++) {
    const x = Math.min(maxX, Math.max(minX, x0 + Misc.randomInclusive(-IMP_TELEPORT.maxDistance, IMP_TELEPORT.maxDistance)));
    const y = Math.min(maxY, Math.max(minY, y0 + Misc.randomInclusive(-IMP_TELEPORT.maxDistance, IMP_TELEPORT.maxDistance)));
    if (Math.max(Math.abs(x - x0), Math.abs(y - y0)) < IMP_TELEPORT.minDistance) continue;
    const tile = freeArenaTile(session, x, y, z);
    if (!tile) continue;
    npc.getMovementQueue().reset();
    npc.moveTo(tile);
    return true;
  }
  return false;
}

/**
 * Runs once per tick for the champion in its area: the Imp teleports after taking damage, at
 * most every few ticks (the Wiki gives no rate; this keeps it from blinking every hit).
 */
function processChampion(session, npc) {
  const champion = session?.challenge;
  if (!champion?.teleports || npc !== session.champion || npc.getHitpoints() <= 0) return;
  const hitpoints = npc.getHitpoints();
  const previous = npc.__championsChallengeLastHitpoints ?? hitpoints;
  npc.__championsChallengeLastHitpoints = hitpoints;
  const cooldown = Math.max(0, (npc.__championsChallengeTeleportCooldown ?? 0) - 1);
  npc.__championsChallengeTeleportCooldown = cooldown;
  if (hitpoints >= previous || cooldown > 0 || Math.random() >= IMP_TELEPORT.chance) return;
  if (teleportImp(session, npc)) npc.__championsChallengeTeleportCooldown = IMP_TELEPORT.cooldownTicks;
}

/**
 * The Jogre's poison starts at 8 damage (Wiki). The core event carries ordinary-poison severity,
 * so convert the configured starting damage: CombatPoisonEffect.damageFromSeverity(8 * 5) is 8.
 */
function adjustChampionPoison(event) {
  if (!event || event.handled) return;
  const npc = event.attacker;
  const champion = Common.byNpc.get(npc?.getId?.() ?? npc?.getRealId?.());
  const startingDamage = Number(champion?.poison);
  if (!Number.isFinite(startingDamage) || startingDamage <= 0) return;
  event.severity = startingDamage * POISON_SEVERITY_PER_DAMAGE;
  event.venomous = false;
}

/** The tick a hit lands: when the projectile arrives, otherwise the attack's own landing. */
function landingTicks(attack, npc, target) {
  if (attack?.projectile) {
    return Common.core.Projectile.arrivalTicks(npc, target, PROJECTILE_DELAY[attack.style] ?? PROJECTILE_DELAY.RANGED);
  }
  return attack?.landingTicks ?? 0;
}

/** The Goblin's drain, through the same modifiers as other NPC Prayer drains (the spectral shield). */
function drainPrayer(attack, hit, npc) {
  if (!attack?.drainPrayer || !hit?.isAccurate?.() || !hit.getTarget?.()?.isPlayer?.()) return 0;
  const player = hit.getTarget().getAsPlayer();
  let amount = attack.drainPrayer;
  if (typeof Common.core.applyPrayerDrainModifiers === "function") {
    amount = Common.core.applyPrayerDrainModifiers(player, amount, { attacker: hit.getAttacker?.() ?? npc });
  }
  if (amount > 0) player.getSkillManager().decreaseCurrentLevel(Common.core.Skill.PRAYER, amount, 0);
  return amount;
}

function createMethod(attacks) {
  const { CombatMethod, CombatType, CombatFactory, PendingHit, Animation, Graphic, Projectile } = Common.core;
  const distance = attacks.some((attack) => attack.style !== "MELEE") ? REACH : 1;
  return class ChampionCombatMethod extends CombatMethod {
    constructor(npc) {
      super();
      this.npc = npc ?? null;
      this.attack = null;
      this.landing = 0;
    }

    type() {
      return CombatType[this.attack?.style ?? attacks[0].style];
    }

    attackDistance() {
      return distance;
    }

    start(npc, target) {
      const attack = choose(attacks, npc, target);
      this.attack = attack;
      npc.performAnimation(new Animation(attack.anim));
      if (attack.npcGfx) npc.performGraphic(new Graphic(attack.npcGfx));
      this.landing = landingTicks(attack, npc, target);
      if (attack.projectile) {
        const delay = PROJECTILE_DELAY[attack.style] ?? PROJECTILE_DELAY.RANGED;
        Projectile.createProjectile(npc, target, attack.projectile, delay,
          Projectile.arrivalCycles(npc, target, delay), PROJECTILE.startHeight, PROJECTILE.endHeight).sendProjectile();
      }
      if (attack.targetGfx) {
        const graphic = new Graphic(attack.targetGfx);
        if (this.landing > 0 && typeof target.delayedGraphic === "function") target.delayedGraphic(graphic, this.landing);
        else target.performGraphic(graphic);
      }
    }

    hits(npc, target) {
      const attack = this.attack;
      if (!attack) return [];
      const delay = attack.style === "MELEE" ? 0 : Math.max(1, this.landing || 1);
      const hit = new PendingHit(npc, target, this, delay);
      CombatFactory.applyStyleDamage(hit, attack.maxHit ?? npc.getDefinition().getMaxHit());
      return [hit];
    }

    handleAfterHitEffects(hit) {
      drainPrayer(this.attack, hit, this.npc);
    }
  };
}

function attachCombat(api) {
  const npc = (key) => Common.byKey.get(key).npc;
  api.registerNpcCombatMethodProvider(npc("imp"), createMethod(IMP), { singleton: false });
  api.registerNpcCombatMethodProvider(npc("goblin"), createMethod(GOBLIN), { singleton: false });
  api.registerNpcCombatMethodProvider(npc("skeleton"), createMethod(SKELETON), { singleton: false });
  api.registerNpcCombatMethodProvider(npc("hobgoblin"), createMethod(HOBGOBLIN), { singleton: false });
  api.registerNpcCombatMethodProvider(npc("ghoul"), createMethod(GHOUL), { singleton: false });
  api.registerNpcCombatMethodProvider(npc("lesserdemon"), createMethod(LESSER_DEMON), { singleton: false });
  api.onCustomEvent("combat:npc-poison", adjustChampionPoison);
}

module.exports = { attachCombat, choose, drainPrayer, landingTicks, processChampion, teleportImp, adjustChampionPoison };
