/*
 * Copyright (c) 2018 Abex
 * All rights reserved.
 * Ported to TypeScript from RuneLite 1.13.6. BSD 2-Clause License, see ./LICENSE.
 */
import { WorldPoint } from "@runelite/api/coords/WorldPoint";
import * as ObjectID from "@runelite/api/gameval/ObjectID";

/** A STASH unit an emote clue can use (RuneLite's STASHUnit): the loc and the tile(s) it stands on. */
export class STASHUnit {
    private readonly worldPoints: WorldPoint[];

    private constructor(
        private readonly objectId: number,
        ...worldPoints: WorldPoint[]
    ) {
        this.worldPoints = worldPoints;
    }

    getObjectId(): number {
        return this.objectId;
    }

    getWorldPoints(): WorldPoint[] {
        return this.worldPoints;
    }

    static readonly NEAR_A_SHED_IN_LUMBRIDGE_SWAMP = new STASHUnit(ObjectID.HH_EASY001, new WorldPoint(3201, 3171, 0));
    static readonly ON_THE_BRIDGE_TO_THE_MISTHALIN_WIZARDS_TOWER = new STASHUnit(ObjectID.HH_EASY002, new WorldPoint(3115, 3194, 0));
    static readonly DRAYNOR_VILLAGE_MARKET = new STASHUnit(ObjectID.HH_EASY003, new WorldPoint(3083, 3254, 0));
    static readonly LIMESTONE_MINE = new STASHUnit(ObjectID.HH_EASY004, new WorldPoint(3373, 3498, 0));
    static readonly OUTSIDE_THE_LEGENDS_GUILD_GATES = new STASHUnit(ObjectID.HH_EASY005, new WorldPoint(2735, 3350, 0));
    static readonly MUDSKIPPER_POINT = new STASHUnit(ObjectID.HH_EASY006, new WorldPoint(2988, 3111, 0));
    static readonly NEAR_THE_ENTRANA_FERRY_IN_PORT_SARIM = new STASHUnit(ObjectID.HH_EASY007, new WorldPoint(3050, 3237, 0));
    static readonly AL_KHARID_SCORPION_MINE = new STASHUnit(ObjectID.HH_EASY008, new WorldPoint(3303, 3289, 0));
    static readonly DRAYNOR_MANOR_BY_THE_FOUNTAIN = new STASHUnit(ObjectID.HH_EASY009, new WorldPoint(3089, 3331, 0));
    static readonly WHEAT_FIELD_NEAR_THE_LUMBRIDGE_WINDMILL = new STASHUnit(ObjectID.HH_EASY010, new WorldPoint(3163, 3297, 0));
    static readonly CROSSROADS_NORTH_OF_DRAYNOR_VILLAGE = new STASHUnit(ObjectID.HH_EASY011, new WorldPoint(3111, 3289, 0));
    static readonly RIMMINGTON_MINE = new STASHUnit(ObjectID.HH_EASY012, new WorldPoint(2976, 3239, 0));
    static readonly VARROCK_PALACE_LIBRARY = new STASHUnit(ObjectID.HH_EASY013, new WorldPoint(3214, 3490, 0));
    static readonly UPSTAIRS_IN_THE_ARDOUGNE_WINDMILL = new STASHUnit(ObjectID.HH_EASY014, new WorldPoint(2635, 3386, 2));
    static readonly OUTSIDE_THE_FALADOR_PARTY_ROOM = new STASHUnit(ObjectID.HH_EASY015, new WorldPoint(3043, 3371, 0));
    static readonly TAVERLEY_STONE_CIRCLE = new STASHUnit(ObjectID.HH_EASY016, new WorldPoint(2924, 3477, 0));
    static readonly CATHERBY_BEEHIVE_FIELD = new STASHUnit(ObjectID.HH_EASY018, new WorldPoint(2764, 3438, 0));
    static readonly NEAR_THE_PARROTS_IN_ARDOUGNE_ZOO = new STASHUnit(ObjectID.HH_EASY019, new WorldPoint(2608, 3284, 0));
    static readonly ROAD_JUNCTION_NORTH_OF_RIMMINGTON = new STASHUnit(ObjectID.HH_EASY020, new WorldPoint(2981, 3278, 0));
    static readonly OUTSIDE_THE_FISHING_GUILD = new STASHUnit(ObjectID.HH_EASY021, new WorldPoint(2608, 3393, 0));
    static readonly OUTSIDE_KEEP_LE_FAYE = new STASHUnit(ObjectID.HH_EASY022, new WorldPoint(2756, 3399, 0));
    static readonly ROAD_JUNCTION_SOUTH_OF_SINCLAIR_MANSION = new STASHUnit(ObjectID.HH_EASY024, new WorldPoint(2735, 3534, 0));
    static readonly OUTSIDE_THE_DIGSITE_EXAM_CENTRE = new STASHUnit(ObjectID.HH_EASY025, new WorldPoint(3353, 3343, 0));
    static readonly NEAR_THE_SAWMILL_OPERATORS_BOOTH = new STASHUnit(ObjectID.HH_EASY026, new WorldPoint(3298, 3490, 0));
    static readonly EMIRS_ARENA_TICKET_OFFICE = new STASHUnit(ObjectID.HH_EASY027, new WorldPoint(3316, 3242, 0));
    static readonly OUTSIDE_VARROCK_PALACE_COURTYARD = new STASHUnit(ObjectID.HH_EASY_EXP1, new WorldPoint(3211, 3456, 0));
    static readonly NEAR_HERQUINS_SHOP_IN_FALADOR = new STASHUnit(ObjectID.HH_EASY_EXP2, new WorldPoint(2941, 3339, 0));
    static readonly SOUTH_OF_THE_GRAND_EXCHANGE = new STASHUnit(ObjectID.HH_EASY_EXP3, new WorldPoint(3159, 3464, 0));
    static readonly AUBURYS_SHOP_IN_VARROCK = new STASHUnit(ObjectID.HH_EASY_EXP4, new WorldPoint(3252, 3404, 0));
    static readonly CENTRE_OF_CANIFIS = new STASHUnit(ObjectID.HH_MEDIUM001, new WorldPoint(3491, 3489, 0));
    static readonly MAUSOLEUM_OFF_THE_MORYTANIA_COAST = new STASHUnit(ObjectID.HH_MEDIUM002, new WorldPoint(3500, 3575, 0));
    static readonly EAST_OF_THE_BARBARIAN_VILLAGE_BRIDGE = new STASHUnit(ObjectID.HH_MEDIUM003, new WorldPoint(3110, 3422, 0));
    static readonly SOUTH_OF_THE_SHRINE_IN_TAI_BWO_WANNAI_VILLAGE = new STASHUnit(ObjectID.HH_MEDIUM004, new WorldPoint(2802, 3081, 0));
    static readonly CASTLE_WARS_BANK = new STASHUnit(ObjectID.HH_MEDIUM005, new WorldPoint(2444, 3093, 0));
    static readonly BARBARIAN_OUTPOST_OBSTACLE_COURSE = new STASHUnit(ObjectID.HH_MEDIUM006, new WorldPoint(2541, 3550, 0));
    static readonly GNOME_STRONGHOLD_BALANCING_ROPE = new STASHUnit(ObjectID.HH_MEDIUM007, new WorldPoint(2473, 3418, 2));
    static readonly OUTSIDE_YANILLE_BANK = new STASHUnit(ObjectID.HH_MEDIUM008, new WorldPoint(2603, 3091, 0));
    static readonly OBSERVATORY = new STASHUnit(ObjectID.HH_MEDIUM009, new WorldPoint(2439, 3166, 0));
    static readonly OGRE_CAGE_IN_KING_LATHAS_TRAINING_CAMP = new STASHUnit(ObjectID.HH_MEDIUM010, new WorldPoint(2533, 3377, 0));
    static readonly DIGSITE = new STASHUnit(ObjectID.HH_MEDIUM011, new WorldPoint(3370, 3420, 0));
    static readonly HICKTONS_ARCHERY_EMPORIUM = new STASHUnit(ObjectID.HH_MEDIUM012, new WorldPoint(2825, 3441, 0));
    static readonly SHANTAY_PASS = new STASHUnit(ObjectID.HH_MEDIUM013, new WorldPoint(3308, 3125, 0));
    static readonly LUMBRIDGE_SWAMP_CAVES = new STASHUnit(ObjectID.HH_MEDIUM_EXP1, new WorldPoint(3222, 9584, 0), new WorldPoint(3167, 9570, 0));
    static readonly OUTSIDE_CATHERBY_BANK = new STASHUnit(ObjectID.HH_MEDIUM_EXP2, new WorldPoint(2807, 3437, 0));
    static readonly OUTSIDE_THE_SEERS_VILLAGE_COURTHOUSE = new STASHUnit(ObjectID.HH_MEDIUM_EXP3, new WorldPoint(2731, 3475, 0));
    static readonly OUTSIDE_HARRYS_FISHING_SHOP_IN_CATHERBY = new STASHUnit(ObjectID.HH_MEDIUM_EXP4, new WorldPoint(2837, 3436, 0));
    static readonly TZHAAR_WEAPONS_STORE = new STASHUnit(ObjectID.HH_MEDIUM_EXP5, new WorldPoint(2479, 5146, 0));
    static readonly NORTH_OF_EVIL_DAVES_HOUSE_IN_EDGEVILLE = new STASHUnit(ObjectID.HH_MEDIUM_EXP6, new WorldPoint(3077, 3503, 0));
    static readonly WEST_OF_THE_SHAYZIEN_COMBAT_RING = new STASHUnit(ObjectID.HH_MEDIUM_EXP7, new WorldPoint(1541, 3631, 0));
    static readonly ENTRANCE_OF_THE_ARCEUUS_LIBRARY = new STASHUnit(ObjectID.HH_MEDIUM_EXP8, new WorldPoint(1642, 3809, 0));
    static readonly OUTSIDE_DRAYNOR_VILLAGE_JAIL = new STASHUnit(ObjectID.HH_MEDIUM_EXP9, new WorldPoint(3130, 3250, 0));
    static readonly EAST_OF_THE_LEVEL_19_WILDERNESS_OBELISK = new STASHUnit(ObjectID.HH_HARD001, new WorldPoint(3243, 3662, 0));
    static readonly FISHING_GUILD_BANK = new STASHUnit(ObjectID.HH_HARD002, new WorldPoint(2593, 3409, 0));
    static readonly TOP_FLOOR_OF_THE_LIGHTHOUSE = new STASHUnit(ObjectID.HH_HARD003, new WorldPoint(2512, 3640, 2));
    static readonly OUTSIDE_THE_GREAT_PYRAMID_OF_SOPHANEM = new STASHUnit(ObjectID.HH_HARD005, new WorldPoint(3291, 2780, 0));
    static readonly NOTERAZZOS_SHOP_IN_THE_WILDERNESS = new STASHUnit(ObjectID.HH_HARD006, new WorldPoint(3027, 3699, 0));
    static readonly WEST_SIDE_OF_THE_KARAMJA_BANANA_PLANTATION = new STASHUnit(ObjectID.HH_HARD007, new WorldPoint(2909, 3169, 0));
    static readonly MOUNTAIN_CAMP_GOAT_ENCLOSURE = new STASHUnit(ObjectID.HH_HARD008, new WorldPoint(2810, 3677, 0));
    static readonly GNOME_GLIDER_ON_WHITE_WOLF_MOUNTAIN = new STASHUnit(ObjectID.HH_HARD009, new WorldPoint(2849, 3496, 0));
    static readonly SHILO_VILLAGE_BANK = new STASHUnit(ObjectID.HH_HARD010, new WorldPoint(2853, 2952, 0));
    static readonly INSIDE_THE_DIGSITE_EXAM_CENTRE = new STASHUnit(ObjectID.HH_HARD_EXP1, new WorldPoint(3356, 3333, 0));
    static readonly NORTHEAST_CORNER_OF_THE_KHARAZI_JUNGLE = new STASHUnit(ObjectID.HH_HARD_EXP2, new WorldPoint(2952, 2932, 0));
    static readonly VOLCANO_IN_THE_NORTHEASTERN_WILDERNESS = new STASHUnit(ObjectID.HH_HARD_EXP3, new WorldPoint(3368, 3930, 0));
    static readonly IN_THE_MIDDLE_OF_JIGGIG = new STASHUnit(ObjectID.HH_HARD_EXP4, new WorldPoint(2478, 3048, 0));
    static readonly AGILITY_PYRAMID = new STASHUnit(ObjectID.HH_HARD_EXP5, new WorldPoint(3357, 2830, 0));
    static readonly HOSIDIUS_MESS = new STASHUnit(ObjectID.HH_HARD_EXP6, new WorldPoint(1646, 3632, 0));
    static readonly CHAPEL_IN_WEST_ARDOUGNE = new STASHUnit(ObjectID.HH_ELITE_EXP1, new WorldPoint(2527, 3294, 0));
    static readonly NEAR_A_RUNITE_ROCK_IN_THE_FREMENNIK_ISLES = new STASHUnit(ObjectID.HH_ELITE_EXP2, new WorldPoint(2374, 3847, 0));
    static readonly NEAR_A_LADDER_IN_THE_WILDERNESS_LAVA_MAZE = new STASHUnit(ObjectID.HH_ELITE_EXP3, new WorldPoint(3069, 3862, 0));
    static readonly ENTRANCE_OF_THE_CAVE_OF_DAMIS = new STASHUnit(ObjectID.HH_ELITE_EXP4, new WorldPoint(2629, 5070, 0));
    static readonly WARRIORS_GUILD_BANK = new STASHUnit(ObjectID.HH_ELITE_EXP5, new WorldPoint(2844, 3537, 0));
    static readonly SOUTHEAST_CORNER_OF_THE_MONASTERY = new STASHUnit(ObjectID.HH_ELITE_EXP6, new WorldPoint(3056, 3482, 0));
    static readonly SOUTHEAST_CORNER_OF_THE_FISHING_PLATFORM = new STASHUnit(ObjectID.HH_ELITE_EXP7, new WorldPoint(2787, 3277, 0));
    static readonly OUTSIDE_THE_SLAYER_TOWER_GARGOYLE_ROOM = new STASHUnit(ObjectID.HH_ELITE_EXP8, new WorldPoint(3423, 3534, 2));
    static readonly ON_TOP_OF_TROLLHEIM_MOUNTAIN = new STASHUnit(ObjectID.HH_ELITE_EXP9, new WorldPoint(2886, 3676, 0));
    static readonly FOUNTAIN_OF_HEROES = new STASHUnit(ObjectID.HH_ELITE_EXP10, new WorldPoint(2916, 9891, 0));
    static readonly ENTRANCE_OF_THE_CAVERN_UNDER_THE_WHIRLPOOL = new STASHUnit(ObjectID.HH_ELITE_EXP11, new WorldPoint(1764, 5367, 1), new WorldPoint(1636, 5367, 1));
    static readonly HALFWAY_DOWN_TROLLWEISS_MOUNTAIN = new STASHUnit(ObjectID.HH_ELITE_EXP12, new WorldPoint(2782, 3787, 0));
    static readonly SHAYZIEN_WAR_TENT = new STASHUnit(ObjectID.HH_ELITE_EXP13, new WorldPoint(1488, 3637, 0));
    static readonly OUTSIDE_THE_LEGENDS_GUILD_DOOR = new STASHUnit(ObjectID.HH_ELITE_EXP14, new WorldPoint(2727, 3371, 0));
    static readonly NEAR_THE_GEM_STALL_IN_ARDOUGNE_MARKET = new STASHUnit(ObjectID.HH_ELITE_EXP15, new WorldPoint(2672, 3302, 0));
    static readonly OUTSIDE_THE_BAR_BY_THE_FIGHT_ARENA = new STASHUnit(ObjectID.HH_ELITE_EXP16, new WorldPoint(2571, 3150, 0));
    static readonly SOUTHEAST_CORNER_OF_LAVA_DRAGON_ISLE = new STASHUnit(ObjectID.HH_MASTER001, new WorldPoint(3228, 3830, 0));
    static readonly NEAR_THE_PIER_IN_ZULANDRA = new STASHUnit(ObjectID.HH_MASTER002, new WorldPoint(2203, 3059, 0));
    static readonly BARROWS_CHEST = new STASHUnit(ObjectID.HH_MASTER003, new WorldPoint(3547, 9690, 0));
    static readonly WELL_OF_VOYAGE = new STASHUnit(ObjectID.HH_MASTER004, new WorldPoint(2006, 4709, 1));
    static readonly NORTHERN_WALL_OF_CASTLE_DRAKAN = new STASHUnit(ObjectID.HH_MASTER005, new WorldPoint(3563, 3379, 0));
    static readonly _7TH_CHAMBER_OF_JALSAVRAH = new STASHUnit(ObjectID.HH_MASTER006, new WorldPoint(1951, 4431, 0));
    static readonly SOUL_ALTAR = new STASHUnit(ObjectID.HH_MASTER007, new WorldPoint(1810, 3855, 0));
    static readonly WARRIORS_GUILD_BANK_29047 = new STASHUnit(ObjectID.HH_MASTER008, new WorldPoint(2845, 3545, 0));
    static readonly ENTRANA_CHAPEL = new STASHUnit(ObjectID.HH_MASTER009, new WorldPoint(2851, 3355, 0));
    static readonly TZHAAR_GEM_STORE = new STASHUnit(ObjectID.HH_MASTER010, new WorldPoint(2466, 5150, 0));
    static readonly TENT_IN_LORD_IORWERTHS_ENCAMPMENT = new STASHUnit(ObjectID.HH_MASTER011, new WorldPoint(2198, 3257, 0));
    static readonly OUTSIDE_MUDKNUCKLES_HUT = new STASHUnit(ObjectID.HH_MASTER012, new WorldPoint(2959, 3502, 0));
    static readonly CENTRE_OF_THE_CATACOMBS_OF_KOUREND = new STASHUnit(ObjectID.HH_MASTER013, new WorldPoint(1661, 10045, 0));
    static readonly KING_BLACK_DRAGONS_LAIR = new STASHUnit(ObjectID.HH_MASTER014, new WorldPoint(2286, 4680, 0));
    static readonly OUTSIDE_KRIL_TSUTSAROTHS_ROOM = new STASHUnit(ObjectID.HH_MASTER015, new WorldPoint(2931, 5337, 2));
    static readonly BY_THE_BEAR_CAGE_IN_VARROCK_PALACE_GARDENS = new STASHUnit(ObjectID.HH_MASTER016, new WorldPoint(3232, 3494, 0));
    static readonly OUTSIDE_THE_WILDERNESS_AXE_HUT = new STASHUnit(ObjectID.HH_MASTER017, new WorldPoint(3186, 3958, 0));
    static readonly TOP_FLOOR_OF_THE_YANILLE_WATCHTOWER = new STASHUnit(ObjectID.HH_MASTER018, new WorldPoint(2930, 4718, 2));
    static readonly DEATH_ALTAR = new STASHUnit(ObjectID.HH_MASTER019, new WorldPoint(2210, 4842, 0));
    static readonly BEHIND_MISS_SCHISM_IN_DRAYNOR_VILLAGE = new STASHUnit(ObjectID.HH_MASTER020, new WorldPoint(3095, 3254, 0));
    static readonly NORTHWESTERN_CORNER_OF_THE_ENCHANTED_VALLEY = new STASHUnit(ObjectID.HH_MASTER021, new WorldPoint(3022, 4517, 0));
    static readonly NORTH_OF_MOUNT_KARUULM = new STASHUnit(ObjectID.HH_MEDIUM_EXP10, new WorldPoint(1308, 3840, 0));
    static readonly GYPSY_TENT_ENTRANCE = new STASHUnit(ObjectID.HH_BEGINNER001, new WorldPoint(3206, 3422, 0));
    static readonly FINE_CLOTHES_ENTRANCE = new STASHUnit(ObjectID.HH_BEGINNER002, new WorldPoint(3209, 3416, 0));
    static readonly BOB_AXES_ENTRANCE = new STASHUnit(ObjectID.HH_BEGINNER003, new WorldPoint(3233, 3200, 0));
    static readonly CRYSTALLINE_MAPLE_TREES = new STASHUnit(ObjectID.HH_MASTER022, new WorldPoint(2213, 3427, 0));
    static readonly CHARCOAL_BURNERS = new STASHUnit(ObjectID.HH_ELITE_EXP17, new WorldPoint(1712, 3470, 0));
    static readonly FORTIS_GRAND_MUSEUM = new STASHUnit(ObjectID.HH_EASY_VM01, new WorldPoint(1723, 3153, 0));
    static readonly TEMPLE_SOUTHEAST_OF_THE_BAZAAR = new STASHUnit(ObjectID.HH_ELITE_VM01, new WorldPoint(1702, 3079, 0));
    static readonly CAM_TORUM_ENTRANCE = new STASHUnit(ObjectID.HH_MASTER_VM01, new WorldPoint(1428, 3118, 0));
    static readonly WESTERN_SALVAGER_OVERLOOK = new STASHUnit(ObjectID.HH_MASTER_VM02, new WorldPoint(1614, 3296, 0));
    static readonly TWILIGHT_TEMPLE_MINE = new STASHUnit(ObjectID.HH_MEDIUM_EXP11, new WorldPoint(1668, 3287, 0));
    static readonly ORTUS_MEETS_PROUDSPIRE = new STASHUnit(ObjectID.HH_MEDIUM_EXP12, new WorldPoint(1629, 3239, 0));
    static readonly OUTSIDE_TWILIGHT_TEMPLE = new STASHUnit(ObjectID.HH_HARD_EXP7, new WorldPoint(1693, 3243, 0));
    static readonly PANDEMONIUM_BAR = new STASHUnit(ObjectID.HH_EASY_SAIL, new WorldPoint(3045, 2963, 0));
    static readonly WINTUMBER_ISLAND = new STASHUnit(ObjectID.HH_ELITE_SAIL, new WorldPoint(2072, 2608, 0));
    static readonly BRITTLE_ISLE = new STASHUnit(ObjectID.HH_MASTER_SAIL, new WorldPoint(1952, 4074, 0));
}
