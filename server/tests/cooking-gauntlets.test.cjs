// Run after `yarn build`: node --test tests/cooking-gauntlets.test.cjs
const assert = require("node:assert/strict");
const { before, test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { Equipment } = require("../dist/game/model/container/impl/Equipment");
const { ItemIds } = require("../dist/util/IdEnums");
const { Skill } = require("../dist/game/model/Skill");

const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const Cooking = require("../plugins/skills/Cooking.plugin");

before(() => CachePipeline.initialize());

// The Skillcapes plugin answers this; a worn Cooking cape (or trimmed) is all these tests need.
Cooking._test.setApi({
  core: PluginManager.getCoreApi(),
  emitCustomEvent(name, request) {
    if (name !== "skillcape:has-perk" || request.skill !== "COOKING") return;
    const cape = request.player.getEquipment().getItems()[Equipment.CAPE_SLOT]?.getId();
    request.result = cape === ItemIds.COOKING_CAPE || cape === ItemIds.COOKING_CAPE_T_;
  },
});

function player(cooking, hands = 0, cape = 0) {
  const equipment = new Array(14).fill(null).map(() => ({ getId: () => 0 }));
  equipment[Equipment.HANDS_SLOT] = { getId: () => hands };
  equipment[Equipment.CAPE_SLOT] = { getId: () => cape };
  return {
    getEquipment: () => ({ getItems: () => equipment }),
    getSkillManager: () => ({ getCurrentLevel: () => cooking }),
  };
}

test("cooking gauntlets lower the burn level for the foods the Wiki lists", () => {
  const lobster = Cooking._test.COOKABLE_BY_RAW.get(ItemIds.RAW_LOBSTER);
  assert.equal(Cooking._test.stopBurnLevel(player(70), lobster), 74, "plain lobster stops burning at 74");
  assert.equal(Cooking._test.stopBurnLevel(player(70, ItemIds.COOKING_GAUNTLETS), lobster), 64);
  assert.equal(Cooking._test.isSuccess(player(70, ItemIds.COOKING_GAUNTLETS), lobster), true, "70 >= 64");
  // Wiki (Cooking/Burn level): with gauntlets on a fire or range shark stops at 94 and anglerfish at 97 (89 and 93 are the
  // Hosidius range's); without them neither ever stops burning, which this data writes as 99, as for dark crab.
  const shark = Cooking._test.COOKABLE_BY_RAW.get(ItemIds.RAW_SHARK);
  const anglerfish = Cooking._test.COOKABLE_BY_RAW.get(ItemIds.RAW_ANGLERFISH);
  assert.equal(Cooking._test.stopBurnLevel(player(80, ItemIds.COOKING_GAUNTLETS), shark), 94);
  assert.equal(Cooking._test.stopBurnLevel(player(84, ItemIds.COOKING_GAUNTLETS), anglerfish), 97);
  assert.equal(Cooking._test.stopBurnLevel(player(80), shark), 99, "shark never stops burning without gauntlets");
  assert.equal(Cooking._test.stopBurnLevel(player(84), anglerfish), 99, "nor anglerfish");
});

test("the gauntlets do not help with unlisted food", () => {
  const shrimp = Cooking._test.COOKABLE_BY_RAW.get(ItemIds.RAW_SHRIMPS);
  assert.equal(Cooking._test.stopBurnLevel(player(20, ItemIds.COOKING_GAUNTLETS), shrimp), shrimp.stopBurn);
  assert.equal(Cooking._test.stopBurnLevel(player(20), shrimp), shrimp.stopBurn);
  void Skill;
});

test("a worn Cooking cape never burns food", () => {
  const shark = Cooking._test.COOKABLE_BY_RAW.get(ItemIds.RAW_SHARK);
  assert.equal(Cooking._test.wearsCookingCape(player(50, 0, ItemIds.COOKING_CAPE)), true);
  assert.equal(Cooking._test.isSuccess(player(50, 0, ItemIds.COOKING_CAPE), shark), true, "50 Cooking would burn a shark");
  assert.equal(Cooking._test.isSuccess(player(50, 0, ItemIds.COOKING_CAPE_T_), shark), true);
  assert.equal(Cooking._test.wearsCookingCape(player(50, 0, 0)), false);
});
