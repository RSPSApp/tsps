const assert = require("node:assert/strict");
const { before, test } = require("node:test");
const path = require("node:path");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { PluginManager } = require("../dist/plugins/PluginManager");
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { NpcDefinitionLoader } = require("../dist/game/definition/loader/impl/NpcDefinitionLoader");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { MultiChatboxPrompt } = require("../dist/game/model/menu/MultiChatboxPrompt");
const { Task } = require("../dist/game/task/Task");
const Diaries = require("../plugins/achievements/AchievementDiaries.plugin");
const Data = require("../plugins/achievements/diaries/Data.AchievementDiaries");
const Progress = require("../plugins/achievements/diaries/Progress.AchievementDiaries");

let api;
let tasks;
let completionEvents;
let playerIndex = 8000;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  new NpcDefinitionLoader().load();
  tasks = [];
  completionEvents = [];
  api = PluginManager.createApi("TwoPintsRuntimeTest");
  api.getTaskManager = () => ({ submit(task) { task.setRunning(true); tasks.push(task); } });
  api.core = { ...PluginManager.getCoreApi(), Task };
  api.onCustomEvent("diary:tier-complete", (event) => completionEvents.push(event));
  Diaries.register(api);
});

function player(levels = {}) {
  const p = new Player(null, new api.core.Location(2574, 3325, 0));
  p.setIndex(playerIndex++);
  p.setUsername("two-pints-test");
  p.setRegistered(true);
  p.setNeedsPlacement(false);
  p.getSession = () => ({ sendClientPacket: () => true, write() {} });
  const skillManager = p.getSkillManager();
  for (const skill of api.core.Skill.values()) {
    if (levels[skill.getName()] !== undefined) skillManager.setCurrentLevels(skill, levels[skill.getName()]);
  }
  return p;
}

function complete(p, diary, tier) {
  for (const task of diary.tiers[tier].tasks) Progress.completeTask(p, diary, task.key);
}

function advance(p, count = 1) {
  for (let i = 0; i < count; i++) p.getDialogueManager().advance();
}

function talk(p) {
  const npc = api.core.NPC.create(5519, new api.core.Location(2574, 3325, 0));
  return PluginManager.emitNpcInteraction({
    player: p, npc, npcId: 5519, action: "Talk-to", clickType: 1, handled: false,
  });
}

function run(task, ticks = 3) {
  for (let i = 0; i < ticks && task.isRunning(); i++) task.tick();
}

test("a pending production chatbox prompt survives delayed diary completion", () => {
  const p = player();
  const pending = api.sendMultiChatboxPrompt(p, "Active prompt", "Continue", () => {});
  assert.equal(pending, true);
  complete(p, Data.BY_KEY.get("ardougne"), "easy");
  run(tasks.at(-1));
  assert.deepEqual(MultiChatboxPrompt.getPending(p)?.options, ["Continue", "Cancel"]);
});

test("reset and recompletion invalidate the earlier completion timer", () => {
  const p = player();
  const diary = Data.BY_KEY.get("ardougne");
  complete(p, diary, "easy");
  const earlier = tasks.at(-1);
  const eventCount = completionEvents.length;
  Progress.resetTiers(p, diary, ["easy"]);
  complete(p, diary, "easy");
  const current = tasks.at(-1);
  run(earlier);
  assert.equal(completionEvents.length, eventCount);
  assert.equal(p.getPacketSender().getVarbit(diary.tiers.easy.completeVarbit), 0);
  assert.equal(MultiChatboxPrompt.getPending(p), null);
  run(current);
  assert.equal(completionEvents.length, eventCount + 1);
  assert.equal(p.getPacketSender().getVarbit(diary.tiers.easy.completeVarbit), 1);
  assert.equal(p.getDialogueManager().getCurrent()?.getText?.().startsWith("Congratulations!"), true);
});

test("production claim callback stops after inventory space disappears", () => {
  const p = player();
  const diary = Data.BY_KEY.get("ardougne");
  complete(p, diary, "easy");
  assert.equal(talk(p), true);
  for (let i = 0; i < 27; i++) p.getInventory().adds(4151, 1);
  advance(p, 3);
  assert.equal(p.getInventory().getFreeSlots(), 1);
  assert.deepEqual(Progress.claimedTiers(p, diary).has("easy"), false);
  assert.equal(p.getDialogueManager().getCurrent(), undefined);
  assert.equal(p.getInventory().contains(13121), false);
  assert.equal(p.getInventory().contains(13145), false);
});

test("reset and recompletion invalidate a reward callback from the earlier completion", () => {
  const p = player();
  const diary = Data.BY_KEY.get("ardougne");
  complete(p, diary, "easy");
  assert.equal(talk(p), true);
  const oldClaimGeneration = Progress.tierGeneration(p, diary, "easy");
  Progress.resetTiers(p, diary, ["easy"]);
  complete(p, diary, "easy");
  assert.notEqual(Progress.tierGeneration(p, diary, "easy"), oldClaimGeneration);
  advance(p, 3);
  assert.equal(p.getInventory().contains(13121), false);
  assert.equal(p.getInventory().contains(13145), false);
  assert.equal(Progress.claimedTiers(p, diary).has("easy"), false);
  assert.equal(p.getDialogueManager().getCurrent(), undefined);
});

test("elite refusal returns to the generated nested menu and reclaims the highest claimed cloak", () => {
  const p = player({ Smithing: 90 });
  const diary = Data.BY_KEY.get("ardougne");
  for (const tier of ["easy", "medium", "hard"]) {
    complete(p, diary, tier);
    Progress.claimTier(p, diary, tier);
  }
  complete(p, diary, "elite");
  assert.equal(talk(p), true);
  for (let i = 0; i < 12 && !MultiChatboxPrompt.getPending(p); i++) advance(p);
  const pending = MultiChatboxPrompt.getPending(p);
  assert.ok(pending?.options.includes("Can I have another cloak?"), `pending=${JSON.stringify(pending)} current=${p.getDialogueManager().getCurrent()?.getText?.()}`);
  assert.ok(pending?.options.includes("I have a question about my Achievement Diary"));
  assert.equal(MultiChatboxPrompt.handleInterfaceActionClick({
    player: p,
    buttonId: MultiChatboxPrompt.OPTIONS_WIDGET_ID,
    groupId: MultiChatboxPrompt.OPTIONS_WIDGET_ID >>> 16,
    action: pending.options.indexOf("Who are you?") + 1,
  }), true);
  advance(p, 2);
  const nested = MultiChatboxPrompt.getPending(p);
  assert.deepEqual(nested?.options, ["Why do they call you Two pints?", "What is the Achievement Diary?"]);
  MultiChatboxPrompt.handleInterfaceActionClick({
    player: p,
    buttonId: MultiChatboxPrompt.OPTIONS_WIDGET_ID,
    groupId: MultiChatboxPrompt.OPTIONS_WIDGET_ID >>> 16,
    action: nested.options.indexOf("Why do they call you Two pints?") + 1,
  });
  for (let i = 0; i < 5 && !MultiChatboxPrompt.getPending(p); i++) advance(p);
  assert.equal(MultiChatboxPrompt.getPending(p), null);

  talk(p);
  for (let i = 0; i < 12 && !MultiChatboxPrompt.getPending(p); i++) advance(p);
  const options = MultiChatboxPrompt.getPending(p);
  MultiChatboxPrompt.handleInterfaceActionClick({
    player: p,
    buttonId: MultiChatboxPrompt.OPTIONS_WIDGET_ID,
    groupId: MultiChatboxPrompt.OPTIONS_WIDGET_ID >>> 16,
    action: options.options.indexOf("Can I have another cloak?") + 1,
  });
  advance(p);
  assert.equal(p.getInventory().contains(diary.tiers.hard.rewardItems[0]), true);
  assert.equal(p.getInventory().contains(diary.tiers.elite.rewardItems[1]), false);
});
