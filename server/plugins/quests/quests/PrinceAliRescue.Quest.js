/**
 * Prince Ali Rescue.
 *
 * Words come from data/definitions/npc-dialogues.json. The quest's
 * "Prince Ali Rescue" page mixes every NPC, so the branch is selected by the
 * clicked cache id plus the quest stage:
 *
 *   Chancellor Hassan 4285:
 *     stage 0      -> "starting-out-talking-to-chancellor-hassan"   (start hook)
 *     stage 10     -> "...talking-to-him-again-before-meeting-osman"
 *     stage 20-99  -> "...talking-to-him-after-meeting-osman"
 *     stage 100+   -> "prince-ali-rescued-talking-to-chancellor-hassan" (complete)
 *     complete     -> "Chancellor Hassan" / "standard-dialogue-after-completing-..."
 *
 *   Osman 4286/6165:
 *     stage 0      -> "Osman" / "standard-dialogue-before-prince-ali-rescue"
 *     stage 10     -> "starting-out-talking-to-osman"        (advances to 20)
 *     stage 20-29  -> "starting-out-talking-to-osman-talking-to-osman-again"
 *                     (hand-in key print + bronze -> stage 21)
 *     stage 100+   -> "prince-ali-rescued-talking-to-osman"
 *
 *   Leela 4274:
 *     stage < 20   -> "Leela" / "standard-dialogue-before-the-completion-..."
 *     stage 20-21  -> "starting-out-talking-to-leela" (planning)
 *     stage 21     -> Historical "preparations-for-rescue-talking-to-leela-after-
 *                     having-all-the-required-items" (gives the key -> stage 22)
 *     stage 22-29  -> if key+disguise: main-page guard briefing (advances to 30),
 *                     if key lost: lost-key replacement, else planning
 *     stage 30     -> "executing-the-rescue-talking-to-leela-again-after-speaking-to-joe"
 *     stage 40/50  -> "executing-the-rescue-talking-to-leela-once-joe-is-drunk"
 *     stage 100+   -> "prince-ali-rescued-talking-to-leela"
 *
 *   Ned 4280:    quest active & no wig -> "preparations-for-rescue-talking-to-ned"
 *   Aggie 120/121/4284: quest active & no paste -> "preparations-for-rescue-talking-to-aggie"
 *   Lady Keli 4281/11578:
 *     stage 20-39 -> "preparations-for-rescue-talking-to-lady-keli" (imprint)
 *     stage 40+   -> "executing-the-rescue-dealing-with-lady-keli" (tie up)
 *   Joe 4275/11577:
 *     stage 20-29 -> "preparations-for-rescue-talking-to-joe"
 *     stage 30    -> "executing-the-rescue-talking-to-joe" (beer)
 *     stage 40/50 -> "executing-the-rescue-talking-to-joe-talking-to-joe-once-he-is-drunk"
 *     stage 100+  -> "executing-the-rescue-talking-to-joe-after-prince-ali-s-escape"
 *   Prince Ali 4282/11579/11580:
 *     stage 100+  -> "prince-ali-rescued-talking-to-prince-ali"
 *     otherwise   -> "executing-the-rescue-talking-to-prince-ali"
 *
 * This plugin supplies the variant selector, the prose-condition answers, the
 * start hook, the item hand-ins and the simple item-on-npc/item-on-item
 * interactions (dye the wig, make the key, drink the beers, tie Keli, escape).
 *
 * Gaps (see summary): the prison gate open + jail actor spawning (needs object
 * edits/spawns); a Leela line for stage 50; the dangling "Can you make dyes"
 * option in the quest Aggie transcript (dyes stay on her generic page); the
 * dangling Ned rope option (rope stays buyable from his generic page/shop).
 */
module.exports = function registerPrinceAliRescueQuest(api) {
  const { ItemIdentifiers, NpcIdentifiers } = api.core;
  const { registerQuest } = require("../QuestRuntime");

  const VARP_PRINCE_ALI_RESCUE = 273;
  const STAGE_STARTED = 10;
  const STAGE_SPOKEN_TO_OSMAN = 20;
  const STAGE_KEY_MADE = 21;
  const STAGE_KEY_CLAIMED = 22;
  const STAGE_PREPARATION_COMPLETE = 30;
  const STAGE_GUARD_DRUNK = 40;
  const STAGE_KELI_TIED = 50;
  const STAGE_PRINCE_SAVED = 100;
  const STAGE_COMPLETE = 110;

  const HASSAN_NPC_ID = NpcIdentifiers.CHANCELLOR_HASSAN;
  /**
   * Ids the plugin has always recognised that are absent from the generated
   * NpcIdentifiers enum (older cache variants).
   */
  const OSMAN_LEGACY_NPC_ID = 6165;
  const AGGIE_LEGACY_NPC_ID = 4284;
  const JOE_LEGACY_NPC_ID = 4275;
  const LADY_KELI_LEGACY_NPC_ID = 4281;
  const PRINCE_ALI_LEGACY_NPC_ID = 4282;

  const OSMAN_NPC_IDS = new Set([NpcIdentifiers.OSMAN_9, OSMAN_LEGACY_NPC_ID]);
  const LEELA_NPC_ID = NpcIdentifiers.LEELA;
  const NED_NPC_ID = NpcIdentifiers.NED;
  const AGGIE_NPC_IDS = new Set([NpcIdentifiers.AGGIE, NpcIdentifiers.AGGIE_2, AGGIE_LEGACY_NPC_ID]);
  const JOE_NPC_IDS = new Set([NpcIdentifiers.JOE_5, JOE_LEGACY_NPC_ID]);
  const LADY_KELI_NPC_IDS = new Set([NpcIdentifiers.LADY_KELI, LADY_KELI_LEGACY_NPC_ID]);
  const PRINCE_ALI_NPC_IDS = new Set([
    NpcIdentifiers.PRINCE_ALI,
    NpcIdentifiers.PRINCE_ALI_2,
    PRINCE_ALI_LEGACY_NPC_ID,
  ]);

  const QUEST_NPC_IDS = new Set([
    HASSAN_NPC_ID,
    ...OSMAN_NPC_IDS,
    LEELA_NPC_ID,
    NED_NPC_ID,
    ...AGGIE_NPC_IDS,
    ...LADY_KELI_NPC_IDS,
    ...JOE_NPC_IDS,
    ...PRINCE_ALI_NPC_IDS,
  ]);

  const COINS_ITEM_ID = ItemIdentifiers.COINS;
  const JUG_OF_WATER_ITEM_ID = ItemIdentifiers.JUG_OF_WATER;
  const BUCKET_OF_WATER_ITEM_ID = ItemIdentifiers.BUCKET_OF_WATER;
  const POT_OF_FLOUR_ITEM_ID = ItemIdentifiers.POT_OF_FLOUR;
  const ASHES_ITEM_ID = ItemIdentifiers.ASHES;
  const REDBERRIES_ITEM_ID = ItemIdentifiers.REDBERRIES;
  const ONION_ITEM_ID = ItemIdentifiers.ONION;
  const WOAD_LEAF_ITEM_ID = ItemIdentifiers.WOAD_LEAF;
  const RED_DYE_ITEM_ID = ItemIdentifiers.RED_DYE;
  const YELLOW_DYE_ITEM_ID = ItemIdentifiers.YELLOW_DYE;
  const BLUE_DYE_ITEM_ID = ItemIdentifiers.BLUE_DYE;
  const BALL_OF_WOOL_ITEM_ID = ItemIdentifiers.BALL_OF_WOOL;
  const SOFT_CLAY_ITEM_ID = ItemIdentifiers.SOFT_CLAY;
  const BRONZE_BAR_ITEM_ID = ItemIdentifiers.BRONZE_BAR;
  const BEER_ITEM_ID = ItemIdentifiers.BEER;
  const ROPE_ITEM_ID = ItemIdentifiers.ROPE;
  const PINK_SKIRT_ITEM_ID = ItemIdentifiers.PINK_SKIRT;
  const BRONZE_KEY_ITEM_ID = ItemIdentifiers.BRONZE_KEY;
  // Cache names both wigs "Wig"; keep the readable quest aliases.
  const BLONDE_WIG_ITEM_ID = ItemIdentifiers.WIG;
  const GREY_WIG_ITEM_ID = ItemIdentifiers.WIG_2;
  const KEY_PRINT_ITEM_ID = ItemIdentifiers.KEY_PRINT;
  const SKIN_PASTE_ITEM_ID = ItemIdentifiers.PASTE;

  const KEY_REPLACEMENT_COST = 15;

  /** Quest transcript step ids whose action we execute. */
  const LEELA_GIVES_KEY = "NVdPNU";
  const LEELA_GIVES_REPLACEMENT_KEY = "QWXeY9";
  const OSMAN_TAKES_IMPRINT = "3VGxE9";
  const NED_GIVES_WIG = "PNcI7G";
  const AGGIE_TAKES_INGREDIENTS = "NxwQUL";
  const AGGIE_GIVES_PASTE = "pJjbEz";
  const KELI_TAKES_IMPRINT = "yhHGpM";
  const KELI_TIED_UP = "aw4xu7";
  const JOE_TAKES_ONE_BEER = "TDhBVe";
  const JOE_TAKES_TWO_BEERS = "KxLvNg";
  const PRINCE_ESCAPES = "WQdAq1";
  const HASSAN_COMPLETES = "ctDkjC";
  const AGGIE_MAKES_RED_DYE = "bMfkaS";
  const AGGIE_MAKES_YELLOW_DYE = "WsCsbT";
  const AGGIE_MAKES_BLUE_DYE = "4kcivD";

  const DYE_COST = 5;

  const PAR = (variant) => ({ page: "Prince Ali Rescue", variant });
  const PAR_HIST = (variant) => ({ page: "Prince Ali Rescue/Historical", variant });

  let quest;

  const held = (player, itemId, amount = 1) => player.getInventory().getAmount(itemId) >= amount;
  const waterItem = (player) =>
    held(player, BUCKET_OF_WATER_ITEM_ID)
      ? BUCKET_OF_WATER_ITEM_ID
      : held(player, JUG_OF_WATER_ITEM_ID)
        ? JUG_OF_WATER_ITEM_ID
        : undefined;
  const hasPasteIngredients = (player) =>
    waterItem(player) !== undefined &&
    held(player, ASHES_ITEM_ID) &&
    held(player, POT_OF_FLOUR_ITEM_ID) &&
    held(player, REDBERRIES_ITEM_ID);
  const hasDisguise = (player) =>
    held(player, BLONDE_WIG_ITEM_ID) &&
    held(player, PINK_SKIRT_ITEM_ID) &&
    held(player, SKIN_PASTE_ITEM_ID);

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage === 0) {
      return [
        "I can start this quest by speaking to <col=800000>Chancellor Hassan</col>",
        "in <col=800000>Al Kharid Palace</col>.",
      ];
    }
    if (stage === STAGE_STARTED) {
      return [
        "<str>I offered to help Chancellor Hassan.</str>",
        "He told me to report to <col=800000>Osman</col>, the spymaster.",
      ];
    }
    const summary = [
      "<str>Prince Ali was kidnapped and is held near Draynor Village.</str>",
      "<str>I must disguise him and tie up Lady Keli to free him.</str>",
    ];
    if (stage >= STAGE_SPOKEN_TO_OSMAN && stage < STAGE_PREPARATION_COMPLETE) {
      return [
        ...summary,
        "",
        "I should speak to <col=800000>Leela</col> near Draynor Village.",
        held(player, BRONZE_KEY_ITEM_ID)
          ? "<str>I have the duplicate bronze key.</str>"
          : "I need a key print, a bronze bar, and a duplicate key.",
        held(player, ROPE_ITEM_ID) ? "<str>I have rope for Lady Keli.</str>" : "I need rope to tie Lady Keli up.",
        held(player, SKIN_PASTE_ITEM_ID)
          ? "<str>I have skin paste.</str>"
          : "I need something to lighten the Prince's skin.",
        held(player, PINK_SKIRT_ITEM_ID)
          ? "<str>I have a pink skirt.</str>"
          : "I need a pink skirt like Lady Keli's.",
        held(player, BLONDE_WIG_ITEM_ID) ? "<str>I have a blonde wig.</str>" : "I need a blonde wig.",
      ];
    }
    if (stage === STAGE_PREPARATION_COMPLETE) {
      return [
        ...summary,
        "",
        "Before freeing Prince Ali, I need to deal with the door guard.",
        "Leela suggested finding his weakness.",
      ];
    }
    if (stage === STAGE_GUARD_DRUNK) {
      return [
        ...summary,
        "<str>I got Joe drunk so he cannot interfere.</str>",
        "",
        "I should use my <col=800000>rope</col> on <col=800000>Lady Keli</col>.",
      ];
    }
    if (stage === STAGE_KELI_TIED) {
      return [
        ...summary,
        "<str>I got Joe drunk and tied Lady Keli in a cupboard.</str>",
        "",
        "I can now unlock the cell and give Prince Ali the full disguise.",
      ];
    }
    if (stage === STAGE_PRINCE_SAVED) {
      return [
        ...summary,
        "<str>I disguised Prince Ali and helped him escape.</str>",
        "",
        "I should return to <col=800000>Chancellor Hassan</col> for my reward.",
      ];
    }
    if (stage >= STAGE_COMPLETE) {
      return [
        ...summary,
        "<str>I got Joe drunk and tied Lady Keli up.</str>",
        "<str>I disguised Prince Ali and helped him escape.</str>",
        "<str>Chancellor Hassan rewarded me for the rescue.</str>",
        "",
        "<col=ff0000>QUEST COMPLETE!</col>",
      ];
    }
    return summary;
  }

  function hassanVariant(stage) {
    if (stage >= STAGE_COMPLETE) {
      return { page: "Chancellor Hassan", variant: "standard-dialogue-after-completing-prince-ali-rescue" };
    }
    if (stage >= STAGE_PRINCE_SAVED) return PAR("prince-ali-rescued-talking-to-chancellor-hassan");
    if (stage >= STAGE_SPOKEN_TO_OSMAN) return PAR("starting-out-talking-to-chancellor-hassan-talking-to-him-after-meeting-osman");
    if (stage >= STAGE_STARTED) return PAR("starting-out-talking-to-chancellor-hassan-talking-to-him-again-before-meeting-osman");
    return PAR("starting-out-talking-to-chancellor-hassan");
  }

  function osmanVariant(stage) {
    if (stage >= STAGE_PRINCE_SAVED) return PAR("prince-ali-rescued-talking-to-osman");
    if (stage === STAGE_STARTED) return PAR("starting-out-talking-to-osman");
    if (stage >= STAGE_SPOKEN_TO_OSMAN && stage < STAGE_PREPARATION_COMPLETE) {
      return PAR("starting-out-talking-to-osman-talking-to-osman-again");
    }
    return null;
  }

  function leelaVariant(player, stage) {
    if (stage >= STAGE_PRINCE_SAVED) return PAR("prince-ali-rescued-talking-to-leela");
    if (stage >= STAGE_KEY_CLAIMED) {
      if (!held(player, BRONZE_KEY_ITEM_ID)) {
        return PAR(
          "preparations-for-rescue-talking-to-leela-after-having-all-the-required-items-talking-to-leela-again-if-the-player-lost-the-key"
        );
      }
      if (stage < STAGE_PREPARATION_COMPLETE && hasDisguise(player)) {
        return PAR("preparations-for-rescue-talking-to-leela-after-having-all-the-required-items");
      }
      if (stage === STAGE_PREPARATION_COMPLETE) {
        return PAR("executing-the-rescue-talking-to-leela-again-after-speaking-to-joe");
      }
      if (stage === STAGE_GUARD_DRUNK || stage === STAGE_KELI_TIED) {
        return PAR("executing-the-rescue-talking-to-leela-once-joe-is-drunk");
      }
      return PAR("starting-out-talking-to-leela-talking-to-leela-again");
    }
    if (stage === STAGE_KEY_MADE) {
      return PAR_HIST("preparations-for-rescue-talking-to-leela-after-having-all-the-required-items");
    }
    if (stage >= STAGE_SPOKEN_TO_OSMAN) return PAR("starting-out-talking-to-leela");
    return null;
  }

  function nedVariant(player, stage) {
    const active = stage >= STAGE_SPOKEN_TO_OSMAN && stage < STAGE_PRINCE_SAVED;
    if (active && !held(player, GREY_WIG_ITEM_ID) && !held(player, BLONDE_WIG_ITEM_ID)) {
      return PAR("preparations-for-rescue-talking-to-ned");
    }
    return null;
  }

  function aggieVariant(player, stage) {
    const active = stage >= STAGE_SPOKEN_TO_OSMAN && stage < STAGE_PRINCE_SAVED;
    if (active && !held(player, SKIN_PASTE_ITEM_ID)) return PAR("preparations-for-rescue-talking-to-aggie");
    return null;
  }

  function keliVariant(stage) {
    if (stage >= STAGE_PRINCE_SAVED) return null;
    if (stage >= STAGE_GUARD_DRUNK) return PAR("executing-the-rescue-dealing-with-lady-keli");
    if (stage >= STAGE_SPOKEN_TO_OSMAN) return PAR("preparations-for-rescue-talking-to-lady-keli");
    return null;
  }

  function joeVariant(stage) {
    if (stage >= STAGE_PRINCE_SAVED) return PAR("executing-the-rescue-talking-to-joe-after-prince-ali-s-escape");
    if (stage === STAGE_GUARD_DRUNK || stage === STAGE_KELI_TIED) {
      return PAR("executing-the-rescue-talking-to-joe-talking-to-joe-once-he-is-drunk");
    }
    if (stage === STAGE_PREPARATION_COMPLETE) return PAR("executing-the-rescue-talking-to-joe");
    if (stage >= STAGE_SPOKEN_TO_OSMAN) return PAR("preparations-for-rescue-talking-to-joe");
    return null;
  }

  function princeVariant(stage) {
    if (stage >= STAGE_PRINCE_SAVED) return PAR("prince-ali-rescued-talking-to-prince-ali");
    return PAR("executing-the-rescue-talking-to-prince-ali");
  }

  function reward(player) {
    player.getInventory().adds(COINS_ITEM_ID, 700);
  }

  function selectVariant({ npcId, player }) {
    const stage = quest.getStage(player);
    if (npcId === HASSAN_NPC_ID) return hassanVariant(stage);
    if (OSMAN_NPC_IDS.has(npcId)) return osmanVariant(stage);
    if (npcId === LEELA_NPC_ID) return leelaVariant(player, stage);
    if (npcId === NED_NPC_ID) return nedVariant(player, stage);
    if (AGGIE_NPC_IDS.has(npcId)) return aggieVariant(player, stage);
    if (LADY_KELI_NPC_IDS.has(npcId)) return keliVariant(stage);
    if (JOE_NPC_IDS.has(npcId)) return joeVariant(stage);
    if (PRINCE_ALI_NPC_IDS.has(npcId)) return princeVariant(stage);
    return null;
  }

  function answerCondition({ npcId, player, text }) {
    const value = String(text).toLowerCase();
    const stage = quest.getStage(player);

    if (OSMAN_NPC_IDS.has(npcId)) {
      if (value.includes("has the key imprint but no bronze bar")) {
        return held(player, KEY_PRINT_ITEM_ID) && !held(player, BRONZE_BAR_ITEM_ID);
      }
      if (value.includes("has the key imprint and a bronze bar")) {
        return held(player, KEY_PRINT_ITEM_ID) && held(player, BRONZE_BAR_ITEM_ID);
      }
      if (value.includes("has not acquired the key imprint")) return !held(player, KEY_PRINT_ITEM_ID);
      return null;
    }

    if (npcId === LEELA_NPC_ID) {
      if (value.includes("hasn't obtained the key print yet")) return !held(player, KEY_PRINT_ITEM_ID);
      if (value.includes("has the key print in their inventory")) return held(player, KEY_PRINT_ITEM_ID);
      if (value.includes("does not have 15 coins")) return !held(player, COINS_ITEM_ID, KEY_REPLACEMENT_COST);
      if (value.includes("has 15 coins")) return held(player, COINS_ITEM_ID, KEY_REPLACEMENT_COST);
      return null;
    }

    if (npcId === NED_NPC_ID) {
      if (value.includes("does not have three balls of wool")) return !held(player, BALL_OF_WOOL_ITEM_ID, 3);
      if (value.includes("has three balls of wool")) return held(player, BALL_OF_WOOL_ITEM_ID, 3);
      return null;
    }

    if (AGGIE_NPC_IDS.has(npcId)) {
      if (value.includes("does not have all the required items")) return !hasPasteIngredients(player);
      if (value.includes("has all the required items")) return hasPasteIngredients(player);
      // Aggie's generic dye dialogue (reused by the quest for the wig).
      if (value.includes("doesn't have redberries")) {
        return !(held(player, REDBERRIES_ITEM_ID, 3) && held(player, COINS_ITEM_ID, DYE_COST));
      }
      if (value.includes("doesn't have enough onions")) {
        return !(held(player, ONION_ITEM_ID, 2) && held(player, COINS_ITEM_ID, DYE_COST));
      }
      if (value.includes("doesn't have woad leaves")) {
        return !(held(player, WOAD_LEAF_ITEM_ID, 2) && held(player, COINS_ITEM_ID, DYE_COST));
      }
      return null;
    }

    if (LADY_KELI_NPC_IDS.has(npcId)) {
      if (value.includes("doesn't have soft clay or already has the key print")) {
        return !held(player, SOFT_CLAY_ITEM_ID) || held(player, KEY_PRINT_ITEM_ID);
      }
      if (value.includes("if the player is not ready")) {
        return !(stage >= STAGE_GUARD_DRUNK && held(player, ROPE_ITEM_ID));
      }
      if (value.includes("used rope on lady keli")) return stage >= STAGE_KELI_TIED;
      if (value.includes("is ready and talks to lady keli")) {
        return stage >= STAGE_GUARD_DRUNK && stage < STAGE_KELI_TIED && held(player, ROPE_ITEM_ID);
      }
      return null;
    }

    if (JOE_NPC_IDS.has(npcId)) {
      if (value.includes("has less than three beers")) return !held(player, BEER_ITEM_ID, 3);
      if (value.includes("has two more beers")) return held(player, BEER_ITEM_ID, 3);
      return null;
    }

    if (PRINCE_ALI_NPC_IDS.has(npcId)) {
      const ready = hasDisguise(player) && held(player, BRONZE_KEY_ITEM_ID);
      if (value.includes("does not have a complete disguise and key")) return !ready;
      if (value.includes("has a complete disguise and key")) return ready;
      return null;
    }

    return null;
  }

  // "Yes." on "Start the Prince Ali Rescue quest?" carries this slug.
  function handleStartHook({ player, hook }) {
    if (hook !== "quest:prince-ali-rescue:start") return;
    if (quest.getStage(player) >= STAGE_STARTED) return;
    quest.setStage(player, STAGE_STARTED);
  }

  // Two conversations have no action slug but do end a stage.
  function handleLine({ player, npcId, text }) {
    const line = String(text ?? "");
    if (OSMAN_NPC_IDS.has(npcId)) {
      if (quest.getStage(player) === STAGE_STARTED && line.includes("Then you should get going")) {
        quest.setStage(player, STAGE_SPOKEN_TO_OSMAN);
      }
      return;
    }
    if (npcId === LEELA_NPC_ID) {
      const stage = quest.getStage(player);
      if (stage >= STAGE_KEY_CLAIMED && stage < STAGE_PREPARATION_COMPLETE && line.includes("chat to this guard")) {
        quest.setStage(player, STAGE_PREPARATION_COMPLETE);
      }
    }
  }

  function handleAction(event) {
    if (!QUEST_NPC_IDS.has(event.npcId)) return;
    const { player, stepId } = event;

    // Prose "missing"/"unavailable" markers in the mixed transcript would
    // otherwise abort the branch; skip past them.
    const type = event.step?.type;
    if (type === "missing" || type === "unavailable") {
      event.handled = true;
      event.end = false;
      return;
    }

    if (stepId === LEELA_GIVES_KEY) {
      if (quest.getStage(player) !== STAGE_KEY_MADE) return;
      if (player.getInventory().isFull()) {
        player.sendMessage("You need a free inventory space for the key.");
        event.handled = true;
        event.end = false;
        return;
      }
      player.getInventory().adds(BRONZE_KEY_ITEM_ID, 1);
      quest.setStage(player, STAGE_KEY_CLAIMED);
      if (event.text) player.sendMessage(String(event.text));
      event.handled = true;
      event.end = false;
      return;
    }

    if (stepId === LEELA_GIVES_REPLACEMENT_KEY) {
      if (held(player, COINS_ITEM_ID, KEY_REPLACEMENT_COST) && !held(player, BRONZE_KEY_ITEM_ID)) {
        player.getInventory().deleteNumber(COINS_ITEM_ID, KEY_REPLACEMENT_COST);
        player.getInventory().adds(BRONZE_KEY_ITEM_ID, 1);
      }
      if (event.text) player.sendMessage(String(event.text));
      event.handled = true;
      event.end = false;
      return;
    }

    if (stepId === OSMAN_TAKES_IMPRINT) {
      if (!held(player, KEY_PRINT_ITEM_ID) || !held(player, BRONZE_BAR_ITEM_ID)) return;
      player.getInventory().deleteNumber(KEY_PRINT_ITEM_ID, 1);
      player.getInventory().deleteNumber(BRONZE_BAR_ITEM_ID, 1);
      quest.setStage(player, STAGE_KEY_MADE);
      if (event.text) player.sendMessage(String(event.text));
      event.handled = true;
      event.end = false;
      return;
    }

    if (stepId === NED_GIVES_WIG) {
      if (!held(player, BALL_OF_WOOL_ITEM_ID, 3)) return;
      player.getInventory().deleteNumber(BALL_OF_WOOL_ITEM_ID, 3);
      player.getInventory().adds(GREY_WIG_ITEM_ID, 1);
      if (event.text) player.sendMessage(String(event.text));
      event.handled = true;
      event.end = false;
      return;
    }

    if (stepId === AGGIE_TAKES_INGREDIENTS) {
      if (!hasPasteIngredients(player)) return;
      player.getInventory().deleteNumber(waterItem(player), 1);
      player.getInventory().deleteNumber(ASHES_ITEM_ID, 1);
      player.getInventory().deleteNumber(POT_OF_FLOUR_ITEM_ID, 1);
      player.getInventory().deleteNumber(REDBERRIES_ITEM_ID, 1);
      if (event.text) player.sendMessage(String(event.text));
      event.handled = true;
      event.end = false;
      return;
    }

    if (stepId === AGGIE_GIVES_PASTE) {
      player.getInventory().adds(SKIN_PASTE_ITEM_ID, 1);
      if (event.text) player.sendMessage(String(event.text));
      event.handled = true;
      event.end = false;
      return;
    }

    if (stepId === AGGIE_MAKES_RED_DYE || stepId === AGGIE_MAKES_YELLOW_DYE || stepId === AGGIE_MAKES_BLUE_DYE) {
      const recipe =
        stepId === AGGIE_MAKES_RED_DYE
          ? { ingredient: REDBERRIES_ITEM_ID, amount: 3, dye: RED_DYE_ITEM_ID, label: "red" }
          : stepId === AGGIE_MAKES_YELLOW_DYE
            ? { ingredient: ONION_ITEM_ID, amount: 2, dye: YELLOW_DYE_ITEM_ID, label: "yellow" }
            : { ingredient: WOAD_LEAF_ITEM_ID, amount: 2, dye: BLUE_DYE_ITEM_ID, label: "blue" };
      if (!held(player, recipe.ingredient, recipe.amount) || !held(player, COINS_ITEM_ID, DYE_COST)) return;
      player.getInventory().deleteNumber(recipe.ingredient, recipe.amount);
      player.getInventory().deleteNumber(COINS_ITEM_ID, DYE_COST);
      player.getInventory().adds(recipe.dye, 1);
      player.sendMessage(`Aggie makes you some ${recipe.label} dye.`);
      event.handled = true;
      event.end = false;
      return;
    }

    if (stepId === KELI_TAKES_IMPRINT) {
      if (!held(player, SOFT_CLAY_ITEM_ID)) return;
      player.getInventory().deleteNumber(SOFT_CLAY_ITEM_ID, 1);
      player.getInventory().adds(KEY_PRINT_ITEM_ID, 1);
      if (event.text) player.sendMessage(String(event.text));
      event.handled = true;
      event.end = false;
      return;
    }

    if (stepId === KELI_TIED_UP) {
      if (!held(player, ROPE_ITEM_ID)) return;
      player.getInventory().deleteNumber(ROPE_ITEM_ID, 1);
      quest.setStage(player, STAGE_KELI_TIED);
      if (event.text) player.sendMessage(String(event.text));
      event.handled = true;
      event.end = false;
      return;
    }

    if (stepId === JOE_TAKES_ONE_BEER) {
      if (!held(player, BEER_ITEM_ID)) {
        player.sendMessage("It seems you don't have any beer.");
        event.handled = true;
        event.end = false;
        return;
      }
      player.getInventory().deleteNumber(BEER_ITEM_ID, 1);
      if (event.text) player.sendMessage(String(event.text));
      event.handled = true;
      event.end = false;
      return;
    }

    if (stepId === JOE_TAKES_TWO_BEERS) {
      if (!held(player, BEER_ITEM_ID, 2)) return;
      player.getInventory().deleteNumber(BEER_ITEM_ID, 2);
      quest.setStage(player, STAGE_GUARD_DRUNK);
      if (event.text) player.sendMessage(String(event.text));
      event.handled = true;
      event.end = false;
      return;
    }

    if (stepId === PRINCE_ESCAPES) {
      if (!held(player, BRONZE_KEY_ITEM_ID) || !hasDisguise(player)) return;
      player.getInventory().deleteNumber(BRONZE_KEY_ITEM_ID, 1);
      player.getInventory().deleteNumber(BLONDE_WIG_ITEM_ID, 1);
      player.getInventory().deleteNumber(PINK_SKIRT_ITEM_ID, 1);
      player.getInventory().deleteNumber(SKIN_PASTE_ITEM_ID, 1);
      quest.setStage(player, STAGE_PRINCE_SAVED);
      if (event.text) player.sendMessage(String(event.text));
      event.handled = true;
      event.end = false;
      return;
    }

    if (stepId === HASSAN_COMPLETES) {
      if (quest.getStage(player) >= STAGE_PRINCE_SAVED && !quest.isComplete(player)) {
        quest.complete(player);
      }
      event.handled = true;
      event.end = true;
    }
  }

  // Grey wig + yellow dye -> blonde wig.
  function handleItemOnItem(event) {
    const { usedItemId, usedWithItemId } = event;
    const pairs =
      (usedItemId === YELLOW_DYE_ITEM_ID && usedWithItemId === GREY_WIG_ITEM_ID) ||
      (usedItemId === GREY_WIG_ITEM_ID && usedWithItemId === YELLOW_DYE_ITEM_ID);
    if (!pairs) return;
    const inventory = event.player.getInventory();
    inventory.deleteNumber(GREY_WIG_ITEM_ID, 1);
    inventory.deleteNumber(YELLOW_DYE_ITEM_ID, 1);
    inventory.adds(BLONDE_WIG_ITEM_ID, 1);
    event.player.sendMessage("You dye the wig blonde.");
    event.handled = true;
  }

  // Simple item-on-NPC shortcuts (mirror the reference registrations).
  function handleItemOnNpc(event) {
    const npcId = event.target?.getId?.();
    const stage = quest.getStage(event.player);
    const inventory = event.player.getInventory();

    if (OSMAN_NPC_IDS.has(npcId) && stage === STAGE_SPOKEN_TO_OSMAN) {
      const itemId = event.itemId;
      if (itemId !== KEY_PRINT_ITEM_ID && itemId !== BRONZE_BAR_ITEM_ID) return;
      if (held(event.player, KEY_PRINT_ITEM_ID) && held(event.player, BRONZE_BAR_ITEM_ID)) {
        inventory.deleteNumber(KEY_PRINT_ITEM_ID, 1);
        inventory.deleteNumber(BRONZE_BAR_ITEM_ID, 1);
        quest.setStage(event.player, STAGE_KEY_MADE);
        event.player.sendMessage("Osman takes the key imprint and the bronze bar.");
      } else {
        event.player.sendMessage("Osman needs both the key imprint and a bronze bar.");
      }
      event.handled = true;
      return;
    }

    if (AGGIE_NPC_IDS.has(npcId) && stage >= STAGE_SPOKEN_TO_OSMAN && stage < STAGE_PRINCE_SAVED) {
      if (![JUG_OF_WATER_ITEM_ID, BUCKET_OF_WATER_ITEM_ID, ASHES_ITEM_ID, POT_OF_FLOUR_ITEM_ID, REDBERRIES_ITEM_ID].includes(event.itemId)) return;
      if (!hasPasteIngredients(event.player)) {
        event.player.sendMessage("Aggie needs ash, flour, water and redberries to make skin paste.");
        event.handled = true;
        return;
      }
      inventory.deleteNumber(waterItem(event.player), 1);
      inventory.deleteNumber(ASHES_ITEM_ID, 1);
      inventory.deleteNumber(POT_OF_FLOUR_ITEM_ID, 1);
      inventory.deleteNumber(REDBERRIES_ITEM_ID, 1);
      inventory.adds(SKIN_PASTE_ITEM_ID, 1);
      event.player.sendMessage("Aggie mixes you some skin paste.");
      event.handled = true;
      return;
    }

    if (JOE_NPC_IDS.has(npcId) && event.itemId === BEER_ITEM_ID && stage === STAGE_PREPARATION_COMPLETE) {
      const total = inventory.getAmount(BEER_ITEM_ID);
      if (total <= 0) {
        event.player.sendMessage("It seems you don't have any beer.");
        event.handled = true;
        return;
      }
      inventory.deleteNumber(BEER_ITEM_ID, 1);
      if (total >= 3) {
        inventory.deleteNumber(BEER_ITEM_ID, 2);
        quest.setStage(event.player, STAGE_GUARD_DRUNK);
        event.player.sendMessage("You hand Joe three beers. He drinks them all and slumps against the wall.");
      } else {
        event.player.sendMessage("One drink won't get Joe drunk; you would need a few at once.");
      }
      event.handled = true;
      return;
    }

    if (LADY_KELI_NPC_IDS.has(npcId) && event.itemId === ROPE_ITEM_ID) {
      if (stage >= STAGE_PRINCE_SAVED) {
        event.player.sendMessage("You have already rescued the Prince; that plan will not work again.");
        event.handled = true;
        return;
      }
      if (stage < STAGE_GUARD_DRUNK) {
        event.player.sendMessage("You cannot tie Keli up until the guard is disabled.");
        event.handled = true;
        return;
      }
      inventory.deleteNumber(ROPE_ITEM_ID, 1);
      quest.setStage(event.player, STAGE_KELI_TIED);
      event.player.sendMessage("You overpower Keli, tie her up, and put her in a cupboard.");
      event.handled = true;
      return;
    }

    if (PRINCE_ALI_NPC_IDS.has(npcId) && stage >= STAGE_KELI_TIED && stage < STAGE_PRINCE_SAVED) {
      if (![BLONDE_WIG_ITEM_ID, PINK_SKIRT_ITEM_ID, SKIN_PASTE_ITEM_ID].includes(event.itemId)) return;
      if (!held(event.player, BRONZE_KEY_ITEM_ID) || !hasDisguise(event.player)) {
        event.player.sendMessage("You still need the prison key and every part of the disguise.");
        event.handled = true;
        return;
      }
      inventory.deleteNumber(BRONZE_KEY_ITEM_ID, 1);
      inventory.deleteNumber(BLONDE_WIG_ITEM_ID, 1);
      inventory.deleteNumber(PINK_SKIRT_ITEM_ID, 1);
      inventory.deleteNumber(SKIN_PASTE_ITEM_ID, 1);
      quest.setStage(event.player, STAGE_PRINCE_SAVED);
      event.player.sendMessage("You hand the disguise and key to Prince Ali. He escapes!");
      event.handled = true;
    }
  }

  quest = registerQuest(api, {
    key: "prince_ali_rescue",
    name: "Prince Ali Rescue",
    varpId: VARP_PRINCE_ALI_RESCUE,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 3,
    xpRewards: [],
    scrollItemId: COINS_ITEM_ID,
    rewardItemLabel: "700 Coins",
    otherRewards: ["Free passage through the Al Kharid gate"],
    buildJournal,
    onReward: reward,
  });

  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("npc-dialogue:line", handleLine);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onItemOnItem(handleItemOnItem);
  api.onItemOnNpc(handleItemOnNpc);
};
