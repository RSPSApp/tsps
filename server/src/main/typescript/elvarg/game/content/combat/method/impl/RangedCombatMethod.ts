import { CombatMethod } from "../CombatMethod";
import { CombatType } from "../../CombatType";
import { CombatFactory } from "../../CombatFactory";
import { Ammunition, RangedWeapon } from "../../ranged/RangedData";
import { PendingHit } from "../../hit/PendingHit";
import { Mobile } from "../../../../entity/impl/Mobile";
import { Animation } from "../../../../model/Animation";
import { Projectile } from "../../../../model/Projectile";
import { Sound } from "../../../../Sound";
import { Sounds } from "../../../../Sounds";
import { WeaponProfiles } from "../../WeaponProfile";
import type { ProjectileProfile } from "../../WeaponProfile";
export class RangedCombatMethod extends CombatMethod {
    /** Bronze arrow; used when an npc has no projectile configured. */
    private static readonly DEFAULT_NPC_PROJECTILE = 10;

    type(): CombatType {
        return CombatType.RANGED;
    }

    hits(character: Mobile, target: Mobile): PendingHit[] {
        const distance = character.getLocation().getDistance(target.getLocation());
        const delays = character.isPlayer() ? WeaponProfiles.hitDelays(character.getAsPlayer(), distance) : [1];
        return delays.map((delay) => new PendingHit(character, target, this, delay));
    }

    canAttack(character: Mobile, target: Mobile): boolean {
        if (character.isNpc()) {
            return true;
        }

        const p = character.getAsPlayer();

        if (!CombatFactory.checkAmmo(p, WeaponProfiles.ranged(p).ammoRequired ?? 1)) {
            return false;
        }
        return true;
    }

    shouldRenew(character: Mobile): boolean {
        if (!character.isPlayer()) return true;
        const player = character.getAsPlayer();
        player.getCombat().setRangedWeapon(RangedWeapon.getFor(player));
        player.getCombat().setAmmunition(Ammunition.getFor(player));
        if (player.getCombat().getRangedWeapon() == null) return false;
        return CombatFactory.checkAmmo(player, WeaponProfiles.ranged(player).ammoRequired ?? 1, true);
    }

    start(character: Mobile, target: Mobile) {
        const ammo = character.getCombat().getAmmunition();
        const rangedWeapon = character.getCombat().getRangedWeapon();
        const animation = character.getAttackAnim();

        if (animation !== -1) {
            character.performAnimation(new Animation(animation));
        }

        const profile = character.isPlayer() ? WeaponProfiles.ranged(character.getAsPlayer()) : null;
        if (ammo?.getStartGraphic() && profile?.startGraphic !== false) {
            character.performGraphic(ammo.getStartGraphic());
        }

        if (character.isNpc()) {
            // NPCs have no ranged weapon or ammo. Give them the projectile configured
            // in npc-combat-defs.json, falling back to a generic arrow so the shot is
            // at least visible.
            const configured = character.getAsNpc().getCurrentDefinition().getProjectileId();
            const projectileId = configured >= 0 ? configured : RangedCombatMethod.DEFAULT_NPC_PROJECTILE;
            Projectile.createProjectile(character, target, projectileId, 40, 57, 43, 31).sendProjectile();
            return;
        }

        if (!rangedWeapon || !ammo) {
            return;
        }

        const projectiles = profile?.projectiles ?? [{ delay: 41, lengthAdjustment: 5, stepMultiplier: 5, startHeight: 43, endHeight: 31 }];
        const distance = character.getLocation().getDistance(target.getLocation());
        const processingOrder = target.isNpc() ? 1 : 0;
        const hitDelays = WeaponProfiles.hitDelays(character.getAsPlayer(), distance)
            .map((ticks) => ticks + processingOrder);
        for (let index = 0; index < projectiles.length; index++) {
            const projectile = projectiles[index];
            const end = RangedCombatMethod.projectileEnd(projectile, distance);
            Projectile.createProjectile(character, target, ammo.getProjectileId(), projectile.delay, end, projectile.startHeight, projectile.endHeight).sendProjectile();
        }
        Sounds.sendSound(character, profile?.fireSound ?? Sound.SHOOT_ARROW);

        if (character.isPlayer()) {
            // The shot's ammo is consumed when its hit lands, like the hitsplat.
            const flightTicks = Math.max(1, ...hitDelays);
            CombatFactory.decrementAmmo(character.getAsPlayer(), target.getLocation(), profile?.ammoRequired ?? 1, flightTicks);
        }
    }

    /**
     * A projectile's landing offset in client cycles, from the OSRS server projanim types:
     * delay + lengthAdjustment + stepMultiplier * distance. Profiles without a step keep
     * their flat speed as the end offset.
     */
    public static projectileEnd(projectile: ProjectileProfile, distance: number): number {
        if (projectile.stepMultiplier != null) {
            return projectile.delay + (projectile.lengthAdjustment ?? 0) + projectile.stepMultiplier * distance;
        }
        return projectile.speed ?? projectile.delay + 1;
    }

    attackDistance(character: Mobile): number {
        return character.isPlayer() ? WeaponProfiles.attackDistance(character.getAsPlayer(), 6) : 6;
    }

}
