// Run after `yarn build`: node --test tests/pet-fishbowl.test.cjs
// A pet fish's bowl answered none of its options (#6842). Real engine: every plugin loaded, a real Player, the
// options sent as inventory_action packets and uses as inventory_use_on packets, the dialogue continued natively.
// Lines from the Wiki (Transcript:Fishbowl (pet)); animations are the cache's human_*_pet_fish_<fish> sequences.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { CacheDefinitions } = require("../dist/game/cache/CacheDefinitions");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ClientConnection } = require("../dist/net/NetworkBuilder");
let core, I, F;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi(); I = core.ItemIdentifiers; PM.emitServerStartup({});
  F = require("../plugins/items/Fishbowl.plugin")._test;
});
after(() => PM.emitServerShutdown({}));

let seq = 0;
function actor(t, items) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(9600 + ++seq); p.setUsername(`petfish-fixture-${seq}`); p.setRegistered(true); p.setAttribute("bot-skip-persistence", true); p.needsPlacement = false;
  p.setLocation(new core.Location(2832, 3441, 0));
  const messages = [];
  const animations = [];
  const sender = p.getPacketSender();
  t.mock.method(sender, "sendMessage", (m) => { messages.push(m); return sender; });
  const perform = p.performAnimation.bind(p);
  t.mock.method(p, "performAnimation", (a) => { animations.push(a.getId()); return perform(a); });
  const c = new ClientConnection(channel); c.player = p;
  t.after(() => { p.setRegistered(false); core.TaskManager.cancelTasks(p.getIndex()); });
  items.forEach((id, slot) => p.getInventory().setItem(slot, new core.Item(id, 1)));
  return { p, c, messages, animations, inv: p.getInventory() };
}
async function option(f, slot, name) {
  await f.c.dispatch([{ type: "inventory_action", slot, itemId: f.inv.getItems()[slot].getId(), widgetId: 3214, option: name }]);
  f.c.processTurnPackets();
}
async function use(f, a, b) {
  await f.c.dispatch([{ type: "inventory_use_on", slot: a, itemId: f.inv.getItems()[a].getId(), target: { kind: "inventory", slot: b, itemId: f.inv.getItems()[b].getId() } }]);
  f.c.processTurnPackets();
}
/** Every line the open dialogue shows, continued with native dialogue_continue packets until it closes. */
async function lines(f) {
  const out = [];
  for (let i = 0; i < 10 && f.p.getDialogueManager().getCurrent(); i++) {
    const current = f.p.getDialogueManager().getCurrent();
    if (current.getText) out.push([current.constructor.name, current.getText()]);
    const group = f.p.getPacketSender().getChatboxGroupId();
    await f.c.dispatch([{ type: "dialogue_continue", widgetId: (group << 16) | ([231, 217].includes(group) ? 5 : 0), childIndex: -1 }]);
    f.c.processTurnPackets();
  }
  return out;
}
const bowls = () => [[I.FISHBOWL_3, "blue"], [I.FISHBOWL_4, "green"], [I.FISHBOWL_5, "spine"]];
const seqOf = (action, fish) => CacheDefinitions.getSeqId(`human_${action}_pet_fish_${fish}`);

test("the cache gives each pet fish's bowl Talk-At, Play-With and Feed", () => {
  for (const [bowl] of bowls()) {
    assert.deepEqual(CacheDefinitions.getItem(bowl).inventoryActions.slice(0, 3), ["Talk-At", "Play-With", "Feed"]);
  }
});

test("Talk-At: the player's line and the fish's reply, with that fish's talking animation", async (t) => {
  for (const [bowl, fish] of bowls()) {
    const f = actor(t, [bowl]);
    await option(f, 0, "Talk-At");
    assert.deepEqual(f.animations, [seqOf("talk_to", fish)]);
    assert.ok(f.animations[0] > 0);
    assert.deepEqual(await lines(f), [["PlayerDialogue", F.TALK_LINE], ["StatementDialogue", F.TALK_STATEMENT]]);
    assert.equal(f.inv.getItems()[0].getId(), bowl, "the fish stays in its bowl");
  }
});

test("Play-With: jump, the bump against the glass, then Good fish..., with that fish's play animation", async (t) => {
  for (const [bowl, fish] of bowls()) {
    const f = actor(t, [bowl]);
    await option(f, 0, "Play-With");
    assert.deepEqual(f.animations, [seqOf("play_with", fish)]);
    assert.deepEqual(await lines(f), [
      ["PlayerDialogue", F.PLAY_LINE], ["StatementDialogue", F.PLAY_STATEMENT], ["PlayerDialogue", F.PLAY_FOLLOW_UP],
    ]);
  }
});

test("Feed uses one fish food with that fish's feeding animation; without food nothing is fed", async (t) => {
  for (const [bowl, fish] of bowls()) {
    const f = actor(t, [bowl, I.FISH_FOOD, I.FISH_FOOD]);
    await option(f, 0, "Feed");
    assert.deepEqual(f.animations, [seqOf("feed", fish)]);
    assert.deepEqual(f.messages, [F.FEED_MESSAGE]);
    assert.equal(f.inv.getAmount(I.FISH_FOOD), 1);
    assert.equal(f.inv.getItems()[0].getId(), bowl);
  }
  const f = actor(t, [I.FISHBOWL_4, I.POISONED_FISH_FOOD]);
  await option(f, 0, "Feed");
  assert.deepEqual(f.animations, []);
  assert.deepEqual(f.messages, [F.NO_FOOD_MESSAGE]);
  assert.equal(f.inv.getAmount(I.POISONED_FISH_FOOD), 1, "poisoned fish food is not fish food");
});

test("any item used on a pet fish's bowl gets the strange look; the bowl used on an item does not", async (t) => {
  const f = actor(t, [I.FISHBOWL_3, I.FISH_FOOD, I.SEAWEED]);
  await use(f, 1, 0);
  await use(f, 2, 0);
  assert.deepEqual(f.messages, [F.USE_ON_MESSAGE, F.USE_ON_MESSAGE]);
  assert.equal(f.inv.getAmount(I.FISH_FOOD), 1);
  assert.equal(f.inv.getAmount(I.SEAWEED), 1);
  f.messages.length = 0;
  await use(f, 0, 1);
  assert.ok(!f.messages.includes(F.USE_ON_MESSAGE));
});

test("seaweed still goes into a bowl of water", async (t) => {
  const f = actor(t, [I.FISHBOWL, I.SEAWEED]);
  await use(f, 1, 0);
  assert.equal(f.inv.getItems()[0].getId(), I.FISHBOWL_2);
  assert.deepEqual(f.messages, []);
});
