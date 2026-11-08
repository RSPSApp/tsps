// Run after `yarn build`: node --test tests/magic-dart.test.cjs
const assert = require('node:assert/strict');
const { before, test } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { NpcDefinitionLoader } = require('../dist/game/definition/loader/impl/NpcDefinitionLoader');
const { PluginManager } = require('../dist/plugins/PluginManager');
const plugin = require('../plugins/items/SlayersStaff.plugin');
const core = PluginManager.getCoreApi();
const I = core.ItemIdentifiers;
const DART = core.CombatSpells.MAGIC_DART;

before(async () => {
  await CachePipeline.initialize(process.cwd());
  new NpcDefinitionLoader().load();
});

function fixture(t, { onTask = true } = {}) {
  const player = new Player(null);
  const messages = [];
  const handlers = { custom: new Map(), disabled: [], itemOnItem: [] };
  player.setRegistered(true);
  t.mock.method(player, 'getSession', () => ({ sendClientPacket: () => true }));
  t.mock.method(player, 'sendMessage', (message) => messages.push(message));
  const api = {
    core,
    onSpellDisabled(handler) { handlers.disabled.push(handler); },
    onItemOnItem(a, b, handler) { handlers.itemOnItem.push({ a, b, handler }); },
    onCustomEvent(name, handler) { handlers.custom.set(name, [...(handlers.custom.get(name) ?? []), handler]); },
    emitCustomEvent(name, event) {
      if (name === 'slayer:on-task') event.onTask = onTask;
    },
  };
  plugin.register(api);
  const emit = (name, event) => { for (const handler of handlers.custom.get(name) ?? []) handler(event); };
  const npc = { isNpc: () => true, isPlayer: () => false, getAsNpc() { return this; } };
  const attacker = { isPlayer: () => true, getAsPlayer: () => player };
  return {
    player, messages, handlers, npc,
    wield(id) {
      player.getEquipment().setItem(core.Equipment.WEAPON_SLOT, new core.Item(id));
      return player.getEquipment().get(core.Equipment.WEAPON_SLOT);
    },
    levels(magic, slayer) {
      player.getSkillManager().setCurrentLevel(core.Skill.MAGIC, magic);
      player.getSkillManager().setCurrentLevel(core.Skill.SLAYER, slayer);
    },
    refused() {
      const event = { player, spell: DART, disabled: null };
      for (const handler of handlers.disabled) handler(event);
      return event.disabled === true;
    },
    maximum(magic) {
      player.getSkillManager().setCurrentLevel(core.Skill.MAGIC, magic);
      const request = { attacker, target: npc, spell: DART, maxHit: DART.maximumHit() };
      emit('combat:magic-base-max-hit', request);
      return request.maxHit;
    },
    hit() { emit('magic:hit-effects-applied', { attacker, target: npc, spell: DART }); },
  };
}

test('Magic Dart needs 55 Slayer', (t) => {
  const f = fixture(t);
  f.wield(I.SLAYERS_STAFF);
  f.levels(99, 54);
  assert.equal(f.refused(), true);
  f.levels(99, 55);
  assert.equal(f.refused(), false);
});

test('Magic Dart casts from the six staves and from nothing else', (t) => {
  const f = fixture(t);
  f.levels(99, 99);
  for (const id of [I.SLAYERS_STAFF, I.SLAYERS_STAFF_E_, I.STAFF_OF_THE_DEAD, I.TOXIC_STAFF_OF_THE_DEAD, I.STAFF_OF_LIGHT, I.STAFF_OF_BALANCE]) {
    f.wield(id);
    assert.equal(f.refused(), false, `item ${id}`);
  }
  f.wield(I.STAFF_OF_FIRE);
  assert.equal(f.refused(), true);
  assert.deepEqual(f.messages.at(-1), 'You do not have the required equipment to cast this spell.');
});

test('Magic Dart max hit is Magic / 10 + 10 (Wiki table: 15 at 50-59, 19 at 90-99)', (t) => {
  const f = fixture(t);
  f.wield(I.SLAYERS_STAFF);
  assert.equal(f.maximum(50), 15);
  assert.equal(f.maximum(59), 15);
  assert.equal(f.maximum(60), 16);
  assert.equal(f.maximum(90), 19);
  assert.equal(f.maximum(99), 19);
  assert.equal(f.maximum(100), 20);
});

test('the enchanted staff on task hits for Magic / 6 + 13, off task for the plain formula', (t) => {
  const task = fixture(t);
  task.wield(I.SLAYERS_STAFF_E_);
  assert.equal(task.maximum(75), 25);
  assert.equal(task.maximum(108), 31);
  const off = fixture(t, { onTask: false });
  off.wield(I.SLAYERS_STAFF_E_);
  assert.equal(off.maximum(75), 17);
  const plain = fixture(t);
  plain.wield(I.STAFF_OF_THE_DEAD);
  assert.equal(plain.maximum(75), 17);
});

test('each hit on task spends a charge and the last one reverts the staff', (t) => {
  const f = fixture(t);
  const staff = f.wield(I.SLAYERS_STAFF_E_);
  assert.equal(plugin._test.chargesOf(staff), 2500);
  f.hit();
  assert.equal(plugin._test.chargesOf(staff), 2499);
  plugin._test.setCharges(staff, 1);
  f.hit();
  assert.equal(f.player.getEquipment().get(core.Equipment.WEAPON_SLOT).getId(), I.SLAYERS_STAFF);
});

test('hits off task and with other staves spend nothing', (t) => {
  const off = fixture(t, { onTask: false });
  const staff = off.wield(I.SLAYERS_STAFF_E_);
  off.hit();
  assert.equal(plugin._test.chargesOf(staff), 2500);
});

test('a Slayer enchantment on a Slayer staff makes an enchanted staff with 2,500 charges', (t) => {
  const f = fixture(t);
  const inv = f.player.getInventory();
  inv.add(new core.Item(I.SLAYERS_STAFF, 1));
  inv.add(new core.Item(I.SLAYERS_ENCHANTMENT, 1));
  const event = { player: f.player, usedItemId: I.SLAYERS_ENCHANTMENT, usedItemSlot: 1, usedWithItemId: I.SLAYERS_STAFF, usedWithItemSlot: 0, handled: false };
  f.handlers.itemOnItem[0].handler(event);
  assert.equal(event.handled, true);
  assert.equal(inv.getAmount(I.SLAYERS_STAFF_E_), 1);
  assert.equal(inv.getAmount(I.SLAYERS_ENCHANTMENT), 0);
  assert.equal(inv.getAmount(I.SLAYERS_STAFF), 0);
});
