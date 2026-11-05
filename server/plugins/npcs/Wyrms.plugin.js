"use strict";

/**
 * Wyrms and wyrmlings in combat, from plugins/npcs/data/wyrms.json (docs/wyrms.md).
 *
 * A wyrm attacks with melee when its target is beside it, and with magic otherwise, so one
 * attacked from a distance only uses magic (Wiki). Each style has its own max hit: the hit is
 * rolled up to the NPC's max hit (its magic one) and, for melee, scaled down, which keeps
 * protection prayers applied. Wyrmlings only melee. Rising and sinking are DormantNpcs'.
 */
const fs = require("fs");
const path = require("path");

let api = null;
let DATA = null;
/** Family name -> its combat method class. */
const classes = new Map();

function core() {
  return api.core;
}

function data() {
  DATA ??= JSON.parse(fs.readFileSync(path.join(__dirname, "data", "wyrms.json"), "utf8"));
  return DATA;
}

/** The tiles a mobile covers: [minX, minY, maxX, maxY]. */
function footprint(mobile) {
  const at = mobile.getLocation();
  const size = Math.max(1, mobile.getSize?.() ?? 1);
  return [at.getX(), at.getY(), at.getX() + size - 1, at.getY() + size - 1];
}

/** Whether the target touches the NPC's footprint along an edge (not diagonally). */
function beside(npc, target) {
  if (npc.getLocation().getZ() !== target.getLocation().getZ()) return false;
  const [ax, ay, bx, by] = footprint(npc);
  const [cx, cy, dx, dy] = footprint(target);
  const gapX = Math.max(0, cx - bx, ax - dx);
  const gapY = Math.max(0, cy - by, ay - dy);
  return (gapX === 1 && gapY === 0) || (gapX === 0 && gapY === 1);
}

function travelCycles(npc, target) {
  const { delay, length, perTile } = data().projectile;
  return delay + length + core().CombatPosition.projectileDistance(npc, target) * perTile;
}

/** The combat method for one family; the provider makes one per attack, so it keeps no state between attacks. */
function methodFor(family) {
  if (classes.has(family.name)) return classes.get(family.name);
  const { CombatMethod, CombatType, PendingHit, Animation, Graphic, GraphicHeight, Projectile, MagicCombatMethod } = core();
  const MethodClass = class WyrmCombatMethod extends CombatMethod {
    constructor() {
      super();
      this.style = null;
    }

    /** Until an attack starts: magic reach for a wyrm (it casts rather than closing in), melee for a wyrmling. */
    type() {
      return this.style ?? (family.magic ? CombatType.MAGIC : CombatType.MELEE);
    }

    attackDistance() {
      return this.type() === CombatType.MAGIC ? data().magicRange : 1;
    }

    attackSpeed(character) {
      return character.getCurrentDefinition?.()?.getAttackSpeed?.() || 4;
    }

    start(character, target) {
      const melee = !family.magic || beside(character, target);
      this.style = melee ? CombatType.MELEE : CombatType.MAGIC;
      const attack = melee ? family.melee : family.magic;
      character.performAnimation(new Animation(attack.anim));
      if (!melee) {
        const { delay, startHeight, endHeight } = data().projectile;
        Projectile.createProjectile(character, target, attack.projectile, delay, travelCycles(character, target), startHeight, endHeight)
          .sendProjectile();
      }
    }

    hits(character, target) {
      const melee = this.type() === CombatType.MELEE;
      // Magic hits as the projectile lands; rounding its flight down hit a tick early at most ranges.
      const delay = melee ? 1 : Projectile.ticksToLand(travelCycles(character, target));
      const hit = new PendingHit(character, target, this, delay);
      // Rolled up to the NPC's max hit (the magic one), with protection prayers applied; melee's is lower.
      const rolledUpTo = character.getCurrentDefinition?.()?.getMaxHit?.() ?? 0;
      const styleMax = (melee ? family.melee : family.magic).maxHit;
      if (rolledUpTo > styleMax) hit.setTotalDamage(Math.floor((hit.getTotalDamage() * styleMax) / rolledUpTo));
      return [hit];
    }

    handleAfterHitEffects(hit) {
      if (!family.magic || hit.getCombatType() !== CombatType.MAGIC) return;
      hit.getTarget().performGraphic(hit.isAccurate() ? new Graphic(family.magic.impact, GraphicHeight.HIGH) : MagicCombatMethod.SPLASH_GRAPHIC);
    }
  };
  classes.set(family.name, MethodClass);
  return MethodClass;
}

module.exports = {
  name: "Wyrms",
  members: true,
  register(pluginApi) {
    api = pluginApi;
    for (const family of data().families) pluginApi.registerNpcCombatMethodProvider(family.ids, methodFor(family), { singleton: false });
  },
  _test: { beside, methodFor, data },
};
