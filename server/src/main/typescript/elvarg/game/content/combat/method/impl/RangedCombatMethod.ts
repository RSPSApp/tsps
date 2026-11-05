import { CombatPosition } from "../../CombatPosition";
import { CombatMethod } from "../CombatMethod";
import { CombatType } from "../../CombatType";
import { CombatFactory } from "../../CombatFactory";
import { Ammunition, RangedWeapon } from "../../ranged/RangedData";
import { PendingHit } from "../../hit/PendingHit";
import { Mobile } from "../../../../entity/impl/Mobile";
import { Animation } from "../../../../model/Animation";
import { Graphic } from "../../../../model/Graphic";
import { Projectile } from "../../../../model/Projectile";
import { CrossFloor } from "../../../../CrossFloor";
import { Sound } from "../../../../Sound";
import { Sounds } from "../../../../Sounds";
import { WeaponProfiles } from "../../WeaponProfile";
import type { ProjectileProfile } from "../../WeaponProfile";
export class RangedCombatMethod extends CombatMethod {
    private static readonly DEFAULT_PLAYER_PROJECTILE: ProjectileProfile = { delay: 41, lengthAdjustment: 5, stepMultiplier: 5, startHeight: 43, endHeight: 31 };
    /** Bronze arrow; used when an npc has no projectile configured. */
    private static readonly DEFAULT_NPC_PROJECTILE = 10;
    /**
     * An NPC's shot flies like a bow's arrow (launched at 41, landing at 46 + 5 cycles a tile)
     * and hits when it lands. It used a flat 40 -> 57 with a 1-tick hit, so the player was hit
     * before the arrow left and a long shot crossed its range in a third of a second (#1862).
     */
    private static readonly NPC_PROJECTILE_DELAY = 41;
    private static readonly NPC_PROJECTILE_END_BASE = 46;
    private static readonly NPC_PROJECTILE_CYCLES_PER_TILE = 5;

    type(): CombatType {
        return CombatType.RANGED;
    }

    /** A special attack's own launch sound; the weapon/ammunition sound is used when unset. */
    protected fireSound(_character: Mobile): Sound | undefined {
        return undefined;
    }

    /**
     * Ticks until each shot of a player's attack lands. Wiki (Hit delay): the distance is edge to edge,
     * to the target's nearest tile, in the weapon's own formula (bows 1 + (3 + d) / 6, thrown weapons
     * 1 + d / 6, ...).
     */
    public static landingDelays(character: Mobile, target: Mobile): number[] {
        return RangedCombatMethod.playerHitDelays(
            character,
            target,
            CombatPosition.edgeDistance(character, target),
        );
    }

    hits(character: Mobile, target: Mobile): PendingHit[] {
        const delays = character.isPlayer()
            ? RangedCombatMethod.landingDelays(character, target)
            : [RangedCombatMethod.npcHitDelay(character, target)];
        return delays.map((delay) => new PendingHit(character, target, this, delay));
    }

    /** On another floor, keep the splat from resolving before its slower cross-floor shot lands. */
    public static playerHitDelays(character: Mobile, target: Mobile, distance: number): number[] {
        const player = character.getAsPlayer();
        const delays = WeaponProfiles.hitDelays(player, distance);
        const from = CombatPosition.location(character, target);
        const to = CombatPosition.location(target, character);
        if (!CrossFloor.canCross(from, to) || from.getZ() === to.getZ()) return delays;

        const profile = WeaponProfiles.ranged(player);
        const projectiles = profile?.projectiles ?? [RangedCombatMethod.DEFAULT_PLAYER_PROJECTILE];
        const arrivals = projectiles.map((projectile) =>
            Projectile.ticksToLand(RangedCombatMethod.projectileEnd(projectile, distance)));
        return delays.map((delay, index) => Math.max(delay, arrivals[Math.min(index, arrivals.length - 1)] ?? delay));
    }

    /** Ticks until an NPC's shot lands, so its hit shows when the arrow arrives. */
    public static npcHitDelay(character: Mobile, target: Mobile): number {
        return Projectile.arrivalTicks(character, target, RangedCombatMethod.NPC_PROJECTILE_END_BASE, RangedCombatMethod.NPC_PROJECTILE_CYCLES_PER_TILE);
    }

    private static npcProjectileEnd(character: Mobile, target: Mobile): number {
        return Projectile.arrivalCycles(character, target, RangedCombatMethod.NPC_PROJECTILE_END_BASE, RangedCombatMethod.NPC_PROJECTILE_CYCLES_PER_TILE);
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
        const animation = character.getAttackAnim(target);

        if (animation !== -1) {
            character.performAnimation(new Animation(animation));
        }

        const profile = character.isPlayer() ? WeaponProfiles.ranged(character.getAsPlayer()) : null;
        if (profile?.launchGraphic != null && ammo) {
            character.performGraphic(new Graphic(profile.launchGraphic));
        } else if (ammo?.getStartGraphic() && profile?.startGraphic !== false) {
            character.performGraphic(profile?.doubleStartGraphic ? ammo.getDoubleStartGraphic() : ammo.getStartGraphic());
        }

        if (character.isNpc()) {
            // NPCs have no ranged weapon or ammo. Give them the projectile configured
            // in npc-combat-defs.json, falling back to a generic arrow so the shot is
            // at least visible.
            const configured = character.getAsNpc().getCurrentDefinition().getProjectileId();
            const projectileId = configured >= 0 ? configured : RangedCombatMethod.DEFAULT_NPC_PROJECTILE;
            const end = RangedCombatMethod.npcProjectileEnd(character, target);
            Projectile.createProjectile(character, target, projectileId, RangedCombatMethod.NPC_PROJECTILE_DELAY, end, 43, 31).sendProjectile();
            return;
        }

        if (!rangedWeapon || !ammo) {
            return;
        }

        const projectiles = profile?.projectiles ?? [RangedCombatMethod.DEFAULT_PLAYER_PROJECTILE];
        const distance = CombatPosition.edgeDistance(character, target);
        const processingOrder = target.isNpc() ? 1 : 0;
        const hitDelays = RangedCombatMethod.landingDelays(character, target)
            .map((ticks) => ticks + processingOrder);
        for (let index = 0; index < projectiles.length; index++) {
            const projectile = projectiles[index];
            const end = RangedCombatMethod.projectileEnd(projectile, distance);
            const shot = Projectile.createProjectile(character, target, profile?.projectileId ?? ammo.getProjectileId(), projectile.delay, end, projectile.startHeight, projectile.endHeight);
            if (projectile.angle != null) shot.withAngle(projectile.angle);
            if (projectile.progress != null) shot.withProgress(projectile.progress);
            shot.sendProjectile();
        }
        Sounds.sendSound(character, this.fireSound(character) ?? profile?.fireSound ?? Sound.SHOOT_ARROW);

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
