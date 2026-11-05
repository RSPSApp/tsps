// Run after `yarn build`: node --test tests/morytania-finish-activities.test.cjs
//
// The five Morytania base activities added for #2427: Snelm crafting, Guthix balance mixing,
// barehand shark fishing, the Swamp Boaty event and a Trouble Brewing round.
const assert = require("node:assert/strict");
const { before, test } = require("node:test");
const path = require("node:path");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");

let core;

function bus() {
  const listeners = new Map();
  const emit = (name, event) => (listeners.get(name) ?? []).forEach((handler) => handler(event));
  return {
    emit,
    on(name, handler) { listeners.set(name, [...(listeners.get(name) ?? []), handler]); },
    listeners,
  };
}

function fakeApi(events, extra = {}) {
  return new Proxy({
    core,
    ...extra,
    emitCustomEvent: events.emit,
    onCustomEvent: events.on,
    persistAttribute() {},
    getTaskManager: () => ({ submit() {} }),
    getWorld: () => ({}),
  }, { get: (target, key) => (key in target ? target[key] : () => {}) });
}

function playerAt(x, y, z = 0) {
  const { Player } = require("../dist/game/entity/impl/player/Player");
  const player = new Player(null);
  player.setLocation(new core.Location(x, y, z));
  player.setRegistered(true);
  player.setIndex(1900 + Math.floor(Math.random() * 500));
  player.sendMessage = () => {};
  const sender = new Proxy({}, { get: () => () => sender });
  player.getPacketSender = () => sender;
  player.getSkillManager = () => ({
    getCurrentLevel: () => 99,
    getMaxLevel: () => 99,
    getTotalLevel: () => 2000,
    addExperiences: () => {},
    addExperience: () => {},
  });
  return player;
}

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  core = PluginManager.getCoreApi();
});

test("Snelm: a chisel on a blamish shell makes the matching snelm and reports production", () => {
  const events = bus();
  const produced = [];
  events.on("skills:produced", (event) => produced.push(event));
  const api = fakeApi(events);
  const Shared = require("../plugins/skills/crafting/Shared.Crafting");
  Shared.attach(api);
  const Snelms = require("../plugins/skills/crafting/Snelms.Crafting");
  Snelms(api);

  const player = playerAt(3500, 3500);
  const I = core.ItemIdentifiers;
  const recipe = Snelms._test.data().byShell.get(I.BLAMISH_MYRE_SHELL);
  assert.ok(recipe, "the myre shell has a recipe");
  player.getInventory().addItem(new core.Item(I.BLAMISH_MYRE_SHELL, 1));
  player.getInventory().addItem(new core.Item(I.CHISEL, 1));
  assert.equal(Snelms._test.craftOne(player, recipe), true);
  assert.equal(player.getInventory().getAmount(I.BLAMISH_MYRE_SHELL), 0, "the shell is consumed");
  assert.equal(player.getInventory().getAmount(I.MYRE_SNELM), 1, "the snelm is made");
  assert.equal(player.getInventory().getAmount(I.CHISEL), 1, "the chisel is kept");
  assert.equal(produced[0]?.kind, "snelms");
  assert.equal(produced[0]?.itemId, I.MYRE_SNELM);
});

test("Guthix balance: garlic then silver dust, gated on the In Aid of the Myreque stage", () => {
  const events = bus();
  events.on("quest:is-complete", (request) => { request.complete = true; });
  events.on("quest:is-started", (request) => { request.started = true; });
  events.on("quest:get-stage", (request) => { request.stage = 280; });
  const api = fakeApi(events);
  const Common = require("../plugins/skills/herblore/Common.Herblore");
  Common.init(api);
  const hooks = [];
  api.onItemOnItem = (handler) => hooks.push(handler);
  require("../plugins/skills/herblore/Mixing.Herblore")(api);

  const player = playerAt(3500, 3500);
  const I = core.ItemIdentifiers;
  player.getInventory().addItem(new core.Item(I.RESTORE_POTION_4_, 1));
  player.getInventory().addItem(new core.Item(I.GARLIC, 1));
  hooks[0]({ player, usedItemId: I.RESTORE_POTION_4_, usedWithItemId: I.GARLIC, handled: false });
  assert.equal(player.getInventory().getAmount(I.GUTHIX_BALANCE_UNF_), 1, "garlic makes the unfinished potion");
  player.getInventory().addItem(new core.Item(I.SILVER_DUST, 1));
  hooks[0]({ player, usedItemId: I.GUTHIX_BALANCE_UNF_, usedWithItemId: I.SILVER_DUST, handled: false });
  assert.equal(player.getInventory().getAmount(I.GUTHIX_BALANCE_4_), 1, "silver dust finishes it");

  // Below the Gadderanks stage the recipe is unknown.
  events.on("quest:get-stage", (request) => { request.stage = 100; });
  const poor = playerAt(3500, 3500);
  poor.getInventory().addItem(new core.Item(I.RESTORE_POTION_4_, 1));
  poor.getInventory().addItem(new core.Item(I.GARLIC, 1));
  const before = poor.getInventory().getAmount(I.RESTORE_POTION_4_);
  hooks[0]({ player: poor, usedItemId: I.RESTORE_POTION_4_, usedWithItemId: I.GARLIC, handled: false });
  assert.equal(poor.getInventory().getAmount(I.RESTORE_POTION_4_), before, "the potion is not made early");
});

test("barehand shark: 96 Fishing and 76 Strength supplies the hand variant and reports barehand", () => {
  const events = bus();
  const successes = [];
  events.on("fishing:success", (event) => successes.push(event));
  const api = fakeApi(events);
  const Fishing = require("../plugins/skills/Fishing.plugin");
  Fishing.register(api);

  const player = playerAt(3520, 3180);
  player.getSkillManager = () => ({
    getCurrentLevel: (skill) => (skill === core.Skill.STRENGTH ? 76 : 96),
    getMaxLevel: () => 99,
    addExperiences: () => {},
  });
  const tool = Fishing.TOOLS.BAREHAND_SHARK;
  const variant = Fishing.hasToolRequirements(player, tool);
  assert.ok(variant, "the bare-hands variant exists at the levels");
  assert.equal(variant.barehand, true);

  Fishing.landCatch(player, tool, variant, [Fishing.FISH.SHARK_BAREHAND]);
  assert.ok(successes.length > 0, "landing the shark emits fishing:success");
  assert.equal(successes[0].barehand, true, "the event records the barehand method");
  assert.equal(player.getInventory().getAmount(core.ItemIdentifiers.RAW_SHARK), 1);
});

test("Morytania diary: the five new actions emit their catalogue tasks", () => {
  const events = bus();
  const api = fakeApi(events);
  const Diary = require("../plugins/achievements/diaries/MorytaniaActivities.AchievementDiaries.plugin");
  const emitted = [];
  events.on("diary:task", (event) => emitted.push(event.task));
  Diary.register(api);
  const t = Diary._test;

  const player = playerAt(3500, 3500); // Canifis, Morytania
  t.snelm({ player, skill: core.Skill.CRAFTING, kind: "snelms" });
  t.troubleBrewing({ player });
  t.swampBoaty({ player, from: "hollows" });
  t.guthixBalance({ player, itemId: 7660 });
  const fisher = playerAt(3520, 3180); // Burgh de Rott
  t.barehandShark({ player: fisher, skill: core.Skill.FISHING, itemId: core.ItemIdentifiers.RAW_SHARK, barehand: true });

  for (const task of Object.values(t.TASKS)) assert.ok(emitted.includes(task), `emitted ${task}`);
  assert.equal(emitted.filter((task) => task === t.TASKS.snelm).length, 1, "dedupe is left to the Progress store");
  assert.equal(t.swampBoaty({ player, from: "mortton" }), undefined);
});

test("Trouble Brewing: ingredients and three lit boilers brew a bottle that scores when packed", () => {
  const events = bus();
  const completed = [];
  events.on("trouble-brewing:completed", (event) => completed.push(event));
  const api = fakeApi(events);
  const Common = require("../plugins/minigames/troublebrewing/Common.TroubleBrewing");
  Common.init(api);
  // The real arena is a normal map, so completeBrew's ground item is the only core service this
  // logic test stubs.
  const bottles = [];
  core.ItemOnGroundManager = {
    registerLocation: (_owner, item) => { const ground = { item }; bottles.push(ground); return ground; },
    deregister: () => {},
  };
  const Game = require("../plugins/minigames/troublebrewing/Game.TroubleBrewing");
  const red = playerAt(3815, 2996);
  const blue = playerAt(3812, 2957);
  red.getInventory = () => ({ getAmount: () => 0, deleteNumber() {}, addItem() {}, refreshItems() {}, getFreeSlots: () => 28, contains: () => false });
  blue.getInventory = red.getInventory;
  const attributes = new Map();
  for (const player of [red, blue]) {
    player.getAttribute = (key) => attributes.get(key);
    player.setAttribute = (key, value) => attributes.set(key, value);
    player.moveTo = () => {};
    player.getPrivateArea = () => null;
  }

  const game = new Game.Game({ red: [red], blue: [blue] });
  const state = game.stateOf("red");
  state.hoppers = { bitternut: 1, sweetgrub: 1, water: 5, colour: 3, bark: 1 };
  state.boilers.forEach((boiler) => { boiler.logs = 3; boiler.lit = true; });
  assert.equal(game.canBrew("red"), true);

  game.tick();
  assert.equal(state.brewing, Common.BREW_TICKS);
  for (let i = 0; i < Common.BREW_TICKS; i++) game.tick();
  assert.ok(state.bottle, "a bottle rolls onto the conveyor");
  assert.equal(state.hoppers.bitternut, 0, "the batch used its ingredients");

  game.addContribution(red, 1);
  assert.equal(game.collect(red), true);
  assert.equal(state.score, 1);
  assert.equal(state.bottle, null);

  game.elapsed = Common.GAME_TICKS;
  game.tick();
  assert.ok(attributes.get(Common.PIECES_ATTRIBUTE) >= 10, "pieces of eight are saved");
  assert.equal(completed.length, 2, "both team members get the completion event");
  assert.equal(completed[0].winner, "red");
});
