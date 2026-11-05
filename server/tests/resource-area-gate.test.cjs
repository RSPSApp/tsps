// Run after `yarn build`: node --test tests/resource-area-gate.test.cjs
//
// The Resource Area's gate (loc 26760, wilderness_resource_gate, at 3184,3944; Mandrith stands at 3183,3945)
// and its entrance fee (OSRS Wiki: Resource Area, Mandrith).
// Sources, by fact:
//  - rsprox 1444 (rev 224) ticks 173-180, the medium-diary fee flow: oploc1 on 26760; standing at 3184,3945 the
//    modal "Pay 6000 coins to enter?" with Yes|No; Yes: the game message (spam) "You pay 6000 coins and enter
//    the resource arena.", coins 10,000 -> 4,000, sounds 71 and 2400, the gate swings (26760 -> 38848 at
//    3184,3944 and 1548 at 3184,3945), the player is on 3184,3944 the next tick and the gate is restored a
//    couple of ticks later.
//  - Wiki: the fee is 7,500, 6,000 after the medium Wilderness Diary, 3,750 after the hard one, free after the
//    elite one ("completing"); logging out inside brings the player outside the entrance.
//  - agent/data/transports.json rows 4135-4139: the same tiers keyed to the diary tiers' complete varbits
//    4467/4468/4469, entering from 3184,3945 and leaving from 3184,3944 free.
//  - rsprox 1444 ticks 780-792, LEAVING (captured): oploc1 on 26760 from inside, the player runs to 3185,3943,
//    sound 71 plays on arrival (no 2400), two ticks later the gate swings (38848 at 3184,3944, 1548 at
//    3184,3945) and the player steps out onto 3184,3945, and two ticks after that the gate is restored. No
//    prompt, no coins, no message.
//  - INFERRED, no capture: the hard prompt follows the medium one with 3,750; the elite entry has no prompt and
//    no message; "You don't have enough coins." (AlKharidGate's string) when the player cannot pay; players
//    logging in inside are put on 3184,3945 with no message.
//  - NOT DONE: Peek (op 2), preset coins (the fee is paid by id like Al Kharid's gate). "diary:is-complete"
//    means the tier is completed; the Wiki's footnotes say "claimed".
// Real engine: every plugin loaded with DISABLE_PLAYER_BOTS=1 and shut down at the end, the real map around the
// gate, a real Player, the click as the "object_option" packet through ClientConnection.dispatch and the game
// ticks that follow, the real prompt, the real diary progress.
process.env.DISABLE_PLAYER_BOTS = "1";
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ClientConnection } = require("../dist/net/NetworkBuilder");
const Diaries = require("../plugins/achievements/diaries/Data.AchievementDiaries");
const DiaryProgress = require("../plugins/achievements/diaries/Progress.AchievementDiaries");

const GATE = 26760;
const GATE_AT = [3184, 3944];
const OUTSIDE = [3184, 3945];
const COINS = 995;
const TIERS = ["easy", "medium", "hard", "elite"];
const DIARY = Diaries.BY_KEY.get("wilderness");
let core;
let next = 9500;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  core.ObjectDefinition.init();
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(...GATE_AT);
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

/** A player on `at` with `coins` and the Wilderness Diary done up to `tier` (null: none of it). */
function actor(t, at, { coins = 0, tier = null } = {}) {
  const channel = {
    kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {},
  };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++);
  p.setUsername("gate" + p.getIndex());
  p.setRegistered(true);
  p.setAttribute("bot-skip-persistence", true);
  p.setLocation(new core.Location(at[0], at[1], 0));
  p.needsPlacement = false;
  const messages = [];
  t.mock.method(p.getPacketSender(), "sendMessage", (message) => { messages.push(message); return p.getPacketSender(); });
  t.mock.method(p.getPacketSender(), "sendTypedMessage", (type, message) => { messages.push(message); return p.getPacketSender(); });
  if (coins > 0) p.getInventory().add(new core.Item(COINS, coins), false);
  if (tier) {
    for (const name of TIERS.slice(0, TIERS.indexOf(tier) + 1)) {
      for (const task of DIARY.tiers[name].tasks) DiaryProgress.completeTask(p, DIARY, task.key);
    }
  }
  const c = new ClientConnection(channel);
  c.player = p;
  // Completing a tier queues a 'Congratulations' dialogue three ticks on, which would replace the fee prompt:
  // let it come and clear it before the test starts.
  if (tier) {
    for (let i = 0; i < 4; i++) {
      core.World.processCycle++;
      core.TaskManager.process();
    }
    p.getDialogueManager().reset();
  }
  t.after(() => {
    PM.emitPlayerLogout({ player: p, username: p.getUsername() });
    p.setRegistered(false);
    core.TaskManager.cancelTasks(p);
    core.TaskManager.cancelTasks(p.getIndex());
  });
  return { p, c, messages };
}

function tick(f, count = 1) {
  for (let i = 0; i < count; i++) {
    if (f.log) {
      f.n++;
      f.positions[f.n] = [f.p.getLocation().getX(), f.p.getLocation().getY()];
    }
    core.World.processCycle++;
    core.TaskManager.process();
    f.c.processTurnPackets();
    f.p.getMovementQueue().process();
    core.TaskManager.processWalkTo(f.p.getIndex());
    f.p.getSession().flushClient(core.World.processCycle);
    f.p.resetUpdating();
  }
}

/** Records sounds and the viewer-only gate swing the player is shown, tick by tick (n counts from the click). */
function watch(t, f) {
  f.log = [];
  f.n = 0;
  f.positions = {};
  const sender = f.p.getPacketSender();
  t.mock.method(sender, "sendSound", (id) => { f.log.push({ n: f.n, kind: "sound", id }); return sender; });
  t.mock.method(sender, "sendObject", (object) => { f.log.push({ n: f.n, kind: "show", id: object.getId() }); return sender; });
  t.mock.method(sender, "sendObjectRemoval", (object) => { f.log.push({ n: f.n, kind: "remove", id: object.getId() }); return sender; });
  t.mock.method(f.p.getSession(), "isTileInScene", () => true);
  t.mock.method(core.World, "forEachNetworkPlayer", (visit) => visit(f.p));
  return f;
}
const logged = (f, kind, id) => f.log.filter((entry) => entry.kind === kind && (id === undefined || entry.id === id));

async function clickGate(f) {
  await f.c.dispatch([{ type: "object_option", id: GATE, x: GATE_AT[0], y: GATE_AT[1], clickType: 1 }]);
  tick(f, 3);
}

const pending = (f) => core.MultiChatboxPrompt.getPending(f.p);
const answer = (f, number) => core.MultiChatboxPrompt.handleInterfaceActionClick({
  player: f.p, buttonId: core.MultiChatboxPrompt.OPTIONS_WIDGET_ID, groupId: 219, slot: number, action: number,
});
const YES = 1;
const NO = 2;
const coins = (f) => f.p.getInventory().getAmount(COINS);
const where = (f) => [f.p.getLocation().getX(), f.p.getLocation().getY()];
const inside = (f) => where(f)[1] <= 3944;

test("as captured (rsprox 1444): with the medium diary, the gate asks 'Pay 6000 coins to enter?' and Yes pays, says so and walks the player in", async (t) => {
  const f = actor(t, OUTSIDE, { coins: 10000, tier: "medium" });
  await clickGate(f);
  assert.equal(pending(f)?.title, "Pay 6000 coins to enter?");
  assert.deepEqual(pending(f)?.options?.map((option) => option.text ?? option), ["Yes", "No"]);
  assert.equal(coins(f), 10000, "nothing is taken until Yes");
  assert.equal(inside(f), false, "and the player is still outside");
  watch(t, f);
  answer(f, YES);
  assert.deepEqual(logged(f, "sound").map((entry) => [entry.n, entry.id]), [[0, 71], [0, 2400]], "both sounds on the Yes tick");
  assert.equal(logged(f, "show", 1548).length, 1, "the gate swings on the Yes tick");
  tick(f, 6);
  assert.equal(coins(f), 4000);
  assert.ok(f.messages.includes("You pay 6000 coins and enter the resource arena."));
  assert.equal(inside(f), true, `the player is in the area, at ${where(f)}`);
  assert.equal(f.positions[2][1], 3944, "the player is on the gate tile within two ticks of Yes");
  assert.equal(logged(f, "show", 26760)[0].n - logged(f, "show", 1548)[0].n, 2, "restored two ticks after the swing");
});

test("No leaves everything as it was", async (t) => {
  const f = actor(t, OUTSIDE, { coins: 10000, tier: "medium" });
  await clickGate(f);
  answer(f, NO);
  tick(f, 6);
  assert.equal(coins(f), 10000);
  assert.equal(inside(f), false);
});

for (const [tier, fee] of [[null, 7500], ["easy", 7500], ["medium", 6000], ["hard", 3750]]) {
  test(`the fee after ${tier ? `the ${tier} diary` : "no diary"} is ${fee}${tier === "hard" ? " (the hard prompt follows the medium one: inferred)" : ""}`, async (t) => {
    const f = actor(t, OUTSIDE, { coins: 10000, tier });
    await clickGate(f);
    assert.equal(pending(f)?.title, `Pay ${fee} coins to enter?`);
    answer(f, YES);
    tick(f, 6);
    assert.equal(coins(f), 10000 - fee);
    assert.ok(f.messages.includes(`You pay ${fee} coins and enter the resource arena.`));
    assert.equal(inside(f), true);
  });
}

test("the elite diary enters free: no prompt, no coins, no message (inferred)", async (t) => {
  const f = actor(t, OUTSIDE, { coins: 100, tier: "elite" });
  await clickGate(f);
  assert.equal(pending(f), null, "no prompt");
  tick(f, 6);
  assert.equal(inside(f), true, `the player is in the area, at ${where(f)}`);
  assert.equal(coins(f), 100);
  assert.equal(f.messages.some((message) => /pay/i.test(message)), false);
});

test("a player who cannot pay is told so and stays outside; exactly the fee is enough", async (t) => {
  const poor = actor(t, OUTSIDE, { coins: 5999, tier: "medium" });
  await clickGate(poor);
  answer(poor, YES);
  tick(poor, 6);
  assert.ok(poor.messages.includes("You don't have enough coins."), "AlKharidGate's own string, ours here");
  assert.equal(coins(poor), 5999);
  assert.equal(inside(poor), false);
  const exact = actor(t, OUTSIDE, { coins: 6000, tier: "medium" });
  await clickGate(exact);
  answer(exact, YES);
  tick(exact, 6);
  assert.equal(coins(exact), 0);
  assert.equal(inside(exact), true);
});

test("the coins are checked again at Yes: spent between the prompt and Yes means no entry", async (t) => {
  const f = actor(t, OUTSIDE, { coins: 7500 });
  await clickGate(f);
  f.p.getInventory().deleteNumber(COINS, 7500);
  answer(f, YES);
  tick(f, 6);
  assert.equal(inside(f), false);
  assert.ok(f.messages.includes("You don't have enough coins."));
});

test("the diary tier is checked again at Yes: the price asked is the price paid", async (t) => {
  const f = actor(t, OUTSIDE, { coins: 7500 });
  await clickGate(f);
  assert.equal(pending(f)?.title, "Pay 7500 coins to enter?");
  answer(f, YES);
  tick(f, 6);
  assert.equal(coins(f), 0);
});

test("paying opens it for that player only: the next player is asked for their own fee", async (t) => {
  const first = actor(t, OUTSIDE, { coins: 7500 });
  await clickGate(first);
  answer(first, YES);
  tick(first, 1);
  const second = actor(t, OUTSIDE, { coins: 7500 });
  await clickGate(second);
  assert.equal(pending(second)?.title, "Pay 7500 coins to enter?", "the gate did not stay open for them");
  assert.equal(inside(second), false);
});

test("as captured (rsprox 1444 ticks 780-792): leaving is free; 71 on arrival (no 2400), two ticks later the swing and the step out, two more and the gate is restored", async (t) => {
  const f = actor(t, GATE_AT, { coins: 100 });
  watch(t, f);
  await f.c.dispatch([{ type: "object_option", id: GATE, x: GATE_AT[0], y: GATE_AT[1], clickType: 1 }]);
  tick(f, 8);
  assert.equal(pending(f), null);
  assert.deepEqual(logged(f, "sound").map((entry) => entry.id), [71], "71 only, never 2400");
  const sound = logged(f, "sound")[0].n;
  const open = logged(f, "show", 1548);
  assert.equal(open.length, 1);
  assert.equal(open[0].n - sound, 2, "the swing is two ticks after the sound");
  assert.equal(f.positions[open[0].n][1], 3944, "the player is still inside when the gate swings");
  assert.equal(f.positions[open[0].n + 1][1] >= 3945, true, `the player has stepped out one tick later, at ${f.positions[open[0].n + 1]}`);
  assert.equal(logged(f, "show", 26760)[0].n - open[0].n, 2, "restored two ticks after the swing");
  assert.equal(where(f)[1] >= 3945, true, `the player is outside, at ${where(f)}`);
  assert.equal(coins(f), 100);
  assert.deepEqual(f.messages, []);
});

test("another Gate is none of this plugin's business: a click on a different gate id asks nothing", async (t) => {
  const f = actor(t, OUTSIDE, { coins: 10000 });
  await f.c.dispatch([{ type: "object_option", id: 1551, x: GATE_AT[0], y: GATE_AT[1], clickType: 1 }]);
  tick(f, 3);
  assert.equal(pending(f), null);
  assert.equal(coins(f), 10000);
});

test("the gate answers only on the captured tiles: 3184,3945 outside; 3184,3944 and the row 3183-3185,3943 inside", (t) => {
  const { nearGate } = require("../plugins/areas/ResourceArea.plugin")._test;
  const f = actor(t, OUTSIDE);
  const near = (x, y) => { f.p.setLocation(new core.Location(x, y, 0)); return nearGate(f.p); };
  for (const [x, y] of [[3184, 3945], [3184, 3944], [3183, 3943], [3184, 3943], [3185, 3943]]) assert.equal(near(x, y), true, `${x},${y}`);
  for (const [x, y] of [[3183, 3945], [3185, 3945], [3185, 3944], [3183, 3944], [3184, 3946], [3184, 3942], [3190, 3945]]) assert.equal(near(x, y), false, `${x},${y}`);
});

test("a player who logs in inside the area is put outside the entrance (Wiki), with no message", (t) => {
  const f = actor(t, [3185, 3935], { coins: 100 });
  PM.emitPlayerLogin({ player: f.p, username: f.p.getUsername() });
  assert.deepEqual(where(f), OUTSIDE);
  assert.deepEqual(f.messages.filter((message) => /resource|arena|Mandrith/i.test(message)), []);
});

test("logging in elsewhere in the Wilderness, or outside the gate, moves nobody", (t) => {
  const north = actor(t, [3184, 3950]);
  PM.emitPlayerLogin({ player: north.p, username: north.p.getUsername() });
  assert.deepEqual(where(north), [3184, 3950]);
  const elsewhere = actor(t, [3222, 3218]);
  PM.emitPlayerLogin({ player: elsewhere.p, username: elsewhere.p.getUsername() });
  assert.deepEqual(where(elsewhere), [3222, 3218]);
});
