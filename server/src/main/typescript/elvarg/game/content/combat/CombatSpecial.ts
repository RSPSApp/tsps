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
        return CombatSpecial.byItemId.get(itemId) ?? null;
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
    private readonly drainAmountByItemId: Record<number, number>;

    public static checkSpecial(player: Player, special: CombatSpecial): boolean {
        return (
            player.getCombatSpecial() != null &&
            player.getCombatSpecial() == special &&
            player.isSpecialActivated() &&
            player.getSpecialPercentage() >= special.getDrainAmount()
        );
    }

    public static drain(character: Mobile, amount: number) {
        character.decrementSpecialPercentage(amount);

        CombatSpecial.ensureRestoreTask(character);

        if (character.isPlayer()) {
            let p = character.getAsPlayer();
            CombatSpecial.updateBar(p);
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
        const special = CombatSpecial.getForWeaponId(equippedWeaponId);

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

        if (player.isSpecialActivated()) {
            player.setSpecialActivated(false);
            CombatSpecial.updateBar(player);
        } else {
            const spec = player.getCombatSpecial();
            const queuedAttack = spec.getTraits()?.queuedAttack === true;
            const developerQueuedAttackSpam =
                queuedAttack && player.getRights?.() === PlayerRights.DEVELOPER;
            player.setSpecialActivated(true);
            CombatSpecial.updateBar(player);

            const equippedWeaponId = player.getEquipment().get(Equipment.WEAPON_SLOT).getId();
            if (queuedAttack) {
                if (!developerQueuedAttackSpam && player.getSpecialPercentage() < spec.getDrainAmountForWeaponId(equippedWeaponId)) {
                    player.sendMessage("You do not have enough special attack energy left!");
                    player.setSpecialActivated(false);
                    CombatSpecial.updateBar(player);
                    return;
                }

                const target = player.getCombat().getTarget();
                if (target != null && CombatFactory.getMethod(player).type() == CombatType.MELEE) {
                    const drainAmount = spec.getDrainAmountForWeaponId(equippedWeaponId);
                    player.getCombat().setSpecialAttackQueued(true);
                    if (!developerQueuedAttackSpam) {
                        CombatSpecial.drain(player, drainAmount);
                    }
                    const attacked = player.getCombat().performNewAttack(true);
                    if (!attacked) {
                        player.getCombat().setSpecialAttackQueued(false);
                        if (!developerQueuedAttackSpam) {
                            player.incrementSpecialPercentage(drainAmount);
                        }
                        player.setSpecialActivated(false);
                        CombatSpecial.updateBar(player);
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
            const override = this.drainAmountByItemId[itemId];
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
        return player.getCombatSpecial()?.getTraits() ?? null;
    }

}
