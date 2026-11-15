// Run after yarn build: node --test tests/cooking-giant-seaweed.test.cjs
// Wiki (Giant seaweed, Soda ash): one giant seaweed on a fire or range makes 6 soda ash, or 1 on a fail;
// 0 XP; the success chart is 0/500 (no fails from 51 Cooking, even on a fire).
const assert = require("node:assert/strict");
const { before, test } = require("node:test");
const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { Item } = require("../dist/game/model/Item");
const CookingCommon = require("../plugins/skills/cooking/Common.Cooking");
const Cooking = require("../plugins/skills/cooking/Cookers.Cooking");

const core = PluginManager.getCoreApi();
let burn = false;
let GIANT_SEAWEED, SODA_ASH;

before(async () => {
  await CachePipeline.initialize(process.cwd());
  GIANT_SEAWEED = core.CacheDefinitions.getObjId("giant_seaweed");
  SODA_ASH = core.CacheDefinitions.getObjId("soda_ash");
  CookingCommon.init({ core, emitCustomEvent(name, payload) {
    if (name === "cooking:burn") payload.burn = burn;
  } });
});

function cook(level, { seaweed = 1, filler = 0, burnt = false } = {}) {
  const player = new Player(null);
  player.getSession = () => ({ sendClientPacket() {}, write() {} });
  const messages = [];
  player.sendMessage = (message) => messages.push(message);
  player.getPacketSender().sendTypedMessage = (_type, message) => messages.push(message);
  player.getSkillManager().setMaxLevel(core.Skill.COOKING, level, false).setCurrentLevel(core.Skill.COOKING, level, false);
  const inventory = player.getInventory();
  inventory.resetItems();
  inventory.add(new Item(GIANT_SEAWEED, seaweed), false);
  for (let i = 0; i < filler; i++) inventory.add(new Item(core.ItemIdentifiers.RAKE, 1), false);
  const cookable = Cooking._test.cookableFor(GIANT_SEAWEED);
  assert.ok(cookable, "giant seaweed is cookable");
  burn = burnt;
  const xp = player.getSkillManager().getExperience(core.Skill.COOKING);
  const result = Cooking._test.cookOne(player, { cookable, objectId: -1, cooker: "fire", location: new core.Location(3222, 3218, 0) });
  return { player, inventory, result, messages, xp, cookable };
}

test("a giant seaweed cooks into six soda ash, for no Cooking XP", () => {
  const f = cook(51);
  assert.equal(f.inventory.getAmount(GIANT_SEAWEED), 0);
  assert.equal(f.inventory.getAmount(SODA_ASH), 6);
  assert.equal(f.player.getSkillManager().getExperience(core.Skill.COOKING), f.xp);
  // rsprox_transcripts/227/910295.txt (tick 35023): seaweed on a fire, type=spam.
  assert.deepEqual(f.messages, ["You burn the weed to soda ash."]);
});

test("a failed giant seaweed leaves one soda ash", () => {
  const f = cook(1, { burnt: true });
  assert.equal(f.inventory.getAmount(GIANT_SEAWEED), 0);
  assert.equal(f.inventory.getAmount(SODA_ASH), 1);
});

test("from 51 Cooking giant seaweed never fails, even on a fire; below it, it can", () => {
  const cookable = Cooking._test.cookableFor(GIANT_SEAWEED);
  const at = (level) => {
    const player = new Player(null);
    player.getSession = () => ({ sendClientPacket() {}, write() {} });
    player.getSkillManager().setMaxLevel(core.Skill.COOKING, level, false).setCurrentLevel(core.Skill.COOKING, level, false);
    return Cooking._test.successChance(player, cookable, -1, "fire", new core.Location(3222, 3218, 0));
  };
  assert.equal(at(51), 1);
  assert.ok(at(50) < 1);
  assert.ok(at(1) < 0.01);
});

test("without room for the six soda ash nothing is used", () => {
  // 28 slots: the seaweed plus 23 rakes leaves 4 free, and the seaweed's own slot makes 5: one short.
  const f = cook(99, { filler: 23 });
  assert.equal(f.result, false);
  assert.equal(f.inventory.getAmount(GIANT_SEAWEED), 1);
  assert.equal(f.inventory.getAmount(SODA_ASH), 0);
  // One more free slot is enough.
  const g = cook(99, { filler: 22 });
  assert.equal(g.inventory.getAmount(SODA_ASH), 6);
  assert.equal(g.inventory.getFreeSlots(), 0);
});

test("ordinary seaweed still makes one soda ash", () => {
  const player = new Player(null);
  player.getSession = () => ({ sendClientPacket() {}, write() {} });
  player.getSkillManager().setMaxLevel(core.Skill.COOKING, 1, false).setCurrentLevel(core.Skill.COOKING, 1, false);
  player.getInventory().resetItems();
  player.getInventory().add(new Item(core.ItemIdentifiers.SEAWEED, 1), false);
  const messages = [];
  player.getPacketSender().sendTypedMessage = (_type, message) => messages.push(message);
  burn = false;
  Cooking._test.cookOne(player, { cookable: Cooking._test.cookableFor(core.ItemIdentifiers.SEAWEED), objectId: -1, cooker: "fire",
    location: new core.Location(3222, 3218, 0) });
  assert.equal(player.getInventory().getAmount(SODA_ASH), 1);
  assert.deepEqual(messages, ["You burn the weed to soda ash."]);
});
