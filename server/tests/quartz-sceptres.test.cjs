// Run after `yarn build`: node --test tests/quartz-sceptres.test.cjs
//
// rsprox capture 821 (rev 234) ticks 1641-1645: a blood quartz on the ancient sceptre asks in a double item
// box, then "Combine the Blood quartz and Ancient sceptre?" Yes. / No.; Yes leaves the Blood ancient sceptre in
// the quartz's slot (seq 10096, spotanim 759, synth 140) and shows its item box. Dismantle is Ours.
const assert = require("node:assert/strict");
const { before, test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { Item } = require("../dist/game/model/Item");
const { ItemDefinition } = require("../dist/game/definition/ItemDefinition");
const { ItemIdentifiers: I } = require("../dist/util/ItemIdentifiers");
const { DoubleItemStatementDialogue } = require("../dist/game/model/dialogues/entries/impl/DoubleItemStatementDialogue");
const { ItemStatementDialogue } = require("../dist/game/model/dialogues/entries/impl/ItemStatementDialogue");
const { ActionDialogue } = require("../dist/game/model/dialogues/entries/impl/ActionDialogue");

const QuartzSceptres = require("../plugins/items/QuartzSceptres.plugin");

const combines = [];
const actions = [];

before(async () => {
  await CachePipeline.initialize(process.cwd());
  const core = PluginManager.getCoreApi();
  QuartzSceptres.register(new Proxy({
    core,
    onItemOnItem: (first, second, handler, filter) => combines.push({ first, second, handler, filter }),
    onItemAction: (name, options) => actions.push({ name, options }),
    sendMultiChatboxPrompt(player, title, ...pairs) {
      player.prompt = { title, options: pairs.filter((_, i) => i % 2 === 0), callbacks: pairs.filter((_, i) => i % 2 === 1) };
      return true;
    },
  }, { get: (target, property) => (property in target ? target[property] : () => {}) }));
});

const QUARTZ_TO_SCEPTRE = [
  [I.BLOOD_QUARTZ, I.BLOOD_ANCIENT_SCEPTRE_2, "Blood"],
  [I.ICE_QUARTZ, I.ICE_ANCIENT_SCEPTRE_2, "Ice"],
  [I.SMOKE_QUARTZ, I.SMOKE_ANCIENT_SCEPTRE_2, "Smoke"],
  [I.SHADOW_QUARTZ, I.SHADOW_ANCIENT_SCEPTRE_2, "Shadow"],
];

function fixture(t, slots) {
  const player = new Player(null);
  const chains = [];
  const sent = { messages: [], sounds: [] };
  const sender = new Proxy({ sendSoundEffect: (id) => sent.sounds.push(id) }, { get: (target, p) => target[p] ?? (() => sender) });
  t.mock.method(player, "getPacketSender", () => sender);
  t.mock.method(player, "getDialogueManager", () => ({ startDialogues: (chain) => chains.push([...chain.getDialogues().values()]) }));
  t.mock.method(player, "sendMessage", (m) => sent.messages.push(m));
  const anims = [];
  const gfx = [];
  t.mock.method(player, "performAnimation", (a) => anims.push(a.getId()));
  t.mock.method(player, "performGraphic", (g) => gfx.push(g.getId()));
  const inventory = player.getInventory();
  slots.forEach((id, slot) => inventory.setItem(slot, id == null ? new Item(-1, 0) : new Item(id, 1)));
  return { player, chains, sent, anims, gfx, inventory };
}

const ids = (inventory) => inventory.getItems().map((item) => (item && item.getId() >= 0 ? item.getId() : null));

function use(f, a, b) {
  const used = ItemDefinition.forId(a).getName(), withName = ItemDefinition.forId(b).getName();
  const hook = combines.find((r) => (r.first === used && r.second === withName) || (r.first === withName && r.second === used));
  assert.ok(hook, `no hook for ${used} + ${withName}`);
  assert.equal(hook.filter?.noted, false);
  return hook.handler({ player: f.player, usedItemId: a, usedWithItemId: b });
}

test("the hooks name the cache's items", () => {
  for (const [quartz, sceptre] of QUARTZ_TO_SCEPTRE) {
    assert.ok(combines.some((r) => r.first === ItemDefinition.forId(quartz).getName() && r.second === ItemDefinition.forId(I.ANCIENT_SCEPTRE).getName()));
    const action = actions.find((a) => a.name === ItemDefinition.forId(sceptre).getName());
    assert.ok(action?.options.Dismantle, `Dismantle on ${sceptre}`);
  }
});

test("each quartz on the sceptre asks first, with the captured lines, and takes nothing", (t) => {
  for (const [quartz, sceptre, kind] of QUARTZ_TO_SCEPTRE) {
    const f = fixture(t, [I.ANCIENT_SCEPTRE, null, quartz]);
    assert.equal(use(f, quartz, I.ANCIENT_SCEPTRE), true);
    const [box, action] = f.chains[0];
    assert.ok(box instanceof DoubleItemStatementDialogue);
    assert.equal(box.getText(), `Are you sure you wish to combine the ${kind} quartz and Ancient sceptre to create a ${kind} ancient sceptre?`);
    assert.ok(action instanceof ActionDialogue);
    action.send(f.player);
    assert.equal(f.player.prompt.title, `Combine the ${kind} quartz and Ancient sceptre?`);
    assert.deepEqual(f.player.prompt.options, ["Yes.", "No."]);
    assert.deepEqual(ids(f.inventory).slice(0, 3), [I.ANCIENT_SCEPTRE, null, quartz]);
    f.player.prompt.callbacks[1]();
    assert.deepEqual(ids(f.inventory).slice(0, 3), [I.ANCIENT_SCEPTRE, null, quartz], "No keeps both");
  }
});

test("Yes leaves the upgraded sceptre in the quartz's slot, with the captured seq, spotanim, sound and box", (t) => {
  for (const [quartz, sceptre, kind] of QUARTZ_TO_SCEPTRE) {
    // Either way round: the sceptre used on the quartz gives the same result.
    for (const [a, b] of [[quartz, I.ANCIENT_SCEPTRE], [I.ANCIENT_SCEPTRE, quartz]]) {
      const f = fixture(t, [null, I.ANCIENT_SCEPTRE, null, null, null, null, null, quartz]);
      use(f, a, b);
      f.chains[0][1].send(f.player);
      f.player.prompt.callbacks[0]();
      const after = ids(f.inventory);
      assert.equal(after[1], null);
      assert.ok(f.inventory.getItems().every((item) => item != null), "no slot is left null");
      assert.equal(after[7], sceptre);
      assert.deepEqual(f.anims, [10096]);
      assert.deepEqual(f.gfx, [759]);
      assert.deepEqual(f.sent.sounds, [140]);
      const [done] = f.chains[1];
      assert.ok(done instanceof ItemStatementDialogue);
      assert.equal(done.getText(), `You successfully combine the ${kind} quartz and Ancient sceptre to create a ${kind} ancient sceptre.`);
    }
  }
});

test("Yes after the quartz or sceptre has gone does nothing", (t) => {
  const f = fixture(t, [I.ANCIENT_SCEPTRE, I.BLOOD_QUARTZ]);
  use(f, I.BLOOD_QUARTZ, I.ANCIENT_SCEPTRE);
  f.chains[0][1].send(f.player);
  f.inventory.deleteAtSlot(1, 1, false);
  f.player.prompt.callbacks[0]();
  assert.deepEqual(ids(f.inventory).slice(0, 2), [I.ANCIENT_SCEPTRE, null]);
  assert.equal(f.chains.length, 1);
  assert.deepEqual(f.anims, []);
});

test("the locked sceptre and other items are left to other handlers", (t) => {
  const f = fixture(t, [I.ANCIENT_SCEPTRE_L_, I.BLOOD_QUARTZ]);
  assert.equal(QuartzSceptres._test.combine({ player: f.player, usedItemId: I.BLOOD_QUARTZ, usedWithItemId: I.ANCIENT_SCEPTRE_L_ }), false);
  assert.equal(QuartzSceptres._test.combine({ player: f.player, usedItemId: I.BLOOD_QUARTZ, usedWithItemId: I.ICE_QUARTZ }), false);
  assert.deepEqual(f.chains, []);
});

test("Dismantle gives back the ancient sceptre in its slot and the quartz", (t) => {
  for (const [quartz, sceptre] of QUARTZ_TO_SCEPTRE) {
    const f = fixture(t, [I.COINS_995 ?? 995, sceptre]);
    const item = f.inventory.getItems()[1];
    assert.equal(QuartzSceptres._test.dismantle({ player: f.player, itemId: sceptre, item, slot: 1 }), true);
    const after = ids(f.inventory);
    assert.equal(after[1], I.ANCIENT_SCEPTRE);
    assert.equal(after.filter((id) => id === quartz).length, 1);
    assert.equal(after.filter((id) => id === sceptre).length, 0);
    assert.deepEqual(f.sent.messages, []);
  }
});

test("Dismantle with a full inventory refuses and keeps the sceptre", (t) => {
  const slots = new Array(28).fill(I.COINS_995 ?? 995).map((id, i) => (i === 5 ? I.SMOKE_ANCIENT_SCEPTRE_2 : I.BONES ?? 526));
  const f = fixture(t, slots);
  QuartzSceptres._test.dismantle({ player: f.player, itemId: I.SMOKE_ANCIENT_SCEPTRE_2, item: f.inventory.getItems()[5], slot: 5 });
  assert.equal(ids(f.inventory)[5], I.SMOKE_ANCIENT_SCEPTRE_2);
  assert.ok(!ids(f.inventory).includes(I.SMOKE_QUARTZ));
  assert.deepEqual(f.sent.messages, [QuartzSceptres._test.NO_SPACE]);
});
