// Run after `yarn build`: node --test tests/fremennik-lighthouse-diary.test.cjs
const assert = require("node:assert/strict");
const { before, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { Location } = require("../dist/game/model/Location");

const TASK = "visit-the-lighthouse-from-waterbirth-island";
let core;
let Progress;
let diary;
let handlers;
let hooks;
let questComplete;

function dispatch(name, event) {
  if (name === "quest:is-complete") {
    event.complete = questComplete && event.key === "horror_from_the_deep" ? true : false;
    return;
  }
  for (const handler of handlers.get(name) ?? []) handler(event);
}

before(() => {
  core = PluginManager.getCoreApi();
  handlers = new Map();
  hooks = { beforeObject: [], arrived: [] };
  const api = new Proxy({
    core,
    persistAttribute() {},
    onPlayerLogin() {},
    onBeforeObjectInteraction(handler) { hooks.beforeObject.push(handler); },
    onCustomEvent(name, handler) {
      const entries = handlers.get(name) ?? [];
      entries.push(handler);
      handlers.set(name, entries);
      if (name === "loc-teleports:arrived") hooks.arrived.push(handler);
    },
    emitCustomEvent: dispatch,
  }, { get: (target, key) => key in target ? target[key] : () => {} });

  Progress = require("../plugins/achievements/diaries/Progress.AchievementDiaries");
  diary = require("../plugins/achievements/diaries/Data.AchievementDiaries").BY_KEY.get("fremennik");
  api.onCustomEvent("diary:task", require("../plugins/achievements/AchievementDiaries.plugin")._test.onTask);
  Progress(api);
  require("../plugins/achievements/diaries/FremennikLighthouseDiary.plugin").register(api);
  PluginManager.emitCustomEvent = dispatch;
});

function fixture({ questDone = true, inPrivate = false, registered = true, hitpoints = 10 } = {}) {
  questComplete = questDone;
  const player = new Player(null);
  const messages = [];
  const sender = new Proxy({}, { get: (_target, key) => key === "sendVarbit"
    ? () => sender
    : () => sender });
  player.getPacketSender = () => sender;
  player.sendMessage = (text) => messages.push(String(text));
  player.setRegistered(registered);
  player.setIndex(1500 + Math.floor(Math.random() * 500));
  player.setLocation(new Location(2506, 10018, 0));
  player.setAttribute(Progress.TASKS_ATTRIBUTE, {});
  if (inPrivate) player.getPrivateArea = () => ({ isPrivate: true });
  player.getHitpoints = () => hitpoints;
  return { player, messages };
}

function arrival(player, overrides = {}) {
  hooks.arrived[0]({
    player,
    objectId: 10194,
    location: { x: 1975, y: 4408, z: 3 },
    ...overrides,
  });
}

const done = (player) => Progress.doneTasks(player, diary);

test("arriving from the fifth-sublevel Waterbirth exit credits the Lighthouse task", () => {
  const { player } = fixture();
  arrival(player);
  assert.ok(done(player).has(TASK));
});

test("no credit before Horror from the Deep is complete", () => {
  const { player } = fixture({ questDone: false });
  arrival(player);
  assert.equal(done(player).has(TASK), false);
});

test("no credit from another object, ladder tile or landing", () => {
  const { player } = fixture();
  arrival(player, { objectId: 10193 });
  arrival(player, { location: { x: 1975, y: 4409, z: 3 } });
  player.setLocation(new Location(2506, 3640, 0));
  arrival(player);
  assert.equal(done(player).has(TASK), false);
});

test("inactive players do not earn or re-earn the task", () => {
  for (const options of [{ inPrivate: true }, { registered: false }, { hitpoints: 0 }]) {
    const { player } = fixture(options);
    arrival(player);
    assert.equal(done(player).has(TASK), false, JSON.stringify(options));
  }
});

test("repeat arrivals leave one completed task", () => {
  const { player } = fixture();
  arrival(player);
  arrival(player);
  assert.deepEqual([...done(player)], [TASK]);
});

test("the exit ladder is refused before Horror from the Deep and left alone after", () => {
  const { player, messages } = fixture({ questDone: false });
  const event = { player, objectId: 10194, object: { getLocation: () => new Location(1975, 4408, 3) }, handled: false };
  hooks.beforeObject[0](event);
  assert.equal(event.handled, true);
  assert.equal(messages.length, 1);
  assert.match(messages[0], /Horror from the Deep/);

  const after = fixture();
  const allowed = { player: after.player, objectId: 10194, object: { getLocation: () => new Location(1975, 4408, 3) }, handled: false };
  hooks.beforeObject[0](allowed);
  assert.equal(allowed.handled, false);
});

test("the gate ignores other ladders and tiles", () => {
  const { player } = fixture({ questDone: false });
  const other = { player, objectId: 10177, object: { getLocation: () => new Location(2546, 10143, 0) }, handled: false };
  hooks.beforeObject[0](other);
  assert.equal(other.handled, false);
  const elsewhere = { player, objectId: 10194, object: { getLocation: () => new Location(1975, 4409, 3) }, handled: false };
  hooks.beforeObject[0](elsewhere);
  assert.equal(elsewhere.handled, false);
});
