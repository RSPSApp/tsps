// Build first: node --test tests/hallowed-sepulchre-tools.test.cjs
//
// The Mysterious Stranger's tool storage: Exchange opens hallowed_tools (666) and
// hallowed_tool_side (632) as rev 227 recording 1862 does; the caps are the cache's enum_342
// (Wiki: at most 1 of each tool and 1000 tokens).
const assert = require('node:assert/strict');
const path = require('node:path');
const { test, before } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager: PM } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');

let core, c;
const LOBBY = [2400, 5986, 0];

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  core = PM.getCoreApi();
  c = core.CacheDefinitions;
  require('../plugins/minigames/HallowedSepulchre.plugin').register(PM.createApi('HallowedSepulchre'));
});

function setup() {
  const player = new Player(null), messages = [], scripts = [];
  player.setUsername('hallowedtools');
  player.getSession = () => ({ sendClientPacket: () => true });
  player.sendMessage = (text) => messages.push(text);
  player.moveTo(new core.Location(LOBBY[0], LOBBY[1] - 1, 0));
  player.setNeedsPlacement(false);
  const sender = player.getPacketSender(), script = sender.sendInterfaceScript.bind(sender);
  sender.sendInterfaceScript = (id, ...args) => { scripts.push(id); return script(id, ...args); };
  const npc = core.NPC.create(c.getNpcId('hallowed_lobby_npc_3op'), new core.Location(...LOBBY));
  const exchange = () => PM.emitNpcInteraction({ player, npc, npcId: npc.getId(), clickType: 5, handled: false,
    definition: { getName: () => 'Mysterious Stranger', getActions: () => ['Talk-to', null, 'Trade', 'Collect', 'Exchange'] } });
  const click = (name, opId = 1) => PM.emitInterfaceActionClick({ player, buttonId: c.getComponentId(name), opId, action: opId, handled: false });
  const item = (name) => c.getObjId(name);
  const bit = (name) => sender.getVarbit(c.getVarbitId(name));
  const has = (name) => player.getInventory().getAmount(item(name));
  return { player, sender, messages, scripts, npc, exchange, click, item, bit, has };
}

test('Exchange opens both recorded screens, and a tool goes in and back out', () => {
  const f = setup();
  f.player.getInventory().add(new core.Item(f.item('hallowed_grapple'), 1), false);
  assert.equal(f.exchange(), true);
  assert.equal(f.player.getInterfaceId(), c.getInterfaceId('hallowed_tools'));
  assert.equal(f.sender.isSubInterfaceOpen(c.getInterfaceId('hallowed_tool_side')), true);
  assert.ok(f.scripts.includes(917), 'the main modal background script, as recorded');
  f.click('hallowed_tool_side:grapple');
  assert.equal(f.has('hallowed_grapple'), 0);
  assert.equal(f.bit('hallowed_storage_grapple'), 1);
  f.click('hallowed_tools:grapple');
  assert.equal(f.has('hallowed_grapple'), 1);
  assert.equal(f.bit('hallowed_storage_grapple'), 0);
  assert.deepEqual(f.messages, []);
});

test('the caps: one of each tool, a second stays in the inventory; tokens stop at 1000', () => {
  const f = setup();
  f.player.getInventory().add(new core.Item(f.item('hallowed_hammer'), 1), false);
  f.player.getInventory().add(new core.Item(f.item('hallowed_hammer'), 1), false);
  // Tokens don't stack (cache): 998 are stored already and 5 are carried.
  f.player.setAttribute('hallowed:stored-tools', { token: 998 });
  f.player.getInventory().add(new core.Item(f.item('hallowed_token'), 5), false);
  f.exchange();
  f.click('hallowed_tool_side:hammer');
  f.click('hallowed_tool_side:hammer');
  assert.equal(f.bit('hallowed_storage_hammer'), 1);
  assert.equal(f.has('hallowed_hammer'), 1);
  f.click('hallowed_tool_side:token', 4); // Store-All while Store-1 is selected
  assert.equal(f.bit('hallowed_storage_token'), 1000);
  assert.equal(f.has('hallowed_token'), 3);
});

test('the quantity buttons reorder the ops as the scripts do, and X asks once then reuses it', () => {
  const f = setup();
  f.player.getInventory().add(new core.Item(f.item('hallowed_token'), 20), false);
  f.exchange();
  f.click('hallowed_tools:quantity_5');
  assert.equal(f.bit('farming_tools_selectedquantity'), 1);
  f.click('hallowed_tool_side:token', 1); // Store-5
  assert.equal(f.bit('hallowed_storage_token'), 5);
  f.click('hallowed_tool_side:token', 2); // Store-1
  assert.equal(f.bit('hallowed_storage_token'), 6);
  f.click('hallowed_tools:quantity_x');
  f.player.getEnteredAmountAction().execute(7);
  f.click('hallowed_tools:token', 1); // Remove-X
  assert.equal(f.bit('hallowed_storage_token'), 0, 'only 6 were stored');
  assert.equal(f.has('hallowed_token'), 20);
  f.click('hallowed_tool_side:token', 1); // Store-X: the 7 entered before
  assert.equal(f.bit('hallowed_storage_token'), 7);
  f.click('hallowed_tools:quantity_all');
  f.click('hallowed_tool_side:token', 1); // Store-All
  assert.equal(f.bit('hallowed_storage_token'), 20);
});

test('Withdraw and Deposit move everything, a full inventory keeps the rest stored, and it is saved', () => {
  const f = setup();
  for (const name of ['hallowed_grapple', 'hallowed_focus', 'hallowed_symbol', 'hallowed_ring']) f.player.getInventory().add(new core.Item(f.item(name), 1), false);
  f.player.getInventory().add(new core.Item(f.item('hallowed_token'), 3), false);
  f.exchange();
  f.click('hallowed_tool_side:store_all');
  assert.equal(f.player.getInventory().getFreeSlots(), 28);
  assert.deepEqual(f.player.getAttribute('hallowed:stored-tools'), { token: 3, grapple: 1, focus: 1, symbol: 1, ring: 1 });
  // Four free slots: the three tokens (they don't stack) and the grapple come out, the rest stays.
  for (let slot = 0; slot < 24; slot++) f.player.getInventory().setItem(slot, new core.Item(c.getObjId('logs'), 1));
  f.click('hallowed_tools:withdrawal_all');
  assert.equal(f.has('hallowed_token'), 3);
  assert.equal(f.has('hallowed_grapple'), 1);
  assert.deepEqual(f.player.getAttribute('hallowed:stored-tools'), { focus: 1, symbol: 1, ring: 1 });
  assert.equal(f.messages.length, 1, 'one inventory-full message');
});

test('nothing moves once the player walks off or the screen is closed', () => {
  const f = setup();
  f.player.getInventory().add(new core.Item(f.item('hallowed_symbol'), 1), false);
  f.exchange();
  f.player.moveTo(new core.Location(LOBBY[0], LOBBY[1] - 10, 0));
  f.click('hallowed_tool_side:symbol');
  assert.equal(f.has('hallowed_symbol'), 1);
  f.player.moveTo(new core.Location(LOBBY[0], LOBBY[1] - 1, 0));
  f.exchange();
  f.sender.sendInterfaceRemoval();
  f.click('hallowed_tool_side:symbol');
  assert.equal(f.has('hallowed_symbol'), 1);
  assert.equal(f.bit('hallowed_storage_symbol'), 0);
});
