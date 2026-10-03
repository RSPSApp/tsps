// Volcanic creatures shared by the TzHaar Fight Cave and Fight Pit.
// Mechanics: https://oldschool.runescape.wiki/w/TzHaar_Fight_Cave#Monsters
// Animation/spotanim ids: RuneLite gameval (MAGMAQURIS_* = Tok-Xil, IGNIFERUM_* = Ket-Zek,
// LIZARD_CLERIC_* = Yt-MejKot, LORDMAGMUS_* = TzTok-Jad, TZHAAR_* spotanims).
module.exports = function registerTzhaarMonsters(api) {
  const {
    Animation, CombatFactory, CombatMethod, CombatType, Graphic, HitDamage, HitMask,
    MeleeCombatMethod, Misc, NpcIdentifiers: Npcs, PendingHit, Projectile, Skill, Task, TaskManager,
  } = api.core;

  const HEAL_GRAPHIC = new Graphic(444); // TZHAAR_HEAL
  const MEJKOT_HEAL_ANIM = new Animation(2639); // LIZARD_CLERIC_HEAL
  const MEJKOT_MAX_HEAL = 10;
  const JAD_IMPACT_TICKS = 3;
  const JAD_ATTACK_RANGE = 15;

  // Tz-Kih drains prayer by the damage dealt plus one on every melee attack.
  class TzKihCombat extends MeleeCombatMethod {
    handleAfterHitEffects(hit) {
      const target = hit.getTarget();
      if (!target.isPlayer()) return;
      target.getSkillManager().decreaseCurrentLevel(Skill.PRAYER, hit.getTotalDamage() + 1, 0);
    }
  }

  // Tok-Xil and Ket-Zek: melee when adjacent, their missile otherwise.
  class TzhaarHybridCombat extends CombatMethod {
    constructor(style, meleeAnim, farAnim, projectile, impact) {
      super();
      this.farStyle = style;
      this.meleeAnim = new Animation(meleeAnim);
      this.farAnim = new Animation(farAnim);
      this.projectile = projectile;
      this.impact = impact ? new Graphic(impact) : null;
      this.style = style;
    }

    start(npc, target) {
      this.style = npc.calculateDistance(target) <= 1 ? CombatType.MELEE : this.farStyle;
      if (this.style === CombatType.MELEE) {
        npc.performAnimation(this.meleeAnim);
        return;
      }
      npc.performAnimation(this.farAnim);
      Projectile.createProjectile(npc, target, this.projectile, 40, Projectile.arrivalCycles(npc, target), 43, 31)
        .sendProjectile();
    }

    hits(npc, target) {
      if (this.style === CombatType.MELEE) return [new PendingHit(npc, target, this, 1)];
      const delay = Projectile.arrivalTicks(npc, target);
      if (this.impact) target.delayedGraphic(this.impact, delay);
      return [new PendingHit(npc, target, this, delay)];
    }

    attackDistance() {
      return 8;
    }

    type() {
      return this.style;
    }
  }

  class TokXilCombat extends TzhaarHybridCombat {
    constructor() {
      super(CombatType.RANGED, 2628, 2633, 443);
    }
  }

  class KetZekCombat extends TzhaarHybridCombat {
    constructor() {
      super(CombatType.MAGIC, 2644, 2647, 445, 446);
    }
  }

  // Yt-MejKot swaps an attack for a heal of up to 10 on itself or an adjacent creature under
  // half health. Only fellow members of a private instance are considered.
  class YtMejKotCombat extends MeleeCombatMethod {
    start(npc, target) {
      this.patient = findPatient(npc);
      if (!this.patient) {
        super.start(npc, target);
        return;
      }
      npc.performAnimation(MEJKOT_HEAL_ANIM);
      this.patient.performGraphic(HEAL_GRAPHIC);
      this.patient.heal(Misc.randomInclusive(1, MEJKOT_MAX_HEAL));
    }

    hits(npc, target) {
      return this.patient ? [] : super.hits(npc, target);
    }
  }

  // Style-fixed carrier for Jad's delayed hits: the shared Jad method's style has moved on by
  // the time the hit lands, and PendingHit reads its type when it is built.
  class FixedStyleCombat extends CombatMethod {
    constructor(style) {
      super();
      this.style = style;
    }

    type() {
      return this.style;
    }

    hits() {
      return [];
    }
  }

  const JAD_STYLES = {
    [CombatType.RANGED]: { anim: new Animation(2652), method: new FixedStyleCombat(CombatType.RANGED) },
    [CombatType.MAGIC]: { anim: new Animation(2656), method: new FixedStyleCombat(CombatType.MAGIC) },
  };
  const JAD_MELEE_ANIM = new Animation(2655);
  const JAD_ROCK_GRAPHIC = new Graphic(451); // TZHAAR_ROCK_SMASH
  const JAD_FIREBALL = 448; // TZHAAR_FIRE_SPIT_TRAVEL

  // Rolled when it lands, so the protection prayer that counts is the one up at impact -
  // the whole point of the fight is switching after reading the animation.
  class JadImpact extends Task {
    constructor(jad, target, method) {
      super(JAD_IMPACT_TICKS, jad, false);
      this.jad = jad;
      this.target = target;
      this.method = method;
    }

    execute() {
      this.stop();
      if (this.jad.getHitpoints() <= 0 || this.target.getHitpoints() <= 0) return;
      CombatFactory.addPendingHit(new PendingHit(this.jad, this.target, this.method, 0));
    }
  }

  class TzTokJadCombat extends CombatMethod {
    start(jad, target) {
      const adjacent = jad.calculateDistance(target) <= 1;
      this.style = adjacent && Misc.getRandom(2) === 0
        ? CombatType.MELEE
        : Misc.getRandom(1) === 0 ? CombatType.RANGED : CombatType.MAGIC;
      if (this.style === CombatType.MELEE) {
        jad.performAnimation(JAD_MELEE_ANIM);
        return;
      }
      jad.performAnimation(JAD_STYLES[this.style].anim);
      if (this.style === CombatType.RANGED) {
        target.delayedGraphic(JAD_ROCK_GRAPHIC, JAD_IMPACT_TICKS - 1);
      } else {
        Projectile.createProjectile(jad, target, JAD_FIREBALL, 25, Projectile.arrivalCycles(jad, target), 110, 33)
          .sendProjectile();
      }
    }

    hits(jad, target) {
      if (this.style === CombatType.MELEE) return [new PendingHit(jad, target, this, 0)];
      TaskManager.submit(new JadImpact(jad, target, JAD_STYLES[this.style].method));
      return [];
    }

    attackDistance() {
      return JAD_ATTACK_RANGE;
    }

    type() {
      return this.style ?? CombatType.MAGIC;
    }
  }

  function findPatient(npc) {
    const hurt = (other) => other.getHitpoints() > 0 && other.getHitpoints() < other.getDefinition().getHitpoints() / 2;
    if (hurt(npc)) return npc;
    const area = npc.getPrivateArea();
    if (!area) return null;
    return area.getNpcs().find((other) => other !== npc && hurt(other) && npc.calculateDistance(other) <= 1) ?? null;
  }

  // Tz-Kek returns 1 damage to whoever hits it in melee, however hard the blow.
  const BIG_TZ_KEK = new Set([Npcs.TZ_KEK_3, Npcs.TZ_KEK_4]);
  function tzKekRecoil({ attacker, target, hit }) {
    if (!attacker?.isPlayer?.() || !target?.isNpc?.() || !BIG_TZ_KEK.has(target.getId())) return;
    if (hit.getCombatType() !== CombatType.MELEE) return;
    attacker.getCombat().getHitQueue().addPendingDamage([new HitDamage(1, HitMask.RED)]);
  }

  api.registerNpcCombatMethodProvider([Npcs.TZ_KIH_3, Npcs.TZ_KIH_4], TzKihCombat);
  api.registerNpcCombatMethodProvider([Npcs.TOK_XIL_4, Npcs.TOK_XIL_5], TokXilCombat);
  api.registerNpcCombatMethodProvider([Npcs.YT_MEJKOT, Npcs.YT_MEJKOT_2], YtMejKotCombat);
  api.registerNpcCombatMethodProvider([Npcs.KET_ZEK, Npcs.KET_ZEK_2], KetZekCombat);
  api.registerNpcCombatMethodProvider(Npcs.TZTOK_JAD, TzTokJadCombat);
  api.onCombatHitResolved(tzKekRecoil);
};
