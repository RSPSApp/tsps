/**
 * Icthlarin's Little Helper (members).
 *
 * Aligned with the user's rsprox capture of a whole run and what the quest unlocks after it (local 1002310,
 * revision 243); the facts each step relies on, with capture ticks, are in
 * docs/quests/icthlarins-little-helper/README.md. The words come from the "Icthlarin's Little Helper"
 * transcript page (npc-dialogues.json); the units below pick its variants and do what live did around them.
 *
 * The stage is varbit 418 `ics_little_var` with live's values (26 complete, cache DB row 75 column 19); the
 * rest of the quest's state is live's own `ics_*` varbits, which the cache's multilocs and multinpcs read
 * per player. See ../icthlarin/State.IcthlarinsLittleHelper.js.
 *
 * Units (../icthlarin/):
 * - Start: the Wanderer, the hypnosis and the arrival in Sophanem, the rock into the city (0-3).
 * - Talk: every conversation's variant, conditions, hand-overs, and live's heads and animations per line.
 * - Pyramid: Klenter's Pyramid as a private copy per visit: the door, the ladder, the pit and its jump, the
 *   jar room, the sarcophagi, the mummies and the swarm, and the first three flashbacks (3-19).
 * - Puzzle: the western door's tile puzzle (interface 147).
 * - Ceremony: the embalmer's supplies, the ceremony scene, the possessed priest, Icthlarin's flashback and the
 *   end (15-26).
 * - Journal: the quest journal as live wrote it.
 *
 * Rewards (Wiki): 2 Quest points, 4,500 Thieving, 4,000 Agility and 4,000 Woodcutting experience, the amulet
 * of catspeak, access to Sophanem, and the Pollnivneach carpet's rides to Sophanem and Menaphos.
 */
module.exports = function registerIcthlarinsLittleHelperQuest(api) {
  const { Skill, NpcIdentifiers } = api.core;
  const { registerQuest, refreshQuestList } = require("../QuestRuntime");
  const { STAGE, VARBIT, JARS, FIRST_TILE_VARBIT, createState } = require("../icthlarin/State.IcthlarinsLittleHelper");
  const { createCommon } = require("../icthlarin/Common.IcthlarinsLittleHelper");
  const { createStart } = require("../icthlarin/Start.IcthlarinsLittleHelper");
  const { createPyramid } = require("../icthlarin/Pyramid.IcthlarinsLittleHelper");
  const { createPuzzle } = require("../icthlarin/Puzzle.IcthlarinsLittleHelper");
  const { createCeremony } = require("../icthlarin/Ceremony.IcthlarinsLittleHelper");
  const { createTalk } = require("../icthlarin/Talk.IcthlarinsLittleHelper");
  const { createJournal } = require("../icthlarin/Journal.IcthlarinsLittleHelper");

  let quest;
  const getQuest = () => quest;
  const state = createState(api, getQuest);
  const common = createCommon(api, state);
  const ctx = { STAGE, VARBIT, JARS, FIRST_TILE_VARBIT, getQuest };
  const start = createStart(api, state, common, ctx);
  const pyramid = createPyramid(api, state, common, ctx);
  const puzzle = createPuzzle(api, state, common, ctx);
  const ceremony = createCeremony(api, state, common, { ...ctx, pyramid });
  const talk = createTalk(api, state, common, { ...ctx, start, pyramid, ceremony });
  const journal = createJournal(state, common, ctx);
  pyramid.setPuzzle(puzzle);
  pyramid.setCeremonySetup(ceremony.ceremonySetup);

  /** Login: an old save mapped once, every quest varbit sent again. */
  function login({ player }) {
    state.migrate(player);
    state.resend(player);
    refreshQuestList(player);
  }

  function reset(player) {
    if (pyramid.inPyramid(player)) pyramid.toTown(player);
    state.clear(player);
  }

  function action(event) {
    ceremony.handleAction(event);
    if (!event.handled) talk.handleAction(event);
  }

  function line(request) {
    talk.handleLine(request);
    ceremony.sceneLine(request);
  }

  function npcDied(event) {
    pyramid.apparitionDied(event);
    ceremony.priestDied(event);
  }

  function objectClicked(event) {
    const { objectId } = event;
    switch (objectId) {
      case pyramid.LOC.PYRAMID_DOOR: return pyramid.pyramidDoor(event);
      case pyramid.LOC.LADDER: return pyramid.ladder(event);
      case pyramid.LOC.PIT_SOUTH: case pyramid.LOC.PIT_NORTH: return pyramid.pit(event);
      case pyramid.LOC.WEST_DOOR: return pyramid.westDoor(event);
      case pyramid.LOC.EAST_DOOR: return pyramid.eastDoor(event);
      case pyramid.LOC.SARCOPHAGUS: return pyramid.sarcophagus(event);
      case start.ENTRANCE_ROCK: return start.enterRock(event);
      case start.TENT_FLAP: return start.tentFlap(event);
      case ceremony.WATER: return ceremony.collectWater(event);
      case ceremony.SUNTRAP: return ceremony.useSuntrap(event);
      default: return pyramid.jarClicked(event);
    }
  }

  function objectClickedEvent(event) {
    if (objectClicked(event) === true) event.handled = true;
  }

  function itemOnObject(event) {
    if (event.objectId === pyramid.LOC.SARCOPHAGUS && pyramid.symbolOnSarcophagus(event)) event.handled = true;
    else if (event.objectId === pyramid.LOC.TABLE && pyramid.symbolOnTable(event)) event.handled = true;
    else if (event.objectId === ceremony.SUNTRAP && ceremony.saltwaterOnSuntrap(event)) event.handled = true;
  }

  /** The Doors plugin claims 44059/44060 as ordinary doors; the quest owns them inside its copy. */
  function doorToggle(request) {
    if (request.handled || !pyramid.inPyramid(request.player)) return;
    if (request.objectId !== pyramid.LOC.WEST_DOOR && request.objectId !== pyramid.LOC.EAST_DOOR) return;
    const event = { ...request, object: request.object, handled: false };
    if (objectClicked(event) === true) request.handled = true;
  }

  function rewards(player) {
    const skills = player.getSkillManager();
    skills.addExperiences(Skill.THIEVING, 4500);
    skills.addExperiences(Skill.AGILITY, 4000);
    skills.addExperiences(Skill.WOODCUTTING, 4000);
  }

  quest = registerQuest(api, {
    key: "ictlharins_little_helper",
    name: "Icthlarin's Little Helper",
    varpId: 445,
    varbitId: VARBIT.QUEST,
    startedValue: STAGE.STARTED,
    completionValue: STAGE.COMPLETE,
    questPoints: 2,
    xpRewards: [
      { skillId: Skill.THIEVING.getIndex(), amount: 4500, label: "Thieving" },
      { skillId: Skill.AGILITY.getIndex(), amount: 4000, label: "Agility" },
      { skillId: Skill.WOODCUTTING.getIndex(), amount: 4000, label: "Woodcutting" },
    ],
    rewardItemId: common.ITEM.CATSPEAK,
    rewardItemLabel: "Amulet of catspeak",
    otherRewards: ["Access to the city of Sophanem"],
    journalAsSent: true,
    buildJournal: (player, q) => journal.build(player, q) ?? [],
    onReward: rewards,
    onReset: reset,
  });

  api.onNpcDialogueVariant(talk.selectVariant);
  api.onNpcDialogueCondition(talk.answerCondition);
  api.onNpcInteraction("Sphinx", { "Talk-to": talk.sphinxTalkTo });
  api.onCustomEvent("npc-dialogue:hook", talk.handleHook);
  api.onCustomEvent("npc-dialogue:action", action);
  api.onCustomEvent("npc-dialogue:choice", talk.handleChoice);
  api.onCustomEvent("npc-dialogue:line", line);
  api.onCustomEvent("door:toggle", doorToggle);
  api.onCustomEvent("icthlarins-little-helper:east-door", ceremony.eastDoor);
  api.onObjectInteraction(objectClickedEvent);
  api.onItemOnObject(itemOnObject);
  api.onItemOnObject("Knife", ceremony.EVERGREEN, ceremony.knifeOnTree);
  api.onItemAction("Bucket of sap", { Empty: ceremony.emptyBucket });
  api.onItemAction("Bucket of saltwater", { Empty: ceremony.emptyBucket });
  api.onItemDropPolicy(pyramid.dropJar);
  api.onInterfaceActionButton(puzzle.tileButtons, puzzle.tileClicked);
  api.onInterfaceActionButton(puzzle.resetButton, puzzle.resetClicked);
  api.onNpcDeath(npcDied);
  api.onPlayerDeath(pyramid.died);
  api.onPlayerLogin(login);
};
