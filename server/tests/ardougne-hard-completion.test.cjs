// Run after `yarn build`: node --test tests/ardougne-hard-completion.test.cjs
const assert = require("node:assert/strict");
const { test } = require("node:test");

const Progress = require("../plugins/achievements/diaries/Progress.AchievementDiaries");
const Rewards = require("../plugins/achievements/diaries/Rewards.AchievementDiaries");
const Data = require("../plugins/achievements/diaries/Data.AchievementDiaries");
const QuestRuntime = require("../plugins/quests/QuestRuntime");
const { Task } = require("../dist/game/task/Task");

const ARDOUGNE = Data.BY_KEY.get("ardougne");
const TWO_PINTS = { getName: () => "Two-pints", getId: () => 5519 };
const SKILLS = ["Attack", "Smithing"].map((name) => ({ getName: () => name }));
const pendingTasks = [];
const dialogues = [];

class StatementDialogue {
  constructor(_type, text) { this.text = text; }
}

class DialogueChainBuilder {
  constructor() { this.steps = []; }
  add(step) { this.steps.push(step); return this; }
}

const api = {
  core: {
    Task,
    Skill: { values: () => SKILLS },
    Bank: { BANK_SEARCH_TAB_INDEX: -1 },
    DialogueChainBuilder,
    StatementDialogue,
    EndDialogue: class EndDialogue {},
  },
  persistAttribute() {},
  onPlayerLogin() {},
  onNpcsInteraction() {},
  onCustomEvent() {},
  emitCustomEvent() {},
  getTaskManager: () => ({ submit(task) { task.setRunning(true); pendingTasks.push(task); } }),
};

Progress(api);
Rewards(api);
QuestRuntime.startDialogue = (_api, _player, _context, steps) => dialogues.push(steps);

function createPlayer({ freeSlots = 28, levels = {} } = {}) {
  const attributes = new Map();
  const inventory = [];
  const log = [];
  const player = {
    log,
    inventory,
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    getPacketSender: () => ({ sendVarbit: (id, value) => log.push(`varbit ${id}=${value}`) }),
    sendMessage: (message) => log.push(message),
    isRegistered: () => true,
    getDialogueManager: () => ({
      startDialogues(chain) {
        dialogues.push(chain.steps ?? chain);
        log.push(...(chain.steps ?? chain).filter((step) => step.text).map((step) => step.text));
      },
    }),
    getInventory: () => ({
      getFreeSlots: () => freeSlots,
      adds: (id) => inventory.push(id),
      contains: (id) => inventory.includes(id),
      get: (slot) => inventory[slot],
      deleteAtSlot: (slot) => inventory.splice(slot, 1),
    }),
    getEquipment: () => ({ contains: () => false }),
    getBanks: () => [],
    getSkillManager: () => ({
      getCurrentLevel: (skill) => levels[skill.getName()] ?? 99,
    }),
  };
  return { player, attributes, setFreeSlots: (value) => { freeSlots = value; } };
}

function advanceTasks(ticks) {
  for (let tick = 0; tick < ticks; tick++) {
    for (const task of pendingTasks.filter((entry) => entry.isRunning())) task.tick();
  }
}

function completeTier(player, tier) {
  for (const task of ARDOUGNE.tiers[tier].tasks) Progress.completeTask(player, ARDOUGNE, task.key);
}

function claimAtTwoPints(player) {
  const started = dialogues.length;
  const handled = Rewards.talkTo({ player, definition: TWO_PINTS });
  const dialogue = dialogues[started];
  return { handled, dialogue, accept: () => dialogue?.find((step) => step.exec)?.exec() };
}

test("synthetic completion of all canonical Ardougne hard tasks updates varbits after three ticks", () => {
  const { player, setFreeSlots } = createPlayer();
  pendingTasks.length = 0;
  const hardTasks = ARDOUGNE.tiers.hard.tasks;

  // This drives Progress directly. Individual task gameplay paths are covered by their own tests.
  assert.equal(hardTasks.length, 12);
  for (const task of hardTasks) Progress.completeTask(player, ARDOUGNE, task.key);

  assert.equal(Progress.tierCount(player, ARDOUGNE, "hard"), 12);
  assert.ok(player.log.includes("varbit 6293=12"));
  assert.ok(!player.log.includes("varbit 4460=1"));

  player.log.length = 0;
  advanceTasks(2);
  assert.ok(!player.log.includes("varbit 4460=1"));
  advanceTasks(1);
  assert.ok(player.log.includes("varbit 4460=1"));
  assert.ok(player.log.some((line) => line.includes("Congratulations! You have completed all of the hard tasks in the Ardougne area.")));
});

test("hard task progress survives save and login restore, and Two-pints gates and records its reward once", () => {
  const { player: beforeSave, attributes: savedAttributes } = createPlayer();
  completeTier(beforeSave, "hard");

  const saved = Object.fromEntries([Progress.TASKS_ATTRIBUTE, Progress.REWARDS_ATTRIBUTE]
    .map((key) => [key, JSON.parse(JSON.stringify(savedAttributes.get(key) ?? {}))]));
  const { player, setFreeSlots } = createPlayer();
  for (const [key, value] of Object.entries(saved)) player.setAttribute(key, value);
  Progress.restore({ player });

  assert.equal(Progress.tierCount(player, ARDOUGNE, "hard"), 12);
  assert.ok(player.log.includes("varbit 6293=12"));
  assert.equal(Progress.claimedTiers(player, ARDOUGNE).has("hard"), false);

  dialogues.length = 0;
  const premature = claimAtTwoPints(player);
  assert.equal(premature.handled, false, "hard tasks alone do not make the hard reward claimable");

  completeTier(player, "easy");
  completeTier(player, "medium");
  const easy = claimAtTwoPints(player);
  assert.equal(easy.handled, true);
  easy.accept();
  const medium = claimAtTwoPints(player);
  assert.equal(medium.handled, true);
  medium.accept();

  const requiredSlots = ARDOUGNE.tiers.hard.rewardItems.length;
  setFreeSlots(requiredSlots - 1);
  const cramped = claimAtTwoPints(player);
  assert.equal(cramped.handled, true);
  assert.ok(player.log.includes(`You need ${requiredSlots} free inventory spaces to claim your reward.`));
  assert.equal(Progress.claimedTiers(player, ARDOUGNE).has("hard"), false);

  setFreeSlots(requiredSlots);
  const hard = claimAtTwoPints(player);
  assert.equal(hard.handled, true);
  assert.equal(Progress.claimedTiers(player, ARDOUGNE).has("hard"), false, "the dialogue must reach its reward step");
  hard.accept();
  assert.equal(Progress.claimedTiers(player, ARDOUGNE).has("hard"), true);
  assert.ok(player.log.includes("varbit 4460=1"));
  const items = ARDOUGNE.tiers.hard.rewardItems;
  assert.deepEqual(player.inventory.slice(-2), items);

  const inventoryAfterClaim = [...player.inventory];
  assert.equal(claimAtTwoPints(player).handled, false, "a claimed hard reward cannot be claimed again");
  assert.deepEqual(player.inventory, inventoryAfterClaim);

  const rewardSave = Object.fromEntries([Progress.TASKS_ATTRIBUTE, Progress.REWARDS_ATTRIBUTE]
    .map((key) => [key, JSON.parse(JSON.stringify(player.getAttribute(key) ?? {}))]));
  const { player: relogged } = createPlayer();
  for (const [key, value] of Object.entries(rewardSave)) relogged.setAttribute(key, value);
  Progress.restore({ player: relogged });
  assert.equal(Progress.claimedTiers(relogged, ARDOUGNE).has("hard"), true);
  assert.ok(relogged.log.includes(`varbit ${ARDOUGNE.tiers.hard.rewardVarbit}=1`));
  assert.equal(claimAtTwoPints(relogged).handled, false);
  assert.deepEqual(relogged.inventory, []);
});
