// Run after `yarn build`: node --test tests/brimstone-ring.test.cjs
//
// Effect: Wiki Brimstone_ring and rsprox capture 1534 (rev 224): a magic attack has a 25% chance
// to cut the target's magic defence roll by 10%, and the red "Your attack ignored 10% of your
// opponent's magic defence." spam message arrives on the cast tick. Creation: the Wiki transcript
// of the Hydra's eye (warning, Proceed / Cancel menu, success box); no capture of it exists.
const assert = require("node:assert/strict");
const { before, test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { NPC } = require("../dist/game/entity/impl/npc/NPC");
const { World } = require("../dist/game/World");
const { Misc } = require("../dist/util/Misc");
const { AccuracyFormulasDpsCalc: Accuracy } = require("../dist/game/content/combat/formula/AccuracyFormulasDpsCalc");
const { CombatType } = require("../dist/game/content/combat/CombatType");
const { Item } = require("../dist/game/model/Item");
const { ItemDefinition } = require("../dist/game/definition/ItemDefinition");
const { ItemIdentifiers: I } = require("../dist/util/ItemIdentifiers");
const { Equipment } = require("../dist/game/model/container/impl/Equipment");
const { ChatType } = require("../dist/net/protocol/ClientProtocol");
const { StatementDialogue } = require("../dist/game/model/dialogues/entries/impl/StatementDialogue");
const { ItemStatementDialogue } = require("../dist/game/model/dialogues/entries/impl/ItemStatementDialogue");
const { ActionDialogue } = require("../dist/game/model/dialogues/entries/impl/ActionDialogue");

const BrimstoneRing = require("../plugins/items/BrimstoneRing.plugin");
const registerEffect = require("../plugins/combat/effects/BrimstoneRing.EquipmentEffects");

const MESSAGE = "<col=ff0000>Your attack ignored 10% of your opponent's magic defence.</col>";
let cycle = 1000;

before(async () => {
  await CachePipeline.initialize(process.cwd());
  registerEffect(PluginManager.createApi("BrimstoneRingTest"));
});

function fixture(t, { ring = I.BRIMSTONE_RING } = {}) {
  const player = new Player(null);
  const target = new NPC(2085, new (PluginManager.getCoreApi().Location)(3200, 3200));
  const sent = [];
  t.mock.method(player, "getPacketSender", () => ({ sendTypedMessage: (type, text) => sent.push([type, text]) }));
  t.mock.method(player.getCombat(), "getTarget", () => target);
  t.mock.method(World, "getProcessCycle", () => cycle);
  player.getEquipment().getItems()[Equipment.RING_SLOT] = ring < 0 ? null : new Item(ring, 1);
  // Equal rolls never land (attack must beat defence); a 10% cut makes the attack roll win.
  t.mock.method(Accuracy, "attackMagicRoll", () => 1000);
  t.mock.method(Accuracy, "defenseMagicRoll", () => 1000);
  t.mock.method(Misc, "randomInclusive", (min, max) => max);
  return { player, target, sent, roll: (who = target) => Accuracy.rollAccuracy(player, who, CombatType.MAGIC) };
}

test("a proc cuts the defence roll by 10%, so an equal roll lands, with the captured red spam message", (t) => {
  const f = fixture(t);
  t.mock.method(Math, "random", () => 0.2499);
  cycle++;
  assert.equal(f.roll(), true);
  assert.deepEqual(f.sent, [[ChatType.SPAM, MESSAGE]]);
});

test("without a proc nothing changes and nothing is said", (t) => {
  const f = fixture(t);
  t.mock.method(Math, "random", () => 0.25);
  cycle++;
  assert.equal(f.roll(), false);
  assert.deepEqual(f.sent, []);
});

test("one decision and one message per attack tick, however many rolls it makes", (t) => {
  const f = fixture(t);
  t.mock.method(Math, "random", () => 0.1);
  cycle++;
  assert.equal(f.roll(), true);
  assert.equal(f.roll(), true);
  assert.equal(f.sent.length, 1);
  cycle++;
  assert.equal(f.roll(), true);
  assert.equal(f.sent.length, 2, "the next attack tick decides again");
});

test("only the chosen target is affected, not splash targets", (t) => {
  const f = fixture(t);
  t.mock.method(Math, "random", () => 0);
  cycle++;
  const splash = new NPC(2085, new (PluginManager.getCoreApi().Location)(3201, 3200));
  assert.equal(f.roll(splash), false);
  assert.deepEqual(f.sent, []);
});

test("only the worn brimstone ring, and only magic attacks", (t) => {
  const none = fixture(t, { ring: -1 });
  t.mock.method(Math, "random", () => 0);
  cycle++;
  assert.equal(none.roll(), false);
  assert.deepEqual(none.sent, []);
  const other = fixture(t, { ring: I.SEERS_RING });
  cycle++;
  assert.equal(other.roll(), false);
  const ranged = fixture(t);
  cycle++;
  assert.equal(Accuracy.rollAccuracy(ranged.player, ranged.target, CombatType.RANGED), false);
  assert.deepEqual(ranged.sent, []);
});

test("the proc chance is 25%", () => {
  assert.equal(registerEffect._test.PROC_PERCENT, 25);
});

// --- creation ---

const registrations = [];
const tasks = [];
const makeApi = () => new Proxy({
  core: PluginManager.getCoreApi(),
  onItemOnItem: (first, second, handler, filter) => registrations.push({ first, second, handler, filter }),
  sendMultiChatboxPrompt(player, title, ...pairs) {
    player.prompt = { title, options: pairs.filter((_, i) => i % 2 === 0), callbacks: pairs.filter((_, i) => i % 2 === 1) };
    return true;
  },
}, { get: (target, property) => (property in target ? target[property] : () => {}) });

function createPlayer(ids) {
  const slots = ids.map((id) => new Item(id, 1));
  const player = {
    slots, chains: [], messages: [], removals: 0, prompt: null,
    getInventory: () => ({
      getItems: () => slots,
      getAmount: (id) => slots.reduce((n, e) => n + (e && e.getId() === id ? e.getAmount() : 0), 0),
      deleteAtSlot(slot) { slots[slot] = null; },
      addItem(item) { slots.push(item); },
    }),
    getDialogueManager: () => ({ startDialogues: (chain) => player.chains.push(chain) }),
    getPacketSender: () => ({ sendInterfaceRemoval() { player.removals++; } }),
    sendMessage: (m) => player.messages.push(m),
  };
  return player;
}

const held = (player) => player.slots.filter(Boolean).map((e) => e.getId()).sort((a, b) => a - b);
const PARTS = [I.HYDRAS_EYE, I.HYDRAS_FANG, I.HYDRAS_HEART];

function use(player, a, b) {
  const used = ItemDefinition.forId(a).getName(), withName = ItemDefinition.forId(b).getName();
  const hook = registrations.find((r) => (r.first === used && r.second === withName) || (r.first === withName && r.second === used));
  assert.ok(hook, `no hook for ${used} + ${withName}`);
  assert.equal(hook.filter?.noted, false);
  const usedItem = player.slots.find((e) => e && e.getId() === a);
  const usedWithItem = player.slots.find((e) => e && e.getId() === b);
  return hook.handler({ player, usedItem, usedItemId: a, usedWithItem, usedWithItemId: b });
}

test("any two hydra parts with the third carried ask first and consume nothing", () => {
  registrations.length = 0;
  BrimstoneRing.register(makeApi());
  for (const [a, b] of [[PARTS[0], PARTS[1]], [PARTS[1], PARTS[2]], [PARTS[2], PARTS[0]]]) {
    const player = createPlayer(PARTS);
    use(player, a, b);
    const [box, action] = [...player.chains[0].getDialogues().values()];
    assert.ok(box instanceof StatementDialogue);
    assert.equal(box.getText(), BrimstoneRing._test.CONFIRM_TEXT);
    assert.ok(action instanceof ActionDialogue);
    action.send(player);
    assert.equal(player.prompt.title, "Select an option");
    assert.deepEqual(player.prompt.options, ["Proceed with the combination.", "Cancel."]);
    assert.deepEqual(held(player), [...PARTS].sort((x, y) => x - y));
  }
});

test("Proceed swaps the three parts for the ring and says so; Cancel keeps them", () => {
  registrations.length = 0;
  BrimstoneRing.register(makeApi());
  const cancelled = createPlayer(PARTS);
  use(cancelled, PARTS[0], PARTS[1]);
  [...cancelled.chains[0].getDialogues().values()][1].send(cancelled);
  cancelled.prompt.callbacks[1]();
  assert.deepEqual(held(cancelled), [...PARTS].sort((x, y) => x - y));

  const player = createPlayer([...PARTS, I.COINS_995 ?? 995]);
  use(player, PARTS[0], PARTS[1]);
  [...player.chains[0].getDialogues().values()][1].send(player);
  player.prompt.callbacks[0]();
  assert.deepEqual(held(player), [995, I.BRIMSTONE_RING].sort((x, y) => x - y));
  const [success] = [...player.chains[1].getDialogues().values()];
  assert.ok(success instanceof ItemStatementDialogue);
  assert.equal(success.getText(), BrimstoneRing._test.SUCCESS_TEXT);
});

test("with a part missing the use is left unhandled", () => {
  registrations.length = 0;
  BrimstoneRing.register(makeApi());
  const player = createPlayer([PARTS[0], PARTS[1]]);
  assert.equal(use(player, PARTS[0], PARTS[1]), false);
  assert.deepEqual(player.chains, []);
});
