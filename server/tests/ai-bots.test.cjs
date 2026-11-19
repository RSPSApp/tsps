// Run after `yarn build`: node --test tests/ai-bots.test.cjs
// AI bots (plugins/bots/ai, server/docs/ai-bots.md): who answers chat, the trade value rule, tool
// checks, how decisions reach the brain, and the provider request shapes. No model is called.
const assert = require("node:assert/strict");
const { test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { readAiBotConfig } = require("../plugins/bots/ai/Config.PlayerBots");
const { AiBotCallLimiter, AiBotChatRouter, addresses } = require("../plugins/bots/ai/Chat.PlayerBots");
const { AiBotMind } = require("../plugins/bots/ai/Mind.PlayerBots");
const { AiBotPresence, SPAWN_GAP_MS } = require("../plugins/bots/ai/Presence.PlayerBots");
const { AiBotTrade, containerValue } = require("../plugins/bots/ai/Trade.PlayerBots");
const { buildTools, validateCall } = require("../plugins/bots/ai/Tools.PlayerBots");
const { buildSystemPrompt, buildSituation } = require("../plugins/bots/ai/Prompt.PlayerBots");
const { chooseName, realisticName } = require("../plugins/bots/ai/Names.PlayerBots");
const { AnthropicProvider } = require("../plugins/bots/ai/providers/AnthropicProvider.PlayerBots");
const { OllamaProvider } = require("../plugins/bots/ai/providers/OllamaProvider.PlayerBots");
const { createProviders, providerFor } = require("../plugins/bots/ai/Providers.PlayerBots");
const { BotBrain } = require("../plugins/bots/brain/Brain.PlayerBots");
const { Misc } = require("../src/main/typescript/elvarg/util/Misc");

const location = (x, y, z = 0) => ({ getX: () => x, getY: () => y, getZ: () => z });

function fakePlayer(name, x = 3200, y = 3200, { bot = false } = {}) {
  return {
    name,
    x,
    y,
    getUsername: () => name,
    getLocation() {
      return location(this.x, this.y);
    },
    isPlayerBot: () => bot,
    isRegistered: () => true,
  };
}

function fakeCore(players) {
  return { World: { getNearbyPlayersForUpdate: () => players, getPlayerByName: (name) => players.find((p) => p.name === name) } };
}

/** A mind stand-in that records what the router asks of it. */
function fakeMind(player) {
  return {
    name: player.name,
    bot: player,
    heard: [],
    asked: [],
    trade: { open: null },
    want: null,
    inFlight: false,
    lastSpokeAt: 0,
    hear(line) {
      this.heard.push(line);
    },
    requestDecision(reason, options = {}) {
      this.asked.push({ reason, ...options });
    },
  };
}

function routerWith(players, randoms, chat = {}) {
  const minds = new Map();
  for (const player of players.filter((p) => p.isPlayerBot())) {
    minds.set(player.name.toLowerCase(), fakeMind(player));
  }
  const config = readAiBotConfig({ chat });
  const queue = [...randoms];
  const router = new AiBotChatRouter({ core: fakeCore(players), config, minds, random: () => queue.shift() ?? 0.99 });
  return { router, minds };
}

test("a message names a bot by its whole name or a clear start of it", () => {
  assert.equal(addresses("hey Lazy Fish, what lvl?", "Lazy Fish"), true);
  assert.equal(addresses("lazyfish u there", "Lazy Fish"), true);
  assert.equal(addresses("lazy u afk?", "Lazy Fish"), true);
  assert.equal(addresses("zez gimme gp", "Zezima"), false, "three letters are too few");
  assert.equal(addresses("zezi gimme gp", "Zezima"), true);
  assert.equal(addresses("anyone selling lobs", "Lazy Fish"), false);
});

test("every bot in range hears a line, but only the bot it names is asked to answer", () => {
  const player = fakePlayer("Real");
  const a = fakePlayer("Dave83", 3201, 3200, { bot: true });
  const b = fakePlayer("Lazy Fish", 3202, 3200, { bot: true });
  const { router, minds } = routerWith([player, a, b], []);
  router.onPublicChat(player, "dave83 what lvl r u");
  assert.equal(minds.get("dave83").heard.length, 1);
  assert.equal(minds.get("lazy fish").heard.length, 1);
  assert.deepEqual(minds.get("dave83").asked.map((ask) => [ask.reason, ask.reply]), [["addressed", true]]);
  assert.equal(minds.get("lazy fish").asked.length, 0);
});

test("the bot a player was just talking with gets their next line", () => {
  const player = fakePlayer("Real");
  const a = fakePlayer("Dave83", 3201, 3200, { bot: true });
  const b = fakePlayer("Lazy Fish", 3202, 3200, { bot: true });
  const { router, minds } = routerWith([player, a, b], []);
  router.noteConversation("Real", "Lazy Fish", Date.now());
  router.onPublicChat(player, "nice, how long did that take");
  assert.deepEqual(minds.get("lazy fish").asked.map((ask) => ask.reason), ["conversation"]);
  assert.equal(minds.get("dave83").asked.length, 0);
});

test("chat for no one is answered by at most one bot, and often by none", () => {
  const player = fakePlayer("Real");
  const bots = [1, 2, 3, 4, 5].map((n) => fakePlayer(`Bot${n}`, 3200 + n, 3200, { bot: true }));
  // Roll over the reply chance: nobody answers.
  let { router, minds } = routerWith([player, ...bots], [0.9]);
  router.onPublicChat(player, "this xp is slow");
  assert.equal([...minds.values()].reduce((sum, mind) => sum + mind.asked.length, 0), 0);
  // Under it: exactly one bot is asked (the join-in roll fails).
  ({ router, minds } = routerWith([player, ...bots], [0.1, 0.0, 0.9]));
  router.onPublicChat(player, "this xp is slow");
  assert.equal([...minds.values()].reduce((sum, mind) => sum + mind.asked.length, 0), 1);
});

test("bots answer each other only with a real player near, and only a couple of times", () => {
  const a = fakePlayer("Dave83", 3200, 3200, { bot: true });
  const b = fakePlayer("Lazy Fish", 3201, 3200, { bot: true });
  let { router, minds } = routerWith([a, b], [0.0, 0.0]);
  router.onPublicChat(a, "lol");
  assert.equal(minds.get("lazy fish").asked.length, 0, "no real player around");

  const player = fakePlayer("Real", 3203, 3200);
  ({ router, minds } = routerWith([a, b, player], [0, 0, 0, 0, 0, 0, 0, 0], { maxBotChain: 2 }));
  router.onPublicChat(a, "lol");
  router.onPublicChat(b, "ikr");
  router.onPublicChat(a, "haha");
  const asked = [...minds.values()].reduce((sum, mind) => sum + mind.asked.length, 0);
  assert.equal(asked, 2, "the chain stops at maxBotChain");
});

test("the call limiter caps calls per bot and overall each minute", () => {
  const limiter = new AiBotCallLimiter({ callsPerBotPerMinute: 2, callsPerMinute: 3 });
  assert.equal(limiter.allow("a", 0), true);
  assert.equal(limiter.allow("a", 1), true);
  assert.equal(limiter.allow("a", 2), false);
  assert.equal(limiter.allow("b", 3), true);
  assert.equal(limiter.allow("c", 4), false, "the overall cap is reached");
  assert.equal(limiter.allow("a", 61000), true, "a minute later");
});

test("tool calls are checked before they run", () => {
  const context = { activityIds: ["oak_trees"], placeIds: ["draynor_village"] };
  assert.deepEqual(validateCall({ name: "say", input: { text: "  hi <col=ff0000>all  " } }, context), {
    name: "say",
    input: { text: "hi col=ff0000all" },
  });
  assert.equal(validateCall({ name: "say", input: { text: "x".repeat(200) } }, context).input.text.length, 80);
  assert.ok(validateCall({ name: "start_activity", input: { activity: "zulrah", place: "here" } }, context).error);
  assert.ok(validateCall({ name: "start_activity", input: { activity: "oak_trees", place: "mars" } }, context).error);
  assert.ok(validateCall({ name: "teleport", input: {} }, context).error);
  assert.deepEqual(
    validateCall({ name: "trade_offer", input: { items: [{ item: "Coins", amount: 500 }, { item: "Logs", amount: -1 }] } }, context).input.items,
    [{ item: "Coins", amount: 500 }]
  );
  const tools = buildTools(context);
  for (const tool of tools) {
    assert.equal(tool.parameters.additionalProperties, false, tool.name);
    assert.deepEqual(tool.parameters.required, Object.keys(tool.parameters.properties), tool.name);
  }
});

test("the system prompt is the same for every bot; bots keep quiet about being AI unless disclose is on", () => {
  const prompt = buildSystemPrompt({ disclose: false, activities: [{ id: "oak_trees", about: "woodcutting" }], places: [] });
  assert.match(prompt, /Never say you.re an AI/);
  assert.match(prompt, /Don.t insist you.re human/);
  assert.doesNotMatch(prompt, /Dave83/);
  assert.match(buildSystemPrompt({ disclose: true, activities: [], places: [] }), /say so plainly/);
});

// --- Trading ---------------------------------------------------------------

const VALUES = { 995: 1, 1511: 50, 1351: 20, 1359: 3000 };
const NAMES = { 995: "Coins", 1511: "Logs", 1351: "Bronze axe", 1359: "Rune axe" };
const ItemDefinition = {
  forId: (id) => ({ unNote: () => id, getGrandExchangeValue: () => VALUES[id] ?? 0, getName: () => NAMES[id] }),
};

function fakeItem(id, amount) {
  return {
    getId: () => id,
    getAmount: () => amount,
    getDefinition: () => ItemDefinition.forId(id),
    isTradeable: () => true,
  };
}

function fakeContainer(items) {
  const container = {
    items,
    getValidItems: () => container.items.filter(Boolean),
    getItems: () => container.items,
    getAmount: (id) => container.items.filter((item) => item?.getId() === id).reduce((sum, item) => sum + item.getAmount(), 0),
  };
  return container;
}

const TradeState = { NONE: 0, REQUESTED_TRADE: 1, TRADE_SCREEN: 2, ACCEPTED_TRADE_SCREEN: 3, CONFIRM_SCREEN: 4, ACCEPTED_CONFIRM_SCREEN: 5 };

function tradeSetup({ ours = [], theirs = [], gifts = { perTrade: 10000, perPlayerPerDay: 25000 } } = {}) {
  const partner = { getUsername: () => "Real", getTrading: () => ({ getContainer: () => fakeContainer(theirs) }) };
  const accepted = [];
  const closed = [];
  const moved = [];
  const trading = {
    state: TradeState.TRADE_SCREEN,
    container: fakeContainer(ours),
    getState: () => trading.state,
    getInteract: () => partner,
    getContainer: () => trading.container,
    acceptTrade: () => accepted.push(trading.state),
    closeTrade: () => closed.push(true),
    handleItem: (id, amount) => moved.push([id, amount]),
  };
  const inventory = fakeContainer([fakeItem(995, 20000), fakeItem(1351, 1), fakeItem(1511, 5)]);
  inventory.getFreeSlots = () => 20;
  const events = [];
  const mind = {
    bot: { getTrading: () => trading, getInventory: () => inventory },
    addEvent: (text) => events.push(text),
    requestDecision() {},
    pauseBrain() {},
  };
  const trade = new AiBotTrade({ mind, core: { ItemDefinition, TradeState }, gifts, givenToday: new Map() });
  trade.open = { partner: "Real", openedAt: Date.now(), agreed: null, changedAt: 0, loss: 0 };
  return { trade, trading, accepted, closed, moved, events };
}

test("container value counts Grand Exchange value by amount", () => {
  assert.equal(containerValue(fakeContainer([fakeItem(995, 1500), fakeItem(1511, 10)]), ItemDefinition), 2000);
});

test("a bot accepts fair trades and small gifts, but not a trade that loses it too much", () => {
  let setup = tradeSetup({ ours: [fakeItem(995, 5000)], theirs: [] });
  assert.equal(setup.trade.accept(), null, "a 5k gift is under the 10k cap");
  assert.equal(setup.accepted.length, 1);

  setup = tradeSetup({ ours: [fakeItem(995, 50000)], theirs: [fakeItem(1511, 10)] });
  assert.match(setup.trade.accept(), /can't accept/);
  assert.equal(setup.accepted.length, 0);

  setup = tradeSetup({ ours: [fakeItem(995, 50000)], theirs: [fakeItem(1359, 20)] });
  assert.equal(setup.trade.accept(), null, "60k of rune axes for 50k coins is fine");
});

test("gifts to one player stop at the daily limit", () => {
  const setup = tradeSetup({ ours: [fakeItem(995, 9000)], gifts: { perTrade: 10000, perPlayerPerDay: 15000 } });
  assert.equal(setup.trade.accept(), null);
  setup.trade.onCompleted("Real");
  setup.trade.open = { partner: "Real", openedAt: Date.now(), agreed: null, changedAt: 0, loss: 0 };
  assert.match(setup.trade.accept(), /can't accept/, "9k today already, another 9k would pass 15k");
});

test("a bot won't offer the tools it works with", () => {
  const setup = tradeSetup();
  const problems = setup.trade.offer([{ item: "Bronze axe", amount: 1 }, { item: "logs", amount: 3 }, { item: "Dragon claws", amount: 1 }]);
  assert.match(problems, /keep your Bronze axe/);
  assert.match(problems, /no Dragon claws/);
  assert.deepEqual(setup.moved, [[1511, 3]]);
});

test("the second screen is accepted only if it still matches what was agreed", () => {
  let setup = tradeSetup({ ours: [fakeItem(995, 100)], theirs: [fakeItem(1511, 2)] });
  setup.trade.accept();
  setup.trading.state = TradeState.CONFIRM_SCREEN;
  setup.trade.tick(Date.now());
  assert.equal(setup.accepted.length, 2, "first screen, then the confirm screen");

  setup = tradeSetup({ ours: [fakeItem(995, 100)], theirs: [fakeItem(1511, 2)] });
  setup.trade.accept();
  setup.trading.container = fakeContainer([fakeItem(995, 9000)]);
  setup.trading.state = TradeState.CONFIRM_SCREEN;
  setup.trade.tick(Date.now());
  assert.equal(setup.closed.length, 1, "the offer changed under it: decline");
});

// --- Decisions reaching the brain -------------------------------------------

function mindSetup({ results = [], places = new Map() } = {}) {
  const bot = fakePlayer("Dave83", 3200, 3200, { bot: true });
  const inventory = fakeContainer([]);
  inventory.getFreeSlots = () => 28;
  Object.assign(bot, {
    getTrading: () => ({ getState: () => 0, getContainer: () => fakeContainer([]), getInteract: () => null }),
    getInventory: () => inventory,
    getEquipment: () => fakeContainer([]),
    getSkillManager: () => ({ getMaxLevel: () => 1, getCombatLevel: () => 3 }),
  });
  const brain = { paused: false, roots: [], replaceRoot(activity) { this.roots.push(activity.id); } };
  const state = {};
  const spoken = [];
  const activities = new Map([
    ["oak_trees", { id: "oak_trees", requires: [{ check: () => true }] }],
    ["yew_trees", { id: "yew_trees", requires: [{ check: () => false }] }],
    ["roam", { id: "roam", requires: [] }],
  ]);
  const provider = {
    name: "fake",
    model: "fake",
    calls: 0,
    async generate() {
      this.calls++;
      return results.shift() ?? { calls: [], text: "" };
    },
  };
  const services = {
    core: {
      World: { getPlayerByName: () => null, getNearbyPlayersForUpdate: () => [] },
      Skill: { values: () => [] },
      ChatPacketListener: { handleText: (_, text) => spoken.push(text) },
    },
    config: readAiBotConfig({}),
    roster: { remember() {}, get: () => null },
    registry: { byId: activities },
    places,
    catalog: [],
    system: "",
    tools: [],
    toolContext: { activityIds: ["oak_trees", "yew_trees"], placeIds: [...places.keys()] },
    limiter: new AiBotCallLimiter({ callsPerBotPerMinute: 10, callsPerMinute: 10 }),
    router: { noteConversation() {} },
    givenToday: new Map(),
    watched: () => true,
    getEntry: () => ({ brain, state }),
    log: () => {},
    emitCustomEvent: () => {},
  };
  const mind = new AiBotMind({ bot, profile: { persona: "chill", notes: [] }, provider, services });
  return { mind, brain, state, spoken, provider };
}

test("a reply is said after a typing pause, and a line starting with :: runs no command", () => {
  const { mind, spoken } = mindSetup();
  const now = Date.now();
  mind.apply({ want: { reasons: new Set(["addressed"]), reply: true, at: now }, result: { calls: [{ name: "say", input: { text: "::empty lol" } }], text: "" } }, now);
  mind.tick(now);
  assert.deepEqual(spoken, [], "not yet: still typing");
  mind.tick(now + 10000);
  assert.deepEqual(spoken, ["empty lol"]);
});

test("a reply that arrives too late is dropped, but its actions still run", () => {
  const { mind, brain, spoken } = mindSetup();
  const now = Date.now();
  const calls = [{ name: "say", input: { text: "sure" } }, { name: "start_activity", input: { activity: "oak_trees", place: "here" } }];
  mind.apply({ want: { reasons: new Set(["addressed"]), reply: true, at: now - 60000 }, result: { calls, text: "" } }, now);
  mind.tick(now + 10000);
  assert.deepEqual(spoken, []);
  assert.deepEqual(brain.roots, ["oak_trees"]);
});

test("a bot answers private messages only from someone who messaged it", () => {
  const { mind } = mindSetup();
  const now = Date.now();
  assert.match(mind.execute({ name: "reply_private", input: { player: "Real", text: "hi" } }, { from: null }, now), /hasn't messaged you/);
  mind.hear({ at: now, from: "Real", text: "yo", private: true });
  assert.match(mind.execute({ name: "reply_private", input: { player: "real", text: "hi" } }, { from: null }, now), /isn't online/);
});

test("start_activity checks levels, and a far place is walked to first", () => {
  const places = new Map([["catherby", { id: "catherby", name: "Catherby", x: 2809, y: 3436, z: 0 }]]);
  const { mind, brain, state } = mindSetup({ places });
  const now = Date.now();
  assert.match(mind.execute({ name: "start_activity", input: { activity: "yew_trees", place: "here" } }, { from: null }, now), /levels are too low/);
  assert.equal(mind.execute({ name: "start_activity", input: { activity: "oak_trees", place: "catherby" } }, { from: null }, now), null);
  assert.deepEqual(brain.roots, ["ai_travel"]);
  // Arrived: the brain asks for its next activity and gets the planned one, at that place.
  assert.equal(mind.chooseNext(now).id, "oak_trees");
  assert.deepEqual(state.home, { x: 2809, y: 3436, z: 0 });
});

test("an idle bot waits for the model, then lets the brain choose if it takes too long", () => {
  const { mind } = mindSetup();
  const now = Date.now();
  assert.equal(mind.chooseNext(now), "wait");
  assert.ok(mind.want.reasons.has("idle"));
  assert.equal(mind.chooseNext(now + 1000), "wait");
  assert.equal(mind.chooseNext(now + 30000), null);
});

test("a decision is asked on the tick, and its result applied on a later one", async () => {
  const { mind, brain, provider } = mindSetup({
    results: [{ calls: [{ name: "start_activity", input: { activity: "oak_trees", place: "here" } }], text: "" }],
  });
  mind.requestDecision("login");
  mind.tick(Date.now());
  assert.equal(provider.calls, 1);
  assert.equal(mind.inFlight, true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(brain.roots, [], "nothing happens between ticks");
  mind.tick(Date.now());
  assert.deepEqual(brain.roots, ["oak_trees"]);
});

test("the situation shows what the bot can see", () => {
  const text = buildSituation({
    now: 10000,
    name: "Dave83",
    persona: "chill",
    notes: ["saving for a rune scim"],
    where: "in Draynor Village",
    doing: "willow_trees (for 3 min)",
    combatLevel: 30,
    skills: "Woodcutting 35",
    inventory: "Logs (20 free slots)",
    equipment: "Bronze axe",
    available: ["oak_trees"],
    unavailable: ["yew_trees"],
    nearby: ["Real (combat 50, 2 tiles away)"],
    trade: null,
    chat: [{ at: 5000, from: "Real", text: "hey dave" }],
    events: [],
    ask: "Answer them.",
  });
  assert.match(text, /saving for a rune scim/);
  assert.match(text, /\[5s ago\] Real: hey dave/);
  assert.match(text, /Not yet \(levels too low\): yew_trees/);
});

test("a bot with no real player near makes no calls of its own, but still answers", (t) => {
  t.mock.method(Date, "now", () => 10000);
  const { mind, provider } = mindSetup();
  mind.services.watched = () => false;
  const now = Date.now();
  assert.equal(mind.chooseNext(now), null, "the brain picks; no idle call");
  mind.requestDecision("checkIn");
  mind.tick(now);
  assert.equal(provider.calls, 0);
  assert.equal(mind.want, null);
  mind.requestDecision("private", { reply: true, from: "Real" });
  mind.tick(now);
  assert.equal(provider.calls, 1, "a private message is still answered");
});

function presenceSetup({ logoutWhenEmptyMinutes = 0, real = [], count = 3 } = {}) {
  const players = [...real];
  const minds = new Map();
  const spawned = [];
  const loggedOut = [];
  const core = { World: { getPlayers: () => players } };
  const config = { ...readAiBotConfig({ count, logoutWhenEmptyMinutes }) };
  const presence = new AiBotPresence({
    core,
    config,
    minds,
    spawn: (index) => {
      spawned.push(index);
      minds.set(`bot${index}`, { bot: { index } });
      return "spawned";
    },
    logOut: (bot) => {
      loggedOut.push(bot.index);
      minds.delete(`bot${bot.index}`);
    },
  });
  return { presence, players, minds, spawned, loggedOut };
}

test("only a real player within watchTiles counts as watching a bot", () => {
  const { presence, players } = presenceSetup();
  players.push(fakePlayer("Real", 3200, 3200), fakePlayer("Other bot", 3205, 3205, { bot: true }));
  presence.refresh();
  assert.equal(presence.watched(fakePlayer("A", 3260, 3200, { bot: true })), true);
  assert.equal(presence.watched(fakePlayer("B", 3300, 3200, { bot: true })), false);
});

test("AI bots log in one at a time, not all in one tick", () => {
  const { presence, spawned } = presenceSetup({ real: [fakePlayer("Real")] });
  presence.start(0);
  presence.tick(0);
  presence.tick(600);
  assert.deepEqual(spawned, [0]);
  presence.tick(SPAWN_GAP_MS);
  presence.tick(SPAWN_GAP_MS * 2);
  assert.deepEqual(spawned, [0, 1, 2]);
});

test("with logoutWhenEmptyMinutes, bots log out on an empty world and return with a player", () => {
  const { presence, players, spawned, loggedOut } = presenceSetup({ logoutWhenEmptyMinutes: 10, count: 2 });
  presence.start(0);
  presence.tick(0);
  assert.deepEqual(spawned, [], "nobody online at startup: wait");
  players.push(fakePlayer("Real"));
  presence.tick(1000);
  presence.tick(1000 + SPAWN_GAP_MS);
  assert.deepEqual(spawned, [0, 1]);
  players.length = 0;
  presence.tick(60000);
  assert.deepEqual(loggedOut, [], "not empty long enough yet");
  presence.tick(60000 + 10 * 60000);
  assert.deepEqual(loggedOut.sort(), [0, 1]);
  players.push(fakePlayer("Real"));
  presence.tick(800000);
  assert.deepEqual(spawned, [0, 1, 0], "back, one at a time");
});

// --- Brain hooks ---------------------------------------------------------------

test("a paused brain does nothing, and chooseNext picks the next activity", () => {
  const player = {
    getUsername: () => "bot",
    getForceMovement: () => null,
    getMovementQueue: () => ({ size: () => 0 }),
    getLocation: () => location(3200, 3200),
  };
  const picked = { id: "oak_trees", actions: [{ id: "chop", update: () => "running" }], repeat: true };
  let choice = "wait";
  const brain = new BotBrain({
    player,
    registry: { occupy() {}, release() {}, pickActivity: () => ({ id: "fallback", actions: [] }), resolversFor: () => [] },
    world: {},
    chooseNext: () => choice,
  });
  brain.tick(1);
  assert.equal(brain.frames.length, 0, "waiting for a choice");
  choice = picked;
  brain.paused = true;
  brain.tick(2);
  assert.equal(brain.frames.length, 0, "paused");
  brain.paused = false;
  brain.tick(3);
  assert.equal(brain.frames[0].behaviour.id, "oak_trees");
  brain.replaceRoot({ id: "roam", actions: [] }, 4);
  assert.deepEqual(brain.frames.map((frame) => frame.behaviour.id), ["roam"]);
});

test("with pacing, a brain pauses after an action and before a new activity", () => {
  const player = {
    getUsername: () => "bot",
    getForceMovement: () => null,
    getMovementQueue: () => ({ size: () => 0 }),
    getLocation: () => location(3200, 3200),
  };
  let steps = 0;
  const activity = { id: "chop", actions: [{ id: "step", update: () => (++steps, "success") }], repeat: true };
  const brain = new BotBrain({
    player,
    registry: { occupy() {}, release() {}, resolversFor: () => [] },
    world: {},
    activity,
    nowMs: 0,
    pacing: { actionPauseMs: [1000, 1000], activityPauseMs: [3000, 3000] },
  });
  for (let now = 0; now < 3000; now += 600) brain.tick(now);
  assert.equal(steps, 0, "waits out the pause before a new activity");
  brain.tick(3000); // starts the frame
  brain.tick(3600); // first action
  assert.equal(steps, 1);
  brain.tick(4200);
  brain.tick(4500);
  assert.equal(steps, 1, "rests a second after an action");
  brain.tick(4700); // restarts the frame
  brain.tick(5300);
  assert.equal(steps, 2);
});

test("with pacing, a bot drops a slot or two a tick instead of all at once", () => {
  const { createDropItemsAction } = require("../plugins/bots/brain/actions/DropItems.PlayerBots");
  const items = Array.from({ length: 6 }, () => ({ getId: () => 1511, getDefinition: () => ({ isStackable: () => false }) }));
  const inventory = {
    getItems: () => items,
    getAmount: (id) => items.filter((item) => item.getId() === id).length,
    deleteNumber: (id, amount) => {
      for (let i = 0; i < amount; i++) items.splice(items.findIndex((item) => item.getId() === id), 1);
    },
  };
  const action = createDropItemsAction({ itemIds: [1511] });
  const ctx = { player: { getInventory: () => inventory }, brain: { pacing: { dropsPerTick: [2, 2] } } };
  assert.equal(action.update(ctx), "running");
  assert.equal(items.length, 4);
  action.update(ctx);
  assert.equal(action.update(ctx), "success");
  assert.equal(items.length, 0);
});

test("a walking bot stops while it types; a skilling bot keeps going", () => {
  let { mind, brain } = mindSetup();
  let reset = 0;
  mind.bot.getMovementQueue = () => ({ reset: () => reset++ });
  const now = Date.now();
  brain.restUntil = 0;
  mind.queueSay("brb", null, now);
  assert.ok(brain.restUntil > now, "stands still until the line is out");
  assert.equal(reset, 1);

  ({ mind, brain } = mindSetup());
  mind.services.world = { isBusy: () => true };
  brain.restUntil = 0;
  mind.queueSay("nice", null, now);
  assert.equal(brain.restUntil, 0, "skilling carries on while typing");
});

test("an AI bot attacked by an NPC stops its activity and fights back", () => {
  const { mind, brain } = mindSetup();
  const attacked = [];
  const goblin = {
    isNpc: () => true,
    isRegistered: () => true,
    getHitpoints: () => 5,
    getLocation: () => location(3201, 3200),
    getDefinition: () => ({ getName: () => "Goblin" }),
  };
  let attacker = goblin;
  let target = null;
  mind.bot.getCombat = () => ({ getAttacker: () => attacker, getTarget: () => target, attack: (npc) => attacked.push(npc) });
  mind.bot.getMovementQueue = () => ({ reset() {} });
  brain.isRunningActivity = () => false;
  brain.restUntil = 0;
  const now = Date.now();
  mind.defend(now);
  assert.deepEqual(attacked, [goblin]);
  assert.ok(brain.restUntil > now, "its activity waits for the fight");
  assert.match(mind.events.at(-1).text, /A Goblin attacked you/);
  target = goblin;
  mind.defend(now + 600);
  assert.equal(attacked.length, 1, "already fighting it");
  attacker = null;
  brain.restUntil = 0;
  mind.defend(now + 1200);
  assert.equal(brain.restUntil, 0, "the fight is over");
});

// --- Providers and names ------------------------------------------------------

test("the Anthropic request caches the shared prompt, uses strict tools and the refusal fallback", async () => {
  let request = null;
  const client = {
    beta: {
      messages: {
        create: async (body) => {
          request = body;
          return {
            stop_reason: "tool_use",
            usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 900 },
            content: [{ type: "tool_use", name: "say", input: { text: "hi" } }],
          };
        },
      },
    },
  };
  const provider = new AnthropicProvider({ model: "claude-opus-5-5", client });
  const tools = buildTools({ activityIds: ["oak_trees"], placeIds: [] });
  const result = await provider.generate({ system: "rules", prompt: "situation", tools });
  assert.deepEqual(result.calls, [{ name: "say", input: { text: "hi" } }]);
  assert.equal(result.usage.cacheRead, 900);
  assert.deepEqual(request.system, [{ type: "text", text: "rules", cache_control: { type: "ephemeral" } }]);
  assert.equal(request.tools.every((tool) => tool.strict === true), true);
  assert.deepEqual(request.output_config, { effort: "low" });
  assert.equal(request.fallbacks, "default");
  assert.deepEqual(request.betas, ["server-side-fallback-2026-07-01"]);
  assert.equal(request.tool_choice, undefined, "forced tool use is refused by this model");

  await new AnthropicProvider({ model: "claude-haiku-4-5", effort: null, client }).generate({ system: "", prompt: "", tools: [] });
  assert.equal(request.fallbacks, undefined, "older models don't take the fallback");
  assert.equal(request.output_config, undefined);
});

test("a refusal from Claude makes no calls", async () => {
  const client = { beta: { messages: { create: async () => ({ stop_reason: "refusal", content: [], usage: {} }) } } };
  const result = await new AnthropicProvider({ client }).generate({ system: "", prompt: "", tools: [] });
  assert.equal(result.refused, true);
  assert.deepEqual(result.calls, []);
});

test("Ollama tool calls are read whether arguments come as an object or a string", async () => {
  const fetch = async () => ({
    ok: true,
    json: async () => ({
      message: {
        content: "",
        tool_calls: [
          { function: { name: "say", arguments: { text: "yo" } } },
          { function: { name: "remember", arguments: '{"note":"met Real"}' } },
          { function: { name: "say", arguments: "{broken" } },
        ],
      },
    }),
  });
  const provider = new OllamaProvider({ url: "http://localhost:11434/", fetch });
  const result = await provider.generate({ system: "", prompt: "", tools: [] });
  assert.deepEqual(result.calls, [
    { name: "say", input: { text: "yo" } },
    { name: "remember", input: { note: "met Real" } },
  ]);
});

test("only providers with their key in the environment are used", () => {
  const entries = [{ provider: "anthropic", model: "claude-opus-5-5" }, { provider: "ollama", model: "llama3.1" }, { provider: "nope" }];
  const skipped = [];
  const providers = createProviders(entries, { env: { OLLAMA_URL: "http://x" }, log: (message) => skipped.push(message) });
  assert.deepEqual(providers.map((provider) => provider.name), ["ollama"]);
  assert.deepEqual(skipped, ["ai_bot_provider_not_configured", "ai_bot_provider_unknown"]);
  assert.equal(providerFor(providers, { provider: "anthropic", model: "claude-opus-5-5" }, 0).name, "ollama", "a saved provider without its key falls back");
});

test("realistic names look like players' names and never reuse a taken one", () => {
  for (let i = 0; i < 500; i++) {
    const name = realisticName();
    assert.ok(name.length <= 12 && /^[A-Za-z0-9]+( [A-Za-z0-9]+)?$/.test(name), name);
    assert.equal(Misc.formatText(name), name, `${name} is shown as a login would show it`);
  }
  const taken = new Set(["AiBot1", "AiBot2"]);
  assert.equal(chooseName("numbered", 0, (name) => taken.has(name)), "AiBot3");
  let calls = 0;
  const name = chooseName("realistic", 0, () => ++calls < 5);
  assert.ok(name && calls === 5);
});

test("config sections merge over the defaults", () => {
  const config = readAiBotConfig({ enabled: true, chat: { radius: 8 }, gifts: { perTrade: 500 } });
  assert.equal(config.enabled, true);
  assert.equal(config.chat.radius, 8);
  assert.equal(config.chat.replyChance, 0.35);
  assert.equal(config.gifts.perTrade, 500);
  assert.equal(config.gifts.perPlayerPerDay, 25000);
  assert.equal(readAiBotConfig(undefined).enabled, false);
});
