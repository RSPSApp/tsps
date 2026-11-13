// Run after `yarn build`: node --test tests/bank-incinerator-destroy-veto.test.cjs
// The bank incinerator refuses what the inventory's Destroy refuses: a bond ("This object cannot be dropped or
// destroyed.") and a coal bag still holding coal ("You need to empty the coal bag before you can destroy it."), whose
// coal went with it. Real engine: every plugin loaded, a real Player with the bank open, the drag to the incinerator
// through Bank.handleDrag (the IF_BUTTOND route).
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
process.env.DISABLE_PLAYER_BOTS = "1";
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { Bank } = require("../dist/game/model/container/impl/Bank");

let core;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

let next = 9930;
function banker(t, itemId, setup) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++); p.setUsername("incinerate" + p.getIndex()); p.setRegistered(true); p.setAttribute("bot-skip-persistence", true);
  t.after(() => p.setRegistered(false));
  const messages = [];
  t.mock.method(p.getPacketSender(), "sendMessage", (m) => { messages.push(m); return p.getPacketSender(); });
  p.getBank(0).add(new core.Item(itemId, 1), false);
  setup?.(p);
  p.getBank(0).open();
  assert.equal(Bank.isOpen(p), true, "the bank is open");
  const slot = p.getBank(0).getSlotForItemId(itemId);
  Bank.handleDrag(p, { sourceWidgetId: (Bank.MAIN_INTERFACE_ID << 16) | Bank.ITEMS_CHILD, sourceSlot: slot, sourceItemId: itemId,
    targetWidgetId: (Bank.MAIN_INTERFACE_ID << 16) | Bank.INCINERATOR_CHILD, targetSlot: -1 });
  return { p, messages, prompted: p.getPacketSender().isChatboxInterface?.(584) === true };
}

test("a bond can't be incinerated from the bank", (t) => {
  const bond = core.ItemIdentifiers.OLD_SCHOOL_BOND;
  const f = banker(t, bond);
  assert.equal(f.prompted, false, "no destroy prompt");
  assert.equal(f.p.getBank(0).getAmount(bond), 1);
  assert.ok(f.messages.includes("This object cannot be dropped or destroyed."), f.messages.join(" | "));
});

test("a coal bag still holding coal can't be incinerated from the bank; an empty one can be offered", (t) => {
  const bag = core.ItemIdentifiers.COAL_BAG_2 ?? core.CacheDefinitions.getObjId("coal_bag");
  const full = banker(t, bag, (p) => p.setAttribute("storage-items:coal-bag", [[core.ItemIdentifiers.COAL, 20]]));
  assert.equal(full.prompted, false, "no destroy prompt");
  assert.equal(full.p.getBank(0).getAmount(bag), 1);
  assert.deepEqual(full.p.getAttribute("storage-items:coal-bag"), [[core.ItemIdentifiers.COAL, 20]], "the coal is kept");
  assert.ok(full.messages.includes("You need to empty the coal bag before you can destroy it."), full.messages.join(" | "));
  const empty = banker(t, bag);
  assert.equal(empty.prompted, true, "an empty bag gets the ordinary destroy prompt");
});

test("a confirmed incineration burns the stack with synth 159 (firebreath), not the inventory's 2381 (rsprox 232/03219)", (t) => {
  const logs = core.ItemIdentifiers.LOGS;
  const sounds = [];
  const f = banker(t, logs, (p) => t.mock.method(p.getPacketSender(), "sendSound", (id) => { sounds.push(id); return p.getPacketSender(); }));
  assert.equal(f.prompted, true, "the destroy prompt");
  assert.deepEqual(sounds, [], "nothing before the Yes");
  PM.emitInterfaceActionClick({ player: f.p, buttonId: 584 << 16, action: 1, handled: false });
  assert.equal(f.p.getBank(0).getAmount(logs), 0, "the stack is gone");
  assert.deepEqual(sounds, [159]);
});

test("No on the incinerator prompt keeps the stack and plays nothing", (t) => {
  const logs = core.ItemIdentifiers.LOGS;
  const sounds = [];
  const f = banker(t, logs, (p) => t.mock.method(p.getPacketSender(), "sendSound", (id) => { sounds.push(id); return p.getPacketSender(); }));
  PM.emitInterfaceActionClick({ player: f.p, buttonId: 584 << 16, action: 0, handled: false });
  assert.equal(f.p.getBank(0).getAmount(logs), 1);
  assert.deepEqual(sounds, []);
});
