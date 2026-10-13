/**
 * Sins of the Father (members, Myreque #5).
 *
 * The words come from the "Sins of the Father" transcript page; this plugin
 * supplies the variant selection for the quest's cast, the prose-condition
 * answers, the start hook, the Slepe Sleeper Plague investigation (Hameln,
 * Carl's barrel, the eavesdrop and the Kroy fight), the Paterdomus/Haunted
 * Woods meeting, the Ivan escort, the Icyene Graveyard mausoleum puzzle, the
 * Myreque convincing, the Meiyerditch laboratory (mutated bloodveld and
 * Haemalchemy volume 2), the vyre noble disguise chain (Trader Sven, Polmafi,
 * Damien Leucurte), Darkmeyer (Desmodus, Mordan Nikazsi, the Gadderanks prison
 * scene), the Blisterwood Arboretum valve/logs puzzle, the blisterwood weapon
 * crafting and the Vanstrom Klause finale, plus the completion reward and
 * post-quest unlocks (boat travel, tome recovery, the medallion's Darkmeyer
 * destination once this quest is done, and the XP tome's six chapters).
 *
 * Stages (varbit 7255 "myq5" in varp 2712 "myq5", bits 0-8; cache evidence:
 * `scripts/lookup-gameval.ts varbit myq5`): 0 unstarted, 10 Veliaf briefed,
 * 20 Hameln told (pub lead), 30 following Carl, 40 Kroy fight, 50 Kroy dead,
 * 60 lab tables destroyed, 70 reported to Veliaf (go Paterdomus),
 * 80 Paterdomus briefed (meet Ivan), 90 meeting watched (escort),
 * 100 escorting Ivan, 110 Ivan delivered to Burgh de Rott, 115 boathouse
 * briefed, 120 arrived Icyene Graveyard (meeting), 125 Vanescula
 * (mausoleum), 127 puzzle solved, 130 convincing the Myreque,
 * 140 all convinced (weapons plan), 145 go to the laboratory,
 * 150 bloodveld killed, 152 Safalaan after the fight, 155 book found,
 * 160 book given (back to graveyard), 165 disguise briefing (Polmafi),
 * 170 Damien confrontation, 180 Damien dead (disguise scented),
 * 185 Vanescula (enter Darkmeyer), 190 Desmodus task, 195 Mordan found,
 * 200 prison, 205 slaves handled, 210 Arboretum open, 220 eight logs,
 * 230 logs delivered, 240 seven logs to Vertida (crafting), 245 crafting,
 * 250 flail made (back to graveyard), 260 Safalaan returns, 270 Castle
 * Drakan (Vanstrom fight), 280 Vanstrom dead, 300 complete.
 * The quest's own sub-bits live in one persisted attribute
 * "quest.sins_of_the_father.bits" and key ones are mirrored to the cache's
 * varbits (10347-10351 convinced, 10353/10354 Kroy tables, 10359 Trader Sven
 * met, 10365 puzzle, 13719 lab unlocked).
 *
 * Source: OSRS Wiki "Sins of the Father", its Quick guide and
 * Transcript:Sins of the Father; the cache for every id, varbit and
 * placement (lookup-gameval.ts / dump:loc); the wiki location infoboxes for
 * NPC tiles.
 *
 * Gaps / approximations:
 * - The skill requirements (62 Woodcutting, 60 Fletching, 56 Crafting,
 *   52 Agility, 50 Attack, 50 Slayer, 49 Magic) gate the start, plus A Taste
 *   of Hope completion; the warning for a low combat level is computed from
 *   the skill levels.
 * - The Carl follow minigame is approximated: inspecting the barrel starts
 *   the follow and the eavesdropping cutscene plays from the church crypt
 *   stairs. Kroy has no potion-throw; the tables are installed at runtime and
 *   swapped when destroyed (world-global, as In Aid's repairs).
 * - The Ivan escort is a scripted trek in Mort Myre (three vines -> long vine
 *   -> swing, two nail beasts, two juvinates) with no fail state; the bridge
 *   repair is a flavour line. There is no instance.
 * - The mausoleum lock is deterministic: Unlock plays the conversation and the
 *   second Unlock solves it, instead of the Kakurasu grid.
 * - Darkmeyer's bank/shop/attack gating (the newcomers transcripts) and the
 *   Daeyalt mine/Hallowed Sepulchre entrances are not wired; the Cracked wall
 *   is bidirectional and gates entry until Vanescula sends you.
 * - The finale is not instanced: Vanescula teleports the group to the castle
 *   grounds tile, Vanstrom spawns with his real combat stats (9569) but
 *   without his phase-two lightning/heal mechanics, and the Safalaan
 *   power/escape cutscene plays on NPC chatheads.
 * - Damien's fires and the medallion's destination UI belong to A Taste of
 *   Hope; this plugin only answers the medallion once this quest is complete.
 */
module.exports = function registerSinsOfTheFatherQuest(api) {
  const {
    Skill,
    Location,
    Equipment,
    ItemDefinition,
    ItemIdentifiers,
    NpcIdentifiers,
    ObjectManager,
    GameObject,
  } = api.core;
  const { registerQuest, startTranscript, startDialogue, refreshQuestList } = require("../QuestRuntime");

  const PAGE = "Sins of the Father";
  const START_HOOK = "quest:sins-of-the-father:start";
  const PREREQUISITE_KEY = "taste_of_hope";
  const BITS_ATTRIBUTE = "quest.sins_of_the_father.bits";
  const TOME_USES_ATTRIBUTE = "quest.sins_of_the_father.tome-chapters";
  const VAMPYRE_NAME_ATTRIBUTE = "quest.sins_of_the_father.vampyre-name";
  const TOME_MAX_CHAPTERS = 6;

  // Vanescula gives the player a fake vyre name (OSRS Wiki "Vampyric name") used
  // by the wiki's "[vampyre name]" transcript blanks.
  const VAMPYRE_FIRST_NAMES = [
    "Anaric", "Balnar", "Carnivar", "Dracona", "Epsenti", "Haemar", "Kaerin", "Leardin",
    "Molark", "Morytan", "Noctil", "Remian", "Rumelo", "Sanguinak", "Vanpyrus", "Varniprus",
  ];
  const VAMPYRE_LAST_NAMES = [
    "Caermoran", "Caernivus", "Constantine", "Diaemus", "Draskarin", "Helsing", "Jargarin",
    "Kardava", "Lasarin", "Lugosi", "Mortabel", "Nightshade", "Rasputin", "Sanguine",
    "von Pitt", "von Tyn",
  ];

  // ---------------------------------------------------------------------------
  // Stage ladder (varbit 7255, varp 2712)
  // ---------------------------------------------------------------------------

  const STAGE_UNSTARTED = 0;
  const STAGE_STARTED = 10;
  const STAGE_HAMELN = 20;
  const STAGE_FOLLOWING = 30;
  const STAGE_KROY_FIGHT = 40;
  const STAGE_KROY_DEAD = 50;
  const STAGE_LAB_DESTROYED = 60;
  const STAGE_VELIAF_REPORTED = 70;
  const STAGE_PATERDOMUS = 80;
  const STAGE_MEETING = 90;
  const STAGE_ESCORT = 100;
  const STAGE_ESCORT_DONE = 110;
  const STAGE_BOATHOUSE = 115;
  const STAGE_GRAVEYARD = 120;
  const STAGE_MUSEUM_TALK = 125;
  const STAGE_PUZZLE_DONE = 127;
  const STAGE_CONVINCING = 130;
  const STAGE_CONVINCED = 140;
  const STAGE_LAB_PLAN = 145;
  const STAGE_BLOODVELD = 150;
  const STAGE_BLOODVELD_TALK = 152;
  const STAGE_LAB_BOOK = 155;
  const STAGE_LAB_DONE = 160;
  const STAGE_DISGUISE_BRIEF = 165;
  const STAGE_DISGUISE_READY = 170;
  const STAGE_DAMIEN_DONE = 180;
  const STAGE_DARKMEYER_PLAN = 185;
  const STAGE_DARKMEYER = 190;
  const STAGE_MORDAN = 195;
  const STAGE_PRISON = 200;
  const STAGE_SLAVES_DONE = 205;
  const STAGE_ARBORETUM = 210;
  const STAGE_LOGS = 220;
  const STAGE_LOGS_GIVEN = 230;
  const STAGE_VERTIDA_LOGS = 240;
  const STAGE_CRAFTING = 245;
  const STAGE_FLAIL = 250;
  const STAGE_SAFALAAN_WALK = 260;
  const STAGE_READY = 265;
  const STAGE_CASTLE = 270;
  const STAGE_VANSTROM_DEAD = 280;
  const STAGE_COMPLETE = 300;

  // Cache sub-varbits of varp 2712 mirrored so the cache's own scripts follow.
  const VARBIT_KAEL_CONVINCED = 10347;
  const VARBIT_VERTIDA_CONVINCED = 10348;
  const VARBIT_IVAN_CONVINCED = 10349;
  const VARBIT_POLMAFI_CONVINCED = 10350;
  const VARBIT_RADIGAD_CONVINCED = 10351;
  const VARBIT_KROY_TABLE_1 = 10353;
  const VARBIT_KROY_TABLE_2 = 10354;
  const VARBIT_TRADER_SVEN_MET = 10359;
  const VARBIT_PUZZLE_COMPLETED = 10365;
  const VARBIT_LAB_UNLOCKED = 13719;

  const BIT_KAEL = 1 << 0;
  const BIT_VERTIDA = 1 << 1;
  const BIT_IVAN = 1 << 2;
  const BIT_POLMAFI = 1 << 3;
  const BIT_RADIGAD = 1 << 4;
  const BIT_VELIAF_ASKED = 1 << 5;
  const BIT_CARL_ASKED = 1 << 6;
  const BIT_TABLE_1 = 1 << 7;
  const BIT_TABLE_2 = 1 << 8;
  const BIT_TRAIL = 1 << 9; // following Carl / Kroy fight started
  const BIT_DAMIEN = 1 << 10; // Damien fight started
  const BIT_VANSTROM = 1 << 11; // Vanstrom fight started
  const BIT_PUZZLE_PLAYED = 1 << 12; // the mausoleum lock conversation seen
  const BIT_TREK = 1 << 13; // escort crossed the bog
  const BIT_SVEN = 1 << 14; // bought from Trader Sven
  const CONVINCED_MASK = BIT_KAEL | BIT_VERTIDA | BIT_IVAN | BIT_POLMAFI | BIT_RADIGAD;
  // 2-bit fields for the escort kill counts and the 3-bit valve fields.
  const NAIL_SHIFT = 16;
  const JUVI_SHIFT = 18;
  const VALVE_NORTH_SHIFT = 20;
  const VALVE_SOUTH_SHIFT = 23;
  const GALLONS_SHIFT = 26; // 6 bits (0-63)

  // ---------------------------------------------------------------------------
  // NPCs
  // ---------------------------------------------------------------------------

  const VELIAF_IDS = new Set([
    NpcIdentifiers.VELIAF_HURTZ, // 989
    NpcIdentifiers.VELIAF_HURTZ_2, // 5048
    15879,
    15885,
  ]);
  const SAFALAAN_IDS = new Set([
    NpcIdentifiers.SAFALAAN_HALLOW, // 3775
    NpcIdentifiers.SAFALAAN_HALLOW_2, // 8216
    NpcIdentifiers.SAFALAAN_HALLOW_5, // 8219
    15893,
    15894,
  ]);
  const VANESCULA_IDS = new Set([
    NpcIdentifiers.VANESCULA_DRAKAN, // 3740
    9574, // myq5 human, Talk-to
  ]);
  const VERTIDA_IDS = new Set([
    NpcIdentifiers.VERTIDA_SEFALATIS, // 8220
    NpcIdentifiers.VERTIDA_SEFALATIS_3, // 8222
  ]);
  const KAEL_IDS = new Set([NpcIdentifiers.KAEL_FORSHAW, NpcIdentifiers.KAEL_FORSHAW_2]); // 8230/8231
  const RADIGAD_IDS = new Set([NpcIdentifiers.RADIGAD_PONFIT]); // 5051
  const POLMAFI_IDS = new Set([NpcIdentifiers.POLMAFI_FERDYGRIS]); // 5052
  const IVAN_IDS = new Set([
    NpcIdentifiers.IVAN_STROM, // 4440
    NpcIdentifiers.IVAN_STROM_2, // 4441
    NpcIdentifiers.IVAN_STROM_3, // 5053
    NpcIdentifiers.IVAN_STROM_5, // 9531
    NpcIdentifiers.IVAN_STROM_10, // 9536 (escort)
  ]);
  const DREZEL_IDS = new Set([NpcIdentifiers.DREZEL]); // 9636
  const HAMELN_IDS = new Set([NpcIdentifiers.HAMELN_THE_JESTER_2]); // 9505 (Talk-to)
  const CARL_IDS = new Set([9767]); // slepe Carl with Talk-to
  const MARIA_IDS = new Set([NpcIdentifiers.MARIA_GADDERANKS]); // 9594
  const DESMODUS_IDS = new Set([NpcIdentifiers.DESMODUS_LASIURUS]); // 9588 (world)
  const MORDAN_IDS = new Set([NpcIdentifiers.MORDAN_NIKAZSI]); // 9589 (world)

  const VELIAF_ID = NpcIdentifiers.VELIAF_HURTZ_2; // 5048
  const SAFALAAN_ID = NpcIdentifiers.SAFALAAN_HALLOW_2; // 8216
  const VANESCULA_ID = 9574;
  const VERTIDA_ID = NpcIdentifiers.VERTIDA_SEFALATIS; // 8220
  const KAEL_ID = NpcIdentifiers.KAEL_FORSHAW; // 8230
  const RADIGAD_ID = NpcIdentifiers.RADIGAD_PONFIT; // 5051
  const POLMAFI_ID = NpcIdentifiers.POLMAFI_FERDYGRIS; // 5052
  const IVAN_ID = NpcIdentifiers.IVAN_STROM; // 4440
  const IVAN_ESCORT_ID = NpcIdentifiers.IVAN_STROM_10; // 9536
  const DREZEL_ID = NpcIdentifiers.DREZEL; // 9636
  const HAMELN_ID = NpcIdentifiers.HAMELN_THE_JESTER_2; // 9505
  const CARL_ID = 9767;
  const MARIA_ID = NpcIdentifiers.MARIA_GADDERANKS; // 9594
  const KROY_FIGHT_ID = NpcIdentifiers.KROY_2; // 9560 (lvl 133)
  const DAMIEN_FIGHT_ID = NpcIdentifiers.DAMIEN_LEUCURTE_4; // 9564 (lvl 204)
  const VANSTROM_FIGHT_ID = NpcIdentifiers.VANSTROM_KLAUSE_15; // 9569 (lvl 459)
  const BLOODVELD_ID = 9611; // myq5 mutated bloodveld
  const NAIL_BEAST_IDS = [9612, 9613]; // myq5 nail beasts (lvl 69/141)
  const JUVI_IDS = [9614, 9615]; // myq5 trek juvinates
  const PROP_ID = CARL_ID;

  // Every NPC this quest spawns owner-only: used to sweep ghosts left by an
  // unclean disconnect, where the old player object (same username) never ran
  // the logout hook and its owner-only spawns stayed in the world unseen.
  const SPAWNED_NPC_IDS = new Set([
    VELIAF_ID, SAFALAAN_ID, VANESCULA_ID, VERTIDA_ID, KAEL_ID, RADIGAD_ID, POLMAFI_ID,
    IVAN_ID, IVAN_ESCORT_ID, DREZEL_ID, HAMELN_ID, CARL_ID, MARIA_ID,
    KROY_FIGHT_ID, DAMIEN_FIGHT_ID, VANSTROM_FIGHT_ID, BLOODVELD_ID,
    ...NAIL_BEAST_IDS, ...JUVI_IDS,
  ]);

  // ---------------------------------------------------------------------------
  // Items
  // ---------------------------------------------------------------------------

  const IVANDIS_FLAIL_ITEM_ID = ItemIdentifiers.IVANDIS_FLAIL; // 22398
  const DRAKANS_MEDALLION_ITEM_ID = ItemIdentifiers.DRAKANS_MEDALLION; // 22400
  const RUBY_ITEM_ID = ItemIdentifiers.RUBY; // 1603
  const KNIFE_ITEM_ID = ItemIdentifiers.KNIFE; // 946
  const CHISEL_ITEM_ID = ItemIdentifiers.CHISEL; // 1755
  const COSMIC_RUNE_ITEM_ID = ItemIdentifiers.COSMIC_RUNE; // 564
  const FIRE_RUNE_ITEM_ID = ItemIdentifiers.FIRE_RUNE; // 554
  const SILVER_SICKLE_BLESSED_ITEM_ID = ItemIdentifiers.SILVER_SICKLE_B_; // 2963
  const VYREWATCH_ITEM_IDS = [
    ItemIdentifiers.VYREWATCH_TOP, // 9634
    ItemIdentifiers.VYREWATCH_LEGS, // 9636
    ItemIdentifiers.VYREWATCH_SHOES, // 9638
  ];
  const VYRE_NOBLE_UNSCENTED_IDS = [
    ItemIdentifiers.VYRE_NOBLE_TOP_UNSCENTED_, // 24673
    ItemIdentifiers.VYRE_NOBLE_LEGS_UNSCENTED_, // 24674
    ItemIdentifiers.VYRE_NOBLE_SHOES_UNSCENTED_, // 24675
  ];
  const VYRE_NOBLE_SCENTED_IDS = [
    ItemIdentifiers.VYRE_NOBLE_TOP, // 24676
    ItemIdentifiers.VYRE_NOBLE_LEGS, // 24678
    ItemIdentifiers.VYRE_NOBLE_SHOES, // 24680
  ];
  const HAEMALCHEMY_VOL_2_ITEM_ID = ItemIdentifiers.HAEMALCHEMY_VOLUME_2; // 24672
  const OLD_NOTE_ITEM_ID = 24682; // myq5 arboretum note
  const BLISTERWOOD_LOGS_ITEM_ID = ItemIdentifiers.BLISTERWOOD_LOGS; // 24691
  const RUBY_SICKLE_ITEM_ID = ItemIdentifiers.RUBY_SICKLE_B_; // 24693
  const ENCHANTED_RUBY_SICKLE_ITEM_ID = 24695; // myq5 enchanted ruby sickle (b)
  const BLISTERWOOD_SICKLE_ITEM_ID = ItemIdentifiers.BLISTERWOOD_SICKLE; // 24697
  const BLISTERWOOD_FLAIL_ITEM_ID = ItemIdentifiers.BLISTERWOOD_FLAIL; // 24699
  const ENCHANTED_EMERALD_SICKLE_ITEM_ID = ItemIdentifiers.ENCHANTED_EMERALD_SICKLE_B_; // 22435
  const TOME_ITEM_ID = 24690; // myq5 xp tome
  const LONG_VINE_ITEM_ID = 7777; // temple trekking long vine

  // ---------------------------------------------------------------------------
  // Objects (cache ids; names are the cache's own)
  // ---------------------------------------------------------------------------

  const BARREL_OBJECT_ID = 37980; // "Barrel" Inspect (installed over 39515 at Slepe)
  const KROY_TABLE_OP_OBJECT_ID = 37983; // "Lab table" Destroy
  const KROY_TABLE_BROKEN_OBJECT_ID = 37984; // "Broken table"
  const MAUSOLEUM_DOOR_UNLOCK_OBJECT_ID = 38070; // "Mausoleum door" Unlock
  const MAUSOLEUM_DOOR_OPEN_OBJECT_ID = 38071; // "Mausoleum door" Open
  const CRYPT_STAIRS_OBJECT_ID = 32637; // "Stairs" Climb-down at the Slepe church
  const LAB_BOOKSHELF_OBJECT_ID = 38017; // "Bookshelf" Search (vol 2)
  const ARBORETUM_TREE_OBJECT_ID = 37989; // "Blisterwood tree" Chop
  const ARBORETUM_SHELVES_OBJECT_ID = 37999; // "Shelves" Search (old note)
  const VALVE_NORTH_OBJECT_ID = 37997; // "Valve" Turn (+7)
  const VALVE_SOUTH_OBJECT_ID = 37998; // "Valve" Turn (+4)
  const ARBORETUM_DOOR_IDS = new Set([39251, 39253]); // "Large door" Open
  const CRACKED_WALL_OBJECT_ID = 39170; // "Cracked wall" Enter
  const BOAT_OBJECT_ID = 38089; // "Boat" Board (installed at both docks)
  const SWAMP_TREE_OBJECT_ID = 38005; // "Swamp tree branch" Swing-from
  const HIDEOUT_CRATE_OBJECT_ID = 17987; // "Crate" Search (silver sickle (b))
  const LAB_ESCAPE_GATE_ID = 37992; // "Gate" Escape (Kroy's lab)

  // ---------------------------------------------------------------------------
  // Tiles
  // ---------------------------------------------------------------------------

  const VELIAF_SLEPE_TILE = { x: 3729, y: 3318, z: 0 };
  const HAMELN_CHURCH_TILE = { x: 3736, y: 3316, z: 0 };
  const CARL_PUB_TILE = { x: 3749, y: 3298, z: 0 };
  const BARREL_TILE = { x: 3749, y: 3291, z: 0 };
  const CRYPT_LANDING = { x: 3738, y: 9700, z: 1 };
  const KROY_LAB_TILE = { x: 3727, y: 9759, z: 1 };
  const KROY_TABLE_TILES = [
    { x: 3729, y: 9760, z: 1, rotation: 0 },
    { x: 3725, y: 9759, z: 1, rotation: 3 },
  ];
  const DREZEL_TEMPLE_TILE = { x: 3439, y: 9896, z: 0 };
  const VELIAF_PATERDOMUS_TILE = { x: 3440, y: 9897, z: 0 };
  const IVAN_MEETING_TILE = { x: 3548, y: 3516, z: 0 };
  const VELIAF_WOODS_TILE = { x: 3549, y: 3517, z: 0 };
  const IVAN_TREK_TILE = { x: 3444, y: 3485, z: 0 };
  const TREK_START = { x: 3445, y: 3412, z: 0 };
  const TREK_TREE_TILE = { x: 3442, y: 3408, z: 0 };
  const TREK_CROSSED = { x: 3437, y: 3402, z: 0 };
  const TREK_NAIL_TILES = [
    { x: 3433, y: 3398, z: 0 },
    { x: 3431, y: 3396, z: 0 },
  ];
  const TREK_JUVI_TILES = [
    { x: 3426, y: 3390, z: 0 },
    { x: 3424, y: 3388, z: 0 },
  ];
  const BURGH_DOCKS = { x: 3523, y: 3169, z: 0 };
  const IVAN_BOATHOUSE_TILE = { x: 3530, y: 3169, z: 0 };
  const VELIAF_BOATHOUSE_TILE = { x: 3529, y: 3168, z: 0 };
  const ICYENE_DOCK = { x: 3696, y: 3198, z: 0 };
  const GRAVEYARD_VELIAF_TILE = { x: 3689, y: 3182, z: 0 };
  const GRAVEYARD_SAFALAAN_TILE = { x: 3707, y: 3186, z: 0 };
  const GRAVEYARD_VANESCULA_TILE = { x: 3705, y: 3189, z: 0 };
  const GRAVEYARD_VERTIDA_TILE = { x: 3697, y: 3186, z: 0 };
  const GRAVEYARD_KAEL_TILE = { x: 3686, y: 3186, z: 0 };
  const GRAVEYARD_RADIGAD_TILE = { x: 3690, y: 3189, z: 0 };
  const GRAVEYARD_POLMAFI_TILE = { x: 3705, y: 3182, z: 0 };
  const GRAVEYARD_IVAN_TILE = { x: 3696, y: 3181, z: 0 };
  const MAUSOLEUM_DOOR_TILE = { x: 3704, y: 3190, z: 0, rotation: 3 };
  const MAUSOLEUM_INSIDE = { x: 3704, y: 3192, z: 0 };
  const SAFALAAN_WALK_TILE = { x: 3696, y: 3204, z: 0 };
  const HIDEOUT_VERTIDA_TILE = { x: 3629, y: 9643, z: 0 };
  const HIDEOUT_POLMAFI_TILE = { x: 3601, y: 9612, z: 0 };
  const LAB_SAFALAAN_TILE = { x: 3611, y: 9737, z: 0 };
  const LAB_BLOODVELD_TILE = { x: 3600, y: 9740, z: 0 };
  const DAMIEN_MANOR_TILE = { x: 3718, y: 3358, z: 1 };
  const PRISON_MARIA_TILE = { x: 3618, y: 3377, z: 0 };
  const DARKMEYER_ARRIVAL = { x: 3627, y: 3332, z: 0 };
  const CRACK_MEIYERDITCH = { x: 3627, y: 3328, z: 0 };
  const CASTLE_ARENA = { x: 3565, y: 3362, z: 0 };
  const BURGH_HIDEOUT = { x: 3494, y: 9628, z: 0 };
  const VER_SINHAZA = { x: 3663, y: 3220, z: 0 };
  const DARKMEYER = { x: 3597, y: 3360, z: 0 };
  const SLEPE_DOCK = { x: 3665, y: 3279, z: 0 };

  // ---------------------------------------------------------------------------
  // Persisted state helpers
  // ---------------------------------------------------------------------------

  let quest;
  const spawnedByPlayer = new Map();
  const installedObjects = [];
  let objectsInstalled = false;

  const held = (player, itemId, amount = 1) => player.getInventory().getAmount(itemId) >= amount;

  function freeSlots(player) {
    const inventory = player.getInventory();
    return typeof inventory.getFreeSlots === "function" ? inventory.getFreeSlots() : inventory.isFull() ? 0 : 28;
  }

  function give(player, itemId, amount = 1) {
    if (amount <= 0) return true;
    if (freeSlots(player) < 1) {
      player.sendMessage("You don't have enough inventory space.");
      return false;
    }
    player.getInventory().adds(itemId, amount);
    return true;
  }

  function bits(player) {
    return Number(player.getAttribute(BITS_ATTRIBUTE)) || 0;
  }

  function hasBit(player, bit) {
    return (bits(player) & bit) !== 0;
  }

  function setBit(player, bit) {
    if (hasBit(player, bit)) return;
    player.setAttribute(BITS_ATTRIBUTE, bits(player) | bit);
  }

  function field(player, shift, width = 2) {
    return (bits(player) >> shift) & ((1 << width) - 1);
  }

  function setField(player, shift, width, value) {
    const mask = ((1 << width) - 1) << shift;
    player.setAttribute(BITS_ATTRIBUTE, (bits(player) & ~mask) | ((value & ((1 << width) - 1)) << shift));
  }

  function convincedMask(player) {
    return bits(player) & CONVINCED_MASK;
  }

  /** Sets a Myreque member's convinced bit and re-sends its cache varbit mirror. */
  function setConvinced(player, bit) {
    setBit(player, bit);
    syncVisuals(player);
  }

  const allConvinced = (player) => convincedMask(player) === CONVINCED_MASK;

  function near(player, spot, radius = 8) {
    const location = player.getLocation();
    return Math.max(Math.abs(location.getX() - spot.x), Math.abs(location.getY() - spot.y)) <= radius;
  }

  function teleport(player, tile) {
    player.moveTo(new Location(tile.x, tile.y, tile.z));
  }

  function later(player, ticks, fn) {
    const { CountdownTask, TaskManager } = api.core;
    if (!CountdownTask || !TaskManager) {
      fn();
      return;
    }
    TaskManager.submit(
      new CountdownTask(player, ticks, () => {
        if (player.isRegistered?.() === false) return;
        fn();
      })
    );
  }

  /** A standalone transcript replay can lead with a wiki navigation jump; skip it. */
  function withoutLeadingJumps(steps) {
    if (!Array.isArray(steps)) return steps;
    let start = 0;
    while (start < steps.length && steps[start]?.type === "jump") start++;
    return start > 0 ? steps.slice(start) : steps;
  }

  function play(player, npcId, variant) {
    return startTranscript(api, player, npcId, PAGE, variant, withoutLeadingJumps);
  }

  function say(player, npcId, text) {
    startDialogue(api, player, { npcId }, [{ npc: [text] }]);
  }

  // The wiki transcript leaves three blanks the data export kept literal.
  function vampyreName(player) {
    const stored = player.getAttribute(VAMPYRE_NAME_ATTRIBUTE);
    if (typeof stored === "string" && stored.length > 0) return stored;
    const pick = (list) => list[Math.floor(Math.random() * list.length)];
    const name = `${pick(VAMPYRE_FIRST_NAMES)} ${pick(VAMPYRE_LAST_NAMES)}`;
    player.setAttribute(VAMPYRE_NAME_ATTRIBUTE, name);
    return name;
  }

  function fillTranscriptText(event) {
    const { player } = event;
    if (!player || typeof event.text !== "string") return;
    let text = event.text;
    if (text.includes("[vampyre name]")) {
      text = text.replace(/\[vampyre name\]/gi, vampyreName(player));
    }
    if (text.includes("[does he/does she/do they]")) {
      const male = player.getAppearance?.()?.isMale?.() !== false;
      text = text.replace(/\[does he\/does she\/do they\]/gi, male ? "does he" : "does she");
    }
    if (text.includes("[He/She/They]")) {
      const male = player.getAppearance?.()?.isMale?.() !== false;
      text = text.replace(/\[He\/She\/They\]/g, male ? "He" : "She");
    }
    event.text = text;
  }

  // ---------------------------------------------------------------------------
  // Requirements
  // ---------------------------------------------------------------------------

  const REQUIRED_QUESTS = [{ key: PREREQUISITE_KEY, name: "A Taste of Hope" }];
  const REQUIRED_SKILLS = [
    { skill: Skill.WOODCUTTING, level: 62, label: "Woodcutting" },
    { skill: Skill.FLETCHING, level: 60, label: "Fletching" },
    { skill: Skill.CRAFTING, level: 56, label: "Crafting" },
    { skill: Skill.AGILITY, level: 52, label: "Agility" },
    { skill: Skill.ATTACK, level: 50, label: "Attack" },
    { skill: Skill.SLAYER, level: 50, label: "Slayer" },
    { skill: Skill.MAGIC, level: 49, label: "Magic" },
  ];

  function questComplete(player, key) {
    const request = { player, key, complete: null };
    api.emitCustomEvent("quest:is-complete", request);
    return request.complete === true;
  }

  function meetsRequirements(player) {
    if (!questComplete(player, PREREQUISITE_KEY)) return false;
    const skills = player.getSkillManager();
    return REQUIRED_SKILLS.every((entry) => skills.getMaxLevel(entry.skill) >= entry.level);
  }

  function requirementsMessage(player) {
    for (const requirement of REQUIRED_QUESTS) {
      if (!questComplete(player, requirement.key)) {
        player.sendMessage(`You must have completed ${requirement.name} to start this quest.`);
      }
    }
    const skills = player.getSkillManager();
    for (const entry of REQUIRED_SKILLS) {
      if (skills.getMaxLevel(entry.skill) < entry.level) {
        player.sendMessage(`You need ${entry.level} ${entry.label} to start this quest.`);
      }
    }
  }

  function combatLevel(player) {
    const skills = player.getSkillManager();
    const level = (skill) => skills.getMaxLevel(skill);
    const base = 0.25 * (level(Skill.DEFENCE) + level(Skill.HITPOINTS) + Math.floor(level(Skill.PRAYER) / 2));
    const melee = 0.325 * (level(Skill.ATTACK) + level(Skill.STRENGTH));
    const ranged = 0.325 * Math.floor(level(Skill.RANGED) * 1.5);
    const magic = 0.325 * Math.floor(level(Skill.MAGIC) * 1.5);
    return Math.floor(base + Math.max(melee, ranged, magic));
  }

  // ---------------------------------------------------------------------------
  // Inventory helpers
  // ---------------------------------------------------------------------------

  const hasVyreNoble = (player) =>
    VYRE_NOBLE_UNSCENTED_IDS.some((id) => held(player, id)) || VYRE_NOBLE_SCENTED_IDS.some((id) => held(player, id));
  const hasVyrewatchOutfit = (player) => VYREWATCH_ITEM_IDS.some((id) => held(player, id));
  const hasBlisterwoodFlail = (player) => held(player, BLISTERWOOD_FLAIL_ITEM_ID);
  const logCount = (player) => player.getInventory().getAmount(BLISTERWOOD_LOGS_ITEM_ID);

  function isAxe(itemId) {
    const name = String(ItemDefinition.forId(itemId)?.getName?.() ?? "");
    return /(^| )axe$/i.test(name);
  }

  function hasAxe(player) {
    const inventory = player.getInventory();
    for (let slot = 0; slot < 28; slot++) {
      const item = inventory.get(slot);
      if (item && isAxe(item.getId())) return true;
    }
    const weapon = player.getEquipment().get(Equipment.WEAPON_SLOT);
    return Boolean(weapon && isAxe(weapon.getId()));
  }

  function swapOutfit(player, fromIds, toIds) {
    for (const id of fromIds) {
      while (player.getInventory().getAmount(id) > 0) player.getInventory().deleteNumber(id, 1);
    }
    for (const id of toIds) give(player, id, 1);
  }

  function requiredGallons(player) {
    const stored = field(player, GALLONS_SHIFT, 6);
    if (stored > 0) return stored;
    const north = Math.floor(Math.random() * 6);
    const south = Math.floor(Math.random() * 6);
    const gallons = 7 * north + 4 * south || 4;
    setField(player, GALLONS_SHIFT, 6, gallons);
    return gallons;
  }

  function waterTotal(player) {
    return 7 * field(player, VALVE_NORTH_SHIFT, 3) + 4 * field(player, VALVE_SOUTH_SHIFT, 3);
  }

  // ---------------------------------------------------------------------------
  // Owner-only spawns
  // ---------------------------------------------------------------------------

  function spawnKey(player, key, npcId, tile) {
    if (!player || player.isPlayerBot?.() === true) return;
    let map = spawnedByPlayer.get(player);
    if (!map) {
      map = new Map();
      spawnedByPlayer.set(player, map);
    }
    const existing = map.get(key);
    if (existing) {
      if (
        existing.getId?.() === npcId &&
        existing.getLocation?.().equals?.(new Location(tile.x, tile.y, tile.z))
      ) {
        return;
      }
      api.removeNpc(existing);
      map.delete(key);
    }
    const npc = api.spawnNpc({
      id: npcId,
      x: tile.x,
      y: tile.y,
      z: tile.z,
      wanderRadius: 0,
      owner: player,
      ownerOnly: true,
    });
    if (npc) map.set(key, npc);
  }

  function despawnKey(player, key) {
    const map = spawnedByPlayer.get(player);
    const npc = map?.get(key);
    if (!npc) return;
    api.removeNpc(npc);
    map.delete(key);
  }

  function despawnAll(player) {
    const map = spawnedByPlayer.get(player);
    if (!map) return;
    for (const npc of map.values()) api.removeNpc(npc);
    map.clear();
    spawnedByPlayer.delete(player);
  }

  /**
   * A force-dropped session never runs the logout hook, so its owner-only spawns
   * survive into the next login as invisible-duplicate NPCs for the same account.
   * Login sweeps any of this quest's owner-only NPCs held by another object with
   * the same username before respawning.
   */
  function sweepStaleOwnedNpcs(player) {
    const username = String(player.getUsername?.() ?? "").toLowerCase();
    if (!username) return;
    const World = api.core.World;
    if (typeof World?.getNpcs !== "function") return;
    for (const npc of World.getNpcs()) {
      if (!npc || npc.isOwnerOnly?.() !== true || !SPAWNED_NPC_IDS.has(npc.getId?.())) continue;
      const owner = npc.getOwner?.();
      if (!owner || owner === player) continue;
      if (String(owner.getUsername?.() ?? "").toLowerCase() !== username) continue;
      api.removeNpc(npc);
    }
  }

  function spawnAt(player, key, npcId, tile, from, to) {
    const stage = quest.getStage(player);
    if (stage >= from && stage < to) spawnKey(player, key, npcId, tile);
    else despawnKey(player, key);
  }

  /** Keeps exactly the quest NPCs the current stage needs present. */
  function applyStageSpawns(player) {
    if (!player || player.isPlayerBot?.() === true) return;
    const stage = quest.getStage(player);
    spawnAt(player, "veliaf_slepe_start", VELIAF_ID, VELIAF_SLEPE_TILE, STAGE_UNSTARTED, STAGE_VELIAF_REPORTED);
    spawnAt(player, "veliaf_pater", VELIAF_ID, VELIAF_PATERDOMUS_TILE, STAGE_VELIAF_REPORTED, STAGE_PATERDOMUS);
    spawnAt(player, "veliaf_woods", VELIAF_ID, VELIAF_WOODS_TILE, STAGE_PATERDOMUS, STAGE_MEETING);
    spawnAt(player, "veliaf_boat", VELIAF_ID, VELIAF_BOATHOUSE_TILE, STAGE_ESCORT_DONE, STAGE_GRAVEYARD);
    spawnAt(player, "veliaf_grave_main", VELIAF_ID, GRAVEYARD_VELIAF_TILE, STAGE_GRAVEYARD, STAGE_DISGUISE_READY);
    spawnAt(player, "veliaf_slepe_damien", VELIAF_ID, VELIAF_SLEPE_TILE, STAGE_DISGUISE_READY, STAGE_DARKMEYER_PLAN);
    spawnAt(player, "veliaf_grave_late", VELIAF_ID, GRAVEYARD_VELIAF_TILE, STAGE_DARKMEYER_PLAN, STAGE_VANSTROM_DEAD);
    spawnAt(player, "drezel", DREZEL_ID, DREZEL_TEMPLE_TILE, STAGE_VELIAF_REPORTED, STAGE_MEETING);
    spawnAt(player, "ivan_meet", IVAN_ID, IVAN_MEETING_TILE, STAGE_PATERDOMUS, STAGE_MEETING);
    spawnAt(player, "ivan_start", IVAN_ESCORT_ID, IVAN_TREK_TILE, STAGE_MEETING, STAGE_ESCORT);
    spawnAt(player, "ivan_boat", IVAN_ID, IVAN_BOATHOUSE_TILE, STAGE_ESCORT_DONE, STAGE_GRAVEYARD);
    spawnAt(player, "ivan_grave", IVAN_ID, GRAVEYARD_IVAN_TILE, STAGE_GRAVEYARD, STAGE_VANSTROM_DEAD);
    // The escape conversation completes the quest; keep Ivan at the hideout while
    // the finale is unfinished so a relog mid-conversation can pick it back up.
    spawnAt(player, "ivan_escape", IVAN_ID, BURGH_HIDEOUT, STAGE_VANSTROM_DEAD, STAGE_COMPLETE);
    // The wiki item page: lost tomes are reclaimed from Ivan in Old Man Ral's
    // house in Meiyerditch once the quest is done.
    if (quest.isComplete(player)) spawnKey(player, "ivan_post", IVAN_ID, HIDEOUT_VERTIDA_TILE);
    else despawnKey(player, "ivan_post");
    spawnAt(player, "hameln", HAMELN_ID, HAMELN_CHURCH_TILE, STAGE_STARTED, STAGE_FOLLOWING);
    spawnAt(player, "carl", CARL_ID, CARL_PUB_TILE, STAGE_HAMELN, STAGE_LAB_DESTROYED);
    spawnAt(player, "vanescula", VANESCULA_ID, GRAVEYARD_VANESCULA_TILE, STAGE_GRAVEYARD, STAGE_CASTLE);
    spawnAt(player, "vertida_grave", VERTIDA_ID, GRAVEYARD_VERTIDA_TILE, STAGE_GRAVEYARD, STAGE_LOGS_GIVEN);
    spawnAt(player, "vertida_hideout", VERTIDA_ID, HIDEOUT_VERTIDA_TILE, STAGE_LOGS_GIVEN, STAGE_VANSTROM_DEAD);
    spawnAt(player, "kael", KAEL_ID, GRAVEYARD_KAEL_TILE, STAGE_GRAVEYARD, STAGE_CASTLE);
    spawnAt(player, "radigad", RADIGAD_ID, GRAVEYARD_RADIGAD_TILE, STAGE_GRAVEYARD, STAGE_CASTLE);
    spawnAt(player, "polmafi_grave1", POLMAFI_ID, GRAVEYARD_POLMAFI_TILE, STAGE_GRAVEYARD, STAGE_DISGUISE_BRIEF);
    spawnAt(player, "polmafi_hideout1", POLMAFI_ID, HIDEOUT_POLMAFI_TILE, STAGE_DISGUISE_BRIEF, STAGE_DAMIEN_DONE);
    spawnAt(player, "polmafi_grave2", POLMAFI_ID, GRAVEYARD_POLMAFI_TILE, STAGE_DAMIEN_DONE, STAGE_LOGS_GIVEN);
    spawnAt(player, "polmafi_hideout2", POLMAFI_ID, HIDEOUT_POLMAFI_TILE, STAGE_LOGS_GIVEN, STAGE_VANSTROM_DEAD);
    spawnAt(player, "maria", MARIA_ID, PRISON_MARIA_TILE, STAGE_PRISON, STAGE_ARBORETUM);
    spawnAt(player, "safalaan_grave1", SAFALAAN_ID, GRAVEYARD_SAFALAAN_TILE, STAGE_GRAVEYARD, STAGE_LAB_PLAN);
    spawnAt(player, "safalaan_lab", SAFALAAN_ID, LAB_SAFALAAN_TILE, STAGE_LAB_PLAN, STAGE_LAB_DONE);
    spawnAt(player, "safalaan_grave2", SAFALAAN_ID, GRAVEYARD_SAFALAAN_TILE, STAGE_LAB_DONE, STAGE_SAFALAAN_WALK);
    spawnAt(player, "safalaan_walk", SAFALAAN_ID, SAFALAAN_WALK_TILE, STAGE_SAFALAAN_WALK, STAGE_CASTLE);
    // Fighters.
    if (stage >= STAGE_KROY_FIGHT && stage < STAGE_KROY_DEAD && hasBit(player, BIT_TRAIL)) {
      spawnKey(player, "kroy_fight", KROY_FIGHT_ID, KROY_LAB_TILE);
    } else {
      despawnKey(player, "kroy_fight");
    }
    if (stage === STAGE_BLOODVELD) {
      spawnKey(player, "bloodveld", BLOODVELD_ID, LAB_BLOODVELD_TILE);
    } else {
      despawnKey(player, "bloodveld");
    }
    if (stage >= STAGE_DISGUISE_READY && stage < STAGE_DAMIEN_DONE && hasBit(player, BIT_DAMIEN)) {
      spawnKey(player, "damien_fight", DAMIEN_FIGHT_ID, DAMIEN_MANOR_TILE);
    } else {
      despawnKey(player, "damien_fight");
    }
    if (stage >= STAGE_ESCORT && stage < STAGE_ESCORT_DONE) {
      spawnKey(player, "ivan_trek", IVAN_ESCORT_ID, TREK_START);
      const nails = field(player, NAIL_SHIFT);
      const juvis = field(player, JUVI_SHIFT);
      if (nails < 2) {
        spawnKey(player, "nail1", NAIL_BEAST_IDS[0], TREK_NAIL_TILES[0]);
        spawnKey(player, "nail2", NAIL_BEAST_IDS[1], TREK_NAIL_TILES[1]);
      } else {
        despawnKey(player, "nail1");
        despawnKey(player, "nail2");
      }
      if (nails >= 2 && juvis < 2) {
        spawnKey(player, "juvi1", JUVI_IDS[0], TREK_JUVI_TILES[0]);
        spawnKey(player, "juvi2", JUVI_IDS[1], TREK_JUVI_TILES[1]);
      } else {
        despawnKey(player, "juvi1");
        despawnKey(player, "juvi2");
      }
    } else {
      despawnKey(player, "ivan_trek");
      despawnKey(player, "nail1");
      despawnKey(player, "nail2");
      despawnKey(player, "juvi1");
      despawnKey(player, "juvi2");
    }
    if (stage >= STAGE_CASTLE && stage < STAGE_VANSTROM_DEAD && hasBit(player, BIT_VANSTROM)) {
      spawnKey(player, "vanstrom_fight", VANSTROM_FIGHT_ID, CASTLE_ARENA);
    } else {
      despawnKey(player, "vanstrom_fight");
    }
  }

  // ---------------------------------------------------------------------------
  // Runtime quest objects
  // ---------------------------------------------------------------------------

  function registerObject(objectId, tile, type = 10, rotation = 0) {
    const object = new GameObject(objectId, new Location(tile.x, tile.y, tile.z), type, rotation, null);
    ObjectManager.register(object, true);
    installedObjects.push(object);
    return object;
  }

  function installedAt(objectId, tile) {
    return installedObjects.some(
      (object) =>
        object.getId() === objectId &&
        object.getLocation().getX() === tile.x &&
        object.getLocation().getY() === tile.y &&
        object.getLocation().getZ() === tile.z
    );
  }

  function removeInstalled(objectId, tile) {
    for (let index = installedObjects.length - 1; index >= 0; index--) {
      const object = installedObjects[index];
      if (
        object.getId() === objectId &&
        object.getLocation().getX() === tile.x &&
        object.getLocation().getY() === tile.y &&
        object.getLocation().getZ() === tile.z
      ) {
        ObjectManager.deregister(object, true);
        installedObjects.splice(index, 1);
      }
    }
  }

  function installQuestObjects() {
    if (objectsInstalled) return;
    objectsInstalled = true;
    if (!installedAt(BARREL_OBJECT_ID, BARREL_TILE)) registerObject(BARREL_OBJECT_ID, BARREL_TILE);
    if (!installedAt(BOAT_OBJECT_ID, BURGH_DOCKS)) registerObject(BOAT_OBJECT_ID, BURGH_DOCKS);
    if (!installedAt(BOAT_OBJECT_ID, ICYENE_DOCK)) registerObject(BOAT_OBJECT_ID, ICYENE_DOCK);
    if (!installedAt(MAUSOLEUM_DOOR_UNLOCK_OBJECT_ID, MAUSOLEUM_DOOR_TILE)) {
      registerObject(MAUSOLEUM_DOOR_UNLOCK_OBJECT_ID, MAUSOLEUM_DOOR_TILE, 0, MAUSOLEUM_DOOR_TILE.rotation);
    }
  }

  function syncQuestObjects(player) {
    installQuestObjects();
    const stage = quest.getStage(player);
    if (stage >= STAGE_KROY_FIGHT && stage < STAGE_LAB_DESTROYED) {
      for (let index = 0; index < KROY_TABLE_TILES.length; index++) {
        const tile = KROY_TABLE_TILES[index];
        const broken = hasBit(player, index === 0 ? BIT_TABLE_1 : BIT_TABLE_2);
        const wanted = broken ? KROY_TABLE_BROKEN_OBJECT_ID : KROY_TABLE_OP_OBJECT_ID;
        if (!installedAt(wanted, tile)) {
          removeInstalled(KROY_TABLE_OP_OBJECT_ID, tile);
          removeInstalled(KROY_TABLE_BROKEN_OBJECT_ID, tile);
          registerObject(wanted, tile, 10, tile.rotation);
        }
      }
    }
    if (stage >= STAGE_ESCORT && stage < STAGE_ESCORT_DONE) {
      if (!installedAt(SWAMP_TREE_OBJECT_ID, TREK_TREE_TILE)) {
        registerObject(SWAMP_TREE_OBJECT_ID, TREK_TREE_TILE);
      }
    } else if (installedAt(SWAMP_TREE_OBJECT_ID, TREK_TREE_TILE)) {
      removeInstalled(SWAMP_TREE_OBJECT_ID, TREK_TREE_TILE);
    }
    const doorId = stage >= STAGE_PUZZLE_DONE ? MAUSOLEUM_DOOR_OPEN_OBJECT_ID : MAUSOLEUM_DOOR_UNLOCK_OBJECT_ID;
    if (!installedAt(doorId, MAUSOLEUM_DOOR_TILE)) {
      removeInstalled(MAUSOLEUM_DOOR_UNLOCK_OBJECT_ID, MAUSOLEUM_DOOR_TILE);
      removeInstalled(MAUSOLEUM_DOOR_OPEN_OBJECT_ID, MAUSOLEUM_DOOR_TILE);
      registerObject(doorId, MAUSOLEUM_DOOR_TILE, 0, MAUSOLEUM_DOOR_TILE.rotation);
    }
  }

  // ---------------------------------------------------------------------------
  // Cache sub-varbit mirrors
  // ---------------------------------------------------------------------------

  function syncVisuals(player) {
    const sender = player.getPacketSender();
    sender.sendVarbit(VARBIT_KAEL_CONVINCED, hasBit(player, BIT_KAEL) ? 1 : 0);
    sender.sendVarbit(VARBIT_VERTIDA_CONVINCED, hasBit(player, BIT_VERTIDA) ? 1 : 0);
    sender.sendVarbit(VARBIT_IVAN_CONVINCED, hasBit(player, BIT_IVAN) ? 1 : 0);
    sender.sendVarbit(VARBIT_POLMAFI_CONVINCED, hasBit(player, BIT_POLMAFI) ? 1 : 0);
    sender.sendVarbit(VARBIT_RADIGAD_CONVINCED, hasBit(player, BIT_RADIGAD) ? 1 : 0);
    sender.sendVarbit(VARBIT_KROY_TABLE_1, hasBit(player, BIT_TABLE_1) ? 1 : 0);
    sender.sendVarbit(VARBIT_KROY_TABLE_2, hasBit(player, BIT_TABLE_2) ? 1 : 0);
    sender.sendVarbit(VARBIT_TRADER_SVEN_MET, hasBit(player, BIT_SVEN) ? 1 : 0);
    sender.sendVarbit(VARBIT_PUZZLE_COMPLETED, quest.getStage(player) >= STAGE_PUZZLE_DONE ? 1 : 0);
    sender.sendVarbit(VARBIT_LAB_UNLOCKED, quest.getStage(player) >= STAGE_LAB_PLAN ? 1 : 0);
  }

  // ---------------------------------------------------------------------------
  // Journal and rewards
  // ---------------------------------------------------------------------------

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      return [
        "<str>I found the source of the Sleeper Plague in Slepe: vampyres had</str>",
        "<str>dosed the Bloody Bracers, and I put a stop to Kroy's work.</str>",
        "<str>Vanescula Drakan offered the Myreque a chance to kill her brother,</str>",
        "<str>and Safalaan learned the truth of his icyene heritage.</str>",
        "<str>I infiltrated Darkmeyer, cut blisterwood from the Arboretum and</str>",
        "<str>helped forge weapons for the final battle at Castle Drakan.</str>",
        "",
        "<col=ff0000>QUEST COMPLETE!</col>",
      ];
    }
    if (stage >= STAGE_VANSTROM_DEAD) {
      return [
        "Vanstrom Klause has fallen. Ivan teleported us out of Castle Drakan,",
        "but Safalaan was left behind.",
        "",
        "I should speak to <col=800000>Ivan</col> at the hideout.",
      ];
    }
    if (stage >= STAGE_CASTLE) {
      return [
        "Vanescula has taken us to Castle Drakan as her prisoners.",
        "",
        "I must face <col=800000>Vanstrom Klause</col>.",
      ];
    }
    if (stage >= STAGE_SAFALAAN_WALK) {
      return [
        "Safalaan has gone for a walk north of the Icyene Graveyard.",
        "",
        "I should find him, then tell <col=800000>Vanescula</col> we are ready.",
      ];
    }
    if (stage >= STAGE_FLAIL) {
      return [
        "I have a <col=800000>blisterwood flail</col>.",
        "",
        "I should return to the <col=800000>Icyene Graveyard</col>.",
      ];
    }
    if (stage >= STAGE_VERTIDA_LOGS) {
      return [
        "Vertida told me how to make the new weapons: embed a ruby in a",
        "blessed silver sickle, enchant it, add a blisterwood log, then attach",
        "the blisterwood sickle to my Ivandis flail.",
      ];
    }
    if (stage >= STAGE_LOGS_GIVEN) {
      return [
        "Vanescula took the blisterwood logs and sent me to",
        "<col=800000>Vertida</col> in the Meiyerditch hideout.",
      ];
    }
    if (stage >= STAGE_LOGS) {
      return [
        "I have cut eight <col=800000>blisterwood logs</col>.",
        "",
        "I should return to <col=800000>Vanescula</col> at the Icyene Graveyard.",
      ];
    }
    if (stage >= STAGE_ARBORETUM) {
      return [
        "Desmodus has let me into the Arboretum.",
        "",
        "I should search the shelves, read the old note, set the valves to the",
        "required flow and chop eight logs from the Blisterwood tree.",
      ];
    }
    if (stage >= STAGE_SLAVES_DONE) {
      return [
        "The Gadderanks slaves will be returned to Desmodus.",
        "",
        "I should tell <col=800000>Desmodus Lasiurus</col> so he lets me into the",
        "Arboretum.",
      ];
    }
    if (stage >= STAGE_PRISON) {
      return [
        "I found the Gadderanks in Lord Jovkai's prison. Vanstrom nearly",
        "recognised me, but Sarius Guile intervened.",
        "",
        "I should return to <col=800000>Desmodus</col> at the Arboretum.",
      ];
    }
    if (stage >= STAGE_MORDAN) {
      return [
        "Mordan Nikazsi sold Desmodus' slaves to Lord Alexei Jovkai.",
        "",
        "I should find them in <col=800000>Lord Jovkai's prison</col> north of the",
        "Arboretum.",
      ];
    }
    if (stage >= STAGE_DARKMEYER) {
      return [
        "I entered <col=800000>Darkmeyer</col> through the cracked wall.",
        "",
        "I need to get into the Arboretum. Its guard, Desmodus Lasiurus,",
        "wants a juvinate called Mordan Nikazsi found first.",
      ];
    }
    if (stage >= STAGE_DARKMEYER_PLAN) {
      return [
        "Vanescula says the only Blisterwood tree is in Efaritay's Arboretum,",
        "in the middle of Darkmeyer.",
        "",
        "I can enter the city through a <col=800000>crack in the southern wall</col> of",
        "Meiyerditch, north of the daeyalt mine.",
      ];
    }
    if (stage >= STAGE_DAMIEN_DONE) {
      return [
        "Damien Leucurte is dead and I scented my disguise with his blood.",
        "",
        "I should return to <col=800000>Vanescula</col> at the Icyene Graveyard.",
      ];
    }
    if (stage >= STAGE_DISGUISE_READY) {
      return [
        "Vanescula wants Damien Leucurte dead so I can use his noble blood to",
        "scent the disguise.",
        "",
        "I should meet <col=800000>Veliaf</col> outside the church in Slepe.",
      ];
    }
    if (stage >= STAGE_DISGUISE_BRIEF) {
      return [
        "I need a <col=800000>vyre noble disguise</col>: buy a vyrewatch outfit from",
        "Trader Sven in Meiyerditch, have Polmafi adapt it at the hideout,",
        "then return to Vanescula.",
      ];
    }
    if (stage >= STAGE_LAB_DONE) {
      return [
        "Safalaan has Haemalchemy volume 2.",
        "",
        "I should return to the <col=800000>Icyene Graveyard</col>.",
      ];
    }
    if (stage >= STAGE_LAB_BOOK) {
      return [
        "I found <col=800000>Haemalchemy volume 2</col> in the laboratory.",
        "",
        "I should give it to <col=800000>Safalaan</col>.",
      ];
    }
    if (stage >= STAGE_BLOODVELD_TALK) {
      return [
        "Safalaan killed one mutated bloodveld with his powers and I killed",
        "another. He is still weak.",
        "",
        "I should search the laboratory for more haemalchemy research.",
      ];
    }
    if (stage >= STAGE_BLOODVELD) {
      return [
        "A <col=800000>mutated bloodveld</col> attacked us in the laboratory.",
        "",
        "I must kill it.",
      ];
    }
    if (stage >= STAGE_LAB_PLAN) {
      return [
        "Vanescula believes the Meiyerditch laboratory holds the secret to",
        "upgrading the Ivandis flail.",
        "",
        "Safalaan is meeting me at the laboratory in sector six of Meiyerditch.",
      ];
    }
    if (stage >= STAGE_CONVINCED) {
      return [
        "The Myreque have agreed to Vanescula's plan.",
        "",
        "I should speak to <col=800000>Vanescula</col> at the Icyene Graveyard.",
      ];
    }
    if (stage >= STAGE_CONVINCING) {
      const convinced = [];
      if (hasBit(player, BIT_VERTIDA)) convinced.push("Vertida");
      if (hasBit(player, BIT_KAEL)) convinced.push("Kael");
      if (hasBit(player, BIT_RADIGAD)) convinced.push("Radigad");
      if (hasBit(player, BIT_POLMAFI)) convinced.push("Polmafi");
      if (hasBit(player, BIT_IVAN)) convinced.push("Ivan");
      return [
        "Safalaan wants to work with Vanescula to kill her brother.",
        "",
        "I must convince the Myreque. So far:",
        convinced.length ? `Agreed: ${convinced.join(", ")}.` : "No one has agreed yet.",
        "Then I should speak to <col=800000>Veliaf</col>.",
      ];
    }
    if (stage >= STAGE_PUZZLE_DONE) {
      return [
        "Safalaan is the half-icyene son of Queen Efaritay and King Ascertes",
        "Hallow, and Vanstrom Klause is his father.",
        "",
        "He has agreed to work with Vanescula. I should convince the Myreque.",
      ];
    }
    if (stage >= STAGE_MUSEUM_TALK) {
      return [
        "Vanescula wants to speak with Safalaan at the large mausoleum.",
        "",
        "I should open the <col=800000>Mausoleum door</col> and solve its lock.",
      ];
    }
    if (stage >= STAGE_GRAVEYARD) {
      return [
        "We have arrived at the <col=800000>Icyene Graveyard</col>.",
        "",
        "I should speak to <col=800000>Veliaf</col>.",
      ];
    }
    if (stage >= STAGE_BOATHOUSE) {
      return [
        "Everything is ready. I should board the boat at the Burgh de Rott",
        "boathouse and sail to the <col=800000>Icyene Graveyard</col>.",
      ];
    }
    if (stage >= STAGE_ESCORT_DONE) {
      return [
        "I escorted Ivan through Mort Myre to <col=800000>Burgh de Rott</col>.",
        "",
        "I should meet him and Veliaf at the boathouse on the southern coast.",
      ];
    }
    if (stage >= STAGE_ESCORT) {
      return [
        "I am escorting Ivan Strom through the swamp to Burgh de Rott.",
        "",
        "We must deal with the bog crossing, nail beasts and vampyre",
        "juvinates along the way.",
      ];
    }
    if (stage >= STAGE_MEETING) {
      return [
        "Vanescula Drakan ambushed us at the Haunted Woods meeting.",
        "",
        "She wants the whole Myreque at the <col=800000>Icyene Graveyard</col>.",
        "I should escort <col=800000>Ivan</col> down to Burgh de Rott first.",
      ];
    }
    if (stage >= STAGE_PATERDOMUS) {
      return [
        "Drezel told us Ivan is the last descendant of Ivandis Seergaze, and",
        "that he has gone to spy on a meeting in the Haunted Woods.",
        "",
        "I should meet Veliaf and Ivan south of Fenkenstrain's Castle.",
      ];
    }
    if (stage >= STAGE_VELIAF_REPORTED) {
      return [
        "Veliaf wants to check in with Drezel and Ivan at",
        "<col=800000>Paterdomus</col> before investigating the werewolves.",
      ];
    }
    if (stage >= STAGE_LAB_DESTROYED) {
      return [
        "Kroy is dead and his laboratory is destroyed.",
        "",
        "I should report back to <col=800000>Veliaf</col> in Slepe.",
      ];
    }
    if (stage >= STAGE_KROY_DEAD) {
      return [
        "Kroy is dead.",
        "",
        "I should destroy both of his <col=800000>lab tables</col>.",
      ];
    }
    if (stage >= STAGE_KROY_FIGHT) {
      return ["Kroy is behind the Sleeper Plague.", "", "I must kill <col=800000>Kroy</col>."];
    }
    if (stage >= STAGE_FOLLOWING) {
      return [
        "Carl is out of Bloody Bracers and has gone to his supplier.",
        "",
        "I followed him into the dungeon beneath Slepe and overheard",
        "vampyres discussing the Sleeper Plague.",
      ];
    }
    if (stage >= STAGE_HAMELN) {
      return [
        "Hameln says Hanchen fell ill after drinking Bloody Bracers at",
        "the <col=800000>Rat & Bat</col>.",
        "",
        "I should question <col=800000>Carl</col> the barkeep.",
      ];
    }
    if (stage >= STAGE_STARTED) {
      return [
        "Veliaf asked me to find the source of the Sleeper Plague while he",
        "investigates the vampyres at Crombwick Manor.",
        "",
        "The victims are in the <col=800000>church</col> in Slepe.",
      ];
    }
    return [
      "I can start this quest by talking to <col=800000>Veliaf Hurtz</col> outside",
      "the church in <col=800000>Slepe</col>.",
      "",
      "I need to have completed <col=800000>A Taste of Hope</col>.",
    ];
  }

  function grantReward(player) {
    player.setAttribute(TOME_USES_ATTRIBUTE, 0);
    applyStageSpawns(player);
    syncVisuals(player);
  }

  // ---------------------------------------------------------------------------
  // Prose conditions
  // ---------------------------------------------------------------------------

  function answerCondition(event) {
    const { player, stepId, text } = event;
    const key = stepId ?? "";
    const prose = String(text ?? "");
    if (key === "7D8z_N" || prose.startsWith("If the player does not have the requirements")) {
      return !meetsRequirements(player);
    }
    if (key === "S4umqc" || prose.startsWith("If the player has the requirements")) {
      return meetsRequirements(player);
    }
    if (key === "SGj1He" || prose.startsWith("If the player has a lower combat level")) {
      return combatLevel(player) < 95;
    }
    if (key === "Y7Eh4F" || prose.startsWith("If the player has the vyre disguise")) {
      return hasVyreNoble(player);
    }
    if (key === "CIrOJv" || prose.startsWith("If the player does not have the vyre disguise")) {
      return !hasVyreNoble(player);
    }
    if (key === "kqP6AE" || prose.startsWith("If the player has a blisterwood flail")) {
      return hasBlisterwoodFlail(player);
    }
    if (key === "pl5f2L" || prose.startsWith("If the player does not have a blisterwood flail")) {
      return !hasBlisterwoodFlail(player);
    }
    if (key === "svlKBi" || prose.startsWith("If the player does not have 40,000 coins")) {
      return !held(player, ItemIdentifiers.COINS, 40000);
    }
    if (key === "z2xhAs" || prose.startsWith("If the player has at least 40,000 coins")) {
      return held(player, ItemIdentifiers.COINS, 40000);
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // Transcript action handling
  // ---------------------------------------------------------------------------

  function handleDialogueAction(event) {
    const { player, stepId } = event;
    if (!player || !stepId) return;
    switch (stepId) {
      case "bsrbMj": // The player begins following Carl.
        if (quest.getStage(player) < STAGE_FOLLOWING) advance(player, STAGE_FOLLOWING);
        return;
      case "5Nx48P": // Kroy attacks the player.
        setBit(player, BIT_TRAIL);
        if (quest.getStage(player) < STAGE_KROY_FIGHT) advance(player, STAGE_KROY_FIGHT);
        else applyStageSpawns(player);
        return;
      case "uRyt8i": // Ivan and Veliaf depart, leaving you alone in the woods.
        if (quest.getStage(player) < STAGE_MEETING) advance(player, STAGE_MEETING);
        else applyStageSpawns(player);
        return;
      case "_popnC": // You escort Ivan through the swamp...
        if (quest.getStage(player) < STAGE_ESCORT) advance(player, STAGE_ESCORT);
        else applyStageSpawns(player);
        teleport(player, TREK_START);
        return;
      case "uD7Qcw": // Ivan departs towards the boathouse.
        teleport(player, BURGH_DOCKS);
        if (quest.getStage(player) < STAGE_ESCORT_DONE) advance(player, STAGE_ESCORT_DONE);
        else applyStageSpawns(player);
        return;
      case "2Ond7l":
      case "_TdnV6": // The player and Safalaan enter the laboratory.
        teleport(player, LAB_BLOODVELD_TILE);
        return;
      case "WV-HwC":
      case "Gdz7wW": // Safalaan is attacked by a mutated bloodveld...
        if (quest.getStage(player) < STAGE_BLOODVELD) advance(player, STAGE_BLOODVELD);
        else applyStageSpawns(player);
        return;
      case "A5NXtS": // You give the book of haemalchemy research to Safalaan.
        player.getInventory().deleteNumber(HAEMALCHEMY_VOL_2_ITEM_ID, 1);
        return;
      case "DW1fI1": // You give Polmafi the vyrewatch disguise.
        if (hasVyrewatchOutfit(player)) swapOutfit(player, VYREWATCH_ITEM_IDS, VYRE_NOBLE_UNSCENTED_IDS);
        return;
      case "OieoC2": // The player and Veliaf go off to confront Damien.
        teleport(player, { x: 3717, y: 3358, z: 1 });
        later(player, 1, () =>
          play(player, DAMIEN_FIGHT_ID, "a-vyre-ry-noble-disguise-going-back-to-slepe-confronting-damien")
        );
        return;
      case "oKCkn5": // Damien attacks the player and Veliaf.
        setBit(player, BIT_DAMIEN);
        applyStageSpawns(player);
        return;
      case "3dLkuB": // As Damien dies, you use his blood to scent your disguise.
        swapOutfit(player, VYRE_NOBLE_UNSCENTED_IDS, VYRE_NOBLE_SCENTED_IDS);
        if (quest.getStage(player) < STAGE_DAMIEN_DONE) advance(player, STAGE_DAMIEN_DONE);
        return;
      case "sM_w-r": // You give seven blisterwood logs to Vertida.
        player.getInventory().deleteNumber(BLISTERWOOD_LOGS_ITEM_ID, 7);
        if (quest.getStage(player) < STAGE_VERTIDA_LOGS) advance(player, STAGE_VERTIDA_LOGS);
        return;
      case "JaZXc6": // You and Safalaan return to the graveyard.
        if (quest.getStage(player) < STAGE_READY) advance(player, STAGE_READY);
        return;
      case "HgxSdS": // The player, Vanescula, and the Myreque go to Castle Drakan.
        if (quest.getStage(player) < STAGE_CASTLE) advance(player, STAGE_CASTLE);
        teleport(player, CASTLE_ARENA);
        later(player, 1, () =>
          play(player, VANSTROM_FIGHT_ID, "a-bloody-show-face-to-face-with-the-lord-of-vampyrium")
        );
        return;
      case "2PLAE9": // Vanstrom attacks the player.
        setBit(player, BIT_VANSTROM);
        applyStageSpawns(player);
        return;
      case "32fCzz": // The player and Veliaf return to Darkmeyer castle.
        teleport(player, CASTLE_ARENA);
        setBit(player, BIT_VANSTROM);
        applyStageSpawns(player);
        return;
      case "VkGiX9": // Veliaf gives you a Blisterwood Flail.
        player.getInventory().deleteNumber(ItemIdentifiers.COINS, 40000);
        if (!hasBlisterwoodFlail(player)) give(player, BLISTERWOOD_FLAIL_ITEM_ID, 1);
        return;
      case "I_cLuQ": // Safalaan's Icyene powers activate, killing Vanstrom...
        despawnKey(player, "vanstrom_fight");
        if (quest.getStage(player) < STAGE_VANSTROM_DEAD) advance(player, STAGE_VANSTROM_DEAD);
        return;
      case "y7Pa27": {
        // Ivan teleports himself, Veliaf, and the player out of Castle Drakan.
        event.handled = true;
        event.end = true;
        despawnKey(player, "vanstrom_fight");
        teleport(player, BURGH_HIDEOUT);
        later(player, 1, () => play(player, IVAN_ID, "shattered-after-escaping-from-castle-drakan"));
        return;
      }
      case "epguG1": // Congratulations! Quest complete!
        event.handled = true;
        event.end = true;
        if (!quest.isComplete(player)) quest.complete(player);
        return;
      case "UPl9kU": // recovering a lost tome from Ivan
        if (!held(player, TOME_ITEM_ID)) give(player, TOME_ITEM_ID, 1);
        return;
      default:
        return;
    }
  }

  function handleDialogueChoice(event) {
    const { player, option, npcId } = event;
    if (!player) return;
    if (option === "Where do you get your Bloody Bracers from?" && CARL_IDS.has(npcId)) {
      setBit(player, BIT_CARL_ASKED);
    }
    // The wiki only carries the start hook on the low-combat branch of the
    // opening offer; the normal "Yes." needs starting here.
    if (
      option === "Yes." &&
      VELIAF_IDS.has(npcId) &&
      quest.getStage(player) === STAGE_UNSTARTED &&
      near(player, VELIAF_SLEPE_TILE, 12) &&
      meetsRequirements(player)
    ) {
      advance(player, STAGE_STARTED);
    }
  }

  function handleStartHook(event) {
    const { player, npcId, hook } = event;
    if (hook !== START_HOOK || !VELIAF_IDS.has(npcId)) return;
    if (quest.getStage(player) !== STAGE_UNSTARTED) return;
    if (!meetsRequirements(player)) {
      requirementsMessage(player);
      return;
    }
    advance(player, STAGE_STARTED);
  }

  // ---------------------------------------------------------------------------
  // Stage advancement
  // ---------------------------------------------------------------------------

  function advance(player, stage) {
    if (quest.getStage(player) >= stage) return;
    quest.setStage(player, stage);
    applyStageSpawns(player);
    syncVisuals(player);
    syncQuestObjects(player);
  }

  function handleStageChanged(event) {
    if (event.key !== "sins_of_the_father" || !event.player) return;
    applyStageSpawns(event.player);
    syncVisuals(event.player);
    syncQuestObjects(event.player);
  }

  // ---------------------------------------------------------------------------
  // Talk-to handlers
  // ---------------------------------------------------------------------------

  function talkVeliaf(event) {
    const { player, npcId } = event;
    if (!VELIAF_IDS.has(npcId)) return false;
    const stage = quest.getStage(player);
    if (stage === STAGE_UNSTARTED) {
      // Only the Slepe spawn is ours: the Burgh de Rott copy belongs to the
      // earlier Myreque quests.
      if (!near(player, VELIAF_SLEPE_TILE, 12)) return false;
      play(player, npcId, "slepe-s-sleeper-plague-talking-to-veliaf");
      return true;
    }
    if (stage >= STAGE_COMPLETE) return false;
    if (stage < STAGE_HAMELN) {
      play(player, npcId, "slepe-s-sleeper-plague-talking-to-veliaf-talking-to-veliaf-again");
      return true;
    }
    if (stage < STAGE_FOLLOWING) {
      play(player, npcId, "slepe-s-sleeper-plague-talking-to-hameln-report-back-to-veliaf");
      return true;
    }
    if (stage < STAGE_LAB_DESTROYED) {
      say(player, npcId, "You should follow Carl and see where he goes.");
      return true;
    }
    if (stage < STAGE_VELIAF_REPORTED) {
      play(player, npcId, "an-unwelcome-surprise-reporting-back-to-veliaf");
      advance(player, STAGE_VELIAF_REPORTED);
      return true;
    }
    if (stage < STAGE_PATERDOMUS) {
      play(player, npcId, "an-unwelcome-surprise-checking-in-at-paterdomus");
      advance(player, STAGE_PATERDOMUS);
      return true;
    }
    if (stage < STAGE_MEETING) {
      play(player, npcId, "an-unwelcome-surprise-checking-in-at-paterdomus-talking-to-veliaf-again");
      return true;
    }
    if (stage < STAGE_ESCORT) {
      play(player, npcId, "an-unwelcome-surprise-meeting-at-the-haunted-woods");
      return true;
    }
    if (stage < STAGE_ESCORT_DONE) return false;
    if (stage < STAGE_BOATHOUSE) {
      play(player, npcId, "an-unwelcome-surprise-talking-to-veliaf-at-burgh-de-rott");
      advance(player, STAGE_BOATHOUSE);
      return true;
    }
    if (stage < STAGE_GRAVEYARD) {
      play(player, npcId, "an-unwelcome-surprise-talking-to-veliaf-at-burgh-de-rott-talking-to-veliaf-again");
      return true;
    }
    if (stage < STAGE_MUSEUM_TALK) {
      play(player, npcId, "a-nice-and-simple-plan-meeting-at-the-icyene-graveyard");
      advance(player, STAGE_MUSEUM_TALK);
      return true;
    }
    if (stage < STAGE_PUZZLE_DONE) {
      play(player, npcId, "a-nice-and-simple-plan-the-secret-of-safalaan-hallow-part-1-speaking-to-the-myreque-before-unlocking-the-door-talking-to-veliaf");
      return true;
    }
    if (stage < STAGE_CONVINCED) {
      if (allConvinced(player)) {
        play(player, npcId, "a-nice-and-simple-plan-convincing-the-myreque-talking-to-veliaf-talking-to-veliaf-again-after-convincing-everyone-else");
        advance(player, STAGE_CONVINCED);
        return true;
      }
      if (hasBit(player, BIT_VELIAF_ASKED)) {
        play(player, npcId, "a-nice-and-simple-plan-convincing-the-myreque-talking-to-veliaf-talking-to-veliaf-again-before-convincing-everyone-else");
      } else {
        setBit(player, BIT_VELIAF_ASKED);
        play(player, npcId, "a-nice-and-simple-plan-convincing-the-myreque-talking-to-veliaf");
      }
      return true;
    }
    if (stage < STAGE_LAB_PLAN) {
      play(player, npcId, "a-nice-and-simple-plan-weapons-upgrade-talking-to-veliaf");
      return true;
    }
    if (stage < STAGE_DISGUISE_BRIEF) {
      play(player, npcId, "a-vyre-ry-noble-disguise-talking-to-veliaf-safalaan-or-vanescula-talking-to-veliaf-again");
      return true;
    }
    if (stage < STAGE_DISGUISE_READY) return false;
    if (stage < STAGE_DAMIEN_DONE) {
      play(player, npcId, "a-vyre-ry-noble-disguise-going-back-to-slepe-talking-to-veliaf");
      return true;
    }
    if (stage < STAGE_DARKMEYER_PLAN) {
      play(player, npcId, "a-vyre-ry-noble-disguise-going-back-to-slepe-talking-to-veliaf-2");
      advance(player, STAGE_DARKMEYER_PLAN);
      return true;
    }
    if (stage < STAGE_LOGS_GIVEN) {
      say(player, npcId, "Darkmeyer awaits, friend. Be careful in there.");
      return true;
    }
    if (stage < STAGE_FLAIL) {
      play(player, npcId, "the-final-preparations-calm-before-the-storm-talking-to-veliaf-without-a-blisterwood-flail");
      return true;
    }
    if (stage < STAGE_SAFALAAN_WALK) {
      play(player, npcId, "the-final-preparations-calm-before-the-storm-talking-to-veliaf-with-a-blisterwood-flail");
      advance(player, STAGE_SAFALAAN_WALK);
      return true;
    }
    if (stage < STAGE_CASTLE) {
      play(player, npcId, "the-final-preparations-calm-before-the-storm-talking-to-veliaf-with-a-blisterwood-flail-talking-to-veliaf-again");
      return true;
    }
    if (stage < STAGE_VANSTROM_DEAD) {
      if (!hasBlisterwoodFlail(player)) {
        play(player, npcId, "a-bloody-show-vanstrom-during-the-fight-talking-to-veliaf-after-dying-during-the-fight");
      } else {
        play(player, npcId, "a-bloody-show-vanstrom-during-the-fight-talking-to-veliaf-after-leaving-the-fight");
      }
      return true;
    }
    return false;
  }

  function talkHameln(event) {
    const { player, npcId } = event;
    if (!HAMELN_IDS.has(npcId)) return false;
    const stage = quest.getStage(player);
    if (stage < STAGE_STARTED || stage >= STAGE_FOLLOWING) return false;
    if (stage < STAGE_HAMELN) {
      play(player, npcId, "slepe-s-sleeper-plague-talking-to-hameln");
      advance(player, STAGE_HAMELN);
      return true;
    }
    play(player, npcId, "slepe-s-sleeper-plague-talking-to-hameln-talking-to-hameln-again");
    return true;
  }

  function talkCarl(event) {
    const { player, npcId } = event;
    if (!CARL_IDS.has(npcId)) return false;
    const stage = quest.getStage(player);
    if (stage < STAGE_HAMELN || stage >= STAGE_LAB_DESTROYED) return false;
    if (hasBit(player, BIT_CARL_ASKED)) {
      play(player, npcId, "plague-s-end-talking-to-carl-talking-to-carl-again");
    } else {
      play(player, npcId, "plague-s-end-talking-to-carl");
    }
    return true;
  }

  function talkDrezel(event) {
    const { player, npcId } = event;
    if (!DREZEL_IDS.has(npcId)) return false;
    const stage = quest.getStage(player);
    if (stage < STAGE_VELIAF_REPORTED || stage >= STAGE_ESCORT) return false;
    if (stage < STAGE_MEETING) {
      play(player, npcId, "an-unwelcome-surprise-checking-in-at-paterdomus-talking-to-drezel-again");
    } else {
      play(player, npcId, "an-unwelcome-surprise-talking-to-drezel-after-attending-the-meeting");
    }
    return true;
  }

  function talkSafalaan(event) {
    const { player, npcId } = event;
    if (!SAFALAAN_IDS.has(npcId)) return false;
    const stage = quest.getStage(player);
    if (stage < STAGE_GRAVEYARD || stage >= STAGE_VANSTROM_DEAD) return false;
    if (stage < STAGE_MUSEUM_TALK) {
      say(player, npcId, "Talk to Veliaf first.");
      return true;
    }
    if (stage < STAGE_PUZZLE_DONE) {
      play(player, npcId, "a-nice-and-simple-plan-the-secret-of-safalaan-hallow-part-1-speaking-to-the-myreque-before-unlocking-the-door-talking-to-safalaan");
      return true;
    }
    if (stage < STAGE_CONVINCED) {
      say(player, npcId, "Please, speak to the others. I need some time alone.");
      return true;
    }
    if (stage < STAGE_LAB_PLAN) {
      play(player, npcId, "a-nice-and-simple-plan-weapons-upgrade-talking-to-safalaan");
      return true;
    }
    if (stage < STAGE_BLOODVELD) {
      play(player, npcId, "a-nice-and-simple-plan-the-meiyerditch-laboratories");
      return true;
    }
    if (stage < STAGE_BLOODVELD_TALK) {
      play(player, npcId, "a-nice-and-simple-plan-after-defeating-the-mutated-bloodveld");
      advance(player, STAGE_BLOODVELD_TALK);
      return true;
    }
    if (stage < STAGE_LAB_BOOK) {
      play(player, npcId, "a-nice-and-simple-plan-after-defeating-the-mutated-bloodveld-talking-to-safalaan-again");
      return true;
    }
    if (stage < STAGE_LAB_DONE && held(player, HAEMALCHEMY_VOL_2_ITEM_ID)) {
      play(player, npcId, "a-nice-and-simple-plan-talking-to-safalaan-after-getting-the-book");
      advance(player, STAGE_LAB_DONE);
      return true;
    }
    if (stage < STAGE_LAB_DONE) {
      say(player, npcId, "You need to try and find some more haemalchemy research. There must be something of note around here.");
      return true;
    }
    if (stage < STAGE_SAFALAAN_WALK) {
      play(player, npcId, "a-vyre-ry-noble-disguise-talking-to-veliaf-safalaan-or-vanescula-talking-to-safalaan-again");
      return true;
    }
    if (stage < STAGE_CASTLE) {
      play(player, npcId, "the-final-preparations-calm-before-the-storm-talking-to-safalaan");
      return true;
    }
    return false;
  }

  function talkVanescula(event) {
    const { player, npcId } = event;
    if (!VANESCULA_IDS.has(npcId)) return false;
    const stage = quest.getStage(player);
    if (stage < STAGE_GRAVEYARD || stage >= STAGE_CASTLE) return false;
    if (stage < STAGE_MUSEUM_TALK) {
      say(player, npcId, "Talk to Veliaf first.");
      return true;
    }
    if (stage < STAGE_PUZZLE_DONE) {
      if (!hasBit(player, BIT_PUZZLE_PLAYED)) {
        setBit(player, BIT_PUZZLE_PLAYED);
        play(player, npcId, "a-nice-and-simple-plan-the-secret-of-safalaan-hallow-part-1");
        return true;
      }
      play(player, npcId, "a-nice-and-simple-plan-the-secret-of-safalaan-hallow-part-1-speaking-to-the-myreque-before-unlocking-the-door-talking-to-vanescula");
      return true;
    }
    if (stage < STAGE_CONVINCED) {
      play(player, npcId, "a-nice-and-simple-plan-convincing-the-myreque-talking-to-vanescula");
      return true;
    }
    if (stage < STAGE_LAB_PLAN) {
      play(player, npcId, "a-nice-and-simple-plan-weapons-upgrade");
      advance(player, STAGE_LAB_PLAN);
      return true;
    }
    if (stage < STAGE_LAB_DONE) {
      play(player, npcId, "a-nice-and-simple-plan-weapons-upgrade-talking-to-vanescula");
      return true;
    }
    if (stage < STAGE_DISGUISE_BRIEF) {
      play(player, npcId, "a-vyre-ry-noble-disguise-talking-to-veliaf-safalaan-or-vanescula");
      advance(player, STAGE_DISGUISE_BRIEF);
      return true;
    }
    if (stage < STAGE_DISGUISE_READY) {
      if (hasVyreNoble(player)) {
        play(player, npcId, "a-vyre-ry-noble-disguise-kill-two-birds-with-one-stone-talking-to-vanescula-after-getting-a-vyre-noble-disguise");
        advance(player, STAGE_DISGUISE_READY);
      } else {
        play(player, npcId, "a-vyre-ry-noble-disguise-kill-two-birds-with-one-stone-talking-to-vanescula-before-getting-a-vyre-noble-disguise");
      }
      return true;
    }
    if (stage < STAGE_DAMIEN_DONE) {
      play(player, npcId, "a-vyre-ry-noble-disguise-kill-two-birds-with-one-stone-talking-to-vanescula-again");
      return true;
    }
    if (stage < STAGE_DARKMEYER) {
      play(player, npcId, "the-branches-of-darkmeyer-talking-to-vanescula-with-the-scented-disguise");
      advance(player, STAGE_DARKMEYER);
      return true;
    }
    if (stage < STAGE_LOGS) {
      play(player, npcId, "the-branches-of-darkmeyer-talking-to-vanescula-with-the-scented-disguise-talking-to-vanescula-again");
      return true;
    }
    if (stage < STAGE_VERTIDA_LOGS) {
      if (logCount(player) >= 8) {
        play(player, npcId, "the-final-preparations-talking-to-vanescula-with-eight-blisterwood-logs");
        advance(player, STAGE_LOGS_GIVEN);
      } else {
        play(player, npcId, "the-final-preparations-talking-to-vanescula-without-eight-blisterwood-logs");
      }
      return true;
    }
    if (stage < STAGE_FLAIL) {
      play(player, npcId, "the-final-preparations-talking-to-vanescula-with-eight-blisterwood-logs-talking-to-vanescula-again");
      return true;
    }
    if (stage < STAGE_READY) {
      play(player, npcId, "the-final-preparations-calm-before-the-storm-talking-to-veliaf-with-a-blisterwood-flail-talking-to-vanescula-again");
      return true;
    }
    if (stage < STAGE_CASTLE) {
      play(player, npcId, "the-final-preparations-calm-before-the-storm-talking-to-vanescula-after-safalaan-returns");
      return true;
    }
    return false;
  }

  function talkVertida(event) {
    const { player, npcId } = event;
    if (!VERTIDA_IDS.has(npcId)) return false;
    const stage = quest.getStage(player);
    if (stage < STAGE_GRAVEYARD || stage >= STAGE_VANSTROM_DEAD) return false;
    if (stage < STAGE_CONVINCING) {
      play(player, npcId, "a-nice-and-simple-plan-speaking-to-the-myreque-talking-to-vertida");
      return true;
    }
    if (stage < STAGE_CONVINCED) {
      if (hasBit(player, BIT_VERTIDA)) {
        play(player, npcId, "a-nice-and-simple-plan-convincing-the-myreque-talking-to-vertida-talking-to-vertida-again");
      } else {
        setConvinced(player, BIT_VERTIDA);
        play(player, npcId, "a-nice-and-simple-plan-convincing-the-myreque-talking-to-vertida");
      }
      return true;
    }
    if (stage < STAGE_LOGS_GIVEN) {
      play(player, npcId, "the-final-preparations-talking-to-vertida-without-eight-blisterwood-logs");
      return true;
    }
    if (stage < STAGE_VERTIDA_LOGS) {
      if (logCount(player) >= 8) {
        play(player, npcId, "the-final-preparations-talking-to-vertida-with-eight-blisterwood-logs");
      } else {
        play(player, npcId, "the-final-preparations-talking-to-vertida-without-eight-blisterwood-logs");
      }
      return true;
    }
    if (stage < STAGE_FLAIL) {
      play(player, npcId, "the-final-preparations-talking-to-vertida-with-eight-blisterwood-logs-talking-to-vertida-again");
      return true;
    }
    if (stage < STAGE_SAFALAAN_WALK) {
      play(player, npcId, "the-final-preparations-talking-to-vertida-with-eight-blisterwood-logs-talking-to-vertida-with-a-blisterwood-flail");
      advance(player, STAGE_SAFALAAN_WALK);
      return true;
    }
    say(player, npcId, "Myreque prevail, friend.");
    return true;
  }

  function talkKael(event) {
    const { player, npcId } = event;
    if (!KAEL_IDS.has(npcId)) return false;
    const stage = quest.getStage(player);
    if (stage < STAGE_GRAVEYARD || stage >= STAGE_CASTLE) return false;
    if (stage < STAGE_CONVINCING) {
      play(player, npcId, "a-nice-and-simple-plan-speaking-to-the-myreque-talking-to-kael");
      return true;
    }
    if (stage < STAGE_CONVINCED) {
      if (hasBit(player, BIT_KAEL)) {
        play(player, npcId, "a-nice-and-simple-plan-convincing-the-myreque-talking-to-kael-talking-to-kael-again-after-convincing-him");
      } else {
        setConvinced(player, BIT_KAEL);
        play(player, npcId, "a-nice-and-simple-plan-convincing-the-myreque-talking-to-kael");
      }
      return true;
    }
    if (stage < STAGE_LOGS_GIVEN) {
      play(player, npcId, "a-nice-and-simple-plan-weapons-upgrade-talking-to-kael");
      return true;
    }
    say(player, npcId, "Good to see you, friend.");
    return true;
  }

  function talkRadigad(event) {
    const { player, npcId } = event;
    if (!RADIGAD_IDS.has(npcId)) return false;
    const stage = quest.getStage(player);
    if (stage < STAGE_GRAVEYARD || stage >= STAGE_CASTLE) return false;
    if (stage < STAGE_CONVINCING) {
      play(player, npcId, "a-nice-and-simple-plan-speaking-to-the-myreque-talking-to-radigad");
      return true;
    }
    if (stage < STAGE_CONVINCED) {
      if (hasBit(player, BIT_RADIGAD)) {
        play(player, npcId, "a-nice-and-simple-plan-convincing-the-myreque-talking-to-radigad-talking-to-radigad-again-after-convincing-him");
      } else {
        setConvinced(player, BIT_RADIGAD);
        play(player, npcId, "a-nice-and-simple-plan-convincing-the-myreque-talking-to-radigad");
      }
      return true;
    }
    if (stage < STAGE_LOGS_GIVEN) {
      play(player, npcId, "a-nice-and-simple-plan-weapons-upgrade-talking-to-radigad");
      return true;
    }
    say(player, npcId, "Well met, friend.");
    return true;
  }

  function talkPolmafi(event) {
    const { player, npcId } = event;
    if (!POLMAFI_IDS.has(npcId)) return false;
    const stage = quest.getStage(player);
    if (stage < STAGE_GRAVEYARD || stage >= STAGE_VANSTROM_DEAD) return false;
    if (stage < STAGE_CONVINCING) {
      play(player, npcId, "a-nice-and-simple-plan-speaking-to-the-myreque-talking-to-polmafi");
      return true;
    }
    if (stage < STAGE_CONVINCED) {
      if (hasBit(player, BIT_POLMAFI)) {
        play(player, npcId, "a-nice-and-simple-plan-convincing-the-myreque-talking-to-polmafi-talking-to-polmafi-again-after-convincing-him");
      } else if (hasBit(player, BIT_RADIGAD)) {
        setConvinced(player, BIT_POLMAFI);
        play(player, npcId, "a-nice-and-simple-plan-convincing-the-myreque-talking-to-polmafi-talking-to-polmafi-again-after-talking-to-radigad");
      } else if (hasBit(player, BIT_VERTIDA) || hasBit(player, BIT_KAEL) || hasBit(player, BIT_IVAN)) {
        play(player, npcId, "a-nice-and-simple-plan-convincing-the-myreque-talking-to-polmafi-talking-to-polmafi-again-before-talking-to-radigad");
      } else {
        play(player, npcId, "a-nice-and-simple-plan-convincing-the-myreque-talking-to-polmafi");
      }
      return true;
    }
    if (stage < STAGE_DISGUISE_BRIEF) {
      play(player, npcId, "a-nice-and-simple-plan-weapons-upgrade-talking-to-polmafi");
      return true;
    }
    if (stage < STAGE_DISGUISE_READY) {
      if (hasVyrewatchOutfit(player) || hasVyreNoble(player)) {
        play(player, npcId, "a-vyre-ry-noble-disguise-meiyerditch-hideout-talking-to-polmafi-if-the-player-already-have-a-vyrewatch-outfit");
      } else {
        play(player, npcId, "a-vyre-ry-noble-disguise-meiyerditch-hideout-talking-to-polmafi-if-the-player-does-not-already-have-a-vyrewatch-outfit");
      }
      return true;
    }
    if (stage < STAGE_LOGS_GIVEN) {
      play(player, npcId, "a-vyre-ry-noble-disguise-meiyerditch-hideout-talking-to-polmafi-if-the-player-does-not-already-have-a-vyrewatch-outfit-talking-to-polmafi-again-without-getting-a-vyrewatch-outfit");
      return true;
    }
    say(player, npcId, "Be careful out there, friend.");
    return true;
  }

  function talkIvan(event) {
    const { player, npcId } = event;
    if (!IVAN_IDS.has(npcId)) return false;
    const stage = quest.getStage(player);
    if (quest.isComplete(player)) {
      if (!held(player, TOME_ITEM_ID) && npcId !== IVAN_ESCORT_ID) {
        play(player, npcId, "shattered-after-escaping-from-castle-drakan-recovering-a-lost-tome-of-experience-from-ivan");
        return true;
      }
      return false;
    }
    // A relog between Vanstrom's death and the escape scene leaves the finale
    // unfinished; Ivan replays it so the player is never stranded at stage 280.
    if (stage >= STAGE_VANSTROM_DEAD) {
      play(player, npcId, "shattered-after-escaping-from-castle-drakan");
      return true;
    }
    if (stage < STAGE_PATERDOMUS || stage >= STAGE_VANSTROM_DEAD) return false;
    if (stage < STAGE_MEETING) {
      play(player, npcId, "an-unwelcome-surprise-meeting-at-the-haunted-woods");
      return true;
    }
    if (stage < STAGE_ESCORT) {
      play(player, npcId, "an-unwelcome-surprise-escorting-ivan-again");
      return true;
    }
    if (stage < STAGE_ESCORT_DONE) {
      // If the final juvinate died while the finishing cutscene was lost (a
      // weapon swap or log during it), replay it so the trek cannot soft-lock.
      if (field(player, NAIL_SHIFT) >= 2 && field(player, JUVI_SHIFT) >= 2) {
        play(player, npcId, "an-unwelcome-surprise-escorting-ivan-again-finishing-temple-trekking");
      } else {
        play(player, npcId, "an-unwelcome-surprise-escorting-ivan-again-talking-to-ivan-during-temple-trekking");
      }
      return true;
    }
    if (stage < STAGE_GRAVEYARD) {
      play(player, npcId, "an-unwelcome-surprise-talking-to-veliaf-at-burgh-de-rott-talking-to-ivan-again");
      return true;
    }
    if (stage < STAGE_CONVINCING) {
      play(player, npcId, "a-nice-and-simple-plan-speaking-to-the-myreque-talking-to-ivan");
      return true;
    }
    if (stage < STAGE_CONVINCED) {
      if (hasBit(player, BIT_IVAN)) {
        play(player, npcId, "a-nice-and-simple-plan-convincing-the-myreque-talking-to-ivan-talking-to-ivan-again-after-convincing-him");
      } else {
        setConvinced(player, BIT_IVAN);
        play(player, npcId, "a-nice-and-simple-plan-convincing-the-myreque-talking-to-ivan");
      }
      return true;
    }
    if (stage < STAGE_SAFALAAN_WALK) {
      if (npcId === IVAN_ESCORT_ID) return false;
      play(player, npcId, "the-final-preparations-calm-before-the-storm-talking-to-ivan");
      return true;
    }
    return false;
  }

  function talkMaria(event) {
    const { player, npcId } = event;
    if (!MARIA_IDS.has(npcId)) return false;
    const stage = quest.getStage(player);
    if (stage < STAGE_MORDAN || stage >= STAGE_ARBORETUM) return false;
    if (stage < STAGE_SLAVES_DONE) {
      play(player, npcId, "the-branches-of-darkmeyer-infiltrating-darkmeyer-lord-jovkai-s-prison-talking-to-maria-gadderanks");
      advance(player, STAGE_SLAVES_DONE);
      return true;
    }
    play(player, npcId, "the-branches-of-darkmeyer-infiltrating-darkmeyer-lord-jovkai-s-prison-talking-to-maria-afterwards");
    return true;
  }

  function talkMordan(event) {
    const { player, npcId } = event;
    if (!MORDAN_IDS.has(npcId)) return false;
    const stage = quest.getStage(player);
    if (stage < STAGE_DARKMEYER || stage >= STAGE_ARBORETUM) return false;
    if (stage < STAGE_PRISON) {
      play(player, npcId, "the-branches-of-darkmeyer-infiltrating-darkmeyer-talking-to-mordan");
      advance(player, STAGE_PRISON);
      return true;
    }
    if (stage < STAGE_SLAVES_DONE) {
      play(player, npcId, "the-branches-of-darkmeyer-infiltrating-darkmeyer-talking-to-mordan-talking-to-mordan-again-before-finding-desmodus-slaves");
      return true;
    }
    play(player, npcId, "the-branches-of-darkmeyer-infiltrating-darkmeyer-talking-to-mordan-talking-to-mordan-again-after-finding-desmodus-slaves");
    return true;
  }

  function talkDesmodus(event) {
    const { player, npcId } = event;
    if (!DESMODUS_IDS.has(npcId)) return false;
    const stage = quest.getStage(player);
    if (stage < STAGE_DARKMEYER || stage >= STAGE_LOGS) return false;
    if (stage < STAGE_MORDAN) {
      play(player, npcId, "the-branches-of-darkmeyer-infiltrating-darkmeyer-talking-to-desmodus-lasiurus-before-attempting-to-enter-the-arboretum");
      advance(player, STAGE_MORDAN);
      return true;
    }
    if (stage < STAGE_PRISON) {
      play(player, npcId, "the-branches-of-darkmeyer-infiltrating-darkmeyer-attempting-to-enter-the-arboretum-talking-to-desmodus-again-before-finding-mordan");
      return true;
    }
    if (stage < STAGE_SLAVES_DONE) {
      play(player, npcId, "the-branches-of-darkmeyer-infiltrating-darkmeyer-attempting-to-enter-the-arboretum-talking-to-desmodus-after-finding-mordan-but-before-getting-the-slaves-back");
      return true;
    }
    if (stage < STAGE_ARBORETUM) {
      play(player, npcId, "the-branches-of-darkmeyer-infiltrating-darkmeyer-talking-to-desmodus-after-retrieving-the-slaves");
      advance(player, STAGE_ARBORETUM);
      return true;
    }
    play(player, npcId, "the-branches-of-darkmeyer-infiltrating-darkmeyer-talking-to-desmodus-after-retrieving-the-slaves-talking-to-desmodus-again");
    return true;
  }

  // ---------------------------------------------------------------------------
  // Generic variant selector (the generic Talk-to path and the dialogue tests)
  // ---------------------------------------------------------------------------

  function selectVariant(event) {
    const { player, npcId } = event;
    if (!player || !npcId) return null;
    const stage = quest.getStage(player);
    if (stage === STAGE_UNSTARTED) {
      if (VELIAF_IDS.has(npcId) && meetsRequirements(player) && near(player, VELIAF_SLEPE_TILE, 12)) {
        return "slepe-s-sleeper-plague-talking-to-veliaf";
      }
      return null;
    }
    if (quest.isComplete(player)) return null;
    if (VELIAF_IDS.has(npcId)) {
      if (stage < STAGE_HAMELN) return "slepe-s-sleeper-plague-talking-to-veliaf-talking-to-veliaf-again";
      if (stage < STAGE_FOLLOWING) return "slepe-s-sleeper-plague-talking-to-hameln-report-back-to-veliaf";
      if (stage < STAGE_LAB_DESTROYED) return null;
      if (stage < STAGE_VELIAF_REPORTED) return "an-unwelcome-surprise-reporting-back-to-veliaf";
      if (stage < STAGE_PATERDOMUS) return "an-unwelcome-surprise-checking-in-at-paterdomus";
      if (stage < STAGE_MEETING) return "an-unwelcome-surprise-checking-in-at-paterdomus-talking-to-veliaf-again";
      if (stage < STAGE_ESCORT) return "an-unwelcome-surprise-meeting-at-the-haunted-woods";
      if (stage < STAGE_BOATHOUSE) return "an-unwelcome-surprise-talking-to-veliaf-at-burgh-de-rott";
      if (stage < STAGE_GRAVEYARD) return "an-unwelcome-surprise-talking-to-veliaf-at-burgh-de-rott-talking-to-veliaf-again";
      if (stage < STAGE_MUSEUM_TALK) return "a-nice-and-simple-plan-meeting-at-the-icyene-graveyard";
      if (stage < STAGE_PUZZLE_DONE) return "a-nice-and-simple-plan-the-secret-of-safalaan-hallow-part-1-speaking-to-the-myreque-before-unlocking-the-door-talking-to-veliaf";
      if (stage < STAGE_CONVINCED) {
        if (allConvinced(player)) {
          return "a-nice-and-simple-plan-convincing-the-myreque-talking-to-veliaf-talking-to-veliaf-again-after-convincing-everyone-else";
        }
        return hasBit(player, BIT_VELIAF_ASKED)
          ? "a-nice-and-simple-plan-convincing-the-myreque-talking-to-veliaf-talking-to-veliaf-again-before-convincing-everyone-else"
          : "a-nice-and-simple-plan-convincing-the-myreque-talking-to-veliaf";
      }
      if (stage < STAGE_LAB_PLAN) return "a-nice-and-simple-plan-weapons-upgrade-talking-to-veliaf";
      if (stage < STAGE_DISGUISE_READY) return "a-vyre-ry-noble-disguise-talking-to-veliaf-safalaan-or-vanescula-talking-to-veliaf-again";
      if (stage < STAGE_DAMIEN_DONE) return "a-vyre-ry-noble-disguise-going-back-to-slepe-talking-to-veliaf";
      if (stage < STAGE_DARKMEYER_PLAN) return "a-vyre-ry-noble-disguise-going-back-to-slepe-talking-to-veliaf-2";
      if (stage < STAGE_FLAIL) return "the-final-preparations-calm-before-the-storm-talking-to-veliaf-without-a-blisterwood-flail";
      if (stage < STAGE_SAFALAAN_WALK) return "the-final-preparations-calm-before-the-storm-talking-to-veliaf-with-a-blisterwood-flail";
      if (stage < STAGE_CASTLE) return "the-final-preparations-calm-before-the-storm-talking-to-veliaf-with-a-blisterwood-flail-talking-to-veliaf-again";
      if (stage < STAGE_VANSTROM_DEAD) {
        return hasBlisterwoodFlail(player)
          ? "a-bloody-show-vanstrom-during-the-fight-talking-to-veliaf-after-leaving-the-fight"
          : "a-bloody-show-vanstrom-during-the-fight-talking-to-veliaf-after-dying-during-the-fight";
      }
      return null;
    }
    if (SAFALAAN_IDS.has(npcId)) {
      if (stage < STAGE_GRAVEYARD) return null;
      if (stage < STAGE_CONVINCED) return "a-nice-and-simple-plan-the-secret-of-safalaan-hallow-part-1-speaking-to-the-myreque-before-unlocking-the-door-talking-to-safalaan";
      if (stage < STAGE_BLOODVELD) return "a-nice-and-simple-plan-the-meiyerditch-laboratories";
      if (stage < STAGE_BLOODVELD_TALK) return "a-nice-and-simple-plan-after-defeating-the-mutated-bloodveld";
      if (stage < STAGE_LAB_BOOK) return "a-nice-and-simple-plan-after-defeating-the-mutated-bloodveld-talking-to-safalaan-again";
      if (stage < STAGE_LAB_DONE) return "a-nice-and-simple-plan-talking-to-safalaan-after-getting-the-book";
      if (stage < STAGE_SAFALAAN_WALK) return "a-vyre-ry-noble-disguise-talking-to-veliaf-safalaan-or-vanescula-talking-to-safalaan-again";
      if (stage < STAGE_CASTLE) return "the-final-preparations-calm-before-the-storm-talking-to-safalaan";
      return null;
    }
    if (HAMELN_IDS.has(npcId)) {
      if (stage < STAGE_STARTED || stage >= STAGE_FOLLOWING) return null;
      return stage < STAGE_HAMELN
        ? "slepe-s-sleeper-plague-talking-to-hameln"
        : "slepe-s-sleeper-plague-talking-to-hameln-talking-to-hameln-again";
    }
    if (CARL_IDS.has(npcId)) {
      if (stage < STAGE_HAMELN || stage >= STAGE_LAB_DESTROYED) return null;
      return hasBit(player, BIT_CARL_ASKED)
        ? "plague-s-end-talking-to-carl-talking-to-carl-again"
        : "plague-s-end-talking-to-carl";
    }
    if (DREZEL_IDS.has(npcId)) {
      if (stage < STAGE_VELIAF_REPORTED || stage >= STAGE_ESCORT) return null;
      return stage < STAGE_MEETING
        ? "an-unwelcome-surprise-checking-in-at-paterdomus-talking-to-drezel-again"
        : "an-unwelcome-surprise-talking-to-drezel-after-attending-the-meeting";
    }
    if (IVAN_IDS.has(npcId)) {
      if (stage < STAGE_PATERDOMUS) return null;
      if (stage < STAGE_MEETING) return "an-unwelcome-surprise-meeting-at-the-haunted-woods";
      if (stage < STAGE_ESCORT) return "an-unwelcome-surprise-escorting-ivan-again";
      if (stage < STAGE_ESCORT_DONE) return "an-unwelcome-surprise-escorting-ivan-again-talking-to-ivan-during-temple-trekking";
      if (stage < STAGE_GRAVEYARD) return "an-unwelcome-surprise-talking-to-veliaf-at-burgh-de-rott-talking-to-ivan-again";
      if (stage < STAGE_CONVINCING) return "a-nice-and-simple-plan-speaking-to-the-myreque-talking-to-ivan";
      if (stage < STAGE_CONVINCED) {
        return hasBit(player, BIT_IVAN)
          ? "a-nice-and-simple-plan-convincing-the-myreque-talking-to-ivan-talking-to-ivan-again-after-convincing-him"
          : "a-nice-and-simple-plan-convincing-the-myreque-talking-to-ivan";
      }
      if (stage < STAGE_SAFALAAN_WALK) return "the-final-preparations-calm-before-the-storm-talking-to-ivan";
      if (stage >= STAGE_VANSTROM_DEAD) return "shattered-after-escaping-from-castle-drakan";
      return null;
    }
    if (VERTIDA_IDS.has(npcId)) {
      if (stage < STAGE_CONVINCING) return "a-nice-and-simple-plan-speaking-to-the-myreque-talking-to-vertida";
      if (stage < STAGE_CONVINCED) {
        return hasBit(player, BIT_VERTIDA)
          ? "a-nice-and-simple-plan-convincing-the-myreque-talking-to-vertida-talking-to-vertida-again"
          : "a-nice-and-simple-plan-convincing-the-myreque-talking-to-vertida";
      }
      if (stage < STAGE_LOGS_GIVEN) return "the-final-preparations-talking-to-vertida-without-eight-blisterwood-logs";
      if (stage < STAGE_VERTIDA_LOGS) return "the-final-preparations-talking-to-vertida-with-eight-blisterwood-logs";
      if (stage < STAGE_FLAIL) return "the-final-preparations-talking-to-vertida-with-eight-blisterwood-logs-talking-to-vertida-again";
      return "the-final-preparations-talking-to-vertida-with-eight-blisterwood-logs-talking-to-vertida-with-a-blisterwood-flail";
    }
    if (KAEL_IDS.has(npcId)) {
      if (stage < STAGE_CONVINCING) return "a-nice-and-simple-plan-speaking-to-the-myreque-talking-to-kael";
      if (stage < STAGE_CONVINCED) {
        return hasBit(player, BIT_KAEL)
          ? "a-nice-and-simple-plan-convincing-the-myreque-talking-to-kael-talking-to-kael-again-after-convincing-him"
          : "a-nice-and-simple-plan-convincing-the-myreque-talking-to-kael";
      }
      return "a-nice-and-simple-plan-weapons-upgrade-talking-to-kael";
    }
    if (RADIGAD_IDS.has(npcId)) {
      if (stage < STAGE_CONVINCING) return "a-nice-and-simple-plan-speaking-to-the-myreque-talking-to-radigad";
      if (stage < STAGE_CONVINCED) {
        return hasBit(player, BIT_RADIGAD)
          ? "a-nice-and-simple-plan-convincing-the-myreque-talking-to-radigad-talking-to-radigad-again-after-convincing-him"
          : "a-nice-and-simple-plan-convincing-the-myreque-talking-to-radigad";
      }
      return "a-nice-and-simple-plan-weapons-upgrade-talking-to-radigad";
    }
    if (POLMAFI_IDS.has(npcId)) {
      if (stage < STAGE_CONVINCING) return "a-nice-and-simple-plan-speaking-to-the-myreque-talking-to-polmafi";
      if (stage < STAGE_CONVINCED) {
        if (hasBit(player, BIT_POLMAFI)) return "a-nice-and-simple-plan-convincing-the-myreque-talking-to-polmafi-talking-to-polmafi-again-after-convincing-him";
        if (hasBit(player, BIT_RADIGAD)) return "a-nice-and-simple-plan-convincing-the-myreque-talking-to-polmafi-talking-to-polmafi-again-after-talking-to-radigad";
        return hasBit(player, BIT_VERTIDA) || hasBit(player, BIT_KAEL) || hasBit(player, BIT_IVAN)
          ? "a-nice-and-simple-plan-convincing-the-myreque-talking-to-polmafi-talking-to-polmafi-again-before-talking-to-radigad"
          : "a-nice-and-simple-plan-convincing-the-myreque-talking-to-polmafi";
      }
      return "a-nice-and-simple-plan-weapons-upgrade-talking-to-polmafi";
    }
    if (VANESCULA_IDS.has(npcId)) {
      if (stage < STAGE_MUSEUM_TALK || stage >= STAGE_CASTLE) return null;
      if (stage < STAGE_PUZZLE_DONE) return "a-nice-and-simple-plan-the-secret-of-safalaan-hallow-part-1-speaking-to-the-myreque-before-unlocking-the-door-talking-to-vanescula";
      if (stage < STAGE_CONVINCED) return "a-nice-and-simple-plan-convincing-the-myreque-talking-to-vanescula";
      if (stage < STAGE_LAB_PLAN) return "a-nice-and-simple-plan-weapons-upgrade";
      if (stage < STAGE_LAB_DONE) return "a-nice-and-simple-plan-weapons-upgrade-talking-to-vanescula";
      if (stage < STAGE_DISGUISE_BRIEF) return "a-vyre-ry-noble-disguise-talking-to-veliaf-safalaan-or-vanescula";
      if (stage < STAGE_DISGUISE_READY) {
        return hasVyreNoble(player)
          ? "a-vyre-ry-noble-disguise-kill-two-birds-with-one-stone-talking-to-vanescula-after-getting-a-vyre-noble-disguise"
          : "a-vyre-ry-noble-disguise-kill-two-birds-with-one-stone-talking-to-vanescula-before-getting-a-vyre-noble-disguise";
      }
      if (stage < STAGE_DAMIEN_DONE) return "a-vyre-ry-noble-disguise-kill-two-birds-with-one-stone-talking-to-vanescula-again";
      if (stage < STAGE_DARKMEYER) return "the-branches-of-darkmeyer-talking-to-vanescula-with-the-scented-disguise";
      if (stage < STAGE_LOGS) return "the-branches-of-darkmeyer-talking-to-vanescula-with-the-scented-disguise-talking-to-vanescula-again";
      if (stage < STAGE_LOGS_GIVEN) {
        return logCount(player) >= 8
          ? "the-final-preparations-talking-to-vanescula-with-eight-blisterwood-logs"
          : "the-final-preparations-talking-to-vanescula-without-eight-blisterwood-logs";
      }
      if (stage < STAGE_FLAIL) return "the-final-preparations-talking-to-vanescula-with-eight-blisterwood-logs-talking-to-vanescula-again";
      if (stage < STAGE_READY) return "the-final-preparations-calm-before-the-storm-talking-to-veliaf-with-a-blisterwood-flail-talking-to-vanescula-again";
      return "the-final-preparations-calm-before-the-storm-talking-to-vanescula-after-safalaan-returns";
    }
    if (MARIA_IDS.has(npcId)) {
      if (stage < STAGE_MORDAN || stage >= STAGE_ARBORETUM) return null;
      return stage < STAGE_SLAVES_DONE
        ? "the-branches-of-darkmeyer-infiltrating-darkmeyer-lord-jovkai-s-prison-talking-to-maria-gadderanks"
        : "the-branches-of-darkmeyer-infiltrating-darkmeyer-lord-jovkai-s-prison-talking-to-maria-afterwards";
    }
    if (MORDAN_IDS.has(npcId)) {
      if (stage < STAGE_DARKMEYER || stage >= STAGE_ARBORETUM) return null;
      if (stage < STAGE_PRISON) return "the-branches-of-darkmeyer-infiltrating-darkmeyer-talking-to-mordan";
      return stage < STAGE_SLAVES_DONE
        ? "the-branches-of-darkmeyer-infiltrating-darkmeyer-talking-to-mordan-talking-to-mordan-again-before-finding-desmodus-slaves"
        : "the-branches-of-darkmeyer-infiltrating-darkmeyer-talking-to-mordan-talking-to-mordan-again-after-finding-desmodus-slaves";
    }
    if (DESMODUS_IDS.has(npcId)) {
      if (stage < STAGE_DARKMEYER || stage >= STAGE_LOGS) return null;
      if (stage < STAGE_MORDAN) return "the-branches-of-darkmeyer-infiltrating-darkmeyer-talking-to-desmodus-lasiurus-before-attempting-to-enter-the-arboretum";
      if (stage < STAGE_PRISON) return "the-branches-of-darkmeyer-infiltrating-darkmeyer-attempting-to-enter-the-arboretum-talking-to-desmodus-again-before-finding-mordan";
      if (stage < STAGE_SLAVES_DONE) return "the-branches-of-darkmeyer-infiltrating-darkmeyer-attempting-to-enter-the-arboretum-talking-to-desmodus-after-finding-mordan-but-before-getting-the-slaves-back";
      if (stage < STAGE_ARBORETUM) return "the-branches-of-darkmeyer-infiltrating-darkmeyer-talking-to-desmodus-after-retrieving-the-slaves";
      return "the-branches-of-darkmeyer-infiltrating-darkmeyer-talking-to-desmodus-after-retrieving-the-slaves-talking-to-desmodus-again";
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // NPC deaths
  // ---------------------------------------------------------------------------

  function handleNpcDeath(event) {
    const killer = event.killer;
    if (!killer || killer.isPlayer?.() !== true) return;
    const player = killer;
    const stage = quest.getStage(player);
    if (event.npcId === KROY_FIGHT_ID && stage >= STAGE_KROY_FIGHT && stage < STAGE_KROY_DEAD) {
      despawnKey(player, "kroy_fight");
      advance(player, STAGE_KROY_DEAD);
      play(player, KROY_FIGHT_ID, "plague-s-end-after-killing-kroy");
      player.sendMessage("You should destroy the two lab tables.");
      return;
    }
    if (event.npcId === BLOODVELD_ID && stage === STAGE_BLOODVELD) {
      despawnKey(player, "bloodveld");
      player.sendMessage("Safalaan: Well done... now help me up.");
      return;
    }
    if (event.npcId === DAMIEN_FIGHT_ID && stage >= STAGE_DISGUISE_READY && stage < STAGE_DAMIEN_DONE) {
      despawnKey(player, "damien_fight");
      play(player, DAMIEN_FIGHT_ID, "a-vyre-ry-noble-disguise-going-back-to-slepe-death-of-damien");
      return;
    }
    if (stage === STAGE_ESCORT) {
      if (event.npcId === NAIL_BEAST_IDS[0] || event.npcId === NAIL_BEAST_IDS[1]) {
        api.removeNpc(event.npc);
        const kills = field(player, NAIL_SHIFT) + 1;
        setField(player, NAIL_SHIFT, 2, kills);
        if (kills >= 2) player.sendMessage("You repair the rotten bridge and continue the trek.");
        applyStageSpawns(player);
        return;
      }
      if (event.npcId === JUVI_IDS[0] || event.npcId === JUVI_IDS[1]) {
        api.removeNpc(event.npc);
        const kills = field(player, JUVI_SHIFT) + 1;
        setField(player, JUVI_SHIFT, 2, kills);
        if (kills >= 2) {
          later(player, 1, () =>
            play(player, IVAN_ESCORT_ID, "an-unwelcome-surprise-escorting-ivan-again-finishing-temple-trekking")
          );
        } else {
          applyStageSpawns(player);
        }
        return;
      }
    }
    if (event.npcId === VANSTROM_FIGHT_ID && stage >= STAGE_CASTLE && stage < STAGE_VANSTROM_DEAD) {
      despawnKey(player, "vanstrom_fight");
      play(player, VANSTROM_FIGHT_ID, "shattered-after-defeating-vanstrom");
    }
  }

  // ---------------------------------------------------------------------------
  // Object interactions
  // ---------------------------------------------------------------------------

  function handleBarrel(event) {
    const { player } = event;
    const stage = quest.getStage(player);
    if (stage < STAGE_HAMELN || stage >= STAGE_KROY_FIGHT) return false;
    event.handled = true;
    play(player, PROP_ID, "plague-s-end-barrel-investigation");
    return true;
  }

  function handleCrackedWall(event) {
    const { player } = event;
    const stage = quest.getStage(player);
    const location = player.getLocation();
    if (!near(player, { x: 3627, y: 3330 }, 4)) return false;
    event.handled = true;
    if (location.getY() >= 3331) {
      teleport(player, CRACK_MEIYERDITCH);
      return true;
    }
    if (stage < STAGE_DARKMEYER) {
      say(player, PROP_ID, "The crack is too narrow to squeeze through.");
      return true;
    }
    teleport(player, DARKMEYER_ARRIVAL);
    player.sendMessage("You squeeze through the crack into Darkmeyer.");
    return true;
  }

  function openBoatMenu(player) {
    api.sendMultiChatboxPrompt(
      player,
      "Where would you like to sail?",
      "Burgh de Rott.",
      () => teleport(player, BURGH_DOCKS),
      "Slepe.",
      () => teleport(player, SLEPE_DOCK),
      "Icyene Graveyard.",
      () => teleport(player, ICYENE_DOCK)
    );
  }

  function handleBoat(event) {
    const { player } = event;
    event.handled = true;
    const stage = quest.getStage(player);
    if (quest.isComplete(player)) {
      openBoatMenu(player);
      return true;
    }
    if (near(player, BURGH_DOCKS, 4) && stage >= STAGE_ESCORT_DONE) {
      teleport(player, ICYENE_DOCK);
      if (stage < STAGE_GRAVEYARD) advance(player, STAGE_GRAVEYARD);
      return true;
    }
    if (near(player, ICYENE_DOCK, 4) && stage >= STAGE_GRAVEYARD) {
      teleport(player, BURGH_DOCKS);
      return true;
    }
    return true;
  }

  function handleObjectInteraction(event) {
    const { player, objectId } = event;
    if (!player) return;
    if (objectId === BARREL_OBJECT_ID) {
      handleBarrel(event);
      return;
    }
    if (objectId === CRACKED_WALL_OBJECT_ID) {
      handleCrackedWall(event);
      return;
    }
    if (objectId === BOAT_OBJECT_ID) {
      handleBoat(event);
      return;
    }
    if (objectId === HIDEOUT_CRATE_OBJECT_ID) {
      if (quest.getStage(player) < STAGE_LOGS_GIVEN) return;
      event.handled = true;
      if (!held(player, SILVER_SICKLE_BLESSED_ITEM_ID)) {
        give(player, SILVER_SICKLE_BLESSED_ITEM_ID, 1);
      }
      return;
    }
    if (objectId === SWAMP_TREE_OBJECT_ID) {
      if (quest.getStage(player) !== STAGE_ESCORT) return;
      event.handled = true;
      if (!hasBit(player, BIT_TREK)) {
        if (held(player, LONG_VINE_ITEM_ID)) {
          play(player, IVAN_ESCORT_ID, "an-unwelcome-surprise-escorting-ivan-again-after-crossing");
          setBit(player, BIT_TREK);
          teleport(player, TREK_CROSSED);
        } else {
          play(player, IVAN_ESCORT_ID, "an-unwelcome-surprise-escorting-ivan-again-vine-puzzle");
        }
      } else {
        teleport(player, TREK_CROSSED);
      }
      return;
    }
    if (objectId === LAB_ESCAPE_GATE_ID) {
      if (quest.getStage(player) < STAGE_KROY_DEAD) return;
      event.handled = true;
      teleport(player, { x: 3726, y: 3356, z: 0 });
      return;
    }
  }

  function handleClimbRequest(request) {
    if (request.handled || request.clickType !== 1) return;
    if (request.objectId !== CRYPT_STAIRS_OBJECT_ID) return;
    const { player, object } = request;
    const location = object?.getLocation?.();
    if (!player || !location || location.getZ() !== 0) return;
    const stage = quest.getStage(player);
    if (stage < STAGE_FOLLOWING || stage >= STAGE_LAB_DESTROYED) return;
    request.handled = true;
    teleport(player, CRYPT_LANDING);
    later(player, 1, () => play(player, PROP_ID, "plague-s-end-eavesdropping-on-carl"));
  }

  function handleDoorToggle(request) {
    if (request.handled || !request.player) return;
    if (!ARBORETUM_DOOR_IDS.has(request.objectId)) return;
    const stage = quest.getStage(request.player);
    if (stage >= STAGE_ARBORETUM) return;
    if (stage < STAGE_DARKMEYER) return;
    request.handled = true;
    play(request.player, NpcIdentifiers.DESMODUS_LASIURUS, "the-branches-of-darkmeyer-infiltrating-darkmeyer-attempting-to-enter-the-arboretum");
  }

  function destroyLabTable(event) {
    const { player } = event;
    if (quest.getStage(player) < STAGE_KROY_DEAD || quest.getStage(player) >= STAGE_LAB_DESTROYED) return false;
    const location = event.location ?? event.object?.getLocation?.();
    if (!location) return false;
    const tile = KROY_TABLE_TILES.find(
      (entry) => entry.x === location.x && entry.y === location.y && entry.z === location.z
    );
    if (!tile) return false;
    event.handled = true;
    const bit = tile === KROY_TABLE_TILES[0] ? BIT_TABLE_1 : BIT_TABLE_2;
    if (!hasBit(player, bit)) {
      setBit(player, bit);
      syncQuestObjects(player);
      syncVisuals(player);
      player.sendMessage("You smash the lab table.");
    }
    if (hasBit(player, BIT_TABLE_1) && hasBit(player, BIT_TABLE_2)) {
      advance(player, STAGE_LAB_DESTROYED);
      play(player, PROP_ID, "plague-s-end-after-destroying-the-lab-tables");
    }
    return true;
  }

  function unlockMausoleum(event) {
    const { player } = event;
    if (!near(player, MAUSOLEUM_DOOR_TILE, 6)) return false;
    const stage = quest.getStage(player);
    if (stage < STAGE_MUSEUM_TALK) return false;
    if (stage >= STAGE_PUZZLE_DONE) return false;
    event.handled = true;
    if (!hasBit(player, BIT_PUZZLE_PLAYED)) {
      setBit(player, BIT_PUZZLE_PLAYED);
      play(player, VANESCULA_ID, "a-nice-and-simple-plan-the-secret-of-safalaan-hallow-part-1");
      return true;
    }
    say(player, VANESCULA_ID, "The puzzle shifts under your fingers, and the door swings open.");
    syncQuestObjects(player);
    // The puzzle phase and the convincing phase share one conversation: solving
    // the lock starts the convincing stage (there is no stop at 127; the door
    // swap and varbit mirror only need >= STAGE_PUZZLE_DONE).
    advance(player, STAGE_CONVINCING);
    later(player, 1, () => play(player, SAFALAAN_ID, "a-nice-and-simple-plan-the-secret-of-safalaan-hallow-part-2"));
    return true;
  }

  function openMausoleum(event) {
    const { player } = event;
    if (!near(player, MAUSOLEUM_DOOR_TILE, 6)) return false;
    if (quest.getStage(player) < STAGE_PUZZLE_DONE) return false;
    event.handled = true;
    teleport(player, MAUSOLEUM_INSIDE);
    return true;
  }

  function searchArboretumShelves(event) {
    const { player, objectId } = event;
    if (objectId !== ARBORETUM_SHELVES_OBJECT_ID) return false;
    if (quest.getStage(player) < STAGE_ARBORETUM) return false;
    event.handled = true;
    if (!held(player, OLD_NOTE_ITEM_ID)) {
      give(player, OLD_NOTE_ITEM_ID, 1);
      player.sendMessage("You find an old note among the fallen shelves.");
    } else {
      player.sendMessage("You search the shelves but find nothing else of interest.");
    }
    return true;
  }

  function turnValve(event) {
    const { player, objectId } = event;
    if (objectId !== VALVE_NORTH_OBJECT_ID && objectId !== VALVE_SOUTH_OBJECT_ID) return false;
    if (quest.getStage(player) < STAGE_ARBORETUM) return false;
    event.handled = true;
    const shift = objectId === VALVE_NORTH_OBJECT_ID ? VALVE_NORTH_SHIFT : VALVE_SOUTH_SHIFT;
    const step = objectId === VALVE_NORTH_OBJECT_ID ? 7 : 4;
    const current = field(player, shift, 3);
    setField(player, shift, 3, (current + 1) % 6);
    const required = requiredGallons(player);
    if (waterTotal(player) === required) {
      player.sendMessage("Water begins to flow through the arboretum's irrigation.");
    } else {
      player.sendMessage(`The valve turns. ${step} more gallons flow per interval.`);
    }
    return true;
  }

  function chopBlisterwood(event) {
    const { player } = event;
    if (quest.getStage(player) < STAGE_ARBORETUM || quest.getStage(player) >= STAGE_LOGS) return false;
    event.handled = true;
    const required = requiredGallons(player);
    if (waterTotal(player) !== required) {
      player.sendMessage("The tree is too dry to cut. You should set the valves by the entrance.");
      return true;
    }
    if (!hasAxe(player)) {
      player.sendMessage("You need an axe to chop the Blisterwood tree.");
      return true;
    }
    if (logCount(player) >= 8) return true;
    give(player, BLISTERWOOD_LOGS_ITEM_ID, 1);
    if (logCount(player) >= 8) {
      advance(player, STAGE_LOGS);
      player.sendMessage("You have eight blisterwood logs.");
    }
    return true;
  }

  function searchLabBookshelf(event) {
    const { player, objectId } = event;
    if (objectId !== LAB_BOOKSHELF_OBJECT_ID) return false;
    const stage = quest.getStage(player);
    if (stage < STAGE_BLOODVELD_TALK || stage >= STAGE_LAB_DONE) return false;
    event.handled = true;
    if (!held(player, HAEMALCHEMY_VOL_2_ITEM_ID)) {
      give(player, HAEMALCHEMY_VOL_2_ITEM_ID, 1);
      player.sendMessage("You find a book of haemalchemy research on the bookshelf.");
      if (stage < STAGE_LAB_BOOK) advance(player, STAGE_LAB_BOOK);
    } else {
      player.sendMessage("You search the bookshelf but find nothing else of interest.");
    }
    return true;
  }

  // ---------------------------------------------------------------------------
  // Item handlers
  // ---------------------------------------------------------------------------

  function handleItemOnObject(event) {
    const { player, itemId, objectId } = event;
    if (!player) return;
    if (objectId === SWAMP_TREE_OBJECT_ID && itemId === KNIFE_ITEM_ID) {
      if (quest.getStage(player) !== STAGE_ESCORT || hasBit(player, BIT_TREK)) return;
      event.handled = true;
      if (!held(player, LONG_VINE_ITEM_ID)) {
        give(player, LONG_VINE_ITEM_ID, 1);
        player.sendMessage("You cut three vines and wind them into a long vine.");
      }
      return;
    }
  }

  function handleItemOnItem(event) {
    const { player, usedItemId, usedWithItemId } = event;
    if (!player) return;
    const pair = new Set([usedItemId, usedWithItemId]);
    const stage = quest.getStage(player);
    if (pair.has(RUBY_ITEM_ID) && pair.has(SILVER_SICKLE_BLESSED_ITEM_ID)) {
      if (stage < STAGE_LOGS_GIVEN || stage >= STAGE_FLAIL) return;
      event.handled = true;
      if (!held(player, CHISEL_ITEM_ID)) {
        player.sendMessage("You need a chisel to set the ruby into the sickle.");
        return;
      }
      player.getInventory().deleteNumber(RUBY_ITEM_ID, 1);
      player.getInventory().deleteNumber(SILVER_SICKLE_BLESSED_ITEM_ID, 1);
      give(player, RUBY_SICKLE_ITEM_ID, 1);
      player.sendMessage("You embed the ruby into the silver sickle.");
      return;
    }
    if (pair.has(COSMIC_RUNE_ITEM_ID) && pair.has(RUBY_SICKLE_ITEM_ID)) {
      if (stage < STAGE_LOGS_GIVEN || stage >= STAGE_FLAIL) return;
      event.handled = true;
      if (!held(player, FIRE_RUNE_ITEM_ID, 5)) {
        player.sendMessage("You need 5 fire runes and a cosmic rune for Lvl-3 Enchant.");
        return;
      }
      player.getInventory().deleteNumber(COSMIC_RUNE_ITEM_ID, 1);
      player.getInventory().deleteNumber(FIRE_RUNE_ITEM_ID, 5);
      player.getInventory().deleteNumber(RUBY_SICKLE_ITEM_ID, 1);
      give(player, ENCHANTED_RUBY_SICKLE_ITEM_ID, 1);
      player.sendMessage("You enchant the ruby sickle.");
      return;
    }
    if (pair.has(BLISTERWOOD_LOGS_ITEM_ID) && pair.has(ENCHANTED_RUBY_SICKLE_ITEM_ID)) {
      if (stage < STAGE_LOGS_GIVEN || stage >= STAGE_FLAIL) return;
      event.handled = true;
      if (!held(player, KNIFE_ITEM_ID)) {
        player.sendMessage("You need a knife to carve the blisterwood.");
        return;
      }
      player.getInventory().deleteNumber(BLISTERWOOD_LOGS_ITEM_ID, 1);
      player.getInventory().deleteNumber(ENCHANTED_RUBY_SICKLE_ITEM_ID, 1);
      give(player, BLISTERWOOD_SICKLE_ITEM_ID, 1);
      player.sendMessage("You carve a blisterwood sickle.");
      return;
    }
    if (pair.has(BLISTERWOOD_SICKLE_ITEM_ID) && pair.has(IVANDIS_FLAIL_ITEM_ID)) {
      if (stage < STAGE_LOGS_GIVEN || stage >= STAGE_FLAIL) return;
      event.handled = true;
      player.getInventory().deleteNumber(BLISTERWOOD_SICKLE_ITEM_ID, 1);
      player.getInventory().deleteNumber(IVANDIS_FLAIL_ITEM_ID, 1);
      give(player, BLISTERWOOD_FLAIL_ITEM_ID, 1);
      give(player, ENCHANTED_EMERALD_SICKLE_ITEM_ID, 1);
      advance(player, STAGE_FLAIL);
      player.sendMessage("You attach the blisterwood sickle to the Ivandis flail.");
      return;
    }
  }

  function readTome(event) {
    const { player, itemId, item, slot } = event;
    if (itemId !== TOME_ITEM_ID) return false;
    if (!quest.isComplete(player)) return false;
    if (player.getInventory().get(slot) !== item) return false;
    const chapters = Number(player.getAttribute(TOME_USES_ATTRIBUTE)) || 0;
    if (chapters >= TOME_MAX_CHAPTERS) return true;
    api.emitCustomEvent("xpreward:open", {
      player,
      minLevel: 60,
      title: "Choose the stat you wish to be advanced!",
      onConfirm: (skill, name) => {
        if (player.getInventory().get(slot) !== item) return null;
        const used = (Number(player.getAttribute(TOME_USES_ATTRIBUTE)) || 0) + 1;
        player.setAttribute(TOME_USES_ATTRIBUTE, used);
        if (used >= TOME_MAX_CHAPTERS) player.getInventory().deleteAtSlot(slot, 1);
        player.getSkillManager().addExperience(skill, 15000, false);
        return `You have been awarded 15,000 ${name} XP!`;
      },
    });
    return true;
  }

  function readOldNote(event) {
    const { player, itemId } = event;
    if (itemId !== OLD_NOTE_ITEM_ID) return false;
    if (quest.getStage(player) < STAGE_ARBORETUM) return false;
    player.sendMessage(`The old note says the tree needs ${requiredGallons(player)} gallons of water.`);
    return true;
  }

  function teleportMedallion(event) {
    const { player, itemId } = event;
    if (itemId !== DRAKANS_MEDALLION_ITEM_ID) return false;
    if (!quest.isComplete(player)) return false;
    api.sendMultiChatboxPrompt(
      player,
      "Where would you like to teleport?",
      "Ver Sinhaza.",
      () => teleport(player, VER_SINHAZA),
      "Slepe.",
      () => teleport(player, SLEPE_DOCK),
      "Darkmeyer.",
      () => teleport(player, DARKMEYER)
    );
    return true;
  }

  // ---------------------------------------------------------------------------
  // Login / relog
  // ---------------------------------------------------------------------------

  function handleLogin({ player }) {
    sweepStaleOwnedNpcs(player);
    installQuestObjects();
    applyStageSpawns(player);
    syncVisuals(player);
    syncQuestObjects(player);
    refreshQuestList(player);
  }

  function handleLogout({ player }) {
    despawnAll(player);
  }

  // ---------------------------------------------------------------------------
  // Registration
  // ---------------------------------------------------------------------------

  api.persistAttribute(BITS_ATTRIBUTE);
  api.persistAttribute(TOME_USES_ATTRIBUTE);
  api.persistAttribute(VAMPYRE_NAME_ATTRIBUTE);

  quest = registerQuest(api, {
    key: "sins_of_the_father",
    name: "Sins of the Father",
    varpId: 2712, // myq5
    varbitId: 7255, // myq5 (bits 0-8)
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 2,
    rewardItemId: TOME_ITEM_ID,
    rewardItemLabel: "Tome of Experience",
    otherRewards: [
      "Access to Darkmeyer",
      "The Blisterwood flail",
      "Boat travel to Slepe and the Icyene Graveyard",
      "Darkmeyer teleport via Drakan's medallion",
    ],
    buildJournal,
    onReward: grantReward,
  });

  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("npc-dialogue:action", handleDialogueAction);
  api.onCustomEvent("npc-dialogue:choice", handleDialogueChoice);
  api.onCustomEvent("npc-dialogue:line", fillTranscriptText);
  api.onCustomEvent("quest:stage-changed", handleStageChanged);
  api.onCustomEvent("ladders:climb", handleClimbRequest);
  api.onCustomEvent("door:toggle", handleDoorToggle);
  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onNpcInteraction("Veliaf Hurtz", { "Talk-to": talkVeliaf });
  api.onNpcInteraction("Safalaan Hallow", { "Talk-to": talkSafalaan });
  api.onNpcInteraction("Vanescula Drakan", { "Talk-to": talkVanescula });
  api.onNpcInteraction("Vertida Sefalatis", { "Talk-to": talkVertida });
  api.onNpcInteraction("Kael Forshaw", { "Talk-to": talkKael });
  api.onNpcInteraction("Radigad Ponfit", { "Talk-to": talkRadigad });
  api.onNpcInteraction("Polmafi Ferdygris", { "Talk-to": talkPolmafi });
  api.onNpcInteraction("Ivan Strom", { "Talk-to": talkIvan });
  api.onNpcInteraction("Drezel", { "Talk-to": talkDrezel });
  api.onNpcInteraction("Hameln the Jester", { "Talk-to": talkHameln });
  api.onNpcInteraction("Carl", { "Talk-to": talkCarl });
  api.onNpcInteraction("Maria Gadderanks", { "Talk-to": talkMaria });
  api.onNpcInteraction("Mordan Nikazsi", { "Talk-to": talkMordan });
  api.onNpcInteraction("Desmodus Lasiurus", { "Talk-to": talkDesmodus });
  api.onObjectInteraction("Barrel", { Inspect: handleBarrel });
  api.onObjectInteraction("Cracked wall", { Enter: handleCrackedWall });
  api.onObjectInteraction("Blisterwood tree", { Chop: chopBlisterwood });
  api.onObjectInteraction("Bookshelf", { Search: searchLabBookshelf });
  api.onObjectInteraction("Shelves", { Search: searchArboretumShelves });
  api.onObjectInteraction("Valve", { Turn: turnValve });
  api.onObjectInteraction("Lab table", { Destroy: destroyLabTable });
  api.onObjectInteraction("Mausoleum door", { Unlock: unlockMausoleum, Open: openMausoleum });
  api.onObjectInteraction(handleObjectInteraction);
  api.onItemOnObject(handleItemOnObject, { noted: false });
  api.onItemOnItem(handleItemOnItem);
  api.onItemAction("Tome of Experience", { Read: readTome });
  api.onItemAction("Old note", { Read: readOldNote });
  api.onItemAction("Drakan's medallion", { Teleport: teleportMedallion });
  api.onNpcDeath(handleNpcDeath);
  api.onPlayerLogin(handleLogin);
  api.onPlayerLogout(handleLogout);
};
