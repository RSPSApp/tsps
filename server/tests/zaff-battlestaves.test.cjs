// Run after `yarn build`: node --test tests/zaff-battlestaves.test.cjs
// Zaff's daily noted battlestaves (Wiki: Varrock Diary rewards). The barrel flow is from rsprox
// archive 3216 (rev 232): oploc1 on fai_varrock_battlestaff_barrel_multi, a message box with the
// price, Yes./No., then the coins go, cert_battlestaff arrives and varbit zaff_last_claimed is 1.
const assert = require("node:assert/strict");
const path = require("path");
const { test, before, beforeEach, afterEach, mock } = require("node:test");
const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { PluginManager } = require("../dist/plugins/PluginManager");
const { Inventory } = require("../dist/game/model/container/impl/Inventory");
const { Item } = require("../dist/game/model/Item");
const { TaskManager } = require("../dist/game/task/TaskManager");
const { ObjectDefinition } = require("../dist/game/definition/ObjectDefinition");
const DiaryRewards = require("../plugins/items/DiaryRewards.plugin");
const Rewards = require("../plugins/items/diaryrewards/Common.DiaryRewards");

const BARREL = "fai_varrock_battlestaff_barrel_multi";
const COINS = 995;
const NOTED_BATTLESTAFF = 1392;
const PRICE = 7000;
const TIERS = ["easy", "medium", "hard", "elite"];
const PER_TIER = { easy: 15, medium: 30, hard: 60, elite: 120 };
const REWARDS_ATTRIBUTE = "achievement-diaries:rewards";
const BRONZE_DAGGER = 1205;
const TICK_MS = 600;

let core;
const tasks = [];
const clickHooks = new Map();
const loginHooks = [];
const logoutHooks = [];
let prompt = null;
const api = new Proxy({
  onObjectFirstClick(ids, handler) {
    for (const id of [].concat(ids)) clickHooks.set(id, handler);
  },
  onPlayerLogin(handler) { loginHooks.push(handler); },
  onPlayerLogout(handler) { logoutHooks.push(handler); },
  sendMultiChatboxPrompt(player, title, ...pairs) {
    prompt = { title, options: pairs.filter((_, i) => i % 2 === 0), callbacks: pairs.filter((_, i) => i % 2 === 1) };
    return true;
  },
}, { get: (target, key) => (key === "core" ? core : key in target ? target[key] : () => {}) });

before(async () => {
  const { CachePipeline } = require("../dist/game/cache/CachePipeline");
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  ObjectDefinition.init(); // totalObjects is 0 until then, and forPlayer answers null
  core = {
  ...PluginManager.getCoreApi(),
  TaskManager: {
    // The real manager runs and cancels them; this only keeps what was submitted.
    submit: (task) => { tasks.push(task); TaskManager.submit(task); },
    cancelTasks: (key) => TaskManager.cancelTasks(key),
  },
  };
  DiaryRewards.register(api);
});

beforeEach(() => { prompt = null; tasks.length = 0; });
afterEach(() => {
  mock.timers.reset();
  for (const task of tasks) task.stop();
  TaskManager.process();
});

/** Game ticks through the real TaskManager. */
function tick(count) {
  for (let i = 0; i < count; i++) TaskManager.process();
}

const running = () => tasks.filter((task) => task.isRunning());

/** The attributes a save keeps. */
const SAVED = [REWARDS_ATTRIBUTE, "diary-rewards:daily"];

/** A player with a real Inventory (28 slots) and a sender that remembers the varbits it was sent. */
function player({ coins = 0, daggers = 0, notedStaves = 0, saved = {}, claimed = [] } = {}) {
  const attributes = new Map(Object.entries({ [REWARDS_ATTRIBUTE]: claimed.length ? { varrock: claimed } : {}, ...saved }));
  const varbits = new Map();
  const animations = [];
  const sender = new Proxy({}, {
    get: (_target, key) => {
      if (key === "sendVarbit") return (id, value) => { varbits.set(id, value); return sender; };
      if (key === "getVarbit") return (id) => varbits.get(id) ?? 0;
      if (key === "getVarp") return () => 0;
      return () => sender;
    },
  });
  const self = {
    varbits, animations, dialogue: null,
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    sendMessage() {},
    getInventory: () => self.inventory,
    performAnimation: (animation) => animations.push(animation),
    getDialogueManager: () => ({ startDialogues: (chain) => { self.dialogue = chain; }, getCurrent: () => null }),
    getPacketSender: () => sender,
    /** What a save and reload keeps: only the persisted attributes. */
    saved: () => Object.fromEntries(SAVED.filter((key) => attributes.has(key)).map((key) => [key, structuredClone(attributes.get(key))])),
  };
  self.inventory = new Inventory(self);
  self.inventory.resetItems();
  if (coins) self.inventory.add(new Item(COINS, coins), false);
  if (notedStaves) self.inventory.add(new Item(NOTED_BATTLESTAFF, notedStaves), false);
  fill(self, daggers);
  return self;
}

function fill(p, daggers) {
  for (let i = 0; i < daggers; i++) p.inventory.add(new Item(BRONZE_DAGGER, 1), false);
}

const have = (p, id) => p.inventory.getAmount(id);

/** Plays the chain the last handler started: message-box texts in order, actions run. */
function play(p) {
  const texts = [];
  const chain = p.dialogue;
  p.dialogue = null;
  if (!chain) return texts;
  for (const [, step] of [...chain.getDialogues()].sort((a, b) => a[0] - b[0])) {
    if (typeof step.getText === "function") texts.push(step.getText());
    else if (step.constructor.name === "ActionDialogue") step.send(p);
  }
  return texts;
}

function click(p) {
  const id = core.CacheDefinitions.getLocId(BARREL);
  const handler = clickHooks.get(id);
  assert.ok(handler, "the barrel has a first-click hook");
  p.dialogue = null;
  handler({ player: p, objectId: id, clickType: 1 });
  return play(p);
}

function choose(p, text) {
  assert.ok(prompt, "a Yes./No. choice is showing");
  const index = prompt.options.indexOf(text);
  assert.ok(index >= 0, `option ${text} in ${prompt.options}`);
  const callback = prompt.callbacks[index];
  prompt = null;
  p.dialogue = null;
  callback(p, index, text);
  return play(p);
}

const varbit = (p) => p.varbits.get(core.CacheDefinitions.getVarbitId("zaff_last_claimed"));
const grouped = (n) => n.toLocaleString("en-US");

const BARREL_FULL = "fai_varrock_battlestaff_barrel_full";
const BARREL_EMPTY = "fai_varrock_battlestaff_barrel_empty";

/** The loc the client would show this player at the multiloc. */
function shownBarrel(p) {
  return ObjectDefinition.forPlayer(core.CacheDefinitions.getLocId(BARREL), p);
}

for (const tier of TIERS) {
  test(`${tier} tier: ${PER_TIER[tier]} noted battlestaves at 7,000 each, charged and credited on Yes (archive 3216)`, () => {
    const stack = PER_TIER[tier];
    const total = stack * PRICE;
    const p = player({ coins: total + 5, claimed: TIERS.slice(0, TIERS.indexOf(tier) + 1) });
    assert.deepEqual(click(p), [`Buy ${stack} discounted battlestaves for 7,000 coins each?<br>Total cost: ${grouped(total)} coins`]);
    assert.deepEqual(prompt.options, ["Yes.", "No."]);
    assert.equal(have(p, NOTED_BATTLESTAFF), 0, "nothing is credited before Yes");
    assert.equal(have(p, COINS), total + 5, "nothing is charged before Yes");
    choose(p, "Yes.");
    assert.equal(have(p, COINS), 5);
    assert.equal(have(p, NOTED_BATTLESTAFF), stack);
    assert.equal(varbit(p), 1);
    assert.equal(p.animations[0].id, core.CacheDefinitions.getSeqId("human_pickuptable"));
  });
}

test("No. charges and credits nothing, and the day is not used", () => {
  const p = player({ coins: 840000, claimed: TIERS });
  click(p);
  choose(p, "No.");
  assert.equal(have(p, COINS), 840000);
  assert.equal(have(p, NOTED_BATTLESTAFF), 0);
  assert.equal(varbit(p), undefined);
  click(p);
  choose(p, "Yes.");
  assert.equal(have(p, NOTED_BATTLESTAFF), 120);
});

test("only one stack a day", () => {
  const p = player({ coins: 2000000, claimed: TIERS });
  click(p);
  choose(p, "Yes.");
  assert.deepEqual(click(p), [], "no offer after the day's stack");
  assert.equal(prompt, null);
  assert.equal(have(p, NOTED_BATTLESTAFF), 120);
  assert.equal(have(p, COINS), 2000000 - 840000);
  assert.equal(p.getAttribute(Rewards.DAILY_ATTRIBUTE).day, Rewards.today(), "the claim is kept in the persisted daily attribute");
});

test("the claim survives a save and reload: only persisted attributes come back, and login sends the varbit", () => {
  const p = player({ coins: 840000, claimed: TIERS });
  click(p);
  choose(p, "Yes.");
  const reloaded = player({ saved: p.saved(), claimed: TIERS });
  assert.equal(varbit(reloaded), undefined, "nothing is sent before login");
  for (const hook of loginHooks) hook({ player: reloaded });
  assert.equal(varbit(reloaded), 1);
  assert.equal(shownBarrel(reloaded).id, core.CacheDefinitions.getLocId(BARREL_EMPTY));
  const fresh = player({ claimed: TIERS });
  for (const hook of loginHooks) hook({ player: fresh });
  assert.equal(varbit(fresh), undefined, "an unclaimed day sends nothing");
});

test("an online claimer sees the full barrel again at 00:00 UTC, with no relog (Wiki, 23 July 2025)", () => {
  mock.timers.enable({ apis: ["Date"], now: Date.UTC(2026, 10, 3, 23, 0, 0) });
  const p = player({ coins: 2000000, claimed: TIERS });
  assert.equal(shownBarrel(p).id, core.CacheDefinitions.getLocId(BARREL_FULL));
  assert.ok(shownBarrel(p).getInteractions().includes("Claim-staves"));
  tasks.length = 0;
  click(p);
  choose(p, "Yes.");
  assert.equal(shownBarrel(p).id, core.CacheDefinitions.getLocId(BARREL_EMPTY), "empty after the claim");
  assert.equal(tasks.length, 1, "one reset is scheduled");
  assert.equal(tasks[0].delay, 60 * 60 * 1000 / TICK_MS, "for the next 00:00 UTC, an hour away");
  mock.timers.setTime(Date.UTC(2026, 10, 4, 0, 0, 1));
  tasks[0].execute();
  assert.equal(varbit(p), 0, "the varbit goes back to 0");
  assert.equal(shownBarrel(p).id, core.CacheDefinitions.getLocId(BARREL_FULL));
  assert.equal(click(p).length, 1, "and the barrel offers a stack again");
  choose(p, "Yes.");
  assert.equal(have(p, NOTED_BATTLESTAFF), 240);
});

test("a reset that fires before the day has turned waits for the day", () => {
  mock.timers.enable({ apis: ["Date"], now: Date.UTC(2026, 10, 3, 23, 59, 59, 500) });
  const p = player({ coins: 840000, claimed: TIERS });
  click(p);
  choose(p, "Yes.");
  tasks.length = 0;
  const first = { player: p };
  for (const hook of loginHooks) hook(first);
  assert.equal(tasks.length, 1, "login of a claimed player schedules the reset too");
  assert.equal(tasks[0].delay, 1, "half a second to go rounds up to one tick");
  tasks[0].execute();
  assert.equal(varbit(p), 1, "still the same UTC day: nothing is reset yet");
  assert.equal(tasks.length, 2, "and it waits again for the day to turn");
});

const DAY = 24 * 60 * 60 * 1000;
const HOUR_TICKS = 60 * 60 * 1000 / TICK_MS;

test("another system cancelling the player's tasks (rowboat travel) does not cancel the reset", () => {
  mock.timers.enable({ apis: ["Date"], now: Date.UTC(2026, 10, 3, 23, 0, 0) });
  const p = player({ coins: 840000, claimed: TIERS });
  click(p);
  choose(p, "Yes.");
  assert.equal(varbit(p), 1);
  TaskManager.cancelTasks(p); // as MisthalinMystery's rowboat does
  mock.timers.setTime(Date.UTC(2026, 10, 4, 0, 0, 1));
  tick(HOUR_TICKS);
  assert.equal(varbit(p), 0, "the reset still fires and the barrel is full again");
  assert.equal(shownBarrel(p).id, core.CacheDefinitions.getLocId(BARREL_FULL));
});

test("logging out removes the reset, whichever key it was filed under", () => {
  mock.timers.enable({ apis: ["Date"], now: Date.UTC(2026, 10, 3, 23, 0, 0) });
  const p = player({ coins: 840000, claimed: TIERS });
  click(p);
  choose(p, "Yes.");
  assert.equal(running().length, 1);
  assert.ok(logoutHooks.length > 0, "the unit cleans up on logout");
  for (const hook of logoutHooks) hook({ player: p });
  assert.equal(running().length, 0, "no reset task is left running for a player who is gone");
  mock.timers.setTime(Date.UTC(2026, 10, 4, 0, 0, 1));
  tick(HOUR_TICKS);
  assert.equal(varbit(p), 1, "nothing is sent to a player who logged out");
});

test("login and repeat claims leave exactly one reset armed", () => {
  mock.timers.enable({ apis: ["Date"], now: Date.UTC(2026, 10, 3, 23, 0, 0) });
  const p = player({ coins: 2000000, claimed: TIERS });
  click(p);
  choose(p, "Yes.");
  for (const hook of loginHooks) hook({ player: p });
  for (const hook of loginHooks) hook({ player: p });
  assert.equal(running().length, 1, "login re-arms the one reset instead of adding another");
  mock.timers.setTime(Date.UTC(2026, 10, 4, 0, 0, 1));
  tick(HOUR_TICKS);
  assert.equal(varbit(p), 0);
  assert.equal(running().length, 0, "the reset has run and nothing else waits");
  click(p);
  choose(p, "Yes.");
  assert.equal(varbit(p), 1);
  assert.equal(running().length, 1, "the next day's claim arms one reset");
  mock.timers.setTime(Date.UTC(2026, 10, 4, 0, 0, 1) + DAY);
  tick(24 * HOUR_TICKS);
  assert.equal(varbit(p), 0);
});

test("the diary reward must have been claimed from Toby first", () => {
  const p = player({ coins: 840000, claimed: [] });
  assert.deepEqual(click(p), []);
  assert.equal(prompt, null);
  assert.equal(have(p, COINS), 840000);
  assert.equal(have(p, NOTED_BATTLESTAFF), 0);
});

test("without the coins Yes. is refused with the captured message and nothing changes", () => {
  const p = player({ coins: 839999, claimed: TIERS });
  click(p);
  const shown = choose(p, "Yes.");
  assert.deepEqual(shown, ["You're going to need 840,000 coins to pay for these, even at their<br>discounted price."]);
  assert.equal(have(p, COINS), 839999);
  assert.equal(have(p, NOTED_BATTLESTAFF), 0);
  assert.equal(varbit(p), undefined);
  assert.equal(p.animations.length, 0);
});

test("coins spent between the offer and Yes. are re-checked", () => {
  const p = player({ coins: 840000, claimed: TIERS });
  click(p);
  p.inventory.deleteNumber(COINS, 839900);
  choose(p, "Yes.");
  assert.equal(have(p, COINS), 100);
  assert.equal(have(p, NOTED_BATTLESTAFF), 0);
  assert.equal(varbit(p), undefined);
});

test("a full inventory is told at once, before any offer", () => {
  const p = player({ coins: 840000, claimed: TIERS, daggers: 27 });
  assert.deepEqual(click(p), ["You need to make more space to carry your battlestaves."]);
  assert.equal(prompt, null);
  assert.equal(have(p, COINS), 840000);
});

test("a noted battlestaff stack already held needs no free slot (Wiki 2015 change)", () => {
  const p = player({ coins: 840000, notedStaves: 3, claimed: TIERS, daggers: 26 });
  assert.equal(p.inventory.getFreeSlots(), 0);
  assert.equal(click(p).length, 1);
  choose(p, "Yes.");
  assert.equal(have(p, NOTED_BATTLESTAFF), 123);
});

test("room taken between the offer and Yes. is re-checked: no coins are lost", () => {
  const p = player({ coins: 840000, claimed: TIERS });
  click(p);
  fill(p, 27);
  const shown = choose(p, "Yes.");
  assert.deepEqual(shown, ["You need to make more space to carry your battlestaves."]);
  assert.equal(have(p, COINS), 840000);
  assert.equal(have(p, NOTED_BATTLESTAFF), 0);
  assert.equal(varbit(p), undefined);
});
