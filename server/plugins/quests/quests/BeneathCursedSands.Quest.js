/**
 * Beneath Cursed Sands (members).
 *
 * The words come from the "Beneath Cursed Sands" transcript page; this plugin
 * supplies the variant selector for every quest NPC, the prose-condition
 * answers (requirements, inventory space, puzzle state), the stage-direction
 * handlers, the object/item interactions, the quest spawns and the reward.
 *
 * Stage varbit: 13841 "bcs" (varp 3421 "bcs_primary", bits 0-8). Recording 101
 * shows every milestone as an even value (2,4,6,...,108); the cache's own
 * multi-locs and multi-NPCs use the same table. Sibling varbits of varp 3421
 * are written separately: 13850 bcs_lily_type, 13853 bcs_owed_partisan and
 * 13854 bcs_owed_circlet.
 *
 * Stages (varbit 13841): 2 message received, 4 message slipped, 6 message read,
 * 8 Maisa intro, 10 camp talk done, 12 departure, 14 necropolis, 16 entry
 * inspected, 18 guard fight, 20 guard defeated, 22 post-fight talk, 24 camp
 * leads, 26 Ruins of Ullek, 28 furnace inspected, 30 refuelled, 32 lit/emblem
 * hunt, 34 emblem crafted, 36 emblem placed, 38 rotation confirmed, 40 tomb
 * entered, 42 mages defeated, 44 first lever, 46 levers/riddle door, 48 riddle
 * solved, 50 Mehhar, 52 tomb history, 54 key known, 56 key taken, 58 upper
 * door open, 60 Champion fight, 62 Champion defeated, 64 incantation,
 * 66 priest information, 68 Scabaras High Priest freed, 70 Nardah, 72 Maisa
 * departs, 74 Roger met, 76 Roger fed, 78 lily picked, 80 lily given, 82 cure
 * equipment started, 84 chemistry solved, 86 Maisa departs, 88 crate taken,
 * 90 crate delivered, 92 necropolis finale, 94 citizens freed, 96 citizens
 * walking, 98 Akh fight, 100 Akh defeated, 102 Sophanem finale, 104 meeting,
 * 106 Maisa tomb meeting, 108 complete.
 *
 * Rewards per the OSRS Wiki: 2 Quest points, 50,000 Agility XP, the Keris
 * partisan and the Circlet of water (if the inventory is full they are owed and
 * handed over later from the camp tent / the Sophanem High Priest). The message
 * and stone-tablet texts are the wiki item transcripts.
 *
 * Source: OSRS Wiki "Beneath Cursed Sands", its Quick guide and
 * Transcript:Beneath Cursed Sands; the cache for every id, varbit, transform
 * and placement.
 *
 * Gaps / approximations:
 *  - Cutscene cameras: the captured move/look pairs for the necropolis, guard,
 *    tomb, finale/Akh and Sophanem scenes are sent through QuestScenes; actor
 *    positions, sub-tick arcs and all fades are not fully reconstructed.
 *  - This cache places no interactive Jaltevas Pyramid exterior, so the
 *    "inspect the blocked entry" beat is bound to the necropolis rubble
 *    (44003): climbing it plays the blocked-entry messages and sets the
 *    inspected flag. The Menaphite Guard variant is not indexed to a cache NPC,
 *    so the chapter-one beat uses the indexed Citizen (11533); the world-spawned
 *    Citizen 11540 also answers.
 *  - The cache's camp Maisa (11474) is a static world spawn, so she is visible
 *    before the quest starts and after she should have left; variant selection
 *    keeps her talk benign outside her chapters.
 *  - The chest uses the captured numeric code 1118513. The pillar opens
 *    interface 750 and requires three captured clicks (varbit 13849 18 -> 15)
 *    before the entry unlocks; the underlying 3D rotation is not reconstructed.
 *    The urn riddle is enforced: the four riddle slots must hold scarab/human/
 *    baboon/crocodile in the 749-derived order before the lever opens the inner
 *    door. The two tomb levers share the captured 100-tick (60s) window; a late
 *    second lever fires the captured dart graphic/sound and resets both bits.
 *  - Combat is real NPC kills (Head Menaphite Guard 11529, Scarab Mage 11508 x2,
 *    Champion of Scabaras 11483, Menaphite Akh 11492) but boss specials (shadow
 *    rift, lightning, prayer punishment, shadow) are not scripted.
 *  - Roger is not talkable (no transcript page); the stepping stone runs the
 *    crossing conversation and Roger is scenery.
 *  - The post-quest Selim claim and the Pharaoh Kemesis cutscene are not
 *    implemented; the owed partisan comes from the camp tent and the owed
 *    circlet from the Sophanem High Priest.
 */
module.exports = function registerBeneathCursedSandsQuest(api) {
  const {
    GameObject,
    ItemIdentifiers,
    Location,
    MapObjects,
    NpcIdentifiers,
    ObjectDefinition,
    ObjectIdentifiers,
    ObjectManager,
    Skill,
  } = api.core;
  const { registerQuest, startTranscript } = require("../QuestRuntime");

  const PAGE = "Beneath Cursed Sands";
  const START_HOOK = "quest:beneath-cursed-sands:start";

  // ==========================================================================
  // Stage values / varbits
  // ==========================================================================

  const VARBIT_INVESTIGATED_ENTRY = 13844; // bcs_investigated_entry, varp 3421 bit 12
  const VARBIT_FOUND_MOULD = 13847; // bcs_found_mould, varp 3421 bits 15-17
  const VARBIT_LILY = 13850; // bcs_lily_type
  const VARBIT_OWED_PARTISAN = 13853; // bcs_owed_partisan
  const VARBIT_OWED_CIRCLET = 13854; // bcs_owed_circlet

  // Captured varbit 13841 values (recording 101): every milestone is even.
  const STAGE_NOT_STARTED = 0;
  const STAGE_STARTED = 2;
  const STAGE_MESSAGE = 4;
  const STAGE_MESSAGE_READ = 6;
  const STAGE_MAISA_INTRO = 8;
  const STAGE_CAMP = 10;
  const STAGE_DEPARTING = 12;
  const STAGE_NECROPOLIS = 14;
  const STAGE_ENTRY_INSPECTED = 16;
  const STAGE_GUARD_FIGHT = 18;
  const STAGE_GUARD_DEFEATED = 20;
  const STAGE_CAMP_LEADS = 22;
  const STAGE_CAMP_TALKED = 24;
  const STAGE_RUINS = 26;
  const STAGE_FURNACE_INSPECTED = 28;
  const STAGE_FURNACE_REFUELLED = 30;
  const STAGE_FURNACE_TO_LIGHT = 30;
  const STAGE_FURNACE_LIT = 32;
  const STAGE_TABLET = 32;
  const STAGE_CHEST_DUG = 32;
  const STAGE_MOULD = 32;
  const STAGE_EMBLEM = 34;
  const STAGE_TOMB_OPEN = 36;
  const STAGE_EMBLEM_CONFIRMED = 38;
  const STAGE_TOMB_ENTERED = 40;
  const STAGE_MAGES_DEAD = 42;
  const STAGE_LEVER_ONE = 44;
  const STAGE_LEVERS_DONE = 46;
  const STAGE_URN_CHAMBER = 46;
  const STAGE_URN_PUZZLE = 48;
  const STAGE_SPIRIT_MET = 50;
  const STAGE_KEY_KNOWN = 54;
  const STAGE_KEY_TAKEN = 56;
  const STAGE_UPPER_OPEN = 58;
  const STAGE_CHAMPION_FIGHT = 60;
  const STAGE_CHAMPION_DEAD = 62;
  const STAGE_ALTAR = 62;
  const STAGE_PRIEST_FREED = 68;
  const STAGE_NARDAH = 70;
  const STAGE_LILY_HUNT = 72;
  const STAGE_CROC_MET = 74;
  const STAGE_ROGER_FED = 76;
  const STAGE_LILY_PICKED = 78;
  const STAGE_EQUIPMENT = 82;
  const STAGE_CHEMISTRY_DONE = 84;
  const STAGE_MAISA_DEPARTS = 86;
  const STAGE_CURE_TAKEN = 88;
  const STAGE_CRATE_DELIVERED = 90;
  const STAGE_FINALE = 92;
  const STAGE_CITIZENS_FREED = 94;
  const STAGE_AKH_FIGHT = 98;
  const STAGE_AKH_DEAD = 100;
  const STAGE_SOPHANEM = 102;
  const STAGE_COMPLETE = 108;

  // ==========================================================================
  // Ids
  // ==========================================================================

  const JAMILA = NpcIdentifiers.JAMILA; // 3892
  const MAISA_CAMP = NpcIdentifiers.MAISA_2; // 11474, the BCS Maisa content id
  const MAISA_IDS = new Set([
    NpcIdentifiers.MAISA_2, // 11474
    NpcIdentifiers.MAISA_3, // 11475
    NpcIdentifiers.MAISA_4, // 11476
    NpcIdentifiers.MAISA_5, // 11477
  ]);
  const ZAHUR = NpcIdentifiers.ZAHUR; // 4753
  const MEHHAR = NpcIdentifiers.MEHHAR; // 11479
  const HIGH_PRIEST_OF_SCABARAS = NpcIdentifiers.HIGH_PRIEST_OF_SCABARAS; // 11480
  const HIGH_PRIEST_CUTSCENE = 11481;
  const CHAMPION_CUTSCENE = 11482;
  const HIGH_PRIEST_IDS = new Set([
    NpcIdentifiers.HIGH_PRIEST_2, // 4206, the town High Priest (cache transform)
    NpcIdentifiers.HIGH_PRIEST_4, // 11502
  ]);
  const OSMAN = NpcIdentifiers.OSMAN; // 1809, the indexed Osman (town/Contact)
  const OSMAN_BCS = NpcIdentifiers.OSMAN_10; // 11486, captured raw/content id; visual 11488
  const OSMAN_BCS_IDS = new Set([11486, 11488]); // raw/content + visual multinpc aliases
  const MENAPHITE_AKH = NpcIdentifiers.MENAPHITE_AKH_3; // 11492, level 351
  const SCARAB_MAGE = NpcIdentifiers.SCARAB_MAGE_3; // 11508, level 119
  const CHAMPION_OF_SCABARAS = NpcIdentifiers.CHAMPION_OF_SCABARAS_2; // 11483, level 379
  const HEAD_MENAPHITE_GUARD = NpcIdentifiers.HEAD_MENAPHITE_GUARD_2; // 11529, level 174
  const CITIZEN = 11537; // bcs_necropolis_citizen_5, Quest Helper's citizen anchor
  const BCS_NECROPOLIS_CITIZEN_IDS = new Set([
    CITIZEN,
    NpcIdentifiers.CITIZEN, // 11533
    11534, // bcs_necropolis_citizen_2
    11535, // bcs_necropolis_citizen_3
    11536, // bcs_necropolis_citizen_4
    11538, // bcs_necropolis_citizen_6
    11539, // bcs_necropolis_citizen_7
    11540, // bcs_necropolis_citizen_8, also spawned by npc-spawns.json
  ]);
  const ROGER = 11514; // bcs_crocodile_named, "Roger"

  const MESSAGE_ITEM = ItemIdentifiers.MESSAGE_8; // 26942
  const STONE_TABLET_ITEM = ItemIdentifiers.STONE_TABLET_5; // 26954
  const CHEST_ITEM = ItemIdentifiers.CHEST_3; // 26955
  const SCARAB_MOULD_ITEM = ItemIdentifiers.SCARAB_MOULD; // 26952
  const SCARAB_EMBLEM_ITEM = ItemIdentifiers.SCARAB_EMBLEM; // 26953
  const HUMAN_EMBLEM_ITEM = ItemIdentifiers.HUMAN_EMBLEM; // 26957
  const BABOON_EMBLEM_ITEM = ItemIdentifiers.BABOON_EMBLEM; // 26958
  const CROCODILE_EMBLEM_ITEM = ItemIdentifiers.CROCODILE_EMBLEM; // 26959
  const RUSTY_KEY_ITEM = ItemIdentifiers.RUSTY_KEY; // 26960
  const LILY_ITEM = ItemIdentifiers.LILY_OF_THE_ELID; // 26961
  const CURE_CRATE_ITEM = ItemIdentifiers.CURE_CRATE; // 26962
  const KERIS_PARTISAN_ITEM = ItemIdentifiers.KERIS_PARTISAN; // 25979
  const CIRCLET_OF_WATER_ITEM = ItemIdentifiers.CIRCLET_OF_WATER; // 26969
  const COAL_ITEM = ItemIdentifiers.COAL; // 453
  const IRON_BAR_ITEM = ItemIdentifiers.IRON_BAR; // 2351
  const TINDERBOX_ITEM = ItemIdentifiers.TINDERBOX; // 590
  const SPADE_ITEM = ItemIdentifiers.SPADE; // 952
  const MEAT_ITEM_IDS = new Set([
    ItemIdentifiers.RAW_BEEF, // 2132
    ItemIdentifiers.RAW_BEEF_2, // 2133
    ItemIdentifiers.RAW_BEEF_3, // 4287
    ItemIdentifiers.RAW_BEEF_4, // 4288
    ItemIdentifiers.COOKED_MEAT, // 2142
    ItemIdentifiers.COOKED_MEAT_2, // 2143
    ItemIdentifiers.COOKED_MEAT_3, // 4293
    ItemIdentifiers.COOKED_MEAT_4, // 4294
  ]);
  const RAW_MEAT_ITEM_IDS = new Set([
    ItemIdentifiers.RAW_BEEF,
    ItemIdentifiers.RAW_BEEF_2,
    ItemIdentifiers.RAW_BEEF_3,
    ItemIdentifiers.RAW_BEEF_4,
  ]);
  const COOKED_MEAT_ITEM_IDS = new Set([
    ItemIdentifiers.COOKED_MEAT,
    ItemIdentifiers.COOKED_MEAT_2,
    ItemIdentifiers.COOKED_MEAT_3,
    ItemIdentifiers.COOKED_MEAT_4,
  ]);
  const EMBLEM_ITEM_IDS = new Set([
    SCARAB_EMBLEM_ITEM,
    HUMAN_EMBLEM_ITEM,
    BABOON_EMBLEM_ITEM,
    CROCODILE_EMBLEM_ITEM,
  ]);

  const CAMP_TENT = ObjectIdentifiers.TENT_13; // 43887, searchable for the owed partisan
  const CAMP_EQUIPMENT = ObjectIdentifiers.CAMPING_EQUIPMENT_4; // 43889
  const CAMP_SPADE = ObjectIdentifiers.SPADE_3; // 43884
  const FURNACE_UNLIT = ObjectIdentifiers.FURNACE_32; // 43891
  const FURNACE_INSPECT = ObjectIdentifiers.FURNACE_33; // 43892
  const FURNACE_REFUEL = ObjectIdentifiers.FURNACE_34; // 43893
  const FURNACE_LIGHT = ObjectIdentifiers.FURNACE_35; // 43894
  const FURNACE_LIT = ObjectIdentifiers.FURNACE_36; // 43895
  const FURNACE_IDS = new Set([
    FURNACE_UNLIT,
    FURNACE_INSPECT,
    FURNACE_REFUEL,
    FURNACE_LIGHT,
    FURNACE_LIT,
  ]);
  const PILLAR_INSPECT = ObjectIdentifiers.PILLAR_81; // 43898
  const PILLAR_EMBLEM = ObjectIdentifiers.PILLAR_83; // 43900, emblem slotted
  const WELL_SEARCH = ObjectIdentifiers.WELL_23; // 43903
  const ENTRY_SEALED = ObjectIdentifiers.ENTRY_4; // 43953, Inspect
  const ENTRY_OPEN = ObjectIdentifiers.ENTRY_5; // 43954, Enter
  const DOOR_CHAMPION = ObjectIdentifiers.DOOR_661; // 43963, z2, normal door into the champion area
  const DOOR_LEVERS_A = ObjectIdentifiers.DOOR_659; // 43961, z0
  const DOOR_LEVERS_B = ObjectIdentifiers.DOOR_660; // 43962, z0
  const DOOR_UPPER = ObjectIdentifiers.DOOR_658; // 43960, z2, rusty key
  const LEVER_TOMB_ON = ObjectIdentifiers.LEVER_58; // 43967
  const LEVER_TOMB_OFF = ObjectIdentifiers.LEVER_59; // 43968
  const LEVER_URN = ObjectIdentifiers.LEVER_60; // 43969
  const LEVER_URN_ON = ObjectIdentifiers.LEVER_61; // 43970
  const RIDDLE_PLAQUE = ObjectIdentifiers.PLAQUE_27; // 43971
  const EMBLEM_PLAQUE = ObjectIdentifiers.PLAQUE_29; // 43973
  const URN_INSPECT = ObjectIdentifiers.URN_42; // 43979
  const KEY_URN = ObjectIdentifiers.URN_44; // 43981
  const LILY = ObjectIdentifiers.LILY; // 43984, lily present
  const LILY_PICKED = ObjectIdentifiers.LILY_3; // 43986, already picked
  const LILY_PLACED = 44593; // placed map loc; cache transforms it to 43984 at stage 76
  const STEPPING_STONE = ObjectIdentifiers.STEPPING_STONE_48; // 43988
  const CHEMISTRY_TABLE = ObjectIdentifiers.CHEMISTRY_TABLE_3; // 43991, resolved at stage 82
  const CHEMISTRY_TABLE_PLACED = 44594; // placed multi-loc; cache transforms 82 -> 43991 (Use)
  const PILLAR_INTERFACE = 750;
  const PILLAR_BUTTONS = [8, 9].map((child) => (PILLAR_INTERFACE << 16) | child);
  const LORE_TABLET_INTERFACE = 748;
  const LORE_RIDDLE_INTERFACE = 749;
  const CHEMISTRY_INTERFACE = 751;
  const CHEMISTRY_BUTTONS = [25, 26, 27, 28].map((child) => (CHEMISTRY_INTERFACE << 16) | child);
  const CHEST_CODE = 1118513; // captured resume_p_countdialog value
  const CHEMISTRY_TARGET = { left: 12, middle: 39, right: 45 };
  const TABLET_LORE = [
    "",
    "The Zamorakians are coming. We have no quarrel with them, but they",
    "won't care. We are already preparing our defences, but should Ullek",
    "fall, we can't let them defile Scabaras' precious artefacts. I've locked",
    "what I can in a chest and buried it to the south. If I don't make it",
    "through the coming storm, you'll find the chest under the",
    "southernmost ritual pillar. Your name hides the code to unlock it.",
    "",
    "With love,",
    "Sethos",
  ];
  const RIDDLE_LORE = [
    "In the days that followed the great sacrifice, Osmumten was faced",
    "with the task of ruling without the guidance of his lord. From north and",
    "south the four avatars came, offering their support. To the one that",
    "arrived first, he offered some linen. The one that was offered a",
    "necklace came from just south of the goddess of companionship. The",
    "god of isolation arrived just before the god of health and was",
    "offered a carving. The one who arrived third came from north of the",
    "goddess of resourcefulness but south of another. The one from the",
    "far south arrived last, just after the one offered some wine. After",
    "receiving their gifts and offering their guidance, the avatars",
    "returned from whence they came. But where did they come from?",
  ];
  const NECROPOLIS_RUBBLE = ObjectIdentifiers.RUBBLE_60; // 44003, climbable
  const BLOCKED_ENTRY = 44008; // toa_entrance_blocked, Inspect at the Jaltevas Pyramid
  const DIG_PILLARS = new Set([
    ObjectIdentifiers.PILLAR_86, // 43994
    ObjectIdentifiers.PILLAR_87, // 43995
    ObjectIdentifiers.PILLAR_88, // 43996
    ObjectIdentifiers.PILLAR_89, // 43997
  ]);
  // Both tomb levers are placed as 43968, which has no actions in this cache;
  // swap in the "Pull" loc (43967) so they can actually be clicked.
  const TOMB_LEVER_TILES = [
    [3439, 9225, 0],
    [3439, 9271, 0],
  ];
  let tombLeversInstalled = false;

  // ==========================================================================
  // Attributes
  // ==========================================================================

  const INTRO_ATTRIBUTE = "beneath-cursed-sands:maisa-intro";
  const ENTRY_INSPECTED_ATTRIBUTE = "beneath-cursed-sands:entry-inspected";
  const TABLET_FOUND_ATTRIBUTE = "beneath-cursed-sands:tablet-found";
  const TABLET_READ_ATTRIBUTE = "beneath-cursed-sands:tablet-read";
  const MOULD_FOUND_ATTRIBUTE = "beneath-cursed-sands:mould-found";
  const TALKED_CITIZEN_ATTRIBUTE = "beneath-cursed-sands:talked-citizen";
  const URNS_ATTRIBUTE = "beneath-cursed-sands:urns";
  const LEVERS_ATTRIBUTE = "beneath-cursed-sands:levers";
  const EMBLEMS_TAKEN_ATTRIBUTE = "beneath-cursed-sands:emblems-taken";
  const OWED_PARTISAN_ATTRIBUTE = "beneath-cursed-sands:owed-partisan";
  const OWED_CIRCLET_ATTRIBUTE = "beneath-cursed-sands:owed-circlet";

  // Urn slots 1 (northernmost) .. 4 (southernmost); emblem types 1..4.
  const EMBLEM_TYPE_BABOON = 1;
  const EMBLEM_TYPE_HUMAN = 2;
  const EMBLEM_TYPE_CROCODILE = 3;
  const EMBLEM_TYPE_SCARAB = 4;
  const EMBLEM_NAME_BY_TYPE = {
    1: "baboon",
    2: "human",
    3: "crocodile",
    4: "scarab",
  };
  const URN_EXPECTED = {
    1: 4, // northernmost: god of isolation / scarab
    2: 2, // centre-north: god of health / human
    3: 1, // centre-south: some linen / baboon
    4: 3, // southernmost: some necklace / crocodile
  };

  const EMBLEM_ITEM_BY_TYPE = {
    1: BABOON_EMBLEM_ITEM,
    2: HUMAN_EMBLEM_ITEM,
    3: CROCODILE_EMBLEM_ITEM,
    4: SCARAB_EMBLEM_ITEM,
  };
  const URN_NAME_BY_SLOT = {
    1: "northernmost",
    2: "centre-north",
    3: "centre-south",
    4: "southernmost",
  };

  // ==========================================================================
  // State helpers
  // ==========================================================================

  /** Transient: which urn the player is inspecting (message ids carry no slot). */
  const urnSlotByPlayer = new WeakMap();
  const firstLeverAt = new WeakMap();
  /** Transient: the upper door tile an action opens (messages carry no location). */
  const doorLocationByPlayer = new WeakMap();
  /** Per-player quest spawns, keyed by a role name. */
  const trackedNpcs = new Map();
  const chemistryState = new WeakMap();

  let quest;
  const { createQuestScenes } = require("../QuestScenes");
  const Scenes = createQuestScenes(api);
  const cameraWatch = new WeakMap();

  function hasItem(player, itemId, amount = 1) {
    return player.getInventory().getAmount(itemId) >= amount;
  }

  function hasAnyOf(player, itemIds) {
    for (const itemId of itemIds) {
      if (hasItem(player, itemId)) return true;
    }
    return false;
  }

  function freeSlots(player) {
    return player.getInventory().getFreeSlots();
  }

  function isQuestComplete(player, key) {
    const request = { player, key, complete: false };
    api.emitCustomEvent("quest:is-complete", request);
    return request.complete === true;
  }

  function meetsRequirements(player) {
    const skills = player.getSkillManager();
    return (
      skills.getMaxLevel(Skill.AGILITY) >= 62 &&
      skills.getMaxLevel(Skill.CRAFTING) >= 55 &&
      skills.getMaxLevel(Skill.FIREMAKING) >= 55 &&
      isQuestComplete(player, "contact") &&
      isQuestComplete(player, "ictlharins_little_helper")
    );
  }

  function flag(player, key, value) {
    player.setAttribute(key, value === true);
  }

  function hasFlag(player, key) {
    return player.getAttribute(key) === true;
  }

  function setStage(player, value) {
    if (quest.getStage(player) === value) return;
    quest.setStage(player, value);
    syncNpcs(player);
    // Lily/owed varbits live in the same parent varp as the stage.
    syncQuestVarbits(player);
  }

  function introDone(player) {
    return hasFlag(player, INTRO_ATTRIBUTE);
  }

  function entryInspected(player) {
    return hasFlag(player, ENTRY_INSPECTED_ATTRIBUTE);
  }

  function talkedCitizen(player) {
    return hasFlag(player, TALKED_CITIZEN_ATTRIBUTE);
  }

  function urnState(player) {
    return Number(player.getAttribute(URNS_ATTRIBUTE)) || 0;
  }

  function urnEmblem(player, slot) {
    return (urnState(player) >> ((slot - 1) * 4)) & 0xf;
  }

  function setUrnEmblem(player, slot, type) {
    const shift = (slot - 1) * 4;
    const next = (urnState(player) & ~(0xf << shift)) | ((type & 0xf) << shift);
    player.setAttribute(URNS_ATTRIBUTE, next | 0);
  }

  function urnPuzzleComplete(player) {
    for (let slot = 1; slot <= 4; slot++) {
      if (urnEmblem(player, slot) !== URN_EXPECTED[slot]) return false;
    }
    return true;
  }

  function leverBits(player) {
    return Number(player.getAttribute(LEVERS_ATTRIBUTE)) || 0;
  }

  function setLeverBits(player, value) {
    player.setAttribute(LEVERS_ATTRIBUTE, value | 0);
  }

  function emblemsTaken(player) {
    return hasFlag(player, EMBLEMS_TAKEN_ATTRIBUTE);
  }

  function owedPartisan(player) {
    return hasFlag(player, OWED_PARTISAN_ATTRIBUTE);
  }

  function setOwedPartisan(player, value) {
    flag(player, OWED_PARTISAN_ATTRIBUTE, value);
    player.getPacketSender().sendVarbit(VARBIT_OWED_PARTISAN, value ? 1 : 0);
  }

  function owedCirclet(player) {
    return hasFlag(player, OWED_CIRCLET_ATTRIBUTE);
  }

  function setOwedCirclet(player, value) {
    flag(player, OWED_CIRCLET_ATTRIBUTE, value);
    player.getPacketSender().sendVarbit(VARBIT_OWED_CIRCLET, value ? 1 : 0);
  }

  function lilyType(player) {
    const stage = quest.getStage(player);
    if (stage >= STAGE_LILY_PICKED) return 2;
    if (stage >= STAGE_ROGER_FED) return 1;
    return 0;
  }

  function hasMeat(player) {
    return hasAnyOf(player, MEAT_ITEM_IDS);
  }

  function hasAnyEmblem(player) {
    return hasAnyOf(player, EMBLEM_ITEM_IDS);
  }

  function takeAnyMeat(player) {
    for (const itemId of MEAT_ITEM_IDS) {
      if (hasItem(player, itemId)) {
        player.getInventory().deleteNumber(itemId, 1);
        return itemId;
      }
    }
    return null;
  }

  /** The native bcs_found_mould values the helper reads: 1 found, 2 read, 4 mould taken. */
  function foundMouldState(player) {
    if (hasFlag(player, MOULD_FOUND_ATTRIBUTE) || quest.getStage(player) >= STAGE_EMBLEM) return 4;
    if (hasFlag(player, TABLET_READ_ATTRIBUTE)) return 2;
    if (hasFlag(player, TABLET_FOUND_ATTRIBUTE)) return 1;
    return 0;
  }

  /** Publish the persisted BCS sub-varbits, leaving every bit sibling untouched. */
  function syncQuestVarbits(player) {
    const sender = player.getPacketSender();
    const stage = quest.getStage(player);
    sender.sendVarbit(VARBIT_INVESTIGATED_ENTRY, entryInspected(player) || stage >= STAGE_ENTRY_INSPECTED ? 1 : 0);
    sender.sendVarbit(VARBIT_FOUND_MOULD, foundMouldState(player));
    sender.sendVarbit(VARBIT_LILY, lilyType(player));
    sender.sendVarbit(VARBIT_OWED_PARTISAN, owedPartisan(player) ? 1 : 0);
    sender.sendVarbit(VARBIT_OWED_CIRCLET, owedCirclet(player) ? 1 : 0);
  }

  // ==========================================================================
  // Spawns
  // ==========================================================================

  function trackedFor(player) {
    let tracked = trackedNpcs.get(player);
    if (!tracked) {
      tracked = new Map();
      trackedNpcs.set(player, tracked);
    }
    return tracked;
  }

  /** Drops this player's own same-id NPC copies on a tile (relog leaves them behind). */
  function cullOwnedNpcs(player, npcId, x, y, z) {
    for (const other of api.getWorld?.()?.getNpcs?.() ?? []) {
      if (other?.getOwner?.() !== player || other.getId?.() !== npcId) continue;
      const at = other.getLocation?.();
      if (at && (at.getX?.() !== x || at.getY?.() !== y || at.getZ?.() !== z)) continue;
      api.removeNpc(other);
    }
  }

  function spawnTracked(player, key, npcId, x, y, z, wanderRadius = 0) {
    const tracked = trackedFor(player);
    const existing = tracked.get(key);
    if (existing?.isRegistered?.()) return existing;
    // A relog empties the tracked map but owner-only NPCs stay in the world;
    // drop same-id copies on this tile so login cannot stack duplicates.
    cullOwnedNpcs(player, npcId, x, y, z);
    const npc = api.spawnNpc({
      id: npcId,
      x,
      y,
      z,
      wanderRadius,
      owner: player,
      ownerOnly: true,
    });
    if (npc) tracked.set(key, npc);
    return npc;
  }

  function removeTracked(player, key) {
    const tracked = trackedNpcs.get(player);
    const npc = tracked?.get(key);
    if (!npc) return;
    api.removeNpc(npc);
    tracked.delete(key);
  }

  function ensureNpc(player, key, npcId, x, y, z, wanted) {
    if (wanted) spawnTracked(player, key, npcId, x, y, z);
    else {
      cullOwnedNpcs(player, npcId, x, y, z);
      removeTracked(player, key);
    }
  }

  function installTombLevers() {
    if (tombLeversInstalled) return;
    tombLeversInstalled = true;
    for (const [x, y, z] of TOMB_LEVER_TILES) {
      const location = new Location(x, y, z);
      const placed = MapObjects.get(LEVER_TOMB_OFF, location.clone(), null);
      if (placed) ObjectManager.deregister(placed, true);
      ObjectManager.register(new GameObject(LEVER_TOMB_ON, location, 10, 3, null), true);
    }
  }

  /** Keeps the per-player quest NPCs in step with the stage. */
  function syncNpcs(player) {
    const stage = quest.getStage(player);
    ensureNpc(player, "citizen", CITIZEN, 3347, 2718, 0, stage >= STAGE_NECROPOLIS && stage <= STAGE_CAMP_LEADS);
    ensureNpc(
      player,
      "necropolis-maisa",
      MAISA_CAMP,
      3327,
      2740,
      0,
      (stage >= STAGE_GUARD_FIGHT && stage <= STAGE_CAMP_LEADS) ||
        (stage >= STAGE_FINALE && stage <= STAGE_AKH_DEAD + 1)
    );
    ensureNpc(player, "nardah-maisa", MAISA_CAMP, 3421, 2906, 0, stage >= STAGE_NARDAH && stage <= STAGE_CRATE_DELIVERED);
    ensureNpc(player, "roger", ROGER, 3353, 2920, 0, stage >= STAGE_LILY_HUNT && stage <= STAGE_ROGER_FED);
    ensureNpc(player, "mehhar", MEHHAR, 3372, 9248, 0, stage >= STAGE_URN_PUZZLE && stage <= STAGE_PRIEST_FREED + 3);
    ensureNpc(
      player,
      "scabaras-priest",
      HIGH_PRIEST_OF_SCABARAS,
      3407,
      9248,
      2,
      stage >= STAGE_CHAMPION_DEAD && stage <= STAGE_PRIEST_FREED + 3
    );
    ensureNpc(player, "osman", OSMAN_BCS, 3371, 2801, 0, stage >= STAGE_AKH_DEAD && stage <= STAGE_AKH_DEAD + 1);
    ensureNpc(player, "guard", HEAD_MENAPHITE_GUARD, 3348, 2740, 0, stage === STAGE_GUARD_FIGHT);
    ensureNpc(player, "mage1", SCARAB_MAGE, 3438, 9247, 2, stage === STAGE_TOMB_ENTERED);
    ensureNpc(player, "mage2", SCARAB_MAGE, 3438, 9249, 2, stage === STAGE_TOMB_ENTERED);
    const championIntro = stage >= STAGE_UPPER_OPEN && stage < STAGE_CHAMPION_DEAD;
    ensureNpc(
      player,
      "tomb-high-priest",
      HIGH_PRIEST_CUTSCENE,
      3410,
      9248,
      2,
      stage === STAGE_TOMB_ENTERED || championIntro
    );
    ensureNpc(
      player,
      "tomb-champion",
      CHAMPION_CUTSCENE,
      3411,
      9251,
      2,
      stage === STAGE_TOMB_ENTERED || stage === STAGE_UPPER_OPEN
    );
    ensureNpc(player, "champion", CHAMPION_OF_SCABARAS, 3411, 9251, 2, stage === STAGE_CHAMPION_FIGHT);
    ensureNpc(player, "akh", MENAPHITE_AKH, 3369, 2805, 0, stage === STAGE_AKH_FIGHT);
  }

  // ==========================================================================
  // Transcripts
  // ==========================================================================

  /** Starts a transcript a tick later, after a running dialogue has closed. */
  function startTranscriptDeferred(player, npcId, variant, select) {
    const { CountdownTask, TaskManager } = api.core;
    if (!CountdownTask || !TaskManager) {
      startTranscript(api, player, npcId, PAGE, variant, select);
      return;
    }
    TaskManager.submit(
      new CountdownTask(player, 1, () => {
        if (player.isRegistered?.() === false) return;
        startTranscript(api, player, npcId, PAGE, variant, select);
      })
    );
  }

  /** A variant narrowed to the run starting at a top-level condition id. */
  function sliceFromCondition(steps, conditionId) {
    if (!Array.isArray(steps)) return steps;
    const index = steps.findIndex((step) => step?.type === "condition" && step.id === conditionId);
    return index === -1 ? steps : steps.slice(index);
  }

  /** A variant narrowed to the prose before its first choice menu. */
  function sliceBeforeChoice(steps) {
    if (!Array.isArray(steps)) return steps;
    const index = steps.findIndex((step) => step?.type === "choice");
    return index === -1 ? steps : steps.slice(0, index);
  }

  // ==========================================================================
  // Variant selection
  // ==========================================================================

  function selectJamilaVariant(stage, player) {
    if (stage === STAGE_NOT_STARTED) return "starting-off-talking-to-jamila";
    if (stage >= STAGE_NECROPOLIS) return "starting-off-talking-to-jamila-after-talking-to-maisa";
    return hasItem(player, MESSAGE_ITEM)
      ? "starting-off-talking-to-jamila-talking-to-jamila-after-getting-the-message-once"
      : "starting-off-talking-to-jamila-talking-to-jamilia-again-before-trying-on-the-ring";
  }

  function selectMaisaVariant(stage, player) {
    if (stage >= STAGE_SOPHANEM) return null;
    if (stage < STAGE_NECROPOLIS) {
      return introDone(player)
        ? "starting-off-talking-to-maisa-talking-to-maisa-again-before-the-cutscene"
        : "starting-off-talking-to-maisa";
    }
    if (stage === STAGE_GUARD_DEFEATED) {
      return "starting-off-talking-to-maisa-after-defeating-the-head-menaphite-guard";
    }
    // 22 is the camp-leads conversation whose last step (Jpi6NF) sends the player
    // to the ruins, so it must play the Ruins variant, not the "still looking" line.
    if (stage <= STAGE_CAMP_LEADS - 1) return "starting-off-talking-to-maisa-at-the-necropolis";
    if (stage <= STAGE_PRIEST_FREED + 3) return "the-ruins-of-ullek-talking-to-maisa";
    if (stage <= STAGE_LILY_PICKED + 5) return "cure-me-pox-talking-to-maisa-or-zahur";
    if (stage <= STAGE_CURE_TAKEN) {
      return "cure-me-pox-talking-to-maisa-after-zahur-explains-the-equipment";
    }
    if (stage < STAGE_FINALE) return null; // the High Priest advances 90 -> 92
    if (stage <= STAGE_AKH_FIGHT - 1) return "fight-with-the-menaphite-akh-talking-to-maisa-at-the-necropolis";
    if (stage <= STAGE_AKH_DEAD + 1) {
      return "fight-with-the-menaphite-akh-talking-to-maisa-at-the-necropolis-escape-fire-during-the-fight-with-the-menaphite-akh";
    }
    return "fight-with-the-menaphite-akh-talking-to-maisa-or-the-high-priest";
  }

  function selectZahurVariant(stage, player) {
    if (stage < STAGE_PRIEST_FREED || stage >= STAGE_COMPLETE) return null;
    if (stage >= STAGE_CHEMISTRY_DONE && stage < STAGE_CURE_TAKEN) {
      return "cure-me-pox-warming-up-the-equipment-talking-to-zahur-before-getting-the-crate";
    }
    if (stage >= STAGE_CURE_TAKEN) return "cure-me-pox-warming-up-the-equipment-talking-to-zahur-again";
    if (stage === STAGE_EQUIPMENT) return "cure-me-pox-warming-up-the-equipment-talking-to-zahur-before-getting-the-crate";
    if (stage >= STAGE_LILY_PICKED) return "cure-me-pox-returning-to-zahur";
    if (stage >= STAGE_NARDAH) return "cure-me-pox-talking-to-maisa-or-zahur-talking-to-zahur-again";
    // 64-67: first arrival in Nardah, which reveals Maisa at her side.
    setStage(player, STAGE_NARDAH);
    return "cure-me-pox-talking-to-maisa-or-zahur";
  }

  function selectMehharVariant(stage) {
    if (stage < STAGE_SPIRIT_MET) return "the-ruins-of-ullek-talking-to-the-spirit";
    if (stage < STAGE_KEY_KNOWN) return "the-ruins-of-ullek-talking-to-the-spirit-talking-to-mehhar-again";
    if (stage < STAGE_PRIEST_FREED) return "the-ruins-of-ullek-talking-to-mehhar-after-killing-the-high-priest-of-scabaras";
    return "the-ruins-of-ullek-talking-to-mehhar-after-saying-the-incantation";
  }

  function selectScabarasPriestVariant(stage) {
    if (stage < STAGE_CHAMPION_DEAD) return "the-ruins-of-ullek-the-champion-of-scabaras";
    if (stage < STAGE_PRIEST_FREED) return "the-ruins-of-ullek-talking-to-the-high-priest-of-scabaras";
    return "the-ruins-of-ullek-talking-to-the-high-priest-of-scabaras-talking-to-the-high-priest-again";
  }

  function selectHighPriestVariant(stage, player) {
    if (stage >= STAGE_COMPLETE) {
      return owedCirclet(player)
        ? "fight-with-the-menaphite-akh-talking-to-maisa-or-the-high-priest-talking-to-high-priest-before-getting-the-reward"
        : null;
    }
    if (stage >= STAGE_SOPHANEM) return "fight-with-the-menaphite-akh-talking-to-maisa-or-the-high-priest";
    if (stage >= STAGE_CURE_TAKEN) {
      return hasItem(player, CURE_CRATE_ITEM)
        ? "cure-me-pox-talking-to-the-high-priest-of-sophanem"
        : "cure-me-pox-talking-to-the-high-priest-of-sophanem-talking-to-the-high-priest-again";
    }
    return null;
  }

  function selectOsmanVariant(stage) {
    if (stage >= STAGE_AKH_DEAD && stage <= STAGE_AKH_DEAD + 1) {
      return "fight-with-the-menaphite-akh-defeating-the-menaphite-akh";
    }
    return null;
  }

  /**
   * The finale Osman is spawned as raw/content 11486 (visual 11488), which has no
   * dialogue-index entry. Dispatch Talk-to explicitly so the canonical BCS variant plays
   * with the correct (non-town) head.
   */
  function handleOsmanTalk(event) {
    const { player, npcId } = event ?? {};
    if (!player || !OSMAN_BCS_IDS.has(npcId)) return;
    const definition = event.definition ?? api.core.NpcDefinition.forId(npcId);
    const action = String(definition?.getActions?.()?.[event.clickType - 1] ?? "");
    if (action.toLowerCase() !== "talk-to") return;
    const variant = selectOsmanVariant(quest.getStage(player));
    if (!variant) return;
    event.handled = true;
    startTranscript(api, player, OSMAN_BCS, PAGE, variant, null, event.npc ?? null);
  }

  function selectCitizenVariant(stage) {
    if (stage >= STAGE_NECROPOLIS && stage <= STAGE_GUARD_FIGHT) return "starting-off-talking-to-a-citizen";
    // The BCS page default is Jamila, so never leave a citizen unanswered.
    return "starting-off-talking-to-maisa-after-defeating-the-head-menaphite-guard-talking-to-citizen-after-killing-the-head-menaphite-guard";
  }

  function selectVariant({ npcId, player }) {
    const stage = quest.getStage(player);
    if (npcId === JAMILA) return selectJamilaVariant(stage, player);
    if (MAISA_IDS.has(npcId)) return selectMaisaVariant(stage, player);
    if (npcId === ZAHUR) return selectZahurVariant(stage, player);
    if (npcId === MEHHAR) return selectMehharVariant(stage);
    if (npcId === HIGH_PRIEST_OF_SCABARAS) return selectScabarasPriestVariant(stage);
    if (HIGH_PRIEST_IDS.has(npcId)) return selectHighPriestVariant(stage, player);
    if (npcId === OSMAN || OSMAN_BCS_IDS.has(npcId)) return selectOsmanVariant(stage);
    if (BCS_NECROPOLIS_CITIZEN_IDS.has(npcId)) return selectCitizenVariant(stage);
    return null;
  }

  // ==========================================================================
  // Condition answers
  // ==========================================================================

  function answerCondition({ player, text, stepId }) {
    const value = String(text ?? "").toLowerCase();
    switch (stepId) {
      case "EG72ae": // requirements not met
        return !meetsRequirements(player);
      case "176ymE": // no inventory space
      case "aflncp":
      case "Ht5ARY":
      case "JIC2N1":
      case "7ccfXt":
      case "XKu47B":
      case "ua-ZfM":
      case "AWKbyb":
      case "7q3z7C":
      case "m--_AB":
      case "SgNX8k":
      case "XDgX9t":
      case "lIK3NS":
      case "C_iYsX":
      case "HwxhdO":
      case "ay1nNZ":
      case "a3FBE8":
      case "cAYF2b":
      case "hdWHUJ":
        return freeSlots(player) === 0;
      case "XRq9X9": // has inventory space
      case "OUV0Vd":
      case "nZBmJn":
      case "sg2p6r":
      case "GOB2aj":
      case "8u604D":
      case "9hvCES":
      case "RUKNjm":
        return freeSlots(player) > 0;
      case "0aobeO": // lower than level 85 combat
        return player.getSkillManager().getCombatLevel() < 85;
      case "M6NQTY": // lost the message
        return !hasItem(player, MESSAGE_ITEM);
      case "DR6Lnb": // did not lose the message
        return hasItem(player, MESSAGE_ITEM);
      case "pweUPy": // already talked to a citizen or guard
      case "EwD3ed":
      case "cXwwUr":
        return talkedCitizen(player);
      case "6GtkAE": // has not inspected the blocked entry
      case "Y9BVuZ":
        return !entryInspected(player);
      case "otoVHH": // has already inspected the blocked entry
      case "csB9eU":
        return entryInspected(player);
      case "l_rzqL": // already has a tinderbox
      case "4rYAMe": // has a tinderbox
        return hasItem(player, TINDERBOX_ITEM);
      case "YRqiPW": // does not have a tinderbox
        return !hasItem(player, TINDERBOX_ITEM);
      case "cWPPhg": // has coal
        return hasItem(player, COAL_ITEM);
      case "9x3Scj": // does not have coal
        return !hasItem(player, COAL_ITEM);
      case "CxM9SO": // has the mould and no iron bar
        return hasItem(player, SCARAB_MOULD_ITEM) && !hasItem(player, IRON_BAR_ITEM);
      case "KjOFbT": // has the mould and an iron bar
        return hasItem(player, SCARAB_MOULD_ITEM) && hasItem(player, IRON_BAR_ITEM);
      case "1trNvq": // does not have the mould
        return !hasItem(player, SCARAB_MOULD_ITEM);
      case "J92bm-": // already has the tablet
        return hasItem(player, STONE_TABLET_ITEM);
      case "Kk61U_": // chest entry incorrect
        return false;
      case "9yObmB": // chest entry correct
        return true;
      case "jQruRe": // rotation incorrect
        return false;
      case "Svxtqy": // rotation correct
        return true;
      case "GFogDe": // no emblems
        return !hasAnyEmblem(player);
      case "Ux0IjG": // puzzle incomplete
        return !urnPuzzleComplete(player);
      case "vpecUI": // puzzle complete
        return urnPuzzleComplete(player);
      case "-7Dfe4": // does not have the rusty key
        return !hasItem(player, RUSTY_KEY_ITEM);
      case "xRL6nI": // has the rusty key
        return hasItem(player, RUSTY_KEY_ITEM);
      case "JJI9Wx": // completed Making Friends with My Arm
        return isQuestComplete(player, "making_friends_with_my_arm");
      case "snpALd": // has meat
        return hasMeat(player);
      case "2DTyEf": // uses raw beef
        return hasAnyOf(player, RAW_MEAT_ITEM_IDS);
      case "6qxKzP": // uses cooked meat
        return hasAnyOf(player, COOKED_MEAT_ITEM_IDS);
      case "eAnITS": // already picked the lily
        return lilyType(player) >= 2;
      case "1ER9T9": // does not have the lily
        return !hasItem(player, LILY_ITEM);
      case "INWKVN": // does not have the crate
        return !hasItem(player, CURE_CRATE_ITEM);
      case "7LNV6Q": // urn option: baboon emblem
      case "LML8SH":
        return hasItem(player, BABOON_EMBLEM_ITEM);
      case "mFLiCX": // urn option: human emblem
      case "r2KX-h":
        return hasItem(player, HUMAN_EMBLEM_ITEM);
      case "j9c5d8": // urn option: crocodile emblem
      case "7ODbS0":
        return hasItem(player, CROCODILE_EMBLEM_ITEM);
      case "thAUeM": // urn option: scarab emblem
      case "AM3YM7":
        return hasItem(player, SCARAB_EMBLEM_ITEM);
      default:
        break;
    }
    if (value.includes("does not meet all of the requirements")) return !meetsRequirements(player);
    return null;
  }

  // ==========================================================================
  // Recorded camera tracks
  // ==========================================================================

  function showCamera(player, move, look, options = {}) {
    stopCamera(player);
    if (options.lockControls !== false) Scenes.controls(player, true, options.cutscene !== false);
    Scenes.camera(player, move, look);
    const token = {};
    cameraWatch.set(player, token);
    if (options.next) {
      for (const [ticks, nextMove, nextLook] of options.next) {
        Scenes.later(player, ticks, () => {
          if (cameraWatch.get(player) === token) Scenes.camera(player, nextMove, nextLook);
        });
      }
    }
    if (options.shake) {
      for (const [ticks, axis, random] of options.shake) {
        Scenes.later(player, ticks, () => {
          if (cameraWatch.get(player) === token) player.getPacketSender().sendCameraShake(axis, random, 0, 0);
        });
      }
    }
    if (options.resetAt !== undefined) {
      Scenes.later(player, options.resetAt, () => {
        if (cameraWatch.get(player) === token) stopCamera(player);
      });
    }
    if (options.poll !== true) return;
    const poll = () => {
      if (cameraWatch.get(player) !== token) return;
      if (Scenes.chatOpen(player)) {
        Scenes.later(player, 1, poll);
        return;
      }
      stopCamera(player);
    };
    Scenes.later(player, 1, poll);
  }

  function stopCamera(player) {
    if (!cameraWatch.delete(player)) return;
    Scenes.cancel(player);
    Scenes.controls(player, false);
    player.getPacketSender().sendCameraReset();
  }

  // ==========================================================================
  // Action / message handling
  // ==========================================================================

  function handleAction(event) {
    const { player, stepId } = event;
    switch (stepId) {
      // Wiki "unavailable" continuation markers that sit before a branch's tail;
      // letting them end the chat would strand the stage update after them.
      case "POwEyB": // Zahur: before the equipment talk
        event.handled = true;
        return;
      case "93LAJP": // Sophanem High Priest: hand over the first cure crate
        event.handled = true;
        if (hasItem(player, CURE_CRATE_ITEM)) player.getInventory().deleteNumber(CURE_CRATE_ITEM, 1);
        if (quest.getStage(player) < STAGE_CRATE_DELIVERED) setStage(player, STAGE_CRATE_DELIVERED);
        return;
      // Chapter 1 - Jamila and the necropolis.
      case "BJhYfb": // Jamila slips you a message
      case "L-uj6w":
        if (!hasItem(player, MESSAGE_ITEM)) player.getInventory().adds(MESSAGE_ITEM, 1);
        if (quest.getStage(player) < STAGE_MESSAGE) setStage(player, STAGE_MESSAGE);
        return;
      case "xBeK96": // cutscene: arriving at the necropolis
        setStage(player, STAGE_DEPARTING);
        showCamera(player, [3322, 2743, 480], [3332, 2735, 290], { poll: true });
        return;
      case "jclHjw": // cutscene ends
        setStage(player, STAGE_NECROPOLIS);
        player.moveTo(new Location(3348, 2763, 0));
        return;
      case "fyqclq": // guard cutscene begins (entry inspect path)
      case "QG4tPj": // guard cutscene begins (citizen path)
      case "tpcVMZ": // guard cutscene begins (guard path)
        event.handled = true;
        flag(player, TALKED_CITIZEN_ATTRIBUTE, true);
        showCamera(player, [3338, 2722, 390], [3343, 2732, 90], {
          poll: true,
          next: [[8, [3341, 2721, 440], [3340, 2735, 140]]],
        });
        startTranscriptDeferred(player, MAISA_CAMP, "starting-off-guard-cutscene");
        return;
      case "V9HUjH": // the fight begins
        event.handled = true;
        stopCamera(player);
        setStage(player, STAGE_GUARD_FIGHT);
        showCamera(player, [3331, 2730, 580], [3349, 2726, 280], { lockControls: false, poll: true });
        return;
      case "IDLAQq": // flee from the fight
        removeTracked(player, "guard");
        stopCamera(player);
        return;

      // Chapter 2 - camp and ruins.
      case "Jpi6NF": // Maisa leaves the camp
        if (quest.getStage(player) < STAGE_RUINS) setStage(player, STAGE_RUINS);
        return;
      case "LFeGB9": // tinderbox found
        if (!hasItem(player, TINDERBOX_ITEM)) player.getInventory().adds(TINDERBOX_ITEM, 1);
        return;
      case "C4FAas": // furnace: continues with refuel dialogue
        event.handled = true;
        startTranscriptDeferred(player, MAISA_CAMP, "the-ruins-of-ullek-interacting-with-objects-furnace-refuel-furnace");
        return;
      case "g3vgUM": // furnace refuelled
        if (hasItem(player, COAL_ITEM)) player.getInventory().deleteNumber(COAL_ITEM, 1);
        if (quest.getStage(player) < STAGE_FURNACE_TO_LIGHT) setStage(player, STAGE_FURNACE_TO_LIGHT);
        return;
      case "sY4_lV": // furnace: continues with light dialogue
        event.handled = true;
        startTranscriptDeferred(player, MAISA_CAMP, "the-ruins-of-ullek-interacting-with-objects-furnace-light-furnace");
        return;
      case "e40eIt": // furnace lit
        if (quest.getStage(player) < STAGE_FURNACE_LIT) setStage(player, STAGE_FURNACE_LIT);
        return;
      case "_1f0Kx": // scarab emblem crafted
        if (hasItem(player, SCARAB_MOULD_ITEM)) player.getInventory().deleteNumber(SCARAB_MOULD_ITEM, 1);
        if (hasItem(player, IRON_BAR_ITEM)) player.getInventory().deleteNumber(IRON_BAR_ITEM, 1);
        if (!hasItem(player, SCARAB_EMBLEM_ITEM)) player.getInventory().adds(SCARAB_EMBLEM_ITEM, 1);
        if (quest.getStage(player) < STAGE_EMBLEM) setStage(player, STAGE_EMBLEM);
        return;
      case "PCiLey": // well: stone tablet found
        if (!hasItem(player, STONE_TABLET_ITEM)) player.getInventory().adds(STONE_TABLET_ITEM, 1);
        flag(player, TABLET_FOUND_ATTRIBUTE, true);
        if (quest.getStage(player) < STAGE_TABLET) setStage(player, STAGE_TABLET);
        syncQuestVarbits(player);
        return;
      case "D9NBz-": // dig up an old chest
        if (!hasItem(player, CHEST_ITEM)) player.getInventory().adds(CHEST_ITEM, 1);
        if (quest.getStage(player) < STAGE_CHEST_DUG) setStage(player, STAGE_CHEST_DUG);
        return;
      case "aCMKC-": // scarab emblem placed in the pillar opens the rotation puzzle
        if (hasItem(player, SCARAB_EMBLEM_ITEM)) player.getInventory().deleteNumber(SCARAB_EMBLEM_ITEM, 1);
        setStage(player, STAGE_TOMB_OPEN);
        openPillarPuzzle(player);
        return;
      case "dPVj3O": // rotation correct
        if (quest.getStage(player) === STAGE_TOMB_OPEN) setStage(player, STAGE_EMBLEM_CONFIRMED);
        return;

      // Chapter 2 - the tomb.
      case "KgmAbA": // four emblems taken from the plaque
        if (freeSlots(player) < 4) {
          player.sendMessage("There are four emblems slotted into the plaque, but you don't have enough room to take them.");
          return;
        }
        player.getInventory().adds(HUMAN_EMBLEM_ITEM, 1);
        player.getInventory().adds(BABOON_EMBLEM_ITEM, 1);
        player.getInventory().adds(CROCODILE_EMBLEM_ITEM, 1);
        player.getInventory().adds(SCARAB_EMBLEM_ITEM, 1);
        flag(player, EMBLEMS_TAKEN_ATTRIBUTE, true);
        return;
      case "Gu8Ien": // urn: baboon emblem placed
        placeUrnEmblem(event, EMBLEM_TYPE_BABOON);
        return;
      case "1VnAt1": // urn: human emblem placed
        placeUrnEmblem(event, EMBLEM_TYPE_HUMAN);
        return;
      case "itrHbI": // urn: crocodile emblem placed
        placeUrnEmblem(event, EMBLEM_TYPE_CROCODILE);
        return;
      case "s3vs8q": // urn: scarab emblem placed
        placeUrnEmblem(event, EMBLEM_TYPE_SCARAB);
        return;
      case "RpCul3": // urn is empty
        event.handled = true;
        player.sendMessage(`The ${urnName(player)} urn is empty.`);
        return;
      case "T-XWqk": // remove the emblem from a full urn
        removeUrnEmblem(event);
        return;
      case "5n8so9": // swap for baboon
        swapUrnEmblem(event, EMBLEM_TYPE_BABOON);
        return;
      case "-ZAIcb": // swap for human
        swapUrnEmblem(event, EMBLEM_TYPE_HUMAN);
        return;
      case "PvgO3l": // swap for crocodile
        swapUrnEmblem(event, EMBLEM_TYPE_CROCODILE);
        return;
      case "OzGmtr": // swap for scarab
        swapUrnEmblem(event, EMBLEM_TYPE_SCARAB);
        return;
      case "vRtBKz": // lever by the urns: only the exact riddle map unlocks it
        event.handled = true;
        if (!urnPuzzleComplete(player)) {
          player.sendMessage("The lever doesn't budge. The four emblems are not in the right urns.");
          return;
        }
        player.sendMessage("As you pull the lever, you hear a loud click from the door.");
        if (quest.getStage(player) < STAGE_URN_PUZZLE) setStage(player, STAGE_URN_PUZZLE);
        return;
      case "MQFYdD": // rusty key opens the upper door
        event.handled = true;
        doorLocationByPlayer.delete(player);
        if (hasItem(player, RUSTY_KEY_ITEM)) player.getInventory().deleteNumber(RUSTY_KEY_ITEM, 1);
        if (quest.getStage(player) < STAGE_UPPER_OPEN) setStage(player, STAGE_UPPER_OPEN);
        enterChampionArena(player);
        return;
      case "ppIMnm": // rusty key found in the urn
        if (!hasItem(player, RUSTY_KEY_ITEM)) player.getInventory().adds(RUSTY_KEY_ITEM, 1);
        if (quest.getStage(player) < STAGE_KEY_TAKEN) setStage(player, STAGE_KEY_TAKEN);
        return;

      // Chapter 3 - cure me pox.
      case "7-ND2G": // Roger: continues with the meat dialogue
        event.handled = true;
        startTranscriptDeferred(
          player,
          MAISA_CAMP,
          "cure-me-pox-crossing-the-river-to-the-island-crossing-river-while-holding-meat"
        );
        return;
      case "V1ApkO": // Roger fed raw meat
      case "kg3k8k": // Roger fed cooked meat
        takeAnyMeat(player);
        removeTracked(player, "roger");
        if (quest.getStage(player) < STAGE_ROGER_FED) setStage(player, STAGE_ROGER_FED);
        player.moveTo(new Location(3353, 2926, 0));
        return;
      case "L2Rz7X": // lily picked
        if (!hasItem(player, LILY_ITEM)) player.getInventory().adds(LILY_ITEM, 1);
        if (quest.getStage(player) < STAGE_LILY_PICKED) setStage(player, STAGE_LILY_PICKED);
        syncQuestVarbits(player);
        return;
      case "EHRsdS": // Maisa departs to get the venom
        removeTracked(player, "nardah-maisa");
        if (quest.getStage(player) < STAGE_LILY_HUNT) setStage(player, STAGE_LILY_HUNT);
        return;
      case "sL-wqm": // Zahur gives you the first crate
      case "K9LyD1":
      case "qV0q-G":
        if (!hasItem(player, CURE_CRATE_ITEM)) player.getInventory().adds(CURE_CRATE_ITEM, 1);
        if (quest.getStage(player) < STAGE_CURE_TAKEN) setStage(player, STAGE_CURE_TAKEN);
        return;

      // Chapter 4 - the finale.
      case "PZPIrV": // cutscene: walking to the citizens
        if (quest.getStage(player) < STAGE_CITIZENS_FREED) setStage(player, STAGE_CITIZENS_FREED);
        showCamera(player, [3331, 2731, 630], [3349, 2724, 310], {
          poll: true,
          next: [
            [8, [3339, 2730, 630], [3349, 2724, 310]],
            [16, [3345, 2724, 1700], [3360, 2709, 700]],
            [28, [3342, 2717, 390], [3351, 2731, 90]],
            [40, [3366, 2786, 1000], [3370, 2794, 10]],
            [52, [3367, 2810, 460], [3371, 2793, 260]],
            [64, [3363, 2804, 300], [3374, 2800, 200]],
            [76, [3368, 2797, 440], [3370, 2811, 340]],
          ],
          shake: [[84, 0, 5]],
        });
        return;
      case "31LmTQ": // scene pans to Maisa's camp
        player.moveTo(new Location(3368, 2788, 0));
        return;
      case "VNowdJ": // the Akh fight begins
        event.handled = true;
        player.moveTo(new Location(3369, 2803, 0));
        setStage(player, STAGE_AKH_FIGHT);
        // Capture101: cam_reset one tick after the final Akh transformation (stage 98),
        // before the fight; release controls so the player can attack.
        showCamera(player, [3363, 2804, 300], [3374, 2800, 200], { shake: [[2, 0, 5]], resetAt: 1 });
        return;
      case "1WDBi3": // Osman departs
        removeTracked(player, "osman");
        if (quest.getStage(player) < STAGE_SOPHANEM) setStage(player, STAGE_SOPHANEM);
        showCamera(player, [3280, 2790, 400], [3288, 2777, 180], {
          poll: true,
          next: [
            [8, [3273, 2796, 750], [3273, 2779, 700]],
            [16, [3280, 2786, 500], [3263, 2783, 340]],
          ],
        });
        return;
      case "aHisly": // Maisa shows you a spear with a keris on the end
        if (freeSlots(player) > 0) {
          if (!hasItem(player, KERIS_PARTISAN_ITEM)) player.getInventory().adds(KERIS_PARTISAN_ITEM, 1);
        } else {
          setOwedPartisan(player, true);
        }
        return;
      case "VenWhi": // Maisa shows you an enchanted circlet
        if (freeSlots(player) > 0) {
          if (!hasItem(player, CIRCLET_OF_WATER_ITEM)) player.getInventory().adds(CIRCLET_OF_WATER_ITEM, 1);
        } else {
          setOwedCirclet(player, true);
        }
        return;
      case "MCAnTF": // the High Priest hands you a Circlet of Water
        event.handled = true;
        if (freeSlots(player) > 0 && !hasItem(player, CIRCLET_OF_WATER_ITEM)) {
          player.getInventory().adds(CIRCLET_OF_WATER_ITEM, 1);
          player.sendMessage("The High Priest hands you a Circlet of Water.");
          setOwedCirclet(player, false);
        } else {
          player.sendMessage("The High Priest tries to hand you a Circlet of Water, but you don't have enough room for it.");
        }
        return;
      case "n8xF8w": // chemistry complete: Maisa departs for the necropolis
        if (quest.getStage(player) < STAGE_MAISA_DEPARTS) setStage(player, STAGE_MAISA_DEPARTS);
        return;
      case "eRrcx2": // Keris partisan found in the tent
        if (freeSlots(player) > 0 && !hasItem(player, KERIS_PARTISAN_ITEM)) {
          player.getInventory().adds(KERIS_PARTISAN_ITEM, 1);
          player.sendMessage("You find a Keris partisan in the tent.");
          setOwedPartisan(player, false);
        } else {
          player.sendMessage("You find a Keris partisan in the tent, but you don't have enough room to take it.");
        }
        return;
      case "oyt_LF": // Congratulations! Quest complete!
      case "am2Oh5":
        event.handled = true;
        stopCamera(player);
        if (!quest.isComplete(player)) quest.complete(player);
        return;
      default:
        return;
    }
  }

  function urnName(player) {
    const slot = urnSlotByPlayer.get(player);
    return URN_NAME_BY_SLOT[slot] ?? "northernmost";
  }

  function placeUrnEmblem(event, type) {
    const { player } = event;
    const slot = urnSlotByPlayer.get(player);
    const itemId = EMBLEM_ITEM_BY_TYPE[type];
    event.handled = true;
    if (!slot || !hasItem(player, itemId) || urnEmblem(player, slot) !== 0) return;
    player.getInventory().deleteNumber(itemId, 1);
    setUrnEmblem(player, slot, type);
    player.sendMessage(`You put the ${EMBLEM_NAME_BY_TYPE[type]} emblem in the ${URN_NAME_BY_SLOT[slot]} urn.`);
  }

  function removeUrnEmblem(event) {
    const { player } = event;
    const slot = urnSlotByPlayer.get(player);
    const type = slot ? urnEmblem(player, slot) : 0;
    event.handled = true;
    if (!type || freeSlots(player) === 0) return;
    player.getInventory().adds(EMBLEM_ITEM_BY_TYPE[type], 1);
    setUrnEmblem(player, slot, 0);
  }

  function swapUrnEmblem(event, type) {
    const { player } = event;
    const slot = urnSlotByPlayer.get(player);
    const oldType = slot ? urnEmblem(player, slot) : 0;
    const newItem = EMBLEM_ITEM_BY_TYPE[type];
    event.handled = true;
    if (!oldType || oldType === type || !hasItem(player, newItem)) return;
    player.getInventory().deleteNumber(newItem, 1);
    setUrnEmblem(player, slot, type);
    player.getInventory().adds(EMBLEM_ITEM_BY_TYPE[oldType], 1);
  }

  // ==========================================================================
  // Dialogue lines (end-of-conversation stage beats)
  // ==========================================================================

  function handleLine(event) {
    const { player, npcId, text } = event;
    const stage = quest.getStage(player);
    if (HIGH_PRIEST_IDS.has(npcId) && text === "Hello again, friend. Your cure has worked wonderfully. Not a single citizen is infected any more. We're finally free of the plagues!") {
      showCamera(player, [3280, 2790, 400], [3288, 2777, 180], {
        poll: true,
        next: [
          [8, [3273, 2796, 750], [3273, 2779, 700]],
          [16, [3280, 2786, 500], [3263, 2783, 340]],
        ],
      });
      return;
    }
    if (MAISA_IDS.has(npcId) && text === "My list of allies grows shorter every day, but you actually seem to care about what's happening out here. You also seem to know what you're doing." && stage === STAGE_MESSAGE_READ) {
      setStage(player, STAGE_MAISA_INTRO);
      return;
    }
    if (MAISA_IDS.has(npcId) && text === "Fair enough... so what are our leads?" && stage === STAGE_CAMP_LEADS) {
      setStage(player, STAGE_CAMP_TALKED);
      return;
    }
    if (text === "Well let me know when you're ready, and I'll take you down there.") {
      flag(player, INTRO_ATTRIBUTE, true);
      setStage(player, STAGE_CAMP);
      return;
    }
    if (text === "Hmm... this seems familiar..." || text === "Hmm... this seems familiar... I'd better report back to Maisa.") {
      if (BCS_NECROPOLIS_CITIZEN_IDS.has(npcId)) flag(player, TALKED_CITIZEN_ATTRIBUTE, true);
      return;
    }
    if (MAISA_IDS.has(npcId) && text === "Will do." && stage === STAGE_GUARD_DEFEATED) {
      setStage(player, STAGE_CAMP_LEADS);
      return;
    }
    if (npcId === MEHHAR) {
      if (
        text === "You will find a key to the upper chamber in an urn to the back of this room. Now go, with the blessing of Scabaras." &&
        stage < STAGE_SPIRIT_MET
      ) {
        setStage(player, STAGE_SPIRIT_MET);
        return;
      }
      if (text === "You will find a key in an urn at the back of this room. May Scabaras guide you to success." && stage < STAGE_KEY_KNOWN) {
        setStage(player, STAGE_KEY_KNOWN);
        return;
      }
    }
    if (
      text === "Fine. We'll do it your way." &&
      stage === STAGE_UPPER_OPEN &&
      (npcId === HIGH_PRIEST_CUTSCENE || npcId === HIGH_PRIEST_OF_SCABARAS)
    ) {
      setStage(player, STAGE_CHAMPION_FIGHT);
      return;
    }
    if (npcId === HIGH_PRIEST_OF_SCABARAS && text === "Good luck in your fight, adventurer. May Scabaras guide you.") {
      if (stage < STAGE_PRIEST_FREED) setStage(player, STAGE_PRIEST_FREED);
      return;
    }
    if (
      npcId === ZAHUR &&
      text === "Just adjust the individual heats until the overall temperature is at the marked level. Be warned, the equipment can be a bit temperamental sometimes." &&
      stage >= STAGE_LILY_HUNT &&
      stage < STAGE_EQUIPMENT &&
      hasItem(player, LILY_ITEM)
    ) {
      setStage(player, STAGE_EQUIPMENT);
      return;
    }
    if (HIGH_PRIEST_IDS.has(npcId) && text === "Thank you, friend. You are once again our saviour!") {
      if (stage < STAGE_FINALE) setStage(player, STAGE_FINALE);
      return;
    }
  }

  // ==========================================================================
  // Quest start hook, item handlers
  // ==========================================================================

  function handleHook({ player, hook }) {
    if (hook !== START_HOOK) return;
    if (quest.getStage(player) !== STAGE_NOT_STARTED) return;
    setStage(player, STAGE_STARTED);
  }

  function handleItemAction(event) {
    const { player, itemId, option } = event;
    if (itemId === MESSAGE_ITEM && option === "Read") {
      event.handled = true;
      player.sendMessage("Head east from Sophanem and you'll find a camp by the cliffs. Meet me there as soon as you can.");
      if (quest.getStage(player) < STAGE_MESSAGE_READ) setStage(player, STAGE_MESSAGE_READ);
      return;
    }
    if (itemId === STONE_TABLET_ITEM && option === "Read") {
      event.handled = true;
      flag(player, TABLET_READ_ATTRIBUTE, true);
      openLorePanel(player, LORE_TABLET_INTERFACE, TABLET_LORE);
      syncQuestVarbits(player);
      return;
    }
    if (itemId === CHEST_ITEM && option === "Open") {
      event.handled = true;
      openChest(player);
    }
  }

  function openChest(player) {
    if (!hasItem(player, CHEST_ITEM)) return;
    const sender = player.getPacketSender();
    sender.sendEnterAmountPrompt("The chest has a seven digit lock. What would you like to enter?");
    player.setEnteredAmountAction({ execute: (code) => unlockChest(player, code) });
  }

  function unlockChest(player, code) {
    if (!hasItem(player, CHEST_ITEM)) return;
    if (code !== CHEST_CODE) {
      player.sendMessage("The combination doesn't seem to work.");
      return;
    }
    player.getInventory().deleteNumber(CHEST_ITEM, 1);
    if (!hasItem(player, SCARAB_MOULD_ITEM)) player.getInventory().adds(SCARAB_MOULD_ITEM, 1);
    player.sendMessage("You unlock the chest and recover a scarab mould from within.");
    flag(player, MOULD_FOUND_ATTRIBUTE, true);
    if (quest.getStage(player) < STAGE_MOULD) setStage(player, STAGE_MOULD);
    syncQuestVarbits(player);
  }

  function openLorePanel(player, interfaceId, lines) {
    const sender = player.getPacketSender();
    lines.forEach((text, index) => sender.sendString(text, (interfaceId << 16) | (3 + index)));
    sender.sendInterface(interfaceId);
  }

  function openPillarPuzzle(player) {
    if (quest.getStage(player) !== STAGE_TOMB_OPEN) return;
    const sender = player.getPacketSender();
    const current = sender.getVarbit?.(13849) ?? 0;
    sender.sendVarbit(13849, current >= 15 && current <= 18 ? current : 18);
    sender.sendInterface(PILLAR_INTERFACE);
  }

  function handlePillarButton(event) {
    const { player } = event;
    if (quest.getStage(player) !== STAGE_TOMB_OPEN) return false;
    const child = event.buttonId & 0xffff;
    const sender = player.getPacketSender();
    if (child === 8) {
      event.handled = true;
      const value = Math.max(15, (sender.getVarbit?.(13849) ?? 18) - 1);
      sender.sendVarbit(13849, value);
      return true;
    }
    if (child === 9) {
      event.handled = true;
      if ((sender.getVarbit?.(13849) ?? 18) === 15) {
        sender.sendInterfaceRemoval();
        player.sendMessage("You hear a click from the nearby entry.");
        setStage(player, STAGE_EMBLEM_CONFIRMED);
      }
      return true;
    }
    return false;
  }

  function handleItemOnObject(event) {
    const { player, itemId } = event;
    const { objectId } = resolveObject(event);

    if (FURNACE_IDS.has(objectId)) {
      if (itemId === COAL_ITEM) {
        event.handled = true;
        startTranscript(api, player, MAISA_CAMP, PAGE, "the-ruins-of-ullek-interacting-with-objects-furnace-refuel-furnace");
        return;
      }
      if (itemId === TINDERBOX_ITEM) {
        event.handled = true;
        startTranscript(api, player, MAISA_CAMP, PAGE, "the-ruins-of-ullek-interacting-with-objects-furnace-light-furnace");
        return;
      }
      if (itemId === SCARAB_MOULD_ITEM) {
        event.handled = true;
        if (!hasItem(player, IRON_BAR_ITEM)) {
          player.sendMessage("You need an iron bar to use the scarab mould.");
          return;
        }
        player.getInventory().deleteNumber(SCARAB_MOULD_ITEM, 1);
        player.getInventory().deleteNumber(IRON_BAR_ITEM, 1);
        if (!hasItem(player, SCARAB_EMBLEM_ITEM)) player.getInventory().adds(SCARAB_EMBLEM_ITEM, 1);
        player.sendMessage("You craft a scarab emblem.");
        if (quest.getStage(player) < STAGE_EMBLEM) setStage(player, STAGE_EMBLEM);
        return;
      }
    }
    if (itemId === SPADE_ITEM && DIG_PILLARS.has(objectId)) {
      event.handled = true;
      if (freeSlots(player) === 0) {
        player.sendMessage("Your spade hits an old chest, but you don't have enough room to take it.");
        return;
      }
      startTranscript(api, player, MAISA_CAMP, PAGE, "the-ruins-of-ullek-digging-under-the-ritual-pillar");
    }
  }

  // ==========================================================================
  // Object interactions
  // ==========================================================================

  function resolveObject(event) {
    // The interaction event already carries the player-resolved multi-loc
    // definition; fall back to resolving it for item-on-object events.
    const definition = event.definition ?? ObjectDefinition.forPlayer?.(event.objectId, event.player) ?? null;
    const objectId = definition?.id ?? event.objectId;
    const option = String(definition?.getInteractions?.()?.[event.clickType - 1] ?? "");
    return { definition, objectId, option };
  }

  function handleObjectInteraction(event) {
    const { player } = event;
    const { objectId, option } = resolveObject(event);
    const stage = quest.getStage(player);

    if (FURNACE_IDS.has(objectId)) {
      event.handled = true;
      if (option === "Inspect") {
        if (stage < STAGE_FURNACE_INSPECTED) setStage(player, STAGE_FURNACE_INSPECTED);
        startTranscript(api, player, MAISA_CAMP, PAGE, "the-ruins-of-ullek-interacting-with-objects-furnace-inspect-furnace");
        return;
      }
      if (option === "Refuel") {
        startTranscript(api, player, MAISA_CAMP, PAGE, "the-ruins-of-ullek-interacting-with-objects-furnace-refuel-furnace");
        return;
      }
      if (option === "Light") {
        startTranscript(api, player, MAISA_CAMP, PAGE, "the-ruins-of-ullek-interacting-with-objects-furnace-light-furnace");
        return;
      }
      if (option === "Smelt") {
        startTranscript(api, player, MAISA_CAMP, PAGE, "the-ruins-of-ullek-interacting-with-objects-furnace-smelt-furnace");
        return;
      }
      return;
    }

    if (objectId === PILLAR_INSPECT) {
      event.handled = true;
      if (stage < STAGE_RUINS) return;
      if (hasItem(player, SCARAB_EMBLEM_ITEM)) {
        startTranscript(api, player, MAISA_CAMP, PAGE, "the-ruins-of-ullek-interacting-with-objects-pillar");
      } else {
        startTranscript(api, player, MAISA_CAMP, PAGE, "the-ruins-of-ullek-interacting-with-objects-pillar", sliceBeforeChoice);
      }
      return;
    }
    if (objectId === PILLAR_EMBLEM) {
      event.handled = true;
      if (stage === STAGE_TOMB_OPEN) openPillarPuzzle(player);
      else startTranscript(api, player, MAISA_CAMP, PAGE, "the-ruins-of-ullek-confirming-the-scarab-emblem-in-the-pillar");
      return;
    }
    if (objectId === WELL_SEARCH) {
      event.handled = true;
      if (stage < STAGE_RUINS) return;
      startTranscript(api, player, MAISA_CAMP, PAGE, "the-ruins-of-ullek-interacting-with-objects-well");
      return;
    }
    if (objectId === ENTRY_SEALED) {
      event.handled = true;
      startTranscript(api, player, MAISA_CAMP, PAGE, "the-ruins-of-ullek-interacting-with-objects-entry");
      return;
    }
    if (objectId === ENTRY_OPEN) {
      event.handled = true;
      enterTomb(player);
      return;
    }
    if (objectId === CAMP_EQUIPMENT) {
      event.handled = true;
      if (stage < STAGE_CAMP_LEADS) return;
      startTranscript(api, player, MAISA_CAMP, PAGE, "the-ruins-of-ullek-talking-to-maisa-searching-the-camping-equipment");
      return;
    }
    if (objectId === CAMP_TENT) {
      event.handled = true;
      if (!owedPartisan(player)) return;
      startTranscript(api, player, MAISA_CAMP, PAGE, "fight-with-the-menaphite-akh-talking-to-maisa-or-the-high-priest-search-tent-before-getting-the-reward");
      return;
    }
    if (objectId === CAMP_SPADE) {
      event.handled = true;
      if (!hasItem(player, SPADE_ITEM)) player.getInventory().adds(SPADE_ITEM, 1);
      return;
    }
    if (objectId === BLOCKED_ENTRY) {
      event.handled = true;
      flag(player, ENTRY_INSPECTED_ATTRIBUTE, true);
      if (stage < STAGE_ENTRY_INSPECTED) setStage(player, STAGE_ENTRY_INSPECTED);
      else syncQuestVarbits(player);
      startTranscript(api, player, MAISA_CAMP, PAGE, "starting-off-inspecting-the-blocked-entry-after-finishing-the-cutscene");
      return;
    }
    if (objectId === NECROPOLIS_RUBBLE) {
      event.handled = true;
      climbNecropolisRubble(player);
      return;
    }
    if (objectId === LEVER_TOMB_ON || objectId === LEVER_TOMB_OFF) {
      event.handled = true;
      pullTombLever(player, event.location);
      return;
    }
    if (objectId === LEVER_URN || objectId === LEVER_URN_ON) {
      event.handled = true;
      if (stage < STAGE_URN_CHAMBER) return;
      startTranscript(api, player, MAISA_CAMP, PAGE, "the-ruins-of-ullek-pulling-the-lever-by-the-urns");
      return;
    }
    if (objectId === DOOR_LEVERS_A || objectId === DOOR_LEVERS_B) {
      event.handled = openLeversDoor(player, event.location, objectId);
      return;
    }
    if (objectId === DOOR_UPPER) {
      // After the Champion dies the captured route walks straight through this door;
      // leave it to Doors.plugin so a normal Open swaps in the open leaf.
      if (stage >= STAGE_CHAMPION_DEAD) return;
      event.handled = true;
      if (stage >= STAGE_UPPER_OPEN) enterChampionArena(player);
      else openUpperDoor(player, event.location);
      return;
    }
    if (objectId === DOOR_CHAMPION) {
      event.handled = true;
      openChampionDoor(player, event.location);
      return;
    }
    if (objectId === EMBLEM_PLAQUE) {
      event.handled = true;
      if (stage < STAGE_URN_CHAMBER || emblemsTaken(player)) return;
      startTranscript(api, player, MAISA_CAMP, PAGE, "the-ruins-of-ullek-taking-emblems-from-the-plaque");
      return;
    }
    if (objectId === RIDDLE_PLAQUE) {
      event.handled = true;
      openLorePanel(player, LORE_RIDDLE_INTERFACE, RIDDLE_LORE);
      return;
    }
    if (objectId === URN_INSPECT) {
      event.handled = true;
      urnInspect(player, event.location);
      return;
    }
    if (objectId === KEY_URN) {
      event.handled = true;
      if (stage < STAGE_KEY_KNOWN) return;
      startTranscript(api, player, MAISA_CAMP, PAGE, "the-ruins-of-ullek-searching-the-urn-by-mehhar");
      return;
    }
    if (objectId === LILY || objectId === LILY_PLACED) {
      event.handled = true;
      pickLily(player);
      return;
    }
    if (objectId === LILY_PICKED) {
      event.handled = true;
      startTranscript(
        api,
        player,
        MAISA_CAMP,
        PAGE,
        "cure-me-pox-crossing-the-river-to-the-island-picking-the-lily",
        (steps) => sliceFromCondition(steps, "eAnITS")
      );
      return;
    }
    if (objectId === STEPPING_STONE) {
      event.handled = true;
      crossSteppingStone(player);
      return;
    }
    if (objectId === CHEMISTRY_TABLE || objectId === CHEMISTRY_TABLE_PLACED) {
      event.handled = true;
      useChemistryTable(player);
      return;
    }
  }

  // ==========================================================================
  // Object behaviours
  // ==========================================================================

  function climbNecropolisRubble(player) {
    if (quest.getStage(player) < STAGE_NECROPOLIS) return;
    player.moveTo(new Location(3348, 2755, 0));
    if (!entryInspected(player)) {
      flag(player, ENTRY_INSPECTED_ATTRIBUTE, true);
      if (quest.getStage(player) < STAGE_ENTRY_INSPECTED) setStage(player, STAGE_ENTRY_INSPECTED);
      else syncQuestVarbits(player);
      startTranscript(api, player, MAISA_CAMP, PAGE, "starting-off-inspecting-the-blocked-entry-after-finishing-the-cutscene");
    }
  }

  function enterTomb(player) {
    const stage = quest.getStage(player);
    if (stage === STAGE_RUINS) {
      startTranscript(api, player, MAISA_CAMP, PAGE, "the-ruins-of-ullek-entering-the-ruins");
      return;
    }
    if (stage < STAGE_TOMB_OPEN) {
      startTranscript(api, player, MAISA_CAMP, PAGE, "the-ruins-of-ullek-interacting-with-objects-entry");
      return;
    }
    player.moveTo(new Location(3445, 9248, 2));
    showCamera(player, [3420, 9241, 580], [3410, 9252, 380], { resetAt: 12 });
    if (stage < STAGE_TOMB_ENTERED) {
      setStage(player, STAGE_TOMB_ENTERED);
      startTranscript(api, player, MAISA_CAMP, PAGE, "the-ruins-of-ullek-entering-the-ruins");
    }
  }

  function pullTombLever(player, location) {
    const stage = quest.getStage(player);
    if (stage < STAGE_MAGES_DEAD || stage >= STAGE_URN_PUZZLE) return;
    const bit = location && location.y <= 9248 ? 1 : 2;
    const was = leverBits(player);
    if ((was & bit) !== 0) {
      startTranscript(api, player, MAISA_CAMP, PAGE, "the-ruins-of-ullek-pulling-levers-when-the-lever-resets");
      return;
    }
    const now = api.core.World.getProcessCycle();
    const first = firstLeverAt.get(player);
    if (was !== 0 && (first === undefined || now - first > 100)) {
      firstLeverAt.delete(player);
      setLeverBits(player, 0);
      player.performGraphic(new api.core.Graphic(1575, 0, 124));
      player.getPacketSender().sendSoundEffect(4195, 1, 0);
      player.sendMessage("A dart trap fires and the tomb levers reset. Pull them again quickly.");
      startTranscript(api, player, MAISA_CAMP, PAGE, "the-ruins-of-ullek-pulling-levers-when-the-lever-resets");
      return;
    }
    if (was === 0) firstLeverAt.set(player, now);
    const next = was | bit;
    setLeverBits(player, next);
    const done = (next & 3) === 3;
    if (done) firstLeverAt.delete(player);
    setStage(player, done ? STAGE_LEVERS_DONE : STAGE_LEVER_ONE);
    startTranscript(
      api,
      player,
      MAISA_CAMP,
      PAGE,
      done
        ? "the-ruins-of-ullek-pulling-levers-pulling-the-second-lever"
        : "the-ruins-of-ullek-pulling-levers-pulling-the-first-lever"
    );
  }

  function urnInspect(player, location) {
    if (quest.getStage(player) < STAGE_URN_CHAMBER) return;
    const y = location?.y ?? 0;
    const slot = y >= 9251 ? 1 : y >= 9249 ? 2 : y >= 9247 ? 3 : 4;
    urnSlotByPlayer.set(player, slot);
    startTranscript(
      api,
      player,
      MAISA_CAMP,
      PAGE,
      urnEmblem(player, slot)
        ? "the-ruins-of-ullek-urns-inspecting-a-full-urn"
        : "the-ruins-of-ullek-urns-inspecting-an-empty-urn"
    );
  }

  function openUpperDoor(player, location) {
    doorLocationByPlayer.set(player, location ?? player.getLocation());
    startTranscript(api, player, MAISA_CAMP, PAGE, "the-ruins-of-ullek-opening-the-upstairs-locked-door");
  }

  /** The captured west arena; logging in here resumes the unfinished Champion intro. */
  function inChampionArena(player) {
    const at = player.getLocation?.();
    if (!at || at.getZ?.() !== 2) return false;
    return at.getX() >= 3404 && at.getX() <= 3420 && at.getY() >= 9240 && at.getY() <= 9256;
  }

  function startChampionIntro(player) {
    if (quest.getStage(player) !== STAGE_UPPER_OPEN) return;
    startTranscriptDeferred(player, HIGH_PRIEST_CUTSCENE, "the-ruins-of-ullek-the-champion-of-scabaras");
  }

  /** Normal entry once the door is unlocked at stage 58: no key is granted or consumed. */
  function enterChampionArena(player) {
    player.getMovementQueue?.().reset?.();
    player.moveTo(new Location(3420, 9248, 2));
    startChampionIntro(player);
  }

  /** The lever-opened downstairs door (43961/43962); both leaves route here. */
  function openLeversDoor(player, location, objectId) {
    const stage = quest.getStage(player);
    const inner = objectId === DOOR_LEVERS_B;
    const allowed = inner
      ? stage >= STAGE_URN_PUZZLE && urnPuzzleComplete(player)
      : stage >= STAGE_LEVERS_DONE;
    if (allowed) return false;
    startTranscript(api, player, MAISA_CAMP, PAGE, "the-ruins-of-ullek-opening-the-downstairs-locked-door");
    return true;
  }

  /** The Champion door (43963), the normal door into the champion area after the keyed door. */
  function openChampionDoor(player, location) {
    stepThrough(player, location);
    const stage = quest.getStage(player);
    if (stage >= STAGE_CHAMPION_DEAD && stage < STAGE_ALTAR) setStage(player, STAGE_ALTAR);
  }

  /**
   * Doors.plugin.js claims every "Door" and swaps 43960/43961/43962/43963 before
   * this plugin's object hook runs. It emits door:toggle first, so claim the
   * quest doors here and run the quest's own logic.
   */
  function claimQuestDoor(request) {
    if (request.handled) return;
    const { player, objectId, location } = request;
    if (objectId === DOOR_LEVERS_A || objectId === DOOR_LEVERS_B) {
      // Allowed doors must fall through to Doors.plugin: it swaps the captured closed
      // leaf for the open leaf (43964) and normal MovementQueue walking crosses it.
      request.handled = openLeversDoor(player, location, objectId);
      return;
    }
    if (objectId === DOOR_CHAMPION) {
      request.handled = true;
      openChampionDoor(player, location);
      return;
    }
    if (objectId === DOOR_UPPER) {
      const stage = quest.getStage(player);
      if (stage >= STAGE_CHAMPION_DEAD) return;
      request.handled = true;
      if (stage >= STAGE_UPPER_OPEN) enterChampionArena(player);
      else openUpperDoor(player, location);
    }
  }

  /**
   * Captured River Elid cross: the stone and the island lily are clicked from the bank,
   * not walked onto. Allow those two clicks in place so the normal object action runs.
   */
  const STEPPING_STONE_TILE = new Location(3353, 2923, 0);
  const LILY_TILE = new Location(3353, 2927, 0);

  function atObjectTile(event, tile) {
    const at = event.object?.getLocation?.() ?? event.object?.location;
    if (!at) return false;
    return (
      (at.getX?.() ?? at.x) === tile.getX() &&
      (at.getY?.() ?? at.y) === tile.getY() &&
      (at.getZ?.() ?? at.z) === tile.getZ()
    );
  }

  function clickedOption(event, wanted) {
    const definition = event.definition ?? api.core.CacheDefinitions?.getObject?.(event.objectId);
    const actions = definition?.getInteractions?.() ?? definition?.actions ?? [];
    return String(actions[event.clickType - 1] ?? "").toLowerCase() === wanted;
  }

  function routeSteppingStones(event) {
    const { player, objectId } = event ?? {};
    if (!player) return;
    if (quest.getStage(player) < STAGE_LILY_HUNT) return;
    const at = player.getLocation?.();
    if (!at || at.getZ?.() !== 0) return;
    const x = at.getX();
    const y = at.getY();
    if (objectId === STEPPING_STONE) {
      if (!atObjectTile(event, STEPPING_STONE_TILE) || !clickedOption(event, "cross")) return;
      // Captured click tile 3353,2921 plus the immediate 2-tile bank approaches only.
      if (x < 3351 || x > 3355 || y < 2919 || y > 2921) return;
      if (Math.max(Math.abs(x - 3353), Math.abs(y - 2923)) > 2) return;
      event.destination = { x, y, z: 0 };
      return;
    }
    if (objectId === LILY || objectId === LILY_PLACED) {
      if (!atObjectTile(event, LILY_TILE) || !clickedOption(event, "pick")) return;
      // The scripted Roger landing 3353,2926 and its adjacent island tiles only.
      if (Math.max(Math.abs(x - 3353), Math.abs(y - 2927)) > 1) return;
      event.destination = { x, y, z: 0 };
    }
  }

  function crossSteppingStone(player) {
    const stage = quest.getStage(player);
    if (stage < STAGE_LILY_HUNT) {
      startTranscript(api, player, MAISA_CAMP, PAGE, "cure-me-pox-crossing-the-river-to-the-island-crossing-river-again-without-meat");
      return;
    }
    if (stage >= STAGE_ROGER_FED) {
      player.moveTo(new Location(3353, 2926, 0));
      return;
    }
    if (!hasMeat(player)) {
      startTranscript(api, player, MAISA_CAMP, PAGE, "cure-me-pox-crossing-the-river-to-the-island-crossing-river-again-without-meat");
      return;
    }
    if (stage < STAGE_CROC_MET) setStage(player, STAGE_CROC_MET);
    startTranscript(
      api,
      player,
      MAISA_CAMP,
      PAGE,
      "cure-me-pox-crossing-the-river-to-the-island-crossing-river-while-holding-meat"
    );
  }

  function pickLily(player) {
    if (quest.getStage(player) < STAGE_ROGER_FED) return;
    startTranscript(api, player, MAISA_CAMP, PAGE, "cure-me-pox-crossing-the-river-to-the-island-picking-the-lily");
  }

  function useChemistryTable(player) {
    if (quest.getStage(player) < STAGE_EQUIPMENT || quest.getStage(player) >= STAGE_CURE_TAKEN) return;
    const state = { left: 0, middle: 0, right: 0 };
    chemistryState.set(player, state);
    sendChemistryState(player, state);
    const sender = player.getPacketSender();
    sender.sendInterface(CHEMISTRY_INTERFACE);
    sender.sendInterfaceScript(4517, [0, 100, 25]);
    sender.sendInterfaceScript(4518, [100, 100]);
  }

  function sendChemistryState(player, state) {
    const sender = player.getPacketSender();
    sender.sendVarbit(13863, state.left);
    sender.sendVarbit(13864, state.middle);
    sender.sendVarbit(13865, state.right);
  }

  function handleChemistryButton(event) {
    const { player } = event;
    const state = chemistryState.get(player);
    if (!state) return false;
    event.handled = true;
    const child = event.buttonId & 0xffff;
    if (child === 25) state.middle = Math.min(45, state.middle + 3);
    else if (child === 27) state.right = Math.min(45, state.right + 3);
    else if (child === 26) {
      state.left = Math.min(45, state.left + 3);
      state.middle = Math.max(0, state.middle - 3);
      state.right = Math.min(45, state.right + 3);
    } else if (child === 28) {
      state.left = Math.min(45, state.left + 3);
      state.right = Math.max(0, state.right - 3);
    }
    sendChemistryState(player, state);
    player.getPacketSender().sendInterfaceScript(4517, [0, 100, 25]);
    player.getPacketSender().sendInterfaceScript(4518, [100, 100]);
    if (state.left === CHEMISTRY_TARGET.left && state.middle === CHEMISTRY_TARGET.middle && state.right === CHEMISTRY_TARGET.right) {
      chemistryState.delete(player);
      player.getPacketSender().sendInterfaceRemoval();
      setStage(player, STAGE_CHEMISTRY_DONE);
      startTranscript(api, player, ZAHUR, PAGE, "cure-me-pox-warming-up-the-equipment");
    }
    return true;
  }

  /** Mirror the player to the tile past a blocking object tile. */
  function stepThrough(player, location) {
    if (!location) return;
    const current = player.getLocation();
    const dx = current.getX() - location.x;
    const dy = current.getY() - location.y;
    const destination =
      Math.abs(dx) >= Math.abs(dy)
        ? new Location(location.x - (dx >= 0 ? 1 : -1), location.y, current.getZ())
        : new Location(location.x, location.y - (dy >= 0 ? 1 : -1), current.getZ());
    player.moveTo(destination);
  }

  // ==========================================================================
  // Deaths
  // ==========================================================================

  function handleNpcDeath(event) {
    const { killer, npc } = event;
    if (!killer || !npc) return;
    const tracked = trackedNpcs.get(killer);
    if (!tracked) return;
    const stage = quest.getStage(killer);
    if (tracked.get("guard") === npc) {
      tracked.delete("guard");
      stopCamera(killer);
      if (stage === STAGE_GUARD_FIGHT) setStage(killer, STAGE_GUARD_DEFEATED);
      return;
    }
    if (tracked.get("mage1") === npc || tracked.get("mage2") === npc) {
      tracked.delete(tracked.get("mage1") === npc ? "mage1" : "mage2");
      if (!tracked.get("mage1") && !tracked.get("mage2") && stage === STAGE_TOMB_ENTERED) {
        setStage(killer, STAGE_MAGES_DEAD);
      }
      return;
    }
    if (tracked.get("champion") === npc) {
      tracked.delete("champion");
      if (stage === STAGE_CHAMPION_FIGHT || stage === STAGE_UPPER_OPEN) setStage(killer, STAGE_CHAMPION_DEAD);
      return;
    }
    if (tracked.get("akh") === npc) {
      tracked.delete("akh");
      stopCamera(killer);
      if (stage === STAGE_AKH_FIGHT) setStage(killer, STAGE_AKH_DEAD);
    }
  }

  // ==========================================================================
  // Lifecycle, journal, reward
  // ==========================================================================

  function handleLogin({ player }) {
    installTombLevers();
    syncNpcs(player);
    syncQuestVarbits(player);
    // Only resume a genuinely unfinished intro when physically inside the west arena;
    // stage 58 outside (e.g. 3432,9248) must re-enter through 43960 first.
    if (inChampionArena(player)) startChampionIntro(player);
  }

  function handleLogout({ player }) {
    stopCamera(player);
  }

  function handleBootstrap({ player }) {
    syncQuestVarbits(player);
  }

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      return [
        "<str>Jamila slipped me a message from Maisa and I met her camp</str>",
        "<str>east of Sophanem. Together we uncovered Amascut's plot.</str>",
        "<str>I freed the High Priest of Scabaras and helped Zahur cure</str>",
        "<str>the pox, then defeated the Menaphite Akh.</str>",
        "",
        "<col=ff0000>QUEST COMPLETE!</col>",
      ];
    }
    if (stage >= STAGE_FINALE) {
      return [
        "<str>Jamila slipped me a message from Maisa and I met her camp</str>",
        "<str>east of Sophanem. Together we uncovered Amascut's plot.</str>",
        "<str>I freed the High Priest of Scabaras and helped Zahur cure</str>",
        "<str>the pox, and delivered the cure to Sophanem.</str>",
        "",
        "I should speak to <col=800000>Maisa</col> at the necropolis.",
      ];
    }
    if (stage >= STAGE_NARDAH) {
      return [
        "<str>Jamila slipped me a message from Maisa and I met her camp</str>",
        "<str>east of Sophanem. Together we uncovered Amascut's plot.</str>",
        "",
        "I should help <col=800000>Zahur</col> in Nardah cure the pox.",
        stage >= STAGE_LILY_PICKED
          ? "I have the <col=800000>Lily of the Elid</col>; I should take it to Zahur."
          : "I need a <col=800000>Lily of the Elid</col> from the island west of Nardah.",
      ];
    }
    if (stage >= STAGE_PRIEST_FREED) {
      return [
        "<str>Jamila slipped me a message from Maisa and I met her camp</str>",
        "<str>east of Sophanem. Together we uncovered Amascut's plot.</str>",
        "<str>I freed the High Priest of Scabaras from Amascut's control.</str>",
        "",
        "He told me to meet <col=800000>Maisa</col> in <col=800000>Nardah</col>.",
      ];
    }
    if (stage >= STAGE_URN_PUZZLE) {
      return [
        "<str>Jamila slipped me a message from Maisa and I met her camp</str>",
        "<str>east of Sophanem. Together we uncovered Amascut's plot.</str>",
        "",
        "I should free the <col=800000>High Priest of Scabaras</col>",
        "from Amascut's control in the upper chamber.",
      ];
    }
    if (stage >= STAGE_RUINS) {
      return [
        "<str>Jamila slipped me a message from Maisa and I met her camp</str>",
        "<str>east of Sophanem. Together we uncovered Amascut's plot.</str>",
        "",
        "I should explore the <col=800000>Ruins of Ullek</col> east of the",
        "necropolis and find out what the scabarites are doing.",
      ];
    }
    if (stage >= STAGE_NECROPOLIS) {
      return [
        "<str>Jamila slipped me a message from Maisa and I met her camp</str>",
        "<str>east of Sophanem.</str>",
        "",
        "I should inspect the blocked entry at the necropolis and",
        "question a <col=800000>citizen</col> or <col=800000>guard</col>.",
      ];
    }
    if (stage >= STAGE_STARTED) {
      return [
        "<str>Jamila slipped me a message from Maisa.</str>",
        "",
        "I should read the <col=800000>message</col> and meet Maisa at",
        "her camp by the cliffs east of Sophanem.",
      ];
    }
    return [
      "I can start this quest by talking to <col=800000>Jamila</col>",
      "at her stall in <col=800000>Sophanem</col>.",
      "",
      "I must have completed Contact! and Icthlarin's Little Helper",
      "and have 62 Agility, 55 Crafting and 55 Firemaking.",
    ];
  }

  function grantReward(player) {
    player.getSkillManager().addExperiences(Skill.AGILITY, 50000);
  }

  // ==========================================================================
  // Registration
  // ==========================================================================

  api.persistAttribute(INTRO_ATTRIBUTE);
  api.persistAttribute(ENTRY_INSPECTED_ATTRIBUTE);
  api.persistAttribute(TABLET_FOUND_ATTRIBUTE, false);
  api.persistAttribute(TABLET_READ_ATTRIBUTE, false);
  api.persistAttribute(MOULD_FOUND_ATTRIBUTE, false);
  api.persistAttribute(TALKED_CITIZEN_ATTRIBUTE);
  api.persistAttribute(URNS_ATTRIBUTE);
  api.persistAttribute(LEVERS_ATTRIBUTE);
  api.persistAttribute(EMBLEMS_TAKEN_ATTRIBUTE);
  api.persistAttribute(OWED_PARTISAN_ATTRIBUTE);
  api.persistAttribute(OWED_CIRCLET_ATTRIBUTE);

  quest = registerQuest(api, {
    key: "beneath_cursed_sands",
    name: "Beneath Cursed Sands",
    varpId: 3421, // bcs_primary
    varbitId: 13841, // bcs, bits 0-8
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 2,
    xpRewards: [{ skillId: Skill.AGILITY.getIndex(), amount: 50000, label: "Agility" }],
    scrollItemId: KERIS_PARTISAN_ITEM,
    otherRewards: ["Keris partisan", "Circlet of water"],
    buildJournal,
    onReward: grantReward,
  });

  api.onObjectRoute(routeSteppingStones);
  api.onNpcInteraction((event) => {
    if (!event?.player || !BCS_NECROPOLIS_CITIZEN_IDS.has(event.npcId)) return;
    const definition = event.definition ?? api.core.NpcDefinition.forId(event.npcId);
    const action = String(definition?.getActions?.()?.[event.clickType - 1] ?? "");
    if (action.toLowerCase() !== "talk-to") return;
    const variant = selectCitizenVariant(quest.getStage(event.player));
    if (!variant) return;
    event.handled = true;
    startTranscript(api, event.player, CITIZEN, PAGE, variant);
  });
  api.onNpcInteraction(handleOsmanTalk);
  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:hook", handleHook);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onCustomEvent("npc-dialogue:line", handleLine);
  api.onCustomEvent("door:toggle", claimQuestDoor);
  api.onItemAction(handleItemAction);
  api.onItemOnObject(handleItemOnObject, { noted: false });
  api.onObjectInteraction(handleObjectInteraction);
  api.onInterfaceActionButton(CHEMISTRY_BUTTONS, handleChemistryButton);
  api.onInterfaceActionButton(PILLAR_BUTTONS, handlePillarButton);
  api.onNpcDeath(handleNpcDeath);
  api.onPlayerLogin(handleLogin);
  api.onPlayerLogout(handleLogout);
  api.onCustomEvent("player:bootstrap-complete", handleBootstrap);
};
