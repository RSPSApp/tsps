/**
 * In Aid of the Myreque (members).
 *
 * Aligned with a full live playthrough (rsprox capture, revision 242, the user's recording
 * "In Aid of the Myreque"); the facts each step relies on, with capture ticks, are in
 * docs/quests/in-aid-of-the-myreque/README.md. Words come from the "In Aid of the Myreque" transcript
 * page (npc-dialogues.json); the units below pick its variants and do what live did around them.
 *
 * The stage is varbit 1990 with live's values; the rest of the quest's state is live's own quest
 * varbits (varps 704-706), which the cache's multilocs (the inn rubble and trapdoor, the store roof
 * and wall, the bank booth and wall, the furnace, the temple trapdoor, the tomb boards) and
 * multinpcs (Cornelius, the blood-tithe cast, the Canifis hideout's Myreque) read per player.
 * See ../inaid/State.InAidOfTheMyreque.js.
 *
 * Units (../inaid/):
 * - Burgh: Florin, the gate and food chest, the inn, its cellar (stages 0-110).
 * - Store: Aurel's store repairs and stock, the bank, Cornelius, the furnace (110-210).
 * - Tithe: lighting the furnace, the Castle Drakan scene, Gadderanks' blood tithe and the store
 *   fight, the Gadderhammer (210-280).
 * - Escort: Veliaf's start and the Canifis hideout, Ivan's supplies and escort, Drezel, the temple
 *   library trapdoor (0-20, 280-360).
 * - Rod: the library, the tomb, the Rod of Ivandis, the hand-in and completion (360-430).
 */
module.exports = function registerInAidOfTheMyrequeQuest(api) {
  const { Skill, NpcIdentifiers, ItemIdentifiers } = api.core;
  const { registerQuest, refreshQuestList } = require("../QuestRuntime");
  const { createState, STAGE, VARBIT } = require("../inaid/State.InAidOfTheMyreque");
  const { createCommon, PAGE } = require("../inaid/Common.InAidOfTheMyreque");

  let quest;
  const state = createState(api, () => quest);
  const common = createCommon(api, state);
  const context = { api, state, common, STAGE, VARBIT, PAGE, quest: () => quest };

  const REQUIRED_QUESTS = [
    { key: "in_search_of_the_myreque", name: "In Search of the Myreque" },
    { key: "nature_spirit", name: "Nature Spirit" },
    { key: "priest_in_peril", name: "Priest in Peril" },
    { key: "the_restless_ghost", name: "The Restless Ghost" },
  ];
  const REQUIRED_SKILLS = [
    { skill: Skill.CRAFTING, level: 25, label: "Crafting" },
    { skill: Skill.MINING, level: 15, label: "Mining" },
    { skill: Skill.MAGIC, level: 7, label: "Magic" },
    { skill: Skill.AGILITY, level: 25, label: "Agility" },
  ];
  const REWARD_SKILLS = [
    { skill: Skill.ATTACK, label: "Attack" },
    { skill: Skill.STRENGTH, label: "Strength" },
    { skill: Skill.CRAFTING, label: "Crafting" },
    { skill: Skill.DEFENCE, label: "Defence" },
  ];
  const REWARD_XP = 2000;
  const ROD_OF_IVANDIS_ITEM_ID = ItemIdentifiers.ROD_OF_IVANDIS_10_; // 7639
  /** Live's completion jingle for this quest (capture, the scroll's tick). */
  const COMPLETION_JINGLE = 154;

  function questComplete(player, key) {
    const request = { player, key, complete: null };
    api.emitCustomEvent("quest:is-complete", request);
    return request.complete === true;
  }

  function meetsRequirements(player) {
    if (!REQUIRED_QUESTS.every((entry) => questComplete(player, entry.key))) return false;
    const skills = player.getSkillManager();
    return REQUIRED_SKILLS.every((entry) => skills.getMaxLevel(entry.skill) >= entry.level);
  }

  /** Ours: no capture of a refused start; the lines name what is missing. */
  function requirementsMessage(player) {
    for (const entry of REQUIRED_QUESTS) {
      if (!questComplete(player, entry.key)) player.sendMessage(`You must have completed ${entry.name} to start this quest.`);
    }
    const skills = player.getSkillManager();
    for (const entry of REQUIRED_SKILLS) {
      if (skills.getMaxLevel(entry.skill) < entry.level) player.sendMessage(`You need ${entry.level} ${entry.label} to start this quest.`);
    }
  }
  context.meetsRequirements = meetsRequirements;
  context.requirementsMessage = requirementsMessage;

  // ---------------------------------------------------------------------------
  // Journal (Ours: the capture never opened it; the wording follows the quest's steps)
  // ---------------------------------------------------------------------------

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage >= STAGE.COMPLETE) {
      return [
        "<str>Veliaf asked me to help the Myreque find a new home in</str>",
        "<str>Burgh de Rott. I cleared the inn cellar, repaired and</str>",
        "<str>stocked the general store and bank, and lit the furnace.</str>",
        "<str>We defeated Gadderanks and his juvinates, and I escorted</str>",
        "<str>Ivan to Paterdomus, where Drezel gave me the library key.</str>",
        "<str>I made the Rod of Ivandis and gave it to Veliaf.</str>",
        "",
        "<col=ff0000>QUEST COMPLETE!</col>",
      ];
    }
    if (stage <= 0) {
      return [
        "I can start this quest by speaking to <col=800000>Veliaf Hurtz</col>",
        "in the <col=800000>Myreque Hideout</col> beneath the Canifis pub.",
        "",
        "I have completed In Search of the Myreque, Nature Spirit,",
        "Priest in Peril and The Restless Ghost, with 25 Crafting,",
        "15 Mining, 7 Magic and 25 Agility.",
      ];
    }
    const lines = [
      "<str>Veliaf asked me to find a new base for the Myreque in</str>",
      "<str>Burgh de Rott and to win over the townspeople.</str>",
      "",
    ];
    const step = [
      [STAGE.FLORIN_TALKED, "I should travel to <col=800000>Burgh de Rott</col> south of Mort'ton."],
      [STAGE.TOLD_INN, "The gate is barred. I need the townspeople to trust me."],
      [STAGE.CELLAR_CLEARED, "I need to clear the <col=800000>rubble</col> out of the inn cellar."],
      [STAGE.STORE_STOCKED, "I am helping <col=800000>Aurel</col> fix up the general store."],
      [STAGE.BANKER, "I am repairing the <col=800000>bank</col> in Burgh de Rott."],
      [STAGE.FURNACE_LIT, "I am repairing and lighting the <col=800000>furnace</col>."],
      [STAGE.GADDERANKS_DEAD, "Gadderanks is taking a blood tithe from Burgh de Rott. I should defend the town."],
      [STAGE.ESCORT, "I should speak with <col=800000>Veliaf</col> in the Myreque hideout."],
      [STAGE.DREZEL_TALKED, "I am escorting <col=800000>Ivan Strom</col> to Paterdomus."],
      [STAGE.LIBRARY_OPEN, "I should ask <col=800000>Drezel</col> about Ivandis' tomb."],
      [STAGE.TOMB_ENTERED, "I should search the <col=800000>library</col> under Paterdomus."],
      [STAGE.ROD_BLESSED, "I am recreating the <col=800000>Rod of Ivandis</col> from the tomb."],
      [STAGE.COMPLETE, "I should give the <col=800000>Rod of Ivandis</col> to Veliaf in Burgh de Rott."],
    ].find(([until]) => stage < until);
    if (step) lines.push(step[1]);
    return lines;
  }

  function grantReward(player) {
    const skills = player.getSkillManager();
    for (const reward of REWARD_SKILLS) skills.addExperiences(reward.skill, REWARD_XP);
  }

  // ---------------------------------------------------------------------------
  // The transcript's prose placeholders and the citizens' own lines
  // ---------------------------------------------------------------------------

  const POH_HOUSE_ATTRIBUTE = "construction:house";
  /** Player-owned house locations (native POH_HOUSE_LOCATION enum 252 order). */
  const POH_LOCATION_NAMES = new Map([
    [1, "Rimmington"], [2, "Taverley"], [3, "Pollnivneach"], [8, "Hosidius"], [4, "Rellekka"],
    [13, "Aldarin"], [5, "Brimhaven"], [6, "Yanille"], [9, "Prifddinas"],
  ]);

  function playerHouseLocation(player) {
    const save = player.getAttribute?.(POH_HOUSE_ATTRIBUTE);
    const id = save && typeof save === "object" ? Number(save.location) : NaN;
    return POH_LOCATION_NAMES.get(id) ?? "Rimmington";
  }

  function ownsLine(request) {
    const pages = request?.pages;
    return !Array.isArray(pages) || pages.some((entry) => entry?.page === PAGE);
  }

  /** Fills the transcript's prose placeholders with the player's own values. */
  function fillTranscriptText(request) {
    if (!request?.player || typeof request.text !== "string" || !ownsLine(request)) return;
    let text = request.text;
    if (text.includes("[He/She]")) {
      const male = request.player.getAppearance?.()?.isMale?.() !== false;
      text = text.replace(/\[He\/She\]/g, male ? "He" : "She");
    }
    if (text.includes("[player name]")) text = text.replace(/\[player name\]/gi, String(request.player.getDisplayName()));
    if (text.includes("[citizen name]")) {
      text = text.replace(/\[citizen name\]/gi, request.definition?.getName?.() || "Citizen");
    }
    if (text.includes("[location of player-owned house]")) {
      text = text.replace(/\[location of player-owned house\]/gi, playerHouseLocation(request.player));
    }
    request.text = text;
  }

  /** The transcript's stand-in labels for whichever townsperson is talked to. */
  const CLICKED_SPEAKERS = new Set(["Citizen", "Child Citizen"]);

  /**
   * Live shows the clicked NPC's own name and head on the citizens' shared lines (Razvan, t1166:
   * if_setnpchead 4468 and the name "Razvan"; Vasile t9227 and Elisabeta t10290 on "How do you mean,
   * 'out of the way'?"). The transcript labels those lines "Citizen", which drew that label and the
   * head of the cache's first "Citizen" NPC (issue 6415).
   */
  function speakAsClicked(request) {
    if (!request?.player || !ownsLine(request) || !CLICKED_SPEAKERS.has(request.step?.speaker)) return;
    const id = request.npc?.getId?.() ?? request.definition?.getId?.();
    const name = request.definition?.getName?.();
    if (!Number.isInteger(id) || !name || name === "null") return;
    request.speakerId = id;
    request.speakerName = name;
  }

  /** The transcript's group for Florin's "What do you do here?" line. */
  const FLORIN_GROUP = new Set([
    NpcIdentifiers.FLORIN, NpcIdentifiers.LUSCION, NpcIdentifiers.SERGIU, NpcIdentifiers.SORIN, NpcIdentifiers.ILEANA,
    NpcIdentifiers.RADU, NpcIdentifiers.VALERIA, NpcIdentifiers.GRIGORE, NpcIdentifiers.EMILIA,
  ]);
  /** Live: Simona and Calin give this line (t611, t629); the transcript groups Nicoleta and Mihail with them. */
  const SIMONA_GROUP = new Set([NpcIdentifiers.SIMONA, NpcIdentifiers.CALIN, NpcIdentifiers.NICOLETA, NpcIdentifiers.MIHAIL]);
  const RAZVAN_GROUP = new Set([NpcIdentifiers.VASILE, NpcIdentifiers.RAZVAN, NpcIdentifiers.LUMINATA]);

  function answerCitizenCondition({ npcId, stepId, pages }) {
    if (Array.isArray(pages) && !pages.some((entry) => entry?.page === PAGE)) return null;
    switch (stepId) {
      case "K_irY5": case "DVPoL8": return npcId === NpcIdentifiers.AUREL;
      case "-zGBqj": case "Wirdep": return npcId !== NpcIdentifiers.AUREL;
      case "Cd-uBv": return FLORIN_GROUP.has(npcId);
      case "YkY6P5": return RAZVAN_GROUP.has(npcId);
      case "QgfxfQ": return SIMONA_GROUP.has(npcId);
      case "LI091z": return npcId === NpcIdentifiers.ELISABETA;
      case "MOCofG": return npcId === NpcIdentifiers.TEODOR;
      case "W7PXmc": return npcId === NpcIdentifiers.AUREL;
      case "DFVOiZ": return npcId === NpcIdentifiers.CORNELIUS;
      case "pSicFq": return npcId === NpcIdentifiers.GABRIELA;
      case "_MNE1A": return false; // pet follower: not modelled, never blocks
      default: return null;
    }
  }

  // ---------------------------------------------------------------------------
  // Session
  // ---------------------------------------------------------------------------

  function handleLogin({ player }) {
    state.migrate(player);
    state.replay(player);
    refreshQuestList(player);
  }

  // ---------------------------------------------------------------------------
  // Registration
  // ---------------------------------------------------------------------------

  state.register();
  quest = registerQuest(api, {
    key: "in_aid_of_the_myreque",
    name: "In Aid of the Myreque",
    varbitId: VARBIT.QUEST,
    startedValue: STAGE.STARTED,
    completionValue: STAGE.COMPLETE,
    completionJingleId: COMPLETION_JINGLE,
    questPoints: 2,
    xpRewards: REWARD_SKILLS.map((reward) => ({ skillId: reward.skill.getIndex(), amount: REWARD_XP, label: reward.label })),
    // Live's scroll (capture, interface 153 lines 9-13) and its rod model.
    rewardText: [
      "2 Quest Points",
      "Access to Burgh de Rott",
      "Access to Temple Trekking",
      "2,000 XP each in Attack,",
      "Defence, Strength & Crafting",
    ],
    scrollItemId: ROD_OF_IVANDIS_ITEM_ID,
    buildJournal,
    onReward: grantReward,
  });

  api.onCustomEvent("npc-dialogue:line", fillTranscriptText);
  api.onCustomEvent("npc-dialogue:line", speakAsClicked);
  api.onNpcDialogueCondition(answerCitizenCondition);
  api.onPlayerLogin(handleLogin);

  require("../inaid/Burgh.InAidOfTheMyreque")(context);
  require("../inaid/Store.InAidOfTheMyreque")(context);
  require("../inaid/Tithe.InAidOfTheMyreque")(context);
  require("../inaid/Escort.InAidOfTheMyreque")(context);
  require("../inaid/Rod.InAidOfTheMyreque")(context);
};
