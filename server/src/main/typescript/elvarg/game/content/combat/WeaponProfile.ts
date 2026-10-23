import { Sound } from "../../Sound";
import type { Player } from "../../entity/impl/player/Player";
import { Equipment } from "../../model/container/impl/Equipment";
import { FightType } from "./FightType";
import { WeaponInterfaces } from "./WeaponInterfaces";
import { BOW_OF_FAERDHINEN_IDS, CRYSTAL_BOW_ALL_WEAPON_IDS } from "./ranged/CrystalBow";
import { ItemIdentifiers } from "../../../util/ItemIdentifiers";
import type { AttackTypeName } from "../../definition/ItemDefinition";

/** FightType bonus types (stab 0 ... range 4) by the names item data uses. */
const ATTACK_TYPE_NAMES: AttackTypeName[] = ["stab", "slash", "crush", "magic", "range"];

export type HitDelayProfile = { base: number; distanceOffset: number; divisor: number };
/** angle and progress are the packet's arc (16 and 64 unless set, see Projectile). */
export type ProjectileProfile = { delay: number; speed?: number; startHeight: number; endHeight: number; lengthAdjustment?: number; stepMultiplier?: number; angle?: number; progress?: number };

export interface WeaponCombatProfile {
    itemIds?: number[];
    weapon?: WeaponInterfaces;
    attackAnimation?: number;
    /** The cache's separate animation against NPCs ("..._pvn"), where it has one. */
    npcAttackAnimation?: number;
    attackSpeed?: number;
    attackDistance?: number;
    longRangeDistance?: number;
    longRangeFightType?: FightType;
    hitDelays?: HitDelayProfile[];
    projectiles?: ProjectileProfile[];
    /** The weapon's own travel spotanim, fired instead of its ammunition's. */
    projectileId?: number;
    /** The weapon's own launch spotanim, played instead of its ammunition's. */
    launchGraphic?: number;
    startGraphic?: boolean;
    /** Fires two arrows: the ammunition's double launch graphic (double_<ammo>_arrow_launch). */
    doubleStartGraphic?: boolean;
    attackSound?: Sound;
    fireSound?: Sound;
    ammoRequired?: number;
    boltEffects?: boolean;
    rangedDefenceType?: "light" | "standard" | "heavy";
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

    /**
     * A profile registered for the item, then the item's own data (`attackAnim` in
     * item-gameplay.json), then its weapon type's profile, then `fallback` (the style's). A
     * profile's NPC animation is used for an attack on an NPC.
     */
    public static attackAnimation(player: Player, fallback: number, againstNpc = false): number {
        const weapon = this.equippedWeapon(player);
        const attackType = ATTACK_TYPE_NAMES[FightType.resolve(player.getFightType())?.getBonusType() ?? -1];
        const itemAnimation = weapon.getId() > 0 ? weapon.getDefinition().getAttackAnim(attackType) : -1;
        const fromProfile = (profile: WeaponCombatProfile | undefined) =>
            (againstNpc ? profile?.npcAttackAnimation : undefined) ?? profile?.attackAnimation;
        return fromProfile(this.byItem.get(weapon.getId()))
            ?? (itemAnimation > 0 ? itemAnimation : undefined)
            ?? fromProfile(this.byWeapon.get(player.getWeapon()))
            ?? fallback;
    }

    /**
     * A profile registered for the item, then the cache's attack speed for the item
     * (ItemDefinition.ATTACK_SPEED_PARAM), then its weapon type's profile, then `fallback`.
     */
    public static attackSpeed(player: Player, fallback: number): number {
        const weapon = this.equippedWeapon(player);
        const cacheSpeed = weapon.getId() > 0 ? weapon.getDefinition().getAttackSpeed() : -1;
        return this.byItem.get(weapon.getId())?.attackSpeed
            ?? (cacheSpeed > 0 ? cacheSpeed : undefined)
            ?? this.byWeapon.get(player.getWeapon())?.attackSpeed
            ?? fallback;
    }

    private static equippedWeapon(player: Player) {
        return player.getEquipment().getItems()[Equipment.WEAPON_SLOT];
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
            rangedDefenceType: "heavy",
            attackAnimation: 4230,
            npcAttackAnimation: 7552,
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
            rangedDefenceType: "heavy",
            attackSpeed: 4,
            attackDistance: 7,
            longRangeDistance: 9,
            longRangeFightType: FightType.KARILS_CROSSBOW_LONGRANGE,
            hitDelays: [STANDARD_HIT],
            projectiles: [{ delay: 41, lengthAdjustment: 5, stepMultiplier: 5, startHeight: 44, endHeight: 35 }],
            fireSound: Sound.SHOOT_CROSSBOW,
        });
        this.add(WeaponInterfaces.BLOWPIPE, {
            rangedDefenceType: "light",
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
            rangedDefenceType: "light",
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
            rangedDefenceType: "light",
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
            rangedDefenceType: "heavy",
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
        this.add(WeaponInterfaces.THROWNAXE, {
            attackDistance: 4,
            longRangeDistance: 6,
            longRangeFightType: FightType.THROWNAXE_LONGRANGE,
            rangedDefenceType: "light",
            hitDelays: [{ base: 1, distanceOffset: 0, divisor: 6 }],
            projectiles: [THROWN_PROJECTILE],
        });
        this.add(WeaponInterfaces.HALBERD, { attackDistance: 2 });
        this.add(WeaponInterfaces.WHIP, { attackAnimation: 1658, attackSpeed: 4, attackSound: Sound.WEAPON_WHIP });
        this.add(WeaponInterfaces.BALLISTA, {
            rangedDefenceType: "heavy",
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
            attackDistance: 10,
            longRangeDistance: 10,
            longRangeFightType: FightType.LONGBOW_LONGRANGE,
            hitDelays: [STANDARD_HIT, { base: 1, distanceOffset: 2, divisor: 3 }],
            projectiles: [DEFAULT_PROJECTILE, { delay: 41, lengthAdjustment: 14, stepMultiplier: 10, startHeight: 48, endHeight: 31 }],
            fireSound: Sound.SHOOT_BOW_QUIET,
            ammoRequired: 2,
            doubleStartGraphic: true,
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
        // Wiki: range 6, 8 on Longrange; speed from cache param 14 (5). Captures (rsprox): every
        // arrow flies as arrow_venator01_travel01 (2291) from arrow_venator01_launch01 (2289), at
        // starttime 31 and endtime 46 + 2 per tile, heights 39 -> 36, angle 255, progress 11, with
        // synth 6797. The hit lands on the tick the arrow does, floor(end / 30) - as the standard
        // table, 1 + floor((3 + d) / 6), does for its arrow's 46 + 5 per tile - so floor((23 + d) / 15):
        // 1 up to 6 tiles (captured: the NPC's hitsplat 2 ticks after the shot at 1-6 tiles), 2 beyond.
        this.register({
            itemIds: [ItemIdentifiers.VENATOR_BOW, ItemIdentifiers.VENATOR_BOW_UNCHARGED_],
            attackDistance: 6,
            longRangeDistance: 8,
            longRangeFightType: FightType.SHORTBOW_LONGRANGE,
            hitDelays: [{ base: 0, distanceOffset: 23, divisor: 15 }],
            projectiles: [{ delay: 31, lengthAdjustment: 15, stepMultiplier: 2, startHeight: 39, endHeight: 36, angle: 255, progress: 11 }],
            projectileId: 2291,
            launchGraphic: 2289,
            fireSound: Sound.VENATOR_BOW_SHOOT,
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
            attackAnimation: 4230,
            npcAttackAnimation: 7552,
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
        // Wands (Wiki): the staff interface's styles at 4 ticks, a tick faster than staves; the cache has no speed for them.
        this.register({
            itemIds: [
                ItemIdentifiers.BEGINNER_WAND, ItemIdentifiers.BEGINNER_WAND_3, ItemIdentifiers.APPRENTICE_WAND,
                ItemIdentifiers.APPRENTICE_WAND_3, ItemIdentifiers.TEACHER_WAND, ItemIdentifiers.MASTER_WAND,
                ItemIdentifiers.MASTER_WAND_3, ItemIdentifiers._3RD_AGE_WAND, ItemIdentifiers.KODAI_WAND,
                ItemIdentifiers.KODAI_WAND_3, ItemIdentifiers.DRAGON_HUNTER_WAND,
            ],
            attackSpeed: 4,
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
        // Chinchompas (Wiki): thrown, 3-tick medium fuse / 4-tick otherwise, 9-tile range (10 on the long fuse).
        const chinchompa = {
            rangedDefenceType: "heavy" as const,
            attackSpeed: 4,
            attackDistance: 9,
            longRangeDistance: 10,
            longRangeFightType: FightType.CHINCHOMPA_LONG_FUSE,
            hitDelays: [{ base: 1, distanceOffset: 0, divisor: 6 }],
            projectiles: [THROWN_PROJECTILE],
            fireSound: Sound.THROW_DART,
        };
        // The others throw with their fight type's human_chinchompa_attack, but black
        // chinchompas have their own seq (human_chinchompa_attack_pvn).
        this.register({ itemIds: [ItemIdentifiers.CHINCHOMPA_2, ItemIdentifiers.RED_CHINCHOMPA_2], ...chinchompa });
        this.register({ itemIds: [ItemIdentifiers.BLACK_CHINCHOMPA], ...chinchompa, attackAnimation: 7618 });
        // Salamanders (Wiki): every style, flare included, reaches 1 tile; speed comes from the SALAMANDER interface.
        this.add(WeaponInterfaces.SALAMANDER, { attackDistance: 1 });
        // Wiki: Blisterwood stakes have 6-tile range (8 on Longrange); the cache
        // capture records their NPC attack animation and projectile.
        this.register({
            itemIds: [ItemIdentifiers.BLISTERWOOD_STAKE],
            attackAnimation: 7617,
            npcAttackAnimation: 7617,
            attackDistance: 6,
            longRangeDistance: 8,
            longRangeFightType: FightType.DART_LONGRANGE,
            hitDelays: [STANDARD_HIT],
            projectiles: [THROWN_PROJECTILE],
            fireSound: Sound.THROW_DART,
        });
        // Wiki (Blackjack): 4-tick attack speed. The cache has no speed param for them, so the
        // blunt (warhammer) interface's 6 would apply.
        this.register({
            itemIds: [
                ItemIdentifiers.OAK_BLACKJACK, ItemIdentifiers.OAK_BLACKJACK_O_, ItemIdentifiers.OAK_BLACKJACK_D_,
                ItemIdentifiers.WILLOW_BLACKJACK, ItemIdentifiers.WILLOW_BLACKJACK_O_, ItemIdentifiers.WILLOW_BLACKJACK_D_,
                ItemIdentifiers.MAPLE_BLACKJACK, ItemIdentifiers.MAPLE_BLACKJACK_O_, ItemIdentifiers.MAPLE_BLACKJACK_D_,
            ],
            attackSpeed: 4,
        });
        return true;
    })();
}
