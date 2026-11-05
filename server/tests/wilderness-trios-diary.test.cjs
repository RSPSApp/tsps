// Run after `yarn build`: node --test tests/wilderness-trios-diary.test.cjs
//
// The Wilderness Diary's two boss trios (OSRS Wiki: Wilderness Diary): hard "Kill the Crazy Arc., Chaos
// Fanatic & Scorpia" and elite "Kill Callisto, Venenatis & Vet'ion". Wiki: the bosses can be killed in any
// order, "completing or updating any other task in-between will reset the progress for this task"; for the
// elite one the lesser versions (Artio, Spindel, Calvar'ion) also count. Inferred and stated: another task's
// update means a task newly completed (the diary:task event's `completed`) or the other trio advancing; a
// completed trio no longer takes part; killing the same boss again changes nothing; the partial progress of
// the Red spiders' eggs task is not an event yet (#2435 adds progress notifications) so it does not reset.
// Real engine: every plugin loaded, real Players and NPCs, the real diary progress, the real death path for
// Crazy archaeologist, Chaos Fanatic and Scorpia (npc death -> NpcDrops -> "npc-drops:roll"), and that same
// roll event, as the Wilderness lairs' claim emits it per rewarded player, for the six lair bosses.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { NpcDefinitionLoader } = require("../dist/game/definition/loader/impl/NpcDefinitionLoader");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { PlayerSave } = require("../dist/game/entity/impl/player/persistence/PlayerSave");

const Diaries = require("../plugins/achievements/diaries/Data.AchievementDiaries");
const DiaryProgress = require("../plugins/achievements/diaries/Progress.AchievementDiaries");

const DIARY = Diaries.BY_KEY.get("wilderness");
const HARD = "kill-the-crazy-arc-chaos-fanatic-scorpia";
const ELITE = "kill-callisto-venenatis-vet-ion";
const OTHER_TASK = "mine-some-iron-ore-in-the-wilderness";
const BOSSES = {
  crazy: { id: 6618, at: [2977, 3702] },
  fanatic: { id: 6619, at: [2979, 3846] },
  scorpia: { id: 6615, at: [3233, 10341] },
  callisto: { id: 6609, at: [3356, 10322] },
  venenatis: { id: 6610, at: [3421, 10202] },
  vetion: { id: 6611, at: [3294, 10201] },
  vetionReborn: { id: 6612, at: [3294, 10201] },
  artio: { id: 11992, at: [1756, 11538] },
  spindel: { id: 11998, at: [1629, 11546] },
  calvarion: { id: 11993, at: [1886, 11545] },
};
const GENERIC = new Set(["crazy", "fanatic", "scorpia"]);
let core;
let next = 9600;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  new NpcDefinitionLoader().load();
  PluginManager.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PluginManager.getCoreApi();
  core.ObjectDefinition.init();
});

function actor(t) {
  const channel = {
    kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {},
  };
  const player = new Player(new PlayerSession(channel));
  player.setIndex(next++);
  player.setUsername("trio" + player.getIndex());
  player.setRegistered(true);
  player.setLocation(new core.Location(3000, 3600, 0));
  player.needsPlacement = false;
  t.mock.method(player.getPacketSender(), "sendMessage", () => player.getPacketSender());
  return player;
}

const credited = (player, task) => DiaryProgress.doneTasks(player, DIARY).has(task);

/** One rewarded kill of `boss` for `player`. */
function kill(player, boss) {
  const { id, at: [x, y] } = BOSSES[boss];
  const npc = core.NPC.create(id, new core.Location(x, y, 0));
  if (GENERIC.has(boss)) {
    PluginManager.emitNpcDeath({ killer: player, npc, npcId: id, location: { x, y, z: 0 }, damagers: [player] });
  } else {
    PluginManager.emitCustomEvent("npc-drops:roll", { player, npc, npcId: id, drops: [], damagers: [player] });
  }
}

const killAll = (player, ...bosses) => bosses.forEach((boss) => kill(player, boss));
const otherTask = (player, task = OTHER_TASK) => {
  const request = { player, diary: "wilderness", task, completed: false };
  PluginManager.emitCustomEvent("diary:task", request);
  return request.completed;
};

test("hard: Crazy archaeologist, Chaos Fanatic and Scorpia, in any order, complete the task on the third", (t) => {
  for (const order of [["crazy", "fanatic", "scorpia"], ["scorpia", "crazy", "fanatic"], ["fanatic", "scorpia", "crazy"]]) {
    const player = actor(t);
    killAll(player, order[0], order[1]);
    assert.equal(credited(player, HARD), false, `${order.join(", ")}: two are not enough`);
    kill(player, order[2]);
    assert.equal(credited(player, HARD), true, `${order.join(", ")}: the third completes it`);
  }
});

test("hard: killing the same boss again is not progress", (t) => {
  const player = actor(t);
  killAll(player, "crazy", "crazy", "fanatic", "fanatic");
  assert.equal(credited(player, HARD), false);
  kill(player, "scorpia");
  assert.equal(credited(player, HARD), true);
});

test("hard: another task completed in between resets the trio", (t) => {
  const player = actor(t);
  killAll(player, "crazy", "fanatic");
  assert.equal(otherTask(player), true, "the other task is newly completed");
  kill(player, "scorpia");
  assert.equal(credited(player, HARD), false, "the first two were forgotten");
  killAll(player, "crazy", "fanatic");
  assert.equal(credited(player, HARD), true, "a fresh run of three completes it");
});

test("hard: a task that was already done is not an update and does not reset", (t) => {
  const player = actor(t);
  assert.equal(otherTask(player), true);
  killAll(player, "crazy", "fanatic");
  assert.equal(otherTask(player), false, "already done: nothing newly completed");
  kill(player, "scorpia");
  assert.equal(credited(player, HARD), true);
});

test("elite: Callisto, Venenatis and Vet'ion, in any order, complete the task on the third", (t) => {
  for (const order of [["callisto", "venenatis", "vetion"], ["vetion", "callisto", "venenatis"]]) {
    const player = actor(t);
    killAll(player, order[0], order[1]);
    assert.equal(credited(player, ELITE), false, `${order.join(", ")}: two are not enough`);
    kill(player, order[2]);
    assert.equal(credited(player, ELITE), true, `${order.join(", ")}: the third completes it`);
  }
});

test("elite: the lesser versions count for their greater ones, alone or mixed", (t) => {
  const lesser = actor(t);
  killAll(lesser, "artio", "spindel", "calvarion");
  assert.equal(credited(lesser, ELITE), true, "all three lesser");
  const mixed = actor(t);
  killAll(mixed, "callisto", "spindel", "vetion");
  assert.equal(credited(mixed, ELITE), true, "one greater, one lesser, one greater");
  const twice = actor(t);
  killAll(twice, "callisto", "artio", "venenatis");
  assert.equal(credited(twice, ELITE), false, "Callisto and Artio are the same boss for the task");
  kill(twice, "calvarion");
  assert.equal(credited(twice, ELITE), true);
});

test("elite: Vet'ion's other form counts as Vet'ion", (t) => {
  const player = actor(t);
  killAll(player, "callisto", "venenatis", "vetionReborn");
  assert.equal(credited(player, ELITE), true);
});

test("elite: another task completed in between resets the trio", (t) => {
  const player = actor(t);
  killAll(player, "callisto", "venenatis");
  otherTask(player);
  kill(player, "vetion");
  assert.equal(credited(player, ELITE), false);
});

test("each trio's progress is another task's update: a boss of the other trio resets it", (t) => {
  const player = actor(t);
  killAll(player, "crazy", "fanatic");
  kill(player, "callisto");
  kill(player, "scorpia");
  assert.equal(credited(player, HARD), false, "a Callisto kill came in between");
  killAll(player, "crazy", "fanatic");
  assert.equal(credited(player, HARD), true, "a fresh run");
});

test("a completed trio takes no further part: its bosses no longer reset the other trio", (t) => {
  const player = actor(t);
  killAll(player, "crazy", "fanatic", "scorpia");
  assert.equal(credited(player, HARD), true);
  killAll(player, "callisto", "venenatis");
  kill(player, "crazy");
  kill(player, "vetion");
  assert.equal(credited(player, ELITE), true, "a Crazy archaeologist kill in between did not reset it");
});

test("completing one trio resets the other's partial progress", (t) => {
  const player = actor(t);
  killAll(player, "callisto", "venenatis");
  otherTask(player, HARD);
  kill(player, "vetion");
  assert.equal(credited(player, ELITE), false, "the hard task completing in between reset Callisto and Venenatis");
});

test("the progress is each player's own", (t) => {
  const a = actor(t);
  const b = actor(t);
  killAll(a, "crazy", "fanatic");
  killAll(b, "scorpia");
  kill(a, "scorpia");
  assert.equal(credited(a, HARD), true);
  assert.equal(credited(b, HARD), false);
});

test("the progress is saved with the player and survives a reload", (t) => {
  const player = actor(t);
  killAll(player, "crazy", "fanatic");
  const reloaded = actor(t);
  PlayerSave.fromPlayer(player).applyToPlayer(reloaded);
  assert.equal(credited(reloaded, HARD), false);
  kill(reloaded, "scorpia");
  assert.equal(credited(reloaded, HARD), true, "two before the save, one after");
});

test("other NPCs change nothing", (t) => {
  const player = actor(t);
  killAll(player, "crazy", "fanatic");
  const man = core.NPC.create(3106, new core.Location(3222, 3218, 0));
  PluginManager.emitNpcDeath({ killer: player, npc: man, npcId: 3106, location: { x: 3222, y: 3218, z: 0 }, damagers: [player] });
  kill(player, "scorpia");
  assert.equal(credited(player, HARD), true, "an unrelated kill in between did not reset it");
});
