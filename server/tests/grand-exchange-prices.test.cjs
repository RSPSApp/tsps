// Run after `yarn build`: node --test tests/grand-exchange-prices.test.cjs
const assert = require('node:assert/strict');
const path = require('node:path');
const { before, test } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { CacheDefinitions } = require('../dist/game/cache/CacheDefinitions');
const { ItemDefinition } = require('../dist/game/definition/ItemDefinition');
const { PluginManager } = require('../dist/plugins/PluginManager');

const PRICELIST = 237;
const MAIN_MODAL = (161 << 16) | 16;
const LIST = (PRICELIST << 16) | 2;
const DISPLAY_MODE = (PRICELIST << 16) | 4;
const MODE_VARBIT = 4440;
const EXAMINE = 1 << 10;
const EXPERTS = {
  'Farid Morrisane (ores and bars)': [118, 'Ores and Bars', 32],
  'Murky Matt (runes)': [119, 'Runes', 23],
  'Bob Barter (herbs)': [120, 'Herbs and Potions', 80],
  'Relobo Blinyo (logs)': [433, 'Logs', 11],
  'Hofuthand (weapons and armour)': [434, 'Weapons and Armour', 98],
};

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
});

function harness() {
  const npcs = new Map(), buttons = new Map();
  require('../plugins/interface/grandexchange/Prices.GrandExchange')({
    core: PluginManager.getCoreApi(),
    onNpcsInteraction: (names, actions) => { for (const name of names) npcs.set(name, actions); },
    onInterfaceActionButton: (id, handler) => buttons.set(id, handler),
  }, (id) => id * 10);
  function player() {
    const calls = [], messages = [], varbits = new Map();
    let interfaceId = -1;
    const sender = new Proxy({}, { get: (_, method) => {
      if (method === 'getVarbit') return (id) => varbits.get(id) ?? 0;
      return (...args) => {
        calls.push([method, ...args]);
        if (method === 'sendInterfaceRemoval') interfaceId = -1;
        if (method === 'sendVarbit') varbits.set(args[0], args[1]);
        return sender;
      };
    } });
    return {
      calls, messages, varbits,
      getMovementQueue: () => ({ reset() {} }),
      getInterfaceId: () => interfaceId, setInterfaceId: (id) => { interfaceId = id; },
      getPacketSender: () => sender, sendMessage: (message) => messages.push(message),
    };
  }
  const prices = (p, name) => npcs.get(name).Prices({ player: p, definition: { getName: () => name } });
  return { npcs, buttons, player, prices };
}

test('every pricing expert in the cache offers Prices, and each one has its list', () => {
  const offering = new Set();
  for (let id = 0; id < CacheDefinitions.getCounts().npcs; id++) {
    const npc = CacheDefinitions.getNpc(id);
    if (npc?.name in EXPERTS && npc.actions?.includes('Prices')) offering.add(npc.name);
  }
  assert.deepEqual([...offering].sort(), Object.keys(EXPERTS).sort());
  const h = harness();
  assert.deepEqual([...h.npcs.keys()].sort(), Object.keys(EXPERTS).sort());
});

test('Prices opens ge_pricelist on the expert\'s inventory of guide prices, under its title', () => {
  const h = harness();
  for (const [name, [inventory, title, size]] of Object.entries(EXPERTS)) {
    const p = h.player();
    assert.equal(h.prices(p, name), true);
    assert.equal(p.getInterfaceId(), PRICELIST);
    const inv = p.calls.find(([method]) => method === 'sendInventory');
    assert.equal(inv[1], inventory, name);
    assert.equal(inv[2], size, name);
    assert.equal(inv[3].length, size);
    for (const { id, amount } of inv[3]) assert.equal(amount, id * 10, `${name}: ${id} at its guide price`);
    assert.ok(p.calls.some(([m, parent, group, type]) => m === 'sendSubInterface' && parent === MAIN_MODAL && group === PRICELIST && type === 0));
    assert.ok(p.calls.some(([m, script, args]) => m === 'sendInterfaceScript' && script === 799
      && args[0] === inventory && args[1] === title));
    assert.ok(p.calls.some(([m, uid, first, last, flags]) => m === 'sendInterfaceFlagsRange'
      && uid === LIST && first === 0 && last === size - 1 && flags === EXAMINE));
  }
});

test('the herb expert\'s list starts with vials and grimy guam, as live', () => {
  const h = harness(), p = h.player();
  h.prices(p, 'Bob Barter (herbs)');
  const items = p.calls.find(([method]) => method === 'sendInventory')[3].map(({ id }) => id);
  assert.deepEqual(items.slice(0, 4), [229, 227, 199, 249]);
});

test('Examine on a list entry examines that item; other ops and a closed list do nothing', () => {
  const h = harness(), p = h.player();
  h.prices(p, 'Relobo Blinyo (logs)');
  assert.equal(h.buttons.get(LIST)({ player: p, buttonId: LIST, slot: 0, action: 10 }), true);
  const logs = ItemDefinition.forId(1511);
  assert.equal(p.messages[0], logs.getExamine() || logs.getName());
  assert.equal(h.buttons.get(LIST)({ player: p, buttonId: LIST, slot: 0, action: 1 }), false);
  assert.equal(h.buttons.get(LIST)({ player: p, buttonId: LIST, slot: 99, action: 10 }), false);
  p.setInterfaceId(-1);
  assert.equal(h.buttons.get(LIST)({ player: p, buttonId: LIST, slot: 0, action: 10 }), false);
  assert.equal(p.messages.length, 1);
});

test('the display mode button toggles ge_pricelist_mode while the list is open', () => {
  const h = harness(), p = h.player();
  h.prices(p, 'Murky Matt (runes)');
  h.buttons.get(DISPLAY_MODE)({ player: p, buttonId: DISPLAY_MODE });
  assert.equal(p.varbits.get(MODE_VARBIT), 1);
  h.buttons.get(DISPLAY_MODE)({ player: p, buttonId: DISPLAY_MODE });
  assert.equal(p.varbits.get(MODE_VARBIT), 0);
});
