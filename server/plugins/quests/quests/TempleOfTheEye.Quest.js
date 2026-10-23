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
 * quest varbit stays at 115 for its whole duration (`varbit 13759` in OSRS).
 *
 * Rewards per the OSRS Wiki: 1 Quest Point, 5,000 Runecraft experience (a further
 * 4,210 is gained during the quest, granted here in three parts at the altar
 * crafting steps), access to the Guardians of the Rift minigame and a medium pouch
 * (if not already owned).
 *
 * Source: OSRS Wiki (https://oldschool.runescape.wiki/w/Temple_of_the_Eye and
 * /Quick_guide, /Transcript:Temple_of_the_Eye); ids from scripts/lookup-gameval.ts,
 * the cache dumps and the npc/item/object identifier files.
 *
 * Gaps / approximations:
 * - Enter the Abyss has no implementation on this server; the wiki "has not
 *   completed Enter the Abyss" condition is answered with Rune Mysteries
 *   completion (which Enter the Abyss itself requires), so the quest starts once
 *   Rune Mysteries is complete. The 10 Runecrafting requirement is enforced
 *   through the transcript's own condition (unboosted level).
 * - The Guardians of the Rift minigame is not implemented; the quest only uses
 *   the temple lobby map that is in the cache. "Access to the minigame" is the
 *   portal in the Wizards' Tower basement and the temple map.
 * - The three apprentice riddles use cache interface 291 (captured if_opensub
 *   id=291, text children 5-16, close child 3); "see the puzzle again" reopens it.
 *   The answer is still the transcript's `11` after seeing all three cards.
 * - Cut-scene speech is chatbox dialogue; the transcript runner flattens
 *   multi-speaker pages, so lines render on one NPC chathead. The captured
 *   camera tracks and temple shakes are sent from the scene points below.
 * - The Dark Mage energy puzzle uses the cache's six multi-loc objects around the
 *   Abyss centre (map ids 43842-43847 at the captured tiles); their per-energy
 *   varbit 13747-13752 selects the base (1) or white (2) transform. A per-player
 *   random order is kept in a persisted attribute, so two players can solve it at
 *   once. A wrong touch resets the marked prefix; all six clear on completion.
 * - Cell-tile and barrier object swaps are not visualised; the quest tracks the
 *   barrier state per player.
 * - The rune guardians the player assembles are owner-only cosmetic spawns
 *   (weak/medium elemental/catalytic guardian ids); the essence piles do not
 *   change appearance.
 * - The quest map has no pickaxe on the ground: a bronze pickaxe is registered as
 *   a player ground item at (3621,9488) when the fragments are needed and whenever
 *   a fragment is mined without one. The chisel is the cache's own ground chisel
 *   object at (3621,9485).
 * - Wizard Persten, the Mage of Zamorak, the tower apprentices, the temple
 *   apprentices and the Great Guardian are owner-only quest spawns; the static
 *   Mage of Zamorak at the chapel is the cache's unnamed npc 3229, so an owner
 *   copy of 2580 is spawned like Wanted! does.
 * - Altar trips use the real Mind/Water Altar maps through the temple's Guardian
 *   of Mind/Water "Enter" option; crafting guardian essence is handled by this
 *   quest before the Runecrafting plugin's generic altar handler, and the altars'
 *   exit portals return to the temple during the tutorial.
 * - Persten's, the Mage of Zamorak's and Sedridor's post-quest variants are only
 *   played while this quest is complete (the pages are shared with other content).
 * - The Abyss one-time teleport from the Mage of Zamorak is handled here; the
 *   Runecrafting plugin's Abyss teleport (the "Teleport" option) is left alone.
 */
module.exports = function registerTempleOfTheEyeQuest(api) {
  const {
    Equipment,
    GameObject,
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
  const MAGE_OF_ZAMORAK_NPC_IDS = new Set([
    NpcIdentifiers.MAGE_OF_ZAMORAK, // 2580
    NpcIdentifiers.MAGE_OF_ZAMORAK_2, // 2581
    NpcIdentifiers.MAGE_OF_ZAMORAK_3, // 2582
    NpcIdentifiers.MAGE_OF_ZAMORAK_4, // 4936
    NpcIdentifiers.MAGE_OF_ZAMORAK_5, // 4937
    NpcIdentifiers.MAGE_OF_ZAMORAK_6, // 4938
  ]);
  const MAGE_OF_ZAMORAK_SPAWN_ID = NpcIdentifiers.MAGE_OF_ZAMORAK; // 2580
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
  const WEAK_ELEMENTAL_GUARDIAN_NPC_ID = NpcIdentifiers.WEAK_ELEMENTAL_GUARDIAN; // 11414
  const WEAK_CATALYTIC_GUARDIAN_NPC_ID = NpcIdentifiers.WEAK_CATALYTIC_GUARDIAN; // 11408
  const MEDIUM_ELEMENTAL_GUARDIAN_NPC_ID = NpcIdentifiers.MEDIUM_ELEMENTAL_GUARDIAN; // 11415

  const MY_NPC_IDS = new Set([
    PERSTEN_ALKHARID_NPC_ID,
    PERSTEN_TOWER_NPC_ID,
    PERSTEN_CUTSCENE_NPC_ID,
    PERSTEN_TEMPLE_NPC_ID,
    MAGE_OF_ZAMORAK_SPAWN_ID,
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
  const ALTAR_MIND_OBJECT_ID = ObjectIdentifiers.ALTAR_34; // 34761
  const ALTAR_WATER_OBJECT_ID = ObjectIdentifiers.ALTAR_35; // 34762
  const ALTAR_EXIT_MIND_OBJECT_ID = ObjectIdentifiers.PORTAL_40; // 34749
  const ALTAR_EXIT_WATER_OBJECT_ID = ObjectIdentifiers.PORTAL_41; // 34750
  const TEMPLE_EXIT_OBJECT_ID = ObjectIdentifiers.PORTAL_101; // 43692
  const BLUE_PORTAL_OBJECT_ID = ObjectIdentifiers.PORTAL_105; // 43765
  const GUARDIAN_OF_WATER_OBJECT_ID = ObjectIdentifiers.GUARDIAN_OF_WATER; // 43702
  const GUARDIAN_OF_MIND_OBJECT_ID = ObjectIdentifiers.GUARDIAN_OF_MIND; // 43705
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
  const MAGE_OF_ZAMORAK_TILE = { x: 3259, y: 3383, z: 0 };
  const BASEMENT_PERSTEN_TILE = { x: 3101, y: 9572, z: 0 };
  const BASEMENT_PORTAL_TILE = { x: 3104, y: 9574, z: 0 };
  const BASEMENT_LANDING_TILE = { x: 3106, y: 9571, z: 0 };
  const TOWER_ENTRANCE_TILE = { x: 3104, y: 3163, z: 0 };
  // Capture 1693 addnpc coords (not Quest Helper's interaction WorldPoints).
  const CORDELIA_TOWER_TILE = { x: 3110, y: 3161, z: 1 };
  const FELIX_TOWER_TILE = { x: 3111, y: 3163, z: 1 };
  const TAMARA_TOWER_TILE = { x: 3113, y: 3163, z: 1 };
  const ABYSS_CENTRE_TILE = { x: 3040, y: 4839, z: 0 };
  const MIND_ALTAR_TILE = { x: 2793, y: 4827, z: 0 };
  const WATER_ALTAR_TILE = { x: 2720, y: 4831, z: 0 };
  const TEMPLE_ARRIVAL_TILE = { x: 3614, y: 9492, z: 0 };
  const PERSTEN_TEMPLE_TILE = { x: 3610, y: 9499, z: 0 };
  const GREAT_GUARDIAN_TILE = { x: 3613, y: 9496, z: 0 };
  const CORDELIA_TEMPLE_TILE = { x: 3613, y: 9522, z: 0 };
  const FELIX_TEMPLE_TILE = { x: 3616, y: 9487, z: 0 };
  const TAMARA_TEMPLE_TILE = { x: 3610, y: 9509, z: 0 };
  const PICKAXE_GROUND_TILE = { x: 3621, y: 9488, z: 0 };

  // Persisted attributes.
  const ASKED_WHO_ATTRIBUTE = "quest.temple_of_the_eye.asked-who";
  const DECLINED_ATTRIBUTE = "temple-of-the-eye:declined";
  const AMULET_GIVEN_ATTRIBUTE = "quest.temple_of_the_eye.amulet-given";
  const INCANTATION_GIVEN_ATTRIBUTE = "quest.temple_of_the_eye.incantation-given";
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

  const RUNE_MYSTERIES_STAGE_ATTRIBUTE = "quest.rune_mysteries.stage";
  const RUNE_MYSTERIES_COMPLETE_STAGE = 6;
  const RUNECRAFTING_REQUIREMENT = 10;

  // Per-player quest spawns (owner-only), keyed by player.
  const spawns = new Map();
  let worldInstalled = false;

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

  /** Enter the Abyss is not implemented; Rune Mysteries is its prerequisite, so its
   * completion stands in for it (see the header). */
  function hasAbyssAccess(player) {
    return attributeNumber(player, RUNE_MYSTERIES_STAGE_ATTRIBUTE) >= RUNE_MYSTERIES_COMPLETE_STAGE;
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

  function play(player, npcId, variant) {
    startTranscript(api, player, npcId, PAGE, variant);
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

  /** The blue portal the incantation cut-scene opens in the Wizards' Tower basement.
   * It is permanent world scenery; its "Enter" is quest-gated below. */
  function installWorld() {
    if (worldInstalled) return;
    worldInstalled = true;
    const portal = new GameObject(
      BLUE_PORTAL_OBJECT_ID,
      new Location(BASEMENT_PORTAL_TILE.x, BASEMENT_PORTAL_TILE.y, BASEMENT_PORTAL_TILE.z),
      10,
      0,
      null
    );
    ObjectManager.register(portal, true);
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

  /** Keeps the owner-only quest NPCs in step with the player's stage. */
  function syncSpawns(player) {
    const stage = stageOf(player);
    setSpawn(
      player,
      "persten-alkharid",
      { id: PERSTEN_ALKHARID_NPC_ID, x: PERSTEN_ALKHARID_TILE.x, y: PERSTEN_ALKHARID_TILE.y, z: PERSTEN_ALKHARID_TILE.z, wanderRadius: 0 },
      stage < STAGE_TOWER
    );
    setSpawn(
      player,
      "mage",
      { id: MAGE_OF_ZAMORAK_SPAWN_ID, x: MAGE_OF_ZAMORAK_TILE.x, y: MAGE_OF_ZAMORAK_TILE.y, z: MAGE_OF_ZAMORAK_TILE.z, wanderRadius: 0 },
      // Kept after completion: the post-quest Mage of Zamorak dialogue (and its
      // MAGE_POSTQUEST_ATTRIBUTE condition) is only reachable on this owner spawn.
      (stage >= STAGE_APPRAISED && stage < STAGE_ENERGY) || stage === STAGE_COMPLETE
    );
    setSpawn(
      player,
      "persten-tower",
      { id: PERSTEN_TOWER_NPC_ID, x: BASEMENT_PERSTEN_TILE.x, y: BASEMENT_PERSTEN_TILE.y, z: BASEMENT_PERSTEN_TILE.z, wanderRadius: 0 },
      stage >= STAGE_TOWER && stage < STAGE_INCANTATION_READY
    );
    setSpawn(
      player,
      "cordelia-tower",
      { id: CORDELIA_TOWER_NPC_ID, x: CORDELIA_TOWER_TILE.x, y: CORDELIA_TOWER_TILE.y, z: CORDELIA_TOWER_TILE.z, wanderRadius: 0 },
      stage >= STAGE_SEDRIDOR && stage < STAGE_RIDDLE_DONE
    );
    setSpawn(
      player,
      "felix-tower",
      { id: FELIX_TOWER_NPC_ID, x: FELIX_TOWER_TILE.x, y: FELIX_TOWER_TILE.y, z: FELIX_TOWER_TILE.z, wanderRadius: 0 },
      stage >= STAGE_SEDRIDOR && stage < STAGE_RIDDLE_DONE
    );
    setSpawn(
      player,
      "tamara-tower",
      { id: TAMARA_TOWER_NPC_ID, x: TAMARA_TOWER_TILE.x, y: TAMARA_TOWER_TILE.y, z: TAMARA_TOWER_TILE.z, wanderRadius: 0 },
      stage >= STAGE_SEDRIDOR && stage < STAGE_RIDDLE_DONE
    );
    setSpawn(
      player,
      "persten-temple",
      { id: PERSTEN_TEMPLE_NPC_ID, x: PERSTEN_TEMPLE_TILE.x, y: PERSTEN_TEMPLE_TILE.y, z: PERSTEN_TEMPLE_TILE.z, wanderRadius: 0 },
      stage >= STAGE_TEMPLE && stage < STAGE_GUARDIAN
    );
    // The temple's apprentices and Great Guardian are the minigame's world spawns once the quest is done.
    setSpawn(
      player,
      "cordelia-temple",
      { id: CORDELIA_TEMPLE_NPC_ID, x: CORDELIA_TEMPLE_TILE.x, y: CORDELIA_TEMPLE_TILE.y, z: CORDELIA_TEMPLE_TILE.z, wanderRadius: 0 },
      stage >= STAGE_TEMPLE && stage < STAGE_COMPLETE
    );
    setSpawn(
      player,
      "felix-temple",
      { id: FELIX_TEMPLE_NPC_ID, x: FELIX_TEMPLE_TILE.x, y: FELIX_TEMPLE_TILE.y, z: FELIX_TEMPLE_TILE.z, wanderRadius: 0 },
      stage >= STAGE_TEMPLE && stage < STAGE_COMPLETE
    );
    setSpawn(
      player,
      "tamara-temple",
      { id: TAMARA_TEMPLE_NPC_ID, x: TAMARA_TEMPLE_TILE.x, y: TAMARA_TEMPLE_TILE.y, z: TAMARA_TEMPLE_TILE.z, wanderRadius: 0 },
      stage >= STAGE_TEMPLE && stage < STAGE_COMPLETE
    );
    setSpawn(
      player,
      "great-guardian",
      { id: GREAT_GUARDIAN_NPC_ID, x: GREAT_GUARDIAN_TILE.x, y: GREAT_GUARDIAN_TILE.y, z: GREAT_GUARDIAN_TILE.z, wanderRadius: 0 },
      stage >= STAGE_GUARDIAN && stage < STAGE_COMPLETE
    );
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
      if (stage > STAGE_INCANTATION && stage < STAGE_TOWER) {
        return (teleports(player) & TOWER_TELEPORT_BIT) !== 0
          ? "help-from-some-wizards-talking-to-wizard-persten-after-using-the-one-time-teleport"
          : "help-from-some-wizards-talking-to-wizard-persten-again-before-using-the-one-time-teleport";
      }
      return null;
    }
    if (npcId === PERSTEN_TOWER_NPC_ID) {
      if (stage < STAGE_TOWER || stage >= STAGE_INCANTATION_READY) return null;
      if (stage >= STAGE_RIDDLE_DONE) {
        return "enter-the-gate-after-declining-to-start-the-incantation-talking-to-wizard-persten";
      }
      return (teleports(player) & TOWER_TELEPORT_BIT) !== 0
        ? "help-from-some-wizards-talking-to-wizard-persten-after-using-the-one-time-teleport"
        : "help-from-some-wizards-talking-to-wizard-persten-again-before-using-the-one-time-teleport";
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
    if (stage >= STAGE_RIDDLE_DONE && stage < STAGE_PORTAL_OPEN) {
      return "enter-the-gate-talking-to-sedridor-or-persten";
    }
    if (stage >= STAGE_PORTAL_OPEN && stage < STAGE_TEMPLE) {
      return "enter-the-gate-after-declining-to-start-the-incantation-talking-to-archmage-sedridor";
    }
    if (stage >= STAGE_TEMPLE && stage < STAGE_COMPLETE) {
      return "enter-the-gate-talking-to-sedridor-after-the-portal-is-open";
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
      return "enter-the-gate-talking-to-apprentice-felix-after-the-great-guardian-spawns";
    }
    if (progress === TUTORIAL_FELIX) return "guardians-of-the-rift-talking-to-felix";
    if (progress <= TUTORIAL_TAMARA) return "guardians-of-the-rift-talking-to-felix-talking-to-apprentice-felix-again";
    if (progress <= TUTORIAL_PILE_ONE) return "guardians-of-the-rift-talking-to-felix-after-placing-the-weak-cell";
    if (progress === TUTORIAL_PILES) return "guardians-of-the-rift-talking-to-felix-after-getting-guardian-fragments";
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
    if (MAGE_OF_ZAMORAK_NPC_IDS.has(npcId)) return selectMageVariant(player);
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
    ERLp2D: (player) => {
      const seen = attributeNumber(player, TOWER_SEEN_ATTRIBUTE);
      return (seen & (CORDELIA_BIT | FELIX_BIT | TAMARA_BIT)) === (CORDELIA_BIT | FELIX_BIT | TAMARA_BIT);
    },
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
    ["Let me cast a locator spell!", (player) => camera(player, [2399, 5645, 550], [2399, 5668, 300], { rate: 2, rate2: 0 })],
    ["It seems we're deep below the sea, just south of Morytania!", (player) => camera(player, [2391, 5641, 720], [2403, 5634, 480])],
    ["And with you, Zachariah. So, it's really true?", (player) => camera(player, [2389, 5734, 760], [2403, 5728, 560], { rate: 1, rate2: 0 })],
    ["Humans, use the cells. Protect me while I close the rift.", (player) => endScene(player)],
    ["We are safe, for now.", (player) => camera(player, [2399, 5667, 820], [2399, 5684, 380])],
    ["Then I guess I'd better go and see Sedridor. Good luck.", (player) => camera(player, [2386, 5663, 970], [2408, 5667, 170])],
  ]);

  function camera(player, move, look, rates = { rate: 232, rate2: 100 }) {
    player.getPacketSender().sendCameraMoveTo(move[0], move[1], move[2], rates)
      .sendCameraLookAt(look[0], look[1], look[2], rates);
  }

  function endScene(player) {
    player.getPacketSender().sendCameraReset();
    Scenes.controls(player, false);
  }

  const LINES = {
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
    if (PUZZLE_INTROS.get(npcId) === event.text) {
      const key = [...TOWER_APPRENTICES].find(([id]) => id === npcId)?.[1]?.key;
      if (key) openPuzzleLater(player, key);
      return;
    }
    const scene = SCENE_LINES.get(event.text);
    if (scene) {
      scene(player);
      return;
    }
    const handler = LINES[event.text];
    if (handler) handler(player);
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
        setFlag(player, AMULET_GIVEN_ATTRIBUTE, false);
        setFlag(player, DECLINED_ATTRIBUTE, false);
        setStage(player, STAGE_STARTED);
      }
      return;
    }
    if (npcId === TRAIBORN_NPC_ID) return;
    if ((SEDRIDOR_NPC_IDS.has(npcId) || npcId === PERSTEN_TOWER_NPC_ID) && option === "Not yet.") {
      if (stageOf(player) === STAGE_RIDDLE_DONE) setStage(player, STAGE_INCANTATION_READY);
    }
  }

  function handleCondition(event) {
    const { player, npcId, stepId } = event;
    if (!player || !MY_NPC_IDS.has(npcId)) return;
    if (stepId === "azV7CN" && npcId === PERSTEN_ALKHARID_NPC_ID && stageOf(player) === STAGE_INCANTATION) {
      // Persten "finds" the lost amulet and keeps it.
      setStage(player, STAGE_COPIED);
    }
  }

  function handleAction(event) {
    const { player, npcId, stepId } = event;
    if (!player || !stepId || !MY_NPC_IDS.has(npcId)) return;
    if (event.kind === "message") {
      handleMessageStep(player, stepId);
      return;
    }
    switch (stepId) {
      case "5SxUiq":
      case "YdNgEz": // the Mage of Zamorak's one-time teleport
        player.setAttribute(TELEPORT_ATTRIBUTE, teleports(player) | ABYSS_TELEPORT_BIT);
        player.getPacketSender().sendVarbit(13740, 1);
        moveTo(player, ABYSS_CENTRE_TILE);
        setStage(player, STAGE_IN_ABYSS);
        event.handled = true;
        return;
      case "5mu1Ni":
      case "ZOWKkY": // Persten teleports the player to the Wizards' Tower entrance
        player.setAttribute(TELEPORT_ATTRIBUTE, teleports(player) | TOWER_TELEPORT_BIT);
        player.getPacketSender().sendVarbit(13753, 1);
        moveTo(player, TOWER_ENTRANCE_TILE);
        if (stageOf(player) < STAGE_TOWER) setStage(player, STAGE_TOWER);
        event.handled = true;
        return;
      case "DLPFdT":
      case "XJ8F74":
      case "itFyK-": // "Incantation cutscene begins below."
        setStage(player, STAGE_INCANTATION_READY);
        Scenes.controls(player, true, true);
        camera(player, [3107, 9563, 550], [3104, 9573, 250]);
        event.handled = true;
        event.steps = variantSteps("enter-the-gate-incantation-cutscene");
        return;
      case "I_aoEy": // "Temple of the Eye cutscene continues below."
        event.handled = true;
        moveTo(player, TEMPLE_ARRIVAL_TILE);
        setStage(player, STAGE_PORTAL_OPEN);
        camera(player, [2399, 5636, 550], [2399, 5626, 300]);
        event.steps = variantSteps("enter-the-gate-temple-of-the-eye-cutscene");
        return;
      case "MKvLzs": // "The cutscene ends." (the group is at the temple)
        event.handled = true;
        setStage(player, STAGE_TEMPLE);
        endScene(player);
        return;
      case "Wc3Ys0": // the vision begins
        event.handled = true;
        setStage(player, STAGE_VISION);
        Scenes.controls(player, true, true);
        camera(player, [2389, 5734, 760], [2403, 5739, 560]);
        return;
      case "9R5c1w":
      case "9kzaP8": // "Abyssal rift cutscene continues below."
        event.handled = true;
        event.steps = variantSteps("enter-the-gate-abyssal-rift-cutscene");
        return;
      case "dUuNRU": // the temple rumbles as the rift opens
        event.handled = true;
        shakeRift(player);
        return;
      case "2OgBfc": // "Great Guardian cutscene continues below."
        event.handled = true;
        setStage(player, STAGE_GUARDIAN);
        setTutorialProgress(player, TUTORIAL_START);
        camera(player, [2386, 5663, 970], [2408, 5667, 170]);
        event.steps = variantSteps("enter-the-gate-great-guardian-cutscene");
        return;
      case "PUnmxV": // Traiborn sets off fireworks
        event.handled = true;
        setStage(player, STAGE_RIDDLE_DONE);
        return;
      case "Gs6Qdo": // Cordelia's "see the puzzle again"
        event.handled = true;
        openPuzzleLater(player, "cordelia");
        return;
      case "t_zXOj": // Felix's
        event.handled = true;
        openPuzzleLater(player, "felix");
        return;
      case "HDrYiF": // Tamara's
        event.handled = true;
        openPuzzleLater(player, "tamara");
        return;
      case "wd6dSZ": // "The player returns to the Wizards' Tower."
        moveTo(player, BASEMENT_LANDING_TILE);
        setTutorialProgress(player, TUTORIAL_CLOSED);
        setStage(player, STAGE_CLOSED);
        endScene(player);
        return;
      case "_nVw7q": // "Sedridor cutscene continues below."
      case "m2nPIk":
        event.handled = true;
        moveTo(player, BASEMENT_LANDING_TILE);
        setStage(player, STAGE_FINAL);
        event.steps = variantSteps("guardians-of-the-rift-sedridor-cutscene");
        return;
      case "9-Wilv": // "Congratulations! Quest complete!"
        if (stageOf(player) >= STAGE_CLOSED) {
          quest.complete(player);
          syncSpawns(player);
        }
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
        if (!has(player, EYE_AMULET_ITEM_ID)) give(player, EYE_AMULET_ITEM_ID);
        setFlag(player, AMULET_GIVEN_ATTRIBUTE);
        setFlag(player, DECLINED_ATTRIBUTE, false);
        if (stageOf(player) < STAGE_APPRAISED) setStage(player, STAGE_APPRAISED);
        return;
      case "FJLAsS": // the Mage of Zamorak appraises the amulet and asks for tea
        player.getPacketSender().sendVarbit(13739, 1);
        if (stageOf(player) < STAGE_TEA_GIVEN) setStage(player, STAGE_TEA_GIVEN);
        return;
      case "QDRpz2":
      case "L04HOi": // the Tea Seller hands you a strong cup of tea
        if (!has(player, STRONG_CUP_OF_TEA_ITEM_ID)) give(player, STRONG_CUP_OF_TEA_ITEM_ID);
        player.setAttribute(TEA_ATTRIBUTE, 1);
        player.getPacketSender().sendVarbit(13741, 1);
        return;
      case "4t9kd_": // the Mage of Zamorak takes and drinks the tea
        if (has(player, STRONG_CUP_OF_TEA_ITEM_ID)) take(player, STRONG_CUP_OF_TEA_ITEM_ID);
        player.setAttribute(TEA_ATTRIBUTE, 2);
        if (stageOf(player) < STAGE_TEA_DRUNK) setStage(player, STAGE_TEA_DRUNK);
        return;
      case "BOdA6N": // the player throws the bucket of water over the Dark Mage
        if (stageOf(player) === STAGE_IN_ABYSS) setStage(player, STAGE_DARK_MAGE);
        return;
      case "5f9QJZ":
      case "PRt-AR": // the Dark Mage casts the spell on the amulet
        if (darkMageState(player) === 0) {
          player.setAttribute(DARK_MAGE_ATTRIBUTE, 1);
          energyOrder(player);
        }
        if (stageOf(player) < STAGE_ENERGY) setStage(player, STAGE_ENERGY);
        syncEnergyObjects(player);
        return;
      case "qOBPPr": // Persten copies the incantation
        if (!has(player, ABYSSAL_INCANTATION_ITEM_ID)) give(player, ABYSSAL_INCANTATION_ITEM_ID);
        setFlag(player, INCANTATION_GIVEN_ATTRIBUTE);
        if (stageOf(player) < STAGE_COPIED) setStage(player, STAGE_COPIED);
        return;
      case "9mZfyI":
      case "SzAddC": // the Dark Mage hands you an incantation
        if (!has(player, ABYSSAL_INCANTATION_ITEM_ID)) give(player, ABYSSAL_INCANTATION_ITEM_ID);
        setFlag(player, INCANTATION_GIVEN_ATTRIBUTE);
        player.getPacketSender().sendVarbit(13746, 1);
        if (stageOf(player) < STAGE_INCANTATION) setStage(player, STAGE_INCANTATION);
        return;
      case "MZvnSC": // you give the amulet back to Persten
        if (has(player, EYE_AMULET_ITEM_ID)) take(player, EYE_AMULET_ITEM_ID);
        if (stageOf(player) < STAGE_AMULET_RETURNED) setStage(player, STAGE_AMULET_RETURNED);
        return;
      case "VVjWKh":
      case "dFEOfF": // Persten hands you a copy of the incantation
        if (!has(player, ABYSSAL_INCANTATION_ITEM_ID)) give(player, ABYSSAL_INCANTATION_ITEM_ID);
        setFlag(player, INCANTATION_GIVEN_ATTRIBUTE);
        return;
      case "7fimNu": // Persten finishes inspecting the amulet
        if (stageOf(player) < STAGE_TOWER) setStage(player, STAGE_TOWER);
        return;
      case "anGHDo": // you give the incantation to Sedridor
        if (has(player, ABYSSAL_INCANTATION_ITEM_ID)) take(player, ABYSSAL_INCANTATION_ITEM_ID);
        setStage(player, STAGE_SEDRIDOR);
        return;
      case "LUkI-K": // Tamara hands you the talisman
        if (!has(player, PORTAL_TALISMAN_WATER_ITEM_ID)) give(player, PORTAL_TALISMAN_WATER_ITEM_ID);
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
      if (stageOf(player) < STAGE_STARTED || stageOf(player) >= STAGE_TEA_GIVEN) return;
      const variant = selectMageVariant(player);
      if (!variant) return;
      event.handled = true;
      play(player, npcId, variant);
      return;
    }
    if (itemId === EYE_AMULET_ITEM_ID && npcId === DARK_MAGE_NPC_ID) {
      if (stageOf(player) < STAGE_IN_ABYSS || stageOf(player) >= STAGE_DARK_MAGE || darkMageState(player) !== 0) return;
      event.handled = true;
      play(player, npcId, "herbert-and-the-dark-mage-talking-to-the-dark-mage");
      return;
    }
    if (itemId === ABYSSAL_INCANTATION_ITEM_ID && SEDRIDOR_NPC_IDS.has(npcId)) {
      if (stageOf(player) < STAGE_TOWER || stageOf(player) >= STAGE_SEDRIDOR) return;
      event.handled = true;
      play(player, npcId, "help-from-some-wizards-talking-to-archmage-sedridor");
    }
  }

  function handleItemOnObject(event) {
    const { player, itemId, objectId } = event;
    if (!player) return;
    if (
      itemId === PORTAL_TALISMAN_WATER_ITEM_ID &&
      objectId === GUARDIAN_OF_WATER_OBJECT_ID &&
      inTutorial(player) &&
      tutorialProgress(player) >= TUTORIAL_POWERED_TWO &&
      tutorialProgress(player) <= TUTORIAL_MEDIUM_CELL
    ) {
      moveTo(player, WATER_ALTAR_TILE);
      event.handled = true;
    }
  }

  // ---------------------------------------------------------------------------
  // Object interactions
  // ---------------------------------------------------------------------------

  function ensureGroundPickaxe(player) {
    api
      .getItemOnGroundManager()
      .registerLocation(
        player,
        new Item(ItemIdentifiers.BRONZE_PICKAXE, 1),
        new Location(PICKAXE_GROUND_TILE.x, PICKAXE_GROUND_TILE.y, PICKAXE_GROUND_TILE.z)
      );
  }

  function takeFloorChisel(event) {
    const { player } = event;
    if (!inTutorial(player) || tutorialProgress(player) < TUTORIAL_CELL) return;
    if (freeSlots(player) === 0) return;
    give(player, CHISEL_ITEM_ID);
    event.handled = true;
  }

  function takeWeakCell(event) {
    const { player } = event;
    if (!inTutorial(player) || tutorialProgress(player) < TUTORIAL_FELIX) return;
    if (freeSlots(player) === 0) return;
    give(player, WEAK_CELL_ITEM_ID);
    event.handled = true;
  }

  function takeUnchargedCell(event) {
    const { player } = event;
    if (!inTutorial(player) || tutorialProgress(player) < TUTORIAL_ESSENCE) return;
    if (freeSlots(player) === 0) return;
    give(player, UNCHARGED_CELL_ITEM_ID);
    event.handled = true;
  }

  function placeCell(event) {
    const { player } = event;
    if (!inTutorial(player)) return;
    const progress = tutorialProgress(player);
    if (progress === TUTORIAL_TAMARA && has(player, WEAK_CELL_ITEM_ID)) {
      take(player, WEAK_CELL_ITEM_ID);
      setTutorialProgress(player, TUTORIAL_CELL);
      play(player, TAMARA_TEMPLE_NPC_ID, "guardians-of-the-rift-after-placing-the-weak-cell-in-the-inactive-cell-tile");
      event.handled = true;
      return;
    }
    if (progress === TUTORIAL_MIND_STONES && has(player, WEAK_CELL_ITEM_ID)) {
      take(player, WEAK_CELL_ITEM_ID);
      setTutorialProgress(player, TUTORIAL_REPOWERED);
      event.handled = true;
      return;
    }
    if (progress === TUTORIAL_WATER_STONES_TWO && has(player, MEDIUM_CELL_ITEM_ID)) {
      take(player, MEDIUM_CELL_ITEM_ID);
      setTutorialProgress(player, TUTORIAL_MEDIUM_CELL);
      play(player, TAMARA_TEMPLE_NPC_ID, "guardians-of-the-rift-placing-the-medium-cell");
      event.handled = true;
    }
  }

  function spawnGuardian(player, npcId) {
    const npc = api.spawnNpc({
      id: npcId,
      x: player.getLocation().getX() + 1,
      y: player.getLocation().getY(),
      z: player.getLocation().getZ(),
      wanderRadius: 0,
      owner: player,
      ownerOnly: true,
    });
    return npc;
  }

  function assemblePile(event, objectId) {
    const { player } = event;
    if (!inTutorial(player) || !has(player, CHISEL_ITEM_ID)) return;
    const progress = tutorialProgress(player);
    if (progress === TUTORIAL_CELL && has(player, WEAK_CELL_ITEM_ID)) {
      take(player, WEAK_CELL_ITEM_ID);
      spawnGuardian(
        player,
        objectId === ESSENCE_PILE_CATALYTIC_OBJECT_ID
          ? WEAK_CATALYTIC_GUARDIAN_NPC_ID
          : WEAK_ELEMENTAL_GUARDIAN_NPC_ID
      );
      setTutorialProgress(player, TUTORIAL_PILE_ONE);
      play(player, FELIX_TEMPLE_NPC_ID, "guardians-of-the-rift-after-assembling-the-first-essence-pile");
      event.handled = true;
      return;
    }
    if (progress === TUTORIAL_PILE_ONE && has(player, WEAK_CELL_ITEM_ID)) {
      take(player, WEAK_CELL_ITEM_ID);
      spawnGuardian(
        player,
        objectId === ESSENCE_PILE_CATALYTIC_OBJECT_ID
          ? WEAK_CATALYTIC_GUARDIAN_NPC_ID
          : WEAK_ELEMENTAL_GUARDIAN_NPC_ID
      );
      setTutorialProgress(player, TUTORIAL_PILES);
      play(player, FELIX_TEMPLE_NPC_ID, "guardians-of-the-rift-after-assembling-the-second-essence-pile");
      event.handled = true;
      return;
    }
    if (progress === TUTORIAL_POWERED_TWO && has(player, MEDIUM_CELL_ITEM_ID)) {
      take(player, MEDIUM_CELL_ITEM_ID);
      spawnGuardian(player, MEDIUM_ELEMENTAL_GUARDIAN_NPC_ID);
      setTutorialProgress(player, TUTORIAL_MEDIUM_GUARDIAN);
      play(player, FELIX_TEMPLE_NPC_ID, "guardians-of-the-rift-constructing-the-medium-elemental-guardian");
      event.handled = true;
    }
  }

  function workAtBench(event) {
    const { player } = event;
    if (!inTutorial(player)) return;
    const progress = tutorialProgress(player);
    if (progress < TUTORIAL_PILES || progress > TUTORIAL_MEDIUM_CELL) return;
    const fragments = player.getInventory().getAmount(GUARDIAN_FRAGMENTS_ITEM_ID);
    if (fragments <= 0) return;
    const used = Math.min(fragments, 5);
    take(player, GUARDIAN_FRAGMENTS_ITEM_ID, used);
    give(player, GUARDIAN_ESSENCE_ITEM_ID, used);
    if (progress === TUTORIAL_PILES) setTutorialProgress(player, TUTORIAL_ESSENCE);
    event.handled = true;
  }

  function mineFragments(event) {
    const { player } = event;
    if (!inTutorial(player)) return;
    const progress = tutorialProgress(player);
    if (progress < TUTORIAL_PILES || progress > TUTORIAL_MEDIUM_CELL) return;
    if (!hasPickaxe(player)) {
      ensureGroundPickaxe(player);
      player.sendMessage("You need a pickaxe to mine the guardian remains.");
      event.handled = true;
      return;
    }
    if (freeSlots(player) === 0) return;
    const before = player.getInventory().getAmount(GUARDIAN_FRAGMENTS_ITEM_ID);
    give(player, GUARDIAN_FRAGMENTS_ITEM_ID);
    if (before < 5 && before + 1 >= 5) {
      play(player, FELIX_TEMPLE_NPC_ID, "guardians-of-the-rift-after-mining-5-fragments");
    }
    event.handled = true;
  }

  function enterMindAltar(event) {
    const { player } = event;
    if (!inTutorial(player)) return;
    const progress = tutorialProgress(player);
    if (progress < TUTORIAL_ESSENCE || progress > TUTORIAL_REPOWERED) return;
    moveTo(player, MIND_ALTAR_TILE);
    event.handled = true;
  }

  function enterWaterAltar(event) {
    const { player } = event;
    if (!inTutorial(player)) return;
    const progress = tutorialProgress(player);
    if (progress < TUTORIAL_POWERED_ONE || progress > TUTORIAL_WATER_STONES) return;
    moveTo(player, WATER_ALTAR_TILE);
    event.handled = true;
  }

  function enterTemplePortal(event) {
    moveTo(event.player, BASEMENT_LANDING_TILE);
    event.handled = true;
  }

  function enterBluePortal(event) {
    const { player } = event;
    const stage = stageOf(player);
    if (stage < STAGE_INCANTATION_READY || stage >= STAGE_COMPLETE) return;
    moveTo(player, TEMPLE_ARRIVAL_TILE);
    if (stage === STAGE_INCANTATION_READY) {
      setStage(player, STAGE_PORTAL_OPEN);
      play(player, PERSTEN_TEMPLE_NPC_ID, "enter-the-gate-temple-of-the-eye-cutscene");
    }
    event.handled = true;
  }

  function craftGuardianEssence(event, kind) {
    const { player } = event;
    if (!inTutorial(player) || !has(player, GUARDIAN_ESSENCE_ITEM_ID)) return false;
    const progress = tutorialProgress(player);
    if (kind === "mind" && (progress < TUTORIAL_ESSENCE || progress > TUTORIAL_REPOWERED)) return false;
    if (kind === "water" && (progress < TUTORIAL_POWERED_ONE || progress > TUTORIAL_WATER_STONES_TWO)) return false;
    take(player, GUARDIAN_ESSENCE_ITEM_ID);
    if (kind === "mind") {
      give(player, MIND_RUNE_ITEM_ID);
      if (!has(player, CATALYTIC_GUARDIAN_STONE_ITEM_ID)) give(player, CATALYTIC_GUARDIAN_STONE_ITEM_ID);
      if (has(player, UNCHARGED_CELL_ITEM_ID)) {
        take(player, UNCHARGED_CELL_ITEM_ID);
        give(player, WEAK_CELL_ITEM_ID);
      }
      player.getSkillManager().addExperiences(Skill.RUNECRAFTING, 1404);
      if (progress < TUTORIAL_MIND_STONES) setTutorialProgress(player, TUTORIAL_MIND_STONES);
    } else {
      give(player, WATER_RUNE_ITEM_ID);
      if (!has(player, ELEMENTAL_GUARDIAN_STONE_ITEM_ID)) give(player, ELEMENTAL_GUARDIAN_STONE_ITEM_ID);
      if (!has(player, PORTAL_TALISMAN_WATER_ITEM_ID)) give(player, PORTAL_TALISMAN_WATER_ITEM_ID);
      if (has(player, UNCHARGED_CELL_ITEM_ID)) {
        take(player, UNCHARGED_CELL_ITEM_ID);
        give(player, MEDIUM_CELL_ITEM_ID);
      }
      player.getSkillManager().addExperiences(Skill.RUNECRAFTING, 1403);
      if (progress <= TUTORIAL_WATER_STONES) setTutorialProgress(player, TUTORIAL_WATER_STONES);
      else if (progress < TUTORIAL_WATER_STONES_TWO) setTutorialProgress(player, TUTORIAL_WATER_STONES_TWO);
    }
    event.handled = true;
    return true;
  }

  function leaveAltar(event) {
    const { player, objectId } = event;
    if (!inTutorial(player)) return false;
    const progress = tutorialProgress(player);
    if (objectId === ALTAR_EXIT_MIND_OBJECT_ID) {
      if (progress < TUTORIAL_ESSENCE || progress > TUTORIAL_REPOWERED) return false;
    } else if (objectId === ALTAR_EXIT_WATER_OBJECT_ID) {
      if (progress < TUTORIAL_POWERED_ONE || progress > TUTORIAL_WATER_STONES_TWO) return false;
    } else {
      return false;
    }
    moveTo(player, TEMPLE_ARRIVAL_TILE);
    event.handled = true;
    return true;
  }

  function powerUpGreatGuardian(event) {
    const { player, npcId } = event;
    if (npcId !== GREAT_GUARDIAN_NPC_ID || !inTutorial(player)) return false;
    const progress = tutorialProgress(player);
    if (progress === TUTORIAL_REPOWERED && has(player, CATALYTIC_GUARDIAN_STONE_ITEM_ID)) {
      take(player, CATALYTIC_GUARDIAN_STONE_ITEM_ID);
      setTutorialProgress(player, TUTORIAL_POWERED_ONE);
      play(player, GREAT_GUARDIAN_NPC_ID, "guardians-of-the-rift-powering-up-the-great-guardian");
      event.handled = true;
      return true;
    }
    if (progress === TUTORIAL_WATER_STONES && has(player, ELEMENTAL_GUARDIAN_STONE_ITEM_ID)) {
      take(player, ELEMENTAL_GUARDIAN_STONE_ITEM_ID);
      setTutorialProgress(player, TUTORIAL_POWERED_TWO);
      play(player, GREAT_GUARDIAN_NPC_ID, "guardians-of-the-rift-powering-the-guardian-the-second-time");
      event.handled = true;
      return true;
    }
    if (progress === TUTORIAL_MEDIUM_CELL && has(player, ELEMENTAL_GUARDIAN_STONE_ITEM_ID)) {
      take(player, ELEMENTAL_GUARDIAN_STONE_ITEM_ID);
      Scenes.controls(player, true, true);
      camera(player, [2386, 5663, 970], [2408, 5667, 170]);
      play(player, GREAT_GUARDIAN_NPC_ID, "guardians-of-the-rift-closing-the-rift");
      event.handled = true;
      return true;
    }
    return false;
  }

  function handleObjectInteraction(event) {
    const { player, objectId, clickType } = event;
    if (!player || event.handled) return;
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
    if (objectId === INACTIVE_CELL_TILE_OBJECT_ID || objectId === INACTIVE_CELL_TILE_OBJECT_ID_2) {
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
    if (objectId === GUARDIAN_OF_MIND_OBJECT_ID) {
      if (clickType === 1) enterMindAltar(event);
      return;
    }
    if (objectId === GUARDIAN_OF_WATER_OBJECT_ID) {
      if (clickType === 1) enterWaterAltar(event);
      return;
    }
    if (objectId === TEMPLE_EXIT_OBJECT_ID) {
      if (clickType === 1) enterTemplePortal(event);
      return;
    }
    if (objectId === BLUE_PORTAL_OBJECT_ID) {
      if (clickType === 1) enterBluePortal(event);
      return;
    }
    if (objectId === ALTAR_MIND_OBJECT_ID) {
      if (clickType === 1) craftGuardianEssence(event, "mind");
      return;
    }
    if (objectId === ALTAR_WATER_OBJECT_ID) {
      if (clickType === 1) craftGuardianEssence(event, "water");
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

  // ---------------------------------------------------------------------------
  // Login / logout
  // ---------------------------------------------------------------------------

  function syncTowerPuzzleVarbits(player) {
    for (const apprentice of TOWER_APPRENTICES.values()) {
      const seen = bitSet(player, TOWER_SEEN_ATTRIBUTE, apprentice.bit) ? 1 : 0;
      player.getPacketSender().sendVarbit(TOWER_PUZZLE_VARBITS[apprentice.key], seen);
    }
  }

  function handleLogin({ player }) {
    installWorld();
    migrateLegacyStage(player);
    syncSpawns(player);
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
    clearSpawns(player);
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

  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:choice", handleChoice);
  api.onCustomEvent("npc-dialogue:condition", handleCondition);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onCustomEvent("npc-dialogue:line", handleLine);
  api.onItemOnNpc(handleItemOnNpc, { noted: false });
  api.onItemOnObject(handleItemOnObject, { noted: false });
  api.onObjectInteraction(handleObjectInteraction);
  api.onInterfaceActionButton(PUZZLE_CLOSE_UID, closePuzzle);
  api.onNpcInteraction("The Great Guardian", { "Power-up": powerUpGreatGuardian });
  api.onPlayerLogin(handleLogin);
  api.onPlayerLogout(handleLogout);
};
