/**
 * Secrets of the North (members).
 *
 * The words come from the "Secrets of the North" transcript page; this plugin
 * supplies the variant for every quest conversation (played through
 * startTranscript / Talk-to handlers), the prose-condition answers (cult side,
 * coin bribe, evidence count, lockpick/inventory checks, hidden-room state),
 * the stage-direction handlers, the quest object interactions, the quest NPC
 * spawns and the reward. The OSRS quest has no post-quest dialogue for most
 * speakers, so the wiki's post-quest variants are used where they exist.
 *
 * Stage varbit: 14722 "sotn" (varp 3742 "sotn_primary", bits 0-8). The cache
 * also carries sibling varbits on varp 3742 (sotn_window_broken 14725,
 * sotn_inspected_* 14726-14729, sotn_hunting_trail_1-6 14733-14738,
 * sotn_entry_cultist 14739, sotn_clivet_vis 14740, sotn_questioned_* 14741-14742)
 * and on varp 3743 (sotn_tiffy_chat .. sotn_ghorrock_gate_2, 14746-14760); this
 * plugin keeps its stage in 14722 and the sub-flags in player attributes, as
 * the cache's own sotn locs/NPC transforms are not placed in this cache's maps.
 *
 * Stages (varbit 14722): 0 not started, 1 started (follow the guard),
 * 2 murder explained (inspect the crime scene), 3 guard told about the evidence
 * (go to the Fight Arena bar), 4 barman bribed (track Evelot), 5 trail complete
 * (find Evelot), 6 Evelot defeated (go to the Hazeel cult), 7 Hazeel/Khazard
 * met (question the Carnilleans, via the guard), 8 guard approved the family
 * questioning, 9 Claus heard the shadow (search the shelves), 10 hidden room
 * entered, 11 dusty scroll taken, 12 dusty scroll read, 13 Big Fish/Dead Wolf
 * met in Weiss, 14 My Arm/Snowflake heard about the mine, 15 Big Fish departed
 * (meet them in the salt mine), 16 assassin fight, 17 assassin dead (talk to
 * Hazeel), 18 Hazeel's dungeon search, 19 direction gate opened, 20 strange list
 * taken, 21 lever handle attached, 22 lever pulled, 23 pillar searched (jewel
 * shard + strange cipher), 24 BLOOD gate opened, 25 braziers lit (western chest
 * unlocked), 26 western chest searched (jewel shard + settlements note),
 * 27 ancient jewel combined, 28 icy chest taken (7402), 29 icy key made,
 * 30 icy gate opened, 31 strange creature fight, 32 creature dead / barrier
 * gone, 33 teleported back to Ardougne, 34 complete.
 *
 * Source: OSRS Wiki "Secrets of the North", its Quick guide and
 * Transcript:Secrets of the North; the cache for every id, varbit and map
 * placement. Cross-checked against RuneLite Quest Helper pinned at
 * 06da90f982518a093f2fe1c9cfac5547fa7053d3
 * (helpers/quests/secretsofthenorth/), which supplies the mandatory route,
 * object tiles and the LEFT-UP-LEFT-DOWN / BLOOD / 7402 / brazier order.
 *
 * Gaps / approximations:
 *  - Revision 241's multi-NPC parents leave several world spawns nameless with
 *    no options in this cache (the mansion guard 1200, the world Snowflake
 *    8433, Hazeel 1205), so the quest spawns its own copies of the resolved ids
 *    (Guard 12045, Snowflake 8431, My Arm 8411, Hazeel/Khazard variants) per
 *    player while they are needed. Both paired Weiss speakers are spawned at
 *    the captured tiles (My Arm 742 at 2874,3934, Snowflake 8431 at 2872,3934)
 *    and this plugin owns My Arm's Talk-to at SOTN stages 12-14.
 *  - The mansion crime-scene chest keeps its captured room but moves one tile
 *    to (2572,3270,2), because rev-241 clips the captured (2571,3269) pocket.
 *    The false-wall "Yes." choice opens a personal passage flag and steps the
 *    player one tile into the secret passage (2572,3270,1); the real ladder
 *    16683 is then claimed through onObjectRoute + ladders:climb (the
 *    HazeelCult staircase pattern) and lands on (2572,3271,2). The down ladder
 *    returns to the room at (2572,3269,1). No global wall is removed and no
 *    ladder is spawned.
 *  - The cache's SOTN objects are multi-locs keyed on varbit 14722 in the live
 *    stage sequence, while this plugin keeps its own readable stage values.
 *    The interactive multi-loc children (hidden door/chest, cave entrance) are
 *    therefore registered directly on their real cache tiles (2544,9698 /
 *    2533,9617 / 2535,9621 / 2845,10332), replacing the parents. Other quest
 *    locs are placed or swapped over decorative locs at the wiki/QH tiles.
 *  - The direction gate opens cache interface 810 with solution [3,0,3,2],
 *    the BLOOD gate cache 809 with digits [3,5,9,4,7] (DB row 2340) and the
 *    north chest cache 809 with [7,4,0,2] (DB row 2339), through the shared
 *    QuestPuzzleLocks helper. Notes/letter/map remain readable optional items.
 *  - The two mandatory captured scenes are implemented with QuestScenes:
 *    mine arrival (fade, private dungeon copy, Hazeel 12052/Khazard 12057,
 *    theme 743, control return into the assassin fight) and the lair vision
 *    (Jhallan 12064/12065, Assassin 12061, exit 46598/entrance 46638, song
 *    743, captured camera move/look, transport back to the dungeon at
 *    2927,10344, camera 2927,10341/10358, relog recovery). Other stage
 *    directions without captured camera data play as transcript prose.
 *  - Combat is real NPC kills (Evelot 12046, Assassin 12062, captured Strange
 *    Creature melee 12074) but their specials (Evelot's prayer drain, the
 *    assassin's smoke bombs and the Muspah shield/post-shield morphs) are not
 *    scripted.
 *  - Quest Helper also lists The General's Shadow miniquest as a prerequisite.
 *    This server has no implementation for it, so it cannot be enforced here.
 */
module.exports = function registerSecretsOfTheNorthQuest(api) {
  const {
    Animation,
    CountdownTask,
    GameObject,
    ItemIdentifiers,
    Location,
    MapObjects,
    NpcIdentifiers,
    ObjectDefinition,
    ObjectIdentifiers,
    ObjectManager,
    Skill,
    TaskManager,
  } = api.core;
  const { registerQuest, startTranscript } = require("../QuestRuntime");
  const { createQuestScenes } = require("../QuestScenes");
  const { createCombinationLock, createDirectionalLock } = require("../QuestPuzzleLocks");
  const { crossingFor } = require("../../objects/WallDoor.Doors");
  const ObstacleRunner = require("../../skills/agility/ObstacleRunner.Agility");

  const PAGE = "Secrets of the North";
  const START_HOOK = "quest:secrets-of-the-north:start";
  const HAZEEL_CULT_SIDE_ATTRIBUTE = "quest.hazeel_cult.side";
  const SIDE_HELPED = 1;

  // ==========================================================================
  // Stage values (varbit 14722 sotn, varp 3742 bits 0-8)
  // ==========================================================================

  const STAGE_STARTED = 1;
  const STAGE_MURDER = 2;
  const STAGE_GUARD_TOLD = 3;
  const STAGE_BRIBED = 4;
  const STAGE_TRAIL = 5;
  const STAGE_EVELOT = 6;
  const STAGE_CULT = 7;
  const STAGE_FAMILY = 8;
  const STAGE_CHEF = 9;
  const STAGE_ROOM = 10;
  const STAGE_SCROLL = 11;
  const STAGE_SCROLL_READ = 12;
  const STAGE_NORTH = 13;
  const STAGE_WEISS = 14;
  const STAGE_MINE = 15;
  const STAGE_ASSASSIN = 16;
  const STAGE_ASSASSIN_DEAD = 17;
  const STAGE_DUNGEON = 18;
  const STAGE_DIRECTION_GATE = 19;
  const STAGE_LIST = 20;
  const STAGE_HANDLE = 21;
  const STAGE_LEVER = 22;
  const STAGE_PILLAR = 23;
  const STAGE_BLOOD_GATE = 24;
  const STAGE_BRAZIERS = 25;
  const STAGE_WEST_CHEST = 26;
  const STAGE_JEWEL = 27;
  const STAGE_ICY_CHEST = 28;
  const STAGE_ICY_KEY = 29;
  const STAGE_ICY_GATE = 30;
  const STAGE_CREATURE = 31;
  const STAGE_FINALE = 32;
  const STAGE_TELEPORTED = 33;
  const STAGE_COMPLETE = 34;

  /**
   * The client's loc/script states key on the real sotn varbit sequence (2, 4,
   * 6 ... 90, confirmed by the rev-226 capture of download/1694). Internal
   * stages stay distinct for readable gates; this maps them to what the client
   * expects, collapsing the puzzle sub-steps into the captured 74.
   */
  const NATIVE_STAGE_VARBIT = {
    [STAGE_STARTED]: 2,
    [STAGE_MURDER]: 6,
    [STAGE_GUARD_TOLD]: 14,
    [STAGE_BRIBED]: 18,
    [STAGE_TRAIL]: 24,
    [STAGE_EVELOT]: 28,
    [STAGE_CULT]: 36,
    [STAGE_FAMILY]: 38,
    [STAGE_CHEF]: 40,
    [STAGE_ROOM]: 44,
    [STAGE_SCROLL]: 48,
    [STAGE_SCROLL_READ]: 50,
    [STAGE_NORTH]: 56,
    [STAGE_WEISS]: 58,
    [STAGE_MINE]: 62,
    [STAGE_ASSASSIN]: 66,
    [STAGE_ASSASSIN_DEAD]: 68,
    [STAGE_DUNGEON]: 72,
    [STAGE_DIRECTION_GATE]: 74,
    [STAGE_LIST]: 74,
    [STAGE_HANDLE]: 74,
    [STAGE_LEVER]: 74,
    [STAGE_PILLAR]: 74,
    [STAGE_BLOOD_GATE]: 74,
    [STAGE_BRAZIERS]: 74,
    [STAGE_WEST_CHEST]: 74,
    [STAGE_JEWEL]: 74,
    [STAGE_ICY_CHEST]: 74,
    [STAGE_ICY_KEY]: 76,
    [STAGE_ICY_GATE]: 78,
    [STAGE_CREATURE]: 80,
    [STAGE_FINALE]: 82,
    [STAGE_TELEPORTED]: 88,
    [STAGE_COMPLETE]: 90,
  };

  // ==========================================================================
  // Attributes
  // ==========================================================================

  const EVIDENCE_ATTRIBUTE = "secrets-of-the-north:evidence";
  const TRAIL_ATTRIBUTE = "secrets-of-the-north:trail";
  const BUTTON_ATTRIBUTE = "secrets-of-the-north:button";
  const HIDDEN_ATTRIBUTE = "secrets-of-the-north:hidden-room";
  const BRIBE_ATTRIBUTE = "secrets-of-the-north:bribe-paid";
  const SCROLL_READ_ATTRIBUTE = "secrets-of-the-north:scroll-read";
  const SCROLL_HANDED_ATTRIBUTE = "secrets-of-the-north:scroll-handed-in";
  const BRAZIERS_ATTRIBUTE = "secrets-of-the-north:braziers";
  const HIDDEN_PASSAGE_ATTRIBUTE = "secrets-of-the-north:hidden-passage";
  // Captured child varbits (download/1694): NW=4, SE=1, NE=3, SW=2; 14758 is
  // the chest-unlocked flag and 14753 is the lever (1 attached, 2 pulled).
  const BRAZIER_VARBITS = [14754, 14755, 14756, 14757];
  const BRAZIER_VALUES = [4, 1, 3, 2];
  const BRAZIER_CHEST_VARBIT = 14758;
  const LEVER_VARBIT = 14753;
  const TOLD_ATTRIBUTE = "secrets-of-the-north:explained";
  const QUESTIONS_ATTRIBUTE = "secrets-of-the-north:questions";

  const EVIDENCE_BODY = 1;
  const EVIDENCE_WINDOW = 2;
  const EVIDENCE_WALL = 4;
  const EVIDENCE_CHEST = 8;
  const EVIDENCE_ALL = EVIDENCE_BODY | EVIDENCE_WINDOW | EVIDENCE_WALL | EVIDENCE_CHEST;

  const TRAIL_BARRELS = 1;
  const TRAIL_BOULDER_WEST = 2;
  const TRAIL_BUSH = 4;
  const TRAIL_STUMP = 8;
  const TRAIL_BOULDER_EAST = 16;
  const TRAIL_BUSH_EAST = 32;
  const TRAIL_ALL =
    TRAIL_BARRELS | TRAIL_BOULDER_WEST | TRAIL_BUSH | TRAIL_STUMP | TRAIL_BOULDER_EAST | TRAIL_BUSH_EAST;

  // Captured trail child varbits, one per search point (14733-14738).
  const TRAIL_VARBITS = new Map([
    [TRAIL_BARRELS, 14733],
    [TRAIL_BOULDER_WEST, 14734],
    [TRAIL_BUSH, 14735],
    [TRAIL_STUMP, 14736],
    [TRAIL_BOULDER_EAST, 14737],
    [TRAIL_BUSH_EAST, 14738],
  ]);
  const QUEST_START_VARBITS = [14739, 14740];
  const QUEST_START_PROGRESS_VARBIT = 14769;
  const ARDOUGNE_TELEPORT_VARBIT = 14745;

  const TOLD_WINDOW = 1;
  const TOLD_BODY = 2;
  const TOLD_CHEST = 4;
  const TOLD_ALL = TOLD_WINDOW | TOLD_BODY | TOLD_CHEST;

  const ASKED_KILLER = 1;
  const ASKED_RITUAL = 2;
  const ASKED_ALL = ASKED_KILLER | ASKED_RITUAL;

  // Native crime-scene/report/question flags on varp 3742 (QH reads these
  // directly; its requirements are 0/1 and >=1). Send every flag, including
  // the zeroes, so unfinished events stay explicitly false for the helper.
  const EVIDENCE_VARBITS = new Map([
    [EVIDENCE_WALL, 14726],
    [EVIDENCE_BODY, 14727],
    [EVIDENCE_WINDOW, 14728],
    [EVIDENCE_CHEST, 14729],
  ]);
  const TOLD_VARBITS = new Map([
    [TOLD_BODY, 14730],
    [TOLD_WINDOW, 14731],
    [TOLD_CHEST, 14732],
  ]);
  const QUESTION_VARBITS = new Map([
    [ASKED_KILLER, 14743],
    [ASKED_RITUAL, 14744],
  ]);

  // ==========================================================================
  // Ids
  // ==========================================================================

  // Guard (Carnillean): the world spawn 1200 is a nameless parent with no
  // Talk-to option in this cache; the quest spawns the resolved variant 12045
  // (GUARD_180) for the player instead. Clivet likewise uses the resolved
  // world variants and the Hazeel Cult quest's own per-player spawn.
  const GUARD_IDS = new Set([
    NpcIdentifiers.GUARD_180, // 12045
    NpcIdentifiers.GUARD_181, // 12087
    NpcIdentifiers.GUARD_182, // 12088
  ]);
  const GUARD_NPC = NpcIdentifiers.GUARD_180; // 12045, chathead for guard transcripts
  const WORLD_CLIVET = 1206; // world spawn id (nameless parent)
  const CLAUS = NpcIdentifiers.CLAUS_THE_CHEF; // 1199
  const PHILIPE = NpcIdentifiers.PHILIPE_CARNILLEAN; // 1201
  const HENRYETA_IDS = new Set([
    NpcIdentifiers.HENRYETA_CARNILLEAN, // 1202
    NpcIdentifiers.HENRYETA_CARNILLEAN_2, // 12101
  ]);
  const CLIVET_IDS = new Set([
    WORLD_CLIVET, // 1206
    NpcIdentifiers.CLIVET, // 12049
    NpcIdentifiers.CLIVET_2, // 12095
  ]);
  const ALOMONE_IDS = new Set([
    NpcIdentifiers.ALOMONE, // 12092
    NpcIdentifiers.ALOMONE_2, // 12093
    NpcIdentifiers.ALOMONE_3, // 12094
  ]);
  const HAZEEL_IDS = new Set([
    NpcIdentifiers.HAZEEL, // 1205
    NpcIdentifiers.HAZEEL_2, // 12050
    NpcIdentifiers.HAZEEL_3, // 12051
    NpcIdentifiers.HAZEEL_4, // 12052
  ]);
  const KHAZARD_IDS = new Set([
    NpcIdentifiers.GENERAL_KHAZARD_2, // 3510
    NpcIdentifiers.GENERAL_KHAZARD_6, // 12055, after the assassin fight
    NpcIdentifiers.GENERAL_KHAZARD_7, // 12056
    NpcIdentifiers.GENERAL_KHAZARD_8, // 12057
    NpcIdentifiers.GENERAL_KHAZARD_9, // 12058
    NpcIdentifiers.GENERAL_KHAZARD_10, // 12059
  ]);
  const BARMAN = NpcIdentifiers.KHAZARD_BARMAN; // 1214
  const EVELOT = NpcIdentifiers.EVELOT; // 12046
  const BIG_FISH = NpcIdentifiers.BIG_FISH; // 12053
  const DEAD_WOLF = NpcIdentifiers.DEAD_WOLF; // 12060
  // 12061 (Assassin) and 12063 (Strange Creature) are the cache's non-attackable
  // parents; the quest spawns the monsters-complete attackable variants.
  const ASSASSIN = NpcIdentifiers.ASSASSIN_6; // 12062
  const STRANGE_CREATURE = NpcIdentifiers.STRANGE_CREATURE; // 12063, chathead for the conversations
  const STRANGE_CREATURE_ATTACKABLE = NpcIdentifiers.STRANGE_CREATURE_3; // 12074, captured melee phase
  const JHALLAN = NpcIdentifiers.JHALLAN; // 12064
  const JHALLAN_CUTSCENE = NpcIdentifiers.JHALLAN_2; // 12065, the lair vision
  const ASSASSIN_CUTSCENE = NpcIdentifiers.ASSASSIN_5; // 12061, the vision only
  // Scene actors (cutscene variants) keep their captured ids.
  const HAZEEL_GHORROCK = NpcIdentifiers.HAZEEL_4; // 12052, no Talk-to
  const KHAZARD_GHORROCK = NpcIdentifiers.GENERAL_KHAZARD_8; // 12057, no Talk-to
  // Persistent Ghorrock NPCs use interactive variants with Talk-to.
  const HAZEEL_INTERACTIVE = NpcIdentifiers.HAZEEL_3; // 12051
  const KHAZARD_INTERACTIVE = NpcIdentifiers.GENERAL_KHAZARD_7; // 12056
  const CREATURE_LAIR_EXIT = ObjectIdentifiers.CREVICE_41; // 46598
  const GHORROCK_ENTRANCE = ObjectIdentifiers.CREVICE_43; // 46638
  // Captured midi_song ids: the quest theme and "In the Shadows".
  const SOTN_MUSIC = 743;
  const IN_THE_SHADOWS_MUSIC = 744;
  const MUSPAH_FIGHT_MUSIC = 742; // More Than Meets the Eye
  // These world-spawn ids have no generated identifier yet (NpcIdentifiers.ts).
  const SNOWFLAKE_OUTSIDE = 8432;
  const SNOWFLAKE_POSTQUEST = 8433;
  const MY_ARM_WORLD_IDS = new Set([8412, 8413, 8414, 8415, 8416, 8417]);
  const MY_ARM_IDS = new Set([
    NpcIdentifiers.MY_ARM_2, // 741
    NpcIdentifiers.MY_ARM_3, // 742
    NpcIdentifiers.MY_ARM_4, // 750
    NpcIdentifiers.MY_ARM_5, // 751
    NpcIdentifiers.MY_ARM_6, // 752
    NpcIdentifiers.MY_ARM, // 8411
    ...MY_ARM_WORLD_IDS,
  ]);

  const DUSTY_SCROLL = ItemIdentifiers.DUSTY_SCROLL_3; // 27595
  const TULLIA_LETTER = ItemIdentifiers.TULLIAS_LETTER; // 27596
  const ANCIENT_MAP = ItemIdentifiers.ANCIENT_MAP; // 27597
  const STRANGE_CIPHER = ItemIdentifiers.STRANGE_CIPHER; // 27598
  const STRANGE_LIST = ItemIdentifiers.STRANGE_LIST; // 27599
  const DUKE_NOTE = ItemIdentifiers.DUKE_NOTE; // 27600
  const NUMBERS_NOTE = ItemIdentifiers.NUMBERS_NOTE; // 27601
  const SETTLEMENTS_NOTE = ItemIdentifiers.SETTLEMENTS_NOTE; // 27602
  const LEVER_HANDLE = ItemIdentifiers.LEVER_HANDLE; // 27603
  const ICY_CHEST = ItemIdentifiers.ICY_CHEST; // 27604
  const JEWEL_SHARD_PILLAR = ItemIdentifiers.JEWEL_SHARD; // 27605
  const JEWEL_SHARD_CHEST = ItemIdentifiers.JEWEL_SHARD_2; // 27606
  const ANCIENT_JEWEL = ItemIdentifiers.ANCIENT_JEWEL; // 27607
  const ICY_KEY = ItemIdentifiers.ICY_KEY; // 27608
  const COINS = ItemIdentifiers.COINS; // 995
  const TINDERBOX = ItemIdentifiers.TINDERBOX; // 590
  const LOCKPICK_IDS = new Set([
    ItemIdentifiers.LOCKPICK, // 1523
    ItemIdentifiers.LOCKPICK_3, // 13883
    ItemIdentifiers.LOCKPICK_4, // 28415
  ]);

  // Mansion crime scene (upstairs, z1) and kitchen/cellar.
  const CERIL_CORPSE = ObjectIdentifiers.CERIL_CARNILLEAN; // 46564
  const BROKEN_WINDOW = ObjectIdentifiers.BROKEN_WINDOW; // 46569
  const HIDDEN_ROOM_CHEST = ObjectIdentifiers.CHEST_161; // 46572
  const FALSE_WALL = ObjectIdentifiers.WALL_169; // 46707, Knock-at
  const KITCHEN_WALL = ObjectIdentifiers.WALL_166; // 46590, sotn_hidden_door_op
  const KITCHEN_CHEST = ObjectIdentifiers.CHEST_162; // 46592, Picklock
  const HIDDEN_LADDER_UP = 16683; // Carnillean hidden-room ladder, captured id
  const HIDDEN_LADDER_DOWN = 16679;
  const COOKING_SHELVES_11 = ObjectIdentifiers.COOKING_SHELVES_11; // 46589
  const COOKING_SHELVES_12 = ObjectIdentifiers.COOKING_SHELVES_12; // 46852

  // The Evelot trail (wiki tiles) and the rowboat.
  const TRAIL_BARRELS_OBJ = ObjectIdentifiers.BARRELS_8; // 46574
  const TRAIL_BOULDER_WEST_OBJ = ObjectIdentifiers.BOULDER_32; // 46576
  const TRAIL_BOULDER_EAST_OBJ = ObjectIdentifiers.BOULDER_34; // 46578
  const TRAIL_FALLEN_TREE_OBJ = ObjectIdentifiers.FALLEN_TREE_7; // 46580
  const TRAIL_STUMP_OBJ = ObjectIdentifiers.TREE_STUMP_72; // 46582
  const TRAIL_BUSH_OBJ = ObjectIdentifiers.BUSH_55; // 46584
  const ROWBOAT = ObjectIdentifiers.ROWBOAT_16; // 46573

  // Ghorrock Dungeon.
  const DUNGEON_BARREL = ObjectIdentifiers.BARREL_167; // 46609
  const DUNGEON_CRATE_MAP = ObjectIdentifiers.CRATE_295; // 46607
  const DUNGEON_CRATE_TINDERBOX = ObjectIdentifiers.CRATE_296; // 46608
  const DUNGEON_TABLE_DUKE = ObjectIdentifiers.DAMAGED_TABLE; // 46605
  const DUNGEON_TABLE_NUMBERS = ObjectIdentifiers.DAMAGED_TABLE_2; // 46606
  const DUNGEON_CHEST_LETTER = ObjectIdentifiers.CHEST_170; // 46620 (2913,10314)
  const DUNGEON_CHEST_LIST = ObjectIdentifiers.CHEST_166; // 46616
  const DUNGEON_CHEST_WEST = ObjectIdentifiers.CHEST_168; // 46618 (2916,10327)
  const DUNGEON_CHEST_NORTH = ObjectIdentifiers.CHEST_169; // 46619 (2919,10331)
  const LEVER_MECHANISM = ObjectIdentifiers.LEVER_MECHANISM; // 46610
  const DUNGEON_LEVER = ObjectIdentifiers.LEVER_64; // 46611
  const DUNGEON_PILLAR = ObjectIdentifiers.PILLAR_103; // 46613
  const DUNGEON_BRAZIER = ObjectIdentifiers.BRAZIER_26; // 46614
  const DUNGEON_GATE_DIRECTION = ObjectIdentifiers.GATE_248; // 46601 (2916,10338)
  const DUNGEON_GATE_BLOOD = ObjectIdentifiers.GATE_249; // 46602 (2924,10329)
  const DUNGEON_GATE_ICY = ObjectIdentifiers.GATE_250; // 46603 (2918,10321)
  const GATE_OPEN_INVISWALL = 38848; // captured open gate state
  const GATE_OPEN_LEAF = 46604; // captured paired open leaf
  const DUNGEON_CREVICE_39 = ObjectIdentifiers.CREVICE_39; // 46596 exit (2901,10338)
  const DUNGEON_CREVICE_40 = ObjectIdentifiers.CREVICE_40; // 46597 creature entrance (2908,10316)
  const MINE_CAVE_ENTRANCE = ObjectIdentifiers.CAVE_94; // 46839 (2845,10332)
  // Decorative locs replaced by the interactive ids above.
  const DECOR_BARREL = ObjectIdentifiers.BARREL_168; // 46690
  const DECOR_CRATE = ObjectIdentifiers.CRATE_297; // 46688
  const DECOR_TABLE_1 = ObjectIdentifiers.DAMAGED_TABLE_3; // 46674
  const DECOR_TABLE_2 = ObjectIdentifiers.DAMAGED_TABLE_4; // 46675
  const DECOR_CHEST = ObjectIdentifiers.CHEST_174; // 46680
  const DECOR_LEVER = ObjectIdentifiers.LEVER_67; // 46687
  const DECOR_PILLAR = ObjectIdentifiers.PILLAR_105; // 46629
  const DECOR_BRAZIER = ObjectIdentifiers.BRAZIER_28; // 46691

  // ==========================================================================
  // Scene state
  // ==========================================================================

  let quest;
  let scenes;
  const pendingFalseWall = new WeakMap();
  const falseWallInteraction = new WeakMap();
  let directionLock;
  let bloodLock;
  let chestLock;
  let objectsInstalled = false;
  const trackedNpcs = new Map();

  const evidence = (player) => Number(player.getAttribute(EVIDENCE_ATTRIBUTE)) || 0;
  const trail = (player) => Number(player.getAttribute(TRAIL_ATTRIBUTE)) || 0;
  const braziersLit = (player) => Number(player.getAttribute(BRAZIERS_ATTRIBUTE)) || 0;
  const told = (player) => Number(player.getAttribute(TOLD_ATTRIBUTE)) || 0;
  const questions = (player) => Number(player.getAttribute(QUESTIONS_ATTRIBUTE)) || 0;
  const hasFlag = (player, key) => player.getAttribute(key) === true;
  const setFlag = (player, key, value) => player.setAttribute(key, value === true);
  const has = (player, itemId) => player.getInventory().getAmount(itemId) > 0;
  const give = (player, itemId) => {
    if (!has(player, itemId)) player.getInventory().adds(itemId, 1);
  };
  const take = (player, itemId, amount = 1) => player.getInventory().deleteNumber(itemId, amount);

  function side(player) {
    return Number(player.getAttribute(HAZEEL_CULT_SIDE_ATTRIBUTE)) || 0;
  }

  function helpedCult(player) {
    return side(player) === SIDE_HELPED;
  }

  function isQuestComplete(player, key) {
    const request = { player, key, complete: false };
    api.emitCustomEvent("quest:is-complete", request);
    return request.complete === true;
  }

  function freeSlots(player) {
    return player.getInventory().getFreeSlots();
  }

  function hasLockpick(player) {
    for (const id of LOCKPICK_IDS) {
      if (has(player, id)) return true;
    }
    return false;
  }

  function meetsRequirements(player) {
    const skills = player.getSkillManager();
    return (
      skills.getMaxLevel(Skill.AGILITY) >= 69 &&
      skills.getMaxLevel(Skill.THIEVING) >= 64 &&
      skills.getMaxLevel(Skill.HUNTER) >= 56 &&
      isQuestComplete(player, "making_friends_with_my_arm") &&
      isQuestComplete(player, "devious_minds") &&
      isQuestComplete(player, "hazeel_cult")
    );
  }

  function evidenceCount(player) {
    let count = 0;
    const bits = evidence(player);
    for (const bit of [EVIDENCE_BODY, EVIDENCE_WINDOW, EVIDENCE_WALL, EVIDENCE_CHEST]) {
      if (bits & bit) count++;
    }
    return count;
  }

  function setStage(player, value) {
    if (quest.getStage(player) === value) return;
    quest.setStage(player, value);
    syncNpcs(player);
  }

  function advanceTo(player, value) {
    if (quest.getStage(player) < value) setStage(player, value);
  }

  // ==========================================================================
  // NPC spawns (per player, owner-only)
  //
  // Hazeel and Khazard appear at three different locations over the quest, so
  // each location owns its tracked key; sharing one key let the later
  // wanted=false ensureNpc remove the spawn that the earlier location wanted.
  // ==========================================================================

  const HAZEEL_KEYS = ["hazeel:cult", "hazeel:dungeon", "hazeel:lair"];
  const KHAZARD_KEYS = ["khazard:cult", "khazard:dungeon", "khazard:lair"];

  function trackedFor(player) {
    let tracked = trackedNpcs.get(player);
    if (!tracked) {
      tracked = new Map();
      trackedNpcs.set(player, tracked);
    }
    return tracked;
  }

  /**
   * Drops this player's own copies of an id (owner ref, or the same account name
   * after a relog), optionally restricted to one tile.
   */
  function cullOwnedNpcs(player, npcId, x, y, z) {
    const name = player.getUsername?.();
    for (const other of api.getWorld?.()?.getNpcs?.() ?? []) {
      if (other?.getId?.() !== npcId) continue;
      const owner = other.getOwner?.();
      if (owner !== player && (!name || owner?.getUsername?.() !== name)) continue;
      if (x !== undefined) {
        const at = other.getLocation?.();
        if (at && (at.getX?.() !== x || at.getY?.() !== y || at.getZ?.() !== z)) continue;
      }
      api.removeNpc(other);
    }
  }

  function spawnTracked(player, key, npcId, x, y, z, wanderRadius = 0) {
    const tracked = trackedFor(player);
    const existing = tracked.get(key);
    if (existing?.isRegistered?.()) return existing;
    cullOwnedNpcs(player, npcId);
    const npc = api.spawnNpc({ id: npcId, x, y, z, wanderRadius, owner: player, ownerOnly: true });
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

  function syncNpcs(player) {
    if (!player || player.isPlayerBot?.() === true) return;
    const stage = quest.getStage(player);
    // Hazeel cult hideout (the summoning). Hazeel first appears here once Evelot
    // is defeated (stage 6); that conversation spawns Khazard and opens the cult.
    const inCult = stage >= STAGE_CULT && stage < STAGE_NORTH;
    // Opposed players meet Hazeel in the hideout; helped players summon him
    // (action ZFwohZ), so he must not stand there before the summon.
    const hazeelAtCult = stage === STAGE_EVELOT
      ? !helpedCult(player)
      : stage >= STAGE_CULT && stage < STAGE_NORTH;
    ensureNpc(player, "hazeel:cult", NpcIdentifiers.HAZEEL_2, 2609, 9673, 0, hazeelAtCult);
    ensureNpc(player, "khazard:cult", NpcIdentifiers.GENERAL_KHAZARD_2, 2611, 9670, 0, inCult);
    ensureNpc(player, "alomone:cult", NpcIdentifiers.ALOMONE, 2609, 9670, 0, inCult);
    // The quest guard (the world 1200 spawn is a nameless parent with no Talk-to).
    ensureNpc(player, "guard", GUARD_NPC, 2571, 3275, 0, true);
    // Claus only has a world spawn in the cult cave; the kitchen question needs
    // him at his actual mansion-basement post.
    const atKitchen = stage >= STAGE_FAMILY && stage < STAGE_SCROLL;
    ensureNpc(player, "claus", CLAUS, 2540, 9699, 0, atKitchen);
    // Evelot at the rowboat.
    ensureNpc(player, "evelot", EVELOT, 2642, 3202, 0, stage === STAGE_TRAIL);
    // Big Fish and Dead Wolf wait at Weiss's northern entrance once Hazeel sends
    // the player north (the scroll has been handed over at stage 12).
    const atWeiss = stage >= STAGE_SCROLL_READ && stage < STAGE_MINE;
    ensureNpc(player, "big-fish", BIG_FISH, 2880, 3946, 0, atWeiss);
    ensureNpc(player, "dead-wolf", DEAD_WOLF, 2879, 3946, 0, atWeiss);
    ensureNpc(player, "snowflake-sotn", NpcIdentifiers.SNOWFLAKE, 2872, 3934, 0, atWeiss);
    // Captured as multinpc 8417 rendering child 742 at (2874,3934).
    ensureNpc(player, "my-arm-sotn", NpcIdentifiers.MY_ARM_3, 2874, 3934, 0, atWeiss);
    // Interactive Hazeel and Khazard at the captured dungeon tiles; the
    // assassin waits in the east fight room (2927,10352).
    const inDungeon = stage >= STAGE_ASSASSIN && stage < STAGE_FINALE;
    ensureNpc(player, "hazeel:dungeon", HAZEEL_INTERACTIVE, 2902, 10334, 0, inDungeon);
    ensureNpc(player, "khazard:dungeon", KHAZARD_INTERACTIVE, 2928, 10347, 0, inDungeon);
    ensureNpc(player, "assassin", ASSASSIN, 2927, 10352, 0, stage === STAGE_ASSASSIN);
    // After the lair vision the player is back in the dungeon's entrance room,
    // where interactive Hazeel and Khazard await (captured coords).
    const atLair = stage === STAGE_FINALE;
    ensureNpc(player, "hazeel:lair", HAZEEL_INTERACTIVE, 2925, 10349, 0, atLair);
    ensureNpc(player, "khazard:lair", KHAZARD_INTERACTIVE, 2928, 10349, 0, atLair);
    ensureNpc(player, "creature", STRANGE_CREATURE_ATTACKABLE, 2845, 4257, 0, stage === STAGE_CREATURE);
  }

  // ==========================================================================
  // Quest object installation (this cache's maps predate the 2023 revamp)
  // ==========================================================================

  function placeObject(id, x, y, z, type = 10, rotation = 0) {
    const location = new Location(x, y, z);
    if (MapObjects.get(id, location.clone(), null)) return;
    ObjectManager.register(new GameObject(id, location, type, rotation, null), true);
  }

  function replaceObject(oldId, newId, x, y, z, type = 10, rotation = 0) {
    const location = new Location(x, y, z);
    const old = MapObjects.get(oldId, location.clone(), null);
    if (old) ObjectManager.deregister(old, true);
    if (MapObjects.get(newId, location.clone(), null)) return;
    ObjectManager.register(new GameObject(newId, location, type, rotation, null), true);
  }

  function installQuestObjects() {
    if (objectsInstalled) return;
    objectsInstalled = true;
    // Carnillean Mansion: captured tiles from download/1694 (body/window/false
    // wall on the first floor, broken chest in the hidden room above).
    placeObject(CERIL_CORPSE, 2573, 3269, 1, 10, 1);
    placeObject(BROKEN_WINDOW, 2575, 3268, 1, 10, 0);
    placeObject(FALSE_WALL, 2572, 3270, 1, 10, 0);
    // The captured chest is at (2571,3269,2), but rev-241's z2 map clips that
    // pocket; the walkable room tile one step east keeps the chest reachable
    // from the ladder landing at (2572,3271,2).
    placeObject(HIDDEN_ROOM_CHEST, 2572, 3270, 2, 10, 0);
    // The cache's own SOTN hidden door/chest are multi-locs whose children have
    // no options in this revision; the interactive child ids replace them.
    placeObject(KITCHEN_WALL, 2544, 9698, 0, 0, 3);
    placeObject(KITCHEN_WALL, 2533, 9617, 0, 0, 1);
    placeObject(KITCHEN_CHEST, 2535, 9621, 0, 10, 2);
    // The Evelot trail (six search points from the quest guide).
    placeObject(TRAIL_BARRELS_OBJ, 2568, 3152, 0, 10, 0);
    placeObject(TRAIL_BOULDER_WEST_OBJ, 2573, 3181, 0, 10, 0);
    placeObject(TRAIL_BUSH_OBJ, 2567, 3202, 0, 10, 0);
    placeObject(TRAIL_FALLEN_TREE_OBJ, 2561, 3204, 0, 10, 0);
    placeObject(TRAIL_STUMP_OBJ, 2584, 3197, 0, 10, 0);
    placeObject(TRAIL_BOULDER_EAST_OBJ, 2605, 3188, 0, 10, 0);
    placeObject(TRAIL_BUSH_OBJ, 2621, 3193, 0, 10, 0);
    placeObject(ROWBOAT, 2645, 3202, 0, 10, 0);
    // Ghorrock Dungeon: swap the decorative locs for the interactable SOTN ids.
    replaceObject(DECOR_BARREL, DUNGEON_BARREL, 2923, 10322, 0, 10, 3);
    replaceObject(DECOR_CRATE, DUNGEON_CRATE_MAP, 2936, 10327, 0, 10, 1);
    replaceObject(DECOR_CRATE, DUNGEON_CRATE_TINDERBOX, 2916, 10329, 0, 10, 2);
    replaceObject(DECOR_TABLE_1, DUNGEON_TABLE_DUKE, 2914, 10341, 0, 10, 0);
    replaceObject(DECOR_TABLE_2, DUNGEON_TABLE_NUMBERS, 2935, 10321, 0, 10, 3);
    replaceObject(DECOR_CHEST, DUNGEON_CHEST_LIST, 2933, 10320, 0, 10, 0);
    replaceObject(DECOR_CHEST, DUNGEON_CHEST_WEST, 2916, 10327, 0, 10, 1);
    replaceObject(DECOR_CHEST, DUNGEON_CHEST_NORTH, 2919, 10331, 0, 10, 2);
    replaceObject(DECOR_LEVER, LEVER_MECHANISM, 2917, 10342, 0, 10, 2);
    replaceObject(DECOR_PILLAR, DUNGEON_PILLAR, 2924, 10346, 0, 10, 0);
    for (const [x, y] of BRAZIER_TILES) {
      replaceObject(DECOR_BRAZIER, DUNGEON_BRAZIER, x, y, 0, 10, 0);
    }
    // The cache's gates at these tiles are shared generic ids; use the SOTN ids.
    placeObject(DUNGEON_GATE_DIRECTION, 2916, 10338, 0, 0, 3);
    placeObject(DUNGEON_GATE_BLOOD, 2924, 10329, 0, 0, 2);
    placeObject(DUNGEON_GATE_ICY, 2918, 10321, 0, 0, 2);
    // The mine entrance is a varbit multi-loc with no child options in this
    // revision; place the enterable cave child at the same tile.
    placeObject(MINE_CAVE_ENTRANCE, 2845, 10332, 0, 10, 1);
    // The creature's lair exit appears at the captured tile; it is only
    // handled while the quest is on the FINALE stage (the boss instance owns
    // its own 46599 escape).
    placeObject(CREATURE_LAIR_EXIT, 2860, 4258, 0, 10, 0);
  }

  // NW, SE, NE, SW as the numbers note asks; the wiki mirrors the paper map.
  const BRAZIER_TILES = [
    [2916, 10331],
    [2922, 10325],
    [2922, 10331],
    [2916, 10325],
  ];

  function brazierIndex(location) {
    if (!location) return -1;
    // Item-on-object hands over a plain {x,y,z}; object clicks hand over a Location.
    const x = location.getX?.() ?? location.x;
    const y = location.getY?.() ?? location.y;
    for (let index = 0; index < BRAZIER_TILES.length; index++) {
      const [bx, by] = BRAZIER_TILES[index];
      if (bx === x && by === y) return index;
    }
    return -1;
  }

  // ==========================================================================
  // Transcripts
  // ==========================================================================

  /** Starts a transcript a tick later, after a running dialogue has closed. */
  function startTranscriptDeferred(player, npcId, variant, select) {
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

  /** Drops wiki blank lines (typed "line" steps with no text). */
  function withoutBlankLines(steps) {
    if (!Array.isArray(steps)) return steps;
    return steps.filter((step) => !(step?.type === "line" && !String(step.text ?? "").trim()));
  }

  // ==========================================================================
  // NPC Talk-to handlers
  //
  // Registered by name (which scopes them to the named NPCs) and returning
  // false when the quest does not own the conversation, because the
  // interaction wrapper marks an event handled unless the handler returns
  // false. Handlers registered by a shared name (Guard) re-check the id.
  // ==========================================================================

  function talkGuard(event) {
    const { player, npcId } = event;
    if (!GUARD_IDS.has(npcId)) return false;
    const stage = quest.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      startTranscript(api, player, npcId, PAGE, "post-quest-talking-to-the-guard-post-quest");
      return true;
    }
    if (stage >= STAGE_FINALE) {
      startTranscript(api, player, npcId, PAGE, "more-mahjarrat-more-problems-talking-to-the-guard");
      return true;
    }
    if (stage >= STAGE_SCROLL) {
      startTranscript(api, player, npcId, PAGE, "the-mysterious-benefactor-talking-to-the-carnillean-guard-after-obtaining-the-dusty-scroll");
      return true;
    }
    if (stage >= STAGE_CULT) {
      startTranscript(api, player, npcId, PAGE, "the-mysterious-benefactor-talking-to-the-carnillean-guard");
      advanceTo(player, STAGE_FAMILY);
      return true;
    }
    if (stage === STAGE_EVELOT) {
      startTranscript(api, player, npcId, PAGE, "on-the-trail-talking-to-the-carnillean-guard-after-the-conversation-with-evelot");
      return true;
    }
    if (stage >= STAGE_BRIBED) {
      startTranscript(api, player, npcId, PAGE, "on-the-trail-talking-to-the-carnillean-guard-after-talking-to-the-barman");
      return true;
    }
    if (stage >= STAGE_GUARD_TOLD) {
      startTranscript(api, player, npcId, PAGE, "a-death-in-the-family-talking-to-the-carnillean-guard-after-he-mentions-the-bar");
      return true;
    }
    if (stage === STAGE_MURDER) {
      if (evidence(player) === EVIDENCE_ALL) {
        startTranscript(api, player, npcId, PAGE, "a-death-in-the-family-talking-to-the-carnillean-guard-after-inspecting-the-crime-scene");
        return true;
      }
      startTranscript(api, player, npcId, PAGE, "a-death-in-the-family-talking-to-the-carnillean-guard-upstairs-talking-to-the-guard-again");
      return true;
    }
    if (stage === STAGE_STARTED) {
      startTranscript(api, player, npcId, PAGE, "a-death-in-the-family-talking-to-the-carnillean-guard-upstairs");
      advanceTo(player, STAGE_MURDER);
      return true;
    }
    if (stage === 0) {
      if (!meetsRequirements(player)) {
        player.sendMessage("You do not meet all of the requirements to start the Secrets of the North quest.");
        event.handled = true;
        return true;
      }
      startTranscript(api, player, npcId, PAGE, "a-death-in-the-family-talking-to-the-carnillean-guard");
      return true;
    }
    return false;
  }

  function talkClaus(event) {
    const { player, npcId } = event;
    if (npcId !== CLAUS) return false;
    const stage = quest.getStage(player);
    if (stage < STAGE_MURDER) {
      startTranscript(api, player, npcId, PAGE, "pre-quest-talking-to-claus-the-chef");
      return true;
    }
    if (stage >= STAGE_COMPLETE) {
      startTranscript(api, player, npcId, PAGE, "post-quest-talking-to-claus-the-chef-post-quest");
      return true;
    }
    if (stage >= STAGE_SCROLL) {
      startTranscript(api, player, npcId, PAGE, "the-mysterious-benefactor-talking-to-claus-the-chef-after-obtaining-the-dusty-scroll");
      return true;
    }
    if (stage >= STAGE_CHEF) {
      startTranscript(api, player, npcId, PAGE, "the-mysterious-benefactor-talking-to-claus-the-chef-talking-to-claus-the-chef-again");
      return true;
    }
    if (stage >= STAGE_FAMILY) {
      startTranscript(api, player, npcId, PAGE, "the-mysterious-benefactor-talking-to-claus-the-chef");
      return true;
    }
    if (stage >= STAGE_CULT) {
      startTranscript(api, player, npcId, PAGE, "the-mysterious-benefactor-talking-to-claus-the-chef-before-talking-to-the-guard");
      return true;
    }
    if (stage >= STAGE_MURDER) {
      startTranscript(api, player, npcId, PAGE, "a-death-in-the-family-talking-to-claus-the-chef-after-learning-of-the-death");
      return true;
    }
    return false;
  }

  function talkHenryeta(event) {
    const { player, npcId } = event;
    if (!HENRYETA_IDS.has(npcId)) return false;
    const stage = quest.getStage(player);
    if (stage < STAGE_MURDER) {
      startTranscript(api, player, npcId, PAGE, "pre-quest-talking-to-henryeta-carnillean");
      return true;
    }
    if (stage >= STAGE_COMPLETE) {
      startTranscript(api, player, npcId, PAGE, "post-quest-talking-to-henryeta-carnillean-post-quest");
      return true;
    }
    if (stage >= STAGE_FAMILY) {
      startTranscript(api, player, npcId, PAGE, "the-mysterious-benefactor-talking-to-henryeta-carnillean");
      return true;
    }
    if (stage >= STAGE_CULT) {
      startTranscript(api, player, npcId, PAGE, "the-mysterious-benefactor-talking-to-henryeta-carnillean-before-talking-to-the-guard");
      return true;
    }
    if (stage >= STAGE_MURDER) {
      startTranscript(api, player, npcId, PAGE, "a-death-in-the-family-talking-to-henryeta-carnillean-after-learning-of-the-death");
      return true;
    }
    return false;
  }

  function talkPhilipe(event) {
    const { player, npcId } = event;
    if (npcId !== PHILIPE) return false;
    const stage = quest.getStage(player);
    if (stage < STAGE_MURDER) {
      startTranscript(api, player, npcId, PAGE, "pre-quest-talking-to-philipe-carnillean");
      return true;
    }
    if (stage >= STAGE_COMPLETE) {
      startTranscript(api, player, npcId, PAGE, "post-quest-talking-to-philipe-carnillean-post-quest");
      return true;
    }
    if (stage >= STAGE_FAMILY) {
      startTranscript(api, player, npcId, PAGE, "the-mysterious-benefactor-talking-to-philipe-carnillean");
      return true;
    }
    if (stage >= STAGE_CULT) {
      startTranscript(api, player, npcId, PAGE, "the-mysterious-benefactor-talking-to-philipe-carnillean-before-talking-to-the-guard");
      return true;
    }
    if (stage >= STAGE_MURDER) {
      startTranscript(api, player, npcId, PAGE, "a-death-in-the-family-talking-to-philipe-carnillean-after-learning-of-the-death");
      return true;
    }
    return false;
  }

  function talkBarman(event) {
    const { player, npcId } = event;
    if (npcId !== BARMAN) return false;
    const stage = quest.getStage(player);
    if (stage < STAGE_GUARD_TOLD || stage > STAGE_TRAIL) return false;
    if (stage >= STAGE_BRIBED) {
      startTranscript(api, player, npcId, PAGE, "on-the-trail-talking-to-the-khazard-barman-after-giving-him-100-coins");
      return true;
    }
    startTranscript(api, player, npcId, PAGE, "on-the-trail-talking-to-the-khazard-barman");
    return true;
  }

  function talkEvelot(event) {
    const { player, npcId } = event;
    if (npcId !== EVELOT) return false;
    if (quest.getStage(player) !== STAGE_TRAIL) return false;
    startTranscript(api, player, npcId, PAGE, "on-the-trail-talking-to-evelot");
    return true;
  }

  /** A fresh Talk-to must reopen the full transcript's captured teleport choice. */
  function startFinalTeleport(player, npcId) {
    startTranscript(api, player, npcId, PAGE, "more-mahjarrat-more-problems-defeating-the-creature", (steps) => {
      const teleport = (steps || []).find((step) =>
        step.type === "choice" && String(step.prompt ?? "").startsWith("Teleport to East Ardougne"));
      return teleport ? [teleport] : steps;
    });
  }

  function talkHazeel(event) {
    const { player, npcId } = event;
    if (!HAZEEL_IDS.has(npcId)) return false;
    const stage = quest.getStage(player);
    if (stage === STAGE_EVELOT) {
      startTranscript(api, player, npcId, PAGE, "on-the-trail-talking-to-hazeel-alomone");
      return true;
    }
    if (stage >= STAGE_CULT && stage < STAGE_SCROLL) {
      startTranscript(api, player, npcId, PAGE, "on-the-trail-talking-to-hazeel-after-he-asks-you-to-investigate-the-carnillean-mansion");
      return true;
    }
    if (stage === STAGE_SCROLL_READ) {
      startTranscript(api, player, npcId, PAGE, "the-mysterious-benefactor-talking-to-hazeel-or-general-khazard-after-reading-the-dusty-scroll");
      return true;
    }
    if (stage === STAGE_SCROLL) {
      player.sendMessage("You should read the dusty scroll before returning it.");
      event.handled = true;
      return true;
    }
    if (stage === STAGE_ASSASSIN_DEAD) {
      startTranscript(api, player, npcId, PAGE, "in-the-north-talking-to-hazeel-after-defeating-the-assassin");
      return true;
    }
    if (stage >= STAGE_DUNGEON && stage <= STAGE_ICY_GATE) {
      startTranscript(api, player, npcId, PAGE, "in-the-north-talking-to-hazeel-after-defeating-the-assassin-talking-to-hazeel-again");
      return true;
    }
    if (stage === STAGE_CREATURE) {
      startTranscript(api, player, npcId, PAGE, "more-mahjarrat-more-problems-talking-to-hazeel-after-encountering-the-strange-creature");
      return true;
    }
    if (stage === STAGE_FINALE) {
      startFinalTeleport(player, npcId);
      return true;
    }
    return false;
  }

  function talkGeneralKhazard(event) {
    const { player, npcId } = event;
    if (!KHAZARD_IDS.has(npcId)) return false;
    const stage = quest.getStage(player);
    if (stage === STAGE_ASSASSIN_DEAD) {
      startTranscript(api, player, npcId, PAGE, "in-the-north-defeating-the-assassin-talking-to-khazard-again");
      return true;
    }
    if (stage >= STAGE_DUNGEON && stage <= STAGE_ICY_GATE) {
      startTranscript(api, player, npcId, PAGE, "in-the-north-talking-to-khazard-after-reporting-to-hazeel");
      return true;
    }
    if (stage === STAGE_CREATURE) {
      startTranscript(api, player, npcId, PAGE, "more-mahjarrat-more-problems-talking-to-hazeel-after-encountering-the-strange-creature");
      return true;
    }
    if (stage === STAGE_FINALE) {
      startFinalTeleport(player, npcId);
      return true;
    }
    return false;
  }

  /** Shared by Clivet and Alomone, whose page variants use the same branches. */
  function talkCultMember(event, npcId) {
    const { player } = event;
    const stage = quest.getStage(player);
    if (stage === STAGE_EVELOT) {
      startTranscript(api, player, npcId, PAGE, "on-the-trail-talking-to-hazeel-alomone");
      return true;
    }
    if (stage >= STAGE_CULT && stage < STAGE_SCROLL) {
      startTranscript(api, player, npcId, PAGE, "on-the-trail-talking-to-clivet-alomone");
      return true;
    }
    if (stage === STAGE_SCROLL || stage === STAGE_SCROLL_READ) {
      startTranscript(api, player, npcId, PAGE, "the-mysterious-benefactor-talking-to-clivet-alomone-after-obtaining-the-dusty-scroll");
      return true;
    }
    return false;
  }

  function talkClivet(event) {
    if (!CLIVET_IDS.has(event.npcId)) return false;
    return talkCultMember(event, event.npcId);
  }

  function talkAlomone(event) {
    if (!ALOMONE_IDS.has(event.npcId)) return false;
    return talkCultMember(event, event.npcId);
  }

  function talkBigFish(event) {
    const { player, npcId } = event;
    if (npcId !== BIG_FISH && npcId !== DEAD_WOLF) return false;
    const stage = quest.getStage(player);
    if (stage === STAGE_SCROLL_READ) {
      startTranscript(api, player, npcId, PAGE, "in-the-north-talking-to-big-fish-or-dead-wolf");
      return true;
    }
    if (stage === STAGE_NORTH) {
      startTranscript(api, player, npcId, PAGE, "in-the-north-talking-to-big-fish-or-dead-wolf-talking-big-fish-or-dead-wolf-again");
      return true;
    }
    if (stage === STAGE_WEISS) {
      startTranscript(api, player, npcId, PAGE, "in-the-north-talking-to-big-fish-or-dead-wolf-after-hearing-about-the-weirdness-in-the-mine");
      return true;
    }
    return false;
  }

  function talkSnowflake(event) {
    const { player, npcId } = event;
    if (npcId !== NpcIdentifiers.SNOWFLAKE && npcId !== SNOWFLAKE_OUTSIDE && npcId !== SNOWFLAKE_POSTQUEST) return false;
    const stage = quest.getStage(player);
    if (stage === STAGE_SCROLL_READ) {
      startTranscript(api, player, npcId, PAGE, "in-the-north-talking-to-my-arm-or-snowflake-before-contacting-the-mahjarrat");
      return true;
    }
    if (stage === STAGE_NORTH) {
      startTranscript(api, player, npcId, PAGE, "in-the-north-talking-to-my-arm-or-snowflake");
      return true;
    }
    if (stage === STAGE_WEISS) {
      startTranscript(api, player, npcId, PAGE, "in-the-north-talking-to-my-arm-or-snowflake-talking-to-my-arm-or-snowflake-again");
      return true;
    }
    return false;
  }

  function talkMyArm(event) {
    const { player, npcId } = event;
    if (!MY_ARM_IDS.has(npcId)) return false;
    const stage = quest.getStage(player);
    if (stage < STAGE_SCROLL_READ || stage >= STAGE_MINE) return false;
    // MakingFriendsWithMyArm swallows post-quest My Arm Talk-to before this
    // handler runs, so this is only reached if that plugin is absent.
    const variant = stage === STAGE_SCROLL_READ
      ? "in-the-north-talking-to-my-arm-or-snowflake-before-contacting-the-mahjarrat"
      : stage === STAGE_NORTH
        ? "in-the-north-talking-to-my-arm-or-snowflake"
        : "in-the-north-talking-to-my-arm-or-snowflake-talking-to-my-arm-or-snowflake-again";
    startTranscript(api, player, npcId, PAGE, variant);
    return true;
  }

  // ==========================================================================
  // Prose conditions
  // ==========================================================================

  function answerCondition(event) {
    const pages = event?.pages ?? [];
    if (!pages.some((page) => page?.page === PAGE)) return null;
    const text = String(event.text ?? "").toLowerCase();
    const player = event.player;
    if (text.includes("opposed the cult")) return !helpedCult(player);
    if (text.includes("helped the cult")) return helpedCult(player);
    if (text.includes("third piece of evidence")) return evidenceCount(player) >= 3;
    if (text.includes("song of the elves has not been completed")) return !isQuestComplete(player, "song_of_the_elves");
    if (text.includes("song of the elves has been completed")) return isQuestComplete(player, "song_of_the_elves");
    if (text.includes("does not have 100 coins")) return player.getInventory().getAmount(COINS) < 100;
    if (text.includes("has 100 coins")) return player.getInventory().getAmount(COINS) >= 100;
    if (text.includes("no lockpick")) return !hasLockpick(player);
    if (text.includes("no inventory space")) return freeSlots(player) === 0;
    if (text.includes("already has the scroll")) return has(player, DUSTY_SCROLL);
    if (text.includes("when entering the hidden room")) return !hasFlag(player, HIDDEN_ATTRIBUTE);
    if (text.includes("when leaving the hidden room")) return hasFlag(player, HIDDEN_ATTRIBUTE);
    if (text.includes("gone through the three options")) return (told(player) & TOLD_ALL) === TOLD_ALL;
    if (text.includes("asked both questions")) return (questions(player) & ASKED_ALL) === ASKED_ALL;
    return null;
  }

  // ==========================================================================
  // Chosen conditions (gameplay side effects)
  // ==========================================================================

  function handleChosenCondition(event) {
    const { player, stepId } = event;
    const stage = quest.getStage(player);
    if (stage === STAGE_GUARD_TOLD && (stepId === "8h0Upv" || stepId === "pceDDA")) {
      if (player.getInventory().getAmount(COINS) >= 100) {
        take(player, COINS, 100);
        setFlag(player, BRIBE_ATTRIBUTE, true);
        setStage(player, STAGE_BRIBED);
      }
    }
  }

  /** The false-wall "Push against the wall?" choice opens the personal passage. */
  function handleChoice(event) {
    const { player, option } = event;
    if (!player || !pendingFalseWall.has(player)) return;
    const location = player.getLocation();
    if (location.getZ() !== 1 || Math.abs(location.getX() - 2572) > 2 || Math.abs(location.getY() - 3270) > 2) {
      pendingFalseWall.delete(player);
      falseWallInteraction.delete(player);
      return;
    }
    pendingFalseWall.delete(player);
    falseWallInteraction.delete(player);
    if (!/^yes\b/i.test(String(option ?? "").trim())) return;
    const stage = quest.getStage(player);
    if (stage < STAGE_MURDER || stage >= STAGE_NORTH) return;
    setFlag(player, HIDDEN_PASSAGE_ATTRIBUTE, true);
    // One-tile secret-door step. The rev-241 false wall is still solid for
    // everyone else; the player steps onto its tile and can use the real ladder.
    player.moveTo(new Location(2572, 3270, 1));
    player.sendMessage("You push against the false wall and step into the hidden passage.");
  }

  function nearMansion(player) {
    const location = player.getLocation();
    return location.getX() >= 2568 && location.getX() <= 2576
      && location.getY() >= 3266 && location.getY() <= 3273;
  }

  /**
   * The rev-241 map leaves no walkable tile adjacent to the hidden ladder, so a
   * plain click cannot route. Mirror the mansion-staircase approach it uses
   * (onObjectRoute + ladders:climb claim): stand on the false-wall tile, then
   * climb to the walkable z2 landing. The global wall is never removed.
   */
  function routeHiddenLadder(event) {
    const { player, objectId } = event;
    if (!player || !nearMansion(player)) return;
    const stage = quest.getStage(player);
    if (stage < STAGE_MURDER || stage >= STAGE_NORTH) return;
    if (objectId === HIDDEN_LADDER_UP && player.getLocation().getZ() === 1) {
      event.destination = { x: 2572, y: 3270, z: 1 };
    } else if (objectId === HIDDEN_LADDER_DOWN && player.getLocation().getZ() === 2) {
      event.destination = { x: 2572, y: 3271, z: 2 };
    }
  }

  function climbHiddenLadder(player, destination, animation) {
    const start = player.getLocation().clone();
    player.performAnimation?.(new Animation(animation));
    TaskManager.submit(new CountdownTask(player, 1, () => {
      if (player.getLocation().equals(start)) player.moveTo(destination);
    }));
  }

  function claimHiddenLadder(request) {
    if (request.handled) return;
    const { player, objectId } = request;
    if (!player || !nearMansion(player)) return;
    const stage = quest.getStage(player);
    if (stage < STAGE_MURDER || stage >= STAGE_NORTH) return;
    if (objectId === HIDDEN_LADDER_UP && player.getLocation().getZ() === 1) {
      request.handled = true;
      if (!hasFlag(player, HIDDEN_PASSAGE_ATTRIBUTE)) {
        player.sendMessage("The wall is still closed.");
        return;
      }
      climbHiddenLadder(player, new Location(2572, 3271, 2), 828);
    } else if (objectId === HIDDEN_LADDER_DOWN && player.getLocation().getZ() === 2) {
      request.handled = true;
      climbHiddenLadder(player, new Location(2572, 3269, 1), 827);
    }
  }

  // ==========================================================================
  // Stage-direction actions and messages
  // ==========================================================================

  function syncDetails(player) {
    const packet = player.getPacketSender();
    const publish = (varbits, bits) => {
      for (const [bit, varbit] of varbits) packet.sendVarbit(varbit, bits & bit ? 1 : 0);
    };
    publish(EVIDENCE_VARBITS, evidence(player));
    publish(TOLD_VARBITS, told(player));
    publish(QUESTION_VARBITS, questions(player));
  }

  function markEvidence(player, bit) {
    player.setAttribute(EVIDENCE_ATTRIBUTE, (evidence(player) | bit) | 0);
    syncDetails(player);
  }

  function handleAction(event) {
    const { player, stepId } = event;
    switch (stepId) {
      // A Death in the Family.
      case "kSSea9":
        if (evidence(player) & EVIDENCE_BODY) return;
        markEvidence(player, EVIDENCE_BODY);
        return;
      case "dEf_k3":
        if (evidence(player) & EVIDENCE_WINDOW) return;
        markEvidence(player, EVIDENCE_WINDOW);
        return;
      case "HJ2S0x":
      case "r7ksPz":
        if ((evidence(player) & EVIDENCE_WALL) === 0) markEvidence(player, EVIDENCE_WALL);
        // The shipped false-wall text is a message step, so this is the real
        // NpcDialogues dispatch path (not the line event). Bind the per-player
        // confirmation token only for the actual wall interaction at stage 2.
        {
          const interaction = falseWallInteraction.get(player);
          const stage = quest.getStage(player);
          if (interaction && interaction.objectId === FALSE_WALL && interaction.stage === stage && nearMansion(player)) {
            pendingFalseWall.set(player, { stepId, at: Date.now() });
            falseWallInteraction.delete(player);
          }
        }
        return;
      case "iHp8Db":
      case "VKTCTa":
        if (evidence(player) & EVIDENCE_CHEST) return;
        markEvidence(player, EVIDENCE_CHEST);
        return;
      case "w415Kw":
        advanceTo(player, STAGE_GUARD_TOLD);
        return;

      // On the Trail.
      case "ijqT1z": {
        const evelot = trackedFor(player).get("evelot");
        if (evelot) evelot.getCombat?.().attack?.(player);
        return;
      }
      case "Lmr3tb":
        removeTracked(player, "evelot");
        return;

      // The Mysterious Benefactor.
      case "Ci5SW8":
      case "IWDZjw":
        spawnTracked(player, "khazard:cult", NpcIdentifiers.GENERAL_KHAZARD_2, 2611, 9670, 0);
        advanceTo(player, STAGE_CULT);
        return;
      case "ZFwohZ":
        spawnTracked(player, "hazeel:cult", NpcIdentifiers.HAZEEL_2, 2609, 9673, 0);
        return;
      case "zJc3Yx":
        setFlag(player, BUTTON_ATTRIBUTE, true);
        return;
      case "8QrPbp":
        setFlag(player, HIDDEN_ATTRIBUTE, true);
        player.moveTo(new Location(2535, 9620, 0));
        advanceTo(player, STAGE_ROOM);
        return;
      case "nwF5Kh":
        setFlag(player, HIDDEN_ATTRIBUTE, false);
        player.moveTo(new Location(2544, 9697, 0));
        return;
      case "z_T8BY":
        give(player, DUSTY_SCROLL);
        advanceTo(player, STAGE_SCROLL);
        return;
      case "JsBkbT":
        give(player, DUSTY_SCROLL);
        if (!hasFlag(player, SCROLL_READ_ATTRIBUTE)) advanceTo(player, STAGE_SCROLL);
        return;
      case "tdT_B_":
        if (has(player, DUSTY_SCROLL)) take(player, DUSTY_SCROLL, 1);
        for (const key of HAZEEL_KEYS) removeTracked(player, key);
        for (const key of KHAZARD_KEYS) removeTracked(player, key);
        removeTracked(player, "alomone:cult");
        // Stay at SCROLL_READ: the first Big Fish meeting is that stage's
        // transcript, and its line moves the quest to STAGE_NORTH. The native
        // hand-in boundary is 52, which QH reads before the native56 step.
        if (quest.getStage(player) === STAGE_SCROLL_READ) {
          setFlag(player, SCROLL_HANDED_ATTRIBUTE, true);
          // Force the same-stage varbit resend: local setStage() early-returns on equality.
          quest.setStage(player, STAGE_SCROLL_READ);
        }
        syncNpcs(player);
        return;

      // In the North. The mine arrival is the captured cutscene: fade, a private
      // copy of the dungeon, Hazeel/Khazard at (2910,10335)/(2911,10332), the
      // quest theme, then the assassin fight hands control back.
      case "qDWLCo": {
        const scene = openQuestScene(player, "sotn-mine-arrival", [[2890, 2936, 10290, 10360, 0]]);
        player.moveTo(new Location(2902, 10337, 0));
        scenes.actor(scene, HAZEEL_GHORROCK, [2910, 10335, 0], [2925, 10335]);
        const khazard = scenes.actor(scene, KHAZARD_GHORROCK, [2911, 10332, 0], [2926, 10337]);
        // Captured walk (ticks 7130-7139): Khazard strides to (2920,10334)
        // while the argument plays, then leaves the scene.
        const walk = [[2912, 10333], [2913, 10334], [2914, 10334], [2915, 10334],
          [2916, 10334], [2917, 10334], [2918, 10334], [2919, 10334], [2920, 10334]];
        walk.forEach(([x, y], index) => {
          scenes.later(scene, 27 + index, () => khazard?.moveTo(new Location(x, y, 0)));
        });
        scenes.later(scene, 36, () => khazard && scenes.removeActor(scene, khazard));
        playQuestMusic(player, SOTN_MUSIC);
        scenes.later(scene, 2, () => scenes.fade(player, false));
        advanceTo(player, STAGE_ASSASSIN);
        return;
      }
      case "2rSlND": {
        // Captured hand-off: player to (2926,10344), Assassin 12061 at
        // (2927,10352) facing (2927,10357), then 12062 two ticks later.
        player.moveTo(new Location(2926, 10344, 0));
        const beginFight = () => {
          endQuestScene(player);
          const assassin = spawnTracked(player, "assassin", ASSASSIN, 2927, 10352, 0);
          if (assassin) {
            assassin.setPositionToFace?.(new Location(2927, 10357, 0));
            assassin.getCombat?.().attack?.(player);
          }
          playQuestMusic(player, IN_THE_SHADOWS_MUSIC);
          advanceTo(player, STAGE_ASSASSIN);
          // Captured Khazard 12058 arrives from (2928,10343) and steps north.
          const khazard = trackedFor(player).get("khazard:dungeon");
          if (khazard) {
            khazard.moveTo(new Location(2928, 10343, 0));
            TaskManager.submit(new CountdownTask(player, 1, () => khazard.moveTo(new Location(2928, 10347, 0))));
          }
        };
        const scene = scenes.get(player);
        if (scene) {
          scenes.actor(scene, ASSASSIN_CUTSCENE, [2927, 10352, 0], [2927, 10357]);
          scenes.later(scene, 2, beginFight);
        } else {
          beginFight();
        }
        return;
      }
      case "t1w8IH":
        removeTracked(player, "big-fish");
        removeTracked(player, "dead-wolf");
        advanceTo(player, STAGE_MINE);
        return;

      // More Mahjarrat, More Problems.
      case "HWDQ6d": {
        // Captured fight start: player at (2856,4259), the melee creature at
        // (2845,4257), the fight theme and the boss escape loc.
        player.moveTo(new Location(2856, 4259, 0));
        const creature = spawnTracked(player, "creature", STRANGE_CREATURE_ATTACKABLE, 2845, 4257, 0);
        if (creature) creature.getCombat?.().attack?.(player);
        playQuestMusic(player, MUSPAH_FIGHT_MUSIC);
        placeObject(ObjectIdentifiers.CREVICE_42, 2860, 4258, 0, 10, 0);
        advanceTo(player, STAGE_CREATURE);
        return;
      }
      case "-gmPXV": {
        // Captured lair vision: Jhallan 12065 and Assassin 12061 beside the
        // entrance, the player at (2853,4259), camera (2853,4251,510) looking
        // at (2853,4266,310).
        const scene = scenes.get(player);
        if (scene) {
          for (const actor of [...scene.actors]) {
            if (actor.getId?.() === JHALLAN) scenes.removeActor(scene, actor);
          }
          scenes.actor(scene, JHALLAN_CUTSCENE, [2849, 4258, 0], [2869, 4260]);
          scenes.actor(scene, ASSASSIN_CUTSCENE, [2856, 4259, 0], [2829, 4258]);
          scenes.loc(scene, { id: GHORROCK_ENTRANCE, x: 2860, y: 4258, z: 0, type: 10, rotation: 0 });
          player.moveTo(new Location(2853, 4259, 0));
          scenes.camera(player, [2853, 4251, 510], [2853, 4266, 310]);
          scenes.later(scene, 1, () => scenes.fade(player, false));
        }
        return;
      }
      case "1jsvX1": {
        const scene = scenes.get(player);
        if (scene) {
          for (const actor of [...scene.actors]) {
            if (actor.getId?.() === JHALLAN_CUTSCENE || actor.getId?.() === ASSASSIN_CUTSCENE) {
              scenes.removeActor(scene, actor);
            }
          }
        }
        removeTracked(player, "assassin");
        return;
      }
      case "vvqW3S":
        // The dungeon Hazeel/Khazard are the persistent FINALE pair.
        syncNpcs(player);
        return;
      case "BsyVHb":
        advanceTo(player, STAGE_FINALE);
        syncNpcs(player);
        return;
      case "0QH9r5":
        // Back from the lair vision to the captured dungeon spot, with the
        // dungeon camera (2927,10341,494) looking at (2927,10358,294).
        endQuestScene(player);
        player.moveTo(new Location(2927, 10344, 0));
        scenes.camera(player, [2927, 10341, 494], [2927, 10358, 294]);
        syncNpcs(player);
        return;
      case "kQnPVV":
        player.getPacketSender().sendCameraReset();
        player.moveTo(new Location(2570, 3276, 0));
        player.getPacketSender().sendVarbit(ARDOUGNE_TELEPORT_VARBIT, 1);
        for (const key of HAZEEL_KEYS) removeTracked(player, key);
        for (const key of KHAZARD_KEYS) removeTracked(player, key);
        advanceTo(player, STAGE_TELEPORTED);
        return;
      case "uUYIAn":
        player.getPacketSender().sendCameraReset();
        if (!quest.isComplete(player)) quest.complete(player);
        return;
      default:
        return;
    }
  }

  // ==========================================================================
  // Dialogue lines (end-of-conversation stage beats)
  // ==========================================================================

  function handleLine(event) {
    const { player, text } = event;
    const line = String(text ?? "");
    const wallLine = line.startsWith("The wall looks to have been slightly damaged.")
      || line.startsWith("The false wall looks to have been slightly damaged.");
    if (wallLine) {
      if (falseWallInteraction.has(player)) {
        pendingFalseWall.set(player, { line, at: Date.now() });
        falseWallInteraction.delete(player);
      }
      return;
    }
    // Any other spoken line means this is not the false-wall page anymore.
    if (pendingFalseWall.has(player) || falseWallInteraction.has(player)) {
      pendingFalseWall.delete(player);
      falseWallInteraction.delete(player);
    }
    if (line.startsWith("The window was broken from the outside.")) {
      player.setAttribute(TOLD_ATTRIBUTE, (told(player) | TOLD_WINDOW) | 0);
      syncDetails(player);
      return;
    }
    if (line.startsWith("Ceril was stabbed from behind.")) {
      player.setAttribute(TOLD_ATTRIBUTE, (told(player) | TOLD_BODY) | 0);
      syncDetails(player);
      return;
    }
    if (line.startsWith("A hidden room above us was broken into.")) {
      player.setAttribute(TOLD_ATTRIBUTE, (told(player) | TOLD_CHEST) | 0);
      syncDetails(player);
      return;
    }
    if (line.startsWith("Why would the killer come here?")) {
      player.setAttribute(QUESTIONS_ATTRIBUTE, (questions(player) | ASKED_KILLER) | 0);
      syncDetails(player);
      return;
    }
    if (line.startsWith("What is this ritual you keep talking about?")) {
      player.setAttribute(QUESTIONS_ATTRIBUTE, (questions(player) | ASKED_RITUAL) | 0);
      syncDetails(player);
      return;
    }
    if (line.startsWith("Speak with their leader and find out if anything of note has occurred here recently.")) {
      advanceTo(player, STAGE_NORTH);
      return;
    }
    if (line.startsWith("There was the cave-in recently down there as well.")) {
      advanceTo(player, STAGE_WEISS);
      return;
    }
    if (line.startsWith("Well... I thought I saw this shadow in the room")) {
      advanceTo(player, STAGE_CHEF);
      return;
    }
    if (line.startsWith("This assassin must be found.")) {
      advanceTo(player, STAGE_DUNGEON);
    }
  }

  // ==========================================================================
  // Quest start hook
  // ==========================================================================

  function handleHook(event) {
    const { player, hook } = event;
    if (hook !== START_HOOK) return;
    if (quest.getStage(player) !== 0) return;
    if (!meetsRequirements(player)) return;
    for (const varbit of QUEST_START_VARBITS) player.getPacketSender().sendVarbit(varbit, 1);
    player.getPacketSender().sendVarbit(QUEST_START_PROGRESS_VARBIT, 2);
    setStage(player, STAGE_STARTED);
    player.sendMessage("You've started a new quest: <col=081190>Secrets of the North</col>");
  }

  // ==========================================================================
  // Object interactions
  // ==========================================================================

  function resolveObject(event) {
    const definition = event.definition ?? ObjectDefinition.forPlayer?.(event.objectId, event.player) ?? null;
    const objectId = definition?.id ?? event.objectId;
    const option = String(definition?.getInteractions?.()?.[event.clickType - 1] ?? "");
    return { definition, objectId, option };
  }

  function handleObjectInteraction(event) {
    const { player, location } = event;
    const { objectId } = resolveObject(event);
    const stage = quest.getStage(player);

    switch (objectId) {
      // A Death in the Family.
      case CERIL_CORPSE: {
        if (stage < STAGE_STARTED) return;
        event.handled = true;
        if (stage < STAGE_MURDER) {
          startTranscript(api, player, GUARD_NPC, PAGE, "a-death-in-the-family-inspecting-sir-ceril-carnillean-before-talking-to-the-guard");
          return;
        }
        startTranscript(api, player, GUARD_NPC, PAGE, "a-death-in-the-family-inspecting-sir-ceril-s-corpse");
        return;
      }
      case BROKEN_WINDOW:
        if (stage < STAGE_MURDER) return;
        event.handled = true;
        startTranscript(api, player, GUARD_NPC, PAGE, "a-death-in-the-family-inspecting-the-broken-window");
        return;
      case FALSE_WALL:
        if (stage < STAGE_MURDER) return;
        event.handled = true;
        // The secret door is repeatable: every real wall click starts a fresh
        // confirmation page, whether the passage was already used or not.
        pendingFalseWall.delete(player);
        falseWallInteraction.set(player, { objectId: FALSE_WALL, stage, at: Date.now() });
        startTranscript(api, player, GUARD_NPC, PAGE, "a-death-in-the-family-knocking-at-the-false-wall");
        return;
      case HIDDEN_ROOM_CHEST:
        if (stage < STAGE_MURDER) return;
        event.handled = true;
        startTranscript(api, player, GUARD_NPC, PAGE, "a-death-in-the-family-inspecting-the-chest");
        return;

      // The Evelot trail.
      case TRAIL_BARRELS_OBJ:
      case TRAIL_BOULDER_WEST_OBJ:
      case TRAIL_BOULDER_EAST_OBJ:
      case TRAIL_FALLEN_TREE_OBJ:
      case TRAIL_STUMP_OBJ:
      case TRAIL_BUSH_OBJ:
        event.handled = true;
        inspectTrailObject(player, objectId, location);
        return;

      // Getting to the salt mine beneath Weiss. The throne-room stairs are a
      // shared loc teleport (loc-teleports.json); this handles the cave mouth.
      case MINE_CAVE_ENTRANCE:
        if (stage !== STAGE_MINE) return;
        event.handled = true;
        startTranscript(api, player, NpcIdentifiers.GENERAL_KHAZARD_2, PAGE, "in-the-north-entering-the-salt-mine", withoutBlankLines);
        return;
      case CREATURE_LAIR_EXIT:
        // Only the quest's own lair visit; the post-quest Phantom Muspah
        // instance owns this object once the quest is complete.
        if (stage !== STAGE_FINALE) return;
        event.handled = true;
        player.moveTo(new Location(2908, 10317, 0));
        syncNpcs(player);
        return;

      // The Mysterious Benefactor.
      case COOKING_SHELVES_11:
      case COOKING_SHELVES_12:
        if (stage < STAGE_FAMILY || stage >= STAGE_SCROLL) return;
        event.handled = true;
        startTranscript(api, player, GUARD_NPC, PAGE, "the-mysterious-benefactor-searching-the-south-west-cooking-shelves");
        return;
      case KITCHEN_WALL:
        if (stage < STAGE_CHEF) return;
        event.handled = true;
        if (hasFlag(player, HIDDEN_ATTRIBUTE)) {
          startTranscript(api, player, GUARD_NPC, PAGE, "the-mysterious-benefactor-inspecting-the-wall-after-entering-the-hidden-room");
          return;
        }
        if (!hasFlag(player, BUTTON_ATTRIBUTE)) {
          player.sendMessage("The wall looks solid.");
          return;
        }
        startTranscript(api, player, GUARD_NPC, PAGE, "the-mysterious-benefactor-inspecting-the-wall-before-entering-the-hidden-room");
        return;
      case KITCHEN_CHEST:
        if (stage < STAGE_ROOM) return;
        event.handled = true;
        if (has(player, DUSTY_SCROLL) || hasFlag(player, SCROLL_READ_ATTRIBUTE)) {
          startTranscript(api, player, GUARD_NPC, PAGE, "the-mysterious-benefactor-searching-the-chest-after-it-is-unlocked");
          return;
        }
        startTranscript(api, player, GUARD_NPC, PAGE, "the-mysterious-benefactor-picklocking-the-chest");
        return;

      // Ghorrock Dungeon.
      case DUNGEON_BARREL:
        if (stage < STAGE_DUNGEON) return;
        event.handled = true;
        give(player, LEVER_HANDLE);
        player.sendMessage("You search the barrel and find a lever handle among the weapons inside.");
        return;
      case DUNGEON_CRATE_MAP:
        if (stage < STAGE_DUNGEON) return;
        event.handled = true;
        give(player, ANCIENT_MAP);
        player.sendMessage("You search the crate and find an ancient map of the empire's settlements.");
        return;
      case DUNGEON_CRATE_TINDERBOX:
        if (stage < STAGE_DUNGEON) return;
        event.handled = true;
        give(player, TINDERBOX);
        player.sendMessage("You search the crate and find a tinderbox.");
        return;
      case DUNGEON_TABLE_DUKE:
        if (stage < STAGE_DUNGEON) return;
        event.handled = true;
        give(player, DUKE_NOTE);
        player.sendMessage("You search the damaged table and find the Duke's note.");
        return;
      case DUNGEON_TABLE_NUMBERS:
        if (stage < STAGE_BLOOD_GATE) return;
        event.handled = true;
        give(player, NUMBERS_NOTE);
        player.sendMessage("You search the damaged table and find a numbers note.");
        return;
      case DUNGEON_CHEST_LETTER:
        if (stage < STAGE_DUNGEON) return;
        event.handled = true;
        if (has(player, TULLIA_LETTER)) {
          player.sendMessage("The chest is empty.");
          return;
        }
        give(player, TULLIA_LETTER);
        player.sendMessage("You search the chest and find Tullia's letter.");
        return;
      case DUNGEON_CHEST_LIST:
        if (stage < STAGE_DUNGEON) return;
        event.handled = true;
        give(player, STRANGE_LIST);
        advanceTo(player, STAGE_LIST);
        player.sendMessage("You search the chest and find a strange list.");
        return;
      case LEVER_MECHANISM:
        event.handled = true;
        player.sendMessage("The lever mechanism is missing its handle. It could probably be found nearby.");
        return;
      case DUNGEON_LEVER:
        if (stage < STAGE_HANDLE) return;
        event.handled = true;
        closeSolvedGate(player, DUNGEON_GATE_DIRECTION);
        player.getPacketSender().sendVarbit(LEVER_VARBIT, 2);
        player.sendMessage("As you pull the lever, you hear a strange click coming from the north east.");
        advanceTo(player, STAGE_LEVER);
        return;
      case DUNGEON_PILLAR:
        if (stage < STAGE_LEVER) return;
        event.handled = true;
        if (has(player, JEWEL_SHARD_PILLAR) && has(player, STRANGE_CIPHER)) {
          player.sendMessage("You have already searched the pillar.");
          return;
        }
        give(player, JEWEL_SHARD_PILLAR);
        give(player, STRANGE_CIPHER);
        advanceTo(player, STAGE_PILLAR);
        player.sendMessage("You find a jewel shard and a strange cipher hidden in the pillar.");
        return;
      case DUNGEON_GATE_DIRECTION:
      case DUNGEON_GATE_BLOOD:
      case DUNGEON_GATE_ICY:
        if (crossSolvedGate(event)) return;
        event.handled = true;
        handleDungeonGate(player, objectId, location);
        return;
      case DUNGEON_BRAZIER:
        event.handled = true;
        player.sendMessage("The brazier is unlit. A tinderbox could light it.");
        return;
      case DUNGEON_CHEST_WEST:
        event.handled = true;
        if (stage < STAGE_BRAZIERS) {
          player.sendMessage("The chest is sealed shut.");
          return;
        }
        if (stage >= STAGE_WEST_CHEST) {
          player.sendMessage("The chest is empty.");
          return;
        }
        if (freeSlots(player) === 0) {
          player.sendMessage("You need at least one free inventory slot to take the contents.");
          return;
        }
        give(player, JEWEL_SHARD_CHEST);
        give(player, SETTLEMENTS_NOTE);
        advanceTo(player, STAGE_WEST_CHEST);
        player.sendMessage("You open the chest and find an old note and a strange shard inside.");
        return;
      case DUNGEON_CHEST_NORTH:
        event.handled = true;
        if (stage < STAGE_JEWEL) {
          player.sendMessage("The chest has four dials. You need the right passcode.");
          return;
        }
        if (stage >= STAGE_ICY_CHEST) {
          if (stage >= STAGE_ICY_KEY && stage < STAGE_ICY_GATE && !has(player, ICY_KEY)) {
            if (freeSlots(player) === 0) {
              player.sendMessage("You need at least one free inventory slot to take the chest.");
              return;
            }
            give(player, ICY_KEY);
            player.sendMessage("You recover a key from within.");
            return;
          }
          player.sendMessage("The chest is empty.");
          return;
        }
        if (freeSlots(player) === 0) {
          player.sendMessage("You need at least one free inventory slot to take the chest.");
          return;
        }
        chestLock.open(player);
        return;
      case DUNGEON_CREVICE_39:
        // The western crevice is the way back out of the dungeon.
        if (stage < STAGE_ASSASSIN) return;
        event.handled = true;
        player.moveTo(new Location(2867, 3940, 0));
        return;
      case DUNGEON_CREVICE_40:
        // After the creature, the crevice leads to the Phantom Muspah's lair (PhantomMuspah.plugin.js).
        if (stage > STAGE_CREATURE) return;
        event.handled = true;
        if (stage < STAGE_ICY_GATE) {
          player.sendMessage("The crevice is too narrow to squeeze through here.");
          return;
        }
        startTranscript(api, player, STRANGE_CREATURE, PAGE, "more-mahjarrat-more-problems-upon-entering-the-strange-creature-room", withoutBlankLines);
        return;
      default:
        return;
    }
  }

  /**
   * Doors.plugin.js matches these gates by name ("Gate"/Open) and opens them
   * before the catch-all object hook runs, so the LEFT/UP/LEFT/DOWN, BLOOD and
   * icy-keyhole logic is claimed through door:toggle; the object hook above
   * still runs it for any other click type.
   */
  function handleDoorToggle(request) {
    if (request.handled) return;
    if (request.objectId !== DUNGEON_GATE_DIRECTION
      && request.objectId !== DUNGEON_GATE_BLOOD
      && request.objectId !== DUNGEON_GATE_ICY) return;
    request.handled = true;
    if (crossSolvedGate(request)) return;
    handleDungeonGate(request.player, request.objectId, request.location);
  }

  function solvedDirectionGate(player) {
    if (quest.getStage(player) >= STAGE_DIRECTION_GATE) return;
    advanceTo(player, STAGE_DIRECTION_GATE);
    player.sendMessage("You unlock the gate.");
  }

  function solvedBloodGate(player) {
    if (quest.getStage(player) >= STAGE_BLOOD_GATE) return;
    advanceTo(player, STAGE_BLOOD_GATE);
    player.sendMessage("You unlock the gate.");
  }

  function solvedIcyChest(player) {
    if (quest.getStage(player) >= STAGE_ICY_CHEST) return;
    if (freeSlots(player) === 0) {
      player.sendMessage("You need at least one free inventory slot to take the chest.");
      return;
    }
    give(player, ICY_CHEST);
    advanceTo(player, STAGE_ICY_CHEST);
    player.sendMessage("You unlock the chest and find a smaller chest inside.");
  }

  /**
   * Captured solved-gate states: 46601/46602/46603 close; 38848 + 46604 open.
   * The pair is sent only to the crossing player, the server keeps the wall
   * clipping, and ObstacleRunner walks the captured threshold. A solved gate
   * therefore never unlocks the same gate for another player.
   */
  const SOLVED_GATES = [
    { closed: DUNGEON_GATE_DIRECTION, x: 2916, y: 10338, face: 3, leafFace: 0, stage: STAGE_DIRECTION_GATE },
    { closed: DUNGEON_GATE_BLOOD, x: 2924, y: 10329, face: 2, leafFace: 3, stage: STAGE_BLOOD_GATE },
    { closed: DUNGEON_GATE_ICY, x: 2918, y: 10321, face: 2, leafFace: 3, stage: STAGE_ICY_GATE },
  ];
  const gateCrossings = new WeakMap();
  const openSolvedGates = new WeakMap();

  function sendQuestGateState(player, gate, open) {
    const sender = player.getPacketSender();
    const at = new Location(gate.x, gate.y, 0);
    const [dx, dy] = [[-1, 0], [0, 1], [1, 0], [0, -1]][gate.face & 3];
    const leafAt = new Location(gate.x + dx, gate.y + dy, 0);
    const raw = (id, location, face) => new api.core.GameObject(id, location.clone(), 0, face, null);
    if (open) {
      sender.sendObjectRemoval(raw(gate.closed, at, gate.face));
      sender.sendObject(raw(GATE_OPEN_INVISWALL, at, gate.face));
      sender.sendObject(raw(GATE_OPEN_LEAF, leafAt, gate.leafFace));
    } else {
      sender.sendObjectRemoval(raw(GATE_OPEN_INVISWALL, at, gate.face));
      sender.sendObjectRemoval(raw(GATE_OPEN_LEAF, leafAt, gate.leafFace));
      sender.sendObject(raw(gate.closed, at, gate.face));
    }
  }

  function closeSolvedGate(player, closedId) {
    const gate = gateCrossings.get(player) ?? openSolvedGates.get(player);
    if (!gate || (closedId !== undefined && gate.closed !== closedId)) return false;
    sendQuestGateState(player, gate, false);
    gateCrossings.delete(player);
    openSolvedGates.delete(player);
    return true;
  }

  /**
   * Ordinary walk through a direction gate left open until the lever. The
   * captured open leaf 46604 has no actions, so the server keeps its own
   * clipping and scopes the threshold walk to this request. `destination` is
   * the MovementQueue plain payload `{x,y,z}` (never a Location).
   */
  function routeOpenGateWalk(event) {
    const gate = openSolvedGates.get(event.player);
    const destination = event.destination;
    if (!gate || !destination) return;
    if (ObstacleRunner.isBusy(event.player) || gateCrossings.has(event.player)) return;
    const from = event.player.getLocation();
    if (from.getZ() !== 0 || destination.z !== 0) return;
    if (Math.abs(from.getX() - gate.x) > 3 || Math.abs(from.getY() - gate.y) > 3) return;
    const [dx, dy] = [[-1, 0], [0, 1], [1, 0], [0, -1]][gate.face & 3];
    const sideFrom = (from.getX() - gate.x) * dx + (from.getY() - gate.y) * dy;
    const sideTo = (destination.x - gate.x) * dx + (destination.y - gate.y) * dy;
    const fromFront = sideFrom > 0;
    const front = sideTo > 0;
    if (fromFront === front) return;
    event.handled = true;
    const thresholdX = front ? gate.x + dx : gate.x;
    const thresholdY = front ? gate.y + dy : gate.y;
    const resume = () => {
      if (event.player.getLocation().getX() === destination.x && event.player.getLocation().getY() === destination.y) return;
      event.player.getMovementQueue().walkToTile(new Location(destination.x, destination.y, 0), () => {});
    };
    const cross = () => {
      ObstacleRunner.run({ player: event.player }, [{ wait: 1 }, { walk: [[thresholdX, thresholdY]] }], {
        onFinish: (completed) => { if (completed) resume(); },
      });
    };
    const approachX = gate.x + dx * (fromFront ? 1 : -1);
    const approachY = gate.y + dy * (fromFront ? 1 : -1);
    const atAnchor = from.getX() === gate.x && from.getY() === gate.y;
    if (atAnchor || (from.getX() === approachX && from.getY() === approachY)) cross();
    else event.player.getMovementQueue().walkToTile(new Location(approachX, approachY, 0), cross);
  }

  function crossSolvedGate(event) {
    const { player, objectId } = event;
    const gate = SOLVED_GATES.find((entry) => entry.closed === objectId);
    if (!gate) return false;
    if (quest.getStage(player) < gate.stage) return false;
    const at = event.object?.getLocation?.() ?? event.location;
    if (!at || at.getX() !== gate.x || at.getY() !== gate.y || at.getZ() !== 0) return false;
    const from = player.getLocation();
    if (from.getZ() !== 0
      || Math.abs(from.getX() - gate.x) > 1 || Math.abs(from.getY() - gate.y) > 1) return false;
    if (gateCrossings.has(player) || ObstacleRunner.isBusy(player)) {
      event.handled = true;
      return true;
    }
    const door = event.object ?? api.core.MapObjects.get(
      gate.closed, new Location(gate.x, gate.y, 0), player.getPrivateArea?.() ?? null);
    const crossing = crossingFor(door, from);
    if (!crossing) return false;
    event.handled = true;
    gateCrossings.set(player, gate);
    sendQuestGateState(player, gate, true);
    ObstacleRunner.run({ player, object: door }, [{ wait: 1 }, { walk: [[crossing.destination.x, crossing.destination.y]] }], {
      onFinish: (completed) => {
        // Capture 1694 [7475]..[7477]: the direction gate stays open through the
        // threshold walk and closes when the player operates the lever. Blood/icy
        // close after their crossing; never claim a tick we did not capture.
        if (gate.closed === DUNGEON_GATE_DIRECTION && completed) {
          gateCrossings.delete(player);
          openSolvedGates.set(player, gate);
          return;
        }
        closeSolvedGate(player, gate.closed);
      },
    });
    return true;
  }

  function handleDungeonGate(player, objectId, location) {
    if (objectId === DUNGEON_GATE_DIRECTION) {
      if (quest.getStage(player) >= STAGE_DIRECTION_GATE) {
        player.sendMessage("The gate is already open.");
        return;
      }
      directionLock.open(player);
      return;
    }
    if (objectId === DUNGEON_GATE_BLOOD) {
      if (quest.getStage(player) >= STAGE_BLOOD_GATE) {
        player.sendMessage("The gate is already open.");
        return;
      }
      bloodLock.open(player);
      return;
    }
    if (!has(player, ICY_KEY)) {
      player.sendMessage("The gate is locked. A small keyhole glints in the ice.");
      return;
    }
    advanceTo(player, STAGE_ICY_GATE);
    player.sendMessage("You use the icy key to unlock the gate.");
  }

  function inspectTrailObject(player, objectId, location) {
    const stage = quest.getStage(player);
    if (stage < STAGE_BRIBED || stage > STAGE_TRAIL) return;
    const bits = trail(player);
    const marks = new Map([
      [TRAIL_BARRELS_OBJ, TRAIL_BARRELS],
      [TRAIL_BOULDER_WEST_OBJ, TRAIL_BOULDER_WEST],
      [TRAIL_STUMP_OBJ, TRAIL_STUMP],
      [TRAIL_BOULDER_EAST_OBJ, TRAIL_BOULDER_EAST],
    ]);
    let bit = marks.get(objectId);
    if (objectId === TRAIL_BUSH_OBJ) {
      const x = location?.getX?.() ?? location?.x;
      bit = x === 2621 ? TRAIL_BUSH_EAST : TRAIL_BUSH;
    }
    if (bit === undefined) {
      player.sendMessage("You search the fallen tree but find nothing.");
      return;
    }
    if (bits & bit) {
      player.sendMessage("You have already searched here.");
      return;
    }
    player.setAttribute(TRAIL_ATTRIBUTE, (bits | bit) | 0);
    const messages = new Map([
      [TRAIL_BARRELS, "The barrels have been disturbed recently. Someone came this way."],
      [TRAIL_BOULDER_WEST, "The ground around the boulder has been disturbed recently. Someone came this way."],
      [TRAIL_BOULDER_EAST, "The ground around the boulder has been disturbed recently. Someone came this way."],
      [TRAIL_STUMP, "The tree stump has been disturbed recently. Someone came this way."],
      [TRAIL_BUSH, "The bush has been disturbed recently. Someone came this way."],
      [TRAIL_BUSH_EAST, "The bush has been disturbed recently. Someone came this way."],
    ]);
    player.sendMessage(messages.get(bit));
    player.getPacketSender().sendVarbit(TRAIL_VARBITS.get(bit), 1);
    if ((bits | bit) === TRAIL_ALL) {
      for (const varbit of TRAIL_VARBITS.values()) player.getPacketSender().sendVarbit(varbit, 0);
      advanceTo(player, STAGE_TRAIL);
    }
  }

  // ==========================================================================
  // Item on object / item on item / item actions
  // ==========================================================================

  function handleItemOnObject(event) {
    const { player, itemId } = event;
    const { objectId } = resolveObject(event);
    if (itemId === TINDERBOX && objectId === DUNGEON_BRAZIER) {
      event.handled = true;
      if (quest.getStage(player) < STAGE_BLOOD_GATE) {
        player.sendMessage("The braziers are behind the sealed gate.");
        return;
      }
      const index = brazierIndex(event.location);
      const lit = braziersLit(player);
      if (index === -1 || index < lit) {
        player.sendMessage("This brazier is already lit.");
        return;
      }
      if (index > lit) {
        player.setAttribute(BRAZIERS_ATTRIBUTE, 0);
        for (const varbit of BRAZIER_VARBITS) player.getPacketSender().sendVarbit(varbit, 0);
        player.sendMessage("The flame sputters out. They must be lit in a specific order.");
        return;
      }
      player.setAttribute(BRAZIERS_ATTRIBUTE, (lit + 1) | 0);
      player.getPacketSender().sendVarbit(BRAZIER_VARBITS[index], BRAZIER_VALUES[index]);
      if (lit + 1 >= BRAZIER_TILES.length) {
        for (const varbit of BRAZIER_VARBITS) player.getPacketSender().sendVarbit(varbit, 0);
        player.getPacketSender().sendVarbit(BRAZIER_CHEST_VARBIT, 1);
        advanceTo(player, STAGE_BRAZIERS);
        player.sendMessage("You light the brazier with your tinderbox and hear a click as you do so.");
        return;
      }
      player.sendMessage("You light the brazier with your tinderbox.");
      return;
    }
    if (itemId === LEVER_HANDLE && objectId === LEVER_MECHANISM) {
      event.handled = true;
      if (quest.getStage(player) < STAGE_DUNGEON) return;
      take(player, LEVER_HANDLE, 1);
      replaceObject(LEVER_MECHANISM, DUNGEON_LEVER, 2917, 10342, 0, 10, 2);
      player.getPacketSender().sendVarbit(LEVER_VARBIT, 1);
      advanceTo(player, STAGE_HANDLE);
      player.sendMessage("You replace the missing lever handle.");
      return;
    }
  }

  function handleItemOnItem(event) {
    const { player, usedItemId, usedWithItemId } = event;
    const ids = new Set([usedItemId, usedWithItemId]);
    if (ids.has(JEWEL_SHARD_PILLAR) && ids.has(JEWEL_SHARD_CHEST)) {
      event.handled = true;
      if (quest.getStage(player) < STAGE_WEST_CHEST) return;
      take(player, JEWEL_SHARD_PILLAR, 1);
      take(player, JEWEL_SHARD_CHEST, 1);
      give(player, ANCIENT_JEWEL);
      advanceTo(player, STAGE_JEWEL);
      player.sendMessage("You fit the two jewel shards together into an ancient jewel.");
      return;
    }
    if (ids.has(ANCIENT_JEWEL) && ids.has(ICY_CHEST)) {
      event.handled = true;
      if (quest.getStage(player) < STAGE_ICY_CHEST) return;
      take(player, ICY_CHEST, 1);
      give(player, ICY_KEY);
      advanceTo(player, STAGE_ICY_KEY);
      player.sendMessage("You insert the jewel into the slot on the chest and it opens. You recover a key from within.");
    }
  }

  /**
   * Item 27595's inventory option is "Inspect" (not "Read") in this cache.
   * Inspecting it is the QH step that starts the reading transcript.
   */
  function readDustyScroll(player) {
    if (hasFlag(player, SCROLL_READ_ATTRIBUTE)) return;
    setFlag(player, SCROLL_READ_ATTRIBUTE, true);
    if (quest.getStage(player) === STAGE_SCROLL) setStage(player, STAGE_SCROLL_READ);
    startTranscriptDeferred(player, GUARD_NPC, "the-mysterious-benefactor-reading-the-scroll", withoutBlankLines);
  }

  function handleItemAction(event) {
    const { player, itemId, option } = event;
    const action = String(option ?? "").toLowerCase();
    if (action !== "read" && action !== "inspect") return;
    switch (itemId) {
      case DUSTY_SCROLL:
        event.handled = true;
        readDustyScroll(player);
        return;
      case TULLIA_LETTER:
        event.handled = true;
        player.sendMessage("The purple letters read S, P, C, D, L. The letter names the settlements Senntisten, Paddewwa, Carrallanger, Dareeyak and Lassar.");
        return;
      case ANCIENT_MAP:
        event.handled = true;
        player.sendMessage("The map marks the old Zarosian settlements: Senntisten, Paddewwa, Carrallanger, Dareeyak, Lassar, Kharyrll and Kharid-et.");
        return;
      case DUKE_NOTE:
        event.handled = true;
        player.sendMessage("Names of old Zarosian figures, some letters missing. The strange list would fill in the blanks.");
        return;
      case STRANGE_CIPHER:
        event.handled = true;
        player.sendMessage("A cipher matching symbols to letters.");
        return;
      case STRANGE_LIST:
        event.handled = true;
        player.sendMessage("A list of names. With the cipher and the Duke note it spells out a hidden message.");
        return;
      case NUMBERS_NOTE:
        event.handled = true;
        player.sendMessage("The note shows the number 3241, with 4: NE written in the top left.");
        return;
      case SETTLEMENTS_NOTE:
        event.handled = true;
        player.sendMessage("Lines connect the old settlements. Together with the ancient map they give a four-digit passcode.");
        return;
      default:
        return;
    }
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
    if (tracked.get("evelot") === npc) {
      tracked.delete("evelot");
      if (stage !== STAGE_TRAIL) return;
      advanceTo(killer, STAGE_EVELOT);
      startTranscriptDeferred(killer, EVELOT, "on-the-trail-talking-to-evelot-after-defeating-her", withoutBlankLines);
      return;
    }
    if (tracked.get("assassin") === npc) {
      tracked.delete("assassin");
      if (stage !== STAGE_ASSASSIN) return;
      // Captured Khazard switches from his sword form (12059) to the general
      // (12055) once the assassin falls.
      trackedFor(killer).get("khazard:dungeon")?.setNpcTransformationId?.(NpcIdentifiers.GENERAL_KHAZARD_6);
      advanceTo(killer, STAGE_ASSASSIN_DEAD);
      startTranscriptDeferred(killer, NpcIdentifiers.GENERAL_KHAZARD_2, "in-the-north-defeating-the-assassin", withoutBlankLines);
      return;
    }
    if (tracked.get("creature") === npc) {
      tracked.delete("creature");
      if (stage !== STAGE_CREATURE) return;
      // Advance before the cutscene so an interrupted client can still recover
      // in the dungeon. The captured lair scene: Jhallan at (2846,4257), the
      // quest theme, the exit at (2860,4258), fade and movement lock.
      advanceTo(killer, STAGE_FINALE);
      // The boss escape loc turns into the quest lair exit on death.
      replaceObject(ObjectIdentifiers.CREVICE_42, CREATURE_LAIR_EXIT, 2860, 4258, 0, 10, 0);
      const scene = openQuestScene(killer, "sotn-finale", [[2820, 2870, 4230, 4290, 0]]);
      killer.moveTo(new Location(2845, 4257, 0));
      scenes.actor(scene, JHALLAN, [2846, 4257, 0], [2845, 4257]);
      scenes.loc(scene, { id: CREATURE_LAIR_EXIT, x: 2860, y: 4258, z: 0, type: 10, rotation: 0 });
      playQuestMusic(killer, SOTN_MUSIC);
      scenes.later(scene, 2, () => scenes.fade(killer, false));
      startTranscriptDeferred(killer, JHALLAN, "more-mahjarrat-more-problems-defeating-the-creature", withoutBlankLines);
    }
  }

  // ==========================================================================
  // Zones and lifecycle
  // ==========================================================================

  const SALT_MINE_ZONE = { minX: 2820, maxX: 2856, minY: 10324, maxY: 10362, levels: [0] };

  function handleSaltMineEnter(event) {
    const { player } = event;
    if (quest.getStage(player) !== STAGE_MINE) return;
    startTranscriptDeferred(player, NpcIdentifiers.GENERAL_KHAZARD_2, "in-the-north-entering-the-salt-mine", withoutBlankLines);
  }

  function playQuestMusic(player, trackId) {
    api.emitCustomEvent("music:unlock-track", { player, trackId });
    player.getPacketSender().sendSong(trackId);
  }

  /** Fades out and opens a private, owner-only copy of the captured scene. */
  function openQuestScene(player, name, bounds) {
    const scene = scenes.open(player, name, bounds);
    scenes.controls(player, true, true);
    scenes.fade(player, true);
    return scene;
  }

  function endQuestScene(player) {
    if (scenes.get(player)) scenes.end(player, false);
  }

  function handleSceneEnd(player) {
    if (player) syncNpcs(player);
  }

  function handleLogout({ player }) {
    if (!player) return;
    pendingFalseWall.delete(player);
    falseWallInteraction.delete(player);
    closeSolvedGate(player);
    if (scenes.get(player)) scenes.end(player, true);
  }

  function handlePlayerDeath({ player }) {
    if (!player) return;
    pendingFalseWall.delete(player);
    falseWallInteraction.delete(player);
  }

  function handleInterfaceClosed({ player }) {
    if (!player) return;
    pendingFalseWall.delete(player);
    falseWallInteraction.delete(player);
  }

  function handleLogin({ player }) {
    installQuestObjects();
    if (scenes.get(player)) {
      scenes.end(player, false);
      const stage = quest.getStage(player);
      if (stage === STAGE_ASSASSIN) player.moveTo(new Location(2902, 10337, 0));
      if (stage === STAGE_FINALE) player.moveTo(new Location(2927, 10344, 0));
    }
    if (hasFlag(player, HIDDEN_PASSAGE_ATTRIBUTE)) {
      const at = player.getLocation();
      if (at.getZ() === 1 && at.getX() === 2572 && at.getY() === 3270) {
        player.moveTo(new Location(2572, 3269, 1));
      }
    }
    if (quest.getStage(player) === STAGE_FINALE) player.getPacketSender().sendCameraReset();
    syncDetails(player);
    syncNpcs(player);
  }

  // ==========================================================================
  // Journal and reward
  // ==========================================================================

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      return [
        "<str>I helped Hazeel and Khazard investigate Sir Ceril's murder,</str>",
        "<str>tracked the killer to the Ghorrock Dungeon and uncovered</str>",
        "<str>the plot of a hidden Mahjarrat.</str>",
        "",
        "<col=ff0000>QUEST COMPLETE!</col>",
      ];
    }
    if (stage >= STAGE_TELEPORTED) {
      return ["I should report back to the <col=800000>guard</col> at the Carnillean Mansion."];
    }
    if (stage >= STAGE_FINALE) {
      return ["The assassin escaped into the prison. I should report back to the",
        "<col=800000>guard</col> at the Carnillean Mansion."];
    }
    if (stage >= STAGE_DUNGEON) {
      return [
        "<str>Sir Ceril was murdered and Hazeel and Khazard came north.</str>",
        "<str>After beating the assassin, I must search the Ghorrock Dungeon.</str>",
        "",
        stage >= STAGE_ICY_GATE
          ? "I should enter the <col=800000>crevice</col> beyond the icy gate."
          : "I should solve the dungeon's locks and find the prison's key.",
      ];
    }
    if (stage >= STAGE_ASSASSIN_DEAD) {
      return ["I should speak to <col=800000>Hazeel</col> in the Ghorrock Dungeon."];
    }
    if (stage >= STAGE_MINE) {
      return ["I should meet Hazeel and Khazard in the <col=800000>salt mine</col> beneath Weiss."];
    }
    if (stage >= STAGE_NORTH) {
      return ["I should ask the Weiss trolls, <col=800000>Snowflake</col> and <col=800000>My Arm</col>,",
        "whether they have seen anything odd, then report to <col=800000>Big Fish</col>."];
    }
    if (stage >= STAGE_SCROLL_READ) {
      if (!has(player, DUSTY_SCROLL)) {
        return ["I should meet <col=800000>Hazeel</col> and <col=800000>Khazard</col> outside",
          "the troll settlement of <col=800000>Weiss</col> in the north."];
      }
      return ["I should take the <col=800000>dusty scroll</col> to <col=800000>Hazeel</col> at the cult hideout."];
    }
    if (stage >= STAGE_SCROLL) {
      return ["I found a <col=800000>dusty scroll</col> in the hidden room. I should read it."];
    }
    if (stage >= STAGE_CHEF) {
      return ["I should search the <col=800000>cooking shelves</col> in the mansion kitchen."];
    }
    if (stage >= STAGE_FAMILY) {
      return ["I should question the Carnillean family.",
        "The chef <col=800000>Claus</col> is down in the kitchen."];
    }
    if (stage >= STAGE_CULT) {
      return ["<col=800000>Hazeel</col> wants the Carnillean family questioned.",
        "I should speak to the <col=800000>guard</col> at the mansion first."];
    }
    if (stage >= STAGE_EVELOT) {
      return ["<col=800000>Evelot</col> was hired to steal a scroll and delivered it to",
        "the cultists south of the city. I should find their hideout."];
    }
    if (stage >= STAGE_TRAIL) {
      return ["The tracks lead to a <col=800000>rowboat</col> south of the Tower of Life."];
    }
    if (stage >= STAGE_BRIBED) {
      return ["I bribed the barman. I should search the <col=800000>Fight Arena</col> area",
        "for traces of <col=800000>Evelot</col>."];
    }
    if (stage >= STAGE_GUARD_TOLD) {
      return ["The guard found a Khazard Army amulet with the name <col=800000>Evelot</col>.",
        "I should ask about her at the <col=800000>Fight Arena bar</col>."];
    }
    if (stage >= STAGE_MURDER) {
      return ["I should inspect the crime scene: Sir Ceril's body, the <col=800000>broken window</col>,",
        "the <col=800000>false wall</col> and the chest in the hidden room."];
    }
    if (stage >= STAGE_STARTED) {
      return ["I should follow the <col=800000>guard</col> and hear what happened."];
    }
    return [
      "I can start this quest by talking to the <col=800000>guard</col> outside",
      "the <col=800000>Carnillean Mansion</col> in East Ardougne.",
      "",
      "I must have completed Making Friends with My Arm, Devious Minds and",
      "Hazeel Cult and have 69 Agility, 64 Thieving and 56 Hunter.",
    ];
  }

  function grantReward(player) {
    const skills = player.getSkillManager();
    skills.addExperiences(Skill.AGILITY, 60000);
    skills.addExperiences(Skill.THIEVING, 50000);
    skills.addExperiences(Skill.HUNTER, 40000);
  }

  // ==========================================================================
  // Registration
  // ==========================================================================

  api.persistAttribute(EVIDENCE_ATTRIBUTE);
  api.persistAttribute(TRAIL_ATTRIBUTE);
  api.persistAttribute(BUTTON_ATTRIBUTE);
  api.persistAttribute(HIDDEN_ATTRIBUTE);
  api.persistAttribute(BRIBE_ATTRIBUTE);
  api.persistAttribute(SCROLL_READ_ATTRIBUTE);
  api.persistAttribute(SCROLL_HANDED_ATTRIBUTE, false);
  api.persistAttribute(BRAZIERS_ATTRIBUTE);
  api.persistAttribute(HIDDEN_PASSAGE_ATTRIBUTE, false);
  api.persistAttribute(TOLD_ATTRIBUTE, 0);
  api.persistAttribute(QUESTIONS_ATTRIBUTE, 0);

  quest = registerQuest(api, {
    key: "secrets_of_the_north",
    name: "Secrets of the North",
    varpId: 3742, // sotn_primary
    varbitId: 14722, // sotn, bits 0-8
    varbitValue: (stage, player) => stage === STAGE_SCROLL_READ && hasFlag(player, SCROLL_HANDED_ATTRIBUTE) ? 52 : NATIVE_STAGE_VARBIT[stage] ?? 0,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 2,
    xpRewards: [
      { skillId: Skill.AGILITY.getIndex(), amount: 60000, label: "Agility" },
      { skillId: Skill.THIEVING.getIndex(), amount: 50000, label: "Thieving" },
      { skillId: Skill.HUNTER.getIndex(), amount: 40000, label: "Hunter" },
    ],
    scrollItemId: DUSTY_SCROLL,
    otherRewards: ["Access to the Phantom Muspah", "Ability to mine ancient essence crystals"],
    buildJournal,
    onReward: grantReward,
  });

  scenes = createQuestScenes(api, { onEnd: handleSceneEnd });
  ObstacleRunner.init(api);
  directionLock = createDirectionalLock(api, { solution: [3, 0, 3, 2], onSolved: solvedDirectionGate });
  bloodLock = createCombinationLock(api, { digits: [3, 5, 9, 4, 7], datasetRow: 2340, onSolved: solvedBloodGate });
  chestLock = createCombinationLock(api, { digits: [7, 4, 0, 2], datasetRow: 2339, onSolved: solvedIcyChest });

  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:hook", handleHook);
  api.onCustomEvent("npc-dialogue:condition", handleChosenCondition);
  api.onCustomEvent("npc-dialogue:choice", handleChoice);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onCustomEvent("npc-dialogue:line", handleLine);
  api.onWalkRoute(routeOpenGateWalk);
  api.onObjectRoute(routeHiddenLadder);
  api.onCustomEvent("ladders:climb", claimHiddenLadder);
  api.onCustomEvent("door:toggle", handleDoorToggle);
  api.onNpcInteraction("Guard", { "Talk-to": talkGuard });
  api.onNpcInteraction("Claus the Chef", { "Talk-to": talkClaus });
  api.onNpcInteraction("Henryeta Carnillean", { "Talk-to": talkHenryeta });
  api.onNpcInteraction("Philipe Carnillean", { "Talk-to": talkPhilipe });
  api.onNpcInteraction("Khazard Barman", { "Talk-to": talkBarman });
  api.onNpcInteraction("Evelot", { "Talk-to": talkEvelot });
  api.onNpcInteraction("Hazeel", { "Talk-to": talkHazeel });
  api.onNpcInteraction("General Khazard", { "Talk-to": talkGeneralKhazard });
  api.onNpcInteraction("Clivet", { "Talk-to": talkClivet });
  api.onNpcInteraction("Alomone", { "Talk-to": talkAlomone });
  api.onNpcInteraction("Big Fish", { "Talk-to": talkBigFish });
  api.onNpcInteraction("Dead Wolf", { "Talk-to": talkBigFish });
  api.onNpcInteraction("Snowflake", { "Talk-to": talkSnowflake });
  api.onNpcInteraction("My Arm", { "Talk-to": talkMyArm });
  api.onObjectInteraction(handleObjectInteraction);
  api.onItemOnObject(handleItemOnObject, { noted: false });
  api.onItemOnItem(handleItemOnItem);
  api.onItemAction(handleItemAction);
  api.onNpcDeath(handleNpcDeath);
  api.onZoneEnter(SALT_MINE_ZONE, handleSaltMineEnter);
  api.onPlayerLogin(handleLogin);
  api.onPlayerLogout(handleLogout);
  api.onPlayerDisconnect(handleLogout);
  api.onPlayerDeath(handlePlayerDeath);
  api.onCustomEvent("interface:closed", handleInterfaceClosed);
};
