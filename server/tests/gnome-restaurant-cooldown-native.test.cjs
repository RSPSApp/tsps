const assert = require("node:assert/strict");
const path = require("node:path");
const { before, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ClientConnection } = require("../dist/net/NetworkBuilder");
const { MultiChatboxPrompt } = require("../dist/game/model/menu/MultiChatboxPrompt");
const { PlayerSave } = require("../dist/game/entity/impl/player/persistence/PlayerSave");
const Restaurant = require("../plugins/minigames/GnomeRestaurant.plugin");
const LOCKOUTS = "gnome-restaurant:lockouts";
let core, nextIndex = 2200;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  core = PM.getCoreApi();
  Restaurant.register(PM.createApi("GnomeRestaurant"));
});
function actor(t) {
  const packets = [];
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true,
    send: packet => { packets.push(packet); return true; }, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(nextIndex++); p.setUsername(`restaurantqa${nextIndex}`); p.setRegistered(true);
  p.getSkillManager().setCurrentLevel(core.Skill.COOKING, 29);
  p.getSkillManager().setMaxLevel(core.Skill.COOKING, 29);
  // Past Aluft's and Blurberry's training (#3034's gate), so orders are offered.
  p.setAttribute("gnome-restaurant:tutorial-aluft", 6);
  p.setAttribute("gnome-restaurant:tutorial-blurberry", 6);
  const c = new ClientConnection(channel); c.player = p;
  const npc = core.NPC.create(core.NpcIdentifiers.GIANNE_JNR_, new core.Location(2439, 3502, 1));
  t.after(() => { Restaurant._test.abandon({ player: p }); p.closeInterruptibleInterfaces(); p.setRegistered(false); core.TaskManager.cancelTasks(p.getIndex()); });
  return { p, c, npc, packets };
}
function talk(f, action = "Talk-to") {
  const definition = f.npc.getCurrentDefinition(f.p);
  const clickType = definition.getActions().indexOf(action) + 1;
  assert.ok(clickType > 0, `cache menu contains ${action}`);
  const event = { player: f.p, npc: f.npc, definition, npcId: f.npc.getId(), action, clickType, handled: false };
  PM.emitNpcInteraction(event);
  assert.equal(event.handled, true);
}
async function input(f, widgetId, childIndex = 0) {
  await f.c.dispatch([{ type: "dialogue_continue", widgetId, childIndex }]);
  f.c.processTurnPackets();
}
const choose = (f, n) => input(f, MultiChatboxPrompt.OPTIONS_WIDGET_ID, n);
const line = f => f.p.getDialogueManager().getCurrent()?.getText?.();
async function continueLines(f) {
  for (let i = 0; i < 6 && f.p.getDialogueManager().isActive(); i++) await input(f, (231 << 16) | 5);
}
const pending = f => MultiChatboxPrompt.getPending(f.p);
async function offer(f, tier) { talk(f, `Get job (${tier})`); await continueLines(f); assert.equal(pending(f)?.title, "Take this order?"); }
async function refuse(f, tier) { await offer(f, tier); await choose(f, 2); await continueLines(f); if (pending(f)?.title === "Do you want to refuse this order") await choose(f, 2); }

test("hard refusal remains blocked after five minutes and unlocks at exactly five and a half", async t => {
  let now = 1800000000000; t.mock.method(Date, "now", () => now);
  const f = actor(t); await refuse(f, "hard");
  assert.equal(f.p.getAttribute(LOCKOUTS)?.hard, now + 330000);
  for (const elapsed of [300000, 329999]) {
    now = 1800000000000 + elapsed; f.p.closeInterruptibleInterfaces(); talk(f, "Get job (hard)");
    assert.match(line(f), /just refused a hard job/);
  }
  now = 1800000330000; f.p.closeInterruptibleInterfaces(); await offer(f, "hard");
});

test("first decline warns without locking, and taking the original order starts only its delivery timer", async t => {
  const f = actor(t); await offer(f, "hard"); await choose(f, 2);
  assert.match(line(f), /Are you sure you want to turn this order down/);
  assert.equal(f.p.getAttribute(LOCKOUTS), undefined);
  await continueLines(f);
  assert.deepEqual(pending(f), { title: "Do you want to refuse this order", options: ["I'll take this order then!", "Yes I'm sure."] });
  await choose(f, 1);
  assert.ok(Restaurant._test.sessionOf(f.p));
  assert.equal(f.p.getInventory().getAmount(core.ItemIdentifiers.ALUFT_ALOFT_BOX), 1);
  assert.equal(f.p.getAttribute(LOCKOUTS), undefined);
});

test("closing the warning does not decline; native repeated confirmation cannot restart the penalty", async t => {
  let now = 1800000000000; t.mock.method(Date, "now", () => now);
  const f = actor(t); await offer(f, "hard"); await choose(f, 2);
  f.p.closeInterruptibleInterfaces(); await choose(f, 2);
  assert.equal(f.p.getAttribute(LOCKOUTS), undefined);
  await refuse(f, "hard"); const deadline = f.p.getAttribute(LOCKOUTS).hard;
  now += 1000; await choose(f, 2);
  assert.equal(f.p.getAttribute(LOCKOUTS).hard, deadline);
  assert.equal(Restaurant._test.sessionOf(f.p), undefined);
});

test("tiers retain independent deadlines and saved timestamps survive a real PlayerSave restore", async t => {
  let now = 1800000000000; t.mock.method(Date, "now", () => now);
  const f = actor(t); await refuse(f, "hard");
  f.p.closeInterruptibleInterfaces(); talk(f);
  assert.equal(pending(f)?.options.length, 2, "easy and changed mind remain available");
  await refuse(f, "easy");
  assert.deepEqual(f.p.getAttribute(LOCKOUTS), { hard: now + 330000, easy: now + 300000 });
  const saved = PlayerSave.fromPlayer(f.p); const g = actor(t); saved.applyToPlayer(g.p);
  now += 300000; g.p.closeInterruptibleInterfaces(); await offer(g, "easy");
  g.p.closeInterruptibleInterfaces(); talk(g, "Get job (hard)"); assert.match(line(g), /just refused a hard job/);
  assert.equal(g.p.getAttribute(LOCKOUTS).hard, 1800000330000, "restore does not restart timer");
  now += 30000; g.p.closeInterruptibleInterfaces(); await offer(g, "hard");
});

test("low Cooking, reopening an offer, and accepted-order expiry never create a refusal penalty", async t => {
  let now = 1800000000000; t.mock.method(Date, "now", () => now);
  const f = actor(t); f.p.getSkillManager().setCurrentLevel(core.Skill.COOKING, 28);
  talk(f); assert.match(line(f), /level 29 Cooking/); assert.equal(f.p.getAttribute(LOCKOUTS), undefined);
  f.p.closeInterruptibleInterfaces(); f.p.getSkillManager().setCurrentLevel(core.Skill.COOKING, 29);
  await offer(f, "hard"); f.p.closeInterruptibleInterfaces(); await offer(f, "hard");
  assert.equal(f.p.getAttribute(LOCKOUTS), undefined); await choose(f, 1);
  const order = Restaurant._test.sessionOf(f.p); now = order.deadline;
  Restaurant._test.tick(); assert.equal(Restaurant._test.sessionOf(f.p), undefined);
  assert.equal(f.p.getAttribute(LOCKOUTS), undefined);
  assert.equal(f.p.getInventory().getAmount(core.ItemIdentifiers.ALUFT_ALOFT_BOX), 0);
  f.p.closeInterruptibleInterfaces(); await offer(f, "hard");
});

// Wiki (Gnome Restaurant): after declining a hard job "They can wait this out, or take and do an easy job", then come
// back for another hard one. Only a finished easy delivery ends the wait; one that runs out of time doesn't.
function handIn(f) {
  const order = Restaurant._test.sessionOf(f.p);
  f.p.getInventory().add(new core.Item(order.itemId, 1), false);
  const event = { player: f.p, itemId: order.itemId, handled: false,
    target: { getCurrentDefinition: () => ({ getName: () => order.npcName }) } };
  Restaurant._test.deliver(event);
  assert.equal(event.handled, true); assert.equal(Restaurant._test.sessionOf(f.p), undefined, "delivered");
}

test("finishing an easy job after a hard refusal lets the player take a hard job straight away", async t => {
  let now = 1800000000000; t.mock.method(Date, "now", () => now);
  const f = actor(t); await refuse(f, "hard");
  f.p.closeInterruptibleInterfaces(); await offer(f, "easy"); await choose(f, 1);
  now += 60000; handIn(f);
  assert.equal(f.p.getAttribute(LOCKOUTS)?.hard ?? 0, 0, "hard wait over");
  f.p.closeInterruptibleInterfaces(); await offer(f, "hard");
});

test("an easy job that runs out of time, or a hard one finished, leaves the other tier's wait in place", async t => {
  let now = 1800000000000; t.mock.method(Date, "now", () => now);
  const f = actor(t); await refuse(f, "hard");
  f.p.closeInterruptibleInterfaces(); await offer(f, "easy"); await choose(f, 1);
  now += 60000; Restaurant._test.advanceTime({ player: f.p, ms: 3600000 });
  assert.equal(Restaurant._test.sessionOf(f.p), undefined, "ran out of time");
  assert.equal(f.p.getAttribute(LOCKOUTS).hard, 1800000000000 + 330000);
  f.p.closeInterruptibleInterfaces(); talk(f, "Get job (hard)"); assert.match(line(f), /just refused a hard job/);
  const g = actor(t); await refuse(g, "easy");
  g.p.closeInterruptibleInterfaces(); await offer(g, "hard"); await choose(g, 1);
  handIn(g);
  assert.equal(g.p.getAttribute(LOCKOUTS).easy, now + 300000, "a hard delivery doesn't end the easy wait");
});
