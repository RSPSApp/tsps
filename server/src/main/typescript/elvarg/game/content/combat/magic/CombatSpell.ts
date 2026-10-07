
import { Spell } from "./Spell";
import { Mobile } from "../../../entity/impl/Mobile";
import { NPC } from "../../../entity/impl/npc/NPC";
import { Animation } from "../../../model/Animation";
import { Graphic } from "../../../model/Graphic";
import { Sound } from "../../../Sound";
import { Projectile } from "../../../model/Projectile";
import { PendingHit } from "../hit/PendingHit";


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

  public startCast(cast: Mobile, castOn: Mobile): void {
    let castAnimation = -1;

    const npc = cast.isNpc() ? (cast as NPC) : null;
    const castAnim = this.castAnimation();
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


  public getAttackSpeed(): number {
    return 5;
  }

  abstract spellId(): number;
  abstract maximumHit(): number;
  abstract castAnimation(): Animation | undefined;
  abstract startGraphic(): Graphic | undefined;
  abstract castProjectile(cast: Mobile, castOn: Mobile): Projectile | undefined;
  abstract endGraphic(): Graphic | undefined;
  abstract finishCast(cast: Mobile, castOn: Mobile, accurate: boolean, damage: number): void;
  abstract levelRequired(): number;
  abstract getSpell(): CombatSpell;

  public onHitCalc(hit: PendingHit): void {
    if (!hit.isAccurate()) {
      return;
    }
    this.spellEffectOnHitCalc(hit.getAttacker(), hit.getTarget(), hit.getTotalDamage());
  }

  public spellEffectOnHitCalc(cast: Mobile, castOn: Mobile, damage: number): void { }

  public impactSound(): Sound {
    return null;
  }

  /** Ticks until the hit lands, when the spell has its own (null: the usual magic delay). */
  public hitDelay(): number | null {
    return null;
  }
}
