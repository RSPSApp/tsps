// Run after yarn build: node --test tests/tempoross-infernal-cook.test.cjs
// Wiki (Infernal harpoon): a charged one cooks a third of its catches for half the Cooking XP, using a
// charge; harpoonfish caught at Tempoross are not destroyed when cooked. The extra jumping fish rolls too.
const assert = require("node:assert/strict");
const { before, beforeEach, after, test } = require("node:test");
const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { Item } = require("../dist/game/model/Item");
const Shared = require("../plugins/minigames/tempoross/Shared.Tempoross");
const InfernalHarpoon = require("../plugins/skills/fishing/InfernalHarpoon.Fishing");
const { harpoonOf, catchFish } = require("../plugins/minigames/tempoross/Spots.Tempoross");

const core = PluginManager.getCoreApi();
const I = core.ItemIdentifiers;
const { RAW, COOKED, CRYSTALLISED } = Shared.ITEM;
const META = "infernal-harpoon";
const realRandom = Math.random;
let rolls = [];

before(async () => {
  await CachePipeline.initialize();
  const api = { core, emitCustomEvent() {}, onItemAction() {}, onItemOnItem() {} };
  Shared.bind(api);
  InfernalHarpoon.attach(api);
});
beforeEach(() => { rolls = []; });
after(() => { Math.random = realRandom; });

// Math.random in catch order: crystallised (crystal only), the infernal cook, the bonus fish, its cook.
function withRolls(values, action) {
  rolls = [...values];
  Math.random = () => (rolls.length ? rolls.shift() : 0.99);
  try { action(); } finally { Math.random = realRandom; }
}

function fisher(harpoonId, charges) {
  const player = new Player(null);
  player.getSession = () => ({ sendClientPacket() {}, write() {} });
  const messages = [];
  player.sendMessage = (message) => messages.push(message);
  const skills = player.getSkillManager();
  for (const skill of [core.Skill.FISHING, core.Skill.AGILITY]) skills.setMaxLevel(skill, 99, false).setCurrentLevel(skill, 99, false);
  player.getInventory().resetItems();
  const harpoon = new Item(harpoonId, 1);
  if (charges !== undefined) harpoon.setMetaValue(META, { charges });
  player.getInventory().setItem(0, harpoon);
  const fight = { points: 0, addPoints(_p, n) { this.points += n; } };
  return { player, harpoon, fight, messages };
}

const cookingXp = (player) => player.getSkillManager().getExperience(core.Skill.COOKING);
const count = (player, id) => player.getInventory().getAmount(id);

test("a charged infernal harpoon's cook roll lands a cooked harpoonfish, half the shrine's XP and a charge", () => {
  const { player, harpoon, fight } = fisher(I.INFERNAL_HARPOON, 10);
  const before = cookingXp(player);
  withRolls([0], () => catchFish(player, fight, harpoonOf(player), false));
  assert.equal(count(player, COOKED), 1);
  assert.equal(count(player, RAW), 0);
  assert.equal(cookingXp(player) - before, 5);
  assert.equal(InfernalHarpoon.charges(harpoon), 9);
  assert.equal(fight.points, Shared.DATA.points.fish);
});

test("a missed roll lands a raw one and keeps the charge", () => {
  const { player, harpoon, fight } = fisher(I.INFERNAL_HARPOON_OR_, 10);
  withRolls([0.5], () => catchFish(player, fight, harpoonOf(player), false));
  assert.equal(count(player, RAW), 1);
  assert.equal(count(player, COOKED), 0);
  assert.equal(InfernalHarpoon.charges(harpoon), 10);
});

test("the jumping spot's extra fish has its own cook roll", () => {
  const { player, harpoon, fight } = fisher(I.INFERNAL_HARPOON, 10);
  withRolls([0.9, 0, 0], () => catchFish(player, fight, harpoonOf(player), true));
  assert.equal(count(player, RAW), 1);
  assert.equal(count(player, COOKED), 1);
  assert.equal(InfernalHarpoon.charges(harpoon), 9);
});

test("the last charge empties the harpoon, which then catches only raw fish", () => {
  const { player, harpoon, fight, messages } = fisher(I.INFERNAL_HARPOON, 1);
  withRolls([0], () => catchFish(player, fight, harpoonOf(player), false));
  assert.equal(harpoon.getId(), I.INFERNAL_HARPOON_UNCHARGED_);
  assert.ok(messages.includes("Your infernal harpoon has run out of charges."));
  withRolls([0], () => catchFish(player, fight, harpoonOf(player), false));
  assert.equal(count(player, COOKED), 1);
  assert.equal(count(player, RAW), 1);
});

test("dragon and crystal harpoons never cook", () => {
  for (const id of [I.DRAGON_HARPOON, I.CRYSTAL_HARPOON]) {
    const { player, fight } = fisher(id);
    const before = cookingXp(player);
    withRolls([0.9, 0], () => catchFish(player, fight, harpoonOf(player), false));
    assert.equal(count(player, COOKED), 0, `${id}`);
    assert.equal(count(player, RAW) + count(player, CRYSTALLISED), 1);
    assert.equal(cookingXp(player), before);
  }
});
