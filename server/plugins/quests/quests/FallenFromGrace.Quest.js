/**
 * Fallen From Grace (members).
 *
 * The words come from the "Fallen From Grace" transcript page ("Fallen From Grace" in
 * npc-dialogues.json). This plugin supplies the variant selector for Cormac, Muriel and
 * Mortimer, the start hook, the prose-condition answers, and the quest's object/item/NPC
 * interactions.
 *
 * Stages (varp 5715 "ffg_primary", varbit 15759 "ffg", bits 0-6), as live sends them
 * (rsprox captures "Fallen From Grace" P1 and P2, the user's own) and as Quest Helper's
 * loadSteps keys on them: 0 not started, 2 started (Cormac's Yes), 3 sent to Muriel (Cormac's
 * last line, P1 tick 107), 4 Muriel pointed at the monolith (P1 tick 129), 5 found the notebook,
 * 6 found the hat, 8 Cormac explained the Mad Angel (P1 tick 358), 9 sailed into the cavern,
 * 11 Mortimer asked for the three trolls (P2 tick 57; the kills are flag 15769, tick 151),
 * 13 rocks cleared (tick 167), 14 took the dull core, 15 powered the golem, 16 climbed into the
 * cathedral (tick 292), 18 Mad Angel dead (tick 431), 19 read Elessia's letter (tick 449), 20
 * complete.
 *
 * The values are pinned by the cache's own multilocs, which read varbit 15759 directly:
 * ffg_dust shows 5-9 (the trail after the notebook), ffg_fake_rocks_1/2 clear at 12+,
 * slayer_master_mortimer and the powered golem appear at 12+/15+, ffg_corpse_keenan and
 * mad_angel_cathedral show 16-19, and 20 is the finished state. The per-step flags live in the
 * sibling varbits 15760-15773 (ffg_met_cormac .. ffg_found_body) and are mirrored from a
 * persisted bitfield.
 *
 * Source: the captures above, https://oldschool.runescape.wiki/w/Fallen_From_Grace and
 * https://oldschool.runescape.wiki/w/Fallen_From_Grace/Quick_guide
 * Rewards per the wiki: 2 Quest points, 10,000 Crafting, 12,500 Sailing, 5,000 Mining and
 * 5,000 Runecraft XP; the final letter is taken back on completion.
 *
 * Requirements (62 Sailing, 60 Crafting, 47 Runecraft, 53 Mining and Pandemonium) are
 * enforced when the start option is chosen, because the wiki's start choice carries no
 * condition step to answer.
 *
 * As captured:
 * - The transcript's message steps show as message or item boxes (objectbox with the notebook,
 *   the dull core, the key and the letter; the chest's double box), with the scenes around them:
 *   the hat's camera pan, the rockfall cleared behind a fade and a move to 2590,8613, the golem
 *   moving aside behind a fade.
 * - The cavern (stages 9-11): disembarking there starts Mortimer's greeting, and the trolls are
 *   the quest's own three (16330-16332). Live puts the player in a private copy of the cavern
 *   for this; ours spawns the cutscene Mortimer (16294) and the trolls for the player alone.
 * - The basement stairs, with the key, unlock the hatch and put the player in the real cathedral
 *   (2540,2214); the broken pew asks "Climb over the pew?" and leads to the Mad Angel's private
 *   cathedral (the MadAngel plugin), where the quest's angel wakes by itself.
 * - The front door's lock is the 5-pin 811 puzzle, its combination new each time it is opened
 *   (Wiki: "The combination to the lock changes each attempt"; P2 sessions solve to 2306 and
 *   7152). Once picked, the door opens as it does for everyone (MadAngel).
 * - Keenan's body hands over Elessia's letter; reading it (the long scroll) is stage 19.
 *
 * Gaps/approximations ("Ours"):
 * - The large hat and worn journal are registered per player as private ground items while the
 *   quest is in progress; the pre-start "Someone's left their hat here" flavour is not shown.
 * - The monolith's Inspect is folded into its only cache option, Mine; the first Mine after
 *   Muriel plays the inspect transcript and hands over the notebook.
 * - The scrawled notebook, golem primer, warning note and observations still print a one-line
 *   summary: only the notebook's first spread is captured.
 * - The hat's camera pan leaves out cam_rotateto (pitch 2, yaw 240), which our packets lack.
 */
module.exports = function registerFallenFromGraceQuest(api) {
  const { CountdownTask, Item, ItemIdentifiers, Location, NpcIdentifiers, ObjectIdentifiers, Skill, TaskManager } =
    api.core;
  const { registerQuest, refreshQuestList, startTranscript, openLongScroll } = require("../QuestRuntime");
  const { createQuestLockpicking } = require("../QuestLockpicking");
  const { createDirectionalLock } = require("../QuestPuzzleLocks");
  const mining = require("../../skills/Mining.plugin.js");
  const { Sailing } = require("../../../src/main/typescript/elvarg/game/content/sailing/Sailing");
  const { BoatManager } = require("../../../src/main/typescript/elvarg/game/content/sailing/BoatManager");
  const ObstacleRunner = require("../../skills/agility/ObstacleRunner.Agility");
  const WyrmscraigAgility = require("../../skills/agility/shortcuts/Wyrmscraig.Agility");
  const MadAngelInstance = require("../../bosses/madangel/Instance.MadAngel");

  const STAGE_VERSION_ATTRIBUTE = "fallen-from-grace:stage-version";
  const STAGE_VERSION = 2;
  const PAGE = "Fallen From Grace";
  const START_HOOK = "quest:fallen-from-grace:start";

  const SAILING_REQUIREMENT = 62;
  const CRAFTING_REQUIREMENT = 60;
  const RUNECRAFT_REQUIREMENT = 47;
  const MINING_REQUIREMENT = 53;
  const REQUIREMENTS_MESSAGE =
    "You need 62 Sailing, 60 Crafting, 47 Runecraft, 53 Mining and Pandemonium to start this quest.";

  const VARP_FALLEN_FROM_GRACE = 5715; // "ffg_primary"
  const VARBIT_STAGE = 15759; // "ffg", bits 0-6
  const WYRMS_BANK_CHEST_VARBIT = 15774; // "amenity_bankchest_wyrmscraig"
  // Live values (FallenFromGraceP1/P2 captures) and Quest Helper's loadSteps.
  const STAGE_STARTED = 2;
  const STAGE_MURIEL = 3;
  const STAGE_TRAIL = 4;
  const STAGE_NOTEBOOK = 5;
  const STAGE_SUNSTONE = 5;
  const STAGE_HAT = 6;
  const STAGE_MURIEL_HAT = 6;
  const STAGE_CORMAC_PLAN = 8;
  const STAGE_CORMAC_BYPASS = 8;
  const STAGE_CAVERN = 9;
  const STAGE_TROLLS = 11; // Mortimer asked for the trolls; their deaths are FLAG_TROLLS_KILLED
  const STAGE_GOLEM = 13;
  const STAGE_CORE = 14;
  const STAGE_GOLEM_POWERED = 15;
  const STAGE_CATHEDRAL = 16;
  const STAGE_ANGEL_DEAD = 18;
  const STAGE_BODY = 19;
  const STAGE_COMPLETE = 20;

  // Sibling flag varbits of varp 5715 (sent as CS2 quest state).
  const FLAGS_ATTRIBUTE = "quest.fallen_from_grace.flags";
  const FLAG_MET_CORMAC = 1 << 0; // 15760
  const FLAG_WARNING_NOTE = 1 << 1; // 15761
  const FLAG_KEENANS_BOOK = 1 << 2; // 15762
  const FLAG_CATHEDRAL_BOOK = 1 << 3; // 15763
  const FLAG_CORMAC_BYPASS = 1 << 4; // 15764
  const FLAG_CHEST_UNLOCKED = 1 << 5; // 15765
  const FLAG_KEY_USED = 1 << 6; // 15766
  const FLAG_CATHEDRAL_OPENED = 1 << 7; // 15767
  const FLAG_NOTE_FOUND = 1 << 8; // 15768
  const FLAG_TROLLS_KILLED = 1 << 9; // 15769
  const FLAG_MURIEL_HAT = 1 << 10; // 15770
  const FLAG_WYRMS_ENTRY = 1 << 11; // 15771
  const FLAG_MORTIMER_INTRO = 1 << 12; // 15772
  const FLAG_FOUND_BODY = 1 << 13; // 15773
  const FLAG_VARBITS = [
    [FLAG_MET_CORMAC, 15760],
    [FLAG_WARNING_NOTE, 15761],
    [FLAG_KEENANS_BOOK, 15762],
    [FLAG_CATHEDRAL_BOOK, 15763],
    [FLAG_CORMAC_BYPASS, 15764],
    [FLAG_CHEST_UNLOCKED, 15765],
    [FLAG_KEY_USED, 15766],
    [FLAG_CATHEDRAL_OPENED, 15767],
    [FLAG_NOTE_FOUND, 15768],
    [FLAG_TROLLS_KILLED, 15769],
    [FLAG_MURIEL_HAT, 15770],
    [FLAG_WYRMS_ENTRY, 15771],
    [FLAG_MORTIMER_INTRO, 15772],
    [FLAG_FOUND_BODY, 15773],
  ];

  const TROLL_KILLS_ATTRIBUTE = "quest.fallen_from_grace.troll-kills";
  const TROLLS_TO_KILL = 3;
  // The cavern's quest NPCs as live adds them on arrival (P2 tick 42): the cutscene Mortimer behind
  // the rockfall facing west, and the three trolls facing south.
  const MORTIMER_CUTSCENE_SPAWN = { id: NpcIdentifiers.MORTIMER_2, x: 2601, y: 8608, face: 3 }; // 16294
  const TROLL_SPAWNS = [
    { id: NpcIdentifiers.MOUNTAIN_TROLL_9, x: 2593, y: 8604, face: 6 }, // ffg_troll_1, 16330
    { id: NpcIdentifiers.MOUNTAIN_TROLL_10, x: 2591, y: 8610, face: 6 }, // ffg_troll_2, 16331
    { id: NpcIdentifiers.MOUNTAIN_TROLL_11, x: 2588, y: 8609, face: 6 }, // ffg_troll_3, 16332
  ];
  const TROLL_WANDER_RADIUS = 2; // Ours: not captured
  const TROLLS_KILLED_MESSAGE = "You notice the skeleton calling you over.";
  const TROLLS_KILLED_SHOUT = "Hey! Come give me a hand over here.";
  // Rocks cleared (P2 ticks 162-172): the pick-up animation and the fade, the box held 5 ticks,
  // then the player is at 2590,8613 beside the real Mortimer.
  const ROCKS_CLEARED_TILE = new Location(2590, 8613, 0);
  const ROCKS_CLEARED_ANIMATION = 827;
  const ROCKS_CLEARED_FADE = { moveTicks: 5, inTicks: 5, closeTicks: 10 };

  const CORMAC_NPC_ID = NpcIdentifiers.CORMAC; // 16318
  const MURIEL_NPC_ID = NpcIdentifiers.MURIEL; // 16319
  const MORTIMER_NPC_IDS = new Set([
    NpcIdentifiers.MORTIMER, // 16175
    NpcIdentifiers.MORTIMER_2, // 16294
  ]);
  const BROKEN_GOLEM_NPC_ID = NpcIdentifiers.BROKEN_GOLEM; // 16321
  // The quest's own trolls (ffg_troll_1-3); the cavern's generic mountain trolls don't count.
  const TROLL_NPC_IDS = new Set([
    NpcIdentifiers.MOUNTAIN_TROLL_9, // 16330
    NpcIdentifiers.MOUNTAIN_TROLL_10, // 16331
    NpcIdentifiers.MOUNTAIN_TROLL_11, // 16332
  ]);

  const SUNSTONE_ITEM_ID = ItemIdentifiers.SUNSTONE; // 34020
  const SUNSTONE_CORE_ITEM_ID = ItemIdentifiers.SUNSTONE_CORE; // 34022
  const SUNSTONE_CRYSTAL_ITEM_ID = ItemIdentifiers.SUNSTONE_CRYSTAL; // 34032
  const LARGE_HAT_ITEM_ID = ItemIdentifiers.LARGE_HAT; // 34044
  const WORN_JOURNAL_ITEM_ID = ItemIdentifiers.WORN_JOURNAL; // 34045
  const SCRAWLED_NOTEBOOK_ITEM_ID = ItemIdentifiers.SCRAWLED_NOTEBOOK; // 34046
  const OBSERVATIONS_ITEM_ID = ItemIdentifiers.OBSERVATIONS; // 34051
  const WARNING_NOTE_ITEM_ID = ItemIdentifiers.WARNING_NOTE_2; // 34052
  const GOLEM_PRIMER_ITEM_ID = ItemIdentifiers.GOLEM_PRIMER; // 34053
  const ANCIENT_SUNSTONE_CORE_ITEM_ID = ItemIdentifiers.ANCIENT_SUNSTONE_CORE; // 34054
  const STAIRCASE_KEY_ITEM_ID = ItemIdentifiers.STAIRCASE_KEY; // 34055
  const DULL_SUNSTONE_CORE_ITEM_ID = ItemIdentifiers.DULL_SUNSTONE_CORE; // 34056
  const FINAL_LETTER_ITEM_ID = ItemIdentifiers.FINAL_LETTER; // 34057
  const CHISEL_ITEM_ID = ItemIdentifiers.CHISEL; // 1755
  const HAMMER_ITEM_ID = ItemIdentifiers.HAMMER; // 2347
  const BRONZE_PICKAXE_ITEM_ID = ItemIdentifiers.BRONZE_PICKAXE; // 1265
  const TENT_TOOL_ITEM_IDS = [BRONZE_PICKAXE_ITEM_ID, HAMMER_ITEM_ID, CHISEL_ITEM_ID];

  const MONOLITH_OBJECT_ID = ObjectIdentifiers.SUNSTONE_MONOLITH; // 62216
  const NOTEBOOK_ROCKS_OBJECT_ID = ObjectIdentifiers.ROCKS_195; // 62371
  const TENT_OBJECT_ID = ObjectIdentifiers.TENT_26; // 62270
  const CHEST_OBJECT_ID = ObjectIdentifiers.CHEST_317; // 62376
  const BOOKCASE_OBJECT_ID = ObjectIdentifiers.BOOKCASE_203; // 62378
  const BASEMENT_STAIRS_OBJECT_ID = ObjectIdentifiers.STAIRCASE_273; // 62255 Climb-up
  const CATHEDRAL_STAIRS_OBJECT_ID = ObjectIdentifiers.STAIRCASE_272; // 62254 Climb-down
  const CAVE_ENTRANCE_SAILABLE_OBJECT_ID = 62217; // wyrmscraig_cave_entrance_sailable, Sail
  const SHORTCUT_BLOCKAGE_OBJECT_ID = 62263; // wyrmscraig_cliff_shortcut_blockage -> Rocks/Mine
  const SHORTCUT_BLOCKED_ROCKS_OBJECT_ID = 62264;
  const SHORTCUT_TOP_OBJECT_IDS = new Set([62265, 62266, 62267]); // climbed rocks at the top
  const SHORTCUT_VARBIT = 15720; // wyrmscraig_cliff_shortcut: 0 blockage, 1 climbable
  const SHORTCUT_CLEARED_ATTRIBUTE = "fallen-from-grace:shortcut-cleared";
  const SHORTCUT_ENDS = [[2554, 2209, 0], [2550, 2209, 0]];
  // Captured P2 tick 29: the skiff crosses the south-west cave mouth without an object click.
  // The cache pool at 2562,2203 is the portal face, and a real east-facing skiff hull stops at
  // x2539 on the y2188 approach (open water ends at x2543); the recorded boat root then
  // reappears at 2577.5,8606.5 (the cavern mooring).
  // Keep this a narrow quest gate, not a proximity radius: the boat must actually reach the
  // legal open-sea edge of the captured approach line.
  // The boat's centre passes this box on the captured crossing (rsprox P2, the "You sail through the
  // cave opening." portal at 2559,2203; the boat moved 2554,2200 -> 2559,2203 before it).
  const CAVERN_APPROACH = { minX: 2555, maxX: 2561, minY: 2200, maxY: 2205, z: 0 };
  const CAVERN_MOORING = { fineX: 329920, fineY: 1101632, z: 0, angle: 1408 }; // 2577.5,8606.5
  const CAVE_BOAT_TYPES = new Set(["raft", "skiff"]);
  // The cave opening's portal effect (gotr_overlay, its script, the sound), as captured.
  const OVERLAY_ATMOSPHERE = (161 << 16) | 1;
  const GOTR_OVERLAY = 745;
  const SCRIPT_GOTR_PORTAL = 5984;
  const SCRIPT_GOTR_REMOVE = 5985;
  const GOTR_MODEL_NONE = -1;
  const CAVE_OPENING_COLOUR = 1052688;
  const CAVE_OPENING_SOUND = 10747;
  const CAVE_OPENING_CLOSE_TICKS = 5;
  const CATHEDRAL_DOOR_OBJECT_IDS = new Set([62368, 62369]);
  // The door's question (P2 tick 473) and its success box (tick 622).
  const DOOR_QUESTION = "You attempt to open the doors, but they appear to be locked.";
  const DOOR_PICK = "Try to pick the lock.";
  const DOOR_LEAVE = "Leave them.";
  const DOOR_PICKED = "You successfully pick the lock, only to see it crumble away in your hands.";
  const DOOR_LOCK_CODES = 6 ** 5; // five pins, six positions each
  // P2: the first session ends with its 7th wrong guess (tick 566); the Wiki's fail line is shown
  // (the recording closes it silently). The question, each wrong guess and the success play 2402/2402/2419.
  const DOOR_LOCK_ATTEMPTS = 7;
  const DOOR_FAILED = "Your fingers go numb from fiddling with the lock. You'll need to try again.";
  const DOOR_SOUND = 2402;
  const DOOR_PICKED_SOUND = 2419;
  const CATHEDRAL_DOOR_OUTSIDE_X = 2542; // the door tiles are x 2541 (inside) and 2542 (outside)
  // The basement stairs with the key (P2 ticks 288-295): the message, the hatch's sound, the fade
  // and the move into the cathedral 2 ticks after it starts.
  const HATCH_MESSAGE = "You unlock a hatch at the top of the staircase and climb up into the cathedral.";
  const HATCH_SOUND = 2419;
  const CATHEDRAL_TILE = new Location(2540, 2214, 0);
  const STAIRS_FADE = { moveTicks: 2, inTicks: 3, closeTicks: 5 };
  // The golem moving aside (P2 ticks 247-252): the fade, the move at +2, the box held 3 ticks.
  const GOLEM_FADE = { moveTicks: 2, inTicks: 3, closeTicks: 5 };
  // Item boxes and their sounds, as captured.
  const FIND_SOUND = 2582; // the notebook (P1 tick 156) and the dull core (P2 tick 235)
  const GOLEM_INSPECT_ANIMATION = 14473; // tol_player_rummage01_walkmerge
  const CHEST_OPEN_ANIMATION = 536;
  const CHEST_OPEN_SOUND = 2419;
  const CORE_BREAK_SOUNDS = [2381, 2119];
  // Mining the monolith (P1 ticks 168-181) and chiselling the sunstone (tick 186).
  const MONOLITH_SWING_MESSAGE = "You swing your pick at the monolith.";
  const MONOLITH_MINED_MESSAGE = "You manage to mine some sunstone.";
  const MONOLITH_FULL_MESSAGE = "Your inventory is too full to hold any more sunstone.";
  const MONOLITH_MINE_TICKS = 11; // the one captured swing to sunstone; Ours: no success roll
  const MONOLITH_MINED_SOUND = 3600;
  const MONOLITH_FULL_SOUND = 2277;
  const CHISEL_ANIMATION = 7202;
  const CHISEL_SOUND = 1553;
  // The hat (P1 ticks 247-274): a think emote and a camera pan from the hat to the cathedral,
  // the box held without its continue for 23 ticks.
  const HAT_THINK_ANIMATION = 857;
  const HAT_HOLD_TICKS = 23;
  const HAT_CAMERA_SCRIPT = 7917;
  // Elessia's final letter, read on the long scroll (P2 tick 449).
  const FINAL_LETTER_TEXT = [
    "After all these years, I thought I had maybe finally mastered this illness. This hunger.",
    "",
    "I was a fool. I have been a fool for so long now, and enough is finally enough. To the people of this island: know that you will be plagued no longer by my madness. The death of this boy will be the last. In my place, I leave this golem. Be careful around it, for it is unrefined and temperamental. A pyrophoroi I am not. However, in time, and with some work, I hope you will be able to use it. Let it defend you in a way I never could.",
    "",
    "No words will ever make up for what I have done, but know that I will spend the rest of may days trying to earn forgiveness. May Saradomin guide you all.",
    "",
    "Dame Elessia",
  ];
  const CREVICE_OBJECT_ID = ObjectIdentifiers.CREVICE_57; // 62257 Squeeze-through
  // ffg_corpse_keenan (no identifier: the raw multi-loc is named "null" and resolves to
  // BODY_3 62375); interactions carry the raw id.
  const CATHEDRAL_CORPSE_OBJECT_ID = 62374;

  // The cathedral door uses the captured 5-pin 811 lockpicking UI; the chest uses
  // the shared captured directional 810 lock, [1,3,2,2] (R,L,D,D).

  // The hat and basement items are the quest's own floor items. The default ground despawn (300
  // ticks) removed the hat while the player stayed in the zone, and it is only re-created on login
  // or zone entry, so it stayed missing until a relog. Capture: ffg_keenans_hat at 2556,2198 is
  // taken from 2556,2197 (rsprox P1, opobj3_v2 at that tile).
  const QUEST_FLOOR_DESPAWN_TICKS = 6000; // one hour, re-created on login or zone entry
  const HAT_TILE = new Location(2556, 2198, 0); // wiki map pin, south-west tip
  const JOURNAL_TILE = new Location(2568, 8660, 0); // table beside the basement chest
  const WARNING_NOTE_TILE = new Location(2575, 8657, 0); // floor by the stairs
  const BASEMENT_TILE = new Location(2575, 8657, 0); // landing of the cathedral stairs
  const CREVICE_X = 2573;
  const CREVICE_WALL_Y = 8654;
  const CREVICE_NORTH_Y = 8652;
  const CREVICE_SOUTH_Y = 8656;
  // Captured P2 line 7918: after the core powers the golem the player moves from the
  // north front (2573,8649) to the south side of the wall at (2573,8655).
  const GOLEM_PASSAGE_TILE = new Location(2573, 8655, 0);

  const SURFACE_ZONE = { minX: 2510, maxX: 2625, minY: 2150, maxY: 2310 };
  const CAVERN_ZONE = { minX: 2540, maxX: 2625, minY: 8580, maxY: 8645 };

  // Condition step ids on the "Fallen From Grace" page.
  const MONOLITH_FULL_CONDITION_ID = "v6wvpH";
  const GOLEM_FULL_CONDITION_ID = "4gomiy";
  const GOLEM_SPACE_CONDITION_ID = "Y9SeJ2";
  const STAIRS_FULL_CONDITION_ID = "qltrcX";
  const CHEST_FULL_CONDITION_ID = "XyokqA";
  const CHEST_AGAIN_FULL_CONDITION_ID = "fb4isj";
  const CHEST_AGAIN_ONE_SLOT_CONDITION_ID = "FLYqjv";
  const CHEST_AGAIN_CORE_CONDITION_ID = "V_7MqO";
  const CHEST_AGAIN_PRIMER_CONDITION_ID = "lsOhfH";
  const CHEST_AGAIN_BOTH_CONDITION_ID = "DmlSMI";
  const BODY_FULL_CONDITION_ID = "IByR0Y";
  const LOCK_SUCCESS_CONDITION_ID = "lXV1xY";
  const LOCK_FAIL_CONDITION_ID = "AHhU1K";
  const CORMAC_CRYSTAL_CONDITION_ID = "M0RI1R";
  const CORMAC_CRYSTAL_ROOM_CONDITION_ID = "Vp65PU";
  const CORMAC_CRYSTAL_FULL_CONDITION_ID = "OqO4kD";
  const OUR_CONDITION_IDS = new Set([
    MONOLITH_FULL_CONDITION_ID,
    GOLEM_FULL_CONDITION_ID,
    GOLEM_SPACE_CONDITION_ID,
    STAIRS_FULL_CONDITION_ID,
    CHEST_FULL_CONDITION_ID,
    CHEST_AGAIN_FULL_CONDITION_ID,
    CHEST_AGAIN_ONE_SLOT_CONDITION_ID,
    CHEST_AGAIN_CORE_CONDITION_ID,
    CHEST_AGAIN_PRIMER_CONDITION_ID,
    CHEST_AGAIN_BOTH_CONDITION_ID,
    BODY_FULL_CONDITION_ID,
    LOCK_SUCCESS_CONDITION_ID,
    LOCK_FAIL_CONDITION_ID,
    CORMAC_CRYSTAL_CONDITION_ID,
    CORMAC_CRYSTAL_ROOM_CONDITION_ID,
    CORMAC_CRYSTAL_FULL_CONDITION_ID,
  ]);

  // Action/message step ids.
  const MONOLITH_TAKE_MESSAGE_ID = "3Vr-5r";
  const HAT_MESSAGE_ID = "-Z42qk";
  const GOLEM_INSPECT_MESSAGE_ID = "Xt_i1J";
  const GOLEM_CORE_MESSAGE_ID = "tVIYxb";
  const GOLEM_POWERED_MESSAGE_ID = "RaMntH";
  const CHEST_FOUND_BOTH_MESSAGE_ID = "F1HVbQ";
  const CHEST_FOUND_CORE_ONLY_MESSAGE_ID = "-XoYUm";
  const CHEST_FOUND_BOOK_MESSAGE_ID = "R8mrvW";
  const CHEST_FOUND_CORE_MESSAGE_ID = "YK7fFz";
  const CORE_BROKEN_MESSAGE_ID = "_I7d-k";
  const ROCKS_CLEARED_MESSAGE_ID = "cTymol";
  const BODY_FOUND_MESSAGE_ID = "r_JYqP";
  const CORMAC_CRYSTAL_MESSAGE_ID = "IjKWK4";
  const QUEST_COMPLETE_ACTION_ID = "gYcOjH";

  const READ_MESSAGES = new Map([
    [SCRAWLED_NOTEBOOK_ITEM_ID, "An almost scientific observation on sunstone: Keenan felt the monolith was watching him."],
    [GOLEM_PRIMER_ITEM_ID, "A dusty primer on crafting golems out of sunstone."],
    [WARNING_NOTE_ITEM_ID, "Elessia had herself imprisoned in the cathedral. A substitution cipher is scrawled on the back."],
    [OBSERVATIONS_ITEM_ID, "A delicate book on Elessia, the Mad Angel who once led the first settlers here."],
  ]);

  let quest;

  // ==========================================================================
  // State helpers
  // ==========================================================================

  function flags(player) {
    return Number(player.getAttribute(FLAGS_ATTRIBUTE)) || 0;
  }

  function hasFlag(player, flag) {
    return (flags(player) & flag) !== 0;
  }

  function setFlag(player, flag) {
    if (hasFlag(player, flag)) return;
    player.setAttribute(FLAGS_ATTRIBUTE, flags(player) | flag);
    const entry = FLAG_VARBITS.find(([bit]) => bit === flag);
    if (entry) player.getPacketSender().sendVarbit(entry[1], 1);
  }

  function sendFlagVarps({ player }) {
    syncShortcutVarbit(player);
    const sender = player.getPacketSender();
    const value = flags(player);
    for (const [bit, varbitId] of FLAG_VARBITS) {
      sender.sendVarbit(varbitId, (value & bit) !== 0 ? 1 : 0);
    }
  }

  function held(player, itemId) {
    return player.getInventory().getAmount(itemId) > 0;
  }

  /** Carried, worn or banked (placeholders own nothing). */
  function ownsLetter(player) {
    return api.core.Bank?.owns ? api.core.Bank.owns(player, FINAL_LETTER_ITEM_ID) : held(player, FINAL_LETTER_ITEM_ID);
  }

  function freeSlots(player) {
    return player.getInventory().getFreeSlots();
  }

  function give(player, itemId) {
    if (freeSlots(player) <= 0) {
      player.sendMessage("You don't have enough inventory space.");
      return false;
    }
    player.getInventory().adds(itemId, 1);
    return true;
  }

  function questActive(player) {
    return quest.isStarted(player) && !quest.isComplete(player);
  }

  function inZone(location, zone) {
    return (
      location.getX() >= zone.minX &&
      location.getX() <= zone.maxX &&
      location.getY() >= zone.minY &&
      location.getY() <= zone.maxY
    );
  }

  function ensurePrivateItem(player, itemId, tile) {
    const manager = api.getItemOnGroundManager();
    if (manager.getGroundItem(player.getUsername(), itemId, tile, player.getPrivateArea())) return;
    if (manager.getGroundItem(null, itemId, tile, null)) return;
    manager.registerLocation(player, new Item(itemId, 1), tile, player.getPrivateArea(), {
      despawnDelay: QUEST_FLOOR_DESPAWN_TICKS,
    });
  }

  function ensureHat(player) {
    if (!questActive(player)) return;
    ensurePrivateItem(player, LARGE_HAT_ITEM_ID, HAT_TILE);
  }

  function ensureBasementItems(player) {
    if (!questActive(player) || quest.getStage(player) < STAGE_GOLEM_POWERED) return;
    ensurePrivateItem(player, WORN_JOURNAL_ITEM_ID, JOURNAL_TILE);
    ensurePrivateItem(player, WARNING_NOTE_ITEM_ID, WARNING_NOTE_TILE);
  }

  function speak(player, npcId, variant) {
    startTranscript(api, player, npcId, PAGE, variant);
  }

  /** As `speak`, with the NPC in the world that says it (for its facing and overhead lines). */
  function speakWith(player, npc, npcId, variant) {
    startTranscript(api, player, npcId, PAGE, variant, undefined, npc);
  }

  // ==========================================================================
  // Dialogue selection
  // ==========================================================================

  function cormacVariant(player, stage) {
    if (quest.isComplete(player)) return { page: "Cormac" };
    if (stage === 0) {
      if (hasFlag(player, FLAG_MET_CORMAC)) {
        return "starting-the-quest-talking-to-cormac-a-second-time-before-starting-the-quest";
      }
      setFlag(player, FLAG_MET_CORMAC);
      return "starting-the-quest-talking-to-cormac";
    }
    if (stage <= STAGE_MURIEL) return "starting-the-quest-talking-to-cormac-after-starting-the-quest";
    if (stage <= STAGE_TRAIL) return "following-the-trail-talking-to-cormac-after-muriel";
    if (stage <= STAGE_NOTEBOOK) return "following-the-trail-talking-to-cormac-after-finding-the-notebook";
    // The hat leads Cormac to explain the Mad Angel; stage 8 comes after his last line (handleLine).
    if (stage <= STAGE_MURIEL_HAT) return "the-way-under-ardeaglais-talking-to-cormac";
    if (stage <= STAGE_CORMAC_BYPASS) {
      if (stage === STAGE_CORMAC_PLAN) {
        setFlag(player, FLAG_CORMAC_BYPASS);
        quest.setStage(player, STAGE_CORMAC_BYPASS);
      }
      return "the-way-under-ardeaglais-talking-to-cormac-again-before-going-to-the-cavern";
    }
    if (stage <= STAGE_TROLLS) return "the-way-under-ardeaglais-talking-to-cormac-after-meeting-mortimer";
    if (stage <= STAGE_GOLEM_POWERED) {
      return "the-way-under-ardeaglais-talking-to-cormac-after-investigating-the-broken-golem";
    }
    if (stage <= STAGE_ANGEL_DEAD) {
      return "entering-ardeaglais-talking-to-cormac-after-entering-the-basement";
    }
    return "entering-ardeaglais-talking-to-cormac-and-finishing-the-quest";
  }

  function murielVariant(player, stage) {
    if (quest.isComplete(player)) {
      return { page: "Muriel", variant: "after-completion-of-fallen-from-grace" };
    }
    if (stage === 0) return { page: "Muriel", variant: "before-starting-fallen-from-grace" };
    // Stage 4 comes with her "Thank you..." (handleLine).
    if (stage <= STAGE_MURIEL) return "following-the-trail-talking-to-muriel";
    if (stage <= STAGE_TRAIL) return "following-the-trail-talking-to-muriel-again";
    if (stage <= STAGE_NOTEBOOK) return "following-the-trail-talking-to-muriel-after-finding-the-notebook";
    if (!hasFlag(player, FLAG_MURIEL_HAT)) {
      setFlag(player, FLAG_MURIEL_HAT);
      if (stage === STAGE_HAT) quest.setStage(player, STAGE_MURIEL_HAT);
      return "following-the-trail-talking-to-muriel-after-finding-the-large-hat";
    }
    if (stage <= STAGE_CORMAC_BYPASS) {
      return "following-the-trail-talking-to-muriel-again-after-finding-the-large-hat";
    }
    return "the-way-under-ardeaglais-talking-to-muriel-after-cormac";
  }

  function mortimerVariant(player, stage) {
    // Stage 11 comes with his "It was those three nearby trolls..." (handleLine).
    if (stage === STAGE_CAVERN) return "the-way-under-ardeaglais-meeting-mortimer";
    if (stage === STAGE_TROLLS) {
      return hasFlag(player, FLAG_TROLLS_KILLED)
        ? "the-way-under-ardeaglais-talking-to-mortimer-after-killing-the-trolls"
        : "the-way-under-ardeaglais-talking-to-mortimer-before-killing-the-trolls";
    }
    return { page: "Mortimer", variant: "standard-dialogue" };
  }

  // ==========================================================================
  // Lines that move the quest on, as live does (the stage goes with the line shown)
  // ==========================================================================

  function lineIs(event, npcId, text) {
    if (event.npcId !== npcId && !(npcId === MORTIMER_CUTSCENE_SPAWN.id && MORTIMER_NPC_IDS.has(event.npcId))) return false;
    if (!(event.pages ?? []).some((entry) => entry?.page === PAGE)) return false;
    const said = typeof event.step?.player === "string" ? event.step.player : event.step?.text;
    return typeof said === "string" && said.startsWith(text);
  }

  function beforeLine(event, action) {
    const previous = event.before;
    event.before = () => {
      previous?.();
      action();
    };
  }

  function handleLine(event) {
    const { player } = event;
    if (!player) return;
    const stage = quest.getStage(player);
    if (stage === STAGE_STARTED && lineIs(event, CORMAC_NPC_ID, "I'll head over there right away.")) {
      beforeLine(event, () => quest.getStage(player) === STAGE_STARTED && quest.setStage(player, STAGE_MURIEL));
    } else if (stage >= STAGE_STARTED && stage <= STAGE_MURIEL && lineIs(event, MURIEL_NPC_ID, "Thank you...")) {
      beforeLine(event, () => quest.getStage(player) <= STAGE_MURIEL && quest.setStage(player, STAGE_TRAIL));
    } else if (stage === STAGE_MURIEL_HAT && lineIs(event, CORMAC_NPC_ID, "Wonderful. I'll be sure to take care then.")) {
      // P1 tick 358: stage 8 as the menu after this line opens.
      const previous = event.after;
      event.after = () => {
        previous?.();
        if (quest.getStage(player) === STAGE_MURIEL_HAT) quest.setStage(player, STAGE_CORMAC_PLAN);
      };
    } else if (stage === STAGE_CAVERN && lineIs(event, MORTIMER_CUTSCENE_SPAWN.id, "It was those three nearby trolls")) {
      beforeLine(event, () => {
        if (quest.getStage(player) !== STAGE_CAVERN) return;
        quest.setStage(player, STAGE_TROLLS);
        if ((Number(player.getAttribute(TROLL_KILLS_ATTRIBUTE)) || 0) >= TROLLS_TO_KILL) trollsDone(player);
      });
    } else if (lineIs(event, MORTIMER_CUTSCENE_SPAWN.id, "Hmm... a noble cause.")) {
      beforeLine(event, () => setFlag(player, FLAG_MORTIMER_INTRO));
    }
  }

  function selectVariant({ npcId, player }) {
    const stage = quest.getStage(player);
    if (npcId === CORMAC_NPC_ID) return cormacVariant(player, stage);
    if (npcId === MURIEL_NPC_ID) return murielVariant(player, stage);
    if (MORTIMER_NPC_IDS.has(npcId)) return mortimerVariant(player, stage);
    return null;
  }

  // ==========================================================================
  // Prose conditions
  // ==========================================================================

  function chestItemState(player) {
    const core = held(player, ANCIENT_SUNSTONE_CORE_ITEM_ID) || held(player, STAIRCASE_KEY_ITEM_ID);
    const primer = held(player, GOLEM_PRIMER_ITEM_ID);
    return { core, primer };
  }

  function answerCondition({ player, stepId }) {
    if (!OUR_CONDITION_IDS.has(stepId)) return null;
    switch (stepId) {
      case MONOLITH_FULL_CONDITION_ID:
      case GOLEM_FULL_CONDITION_ID:
      case STAIRS_FULL_CONDITION_ID:
      case CHEST_FULL_CONDITION_ID:
      case CHEST_AGAIN_FULL_CONDITION_ID:
      case BODY_FULL_CONDITION_ID:
        return player.getInventory().isFull();
      case GOLEM_SPACE_CONDITION_ID:
        return !player.getInventory().isFull();
      case CHEST_AGAIN_ONE_SLOT_CONDITION_ID: {
        const { core, primer } = chestItemState(player);
        return freeSlots(player) === 1 && !core && !primer;
      }
      case CHEST_AGAIN_CORE_CONDITION_ID: {
        const { core, primer } = chestItemState(player);
        return core && !primer;
      }
      case CHEST_AGAIN_PRIMER_CONDITION_ID: {
        const { core, primer } = chestItemState(player);
        return primer && !core;
      }
      case CHEST_AGAIN_BOTH_CONDITION_ID: {
        const { core, primer } = chestItemState(player);
        return core && primer;
      }
      case LOCK_SUCCESS_CONDITION_ID:
        return true;
      case LOCK_FAIL_CONDITION_ID:
        return false;
      case CORMAC_CRYSTAL_CONDITION_ID:
        return (
          held(player, SUNSTONE_CRYSTAL_ITEM_ID) ||
          player.getPacketSender().getVarbit(WYRMS_BANK_CHEST_VARBIT) === 1
        );
      case CORMAC_CRYSTAL_ROOM_CONDITION_ID:
        return !held(player, SUNSTONE_CRYSTAL_ITEM_ID) && freeSlots(player) > 0;
      case CORMAC_CRYSTAL_FULL_CONDITION_ID:
        return !held(player, SUNSTONE_CRYSTAL_ITEM_ID) && freeSlots(player) <= 0;
      default:
        return null;
    }
  }

  // ==========================================================================
  // Dialogue events
  // ==========================================================================

  function isQuestComplete(player, key) {
    const request = { player, key };
    api.emitCustomEvent("quest:is-complete", request);
    return request.complete === true;
  }

  function meetsRequirements(player) {
    const skills = player.getSkillManager();
    return (
      skills.getMaxLevel(Skill.SAILING) >= SAILING_REQUIREMENT &&
      skills.getMaxLevel(Skill.CRAFTING) >= CRAFTING_REQUIREMENT &&
      skills.getMaxLevel(Skill.RUNECRAFTING) >= RUNECRAFT_REQUIREMENT &&
      skills.getMaxLevel(Skill.MINING) >= MINING_REQUIREMENT &&
      isQuestComplete(player, "pandemonium")
    );
  }

  function handleStartHook({ player, npcId, hook }) {
    if (npcId !== CORMAC_NPC_ID || hook !== START_HOOK) return;
    setFlag(player, FLAG_MET_CORMAC);
    if (!meetsRequirements(player)) {
      player.sendMessage(REQUIREMENTS_MESSAGE);
      return;
    }
    quest.setStage(player, STAGE_STARTED);
    ensureHat(player);
  }

  /** Branch side effects, keyed on the chosen condition step. */
  function handleDialogueCondition({ player, stepId }) {
    if (stepId !== GOLEM_SPACE_CONDITION_ID) return;
    if (quest.getStage(player) !== STAGE_GOLEM) return;
    if (!held(player, DULL_SUNSTONE_CORE_ITEM_ID) && !give(player, DULL_SUNSTONE_CORE_ITEM_ID)) return;
    quest.setStage(player, STAGE_CORE);
  }

  /**
   * How each of the page's message steps shows: live sends these as message boxes, or as item
   * boxes for what the player is handed (rsprox P1/P2). Steps not captured follow the same rule.
   */
  const ITEM_BOXES = new Map([
    [MONOLITH_TAKE_MESSAGE_ID, [SCRAWLED_NOTEBOOK_ITEM_ID]], // P1 tick 156
    [GOLEM_CORE_MESSAGE_ID, [DULL_SUNSTONE_CORE_ITEM_ID]], // P2 tick 235
    [CHEST_FOUND_BOTH_MESSAGE_ID, [GOLEM_PRIMER_ITEM_ID, ANCIENT_SUNSTONE_CORE_ITEM_ID]], // P2 tick 266
    [CORE_BROKEN_MESSAGE_ID, [STAIRCASE_KEY_ITEM_ID]], // P2 tick 282
    [BODY_FOUND_MESSAGE_ID, [FINAL_LETTER_ITEM_ID]], // P2 tick 434
    [CHEST_FOUND_CORE_ONLY_MESSAGE_ID, [ANCIENT_SUNSTONE_CORE_ITEM_ID]],
    [CHEST_FOUND_BOOK_MESSAGE_ID, [GOLEM_PRIMER_ITEM_ID]],
    [CHEST_FOUND_CORE_MESSAGE_ID, [ANCIENT_SUNSTONE_CORE_ITEM_ID]],
  ]);
  const STATEMENT_BOX_IDS = new Set([
    HAT_MESSAGE_ID, ROCKS_CLEARED_MESSAGE_ID, GOLEM_INSPECT_MESSAGE_ID, GOLEM_POWERED_MESSAGE_ID, // captured
    "QRj9vV", "8N1rQd", "cHwvUs", "IJq4d1", "UwU9Hg", "dEeYXC", "bmYCrG", "zdm8vH", "cdH5sl",
    "XW8zb-", "7MaB9w", "4ktLGT", "bBCyvL", "EhmqRf", "kZQcaM", "OrQnCO",
  ]);

  function boxFor(event) {
    const items = ITEM_BOXES.get(event.stepId);
    if (items) event.box = { ...(event.box ?? {}), items };
    else if (STATEMENT_BOX_IDS.has(event.stepId)) event.box = { ...(event.box ?? {}), statement: true };
  }

  function sound(player, id, delay = 0) {
    player.getPacketSender().sendSoundEffect(id, 1, delay);
  }

  // The quest's fades (P2 ticks 162-172, 247-252, 290-295): fade_overlay (174) with script 948
  // over 50 cycles, out then back in; busy and the minimap off while it is dark.
  const FADE_UID = (161 << 16) | 1;
  const FADE_OVERLAY = 174;
  const FADE_SCRIPT = 948;
  const FADE_CYCLES = 50;
  const BUSY_VARBIT = 12393;
  const MINIMAP_STATE_VARBIT = 6719;

  function fade(player, out) {
    player.getPacketSender().sendSubInterface(FADE_UID, FADE_OVERLAY, 1, {
      postScripts: [{ scriptId: FADE_SCRIPT, args: out ? [0, 255, 0, 0, FADE_CYCLES] : [0, 0, 0, 255, FADE_CYCLES] }],
    });
  }

  /** Fades out, runs `move` `moveTicks` later, fades back in at `inTicks` and closes at `closeTicks`. */
  function fadeTravel(player, { moveTicks, inTicks, closeTicks }, move) {
    const out = player.getPacketSender();
    const key = {};
    const here = () => player.isRegistered?.() !== false;
    out.sendVarbit(BUSY_VARBIT, 1);
    fade(player, true);
    later(key, 1, () => here() && out.sendVarbit(MINIMAP_STATE_VARBIT, 2));
    later(key, moveTicks, () => here() && move());
    later(key, inTicks, () => {
      if (!here()) return;
      out.sendVarbit(MINIMAP_STATE_VARBIT, 0);
      fade(player, false);
    });
    later(key, closeTicks, () => {
      if (!here()) return;
      out.sendVarbit(BUSY_VARBIT, 0);
      out.closeSubInterface(FADE_UID);
    });
  }

  /** Message/action side effects; the quest-complete action takes over the chatbox. */
  function handleDialogueAction(event) {
    const { player, stepId } = event;
    if (stepId === QUEST_COMPLETE_ACTION_ID) {
      if (quest.getStage(player) < STAGE_BODY) return;
      event.handled = true;
      event.end = true;
      quest.complete(player);
      return;
    }
    if (event.kind !== "message") return;
    if ((event.pages ?? []).some((entry) => entry?.page === PAGE)) boxFor(event);
    switch (stepId) {
      case MONOLITH_TAKE_MESSAGE_ID:
        if (quest.getStage(player) < STAGE_MURIEL || quest.getStage(player) > STAGE_TRAIL) return;
        if (player.getInventory().isFull()) return;
        if (give(player, SCRAWLED_NOTEBOOK_ITEM_ID)) {
          quest.setStage(player, STAGE_NOTEBOOK);
          sound(player, FIND_SOUND);
        }
        return;
      case HAT_MESSAGE_ID:
        hatScene(player, event);
        return;
      case GOLEM_INSPECT_MESSAGE_ID:
        player.performAnimation(new api.core.Animation(GOLEM_INSPECT_ANIMATION));
        return;
      case GOLEM_CORE_MESSAGE_ID:
        sound(player, FIND_SOUND);
        return;
      case GOLEM_POWERED_MESSAGE_ID:
        // The golem moves aside behind a fade and the player is through (P2 ticks 247-252).
        event.box = { ...event.box, holdTicks: GOLEM_FADE.inTicks };
        fadeTravel(player, GOLEM_FADE, () => player.moveTo(GOLEM_PASSAGE_TILE));
        return;
      case CHEST_FOUND_BOTH_MESSAGE_ID:
        give(player, ANCIENT_SUNSTONE_CORE_ITEM_ID);
        give(player, GOLEM_PRIMER_ITEM_ID);
        setFlag(player, FLAG_CHEST_UNLOCKED);
        return;
      case CHEST_FOUND_CORE_ONLY_MESSAGE_ID:
        give(player, ANCIENT_SUNSTONE_CORE_ITEM_ID);
        setFlag(player, FLAG_CHEST_UNLOCKED);
        return;
      case CHEST_FOUND_BOOK_MESSAGE_ID:
        give(player, GOLEM_PRIMER_ITEM_ID);
        setFlag(player, FLAG_CHEST_UNLOCKED);
        return;
      case CHEST_FOUND_CORE_MESSAGE_ID:
        give(player, ANCIENT_SUNSTONE_CORE_ITEM_ID);
        setFlag(player, FLAG_CHEST_UNLOCKED);
        return;
      case CORE_BROKEN_MESSAGE_ID:
        give(player, STAIRCASE_KEY_ITEM_ID);
        for (const id of CORE_BREAK_SOUNDS) sound(player, id);
        return;
      case ROCKS_CLEARED_MESSAGE_ID:
        clearRockfall(player, event);
        return;
      case BODY_FOUND_MESSAGE_ID:
        if (quest.getStage(player) !== STAGE_ANGEL_DEAD) return;
        if (!ownsLetter(player)) give(player, FINAL_LETTER_ITEM_ID);
        setFlag(player, FLAG_FOUND_BODY);
        sound(player, FIND_SOUND); // P2 tick 434
        return;
      case CORMAC_CRYSTAL_MESSAGE_ID:
        give(player, SUNSTONE_CRYSTAL_ITEM_ID);
        return;
      default:
    }
  }

  /**
   * The hat's scene (P1 ticks 247-274): the think emote and the camera moved over the hat, then
   * pulled up and back towards the cathedral while the box holds its continue for 23 ticks; the
   * camera comes back once the player continues.
   */
  function hatScene(player, event) {
    const out = player.getPacketSender();
    player.performAnimation(new api.core.Animation(HAT_THINK_ANIMATION));
    out.sendCameraUnlock(true);
    out.sendClientScript(HAT_CAMERA_SCRIPT);
    out.sendCameraMoveTo(2558, 2193, 250, { rate: 232, rate2: 100 });
    out.sendCameraLookAt(2556, 2198, 150, { rate: 232, rate2: 100 });
    later(player, 3, () => player.isRegistered?.() !== false
      && out.sendCameraMoveTo(2558, 2193, 1400, { cycles: 600, easing: "ease_out_sine", ignoreTerrain: true }));
    event.box = { ...event.box, holdTicks: HAT_HOLD_TICKS };
    const previous = event.after;
    event.after = () => {
      previous?.();
      out.sendClientScript(HAT_CAMERA_SCRIPT);
      out.sendCameraUnlock(false);
      out.sendCameraReset();
    };
  }

  /**
   * The rockfall (P2 ticks 162-172): the pick-up animation and the fade out with the box held, and
   * 5 ticks later the player is beside the real Mortimer at stage 13 as the fade comes back.
   */
  function clearRockfall(player, event) {
    if (quest.getStage(player) !== STAGE_TROLLS || !hasFlag(player, FLAG_TROLLS_KILLED)) return;
    player.performAnimation(new api.core.Animation(ROCKS_CLEARED_ANIMATION));
    event.box = { ...event.box, holdTicks: ROCKS_CLEARED_FADE.inTicks };
    fadeTravel(player, ROCKS_CLEARED_FADE, () => {
      if (quest.getStage(player) !== STAGE_TROLLS) return;
      quest.setStage(player, STAGE_GOLEM);
      removeCavernScene(player);
      player.moveTo(ROCKS_CLEARED_TILE);
    });
  }

  // ==========================================================================
  // Objects
  // ==========================================================================

  function handleMonolith(event) {
    const { player, objectId, clickType, definition } = event;
    if (objectId !== MONOLITH_OBJECT_ID && objectId !== NOTEBOOK_ROCKS_OBJECT_ID) return false;
    const option = String(definition?.getInteractions?.()?.[clickType - 1] ?? "");
    if (option !== "Mine" && option !== "Search") return false;
    const stage = quest.getStage(player);
    if (stage < STAGE_MURIEL || stage >= STAGE_GOLEM_POWERED) return false;
    event.handled = true;
    if (stage < STAGE_NOTEBOOK) {
      speak(player, CORMAC_NPC_ID, "following-the-trail-inspecting-the-sunstone-monolith");
      return true;
    }
    if (held(player, SUNSTONE_ITEM_ID) || held(player, SUNSTONE_CORE_ITEM_ID)) {
      player.sendMessage("You already have some sunstone.");
      return true;
    }
    const pickaxe = mining.findBestPickaxe(player);
    if (!pickaxe) {
      player.sendMessage("You need a pickaxe to mine the monolith.");
      return true;
    }
    if (player.getInventory().isFull()) {
      monolithFull(player);
      return true;
    }
    mineMonolith(player, pickaxe);
    return true;
  }

  const miningKeys = new WeakMap();

  function monolithFull(player) {
    sound(player, MONOLITH_FULL_SOUND);
    player.getDialogueManager().startDialogues(new api.core.DialogueChainBuilder()
      .add(new api.core.StatementDialogue(0, MONOLITH_FULL_MESSAGE)));
  }

  /**
   * As captured (P1 ticks 168-181): "You swing your pick at the monolith.", the pickaxe swung at
   * +0, +2, +5 and +8, and the sunstone 11 ticks in with sound 3600. A full pack then shows the
   * captured "too full" box. Moving away stops it.
   */
  function mineMonolith(player, pickaxe) {
    const key = {};
    miningKeys.set(player, key);
    const from = player.getLocation();
    const still = () => miningKeys.get(player) === key && player.isRegistered?.() !== false
      && player.getLocation().equals?.(from) !== false;
    player.sendMessage(MONOLITH_SWING_MESSAGE);
    player.performAnimation(pickaxe.animation);
    for (const tick of [2, 5, 8]) later(key, tick, () => still() && player.performAnimation(pickaxe.animation));
    later(key, MONOLITH_MINE_TICKS, () => {
      if (!still()) return;
      miningKeys.delete(player);
      player.performAnimation(pickaxe.animation);
      if (!give(player, SUNSTONE_ITEM_ID)) return;
      player.sendMessage(MONOLITH_MINED_MESSAGE);
      sound(player, MONOLITH_MINED_SOUND);
      if (player.getInventory().isFull()) later(key, 1, () => player.isRegistered?.() !== false && monolithFull(player));
    });
  }

  function handleTent(event) {
    const { player, objectId } = event;
    if (objectId !== TENT_OBJECT_ID) return false;
    event.handled = true;
    const missing = TENT_TOOL_ITEM_IDS.filter((itemId) => !held(player, itemId));
    if (missing.length === 0) {
      player.sendMessage("You search the tent, but find nothing else of use.");
      return true;
    }
    let found = false;
    for (const itemId of missing) {
      if (freeSlots(player) <= 0) break;
      player.getInventory().adds(itemId, 1);
      found = true;
    }
    player.sendMessage(
      found
        ? "You search the tent and find some tools."
        : "You don't have enough inventory space."
    );
    return true;
  }

  /** The cathedral door's captured 811 lockpicking UI (five active pins). */
  function openDoorLock(player) {
    DoorLockpicking.open(player);
  }

  function unlockChest(player) {
    player.getPacketSender().sendInterfaceRemoval();
    if (!questActive(player) || quest.getStage(player) < STAGE_GOLEM_POWERED) return;
    if (hasFlag(player, FLAG_CHEST_UNLOCKED)) return;
    setFlag(player, FLAG_CHEST_UNLOCKED);
    // As captured (P2 tick 265): the chest opened with its sounds, then the find box.
    player.performAnimation(new api.core.Animation(CHEST_OPEN_ANIMATION, 10));
    sound(player, CHEST_OPEN_SOUND);
    sound(player, 52, 10);
    sound(player, 51, 45);
    speak(player, CORMAC_NPC_ID, "entering-ardeaglais-unlocking-the-chest");
  }

  function unlockCathedralDoor(player) {
    player.getPacketSender().sendInterfaceRemoval();
    if (!questActive(player) || quest.getStage(player) < STAGE_CATHEDRAL) return;
    if (hasFlag(player, FLAG_CATHEDRAL_OPENED)) return;
    setFlag(player, FLAG_CATHEDRAL_OPENED);
    sound(player, DOOR_PICKED_SOUND);
    player.getDialogueManager().startDialogues(new api.core.DialogueChainBuilder()
      .add(new api.core.StatementDialogue(0, DOOR_PICKED)));
  }

  const ChestLock = createDirectionalLock(api, {
    solution: [1, 3, 2, 2],
    onSolved: unlockChest,
  });

  // A new combination each time the lock is opened (P2: 2306, then 7152 solved at tick 621).
  const DoorLockpicking = createQuestLockpicking(api, {
    activePins: 5,
    target: () => Math.floor(Math.random() * DOOR_LOCK_CODES),
    onSolved: unlockCathedralDoor,
    maxAttempts: DOOR_LOCK_ATTEMPTS,
    failSound: DOOR_SOUND,
    onExhausted: (player) => player.getDialogueManager().startDialogues(new api.core.DialogueChainBuilder()
      .add(new api.core.StatementDialogue(0, DOOR_FAILED))),
  });

  function handleChest(event) {
    const { player, objectId } = event;
    if (objectId !== CHEST_OBJECT_ID) return false;
    if (!questActive(player) || quest.getStage(player) < STAGE_GOLEM_POWERED) return false;
    event.handled = true;
    if (hasFlag(player, FLAG_CHEST_UNLOCKED)) {
      speak(player, CORMAC_NPC_ID, "entering-ardeaglais-searching-the-chest-again");
      return true;
    }
    ChestLock.open(player);
    return true;
  }

  function handleBookcase(event) {
    const { player, objectId } = event;
    if (objectId !== BOOKCASE_OBJECT_ID) return false;
    if (!questActive(player) || quest.getStage(player) < STAGE_CATHEDRAL) return false;
    event.handled = true;
    if (hasFlag(player, FLAG_CATHEDRAL_BOOK) || held(player, OBSERVATIONS_ITEM_ID)) {
      player.sendMessage("You have already searched this bookcase.");
      return true;
    }
    if (!give(player, OBSERVATIONS_ITEM_ID)) return true;
    setFlag(player, FLAG_CATHEDRAL_BOOK);
    player.sendMessage("You search the bookcase and find a delicate looking book.");
    return true;
  }

  function handleCrevice(event) {
    const { player, objectId } = event;
    if (objectId !== CREVICE_OBJECT_ID) return false;
    if (!questActive(player) || quest.getStage(player) < STAGE_GOLEM_POWERED) return false;
    event.handled = true;
    const y = player.getLocation().getY() < CREVICE_WALL_Y ? CREVICE_SOUTH_Y : CREVICE_NORTH_Y;
    ensureBasementItems(player);
    player.moveTo(new Location(CREVICE_X, y, 0));
    return true;
  }

  /**
   * Keenan's body (P2 tick 434): the first look hands over Elessia's letter (stage stays 18; reading
   * it is 19). Ours: a player at 18 who no longer has the letter gets the first look again.
   */
  function handleBody(event) {
    const { player, objectId } = event;
    if (objectId !== CATHEDRAL_CORPSE_OBJECT_ID) return false;
    const stage = quest.getStage(player);
    if (stage < STAGE_ANGEL_DEAD || quest.isComplete(player)) return false;
    event.handled = true;
    const first = stage === STAGE_ANGEL_DEAD && (!hasFlag(player, FLAG_FOUND_BODY) || !ownsLetter(player));
    speak(player, CORMAC_NPC_ID, first
      ? "entering-ardeaglais-inspecting-keenan-s-body"
      : "entering-ardeaglais-inspecting-keenan-s-body-again");
    return true;
  }

  /** Only a raft or skiff fits through the south cave opening (Quest Helper/Wiki). */
  function handleCaveEntrance(event) {
    const { player, objectId } = event;
    if (objectId !== CAVE_ENTRANCE_SAILABLE_OBJECT_ID) return false;
    event.handled = true;
    const boat = BoatManager.getBoatAboard(player);
    const type = boat && BoatManager.getSpec(boat)?.type;
    if (!boat || (type !== "raft" && type !== "skiff")) {
      player.sendMessage("You need to sail into the cavern on a raft or skiff.");
      return true;
    }
    if (quest.getStage(player) < STAGE_CORMAC_PLAN) {
      player.sendMessage("You should speak to Cormac before sailing into the cavern.");
      return true;
    }
    const refusal = Sailing.disembark(player, "wyrmscraig_cave");
    if (refusal) {
      player.sendMessage(refusal);
      return true;
    }
    setFlag(player, FLAG_WYRMS_ENTRY);
    if (quest.getStage(player) < STAGE_CAVERN) quest.setStage(player, STAGE_CAVERN);
    return true;
  }

  /**
   * The cathedral's front doors until the quest is done. From outside, before the player is in, the
   * Wiki's "firmly locked" box; from inside (stage 16+), the captured question (P2 tick 473) and
   * the 811 lock. Once picked they open as they do for everyone (the MadAngel plugin).
   * Ours: the lock can be picked before the angel is dead (the transcript's choice has no stage).
   */
  function handleCathedralDoor(event) {
    const { player, objectId } = event;
    if (!CATHEDRAL_DOOR_OBJECT_IDS.has(objectId)) return false;
    if (quest.isComplete(player) || hasFlag(player, FLAG_CATHEDRAL_OPENED)) return false;
    const stage = quest.getStage(player);
    event.handled = true;
    // The lock is picked from inside ("Exit the cathedral by searching the lock", Wiki).
    const outside = player.getLocation().getX() >= CATHEDRAL_DOOR_OUTSIDE_X;
    // Ours: someone inside before stage 16 (only possible on older builds) is let out.
    if (!outside && stage < STAGE_CATHEDRAL) {
      event.handled = false;
      return false;
    }
    if (stage < STAGE_CATHEDRAL || outside) {
      speak(player, CORMAC_NPC_ID, "the-way-under-ardeaglais-attempting-to-open-the-cathedral-door");
      return true;
    }
    player.getMovementQueue?.()?.reset?.();
    sound(player, DOOR_SOUND);
    api.sendMultiChatboxPrompt(player, DOOR_QUESTION, DOOR_PICK, () => openDoorLock(player),
      DOOR_LEAVE, () => player.getPacketSender().sendInterfaceRemoval());
    return true;
  }

  function shortcutCleared(player) {
    return Boolean(player.getAttribute(SHORTCUT_CLEARED_ATTRIBUTE)) || quest.isComplete(player);
  }

  function syncShortcutVarbit(player) {
    player.getPacketSender().sendVarbit(SHORTCUT_VARBIT, shortcutCleared(player) ? 1 : 0);
  }

  function clearShortcutBlockage(event, player, pickaxe) {
    event.handled = true;
    player.performAnimation(pickaxe.animation);
    player.setAttribute(SHORTCUT_CLEARED_ATTRIBUTE, true);
    player.getPacketSender().sendVarbit(SHORTCUT_VARBIT, 1);
    player.sendMessage("You swing your pickaxe at the rocks...");
    player.sendMessage("...and successfully manage to clear them.");
    return true;
  }

  /** The captured shortcut blockage: only after the body/cathedral and with a usable pickaxe. */
  function handleShortcutBlockage(event) {
    const { player, objectId } = event;
    if (objectId !== SHORTCUT_BLOCKAGE_OBJECT_ID && objectId !== SHORTCUT_BLOCKED_ROCKS_OBJECT_ID) return false;
    if (quest.getStage(player) < STAGE_BODY || quest.isComplete(player) || shortcutCleared(player)) return false;
    event.handled = true;
    const pickaxe = mining.findBestPickaxe(player);
    if (!pickaxe) {
      player.sendMessage("You need a pickaxe to clear the rocks.");
      return true;
    }
    return clearShortcutBlockage(event, player, pickaxe);
  }

  function handleShortcutItem(event) {
    const { player, objectId, itemId } = event;
    if (objectId !== SHORTCUT_BLOCKAGE_OBJECT_ID && objectId !== SHORTCUT_BLOCKED_ROCKS_OBJECT_ID) return false;
    if (quest.getStage(player) < STAGE_BODY || quest.isComplete(player) || shortcutCleared(player)) return false;
    const pickaxe = mining.findBestPickaxe(player);
    if (!pickaxe || itemId !== pickaxe.id) return false;
    return clearShortcutBlockage(event, player, pickaxe);
  }

  function handleShortcutClimb(event) {
    const { player, objectId, clickType } = event;
    if (!SHORTCUT_TOP_OBJECT_IDS.has(objectId) || clickType !== 1) return false;
    if (quest.getStage(player) < STAGE_BODY || !shortcutCleared(player)) return false;
    event.handled = true;
    if (ObstacleRunner.isBusy(player)) return true;
    const spec = WyrmscraigAgility.wyrmscraigCliff({ ends: SHORTCUT_ENDS });
    const context = {
      player,
      pos: player.getLocation(),
      obj: { x: 2551, y: 2209, z: player.getLocation().getZ() },
      object: event.object,
    };
    ObstacleRunner.run(context, spec.steps(context), { agility: true });
    return true;
  }

  function handleObjectInteraction(event) {
    if (handleShortcutBlockage(event)) return;
    if (handleShortcutClimb(event)) return;
    if (handleCathedralDoor(event)) return;
    if (handleCaveEntrance(event)) return;
    if (handleMonolith(event)) return;
    if (handleTent(event)) return;
    if (handleChest(event)) return;
    if (handleBookcase(event)) return;
    if (handleCrevice(event)) return;
    if (handleBody(event)) return;
  }

  // ==========================================================================
  // Items
  // ==========================================================================

  function breakOpenAncientCore(player) {
    player.getInventory().deleteNumber(ANCIENT_SUNSTONE_CORE_ITEM_ID, 1);
    speak(player, CORMAC_NPC_ID, "entering-ardeaglais-breaking-open-the-ancient-sunstone-core");
  }

  function handleItemOnItem(event) {
    const { player, usedItemId, usedWithItemId } = event;
    const pair = [usedItemId, usedWithItemId];
    const chisel = pair.find(id => id === CHISEL_ITEM_ID || id === ItemIdentifiers.JEWELLERS_CHISEL);
    if (chisel === undefined) return false;
    const other = pair[0] === chisel ? pair[1] : pair[0];
    if (other === SUNSTONE_ITEM_ID && held(player, SUNSTONE_ITEM_ID)) {
      event.handled = true;
      // Wiki Sunstone core: 60 Crafting (boostable), instant, 10 Crafting XP.
      if (player.getSkillManager().getCurrentLevel(Skill.CRAFTING) < 60) {
        player.sendMessage("You need a Crafting level of 60 to make a sunstone core.");
        return true;
      }
      // As captured (P1 tick 186): the message, animation 7202 and sound 1553.
      player.getInventory().deleteNumber(SUNSTONE_ITEM_ID, 1);
      player.getInventory().adds(SUNSTONE_CORE_ITEM_ID, 1);
      player.getSkillManager().addExperiences(Skill.CRAFTING, 10);
      player.performAnimation(new api.core.Animation(CHISEL_ANIMATION));
      sound(player, CHISEL_SOUND);
      player.sendMessage("You chisel the sunstone into a sunstone core.");
      return true;
    }
    if (other === ANCIENT_SUNSTONE_CORE_ITEM_ID && held(player, ANCIENT_SUNSTONE_CORE_ITEM_ID)) {
      event.handled = true;
      breakOpenAncientCore(player);
      return true;
    }
    return false;
  }

  function handleItemOnNpc(event) {
    const { player, itemId, npcId } = event;
    if (itemId !== SUNSTONE_CORE_ITEM_ID || npcId !== BROKEN_GOLEM_NPC_ID) return false;
    const stage = quest.getStage(player);
    if (stage < STAGE_CORE || stage >= STAGE_GOLEM_POWERED) return false;
    event.handled = true;
    player.getInventory().deleteNumber(SUNSTONE_CORE_ITEM_ID, 1);
    quest.setStage(player, STAGE_GOLEM_POWERED);
    ensureBasementItems(player);
    // Its box moves the player through the opened passage behind a fade (GOLEM_POWERED_MESSAGE_ID).
    speak(player, CORMAC_NPC_ID, "entering-ardeaglais-putting-a-new-core-in-the-golem");
    return true;
  }

  const GOLEM_NPC_IDS = new Set([BROKEN_GOLEM_NPC_ID, NpcIdentifiers.POWERED_GOLEM]);
  const BROKEN_DOWN_GOLEM_MULTI_ID = 16320; // broken_down_golem, the multi-NPC base (no name, no identifier)
  const GOLEM_CAVERN_TILE = new Location(2573, 8649, 0); // the captured front, cavern side (P2 tick 249)
  const golemPassing = new WeakSet();

  function handleGolemInvestigate(event) {
    const { player, npcId } = event;
    if (!GOLEM_NPC_IDS.has(npcId) && npcId !== BROKEN_DOWN_GOLEM_MULTI_ID) return false;
    const stage = quest.getStage(player);
    if (questActive(player) && stage >= STAGE_GOLEM_POWERED) {
      // Ours (not recorded): once powered, the golem lets the player back through, so a player who
      // died, teleported or logged out mid-fade can return to the basement and the cathedral.
      event.handled = true;
      if (golemPassing.has(player)) return true;
      golemPassing.add(player);
      later(player, GOLEM_FADE.closeTicks, () => golemPassing.delete(player));
      const cavernSide = player.getLocation().getY() < CREVICE_WALL_Y;
      fadeTravel(player, GOLEM_FADE, () => player.moveTo(cavernSide ? GOLEM_PASSAGE_TILE : GOLEM_CAVERN_TILE));
      return true;
    }
    if (stage < STAGE_TROLLS || stage >= STAGE_GOLEM_POWERED) return false;
    event.handled = true;
    speak(
      player,
      CORMAC_NPC_ID,
      stage <= STAGE_GOLEM
        ? "the-way-under-ardeaglais-searching-the-golem"
        : "the-way-under-ardeaglais-searching-the-golem-after-taking-the-dull-core"
    );
    return true;
  }

  function handleItemAction(event) {
    const { player, itemId, option } = event;
    const action = String(option ?? "").toLowerCase();
    if (action === "inspect" && itemId === DULL_SUNSTONE_CORE_ITEM_ID) {
      event.handled = true;
      speak(player, CORMAC_NPC_ID, "the-way-under-ardeaglais-inspecting-the-core");
      return true;
    }
    if (action === "inspect" && itemId === ANCIENT_SUNSTONE_CORE_ITEM_ID) {
      event.handled = true;
      speak(player, CORMAC_NPC_ID, "entering-ardeaglais-inpsecting-the-ancient-sunstone-core");
      return true;
    }
    if (
      action === "destroy" &&
      itemId === ANCIENT_SUNSTONE_CORE_ITEM_ID &&
      held(player, ANCIENT_SUNSTONE_CORE_ITEM_ID)
    ) {
      event.handled = true;
      breakOpenAncientCore(player);
      return true;
    }
    if (action === "read" && itemId === FINAL_LETTER_ITEM_ID) {
      event.handled = true;
      readFinalLetter(player);
      return true;
    }
    if (action === "read" && itemId === SCRAWLED_NOTEBOOK_ITEM_ID) {
      // As captured (P1 tick 161), the first read sets ffg_keenans_book (15762).
      setFlag(player, FLAG_KEENANS_BOOK);
    }
    if (action === "read" && READ_MESSAGES.has(itemId)) {
      event.handled = true;
      player.sendMessage(READ_MESSAGES.get(itemId));
      return true;
    }
    return false;
  }

  /** Elessia's letter on the long scroll (P2 tick 449); the first read at stage 18 is stage 19. */
  function readFinalLetter(player) {
    if (quest.getStage(player) === STAGE_ANGEL_DEAD) quest.setStage(player, STAGE_BODY);
    openLongScroll(player, "", FINAL_LETTER_TEXT);
  }

  // ==========================================================================
  // Ground items
  // ==========================================================================

  function investigateHat(player) {
    if (!questActive(player)) {
      player.sendMessage("Someone's left their hat here. How odd.");
      return;
    }
    // The dust trail to it shows from stage 5 (ffg_dust); before the notebook it is just a hat.
    if (quest.getStage(player) === STAGE_NOTEBOOK) {
      quest.setStage(player, STAGE_HAT);
      speak(player, CORMAC_NPC_ID, "following-the-trail-investigating-the-large-hat");
      return;
    }
    speak(player, CORMAC_NPC_ID, "following-the-trail-investigating-the-large-hat-again");
  }

  function investigateJournal(player) {
    player.sendMessage("Elessia's worn journal: she had been ill for some time, and feared what she was becoming.");
  }

  function handleGroundItemInvestigate(event) {
    const { player, groundItemId } = event;
    if (groundItemId === LARGE_HAT_ITEM_ID) {
      event.handled = true;
      investigateHat(player);
      return true;
    }
    if (groundItemId === WORN_JOURNAL_ITEM_ID) {
      event.handled = true;
      investigateJournal(player);
      return true;
    }
    return false;
  }

  /**
   * The decoder maps a ground option with no name to "Take" when it sits at op 3, and the
   * hat and journal's only option ("Investigate") is their op 3. Their clicks therefore
   * arrive here as a pickup; treat them as investigates and block the pickup.
   */
  function handleGroundItemPickup(event) {
    const { player, groundItemId } = event;
    if (groundItemId === LARGE_HAT_ITEM_ID || groundItemId === WORN_JOURNAL_ITEM_ID) {
      event.handled = true;
      handleGroundItemInvestigate(event);
      return;
    }
    if (groundItemId !== WARNING_NOTE_ITEM_ID) return;
    if (!questActive(player)) return;
    setFlag(player, FLAG_NOTE_FOUND);
  }

  // ==========================================================================
  // Captured automatic cavern passage
  // ==========================================================================

  const cavernApproachKeys = new Map();

  function later(key, ticks, action) {
    TaskManager.submit(new CountdownTask(key, ticks, action));
  }

  function stopCavernApproachWatch(player) {
    const key = cavernApproachKeys.get(player);
    if (key) TaskManager.cancelTasks?.(key);
    cavernApproachKeys.delete(player);
  }

  function caveBoat(player) {
    const boat = BoatManager.getBoatAboard(player);
    if (!boat || boat.static || boat.ownerPlayerId !== player.getIndex()) return null;
    const type = BoatManager.getSpec(boat)?.type;
    return CAVE_BOAT_TYPES.has(type) ? boat : null;
  }

  function inCavernApproach(boat) {
    if (boat.level !== CAVERN_APPROACH.z) return false;
    const x = Math.floor(boat.fineX / 128);
    const y = Math.floor(boat.fineY / 128);
    return x >= CAVERN_APPROACH.minX && x <= CAVERN_APPROACH.maxX
      && y >= CAVERN_APPROACH.minY && y <= CAVERN_APPROACH.maxY;
  }

  function caveOpeningEffect(player) {
    const out = player.getPacketSender();
    // Script 5985 only clears the effect's children; the mount itself must be closed, or a later
    // layout change replays 5984 and leaves the rectangle covering the view.
    const mount = out.mountSubInterface(OVERLAY_ATMOSPHERE, GOTR_OVERLAY, 1, {
      postScripts: [{ scriptId: SCRIPT_GOTR_PORTAL, args: [GOTR_MODEL_NONE, CAVE_OPENING_COLOUR] }],
    });
    out.sendSoundEffect(CAVE_OPENING_SOUND, 1, 0);
    later(player, 2, () => out.sendClientScript(SCRIPT_GOTR_REMOVE));
    later(player, CAVE_OPENING_CLOSE_TICKS, () => out.closeSubInterfaceMount(mount));
  }

  /** One captured transition: move the player's boat to the cavern mooring and stay aboard. */
  function enterCavernByBoat(player, boat) {
    stopCavernApproachWatch(player);
    caveOpeningEffect(player);
    boat.fineX = CAVERN_MOORING.fineX;
    boat.fineY = CAVERN_MOORING.fineY;
    boat.level = CAVERN_MOORING.z;
    boat.angle = CAVERN_MOORING.angle;
    boat.heading = CAVERN_MOORING.angle;
    boat.moveMode = 0;
    boat.velocity = 0;
    Sailing.dock(player, "wyrmscraig_cave");
    setFlag(player, FLAG_WYRMS_ENTRY);
    // Only the first sail moves the quest on; after completion the passage is just a crossing.
    if (quest.getStage(player) === STAGE_CORMAC_PLAN) quest.setStage(player, STAGE_CAVERN);
    player.sendMessage("You sail through the cave opening.");
  }

  /** The cave passage works during the quest (the first sail, stage 8) and after it. */
  function cavernWatchActive(player) {
    return quest.getStage(player) === STAGE_CORMAC_PLAN || quest.isComplete(player);
  }

  function startCavernApproachWatch(player) {
    if (cavernApproachKeys.has(player) || !cavernWatchActive(player)) return;
    if (!caveBoat(player)) return;
    const key = {};
    cavernApproachKeys.set(player, key);
    const tick = () => {
      if (cavernApproachKeys.get(player) !== key) return;
      if (!cavernWatchActive(player)) {
        cavernApproachKeys.delete(player);
        return;
      }
      const boat = caveBoat(player);
      if (!boat) {
        cavernApproachKeys.delete(player);
        return;
      }
      if (inCavernApproach(boat)) {
        enterCavernByBoat(player, boat);
        return;
      }
      later(key, 2, tick);
    };
    later(key, 2, tick);
  }

  function handleSailingBoarded({ player }) {
    if (player) startCavernApproachWatch(player);
  }

  /** Disembarking at the cavern's gangplank: the player is on its landing a tick later (P2 tick 42). */
  function handleSailingLeft({ player, reason }) {
    if (!player) return;
    stopCavernApproachWatch(player);
    if (reason !== "disembark" || quest.getStage(player) !== STAGE_CAVERN) return;
    later(player, 1, () => player.isRegistered?.() !== false && handleCavernLanding(player));
  }

  function handleLogout({ player }) {
    if (!player) return;
    stopCavernApproachWatch(player);
    removeCavernScene(player);
  }

  // ==========================================================================
  // NPC death
  // ==========================================================================

  function handleNpcDeath(event) {
    const npc = event.npc;
    if (!npc) return;

    const session = npc.__madAngel;
    if (session) {
      const player = session.player;
      if (player && session.variant === "quest" && quest.getStage(player) === STAGE_CATHEDRAL) {
        quest.setStage(player, STAGE_ANGEL_DEAD);
      }
      return;
    }

    const killer = event.killer;
    if (!killer?.isPlayer?.()) return;
    const contentId = npc.getContentId?.(killer) ?? npc.getId();
    if (!TROLL_NPC_IDS.has(contentId)) return;
    const scene = cavernScenes.get(killer);
    if (scene) scene.trolls = scene.trolls.filter((troll) => troll !== npc);
    const stage = quest.getStage(killer);
    if ((stage !== STAGE_CAVERN && stage !== STAGE_TROLLS) || hasFlag(killer, FLAG_TROLLS_KILLED)) return;
    if (!inZone(npc.getLocation(), CAVERN_ZONE)) return;
    const kills = (Number(killer.getAttribute(TROLL_KILLS_ATTRIBUTE)) || 0) + 1;
    killer.setAttribute(TROLL_KILLS_ATTRIBUTE, kills);
    // Before his request the kills only count; the call comes once he has asked (ours, not recorded).
    if (kills >= TROLLS_TO_KILL && stage === STAGE_TROLLS) trollsDone(killer);
  }

  /** P2 tick 151: the flag, the game message and Mortimer's shout, together. */
  function trollsDone(player) {
    setFlag(player, FLAG_TROLLS_KILLED);
    player.sendMessage(TROLLS_KILLED_MESSAGE);
    cavernScenes.get(player)?.mortimer?.forceChat?.(TROLLS_KILLED_SHOUT);
  }

  /**
   * The Mad Angel's sunstone crystal (Wiki, Mad Angel): "always drops if the bank chest is not built
   * and a crystal is not already owned". Owned is carried, worn or banked.
   */
  function ownsCrystal(player) {
    if (api.core.Bank?.owns) return api.core.Bank.owns(player, SUNSTONE_CRYSTAL_ITEM_ID);
    return [player.getInventory(), player.getEquipment?.()].filter(Boolean)
      .some((container) => (container.getValidItems?.() ?? []).some((item) => item?.getId?.() === SUNSTONE_CRYSTAL_ITEM_ID && item.getAmount?.() > 0));
  }

  function answerCrystalDrop(request) {
    if (request?.itemId !== SUNSTONE_CRYSTAL_ITEM_ID || !request.player) return;
    const built = request.player.getPacketSender().getVarbit?.(WYRMS_BANK_CHEST_VARBIT) === 1;
    request.allowed = !built && !ownsCrystal(request.player);
  }

  // ==========================================================================
  // The cavern before the rockfall is cleared (stages 9-11)
  // ==========================================================================

  /** Per player: the cutscene Mortimer and the quest's trolls, spawned for them alone. */
  const cavernScenes = new Map();

  function cavernSceneActive(player) {
    const stage = quest.getStage(player);
    return questActive(player) && (stage === STAGE_CAVERN || stage === STAGE_TROLLS);
  }

  function spawnPrivate(player, spawn, wanderRadius) {
    return api.spawnNpc({
      id: spawn.id, x: spawn.x, y: spawn.y, z: 0, face: spawn.face, wanderRadius, owner: player, ownerOnly: true,
    });
  }

  function ensureCavernScene(player) {
    if (!cavernSceneActive(player) || !inZone(player.getLocation(), CAVERN_ZONE)) return null;
    let scene = cavernScenes.get(player);
    if (!scene) {
      // Live adds the trolls with Mortimer on arrival (P2 tick 42); a kill before his request counts.
      scene = { mortimer: spawnPrivate(player, MORTIMER_CUTSCENE_SPAWN, 0), trolls: [] };
      cavernScenes.set(player, scene);
      if (!hasFlag(player, FLAG_TROLLS_KILLED)) {
        const left = Math.max(0, TROLLS_TO_KILL - (Number(player.getAttribute(TROLL_KILLS_ATTRIBUTE)) || 0));
        scene.trolls = TROLL_SPAWNS.slice(TROLLS_TO_KILL - left)
          .map((spawn) => spawnPrivate(player, spawn, TROLL_WANDER_RADIUS)).filter(Boolean);
      }
    }
    return scene;
  }

  function removeCavernScene(player) {
    const scene = cavernScenes.get(player);
    if (!scene) return;
    cavernScenes.delete(player);
    for (const npc of [scene.mortimer, ...scene.trolls]) if (npc) api.removeNpc(npc);
  }

  /**
   * Landing in the cavern at stage 9 (P2 ticks 41-43): Mortimer calls the player over as the
   * disembark's fade ends.
   */
  function handleCavernLanding(player) {
    if (quest.getStage(player) !== STAGE_CAVERN || !inZone(player.getLocation(), CAVERN_ZONE)) return;
    const scene = ensureCavernScene(player);
    speakWith(player, scene?.mortimer ?? null, MORTIMER_CUTSCENE_SPAWN.id, "the-way-under-ardeaglais-meeting-mortimer");
  }

  // ==========================================================================
  // Stairs, zones and login
  // ==========================================================================

  /** Stages 16-17 are the quest's angel; 18-19 its corpse (Ours: the corpse if the player goes back). */
  function answerMadAngelVariant(request) {
    const player = request?.player;
    if (!player || !questActive(player)) return;
    const stage = quest.getStage(player);
    if (stage < STAGE_CATHEDRAL) return;
    request.variant = "quest";
    request.defeated = stage >= STAGE_ANGEL_DEAD;
  }

  /** P2 tick 315: the quest asks "Climb over the pew?" before the cathedral. */
  function answerPewClimb(request) {
    const player = request?.player;
    if (player && questActive(player) && quest.getStage(player) >= STAGE_CATHEDRAL) request.prompt = true;
  }

  /**
   * Into the cathedral by the basement stairs (P2 ticks 288-295): the fade out, the move to
   * 2540,2214 two ticks later, the fade back a tick after that. The first time, the key unlocks
   * the hatch (its message and sound, flag 15766), the dull core goes (tick 292) and it is stage 16.
   */
  const climbingStairs = new WeakSet();

  function climbIntoCathedral(player, firstTime) {
    if (climbingStairs.has(player)) return;
    climbingStairs.add(player);
    later(player, STAIRS_FADE.closeTicks, () => climbingStairs.delete(player));
    if (firstTime) {
      if (held(player, STAIRCASE_KEY_ITEM_ID)) player.getInventory().deleteNumber(STAIRCASE_KEY_ITEM_ID, 1);
      setFlag(player, FLAG_KEY_USED);
      player.sendMessage(HATCH_MESSAGE);
      sound(player, HATCH_SOUND);
    }
    player.getMovementQueue?.()?.reset?.();
    fadeTravel(player, STAIRS_FADE, () => {
      // Not tied to `firstTime`: a logout during the fade must not leave the quest at 15.
      if (quest.getStage(player) === STAGE_GOLEM_POWERED) {
        quest.setStage(player, STAGE_CATHEDRAL);
        if (held(player, DULL_SUNSTONE_CORE_ITEM_ID)) player.getInventory().deleteNumber(DULL_SUNSTONE_CORE_ITEM_ID, 1);
      }
      player.moveTo(CATHEDRAL_TILE);
    });
  }

  function claimBasementStairs(event) {
    const { player } = event;
    const stage = quest.getStage(player);
    if (quest.isComplete(player) || stage < STAGE_GOLEM_POWERED) return;
    event.handled = true;
    if (stage >= STAGE_CATHEDRAL || hasFlag(player, FLAG_KEY_USED)) {
      // The move sets 16 and takes the dull core whenever the stage is still 15.
      climbIntoCathedral(player, !hasFlag(player, FLAG_KEY_USED));
      return;
    }
    if (!held(player, STAIRCASE_KEY_ITEM_ID)) {
      speak(player, CORMAC_NPC_ID, "entering-ardeaglais-attempting-to-climb-the-stairs");
      return;
    }
    climbIntoCathedral(player, true);
  }

  function claimCathedralStairs(event) {
    const { player } = event;
    // The instance copy includes the cathedral's staircase; never claim there.
    if (MadAngelInstance.sessionOf(player)) return;
    const stage = quest.getStage(player);
    if (stage < STAGE_GOLEM_POWERED && !quest.isComplete(player)) return;
    event.handled = true;
    player.moveTo(BASEMENT_TILE);
  }

  function handleLadderClaim(event) {
    if (!event?.player) return;
    if (event.objectId === BASEMENT_STAIRS_OBJECT_ID) {
      claimBasementStairs(event);
      return;
    }
    if (event.objectId === CATHEDRAL_STAIRS_OBJECT_ID) {
      claimCathedralStairs(event);
    }
  }

  function handleSurfaceZoneEnter({ player }) {
    ensureHat(player);
  }

  function handleCavernZoneEnter({ player }) {
    if (!questActive(player)) return;
    ensureCavernScene(player);
    const stage = quest.getStage(player);
    if (stage === STAGE_CAVERN && hasFlag(player, FLAG_WYRMS_ENTRY)) ensureBasementItems(player);
    if (stage >= STAGE_GOLEM_POWERED) ensureBasementItems(player);
  }

  /** Maps the old overlapping ladder onto the live values once; completed saves stay complete. */
  function migrateStage({ player }) {
    if (player.getAttribute(STAGE_VERSION_ATTRIBUTE) === STAGE_VERSION) return;
    const old = quest.getStage(player);
    const migrated = { 1: 2, 2: 3, 6: 5, 7: 5, 8: 6, 9: 6, 10: 8, 11: 8, 12: 9, 13: 11, 14: 13, 17: 18, 18: 19 }[old];
    if (migrated !== undefined) quest.setStage(player, migrated);
    player.setAttribute(STAGE_VERSION_ATTRIBUTE, STAGE_VERSION);
  }

  function handleCavernZoneExit({ player }) {
    if (player) removeCavernScene(player);
  }

  function handleLogin({ player }) {
    refreshQuestList(player);
    ensureHat(player);
    ensureCavernScene(player);
    syncShortcutVarbit(player);
    startCavernApproachWatch(player);
  }

  // ==========================================================================
  // Journal and reward
  // ==========================================================================

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      return [
        "<str>Keenan went missing on Wyrmscraig, and Cormac asked me</str>",
        "<str>to find him. I followed his trail to the cathedral of</str>",
        "<str>Ardeaglais, where the Mad Angel had killed him.</str>",
        "<str>I defeated the angel, read Elessia's letter, and brought</str>",
        "<str>the news back to Cormac.</str>",
        "",
        "<col=ff0000>QUEST COMPLETE!</col>",
      ];
    }
    if (stage >= STAGE_BODY) {
      return [
        "<str>I found Keenan dead in Ardeaglais, killed by the Mad Angel,</str>",
        "<str>and defeated her. I should bring the news back to Cormac.</str>",
      ];
    }
    if (stage >= STAGE_ANGEL_DEAD) {
      return [
        "The Mad Angel is dead. I should search <col=800000>Keenan's body</col>",
        "in the cathedral and then report back to Cormac.",
      ];
    }
    if (stage >= STAGE_CATHEDRAL) {
      return [
        "I have entered Ardeaglais. The <col=800000>Mad Angel</col> guards",
        "Keenan's body somewhere inside; I must defeat her.",
      ];
    }
    if (stage >= STAGE_GOLEM_POWERED) {
      return [
        "<str>I powered the broken golem with my sunstone core and it moved</str>",
        "<str>aside. Through the crevice is the cathedral basement.</str>",
        "",
        "I should search the <col=800000>chest</col> below Ardeaglais and",
        "climb the stairs to the cathedral.",
      ];
    }
    if (stage >= STAGE_GOLEM) {
      return [
        "<str>Mortimer cleared the rockfall and introduced himself.</str>",
        "",
        "I took the dull core from the <col=800000>broken golem</col>; it",
        "needs a new <col=800000>sunstone core</col> to power it.",
      ];
    }
    if (stage >= STAGE_TROLLS) {
      return [
        "<str>I met Mortimer, the oldest Slayer Master, trapped behind a</str>",
        "<str>rockfall in the cavern. The three nearby trolls are dead.</str>",
        "",
        "I should speak to <col=800000>Mortimer</col> again.",
      ];
    }
    if (stage >= STAGE_CAVERN) {
      return [
        "I have entered the caverns beneath Wyrmscraig.",
        "A talking skeleton asked me to deal with the three nearby",
        "<col=800000>mountain trolls</col>.",
      ];
    }
    if (stage >= STAGE_CORMAC_PLAN) {
      return [
        "<str>Cormac told me the cathedral is home to the Mad Angel, and</str>",
        "<str>that I might get in through the caverns on the south side.</str>",
        "",
        "I should sail into the <col=800000>caverns</col> beneath Wyrmscraig.",
      ];
    }
    if (stage >= STAGE_HAT) {
      return [
        "<str>I found what looks like Keenan's hat on the rocks south of</str>",
        "<str>the cathedral.</str>",
        "",
        "I should tell <col=800000>Cormac</col> what I found.",
      ];
    }
    if (stage >= STAGE_NOTEBOOK) {
      return [
        "<str>I followed Keenan's trail from the sunstone monolith.</str>",
        "",
        held(player, SUNSTONE_CORE_ITEM_ID)
          ? "<str>I have a sunstone core ready for whatever it powers.</str>"
          : held(player, SUNSTONE_ITEM_ID)
            ? "I should chisel the <col=800000>sunstone</col> into a core."
            : "I should mine the <col=800000>sunstone monolith</col> and chisel a core.",
        "",
        "A trail of dust leads south from the monolith.",
      ];
    }
    if (stage >= STAGE_MURIEL) {
      return [
        "<str>Cormac asked me to find Keenan, who has gone missing.</str>",
        "",
        "Muriel said Keenan was obsessed with the",
        "<col=800000>sunstone monolith</col> in the mine.",
        "I should inspect it.",
      ];
    }
    if (stage >= STAGE_STARTED) {
      return [
        "<str>I spoke to Cormac in Auchrie and agreed to help find Keenan.</str>",
        "",
        "I should ask his mother <col=800000>Muriel</col>, whose house is",
        "north-east of Cormac's hut.",
      ];
    }
    return [
      "I can start this quest by speaking to <col=800000>Cormac</col>",
      "in <col=800000>Auchrie</col> on the island of Wyrmscraig.",
      "",
      "Requirements: 62 Sailing, 60 Crafting, 47 Runecraft, 53 Mining",
      "and completion of Pandemonium.",
    ];
  }

  function grantReward(player) {
    const skills = player.getSkillManager();
    skills.addExperiences(Skill.CRAFTING, 10000);
    skills.addExperiences(Skill.SAILING, 12500);
    skills.addExperiences(Skill.MINING, 5000);
    skills.addExperiences(Skill.RUNECRAFTING, 5000);
    if (held(player, FINAL_LETTER_ITEM_ID)) {
      player.getInventory().deleteNumber(FINAL_LETTER_ITEM_ID, 1);
    }
  }

  // ==========================================================================
  // Registration
  // ==========================================================================

  api.persistAttribute(FLAGS_ATTRIBUTE);
  api.persistAttribute(STAGE_VERSION_ATTRIBUTE, 0);
  api.persistAttribute(TROLL_KILLS_ATTRIBUTE, 0);
  api.persistAttribute(SHORTCUT_CLEARED_ATTRIBUTE, false);

  quest = registerQuest(api, {
    key: "fallen_from_grace",
    name: "Fallen From Grace",
    varpId: VARP_FALLEN_FROM_GRACE,
    varbitId: VARBIT_STAGE,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 2,
    // The scroll's lines in live's order (P2 tick 713): points, the two unlocks, then the XP.
    xpRewards: [
      { skillId: Skill.SAILING.getIndex(), amount: 12500, label: "Sailing" },
      { skillId: Skill.CRAFTING.getIndex(), amount: 10000, label: "Crafting" },
      { skillId: Skill.MINING.getIndex(), amount: 5000, label: "Mining" },
      { skillId: Skill.RUNECRAFTING.getIndex(), amount: 5000, label: "Runecraft" },
    ],
    otherRewards: ["Wyrmscraig Cathedral access", "Ability to craft golems"],
    rewardOrder: ["other", "xp"],
    buildJournal,
    onReward: grantReward,
  });

  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("npc-dialogue:condition", handleDialogueCondition);
  api.onCustomEvent("npc-dialogue:action", handleDialogueAction);
  api.onCustomEvent("player:bootstrap-complete", sendFlagVarps);
  api.onObjectInteraction(handleObjectInteraction);
  api.onCustomEvent("madangel:cathedral-door", handleCathedralDoor);
  api.onCustomEvent("madangel:instance-variant", answerMadAngelVariant);
  api.onCustomEvent("madangel:pew-climb", answerPewClimb);
  api.onCustomEvent("npc-drops:quest-item", answerCrystalDrop);
  api.onCustomEvent("npc-dialogue:line", handleLine);
  api.onItemOnItem(handleItemOnItem);
  api.onItemOnObject(handleShortcutItem, { noted: false });
  api.onItemOnNpc(handleItemOnNpc);
  api.onItemAction(handleItemAction);
  api.onNpcInteraction("Broken golem", { Investigate: handleGolemInvestigate });
  api.onNpcInteraction("Powered golem", { Investigate: handleGolemInvestigate });
  api.onGroundItemClick([LARGE_HAT_ITEM_ID, WORN_JOURNAL_ITEM_ID], 3, handleGroundItemInvestigate);
  api.onGroundItemPickup(handleGroundItemPickup);
  api.onNpcDeath(handleNpcDeath);
  api.onCustomEvent("ladders:climb", handleLadderClaim);
  api.onZoneEnter(SURFACE_ZONE, handleSurfaceZoneEnter);
  api.onZoneEnter(CAVERN_ZONE, handleCavernZoneEnter);
  api.onZoneExit(CAVERN_ZONE, handleCavernZoneExit);
  api.onCustomEvent("sailing:boarded", handleSailingBoarded);
  api.onCustomEvent("sailing:left", handleSailingLeft);
  api.onPlayerLogin(migrateStage);
  api.onPlayerLogin(handleLogin);
  api.onPlayerLogout(handleLogout);
};
