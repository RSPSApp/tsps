import { ItemAliases } from "../../model/ItemAliases";
import { Mobile } from "../../entity/impl/Mobile";
import type { Player } from "../../entity/impl/player/Player";
import { CombatFactory } from "./CombatFactory";
import { CombatMethod } from "./method/CombatMethod";
import { CombatType } from "./CombatType";
import { TaskManager } from "../../task/TaskManager";
import { RestoreSpecialAttackTask } from '../../task/impl/RestoreSpecialAttackTask'
import { Equipment } from "../../model/container/impl/Equipment";
import { DuelRule } from "../Duelling";
import { PlayerRights } from "../../model/rights/PlayerRights";
import { applySpecialEnergyCostModifiers } from "./EquipmentEffects";
import type { WeaponSpecialTraits, SpecialAttackTargeting } from "./WeaponSpecialTraits";

/** Weapon special attacks are defined by plugins, not hardcoded here. */
export interface CombatSpecialDefinition {
    id: string;
    itemIds: number[];
    drainAmount: number;
    strengthMultiplier: number;
    accuracyMultiplier: number;
    combatMethod: CombatMethod;
    weaponInterface?: any;
    /**
     * Open, plugin-owned data about this special (e.g. bot heuristics, trait
     * overrides). Core never interprets the contents; consumers query by key.
     */
    metadata?: Record<string, unknown>;
    /** Roll overrides applied by core while this special is active. */
    traits?: WeaponSpecialTraits;
    /** Roll overrides that depend on the attacker at the swing (soul stacks); replaces `traits` there. */
    traitsFor?: (player: Player) => WeaponSpecialTraits | undefined;
    /** Per-variant energy cost override, keyed by item id (e.g. granite maul (or)). */
    drainAmountByItemId?: Record<number, number>;
}

export class CombatSpecial {
    private static readonly registry: CombatSpecial[] = [];
    private static readonly byId = new Map<string, CombatSpecial>();
    private static readonly byItemId = new Map<number, CombatSpecial>();

    public static register(definition: CombatSpecialDefinition): CombatSpecial | null {
        if (!definition || typeof definition.id !== "string" || !definition.id.trim().length) {
            return null;
        }
        if (!Array.isArray(definition.itemIds) || definition.itemIds.length === 0) {
            return null;
        }
        if (!definition.combatMethod || typeof definition.combatMethod.type !== "function") {
            return null;
        }

        const special = new CombatSpecial(definition);
        CombatSpecial.registry.push(special);
        CombatSpecial.byId.set(special.id, special);
        for (const itemId of special.identifiers) {
            CombatSpecial.byItemId.set(itemId, special);
        }
        return special;
    }

    public static all(): CombatSpecial[] {
        return CombatSpecial.registry.slice();
    }

    public static getById(id: string): CombatSpecial | null {
        return CombatSpecial.byId.get(id) ?? null;
    }

    public static getForWeaponId(itemId: number): CombatSpecial | null {
        return ItemAliases.lookup(CombatSpecial.byItemId, itemId) ?? null;
    }

    constructor(definition: CombatSpecialDefinition){
        this.id = definition.id;
        this.identifiers = definition.itemIds;
        this.drainAmount = definition.drainAmount;
        this.strengthMultiplier = definition.strengthMultiplier;
        this.accuracyMultiplier = definition.accuracyMultiplier;
        this.combatMethod = definition.combatMethod;
        this.weaponType = definition.weaponInterface;
        this.metadata = definition.metadata ?? {};
        this.traits = definition.traits;
        this.traitsFor = definition.traitsFor;
        this.drainAmountByItemId = definition.drainAmountByItemId ?? {};
    }

    private readonly id: string;
    private readonly drainAmount: number;
    private readonly strengthMultiplier: number;
    private readonly accuracyMultiplier: number;
    private readonly combatMethod: CombatMethod;
    private readonly weaponType: any;
    private readonly identifiers: number[];
    private readonly metadata: Record<string, unknown>;
    private readonly traits: WeaponSpecialTraits | undefined;
    private readonly traitsFor: ((player: Player) => WeaponSpecialTraits | undefined) | undefined;
    private readonly drainAmountByItemId: Record<number, number>;

    public static checkSpecial(player: Player, special: CombatSpecial): boolean {
        return (
            player.getCombatSpecial() != null &&
            player.getCombatSpecial() == special &&
            player.isSpecialActivated() &&
            CombatSpecial.affordable(player, special, special.getDrainAmountForWeaponId(player.getEquipment().get(Equipment.WEAPON_SLOT)?.getId?.()))
        );
    }

    /**
     * What a special costs this character, as content may change it (a league relic): asked with
     * the special's own cost when the energy is checked (`phase` "check") and again when it is
     * drained ("drain"). A listener may lower `cost`, or set `allow` so a character short of energy
     * may use the special anyway; the drain then takes what there is.
     */
    public static cost(character: Mobile, special: CombatSpecial | null, base: number, phase: "check" | "drain"): { cost: number; allow: boolean } {
        base = applySpecialEnergyCostModifiers(character, base);
        const request = {
            player: character, specialId: special?.getId() ?? null, cost: base,
            available: character.getSpecialPercentage(), allow: false, phase,
        };
        const { PluginManager } = require("../../../plugins/PluginManager");
        PluginManager.emitCustomEvent("combat-special:cost", request);
        const cost = Number(request.cost);
        return { cost: Number.isFinite(cost) ? Math.max(0, cost) : base, allow: request.allow === true };
    }

    /** Whether the character has the energy for a special costing `base`, as content prices it. */
    public static affordable(character: Mobile, special: CombatSpecial | null, base: number): boolean {
        const { cost, allow } = CombatSpecial.cost(character, special, base, "check");
        return allow || character.getSpecialPercentage() >= cost;
    }

    /** The cost for the wielded variant, including equipment and content modifiers. */
    public static energyCost(player: Player, special: CombatSpecial): number {
        const weaponId = player.getEquipment().get(Equipment.WEAPON_SLOT)?.getId?.();
        return CombatSpecial.cost(player, special, special.getDrainAmountForWeaponId(weaponId), "check").cost;
    }

    /** `isCost` false spends an amount directly (Unleash), without cost modifiers. */
    public static drain(character: Mobile, amount: number, isCost = true) {
        const special: CombatSpecial | null = character.isPlayer?.() ? ((character as any).getAsPlayer?.()?.getCombatSpecial?.() ?? null) : null;
        character.decrementSpecialPercentage(isCost ? CombatSpecial.cost(character, special, amount, "drain").cost : amount);

        CombatSpecial.ensureRestoreTask(character);

        if (character.isPlayer()) {
            let p = character.getAsPlayer();
            CombatSpecial.updateBar(p);
            // "combat-special:performed" { player, itemId }: a special attack performed, with the weapon wielded.
            const { PluginManager } = require("../../../plugins/PluginManager");
            PluginManager.emitCustomEvent("combat-special:performed", { player: p, itemId: p.getEquipment?.()?.get(Equipment.WEAPON_SLOT)?.getId?.() ?? -1 });
        }
    }

    public static ensureRestoreTask(character: Mobile): boolean {
        if (!character || character.getSpecialPercentage() >= 100 || character.isRecoveringSpecialAttack()) {
            return false;
        }

        let initialDelayTicks: number | undefined;
        if (character.isPlayer()) {
            const secondsRemaining = character.getAsPlayer().getSpecialAttackRestore().secondsRemaining();
            initialDelayTicks = RestoreSpecialAttackTask.initialDelayTicksFromSeconds(
                secondsRemaining,
                character
            );
        }

        TaskManager.submit(new RestoreSpecialAttackTask(character, initialDelayTicks));
        return true;
    }

    /** Ticks one 10% restore takes for this character now (50, 25 with the Lightbearer). */
    public static restoreDelayTicks(character: Mobile): number {
        return RestoreSpecialAttackTask.restoreDelayTicks(character);
    }

    /** Ticks until the next 10% restore, or 0 when energy isn't restoring. */
    public static restoreTicksRemaining(character: Mobile): number {
        return RestoreSpecialAttackTask.running(character)?.getRemainingTicks() ?? 0;
    }

    /** Restarts a running restore timer so the next 10% comes `ticks` from now; false when nothing is restoring. */
    public static restartRestoreTimer(character: Mobile, ticks: number): boolean {
        const task = RestoreSpecialAttackTask.running(character);
        if (!task) {
            return false;
        }
        task.stop();
        TaskManager.submit(new RestoreSpecialAttackTask(character, ticks));
        return true;
    }

    public static updateBar(player: Player) {
        const packetSender = player.getPacketSender();
        packetSender.updateSpecialAttackOrb();
        packetSender.sendSpecialAttackState(player.isSpecialActivated());

        const weapon = player.getWeapon();
        if (!weapon || typeof weapon.getSpecialBar !== "function" || typeof weapon.getSpecialMeter !== "function") {
            return;
        }
        if (weapon.getSpecialBar() == -1 || weapon.getSpecialMeter() == -1) {
            return;
        }
        let specialCheck = 10;
        let specialBar = weapon.getSpecialMeter();
        let specialAmount = player.getSpecialPercentage() / 10;

        for (let i = 0; i < 10; i++) {
            player.getPacketSender().sendInterfaceComponentMoval(specialAmount >= specialCheck ? 500 : 0, 0, --specialBar);
            specialCheck--;
        }
        packetSender.sendString(
            player.isSpecialActivated()
                ? ("@yel@ Special Attack (" + player.getSpecialPercentage() + "%)")
                : ("@bla@ Special Attack (" + player.getSpecialPercentage() + "%)"),
            weapon.getSpecialMeter()
        );
    }

    public static assign(player: Player) {
        // A registered special is what makes a weapon special usable; the legacy
        // per-weapon specialBar widget id is only used for the old interface's
        // show/hide. Gating on `specialBar === -1` wrongly disabled every weapon
        // whose (legacy) interface entry omitted a bar, e.g. all staves.
        const equippedWeaponId = player.getEquipment().get(Equipment.WEAPON_SLOT).getId();
        const specialBar = player.getWeapon().getSpecialBar();
        // A shield can carry a special too (Rondache); a weapon's own comes first.
        const special = CombatSpecial.getForWeaponId(equippedWeaponId)
            ?? CombatSpecial.getForWeaponId(player.getEquipment().get(Equipment.SHIELD_SLOT).getId());

        if (special) {
            if (specialBar != -1) {
                player.getPacketSender().sendInterfaceDisplayState(specialBar, false);
            }
            player.setCombatSpecial(special);
            return;
        }

        if (specialBar != -1) {
            player.getPacketSender().sendInterfaceDisplayState(specialBar, true);
        }
        player.setCombatSpecial(null);
        player.setSpecialActivated(false);
        player.getPacketSender().sendSpecialAttackState(false);
    }

    public static activate(player: Player) {
        if (player.getCombatSpecial() == null) {
            return;
        }

        if (player.getDueling().inDuel() && player.getDueling().getRules()[DuelRule.NO_SPECIAL_ATTACKS.getButtonId()]) {
            return;
        }

        // Loaded lazily, as PrayerHandler does: PluginManager imports Player.
        const { PluginManager } = require("../../../plugins/PluginManager");
        const disabledMessage = PluginManager.emitSpecialAttackDisabled(player);
        if (!player.isSpecialActivated() && disabledMessage !== null) {
            player.sendMessage(disabledMessage);
            CombatSpecial.updateBar(player);
            return;
        }

        if (player.isSpecialActivated()) {
            player.setSpecialActivated(false);
            CombatSpecial.updateBar(player);
        } else {
            const spec = player.getCombatSpecial();
            if (spec.getTraits()?.skipAttack === true) {
                CombatSpecial.activateUtility(player, spec);
                return;
            }
            const queuedAttack = spec.getTraits()?.queuedAttack === true;
            const developerQueuedAttackSpam =
                queuedAttack && player.getRights?.() === PlayerRights.DEVELOPER;
            player.setSpecialActivated(true);
            CombatSpecial.updateBar(player);

            if (queuedAttack) {
                const equippedWeaponId = player.getEquipment().get(Equipment.WEAPON_SLOT).getId();
                if (!developerQueuedAttackSpam && !CombatSpecial.affordable(player, spec, spec.getDrainAmountForWeaponId(equippedWeaponId))) {
                    player.sendMessage("You don't have enough power left.");
                    player.setSpecialActivated(false);
                    CombatSpecial.updateBar(player);
                    return;
                }

                const target = player.getCombat().getTarget();
                if (target != null && CombatFactory.getMethod(player).type() == CombatType.MELEE) {
                    // The energy is drained where the special actually swings: a queued
                    // special pressed mid-cooldown stays lit and drains on the next
                    // attack instead of charging instantly and refunding on failure.
                    // Bypassing specials (granite maul) swing on the press regardless.
                    const instant = spec.getTraits()?.bypassAttackDelay === true;
                    if (instant || player.getCombat().getAttackDelay() <= 0) {
                        const method = CombatFactory.getMethod(player);
                        if (!player.getCombat().performNewAttack(true)) {
                            player.setSpecialActivated(false);
                            CombatSpecial.updateBar(player);
                            return;
                        }
                        // A special swing is the player's attack for the cycle and is
                        // followed by the weapon's normal cooldown; `bypassDelay`
                        // (performNewAttack(true)) skips that reset, so do it here. A
                        // bypassing special swings outside the cycle, so it only extends
                        // the deadline: Quick Smash after an AGS hit leaves the AGS's
                        // cooldown running instead of cutting it to one tick.
                        const { PluginManager } = require("../../../plugins/PluginManager");
                        const speed = PluginManager.emitAttackSpeed(player, target, method.type(),
                            spec.getTraits()?.attackSpeedTicks ?? method.attackSpeed(player));
                        if (instant) {
                            player.getCombat().extendAttackDelay(speed);
                        } else {
                            player.getCombat().setAttackDelay(speed);
                        }
                    } else {
                        player.getCombat().setSpecialAttackQueued(true);
                    }
                    return;
                } else {
                    // Uninformed player activating a queued-attack special outside combat.
                    player.sendMessage("Although not required, this special attack should be used during combat");
                    player.sendMessage("for maximum effect.");
                }
            }
        }

    }

    /**
     * Instant utility specials (skipAttack) resolve on the button press, the way
     * OSRS does it: no target and no attack swing (Lumber Up, Rock Knocker,
     * Fishstabber, Rampage, Sanctuary, Power of Death, Virulence, Entice, ...).
     * The plugin's start() owns the drain and the effect, so core only gates on
     * energy and finishes by clearing the activated state.
     */
    private static activateUtility(player: Player, spec: CombatSpecial): void {
        const equippedWeaponId = player.getEquipment().get(Equipment.WEAPON_SLOT).getId();
        const drainAmount = spec.getDrainAmountForWeaponId(equippedWeaponId);
        if (!CombatSpecial.affordable(player, spec, drainAmount)) {
            player.sendMessage("You don't have enough power left.");
            return;
        }

        spec.getCombatMethod().start(player, player);
        player.setSpecialActivated(false);
        CombatSpecial.updateBar(player);
    }

    public getId(): string {
        return this.id;
    }

    public getIdentifiers(): number[] {
        return this.identifiers;
    }

    public getDrainAmount(): number {
        return this.drainAmount;
    }

    /** Energy cost for a specific weapon variant (defaults to the base cost). */
    public getDrainAmountForWeaponId(itemId?: number): number {
        if (itemId !== undefined) {
            const override = this.drainAmountByItemId[itemId] ?? this.drainAmountByItemId[ItemAliases.baseOf(itemId) ?? -1];
            if (typeof override === "number") {
                return override;
            }
        }
        return this.drainAmount;
    }

    public getStrengthMultiplier(): number {
        return this.strengthMultiplier;
    }

    public getAccuracyMultiplier(): number {
        return this.accuracyMultiplier;
    }

    public getCombatMethod(): CombatMethod {
        return this.combatMethod;
    }

    public getWeaponType(): any {
        return this.weaponType;
    }

    /** Plugin-owned data registered with this special; core never reads it. */
    public getMetadata(): Record<string, unknown> {
        return this.metadata;
    }

    /** Roll overrides for this special, if any. */
    public getTraits(): WeaponSpecialTraits | undefined {
        return this.traits;
    }

    /**
     * Traits of the active special for `entity`, or null. Centralised so the
     * hit pipeline never has to know how a special is stored on an entity.
     */
    /** Engagement-level target selection for the active special, if any. */
    public static activeTargetingFor(entity: Mobile): SpecialAttackTargeting | undefined {
        return CombatSpecial.activeTraitsFor(entity)?.targeting;
    }

    public static activeTraitsFor(entity: Mobile): WeaponSpecialTraits | null {
        if (!entity || !entity.isPlayer()) {
            return null;
        }
        const player = entity.getAsPlayer();
        if (!player.isSpecialActivated()) {
            return null;
        }
        const special = player.getCombatSpecial();
        return (special?.traitsFor ? special.traitsFor(player) : special?.getTraits()) ?? null;
    }

}
