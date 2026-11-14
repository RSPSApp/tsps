// Run after `yarn build`: node --test tests/rock-cake.test.cjs
const assert = require("node:assert/strict");
const { test, before } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const RockCake = require("../plugins/items/RockCake.plugin");

let core;
let actions;

before(async () => {
  await CachePipeline.initialize();
  core = PluginManager.getCoreApi();
  RockCake.register({ core, onItemAction: (name, handlers) => { actions = { name, handlers }; } });
});

function createPlayer(hitpoints) {
  const player = { hits: [], messages: [], sounds: [], animations: [] };
  Object.assign(player, {
    getHitpoints: () => hitpoints,
    getHitpointsAfterPendingDamage: () => hitpoints - player.hits.reduce((sum, hit) => sum + hit, 0),
    performAnimation: (animation) => player.animations.push(animation.getId()),
    getCombat: () => ({ getHitQueue: () => ({ addPendingDamage: (hits) => player.hits.push(...hits.map((hit) => hit.getDamage())) }) }),
    getPacketSender: () => ({
      sendSound: (id) => player.sounds.push(id),
      sendTypedMessage: (type, text) => { assert.equal(type, core.ChatType.SPAM); player.messages.push(text); },
    }),
  });
  return player;
}

const COOL = () => core.ItemIdentifiers.DWARVEN_ROCK_CAKE_2;
const HOT = () => core.ItemIdentifiers.DWARVEN_ROCK_CAKE;
const eat = (player, itemId) => actions.handlers.Eat({ player, itemId });
const guzzle = (player, itemId) => actions.handlers.Guzzle({ player, itemId });

test("hooks the cake by name for Eat and Guzzle", () => {
  assert.equal(actions.name, "Dwarven rock cake");
  assert.deepEqual(Object.keys(actions.handlers), ["Eat", "Guzzle"]);
});

test("eating a cooled cake costs 1 Hitpoint above 2 and shows both recorded messages (rsprox 3250)", () => {
  const player = createPlayer(30);
  eat(player, COOL());
  assert.deepEqual(player.hits, [1]);
  assert.deepEqual(player.animations, [829]);
  assert.deepEqual(player.sounds, [1018]);
  assert.deepEqual(player.messages, ["Ow! You nearly broke a tooth!", "The rock cake resists all attempts to eat it."]);
});

test("eating at 2 Hitpoints or less only plays the sound and messages: no animation, no hit", () => {
  for (const hitpoints of [2, 1]) {
    const player = createPlayer(hitpoints);
    eat(player, COOL());
    assert.deepEqual(player.hits, []);
    assert.deepEqual(player.animations, []);
    assert.deepEqual(player.sounds, [1018]);
    assert.equal(player.messages.length, 2);
  }
  const three = createPlayer(3);
  eat(three, COOL());
  assert.deepEqual(three.hits, [1]);
});

test("guzzling hits for 10% of the current Hitpoints rounded down plus 1 (Wiki; rsprox 3250)", () => {
  const expected = new Map([[99, 10], [90, 10], [89, 9], [30, 4], [10, 2], [9, 1], [4, 1], [3, 1], [2, 1], [1, 0]]);
  for (const [hitpoints, damage] of expected) {
    const player = createPlayer(hitpoints);
    guzzle(player, COOL());
    assert.deepEqual(player.hits, [damage], `${hitpoints} Hitpoints`);
    assert.deepEqual(player.animations, [829]);
    assert.deepEqual(player.sounds, [1018]);
    assert.deepEqual(player.messages, [
      "You bite hard into the rock cake to guzzle it down.",
      "OW! A terrible shock jars through your skull.",
    ]);
  }
});

test("eating the hot cake burns the mouth (rsprox 3250)", () => {
  const player = createPlayer(30);
  eat(player, HOT());
  assert.deepEqual(player.hits, [1]);
  assert.deepEqual(player.sounds, [], "no 1018 for the hot Eat");
  assert.deepEqual(player.messages, ["Ow! Ow! That's hot!", "You burn your mouth on the hot rock cake."]);
});

test("guzzling the hot cake bites as the cooled one and burns the mouth too (rsprox 3250, tick 8892)", () => {
  for (const [hitpoints, damage] of [[5, 1], [30, 4], [1, 0]]) {
    const player = createPlayer(hitpoints);
    assert.equal(guzzle(player, HOT()), true);
    assert.deepEqual(player.hits, [damage], `${hitpoints} Hitpoints`);
    assert.deepEqual(player.animations, [829]);
    assert.deepEqual(player.sounds, [1018]);
    assert.deepEqual(player.messages, [
      "You bite hard into the hot rock cake to guzzle it down.",
      "OW! A terrible shock jars through your skull, and you burn your mouth too.",
    ]);
  }
});

test("two guzzles or eats in the same tick count the queued hit and never kill", () => {
  const guzzles = createPlayer(2);
  guzzle(guzzles, COOL());
  guzzle(guzzles, COOL());
  assert.deepEqual(guzzles.hits, [1, 0]);
  const eats = createPlayer(3);
  eat(eats, COOL());
  eat(eats, COOL());
  assert.deepEqual(eats.hits, [1]);
});
