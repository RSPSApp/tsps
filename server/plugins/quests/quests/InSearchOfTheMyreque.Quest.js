/**
 * In Search of the Myreque (members).
 *
 * The words come from the "In Search of the Myreque" transcript page; this plugin
 * supplies the variant selector for Vanstrom Klause, Cyreg Paddlehorn, Curpile
 * Fyod, Veliaf Hurtz, the five hideout members and the post-quest Stranger, the
 * prose-condition answers, the start hook, the Curpile quiz routing, the
 * boat/rope-bridge/hideout traversal and the Skeleton Hellhound fight.
 *
 * Stages (varp 387): 5 agreed, 10 refused delivery, 15 persuaded boatman,
 * 20 gave planks, 25 reached Hollows, 52 questioned by Curpile, 55 answered,
 * 60 entered hideout, 65 met Veliaf, 67 weapons accepted, 70 delivered weapons
 * (cutscene), 80 hellhound summoned, 85 killed hellhound, 90 shown way out,
 * 95 in inn basement, 97 escaped to Canifis, 105 complete.
 *
 * Source: https://github.com/GregHib/void/blob/2b8e267836a8469757c73694ea4d57f2f1c28458/game/src/main/kotlin/content/quest/member/myreque/SearchMyreque.kt
 * (+ the same folder's quest varps/varbits data, pinned in issue #196).
 *
 * Gaps: the quest NPCs themselves are not spawned by this file (central
 * registration/world spawns own them); only the Skeleton Hellhound is spawned
 * owner-only. Curpile's quiz is a counted random in the regenerated Myreque record (RSPSApp/osrsreboxed-db#108: three of six
 * questions, no repeats, then the four count conditions): the plugin resets a per-attempt counter on draw 1, scores each
 * answer against the drawn question's text and answers the count conditions by their ids. Curpile's 3-damage punch (the
 * refusal option) is applied by its action step.
 * Per-player bridge rungs live in a persisted attribute mirrored to varbits
 * 176-178/3928; the world clipping is not edited.
 */
module.exports = function registerInSearchOfTheMyrequeQuest(api) {
  const { Skill, ItemIdentifiers, NpcIdentifiers, ObjectIdentifiers } = api.core;
  const { registerQuest, refreshQuestList, loadTranscripts } = require("../QuestRuntime");

  const VARP_IN_SEARCH_OF_THE_MYREQUE = 387;

  const STAGE_UNSTARTED = 0;
  const STAGE_STARTED = 5; // agreed_to_help
  const STAGE_REFUSED_DELIVERY = 10;
  const STAGE_PERSUADED_BOATMAN = 15;
  const STAGE_GAVE_PLANKS = 20;
  const STAGE_REACHED_HOLLOWS = 25;
  const STAGE_QUESTIONED_BY_CURPILE = 52;
  const STAGE_ANSWERED_QUESTIONS = 55;
  const STAGE_ENTERED_HIDEOUT = 60;
  const STAGE_MET_VELIAF = 65;
  const STAGE_WEAPONS_ACCEPTED = 67;
  const STAGE_DELIVERED_WEAPONS = 70;
  const STAGE_HELLHOUND_SUMMONED = 80;
  const STAGE_KILLED_HELLHOUND = 85;
  const STAGE_SHOWN_WAY_OUT = 90;
  const STAGE_IN_INN_BASEMENT = 95;
  const STAGE_ESCAPED_TO_CANIFIS = 97;
  const STAGE_COMPLETE = 105;

  const VANSTROM_NPC_IDS = new Set([NpcIdentifiers.VANSTROM_KLAUSE_8]); // 5056
  const CYREG_NPC_ID = NpcIdentifiers.CYREG_PADDLEHORN; // 5046
  const CURPILE_NPC_ID = NpcIdentifiers.CURPILE_FYOD; // 9619
  const STRANGER_NPC_ID = NpcIdentifiers.STRANGER_2; // 5055
  const VELIAF_NPC_IDS = new Set([
    NpcIdentifiers.VELIAF_HURTZ, // 989
    NpcIdentifiers.VELIAF_HURTZ_2, // 5048
    15879, // Veliaf Hurtz (cache id, no identifier)
    15885, // Veliaf Hurtz (cache id, no identifier)
  ]);
  const HELLHOUND_NPC_IDS = new Set([
    NpcIdentifiers.SKELETON_HELLHOUND, // 5054
    NpcIdentifiers.SKELETON_HELLHOUND_2, // 6387
  ]);

  /** npc id -> member slug (page variant stem) and met flag. */
  const MEMBERS = new Map([
    [NpcIdentifiers.SANI_PILIU, { name: "Sani Piliu", slug: "sani-piliu", flag: "met_sani", after: null }],
    [NpcIdentifiers.SANI_PILIU_2, { name: "Sani Piliu", slug: "sani-piliu", flag: "met_sani", after: null }],
    [NpcIdentifiers.HAROLD_EVANS, { name: "Harold Evans", slug: "harold-evans", flag: "met_harold", after: null }],
    [NpcIdentifiers.HAROLD_EVANS_2, { name: "Harold Evans", slug: "harold-evans", flag: "met_harold", after: null }],
    [NpcIdentifiers.RADIGAD_PONFIT, { name: "Radigad Ponfit", slug: "radigad-ponfit", flag: "met_radigad", after: "myreque-hideout-after-defeating-the-skeleton-hellhound-radigad-ponfit" }],
    [NpcIdentifiers.POLMAFI_FERDYGRIS, { name: "Polmafi Ferdygris", slug: "polmafi-ferdygris", flag: "met_polmafi", after: "myreque-hideout-after-defeating-the-skeleton-hellhound-polmafi-ferdygris" }],
    [NpcIdentifiers.IVAN_STROM, { name: "Ivan Strom", slug: "ivan-strom", flag: "met_ivan", after: "myreque-hideout-after-defeating-the-skeleton-hellhound-ivan-strom" }],
    [NpcIdentifiers.IVAN_STROM_2, { name: "Ivan Strom", slug: "ivan-strom", flag: "met_ivan", after: "myreque-hideout-after-defeating-the-skeleton-hellhound-ivan-strom" }],
    [NpcIdentifiers.IVAN_STROM_3, { name: "Ivan Strom", slug: "ivan-strom", flag: "met_ivan", after: "myreque-hideout-after-defeating-the-skeleton-hellhound-ivan-strom" }],
    [NpcIdentifiers.IVAN_STROM_5, { name: "Ivan Strom", slug: "ivan-strom", flag: "met_ivan", after: "myreque-hideout-after-defeating-the-skeleton-hellhound-ivan-strom" }],
    [NpcIdentifiers.IVAN_STROM_6, { name: "Ivan Strom", slug: "ivan-strom", flag: "met_ivan", after: "myreque-hideout-after-defeating-the-skeleton-hellhound-ivan-strom" }],
    [NpcIdentifiers.IVAN_STROM_7, { name: "Ivan Strom", slug: "ivan-strom", flag: "met_ivan", after: "myreque-hideout-after-defeating-the-skeleton-hellhound-ivan-strom" }],
    [NpcIdentifiers.IVAN_STROM_8, { name: "Ivan Strom", slug: "ivan-strom", flag: "met_ivan", after: "myreque-hideout-after-defeating-the-skeleton-hellhound-ivan-strom" }],
    [NpcIdentifiers.IVAN_STROM_9, { name: "Ivan Strom", slug: "ivan-strom", flag: "met_ivan", after: "myreque-hideout-after-defeating-the-skeleton-hellhound-ivan-strom" }],
    [NpcIdentifiers.IVAN_STROM_10, { name: "Ivan Strom", slug: "ivan-strom", flag: "met_ivan", after: "myreque-hideout-after-defeating-the-skeleton-hellhound-ivan-strom" }],
    [NpcIdentifiers.IVAN_STROM_11, { name: "Ivan Strom", slug: "ivan-strom", flag: "met_ivan", after: "myreque-hideout-after-defeating-the-skeleton-hellhound-ivan-strom" }],
  ]);

  const STEEL_LONGSWORD_ITEM_ID = ItemIdentifiers.STEEL_LONGSWORD;
  const STEEL_SWORD_ITEM_ID = ItemIdentifiers.STEEL_SHORTSWORD;
  const STEEL_DAGGER_ITEM_ID = ItemIdentifiers.STEEL_DAGGER;
  const STEEL_MACE_ITEM_ID = ItemIdentifiers.STEEL_MACE;
  const STEEL_WARHAMMER_ITEM_ID = ItemIdentifiers.STEEL_WARHAMMER;
  const PLANK_ITEM_ID = ItemIdentifiers.PLANK;
  const STEEL_NAILS_ITEM_ID = ItemIdentifiers.STEEL_NAILS;
  const HAMMER_ITEM_ID = ItemIdentifiers.HAMMER;
  const COINS_ITEM_ID = ItemIdentifiers.COINS;
  const RING_OF_CHAROS_A_ITEM_IDS = [
    ItemIdentifiers.RING_OF_CHAROS_A_, // 6465
    ItemIdentifiers.RING_OF_CHAROS_A__2, // 17756
  ];
  const DRUID_POUCH_ITEM_IDS = [
    ItemIdentifiers.DRUID_POUCH,
    ItemIdentifiers.DRUID_POUCH_2,
    ItemIdentifiers.DRUID_POUCH_3,
  ];

  /** The steel delivery Vanstrom asks for (amounts matter for two swords). */
  const WEAPONS = [
    { itemId: STEEL_LONGSWORD_ITEM_ID, amount: 1, label: "1 x Steel longsword" },
    { itemId: STEEL_SWORD_ITEM_ID, amount: 2, label: "2 x Steel shortsword" },
    { itemId: STEEL_DAGGER_ITEM_ID, amount: 1, label: "1 x Steel dagger" },
    { itemId: STEEL_MACE_ITEM_ID, amount: 1, label: "1 x Steel mace" },
    { itemId: STEEL_WARHAMMER_ITEM_ID, amount: 1, label: "1 x Steel warhammer" },
  ];
  const JOURNAL_MEMBERS = [
    MEMBERS.get(NpcIdentifiers.SANI_PILIU),
    MEMBERS.get(NpcIdentifiers.HAROLD_EVANS),
    MEMBERS.get(NpcIdentifiers.RADIGAD_PONFIT),
    MEMBERS.get(NpcIdentifiers.POLMAFI_FERDYGRIS),
    MEMBERS.get(NpcIdentifiers.IVAN_STROM),
  ];

  const ROPE_BRIDGE_ID = ObjectIdentifiers.ROPE_BRIDGE; // 5002, Cross
  const BRIDGE_TREE_PARENT_ID = 5003; // multi-loc resolved to 26248/26249 by varbit 3928
  const SURFACE_DOORS_ID = ObjectIdentifiers.WOODEN_DOORS_8; // 5061, doors in the earth north of Curpile
  const CAVE_ENTRANCE_ID = ObjectIdentifiers.CAVE_ENTRANCE_27; // 5046, hidden cave entrance
  const BROKEN_BRIDGE_IDS = new Set([
    ObjectIdentifiers.BROKEN_ROPE_BRIDGE_2, // 26244
    26245, // broken rope bridge rung, varbit 176
    26246, // broken rope bridge rung, varbit 177
    26247, // broken rope bridge rung, varbit 178
  ]);
  const BRIDGE_RUNG_VARBITS = { 26245: 176, 26246: 177, 26247: 178 };
  const IGNORE_CLIPPING_FLAG = "movement:ignore-clipping";
  /**
   * How long the rung step ignores clipping: tasks run before movement in a tick, so 1 would end it before the
   * step is taken (Brimhaven's vines use 2 for the same reason).
   */
  const RUNG_STEP_TICKS = 2;
  const rungSteps = new WeakMap();
  const BRIDGE_TREE_IDS = new Set([ObjectIdentifiers.TREE_117, ObjectIdentifiers.TREE_118]); // 26248, 26249
  const STALAGMITE_ID = ObjectIdentifiers.STALAGMITE_3; // 5050
  const FAKE_WALL_ID = ObjectIdentifiers.WALL_17; // 5052
  /**
   * The hidden wall at the end of the tunnel: loc 5052 "Wall" (op Search) at (3480,9837), type 0, rotation 3, a straight
   * wall on that tile's SOUTH edge (rotation 0 west, 1 north, 2 east, 3 south), so it separates (3480,9837) on the north
   * from (3480,9836) on the south. Cache-derived (the #5488 probe, main 73e6d6b51), no capture.
   */
  const WALL_NORTH_SIDE = { x: 3480, y: 9837 };
  const WALL_SOUTH_SIDE = { x: 3480, y: 9836 };
  const WALK_ANIMATION = 819; // the walk the repo's other door passes use (CooksGuild.plugin.js)
  /**
   * The two bridge trees (loc 5003, shown as 50787 "Tree", op Climb; cache-derived, probe) and the bridge's tiles, all
   * Wiki/void-based with no capture (void SearchMyreque.kt: NORTH_TREE 3431 :410, BRIDGE_LANDING 3427 :412, BRIDGE_TOP
   * 3430 :414, NORTH_BANK (3503,3431) and SOUTH_BANK (3502,3425) :416-417).
   */
  const SOUTH_TREE_Y = 3426;
  const NORTH_TREE_Y = 3431;
  const BRIDGE_LANDING_Y = 3427;
  const BRIDGE_TOP_Y = 3430;
  const NORTH_BANK = { x: 3503, y: 3431 };
  const SOUTH_BANK = { x: 3502, y: 3425 };
  const TAVERN_LADDER_ID = ObjectIdentifiers.LADDER_54; // 5054
  const TAVERN_TRAPDOOR_ID = ObjectIdentifiers.TRAPDOOR_23; // 5055
  const HIDEOUT_DOOR_IDS = new Set([
    ObjectIdentifiers.WOODEN_DOORS_3, // 5056
    ObjectIdentifiers.WOODEN_DOORS_4, // 5057
  ]);
  const MORT_TON_BOAT_ID = ObjectIdentifiers.SWAMP_BOATY_2; // 6969
  const HOLLOWS_BOAT_ID = ObjectIdentifiers.SWAMP_BOATY_3; // 6970
  const HOLLOWS_SIGN_ID = ObjectIdentifiers.SIGN_35; // 26255

  const START_HOOK = "quest:in-search-of-the-myreque:start";
  // Ids of the record imported from RSPSApp/osrsreboxed-db c971f8ee2 (#108 there, docs/npc-dialogues.json): Curpile's quiz is a counted
  // random (three of six questions, no repeats) followed by the "After the third question is answered:" block whose four
  // count conditions and knock-out messages carry these ids. Node ids of the export: a re-export that renames them is
  // caught by tests/myreque-quiz-counting.test.cjs and myreque-curpile-step-ids.test.cjs, which read the imported file.
  const QUIZ_COUNT_CONDITION_IDS = new Map([
    ["A6wXnN", 0], // "If the player answered zero out of three questions correctly:"
    ["arNFa2", 1], // "... one out of three ..."
    ["K8_P_w", 2], // "... two out of three ..."
    ["p493oV", 3], // "... three out of three ..."
  ]);
  const QUIZ_PASS_CONDITION_ID = "p493oV";
  const SHOW_POUCH_MESSAGE_ID = "BKpf08";
  const PLANKS_MESSAGE_ID = "DsO5TF";
  const GIVE_WEAPONS_CONDITION_ID = "VLPyT3";
  const CUTSCENE_START_ACTION_ID = "bLWS_j";
  const SUMMON_HOUND_ACTION_ID = "OFmcmp";
  // "Curpile knocks you out and takes you back to Mort'ton." after one, two or three wrong answers.
  const KNOCKOUT_MESSAGE_IDS = new Set(["HQfMkY", "XmM1Px", "k1iShr"]); // zero, one, two correct (RSPSApp/osrsreboxed-db#108 record)
  const FIRST_SPEAKING_STEP_FLAGS = new Map([
    ["k_vzYt", "met_harold"],
    ["_g5SY-", "met_radigad"],
    ["25JBP_", "met_polmafi"],
    ["C5YuIy", "met_sani"],
    ["KI2Pb0", "met_ivan"],
    ["a8YEIJ", "veliaf_after"],
  ]);
  /** The six quiz questions (the sentence after "Okay, [first/second/third and final] question.") -> the correct answer. */
  const QUIZ_ANSWERS = new Map([
    ["Name the only female member of the Myreque.", "Sani Piliu."],
    ["Who is the youngest member of the Myreque?", "Ivan Strom."],
    ["Who is the leader of the Myreque in Mort Myre?", "Veliaf Hurtz."],
    ["Which member of the Myreque was originally a scholar?", "Polmafi Ferdygris."],
    ["What is the name of the boatman who helps the Myreque?", "Cyreg Paddlehorn."],
    ["What vampyre family rules over Morytania?", "Drakan."],
  ]);
  const QUIZ_QUESTION_PREFIX = "Okay, [first/second/third and final] question. ";

  /**
   * The Hair of the Dog's stranger is one spawn (cache NPC 6269) that shows Vanstrom Klause (5056) while varbit 396 is 0 and
   * the plain Stranger (5055) when it is 1. Wiki/void-based, no capture: void sets `thsfm_vanstrom_hide` (varbit 396,
   * persist, boolean; in_search_of_the_myreque.varbits.toml) when the weapons are handed over (VeliafHurtz.kt:177-180). It
   * stays 1 once set (ours: no source shows it going back). Like the bridge varbits it is re-sent at login, here derived
   * from the persisted stage.
   */
  const VANSTROM_HIDE_VARBIT = 396;
  /** Flags of the members whose first-time branch has already played in the conversation in progress. */
  const metThisConversation = new WeakMap();
  const BRIDGE_ATTRIBUTE = "quest.in_search_of_the_myreque.bridge";
  const QUIZ_CORRECT_ATTRIBUTE = "quest.in_search_of_the_myreque.quiz.correct";
  /** The question each player is being asked right now (set by the draw event, cleared by the answer). */
  const askedQuestion = new WeakMap();
  const HELLHOUND_SPOT = { x: 3507, y: 9838, z: 0 };

  let quest;
  const houndByPlayer = new Map();

  const held = (player, itemId, amount = 1) => player.getInventory().getAmount(itemId) >= amount;

  function hasAllWeapons(player) {
    return WEAPONS.every((weapon) => held(player, weapon.itemId, weapon.amount));
  }

  function hasDruidPouch(player) {
    // The pouch's stack size is its remaining charges (Nature Spirit fills it).
    const charges = DRUID_POUCH_ITEM_IDS.reduce(
      (sum, itemId) => sum + player.getInventory().getAmount(itemId),
      0
    );
    return charges >= 5;
  }

  function metFlag(player, flag) {
    return player.getAttribute(`quest.in_search_of_the_myreque.${flag}`) === true;
  }

  function setMetFlag(player, flag) {
    player.setAttribute(`quest.in_search_of_the_myreque.${flag}`, true);
  }

  function allMembersMet(player) {
    return JOURNAL_MEMBERS.every((member) => metFlag(player, member.flag));
  }

  function quizCorrect(player) {
    return Number(player.getAttribute(QUIZ_CORRECT_ATTRIBUTE)) || 0;
  }

  // ---- Rope bridge rungs (persisted per player, mirrored to varbits) ----

  function rungRepaired(player, varbit) {
    const value = Number(player.getAttribute(BRIDGE_ATTRIBUTE)) || 0;
    return (value & (1 << (varbit - 176))) !== 0;
  }

  function markRungRepaired(player, varbit) {
    const value = Number(player.getAttribute(BRIDGE_ATTRIBUTE)) || 0;
    player.setAttribute(BRIDGE_ATTRIBUTE, value | (1 << (varbit - 176)));
  }

  function bridgeRepaired(player) {
    return [176, 177, 178].every((varbit) => rungRepaired(player, varbit));
  }

  function firstBrokenRung(player) {
    return [176, 177, 178].find((varbit) => !rungRepaired(player, varbit));
  }

  function hasBridgeMaterials(player) {
    return held(player, PLANK_ITEM_ID, 1) && held(player, STEEL_NAILS_ITEM_ID, 75) && held(player, HAMMER_ITEM_ID, 1);
  }

  // ---- Journal ----

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      return [
        "<str>Vanstrom Klause asked me to take steel weapons to the</str>",
        "<str>Myreque, but he was a vampyre who followed me to their</str>",
        "<str>hideout. Sani and Harold were killed before I defeated</str>",
        "<str>the Skeleton Hellhound he summoned.</str>",
        "",
        "<str>I found a quicker route between Mort'ton and Canifis.</str>",
        "",
        "<col=ff0000>QUEST COMPLETE!</col>",
      ];
    }
    if (stage < STAGE_STARTED) {
      return [
        "I can start this quest by speaking to the",
        "<col=800000>stranger</col> in the 'Hair of the Dog Inn' in Canifis.",
        "",
        "I need to have completed Nature Spirit and have 25 Agility.",
      ];
    }
    const lines = ["<str>Vanstrom Klause asked me to take steel weapons to the Myreque.</str>"];
    if (stage < STAGE_DELIVERED_WEAPONS) {
      lines.push("The weapons he asked for:");
      for (const weapon of WEAPONS) {
        lines.push(held(player, weapon.itemId, weapon.amount) ? `<str>${weapon.label}</str>` : `<col=800000>${weapon.label}</col>`);
      }
    }
    if (stage >= STAGE_REFUSED_DELIVERY && stage < STAGE_PERSUADED_BOATMAN) {
      lines.push("The boatman Cyreg in Mort'ton won't take me to the hideout yet.");
    }
    if (stage >= STAGE_PERSUADED_BOATMAN && stage < STAGE_GAVE_PLANKS) {
      lines.push("Cyreg needs 6 planks: 3 for his boat and 3 for the bridge.");
    }
    if (stage >= STAGE_GAVE_PLANKS && stage < STAGE_REACHED_HOLLOWS) {
      lines.push("I can use Cyreg's boat to travel north to the Hollows.");
    }
    if (stage >= STAGE_REACHED_HOLLOWS && stage < STAGE_ANSWERED_QUESTIONS) {
      lines.push("I reached the Hollows; Curpile Fyod guards the way to the Myreque.");
    }
    if (stage >= STAGE_ANSWERED_QUESTIONS && stage < STAGE_ENTERED_HIDEOUT) {
      lines.push("I answered Curpile's questions; the doors behind the tree are open.");
    }
    if (stage >= STAGE_ENTERED_HIDEOUT && stage < STAGE_MET_VELIAF) {
      lines.push("I entered the hideout; I should look for the Myreque members.");
    }
    if (stage >= STAGE_MET_VELIAF && stage < STAGE_DELIVERED_WEAPONS) {
      lines.push("I need to introduce myself to:");
      for (const member of JOURNAL_MEMBERS) {
        lines.push(metFlag(player, member.flag) ? `<str>${member.name}</str>` : `<col=800000>${member.name}</col>`);
      }
    }
    if (stage >= STAGE_WEAPONS_ACCEPTED && stage < STAGE_DELIVERED_WEAPONS) {
      lines.push("I should hand the weapons over to Veliaf.");
    }
    if (stage >= STAGE_HELLHOUND_SUMMONED && stage < STAGE_KILLED_HELLHOUND) {
      lines.push("Vanstrom summoned a Skeleton Hellhound! I must kill it.");
    }
    if (stage >= STAGE_KILLED_HELLHOUND && stage < STAGE_SHOWN_WAY_OUT) {
      lines.push("I killed the hellhound; I should ask Veliaf for a way out.");
    }
    if (stage >= STAGE_SHOWN_WAY_OUT && stage < STAGE_IN_INN_BASEMENT) {
      lines.push("I should search the wall in the tunnel for the hidden door.");
    }
    if (stage >= STAGE_IN_INN_BASEMENT && stage < STAGE_ESCAPED_TO_CANIFIS) {
      lines.push("I should climb the ladder out of the inn basement.");
    }
    if (stage >= STAGE_ESCAPED_TO_CANIFIS) {
      lines.push("I escaped to Canifis; I should find the stranger in the tavern.");
    }
    return lines;
  }

  function grantReward(player) {
    const skills = player.getSkillManager();
    skills.addExperiences(Skill.ATTACK, 600);
    skills.addExperiences(Skill.DEFENCE, 600);
    skills.addExperiences(Skill.STRENGTH, 600);
    skills.addExperiences(Skill.HITPOINTS, 600);
    skills.addExperiences(Skill.CRAFTING, 600);
  }

  // ---- Dialogue ----

  const CURPILE_PAGE = "In Search of the Myreque";
  const CURPILE_FIRST_VARIANT = "convincing-curpile-fyod-talking-to-curpile-fyod";
  const CURPILE_RETRY_VARIANT = "convincing-curpile-fyod-talking-to-curpile-fyod-again-before-convincing-him";

  /**
   * The quiz as the first-time page plays it: the counted random and the sibling steps after it (the after-question blocks and
   * the four count conditions), from the random node to the end of the "I've come to help the Myreque" answer. Null when the
   * record has no such node (an older export), so the plain behaviour is kept.
   */
  function quizTail() {
    const steps = loadTranscripts(api)?.[CURPILE_PAGE]?.variants?.[CURPILE_FIRST_VARIANT];
    if (!Array.isArray(steps)) return null;
    for (const step of steps) {
      for (const option of Array.isArray(step?.options) ? step.options : []) {
        const body = Array.isArray(option?.steps) ? option.steps : [];
        const start = body.findIndex((entry) => entry?.type === "random" && entry.count > 1);
        if (start >= 0) return body.slice(start);
      }
    }
    return null;
  }

  /**
   * After a knock-out the player stays at stage 52, and the retry variant ("Back again? ..." / "Well let's hear them then." /
   * "Okay, first question...") ends in a jump above (id 8xSPeu) that has no target, so the dialogue closed with no quiz. The
   * retry plays its first two lines and then the quiz tail; its third line ("Okay, first question...") is dropped because the
   * first drawn question already opens with that ordinal.
   */
  function spliceQuizRetry(tail) {
    return (steps) => {
      const jump = steps.findIndex((step) => step?.type === "jump" && step.reference === "above");
      if (jump < 0) return steps;
      const lines = steps.slice(0, jump).filter((step) => !String(step?.text ?? "").startsWith("Okay, first question..."));
      return [...lines, ...tail];
    };
  }

  /** Talk-to Curpile at stage 52-54: the retry plays the quiz again from draw 1. */
  function talkToCurpile(event) {
    const { player } = event;
    const stage = quest.getStage(player);
    if (stage < STAGE_QUESTIONED_BY_CURPILE || stage >= STAGE_ANSWERED_QUESTIONS) return false;
    const tail = quizTail();
    if (!tail) {
      console.warn("[InSearchOfTheMyreque] Curpile's quiz tail is missing or unreadable in the dialogue record; the retry plays the plain variant");
      return false;
    }
    askedQuestion.delete(player);
    player.setAttribute(QUIZ_CORRECT_ATTRIBUTE, 0);
    event.handled = true;
    api.emitCustomEvent("npc-dialogue:start", {
      player,
      npc: event.npc,
      npcId: event.npcId,
      variant: CURPILE_RETRY_VARIANT,
      exact: true,
      select: spliceQuizRetry(tail),
    });
    return true;
  }

  /** Which transcript variant each speaker plays, by quest stage. */
  function selectVariant({ npcId, player }) {
    const stage = quest.getStage(player);
    if (VANSTROM_NPC_IDS.has(npcId)) {
      if (stage === STAGE_UNSTARTED) return "starting-out-vanstrom-klause";
      if (stage < STAGE_ESCAPED_TO_CANIFIS) return "starting-out-talking-to-vanstrom-klause-again";
      return null;
    }
    if (npcId === CYREG_NPC_ID) {
      if (stage < STAGE_STARTED) return null;
      if (stage < STAGE_REFUSED_DELIVERY) return "convincing-cyreg-paddlehorn-talking-to-cyreg";
      if (stage < STAGE_PERSUADED_BOATMAN) return "convincing-cyreg-paddlehorn-talking-to-cyreg-again";
      if (stage < STAGE_GAVE_PLANKS) return "convincing-cyreg-paddlehorn-talking-to-cyreg-after-convincing-him";
      return "convincing-cyreg-paddlehorn-talking-to-cyreg-after-fixing-the-boaty";
    }
    if (npcId === CURPILE_NPC_ID) {
      if (stage < STAGE_REACHED_HOLLOWS) return null;
      if (stage < STAGE_QUESTIONED_BY_CURPILE) return "convincing-curpile-fyod-talking-to-curpile-fyod";
      if (stage < STAGE_ANSWERED_QUESTIONS) return "convincing-curpile-fyod-talking-to-curpile-fyod-again-before-convincing-him";
      return "convincing-curpile-fyod-talking-to-curpile-fyod-again-after-convincing-him";
    }
    const member = MEMBERS.get(npcId);
    if (member) {
      if (stage >= STAGE_KILLED_HELLHOUND && stage < STAGE_COMPLETE) return member.after;
      if (stage === STAGE_ENTERED_HIDEOUT) {
        return `myreque-hideout-speaking-to-myreque-members-before-speaking-to-veliaf-${member.slug}`;
      }
      if (stage >= STAGE_MET_VELIAF && stage < STAGE_HELLHOUND_SUMMONED) {
        return `myreque-hideout-speaking-to-myreque-members-${member.slug}`;
      }
      return null;
    }
    if (VELIAF_NPC_IDS.has(npcId)) {
      if (stage === STAGE_ENTERED_HIDEOUT) {
        quest.setStage(player, STAGE_MET_VELIAF);
        return "myreque-hideout-talking-to-veliaf";
      }
      if (stage >= STAGE_MET_VELIAF && stage < STAGE_HELLHOUND_SUMMONED) {
        return allMembersMet(player)
          ? "myreque-hideout-speaking-to-veliaf-after-introduced-to-other-members"
          : "myreque-hideout-talking-to-veliaf-talking-to-veliaf-before-speaking-to-all-other-myreque-members";
      }
      if (stage >= STAGE_KILLED_HELLHOUND && stage < STAGE_COMPLETE) {
        return "myreque-hideout-after-defeating-the-skeleton-hellhound-veliaf-hurtz";
      }
      return null;
    }
    if (npcId === STRANGER_NPC_ID && stage >= STAGE_ESCAPED_TO_CANIFIS && stage < STAGE_COMPLETE) {
      return "myreque-hideout-finishing-up";
    }
    return null;
  }

  /** Answer the page's prose conditions. */
  function answerCondition({ npcId, player, text, stepId }) {
    const value = String(text).toLowerCase();
    // The four count conditions after the quiz, by their ids in the RSPSApp/osrsreboxed-db#108 record (counter = correct answers this attempt).
    if (QUIZ_COUNT_CONDITION_IDS.has(stepId)) return quizCorrect(player) === QUIZ_COUNT_CONDITION_IDS.get(stepId);
    if (value.includes("does not have a druid pouch")) return !hasDruidPouch(player);
    if (value.includes("has a druid pouch")) return hasDruidPouch(player);
    if (value.includes("does not have the correct weapons")) return !hasAllWeapons(player);
    // The wiki's "If first time speaking:" and "If speaking again:" are alternatives, but the runtime judges the sibling
    // after a chosen branch that ends in "continue" when it reaches it, by which time the first-time branch has set the
    // flag: so a conversation must not observe its own flag. The note holds the flags set by the first-time branch of the
    // conversation in progress: the first-time question clears it, and the one "speaking again" judgement that follows the
    // first-time branch consumes it (false once), so a later conversation, from any page, sees the flag as persisted.
    // Residual: an intro abandoned between the first-time branch and that tail judgement leaves the note until the next
    // first-time or "speaking again" judgement for the flag, a stage change of this quest, or a login.
    // These two conditions are the Myreque members' and Veliaf's: for any other NPC (Solztun's "If speaking again:" among
    // them) this plugin has no flag, and answering with Veliaf's "after the hellhound" flag leaked it into other pages.
    if ((value.includes("if first time speaking") || value.includes("if speaking again")) && !member(npcId) && !VELIAF_NPC_IDS.has(npcId)) return null;
    if (value.includes("if first time speaking")) {
      const flag = conditionFlag(npcId);
      metThisConversation.get(player)?.delete(flag);
      return !metFlag(player, flag);
    }
    if (value.includes("if speaking again")) {
      const flag = conditionFlag(npcId);
      const note = metThisConversation.get(player);
      if (note?.has(flag)) {
        note.delete(flag);
        return false;
      }
      return metFlag(player, flag);
    }
    if (value.includes("does not have the weapons")) return !hasAllWeapons(player);
    if (value.includes("does have the weapons")) return hasAllWeapons(player);
    return null;
  }

  const member = (npcId) => MEMBERS.get(npcId);
  function conditionFlag(npcId) {
    const entry = member(npcId);
    return entry ? entry.flag : "veliaf_after";
  }

  /** Wiki: 25 Agility and Nature Spirit. */
  const AGILITY_REQUIREMENT = 25;

  function meetsSkillRequirements(player) {
    return player.getSkillManager().getMaxLevel(Skill.AGILITY) >= AGILITY_REQUIREMENT;
  }

  function notifySkillRequirements(player) {
    if (!meetsSkillRequirements(player)) {
      player.sendMessage(
        `You need an Agility level of at least ${AGILITY_REQUIREMENT} to start this quest.`
      );
    }
  }

  function natureSpiritComplete(player) {
    const request = { player, key: "nature_spirit", complete: undefined };
    api.emitCustomEvent("quest:is-complete", request);
    return request.complete === true;
  }

  function handleStartHook(event) {
    const { player, npcId, hook } = event;
    if (hook !== START_HOOK || !VANSTROM_NPC_IDS.has(npcId)) return;
    if (quest.getStage(player) === STAGE_UNSTARTED) {
      if (!meetsSkillRequirements(player)) {
        event.end = true;
        notifySkillRequirements(player);
        return;
      }
      if (!natureSpiritComplete(player)) {
        event.end = true;
        player.sendMessage("You must complete Nature Spirit to start this quest.");
        return;
      }
      quest.setStage(player, STAGE_STARTED);
    }
  }

  function handInWeapons(player) {
    const stage = quest.getStage(player);
    if (stage < STAGE_MET_VELIAF || stage >= STAGE_DELIVERED_WEAPONS) return;
    if (!hasAllWeapons(player)) return;
    for (const weapon of WEAPONS) player.getInventory().deleteNumber(weapon.itemId, weapon.amount);
    quest.setStage(player, STAGE_DELIVERED_WEAPONS);
  }

  /**
   * Shows the plain Stranger instead of Vanstrom in the pub from the weapons hand-over (stage 70) on. Derived from the
   * persisted stage at every stage change (the runtime's quest:stage-changed) and at login, so a jump or a reset leaves
   * the pub consistent; void sets the varbit at the hand-over and clears it only on a quest reset (VeliafHurtz.kt:179).
   * The stage is persisted by the player save, so no attribute of its own is needed (the bridge varbits use an
   * attribute because they are not derivable from the stage).
   */
  function sendStrangerSwap(player) {
    player.getPacketSender().sendVarbit(VANSTROM_HIDE_VARBIT, quest.getStage(player) >= STAGE_DELIVERED_WEAPONS ? 1 : 0);
  }

  function handleStageChanged({ player, key }) {
    if (key !== "in_search_of_the_myreque") return;
    metThisConversation.delete(player);
    sendStrangerSwap(player);
  }

  function handleCondition(event) {
    const { player, stepId } = event;
    if (!player || !stepId) return;
    if (stepId === QUIZ_PASS_CONDITION_ID) {
      const stage = quest.getStage(player);
      if (stage >= STAGE_QUESTIONED_BY_CURPILE && stage < STAGE_ANSWERED_QUESTIONS) {
        quest.setStage(player, STAGE_ANSWERED_QUESTIONS);
      }
      return;
    }
    if (stepId === GIVE_WEAPONS_CONDITION_ID) {
      handInWeapons(player);
      return;
    }
    const flag = FIRST_SPEAKING_STEP_FLAGS.get(stepId);
    if (!flag) return;
    setMetFlag(player, flag);
    if (flag === "veliaf_after") {
      // The first-time page already describes the wall and ladder; release the exit leg.
      if (quest.getStage(player) === STAGE_KILLED_HELLHOUND) quest.setStage(player, STAGE_SHOWN_WAY_OUT);
    } else if (allMembersMet(player)) {
      const stage = quest.getStage(player);
      if (stage >= STAGE_MET_VELIAF && stage < STAGE_WEAPONS_ACCEPTED) {
        quest.setStage(player, STAGE_WEAPONS_ACCEPTED);
      }
    }
    // After the stage moves above: a stage change drops the note, and this conversation's tail judgement still needs it.
    if (!metThisConversation.has(player)) metThisConversation.set(player, new Set());
    metThisConversation.get(player).add(flag);
  }

  function handleChoice(event) {
    const { player, npcId, option } = event;
    if (!player) return;
    const text = String(option ?? "");
    // An answer to the question the last draw asked: the first choice after it. QUIZ_ANSWERS is keyed by the question text.
    const asked = askedQuestion.get(player);
    if (asked !== undefined && npcId === CURPILE_NPC_ID) {
      askedQuestion.delete(player);
      if (QUIZ_ANSWERS.get(asked) === text) player.setAttribute(QUIZ_CORRECT_ATTRIBUTE, quizCorrect(player) + 1);
      return;
    }
    const stage = quest.getStage(player);
    if (npcId === CYREG_NPC_ID && stage === STAGE_STARTED) {
      quest.setStage(player, STAGE_REFUSED_DELIVERY);
      return;
    }
    if (npcId === CURPILE_NPC_ID && text === "I've come to help the Myreque. I've brought weapons.") {
      if (stage >= STAGE_REACHED_HOLLOWS && stage < STAGE_QUESTIONED_BY_CURPILE && hasAllWeapons(player)) {
        quest.setStage(player, STAGE_QUESTIONED_BY_CURPILE);
      }
      return;
    }
    if (text === "How do I get out of here again?" && stage === STAGE_KILLED_HELLHOUND) {
      quest.setStage(player, STAGE_SHOWN_WAY_OUT);
    }
  }

  /**
   * The counted random's draw event (NpcDialogues, PR 5582): draw 1 starts a quiz attempt (the counter resets), and every
   * draw says which question is asked so the next choice can be scored against its answer.
   */
  function handleDraw(event) {
    const { player, npcId } = event;
    if (!player || npcId !== CURPILE_NPC_ID) return;
    if (event.draw === 1) player.setAttribute(QUIZ_CORRECT_ATTRIBUTE, 0);
    const line = String(event.question ?? "");
    const question = line.startsWith(QUIZ_QUESTION_PREFIX) ? line.slice(QUIZ_QUESTION_PREFIX.length) : line;
    if (!QUIZ_ANSWERS.has(question)) console.warn(`[InSearchOfTheMyreque] Curpile drew a question with no known answer, it will score as wrong: ${JSON.stringify(question)}`);
    askedQuestion.set(player, question);
  }

  /**
   * "I don't have to answer to you!": the transcript's action step says "Curpile hits the player for 3 damage." (void
   * CurpileFyod.kt sendPunch: curpile_punch, one tick, damage). Matched by the step's text so a re-export that renames the
   * step id does not drop it; the amount is the text's number (3, as the Wiki). void stores Constitution in tenths (Levels.kt:
   * 154, 157), so sendPunch's damage(30) is 3 hit points. The punch animation and its one-tick delay are not reproduced, and
   * the hit has no death protection (void has none either).
   */
  const CURPILE_PUNCH_TEXT = /^Curpile hits the player for (\d+) damage\.$/;

  function handleAction(event) {
    const { player, stepId } = event;
    if (!player) return;
    const punch = event.npcId === CURPILE_NPC_ID ? CURPILE_PUNCH_TEXT.exec(String(event.text ?? "")) : null;
    if (punch) {
      player.getCombat().getHitQueue().addPendingDamage([new api.core.HitDamage(Number(punch[1]), api.core.HitMask.RED)]);
      return;
    }
    if (!stepId) return;
    if (stepId === SHOW_POUCH_MESSAGE_ID) {
      const stage = quest.getStage(player);
      if (stage >= STAGE_REFUSED_DELIVERY && stage < STAGE_PERSUADED_BOATMAN) {
        quest.setStage(player, STAGE_PERSUADED_BOATMAN);
      }
      return;
    }
    if (stepId === PLANKS_MESSAGE_ID) {
      if (!held(player, PLANK_ITEM_ID, 3)) {
        event.handled = true;
        player.sendMessage("You don't have three planks to give him.");
        return;
      }
      player.getInventory().deleteNumber(PLANK_ITEM_ID, 3);
      if (quest.getStage(player) === STAGE_PERSUADED_BOATMAN) quest.setStage(player, STAGE_GAVE_PLANKS);
      return;
    }
    if (KNOCKOUT_MESSAGE_IDS.has(stepId)) {
      player.moveTo(new api.core.Location(3522, 3285, 0));
      return;
    }
    if (stepId === CUTSCENE_START_ACTION_ID || stepId === SUMMON_HOUND_ACTION_ID) {
      summonHellhound(player);
    }
  }

  function handleLine(event) {
    if (event.npcId !== STRANGER_NPC_ID || event.text !== "I definitely have!") return;
    const stage = quest.getStage(event.player);
    if (stage >= STAGE_ESCAPED_TO_CANIFIS && !quest.isComplete(event.player)) {
      quest.complete(event.player);
    }
  }

  // ---- Skeleton Hellhound ----

  function ensureHellhound(player) {
    if (quest.getStage(player) !== STAGE_HELLHOUND_SUMMONED || houndByPlayer.has(player)) return;
    const npc = api.spawnNpc({
      id: NpcIdentifiers.SKELETON_HELLHOUND,
      x: HELLHOUND_SPOT.x,
      y: HELLHOUND_SPOT.y,
      z: HELLHOUND_SPOT.z,
      wanderRadius: 0,
      owner: player,
      ownerOnly: true,
    });
    if (npc) houndByPlayer.set(player, npc);
  }

  function removeHellhound(player) {
    const npc = houndByPlayer.get(player);
    if (npc) api.removeNpc(npc);
    houndByPlayer.delete(player);
  }

  function summonHellhound(player) {
    const stage = quest.getStage(player);
    if (stage < STAGE_DELIVERED_WEAPONS) return;
    if (stage < STAGE_HELLHOUND_SUMMONED) quest.setStage(player, STAGE_HELLHOUND_SUMMONED);
    ensureHellhound(player);
  }

  function handleNpcDeath(event) {
    const player = event.killer ?? event.player;
    if (!player || !HELLHOUND_NPC_IDS.has(event.npcId)) return;
    if (quest.getStage(player) !== STAGE_HELLHOUND_SUMMONED) return;
    removeHellhound(player);
    quest.setStage(player, STAGE_KILLED_HELLHOUND);
    player.sendMessage("You have defeated the Skeleton Hellhound.");
  }

  // ---- Object interactions ----

  /**
   * Wiki "Mending the bridge": "Climb up to see a damaged rope bridge. Mend the bridge as you walk along ... and then
   * climb down the other side of the bridge." Wiki/void-based, no capture (void SearchMyreque.kt:186-203 climbTree): the
   * north tree needs the top rung repaired, else "This bridge run looks broken; you would have nowhere to stand. The
   * southern side of the rope bridge looks much less damaged."; "You climb the tree."; from the bank side the climb goes
   * up onto the bridge, from the bridge it goes down to the bank. DEVIATION (ours): void gates on the top rung alone
   * because walking onto an unrepaired rung breaks it (SearchMyreque.kt:55-71) and we do not implement that, so a player
   * could repair only the top rung and descend; until the break exists we require all three rungs, with void's statement.
   * The no-reason gate below is ours (the existing one).
   */
  function climbTree(event) {
    const { player, location } = event;
    event.handled = true;
    if (quest.getStage(player) < STAGE_REACHED_HOLLOWS) {
      player.sendMessage("You have no reason to cross here.");
      return;
    }
    const tree = location ?? player.getLocation();
    const north = tree.y === NORTH_TREE_Y;
    if (north && !bridgeRepaired(player)) {
      player.sendMessage("This bridge run looks broken; you would have nowhere to stand. The southern side of the rope bridge looks much less damaged.");
      return;
    }
    const y = player.getLocation().getY();
    const up = north ? y >= tree.y : y <= tree.y;
    let landing;
    if (north) landing = up ? { x: tree.x, y: BRIDGE_TOP_Y } : NORTH_BANK;
    else landing = up ? { x: tree.x, y: BRIDGE_LANDING_Y } : SOUTH_BANK;
    player.sendMessage("You climb the tree.");
    player.moveTo(new api.core.Location(landing.x, landing.y, tree.z ?? 0));
  }

  function crossBridge(event) {
    const { player, location } = event;
    const stage = quest.getStage(player);
    event.handled = true;
    if (stage < STAGE_REACHED_HOLLOWS) {
      player.sendMessage("You have no reason to cross here.");
      return;
    }
    if (!bridgeRepaired(player)) {
      player.sendMessage("This bridge looks pretty old. The wooden boards break apart beneath your feet.");
      return;
    }
    const north = player.getLocation().getY() >= 3430;
    player.moveTo(new api.core.Location(north ? 3502 : 3503, north ? 3425 : 3431, location?.z ?? 0));
  }

  /**
   * One walk step onto an adjacent rung; a rung that is not next to the player is left alone. The rung keeps its
   * broken loc's clipping on the server (the repaired look is the client's varbit multiloc), so the step ignores
   * clipping for the one tick it takes, as Brimhaven's vines do.
   */
  function stepOnto(player, location) {
    const here = player.getLocation();
    const dx = location.x - here.getX(), dy = location.y - here.getY();
    if ((location.z ?? 0) !== here.getZ() || Math.abs(dx) > 1 || Math.abs(dy) > 1 || (dx === 0 && dy === 0)) return;
    const pass = {};
    rungSteps.set(player, pass);
    player.setFlag(IGNORE_CLIPPING_FLAG, true);
    player.getMovementQueue().walkStep(dx, dy);
    api.core.TaskManager.submit(new api.core.CountdownTask(pass, RUNG_STEP_TICKS, () => {
      if (rungSteps.get(player) !== pass) return;
      rungSteps.delete(player);
      player.removeFlag(IGNORE_CLIPPING_FLAG);
    }));
  }

  function repairBridgeRung(event) {
    const { player, objectId } = event;
    event.handled = true;
    if (quest.getStage(player) < STAGE_REACHED_HOLLOWS) return;
    const varbit = BRIDGE_RUNG_VARBITS[objectId] ?? firstBrokenRung(player);
    if (varbit === undefined || rungRepaired(player, varbit)) {
      player.sendMessage("This bridge run already looks fixed, that's why you're able to stand on it.");
      return;
    }
    if (!hasBridgeMaterials(player)) {
      player.sendMessage("You don't have the required materials to fix this part of the bridge.");
      return;
    }
    player.getInventory().deleteNumber(PLANK_ITEM_ID, 1);
    player.getInventory().deleteNumber(STEEL_NAILS_ITEM_ID, 75);
    markRungRepaired(player, varbit);
    player.getPacketSender().sendVarbit(varbit, 1);
    player.sendMessage("You repair this part of the rope bridge.");
    if (bridgeRepaired(player)) {
      player.getPacketSender().sendVarbit(3928, 7);
      player.sendMessage("The rope bridge is now fully repaired.");
    }
    // The player then walks onto the repaired rung, which puts the next rung within reach ("Mend the bridge as you
    // walk along", Wiki). rsprox_transcripts/231/00366.txt tick 6822: the rung's op and a one-tile walk step (not a
    // teleport) on the same tick.
    if (event.location) stepOnto(player, event.location);
  }

  function useStalagmite(event) {
    const { player, clickType } = event;
    event.handled = true;
    if (clickType === 1) {
      player.sendMessage("It looks like an ordinary stalagmite, however, beyond it you can see that there is a small cave entrance.");
      return;
    }
    player.moveTo(new api.core.Location(3505, 9832, 0));
    if (quest.getStage(player) === STAGE_HELLHOUND_SUMMONED) ensureHellhound(player);
  }

  function enterSurfaceDoors(event) {
    const { player } = event;
    event.handled = true;
    if (quest.getStage(player) < STAGE_ANSWERED_QUESTIONS) {
      player.sendMessage("There seems to be a strange combination on the door. It would take ages to work it out.");
      return;
    }
    player.moveTo(new api.core.Location(3500, 9812, 0));
    player.sendMessage("You push open the doors and descend into the cave.");
  }

  function enterHiddenCave(event) {
    const { player } = event;
    event.handled = true;
    if (quest.getStage(player) < STAGE_ANSWERED_QUESTIONS) return;
    const inside = player.getLocation().getX() >= 3502 && player.getLocation().getY() >= 9829;
    if (inside) {
      player.moveTo(new api.core.Location(3500, 9812, 0));
      player.sendMessage("You squeeze back out into the main cave.");
      return;
    }
    if (quest.getStage(player) === STAGE_ANSWERED_QUESTIONS) quest.setStage(player, STAGE_ENTERED_HIDEOUT);
    player.moveTo(new api.core.Location(3505, 9832, 0));
    player.sendMessage("You squeeze through the hidden entrance into the Myreque hideout.");
  }

  /**
   * Passes through the hidden wall to the side the player is NOT on, from either side. Wiki/void-based, no capture: void
   * SearchMyreque.kt:135-145 ends the Search with enterDoor(target) and "You walk through."; the two sides are the
   * cache-derived tiles above. Like the repo's other door passes (CooksGuild.plugin.js walkThrough): movement is blocked,
   * the player is put on the near tile if needed, and a one-tile forced walk crosses the edge. No door-open sound or
   * graphic (ours: void's enterDoor internals were not read).
   */
  function passThroughWall(player) {
    const { Location, ForceMovement, ForceMovementTask, TaskManager, Task } = api.core;
    const here = player.getLocation();
    const goingNorth = here.getY() <= WALL_SOUTH_SIDE.y;
    const from = goingNorth ? WALL_SOUTH_SIDE : WALL_NORTH_SIDE;
    const start = new Location(from.x, from.y, here.getZ());
    player.getMovementQueue().setBlockMovement(true).reset();
    if (!here.equals(start)) player.moveTo(start.clone());
    TaskManager.submit(new ForceMovementTask(player, 1,
      new ForceMovement(start.clone(), new Location(0, goingNorth ? 1 : -1), 0, 30, goingNorth ? 0 : 2, WALK_ANIMATION)));
    TaskManager.submit(new (class extends Task {
      constructor() { super(3, player, false); }
      execute() {
        this.stop();
        player.getMovementQueue().setBlockMovement(false);
        player.sendMessage("You walk through.");
      }
    })());
  }

  function handleObjectInteraction(event) {
    const { player, objectId } = event;
    if (!player) return;
    const stage = quest.getStage(player);
    if (objectId === SURFACE_DOORS_ID) {
      enterSurfaceDoors(event);
      return;
    }
    if (objectId === CAVE_ENTRANCE_ID) {
      enterHiddenCave(event);
      return;
    }
    if (objectId === BRIDGE_TREE_PARENT_ID || BRIDGE_TREE_IDS.has(objectId)) {
      climbTree(event);
      return;
    }
    if (objectId === ROPE_BRIDGE_ID) {
      crossBridge(event);
      return;
    }
    if (BROKEN_BRIDGE_IDS.has(objectId)) {
      repairBridgeRung(event);
      return;
    }
    if (objectId === STALAGMITE_ID) {
      useStalagmite(event);
      return;
    }
    if (objectId === FAKE_WALL_ID) {
      event.handled = true;
      if (stage < STAGE_SHOWN_WAY_OUT) {
        player.sendMessage("You see nothing interesting with this wall.");
        return;
      }
      player.sendMessage("You search the wall and find the door which Veliaf told you about.");
      if (stage === STAGE_SHOWN_WAY_OUT) quest.setStage(player, STAGE_IN_INN_BASEMENT);
      passThroughWall(player);
      return;
    }
    if (objectId === TAVERN_LADDER_ID) {
      event.handled = true;
      player.sendMessage("You climb the ladder out into the outside.");
      if (stage === STAGE_IN_INN_BASEMENT) quest.setStage(player, STAGE_ESCAPED_TO_CANIFIS);
      player.moveTo(new api.core.Location(3495, 3466, 0));
      player.sendMessage("You emerge to the south of the 'Hair of the Dog' tavern in Canifis.");
      return;
    }
    if (objectId === TAVERN_TRAPDOOR_ID) {
      event.handled = true;
      if (!quest.isComplete(player)) {
        player.sendMessage("This trap door seems locked, you're not really sure where it would lead to.");
        return;
      }
      player.moveTo(new api.core.Location(3477, 9845, 0));
      player.sendMessage("You open the trapdoor and find yourself in the inn basement.");
      return;
    }
    if (HIDEOUT_DOOR_IDS.has(objectId)) {
      event.handled = true;
      if (stage < STAGE_ANSWERED_QUESTIONS) {
        player.sendMessage("There seems to be a strange combination on the door. It would take ages to work it out.");
        return;
      }
      if (stage === STAGE_ANSWERED_QUESTIONS) quest.setStage(player, STAGE_ENTERED_HIDEOUT);
      player.moveTo(new api.core.Location(3500, 9812, 0));
      player.sendMessage("You push open the heavy doors and descend towards the hideout.");
      return;
    }
    if (objectId === MORT_TON_BOAT_ID) {
      event.handled = true;
      if (stage < STAGE_GAVE_PLANKS) {
        player.sendMessage("You don't have the boatman's permission to use his boat.");
        return;
      }
      const wornRing = player.getEquipment().get(api.core.Equipment.RING_SLOT)?.getId?.();
      const hasCharos = RING_OF_CHAROS_A_ITEM_IDS.includes(wornRing);
      if (!hasCharos) {
        if (!held(player, COINS_ITEM_ID, 10)) {
          player.sendMessage("You need 10 coins to rent the boat.");
          return;
        }
        player.getInventory().deleteNumber(COINS_ITEM_ID, 10);
      }
      if (stage === STAGE_GAVE_PLANKS) quest.setStage(player, STAGE_REACHED_HOLLOWS);
      player.moveTo(new api.core.Location(3498, 3380, 0));
      player.sendMessage("You board the boat and journey to the Hollows.");
      api.emitCustomEvent("transport:swamp-boaty", { player, from: "mortton", to: "hollows" });
      return;
    }
    if (objectId === HOLLOWS_BOAT_ID) {
      event.handled = true;
      player.moveTo(new api.core.Location(3522, 3285, 0));
      player.sendMessage("You board the boat and journey back to Mort'ton.");
      api.emitCustomEvent("transport:swamp-boaty", { player, from: "hollows", to: "mortton" });
      return;
    }
    if (objectId === HOLLOWS_SIGN_ID) {
      event.handled = true;
      player.sendMessage("The sign reads: 'The Hollows'.");
    }
  }

  function handleLogin({ player }) {
    metThisConversation.delete(player);
    sendStrangerSwap(player);
    refreshQuestList(player);
    if (bridgeRepaired(player)) {
      for (const varbit of [176, 177, 178]) player.getPacketSender().sendVarbit(varbit, 1);
      player.getPacketSender().sendVarbit(3928, 7);
    } else {
      for (const varbit of [176, 177, 178]) {
        if (rungRepaired(player, varbit)) player.getPacketSender().sendVarbit(varbit, 1);
      }
    }
    ensureHellhound(player);
  }

  function handleLogout({ player }) {
    if (player) removeHellhound(player);
  }

  api.persistAttribute(BRIDGE_ATTRIBUTE);
  api.persistAttribute(QUIZ_CORRECT_ATTRIBUTE);
  for (const flag of ["met_sani", "met_harold", "met_radigad", "met_polmafi", "met_ivan", "veliaf_after"]) {
    api.persistAttribute(`quest.in_search_of_the_myreque.${flag}`);
  }

  quest = registerQuest(api, {
    key: "in_search_of_the_myreque",
    name: "In Search of the Myreque",
    varpId: VARP_IN_SEARCH_OF_THE_MYREQUE,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 2,
    xpRewards: [
      { skillId: Skill.ATTACK.getIndex(), amount: 600, label: "Attack" },
      { skillId: Skill.DEFENCE.getIndex(), amount: 600, label: "Defence" },
      { skillId: Skill.STRENGTH.getIndex(), amount: 600, label: "Strength" },
      { skillId: Skill.HITPOINTS.getIndex(), amount: 600, label: "Hitpoints" },
      { skillId: Skill.CRAFTING.getIndex(), amount: 600, label: "Crafting" },
    ],
    otherRewards: ["Access to the Hollows", "A boat shortcut between Mort'ton and the Hollows"],
    buildJournal,
    onReward: grantReward,
  });

  api.onNpcDialogueVariant(selectVariant);
  api.onNpcInteraction("Curpile Fyod", { "Talk-to": talkToCurpile });
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("npc-dialogue:condition", handleCondition);
  api.onCustomEvent("npc-dialogue:choice", handleChoice);
  api.onCustomEvent("npc-dialogue:draw", handleDraw);
  api.onCustomEvent("quest:stage-changed", handleStageChanged);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onCustomEvent("npc-dialogue:line", handleLine);
  api.onNpcDeath(handleNpcDeath);
  api.onObjectInteraction(handleObjectInteraction);
  api.onPlayerLogin(handleLogin);
  api.onPlayerLogout(handleLogout);
};
