// Run after `yarn build`: node --test tests/motherlode-rock-golem-native.test.cjs
//
// Pay-dirt rolls the Rock golem (Wiki: Motherlode Mine 247,200). With one free slot and a follower out, a winning roll
// puts the golem in the last slot, and the pay-dirt goes to the floor rather than vanishing. Real plugins (Pets,
// Motherlode Mine), a real Player and Inventory.
const assert = require("node:assert/strict");
const path = require("node:path");
const { test, before } = require("node:test");
process.env.DISABLE_PLAYER_BOTS = "1";
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const Veins = require("../plugins/areas/motherlode/Veins.MotherlodeMine");
const Mine = require("../plugins/areas/motherlode/State.MotherlodeMine");

let core;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
});

test("one free slot, a follower out: the golem takes the slot and the pay-dirt lands on the floor", (t) => {
  const player = new Player(null);
  player.setUsername("golemtest");
  const sender = new Proxy({}, { get: () => () => sender });
  player.getPacketSender = () => sender;
  player.sendMessage = () => {};
  player.setLocation(new core.Location(3760, 5660, 0));
  player.getSkillManager().setMaxLevel(core.Skill.MINING, 99).setCurrentLevel(core.Skill.MINING, 99);
  player.setAttribute("pets:current", { isRegistered: () => true, getId: () => -1 });
  const inventory = player.getInventory();
  for (let i = 0; i < inventory.capacity() - 1; i++) inventory.add(new core.Item(core.ItemIdentifiers.SPADE, 1), false);
  assert.equal(inventory.getFreeSlots(), 1);
  const floor = [];
  t.mock.method(core.ItemOnGroundManager, "registers", (who, item) => { floor.push(item.getId()); });
  t.mock.method(Math, "random", () => 0);
  Veins._test.awardPayDirt(player, { depletesAt: 0, upper: false }, 0);
  const golem = core.CacheDefinitions.getObjId("skillpetmining");
  assert.equal(inventory.getAmount(golem), 1, "the golem in the last slot");
  assert.equal(inventory.getAmount(Mine.PAY_DIRT), 0);
  assert.deepEqual(floor, [Mine.PAY_DIRT], "the pay-dirt on the floor");
});
