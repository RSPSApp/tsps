// Run after `yarn build`: node --test tests/barrows-drop-degrade.test.cjs
// Issue 6061: a Barrows piece breaks only once its drop warnings are answered and it lands, so a
// cancelled warning keeps it and a confirmed one drops it in that click; and its degradation starts
// on the first swing of a fight, not when Attack picks a target the player is still running at.
const assert = require('node:assert/strict');
const { test, before } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager } = require('../dist/plugins/PluginManager');
const { Item } = require('../dist/game/model/Item');
const { DropItemPacketListener } = require('../dist/net/packet/impl/DropItemPacketListener');
const { ItemOnGroundManager } = require('../dist/game/entity/impl/grounditem/ItemOnGroundManager');
const { Wilderness } = require('../dist/game/content/wilderness/Wilderness');
const { Sounds } = require('../dist/game/Sounds');
const { ItemStatementDialogue } = require('../dist/game/model/dialogues/entries/impl/ItemStatementDialogue');
const { OptionDialogue } = require('../dist/game/model/dialogues/entries/impl/OptionDialogue');
const { Barrows } = require('../dist/game/content/combat/Barrows');
const Warnings = require('../plugins/interface/ValueWarnings.plugin');
const BarrowsEquipment = require('../plugins/items/BarrowsEquipment.plugin');

const DHAROKS_HELM = 4716;
const DHAROKS_HELM_100 = 4880;
const DHAROKS_HELM_0 = 4884;
const INVENTORY = 3214;
const DROP_WARNING_ON = 5411;
const DROP_WARNING_VALUE = 5412;

let core;
let cycle = 0;
const listeners = new Map();
let loginHandler;
let task;
let combat = false;

before(async () => {
  await CachePipeline.initialize();
  core = Object.create(PluginManager.getCoreApi());
  Object.defineProperty(core, 'World', { value: { getProcessCycle: () => cycle } });
  // Every hook the plugin registers is a no-op here but the ones the tests drive.
  const api = new Proxy({
    core,
    onCustomEvent: (name, handler) => listeners.set(name, [...(listeners.get(name) ?? []), handler]),
    onPlayerLogin: (handler) => { loginHandler = handler; },
    getBonusManager: () => ({ update() {} }),
    getTaskManager: () => ({ submit: (submitted) => { task = submitted; } }),
    getCombatFactory: () => ({ inCombat: () => combat }),
    sendMultiChatboxPrompt() {},
  }, { get: (target, key) => (key in target ? target[key] : () => {}) });
  BarrowsEquipment.register(api);
  Warnings._test.setApi({ core, emitCustomEvent() {} });
});

function emit(name, payload) {
  for (const handler of listeners.get(name) ?? []) handler(payload);
}

function player(vars, items) {
  const log = { dialogues: [], messages: [] };
  const slots = [...items];
  const sender = {
    getVarbit: (id) => vars[id] ?? 0,
    sendVarbit() { return sender; },
    sendTypedMessage() {},
    sendInterfaceRemoval() { return sender; },
    closeChatboxFor: () => true,
  };
  const inventory = {
    capacity: () => 28,
    getItems: () => slots,
    setItem(slot, item) { slots[slot] = item?.getId() === -1 ? null : item; return { refreshItems() {} }; },
  };
  return {
    log, slots,
    isPlayer: () => true,
    getPacketSender: () => sender,
    getInventory: () => inventory,
    getAttribute: () => undefined,
    setAttribute() {},
    sendMessage: (m) => log.messages.push(m),
    getDialogueManager: () => ({ startDialogues: (chain) => log.dialogues.push([...chain.getDialogues().values()]) }),
    getHitpoints: () => 99,
    busy: () => false,
    getRights: () => null,
    getSkillManager: () => ({ stopSkillable() {} }),
  };
}

/** The real drop path, with this plugin and the value warning hearing its events as they do in game. */
function harness(t) {
  const landed = [];
  t.mock.method(PluginManager, 'emitItemDropPolicy', () => false);
  t.mock.method(PluginManager, 'emitCustomEvent', (name, payload) => {
    if (name === 'item:drop-warning') {
      emit(name, payload);
      Warnings._test.dropWarning(payload);
    } else if (name === 'item:dropping') {
      emit(name, payload);
    }
  });
  t.mock.method(ItemOnGroundManager, 'registers', (_p, item) => landed.push(item.getId()));
  t.mock.method(Wilderness, 'isIn', () => false);
  t.mock.method(Sounds, 'sendSound', () => {});
  return landed;
}

test('dropping a Barrows piece warns first and leaves it whole until the warning is answered', (t) => {
  const landed = harness(t);
  const p = player({}, [new Item(DHAROKS_HELM, 1)]);
  DropItemPacketListener.drop(p, DHAROKS_HELM, INVENTORY, 0);
  const [box, options] = p.log.dialogues[0];
  assert.ok(box instanceof ItemStatementDialogue);
  assert.equal(box.getText(), BarrowsEquipment._test.DROP_WARNING_TEXT);
  assert.ok(options instanceof OptionDialogue);
  assert.equal(p.slots[0].getId(), DHAROKS_HELM, 'nothing breaks while the warning is open');
  options.execute(2);
  assert.equal(p.slots[0].getId(), DHAROKS_HELM, 'a cancelled drop keeps the piece unbroken');
  assert.deepEqual(landed, []);
  options.execute(1);
  assert.deepEqual(landed, [DHAROKS_HELM_0], 'the confirmed drop lands at once, broken');
  assert.equal(p.slots[0], null);
});

test('with the valuable item warning on, both ask in turn and the piece breaks only as it lands', (t) => {
  const landed = harness(t);
  // The tradeable, undegraded helm: a used stage has no worth for the value warning.
  const p = player({ [DROP_WARNING_ON]: 1, [DROP_WARNING_VALUE]: 1 }, [new Item(DHAROKS_HELM, 1)]);
  DropItemPacketListener.drop(p, DHAROKS_HELM, INVENTORY, 0);
  p.log.dialogues[0][1].execute(1);
  assert.equal(p.log.dialogues.length, 2, 'the value warning asks next');
  assert.equal(p.slots[0].getId(), DHAROKS_HELM);
  assert.equal(p.log.dialogues[1][1].getTitle(), "Dharok's helm: Really put it down?", 'it names the unbroken piece');
  p.log.dialogues[1][1].execute(2);
  assert.equal(p.slots[0].getId(), DHAROKS_HELM, "no to the value warning keeps the piece unbroken");
  p.log.dialogues[1][1].execute(1);
  assert.deepEqual(landed, [DHAROKS_HELM_0]);
  assert.equal(p.slots[0], null);
});

test('a broken piece has nothing to lose and drops without the warning', (t) => {
  const landed = harness(t);
  const p = player({}, [new Item(DHAROKS_HELM_0, 1)]);
  DropItemPacketListener.drop(p, DHAROKS_HELM_0, INVENTORY, 0);
  assert.equal(p.log.dialogues.length, 0);
  assert.deepEqual(landed, [DHAROKS_HELM_0]);
});

test('degradation starts on the first swing, a tick later, not when Attack picks a target', () => {
  const items = new Array(14).fill(null).map(() => new Item(-1));
  items[0] = new Item(DHAROKS_HELM);
  const p = {
    isPlayer: () => true,
    getEquipment: () => ({ getItems: () => items, get: (slot) => items[slot], refreshItems() {} }),
    getInventory: () => ({ getItems: () => [], refreshItems() {} }),
    getUpdateFlag: () => ({ flag() {} }),
    sendMessage() {},
  };
  loginHandler({ player: p });
  const tick = (count = 1) => { for (let i = 0; i < count; i++) { cycle++; task.execute(); } };
  const npc = { isPlayer: () => false };

  combat = true; // Attack clicked: the player has a target and runs at it.
  tick(10);
  assert.equal(items[0].getId(), DHAROKS_HELM, 'running at the target does not degrade');
  emit('combat:attack-started', { attacker: p, target: npc });
  task.execute(); // the swing's own tick
  assert.equal(items[0].getId(), DHAROKS_HELM);
  tick();
  assert.equal(items[0].getId(), DHAROKS_HELM_100, 'the tick after the first swing turns it 100');
  assert.equal(BarrowsEquipment._test.durability(items[0]), 999);

  combat = false;
  tick(5);
  combat = true; // a new fight: the target picked, no swing yet
  tick(200);
  assert.equal(BarrowsEquipment._test.durability(items[0]), 999, 'no swing in the new fight, no wear');
  emit('combat:attack-started', { attacker: npc, target: p }); // being swung at counts too
  tick();
  assert.equal(BarrowsEquipment._test.durability(items[0]), 998);
  assert.equal(Barrows.stageOf(items[0].getId()), 0);
});
