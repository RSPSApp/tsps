/**
 * Making History (members).
 *
 * The words come from the "Making History" transcript page, with the post-quest
 * variants from the "Jorral", "Silver merchant", "Dron", "Blanin" and
 * "King Lathas" pages. This plugin supplies the variant selector for those NPCs,
 * Talk-to interception for the Port Phasmatys ghosts (their spawned multi-NPCs
 * are not indexed to the quest page), the wiki prose-condition answers, and the
 * gameplay: the enchanted key's hot/cold "Feel" messages, digging the chest up
 * north of Castle Wars, opening it for the journal, Droalak's sapphire-amulet
 * task, Dron's quiz after Blanin, the letter to King Lathas and the reward.
 *
 * Stages (varbit 1383 "makinghistory_prog" of varp 604, values 0-2): 1 started,
 * 2 complete. The finer progress lives in persisted attributes and is mirrored
 * to the real sibling varbits with sendVarbit as it advances (1384
 * trader_prog 0-5, 1385 warr_prog 0-7, 1386 ghost_prog 0-15); Melina/Droalak
 * presence is driven through their multi-NPC transform varbits (1387/1388), so
 * they vanish for the player without touching the shared spawn. 1390 objloc /
 * 1391 locstatus stay unset (museum gap).
 *
 * Rewards per the OSRS Wiki: 3 Quest points, 1,000 Crafting XP, 1,000 Prayer XP,
 * 750 coins, the enchanted key and access to the outpost museum.
 *
 * Gaps: the requirements (Priest in Peril and The Restless Ghost) are checked
 * against the registered quests; the outpost museum swap (locstatus 1391 /
 * objloc 1390) is not simulated, completing only plays the scroll; the key's
 * post-quest treasure digs (The Enchanted Key miniquest) are not implemented;
 * the master-clue condition is answered false; Dron's "North West side of town"
 * wrong answer is a transcript "unavailable" marker and closes silently;
 * the dig spot tolerates one tile around
 * (2442,3139); King Lathas has no npc-spawns.json entry, so an owner-only copy is
 * spawned in the Ardougne Castle throne room while the player has business with
 * him; the Droalak/Melina variants are replayed with their conditions inlined
 * because HandInTheSand's earlier global condition handler mis-answers their
 * "inventory space" branch; the post-quest Droalak fade is also selected through
 * the transcript selector for the indexed 3493/3494 fallback (the 6128
 * multi-parent can resolve nameless for a player), so if a client cannot render
 * 6128 at all after completion that is a core multi-NPC resolution issue.
 */
module.exports = function registerMakingHistoryQuest(api) {
  const { Equipment, Item, ItemIdentifiers, NpcIdentifiers, Skill } = api.core;
  const { getRegisteredQuests, registerQuest, refreshQuestList, startTranscript } =
    require("../QuestRuntime");

  const PAGE = "Making History";
  const JORRAL_PAGE = "Jorral";
  const SILVER_MERCHANT_PAGE = "Silver merchant";
  const DRON_PAGE = "Dron";
  const BLANIN_PAGE = "Blanin";
  const KING_LATHAS_PAGE = "King Lathas";

  const VARP_MAKING_HISTORY = 604; // "makinghistory"
  const VARBIT_PROGRESS = 1383; // makinghistory_prog, bits 0-2
  const VARBIT_TRADER_PROGRESS = 1384; // makinghistory_trader_prog, bits 3-5
  const VARBIT_WARR_PROGRESS = 1385; // makinghistory_warr_prog, bits 6-8
  const VARBIT_GHOST_PROGRESS = 1386; // makinghistory_ghost_prog, bits 9-12
  const VARBIT_MELINA_PRESENT = 1387; // makinghistory_melina_pres
  const VARBIT_DROALAK_PRESENT = 1388; // makinghistory_droalak_pres

  const STAGE_STARTED = 1;
  const STAGE_COMPLETE = 2;

  const JORRAL_NPC_ID = NpcIdentifiers.JORRAL; // 3490
  const DRON_NPC_ID = NpcIdentifiers.DRON; // 3495
  const BLANIN_NPC_ID = NpcIdentifiers.BLANIN; // 3496
  const MELINA_NPC_IDS = new Set([
    NpcIdentifiers.MELINA, // 3491, fade variant
    NpcIdentifiers.MELINA_2, // 3492
    6127, // makinghistory_melina_multi, the Port Phasmatys spawn
  ]);
  const DROALAK_NPC_IDS = new Set([
    NpcIdentifiers.DROALAK, // 3493, fade variant
    NpcIdentifiers.DROALAK_2, // 3494
    6128, // makinghistory_droalak_multi, the Port Phasmatys spawn
  ]);
  const SILVER_MERCHANT_NPC_IDS = new Set([
    NpcIdentifiers.SILVER_MERCHANT_2, // 4582
    NpcIdentifiers.SILVER_MERCHANT, // 8722, East Ardougne market
  ]);
  const KING_LATHAS_NPC_IDS = new Set([
    NpcIdentifiers.KING_LATHAS, // 8046
    NpcIdentifiers.KING_LATHAS_2, // 8842
    NpcIdentifiers.LATHAS, // 8843
    NpcIdentifiers.KING_LATHAS_3, // 9005
    NpcIdentifiers.KING_LATHAS_4, // 11022
  ]);

  const ENCHANTED_KEY = ItemIdentifiers.ENCHANTED_KEY; // 6754
  const JOURNAL = ItemIdentifiers.JOURNAL_4; // 6755
  const JORRAL_LETTER = ItemIdentifiers.LETTER_4; // 6756, "A sealed letter to the king"
  const KING_LETTER = ItemIdentifiers.LETTER_5; // 6757, "A sealed letter to Jorral"
  const SCROLL = ItemIdentifiers.SCROLL; // 6758
  const CHEST = ItemIdentifiers.CHEST; // 6759
  const GHOSTSPEAK_AMULET = ItemIdentifiers.GHOSTSPEAK_AMULET; // 552
  const SAPPHIRE_AMULET = ItemIdentifiers.SAPPHIRE_AMULET; // 1694
  const SAPPHIRE_AMULET_U = ItemIdentifiers.SAPPHIRE_AMULET_U_; // 1675
  const COINS = ItemIdentifiers.COINS; // 995

  const DIG_X = 2442;
  const DIG_Y = 3139;
  const DIG_RADIUS = 1; // ponytail: one-tile tolerance, the wiki marks the spot with r=4

  const KING_LATHAS_SPAWN = { x: 2579, y: 3294, z: 1 }; // Ardougne Castle throne room

  // Persisted progress.
  const TRADER_ATTRIBUTE = "quest.making_history.trader";
  const GHOST_ATTRIBUTE = "quest.making_history.ghost";
  const WARR_ATTRIBUTE = "quest.making_history.warr";
  const BITS_ATTRIBUTE = "quest.making_history.bits";
  const KEY_LAST_ATTRIBUTE = "quest.making_history.key_last";

  const TRADER_NONE = 0;
  const TRADER_KEY = 1;
  const TRADER_CHEST = 2;
  const TRADER_JOURNAL = 3;

  const GHOST_NONE = 0;
  const GHOST_ASKED = 1;
  const GHOST_AMULET = 2;
  const GHOST_SCROLL = 3;

  const WARR_NONE = 0;
  const WARR_BRIEFED = 1;
  const WARR_QUIZ = 2;

  const BIT_JOURNAL_DONE = 1 << 0;
  const BIT_SCROLL_DONE = 1 << 1;
  const BIT_WARR_DONE = 1 << 2;
  const BIT_FULL_STORY = 1 << 3;
  const BIT_KING_SEEN = 1 << 4;

  const START_HOOK = "quest:making-history:start";

  const WRONG_ANSWER_STEP_IDS = new Set([
    "wGDach", "TtGPlq", "GYDiBb", "PgE_Go", "TiHNWS", "greVKf", "ws2VOl",
    "uqH7Jw", "oYzxwv", "5HcaLu", "8Tv5r2", "6vr4KG", "Swu3NW", "HDQk6C",
    "gQs5C7", "cFtl46", "_3oMUw", "EnC65O", "4saBHF",
  ]);
  const DIG_MESSAGE_STEP = "qDSqmk";
  const CHEST_OPENED_MESSAGE_STEP = "CpO-Pc";
  const RECEIVE_JOURNAL_STEP = "RgX_fS";
  const RECEIVE_SCROLL_STEPS = new Set(["RNo3Eh", "bAPjYf"]);
  const DROP_SCROLL_STEP = "zc9Rw_";
  const JOURNAL_READ_STEP = "o3ZNzz";
  const SCROLL_READ_STEP = "-yT7qi";
  const RECEIVE_JORRAL_LETTER_STEPS = new Set(["pmH3ww", "FvpA_Y"]);
  const RECEIVE_KING_LETTER_STEP = "bbreqL";
  const MELINA_TAKES_AMULET_STEP = "Uu67E-";
  const DROALAK_FADES_STEP = "tsNvdU";
  const COMPLETE_STEP = "pMj4WQ";

  // Enchanted key "Feel" conditions, in variant order.
  const ABSOLUTE_STEP_IDS = ["wPalrl", "LkzTaF", "ylnnaL", "nRVZPr", "tBNM2n", "P2_Key"];
  const RELATIVE_FURTHER_STEP_IDS = ["1E-2e9", "gG5vHe", "nATeK8", "w69_Wp", "NTxYzf"];
  const RELATIVE_CLOSER_STEP_IDS = ["wTddPu", "rU9WUS", "SetUBu", "kh0PB_", "x7MiE_"];
  const KEY_ABSOLUTE_VARIANT = "navigating-with-the-enchanted-key-interacting-with-the-key-for-the-first-time";
  const KEY_RELATIVE_VARIANT = "navigating-with-the-enchanted-key-after-interacting-with-the-key";
  const KEY_FINDING_VARIANT = "navigating-with-the-enchanted-key-finding-the-chest";

  // Transient context for conditions the runtime cannot tell apart by stepId alone.
  const dialogueModes = new WeakMap();
  // Owner-only King Lathas, spawned while the player has business with him.
  const kingLathasByPlayer = new Map();
  // Players with the last-person conversation already queued after a hand-in.
  const lastPersonQueued = new WeakSet();

  const held = (player, itemId, amount = 1) => player.getInventory().getAmount(itemId) >= amount;

  function freeSlots(player) {
    const inventory = player.getInventory();
    return typeof inventory.getFreeSlots === "function"
      ? inventory.getFreeSlots()
      : inventory.isFull()
        ? 0
        : 1;
  }

  function trader(player) {
    return Number(player.getAttribute(TRADER_ATTRIBUTE)) || 0;
  }

  function ghost(player) {
    return Number(player.getAttribute(GHOST_ATTRIBUTE)) || 0;
  }

  function warr(player) {
    return Number(player.getAttribute(WARR_ATTRIBUTE)) || 0;
  }

  function bits(player) {
    return Number(player.getAttribute(BITS_ATTRIBUTE)) || 0;
  }

  function hasBit(player, bit) {
    return (bits(player) & bit) !== 0;
  }

  function setBit(player, bit) {
    player.setAttribute(BITS_ATTRIBUTE, bits(player) | bit);
  }

  function setTrader(player, value) {
    if (trader(player) >= value) return;
    player.setAttribute(TRADER_ATTRIBUTE, value);
    player.getPacketSender().sendVarbit(VARBIT_TRADER_PROGRESS, value);
  }

  function setGhost(player, value) {
    if (ghost(player) >= value) return;
    player.setAttribute(GHOST_ATTRIBUTE, value);
    player.getPacketSender().sendVarbit(VARBIT_GHOST_PROGRESS, value);
  }

  function setWarr(player, value) {
    if (warr(player) >= value) return;
    player.setAttribute(WARR_ATTRIBUTE, value);
    player.getPacketSender().sendVarbit(VARBIT_WARR_PROGRESS, value);
  }

  /** Re-send the per-path progress varbits from the persisted attributes. */
  function sendProgressVarbits(player) {
    const packet = player.getPacketSender();
    packet.sendVarbit(VARBIT_TRADER_PROGRESS, trader(player));
    packet.sendVarbit(VARBIT_WARR_PROGRESS, warr(player));
    packet.sendVarbit(VARBIT_GHOST_PROGRESS, ghost(player));
  }

  function wearingGhostspeak(player) {
    return player.getEquipment().get(Equipment.AMULET_SLOT)?.getId?.() === GHOSTSPEAK_AMULET;
  }

  function meetsRequirements(player) {
    const quests = getRegisteredQuests();
    const complete = (key) => quests.some((entry) => entry.key === key && entry.isComplete(player));
    return complete("the_restless_ghost") && complete("priest_in_peril");
  }

  function allInformationDone(player) {
    return hasBit(player, BIT_JOURNAL_DONE) && hasBit(player, BIT_SCROLL_DONE) && hasBit(player, BIT_WARR_DONE);
  }

  function digDistance(player) {
    const location = player.getLocation();
    return Math.max(Math.abs(location.getX() - DIG_X), Math.abs(location.getY() - DIG_Y));
  }

  function atDigSpot(player) {
    const location = player.getLocation();
    return (
      location.getZ() === 0 && Math.max(Math.abs(location.getX() - DIG_X), Math.abs(location.getY() - DIG_Y)) <= DIG_RADIUS
    );
  }

  function absoluteTier(distance) {
    if (distance <= DIG_RADIUS) return 0;
    if (distance <= 50) return 1;
    if (distance <= 100) return 2;
    if (distance <= 150) return 3;
    if (distance <= 200) return 4;
    return 5;
  }

  function relativeTier(distance) {
    return Math.max(1, absoluteTier(distance));
  }

  function afterDialogue(player, action, attempts = 50) {
    const { CountdownTask, TaskManager } = api.core;
    if (!CountdownTask || !TaskManager) {
      action();
      return;
    }
    TaskManager.submit(
      new CountdownTask({}, 1, () => {
        if (player.isRegistered?.() === false) return;
        if (player.getDialogueManager().isActive() && attempts > 0) {
          afterDialogue(player, action, attempts - 1);
          return;
        }
        action();
      })
    );
  }

  function playVariant(player, npcId, variant) {
    return startTranscript(api, player, npcId, PAGE, variant);
  }

  /**
   * HandInTheSand's global condition handler answers any prose containing
   * "inventory space" before this plugin's hook is consulted, and its fixed
   * polarity is wrong for Droalak's "has enough inventory space". The
   * Droalak/Melina variants are therefore replayed with their conditions
   * resolved here and inlined, so the shared hook never sees them; the wiki
   * words are untouched.
   */
  function chooseConditionBranch(player, condition) {
    const answer =
      answerDroalakCondition(player, condition.id) ?? answerMelinaCondition(player, condition.id);
    return answer === true ? condition.steps ?? [] : null;
  }

  function inlineConditions(steps, player) {
    if (!Array.isArray(steps)) return [];
    const out = [];
    for (let index = 0; index < steps.length; index++) {
      const step = steps[index];
      if (!step) continue;
      if (step.type === "condition") {
        const run = [step];
        let next = index + 1;
        while (steps[next]?.type === "condition") run.push(steps[next++]);
        index = next - 1;
        let chosen = null;
        for (const condition of run) {
          chosen = chooseConditionBranch(player, condition);
          if (chosen) break;
        }
        if (chosen) out.push(...inlineConditions(chosen, player));
        continue;
      }
      const copy = { ...step };
      if (Array.isArray(copy.steps)) copy.steps = inlineConditions(copy.steps, player);
      if (Array.isArray(copy.options)) {
        copy.options = copy.options.map((option) => ({ ...option, steps: inlineConditions(option.steps, player) }));
      }
      out.push(copy);
    }
    return out;
  }

  function playGhostVariant(player, npcId, variant) {
    api.emitCustomEvent("npc-dialogue:start", {
      player,
      npcId,
      variant,
      select: (steps) => inlineConditions(steps, player),
    });
  }

  function playDronQuiz(player) {
    api.emitCustomEvent("npc-dialogue:start", {
      player,
      npcId: DRON_NPC_ID,
      variant: "talking-to-dron-talking-to-dron-again",
    });
  }

  // ==========================================================================
  // Variant selection
  // ==========================================================================

  function jorralVariant(player, stage) {
    if (stage >= STAGE_COMPLETE) return { page: JORRAL_PAGE, variant: "after-making-history" };
    if (stage < STAGE_STARTED) return "starting-off-talking-to-jorral";
    if (allInformationDone(player) && !hasBit(player, BIT_FULL_STORY)) {
      return "after-talking-to-the-last-person";
    }
    if (hasBit(player, BIT_FULL_STORY)) {
      if (hasBit(player, BIT_KING_SEEN)) return "delivering-the-letter-to-jorral";
      if (held(player, JORRAL_LETTER)) {
        return "after-talking-to-the-last-person-talking-to-jorral-again";
      }
      return "after-talking-to-the-last-person"; // the letter was lost: another copy
    }
    if (held(player, JOURNAL) && !hasBit(player, BIT_JOURNAL_DONE)) return KEY_FINDING_VARIANT;
    if (held(player, CHEST)) return KEY_FINDING_VARIANT;
    if (held(player, SCROLL) && !hasBit(player, BIT_SCROLL_DONE)) {
      return "talking-to-droalak-talking-to-jorral";
    }
    if (warr(player) >= WARR_QUIZ && !hasBit(player, BIT_WARR_DONE)) {
      return "talking-to-dron-talking-to-jorral-after-receiving-information-from-dron";
    }
    return "starting-off-talking-to-jorral-again-after-getting-the-information";
  }

  function erinVariant(player, stage) {
    if (stage >= STAGE_COMPLETE) return { page: SILVER_MERCHANT_PAGE, variant: "after-making-history" };
    if (stage < STAGE_STARTED) return null;
    if (held(player, JOURNAL)) return KEY_FINDING_VARIANT;
    if (trader(player) <= TRADER_NONE) return "talking-to-erin";
    return "talking-to-erin-talking-to-erin-again";
  }

  function dronVariant(player, stage) {
    if (stage >= STAGE_COMPLETE) return { page: DRON_PAGE, variant: "standard-dialogue-after-making-history" };
    if (stage < STAGE_STARTED) return null;
    if (warr(player) <= WARR_NONE) return "talking-to-dron";
    return "talking-to-dron-talking-to-dron-again";
  }

  function blaninVariant(player, stage) {
    if (stage >= STAGE_COMPLETE) return { page: BLANIN_PAGE, variant: "after-making-history" };
    if (stage < STAGE_STARTED) return null;
    return "talking-to-dron-talking-to-blanin";
  }

  function lathasVariant(player, stage) {
    if (stage >= STAGE_COMPLETE) return { page: KING_LATHAS_PAGE, variant: "standard-dialogue" };
    if (stage < STAGE_STARTED || !hasBit(player, BIT_FULL_STORY)) return null;
    if (hasBit(player, BIT_KING_SEEN) && held(player, KING_LETTER)) {
      return "talking-to-king-lathas-talking-to-king-lathas-again";
    }
    return "talking-to-king-lathas";
  }

  function selectVariant({ npcId, player }) {
    const stage = quest.getStage(player);
    if (npcId === JORRAL_NPC_ID) return jorralVariant(player, stage);
    if (SILVER_MERCHANT_NPC_IDS.has(npcId)) return erinVariant(player, stage);
    if (npcId === DRON_NPC_ID) return dronVariant(player, stage);
    if (npcId === BLANIN_NPC_ID) return blaninVariant(player, stage);
    if (KING_LATHAS_NPC_IDS.has(npcId)) return lathasVariant(player, stage);
    // Fallback for the indexed ghost ids if Talk-to ever reaches the generic
    // handler instead of the plugin's intercept: the fade page must stay reachable.
    if (quest.isComplete(player)) {
      if (DROALAK_NPC_IDS.has(npcId)) return "post-quest-dialogue-talking-to-drolak";
      if (MELINA_NPC_IDS.has(npcId)) return "talking-to-droalak-talking-to-melina";
    }
    return null;
  }

  // ==========================================================================
  // Condition answers
  // ==========================================================================

  function answerJorralCondition(player, stepId) {
    switch (stepId) {
      case "rh-9rb":
        return false; // no master-clue hot/cold support here
      case "PwpLer":
        return !meetsRequirements(player);
      case "vVZ0NF":
        return meetsRequirements(player);
      // The last-person conversation is replayed by the plugin once every
      // hand-in is done; the transcript's cross-reference step is not runnable.
      case "XYIvx0":
      case "6iDOaH":
      case "nMSvQw":
        return false;
      case "jH2gBM":
        return held(player, CHEST) && !held(player, JOURNAL);
      case "NMqy3p":
        return held(player, JOURNAL) && !hasBit(player, BIT_JOURNAL_DONE);
      case "3M2GSi":
        return freeSlots(player) < 1;
      case "SbiDA6":
        return freeSlots(player) >= 1;
      case "-Um3r4":
        return false;
      case "2f-Nnz":
        return hasBit(player, BIT_KING_SEEN) && !held(player, KING_LETTER);
      case "Dr9Mvh":
        return held(player, KING_LETTER);
      // Key "Feel"/dig conditions belong to the key handler, not Jorral's talk.
      case "7eJupI":
      case "mNP0yr":
      case "CKCM76":
      case "LWdlYa":
      case "AFvMTo":
      case "m0t7Hg":
        return false;
      default:
        return null;
    }
  }

  function answerErinCondition(player, stepId) {
    switch (stepId) {
      case "ZWK7Se":
        return false; // stall theft is not tracked
      case "hkJriY":
        return true;
      case "m0t7Hg":
        return held(player, JOURNAL);
      case "7eJupI":
      case "mNP0yr":
      case "CKCM76":
      case "LWdlYa":
      case "jH2gBM":
      case "AFvMTo":
      case "NMqy3p":
        return false;
      default:
        return null;
    }
  }

  function answerDroalakCondition(player, stepId) {
    const wearing = wearingGhostspeak(player);
    switch (stepId) {
      case "iW5n6C":
      case "6xzPki":
        return !wearing;
      case "fZC1QO":
        return wearing && ghost(player) <= GHOST_NONE;
      case "hM1g9O":
        return wearing && ghost(player) >= GHOST_ASKED;
      case "ZDUkRW":
        return held(player, SAPPHIRE_AMULET_U);
      case "4aqOvO":
        return held(player, SAPPHIRE_AMULET);
      case "b3wwxh":
        return !held(player, SAPPHIRE_AMULET_U) && !held(player, SAPPHIRE_AMULET);
      case "axFcOE":
        return false;
      case "TpGMMm":
        return wearing && ghost(player) === GHOST_AMULET && !held(player, SCROLL);
      case "spIjDE":
        return freeSlots(player) < 1;
      case "sO38jY":
        return freeSlots(player) >= 1;
      case "zAXn1L":
        return (
          wearing &&
          ghost(player) >= GHOST_SCROLL &&
          !held(player, SCROLL) &&
          !hasBit(player, BIT_SCROLL_DONE)
        );
      case "2qi9sq":
        return held(player, SCROLL);
      default:
        return null;
    }
  }

  function answerMelinaCondition(player, stepId) {
    const wearing = wearingGhostspeak(player);
    const hasAmulet = held(player, SAPPHIRE_AMULET);
    switch (stepId) {
      case "oY8tbR":
        return !wearing;
      case "aRPttN":
        return wearing;
      case "8xqcbg":
        return !hasAmulet || ghost(player) < GHOST_ASKED;
      case "CO8UVi":
        return hasAmulet && ghost(player) >= GHOST_ASKED;
      default:
        return null;
    }
  }

  function answerLathasCondition(player, stepId) {
    switch (stepId) {
      case "pK4P4-":
        return !held(player, JORRAL_LETTER) && !hasBit(player, BIT_KING_SEEN);
      case "AhLosO":
        return held(player, JORRAL_LETTER);
      case "89QH2K":
        return hasBit(player, BIT_KING_SEEN) && !held(player, KING_LETTER);
      default:
        return null;
    }
  }

  function answerKeyCondition(player, mode, stepId) {
    if (mode.kind === "absolute") {
      return stepId === ABSOLUTE_STEP_IDS[absoluteTier(mode.distance)];
    }
    if (mode.kind === "relative") {
      const tier = relativeTier(mode.distance);
      const ids = mode.distance <= mode.last ? RELATIVE_CLOSER_STEP_IDS : RELATIVE_FURTHER_STEP_IDS;
      return stepId === ids[tier - 1];
    }
    switch (stepId) {
      case "7eJupI":
        return mode.why === "dig";
      case "mNP0yr":
        return mode.why === "chest";
      case "CKCM76":
        return mode.why === "delivered";
      case "LWdlYa":
        return mode.why === "journal";
      case "AFvMTo":
        return mode.why === "open";
      case "jH2gBM":
      case "m0t7Hg":
      case "NMqy3p":
        return false;
      default:
        return null;
    }
  }

  function answerCondition(event) {
    const { npcId, player, stepId } = event;
    const mode = dialogueModes.get(player);
    if (mode) return answerKeyCondition(player, mode, stepId);
    if (npcId === JORRAL_NPC_ID) return answerJorralCondition(player, stepId);
    if (SILVER_MERCHANT_NPC_IDS.has(npcId)) return answerErinCondition(player, stepId);
    if (DROALAK_NPC_IDS.has(npcId)) return answerDroalakCondition(player, stepId);
    if (MELINA_NPC_IDS.has(npcId)) return answerMelinaCondition(player, stepId);
    if (KING_LATHAS_NPC_IDS.has(npcId)) return answerLathasCondition(player, stepId);
    return null;
  }

  // ==========================================================================
  // Quest actions
  // ==========================================================================

  function handleStartHook({ player, npcId, hook }) {
    if (npcId !== JORRAL_NPC_ID || hook !== START_HOOK) return;
    if (quest.getStage(player) >= STAGE_STARTED) return;
    // A fresh run after ::quest reset starts from clean progress and presence.
    player.setAttribute(TRADER_ATTRIBUTE, 0);
    player.setAttribute(GHOST_ATTRIBUTE, 0);
    player.setAttribute(WARR_ATTRIBUTE, 0);
    player.setAttribute(BITS_ATTRIBUTE, 0);
    player.setAttribute(KEY_LAST_ATTRIBUTE, -1);
    sendProgressVarbits(player);
    player.getPacketSender().sendVarbit(VARBIT_MELINA_PRESENT, 0);
    player.getPacketSender().sendVarbit(VARBIT_DROALAK_PRESENT, 0);
    quest.setStage(player, STAGE_STARTED);
  }

  function maybeQueueLastPerson(player) {
    if (hasBit(player, BIT_FULL_STORY) || lastPersonQueued.has(player)) return;
    if (!allInformationDone(player)) return;
    lastPersonQueued.add(player);
    afterDialogue(player, () => {
      lastPersonQueued.delete(player);
      if (quest.isComplete(player) || hasBit(player, BIT_FULL_STORY)) return;
      playVariant(player, JORRAL_NPC_ID, "after-talking-to-the-last-person");
    });
  }

  function ensureKingLathas(player) {
    if (!player || quest.getStage(player) < STAGE_STARTED || quest.isComplete(player)) return;
    if (!hasBit(player, BIT_FULL_STORY) || held(player, KING_LETTER)) return;
    if (kingLathasByPlayer.has(player)) return;
    const npc = api.spawnNpc({
      id: NpcIdentifiers.KING_LATHAS,
      x: KING_LATHAS_SPAWN.x,
      y: KING_LATHAS_SPAWN.y,
      z: KING_LATHAS_SPAWN.z,
      wanderRadius: 0,
      owner: player,
      ownerOnly: true,
    });
    if (npc) kingLathasByPlayer.set(player, npc);
  }

  function removeKingLathas(player) {
    const npc = kingLathasByPlayer.get(player);
    if (npc) api.removeNpc(npc);
    kingLathasByPlayer.delete(player);
  }

  function dropScrollOnGround(player) {
    const groundItems = api.getItemOnGroundManager();
    if (groundItems?.registerLocation) {
      groundItems.registerLocation(player, new Item(SCROLL, 1), player.getLocation().clone());
    }
  }

  function handleAction(event) {
    const { player, stepId } = event;
    if (stepId === null || stepId === undefined) return;
    if (event.kind === "message" && stepId === DIG_MESSAGE_STEP) {
      if (!held(player, CHEST) && !held(player, JOURNAL) && !hasBit(player, BIT_JOURNAL_DONE)) {
        player.getInventory().adds(CHEST, 1);
        setTrader(player, TRADER_CHEST);
      }
      return;
    }
    if (event.kind === "message" && stepId === CHEST_OPENED_MESSAGE_STEP) {
      player.getInventory().deleteNumber(CHEST, 1);
      return;
    }
    if (stepId === RECEIVE_JOURNAL_STEP) {
      event.handled = true;
      player.getInventory().deleteNumber(CHEST, 1);
      if (!held(player, JOURNAL)) player.getInventory().adds(JOURNAL, 1);
      setTrader(player, TRADER_JOURNAL);
      return;
    }
    if (RECEIVE_SCROLL_STEPS.has(stepId)) {
      event.handled = true;
      if (!held(player, SCROLL)) player.getInventory().adds(SCROLL, 1);
      setGhost(player, GHOST_SCROLL);
      return;
    }
    if (stepId === DROP_SCROLL_STEP) {
      event.handled = true;
      dropScrollOnGround(player);
      setGhost(player, GHOST_SCROLL);
      return;
    }
    if (event.kind === "message" && stepId === JOURNAL_READ_STEP) {
      setBit(player, BIT_JOURNAL_DONE);
      maybeQueueLastPerson(player);
      return;
    }
    if (event.kind === "message" && stepId === SCROLL_READ_STEP) {
      setBit(player, BIT_SCROLL_DONE);
      maybeQueueLastPerson(player);
      return;
    }
    if (RECEIVE_JORRAL_LETTER_STEPS.has(stepId)) {
      event.handled = true;
      if (!held(player, JORRAL_LETTER)) player.getInventory().adds(JORRAL_LETTER, 1);
      ensureKingLathas(player);
      return;
    }
    if (stepId === RECEIVE_KING_LETTER_STEP) {
      event.handled = true;
      player.getInventory().deleteNumber(JORRAL_LETTER, 1);
      if (!held(player, KING_LETTER)) player.getInventory().adds(KING_LETTER, 1);
      setBit(player, BIT_KING_SEEN);
      return;
    }
    if (stepId === MELINA_TAKES_AMULET_STEP) {
      event.handled = true;
      player.getInventory().deleteNumber(SAPPHIRE_AMULET, 1);
      setGhost(player, GHOST_AMULET);
      player.getPacketSender().sendVarbit(VARBIT_MELINA_PRESENT, 1);
      return;
    }
    if (stepId === DROALAK_FADES_STEP) {
      event.handled = true;
      player.getPacketSender().sendVarbit(VARBIT_DROALAK_PRESENT, 1);
      return;
    }
    if (stepId === COMPLETE_STEP) {
      event.handled = true;
      event.end = true;
      player.getInventory().deleteNumber(KING_LETTER, 1);
      removeKingLathas(player);
      if (!quest.isComplete(player)) quest.complete(player);
      return;
    }
    if (WRONG_ANSWER_STEP_IDS.has(stepId)) {
      event.handled = true;
      event.end = true;
      // Play Dron's insult, then reopen the quiz so a wrong answer does not
      // strand the player outside the conversation.
      afterDialogue(player, () => {
        if (quest.isComplete(player)) return;
        playVariant(player, DRON_NPC_ID, "talking-to-dron-if-the-player-chooses-the-wrong-option");
        afterDialogue(player, () => {
          if (!quest.isComplete(player)) playDronQuiz(player);
        });
      });
    }
  }

  /** Erin's first "Ask about the outpost" hands over the enchanted key. */
  function handleDialogueChoice(event) {
    const { player, npcId, option } = event;
    if (!SILVER_MERCHANT_NPC_IDS.has(npcId)) return;
    if (trader(player) > TRADER_NONE) return;
    if (!/ask about the outpost/i.test(String(option ?? ""))) return;
    if (held(player, ENCHANTED_KEY)) {
      setTrader(player, TRADER_KEY);
      return;
    }
    if (freeSlots(player) < 1) {
      player.sendMessage("You need more inventory space to take the key.");
      return;
    }
    player.getInventory().adds(ENCHANTED_KEY, 1);
    setTrader(player, TRADER_KEY);
  }

  function handleDialogueLine(event) {
    const { player, npcId, text } = event;
    if (typeof text !== "string") return;
    if (npcId === JORRAL_NPC_ID) {
      if (text.startsWith("I've talked to the warrior.")) {
        setBit(player, BIT_WARR_DONE);
        maybeQueueLastPerson(player);
      } else if (text.startsWith("It all makes sense now")) {
        setBit(player, BIT_FULL_STORY);
      }
      return;
    }
    if (npcId === DRON_NPC_ID && text.startsWith("Very well, you seem to know me")) {
      setWarr(player, WARR_QUIZ);
      return;
    }
    if (npcId === BLANIN_NPC_ID && text.startsWith("I know this sounds strange")) {
      setWarr(player, WARR_BRIEFED);
      return;
    }
    if (DROALAK_NPC_IDS.has(npcId) && text.startsWith("OK, well perhaps you could give her a strung sapphire amulet")) {
      setGhost(player, GHOST_ASKED);
      return;
    }
    if (KING_LATHAS_NPC_IDS.has(npcId) && text.startsWith("Very well, take another.")) {
      if (!held(player, KING_LETTER)) player.getInventory().adds(KING_LETTER, 1);
      setBit(player, BIT_KING_SEEN);
    }
  }

  /** Fill the wiki's "[player name]" blank (as ForsakenTower's filler does). */
  function fillTranscriptBlanks(request) {
    if (!request?.player || typeof request.text !== "string") return;
    const { npcId } = request;
    const ours =
      npcId === JORRAL_NPC_ID ||
      npcId === DRON_NPC_ID ||
      npcId === BLANIN_NPC_ID ||
      SILVER_MERCHANT_NPC_IDS.has(npcId) ||
      KING_LATHAS_NPC_IDS.has(npcId) ||
      DROALAK_NPC_IDS.has(npcId) ||
      MELINA_NPC_IDS.has(npcId);
    if (!ours) return;
    if (request.text.includes("[player name]")) {
      request.text = request.text.replace(/\[player name\]/gi, String(request.player.getUsername()));
    }
  }

  // ==========================================================================
  // Gameplay interactions
  // ==========================================================================

  function playKeyVariant(player, mode, variant) {
    dialogueModes.set(player, mode);
    try {
      playVariant(player, JORRAL_NPC_ID, variant);
    } finally {
      dialogueModes.delete(player);
    }
  }

  function playKeyDetail(player, why) {
    playKeyVariant(player, { kind: "finding", why }, KEY_FINDING_VARIANT);
  }

  function handleFeel(event) {
    const { player } = event;
    if (!held(player, ENCHANTED_KEY)) return false;
    if (quest.getStage(player) < STAGE_STARTED || quest.isComplete(player)) return false;
    if (hasBit(player, BIT_JOURNAL_DONE) && !held(player, JOURNAL)) {
      playKeyDetail(player, "delivered");
      return;
    }
    if (held(player, JOURNAL)) {
      playKeyDetail(player, "journal");
      return;
    }
    if (trader(player) >= TRADER_CHEST && !hasBit(player, BIT_JOURNAL_DONE)) {
      playKeyDetail(player, "chest");
      return;
    }
    const distance = digDistance(player);
    const last = Number(player.getAttribute(KEY_LAST_ATTRIBUTE));
    if (Number.isFinite(last) && last >= 0) {
      playKeyVariant(player, { kind: "relative", distance, last }, KEY_RELATIVE_VARIANT);
    } else {
      playKeyVariant(player, { kind: "absolute", distance }, KEY_ABSOLUTE_VARIANT);
    }
    player.setAttribute(KEY_LAST_ATTRIBUTE, distance);
    return;
  }

  function handleDig(event) {
    const { player } = event;
    if (quest.getStage(player) < STAGE_STARTED || quest.isComplete(player)) return false;
    if (!atDigSpot(player) || !held(player, ENCHANTED_KEY)) return false;
    event.handled = true;
    if (hasBit(player, BIT_JOURNAL_DONE) && !held(player, JOURNAL)) {
      playKeyDetail(player, "delivered");
      return;
    }
    if (held(player, JOURNAL)) {
      playKeyDetail(player, "journal");
      return;
    }
    if (held(player, CHEST)) {
      playKeyDetail(player, "chest");
      return;
    }
    if (freeSlots(player) < 1) {
      player.sendMessage("You need more inventory space to dig up the chest.");
      return;
    }
    playKeyDetail(player, "dig");
  }

  function handleItemOnItem(event) {
    const { player } = event;
    const first = event.usedItemId;
    const second = event.usedWithItemId;
    const keyOnChest = (first === ENCHANTED_KEY && second === CHEST) || (first === CHEST && second === ENCHANTED_KEY);
    if (!keyOnChest) return;
    event.handled = true;
    if (quest.getStage(player) < STAGE_STARTED || quest.isComplete(player)) return;
    if (hasBit(player, BIT_JOURNAL_DONE)) {
      player.sendMessage("You've already delivered the journal.");
      return;
    }
    if (held(player, JOURNAL)) {
      player.sendMessage("You already have the journal.");
      return;
    }
    playKeyDetail(player, "open");
  }

  function handleItemOnNpc(event) {
    if (event.itemId !== SAPPHIRE_AMULET || !MELINA_NPC_IDS.has(event.npcId)) return;
    const { player } = event;
    if (quest.getStage(player) < STAGE_STARTED || quest.isComplete(player)) return;
    event.handled = true;
    playGhostVariant(player, NpcIdentifiers.MELINA_2, "talking-to-droalak-talking-to-melina");
  }

  function interactionOption(event) {
    const actions = event.definition?.getActions?.() ?? [];
    const slot = Number(event.clickType) - 1;
    return String(actions[slot] ?? "").toLowerCase();
  }

  function playDroalak(player) {
    const variant = quest.isComplete(player)
      ? "post-quest-dialogue-talking-to-drolak"
      : ghost(player) < GHOST_AMULET
        ? "talking-to-droalak"
        : "talking-to-droalak-talking-to-droalak-again";
    playGhostVariant(player, NpcIdentifiers.DROALAK_2, variant);
  }

  function handleNpcInteraction(event) {
    const { player, npcId } = event;
    const ghostNpc = DROALAK_NPC_IDS.has(npcId) || MELINA_NPC_IDS.has(npcId);
    if (ghostNpc) {
      // The Port Phasmatys multi-NPCs can resolve to a nameless parent whose
      // actions are empty; keep owning them on the Talk-to slot (slot 1).
      if (Number(event.clickType) !== 1) return;
    } else if (interactionOption(event) !== "talk-to") {
      return;
    }
    if (quest.getStage(player) < STAGE_STARTED) return;
    if (npcId === DRON_NPC_ID) {
      event.handled = true;
      if (quest.isComplete(player)) {
        startTranscript(api, player, DRON_NPC_ID, DRON_PAGE, "standard-dialogue-after-making-history");
      } else if (warr(player) <= WARR_NONE) {
        playVariant(player, DRON_NPC_ID, "talking-to-dron");
      } else {
        playDronQuiz(player);
      }
      return;
    }
    if (DROALAK_NPC_IDS.has(npcId)) {
      // Post-quest without the amulet the generic "Droalak" page has the right speech.
      if (quest.isComplete(player) && !wearingGhostspeak(player)) return;
      event.handled = true;
      playDroalak(player);
      return;
    }
    if (MELINA_NPC_IDS.has(npcId)) {
      event.handled = true;
      playGhostVariant(player, NpcIdentifiers.MELINA_2, "talking-to-droalak-talking-to-melina");
    }
  }

  // ==========================================================================
  // Journal and rewards
  // ==========================================================================

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      return [
        "<str>Jorral asked me to uncover the history of the outpost so",
        "<str>that King Lathas would not tear it down.</str>",
        "<str>I recovered Drozal's journal and Droalak's scroll, and",
        "<str>learned the rest of the story from Dron.</str>",
        "<str>King Lathas has agreed to leave the outpost alone and",
        "<str>Jorral will turn it into a museum.</str>",
        "",
        "<col=ff0000>QUEST COMPLETE!</col>",
      ];
    }
    if (stage >= STAGE_STARTED) {
      const lines = [
        "Jorral has asked me to uncover the history of the outpost",
        "so that King Lathas will not tear it down.",
        "",
      ];
      const traderProgress = trader(player);
      if (traderProgress <= TRADER_NONE) {
        lines.push("I should ask Erin, the silver merchant in East Ardougne, about his great grandfather.");
      } else if (traderProgress === TRADER_KEY) {
        lines.push("Erin lent me an enchanted key. I should find the buried chest north of Castle Wars.");
      } else if (traderProgress === TRADER_CHEST) {
        lines.push("I dug up a chest. I should open it with the enchanted key.");
      } else if (!hasBit(player, BIT_JOURNAL_DONE)) {
        lines.push("I found a journal. I should show it to Jorral.");
      } else {
        lines.push("<str>I have shown the journal to Jorral.</str>");
      }
      const ghostProgress = ghost(player);
      if (ghostProgress <= GHOST_NONE) {
        lines.push("I should find Droalak, the ghost in Port Phasmatys, and ask about the outpost.");
      } else if (ghostProgress === GHOST_ASKED) {
        lines.push("Droalak wants me to give Melina a strung sapphire amulet.");
      } else if (ghostProgress === GHOST_AMULET) {
        lines.push("I have given Melina the amulet. I should get the scroll from Droalak.");
      } else if (!hasBit(player, BIT_SCROLL_DONE)) {
        lines.push("I have Droalak's scroll. I should take it to Jorral.");
      } else {
        lines.push("<str>I have given Droalak's scroll to Jorral.</str>");
      }
      const warrProgress = warr(player);
      if (warrProgress <= WARR_NONE) {
        lines.push("I should speak to Blanin in Rellekka about his brother Dron.");
      } else if (warrProgress === WARR_BRIEFED) {
        lines.push("Blanin told me about Dron. I should answer Dron's questions.");
      } else if (!hasBit(player, BIT_WARR_DONE)) {
        lines.push("I have Dron's account of the battle. I should tell Jorral.");
      } else {
        lines.push("<str>I have told Jorral what Dron knew.</str>");
      }
      if (hasBit(player, BIT_FULL_STORY)) {
        if (hasBit(player, BIT_KING_SEEN)) {
          lines.push("I should ask King Lathas for another letter for Jorral.");
        } else if (held(player, KING_LETTER)) {
          lines.push("I should take King Lathas's letter back to Jorral.");
        } else if (held(player, JORRAL_LETTER)) {
          lines.push("I should deliver Jorral's letter to King Lathas at Ardougne Castle.");
        } else {
          lines.push("I should ask Jorral for another letter for King Lathas.");
        }
      }
      return lines;
    }
    return [
      "I can start this quest by talking to <col=800000>Jorral</col> at the",
      "<col=800000>Outpost</col> north-west of Ardougne.",
    ];
  }

  function grantReward(player) {
    // registerQuest adds one coin for rewardItemId; top the reward up to 750.
    player.getInventory().adds(COINS, 749);
    player.getSkillManager().addExperiences(Skill.CRAFTING, 1000);
    player.getSkillManager().addExperiences(Skill.PRAYER, 1000);
  }

  function handleLogin({ player }) {
    refreshQuestList(player);
    sendProgressVarbits(player);
    ensureKingLathas(player);
  }

  function handleLogout({ player }) {
    removeKingLathas(player);
  }

  api.persistAttribute(TRADER_ATTRIBUTE);
  api.persistAttribute(GHOST_ATTRIBUTE);
  api.persistAttribute(WARR_ATTRIBUTE);
  api.persistAttribute(BITS_ATTRIBUTE);
  api.persistAttribute(KEY_LAST_ATTRIBUTE);

  const quest = registerQuest(api, {
    key: "making_history",
    name: "Making History",
    varpId: VARP_MAKING_HISTORY,
    varbitId: VARBIT_PROGRESS,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 3,
    xpRewards: [
      { skillId: Skill.CRAFTING.getIndex(), amount: 1000, label: "Crafting" },
      { skillId: Skill.PRAYER.getIndex(), amount: 1000, label: "Prayer" },
    ],
    rewardItemId: COINS,
    rewardItemLabel: "750 Coins",
    otherRewards: ["The enchanted key", "Access to the outpost museum"],
    buildJournal,
    onReward: grantReward,
  });

  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onCustomEvent("npc-dialogue:line", handleDialogueLine);
  api.onCustomEvent("npc-dialogue:line", fillTranscriptBlanks);
  api.onCustomEvent("npc-dialogue:choice", handleDialogueChoice);
  api.onNpcInteraction(handleNpcInteraction);
  api.onItemAction("Enchanted key", { Feel: handleFeel });
  api.onItemAction("Spade", { Dig: handleDig });
  api.onItemOnItem(handleItemOnItem);
  api.onItemOnNpc(handleItemOnNpc);
  api.onPlayerLogin(handleLogin);
  api.onPlayerLogout(handleLogout);
};
