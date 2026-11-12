// Run after `yarn build`: node --test tests/ancient-rings.test.cjs
const assert = require("node:assert/strict");
const { test, before } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { ItemIdentifiers } = require("../dist/util/ItemIdentifiers");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const AncientRings = require("../plugins/items/AncientRings.plugin");

const MESSAGE = "The ring slips off your finger. The power within it seems unfamiliar.";
// Cache variants: 2548x untradeable, 28307/28310/28313/28316 tradeable (the rings players buy),
// 33180/33182 equippable untradeable Magus/Ultor.
const RINGS = [
  [ItemIdentifiers.ULTOR_RING, "Vardorvis"],
  [ItemIdentifiers.BELLATOR_RING, "Whisperer, The"],
  [ItemIdentifiers.MAGUS_RING, "Duke Sucellus"],
  [ItemIdentifiers.VENATOR_RING, "Leviathan, The"],
  [28307, "Vardorvis"],
  [28316, "Whisperer, The"],
  [28313, "Duke Sucellus"],
  [28310, "Leviathan, The"],
  [33182, "Vardorvis"],
  [33180, "Duke Sucellus"],
];
let kills;
let equipmentRequirements = true;

before(async () => {
  await CachePipeline.initialize(require("node:path").resolve(__dirname, ".."));
  const api = PluginManager.createApi("AncientRingsRegression");
  AncientRings.register({
    ...api,
    getPluginConfig: (key, fallback) => key === "quests:equipment-requirements" ? equipmentRequirements : fallback,
    emitCustomEvent(name, request) {
      if (name === "combat-achievements:count") request.total = kills[request.monster] ?? 0;
    },
  });
});

function equip(id, { bot = false } = {}) {
  const messages = [];
  const player = { sendMessage: (m) => messages.push(m), isPlayerBot: () => bot };
  const event = { player, slot: 12, item: { getId: () => id }, allow: null };
  AncientRings._test.canWearRing(event);
  return { event, messages };
}

test("each ring stays off without its boss kill", () => {
  kills = {};
  for (const [ring] of RINGS) {
    const { event, messages } = equip(ring);
    assert.equal(event.allow, false);
    assert.deepEqual(messages, [MESSAGE]);
  }
});

test("a ring needs its own boss, not any of the four", () => {
  for (const [ring, monster] of RINGS) {
    kills = Object.fromEntries(RINGS.filter(([, other]) => other !== monster).map(([, other]) => [other, 5]));
    assert.equal(equip(ring).event.allow, false, monster);
  }
});

test("one kill of the matching boss lets the ring be worn silently", () => {
  for (const [ring, monster] of RINGS) {
    kills = { [monster]: 1 };
    const { event, messages } = equip(ring);
    assert.equal(event.allow, null, monster);
    assert.deepEqual(messages, []);
  }
});

test("the tradeable ids carry the cache numbers players actually hold", () => {
  assert.deepEqual(
    [ItemIdentifiers.ULTOR_RING_2, ItemIdentifiers.VENATOR_RING_2, ItemIdentifiers.MAGUS_RING_2, ItemIdentifiers.BELLATOR_RING_2],
    [28307, 28310, 28313, 28316],
  );
});

test("other items and player bots are not gated", () => {
  kills = {};
  assert.equal(equip(ItemIdentifiers.BERSERKER_RING).event.allow, null);
  assert.equal(equip(ItemIdentifiers.ULTOR_RING, { bot: true }).event.allow, null);
});

test("disabling quest equipment requirements bypasses every ancient ring boss gate", () => {
  equipmentRequirements = false;
  kills = {};
  try {
    for (const [ring] of RINGS) {
      const { event, messages } = equip(ring);
      assert.equal(event.allow, null);
      assert.deepEqual(messages, []);
    }
  } finally {
    equipmentRequirements = true;
  }
});
