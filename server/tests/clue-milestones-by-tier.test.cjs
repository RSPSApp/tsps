const assert = require("node:assert/strict");
const {test} = require("node:test");
const {Server} = require("../dist/Server");
Server.installProductionPathResolver();
require("../dist/game/cache/CachePipeline").CachePipeline.initialize();
const core = require("../dist/plugins/PluginManager").PluginManager.getCoreApi();
const {Inventory} = require("../dist/game/model/container/impl/Inventory");
const TABLES = {...require("../data/definitions/clue-caskets.json").tables, beginner: require("../data/definitions/reward-caskets.json").beginner};

// Both milestone services registered in the game's load order (BeginnerTreasureTrails sorts first).
function fixture() {
  const events = new Map(), attributes = new Map();
  const banks = Array.from({length: core.Bank.TOTAL_BANK_TABS}, () => []);
  const sender = new Proxy({}, {get: () => () => {}});
  const player = {getAttribute: key => attributes.get(key), setAttribute: (key, value) => attributes.set(key, value),
    getPacketSender: () => sender, sendMessage() {}, getBank: tab => ({getItems: () => banks[tab]}), getUsername: () => "MilestoneTier"};
  const inventory = new Inventory(player);
  player.getInventory = () => inventory;
  const api = {core, persistAttribute() {}, onPlayerLogin() {}, onItemAction() {}, onGroundItemPickup() {},
    onNpcDialogueCondition() {}, onPlayerLogout() {}, onObjectAction() {}, onNpcAction() {}, onItemOnItem() {},
    onInterfaceActionButton() {}, onButtonClick() {}, onLogin() {}, onNpcDeath() {}, onCommand() {},
    onCustomEvent(name, fn) { if (!events.has(name)) events.set(name, []); events.get(name).push(fn); },
    emitCustomEvent(name, request) { for (const fn of events.get(name) ?? []) fn(request); }};
  api.onCustomEvent("quest:is-complete", request => { if (request.key === "x_marks_the_spot") request.complete = true; });
  for (const plugin of ["BeginnerTreasureTrails.plugin", "ClueCapacity.plugin"]) {
    const loaded = require(`../plugins/treasuretrails/${plugin}`);
    loaded.register(new Proxy(api, {get: (target, key) => key in target ? target[key] : () => {}}));
  }
  const milestones = (tier, completed) => {
    const request = {player, tier, completed, milestones: TABLES[tier].milestones, drops: [], handled: false, error: null};
    api.emitCustomEvent("treasure-trails:milestone-rewards", request);
    return request;
  };
  return {player, attributes, milestones};
}

test("a later casket past an item milestone does not pay that item again", () => {
  const f = fixture();
  for (const [tier, name] of [["easy", "Large spade"], ["medium", "Clueless scroll"]]) {
    const row = TABLES[tier].milestones.find(entry => entry.name === name);
    const result = f.milestones(tier, row.completed + 1);
    assert.equal(result.handled, true);
    assert.equal(result.drops.some(drop => drop.itemId === row.item_id), false, `${tier} ${name}`);
  }
});

test("each tier's scroll cases still recover by that tier's own consumed attribute", () => {
  const f = fixture();
  f.attributes.set("treasure-trails:beginner-major-case", true);
  const cases = TABLES.medium.milestones.filter(row => /scroll case/i.test(row.name));
  assert.ok(cases.length > 0);
  const top = Math.max(...cases.map(row => row.completed));
  const ids = f.milestones("medium", top).drops.map(drop => drop.itemId);
  for (const row of cases) assert.ok(ids.includes(row.item_id), row.name);
  const beginner = f.milestones("beginner", 1000).drops.map(drop => drop.itemId);
  assert.equal(beginner.includes(core.ItemIdentifiers.MAJOR_BEGINNER_SCROLL_CASE), false);
});
