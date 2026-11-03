// Run after `yarn build`: node --test tests/note-exchange.test.cjs
const assert = require("node:assert/strict");
const { test, before } = require("node:test");
const path = require("node:path");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { CacheDefinitions } = require("../dist/game/cache/CacheDefinitions");
const { PluginManager } = require("../dist/plugins/PluginManager");
const NoteExchange = require("../plugins/npcs/NoteExchange.plugin");
const DATA = require("../plugins/npcs/data/note-exchange.json");
const { exchangeable, accepts } = NoteExchange._test;

const core = PluginManager.getCoreApi();
const COINS = 995;
const BONES = 526;
const BONES_NOTE = 527;
const LOGS = 1511;
const phials = { fee: 5 };

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  NoteExchange.register(PluginManager.createApi('NoteExchangeTest'));
});

test('the Chaos druid remembers a native Exchange X amount for later exchanges', async t => {
  const { Player } = require('../dist/game/entity/impl/player/Player');
  const { PlayerSession } = require('../dist/net/PlayerSession');
  const { ClientConnection } = require('../dist/net/NetworkBuilder');
  const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(500); p.setRegistered(true); p.setUsername('exchangenative');
  const connection = new ClientConnection(channel); connection.player = p;
  t.after(() => { p.closeInterruptibleInterfaces(); p.setRegistered(false); core.TaskManager.cancelTasks(p.getIndex()); });
  p.getInventory().adds(BONES_NOTE, 50); p.getInventory().adds(COINS, 10000);
  const npc = new core.NPC(core.NpcIdentifiers.ELDER_CHAOS_DRUID_2, p.getLocation());
  const open = () => PluginManager.emitItemOnNpc({ player: p, target: npc, npcId: npc.getId(), itemId: BONES_NOTE,
    item: p.getInventory().get(p.getInventory().getSlotForItemId(BONES_NOTE)), handled: false });
  const choose = async childIndex => {
    await connection.dispatch([{ type: 'dialogue_continue', widgetId: core.OptionDialogue.OPTIONS_WIDGET_ID, childIndex }]);
    connection.processTurnPackets();
  };
  const input = async amount => { await connection.dispatch([{ type: 'dialogue_amount', amount }]); connection.processTurnPackets(); };
  assert.equal(open(), true);
  assert.equal(p.getDialogueManager().getCurrent().getOptions()[1], 'Exchange 5 (250 coins).');
  await choose(4); await input(7);
  assert.equal(p.getInventory().getAmount(BONES), 7);
  assert.equal(p.getInventory().getAmount(COINS), 9650);
  p.getInventory().deleteNumber(BONES, 7);
  open();
  assert.equal(p.getDialogueManager().getCurrent().getOptions()[1], 'Exchange 7 (350 coins).');
  await choose(2);
  assert.equal(p.getInventory().getAmount(BONES), 7, 'the shortcut repeats the chosen amount');
  p.getInventory().deleteNumber(BONES, 7);
  open(); await choose(4);
  p.getPacketSender().sendInterfaceRemoval(); await input(12);
  open();
  assert.equal(p.getDialogueManager().getCurrent().getOptions()[1], 'Exchange 7 (350 coins).', 'cancelled X cannot overwrite it');
  await choose(4); await input(1000);
  assert.equal(p.getInventory().getAmount(BONES), 26, 'a remembered request remains capped by available inventory space');
});

/** Stacks of [id, amount], one per slot; the rest of the 28 slots are free. */
function playerWith(stacks) {
  return {
    getInventory: () => ({
      getAmount: (id) => stacks.filter(([itemId]) => itemId === id).reduce((sum, [, amount]) => sum + amount, 0),
      getFreeSlots: () => 28 - stacks.length,
    }),
  };
}

const filler = (count) => Array.from({ length: count }, () => [LOGS, 1]);

test("the data: every merchant is the NPC it names, and every accepted item exists", () => {
  const names = new Set();
  for (let id = 0; id < CacheDefinitions.getCounts().items; id++) names.add(CacheDefinitions.getItem(id).name);
  for (const merchant of DATA.merchants) {
    const id = core.NpcIdentifiers[merchant.npc];
    assert.ok(Number.isInteger(id), merchant.npc);
    assert.equal(CacheDefinitions.getNpc(id).name, merchant.name);
    for (const item of Array.isArray(merchant.accepts) ? merchant.accepts : []) assert.ok(names.has(item), item);
  }
});

test("capped by notes held, coins and free slots", () => {
  assert.equal(exchangeable(playerWith([[BONES_NOTE, 30], [COINS, 1000]]), phials, BONES_NOTE, BONES, 30), 26);
  assert.equal(exchangeable(playerWith([[BONES_NOTE, 30], [COINS, 100]]), phials, BONES_NOTE, BONES, 30), 20);
  assert.equal(exchangeable(playerWith([[BONES_NOTE, 3], [COINS, 1000]]), phials, BONES_NOTE, BONES, 10), 3);
  assert.equal(exchangeable(playerWith([[BONES_NOTE, 30], [COINS, 4]]), phials, BONES_NOTE, BONES, 1), 0);
});

test("a stack used up in full frees its slot", () => {
  // Full inventory: the last note and the last 5 coins each give back a slot.
  assert.equal(exchangeable(playerWith([[BONES_NOTE, 1], [COINS, 1000], ...filler(26)]), phials, BONES_NOTE, BONES, 1), 1);
  assert.equal(exchangeable(playerWith([[BONES_NOTE, 2], [COINS, 10], ...filler(26)]), phials, BONES_NOTE, BONES, 2), 2);
  assert.equal(exchangeable(playerWith([[BONES_NOTE, 5], [COINS, 1000], ...filler(26)]), phials, BONES_NOTE, BONES, 5), 0);
});

test("bones-only merchants", () => {
  const druid = { accepts: "bury" };
  assert.equal(accepts(druid, BONES), true);
  assert.equal(accepts(druid, LOGS), false);
  const virilis = { accepts: new Set(["Bones"]) };
  assert.equal(accepts(virilis, BONES), true);
  assert.equal(accepts(virilis, LOGS), false);
  assert.equal(accepts({}, LOGS), true);
});
