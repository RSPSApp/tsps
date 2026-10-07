// Combat for the Inferno's creatures, waves 1-68 and TzKal-Zuk's summoned help.
// Mechanics: https://oldschool.runescape.wiki/w/The_Inferno#Monsters
// Animation ids are the per-NPC sets in data/definitions/npc-animations.json (RuneLite).
//
// Every ranged and magic hit is rolled when it lands, not when it is fired: the protection
// prayer that counts is the one up at impact, which is what prayer flicking in the Inferno
// relies on. Melee lands on the tick it is thrown.
module.exports = function registerInfernoMonsters(api, hooks) {
  const {
    Animation, CombatFactory, CombatMethod, CombatType, Graphic, Misc, NpcIdentifiers: Npcs,
    PendingHit, PrayerHandler, Projectile, Task, TaskManager, World,
  } = api.core;

  const LONG_RANGE = 14;
  const ZUK_WAVE_RANGE = 30;
  const BAT_RANGE = 3;
  const BAT_RUN_DRAIN = 3;
  const JAD_RANGE = 15;
  const JAD_IMPACT_TICKS = 3;
  const BLOB_SCAN_TICKS = 2;
  const MAGER_REVIVE_ANIM = new Animation(7611);
  const JAD_ROCK_GRAPHIC = new Graphic(451); // TZHAAR_ROCK_SMASH
  const JAD_FIREBALL = 448; // TZHAAR_FIRE_SPIT_TRAVEL

  // Carries a hit's style on its own: PendingHit reads the style from its method as it is
  // built, and an attack's method has usually moved on by then.
  class FixedStyle extends CombatMethod {
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

  const STYLES = {
    [CombatType.MELEE]: new FixedStyle(CombatType.MELEE),
    [CombatType.RANGED]: new FixedStyle(CombatType.RANGED),
    [CombatType.MAGIC]: new FixedStyle(CombatType.MAGIC),
  };

  /** Runs `action` after `ticks`, unless the NPC has died in the meantime. */
  function later(npc, ticks, action) {
    TaskManager.submit(new class extends Task {
      execute() {
        this.stop();
        if (npc.getHitpoints() > 0 && npc.isRegistered()) action();
      }
    }(Math.max(1, ticks), npc, false));
  }

  /** Lands a hit of `style` after `ticks`, rolled (prayer included) at that moment. */
  function land(npc, target, style, ticks, onLand) {
    TaskManager.submit(new class extends Task {
      execute() {
        this.stop();
        if (target.getHitpoints() <= 0 || !target.isRegistered()) return;
        CombatFactory.addPendingHit(new PendingHit(npc, target, STYLES[style], 0));
        onLand?.(target);
      }
    }(Math.max(1, ticks), npc, false));
  }

  function fire(npc, target, projectileId, style, onLand) {
    Projectile.createProjectile(npc, target, projectileId, 40, Projectile.arrivalCycles(npc, target), 43, 31)
      .sendProjectile();
    land(npc, target, style, Projectile.arrivalTicks(npc, target), onLand);
  }

  const adjacent = (npc, target) => npc.calculateDistance(target) <= 1;
  const praying = (target, prayer) => target.isPlayer() && PrayerHandler.isActivated(target, prayer);

  // One style per attack, picked as it starts. `type()` is the style that decides how close
  // the creature has to get, so a hybrid keeps its distance between melee swings.
  class InfernoCombat extends CombatMethod {
    constructor({ melee, ranged, magic, range = LONG_RANGE, zukWaveId = -1 }) {
      super();
      this.meleeAnim = melee ? new Animation(melee) : null;
      this.far = ranged ? { style: CombatType.RANGED, ...ranged } : magic ? { style: CombatType.MAGIC, ...magic } : null;
      this.range = range;
      this.zukWaveId = zukWaveId;
    }

    chooseStyle(npc, target) {
      if (!this.far) return CombatType.MELEE;
      if (this.meleeAnim && adjacent(npc, target) && Misc.getRandom(1) === 0) return CombatType.MELEE;
      return this.far.style;
    }

    start(npc, target) {
      npc.__infernoLastStrike = World.getProcessCycle();
      this.style = this.chooseStyle(npc, target);
    }

    hits(npc, target) {
      if (this.style === CombatType.MELEE) {
        npc.performAnimation(this.meleeAnim);
        return [new PendingHit(npc, target, STYLES[CombatType.MELEE], 0)];
      }
      npc.performAnimation(new Animation(this.far.anim));
      fire(npc, target, this.far.projectile, this.style, (landed) => this.landed(npc, landed));
      return [];
    }

    landed() {}

    attackDistance(npc) {
      if (!this.far) return 1;
      return npc.getId() === this.zukWaveId ? ZUK_WAVE_RANGE : this.range;
    }

    type() {
      return this.far ? this.far.style : CombatType.MELEE;
    }
  }

  // Jal-Nib: they only turn on the player once every support is down, and then every attack
  // lands, whatever the player wears (Wiki: Jal-Nib). On a support the hit is rolled as usual.
  class JalNibCombat extends InfernoCombat {
    constructor() {
      super({ melee: 7574 });
    }

    hits(npc, target) {
      if (!target.isPlayer()) return super.hits(npc, target);
      npc.performAnimation(this.meleeAnim);
      return [new PendingHit(npc, target, STYLES[CombatType.MELEE], { delay: 0, rollAccuracy: false })];
    }
  }

  // Jal-MejRah: a short-range ranged bat whose hits sap run energy.
  class JalMejRahCombat extends InfernoCombat {
    constructor() {
      super({ ranged: { anim: 7578, projectile: 1382 }, range: BAT_RANGE });
    }

    landed(npc, target) {
      if (!target.isPlayer()) return;
      target.setRunEnergy(Math.max(0, target.getRunEnergy() - BAT_RUN_DRAIN));
      target.getPacketSender().sendRunEnergy();
    }
  }

  const BLOB_ATTACKS = {
    [CombatType.RANGED]: { anim: 7583, projectile: 1378 },
    [CombatType.MAGIC]: { anim: 7581, projectile: 1380 },
  };

  // Jal-Ak reads the player's protection prayer, then attacks with a style that prayer does
  // not cover. Unprotected, it picks at random - melee too, up close.
  class JalAkCombat extends InfernoCombat {
    constructor() {
      super({ melee: 7582, ranged: BLOB_ATTACKS[CombatType.RANGED] });
    }

    chooseStyle(npc, target) {
      if (praying(target, PrayerHandler.PROTECT_FROM_MAGIC)) return CombatType.RANGED;
      if (praying(target, PrayerHandler.PROTECT_FROM_MISSILES)) return CombatType.MAGIC;
      if (adjacent(npc, target) && Misc.getRandom(1) === 0) return CombatType.MELEE;
      return Misc.getRandom(1) === 0 ? CombatType.RANGED : CombatType.MAGIC;
    }

    hits(npc, target) {
      const style = this.style;
      later(npc, BLOB_SCAN_TICKS, () => {
        if (target.getHitpoints() <= 0) return;
        if (style === CombatType.MELEE) {
          if (!adjacent(npc, target)) return;
          npc.performAnimation(this.meleeAnim);
          CombatFactory.addPendingHit(new PendingHit(npc, target, STYLES[style], 0));
          return;
        }
        npc.performAnimation(new Animation(BLOB_ATTACKS[style].anim));
        fire(npc, target, BLOB_ATTACKS[style].projectile, style);
      });
      return [];
    }
  }

  // Jal-Zek can raise a fallen creature at half health instead of attacking. The copies
  // TzKal-Zuk summons do not.
  class JalZekCombat extends InfernoCombat {
    constructor() {
      super({ melee: 7612, magic: { anim: 7610, projectile: 1376 }, zukWaveId: Npcs.JAL_ZEK_2 });
    }

    start(npc, target) {
      this.reviving = npc.getId() === Npcs.JAL_ZEK && hooks.tryRevive(npc);
      if (this.reviving) {
        npc.performAnimation(MAGER_REVIVE_ANIM);
        return;
      }
      super.start(npc, target);
    }

    hits(npc, target) {
      return this.reviving ? [] : super.hits(npc, target);
    }
  }

  // JalTok-Jad: melee up close, otherwise ranged or magic told apart by the animation, both
  // landing three ticks after it.
  class JalTokJadCombat extends CombatMethod {
    start(jad, target) {
      npcStrike(jad);
      this.style = adjacent(jad, target) && Misc.getRandom(2) === 0
        ? CombatType.MELEE
        : Misc.getRandom(1) === 0 ? CombatType.RANGED : CombatType.MAGIC;
      if (this.style === CombatType.MELEE) {
        jad.performAnimation(new Animation(7590));
      } else if (this.style === CombatType.RANGED) {
        jad.performAnimation(new Animation(7593));
        target.delayedGraphic(JAD_ROCK_GRAPHIC, JAD_IMPACT_TICKS - 1);
      } else {
        jad.performAnimation(new Animation(7592));
        Projectile.createProjectile(jad, target, JAD_FIREBALL, 25, Projectile.arrivalCycles(jad, target), 110, 33)
          .sendProjectile();
      }
    }

    hits(jad, target) {
      if (this.style === CombatType.MELEE) return [new PendingHit(jad, target, STYLES[CombatType.MELEE], 0)];
      land(jad, target, this.style, JAD_IMPACT_TICKS);
      return [];
    }

    attackDistance() {
      return JAD_RANGE;
    }

    type() {
      return CombatType.MAGIC;
    }
  }

  function npcStrike(npc) {
    npc.__infernoLastStrike = World.getProcessCycle();
  }

  const meleeOnly = (anim) => class extends InfernoCombat {
    constructor() {
      super({ melee: anim });
    }
  };

  api.registerNpcCombatMethodProvider(Npcs.JAL_NIB, JalNibCombat);
  api.registerNpcCombatMethodProvider(Npcs.JAL_MEJRAH, JalMejRahCombat);
  api.registerNpcCombatMethodProvider(Npcs.JAL_AK, JalAkCombat);
  api.registerNpcCombatMethodProvider(Npcs.JAL_AKREK_MEJ, class extends InfernoCombat {
    constructor() {
      super({ magic: { anim: 7581, projectile: 1381 } });
    }
  });
  api.registerNpcCombatMethodProvider(Npcs.JAL_AKREK_XIL, class extends InfernoCombat {
    constructor() {
      super({ ranged: { anim: 7583, projectile: 1379 } });
    }
  });
  api.registerNpcCombatMethodProvider(Npcs.JAL_AKREK_KET, meleeOnly(7582));
  api.registerNpcCombatMethodProvider(Npcs.JAL_IMKOT, meleeOnly(7597));
  api.registerNpcCombatMethodProvider([Npcs.JAL_XIL, Npcs.JAL_XIL_2], class extends InfernoCombat {
    constructor() {
      super({ melee: 7604, ranged: { anim: 7605, projectile: 1377 }, zukWaveId: Npcs.JAL_XIL_2 });
    }
  });
  api.registerNpcCombatMethodProvider([Npcs.JAL_ZEK, Npcs.JAL_ZEK_2], JalZekCombat);
  api.registerNpcCombatMethodProvider([Npcs.JALTOK_JAD, Npcs.JALTOK_JAD_2], JalTokJadCombat);

  return { later, land };
};
