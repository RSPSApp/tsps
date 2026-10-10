/**
 * Fallen From Grace (members).
 *
 * The words come from the "Fallen From Grace" transcript page ("Fallen From Grace" in
 * npc-dialogues.json). This plugin supplies the variant selector for Cormac, Muriel and
 * Mortimer, the start hook, the prose-condition answers, and the quest's object/item/NPC
 * interactions.
 *
 * Stages (varp 5715 "ffg_primary", varbit 15759 "ffg", bits 0-6): 0 not started, 1 started
 * (Cormac), 2 told to see Muriel, 5 found the notebook, 6 mined sunstone, 7 chiselled the
 * core, 8 found the hat, 9 told Muriel about the hat, 10 Cormac explained the Mad Angel,
 * 11 asked Cormac again before the cavern, 12 entered the cavern, 13 three trolls dead,
 * 14 took the dull golem core, 15 powered the golem, 16 climbed into the cathedral,
 * 17 Mad Angel dead, 18 inspected Keenan's body, 20 complete.
 *
 * The values are pinned by the cache's own multilocs, which read varbit 15759 directly:
 * ffg_dust shows 5-9 (the trail after the notebook), ffg_fake_rocks_1/2 clear at 12+,
 * slayer_master_mortimer and the powered golem appear at 12+/15+, ffg_corpse_keenan and
 * mad_angel_cathedral show 16-19, and 20 is the finished state the Wyrmscraig plugin's
 * OpenAccess used to fake. The per-step flags live in the sibling varbits 15760-15773
 * (ffg_met_cormac .. ffg_found_body) and are mirrored from a persisted bitfield.
 *
 * Source: https://oldschool.runescape.wiki/w/Fallen_From_Grace and
 * https://oldschool.runescape.wiki/w/Fallen_From_Grace/Quick_guide
 * Rewards per the wiki: 2 Quest points, 10,000 Crafting, 12,500 Sailing, 5,000 Mining and
 * 5,000 Runecraft XP; the final letter is taken back on completion.
 *
 * Gaps/approximations:
 * - Requirements (62 Sailing, 60 Crafting, 47 Runecraft, 53 Mining and Pandemonium) are
 *   not enforced: the wiki's start choice carries no condition to answer. They are listed
 *   in the not-started journal.
 * - The cathedral fight uses the MadAngel plugin's per-player Ardeaglais instance, opened
 *   from the basement stairs: the world's ffg multi-NPC (16320 -> 16321/16322 and
 *   16313 -> 16315/16314) has no Attack option on the quest angel, so the player wakes the
 *   dormant instance angel as in the post-quest encounter. The decorative world angel
 *   stays for stages 16-19, as the cache's multiloc dictates.
 * - The "attempting to leave the cathedral" lock puzzle and the "firmly locked" front-door
 *   line are not implemented: the shared MadAngel plugin owns Cathedral door 62368/62369
 *   and its hook wins before this plugin's.
 * - The large hat and worn journal are registered per player as private ground items
 *   while the quest is in progress; private floor items despawn after ~5 minutes, so
 *   leaving and re-entering the area re-ensures them (as does logging in). The
 *   pre-start "Someone's left their hat here" flavour is therefore not shown.
 * - The monolith's Inspect is folded into its only cache option, Mine; the first Mine
 *   after Muriel plays the inspect transcript and hands over the notebook.
 * - The "three nearby trolls" are counted among the cavern's generic mountain trolls
 *   (id 936) near Mortimer rather than dedicated quest spawns.
 * - The book/note/letter "Read" actions print a one-line summary of the wiki text rather
 *   than the full multi-page interface.
 */
module.exports = function registerFallenFromGraceQuest(api) {
  const { Item, ItemIdentifiers, Location, NpcIdentifiers, ObjectIdentifiers, Skill } =
    api.core;
  const { registerQuest, refreshQuestList, startTranscript } = require("../QuestRuntime");
  const mining = require("../../skills/Mining.plugin.js");
  const MadAngelCommon = require("../../bosses/madangel/Common.MadAngel");
  const MadAngelInstance = require("../../bosses/madangel/Instance.MadAngel");

  const PAGE = "Fallen From Grace";
  const START_HOOK = "quest:fallen-from-grace:start";

  const VARP_FALLEN_FROM_GRACE = 5715; // "ffg_primary"
  const VARBIT_STAGE = 15759; // "ffg", bits 0-6
  const WYRMS_BANK_CHEST_VARBIT = 15774; // "amenity_bankchest_wyrmscraig"
  const STAGE_STARTED = 1;
  const STAGE_MURIEL = 2;
  const STAGE_NOTEBOOK = 5;
  const STAGE_SUNSTONE = 6;
  const STAGE_CORE = 7;
  const STAGE_HAT = 8;
  const STAGE_MURIEL_HAT = 9;
  const STAGE_CORMAC_PLAN = 10;
  const STAGE_CORMAC_BYPASS = 11;
  const STAGE_CAVERN = 12;
  const STAGE_TROLLS = 13;
  const STAGE_GOLEM = 14;
  const STAGE_GOLEM_POWERED = 15;
  const STAGE_CATHEDRAL = 16;
  const STAGE_ANGEL_DEAD = 17;
  const STAGE_BODY = 18;
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

  const CORMAC_NPC_ID = NpcIdentifiers.CORMAC; // 16318
  const MURIEL_NPC_ID = NpcIdentifiers.MURIEL; // 16319
  const MORTIMER_NPC_IDS = new Set([
    NpcIdentifiers.MORTIMER, // 16175
    NpcIdentifiers.MORTIMER_2, // 16294
  ]);
  const BROKEN_GOLEM_NPC_ID = NpcIdentifiers.BROKEN_GOLEM; // 16321
  const TROLL_NPC_IDS = new Set([
    NpcIdentifiers.MOUNTAIN_TROLL, // 936, the cavern's generic trolls
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
  const CREVICE_OBJECT_ID = ObjectIdentifiers.CREVICE_57; // 62257 Squeeze-through
  // ffg_corpse_keenan (no identifier: the raw multi-loc is named "null" and resolves to
  // BODY_3 62375); interactions carry the raw id.
  const CATHEDRAL_CORPSE_OBJECT_ID = 62374;

  const HAT_TILE = new Location(2556, 2198, 0); // wiki map pin, south-west tip
  const JOURNAL_TILE = new Location(2568, 8660, 0); // table beside the basement chest
  const WARNING_NOTE_TILE = new Location(2575, 8657, 0); // floor by the stairs
  const BASEMENT_TILE = new Location(2575, 8657, 0); // landing of the cathedral stairs
  const CREVICE_X = 2573;
  const CREVICE_WALL_Y = 8654;
  const CREVICE_NORTH_Y = 8652;
  const CREVICE_SOUTH_Y = 8656;

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
  const CHEST_FOUND_BOTH_MESSAGE_ID = "F1HVbQ";
  const CHEST_FOUND_CORE_ONLY_MESSAGE_ID = "-XoYUm";
  const CHEST_FOUND_BOOK_MESSAGE_ID = "R8mrvW";
  const CHEST_FOUND_CORE_MESSAGE_ID = "YK7fFz";
  const CORE_BROKEN_MESSAGE_ID = "_I7d-k";
  const ROCKS_CLEARED_MESSAGE_ID = "cTymol";
  const BODY_FOUND_MESSAGE_ID = "r_JYqP";
  const CORMAC_CRYSTAL_MESSAGE_ID = "IjKWK4";
  const QUEST_COMPLETE_ACTION_ID = "gYcOjH";
  const OUR_MESSAGE_IDS = new Set([
    MONOLITH_TAKE_MESSAGE_ID,
    CHEST_FOUND_BOTH_MESSAGE_ID,
    CHEST_FOUND_CORE_ONLY_MESSAGE_ID,
    CHEST_FOUND_BOOK_MESSAGE_ID,
    CHEST_FOUND_CORE_MESSAGE_ID,
    CORE_BROKEN_MESSAGE_ID,
    ROCKS_CLEARED_MESSAGE_ID,
    BODY_FOUND_MESSAGE_ID,
    CORMAC_CRYSTAL_MESSAGE_ID,
  ]);

  const READ_MESSAGES = new Map([
    [SCRAWLED_NOTEBOOK_ITEM_ID, "An almost scientific observation on sunstone: Keenan felt the monolith was watching him."],
    [GOLEM_PRIMER_ITEM_ID, "A dusty primer on crafting golems out of sunstone."],
    [WARNING_NOTE_ITEM_ID, "Elessia had herself imprisoned in the cathedral. A substitution cipher is scrawled on the back."],
    [OBSERVATIONS_ITEM_ID, "A delicate book on Elessia, the Mad Angel who once led the first settlers here."],
    [FINAL_LETTER_ITEM_ID, "Elessia's final letter: she has left the island and left a golem in her place."],
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
    const sender = player.getPacketSender();
    const value = flags(player);
    for (const [bit, varbitId] of FLAG_VARBITS) {
      sender.sendVarbit(varbitId, (value & bit) !== 0 ? 1 : 0);
    }
  }

  function held(player, itemId) {
    return player.getInventory().getAmount(itemId) > 0;
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
    manager.registerLocation(player, new Item(itemId, 1), tile);
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
    if (stage <= STAGE_STARTED) return "starting-the-quest-talking-to-cormac-after-starting-the-quest";
    if (stage <= 4) return "following-the-trail-talking-to-cormac-after-muriel";
    if (stage <= STAGE_CORE) return "following-the-trail-talking-to-cormac-after-finding-the-notebook";
    if (stage <= STAGE_MURIEL_HAT) {
      // The hat leads Cormac to explain the Mad Angel; the plan is now known.
      quest.setStage(player, STAGE_CORMAC_PLAN);
      return "the-way-under-ardeaglais-talking-to-cormac";
    }
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
    if (stage <= STAGE_STARTED) {
      quest.setStage(player, STAGE_MURIEL);
      return "following-the-trail-talking-to-muriel";
    }
    if (stage <= 4) return "following-the-trail-talking-to-muriel-again";
    if (stage <= STAGE_CORE) return "following-the-trail-talking-to-muriel-after-finding-the-notebook";
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
    if (stage === STAGE_CAVERN) {
      if (!hasFlag(player, FLAG_MORTIMER_INTRO)) {
        setFlag(player, FLAG_MORTIMER_INTRO);
        return "the-way-under-ardeaglais-meeting-mortimer";
      }
      return "the-way-under-ardeaglais-talking-to-mortimer-before-killing-the-trolls";
    }
    if (stage === STAGE_TROLLS) {
      return "the-way-under-ardeaglais-talking-to-mortimer-after-killing-the-trolls";
    }
    return { page: "Mortimer", variant: "standard-dialogue" };
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

  function handleStartHook({ player, npcId, hook }) {
    if (npcId !== CORMAC_NPC_ID || hook !== START_HOOK) return;
    setFlag(player, FLAG_MET_CORMAC);
    quest.setStage(player, STAGE_STARTED);
    ensureHat(player);
  }

  /** Branch side effects, keyed on the chosen condition step. */
  function handleDialogueCondition({ player, stepId }) {
    if (stepId !== GOLEM_SPACE_CONDITION_ID) return;
    if (quest.getStage(player) !== STAGE_TROLLS) return;
    if (!give(player, DULL_SUNSTONE_CORE_ITEM_ID)) return;
    quest.setStage(player, STAGE_GOLEM);
  }

  /**
   * Message/action side effects. Message steps are left unhandled so the wiki line
   * still prints; only the final quest-complete action takes over the chatbox.
   */
  function handleDialogueAction(event) {
    const { player, stepId } = event;
    if (stepId === QUEST_COMPLETE_ACTION_ID) {
      if (quest.getStage(player) < STAGE_BODY) return;
      event.handled = true;
      event.end = true;
      quest.complete(player);
      return;
    }
    if (!OUR_MESSAGE_IDS.has(stepId)) return;
    switch (stepId) {
      case MONOLITH_TAKE_MESSAGE_ID:
        if (quest.getStage(player) !== STAGE_MURIEL) return;
        if (player.getInventory().isFull()) return;
        if (give(player, SCRAWLED_NOTEBOOK_ITEM_ID)) {
          setFlag(player, FLAG_KEENANS_BOOK);
          quest.setStage(player, STAGE_NOTEBOOK);
        }
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
        return;
      case ROCKS_CLEARED_MESSAGE_ID:
        setFlag(player, FLAG_TROLLS_KILLED);
        if (quest.getStage(player) === STAGE_TROLLS) quest.setStage(player, STAGE_GOLEM);
        return;
      case BODY_FOUND_MESSAGE_ID:
        if (quest.getStage(player) !== STAGE_ANGEL_DEAD) return;
        give(player, FINAL_LETTER_ITEM_ID);
        setFlag(player, FLAG_FOUND_BODY);
        quest.setStage(player, STAGE_BODY);
        return;
      case CORMAC_CRYSTAL_MESSAGE_ID:
        give(player, SUNSTONE_CRYSTAL_ITEM_ID);
        return;
      default:
    }
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
    player.performAnimation(pickaxe.animation);
    if (!give(player, SUNSTONE_ITEM_ID)) return true;
    player.sendMessage("You chip a piece of sunstone from the monolith.");
    if (stage === STAGE_NOTEBOOK) quest.setStage(player, STAGE_SUNSTONE);
    return true;
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

  function handleChest(event) {
    const { player, objectId } = event;
    if (objectId !== CHEST_OBJECT_ID) return false;
    if (!questActive(player) || quest.getStage(player) < STAGE_GOLEM_POWERED) return false;
    event.handled = true;
    speak(
      player,
      CORMAC_NPC_ID,
      hasFlag(player, FLAG_CHEST_UNLOCKED)
        ? "entering-ardeaglais-searching-the-chest-again"
        : "entering-ardeaglais-unlocking-the-chest"
    );
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

  function handleBody(event) {
    const { player, objectId } = event;
    if (objectId !== CATHEDRAL_CORPSE_OBJECT_ID) return false;
    const stage = quest.getStage(player);
    if (stage < STAGE_ANGEL_DEAD || quest.isComplete(player)) return false;
    event.handled = true;
    speak(
      player,
      CORMAC_NPC_ID,
      stage === STAGE_ANGEL_DEAD && !hasFlag(player, FLAG_FOUND_BODY)
        ? "entering-ardeaglais-inspecting-keenan-s-body"
        : "entering-ardeaglais-inspecting-keenan-s-body-again"
    );
    return true;
  }

  function handleObjectInteraction(event) {
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
    if (!pair.includes(CHISEL_ITEM_ID)) return false;
    const other = pair[0] === CHISEL_ITEM_ID ? pair[1] : pair[0];
    if (other === SUNSTONE_ITEM_ID && held(player, SUNSTONE_ITEM_ID)) {
      event.handled = true;
      player.getInventory().deleteNumber(SUNSTONE_ITEM_ID, 1);
      if (questActive(player) && quest.getStage(player) === STAGE_SUNSTONE) {
        quest.setStage(player, STAGE_CORE);
      }
      player.getInventory().adds(SUNSTONE_CORE_ITEM_ID, 1);
      player.sendMessage("You chisel the sunstone into a core.");
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
    if (stage < STAGE_GOLEM || stage >= STAGE_GOLEM_POWERED) return false;
    event.handled = true;
    player.getInventory().deleteNumber(SUNSTONE_CORE_ITEM_ID, 1);
    quest.setStage(player, STAGE_GOLEM_POWERED);
    ensureBasementItems(player);
    speak(player, CORMAC_NPC_ID, "entering-ardeaglais-putting-a-new-core-in-the-golem");
    return true;
  }

  function handleGolemInvestigate(event) {
    const { player, npcId } = event;
    if (npcId !== BROKEN_GOLEM_NPC_ID) return false;
    const stage = quest.getStage(player);
    if (stage < STAGE_TROLLS || stage >= STAGE_GOLEM_POWERED) return false;
    event.handled = true;
    speak(
      player,
      CORMAC_NPC_ID,
      stage === STAGE_TROLLS
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
    if (action === "read" && READ_MESSAGES.has(itemId)) {
      event.handled = true;
      player.sendMessage(READ_MESSAGES.get(itemId));
      return true;
    }
    return false;
  }

  // ==========================================================================
  // Ground items
  // ==========================================================================

  function investigateHat(player) {
    if (!questActive(player)) {
      player.sendMessage("Someone's left their hat here. How odd.");
      return;
    }
    if (quest.getStage(player) < STAGE_HAT) {
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
  // NPC death
  // ==========================================================================

  function handleNpcDeath(event) {
    const npc = event.npc;
    if (!npc) return;

    const session = npc.__madAngel;
    if (session) {
      const player = session.player;
      if (player && quest.getStage(player) === STAGE_CATHEDRAL) {
        quest.setStage(player, STAGE_ANGEL_DEAD);
      }
      return;
    }

    const killer = event.killer;
    if (!killer?.isPlayer?.()) return;
    const contentId = npc.getContentId?.(killer) ?? npc.getId();
    if (!TROLL_NPC_IDS.has(contentId)) return;
    if (quest.getStage(killer) !== STAGE_CAVERN) return;
    if (!inZone(npc.getLocation(), CAVERN_ZONE)) return;
    const kills = (Number(killer.getAttribute(TROLL_KILLS_ATTRIBUTE)) || 0) + 1;
    killer.setAttribute(TROLL_KILLS_ATTRIBUTE, kills);
    if (kills < TROLLS_TO_KILL) return;
    setFlag(killer, FLAG_TROLLS_KILLED);
    quest.setStage(killer, STAGE_TROLLS);
    speak(killer, NpcIdentifiers.MORTIMER, "the-way-under-ardeaglais-upon-killing-the-trolls");
  }

  // ==========================================================================
  // Stairs, zones and login
  // ==========================================================================

  function enterCathedralInstance(player) {
    if (!MadAngelCommon.core) return;
    const session = MadAngelInstance.open(player);
    MadAngelInstance.enter(session);
  }

  function claimBasementStairs(event) {
    const { player } = event;
    const stage = quest.getStage(player);
    if (quest.isComplete(player) || stage < STAGE_GOLEM_POWERED) return;
    event.handled = true;
    if (stage >= STAGE_ANGEL_DEAD) return;
    if (stage === STAGE_CATHEDRAL) {
      enterCathedralInstance(player);
      return;
    }
    if (!hasFlag(player, FLAG_KEY_USED) && !held(player, STAIRCASE_KEY_ITEM_ID)) {
      speak(player, CORMAC_NPC_ID, "entering-ardeaglais-attempting-to-climb-the-stairs");
      return;
    }
    if (held(player, STAIRCASE_KEY_ITEM_ID)) {
      player.getInventory().deleteNumber(STAIRCASE_KEY_ITEM_ID, 1);
    }
    setFlag(player, FLAG_KEY_USED);
    setFlag(player, FLAG_CATHEDRAL_OPENED);
    quest.setStage(player, STAGE_CATHEDRAL);
    enterCathedralInstance(player);
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
    const stage = quest.getStage(player);
    if (stage <= STAGE_CORMAC_BYPASS) {
      setFlag(player, FLAG_WYRMS_ENTRY);
      quest.setStage(player, STAGE_CAVERN);
    }
    if (stage >= STAGE_GOLEM_POWERED || stage === STAGE_CAVERN) {
      ensureBasementItems(player);
    }
  }

  function handleLogin({ player }) {
    refreshQuestList(player);
    ensureHat(player);
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

  quest = registerQuest(api, {
    key: "fallen_from_grace",
    name: "Fallen From Grace",
    varpId: VARP_FALLEN_FROM_GRACE,
    varbitId: VARBIT_STAGE,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 2,
    xpRewards: [
      { skillId: Skill.CRAFTING.getIndex(), amount: 10000, label: "Crafting" },
      { skillId: Skill.SAILING.getIndex(), amount: 12500, label: "Sailing" },
      { skillId: Skill.MINING.getIndex(), amount: 5000, label: "Mining" },
      { skillId: Skill.RUNECRAFTING.getIndex(), amount: 5000, label: "Runecraft" },
    ],
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
  api.onItemOnItem(handleItemOnItem);
  api.onItemOnNpc(handleItemOnNpc);
  api.onItemAction(handleItemAction);
  api.onNpcInteraction("Broken golem", { Investigate: handleGolemInvestigate });
  api.onGroundItemClick([LARGE_HAT_ITEM_ID, WORN_JOURNAL_ITEM_ID], 3, handleGroundItemInvestigate);
  api.onGroundItemPickup(handleGroundItemPickup);
  api.onNpcDeath(handleNpcDeath);
  api.onCustomEvent("ladders:climb", handleLadderClaim);
  api.onZoneEnter(SURFACE_ZONE, handleSurfaceZoneEnter);
  api.onZoneEnter(CAVERN_ZONE, handleCavernZoneEnter);
  api.onPlayerLogin(handleLogin);
};
