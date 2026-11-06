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

  // Wiki: the Snelm must be made outside Mort Myre Swamp; the Guthix mix counts on any floor.
  emitted.length = 0;
  t.snelm({ player: playerAt(3440, 3400), skill: core.Skill.CRAFTING, kind: "snelms" });
  assert.equal(emitted.includes(t.TASKS.snelm), false, "no Snelm task inside the swamp");
  // Canifis bank booth, Canifis square and the tile north of the swamp gate are outside it.
  for (const [x, y] of [[3512, 3479], [3494, 3475], [3444, 3459]]) {
    emitted.length = 0;
    t.snelm({ player: playerAt(x, y), skill: core.Skill.CRAFTING, kind: "snelms" });
    assert.ok(emitted.includes(t.TASKS.snelm), `Snelm at (${x}, ${y}) counts`);
  }
  t.guthixBalance({ player: playerAt(3495, 3490, 1), itemId: 7660 });
  assert.ok(emitted.includes(t.TASKS.guthixBalance), "upstairs in Morytania counts");
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


test("Trouble Brewing: a burning boiler cannot be relit for repeat experience and stores start stocked", () => {
  const Common = require("../plugins/minigames/troublebrewing/Common.TroubleBrewing");
  Common.init(fakeApi(bus()));
  const { Game } = require("../plugins/minigames/troublebrewing/Game.TroubleBrewing");
  const player = playerAt(3815, 2996);
  let xp = 0;
  player.getSkillManager = () => ({ addExperiences: (_skill, amount) => { xp += amount; } });
  const game = new Game({ red: [player], blue: [] });
  assert.equal(game.stateOf("red").storeLogs, Common.STORE_LOGS);
  game.addLog(player, 0);
  game.lightBoiler(player, 0);
  game.lightBoiler(player, 0);
  assert.equal(xp, 100, "only the unlit-to-lit transition awards experience");
});

test("Trouble Brewing: each lit boiler burns its own first log 100 ticks after it is lit", () => {
  const Common = require("../plugins/minigames/troublebrewing/Common.TroubleBrewing");
  Common.init(fakeApi(bus()));
  const { Game } = require("../plugins/minigames/troublebrewing/Game.TroubleBrewing");
  const player = playerAt(3815, 2996);
  const game = new Game({ red: [player], blue: [] });
  const state = game.stateOf("red");
  for (let i = 0; i < 3; i++) game.addLog(player, 0);
  game.lightBoiler(player, 0);
  for (let i = 0; i < 37; i++) game.tick();
  for (let i = 0; i < 3; i++) game.addLog(player, 1);
  game.lightBoiler(player, 1);
  for (let i = 0; i < 63; i++) game.tick();
  assert.equal(state.boilers[0].logs, 2, "the first boiler burns its own first log at 100 ticks");
  assert.equal(state.boilers[1].logs, 3, "a boiler lit later is not caught by the global elapsed phase");
  for (let i = 0; i < 37; i++) game.tick();
  assert.equal(state.boilers[1].logs, 2, "the later boiler burns after its own 100 ticks");
});

test("Trouble Brewing: lobby refusals are the cache condition and transcript lines", () => {
  const events = bus();
  let questDone = false;
  events.on("quest:is-complete", (request) => { request.complete = questDone; });
  const Common = require("../plugins/minigames/troublebrewing/Common.TroubleBrewing");
  Common.init(fakeApi(events));
  const Lobby = require("../plugins/minigames/troublebrewing/Lobby.TroubleBrewing");
  const player = playerAt(3815, 2996);
  assert.equal(Lobby.refusal(player, "San Fan"),
    "You must have completed Cabin Fever and got a Cooking level of 40 to play Trouble Brewing.");
  questDone = true;
  player.getInventory().addItem(new core.Item(core.ItemIdentifiers.LOGS, 1));
  assert.equal(Lobby.refusal(player, "San Fan"), "Hah, think that I'm going to assign you the easy tasks eh?");
  assert.equal(Lobby.refusal(player, "Fancy Dan"),
    "Well, I'll be glad to have you aboard, but you will need to go and store all of your gear first.");
  assert.equal(Lobby.refusal(player, "Honest Jimmy"), "Might want to dump that stuff yer holdin'.");
  player.getEquipment = () => ({ get: () => ({ getId: () => 1 }) });
  assert.equal(Lobby.refusal(player, "Fancy Dan"),
    "However, I don't let anyone on the team if they are wearing a hat or a helmet.");
});

test("Trouble Brewing: logging out returns arena and waiting-room players before saving", () => {
  const Common = require("../plugins/minigames/troublebrewing/Common.TroubleBrewing");
  const Game = require("../plugins/minigames/troublebrewing/Game.TroubleBrewing");
  const Lobby = require("../plugins/minigames/troublebrewing/Lobby.TroubleBrewing");
  const hooks = [];
  const api = fakeApi(bus(), { onPlayerLogout: (handler) => hooks.push(handler) });
  Common.init(api);
  const player = playerAt(3815, 2996);
  const game = Game.startNew({ red: [player], blue: [] });
  const arena = require("../plugins/minigames/troublebrewing/Areas.TroubleBrewing").createArena();
  arena.postLeave(player, true);
  assert.equal(Game.gameOf(player), null);
  assert.equal(Common.key(player.getLocation()), Common.LOBBY_RETURN.join(","));
  game.finish();
  Lobby.attachLobby(api);
  player.setLocation(Common.toLocation(Common.WAITING.red.spawn));
  Lobby.queues.red.add(player);
  hooks[0]({ player });
  assert.equal(Lobby.inQueue(player), false);
  assert.equal(Common.key(player.getLocation()), Common.LOBBY_RETURN.join(","));
});
