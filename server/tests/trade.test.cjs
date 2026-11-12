// Run after `yarn build`: node --test tests/trade.test.cjs
const assert = require("node:assert/strict");
const { test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { ItemDefinition } = require("../dist/game/definition/ItemDefinition");
const { Item } = require("../dist/game/model/Item");
const { PlayerStatus } = require("../dist/game/model/PlayerStatus");
const { Inventory } = require("../dist/game/model/container/impl/Inventory");
const { Trading } = require("../dist/game/content/Trading");
const { ObjType } = require("../dist/game/cache/codec/rs/config/objtype/ObjType");
const { GameConstants } = require("../dist/game/GameConstants");
const { ItemOnGroundManager } = require("../dist/game/entity/impl/grounditem/ItemOnGroundManager");
const { PluginManager } = require("../dist/plugins/PluginManager");

const LOBSTER = 379;
const COINS = 995;
const LOGS = 1511;
const HELM = 1153; // iron full helm

const cacheDefinitionForId = ItemDefinition.forId;

// Item definitions normally come from the cache; stub the few this test uses.
const DEFINITIONS = {
  // The trade screen shows the Grand Exchange price (ge), not the store value.
  [LOBSTER]: { name: "Lobster", stackable: false, value: 150, ge: 180 },
  [COINS]: { name: "Coins", stackable: true, value: 1 },
};
ItemDefinition.forId = (id) => {
  const def = DEFINITIONS[id] ?? { name: "null", stackable: false, value: 0 };
  return {
    getId: () => id,
    getName: () => def.name,
    isStackable: () => def.stackable,
    getValue: () => def.value,
    getGrandExchangeValue: () => def.ge ?? def.value,
    isTradeable: () => true,
    isNoted: () => false,
  };
};

function createPlayer(name, index) {
  const messages = [];
  const texts = new Map();
  const packets = [];
  let status = PlayerStatus.NONE;
  let interfaceId = -1;
  // Every packet-sender call is a chainable no-op, except closing interfaces,
  // which resets the status and interface like the real sender does, and
  // widget text, which is recorded.
  const sender = new Proxy({}, {
    get: (_target, key) => {
      if (key === "sendInterfaceRemoval") {
        return () => { status = PlayerStatus.NONE; interfaceId = -1; return sender; };
      }
      if (key === "sendString") return (text, uid) => { texts.set(uid, text); return sender; };
      return () => sender;
    },
  });
  const player = {
    messages,
    texts,
    packets,
    getUsername: () => name,
    getDisplayName: () => name,
    getIndex: () => index,
    getSession: () => ({ sendClientPacket: (packet) => packets.push(packet) > 0 }),
    getPacketSender: () => sender,
    sendMessage: (message) => messages.push(message),
    getStatus: () => status,
    setStatus: (next) => { status = next; },
    getInterfaceId: () => interfaceId,
    setInterfaceId: (next) => { interfaceId = next; },
    isPlayerBot: () => false,
    getFrameUpdater: () => ({ clear() {}, clearGroup() {} }),
    getAttribute: () => undefined,
  };
  player.inventory = new Inventory(player);
  player.inventory.resetItems();
  player.getInventory = () => player.inventory;
  player.trading = new Trading(player);
  player.getTrading = () => player.trading;
  return player;
}

function count(player, itemId) {
  return player.getInventory().getAmount(itemId);
}

function offer(player, itemId, amount) {
  const inventory = player.getInventory();
  const slot = inventory.getSlotForItemId(itemId);
  player.getTrading().handleItem(itemId, amount, slot, inventory, player.getTrading().getContainer());
}

function startTrade() {
  const alice = createPlayer("alice", 1);
  const bob = createPlayer("bob", 2);
  alice.getInventory().adds(LOBSTER, 3);
  bob.getInventory().adds(COINS, 500);
  alice.getTrading().requestTrade(bob);
  bob.getTrading().requestTrade(alice);
  offer(alice, LOBSTER, 3);
  offer(bob, COINS, 200);
  assert.equal(count(alice, LOBSTER), 0);
  assert.equal(count(bob, COINS), 300);
  return { alice, bob };
}

test("declining returns both players' offered items and ends the trade for both", () => {
  const { alice, bob } = startTrade();

  alice.getTrading().closeTrade();

  assert.equal(count(alice, LOBSTER), 3);
  assert.equal(count(bob, COINS), 500);
  for (const player of [alice, bob]) {
    assert.equal(player.getTrading().getInteract(), null);
    assert.equal(player.getStatus(), PlayerStatus.NONE);
    assert.equal(player.getTrading().getContainer().getValidItems().length, 0);
  }
  assert.ok(bob.messages.includes("Other player declined trade."));
});

test("the other player can trade again straight after a decline", () => {
  const { alice, bob } = startTrade();
  alice.getTrading().closeTrade();
  // Skip the two-second cooldown between trade requests.
  bob.getTrading().request_delay.stop();

  bob.getTrading().requestTrade(alice);

  assert.ok(!bob.messages.includes("You cannot do that right now."));
  assert.equal(bob.getTrading().getInteract(), alice);
});

test("a second decline does not return items twice", () => {
  const { alice, bob } = startTrade();

  alice.getTrading().closeTrade();
  alice.getTrading().closeTrade();
  bob.getTrading().closeTrade();

  assert.equal(count(alice, LOBSTER), 3);
  assert.equal(count(bob, COINS), 500);
});

test("closing either trade screen cancels both offers by every interface-close route", (t) => {
  const { PacketSender } = require("../dist/net/packet/PacketSender");
  let closed;
  require("../plugins/interface/Trading.plugin").register({
    core: { TradeState: require("../dist/game/content/Trading").TradeState },
    onCustomEvent: (name, handler) => { assert.equal(name, "interface:closed"); closed = handler; },
  });
  t.mock.method(PluginManager, "emitCustomEvent", (name, event) => {
    if (name === "interface:closed") closed(event);
  });
  for (const route of ["sendInterfaceRemoval", "closeInterruptibleInterfaces", "closeInterface"]) {
    for (const confirm of [false, true]) {
      const { alice, bob } = startTrade();
      if (confirm) {
        alice.getTrading().acceptTrade();
        bob.getTrading().acceptTrade();
      }
      for (const player of [alice, bob]) {
        const sender = new PacketSender(player);
        sender.getVarbit = () => 0; // no cache here: the accept trade delay (205) is off
        player.getPacketSender = () => sender;
      }
      alice.getPacketSender()[route](alice.getInterfaceId());
      for (const player of [alice, bob]) {
        assert.equal(player.getTrading().getState(), 0, `${route}: ${confirm}`);
        assert.equal(player.getTrading().getInteract(), null);
        assert.equal(player.getTrading().getContainer().getValidItems().length, 0);
        assert.equal(player.getStatus(), PlayerStatus.NONE);
        assert.equal(player.getInterfaceId(), -1);
      }
      alice.getTrading().acceptTrade();
      bob.getTrading().acceptTrade();
      alice.getPacketSender()[route](confirm ? 334 : 335);
      assert.equal(count(alice, LOBSTER), 3, 'repeated closes and stale accepts return nothing twice');
      assert.equal(count(bob, COINS), 500);
    }
  }
  const { alice, bob } = startTrade();
  for (const player of [alice, bob]) {
    const sender = new PacketSender(player);
    sender.sendString = () => sender;
    sender.getVarbit = () => 0;
    player.getPacketSender = () => sender;
  }
  closed({ player: alice, interfaceId: 231 });
  assert.equal(alice.getTrading().getInteract(), bob, 'closing unrelated dialogue leaves the trade alone');
  alice.getTrading().acceptTrade();
  bob.getTrading().acceptTrade();
  alice.getTrading().getButtonDelay().stop();
  bob.getTrading().getButtonDelay().stop();
  alice.getTrading().acceptTrade();
  bob.getTrading().acceptTrade();
  assert.equal(count(alice, COINS), 200, 'closing after completion does not return offers again');
  assert.equal(count(bob, LOBSTER), 3);
  assert.ok(!alice.messages.includes('Trade declined.'));
});

test("closing a trade after the other player's interface was closed still returns their items", () => {
  const { alice, bob } = startTrade();
  // Closing Bob's interfaces from elsewhere resets his status, not his trade.
  bob.getPacketSender().sendInterfaceRemoval();

  alice.getTrading().closeTrade();

  assert.equal(count(bob, COINS), 500);
  assert.equal(bob.getTrading().getInteract(), null);
});

test("noted items take the tradeable flag from the item they note", () => {
  const cacheInfo = { game: "oldschool", revision: 237 };
  const shark = new ObjType(385, cacheInfo);
  shark.name = "Shark";
  shark.isTradable = true;
  const template = new ObjType(799, cacheInfo);

  const noted = new ObjType(386, cacheInfo);
  noted.genCert(template, shark);

  assert.equal(noted.isTradable, true);
});

test("the offer screen shows who you trade with, both offers' values and acceptance", () => {
  const { alice, bob } = startTrade();
  const text = (component) => alice.texts.get((335 << 16) | component);

  assert.equal(text(31), "Trading With: bob", "rsprox_transcripts/227/00548.txt trademain:title");
  assert.equal(text(24), "You offer:<br>(Value: <col=ffffff>540</col> coins)", "3 lobsters at the 180 GE price");
  assert.equal(text(27), "bob offers:<br>(Value: <col=ffffff>200</col> coins)");
  assert.equal(text(9), "bob has 27 free inventory slots.");

  bob.getTrading().acceptTrade();
  assert.equal(text(30), "Other player has accepted.");
  assert.equal(bob.texts.get((335 << 16) | 30), "Waiting for other player...");
});

test("the confirm screen puts its status in the title and the partner below, as live", () => {
  // rsprox_transcripts/227/00548.txt: tradeconfirm:title (334:4) and tradeconfirm:tradeopponent (334:30).
  const { alice, bob } = startTrade();
  alice.getTrading().acceptTrade();
  bob.getTrading().acceptTrade();
  const text = (component) => alice.texts.get((334 << 16) | component);
  assert.equal(text(4), "Are you sure you want to make this trade?");
  assert.equal(text(30), "Trading with:<br>bob");
});

const TRIDENT = 11907;
DEFINITIONS[TRIDENT] = { name: "Trident of the seas", stackable: false, value: 0 };

function addWithMeta(player, itemId, amount, meta) {
  player.getInventory().add(new Item(itemId, amount, meta), false);
}

function offerFromSlot(player, slot, amount) {
  const inventory = player.getInventory();
  const itemId = inventory.getItems()[slot].getId();
  player.getTrading().handleItem(itemId, amount, slot, inventory, player.getTrading().getContainer());
}

function startEmptyTrade() {
  const alice = createPlayer("alice", 1);
  const bob = createPlayer("bob", 2);
  alice.getTrading().requestTrade(bob);
  bob.getTrading().requestTrade(alice);
  return { alice, bob };
}

test("offered items keep their metadata through offer, remove and completion", () => {
  const { alice, bob } = startEmptyTrade();
  addWithMeta(alice, TRIDENT, 1, { charges: 1200 });
  addWithMeta(alice, TRIDENT, 1, { charges: 5 });

  offerFromSlot(alice, 0, 2);
  const offered = alice.getTrading().getContainer().getValidItems().map((item) => item.getMeta());
  assert.deepEqual(offered, [{ charges: 1200 }, { charges: 5 }]);

  const container = alice.getTrading().getContainer();
  alice.getTrading().handleItem(TRIDENT, 1, 1, container, alice.getInventory());
  assert.deepEqual(alice.getInventory().getValidItems().map((item) => item.getMeta()), [{ charges: 5 }]);

  alice.getTrading().acceptTrade();
  bob.getTrading().acceptTrade();
  alice.getTrading().getButtonDelay().stop();
  bob.getTrading().getButtonDelay().stop();
  alice.getTrading().acceptTrade();
  bob.getTrading().acceptTrade();
  assert.deepEqual(bob.getInventory().getValidItems().map((item) => item.getMeta()), [{ charges: 1200 }]);
});

test("declining returns items with their metadata", () => {
  const { alice } = startEmptyTrade();
  addWithMeta(alice, TRIDENT, 1, { charges: 1200 });
  offerFromSlot(alice, 0, 1);

  alice.getTrading().closeTrade();

  assert.deepEqual(alice.getInventory().getValidItems().map((item) => item.getMeta()), [{ charges: 1200 }]);
});

test("offering several of an item skips copies tagged untradeable", () => {
  const { alice } = startEmptyTrade();
  addWithMeta(alice, LOBSTER, 1, { [Item.UNTRADEABLE_META]: true });
  addWithMeta(alice, LOBSTER, 1, null);
  addWithMeta(alice, LOBSTER, 1, null);

  offerFromSlot(alice, 1, 3);

  assert.equal(alice.getTrading().getContainer().getAmount(LOBSTER), 2);
  assert.equal(alice.getInventory().getItems()[0].isUntradeable(), true);
});

test("offering from one stack never takes more than that stack holds", () => {
  const { alice } = startEmptyTrade();
  addWithMeta(alice, COINS, 100, { [Item.UNTRADEABLE_META]: true });
  addWithMeta(alice, COINS, 50, null);

  offerFromSlot(alice, 1, 150);

  assert.equal(alice.getTrading().getContainer().getAmount(COINS), 50);
  assert.equal(alice.getInventory().getAmount(COINS), 100);
});

test("completing a trade saves both players with the items already exchanged", () => {
  const { alice, bob } = startTrade();
  const saves = [];
  const previous = GameConstants.PLAYER_PERSISTENCE;
  GameConstants.PLAYER_PERSISTENCE = {
    save: (player) => saves.push([player.getUsername(), count(player, LOBSTER), count(player, COINS)]),
  };
  try {
    alice.getTrading().acceptTrade();
    bob.getTrading().acceptTrade();
    alice.getTrading().getButtonDelay().stop();
    bob.getTrading().getButtonDelay().stop();
    alice.getTrading().acceptTrade();
    assert.deepEqual(saves, [], "nothing is saved until both accept the confirm screen");
    bob.getTrading().acceptTrade();
  } finally {
    GameConstants.PLAYER_PERSISTENCE = previous;
  }

  assert.deepEqual(saves.sort(), [["alice", 0, 200], ["bob", 3, 300]]);
});

test("a completed trade tells plugins what each player received and gave", () => {
  const { alice, bob } = startTrade();
  const events = [];
  const previous = PluginManager.emitTradeCompleted;
  PluginManager.emitTradeCompleted = (event) => events.push(event);
  try {
    alice.getTrading().acceptTrade();
    bob.getTrading().acceptTrade();
    alice.getTrading().getButtonDelay().stop();
    bob.getTrading().getButtonDelay().stop();
    alice.getTrading().acceptTrade();
    bob.getTrading().acceptTrade();
  } finally {
    PluginManager.emitTradeCompleted = previous;
  }

  const byPlayer = new Map(events.map((event) => [event.player, event]));
  const summary = (items) =>
    items.map((item) => [item.getId(), item.getAmount()]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const lobsters = [[LOBSTER, 1], [LOBSTER, 1], [LOBSTER, 1]];
  assert.equal(byPlayer.size, 2);
  assert.equal(byPlayer.get(alice).partner, bob);
  assert.deepEqual(summary(byPlayer.get(alice).received), [[COINS, 200]]);
  assert.deepEqual(summary(byPlayer.get(alice).given), lobsters);
  assert.deepEqual(summary(byPlayer.get(bob).received), lobsters);
  assert.deepEqual(summary(byPlayer.get(bob).given), [[COINS, 200]]);
});

test("offered items that no longer fit in the inventory are dropped, not lost", () => {
  const { alice } = startTrade();
  // Fill the slots the lobsters left, as spawning items mid-trade would.
  alice.getInventory().adds(TRIDENT, 28);
  const dropped = [];
  const previous = ItemOnGroundManager.registers;
  ItemOnGroundManager.registers = (player, item) => dropped.push([player.getUsername(), item.getId(), item.getAmount()]);
  try {
    alice.getTrading().closeTrade();
  } finally {
    ItemOnGroundManager.registers = previous;
  }

  assert.deepEqual(dropped, [["alice", LOBSTER, 1], ["alice", LOBSTER, 1], ["alice", LOBSTER, 1]]);
  assert.equal(alice.getTrading().getContainer().getValidItems().length, 0);
  assert.ok(alice.messages.includes("Your inventory is full, so some of your offered items were dropped on the floor."));
});

test("a trade request reaches the other player as a trade-request chat line", () => {
  const alice = createPlayer("alice", 1);
  const bob = createPlayer("bob", 2);

  alice.getTrading().requestTrade(bob);

  assert.ok(!bob.messages.some((message) => message.includes(":tradereq:")));
  assert.ok(bob.packets.some((packet) =>
    packet.includes("wishes to trade with you.") && packet.includes("alice")));
});

test("either trader's area can refuse a request before any trade state changes", () => {
  for (const refusedSide of ['requester', 'target']) {
    const alice = createPlayer('alice', 1), bob = createPlayer('bob', 2);
    const area = { canTrade: () => false };
    alice.getArea = () => refusedSide === 'requester' ? area : null;
    bob.getArea = () => refusedSide === 'target' ? area : null;
    const before = [alice.getTrading().getInteract(), bob.getTrading().getInteract()];
    alice.getTrading().requestTrade(bob);
    assert.deepEqual([alice.getTrading().getInteract(), bob.getTrading().getInteract()], before);
    assert.equal(bob.packets.length, 0);
    assert.ok(alice.messages.includes('You cannot trade here.'));
  }
});

test("a shared area is asked once and cannot bypass a global trade refusal", (t) => {
  const alice = createPlayer('alice', 1), bob = createPlayer('bob', 2);
  let calls = 0;
  const area = { canTrade: () => { calls++; return true; } };
  alice.getArea = bob.getArea = () => area;
  t.mock.method(PluginManager, 'emitCanTrade', () => false);
  alice.getTrading().requestTrade(bob);
  assert.equal(calls, 1);
  assert.equal(bob.packets.length, 0);
});

test("a new area restriction aborts an open trade and returns both players' offers", () => {
  const { alice, bob } = startTrade();
  bob.getArea = () => ({ canTrade: () => false });
  alice.getTrading().acceptTrade();
  assert.equal(count(alice, LOBSTER), 3);
  assert.equal(count(bob, COINS), 500);
  assert.equal(alice.getTrading().getInteract(), null);
  assert.equal(bob.getTrading().getInteract(), null);
  assert.equal(alice.getTrading().getContainer().getValidItems().length, 0);
  assert.equal(bob.getTrading().getContainer().getValidItems().length, 0);
});


test('native trades preserve confirmation, settle once and still cancel through real interfaces', async t => {
  await require('../dist/game/cache/CachePipeline').CachePipeline.initialize();
  const { Player } = require('../dist/game/entity/impl/player/Player');
  const { PlayerSession } = require('../dist/net/PlayerSession');
  const { ClientConnection } = require('../dist/net/NetworkBuilder');
  const { decodeClientPackets } = require('../dist/net/protocol/ClientProtocol');
  const TRADE_ACTION_PACKET_ID = 180; // ClientPackets.TRADE_ACTION (the TS const enum is erased).
  const { TradeState } = require('../dist/game/content/Trading');
  const core = PluginManager.getCoreApi();
  require('../plugins/interface/Trading.plugin').register(PluginManager.createApi('NativeTrade'));
  t.mock.method(ItemDefinition, 'forId', cacheDefinitionForId);
  let clock = 1000, serial = 0;
  t.mock.method(performance, 'now', () => clock);
  const saves = [], previousPersistence = GameConstants.PLAYER_PERSISTENCE;
  GameConstants.PLAYER_PERSISTENCE = { save(player, reason) {
    saves.push({ player, reason, lobsters: count(player, LOBSTER), coins: count(player, COINS) });
  } };
  t.after(() => { GameConstants.PLAYER_PERSISTENCE = previousPersistence; });
  function actor(test) {
    const frames = [];
    const channel = { kind: 'test', binaryTransport: true, isOpen: () => true,
      send: frame => { frames.push(Buffer.from(frame)); return true; },
      close() {}, onData() {}, onClose() {}, onError() {} };
    const session = new PlayerSession(channel), player = new Player(session); session.setPlayer(player);
    player.setUsername('native-trade-' + serial++); player.setIndex(serial); player.setRegistered(true);
    player.setNeedsPlacement(false);
    const connection = new ClientConnection(channel); connection.player = player;
    test.after(() => { core.TaskManager.cancelTasks(player); player.setRegistered(false); session.flushPackets(); });
    return { player, session, connection, frames };
  }
  async function action(f, actionId, slot = 0, quantity = 0, id = -1) {
    // The dedicated trade frame produced by ClientBinaryEncoder (byte-length payload).
    const raw = Buffer.alloc(11); raw[0] = TRADE_ACTION_PACKET_ID; raw[1] = 9; raw[2] = actionId;
    raw.writeUInt16BE(slot, 3); raw.writeInt32BE(quantity, 5); raw.writeUInt16BE(id & 65535, 9);
    clock += 1100;
    await f.connection.dispatch(decodeClientPackets(raw)); f.connection.processTurnPackets(); f.session.flushPackets();
  }
  async function start(test) {
    const a = actor(test), b = actor(test);
    a.player.getInventory().adds(LOBSTER, 3); b.player.getInventory().adds(COINS, 500);
    a.player.getTrading().requestTrade(b.player); b.player.getTrading().requestTrade(a.player);
    await action(a, 0, 0, 3, LOBSTER); await action(b, 0, 0, 200, COINS);
    return [a, b];
  }
  async function confirm(pair) {
    for (const f of pair) await action(f, 2);
    assert.deepEqual(pair.map(f => ({ state: f.player.getTrading().getState(), status: f.player.getStatus(),
      partner: f.player.getTrading().getInteract()?.getUsername(), modal: f.player.getInterfaceId() })),
    pair.map((f, i) => ({ state: TradeState.CONFIRM_SCREEN, status: PlayerStatus.TRADING,
      partner: pair[1 - i].player.getUsername(), modal: 334 })), 'offer-close is an internal transition');
    for (const f of pair) {
      assert.equal(f.player.getPacketSender().getSubInterfaceAt((161 << 16) | 16)?.groupId, 334);
      assert.equal(Buffer.concat(f.frames).includes(Buffer.from('declined')), false);
    }
    assert.equal(count(pair[0].player, LOBSTER), 0, 'items remain in escrow until both confirm');
    assert.equal(count(pair[1].player, COINS), 300);
  }
  function ended(pair) {
    for (const f of pair) {
      assert.equal(f.player.getTrading().getState(), TradeState.NONE);
      assert.equal(f.player.getTrading().getInteract(), null);
      assert.equal(f.player.getStatus(), PlayerStatus.NONE);
      assert.equal(f.player.getInterfaceId(), -1);
      assert.equal(f.player.getPacketSender().getSubInterfaceAt((161 << 16) | 16), undefined);
      assert.equal(f.player.getTrading().getContainer().getValidItems().length, 0);
    }
  }
  await t.test('both native confirmations exchange and save exactly once', async test => {
    const pair = await start(test); await confirm(pair);
    const before = saves.length;
    await action(pair[0], 4); assert.equal(saves.length, before, 'one confirmation never settles');
    await action(pair[1], 4); ended(pair);
    const [a, b] = pair.map(f => f.player);
    assert.deepEqual([count(a, LOBSTER), count(a, COINS), count(b, LOBSTER), count(b, COINS)], [0, 200, 3, 300]);
    assert.deepEqual(saves.slice(before).map(s => [s.reason, s.lobsters, s.coins]).sort(),
      [['trade', 0, 200], ['trade', 3, 300]], 'both saves see final ownership');
    await action(pair[0], 4); await action(pair[1], 5);
    assert.equal(saves.length, before + 2, 'late accept/decline never settles twice');
    assert.deepEqual([count(a, COINS), count(b, LOBSTER), count(b, COINS)], [200, 3, 300]);
  });
  await t.test('Shield of Arrav handover items can be traded directly', async test => {
    require('../plugins/quests/quests/ShieldOfArrav.Quest')(PluginManager.createApi('ShieldOfArravTrade'));
    const { WEAPON_STORE_KEY: key, WEAPON_STORE_KEY_2: note, PHOENIX_CROSSBOW: crossbow,
      HALF_CERTIFICATE: left, HALF_CERTIFICATE_2: right, CERTIFICATE: certificate } = core.ItemIdentifiers;
    const pair = [actor(test), actor(test)];
    const [alice, bob] = pair.map(f => f.player);
    const inventory = alice.getInventory();
    inventory.setItem(0, new Item(key, 1));
    inventory.setItem(1, new Item(key, 1).setMetaValue(Item.UNTRADEABLE_META, true));
    inventory.setItem(2, new Item(key, 1));
    inventory.setItem(3, new Item(note, 2));
    inventory.setItem(4, new Item(crossbow, 1));
    inventory.setItem(5, new Item(left, 2));
    inventory.setItem(6, new Item(certificate, 1));
    bob.getInventory().setItem(0, new Item(right, 2));
    alice.getTrading().requestTrade(bob);
    bob.getTrading().requestTrade(alice);
    await action(pair[0], 0, 0, 3, key);
    for (const [slot, id] of [[1, key], [3, note], [4, crossbow], [5, left], [6, certificate]]) {
      await action(pair[0], 0, slot, 1, id);
    }
    await action(pair[1], 0, 0, 1, right);

    const offer = alice.getTrading().getContainer();
    assert.equal(offer.getAmount(key), 2, 'both normal keys enter the offer');
    assert.equal(count(alice, key), 1, 'the untradeable copy stays in the inventory');
    assert.equal(offer.getAmount(certificate), 0, 'the combined certificate cannot be traded');
    await action(pair[0], 1, offer.getSlotForItemId(key), 1, key);
    assert.equal(offer.getAmount(key), 1, 'a key can be removed from the offer');
    for (const f of pair) await action(f, 2);
    for (const f of pair) await action(f, 4);
    ended(pair);
    assert.deepEqual([key, note, crossbow, left].map(id => count(bob, id)), [1, 1, 1, 1]);
    assert.equal(count(alice, right), 1);
    assert.equal(count(alice, certificate), 1);
    for (const id of [key, note, crossbow, left, right]) {
      assert.equal(ItemDefinition.forId(id).isTradeable(), false, 'the cache trade flag stays false');
    }
  });
  for (const stage of ['offer', 'confirm']) for (const cancel of ['decline', 'interface-close']) {
    await t.test(stage + ' ' + cancel + ' returns offers and closes both sessions', async test => {
      const pair = await start(test); if (stage === 'confirm') await confirm(pair);
      const before = saves.length;
      if (cancel === 'decline') await action(pair[0], stage === 'confirm' ? 5 : 3);
      else {
        await pair[0].connection.dispatch([{ type: 'interface_close' }]); pair[0].connection.processTurnPackets();
      }
      ended(pair);
      assert.deepEqual([count(pair[0].player, LOBSTER), count(pair[1].player, COINS)], [3, 500]);
      assert.equal(saves.length, before, 'cancel never commits a trade');
      await action(pair[0], 4); ended(pair);
      assert.deepEqual([count(pair[0].player, LOBSTER), count(pair[1].player, COINS)], [3, 500]);
    });
  }
});

test("a slot filled between the two accepts refuses the trade instead of deleting what is offered", () => {
  const { alice, bob } = startTrade();
  // Bob has exactly the 3 free slots Alice's 3 lobsters need at the first accept.
  for (let i = bob.getInventory().getFreeSlots(); i > 3; i--) bob.getInventory().adds(LOGS, 1);
  assert.equal(bob.getInventory().getFreeSlots(), 3);
  alice.getTrading().acceptTrade();
  bob.getTrading().acceptTrade();
  alice.getTrading().getButtonDelay().stop();
  bob.getTrading().getButtonDelay().stop();
  bob.getInventory().adds(HELM, 1); // taken off on the confirm screen: the equipment tab stays usable
  alice.getTrading().acceptTrade();
  bob.getTrading().acceptTrade();
  assert.equal(count(bob, LOBSTER), 0, "nothing given into too little room");
  assert.equal(alice.getTrading().getContainer().getAmount(LOBSTER), 3, "the lobsters are still on offer, not deleted");
  assert.ok(bob.messages.includes("Trade cannot be accepted, you don't have enough free inventory space."));
  assert.equal(count(alice, COINS), 0, "and Alice did not receive Bob's side either");
});
