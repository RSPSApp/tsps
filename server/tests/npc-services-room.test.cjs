// Run after `yarn build`: node --test tests/npc-services-room.test.cjs
//
// Zahur and Mawnis take payment and hand something back, so they must not take what they can't give.
// Native fixture: registered NPCs through real npc_option, Mawnis's real transcript, answers through
// ClientConnection.dispatch. The hard Desert Diary is the real saved task list, set directly because a
// fixture can't play it; the quest stage is set the same way. No client ran.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
// The bots rewrite their tracked object index on load, and nothing here needs them.
process.env.DISABLE_PLAYER_BOTS = "1";
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ClientConnection } = require("../dist/net/NetworkBuilder");
const { MAX_STACK_AMOUNT } = require("../dist/game/model/container/StackType");

const { DIARIES } = require("../plugins/achievements/diaries/Data.AchievementDiaries");
const Progress = require("../plugins/achievements/diaries/Progress.AchievementDiaries");
const QuestRuntime = require("../plugins/quests/QuestRuntime");

const HOME = [3222, 3218];
const YES = 1;
const COST = 200;
const NO_SPACE = "You don't have enough inventory space.";
const NO_COINS = "You don't have enough coins.";
const HANDS_OVER = "The Burgher hands you his helm.";
const HELM_PRICE = 50000;
const HERBALIST_TASK = "have-the-nardah-herbalist-clean-a-herb-for-you";

let core;
let I;
let next = 6400;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  I = core.ItemIdentifiers;
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(...HOME);
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

function actor(t) {
  const channel = {
    kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {},
  };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++);
  p.setUsername("npcroom" + p.getIndex());
  p.setRegistered(true);
  p.setLocation(new core.Location(HOME[0], HOME[1], 0));
  p.needsPlacement = false;
  const messages = [];
  t.mock.method(p.getPacketSender(), "sendMessage", (message) => {
    messages.push(message);
    return p.getPacketSender();
  });
  const c = new ClientConnection(channel);
  c.player = p;
  t.after(() => {
    PM.emitPlayerLogout({ player: p, username: p.getUsername() });
    p.setRegistered(false);
    core.TaskManager.cancelTasks(p.getIndex());
  });
  const desert = DIARIES.find((diary) => diary.key === "desert");
  p.setAttribute(Progress.TASKS_ATTRIBUTE, { desert: desert.tiers.hard.tasks.map((task) => task.key) });
  return { p, c, inv: p.getInventory(), messages };
}

const creditedForCleaning = (f) =>
  Progress.doneTasks(f.p, DIARIES.find((diary) => diary.key === "desert")).has(HERBALIST_TASK);

function drain(f) {
  for (let i = 0; i < 6; i++) {
    core.TaskManager.processWalkTo(f.p.getIndex());
    f.p.getMovementQueue().process();
    core.TaskManager.process();
  }
}

async function send(f, packet) {
  await f.c.dispatch([packet]);
  f.c.processTurnPackets();
}

const answer = (f, option) => send(f, {
  type: "dialogue_continue", widgetId: core.MultiChatboxPrompt.OPTIONS_WIDGET_ID, childIndex: option,
});
const plain = (id, count = 1) => new core.Item(id, count);
const pending = (f) => core.MultiChatboxPrompt.getPending(f.p);
const noted = (id) => core.ItemDefinition.forId(id).getNoteId();
const amount = (f, id) => f.inv.getAmount(id);

function fillTo(f, freeSlots) {
  while (f.inv.getFreeSlots() > freeSlots) f.inv.add(plain(I.RAKE), false);
  f.inv.refreshItems();
  assert.equal(f.inv.getFreeSlots(), freeSlots);
}

async function npcOption(t, f, id, option) {
  const npc = core.NPC.create(id, new core.Location(HOME[0] + 1, HOME[1], 0));
  core.World.getNpcs().add(npc);
  t.after(() => core.World.getNpcs().remove(npc));
  const clickType = npc.getDefinition().getActions().findIndex((action) => action === option) + 1;
  assert.ok(clickType > 0, `NPC ${id} offers ${option}`);
  await send(f, { type: "npc_option", index: npc.getIndex(), clickType });
  drain(f);
}

// ------------------------------------------------------------------ Zahur: Clean

const grimyNote = () => noted(I.GRIMY_GUAM_LEAF);
const cleanNote = () => noted(I.GUAM_LEAF);

async function clean(t, f, { herbs, coins, free = null, held = 0 }) {
  f.inv.setItem(0, plain(grimyNote(), herbs));
  f.inv.setItem(1, plain(I.COINS, coins));
  if (held) f.inv.setItem(2, plain(cleanNote(), held));
  if (free !== null) fillTo(f, free);
  await npcOption(t, f, core.NpcIdentifiers.ZAHUR, "Clean");
  assert.ok(pending(f), "Zahur asks first");
  await answer(f, YES);
}

test("Zahur Clean: with no room for the clean herbs, nothing is taken", async (t) => {
  const control = actor(t);
  await clean(t, control, { herbs: 100, coins: COST * 10 + 100, free: 1 });
  assert.equal(amount(control, cleanNote()), 10, "control: ten cleaned");
  assert.equal(amount(control, grimyNote()), 90, "control: ten taken");
  assert.equal(amount(control, I.COINS), 100, "control: paid");
  assert.equal(creditedForCleaning(control), true, "control: the diary task is credited");

  const f = actor(t);
  await clean(t, f, { herbs: 100, coins: COST * 10 + 100, free: 0 });
  assert.equal(amount(f, grimyNote()), 100, "the herbs stay");
  assert.equal(amount(f, I.COINS), COST * 10 + 100, "the coins stay");
  assert.equal(amount(f, cleanNote()), 0, "nothing is made");
  assert.ok(f.messages.includes(NO_SPACE), "and the player is told");
  assert.equal(creditedForCleaning(f), false, "a refused clean credits no diary task");
});

test("Zahur Clean: a stack used up in full frees its slot for the clean herbs", async (t) => {
  const herbs = actor(t);
  await clean(t, herbs, { herbs: 10, coins: COST * 10 + 100, free: 0 });
  assert.equal(amount(herbs, cleanNote()), 10, "the herb stack's slot takes them");
  assert.equal(amount(herbs, I.COINS), 100);

  const coins = actor(t);
  await clean(t, coins, { herbs: 100, coins: COST * 10, free: 0 });
  assert.equal(amount(coins, cleanNote()), 10, "the coin stack's slot takes them");
  assert.equal(amount(coins, grimyNote()), 90);
});

test("Zahur Clean: a stack near the cap is charged only for what it holds", async (t) => {
  const control = actor(t);
  await clean(t, control, { herbs: 10, coins: COST * 10, held: 5 });
  assert.equal(amount(control, cleanNote()), 15, "control: all ten");

  const near = MAX_STACK_AMOUNT - 5;
  const f = actor(t);
  await clean(t, f, { herbs: 10, coins: COST * 10, held: near });
  assert.equal(amount(f, cleanNote()), MAX_STACK_AMOUNT, "the stack fills");
  assert.equal(amount(f, grimyNote()), 5, "the rest stay grimy");
  assert.equal(amount(f, I.COINS), COST * 5, "and aren't paid for");
});

test("Zahur Clean: unnoted herbs on a full inventory still clean", async (t) => {
  const f = actor(t);
  for (let slot = 0; slot < 3; slot++) f.inv.setItem(slot, plain(I.GRIMY_GUAM_LEAF));
  f.inv.setItem(3, plain(I.COINS, COST * 10));
  fillTo(f, 0);
  await npcOption(t, f, core.NpcIdentifiers.ZAHUR, "Clean");
  await answer(f, YES);
  assert.equal(amount(f, I.GUAM_LEAF), 3);
  assert.equal(amount(f, I.COINS), COST * 7);
});

// ------------------------------------------------------------------ Zahur: Make unfinished

const unfNote = () => noted(I.GUAM_POTION_UNF_);

async function unfinished(t, f, { herbs, vials, coins, free = null, held = 0 }) {
  f.inv.setItem(0, plain(noted(I.GUAM_LEAF), herbs));
  f.inv.setItem(1, plain(noted(I.VIAL_OF_WATER), vials));
  f.inv.setItem(2, plain(I.COINS, coins));
  if (held) f.inv.setItem(3, plain(unfNote(), held));
  if (free !== null) fillTo(f, free);
  await npcOption(t, f, core.NpcIdentifiers.ZAHUR, "Make unfinished potion(s)");
}

test("Zahur Make unfinished: with no room, nothing is taken", async (t) => {
  const control = actor(t);
  await unfinished(t, control, { herbs: 100, vials: 100, coins: COST * 10 + 100, free: 1 });
  assert.equal(amount(control, unfNote()), 10, "control: ten made");
  assert.equal(amount(control, noted(I.GUAM_LEAF)), 90);
  assert.equal(amount(control, I.COINS), 100);

  const f = actor(t);
  await unfinished(t, f, { herbs: 100, vials: 100, coins: COST * 10 + 100, free: 0 });
  assert.equal(amount(f, noted(I.GUAM_LEAF)), 100, "the herbs stay");
  assert.equal(amount(f, noted(I.VIAL_OF_WATER)), 100, "the vials stay");
  assert.equal(amount(f, I.COINS), COST * 10 + 100, "the coins stay");
  assert.ok(f.messages.includes(NO_SPACE), "and the player is told");
});

test("Zahur Make unfinished: a stack used up frees its slot, and a near-cap stack is charged for what it holds", async (t) => {
  const freed = actor(t);
  await unfinished(t, freed, { herbs: 100, vials: 10, coins: COST * 10 + 100, free: 0 });
  assert.equal(amount(freed, unfNote()), 10, "the vial stack's slot takes them");
  assert.equal(amount(freed, noted(I.GUAM_LEAF)), 90);

  const near = MAX_STACK_AMOUNT - 5;
  const f = actor(t);
  await unfinished(t, f, { herbs: 10, vials: 10, coins: COST * 10, held: near });
  assert.equal(amount(f, unfNote()), MAX_STACK_AMOUNT, "the stack fills");
  assert.equal(amount(f, noted(I.GUAM_LEAF)), 5, "the rest stay");
  assert.equal(amount(f, noted(I.VIAL_OF_WATER)), 5);
  assert.equal(amount(f, I.COINS), COST * 5, "and aren't paid for");
});

// ------------------------------------------------------------------ Mawnis

async function buyHelm(t, f, coins, { free = null, questDone = true, reachesAccept = true } = {}) {
  const quest = QuestRuntime.getRegisteredQuests().find((entry) => entry.key === "the_fremennik_isles");
  assert.ok(quest, "The Fremennik Isles is registered");
  if (questDone) quest.setStage(f.p, quest.completionValue ?? 2);
  f.inv.setItem(0, plain(I.COINS, coins));
  if (free !== null) fillTo(f, free);
  await npcOption(t, f, core.NpcIdentifiers.MAWNIS_BUROWGAR, "Talk-to");
  const seen = [];
  for (let i = 0; i < 30; i++) {
    const prompt = pending(f);
    if (prompt) {
      seen.push(prompt.options.join("/"));
      const index = prompt.options.findIndex((option) => /any more of those helms|accept/i.test(option));
      await answer(f, index >= 0 ? index + 1 : 1);
    } else if (f.p.getDialogueManager().isActive()) {
      const group = f.p.getPacketSender().chatboxGroupId;
      await send(f, { type: "dialogue_continue", widgetId: group << 16, childIndex: -1 });
    } else {
      break;
    }
    drain(f);
  }
  assert.equal(seen.some((menu) => /accept/i.test(menu)), reachesAccept, `the purchase menu: ${seen.join(" | ")}`);
}

function assertRefused(f, coins, message) {
  assert.equal(amount(f, I.HELM_OF_NEITIZNOT), 0, "no helm");
  assert.equal(amount(f, I.COINS), coins, "the coins stay");
  assert.ok(f.messages.includes(message), `the player is told: ${f.messages}`);
  assert.ok(!f.messages.includes(HANDS_OVER), "and the transcript doesn't say he handed it over");
  assert.equal(pending(f), null, "no question is left open");
  assert.equal(f.p.getDialogueManager().isActive(), false, "and the conversation has ended");
}

test("Mawnis: with room he sells the helm; with none it stays with him and so do the coins", async (t) => {
  const control = actor(t);
  await buyHelm(t, control, HELM_PRICE + 10000);
  assert.equal(amount(control, I.HELM_OF_NEITIZNOT), 1, "control: the helm");
  assert.equal(amount(control, I.COINS), 10000, "control: for 50,000");
  assert.ok(control.messages.includes(HANDS_OVER), "control: the transcript says so");

  const full = actor(t);
  await buyHelm(t, full, HELM_PRICE + 10000, { free: 0 });
  assertRefused(full, HELM_PRICE + 10000, NO_SPACE);
});

test("Mawnis: exactly the price frees the coins' slot on a full inventory", async (t) => {
  const f = actor(t);
  await buyHelm(t, f, HELM_PRICE, { free: 0 });
  assert.equal(amount(f, I.HELM_OF_NEITIZNOT), 1, "the coin stack's slot takes the helm");
  assert.equal(amount(f, I.COINS), 0);
});

// Live offers no menu with too few coins (RSProx 3027), and nor does the post-quest transcript. Before the
// quest reaches him, Talk-to falls through to his standard dialogue, which has no such condition.
test("Mawnis: too few coins is no sale, and the transcript doesn't say he handed it over", async (t) => {
  const control = actor(t);
  await buyHelm(t, control, HELM_PRICE - 1, { reachesAccept: false });
  assert.equal(amount(control, I.COINS), HELM_PRICE - 1, "control: after the quest he never offers it");
  assert.ok(!control.messages.includes(HANDS_OVER), "control: and says nothing of handing it over");

  const f = actor(t);
  await buyHelm(t, f, HELM_PRICE - 1, { questDone: false });
  assertRefused(f, HELM_PRICE - 1, NO_COINS);
});
