// Run after `yarn build`: node --test tests/wilderness-levers.test.cjs
// The Wilderness teleport levers as rsprox captures of live OSRS show them (docs/wilderness-levers.md).
const assert = require("node:assert/strict");
const path = require("node:path");
const { test, before } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { CacheDefinitions } = require("../dist/game/cache/CacheDefinitions");
const { ObjectDefinition } = require("../dist/game/definition/ObjectDefinition");
const { PluginManager } = require("../dist/plugins/PluginManager");

const Levers = require("../plugins/objects/Levers.plugin");

let core;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  ObjectDefinition.init();
  core = PluginManager.getCoreApi();
});

const loc = (name) => CacheDefinitions.getLocId(name);
const varbit = (name) => CacheDefinitions.getVarbitId(name);

/** Registers the plugin against a fake api, keeping its hooks and the tasks it submits. */
function harness({ diaryComplete = false, teleportSpy = () => {} } = {}) {
  const hooks = {};
  const tasks = [];
  const persisted = [];
  const api = {
    core: { ...core, TeleportHandler: { ...core.TeleportHandler, checkReqs: () => true, teleport: teleportSpy } },
    // As TaskManager.submit: an immediate task runs once on the tick it is submitted.
    getTaskManager: () => ({ submit: (task) => { task.setRunning(true); if (task.isImmediate()) task.execute(); tasks.push(task); } }),
    persistAttribute: (key, value) => persisted.push([key, value]),
    onObjectInteraction: (name, actions) => { hooks[name] = actions; },
    onPlayerLogin: (handler) => { hooks.login = handler; },
    onCustomEvent: (name, handler) => { hooks[name] = handler; },
    diaryTasks: [],
    emitCustomEvent: (name, request) => {
      if (name === "diary:task") api.diaryTasks.push([request.player, request.diary, request.task]);
      if (name === "diary:is-complete" && request.diary === "wilderness" && request.tier === "easy") {
        request.complete = diaryComplete;
      }
    },
  };
  Levers.register(api);
  return { hooks, tasks, persisted, diaryTasks: api.diaryTasks };
}

function player(varbits = {}) {
  const attributes = new Map();
  const sent = new Map(Object.entries(varbits).map(([id, value]) => [Number(id), value]));
  const log = [];
  let tick = 0;
  let location = new core.Location(3153, 3922, 0);
  const self = {
    log,
    sent,
    setTick: (value) => { tick = value; },
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    isRegistered: () => true,
    hitpoints: 10,
    getHitpoints: () => self.hitpoints,
    getLocation: () => location,
    setLocation: (to) => { location = to; },
    moveTo: (to) => { location = to; log.push([tick, "tele", to.getX(), to.getY()]); },
    getMovementQueue: () => ({ reset() { return this; }, setBlockMovement() { return this; } }),
    getForceMovement: () => null,
    setForceMovement() {},
    setSkillAnimation() {},
    getUpdateFlag: () => ({ flag() {} }),
    performAnimation: (animation) => log.push([tick, "anim", animation.getId()]),
    performGraphic: (graphic) => log.push([tick, "gfx", graphic.getId()]),
    sendMessage: (message) => log.push([tick, "msg", message]),
    setPositionToFace() {},
    getDialogueManager: () => ({ startDialogues: (builder) => { self.dialogue = builder; } }),
    getPacketSender: () => ({
      getVarbit: (id) => sent.get(id) ?? 0,
      getVarp: () => 0,
      sendVarbit: (id, value) => { sent.set(id, value); log.push([tick, "varbit", id, value]); },
      sendSoundEffect: (id) => log.push([tick, "sound", id]),
      sendInterfaceRemoval() {},
    }),
  };
  return self;
}

/** Clicks `option` on the lever loc `name` at (x, y). */
function use(h, who, name, option, x, y) {
  const objectId = loc(name);
  const definition = ObjectDefinition.forPlayer(objectId, who);
  const clickType = definition.getInteractions().indexOf(option) + 1;
  assert.ok(clickType > 0, `${name} shows ${option}`);
  return h.hooks.Lever[option]({ player: who, objectId, object: { getLocation: () => new core.Location(x, y, 0) }, definition, clickType, location: { x, y, z: 0 } });
}

/** Runs the submitted tasks one tick at a time, the handler's own tick being 0. */
function runTicks(h, who, ticks) {
  for (let tick = 1; tick <= ticks; tick++) {
    who.setTick(tick);
    for (const task of [...h.tasks]) if (task.isRunning()) task.execute();
  }
}

test("register persists the warning choice and wires the levers' options by name", () => {
  const h = harness();
  assert.deepEqual(h.persisted, [["levers:skip-wilderness-warning", false]]);
  assert.deepEqual(Object.keys(h.hooks.Lever).sort(), ["Ardougne", "Edgeville", "Pull"]);
  assert.equal(typeof h.hooks["lever:teleport"], "function", "the plain lever:teleport event stays");
});

test("the Deserted Keep lever's Pull goes to East Ardougne, as recording 1444", () => {
  const h = harness();
  const who = player();
  assert.equal(use(h, who, "wildoutlever", "Pull", 3153, 3923), true);
  runTicks(h, who, 8);
  assert.deepEqual(who.log.filter((entry) => entry[1] === "tele"), [[6, "tele", 2562, 3311]]);
  assert.deepEqual(who.log.filter((entry) => entry[1] === "msg").map((entry) => entry[2]),
    ["You pull the lever...", "... and teleport out of the Wilderness."]);
});

test("a pull plays the captured sequence: pull, the lever's click, the cast, landing three ticks later", () => {
  const h = harness();
  const who = player();
  use(h, who, "magearena_lever_to_cellar", "Pull", 3090, 3956);
  runTicks(h, who, 8);
  const busy = varbit("busy");
  const at = (kind, value) => who.log.find((entry) => entry[1] === kind && (value === undefined || entry[2] === value))?.[0];
  assert.equal(at("anim", CacheDefinitions.getSeqId("macro_lever_switch_down")), 1, "pull a tick after arrival");
  assert.equal(at("msg", "You pull the lever..."), 1);
  assert.ok(who.log.some((entry) => entry[0] === 1 && entry[1] === "varbit" && entry[2] === busy && entry[3] === 1));
  assert.equal(at("sound", 2400), 2, "the lever clicks a tick later");
  assert.equal(at("anim", CacheDefinitions.getSeqId("human_castteleport")), 3, "the cast a tick after that");
  assert.equal(at("gfx", CacheDefinitions.getSpotanimId("teleport_casting")), 3);
  assert.equal(at("sound", 200), 3);
  assert.deepEqual(who.log.find((entry) => entry[1] === "tele"), [6, "tele", 2539, 4712]);
  assert.equal(at("msg", "... and teleport into the mage's cave."), 6);
  assert.ok(who.log.some((entry) => entry[0] === 6 && entry[1] === "varbit" && entry[2] === busy && entry[3] === 0));
});

test("a pull cut short by death clears busy", () => {
  const h = harness();
  const who = player();
  use(h, who, "magearena_lever_to_cellar", "Pull", 3090, 3956);
  runTicks(h, who, 1);
  const busy = varbit("busy");
  assert.equal(who.sent.get(busy), 1);
  who.hitpoints = 0;
  runTicks(h, who, 8);
  assert.equal(who.sent.get(busy), 0, "buff timers would stay paused");
  assert.equal(who.log.find((entry) => entry[1] === "tele"), undefined);
});

test("the Edgeville lever warns as live, lands beside the Keep lever and skips the warning once told to", () => {
  const h = harness();
  const who = player();
  use(h, who, "edgeville_wildy_lever", "Pull", 3090, 3475);
  const [statement, options] = [...who.dialogue.getDialogues().values()];
  assert.equal(statement.getText(), "<col=7f0000>Warning!</col> The lever will teleport you deep into the <col=7f0000>Wilderness</col>.");
  assert.equal(options.getTitle(), "Are you sure you wish to pull it?");
  assert.deepEqual(options.getOptions(), ["Yes, I'm brave.", "Eeep! The Wilderness... No thank you.", "Yes, and don't show this warning again."]);
  assert.equal(h.tasks.length, 0, "nothing happens before a choice");

  options.execute(3);
  assert.equal(who.getAttribute("levers:skip-wilderness-warning"), true);
  assert.equal(who.sent.get(varbit("wilderness_lever_blockwarning_standard")), 1);
  runTicks(h, who, 8);
  assert.deepEqual(who.log.find((entry) => entry[1] === "tele"), [6, "tele", 3154, 3924], "pull a tick after the choice, land five after that");
  assert.equal(who.sent.get(varbit("wildoutlever_vis")), undefined, "no diary: the Keep lever stays Pull");
  assert.deepEqual(h.diaryTasks, [[who, "wilderness", "enter-the-wilderness-from-the-ardougne-or-edgevi"]], "the Edgeville lever completes the easy Wilderness Diary task on landing, and no Ardougne one");

  who.dialogue = undefined;
  use(h, who, "edgeville_wildy_lever", "Pull", 3090, 3475);
  assert.equal(who.dialogue, undefined, "the warning is skipped");
  const relogged = player();
  relogged.setAttribute("levers:skip-wilderness-warning", true);
  h.hooks.login({ player: relogged });
  assert.equal(relogged.sent.get(varbit("wilderness_lever_blockwarning_standard")), 1, "the setting is sent again on login");
});

test("the easy Wilderness Diary gives the Keep lever its Ardougne and Edgeville options", () => {
  const h = harness({ diaryComplete: true });
  const who = player();
  who.sent.set(varbit("wilderness_lever_blockwarning_standard"), 1);
  who.setAttribute("levers:skip-wilderness-warning", true);
  use(h, who, "edgeville_wildy_lever", "Pull", 3090, 3475);
  runTicks(h, who, 8);
  assert.equal(who.sent.get(varbit("wildoutlever_vis")), 1, "as recording 1444 sets it on landing");

  const definition = ObjectDefinition.forPlayer(loc("wildoutlever"), who);
  assert.deepEqual(definition.getInteractions().slice(0, 3), ["Ardougne", "Edgeville", "Swap-options"]);
  const out = harness({ diaryComplete: true });
  use(out, who, "wildoutlever", "Edgeville", 3153, 3923);
  who.log.length = 0;
  runTicks(out, who, 8);
  assert.deepEqual(who.log.find((entry) => entry[1] === "tele").slice(2), [3090, 3475]);
  assert.equal(who.log.filter((entry) => entry[1] === "msg").at(-1)[2], "... and teleport out of the Wilderness.");
});

test("the East Ardougne lever warns, lands beside the Keep lever and completes the easy Ardougne Diary task", () => {
  const h = harness({ diaryComplete: true });
  const who = player();
  who.setLocation(new core.Location(2561, 3310, 0));
  use(h, who, "wildinlever", "Pull", 2561, 3311);
  const [statement, options] = [...who.dialogue.getDialogues().values()];
  assert.equal(statement.getText(), "<col=7f0000>Warning!</col> The lever will teleport you deep into the <col=7f0000>Wilderness</col>.");
  assert.equal(options.getOptions().length, 3);
  options.execute(2);
  runTicks(h, who, 8);
  assert.equal(who.log.find((entry) => entry[1] === "tele"), undefined, "Eeep! stays put");
  assert.deepEqual(h.diaryTasks, []);

  options.execute(1);
  runTicks(h, who, 8);
  assert.deepEqual(who.log.find((entry) => entry[1] === "tele"), [6, "tele", 3154, 3924]);
  assert.deepEqual(who.log.filter((entry) => entry[1] === "msg").map((entry) => entry[2]),
    ["You pull the lever...", "... and teleport into the Wilderness."]);
  assert.deepEqual(h.diaryTasks, [[who, "ardougne", "use-the-ardougne-lever-to-teleport-to-the-wilder"], [who, "wilderness", "enter-the-wilderness-from-the-ardougne-or-edgevi"]], "the easy Wilderness Diary task counts on landing too");
  assert.equal(who.sent.get(varbit("wildoutlever_vis")), 1, "the Keep lever shows its diary options");
});

test("other levers fall through", () => {
  const h = harness();
  const who = player();
  const objectId = loc("magearena_lever_in");
  const definition = ObjectDefinition.forPlayer(objectId, who);
  assert.equal(h.hooks.Lever.Pull({ player: who, objectId, definition, clickType: 1, location: { x: 3104, y: 3956, z: 0 } }), false);
  assert.equal(h.tasks.length, 0);
});

test("lever:teleport hands its onArrival callback to the teleport, to run on landing", () => {
  const calls = [];
  const h = harness({ teleportSpy: (...args) => calls.push(args) });
  const who = player();
  const onArrival = () => {};
  h.hooks["lever:teleport"]({ player: who, destination: new core.Location(3000, 3000, 0), onArrival });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][4], onArrival, "TeleportHandler.teleport's arrival callback");
});
