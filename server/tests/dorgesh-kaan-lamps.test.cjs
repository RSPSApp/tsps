const assert = require("node:assert/strict");
const { before, test } = require("node:test");
const path = require("node:path");
const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { MapObjects } = require("../dist/game/entity/impl/object/MapObjects");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { AreaManager } = require("../dist/game/model/areas/AreaManager");
const Lamps = require("../plugins/areas/DorgeshKaanLamps.plugin");
const LAMP_TILES = require("../plugins/areas/data/dorgesh-kaan-lamps.json");

const core = PluginManager.getCoreApi();
const C = core.CacheDefinitions;
const I = core.ItemIdentifiers;
const { catalogue, varbitValue, BROKEN_ATTRIBUTE, FIXED_ATTRIBUTE, FIXED_EVENT, LAMPS_VARBIT } = Lamps._test;
const events = [];
let playerIndex = 28400;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  core.ObjectDefinition.init();
  core.RegionManager.init();
  const api = PluginManager.createApi("DorgeshKaanLampsTest");
  Lamps.register(api);
  require("../plugins/treasuretrails/TreasureTrails.plugin").register(api);
  api.onCustomEvent(FIXED_EVENT, event => events.push(event));
});

/** Ten broken lamps, the first two in the bank's part of the city (ground floor, north). */
function presetBroken() {
  const all = [...catalogue().values()];
  const north = all.filter(lamp => lamp.part === "0:north");
  return [...north.slice(0, 2), ...all.filter(lamp => lamp.part !== "0:north").slice(0, 8)].map(lamp => lamp.name);
}

function playerAt(t, x, y, z, { level = 52, orbs = 1, preset = true } = {}) {
  const { Player } = require("../dist/game/entity/impl/player/Player");
  const player = new Player(null, new core.Location(x, y, z));
  player.setIndex(playerIndex++);
  player.setUsername(`dk-lamps-${playerIndex}`);
  player.setRegistered(true);
  player.setNeedsPlacement(false);
  const session = new Proxy({}, { get: () => () => {} });
  player.getSession = () => session;
  const messages = [];
  player.sendMessage = message => { messages.push(message); };
  player.getPacketSender().sendTypedMessage = (type, message) => { messages.push(message); return player.getPacketSender(); };
  for (const skill of [core.Skill.FIREMAKING, core.Skill.CRAFTING]) player.getSkillManager().setCurrentLevel(skill, level, false);
  if (orbs) player.getInventory().add(new core.Item(I.LIGHT_ORB, orbs), false);
  if (preset) player.setAttribute(BROKEN_ATTRIBUTE, presetBroken());
  t.after(() => { player.setRegistered(false); core.TaskManager.cancelTasks(player.getIndex()); });
  AreaManager.process(player);
  return { player, messages };
}

const lampsVar = player => player.getPacketSender().getVarbit(C.getVarbitId(LAMPS_VARBIT));
const fixLamp = (player, lamp) => PluginManager.emitObjectInteraction({
  player, objectId: lamp.id, object: new core.GameObject(lamp.id, new core.Location(lamp.x, lamp.y, lamp.z), 10, 0),
  definition: core.ObjectDefinition.forPlayer(lamp.id, player), location: { x: lamp.x, y: lamp.y, z: lamp.z },
  clickType: 1, option: "Fix", handled: false,
});
const xp = (player, skill) => player.getSkillManager().getExperience(skill);

test("every lamp is the cache's dorgesh_lamp loc on its tile, and a part's lamps never share a bit", () => {
  assert.equal(Object.keys(LAMP_TILES).length, 64);
  for (const lamp of catalogue().values()) {
    core.RegionManager.loadMapFiles(lamp.x, lamp.y);
    assert.equal(lamp.id, C.getLocId(lamp.name));
    assert.ok(MapObjects.get(lamp.id, new core.Location(lamp.x, lamp.y, lamp.z), null), `${lamp.name} is on its tile`);
    assert.equal(core.ObjectDefinition.forId(C.getObject(lamp.id).transforms[1]).getName(), "Broken lamp");
  }
  const parts = new Map();
  for (const lamp of catalogue().values()) {
    const bits = parts.get(lamp.part) ?? new Set();
    assert.ok(!bits.has(lamp.bit), `${lamp.part} bit ${lamp.bit}`);
    parts.set(lamp.part, bits.add(lamp.bit));
  }
  assert.equal(parts.size, 6);
});

test("a player has ten broken lamps of their own; entering a part sends its lamps and the Fix option resolves", t => {
  const { player } = playerAt(t, 2702, 5349, 0, { preset: false });
  const brokenNames = player.getAttribute(BROKEN_ATTRIBUTE);
  assert.equal(brokenNames.length, 10);
  assert.equal(new Set(brokenNames).size, 10);
  assert.equal(lampsVar(player), varbitValue(brokenNames, "0:north"));
  for (const lamp of [...catalogue().values()].filter(entry => entry.part === "0:north")) {
    const name = core.ObjectDefinition.forPlayer(lamp.id, player).getName();
    assert.equal(name, brokenNames.includes(lamp.name) ? "Broken lamp" : "Lamp", lamp.name);
  }
  // Walking south re-sends the south half's lamps.
  player.setLocation(new core.Location(2702, 5300, 0));
  AreaManager.process(player);
  assert.equal(lampsVar(player), varbitValue(brokenNames, "0:south"));
});

test("Fix replaces the orb for 500 Firemaking and Crafting XP, breaks another lamp and tells the total", t => {
  const { player, messages } = playerAt(t, 2702, 5349, 0);
  const brokenNames = [...player.getAttribute(BROKEN_ATTRIBUTE)];
  const lamp = catalogue().get(brokenNames[0]);
  const before = [xp(player, core.Skill.FIREMAKING), xp(player, core.Skill.CRAFTING)];
  events.length = 0;
  assert.equal(fixLamp(player, lamp), true);
  assert.equal(player.getInventory().getAmount(I.LIGHT_ORB), 0);
  assert.deepEqual([xp(player, core.Skill.FIREMAKING) - before[0], xp(player, core.Skill.CRAFTING) - before[1]], [500, 500]);
  const after = player.getAttribute(BROKEN_ATTRIBUTE);
  assert.equal(after.length, 10);
  assert.ok(!after.includes(lamp.name), "the fixed lamp works now");
  assert.equal(player.getAttribute(FIXED_ATTRIBUTE), 1);
  assert.ok(messages.includes("You replace the orb. Total lights fixed: 1"));
  assert.equal(lampsVar(player), varbitValue(after, "0:north"));
  assert.deepEqual(events.map(event => [event.player, event.lamp]), [[player, lamp.name]]);
});

test("a working lamp, no orb, an empty orb or low levels change nothing", t => {
  const working = playerAt(t, 2702, 5349, 0);
  const lamp = [...catalogue().values()].find(entry => entry.part === "0:north" && !working.player.getAttribute(BROKEN_ATTRIBUTE).includes(entry.name));
  assert.equal(core.ObjectDefinition.forPlayer(lamp.id, working.player).getName(), "Lamp");
  fixLamp(working.player, lamp);
  assert.equal(working.player.getInventory().getAmount(I.LIGHT_ORB), 1);
  assert.equal(Lamps._test.fix(working.player, lamp.id), false, "a working lamp can't be fixed");

  const cases = [
    [{ orbs: 0 }, "Nothing interesting happens."],
    [{ orbs: 0, empty: true }, "You need to add a filament to that orb before you put it in."],
    [{ level: 51 }, "You need a Firemaking and Crafting level of 52 to fix this lamp."],
  ];
  for (const [options, message] of cases) {
    const { player, messages } = playerAt(t, 2702, 5349, 0, options);
    if (options.empty) player.getInventory().add(new core.Item(I.EMPTY_LIGHT_ORB, 1), false);
    const brokenNames = [...player.getAttribute(BROKEN_ATTRIBUTE)];
    assert.equal(fixLamp(player, catalogue().get(brokenNames[0])), true);
    assert.deepEqual(player.getAttribute(BROKEN_ATTRIBUTE), brokenNames);
    assert.equal(xp(player, core.Skill.FIREMAKING), 0);
    assert.equal(messages.at(-1), message);
  }
});

test("every 50th lamp gives 2,500 more of each, and a saved set survives with only real lamp names", t => {
  const { player, messages } = playerAt(t, 2702, 5349, 0);
  player.setAttribute(FIXED_ATTRIBUTE, 49);
  const before = xp(player, core.Skill.CRAFTING);
  fixLamp(player, catalogue().get(player.getAttribute(BROKEN_ATTRIBUTE)[0]));
  assert.equal(xp(player, core.Skill.CRAFTING) - before, 3000);
  assert.ok(messages.includes("<col=239929>You have fixed a batch of 50 lights and have gained some extra experience.</col>"));

  player.setAttribute(BROKEN_ATTRIBUTE, ["dorgesh_lamp_3", "not_a_lamp", "dorgesh_lamp_3", "dorgesh_lamp_3"]);
  const repaired = Lamps._test.broken(player);
  assert.equal(repaired.length, 10);
  assert.equal(new Set(repaired).size, 10, "a duplicated save still has ten different broken lamps");
  assert.ok(repaired.includes("dorgesh_lamp_3") && !repaired.includes("not_a_lamp"));
});

test("Using a light orb on the broken lamp fixes it the same way", t => {
  const { player } = playerAt(t, 2702, 5349, 0);
  const lamp = catalogue().get(player.getAttribute(BROKEN_ATTRIBUTE)[0]);
  const event = { player, itemId: I.LIGHT_ORB, slot: 0, objectId: lamp.id, object: new core.GameObject(lamp.id, new core.Location(lamp.x, lamp.y, lamp.z), 10, 0),
    location: new core.Location(lamp.x, lamp.y, lamp.z), handled: false };
  PluginManager.emitItemOnObject(event);
  assert.equal(event.handled, true);
  assert.equal(player.getAttribute(FIXED_ATTRIBUTE), 1);
  assert.equal(player.getInventory().getAmount(I.LIGHT_ORB), 0);
  assert.ok(!player.getAttribute(BROKEN_ATTRIBUTE).includes(lamp.name));
});

test("leaving the city clears the lamps from the shared varp", t => {
  const { player } = playerAt(t, 2702, 5349, 0);
  assert.notEqual(lampsVar(player), 0);
  player.setLocation(new core.Location(3222, 3218, 0));
  AreaManager.process(player);
  assert.equal(lampsVar(player), 0);
});

test("fixing a lamp with an elite Sherlock scroll for this task completes the challenge", t => {
  const Runtime = require("../plugins/treasuretrails/trails/Runtime.TreasureTrails");
  const elite = require("../plugins/treasuretrails/trails/Tiers.TreasureTrails").byName.get("elite");
  const data = Runtime.data(elite);
  const sherlock = data.steps.find(step => step.skill);
  const task = [...data.tasks.values()].find(entry => entry.text === "Fix a magical lamp in Dorgesh-Kaan.");
  assert.ok(data.supportedTasks.includes(task), "Sherlock can set the lamp task");
  const { player, messages } = playerAt(t, 2702, 5349, 0);
  const key = Runtime.metaKey(elite);
  const state = { version: 1, token: "dk-lamp", revision: 0, completed: 1, length: 5, row: sherlock.row };
  const inventory = player.getInventory();
  inventory.setItem(1, new core.Item(sherlock.itemId, 1).setMetaValue(key, state));
  inventory.setItem(2, new core.Item(sherlock.skill.itemId, 1).setMetaValue(key, { ...state, task: task.row, taskDone: false }));
  assert.equal(fixLamp(player, catalogue().get(player.getAttribute(BROKEN_ATTRIBUTE)[0])), true);
  assert.equal(inventory.getItems()[2].getMetaValue(key).taskDone, true);
  assert.ok(messages.includes("You have completed your elite/master level challenge!"));
});
