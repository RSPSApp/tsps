import { CombatPosition } from "../../CombatPosition";
import { CombatMethod } from "../CombatMethod";
import { CombatType } from "../../CombatType";
import { CombatFactory } from "../../CombatFactory";
import { Ammunition, RangedWeapon } from "../../ranged/RangedData";
import { PendingHit } from "../../hit/PendingHit";
import { Mobile } from "../../../../entity/impl/Mobile";
import { Animation } from "../../../../model/Animation";
import { Graphic } from "../../../../model/Graphic";
import { GraphicHeight } from "../../../../model/GraphicHeight";
import { Projectile } from "../../../../model/Projectile";
import { CrossFloor } from "../../../../CrossFloor";
import { Sound } from "../../../../Sound";
import { Sounds } from "../../../../Sounds";
import { WeaponProfiles } from "../../WeaponProfile";
import { Equipment } from "../../../../model/container/impl/Equipment";
import { PluginManager } from "../../../../../plugins/PluginManager";
import type { Player } from "../../../../entity/impl/player/Player";
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
    /**
     * An NPC's arrow flies at 163 -> 146 on the wire, as a player's bow arrow (quarter-tiles here, sent times four):
     * all 152 NPC-sourced *_arrow_travel shots (iron/bronze/mithril/rune) in revs 227, 234 and 241, e.g.
     * rsprox_transcripts/234/00801.txt, 234/00822.txt, 241/900144.txt and 241/911423.txt.
     */
    private static readonly NPC_PROJECTILE_START_HEIGHT = 40.75;
    private static readonly NPC_PROJECTILE_END_HEIGHT = 36.5;
    private static readonly CLIENT_CYCLES_PER_TICK = 30;

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
            ? RangedCombatMethod.landingDelays(character, target).slice(0, RangedCombatMethod.shotLimit(character.getAsPlayer()))
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

    /**
     * The arrows one attack fires: the profile's count (a dark bow's two), or what is left in the ammo slot when that
     * is fewer. Wiki (Dark bow): it "may also be fired with only one arrow equipped"; its special needs two.
     * Ammo a plugin supplies (Dizana's quiver) is capped the same way: one arrow stored fires one, never two.
     */
    public static arrowsPerShot(player: Player): number {
        const wanted = WeaponProfiles.ranged(player)?.ammoRequired ?? 1;
        if (wanted <= 1) return wanted;
        if (!Ammunition.firesFromAmmoSlot(player)) {
            return PluginManager.checkRangedAmmo(player, wanted, true) === false ? 1 : wanted;
        }
        const worn = player.getEquipment().getItems()[Equipment.AMMUNITION_SLOT]?.getAmount?.() ?? 0;
        return Math.max(1, Math.min(wanted, worn));
    }

    /** How many of the profile's projectiles and hits one attack keeps: all, unless it fires several arrows at once. */
    private static shotLimit(player: Player): number | undefined {
        return (WeaponProfiles.ranged(player)?.ammoRequired ?? 1) > 1 ? RangedCombatMethod.arrowsPerShot(player) : undefined;
    }

    canAttack(character: Mobile, target: Mobile): boolean {
        if (character.isNpc()) {
            return true;
        }

        const p = character.getAsPlayer();

        if (!CombatFactory.checkAmmo(p, 1)) {
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
        return CombatFactory.checkAmmo(player, 1, true);
    }

    start(character: Mobile, target: Mobile) {
        // An earlier shot whose swing never reached finished() (hits() returned none) is paid first.
        RangedCombatMethod.payPendingShot(character);
        const ammo = character.getCombat().getAmmunition();
        const rangedWeapon = character.getCombat().getRangedWeapon();
        const animation = character.getAttackAnim(target);

        if (animation !== -1) {
            character.performAnimation(new Animation(animation));
        }

        const profile = character.isPlayer() ? WeaponProfiles.ranged(character.getAsPlayer()) : null;
        const arrows = character.isPlayer() ? RangedCombatMethod.arrowsPerShot(character.getAsPlayer()) : 1;
        const limit = character.isPlayer() ? RangedCombatMethod.shotLimit(character.getAsPlayer()) : undefined;
        if (profile?.launchGraphic != null && ammo) {
            character.performGraphic(new Graphic(profile.launchGraphic));
        } else if (ammo?.getStartGraphic() && profile?.startGraphic !== false) {
            character.performGraphic(profile?.doubleStartGraphic && arrows > 1 ? ammo.getDoubleStartGraphic() : ammo.getStartGraphic());
        }

        if (character.isNpc()) {
            // NPCs have no ranged weapon or ammo. Give them the projectile configured
            // in npc-combat-defs.json, falling back to a generic arrow so the shot is
            // at least visible.
            const configured = character.getAsNpc().getCurrentDefinition().getProjectileId();
            const projectileId = configured >= 0 ? configured : RangedCombatMethod.DEFAULT_NPC_PROJECTILE;
            // An archer draws the arrow on its bow on the shot's tick (#3610). Only npcs whose
            // draw spotanim was captured carry one (npc-combat-defs.json `launchGraphic`).
            const launchGraphic = character.getAsNpc().getCurrentDefinition().getLaunchGraphicId();
            if (launchGraphic >= 0) {
                character.performGraphic(new Graphic(launchGraphic, 0, GraphicHeight.ARCHER_DRAW));
            }
            const end = RangedCombatMethod.npcProjectileEnd(character, target);
            Projectile.createProjectile(character, target, projectileId, RangedCombatMethod.NPC_PROJECTILE_DELAY, end,
                RangedCombatMethod.NPC_PROJECTILE_START_HEIGHT, RangedCombatMethod.NPC_PROJECTILE_END_HEIGHT).sendProjectile();
            return;
        }

        if (!rangedWeapon || !ammo) {
            return;
        }

        const projectiles = (profile?.projectiles ?? [RangedCombatMethod.DEFAULT_PLAYER_PROJECTILE]).slice(0, limit);
        const distance = CombatPosition.edgeDistance(character, target);
        const processingOrder = target.isNpc() ? 1 : 0;
        const landings = RangedCombatMethod.landingDelays(character, target);
        const hitDelays = landings.map((ticks) => ticks + processingOrder).slice(0, limit);
        for (let index = 0; index < projectiles.length; index++) {
            const projectile = projectiles[index];
            const end = RangedCombatMethod.projectileEnd(projectile, distance, landings[index] ?? landings[0]);
            const shot = Projectile.createProjectile(character, target, profile?.projectileId ?? ammo.getProjectileId(), projectile.delay, end, projectile.startHeight, projectile.endHeight);
            if (projectile.angle != null) shot.withAngle(projectile.angle);
            if (projectile.progress != null) shot.withProgress(projectile.progress);
            shot.sendProjectile();
        }
        const profileSound = arrows < 2 && profile?.singleFireSound ? profile.singleFireSound : profile?.fireSound;
        Sounds.sendSound(character, this.fireSound(character) ?? profileSound ?? Sound.SHOOT_ARROW);

        if (character.isPlayer()) {
            // Paid in finished(), on this tick but after hits(): the swing rolls with the ammo it fired (a last
            // fire arrow, silver bolt or thrown weapon is still worn), then the slot drops (rsprox 227/00096).
            const flightTicks = Math.max(1, ...hitDelays);
            const landing = { attacker: character, target, location: target.getLocation().clone() };
            PluginManager.emitCustomEvent("ranged:ammo-drop-location", landing);
            RangedCombatMethod.pendingShots.set(character, { pos: landing.location.clone(), amount: arrows, flightTicks });
        }
    }

    /** The shot start() fired, paid once the swing's hits are rolled. */
    private static readonly pendingShots = new WeakMap<Mobile, { pos: any; amount: number; flightTicks: number }>();

    finished(character: Mobile, target: Mobile) {
        super.finished(character, target);
        RangedCombatMethod.payPendingShot(character);
    }

    onCombatEnded(character: Mobile, target: Mobile) {
        // A swing stopped between start() and finished() (no hits) still fired its shot.
        RangedCombatMethod.payPendingShot(character);
        super.onCombatEnded(character, target);
    }

    private static payPendingShot(character: Mobile): void {
        const shot = RangedCombatMethod.pendingShots.get(character);
        if (!shot) return;
        RangedCombatMethod.pendingShots.delete(character);
        if (character.isPlayer()) CombatFactory.decrementAmmo(character.getAsPlayer(), shot.pos, shot.amount, shot.flightTicks);
    }

    /**
     * A projectile's landing offset in client cycles, from the OSRS server projanim types:
     * delay + lengthAdjustment + stepMultiplier * distance. Profiles without a step keep
     * their flat speed as the end offset; a landingOffset ends it with its hit (landingTicks).
     */
    public static projectileEnd(projectile: ProjectileProfile, distance: number, landingTicks?: number): number {
        if (projectile.landingOffset != null && landingTicks != null) {
            return projectile.landingOffset + RangedCombatMethod.CLIENT_CYCLES_PER_TICK * landingTicks;
        }
        if (projectile.stepMultiplier != null) {
            return projectile.delay + (projectile.lengthAdjustment ?? 0) + projectile.stepMultiplier * distance;
        }
        return projectile.speed ?? projectile.delay + 1;
    }

    attackDistance(character: Mobile): number {
        return character.isPlayer() ? WeaponProfiles.attackDistance(character.getAsPlayer(), 6) : 6;
    }

}
