/**
 * What Lies Below (members).
 *
 * The words come from the "What Lies Below" transcript page in
 * data/definitions/npc-dialogues.json; this plugin supplies the NPC variant
 * selector (Rat Burgiss, Surok Magis, Zaff, Anna Jones), the prose-condition
 * answers, the folder/paper loop, the outlaw paper drops, the Surok item
 * hand-ins, the statue excavation/tunnel shortcut, the Zaff ring hand-out and
 * the King Roald boss fight and completion.
 *
 * Stages (varp 992 "surok_main", varbit 3523 "surok_quest" bits 0-7; found with
 * `lookup-gameval varbit surok` and `lookup-gameval varp surok`): 0 not
 * started, 10 folder task, 20 folder handed in (letter to Surok), 30 Surok's
 * briefing (wand + diary), 55 wand infused, 60 Surok's letter in hand, 70
 * letter delivered (visit Zaff), 80 Beacon ring + instructions, 110 King Roald
 * fight, 120 King freed / Surok sealed, 140 complete. The values follow the
 * RuneLite quest-helper step map (0/5/10/20/25/30/40/45/46/50/55/60/61/70/71/
 * 72/80/81/110/115/120/140). The completed stage is sent to cache varbit 3523
 * as 150 (quest DB table 0 column 19's completion threshold); the durable stage
 * stays 140 so existing saves keep their post-quest dialogue.
 *
 * Sub-state lives in the cache's own bits so the client keeps in step:
 * varbit 3525 "surok_foldercheck" (bits 9-11) is the folder's page count (0-5),
 * varbit 3527 "surok_clothes" (bit 13) turns Surok into his Dagon'hai form for
 * the fight. varbit 3524 "surok_tunnelcheck" is deliberately NOT sent: the
 * statue's client transform would swap it to the open model (23058) whose
 * clicks the server map cannot resolve, so the excavate option stays and
 * re-clicking an opened statue enters the tunnel instead.
 *
 * Rewards per the wiki: 1 Quest Point, 8,000 Runecraft XP, 2,000 Defence XP,
 * the Beacon ring (given by Zaff during the quest), the Chaos Altar shortcut
 * and 5 battlestaves in Zaff's shop (shop stock is not editable here).
 *
 * Gaps/approximations:
 * - The Dagon'hai history bookcase (objects 23091/23092 in the library's
 *   north-east corner) is not implemented: the search message is not in any
 *   transcript and the 5-Kudos museum hand-in does not exist on this server.
 * - Reading Sin'keth's diary quotes the diary transcript's tunnel paragraph;
 *   there is no book interface for the full multi-page text.
 * - The statue never swaps to its open model (see above); the tunnel entrance
 *   is a teleport to the cave's stairs (3179,5190), and the tunnel portal
 *   (23095) moves the player to the Chaos Maze's third level (2276,4848,3).
 *   The portal's "needs a chaos talisman/tiara" line is not in the transcript.
 * - 42 Mining is answered as satisfied: the OSRS change of 9 Nov 2022 made it a
 *   recommendation, not a requirement.
 * - The library fight is an approximation: an ownerOnly King Roald (4163) is
 *   spawned and attacks; he cannot be killed (before-death is prevented), the
 *   low-hitpoint hint is sent from the hit hook, and operating the ring
 *   teleports him away or restarts the fight. The room-darkening cutscene and
 *   the door escape (condition 1-Sc21) are not simulated.
 * - Surok's letter read/unread state is not tracked, so the "destroyed after
 *   reading" branch (ku3VvI) is left unanswered.
 * - Surok has no post-quest variant on the page; after completion his standard
 *   transcript page plays.
 *
 * Source: OSRS Wiki (What Lies Below, Quick guide, Transcript:What Lies Below,
 * Sin'keth's diary, Statue (Tunnel of Chaos), Tunnel of Chaos, Chaos Altar);
 * stage values from RuneLite quest-helper; ids from the cache gamevals.
 */
module.exports = function registerWhatLiesBelowQuest(api) {
  const {
    Bank,
    GameObject,
    Item,
    ItemIdentifiers,
    Location,
    NpcIdentifiers,
    ObjectIdentifiers,
    Skill,
  } = api.core;
  const { registerQuest, startTranscript } = require("../QuestRuntime");

  const PAGE = "What Lies Below";

  const VARP_SUROK_MAIN = 992; // "992 surok_main"
  const VARBIT_SUROK_QUEST = 3523; // "3523 surok_quest varp=992 bits=0-7"
  const VARBIT_FOLDER_CHECK = 3525; // "3525 surok_foldercheck varp=992 bits=9-11"
  const VARBIT_SUROK_CLOTHES = 3527; // "3527 surok_clothes varp=992 bits=13-13"

  const STAGE_STARTED = 10;
  const STAGE_FOLDER_RETURNED = 20;
  const STAGE_BRIEFED = 30;
  const STAGE_WAND_INFUSED = 55;
  const STAGE_SUROK_LETTER = 60;
  const STAGE_RAT_KNOWS = 70;
  const STAGE_ZAFF_RING = 80;
  const STAGE_FIGHT = 110;
  const STAGE_KING_DEFEATED = 120;
  const STAGE_COMPLETE = 140;
  const VARBIT_COMPLETE = 150; // cache DB table 0 row 159 column 19

  const RUNECRAFT_LEVEL = 35;
  const PAPERS_NEEDED = 5;
  const RUNES_NEEDED = 15;

  const RAT_NPC_ID = NpcIdentifiers.RAT_BURGISS; // 4158
  const SUROK_NPC_ID = NpcIdentifiers.SUROK_MAGIS; // 4159 (4160 is the transform variant)
  const ZAFF_NPC_ID = NpcIdentifiers.ZAFF; // 2880 (4161 is the WLB variant id)
  const ANNA_NPC_ID = NpcIdentifiers.ANNA_JONES; // 4162
  const FIGHT_KING_NPC_ID = NpcIdentifiers.KING_ROALD_2; // 4163, level 47 / 75 hp

  const SUROK_NPC_IDS = new Set([NpcIdentifiers.SUROK_MAGIS, NpcIdentifiers.SUROK_MAGIS_2]);
  const ZAFF_NPC_IDS = new Set([NpcIdentifiers.ZAFF, NpcIdentifiers.ZAFF_2]);
  const KING_ROALD_NPC_IDS = new Set([
    NpcIdentifiers.KING_ROALD, // 1399
    NpcIdentifiers.KING_ROALD_3, // 5215 (the talkable palace king)
    NpcIdentifiers.KING_ROALD_5, // 8042
    NpcIdentifiers.KING_ROALD_6, // 11019
    NpcIdentifiers.KING_ROALD_7, // 12621
  ]);
  const WLB_NPC_IDS = new Set([
    RAT_NPC_ID,
    ...SUROK_NPC_IDS,
    ...ZAFF_NPC_IDS,
    ANNA_NPC_ID,
    ...KING_ROALD_NPC_IDS,
  ]);
  const OUTLAW_NPC_IDS = new Set([
    NpcIdentifiers.OUTLAW, // 4167
    NpcIdentifiers.OUTLAW_2,
    NpcIdentifiers.OUTLAW_3,
    NpcIdentifiers.OUTLAW_4,
    NpcIdentifiers.OUTLAW_5,
    NpcIdentifiers.OUTLAW_6,
    NpcIdentifiers.OUTLAW_7,
    NpcIdentifiers.OUTLAW_8,
    NpcIdentifiers.OUTLAW_9,
    NpcIdentifiers.OUTLAW_10, // 4176
  ]);

  const DIARY_ITEM_ID = ItemIdentifiers.SINKETHS_DIARY; // 11002
  const EMPTY_FOLDER_ITEM_ID = ItemIdentifiers.AN_EMPTY_FOLDER; // 11003
  const USED_FOLDER_ITEM_ID = ItemIdentifiers.USED_FOLDER; // 11006
  const FULL_FOLDER_ITEM_ID = ItemIdentifiers.FULL_FOLDER; // 11007
  const PAPER_ITEM_ID = ItemIdentifiers.RATS_PAPER; // 11008
  const LETTER_TO_SUROK_ITEM_ID = ItemIdentifiers.LETTER_TO_SUROK; // 11009
  const SUROKS_LETTER_ITEM_ID = ItemIdentifiers.SUROKS_LETTER; // 11010
  const INSTRUCTIONS_ITEM_ID = ItemIdentifiers.ZAFFS_INSTRUCTIONS; // 11011
  const WAND_ITEM_ID = ItemIdentifiers.WAND; // 11012
  const INFUSED_WAND_ITEM_ID = ItemIdentifiers.INFUSED_WAND; // 11013
  const BEACON_RING_ITEM_ID = ItemIdentifiers.BEACON_RING; // 11014
  const BRONZE_PICKAXE_ITEM_ID = ItemIdentifiers.BRONZE_PICKAXE; // 1265
  const BOWL_ITEM_ID = ItemIdentifiers.BOWL; // 1923
  const CHAOS_RUNE_ITEM_ID = ItemIdentifiers.CHAOS_RUNE; // 562
  const CHAOS_TALISMAN_ITEM_ID = ItemIdentifiers.CHAOS_TALISMAN; // 1452
  const CHAOS_TIARA_ITEM_ID = ItemIdentifiers.CHAOS_TIARA; // 5543
  const CATALYTIC_TIARA_ITEM_ID = ItemIdentifiers.CATALYTIC_TIARA; // 26801
  const RUNECRAFT_CAPE_ITEM_ID = ItemIdentifiers.RUNECRAFT_CAPE; // 9765

  const STATUE_OBJECT_ID = ObjectIdentifiers.STATUE_80; // 23057 "Statue", Excavate
  const TUNNEL_PORTAL_OBJECT_ID = ObjectIdentifiers.PORTAL_60; // 23095 "Portal", Use
  const CHAOS_ALTAR_OBJECT_ID = ObjectIdentifiers.ALTAR_55; // 34769 chaos runecraft altar

  const STATUE_TILE = { x: 3284, y: 3469, z: 0 }; // wiki: Statue (Tunnel of Chaos)
  const STATUE_TYPE = 10;
  const STATUE_FACE = 0;
  const SUROK_TILE = { x: 3210, y: 3495, z: 0 }; // Varrock Palace Library
  const KING_SPAWN_TILE = { x: 3209, y: 3495, z: 0 };
  const TUNNEL_ENTRY_TILE = { x: 3179, y: 5190, z: 0 };
  const CHAOS_MAZE_TILE = { x: 2276, y: 4848, z: 3 };
  const ZAFF_SHOP_TILE = { x: 3204, y: 3434, z: 0 };
  const VARROCK_SOUTH_TILE = { x: 3222, y: 3380, z: 0 };
  const VARROCK_CENTRE = { x: 3212, y: 3425 };
  const RING_ZAFF_RANGE = 9;
  const RING_FAR_BLOCKS = 100;
  const LOW_KING_HITPOINTS = 5;
  const KING_REVIVE_HITPOINTS = 5;

  const START_HOOK = "quest:what-lies-below:start";
  const RUNE_MYSTERIES_KEY = "rune_mysteries";

  const PAPERS_ATTRIBUTE = "what-lies-below:papers";
  const TUNNEL_ATTRIBUTE = "what-lies-below:tunnel";

  // --- Variant names -------------------------------------------------------
  const RAT_START_VARIANT = "starting-the-quest-before-the-quest-is-started";
  const RAT_START_AGAIN_VARIANT = "starting-the-quest-talking-to-rat-burgiss-again";
  const RAT_PAPERS_VARIANT = "collecting-the-pages-using-the-folder-and-pages-on-rat-burgiss";
  const RAT_FOLDER_HANDIN_VARIANT = "handing-the-completed-folder-over-to-rat";
  const RAT_LOST_LETTER_VARIANT = "handing-the-completed-folder-over-to-rat-talking-to-rat-burgiss-again";
  const RAT_AFTER_LETTER_VARIANT = "talking-to-rat-burgiss-after-handing-the-letter-to-surok-magis";
  const RAT_SUROK_LETTER_VARIANT = "giving-the-letter-to-rat-burgiss";
  const RAT_SEE_ZAFF_VARIANT = "giving-the-letter-to-rat-burgiss-talking-to-rat-burgiss-again";
  const RAT_RING_VARIANT = "talking-to-rat-burgiss";
  const RAT_FINISH_VARIANT = "after-surok-has-been-defeated-talking-to-rat-burgiss";
  const RAT_POST_VARIANT = "post-quest-dialogue-talking-to-rat-burgiss";

  const SUROK_FIRST_VARIANT = "talking-to-surok-magis";
  const SUROK_AGAIN_VARIANT = "talking-to-surok-magis-talking-to-surok-magis-again";
  const SUROK_ITEM_VARIANT = "talking-to-surok-magis-talking-to-surok-magis-again-using-the-wand-or-diary-on-surok-magis";
  const SUROK_MISSING_VARIANT = "talking-to-surok-after-imbuing-the-wand-missing-items";
  const SUROK_DELIVER_VARIANT = "talking-to-surok-after-imbuing-the-wand-delivering-the-items";
  const SUROK_LETTER_VARIANT = "talking-to-surok-after-imbuing-the-wand-talking-to-surok-magis-again";
  const SUROK_CONFRONT_VARIANT = "confronting-surok-magis";
  const SUROK_FIGHT_START_VARIANT = "confronting-surok-magis-2";
  const SUROK_DEFEATED_TAIL_VARIANT = "after-surok-has-been-defeated-talking-to-surok";

  const ZAFF_INTRO_VARIANT = "talking-to-zaff";
  const ZAFF_AGAIN_VARIANT = "talking-to-zaff-talking-to-zaff-again";
  const ZAFF_RING_VARIANT = "talking-to-zaff-talking-to-zaff-again-operating-the-ring";
  const ZAFF_INSTRUCTIONS_VARIANT = "talking-to-zaff-talking-to-zaff-again-interacting-with-zaff-s-instructions";
  const ZAFF_DEFEATED_VARIANT = "after-surok-has-been-defeated-talking-to-zaff";
  const RING_SPENT_VARIANT = "after-surok-has-been-defeated";
  const FIGHT_VARIANT = "while-fighting-king-roald";

  const ANNA_STOP_VARIANT = "statue-of-saradomin-attempting-to-dig-the-statue-of-saradomin-before-talking-to-anna-jones";
  const ANNA_GIVE_VARIANT = "statue-of-saradomin-talking-to-anna-jones-before-digging-the-statue-of-saradomin";
  const ANNA_EXCAVATE_VARIANT = "statue-of-saradomin-talking-to-anna-jones-before-digging-the-statue-of-saradomin-excavating-the-statue-after-talking-to-anna-jones";

  const KING_LETTER_VARIANT = "talking-to-surok-after-imbuing-the-wand-talking-to-king-roald-with-surok-s-letter-in-their-inventory";
  const INFUSE_VARIANT = "imbuing-the-wand-at-the-chaos-altar";
  const INFUSED_ON_RAT_VARIANT = "imbuing-the-wand-at-the-chaos-altar-talking-to-rat-burgiss-with-the-infused-wand-diary";

  // --- Prose condition step ids -------------------------------------------
  const COND_NO_RUNECRAFT = "0ANaEM";
  const COND_HAS_RUNECRAFT = "6PAV30";
  const COND_HAS_SPACE = "TtRxLP";
  const COND_NO_SPACE = "qptQTm";
  const COND_FOLDER_NO_SPACE = "c2lR7V";
  const COND_HAS_FOLDER = "_6Lthx";
  const COND_LOST_FOLDER = "L6kB_b";
  const COND_FOLDER_ON_RAT = "DkisA2";
  const COND_PAPER_ON_RAT = "Y-C-DS";
  const COND_USED_FOLDER_ON_RAT = "QXdII1";
  const COND_READ_EMPTY_FOLDER = "QTx0ro";
  const COND_READ_PAPER = "uOJ9Jd";
  const COND_LOST_LETTER_TO_SUROK = "qvwssm";
  const COND_LETTER_NO_SPACE = "CGePP_";
  const COND_NO_LETTER = "J91fkB";
  const COND_HAS_LETTER = "931sqF";
  const COND_HAS_WAND = "tQTE1L";
  const COND_WAND_IN_BANK = "4iW4CH";
  const COND_WAND_NO_SPACE = "IelRHo";
  const COND_WAND_SPACE = "DXabfu";
  const COND_HAS_DIARY = "TvVDiA";
  const COND_NO_DIARY = "f8S0Sx";
  const COND_WAND_ON_SUROK = "LhAzRW";
  const COND_DIARY_ON_SUROK = "DyhUGq";
  const COND_NO_BRONZE_PICKAXE = "94DEdF";
  const COND_HAS_BRONZE_PICKAXE = "L6FzLy";
  const COND_NO_42_MINING = "It3z_b";
  const COND_42_MINING = "GWl36e";
  const COND_TALKED_ANNA = "Brj0EL";
  const COND_NO_15_RUNES = "kzTnNi";
  const COND_15_RUNES = "w4CP7z";
  const COND_INFUSED_ON_RAT = "VuJsV1";
  const COND_DIARY_ON_RAT = "J8y7Bj";
  const COND_LOST_INFUSED = "rCFqEp";
  const COND_SPARE_WAND = "1Uud23";
  const COND_NO_BOWL = "-hmr_B";
  const COND_HAS_BOWL = "9pz6Xf";
  const COND_LETTER_DESTROYED = "au4yB2";
  const COND_LETTER_SPACE = "hT-QmA";
  const COND_LETTER_NO_ROOM = "b69y5y";
  const COND_LETTER_DESTROYED_READ = "ku3VvI";
  const COND_ZAFF_ONE_SPACE = "rvvSum";
  const COND_ZAFF_TWO_SPACES = "6_-P3t";
  const COND_HAS_RING = "tM4ikL";
  const COND_LOST_RING = "YD6w5n";
  const COND_RING_NO_SPACE = "7ohqD8";
  const COND_RING_SPACE = "lLdK13";
  const COND_HAS_INSTRUCTIONS = "IW31Z7";
  const COND_INSTRUCTIONS_NO_SPACE = "-Ar5Ko";
  const COND_INSTRUCTIONS_SPACE = "sX3iUH";
  const COND_RING_NEAR_ZAFF = "teFD_r";
  const COND_RING_AWAY = "osSTCy";
  const COND_RING_TOO_FAR = "74PA03";
  const COND_RING_ON_SUROK = "mlSs9c";
  const COND_INSTRUCTIONS_ON_SUROK = "Q0_EIR";
  const COND_INSTRUCTIONS_ON_RAT = "-qKxFI";
  const COND_RING_ON_RAT = "NrY1wQ";
  const COND_RAT_TALK = "1iEx2D";
  const COND_KING_LOW = "n9LDe2";
  const COND_RING_TOO_SOON = "zssjAg";
  const COND_RING_SUCCESS = "N8-M5H";
  const COND_TALK_SUROK_FIGHT = "gfTK6F";
  const COND_RING_ON_SUROK_FIGHT = "bFWrLD";
  const COND_RING_SPENT = "8Iu-H7";

  // --- Action/message step ids --------------------------------------------
  const ACTION_GIVE_FOLDER = "9OiX8O";
  const ACTION_GIVE_FOLDER_AGAIN = "1zlpyj";
  const ACTION_TAKE_FOLDER = "hNHQSL";
  const ACTION_GIVE_LETTER = "PtkroE";
  const ACTION_GIVE_LETTER_AGAIN = "FIIVR6";
  const ACTION_GIVE_WAND = "fO5C1F";
  const ACTION_GIVE_DIARY = "XFp_i-";
  const ACTION_GIVE_PICKAXE = "nPRrax";
  const ACTION_DIG = "APAgLV";
  const ACTION_TELEPORT_OUT = "jqX-BV";
  const ACTION_GIVE_SUROKS_LETTER = "PepH7r";
  const ACTION_GIVE_SUROKS_LETTER_AGAIN = "pRyGCh";
  const ACTION_RAT_TAKES_LETTER = "T1DY8H";
  const ACTION_GIVE_RING = "ZpM2H-";
  const ACTION_GIVE_RING_AGAIN = "fdFTWH";
  const ACTION_GIVE_INSTRUCTIONS_AGAIN = "4w2LWG";
  const ACTION_RING_FAIL_TELEPORT = "5eaQx8";
  const ACTION_START_FIGHT = "dkELhA";
  const ACTION_KING_FREED = "GG-gcf";
  const ACTION_COMPLETE = "ZJvcFu";
  const LINE_WAND_REPLACED = "Here you are. Try not to lose this one!";
  const LINE_WAND_SPARE = "Hmph! In the meantime, here's another metal wand. Go and make another infused wand for me...and be more careful this time! My patience is growing thin!";
  const LINE_BRIEFING_DIARY = "I have also given you a copy of a diary I...uh...acquired. It may also help you to find that which you seek.";
  const LINE_RAT_SEES_LETTER = "I'm sure I don't know what you mean. Let me see the letter, please.";

  // --- Transient per-interaction context ----------------------------------
  const interaction = new WeakMap();
  /** player -> ownerOnly King Roald NPC while stage 110. */
  const fightKing = new Map();
  /** Players already told to summon Zaff in the current fight. */
  const prompted = new Set();

  let quest;
  let worldInstalled = false;

  const held = (player, itemId, amount = 1) => player.getInventory().getAmount(itemId) >= amount;
  const contextOf = (player) => interaction.get(player) || {};
  const isPlayer = (value) => typeof value?.getInventory === "function";
  /** The fight variant's random step is combat chatter, not part of the ring/arrest. */
  const dropRandomStep = (steps) => steps.filter((step) => step.type !== "random");

  function meetsRequirements(player) {
    if (player.getSkillManager().getMaxLevel(Skill.RUNECRAFTING) < RUNECRAFT_LEVEL) return false;
    const request = { player, key: RUNE_MYSTERIES_KEY, complete: false };
    api.emitCustomEvent("quest:is-complete", request);
    return request.complete === true;
  }

  function inBank(player, itemId) {
    for (let tab = 0; tab < Bank.TOTAL_BANK_TABS; tab++) {
      if (player.getBank(tab)?.contains?.(itemId)) return true;
    }
    return false;
  }

  function giveItem(player, itemId, message) {
    if (player.getInventory().getFreeSlots() < 1) {
      player.sendMessage("You need a free inventory space.");
      return false;
    }
    player.getInventory().adds(itemId, 1);
    if (message) player.sendMessage(message);
    return true;
  }

  function papersInFolder(player) {
    return Number(player.getAttribute(PAPERS_ATTRIBUTE)) || 0;
  }

  function setPapers(player, count) {
    player.setAttribute(PAPERS_ATTRIBUTE, count);
    player.getPacketSender().sendVarbit(VARBIT_FOLDER_CHECK, count);
  }

  function tunnelIsOpen(player) {
    return (Number(player.getAttribute(TUNNEL_ATTRIBUTE)) || 0) === 1;
  }

  function openTunnel(player) {
    player.setAttribute(TUNNEL_ATTRIBUTE, 1);
  }

  function hasChaosAccess(player) {
    return (
      held(player, CHAOS_TALISMAN_ITEM_ID) ||
      held(player, CHAOS_TIARA_ITEM_ID) ||
      held(player, CATALYTIC_TIARA_ITEM_ID) ||
      held(player, RUNECRAFT_CAPE_ITEM_ID)
    );
  }

  function hasFolder(player) {
    return (
      held(player, EMPTY_FOLDER_ITEM_ID) ||
      held(player, USED_FOLDER_ITEM_ID) ||
      held(player, FULL_FOLDER_ITEM_ID)
    );
  }

  function hasBankedFolder(player) {
    return [EMPTY_FOLDER_ITEM_ID, USED_FOLDER_ITEM_ID, FULL_FOLDER_ITEM_ID]
      .some((itemId) => inBank(player, itemId));
  }

  function ownsBeaconRing(player) {
    return held(player, BEACON_RING_ITEM_ID)
      || player.getEquipment().get(api.core.Equipment.RING_SLOT)?.getId?.() === BEACON_RING_ITEM_ID;
  }

  // ==========================================================================
  // Transcript variant selection
  // ==========================================================================

  function ratVariant(player, stage) {
    if (stage >= STAGE_COMPLETE) return RAT_POST_VARIANT;
    if (stage >= STAGE_KING_DEFEATED) return RAT_FINISH_VARIANT;
    if (stage >= STAGE_ZAFF_RING) return RAT_RING_VARIANT;
    if (stage >= STAGE_RAT_KNOWS) return RAT_SEE_ZAFF_VARIANT;
    if (stage >= STAGE_SUROK_LETTER) return RAT_SUROK_LETTER_VARIANT;
    if (stage >= STAGE_BRIEFED) return RAT_AFTER_LETTER_VARIANT;
    if (stage >= STAGE_FOLDER_RETURNED) return RAT_LOST_LETTER_VARIANT;
    if (stage >= STAGE_STARTED && held(player, FULL_FOLDER_ITEM_ID)) return RAT_FOLDER_HANDIN_VARIANT;
    if (stage >= STAGE_STARTED) return RAT_START_AGAIN_VARIANT;
    return RAT_START_VARIANT;
  }

  function surokVariant(player, stage) {
    if (stage >= STAGE_COMPLETE) return null; // sealed; his standard page plays
    if (stage >= STAGE_KING_DEFEATED) return SUROK_DEFEATED_TAIL_VARIANT;
    if (stage >= STAGE_FIGHT) return null; // handled by handleNpcInteraction
    if (stage >= STAGE_ZAFF_RING) return SUROK_FIGHT_START_VARIANT;
    if (stage >= STAGE_RAT_KNOWS) return SUROK_CONFRONT_VARIANT;
    if (stage >= STAGE_SUROK_LETTER) return SUROK_LETTER_VARIANT;
    if (stage >= STAGE_WAND_INFUSED) {
      return held(player, INFUSED_WAND_ITEM_ID) ? SUROK_DELIVER_VARIANT : SUROK_MISSING_VARIANT;
    }
    if (stage >= STAGE_BRIEFED) return SUROK_AGAIN_VARIANT;
    if (stage >= STAGE_FOLDER_RETURNED) return SUROK_FIRST_VARIANT;
    return null;
  }

  function zaffVariant(player, stage) {
    if (stage >= STAGE_COMPLETE) return { page: "Zaff", variant: "standard-dialogue-members-worlds" };
    if (stage >= STAGE_KING_DEFEATED && stage < STAGE_COMPLETE) return ZAFF_DEFEATED_VARIANT;
    if (stage >= STAGE_ZAFF_RING && stage < STAGE_KING_DEFEATED) return ZAFF_AGAIN_VARIANT;
    if (stage >= STAGE_RAT_KNOWS && stage < STAGE_ZAFF_RING) return ZAFF_INTRO_VARIANT;
    return null; // standard shop dialogue
  }

  function annaVariant(player, stage) {
    if (stage >= STAGE_COMPLETE) {
      return tunnelIsOpen(player) ? "after-excavating-the-statue"
        : "after-completing-what-lies-below-while-the-statue-is-intact";
    }
    if (stage >= STAGE_KING_DEFEATED || stage < STAGE_BRIEFED) return null;
    if (tunnelIsOpen(player)) {
      interaction.set(player, { annaTalk: true });
      return ANNA_EXCAVATE_VARIANT;
    }
    return ANNA_GIVE_VARIANT;
  }

  /** Which transcript variant an NPC plays, by stage (Talk-to only). */
  function selectVariant({ npcId, player }) {
    interaction.delete(player);
    const stage = quest.getStage(player);
    if (npcId === RAT_NPC_ID) return ratVariant(player, stage);
    if (SUROK_NPC_IDS.has(npcId)) return surokVariant(player, stage);
    if (ZAFF_NPC_IDS.has(npcId)) return zaffVariant(player, stage);
    if (npcId === ANNA_NPC_ID) return annaVariant(player, stage);
    return null;
  }

  // ==========================================================================
  // Prose conditions
  // ==========================================================================

  function answerCondition(event) {
    const { npcId, player, stepId } = event;
    if (!WLB_NPC_IDS.has(npcId)) return null;
    const ctx = contextOf(player);
    const stage = quest.getStage(player);
    const inventory = player.getInventory();

    switch (stepId) {
      // Rat: start and folder task.
      case COND_NO_RUNECRAFT:
        return !meetsRequirements(player);
      case COND_HAS_RUNECRAFT:
        return meetsRequirements(player);
      case COND_HAS_SPACE:
        return !inventory.isFull();
      case COND_NO_SPACE:
        return inventory.isFull();
      case COND_FOLDER_NO_SPACE:
        return !hasFolder(player) && !hasBankedFolder(player) && !inventory.isFull();
      case COND_HAS_FOLDER:
        return hasFolder(player);
      case COND_LOST_FOLDER:
        return !hasFolder(player) && !hasBankedFolder(player);
      case "hPduM1": // Zaff: already carrying the Beacon ring
        return ownsBeaconRing(player);
      case "S2p6HZ": // Zaff: the ring is banked
        return inBank(player, BEACON_RING_ITEM_ID);
      case "xgclJB": // Zaff: no room for a replacement
        return inventory.isFull();
      case COND_FOLDER_ON_RAT:
        return ctx.item === "folder-on-rat" && held(player, EMPTY_FOLDER_ITEM_ID);
      case COND_PAPER_ON_RAT:
        return ctx.item === "paper-on-rat" && held(player, PAPER_ITEM_ID);
      case COND_USED_FOLDER_ON_RAT:
        return ctx.item === "used-folder-on-rat" && held(player, USED_FOLDER_ITEM_ID);
      case COND_READ_EMPTY_FOLDER:
        return ctx.read === "empty";
      case COND_READ_PAPER:
        return ctx.read === "paper" || ctx.read === "used";

      // Rat: letters.
      case COND_LOST_LETTER_TO_SUROK:
        return stage >= STAGE_FOLDER_RETURNED && stage < STAGE_BRIEFED && !held(player, LETTER_TO_SUROK_ITEM_ID);
      case COND_LETTER_NO_SPACE:
        return inventory.isFull();

      // Surok: the first briefing.
      case COND_NO_LETTER:
        return !held(player, LETTER_TO_SUROK_ITEM_ID);
      case COND_HAS_LETTER:
        return held(player, LETTER_TO_SUROK_ITEM_ID);

      // Surok: wand/diary repeats.
      case COND_HAS_WAND:
        return held(player, WAND_ITEM_ID);
      case COND_WAND_IN_BANK:
        return inBank(player, WAND_ITEM_ID);
      case COND_WAND_NO_SPACE:
        return inventory.isFull();
      case COND_WAND_SPACE:
        return !inventory.isFull();
      case COND_HAS_DIARY:
        return held(player, DIARY_ITEM_ID);
      case COND_NO_DIARY:
        return !held(player, DIARY_ITEM_ID);
      case COND_WAND_ON_SUROK:
        return ctx.item === "wand-on-surok";
      case COND_DIARY_ON_SUROK:
        return ctx.item === "diary-on-surok";

      // Anna and the statue.
      case COND_NO_BRONZE_PICKAXE:
        return !held(player, BRONZE_PICKAXE_ITEM_ID);
      case COND_HAS_BRONZE_PICKAXE:
        return held(player, BRONZE_PICKAXE_ITEM_ID);
      case COND_NO_42_MINING:
        return false; // 42 Mining is only recommended since 9 Nov 2022
      case COND_42_MINING:
        return ctx.annaTalk !== true;
      case COND_TALKED_ANNA:
        return ctx.annaTalk === true;

      // Chaos altar.
      case COND_NO_15_RUNES:
        return ctx.infusion === "fail";
      case COND_15_RUNES:
        return ctx.infusion === "ok";

      // Infused wand / diary on Rat.
      case COND_INFUSED_ON_RAT:
        return ctx.item === "infused-on-rat";
      case COND_DIARY_ON_RAT:
        return ctx.item === "diary-on-rat";

      // Surok: delivering the materials.
      case COND_LOST_INFUSED:
        return stage >= STAGE_BRIEFED && !held(player, INFUSED_WAND_ITEM_ID);
      case COND_SPARE_WAND:
        return held(player, WAND_ITEM_ID) && held(player, INFUSED_WAND_ITEM_ID);
      case COND_NO_BOWL:
        return !held(player, BOWL_ITEM_ID);
      case COND_HAS_BOWL:
        return held(player, BOWL_ITEM_ID);

      // Surok's letter.
      case COND_LETTER_DESTROYED:
        return stage >= STAGE_SUROK_LETTER && !held(player, SUROKS_LETTER_ITEM_ID);
      case COND_LETTER_SPACE:
        return !inventory.isFull();
      case COND_LETTER_NO_ROOM:
        return inventory.isFull();
      case COND_LETTER_DESTROYED_READ:
        return false; // read/unread is not tracked

      // Zaff.
      case COND_ZAFF_ONE_SPACE:
        return inventory.getFreeSlots() < 2;
      case COND_ZAFF_TWO_SPACES:
        return inventory.getFreeSlots() >= 2;
      case COND_HAS_RING:
        return held(player, BEACON_RING_ITEM_ID);
      case COND_LOST_RING:
        return !held(player, BEACON_RING_ITEM_ID);
      case COND_RING_NO_SPACE:
        return inventory.isFull();
      case COND_RING_SPACE:
        return !inventory.isFull();
      case COND_HAS_INSTRUCTIONS:
        return held(player, INSTRUCTIONS_ITEM_ID);
      case COND_INSTRUCTIONS_NO_SPACE:
        return !held(player, INSTRUCTIONS_ITEM_ID) && inventory.isFull();
      case COND_INSTRUCTIONS_SPACE:
        return !held(player, INSTRUCTIONS_ITEM_ID) && !inventory.isFull();

      // Beacon ring.
      case COND_RING_NEAR_ZAFF:
        return ctx.ring === "near";
      case COND_RING_AWAY:
        return ctx.ring === "far";
      case COND_RING_TOO_FAR:
        return ctx.ring === "nowhere";
      case COND_RING_ON_SUROK:
        return ctx.ring === "on-surok";
      case COND_INSTRUCTIONS_ON_SUROK:
        return ctx.item === "instructions-on-surok";
      case COND_INSTRUCTIONS_ON_RAT:
        return ctx.item === "instructions-on-rat";
      case COND_RING_ON_RAT:
        return ctx.item === "ring-on-rat";
      case COND_RAT_TALK:
        return ctx.item === undefined;

      // The King Roald fight.
      case COND_KING_LOW:
        return false; // the hint is sent from the hit hook
      case COND_RING_TOO_SOON:
        return ctx.ring === "too-soon";
      case COND_RING_SUCCESS:
        return ctx.ring === "success";
      case COND_TALK_SUROK_FIGHT:
        return ctx.talkDuringFight === true;
      case COND_RING_ON_SUROK_FIGHT:
        return ctx.ring === "on-surok-during-fight";
      case COND_RING_SPENT:
        return ctx.ring === "after";

      default:
        return null;
    }
  }

  // ==========================================================================
  // Dialogue hooks, actions and lines
  // ==========================================================================

  function handleStartHook(event) {
    const { player, npcId, hook } = event;
    if (npcId !== RAT_NPC_ID || hook !== START_HOOK) return;
    if (quest.getStage(player) === 0) quest.setStage(player, STAGE_STARTED);
  }

  /** The wiki dump's help branch loops back into the small-talk menu instead of
   * reaching the acceptance choice, so stop it and ask that ourselves. */
  const START_OPTION = "Shall I get them back for you?";
  const startPrompting = new Set();

  function startQuest(player) {
    if (quest.getStage(player) !== 0) return;
    quest.setStage(player, STAGE_STARTED);
    if (!hasFolder(player)) {
      setPapers(player, 0);
      giveItem(player, EMPTY_FOLDER_ITEM_ID, "Rat Burgiss hands you an empty folder.");
    }
  }

  function handleStartChoice(event) {
    const { player, npcId, option } = event;
    if (npcId !== RAT_NPC_ID || option !== START_OPTION) return;
    if (quest.getStage(player) !== 0 || startPrompting.has(player)) return;
    startPrompting.add(player);
    const { CountdownTask, TaskManager } = api.core;
    if (!CountdownTask || !TaskManager) {
      startQuest(player);
      return;
    }
    TaskManager.submit(new CountdownTask(player, 1, () => {
      startPrompting.delete(player);
      if (player.isRegistered?.() === false || quest.getStage(player) !== 0) return;
      player.getDialogueManager()?.reset?.();
      player.getPacketSender().sendInterfaceRemoval();
      api.sendMultiChatboxPrompt(player, "Do you want to help Rat Burgiss?",
        "Yes.", () => startQuest(player),
        "No.", () => {});
    }));
  }

  function setSurokClothes(player, robed) {
    player.getPacketSender().sendVarbit(VARBIT_SUROK_CLOTHES, robed ? 1 : 0);
  }

  function startFight(player) {
    if (fightKing.has(player)) return;
    quest.setStage(player, STAGE_FIGHT);
    setSurokClothes(player, true);
    const king = api.spawnNpc({
      id: FIGHT_KING_NPC_ID,
      x: KING_SPAWN_TILE.x,
      y: KING_SPAWN_TILE.y,
      z: KING_SPAWN_TILE.z,
      owner: player,
      ownerOnly: true,
      wanderRadius: 0,
    });
    if (!king) return;
    king.__skipDefaultRespawn = true;
    fightKing.set(player, king);
    prompted.delete(player);
    king.getCombat().attack(player);
  }

  function endFight(player, retry) {
    const king = fightKing.get(player);
    if (king) {
      fightKing.delete(player);
      api.removeNpc(king);
    }
    prompted.delete(player);
    if (retry) quest.setStage(player, STAGE_ZAFF_RING);
  }

  function handleDialogueAction(event) {
    const { player, stepId } = event;
    if (!player || stepId === undefined) return;
    switch (stepId) {
      case "-qkbDJ": // Zaff's post-quest replacement ring
        if (!ZAFF_NPC_IDS.has(event.npcId) || !quest.isComplete(player)) return;
        event.handled = true;
        if (!ownsBeaconRing(player) && !inBank(player, BEACON_RING_ITEM_ID)) {
          giveItem(player, BEACON_RING_ITEM_ID);
        }
        return;
      case ACTION_GIVE_FOLDER:
      case ACTION_GIVE_FOLDER_AGAIN:
        event.handled = true;
        if (!hasFolder(player) && !hasBankedFolder(player)) {
          setPapers(player, 0);
          giveItem(player, EMPTY_FOLDER_ITEM_ID);
        }
        return;
      case ACTION_TAKE_FOLDER:
        event.handled = true;
        player.getInventory().deleteNumber(FULL_FOLDER_ITEM_ID, 1);
        if (held(player, PAPER_ITEM_ID)) {
          player.getInventory().deleteNumber(PAPER_ITEM_ID, player.getInventory().getAmount(PAPER_ITEM_ID));
        }
        setPapers(player, 0);
        if (quest.getStage(player) < STAGE_FOLDER_RETURNED) {
          quest.setStage(player, STAGE_FOLDER_RETURNED);
        }
        return;
      case ACTION_GIVE_LETTER:
      case ACTION_GIVE_LETTER_AGAIN:
        event.handled = true;
        giveItem(player, LETTER_TO_SUROK_ITEM_ID);
        return;
      case ACTION_GIVE_WAND:
        event.handled = true;
        giveBriefingItems(player);
        return;
      case ACTION_GIVE_DIARY:
        event.handled = true;
        if (giveItem(player, DIARY_ITEM_ID)) return;
        api.getItemOnGroundManager().registerLocation(
          player,
          new Item(DIARY_ITEM_ID, 1),
          player.getLocation().clone()
        );
        return;
      case ACTION_GIVE_PICKAXE:
        event.handled = true;
        giveItem(player, BRONZE_PICKAXE_ITEM_ID);
        return;
      case ACTION_DIG:
        event.handled = true;
        openTunnel(player);
        return;
      case ACTION_TELEPORT_OUT:
        event.handled = true;
        player.moveTo(new Location(VARROCK_SOUTH_TILE.x, VARROCK_SOUTH_TILE.y, VARROCK_SOUTH_TILE.z));
        return;
      case ACTION_GIVE_SUROKS_LETTER:
        event.handled = true;
        // Surok takes the infused wand and bowl before handing over his letter.
        player.getInventory().deleteNumber(INFUSED_WAND_ITEM_ID, 1);
        player.getInventory().deleteNumber(BOWL_ITEM_ID, 1);
        player.getInventory().adds(SUROKS_LETTER_ITEM_ID, 1);
        quest.setStage(player, STAGE_SUROK_LETTER);
        return;
      case ACTION_GIVE_SUROKS_LETTER_AGAIN:
        event.handled = true;
        giveItem(player, SUROKS_LETTER_ITEM_ID);
        return;
      case ACTION_RAT_TAKES_LETTER:
        event.handled = true;
        if (!held(player, SUROKS_LETTER_ITEM_ID)) return;
        player.getInventory().deleteNumber(SUROKS_LETTER_ITEM_ID, 1);
        quest.setStage(player, STAGE_RAT_KNOWS);
        return;
      case ACTION_GIVE_RING:
        event.handled = true;
        if (player.getInventory().getFreeSlots() < 2) {
          player.sendMessage("You need two free inventory spaces.");
          return;
        }
        player.getInventory().adds(BEACON_RING_ITEM_ID, 1);
        player.getInventory().adds(INSTRUCTIONS_ITEM_ID, 1);
        quest.setStage(player, STAGE_ZAFF_RING);
        return;
      case ACTION_GIVE_RING_AGAIN:
        event.handled = true;
        giveItem(player, BEACON_RING_ITEM_ID);
        return;
      case ACTION_GIVE_INSTRUCTIONS_AGAIN:
        event.handled = true;
        giveItem(player, INSTRUCTIONS_ITEM_ID);
        return;
      case ACTION_RING_FAIL_TELEPORT:
        event.handled = true;
        endFight(player, true);
        player.moveTo(new Location(ZAFF_SHOP_TILE.x, ZAFF_SHOP_TILE.y, ZAFF_SHOP_TILE.z));
        return;
      case ACTION_START_FIGHT:
        event.handled = true;
        startFight(player);
        return;
      case ACTION_KING_FREED:
        event.handled = true;
        endFight(player, false);
        if (quest.getStage(player) < STAGE_KING_DEFEATED) quest.setStage(player, STAGE_KING_DEFEATED);
        return;
      case ACTION_COMPLETE:
        event.handled = true;
        event.end = true;
        if (!quest.isComplete(player)) quest.complete(player);
        return;
      default:
        return;
    }
  }

  function giveBriefingItems(player) {
    if (player.getInventory().getFreeSlots() < 1) {
      player.sendMessage("You need a free inventory space.");
      return false;
    }
    player.getInventory().deleteNumber(LETTER_TO_SUROK_ITEM_ID, 1);
    player.getInventory().adds(WAND_ITEM_ID, 1);
    player.getInventory().adds(DIARY_ITEM_ID, 1);
    if (quest.getStage(player) < STAGE_BRIEFED) quest.setStage(player, STAGE_BRIEFED);
    return true;
  }

  function handleFolderReplacement({ player, npcId, stepId }) {
    if (npcId !== RAT_NPC_ID || stepId !== COND_FOLDER_NO_SPACE
      || hasFolder(player) || hasBankedFolder(player)) return;
    if (giveItem(player, EMPTY_FOLDER_ITEM_ID)) setPapers(player, 0);
  }

  /** Branches the wiki exports without their own action step. */
  function handleDialogueLine(event) {
    const { player, npcId, text } = event;
    if (SUROK_NPC_IDS.has(npcId)) {
      // "Is it a BIG secret?" reaches the same hand-out line as "Go on, then!".
      if (text === LINE_BRIEFING_DIARY) {
        const stage = quest.getStage(player);
        if (stage >= STAGE_FOLDER_RETURNED && stage < STAGE_BRIEFED) giveBriefingItems(player);
        return;
      }
      if (text !== LINE_WAND_REPLACED && text !== LINE_WAND_SPARE) return;
      if (held(player, WAND_ITEM_ID) || held(player, INFUSED_WAND_ITEM_ID)) return;
      if (player.getInventory().getFreeSlots() < 1) return;
      player.getInventory().adds(WAND_ITEM_ID, 1);
      return;
    }
    // The accusatory answer to Rat takes the letter without a wiki action step.
    if (npcId === RAT_NPC_ID && text === LINE_RAT_SEES_LETTER) {
      const stage = quest.getStage(player);
      if (stage < STAGE_SUROK_LETTER || stage >= STAGE_RAT_KNOWS) return;
      if (!held(player, SUROKS_LETTER_ITEM_ID)) return;
      player.getInventory().deleteNumber(SUROKS_LETTER_ITEM_ID, 1);
      quest.setStage(player, STAGE_RAT_KNOWS);
    }
  }

  /** Surok's Talk-to during the fight: the glazed-over hint, without King Roald's shouts. */
  function handleNpcInteraction(event) {
    const { player, npcId } = event;
    if (!SUROK_NPC_IDS.has(npcId) || quest.getStage(player) !== STAGE_FIGHT) return;
    const click = Number(event.clickType) | 0;
    const option = String(event.definition?.getActions?.()?.[click - 1] ?? "").toLowerCase();
    if (option !== "talk-to") return;
    event.handled = true;
    interaction.set(player, { talkDuringFight: true });
    startTranscript(api, player, npcId, PAGE, FIGHT_VARIANT, dropRandomStep);
  }

  // ==========================================================================
  // Item interactions
  // ==========================================================================

  function usePaperOnFolder(player, paperFirst) {
    const folderPage = papersInFolder(player) === PAPERS_NEEDED - 1 ? "last" : "more";
    if (folderPage === "last") {
      player.getInventory().deleteNumber(PAPER_ITEM_ID, 1);
      player.getInventory().deleteNumber(USED_FOLDER_ITEM_ID, 1);
      player.getInventory().adds(FULL_FOLDER_ITEM_ID, 1);
      setPapers(player, PAPERS_NEEDED);
      player.sendMessage("You add the last page to Rat's folder. You should take this back to Rat as soon as possible.");
      player.sendMessage("You have added all the pages to the folder that Rat gave to you. You should take this folder back to Rat.");
      return;
    }
    player.getInventory().deleteNumber(PAPER_ITEM_ID, 1);
    if (paperFirst) {
      player.getInventory().deleteNumber(EMPTY_FOLDER_ITEM_ID, 1);
      player.getInventory().adds(USED_FOLDER_ITEM_ID, 1);
    }
    const count = papersInFolder(player) + 1;
    setPapers(player, count);
    player.sendMessage("You add the page to the folder that Rat gave you.");
    const remaining = PAPERS_NEEDED - count;
    player.sendMessage(`You need to find ${remaining} more page${remaining === 1 ? "" : "s"}.`);
  }

  function handleItemOnItem(event) {
    const { player, usedItemId, usedWithItemId } = event;
    const pair = new Set([usedItemId, usedWithItemId]);
    if (!pair.has(PAPER_ITEM_ID)) return;
    const folderId = usedItemId === PAPER_ITEM_ID ? usedWithItemId : usedItemId;
    if (folderId !== EMPTY_FOLDER_ITEM_ID && folderId !== USED_FOLDER_ITEM_ID) return;
    event.handled = true;
    if (quest.isComplete(player)) return;
    if (papersInFolder(player) >= PAPERS_NEEDED) return;
    usePaperOnFolder(player, folderId === EMPTY_FOLDER_ITEM_ID);
  }

  function handleItemOnObject(event) {
    const { player, itemId, objectId } = event;
    if (itemId !== WAND_ITEM_ID || objectId !== CHAOS_ALTAR_OBJECT_ID) return;
    event.handled = true;
    if (quest.getStage(player) < STAGE_BRIEFED) return;
    const enough = player.getInventory().getAmount(CHAOS_RUNE_ITEM_ID) >= RUNES_NEEDED;
    interaction.set(player, { infusion: enough ? "ok" : "fail" });
    if (enough) {
      player.getInventory().deleteNumber(CHAOS_RUNE_ITEM_ID, RUNES_NEEDED);
      player.getInventory().deleteNumber(WAND_ITEM_ID, 1);
      player.getInventory().adds(INFUSED_WAND_ITEM_ID, 1);
      if (quest.getStage(player) < STAGE_WAND_INFUSED) quest.setStage(player, STAGE_WAND_INFUSED);
    }
    startTranscript(api, player, SUROK_NPC_ID, PAGE, INFUSE_VARIANT);
  }

  function startRatVariant(player, variant, context, select) {
    interaction.set(player, context);
    startTranscript(api, player, RAT_NPC_ID, PAGE, variant, select);
  }

  function handleItemOnNpc(event) {
    const { player, itemId, npcId } = event;
    if (npcId === RAT_NPC_ID) return ratItemInteraction(event);
    if (SUROK_NPC_IDS.has(npcId)) return surokItemInteraction(event);
    if (KING_ROALD_NPC_IDS.has(npcId) && itemId === SUROKS_LETTER_ITEM_ID) {
      event.handled = true;
      interaction.set(player, {});
      startTranscript(api, player, npcId, PAGE, KING_LETTER_VARIANT);
    }
  }

  function ratItemInteraction(event) {
    const { player, itemId } = event;
    if (itemId === PAPER_ITEM_ID) {
      event.handled = true;
      startRatVariant(player, RAT_PAPERS_VARIANT, { item: "paper-on-rat" });
      return;
    }
    if (itemId === EMPTY_FOLDER_ITEM_ID) {
      event.handled = true;
      startRatVariant(player, RAT_START_AGAIN_VARIANT, { item: "folder-on-rat" }, (steps) =>
        steps.filter((step) => step.id === COND_FOLDER_ON_RAT)
      );
      return;
    }
    if (itemId === USED_FOLDER_ITEM_ID) {
      event.handled = true;
      startRatVariant(player, RAT_PAPERS_VARIANT, { item: "used-folder-on-rat" });
      return;
    }
    if (itemId === INFUSED_WAND_ITEM_ID) {
      event.handled = true;
      startRatVariant(player, INFUSED_ON_RAT_VARIANT, { item: "infused-on-rat" });
      return;
    }
    if (itemId === DIARY_ITEM_ID) {
      event.handled = true;
      startRatVariant(player, INFUSED_ON_RAT_VARIANT, { item: "diary-on-rat" });
      return;
    }
    if (itemId === INSTRUCTIONS_ITEM_ID) {
      event.handled = true;
      startRatVariant(player, RAT_RING_VARIANT, { item: "instructions-on-rat" });
      return;
    }
    if (itemId === BEACON_RING_ITEM_ID) {
      event.handled = true;
      startRatVariant(player, RAT_RING_VARIANT, { item: "ring-on-rat" });
    }
  }

  function surokItemInteraction(event) {
    const { player, itemId } = event;
    if (itemId === WAND_ITEM_ID) {
      event.handled = true;
      interaction.set(player, { item: "wand-on-surok" });
      startTranscript(api, player, SUROK_NPC_ID, PAGE, SUROK_ITEM_VARIANT);
      return;
    }
    if (itemId === DIARY_ITEM_ID) {
      event.handled = true;
      interaction.set(player, { item: "diary-on-surok" });
      startTranscript(api, player, SUROK_NPC_ID, PAGE, SUROK_ITEM_VARIANT);
      return;
    }
    if (itemId === INSTRUCTIONS_ITEM_ID) {
      event.handled = true;
      interaction.set(player, { item: "instructions-on-surok" });
      startTranscript(api, player, ZAFF_NPC_ID, PAGE, ZAFF_INSTRUCTIONS_VARIANT);
      return;
    }
    if (itemId !== BEACON_RING_ITEM_ID) return;
    event.handled = true;
    const stage = quest.getStage(player);
    if (stage >= STAGE_KING_DEFEATED) {
      interaction.set(player, { ring: "after" });
      startTranscript(api, player, ZAFF_NPC_ID, PAGE, RING_SPENT_VARIANT);
      return;
    }
    if (stage >= STAGE_FIGHT) {
      interaction.set(player, { ring: "on-surok-during-fight" });
      startTranscript(api, player, ZAFF_NPC_ID, PAGE, FIGHT_VARIANT, dropRandomStep);
      return;
    }
    interaction.set(player, { ring: "on-surok" });
    startTranscript(api, player, ZAFF_NPC_ID, PAGE, ZAFF_RING_VARIANT);
  }

  // ==========================================================================
  // Beacon ring
  // ==========================================================================

  function operateRing(event) {
    const { player } = event;
    event.handled = true;
    const stage = quest.getStage(player);
    if (stage >= STAGE_KING_DEFEATED) {
      interaction.set(player, { ring: "after" });
      startTranscript(api, player, ZAFF_NPC_ID, PAGE, RING_SPENT_VARIANT);
      return;
    }
    if (stage >= STAGE_FIGHT) {
      const king = fightKing.get(player);
      const alive = king && king.getHitpoints() > 0;
      interaction.set(player, { ring: alive && king.getHitpoints() < LOW_KING_HITPOINTS ? "success" : "too-soon" });
      startTranscript(api, player, ZAFF_NPC_ID, PAGE, FIGHT_VARIANT, dropRandomStep);
      return;
    }
    const location = player.getLocation();
    const dx = Math.abs(location.getX() - VARROCK_CENTRE.x);
    const dy = Math.abs(location.getY() - VARROCK_CENTRE.y);
    const zaffDx = Math.abs(location.getX() - ZAFF_SHOP_TILE.x);
    const zaffDy = Math.abs(location.getY() - ZAFF_SHOP_TILE.y);
    let ring;
    if (location.getZ() !== 0 || Math.max(dx, dy) > RING_FAR_BLOCKS) ring = "nowhere";
    else if (Math.max(zaffDx, zaffDy) <= RING_ZAFF_RANGE) ring = "near";
    else ring = "far";
    interaction.set(player, { ring });
    startTranscript(api, player, ZAFF_NPC_ID, PAGE, ZAFF_RING_VARIANT);
  }

  function handleItemAction(event) {
    const { player, itemId, option } = event;
    if (itemId === BEACON_RING_ITEM_ID && String(option).toLowerCase() === "operate") {
      operateRing(event);
      return;
    }
    if (String(option).toLowerCase() !== "read") return;
    if (itemId === EMPTY_FOLDER_ITEM_ID) {
      event.handled = true;
      interaction.set(player, { read: "empty" });
      startTranscript(api, player, RAT_NPC_ID, PAGE, "collecting-the-pages-reading-the-documents");
      return;
    }
    if (itemId === USED_FOLDER_ITEM_ID || itemId === FULL_FOLDER_ITEM_ID || itemId === PAPER_ITEM_ID) {
      event.handled = true;
      interaction.set(player, { read: "paper" });
      startTranscript(api, player, RAT_NPC_ID, PAGE, "collecting-the-pages-reading-the-documents");
      return;
    }
    if (itemId === DIARY_ITEM_ID) {
      event.handled = true;
      player.sendMessage(
        "Beneath the arrogant caricature of this worthless deity lies the entrance to our most sacred work yet: the Tunnel of Chaos."
      );
    }
  }

  // ==========================================================================
  // Object interactions
  // ==========================================================================

  function handleObjectInteraction(event) {
    const { player, objectId } = event;
    if (objectId === STATUE_OBJECT_ID) {
      event.handled = true;
      handleStatueExcavate(player);
      return;
    }
    if (objectId === TUNNEL_PORTAL_OBJECT_ID) {
      event.handled = true;
      handleTunnelPortal(player);
    }
  }

  function handleStatueExcavate(player) {
    if (tunnelIsOpen(player)) {
      player.moveTo(new Location(TUNNEL_ENTRY_TILE.x, TUNNEL_ENTRY_TILE.y, TUNNEL_ENTRY_TILE.z));
      return;
    }
    const stage = quest.getStage(player);
    if (stage < STAGE_BRIEFED || quest.isComplete(player)) {
      startTranscript(api, player, ANNA_NPC_ID, PAGE, ANNA_STOP_VARIANT);
      return;
    }
    if (!held(player, BRONZE_PICKAXE_ITEM_ID)) {
      startTranscript(api, player, ANNA_NPC_ID, PAGE, ANNA_STOP_VARIANT);
      return;
    }
    interaction.set(player, { excavate: true });
    startTranscript(api, player, ANNA_NPC_ID, PAGE, ANNA_EXCAVATE_VARIANT);
  }

  function handleTunnelPortal(player) {
    if (!hasChaosAccess(player)) {
      player.sendMessage("You need a chaos talisman or a chaos tiara to pass through this portal.");
      return;
    }
    player.moveTo(new Location(CHAOS_MAZE_TILE.x, CHAOS_MAZE_TILE.y, CHAOS_MAZE_TILE.z));
  }

  // ==========================================================================
  // Outlaw drops and the King Roald fight
  // ==========================================================================

  function handleNpcDeath(event) {
    const { killer, npc, npcId } = event;
    if (OUTLAW_NPC_IDS.has(npcId)) {
      if (!isPlayer(killer) || !npc) return;
      const stage = quest.getStage(killer);
      if (stage < STAGE_STARTED || stage >= STAGE_FOLDER_RETURNED) return;
      const heldPapers = killer.getInventory().getAmount(PAPER_ITEM_ID);
      if (papersInFolder(killer) + heldPapers >= PAPERS_NEEDED) return;
      const location = npc.getLocation?.() ?? npc.getSpawnLocation?.();
      if (!location) return;
      api.getItemOnGroundManager().registerLocation(killer, new Item(PAPER_ITEM_ID, 1), location);
      return;
    }
    if (npcId !== FIGHT_KING_NPC_ID || !npc) return;
    for (const [player, king] of fightKing) {
      if (king !== npc) continue;
      endFight(player, true);
      return;
    }
  }

  function fightOwnerOf(npc) {
    for (const [player, king] of fightKing) {
      if (king === npc) return player;
    }
    return null;
  }

  function handleNpcBeforeDeath(event) {
    const owner = fightOwnerOf(event.npc);
    if (!owner || quest.getStage(owner) !== STAGE_FIGHT) return;
    // The King must survive until Zaff cures him.
    event.preventDeath = true;
    event.npc.setHitpoints(KING_REVIVE_HITPOINTS);
    if (!prompted.has(owner)) {
      prompted.add(owner);
      owner.sendMessage("Now would be a good time to summon Zaff!");
    }
  }

  function handleNpcHitModify(event) {
    const owner = fightOwnerOf(event.npc);
    if (!owner || quest.getStage(owner) !== STAGE_FIGHT || prompted.has(owner)) return;
    const damage = event.hit?.getTotalDamage?.() ?? 0;
    if (event.npc.getHitpoints() - damage >= LOW_KING_HITPOINTS) return;
    prompted.add(owner);
    owner.sendMessage("Now would be a good time to summon Zaff!");
  }

  // ==========================================================================
  // Login / world setup
  // ==========================================================================

  function ensureQuestSpawns() {
    const npcs = api.getWorld()?.getNpcs ? [...api.getWorld().getNpcs()] : [];
    const ids = new Set(npcs.map((npc) => npc?.getId?.()));
    if (!ids.has(SUROK_NPC_ID)) {
      api.spawnNpc({
        id: SUROK_NPC_ID,
        x: SUROK_TILE.x,
        y: SUROK_TILE.y,
        z: SUROK_TILE.z,
        wanderRadius: 0,
      });
    }
  }

  function installWorld() {
    if (worldInstalled) return;
    worldInstalled = true;
    const statue = new GameObject(
      STATUE_OBJECT_ID,
      new Location(STATUE_TILE.x, STATUE_TILE.y, STATUE_TILE.z),
      STATUE_TYPE,
      STATUE_FACE,
      null
    );
    api.getObjectManager().register(statue, true);
    ensureQuestSpawns();
  }

  function handleLogin({ player }) {
    installWorld();
    player.getPacketSender().sendVarbit(VARBIT_FOLDER_CHECK, papersInFolder(player));
    setSurokClothes(player, quest.getStage(player) >= STAGE_FIGHT && quest.getStage(player) < STAGE_COMPLETE);
  }

  function handleLogout({ player }) {
    if (fightKing.has(player)) endFight(player, true);
  }

  function handlePlayerDeath({ player }) {
    if (fightKing.has(player)) endFight(player, true);
  }

  function grantRewards(player) {
    player.getSkillManager().addExperiences(Skill.RUNECRAFTING, 8000);
    player.getSkillManager().addExperiences(Skill.DEFENCE, 2000);
  }

  // ==========================================================================
  // Journal
  // ==========================================================================

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    const prefaced = stage > 0;
    if (stage >= STAGE_COMPLETE) {
      return [
        "<str>Rat Burgiss asked me to recover his papers from the outlaws.</str>",
        "<str>I delivered his letter to Surok and infused the wand at the Chaos Altar.</str>",
        "<str>With Zaff's help I freed King Roald and sealed Surok in the library.</str>",
        "",
        "<col=ff0000>QUEST COMPLETE!</col>",
      ];
    }
    if (stage >= STAGE_KING_DEFEATED) {
      return [
        "<str>Rat Burgiss asked me to recover his papers from the outlaws.</str>",
        "<str>Zaff and I saved King Roald and dealt with Surok.</str>",
        "",
        "I should report back to <col=800000>Rat Burgiss</col> for my reward.",
      ];
    }
    if (stage >= STAGE_FIGHT) {
      return [
        "<str>Rat Burgiss asked me to recover his papers from the outlaws.</str>",
        "The King is under Surok's mind control! When he is weak I must",
        "operate <col=800000>Zaff's beacon ring</col> to summon him.",
      ];
    }
    if (stage >= STAGE_ZAFF_RING) {
      return [
        prefaced ? "<str>Rat Burgiss asked me to recover his papers from the outlaws.</str>" : "",
        "I have <col=800000>Zaff's instructions</col> and his <col=800000>beacon ring</col>.",
        "I must weaken <col=800000>King Roald</col> in the palace library, then",
        "operate the ring when he is near death.",
      ];
    }
    if (stage >= STAGE_RAT_KNOWS) {
      return [
        prefaced ? "<str>Rat Burgiss asked me to recover his papers from the outlaws.</str>" : "",
        "Rat revealed he leads the Varrock Palace Secret Guard.",
        "",
        "I should visit <col=800000>Zaff</col> at his staff shop in Varrock.",
      ];
    }
    if (stage >= STAGE_SUROK_LETTER) {
      return [
        prefaced ? "<str>Rat Burgiss asked me to recover his papers from the outlaws.</str>" : "",
        "<str>I infused the wand at the Chaos Altar.</str>",
        "",
        "Surok gave me a <col=800000>letter</col> for Rat Burgiss south of Varrock.",
      ];
    }
    if (stage >= STAGE_WAND_INFUSED) {
      return [
        prefaced ? "<str>Rat Burgiss asked me to recover his papers from the outlaws.</str>" : "",
        "Surok gave me a <col=800000>wand</col> and <col=800000>Sin'keth's diary</col>.",
        "",
        "I need to bring the <col=800000>infused wand</col> and an",
        "<col=800000>empty bowl</col> back to Surok.",
      ];
    }
    if (stage >= STAGE_BRIEFED) {
      return [
        prefaced ? "<str>Rat Burgiss asked me to recover his papers from the outlaws.</str>" : "",
        "Surok gave me a <col=800000>wand</col> and <col=800000>Sin'keth's diary</col>.",
        "",
        "I need to use the wand on the <col=800000>Chaos Altar</col> with",
        "15 <col=800000>chaos runes</col> in my inventory.",
      ];
    }
    if (stage >= STAGE_FOLDER_RETURNED) {
      return [
        prefaced ? "<str>Rat Burgiss asked me to recover his papers from the outlaws.</str>" : "",
        "",
        "I should take <col=800000>Rat's letter</col> to <col=800000>Surok Magis</col>",
        "in the <col=800000>Varrock Palace Library</col>.",
      ];
    }
    if (stage >= STAGE_STARTED) {
      const collected = papersInFolder(player);
      return [
        prefaced ? "<str>Rat Burgiss asked me to recover his papers.</str>" : "",
        "",
        "I need to kill <col=800000>outlaws</col> in their camp north-west of",
        "Varrock and put the pages they drop into <col=800000>Rat's folder</col>.",
        `I have collected ${collected}/${PAPERS_NEEDED} pages.`,
      ];
    }
    return [
      "I can start this quest by talking to <col=800000>Rat Burgiss</col>,",
      "stranded south of <col=800000>Varrock</col>.",
      "",
      "I need level 35 Runecraft and to have completed <col=800000>Rune</col>",
      "<col=800000>Mysteries</col>.",
    ];
  }

  // ==========================================================================
  // Registration
  // ==========================================================================

  quest = registerQuest(api, {
    key: "what_lies_below",
    name: "What Lies Below",
    varpId: VARP_SUROK_MAIN,
    varbitId: VARBIT_SUROK_QUEST,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    // Script 4024 reads varbit 3523 for quest 159; script 4029 completes at the
    // cache's DB threshold 150, so the final stage must go on the wire as 150.
    varbitValue: (stage) => (stage >= STAGE_COMPLETE ? VARBIT_COMPLETE : stage),
    questPoints: 1,
    xpRewards: [
      { skillId: Skill.RUNECRAFTING.getIndex(), amount: 8000, label: "Runecraft" },
      { skillId: Skill.DEFENCE.getIndex(), amount: 2000, label: "Defence" },
    ],
    scrollItemId: BEACON_RING_ITEM_ID,
    otherRewards: ["Access to the Chaos Altar shortcut", "5 Battlestaves in Zaff's store"],
    buildJournal,
    onReward: grantRewards,
  });

  api.persistAttribute(PAPERS_ATTRIBUTE);
  api.persistAttribute(TUNNEL_ATTRIBUTE);

  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onNpcInteraction(handleNpcInteraction);
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("npc-dialogue:choice", handleStartChoice);
  api.onCustomEvent("npc-dialogue:action", handleDialogueAction);
  api.onCustomEvent("npc-dialogue:condition", handleFolderReplacement);
  api.onCustomEvent("npc-dialogue:line", handleDialogueLine);
  api.onItemOnItem(handleItemOnItem);
  api.onItemOnObject(handleItemOnObject, { noted: false });
  api.onItemOnNpc(handleItemOnNpc);
  api.onItemAction(handleItemAction);
  api.onObjectInteraction(handleObjectInteraction);
  api.onNpcDeath(handleNpcDeath);
  api.onNpcBeforeDeath(handleNpcBeforeDeath);
  api.onNpcHitModify(handleNpcHitModify);
  api.onPlayerLogin(handleLogin);
  api.onPlayerLogout(handleLogout);
  api.onPlayerDeath(handlePlayerDeath);
};
