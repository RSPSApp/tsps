// Run after `yarn build`: node --test tests/wilderness-resource-diary.test.cjs
//
// The Wilderness Diary's Resource Area tasks (OSRS Wiki: Resource Area, Wilderness Diary): hard "Smith an
// Adamant scimitar in the Resource Area", elite "Fish and Cook a Dark Crab in the Resource Area" and elite
// "Cut and burn some magic logs in the Resource Area". The area is the enclosure east of the Deserted Keep
// (Wiki map: x 3174-3197, y 3924-3945; the gate is on its north side at 3184,3944-3945).
// Rules: Wiki. "Cut and burn" is two steps in order and "completing or updating any other task in-between
// these steps will reset the progress for this task" (Wilderness Diary page). INFERRED, the Wiki is silent:
// the dark crab needs its fishing step first (fish, then cook), without that reset rule; the cut step is a log
// delivered by woodcutting, and the burn step is logs lit (firemaking:success), which an infernal axe's burning
// and a fire that was not lit do not emit.
// The burn step is credited by the event firemaking:success, which logs lit on the ground and logs fed to the
// Forester's Campfire both emit with the same payload (Logs.Firemaking.js:584 tending -> :151
// grantFiremakingLogXp), so tending a campfire in the area credits it too. The Golden helmet's lighting
// (Logs.Firemaking.js:725) names the helmet, not a log, and credits nothing here.
// One real route: pay at the gate (ResourceArea.plugin.js), walk to the anvil, smith for real.
// The fourth task, "Smith a rune scimitar from scratch", is in runite-golem.test.cjs.
// Fixture seam: the producers' own success events (smithing:success from the anvil, fishing:success,
// cooking:success, woodcutting:success, firemaking:success) are emitted by hand with the payloads those
// producers send, through the real PluginManager into the real diary plugin and progress; a player's
// position is real. Plugins start with DISABLE_PLAYER_BOTS=1 and are shut down at the end.
process.env.DISABLE_PLAYER_BOTS = "1";
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ClientConnection } = require("../dist/net/NetworkBuilder");
const SmithingData = require("../plugins/skills/smithing/Data.Smithing");
const { PlayerSave } = require("../dist/game/entity/impl/player/persistence/PlayerSave");
const Diaries = require("../plugins/achievements/diaries/Data.AchievementDiaries");
const DiaryProgress = require("../plugins/achievements/diaries/Progress.AchievementDiaries");

const DIARY = Diaries.BY_KEY.get("wilderness");
const SCIMITAR = "smith-an-adamant-scimitar-in-the-resource-area";
const CRAB = "fish-and-cook-a-dark-crab-in-the-resource-area";
const LOGS = "cut-and-burn-some-magic-logs-in-the-resource-are";
const OTHER_TASK = "mine-some-iron-ore-in-the-wilderness";
const INSIDE = [3185, 3935];
const OUTSIDE_NORTH = [3184, 3946];
const OUTSIDE_DEEP = [3200, 3935];
let core;
let I;
let next = 9300;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  I = core.ItemIdentifiers;
  core.ObjectDefinition.init();
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(3184, 3944);
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

const players = [];
function actor(t, at = INSIDE) {
  const channel = {
    kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {},
  };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++);
  p.setUsername("resource" + p.getIndex());
  p.setRegistered(true);
  p.setLocation(new core.Location(at[0], at[1], 0));
  p.needsPlacement = false;
  t.mock.method(p.getPacketSender(), "sendMessage", () => p.getPacketSender());
  t.after(() => {
    PM.emitPlayerLogout({ player: p, username: p.getUsername() });
    p.setRegistered(false);
    core.TaskManager.cancelTasks(p.getIndex());
  });
  return p;
}

const done = (p, task) => DiaryProgress.doneTasks(p, DIARY).has(task);
const at = (p, [x, y]) => p.setLocation(new core.Location(x, y, 0));
const smithed = (p, itemId) => PM.emitCustomEvent("smithing:success", { player: p, skill: core.Skill.SMITHING, itemId });
const fished = (p, itemId) => PM.emitCustomEvent("fishing:success", { player: p, skill: core.Skill.FISHING, itemId, petBase: 0, stop: false });
const cooked = (p, itemId) => PM.emitCustomEvent("cooking:success", { player: p, skill: core.Skill.COOKING, itemId, objectId: 26185, objectLocation: { x: 3180, y: 3930, z: 0 } });
const cut = (p, logId, logAmount = 1) => PM.emitCustomEvent("woodcutting:success", {
  player: p, skill: core.Skill.WOODCUTTING, petBase: 0, petRolled: false, logId, location: { x: 3180, y: 3932, z: 0 }, logAmount, axeId: 1359,
});
const burned = (p, itemId) => PM.emitCustomEvent("firemaking:success", { player: p, skill: core.Skill.FIREMAKING, itemId, bow: false });

test("Adamant scimitar: smithing one inside the Resource Area credits the hard task", (t) => {
  const p = actor(t);
  assert.equal(done(p, SCIMITAR), false, "not yet");
  smithed(p, I.ADAMANT_SCIMITAR);
  assert.equal(done(p, SCIMITAR), true);
});

test("Adamant scimitar: outside the area, or another item, does not credit", (t) => {
  const p = actor(t, OUTSIDE_NORTH);
  smithed(p, I.ADAMANT_SCIMITAR);
  at(p, OUTSIDE_DEEP);
  smithed(p, I.ADAMANT_SCIMITAR);
  at(p, INSIDE);
  smithed(p, I.RUNE_SCIMITAR);
  smithed(p, I.ADAMANT_SCIMITAR + 1);
  assert.equal(done(p, SCIMITAR), false);
});

test("Dark crab: fished and then cooked inside the area credits the elite task", (t) => {
  const p = actor(t);
  fished(p, I.RAW_DARK_CRAB);
  assert.equal(done(p, CRAB), false, "fishing alone");
  cooked(p, I.DARK_CRAB);
  assert.equal(done(p, CRAB), true);
});

test("Dark crab: cooking first, either step outside the area, a raw crab, another fish or another dish credit nothing", (t) => {
  const first = actor(t);
  cooked(first, I.DARK_CRAB);
  fished(first, I.RAW_DARK_CRAB);
  assert.equal(done(first, CRAB), false, "cooked before it was fished");
  const away = actor(t, OUTSIDE_DEEP);
  fished(away, I.RAW_DARK_CRAB);
  at(away, INSIDE);
  cooked(away, I.DARK_CRAB);
  assert.equal(done(away, CRAB), false, "fished outside");
  const fishedHere = actor(t);
  fished(fishedHere, I.RAW_DARK_CRAB);
  at(fishedHere, OUTSIDE_DEEP);
  cooked(fishedHere, I.DARK_CRAB);
  assert.equal(done(fishedHere, CRAB), false, "cooked outside");
  at(fishedHere, INSIDE);
  cooked(fishedHere, I.RAW_DARK_CRAB);
  fished(fishedHere, I.RAW_SHARK);
  cooked(fishedHere, I.SHARK);
  assert.equal(done(fishedHere, CRAB), false, "wrong items");
});

test("Dark crab: the fishing step survives a save and reload", (t) => {
  const p = actor(t);
  fished(p, I.RAW_DARK_CRAB);
  const reloaded = actor(t);
  PlayerSave.fromPlayer(p).applyToPlayer(reloaded);
  cooked(reloaded, I.DARK_CRAB);
  assert.equal(done(reloaded, CRAB), true);
});

test("Magic logs: cut and then burnt inside the area credits the elite task", (t) => {
  const p = actor(t);
  cut(p, I.MAGIC_LOGS);
  assert.equal(done(p, LOGS), false, "cutting alone");
  burned(p, I.MAGIC_LOGS);
  assert.equal(done(p, LOGS), true);
});

test("Magic logs: burning first, other logs, a felled log that gave nothing, or the wrong place credit nothing", (t) => {
  const first = actor(t);
  burned(first, I.MAGIC_LOGS);
  cut(first, I.MAGIC_LOGS);
  assert.equal(done(first, LOGS), false, "burnt before cut");
  const yew = actor(t);
  cut(yew, I.YEW_LOGS);
  burned(yew, I.YEW_LOGS);
  assert.equal(done(yew, LOGS), false, "yew");
  const nothing = actor(t);
  cut(nothing, I.MAGIC_LOGS, 0);
  burned(nothing, I.MAGIC_LOGS);
  assert.equal(done(nothing, LOGS), false, "the cut gave no log");
  const away = actor(t, OUTSIDE_DEEP);
  cut(away, I.MAGIC_LOGS);
  at(away, INSIDE);
  burned(away, I.MAGIC_LOGS);
  assert.equal(done(away, LOGS), false, "cut outside");
  const burnedAway = actor(t);
  cut(burnedAway, I.MAGIC_LOGS);
  at(burnedAway, OUTSIDE_DEEP);
  burned(burnedAway, I.MAGIC_LOGS);
  assert.equal(done(burnedAway, LOGS), false, "burnt outside");
});

test("Magic logs: another task updated between the steps resets the progress (Wiki)", (t) => {
  const p = actor(t);
  cut(p, I.MAGIC_LOGS);
  PM.emitCustomEvent("diary:task", { player: p, diary: "wilderness", task: OTHER_TASK });
  assert.equal(done(p, OTHER_TASK), true, "the other task was newly completed");
  burned(p, I.MAGIC_LOGS);
  assert.equal(done(p, LOGS), false, "the cut was forgotten");
  cut(p, I.MAGIC_LOGS);
  burned(p, I.MAGIC_LOGS);
  assert.equal(done(p, LOGS), true, "a fresh pair of steps completes it");
});

test("Magic logs: a task that was already done is not an update", (t) => {
  const p = actor(t);
  PM.emitCustomEvent("diary:task", { player: p, diary: "wilderness", task: OTHER_TASK });
  cut(p, I.MAGIC_LOGS);
  PM.emitCustomEvent("diary:task", { player: p, diary: "wilderness", task: OTHER_TASK });
  burned(p, I.MAGIC_LOGS);
  assert.equal(done(p, LOGS), true);
});

test("Magic logs: the cut step survives a save and reload", (t) => {
  const p = actor(t);
  cut(p, I.MAGIC_LOGS);
  const reloaded = actor(t);
  PlayerSave.fromPlayer(p).applyToPlayer(reloaded);
  burned(reloaded, I.MAGIC_LOGS);
  assert.equal(done(reloaded, LOGS), true);
});

test("the tasks are separate: one credit does not give another", (t) => {
  const p = actor(t);
  smithed(p, I.ADAMANT_SCIMITAR);
  assert.equal(done(p, CRAB) || done(p, LOGS), false);
});

test("Magic logs: tending a Forester's Campfire emits the same firemaking:success, so the burn step credits (inferred from the producer)", (t) => {
  const p = actor(t);
  cut(p, I.MAGIC_LOGS);
  PM.emitCustomEvent("firemaking:success", { player: p, skill: core.Skill.FIREMAKING, itemId: I.MAGIC_LOGS, bow: false });
  assert.equal(done(p, LOGS), true);
});

test("Magic logs: the Golden helmet's lighting names the helmet, not a log, and credits nothing", (t) => {
  const p = actor(t);
  cut(p, I.MAGIC_LOGS);
  PM.emitCustomEvent("firemaking:success", { player: p, skill: core.Skill.FIREMAKING, itemId: I.MAGIC_LOGS + 1, resultId: 1, activity: "mining-helmet" });
  assert.equal(done(p, LOGS), false);
});

/** The first anvil the map holds inside the area (loc 2097 or 2031), or null. */
function findAnvil() {
  for (const id of [2097, 2031]) {
    for (let x = 3174; x <= 3197; x++) {
      for (let y = 3925; y <= 3944; y++) {
        const object = core.MapObjects.get(id, new core.Location(x, y, 0), null);
        if (object) return { id, x, y };
      }
    }
  }
  return null;
}

test("a real route: pay the gate, walk to the anvil, smith an adamant scimitar -> the hard task", async (t) => {
  const anvil = findAnvil();
  assert.ok(anvil, "the map has an anvil inside the Resource Area");
  const channel = {
    kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {},
  };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++);
  p.setUsername("route" + p.getIndex());
  p.setRegistered(true);
  p.setAttribute("bot-skip-persistence", true);
  p.setLocation(new core.Location(3184, 3945, 0));
  p.needsPlacement = false;
  t.mock.method(p.getPacketSender(), "sendMessage", () => p.getPacketSender());
  t.mock.method(p.getPacketSender(), "sendTypedMessage", () => p.getPacketSender());
  const c = new ClientConnection(channel);
  c.player = p;
  t.after(() => {
    PM.emitPlayerLogout({ player: p, username: p.getUsername() });
    p.setRegistered(false);
    core.TaskManager.cancelTasks(p);
    core.TaskManager.cancelTasks(p.getIndex());
  });
  const tick = (count) => {
    for (let i = 0; i < count; i++) {
      core.World.processCycle++;
      core.TaskManager.process();
      c.processTurnPackets();
      p.getMovementQueue().process();
      core.TaskManager.processWalkTo(p.getIndex());
      p.getSession().flushClient(core.World.processCycle);
      p.resetUpdating();
    }
  };
  p.getInventory().add(new core.Item(995, 7500), false);
  p.getInventory().add(new core.Item(I.HAMMER, 1), false);
  p.getInventory().add(new core.Item(I.ADAMANTITE_BAR, 2), false);
  p.getSkillManager().setCurrentLevel(core.Skill.SMITHING, 99);
  p.getSkillManager().setMaxLevel(core.Skill.SMITHING, 99);

  await c.dispatch([{ type: "object_option", id: 26760, x: 3184, y: 3944, clickType: 1 }]);
  tick(3);
  assert.equal(core.MultiChatboxPrompt.getPending(p)?.title, "Pay 7500 coins to enter?");
  core.MultiChatboxPrompt.handleInterfaceActionClick({ player: p, buttonId: core.MultiChatboxPrompt.OPTIONS_WIDGET_ID, groupId: 219, slot: 1, action: 1 });
  tick(6);
  assert.equal(p.getLocation().getY() <= 3944, true, "the player paid and is inside");
  assert.equal(done(p, SCIMITAR), false);

  await c.dispatch([{ type: "object_option", id: anvil.id, x: anvil.x, y: anvil.y, clickType: 1 }]);
  tick(30);
  const product = SmithingData.productsFor(I.ADAMANTITE_BAR).find((candidate) => candidate.itemId === I.ADAMANT_SCIMITAR);
  assert.ok(product, "the anvil's adamant bar list has the scimitar");
  const widgetId = (312 << 16) | product.component;
  await c.dispatch([{ type: "widget_action", widgetId, groupId: 312, childId: product.component, buttonNum: 1, slot: 0 }]);
  tick(12);
  assert.equal(p.getInventory().getAmount(I.ADAMANT_SCIMITAR), 1, "a scimitar was smithed at the anvil");
  assert.equal(done(p, SCIMITAR), true);
});
