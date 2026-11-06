// Run after `yarn build`: node --test tests/barrows-run.test.cjs
// The Barrows run (plugins/minigames/Barrows.plugin.js): a looted run stays looted until the next
// crypt is dug into, as live keeps it (237/04057: looted, teleported to the surface, reset only by
// the spade's dig), so a teleport out of the chest room and back into it (the league Evil eye's
// "Barrows (chest)") finds the chest empty.
const assert = require("node:assert/strict");
const path = require("node:path");
const { test, before, beforeEach, afterEach } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { Location } = require("../dist/game/model/Location");
const Diaries = require("../plugins/achievements/AchievementDiaries.plugin");
const DiaryData = require("../plugins/achievements/diaries/Data.AchievementDiaries");
const DiaryProgress = require("../plugins/achievements/diaries/Progress.AchievementDiaries");

let core;
let Barrows;
let diaryApi;
let cleanupPlayer;
const subjects = new Set();
let originalError;
let errors;
beforeEach(() => {
  errors = [];
  originalError = console.error;
  console.error = (...args) => errors.push(args);
});
afterEach(() => {
  const cleanupErrors = [];
  try {
    for (const subject of subjects) {
      try { cleanupPlayer?.({ player: subject }); } catch (error) { cleanupErrors.push(error); }
      try {
        core.TaskManager.cancelTasks(subject);
        assert.equal(core.TaskManager.hasActiveTask(subject), false);
      } catch (error) { cleanupErrors.push(error); }
      try { subject.setRegistered(false); } catch (error) { cleanupErrors.push(error); }
    }
  } finally {
    subjects.clear();
    console.error = originalError;
    assert.deepEqual({ cleanupErrors, errors }, { cleanupErrors: [], errors: [] }, "no hook or cleanup errors");
  }
});
const CHEST_ROOM = new Location(3551, 9694, 0);
const SURFACE = new Location(3565, 3288, 0);
const AHRIM_MOUND = new Location(3565, 3289, 0);

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  core = PluginManager.getCoreApi();
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(3551, 9694);
  Barrows = require("../plugins/minigames/Barrows.plugin");
  diaryApi = PluginManager.createApi("barrows-diary-native-test");
  diaryApi.onCustomEvent("diary:is-complete", Diaries._test.onIsComplete);
  diaryApi.onCustomEvent("collection-log:obtain", (event) => event.player.collected?.push([event.itemId, event.amount]));
  diaryApi.onCustomEvent("barrows:chest-looted", (event) => { event.player.chestEvents = (event.player.chestEvents ?? 0) + 1; });
  Barrows.register(new Proxy({
    core,
    getWorld: () => core.World,
    getRegionManager: () => core.RegionManager,
    getTaskManager: () => core.TaskManager,
    onPlayerLogout: (fn) => { cleanupPlayer = fn; },
    emitCustomEvent: (name, request) => diaryApi.emitCustomEvent(name, request),
  }, { get: (target, key) => (key in target ? target[key] : () => {}) }));
});

function player() {
  const subject = new Player(null);
  subjects.add(subject);
  subject.setUsername("barrows-run");
  subject.setRegistered(true);
  const sent = { messages: [], varbits: new Map(), rewards: null };
  subject.collected = [];
  const sender = new Proxy({}, {
    get: (target, key) => (key === "sendVarbit" ? (id, value) => (sent.varbits.set(id, value), sender)
      : key === "sendMessage" ? (text) => (sent.messages.push(text), sender)
      : key === "sendInterfaceScript" ? (_id, _args, _a, _b, inventories) => (sent.rewards = inventories, sender)
      : () => sender),
  });
  subject.getPacketSender = () => sender;
  subject.sendMessage = (text) => sent.messages.push(text);
  return Object.assign(subject, { sent });
}

function arrive(subject, location) {
  subject.setLocation(location.clone());
  Barrows._test.processPlayer({ player: subject });
}

test("Barrows: a looted run stays looted through a teleport out and back to the chest; the next crypt's dig starts a new one", () => {
  const subject = player();
  arrive(subject, CHEST_ROOM);
  const run = subject.getAttribute("barrows");
  Object.assign(run, { killed: [0, 1, 2, 3, 4, 5], kills: 6, points: 600, chestOpen: true });
  Barrows._test.searchChest(subject, 1);
  assert.equal(subject.getAttribute("barrows").looted, true);
  arrive(subject, SURFACE);
  assert.equal(subject.getAttribute("barrows"), run, "still the looted run on the surface");
  arrive(subject, CHEST_ROOM);
  subject.sent.messages.length = 0;
  Barrows._test.searchChest(subject, 1);
  assert.deepEqual(subject.sent.messages, ["The chest is empty. Leave the tunnels to begin another run."]);
  arrive(subject, AHRIM_MOUND);
  Barrows._test.dig({ player: subject });
  const fresh = subject.getAttribute("barrows");
  assert.notEqual(fresh, run);
  assert.deepEqual([fresh.looted, fresh.kills, fresh.killed, fresh.chests], [false, 0, [], run.chests]);
  assert.equal(subject.sent.varbits.get(1394), 0, "the chest shut");
});


function rewardDraw() {
  const frames = new Error().stack.split("\n");
  return frames[3]?.includes("at randomInt ") && frames[4]?.includes("at rollRewards ");
}

function chestAtRoll(complete, roll, partial = false) {
  const subject = player();
  const diary = DiaryData.BY_KEY.get("morytania");
  if (complete) subject.setAttribute(DiaryProgress.TASKS_ATTRIBUTE, {
    morytania: ["easy", "medium", "hard"].flatMap((tier) => diary.tiers[tier].tasks.map((task) => task.key)),
  });
  if (partial) subject.setAttribute(DiaryProgress.TASKS_ATTRIBUTE, {
    morytania: diary.tiers.hard.tasks.slice(0, -1).map((task) => task.key),
  });
  const query = { player: subject, diary: "morytania", tier: "hard" };
  diaryApi.emitCustomEvent("diary:is-complete", query);
  assert.equal(query.complete, complete, "real diary completion producer");
  assert.equal(DiaryProgress.claimedTiers(subject, diary).has("hard"), false);
  arrive(subject, CHEST_ROOM);
  const run = subject.getAttribute("barrows");
  Object.assign(run, { killed: [0, 1, 2, 3, 4, 5], kills: 6, points: 1000, chestOpen: true });
  let n = 0;
  const random = Math.random;
  Math.random = () => {
    if (!rewardDraw()) return random();
    const call = n++;
    assert.ok(call < 21, "unexpected reward RNG draw");
    return call % 3 === 1 ? (roll + 0.25) / 1012 : 0.5;
  };
  try { Barrows._test.searchChest(subject, 1); } finally { Math.random = random; }
  assert.equal(n, 21, "seven equipment, table and clue draws");
  assert.equal(run.looted, true);
  assert.equal(subject.chestEvents, 1);
  assert.equal(subject.collected.length, 1);
  assert.ok(subject.sent.rewards, "reward interface was populated");
  const [id, amount] = subject.collected[0];
  assert.equal(subject.getInventory().getAmount(id), amount);
  assert.deepEqual(Object.values(subject.sent.rewards)[0].slots, [{ slot: 0, itemId: id, quantity: amount }]);
  const displayed = subject.sent.rewards;
  Barrows._test.searchChest(subject, 1);
  assert.equal(subject.getInventory().getAmount(id), amount, "re-looting does not add items");
  assert.deepEqual(subject.collected, [[id, amount]], "re-looting emits no rewards");
  assert.equal(subject.chestEvents, 1);
  assert.equal(subject.sent.rewards, displayed, "re-looting does not replace the reward pane");
  return subject.getInventory();
}

test("Barrows: complete Hard diary boosts each even rune roll while no diary retains base", () => {
  const id = core.ItemIdentifiers.MIND_RUNE;
  assert.equal(chestAtRoll(false, 381).getAmount(id), 1778);
  assert.equal(chestAtRoll(false, 381, true).getAmount(id), 1778, "incomplete Hard retains base");
  assert.equal(chestAtRoll(true, 381).getAmount(id), 2667);
});

test("Barrows: completed Hard increases chaos and death rune rolls", () => {
  const items = core.ItemIdentifiers;
  assert.equal(chestAtRoll(false, 505).getAmount(items.CHAOS_RUNE), 784);
  assert.equal(chestAtRoll(true, 505).getAmount(items.CHAOS_RUNE), 1176);
  assert.equal(chestAtRoll(false, 630).getAmount(items.DEATH_RUNE), 490);
  assert.equal(chestAtRoll(true, 630).getAmount(items.DEATH_RUNE), 735);
});

test("Barrows: odd rune rolls use the server's per-roll integer rounding", () => {
  const id = core.ItemIdentifiers.MIND_RUNE;
  assert.equal(chestAtRoll(false, 380).getAmount(id), 1771);
  assert.equal(chestAtRoll(true, 380).getAmount(id), 2653);
});

test("Barrows: the Hard diary leaves bolt racks unchanged", () => {
  const id = core.ItemIdentifiers.BOLT_RACK;
  assert.equal(chestAtRoll(false, 900).getAmount(id), 252);
  assert.equal(chestAtRoll(true, 900).getAmount(id), 252);
});

test("Barrows: equipment, clue, coins, keys and racks keep their amounts in mixed rewards", () => {
  const subject = player();
  const diary = DiaryData.BY_KEY.get("morytania");
  subject.setAttribute(DiaryProgress.TASKS_ATTRIBUTE, {
    morytania: ["easy", "medium", "hard"].flatMap((tier) => diary.tiers[tier].tasks.map((task) => task.key)),
  });
  const query = { player: subject, diary: "morytania", tier: "hard" };
  diaryApi.emitCustomEvent("diary:is-complete", query);
  assert.equal(query.complete, true);
  arrive(subject, CHEST_ROOM);
  const run = subject.getAttribute("barrows");
  Object.assign(run, { killed: [0, 1, 2, 3, 4, 5], kills: 6, points: 1000, chestOpen: true });
  const value = (roll) => (roll + 0.25) / 1012;
  const draws = [0, 0, 0, 0.5, value(100), 0.5, 0.5, value(900),
    0.5, value(1006), 0.5, value(1009), 0.5, value(381), 0.5, value(760)];
  const random = Math.random;
  let n = 0;
  Math.random = () => {
    if (!rewardDraw()) return random();
    assert.ok(n < draws.length, "unexpected mixed reward RNG draw");
    return draws[n++];
  };
  try { Barrows._test.searchChest(subject, 1); } finally { Math.random = random; }
  assert.equal(n, draws.length);
  assert.equal(run.looted, true);
  assert.equal(subject.chestEvents, 1);
  const items = core.ItemIdentifiers;
  const expected = [[items.AHRIMS_HOOD, 1], [items.CLUE_SCROLL_ELITE_, 1], [items.COINS, 208],
    [items.BOLT_RACK, 36], [items.LOOP_HALF_OF_KEY, 1], [items.TOOTH_HALF_OF_KEY, 1],
    [items.MIND_RUNE, 381], [items.BLOOD_RUNE, 57]];
  assert.deepEqual(subject.collected, expected);
  for (const [id, amount] of expected) assert.equal(subject.getInventory().getAmount(id), amount);
  assert.deepEqual(Object.values(subject.sent.rewards)[0].slots,
    expected.map(([itemId, quantity], slot) => ({ slot, itemId, quantity })));
});
