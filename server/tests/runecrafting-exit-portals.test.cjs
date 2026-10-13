// Run after `yarn build`: node --test tests/runecrafting-exit-portals.test.cjs
// An altar's exit portal leads back outside its ruins, as rsprox captures show (docs/loc-teleports.md).
const assert = require("node:assert/strict");
const path = require("node:path");
const { test, before } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");

const { CacheDefinitions } = require("../dist/game/cache/CacheDefinitions");
const { ObjectDefinition } = require("../dist/game/definition/ObjectDefinition");
const { Equipment } = require("../dist/game/model/container/impl/Equipment");
const { Item } = require("../dist/game/model/Item");
const ruinsData = require("../plugins/skills/data/runecrafting-ruins.json");
const handlers = {};

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  ObjectDefinition.init();
  const realApi = PluginManager.createApi("RunecraftingTest");
  const base = {
    ...realApi,
    onPlayerLogin: (handler) => (handlers.login = handler),
    core: PluginManager.getCoreApi(),
    onObjectInteraction: (name, actions) => {
      Object.entries(actions).forEach(([option, handler]) => (handlers[`${name}:${option}`] = handler));
      realApi.onObjectInteraction(name, actions);
    },
    onNpcInteraction: (name, actions) => Object.entries(actions).forEach(([option, handler]) => (handlers[`${name}:${option}`] = handler)),
    // The mine portal's teleport comes a tick later; here it runs at once.
    getTaskManager: () => ({ submit: (task) => task.execute() }),
  };
  const api = new Proxy(base, { get: (target, key) => (key in target ? target[key] : () => {}) });
  require("../plugins/skills/Runecrafting.plugin").register(api);
});

function visitor() {
  const log = [];
  return {
    log,
    moveTo: (location) => log.push(`move ${location.getX()},${location.getY()},${location.getZ()}`),
    sendMessage: (text) => log.push(`message ${text}`),
    getPacketSender: () => ({ sendSound: (id) => log.push(`sound ${id}`) }),
  };
}

test("each altar's exit portal leads outside its ruins, with the portal's sound and message", () => {
  // Captured: earth, fire, water, nature and cosmic; the rest from the ruins' tiles.
  const exits = { 34751: [3302, 3477], 34752: [3310, 3252], 34750: [3182, 3162], 34756: [2865, 3022], 34754: [2405, 4381],
    34748: [2983, 3288], 34749: [2980, 3511], 34753: [3050, 3442], 34755: [2858, 3378], 34757: [3060, 3585], 34758: [1863, 4639] };
  for (const [objectId, [x, y]] of Object.entries(exits)) {
    const player = visitor();
    assert.equal(handlers["Portal:Use"]({ player, objectId: Number(objectId) }), true);
    assert.deepEqual(player.log, [`move ${x},${y},0`, "sound 200", "message You step through the portal..."], objectId);
  }
  assert.equal(handlers["Portal:Use"]({ player: visitor(), objectId: 12345 }), false, "other portals fall through");
});

function miner({ x = 2889, y = 4814, attributes = {} } = {}) {
  const log = [];
  const attrs = new Map(Object.entries(attributes));
  const { Location } = PluginManager.getCoreApi();
  return {
    log,
    getAttribute: (key) => attrs.get(key),
    setAttribute: (key, value) => attrs.set(key, value),
    getLocation: () => new Location(x, y, 0),
    getMovementQueue: () => ({ reset() {} }),
    moveTo: (location) => log.push(`move ${location.getX()},${location.getY()},${location.getZ()}`),
    sendMessage: (text) => log.push(`message ${text}`),
    performGraphic: (graphic) => log.push(`graphic ${graphic.getId()}`),
    getPacketSender: () => ({
      sendSound: (id) => log.push(`sound ${id}`),
      sendProjectile: (_from, _to, _offset, _speed, id) => log.push(`projectile ${id}`),
    }),
  };
}

test("the Rune Essence mine's portals send the player back to the wizard who sent them", () => {
  // Aubury's Teleport records where the player stood (Rune Mysteries complete).
  const visitor = miner({ x: 3253, y: 3402, attributes: { "quest.rune_mysteries.stage": 6 } });
  assert.equal(handlers["Aubury:Teleport"]({ player: visitor }), true);
  assert.deepEqual(visitor.getAttribute("runecrafting:essence-mine-return"), [3253, 3402, 0]);

  const player = miner({ attributes: { "runecrafting:essence-mine-return": [2591, 3086, 0] } });
  assert.equal(handlers["Portal:Use"]({ player, objectId: 34825, location: { x: 2889, y: 4813, z: 0 } }), true);
  assert.deepEqual(player.log, [
    "message You step through the portal...", "projectile 109", "graphic 110", "move 2591,3086,0", "sound 200",
  ], "as captured: message and the portal's Curse, then the teleport and sound");

  const unknown = miner();
  handlers["Portal:Use"]({ player: unknown, objectId: 34825, location: { x: 2933, y: 4815, z: 0 } });
  assert.ok(unknown.log.includes("move 3252,3400,0"), "nobody recorded: back beside Aubury");
});

// Wiki: talismans are used on ruins; a matching worn tiara reveals the Enter option.
function runecrafter(headId = -1) {
  const player = visitor();
  const bits = new Map();
  const equipment = new Equipment(player);
  equipment.setItem(Equipment.HEAD_SLOT, new Item(headId, headId === -1 ? 0 : 1));
  player.getEquipment = () => equipment;
  player.getPacketSender = () => ({
    getVarbit: (id) => bits.get(id) ?? 0,
    sendVarbit: (id, value) => { bits.set(id, value); player.log.push(`varbit ${id} ${value}`); },
    sendSound: (id) => player.log.push(`sound ${id}`),
    sendItemContainer() {},
  });
  return player;
}

function useOnRuins(player, objectId, itemId) {
  return PluginManager.emitItemOnObject({
    player, objectId, itemId, handled: false,
    object: { getDefinition: () => ObjectDefinition.forId(objectId) },
  });
}

const entrances = {
  Air: [2841, 4829, 0], Mind: [2793, 4828, 0], Water: [2720, 4831, 0],
  Earth: [2655, 4830, 0], Fire: [2576, 4846, 0], Body: [2522, 4833, 0],
  Cosmic: [2162, 4833, 0], Law: [2464, 4818, 0], Nature: [2400, 4835, 0],
  Chaos: [2281, 4837, 0], Death: [2208, 4830, 0], Blood: [3239, 4832, 0], Wrath: [2335, 4826, 0],
};

test("all altar entrances use matching talismans on base and transformed cache locs", () => {
  for (const ruins of ruinsData) {
    const definition = CacheDefinitions.getObject(ruins.ruinsId);
    assert.equal(CacheDefinitions.getItem(ruins.talismanId).name, `${ruins.name} talisman`);
    assert.equal(CacheDefinitions.getItem(ruins.tiaraId).name, `${ruins.name} tiara`);
    assert.ok(definition.transformVarbit >= 0, ruins.name);
    for (const id of [ruins.ruinsId, ...definition.transforms.filter((id) => id !== -1)]) {
      const player = runecrafter();
      assert.equal(useOnRuins(player, id, ruins.talismanId), true, `${ruins.name} ${id}`);
      assert.deepEqual(player.log, [`move ${entrances[ruins.name].join(",")}`, "sound 200", "message You feel a powerful force take hold of you..."]);
    }
    const player = runecrafter();
    const wrong = ruins.name === "Air" ? 1448 : 1438;
    assert.equal(useOnRuins(player, ruins.ruinsId, wrong), false, "wrong talisman");
    assert.equal(useOnRuins(player, ruins.ruinsId, CacheDefinitions.getItem(ruins.talismanId).note), false, "noted talisman");
    assert.equal(useOnRuins(player, ruins.ruinsId, ruins.tiaraId), false, "inventory tiara");
    assert.deepEqual(player.log, []);
  }
  assert.equal(useOnRuins(runecrafter(), 12345, 1438), false, "unrelated object");
});

test("tiaras reveal Enter on login, reset on removal, and are checked by the entry handler", () => {
  for (const ruins of ruinsData) {
    const player = runecrafter(ruins.tiaraId);
    const definition = CacheDefinitions.getObject(ruins.ruinsId);
    const sender = player.getPacketSender();
    handlers.login({ player });
    assert.equal(sender.getVarbit(definition.transformVarbit), 1);
    assert.equal(ObjectDefinition.forPlayer(ruins.ruinsId, player).getInteractions()[0], "Enter");
    player.log.length = 0;
    assert.equal(PluginManager.emitObjectInteraction({ player, object: { getDefinition: () => ObjectDefinition.forId(ruins.ruinsId) }, objectId: ruins.ruinsId, definition: ObjectDefinition.forPlayer(ruins.ruinsId, player), clickType: 1, handled: false }), true);
    assert.ok(player.log.includes(`move ${entrances[ruins.name].join(",")}`));
    player.getEquipment().setItem(Equipment.HEAD_SLOT, new Item(-1, 0)).refreshItems();
    assert.equal(sender.getVarbit(definition.transformVarbit), 0);
    assert.equal(ObjectDefinition.forPlayer(ruins.ruinsId, player).getInteractions(), null);
    player.log.length = 0;
    assert.equal(handlers["Mysterious ruins:Enter"]({ player, objectId: ruins.ruinsId }), false);
    assert.deepEqual(player.log, []);
  }
  const player = runecrafter(5527);
  player.getEquipment().refreshItems();
  assert.equal(player.getPacketSender().getVarbit(607), 1);
  player.getEquipment().setItem(Equipment.HEAD_SLOT, new Item(5529, 1)).refreshItems();
  assert.equal(player.getPacketSender().getVarbit(607), 0, "replacing a tiara clears its old option");
  assert.equal(player.getPacketSender().getVarbit(608), 1);
  player.log.length = 0;
  player.getEquipment().refreshItems();
  assert.deepEqual(player.log, [], "unchanged equipment sends no duplicate varbits");
  assert.equal(handlers["Mysterious ruins:Enter"]({ player, objectId: 34813 }), false, "wrong worn tiara");
});

test("elemental and catalytic talismans and tiaras only admit their own altar group", () => {
  for (const ruins of ruinsData) {
    const talismanId = ruins.elemental ? 5516 : 26798;
    const tiaraId = ruins.elemental ? 26804 : 26801;
    assert.equal(useOnRuins(runecrafter(), ruins.ruinsId, talismanId), true, ruins.name);
    assert.equal(useOnRuins(runecrafter(), ruins.ruinsId, ruins.elemental ? 26798 : 5516), false, ruins.name);
    const player = runecrafter(tiaraId);
    player.getEquipment().refreshItems();
    assert.equal(player.getPacketSender().getVarbit(CacheDefinitions.getObject(ruins.ruinsId).transformVarbit), 1);
    assert.equal(handlers["Mysterious ruins:Enter"]({ player, objectId: ruins.ruinsId }), true);
    assert.equal(handlers["Mysterious ruins:Enter"]({ player: runecrafter(ruins.elemental ? 26801 : 26804), objectId: ruins.ruinsId }), false);
  }
});

test("altar entry lands beside the portal on a walkable cache tile", () => {
  const { RegionManager, Location } = PluginManager.getCoreApi();
  RegionManager.init();
  for (const [name, [x, y, z]] of Object.entries(entrances)) {
    RegionManager.loadMapFiles(x, y, false);
    assert.equal(RegionManager.blocked(new Location(x, y, z), null), false, name);
  }
});
