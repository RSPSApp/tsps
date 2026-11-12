"use strict";

const fs = require("fs");
const path = require("path");

let core;
let DruidCombat = null;

function data() {
  return JSON.parse(fs.readFileSync(path.join(__dirname, "data", "undead-druids.json"), "utf8"));
}

function methodClass() {
  if (DruidCombat) return DruidCombat;
  const { CombatMethod, CombatType, CombatRange, CombatFactory, CombatPosition, Projectile, PendingHit, Animation, Graphic, GraphicHeight, Sounds, Sound, MagicCombatMethod } = core;
  const config = data();
  const magic = config.magic;

  DruidCombat = class UndeadDruidCombat extends CombatMethod {
    constructor() {
      super();
      this.style = null;
      this.endCycle = 0;
    }

    // A hybrid has magic reach until the attack starts; choose melee only when it is truly reachable.
    type() {
      return this.style ?? CombatType.MAGIC;
    }

    attackDistance() {
      return this.style === CombatType.MELEE ? 1 : magic.range;
    }

    attackSpeed(npc) {
      return npc.getCurrentDefinition?.()?.getAttackSpeed?.() || 4;
    }

    start(npc, target) {
      if (CombatRange.canReach(npc, CombatFactory.MELEE_COMBAT, target)) {
        this.style = CombatType.MELEE;
        npc.performAnimation(new Animation(npc.getAttackAnim()));
        return;
      }

      this.style = CombatType.MAGIC;
      npc.performAnimation(new Animation(magic.animation));
      const cast = new Graphic(magic.launchGraphic);
      cast.height = GraphicHeight.SURGE_CAST;
      npc.performGraphic(cast);

      const distance = CombatPosition.projectileDistance(npc, target);
      this.endCycle = magic.startCycle + distance * 10;
      Projectile.createProjectile(
        npc, target, magic.projectile, magic.startCycle, this.endCycle, magic.startHeight, magic.endHeight,
      ).withAngle(magic.angle).withProgress(magic.progress).sendProjectile();
    }

    finished() {
      // PendingHit snapshots type at construction; clear the swing choice before the next route check.
      this.style = null;
    }

    hits(npc, target) {
      const melee = this.style === CombatType.MELEE;
      const delay = melee ? 1 : Projectile.ticksToLand(this.endCycle);
      const hit = new PendingHit(npc, target, this, delay);
      CombatFactory.applyStyleDamage(hit, melee ? config.melee.maxHit : magic.maxHit);
      return [hit];
    }

    handleAfterHitEffects(hit) {
      if (hit.getCombatType() !== CombatType.MAGIC) return;
      const target = hit.getTarget();
      target.performGraphic(hit.isAccurate()
        ? new Graphic(magic.impactGraphic, GraphicHeight.SURGE_IMPACT)
        : MagicCombatMethod.SPLASH_GRAPHIC);
      if (hit.isAccurate()) Sounds.sendSound(target, new Sound(magic.impactSound, 1, 0, 0));
    }
  };
  return DruidCombat;
}

function attach(api) {
  core = api.core;
  api.registerNpcCombatMethodProvider(data().ids, methodClass(), { singleton: false });
}

module.exports = {
  name: "UndeadDruids",
  description: "Undead Druids use melee at melee range and magic from range, matching the Wiki and RSProx 2966.",
  members: true,
  register: attach,
  _test: { methodClass, data },
};
