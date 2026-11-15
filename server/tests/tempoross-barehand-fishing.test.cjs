// Run after yarn build: node --test tests/tempoross-barehand-fishing.test.cjs
// Wiki (Barbarian Training#Barehanded fishing): "The fishing spots in Tempoross Cove will work as well"; raw
// harpoonfish need 55 Fishing and 35 Strength (current levels, as Fishing checks them) and give 10 Strength XP. Wiki
// (Tempoross): a harpoon is "not required if using barbarian fishing", at a regular harpoon's rates.
const assert = require("node:assert/strict");
const { before, test } = require("node:test");
const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { Item } = require("../dist/game/model/Item");
const Shared = require("../plugins/minigames/tempoross/Shared.Tempoross");
const { harpoonOf, catchFish } = require("../plugins/minigames/tempoross/Spots.Tempoross");

const core = PluginManager.getCoreApi();
const I = core.ItemIdentifiers;
const taught = new Set();
const successes = [];

before(async () => {
  await CachePipeline.initialize();
  Shared.bind({
    core,
    emitCustomEvent(name, payload) {
      if (name === "fishing:barehand-unlocked") payload.allowed = taught.has(payload.player);
      if (name === "fishing:success") successes.push(payload);
    },
  });
});

function fisher({ fishing = 55, boostedFishing = fishing, strength = 35, boostedStrength = strength, lesson = true } = {}) {
  const player = new Player(null);
  player.getSession = () => ({ sendClientPacket() {}, write() {} });
  player.sendMessage = () => {};
  const skills = player.getSkillManager();
  skills.setMaxLevel(core.Skill.FISHING, fishing, false).setCurrentLevel(core.Skill.FISHING, boostedFishing, false);
  skills.setMaxLevel(core.Skill.STRENGTH, strength, false).setCurrentLevel(core.Skill.STRENGTH, boostedStrength, false);
  player.getInventory().resetItems();
  if (lesson) taught.add(player);
  return player;
}

test("with Otto's harpoon lesson, 55 Fishing and 35 Strength, bare hands fish at a regular harpoon's tier", () => {
  const held = harpoonOf(fisher());
  assert.equal(held?.barehand, true);
  assert.equal(held.tier, "harpoon");
});

test("bare hands need the lesson, 55 Fishing and 35 Strength, boosts counting as in Fishing", () => {
  assert.equal(harpoonOf(fisher({ lesson: false })), null, "not taught");
  assert.equal(harpoonOf(fisher({ fishing: 54 })), null, "54 Fishing");
  assert.equal(harpoonOf(fisher({ fishing: 52, boostedFishing: 55 }))?.barehand, true, "Fishing is boostable");
  assert.equal(harpoonOf(fisher({ strength: 34 })), null, "34 Strength");
  assert.equal(harpoonOf(fisher({ strength: 34, boostedStrength: 35 }))?.barehand, true, "a Strength boost counts, as Fishing's meetsLevels");
});

test("a carried harpoon is still used over bare hands", () => {
  const player = fisher({ fishing: 99 });
  player.getInventory().setItem(0, new Item(I.DRAGON_HARPOON, 1));
  assert.equal(harpoonOf(player).tier, "dragon");
  assert.notEqual(harpoonOf(player).barehand, true);
});

test("a barehanded harpoonfish gives 10 Strength XP on top of the Fishing XP; a harpooned one gives none", () => {
  const fight = { addPoints() {}, damageEssence() {} };
  const strengthXp = (player) => player.getSkillManager().getExperience(core.Skill.STRENGTH);

  const bare = fisher();
  const before = strengthXp(bare);
  catchFish(bare, fight, harpoonOf(bare), false);
  assert.equal(strengthXp(bare) - before, 10);
  assert.equal(bare.getInventory().getAmount(Shared.ITEM.RAW), 1);

  const harpooner = fisher();
  harpooner.getInventory().setItem(0, new Item(I.HARPOON, 1));
  const start = strengthXp(harpooner);
  catchFish(harpooner, fight, harpoonOf(harpooner), false);
  assert.equal(strengthXp(harpooner), start);
});

test("a barehanded cove catch tells Fishing's listeners it was barehanded, so Otto's harpoon lesson can finish", () => {
  const fight = { addPoints() {}, damageEssence() {} };
  const bare = fisher();
  successes.length = 0;
  catchFish(bare, fight, harpoonOf(bare), false);
  assert.equal(successes.length, 1);
  assert.equal(successes[0].player, bare);
  assert.equal(successes[0].barehand, true);
  assert.equal(successes[0].itemId, Shared.ITEM.RAW);

  const harpooner = fisher();
  harpooner.getInventory().setItem(0, new Item(I.HARPOON, 1));
  successes.length = 0;
  catchFish(harpooner, fight, harpoonOf(harpooner), false);
  assert.equal(successes[0].barehand, false);
});
