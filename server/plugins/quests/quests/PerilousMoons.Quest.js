/**
 * Perilous Moons (members).
 *
 * The words come from the "Perilous Moons" transcript page (OSRS Wiki); the six
 * quest NPCs also keep their own pages' standard/post-quest variants, which the
 * shared NpcDialogues index falls back to wherever the stage selector returns
 * nothing. This plugin supplies the variant selector for Attala, Zuma, Jessamine,
 * Nahta, the Cam Torum blacksmith and Eyatlalli, the prose-condition answers, the
 * missing Buildings Supplies crate, the Neypotzli entrances, the camp building,
 * the talisman enchant/infuse hand-ins, the ritual item gathering, the infused
 * talisman "Locate" step and the three Moons of Peril boss spawns.
 *
 * Stage varbit: 9819 "pmoon_quest" (varp 4144, bits 0-5), found with
 * scripts/lookup-gameval.ts and confirmed by RuneLite's QuestVarbits
 * (QUEST_PERILOUS_MOONS -> VarbitID.PMOON_QUEST, 9819) and Quest Helper's
 * PerilousMoon step map. The quest requires 48 Slayer, 20 Hunter, 20 Fishing,
 * 20 Runecraft, 10 Construction and Twilight's Promise (checked at the start).
 *
 * Stages (varbit 9819; the even checkpoints are Quest Helper's step keys):
 *   0 not started, 2 accepted (kill the sulphur nagua), 4 nagua dealt with,
 *   5 city access granted, 6 inside Cam Torum (talk to Jessamine), 7 enter
 *   Neypotzli, 8 talk to the trio, 10 all three camps built, 12 camps reported,
 *   13/14 inscription choices, 15 receive the earth/water talismans, 16 Nahta
 *   enchants them, 17 the blacksmith infuses them, 18 return to Neypotzli,
 *   19 Eyatlalli found, 20/21/22 her meeting lines, 23 gather scales/tail/paste,
 *   24/25/26 place them, 27 the ritual starts (fight the Moons), 28/29 fighting
 *   the Moons, 30 all three defeated (talk to Jessamine and Zuma), 31 finishing
 *   line, 36 complete (captured 31 -> 36).
 *
 * Sibling varbits driven here: 9820-9822 pmoon_camp_1..3 (one per camp),
 * 9823 pmoon_murals_inspected (bitmask: 1=Attala, 2=Zuma), 9858-9860
 * pmoon_boss_blood/blue/eclipse_dead (varp 4157), 9871 pmoon_lizard_trap_set_1,
 * 16624 pmoon_eyatlalli_vis.
 *
 * Stages 13/14 and 20-22/24-26 are the intermediate values the live server
 * wrote during those conversations (capture 1693); they gate no new content.
 *
 * Rewards per the OSRS Wiki: 2 Quest points, 40,000 Slayer, 5,000 Runecraft,
 * 5,000 Hunter and 5,000 Fishing XP, access to Neypotzli and the Moons of Peril
 * and lesser nagua Slayer tasks.
 *
 * Sources: OSRS Wiki "Perilous Moons", its Quick guide, Transcript and Journal
 * transcript; RuneLite Quest Helper for stage checkpoints, NPC/object gamevals
 * and walkthrough tiles (not behaviour); the cache for every id, placement and
 * option.
 *
 * Gaps / approximations:
 *  - The world map has the camps already built (stove 51362 at the camp spots)
 *    and no Building Supplies crate near Jessamine, so the crate (50857) is
 *    registered at (1436,9637,1) and camps are built by using building supplies
 *    on the Cooking stove at each camp tile rather than on a "Camp spot".
 *  - Entrance landing tiles are chosen from open collision tiles near the real
 *    portals; the boss rooms' entrances land in front of each Moon's statue.
 *  - The Eclipse meeting uses the captured camera track and ends on the recorded
 *    28->29 stage boundary; Eyatlalli's meeting/ritual lines send the captured
 *    camera shakes, and entering Neypotzli uses the captured fade/camera pull.
 *  - The Moons themselves are the MoonsOfPeril plugin's (bosses/MoonsOfPeril):
 *    during the fight stages it lets the player through the statues
 *    ("moons-of-peril:can-enter"), each kill ("moons-of-peril:killed")
 *    counts here and plays the defeat transcript, and from the ritual on it
 *    runs the camps ("moons-of-peril:camps-open").
 *  - The talisman "Locate" step only acts within four tiles of the captured
 *    streambound summon point (1483,9692,0); elsewhere it repeats Attala's line.
 *    The live north/south and east/west pull messages are not in the transcript
 *    dump and are not authored.
 *  - The long-winding tunnels at 51377 (1527,9670) -> (1513,9596) and
 *    (1512,9560) -> (1355,9538) use the captured fade and message; the 1493,9579
 *    gate is a walk-through opening, not a tunnel, and stays unteleported.
 *  - Gathering is single-step: one "Trap" click per rock (two needed), Grubby
 *    sapling, river fishing spot (62193, unnamed in the cache) and the knife
 *    recipes give the ritual items with short system messages the dump does not
 *    contain. The trap varbit 9871 is only sent, not read, for the pair state.
 *  - "Attempt to speak to any of the three" after locating Eyatlalli always plays
 *    the full after-meeting conversation (no already-appeared sub-variant).
 *  - The finishing route follows Quest Helper: Jessamine and Zuma, then
 *    Eyatlalli completes the quest. Attala's finishing line is optional.
 */
module.exports = function registerPerilousMoonsQuest(api) {
  const {
    GameObject,
    Item,
    ItemIdentifiers,
    Location,
    NpcIdentifiers,
    ObjectIdentifiers,
    ObjectManager,
    Skill,
  } = api.core;
  const { registerQuest, refreshQuestList, startTranscript } = require("../QuestRuntime");
  const { createQuestScenes } = require("../QuestScenes");
  const Scenes = createQuestScenes(api, {});

  const PAGE = "Perilous Moons";
  const START_HOOK = "quest:perilous-moons:start";

  // ==========================================================================
  // Ids
  // ==========================================================================

  // Stage varbit (lookup-gameval.ts varbit pmoon_quest).
  const PMOON_QUEST_VARBIT = 9819; // pmoon_quest, varp 4144 bits 0-5
  const PMOON_VARP = 4144;
  const CAMP_VARBITS = [9820, 9821, 9822]; // pmoon_camp_1..3
  const MURALS_VARBIT = 9823; // pmoon_murals_inspected, bitmask (1=Attala, 2=Zuma)
  const EYATLALLI_VIS_VARBIT = 16624; // client-side visibility of Eyatlalli
  const LIZARD_TRAP_VARBIT = 9871; // pmoon_lizard_trap_set_1
  const BOSS_DEAD_VARBITS = { blood: 9858, blue: 9859, eclipse: 9860 }; // varp 4157

  // NPCs (NpcIdentifiers).
  const ATTALA_NPC_ID = NpcIdentifiers.ATTALA; // 12861, quest copies
  const ATTALA_CITY_NPC_ID = NpcIdentifiers.ATTALA_2; // 13099, the city spawn
  const ATTALA_NPC_IDS = new Set([ATTALA_NPC_ID, ATTALA_CITY_NPC_ID]);
  const ZUMA_SURFACE_RAW_NPC_ID = 13363; // surface base; cache publishes Zuma (12860)
  const ZUMA_NEY_RAW_NPC_ID = 13365; // Neypotzli base; cache publishes Zuma (12860)
  const ZUMA_NPC_ID = NpcIdentifiers.ZUMA_2; // 12860, the actual Zuma content id
  const ZUMA_NPC_IDS = new Set([ZUMA_NPC_ID, NpcIdentifiers.ZUMA_3]); // 13347 kept for legacy routes
  const JESSAMINE_NPC_ID = NpcIdentifiers.JESSAMINE; // 12862, Neypotzli spawn
  const JESSAMINE_CITY_NPC_ID = NpcIdentifiers.JESSAMINE_2; // 12865, quest copy
  const JESSAMINE_NPC_IDS = new Set([JESSAMINE_NPC_ID, JESSAMINE_CITY_NPC_ID]);
  const EYATLALLI_NPC_ID = NpcIdentifiers.EYATLALLI; // 12869
  const EYATLALLI_NPC_IDS = new Set([EYATLALLI_NPC_ID, NpcIdentifiers.EYATLALLI_2]);
  const NAHTA_NPC_ID = NpcIdentifiers.NAHTA; // 13036, static magic shop spawn
  const BLACKSMITH_NPC_ID = NpcIdentifiers.BLACKSMITH_2; // 13038, static forge spawn
  const SULPHUR_NAGUA_NPC_ID = NpcIdentifiers.SULPHUR_NAGUA; // 12879, combat 98

  // Objects (ObjectIdentifiers; 62193 is unnamed in the identifier file).
  const CAMP_SUPPLIES_OBJECT_ID = ObjectIdentifiers.BUILDING_SUPPLIES_3; // 50857
  const CAMP_STOVE_OBJECT_ID = ObjectIdentifiers.COOKING_STOVE; // 51362
  const SUPPLY_CRATES_OBJECT_ID = ObjectIdentifiers.SUPPLY_CRATES; // 51371
  const GRUBBY_SAPLING_OBJECT_ID = ObjectIdentifiers.GRUBBY_SAPLING; // 51365
  const LIZARD_BUSH_OBJECT_ID = ObjectIdentifiers.BUSH_63; // 51358
  const LIZARD_ROCK_OBJECT_ID = ObjectIdentifiers.ROCK_167; // 51359
  const NEYPOTZLI_FISHING_SPOT_OBJECT_ID = 62193; // river_fishing_spot, op Fish
  const ENTRANCE_2X2_OBJECT_ID = ObjectIdentifiers.ENTRANCE_15; // 51375
  const ENTRANCE_DIAGONAL_OBJECT_ID = ObjectIdentifiers.ENTRANCE_16; // 51376
  const ENTRANCE_3X3_OBJECT_ID = ObjectIdentifiers.ENTRANCE_17; // 51377
  const ENTRANCE_CAVE_OBJECT_ID = ObjectIdentifiers.ENTRANCE_18; // 51378
  const ENTRANCE_OBJECT_IDS = new Set([
    ENTRANCE_2X2_OBJECT_ID,
    ENTRANCE_DIAGONAL_OBJECT_ID,
    ENTRANCE_3X3_OBJECT_ID,
    ENTRANCE_CAVE_OBJECT_ID,
  ]);

  // Items (ItemIdentifiers).
  const WATER_TALISMAN_ITEM_ID = ItemIdentifiers.WATER_TALISMAN; // 1444
  const EARTH_TALISMAN_ITEM_ID = ItemIdentifiers.EARTH_TALISMAN; // 1440
  const ENCHANTED_WATER_TALISMAN_ITEM_ID = ItemIdentifiers.ENCHANTED_WATER_TALISMAN; // 28964
  const ENCHANTED_EARTH_TALISMAN_ITEM_ID = ItemIdentifiers.ENCHANTED_EARTH_TALISMAN; // 28965
  const INFUSED_WATER_TALISMAN_ITEM_ID = ItemIdentifiers.INFUSED_WATER_TALISMAN; // 28966
  const INFUSED_EARTH_TALISMAN_ITEM_ID = ItemIdentifiers.INFUSED_EARTH_TALISMAN; // 28967
  const BUILDING_SUPPLIES_ITEM_ID = ItemIdentifiers.BUILDING_SUPPLIES; // 28968
  const MOSS_LIZARD_TAIL_ITEM_ID = ItemIdentifiers.MOSS_LIZARD_TAIL; // 28969
  const BREAM_SCALES_ITEM_ID = ItemIdentifiers.BREAM_SCALES; // 28970
  const MOONLIGHT_GRUB_ITEM_ID = ItemIdentifiers.MOONLIGHT_GRUB; // 29078
  const MOONLIGHT_GRUB_PASTE_ITEM_ID = ItemIdentifiers.MOONLIGHT_GRUB_PASTE; // 29079
  const RAW_MOSS_LIZARD_ITEM_ID = ItemIdentifiers.RAW_MOSS_LIZARD; // 29076
  const RAW_BREAM_ITEM_ID = ItemIdentifiers.RAW_BREAM; // 29216
  const KNIFE_ITEM_ID = ItemIdentifiers.KNIFE; // 946
  const ROPE_ITEM_ID = ItemIdentifiers.ROPE; // 954
  const PESTLE_AND_MORTAR_ITEM_ID = ItemIdentifiers.PESTLE_AND_MORTAR; // 233
  const BIG_FISHING_NET_ITEM_ID = ItemIdentifiers.BIG_FISHING_NET; // 305
  const HAMMER_ITEM_ID = ItemIdentifiers.HAMMER; // 2347
  const SAW_ITEM_ID = ItemIdentifiers.SAW; // 8794
  const BASE_TALISMAN_ITEM_IDS = new Set([WATER_TALISMAN_ITEM_ID, EARTH_TALISMAN_ITEM_ID]);
  const ENCHANTED_TALISMAN_ITEM_IDS = new Set([
    ENCHANTED_WATER_TALISMAN_ITEM_ID,
    ENCHANTED_EARTH_TALISMAN_ITEM_ID,
  ]);
  const INFUSED_TALISMAN_ITEM_IDS = new Set([
    INFUSED_WATER_TALISMAN_ITEM_ID,
    INFUSED_EARTH_TALISMAN_ITEM_ID,
  ]);

  // Stages.
  const STAGE_STARTED = 2;
  const STAGE_NAGUA_KILLED = 4;
  const STAGE_CITY_OPEN = 5;
  const STAGE_IN_CITY = 6;
  const STAGE_IN_NEY = 7;
  const STAGE_TRIO = 8;
  const STAGE_CAMPS = 10;
  const STAGE_CAMPS_DONE = 12;
  const STAGE_TALISMANS = 15;
  const STAGE_ENCHANTED = 16;
  const STAGE_INFUSED = 17;
  const STAGE_LOCATE = 18;
  const STAGE_EYAT_FOUND = 19;
  const STAGE_GATHER = 23;
  const STAGE_RITUAL = 27;
  const STAGE_MOONS = 28;
  const STAGE_MOONS_DONE = 30;
  const STAGE_FINISHED = 31;
  const STAGE_COMPLETE = 36;

  const MURAL_BIT_ATTALA = 1;
  const MURAL_BIT_ZUMA = 2;

  const MOON_BLOOD_BIT = 1;
  const MOON_ECLIPSE_BIT = 2;
  const MOON_BLUE_BIT = 4;
  const ALL_MOONS_MASK = MOON_BLOOD_BIT | MOON_ECLIPSE_BIT | MOON_BLUE_BIT;

  const TRIO_BIT_ATTALA = 1;
  const TRIO_BIT_JESSAMINE = 2;
  const TRIO_BIT_ZUMA = 4;
  const ALL_TRIO_MASK = TRIO_BIT_ATTALA | TRIO_BIT_JESSAMINE | TRIO_BIT_ZUMA;
  // Quest Helper finishes with Jessamine and Zuma, then Eyatlalli; Attala's
  // optional conversation is not a completion gate.
  const FINISH_TRIO_MASK = TRIO_BIT_JESSAMINE | TRIO_BIT_ZUMA;

  // Attributes (kebab-case, namespaced; declared once).
  const CAMPS_ATTRIBUTE = "perilous-moons:camps";
  const MURALS_ATTRIBUTE = "perilous-moons:murals";
  const MOONS_ATTRIBUTE = "perilous-moons:moons";
  const TRIO_ATTRIBUTE = "perilous-moons:trio-talked";
  const TRAPS_ATTRIBUTE = "perilous-moons:traps-set";
  const ECLIPSE_SEEN_ATTRIBUTE = "perilous-moons:eclipse-cutscene";
  // 0 = legacy save, 2 = this build. Old completed saves used stage 31; newer
  // saves reserve 31 for the finishing line and complete at 36.
  const STAGE_SCHEMA_ATTRIBUTE = "perilous-moons:stage-schema";
  const STAGE_SCHEMA_VERSION = 2;

  // Tiles.
  const SURFACE_ATTALA_TILE = { x: 1435, y: 3124, z: 0 };
  const SURFACE_ZUMA_TILE = { x: 1437, y: 3124, z: 0 };
  const CITY_JESSAMINE_TILE = { x: 1441, y: 9596, z: 1 };
  const NEY_ATTALA_TILE = { x: 1433, y: 9632, z: 1 };
  const NEY_ZUMA_TILE = { x: 1447, y: 9632, z: 1 };
  const EYATLALLI_TILE = { x: 1445, y: 9639, z: 1 };
  const NAGUA_TILE = { x: 1453, y: 3129, z: 0 };
  // Captured 1693: the talismans pull at the streambound camp and Eyatlalli
  // appears at 1483,9692; this is not the Lunar Chest shrine tile.
  const LOCATE_TILE = { x: 1483, y: 9692, z: 0 };
  const LOCATE_RADIUS = 4;
  const SURFACE_LANDING = { x: 1435, y: 3128, z: 0 };
  const CAM_TORUM_LANDING = { x: 1439, y: 9509, z: 1 };
  const CAM_TORUM_EXIT = { x: 1439, y: 9599, z: 1 };
  const NEYPOTZLI_LANDING = { x: 1440, y: 9615, z: 1 };
  const PRISON_LANDING = { x: 1388, y: 9575, z: 0 };
  const EARTHBOUND_LANDING = { x: 1403, y: 9717, z: 0 };
  const STREAMBOUND_LANDING = { x: 1481, y: 9669, z: 0 };
  const CAVE_TO_ANTECHAMBER_LANDING = { x: 1522, y: 9719, z: 0 };
  const CAVE_TO_EARTHBOUND_LANDING = { x: 1522, y: 9719, z: 0 };
  // Captured arena-side landings (the old values were outside the arenas).
  const BLUE_ROOM_LANDING = { x: 1441, y: 9676, z: 0 };
  const BLOOD_ROOM_LANDING = { x: 1418, y: 9632, z: 0 };
  const ECLIPSE_ROOM_LANDING = { x: 1461, y: 9632, z: 0 };
  const CAVE_EXIT_LANDING = { x: 1440, y: 9615, z: 1 };

  // The three camp spots and their varbits (lookup-gameval pmoon_camp_1..3).
  const CAMP_SITES = [
    { name: "Ancient Prison", x: 1349, y: 9580, z: 0, varbit: CAMP_VARBITS[0], bit: 1 },
    { name: "Earthbound Cavern", x: 1374, y: 9710, z: 0, varbit: CAMP_VARBITS[1], bit: 2 },
    { name: "Streambound Cavern", x: 1510, y: 9693, z: 0, varbit: CAMP_VARBITS[2], bit: 4 },
  ];

  // The actual Eclipse Moon arena, from the canonical MoonsOfPeril data. The 1461,9632 tunnel
  // landing and the 1467,9631 statue are outside it, so the intro starts only after the portal
  // lands the player in the arena.
  const [ECLIPSE_MIN_X, ECLIPSE_MAX_X, ECLIPSE_MIN_Y, ECLIPSE_MAX_Y] = require("../../bosses/data/moons-of-peril.json").moons.eclipse.area;
  const ECLIPSE_MOON_ZONE = { minX: ECLIPSE_MIN_X, minY: ECLIPSE_MIN_Y, maxX: ECLIPSE_MAX_X, maxY: ECLIPSE_MAX_Y, levels: [0] };

  // ==========================================================================
  // Transcript variants ("Perilous Moons" page)
  // ==========================================================================

  const V_PASS_GATE = "ruins-in-cam-torum-attempting-to-pass-through-the-entrance";
  const V_START = "ruins-in-cam-torum-talking-to-zuma-or-attala";
  const V_START_AGAIN = "ruins-in-cam-torum-talking-to-zuma-or-attala-talking-to-either-again";
  const V_KILLED_NAGUA = "ruins-in-cam-torum-killing-the-sulphur-nagua";
  const V_RETURN_ATTALA = "ruins-in-cam-torum-returning-to-attala";
  const V_CAM_ATTALA = "ruins-in-cam-torum-talking-to-attala";
  const V_CAM_ZUMA = "ruins-in-cam-torum-talking-to-zuma";
  const V_CAM_JESS = "ruins-in-cam-torum-talking-to-jessamine";
  const V_CAM_JESS_AGAIN = "ruins-in-cam-torum-talking-to-jessamine-again-before-entering-the-ruins";
  const V_RUINS_GUARD = "ruins-in-cam-torum-attempting-to-enter-the-ruins-before-talking-to-jessamine";
  const V_TRIO_ATTALA = "remnants-of-the-old-ones-talking-to-attala";
  const V_TRIO_ZUMA_BEFORE = "remnants-of-the-old-ones-talking-to-zuma-before-talking-to-attala";
  const V_TRIO_ZUMA = "remnants-of-the-old-ones-talking-to-zuma";
  const V_TRIO_JESS_BEFORE = "remnants-of-the-old-ones-talking-to-jessamine-before-talking-to-attala-and-zuma";
  const V_TRIO_JESS = "remnants-of-the-old-ones-talking-to-jessamine";
  const V_CAMPS_REMIND_JESS = "remnants-of-the-old-ones-talking-to-jessamine-talking-to-jessamine-again";
  const V_CAMPS_REMIND_AZ = "remnants-of-the-old-ones-talking-to-jessamine-talking-to-either-attala-or-zuma-again";
  const V_CAMPS_DONE = "remnants-of-the-old-ones-talking-to-jessamine-after-setting-up-all-three-camps";
  const V_TAKE_SUPPLIES = "remnants-of-the-old-ones-taking-building-supplies";
  const V_GUARD_NO_TALK = "remnants-of-the-old-ones-attempting-to-enter-any-entrance-before-speaking-to-anyone";
  const V_GUARD_NO_SUPPLIES = "remnants-of-the-old-ones-attempting-to-enter-an-entrance-without-the-building-supplies";
  const V_GUARD_BOSS_BEFORE = "remnants-of-the-old-ones-attempting-to-enter-a-boss-entrance";
  const V_GUARD_GATHER = "remnants-of-the-old-ones-trapping-rocks-collecting-from-grubby-saplings-fishing-or-rustling-bushes-before-building-the-camps";
  const V_GUARD_BOSS_MID = "the-moons-of-peril-attempting-to-enter-the-boss-chambers";
  const V_ATTALA_BEFORE_TALISMANS = "remnants-of-the-old-ones-talking-to-attala-before-finishing-the-talismans";
  const V_JESS_BEFORE_TALISMANS = "remnants-of-the-old-ones-talking-to-jessamine-before-finishing-the-talismans";
  const V_ZUMA_BEFORE_TALISMANS = "remnants-of-the-old-ones-talking-to-zuma-before-finishing-the-talismans";
  const V_ATTALA_ENCHANTED = "remnants-of-the-old-ones-talking-to-attala-after-getting-the-enchanted-talismans";
  const V_JESS_ENCHANTED = "remnants-of-the-old-ones-talking-to-jessamine-after-enchanting-the-talismans";
  const V_ZUMA_ENCHANTED = "remnants-of-the-old-ones-talking-to-zuma-after-enchanting-the-talismans";
  const V_NAHTA = "remnants-of-the-old-ones-talking-to-nahta";
  const V_NAHTA_ITEM = "remnants-of-the-old-ones-using-a-water-or-earth-talisman-on-nahta";
  const V_NAHTA_ITEM_AGAIN = "remnants-of-the-old-ones-using-a-water-or-earth-talisman-on-nahta-talking-to-nahta-again";
  const V_NAHTA_RECLAIM = "remnants-of-the-old-ones-using-a-water-or-earth-talisman-on-nahta-reclaming-enchanted-talismans";
  const V_BLACKSMITH = "remnants-of-the-old-ones-talking-to-the-blacksmith";
  const V_BLACKSMITH_ITEM = "remnants-of-the-old-ones-using-an-enchanted-talisman-on-the-blacksmith";
  const V_BLACKSMITH_ITEM_AGAIN = "remnants-of-the-old-ones-using-an-enchanted-talisman-on-the-blacksmith-talking-to-the-blacksmith-again";
  const V_BLACKSMITH_RECLAIM = "remnants-of-the-old-ones-using-an-enchanted-talisman-on-the-blacksmith-reclaming-infused-talismans";
  const V_ATTALA_INFUSED = "remnants-of-the-old-ones-talking-to-attala-after-infusing-the-talismans";
  const V_ATTALA_INFUSED_AGAIN = "remnants-of-the-old-ones-talking-to-attala-after-infusing-the-talismans-talking-to-attala-again";
  const V_JESS_AFTER_ATTALA = "remnants-of-the-old-ones-talking-to-jessamine-after-talking-to-attala-about-the-infused-talismans";
  const V_ZUMA_AFTER_ATTALA = "remnants-of-the-old-ones-talking-to-zuma-after-talking-to-attala-about-the-infused-talismans";
  const V_LOCATE = "remnants-of-the-old-ones-locating-the-talismans-at-the-correct-position";
  const V_MEET_EYAT = "remnants-of-the-old-ones-talking-to-jessamine-after-meeting-eyatlalli";
  const V_EYAT_AGAIN = "remnants-of-the-old-ones-talking-to-jessamine-after-meeting-eyatlalli-talking-to-eyatlalli-again";
  const V_EYAT_ITEMS = "remnants-of-the-old-ones-talking-to-eyatlalli-with-the-items";
  const V_EYAT_AFTER_PASTE = "remnants-of-the-old-ones-talking-to-eyatlalli-after-placing-the-grub-paste";
  const V_MOONS_JESS = "the-moons-of-peril-talking-to-jessamine";
  const V_MOONS_ATTALA = "the-moons-of-peril-talking-to-attala";
  const V_MOON_BLOOD = "the-moons-of-peril-defeating-the-blood-moon";
  const V_MOON_BLUE = "the-moons-of-peril-defeating-the-blue-moon";
  const V_MOON_ECLIPSE = "the-moons-of-peril-defeating-the-eclipse-moon";
  const V_MOON_ECLIPSE_MEET = "the-moons-of-peril-encountering-the-eclipse-moon";
  const V_FIN_ATTALA = "finishing-up-talking-to-attala-after-defeating-the-moons";
  const V_FIN_JESS = "finishing-up-talking-to-jessamine-after-defeating-the-moons";
  const V_FIN_ZUMA = "finishing-up-talking-to-zuma-or-the-builders";
  const V_FIN_EYAT = "finishing-up-talking-to-eyatlalli-after-defeating-the-moons";
  const V_POST_ATTALA = "post-quest-dialogue-talking-to-attalla";
  const V_POST_JESS = "post-quest-dialogue-talking-to-jessamine";
  const V_POST_ZUMA = "post-quest-dialogue-talking-to-zuma";
  const V_POST_EYAT = "post-quest-dialogue-talking-to-eyatlalli";

  // Condition step ids on the page.
  const CONDITION_NOT_REQUIREMENTS = "fwVmLJ";
  const CONDITION_REQUIREMENTS = "90IfKT";
  const CONDITION_NAGUA_PRIMARY = "ZHVLKb";
  const CONDITION_NAGUA_ASSIST = "TcJ6YB";
  const CONDITION_NAGUA_SMALL = "lFcJjv";
  const CONDITION_NO_GARDEN = "NcKCqX";
  const CONDITION_GARDEN = "wEqYSj";
  const CONDITION_CRATE_NO_SPACE = "PGSjVR";
  const CONDITION_CRATE_SOME = "18rygm";
  const CONDITION_CRATE_ONE = "dsWeAo";
  const CONDITION_CRATE_TWO = "ZEd02O";
  const CONDITION_CRATE_THREE = "JnXWzC";
  const CONDITION_CRATE_NO_HAMMER_SAW = "Ku2Wtl";
  const CONDITION_CRATE_HAMMER_NO_SAW = "-s3dx2";
  const CONDITION_HANDOUT_NO_SPACE = "x2SoCu";
  const CONDITION_NO_WATER_TALISMAN = "EsUGwK";
  const CONDITION_LOST_TALISMAN = "UxEXqy";
  const CONDITION_LOST_ONE = "KHiyIt";
  const CONDITION_LOST_ONE_NO_SPACE = "yu3RG9";
  const CONDITION_LOST_EARTH = "92EbtV";
  const CONDITION_LOST_WATER = "fPyQiV";
  const CONDITION_LOST_BOTH = "M3t2CR";
  const CONDITION_LOST_BOTH_NO_SPACE = "5C8U-_";
  const CONDITION_SMITH_NO_TALISMANS = "8t78zW";
  const CONDITION_SMITH_LOST_ONE = "ckM57u";
  const CONDITION_SMITH_LOST_ONE_NO_SPACE = "CvjcoR";
  const CONDITION_SMITH_LOST_EARTH = "MVHjrz";
  const CONDITION_SMITH_LOST_WATER = "XR1SXr";
  const CONDITION_SMITH_LOST_BOTH = "zYBCgw";
  const CONDITION_SMITH_LOST_BOTH_NO_SPACE = "6WrMq3";
  const CONDITION_ONE_SMALL_FAVOUR = "jCiXQg";
  const CONDITION_ALL_MOONS_BLUE = "vW9v5h";
  const CONDITION_ALL_MOONS_BLOOD = "Az3yns";
  const CONDITION_ALL_MOONS_ECLIPSE = "6FlKDI";

  // Action / message step ids on the page.
  const ACTION_ZUMA_DEPARTS = "P63EUg";
  const ACTION_ATTALA_WALKS = "mvJudt";
  const ACTION_TRIO_WALKS = "RDH7dp";
  const ACTION_CRATE_RECEIVE_THREE = "dPNo-N";
  const ACTION_CRATE_RECEIVE_TWO = "_CIfrj";
  const ACTION_CRATE_RECEIVE_ONE = "JNpPVi";
  const ACTION_CRATE_TOOLS = "uB_tsC";
  const ACTION_CRATE_TOOLS_2 = "QeVf2u";
  const MESSAGE_CRATE_NO_SPACE = "qkDssr";
  const MESSAGE_CRATE_TAKE = "tDtlPJ";
  const MESSAGE_CRATE_TAKE_2 = "z2rvpV";
  const MESSAGE_CRATE_TAKE_3 = "L6pKxi";
  const MESSAGE_CRATE_TAKE_4 = "NmgQba";
  const MESSAGE_CRATE_TAKE_5 = "21cHU7";
  const MESSAGE_CRATE_TAKE_6 = "azmnR4";
  const MESSAGE_CRATE_TAKE_7 = "j_LuaV";
  const MESSAGE_REQUIREMENTS = "5us5YI";
  const MESSAGE_SHOW_TALISMANS = "z1lytl";
  const MESSAGE_GIVE_TALISMANS = "Ft5Tp_";
  const MESSAGE_NAHTA_SHOW = "5GmIxR";
  const MESSAGE_NAHTA_CAST = "K3y7TW";
  const MESSAGE_NAHTA_EARTH = "XlBr72";
  const MESSAGE_NAHTA_WATER = "2ONlWM";
  const MESSAGE_NAHTA_BOTH = "h81BZw";
  const ACTION_SMITH_CUTSCENE = "rtHNE4";
  const MESSAGE_SMITH_BACK = "pdztrr";
  const MESSAGE_SMITH_EARTH = "gx-Ev4";
  const MESSAGE_SMITH_WATER = "0HnCSc";
  const MESSAGE_SMITH_BOTH = "Z_UCQh";
  const ACTION_SCREEN_SHAKES = "K5qTdy";
  const ACTION_EYAT_DISAPPEARS = "FWDkaz";
  const ACTION_EYAT_APPEARS = "lRZszf";
  const MESSAGE_PLACE_SCALES = "vhTPGa";
  const MESSAGE_PLACE_TAIL = "-rKyge";
  const MESSAGE_PLACE_PASTE = "W7-z4f";
  const ACTION_EYAT_GLYPH = "RO65j-";
  const ACTION_CUTSCENE_APPROACH = "2VsgBT";
  const ACTION_CUTSCENE_ATTACK = "qY-qsB";
  const ACTION_CUTSCENE_LEAVE = "OAFI67";

  const QUEST_CONDITION_IDS = new Set([
    CONDITION_NOT_REQUIREMENTS,
    CONDITION_REQUIREMENTS,
    CONDITION_NAGUA_PRIMARY,
    CONDITION_NAGUA_ASSIST,
    CONDITION_NAGUA_SMALL,
    CONDITION_NO_GARDEN,
    CONDITION_GARDEN,
    CONDITION_CRATE_NO_SPACE,
    CONDITION_CRATE_SOME,
    CONDITION_CRATE_ONE,
    CONDITION_CRATE_TWO,
    CONDITION_CRATE_THREE,
    CONDITION_CRATE_NO_HAMMER_SAW,
    CONDITION_CRATE_HAMMER_NO_SAW,
    CONDITION_HANDOUT_NO_SPACE,
    CONDITION_NO_WATER_TALISMAN,
    CONDITION_LOST_TALISMAN,
    CONDITION_LOST_ONE,
    CONDITION_LOST_ONE_NO_SPACE,
    CONDITION_LOST_EARTH,
    CONDITION_LOST_WATER,
    CONDITION_LOST_BOTH,
    CONDITION_LOST_BOTH_NO_SPACE,
    CONDITION_SMITH_NO_TALISMANS,
    CONDITION_SMITH_LOST_ONE,
    CONDITION_SMITH_LOST_ONE_NO_SPACE,
    CONDITION_SMITH_LOST_EARTH,
    CONDITION_SMITH_LOST_WATER,
    CONDITION_SMITH_LOST_BOTH,
    CONDITION_SMITH_LOST_BOTH_NO_SPACE,
    CONDITION_ONE_SMALL_FAVOUR,
    CONDITION_ALL_MOONS_BLUE,
    CONDITION_ALL_MOONS_BLOOD,
    CONDITION_ALL_MOONS_ECLIPSE,
  ]);

  // Distinct dialogue lines the stage machine latches onto (no other event fires).
  const LINE_MURALS_ATTALA = "Now where is that fool priest?";
  const LINE_MURALS_ZUMA = "Alright, calm down, both of you. Let's go see what the actual archaeologist has to say.";
  const LINE_CAMPS_TASK = "The surrounding caverns are quite large. If you could take some building supplies and set up some camps in each of them, it would make further exploration a lot easier.";
  const LINE_CAMPS_POINT = "You make a good point.";
  const LINE_TALISMANS_TASK = "Hmm... Nahta will know what to do with these. [player name], take them to him in Cam Torum's magic shop. Tell him I sent you.";
  const LINE_RITUAL_BEGINS = "The ritual is in motion, but the wound to the seal will not close with the Moons still raging against it. I must ask you for one more small favour.";
  const LINE_EYAT_SHAKE = "Argh!";
  const LINE_EYAT_ATTALA = "I knew I shouldn't have let that fool priest in!";
  const LINE_EYAT_ZUMA = "Zuma must have done something!";
  const LINE_ECLIPSE_ZUMA = "I can't believe it... An emissary of my god, standing before me...";
  const LINE_ECLIPSE_WARN = "Zuma, no! Step back!";
  const LINE_ECLIPSE_LEAVE = "Get out of here!";
  const LINE_CITY_INVITE = "Meet me inside the ruins. We need help setting up some base camps for further exploration.";
  const LINE_INFUSED_BRIEF = "Of course, we've not tried something like this before, so I imagine it will require you to do some testing.";
  const LINE_GATHER_TASK = "Yes. Bring me scales of a bream, the tail of a moss lizard and paste made of moonlight grubs. I will begin preparing the rest of the ritual.";
  const LINE_FINISH_JESS = "I'll be sticking around here for some time I reckon. There's still so much to discover in this place. See you around.";
  const LINE_FINISH_ATTALA = "Well it's not their choice, so they'll just have to suck it up. Who knows, maybe given long enough, you might start to grow on them!";
  const LINE_FINISH_ZUMA = "Interesting. Maybe there was some sort of connection between Ranul and this place after all.";
  const LINE_COMPLETE = "For now though, thank you for your help, iknil.";

  const LINES = new Map([
    [LINE_MURALS_ATTALA, handleMuralsAttalaLine],
    [LINE_MURALS_ZUMA, handleMuralsZumaLine],
    [LINE_CAMPS_TASK, handleCampsTaskLine],
    [LINE_CAMPS_POINT, handleCampsPointLine],
    [LINE_TALISMANS_TASK, handleTalismansTaskLine],
    [LINE_RITUAL_BEGINS, handleRitualBeginsLine],
    [LINE_EYAT_SHAKE, handleEyatShakeLine],
    [LINE_EYAT_ATTALA, handleEyatAttalaLine],
    [LINE_EYAT_ZUMA, handleEyatZumaLine],
    [LINE_ECLIPSE_ZUMA, handleEclipseZumaLine],
    [LINE_ECLIPSE_WARN, handleEclipseWarnLine],
    [LINE_ECLIPSE_LEAVE, handleEclipseLeaveLine],
    [LINE_CITY_INVITE, handleCityInviteLine],
    [LINE_INFUSED_BRIEF, handleInfusedBriefLine],
    [LINE_GATHER_TASK, handleGatherTaskLine],
    [LINE_FINISH_JESS, handleFinishJessLine],
    [LINE_FINISH_ATTALA, handleFinishAttalaLine],
    [LINE_FINISH_ZUMA, handleFinishZumaLine],
    [LINE_COMPLETE, handleCompleteLine],
  ]);

  /** Per-player owner-only quest spawns, keyed by role. */
  const trackedNpcs = new WeakMap();
  const eclipseScene = new WeakSet();
  let quest;
  let crateInstalled = false;

  // ==========================================================================
  // State helpers
  // ==========================================================================

  function stageOf(player) {
    return quest.getStage(player);
  }

  function isActive(player) {
    const stage = stageOf(player);
    return stage >= STAGE_STARTED && stage < STAGE_COMPLETE;
  }

  function attributeMask(player, name) {
    return Number(player.getAttribute(name)) || 0;
  }

  function hasMaskBit(player, name, bit) {
    return (attributeMask(player, name) & bit) !== 0;
  }

  function addMaskBit(player, name, bit) {
    player.setAttribute(name, attributeMask(player, name) | bit);
  }

  function held(player, itemId, amount = 1) {
    return player.getInventory().getAmount(itemId) >= amount;
  }

  function isQuestComplete(player, key) {
    const request = { player, key, complete: null };
    api.emitCustomEvent("quest:is-complete", request);
    return request.complete === true;
  }

  function meetsStartRequirements(player) {
    const skills = player.getSkillManager();
    if (!skills) return false;
    if (skills.getMaxLevel(Skill.SLAYER) < 48) return false;
    if (skills.getMaxLevel(Skill.HUNTER) < 20) return false;
    if (skills.getMaxLevel(Skill.FISHING) < 20) return false;
    if (skills.getMaxLevel(Skill.RUNECRAFTING) < 20) return false;
    if (skills.getMaxLevel(Skill.CONSTRUCTION) < 10) return false;
    return isQuestComplete(player, "twilights_promise");
  }

  function campMask(player) {
    return attributeMask(player, CAMPS_ATTRIBUTE);
  }

  function campsBuilt(player) {
    let count = 0;
    const mask = campMask(player);
    for (const site of CAMP_SITES) if ((mask & site.bit) !== 0) count++;
    return count;
  }

  function campSiteAt(location) {
    if (!location) return null;
    for (const site of CAMP_SITES) {
      if (
        Math.abs(location.x - site.x) <= 1 &&
        Math.abs(location.y - site.y) <= 1 &&
        location.z === site.z
      ) {
        return site;
      }
    }
    return null;
  }

  function muralMask(player) {
    return attributeMask(player, MURALS_ATTRIBUTE);
  }

  function moonMask(player) {
    return attributeMask(player, MOONS_ATTRIBUTE);
  }

  function moonDead(player, bit) {
    return (moonMask(player) & bit) !== 0;
  }

  function allMoonsDead(player) {
    return (moonMask(player) & ALL_MOONS_MASK) === ALL_MOONS_MASK;
  }

  function trioMask(player) {
    return attributeMask(player, TRIO_ATTRIBUTE);
  }

  /** Sends the sibling varbits the cache reads for camps, murals and boss deaths. */
  function syncSiblingVarbits(player) {
    const sender = player.getPacketSender();
    sender.sendVarbit(MURALS_VARBIT, muralMask(player) & 0x3);
    CAMP_SITES.forEach((site, index) => {
      sender.sendVarbit(CAMP_VARBITS[index], (campMask(player) & site.bit) !== 0 ? 1 : 0);
    });
    // After the quest the MoonsOfPeril plugin owns the Moons' dead varbits (the Lunar Chest resets them).
    if (stageOf(player) < STAGE_COMPLETE) {
      sender.sendVarbit(BOSS_DEAD_VARBITS.blood, moonDead(player, MOON_BLOOD_BIT) ? 1 : 0);
      sender.sendVarbit(BOSS_DEAD_VARBITS.blue, moonDead(player, MOON_BLUE_BIT) ? 1 : 0);
      sender.sendVarbit(BOSS_DEAD_VARBITS.eclipse, moonDead(player, MOON_ECLIPSE_BIT) ? 1 : 0);
    }
    sender.sendVarbit(
      EYATLALLI_VIS_VARBIT,
      stageOf(player) >= STAGE_EYAT_FOUND && stageOf(player) < STAGE_COMPLETE ? 1 : 0
    );
  }

  // ==========================================================================
  // NPC spawns
  // ==========================================================================

  function tracked(player) {
    let map = trackedNpcs.get(player);
    if (!map) {
      map = new Map();
      trackedNpcs.set(player, map);
    }
    return map;
  }

  function spawnTracked(player, key, definition) {
    const map = tracked(player);
    if (map.get(key)) return map.get(key);
    const npc = api.spawnNpc({ ...definition, owner: player, ownerOnly: true });
    if (npc) map.set(key, npc);
    return npc;
  }

  function removeTracked(player, key) {
    const map = trackedNpcs.get(player);
    const npc = map?.get(key);
    if (npc) {
      api.removeNpc(npc);
      map.delete(key);
    }
  }

  function removeAllTracked(player) {
    const map = trackedNpcs.get(player);
    if (!map) return;
    for (const npc of map.values()) api.removeNpc(npc);
    trackedNpcs.delete(player);
  }

  function installCampSuppliesCrate() {
    if (crateInstalled) return;
    crateInstalled = true;
    const object = new GameObject(
      CAMP_SUPPLIES_OBJECT_ID,
      new Location(1436, 9637, 1),
      10,
      0,
      null
    );
    ObjectManager.register(object, true);
  }

  /**
   * Reconciles the per-player quest NPCs with the stage. The Cam Torum trio
   * (Jessamine, Nahta, the blacksmith, the static Eyatlalli) already exist in
   * npc-spawns.json; only the copies the world lacks are owner-only spawns.
   */
  function syncNpcs(player) {
    if (!player || player.isPlayerBot?.() === true) return;
    const stage = stageOf(player);
    const wanted = new Set();
    if (stage <= STAGE_NAGUA_KILLED) {
      wanted.add("surface-attala");
      wanted.add("surface-zuma");
    }
    if (stage === STAGE_CITY_OPEN || stage === STAGE_IN_CITY) wanted.add("city-jessamine");
    if (stage >= STAGE_IN_NEY) {
      wanted.add("ney-attala");
      wanted.add("ney-zuma");
    }
    if (stage >= STAGE_EYAT_FOUND) wanted.add("eyatlalli");
    if (stage === STAGE_STARTED) wanted.add("nagua");

    const map = tracked(player);
    for (const key of [...map.keys()]) if (!wanted.has(key)) removeTracked(player, key);

    if (wanted.has("surface-attala")) {
      spawnTracked(player, "surface-attala", { id: ATTALA_NPC_ID, ...SURFACE_ATTALA_TILE, wanderRadius: 0 });
    }
    if (wanted.has("surface-zuma")) {
      spawnTracked(player, "surface-zuma", { id: ZUMA_SURFACE_RAW_NPC_ID, ...SURFACE_ZUMA_TILE, wanderRadius: 0 });
    }
    if (wanted.has("city-jessamine")) {
      spawnTracked(player, "city-jessamine", { id: JESSAMINE_CITY_NPC_ID, ...CITY_JESSAMINE_TILE, wanderRadius: 0 });
    }
    if (wanted.has("ney-attala")) {
      spawnTracked(player, "ney-attala", { id: ATTALA_NPC_ID, ...NEY_ATTALA_TILE, wanderRadius: 0 });
    }
    if (wanted.has("ney-zuma")) {
      spawnTracked(player, "ney-zuma", { id: ZUMA_NEY_RAW_NPC_ID, ...NEY_ZUMA_TILE, wanderRadius: 0 });
    }
    if (wanted.has("eyatlalli")) {
      spawnTracked(player, "eyatlalli", { id: EYATLALLI_NPC_ID, ...EYATLALLI_TILE, wanderRadius: 0 });
    }
    if (wanted.has("nagua")) {
      spawnTracked(player, "nagua", { id: SULPHUR_NAGUA_NPC_ID, ...NAGUA_TILE, wanderRadius: 0 });
    }
  }

  // ==========================================================================
  // Variant selection
  // ==========================================================================

  function selectVariant({ npcId, player }) {
    if (!player) return null;
    if (quest.isComplete(player)) return selectPostQuestVariant(npcId);
    if (ATTALA_NPC_IDS.has(npcId)) return selectAttalaVariant(player);
    if (ZUMA_NPC_IDS.has(npcId)) return selectZumaVariant(player);
    if (JESSAMINE_NPC_IDS.has(npcId)) return selectJessamineVariant(player);
    if (EYATLALLI_NPC_IDS.has(npcId)) return selectEyatlalliVariant(player);
    if (npcId === NAHTA_NPC_ID) return selectNahtaVariant(player);
    if (npcId === BLACKSMITH_NPC_ID) return selectBlacksmithVariant(player);
    return null;
  }

  function selectPostQuestVariant(npcId) {
    if (ATTALA_NPC_IDS.has(npcId)) return V_POST_ATTALA;
    if (ZUMA_NPC_IDS.has(npcId)) return V_POST_ZUMA;
    if (JESSAMINE_NPC_IDS.has(npcId)) return V_POST_JESS;
    if (EYATLALLI_NPC_IDS.has(npcId)) return V_POST_EYAT;
    return null;
  }

  function selectAttalaVariant(player) {
    const stage = stageOf(player);
    if (stage < STAGE_STARTED) return V_START;
    if (stage < STAGE_NAGUA_KILLED) return V_START_AGAIN;
    if (stage < STAGE_CITY_OPEN) return V_RETURN_ATTALA;
    if (stage < STAGE_IN_NEY) return V_CAM_ATTALA;
    if (stage < STAGE_CAMPS) return V_TRIO_ATTALA;
    if (stage <= STAGE_CAMPS_DONE - 1) return V_CAMPS_REMIND_AZ;
    if (stage <= STAGE_CAMPS_DONE + 2) return V_CAMPS_DONE;
    if (stage <= STAGE_ENCHANTED) return V_ATTALA_BEFORE_TALISMANS;
    if (stage === STAGE_INFUSED) return V_ATTALA_INFUSED;
    if (stage <= STAGE_GATHER - 1) return V_ATTALA_INFUSED_AGAIN;
    if (stage <= STAGE_RITUAL - 1) return V_MEET_EYAT;
    if (stage < STAGE_MOONS_DONE) return V_MOONS_ATTALA;
    return V_FIN_ATTALA;
  }

  function selectZumaVariant(player) {
    const stage = stageOf(player);
    if (stage < STAGE_STARTED) return V_START;
    if (stage < STAGE_NAGUA_KILLED) return V_START_AGAIN;
    if (stage < STAGE_CITY_OPEN) return V_RETURN_ATTALA;
    if (stage < STAGE_IN_NEY) return V_CAM_ZUMA;
    if (stage < STAGE_CAMPS) {
      return hasMaskBit(player, MURALS_ATTRIBUTE, MURAL_BIT_ATTALA) ? V_TRIO_ZUMA : V_TRIO_ZUMA_BEFORE;
    }
    if (stage <= STAGE_CAMPS_DONE - 1) return V_CAMPS_REMIND_AZ;
    if (stage <= STAGE_CAMPS_DONE + 2) return V_CAMPS_DONE;
    if (stage <= STAGE_ENCHANTED) return V_ZUMA_BEFORE_TALISMANS;
    if (stage <= STAGE_LOCATE) return V_ZUMA_AFTER_ATTALA;
    if (stage <= STAGE_RITUAL - 1) return V_MEET_EYAT;
    if (stage < STAGE_MOONS_DONE) return null; // no stage-appropriate variant; standard page
    return V_FIN_ZUMA;
  }

  function selectJessamineVariant(player) {
    const stage = stageOf(player);
    if (stage < STAGE_IN_CITY) return null;
    if (stage === STAGE_IN_CITY) return V_CAM_JESS;
    if (stage === STAGE_IN_NEY && !inAntechamber(player)) return V_CAM_JESS_AGAIN;
    if (stage < STAGE_CAMPS) {
      return hasMaskBit(player, MURALS_ATTRIBUTE, MURAL_BIT_ATTALA) ? V_TRIO_JESS : V_TRIO_JESS_BEFORE;
    }
    if (stage <= STAGE_CAMPS_DONE - 1) return V_CAMPS_REMIND_JESS;
    if (stage <= STAGE_CAMPS_DONE + 2) return V_CAMPS_DONE;
    if (stage <= STAGE_ENCHANTED) return V_JESS_BEFORE_TALISMANS;
    if (stage <= STAGE_LOCATE) return V_JESS_AFTER_ATTALA;
    if (stage <= STAGE_RITUAL - 1) return V_MEET_EYAT;
    if (stage < STAGE_MOONS_DONE) return V_MOONS_JESS;
    return V_FIN_JESS;
  }

  function selectEyatlalliVariant(player) {
    const stage = stageOf(player);
    if (stage < STAGE_EYAT_FOUND) return null;
    if (stage < STAGE_GATHER) return V_EYAT_AGAIN;
    if (stage < STAGE_RITUAL) {
      return hasAllRitualItems(player) ? V_EYAT_ITEMS : V_EYAT_AGAIN;
    }
    if (stage < STAGE_MOONS_DONE) return V_EYAT_AFTER_PASTE;
    return (trioMask(player) & FINISH_TRIO_MASK) === FINISH_TRIO_MASK ? V_FIN_EYAT : V_EYAT_AFTER_PASTE;
  }

  function selectNahtaVariant(player) {
    const stage = stageOf(player);
    if (stage < STAGE_TALISMANS) return null;
    if (stage === STAGE_TALISMANS) return V_NAHTA;
    if (stage < STAGE_COMPLETE) return V_NAHTA_ITEM_AGAIN;
    return null;
  }

  function selectBlacksmithVariant(player) {
    const stage = stageOf(player);
    if (stage < STAGE_ENCHANTED) return null;
    if (stage === STAGE_ENCHANTED) return V_BLACKSMITH;
    if (stage === STAGE_INFUSED) return V_BLACKSMITH_ITEM_AGAIN;
    return null;
  }

  function hasAllRitualItems(player) {
    return (
      held(player, BREAM_SCALES_ITEM_ID) &&
      held(player, MOSS_LIZARD_TAIL_ITEM_ID) &&
      held(player, MOONLIGHT_GRUB_PASTE_ITEM_ID)
    );
  }

  /** The Neypotzli antechamber (region 5782), for players who teleport in early. */
  function inAntechamber(player) {
    const location = player.getLocation?.();
    return (
      !!location &&
      location.getZ() === 1 &&
      location.getX() >= 1408 &&
      location.getX() <= 1471 &&
      location.getY() >= 9600 &&
      location.getY() <= 9663
    );
  }

  // ==========================================================================
  // Conditions
  // ==========================================================================

  function answerCondition(event) {
    const { stepId, player } = event;
    if (!player || !QUEST_CONDITION_IDS.has(stepId)) return null;
    switch (stepId) {
      case CONDITION_NOT_REQUIREMENTS:
        return !meetsStartRequirements(player);
      case CONDITION_REQUIREMENTS:
        return meetsStartRequirements(player);
      case CONDITION_NAGUA_PRIMARY:
        return true;
      case CONDITION_NAGUA_ASSIST:
      case CONDITION_NAGUA_SMALL:
        return false;
      case CONDITION_NO_GARDEN:
        return !isQuestComplete(player, "the_garden_of_death");
      case CONDITION_GARDEN:
        return isQuestComplete(player, "the_garden_of_death");
      case CONDITION_CRATE_NO_SPACE:
        return crateSpaceNeeded(player) > player.getInventory().getFreeSlots();
      case CONDITION_CRATE_SOME:
        return held(player, BUILDING_SUPPLIES_ITEM_ID);
      case CONDITION_CRATE_ONE:
        return player.getInventory().getAmount(BUILDING_SUPPLIES_ITEM_ID) === 1;
      case CONDITION_CRATE_TWO:
        return player.getInventory().getAmount(BUILDING_SUPPLIES_ITEM_ID) === 2;
      case CONDITION_CRATE_THREE:
        return player.getInventory().getAmount(BUILDING_SUPPLIES_ITEM_ID) >= 3;
      case CONDITION_CRATE_NO_HAMMER_SAW:
        return !held(player, HAMMER_ITEM_ID) && !held(player, SAW_ITEM_ID);
      case CONDITION_CRATE_HAMMER_NO_SAW:
        return held(player, HAMMER_ITEM_ID) && !held(player, SAW_ITEM_ID);
      case CONDITION_HANDOUT_NO_SPACE:
        return player.getInventory().getFreeSlots() < 2;
      case CONDITION_NO_WATER_TALISMAN:
        return !held(player, WATER_TALISMAN_ITEM_ID);
      case CONDITION_LOST_TALISMAN:
        return !held(player, WATER_TALISMAN_ITEM_ID) || !held(player, EARTH_TALISMAN_ITEM_ID);
      case CONDITION_LOST_ONE:
        return lostEnchantedCount(player) === 1;
      case CONDITION_LOST_ONE_NO_SPACE:
      case CONDITION_LOST_BOTH_NO_SPACE:
      case CONDITION_SMITH_LOST_ONE_NO_SPACE:
      case CONDITION_SMITH_LOST_BOTH_NO_SPACE:
        return player.getInventory().getFreeSlots() === 0;
      case CONDITION_LOST_EARTH:
        return !held(player, ENCHANTED_EARTH_TALISMAN_ITEM_ID);
      case CONDITION_LOST_WATER:
        return !held(player, ENCHANTED_WATER_TALISMAN_ITEM_ID);
      case CONDITION_LOST_BOTH:
        return lostEnchantedCount(player) === 2;
      case CONDITION_SMITH_NO_TALISMANS:
        return !held(player, ENCHANTED_WATER_TALISMAN_ITEM_ID) || !held(player, ENCHANTED_EARTH_TALISMAN_ITEM_ID);
      case CONDITION_SMITH_LOST_ONE:
        return lostInfusedCount(player) === 1;
      case CONDITION_SMITH_LOST_EARTH:
        return !held(player, INFUSED_EARTH_TALISMAN_ITEM_ID);
      case CONDITION_SMITH_LOST_WATER:
        return !held(player, INFUSED_WATER_TALISMAN_ITEM_ID);
      case CONDITION_SMITH_LOST_BOTH:
        return lostInfusedCount(player) === 2;
      case CONDITION_ONE_SMALL_FAVOUR:
        return isQuestComplete(player, "one_small_favour");
      case CONDITION_ALL_MOONS_BLUE:
      case CONDITION_ALL_MOONS_BLOOD:
      case CONDITION_ALL_MOONS_ECLIPSE:
        return allMoonsDead(player);
      default:
        return null;
    }
  }

  function lostEnchantedCount(player) {
    let lost = 0;
    if (!held(player, ENCHANTED_WATER_TALISMAN_ITEM_ID)) lost++;
    if (!held(player, ENCHANTED_EARTH_TALISMAN_ITEM_ID)) lost++;
    return lost;
  }

  function lostInfusedCount(player) {
    let lost = 0;
    if (!held(player, INFUSED_WATER_TALISMAN_ITEM_ID)) lost++;
    if (!held(player, INFUSED_EARTH_TALISMAN_ITEM_ID)) lost++;
    return lost;
  }

  /** Supplies and tools the crate would hand over right now. */
  function crateSpaceNeeded(player) {
    let needed = Math.min(3 - campsBuilt(player), 3);
    if (!held(player, HAMMER_ITEM_ID)) needed++;
    if (!held(player, SAW_ITEM_ID)) needed++;
    return needed;
  }

  // ==========================================================================
  // Start hook, actions and lines
  // ==========================================================================

  function handleStartHook({ player, npcId, hook }) {
    if (hook !== START_HOOK || !player) return;
    if (!ATTALA_NPC_IDS.has(npcId) && !ZUMA_NPC_IDS.has(npcId)) return;
    if (stageOf(player) !== 0) return;
    player.setAttribute(STAGE_SCHEMA_ATTRIBUTE, STAGE_SCHEMA_VERSION);
    quest.setStage(player, STAGE_STARTED);
    syncNpcs(player);
  }

  function handleAction(event) {
    const { player, stepId, kind } = event;
    if (!player || !stepId) return;
    const message = kind === "message";
    switch (stepId) {
      case ACTION_ZUMA_DEPARTS:
        event.handled = true;
        if (stageOf(player) === STAGE_NAGUA_KILLED) quest.setStage(player, STAGE_CITY_OPEN);
        return;
      case ACTION_ATTALA_WALKS:
      case ACTION_TRIO_WALKS:
      case ACTION_SMITH_CUTSCENE:
      case ACTION_SCREEN_SHAKES:
      case ACTION_EYAT_APPEARS:
      case ACTION_EYAT_GLYPH:
      case ACTION_CUTSCENE_APPROACH:
      case ACTION_CUTSCENE_ATTACK:
      case ACTION_CUTSCENE_LEAVE:
        event.handled = true;
        return;
      case ACTION_EYAT_DISAPPEARS:
        event.handled = true;
        if (stageOf(player) === STAGE_LOCATE) quest.setStage(player, STAGE_EYAT_FOUND);
        syncNpcs(player);
        syncSiblingVarbits(player);
        return;
      case ACTION_CRATE_RECEIVE_THREE:
        event.handled = true;
        giveCrateSupplies(player, Math.min(3 - campsBuilt(player), 3), true);
        return;
      case ACTION_CRATE_RECEIVE_TWO:
        event.handled = true;
        giveCrateSupplies(player, Math.min(3 - campsBuilt(player), 2), true);
        return;
      case ACTION_CRATE_RECEIVE_ONE:
        event.handled = true;
        giveCrateSupplies(player, Math.min(3 - campsBuilt(player), 1), true);
        return;
      case ACTION_CRATE_TOOLS:
      case ACTION_CRATE_TOOLS_2:
        event.handled = true;
        giveToolIfMissing(player, HAMMER_ITEM_ID);
        giveToolIfMissing(player, SAW_ITEM_ID);
        return;
      case MESSAGE_GIVE_TALISMANS:
        if (stageOf(player) >= STAGE_CAMPS_DONE && stageOf(player) < STAGE_TALISMANS && player.getInventory().getFreeSlots() >= 2) {
          player.getInventory().adds(WATER_TALISMAN_ITEM_ID, 1);
          player.getInventory().adds(EARTH_TALISMAN_ITEM_ID, 1);
          quest.setStage(player, STAGE_TALISMANS);
        }
        return;
      case MESSAGE_NAHTA_CAST:
        if (stageOf(player) === STAGE_TALISMANS) {
          player.getInventory().deleteNumber(WATER_TALISMAN_ITEM_ID, 1);
          player.getInventory().deleteNumber(EARTH_TALISMAN_ITEM_ID, 1);
          player.getInventory().adds(ENCHANTED_WATER_TALISMAN_ITEM_ID, 1);
          player.getInventory().adds(ENCHANTED_EARTH_TALISMAN_ITEM_ID, 1);
          quest.setStage(player, STAGE_ENCHANTED);
        }
        return;
      case MESSAGE_NAHTA_EARTH:
        if (!held(player, ENCHANTED_EARTH_TALISMAN_ITEM_ID)) {
          player.getInventory().adds(ENCHANTED_EARTH_TALISMAN_ITEM_ID, 1);
        }
        return;
      case MESSAGE_NAHTA_WATER:
        if (!held(player, ENCHANTED_WATER_TALISMAN_ITEM_ID)) {
          player.getInventory().adds(ENCHANTED_WATER_TALISMAN_ITEM_ID, 1);
        }
        return;
      case MESSAGE_NAHTA_BOTH:
        if (!held(player, ENCHANTED_EARTH_TALISMAN_ITEM_ID)) {
          player.getInventory().adds(ENCHANTED_EARTH_TALISMAN_ITEM_ID, 1);
        }
        if (!held(player, ENCHANTED_WATER_TALISMAN_ITEM_ID)) {
          player.getInventory().adds(ENCHANTED_WATER_TALISMAN_ITEM_ID, 1);
        }
        return;
      case MESSAGE_SMITH_BACK:
        if (stageOf(player) === STAGE_ENCHANTED) {
          player.getInventory().deleteNumber(ENCHANTED_WATER_TALISMAN_ITEM_ID, 1);
          player.getInventory().deleteNumber(ENCHANTED_EARTH_TALISMAN_ITEM_ID, 1);
          player.getInventory().adds(INFUSED_WATER_TALISMAN_ITEM_ID, 1);
          player.getInventory().adds(INFUSED_EARTH_TALISMAN_ITEM_ID, 1);
          quest.setStage(player, STAGE_INFUSED);
        }
        return;
      case MESSAGE_SMITH_EARTH:
        if (!held(player, INFUSED_EARTH_TALISMAN_ITEM_ID)) {
          player.getInventory().adds(INFUSED_EARTH_TALISMAN_ITEM_ID, 1);
        }
        return;
      case MESSAGE_SMITH_WATER:
        if (!held(player, INFUSED_WATER_TALISMAN_ITEM_ID)) {
          player.getInventory().adds(INFUSED_WATER_TALISMAN_ITEM_ID, 1);
        }
        return;
      case MESSAGE_SMITH_BOTH:
        if (!held(player, INFUSED_EARTH_TALISMAN_ITEM_ID)) {
          player.getInventory().adds(INFUSED_EARTH_TALISMAN_ITEM_ID, 1);
        }
        if (!held(player, INFUSED_WATER_TALISMAN_ITEM_ID)) {
          player.getInventory().adds(INFUSED_WATER_TALISMAN_ITEM_ID, 1);
        }
        return;
      case MESSAGE_PLACE_SCALES:
        if (stageOf(player) === STAGE_GATHER) quest.setStage(player, STAGE_GATHER + 1);
        return;
      case MESSAGE_PLACE_TAIL:
        if (stageOf(player) === STAGE_GATHER + 1) quest.setStage(player, STAGE_GATHER + 2);
        return;
      case MESSAGE_PLACE_PASTE:
        if (stageOf(player) >= STAGE_GATHER && stageOf(player) < STAGE_RITUAL) {
          player.getInventory().deleteNumber(BREAM_SCALES_ITEM_ID, 1);
          player.getInventory().deleteNumber(MOSS_LIZARD_TAIL_ITEM_ID, 1);
          player.getInventory().deleteNumber(MOONLIGHT_GRUB_PASTE_ITEM_ID, 1);
          quest.setStage(player, STAGE_GATHER + 3);
        }
        return;
      case MESSAGE_CRATE_NO_SPACE:
      case MESSAGE_CRATE_TAKE:
      case MESSAGE_CRATE_TAKE_2:
      case MESSAGE_CRATE_TAKE_3:
      case MESSAGE_CRATE_TAKE_4:
      case MESSAGE_CRATE_TAKE_5:
      case MESSAGE_CRATE_TAKE_6:
      case MESSAGE_CRATE_TAKE_7:
      case MESSAGE_REQUIREMENTS:
      case MESSAGE_SHOW_TALISMANS:
      case MESSAGE_NAHTA_SHOW:
        return;
      default:
        if (message) return;
        return;
    }
  }

  function giveCrateSupplies(player, supplies, withTools) {
    if (supplies > 0) player.getInventory().adds(BUILDING_SUPPLIES_ITEM_ID, supplies);
    if (withTools) {
      giveToolIfMissing(player, HAMMER_ITEM_ID);
      giveToolIfMissing(player, SAW_ITEM_ID);
    }
  }

  function giveToolIfMissing(player, itemId) {
    if (!held(player, itemId)) player.getInventory().adds(itemId, 1);
  }

  const DIALOGUE_NPC_IDS = new Set([...ATTALA_NPC_IDS, ...ZUMA_NPC_IDS, ...JESSAMINE_NPC_IDS, ...EYATLALLI_NPC_IDS]);

  function handleLine(event) {
    if (!event.player || !DIALOGUE_NPC_IDS.has(event.npcId)) return;
    const handler = LINES.get(event.text);
    if (handler) handler(event);
  }

  function handleMuralsAttalaLine({ player }) {
    const stage = stageOf(player);
    if (stage < STAGE_IN_NEY || stage >= STAGE_CAMPS) return;
    if (stage === STAGE_IN_NEY) quest.setStage(player, STAGE_TRIO);
    addMaskBit(player, MURALS_ATTRIBUTE, MURAL_BIT_ATTALA);
    player.getPacketSender().sendVarbit(MURALS_VARBIT, muralMask(player) & 0x3);
  }

  function handleMuralsZumaLine({ player }) {
    const stage = stageOf(player);
    if (stage < STAGE_IN_NEY || stage >= STAGE_CAMPS) return;
    if (stage === STAGE_IN_NEY) quest.setStage(player, STAGE_TRIO);
    addMaskBit(player, MURALS_ATTRIBUTE, MURAL_BIT_ZUMA);
    player.getPacketSender().sendVarbit(MURALS_VARBIT, muralMask(player) & 0x3);
  }

  function handleCampsTaskLine({ player }) {
    const stage = stageOf(player);
    if (stage < STAGE_IN_NEY || stage >= STAGE_CAMPS) return;
    quest.setStage(player, STAGE_CAMPS);
  }

  function handleCampsPointLine({ player }) {
    if (stageOf(player) === STAGE_CAMPS_DONE) quest.setStage(player, STAGE_CAMPS_DONE + 1);
  }

  function handleTalismansTaskLine({ player }) {
    if (stageOf(player) === STAGE_CAMPS_DONE + 1) quest.setStage(player, STAGE_CAMPS_DONE + 2);
  }

  function handleRitualBeginsLine({ player }) {
    if (stageOf(player) === STAGE_GATHER + 3) quest.setStage(player, STAGE_RITUAL);
    shakeCamera(player);
  }

  function handleEyatShakeLine({ player }) {
    if (stageOf(player) === STAGE_EYAT_FOUND) quest.setStage(player, STAGE_EYAT_FOUND + 1);
    shakeCamera(player);
  }

  function shakeCamera(player) {
    const sender = player.getPacketSender();
    sender.sendCameraShake(0, 8).sendCameraShake(1, 8).sendCameraShake(2, 8);
    Scenes.later(player, 4, () => player.isRegistered() && player.getPacketSender().sendCameraReset());
  }

  function handleEyatAttalaLine({ player }) {
    if (stageOf(player) === STAGE_EYAT_FOUND + 1) quest.setStage(player, STAGE_EYAT_FOUND + 2);
  }

  function handleEyatZumaLine({ player }) {
    if (stageOf(player) === STAGE_EYAT_FOUND + 2) quest.setStage(player, STAGE_EYAT_FOUND + 3);
  }

  function handleCityInviteLine({ player }) {
    if (stageOf(player) !== STAGE_IN_CITY) return;
    quest.setStage(player, STAGE_IN_NEY);
  }

  function handleInfusedBriefLine({ player }) {
    if (stageOf(player) !== STAGE_INFUSED) return;
    quest.setStage(player, STAGE_LOCATE);
  }

  function handleGatherTaskLine({ player }) {
    if (stageOf(player) < STAGE_EYAT_FOUND || stageOf(player) >= STAGE_GATHER) return;
    quest.setStage(player, STAGE_GATHER);
  }

  function handleFinishJessLine({ player }) {
    if (stageOf(player) !== STAGE_MOONS_DONE) return;
    addMaskBit(player, TRIO_ATTRIBUTE, TRIO_BIT_JESSAMINE);
    maybeFinishTrio(player);
  }

  function handleFinishAttalaLine({ player }) {
    if (stageOf(player) !== STAGE_MOONS_DONE) return;
    addMaskBit(player, TRIO_ATTRIBUTE, TRIO_BIT_ATTALA);
    maybeFinishTrio(player);
  }

  function handleFinishZumaLine({ player }) {
    if (stageOf(player) !== STAGE_MOONS_DONE) return;
    addMaskBit(player, TRIO_ATTRIBUTE, TRIO_BIT_ZUMA);
    maybeFinishTrio(player);
    if ((trioMask(player) & FINISH_TRIO_MASK) === FINISH_TRIO_MASK) {
      quest.setStage(player, STAGE_FINISHED);
    }
  }

  /** The Jessamine and Zuma bits gate Eyatlalli's final conversation. */
  function maybeFinishTrio(player) {
    void player;
  }

  function handleCompleteLine({ player }) {
    if (stageOf(player) < STAGE_MOONS_DONE || quest.isComplete(player)) return;
    if ((trioMask(player) & FINISH_TRIO_MASK) !== FINISH_TRIO_MASK) return;
    player.setAttribute(STAGE_SCHEMA_ATTRIBUTE, STAGE_SCHEMA_VERSION);
    if (stageOf(player) < STAGE_FINISHED) quest.setStage(player, STAGE_FINISHED);
    if (!quest.complete(player)) return;
    syncNpcs(player);
  }

  // ==========================================================================
  // Items
  // ==========================================================================

  function handleItemAction(event) {
    const { player, itemId, option } = event;
    if (!player || !INFUSED_TALISMAN_ITEM_IDS.has(itemId)) return;
    if (String(option ?? "") !== "Locate") return;
    event.handled = true;
    const stage = stageOf(player);
    if (stage < STAGE_INFUSED || stage >= STAGE_COMPLETE) return;
    if (stage >= STAGE_EYAT_FOUND) return;
    const location = player.getLocation();
    const near =
      Math.abs(location.getX() - LOCATE_TILE.x) <= LOCATE_RADIUS &&
      Math.abs(location.getY() - LOCATE_TILE.y) <= LOCATE_RADIUS &&
      location.getZ() === LOCATE_TILE.z;
    if (!near) {
      player.sendMessage("The talismans should guide you to the point in this place where these magics of earth and streams resonate most strongly.");
      return;
    }
    quest.setStage(player, STAGE_LOCATE);
    startTranscript(api, player, EYATLALLI_NPC_ID, PAGE, V_LOCATE);
  }

  function handleItemOnNpc(event) {
    const { player, npcId, itemId } = event;
    if (!player) return;
    if (npcId === NAHTA_NPC_ID && BASE_TALISMAN_ITEM_IDS.has(itemId) && stageOf(player) === STAGE_TALISMANS) {
      event.handled = true;
      startTranscript(api, player, NAHTA_NPC_ID, PAGE, V_NAHTA_ITEM);
      return;
    }
    if (npcId === BLACKSMITH_NPC_ID && ENCHANTED_TALISMAN_ITEM_IDS.has(itemId) && stageOf(player) === STAGE_ENCHANTED) {
      event.handled = true;
      startTranscript(api, player, BLACKSMITH_NPC_ID, PAGE, V_BLACKSMITH_ITEM);
    }
  }

  function handleItemOnItem(event) {
    const { player, usedItemId, usedWithItemId } = event;
    if (!player) return;
    const pair = new Set([usedItemId, usedWithItemId]);
    // Grinding grubs into paste is the MoonsOfPeril plugin's (Camps.MoonsOfPeril), for everyone.
    if (pair.has(KNIFE_ITEM_ID) && pair.has(RAW_BREAM_ITEM_ID)) {
      event.handled = true;
      if (!held(player, RAW_BREAM_ITEM_ID)) return;
      player.getInventory().deleteNumber(RAW_BREAM_ITEM_ID, 1);
      player.getInventory().adds(BREAM_SCALES_ITEM_ID, 1);
      player.sendMessage("You remove the scales from the bream.");
      return;
    }
    if (pair.has(KNIFE_ITEM_ID) && pair.has(RAW_MOSS_LIZARD_ITEM_ID)) {
      event.handled = true;
      if (!held(player, RAW_MOSS_LIZARD_ITEM_ID)) return;
      player.getInventory().deleteNumber(RAW_MOSS_LIZARD_ITEM_ID, 1);
      player.getInventory().adds(MOSS_LIZARD_TAIL_ITEM_ID, 1);
      player.sendMessage("You cut the tail from the lizard.");
    }
  }

  // ==========================================================================
  // Object interactions
  // ==========================================================================

  function handleItemOnObject(event) {
    const { player, itemId, objectId, location } = event;
    if (!player || itemId !== BUILDING_SUPPLIES_ITEM_ID) return;
    if (objectId !== CAMP_STOVE_OBJECT_ID) return;
    const site = campSiteAt(location);
    if (!site) return;
    event.handled = true;
    const stage = stageOf(player);
    if (stage < STAGE_TRIO || stage >= STAGE_TALISMANS) return;
    if ((campMask(player) & site.bit) !== 0) return;
    if (!held(player, BUILDING_SUPPLIES_ITEM_ID)) return;
    player.getInventory().deleteNumber(BUILDING_SUPPLIES_ITEM_ID, 1);
    addMaskBit(player, CAMPS_ATTRIBUTE, site.bit);
    player.getPacketSender().sendVarbit(site.varbit, 1);
    player.sendMessage("You set up the camp.");
    if (campsBuilt(player) === CAMP_SITES.length) {
      quest.setStage(player, STAGE_CAMPS_DONE);
    }
  }

  function handleObjectInteraction(event) {
    const { player, objectId, location } = event;
    if (!player || !location) return;
    if (ENTRANCE_OBJECT_IDS.has(objectId)) {
      handleEntranceInteraction(event);
      return;
    }
    if (objectId === CAMP_SUPPLIES_OBJECT_ID) {
      handleCampSupplies(event);
      return;
    }
    if (objectId === SUPPLY_CRATES_OBJECT_ID) {
      handleSupplyCrates(event);
      return;
    }
    if (objectId === GRUBBY_SAPLING_OBJECT_ID) {
      handleGrubbySapling(event);
      return;
    }
    if (objectId === LIZARD_ROCK_OBJECT_ID) {
      handleLizardRock(event);
      return;
    }
    if (objectId === LIZARD_BUSH_OBJECT_ID) {
      handleLizardBush(event);
      return;
    }
    if (objectId === NEYPOTZLI_FISHING_SPOT_OBJECT_ID) {
      handleFishingSpot(event);
    }
  }

  function handleEntranceInteraction(event) {
    const { player, objectId, location } = event;
    const option = String(event.definition?.getInteractions?.()?.[event.clickType - 1] ?? "");
    if (option !== "Pass-through") return;
    const key = `${objectId}:${location.x}:${location.y}:${location.z}`;
    const entrance = ENTRANCES.get(key);
    if (!entrance) return;
    event.handled = true;
    if (entrance.boss) {
      handleBossEntrance(player, entrance);
      return;
    }
    if (entrance.kind === "surface") {
      handleSurfaceEntrance(player);
      return;
    }
    if (entrance.kind === "cam-torum-exit") {
      player.moveTo(new Location(SURFACE_LANDING.x, SURFACE_LANDING.y, SURFACE_LANDING.z));
      return;
    }
    if (entrance.kind === "ney-enter") {
      if (stageOf(player) < STAGE_IN_NEY) {
        startTranscript(api, player, JESSAMINE_NPC_ID, PAGE, V_RUINS_GUARD);
        return;
      }
      enterNeypotzli(player);
      return;
    }
    if (entrance.kind === "ney-exit") {
      player.moveTo(new Location(CAM_TORUM_EXIT.x, CAM_TORUM_EXIT.y, CAM_TORUM_EXIT.z));
      return;
    }
    if (entrance.kind === "cavern-exit") {
      player.moveTo(new Location(NEYPOTZLI_LANDING.x, NEYPOTZLI_LANDING.y, NEYPOTZLI_LANDING.z));
      return;
    }
    if (entrance.kind === "cavern") {
      handleCavernEntrance(player, entrance, event);
      return;
    }
    if (entrance.kind === "tunnel") {
      handleTunnelGate(player, entrance.landing, event);
    }
  }

  function enterNeypotzli(player) {
    Scenes.fade(player, true);
    Scenes.controls(player, true, true);
    player.moveTo(new Location(NEYPOTZLI_LANDING.x, NEYPOTZLI_LANDING.y, NEYPOTZLI_LANDING.z));
    if (stageOf(player) === STAGE_IN_NEY) quest.setStage(player, STAGE_TRIO);
    syncNpcs(player);
    Scenes.later(player, 3, () => {
      if (!player.isRegistered()) return;
      Scenes.fade(player, false);
      player.getPacketSender()
        .sendCameraMoveTo(1448, 9580, 1400, { rate: 100, rate2: 100 })
        .sendCameraLookAt(1448, 9581, 10, { rate: 100, rate2: 100 });
      Scenes.later(player, 6, () => {
        if (!player.isRegistered()) return;
        player.getPacketSender().sendCameraReset();
        Scenes.controls(player, false);
      });
    });
  }

  /** The long winding tunnels between the caverns (captured fade + message). */
  function handleTunnelGate(player, landing, event) {
    Scenes.fade(player, true);
    Scenes.controls(player, true, true);
    player.sendMessage("You follow a long and winding tunnel before emerging on the other side.");
    const transport = {
      player, objectId: event?.objectId, source: event?.location,
      destination: { x: landing.x, y: landing.y, z: landing.z },
    };
    api.emitCustomEvent("perilous-moons:transport", transport);
    const destination = transport.destination ?? landing;
    player.moveTo(new Location(destination.x, destination.y, destination.z));
    Scenes.later(player, 3, () => {
      if (!player.isRegistered()) return;
      Scenes.fade(player, false);
      Scenes.later(player, 2, () => {
        if (player.isRegistered()) Scenes.controls(player, false);
      });
    });
  }

  function handleSurfaceEntrance(player) {
    if (stageOf(player) < STAGE_CITY_OPEN) {
      startTranscript(api, player, ATTALA_NPC_ID, PAGE, V_PASS_GATE);
      return;
    }
    player.moveTo(new Location(CAM_TORUM_LANDING.x, CAM_TORUM_LANDING.y, CAM_TORUM_LANDING.z));
    if (stageOf(player) === STAGE_CITY_OPEN) quest.setStage(player, STAGE_IN_CITY);
    syncNpcs(player);
  }

  function handleCavernEntrance(player, entrance, event) {
    const stage = stageOf(player);
    if (stage < STAGE_TRIO) {
      startTranscript(api, player, ATTALA_NPC_ID, PAGE, V_GUARD_NO_TALK);
      return;
    }
    if (stage < STAGE_CAMPS_DONE && campsBuilt(player) < CAMP_SITES.length && !held(player, BUILDING_SUPPLIES_ITEM_ID)) {
      startTranscript(api, player, JESSAMINE_NPC_ID, PAGE, V_GUARD_NO_SUPPLIES);
      return;
    }
    const landing = entrance.landing;
    const transport = {
      player, objectId: event.objectId, source: event.location,
      destination: { x: landing.x, y: landing.y, z: landing.z },
    };
    api.emitCustomEvent("perilous-moons:transport", transport);
    const destination = transport.destination ?? landing;
    player.moveTo(new Location(destination.x, destination.y, destination.z));
  }

  function handleBossEntrance(player, entrance) {
    const stage = stageOf(player);
    if (stage < STAGE_RITUAL) {
      const variant = stage >= STAGE_EYAT_FOUND ? V_GUARD_BOSS_MID : V_GUARD_BOSS_BEFORE;
      startTranscript(api, player, EYATLALLI_NPC_ID, PAGE, variant);
      return;
    }
    const landing = entrance.landing;
    player.moveTo(new Location(landing.x, landing.y, landing.z));
    if (stage === STAGE_RITUAL) quest.setStage(player, STAGE_MOONS);
  }

  function handleCampSupplies(event) {
    const { player } = event;
    const option = String(event.definition?.getInteractions?.()?.[event.clickType - 1] ?? "");
    if (option !== "Take-from") return;
    event.handled = true;
    if (!isActive(player)) return;
    startTranscript(api, player, JESSAMINE_NPC_ID, PAGE, V_TAKE_SUPPLIES);
  }

  function handleSupplyCrates(event) {
    const { player } = event;
    const text = String(event.definition?.getInteractions?.()?.[event.clickType - 1] ?? "");
    if (!text.startsWith("Take-from")) return;
    // From the Moons on, the MoonsOfPeril plugin hands out the camps' kits.
    if (stageOf(player) >= STAGE_RITUAL || quest.isComplete(player)) return;
    event.handled = true;
    if (stageOf(player) < STAGE_TRIO) return;
    if (text.includes("Fishing")) {
      giveToolIfMissing(player, KNIFE_ITEM_ID);
      giveToolIfMissing(player, BIG_FISHING_NET_ITEM_ID);
    } else if (text.includes("Hunting")) {
      giveToolIfMissing(player, KNIFE_ITEM_ID);
      giveToolIfMissing(player, ROPE_ITEM_ID);
    } else if (text.includes("Herblore")) {
      giveToolIfMissing(player, PESTLE_AND_MORTAR_ITEM_ID);
    } else {
      giveToolIfMissing(player, KNIFE_ITEM_ID);
      giveToolIfMissing(player, BIG_FISHING_NET_ITEM_ID);
      giveToolIfMissing(player, ROPE_ITEM_ID);
      giveToolIfMissing(player, PESTLE_AND_MORTAR_ITEM_ID);
    }
    player.sendMessage("You take some supplies from the crates.");
  }

  function handleGrubbySapling(event) {
    const { player } = event;
    const option = String(event.definition?.getInteractions?.()?.[event.clickType - 1] ?? "");
    if (option !== "Collect-from") return;
    if (stageOf(player) >= STAGE_RITUAL) return; // the MoonsOfPeril plugin's from here on
    event.handled = true;
    if (guardGathering(player)) return;
    if (
      held(player, MOONLIGHT_GRUB_ITEM_ID) ||
      held(player, MOONLIGHT_GRUB_PASTE_ITEM_ID) ||
      stageOf(player) >= STAGE_RITUAL
    ) {
      return;
    }
    player.getInventory().adds(MOONLIGHT_GRUB_ITEM_ID, 1);
    player.sendMessage("You collect a moonlight grub.");
  }

  function handleLizardRock(event) {
    const { player } = event;
    const option = String(event.definition?.getInteractions?.()?.[event.clickType - 1] ?? "");
    if (option !== "Trap") return;
    event.handled = true;
    if (guardGathering(player)) return;
    const stage = stageOf(player);
    if (stage < STAGE_CAMPS || stage >= STAGE_RITUAL) return;
    if (!held(player, ROPE_ITEM_ID)) {
      player.sendMessage("You need a rope to set a trap between the rocks.");
      return;
    }
    const traps = attributeMask(player, TRAPS_ATTRIBUTE);
    if (traps >= 2) return;
    player.setAttribute(TRAPS_ATTRIBUTE, traps + 1);
    if (traps + 1 === 2) player.getPacketSender().sendVarbit(LIZARD_TRAP_VARBIT, 1);
    player.sendMessage("You set up a trap between the rocks.");
  }

  function handleLizardBush(event) {
    const { player, location } = event;
    const option = String(event.definition?.getInteractions?.()?.[event.clickType - 1] ?? "");
    if (option !== "Rustle") return;
    event.handled = true;
    if (guardGathering(player)) return;
    const stage = stageOf(player);
    if (stage < STAGE_CAMPS || stage >= STAGE_RITUAL) return;
    if (attributeMask(player, TRAPS_ATTRIBUTE) < 2) {
      player.sendMessage("You need to set a trap on two of the rocks first.");
      return;
    }
    if (held(player, RAW_MOSS_LIZARD_ITEM_ID) || held(player, MOSS_LIZARD_TAIL_ITEM_ID)) return;
    const item = new Item(RAW_MOSS_LIZARD_ITEM_ID, 1);
    api.getItemOnGroundManager().registerLocation(player, item, new Location(location.x, location.y, location.z));
    player.sendMessage("You rustle the bush and catch a moss lizard.");
  }

  function handleFishingSpot(event) {
    const { player } = event;
    const option = String(event.definition?.getInteractions?.()?.[event.clickType - 1] ?? "");
    if (option !== "Fish") return;
    const stage = stageOf(player);
    if (stage >= STAGE_RITUAL) return; // the MoonsOfPeril plugin's river fishing from here on
    event.handled = true;
    if (guardGathering(player)) return;
    if (stage < STAGE_CAMPS) return;
    if (held(player, RAW_BREAM_ITEM_ID) || held(player, BREAM_SCALES_ITEM_ID)) return;
    if (!held(player, BIG_FISHING_NET_ITEM_ID)) {
      player.sendMessage("You need a big fishing net to catch a bream.");
      return;
    }
    player.getInventory().adds(RAW_BREAM_ITEM_ID, 1);
    player.sendMessage("You catch a raw bream.");
  }

  /** The "don't touch anything yet" guard for gathering before the camps. */
  function guardGathering(player) {
    if (stageOf(player) >= STAGE_CAMPS) return false;
    startTranscript(api, player, JESSAMINE_NPC_ID, PAGE, V_GUARD_GATHER);
    return true;
  }

  // Entrances, keyed by "<objectId>:<x>:<y>:<z>" (placements from yarn dump:loc).
  const ENTRANCES = new Map([
    [`${ENTRANCE_2X2_OBJECT_ID}:1435:3129:0`, { kind: "surface" }],
    [`${ENTRANCE_2X2_OBJECT_ID}:1439:9507:1`, { kind: "cam-torum-exit" }],
    [`${ENTRANCE_2X2_OBJECT_ID}:1439:9600:1`, { kind: "ney-enter" }],
    [`${ENTRANCE_3X3_OBJECT_ID}:1439:9612:1`, { kind: "ney-exit" }],
    [`${ENTRANCE_DIAGONAL_OBJECT_ID}:1421:9613:1`, { kind: "cavern", landing: PRISON_LANDING }],
    [`${ENTRANCE_DIAGONAL_OBJECT_ID}:1421:9650:1`, { kind: "cavern", landing: EARTHBOUND_LANDING }],
    [`${ENTRANCE_DIAGONAL_OBJECT_ID}:1458:9613:1`, { kind: "cavern", landing: STREAMBOUND_LANDING }],
    [`${ENTRANCE_DIAGONAL_OBJECT_ID}:1458:9650:1`, { kind: "cavern", landing: STREAMBOUND_LANDING }],
    [`${ENTRANCE_CAVE_OBJECT_ID}:1389:9674:0`, { kind: "cavern", landing: CAVE_TO_ANTECHAMBER_LANDING }],
    [`${ENTRANCE_CAVE_OBJECT_ID}:1521:9720:0`, { kind: "cavern", landing: CAVE_TO_EARTHBOUND_LANDING }],
    [`${ENTRANCE_2X2_OBJECT_ID}:1388:9576:0`, { kind: "cavern-exit" }],
    [`${ENTRANCE_2X2_OBJECT_ID}:1388:9591:0`, { kind: "cavern-exit" }],
    [`${ENTRANCE_2X2_OBJECT_ID}:1404:9716:0`, { kind: "cavern-exit" }],
    [`${ENTRANCE_2X2_OBJECT_ID}:1480:9667:0`, { kind: "cavern-exit" }],
    [`${ENTRANCE_3X3_OBJECT_ID}:1404:9703:0`, { kind: "boss-entrance", boss: "blue", landing: BLUE_ROOM_LANDING }],
    [`${ENTRANCE_2X2_OBJECT_ID}:1388:9589:0`, { kind: "boss-entrance", boss: "blood", landing: BLOOD_ROOM_LANDING }],
    [`${ENTRANCE_2X2_OBJECT_ID}:1509:9673:0`, { kind: "boss-entrance", boss: "eclipse", landing: ECLIPSE_ROOM_LANDING }],
    // Captured tunnel gates (oploc1 51377 Pass-through; capture 1693 teleports).
    [`${ENTRANCE_3X3_OBJECT_ID}:1527:9670:0`, { kind: "tunnel", landing: { x: 1513, y: 9596, z: 0 } }],
    [`${ENTRANCE_3X3_OBJECT_ID}:1512:9560:0`, { kind: "tunnel", landing: { x: 1355, y: 9538, z: 0 } }],
  ]);

  // ==========================================================================
  // Bosses
  // ==========================================================================

  function ensureEclipseCutscene(player) {
    if (eclipseScene.has(player)) return;
    if (stageOf(player) !== STAGE_MOONS) return;
    eclipseScene.add(player);
    Scenes.controls(player, true, true);
    player.getPacketSender()
      .sendCameraMoveTo(1478, 9632, 875, { rate: 100, rate2: 100 })
      .sendCameraLookAt(1493, 9632, 750, { rate: 100, rate2: 100 });
    startTranscript(api, player, ZUMA_NPC_ID, PAGE, V_MOON_ECLIPSE_MEET);
  }

  function handleEclipseZumaLine({ player }) {
    if (!eclipseScene.has(player)) return;
    player.getPacketSender().sendCameraMoveTo(1475, 9632, 875,
      { cycles: 300, easing: "ease_in_out_sine", ignoreTerrain: true });
  }

  function handleEclipseWarnLine({ player }) {
    if (!eclipseScene.has(player)) return;
    player.getPacketSender().sendCameraMoveTo(1473, 9632, 800,
      { cycles: 200, easing: "ease_in_out_sine", ignoreTerrain: true });
  }

  function handleEclipseLeaveLine({ player }) {
    if (!eclipseScene.has(player)) return;
    player.getPacketSender()
      .sendCameraMoveTo(1469, 9632, 1200, { cycles: 90, easing: "ease_in_out_sine", ignoreTerrain: true })
      .sendCameraLookAt(1488, 9632, 0, { rate: 1, rate2: 20 });
    Scenes.later(player, 8, () => {
      if (!player.isRegistered()) return;
      eclipseScene.delete(player);
      player.getPacketSender().sendCameraReset();
      Scenes.controls(player, false);
      if (stageOf(player) === STAGE_MOONS) {
        quest.setStage(player, STAGE_MOONS + 1);
        player.setAttribute(ECLIPSE_SEEN_ATTRIBUTE, true);
      }
    });
  }

  /** Entering the real Eclipse Moon arena plays Zuma's first meeting with it. */
  function handleEclipseMoonEnter({ player }) {
    const at = player.getLocation();
    const inside = at.getX() >= ECLIPSE_MIN_X && at.getX() <= ECLIPSE_MAX_X
      && at.getY() >= ECLIPSE_MIN_Y && at.getY() <= ECLIPSE_MAX_Y && at.getZ() === 0;
    if (inside && isMoonFightActive(player)) ensureEclipseCutscene(player);
  }

  function isMoonFightActive(player) {
    const stage = stageOf(player);
    return stage >= STAGE_RITUAL && stage < STAGE_COMPLETE && stage < STAGE_MOONS_DONE;
  }

  /** The MoonsOfPeril statues let the player in while the quest needs the Moons fought. */
  function handleCanEnter(request) {
    if (!request?.player || !isMoonFightActive(request.player)) return;
    if (stageOf(request.player) === STAGE_RITUAL) quest.setStage(request.player, STAGE_MOONS);
    request.allow = true;
  }

  /** Neypotzli's camps are the MoonsOfPeril plugin's from the ritual on, Moons done included. */
  function handleCampsOpen(request) {
    if (request?.player && stageOf(request.player) >= STAGE_RITUAL) request.open = true;
  }

  function handleNpcDeath(event) {
    const npc = event.npc;
    const player = npc?.getOwner?.() ?? (event.killer?.isPlayer?.() ? event.killer : null);
    if (!player) return;
    if (event.npcId === SULPHUR_NAGUA_NPC_ID) handleNaguaDeath(player);
  }

  function handleNaguaDeath(player) {
    if (stageOf(player) !== STAGE_STARTED) return;
    removeTracked(player, "nagua");
    quest.setStage(player, STAGE_NAGUA_KILLED);
    startTranscript(api, player, ATTALA_NPC_ID, PAGE, V_KILLED_NAGUA);
  }

  const MOON_BY_KEY = {
    blood: { bit: MOON_BLOOD_BIT, variant: V_MOON_BLOOD },
    blue: { bit: MOON_BLUE_BIT, variant: V_MOON_BLUE },
    eclipse: { bit: MOON_ECLIPSE_BIT, variant: V_MOON_ECLIPSE },
  };

  /** A Moon subdued (the MoonsOfPeril plugin has already moved the player to a camp). */
  function handleMoonKilled({ player, moon: key }) {
    const moon = MOON_BY_KEY[key];
    if (!player || !moon || !isMoonFightActive(player) || moonDead(player, moon.bit)) return;
    addMaskBit(player, MOONS_ATTRIBUTE, moon.bit);
    if (allMoonsDead(player)) quest.setStage(player, STAGE_MOONS_DONE);
    startTranscript(api, player, EYATLALLI_NPC_ID, PAGE, moon.variant);
  }

  // ==========================================================================
  // Session
  // ==========================================================================

  function handleLogin({ player }) {
    migrateLegacyStage(player);
    installCampSuppliesCrate();
    syncNpcs(player);
    syncSiblingVarbits(player);
    refreshQuestList(player);
  }

  /** Old saves used 31 as completion. Do not replay their rewards. */
  function migrateLegacyStage(player) {
    const stage = stageOf(player);
    if (stage >= STAGE_COMPLETE || attributeMask(player, STAGE_SCHEMA_ATTRIBUTE) >= STAGE_SCHEMA_VERSION) return;
    if (stage === STAGE_FINISHED) {
      quest.setStage(player, STAGE_COMPLETE);
    } else if (stage > 0) {
      player.setAttribute(STAGE_SCHEMA_ATTRIBUTE, STAGE_SCHEMA_VERSION);
    }
  }

  function handleLogout({ player }) {
    if (!player) return;
    Scenes.cancel(player);
    eclipseScene.delete(player);
    removeAllTracked(player);
  }

  /** ::quest <name> reset clears the quest-owned bits and spawns. */
  function handleStageChanged({ player, key, stage }) {
    if (!player || key !== "perilous_moons" || stage !== 0) return;
    player.setAttribute(CAMPS_ATTRIBUTE, 0);
    player.setAttribute(MURALS_ATTRIBUTE, 0);
    player.setAttribute(MOONS_ATTRIBUTE, 0);
    player.setAttribute(TRIO_ATTRIBUTE, 0);
    player.setAttribute(TRAPS_ATTRIBUTE, 0);
    player.setAttribute(ECLIPSE_SEEN_ATTRIBUTE, false);
    player.setAttribute(STAGE_SCHEMA_ATTRIBUTE, 0);
    Scenes.cancel(player);
    eclipseScene.delete(player);
    player.getPacketSender().sendCameraReset();
    Scenes.controls(player, false);
    removeAllTracked(player);
    syncSiblingVarbits(player);
  }

  // ==========================================================================
  // Journal and rewards
  // ==========================================================================

  function campJournalLine(player, site) {
    return (campMask(player) & site.bit) !== 0
      ? `<str>${site.name}</str>`
      : `I still need to establish a camp in the <col=800000>${site.name}</col>.`;
  }

  function moonJournalLine(player, label, bit) {
    return moonDead(player, bit)
      ? `<str>${label}</str>`
      : `I still need to face the <col=800000>${label}</col>.`;
  }

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    const history = [
      "<str>I spoke to Zuma and Attala at the entrance to Cam Torum about the Ruins</str>",
      "<str>beneath the city. A Creature escaped from them, and Attala let me into the</str>",
      "<str>city once I had dealt with it.</str>",
    ];
    if (stage >= STAGE_COMPLETE) {
      return [
        ...history,
        "<str>I joined Jessamine's expedition into Neypotzli, helped build the camps and</str>",
        "<str>had the talismans enchanted and infused.</str>",
        "<str>I gathered the ritual items and distracted all three Moons of Peril while</str>",
        "<str>Eyatlalli repaired the seal.</str>",
        "",
        "<col=ff0000>QUEST COMPLETE!</col>",
      ];
    }
    if (stage >= STAGE_FINISHED) {
      return [
        ...history,
        "<str>I gathered the ritual items and distracted all three Moons of Peril while</str>",
        "<str>Eyatlalli repaired the seal.</str>",
        "",
        "I should finish speaking to <col=800000>Eyatlalli</col>.",
      ];
    }
    if (stage >= STAGE_MOONS_DONE) {
      return [
        ...history,
        "<str>I gathered the ritual items and distracted all three Moons of Peril while</str>",
        "<str>Eyatlalli repaired the seal.</str>",
        "",
        "I should return to the antechamber and speak to Jessamine and Zuma,",
        "then to <col=800000>Eyatlalli</col>.",
      ];
    }
    if (stage >= STAGE_RITUAL) {
      return [
        ...history,
        "<str>Eyatlalli started the ritual and asked me to distract the Moons of Peril.</str>",
        "",
        moonJournalLine(player, "The Blood Moon", MOON_BLOOD_BIT),
        moonJournalLine(player, "The Blue Moon", MOON_BLUE_BIT),
        moonJournalLine(player, "The Eclipse Moon", MOON_ECLIPSE_BIT),
      ];
    }
    if (stage >= STAGE_GATHER) {
      return [
        ...history,
        "<str>Zuma disturbed the seal and Eyatlalli asked me to gather ritual items.</str>",
        "",
        held(player, BREAM_SCALES_ITEM_ID)
          ? "<str>Bream Scales</str>"
          : "I need <col=800000>Bream Scales</col> from a raw bream.",
        held(player, MOSS_LIZARD_TAIL_ITEM_ID)
          ? "<str>Moss Lizard Tail</str>"
          : "I need a <col=800000>Moss Lizard Tail</col> from a moss lizard.",
        held(player, MOONLIGHT_GRUB_PASTE_ITEM_ID)
          ? "<str>Moonlight Grub Paste</str>"
          : "I need <col=800000>Moonlight Grub Paste</col> from a moonlight grub.",
      ];
    }
    if (stage >= STAGE_EYAT_FOUND) {
      return [
        ...history,
        "<str>I used the talismans and found a nagua named Eyatlalli.</str>",
        "",
        "I should return to the Neypotzli Antechamber and see what happened.",
      ];
    }
    if (stage >= STAGE_LOCATE) {
      return [
        ...history,
        "<str>The blacksmith infused the talismans.</str>",
        "",
        "I should use the infused talismans to find the source of power in Neypotzli.",
      ];
    }
    if (stage >= STAGE_INFUSED) {
      return [
        ...history,
        "<str>Nahta enchanted the talismans.</str>",
        "",
        "I should return to Neypotzli and speak to <col=800000>Attala</col>.",
      ];
    }
    if (stage >= STAGE_ENCHANTED) {
      return [
        ...history,
        "",
        "I should take the enchanted talismans to the <col=800000>blacksmith</col>",
        "in Cam Torum's forge.",
      ];
    }
    if (stage >= STAGE_TALISMANS) {
      return [
        ...history,
        "",
        "I should take the talismans to <col=800000>Nahta</col> in Cam Torum's",
        "magic shop and tell him Attala sent me.",
      ];
    }
    if (stage >= STAGE_CAMPS_DONE) {
      return [
        ...history,
        "",
        "I established camps in all three caverns. I should see what",
        "<col=800000>Jessamine</col> has worked out about the inscription.",
      ];
    }
    if (stage >= STAGE_CAMPS) {
      return [
        ...history,
        "<str>Inside the Ruins, Jessamine asked me to establish camps while she works.</str>",
        "",
        ...CAMP_SITES.map((site) => campJournalLine(player, site)),
      ];
    }
    if (stage >= STAGE_TRIO) {
      return [
        ...history,
        "",
        "I entered the Ruins below Cam Torum. I should talk to",
        "<col=800000>Attala</col>, <col=800000>Zuma</col> and <col=800000>Jessamine</col> inside.",
      ];
    }
    if (stage >= STAGE_IN_NEY) {
      return [
        ...history,
        "",
        "Jessamine invited me to join the expedition. When I am ready I can",
        "enter the Ruins in the north of the city.",
      ];
    }
    if (stage >= STAGE_IN_CITY) {
      return [
        ...history,
        "",
        "I was granted access to Cam Torum. I should speak to",
        "<col=800000>Jessamine</col> in the north of the city.",
      ];
    }
    if (stage >= STAGE_NAGUA_KILLED) {
      return [
        ...history,
        "<str>I dealt with the Creature that had escaped from the Ruins.</str>",
        "",
        "I should return to <col=800000>Attala</col> and let her know.",
      ];
    }
    if (stage >= STAGE_STARTED) {
      return [
        "<str>I spoke to Zuma and Attala at the entrance to Cam Torum. A Creature</str>",
        "<str>escaped from the Ruins beneath the city and Attala asked me to deal with it.</str>",
        "",
        "I can find it by the <col=800000>mountain outflow spring</col>, north east of the",
        "city entrance.",
      ];
    }
    return [
      "I can start this quest by talking to <col=800000>Zuma</col> and",
      "<col=800000>Attala</col> at the entrance to Cam Torum.",
    ];
  }

  function grantReward(player) {
    const skills = player.getSkillManager();
    skills.addExperiences(Skill.SLAYER, 40000);
    skills.addExperiences(Skill.RUNECRAFTING, 5000);
    skills.addExperiences(Skill.HUNTER, 5000);
    skills.addExperiences(Skill.FISHING, 5000);
  }

  // ==========================================================================
  // Registration
  // ==========================================================================

  api.persistAttribute(CAMPS_ATTRIBUTE);
  api.persistAttribute(MURALS_ATTRIBUTE);
  api.persistAttribute(MOONS_ATTRIBUTE);
  api.persistAttribute(TRIO_ATTRIBUTE);
  api.persistAttribute(TRAPS_ATTRIBUTE);
  api.persistAttribute(ECLIPSE_SEEN_ATTRIBUTE);
  api.persistAttribute(STAGE_SCHEMA_ATTRIBUTE, 0);

  quest = registerQuest(api, {
    key: "perilous_moons",
    name: "Perilous Moons",
    varpId: PMOON_VARP,
    varbitId: PMOON_QUEST_VARBIT,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 2,
    xpRewards: [
      { skillId: Skill.SLAYER.getIndex(), amount: 40000, label: "Slayer" },
      { skillId: Skill.RUNECRAFTING.getIndex(), amount: 5000, label: "Runecraft" },
      { skillId: Skill.HUNTER.getIndex(), amount: 5000, label: "Hunter" },
      { skillId: Skill.FISHING.getIndex(), amount: 5000, label: "Fishing" },
    ],
    otherRewards: [
      "Access to Neypotzli and the Moons of Peril",
      "The ability to be assigned lesser nagua as a Slayer task",
    ],
    buildJournal,
    onReward: grantReward,
  });

  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onCustomEvent("npc-dialogue:line", handleLine);
  api.onCustomEvent("quest:stage-changed", handleStageChanged);
  api.onItemAction(handleItemAction);
  api.onItemOnNpc(handleItemOnNpc);
  api.onItemOnItem(handleItemOnItem);
  api.onItemOnObject(handleItemOnObject, { noted: false });
  api.onObjectInteraction(handleObjectInteraction);
  api.onNpcDeath(handleNpcDeath);
  api.onZoneEnter(ECLIPSE_MOON_ZONE, handleEclipseMoonEnter);
  api.onCustomEvent("moons-of-peril:can-enter", handleCanEnter);
  api.onCustomEvent("moons-of-peril:killed", handleMoonKilled);
  api.onCustomEvent("moons-of-peril:camps-open", handleCampsOpen);
  api.onPlayerLogin(handleLogin);
  api.onPlayerLogout(handleLogout);
};
