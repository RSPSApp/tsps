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
const Timers = require("../plugins/items/imbuedheart/Timers.ImbuedHeart");
const Saturate = require("../plugins/items/imbuedheart/Saturate.ImbuedHeart");

const READY_AT = ImbuedHeart._test.READY_AT_ATTRIBUTE;
const SATURATED_UNTIL = Timers.SATURATED_UNTIL_ATTRIBUTE;
const COOLDOWN_MS = ImbuedHeart.COOLDOWN_MS;
const SATURATED_COOLDOWN_MS = 5 * 60 * 1000;

let invigorate;
let invigorateSaturated;
let resetOnDeath;
const feroxResets = {};
let processPlayer;
let holdBoost;
let useEssence;
const persisted = [];
const varbitIds = {};

before(async () => {
  await CachePipeline.initialize();
  ImbuedHeart.register({
    core: PluginManager.getCoreApi(),
    persistAttribute: (key, defaultValue) => persisted.push([key, defaultValue]),
    onItemAction: (name, actions) => {
      if (name === "Imbued heart") invigorate = actions.Invigorate;
      else if (name === "Saturated heart") invigorateSaturated = actions.Invigorate;
      else assert.fail(`unexpected item hook ${name}`);
    },
    onPlayerDeath: (handler) => { resetOnDeath = handler; },
    onPlayerProcess: (handler) => { processPlayer = handler; },
    onCustomEvent: (name, handler) => { if (name === "stats:boost-held") holdBoost = handler; feroxResets[name] = handler; },
    onItemOnItem: (first, second, handler) => {
      assert.deepEqual([first, second], ["Ancient essence", "Imbued heart"]);
      useEssence = handler;
    },
    emitCustomEvent() {},
  });
  for (const name of ["imbued_heart_timer", "saturated_heart_time", "saturated_heart_base"]) {
    varbitIds[name] = CacheDefinitions.getVarbitId(name);
    assert.ok(varbitIds[name] > 0, `${name} is in the cache`);
  }
});

/** A player at `base` Magic, with only the skill maths the boost needs. */
function createPlayer({ base = 99, current = base, hearts = 1 } = {}) {
  const attributes = new Map();
  const messages = [];
  const graphics = [];
  const sounds = [];
  const varbits = new Map();
  const inventory = { reads: 0, items: Array.from({ length: hearts }, () => Items.IMBUED_HEART) };
  const player = {
    attributes, messages, inventory, graphics, sounds, varbits,
    performGraphic: (graphic) => graphics.push({ id: graphic.getId(), height: graphic.getHeight(), delay: graphic.getDelay() }),
    getPacketSender: () => ({
      sendSoundEffect: (...args) => sounds.push(args),
      sendVarbit: (id, value) => varbits.set(id, value),
      getVarbit: (id) => varbits.get(id) ?? 0,
    }),
    getSkillManager: () => ({
      getMaxLevel: () => base,
      getCurrentLevel: () => current,
      increaseCurrentLevel: (skill, amount, cap) => {
        current = current + amount > cap ? cap : current + amount;
      },
      setCurrentLevels: (skill, level) => { current = level; },
    }),
    getInventory: () => { inventory.reads++; return inventory; },
    getAttribute: (key) => attributes.get(key) ?? 0,
    setAttribute: (key, value) => { value === null ? attributes.delete(key) : attributes.set(key, value); },
    sendMessage: (text) => messages.push(text),
  };
  return { player, level: () => current, setLevel: (level) => { current = level; } };
}

const use = (player, slot = 0) => invigorate({ player, itemId: Items.IMBUED_HEART, slot, clickType: 1 });
const useSaturated = (player, slot = 0) => invigorateSaturated({ player, itemId: Items.SATURATED_HEART, slot, clickType: 1 });
const varbit = (player, name) => player.varbits.get(varbitIds[name]) ?? 0;

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
  assert.deepEqual(persisted, [[READY_AT, 0], [SATURATED_UNTIL, 0]]);
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

// Wiki (Imbued heart): the free-for-all (white) portal or the Pool of Refreshment resets the cooldown.
test("the Pool of Refreshment and the free-for-all portal clear the wait", () => {
  for (const event of ["pool-of-refreshment:drunk", "free-for-all-portal:used"]) {
    const { player } = createPlayer({ base: 99 });
    use(player);
    assert.ok(player.attributes.get(READY_AT) > Date.now());
    assert.equal(typeof feroxResets[event], "function", event);
    feroxResets[event]({ player });
    assert.equal(player.attributes.get(READY_AT), 0, event);
  }
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

// rsprox 1696, 1702, 472, 475, 476, 238/04152: Invigorate on the saturated heart.
test("the saturated heart boosts Magic by 4 + 10%, rounded down (Wiki's table)", () => {
  for (const base of [1, 9, 10, 19, 49, 50, 99]) {
    const { player, level } = createPlayer({ base });
    useSaturated(player);
    assert.equal(level() - base, Math.floor(base * 0.1) + 4, `Magic ${base}`);
  }
});

test("the saturated heart sends its own graphic and the clocks the client reads", () => {
  const { player } = createPlayer({ base: 99 });
  useSaturated(player);
  assert.deepEqual(player.graphics.map((graphic) => graphic.id), [CacheDefinitions.getSpotanimId("imbued_heart_impact02")]);
  assert.deepEqual(player.sounds, [[6847, 1, 0]]);
  assert.equal(varbit(player, "imbued_heart_timer"), 50, "five minutes in six-second steps");
  assert.equal(varbit(player, "saturated_heart_time"), 500, "five minutes in ticks");
  assert.equal(varbit(player, "saturated_heart_base"), 112, "the boosted level of a 99");
});

test("the saturated heart waits five minutes, and shares the wait with the imbued heart", () => {
  const { player } = createPlayer({ base: 99, hearts: 2 });
  const before = Date.now();
  useSaturated(player);
  const readyAt = player.attributes.get(READY_AT);
  assert.ok(readyAt >= before + SATURATED_COOLDOWN_MS && readyAt <= Date.now() + SATURATED_COOLDOWN_MS);
  use(player, 1);
  assert.match(player.messages.at(-1), /^The heart is still drained of its power\. .* around 5 minutes\.$/);
  assert.equal(player.attributes.get(READY_AT), readyAt, "a refused click starts nothing");
});

test("the imbued heart sends its seven-minute timer too (rsprox 1763), and holds nothing", () => {
  const { player } = createPlayer({ base: 99 });
  use(player);
  assert.equal(varbit(player, "imbued_heart_timer"), 70);
  assert.equal(varbit(player, "saturated_heart_time"), 0);
  assert.equal(varbit(player, "saturated_heart_base"), 0);
});

test("the clocks count down: the timer every ten ticks, the boost every tick", () => {
  const { player } = createPlayer({ base: 99 });
  useSaturated(player);
  player.attributes.set(READY_AT, Date.now() + 49 * 6000 - 100);
  player.attributes.set(SATURATED_UNTIL, Date.now() + 490 * Timers.TICK_MS - 100);
  processPlayer({ player });
  assert.equal(varbit(player, "imbued_heart_timer"), 49);
  assert.equal(varbit(player, "saturated_heart_time"), 490);
  assert.equal(varbit(player, "saturated_heart_base"), 112);
});

// rsprox 238/04152 (and 226/01696): both clocks reach 0 together, a line for each.
test("when the saturated heart runs out it says so, and the boost ends", () => {
  const { player, level } = createPlayer({ base: 99 });
  useSaturated(player);
  assert.equal(level(), 112);
  player.attributes.set(READY_AT, Date.now() - 1);
  player.attributes.set(SATURATED_UNTIL, Date.now() - 1);
  player.messages.length = 0;
  processPlayer({ player });
  assert.deepEqual(player.messages, [
    "<col=ff3045>Your saturated heart has regained its magical power.</col>",
    "<col=ff3045>The effects of the saturated heart have worn off.",
  ]);
  assert.equal(level(), 99);
  assert.equal(varbit(player, "imbued_heart_timer"), 0);
  assert.equal(varbit(player, "saturated_heart_time"), 0);
  assert.equal(varbit(player, "saturated_heart_base"), 0);
  assert.equal(player.attributes.get(SATURATED_UNTIL) ?? 0, 0);
  processPlayer({ player });
  assert.equal(player.messages.length, 2, "said once");
});

// rsprox 1763 (Leagues): the imbued heart's own line.
test("the imbued heart says when it is ready again, and no boost ends with it", () => {
  const { player } = createPlayer({ base: 99 });
  use(player);
  player.attributes.set(READY_AT, Date.now() - 1);
  player.messages.length = 0;
  processPlayer({ player });
  assert.deepEqual(player.messages, ["<col=ff3045>Your imbued heart has regained its magical power.</col>"]);
});

test("logging in after the clocks ran out says nothing", () => {
  const { player } = createPlayer({ base: 99 });
  player.attributes.set(READY_AT, Date.now() - 1000);
  processPlayer({ player });
  assert.equal(player.messages.length, 0);
});

test("only the saturated heart holds the Magic boost against the minute-by-minute drain", () => {
  const { player, setLevel } = createPlayer({ base: 99 });
  const held = () => { const set = new Set(); holdBoost({ player, held: set }); return set.size; };
  use(player);
  assert.equal(held(), 0, "an imbued heart boost drains like any potion's");
  player.attributes.set(READY_AT, 0);
  useSaturated(player);
  assert.equal(held(), 1);
  setLevel(150);
  assert.equal(held(), 0, "a bigger boost from elsewhere still decays down to the heart's");
  setLevel(112);
  player.attributes.set(SATURATED_UNTIL, Date.now() - 1);
  assert.equal(held(), 0, "and once it has run out nothing is held");
});

test("death clears the saturated boost and every clock", () => {
  const { player } = createPlayer({ base: 99 });
  useSaturated(player);
  resetOnDeath({ player, killer: null });
  assert.equal(player.attributes.get(READY_AT) ?? 0, 0);
  assert.equal(player.attributes.get(SATURATED_UNTIL) ?? 0, 0);
  for (const name of ["imbued_heart_timer", "saturated_heart_time", "saturated_heart_base"]) assert.equal(varbit(player, name), 0);
});

test("only the activatable saturated heart offers Invigorate", () => {
  const options = (id) => CacheDefinitions.getItem(id).inventoryActions;
  assert.equal(options(Items.SATURATED_HEART)[0], "Invigorate");
  for (const id of [Items.SATURATED_HEART_2, Items.SATURATED_HEART_3]) {
    assert.equal(CacheDefinitions.getItem(id).name, "Saturated heart");
    assert.equal(options(id).includes("Invigorate"), false, `${id} has no Invigorate option`);
  }
});

// rsprox 1767 (too little essence), 1774 (the confirmation and the result).
test("ancient essence on an imbued heart: refused below 150,000, else confirmed first", () => {
  const dialogues = [];
  const spent = [];
  const slots = [];
  const experience = [];
  const inventoryOf = (essence) => ({
    getAmount: (id) => (id === Items.ANCIENT_ESSENCE ? essence : 0),
    getItems: () => [{ getId: () => Items.IMBUED_HEART, getAmount: () => 1 }],
    deleteNumber: (id, amount) => spent.push([id, amount]),
    setItem: (slot, item) => slots.push([slot, item.getId()]),
    refreshItems() {},
  });
  const playerWith = (essence) => ({
    getInventory: () => inventoryOf(essence),
    getDialogueManager: () => ({ startDialogues: (chain) => dialogues.push(chain) }),
    getPacketSender: () => ({ sendInterfaceRemoval() {}, sendGraphic() {}, sendSoundEffect() {} }),
    getSkillManager: () => ({ addExperience: (...args) => experience.push(args) }),
    getLocation: () => ({}),
  });

  const poor = { player: playerWith(149_999), handled: false };
  useEssence(poor);
  assert.equal(poor.handled, true);
  assert.equal(dialogues.length, 1);
  assert.deepEqual(spent, [], "nothing is taken");

  const rich = { player: playerWith(150_000), handled: false };
  useEssence(rich);
  assert.deepEqual(spent, [], "the warning comes first");
  assert.equal(dialogues.length, 2);

  Saturate.saturate(playerWith(150_000));
  assert.deepEqual(spent, [[Items.ANCIENT_ESSENCE, 150_000]]);
  assert.deepEqual(slots, [[0, Items.SATURATED_HEART]], "the heart changes in its own slot");
  assert.deepEqual(experience.map(([, amount]) => amount), [500]);
  spent.length = 0;
  Saturate.saturate(playerWith(149_999));
  assert.deepEqual(spent, [], "essence spent meanwhile stops the confirmation");
});
