// Run after yarn build: node --test tests/tempoross-crystal-charges.test.cjs
// Wiki (Crystal harpoon): a charge is used for every fish caught and, at Tempoross, when harpooning the
// Spirit Pool; an empty harpoon turns inactive. The echo harpoon has no charges and no crystallised fish.
const assert = require("node:assert/strict");
const { before, test } = require("node:test");
const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { Item } = require("../dist/game/model/Item");
const Shared = require("../plugins/minigames/tempoross/Shared.Tempoross");
const CrystalHarpoon = require("../plugins/skills/fishing/CrystalHarpoon.Fishing");
const { harpoonOf, catchFish, scatter } = require("../plugins/minigames/tempoross/Spots.Tempoross");

const core = PluginManager.getCoreApi();
const I = core.ItemIdentifiers;
const META = "crystal-harpoon";

before(async () => {
  await CachePipeline.initialize();
  const api = { core, emitCustomEvent() {}, onItemAction() {}, onItemOnItem() {} };
  Shared.bind(api);
  CrystalHarpoon.attach(api);
});

function fisher(harpoonId, charges) {
  const player = new Player(null);
  player.getSession = () => ({ sendClientPacket() {}, write() {} });
  const messages = [];
  player.sendMessage = (message) => messages.push(message);
  const skills = player.getSkillManager();
  for (const skill of [core.Skill.FISHING, core.Skill.AGILITY]) {
    skills.setMaxLevel(skill, 99, false).setCurrentLevel(skill, 99, false);
  }
  player.getInventory().resetItems();
  const harpoon = new Item(harpoonId, 1);
  if (charges !== undefined) harpoon.setMetaValue(META, { charges });
  player.getInventory().setItem(0, harpoon);
  const fight = { points: 0, addPoints(_p, n) { this.points += n; }, damageEssence() {} };
  return { player, harpoon, fight, messages };
}

const left = (item) => CrystalHarpoon.charges(item);

test("each harpoonfish caught with a charged crystal harpoon uses one charge", () => {
  const { player, harpoon, fight } = fisher(I.CRYSTAL_HARPOON);
  assert.equal(left(harpoon), CrystalHarpoon.START_CHARGES);
  const held = harpoonOf(player);
  assert.equal(held.tier, "crystal");
  catchFish(player, fight, held, false);
  catchFish(player, fight, held, false);
  assert.equal(left(harpoon), CrystalHarpoon.START_CHARGES - 2);
});

test("each spirit-pool scatter uses one charge", () => {
  const { player, harpoon, fight } = fisher(I.CRYSTAL_HARPOON, 50);
  const pool = { getLocation: () => new core.Location(3000, 3000, 0) };
  scatter(player, fight, pool);
  assert.equal(left(harpoon), 49);
});

test("the last charge turns the harpoon inactive, which then fishes as a dragon harpoon", () => {
  const { player, harpoon, fight, messages } = fisher(I.CRYSTAL_HARPOON, 1);
  catchFish(player, fight, harpoonOf(player), false);
  assert.equal(harpoon.getId(), I.CRYSTAL_HARPOON_INACTIVE_);
  assert.ok(messages.includes("Your crystal harpoon has run out of charges."));
  assert.equal(harpoonOf(player).tier, "dragon");
  catchFish(player, fight, harpoonOf(player), false);
  assert.equal(harpoon.getId(), I.CRYSTAL_HARPOON_INACTIVE_, "an inactive harpoon has nothing to spend");
});

test("a crystal harpoon the player can't use spends nothing while a dragon harpoon fishes", () => {
  const { player, harpoon, fight } = fisher(I.CRYSTAL_HARPOON, 50);
  player.getSkillManager().setCurrentLevel(core.Skill.AGILITY, 49, false);
  player.getInventory().setItem(1, new Item(I.DRAGON_HARPOON, 1));
  const held = harpoonOf(player);
  assert.equal(held.tier, "dragon");
  catchFish(player, fight, held, false);
  assert.equal(left(harpoon), 50);
});

test("the echo harpoon needs nothing, spends nothing and never gives a crystallised fish", () => {
  const { player, fight } = fisher(I.ECHO_HARPOON);
  for (const skill of [core.Skill.FISHING, core.Skill.AGILITY]) player.getSkillManager().setCurrentLevel(skill, 35, false);
  const held = harpoonOf(player);
  assert.equal(held?.tier, "dragon");
  const random = Math.random;
  Math.random = () => 0;
  try {
    for (let i = 0; i < 20; i++) catchFish(player, fight, held, false);
  } finally {
    Math.random = random;
  }
  const inventory = player.getInventory();
  assert.equal(inventory.getAmount(Shared.ITEM.CRYSTALLISED), 0);
  assert.equal(inventory.getAmount(Shared.ITEM.RAW), 20);
});

test("a usable charged crystal harpoon beats the echo harpoon and spends its charge", () => {
  const { player, fight } = fisher(I.ECHO_HARPOON);
  player.getInventory().setItem(1, new Item(I.CRYSTAL_HARPOON, 1));
  const held = harpoonOf(player);
  assert.equal(held.tier, "crystal");
  catchFish(player, fight, held, false);
  assert.equal(left(player.getInventory().getItems()[1]), CrystalHarpoon.START_CHARGES - 1);
});
