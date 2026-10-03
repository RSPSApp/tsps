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
 * owner-only. The Curpile quiz dump lists all six questions as one menu, so the
 * runtime only ever plays one question - a single correct answer passes
 * (ponytail: wiki dump flattens the three-random-question quiz, split it when
 * the runtime can replay sub-menus). Curpile's 3-damage punch is not applied.
 * Per-player bridge rungs live in a persisted attribute mirrored to varbits
 * 176-178/3928; the world clipping is not edited.
 */
module.exports = function registerInSearchOfTheMyrequeQuest(api) {
  const { Skill, ItemIdentifiers, NpcIdentifiers, ObjectIdentifiers } = api.core;
  const { registerQuest, refreshQuestList } = require("../QuestRuntime");

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
  const STEEL_SWORD_ITEM_ID = ItemIdentifiers.STEEL_SWORD;
  const STEEL_DAGGER_ITEM_ID = ItemIdentifiers.STEEL_DAGGER;
  const STEEL_MACE_ITEM_ID = ItemIdentifiers.STEEL_MACE;
  const STEEL_WARHAMMER_ITEM_ID = ItemIdentifiers.STEEL_WARHAMMER;
  const PLANK_ITEM_ID = ItemIdentifiers.PLANK;
  const STEEL_NAILS_ITEM_ID = ItemIdentifiers.STEEL_NAILS;
  const HAMMER_ITEM_ID = ItemIdentifiers.HAMMER;
  const DRUID_POUCH_ITEM_IDS = [
    ItemIdentifiers.DRUID_POUCH,
    ItemIdentifiers.DRUID_POUCH_2,
    ItemIdentifiers.DRUID_POUCH_3,
  ];

  /** The steel delivery Vanstrom asks for (amounts matter for two swords). */
  const WEAPONS = [
    { itemId: STEEL_LONGSWORD_ITEM_ID, amount: 1, label: "1 x Steel longsword" },
    { itemId: STEEL_SWORD_ITEM_ID, amount: 2, label: "2 x Steel sword" },
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
  const BROKEN_BRIDGE_IDS = new Set([
    ObjectIdentifiers.BROKEN_ROPE_BRIDGE_2, // 26244
    26245, // broken rope bridge rung, varbit 176
    26246, // broken rope bridge rung, varbit 177
    26247, // broken rope bridge rung, varbit 178
  ]);
  const BRIDGE_RUNG_VARBITS = { 26245: 176, 26246: 177, 26247: 178 };
  const BRIDGE_TREE_IDS = new Set([ObjectIdentifiers.TREE_117, ObjectIdentifiers.TREE_118]); // 26248, 26249
  const STALAGMITE_ID = ObjectIdentifiers.STALAGMITE_3; // 5050
  const CAVE_TUNNEL_ID = ObjectIdentifiers.CAVE_ENTRANCE_27; // 5046
  const FAKE_WALL_ID = ObjectIdentifiers.WALL_17; // 5052
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
  const QUIZ_START_ACTION_ID = "sXzRb_";
  const QUIZ_PASS_CONDITION_ID = "3l6Jxc";
  const SHOW_POUCH_MESSAGE_ID = "BKpf08";
  const PLANKS_MESSAGE_ID = "DsO5TF";
  const GIVE_WEAPONS_CONDITION_ID = "VLPyT3";
  const CUTSCENE_START_ACTION_ID = "bLWS_j";
  const SUMMON_HOUND_ACTION_ID = "OFmcmp";
  const KNOCKOUT_MESSAGE_IDS = new Set(["kDZQpN", "4t7Rpj", "iVqbuD"]);
  const FIRST_SPEAKING_STEP_FLAGS = new Map([
    ["k_vzYt", "met_harold"],
    ["_g5SY-", "met_radigad"],
    ["25JBP_", "met_polmafi"],
    ["C5YuIy", "met_sani"],
    ["KI2Pb0", "met_ivan"],
    ["a8YEIJ", "veliaf_after"],
  ]);
  /** The one quiz question the runtime plays -> its correct option text. */
  const QUIZ_ANSWERS = new Map([
    [1, "Sani Piliu."],
    [2, "Ivan Strom."],
    [3, "Veliaf Hurtz."],
    [4, "Polmafi Ferdygris."],
    [5, "Cyreg Paddlehorn."],
    [6, "Drakan."],
  ]);

  const BRIDGE_ATTRIBUTE = "quest.in_search_of_the_myreque.bridge";
  const QUIZ_CORRECT_ATTRIBUTE = "quest.in_search_of_the_myreque.quiz.correct";
  const QUIZ_QUESTION_ATTRIBUTE = "quest.in_search_of_the_myreque.quiz.question";
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
      if (stage >= STAGE_KILLED_HELLHOUND) return member.after;
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
  function answerCondition({ npcId, player, text }) {
    const value = String(text).toLowerCase();
    if (value.includes("does not have a druid pouch")) return !hasDruidPouch(player);
    if (value.includes("has a druid pouch")) return hasDruidPouch(player);
    if (value.includes("does not have the correct weapons")) return !hasAllWeapons(player);
    if (value.includes("answered zero out of three questions correctly")) return quizCorrect(player) === 0;
    // ponytail: the dump flattens the 3-question quiz into one menu, so a single
    // correct answer stands in for all three; split when the runtime replays menus.
    if (value.includes("answered one out of three questions correctly")) return false;
    if (value.includes("answered two out of three questions correctly")) return false;
    if (value.includes("answered three out of three questions correctly")) return quizCorrect(player) >= 1;
    if (value.includes("if first time speaking")) return !metFlag(player, conditionFlag(npcId));
    if (value.includes("if speaking again")) return metFlag(player, conditionFlag(npcId));
    if (value.includes("does not have the weapons")) return !hasAllWeapons(player);
    if (value.includes("does have the weapons")) return hasAllWeapons(player);
    return null;
  }

  const member = (npcId) => MEMBERS.get(npcId);
  function conditionFlag(npcId) {
    const entry = member(npcId);
    return entry ? entry.flag : "veliaf_after";
  }

  function handleStartHook({ player, npcId, hook }) {
    if (hook !== START_HOOK || !VANSTROM_NPC_IDS.has(npcId)) return;
    if (quest.getStage(player) === STAGE_UNSTARTED) quest.setStage(player, STAGE_STARTED);
  }

  function handInWeapons(player) {
    const stage = quest.getStage(player);
    if (stage < STAGE_MET_VELIAF || stage >= STAGE_DELIVERED_WEAPONS) return;
    if (!hasAllWeapons(player)) return;
    for (const weapon of WEAPONS) player.getInventory().deleteNumber(weapon.itemId, weapon.amount);
    quest.setStage(player, STAGE_DELIVERED_WEAPONS);
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
    if (flag !== "veliaf_after" && allMembersMet(player)) {
      const stage = quest.getStage(player);
      if (stage >= STAGE_MET_VELIAF && stage < STAGE_WEAPONS_ACCEPTED) {
        quest.setStage(player, STAGE_WEAPONS_ACCEPTED);
      }
    }
  }

  function handleChoice(event) {
    const { player, npcId, option } = event;
    if (!player) return;
    const text = String(option ?? "");
    const dialogue = /^Dialogue (\d)$/.exec(text);
    if (dialogue) {
      player.setAttribute(QUIZ_QUESTION_ATTRIBUTE, Number(dialogue[1]));
      return;
    }
    const question = Number(player.getAttribute(QUIZ_QUESTION_ATTRIBUTE)) || 0;
    if (QUIZ_ANSWERS.get(question) === text) {
      player.setAttribute(QUIZ_CORRECT_ATTRIBUTE, quizCorrect(player) + 1);
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

  function handleAction(event) {
    const { player, stepId } = event;
    if (!player || !stepId) return;
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
    if (stepId === QUIZ_START_ACTION_ID) {
      player.setAttribute(QUIZ_CORRECT_ATTRIBUTE, 0);
      player.setAttribute(QUIZ_QUESTION_ATTRIBUTE, 0);
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

  function handleObjectInteraction(event) {
    const { player, objectId } = event;
    if (!player) return;
    const stage = quest.getStage(player);
    if (objectId === ROPE_BRIDGE_ID || BRIDGE_TREE_IDS.has(objectId)) {
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
    if (objectId === CAVE_TUNNEL_ID) {
      event.handled = true;
      player.moveTo(new api.core.Location(3491, 9824, 0));
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
      player.moveTo(new api.core.Location(3477, 9845, 0));
      player.sendMessage("You walk through.");
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
      if (stage === STAGE_GAVE_PLANKS) quest.setStage(player, STAGE_REACHED_HOLLOWS);
      player.moveTo(new api.core.Location(3498, 3380, 0));
      player.sendMessage("You board the boat and journey to the Hollows.");
      return;
    }
    if (objectId === HOLLOWS_BOAT_ID) {
      event.handled = true;
      player.moveTo(new api.core.Location(3522, 3285, 0));
      player.sendMessage("You board the boat and journey back to Mort'ton.");
      return;
    }
    if (objectId === HOLLOWS_SIGN_ID) {
      event.handled = true;
      player.sendMessage("The sign reads: 'The Hollows'.");
    }
  }

  function handleLogin({ player }) {
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
  api.persistAttribute(QUIZ_QUESTION_ATTRIBUTE);
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
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("npc-dialogue:condition", handleCondition);
  api.onCustomEvent("npc-dialogue:choice", handleChoice);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onCustomEvent("npc-dialogue:line", handleLine);
  api.onNpcDeath(handleNpcDeath);
  api.onObjectInteraction(handleObjectInteraction);
  api.onPlayerLogin(handleLogin);
  api.onPlayerLogout(handleLogout);
};
