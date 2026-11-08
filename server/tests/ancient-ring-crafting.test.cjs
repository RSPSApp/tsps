// Run after `yarn build`: node --test tests/ancient-ring-crafting.test.cjs
const assert = require("node:assert/strict");
const { test, before } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { ItemIdentifiers } = require("../dist/util/ItemIdentifiers");
const { NpcIdentifiers } = require("../dist/util/NpcIdentifiers");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const Crafting = require("../plugins/items/AncientRingCrafting.plugin");
const AncientRings = require("../plugins/items/AncientRings.plugin");

before(async () => {
  await CachePipeline.initialize(require("node:path").resolve(__dirname, ".."));
  const api = PluginManager.createApi("AncientRingCraftingRegression");
  Crafting.register(api);
  AncientRings.register(api);
});

function fakePlayer({ crafting = 99, magic = 99, learned = false, items = [] } = {}) {
  const messages = [];
  const attributes = new Map([[Crafting._test.LEARNED_ATTRIBUTE, learned]]);
  const levels = { CRAFTING: crafting, MAGIC: magic };
  const player = {
    messages,
    sendMessage: (m) => messages.push(m),
    getAttribute: (k) => attributes.get(k),
    setAttribute: (k, v) => attributes.set(k, v),
    getSkillManager: () => ({ getCurrentLevel: (skill) => levels[Object.keys(levels).find((name) => skill === require("../dist/game/model/Skill").Skill[name])] ?? 99 }),
    getInventory: () => ({
      contains: (id) => items.some(([i]) => i === id),
      getAmount: (id) => items.filter(([i]) => i === id).reduce((n, [, a]) => n + a, 0),
    }),
    getDialogueManager: () => ({ startDialogues() {} }),
  };
  return player;
}

test("each Fremennik ring maps to its boss's ancient ring", () => {
  const byName = Object.fromEntries(Crafting._test.recipes().map((r) => [r.finalName, r]));
  assert.equal(byName.Ultor.ringId, ItemIdentifiers.BERSERKER_RING);
  assert.equal(byName.Ultor.vestigeId, ItemIdentifiers.ULTOR_VESTIGE);
  assert.equal(byName.Venator.ringId, ItemIdentifiers.ARCHERS_RING);
  assert.equal(byName.Venator.vestigeId, ItemIdentifiers.VENATOR_VESTIGE);
  assert.equal(byName.Bellator.ringId, ItemIdentifiers.WARRIOR_RING);
  assert.equal(byName.Bellator.vestigeId, ItemIdentifiers.BELLATOR_VESTIGE);
  assert.equal(byName.Magus.ringId, ItemIdentifiers.SEERS_RING);
  assert.equal(byName.Magus.vestigeId, ItemIdentifiers.MAGUS_VESTIGE);
  for (const recipe of Object.values(byName)) {
    for (const id of [recipe.ringId, recipe.iconId, recipe.vestigeId, recipe.upgradedId]) assert.ok(id > 0, recipe.finalName);
  }
  // The rings made are the tradeable ones, the ones AncientRings gates by kill.
  const gated = AncientRings._test.requirements();
  for (const recipe of Object.values(byName)) assert.ok(gated.has(recipe.result), `${recipe.finalName} ring ${recipe.result} is gated`);
});

test("an icon on its vestige is refused until Peer has taught the combination", () => {
  const player = fakePlayer({ learned: false });
  const recipe = Crafting._test.recipes()[0];
  const handled = Crafting._test.useIconOnVestige({ player, usedItemId: recipe.iconId, usedWithItemId: recipe.vestigeId });
  assert.equal(handled, true);
  assert.deepEqual(player.messages, ["You're not quite sure how to combine those. Perhaps a Fremennik could help."]);
});

test("a taught player without 500 blood runes is told what is missing", () => {
  const player = fakePlayer({ learned: true, items: [[ItemIdentifiers.BLOOD_RUNE, 499]] });
  const recipe = Crafting._test.recipes()[0];
  Crafting._test.useIconOnVestige({ player, usedItemId: recipe.vestigeId, usedWithItemId: recipe.iconId });
  assert.deepEqual(player.messages, ["You'll also need 500 blood runes to be able to combine those."]);
});

test("the furnace tells what is missing before crafting a ring", () => {
  const recipe = Crafting._test.recipes()[0];
  let player = fakePlayer({ items: [[recipe.upgradedId, 1]] });
  assert.equal(Crafting._test.craft({ player }), true);
  assert.deepEqual(player.messages, ["You'll need 3 chromium ingots to craft an Ultor ring."]);
  player = fakePlayer({ items: [[recipe.upgradedId, 1], [ItemIdentifiers.CHROMIUM_INGOT, 3]] });
  Crafting._test.craft({ player });
  assert.deepEqual(player.messages, ["You'll need a ring mould to craft an Ultor ring."]);
  // Without an upgraded icon the furnace is left to smelting.
  assert.equal(Crafting._test.craft({ player: fakePlayer() }), false);
});

test("Peer's ring-icon transcript plays while an icon is carried, and its last step teaches", () => {
  const recipe = Crafting._test.recipes()[1];
  const holding = fakePlayer({ items: [[recipe.iconId, 1]] });
  assert.equal(Crafting._test.peerVariant({ player: holding, npcId: NpcIdentifiers.PEER_THE_SEER }), "standard-dialogue-with-a-ring-icon");
  assert.equal(Crafting._test.peerVariant({ player: fakePlayer(), npcId: NpcIdentifiers.PEER_THE_SEER }), null);
  assert.equal(Crafting._test.peerVariant({ player: holding, npcId: NpcIdentifiers.KETLA }), null);

  const player = fakePlayer();
  const step = { player, npcId: NpcIdentifiers.PEER_THE_SEER, stepId: "U25hrc", handled: false };
  Crafting._test.peerAction(step);
  assert.equal(step.handled, true);
  const message = { player, kind: "message", stepId: step.steps[0].id };
  Crafting._test.peerAction(message);
  assert.equal(player.getAttribute(Crafting._test.LEARNED_ATTRIBUTE), true);
  assert.equal(message.text, "Peer the Seer shows you how to combine ring icons with ancient vestiges.");
});
