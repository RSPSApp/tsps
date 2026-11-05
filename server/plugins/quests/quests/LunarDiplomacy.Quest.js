/**
 * Lunar Diplomacy (members).
 *
 * The words come from the "Lunar Diplomacy" transcript page (every variant played
 * is one of its named variants); this plugin supplies the variant selector for the
 * Rellekka/Lady Zay/Moon Clan NPCs, the prose-condition answers, the item chain
 * (seal, emerald lantern, waking sleep potion, lunar staff, lunar clothes, ring),
 * the jinx-symbol search, the ceremonial brazier entry and the Dream World
 * challenges and final fight.
 *
 * Stage varbit 2448 "lunar_quest_main" (varp 823 bits 0-19). Evidence: the quest
 * DB row 88 ("Lunar Diplomacy") stores completion 190 (col 19) and 2 quest points
 * (col 17); the cache NPC transforms on this varbit switch Lokar 3854 -> 6648
 * below 30 / 3855 at 30+, Bentley 3857 -> 6649 below 125 / 6650 at 125+, and hide
 * the cabin-boy placeholder 6162 outside the values 0,10,20,30,40,45,50,60,70,80,
 * 90,100,110,112,114,116,118,120,125. So the real quest values are exactly those
 * (symbols advance by 2). Values chosen for the rest follow the same scheme:
 *   0 not started, 10 started (Lokar sent to Brundt), 20 seal obtained, 30 sailed
 *   to Pirates' Cove, 40 circled the island, 45 asked Jack at the captain's
 *   suggestion, 50 blamed the navigator, 60 Jack revealed the jinx, 70 Shultz
 *   explained a Moon Clan jinx, 80 Beefy revealed the feast, 90 Lee saw Davey-boy
 *   leave, 100 Davey-boy revealed the cabin boy, 110 cabin boy confessed and gave
 *   the lens/frame, 112/114/116/118/120 one to five symbols rubbed out, 125
 *   arrived Lunar Isle, 130 Oneiromancer asked for the potion, 140 potion handed
 *   over (staff task), 150 lunar staff handed over (clothes task), 155 all eight
 *   clothes handed over and kindling received, 160 in the Dream World, 165 final
 *   challenge accepted (Me spawned), 170 Me defeated, 175 awake on Lunar Isle,
 *   190 complete.
 *
 * Sibling state mirrored to the varp 823-828 varbits the cache reads:
 *  2431-2435 lunar_quest_symbolpres1-5 (set 2 as each symbol is rubbed out),
 *  2436-2443 lunar_pt2_oneiro_given_* (item handed to the Oneiromancer),
 *  2444-2447 lunar_monk_cape/ring/amulet/tanclothes_intro (hint heard),
 *  2405 lunar_emote_prog, 2406 lunar_num_prog, 2407 lunar_tree_prog,
 *  2408 lunar_floor_prog, 2409 lunar_skill_prog, 2410 lunar_dice_prog,
 *  2416 lunar_num_intro, 2418 lunar_tree_intro, 2424 lunar_skill_intro,
 *  2429 lunar_spoken_centre and 2430 lunar_brazier_lit (the town brazier
 *  multiloc 17025, shared with Dream Mentor).
 *
 * Rewards per the OSRS Wiki: 2 Quest points, 5,000 Magic and 5,000 Runecraft XP,
 * 50 astral runes, the Seal of Passage, Lunar equipment and Lunar spellbook
 * access.
 *
 * Sources: OSRS Wiki "Lunar Diplomacy", its Quick guide and Transcript page; the
 * cache for every id (lookup-gameval.ts, placed-object scans for the mines, ships,
 * Dream World and the town brazier).
 *
 * Gaps / approximations:
 *  - Minigames are chatbox/dialogue driven, not simulated: the woodcutting race,
 *    the hurdle race, the dice game, the number sequences, the memory path and
 *    the emote mimic complete after the transcript conversation (documented per
 *    NPC); no dream puff/platform/dice/number object is stepped on.
 *  - The Dream World NPCs are spawned owner-only on the z=2 map where the dream
 *    scenery actually sits; the static z=0 Ethereal spawns in npc-spawns.json are
 *    never reachable from the entry. The spring platforms ferry between the
 *    centre island and each challenge island (and back), but no dream puff or
 *    dice/number object is stepped on.
 *  - npc-spawns.json has Baba Yaga at (2450,4647) instead of her chicken house
 *    (2088,3931) and has no Lady Zay navigator (3861) at all, so the quest spawns
 *    owner-only copies of both for the player while it is running (one navigator
 *    per ship, moved to the Lunar Isle deck at stage 125).
 *  - Me is a normal owner-only spawn beside the central island rather than a
 *    scripted arena fight; the lectern teleports back to Lunar Isle.
 *  - The Lunar Isle mine stalagmites are mined directly (no Mining XP/level roll);
 *    lunar bars are smithed on any anvil with a hammer, no Smithing interface.
 *  - Suqah leather is crafted through a chatbox menu with a needle; thread is not
 *    consumed. Hides/tiara/tooth still come from the existing Suqah drop table.
 *  - The Pirate's Cove jinx symbols can be rubbed from any cannon/wallchart/chest/
 *    support/crate on either ship deck, one symbol per object; the wiki's exact
 *    five tiles are not enforced.
 *  - The "no Seal of Passage" teleport-off-Lunar-Isle rule, the boat cutscenes and
 *    the town-entry cutscene are not played. The Astral Altar's permission
 *    refusals and its post-quest Lunar/Standard spellbook toggle are handled.
 *  - Crew members the wiki gives no "before setting sail" variant fall back to
 *    their "after sailing in a circle" lines while the ship is still at
 *    Pirates' Cove.
 *  - The emerald lantern can be lit with a tinderbox straight from the frame
 *    (the wiki's unlit-lantern oil step is not simulated), and Baba Yaga's
 *    "anything to trade" menu action opens no shop.
 *  - Baba Yaga's/Meteora's/Selene's alternative topics and the full replacement
 *    item flow are reachable but not every alt line is exercised.
 */
module.exports = function registerLunarDiplomacyQuest(api) {
  const {
    Animation,
    Equipment,
    ItemDefinition,
    ItemIdentifiers,
    Location,
    MagicSpellbook,
    NpcIdentifiers,
    ObjectDefinition,
    ObjectIdentifiers,
    RegionManager,
    Skill,
    Sound,
    Sounds,
  } = api.core;
  const { registerQuest, startTranscript, loadTranscripts } = require("../QuestRuntime");

  const PAGE = "Lunar Diplomacy";
  const START_HOOK = "quest:lunar-diplomacy:start";
  const PRAY_AT_ALTAR_ANIMATION = new Animation(645);
  const LUNAR_SPELLS_ACTIVATED = "Lunar spells activated!";
  const LUNAR_SPELLS_DEACTIVATED = "Lunar spells deactivated!";
  // npc-drops.json gates A special tiara on this Wiki quest condition. The row is
  // only eligible after Meteora has explained her headgear.
  const TIARA_DROP_QUEST_KEY = "quest_lunardiplomacyafteraskingmeteoraaboutherheadgear";

  // ==========================================================================
  // Stages and varbits
  // ==========================================================================

  const VARBIT_STAGE = 2448; // lunar_quest_main, varp 823 bits 0-19
  const SYMBOL_VARBITS = [2431, 2432, 2433, 2434, 2435]; // lunar_quest_symbolpres1-5
  const VARBIT_GIVEN_HELM = 2436;
  const VARBIT_GIVEN_CAPE = 2437;
  const VARBIT_GIVEN_AMULET = 2438;
  const VARBIT_GIVEN_TORSO = 2439;
  const VARBIT_GIVEN_GLOVES = 2440;
  const VARBIT_GIVEN_BOOTS = 2441;
  const VARBIT_GIVEN_TROUSERS = 2442;
  const VARBIT_GIVEN_RING = 2443;
  const VARBIT_MONK_CAPE = 2444;
  const VARBIT_MONK_RING = 2445;
  const VARBIT_MONK_AMULET = 2446;
  const VARBIT_MONK_TANCLOTHES = 2447;
  const VARBIT_EMOTE_PROG = 2405;
  const VARBIT_NUM_PROG = 2406;
  const VARBIT_TREE_PROG = 2407;
  const VARBIT_FLOOR_PROG = 2408;
  const VARBIT_SKILL_PROG = 2409;
  const VARBIT_DICE_PROG = 2410;
  const VARBIT_NUM_INTRO = 2416;
  const VARBIT_TREE_INTRO = 2418;
  const VARBIT_SKILL_INTRO = 2424;
  const VARBIT_SPOKEN_CENTRE = 2429;
  const VARBIT_BRAZIER_LIT = 2430; // shared with Dream Mentor

  const STAGE_STARTED = 10;
  const STAGE_SEAL = 20;
  const STAGE_SAILED = 30;
  const STAGE_CIRCLED = 40;
  const STAGE_JACK_HINT = 45;
  const STAGE_NAVIGATOR = 50;
  const STAGE_JINX = 60;
  const STAGE_SHULTZ_LESSON = 70;
  const STAGE_FEAST = 80;
  const STAGE_SUSPECT_MATE = 90;
  const STAGE_SUSPECT_BOY = 100;
  const STAGE_SYMBOLS = 110;
  const STAGE_SYMBOLS_DONE = 120;
  const STAGE_LUNAR_ISLE = 125;
  const STAGE_POTION_TASK = 130;
  const STAGE_POTION_GIVEN = 140;
  const STAGE_STAFF_GIVEN = 150;
  const STAGE_KINDLING = 155;
  const STAGE_DREAM = 160;
  const STAGE_FIGHT = 165;
  const STAGE_DEFEATED = 170;
  const STAGE_AWAKE = 175;
  const STAGE_COMPLETE = 190;

  /** Hands an ordinary crossing to the Ferries plugin's captured trip; without it, the plain move. */
  function ferry(player, route, fallback) {
    const request = { player, route, handled: false };
    api.emitCustomEvent("ferries:travel", request);
    if (!request.handled) player.moveTo(fallback);
  }

  // ==========================================================================
  // Ids
  // ==========================================================================

  // NPC placeholders (nameless cache ids resolved through varbit 2448 transforms).
  const LOKAR_PLACEHOLDER = 3854; // -> 6648/3855
  const BENTLEY_PLACEHOLDER = 3857; // -> 6649/6650
  const CABIN_BOY_PLACEHOLDER = 6162; // -> 3856

  const LOKAR_IDS = new Set([
    NpcIdentifiers.LOKAR_SEARUNNER, // 3855
    NpcIdentifiers.LOKAR_SEARUNNER_2, // 6648
    NpcIdentifiers.LOKAR_SEARUNNER_3, // 9306
    LOKAR_PLACEHOLDER,
  ]);
  // Brundt spawns without a NpcIdentifiers constant: nameless transform parents on
  // varbit 9459 (the Rellekka longhall, the Fremennik Exiles meeting place and the
  // Island of Stone). npc-dialogue-index.json lists only their resolved child ids.
  const BRUNDT_LONGHALL_SPAWN = 3926;
  const BRUNDT_EXILE_SPAWN = 7318;
  const BRUNDT_ISLAND_SPAWN = 9269;
  const BRUNDT_IDS = new Set([
    NpcIdentifiers.BRUNDT_THE_CHIEFTAIN, // 8048
    NpcIdentifiers.BRUNDT_THE_CHIEFTAIN_2, // 8145
    NpcIdentifiers.BRUNDT_THE_CHIEFTAIN_3, // 8153
    NpcIdentifiers.BRUNDT_THE_CHIEFTAIN_4, // 8161
    NpcIdentifiers.BRUNDT_THE_CHIEFTAIN_5, // 8169
    NpcIdentifiers.BRUNDT_THE_CHIEFTAIN_6, // 9263
    NpcIdentifiers.BRUNDT_THE_CHIEFTAIN_7, // 9265
    NpcIdentifiers.BRUNDT_THE_CHIEFTAIN_8, // 9266
    NpcIdentifiers.BRUNDT_THE_CHIEFTAIN_9, // 9267
    NpcIdentifiers.BRUNDT_THE_CHIEFTAIN_10, // 9268
    NpcIdentifiers.BRUNDT_THE_CHIEFTAIN_11, // 9278
    NpcIdentifiers.BRUNDT_THE_CHIEFTAIN_12, // 9279
    BRUNDT_LONGHALL_SPAWN,
    BRUNDT_EXILE_SPAWN,
    BRUNDT_ISLAND_SPAWN,
  ]);
  const BENTLEY_IDS = new Set([
    NpcIdentifiers.CAPTAIN_BENTLEY, // 6649
    NpcIdentifiers.CAPTAIN_BENTLEY_2, // 6650
    BENTLEY_PLACEHOLDER,
  ]);
  const JACK_SHIP = NpcIdentifiers.BIRDS_EYE_JACK_2; // 3861, Lady Zay navigator
  const CABIN_BOY_IDS = new Set([NpcIdentifiers.CABIN_BOY, CABIN_BOY_PLACEHOLDER]); // 3856

  const CREW_SLUGS = new Map([
    [NpcIdentifiers.CABIN_BOY, "cabin-boy"], // 3856
    [NpcIdentifiers.BEEFY_BURNS, "beefy-burns"], // 3858
    [NpcIdentifiers.EAGLE_EYE_SHULTZ, "eagle-eye-shultz"], // 3859
    [NpcIdentifiers.FIRST_MATE_DAVEY_BOY, "first-mate-davey-boy"], // 3860
    [JACK_SHIP, "birds-eye-jack"],
    [NpcIdentifiers.PICARRON_PETE, "picarron-pete"], // 3862
    [NpcIdentifiers.BEDREAD_THE_BOLD, "bedread-the-bold"], // 3864
    [NpcIdentifiers.TOMMY_2_TIMES, "tommy-2-times"], // 3866
    [NpcIdentifiers.MURKY_PAT, "murky-pat"], // 3867
    [NpcIdentifiers.JACK_SAILS, "jack-sails"], // 3868
    [NpcIdentifiers.BETTY_B_BOPPIN, "betty-b-boppin"], // 3870
    [NpcIdentifiers.BEEDY_EYE_JONES, "beedy-eye-jones"], // 3871
    [NpcIdentifiers.JENNY_BLADE, "jenny-blade"], // 3872
    [NpcIdentifiers.LECHEROUS_LEE, "lecherous-lee"], // 3873
    [NpcIdentifiers.STICKY_SANDERS, "sticky-sanders"], // 3874
  ]);

  const ONEIROMANCER_IDS = new Set([
    NpcIdentifiers.ONEIROMANCER, // 3835
    NpcIdentifiers.ONEIROMANCER_2, // 8049
    NpcIdentifiers.ONEIROMANCER_3, // 8158
    NpcIdentifiers.ONEIROMANCER_4, // 8166
    NpcIdentifiers.ONEIROMANCER_5, // 8174
  ]);
  const BABA_YAGA_ID = NpcIdentifiers.BABA_YAGA; // 3837
  const PAULINE_ID = NpcIdentifiers.PAULINE_POLARIS; // 3838
  const METEORA_ID = NpcIdentifiers.METEORA; // 3839
  const SELENE_ID = NpcIdentifiers.SELENE; // 3841
  const RIMAE_ID = NpcIdentifiers.RIMAE_SIRSALIS; // 3842

  const ETHEREAL_BEING_IDS = new Set([NpcIdentifiers.ETHEREAL_BEING, NpcIdentifiers.ETHEREAL_BEING_2]); // 777/778
  const ETHEREAL_NUMERATOR_ID = NpcIdentifiers.ETHEREAL_NUMERATOR; // 779
  const ETHEREAL_EXPERT_ID = NpcIdentifiers.ETHEREAL_EXPERT; // 780
  const ETHEREAL_PERCEPTIVE_ID = NpcIdentifiers.ETHEREAL_PERCEPTIVE; // 781
  const ETHEREAL_GUIDE_ID = NpcIdentifiers.ETHEREAL_GUIDE; // 782
  const ETHEREAL_FLUKE_ID = NpcIdentifiers.ETHEREAL_FLUKE; // 783
  const ETHEREAL_MIMIC_ID = NpcIdentifiers.ETHEREAL_MIMIC; // 784
  const ME_IDS = new Set([NpcIdentifiers.ME, NpcIdentifiers.ME_2]); // 785/786
  const SUQAH_IDS = new Set([
    NpcIdentifiers.SUQAH, // 787
    NpcIdentifiers.SUQAH_2, // 788
    NpcIdentifiers.SUQAH_3, // 789
    NpcIdentifiers.SUQAH_4, // 790
    NpcIdentifiers.SUQAH_5, // 791
    NpcIdentifiers.SUQAH_6, // 792
    NpcIdentifiers.SUQAH_7, // 793
  ]);

  const SEAL_OF_PASSAGE = ItemIdentifiers.SEAL_OF_PASSAGE; // 9083
  const EMERALD_LENS = ItemIdentifiers.EMERALD_LENS; // 9066
  const EMERALD_LANTERN = ItemIdentifiers.EMERALD_LANTERN; // 9064, unlit
  const EMERALD_LANTERN_LIT = ItemIdentifiers.EMERALD_LANTERN_2; // 9065, lit
  const LANTERN_FRAME = ItemIdentifiers.BULLSEYE_LANTERN_EMPTY_; // 4546
  const LANTERN_IDS = new Set([
    ItemIdentifiers.BULLSEYE_LANTERN_UNF_, // 4544
    ItemIdentifiers.BULLSEYE_LANTERN_UNF__2, // 4545
    LANTERN_FRAME, // 4546
    ItemIdentifiers.BULLSEYE_LANTERN_EMPTY__2, // 4547
    ItemIdentifiers.BULLSEYE_LANTERN, // 4548
    ItemIdentifiers.BULLSEYE_LANTERN_2, // 4549
    ItemIdentifiers.BULLSEYE_LANTERN_3, // 4550
  ]);
  const LUNAR_VIAL_EMPTY = ItemIdentifiers.EMPTY_VIAL; // 9085
  const LUNAR_VIAL_WATER = ItemIdentifiers.VIAL_OF_WATER_3; // 9086
  const WAKING_SLEEP_VIAL = ItemIdentifiers.WAKING_SLEEP_VIAL; // 9087
  const GUAM_VIAL = ItemIdentifiers.GUAM_VIAL; // 9088
  const MARR_VIAL = ItemIdentifiers.MARR_VIAL; // 9089
  const GUAM_MARR_VIAL = ItemIdentifiers.GUAM_MARR_VIAL; // 9090
  const SUQAH_TOOTH = ItemIdentifiers.SUQAH_TOOTH; // 9079
  const SUQAH_HIDE = ItemIdentifiers.SUQAH_HIDE; // 9080
  const SUQAH_LEATHER = ItemIdentifiers.SUQAH_LEATHER; // 9081
  const GROUND_TOOTH = ItemIdentifiers.GROUND_TOOTH; // 9082
  const KINDLING = ItemIdentifiers.KINDLING; // 9094
  const SOAKED_KINDLING = ItemIdentifiers.SOAKED_KINDLING; // 9095
  const LUNAR_STAFF_PT1 = ItemIdentifiers.LUNAR_STAFF_PT1; // 9091
  const LUNAR_STAFF_PT2 = ItemIdentifiers.LUNAR_STAFF_PT2; // 9092
  const LUNAR_STAFF_PT3 = ItemIdentifiers.LUNAR_STAFF_PT3; // 9093
  const LUNAR_STAFF = ItemIdentifiers.LUNAR_STAFF; // 9084
  const LUNAR_ORE = ItemIdentifiers.LUNAR_ORE; // 9076
  const LUNAR_BAR = ItemIdentifiers.LUNAR_BAR; // 9077
  const SPECIAL_TIARA = ItemIdentifiers.A_SPECIAL_TIARA; // 9103
  const LUNAR_HELM = ItemIdentifiers.LUNAR_HELM; // 9096
  const LUNAR_TORSO = ItemIdentifiers.LUNAR_TORSO; // 9097
  const LUNAR_LEGS = ItemIdentifiers.LUNAR_LEGS; // 9098
  const LUNAR_GLOVES = ItemIdentifiers.LUNAR_GLOVES; // 9099
  const LUNAR_BOOTS = ItemIdentifiers.LUNAR_BOOTS; // 9100
  const LUNAR_CAPE = ItemIdentifiers.LUNAR_CAPE; // 9101
  const LUNAR_AMULET = ItemIdentifiers.LUNAR_AMULET; // 9102
  const LUNAR_RING = ItemIdentifiers.LUNAR_RING; // 9104
  const DRAMEN_STAFF = ItemIdentifiers.DRAMEN_STAFF; // 772
  const GUAM_LEAF = ItemIdentifiers.GUAM_LEAF; // 249
  const MARRENTILL = ItemIdentifiers.MARRENTILL; // 251
  const PESTLE_AND_MORTAR = ItemIdentifiers.PESTLE_AND_MORTAR; // 233
  const NEEDLE = ItemIdentifiers.NEEDLE; // 1733
  const THREAD = ItemIdentifiers.THREAD; // 1734
  const TINDERBOX = ItemIdentifiers.TINDERBOX; // 590
  const HAMMER = ItemIdentifiers.HAMMER; // 2347
  const SPADE = ItemIdentifiers.SPADE; // 952
  const COINS = ItemIdentifiers.COINS; // 995
  const BRONZE_AXE = ItemIdentifiers.BRONZE_AXE; // 1351
  const ASTRAL_RUNE = ItemIdentifiers.ASTRAL_RUNE; // 9075

  const STALAGMITE_IDS = new Set([
    ObjectIdentifiers.STALAGMITES_9, // 15250
    ObjectIdentifiers.STALAGMITE_11, // 15251
  ]);
  const CEREMONIAL_BRAZIER_MULTILOC = 17025; // nameless varbit-2430 multiloc -> 16810/16811
  const CEREMONIAL_BRAZIER_UNLIT = ObjectIdentifiers.CEREMONIAL_BRAZIER_3; // 16810
  const CEREMONIAL_BRAZIER_LIT = ObjectIdentifiers.CEREMONIAL_BRAZIER_4; // 16811
  const CEREMONIAL_BRAZIER_IDS = new Set([
    CEREMONIAL_BRAZIER_MULTILOC,
    CEREMONIAL_BRAZIER_UNLIT,
    CEREMONIAL_BRAZIER_LIT,
    ObjectIdentifiers.CEREMONIAL_BRAZIER, // 16808
    ObjectIdentifiers.CEREMONIAL_BRAZIER_2, // 16809
  ]);
  // The Astral Altar is on the surface, not behind a talisman: the quest grants
  // Craft-rune and Pray permission, and Pray toggles the Lunar spellbook.
  const ASTRAL_ALTAR = ObjectIdentifiers.ALTAR_57; // 34771
  const MY_LIFE = ObjectIdentifiers.MY_LIFE; // 16599
  const RING_FLOWERS = ObjectIdentifiers.FLOWERS_4; // 1196, the blue bloom at 2090,3877
  const WATER_SOURCE = ObjectIdentifiers.WATER_SOURCE; // 14998
  const SINK_IDS = new Set([ObjectIdentifiers.SINK_18, ObjectIdentifiers.SINK_19]); // 16704/16705
  const AIR_ALTAR = ObjectIdentifiers.ALTAR_33;
  const WATER_ALTAR = ObjectIdentifiers.ALTAR_35;
  const EARTH_ALTAR = ObjectIdentifiers.ALTAR_36;
  const FIRE_ALTAR = ObjectIdentifiers.ALTAR_37;
  const CANNON_IDS = new Set([ObjectIdentifiers.CANNON_9, ObjectIdentifiers.CANNON_10]); // 16938/16939
  const SUPPORT_ID = ObjectIdentifiers.SUPPORT; // 16941
  const WALLCHART_ID = ObjectIdentifiers.WALLCHART; // 16975
  const CHEST_ID = ObjectIdentifiers.CHEST_62; // 16891
  const CRATE_IDS = new Set([
    ObjectIdentifiers.CRATE_144, // 16862
    ObjectIdentifiers.CRATE_145, // 16863
    ObjectIdentifiers.CRATE_147, // 16865
  ]);
  const SYMBOL_OBJECT_IDS = new Set([...CANNON_IDS, SUPPORT_ID, WALLCHART_ID, CHEST_ID, ...CRATE_IDS]);

  const RELLEKKA_DOCK = new Location(2620, 3693, 0);
  const PIRATES_COVE_DOCKS = new Location(2213, 3795, 0);
  const LUNAR_ISLE_DOCKS = new Location(2118, 3894, 0);
  const DREAM_ENTRY = new Location(1761, 5090, 2);
  const DREAM_EXIT = new Location(2149, 3869, 0);
  const RING_TILE = { x: 2090, y: 3877 };
  const BABA_HOUSE = { x: 2088, y: 3931 };
  const JACK_COVE_TILE = { x: 2224, y: 3790 };
  const JACK_LUNAR_TILE = { x: 2140, y: 3899 };
  const SHIP_BOXES = [
    { x0: 2130, y0: 3884, x1: 2150, y1: 3920 }, // Lady Zay at Lunar Isle
    { x0: 2205, y0: 3780, x1: 2235, y1: 3820 }, // Lady Zay at Pirates' Cove
  ];
  // The galleon's deck (z2) and forecastle (z3) stairs; the captured loc-teleport
  // rows only cover z1<->z2, so the quest claims these two ids.
  const SHIP_STAIRS_BOTTOM = ObjectIdentifiers.STAIRS_62; // 16945, deck -> forecastle
  const SHIP_STAIRS_TOP = ObjectIdentifiers.STAIRS_64; // 16947, forecastle -> deck
  // Land on the side the pairing stair leaves open before the far edges: on the cove
  // galleon the down stair sits one tile south of the up stair, so the forecastle
  // landing is two tiles south ([0,-2]); the tile north ([0,1]) is a shelf the walls
  // cut off from the crew and the way back down.
  const STAIR_LANDING_STEPS = [[0, -1], [0, -2], [0, 1], [0, 2], [1, 0], [-1, 0]];
  // World Bentley (3857) and Davey-boy (3860) spawns wander with the default radius
  // 5 onto bow tiles with no walk route from the deck; pin each to its deck spawn.
  const PINNED_CREW = new Map([
    [BENTLEY_PLACEHOLDER, { cove: { x: 2222, y: 3796 }, lunar: { x: 2138, y: 3899 } }],
    [NpcIdentifiers.FIRST_MATE_DAVEY_BOY, { cove: { x: 2225, y: 3788 }, lunar: { x: 2141, y: 3891 } }],
  ]);
  const DREAM_BOX = { x0: 1690, y0: 5030, x1: 1860, y1: 5180 };
  const DREAM_NPC_SPAWNS = [
    { id: NpcIdentifiers.ETHEREAL_BEING, x: 1762, y: 5089 }, // 777
    { id: ETHEREAL_NUMERATOR_ID, x: 1786, y: 5066 },
    { id: ETHEREAL_EXPERT_ID, x: 1787, y: 5079 },
    { id: ETHEREAL_PERCEPTIVE_ID, x: 1765, y: 5112 },
    { id: ETHEREAL_GUIDE_ID, x: 1734, y: 5111 },
    { id: ETHEREAL_FLUKE_ID, x: 1737, y: 5068 },
    { id: ETHEREAL_MIMIC_ID, x: 1770, y: 5070 },
  ];
  const ME_TILE = { x: 1764, y: 5092 };
  const DREAM_CENTRE = { x: 1760, y: 5088 };
  const DREAM_PLATFORM_IDS = new Set([
    ObjectIdentifiers.PLATFORM_11, // 16632
    ObjectIdentifiers.PLATFORM_12, // 16633
    ObjectIdentifiers.PLATFORM_13, // 16634
    ObjectIdentifiers.PLATFORM_14, // 16635
    ObjectIdentifiers.PLATFORM_15, // 16636
    ObjectIdentifiers.PLATFORM_16, // 16637
  ]);
  // Platform tile -> challenge island stand tile (two tiles in front of the NPC).
  const DREAM_PLATFORM_LINKS = [
    { x: 1751, y: 5080, tx: 1737, ty: 5066 }, // Fluke
    { x: 1751, y: 5095, tx: 1734, ty: 5109 }, // Guide
    { x: 1764, y: 5098, tx: 1765, ty: 5110 }, // Perceptive
    { x: 1765, y: 5079, tx: 1770, ty: 5068 }, // Mimic
    { x: 1768, y: 5080, tx: 1786, ty: 5064 }, // Numerator
    { x: 1770, y: 5088, tx: 1787, ty: 5077 }, // Expert
    { x: 1773, y: 5070, tx: 1786, ty: 5064 }, // Numerator
  ];

  const DREAM_SPAWN_IDS = new Set([...DREAM_NPC_SPAWNS.map((n) => n.id), ...ME_IDS]);

  const CEREMONIAL_SLOTS = [
    [Equipment.HEAD_SLOT, LUNAR_HELM],
    [Equipment.CAPE_SLOT, LUNAR_CAPE],
    [Equipment.AMULET_SLOT, LUNAR_AMULET],
    [Equipment.WEAPON_SLOT, LUNAR_STAFF],
    [Equipment.BODY_SLOT, LUNAR_TORSO],
    [Equipment.LEG_SLOT, LUNAR_LEGS],
    [Equipment.HANDS_SLOT, LUNAR_GLOVES],
    [Equipment.FEET_SLOT, LUNAR_BOOTS],
    [Equipment.RING_SLOT, LUNAR_RING],
  ];
  const GIVEN_ITEMS = new Map([
    ["Xkld-c", { item: LUNAR_HELM, key: "helm", varbit: VARBIT_GIVEN_HELM }],
    ["v49byn", { item: LUNAR_CAPE, key: "cape", varbit: VARBIT_GIVEN_CAPE }],
    ["fyzpa5", { item: LUNAR_AMULET, key: "amulet", varbit: VARBIT_GIVEN_AMULET }],
    ["I_YEkw", { item: LUNAR_TORSO, key: "torso", varbit: VARBIT_GIVEN_TORSO }],
    ["I9GEFm", { item: LUNAR_GLOVES, key: "gloves", varbit: VARBIT_GIVEN_GLOVES }],
    ["dThWTV", { item: LUNAR_BOOTS, key: "boots", varbit: VARBIT_GIVEN_BOOTS }],
    ["QKXEla", { item: LUNAR_LEGS, key: "trousers", varbit: VARBIT_GIVEN_TROUSERS }],
    ["0JK6TX", { item: LUNAR_RING, key: "ring", varbit: VARBIT_GIVEN_RING }],
  ]);
  const LOST_CONDITIONS = new Map([
    ["8CB0D5", { item: LUNAR_HELM, key: "helm" }],
    ["bD32x8", { item: LUNAR_TORSO, key: "torso" }],
    ["7aZ9A5", { item: LUNAR_LEGS, key: "trousers" }],
    ["NO8fFX", { item: LUNAR_GLOVES, key: "gloves" }],
    ["Ytfm_P", { item: LUNAR_BOOTS, key: "boots" }],
    ["g23gZP", { item: LUNAR_CAPE, key: "cape" }],
    ["OexXBx", { item: LUNAR_AMULET, key: "amulet" }],
    ["BzXgp-", { item: LUNAR_RING, key: "ring" }],
  ]);
  const REPLACEMENT_ACTIONS = new Map([
    ["rSaPSD", { item: LUNAR_HELM, key: "helm" }],
    ["2vyh9u", { item: LUNAR_TORSO, key: "torso" }],
    ["Hu6CJp", { item: LUNAR_LEGS, key: "trousers" }],
    ["W84mby", { item: LUNAR_GLOVES, key: "gloves" }],
    ["0pCQAg", { item: LUNAR_BOOTS, key: "boots" }],
    ["wRY0WN", { item: LUNAR_CAPE, key: "cape" }],
    ["lrDU0g", { item: LUNAR_AMULET, key: "amulet" }],
    ["xQ1LfM", { item: LUNAR_RING, key: "ring" }],
  ]);
  const SYMBOL_CONDITIONS = new Map([
    ["bV84hf", 0],
    ["teW44a", 1],
    ["yDfJDc", 2],
    ["KyZD5w", 3],
    ["sJO6ZZ", 4],
  ]);
  const CHALLENGE_CONDITIONS = new Map([
    ["BQo8YI", "tree"],
    ["tkYqSR", "race"],
    ["zLllWz", "number"],
    ["U-czsD", "emote"],
    ["t1XUsL", "dice"],
    ["kJyxCu", "memory"],
  ]);
  const EMOTE_CONDITIONS = ["jWfih2", "675j-9", "oumczS", "AeddfT", "eqgwkv"];
  const ALL_DONE_CONDITIONS = new Set(["dAdHHT", "hJaZXC", "wVQR7j", "bnzkn0", "EGce4M", "8KkPgr"]);
  const NO_SPACE_CONDITIONS = new Set([
    "pbv8wa",
    "HMhfrf",
    "p58bPl",
    "fALgrL",
    "3Y38H6",
    "dcxk0k",
    "uaEdIa",
    "fDDv2-",
    "S3JBPg",
    "Bo8uYb",
    "u2Z4yT",
    "Y6Ms41",
    "XEKJgl",
    "t0DKof",
    "ACTec0",
    "TGBE_k",
    "6_kZ4Q",
  ]);

  const CHALLENGE_VARBITS = {
    tree: VARBIT_TREE_PROG,
    race: VARBIT_SKILL_PROG,
    number: VARBIT_NUM_PROG,
    emote: VARBIT_EMOTE_PROG,
    dice: VARBIT_DICE_PROG,
    memory: VARBIT_FLOOR_PROG,
  };

  const SYMBOLS_ATTRIBUTE = "quest.lunar_diplomacy.symbols";
  const PENDING_SYMBOL_ATTRIBUTE = "quest.lunar_diplomacy.pending-symbol";
  const ONEIRO_GIVEN_ATTRIBUTE = "quest.lunar_diplomacy.oneiro-given";
  const BABA_INTRO_ATTRIBUTE = "quest.lunar_diplomacy.baba-intro";
  const SELENE_INTRO_ATTRIBUTE = "quest.lunar_diplomacy.selene-intro";
  const METEORA_INTRO_ATTRIBUTE = "quest.lunar_diplomacy.meteora-intro";
  const RIMAE_INTRO_ATTRIBUTE = "quest.lunar_diplomacy.rimae-intro";
  const PAULINE_INTRO_ATTRIBUTE = "quest.lunar_diplomacy.pauline-intro";
  const BRAZIER_ATTRIBUTE = "quest.lunar_diplomacy.brazier-lit";
  const BEING_INTRO_ATTRIBUTE = "quest.lunar_diplomacy.being-intro";
  const CHALLENGES_ATTRIBUTE = "quest.lunar_diplomacy.challenges";

  const dreamNpcs = new WeakMap();
  const bossNpcs = new WeakMap();
  let quest;

  // ==========================================================================
  // State helpers
  // ==========================================================================

  function stageOf(player) {
    return quest.getStage(player);
  }

  function setStage(player, value) {
    if (quest.getStage(player) === value) return;
    quest.setStage(player, value);
  }

  const held = (player, itemId) => player.getInventory().getAmount(itemId) >= 1;

  function stageBetween(player, min, max = Number.POSITIVE_INFINITY) {
    const stage = stageOf(player);
    return stage >= min && stage < max;
  }

  function hasFreeSlots(player, count = 1) {
    return player.getInventory().getFreeSlots() >= count;
  }

  function isCeremonialBrazier(objectId) {
    return CEREMONIAL_BRAZIER_IDS.has(objectId);
  }

  function reject(player, message) {
    if (message) player.sendMessage(message);
    return false;
  }

  function questComplete(player, key) {
    const request = { player, key, complete: false };
    api.emitCustomEvent("quest:is-complete", request);
    return request.complete === true;
  }

  function coordX(location) {
    if (!location) return NaN;
    return typeof location.getX === "function" ? location.getX() : location.x;
  }

  function coordY(location) {
    if (!location) return NaN;
    return typeof location.getY === "function" ? location.getY() : location.y;
  }

  function coordZ(location) {
    if (!location) return NaN;
    return typeof location.getZ === "function" ? location.getZ() : location.z;
  }

  function nearTile(location, tile, radius = 4) {
    const x = coordX(location);
    const y = coordY(location);
    const tx = typeof tile.getX === "function" ? tile.getX() : tile.x;
    const ty = typeof tile.getY === "function" ? tile.getY() : tile.y;
    return Math.abs(x - tx) <= radius && Math.abs(y - ty) <= radius;
  }

  function inShipBox(location) {
    const x = coordX(location);
    const y = coordY(location);
    return SHIP_BOXES.some((box) => x >= box.x0 && x <= box.x1 && y >= box.y0 && y <= box.y1);
  }

  function inDream(player) {
    const location = player.getLocation();
    return (
      location.getZ() === 2 &&
      location.getX() >= DREAM_BOX.x0 &&
      location.getX() <= DREAM_BOX.x1 &&
      location.getY() >= DREAM_BOX.y0 &&
      location.getY() <= DREAM_BOX.y1
    );
  }

  function resolvedObjectId(event) {
    if (typeof event.definition?.getId === "function") return event.definition.getId();
    const resolved = ObjectDefinition.forPlayer(event.objectId, event.player);
    return resolved?.getId?.() ?? event.objectId;
  }

  function variantSteps(variant) {
    const steps = loadTranscripts(api)?.[PAGE]?.variants?.[variant];
    return Array.isArray(steps) ? steps : [];
  }

  function pageGuard(event) {
    const pages = event.pages;
    if (!Array.isArray(pages) || pages.length === 0) return true;
    return pages.some((entry) => entry.page === PAGE);
  }

  function symbolList(player) {
    const raw = player.getAttribute(SYMBOLS_ATTRIBUTE);
    return Array.isArray(raw) ? raw : [];
  }

  function setSymbolList(player, list) {
    player.setAttribute(SYMBOLS_ATTRIBUTE, list);
  }

  function symbolCount(player) {
    return Math.min(5, symbolList(player).length);
  }

  function oneiroGiven(player) {
    const raw = player.getAttribute(ONEIRO_GIVEN_ATTRIBUTE);
    return raw && typeof raw === "object" ? raw : {};
  }

  function setOneiroGiven(player, given) {
    player.setAttribute(ONEIRO_GIVEN_ATTRIBUTE, given);
  }

  function givenCount(player) {
    return Object.values(oneiroGiven(player)).filter(Boolean).length;
  }

  function challenges(player) {
    const raw = player.getAttribute(CHALLENGES_ATTRIBUTE);
    const state = raw && typeof raw === "object" ? raw : {};
    for (const key of ["tree", "race", "number", "emote", "dice", "memory"]) {
      if (!state[key] || typeof state[key] !== "object") state[key] = { done: false, reported: false };
    }
    return state;
  }

  function setChallenges(player, state) {
    player.setAttribute(CHALLENGES_ATTRIBUTE, state);
  }

  function markChallenge(player, key, done) {
    const state = challenges(player);
    state[key] = { ...state[key], done };
    setChallenges(player, state);
    syncVarbits(player);
  }

  function markReported(player, key) {
    const state = challenges(player);
    state[key] = { ...state[key], reported: true };
    setChallenges(player, state);
  }

  function allChallengesDone(player) {
    const state = challenges(player);
    return ["tree", "race", "number", "emote", "dice", "memory"].every((key) => state[key].done);
  }

  function allChallengesReported(player) {
    const state = challenges(player);
    return ["tree", "race", "number", "emote", "dice", "memory"].every((key) => state[key].reported);
  }

  function pendingChallenge(player) {
    const state = challenges(player);
    return ["tree", "race", "number", "emote", "dice", "memory"].find(
      (key) => state[key].done && !state[key].reported
    );
  }

  function isBrazierLit(player) {
    return (
      player.getAttribute(BRAZIER_ATTRIBUTE) === true ||
      player.getPacketSender().getVarbit(VARBIT_BRAZIER_LIT) > 0
    );
  }

  function wearingCeremonial(player) {
    const equipment = player.getEquipment();
    return CEREMONIAL_SLOTS.every(([slot, itemId]) => equipment.get(slot)?.getId?.() === itemId);
  }

  function hasLunarVial(player) {
    return [LUNAR_VIAL_EMPTY, LUNAR_VIAL_WATER, GUAM_VIAL, MARR_VIAL, GUAM_MARR_VIAL].some((id) =>
      held(player, id)
    );
  }

  function hasAnyAxe(player) {
    return player
      .getInventory()
      .getItems()
      .some((item) => /axe$/i.test(ItemDefinition.forId(item.getId())?.getName?.() ?? ""));
  }

  function hasAnyPickaxe(player) {
    return player
      .getInventory()
      .getItems()
      .some((item) => /pickaxe$/i.test(ItemDefinition.forId(item.getId())?.getName?.() ?? ""));
  }

  function itemName(itemId) {
    return ItemDefinition.forId(itemId)?.getName?.() ?? "item";
  }

  function meetsRequirements(player) {
    const skills = player.getSkillManager();
    return (
      questComplete(player, "fremennik_trials") &&
      questComplete(player, "lost_city") &&
      questComplete(player, "rune_mysteries") &&
      questComplete(player, "shilo_village") &&
      skills.getMaxLevel(Skill.HERBLORE) >= 5 &&
      skills.getMaxLevel(Skill.CRAFTING) >= 61 &&
      skills.getMaxLevel(Skill.DEFENCE) >= 40 &&
      skills.getMaxLevel(Skill.FIREMAKING) >= 49 &&
      skills.getMaxLevel(Skill.MAGIC) >= 65 &&
      skills.getMaxLevel(Skill.MINING) >= 60 &&
      skills.getMaxLevel(Skill.WOODCUTTING) >= 55
    );
  }

  function syncVarbits(player) {
    const sender = player.getPacketSender();
    const count = symbolCount(player);
    SYMBOL_VARBITS.forEach((varbit, index) => sender.sendVarbit(varbit, index < count ? 2 : 0));
    const state = challenges(player);
    for (const [key, varbit] of Object.entries(CHALLENGE_VARBITS)) {
      if (key === "number") sender.sendVarbit(varbit, state[key].done ? 6 : 0);
      else if (key === "emote" || key === "dice") sender.sendVarbit(varbit, state[key].done ? 5 : 0);
      else sender.sendVarbit(varbit, state[key].done ? 1 : 0);
    }
    sender.sendVarbit(VARBIT_TREE_INTRO, state.tree.done ? 1 : 0);
    sender.sendVarbit(VARBIT_SKILL_INTRO, state.race.done ? 1 : 0);
    sender.sendVarbit(VARBIT_NUM_INTRO, state.number.done ? 1 : 0);
    sender.sendVarbit(VARBIT_SPOKEN_CENTRE, player.getAttribute(BEING_INTRO_ATTRIBUTE) === true ? 1 : 0);
    const given = oneiroGiven(player);
    for (const entry of GIVEN_ITEMS.values()) sender.sendVarbit(entry.varbit, given[entry.key] ? 1 : 0);
    sender.sendVarbit(VARBIT_MONK_CAPE, player.getAttribute(PAULINE_INTRO_ATTRIBUTE) === true ? 1 : 0);
    sender.sendVarbit(VARBIT_MONK_RING, player.getAttribute(SELENE_INTRO_ATTRIBUTE) === true ? 1 : 0);
    sender.sendVarbit(VARBIT_MONK_AMULET, player.getAttribute(METEORA_INTRO_ATTRIBUTE) === true ? 1 : 0);
    sender.sendVarbit(VARBIT_MONK_TANCLOTHES, player.getAttribute(RIMAE_INTRO_ATTRIBUTE) === true ? 1 : 0);
    if (stageOf(player) >= STAGE_STAFF_GIVEN) {
      sender.sendVarbit(VARBIT_BRAZIER_LIT, isBrazierLit(player) ? 1 : 0);
    }
  }

  // ==========================================================================
  // Journal
  // ==========================================================================

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      return [
        "<str>I travelled to Lunar Isle with Lokar's pirate crew and earned the</str>",
        "<str>trust of the Moon Clan by completing the ritual of the waking sleep.</str>",
        "<str>The Oneiromancer will now speak of peace with the Fremennik.</str>",
        "",
        "<col=ff0000>QUEST COMPLETE!</col>",
      ];
    }
    if (stage >= STAGE_AWAKE) {
      return [
        "<str>I completed the trials of the Dream World and defeated Me.</str>",
        "",
        "I should speak to the <col=800000>Oneiromancer</col> about what I learned.",
      ];
    }
    if (stage >= STAGE_DEFEATED) {
      return [
        "<str>I defeated Me in the Dream World.</str>",
        "",
        "I should read the <col=800000>My life</col> lectern to wake up.",
      ];
    }
    if (stage >= STAGE_FIGHT) {
      return [
        "<str>All six lessons have been learned and the Ethereal Being set my</str>",
        "<str>final challenge: to face myself.</str>",
        "",
        "I must defeat <col=800000>Me</col> in the Dream World.",
      ];
    }
    if (stage >= STAGE_DREAM) {
      return [
        "<str>I lit the brazier with the soaked kindling and entered the Dream</str>",
        "<str>World to complete the six challenges.</str>",
        "",
        "Learn the lessons at the <col=800000>Ethereal Being's</col> challenge islands.",
      ];
    }
    if (stage >= STAGE_KINDLING) {
      return [
        "<str>I handed the Oneiromancer the Lunar staff and all eight pieces of</str>",
        "<str>ceremonial clothing, and she gave me the magic kindling.</str>",
        "",
        "Soak the <col=800000>kindling</col> with the waking sleep vial, wear all the",
        "lunar clothes and the staff, light the brazier in the centre of town",
        "and use the kindling on it.",
      ];
    }
    if (stage >= STAGE_STAFF_GIVEN) {
      return [
        "<str>The Oneiromancer asked for the full set of lunar clothing.</str>",
        "",
        "Get the <col=800000>helm</col> from lunar ore, the <col=800000>cape</col> from Pauline,",
        "the <col=800000>amulet</col> from Meteora, the <col=800000>ring</col> from Selene's",
        "buried flowers and the rest from tanned Suqah hides, then hand them in.",
      ];
    }
    if (stage >= STAGE_POTION_GIVEN) {
      return [
        "<str>The Oneiromancer took the waking sleep potion and told me to imbue a</str>",
        "<str>Dramen staff at the air, fire, water and earth altars.</str>",
        "",
        "Bring her the finished <col=800000>Lunar staff</col>.",
      ];
    }
    if (stage >= STAGE_POTION_TASK) {
      return [
        "<str>The Oneiromancer asked me to make a potion of waking sleep.</str>",
        "",
        "Baba Yaga's vial needs a <col=800000>guam leaf</col>, <col=800000>marrentill</col> and a",
        "ground <col=800000>suqah tooth</col> in water. Suqah drops the ingredients.",
      ];
    }
    if (stage >= STAGE_LUNAR_ISLE) {
      return [
        "<str>Captain Bentley sailed the Lady Zay to Lunar Isle.</str>",
        "",
        "The <col=800000>Oneiromancer</col> lives south-east of the town.",
      ];
    }
    if (stage >= STAGE_SYMBOLS_DONE) {
      return [
        "<str>I rubbed out all five of the cabin boy's jinx symbols.</str>",
        "",
        "Tell <col=800000>Captain Bentley</col> the jinx is lifted.",
      ];
    }
    if (stage >= STAGE_SYMBOLS) {
      return [
        "<str>The cabin boy confessed and gave me an emerald lens and a lantern</str>",
        "<str>frame. I lit the emerald lantern and can see the symbols now.</str>",
        "",
        "Use the lit <col=800000>emerald lantern</col> on the ship's cannon, wallchart,",
        "chest, support and crate to rub the five symbols out.",
      ];
    }
    if (stage >= STAGE_SUSPECT_BOY) {
      return [
        "<str>Davey-boy revealed the cabin boy was missing from the feast.</str>",
        "",
        "Confront the <col=800000>cabin boy</col>.",
      ];
    }
    if (stage >= STAGE_SUSPECT_MATE) {
      return [
        "<str>Lecherous Lee saw the First Mate slip away from the feast.</str>",
        "",
        "Ask <col=800000>First mate 'Davey-boy'</col> what he was doing.",
      ];
    }
    if (stage >= STAGE_FEAST) {
      return [
        "<str>Beefy Burns was the only crewman to stay aboard; the rest went to</str>",
        "<str>the Moon Clan feast, where the jinx must have been picked up.</str>",
        "",
        "Ask the crew about the <col=800000>feast</col>.",
      ];
    }
    if (stage >= STAGE_SHULTZ_LESSON) {
      return [
        "<str>'Eagle-eye' Shultz explained that someone must have offended the</str>",
        "<str>Moon Clan at the feast and brought a jinx on the ship.</str>",
        "",
        "Ask the crew what they remember of the <col=800000>feast</col>.",
      ];
    }
    if (stage >= STAGE_JINX) {
      return [
        "<str>'Birds-Eye' Jack revealed that the ship has been jinxed.</str>",
        "",
        "Find out who or what carries the <col=800000>jinx</col> from the crew.",
      ];
    }
    if (stage >= STAGE_NAVIGATOR) {
      return [
        "<str>Captain Bentley suggested I speak to the navigator again.</str>",
        "",
        "Confront <col=800000>'Birds-Eye' Jack</col> below deck.",
      ];
    }
    if (stage >= STAGE_JACK_HINT) {
      return [
        "<str>Captain Bentley blamed the navigator for our failure to sail.</str>",
        "",
        "Tell him <col=800000>'Birds-Eye' Jack</col> is at fault, or ask to try again.",
      ];
    }
    if (stage >= STAGE_CIRCLED) {
      return [
        "<str>The Lady Zay sailed in a huge circle and came right back.</str>",
        "",
        "Speak to <col=800000>Captain Bentley</col>, then the navigator he names.",
      ];
    }
    if (stage >= STAGE_SAILED) {
      return [
        "<str>Lokar took me aboard the Lady Zay at Pirates' Cove.</str>",
        "",
        "Talk to <col=800000>Captain Bentley</col> about sailing to Lunar Isle.",
      ];
    }
    if (stage >= STAGE_SEAL) {
      return [
        "<str>Brundt the Chieftain gave me a Seal of Passage for the Moon Clan.</str>",
        "",
        "Return to <col=800000>Lokar Searunner</col> at the Rellekka docks.",
      ];
    }
    if (stage >= STAGE_STARTED) {
      return [
        "<str>Lokar Searunner wants passage to Lunar Isle and told me to ask</str>",
        "<str>Brundt the Chieftain for a Seal of Passage.</str>",
        "",
        "Talk to <col=800000>Brundt the Chieftain</col> in the Rellekka longhall.",
      ];
    }
    return [
      "I can start this quest by talking to <col=800000>Lokar Searunner</col> on the",
      "westernmost dock of <col=800000>Rellekka</col>.",
      "",
      "I must have completed <col=800000>The Fremennik Trials</col>, <col=800000>Lost City</col>,",
      "<col=800000>Rune Mysteries</col> and <col=800000>Shilo Village</col>, and have 5 Herblore,",
      "61 Crafting, 40 Defence, 49 Firemaking, 65 Magic, 60 Mining and",
      "55 Woodcutting.",
    ];
  }

  // ==========================================================================
  // Variant selection: Rellekka / Pirates' Cove
  // ==========================================================================

  function selectLokar(player, npc) {
    const stage = stageOf(player);
    const location = npc?.getLocation?.() ?? player.getLocation();
    const hasSeal = held(player, SEAL_OF_PASSAGE);
    if (stage >= STAGE_SAILED) {
      if (nearTile(location, RELLEKKA_DOCK, 12)) {
        return hasSeal
          ? "pirates-cove-talking-to-lokar-searunner-in-rellekka-after-visiting-pirates-cove-with-a-seal-of-passage"
          : "pirates-cove-talking-to-lokar-searunner-in-rellekka-after-visiting-pirates-cove-without-a-seal-of-passage";
      }
      return "pirates-cove-talking-to-lokar-searunner-at-pirates-cove";
    }
    if (stage >= STAGE_SEAL) {
      return hasSeal
        ? "getting-started-returning-to-lokar-searunner-holding-the-seal-of-passage"
        : "getting-started-returning-to-lokar-searunner-after-losing-the-seal-of-passage";
    }
    if (stage >= STAGE_STARTED) {
      return "getting-started-talking-to-lokar-searunner-before-getting-the-seal-of-passage";
    }
    return "getting-started-talking-to-lokar-searunner";
  }

  function selectBrundt(player) {
    const stage = stageOf(player);
    if (stage >= STAGE_COMPLETE) {
      if (!held(player, SEAL_OF_PASSAGE)) {
        return "getting-started-talking-to-brundt-the-chieftain-after-losing-the-seal-of-passage";
      }
      return "post-quest-talking-to-brundt-the-chieftain-after-the-quest";
    }
    if (stage >= STAGE_SEAL) {
      return held(player, SEAL_OF_PASSAGE)
        ? "getting-started-talking-to-brundt-the-chieftain-holding-the-seal-of-passage"
        : "getting-started-talking-to-brundt-the-chieftain-after-losing-the-seal-of-passage";
    }
    if (stage >= STAGE_STARTED) {
      return "getting-started-talking-to-brundt-the-chieftain-before-getting-the-seal-of-passage";
    }
    return null;
  }

  /**
   * Fremennik Trials registers its variant selector first and answers every Brundt
   * id, and the raw longhall/Exiles spawns (3926/7318/9269) have no dialogue-index
   * page at all, so NpcDialogues never reaches selectBrundt. Once this quest is
   * running, claim Talk-to and play the Lunar page directly; before that (stage 0)
   * the default conversation (Fremennik Trials' or the generic one) still plays.
   */
  function talkToBrundt(event) {
    if (event.clickType !== 1 || !BRUNDT_IDS.has(event.npcId)) return false;
    const variant = selectBrundt(event.player);
    if (!variant) return false;
    event.handled = true;
    startTranscript(api, event.player, event.npcId, PAGE, variant);
    return true;
  }

  function selectBentley(player, npc) {
    const stage = stageOf(player);
    if (stage >= STAGE_LUNAR_ISLE) {
      const location = npc?.getLocation?.() ?? player.getLocation();
      return inShipBox(location) && nearTile(location, PIRATES_COVE_DOCKS, 40)
        ? "lunar-isle-talking-to-captain-bentley-on-pirates-cove-after-visiting-lunar-isle"
        : "lunar-isle-talking-to-captain-bentley-on-lunar-isle";
    }
    if (stage >= STAGE_SYMBOLS_DONE) return "pirates-cove-talking-to-captain-bentley-after-removing-the-jinx";
    if (stage >= STAGE_SYMBOLS) {
      return "pirates-cove-talking-to-the-crew-after-learning-about-the-symbols-captain-bentley";
    }
    if (stage >= STAGE_SUSPECT_BOY) {
      return "pirates-cove-talking-to-the-crew-after-suspecting-the-cabin-boy-captain-bentley";
    }
    if (stage >= STAGE_SUSPECT_MATE) {
      return "pirates-cove-talking-to-the-crew-after-suspecting-the-first-mate-captain-bentley";
    }
    if (stage >= STAGE_FEAST) return "pirates-cove-talking-to-the-crew-about-the-feast-captain-bentley";
    if (stage >= STAGE_SHULTZ_LESSON) {
      return "pirates-cove-talking-to-the-crew-while-in-search-of-the-jinx-captain-bentley";
    }
    if (stage >= STAGE_JINX) return "pirates-cove-talking-to-the-crew-after-learning-about-the-jinx-captain-bentley";
    if (stage >= STAGE_NAVIGATOR) {
      return "pirates-cove-talking-to-the-crew-after-suggesting-it-s-the-navigator-s-fault-captain-bentley";
    }
    if (stage >= STAGE_JACK_HINT) return "pirates-cove-talking-to-captain-bentley-after-speaking-with-birds-eye-jack";
    if (stage >= STAGE_CIRCLED) return "pirates-cove-talking-to-captain-bentley-after-sailing-in-a-circle";
    return "pirates-cove-talking-to-captain-bentley-before-setting-sail";
  }

  function selectJack(player) {
    const stage = stageOf(player);
    ensureJack(player);
    if (stage >= STAGE_LUNAR_ISLE) return "pirates-cove-talking-to-the-crew-after-sailing-to-lunar-isle-bird-s-eye-jack";
    if (stage >= STAGE_SYMBOLS_DONE) return "pirates-cove-talking-to-the-crew-after-removing-the-jinx-bird-s-eye-jack";
    if (stage >= STAGE_SYMBOLS) {
      return "pirates-cove-talking-to-the-crew-after-learning-about-the-symbols-bird-s-eye-jack";
    }
    if (stage >= STAGE_SUSPECT_BOY) {
      return "pirates-cove-talking-to-the-crew-after-suspecting-the-cabin-boy-bird-s-eye-jack";
    }
    if (stage >= STAGE_SUSPECT_MATE) {
      return "pirates-cove-talking-to-the-crew-after-suspecting-the-first-mate-birds-eye-jack";
    }
    if (stage >= STAGE_FEAST) return "pirates-cove-talking-to-the-crew-about-the-feast-birds-eye-jack";
    if (stage >= STAGE_SHULTZ_LESSON) {
      return "pirates-cove-talking-to-the-crew-while-in-search-of-the-jinx-birds-eye-jack";
    }
    if (stage >= STAGE_JINX) return "pirates-cove-talking-to-the-crew-after-learning-about-the-jinx-birds-eye-jack";
    if (stage >= STAGE_NAVIGATOR) {
      setStage(player, STAGE_JINX);
      return "pirates-cove-talking-to-birds-eye-jack-after-suggesting-it-s-the-navigator-s-fault";
    }
    if (stage >= STAGE_JACK_HINT) {
      return "pirates-cove-talking-to-birds-eye-jack-at-the-captain-s-suggestion-talking-to-birds-eye-jack-again";
    }
    if (stage >= STAGE_CIRCLED) {
      setStage(player, STAGE_JACK_HINT);
      return "pirates-cove-talking-to-birds-eye-jack-at-the-captain-s-suggestion";
    }
    return "pirates-cove-talking-to-the-crew-before-setting-sail-birds-eye-jack";
  }

  const CREW_FAMILY = {
    circle: "after-sailing-in-a-circle",
    navigator: "after-suggesting-it-s-the-navigator-s-fault",
    jinx: "after-learning-about-the-jinx",
    search: "while-in-search-of-the-jinx",
    feast: "about-the-feast",
    mate: "after-suspecting-the-first-mate",
    boy: "after-suspecting-the-cabin-boy",
    symbols: "after-learning-about-the-symbols",
    removed: "after-removing-the-jinx",
    arrived: "after-sailing-to-lunar-isle",
  };

  function crewVariant(family, slug) {
    return `pirates-cove-talking-to-the-crew-${family}-${slug}`;
  }

  const BEFORE_SAIL_SLUGS = new Set(["cabin-boy", "eagle-eye-shultz", "first-mate-davey-boy", "birds-eye-jack", "beefy-burns"]);
  const BOY_NAMED_SLUGS = new Set(["captain-bentley", "bedread-the-bold", "beefy-burns"]);
  const BOY_JACK_SLUG = "bird-s-eye-jack";
  const SYMBOL_COMBINED = new Map([
    ["lecherous-lee", "lecherous-lee-or-sticky-sanders"],
    ["sticky-sanders", "lecherous-lee-or-sticky-sanders"],
    ["eagle-eye-shultz", "eagle-eye-shultz-or-beefy-burns"],
    ["beefy-burns", "eagle-eye-shultz-or-beefy-burns"],
    ["first-mate-davey-boy", "first-mate-davey-boy-or-picarron-pete"],
    ["picarron-pete", "first-mate-davey-boy-or-picarron-pete"],
    ["birds-eye-jack", "bird-s-eye-jack"],
  ]);
  const REMOVED_NAMED_SLUGS = new Set([
    "lecherous-lee",
    "cabin-boy",
    "sticky-sanders",
    "jack-sails",
    "murky-pat",
    "jenny-blade",
    "tommy-2-times",
    "bedread-the-bold",
    "beedy-eye-jones",
    "betty-b-boppin",
  ]);

  function selectCrew(player, npcId) {
    const slug = CREW_SLUGS.get(npcId);
    if (!slug) return null;
    const stage = stageOf(player);
    if (stage >= STAGE_LUNAR_ISLE) {
      const suffix = slug === "birds-eye-jack" ? "bird-s-eye-jack" : slug;
      return crewVariant(CREW_FAMILY.arrived, suffix);
    }
    if (stage >= STAGE_SYMBOLS_DONE) {
      if (slug === "birds-eye-jack") return crewVariant(CREW_FAMILY.removed, "bird-s-eye-jack");
      return REMOVED_NAMED_SLUGS.has(slug)
        ? crewVariant(CREW_FAMILY.removed, slug)
        : crewVariant(CREW_FAMILY.removed, "other-crewmembers");
    }
    if (stage >= STAGE_SYMBOLS) {
      return crewVariant(CREW_FAMILY.symbols, SYMBOL_COMBINED.get(slug) ?? slug);
    }
    if (stage >= STAGE_SUSPECT_BOY) {
      if (slug === "cabin-boy") return "pirates-cove-talking-to-the-cabin-boy-after-suspecting-him";
      if (slug === "birds-eye-jack") return crewVariant(CREW_FAMILY.boy, BOY_JACK_SLUG);
      return BOY_NAMED_SLUGS.has(slug)
        ? crewVariant(CREW_FAMILY.boy, slug)
        : crewVariant(CREW_FAMILY.boy, "other-crewmembers");
    }
    if (stage >= STAGE_SUSPECT_MATE) {
      if (slug === "first-mate-davey-boy") {
        setStage(player, STAGE_SUSPECT_BOY);
        return "pirates-cove-talking-to-first-mate-davey-boy-after-suspecting-him";
      }
      return crewVariant(CREW_FAMILY.mate, slug);
    }
    if (stage >= STAGE_FEAST) {
      if (slug === "lecherous-lee") {
        setStage(player, STAGE_SUSPECT_MATE);
        return "pirates-cove-talking-to-lecherous-lee-about-the-feast";
      }
      return crewVariant(CREW_FAMILY.feast, slug);
    }
    if (stage >= STAGE_SHULTZ_LESSON) {
      if (slug === "beefy-burns") {
        setStage(player, STAGE_FEAST);
        return "pirates-cove-talking-to-beefy-burns-while-in-search-of-the-jinx";
      }
      return crewVariant(CREW_FAMILY.search, slug);
    }
    if (stage >= STAGE_JINX) {
      if (slug === "eagle-eye-shultz") {
        setStage(player, STAGE_SHULTZ_LESSON);
        return "pirates-cove-talking-to-eagle-eye-shultz-after-learning-about-the-jinx";
      }
      return crewVariant(CREW_FAMILY.jinx, slug);
    }
    if (stage >= STAGE_NAVIGATOR) return crewVariant(CREW_FAMILY.navigator, slug);
    if (stage >= STAGE_CIRCLED) return crewVariant(CREW_FAMILY.circle, slug);
    if (BEFORE_SAIL_SLUGS.has(slug)) return crewVariant("before-setting-sail", slug);
    return crewVariant(CREW_FAMILY.circle, slug);
  }

  // ==========================================================================
  // Variant selection: Lunar Isle
  // ==========================================================================

  function missingCeremonial(player) {
    if (!held(player, KINDLING) && !held(player, SOAKED_KINDLING)) return true;
    if (!held(player, WAKING_SLEEP_VIAL)) return true;
    if (!held(player, LUNAR_STAFF)) return true;
    return [LUNAR_HELM, LUNAR_CAPE, LUNAR_AMULET, LUNAR_TORSO, LUNAR_GLOVES, LUNAR_BOOTS, LUNAR_LEGS, LUNAR_RING]
      .some((item) => !held(player, item));
  }

  function selectOneiromancer(player) {
    const stage = stageOf(player);
    if (stage >= STAGE_COMPLETE) return "post-quest-talking-to-the-oneiromancer-after-the-quest";
    if (stage >= STAGE_DEFEATED) return "finishing-up-talking-to-the-oneiromancer-after-defeating-me";
    if (stage >= STAGE_DREAM) {
      if (allChallengesDone(player)) {
        return "visiting-the-dream-world-talking-to-the-oneiromancer-after-completing-the-6-challenges";
      }
      return "visiting-the-dream-world-talking-to-the-oneiromancer-after-entering-the-dream-world";
    }
    if (stage >= STAGE_KINDLING) {
      return missingCeremonial(player)
        ? "obtaining-the-lunar-clothing-talking-to-the-oneironmancer-after-losing-some-items"
        : "obtaining-the-lunar-clothing-talking-to-the-oneiromancer-after-getting-the-kindling";
    }
    if (stage >= STAGE_STAFF_GIVEN) {
      return "obtaining-the-lunar-clothing-talking-to-oneiromancer-after-obtaining-some-lunar-clothing";
    }
    if (stage >= STAGE_POTION_GIVEN) {
      return held(player, LUNAR_STAFF)
        ? "obtaining-the-lunar-clothing-talking-to-the-oneiromancer-while-holding-the-lunar-staff"
        : "obtaining-the-lunar-staff-talking-to-the-oneiromancer-again";
    }
    if (stage >= STAGE_POTION_TASK) {
      if (held(player, WAKING_SLEEP_VIAL)) {
        return "obtaining-the-lunar-staff-talking-to-the-oneiromancer-with-a-waking-sleep-vial";
      }
      if (hasLunarVial(player)) return "obtaining-the-waking-sleep-potion-talking-to-the-oneiromancer-again";
      return "obtaining-the-waking-sleep-potion-talking-to-the-oneiromancer-without-a-waking-sleep-vial";
    }
    if (stage >= STAGE_LUNAR_ISLE) {
      // The Seal is the Moon Clan's permission to deal with outsiders. Do not
      // advance the ceremony without it; Brundt replaces a lost seal.
      if (!held(player, SEAL_OF_PASSAGE)) {
        reject(player, "You need your Seal of Passage before the Oneiromancer will begin the ceremony.");
        return "obtaining-the-waking-sleep-potion-talking-to-the-oneiromancer";
      }
      setStage(player, STAGE_POTION_TASK);
      return "obtaining-the-waking-sleep-potion-talking-to-the-oneiromancer";
    }
    return null;
  }

  function selectBabaYaga(player) {
    const stage = stageOf(player);
    if (stage < STAGE_LUNAR_ISLE) return null;
    ensureBabaYaga(player);
    if (stage < STAGE_POTION_GIVEN) {
      if (player.getAttribute(BABA_INTRO_ATTRIBUTE) !== true) {
        return "obtaining-the-waking-sleep-potion-talking-to-baba-yaga";
      }
      return "obtaining-the-waking-sleep-potion-talking-to-baba-yaga-again";
    }
    return "lunar-isle-talking-to-baba-yaga-after-after-arriving-to-lunar-isle";
  }

  function selectPauline(player) {
    const stage = stageOf(player);
    if (stage < STAGE_LUNAR_ISLE) return null;
    player.setAttribute(PAULINE_INTRO_ATTRIBUTE, true);
    if (stage >= STAGE_STAFF_GIVEN && !held(player, LUNAR_CAPE)) {
      return "obtaining-the-lunar-clothing-talking-to-pauline-polaris-to-get-the-lunar-cape";
    }
    return "obtaining-the-lunar-clothing-talking-to-pauline-polaris-after-guessing-her-alias-name-correctly";
  }

  function selectMeteora(player) {
    const stage = stageOf(player);
    if (stage < STAGE_LUNAR_ISLE) return null;
    if (stage < STAGE_STAFF_GIVEN || held(player, LUNAR_AMULET)) {
      return "lunar-isle-talking-to-meteora";
    }
    if (held(player, SPECIAL_TIARA)) {
      return "obtaining-the-lunar-clothing-talking-to-meteora-while-holding-the-tiara";
    }
    if (player.getAttribute(METEORA_INTRO_ATTRIBUTE) !== true) {
      player.setAttribute(METEORA_INTRO_ATTRIBUTE, true);
      return "obtaining-the-lunar-clothing-talking-to-meteora-about-the-amulet";
    }
    return "obtaining-the-lunar-clothing-talking-to-meteora-before-getting-the-tiara";
  }

  function selectSelene(player) {
    const stage = stageOf(player);
    if (stage < STAGE_LUNAR_ISLE) return null;
    if (stage >= STAGE_STAFF_GIVEN && !held(player, LUNAR_RING)) {
      return player.getAttribute(SELENE_INTRO_ATTRIBUTE) === true
        ? "obtaining-the-lunar-clothing-talking-to-selene-after-getting-the-clue-for-the-ring"
        : "obtaining-the-lunar-clothing-talking-to-selene-to-get-the-ring";
    }
    return "obtaining-the-lunar-clothing-talking-to-selene-to-get-the-ring";
  }

  function selectRimae(player) {
    const stage = stageOf(player);
    if (stage < STAGE_LUNAR_ISLE) return null;
    if (stage >= STAGE_STAFF_GIVEN) {
      player.setAttribute(RIMAE_INTRO_ATTRIBUTE, true);
      if (held(player, SUQAH_HIDE)) {
        return "obtaining-the-lunar-clothing-talking-to-rimae-sirsalis-while-holding-suqah-hides";
      }
      return "obtaining-the-lunar-clothing-talking-to-rimae-sirsalis-before-getting-suqah-hides";
    }
    if (player.getAttribute(RIMAE_INTRO_ATTRIBUTE) !== true) {
      player.setAttribute(RIMAE_INTRO_ATTRIBUTE, true);
      return "obtaining-the-lunar-clothing-talking-to-rimae-sirsalis-about-the-ceremonial-clothes";
    }
    return "obtaining-the-lunar-clothing-talking-to-rimae-sirsalis-about-the-ceremonial-clothes";
  }

  // ==========================================================================
  // Variant selection: the Dream World Ethereals
  // ==========================================================================

  const CHALLENGE_AFTER = {
    tree: "visiting-the-dream-world-talking-to-the-ethereal-being-after-completing-the-woodcutting-trial",
    race: "visiting-the-dream-world-talking-to-the-ethereal-being-after-winning-the-race",
    number: "visiting-the-dream-world-talking-to-ethereal-being-after-finishing-the-number-puzzle",
    emote: "visiting-the-dream-world-talking-to-the-ethereal-being-after-finishing-the-emote-challenge",
    dice: "visiting-the-dream-world-talking-to-the-ethereal-being-after-finishing-the-dice-puzzle",
    memory: "visiting-the-dream-world-talking-to-the-ethereal-being-after-finishing-the-memory-puzzle",
  };

  function selectEtherealBeing(player) {
    const stage = stageOf(player);
    if (stage >= STAGE_DEFEATED) return "visiting-the-dream-world-talking-to-the-ethereal-being-after-defeating-me";
    if (stage >= STAGE_FIGHT) {
      return "visiting-the-dream-world-talking-to-the-ethereal-being-after-learning-about-the-final-challenge";
    }
    const pending = pendingChallenge(player);
    if (pending) {
      markReported(player, pending);
      return CHALLENGE_AFTER[pending];
    }
    if (allChallengesReported(player)) {
      return "visiting-the-dream-world-continued-conversation-with-the-ethereal-being-after-finishing-all-the-challenges";
    }
    if (player.getAttribute(BEING_INTRO_ATTRIBUTE) !== true) {
      player.setAttribute(BEING_INTRO_ATTRIBUTE, true);
      return "visiting-the-dream-world-talking-to-the-ethereal-being-in-the-dream-world";
    }
    return "visiting-the-dream-world-talking-to-the-ethereal-being-again";
  }

  function selectEtherealPerceptive(player) {
    const state = challenges(player);
    if (state.tree.done) return "visiting-the-dream-world-talking-to-the-ethereal-perceptive-again";
    if (state.tree.started) {
      markChallenge(player, "tree", true);
      return "visiting-the-dream-world-winning-the-competition";
    }
    return "visiting-the-dream-world-talking-to-the-ethereal-perceptive";
  }

  function selectEtherealExpert(player) {
    const state = challenges(player);
    if (state.race.done) return "visiting-the-dream-world-talking-to-the-ethereal-expert";
    if (state.race.started) {
      markChallenge(player, "race", true);
      return "visiting-the-dream-world-winning-the-race";
    }
    return "visiting-the-dream-world-talking-to-the-ethereal-expert";
  }

  function selectEtherealNumerator(player) {
    const state = challenges(player);
    if (state.number.done) return "visiting-the-dream-world-talking-to-ethereal-numerator-after-receiving-a-sequence";
    if (state.number.started) {
      markChallenge(player, "number", true);
      return "visiting-the-dream-world-finishing-the-last-sequence";
    }
    const next = challenges(player);
    next.number = { ...next.number, started: true };
    setChallenges(player, next);
    return "visiting-the-dream-world-talking-to-the-ethereal-numerator";
  }

  function selectEtherealFluke(player) {
    const state = challenges(player);
    if (state.dice.done) return "visiting-the-dream-world-talking-to-the-ethereal-fluke-again";
    if (state.dice.started) {
      markChallenge(player, "dice", true);
      return "visiting-the-dream-world-finishing-the-dice-puzzle";
    }
    const next = challenges(player);
    next.dice = { ...next.dice, started: true };
    setChallenges(player, next);
    return "visiting-the-dream-world-talking-to-the-ethereal-fluke";
  }

  function selectEtherealGuide(player) {
    const state = challenges(player);
    if (state.memory.done) return "visiting-the-dream-world-talking-to-the-ethereal-guide";
    if (state.memory.started) {
      markChallenge(player, "memory", true);
      return "visiting-the-dream-world-reaching-the-end-of-the-path";
    }
    const next = challenges(player);
    next.memory = { ...next.memory, started: true };
    setChallenges(player, next);
    return "visiting-the-dream-world-talking-to-the-ethereal-guide";
  }

  function selectEtherealMimic(player) {
    const state = challenges(player);
    if (state.emote.done) return "visiting-the-dream-world-talking-to-the-ethereal-mimic";
    if (state.emote.started) return "visiting-the-dream-world-using-the-correct-emote";
    return "visiting-the-dream-world-talking-to-the-ethereal-mimic";
  }

  function selectVariant(event) {
    const { player, npcId, npc } = event;
    if (!pageGuard(event) && event.pages?.length) return null;
    if (LOKAR_IDS.has(npcId)) return selectLokar(player, npc);
    if (BRUNDT_IDS.has(npcId)) return selectBrundt(player);
    if (BENTLEY_IDS.has(npcId)) return selectBentley(player, npc);
    if (npcId === JACK_SHIP) return selectJack(player);
    if (CREW_SLUGS.has(npcId)) return selectCrew(player, npcId);
    if (ONEIROMANCER_IDS.has(npcId)) return selectOneiromancer(player);
    if (npcId === BABA_YAGA_ID) return selectBabaYaga(player);
    if (npcId === PAULINE_ID) return selectPauline(player);
    if (npcId === METEORA_ID) return selectMeteora(player);
    if (npcId === SELENE_ID) return selectSelene(player);
    if (npcId === RIMAE_ID) return selectRimae(player);
    if (stageOf(player) < STAGE_DREAM) return null;
    if (ETHEREAL_BEING_IDS.has(npcId)) return selectEtherealBeing(player);
    if (npcId === ETHEREAL_PERCEPTIVE_ID) return selectEtherealPerceptive(player);
    if (npcId === ETHEREAL_EXPERT_ID) return selectEtherealExpert(player);
    if (npcId === ETHEREAL_NUMERATOR_ID) return selectEtherealNumerator(player);
    if (npcId === ETHEREAL_FLUKE_ID) return selectEtherealFluke(player);
    if (npcId === ETHEREAL_GUIDE_ID) return selectEtherealGuide(player);
    if (npcId === ETHEREAL_MIMIC_ID) return selectEtherealMimic(player);
    return null;
  }

  // ==========================================================================
  // Condition answers
  // ==========================================================================

  function answerCondition(event) {
    if (!pageGuard(event)) return null;
    const { player, stepId } = event;
    if (NO_SPACE_CONDITIONS.has(stepId)) return player.getInventory().getFreeSlots() === 0;
    switch (stepId) {
      case "KxhOJ0":
      case "TVf6v-":
      case "dzXdii":
        return !held(player, SEAL_OF_PASSAGE);
      case "LzKm31":
        return held(player, SEAL_OF_PASSAGE);
      case "Vgk7Rd":
        return held(player, EMERALD_LENS) && (held(player, LANTERN_FRAME) || held(player, EMERALD_LANTERN));
      case "t_H1vo":
        return held(player, EMERALD_LANTERN) || held(player, EMERALD_LANTERN_LIT);
      case "_IbvpA":
        return !held(player, EMERALD_LENS);
      case "RXAabR":
      case "Y-2VRV":
      case "G7EcK0":
        return player.getInventory().getFreeSlots() > 0;
      case "FmtD0s":
        return held(player, LANTERN_FRAME) || held(player, EMERALD_LANTERN);
      case "6rhuqK":
      case "Y3lkJM":
        return !held(player, LANTERN_FRAME) && !held(player, EMERALD_LANTERN);
      case "uRl4W4":
        return held(player, EMERALD_LENS);
      case "whemhk": {
        const hides = player.getInventory().getAmount(SUQAH_HIDE);
        return player.getInventory().getAmount(COINS) < hides * 100;
      }
      case "7a7rqR":
      case "ePtAns":
      case "qauKyj":
      case "gOFPnU":
      case "_ivUya":
      case "cIIQOf":
      case "1eOdjH":
      case "QVabbc":
        return false;
      case "WOLXB-":
        return givenCount(player) < 8;
      case "5Nc7Zr":
        return givenCount(player) === 8;
      case "DlGcHU":
        return player.getInventory().getFreeSlots() < 11;
      case "DP04RI":
        return stageBetween(player, STAGE_KINDLING, STAGE_COMPLETE) && !held(player, LUNAR_STAFF);
      case "Jivpuw":
        return (
          stageBetween(player, STAGE_KINDLING, STAGE_COMPLETE) &&
          !held(player, KINDLING) &&
          !held(player, SOAKED_KINDLING)
        );
      case "2V5QKg":
        return stageBetween(player, STAGE_KINDLING, STAGE_COMPLETE) && !held(player, WAKING_SLEEP_VIAL);
      case "ecGB7P":
        return !isBrazierLit(player);
      case "3o6J8_":
        return !wearingCeremonial(player);
      case "6Ps_KA":
        return !hasAnyAxe(player);
      default:
        break;
    }
    if (GIVEN_ITEMS.has(stepId)) {
      if (stageOf(player) !== STAGE_STAFF_GIVEN) return false;
      const entry = GIVEN_ITEMS.get(stepId);
      return !oneiroGiven(player)[entry.key] && held(player, entry.item);
    }
    if (LOST_CONDITIONS.has(stepId)) {
      if (!stageBetween(player, STAGE_KINDLING, STAGE_COMPLETE)) return false;
      const entry = LOST_CONDITIONS.get(stepId);
      return givenCount(player) === 8 && !held(player, entry.item);
    }
    if (SYMBOL_CONDITIONS.has(stepId)) {
      return symbolCount(player) === SYMBOL_CONDITIONS.get(stepId);
    }
    if (CHALLENGE_CONDITIONS.has(stepId)) {
      return challenges(player)[CHALLENGE_CONDITIONS.get(stepId)].done === true;
    }
    if (ALL_DONE_CONDITIONS.has(stepId)) return false;
    if (EMOTE_CONDITIONS.includes(stepId)) {
      return stepId === "eqgwkv" && challenges(player).emote.started === true;
    }
    return null;
  }

  // ==========================================================================
  // Choices
  // ==========================================================================

  function handleChoice(event) {
    if (!pageGuard(event)) return;
    const { player, npc, npcId, option } = event;
    const npcLocation = npc?.getLocation?.();
    switch (option) {
      case "That's fine, I'm just going to Pirates' Cove.":
        if (!LOKAR_IDS.has(npcId) || stageOf(player) < STAGE_SAILED || !nearTile(npcLocation, RELLEKKA_DOCK, 12)) return;
        player.moveTo(PIRATES_COVE_DOCKS);
        return;
      case "Can you take me back to Rellekka?":
        if (!LOKAR_IDS.has(npcId) || stageOf(player) < STAGE_SAILED || !inShipBox(npcLocation) || !nearTile(npcLocation, PIRATES_COVE_DOCKS, 40)) return;
        player.moveTo(RELLEKKA_DOCK);
        return;
      case "Arrr! Yar! Let's be on our way, yar!":
        if (!LOKAR_IDS.has(npcId) || stageOf(player) !== STAGE_SEAL) return;
        if (!held(player, SEAL_OF_PASSAGE)) {
          reject(player, "Lokar will not sail without a Seal of Passage. Ask Brundt for a replacement.");
          return;
        }
        sailToPiratesCove(player);
        return;
      case "Go now.":
        if (!LOKAR_IDS.has(npcId) || stageOf(player) < STAGE_SEAL || !held(player, SEAL_OF_PASSAGE)) return;
        player.moveTo(PIRATES_COVE_DOCKS);
        return;
      case "Perhaps it's the Navigator's fault?":
        if (!BENTLEY_IDS.has(npcId) || stageOf(player) !== STAGE_JACK_HINT) return;
        setStage(player, STAGE_NAVIGATOR);
        return;
      case "Ok, let's go!":
        if (npcId !== ETHEREAL_PERCEPTIVE_ID || !inDream(player) || stageOf(player) < STAGE_DREAM) return;
        markStarted(player, "tree");
        return;
      case "Suppose I may as well have a go.":
        if (npcId !== ETHEREAL_MIMIC_ID || !inDream(player) || stageOf(player) < STAGE_DREAM) return;
        markStarted(player, "emote");
        return;
      case "Of course. I'm ready.":
        if (!ETHEREAL_BEING_IDS.has(npcId) || !inDream(player)) return;
        if (stageOf(player) < STAGE_DREAM || stageOf(player) >= STAGE_FIGHT) return;
        if (!allChallengesDone(player)) return;
        startFinalFight(player);
        return;
      case "That seems like a fair deal.":
        if (npcId !== RIMAE_ID || !stageBetween(player, STAGE_STAFF_GIVEN, STAGE_KINDLING)) return;
        tanHides(player);
        return;
      case "Jane Blud-Hagic-Maid":
        if (npcId !== PAULINE_ID || !stageBetween(player, STAGE_STAFF_GIVEN, STAGE_KINDLING)) return;
        giveCape(player);
        return;
      case "I'm looking for a ring.":
        if (npcId !== SELENE_ID || !stageBetween(player, STAGE_STAFF_GIVEN, STAGE_KINDLING)) return;
        player.setAttribute(SELENE_INTRO_ATTRIBUTE, true);
        player.getPacketSender().sendVarbit(VARBIT_MONK_RING, 1);
        return;
      default:
        return;
    }
  }

  function markStarted(player, key) {
    const state = challenges(player);
    if (state[key].done) return;
    state[key] = { ...state[key], started: true };
    setChallenges(player, state);
  }

  function tanHides(player) {
    if (!stageBetween(player, STAGE_STAFF_GIVEN, STAGE_KINDLING)) return;
    const hides = player.getInventory().getAmount(SUQAH_HIDE);
    if (hides === 0) {
      player.sendMessage("You have no Suqah hides for Rimae to tan.");
      return;
    }
    const cost = hides * 100;
    if (player.getInventory().getAmount(COINS) < cost) {
      player.sendMessage(`Rimae needs ${cost} coins to tan ${hides} hide${hides === 1 ? "" : "s"}.`);
      return;
    }
    player.getInventory().deleteNumber(COINS, cost);
    player.getInventory().deleteNumber(SUQAH_HIDE, hides);
    player.getInventory().adds(SUQAH_LEATHER, hides);
    player.sendMessage("Rimae tans your Suqah hides.");
  }

  function giveCape(player) {
    if (held(player, LUNAR_CAPE)) return;
    if (player.getInventory().getFreeSlots() === 0) {
      player.sendMessage("You do not have enough space for the cape.");
      return;
    }
    player.getInventory().adds(LUNAR_CAPE, 1);
    player.setAttribute(PAULINE_INTRO_ATTRIBUTE, true);
    player.getPacketSender().sendVarbit(VARBIT_MONK_CAPE, 1);
  }

  // ==========================================================================
  // Transcript actions and lines
  // ==========================================================================

  function handleAction(event) {
    if (!pageGuard(event)) return;
    const { player, npc, npcId, stepId } = event;
    const npcLocation = npc?.getLocation?.();
    if (event.kind === "message") return;
    switch (stepId) {
      // The canonical post-quest Lokar transcripts still offer the ordinary
      // Rellekka <-> Pirates' Cove boat trip. The transcript exports these as
      // teleport actions, so they need an explicit destination just like the
      // in-quest sail choice below.
      case "Zy03Vt":
      case "1iO5AM":
        if (!LOKAR_IDS.has(npcId) || stageOf(player) < STAGE_SAILED || !nearTile(npcLocation, RELLEKKA_DOCK, 12)) return;
        event.handled = true;
        ferry(player, "pirates-cove", PIRATES_COVE_DOCKS);
        return;
      case "XRE4z2":
        if (!LOKAR_IDS.has(npcId) || stageOf(player) < STAGE_SAILED || !inShipBox(npcLocation) || !nearTile(npcLocation, PIRATES_COVE_DOCKS, 40)) return;
        event.handled = true;
        ferry(player, "rellekka-lokar", RELLEKKA_DOCK);
        return;
      case "szE3tO":
        if (!BENTLEY_IDS.has(npcId) || stageOf(player) < STAGE_LUNAR_ISLE) return;
        if (!held(player, SEAL_OF_PASSAGE)) {
          reject(player, "Captain Bentley will not sail without a Seal of Passage.");
          return;
        }
        if (!inShipBox(npcLocation) || !nearTile(npcLocation, PIRATES_COVE_DOCKS, 40)) return;
        event.handled = true;
        ferry(player, "lunar-isle", LUNAR_ISLE_DOCKS);
        ensureBabaYaga(player);
        ensureJack(player);
        return;
      case "QIGQSG":
        if (!BENTLEY_IDS.has(npcId) || stageOf(player) < STAGE_LUNAR_ISLE || !nearTile(npcLocation, LUNAR_ISLE_DOCKS, 32)) return;
        event.handled = true;
        ferry(player, "pirates-cove-bentley", PIRATES_COVE_DOCKS);
        return;
      case "jJ33Bh":
        if (stageOf(player) !== STAGE_STARTED) return;
        event.handled = true;
        giveSeal(player);
        if (held(player, SEAL_OF_PASSAGE)) setStage(player, STAGE_SEAL);
        return;
      case "-i30_x": {
        if (stageOf(player) !== STAGE_SUSPECT_BOY) return;
        const missing = [EMERALD_LENS, LANTERN_FRAME].filter((itemId) => !held(player, itemId)).length;
        if (missing > 0 && !hasFreeSlots(player, missing)) {
          reject(player, "You need two free inventory spaces for the emerald lens and lantern frame.");
          return;
        }
        event.handled = true;
        giveLens(player);
        giveLanternFrame(player);
        if (
          (held(player, EMERALD_LENS) || held(player, EMERALD_LANTERN) || held(player, EMERALD_LANTERN_LIT)) &&
          (held(player, LANTERN_FRAME) || held(player, EMERALD_LANTERN) || held(player, EMERALD_LANTERN_LIT))
        ) {
          setStage(player, STAGE_SYMBOLS);
        }
        return;
      }
      case "YeWGnS":
        if (!stageBetween(player, STAGE_SUSPECT_BOY, STAGE_LUNAR_ISLE)) return;
        event.handled = true;
        giveLens(player);
        return;
      case "7DnFjZ":
        if (!stageBetween(player, STAGE_SUSPECT_BOY, STAGE_LUNAR_ISLE)) return;
        event.handled = true;
        giveLanternFrame(player);
        return;
      case "LjKMYd":
        if (stageOf(player) !== STAGE_SAILED) return;
        event.handled = true;
        setStage(player, STAGE_CIRCLED);
        return;
      case "2BWxI9":
      case "2cuAAO":
      case "5X1hUh":
      case "7CiwxU":
        event.handled = true;
        return;
      case "ML3CY4":
        if (stageOf(player) !== STAGE_SYMBOLS_DONE) return;
        if (!held(player, SEAL_OF_PASSAGE)) {
          reject(player, "You need your Seal of Passage before you can land on Lunar Isle.");
          return;
        }
        event.handled = true;
        setStage(player, STAGE_LUNAR_ISLE);
        ferry(player, "lunar-isle", LUNAR_ISLE_DOCKS);
        ensureBabaYaga(player);
        ensureJack(player);
        return;
      case "coPu8b":
        event.handled = true;
        completeBrazierCeremony(player);
        return;
      case "EJZ-fm":
        if (stageOf(player) < STAGE_DEFEATED) return;
        event.handled = true;
        leaveDream(player);
        return;
      case "YcUAR4":
        if (!inDream(player) || stageOf(player) < STAGE_DREAM) return;
        event.handled = true;
        markChallenge(player, "race", true);
        event.steps = variantSteps("visiting-the-dream-world-winning-the-race");
        return;
      case "N5TggJ":
      case "MVfi59":
      case "5yDZWh":
      case "ryda55":
      case "EZWPaK":
      case "h8X6ps":
        event.handled = true;
        return;
      default:
        break;
    }
    const replacement = REPLACEMENT_ACTIONS.get(stepId);
    if (replacement) {
      event.handled = true;
      if (!stageBetween(player, STAGE_KINDLING, STAGE_COMPLETE)) return;
      if (!oneiroGiven(player)[replacement.key] || held(player, replacement.item)) return;
      if (!hasFreeSlots(player)) {
        reject(player, "You need a free inventory space for the replacement.");
        return;
      }
      player.getInventory().adds(replacement.item, 1);
    }
  }

  function handleLine(event) {
    if (!pageGuard(event)) return;
    const { player, npcId } = event;
    const text = String(event.text ?? "");
    const stage = stageOf(player);
    if (BRUNDT_IDS.has(npcId)) {
      if (stage < STAGE_STARTED) return;
      if (text.startsWith("Then you had better take a replacement")) giveSeal(player);
      else if (text.startsWith("Ok, here you go.")) giveSeal(player);
      return;
    }
    if (npcId === BABA_YAGA_ID) {
      // Both potion variants share the recipe line; the "-again" one has no vial line,
      // so grant from the recipe line too or a first talk that skipped the potion topic
      // soft-locks the vial. Flag only once the recipe has actually been heard.
      if (stage < STAGE_POTION_TASK) return;
      if (text.startsWith("You'll also need a special vial") || text.startsWith("You'll need 1 guam leaf")) {
        player.setAttribute(BABA_INTRO_ATTRIBUTE, true);
        giveLunarVial(player);
      }
      return;
    }
    if (ONEIROMANCER_IDS.has(npcId)) {
      if (text.startsWith("Well done, I'll take that for safe keeping.") && stage === STAGE_POTION_TASK) {
        if (!held(player, WAKING_SLEEP_VIAL)) return;
        player.getInventory().deleteNumber(WAKING_SLEEP_VIAL, 1);
        setStage(player, STAGE_POTION_GIVEN);
        return;
      }
      if (text.startsWith("Well done, pass it here.") && stage === STAGE_POTION_GIVEN) {
        if (!held(player, LUNAR_STAFF)) return;
        player.getInventory().deleteNumber(LUNAR_STAFF, 1);
        setStage(player, STAGE_STAFF_GIVEN);
        return;
      }
      if (text.startsWith("Now, I'm going to give you some magic kindling") && stage === STAGE_STAFF_GIVEN) {
        finishClothesHandIn(player);
        return;
      }
      if (text.startsWith("Well done! You must be rewarded for this great deed.") && stage >= STAGE_AWAKE) {
        if (!held(player, SEAL_OF_PASSAGE)) {
          reject(player, "You need your Seal of Passage before the Oneiromancer can complete the ceremony.");
          return;
        }
        if (!quest.isComplete(player)) quest.complete(player);
        return;
      }
      return;
    }
    if (npcId === METEORA_ID && text.startsWith("Sure, yeah, gimmie it yo.")) {
      if (!stageBetween(player, STAGE_STAFF_GIVEN, STAGE_KINDLING)) return;
      if (!held(player, SPECIAL_TIARA) || held(player, LUNAR_AMULET)) return;
      player.getInventory().deleteNumber(SPECIAL_TIARA, 1);
      player.getInventory().adds(LUNAR_AMULET, 1);
      return;
    }
    if (npcId === ETHEREAL_PERCEPTIVE_ID && text.startsWith("We ow you gonna chop dem troys?")) {
      if (!inDream(player) || stage < STAGE_DREAM) return;
      if (held(player, BRONZE_AXE) || hasAnyAxe(player)) return;
      if (!hasFreeSlots(player)) return reject(player, "You need a free inventory space for the axe.");
      player.getInventory().adds(BRONZE_AXE, 1);
      return;
    }
  }

  function giveSeal(player) {
    if (held(player, SEAL_OF_PASSAGE)) return;
    if (!hasFreeSlots(player)) {
      reject(player, "You need a free inventory space for the Seal of Passage.");
      return;
    }
    player.getInventory().adds(SEAL_OF_PASSAGE, 1);
  }

  function giveLens(player) {
    if (held(player, EMERALD_LENS) || held(player, EMERALD_LANTERN) || held(player, EMERALD_LANTERN_LIT)) return;
    if (!hasFreeSlots(player)) {
      reject(player, "You need a free inventory space for the emerald lens.");
      return;
    }
    player.getInventory().adds(EMERALD_LENS, 1);
  }

  function giveLanternFrame(player) {
    if (held(player, LANTERN_FRAME) || held(player, EMERALD_LANTERN) || held(player, EMERALD_LANTERN_LIT)) return;
    if (!hasFreeSlots(player)) {
      reject(player, "You need a free inventory space for the lantern frame.");
      return;
    }
    player.getInventory().adds(LANTERN_FRAME, 1);
  }

  function giveLunarVial(player) {
    if (hasLunarVial(player) || held(player, WAKING_SLEEP_VIAL)) return;
    if (!hasFreeSlots(player)) {
      reject(player, "You need a free inventory space for the special vial.");
      return;
    }
    player.getInventory().adds(LUNAR_VIAL_EMPTY, 1);
  }

  function finishClothesHandIn(player) {
    if (stageOf(player) !== STAGE_STAFF_GIVEN) return;
    if (givenCount(player) !== 8) {
      reject(player, "You still need to hand over all eight pieces of lunar clothing.");
      return;
    }
    if (!hasFreeSlots(player, 11)) {
      reject(player, "You need more inventory space to carry everything back.");
      return;
    }
    const given = oneiroGiven(player);
    for (const entry of GIVEN_ITEMS.values()) given[entry.key] = true;
    setOneiroGiven(player, given);
    for (const entry of GIVEN_ITEMS.values()) player.getInventory().adds(entry.item, 1);
    player.getInventory().adds(LUNAR_STAFF, 1);
    player.getInventory().adds(WAKING_SLEEP_VIAL, 1);
    if (!held(player, KINDLING) && !held(player, SOAKED_KINDLING)) {
      player.getInventory().adds(KINDLING, 1);
    }
    setStage(player, STAGE_KINDLING);
    syncVarbits(player);
  }

  function revealPendingSymbol(player) {
    if (!stageBetween(player, STAGE_SYMBOLS, STAGE_LUNAR_ISLE)) return;
    const key = player.getAttribute(PENDING_SYMBOL_ATTRIBUTE);
    player.setAttribute(PENDING_SYMBOL_ATTRIBUTE, null);
    if (typeof key !== "string") return;
    const list = symbolList(player);
    if (list.includes(key)) return;
    list.push(key);
    setSymbolList(player, list);
    const count = Math.min(5, list.length);
    player.getPacketSender().sendVarbit(SYMBOL_VARBITS[count - 1], 2);
    setStage(player, STAGE_SYMBOLS + 2 * count);
  }

  function handleHook(event) {
    if (!pageGuard(event)) return;
    const { player, hook, npcId } = event;
    if (hook !== START_HOOK || !LOKAR_IDS.has(npcId)) return;
    if (stageOf(player) !== 0) return;
    if (!meetsRequirements(player)) {
      player.sendMessage(
        "You must have completed The Fremennik Trials, Lost City, Rune Mysteries and Shilo Village, and meet the quest's skill requirements, to help Lokar."
      );
      return;
    }
    setStage(player, STAGE_STARTED);
  }

  // ==========================================================================
  // Condition side effects (only the chosen branch emits these)
  // ==========================================================================

  function handleCondition(event) {
    if (!pageGuard(event)) return;
    const { player, stepId } = event;
    if (SYMBOL_CONDITIONS.has(stepId)) {
      revealPendingSymbol(player);
      return;
    }
    if (GIVEN_ITEMS.has(stepId)) {
      if (stageOf(player) !== STAGE_STAFF_GIVEN) return;
      const entry = GIVEN_ITEMS.get(stepId);
      const given = oneiroGiven(player);
      if (given[entry.key] || !held(player, entry.item)) return;
      player.getInventory().deleteNumber(entry.item, 1);
      given[entry.key] = true;
      setOneiroGiven(player, given);
      player.getPacketSender().sendVarbit(entry.varbit, 1);
      return;
    }
    if (stepId === "DP04RI") {
      if (!stageBetween(player, STAGE_KINDLING, STAGE_COMPLETE)) return;
      if (held(player, LUNAR_STAFF)) return;
      if (!hasFreeSlots(player)) return reject(player, "You need a free inventory space for the lunar staff.");
      player.getInventory().adds(LUNAR_STAFF, 1);
      return;
    }
    if (stepId === "Jivpuw") {
      if (!stageBetween(player, STAGE_KINDLING, STAGE_COMPLETE)) return;
      if (held(player, KINDLING) || held(player, SOAKED_KINDLING)) return;
      if (!hasFreeSlots(player)) return reject(player, "You need a free inventory space for the kindling.");
      player.getInventory().adds(KINDLING, 1);
      return;
    }
    if (stepId === "2V5QKg") {
      if (!stageBetween(player, STAGE_KINDLING, STAGE_COMPLETE)) return;
      if (held(player, WAKING_SLEEP_VIAL)) return;
      if (!hasFreeSlots(player)) return reject(player, "You need a free inventory space for the waking sleep vial.");
      player.getInventory().adds(WAKING_SLEEP_VIAL, 1);
      return;
    }
    if (stepId === "eqgwkv") {
      if (!inDream(player) || stageOf(player) < STAGE_DREAM) return;
      markChallenge(player, "emote", true);
    }
  }

  // ==========================================================================
  // Items
  // ==========================================================================

  function handleItemOnItem(event) {
    const { player, usedItemId, usedWithItemId } = event;
    const pair = new Set([usedItemId, usedWithItemId]);
    const inLanternTask = stageBetween(player, STAGE_SUSPECT_BOY, STAGE_LUNAR_ISLE);
    const inPotionTask = stageOf(player) >= STAGE_POTION_TASK;
    const inClothesTask = stageBetween(player, STAGE_STAFF_GIVEN, STAGE_KINDLING);
    const inCeremony = stageBetween(player, STAGE_KINDLING, STAGE_COMPLETE);

    if (inLanternTask && pair.has(EMERALD_LENS) && [...pair].some((id) => LANTERN_IDS.has(id) || id === EMERALD_LANTERN)) {
      event.handled = true;
      if (!held(player, EMERALD_LENS)) return;
      const lantern = [...pair].find((id) => LANTERN_IDS.has(id) || id === EMERALD_LANTERN);
      if (lantern === undefined) return;
      if (held(player, EMERALD_LANTERN) || held(player, EMERALD_LANTERN_LIT)) {
        player.sendMessage("You already have an emerald lantern.");
        return;
      }
      player.getInventory().deleteNumber(EMERALD_LENS, 1);
      player.getInventory().deleteNumber(lantern, 1);
      player.getInventory().adds(EMERALD_LANTERN, 1);
      player.sendMessage("You fit the emerald lens to the lantern.");
      return;
    }

    if (inLanternTask && pair.has(TINDERBOX) && (pair.has(EMERALD_LANTERN) || pair.has(EMERALD_LANTERN_LIT))) {
      event.handled = true;
      if (!held(player, EMERALD_LANTERN)) {
        player.sendMessage("The emerald lantern is already lit.");
        return;
      }
      player.getInventory().deleteNumber(EMERALD_LANTERN, 1);
      player.getInventory().adds(EMERALD_LANTERN_LIT, 1);
      player.sendMessage("You light the emerald lantern.");
      return;
    }

    if (inPotionTask && pair.has(GUAM_LEAF) && pair.has(LUNAR_VIAL_WATER)) {
      event.handled = true;
      if (!held(player, GUAM_LEAF) || !held(player, LUNAR_VIAL_WATER)) return;
      player.getInventory().deleteNumber(GUAM_LEAF, 1);
      player.getInventory().deleteNumber(LUNAR_VIAL_WATER, 1);
      player.getInventory().adds(GUAM_VIAL, 1);
      player.sendMessage("You add the guam leaf to the vial.");
      return;
    }
    if (inPotionTask && pair.has(MARRENTILL) && pair.has(GUAM_VIAL)) {
      event.handled = true;
      if (!held(player, MARRENTILL) || !held(player, GUAM_VIAL)) return;
      player.getInventory().deleteNumber(MARRENTILL, 1);
      player.getInventory().deleteNumber(GUAM_VIAL, 1);
      player.getInventory().adds(GUAM_MARR_VIAL, 1);
      player.sendMessage("You add the marrentill to the vial.");
      return;
    }
    if (inPotionTask && pair.has(PESTLE_AND_MORTAR) && pair.has(SUQAH_TOOTH)) {
      event.handled = true;
      if (!held(player, SUQAH_TOOTH)) return;
      player.getInventory().deleteNumber(SUQAH_TOOTH, 1);
      player.getInventory().adds(GROUND_TOOTH, 1);
      player.sendMessage("You grind the suqah tooth to dust.");
      return;
    }
    if (inPotionTask && pair.has(GROUND_TOOTH) && pair.has(GUAM_MARR_VIAL)) {
      event.handled = true;
      if (!held(player, GROUND_TOOTH) || !held(player, GUAM_MARR_VIAL)) return;
      player.getInventory().deleteNumber(GROUND_TOOTH, 1);
      player.getInventory().deleteNumber(GUAM_MARR_VIAL, 1);
      player.getInventory().adds(WAKING_SLEEP_VIAL, 1);
      player.sendMessage("You add the ground tooth to the vial. The waking sleep potion is ready.");
      return;
    }
    if (inCeremony && pair.has(WAKING_SLEEP_VIAL) && pair.has(KINDLING)) {
      event.handled = true;
      if (!held(player, WAKING_SLEEP_VIAL) || !held(player, KINDLING)) return;
      player.getInventory().deleteNumber(WAKING_SLEEP_VIAL, 1);
      player.getInventory().deleteNumber(KINDLING, 1);
      player.getInventory().adds(SOAKED_KINDLING, 1);
      player.sendMessage("You soak the kindling with the potion.");
      return;
    }
    if (inClothesTask && pair.has(NEEDLE) && pair.has(SUQAH_LEATHER)) {
      event.handled = true;
      openLeatherMenu(player);
      return;
    }
  }

  function openLeatherMenu(player) {
    if (!stageBetween(player, STAGE_STAFF_GIVEN, STAGE_KINDLING)) {
      player.sendMessage("You are not ready to make lunar clothing yet.");
      return;
    }
    if (!held(player, NEEDLE) || !held(player, THREAD)) {
      player.sendMessage("You need a needle and thread to craft lunar clothing.");
      return;
    }
    if (player.getInventory().getFreeSlots() === 0) {
      player.sendMessage("You need a free inventory space to craft lunar clothing.");
      return;
    }
    const make = (itemId) => () => {
      if (!held(player, SUQAH_LEATHER)) {
        player.sendMessage("You need more suqah leather.");
        return;
      }
      player.getInventory().deleteNumber(SUQAH_LEATHER, 1);
      player.getInventory().adds(itemId, 1);
      player.sendMessage(`You craft a ${itemName(itemId)}.`);
    };
    api.sendMultiChatboxPrompt(
      player,
      "What would you like to make?",
      "Lunar torso",
      make(LUNAR_TORSO),
      "Lunar legs",
      make(LUNAR_LEGS),
      "Lunar gloves",
      make(LUNAR_GLOVES),
      "Lunar boots",
      make(LUNAR_BOOTS)
    );
  }

  /**
   * The Waking Dream ceremony is the Moon Clan initiation: the brazier must be lit
   * and the player must wear all nine lunar items before the soaked kindling opens
   * the Dream World. Both the object click and the item-on-object path go through
   * these guards, so a wrong stage or a missing item never changes state.
   */
  function lightCeremonialBrazier(player, objectId) {
    if (stageOf(player) < STAGE_KINDLING) {
      return reject(player, "You are not ready to take part in the Moon Clan ceremony yet.");
    }
    if (isBrazierLit(player) || objectId === CEREMONIAL_BRAZIER_LIT) {
      return reject(player, "The brazier is already lit.");
    }
    if (!held(player, TINDERBOX)) return reject(player, "You need a tinderbox to light the brazier.");
    player.setAttribute(BRAZIER_ATTRIBUTE, true);
    player.getPacketSender().sendVarbit(VARBIT_BRAZIER_LIT, 1);
    player.sendMessage("You light the ceremonial brazier.");
    return true;
  }

  function completeBrazierCeremony(player) {
    if (!stageBetween(player, STAGE_KINDLING, STAGE_COMPLETE)) return false;
    if (!isBrazierLit(player)) return reject(player, "You need to light the brazier first.");
    if (!wearingCeremonial(player)) {
      return reject(player, "You need to wear all of the lunar ceremonial equipment and hold the lunar staff.");
    }
    if (!held(player, SOAKED_KINDLING)) return reject(player, "You need the soaked kindling.");
    player.getInventory().deleteNumber(SOAKED_KINDLING, 1);
    enterDream(player);
    return true;
  }

  function handleCeremonialBrazier(event) {
    const objectId = event.objectId ?? event.object?.getId?.();
    if (!isCeremonialBrazier(objectId)) return false;
    const option = String(event.option ?? "").toLowerCase();
    if (option === "light") {
      event.handled = true;
      lightCeremonialBrazier(event.player, objectId);
      return true;
    }
    if (option === "add-kindling" || option === "use-kindling" || option === "use") {
      event.handled = true;
      startTranscript(
        api,
        event.player,
        NpcIdentifiers.ETHEREAL_BEING,
        PAGE,
        "visiting-the-dream-world-using-soaked-kindling-on-the-brazier"
      );
      return true;
    }
    return false;
  }

  /**
   * The Astral Altar is the Lunar spellbook's attunement point. Before the quest it
   * refuses both runecrafting and prayer; afterwards Pray toggles Lunar/Standard
   * (Wiki: Astral Altar). Craft-rune stays with Runecrafting.plugin.js.
   */
  function handleAstralAltar(event) {
    const objectId = event.objectId ?? event.object?.getId?.();
    if (objectId !== ASTRAL_ALTAR) return false;
    const player = event.player;
    const option = String(event.option ?? "").toLowerCase();
    if (!quest.isComplete(player)) {
      if (option !== "craft-rune" && option !== "pray" && option !== "pray-at") return false;
      event.handled = true;
      startTranscript(
        api,
        player,
        NpcIdentifiers.ONEIROMANCER,
        PAGE,
        option === "craft-rune"
          ? "lunar-isle-trying-to-craft-a-rune-at-the-astral-altar"
          : "lunar-isle-trying-to-pray-at-the-astral-altar"
      );
      return true;
    }
    if (option !== "pray" && option !== "pray-at") return false;
    event.handled = true;
    const wasLunar = player.getSpellbook?.() === MagicSpellbook.LUNAR;
    const target = wasLunar ? MagicSpellbook.NORMAL : MagicSpellbook.LUNAR;
    player.performAnimation?.(PRAY_AT_ALTAR_ANIMATION);
    Sounds.sendSound(player, Sound.PRAYER_RECHARGE);
    MagicSpellbook.changeSpellbook(player, target);
    if (player.getSpellbook?.() !== target) return true;
    player.sendMessage(wasLunar ? LUNAR_SPELLS_DEACTIVATED : LUNAR_SPELLS_ACTIVATED);
    return true;
  }

  function handleItemOnObject(event) {
    const { player, itemId } = event;
    const objectId = resolvedObjectId(event);

    if (itemId === SPADE && objectId === RING_FLOWERS && nearTile(event.location, RING_TILE, 2)) {
      event.handled = true;
      if (!stageBetween(player, STAGE_STAFF_GIVEN, STAGE_KINDLING)) {
        return reject(player, "You have no reason to dig up the Moon Clan's flowers.");
      }
      if (held(player, LUNAR_RING) || oneiroGiven(player).ring) {
        return reject(player, "You already have the lunar ring.");
      }
      if (!hasFreeSlots(player)) return reject(player, "You need a free inventory space for the lunar ring.");
      startTranscript(api, player, SELENE_ID, PAGE, "obtaining-the-lunar-clothing-digging-up-the-lunar-ring");
      player.getInventory().adds(LUNAR_RING, 1);
      return;
    }

    if (itemId === LUNAR_VIAL_EMPTY && (objectId === WATER_SOURCE || SINK_IDS.has(objectId))) {
      event.handled = true;
      if (stageOf(player) < STAGE_POTION_TASK) {
        return reject(player, "You have no reason to fill that vial yet.");
      }
      if (!held(player, LUNAR_VIAL_EMPTY)) return false;
      player.getInventory().deleteNumber(LUNAR_VIAL_EMPTY, 1);
      player.getInventory().adds(LUNAR_VIAL_WATER, 1);
      player.sendMessage("You fill the vial with water.");
      return;
    }

    if (itemId === LUNAR_ORE && ObjectDefinition.forId(objectId)?.getName?.() === "Furnace") {
      event.handled = true;
      if (stageOf(player) < STAGE_STAFF_GIVEN) {
        return reject(player, "You are not ready to work lunar ore yet.");
      }
      if (!held(player, LUNAR_ORE)) return false;
      player.getInventory().deleteNumber(LUNAR_ORE, 1);
      player.getInventory().adds(LUNAR_BAR, 1);
      player.sendMessage("You smelt the lunar ore into a lunar bar.");
      return;
    }

    // Only while this quest still needs the bars: after Lunar Diplomacy the same
    // lunar bar on an anvil is The Fremennik Exiles' V sigil hand-in.
    if (
      itemId === LUNAR_BAR &&
      stageBetween(player, STAGE_STAFF_GIVEN, STAGE_KINDLING) &&
      ObjectDefinition.forId(objectId)?.getName?.() === "Anvil"
    ) {
      event.handled = true;
      if (!held(player, LUNAR_BAR)) return false;
      if (!held(player, HAMMER)) {
        return reject(player, "You need a hammer to work the lunar bar.");
      }
      if (!hasFreeSlots(player)) {
        return reject(player, "You need a free inventory space for the helm.");
      }
      player.getInventory().deleteNumber(LUNAR_BAR, 1);
      player.getInventory().adds(LUNAR_HELM, 1);
      player.sendMessage("You hammer the lunar bar into a helm.");
      return;
    }

    if (itemId === DRAMEN_STAFF || [LUNAR_STAFF_PT1, LUNAR_STAFF_PT2, LUNAR_STAFF_PT3].includes(itemId)) {
      if (!stageBetween(player, STAGE_POTION_GIVEN, STAGE_KINDLING)) return false;
      const next = altarStaffResult(objectId, itemId);
      if (!next) return false;
      event.handled = true;
      player.getInventory().deleteNumber(itemId, 1);
      player.getInventory().adds(next, 1);
      return;
    }

    if (isCeremonialBrazier(objectId)) {
      if (itemId === TINDERBOX) {
        event.handled = true;
        lightCeremonialBrazier(player, objectId);
        return;
      }
      if (itemId === SOAKED_KINDLING) {
        event.handled = true;
        if (!stageBetween(player, STAGE_KINDLING, STAGE_COMPLETE)) {
          return reject(player, "You are not ready to take part in the Moon Clan ceremony yet.");
        }
        startTranscript(api, player, NpcIdentifiers.ETHEREAL_BEING, PAGE, "visiting-the-dream-world-using-soaked-kindling-on-the-brazier");
        return;
      }
    }

    if (itemId === EMERALD_LANTERN_LIT && SYMBOL_OBJECT_IDS.has(objectId) && inShipBox(event.location)) {
      if (stageOf(player) < STAGE_SYMBOLS || stageOf(player) >= STAGE_LUNAR_ISLE) return;
      const key = `${objectId}@${event.location.x},${event.location.y}`;
      if (symbolList(player).includes(key)) return;
      event.handled = true;
      player.setAttribute(PENDING_SYMBOL_ATTRIBUTE, key);
      startTranscript(api, player, NpcIdentifiers.CABIN_BOY, PAGE, "pirates-cove-using-the-emerald-lantern-on-the-ship-s-scenery-if-the-scenery-has-a-symbol");
    }
  }

  function altarStaffResult(objectId, itemId) {
    if (objectId === AIR_ALTAR && itemId === DRAMEN_STAFF) return LUNAR_STAFF_PT1;
    if (objectId === FIRE_ALTAR && itemId === LUNAR_STAFF_PT1) return LUNAR_STAFF_PT2;
    if (objectId === WATER_ALTAR && itemId === LUNAR_STAFF_PT2) return LUNAR_STAFF_PT3;
    if (objectId === EARTH_ALTAR && itemId === LUNAR_STAFF_PT3) return LUNAR_STAFF;
    return null;
  }

  // ==========================================================================
  // Objects and NPCs
  // ==========================================================================

  function mineStalagmite(event) {
    const { player } = event;
    if (!STALAGMITE_IDS.has(event.objectId)) return false;
    if (stageOf(player) < STAGE_STAFF_GIVEN) return false;
    event.handled = true;
    if (!hasAnyPickaxe(player)) {
      player.sendMessage("You need a pickaxe to mine the stalagmite.");
      return true;
    }
    if (!hasFreeSlots(player)) {
      player.sendMessage("You need a free inventory space for the lunar ore.");
      return true;
    }
    player.getInventory().adds(LUNAR_ORE, 1);
    player.sendMessage("You mine some lunar ore.");
    return true;
  }

  function readMyLife(event) {
    const { player } = event;
    if (event.objectId !== MY_LIFE) return false;
    if (!inDream(player) || stageOf(player) < STAGE_DEFEATED) return false;
    event.handled = true;
    startTranscript(api, player, NpcIdentifiers.ETHEREAL_BEING, PAGE, "visiting-the-dream-world-reading-my-life");
    return true;
  }

  /**
   * Ladders owns the "Stairs" name, so the galleon's deck/forecastle climb is claimed
   * through its ladders:climb event. The captured loc-teleport rows only move z1<->z2,
   * leaving Lee and the cabin boy on z3 unreachable without a teleport; step one plane
   * and land on the nearest walkable tile.
   */
  function climbShipStairs(request) {
    if (request?.handled) return;
    const object = request?.object;
    const location = object?.getLocation?.() ?? request?.location;
    if (!location || !inShipBox(location)) return;
    const objectId = request?.objectId ?? object?.getId?.();
    const fromZ = coordZ(location);
    const targetZ =
      objectId === SHIP_STAIRS_BOTTOM && fromZ === 2 ? 3
        : objectId === SHIP_STAIRS_TOP && fromZ === 3 ? 2
          : null;
    if (targetZ === null) return;
    const destination = stairLanding(coordX(location), coordY(location), targetZ);
    if (!destination) return;
    request.handled = true;
    request.player.moveTo(destination);
  }

  /**
   * The forecastle's walls make walkToObject end its route on the tile the player
   * already stands on, which the reach check then rejects, so a "Climb" click from the
   * z3 landing dies with "You can't reach that!" before Ladders can claim it. Claim the
   * route as well and resolve the interaction in place; climbShipStairs moves the plane.
   */
  function routeShipStairs(event) {
    const objectId = event?.objectId;
    if (objectId !== SHIP_STAIRS_BOTTOM && objectId !== SHIP_STAIRS_TOP) return;
    const location = event.object?.getLocation?.();
    if (!location || !inShipBox(location)) return;
    const z = coordZ(location);
    const claimed = objectId === SHIP_STAIRS_BOTTOM ? z === 2 : z === 3;
    if (!claimed) return;
    const here = event.player.getLocation();
    event.destination = { x: coordX(here), y: coordY(here), z: coordZ(here) };
  }

  function stairLanding(x, y, z) {
    for (const [dx, dy] of STAIR_LANDING_STEPS) {
      const tile = new Location(x + dx, y + dy, z);
      if (!RegionManager.blocked(tile, null)) return tile;
    }
    return null;
  }

  /** Spring platforms ferry between the centre island and a challenge island, and back. */
  function stepDreamPlatform(event) {
    const { player } = event;
    if (!DREAM_PLATFORM_IDS.has(event.objectId)) return false;
    if (!inDream(player)) return false;
    event.handled = true;
    const px = coordX(event.location);
    const py = coordY(event.location);
    const link =
      DREAM_PLATFORM_LINKS.find((entry) => entry.x === px && entry.y === py) ??
      DREAM_PLATFORM_LINKS.reduce((best, entry) =>
        Math.hypot(entry.x - px, entry.y - py) < Math.hypot(best.x - px, best.y - py) ? entry : best
      );
    const here = { x: coordX(player.getLocation()), y: coordY(player.getLocation()) };
    const atCentre =
      Math.hypot(here.x - DREAM_CENTRE.x, here.y - DREAM_CENTRE.y) <= Math.hypot(here.x - link.tx, here.y - link.ty);
    player.moveTo(
      new Location(atCentre ? link.tx : DREAM_CENTRE.x, atCentre ? link.ty : DREAM_CENTRE.y, DREAM_ENTRY.getZ())
    );
    return true;
  }

  function handleNpcDeath(event) {
    const npcId = event.npcId ?? event.npc?.getId?.();
    // Suqah loot is rolled by NpcDrops.plugin.js. Their deaths never advance the
    // quest stage on their own; the tooth, hides and tiara are the objectives.
    if (SUQAH_IDS.has(npcId)) return;
    if (!ME_IDS.has(npcId)) return;
    const player = event.killer?.isPlayer?.() ? event.killer : null;
    if (!player) return;
    const tracked = bossNpcs.get(player);
    if (tracked && event.npc && tracked !== event.npc) return;
    bossNpcs.delete(player);
    if (stageOf(player) !== STAGE_FIGHT) return;
    setStage(player, STAGE_DEFEATED);
  }

  /**
   * npc-drops.json gates A special tiara behind "after asking Meteora about her
   * headgear". Answering the row keeps the 1/2 Suqah pre-roll from dropping the
   * tiara before the player has heard the clue, or a duplicate after they have
   * already exchanged it.
   */
  function handleQuestItemDrop(event) {
    if (event.itemId !== SPECIAL_TIARA || event.requirement?.key !== TIARA_DROP_QUEST_KEY) return;
    const player = event.player;
    event.allowed =
      quest.isStarted(player) &&
      !quest.isComplete(player) &&
      stageBetween(player, STAGE_STAFF_GIVEN, STAGE_KINDLING) &&
      player.getAttribute(METEORA_INTRO_ATTRIBUTE) === true &&
      !held(player, SPECIAL_TIARA) &&
      !held(player, LUNAR_AMULET) &&
      !oneiroGiven(player).amulet;
  }

  // ==========================================================================
  // Dream World
  // ==========================================================================

  function sailToPiratesCove(player) {
    if (stageOf(player) !== STAGE_SEAL || !held(player, SEAL_OF_PASSAGE)) return;
    setStage(player, STAGE_SAILED);
    player.moveTo(PIRATES_COVE_DOCKS);
    ensureJack(player);
  }

  function enterDream(player) {
    if (!stageBetween(player, STAGE_KINDLING, STAGE_COMPLETE)) return;
    setStage(player, STAGE_DREAM);
    player.moveTo(DREAM_ENTRY);
    spawnDreamNpcs(player);
  }

  function leaveDream(player) {
    if (stageOf(player) < STAGE_DEFEATED) return;
    player.moveTo(DREAM_EXIT);
    if (stageOf(player) === STAGE_DEFEATED) setStage(player, STAGE_AWAKE);
    removeDreamNpcs(player);
  }

  function spawnDreamNpcs(player) {
    removeDreamNpcs(player);
    const npcs = [];
    for (const spawn of DREAM_NPC_SPAWNS) {
      const npc = api.spawnNpc({
        id: spawn.id,
        x: spawn.x,
        y: spawn.y,
        z: DREAM_ENTRY.getZ(),
        wanderRadius: 0,
        owner: player,
        ownerOnly: true,
      });
      if (npc) npcs.push(npc);
    }
    dreamNpcs.set(player, npcs);
  }

  function removeDreamNpcs(player) {
    const npcs = dreamNpcs.get(player) ?? [];
    for (const npc of npcs) api.removeNpc(npc);
    dreamNpcs.delete(player);
    removeBoss(player);
  }

  function removeBoss(player) {
    const npc = bossNpcs.get(player);
    if (npc) {
      api.removeNpc(npc);
      bossNpcs.delete(player);
    }
  }

  function startFinalFight(player) {
    const stage = stageOf(player);
    if (!inDream(player) || stage < STAGE_DREAM || stage > STAGE_FIGHT) return;
    if (stage < STAGE_FIGHT) {
      if (!allChallengesDone(player)) return;
      setStage(player, STAGE_FIGHT);
    }
    // Stage 165 also enters here from login reconciliation: the saved fight is
    // restored even though the readiness dialogue may no longer be available.
    removeBoss(player);
    const npc = api.spawnNpc({
      id: NpcIdentifiers.ME,
      x: ME_TILE.x,
      y: ME_TILE.y,
      z: DREAM_ENTRY.getZ(),
      wanderRadius: 0,
      owner: player,
      ownerOnly: true,
    });
    if (npc) bossNpcs.set(player, npc);
  }

  function reconcileDreamNpcs(player) {
    const world = api.getWorld();
    if (world?.getNpcs) {
      for (const npc of world.getNpcs()) {
        if (npc?.getOwner?.() === player && DREAM_SPAWN_IDS.has(npc.getId?.())) api.removeNpc(npc);
      }
    }
    dreamNpcs.delete(player);
    bossNpcs.delete(player);
    if (!inDream(player)) return;
    if (stageOf(player) < STAGE_DREAM) return;
    spawnDreamNpcs(player);
    if (stageOf(player) === STAGE_FIGHT) startFinalFight(player);
  }

  /**
   * npc-spawns.json places Baba Yaga at (2450,4647), nowhere near her chicken house
   * at (2088,3931); the quest needs her, so an owner-only copy stands in for the
   * player until the quest is complete.
   */
  function ownedBabaYaga(player) {
    const world = api.getWorld();
    if (!world?.getNpcs) return null;
    for (const npc of world.getNpcs()) {
      if (npc?.getId?.() === BABA_YAGA_ID && npc.getOwner?.() === player) return npc;
    }
    return null;
  }

  function ensureBabaYaga(player) {
    // Her cache spawn is misplaced far from the Lunar Isle chicken house. Keep the
    // canonical shop NPC available after Lunar Diplomacy too: later quests (notably
    // Dragon Slayer II) need the astral runes sold here.
    if (stageOf(player) < STAGE_LUNAR_ISLE) {
      removeOwnedBabaYaga(player);
      return;
    }
    if (ownedBabaYaga(player)) return;
    api.spawnNpc({
      id: BABA_YAGA_ID,
      x: BABA_HOUSE.x,
      y: BABA_HOUSE.y,
      z: 0,
      wanderRadius: 0,
      owner: player,
      ownerOnly: true,
    });
  }

  function removeOwnedBabaYaga(player) {
    const npc = ownedBabaYaga(player);
    if (npc) api.removeNpc(npc);
  }

  /**
   * npc-spawns.json has no Lady Zay navigator (3861) at all; the quest spawns an
   * owner-only copy aboard whichever ship the player is on.
   */
  function ownedJack(player) {
    const world = api.getWorld();
    if (!world?.getNpcs) return null;
    for (const npc of world.getNpcs()) {
      if (npc?.getId?.() === JACK_SHIP && npc.getOwner?.() === player) return npc;
    }
    return null;
  }

  function ensureJack(player) {
    if (quest.isComplete(player) || stageOf(player) < STAGE_SAILED) {
      removeOwnedJack(player);
      return;
    }
    const want = stageOf(player) >= STAGE_LUNAR_ISLE ? JACK_LUNAR_TILE : JACK_COVE_TILE;
    const existing = ownedJack(player);
    if (existing) {
      const location = existing.getLocation?.();
      if (coordX(location) === want.x && coordY(location) === want.y) return;
      api.removeNpc(existing);
    }
    api.spawnNpc({
      id: JACK_SHIP,
      x: want.x,
      y: want.y,
      z: 0,
      wanderRadius: 0,
      owner: player,
      ownerOnly: true,
    });
  }

  function removeOwnedJack(player) {
    const npc = ownedJack(player);
    if (npc) api.removeNpc(npc);
  }

  /**
   * Pins the world Bentley and Davey-boy to a deck tile (see PINNED_CREW): they
   * otherwise wander with radius 5 onto bow tiles the deck has no walk route to.
   * Idempotent, called on login so it happens before anyone can walk up to them.
   */
  function pinShipCrew() {
    const world = api.getWorld();
    if (!world?.getNpcs) return;
    for (const npc of world.getNpcs()) {
      const pin = PINNED_CREW.get(npc?.getId?.());
      if (!pin) continue;
      const location = npc.getLocation?.();
      if (!location || !inShipBox(location)) continue;
      const tile = coordX(location) >= SHIP_BOXES[1].x0 ? pin.cove : pin.lunar;
      npc.getMovementCoordinator?.().setRadius?.(0);
      if (coordX(location) === tile.x && coordY(location) === tile.y && coordZ(location) === 2) continue;
      npc.moveTo(new Location(tile.x, tile.y, 2));
    }
  }

  // ==========================================================================
  // Login / reset
  // ==========================================================================

  function handleLogin({ player }) {
    syncVarbits(player);
    reconcileDreamNpcs(player);
    ensureBabaYaga(player);
    ensureJack(player);
    pinShipCrew();
  }

  function handleBootstrap({ player }) {
    syncVarbits(player);
  }

  function handleStageChanged(event) {
    if (event?.key !== "lunar_diplomacy" || !event.player) return;
    if ((event.stage | 0) === 0) {
      resetQuestState(event.player);
      return;
    }
    syncVarbits(event.player);
    ensureBabaYaga(event.player);
    ensureJack(event.player);
  }

  function resetQuestState(player) {
    for (const attribute of [
      SYMBOLS_ATTRIBUTE,
      PENDING_SYMBOL_ATTRIBUTE,
      ONEIRO_GIVEN_ATTRIBUTE,
      BABA_INTRO_ATTRIBUTE,
      SELENE_INTRO_ATTRIBUTE,
      METEORA_INTRO_ATTRIBUTE,
      RIMAE_INTRO_ATTRIBUTE,
      PAULINE_INTRO_ATTRIBUTE,
      BRAZIER_ATTRIBUTE,
      BEING_INTRO_ATTRIBUTE,
      CHALLENGES_ATTRIBUTE,
    ]) {
      player.setAttribute(attribute, null);
    }
    removeDreamNpcs(player);
    removeOwnedBabaYaga(player);
    removeOwnedJack(player);
    if (inDream(player)) player.moveTo(DREAM_EXIT);
    syncVarbits(player);
  }

  // ==========================================================================
  // Registration
  // ==========================================================================

  for (const attribute of [
    SYMBOLS_ATTRIBUTE,
    PENDING_SYMBOL_ATTRIBUTE,
    ONEIRO_GIVEN_ATTRIBUTE,
    BABA_INTRO_ATTRIBUTE,
    SELENE_INTRO_ATTRIBUTE,
    METEORA_INTRO_ATTRIBUTE,
    RIMAE_INTRO_ATTRIBUTE,
    PAULINE_INTRO_ATTRIBUTE,
    BRAZIER_ATTRIBUTE,
    BEING_INTRO_ATTRIBUTE,
    CHALLENGES_ATTRIBUTE,
  ]) {
    api.persistAttribute(attribute);
  }

  quest = registerQuest(api, {
    key: "lunar_diplomacy",
    name: "Lunar Diplomacy",
    varpId: 823,
    varbitId: VARBIT_STAGE,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 2,
    xpRewards: [
      { skillId: Skill.MAGIC.getIndex(), amount: 5000, label: "Magic" },
      { skillId: Skill.RUNECRAFTING.getIndex(), amount: 5000, label: "Runecraft" },
    ],
    scrollItemId: ASTRAL_RUNE,
    otherRewards: [
      "A Seal of Passage",
      "Access to Lunar Isle and the Lunar equipment",
      "Access to the Lunar spellbook and 50 astral runes",
    ],
    buildJournal,
    onReward: grantReward,
  });

  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onNpcInteraction(talkToBrundt);
  api.onCustomEvent("npc-dialogue:condition", handleCondition);
  api.onCustomEvent("npc-dialogue:choice", handleChoice);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onCustomEvent("npc-dialogue:line", handleLine);
  api.onCustomEvent("npc-dialogue:hook", handleHook);
  api.onCustomEvent("ladders:climb", climbShipStairs);
  api.onObjectRoute(routeShipStairs);
  api.onItemOnItem(handleItemOnItem, { noted: false });
  api.onItemOnObject(handleItemOnObject, { noted: false });
  api.onObjectInteraction("Stalagmite", { Mine: mineStalagmite });
  api.onObjectInteraction("Stalagmites", { Mine: mineStalagmite });
  api.onObjectInteraction("My life", { Read: readMyLife });
  api.onObjectInteraction("Platform", { "Step-on": stepDreamPlatform });
  api.onObjectInteraction(handleAstralAltar);
  api.onObjectInteraction("Altar", { "Craft-rune": handleAstralAltar, Pray: handleAstralAltar, "Pray-at": handleAstralAltar });
  api.onObjectInteraction(handleCeremonialBrazier);
  api.onObjectInteraction("Ceremonial Brazier", { Light: handleCeremonialBrazier });
  if (typeof api.onBeforeObjectInteraction === "function") api.onBeforeObjectInteraction(handleAstralAltar);
  api.onCustomEvent("npc-drops:quest-item", handleQuestItemDrop);
  api.onNpcDeath(handleNpcDeath);
  api.onPlayerLogin(handleLogin);
  api.onCustomEvent("player:bootstrap-complete", handleBootstrap);
  api.onCustomEvent("quest:stage-changed", handleStageChanged);

  function grantReward(player) {
    const skills = player.getSkillManager();
    skills.addExperiences(Skill.MAGIC, 5000);
    skills.addExperiences(Skill.RUNECRAFTING, 5000);
    player.getInventory().adds(ASTRAL_RUNE, 50);
  }
};
