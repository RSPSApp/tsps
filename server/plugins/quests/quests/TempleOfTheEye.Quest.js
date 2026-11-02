/**
 * Temple of the Eye (members).
 *
 * The words come from the "Temple of the Eye" transcript page
 * (data/definitions/npc-dialogues.json; https://oldschool.runescape.wiki/w/Transcript:Temple_of_the_Eye)
 * and the OSRS Wiki quest page / quick guide. This plugin supplies the per-stage
 * variant selection for Persten, the Mage of Zamorak, the Tea Seller, the Dark
 * Mage, Sedridor, Traiborn and the six apprentice spawns, the prose-condition
 * answers, the hand-ins, the Abyss energy puzzle, the Temple of the Eye tutorial
 * interactions and the completion reward.
 *
 * Stages are the real varbit 13738 "tote" values, cross-checked against RuneLite
 * Quest Helper's step map (pinned commit 06da90f, TempleOfTheEye.java):
 *   0 not started (declining keeps 0)
 *   5 accepted; show the eye amulet to the Mage of Zamorak
 *  10 the Mage appraised the amulet and wants a bucket of water and strong tea
 *  15 the tea is in hand; return to the Mage
 *  20 the Mage drank the tea and offers a one-time Abyss teleport
 *  25 in the Abyss; talk to the Dark Mage
 *  30 the Dark Mage is working on the amulet; the six energies are active
 *  35 work out the energy order
 *  40 the order is solved; claim the incantation
 *  45 take the incantation back to Persten
 *  50 Persten has copied it and asks for the amulet back
 *  55 the amulet is back with Persten
 *  60 head to Archmage Sedridor in the Wizards' Tower basement
 *  65 Sedridor has the incantation; speak to Traiborn
 *  70 Traiborn wants his three apprentices' riddle solved
 *  75 the three riddles have been seen; tell Traiborn the answer
 *  80 Traiborn's fireworks solved the riddle; return to Sedridor
 *  85 Sedridor is ready to attempt the incantation
 *  90 the incantation cutscene has begun
 *  95 the portal to the Temple of the Eye is open
 * 100 explore the temple and speak to the three apprentices
 * 105 speak to Persten about the markings
 * 110 the vision is over; regroup with the others
 * 115 the Great Guardian asks for the cells to be used (tutorial)
 * 120 the rift is sealed and Sedridor's cutscene plays
 * 125 Sedridor's debrief; 130 complete (captured 125 -> 130)
 *
 * The Guardians of the Rift tutorial keeps its own progress attribute so the
 * quest varbit stays at 115 for its whole duration (`varbit 13759` in OSRS). The third
 * power-up moves the quest to 120 and the closing scene to 125, as captured.
 *
 * Rewards per the OSRS Wiki: 1 Quest Point, 5,000 Runecraft experience (a further
 * 4,210 is gained during the quest; capture 1693 gives it step by step: 30 for each weak cell
 * placed or assembled, 230 and 250 at the altars, 750, 750 and 1,650 for the power-ups, 100 for
 * the medium guardian and 110 for the strengthened barrier), access to the Guardians of the Rift minigame and a medium pouch
 * (if not already owned).
 *
 * Source: OSRS Wiki (https://oldschool.runescape.wiki/w/Temple_of_the_Eye and
 * /Quick_guide, /Transcript:Temple_of_the_Eye); ids from scripts/lookup-gameval.ts,
 * the cache dumps and the npc/item/object identifier files.
 *
 * Temple scenes follow capture 1693 and Quest Helper's tiles. Live builds an instance from two
 * template squares that are also real, unreachable map: the untouched temple (2368-2431,
 * 5632-5695, stages 95-110 and the closing scene; the vision is just north of it) and the
 * temple with its rift, cells and fallen guardians (2432-2495, 5696-5759, the tutorial). Those
 * are the source coordinates the captured cameras point at, so the player stands on them with
 * owner-only NPCs and locs. Nobody meets the minigame's own world spawns.
 *
 * Gaps / approximations:
 * - Enter the Abyss is a real prerequisite. The Mage of Zamorak is left to that
 *   miniquest until it is complete, so legacy saves that started or finished
 *   Temple of the Eye before Enter the Abyss existed can still complete it.
 *   The 10 Runecrafting requirement is enforced through the transcript's own
 *   condition (unboosted level).
 * - The temple squares are shared map rather than a per-player instance: two players on the same
 *   step can see each other, though never each other's NPCs or locs.
 * - The tutorial's fight is staged: one abyssal creature at a time walks to the barrier and the
 *   player's rift guardians kill it. Live's numbers aren't captured.
 * - The three apprentice riddles use cache interface 291 (captured if_opensub
 *   id=291, text children 5-16, close child 3); "see the puzzle again" reopens it.
 * - Cut-scene speech is chatbox dialogue with the captured chatheads and camera tracks.
 * - The Dark Mage energy puzzle uses the cache's six multi-loc objects around the
 *   Abyss centre (map ids 43842-43847 at the captured tiles); their per-energy
 *   varbit 13747-13752 selects the base (1) or white (2) transform. A per-player
 *   random order is kept in a persisted attribute, so two players can solve it at
 *   once. A wrong touch resets the marked prefix; all six clear on completion.
 * - Wizard Persten, the tower apprentices, the temple apprentices and the Great
 *   Guardian are owner-only quest spawns standing where capture 1693's varbit-driven
 *   multi-NPCs (11458-11461, tote 70-90 or 85-90) stand. The Mage of Zamorak is the world
 *   spawn (3229, cache child 2582), as captured.
 * - Altar trips use the real Mind/Water Altar maps through the tutorial's opened
 *   Guardian of Mind/Water; crafting guardian essence is handled by this quest
 *   before the Runecrafting plugin's generic altar handler, and the altars' exit
 *   portals return to the temple during the tutorial.
 * - Persten's, the Mage of Zamorak's and Sedridor's post-quest variants are only
 *   played while this quest is complete (the pages are shared with other content).
 * - The Abyss one-time teleport from the Mage of Zamorak is handled here; the
 *   Runecrafting plugin's Abyss teleport (the "Teleport" option) is left alone.
 * - The six journal objectives are ordered by the canonical stage. Every
 *   state-changing transcript action and hand-in checks that stage and the items
 *   the step consumes, so a skipped or replayed line cannot advance the quest.
 * - The eye amulet and Abyssal incantation are reclaimable from Persten, the
 *   Dark Mage or Sedridor while their hand-over is still current. They are
 *   destroyed on hand-in, on completion, and on the next login of a completed
 *   save; the tutorial's buckets, tea and cells are consumed by their steps.
 */
module.exports = function registerTempleOfTheEyeQuest(api) {
  const {
    Animation,
    Equipment,
    GameObject,
    Graphic,
    Item,
    ItemIdentifiers,
    Location,
    NpcIdentifiers,
    ObjectIdentifiers,
    ObjectManager,
    Skill,
  } = api.core;
  const { registerQuest, loadTranscripts, startTranscript } = require("../QuestRuntime");
  const { createQuestScenes } = require("../QuestScenes");
  const Scenes = createQuestScenes(api, {});

  const PAGE = "Temple of the Eye";

  // "tote" varbit (varp 3405 bits 0-8); the varp is shared with the other tote_*
  // bits, so the stage must be written as a varbit.
  const VARP_TOTE = 3405;
  const VARBIT_TOTE = 13738;
  const TOWER_PUZZLE_VARBITS = { cordelia: 13744, felix: 13743, tamara: 13742 };
  const TEMPLE_SEEN_VARBITS = { cordelia: 13756, felix: 13755, tamara: 13754 };
  const PUZZLE_GROUP = 291; // captured if_opensub id=291; children 5-16 are the riddle text
  const PUZZLE_CLOSE_UID = (PUZZLE_GROUP << 16) | 3;
  const PUZZLE_LINES = {
    felix: ["", "", "", "Water is six and Mind is eight.", "", "A thingummywut is less than two Body and more than", "two Earth.", "", "What is a thingummywut?", "", "", ""],
    tamara: ["", "", "", "Earth is five and Air is three.", "", "A thingummywut is less than three Fire and more than", "one Mind.", "", "What is a thingummywut?", "", "", ""],
    cordelia: ["", "", "", "Fire is four and Body is seven.", "", "A thingummywut is less than three Water and more", "than three Air.", "", "What is a thingummywut?", "", "", ""],
  };

  const STAGE_STARTED = 5;
  const STAGE_APPRAISED = 10;
  const STAGE_TEA_GIVEN = 15;
  const STAGE_TEA_DRUNK = 20;
  const STAGE_IN_ABYSS = 25;
  const STAGE_DARK_MAGE = 30;
  const STAGE_ENERGY = 35;
  const STAGE_ENERGY_DONE = 40;
  const STAGE_INCANTATION = 45;
  const STAGE_COPIED = 50;
  const STAGE_AMULET_RETURNED = 55;
  const STAGE_TOWER = 60;
  const STAGE_SEDRIDOR = 65;
  const STAGE_TRAIBORN = 70;
  const STAGE_RIDDLE = 75;
  const STAGE_RIDDLE_TOLD = 80;
  const STAGE_RIDDLE_DONE = 85;
  const STAGE_INCANTATION_READY = 90;
  const STAGE_PORTAL_OPEN = 95;
  const STAGE_TEMPLE = 100;
  const STAGE_APPRENTICES = 105;
  const STAGE_VISION = 110;
  const STAGE_GUARDIAN = 115;
  const STAGE_CLOSED = 120;
  const STAGE_FINAL = 125;
  const STAGE_COMPLETE = 130;

  // The six journal objectives, in the only order the stages allow. `at` is the
  // stage on which the objective is complete; the journal strikes it through.
  const OBJECTIVES = [
    { at: STAGE_APPRAISED, text: "Investigate the eye amulet with Wizard Persten." },
    { at: STAGE_TEA_DRUNK, text: "Bring Herbert, the Mage of Zamorak, a bucket of water and a strong cup of tea." },
    { at: STAGE_ENERGY_DONE, text: "Solve the Dark Mage's rune-order puzzle in the Abyss." },
    { at: STAGE_PORTAL_OPEN, text: "Open the Wizards' Tower portal." },
    { at: STAGE_GUARDIAN, text: "Explore the Temple of the Eye." },
    { at: STAGE_COMPLETE, text: "Complete the Guardians of the Rift tutorial to close the rift." },
  ];

  // Transcript message steps that change quest state. They are routed through
  // handleMessageStep even if a caller omits the dialogue runner's `kind`.
  const MESSAGE_STEP_IDS = new Set([
    "MMRv1P", "pNBge3", "wIL3wh", "FJLAsS", "QDRpz2", "L04HOi", "4t9kd_",
    "BOdA6N", "5f9QJZ", "PRt-AR", "qOBPPr", "9mZfyI", "SzAddC", "MZvnSC",
    "VVjWKh", "dFEOfF", "7fimNu", "anGHDo", "LUkI-K",
  ]);

  // Guardians of the Rift tutorial progress (the quest varbit stays at 115).
  const TUTORIAL_ATTRIBUTE = "temple-of-the-eye:tutorial";
  const STAGE_SCHEMA_ATTRIBUTE = "temple-of-the-eye:stage-schema";
  const STAGE_SCHEMA_VERSION = 2;
  const TUTORIAL_VARBIT = 13759; // "GotR tutorial progress", captured in 5s to 115
  const TUTORIAL_START = 0;
  const TUTORIAL_FELIX = 5;
  const TUTORIAL_TAMARA = 10;
  const TUTORIAL_CELL = 15;
  const TUTORIAL_PILE_ONE = 20;
  const TUTORIAL_PILES = 25;
  const TUTORIAL_ESSENCE = 30;
  const TUTORIAL_MIND_STONES = 35;
  const TUTORIAL_REPOWERED = 40;
  const TUTORIAL_POWERED_ONE = 45;
  const TUTORIAL_WATER_STONES = 50;
  const TUTORIAL_POWERED_TWO = 55;
  const TUTORIAL_MEDIUM_GUARDIAN = 60;
  const TUTORIAL_WATER_STONES_TWO = 65;
  const TUTORIAL_MEDIUM_CELL = 70;
  const TUTORIAL_CLOSED = 115;

  // NPC ids.
  const PERSTEN_ALKHARID_NPC_ID = NpcIdentifiers.WIZARD_PERSTEN; // 11436
  const PERSTEN_TOWER_NPC_ID = NpcIdentifiers.WIZARD_PERSTEN_2; // 11437
  const PERSTEN_CUTSCENE_NPC_ID = NpcIdentifiers.WIZARD_PERSTEN_3; // 11438
  const PERSTEN_TEMPLE_NPC_ID = NpcIdentifiers.WIZARD_PERSTEN_4; // 11439
  // The world spawns (cache multi-NPCs; capture 1693 talks to 3229 at the chapel).
  const WILDERNESS_MAGE_PARENT_NPC_ID = 3228;
  const CHAPEL_MAGE_PARENT_NPC_ID = 3229;
  const MAGE_OF_ZAMORAK_NPC_IDS = new Set([
    NpcIdentifiers.MAGE_OF_ZAMORAK, // 2580
    NpcIdentifiers.MAGE_OF_ZAMORAK_2, // 2581
    NpcIdentifiers.MAGE_OF_ZAMORAK_3, // 2582
    NpcIdentifiers.MAGE_OF_ZAMORAK_4, // 4936
    NpcIdentifiers.MAGE_OF_ZAMORAK_5, // 4937
    NpcIdentifiers.MAGE_OF_ZAMORAK_6, // 4938
    WILDERNESS_MAGE_PARENT_NPC_ID,
    CHAPEL_MAGE_PARENT_NPC_ID,
  ]);
  const DARK_MAGE_NPC_ID = NpcIdentifiers.DARK_MAGE; // 2583
  const TEA_SELLER_NPC_ID = NpcIdentifiers.TEA_SELLER; // 8687
  const SEDRIDOR_NPC_IDS = new Set([
    NpcIdentifiers.ARCHMAGE_SEDRIDOR, // 11432
    NpcIdentifiers.ARCHMAGE_SEDRIDOR_2, // 11433
    NpcIdentifiers.ARCHMAGE_SEDRIDOR_3, // 11450
  ]);
  const TRAIBORN_NPC_ID = NpcIdentifiers.WIZARD_TRAIBORN; // 5081
  const TRAIBORN_CUTSCENE_NPC_ID = NpcIdentifiers.WIZARD_TRAIBORN_2; // 11449
  const CORDELIA_TOWER_NPC_ID = NpcIdentifiers.APPRENTICE_CORDELIA; // 11443
  const CORDELIA_CUTSCENE_NPC_ID = NpcIdentifiers.APPRENTICE_CORDELIA_2; // 11444
  const CORDELIA_TEMPLE_NPC_ID = NpcIdentifiers.APPRENTICE_CORDELIA_3; // 11445
  const FELIX_TOWER_NPC_ID = NpcIdentifiers.APPRENTICE_FELIX_2; // 11446
  const FELIX_CUTSCENE_NPC_ID = NpcIdentifiers.APPRENTICE_FELIX_3; // 11447
  const FELIX_TEMPLE_NPC_ID = NpcIdentifiers.APPRENTICE_FELIX_4; // 11448
  const TAMARA_TOWER_NPC_ID = NpcIdentifiers.APPRENTICE_TAMARA; // 11440
  const TAMARA_CUTSCENE_NPC_ID = NpcIdentifiers.APPRENTICE_TAMARA_2; // 11441
  const TAMARA_TEMPLE_NPC_ID = NpcIdentifiers.APPRENTICE_TAMARA_3; // 11442
  const GREAT_GUARDIAN_NPC_ID = NpcIdentifiers.THE_GREAT_GUARDIAN_3; // 11456
  const GREAT_GUARDIAN_SCENE_NPC_ID = 11455; // no ops: the rift scenes' Guardian
  const ZACHARIAH_NPC_ID = 11451; // captured chatheads; the cache names both "Mysterious Voice"
  const ALIYA_NPC_ID = 11452;
  const SCENE_WALKER_NPC_ID = 11454;
  const SCENE_ABYSSAL_GUARDIAN_NPC_ID = 11453;
  const ABYSSAL_LEECH_NPC_ID = 11407;
  const WEAK_BARRIER_NPC_ID = 11419; // captured under the tutorial's barrier
  const WEAK_ELEMENTAL_GUARDIAN_NPC_ID = NpcIdentifiers.WEAK_ELEMENTAL_GUARDIAN; // 11414
  const WEAK_CATALYTIC_GUARDIAN_NPC_ID = NpcIdentifiers.WEAK_CATALYTIC_GUARDIAN; // 11408
  const MEDIUM_ELEMENTAL_GUARDIAN_NPC_ID = NpcIdentifiers.MEDIUM_ELEMENTAL_GUARDIAN; // 11415

  const MY_NPC_IDS = new Set([
    PERSTEN_ALKHARID_NPC_ID,
    PERSTEN_TOWER_NPC_ID,
    PERSTEN_CUTSCENE_NPC_ID,
    PERSTEN_TEMPLE_NPC_ID,
    ...MAGE_OF_ZAMORAK_NPC_IDS,
    NpcIdentifiers.MAGE_OF_ZAMORAK_2,
    NpcIdentifiers.MAGE_OF_ZAMORAK_3,
    NpcIdentifiers.MAGE_OF_ZAMORAK_4,
    NpcIdentifiers.MAGE_OF_ZAMORAK_5,
    NpcIdentifiers.MAGE_OF_ZAMORAK_6,
    DARK_MAGE_NPC_ID,
    TEA_SELLER_NPC_ID,
    NpcIdentifiers.ARCHMAGE_SEDRIDOR,
    NpcIdentifiers.ARCHMAGE_SEDRIDOR_2,
    NpcIdentifiers.ARCHMAGE_SEDRIDOR_3,
    TRAIBORN_NPC_ID,
    TRAIBORN_CUTSCENE_NPC_ID,
    CORDELIA_TOWER_NPC_ID,
    CORDELIA_CUTSCENE_NPC_ID,
    CORDELIA_TEMPLE_NPC_ID,
    FELIX_TOWER_NPC_ID,
    FELIX_CUTSCENE_NPC_ID,
    FELIX_TEMPLE_NPC_ID,
    TAMARA_TOWER_NPC_ID,
    TAMARA_CUTSCENE_NPC_ID,
    TAMARA_TEMPLE_NPC_ID,
    NpcIdentifiers.THE_GREAT_GUARDIAN,
    NpcIdentifiers.THE_GREAT_GUARDIAN_2,
    GREAT_GUARDIAN_NPC_ID,
  ]);

  // Items.
  const EYE_AMULET_ITEM_ID = ItemIdentifiers.EYE_AMULET; // 26903
  const STRONG_CUP_OF_TEA_ITEM_ID = ItemIdentifiers.STRONG_CUP_OF_TEA; // 26904
  const ABYSSAL_INCANTATION_ITEM_ID = ItemIdentifiers.ABYSSAL_INCANTATION; // 26905
  const BUCKET_OF_WATER_ITEM_ID = ItemIdentifiers.BUCKET_OF_WATER; // 1929
  const GUARDIAN_FRAGMENTS_ITEM_ID = ItemIdentifiers.GUARDIAN_FRAGMENTS; // 26878
  const GUARDIAN_ESSENCE_ITEM_ID = ItemIdentifiers.GUARDIAN_ESSENCE; // 26879
  const CATALYTIC_GUARDIAN_STONE_ITEM_ID = ItemIdentifiers.CATALYTIC_GUARDIAN_STONE; // 26880
  const ELEMENTAL_GUARDIAN_STONE_ITEM_ID = ItemIdentifiers.ELEMENTAL_GUARDIAN_STONE; // 26881
  const UNCHARGED_CELL_ITEM_ID = ItemIdentifiers.UNCHARGED_CELL; // 26882
  const WEAK_CELL_ITEM_ID = ItemIdentifiers.WEAK_CELL; // 26883
  const MEDIUM_CELL_ITEM_ID = ItemIdentifiers.MEDIUM_CELL; // 26884
  const PORTAL_TALISMAN_WATER_ITEM_ID = ItemIdentifiers.PORTAL_TALISMAN_WATER_; // 26888
  const CHISEL_ITEM_ID = ItemIdentifiers.CHISEL; // 1755
  const MEDIUM_POUCH_ITEM_ID = ItemIdentifiers.MEDIUM_POUCH; // 5510
  const MEDIUM_POUCH_ITEM_ID_2 = ItemIdentifiers.MEDIUM_POUCH_2; // 5511
  const MIND_RUNE_ITEM_ID = ItemIdentifiers.MIND_RUNE; // 558
  const WATER_RUNE_ITEM_ID = ItemIdentifiers.WATER_RUNE; // 555

  const TUTORIAL_ITEM_IDS = [
    GUARDIAN_FRAGMENTS_ITEM_ID,
    GUARDIAN_ESSENCE_ITEM_ID,
    CATALYTIC_GUARDIAN_STONE_ITEM_ID,
    ELEMENTAL_GUARDIAN_STONE_ITEM_ID,
    UNCHARGED_CELL_ITEM_ID,
    WEAK_CELL_ITEM_ID,
    MEDIUM_CELL_ITEM_ID,
    PORTAL_TALISMAN_WATER_ITEM_ID,
  ];
  const PICKAXE_ITEM_IDS = [
    ItemIdentifiers.BRONZE_PICKAXE,
    ItemIdentifiers.IRON_PICKAXE,
    ItemIdentifiers.STEEL_PICKAXE,
    ItemIdentifiers.BLACK_PICKAXE,
    ItemIdentifiers.MITHRIL_PICKAXE,
    ItemIdentifiers.ADAMANT_PICKAXE,
    ItemIdentifiers.RUNE_PICKAXE,
    ItemIdentifiers.DRAGON_PICKAXE,
  ];

  // Objects.
  const CHAOS_ALTAR_OBJECT_ID = ObjectIdentifiers.CHAOS_ALTAR; // the Zamorakian chapel altar
  const ABYSS_CENTRE_RIFT_OBJECT_ID = ObjectIdentifiers.ABYSSAL_RIFT; // Abyss centre
  const TEMPLE_RIFT_OBJECT_IDS = new Set([
    ObjectIdentifiers.ABYSSAL_RIFT_2,
    ObjectIdentifiers.ABYSSAL_RIFT_3,
  ]);
  const ALTAR_MIND_OBJECT_ID = ObjectIdentifiers.ALTAR_34; // 34761
  const ALTAR_WATER_OBJECT_ID = ObjectIdentifiers.ALTAR_35; // 34762
  const ALTAR_EXIT_MIND_OBJECT_ID = ObjectIdentifiers.PORTAL_40; // 34749
  const ALTAR_EXIT_WATER_OBJECT_ID = ObjectIdentifiers.PORTAL_41; // 34750
  const TEMPLE_EXIT_OBJECT_ID = ObjectIdentifiers.PORTAL_101; // 43692
  const BLUE_PORTAL_OBJECT_ID = ObjectIdentifiers.PORTAL_106; // 43767, the cutscene's portal; no ops
  // The basement loc 43841 is a stool until tote passes 90, then this Enter portal (cache).
  const BASEMENT_PORTAL_OBJECT_ID = 43765;
  const BASEMENT_PORTAL_PARENT_OBJECT_ID = 43841;
  const GUARDIAN_OF_MIND_OPEN_OBJECT_ID = 43822;
  const GUARDIAN_OF_MIND_CLOSED_OBJECT_ID = 43813;
  const GUARDIAN_OF_WATER_OPEN_OBJECT_ID = 43821;
  const GUARDIAN_OF_WATER_CLOSED_OBJECT_ID = 43810;
  const WEAK_CELL_TILE_OBJECT_ID = 43740;
  const MEDIUM_CELL_TILE_OBJECT_ID = 43741;
  const WEAK_BARRIER_OBJECT_ID = 43745;
  const MEDIUM_BARRIER_OBJECT_ID = 43747;
  const GUARDIAN_PARTS_OBJECT_IDS = new Set([
    ObjectIdentifiers.GUARDIAN_PARTS, // 43715
    ObjectIdentifiers.GUARDIAN_PARTS_2, // 43716
    ObjectIdentifiers.GUARDIAN_REMAINS, // 43717
    ObjectIdentifiers.GUARDIAN_REMAINS_2, // 43718
    ObjectIdentifiers.LARGE_GUARDIAN_REMAINS, // 43719
    ObjectIdentifiers.HUGE_GUARDIAN_REMAINS, // 43720
  ]);
  const ESSENCE_PILE_ELEMENTAL_OBJECT_ID = ObjectIdentifiers.ESSENCE_PILE_ELEMENTAL_; // 43722
  const ESSENCE_PILE_CATALYTIC_OBJECT_ID = ObjectIdentifiers.ESSENCE_PILE_CATALYTIC_; // 43723
  const UNCHARGED_CELLS_OBJECT_ID = ObjectIdentifiers.UNCHARGED_CELLS; // 43731
  const UNCHARGED_CELLS_OBJECT_ID_2 = ObjectIdentifiers.UNCHARGED_CELLS_2; // 43732
  const WEAK_CELLS_OBJECT_ID = ObjectIdentifiers.WEAK_CELLS; // 43733
  const INACTIVE_CELL_TILE_OBJECT_ID = ObjectIdentifiers.INACTIVE_CELL_TILE; // 43738
  const INACTIVE_CELL_TILE_OBJECT_ID_2 = ObjectIdentifiers.INACTIVE_CELL_TILE_2; // 43739
  const WORKBENCH_OBJECT_ID = ObjectIdentifiers.WORKBENCH_21; // 43754
  const FLOOR_CHISEL_OBJECT_ID = ObjectIdentifiers.COL_FF9040_CHISEL_COL; // 47501

  // The cache places six multi-loc energy objects in the Abyss. The map ids are
  // 43842-43847; their varbit 13747-13752 selects the visible base (43768-43773,
  // value 1) or white (43774-43779, value 2) transform, exactly as captured in
  // 1693 and highlighted by Quest Helper's TOTE_ABYSSAL_ENERGY_*_VIS ids.
  const ENERGY_SPOTS = [
    { name: "earth", id: 43842, varbit: 13747, x: 3040, y: 4834 },
    { name: "cosmic", id: 43843, varbit: 13748, x: 3041, y: 4832 },
    { name: "death", id: 43844, varbit: 13749, x: 3037, y: 4832 },
    { name: "nature", id: 43845, varbit: 13750, x: 3038, y: 4830 },
    { name: "law", id: 43846, varbit: 13751, x: 3038, y: 4834 },
    { name: "fire", id: 43847, varbit: 13752, x: 3040, y: 4830 },
  ];
  const ENERGY_IDS = new Set(ENERGY_SPOTS.map((spot) => spot.id));

  // Tiles.
  const PERSTEN_ALKHARID_TILE = { x: 3284, y: 3231, z: 0 };
  const BASEMENT_PERSTEN_TILE = { x: 3105, y: 9570, z: 0 };
  const BASEMENT_PORTAL_TILE = { x: 3104, y: 9574, z: 0 };
  const INCANTATION_ANIMATION_ID = 1818;
  const INCANTATION_GRAPHIC_ID = 2067;
  const BASEMENT_LANDING_TILE = { x: 3104, y: 9573, z: 0 };
  const INCANTATION_SCENE = [
    { key: "incantation-tamara", id: TAMARA_CUTSCENE_NPC_ID, x: 3103, y: 9572, z: 0 },
    { key: "incantation-felix", id: FELIX_CUTSCENE_NPC_ID, x: 3104, y: 9572, z: 0 },
    { key: "incantation-cordelia", id: CORDELIA_CUTSCENE_NPC_ID, x: 3105, y: 9572, z: 0 },
    { key: "incantation-traiborn", id: TRAIBORN_CUTSCENE_NPC_ID, x: 3106, y: 9570, z: 0 },
    { key: "incantation-sedridor", id: NpcIdentifiers.ARCHMAGE_SEDRIDOR_3, x: 3104, y: 9570, z: 0 },
    { key: "incantation-persten", id: PERSTEN_CUTSCENE_NPC_ID, x: 3106, y: 9573, z: 0 },
  ];
  const TOWER_ENTRANCE_TILE = { x: 3104, y: 3163, z: 0 };
  // Capture 1693 addnpc coords (not Quest Helper's interaction WorldPoints).
  const CORDELIA_TOWER_TILE = { x: 3110, y: 3161, z: 1 };
  const FELIX_TOWER_TILE = { x: 3111, y: 3163, z: 1 };
  const TAMARA_TOWER_TILE = { x: 3113, y: 3163, z: 1 };
  const ABYSS_CENTRE_TILE = { x: 3040, y: 4839, z: 0 };
  const MIND_ALTAR_TILE = { x: 2793, y: 4828, z: 0 };
  const WATER_ALTAR_TILE = { x: 2726, y: 4832, z: 0 };
  const MINIGAME_LOBBY_TILE = { x: 3615, y: 9470, z: 0 }; // Wiki: in front of the temple's portal

  // The untouched temple (capture 1693 rebased onto its template square).
  const TEMPLE_ARRIVAL_TILE = { x: 2399, y: 5651, z: 0 };
  const TEMPLE_EXPLORE_TILE = { x: 2399, y: 5639, z: 0 };
  const PERSTEN_TEMPLE_TILE = { x: 2400, y: 5667, z: 0 };
  const FELIX_TEMPLE_TILE = { x: 2401, y: 5644, z: 0 };
  const TAMARA_TEMPLE_TILE = { x: 2384, y: 5657, z: 0 };
  const CORDELIA_TEMPLE_TILE = { x: 2398, y: 5676, z: 0 };
  const VISION_TILE = { x: 2400, y: 5738, z: 0 };
  const RIFT_SCENE_TILE = { x: 2398, y: 5669, z: 0 };
  const ARRIVAL_CAST = [
    { key: "arrival-persten", id: PERSTEN_CUTSCENE_NPC_ID, x: 2398, y: 5646, z: 0 },
    { key: "arrival-felix", id: FELIX_CUTSCENE_NPC_ID, x: 2399, y: 5646, z: 0 },
    { key: "arrival-cordelia", id: CORDELIA_CUTSCENE_NPC_ID, x: 2400, y: 5646, z: 0 },
    { key: "arrival-tamara", id: TAMARA_CUTSCENE_NPC_ID, x: 2401, y: 5647, z: 0 },
  ];
  const RIFT_CAST = [
    { key: "rift-cordelia", id: CORDELIA_CUTSCENE_NPC_ID, x: 2397, y: 5670, z: 0 },
    { key: "rift-persten", id: PERSTEN_CUTSCENE_NPC_ID, x: 2399, y: 5672, z: 0 },
    { key: "rift-tamara", id: TAMARA_CUTSCENE_NPC_ID, x: 2400, y: 5669, z: 0 },
    { key: "rift-felix", id: FELIX_CUTSCENE_NPC_ID, x: 2401, y: 5670, z: 0 },
  ];
  const RIFT_CREATURES = [
    // Capture 1693 has them a tile further out, past this server's 15-tile NPC view.
    { key: "rift-walker", id: SCENE_WALKER_NPC_ID, x: 2398, y: 5682, z: 0 },
    { key: "rift-guardian-1", id: SCENE_ABYSSAL_GUARDIAN_NPC_ID, x: 2401, y: 5682, z: 0 },
    { key: "rift-guardian-2", id: SCENE_ABYSSAL_GUARDIAN_NPC_ID, x: 2395, y: 5682, z: 0 },
  ];
  const SCENE_GUARDIAN_TILE = { x: 2397, y: 5661, z: 0 };
  const CLOSING_CAST = [
    { key: "closing-guardian", id: GREAT_GUARDIAN_SCENE_NPC_ID, ...SCENE_GUARDIAN_TILE },
    { key: "closing-cordelia", id: CORDELIA_CUTSCENE_NPC_ID, x: 2397, y: 5670, z: 0 },
    { key: "closing-tamara", id: TAMARA_CUTSCENE_NPC_ID, x: 2400, y: 5669, z: 0 },
    { key: "closing-felix", id: FELIX_CUTSCENE_NPC_ID, x: 2404, y: 5670, z: 0 },
  ];

  // The tutorial's temple.
  const TUTORIAL_ARRIVAL_TILE = { x: 2463, y: 5733, z: 0 };
  const GREAT_GUARDIAN_TILE = { x: 2461, y: 5725, z: 0 };
  const FELIX_TUTORIAL_TILE = { x: 2464, y: 5712, z: 0 };
  const TAMARA_TUTORIAL_TILE = { x: 2462, y: 5734, z: 0 };
  const CORDELIA_TUTORIAL_TILE = { x: 2466, y: 5733, z: 0 };
  const CHISEL_GROUND_TILE = { x: 2465, y: 5708, z: 0 };
  const PICKAXE_GROUND_TILE = { x: 2461, y: 5708, z: 0 };
  const CELL_TILE = { x: 2463, y: 5734, z: 0 };
  const BARRIER_TILE = { x: 2462, y: 5735, z: 0 };
  const CREATURE_SPAWN_TILE = { x: 2463, y: 5746, z: 0 };
  const CREATURE_ATTACK_TILE = { x: 2463, y: 5738, z: 0 };
  const GUARDIAN_POST_TILE = { x: 2465, y: 5738, z: 0 };
  const WEAK_CELLS_TILE = { x: 2466, y: 5710, z: 0 };
  const UNCHARGED_CELLS_TILE = { x: 2466, y: 5712, z: 0 };
  const WORKBENCH_TILE = { x: 2459, y: 5710, z: 0 };
  const REMAINS_TILE = { x: 2449, y: 5714, z: 0 };
  const ELEMENTAL_PILE_TILE = { x: 2466, y: 5714, z: 0 };
  const CATALYTIC_PILE_TILE = { x: 2459, y: 5714, z: 0 };
  const MIND_GUARDIAN_LOC = { x: 2460, y: 5718, z: 0, face: 2 };
  const WATER_GUARDIAN_LOC = { x: 2471, y: 5724, z: 0, face: 1 };
  const MIND_RETURN_TILE = { x: 2461, y: 5720, z: 0 };
  const WATER_RETURN_TILE = { x: 2470, y: 5725, z: 0 };

  // Captured sequences, sounds and scripts (ids from rsprox 1693 and the minigame's own captures).
  const SEQ_TAKE_FROM_TABLE = 9401;
  const SEQ_PICKUP_FLOOR = 827;
  const SEQ_CARVE_GUARDIAN = 9462;
  const SEQ_GUARDIAN_RISES = 9380;
  const SEQ_CHISEL_ESSENCE = 9365;
  const SEQ_RUNECRAFT = 791;
  const SEQ_POWER_UP = 9361;
  const SEQ_GUARDIAN_APPEARS = 9376;
  const SEQ_LEECH_ATTACK = 9387;
  const SEQ_RIFT_GUARDIAN_ATTACK = 9383;
  const SEQ_CATALYTIC_GUARDIAN_ATTACK = 9382;
  const GFX_RUNECRAFT = 186;
  const SOUND_TABLE = 2581;
  const SOUND_CELL_PLACED = 5455;
  const SOUND_CELL_RECHARGE = 5428;
  const SOUND_CELL_STRENGTHEN = 5441;
  const SOUND_SCRAPE = 942;
  const SOUND_CARVE = 2586;
  const SOUND_GUARDIAN_LIVES = 956;
  const SOUND_FRAGMENT = 3600;
  const SOUND_CRAFT = 2710;
  const SOUND_PORTAL = 1098;
  const SOUND_POWER_UP = 5369;
  const SOUND_RIFT_BEAM = 5406;
  const SOUND_RIFT_SEALS = 5474;
  const OVERLAY_ATMOSPHERE_UID = (161 << 16) | 1;
  const OVERLAY_INTERFACE = 745; // gotr_overlay
  const OVERLAY_PORTAL_SCRIPT = 5984;
  const OVERLAY_REMOVE_SCRIPT = 5985;
  const MIND_OVERLAY = [44092, 16293385];
  const WATER_OVERLAY = [44091, 527582];

  const LIVE_TEMPLE = { minX: 3584, maxX: 3647, minY: 9472, maxY: 9535 };
  const FRAGMENTS_A_ROUND = 5;
  const MINING_XP = 5;
  const PILE_CRAFTING_XP = 80;
  const PILE_RESPAWN_TICKS = 6;
  const FIGHT_TICK_INTERVAL = 4;
  const NPC_VIEW_TILES = 15;
  const CREATURE_SWINGS_TO_DIE = 4;

  // Persisted attributes.
  const ASKED_WHO_ATTRIBUTE = "quest.temple_of_the_eye.asked-who";
  const DECLINED_ATTRIBUTE = "temple-of-the-eye:declined";
  const AMULET_GIVEN_ATTRIBUTE = "quest.temple_of_the_eye.amulet-given";
  const INCANTATION_GIVEN_ATTRIBUTE = "quest.temple_of_the_eye.incantation-given";
  const BASEMENT_PORTAL_OPEN_ATTRIBUTE = "temple-of-the-eye:basement-portal-open";
  const TEA_ATTRIBUTE = "quest.temple_of_the_eye.tea"; // 0 none, 1 seller gave, 2 mage drank
  const TELEPORT_ATTRIBUTE = "quest.temple_of_the_eye.teleports"; // bit 1 Abyss, bit 2 tower
  const DARK_MAGE_ATTRIBUTE = "quest.temple_of_the_eye.dark-mage"; // 0 none, 1 puzzle, 2 solved
  const ENERGY_ORDER_ATTRIBUTE = "quest.temple_of_the_eye.energy-order";
  const ENERGY_PROGRESS_ATTRIBUTE = "quest.temple_of_the_eye.energy-progress";
  const TOWER_SEEN_ATTRIBUTE = "quest.temple_of_the_eye.tower-apprentices";
  const TEMPLE_SEEN_ATTRIBUTE = "quest.temple_of_the_eye.temple-apprentices";
  const MIND_BRIEFED_ATTRIBUTE = "quest.temple_of_the_eye.mind-briefed";
  const MAGE_POSTQUEST_ATTRIBUTE = "quest.temple_of_the_eye.mage-postquest";
  const FELIX_POST_ATTRIBUTE = "quest.temple_of_the_eye.felix-post-cutscene";

  const ABYSS_TELEPORT_BIT = 1;
  const TOWER_TELEPORT_BIT = 2;
  const CORDELIA_BIT = 1;
  const FELIX_BIT = 2;
  const TAMARA_BIT = 4;

  const RUNECRAFTING_REQUIREMENT = 10;
  const THINGUMMYWUT = 11; // the three cards' answer

  // Per-player quest spawns (owner-only), keyed by player.
  const spawns = new Map();
  const basementPortalByPlayer = new WeakMap();
  const tutorialLocs = new Map();
  const scenePhases = new WeakMap(); // the running temple scene: "vision", "rift" or "rift-open"
  const tutorialActions = new WeakMap();
  const tutorialFights = new WeakMap();
  const incantationPlaying = new WeakSet();

  let quest = null;
  let transcripts = null;

  // ---------------------------------------------------------------------------
  // Small helpers
  // ---------------------------------------------------------------------------

  const has = (player, itemId, amount = 1) => player.getInventory().getAmount(itemId) >= amount;
  const give = (player, itemId, amount = 1) => player.getInventory().adds(itemId, amount);
  const take = (player, itemId, amount = 1) => player.getInventory().deleteNumber(itemId, amount);

  function stageOf(player) {
    return quest.getStage(player);
  }

  function stageBetween(player, min, max) {
    const stage = stageOf(player);
    return stage >= min && stage < max;
  }

  function meetsStartRequirements(player) {
    const level = player.getSkillManager().getMaxLevel(Skill.RUNECRAFTING);
    return Number(level) >= RUNECRAFTING_REQUIREMENT && hasAbyssAccess(player);
  }

  function takeAll(player, itemId) {
    const amount = player.getInventory().getAmount(itemId);
    if (amount > 0) player.getInventory().deleteNumber(itemId, amount);
  }

  function removeItem(player, itemId) {
    takeAll(player, itemId);
  }

  /** Quest-only items leave the inventory for good once their hand-in is done. */
  function clearConsumedQuestItems(player) {
    const stage = stageOf(player);
    if (stage >= STAGE_AMULET_RETURNED || quest.isComplete(player)) removeItem(player, EYE_AMULET_ITEM_ID);
    if (stage >= STAGE_SEDRIDOR || quest.isComplete(player)) removeItem(player, ABYSSAL_INCANTATION_ITEM_ID);
  }

  function giveQuestItem(player, itemId) {
    if (has(player, itemId)) return false;
    if (freeSlots(player) === 0) {
      player.sendMessage("You need a free inventory space for that.");
      return false;
    }
    give(player, itemId);
    return true;
  }

  /**
   * The eye amulet and the Abyssal incantation are reclaimable from the NPCs
   * that issued them. The persisted "given" flag proves the hand-over happened,
   * so a replacement is only created when the item is actually missing.
   */
  function recoverQuestItems(player) {
    const stage = stageOf(player);
    if (stageBetween(player, STAGE_STARTED, STAGE_INCANTATION) && flag(player, AMULET_GIVEN_ATTRIBUTE)) {
      giveQuestItem(player, EYE_AMULET_ITEM_ID);
    }
    if (stageBetween(player, STAGE_INCANTATION, STAGE_SEDRIDOR) && flag(player, INCANTATION_GIVEN_ATTRIBUTE)) {
      giveQuestItem(player, ABYSSAL_INCANTATION_ITEM_ID);
    }
  }

  function objectiveLines(stage) {
    return OBJECTIVES.map((objective, index) => {
      const done = stage >= objective.at;
      const text = `Objective ${index + 1}: ${objective.text}`;
      return done ? `<str>${text}</str>` : text;
    });
  }

  function setStage(player, value) {
    if (quest.getStage(player) !== value) quest.setStage(player, value);
    player.setAttribute(STAGE_SCHEMA_ATTRIBUTE, STAGE_SCHEMA_VERSION);
    syncSpawns(player);
  }

  /**
   * Older builds tracked this quest on an invented 1-26 scale. Map those saves
   * once onto the real varbit values (and the tutorial's own progress). New
   * saves carry the schema marker as soon as they leave stage 0.
   */
  const LEGACY_STAGES = {
    1: [5],
    2: [10],
    3: [20],
    4: [45],
    5: [60],
    6: [65],
    7: [75],
    8: [85],
    9: [95],
    10: [100],
    11: [115, TUTORIAL_START],
    12: [115, TUTORIAL_FELIX],
    13: [115, TUTORIAL_TAMARA],
    14: [115, TUTORIAL_CELL],
    15: [115, TUTORIAL_PILE_ONE],
    16: [115, TUTORIAL_PILES],
    17: [115, TUTORIAL_ESSENCE],
    18: [115, TUTORIAL_MIND_STONES],
    19: [115, TUTORIAL_REPOWERED],
    20: [115, TUTORIAL_POWERED_ONE],
    21: [115, TUTORIAL_WATER_STONES],
    22: [115, TUTORIAL_POWERED_TWO],
    23: [115, TUTORIAL_MEDIUM_GUARDIAN],
    24: [115, TUTORIAL_WATER_STONES_TWO],
    25: [115, TUTORIAL_MEDIUM_CELL],
    26: [130],
  };

  function migrateLegacyStage(player) {
    const stage = stageOf(player);
    if (stage === 0 || attributeNumber(player, STAGE_SCHEMA_ATTRIBUTE) >= STAGE_SCHEMA_VERSION) return;
    const target = LEGACY_STAGES[stage];
    if (!target) return;
    quest.setStage(player, target[0]);
    if (target[1] !== undefined) setTutorialProgress(player, target[1]);
    player.setAttribute(STAGE_SCHEMA_ATTRIBUTE, STAGE_SCHEMA_VERSION);
    syncSpawns(player);
  }

  function tutorialProgress(player) {
    return attributeNumber(player, TUTORIAL_ATTRIBUTE);
  }

  function setTutorialProgress(player, value) {
    player.setAttribute(TUTORIAL_ATTRIBUTE, value);
    player.getPacketSender().sendVarbit(TUTORIAL_VARBIT, value);
    if (inTutorial(player)) {
      syncTutorialScene(player);
      tutorialHint(player);
    }
  }

  function inTutorial(player) {
    return stageOf(player) === STAGE_GUARDIAN;
  }

  function attributeNumber(player, key) {
    const value = Number(player.getAttribute(key));
    return Number.isFinite(value) ? value : 0;
  }

  function setFlag(player, key, on = true) {
    player.setAttribute(key, on ? 1 : 0);
  }

  function flag(player, key) {
    return attributeNumber(player, key) === 1;
  }

  function bitSet(player, key, bit) {
    return (attributeNumber(player, key) & bit) !== 0;
  }

  function setBit(player, key, bit) {
    player.setAttribute(key, attributeNumber(player, key) | bit);
  }

  function freeSlots(player) {
    const inventory = player.getInventory();
    return typeof inventory.getFreeSlots === "function" ? inventory.getFreeSlots() : inventory.isFull() ? 0 : 1;
  }

  function hasPickaxe(player) {
    const weapon = player.getEquipment().getItems()[Equipment.WEAPON_SLOT];
    if (weapon && PICKAXE_ITEM_IDS.includes(weapon.getId())) return true;
    return PICKAXE_ITEM_IDS.some((itemId) => has(player, itemId));
  }

  function isQuestComplete(player, key) {
    const request = { player, key };
    api.emitCustomEvent("quest:is-complete", request);
    return request.complete === true;
  }

  /** The real prerequisite: Enter the Abyss (which itself requires Rune Mysteries). */
  function hasAbyssAccess(player) {
    return isQuestComplete(player, "enter_the_abyss");
  }

  function teaState(player) {
    return attributeNumber(player, TEA_ATTRIBUTE);
  }

  function darkMageState(player) {
    return attributeNumber(player, DARK_MAGE_ATTRIBUTE);
  }

  function teleports(player) {
    return attributeNumber(player, TELEPORT_ATTRIBUTE);
  }

  function questPage() {
    if (!transcripts) transcripts = loadTranscripts(api);
    return transcripts?.[PAGE];
  }

  function variantSteps(variant) {
    const steps = questPage()?.variants?.[variant];
    return Array.isArray(steps) ? steps : [];
  }

  function play(player, npcId, variant, select) {
    return startTranscript(api, player, npcId, PAGE, variant, select);
  }

  /** The steps under a menu option, for an item used directly on the NPC offering it. */
  function optionSteps(steps, text) {
    for (const step of steps ?? []) {
      for (const option of step.options ?? []) {
        if (text.test(option.text ?? "")) return option.steps ?? [];
        const nested = optionSteps(option.steps, text);
        if (nested) return nested;
      }
      const inner = optionSteps(step.steps, text);
      if (inner) return inner;
    }
    return null;
  }

  function stepById(steps, id) {
    for (const step of steps ?? []) {
      if (step.id === id) return step;
      const inner = stepById(step.steps, id);
      if (inner) return inner;
      for (const option of step.options ?? []) {
        const nested = stepById(option.steps, id);
        if (nested) return nested;
      }
    }
    return null;
  }

  function moveTo(player, tile) {
    player.moveTo(new Location(tile.x, tile.y, tile.z));
  }

  /** The three riddle cards are cache interface 291; no custom interface is needed. */
  function openPuzzle(player, key) {
    const lines = PUZZLE_LINES[key];
    if (!lines) return;
    const sender = player.getPacketSender();
    sender.sendInterface(PUZZLE_GROUP);
    lines.forEach((line, index) => sender.sendString(line, (PUZZLE_GROUP << 16) | (5 + index)));
  }

  const puzzlePending = new WeakMap();

  function openPuzzleLater(player, key) {
    let pending = puzzlePending.get(player);
    if (!pending) {
      pending = new Set();
      puzzlePending.set(player, pending);
    }
    if (pending.has(key)) return;
    pending.add(key);
    const { Task, TaskManager } = api.core;
    TaskManager.submit(new (class extends Task {
      constructor() {
        super(1, null, true);
      }
      execute() {
        this.stop();
        pending.delete(key);
        if (player.isRegistered()) openPuzzle(player, key);
      }
    })());
  }

  function closePuzzle(event) {
    event.player.getPacketSender().sendInterfaceRemoval();
    event.handled = true;
  }

  // ---------------------------------------------------------------------------
  // World setup and per-player spawns
  // ---------------------------------------------------------------------------

  /** The chant's blue portal exists for the incantation scene only; 43767 has no ops of its own. */
  function syncBasementPortal(player) {
    const existing = basementPortalByPlayer.get(player);
    const shouldExist = flag(player, BASEMENT_PORTAL_OPEN_ATTRIBUTE) && stageOf(player) === STAGE_INCANTATION_READY;
    if (!shouldExist) {
      if (existing) ObjectManager.deregister(existing, true);
      basementPortalByPlayer.delete(player);
      if (flag(player, BASEMENT_PORTAL_OPEN_ATTRIBUTE)) player.setAttribute(BASEMENT_PORTAL_OPEN_ATTRIBUTE, false);
      return;
    }
    if (existing) return;
    const portal = new GameObject(
      BLUE_PORTAL_OBJECT_ID,
      new Location(BASEMENT_PORTAL_TILE.x, BASEMENT_PORTAL_TILE.y, BASEMENT_PORTAL_TILE.z),
      10,
      2,
      null
    ).setOwner(player);
    ObjectManager.register(portal, true);
    basementPortalByPlayer.set(player, portal);
  }

  function faceIncantationScene(player) {
    const owned = spawns.get(player);
    if (!owned) return;
    const portal = new Location(BASEMENT_PORTAL_TILE.x, BASEMENT_PORTAL_TILE.y, BASEMENT_PORTAL_TILE.z);
    for (const actor of INCANTATION_SCENE) owned.get(actor.key)?.faceTile?.(portal);
  }

  function hasIncantationCast(player) {
    const owned = spawns.get(player);
    const location = player.getLocation?.();
    if (!owned || !location) return false;
    return INCANTATION_SCENE.every(({ key }) => {
      const actor = owned.get(key);
      return actor?.isRegistered?.() === true
        && actor.isVisible?.() === true
        && actor.isOwnerOnly?.() === true
        && actor.getOwner?.() === player
        && actor.getPrivateArea?.() === (player.getPrivateArea?.() ?? null)
        && actor.getLocation?.()?.getZ?.() === location.getZ();
    });
  }

  function setSpawn(player, key, definition, active) {
    let owned = spawns.get(player);
    if (!owned) {
      owned = new Map();
      spawns.set(player, owned);
    }
    const existing = owned.get(key);
    if (!active) {
      if (existing) {
        api.removeNpc(existing);
        owned.delete(key);
      }
      return;
    }
    if (existing) return;
    const npc = api.spawnNpc({ ...definition, owner: player, ownerOnly: true });
    if (npc) owned.set(key, npc);
  }

  function clearSpawns(player) {
    const owned = spawns.get(player);
    if (!owned) return;
    for (const npc of owned.values()) api.removeNpc(npc);
    spawns.delete(player);
  }

  function setCast(player, cast, active) {
    for (const actor of cast) {
      setSpawn(player, actor.key, { id: actor.id, x: actor.x, y: actor.y, z: actor.z, wanderRadius: 0 }, active);
    }
  }

  /** Keeps the owner-only quest NPCs in step with the player's stage. */
  function syncSpawns(player) {
    const stage = stageOf(player);
    const phase = scenePhases.get(player);
    setSpawn(
      player,
      "persten-alkharid",
      { id: PERSTEN_ALKHARID_NPC_ID, x: PERSTEN_ALKHARID_TILE.x, y: PERSTEN_ALKHARID_TILE.y, z: PERSTEN_ALKHARID_TILE.z, wanderRadius: 0 },
      // She stays at the oasis until the riddle is solved; her teleport to the tower is offered there.
      stage < STAGE_RIDDLE_DONE
    );
    setSpawn(
      player,
      "persten-tower",
      { id: PERSTEN_TOWER_NPC_ID, x: BASEMENT_PERSTEN_TILE.x, y: BASEMENT_PERSTEN_TILE.y, z: BASEMENT_PERSTEN_TILE.z, wanderRadius: 0 },
      // 11458: 11437 from tote 85 to 90 (cache), at 3105,9570 (capture 1693).
      stage >= STAGE_RIDDLE_DONE && !flag(player, BASEMENT_PORTAL_OPEN_ATTRIBUTE) && !incantationPlaying.has(player) && stage <= STAGE_INCANTATION_READY
    );
    for (const actor of INCANTATION_SCENE) {
      setSpawn(
        player,
        actor.key,
        { id: actor.id, x: actor.x, y: actor.y, z: actor.z, wanderRadius: 0 },
        stage === STAGE_INCANTATION_READY && incantationPlaying.has(player)
      );
    }
    faceIncantationScene(player);
    syncBasementPortal(player);
    // 11459-11461: the tower apprentices from tote 70 to 90 (cache).
    for (const [key, id, tile] of [
      ["cordelia-tower", CORDELIA_TOWER_NPC_ID, CORDELIA_TOWER_TILE],
      ["felix-tower", FELIX_TOWER_NPC_ID, FELIX_TOWER_TILE],
      ["tamara-tower", TAMARA_TOWER_NPC_ID, TAMARA_TOWER_TILE],
    ]) {
      setSpawn(player, key, { id, x: tile.x, y: tile.y, z: tile.z, wanderRadius: 0 }, stage >= STAGE_TRAIBORN && stage <= STAGE_INCANTATION_READY);
    }
    setCast(player, ARRIVAL_CAST, stage === STAGE_PORTAL_OPEN);
    const exploring = stage === STAGE_TEMPLE || stage === STAGE_APPRENTICES;
    setSpawn(
      player,
      "persten-temple",
      { id: PERSTEN_TEMPLE_NPC_ID, x: PERSTEN_TEMPLE_TILE.x, y: PERSTEN_TEMPLE_TILE.y, z: PERSTEN_TEMPLE_TILE.z, wanderRadius: 0 },
      exploring
    );
    const felixTile = exploring ? FELIX_TEMPLE_TILE : FELIX_TUTORIAL_TILE;
    const tamaraTile = exploring ? TAMARA_TEMPLE_TILE : TAMARA_TUTORIAL_TILE;
    const cordeliaTile = exploring ? CORDELIA_TEMPLE_TILE : CORDELIA_TUTORIAL_TILE;
    const inTemple = exploring || stage === STAGE_GUARDIAN;
    // Keyed by map so the move between the two temples replaces the spawn.
    const place = exploring ? "explore" : "tutorial";
    for (const other of exploring ? ["tutorial"] : ["explore"]) {
      for (const name of ["cordelia", "felix", "tamara"]) setSpawn(player, `${name}-${other}`, null, false);
    }
    setSpawn(player, `cordelia-${place}`, { id: CORDELIA_TEMPLE_NPC_ID, x: cordeliaTile.x, y: cordeliaTile.y, z: 0, wanderRadius: 0 }, inTemple);
    setSpawn(player, `felix-${place}`, { id: FELIX_TEMPLE_NPC_ID, x: felixTile.x, y: felixTile.y, z: 0, wanderRadius: 0 }, inTemple);
    setSpawn(player, `tamara-${place}`, { id: TAMARA_TEMPLE_NPC_ID, x: tamaraTile.x, y: tamaraTile.y, z: 0, wanderRadius: 0 }, inTemple);
    setSpawn(
      player,
      "great-guardian",
      { id: GREAT_GUARDIAN_NPC_ID, x: GREAT_GUARDIAN_TILE.x, y: GREAT_GUARDIAN_TILE.y, z: GREAT_GUARDIAN_TILE.z, wanderRadius: 0 },
      stage === STAGE_GUARDIAN
    );
    const riftScene = stage === STAGE_VISION && (phase === "rift" || phase === "rift-open" || phase === "rift-cleared");
    // Persten falls into the rift ("Persten!"); Cordelia then deals with what comes out.
    setCast(player, RIFT_CAST.filter(({ key }) => key !== "rift-persten"), riftScene);
    setCast(player, RIFT_CAST.filter(({ key }) => key === "rift-persten"), riftScene && phase === "rift");
    setCast(player, RIFT_CREATURES, stage === STAGE_VISION && phase === "rift-open");
    setSpawn(
      player,
      "vision-persten",
      { id: PERSTEN_CUTSCENE_NPC_ID, x: VISION_TILE.x, y: VISION_TILE.y - 7, z: 0, wanderRadius: 0 },
      stage === STAGE_VISION && phase === "vision-ending"
    );
    setCast(player, CLOSING_CAST, stage === STAGE_CLOSED);
    syncTutorialScene(player);
  }

  // ---------------------------------------------------------------------------
  // Abyss energy puzzle
  // ---------------------------------------------------------------------------

  function energyOrder(player) {
    const raw = String(player.getAttribute(ENERGY_ORDER_ATTRIBUTE) ?? "");
    if (!/^[0-5]{6}$/.test(raw)) {
      const order = [0, 1, 2, 3, 4, 5];
      for (let i = order.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [order[i], order[j]] = [order[j], order[i]];
      }
      player.setAttribute(ENERGY_ORDER_ATTRIBUTE, order.join(""));
      player.setAttribute(ENERGY_PROGRESS_ATTRIBUTE, 0);
      return order;
    }
    return raw.split("").map(Number);
  }

  function energyIndexAt(event) {
    const { location, objectId } = event;
    return ENERGY_SPOTS.findIndex(
      (spot) => spot.id === objectId && spot.x === location.x && spot.y === location.y,
    );
  }

  function setEnergyVarbits(player, values) {
    ENERGY_SPOTS.forEach((spot, index) => {
      player.getPacketSender().sendVarbit(spot.varbit, values[index]);
    });
  }

  function syncEnergyObjects(player) {
    if (stageOf(player) !== STAGE_ENERGY || darkMageState(player) !== 1) {
      setEnergyVarbits(player, [0, 0, 0, 0, 0, 0]);
      return;
    }
    const order = energyOrder(player);
    const progress = attributeNumber(player, ENERGY_PROGRESS_ATTRIBUTE);
    const values = [1, 1, 1, 1, 1, 1];
    for (let index = 0; index < progress; index++) values[order[index]] = 2;
    setEnergyVarbits(player, values);
  }

  function resetEnergyPuzzle(player) {
    player.setAttribute(ENERGY_PROGRESS_ATTRIBUTE, 0);
    setEnergyVarbits(player, [1, 1, 1, 1, 1, 1]);
  }

  function touchEnergy(event) {
    const { player, location } = event;
    if (stageOf(player) !== STAGE_ENERGY) return;
    if (darkMageState(player) !== 1) return;
    const index = energyIndexAt(event);
    if (index < 0) return;
    const spot = ENERGY_SPOTS[index];
    const order = energyOrder(player);
    const progress = attributeNumber(player, ENERGY_PROGRESS_ATTRIBUTE);
    setEnergyVarbits(player, [1, 1, 1, 1, 1, 1]);
    if (order[progress] === index) {
      const nextProgress = progress + 1;
      player.setAttribute(ENERGY_PROGRESS_ATTRIBUTE, nextProgress);
      const values = [1, 1, 1, 1, 1, 1];
      for (let step = 0; step < nextProgress; step++) values[order[step]] = 2;
      setEnergyVarbits(player, values);
      player.sendMessage(`The ${spot.name} energy reacts strangely to your touch.`);
      if (nextProgress >= ENERGY_SPOTS.length) {
        player.setAttribute(DARK_MAGE_ATTRIBUTE, 2);
        setEnergyVarbits(player, [0, 0, 0, 0, 0, 0]);
        setStage(player, STAGE_ENERGY_DONE);
      }
    } else {
      player.setAttribute(ENERGY_PROGRESS_ATTRIBUTE, 0);
      player.sendMessage(`The ${spot.name} energy does not respond to your touch.`);
    }
    event.handled = true;
  }

  // ---------------------------------------------------------------------------
  // Variant selection
  // ---------------------------------------------------------------------------

  const TOWER_APPRENTICES = new Map([
    [CORDELIA_TOWER_NPC_ID, { key: "cordelia", bit: CORDELIA_BIT }],
    [FELIX_TOWER_NPC_ID, { key: "felix", bit: FELIX_BIT }],
    [TAMARA_TOWER_NPC_ID, { key: "tamara", bit: TAMARA_BIT }],
  ]);

  const TEMPLE_APPRENTICES = new Map([
    [CORDELIA_TEMPLE_NPC_ID, { key: "cordelia", bit: CORDELIA_BIT }],
    [FELIX_TEMPLE_NPC_ID, { key: "felix", bit: FELIX_BIT }],
    [TAMARA_TEMPLE_NPC_ID, { key: "tamara", bit: TAMARA_BIT }],
  ]);

  function allTowerRiddlesSeen(player) {
    const seen = attributeNumber(player, TOWER_SEEN_ATTRIBUTE);
    return (seen & (CORDELIA_BIT | FELIX_BIT | TAMARA_BIT)) === (CORDELIA_BIT | FELIX_BIT | TAMARA_BIT);
  }

  function allTempleApprenticesSeen(player) {
    const seen = attributeNumber(player, TEMPLE_SEEN_ATTRIBUTE);
    return (seen & (CORDELIA_BIT | FELIX_BIT | TAMARA_BIT)) === (CORDELIA_BIT | FELIX_BIT | TAMARA_BIT);
  }

  function selectPerstenVariant(player, npcId) {
    const stage = stageOf(player);
    if (npcId === PERSTEN_ALKHARID_NPC_ID) {
      if (stage === 0) {
        player.getPacketSender().sendVarbit(13745, 1);
        return flag(player, DECLINED_ATTRIBUTE)
          ? "an-eye-for-a-favour-talking-to-wizard-persten-after-declining-to-start-the-quest"
          : "an-eye-for-a-favour-talking-to-wizard-persten";
      }
      if (stage < STAGE_INCANTATION) {
        return flag(player, AMULET_GIVEN_ATTRIBUTE)
          ? "an-eye-for-a-favour-talking-to-wizard-persten-again"
          : "an-eye-for-a-favour-talking-to-wizard-persten-again-before-getting-the-amulet";
      }
      if (stage === STAGE_INCANTATION) return "help-from-some-wizards-talking-to-wizard-persten";
      if (stage > STAGE_INCANTATION && stage < STAGE_RIDDLE_DONE) {
        return (teleports(player) & TOWER_TELEPORT_BIT) !== 0
          ? "help-from-some-wizards-talking-to-wizard-persten-after-using-the-one-time-teleport"
          : "help-from-some-wizards-talking-to-wizard-persten-again-before-using-the-one-time-teleport";
      }
      return null;
    }
    if (npcId === PERSTEN_TOWER_NPC_ID) {
      if (stage === STAGE_RIDDLE_DONE) return "enter-the-gate-talking-to-sedridor-or-persten";
      if (stage === STAGE_INCANTATION_READY) return "enter-the-gate-after-declining-to-start-the-incantation-talking-to-wizard-persten";
      return null;
    }
    if (npcId === PERSTEN_TEMPLE_NPC_ID) {
      if (stage < STAGE_TEMPLE || stage >= STAGE_GUARDIAN) return null;
      return allTempleApprenticesSeen(player)
        ? "enter-the-gate-talking-to-wizard-persten-after-speaking-with-the-apprentices"
        : "enter-the-gate-talking-to-persten-upon-arrival";
    }
    return null;
  }

  function selectMageVariant(player) {
    const stage = stageOf(player);
    if (stage === STAGE_COMPLETE) {
      setFlag(player, MAGE_POSTQUEST_ATTRIBUTE);
      return "post-quest-dialogue-mage-of-zamorak";
    }
    if (stage >= STAGE_INCANTATION && stage < STAGE_TOWER) {
      return "herbert-and-the-dark-mage-talking-to-the-mage-of-zamorak-after-getting-the-incantation";
    }
    if (stage >= STAGE_TEA_DRUNK && stage < STAGE_IN_ABYSS) {
      return (teleports(player) & ABYSS_TELEPORT_BIT) !== 0
        ? "herbert-and-the-dark-mage-talking-to-the-mage-of-zamorak-again-after-he-drinks-the-tea-talking-to-the-mage-of-zamorak-again-after-using-the-one-time-teleport"
        : "herbert-and-the-dark-mage-talking-to-the-mage-of-zamorak-again-after-he-drinks-the-tea";
    }
    if (stage >= STAGE_TEA_GIVEN && stage < STAGE_TEA_DRUNK) {
      return has(player, BUCKET_OF_WATER_ITEM_ID) && has(player, STRONG_CUP_OF_TEA_ITEM_ID)
        ? "herbert-and-the-dark-mage-talking-to-the-mage-of-zamorak-after-getting-the-tea"
        : "herbert-and-the-dark-mage-talking-to-the-mage-of-zamorak-talking-to-the-mage-of-zamorak-again";
    }
    if (stage >= STAGE_TEA_GIVEN && stage < STAGE_TEA_DRUNK) {
      return has(player, BUCKET_OF_WATER_ITEM_ID) && has(player, STRONG_CUP_OF_TEA_ITEM_ID)
        ? "herbert-and-the-dark-mage-talking-to-the-mage-of-zamorak-after-getting-the-tea"
        : "herbert-and-the-dark-mage-talking-to-the-mage-of-zamorak-talking-to-the-mage-of-zamorak-again";
    }
    if (stage >= STAGE_STARTED && stage < STAGE_TEA_GIVEN) {
      return "herbert-and-the-dark-mage-talking-to-the-mage-of-zamorak";
    }
    return null;
  }

  function selectTeaSellerVariant(player) {
    const stage = stageOf(player);
    if (stage < STAGE_APPRAISED || stage >= STAGE_TEA_DRUNK) return null;
    return teaState(player) === 0
      ? "herbert-and-the-dark-mage-talking-to-the-tea-seller"
      : "herbert-and-the-dark-mage-talking-to-the-tea-seller-talking-to-the-tea-seller-again";
  }

  function selectDarkMageVariant(player) {
    const stage = stageOf(player);
    if (stage < STAGE_IN_ABYSS || stage >= STAGE_INCANTATION) return null;
    const state = darkMageState(player);
    if (state === 2) {
      if (flag(player, INCANTATION_GIVEN_ATTRIBUTE) && !has(player, ABYSSAL_INCANTATION_ITEM_ID)) {
        return "herbert-and-the-dark-mage-obtaining-the-incantation-reclaiming-the-incantation";
      }
      return "herbert-and-the-dark-mage-obtaining-the-incantation";
    }
    if (state === 1) return "herbert-and-the-dark-mage-talking-to-the-dark-mage-after-the-energy-spawns";
    if (stage >= STAGE_DARK_MAGE) return "herbert-and-the-dark-mage-talking-to-the-dark-mage-after-using-the-bucket-of-water";
    return "herbert-and-the-dark-mage-talking-to-the-dark-mage";
  }

  function selectSedridorVariant(player) {
    const stage = stageOf(player);
    if (stage === STAGE_COMPLETE) return "post-quest-dialogue-archmage-sedridor";
    if (stage >= STAGE_TOWER && stage < STAGE_SEDRIDOR) {
      return "help-from-some-wizards-talking-to-archmage-sedridor";
    }
    if (stage >= STAGE_SEDRIDOR && stage < STAGE_RIDDLE_DONE) {
      return "help-from-some-wizards-talking-to-archmage-sedridor-talking-to-sedridor-again";
    }
    if (stage === STAGE_RIDDLE_DONE) return "enter-the-gate-talking-to-sedridor-or-persten";
    if (stage === STAGE_INCANTATION_READY) return "enter-the-gate-after-declining-to-start-the-incantation-talking-to-archmage-sedridor";
    if (stage === STAGE_PORTAL_OPEN) return "enter-the-gate-talking-to-sedridor-after-the-portal-is-open";
    if (stage >= STAGE_TEMPLE && stage < STAGE_CLOSED) return "enter-the-gate-talking-to-archmage-sedridor-after-entering-the-portal";
    if (stage === STAGE_CLOSED || stage === STAGE_FINAL) {
      return "guardians-of-the-rift-talking-to-sedridor-after-leaving-the-temple-or-using-the-portal";
    }
    return null;
  }

  function selectTraibornVariant(player) {
    const stage = stageOf(player);
    if (stage >= STAGE_SEDRIDOR && stage < STAGE_RIDDLE) {
      return "help-from-some-wizards-talking-to-wizard-traiborn";
    }
    if (stage >= STAGE_RIDDLE && stage < STAGE_RIDDLE_DONE) {
      return allTowerRiddlesSeen(player)
        ? "help-from-some-wizards-talking-to-traiborn-after-seeing-all-three-riddles"
        : "help-from-some-wizards-talking-to-wizard-traiborn-talking-to-traiborn-again";
    }
    if (stage >= STAGE_RIDDLE_DONE && stage < STAGE_COMPLETE) {
      return "help-from-some-wizards-after-solving-the-riddle-talking-to-traiborn";
    }
    return null;
  }

  function selectTowerApprenticeVariant(player, apprentice) {
    const stage = stageOf(player);
    const name = apprentice.key;
    if (stage < STAGE_SEDRIDOR || stage >= STAGE_RIDDLE_DONE) return null;
    if (stage < STAGE_RIDDLE) {
      return `help-from-some-wizards-talking-to-the-apprentices-before-speaking-to-traiborn-${name}`;
    }
    if (bitSet(player, TOWER_SEEN_ATTRIBUTE, apprentice.bit)) {
      return `help-from-some-wizards-talking-to-the-apprentices-after-speaking-to-traiborn-${name}-talking-to-${name}-again`;
    }
    setBit(player, TOWER_SEEN_ATTRIBUTE, apprentice.bit);
    player.getPacketSender().sendVarbit(TOWER_PUZZLE_VARBITS[apprentice.key], 1);
    if (allTowerRiddlesSeen(player)) setStage(player, STAGE_RIDDLE_TOLD);
    return `help-from-some-wizards-talking-to-the-apprentices-after-speaking-to-traiborn-${name}`;
  }

  function felixTempleVariant(player) {
    const progress = tutorialProgress(player);
    if (progress === TUTORIAL_START) {
      setTutorialProgress(player, TUTORIAL_FELIX);
      return "guardians-of-the-rift-talking-to-felix";
    }
    if (progress === TUTORIAL_FELIX) return "guardians-of-the-rift-talking-to-felix-talking-to-apprentice-felix-again";
    if (progress <= TUTORIAL_TAMARA) return "guardians-of-the-rift-talking-to-felix-talking-to-apprentice-felix-again";
    if (progress <= TUTORIAL_PILE_ONE) {
      setFlag(player, FELIX_POST_ATTRIBUTE);
      Scenes.later(player, 1, () => player.isRegistered() && tutorialHint(player));
      return "guardians-of-the-rift-talking-to-felix-after-placing-the-weak-cell";
    }
    if (progress === TUTORIAL_PILES) {
      return player.getInventory().getAmount(GUARDIAN_FRAGMENTS_ITEM_ID) >= FRAGMENTS_A_ROUND
        ? "guardians-of-the-rift-talking-to-felix-after-getting-guardian-fragments"
        : "guardians-of-the-rift-after-assembling-the-second-essence-pile-talking-to-felix-again";
    }
    if (progress === TUTORIAL_ESSENCE) {
      return flag(player, MIND_BRIEFED_ATTRIBUTE)
        ? "guardians-of-the-rift-talking-to-felix-after-tamara-asks-to-go-to-the-mind-altar"
        : "guardians-of-the-rift-talking-to-felix-after-making-guardian-essence";
    }
    if (progress <= TUTORIAL_POWERED_ONE) return "guardians-of-the-rift-talking-to-felix-before-powering-the-guardian";
    if (progress === TUTORIAL_WATER_STONES) return "guardians-of-the-rift-talking-to-felix-after-returning-from-the-water-altar";
    if (progress <= TUTORIAL_MEDIUM_GUARDIAN) return "guardians-of-the-rift-talking-to-felix-before-making-another-guardian";
    return "guardians-of-the-rift-talking-to-felix-after-returning-from-the-water-altar";
  }

  function selectTempleApprenticeVariant(player, apprentice) {
    const stage = stageOf(player);
    if (stage < STAGE_TEMPLE) return null;
    const name = apprentice.key;
    if (stage === STAGE_GUARDIAN) {
      if (apprentice.bit === FELIX_BIT) return felixTempleVariant(player);
      if (apprentice.bit === TAMARA_BIT) return selectTamaraTempleVariant(player);
      return `enter-the-gate-talking-to-apprentice-${name}-again`;
    }
    if (stage === STAGE_TEMPLE) {
      if (bitSet(player, TEMPLE_SEEN_ATTRIBUTE, apprentice.bit)) {
        return `enter-the-gate-talking-to-apprentice-${name}-talking-to-apprentice-${name}-again`;
      }
      setBit(player, TEMPLE_SEEN_ATTRIBUTE, apprentice.bit);
      player.getPacketSender().sendVarbit(TEMPLE_SEEN_VARBITS[apprentice.key], 1);
      if (allTempleApprenticesSeen(player)) setStage(player, STAGE_APPRENTICES);
      return `enter-the-gate-talking-to-apprentice-${name}`;
    }
    return `enter-the-gate-talking-to-apprentice-${name}-again`;
  }

  function selectTamaraTempleVariant(player) {
    const progress = tutorialProgress(player);
    replaceLostAltarItems(player, progress);
    if (progress === TUTORIAL_START) return "enter-the-gate-talking-to-apprentice-tamara-again";
    if (progress === TUTORIAL_FELIX) {
      if (!has(player, WEAK_CELL_ITEM_ID)) {
        return "guardians-of-the-rift-talking-to-tamara-talking-to-tamara-again";
      }
      setTutorialProgress(player, TUTORIAL_TAMARA);
      return "guardians-of-the-rift-talking-to-tamara";
    }
    if (progress === TUTORIAL_TAMARA) {
      return "guardians-of-the-rift-talking-to-tamara-talking-to-tamara-again";
    }
    if (progress <= TUTORIAL_PILE_ONE) {
      return "guardians-of-the-rift-after-placing-the-weak-cell-in-the-inactive-cell-tile-talking-to-tamara-again";
    }
    if (progress === TUTORIAL_PILES) return "guardians-of-the-rift-talking-to-tamara-after-assembling-both-essence-piles";
    if (progress === TUTORIAL_ESSENCE) {
      setFlag(player, MIND_BRIEFED_ATTRIBUTE);
      syncTutorialScene(player);
      return "guardians-of-the-rift-talking-to-tamara-after-making-guardian-essence";
    }
    if (progress === TUTORIAL_MIND_STONES) return "guardians-of-the-rift-talking-to-tamara-after-returning-from-the-mind-altar";
    if (progress === TUTORIAL_REPOWERED) return "guardians-of-the-rift-talking-to-tamara-after-replacing-the-weak-cell";
    if (progress === TUTORIAL_POWERED_ONE) return "guardians-of-the-rift-talking-to-tamara-again-after-getting-essence";
    if (progress === TUTORIAL_WATER_STONES) return "guardians-of-the-rift-talking-to-tamara-after-returning-from-the-water-altar";
    if (progress === TUTORIAL_POWERED_TWO) return "guardians-of-the-rift-talking-to-tamara-after-powering-the-great-guardian";
    if (progress === TUTORIAL_MEDIUM_GUARDIAN) {
      return "guardians-of-the-rift-talking-to-tamara-after-constructing-the-medium-elemental-guardian";
    }
    if (progress === TUTORIAL_WATER_STONES_TWO) {
      return "guardians-of-the-rift-talking-to-tamara-again-after-returning-from-the-water-altar";
    }
    return "guardians-of-the-rift-placing-the-medium-cell-talking-to-tamara-again";
  }

  function selectVariant({ npcId, player }) {
    if (!player || npcId === undefined || npcId === null) return null;
    if (
      npcId === PERSTEN_ALKHARID_NPC_ID ||
      npcId === PERSTEN_TOWER_NPC_ID ||
      npcId === PERSTEN_TEMPLE_NPC_ID
    ) {
      return selectPerstenVariant(player, npcId);
    }
    if (MAGE_OF_ZAMORAK_NPC_IDS.has(npcId)) {
      if (!isQuestComplete(player, "enter_the_abyss")) return null;
      return selectMageVariant(player);
    }
    if (npcId === TEA_SELLER_NPC_ID) return selectTeaSellerVariant(player);
    if (npcId === DARK_MAGE_NPC_ID) return selectDarkMageVariant(player);
    if (SEDRIDOR_NPC_IDS.has(npcId)) return selectSedridorVariant(player);
    if (npcId === TRAIBORN_NPC_ID) return selectTraibornVariant(player);
    const tower = TOWER_APPRENTICES.get(npcId);
    if (tower) return selectTowerApprenticeVariant(player, tower);
    const temple = TEMPLE_APPRENTICES.get(npcId);
    if (temple) {
      if (stageOf(player) < STAGE_TEMPLE) return null;
      return selectTempleApprenticeVariant(player, temple);
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // Prose conditions
  // ---------------------------------------------------------------------------

  const CONDITIONS = {
    "5x2EJz": (player) => flag(player, ASKED_WHO_ATTRIBUTE),
    xjLZgp: (player) => !flag(player, ASKED_WHO_ATTRIBUTE),
    ueNF9b: (player) => player.getSkillManager().getMaxLevel(Skill.RUNECRAFTING) < RUNECRAFTING_REQUIREMENT,
    "4LUYlb": (player) => !hasAbyssAccess(player),
    UvvJeQ: (player) => isQuestComplete(player, "one_small_favour"),
    "6mjtMT": (player) => !isQuestComplete(player, "one_small_favour"),
    CD4sRJ: (player) => freeSlots(player) > 0,
    m_fZw2: (player) => freeSlots(player) === 0,
    qNbqaf: (player) => freeSlots(player) > 0,
    fx5WtI: (player) => freeSlots(player) === 0,
    dPPZU6: (player) =>
      stageOf(player) >= STAGE_STARTED &&
      stageOf(player) < STAGE_INCANTATION &&
      flag(player, AMULET_GIVEN_ATTRIBUTE) &&
      !has(player, EYE_AMULET_ITEM_ID),
    "9oHLO8": (player) => freeSlots(player) > 0,
    RRx8bv: (player) => freeSlots(player) === 0,
    UXEy6w: (player) => has(player, EYE_AMULET_ITEM_ID),
    M6TKOZ: (player) => !has(player, EYE_AMULET_ITEM_ID),
    BLoucl: (player) => freeSlots(player) > 0,
    RsGuTD: (player) => freeSlots(player) === 0,
    I3wzfP: (player) => teaState(player) === 1 && !has(player, STRONG_CUP_OF_TEA_ITEM_ID),
    MdjtWV: (player) => freeSlots(player) > 0,
    zFi4GX: (player) => freeSlots(player) === 0,
    bz7N1C: (player) => has(player, STRONG_CUP_OF_TEA_ITEM_ID),
    inA5S6: (player) =>
      !(has(player, BUCKET_OF_WATER_ITEM_ID) && has(player, STRONG_CUP_OF_TEA_ITEM_ID)),
    ajMHRn: (player) => !has(player, EYE_AMULET_ITEM_ID),
    AkpGjf: (player) => !has(player, EYE_AMULET_ITEM_ID),
    flsu2v: (player) => !has(player, BUCKET_OF_WATER_ITEM_ID),
    XQqM3d: (player) => has(player, EYE_AMULET_ITEM_ID) && has(player, BUCKET_OF_WATER_ITEM_ID),
    KouyCA: (player) => !has(player, EYE_AMULET_ITEM_ID),
    xfooas: (player) => !has(player, BUCKET_OF_WATER_ITEM_ID),
    ehWaVe: (player) => !has(player, EYE_AMULET_ITEM_ID),
    mSDZJX: (player) => has(player, EYE_AMULET_ITEM_ID),
    c_EtH5: (player) => flag(player, INCANTATION_GIVEN_ATTRIBUTE) && !has(player, ABYSSAL_INCANTATION_ITEM_ID),
    GBgxX8: (player) => has(player, ABYSSAL_INCANTATION_ITEM_ID),
    "HMdE8-": (player) => has(player, EYE_AMULET_ITEM_ID),
    azV7CN: (player) => !has(player, EYE_AMULET_ITEM_ID),
    "9WBjIy": (player) => flag(player, INCANTATION_GIVEN_ATTRIBUTE) && !has(player, ABYSSAL_INCANTATION_ITEM_ID),
    d1t8nh: (player) => has(player, ABYSSAL_INCANTATION_ITEM_ID),
    IZ4en0: (player) => flag(player, INCANTATION_GIVEN_ATTRIBUTE) && !has(player, ABYSSAL_INCANTATION_ITEM_ID),
    zcMwNf: (player) => has(player, ABYSSAL_INCANTATION_ITEM_ID),
    "7OKcvR": (player) => !has(player, ABYSSAL_INCANTATION_ITEM_ID),
    // The riddle's answer is typed (askThingummywut plays these two branches directly).
    ERLp2D: () => false,
    n7mdk3: () => false,
    pwel1s: (player) => has(player, GUARDIAN_FRAGMENTS_ITEM_ID),
    gOiPkU: (player) => !has(player, GUARDIAN_FRAGMENTS_ITEM_ID),
    ISndPO: (player) => !flag(player, MAGE_POSTQUEST_ATTRIBUTE),
    ZaSvlD: (player) => flag(player, MAGE_POSTQUEST_ATTRIBUTE),
  };

  function answerCondition({ player, stepId }) {
    const answer = CONDITIONS[stepId];
    if (!answer || !player) return null;
    return answer(player) === true;
  }

  // ---------------------------------------------------------------------------
  // Choice / chosen-condition / action side effects
  // ---------------------------------------------------------------------------

  const SCENE_LINES = new Map([
    ["Are we... underwater?", (player) => camera(player, [2399, 5645, 550], [2399, 5626, 300], { rate: 1, rate2: 0 })],
    ["Let me cast a locator spell!", (player) => camera(player, [2391, 5641, 720], [2403, 5634, 480])],
    ["It seems we're deep below the sea, just south of Morytania!", (player) => camera(player, [2391, 5641, 720], [2403, 5634, 480])],
    ["And with you, Zachariah. So, it's really true?", (player) => camera(player, [2389, 5734, 760], [2403, 5728, 560], { rate: 1, rate2: 0 })],
    ["[player name]?", (player) => {
      if (stageOf(player) !== STAGE_VISION || scenePhases.get(player) !== "vision") return;
      scenePhases.set(player, "vision-ending");
      syncSpawns(player);
      camera(player, [2388, 5734, 879], [2398, 5728, 679]);
    }],
    ["Huh... now that is a problem.", (player) => scene(player, "rift")],
    ["Persten!", (player) => {
      scene(player, "rift-open");
      player.getPacketSender().sendSound(1629, 1, 0);
    }],
    ["You don't belong in this temple, accursed filth!", (player) => {
      Scenes.later(player, 4, () => player.isRegistered() && scene(player, "rift-cleared"));
    }],
    ["And so the rift to the Scar is open once more. Humans, fight with us. Let us hold back the Abyss!", (player) => {
      setSpawn(player, "scene-guardian", { id: GREAT_GUARDIAN_SCENE_NPC_ID, ...SCENE_GUARDIAN_TILE, wanderRadius: 0 }, true);
      spawns.get(player)?.get("scene-guardian")?.performAnimation(new Animation(SEQ_GUARDIAN_APPEARS));
      camera(player, [2386, 5663, 970], [2408, 5667, 170]);
    }],
    ["We are safe, for now.", (player) => camera(player, [2386, 5663, 970], [2408, 5667, 170])],
  ]);

  // Speakers the shared index can't name; the cache calls both of the first two "Mysterious Voice".
  const SCENE_SPEAKERS = new Map([
    ["Zachariah", ZACHARIAH_NPC_ID],
    ["First Mysterious Voice", ZACHARIAH_NPC_ID],
    ["Aliya", ALIYA_NPC_ID],
    ["Second Mysterious Voice", ALIYA_NPC_ID],
    ["The Great Guardian", GREAT_GUARDIAN_SCENE_NPC_ID],
    ["Great Guardian", GREAT_GUARDIAN_NPC_ID],
    ["Wizard Persten", PERSTEN_CUTSCENE_NPC_ID],
    ["Apprentice Tamara", TAMARA_CUTSCENE_NPC_ID],
    ["Apprentice Cordelia", CORDELIA_CUTSCENE_NPC_ID],
    ["Apprentice Felix", FELIX_CUTSCENE_NPC_ID],
  ]);

  function scene(player, phase) {
    scenePhases.set(player, phase);
    syncSpawns(player);
  }

  function camera(player, move, look, rates = { rate: 232, rate2: 100 }) {
    player.getPacketSender().sendCameraMoveTo(move[0], move[1], move[2], rates)
      .sendCameraLookAt(look[0], look[1], look[2], rates);
  }

  function endScene(player) {
    player.getPacketSender().sendCameraReset();
    Scenes.controls(player, false);
  }

  const LINES = {
    "Try making another rune guardian using that cell. In the meantime, I'll see if I can work out what this talisman does.":
      handleTalismanTaken,
    "However, Traiborn has three new apprentices who could help. This might be a good learning opportunity for them. Speak to him while I inspect this incantation.":
      handleSedridorBriefLine,
    "Right... I'll speak to the apprentices. Perhaps together we can figure this out.":
      handleTraibornBriefLine,
  };

  const PUZZLE_INTROS = new Map([
    [FELIX_TOWER_NPC_ID, "Okay, I'll show you the puzzle."],
    [TAMARA_TOWER_NPC_ID, "Sure! Just please don't tell the others you helped me."],
    [CORDELIA_TOWER_NPC_ID, "Here it is."],
  ]);

  function handleLine(event) {
    const { player, npcId } = event;
    if (!player || !MY_NPC_IDS.has(npcId)) return;
    if (stageOf(player) === STAGE_INCANTATION_READY
      && event.step?.speaker === "Persten and co."
      && event.text === "Saris! Val! Curak! Belito!"
      && event.step?.presentation === "overhead") {
      const owned = spawns.get(player);
      event.actors = [
        owned?.get("incantation-tamara"),
        owned?.get("incantation-felix"),
        owned?.get("incantation-cordelia"),
        owned?.get("incantation-persten"),
      ];
      event.before = () => {
        const location = player.getLocation?.();
        if (!location || !event.actors.every(actor => actor?.isRegistered?.() === true
          && actor.isVisible?.() === true
          && actor.isOwnerOnly?.() === true
          && actor.getOwner?.() === player
          && actor.getPrivateArea?.() === (player.getPrivateArea?.() ?? null)
          && actor.getLocation?.()?.getZ?.() === location.getZ())) return;
        event.actors.forEach(actor => {
          actor.performAnimation(new Animation(INCANTATION_ANIMATION_ID));
          actor.performGraphic(new Graphic(INCANTATION_GRAPHIC_ID));
        });
      };
      return;
    }
    if (PUZZLE_INTROS.get(npcId) === event.text) {
      const key = [...TOWER_APPRENTICES].find(([id]) => id === npcId)?.[1]?.key;
      if (key) openPuzzleLater(player, key);
      return;
    }
    const speakerId = SCENE_SPEAKERS.get(event.step?.speaker);
    if (speakerId !== undefined && npcId !== speakerId) event.speakerId = speakerId;
    if (npcId === TRAIBORN_NPC_ID && event.text === "Oh? Do tell." && stageOf(player) === STAGE_RIDDLE_TOLD && allTowerRiddlesSeen(player)) {
      event.after = () => askThingummywut(player);
      return;
    }
    // The runner emits a line while it builds its chain: `before` runs when the line is reached.
    // The step's own text: another handler may already have filled in "[player name]".
    const sceneLine = SCENE_LINES.get(event.step?.text ?? event.text);
    if (sceneLine) {
      event.before = () => sceneLine(player);
      return;
    }
    const handler = LINES[event.text];
    if (handler) handler(player);
  }

  function handleTalismanTaken(player) {
    takeAll(player, PORTAL_TALISMAN_WATER_ITEM_ID);
  }

  /** Capture 1693: Traiborn's "Do tell." is answered in a count dialog, "What is a thingummywut?" */
  function askThingummywut(player) {
    player.getDialogueManager().reset?.();
    player.setEnteredAmountAction({ acceptsZero: true, execute: (count) => answerThingummywut(player, Math.floor(Number(count) || 0)) });
    player.getPacketSender().sendEnterAmountPrompt("What is a thingummywut?");
  }

  function answerThingummywut(player, answer) {
    if (stageOf(player) !== STAGE_RIDDLE_TOLD) return;
    play(player, TRAIBORN_NPC_ID, "help-from-some-wizards-talking-to-traiborn-after-seeing-all-three-riddles", (raw) =>
      (stepById(raw, answer === THINGUMMYWUT ? "ERLp2D" : "n7mdk3")?.steps ?? []).map((step) =>
        step.text === "[number]!" ? { ...step, text: `${answer}!` } : step));
  }

  function handleSedridorBriefLine(player) {
    if (stageOf(player) === STAGE_SEDRIDOR) setStage(player, STAGE_TRAIBORN);
  }

  function handleTraibornBriefLine(player) {
    if (stageOf(player) === STAGE_TRAIBORN) setStage(player, STAGE_RIDDLE);
  }

  function handleChoice(event) {
    const { player, npcId, option } = event;
    if (!player || !MY_NPC_IDS.has(npcId)) return;
    if (npcId === PERSTEN_ALKHARID_NPC_ID) {
      if (option === "Who are you?") {
        setFlag(player, ASKED_WHO_ATTRIBUTE);
      } else if (option === "No." && stageOf(player) === 0) {
        setFlag(player, DECLINED_ATTRIBUTE);
      } else if (option === "Yes." && stageOf(player) === 0) {
        // The wiki's "Same as below" acceptance section is not expanded into the
        // start variant's branch; start the quest here so the next talk reaches
        // Persten's amulet hand-over even if that branch only says "that's a shame".
        if (!meetsStartRequirements(player)) {
          player.sendMessage("You need a Runecrafting level of 10 and must have completed Enter the Abyss to start this quest.");
          return;
        }
        setFlag(player, AMULET_GIVEN_ATTRIBUTE, false);
        setFlag(player, DECLINED_ATTRIBUTE, false);
        setStage(player, STAGE_STARTED);
      } else if (option === "Yes." && stageOf(player) === STAGE_TOWER && has(player, ABYSSAL_INCANTATION_ITEM_ID)) {
        // The transcript's jump leaves this "Yes." empty, so the runner's next menu is closed here.
        Scenes.later(player, 1, () => {
          if (!player.isRegistered()) return;
          player.getDialogueManager().reset?.();
          teleportToTower(player);
        });
      }
      return;
    }
    if (npcId === TRAIBORN_NPC_ID) return;
    if ((SEDRIDOR_NPC_IDS.has(npcId) || npcId === PERSTEN_TOWER_NPC_ID) && option === "Not yet.") {
      if (stageOf(player) === STAGE_RIDDLE_DONE) setStage(player, STAGE_INCANTATION_READY);
    }
  }

  function teleportToTower(player) {
    player.setAttribute(TELEPORT_ATTRIBUTE, teleports(player) | TOWER_TELEPORT_BIT);
    player.getPacketSender().sendVarbit(13753, 1);
    moveTo(player, TOWER_ENTRANCE_TILE);
  }

  function handleCondition(event) {
    const { player, npcId, stepId } = event;
    if (!player || !MY_NPC_IDS.has(npcId)) return;
    if (
      stepId === "azV7CN" &&
      npcId === PERSTEN_ALKHARID_NPC_ID &&
      stageOf(player) === STAGE_INCANTATION &&
      !has(player, EYE_AMULET_ITEM_ID)
    ) {
      // Persten "finds" the lost amulet and keeps it.
      setStage(player, STAGE_COPIED);
    }
  }

  function handleAction(event) {
    const { player, npcId, stepId } = event;
    if (!player || !stepId || !MY_NPC_IDS.has(npcId)) return;
    if (event.kind === "message" || MESSAGE_STEP_IDS.has(stepId)) {
      handleMessageStep(player, stepId);
      return;
    }
    switch (stepId) {
      case "Dj2PaV": // The captured "A blue portal opens" action follows the overhead chant.
        if (stageOf(player) !== STAGE_INCANTATION_READY || !hasIncantationCast(player)) return;
        player.setAttribute(BASEMENT_PORTAL_OPEN_ATTRIBUTE, true);
        syncBasementPortal(player);
        event.handled = true;
        return;
      case "5SxUiq":
      case "YdNgEz": // the Mage of Zamorak's one-time teleport
        if (stageOf(player) !== STAGE_TEA_DRUNK) return;
        if (!has(player, EYE_AMULET_ITEM_ID) || !has(player, BUCKET_OF_WATER_ITEM_ID)) return;
        player.setAttribute(TELEPORT_ATTRIBUTE, teleports(player) | ABYSS_TELEPORT_BIT);
        player.getPacketSender().sendVarbit(13740, 1);
        moveTo(player, ABYSS_CENTRE_TILE);
        setStage(player, STAGE_IN_ABYSS);
        event.handled = true;
        return;
      case "5mu1Ni":
      case "ZOWKkY": // Persten teleports the player to the Wizards' Tower entrance
        if (stageOf(player) !== STAGE_TOWER || !has(player, ABYSSAL_INCANTATION_ITEM_ID)) return;
        teleportToTower(player);
        event.handled = true;
        return;
      case "DLPFdT":
      case "XJ8F74":
      case "itFyK-": // "Incantation cutscene begins below."
        if (stageOf(player) !== STAGE_RIDDLE_DONE && stageOf(player) !== STAGE_INCANTATION_READY) return;
        incantationPlaying.add(player);
        setStage(player, STAGE_INCANTATION_READY);
        syncSpawns(player);
        Scenes.controls(player, true, true);
        camera(player, [3107, 9563, 550], [3104, 9573, 250]);
        event.handled = true;
        event.steps = variantSteps("enter-the-gate-incantation-cutscene");
        return;
      case "I_aoEy": // "Temple of the Eye cutscene continues below."
        if (stageOf(player) !== STAGE_INCANTATION_READY) return;
        event.handled = true;
        incantationPlaying.delete(player);
        moveTo(player, TEMPLE_ARRIVAL_TILE);
        setStage(player, STAGE_PORTAL_OPEN);
        Scenes.controls(player, true, true);
        camera(player, [2399, 5636, 550], [2399, 5626, 300]);
        event.steps = variantSteps("enter-the-gate-temple-of-the-eye-cutscene");
        return;
      case "MKvLzs": // "The cutscene ends." (the group is at the temple)
        if (stageOf(player) !== STAGE_PORTAL_OPEN) return;
        event.handled = true;
        moveTo(player, TEMPLE_EXPLORE_TILE);
        setStage(player, STAGE_TEMPLE);
        endScene(player);
        return;
      case "Wc3Ys0": // the vision begins
        if (stageOf(player) !== STAGE_APPRENTICES) return;
        event.handled = true;
        scenePhases.set(player, "vision");
        moveTo(player, VISION_TILE);
        setStage(player, STAGE_VISION);
        Scenes.controls(player, true, true);
        camera(player, [2389, 5734, 760], [2403, 5739, 560]);
        return;
      case "9R5c1w":
      case "9kzaP8": // "Abyssal rift cutscene continues below."
        if (stageOf(player) !== STAGE_VISION) return;
        event.handled = true;
        moveTo(player, RIFT_SCENE_TILE);
        scene(player, "rift");
        camera(player, [2395, 5662, 470], [2401, 5675, 270]);
        event.steps = variantSteps("enter-the-gate-abyssal-rift-cutscene");
        return;
      case "dUuNRU": // the temple rumbles as the rift opens
        if (stageOf(player) !== STAGE_VISION) return;
        event.handled = true;
        shakeRift(player);
        return;
      case "2OgBfc": // "Great Guardian cutscene continues below."
        if (stageOf(player) !== STAGE_VISION) return;
        event.handled = true;
        startTutorial(player);
        event.steps = variantSteps("enter-the-gate-great-guardian-cutscene");
        return;
      case "PUnmxV": // Traiborn sets off fireworks
        if (stageOf(player) !== STAGE_RIDDLE_TOLD) return;
        event.handled = true;
        setStage(player, STAGE_RIDDLE_DONE);
        return;
      case "Gs6Qdo": // Cordelia's "see the puzzle again"
        if (stageOf(player) !== STAGE_RIDDLE) return;
        event.handled = true;
        openPuzzleLater(player, "cordelia");
        return;
      case "t_zXOj": // Felix's
        if (stageOf(player) !== STAGE_RIDDLE) return;
        event.handled = true;
        openPuzzleLater(player, "felix");
        return;
      case "HDrYiF": // Tamara's
        if (stageOf(player) !== STAGE_RIDDLE) return;
        event.handled = true;
        openPuzzleLater(player, "tamara");
        return;
      case "9lBe0i": // the Guardian's beam (capture: 2 ticks of sound, then the rift seals)
        if (stageOf(player) !== STAGE_CLOSED) return;
        event.handled = true;
        player.getPacketSender().sendSound(SOUND_RIFT_BEAM, 1, 0);
        camera(player, [2399, 5667, 820], [2399, 5684, 380]);
        Scenes.later(player, 5, () => player.isRegistered() && player.getPacketSender().sendSound(SOUND_RIFT_SEALS, 1, 0));
        return;
      case "wd6dSZ": // "The player returns to the Wizards' Tower."
        if (stageOf(player) !== STAGE_CLOSED) return;
        event.handled = true;
        moveTo(player, BASEMENT_LANDING_TILE);
        setStage(player, STAGE_FINAL);
        endScene(player);
        return;
      case "_nVw7q": // "Sedridor cutscene continues below."
      case "m2nPIk":
        if (stageOf(player) !== STAGE_CLOSED && stageOf(player) !== STAGE_FINAL) return;
        event.handled = true;
        if (stageOf(player) === STAGE_CLOSED) setStage(player, STAGE_FINAL);
        event.steps = variantSteps("guardians-of-the-rift-sedridor-cutscene");
        return;
      case "9-Wilv": // "Congratulations! Quest complete!"
        if (stageOf(player) !== STAGE_FINAL) return;
        quest.complete(player);
        syncSpawns(player);
        event.handled = true;
        event.end = true;
        return;
      default:
        return;
    }
  }

  function shakeRift(player) {
    const sender = player.getPacketSender();
    sender.sendCameraShake(0, 5);
    Scenes.later(player, 1, () => player.isRegistered() && sender.sendCameraShake(0, 4));
    Scenes.later(player, 2, () => player.isRegistered() && sender.sendCameraShake(0, 3));
    Scenes.later(player, 3, () => {
      if (!player.isRegistered()) return;
      sender.sendCameraShake(0, 2);
      camera(player, [2399, 5667, 470], [2399, 5684, 270], { rate: 3, rate2: 1 });
    });
    Scenes.later(player, 4, () => player.isRegistered() && sender.sendCameraShake(0, 1));
    Scenes.later(player, 5, () => player.isRegistered() && sender.sendCameraShake(0, 0));
    Scenes.later(player, 6, () => {
      if (!player.isRegistered()) return;
      camera(player, [2399, 5667, 710], [2399, 5684, 270], { rate: 3, rate2: 1 });
    });
    Scenes.later(player, 8, () => {
      if (!player.isRegistered()) return;
      camera(player, [2399, 5667, 400], [2399, 5684, 270], { rate: 3, rate2: 1 });
    });
  }

  function handleMessageStep(player, stepId) {
    switch (stepId) {
      case "MMRv1P":
      case "pNBge3":
      case "wIL3wh": // Persten hands you the amulet
        if (!stageBetween(player, STAGE_STARTED, STAGE_INCANTATION)) return;
        if (freeSlots(player) === 0 && !has(player, EYE_AMULET_ITEM_ID)) return;
        giveQuestItem(player, EYE_AMULET_ITEM_ID);
        setFlag(player, AMULET_GIVEN_ATTRIBUTE);
        setFlag(player, DECLINED_ATTRIBUTE, false);
        if (stageOf(player) < STAGE_APPRAISED) setStage(player, STAGE_APPRAISED);
        return;
      case "FJLAsS": // the Mage of Zamorak appraises the amulet and asks for tea
        if (stageOf(player) !== STAGE_APPRAISED || !has(player, EYE_AMULET_ITEM_ID)) return;
        player.getPacketSender().sendVarbit(13739, 1);
        setStage(player, STAGE_TEA_GIVEN);
        return;
      case "QDRpz2":
      case "L04HOi": // the Tea Seller hands you a strong cup of tea
        if (!stageBetween(player, STAGE_APPRAISED, STAGE_TEA_DRUNK)) return;
        if (freeSlots(player) === 0 && !has(player, STRONG_CUP_OF_TEA_ITEM_ID)) return;
        giveQuestItem(player, STRONG_CUP_OF_TEA_ITEM_ID);
        player.setAttribute(TEA_ATTRIBUTE, 1);
        player.getPacketSender().sendVarbit(13741, 1);
        return;
      case "4t9kd_": // the Mage of Zamorak takes and drinks the tea
        if (stageOf(player) !== STAGE_TEA_GIVEN) return;
        if (!has(player, STRONG_CUP_OF_TEA_ITEM_ID) || !has(player, BUCKET_OF_WATER_ITEM_ID)) return;
        takeAll(player, STRONG_CUP_OF_TEA_ITEM_ID);
        player.setAttribute(TEA_ATTRIBUTE, 2);
        setStage(player, STAGE_TEA_DRUNK);
        return;
      case "BOdA6N": // the player throws the bucket of water over the Dark Mage
        if (stageOf(player) !== STAGE_IN_ABYSS) return;
        if (!has(player, BUCKET_OF_WATER_ITEM_ID) || !has(player, EYE_AMULET_ITEM_ID)) return;
        takeAll(player, BUCKET_OF_WATER_ITEM_ID);
        setStage(player, STAGE_DARK_MAGE);
        return;
      case "5f9QJZ":
      case "PRt-AR": // the Dark Mage casts the spell on the amulet
        if (stageOf(player) !== STAGE_DARK_MAGE || darkMageState(player) !== 0) return;
        if (!has(player, EYE_AMULET_ITEM_ID)) return;
        player.setAttribute(DARK_MAGE_ATTRIBUTE, 1);
        energyOrder(player);
        setStage(player, STAGE_ENERGY);
        syncEnergyObjects(player);
        return;
      case "qOBPPr": // Persten copies the incantation
        if (stageOf(player) !== STAGE_INCANTATION || !has(player, ABYSSAL_INCANTATION_ITEM_ID)) return;
        setFlag(player, INCANTATION_GIVEN_ATTRIBUTE);
        setStage(player, STAGE_COPIED);
        return;
      case "9mZfyI":
      case "SzAddC": // the Dark Mage hands you an incantation
        if (stageOf(player) !== STAGE_ENERGY_DONE) return;
        if (freeSlots(player) === 0 && !has(player, ABYSSAL_INCANTATION_ITEM_ID)) return;
        giveQuestItem(player, ABYSSAL_INCANTATION_ITEM_ID);
        setFlag(player, INCANTATION_GIVEN_ATTRIBUTE);
        player.getPacketSender().sendVarbit(13746, 1);
        setStage(player, STAGE_INCANTATION);
        return;
      case "MZvnSC": // you give the amulet back to Persten
        if (stageOf(player) !== STAGE_COPIED || !has(player, EYE_AMULET_ITEM_ID)) return;
        takeAll(player, EYE_AMULET_ITEM_ID);
        setStage(player, STAGE_AMULET_RETURNED);
        return;
      case "VVjWKh":
      case "dFEOfF": // Persten hands you a copy of the incantation
        if (!stageBetween(player, STAGE_COPIED, STAGE_SEDRIDOR)) return;
        if (freeSlots(player) === 0 && !has(player, ABYSSAL_INCANTATION_ITEM_ID)) return;
        giveQuestItem(player, ABYSSAL_INCANTATION_ITEM_ID);
        setFlag(player, INCANTATION_GIVEN_ATTRIBUTE);
        return;
      case "7fimNu": // Persten finishes inspecting the amulet
        if (!stageBetween(player, STAGE_COPIED, STAGE_TOWER)) return;
        setStage(player, STAGE_TOWER);
        return;
      case "anGHDo": // you give the incantation to Sedridor
        if (stageOf(player) !== STAGE_TOWER || !has(player, ABYSSAL_INCANTATION_ITEM_ID)) return;
        takeAll(player, ABYSSAL_INCANTATION_ITEM_ID);
        setStage(player, STAGE_SEDRIDOR);
        return;
      case "LUkI-K": // Tamara hands you the talisman
        if (!inTutorial(player) || tutorialProgress(player) !== TUTORIAL_MEDIUM_GUARDIAN) return;
        if (freeSlots(player) === 0 && !has(player, PORTAL_TALISMAN_WATER_ITEM_ID)) return;
        giveQuestItem(player, PORTAL_TALISMAN_WATER_ITEM_ID);
        return;
      default:
        return;
    }
  }

  // ---------------------------------------------------------------------------
  // Item on NPC / item on object
  // ---------------------------------------------------------------------------

  function handleItemOnNpc(event) {
    const { player, itemId } = event;
    const npcId = event.npcId ?? event.target?.getId?.();
    if (!player || npcId === undefined || npcId === null) return;
    if (itemId === EYE_AMULET_ITEM_ID && MAGE_OF_ZAMORAK_NPC_IDS.has(npcId)) {
      if (!isQuestComplete(player, "enter_the_abyss")) return;
      if (stageOf(player) < STAGE_STARTED || stageOf(player) >= STAGE_TEA_DRUNK) return;
      const variant = selectMageVariant(player);
      if (!variant) return;
      event.handled = true;
      playOption(player, npcId, variant, /amulet/i);
      return;
    }
    if (itemId === EYE_AMULET_ITEM_ID && npcId === DARK_MAGE_NPC_ID) {
      if (stageOf(player) < STAGE_IN_ABYSS || stageOf(player) >= STAGE_DARK_MAGE || darkMageState(player) !== 0) return;
      event.handled = true;
      playOption(player, npcId, "herbert-and-the-dark-mage-talking-to-the-dark-mage", /amulet/i);
      return;
    }
    if (itemId === ABYSSAL_INCANTATION_ITEM_ID && SEDRIDOR_NPC_IDS.has(npcId)) {
      if (stageOf(player) < STAGE_TOWER || stageOf(player) >= STAGE_SEDRIDOR) return;
      event.handled = true;
      playOption(player, npcId, "help-from-some-wizards-talking-to-archmage-sedridor", /incantation/i);
      return;
    }
    if ((itemId === ABYSSAL_INCANTATION_ITEM_ID || itemId === EYE_AMULET_ITEM_ID) && npcId === PERSTEN_ALKHARID_NPC_ID) {
      const variant = stageBetween(player, STAGE_INCANTATION, STAGE_TOWER) ? selectPerstenVariant(player, npcId) : null;
      if (!variant) return;
      event.handled = true;
      play(player, npcId, variant);
    }
  }

  /** An item used on an NPC goes straight to what its menu option would say. */
  function playOption(player, npcId, variant, option) {
    play(player, npcId, variant, (raw) => optionSteps(raw, option) ?? raw);
  }

  function handleItemOnObject(event) {
    const { player, itemId, objectId } = event;
    if (!player) return;
    if (itemId === EYE_AMULET_ITEM_ID && objectId === CHAOS_ALTAR_OBJECT_ID) {
      if (!stageBetween(player, STAGE_STARTED, STAGE_TEA_DRUNK)) return;
      player.sendMessage("The eye carved into the amulet stares back at the chaos altar.");
      event.handled = true;
    }
  }

  /** Capture 1693: Tamara's talisman opens the closed Guardian of Water, and is used up. */
  function useTalismanOnGuardian(event) {
    const { player, objectId } = event;
    if (objectId !== GUARDIAN_OF_WATER_CLOSED_OBJECT_ID && objectId !== GUARDIAN_OF_WATER_OPEN_OBJECT_ID) return false;
    if (!inTutorial(player) || tutorialProgress(player) !== TUTORIAL_MEDIUM_GUARDIAN) return false;
    if (!has(player, PORTAL_TALISMAN_WATER_ITEM_ID)) return false;
    takeAll(player, PORTAL_TALISMAN_WATER_ITEM_ID);
    altarTrip(player, WATER_OVERLAY, WATER_ALTAR_TILE, "You step through the rift and find yourself at the Water Altar.");
    event.handled = true;
    return true;
  }

  function useAmuletOnChapel(event) {
    handleItemOnObject(event);
    return event.handled === true;
  }

  // ---------------------------------------------------------------------------
  // Object interactions
  // ---------------------------------------------------------------------------

  function tutorialLocation(tile) {
    return new Location(tile.x, tile.y, tile.z ?? 0);
  }

  /** What only this player sees of the tutorial: the barrier and the Guardians it has opened. */
  function setTutorialLoc(player, key, definition) {
    let locs = tutorialLocs.get(player);
    if (!locs) {
      locs = new Map();
      tutorialLocs.set(player, locs);
    }
    const existing = locs.get(key);
    if (existing && definition && existing.getId() === definition.id) return;
    if (existing) {
      ObjectManager.deregister(existing, true);
      locs.delete(key);
      // A loc over one of the map's own (an opened Guardian) gives that one back.
      if (!definition && existing.__tutorialRestore) player.getPacketSender().sendObject(existing.__tutorialRestore);
    }
    if (!definition) return;
    const object = new GameObject(definition.id, tutorialLocation(definition), definition.type ?? 10, definition.face ?? 0, null).setOwner(player);
    if (definition.restoreId !== undefined) {
      object.__tutorialRestore = new GameObject(definition.restoreId, tutorialLocation(definition), definition.type ?? 10, definition.face ?? 0, null);
    }
    ObjectManager.register(object, true);
    locs.set(key, object);
  }

  function clearTutorialLocs(player) {
    const locs = tutorialLocs.get(player);
    if (!locs) return;
    for (const object of locs.values()) ObjectManager.deregister(object, true);
    tutorialLocs.delete(player);
  }

  function mindGuardianOpen(player) {
    const progress = tutorialProgress(player);
    return (progress === TUTORIAL_ESSENCE && flag(player, MIND_BRIEFED_ATTRIBUTE))
      || progress === TUTORIAL_MIND_STONES || progress === TUTORIAL_REPOWERED;
  }

  function waterGuardianOpen(player) {
    const progress = tutorialProgress(player);
    return progress >= TUTORIAL_POWERED_ONE && progress < TUTORIAL_MEDIUM_GUARDIAN;
  }

  /** The tile, barrier, opened Guardians, rift guardians and tools for the tutorial's progress. */
  function syncTutorialScene(player) {
    if (!inTutorial(player)) {
      clearTutorialLocs(player);
      for (const key of ["barrier-npc", "creature", "guardian-elemental", "guardian-catalytic", "guardian-medium"]) setSpawn(player, key, null, false);
      setSpawn(player, "scene-guardian", null, false);
      tutorialFights.delete(player);
      return;
    }
    const progress = tutorialProgress(player);
    const placed = progress >= TUTORIAL_CELL;
    const strong = progress >= TUTORIAL_MEDIUM_CELL;
    const tileId = strong ? MEDIUM_CELL_TILE_OBJECT_ID : placed ? WEAK_CELL_TILE_OBJECT_ID : INACTIVE_CELL_TILE_OBJECT_ID_2;
    setTutorialLoc(player, "tile", progress >= TUTORIAL_TAMARA ? { ...CELL_TILE, id: tileId, type: 22 } : null);
    setTutorialLoc(player, "barrier", placed ? { ...BARRIER_TILE, id: strong ? MEDIUM_BARRIER_OBJECT_ID : WEAK_BARRIER_OBJECT_ID } : null);
    setTutorialLoc(player, "mind", mindGuardianOpen(player)
      ? { ...MIND_GUARDIAN_LOC, id: GUARDIAN_OF_MIND_OPEN_OBJECT_ID, restoreId: GUARDIAN_OF_MIND_CLOSED_OBJECT_ID } : null);
    setTutorialLoc(player, "water", waterGuardianOpen(player)
      ? { ...WATER_GUARDIAN_LOC, id: GUARDIAN_OF_WATER_OPEN_OBJECT_ID, restoreId: GUARDIAN_OF_WATER_CLOSED_OBJECT_ID } : null);
    setSpawn(player, "barrier-npc", { id: WEAK_BARRIER_NPC_ID, ...BARRIER_TILE, wanderRadius: 0 }, placed);
    const post = { ...GUARDIAN_POST_TILE, wanderRadius: 0 };
    // One rift guardian stands from the first pile; a relog brings them back at their posts.
    const owned = spawns.get(player);
    const risen = (key) => progress >= TUTORIAL_PILES || (progress >= TUTORIAL_PILE_ONE && owned?.has(key));
    setSpawn(player, "guardian-elemental", { id: WEAK_ELEMENTAL_GUARDIAN_NPC_ID, ...post }, risen("guardian-elemental"));
    setSpawn(player, "guardian-catalytic", { id: WEAK_CATALYTIC_GUARDIAN_NPC_ID, ...post, x: post.x - 4 }, risen("guardian-catalytic"));
    setSpawn(player, "guardian-medium", { id: MEDIUM_ELEMENTAL_GUARDIAN_NPC_ID, ...post, x: post.x + 2 }, progress >= TUTORIAL_MEDIUM_GUARDIAN);
    ensureTutorialTools(player);
    if (placed) startTutorialFight(player);
  }

  /** Capture 1693: a chisel and a bronze pickaxe lie by the tables for the taking. */
  function ensureTutorialTools(player) {
    const manager = api.getItemOnGroundManager();
    const tools = [
      [CHISEL_ITEM_ID, CHISEL_GROUND_TILE, () => has(player, CHISEL_ITEM_ID)],
      [ItemIdentifiers.BRONZE_PICKAXE, PICKAXE_GROUND_TILE, () => hasPickaxe(player)],
    ];
    for (const [itemId, tile, held] of tools) {
      if (held()) continue;
      const location = tutorialLocation(tile);
      if (manager.getGroundItem(player.getUsername(), itemId, location, player.getPrivateArea?.() ?? null)) continue;
      manager.registerLocation(player, new Item(itemId, 1), location);
    }
  }

  function startTutorial(player) {
    scenePhases.delete(player);
    setSpawn(player, "scene-guardian", null, false);
    moveTo(player, TUTORIAL_ARRIVAL_TILE);
    setFlag(player, FELIX_POST_ATTRIBUTE, false);
    setTutorialProgress(player, TUTORIAL_START);
    setStage(player, STAGE_GUARDIAN);
    tutorialHint(player);
    endScene(player);
  }

  // A staged fight: one creature at a time comes to the barrier, the guardians go to it.
  function startTutorialFight(player) {
    if (tutorialFights.get(player)) return;
    const fight = { swings: 0 };
    tutorialFights.set(player, fight);
    const tick = () => {
      if (tutorialFights.get(player) !== fight || !player.isRegistered() || !inTutorial(player)) {
        if (tutorialFights.get(player) === fight) tutorialFights.delete(player);
        return;
      }
      stepTutorialFight(player, fight);
      Scenes.later(player, FIGHT_TICK_INTERVAL, tick);
    };
    Scenes.later(player, FIGHT_TICK_INTERVAL, tick);
  }

  function tileGap(a, x, y) {
    const location = a.getLocation();
    return Math.max(Math.abs(location.getX() - x), Math.abs(location.getY() - y));
  }

  function stepTutorialFight(player, fight) {
    const owned = spawns.get(player);
    if (!owned) return;
    if (!owned.has("creature")) {
      setSpawn(player, "creature", { id: ABYSSAL_LEECH_NPC_ID, ...CREATURE_SPAWN_TILE, wanderRadius: 0 }, true);
      fight.swings = 0;
    }
    const creature = owned.get("creature");
    if (!creature) return;
    const { PathFinder } = api.core;
    if (tileGap(creature, CREATURE_ATTACK_TILE.x, CREATURE_ATTACK_TILE.y) > 0) {
      PathFinder.calculateWalkRoute(creature, CREATURE_ATTACK_TILE.x, CREATURE_ATTACK_TILE.y);
    } else {
      creature.performAnimation(new Animation(SEQ_LEECH_ATTACK));
    }
    const guardians = ["guardian-elemental", "guardian-catalytic", "guardian-medium"].map((key) => owned.get(key)).filter(Boolean);
    let striking = false;
    for (const guardian of guardians) {
      const at = creature.getLocation();
      if (tileGap(guardian, at.getX(), at.getY()) <= 2) {
        guardian.performAnimation(new Animation(guardian.getId() === WEAK_CATALYTIC_GUARDIAN_NPC_ID ? SEQ_CATALYTIC_GUARDIAN_ATTACK : SEQ_RIFT_GUARDIAN_ATTACK));
        striking = true;
      } else {
        PathFinder.calculateWalkRoute(guardian, at.getX(), at.getY() - 1);
      }
    }
    if (striking && ++fight.swings >= CREATURE_SWINGS_TO_DIE) setSpawn(player, "creature", null, false);
  }

  /** Where the capture's hint arrow points for the tutorial's progress. */
  function tutorialHint(player) {
    const sender = player.getPacketSender();
    sender.clearHintArrow();
    if (!inTutorial(player)) return;
    const owned = spawns.get(player);
    const npc = (key) => {
      const target = owned?.get(key);
      if (!target) return;
      // An NPC arrow has nothing to draw until the NPC is in view, so a far one points at its tile.
      const at = target.getLocation();
      if (tileGap(player, at.getX(), at.getY()) > NPC_VIEW_TILES) sender.sendPositionalHint(at, 2, 128, at.getZ());
      else sender.sendEntityHint(target);
    };
    const tile = (at, height = 128) => sender.sendPositionalHint(tutorialLocation(at), 2, height, at.z ?? 0);
    const progress = tutorialProgress(player);
    const fragments = player.getInventory().getAmount(GUARDIAN_FRAGMENTS_ITEM_ID);
    const essence = player.getInventory().getAmount(GUARDIAN_ESSENCE_ITEM_ID);
    const weak = has(player, WEAK_CELL_ITEM_ID);
    const uncharged = has(player, UNCHARGED_CELL_ITEM_ID);
    const medium = has(player, MEDIUM_CELL_ITEM_ID);
    const lost = lostAltarItems(player, progress).length > 0;
    switch (progress) {
      case TUTORIAL_START: return npc("felix-tutorial");
      case TUTORIAL_FELIX: return weak ? npc("tamara-tutorial") : tile(WEAK_CELLS_TILE);
      case TUTORIAL_TAMARA: return tile(CELL_TILE, 32);
      case TUTORIAL_CELL:
        if (!flag(player, FELIX_POST_ATTRIBUTE)) return npc("felix-tutorial");
        return weak ? tile(ELEMENTAL_PILE_TILE, 64) : tile(WEAK_CELLS_TILE);
      case TUTORIAL_PILE_ONE: return weak ? tile(owned?.has("guardian-elemental") ? CATALYTIC_PILE_TILE : ELEMENTAL_PILE_TILE, 64) : tile(WEAK_CELLS_TILE);
      case TUTORIAL_PILES:
        if (fragments >= FRAGMENTS_A_ROUND) return npc("felix-tutorial");
        return tile(REMAINS_TILE);
      case TUTORIAL_ESSENCE:
        if (essence === 0 && fragments < FRAGMENTS_A_ROUND) return tile(REMAINS_TILE);
        if (fragments > 0) return tile(WORKBENCH_TILE);
        if (!flag(player, MIND_BRIEFED_ATTRIBUTE)) return npc("tamara-tutorial");
        return uncharged ? tile(MIND_GUARDIAN_LOC) : tile(UNCHARGED_CELLS_TILE);
      case TUTORIAL_MIND_STONES: return weak ? tile(CELL_TILE, 32) : npc("tamara-tutorial");
      case TUTORIAL_REPOWERED: return lost ? npc("tamara-tutorial") : npc("great-guardian");
      case TUTORIAL_POWERED_ONE:
        if (fragments > 0 && fragments < FRAGMENTS_A_ROUND) return tile(REMAINS_TILE);
        if (fragments >= FRAGMENTS_A_ROUND) return tile(WORKBENCH_TILE);
        if (essence === 0) return tile(REMAINS_TILE);
        return uncharged ? tile(WATER_GUARDIAN_LOC) : tile(UNCHARGED_CELLS_TILE);
      case TUTORIAL_WATER_STONES: return lost ? npc("tamara-tutorial") : npc("great-guardian");
      case TUTORIAL_POWERED_TWO: return medium ? tile(ELEMENTAL_PILE_TILE, 64) : npc("tamara-tutorial");
      case TUTORIAL_MEDIUM_GUARDIAN:
        if (!has(player, PORTAL_TALISMAN_WATER_ITEM_ID)) return npc("tamara-tutorial");
        if (fragments > 0 && fragments < FRAGMENTS_A_ROUND) return tile(REMAINS_TILE);
        if (fragments >= FRAGMENTS_A_ROUND) return tile(WORKBENCH_TILE);
        if (essence === 0) return tile(REMAINS_TILE);
        return uncharged ? tile(WATER_GUARDIAN_LOC) : tile(UNCHARGED_CELLS_TILE);
      case TUTORIAL_WATER_STONES_TWO: return lost ? npc("tamara-tutorial") : tile(CELL_TILE, 32);
      case TUTORIAL_MEDIUM_CELL: return lost ? npc("tamara-tutorial") : npc("great-guardian");
      default: return undefined;
    }
  }

  function stopTutorialAction(player) {
    const action = tutorialActions.get(player);
    if (!action) return;
    action.stopped = true;
    tutorialActions.delete(player);
    player.performAnimation(new Animation(-1));
  }

  /** A repeating skill action: moving away (or another click) ends it. */
  function startTutorialAction(player, step) {
    stopTutorialAction(player);
    const origin = player.getLocation().clone();
    const action = { stopped: false };
    tutorialActions.set(player, action);
    let ticks = 0;
    const tick = () => {
      if (action.stopped || !player.isRegistered()) return;
      if (!player.getLocation().equals(origin) || step(++ticks) === false) {
        stopTutorialAction(player);
        return;
      }
      Scenes.later(player, 1, tick);
    };
    Scenes.later(player, 1, tick);
  }

  function takeFloorChisel(event) {
    const { player } = event;
    if (!inTutorial(player) || tutorialProgress(player) < TUTORIAL_CELL) return false;
    if (freeSlots(player) === 0 || has(player, CHISEL_ITEM_ID)) return false;
    give(player, CHISEL_ITEM_ID);
    event.handled = true;
    return true;
  }

  function takeFromTable(player, itemId) {
    if (freeSlots(player) === 0) {
      player.sendMessage("You need a free inventory space for that.");
      return;
    }
    player.performAnimation(new Animation(SEQ_TAKE_FROM_TABLE));
    player.getPacketSender().sendSound(SOUND_TABLE, 1, 0);
    give(player, itemId);
    tutorialHint(player);
  }

  /** Felix: "Just make sure you don't take more than one!" */
  function takeWeakCell(event) {
    const { player } = event;
    if (!inTutorial(player) || tutorialProgress(player) < TUTORIAL_FELIX) return false;
    event.handled = true;
    if (!has(player, WEAK_CELL_ITEM_ID)) takeFromTable(player, WEAK_CELL_ITEM_ID);
    return true;
  }

  function takeUnchargedCell(event) {
    const { player } = event;
    if (!inTutorial(player) || tutorialProgress(player) < TUTORIAL_ESSENCE) return false;
    event.handled = true;
    if (!has(player, UNCHARGED_CELL_ITEM_ID)) takeFromTable(player, UNCHARGED_CELL_ITEM_ID);
    return true;
  }

  function cellPlaced(player, itemId, sound, xp, message) {
    take(player, itemId);
    player.performAnimation(new Animation(SEQ_PICKUP_FLOOR));
    player.getPacketSender().sendSound(sound, 1, 0);
    player.getSkillManager().addExperiences(Skill.RUNECRAFTING, xp);
    if (message) player.sendMessage(message);
  }

  function placeCell(event) {
    const { player } = event;
    if (!inTutorial(player)) return false;
    const progress = tutorialProgress(player);
    if (progress === TUTORIAL_TAMARA && has(player, WEAK_CELL_ITEM_ID)) {
      cellPlaced(player, WEAK_CELL_ITEM_ID, SOUND_CELL_PLACED, 30);
      setTutorialProgress(player, TUTORIAL_CELL);
      play(player, TAMARA_TEMPLE_NPC_ID, "guardians-of-the-rift-after-placing-the-weak-cell-in-the-inactive-cell-tile");
      event.handled = true;
      return true;
    }
    if (progress === TUTORIAL_MIND_STONES && has(player, WEAK_CELL_ITEM_ID)) {
      cellPlaced(player, WEAK_CELL_ITEM_ID, SOUND_CELL_RECHARGE, 30, "The weak cell is consumed as it <col=ff0000>recharges</col> the barrier.");
      setTutorialProgress(player, TUTORIAL_REPOWERED);
      event.handled = true;
      return true;
    }
    if (progress === TUTORIAL_WATER_STONES_TWO && has(player, MEDIUM_CELL_ITEM_ID)) {
      cellPlaced(player, MEDIUM_CELL_ITEM_ID, SOUND_CELL_STRENGTHEN, 110, "The medium cell is consumed as it <col=ff0000>strengthens</col> the barrier.");
      setTutorialProgress(player, TUTORIAL_MEDIUM_CELL);
      play(player, TAMARA_TEMPLE_NPC_ID, "guardians-of-the-rift-placing-the-medium-cell");
      event.handled = true;
      return true;
    }
    return pointToTamara(event);
  }

  /** A guardian rising from a pile (capture 1693): scrape, carve, then the cell's power. */
  function assembleGuardian(player, objectId, cellId, cellName, xp, npcKey, npcId, done) {
    const pile = objectId === ESSENCE_PILE_CATALYTIC_OBJECT_ID
      ? { ...CATALYTIC_PILE_TILE, face: 3 }
      : { ...ELEMENTAL_PILE_TILE, face: 0 };
    const sender = player.getPacketSender();
    player.getMovementQueue().reset();
    player.sendMessage("You scrape together what usable components you can find.");
    player.performAnimation(new Animation(SEQ_PICKUP_FLOOR));
    sender.sendSound(SOUND_SCRAPE, 2, 0);
    Scenes.later(player, 2, () => {
      if (!player.isRegistered()) return;
      player.sendMessage("You carve out a place for the cell and carefully place it inside the guardian.");
      player.performAnimation(new Animation(SEQ_CARVE_GUARDIAN));
      sender.sendSound(SOUND_CARVE, 2, 0);
    });
    Scenes.later(player, 5, () => {
      if (!player.isRegistered() || !inTutorial(player) || !has(player, cellId)) return;
      take(player, cellId);
      player.sendMessage(`The powers of the ${cellName} cell extend into the essence. A Guardian comes to life.`);
      sender.sendSound(SOUND_GUARDIAN_LIVES, 1, 0);
      player.getSkillManager().addExperiences(Skill.CRAFTING, PILE_CRAFTING_XP);
      player.getSkillManager().addExperiences(Skill.RUNECRAFTING, xp);
      const pileLoc = new GameObject(objectId, tutorialLocation(pile), 10, pile.face, null);
      sender.sendObjectRemoval(pileLoc);
      Scenes.later(player, PILE_RESPAWN_TICKS, () => player.isRegistered() && sender.sendObject(pileLoc));
      // Live rises on the pile; here on its north edge (as the minigame does), so it can walk out.
      setSpawn(player, npcKey, { id: npcId, x: pile.x, y: pile.y + 2, z: 0, wanderRadius: 0 }, true);
      spawns.get(player)?.get(npcKey)?.performAnimation(new Animation(SEQ_GUARDIAN_RISES));
      done();
    });
  }

  function assemblePile(event, objectId) {
    const { player } = event;
    if (!inTutorial(player)) return false;
    if (!has(player, CHISEL_ITEM_ID)) {
      player.sendMessage("You need a chisel to carve the essence into a guardian.");
      event.handled = true;
      return true;
    }
    const progress = tutorialProgress(player);
    const owned = spawns.get(player);
    const key = objectId === ESSENCE_PILE_CATALYTIC_OBJECT_ID ? "guardian-catalytic" : "guardian-elemental";
    const npcId = objectId === ESSENCE_PILE_CATALYTIC_OBJECT_ID ? WEAK_CATALYTIC_GUARDIAN_NPC_ID : WEAK_ELEMENTAL_GUARDIAN_NPC_ID;
    if ((progress === TUTORIAL_CELL || progress === TUTORIAL_PILE_ONE) && has(player, WEAK_CELL_ITEM_ID)) {
      // Felix: "Try creating another one using the other essence pile."
      if (owned?.has(key)) return false;
      const first = progress === TUTORIAL_CELL;
      event.handled = true;
      assembleGuardian(player, objectId, WEAK_CELL_ITEM_ID, "weak", 30, key, npcId, () => {
        setTutorialProgress(player, first ? TUTORIAL_PILE_ONE : TUTORIAL_PILES);
        play(player, FELIX_TEMPLE_NPC_ID, first
          ? "guardians-of-the-rift-after-assembling-the-first-essence-pile"
          : "guardians-of-the-rift-after-assembling-the-second-essence-pile");
      });
      return true;
    }
    if (progress === TUTORIAL_POWERED_TWO && has(player, MEDIUM_CELL_ITEM_ID)) {
      event.handled = true;
      assembleGuardian(player, objectId, MEDIUM_CELL_ITEM_ID, "medium", 100, "guardian-medium", MEDIUM_ELEMENTAL_GUARDIAN_NPC_ID, () => {
        setTutorialProgress(player, TUTORIAL_MEDIUM_GUARDIAN);
        play(player, FELIX_TEMPLE_NPC_ID, "guardians-of-the-rift-constructing-the-medium-elemental-guardian");
      });
      return true;
    }
    return pointToTamara(event);
  }

  /** The Mind altar's step reopens the rock for a player who has lost their essence. */
  function miningOpen(player, progress) {
    if (progress === TUTORIAL_ESSENCE) return !has(player, GUARDIAN_ESSENCE_ITEM_ID);
    return progress === TUTORIAL_PILES || progress === TUTORIAL_POWERED_ONE || progress === TUTORIAL_MEDIUM_GUARDIAN;
  }

  function benchOpen(player, progress) {
    return miningOpen(player, progress) || (progress === TUTORIAL_ESSENCE && has(player, GUARDIAN_FRAGMENTS_ITEM_ID));
  }

  /** Capture 1693: a fragment a tick, with the chisel animation, sound and Crafting XP. */
  function workAtBench(event) {
    const { player } = event;
    if (!inTutorial(player) || !benchOpen(player, tutorialProgress(player))) return false;
    event.handled = true;
    if (!has(player, GUARDIAN_FRAGMENTS_ITEM_ID)) {
      player.sendMessage("You'll need at least one guardian fragment to craft guardian essence.");
      return true;
    }
    startTutorialAction(player, () => {
      if (!has(player, GUARDIAN_FRAGMENTS_ITEM_ID)) {
        player.sendMessage("You have no more guardian fragments to combine.");
        if (tutorialProgress(player) === TUTORIAL_PILES) setTutorialProgress(player, TUTORIAL_ESSENCE);
        else tutorialHint(player);
        return false;
      }
      take(player, GUARDIAN_FRAGMENTS_ITEM_ID);
      give(player, GUARDIAN_ESSENCE_ITEM_ID);
      player.performAnimation(new Animation(SEQ_CHISEL_ESSENCE));
      player.getPacketSender().sendSound(SOUND_CARVE, 1, 0);
      const level = player.getSkillManager().getMaxLevel(Skill.CRAFTING);
      player.getSkillManager().addExperiences(Skill.CRAFTING, Math.max(1, Math.min(5, Math.floor(level / 10))));
      return true;
    });
    return true;
  }

  function bestPickaxe(player) {
    const request = { player, pickaxe: null };
    api.emitCustomEvent("mining:best-pickaxe", request);
    return request.pickaxe;
  }

  function pickaxeInterval(pickaxe) {
    const request = { pickaxe, ticks: null };
    api.emitCustomEvent("mining:roll-interval", request);
    return request.ticks ?? pickaxe.attemptIntervalTicks;
  }

  /** Capture 1693: the pick swings until five fragments are held, then the player says so. */
  function mineFragments(event) {
    const { player } = event;
    if (!inTutorial(player)) return false;
    const progress = tutorialProgress(player);
    if (!miningOpen(player, progress)) return false;
    event.handled = true;
    const pickaxe = bestPickaxe(player);
    if (!pickaxe) {
      player.sendMessage("You need a pickaxe to mine this rock. You do not have a pickaxe which you have the Mining level to use.");
      return true;
    }
    if (player.getInventory().getAmount(GUARDIAN_FRAGMENTS_ITEM_ID) >= FRAGMENTS_A_ROUND) {
      enoughFragments(player, progress);
      return true;
    }
    player.sendMessage("You swing your pick at the rock.");
    player.performAnimation(pickaxe.animation);
    let next = pickaxeInterval(pickaxe);
    startTutorialAction(player, (ticks) => {
      if (ticks < next) return true;
      next = ticks + pickaxeInterval(pickaxe);
      if (freeSlots(player) === 0 && !has(player, GUARDIAN_FRAGMENTS_ITEM_ID)) return false;
      give(player, GUARDIAN_FRAGMENTS_ITEM_ID);
      player.performAnimation(pickaxe.animation);
      player.sendMessage("You manage to mine some guardian fragments.");
      player.getPacketSender().sendSound(SOUND_FRAGMENT, 1, 0);
      player.getSkillManager().addExperiences(Skill.MINING, MINING_XP);
      if (player.getInventory().getAmount(GUARDIAN_FRAGMENTS_ITEM_ID) < FRAGMENTS_A_ROUND) return true;
      enoughFragments(player, progress);
      return false;
    });
    return true;
  }

  function enoughFragments(player, progress) {
    tutorialHint(player);
    if (progress === TUTORIAL_PILES) {
      play(player, FELIX_TEMPLE_NPC_ID, "guardians-of-the-rift-after-mining-5-fragments");
      return;
    }
    const { DialogueChainBuilder, PlayerDialogue } = api.core;
    player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(new PlayerDialogue(0, "I think I have enough fragments for now.")));
  }

  /** Through a rift or portal, with the captured colour fade; the move comes two ticks later. */
  function altarTrip(player, overlay, tile, message) {
    stopTutorialAction(player);
    player.getMovementQueue().reset();
    const sender = player.getPacketSender();
    sender.sendSubInterface(OVERLAY_ATMOSPHERE_UID, OVERLAY_INTERFACE, 1, {
      postScripts: [{ scriptId: OVERLAY_PORTAL_SCRIPT, args: overlay }],
    });
    sender.sendSound(SOUND_PORTAL, 1, 0);
    Scenes.later(player, 2, () => {
      if (!player.isRegistered()) return;
      player.sendMessage(message);
      moveTo(player, tile);
      sender.sendClientScript(OVERLAY_REMOVE_SCRIPT);
      syncTutorialScene(player);
      tutorialHint(player);
      Scenes.later(player, 1, () => player.isRegistered() && sender.closeSubInterface(OVERLAY_ATMOSPHERE_UID));
    });
  }

  function enterMindAltar(event) {
    const { player, objectId } = event;
    if (objectId !== GUARDIAN_OF_MIND_OPEN_OBJECT_ID || !inTutorial(player) || !mindGuardianOpen(player)) return false;
    altarTrip(player, MIND_OVERLAY, MIND_ALTAR_TILE, "You step through the rift and find yourself at the Mind Altar.");
    event.handled = true;
    return true;
  }

  function enterWaterAltar(event) {
    const { player, objectId } = event;
    if (objectId !== GUARDIAN_OF_WATER_OPEN_OBJECT_ID || !inTutorial(player) || !waterGuardianOpen(player)) return false;
    altarTrip(player, WATER_OVERLAY, WATER_ALTAR_TILE, "You step through the rift and find yourself at the Water Altar.");
    event.handled = true;
    return true;
  }

  function enterTemplePortal(event) {
    const { player } = event;
    if (!player) return;
    if (stageOf(player) < STAGE_PORTAL_OPEN && !quest.isComplete(player)) return;
    moveTo(player, BASEMENT_LANDING_TILE);
    event.handled = true;
  }

  /** The basement portal: wherever the quest has got to, and the minigame's lobby afterwards. */
  function enterBasementPortal(event) {
    const { player } = event;
    if (!player) return;
    const stage = stageOf(player);
    event.handled = true;
    if (quest.isComplete(player)) {
      moveTo(player, MINIGAME_LOBBY_TILE);
    } else if (stage === STAGE_PORTAL_OPEN) {
      moveTo(player, TEMPLE_ARRIVAL_TILE);
      Scenes.controls(player, true, true);
      camera(player, [2399, 5636, 550], [2399, 5626, 300]);
      play(player, PERSTEN_TEMPLE_NPC_ID, "enter-the-gate-temple-of-the-eye-cutscene");
    } else if (stage === STAGE_TEMPLE || stage === STAGE_APPRENTICES) {
      moveTo(player, TEMPLE_EXPLORE_TILE);
    } else if (stage === STAGE_VISION || stage === STAGE_GUARDIAN) {
      moveTo(player, TUTORIAL_ARRIVAL_TILE);
      if (stage === STAGE_VISION) startTutorial(player);
      syncSpawns(player);
      tutorialHint(player);
    } else {
      // The quest's own closing line sends the player to Sedridor (the wording is ours).
      player.sendMessage("You should speak to Archmage Sedridor first.");
    }
  }

  /**
   * What this step still needs from an altar trip that has already been made. The trip can't be
   * redone, so stones or a medium cell that were dropped (or a cell never charged) would end the quest.
   */
  function lostAltarItems(player, progress) {
    const needed = {
      [TUTORIAL_MIND_STONES]: [CATALYTIC_GUARDIAN_STONE_ITEM_ID],
      [TUTORIAL_REPOWERED]: [CATALYTIC_GUARDIAN_STONE_ITEM_ID],
      [TUTORIAL_WATER_STONES]: [ELEMENTAL_GUARDIAN_STONE_ITEM_ID],
      [TUTORIAL_POWERED_TWO]: [MEDIUM_CELL_ITEM_ID],
      [TUTORIAL_WATER_STONES_TWO]: [ELEMENTAL_GUARDIAN_STONE_ITEM_ID, MEDIUM_CELL_ITEM_ID],
      [TUTORIAL_MEDIUM_CELL]: [ELEMENTAL_GUARDIAN_STONE_ITEM_ID],
    }[progress] ?? [];
    return needed.filter((itemId) => !has(player, itemId));
  }

  /** No capture covers this, so the wording is ours. The XP is on the step, so it can't be farmed. */
  function replaceLostAltarItems(player, progress) {
    const replaced = lostAltarItems(player, progress).filter((itemId) => giveQuestItem(player, itemId));
    if (replaced.length === 0) return;
    player.sendMessage("Tamara hands you a replacement for what you've lost.");
    tutorialHint(player);
  }

  function pointToTamara(event) {
    const { player } = event;
    if (lostAltarItems(player, tutorialProgress(player)).length === 0) return false;
    player.sendMessage("You've lost something you made at the altar. Apprentice Tamara can replace it.");
    tutorialHint(player);
    event.handled = true;
    return true;
  }

  /** Every guardian essence becomes runes and a guardian stone at once; one cell charges. */
  function craftGuardianEssence(event) {
    const { player, objectId } = event;
    const kind = objectId === ALTAR_MIND_OBJECT_ID ? "mind" : objectId === ALTAR_WATER_OBJECT_ID ? "water" : null;
    if (!kind || !inTutorial(player) || !has(player, GUARDIAN_ESSENCE_ITEM_ID)) return false;
    const progress = tutorialProgress(player);
    const allowed = kind === "mind"
      ? progress === TUTORIAL_ESSENCE
      : progress === TUTORIAL_POWERED_ONE || progress === TUTORIAL_MEDIUM_GUARDIAN;
    if (!allowed) return false;
    const inventory = player.getInventory();
    const essence = inventory.getAmount(GUARDIAN_ESSENCE_ITEM_ID);
    const request = { player, objectId, rune: null };
    api.emitCustomEvent("runecrafting:altar-rune", request);
    takeAll(player, GUARDIAN_ESSENCE_ITEM_ID);
    give(player, kind === "mind" ? MIND_RUNE_ITEM_ID : WATER_RUNE_ITEM_ID, essence * (request.rune?.amount ?? 1));
    give(player, kind === "mind" ? CATALYTIC_GUARDIAN_STONE_ITEM_ID : ELEMENTAL_GUARDIAN_STONE_ITEM_ID, essence);
    if (has(player, UNCHARGED_CELL_ITEM_ID)) {
      take(player, UNCHARGED_CELL_ITEM_ID);
      give(player, kind === "mind" ? WEAK_CELL_ITEM_ID : MEDIUM_CELL_ITEM_ID);
      player.sendMessage(`Your cell absorbs a ${kind === "mind" ? "small" : "moderate"} amount of excess energy.`);
    }
    if (kind === "water" && progress === TUTORIAL_POWERED_ONE) {
      give(player, PORTAL_TALISMAN_WATER_ITEM_ID);
      player.sendMessage("You discover a strange talisman during the runecrafting process!");
    }
    player.performAnimation(new Animation(SEQ_RUNECRAFT));
    player.performGraphic(new Graphic(GFX_RUNECRAFT, 0, 92));
    player.getPacketSender().sendSound(SOUND_CRAFT, 1, 0);
    player.getSkillManager().addExperiences(Skill.RUNECRAFTING, kind === "mind" ? 230 : 250);
    if (kind === "mind") setTutorialProgress(player, TUTORIAL_MIND_STONES);
    else setTutorialProgress(player, progress === TUTORIAL_POWERED_ONE ? TUTORIAL_WATER_STONES : TUTORIAL_WATER_STONES_TWO);
    event.handled = true;
    return true;
  }

  function leaveAltar(event) {
    const { player, objectId } = event;
    if (!inTutorial(player)) return false;
    if (objectId === ALTAR_EXIT_MIND_OBJECT_ID) {
      altarTrip(player, MIND_OVERLAY, MIND_RETURN_TILE, "You step through the portal and find yourself back in the temple.");
    } else if (objectId === ALTAR_EXIT_WATER_OBJECT_ID) {
      altarTrip(player, WATER_OVERLAY, WATER_RETURN_TILE, "You step through the portal and find yourself back in the temple.");
    } else {
      return false;
    }
    event.handled = true;
    return true;
  }

  /** Capture 1693: the animation at once; a tick later the stones go and the XP lands. */
  function powerUp(player, stoneId, xp, then) {
    player.getMovementQueue().reset();
    player.performAnimation(new Animation(SEQ_POWER_UP));
    player.performGraphic(new Graphic(GFX_RUNECRAFT, 0, 92));
    player.getPacketSender().sendSound(SOUND_POWER_UP, 1, 0);
    Scenes.later(player, 1, () => {
      if (!player.isRegistered() || !has(player, stoneId)) return;
      takeAll(player, stoneId);
      player.getSkillManager().addExperiences(Skill.RUNECRAFTING, xp);
      then();
    });
  }

  function powerUpGreatGuardian(event) {
    const { player, npcId } = event;
    if (npcId !== GREAT_GUARDIAN_NPC_ID || !inTutorial(player)) return false;
    const progress = tutorialProgress(player);
    if (progress === TUTORIAL_REPOWERED && has(player, CATALYTIC_GUARDIAN_STONE_ITEM_ID)) {
      event.handled = true;
      powerUp(player, CATALYTIC_GUARDIAN_STONE_ITEM_ID, 750, () => {
        setTutorialProgress(player, TUTORIAL_POWERED_ONE);
        play(player, GREAT_GUARDIAN_NPC_ID, "guardians-of-the-rift-powering-up-the-great-guardian");
      });
      return true;
    }
    if (progress === TUTORIAL_WATER_STONES && has(player, ELEMENTAL_GUARDIAN_STONE_ITEM_ID)) {
      event.handled = true;
      powerUp(player, ELEMENTAL_GUARDIAN_STONE_ITEM_ID, 750, () => {
        setTutorialProgress(player, TUTORIAL_POWERED_TWO);
        play(player, GREAT_GUARDIAN_NPC_ID, "guardians-of-the-rift-powering-the-guardian-the-second-time");
      });
      return true;
    }
    if (progress === TUTORIAL_MEDIUM_CELL && has(player, ELEMENTAL_GUARDIAN_STONE_ITEM_ID)) {
      event.handled = true;
      powerUp(player, ELEMENTAL_GUARDIAN_STONE_ITEM_ID, 1650, () => startClosingScene(player));
      return true;
    }
    return pointToTamara(event);
  }

  /** The third power-up: tote 120, the untouched temple's map and the rift's end. */
  function startClosingScene(player) {
    setTutorialProgress(player, TUTORIAL_CLOSED);
    moveTo(player, RIFT_SCENE_TILE);
    setStage(player, STAGE_CLOSED);
    tutorialHint(player);
    Scenes.controls(player, true, true);
    camera(player, [2386, 5663, 970], [2408, 5667, 170]);
    play(player, GREAT_GUARDIAN_SCENE_NPC_ID, "guardians-of-the-rift-closing-the-rift");
  }

  function handleObjectInteraction(event) {
    const { player, objectId, clickType } = event;
    if (!player || event.handled) return;
    if (objectId === CHAOS_ALTAR_OBJECT_ID) {
      if (clickType === 1) handleChapelPray(event);
      return;
    }
    if (objectId === ABYSS_CENTRE_RIFT_OBJECT_ID || TEMPLE_RIFT_OBJECT_IDS.has(objectId)) {
      if (clickType === 1) handleAbyssalRift(event);
      return;
    }
    if (objectId === FLOOR_CHISEL_OBJECT_ID) {
      if (clickType === 1) takeFloorChisel(event);
      return;
    }
    if (objectId === WEAK_CELLS_OBJECT_ID) {
      if (clickType === 1) takeWeakCell(event);
      else if (clickType === 2) takeFloorChisel(event);
      return;
    }
    if (objectId === UNCHARGED_CELLS_OBJECT_ID || objectId === UNCHARGED_CELLS_OBJECT_ID_2) {
      if (clickType === 1 || clickType === 2) takeUnchargedCell(event);
      return;
    }
    if (objectId === INACTIVE_CELL_TILE_OBJECT_ID || objectId === INACTIVE_CELL_TILE_OBJECT_ID_2
      || objectId === WEAK_CELL_TILE_OBJECT_ID || objectId === MEDIUM_CELL_TILE_OBJECT_ID) {
      if (clickType === 1) placeCell(event);
      return;
    }
    if (objectId === ESSENCE_PILE_ELEMENTAL_OBJECT_ID || objectId === ESSENCE_PILE_CATALYTIC_OBJECT_ID) {
      if (clickType === 1) assemblePile(event, objectId);
      return;
    }
    if (objectId === WORKBENCH_OBJECT_ID) {
      if (clickType === 1) workAtBench(event);
      return;
    }
    if (GUARDIAN_PARTS_OBJECT_IDS.has(objectId)) {
      if (clickType === 1) mineFragments(event);
      return;
    }
    if (objectId === GUARDIAN_OF_MIND_OPEN_OBJECT_ID) {
      if (clickType === 1) enterMindAltar(event);
      return;
    }
    if (objectId === GUARDIAN_OF_WATER_OPEN_OBJECT_ID) {
      if (clickType === 1) enterWaterAltar(event);
      return;
    }
    if (objectId === TEMPLE_EXIT_OBJECT_ID) {
      if (clickType === 1) enterTemplePortal(event);
      return;
    }
    if (objectId === BASEMENT_PORTAL_OBJECT_ID || objectId === BASEMENT_PORTAL_PARENT_OBJECT_ID) {
      if (clickType === 1) enterBasementPortal(event);
      return;
    }
    if (objectId === ALTAR_MIND_OBJECT_ID || objectId === ALTAR_WATER_OBJECT_ID) {
      if (clickType === 1) craftGuardianEssence(event);
      return;
    }
    if (objectId === ALTAR_EXIT_MIND_OBJECT_ID || objectId === ALTAR_EXIT_WATER_OBJECT_ID) {
      if (clickType === 1) leaveAltar(event);
      return;
    }
    if (ENERGY_IDS.has(objectId)) {
      if (clickType === 1) touchEnergy(event);
    }
  }

  function assembleElementalPile(event) {
    return assemblePile(event, ESSENCE_PILE_ELEMENTAL_OBJECT_ID);
  }

  function assembleCatalyticPile(event) {
    return assemblePile(event, ESSENCE_PILE_CATALYTIC_OBJECT_ID);
  }

  /** Named "Portal" hook for the Wizards' Tower and temple exits. */
  function handleNamedPortal(event) {
    const { objectId } = event;
    if (
      objectId !== TEMPLE_EXIT_OBJECT_ID &&
      objectId !== BASEMENT_PORTAL_OBJECT_ID &&
      objectId !== BASEMENT_PORTAL_PARENT_OBJECT_ID &&
      objectId !== ALTAR_EXIT_MIND_OBJECT_ID &&
      objectId !== ALTAR_EXIT_WATER_OBJECT_ID
    ) {
      return false;
    }
    handleObjectInteraction(event);
    return event.handled === true;
  }

  /** The rift at the centre of the Abyss, and the underwater temple rift. */
  function handleAbyssalRift(event) {
    const { player, objectId } = event;
    if (!player) return false;
    if (objectId === ABYSS_CENTRE_RIFT_OBJECT_ID) {
      if (stageOf(player) !== STAGE_ENERGY) return false;
      player.sendMessage("The rift is the source of the abyssal energy.");
      event.handled = true;
      return true;
    }
    if (!TEMPLE_RIFT_OBJECT_IDS.has(objectId)) return false;
    if (stageOf(player) < STAGE_TEMPLE) return false;
    player.sendMessage(
      stageOf(player) === STAGE_GUARDIAN
        ? "The barrier holds the rift shut."
        : "A cold abyssal wind spills from the rift."
    );
    event.handled = true;
    return true;
  }

  /** Praying at the Zamorakian chapel points a quest player at Herbert. */
  function handleChapelPray(event) {
    const { player } = event;
    if (!player || !stageBetween(player, STAGE_STARTED, STAGE_TEA_DRUNK)) return false;
    player.sendMessage(
      stageBetween(player, STAGE_STARTED, STAGE_APPRAISED)
        ? "The chapel reeks of sulphur. The Mage of Zamorak is here."
        : "The chapel reeks of sulphur. The Mage of Zamorak is waiting for his tea."
    );
    event.handled = true;
    return true;
  }

  // ---------------------------------------------------------------------------
  // Named NPC and item handlers
  // ---------------------------------------------------------------------------

  const PERSTEN_NPC_IDS = new Set([
    PERSTEN_ALKHARID_NPC_ID,
    PERSTEN_TOWER_NPC_ID,
    PERSTEN_CUTSCENE_NPC_ID,
    PERSTEN_TEMPLE_NPC_ID,
  ]);

  function eventNpcId(event) {
    return event.npcId ?? event.definition?.getId?.() ?? event.npc?.getId?.();
  }

  function beginNamedTalk(event, npcId, variant) {
    if (!variant || !event.player) return false;
    if (!play(event.player, npcId, variant)) return false;
    event.handled = true;
    return true;
  }

  function handlePerstenTalk(event) {
    const { player } = event;
    const npcId = eventNpcId(event);
    if (!player || !PERSTEN_NPC_IDS.has(npcId)) return false;
    recoverQuestItems(player);
    return beginNamedTalk(event, npcId, selectPerstenVariant(player, npcId));
  }

  function handleMageTalk(event) {
    const { player } = event;
    const npcId = eventNpcId(event);
    if (!player || !MAGE_OF_ZAMORAK_NPC_IDS.has(npcId)) return false;
    // Legacy saves can have started (or finished) this quest before Enter the
    // Abyss existed. Leave the shared mage to that miniquest until it is done.
    if (!isQuestComplete(player, "enter_the_abyss")) return false;
    recoverQuestItems(player);
    return beginNamedTalk(event, npcId, selectMageVariant(player));
  }

  function handleTeaSellerTalk(event) {
    const { player } = event;
    const npcId = eventNpcId(event);
    if (!player || npcId !== TEA_SELLER_NPC_ID) return false;
    return beginNamedTalk(event, npcId, selectTeaSellerVariant(player));
  }

  function handleDarkMageTalk(event) {
    const { player } = event;
    const npcId = eventNpcId(event);
    if (!player || npcId !== DARK_MAGE_NPC_ID) return false;
    recoverQuestItems(player);
    return beginNamedTalk(event, npcId, selectDarkMageVariant(player));
  }

  function handleSedridorTalk(event) {
    const { player } = event;
    const npcId = eventNpcId(event);
    if (!player || !SEDRIDOR_NPC_IDS.has(npcId)) return false;
    recoverQuestItems(player);
    return beginNamedTalk(event, npcId, selectSedridorVariant(player));
  }

  function handleTraibornTalk(event) {
    const { player } = event;
    const npcId = eventNpcId(event);
    if (!player || (npcId !== TRAIBORN_NPC_ID && npcId !== TRAIBORN_CUTSCENE_NPC_ID)) return false;
    return beginNamedTalk(event, npcId, selectTraibornVariant(player));
  }

  function handleApprenticeTalk(event) {
    const { player } = event;
    const npcId = eventNpcId(event);
    if (!player) return false;
    const apprentice = TOWER_APPRENTICES.get(npcId) ?? TEMPLE_APPRENTICES.get(npcId);
    if (!apprentice) return false;
    const stage = stageOf(player);
    if (stage < STAGE_SEDRIDOR || stage >= STAGE_COMPLETE) return false;
    return beginNamedTalk(event, npcId, selectVariant({ player, npcId }));
  }

  function inspectEyeAmulet(event) {
    const { player, itemId } = event;
    if (!player || itemId !== EYE_AMULET_ITEM_ID) return false;
    if (stageOf(player) < STAGE_STARTED || stageOf(player) >= STAGE_COMPLETE) return false;
    player.sendMessage("The amulet is cold to the touch. A slit of abyssal energy shifts behind the eye.");
    if (stageOf(player) >= STAGE_APPRAISED) {
      player.sendMessage("The Mage of Zamorak said its origin could be traced in the Abyss.");
    }
    event.handled = true;
    return true;
  }

  function readAbyssalIncantation(event) {
    const { player, itemId } = event;
    if (!player || itemId !== ABYSSAL_INCANTATION_ITEM_ID) return false;
    if (stageOf(player) < STAGE_INCANTATION || stageOf(player) >= STAGE_SEDRIDOR) return false;
    player.sendMessage("The incantation is written on thin flesh in a cramped Zamorakian hand.");
    player.sendMessage(
      stageOf(player) < STAGE_TOWER
        ? "Wizard Persten will want to see this."
        : "Archmage Sedridor will want to see this."
    );
    event.handled = true;
    return true;
  }

  function handleQuestItemAction(event) {
    const itemId = event?.itemId;
    if (itemId === EYE_AMULET_ITEM_ID && event.option === "Inspect") return inspectEyeAmulet(event);
    if (itemId === ABYSSAL_INCANTATION_ITEM_ID && event.option === "Read") {
      return readAbyssalIncantation(event);
    }
    // Destroy is deliberately left to the default handler; the NPC handlers
    // above are the recovery route for a destroyed quest item.
    return false;
  }

  function handleNpcDeath(event) {
    const npcId = event?.npcId ?? event?.npc?.getId?.();
    if (!event?.killer || !MY_NPC_IDS.has(npcId)) return;
    // The quest's guardians are tutorial props. Their death never advances an
    // objective; the tutorial only uses the Great Guardian's Power-up option.
  }

  // ---------------------------------------------------------------------------
  // Login / logout
  // ---------------------------------------------------------------------------

  function syncTowerPuzzleVarbits(player) {
    for (const apprentice of TOWER_APPRENTICES.values()) {
      const seen = bitSet(player, TOWER_SEEN_ATTRIBUTE, apprentice.bit) ? 1 : 0;
      player.getPacketSender().sendVarbit(TOWER_PUZZLE_VARBITS[apprentice.key], seen);
    }
  }

  /** A scene can't resume after a logout, and older saves stand in the minigame's own temple. */
  function recoverScene(player) {
    const location = player.getLocation();
    const stage = stageOf(player);
    if (stage === STAGE_PORTAL_OPEN) {
      setStage(player, STAGE_TEMPLE);
      moveTo(player, TEMPLE_EXPLORE_TILE);
    } else if (stage === STAGE_VISION) {
      setTutorialProgress(player, TUTORIAL_START);
      setStage(player, STAGE_GUARDIAN);
      moveTo(player, TUTORIAL_ARRIVAL_TILE);
    } else if (stage === STAGE_CLOSED) {
      setStage(player, STAGE_FINAL);
      moveTo(player, BASEMENT_LANDING_TILE);
    } else if (stage >= STAGE_TEMPLE && stage <= STAGE_GUARDIAN
      && location.getX() >= LIVE_TEMPLE.minX && location.getX() <= LIVE_TEMPLE.maxX
      && location.getY() >= LIVE_TEMPLE.minY && location.getY() <= LIVE_TEMPLE.maxY) {
      moveTo(player, stage === STAGE_GUARDIAN ? TUTORIAL_ARRIVAL_TILE : TEMPLE_EXPLORE_TILE);
    }
  }

  function handleLogin({ player }) {
    migrateLegacyStage(player);
    clearConsumedQuestItems(player);
    recoverScene(player);
    syncSpawns(player);
    tutorialHint(player);
    syncTowerPuzzleVarbits(player);
    syncEnergyObjects(player);
    player.getPacketSender().sendVarbit(TUTORIAL_VARBIT, tutorialProgress(player));
    player.getPacketSender().sendVarbit(13740, (teleports(player) & ABYSS_TELEPORT_BIT) !== 0 ? 1 : 0);
    player.getPacketSender().sendVarbit(13753, (teleports(player) & TOWER_TELEPORT_BIT) !== 0 ? 1 : 0);
    player.getPacketSender().sendVarbit(13746, flag(player, INCANTATION_GIVEN_ATTRIBUTE) ? 1 : 0);
    // Mirror the captured completion reward varbit; never re-grant the reward.
    player.getPacketSender().sendVarbit(13757, quest.isComplete(player) ? 1 : 0);
  }

  function handleLogout({ player }) {
    if (!player) return;
    Scenes.cancel(player);
    stopTutorialAction(player);
    tutorialFights.delete(player);
    clearTutorialLocs(player);
    clearSpawns(player);
    const portal = basementPortalByPlayer.get(player);
    if (portal) ObjectManager.deregister(portal, true);
    basementPortalByPlayer.delete(player);
  }

  // ---------------------------------------------------------------------------
  // Journal and reward
  // ---------------------------------------------------------------------------

  function buildJournal(player, handle) {
    const stage = handle.getStage(player);
    const lines = [];
    if (stage === 0) {
      lines.push(
        "I can start this quest by speaking to <col=800000>Wizard Persten</col> north of <col=800000>Al Kharid</col>.",
        "",
        "I will need:",
        "- <col=800000>A Runecrafting level of 10</col>",
        "- Completion of <col=800000>Enter the Abyss</col>"
      );
      return lines;
    }
    if (stage >= STAGE_COMPLETE) {
      lines.push("<col=ff0000>QUEST COMPLETE!</col>");
      return lines;
    }
    lines.push(...objectiveLines(stage), "");
    lines.push("Wizard Persten wants me to trace the origin of an ancient eye amulet.");
    if (stage < STAGE_APPRAISED) {
      lines.push("", "I should show the <col=800000>eye amulet</col> to the <col=800000>Mage of Zamorak</col> in south-east Varrock.");
      return lines;
    }
    lines.push("<str>I showed the amulet to the Mage of Zamorak.</str>");
    if (stage < STAGE_TEA_DRUNK) {
      lines.push(
        "",
        "He wants a <col=800000>bucket of water</col> and a <col=800000>strong cup of tea</col>.",
        "The <col=800000>Tea Seller</col> at the eastern Varrock entrance sells the tea."
      );
      return lines;
    }
    lines.push("<str>The Mage of Zamorak drank the tea and offered a one-time teleport to the Abyss.</str>");
    if (stage < STAGE_IN_ABYSS) {
      lines.push("", "I should take his one-time teleport to the <col=800000>Abyss</col>.");
      return lines;
    }
    if (stage < STAGE_ENERGY) {
      lines.push("", "The <col=800000>Dark Mage</col> can trace the amulet's abyssal energy.");
      return lines;
    }
    if (stage < STAGE_ENERGY_DONE) {
      lines.push("", "I need to work out the order of the <col=800000>abyssal energy</col>.");
      return lines;
    }
    if (stage < STAGE_INCANTATION) {
      lines.push("", "I should ask the <col=800000>Dark Mage</col> for the incantation now the energy is in order.");
      return lines;
    }
    lines.push("<str>The Dark Mage gave me an abyssal incantation.</str>");
    if (stage < STAGE_TOWER) {
      lines.push("", "I should take the <col=800000>abyssal incantation</col> back to <col=800000>Persten</col> in Al Kharid.");
      return lines;
    }
    lines.push("<str>Persten copied the incantation, kept the amulet and sent me to Sedridor.</str>");
    if (stage < STAGE_SEDRIDOR) {
      lines.push("", "I should give the incantation to <col=800000>Archmage Sedridor</col> in the Wizards' Tower basement.");
      return lines;
    }
    lines.push("<str>I gave the incantation to Sedridor.</str>");
    if (stage < STAGE_RIDDLE) {
      lines.push("", "I should speak to <col=800000>Wizard Traiborn</col> about his apprentices helping with it.");
      return lines;
    }
    lines.push("<str>Traiborn agreed to help if his apprentices solve his thingummywut puzzle.</str>");
    if (stage < STAGE_RIDDLE_DONE) {
      lines.push(
        "",
        "I should ask the three <col=800000>apprentices</col> about the puzzle,",
        "then tell <col=800000>Traiborn</col> the answer is 11."
      );
      return lines;
    }
    lines.push("<str>We solved the riddle of the thingummywut.</str>");
    if (stage < STAGE_PORTAL_OPEN) {
      lines.push("", "I should speak to <col=800000>Sedridor</col> so the incantation can be performed.");
      return lines;
    }
    lines.push("<str>The incantation opened a portal in the tower basement.</str>");
    if (stage < STAGE_TEMPLE) {
      lines.push("", "I should enter the <col=800000>portal</col> in the Wizards' Tower basement.");
      return lines;
    }
    lines.push("<str>We reached the Temple of the Eye beneath the sea.</str>");
    if (stage < STAGE_APPRENTICES) {
      lines.push("", "I should talk to the <col=800000>apprentices</col> and then to <col=800000>Persten</col>.");
      return lines;
    }
    if (stage < STAGE_GUARDIAN) {
      lines.push("", "I should look at the markings with <col=800000>Persten</col>.");
      return lines;
    }
    lines.push("<str>Persten was dragged into an abyssal rift; the Great Guardian appeared.</str>");
    const progress = tutorialProgress(player);
    if (progress <= TUTORIAL_TAMARA) {
      lines.push("", "I should speak to <col=800000>Felix</col> and <col=800000>Tamara</col> about the cells.");
      return lines;
    }
    if (progress <= TUTORIAL_CELL) {
      lines.push("", "I should place the <col=800000>weak cell</col> in the inactive cell tile.");
      return lines;
    }
    if (progress <= TUTORIAL_PILES) {
      lines.push("", "I should assemble <col=800000>rune guardians</col> from the essence piles.");
      return lines;
    }
    if (progress === TUTORIAL_ESSENCE) {
      lines.push("", "I should make <col=800000>guardian essence</col> at the workbench.");
      return lines;
    }
    if (progress <= TUTORIAL_MIND_STONES) {
      lines.push("", "I should take the essence and an <col=800000>uncharged cell</col> to the <col=800000>Mind Altar</col>.");
      return lines;
    }
    if (progress === TUTORIAL_REPOWERED) {
      lines.push("", "I should replace the barrier's cell and power up the <col=800000>Great Guardian</col>.");
      return lines;
    }
    if (progress <= TUTORIAL_WATER_STONES) {
      lines.push("", "I need more guardian essence for the <col=800000>Water Altar</col>, then power the guardian again.");
      return lines;
    }
    if (progress === TUTORIAL_POWERED_TWO) {
      lines.push("", "I should make another rune guardian with the <col=800000>medium cell</col>.");
      return lines;
    }
    if (progress === TUTORIAL_MEDIUM_GUARDIAN) {
      lines.push("", "The portal to the Water Altar has closed; Tamara's <col=800000>talisman</col> can return me there.");
      return lines;
    }
    if (progress === TUTORIAL_WATER_STONES_TWO) {
      lines.push("", "I should place the <col=800000>medium cell</col> in the inactive cell tile.");
      return lines;
    }
    lines.push("<str>The medium cell strengthened the barrier.</str>");
    lines.push("", "I should charge the <col=800000>Great Guardian</col> and close the rift!");
    return lines;
  }

  function grantReward(player) {
    clearConsumedQuestItems(player);
    // Live takes the tutorial's items with the instance (the capture leaves with none).
    for (const itemId of TUTORIAL_ITEM_IDS) removeItem(player, itemId);
    player.getPacketSender().sendVarbit(13757, 1);
    player.getSkillManager().addExperiences(Skill.RUNECRAFTING, 5000);
    if (!has(player, MEDIUM_POUCH_ITEM_ID) && !has(player, MEDIUM_POUCH_ITEM_ID_2)) {
      const inventory = player.getInventory();
      if (inventory.isFull()) inventory.forceAdd(player, new Item(MEDIUM_POUCH_ITEM_ID, 1));
      else give(player, MEDIUM_POUCH_ITEM_ID);
    }
  }

  // ---------------------------------------------------------------------------
  // Registration (attach-only)
  // ---------------------------------------------------------------------------

  api.persistAttribute(ASKED_WHO_ATTRIBUTE);
  api.persistAttribute(DECLINED_ATTRIBUTE, false);
  api.persistAttribute(TUTORIAL_ATTRIBUTE, 0);
  api.persistAttribute(STAGE_SCHEMA_ATTRIBUTE, 0);
  api.persistAttribute(AMULET_GIVEN_ATTRIBUTE);
  api.persistAttribute(INCANTATION_GIVEN_ATTRIBUTE);
  api.persistAttribute(BASEMENT_PORTAL_OPEN_ATTRIBUTE, false);
  api.persistAttribute(TEA_ATTRIBUTE);
  api.persistAttribute(TELEPORT_ATTRIBUTE);
  api.persistAttribute(DARK_MAGE_ATTRIBUTE);
  api.persistAttribute(ENERGY_ORDER_ATTRIBUTE);
  api.persistAttribute(ENERGY_PROGRESS_ATTRIBUTE);
  api.persistAttribute(TOWER_SEEN_ATTRIBUTE);
  api.persistAttribute(TEMPLE_SEEN_ATTRIBUTE);
  api.persistAttribute(MIND_BRIEFED_ATTRIBUTE);
  api.persistAttribute(MAGE_POSTQUEST_ATTRIBUTE);
  api.persistAttribute(FELIX_POST_ATTRIBUTE);

  quest = registerQuest(api, {
    key: "temple_of_the_eye",
    name: "Temple of the Eye",
    varpId: VARP_TOTE,
    varbitId: VARBIT_TOTE,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 1,
    xpRewards: [{ skillId: Skill.RUNECRAFTING.getIndex(), amount: 5000, label: "Runecraft" }],
    otherRewards: [
      "Access to the Guardians of the Rift minigame",
      "A medium pouch, if you do not already own one",
    ],
    buildJournal,
    onReward: grantReward,
  });

  api.onNpcInteraction("Wizard Persten", { "Talk-to": handlePerstenTalk });
  api.onNpcInteraction("Mage of Zamorak", { "Talk-to": handleMageTalk });
  api.onNpcInteraction("Tea Seller", { "Talk-to": handleTeaSellerTalk });
  api.onNpcInteraction("Dark Mage", { "Talk-to": handleDarkMageTalk });
  api.onNpcInteraction("Archmage Sedridor", { "Talk-to": handleSedridorTalk });
  api.onNpcInteraction("Wizard Traiborn", { "Talk-to": handleTraibornTalk });
  api.onNpcInteraction("Apprentice Cordelia", { "Talk-to": handleApprenticeTalk });
  api.onNpcInteraction("Apprentice Felix", { "Talk-to": handleApprenticeTalk });
  api.onNpcInteraction("Apprentice Tamara", { "Talk-to": handleApprenticeTalk });
  api.onNpcInteraction("The Great Guardian", { "Power-up": powerUpGreatGuardian });
  api.onNpcDeath(handleNpcDeath);

  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:choice", handleChoice);
  api.onCustomEvent("npc-dialogue:condition", handleCondition);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onCustomEvent("npc-dialogue:line", handleLine);
  api.onItemAction("Eye amulet", { Inspect: inspectEyeAmulet });
  api.onItemAction("Abyssal incantation", { Read: readAbyssalIncantation });
  api.onItemAction(handleQuestItemAction);
  api.onItemOnNpc(handleItemOnNpc, { noted: false });
  api.onItemOnObject("Portal talisman (water)", "Guardian of Water", useTalismanOnGuardian, { noted: false });
  api.onItemOnObject("Eye amulet", "Chaos altar", useAmuletOnChapel, { noted: false });
  api.onItemOnObject(handleItemOnObject, { noted: false });
  api.onObjectInteraction("Chaos altar", { "Pray-at": handleChapelPray });
  api.onObjectInteraction("Abyssal Rift", { Enter: handleAbyssalRift, "Pass-through": handleAbyssalRift });
  api.onObjectInteraction("Portal", {
    Enter: handleNamedPortal,
    "Pass-through": handleNamedPortal,
    Use: handleNamedPortal,
  });
  api.onObjectInteraction("Weak cells", { Take: takeWeakCell, "Take-chisel": takeFloorChisel });
  api.onObjectInteraction("Uncharged cells", { Take: takeUnchargedCell });
  api.onObjectInteraction("Inactive cell tile", { "Place-cell": placeCell });
  api.onObjectInteraction("Weak cell tile", { "Place-cell": placeCell });
  api.onObjectInteraction("Medium cell tile", { "Place-cell": placeCell });
  api.onObjectInteraction("Essence pile (elemental)", { Assemble: assembleElementalPile });
  api.onObjectInteraction("Essence pile (catalytic)", { Assemble: assembleCatalyticPile });
  api.onObjectInteraction("Workbench", { "Work-at": workAtBench });
  api.onObjectInteraction("Guardian parts", { Mine: mineFragments });
  api.onObjectInteraction("Guardian remains", { Mine: mineFragments });
  api.onObjectInteraction("Large guardian remains", { Mine: mineFragments });
  api.onObjectInteraction("Huge guardian remains", { Mine: mineFragments });
  api.onObjectInteraction("Fallen guardian", { Mine: mineFragments });
  api.onObjectInteraction("Guardian of Mind", { Enter: enterMindAltar });
  api.onObjectInteraction("Guardian of Water", { Enter: enterWaterAltar });
  api.onObjectInteraction("Altar", { "Craft-rune": craftGuardianEssence });
  api.onObjectInteraction("Chisel", { Take: takeFloorChisel });
  api.onObjectInteraction("<col=ff9040>Chisel</col>", { Take: takeFloorChisel });
  api.onObjectInteraction(handleObjectInteraction);
  api.onInterfaceActionButton(PUZZLE_CLOSE_UID, closePuzzle);
  api.onPlayerLogin(handleLogin);
  api.onPlayerLogout(handleLogout);
};
