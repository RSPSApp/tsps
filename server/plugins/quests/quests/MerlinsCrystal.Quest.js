/**
 * Merlin's Crystal (members).
 *
 * Words come from the "Merlin's Crystal" transcript page. The plugin supplies
 * the variant selector for King Arthur, the Knights of the Round Table, Morgan
 * Le Faye, Sir Mordred, Merlin, Thrantax, the candle maker, Arhein and the Lady
 * of the Lake/beggar test, plus the prose-condition answers, the start hook and
 * the candle / Excalibur / crystal / finish conversation actions.
 *
 * Stages (varp 14): 1 started, 2 asked Gawain, 3 asked Lancelot, 4 met Morgan,
 * 5 Excalibur bound, 6 Merlin freed, 7 complete.
 *
 * The transcript carries the journal-unfriendly parts, so the plugin owns them:
 * the Catherby crate (object 63) cutscene into Keep Le Faye, Sir Mordred's
 * death spawning Morgan Le Faye, the trapped Merlin spawn by the giant crystal,
 * the Port Sarim beggar during the Lady of the Lake's test, the beehive wax,
 * the chaos altar check, the ritual drop of bat bones (the star scenery itself
 * is absent from the map), lighting the black candle and smashing the crystal.
 *
 * Source: OSRS Wiki "Merlin's Crystal" walkthrough and quick guide; the ritual
 * symbol is at 2780,3515 and the crystal at 2767,3493 (plane 2).
 */
module.exports = function registerMerlinsCrystalQuest(api) {
  const {
    ItemIdentifiers,
    NpcIdentifiers,
    ObjectIdentifiers,
    Equipment,
    Location,
    CountdownTask,
    TaskManager,
  } = api.core;
  const { registerQuest, refreshQuestList, startTranscript } = require("../QuestRuntime");

  const PAGE = "Merlin's Crystal";
  const VARP_MERLINS_CRYSTAL = 14;

  const STAGE_STARTED = 1;
  const STAGE_SPOKEN_GAWAIN = 2;
  const STAGE_SPOKEN_LANCELOT = 3;
  const STAGE_SPOKEN_MORGAN = 4;
  const STAGE_EXCALIBUR_BOUND = 5;
  const STAGE_MERLIN_FREED = 6;
  const STAGE_COMPLETE = 7;

  const START_HOOK = "quest:merlin-s-crystal:start";
  /** Conversation actions: candle received, crate arrives, crystal shattered, quest finished. */
  const BLACK_CANDLE_ACTION_ID = "nlk77H";
  const LADY_RECLAIM_ACTION_ID = "eytHdp";
  const CRATE_ARRIVED_STEP_ID = "X6UH6e";
  const CRYSTAL_SHATTERED_ACTION_ID = "q6WlmM";
  const COMPLETE_ACTION_ID = "pVUc-a";
  const MORDRED_ATTACK_MESSAGE_ID = "hIw3H-";
  const MORGAN_APPEARS_MESSAGE_ID = "wJ33io";
  const MORGAN_VANISH_STEP_IDS = new Set(["N1Z186", "J8gccZ"]);
  const WRONG_INCANTATION_STEP_IDS = new Set(["vYwlTM", "zIiS0O"]);
  /** Beggar test: handing over bread, then the Lady of the Lake's gift. */
  const BEGGAR_BREAD_STEP_IDS = new Set(["emEYqa", "aS5Xkw"]);
  const EXCALIBUR_GIFT_STEP_IDS = new Set(["4DJqdx", "IgIzfo"]);
  const WRONG_INCANTATIONS = new Set([
    "Snarthtrick Candanto Termon",
    "Snarthanto Candon Termtrick",
  ]);

  const READ_INCANTATION_ATTRIBUTE = "quest.merlin-s-crystal:read-incantation";
  const LADY_TEST_ATTRIBUTE = "quest.merlin-s-crystal:lady-s-test";
  const BEGGAR_DONE_ATTRIBUTE = "quest.merlin-s-crystal:beggar-rewarded";
  const HIVE_REPELLED_ATTRIBUTE = "quest.merlin-s-crystal:hive-repelled";

  const CATHERBY_CRATE_OBJECT_ID = ObjectIdentifiers.CRATE_2; // 63
  const GIANT_CRYSTAL_OBJECT_ID = ObjectIdentifiers.GIANT_CRYSTAL; // 62
  const CHAOS_ALTAR_OBJECT_ID = ObjectIdentifiers.CHAOS_ALTAR; // 61
  const BEEHIVE_OBJECT_ID = ObjectIdentifiers.BEEHIVE; // 68
  const JEWELLERS_DOOR_OBJECT_ID = ObjectIdentifiers.DOOR_5; // 59, Port Sarim 3016,3246

  const RITUAL_TILE = new Location(2780, 3515, 0);
  const RITUAL_TILE_RADIUS = 1;
  const TOWER_MERLIN_TILE = { x: 2766, y: 3493, z: 2 };
  const KEEP_CRATE_ARRIVAL = new Location(2779, 3400, 0);
  const MORGAN_TILE = { x: 2771, y: 3403, z: 2 };
  const BEGGAR_TILE = { x: 3016, y: 3247, z: 0 };
  const JEWELLERS_DOOR_TILE = { x: 3016, y: 3246, z: 0 };
  const TOWER_ZONE = { minX: 2764, maxX: 2771, minY: 3489, maxY: 3496, levels: [2] };
  const SARIM_SHOP_ZONE = { minX: 3010, maxX: 3020, minY: 3242, maxY: 3254, levels: [0] };

  const ARTHUR_IDS = new Set([
    NpcIdentifiers.KING_ARTHUR,
    NpcIdentifiers.ARTHUR,
    NpcIdentifiers.KING_ARTHUR_2,
    NpcIdentifiers.KING_ARTHUR_3,
  ]);
  const MORGAN_IDS = new Set([NpcIdentifiers.MORGAN_LE_FAYE, NpcIdentifiers.MORGAN_LE_FAYE_2]);
  const MERLIN_IDS = new Set([NpcIdentifiers.MERLIN, NpcIdentifiers.MERLIN_2]);
  const MORDRED_IDS = new Set([NpcIdentifiers.SIR_MORDRED]);
  const GAWAIN_IDS = new Set([
    NpcIdentifiers.SIR_GAWAIN,
    NpcIdentifiers.SIR_GAWAIN_2,
    NpcIdentifiers.SIR_GAWAIN_3,
    NpcIdentifiers.SIR_GAWAIN_4,
  ]);
  const LANCELOT_IDS = new Set([
    NpcIdentifiers.SIR_LANCELOT,
    NpcIdentifiers.SIR_LANCELOT_2,
    NpcIdentifiers.SIR_LANCELOT_3,
  ]);

  function knight(entrapment, keep, search) {
    return { entrapment, keep, search };
  }
  const KNIGHTS = new Map([
    [NpcIdentifiers.SIR_LANCELOT, knight("investigating-merlin-s-entrapment-sir-lancelot", "investigating-keep-le-faye-sir-lancelot", undefined)],
    [NpcIdentifiers.SIR_LANCELOT_2, knight("investigating-merlin-s-entrapment-sir-lancelot", "investigating-keep-le-faye-sir-lancelot", undefined)],
    [NpcIdentifiers.SIR_GAWAIN, knight("investigating-merlin-s-entrapment-sir-gawain", undefined, "searching-for-excalibur-asking-the-knights-sir-gawain")],
    [NpcIdentifiers.SIR_GAWAIN_3, knight("investigating-merlin-s-entrapment-sir-gawain", undefined, "searching-for-excalibur-asking-the-knights-sir-gawain")],
    [NpcIdentifiers.SIR_KAY, knight("investigating-merlin-s-entrapment-sir-kay", "investigating-keep-le-faye-sir-kay", "searching-for-excalibur-asking-the-knights-sir-kay")],
    [4352, knight("investigating-merlin-s-entrapment-sir-kay", "investigating-keep-le-faye-sir-kay", "searching-for-excalibur-asking-the-knights-sir-kay")],
    [NpcIdentifiers.SIR_BEDIVERE, knight("investigating-merlin-s-entrapment-sir-bedivere", "investigating-keep-le-faye-sir-bedivere", "searching-for-excalibur-asking-the-knights-sir-bedivere")],
    [NpcIdentifiers.SIR_TRISTRAM, knight("investigating-merlin-s-entrapment-sir-tristram", "investigating-keep-le-faye-sir-tristram", "searching-for-excalibur-asking-the-knights-sir-tristram")],
    [NpcIdentifiers.SIR_PELLEAS, knight("investigating-merlin-s-entrapment-sir-pelleas", "investigating-keep-le-faye-sir-pelleas", "searching-for-excalibur-asking-the-knights-sir-pelleas")],
    [4350, knight("investigating-merlin-s-entrapment-sir-pelleas", "investigating-keep-le-faye-sir-pelleas", "searching-for-excalibur-asking-the-knights-sir-pelleas")],
    [NpcIdentifiers.SIR_LUCAN, knight("investigating-merlin-s-entrapment-sir-lucan", "investigating-keep-le-faye-sir-lucan", "searching-for-excalibur-asking-the-knights-sir-lucan")],
    [NpcIdentifiers.SIR_PALOMEDES, knight("investigating-merlin-s-entrapment-sir-palomedes", "investigating-keep-le-faye-sir-palomedes", "searching-for-excalibur-asking-the-knights-sir-palomedes")],
  ]);

  const EXCALIBUR_ITEM_ID = ItemIdentifiers.EXCALIBUR;
  const COINS_ITEM_ID = ItemIdentifiers.COINS;
  const BLACK_CANDLE_ITEM_ID = ItemIdentifiers.BLACK_CANDLE;
  const LIT_BLACK_CANDLE_ITEM_ID = ItemIdentifiers.LIT_BLACK_CANDLE;
  const BUCKET_OF_WAX_ITEM_ID = ItemIdentifiers.BUCKET_OF_WAX;
  const BAT_BONES_ITEM_ID = ItemIdentifiers.BAT_BONES;
  const BREAD_ITEM_ID = ItemIdentifiers.BREAD;
  const HAMMER_ITEM_ID = ItemIdentifiers.HAMMER;
  const BEEKEEPER_ITEM_IDS = [
    ItemIdentifiers.BEEKEEPERS_HAT,
    ItemIdentifiers.BEEKEEPERS_TOP,
    ItemIdentifiers.BEEKEEPERS_LEGS,
    ItemIdentifiers.BEEKEEPERS_GLOVES,
    ItemIdentifiers.BEEKEEPERS_BOOTS,
  ];

  const page = (variant) => ({ page: PAGE, variant });
  const has = (player, itemId) => player.getInventory().getAmount(itemId) > 0;
  const banked = (player, itemId) => {
    const banks = player.getBanks?.() ?? (player.getBank ? [player.getBank()] : []);
    return banks.some((bank) => Number(bank?.getAmount?.(itemId) ?? 0) > 0);
  };
  const owns = (player, itemId) => has(player, itemId) || banked(player, itemId);
  /** The equipped weapon also counts toward item ownership. */
  const wielded = (player, itemId) => player.getEquipment().get(Equipment.WEAPON_SLOT)?.getId?.() === itemId;
  /** Excalibur in the inventory, in the bank or in the weapon slot. */
  const ownsExcalibur = (player) =>
    owns(player, EXCALIBUR_ITEM_ID) || wielded(player, EXCALIBUR_ITEM_ID);
  /** The sword in hand: the crystal is smashed with it, a banked sword does not count. */
  const carriesExcalibur = (player) => has(player, EXCALIBUR_ITEM_ID) || wielded(player, EXCALIBUR_ITEM_ID);

  /**
   * Losing Excalibur must not strand the quest: while the sword is missing the
   * Lady of the Lake's test can be repeated to get another one.
   */
  function canRepeatLadyTest(player) {
    if (!quest.isStarted(player) || quest.isComplete(player)) return false;
    const stage = quest.getStage(player);
    if (stage < STAGE_SPOKEN_MORGAN || stage >= STAGE_MERLIN_FREED) return false;
    return !ownsExcalibur(player);
  }

  let quest;
  const npcsByPlayer = new Map();

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      return [
        "<str>I freed Merlin from his crystal and was made</str>",
        "<str>a Knight of the Round Table.</str>",
        "",
        "<col=ff0000>QUEST COMPLETE!</col>",
      ];
    }
    if (stage >= STAGE_MERLIN_FREED) {
      return ["I freed Merlin. I should report back to <col=800000>King Arthur</col>."];
    }
    if (stage >= STAGE_EXCALIBUR_BOUND) {
      return ["Thrantax bound the spell to Excalibur. I can now smash <col=800000>Merlin's crystal</col>."];
    }
    if (stage >= STAGE_SPOKEN_MORGAN) {
      return [
        "I must drop <col=800000>bat bones</col> on the magic symbol north-east of Camelot",
        "while carrying a <col=800000>lit black candle</col>, then shatter the crystal with",
        "<col=800000>Excalibur</col>.",
      ];
    }
    if (stage >= STAGE_SPOKEN_LANCELOT) {
      return ["I can hide in <col=800000>Arhein's crate</col> in Catherby to reach Keep Le Faye."];
    }
    if (stage >= STAGE_SPOKEN_GAWAIN) {
      return ["Morgan Le Faye is responsible. <col=800000>Sir Lancelot</col> may know how to enter her keep."];
    }
    if (stage >= STAGE_STARTED) {
      return ["The <col=800000>Knights of the Round Table</col> may know who trapped Merlin."];
    }
    return [
      "I can start this quest by speaking to <col=800000>King Arthur</col>",
      "in Camelot Castle.",
    ];
  }

  function knightVariant(k, stage) {
    if (stage >= STAGE_SPOKEN_LANCELOT && k.search) return k.search;
    if (stage >= STAGE_SPOKEN_GAWAIN && k.keep) return k.keep;
    return k.entrapment;
  }

  function arthurVariant(stage) {
    if (stage >= STAGE_COMPLETE) return "starting-off-subsequent-dialogue";
    if (stage >= STAGE_MERLIN_FREED) return "finishing-up";
    if (stage >= STAGE_STARTED) return "starting-off-subsequent-dialogue";
    return "starting-off";
  }

  /** Which transcript variant the clicked NPC plays. */
  function selectVariant({ npcId, player }) {
    const stage = quest.getStage(player);
    if (ARTHUR_IDS.has(npcId)) {
      // The quest page's "subsequent" opening is not King Arthur's post-quest
      // dialogue; the named NPC page already carries the canonical variant.
      if (quest.isComplete(player)) {
        return { page: "King Arthur", variant: "standard-dialogue-after-completing-merlin-s-crystal" };
      }
      return page(arthurVariant(stage));
    }
    const k = KNIGHTS.get(npcId);
    if (k) {
      // Before the start hook the knights belong to their own standard dialogue.
      return stage < STAGE_STARTED ? null : page(knightVariant(k, stage));
    }
    if (MORGAN_IDS.has(npcId)) {
      // Morgan Le Faye 4320 is also used by King's Ransom after this quest.
      if (stage < STAGE_SPOKEN_LANCELOT || stage >= STAGE_EXCALIBUR_BOUND) return null;
      return page("inside-keep-le-faye-defeating-sir-mordred");
    }
    if (MORDRED_IDS.has(npcId)) return page("inside-keep-le-faye-encountering-sir-mordred");
    if (MERLIN_IDS.has(npcId)) {
      // 4059 is the Merlin who speaks the Holy Grail / King's Ransom pages.
      // The trapped Merlin is not a Talk-to shortcut: only the Giant crystal
      // (Smash or Excalibur-on-crystal) advances stage 5. After he is freed the
      // recorded "talking to Merlin again" page is legitimate.
      if (npcId !== NpcIdentifiers.MERLIN || stage < STAGE_MERLIN_FREED) return null;
      return page("smashing-talking-to-merlin-again");
    }
    if (npcId === NpcIdentifiers.THRANTAX_THE_MIGHTY) {
      return page(
        "performing-the-ritual-dropping-bat-bones-on-the-ritual-circle-with-a-lit-black-candle-after-reading-the-incantation"
      );
    }
    if (npcId === NpcIdentifiers.CANDLE_MAKER) {
      // The trade only exists while the ritual items are being gathered.
      if (stage < STAGE_SPOKEN_MORGAN || stage >= STAGE_EXCALIBUR_BOUND) return null;
      return page(
        has(player, BUCKET_OF_WAX_ITEM_ID)
          ? "obtaining-the-black-candle-returning-to-the-candle-maker"
          : "obtaining-the-black-candle-talking-to-the-candle-maker"
      );
    }
    if (npcId === NpcIdentifiers.ARHEIN) {
      // Arhein only runs the crate ride while the player is infiltrating the
      // keep; outside that (One Small Favour's T.R.A.S.H. hand-ins, etc.) he
      // belongs to whoever else claims him.
      return stage >= STAGE_SPOKEN_LANCELOT && stage < STAGE_SPOKEN_MORGAN
        ? page("infiltrating-the-keep-talking-to-arhein")
        : null;
    }
    if (npcId === NpcIdentifiers.THE_LADY_OF_THE_LAKE) {
      if (quest.isComplete(player)) {
        return { page: "The Lady of the Lake", variant: "after-completing-merlin-s-crystal" };
      }
      if (stage >= STAGE_SPOKEN_MORGAN && stage < STAGE_EXCALIBUR_BOUND) {
        return page("searching-for-excalibur-the-lady-of-the-lake");
      }
      // A sword lost before the crystal is broken reopens her test.
      if (canRepeatLadyTest(player)) return page("searching-for-excalibur-the-lady-of-the-lake");
      return null;
    }
    if (npcId === NpcIdentifiers.BEGGAR) {
      if (!quest.isStarted(player) || quest.isComplete(player)) return null;
      if (player.getAttribute(LADY_TEST_ATTRIBUTE) !== true) return null;
      if (player.getAttribute(BEGGAR_DONE_ATTRIBUTE) === true && !canRepeatLadyTest(player)) return null;
      if (stage < STAGE_SPOKEN_MORGAN || stage >= STAGE_MERLIN_FREED) return null;
      return page(
        has(player, BREAD_ITEM_ID)
          ? "searching-for-excalibur-attempting-to-enter-the-jewellery-shop"
          : "searching-for-excalibur-talking-to-the-beggar-again-if-they-were-not-given-bread-initially"
      );
    }
    return null;
  }

  /** Answer the page's prose conditions. */
  function answerCondition({ player, text }) {
    const value = String(text).toLowerCase();
    const stage = quest.getStage(player);
    if (value.includes("does not have the bucket of wax")) return !has(player, BUCKET_OF_WAX_ITEM_ID);
    if (value.includes("has the bucket of wax")) return has(player, BUCKET_OF_WAX_ITEM_ID);
    if (value.includes("has no bread")) return !has(player, BREAD_ITEM_ID);
    if (value.includes("has bread")) return has(player, BREAD_ITEM_ID);
    if (value.includes("does not have excalibur in their bank or inventory")) {
      return !ownsExcalibur(player);
    }
    if (value.includes("has excalibur in their bank or inventory")) {
      return ownsExcalibur(player);
    }
    if (value.includes("has at least 500 coins")) {
      return has(player, COINS_ITEM_ID) && player.getInventory().getAmount(COINS_ITEM_ID) >= 500;
    }
    if (value.includes("does not have at least 500 coins")) {
      return player.getInventory().getAmount(COINS_ITEM_ID) < 500;
    }
    if (value.includes("doesn't have excalibur but has a hammer")) {
      return !carriesExcalibur(player) && has(player, HAMMER_ITEM_ID);
    }
    // The dump lists the plain no-Excalibur branch first; keep it from swallowing
    // the more specific hammer branch.
    if (value.includes("doesn't have excalibur")) {
      return !carriesExcalibur(player) && !has(player, HAMMER_ITEM_ID);
    }
    if (value.includes("excalibur but doesn't have thrantax")) {
      return carriesExcalibur(player) && stage < STAGE_EXCALIBUR_BOUND;
    }
    if (value.includes("excalibur and thrantax")) {
      return carriesExcalibur(player) && stage >= STAGE_EXCALIBUR_BOUND;
    }
    return null;
  }

  function handleStartHook({ player, npcId, hook }) {
    if (!ARTHUR_IDS.has(npcId) || hook !== START_HOOK) return;
    if (quest.getStage(player) < STAGE_STARTED) quest.setStage(player, STAGE_STARTED);
  }

  /** Raises the stage to `stage`; later stages are never lowered. */
  function advanceTo(player, stage) {
    if (quest.getStage(player) < stage) quest.setStage(player, stage);
  }

  // ==========================================================================
  // Owner-only quest NPCs (Merlin, Morgan, the beggar, Thrantax)
  // ==========================================================================

  function trackedEntry(player) {
    let entry = npcsByPlayer.get(player);
    if (!entry) {
      entry = {};
      npcsByPlayer.set(player, entry);
    }
    return entry;
  }

  function spawnTracked(player, key, id, tile) {
    if (!player || player.isPlayerBot?.() === true) return;
    const entry = trackedEntry(player);
    if (entry[key]) return;
    const npc = api.spawnNpc({ id, x: tile.x, y: tile.y, z: tile.z, owner: player, ownerOnly: true, wanderRadius: 0 });
    if (npc) entry[key] = npc;
  }

  function removeTracked(player, key) {
    const entry = npcsByPlayer.get(player);
    if (!entry?.[key]) return;
    api.removeNpc(entry[key]);
    delete entry[key];
  }

  function clearTracked(player) {
    const entry = npcsByPlayer.get(player);
    if (!entry) return;
    for (const npc of Object.values(entry)) api.removeNpc(npc);
    npcsByPlayer.delete(player);
  }

  /** The freed Merlin stands by the shattered crystal; the trapped one is not a
   *  talk-to shortcut while the crystal must still be smashed. */
  function ensureTowerMerlin(player) {
    if (!player || player.isPlayerBot?.() === true) return;
    if (!quest.isStarted(player) || quest.getStage(player) < STAGE_MERLIN_FREED) {
      removeTracked(player, "merlin");
      return;
    }
    spawnTracked(player, "merlin", NpcIdentifiers.MERLIN, TOWER_MERLIN_TILE);
  }

  /** The beggar exists while the Lady of the Lake's Port Sarim test is pending. */
  function ensureBeggar(player) {
    if (!player || player.isPlayerBot?.() === true) return;
    if (player.getAttribute(LADY_TEST_ATTRIBUTE) !== true) return;
    if (player.getAttribute(BEGGAR_DONE_ATTRIBUTE) === true && !canRepeatLadyTest(player)) return;
    spawnTracked(player, "beggar", NpcIdentifiers.BEGGAR, BEGGAR_TILE);
  }

  function ensureQuestNpcs(player) {
    ensureTowerMerlin(player);
    ensureBeggar(player);
  }

  // ==========================================================================
  // Conversations
  // ==========================================================================

  /**
   * Choices carry no ids in the dump, so the stage writes key off the option
   * text: Gawain names Morgan, Lancelot names the Catherby deliveries, Morgan
   * offers the ritual and the Lady sets her test. Thrantax's correct
   * incantation binds the spell to Excalibur.
   */
  function handleChoice({ player, npcId, option }) {
    const text = String(option ?? "");
    if (GAWAIN_IDS.has(npcId) && text === "Do you know how Merlin got trapped?") {
      advanceTo(player, STAGE_SPOKEN_GAWAIN);
      return;
    }
    if (LANCELOT_IDS.has(npcId) && text === "Any ideas on how to get into Morgan Le Faye's stronghold?") {
      advanceTo(player, STAGE_SPOKEN_LANCELOT);
      return;
    }
    if (MORGAN_IDS.has(npcId)) {
      // The first information choice alone must not persist the stage: closing
      // the conversation there forces the player to fight Sir Mordred again.
      if (text === "OK I will do all that." || text === "Ok then.") {
        advanceTo(player, STAGE_SPOKEN_MORGAN);
        removeTracked(player, "morgan");
      }
      return;
    }
    if (npcId === NpcIdentifiers.THRANTAX_THE_MIGHTY) {
      if (text === "Snarthon Candtrick Termanto") {
        advanceTo(player, STAGE_EXCALIBUR_BOUND);
        removeTracked(player, "thrantax");
        return;
      }
      if (WRONG_INCANTATIONS.has(text)) destroyBlackCandle(player);
      return;
    }
    if (npcId === NpcIdentifiers.THE_LADY_OF_THE_LAKE && text === "I seek the sword Excalibur.") {
      player.setAttribute(LADY_TEST_ATTRIBUTE, true);
      ensureBeggar(player);
    }
  }

  function destroyBlackCandle(player) {
    if (has(player, LIT_BLACK_CANDLE_ITEM_ID)) {
      player.getInventory().deleteNumber(LIT_BLACK_CANDLE_ITEM_ID, 1);
      return;
    }
    if (has(player, BLACK_CANDLE_ITEM_ID)) player.getInventory().deleteNumber(BLACK_CANDLE_ITEM_ID, 1);
  }

  /**
   * Conversation actions: the candle maker trades wax for a candle, Thrantax's
   * boon shatters the crystal, and King Arthur finishes the quest. The beggar
   * test consumes bread and the Lady of the Lake gifts Excalibur.
   */
  function handleAction(event) {
    const { player, npcId, stepId } = event;
    const text = String(event.text ?? "");
    if (stepId === BLACK_CANDLE_ACTION_ID && npcId === NpcIdentifiers.CANDLE_MAKER) {
      if (!has(player, BUCKET_OF_WAX_ITEM_ID)) return;
      // Refuse rather than consume wax for a candle the player already holds.
      if (has(player, BLACK_CANDLE_ITEM_ID) || has(player, LIT_BLACK_CANDLE_ITEM_ID)) {
        player.sendMessage("You already have a black candle.");
        return;
      }
      player.getInventory().deleteNumber(BUCKET_OF_WAX_ITEM_ID, 1);
      // Removing the wax frees the candle's slot; adds() returns the container.
      player.getInventory().adds(BLACK_CANDLE_ITEM_ID, 1);
      return;
    }
    if (stepId === LADY_RECLAIM_ACTION_ID && npcId === NpcIdentifiers.THE_LADY_OF_THE_LAKE) {
      if (ownsExcalibur(player)) return;
      const inventory = player.getInventory();
      if (inventory.getAmount(COINS_ITEM_ID) < 500) return;
      if (inventory.getFreeSlots() < 1 && inventory.getAmount(COINS_ITEM_ID) > 500) {
        player.sendMessage("You need a free inventory space to receive Excalibur.");
        return;
      }
      inventory.deleteNumber(COINS_ITEM_ID, 500);
      inventory.adds(EXCALIBUR_ITEM_ID, 1);
      return;
    }
    if (stepId === CRYSTAL_SHATTERED_ACTION_ID) {
      advanceTo(player, STAGE_MERLIN_FREED);
      removeTracked(player, "merlin");
      return;
    }
    if (stepId === COMPLETE_ACTION_ID && ARTHUR_IDS.has(npcId)) {
      if (!quest.isComplete(player)) quest.complete(player);
      return;
    }
    if (BEGGAR_BREAD_STEP_IDS.has(stepId)) {
      if (has(player, BREAD_ITEM_ID)) player.getInventory().deleteNumber(BREAD_ITEM_ID, 1);
      return;
    }
    if (EXCALIBUR_GIFT_STEP_IDS.has(stepId)) {
      // Once-only delivery: a sword the player still owns is never duplicated.
      if (!ownsExcalibur(player)) {
        if (player.getInventory().getFreeSlots() < 1) {
          player.sendMessage("You need a free inventory space for Excalibur.");
          return;
        }
        player.getInventory().adds(EXCALIBUR_ITEM_ID, 1);
      }
      player.setAttribute(BEGGAR_DONE_ATTRIBUTE, true);
      removeTracked(player, "beggar");
      return;
    }
    if (stepId === CRATE_ARRIVED_STEP_ID) {
      const location = player.getLocation();
      if (Math.abs(location.getX() - KEEP_CRATE_ARRIVAL.x) > 10 || Math.abs(location.getY() - KEEP_CRATE_ARRIVAL.y) > 10) {
        player.moveTo(KEEP_CRATE_ARRIVAL.clone());
      }
      return;
    }
    if (MORGAN_VANISH_STEP_IDS.has(stepId)) {
      removeTracked(player, "morgan");
      return;
    }
    if (WRONG_INCANTATION_STEP_IDS.has(stepId)) {
      destroyBlackCandle(player);
      player.sendMessage(text);
      return;
    }
    if (stepId === MORGAN_APPEARS_MESSAGE_ID || stepId === MORDRED_ATTACK_MESSAGE_ID) {
      player.sendMessage(text);
    }
  }

  /** Sir Mordred yields; Morgan Le Faye appears for whoever struck the blow. */
  function handleNpcDeath(event) {
    if (!MORDRED_IDS.has(event.npcId)) return;
    const player = event.killer?.isPlayer?.() ? event.killer : null;
    if (!player || !quest.isStarted(player)) return;
    const stage = quest.getStage(player);
    if (stage < STAGE_SPOKEN_LANCELOT || stage >= STAGE_SPOKEN_MORGAN) return;
    const entry = trackedEntry(player);
    if (!entry.morgan) {
      const morgan = api.spawnNpc({
        id: NpcIdentifiers.MORGAN_LE_FAYE,
        x: MORGAN_TILE.x,
        y: MORGAN_TILE.y,
        z: MORGAN_TILE.z,
        owner: player,
        ownerOnly: true,
        wanderRadius: 0,
      });
      if (morgan) entry.morgan = morgan;
    }
    TaskManager.submit(
      new CountdownTask(player, 1, () => {
        if (player.isRegistered?.() === false) return;
        startTranscript(api, player, NpcIdentifiers.MORGAN_LE_FAYE, PAGE, "inside-keep-le-faye-defeating-sir-mordred");
      })
    );
  }

  // ==========================================================================
  // Objects, items and the ritual
  // ==========================================================================

  /** Hide in the Catherby crates; the cutscene drops the player in the keep. */
  function hideInCatherbyCrate(event) {
    if (event.objectId !== CATHERBY_CRATE_OBJECT_ID) return false;
    const { player } = event;
    const stage = quest.getStage(player);
    if (stage < STAGE_SPOKEN_LANCELOT || stage >= STAGE_COMPLETE) return false;
    startTranscript(api, player, NpcIdentifiers.ARHEIN, PAGE, "infiltrating-the-keep-hiding-in-arhein-s-crate");
    return true;
  }

  /**
   * Opening the Port Sarim jeweller's door during the Lady of the Lake's test
   * makes the beggar appear and starts her plea. Doors.plugin claims the Open
   * action first, so this listens on its door:toggle event and keeps the door
   * shut until the test is passed.
   */
  function enterJewelleryShop(request) {
    if (request.handled) return;
    const objectId = request.objectId ?? request.object?.getId?.();
    if (objectId !== JEWELLERS_DOOR_OBJECT_ID) return;
    const option = request.option ?? request.definition?.getInteractions?.()[request.clickType - 1];
    if (option !== "Open") return;
    const at = request.location ?? request.object?.getLocation?.();
    const x = typeof at?.getX === "function" ? at.getX() : at?.x;
    const y = typeof at?.getY === "function" ? at.getY() : at?.y;
    const z = typeof at?.getZ === "function" ? at.getZ() : at?.z;
    if (x !== JEWELLERS_DOOR_TILE.x || y !== JEWELLERS_DOOR_TILE.y || z !== JEWELLERS_DOOR_TILE.z) return;
    const { player } = request;
    if (!player) return;
    if (player.getAttribute(LADY_TEST_ATTRIBUTE) !== true) return;
    if (player.getAttribute(BEGGAR_DONE_ATTRIBUTE) === true && !canRepeatLadyTest(player)) return;
    const stage = quest.getStage(player);
    if (stage < STAGE_SPOKEN_MORGAN || stage >= STAGE_MERLIN_FREED) return;
    ensureBeggar(player);
    startTranscript(
      api,
      player,
      NpcIdentifiers.BEGGAR,
      PAGE,
      "searching-for-excalibur-attempting-to-enter-the-jewellery-shop"
    );
    request.handled = true;
  }

  function smashCrystal(player) {
    if (quest.getStage(player) >= STAGE_MERLIN_FREED) {
      player.sendMessage("The giant crystal lies shattered.");
      return;
    }
    startTranscript(api, player, NpcIdentifiers.MERLIN, PAGE, "smashing");
  }

  function smashGiantCrystal(event) {
    if (event.objectId !== GIANT_CRYSTAL_OBJECT_ID) return false;
    smashCrystal(event.player);
    return true;
  }

  function excaliburOnCrystal(event) {
    smashCrystal(event.player);
  }

  function checkChaosAltar(event) {
    if (event.objectId !== CHAOS_ALTAR_OBJECT_ID) return false;
    const { player } = event;
    const stage = quest.getStage(player);
    if (stage < STAGE_SPOKEN_MORGAN || stage >= STAGE_EXCALIBUR_BOUND) return false;
    player.setAttribute(READ_INCANTATION_ATTRIBUTE, true);
    startTranscript(api, player, NpcIdentifiers.THRANTAX_THE_MIGHTY, PAGE, "searching-the-altar-for-the-spell");
    return true;
  }

  /** Wearing the full Beekeeper's outfit also keeps the bees calm, per the wiki. */
  function wearingBeekeeperOutfit(player) {
    const items = player.getEquipment?.()?.getItems?.() ?? [];
    return BEEKEEPER_ITEM_IDS.every((id) => items.some((item) => item?.getId?.() === id));
  }

  /** A wax extraction needs an empty bucket and a hive the player has calmed. */
  function collectWax(player) {
    if (!has(player, ItemIdentifiers.BUCKET)) {
      player.sendMessage("I need an empty bucket to collect the wax.");
      return true;
    }
    if (player.getAttribute(HIVE_REPELLED_ATTRIBUTE) !== true && !wearingBeekeeperOutfit(player)) {
      player.sendMessage("The bees are too angry to approach. I should use some insect repellent first.");
      return true;
    }
    player.getInventory().deleteNumber(ItemIdentifiers.BUCKET, 1);
    player.getInventory().adds(BUCKET_OF_WAX_ITEM_ID, 1);
    player.setAttribute(HIVE_REPELLED_ATTRIBUTE, false);
    player.sendMessage("You collect a bucket of wax from the beehive.");
    return true;
  }

  function repellentOnHive(event) {
    if (event.objectId !== BEEHIVE_OBJECT_ID) return false;
    const { player } = event;
    // Insect repellent is reusable: the wiki says it must be used on the hive
    // every time, but the can is not consumed.
    player.setAttribute(HIVE_REPELLED_ATTRIBUTE, true);
    player.sendMessage("You spray the beehive with the insect repellent. The bees calm down.");
    return true;
  }

  function bucketOnHive(event) {
    if (event.objectId !== BEEHIVE_OBJECT_ID) return false;
    return collectWax(event.player);
  }

  function takeFromHive(event) {
    if (event.objectId !== BEEHIVE_OBJECT_ID) return false;
    return collectWax(event.player);
  }

  function lightBlackCandle(event) {
    const { player } = event;
    player.getInventory().deleteNumber(BLACK_CANDLE_ITEM_ID, 1);
    player.getInventory().adds(LIT_BLACK_CANDLE_ITEM_ID, 1);
    player.sendMessage("You light the black candle.");
  }

  /**
   * Dropping bat bones inside the ritual circle: the words have to be learnt
   * first and a lit black candle carried, then Thrantax appears. The star
   * scenery is not in this map, so the wiki tile 2780,3515 is the circle.
   */
  function batBonesOnCircle(event) {
    if (event.itemId !== BAT_BONES_ITEM_ID) return;
    const { player } = event;
    const stage = quest.getStage(player);
    if (stage < STAGE_SPOKEN_MORGAN || stage >= STAGE_EXCALIBUR_BOUND || quest.isComplete(player)) return;
    const location = player.getLocation();
    if (
      location.getZ() !== RITUAL_TILE.z ||
      Math.abs(location.getX() - RITUAL_TILE.x) > RITUAL_TILE_RADIUS ||
      Math.abs(location.getY() - RITUAL_TILE.y) > RITUAL_TILE_RADIUS
    ) {
      return;
    }
    const summonVariant = "performing-the-ritual-dropping-bat-bones-on-the-ritual-circle-with-a-lit-black-candle-after-reading-the-incantation";
    if (player.getAttribute(READ_INCANTATION_ATTRIBUTE) !== true) {
      event.handled = true;
      startTranscript(
        api,
        player,
        NpcIdentifiers.THRANTAX_THE_MIGHTY,
        PAGE,
        "performing-the-ritual-dropping-bat-bones-on-the-ritual-circle-with-a-lit-black-candle-without-having-read-the-incantation"
      );
      return;
    }
    if (!has(player, LIT_BLACK_CANDLE_ITEM_ID)) {
      event.handled = true;
      startTranscript(
        api,
        player,
        NpcIdentifiers.THRANTAX_THE_MIGHTY,
        PAGE,
        "performing-the-ritual-dropping-bat-bones-on-the-ritual-circle-without-a-lit-black-candle"
      );
      return;
    }
    event.handled = true;
    player.getInventory().deleteNumber(BAT_BONES_ITEM_ID, 1);
    spawnTracked(player, "thrantax", NpcIdentifiers.THRANTAX_THE_MIGHTY, RITUAL_TILE);
    startTranscript(api, player, NpcIdentifiers.THRANTAX_THE_MIGHTY, PAGE, summonVariant);
  }

  function handleZoneEnter({ player }) {
    ensureQuestNpcs(player);
  }

  function handleLogin({ player }) {
    ensureQuestNpcs(player);
    refreshQuestList(player);
  }

  function handleLogout({ player }) {
    if (player) clearTracked(player);
  }

  quest = registerQuest(api, {
    key: "merlins_crystal",
    name: "Merlin's Crystal",
    varpId: VARP_MERLINS_CRYSTAL,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 6,
    xpRewards: [],
    scrollItemId: EXCALIBUR_ITEM_ID,
    rewardItemLabel: "Excalibur",
    otherRewards: ["Become a Knight of the Round Table"],
    buildJournal,
  });

  api.persistAttribute(READ_INCANTATION_ATTRIBUTE);
  api.persistAttribute(LADY_TEST_ATTRIBUTE);
  api.persistAttribute(BEGGAR_DONE_ATTRIBUTE);
  api.persistAttribute(HIVE_REPELLED_ATTRIBUTE);

  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("npc-dialogue:choice", handleChoice);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onCustomEvent("door:toggle", enterJewelleryShop);
  api.onObjectInteraction("Crate", { "Hide-in": hideInCatherbyCrate });
  api.onObjectInteraction("Giant crystal", { Smash: smashGiantCrystal });
  api.onObjectInteraction("Chaos altar", { Check: checkChaosAltar });
  api.onObjectInteraction("Beehive", { "Take-from": takeFromHive });
  api.onItemOnObject("Excalibur", "Giant crystal", excaliburOnCrystal);
  api.onItemOnObject("Insect repellent", "Beehive", repellentOnHive, { noted: false });
  api.onItemOnObject("Bucket", "Beehive", bucketOnHive, { noted: false });
  api.onItemOnItem("Tinderbox", "Black candle", lightBlackCandle, { noted: false });
  api.onItemDropPolicy(batBonesOnCircle);
  api.onNpcDeath(handleNpcDeath);
  api.onZoneEnter(TOWER_ZONE, handleZoneEnter);
  api.onZoneEnter(SARIM_SHOP_ZONE, handleZoneEnter);
  api.onPlayerLogin(handleLogin);
  api.onPlayerLogout(handleLogout);
  api.onPlayerDisconnect(handleLogout);
};
