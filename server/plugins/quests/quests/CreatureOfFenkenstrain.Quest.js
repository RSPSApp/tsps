/**
 * Creature of Fenkenstrain (members).
 *
 * Aligned with a whole live run (the user's rsprox capture, revision 243); the facts each step relies
 * on, with capture ticks, are in docs/quests/creature-of-fenkenstrain/README.md. Words come from the
 * "Creature of Fenkenstrain", "Gardener Ghost" and "Lord Rologarth" transcript pages
 * (npc-dialogues.json); the units below pick their variants and do what live did around them.
 *
 * Live's state is varp 399 (Quest Helper's and the cache's: Fenkenstrain, the creature, Rologarth
 * and the lab table show by it), varbit 13715 (the quest list) and varp 400 (the parts, needle and
 * thread handed in, the doors unlocked, the gardener showing the way). See
 * ../fenkenstrain/State.CreatureOfFenkenstrain.js.
 *
 * Units (../fenkenstrain/):
 * - Castle: Fenkenstrain, the creature, Rologarth, the pickpocket ending and ring recovery, the
 *   bookcases and amulets, the clock, the conductor, the tower door, the signpost.
 * - Gardener: the gardener showing the way to his grave, the shed, the cupboard, the canes and brush,
 *   the chimneys.
 * - Graves: digging, the inscriptions, the memorials, the cave's key and doors, the chest, the brain.
 */
module.exports = function registerCreatureOfFenkenstrainQuest(api) {
  const { Skill, ItemIdentifiers } = api.core;
  const { registerQuest, refreshQuestList } = require("../QuestRuntime");
  const createState = require("../fenkenstrain/State.CreatureOfFenkenstrain");
  const createCommon = require("../fenkenstrain/Common.CreatureOfFenkenstrain");

  const KEY = "creature_of_fenkenstrain";
  const VARBIT_QUEST_LIST = 13715; // creatureoffenkenstrain, varp 3403 bits 2-5

  let quest;
  const state = createState(api, () => quest);
  const { STAGE, FIELD } = state;
  const common = createCommon(api, state);

  // The journal as live shows it at stages 1-3 (capture ticks 432, 1406, 1441); later stages are ours.
  const RED = "<col=800000>";
  const BLUE = "<col=000080>";
  const STARTED = ["I spoke to Fenkenstrain, who wanted me to find him some body", "parts so that he could build a creature."];
  const GAVE_PARTS = [
    "I gave a torso, some arms and legs, and a head to",
    "Fenkenstrain, who then wanted a needle and 5 lots of thread,",
    "so that he could sew the bodyparts together and create his",
    `${RED}${RED}creature${BLUE}.`,
  ];
  const GAVE_SEWING = "I brought Fenkenstrain a needle and 5 quantities of thread.";
  const struck = (lines) => lines.map((line) => `<str>${line}`);

  function buildJournal(player, handle) {
    const stage = handle.getStage(player);
    if (stage <= STAGE.NOT_STARTED) return [];
    if (stage === STAGE.PARTS) {
      const part = (field, line) => (state.get(player, field) ? `<str>${line}` : line);
      return [
        ...struck(STARTED),
        "",
        `${BLUE}I need to find these body parts for ${RED}Fenkenstrain${BLUE}:`,
        part(FIELD.ARMS, `${BLUE}a pair of ${RED}arms`),
        part(FIELD.LEGS, `${BLUE}a pair of ${RED}legs`),
        part(FIELD.TORSO, `${BLUE}a ${RED}torso`),
        part(FIELD.HEAD, `${BLUE}a ${RED}head`),
        "",
        `${BLUE}Apparently the soil of ${RED}Morytania${BLUE} has a unique quality which`,
        `${BLUE}preserves the bodies of the dead better than elsewhere, so`,
        `${BLUE}perhaps I should look at the graves in the local area.`,
      ];
    }
    const lines = [...struck(STARTED), ...struck(GAVE_PARTS)];
    if (stage === STAGE.NEEDLE_AND_THREAD) {
      const needle = `${BLUE}I need to bring ${RED}Fenkenstrain${BLUE} a ${RED}needle.`;
      const thread = `${BLUE}I need to bring Fenkenstrain ${RED}5${BLUE} quantities of ${RED}thread.`;
      lines.push(state.get(player, FIELD.NEEDLE) ? `<str>${needle}` : needle);
      lines.push(state.get(player, FIELD.THREADS) >= 5 ? `<str>${thread}` : thread);
      return lines;
    }
    lines.push(`<str>${GAVE_SEWING}`);
    const repair = [`${RED}Fenkenstrain${BLUE} has ordered me to repair the lightning`, `${BLUE}conductor.`];
    if (stage === STAGE.CONDUCTOR) return [...lines, ...repair];
    lines.push(...struck(repair));
    // Ours from here: no capture opens the journal after the conductor.
    const destroy = [`${RED}Fenkenstrain${BLUE} wants me to destroy his creature in the ${RED}Tower${BLUE}.`];
    const ring = [`${BLUE}The creature asked me to take the ${RED}Ring of Charos${BLUE} from ${RED}Fenkenstrain${BLUE}.`];
    if (stage === STAGE.CONDUCTOR_REPAIRED) return [...lines, `${BLUE}I should speak to ${RED}Fenkenstrain${BLUE}.`];
    if (stage === STAGE.CREATURE_LOOSE) return [...lines, ...destroy];
    if (stage === STAGE.CREATURE_CONVINCED) return [...lines, ...struck(destroy), ...ring];
    return [...lines, ...struck(destroy), ...struck(ring), "", "<col=ff0000>QUEST COMPLETE!"];
  }

  function publish({ player, key }) {
    if (key !== undefined && key !== KEY) return;
    state.publish(player);
  }

  /** Quest Helper keys on varp 399 (and the parts' varbits in varp 400): give a headless guide both. */
  function projectHelperState(request) {
    request.varps[state.VARP_FENK_QUEST] = state.questVarp(state.stage(request.player));
    request.varps[state.VARP_FENK_STATE] = state.stateValue(request.player);
  }

  function login({ player }) {
    state.migrate(player);
    // The guide is per session: a save taken while he was out (autosave, shutdown) must not hide the gardener.
    if (state.get(player, FIELD.GARDENER_DIRECTIONS)) state.set(player, FIELD.GARDENER_DIRECTIONS, 0);
    state.publish(player);
    refreshQuestList(player);
  }

  quest = registerQuest(api, {
    key: KEY,
    name: "Creature of Fenkenstrain",
    varbitId: VARBIT_QUEST_LIST,
    varbitValue: (stage) => state.questListValue(stage),
    startedValue: STAGE.PARTS,
    completionValue: STAGE.COMPLETE,
    questPoints: 2,
    xpRewards: [{ skillId: Skill.THIEVING.getIndex(), amount: 1000, label: "Thieving" }],
    // The runtime only shows xpRewards on the scroll; the experience itself is paid here.
    onReward: (player) => player.getSkillManager().addExperiences(Skill.THIEVING, 1000),
    rewardItemId: ItemIdentifiers.RING_OF_CHAROS,
    rewardItemLabel: "The Ring of Charos",
    buildJournal,
  });

  const context = { api, state, common, quest: () => quest };
  require("../fenkenstrain/Castle.CreatureOfFenkenstrain")(api, context);
  const guide = require("../fenkenstrain/Gardener.CreatureOfFenkenstrain")(api, context);
  require("../fenkenstrain/Graves.CreatureOfFenkenstrain")(api, { ...context, guide });

  api.onCustomEvent("quest:stage-changed", publish);
  api.onPlayerLogin(login);
  api.onCustomEvent("quest-helper:project-state", projectHelperState);
};
