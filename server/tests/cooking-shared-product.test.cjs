// Run after `yarn build`: node --test tests/cooking-shared-product.test.cjs
// "What would you like to cook?" lists each product once. Raw beef and raw rat meat both cook into cooked meat, so the
// one Cooked meat entry has to cook both: it used to keep only the first raw in the inventory and stop when it ran out.
const assert = require('node:assert/strict');
const path = require('node:path');
const { before, after, test } = require('node:test');
require('../dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager: PM } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { PlayerSession } = require('../dist/net/PlayerSession');
const Cookers = require('../plugins/skills/cooking/Cookers.Cooking');
let core, next = 3520;
const bots = process.env.DISABLE_PLAYER_BOTS;
const AT = [3211, 3215, 0]; // a plain Range (2859) placed beside the player

before(async () => {
  process.env.DISABLE_PLAYER_BOTS = '1';
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  PM.loadFromDirectory(path.resolve(__dirname, '../plugins'));
  core = PM.getCoreApi();
  core.ObjectDefinition.init();
  core.RegionManager.init(); core.RegionManager.loadMapFiles(AT[0], AT[1]);
  PM.emitServerStartup({});
});
after(() => {
  PM.emitServerShutdown({});
  if (bots === undefined) delete process.env.DISABLE_PLAYER_BOTS; else process.env.DISABLE_PLAYER_BOTS = bots;
});

function cookFromMenu(t, carried, product, amount) {
  const I = core.ItemIdentifiers;
  const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++); p.setUsername('meatcook' + next); p.setRegistered(true); p.setLocation(new core.Location(...AT)); p.needsPlacement = false;
  p.getSkillManager().setMaxLevel(core.Skill.COOKING, 99, true).setCurrentLevel(core.Skill.COOKING, 99, true);
  t.after(() => { PM.emitPlayerLogout({ player: p, username: p.getUsername() }); p.setRegistered(false); core.TaskManager.cancelTasks(p.getIndex()); });
  for (const [name, n] of carried) for (let i = 0; i < n; i++) p.getInventory().add(new core.Item(I[name], 1), true);
  const range = new core.GameObject(core.ObjectIdentifiers.RANGE, new core.Location(AT[0] + 1, AT[1], 0), 10, 0, null);
  core.ObjectManager.register(range, true);
  t.after(() => core.ObjectManager.deregister(range, true));
  let menu = null;
  const sender = p.getPacketSender();
  t.mock.method(sender, 'sendCreationMenu', (value) => { menu = value; return sender; });
  Cookers._test.offerCook(p, range, carried.map(([name]) => Cookers._test.cookableFor(I[name])), true);
  assert.equal(menu?.getTitle(), 'What would you like to cook?');
  menu.execute(I[product], amount ?? menu.getOptions().maxAmount);
  for (let i = 0; i < 60 && Cookers.isCookingActive(p); i++) core.TaskManager.process();
  return { inv: p.getInventory(), menu, I };
}

test('the one Cooked meat entry cooks raw beef, then raw rat meat', (t) => {
  const { inv, menu, I } = cookFromMenu(t, [['RAW_BEEF', 3], ['RAW_RAT_MEAT', 2], ['RAW_TROUT', 1]], 'COOKED_MEAT');
  assert.deepEqual(menu.getItems(), [I.COOKED_MEAT, I.TROUT], 'each product is offered once');
  assert.equal(menu.getOptions().maxAmount, 5, 'the most offered counts every raw with that product');
  assert.equal(inv.getAmount(I.RAW_BEEF), 0);
  assert.equal(inv.getAmount(I.RAW_RAT_MEAT), 0, 'the rat meat cooks once the beef runs out');
  assert.equal(inv.getAmount(I.COOKED_MEAT), 5);
  assert.equal(inv.getAmount(I.RAW_TROUT), 1, 'the other entry is left alone');
});

test('the amount chosen still holds across the raws', (t) => {
  const { inv, I } = cookFromMenu(t, [['RAW_BEEF', 2], ['RAW_RAT_MEAT', 3], ['RAW_TROUT', 1]], 'COOKED_MEAT', 4);
  assert.equal(inv.getAmount(I.COOKED_MEAT), 4);
  assert.equal(inv.getAmount(I.RAW_BEEF), 0);
  assert.equal(inv.getAmount(I.RAW_RAT_MEAT), 1);
});
