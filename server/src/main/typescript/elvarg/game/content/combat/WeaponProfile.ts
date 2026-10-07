import { Sound } from "../../Sound";
import type { Player } from "../../entity/impl/player/Player";
import { Equipment } from "../../model/container/impl/Equipment";
import { FightType } from "./FightType";
import { WeaponInterfaces } from "./WeaponInterfaces";
import { BOW_OF_FAERDHINEN_IDS, CRYSTAL_BOW_ALL_WEAPON_IDS } from "./ranged/CrystalBow";
import { ItemIdentifiers } from "../../../util/ItemIdentifiers";

export type HitDelayProfile = { base: number; distanceOffset: number; divisor: number };
export type ProjectileProfile = { delay: number; speed?: number; startHeight: number; endHeight: number; lengthAdjustment?: number; stepMultiplier?: number };

export interface WeaponCombatProfile {
    itemIds?: number[];
    weapon?: WeaponInterfaces;
    attackAnimation?: number;
    attackSpeed?: number;
    attackDistance?: number;
    longRangeDistance?: number;
    longRangeFightType?: FightType;
    hitDelays?: HitDelayProfile[];
    projectiles?: ProjectileProfile[];
    startGraphic?: boolean;
    attackSound?: Sound;
    fireSound?: Sound;
    ammoRequired?: number;
    boltEffects?: boolean;
    specialDamage?: { minimum: number; maximum: number };
}

// OSRS projectile types (server projanim config): an arrow ends at delay + lengthAdjustment +
// stepMultiplier * distance client cycles after the shot.
const DEFAULT_PROJECTILE: ProjectileProfile = { delay: 41, lengthAdjustment: 5, stepMultiplier: 5, startHeight: 43, endHeight: 31 };
const THROWN_PROJECTILE: ProjectileProfile = { delay: 32, lengthAdjustment: 0, stepMultiplier: 5, startHeight: 43, endHeight: 31 };
const STANDARD_HIT: HitDelayProfile = { base: 1, distanceOffset: 3, divisor: 6 };
const DEFAULT_RANGED: WeaponCombatProfile = {
    attackDistance: 6,
    hitDelays: [STANDARD_HIT],
    projectiles: [DEFAULT_PROJECTILE],
    fireSound: Sound.SHOOT_ARROW,
};

export class WeaponProfiles {
    private static readonly byItem = new Map<number, WeaponCombatProfile>();
    private static readonly byWeapon = new Map<WeaponInterfaces, WeaponCombatProfile>();

    public static register(profile: WeaponCombatProfile): void {
        for (const id of profile?.itemIds ?? []) {
            if (Number.isInteger(id) && id > 0) {
                this.byItem.set(id, profile);
            }
        }
    }

    public static get(player: Player): WeaponCombatProfile | undefined {
        const itemId = player.getEquipment().getItems()[Equipment.WEAPON_SLOT].getId();
        const weaponProfile = this.byWeapon.get(player.getWeapon());
        const itemProfile = this.byItem.get(itemId);
        return itemProfile ? { ...weaponProfile, ...itemProfile } : weaponProfile;
    }

    public static ranged(player: Player): WeaponCombatProfile {
        return this.get(player) ?? DEFAULT_RANGED;
    }

    public static attackAnimation(player: Player, fallback: number): number {
        return this.get(player)?.attackAnimation ?? fallback;
    }

    public static attackSpeed(player: Player, fallback: number): number {
        return this.get(player)?.attackSpeed ?? fallback;
    }

    public static attackDistance(player: Player, fallback: number): number {
        const profile = this.get(player);
        if (!profile?.attackDistance) {
            return fallback;
        }
        return this.isLongRange(player, profile) ? profile.longRangeDistance ?? profile.attackDistance : profile.attackDistance;
    }

    public static hitDelays(player: Player, distance: number): number[] {
        const profile = this.ranged(player);
        const delays = profile?.hitDelays ?? [STANDARD_HIT];
        const normalizedDistance = Math.max(0, Math.floor(distance));
        return delays.map(({ base, distanceOffset, divisor }) => base + Math.floor((distanceOffset + normalizedDistance) / divisor));
    }

    public static isLongRange(player: Player, profile: WeaponCombatProfile): boolean {
        return !profile.longRangeFightType || player.getFightType() === profile.longRangeFightType;
    }

    private static add(weapon: WeaponInterfaces, profile: WeaponCombatProfile): void {
        this.byWeapon.set(weapon, { weapon, ...profile });
    }

    private static readonly loaded = (() => {
        const bow = {
            attackAnimation: 426,
            attackSpeed: 4,
            attackDistance: 7,
            longRangeDistance: 9,
            longRangeFightType: FightType.SHORTBOW_LONGRANGE,
            hitDelays: [STANDARD_HIT],
            projectiles: [DEFAULT_PROJECTILE],
            fireSound: Sound.SHOOT_ARROW,
        };
        this.add(WeaponInterfaces.SHORTBOW, bow);
        this.add(WeaponInterfaces.LONGBOW, {
            ...bow,
            attackSpeed: 6,
            attackDistance: 9,
            longRangeDistance: 10,
            longRangeFightType: FightType.LONGBOW_LONGRANGE,
            fireSound: Sound.SHOOT_BOW_QUIET,
        });
        this.add(WeaponInterfaces.CROSSBOW, {
            attackAnimation: 4230,
            attackSpeed: 6,
            attackDistance: 7,
            longRangeDistance: 9,
            longRangeFightType: FightType.CROSSBOW_LONGRANGE,
            hitDelays: [STANDARD_HIT],
            projectiles: [{ delay: 41, lengthAdjustment: 5, stepMultiplier: 5, startHeight: 44, endHeight: 35 }],
            fireSound: Sound.SHOOT_CROSSBOW,
            boltEffects: true,
        });
        this.add(WeaponInterfaces.KARILS_CROSSBOW, {
            attackSpeed: 4,
            attackDistance: 7,
            longRangeDistance: 9,
            longRangeFightType: FightType.KARILS_CROSSBOW_LONGRANGE,
            hitDelays: [STANDARD_HIT],
            projectiles: [{ delay: 41, lengthAdjustment: 5, stepMultiplier: 5, startHeight: 44, endHeight: 35 }],
            fireSound: Sound.SHOOT_CROSSBOW,
        });
        this.add(WeaponInterfaces.BLOWPIPE, {
            attackAnimation: 5061,
            attackSpeed: 3,
            attackDistance: 5,
            longRangeDistance: 7,
            longRangeFightType: FightType.BLOWPIPE_LONGRANGE,
            hitDelays: [{ base: 1, distanceOffset: 0, divisor: 6 }],
            projectiles: [{ delay: 32, lengthAdjustment: 0, stepMultiplier: 5, startHeight: 40, endHeight: 35 }],
            startGraphic: false,
            fireSound: Sound.THROW_DART,
        });
        this.add(WeaponInterfaces.KNIFE, {
            attackAnimation: 806,
            attackSpeed: 3,
            attackDistance: 4,
            longRangeDistance: 6,
            longRangeFightType: FightType.KNIFE_LONGRANGE,
            hitDelays: [{ base: 1, distanceOffset: 0, divisor: 6 }],
            projectiles: [THROWN_PROJECTILE],
            fireSound: Sound.THROW_DART,
        });
        this.add(WeaponInterfaces.DART, {
            attackAnimation: 806,
            attackSpeed: 3,
            attackDistance: 3,
            longRangeDistance: 5,
            longRangeFightType: FightType.DART_LONGRANGE,
            hitDelays: [{ base: 1, distanceOffset: 0, divisor: 6 }],
            projectiles: [THROWN_PROJECTILE],
            fireSound: Sound.THROW_DART,
        });
        this.add(WeaponInterfaces.JAVELIN, {
            attackAnimation: 929,
            attackSpeed: 6,
            attackDistance: 5,
            longRangeDistance: 6,
            longRangeFightType: FightType.JAVELIN_LONGRANGE,
            hitDelays: [{ base: 1, distanceOffset: 0, divisor: 6 }],
            projectiles: [THROWN_PROJECTILE],
            fireSound: Sound.THROW_DART,
        });
        this.add(WeaponInterfaces.OBBY_RINGS, {
            attackSpeed: 4,
            attackDistance: 5,
            longRangeDistance: 6,
            longRangeFightType: FightType.OBBY_RING_LONGRANGE,
            hitDelays: [{ base: 1, distanceOffset: 0, divisor: 6 }],
            projectiles: [{ delay: 32, lengthAdjustment: 0, stepMultiplier: 5, startHeight: 43, endHeight: 31 }],
            fireSound: Sound.THROW_DART,
        });
        this.add(WeaponInterfaces.HALBERD, { attackDistance: 2 });
        this.add(WeaponInterfaces.WHIP, { attackAnimation: 1658, attackSpeed: 4, attackSound: Sound.WEAPON_WHIP });
        this.add(WeaponInterfaces.BALLISTA, {
            attackSpeed: 7,
            attackDistance: 7,
            longRangeDistance: 9,
            longRangeFightType: FightType.BALLISTA_LONGRANGE,
            hitDelays: [{ base: 2, distanceOffset: 1, divisor: 6 }],
            projectiles: [{ delay: 41, lengthAdjustment: 5, stepMultiplier: 5, startHeight: 44, endHeight: 35 }],
            fireSound: Sound.SHOOT_CROSSBOW,
        });
        this.add(WeaponInterfaces.DARK_BOW, {
            attackAnimation: 426,
            attackSpeed: 9,
            attackDistance: 9,
            longRangeDistance: 10,
            longRangeFightType: FightType.LONGBOW_LONGRANGE,
            hitDelays: [STANDARD_HIT, { base: 1, distanceOffset: 2, divisor: 3 }],
            projectiles: [DEFAULT_PROJECTILE, { delay: 41, lengthAdjustment: 14, stepMultiplier: 10, startHeight: 48, endHeight: 31 }],
            fireSound: Sound.SHOOT_BOW_QUIET,
            ammoRequired: 2,
            specialDamage: { minimum: 8, maximum: 48 },
        });
        this.register({
            itemIds: CRYSTAL_BOW_ALL_WEAPON_IDS,
            attackAnimation: 426,
            attackSpeed: 5,
            attackDistance: 10,
            longRangeDistance: 10,
            hitDelays: [STANDARD_HIT],
            projectiles: [DEFAULT_PROJECTILE],
            fireSound: Sound.SHOOT_ARROW,
        });
        this.register({
            itemIds: BOW_OF_FAERDHINEN_IDS,
            attackAnimation: 426,
            attackSpeed: 5,
            attackDistance: 10,
            longRangeDistance: 10,
            hitDelays: [STANDARD_HIT],
            projectiles: [DEFAULT_PROJECTILE],
            fireSound: Sound.SHOOT_ARROW,
        });
        this.register({
            itemIds: [ItemIdentifiers.TWISTED_BOW],
            attackAnimation: 426,
            attackSpeed: 5,
            attackDistance: 10,
            longRangeDistance: 10,
            hitDelays: [STANDARD_HIT],
            projectiles: [DEFAULT_PROJECTILE],
            fireSound: Sound.SHOOT_ARROW,
        });
        // Wiki (and cache params 13/14): attack range 10, speed 5.
        this.register({
            itemIds: [ItemIdentifiers.SCORCHING_BOW],
            attackAnimation: 426,
            attackSpeed: 5,
            attackDistance: 10,
            longRangeDistance: 10,
            hitDelays: [STANDARD_HIT],
            projectiles: [DEFAULT_PROJECTILE],
            fireSound: Sound.SHOOT_ARROW,
        });
        this.register({
            itemIds: [21902],
            attackAnimation: 7552,
            attackSpeed: 6,
            attackDistance: 7,
            longRangeDistance: 9,
            longRangeFightType: FightType.CROSSBOW_LONGRANGE,
            hitDelays: [STANDARD_HIT],
            projectiles: [{ delay: 41, lengthAdjustment: 5, stepMultiplier: 5, startHeight: 44, endHeight: 35 }],
            fireSound: Sound.SHOOT_CROSSBOW,
            boltEffects: true,
        });
        // Machetes, sickles and canes share the slash-sword/mace interfaces but swing one tick slower.
        this.register({
            itemIds: [975, 6313, 6315, 6317, 2961, 2963, 3899, 22433, 22435, 24693, 24695],
            attackSpeed: 5,
        });
        this.register({
            itemIds: [12373, 12374, 12375, 12376, 12377, 12378, 12379, 12380],
            attackSpeed: 5,
        });
        // Composite bows (Wiki): 5-tick standard, 4-tick rapid, 10-tile range.
        this.register({
            itemIds: [4827, 10280, 10282, 10284],
            attackAnimation: 426,
            attackSpeed: 5,
            attackDistance: 10,
            longRangeDistance: 10,
            longRangeFightType: FightType.SHORTBOW_LONGRANGE,
            hitDelays: [STANDARD_HIT],
            projectiles: [DEFAULT_PROJECTILE],
            fireSound: Sound.SHOOT_BOW_QUIET,
        });
        // 3rd Age bow (Wiki): shortbow speed with a 9-tile range.
        this.register({
            itemIds: [ItemIdentifiers._3RD_AGE_BOW],
            attackAnimation: 426,
            attackSpeed: 4,
            attackDistance: 9,
            longRangeDistance: 9,
            longRangeFightType: FightType.SHORTBOW_LONGRANGE,
            hitDelays: [STANDARD_HIT],
            projectiles: [DEFAULT_PROJECTILE],
            fireSound: Sound.SHOOT_BOW_QUIET,
        });
        // Chinchompas (Wiki): thrown, 3-tick medium fuse / 4-tick otherwise, 9-tile range.
        this.register({
            itemIds: [10033, 10034, 11959],
            attackSpeed: 4,
            attackDistance: 9,
            longRangeDistance: 9,
            longRangeFightType: FightType.CHINCHOMPA_LONG_FUSE,
            hitDelays: [{ base: 1, distanceOffset: 0, divisor: 6 }],
            projectiles: [THROWN_PROJECTILE],
            fireSound: Sound.THROW_DART,
        });
        return true;
    })();
}
