import { Player } from "../../entity/impl/player/Player";
import { ItemDefinition } from "../../definition/ItemDefinition";
import { Equipment } from "../container/impl/Equipment";
import { getCrystalBowAttackBonus, getCrystalBowRangedStrength, isCrystalBow } from "../../content/combat/ranged/CrystalBow";
import { PluginManager } from "../../../plugins/PluginManager";

/** Ranged strength's place in an item's bonus array. */
const RANGED_STRENGTH_INDEX = 11;

/** Loaded lazily: the ranged data reaches back into combat, which uses this class. */
function firesFromAmmoSlot(player: Player): boolean {
    const { Ammunition } = require("../../content/combat/ranged/RangedData");
    return Ammunition.firesFromAmmoSlot(player);
}

export class BonusManager {
    public static readonly ATTACK_STAB = 0;
    public static readonly ATTACK_SLASH = 1;
    public static readonly ATTACK_CRUSH = 2;
    public static readonly ATTACK_MAGIC = 3;
    public static readonly ATTACK_RANGE = 4;

    public static readonly DEFENCE_STAB = 0;
    public static readonly DEFENCE_SLASH = 1;
    public static readonly DEFENCE_CRUSH = 2;
    public static readonly DEFENCE_MAGIC = 3;
    public static readonly DEFENCE_RANGE = 4;

    public static readonly STRENGTH = 0;
    public static readonly RANGED_STRENGTH = 1;
    public static readonly MAGIC_STRENGTH = 2;
    public static readonly PRAYER = 3;
    private static readonly BONUS_COUNT = 14;

    private attackBonus: number[] = new Array(5).fill(0);
    private defenceBonus: number[] = new Array(5).fill(0);
    private otherBonus: number[] = new Array(4).fill(0);

    public static update(player: Player) {
        const bonuses = new Array(BonusManager.BONUS_COUNT).fill(0);
        // Plugins can switch an item's stats off (members items on a free-to-play world).
        const counts = (itemId: number) => PluginManager.emitCanUseItem(player, itemId, "bonus") !== false;
        for (const item of player.getEquipment().getItems()) {
            if (!item || item.getId() <= 0 || !counts(item.getId())) continue;
            const definition = ItemDefinition.forId(item.getId());
            if (definition.getBonuses() != null) {
                for (let i = 0; i < Math.min(definition.getBonuses().length, bonuses.length); i++) {
                    bonuses[i] += definition.getBonuses()[i];
                }
            }
        }

        // A thrown or self-ammo weapon doesn't fire the ammo slot, so its ranged strength
        // doesn't count (a dragon knife with dragon arrows equipped gets the knife's +30 only).
        const ammo = player.getEquipment().getItems()[Equipment.AMMUNITION_SLOT];
        if (ammo && ammo.getId() > 0 && counts(ammo.getId()) && !firesFromAmmoSlot(player)) {
            bonuses[RANGED_STRENGTH_INDEX] -= Number(ItemDefinition.forId(ammo.getId()).getBonuses()?.[RANGED_STRENGTH_INDEX] ?? 0);
        }

        const weaponId = player.getEquipment().getItems()[Equipment.WEAPON_SLOT]?.getId?.() ?? -1;
        if (isCrystalBow(weaponId) && counts(weaponId)) {
            const weaponDefinition = ItemDefinition.forId(weaponId);
            const definitionBonuses = weaponDefinition?.getBonuses?.() ?? [];
            const rangedAttackBonus = getCrystalBowAttackBonus(weaponId);
            const rangedStrengthBonus = getCrystalBowRangedStrength(weaponId);
            if (rangedAttackBonus != null) {
                bonuses[BonusManager.ATTACK_RANGE] +=
                    rangedAttackBonus - Number(definitionBonuses[BonusManager.ATTACK_RANGE] ?? 0);
            }
            if (rangedStrengthBonus != null) {
                bonuses[RANGED_STRENGTH_INDEX] += rangedStrengthBonus - Number(definitionBonuses[RANGED_STRENGTH_INDEX] ?? 0);
            }
        }
        PluginManager.applyBonusProviders(player, bonuses);

        for (let i = 0; i < bonuses.length; i++) {
            if (i <= 4) {
                player.getBonusManager().attackBonus[i] = bonuses[i];
            } else if (i <= 9) {
                const index = i - 5;
                player.getBonusManager().defenceBonus[index] = bonuses[i];
            } else {
                const index = i - 10;
                player.getBonusManager().otherBonus[index] = bonuses[i];
            }
        }
    }

    public getAttackBonus(): number[] {
        return this.attackBonus;
    }

    public getDefenceBonus(): number[] {
        return this.defenceBonus;
    }

    public getOtherBonus(): number[] {
        return this.otherBonus;
    }
}
