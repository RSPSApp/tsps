"use strict";

// The strange devices (beginner_device, master_device) answer Feel with live OSRS's exact game
// messages, which RuneLite's hot/cold solver parses (HotColdTemperature: "The device is " then the
// temperature; HotColdTemperatureChange: ", and warmer than" / ", but colder than" / ", and the same
// temperature as" ... " last time."). Lines from rsprox 235/1043, 236/3931 and 227/1862.
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
CachePipeline.initialize();
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const core = PluginManager.getCoreApi();
const BeginnerPlugin = require("../plugins/treasuretrails/BeginnerTreasureTrails.plugin");
const Beginner = require("../plugins/treasuretrails/beginner/Runtime.BeginnerTreasureTrails");
const TrailsPlugin = require("../plugins/treasuretrails/TreasureTrails.plugin");
const Runtime = require("../plugins/treasuretrails/trails/Runtime.TreasureTrails");
const { byName } = require("../plugins/treasuretrails/trails/Tiers.TreasureTrails");
const MASTER = byName.get("master");
const C = core.CacheDefinitions;

// RuneLite 1.13.6 HotColdTemperature.getFromTemperatureSet and HotColdTemperatureChange.of, as the
// ported client plugin reads a game message.
const TEMPERATURES = ["ice cold", "very cold", "cold", "warm", "hot", "very hot", "incredibly hot", "visibly shaking"];
const CHANGES = { WARMER: "and warmer than", SAME: "and the same temperature as", COLDER: "but colder than" };
function runeLiteReads(message) {
  if (!message.startsWith("The device is ")) return null;
  const start = message.split(",")[0];
  const temperature = TEMPERATURES.filter(text => start.includes(text)).sort((a, b) => b.length - a.length)[0] ?? null;
  const change = message.endsWith(" last time.") ? Object.keys(CHANGES).find(key => message.includes(CHANGES[key])) ?? null : null;
  return { temperature, change };
}

/** Registers the plugin, keeping its item action handlers; the other hooks it attaches are no-ops, anything else throws. */
function attach(plugin) {
  const actions = new Map();
  const api = { core, persistAttribute() {}, onItemAction: (name, handlers) => actions.set(name, { ...actions.get(name), ...handlers }) };
  for (const hook of ["onBeforeNpcInteraction", "onItemOnNpc", "onBeforeObjectInteraction", "onCanUseItem", "onInterfaceActionButton", "onCustomEvent",
    "onPlayerLogout", "onPlayerDisconnect", "onPlayerLogin", "onPlayerDeath", "onNpcDeath"]) api[hook] = () => {};
  plugin.register(new Proxy(api, { get: (target, key) => { if (key in target) return target[key]; throw new Error(`unexpected api.${String(key)}`); } }));
  return actions;
}

/** A real player with a real inventory; only the network is stubbed. */
function login() {
  const player = new Player(null);
  player.setUsername("Tester");
  const messages = [];
  const sender = new Proxy({}, { get: () => () => sender });
  player.getPacketSender = () => sender;
  player.sendMessage = text => messages.push(text);
  return Object.assign(player, { messages });
}

const at = (player, target, dx) => player.setLocation(new core.Location(target.x + dx, target.y, target.z));

// Walking a reading sequence: first feel, then warmer, same, colder, then on the dig spot.
const WALK = [
  [120, "The device is warm.", "WARM", null],
  [60, "The device is very hot, and warmer than last time.", "VERY_HOT", "WARMER"],
  [60, "The device is very hot, and the same temperature as last time.", "VERY_HOT", "SAME"],
  [600, "The device is ice cold, but colder than last time.", "ICE_COLD", "COLDER"],
  [2, "The device is visibly shaking and burns to the touch. This must be the spot.", "VISIBLY_SHAKING", null],
];
const word = key => key.toLowerCase().replace("_", " ");

test("the beginner strange device sends live OSRS's readings, which RuneLite's hot/cold solver reads", () => {
  const feel = attach(BeginnerPlugin).get("Strange device").Feel;
  const player = login();
  const scroll = player.getInventory().setItem(0, new core.Item(Beginner.data().scroll, 1)).getItems()[0];
  const step = Beginner.data().steps.find(entry => entry.kind === "hotcold");
  const target = Beginner.data().hotcold[0];
  scroll.setMetaValue(Beginner.TRAIL_META, { ...Beginner.stateOf(scroll), row: step.row, completed: 0, task: null, hotcold: target.row, previous: null });
  const device = new core.Item(C.getObjId("beginner_device"), 1);
  player.getInventory().setItem(1, device);
  const event = { player, slot: 1, item: device, itemId: device.getId() };
  for (const [dx, said, temperature, change] of WALK) {
    player.messages.length = 0;
    at(player, target.location, dx);
    assert.equal(feel(event), true);
    assert.deepEqual(player.messages, [said]);
    assert.deepEqual(runeLiteReads(said), { temperature: word(temperature), change });
  }
  assert.equal(scroll.getMetaValue(Beginner.TRAIL_META).previous, 2, "the last distance is kept on the clue");
});

test("the master strange device sends the same readings before it hurts", () => {
  const feel = attach(TrailsPlugin).get("Strange device").Feel;
  const player = login();
  const jorral = Runtime.data(MASTER).steps.find(entry => entry.key === "cluehelper_cryptic_master_jorral");
  const target = Runtime.data(MASTER).hotcold[0];
  const scroll = new core.Item(jorral.itemId, 1).setMetaValue(Runtime.metaKey(MASTER),
    { version: 1, token: "master-device", revision: 0, completed: 1, length: 7, row: jorral.row, hotcold: target.row, previous: null });
  player.getInventory().setItem(0, scroll);
  const device = new core.Item(C.getObjId("master_device"), 1);
  player.getInventory().setItem(1, device);
  const event = { player, slot: 1, item: device, itemId: device.getId() };
  for (const [dx, said, temperature, change] of WALK) {
    player.messages.length = 0;
    at(player, target.location, dx);
    assert.equal(feel(event), true);
    assert.deepEqual(player.messages, [said, "The power of the strange device hurts you in the process."]);
    assert.deepEqual(runeLiteReads(said), { temperature: word(temperature), change });
  }
});
