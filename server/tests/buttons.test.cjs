// Run after yarn build: node --test tests/buttons.test.cjs
const assert = require('node:assert/strict');
const path = require('node:path');
const { before, test } = require('node:test');
require('../dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager: PM } = require('../dist/plugins/PluginManager');
const { ClientConnection } = require('../dist/net/NetworkBuilder');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { PlayerSession } = require('../dist/net/PlayerSession');
const { ItemActionPacketListener } = require('../dist/net/packet/impl/ItemActionPacketListener');
let core;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  core = PM.getCoreApi();
  require('../plugins/skills/Crafting.plugin').register(PM.createApi('Crafting'));
});

function actor(t, level = 3) {
  const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true,
    send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(2934);
  p.setUsername('button-test');
  p.setRegistered(true);
  p.getSkillManager().setMaxLevels(core.Skill.CRAFTING, level, false)
    .setCurrentLevels(core.Skill.CRAFTING, level, false);
  const xp = [], messages = [];
  t.mock.method(p.getSkillManager(), 'addExperiences', (skill, amount) => { xp.push([skill, amount]); return p.getSkillManager(); });
  t.mock.method(p.getPacketSender(), 'sendTypedMessage', (_type, message) => { messages.push(message); return p.getPacketSender(); });
  t.after(() => { p.setRegistered(false); core.TaskManager.cancelTasks(p); });
  const c = new ClientConnection(channel); c.player = p;
  const inv = p.getInventory();
  inv.setItem(0, new core.Item(core.ItemIds.BUTTONS, 1));
  return { p, c, inv, xp, messages };
}

async function click(f, itemId = core.ItemIds.BUTTONS, option = 'Polish') {
  await f.c.dispatch([{ type: 'inventory_action', widgetId: core.Inventory.INTERFACE_ID,
    slot: 0, itemId, option, optionIndex: 2 }]);
  f.c.processTurnPackets();
}

test('cache Polish action converts one item in a full inventory and awards 5 base XP once', async t => {
  const f = actor(t);
  const input = core.ItemIds.BUTTONS, output = core.ItemIds.POLISHED_BUTTONS;
  assert.equal(input, 688); assert.equal(output, 10496);
  assert.deepEqual(ItemActionPacketListener.resolveInventoryWidgetAction(input, 3), { optionIndex: 2, option: 'Polish' });
  assert.equal(core.CacheDefinitions.getItem(output).name, 'Polished buttons');
  assert.equal(core.ItemDefinition.forId(input).isStackable(), false);
  for (let slot = 1; slot < 28; slot++) f.inv.setItem(slot, new core.Item(input, 1));
  await click(f);
  assert.equal(f.inv.getItems()[0].getId(), output);
  assert.equal(f.inv.getAmount(input), 27);
  assert.equal(f.inv.getAmount(output), 1);
  assert.deepEqual(f.xp, [[core.Skill.CRAFTING, 5]]);
  assert.deepEqual(f.messages, ['You rub the buttons on your clothes and they become more shiny.']);
  await click(f); // stale second click cannot polish a different slot or award again
  assert.equal(f.inv.getAmount(output), 1);
  assert.equal(f.xp.length, 1);
});

test('below level 3 leaves buttons and XP unchanged, with Wiki refusal', async t => {
  const f = actor(t, 2);
  await click(f);
  assert.equal(f.inv.getItems()[0].getId(), core.ItemIds.BUTTONS);
  assert.deepEqual(f.xp, []);
  assert.deepEqual(f.messages, ["You rub the buttons on your clothes but they aren't improved by the process."]);
});

test('wrong item, wrong action and empty stale slot cannot convert or award', async t => {
  const f = actor(t);
  await click(f, core.ItemIds.POLISHED_BUTTONS);
  await click(f, core.ItemIds.BUTTONS, 'Check');
  assert.equal(f.inv.getItems()[0].getId(), core.ItemIds.BUTTONS);
  f.inv.setItem(0, new core.Item(-1, 0));
  await click(f);
  assert.deepEqual(f.xp, []);
  assert.deepEqual(f.messages, []);
});

test('members-only polish does not run on a free world', async t => {
  const f = actor(t);
  t.mock.method(core.WorldDefinition, 'isMembersWorld', () => false);
  await click(f);
  assert.equal(f.inv.getItems()[0].getId(), core.ItemIds.BUTTONS);
  assert.deepEqual(f.xp, []);
  assert.deepEqual(f.messages, []);
});
