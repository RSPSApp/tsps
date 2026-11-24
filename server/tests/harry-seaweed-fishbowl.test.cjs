// Run after `yarn build`: node --test tests/harry-seaweed-fishbowl.test.cjs
// Harry (Catherby fish shop) answered none of the fishbowl conditions in his Wiki transcript, so a fishbowl of water
// and seaweed was treated like a fishbowl of only water (#6546). Real engine: every plugin loaded, a real Player
// holding the bowl, Harry's real transcript driven by native dialogue_continue packets.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ClientConnection } = require("../dist/net/NetworkBuilder");
let core, I;
const WATER_BOWL = 6668, SEAWEED_BOWL = 6669, TINY_NET = 6674, FISHFOOD_BOX = 6675, BONES = 526;
before(async () => { await CachePipeline.initialize(path.resolve(__dirname, "..")); PM.loadFromDirectory(path.resolve(__dirname, "../plugins")); core = PM.getCoreApi(); I = core.ItemIdentifiers; PM.emitServerStartup({}); });
after(() => PM.emitServerShutdown({}));

let seq = 0;
function actor(t, { items = [], coins = 100, fill = false } = {}) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(9500 + ++seq); p.setUsername(`harry-fixture-${seq}`); p.setRegistered(true); p.setAttribute("bot-skip-persistence", true); p.needsPlacement = false;
  p.setLocation(new core.Location(2832, 3441, 0));
  const c = new ClientConnection(channel); c.player = p;
  t.after(() => p.setRegistered(false));
  if (coins) p.getInventory().add(new core.Item(I.COINS, coins), false);
  for (const id of items) p.getInventory().add(new core.Item(id, 1), false);
  if (fill) while (!p.getInventory().isFull()) p.getInventory().add(new core.Item(BONES, 1), false);
  const npc = core.NPC.create(core.NpcIdentifiers.HARRY, new core.Location(2834, 3441, 0));
  const request = { player: p, npc, npcId: core.NpcIdentifiers.HARRY, handled: false };
  PM.emitCustomEvent("npc-dialogue:start", request);
  assert.equal(request.handled, true, "Harry's transcript plays");
  return { p, c };
}
async function resume(f, choice) {
  const group = f.p.getPacketSender().getChatboxGroupId();
  const widgetId = choice == null ? (group << 16) | ([231, 217].includes(group) ? 5 : 0) : core.OptionDialogue.OPTIONS_WIDGET_ID;
  await f.c.dispatch([{ type: "dialogue_continue", widgetId, childIndex: choice ?? -1 }]); f.c.processTurnPackets();
}
async function menu(f) {
  for (let i = 0; i < 40; i++) {
    const pending = core.MultiChatboxPrompt.getPending(f.p); if (pending) return pending.options;
    if (!f.p.getDialogueManager().getCurrent()) return [];
    await resume(f);
  }
}
async function choose(f, pattern) {
  const opts = await menu(f);
  const i = opts.findIndex((o) => pattern.test(o));
  assert.ok(i >= 0, `option ${pattern} offered in [${opts.join(" | ")}]`);
  await resume(f, i + 1);
}
async function finish(f) {
  for (let i = 0; i < 20 && f.p.getDialogueManager().getCurrent() && !core.MultiChatboxPrompt.getPending(f.p); i++) await resume(f);
}
const count = (f, id) => f.p.getInventory().getAmount(id);

test("a fishbowl of water and seaweed gets the tiny net offer; 10 coins buy exactly one net", async (t) => {
  const f = actor(t, { items: [SEAWEED_BOWL] });
  await choose(f, /Can I get a fish for this bowl/);
  await choose(f, /I'll take it/);
  await finish(f);
  assert.equal(count(f, TINY_NET), 1);
  assert.equal(count(f, I.COINS), 90);
  assert.equal(count(f, SEAWEED_BOWL), 1, "the bowl is kept for the aquarium");
});

test("a fishbowl of only water is still told to add seaweed, and no net is sold", async (t) => {
  const f = actor(t, { items: [WATER_BOWL] });
  await choose(f, /Can I get a fish for this bowl/);
  await finish(f);
  assert.equal(count(f, TINY_NET), 0);
  assert.equal(count(f, I.COINS), 100);
});

test("without 10 coins Harry holds the net back", async (t) => {
  const f = actor(t, { items: [SEAWEED_BOWL], coins: 5 });
  await choose(f, /Can I get a fish for this bowl/);
  await choose(f, /I'll take it/);
  await finish(f);
  assert.equal(count(f, TINY_NET), 0);
  assert.equal(count(f, I.COINS), 5);
});

test("a full inventory gets no net and keeps its coins", async (t) => {
  const f = actor(t, { items: [SEAWEED_BOWL], fill: true });
  assert.ok(f.p.getInventory().isFull());
  await choose(f, /Can I get a fish for this bowl/);
  await choose(f, /I'll take it/);
  await finish(f);
  assert.equal(count(f, TINY_NET), 0);
  assert.equal(count(f, I.COINS), 100);
});

test("a player who already owns a tiny net is not sold a second one", async (t) => {
  const f = actor(t, { items: [SEAWEED_BOWL, TINY_NET] });
  await choose(f, /Can I get a fish for this bowl/);
  await choose(f, /I'll take it/);
  await finish(f);
  assert.equal(count(f, TINY_NET), 1);
  assert.equal(count(f, I.COINS), 100);
});

test("Harry gives one empty fishfood box for free when asked about fishfood", async (t) => {
  const f = actor(t, { items: [SEAWEED_BOWL] });
  await choose(f, /Do you have any fishfood/);
  await finish(f);
  assert.equal(count(f, FISHFOOD_BOX), 1);
  assert.equal(count(f, I.COINS), 100);
});

test("a full inventory gets no fishfood box", async (t) => {
  const f = actor(t, { items: [SEAWEED_BOWL], fill: true });
  await choose(f, /Do you have any fishfood/);
  await finish(f);
  assert.equal(count(f, FISHFOOD_BOX), 0);
});
