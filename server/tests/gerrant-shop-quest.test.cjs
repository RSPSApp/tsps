// Exercise Gerrant through the registered NPC and shop packet routes.
const assert = require('node:assert/strict');
const path = require('node:path');
const { before, after, test } = require('node:test');
require('../dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager: PM } = require('../dist/plugins/PluginManager');
const { ShopDefinitionLoader } = require('../dist/game/definition/loader/impl/ShopDefinitionLoader');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { PlayerSession } = require('../dist/net/PlayerSession');
const { ClientConnection } = require('../dist/net/NetworkBuilder');
let core, next = 6000, pluginsLoading = false;
const oldBots = process.env.DISABLE_PLAYER_BOTS;
const oldError = console.error, oldWarn = console.warn, hookErrors = [];
function attempt(errors, fn) { try { fn(); } catch (error) { errors.push(error); } }

before(async () => {
  process.env.DISABLE_PLAYER_BOTS = '1';
  console.error = (...args) => { if (/^\[plugins\].*hook failed/.test(String(args[0]))) hookErrors.push(args.map(String).join(' ')); oldError(...args); };
  console.warn = (...args) => { if (/^\[plugins\].*hook (?:failed|threw)/.test(String(args[0]))) hookErrors.push(args.map(String).join(' ')); oldWarn(...args); };
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  pluginsLoading = true;
  PM.loadFromDirectory(path.resolve(__dirname, '../plugins'));
  core = PM.getCoreApi();
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(3013, 3225);
  PM.emitServerStartup({});
  assert.equal(new ShopDefinitionLoader().load(), true);
  core.ShopManager.initialize();
});
after(() => {
  const errors = [];
  attempt(errors, () => { if (pluginsLoading) PM.emitServerShutdown({}); });
  console.error = oldError; console.warn = oldWarn;
  if (oldBots === undefined) delete process.env.DISABLE_PLAYER_BOTS;
  else process.env.DISABLE_PLAYER_BOTS = oldBots;
  attempt(errors, () => assert.deepEqual(hookErrors, [], 'no caught plugin hook failures'));
  if (errors.length) throw new AggregateError(errors, 'fixture shutdown failed');
});

function setup(t, stage) {
  core.ShopManager.reload();
  const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true,
    send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const player = new Player(new PlayerSession(channel));
  const ownedNpcs = [];
  let loggedIn = false;
  t.after(() => {
    const errors = [];
    attempt(errors, () => core.ShopManager.close(player));
    attempt(errors, () => player.closeInterruptibleInterfaces());
    attempt(errors, () => player.getDialogueManager().reset());
    attempt(errors, () => player.getMovementQueue().reset());
    attempt(errors, () => player.getMovementQueue().walkToReset());
    attempt(errors, () => { if (loggedIn) PM.emitPlayerDisconnect({ player, username: player.getUsername() }); });
    attempt(errors, () => { if (loggedIn) PM.emitPlayerLogout({ player, username: player.getUsername() }); });
    attempt(errors, () => core.TaskManager.cancelTasks(player));
    attempt(errors, () => core.TaskManager.cancelTasks(player.getIndex()));
    for (const npc of ownedNpcs) attempt(errors, () => { if (npc.isRegistered()) core.World.getNpcs().remove(npc); });
    attempt(errors, () => player.setRegistered(false));
    attempt(errors, () => assert.equal(core.TaskManager.hasActiveTask(player), false));
    attempt(errors, () => assert.equal(core.TaskManager.hasActiveTask(player.getIndex()), false));
    for (const npc of ownedNpcs) attempt(errors, () => assert.equal(npc.isRegistered(), false));
    if (errors.length) throw new AggregateError(errors, 'owned actor cleanup failed');
  });
  player.setIndex(next++); player.setUsername(`gerrant${next}`); player.setRegistered(true);
  player.setLocation(new core.Location(3013, 3225, 0)); player.needsPlacement = false;
  player.setAttribute('quest.heroes_quest.stage', stage);
  const connection = new ClientConnection(channel); connection.player = player;
  loggedIn = true;
  PM.emitPlayerLogin({ player, username: player.getUsername() });
  player.closeInterruptibleInterfaces();
  const npc = core.NPC.create(core.NpcIdentifiers.GERRANT, new core.Location(3014, 3225, 0));
  ownedNpcs.push(npc);
  assert.equal(core.World.getNpcs().add(npc), true);
  assert.equal(player.isRegistered(), true);
  assert.ok(player.getHitpoints() > 0); assert.equal(player.busy(), false);
  assert.equal(player.needsPlacement, false);
  assert.deepEqual([player.getLocation().getX(), player.getLocation().getY(), player.getLocation().getZ()], [3013, 3225, 0]);
  const definition = npc.getCurrentDefinition(player);
  assert.equal(npc.getContentId(player), core.NpcIdentifiers.GERRANT);
  assert.equal(definition.getName(), 'Gerrant');
  const talk = definition.getActions().indexOf('Talk-to') + 1;
  const trade = definition.getActions().indexOf('Trade') + 1;
  assert.equal(talk, 1); assert.equal(trade, 3);
  let turns = 0;
  function turn() {
    assert.ok(++turns <= 20, 'bounded packet and movement processing');
    player.resetUpdating(); core.TaskManager.process(); connection.processTurnPackets();
    const queue = player.getMovementQueue(); queue.beginCycle(); queue.processEntityPursuit();
    if (queue.hasPendingWork()) queue.process();
    core.TaskManager.processWalkTo(player.getIndex());
  }
  async function send(packet) { await connection.dispatch([packet]); turn(); }
  return { player, npc, talk, trade, send, turn };
}

for (const stage of [0, 1, 15]) {
  test(`Gerrant sells fishing supplies at Heroes' Quest stage ${stage}`, async t => {
    const f = setup(t, stage), inv = f.player.getInventory();
    const coins = core.ItemIdentifiers.COINS, net = core.ItemIdentifiers.SMALL_FISHING_NET;
    inv.add(new core.Item(coins, 10000), false);
    assert.equal(inv.getAmount(coins), 10000); assert.equal(inv.getAmount(net), 0);
    await f.send({ type: 'npc_option', index: f.npc.getIndex(), clickType: f.trade });
    const shop = core.ShopManager.getOpenShop(f.player);
    assert.ok(shop, 'Trade opens the shop');
    assert.equal(shop.name, "Gerrant's Fishy Business.");
    assert.equal(f.player.getInterfaceId(), 300);
    const slot = shop.stock.findIndex(row => row.itemId === net);
    assert.ok(slot >= 0); const row = shop.stock[slot];
    assert.ok(row.amount > 0 && row.price > 0 && row.price <= inv.getAmount(coins));
    const beforeCoins = inv.getAmount(coins), beforeStock = row.amount;
    await f.send({ type: 'widget_action', widgetId: (300 << 16) | 16, groupId: 300,
      childId: 16, buttonNum: 2, slot: slot + 1, itemId: net });
    assert.equal(inv.getAmount(net), 1);
    assert.equal(beforeCoins - inv.getAmount(coins), row.price);
    assert.equal(core.ShopManager.shopsById.get(1145).stock.get(net), beforeStock - 1);
  });
}

test('Gerrant still starts the Heroes quest conversation on Talk-to', async t => {
  const f = setup(t, 1);
  await f.send({ type: 'npc_option', index: f.npc.getIndex(), clickType: f.talk });
  assert.equal(f.player.getDialogueManager().isActive(), true);
  assert.equal(core.ShopManager.getOpenShop(f.player), null);
});
