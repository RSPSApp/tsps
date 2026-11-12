// From server/: node --test tests/cowbell-amulet-parity.test.cjs
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { Server } = require('../dist/Server'); Server.installProductionPathResolver();
const { PluginManager } = require('../dist/plugins/PluginManager');
const QuestRuntime = require('../plugins/quests/QuestRuntime');
const core = PluginManager.getCoreApi(), I = core.ItemIdentifiers;
const noop = () => {};

function scene() {
  const items = [new core.Item(I.COWBELL_AMULET, 1)], equipment = [], counts = new Map();
  const sounds = [], varbits = [], messages = [], teleports = [], events = [];
  let actions, useItem, canTeleport = true;
  // Like a real container, the runes sit in slots too (after the amulets), so slot-based takes see them.
  const slots = () => [...items, ...[...counts].filter(([, n]) => n > 0).map(([id, n]) => new core.Item(id, n))];
  const inventory = { getItems: slots, refreshItems: noop, getAmount: id => counts.get(id) ?? 0,
    deleteAtSlot(slot, amount) { const id = slots()[slot].getId(); assert.ok(counts.get(id) >= amount); counts.set(id, counts.get(id) - amount); },
    getFreeSlots: () => p.full ? 0 : 28 - items.length,
    adds: (id, amount) => counts.set(id, (counts.get(id) ?? 0) + amount),
    containsNumber: id => (counts.get(id) ?? 0) > 0,
    deleteNumber(id, amount) { assert.ok((counts.get(id) ?? 0) >= amount); counts.set(id, counts.get(id) - amount); },
  };
  const p = {
    getInventory: () => inventory, getEquipment: () => ({ getItems: () => equipment, get: slot => equipment[slot], refreshItems: noop }),
    getPacketSender: () => ({ sendVarbit: (...args) => varbits.push(args), sendSoundEffect: (...args) => sounds.push(args), sendEnterAmountPrompt: title => { p.prompt = title; } }),
    getDialogueManager: () => ({ startDialogues: chain => { p.dialogue = [...chain.getDialogues().values()][0]; } }),
    getUpdateFlag: () => ({ flag: noop }), setEnteredAmountAction: action => { p.entered = action; },
    getLocation: () => p.location ?? new core.Location(3252, 3270, 0), getPrivateArea: () => null,
    sendMessage: text => messages.push(text),
  };
  const api = {
    core: { ...core, TeleportHandler: { checkReqs: () => canTeleport, confirm: (player, destination, go, level, { item } = {}) => go(item), teleport: (...args) => teleports.push(args) }, World: { getNpcsNear: () => [] } },
    onItemAction: (_name, handlers) => { actions = handlers; }, onItemOnItem: handler => { useItem = handler; },
    onCustomEvent: noop, onPlayerLogin: noop,
    emitCustomEvent: (name, request) => events.push([name, request]),
  };
  require('../plugins/quests/quests/ides-of-milk/CowbellAmulet.Quest')(api);
  return { p, items, equipment, counts, sounds, varbits, messages, teleports, events, actions, useItem,
    allowTeleport(value) { canTeleport = value; } };
}

test('Ring shows the captured charged model and all three bell sounds; no-air uses a plain message box', () => {
  const s = scene(), event = { player: s.p, item: s.items[0] };
  s.actions.Ring(event);
  assert.deepEqual(s.sounds, [[2192, 1, 0], [2192, 1, 8], [2192, 1, 16]]);
  assert.ok(s.p.dialogue instanceof core.ItemStatementDialogue);
  assert.equal(s.p.dialogue.getItemId(), I.COWBELL_AMULET_2);
  assert.equal(s.p.dialogue.getText(), 'You ring the bell.');
  assert.equal(s.events[0][0], 'ides-of-milk:cowbell-ring');
  s.actions.Charge(event);
  assert.ok(s.p.dialogue instanceof core.StatementDialogue);
  assert.equal(s.p.dialogue.getText(), "You don't have any Air Runes to charge the amulet with.");
});

test('charging preserves independent per-item counts, caps at 1000, and rejects stale amount prompts', () => {
  const s = scene(), first = s.items[0], other = new core.Item(I.COWBELL_AMULET, 1);
  s.items.push(other); s.counts.set(I.AIR_RUNE, 2000);
  s.actions.Charge({ player: s.p, item: first }); s.p.entered.execute(1500);
  assert.equal(first.getId(), I.COWBELL_AMULET_2); assert.equal(first.getMetaValue('cowbell-amulet:charges'), 1000);
  assert.equal(other.getMetaValue('cowbell-amulet:charges'), undefined);
  assert.equal(s.counts.get(I.AIR_RUNE), 1000);
  assert.deepEqual(s.varbits.at(-1), [20097, 1000]);
  s.actions.Charge({ player: s.p, item: other });
  s.items.splice(s.items.indexOf(other), 1);
  s.p.entered.execute(500);
  assert.equal(s.counts.get(I.AIR_RUNE), 1000, 'moving the amulet away invalidates the delayed prompt');
});

test('air runes work on either side of item use; unsafe amounts and failed teleports consume nothing', () => {
  const s = scene(), item = s.items[0]; s.counts.set(I.AIR_RUNE, 3);
  s.useItem({ player: s.p, usedItemId: I.AIR_RUNE, usedWithItemId: item.getId(), usedWithItem: item });
  s.p.entered.execute(-1); s.p.entered.execute(1.5);
  assert.equal(s.counts.get(I.AIR_RUNE), 3);
  s.p.entered.execute(2);
  assert.equal(s.counts.get(I.AIR_RUNE), 1);
  s.allowTeleport(false); s.actions.Teleport({ player: s.p, item });
  assert.equal(item.getMetaValue('cowbell-amulet:charges'), 2); assert.equal(s.teleports.length, 0);
  s.allowTeleport(true); s.actions.Teleport({ player: s.p, item });
  assert.equal(item.getMetaValue('cowbell-amulet:charges'), 1); assert.equal(s.teleports.length, 1);
  s.actions.Teleport({ player: s.p, item });
  assert.equal(item.getId(), I.COWBELL_AMULET); assert.equal(item.getMetaValue('cowbell-amulet:charges'), undefined);
  s.actions.Teleport({ player: s.p, item }); assert.equal(s.teleports.length, 2);
});

test('Uncharge refunds the selected worn amulet safely, including a full inventory', () => {
  const s = scene(), item = s.items[0]; s.counts.set(I.AIR_RUNE, 7);
  s.actions.Charge({ player: s.p, item }); s.p.entered.execute(7);
  s.items.pop(); s.equipment[core.Equipment.AMULET_SLOT] = item;
  s.p.full = true; s.actions.Uncharge({ player: s.p, item });
  assert.equal(item.getMetaValue('cowbell-amulet:charges'), 7); assert.equal(s.counts.get(I.AIR_RUNE), 0);
  s.p.full = false; s.actions.Uncharge({ player: s.p, item });
  assert.equal(s.counts.get(I.AIR_RUNE), 7); assert.equal(item.getId(), I.COWBELL_AMULET);
  s.actions.Uncharge({ player: s.p, item }); assert.equal(s.counts.get(I.AIR_RUNE), 7);
});

test('Steal-cowbell is refused before Cold War starts, then keeps its success and full-inventory rules', () => {
  const originalRandom = Math.random;
  let started = false;
  try {
    const tasks = [], handlers = {};
    require('../plugins/objects/DairyCow.plugin').register({ core, getTaskManager: () => ({ submit: task => tasks.push(task) }),
      onObjectInteraction: (name, actions) => { handlers[name] = actions; }, onItemOnObject: noop,
      emitCustomEvent: (name, request) => {
        assert.equal(name, 'quest:is-started');
        assert.equal(request.key, 'cold_war');
        request.started = started;
      },
    });
    assert.equal(handlers['Dairy Cow']['Steal-cowbell'], handlers['Dairy cow']['Steal-cowbell'],
      'both cache name variants share the gated handler');
    const counts = new Map(), messages = [], xp = [];
    let animations = 0, clickResets = 0, full = false;
    const p = {
      getSkillManager: () => ({ getCurrentLevel: () => 99, addExperiences: (skill, amount) => xp.push([skill, amount]) }),
      getClickDelay: () => ({ elapsedTime: () => true, reset: () => { clickResets++; } }),
      getTimers: () => ({ has: () => false }),
      getInventory: () => ({ isFull: () => full, full: () => messages.push('full'),
        adds: (id, amount) => counts.set(id, (counts.get(id) ?? 0) + amount) }),
      getMovementQueue: () => ({ reset: noop }), setPositionToFace: noop,
      performAnimation: () => { animations++; }, sendMessage: text => messages.push(text),
      isRegistered: () => true,
    };
    const click = () => handlers['Dairy cow']['Steal-cowbell']({ player: p, location: new core.Location(3252, 3270, 0) });

    click();
    assert.deepEqual(messages, ['You need to have started Cold War to steal a cowbell.']);
    assert.equal(counts.get(I.COWBELLS), undefined);
    assert.equal(tasks.length, 0, 'a refused click schedules no steal');
    assert.equal(animations, 0, 'a refused click does not play the thieving animation');
    assert.equal(clickResets, 0);

    started = true; full = true; click();
    assert.equal(tasks.length, 0);
    assert.equal(messages.at(-1), 'full', 'the existing full-inventory branch is preserved');

    full = false; Math.random = () => 0; click();
    assert.equal(messages.at(-1), 'You attempt to steal a cowbell...');
    assert.equal(tasks.length, 1);
    tasks[0].execute();
    assert.equal(counts.get(I.COWBELLS), 1);
    assert.deepEqual(xp, [[core.Skill.THIEVING, 16]]);

    click(); tasks[1].execute();
    assert.equal(counts.get(I.COWBELLS), 2, 'started and completed players can steal duplicates');
  } finally {
    Math.random = originalRandom;
  }
});

test('milking takes seven ticks, six with either worn cowbell, and never consumes a cancelled bucket', () => {
  const tasks = [], handlers = {};
  require('../plugins/objects/DairyCow.plugin').register({ core, getTaskManager: () => ({ submit: task => tasks.push(task) }),
    onObjectInteraction: (name, actions) => { handlers[name] = actions; }, onItemOnObject: noop,
  });
  for (const [amuletId, delay] of [[0, 7], [I.COWBELL_AMULET, 6], [I.COWBELL_AMULET_2, 6]]) {
    const s = scene(); s.p.performAnimation = noop; s.p.isRegistered = () => true;
    s.counts.set(I.BUCKET, 1);
    s.equipment[core.Equipment.AMULET_SLOT] = new core.Item(amuletId, 1);
    handlers['Dairy cow'].Milk({ player: s.p });
    assert.equal(s.counts.get(I.BUCKET), 1, 'milk is not granted at click time');
    const task = tasks.at(-1); assert.equal(task.getDelay(), delay); task.execute();
    assert.equal(s.counts.get(I.BUCKET), 0); assert.equal(s.counts.get(I.BUCKET_OF_MILK), 1);
  }
  const moved = scene(); moved.p.performAnimation = noop; moved.p.isRegistered = () => true; moved.counts.set(I.BUCKET, 1);
  handlers['Dairy cow'].Milk({ player: moved.p });
  moved.p.location = new core.Location(3200, 3200, 0); tasks.at(-1).execute();
  assert.equal(moved.counts.get(I.BUCKET), 1); assert.equal(moved.counts.get(I.BUCKET_OF_MILK), undefined);
});
