const { ownsStoredKey } = require("../../items/KeyAvailability");
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
 * Durable stage (attribute) is 1 started, 2 complete, but the canonical wire
 * "makinghistory_prog" (varbit 1383) is 0 not started, 1 started, 2 the letter
 * to King Lathas is held, 3 King Lathas's reply is held and 4 complete - the
 * cache completion threshold (quest DB row 92, column 19). The finer progress
 * lives in persisted attributes and is mirrored to the real sibling varbits
 * with sendVarbit as it advances; all of them are bit fields of varp 604
 * (cache: 1383 bits 0-2, 1384 bits 3-5, 1385 bits 6-8, 1386 bits 9-12,
 * 1387 bit 13, 1388 bit 14, 1390 objloc bit 20), so the server keeps the
 * sibling bits when one of them is written. The wire values are live's
 * (RSProx capture 20261111T015053-5ab63b4, rev 242, start to reward; facts by tick in
 * docs/quests/making-history/README.md): 1384 trader 1 key / 2 chest (opening it
 * keeps 2) / 4 journal read by Jorral, 1385 warr 2 Blanin / 3 Dron / 4 told to
 * Jorral, 1386 ghost 2 Droalak / 4 Melina / 5 scroll / 6 scroll read by Jorral.
 * Each moves on the continue past its line, as live sends it. Melina/Droalak
 * presence is driven through their multi-NPC transform varbits (1387/1388), so
 * they vanish for the player without touching the shared spawn. 1390 objloc
 * turns the outpost into the museum at the finale's fade in, and enchantedkey
 * (13717) is set on completion.
 *
 * From the capture: Jorral's "Tell me more." plays the camera tour with the
 * transcript's Narration lines as fade-overlay captions
 * (makinghistory/Cutscene.MakingHistory.js); the dig and the key on the chest
 * are message boxes whose continue hands the chest / journal over; Dron's wrong
 * answers end the talk with one of his insults; Jorral takes every piece the
 * player brings in one talk (journal, Dron's story, scroll, then the whole
 * story and the letter), with a fade after "Well..." and before the museum.
 *
 * Rewards: 3 Quest points, 1,000 Prayer XP, 1,000 Crafting XP, 750 coins and
 * the enchanted key (the scroll shows the key). The key is Erin's, so it is
 * only handed over when the player does not hold one; a lost key is bought back
 * from the silver merchant for 500 coins (the wiki's own post-quest conversation).
 *
 * Gaps: the requirements (Priest in Peril and The Restless Ghost) are checked
 * through public quest queries; post-quest treasures are attached in
 * makinghistory/EnchantedKey.MakingHistory; the master-clue condition is
 * answered false; Dron's "North West side of town" wrong answer is a transcript
 * "unavailable" marker and closes silently; the hot/cold Feel messages and a key
 * lost before the journal are not in the capture (transcript and Quest Helper);
 * King Lathas is already in the throne room - the cache spawns
 * npc 9228 there and the client transforms it to 9005 - so the owner-only copy
 * is only spawned when that canonical NPC is missing; the Droalak/Melina
 * variants are replayed with their conditions inlined
 * because HandInTheSand's earlier global condition handler mis-answers their
 * "inventory space" branch; the post-quest Droalak fade is also selected through
 * the transcript selector for the indexed 3493/3494 fallback (the 6128
 * multi-parent can resolve nameless for a player), so if a client cannot render
 * 6128 at all after completion that is a core multi-NPC resolution issue.
 */
module.exports = function registerMakingHistoryQuest(api) {
  const { Equipment, Item, ItemIdentifiers, Location, NpcIdentifiers, Skill, World } = api.core;
  const { loadTranscripts, registerQuest, refreshQuestList, startTranscript } =
    require("../QuestRuntime");
  const { createQuestScenes } = require("../QuestScenes");

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
  const VARBIT_MUSEUM = 1390; // makinghistory_objloc, the outpost becomes the museum

  const STAGE_STARTED = 1;
  const STAGE_COMPLETE = 2;

  // Canonical varbit 1383 values (the durable stage above is not the wire value).
  const WIRE_STARTED = 1;
  const WIRE_JORRAL_LETTER = 2;
  const WIRE_KING_LETTER = 3;
  const WIRE_COMPLETE = 4;

  const JORRAL_NPC_ID = NpcIdentifiers.JORRAL; // 3490
  // The cache spawns npc 9228 in the Ardougne Castle throne room; its transform
  // varbit (9016) resolves it to 9005 "King Lathas" for every player.
  const KING_LATHAS_NATIVE_NPC_ID = 9228;
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

  // The chest's spot north of Castle Wars: Quest Helper's dig step (2442,3140); the capture
  // (20261111T015053-5ab63b4 ticks 294-313) dug it up from 2441,3140, 2442,3140, 2442,3141,
  // 2443,3140 and 2442,3139, every tile within one of it.
  const DIG_X = 2442;
  const DIG_Y = 3140;
  const DIG_RADIUS = 1;

  const KING_LATHAS_SPAWN = { x: 2579, y: 3294, z: 1 }; // Ardougne Castle throne room
  const KING_LATHAS_NATIVE_SPAWN = { x: 2578, y: 3293, z: 1 }; // the cache's own King Lathas
  const KING_LATHAS_SEARCH_RADIUS = 2;

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
  const BIT_DROALAK_GONE = 1 << 5;
  const BIT_JORRAL_LETTER_SEEN = 1 << 6;

  const START_HOOK = "quest:making-history:start";

  // Every "A random incorrect dialogue from below is shown." action in talking-to-dron-talking-to-dron-again,
  // by its id in the regenerated npc-dialogues.json (13 of the old ids no longer exist there).
  const WRONG_ANSWER_STEP_IDS = new Set([
    "wGDach", "TtGPlq", "GYDiBb", "_3oMUw", "EnC65O", "4saBHF",
    "YYdPuz", "CHhMLH", "91qTKK", "xtI1KH", "y0an97", "4gV141", "ngmyqv",
    "rGSYzg", "vuLXYx", "wOkPwO", "VAT5oQ", "UwGEVj", "SlEl4Q",
  ]);
  const DIG_MESSAGE_STEP = "qDSqmk";
  const CHEST_OPENED_MESSAGE_STEP = "CpO-Pc";
  const RECEIVE_JOURNAL_STEP = "RgX_fS";
  const RECEIVE_SCROLL_STEPS = new Set(["RNo3Eh", "bAPjYf"]);
  const DROP_SCROLL_STEP = "zc9Rw_";
  const JOURNAL_READ_STEP = "o3ZNzz";
  const SCROLL_READ_STEP = "-yT7qi";
  const FIRST_JORRAL_LETTER_STEP = "pmH3ww";
  const RECEIVE_JORRAL_LETTER_STEPS = new Set(["FvpA_Y"]);
  const RECEIVE_KING_LETTER_STEP = "bbreqL";
  const MELINA_TAKES_AMULET_STEP = "Uu67E-";
  const DROALAK_FADES_STEP = "tsNvdU";
  const COMPLETE_STEP = "pMj4WQ";
  // Message steps live shows as a message box (capture ticks 1388, 1406, 1485, 1517).
  const KING_READS_LETTER_STEP = "kP8BlW";
  const JORRAL_READS_LETTER_STEP = "D-blpi";
  // "A cutscene appears." on the Jorral page (the start talk) and on the quest page.
  const CUTSCENE_STEPS = new Set(["QNbrzb", "kXluF_"]);
  const JORRAL_START_PAGE = "Jorral";
  const JORRAL_START_VARIANT = "before-making-history";
  const JOURNAL_HAND_IN_CONDITION = "NMqy3p";
  const WARRIOR_HAND_IN_VARIANT = "talking-to-dron-talking-to-jorral-after-receiving-information-from-dron";
  const SCROLL_HAND_IN_VARIANT = "talking-to-droalak-talking-to-jorral";
  const LAST_PERSON_VARIANT = "after-talking-to-the-last-person";
  const DELIVERING_VARIANT = "delivering-the-letter-to-jorral";
  const KING_LETTER_CONDITION = "Dr9Mvh";
  /** The fade around a pause in Jorral's talk: out on the continue, in 3 ticks on, the next line 3 after. */
  const PAUSE_FADE_IN_TICKS = 3;
  const PAUSE_RESUME_TICKS = 6;
  const MESSAGE_BOX_STEPS = new Set([
    JOURNAL_READ_STEP, SCROLL_READ_STEP, KING_READS_LETTER_STEP, JORRAL_READS_LETTER_STEP,
  ]);
  // The silver merchant's post-quest conversation: he sells the key back for
  // 500 coins (give) and hands it over (receive).
  const GIVE_KEY_PRICE_STEP = "57gscX";
  const RECEIVE_ENCHANTED_KEY_STEP = "uDpunX";
  const KEY_PRICE = 500;

  // Enchanted key "Feel" conditions, in variant order.
  const ABSOLUTE_STEP_IDS = ["wPalrl", "LkzTaF", "ylnnaL", "nRVZPr", "tBNM2n", "P2_Key"];
  const RELATIVE_FURTHER_STEP_IDS = ["1E-2e9", "gG5vHe", "nATeK8", "w69_Wp", "NTxYzf"];
  const RELATIVE_CLOSER_STEP_IDS = ["wTddPu", "rU9WUS", "SetUBu", "kh0PB_", "x7MiE_"];
  const KEY_ABSOLUTE_VARIANT = "navigating-with-the-enchanted-key-interacting-with-the-key-for-the-first-time";
  const KEY_RELATIVE_VARIANT = "navigating-with-the-enchanted-key-after-interacting-with-the-key";
  const KEY_FINDING_VARIANT = "navigating-with-the-enchanted-key-finding-the-chest";
  const KEY_DETAIL_CONDITIONS = { dig: "7eJupI", chest: "mNP0yr", delivered: "CKCM76", journal: "LWdlYa", open: "AFvMTo" };

  // Transient context for conditions the runtime cannot tell apart by stepId alone.
  const dialogueModes = new WeakMap();
  // Owner-only King Lathas, spawned while the player has business with him.
  const kingLathasByPlayer = new Map();
  // What follows a pause line in Jorral's talk, played after its fade.
  const pausedTails = new WeakMap();
  // Where the start talk resumes once the opening cutscene ends.
  const pendingCutsceneTails = new WeakMap();
  const PAUSE_LINE = "Well...";
  const FINALE_PAUSE_LINE = "I can now continue with my plans for this place. Thank you.";
  const QuestFade = createQuestScenes(api);
  const Cutscene = require("../makinghistory/Cutscene.MakingHistory")(api, { onEnd: cutsceneEnded });

  const held = (player, itemId, amount = 1) => player.getInventory().getAmount(itemId) >= amount;

  const bankedKey = (player) => (player.getBanks?.() ?? []).some(
    (bank, tab) => tab !== api.core.Bank.BANK_SEARCH_TAB_INDEX && (bank?.getAmount(ENCHANTED_KEY) ?? 0) > 0
  );
  const ownsKey = (player) => held(player, ENCHANTED_KEY) || bankedKey(player) || ownsStoredKey(api, player, ENCHANTED_KEY);

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
    sendPathVarbits(player);
  }

  function setGhost(player, value) {
    if (ghost(player) >= value) return;
    player.setAttribute(GHOST_ATTRIBUTE, value);
    sendPathVarbits(player);
  }

  function setWarr(player, value) {
    if (warr(player) >= value) return;
    player.setAttribute(WARR_ATTRIBUTE, value);
    sendPathVarbits(player);
  }

  /**
   * Native wire values of the three path varbits (Quest Helper reads these):
   * 1384 trader 1 key / 2 chest / 3 journal found / 4 journal given to Jorral,
   * 1385 warr 2 Blanin / 3 Dron / 4 Dron's account given to Jorral,
   * 1386 ghost 2 Droalak / 4 Melina / 5 scroll / 6 scroll given to Jorral.
   * The durable attributes keep their own 0..3 scale; only the wire is mapped.
   */
  function traderWire(player) {
    // Opening the chest leaves the wire on 2; Jorral reading the journal takes it to 4
    // (capture ticks 315, 340, 1393: 3 is never sent).
    if (hasBit(player, BIT_JOURNAL_DONE)) return 4;
    return Math.min(trader(player), TRADER_CHEST);
  }

  function warrWire(player) {
    const value = warr(player);
    if (value >= WARR_QUIZ) return hasBit(player, BIT_WARR_DONE) ? 4 : 3;
    if (value >= WARR_BRIEFED) return 2;
    return 0;
  }

  function ghostWire(player) {
    const value = ghost(player);
    if (value >= GHOST_SCROLL) return hasBit(player, BIT_SCROLL_DONE) ? 6 : 5;
    if (value >= GHOST_AMULET) return 4;
    if (value >= GHOST_ASKED) return 2;
    return 0;
  }

  /** Send the three path progress varbits from the durable state. */
  function sendPathVarbits(player) {
    const packet = player.getPacketSender();
    packet.sendVarbit(VARBIT_TRADER_PROGRESS, traderWire(player));
    packet.sendVarbit(VARBIT_WARR_PROGRESS, warrWire(player));
    packet.sendVarbit(VARBIT_GHOST_PROGRESS, ghostWire(player));
  }

  /** Re-send the per-path progress/presence varbits from persisted state. */
  function sendProgressVarbits(player) {
    const packet = player.getPacketSender();
    sendPathVarbits(player);
    // These share varp 604 with the login bootstrap's all-spells varps.
    packet.sendVarbit(VARBIT_MELINA_PRESENT, ghost(player) >= GHOST_AMULET ? 1 : 0);
    packet.sendVarbit(VARBIT_DROALAK_PRESENT, hasBit(player, BIT_DROALAK_GONE) ? 1 : 0);
    packet.sendVarbit(VARBIT_MUSEUM, quest.isComplete(player) ? 1 : 0);
    if (quest.isComplete(player)) api.emitCustomEvent("enchanted-key:sync", { player });
  }

  function wearingGhostspeak(player) {
    return player.getEquipment().get(Equipment.AMULET_SLOT)?.getId?.() === GHOSTSPEAK_AMULET;
  }

  function meetsRequirements(player) {
    const ghost = { player, key: "the_restless_ghost", started: null };
    const priest = { player, key: "priest_in_peril", complete: null };
    api.emitCustomEvent("quest:is-started", ghost);
    api.emitCustomEvent("quest:is-complete", priest);
    // Father Urhney gives the amulet before The Restless Ghost is finished.
    return ghost.started === true && priest.complete === true;
  }

  /**
   * The canonical progress varbit is finer than the durable stage: the letter
   * steps between "started" and "complete" are visible to cache quest scripts.
   */
  function canonicalProgressValue(player) {
    if (quest.isComplete(player)) return WIRE_COMPLETE;
    if (hasBit(player, BIT_KING_SEEN)) return WIRE_KING_LETTER;
    if (hasBit(player, BIT_JORRAL_LETTER_SEEN) || held(player, JORRAL_LETTER)) return WIRE_JORRAL_LETTER;
    return quest.getStage(player) >= STAGE_STARTED ? WIRE_STARTED : 0;
  }

  function sendCanonicalProgress(player) {
    player.getPacketSender().sendVarbit(VARBIT_PROGRESS, canonicalProgressValue(player));
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

  /** Slug Menace owns Jorral while its pages are being translated. */
  function otherQuestNeedsJorral(player) {
    const request = { player, key: "the_slug_menace", stage: null };
    api.emitCustomEvent("quest:get-stage", request);
    return request.stage === 5 || request.stage === 6;
  }

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
    // Post-quest the generic King Lathas page already plays standard-dialogue;
    // return null so Regicide and Underground Pass can claim him at their steps.
    if (stage >= STAGE_COMPLETE) return null;
    if (stage < STAGE_STARTED || !hasBit(player, BIT_FULL_STORY)) return null;
    if (hasBit(player, BIT_KING_SEEN) && held(player, KING_LETTER)) {
      return "talking-to-king-lathas-talking-to-king-lathas-again";
    }
    return "talking-to-king-lathas";
  }

  function selectVariant({ npcId, player }) {
    const stage = quest.getStage(player);
    if (npcId === JORRAL_NPC_ID) {
      if (otherQuestNeedsJorral(player)) return null;
      // Before the quest starts the generic Jorral page is the canonical start
      // conversation (its own conditions and start hook), so do not shadow it.
      if (stage < STAGE_STARTED) return null;
      return jorralVariant(player, stage);
    }
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
      case "zjWUw5":
        return !meetsRequirements(player);
      case "vVZ0NF":
      case "QIdJ0k":
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

  function enchantedKeyComplete(player) {
    const request = { player, complete: false };
    api.emitCustomEvent("enchanted-key:is-complete", request);
    return request.complete === true;
  }

  function missingEarnedKeyRing(player) {
    const request = { player, requiresRing: false, ownsRing: false };
    api.emitCustomEvent("steel-key-ring:recovery", request);
    return request.requiresRing === true && request.ownsRing !== true;
  }

  function answerErinCondition(player, stepId) {
    switch (stepId) {
      case "ZWK7Se":
        return false; // stall theft is not tracked
      case "hkJriY":
        return true;
      case "m0t7Hg":
        return held(player, JOURNAL);
      // The silver merchant's post-quest conversation: without the key he
      // sells it back for 500 coins, with it he only comments on it.
      case "q_Kz9y":
        return !enchantedKeyComplete(player) && !missingEarnedKeyRing(player) && !ownsKey(player);
      case "9kVLlg":
        return held(player, ENCHANTED_KEY);
      case "PaZHfR":
        return player.getInventory().getAmount(COINS) < KEY_PRICE;
      case "PkuYso":
        return freeSlots(player) < 1;
      case "q4Kcl6":
        return !enchantedKeyComplete(player) && !missingEarnedKeyRing(player) && freeSlots(player) >= 1 && player.getInventory().getAmount(COINS) >= KEY_PRICE;
      case "hiIg7x":
        return bankedKey(player);
      case "07rNIp":
        return ownsStoredKey(api, player, ENCHANTED_KEY);
      case "APjFg8":
        return enchantedKeyComplete(player);
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
    return null;
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
    quest.setStage(player, STAGE_STARTED);
  }

  function giveJorralLetter(player) {
    if (!held(player, JORRAL_LETTER)) player.getInventory().adds(JORRAL_LETTER, 1);
    setBit(player, BIT_JORRAL_LETTER_SEEN);
    ensureKingLathas(player);
    sendCanonicalProgress(player);
  }

  // ==========================================================================
  // Jorral's hand-ins: one talk, as live plays it
  // ==========================================================================

  function variantSteps(variant) {
    const steps = loadTranscripts(api)?.[PAGE]?.variants?.[variant];
    return Array.isArray(steps) ? steps : [];
  }

  /** A hand-in's own lines: its greeting and its "if he was the last person" cross-reference go. */
  function handInBody(steps) {
    return steps.slice(2).filter((step) => step?.type !== "condition" && step?.type !== "end");
  }

  function journalHandIn() {
    const condition = variantSteps(KEY_FINDING_VARIANT).find((step) => step?.id === JOURNAL_HAND_IN_CONDITION);
    return handInBody(condition?.steps ?? []);
  }

  function journalDue(player) {
    return held(player, JOURNAL) && !hasBit(player, BIT_JOURNAL_DONE);
  }

  function warriorDue(player) {
    return warr(player) >= WARR_QUIZ && !hasBit(player, BIT_WARR_DONE);
  }

  function scrollDue(player) {
    return held(player, SCROLL) && !hasBit(player, BIT_SCROLL_DONE);
  }

  function handInDue(player) {
    return journalDue(player) || warriorDue(player) || scrollDue(player);
  }

  /**
   * Every piece the player has brought, in one talk: the journal, Dron's story and the scroll,
   * in that order, then the last-person story once all three are in (capture ticks 1384-1415).
   * Each hand-in's words are its own transcript section's, after one shared greeting.
   */
  function handInSteps(player) {
    const greeting = variantSteps(WARRIOR_HAND_IN_VARIANT).slice(0, 2);
    const steps = [...greeting];
    const journal = journalDue(player), warrior = warriorDue(player), scroll = scrollDue(player);
    if (journal) steps.push(...journalHandIn());
    if (warrior) steps.push(...handInBody(variantSteps(WARRIOR_HAND_IN_VARIANT)));
    if (scroll) steps.push(...handInBody(variantSteps(SCROLL_HAND_IN_VARIANT)));
    const all = (journal || hasBit(player, BIT_JOURNAL_DONE)) && (warrior || hasBit(player, BIT_WARR_DONE))
      && (scroll || hasBit(player, BIT_SCROLL_DONE));
    if (all) steps.push(...variantSteps(LAST_PERSON_VARIANT));
    return steps;
  }

  /** Plays `steps` as Jorral, holding what follows a pause line for after its fade. */
  function playJorralSteps(player, steps) {
    const pause = steps.findIndex((step) => step?.player === PAUSE_LINE);
    const head = pause >= 0 ? steps.slice(0, pause + 1) : steps;
    if (pause >= 0) pausedTails.set(player, steps.slice(pause + 1));
    else pausedTails.delete(player);
    startTranscript(api, player, JORRAL_NPC_ID, PAGE, LAST_PERSON_VARIANT, () => head);
  }

  function playHandIn(player) {
    playJorralSteps(player, handInSteps(player));
  }

  /**
   * "Well..." (Dron's story) and "I can now continue with my plans..." (the finale): live closes the
   * chat and fades the screen out on the continue, fades back in 3 ticks later and goes on 3 after
   * that (capture ticks 1395-1401, 1521-1527).
   */
  function pauseThenPlay(player, atFadeIn, steps) {
    const from = player.getLocation();
    player.getDialogueManager().reset();
    // Ours: held still through the black screen (the capture shows no input there); a player
    // moved away by then (a teleport) does not get the rest of the talk.
    player.getMovementQueue?.().reset().setBlockMovement(true);
    QuestFade.fade(player, true);
    QuestFade.later(player, PAUSE_FADE_IN_TICKS, () => {
      if (player.isRegistered?.() === false) return;
      atFadeIn?.();
      QuestFade.fade(player, false);
    });
    QuestFade.later(player, PAUSE_RESUME_TICKS, () => {
      player.getMovementQueue?.().setBlockMovement(false);
      if (player.isRegistered?.() === false || !steps.length) return;
      const at = player.getLocation();
      if (at.getZ() !== from.getZ() || Math.max(Math.abs(at.getX() - from.getX()), Math.abs(at.getY() - from.getY())) > 1) return;
      playJorralSteps(player, steps);
    });
  }

  /** The finale's line after the fade: "Take a look at the artefacts...", then the completion. */
  function finaleTail() {
    const condition = variantSteps(DELIVERING_VARIANT).find((step) => step?.id === KING_LETTER_CONDITION);
    const steps = condition?.steps ?? [];
    const at = steps.findIndex((step) => step?.type === "line" && step.text === FINALE_PAUSE_LINE);
    return at >= 0 ? steps.slice(at + 1) : [];
  }

  // ==========================================================================
  // The opening cutscene
  // ==========================================================================

  /** The list holding the step with this id, and its index, anywhere in a variant's tree. */
  function findStep(steps, id) {
    if (!Array.isArray(steps)) return null;
    for (let index = 0; index < steps.length; index++) {
      const step = steps[index];
      if (step?.id === id) return { list: steps, index };
      const inner = findStep(step?.steps, id)
        ?? (step?.options ?? []).reduce((found, option) => found ?? findStep(option?.steps, id), null);
      if (inner) return inner;
    }
    return null;
  }

  function cutsceneSource(stepId) {
    const data = loadTranscripts(api);
    for (const page of [JORRAL_START_PAGE, PAGE]) {
      for (const [variant, steps] of Object.entries(data?.[page]?.variants ?? {})) {
        const found = findStep(steps, stepId);
        if (found) return { page, variant, ...found };
      }
    }
    return null;
  }

  /**
   * The captions are the Narration lines after the action; the talk resumes at the first line
   * after them (the Jorral page's "The cutscene disappears." action is the scene's end, so it goes).
   */
  function playOpeningCutscene(player, stepId) {
    const source = cutsceneSource(stepId);
    if (!source) return;
    const after = source.list.slice(source.index + 1);
    const captions = [];
    let resume = 0;
    while (resume < after.length && after[resume]?.type === "line" && after[resume].speaker === "Narration") {
      captions.push(after[resume].text);
      resume++;
    }
    if (after[resume]?.type === "action") resume++;
    const tail = after.slice(resume);
    pendingCutsceneTails.set(player, { page: source.page, variant: source.variant, tail });
    if (!Cutscene.play(player, captions)) pendingCutsceneTails.delete(player);
  }

  function cutsceneEnded(player) {
    const pending = pendingCutsceneTails.get(player);
    pendingCutsceneTails.delete(player);
    if (!pending?.tail.length) return;
    startTranscript(api, player, JORRAL_NPC_ID, pending.page, pending.variant, () => pending.tail);
  }

  /**
   * The cache already places King Lathas in the throne room (npc 9228, which
   * the client's transform varbit turns into 9005). Only spawn an owner-only
   * copy when that canonical NPC is not there. Owner-scoped copies are
   * skipped: they belong to another player, not to the world.
   */
  function nativeKingLathasPresent(player) {
    if (typeof World?.getNpcsNear !== "function") return false;
    const location = new Location(
      KING_LATHAS_NATIVE_SPAWN.x,
      KING_LATHAS_NATIVE_SPAWN.y,
      KING_LATHAS_NATIVE_SPAWN.z
    );
    const nearby = World.getNpcsNear(location, KING_LATHAS_SEARCH_RADIUS, player.getPrivateArea?.() ?? null) ?? [];
    return nearby.some((npc) => {
      if (!npc || npc.getOwner?.()) return false;
      const contentId = npc.getContentId?.(player);
      return contentId !== undefined && KING_LATHAS_NPC_IDS.has(contentId);
    });
  }

  function ensureKingLathas(player) {
    if (!player || quest.getStage(player) < STAGE_STARTED || quest.isComplete(player)) return;
    if (!hasBit(player, BIT_FULL_STORY) || held(player, KING_LETTER)) return;
    if (kingLathasByPlayer.has(player)) return;
    if (nativeKingLathasPresent(player)) return;
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
    if (event.kind !== "message" && CUTSCENE_STEPS.has(stepId)) {
      event.handled = true;
      playOpeningCutscene(player, stepId);
      return;
    }
    // A message box; the chest comes on its continue (capture ticks 294-315).
    if (event.kind === "message" && stepId === DIG_MESSAGE_STEP) {
      event.box = { statement: true };
      event.after = () => {
        if (held(player, CHEST) || held(player, JOURNAL) || hasBit(player, BIT_JOURNAL_DONE)) return;
        player.getInventory().adds(CHEST, 1);
        setTrader(player, TRADER_CHEST);
      };
      return;
    }
    // A message box; its continue swaps the chest for the journal (tick 340).
    if (event.kind === "message" && stepId === CHEST_OPENED_MESSAGE_STEP) {
      event.box = { statement: true };
      event.after = () => {
        if (!held(player, CHEST)) return;
        player.getInventory().deleteNumber(CHEST, 1);
        if (!held(player, JOURNAL)) player.getInventory().adds(JOURNAL, 1);
        setTrader(player, TRADER_JOURNAL);
      };
      return;
    }
    if (stepId === RECEIVE_JOURNAL_STEP) {
      // The message box's continue above already swapped the chest for the journal.
      event.handled = true;
      return;
    }
    if (event.kind === "message" && MESSAGE_BOX_STEPS.has(stepId)) {
      event.box = { statement: true };
      return;
    }
    if (RECEIVE_SCROLL_STEPS.has(stepId)) {
      event.handled = true;
      if (!held(player, SCROLL)) {
        // The first-scroll transcript branch already requires a free slot; the
        // lost-scroll recovery branch does not, so drop it rather than lose it.
        if (freeSlots(player) < 1) dropScrollOnGround(player);
        else player.getInventory().adds(SCROLL, 1);
      }
      setGhost(player, GHOST_SCROLL);
      return;
    }
    if (stepId === DROP_SCROLL_STEP) {
      event.handled = true;
      dropScrollOnGround(player);
      setGhost(player, GHOST_SCROLL);
      return;
    }
    if (stepId === FIRST_JORRAL_LETTER_STEP) {
      // Live hands the letter over on the continue past "You've got that right!" (tick 1415).
      event.handled = true;
      return;
    }
    if (RECEIVE_JORRAL_LETTER_STEPS.has(stepId)) {
      event.handled = true;
      giveJorralLetter(player);
      return;
    }
    if (stepId === RECEIVE_KING_LETTER_STEP) {
      event.handled = true;
      player.getInventory().deleteNumber(JORRAL_LETTER, 1);
      if (!held(player, KING_LETTER)) {
        const inventory = player.getInventory();
        if (inventory.isFull()) inventory.forceAdd(player, new Item(KING_LETTER, 1));
        else inventory.adds(KING_LETTER, 1);
      }
      removeKingLathas(player);
      setBit(player, BIT_KING_SEEN);
      sendCanonicalProgress(player);
      return;
    }
    if (stepId === GIVE_KEY_PRICE_STEP) {
      event.handled = true;
      // The adjacent receive action validates and commits the purchase together.
      return;
    }
    if (stepId === RECEIVE_ENCHANTED_KEY_STEP) {
      event.handled = true;
      if (!quest.isComplete(player) || enchantedKeyComplete(player) || missingEarnedKeyRing(player) || ownsKey(player)) return;
      const inventory = player.getInventory();
      if (freeSlots(player) < 1 || inventory.getAmount(COINS) < KEY_PRICE) return;
      const before = inventory.getAmount(ENCHANTED_KEY);
      inventory.adds(ENCHANTED_KEY, 1);
      if (inventory.getAmount(ENCHANTED_KEY) === before + 1) inventory.deleteNumber(COINS, KEY_PRICE);
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
      setBit(player, BIT_DROALAK_GONE);
      player.getPacketSender().sendVarbit(VARBIT_DROALAK_PRESENT, 1);
      return;
    }
    if (stepId === COMPLETE_STEP) {
      event.handled = true;
      event.end = true;
      player.getInventory().deleteNumber(KING_LETTER, 1);
      removeKingLathas(player);
      if (!quest.isComplete(player)) quest.complete(player);
      // The outpost becomes the museum (native objloc switch, set at the finale's fade in).
      player.getPacketSender().sendVarbit(VARBIT_MUSEUM, 1);
      api.emitCustomEvent("enchanted-key:sync", { player });
      return;
    }
    if (WRONG_ANSWER_STEP_IDS.has(stepId)) {
      event.handled = true;
      event.end = true;
      // Dron's insult straight after the pick, and the talk ends there: the player talks to
      // him again for another go (capture ticks 738-742, 791-794).
      afterDialogue(player, () => {
        if (!quest.isComplete(player)) playVariant(player, DRON_NPC_ID, "talking-to-dron-if-the-player-chooses-the-wrong-option");
      });
    }
  }

  /**
   * Erin lends the key on the continue past "Why not. I can't use it anyway." (capture tick 239).
   * A key lost before the journal is handed in comes back from "Ask about the outpost" on a later
   * talk (Quest Helper's key tooltip; no capture shows it).
   */
  function lendKey(player) {
    if (quest.isComplete(player) || hasBit(player, BIT_JOURNAL_DONE)) return;
    if (ownsKey(player)) {
      setTrader(player, TRADER_KEY);
      return;
    }
    if (freeSlots(player) < 1) {
      player.sendMessage("You need more inventory space to take the key."); // Ours: no source has it
      return;
    }
    player.getInventory().adds(ENCHANTED_KEY, 1);
    setTrader(player, TRADER_KEY);
  }

  function handleDialogueChoice(event) {
    const { player, npcId, option } = event;
    if (!SILVER_MERCHANT_NPC_IDS.has(npcId)) return;
    if (!/ask about the outpost/i.test(String(option ?? ""))) return;
    if (trader(player) < TRADER_KEY || ownsKey(player)) return;
    lendKey(player);
  }

  /**
   * Progress moves on the continue past its line, as live sends it: Blanin's last line (tick 611),
   * Dron's "You would." (864), Droalak's amulet request (1305), Jorral's journal, Dron and scroll
   * hand-ins (1393, 1405, 1408) and the letter after "You've got that right!" (1415).
   */
  function handleDialogueLine(event) {
    const { player, npcId, text } = event;
    if (typeof text !== "string") return;
    if (npcId === JORRAL_NPC_ID) {
      if (text === "Interesting." && journalDue(player)) {
        event.after = () => {
          player.getInventory().deleteNumber(JOURNAL, 1);
          setBit(player, BIT_JOURNAL_DONE);
          sendPathVarbits(player);
        };
      } else if (text === PAUSE_LINE && pausedTails.has(player)) {
        event.after = () => {
          const tail = pausedTails.get(player) ?? [];
          pausedTails.delete(player);
          pauseThenPlay(player, null, tail);
        };
      } else if (text.startsWith("It seems you're lucky he didn't beat you up!") && warriorDue(player)) {
        event.after = () => {
          setBit(player, BIT_WARR_DONE);
          sendPathVarbits(player);
        };
      } else if (text.startsWith("Very interesting. So there was a great battle") && scrollDue(player)) {
        event.after = () => {
          player.getInventory().deleteNumber(SCROLL, 1);
          setBit(player, BIT_SCROLL_DONE);
          sendPathVarbits(player);
        };
      } else if (text.startsWith("It all makes sense now")) {
        setBit(player, BIT_FULL_STORY);
      } else if (text === "You've got that right!") {
        event.after = () => giveJorralLetter(player);
      } else if (text === FINALE_PAUSE_LINE && held(player, KING_LETTER) && !quest.isComplete(player)) {
        event.after = () => pauseThenPlay(player, () => player.getPacketSender().sendVarbit(VARBIT_MUSEUM, 1), finaleTail());
      }
      return;
    }
    if (SILVER_MERCHANT_NPC_IDS.has(npcId) && text.startsWith("Why not. I can't use it anyway.")) {
      event.after = () => lendKey(player);
      return;
    }
    if (npcId === DRON_NPC_ID && text === "You would.") {
      event.after = () => setWarr(player, WARR_QUIZ);
      return;
    }
    if (npcId === BLANIN_NPC_ID && text.startsWith("I know this sounds strange")) {
      event.after = () => setWarr(player, WARR_BRIEFED);
      return;
    }
    if (DROALAK_NPC_IDS.has(npcId) && text.startsWith("OK, well perhaps you could give her a strung sapphire amulet")) {
      event.after = () => setGhost(player, GHOST_ASKED);
      return;
    }
    if (KING_LATHAS_NPC_IDS.has(npcId) && text.startsWith("Very well, take another.")) {
      if (!held(player, KING_LETTER)) {
        const inventory = player.getInventory();
        if (inventory.isFull()) inventory.forceAdd(player, new Item(KING_LETTER, 1));
        else inventory.adds(KING_LETTER, 1);
      }
      removeKingLathas(player);
      setBit(player, BIT_KING_SEEN);
      sendCanonicalProgress(player);
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
      request.text = request.text.replace(/\[player name\]/gi, String(request.player.getDisplayName()));
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

  /**
   * One of the "finding the chest" conditions on its own: the chest and journal boxes continue
   * after a click, and the variant's later conditions (talking to Jorral or Erin with the journal)
   * must not run on from them.
   */
  function playKeyDetail(player, why) {
    const id = KEY_DETAIL_CONDITIONS[why];
    startTranscript(api, player, JORRAL_NPC_ID, PAGE, KEY_FINDING_VARIANT,
      (steps) => steps.find((step) => step?.id === id)?.steps ?? []);
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
    if (SILVER_MERCHANT_NPC_IDS.has(npcId) && quest.isComplete(player)
        && !enchantedKeyComplete(player) && !ownsKey(player) && missingEarnedKeyRing(player)) {
      event.handled = true;
      player.sendMessage("You need to reclaim your steel key ring from Yanni Salika before buying another enchanted key.");
      return;
    }
    if (npcId === JORRAL_NPC_ID) {
      if (quest.isComplete(player) || otherQuestNeedsJorral(player) || !handInDue(player)) return;
      event.handled = true;
      playHandIn(player);
      return;
    }
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
    player.getInventory().forceAdd(player, new Item(COINS, 749));
    player.getSkillManager().addExperiences(Skill.CRAFTING, 1000);
    player.getSkillManager().addExperiences(Skill.PRAYER, 1000);
    // Quest Helper advertises the enchanted key as a reward item. The key is
    // Erin's, so it is only handed over when the player does not hold one;
    // a full bag drops it at the reward location, like the runtime's own
    // reward item.
    if (!ownsKey(player)) {
      const inventory = player.getInventory();
      if (inventory.isFull()) inventory.forceAdd(player, new Item(ENCHANTED_KEY, 1));
      else inventory.adds(ENCHANTED_KEY, 1);
    }
  }

  function handleLogin({ player }) {
    refreshQuestList(player);
    sendProgressVarbits(player);
    sendCanonicalProgress(player);
    ensureKingLathas(player);
  }

  function handleLogout({ player }) {
    removeKingLathas(player);
    Cutscene.end(player, true);
    pendingCutsceneTails.delete(player);
    pausedTails.delete(player);
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
    // Keep the durable 1/2 stage values (existing saves) but send the cache's
    // canonical 1..4 progress values. The mapping is player-aware: the login
    // bootstrap re-sends every quest's wire value after the login hooks, so a
    // stage-only mapping would replay 1 over the letter steps 2/3.
    varbitValue(stage, player) {
      if (player) return canonicalProgressValue(player);
      if (stage >= STAGE_COMPLETE) return WIRE_COMPLETE;
      return stage >= STAGE_STARTED ? WIRE_STARTED : 0;
    },
    questPoints: 3,
    // The scroll's lines and model as live shows them (capture tick 1529).
    xpRewards: [
      { skillId: Skill.PRAYER.getIndex(), amount: 1000, label: "Prayer" },
      { skillId: Skill.CRAFTING.getIndex(), amount: 1000, label: "Crafting" },
    ],
    rewardItemId: COINS,
    rewardItemLabel: "750 Coins",
    otherRewards: ["The Enchanted Key"],
    scrollItemId: ENCHANTED_KEY,
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
  require("../makinghistory/EnchantedKey.MakingHistory")(api, quest);
};
