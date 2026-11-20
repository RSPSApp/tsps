// Run after `yarn build`: node --test tests/clue-scroll-alchemy.test.cjs
// Alchemy on a clue scroll asks "Wouldn't you rather solve the clue?" alone in the item box, then
// the Proceed/Cancel menu titled with the clue's name (rsprox captures, recording 1000473, a hard
// clue), whatever the All Settings untradeable alchemy row says; other clue forms keep the
// untradeable warning.
const assert = require('node:assert/strict');
const path = require('node:path');
const { test, before } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager } = require('../dist/plugins/PluginManager');
const { Item } = require('../dist/game/model/Item');
const { MagicOnItemPacketListener } = require('../dist/net/packet/impl/MagicOnItemPacketListener');
const { MagicSpellbook } = require('../dist/game/model/MagicSpellbook');
const { Sounds } = require('../dist/game/Sounds');
const { World } = require('../dist/game/World');
const { TaskManager } = require('../dist/game/task/TaskManager');
const { Dialogue } = require('../dist/game/model/dialogues/entries/Dialogue');
const Warnings = require('../plugins/interface/ValueWarnings.plugin');
const Capacity = require('../plugins/treasuretrails/Capacity.ClueCapacity');
const ItemDefinitionLoader = require('../plugins/items/ItemDefinitionLoader.plugin');

const HIGH_ALCHEMY = 1178;
const LOW_ALCHEMY = 1162;
const NATURE_RUNE = 561;
const FIRE_RUNE = 554;
const COINS = 995;
const QUESTION = "Wouldn't you rather solve the clue?";

let core;

before(async () => {
  // The server's own data, so the clues carry their real alch values (item-alch.json).
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  core = PluginManager.getCoreApi();
  ItemDefinitionLoader._test.loadItemAlch();
  Warnings._test.setApi({ core, emitCustomEvent: () => {} });
  const api = { core };
  Capacity(new Proxy(api, { get: (t, p) => (p in t ? t[p] : () => {}) }));
});

/** A player with the All Settings alchemy rows in `vars`, logging the boxes and chat lines it was shown. */
function player(vars, items) {
  const log = { messages: [], typed: [], dialogues: [] };
  const slots = [...items];
  const sender = {
    getVarbit: (id) => vars[id] ?? 0,
    sendClientScript() { return sender; },
    sendInterfaceRemoval() { return sender; },
    sendTab() { return sender; },
    sendTypedMessage(type, text) { log.typed.push(text); return sender; },
  };
  const attributes = new Map();
  const amounts = new Map([[NATURE_RUNE, 100], [FIRE_RUNE, 500]]);
  const inventory = {
    capacity: () => 28,
    getItems: () => slots,
    setItem(slot, item) { slots[slot] = item?.getId() === -1 ? null : item; return { refreshItems() {} }; },
    getAmount: (id) => amounts.get(id) || 0,
    contains: (id) => (amounts.get(id) || 0) > 0,
    getAddableAmount: (item) => item.getAmount(),
    deleteNumber(id, amount) { amounts.set(id, (amounts.get(id) || 0) - amount); },
    deleteAtSlot(slot) { slots[slot] = null; },
    adds: (id, amount) => amounts.set(id, (amounts.get(id) || 0) + amount),
  };
  const self = {
    log, slots, amounts,
    getPacketSender: () => sender,
    getInventory: () => inventory,
    getAttribute: (k) => attributes.get(k),
    setAttribute: (k, v) => attributes.set(k, v),
    sendMessage: (m) => log.messages.push(m),
    getDialogueManager: () => ({ startDialogues: (chain) => { log.dialogues.push([...chain.getDialogues().values()]); Dialogue.sendBoxChatLine(self, chain.getDialogues().get(0)?.getText?.()); } }),
    getHitpoints: () => 99,
    busy: () => false,
    getRights: () => null,
    getSkillManager: () => ({ stopSkillable() {}, getCurrentLevel: () => 99, addExperiences() {} }),
    getSpellbook: () => MagicSpellbook.NORMAL,
    getEquipment: () => ({ getWeapon: () => null }),
    isRegistered: () => true,
    performAnimation() {},
    performGraphic() {},
  };
  return self;
}

/** The first cache item named `name`, with its loaded definition (untradeable, real alch values). */
function named(name) {
  for (let id = 0; id < 40000; id++) {
    if (core.ItemDefinition.forId(id)?.getName?.() !== name) continue;
    const item = new Item(id, 1);
    assert.equal(item.getDefinition().isTradeable(), false, `${name} is untradeable`);
    return item;
  }
  throw new Error(`no item named ${name}`);
}

function harness(t) {
  t.mock.method(World, 'getProcessCycle', () => 1000);
  t.mock.method(TaskManager, 'submit', () => {});
  t.mock.method(Sounds, 'sendSound', () => {});
  t.mock.method(PluginManager, 'emitCustomEvent', (name, payload) => {
    if (name !== 'magic:alchemy-warning') return;
    Warnings._test.alchemyWarning(payload);
    Capacity.clueAlchemy(payload);
  });
  return new MagicOnItemPacketListener();
}

test('Low Alchemy on a hard clue scroll asks "Wouldn\'t you rather solve the clue?" alone, then alchs it on Proceed', (t) => {
  const listener = harness(t);
  const clue = named('Clue scroll (hard)');
  const p = player({ 6092: 1 }, [clue]);
  listener.castOnItem(p, LOW_ALCHEMY, clue.getId(), 0);
  assert.equal(p.log.dialogues.length, 1);
  const [statement, options] = p.log.dialogues[0];
  assert.equal(statement.getText(), QUESTION, 'no untradeable line, no "Really cast" line');
  assert.deepEqual(p.log.typed, [QUESTION], 'the box copies its line to the chat once');
  assert.deepEqual(p.log.messages, []);
  assert.equal(options.getTitle(), 'Clue scroll (hard)');
  assert.deepEqual(options.getOptions(), ['Proceed to cast Low Level Alchemy on it.', 'Cancel the alchemy spell.']);
  assert.equal(p.amounts.get(COINS), undefined, 'nothing cast before the answer');
  options.execute(1);
  assert.equal(p.amounts.get(COINS), 8, "a hard clue's Low Alchemy value (item-alch.json)");
  assert.equal(p.slots[0], null, 'the clue is gone');
});

test('Cancel keeps the clue; every tier asks, with the untradeable alchemy row off too', (t) => {
  const listener = harness(t);
  const hard = named('Clue scroll (hard)');
  const kept = player({ 6092: 1 }, [hard]);
  listener.castOnItem(kept, HIGH_ALCHEMY, hard.getId(), 0);
  kept.log.dialogues[0][1].execute(2);
  assert.equal(kept.slots[0], hard);
  assert.equal(kept.amounts.get(COINS), undefined);
  for (const tier of ['beginner', 'easy', 'medium', 'hard', 'elite', 'master']) {
    const clue = named(`Clue scroll (${tier})`);
    const p = player({ 6092: 0 }, [clue]);
    listener.castOnItem(p, HIGH_ALCHEMY, clue.getId(), 0);
    assert.equal(p.log.dialogues.length, 1, tier);
    assert.equal(p.log.dialogues[0][0].getText(), QUESTION, tier);
  }
});

test('a scroll box keeps the untradeable warning, or none with that row off', (t) => {
  const listener = harness(t);
  const box = named('Scroll box (hard)');
  const on = player({ 6092: 1 }, [box]);
  listener.castOnItem(on, HIGH_ALCHEMY, box.getId(), 0);
  assert.match(on.log.dialogues[0][0].getText(), /^That item cannot be traded\.<br>Really cast High Level Alchemy on it\?$/);
  const off = player({ 6092: 0 }, [named('Scroll box (hard)')]);
  listener.castOnItem(off, HIGH_ALCHEMY, box.getId(), 0);
  assert.equal(off.log.dialogues.length, 0);
  assert.equal(off.amounts.get(COINS), box.getDefinition().getHighAlchValue());
  assert.ok(off.amounts.get(COINS) > 0);
});
