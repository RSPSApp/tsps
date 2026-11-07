// Run after yarn build: node --test tests/windmill.test.cjs
const assert = require('node:assert/strict');
const { before, test } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
let core, Items, hopper, controls;

before(async () => {
  await CachePipeline.initialize(require('node:path').resolve(__dirname, '..'));
  core = PluginManager.getCoreApi();
  core.ObjectDefinition.init();
  Items = core.ItemIdentifiers;
  hopper = core.ObjectIdentifiers.HOPPER_24;
  controls = core.ObjectIdentifiers.HOPPER_CONTROLS_2;
  assert.equal(core.CacheDefinitions.getLocId('hopper1'), hopper);
  assert.equal(core.CacheDefinitions.getLocId('hopperlevers1'), controls);
  require('../plugins/objects/Windmill.plugin').register(PluginManager.createApi('Windmill'));
});

function miller() {
  const player = new Player(null);
  const messages = [];
  const varbits = new Map();
  const sender = new Proxy(
    { sendVarbit: (id, value) => { varbits.set(id, value); return sender; } },
    { get: (target, key) => target[key] ?? (() => sender) }
  );
  player.getPacketSender = () => sender;
  player.sendMessage = message => messages.push(message);
  const inventory = player.getInventory();
  function event(id) {
    const object = new core.GameObject(id, new core.Location(3166, 3307, 2), 10, 0);
    return { player, object, objectId: id, location: { x: 3166, y: 3307, z: 2 }, handled: false };
  }
  return {
    player, messages, inventory, varbits,
    add: (id, amount = 1) => inventory.add(new core.Item(id, amount), false),
    use(id, objectId = hopper) {
      const itemSlot = inventory.getSlotForItemId(id);
      assert.ok(itemSlot >= 0, 'the used item must be carried');
      return PluginManager.emitItemOnObject({ ...event(objectId), itemId: id,
        item: inventory.getItems()[itemSlot], itemSlot });
    },
    click(id, option) {
      return PluginManager.emitObjectInteraction({ ...event(id), option, clickType: 1 });
    },
  };
}

test('using grain fills the hopper once and permits the existing milling action', () => {
  const m = miller();
  m.add(Items.GRAIN, 2);
  assert.equal(m.use(Items.GRAIN), true);
  assert.equal(m.inventory.getAmount(Items.GRAIN), 1);
  assert.deepEqual(m.messages, [
    'You put the grain in the hopper. You should now pull the lever nearby to operate the hopper.',
  ]);
  assert.equal(m.use(Items.GRAIN), true);
  assert.equal(m.inventory.getAmount(Items.GRAIN), 1, 'a full hopper does not consume more grain');
  assert.equal(m.messages.at(-1), 'There is already grain in the hopper.');
  assert.equal(m.click(controls, 'Operate'), true);
  assert.equal(m.messages.at(-1), 'You operate the hopper. The grain slides down the chute.');
  assert.equal(m.use(Items.GRAIN), true, 'operating the controls frees the hopper');
  assert.equal(m.inventory.getAmount(Items.GRAIN), 0);
});

test('grain used after Fill gets the captured full-hopper refusal (rsprox 3181)', () => {
  const m = miller();
  m.add(Items.GRAIN, 2);
  assert.equal(m.click(hopper, 'Fill'), true);
  assert.equal(m.inventory.getAmount(Items.GRAIN), 1);
  assert.equal(m.use(Items.GRAIN), true);
  assert.equal(m.messages.at(-1), 'There is already grain in the hopper.');
  assert.equal(m.inventory.getAmount(Items.GRAIN), 1);
});

test('noted grain, quest grain, unrelated items and other scenery fall through', () => {
  const m = miller();
  for (const id of [Items.GRAIN_2, Items.GRAIN_3, Items.POT, Items.GRAIN]) m.add(id);
  assert.equal(core.ItemDefinition.forId(Items.GRAIN_2).isNoted(), true);
  for (const id of [Items.GRAIN_2, Items.GRAIN_3, Items.POT]) {
    assert.equal(m.use(id), false);
    assert.equal(m.inventory.getAmount(id), 1);
  }
  assert.equal(m.use(Items.GRAIN, controls), false);
  assert.equal(m.inventory.getAmount(Items.GRAIN), 1);
  assert.deepEqual(m.messages, []);
  assert.equal(m.player.getAttribute('windmill:hopper'), undefined);
});

test('milling writes the cache flour count varbit, not just the bin flag', () => {
  const m = miller();
  m.add(Items.GRAIN);
  assert.equal(m.use(Items.GRAIN), true);
  assert.equal(m.varbits.has(4920), false, 'nothing has been milled yet');
  assert.equal(m.click(controls, 'Operate'), true);
  assert.equal(m.varbits.get(4920), 1, 'mill_flour carries the bin count for the client');
  assert.equal(m.varbits.get(5325), 1, 'the bin flag still selects the full model');
  assert.equal(m.varbits.has(4923), false, 'wheat leaves the cornflour count alone');
});

test('sweetcorn writes the cornflour count instead of the wheat one', () => {
  const m = miller();
  m.add(Items.SWEETCORN);
  assert.equal(m.use(Items.SWEETCORN), true);
  assert.equal(m.click(controls, 'Operate'), true);
  assert.equal(m.varbits.get(4923), 1, 'mill_cornflour carries the count');
  assert.equal(m.varbits.has(4920), false, 'and the wheat count stays untouched');
});

test('emptying the bin zeroes the count it wrote', () => {
  const m = miller();
  const bin = core.CacheDefinitions.getLocId('millbase_flour');
  assert.equal(bin, core.ObjectIdentifiers.FLOUR_BIN);
  m.add(Items.GRAIN);
  m.add(Items.POT);
  assert.equal(m.use(Items.GRAIN), true);
  assert.equal(m.click(controls, 'Operate'), true);
  assert.equal(m.varbits.get(4920), 1);
  const potOfFlour = m.inventory.getAmount(Items.POT_OF_FLOUR);
  assert.equal(m.click(bin, 'Empty'), true);
  assert.equal(m.inventory.getAmount(Items.POT_OF_FLOUR), potOfFlour + 1, 'a flour leaves the bin');
  assert.equal(m.varbits.get(4920), 0, 'the count returns to zero');
  assert.equal(m.varbits.get(5325), 0, 'and the bin flag with it');
});

test('grain does not replace sweetcorn already in the hopper', () => {
  const m = miller();
  m.add(Items.SWEETCORN);
  m.add(Items.GRAIN);
  assert.equal(m.use(Items.SWEETCORN), true);
  assert.equal(m.inventory.getAmount(Items.SWEETCORN), 0);
  assert.equal(m.use(Items.GRAIN), true);
  assert.equal(m.messages.at(-1), 'There is already grain in the hopper.');
  assert.equal(m.inventory.getAmount(Items.GRAIN), 1);
  assert.equal(m.player.getAttribute('windmill:hopper'), 'sweetcorn');
});

test('a relog sends the saved flour count back on mill_flour and the bin flag (capture 237/01099)', () => {
  const m = miller();
  m.player.setAttribute('windmill:flour', 4);
  PluginManager.emitPlayerLogin({ player: m.player, username: 'miller', isNewAccount: false });
  assert.equal(m.varbits.get(4920), 4, 'mill_flour carries the saved count');
  assert.equal(m.varbits.get(5325), 1, 'the bin shows full');
  const corn = miller();
  corn.player.setAttribute('windmill:flour', 2);
  corn.player.setAttribute('windmill:flour-kind', 'sweetcorn');
  PluginManager.emitPlayerLogin({ player: corn.player, username: 'miller2', isNewAccount: false });
  assert.equal(corn.varbits.get(4923), 2, 'cornflour on its own varbit');
});
