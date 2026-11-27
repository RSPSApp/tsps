/**
 * Eagles' Peak (members), as live plays it: the RSProx capture EaglesPeak+AllUnlocks (rev 243, ticks 86-2438
 * for the quest, then every eagle route) for what happens and when, Transcript:Eagles' Peak for the words.
 * Facts and ticks are in docs/quests/eagles-peak/README.md.
 *
 * The saved stage is the cache's own eaglepeak_quest (2780) value, and the side state is the cache's own
 * varbits (eaglepeak/State), so the camp, the cave entrance, Nickolaus, the eagle door, the gold room's
 * levers and the silver room's footprints all show as the client draws them from those values. The units:
 * - Npcs: Charlie, Asyff and both Nickolauses (variants, conditions, the start, the hand-ins);
 * - Camp: the camp-site, the bird book, the cliff and the way into the mountain;
 * - Nest: the eyrie's first meeting, the feathers, the eagle, the stone door, the tunnels, the journal;
 * - Bronze, Silver, Gold: the three feather rooms, each a copy of the map per visit as live's rebuild_region;
 * - Ferret: the lesson at the camp-site (a copy of the camp, as live);
 * - Journal: the quest journal's captured lines.
 * The eagle transport routes are plugins/world/EagleTransport.plugin.js.
 */
module.exports = function registerEaglesPeakQuest(api) {
  const { registerQuest, refreshQuestList, startTranscript, questStartMessage } = require("../QuestRuntime");
  const { createQuestScenes } = require("../QuestScenes");
  const state = require("../eaglespeak/State.EaglesPeak")(api);
  const TEXT = require("../eaglespeak/Text.EaglesPeak");
  const { buildJournal } = require("../eaglespeak/Journal.EaglesPeak");
  const { DialogueChainBuilder, StatementDialogue, ActionDialogue, Skill, Animation, Graphic, TaskManager, CountdownTask } = api.core;

  const PAGE = "Eagles' Peak";
  const SCENE_EXIT_ATTRIBUTE = "eagles-peak:scene-exit";
  /** Units' scene end callbacks, by scene name prefix. */
  const sceneEnds = new Map();

  function sceneEnded(player, scene, logout) {
    for (const [prefix, onEnd] of sceneEnds) if (scene.name.startsWith(prefix)) onEnd(player, scene, logout);
  }

  const Scenes = createQuestScenes(api, { onEnd: sceneEnded, recoveryAttribute: SCENE_EXIT_ATTRIBUTE });

  /** A message box (229), then `after` on its continue. */
  function mesbox(player, text, after) {
    const chain = new DialogueChainBuilder().add(new StatementDialogue(0, text));
    if (typeof after === "function") chain.add(new ActionDialogue(1, { execute: () => after(player) }));
    player.getDialogueManager().startDialogues(chain);
  }

  function animate(mobile, id, delay = 0) {
    mobile?.performAnimation?.(new Animation(id, delay));
  }

  function spotanim(mobile, id, height = 0, delay = 0) {
    mobile?.performGraphic?.(new Graphic(id, height, delay));
  }

  function sound(player, id, delay = 0, loops = 1) {
    player.getPacketSender().sendSoundEffect(id, loops, delay, 255);
  }

  /** Runs `callback` after `ticks` for this player; never once they have logged out. */
  function later(player, ticks, callback) {
    TaskManager.submit(new CountdownTask(player, ticks, () => {
      if (player.isRegistered?.() === false) return;
      callback();
    }));
  }

  function play(player, variant, npcId = state.NPC.NICKOLAUS_NORMAL, npc = null, page = PAGE) {
    return startTranscript(api, player, npcId, page, variant, undefined, npc);
  }

  const ep = { api, core: api.core, state, TEXT, PAGE, Scenes, sceneEnds, mesbox, animate, spotanim, sound, later, play, questStartMessage,
    get quest() { return state.quest; } };

  const Npcs = require("../eaglespeak/Npcs.EaglesPeak")(api, ep);
  ep.npcs = Npcs;
  require("../eaglespeak/Camp.EaglesPeak")(api, ep);
  ep.nest = require("../eaglespeak/Nest.EaglesPeak")(api, ep);
  require("../eaglespeak/Bronze.EaglesPeak")(api, ep);
  require("../eaglespeak/Silver.EaglesPeak")(api, ep);
  require("../eaglespeak/Gold.EaglesPeak")(api, ep);
  require("../eaglespeak/Ferret.EaglesPeak")(api, ep);

  function grantRewards(player) {
    player.getSkillManager().addExperiences(Skill.HUNTER, 2500);
  }

  const quest = registerQuest(api, {
    key: "eagles_peak",
    name: PAGE,
    varpId: state.VARP.MAIN,
    varbitId: state.VARBIT.QUEST,
    startedValue: state.STAGE.STARTED,
    completionValue: state.STAGE.COMPLETE,
    questPoints: 2,
    xpRewards: [{ skillId: Skill.HUNTER.getIndex(), amount: 2500, label: "Hunter" }],
    // The scroll's lines and model (t2438): the ferret at 76,128.
    otherRewards: ["Eagle Transport Access", "Ability to use Box Traps"],
    scrollItemId: state.ITEM.FERRET,
    scrollItemPosition: [76, 128],
    buildJournal: (player) => buildJournal(player, state),
    journalAsSent: true,
    onReward: grantRewards,
  });
  state.bindQuest(quest);
  state.persist();

  function handleLogin({ player }) {
    state.convertOldSave(player);
    state.sendAll(player);
    refreshQuestList(player);
  }

  /** Other plugins ask through events, never by stage number: Hunter's box traps, Biohazard's Asyff. */
  function answerBoxTraps(request) {
    if (request?.player) request.unlocked = state.stage(request.player) >= state.STAGE.FERRET_CAUGHT;
  }

  function answerAsyffCostume(request) {
    if (request?.player) request.owns = Npcs.asyffOwned(request.player);
  }

  api.onPlayerLogin(handleLogin);
  api.onCustomEvent("eagles-peak:box-traps", answerBoxTraps);
  api.onCustomEvent("eagles-peak:asyff-costume", answerAsyffCostume);
};
