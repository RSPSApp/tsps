// Run after `yarn build`: node --test tests/giantsoul-amulet.test.cjs
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

const { PluginManager } = require('../dist/plugins/PluginManager');
const Giantsoul = require('../plugins/items/GiantsoulAmulet.plugin');

const core = PluginManager.getCoreApi();
const { Item, ItemIdentifiers: I } = core;
const prompts = [];
Giantsoul.register(new Proxy({
  core,
  sendMultiChatboxPrompt: (player, title, ...pairs) => prompts.push({ title, pairs }),
}, { get: (object, key) => object[key] ?? (() => {}) }));

function fakePlayer(carried = {}) {
  const items = new Map(Object.entries(carried).map(([id, amount]) => [Number(id), amount]));
  const messages = [];
  const player = {
    messages,
    sendMessage: (message) => messages.push(message),
    getDialogueManager: () => ({ startDialogues: (chain) => { player.dialogue = chain; } }),
    getInventory: () => ({
      getItems: () => player.amulet ? [player.amulet] : [],
      getAmount: (id) => items.get(id) ?? 0,
      deleteNumber: (id, amount) => items.set(id, (items.get(id) ?? 0) - amount),
      refreshItems() {},
    }),
    getEquipment: () => ({ getItems: () => [], refreshItems() {} }),
    setEnteredAmountAction: (action) => { player.amountAction = action; },
    getPacketSender: () => ({ sendEnterAmountPrompt: (title) => { player.amountPrompt = title; }, sendInterfaceRemoval() {} }),
    carried: (id) => items.get(id) ?? 0,
  };
  return player;
}

const amulet = (charges) => {
  const item = new Item(charges ? I.GIANTSOUL_AMULET : I.GIANTSOUL_AMULET_UNCHARGED_, 1);
  if (charges) item.setMetaValue(Giantsoul.CHARGES_META_KEY, charges);
  return item;
};
const use = (player, item, otherId) => {
  player.amulet = item;
  const event = { player, usedItem: new Item(otherId, 1), usedItemId: otherId, usedWithItem: item, usedWithItemId: item.getId(), handled: false };
  Giantsoul._test.chargeWithItems(event);
  return event.handled;
};

test('one big bone and one law rune charge the uncharged amulet (transcript)', () => {
  const player = fakePlayer({ [I.BIG_BONES]: 1, [I.LAW_RUNE]: 5 });
  const item = amulet(0);
  assert.equal(use(player, item, I.LAW_RUNE), true);
  assert.equal(item.getId(), I.GIANTSOUL_AMULET);
  assert.equal(Giantsoul._test.charges(item), 1);
  assert.deepEqual([player.carried(I.BIG_BONES), player.carried(I.LAW_RUNE)], [0, 4]);
  assert.equal(player.messages.at(-1), 'You add 1 charge to your Giantsoul amulet, giving it a total of 1 charge.');
});

test('several sets ask how many, noted bones count, and the room caps it', () => {
  const player = fakePlayer({ [I.BIG_BONES]: 2, [I.BIG_BONES_2]: 10, [I.LAW_RUNE]: 8 });
  const item = amulet(Giantsoul.MAX_CHARGES - 5);
  assert.equal(use(player, item, I.BIG_BONES_2), true);
  assert.equal(player.amountPrompt, 'How many charges would you like to add? (0 - 5)');
  player.amountAction.execute(9);
  assert.equal(Giantsoul._test.charges(item), Giantsoul.MAX_CHARGES);
  assert.deepEqual([player.carried(I.BIG_BONES), player.carried(I.BIG_BONES_2), player.carried(I.LAW_RUNE)], [0, 7, 3]);
  assert.equal(player.messages.at(-1), 'You add 5 charges to your Giantsoul amulet, giving it a total of 16,000 charges.');
});

test('charging without both items says what it needs', () => {
  const player = fakePlayer({ [I.BIG_BONES]: 3 });
  const item = amulet(0);
  assert.equal(use(player, item, I.BIG_BONES), true);
  assert.equal(item.getId(), I.GIANTSOUL_AMULET_UNCHARGED_);
  assert.deepEqual(player.messages, [], 'the refusal is an item box, not a chat message');
  const box = player.dialogue?.getDialogues().get(0);
  assert.equal(box?.constructor?.name, 'ItemStatementDialogue');
  assert.equal(box.getItemId(), I.GIANTSOUL_AMULET, 'the box shows the charged amulet (transcript)');
  assert.equal(box.getText(), 'You need 1 law rune and 1 big bone to charge the<br>Giantsoul amulet.');
  assert.equal(use(player, item, I.SHARK), false, 'other items are left alone');
});

test("Rub offers the three lairs and Nowhere; worn options go straight there", (t) => {
  const arrivals = [];
  t.mock.method(core.TeleportHandler, 'checkReqs', () => true);
  t.mock.method(core.TeleportHandler, 'teleport', (player, target, type, warn, onArrival) => { arrivals.push([target.getX(), target.getY()]); onArrival?.(); });
  const player = fakePlayer();
  const item = amulet(2);
  player.amulet = item;
  const event = (option) => ({ player, item, itemId: item.getId(), option, handled: false });
  const rub = event('Rub');
  Giantsoul._test.itemAction(rub);
  assert.equal(rub.handled, true);
  const prompt = prompts.at(-1);
  assert.equal(prompt.title, 'Where would you like to teleport to?');
  assert.deepEqual(prompt.pairs.filter((entry) => typeof entry === 'string'), ["Bryophyta's lair", "Obor's lair", "Branda and Eldric's lair", 'Nowhere']);
  prompt.pairs[5]();
  assert.deepEqual(arrivals.at(-1), [2950, 9574], "the titans' entrance tunnel");
  assert.equal(Giantsoul._test.charges(item), 1);
  Giantsoul._test.itemAction(event('Obor'));
  assert.deepEqual(arrivals.at(-1), [3095, 9833]);
  assert.equal(item.getId(), I.GIANTSOUL_AMULET_UNCHARGED_, 'the last charge leaves it uncharged');
  assert.equal(player.messages.at(-1), 'You have no remaining charges in your Giantsoul amulet.');
});

test('Check reads the charges left', () => {
  const player = fakePlayer();
  const item = amulet(1234);
  Giantsoul._test.itemAction({ player, item, itemId: item.getId(), option: 'Check', handled: false });
  assert.equal(player.messages.at(-1), 'Your Giantsoul amulet has 1,234 charges left powering it.');
});

test('the amulet is kept beyond the kept items on a death in the titans fight (Wiki)', () => {
  const Area = require('../plugins/bosses/royaltitans/Area.RoyalTitans');
  Area.attach(new Proxy({ core: { ...core, Area: class {} } }, { get: (object, key) => object[key] ?? (() => {}) }));
  const fighter = {}, outside = {};
  Area.sessions.set('test', { players: [fighter] });
  const keep = (player, id) => {
    const event = { player, item: new Item(id, 1), keep: null };
    Area._test.keepGiantsoul(event);
    return event.keep;
  };
  assert.equal(keep(fighter, I.GIANTSOUL_AMULET), true);
  assert.equal(keep(fighter, I.GIANTSOUL_AMULET_UNCHARGED_), true);
  assert.equal(keep(fighter, I.SHARK), null);
  assert.equal(keep(outside, I.GIANTSOUL_AMULET), null);
  Area.sessions.delete('test');
});

test('equipping during the real teleport animation cannot retain the spent charge', async () => {
  const { CachePipeline } = require('../dist/game/cache/CachePipeline');
  const { Player } = require('../dist/game/entity/impl/player/Player');
  const { EquipPacketListener } = require('../dist/net/packet/impl/EquipPacketListener');
  const { TaskManager } = require('../dist/game/task/TaskManager');
  await CachePipeline.initialize();
  require('../plugins/items/ItemDefinitionLoader.plugin').register({ log() {}, onPlayerLogin() {}, registerContentEndpoint() {} });
  for (const initial of [2, 1]) {
    const player = new Player({ sendClientPacket() {} });
    player.setUsername('giantsoul-test');
    const item = amulet(initial);
    player.getInventory().setItem(0, item);
    Giantsoul._test.teleport(player, item, Giantsoul._test.LAIRS[1]);
    assert.equal(player.isTeleportingReturn(), true);
    // NetworkBuilder routes inventory Wear here even during a teleport.
    EquipPacketListener.equip(player, item.getId(), 0, 3214);
    const worn = player.getEquipment().getItems()[core.Equipment.AMULET_SLOT];
    assert.notEqual(worn, item, 'equipping clones the inventory item');
    for (let tick = 0; tick < 7; tick++) TaskManager.process();
    assert.deepEqual([player.getLocation().getX(), player.getLocation().getY()], [3095, 9833]);
    assert.equal(Giantsoul._test.charges(worn), initial - 1);
    assert.equal(worn.getId(), initial === 1 ? I.GIANTSOUL_AMULET_UNCHARGED_ : I.GIANTSOUL_AMULET);
  }
});

test('a refused teleport keeps the amulet charge', (t) => {
  t.mock.method(core.TeleportHandler, 'checkReqs', () => false);
  t.mock.method(core.TeleportHandler, 'teleport', () => assert.fail('refused teleport must not start'));
  const item = amulet(1);
  const player = fakePlayer();
  player.amulet = item;
  Giantsoul._test.teleport(player, item, Giantsoul._test.LAIRS[0]);
  assert.equal(Giantsoul._test.charges(item), 1);
});


test('equipping after opening the charge prompt cancels spending on the detached item', () => {
  const { Player } = require('../dist/game/entity/impl/player/Player');
  const { EquipPacketListener } = require('../dist/net/packet/impl/EquipPacketListener');
  const player = new Player({ sendClientPacket() {} });
  const item = amulet(0);
  player.getInventory().setItem(0, item);
  player.getInventory().setItem(1, new Item(I.BIG_BONES_2, 5));
  player.getInventory().setItem(2, new Item(I.LAW_RUNE, 5));
  Giantsoul._test.charge(player, item);
  EquipPacketListener.equip(player, item.getId(), 0, 3214);
  const worn = player.getEquipment().getItems()[core.Equipment.AMULET_SLOT];
  assert.notEqual(worn, item);
  player.getEnteredAmountAction().execute(3);
  assert.equal(Giantsoul._test.charges(worn), 0);
  assert.equal(player.getInventory().getAmount(I.LAW_RUNE), 5);
  assert.equal(player.getInventory().getAmount(I.BIG_BONES_2), 5);
});


test('Rub cannot teleport using an item detached while its native prompt was open', () => {
  const { Player } = require('../dist/game/entity/impl/player/Player');
  const { EquipPacketListener } = require('../dist/net/packet/impl/EquipPacketListener');
  const { MultiChatboxPrompt } = require('../dist/game/model/menu/MultiChatboxPrompt');
  Giantsoul.register(PluginManager.createApi('GiantsoulAmulet'));
  const player = new Player({ sendClientPacket() {} });
  const before = player.getLocation().clone();
  const item = amulet(2);
  player.getInventory().setItem(0, item);
  Giantsoul._test.itemAction({ player, item, itemId: item.getId(), option: 'Rub' });
  EquipPacketListener.equip(player, item.getId(), 0, 3214);
  assert.ok(MultiChatboxPrompt.getPending(player), 'Wear leaves the chatbox prompt open');
  assert.equal(MultiChatboxPrompt.handleInterfaceActionClick({ player, buttonId: MultiChatboxPrompt.OPTIONS_WIDGET_ID, action: 2 }), true);
  assert.equal(player.isTeleportingReturn(), false, 'a stale item cannot start the teleport');
  assert.deepEqual([player.getLocation().getX(), player.getLocation().getY()], [before.getX(), before.getY()]);
  assert.equal(Giantsoul._test.charges(player.getEquipment().getItems()[core.Equipment.AMULET_SLOT]), 2);
});


test('native worn IF_BUTTON packets resolve cache destinations and Check instead of removing the amulet', async () => {
  const { Player } = require('../dist/game/entity/impl/player/Player');
  const { ClientConnection } = require('../dist/net/NetworkBuilder');
  const { decodeClientPackets } = require('../dist/net/protocol/ClientProtocol');
  const { TaskManager } = require('../dist/game/task/TaskManager');
  // widgets.ts writes only the widget, slot and item: no option text crosses this boundary.
  for (const [index, opcode] of [25, 31, 63, 69].entries()) {
    const player = new Player({ sendClientPacket() {} });
    const item = amulet(2);
    player.getEquipment().setItem(core.Equipment.AMULET_SLOT, item);
    const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true,
      send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
    const connection = new ClientConnection(channel);
    connection.player = player;
    const frame = Buffer.alloc(9);
    frame[0] = opcode;
    frame.writeInt32BE((387 << 16) | 17, 1);
    frame.writeUInt16BE(0xffff, 5);
    frame.writeUInt16BE(item.getId(), 7);
    const packets = decodeClientPackets(frame);
    assert.equal(packets[0].option, undefined);
    connection.inject(packets);
    await connection.idle();
    connection.processTurnPackets();
    assert.equal(player.getEquipment().getItems()[core.Equipment.AMULET_SLOT], item, 'a destination or Check must not unequip');
    if (index < 3) {
      for (let tick = 0; tick < 7; tick++) TaskManager.process();
      assert.deepEqual([player.getLocation().getX(), player.getLocation().getY()], Giantsoul._test.LAIRS[index].tile.slice(0, 2));
      assert.equal(Giantsoul._test.charges(item), 1);
    } else {
      assert.equal(player.isTeleportingReturn(), false);
      assert.equal(Giantsoul._test.charges(item), 2);
    }
  }
});
