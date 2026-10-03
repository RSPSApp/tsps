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
 * Gaps: the Catherby/Keep Le Faye crates, the chaos altar, the ritual circle,
 * the beehive/wax and the crystal object are item/object interactions the dump
 * does not pin to object ids; only the conversation stages, start hook, candle,
 * Excalibur gift, smashing and completion actions are ported.
 */
module.exports = function registerMerlinsCrystalQuest(api) {
  const { ItemIdentifiers, NpcIdentifiers } = api.core;
  const { registerQuest, refreshQuestList } = require("../QuestRuntime");

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
  /** Conversation actions: candle received, crystal shattered, quest finished. */
  const BLACK_CANDLE_ACTION_ID = "nlk77H";
  const CRYSTAL_SHATTERED_ACTION_ID = "q6WlmM";
  const COMPLETE_ACTION_ID = "pVUc-a";
  /** Beggar test: handing over bread, then the Lady of the Lake's gift. */
  const BEGGAR_BREAD_STEP_IDS = new Set(["emEYqa", "aS5Xkw"]);
  const EXCALIBUR_GIFT_STEP_IDS = new Set(["4DJqdx", "IgIzfo"]);

  const ARTHUR_IDS = new Set([
    NpcIdentifiers.KING_ARTHUR,
    NpcIdentifiers.ARTHUR,
    NpcIdentifiers.KING_ARTHUR_2,
    NpcIdentifiers.KING_ARTHUR_3,
  ]);
  const MORGAN_IDS = new Set([NpcIdentifiers.MORGAN_LE_FAYE, NpcIdentifiers.MORGAN_LE_FAYE_2]);
  const MERLIN_IDS = new Set([NpcIdentifiers.MERLIN, NpcIdentifiers.MERLIN_2]);

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
  const BLACK_CANDLE_ITEM_ID = ItemIdentifiers.BLACK_CANDLE;
  const BUCKET_OF_WAX_ITEM_ID = ItemIdentifiers.BUCKET_OF_WAX;
  const BAT_BONES_ITEM_ID = ItemIdentifiers.BAT_BONES;
  const BREAD_ITEM_ID = ItemIdentifiers.BREAD;
  const HAMMER_ITEM_ID = ItemIdentifiers.HAMMER;

  const page = (variant) => ({ page: PAGE, variant });
  const has = (player, itemId) => player.getInventory().getAmount(itemId) > 0;

  let quest;

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
    if (ARTHUR_IDS.has(npcId)) return page(arthurVariant(stage));
    const k = KNIGHTS.get(npcId);
    if (k) return page(knightVariant(k, stage));
    if (MORGAN_IDS.has(npcId)) return page("inside-keep-le-faye-defeating-sir-mordred");
    if (npcId === NpcIdentifiers.SIR_MORDRED) return page("inside-keep-le-faye-encountering-sir-mordred");
    if (MERLIN_IDS.has(npcId)) {
      return page(stage >= STAGE_MERLIN_FREED ? "smashing-talking-to-merlin-again" : "smashing");
    }
    if (npcId === NpcIdentifiers.THRANTAX_THE_MIGHTY) {
      return page(
        "performing-the-ritual-dropping-bat-bones-on-the-ritual-circle-with-a-lit-black-candle-after-reading-the-incantation"
      );
    }
    if (npcId === NpcIdentifiers.CANDLE_MAKER) {
      return page(
        has(player, BUCKET_OF_WAX_ITEM_ID)
          ? "obtaining-the-black-candle-returning-to-the-candle-maker"
          : "obtaining-the-black-candle-talking-to-the-candle-maker"
      );
    }
    if (npcId === NpcIdentifiers.ARHEIN) return page("infiltrating-the-keep-talking-to-arhein");
    if (npcId === NpcIdentifiers.THE_LADY_OF_THE_LAKE) {
      return page("searching-for-excalibur-the-lady-of-the-lake");
    }
    if (npcId === NpcIdentifiers.BEGGAR) {
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
    if (value.includes("doesn't have excalibur but has a hammer")) {
      return !has(player, EXCALIBUR_ITEM_ID) && has(player, HAMMER_ITEM_ID);
    }
    if (value.includes("doesn't have excalibur")) return !has(player, EXCALIBUR_ITEM_ID);
    if (value.includes("excalibur but doesn't have thrantax")) {
      return has(player, EXCALIBUR_ITEM_ID) && stage < STAGE_EXCALIBUR_BOUND;
    }
    if (value.includes("excalibur and thrantax")) {
      return has(player, EXCALIBUR_ITEM_ID) && stage >= STAGE_EXCALIBUR_BOUND;
    }
    return null;
  }

  function handleStartHook({ player, npcId, hook }) {
    if (!ARTHUR_IDS.has(npcId) || hook !== START_HOOK) return;
    if (quest.getStage(player) < STAGE_STARTED) quest.setStage(player, STAGE_STARTED);
  }

  /**
   * Conversation actions: the candle maker trades wax for a candle, Thrantax's
   * boon shatters the crystal, and King Arthur finishes the quest. The beggar
   * test consumes bread and the Lady of the Lake gifts Excalibur.
   */
  function handleAction({ player, npcId, stepId }) {
    if (stepId === BLACK_CANDLE_ACTION_ID && npcId === NpcIdentifiers.CANDLE_MAKER) {
      if (has(player, BUCKET_OF_WAX_ITEM_ID)) {
        player.getInventory().deleteNumber(BUCKET_OF_WAX_ITEM_ID, 1);
        if (!has(player, BLACK_CANDLE_ITEM_ID)) player.getInventory().adds(BLACK_CANDLE_ITEM_ID, 1);
      }
      return;
    }
    if (stepId === CRYSTAL_SHATTERED_ACTION_ID) {
      if (quest.getStage(player) < STAGE_MERLIN_FREED) quest.setStage(player, STAGE_MERLIN_FREED);
      if (has(player, BAT_BONES_ITEM_ID)) player.getInventory().deleteNumber(BAT_BONES_ITEM_ID, 1);
      return;
    }
    if (stepId === COMPLETE_ACTION_ID && ARTHUR_IDS.has(npcId)) {
      if (!quest.isComplete(player)) quest.complete(player);
      return;
    }
    if (BEGGAR_BREAD_STEP_IDS.has(stepId) && has(player, BREAD_ITEM_ID)) {
      player.getInventory().deleteNumber(BREAD_ITEM_ID, 1);
      return;
    }
    if (EXCALIBUR_GIFT_STEP_IDS.has(stepId) && !has(player, EXCALIBUR_ITEM_ID)) {
      player.getInventory().adds(EXCALIBUR_ITEM_ID, 1);
    }
  }

  function handleLogin({ player }) {
    refreshQuestList(player);
  }

  quest = registerQuest(api, {
    key: "merlins_crystal",
    name: "Merlin's Crystal",
    varpId: VARP_MERLINS_CRYSTAL,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 6,
    xpRewards: [],
    rewardItemId: EXCALIBUR_ITEM_ID,
    rewardItemLabel: "Excalibur",
    otherRewards: ["Become a Knight of the Round Table"],
    buildJournal,
  });

  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onPlayerLogin(handleLogin);
};
