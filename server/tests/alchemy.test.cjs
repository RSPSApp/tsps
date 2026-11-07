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
    getAddableAmount: (item) => Math.min(item.getAmount(), 0x7fffffff - (amounts.get(item.getId()) || 0)),
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


test('alchemy refuses an oversized payout before consuming the item or runes', (t) => {
  const { listener } = harness(t);
  const original = PluginManager.emitCustomEvent;
  t.mock.method(PluginManager, 'emitCustomEvent', (name, event) => {
    const result = original.call(PluginManager, name, event);
    if (name === 'magic:alchemy-policy') event.coins = 0x80000000;
    return result;
  });
  const player = fakePlayer([fakeItem(RUNE_PLATELEGS)]);
  listener.castOnItem(player, HIGH_ALCHEMY, RUNE_PLATELEGS, 0);
  assert.ok(player.slots[0]);
  assert.equal(coins(player), 0);
  assert.equal(player.amounts.get(NATURE_RUNE), 100);
  assert.equal(player.amounts.get(FIRE_RUNE), 500);
  assert.equal(player.log.xp, 0);
});

test('ordinary alchemy preserves the promised coin value at stack limits', async (t) => {
  const path = require('node:path');
  const PM = PluginManager;
  const { CachePipeline } = require('../dist/game/cache/CachePipeline');
  const { Player } = require('../dist/game/entity/impl/player/Player');
  const { PlayerSession } = require('../dist/net/PlayerSession');
  const { ClientConnection } = require('../dist/net/NetworkBuilder');
  const { SkillManager } = require('../dist/game/content/skill/SkillManager');
  const { MAX_STACK_AMOUNT } = require('../dist/game/model/container/StackType');
  const previousBots = process.env.DISABLE_PLAYER_BOTS;
  let started = false;
  t.after(() => {
    if (started) PM.emitServerShutdown({});
    if (previousBots === undefined) delete process.env.DISABLE_PLAYER_BOTS;
    else process.env.DISABLE_PLAYER_BOTS = previousBots;
  });
  process.env.DISABLE_PLAYER_BOTS = '1';
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  PM.loadFromDirectory(path.resolve(__dirname, '../plugins'));
  const native = PM.getCoreApi(), I = native.ItemIdentifiers;
  native.RegionManager.init();
  native.RegionManager.loadMapFiles(3222, 3218);
  started = true; PM.emitServerStartup({});
  let index = 17500;
  for (const spellName of ['High Level Alchemy', 'Low Level Alchemy']) {
    for (const mode of ['room', 'exact', 'near', 'full', 'full-item-slot', 'tagged-item-slot', 'keep-item-rune-slot', 'keep-item-free-runes']) await t.test(`${spellName}: ${mode}`, async (t) => {
      const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true,
        send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
      const player = new Player(new PlayerSession(channel));
      player.setIndex(index++); player.setUsername('alchcap' + player.getIndex());
      player.setRegistered(true); player.setLocation(new native.Location(3222, 3218)); player.needsPlacement = false;
      const connection = new ClientConnection(channel); connection.player = player;
      const inventory = player.getInventory(), skill = player.getSkillManager();
      t.after(() => {
        player.closeInterruptibleInterfaces();
        PM.emitPlayerLogout({ player, username: player.getUsername() }); player.setRegistered(false);
        native.TaskManager.cancelTasks(player.getIndex()); native.TaskManager.cancelTasks(player);
        for (const ground of native.World.getItems().filter(g => g.getOwner() === player.getUsername())) {
          if (!ground.isPendingRemoval()) native.ItemOnGroundManager.deregister(ground);
        }
      });
      skill.setExperience(native.Skill.MAGIC, SkillManager.getExperienceForLevel(99));
      skill.setMaxLevel(native.Skill.MAGIC, 99); skill.setCurrentLevel(native.Skill.MAGIC, 99, false);
      assert.equal(skill.getMaxLevel(native.Skill.MAGIC), 99); assert.equal(skill.getCurrentLevel(native.Skill.MAGIC), 99);
      assert.equal(player.getSpellbook().getInterfaceId(), native.MagicSpellbook.NORMAL.getInterfaceId());
      assert.ok(player.getHitpoints() > 0); assert.equal(player.getEquipment().getValidItems().length, 0);
      const itemId = native.CacheDefinitions.getObjId('bronze_dagger');
      const definition = native.ItemDefinition.forId(itemId), high = spellName === 'High Level Alchemy';
      const value = high ? definition.getHighAlchValue() : definition.getLowAlchValue();
      const baseXp = high ? 65 : 31, fireCost = high ? 5 : 3;
      assert.equal(itemId, I.BRONZE_DAGGER); assert.equal(definition.isTradeable(), true);
      assert.ok(Number.isSafeInteger(value) && value > 1); assert.equal(native.ItemDefinition.forId(I.COINS).isStackable(), true);
      const spell = native.CacheDefinitions.getSpellByName(spellName);
      assert.ok(spell); assert.equal(native.CacheDefinitions.getSpellName(spell.widgetId, spell.itemId), spellName);
      const headroom = mode === 'exact' ? value : mode === 'near' ? Math.floor(value / 2) : 0;
      const fullPack = ['full-item-slot', 'tagged-item-slot', 'keep-item-rune-slot', 'keep-item-free-runes'].includes(mode);
      if (!fullPack) {
        const initialCoins = mode === 'room' ? 100 : MAX_STACK_AMOUNT - headroom - 1;
        inventory.add(new native.Item(I.COINS, initialCoins), false);
      } else if (mode === 'tagged-item-slot') {
        inventory.add(new native.Item(I.COINS, 100, {source: 'tagged'}), false);
      }
      inventory.add(new native.Item(itemId), false);
      inventory.add(new native.Item(I.NATURE_RUNE, mode === 'keep-item-rune-slot' ? 1 : 20), false)
        .add(new native.Item(I.FIRE_RUNE, 100), true);
      if (fullPack) while (inventory.getFreeSlots() > 0) inventory.add(new native.Item(I.RAKE), false);
      const slot = inventory.getSlotForItemId(itemId), selected = inventory.getItems()[slot];
      assert.equal(selected.getMeta(), null); assert.equal(selected.getAmount(), 1);
      const taken = [], policies = [], payments = [], completed = [], gains = [], casts = [];
      const emit = PM.emitCustomEvent.bind(PM);
      t.mock.method(PM, 'emitCustomEvent', (name, event) => {
        const result = emit(name, event);
        if (event?.player === player) {
          // Model content policies on the real consumer without changing ordinary target cases.
          if (name === 'magic:alchemy-policy' && mode.startsWith('keep-item-')) {
            event.keepItem = true;
            if (mode === 'keep-item-free-runes') event.freeRunes = true;
          }
          if (name === 'ground-items:taken' && event.itemId === I.COINS) taken.push({ amount: event.amount, discarded: event.discarded });
          if (name === 'magic:alchemy-policy') policies.push({ coins: event.coins, freeRunes: event.freeRunes, keepItem: event.keepItem, recast: event.recast });
          if (name === 'magic:alchemy-payment') payments.push({ allowed: event.allowed, hasRunes: event.hasRunes, free: event.free,
            experience: event.experience, sameItem: event.item === selected, slot: event.slot, sourceAbsent: event.source === undefined });
          if (name === 'magic:alchemy-completed') completed.push({ itemId: event.itemId, spellId: event.spellId, coins: event.coins });
        }
        return result;
      });
      const addExperience = skill.addExperience.bind(skill);
      t.mock.method(skill, 'addExperience', (...args) => { gains.push([args[0].getIndex(), args[1]]); return addExperience(...args); });
      const originalCast = MagicOnItemPacketListener.prototype.castOnItem;
      t.mock.method(MagicOnItemPacketListener.prototype, 'castOnItem', function(p, ...args) {
        const result = originalCast.call(this, p, ...args);
        if (p === player) casts.push({ spellId: args[0], itemId: args[1], slot: args[2], sourceAbsent: args[3] === undefined, handled: result });
        return result;
      });
      const send = async packet => { await connection.dispatch([packet]); connection.processTurnPackets(); };
      const floor = id => native.World.getItems().filter(g => !g.isPendingRemoval() && g.getOwner() === player.getUsername()
        && g.getPrivateArea() === player.getPrivateArea() && g.getItem().getId() === id).reduce((sum, g) => sum + g.getItem().getAmount(), 0);
      const owned = id => inventory.getAmount(id) + player.getEquipment().getAmount(id)
        + player.getBanks().reduce((sum, bank, tab) => sum + (bank && tab !== native.Bank.BANK_SEARCH_TAB_INDEX ? bank.getAmount(id) : 0), 0) + floor(id);
      const state = () => ({ coins: owned(I.COINS), items: owned(itemId), nature: owned(I.NATURE_RUNE), fire: owned(I.FIRE_RUNE), rake: owned(I.RAKE),
        xp: native.Skill.values().map(s => skill.getExperience(s)) });
      const preparedXp = state().xp;
      if (!fullPack && mode !== 'room') {
        const pile = native.ItemOnGroundManager.registers(player, new native.Item(I.COINS, 1));
        assert.ok(pile); assert.equal(floor(I.COINS), 1);
        await send({ type: 'ground_item_action', itemId: I.COINS, x: 3222, y: 3218, option: 'Take' });
        assert.equal(pile.isPendingRemoval(), true); assert.equal(floor(I.COINS), 0);
        assert.deepEqual(taken, [{ amount: 1, discarded: 0 }]);
        assert.equal(inventory.getAmount(I.COINS), MAX_STACK_AMOUNT - headroom);
      }
      assert.equal(inventory.getAddableAmount(new native.Item(I.COINS, value)), fullPack ? 0 : mode === 'room' ? value : headroom);
      assert.equal(inventory.getItems()[slot], selected); assert.equal(inventory.getAmount(itemId), 1);
      assert.equal(inventory.getFreeSlots(), fullPack ? 0 : 24); assert.deepEqual(gains, []); assert.deepEqual(state().xp, preparedXp);
      assert.ok(Number(player.getAttribute('magic:alchemy-next-cast') ?? 0) <= native.World.getProcessCycle());
      const before = state();
      await send({ type: 'widget_target', sourceWidgetId: spell.widgetId, sourceItemId: spell.itemId, sourceSlot: -1,
        targetWidgetId: native.CacheDefinitions.getComponentId('inventory:items'), targetSlot: slot, targetItemId: itemId });
      assert.deepEqual(casts, [{ spellId: high ? HIGH_ALCHEMY : LOW_ALCHEMY, itemId, slot, sourceAbsent: true, handled: true }], 'native spell target reaches the ordinary consumer once');
      const after = state(), consumed = before.items - after.items;
      assert.equal(after.rake, before.rake, 'unrelated full-pack items remain unchanged');
      if (mode.startsWith('keep-item-')) {
        assert.equal(policies.length, 1); assert.equal(policies[0].keepItem, true);
        assert.equal(policies[0].freeRunes, mode === 'keep-item-free-runes');
      }
      if (mode === 'keep-item-rune-slot') {
        assert.equal(consumed, 0, 'policy keeps the item');
        assert.equal(after.coins - before.coins, value, 'spent rune stack makes room for the full payout');
        assert.equal(after.nature, 0); assert.equal(after.fire, before.fire - fireCost);
        assert.deepEqual(gains, [[native.Skill.MAGIC.getIndex(), baseXp]]);
        assert.ok(after.xp[native.Skill.MAGIC.getIndex()] > before.xp[native.Skill.MAGIC.getIndex()]);
        for (const other of native.Skill.values()) if (other !== native.Skill.MAGIC) assert.equal(after.xp[other.getIndex()], before.xp[other.getIndex()]);
        assert.equal(completed.length, 1); assert.equal(completed[0].coins, value);
        return;
      }
      if (mode === 'tagged-item-slot') {
        const tagged = inventory.getItems().find(entry => entry.getId() === I.COINS && entry.getMeta()?.source === 'tagged');
        assert.ok(tagged); assert.equal(tagged.getAmount(), 100, 'the separate tagged stack is preserved');
      }
      if (consumed > 0) {
        assert.equal(consumed, 1);
        assert.deepEqual(policies, [{ coins: value, freeRunes: false, keepItem: false, recast: false }]);
        assert.deepEqual(payments, [{ allowed: true, hasRunes: true, free: false, experience: baseXp, sameItem: true, slot, sourceAbsent: true }]);
        assert.deepEqual(completed, [{ itemId, spellId: high ? HIGH_ALCHEMY : LOW_ALCHEMY, coins: value }]);
      }
      const details = JSON.stringify({ spellName, mode, value, before, after, policies, payments, completed, gains });
      assert.equal(after.coins + value * after.items, before.coins + value * before.items, 'all owned coins and alchable value remain conserved: ' + details);
      if (['room', 'exact', 'full-item-slot', 'tagged-item-slot'].includes(mode)) assert.equal(consumed, 1, 'positive control actually converts the item');
      if (consumed === 0) {
        assert.deepEqual(after, before, details); assert.deepEqual(gains, [], details); assert.deepEqual(completed, [], details);
      } else {
        assert.equal(after.coins - before.coins, value, details);
        assert.equal(after.nature, before.nature - 1, details); assert.equal(after.fire, before.fire - fireCost, details);
        assert.deepEqual(gains, [[native.Skill.MAGIC.getIndex(), baseXp]], details);
        assert.ok(after.xp[native.Skill.MAGIC.getIndex()] > before.xp[native.Skill.MAGIC.getIndex()], details);
        for (const s of native.Skill.values()) if (s !== native.Skill.MAGIC) assert.equal(after.xp[s.getIndex()], before.xp[s.getIndex()], details);
      }
    });
  }
});
