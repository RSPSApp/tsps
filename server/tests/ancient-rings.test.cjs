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
const RINGS = [
  [ItemIdentifiers.ULTOR_RING, "Vardorvis"],
  [ItemIdentifiers.BELLATOR_RING, "Whisperer, The"],
  [ItemIdentifiers.MAGUS_RING, "Duke Sucellus"],
  [ItemIdentifiers.VENATOR_RING, "Leviathan, The"],
];
let kills;

before(async () => {
  await CachePipeline.initialize(require("node:path").resolve(__dirname, ".."));
  const api = PluginManager.createApi("AncientRingsRegression");
  AncientRings.register({
    ...api,
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

test("other items and player bots are not gated", () => {
  kills = {};
  assert.equal(equip(ItemIdentifiers.BERSERKER_RING).event.allow, null);
  assert.equal(equip(ItemIdentifiers.ULTOR_RING, { bot: true }).event.allow, null);
});
