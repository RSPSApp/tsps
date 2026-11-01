import { ItemAliases } from "../../model/ItemAliases";
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
    /** Tiles it reaches; ranged weapons take the cache's (ItemDefinition.ATTACK_RANGE_PARAM) first. */
    attackDistance?: number;
    /** The style that adds 2 tiles (Longrange). */
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
    /** Scales the enchanted bolt effects' chance (the Ascension crossbows halve it). */
    boltEffectChanceMultiplier?: number;
    rangedDefenceType?: "light" | "standard" | "heavy";
}

// OSRS projectile types (server projanim config): an arrow ends at delay + lengthAdjustment +
// stepMultiplier * distance client cycles after the shot. Heights are quarter-tiles, which
// PacketSender sends times four; the RSProx captures record the sent values, so arrows are
// 163 -> 146, crossbows 155 -> 146, darts 142 -> 146 and javelins 155 -> 177.
const DEFAULT_PROJECTILE: ProjectileProfile = { delay: 41, lengthAdjustment: 5, stepMultiplier: 5, startHeight: 40.75, endHeight: 36.5 };
const THROWN_PROJECTILE: ProjectileProfile = { delay: 32, lengthAdjustment: 0, stepMultiplier: 5, startHeight: 40.75, endHeight: 36.5 };
const DART_PROJECTILE: ProjectileProfile = { delay: 32, lengthAdjustment: 0, stepMultiplier: 5, startHeight: 35.5, endHeight: 36.5 };
// RSProx captures (crossbowbolt_travel 27, dttd_bone_crossbowbolt_travel 696): every player bolt
// flies at angle 5, progress 11.
const CROSSBOW_PROJECTILE: ProjectileProfile = { delay: 41, lengthAdjustment: 5, stepMultiplier: 5, startHeight: 38.75, endHeight: 36.5, angle: 5, progress: 11 };
/** Wiki (Attack range): Longrange reaches 2 tiles further, and no weapon reaches past 10. */
const LONGRANGE_EXTRA_TILES = 2;
const MAX_ATTACK_RANGE = 10;
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
        const itemProfile = ItemAliases.lookup(this.byItem, itemId);
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
        return fromProfile(ItemAliases.lookup(this.byItem, weapon.getId()))
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
        return ItemAliases.lookup(this.byItem, weapon.getId())?.attackSpeed
            ?? (cacheSpeed > 0 ? cacheSpeed : undefined)
            ?? this.byWeapon.get(player.getWeapon())?.attackSpeed
            ?? fallback;
    }

    private static equippedWeapon(player: Player) {
        return player.getEquipment().getItems()[Equipment.WEAPON_SLOT];
    }

    /**
     * Ranged reach: a profile registered for the item, then the cache's range for the item
     * (ItemDefinition.ATTACK_RANGE_PARAM), then its weapon type's profile, then `fallback`. The
     * weapon's Longrange style adds 2 tiles, and nothing reaches past 10 (Wiki: Attack range).
     */
    public static attackDistance(player: Player, fallback: number): number {
        const weapon = this.equippedWeapon(player);
        const cacheRange = weapon.getId() > 0 ? weapon.getDefinition().getAttackRange() : -1;
        const range = ItemAliases.lookup(this.byItem, weapon.getId())?.attackDistance
            ?? (cacheRange > 0 ? cacheRange : undefined)
            ?? this.byWeapon.get(player.getWeapon())?.attackDistance
            ?? fallback;
        const longRange = this.isLongRange(player, this.get(player));
        return Math.min(MAX_ATTACK_RANGE, range + (longRange ? LONGRANGE_EXTRA_TILES : 0));
    }

    /** Melee reach: a profile's (halberds), or `fallback`. */
    public static meleeAttackDistance(player: Player, fallback: number): number {
        return this.get(player)?.attackDistance ?? fallback;
    }

    public static hitDelays(player: Player, distance: number): number[] {
        const profile = this.ranged(player);
        const delays = profile?.hitDelays ?? [STANDARD_HIT];
        const normalizedDistance = Math.max(0, Math.floor(distance));
        return delays.map(({ base, distanceOffset, divisor }) => base + Math.floor((distanceOffset + normalizedDistance) / divisor));
    }

    public static isLongRange(player: Player, profile: WeaponCombatProfile | undefined): boolean {
        return profile?.longRangeFightType != null && player.getFightType() === profile.longRangeFightType;
    }

    private static add(weapon: WeaponInterfaces, profile: WeaponCombatProfile): void {
        this.byWeapon.set(weapon, { weapon, ...profile });
    }

    private static readonly loaded = (() => {
        const bow = {
            attackAnimation: 426,
            attackSpeed: 4,
            attackDistance: 7,
            longRangeFightType: FightType.SHORTBOW_LONGRANGE,
            hitDelays: [STANDARD_HIT],
            projectiles: [DEFAULT_PROJECTILE],
            fireSound: Sound.SHOOT_ARROW,
        };
        this.add(WeaponInterfaces.SHORTBOW, bow);
        this.add(WeaponInterfaces.LONGBOW, {
            ...bow,
            attackSpeed: 6,
            attackDistance: 10,
            longRangeFightType: FightType.LONGBOW_LONGRANGE,
            fireSound: Sound.SHOOT_BOW_QUIET,
        });
        this.add(WeaponInterfaces.CROSSBOW, {
            rangedDefenceType: "heavy",
            attackAnimation: 4230,
            npcAttackAnimation: 7552,
            attackSpeed: 6,
            attackDistance: 7,
            longRangeFightType: FightType.CROSSBOW_LONGRANGE,
            hitDelays: [STANDARD_HIT],
            projectiles: [CROSSBOW_PROJECTILE],
            fireSound: Sound.SHOOT_CROSSBOW,
            boltEffects: true,
        });
        this.add(WeaponInterfaces.KARILS_CROSSBOW, {
            rangedDefenceType: "heavy",
            attackSpeed: 4,
            attackDistance: 8,
            longRangeFightType: FightType.KARILS_CROSSBOW_LONGRANGE,
            hitDelays: [STANDARD_HIT],
            projectiles: [CROSSBOW_PROJECTILE],
            fireSound: Sound.SHOOT_CROSSBOW,
        });
        this.add(WeaponInterfaces.BLOWPIPE, {
            rangedDefenceType: "light",
            attackAnimation: 5061,
            attackSpeed: 3,
            attackDistance: 5,
            longRangeFightType: FightType.BLOWPIPE_LONGRANGE,
            hitDelays: [{ base: 1, distanceOffset: 0, divisor: 6 }],
            projectiles: [{ delay: 32, lengthAdjustment: 0, stepMultiplier: 5, startHeight: 35.5, endHeight: 36.5 }],
            startGraphic: false,
            fireSound: Sound.THROW_DART,
        });
        this.add(WeaponInterfaces.KNIFE, {
            rangedDefenceType: "light",
            attackAnimation: 806,
            attackSpeed: 3,
            attackDistance: 4,
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
            longRangeFightType: FightType.DART_LONGRANGE,
            hitDelays: [{ base: 1, distanceOffset: 0, divisor: 6 }],
            projectiles: [DART_PROJECTILE],
            fireSound: Sound.THROW_DART,
        });
        this.add(WeaponInterfaces.JAVELIN, {
            rangedDefenceType: "heavy",
            attackAnimation: 929,
            attackSpeed: 6,
            attackDistance: 5,
            longRangeFightType: FightType.JAVELIN_LONGRANGE,
            hitDelays: [{ base: 1, distanceOffset: 0, divisor: 6 }],
            projectiles: [THROWN_PROJECTILE],
            fireSound: Sound.THROW_DART,
        });
        this.add(WeaponInterfaces.OBBY_RINGS, {
            attackSpeed: 4,
            attackDistance: 7,
            longRangeFightType: FightType.OBBY_RING_LONGRANGE,
            hitDelays: [{ base: 1, distanceOffset: 0, divisor: 6 }],
            projectiles: [{ delay: 32, lengthAdjustment: 0, stepMultiplier: 5, startHeight: 40.75, endHeight: 36.5 }],
            fireSound: Sound.THROW_DART,
        });
        this.add(WeaponInterfaces.THROWNAXE, {
            attackDistance: 4,
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
            attackDistance: 9,
            longRangeFightType: FightType.BALLISTA_LONGRANGE,
            hitDelays: [{ base: 2, distanceOffset: 1, divisor: 6 }],
            // RSProx capture (silvthrill_javelin_travel 3806, recording 4288): start 42,
            // end 44 + 3 a tile, angle 14, progress 120, heights 155 -> 177 (sent quarters).
            // The hit delay above is that arrival (ceil((44 + 3d) / 30)).
            projectiles: [{ delay: 42, lengthAdjustment: 2, stepMultiplier: 3, startHeight: 38.75, endHeight: 44.25, angle: 14, progress: 120 }],
            fireSound: Sound.SHOOT_CROSSBOW,
        });
        this.add(WeaponInterfaces.DARK_BOW, {
            attackAnimation: 426,
            attackSpeed: 9,
            attackDistance: 10,
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
            hitDelays: [STANDARD_HIT],
            projectiles: [DEFAULT_PROJECTILE],
            fireSound: Sound.SHOOT_ARROW,
        });
        this.register({
            itemIds: BOW_OF_FAERDHINEN_IDS,
            attackAnimation: 426,
            attackSpeed: 5,
            hitDelays: [STANDARD_HIT],
            projectiles: [DEFAULT_PROJECTILE],
            fireSound: Sound.SHOOT_ARROW,
        });
        this.register({
            itemIds: [ItemIdentifiers.TWISTED_BOW],
            attackAnimation: 426,
            attackSpeed: 5,
            hitDelays: [STANDARD_HIT],
            projectiles: [DEFAULT_PROJECTILE],
            fireSound: Sound.SHOOT_ARROW,
        });
        // Wiki: range 6, 8 on Longrange (cache param 13); speed from cache param 14 (5). Captures (rsprox): every
        // arrow flies as arrow_venator01_travel01 (2291) from arrow_venator01_launch01 (2289), at
        // starttime 31 and endtime 46 + 2 per tile, heights 39 -> 36, angle 255, progress 11, with
        // synth 6797. The hit lands on the tick the arrow does, floor(end / 30) - as the standard
        // table, 1 + floor((3 + d) / 6), does for its arrow's 46 + 5 per tile - so floor((23 + d) / 15):
        // 1 up to 6 tiles (captured: the NPC's hitsplat 2 ticks after the shot at 1-6 tiles), 2 beyond.
        this.register({
            itemIds: [ItemIdentifiers.VENATOR_BOW, ItemIdentifiers.VENATOR_BOW_UNCHARGED_],
            longRangeFightType: FightType.SHORTBOW_LONGRANGE,
            hitDelays: [{ base: 0, distanceOffset: 23, divisor: 15 }],
            projectiles: [{ delay: 31, lengthAdjustment: 15, stepMultiplier: 2, startHeight: 39, endHeight: 36.5, angle: 255, progress: 11 }],
            projectileId: 2291,
            launchGraphic: 2289,
            fireSound: Sound.VENATOR_BOW_SHOOT,
        });
        // Wiki (and cache params 13/14): attack range 10, speed 5; the range comes from the cache.
        this.register({
            itemIds: [ItemIdentifiers.SCORCHING_BOW],
            attackAnimation: 426,
            attackSpeed: 5,
            hitDelays: [STANDARD_HIT],
            projectiles: [DEFAULT_PROJECTILE],
            fireSound: Sound.SHOOT_ARROW,
        });
        this.register({
            itemIds: [21902],
            attackAnimation: 4230,
            npcAttackAnimation: 7552,
            attackSpeed: 6,
            longRangeFightType: FightType.CROSSBOW_LONGRANGE,
            hitDelays: [STANDARD_HIT],
            projectiles: [CROSSBOW_PROJECTILE],
            fireSound: Sound.SHOOT_CROSSBOW,
            boltEffects: true,
        });
        // Wiki (Ascension crossbows): 3 ticks (cache param 14), range 6, 8 on Longrange. The shot alternates
        // tfa_human_ascension_crossbow_fire_left/right (15113/15115, _pvn 15114/15116); the plugin flips
        // sides, this is the left one. Projectile heights are the standard crossbow's (an estimate).
        this.register({
            itemIds: [ItemIdentifiers.ASCENSION_CROSSBOWS],
            attackAnimation: 15113,
            npcAttackAnimation: 15114,
            attackDistance: 6,
            longRangeFightType: FightType.CROSSBOW_LONGRANGE,
            hitDelays: [STANDARD_HIT],
            projectiles: [CROSSBOW_PROJECTILE],
            fireSound: Sound.SHOOT_CROSSBOW,
            boltEffects: true,
            // Wiki (Ascension crossbows): the chance to trigger enchanted bolt effects is reduced by 50%.
            boltEffectChanceMultiplier: 0.5,
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
        // Comp ogre bow and composite bows (Wiki): 5-tick standard, 4-tick rapid. Range from the cache: 5 for
        // the comp ogre bow, 12 for the composite bows, which the 10-tile limit cuts to 10.
        this.register({
            itemIds: [4827, 10280, 10282, 10284],
            attackAnimation: 426,
            attackSpeed: 5,
            longRangeFightType: FightType.SHORTBOW_LONGRANGE,
            hitDelays: [STANDARD_HIT],
            projectiles: [DEFAULT_PROJECTILE],
            fireSound: Sound.SHOOT_BOW_QUIET,
        });
        // 3rd Age bow (Wiki): shortbow speed; its 9-tile range (10 on Longrange) is the cache's.
        this.register({
            itemIds: [ItemIdentifiers._3RD_AGE_BOW],
            attackAnimation: 426,
            attackSpeed: 4,
            longRangeFightType: FightType.SHORTBOW_LONGRANGE,
            hitDelays: [STANDARD_HIT],
            projectiles: [DEFAULT_PROJECTILE],
            fireSound: Sound.SHOOT_BOW_QUIET,
        });
        // Chinchompas (Wiki): thrown, 3-tick medium fuse / 4-tick otherwise; the cache's 9-tile range (10 on the long fuse).
        const chinchompa = {
            rangedDefenceType: "heavy" as const,
            attackSpeed: 4,
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
        // Wiki: Blisterwood stakes have 6-tile range (8 on Longrange), the cache's; the cache
        // capture records their NPC attack animation and projectile.
        this.register({
            itemIds: [ItemIdentifiers.BLISTERWOOD_STAKE],
            attackAnimation: 7617,
            npcAttackAnimation: 7617,
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
