// Run after `yarn build`: node --test tests/imbued-heart.test.cjs
const assert = require("node:assert/strict");
const { test, before } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { CacheDefinitions } = require("../dist/game/cache/CacheDefinitions");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { ItemIdentifiers: Items } = require("../dist/util/ItemIdentifiers");

const ImbuedHeart = require("../plugins/items/ImbuedHeart.plugin");

const READY_AT = ImbuedHeart._test.READY_AT_ATTRIBUTE;
const COOLDOWN_MS = ImbuedHeart.COOLDOWN_MS;

let invigorate;
let resetOnDeath;
const persisted = [];

before(async () => {
  await CachePipeline.initialize();
  ImbuedHeart.register({
    core: PluginManager.getCoreApi(),
    persistAttribute: (key, defaultValue) => persisted.push([key, defaultValue]),
    onItemAction: (name, actions) => {
      assert.equal(name, "Imbued heart");
      invigorate = actions.Invigorate;
    },
    onPlayerDeath: (handler) => { resetOnDeath = handler; },
    emitCustomEvent() {},
  });
});

/** A player at `base` Magic, with only the skill maths the boost needs. */
function createPlayer({ base = 99, current = base, hearts = 1 } = {}) {
  const attributes = new Map();
  const messages = [];
  const graphics = [];
  const sounds = [];
  const inventory = { reads: 0, items: Array.from({ length: hearts }, () => Items.IMBUED_HEART) };
  const player = {
    attributes, messages, inventory, graphics, sounds,
    performGraphic: (graphic) => graphics.push({ id: graphic.getId(), height: graphic.getHeight(), delay: graphic.getDelay() }),
    getPacketSender: () => ({ sendSoundEffect: (...args) => sounds.push(args) }),
    getSkillManager: () => ({
      getMaxLevel: () => base,
      getCurrentLevel: () => current,
      increaseCurrentLevel: (skill, amount, cap) => {
        current = current + amount > cap ? cap : current + amount;
      },
    }),
    getInventory: () => { inventory.reads++; return inventory; },
    getAttribute: (key) => attributes.get(key) ?? 0,
    setAttribute: (key, value) => { value === null ? attributes.delete(key) : attributes.set(key, value); },
    sendMessage: (text) => messages.push(text),
  };
  return { player, level: () => current };
}

const use = (player, slot = 0) => invigorate({ player, itemId: Items.IMBUED_HEART, slot, clickType: 1 });

test("the boost is 1 + 10% of the Magic level, rounded down (Wiki's table)", () => {
  for (const base of [1, 9, 10, 19, 20, 29, 30, 39, 40, 49, 50, 59, 60, 69, 70, 79, 80, 89, 90, 99]) {
    const { player, level } = createPlayer({ base });
    use(player);
    assert.equal(level() - base, Math.floor(base * 0.1) + 1, `Magic ${base}`);
  }
});

test("the heart is never consumed, so the same one can be reactivated forever", () => {
  const { player, level } = createPlayer({ base: 50 });
  use(player);
  assert.equal(level(), 56);
  assert.equal(player.inventory.reads, 0, "the inventory is never touched, so no heart is spent");

  // Let the wait run out, twice over: the second and third activations work too.
  player.attributes.set(READY_AT, Date.now() - 1);
  use(player);
  player.attributes.set(READY_AT, Date.now() - 1);
  use(player);
  assert.equal(level(), 56, "already at the cap, so nothing more to add");
});

test("a second heart does not buy a second boost: the wait is per player", () => {
  const { player, level } = createPlayer({ base: 99, hearts: 2 });
  use(player);
  const boosted = level();
  use(player, 1);
  assert.equal(level(), boosted);
  assert.match(player.messages.at(-1), /^The heart is still drained of its power\. Judging by how it feels, it will be ready in around \d+ minutes\.$/);
});

test("the wait is seven minutes and is saved, so logging out does not clear it", () => {
  assert.deepEqual(persisted, [[READY_AT, 0]]);
  const { player } = createPlayer();
  const before = Date.now();
  use(player);
  const readyAt = player.attributes.get(READY_AT);
  assert.ok(readyAt >= before + COOLDOWN_MS && readyAt <= Date.now() + COOLDOWN_MS, `ready at +7 minutes, got ${readyAt - before}ms`);
});

test("a stronger boost already in place is not lowered, and the wait still starts", () => {
  const { player, level } = createPlayer({ base: 99, current: 120 });
  use(player);
  assert.equal(level(), 120);
  assert.ok(player.attributes.get(READY_AT) > Date.now());
});

test("death clears the wait (Wiki, 15 August 2019)", () => {
  const { player, level } = createPlayer({ base: 99 });
  use(player);
  assert.equal(level(), 109);
  resetOnDeath({ player, killer: null });
  assert.equal(player.attributes.get(READY_AT), 0, "back to the default, which is never saved");
  use(player);
  assert.equal(player.messages.length, 0, "no refusal, so the heart was ready again");
  assert.ok(player.attributes.get(READY_AT) > Date.now(), "and a fresh seven minutes started");
});

test("only the activatable item offers Invigorate, so notes and placeholders never reach it", () => {
  const options = (id) => CacheDefinitions.getItem(id).inventoryActions;
  assert.equal(options(Items.IMBUED_HEART)[0], "Invigorate");
  // The name hook matches all three ids, so the missing option is what guards the other two.
  for (const id of [Items.IMBUED_HEART_2, Items.IMBUED_HEART_3]) {
    assert.equal(CacheDefinitions.getItem(id).name, "Imbued heart");
    assert.equal(options(id).includes("Invigorate"), false, `${id} has no Invigorate option`);
  }
});

// rsprox recording 1763: Invigorate sends imbued_heart_impact and synth 6847.
test("Invigorate sends its activation feedback once, never on a drained click", () => {
  const { player, level } = createPlayer();
  use(player);
  assert.equal(level(), 109);
  assert.deepEqual(player.graphics, [{ id: 1316, height: 0, delay: 0 }]);
  assert.deepEqual(player.sounds, [[6847, 1, 0]]);
  use(player);
  assert.deepEqual(player.graphics, [{ id: 1316, height: 0, delay: 0 }]);
  assert.deepEqual(player.sounds, [[6847, 1, 0]]);
  assert.match(player.messages.at(-1), /heart is still drained/);
});
