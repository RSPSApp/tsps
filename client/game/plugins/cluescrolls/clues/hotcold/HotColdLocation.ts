/*
 * Copyright (c) 2018, Eadgars Ruse <https://github.com/Eadgars-Ruse>
 * Copyright (c) 2018, Adam <Adam@sigterm.info>
 * Copyright (c) 2019, Jordan Atwood <nightfirecat@protonmail.com>
 * All rights reserved.
 * Ported to TypeScript from RuneLite 1.13.6. BSD 2-Clause License, see ./LICENSE.
 */
import { Rectangle } from "@runelite/awt/Shapes";
import { WorldPoint } from "@runelite/api/coords/WorldPoint";
import { Enemy } from "../Enemy";
import { HotColdArea } from "./HotColdArea";
import { HotColdTemperature } from "./HotColdTemperature";

/** Which strange device a dig spot belongs to. */
export const HotColdType = { BEGINNER: "BEGINNER", MASTER: "MASTER" } as const;
export type HotColdType = (typeof HotColdType)[keyof typeof HotColdType];

const { BEGINNER, MASTER } = HotColdType;
const { ASGARNIA, DESERT, FELDIP_HILLS, FREMENNIK_PROVINCE, KANDARIN, KARAMJA, MISTHALIN, MORYTANIA, OCEAN, VARLAMORE, WESTERN_PROVINCE, WILDERNESS, ZEAH } = HotColdArea;
const { BRASSICAN_MAGE, ANCIENT_WIZARDS, BRASSICAN_OR_WIZARDS } = Enemy;

/**
 * Every hot-cold dig spot (RuneLite's HotColdLocation): the device that leads to it, its tile,
 * the area it is listed under, a short description and the master-clue enemy it spawns.
 */
export class HotColdLocation {
    private static readonly all: HotColdLocation[] = [];

    private constructor(
        private readonly type: HotColdType,
        private readonly worldPoint: WorldPoint,
        private readonly hotColdArea: HotColdArea,
        private readonly areaDescription: string,
        private readonly enemy: Enemy | null = null,
    ) {
        HotColdLocation.all.push(this);
    }

    /** Every spot, in table order (Java's values()). */
    static values(): HotColdLocation[] {
        return [...HotColdLocation.all];
    }

    getType(): HotColdType {
        return this.type;
    }

    getWorldPoint(): WorldPoint {
        return this.worldPoint;
    }

    getHotColdArea(): HotColdArea {
        return this.hotColdArea;
    }

    /** The short description shown under the area ("North of the Warriors' Guild in Burthorpe."). */
    getArea(): string {
        return this.areaDescription;
    }

    getEnemy(): Enemy | null {
        return this.enemy;
    }

    /** The tiles the device reads as "visibly shaking" around the spot. */
    getRect(): Rectangle {
        const digRadius = this.isBeginnerClue() ? HotColdTemperature.BEGINNER_VISIBLY_SHAKING.getMaxDistance() : HotColdTemperature.MASTER_VISIBLY_SHAKING.getMaxDistance();
        return new Rectangle(this.worldPoint.getX() - digRadius, this.worldPoint.getY() - digRadius, digRadius * 2 + 1, digRadius * 2 + 1);
    }

    isBeginnerClue(): boolean {
        return this.type === BEGINNER;
    }

    static readonly ASGARNIA_WARRIORS = new HotColdLocation(MASTER, new WorldPoint(2860, 3562, 0), ASGARNIA, "North of the Warriors' Guild in Burthorpe.", BRASSICAN_MAGE);
    static readonly ASGARNIA_JATIX = new HotColdLocation(MASTER, new WorldPoint(2915, 3425, 0), ASGARNIA, "East of Jatix's Herblore Shop in Taverley.", BRASSICAN_MAGE);
    static readonly ASGARNIA_BARB = new HotColdLocation(MASTER, new WorldPoint(3033, 3438, 0), ASGARNIA, "West of Barbarian Village.", BRASSICAN_MAGE);
    static readonly ASGARNIA_MIAZRQA = new HotColdLocation(MASTER, new WorldPoint(2972, 3486, 0), ASGARNIA, "North of Miazrqa's tower, outside Goblin Village.", BRASSICAN_MAGE);
    static readonly ASGARNIA_COW = new HotColdLocation(MASTER, new WorldPoint(3031, 3304, 0), ASGARNIA, "In the cow pen north of Sarah's Farming Shop.", ANCIENT_WIZARDS);
    static readonly ASGARNIA_PARTY_ROOM = new HotColdLocation(MASTER, new WorldPoint(3030, 3364, 0), ASGARNIA, "Outside the Falador Party Room.", BRASSICAN_MAGE);
    static readonly ASGARNIA_CRAFT_GUILD = new HotColdLocation(MASTER, new WorldPoint(2917, 3295, 0), ASGARNIA, "Outside the Crafting Guild cow pen.", BRASSICAN_MAGE);
    static readonly ASGARNIA_RIMMINGTON = new HotColdLocation(MASTER, new WorldPoint(2976, 3239, 0), ASGARNIA, "In the centre of the Rimmington mine.", BRASSICAN_MAGE);
    static readonly ASGARNIA_MUDSKIPPER = new HotColdLocation(MASTER, new WorldPoint(2987, 3110, 0), ASGARNIA, "Mudskipper Point, near the starfish in the south-west corner.", BRASSICAN_MAGE);
    static readonly ASGARNIA_TROLL = new HotColdLocation(MASTER, new WorldPoint(2910, 3615, 0), ASGARNIA, "The Troll arena, where the player fights Dad during the Troll Stronghold quest. Bring climbing boots if travelling from Burthorpe.", BRASSICAN_MAGE);
    static readonly DESERT_GENIE = new HotColdLocation(MASTER, new WorldPoint(3359, 2912, 0), DESERT, "West of Nardah genie cave.", BRASSICAN_MAGE);
    static readonly DESERT_ALKHARID_MINE = new HotColdLocation(MASTER, new WorldPoint(3279, 3263, 0), DESERT, "West of Al Kharid mine.", BRASSICAN_MAGE);
    static readonly DESERT_MENAPHOS_GATE = new HotColdLocation(MASTER, new WorldPoint(3223, 2820, 0), DESERT, "North of Menaphos gate.", BRASSICAN_MAGE);
    static readonly DESERT_BEDABIN_CAMP = new HotColdLocation(MASTER, new WorldPoint(3161, 3047, 0), DESERT, "Bedabin Camp, near the north tent.", BRASSICAN_MAGE);
    static readonly DESERT_UZER = new HotColdLocation(MASTER, new WorldPoint(3432, 3105, 0), DESERT, "West of Uzer.", BRASSICAN_MAGE);
    static readonly DESERT_POLLNIVNEACH = new HotColdLocation(MASTER, new WorldPoint(3288, 2976, 0), DESERT, "West of Pollnivneach.", BRASSICAN_MAGE);
    static readonly DESERT_MTA = new HotColdLocation(MASTER, new WorldPoint(3347, 3295, 0), DESERT, "Next to Mage Training Arena.", BRASSICAN_MAGE);
    static readonly DESERT_RUINS_OF_ULLEK = new HotColdLocation(MASTER, new WorldPoint(3428, 2773, 0), DESERT, "South-east of Ruins of Ullek.", BRASSICAN_MAGE);
    static readonly DESERT_SHANTY = new HotColdLocation(MASTER, new WorldPoint(3292, 3107, 0), DESERT, "South-west of Shantay Pass.", BRASSICAN_MAGE);
    static readonly DRAYNOR_MANOR_MUSHROOMS = new HotColdLocation(BEGINNER, new WorldPoint(3096, 3379, 0), MISTHALIN, "Patch of mushrooms just northwest of Draynor Manor");
    static readonly DRAYNOR_WHEAT_FIELD = new HotColdLocation(BEGINNER, new WorldPoint(3120, 3282, 0), MISTHALIN, "Inside the wheat field next to Draynor Village");
    static readonly FELDIP_HILLS_JIGGIG = new HotColdLocation(MASTER, new WorldPoint(2409, 3053, 0), FELDIP_HILLS, "West of Jiggig, east of the fairy ring BKP.", BRASSICAN_MAGE);
    static readonly FELDIP_HILLS_SW = new HotColdLocation(MASTER, new WorldPoint(2586, 2897, 0), FELDIP_HILLS, "West of the southeasternmost lake in Feldip Hills.", BRASSICAN_MAGE);
    static readonly FELDIP_HILLS_GNOME_GLITER = new HotColdLocation(MASTER, new WorldPoint(2555, 2972, 0), FELDIP_HILLS, "East of the gnome glider (Lemantolly Undri).", BRASSICAN_MAGE);
    static readonly FELDIP_HILLS_RANTZ = new HotColdLocation(MASTER, new WorldPoint(2611, 2950, 0), FELDIP_HILLS, "South of Rantz, west of the empty glass bottles.", BRASSICAN_MAGE);
    static readonly FELDIP_HILLS_SOUTH = new HotColdLocation(MASTER, new WorldPoint(2486, 3007, 0), FELDIP_HILLS, "South of Jiggig.", BRASSICAN_MAGE);
    static readonly FELDIP_HILLS_RED_CHIN = new HotColdLocation(MASTER, new WorldPoint(2530, 2901, 0), FELDIP_HILLS, "Outside the red chinchompa hunting ground entrance, south of the Hunting expert's hut.", BRASSICAN_MAGE);
    static readonly FELDIP_HILLS_SE = new HotColdLocation(MASTER, new WorldPoint(2569, 2918, 0), FELDIP_HILLS, "South-east of the ∩-shaped lake, near the Hunter icon.", BRASSICAN_MAGE);
    static readonly FELDIP_HILLS_CW_BALLOON = new HotColdLocation(MASTER, new WorldPoint(2451, 3112, 0), FELDIP_HILLS, "Directly west of the Castle Wars balloon.", BRASSICAN_MAGE);
    static readonly FREMENNIK_PROVINCE_MTN_CAMP = new HotColdLocation(MASTER, new WorldPoint(2800, 3669, 0), FREMENNIK_PROVINCE, "At the Mountain Camp.", BRASSICAN_MAGE);
    static readonly FREMENNIK_PROVINCE_RELLEKKA_HUNTER = new HotColdLocation(MASTER, new WorldPoint(2720, 3784, 0), FREMENNIK_PROVINCE, "At the Rellekka Hunter area, near the Hunter icon.", BRASSICAN_MAGE);
    static readonly FREMENNIK_PROVINCE_KELGADRIM_ENTRANCE = new HotColdLocation(MASTER, new WorldPoint(2711, 3689, 0), FREMENNIK_PROVINCE, "West of the Keldagrim entrance mine.", BRASSICAN_MAGE);
    static readonly FREMENNIK_PROVINCE_SW = new HotColdLocation(MASTER, new WorldPoint(2604, 3648, 0), FREMENNIK_PROVINCE, "Outside the fence in the south-western corner of Rellekka.", BRASSICAN_MAGE);
    static readonly FREMENNIK_PROVINCE_LIGHTHOUSE = new HotColdLocation(MASTER, new WorldPoint(2585, 3601, 0), FREMENNIK_PROVINCE, "South-east of the Lighthouse.", BRASSICAN_MAGE);
    static readonly FREMENNIK_PROVINCE_ETCETERIA_CASTLE = new HotColdLocation(MASTER, new WorldPoint(2617, 3862, 0), FREMENNIK_PROVINCE, "South-east of Etceteria's castle.", BRASSICAN_MAGE);
    static readonly FREMENNIK_PROVINCE_MISC_COURTYARD = new HotColdLocation(MASTER, new WorldPoint(2527, 3868, 0), FREMENNIK_PROVINCE, "Outside Miscellania's courtyard.", BRASSICAN_MAGE);
    static readonly FREMENNIK_PROVINCE_FREMMY_ISLES_MINE = new HotColdLocation(MASTER, new WorldPoint(2374, 3850, 0), FREMENNIK_PROVINCE, "Central Fremennik Isles mine.", ANCIENT_WIZARDS);
    static readonly FREMENNIK_PROVINCE_WEST_ISLES_MINE = new HotColdLocation(MASTER, new WorldPoint(2313, 3850, 0), FREMENNIK_PROVINCE, "West Fremennik Isles mine.", ANCIENT_WIZARDS);
    static readonly FREMENNIK_PROVINCE_WEST_JATIZSO_ENTRANCE = new HotColdLocation(MASTER, new WorldPoint(2393, 3812, 0), FREMENNIK_PROVINCE, "West of the Jatizso mine entrance.", BRASSICAN_MAGE);
    static readonly FREMENNIK_PROVINCE_PIRATES_COVE = new HotColdLocation(MASTER, new WorldPoint(2211, 3817, 0), FREMENNIK_PROVINCE, "Pirates' Cove", ANCIENT_WIZARDS);
    static readonly FREMENNIK_PROVINCE_ASTRAL_ALTER = new HotColdLocation(MASTER, new WorldPoint(2149, 3865, 0), FREMENNIK_PROVINCE, "Astral altar", ANCIENT_WIZARDS);
    static readonly FREMENNIK_PROVINCE_LUNAR_VILLAGE = new HotColdLocation(MASTER, new WorldPoint(2084, 3916, 0), FREMENNIK_PROVINCE, "Lunar Isle, inside the village.", ANCIENT_WIZARDS);
    static readonly FREMENNIK_PROVINCE_LUNAR_NORTH = new HotColdLocation(MASTER, new WorldPoint(2106, 3949, 0), FREMENNIK_PROVINCE, "Lunar Isle, north of the village.", ANCIENT_WIZARDS);
    static readonly ICE_MOUNTAIN = new HotColdLocation(BEGINNER, new WorldPoint(3007, 3475, 0), MISTHALIN, "Atop Ice Mountain");
    static readonly ISLE_OF_SOULS_MINE = new HotColdLocation(MASTER, new WorldPoint(2189, 2794, 0), KANDARIN, "Isle of Souls Mine, south of the Soul Wars lobby", BRASSICAN_MAGE);
    static readonly KANDARIN_SINCLAR_MANSION = new HotColdLocation(MASTER, new WorldPoint(2730, 3588, 0), KANDARIN, "North-west of the Sinclair Mansion, near the log balance shortcut.", BRASSICAN_MAGE);
    static readonly KANDARIN_CATHERBY = new HotColdLocation(MASTER, new WorldPoint(2774, 3436, 0), KANDARIN, "Catherby, between the bank and the beehives, near small rock formation.", BRASSICAN_MAGE);
    static readonly KANDARIN_GRAND_TREE = new HotColdLocation(MASTER, new WorldPoint(2448, 3503, 0), KANDARIN, "Grand Tree, just east of the terrorchick gnome enclosure.", BRASSICAN_MAGE);
    static readonly KANDARIN_SEERS = new HotColdLocation(MASTER, new WorldPoint(2732, 3485, 0), KANDARIN, "Outside Seers' Village bank.", BRASSICAN_MAGE);
    static readonly KANDARIN_MCGRUBORS_WOOD = new HotColdLocation(MASTER, new WorldPoint(2653, 3485, 0), KANDARIN, "McGrubor's Wood", BRASSICAN_MAGE);
    static readonly KANDARIN_FISHING_BUILD = new HotColdLocation(MASTER, new WorldPoint(2590, 3369, 0), KANDARIN, "South of Fishing Guild", BRASSICAN_MAGE);
    static readonly KANDARIN_WITCHHAVEN = new HotColdLocation(MASTER, new WorldPoint(2707, 3306, 0), KANDARIN, "Outside Witchaven, west of Jeb, Holgart, and Caroline.", BRASSICAN_MAGE);
    static readonly KANDARIN_NECRO_TOWER = new HotColdLocation(MASTER, new WorldPoint(2667, 3241, 0), KANDARIN, "Ground floor inside the Necromancer Tower. Easily accessed by using fairy ring code DJP.", ANCIENT_WIZARDS);
    static readonly KANDARIN_FIGHT_ARENA = new HotColdLocation(MASTER, new WorldPoint(2587, 3135, 0), KANDARIN, "South of the Fight Arena, north-west of the Nightmare Zone.", BRASSICAN_MAGE);
    static readonly KANDARIN_TREE_GNOME_VILLAGE = new HotColdLocation(MASTER, new WorldPoint(2530, 3164, 0), KANDARIN, "Tree Gnome Village, near the general store icon.", BRASSICAN_MAGE);
    static readonly KANDARIN_GRAVE_OF_SCORPIUS = new HotColdLocation(MASTER, new WorldPoint(2467, 3227, 0), KANDARIN, "Grave of Scorpius", BRASSICAN_MAGE);
    static readonly KANDARIN_KHAZARD_BATTLEFIELD = new HotColdLocation(MASTER, new WorldPoint(2522, 3252, 0), KANDARIN, "Khazard Battlefield, south of Tracker gnome 2.", BRASSICAN_MAGE);
    static readonly KANDARIN_WEST_ARDY = new HotColdLocation(MASTER, new WorldPoint(2535, 3322, 0), KANDARIN, "West Ardougne, near the staircase outside the Civic Office.", BRASSICAN_MAGE);
    static readonly KANDARIN_SW_TREE_GNOME_STRONGHOLD = new HotColdLocation(MASTER, new WorldPoint(2411, 3429, 0), KANDARIN, "South-west Tree Gnome Stronghold", BRASSICAN_MAGE);
    static readonly KANDARIN_OUTPOST = new HotColdLocation(MASTER, new WorldPoint(2457, 3362, 0), KANDARIN, "South of the Tree Gnome Stronghold, north-east of the Outpost.", BRASSICAN_MAGE);
    static readonly KANDARIN_BAXTORIAN_FALLS = new HotColdLocation(MASTER, new WorldPoint(2530, 3477, 0), KANDARIN, "South-east of Almera's house on Baxtorian Falls.", BRASSICAN_MAGE);
    static readonly KANDARIN_BA_AGILITY_COURSE = new HotColdLocation(MASTER, new WorldPoint(2540, 3548, 0), KANDARIN, "Inside the Barbarian Agility Course. Completion of Alfred Grimhand's Barcrawl is required.", BRASSICAN_MAGE);
    static readonly KARAMJA_MUSA_POINT = new HotColdLocation(MASTER, new WorldPoint(2913, 3169, 0), KARAMJA, "Musa Point, banana plantation.", BRASSICAN_MAGE);
    static readonly KARAMJA_BRIMHAVEN_FRUIT_TREE = new HotColdLocation(MASTER, new WorldPoint(2782, 3215, 0), KARAMJA, "Brimhaven, east of the fruit tree patch.", BRASSICAN_MAGE);
    static readonly KARAMJA_WEST_BRIMHAVEN = new HotColdLocation(MASTER, new WorldPoint(2718, 3167, 0), KARAMJA, "West of Brimhaven.", BRASSICAN_MAGE);
    static readonly KARAMJA_GLIDER = new HotColdLocation(MASTER, new WorldPoint(2966, 2976, 0), KARAMJA, "West of the gnome glider.", BRASSICAN_MAGE);
    static readonly KARAMJA_KHARAZI_NE = new HotColdLocation(MASTER, new WorldPoint(2904, 2925, 0), KARAMJA, "North-eastern part of Kharazi Jungle.", BRASSICAN_MAGE);
    static readonly KARAMJA_KHARAZI_SW = new HotColdLocation(MASTER, new WorldPoint(2786, 2899, 0), KARAMJA, "South-western part of Kharazi Jungle.", ANCIENT_WIZARDS);
    static readonly KARAMJA_CRASH_ISLAND = new HotColdLocation(MASTER, new WorldPoint(2909, 2737, 0), KARAMJA, "Northern part of Crash Island.", BRASSICAN_MAGE);
    static readonly LUMBRIDGE_COW_FIELD = new HotColdLocation(BEGINNER,  new WorldPoint(3174, 3336, 0), MISTHALIN, "Cow field north of Lumbridge");
    static readonly MISTHALIN_VARROCK_STONE_CIRCLE = new HotColdLocation(MASTER, new WorldPoint(3225, 3356, 0), MISTHALIN, "South of the stone circle near Varrock's entrance.", BRASSICAN_MAGE);
    static readonly MISTHALIN_LUMBRIDGE = new HotColdLocation(MASTER, new WorldPoint(3234, 3169, 0), MISTHALIN, "Just north-west of the Lumbridge Fishing tutor.", BRASSICAN_MAGE);
    static readonly MISTHALIN_LUMBRIDGE_2 = new HotColdLocation(MASTER, new WorldPoint(3169, 3279, 0), MISTHALIN, "North of the pond between Lumbridge and Draynor Village.", BRASSICAN_MAGE);
    static readonly MISTHALIN_GERTUDES = new HotColdLocation(MASTER, new WorldPoint(3154, 3421, 0), MISTHALIN, "North-east of Gertrude's house west of Varrock.", BRASSICAN_MAGE);
    static readonly MISTHALIN_DRAYNOR_BANK = new HotColdLocation(MASTER, new WorldPoint(3098, 3234, 0), MISTHALIN, "South of Draynor Village bank.", BRASSICAN_MAGE);
    static readonly MISTHALIN_LUMBER_YARD = new HotColdLocation(MASTER, new WorldPoint(3301, 3484, 0), MISTHALIN, "South of Lumber Yard, east of Assistant Serf.", BRASSICAN_MAGE);
    static readonly MORYTANIA_BURGH_DE_ROTT = new HotColdLocation(MASTER, new WorldPoint(3546, 3252, 0), MORYTANIA, "In the north-east area of Burgh de Rott, by the reverse-L-shaped ruins.", BRASSICAN_MAGE);
    static readonly MORYTANIA_DARKMEYER = new HotColdLocation(MASTER, new WorldPoint(3604, 3326, 0), MORYTANIA, "Southwestern part of Darkmeyer.", BRASSICAN_MAGE);
    static readonly MORYTANIA_PORT_PHASMATYS = new HotColdLocation(MASTER, new WorldPoint(3611, 3485, 0), MORYTANIA, "West of Port Phasmatys, south-east of fairy ring ALQ.", BRASSICAN_MAGE);
    static readonly MORYTANIA_HOLLOWS = new HotColdLocation(MASTER, new WorldPoint(3499, 3421, 0), MORYTANIA, "Inside The Hollows, south of the bridge which was repaired in a quest.", BRASSICAN_MAGE);
    static readonly MORYTANIA_SWAMP = new HotColdLocation(MASTER, new WorldPoint(3418, 3372, 0), MORYTANIA, "Inside the Mort Myre Swamp, north-west of the Nature Grotto.", BRASSICAN_MAGE);
    static readonly MORYTANIA_HAUNTED_MINE = new HotColdLocation(MASTER, new WorldPoint(3444, 3255, 0), MORYTANIA, "At Haunted Mine quest start.", BRASSICAN_MAGE);
    static readonly MORYTANIA_MAUSOLEUM = new HotColdLocation(MASTER, new WorldPoint(3497, 3541, 0), MORYTANIA, "South of the Mausoleum.", BRASSICAN_MAGE);
    static readonly MORYTANIA_MOS_LES_HARMLESS = new HotColdLocation(MASTER, new WorldPoint(3740, 3041, 0), MORYTANIA, "Northern area of Mos Le'Harmless, between the lakes.", BRASSICAN_MAGE);
    static readonly MORYTANIA_MOS_LES_HARMLESS_BAR = new HotColdLocation(MASTER, new WorldPoint(3666, 2972, 0), MORYTANIA, "Near Mos Le'Harmless southern bar.", BRASSICAN_MAGE);
    static readonly MORYTANIA_DRAGONTOOTH_NORTH = new HotColdLocation(MASTER, new WorldPoint(3811, 3569, 0), MORYTANIA, "Northern part of Dragontooth Island.", BRASSICAN_MAGE);
    static readonly MORYTANIA_DRAGONTOOTH_SOUTH = new HotColdLocation(MASTER, new WorldPoint(3803, 3529, 0), MORYTANIA, "Southern part of Dragontooth Island.", BRASSICAN_MAGE);
    static readonly MORYTANIA_SLEPE_TENTS = new HotColdLocation(MASTER, new WorldPoint(3769, 3383, 0), MORYTANIA, "North-east of Slepe, near the tents.", BRASSICAN_MAGE);
    static readonly NORTHEAST_OF_AL_KHARID_MINE = new HotColdLocation(BEGINNER, new WorldPoint(3332, 3313, 0), MISTHALIN, "Northeast of Al Kharid Mine");
    static readonly SAIL_GREAT_CONCH = new HotColdLocation(MASTER, new WorldPoint(3249, 2349, 0), OCEAN, "In the south-eastern mine of the Great Conch", BRASSICAN_MAGE);
    static readonly SAIL_ISLE_OF_SERPENTS = new HotColdLocation(MASTER, new WorldPoint(1856, 2415, 0), OCEAN, "On the Isle of Serpents", BRASSICAN_MAGE);
    static readonly SAIL_DRUMSTICK_ISLE = new HotColdLocation(MASTER, new WorldPoint(2139, 3562, 0), OCEAN, "On Drumstick Isle", BRASSICAN_MAGE);
    static readonly SAIL_BUCCANEERS_HAVEN = new HotColdLocation(MASTER, new WorldPoint(2078, 3665, 0), OCEAN, "On Buccaneers' Haven", BRASSICAN_MAGE);
    static readonly VARLAMORE_BAZAAR = new HotColdLocation(MASTER, new WorldPoint(1680, 3107, 0), VARLAMORE, "In the centre of the Bazaar in Civitas illa Fortis.", BRASSICAN_MAGE);
    static readonly VARLAMORE_LOCUS_OASIS = new HotColdLocation(MASTER, new WorldPoint(1695, 2990, 0), VARLAMORE, "Amongst the trees at the Locus Oasis.", BRASSICAN_MAGE);
    static readonly VARLAMORE_RAINFOREST_CENTRE = new HotColdLocation(MASTER, new WorldPoint(1312, 3108, 0), VARLAMORE, "In the centre of the Tlati Rainforest.", BRASSICAN_MAGE);
    static readonly VARLAMORE_SUNSET_COAST = new HotColdLocation(MASTER, new WorldPoint(1534, 2997, 0), VARLAMORE, "North-east corner of Sunset Coast.", BRASSICAN_OR_WIZARDS);
    static readonly VARLAMORE_VILLA_LUCENS = new HotColdLocation(MASTER, new WorldPoint(1469, 2933, 0), VARLAMORE, "On the Villa Lucens theatre stage in Aldarin. Completion of Death on the Isle is required.", BRASSICAN_MAGE);
    static readonly WESTERN_PROVINCE_EAGLES_PEAK = new HotColdLocation(MASTER, new WorldPoint(2297, 3529, 0), WESTERN_PROVINCE, "North-west of Eagles' Peak.", BRASSICAN_MAGE);
    static readonly WESTERN_PROVINCE_PISCATORIS = new HotColdLocation(MASTER, new WorldPoint(2334, 3685, 0), WESTERN_PROVINCE, "Piscatoris Fishing Colony", ANCIENT_WIZARDS);
    static readonly WESTERN_PROVINCE_PISCATORIS_HUNTER_AREA = new HotColdLocation(MASTER, new WorldPoint(2359, 3564, 0), WESTERN_PROVINCE, "Eastern part of Piscatoris Hunter area, south-west of the Falconry.", BRASSICAN_MAGE);
    static readonly WESTERN_PROVINCE_ARANDAR = new HotColdLocation(MASTER, new WorldPoint(2370, 3318, 0), WESTERN_PROVINCE, "South-west of the crystal gate to Arandar.", BRASSICAN_OR_WIZARDS);
    static readonly WESTERN_PROVINCE_ELF_CAMP_EAST = new HotColdLocation(MASTER, new WorldPoint(2268, 3242, 0), WESTERN_PROVINCE, "East of Iorwerth Camp.", BRASSICAN_MAGE);
    static readonly WESTERN_PROVINCE_ELF_CAMP_NW = new HotColdLocation(MASTER, new WorldPoint(2177, 3282, 0), WESTERN_PROVINCE, "North-west of Iorwerth Camp.", BRASSICAN_MAGE);
    static readonly WESTERN_PROVINCE_LLETYA = new HotColdLocation(MASTER, new WorldPoint(2337, 3166, 0), WESTERN_PROVINCE, "In Lletya.", BRASSICAN_MAGE);
    static readonly WESTERN_PROVINCE_TYRAS = new HotColdLocation(MASTER, new WorldPoint(2206, 3158, 0), WESTERN_PROVINCE, "Near Tyras Camp.", BRASSICAN_MAGE);
    static readonly WESTERN_PROVINCE_ZULANDRA = new HotColdLocation(MASTER, new WorldPoint(2196, 3057, 0), WESTERN_PROVINCE, "The northern house at Zul-Andra.", BRASSICAN_MAGE);
    static readonly WILDERNESS_5 = new HotColdLocation(MASTER, new WorldPoint(3173, 3556, 0), WILDERNESS, "North of the Grand Exchange, level 5 Wilderness.", ANCIENT_WIZARDS);
    static readonly WILDERNESS_12 = new HotColdLocation(MASTER, new WorldPoint(3036, 3612, 0), WILDERNESS, "South-east of the Dark Warriors' Fortress, level 12 Wilderness.", ANCIENT_WIZARDS);
    static readonly WILDERNESS_20 = new HotColdLocation(MASTER, new WorldPoint(3222, 3679, 0), WILDERNESS, "East of the Corporeal Beast's lair, level 20 Wilderness.", ANCIENT_WIZARDS);
    static readonly WILDERNESS_27 = new HotColdLocation(MASTER, new WorldPoint(3174, 3736, 0), WILDERNESS, "Inside the Ruins north of the Graveyard of Shadows, level 27 Wilderness.", BRASSICAN_MAGE);
    static readonly WILDERNESS_28 = new HotColdLocation(MASTER, new WorldPoint(3377, 3737, 0), WILDERNESS, "South-east of wilderness crabs teleport, level 28 Wilderness.", BRASSICAN_MAGE);
    static readonly WILDERNESS_32 = new HotColdLocation(MASTER, new WorldPoint(3311, 3773, 0), WILDERNESS, "South of the Silk Chasm near the black knights, level 32 Wilderness.", ANCIENT_WIZARDS);
    static readonly WILDERNESS_35 = new HotColdLocation(MASTER, new WorldPoint(3152, 3796, 0), WILDERNESS, "East of the Wilderness canoe exit, level 35 Wilderness.", BRASSICAN_OR_WIZARDS);
    static readonly WILDERNESS_37 = new HotColdLocation(MASTER, new WorldPoint(2974, 3814, 0), WILDERNESS, "South-east of the Chaos Temple, level 37 Wilderness.", BRASSICAN_MAGE);
    static readonly WILDERNESS_38 = new HotColdLocation(MASTER, new WorldPoint(3293, 3813, 0), WILDERNESS, "Among the poison spiders south of Callisto's den, level 38 Wilderness.", ANCIENT_WIZARDS);
    static readonly WILDERNESS_49 = new HotColdLocation(MASTER, new WorldPoint(3136, 3914, 0), WILDERNESS, "South-west of the Deserted Keep, level 49 Wilderness.", BRASSICAN_MAGE);
    static readonly WILDERNESS_54 = new HotColdLocation(MASTER, new WorldPoint(2981, 3944, 0), WILDERNESS, "West of the Wilderness Agility Course, level 54 Wilderness.", BRASSICAN_MAGE);
    static readonly ZEAH_BLASTMINE_BANK = new HotColdLocation(MASTER, new WorldPoint(1504, 3859, 0), ZEAH, "Next to the bank in the Lovakengj blast mine.", BRASSICAN_MAGE);
    static readonly ZEAH_BLASTMINE_NORTH = new HotColdLocation(MASTER, new WorldPoint(1488, 3881, 0), ZEAH, "Northern part of the Lovakengj blast mine.", BRASSICAN_MAGE);
    static readonly ZEAH_LOVAKITE_FURNACE = new HotColdLocation(MASTER, new WorldPoint(1507, 3819, 0), ZEAH, "Next to the lovakite furnace in Lovakengj.", BRASSICAN_MAGE);
    static readonly ZEAH_LOVAKENGJ_MINE = new HotColdLocation(MASTER, new WorldPoint(1477, 3778, 0), ZEAH, "Next to mithril rock in the Lovakengj mine.", BRASSICAN_MAGE);
    static readonly ZEAH_SULPHR_MINE = new HotColdLocation(MASTER, new WorldPoint(1428, 3869, 0), ZEAH, "Western entrance in the Lovakengj sulphur mine. Facemask or Slayer Helmet recommended.", BRASSICAN_MAGE);
    static readonly ZEAH_SHAYZIEN_BANK = new HotColdLocation(MASTER, new WorldPoint(1498, 3627, 0), ZEAH, "South-east of the bank in Shayzien Encampment.", BRASSICAN_MAGE);
    static readonly ZEAH_OVERPASS = new HotColdLocation(MASTER, new WorldPoint(1467, 3714, 0), ZEAH, "Overpass between Lovakengj and Shayzien.", BRASSICAN_MAGE);
    static readonly ZEAH_LIZARDMAN = new HotColdLocation(MASTER, new WorldPoint(1490, 3698, 0), ZEAH, "Within Lizardman Canyon, east of the ladder.", ANCIENT_WIZARDS);
    static readonly ZEAH_COMBAT_RING = new HotColdLocation(MASTER, new WorldPoint(1557, 3624, 0), ZEAH, "Shayzien Encampment, south-east of the Combat Ring.", BRASSICAN_MAGE);
    static readonly ZEAH_SHAYZIEN_BANK_2 = new HotColdLocation(MASTER, new WorldPoint(1490, 3602, 0), ZEAH, "North of the bank in Shayzien.", BRASSICAN_MAGE);
    static readonly ZEAH_LIBRARY = new HotColdLocation(MASTER, new WorldPoint(1603, 3843, 0), ZEAH, "North-west of the Arceuus Library.", BRASSICAN_MAGE);
    static readonly ZEAH_HOUSECHURCH = new HotColdLocation(MASTER, new WorldPoint(1681, 3794, 0), ZEAH, "By the entrance to the Arceuus church.", ANCIENT_WIZARDS);
    static readonly ZEAH_DARK_ALTAR = new HotColdLocation(MASTER, new WorldPoint(1698, 3880, 0), ZEAH, "West of the Dark Altar.", BRASSICAN_MAGE);
    static readonly ZEAH_ARCEUUS_HOUSE = new HotColdLocation(MASTER, new WorldPoint(1710, 3700, 0), ZEAH, "By the south-eastern entrance to Arceuus.", BRASSICAN_MAGE);
    static readonly ZEAH_ESSENCE_MINE_NE = new HotColdLocation(MASTER, new WorldPoint(1773, 3867, 0), ZEAH, "North-east of the Arceuus essence mine.", BRASSICAN_MAGE);
    static readonly ZEAH_PISCARILUS_MINE = new HotColdLocation(MASTER, new WorldPoint(1768, 3705, 0), ZEAH, "South of the Piscarilius mine.", ANCIENT_WIZARDS);
    static readonly ZEAH_GOLDEN_FIELD_TAVERN = new HotColdLocation(MASTER, new WorldPoint(1718, 3643, 0), ZEAH, "South of the gravestone in Kingstown.", BRASSICAN_MAGE);
    static readonly ZEAH_MESS_HALL = new HotColdLocation(MASTER, new WorldPoint(1656, 3621, 0), ZEAH, "East of the Mess hall.", BRASSICAN_MAGE);
    static readonly ZEAH_WATSONS_HOUSE = new HotColdLocation(MASTER, new WorldPoint(1653, 3572, 0), ZEAH, "East of Watson's house.", BRASSICAN_MAGE);
    static readonly ZEAH_VANNAHS_FARM_STORE = new HotColdLocation(MASTER, new WorldPoint(1807, 3523, 0), ZEAH, "North of Tithe Farm, next to the pond.", BRASSICAN_MAGE);
    static readonly ZEAH_FARMING_GUILD_W = new HotColdLocation(MASTER, new WorldPoint(1208, 3736, 0), ZEAH, "West of the Farming Guild.", BRASSICAN_MAGE);
    static readonly ZEAH_DAIRY_COW = new HotColdLocation(MASTER, new WorldPoint(1324, 3722, 0), ZEAH, "North-east of the Kebos Lowlands, east of the dairy cow.", BRASSICAN_MAGE);
    static readonly ZEAH_CRIMSON_SWIFTS = new HotColdLocation(MASTER, new WorldPoint(1187, 3580, 0), ZEAH, "South-west of the Kebos Swamp, below the crimson swifts.", BRASSICAN_MAGE);
}
