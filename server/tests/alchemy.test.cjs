// Run after `yarn build`: node --test tests/alchemy.test.cjs
// High and Low Level Alchemy (docs/alchemy.md): the cast delay and its queue, untradeable items,
// zone rules and the cast's animation.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

const { MagicOnItemPacketListener } = require('../dist/net/packet/impl/MagicOnItemPacketListener');
const { MagicSpellbook } = require('../dist/game/model/MagicSpellbook');
const { PluginManager } = require('../dist/plugins/PluginManager');
const { TaskManager } = require('../dist/game/task/TaskManager');
const { World } = require('../dist/game/World');
const { Sounds } = require('../dist/game/Sounds');
const { ItemStatementDialogue } = require('../dist/game/model/dialogues/entries/impl/ItemStatementDialogue');
const { OptionDialogue } = require('../dist/game/model/dialogues/entries/impl/OptionDialogue');

const HIGH_ALCHEMY = 1178;
const LOW_ALCHEMY = 1162;
const COINS = 995;
const NATURE_RUNE = 561;
const FIRE_RUNE = 554;
const RUNE_PLATELEGS = 1079;
const RUNE_PLATEBODY = 1127;
const IBANS_STAFF_BROKEN = 1410;
const DRAGON_DEFENDER = 12954;

function fakeItem(id, { tradeable = true, high = 38400, low = 25600, presetUntradeable = false } = {}) {
  return {
    getId: () => id,
    getMeta: () => presetUntradeable ? { untradeable: true } : null,
    isUntradeable: () => presetUntradeable,
    getDefinition: () => ({
      getHighAlchValue: () => high,
      getLowAlchValue: () => low,
      isTradeable: () => tradeable,
      getName: () => (id === IBANS_STAFF_BROKEN ? "Iban's staff" : 'Rune platelegs'),
    }),
  };
}

/** A player with `items` in slots 0.., plenty of runes, and a log of what the cast did. */
function fakePlayer(items) {
  const slots = [...items];
  const amounts = new Map([[NATURE_RUNE, 100], [FIRE_RUNE, 500]]);
  const attributes = new Map();
  const log = { animations: [], graphics: [], messages: [], xp: 0, dialogues: [] };
  const inventory = {
    capacity: () => 28,
    getItems: () => slots,
    contains: (id) => (amounts.get(id) || 0) > 0 || slots.some((item) => item?.getId() === id),
    getAmount: (id) => amounts.get(id) || 0,
    deleteNumber(id, amount) {
      const slot = slots.findIndex((item) => item?.getId() === id);
      if (slot >= 0) slots[slot] = null;
      else amounts.set(id, (amounts.get(id) || 0) - amount);
    },
    deleteAtSlot(slot) {
      slots[slot] = null;
    },
    adds: (id, amount) => amounts.set(id, (amounts.get(id) || 0) + amount),
  };
  const player = {
    log,
    amounts,
    slots,
    getInventory: () => inventory,
    getEquipment: () => ({ getWeapon: () => null }),
    getSkillManager: () => ({ getCurrentLevel: () => 99, addExperiences: (_skill, xp) => { log.xp += xp; } }),
    getSpellbook: () => MagicSpellbook.NORMAL,
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    isRegistered: () => true,
    getHitpoints: () => 99,
    sendMessage: (message) => log.messages.push(message),
    performAnimation: (animation) => log.animations.push(animation.getId()),
    performGraphic: (graphic) => log.graphics.push(graphic.id),
    getPacketSender: () => ({ sendTab() {}, sendInterfaceRemoval() {} }),
    getDialogueManager: () => ({ startDialogues: (chain) => log.dialogues.push([...chain.getDialogues().values()]) }),
  };
  return player;
}

/** Runs the listener against a controllable world clock and task queue. */
function harness(t) {
  const clock = { cycle: 1000 };
  const tasks = [];
  t.mock.method(World, 'getProcessCycle', () => clock.cycle);
  t.mock.method(TaskManager, 'submit', (task) => tasks.push(task));
  t.mock.method(Sounds, 'sendSound', () => {});
  const listener = new MagicOnItemPacketListener();
  /** Moves the clock on `ticks` and runs the tasks due by then. */
  const advance = (ticks) => {
    for (let i = 0; i < ticks; i++) {
      clock.cycle++;
      for (const task of [...tasks]) {
        if (--task.delay <= 0) {
          tasks.splice(tasks.indexOf(task), 1);
          task.execute();
        }
      }
    }
  };
  return { clock, tasks, listener, advance };
}

const coins = (player) => player.amounts.get(COINS) || 0;

// Each click used to cast at once, so a player could alch an item every click, every tick.
test('High Level Alchemy casts once per 5 ticks; a click during a cast waits and goes off when it ends', (t) => {
  const { tasks, listener, advance } = harness(t);
  const player = fakePlayer([fakeItem(RUNE_PLATELEGS), fakeItem(RUNE_PLATELEGS), fakeItem(RUNE_PLATELEGS)]);

  listener.castOnItem(player, HIGH_ALCHEMY, RUNE_PLATELEGS, 0);
  listener.castOnItem(player, HIGH_ALCHEMY, RUNE_PLATELEGS, 1);
  assert.equal(coins(player), 38400, 'only the first click casts on this tick');
  assert.equal(player.amounts.get(NATURE_RUNE), 99);
  assert.equal(tasks.length, 1, 'the second click waits for the cast to end');

  advance(4);
  assert.equal(coins(player), 38400, 'still casting after 4 ticks');
  advance(1);
  assert.equal(coins(player), 76800, 'the waiting cast goes off on the 5th tick');
  assert.equal(player.slots[1], null);
  assert.equal(player.log.xp, 130);

  advance(4);
  listener.castOnItem(player, HIGH_ALCHEMY, RUNE_PLATELEGS, 2);
  assert.equal(coins(player), 76800, 'a click 4 ticks after the last cast waits too');
  advance(1);
  assert.equal(coins(player), 115200);
});

test('Low Level Alchemy casts once per 3 ticks', (t) => {
  const { listener, advance } = harness(t);
  const player = fakePlayer([fakeItem(RUNE_PLATELEGS), fakeItem(RUNE_PLATELEGS)]);
  listener.castOnItem(player, LOW_ALCHEMY, RUNE_PLATELEGS, 0);
  listener.castOnItem(player, LOW_ALCHEMY, RUNE_PLATELEGS, 1);
  assert.equal(coins(player), 25600);
  advance(2);
  assert.equal(coins(player), 25600);
  advance(1);
  assert.equal(coins(player), 51200);
  assert.equal(player.amounts.get(FIRE_RUNE), 494, '3 fire runes a cast');
});

test('only one cast waits: a later click replaces it', (t) => {
  const { tasks, listener, advance } = harness(t);
  const player = fakePlayer([fakeItem(RUNE_PLATELEGS), fakeItem(RUNE_PLATELEGS), fakeItem(RUNE_PLATEBODY, { high: 39000 })]);
  listener.castOnItem(player, HIGH_ALCHEMY, RUNE_PLATELEGS, 0);
  listener.castOnItem(player, HIGH_ALCHEMY, RUNE_PLATELEGS, 1);
  listener.castOnItem(player, HIGH_ALCHEMY, RUNE_PLATEBODY, 2);
  assert.equal(tasks.length, 1);
  advance(5);
  assert.equal(coins(player), 77400, 'one waiting cast, not two');
  assert.ok(player.slots[1], 'the replaced click never casts');
  assert.equal(player.slots[2], null, 'the last click is the one cast');
  advance(10);
  assert.equal(coins(player), 77400);
});

test('the cast plays its own spell animation and graphic', (t) => {
  const { listener, advance } = harness(t);
  const player = fakePlayer([fakeItem(RUNE_PLATELEGS), fakeItem(RUNE_PLATELEGS)]);
  listener.castOnItem(player, HIGH_ALCHEMY, RUNE_PLATELEGS, 0);
  advance(5);
  listener.castOnItem(player, LOW_ALCHEMY, RUNE_PLATELEGS, 1);
  // human_casthighlvlalchemy/highlvlalchemy_casting, then the low-level pair (rsprox 3215).
  assert.deepEqual(player.log.animations, [713, 712]);
  assert.deepEqual(player.log.graphics, [113, 112]);
});

// Untradeable items were refused with "This spell can not be cast on this item."
test('an untradeable item alchs after the warning is accepted, and not when it is cancelled', (t) => {
  const { listener } = harness(t);
  const player = fakePlayer([fakeItem(IBANS_STAFF_BROKEN, { tradeable: false, high: 12, low: 8 })]);

  listener.castOnItem(player, HIGH_ALCHEMY, IBANS_STAFF_BROKEN, 0);
  assert.equal(coins(player), 0, 'nothing is cast before the answer');
  assert.ok(player.slots[0]);
  const [statement, options] = player.log.dialogues[0];
  assert.ok(statement instanceof ItemStatementDialogue);
  assert.equal(statement.getItemId(), IBANS_STAFF_BROKEN);
  assert.equal(statement.getText(), 'That item cannot be traded.<br>Really cast High Level Alchemy on it?');
  assert.ok(options instanceof OptionDialogue);
  assert.equal(options.getTitle(), "Iban's staff");
  assert.deepEqual(options.getOptions(), ['Proceed to cast High Level Alchemy on it.', 'Cancel the alchemy spell.']);
  assert.deepEqual(player.log.messages, ['That item cannot be traded. Really cast High Level Alchemy on it?']);

  options.execute(2);
  assert.equal(coins(player), 0, 'cancelled');
  assert.ok(player.slots[0]);
  options.execute(1);
  assert.equal(coins(player), 12, 'Iban\'s staff alchs for 12 coins, as live');
  assert.equal(player.slots[0], null);
  assert.equal(player.log.xp, 65);
});

test('server-flagged untradeables (PvP preset items) and coins are still refused', (t) => {
  const { listener } = harness(t);
  const player = fakePlayer([fakeItem(RUNE_PLATELEGS, { presetUntradeable: true }), fakeItem(COINS, { high: 1, low: 1 })]);
  listener.castOnItem(player, HIGH_ALCHEMY, RUNE_PLATELEGS, 0);
  listener.castOnItem(player, HIGH_ALCHEMY, COINS, 1);
  assert.deepEqual(player.log.messages, ['This spell can not be cast on this item.', 'This spell can not be cast on this item.']);
  assert.equal(player.log.dialogues.length, 0);
  assert.equal(player.amounts.get(NATURE_RUNE), 100);
});

// The cast deleted the first item of that id, so a PvP preset copy in an earlier slot was alched
// in place of the clicked one.
test('the clicked item is the one alched, not a preset copy in an earlier slot', (t) => {
  const { listener } = harness(t);
  const preset = fakeItem(DRAGON_DEFENDER, { tradeable: false, high: 40804, presetUntradeable: true });
  const plain = fakeItem(DRAGON_DEFENDER, { tradeable: false, high: 40804 });
  const player = fakePlayer([preset, plain]);
  listener.castOnItem(player, HIGH_ALCHEMY, DRAGON_DEFENDER, 1);
  const [, options] = player.log.dialogues[0];
  options.execute(1);
  assert.equal(coins(player), 40804);
  assert.equal(player.slots[0], preset, 'the preset defender stays');
  assert.equal(player.slots[1], null, 'the clicked defender is the one alched');
});

// Pest Control's ban on alchemy rides onSpellDisabled, which the alchemy cast never asked.
test('a zone that disables the spell stops the cast', (t) => {
  const { listener } = harness(t);
  const asked = [];
  t.mock.method(PluginManager, 'emitSpellDisabled', (_player, spellbook, spellId) => {
    asked.push([spellbook, spellId]);
    return true;
  });
  const player = fakePlayer([fakeItem(RUNE_PLATELEGS)]);
  listener.castOnItem(player, HIGH_ALCHEMY, RUNE_PLATELEGS, 0);
  assert.deepEqual(asked, [[MagicSpellbook.NORMAL, HIGH_ALCHEMY]]);
  assert.equal(coins(player), 0);
  assert.ok(player.slots[0]);
  assert.equal(player.amounts.get(NATURE_RUNE), 100);
});

test('a plugin can lengthen the cast (the Alchemists\' Playground: 5 ticks for Low Level Alchemy)', (t) => {
  const { listener, advance } = harness(t);
  const original = PluginManager.emitCustomEvent;
  t.mock.method(PluginManager, 'emitCustomEvent', (name, event) => {
    if (name === 'magic:alchemy-policy') event.castTicks = 5;
    return original.call(PluginManager, name, event);
  });
  const player = fakePlayer([fakeItem(RUNE_PLATELEGS), fakeItem(RUNE_PLATELEGS)]);
  listener.castOnItem(player, LOW_ALCHEMY, RUNE_PLATELEGS, 0);
  listener.castOnItem(player, LOW_ALCHEMY, RUNE_PLATELEGS, 1);
  advance(3);
  assert.equal(coins(player), 25600);
  advance(2);
  assert.equal(coins(player), 51200);
});
