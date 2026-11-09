// Run after `yarn build`: node --test tests/sorceress-garden-rocky-native.test.cjs
//
// A sq'irk pick rolls Rocky (Wiki: Sq'irk tree 10,339). With a follower out and one free slot, a winning roll puts Rocky
// in the last slot and the fruit goes to the owner's floor rather than vanishing. Real plugins (Pets, the Sorceress's
// Garden), a real Player and Inventory.
const assert = require("node:assert/strict");
const path = require("node:path");
const { test, before } = require("node:test");
process.env.DISABLE_PLAYER_BOTS = "1";
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const Maze = require("../plugins/minigames/sorceressgarden/Maze.SorceresssGarden");

const WINTER_TREE = 13407;
const WINTER_FRUIT = 10847;
let core;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
});

test("one free slot, a follower out: Rocky takes the slot and the sq'irk lands on the owner's floor", (t) => {
  const player = new Player(null);
  player.setUsername("rockysqirk");
  const sender = new Proxy({}, { get: () => () => sender });
  player.getPacketSender = () => sender;
  player.sendMessage = () => {};
  player.moveTo = () => {};
  player.setLocation(new core.Location(2908, 5470, 0));
  player.getSkillManager().setMaxLevel(core.Skill.THIEVING, 99).setCurrentLevel(core.Skill.THIEVING, 99);
  player.setAttribute("pets:current", { isRegistered: () => true, getId: () => -1 });
  const inventory = player.getInventory();
  for (let i = 0; i < inventory.capacity() - 1; i++) inventory.add(new core.Item(core.ItemIdentifiers.SPADE, 1), false);
  const floor = [];
  t.mock.method(core.ItemOnGroundManager, "registers", (who, item) => { floor.push([who, item.getId()]); });
  t.mock.method(Math, "random", () => 0);
  Maze._test.pickFruit({ player, objectId: WINTER_TREE });
  assert.equal(inventory.getAmount(core.ItemIdentifiers.ROCKY), 1, "Rocky in the last slot");
  assert.equal(inventory.getAmount(WINTER_FRUIT), 0);
  assert.deepEqual(floor, [[player, WINTER_FRUIT]], "the fruit on the owner's floor");
});
