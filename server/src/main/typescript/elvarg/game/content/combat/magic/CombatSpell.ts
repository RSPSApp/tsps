import { PluginManager } from "../../../../plugins/PluginManager";

import { Spell, SpellCastContext } from "./Spell";
import { Mobile } from "../../../entity/impl/Mobile";
import { NPC } from "../../../entity/impl/npc/NPC";
import { Animation } from "../../../model/Animation";
import { Graphic } from "../../../model/Graphic";
import { Sound } from "../../../Sound";
import { Projectile } from "../../../model/Projectile";
import { PendingHit } from "../hit/PendingHit";


/**
 * OSRS casts these with a staff variant while a staff is wielded (human_cast*_staff), which hides
 * the staff instead of waving the unarmed animation around it: entangle, strike, confuse, weaken,
 * curse, crumble undead, wave, enfeeble, stun and Tele Block.
 */
const STAFF_CAST_ANIMATIONS: Readonly<Record<number, number>> = {
  710: 1161, 711: 1162, 716: 1163, 717: 1164, 718: 1165,
  724: 1166, 727: 1167, 728: 1168, 729: 1169, 1819: 1820,
};

export abstract class CombatSpell extends Spell {
  protected usesSharedCastDelay(): boolean {
    return true;
  }

  /**
   * Allows spells with a restricted target type to reject a cast before the
   * combat cycle consumes runes. Most combat spells may target anything that
   * the normal combat rules allow.
   */
  public canCastOnTarget(cast: Mobile, target: Mobile): boolean {
    return true;
  }

  /** The cast animation this caster plays: the staff variant while a player wields a staff. */
  public castAnimationFor(cast: Mobile): Animation | undefined {
    const castAnim = this.castAnimation();
    const staffAnim = castAnim ? STAFF_CAST_ANIMATIONS[castAnim.getId()] : undefined;
    if (staffAnim !== undefined && cast.isPlayer() && cast.getAsPlayer().getEquipment().hasStaffEquipped()) {
      return new Animation(staffAnim);
    }
    return castAnim;
  }

  public startCast(cast: Mobile, castOn: Mobile): void {
    let castAnimation = -1;

    const npc = cast.isNpc() ? (cast as NPC) : null;
    const castAnim = this.castAnimationFor(cast);
    if (castAnim !== null && castAnim !== undefined && castAnimation == -1) {
      cast.performAnimation(castAnim);
    } else {
      cast.performAnimation(new Animation(castAnimation));
    }

    if (npc !== null) {
      if (
        npc.getId() !== 2000 &&
        npc.getId() !== 109 &&
        npc.getId() !== 3580 &&
        npc.getId() !== 2007
      ) {
        const startGraphic = this.startGraphic();
        if (startGraphic != null) {
          cast.performGraphic(startGraphic);
        }
      }
    } else {
      const startGraphic = this.startGraphic();
      if (startGraphic != null) {
        cast.performGraphic(startGraphic);
      }
    }

    const projectile = this.castProjectile(cast, castOn);

    if (projectile) {
      projectile.sendProjectile();
    }
  }


  /** XP a splash pays instead of the base XP; most spells pay the same either way. */
  public splashExperience(): number {
    return this.baseExperience();
  }

  public getAttackSpeed(): number {
    return 5;
  }

  abstract spellId(): number;
  abstract maximumHit(): number;
  abstract castAnimation(): Animation | undefined;
  abstract startGraphic(): Graphic | undefined;
  abstract castProjectile(cast: Mobile, castOn: Mobile): Projectile | undefined;
  abstract endGraphic(): Graphic | undefined;
  abstract finishCast(cast: Mobile, castOn: Mobile, accurate: boolean, damage: number, context?: SpellCastContext | null): void;
  abstract levelRequired(): number;
  abstract getSpell(): CombatSpell;

  public onHitCalc(hit: PendingHit): void {
    if (!hit.isAccurate()) {
      return;
    }
    const effect = { attacker: hit.getAttacker(), target: hit.getTarget(), spell: this, hit, allowed: true, effectMultiplier: 1 };
    PluginManager.emitCustomEvent("magic:hit-effects", effect);
    if (!effect.allowed) return;
    this.spellEffectOnHitCalc(effect.attacker, effect.target, hit.getTotalDamage(), effect.effectMultiplier);
    PluginManager.emitCustomEvent("magic:hit-effects-applied", effect);
  }

  public spellEffectOnHitCalc(cast: Mobile, castOn: Mobile, damage: number, effectMultiplier = 1): void { }

  public impactSound(): Sound {
    return null;
  }

  /** The sound played as it's cast, when the spell has its own (null: by spell id, MagicCombatMethod). */
  public castSound(): Sound | null {
    return null;
  }

  /** Ticks until the hit lands, when the spell has its own (null: the usual magic delay). */
  public hitDelay(): number | null {
    return null;
  }
}
