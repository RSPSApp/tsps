// Run after `yarn build`: node --test tests/gnome-restaurant.test.cjs
const assert = require("node:assert/strict");
const { test, beforeEach, after } = require("node:test");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");

// Give the real world parser a private PvP-off configuration before its first
// import, preserving all other effective settings. This checks canonical plugin
// spellings used by the shipped configuration and existing test helper.
// The directory is fixture-owned.
const originalCwd = process.cwd();
const shipped = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../data/definitions/world.json"), "utf8"));
const localPath = path.resolve(__dirname, "../data/definitions/world.local.json");
const localOverridePresent = fs.existsSync(localPath);
console.log(JSON.stringify({ event: "gnome-feedback-world-config", localOverridePresent }));
const local = localOverridePresent ? JSON.parse(fs.readFileSync(localPath, "utf8")) : {};
const originalWorld = { ...shipped, ...local };
for (const key of ["pluginConfig", "plugins"]) {
  if (shipped[key] && local[key] && typeof shipped[key] === "object" && typeof local[key] === "object"
      && !Array.isArray(shipped[key]) && !Array.isArray(local[key])) originalWorld[key] = { ...shipped[key], ...local[key] };
}
const offWorld = structuredClone(originalWorld);
if (offWorld.disabledPlugins !== undefined) {
  assert.ok(Array.isArray(offWorld.disabledPlugins));
  if (!offWorld.disabledPlugins.some((name) => String(name).toLowerCase() === "pvpmode")) offWorld.disabledPlugins.push("PvpMode");
} else {
  offWorld.plugins = { ...(offWorld.plugins ?? {}) };
  const key = Object.keys(offWorld.plugins).find((name) => name.toLowerCase() === "pvpmode") ?? "PvpMode";
  offWorld.plugins[key] = false;
}
const worldTemp = fs.mkdtempSync(path.join(os.tmpdir(), "gnome-pvp-off-"));
after(() => fs.rmSync(worldTemp, { recursive: true, force: true }));
const tempDefinitions = path.join(worldTemp, "data", "definitions");
fs.mkdirSync(tempDefinitions, { recursive: true });
fs.writeFileSync(path.join(tempDefinitions, "world.json"), JSON.stringify(offWorld));
assert.equal(fs.existsSync(path.join(tempDefinitions, "world.local.json")), false);
const worldModule = require.resolve("../dist/game/definition/WorldDefinition");
assert.equal(require.cache[worldModule], undefined, "world definition has not been imported before the fixture");
let fixtureWorld;
try { process.chdir(worldTemp); fixtureWorld = require(worldModule); }
finally { process.chdir(originalCwd); }
assert.deepEqual(fixtureWorld.readWorldConfig(), originalWorld, "the normal cwd still reads its original configuration");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { PluginManager } = require("../dist/plugins/PluginManager");

const core = PluginManager.getCoreApi();
const BOX = core.ItemIdentifiers.ALUFT_ALOFT_BOX;
const TOKEN = core.ItemIdentifiers.REWARD_TOKEN_4;
const COINS = core.ItemIdentifiers.COINS;

const GnomeRestaurant = require("../plugins/minigames/GnomeRestaurant.plugin");
const DATA = require("../plugins/minigames/gnomerestaurant/data/gnome-restaurant-orders.json");
const {
  init, reset, sessions, sessionOf, talkTo, acceptOrder, declineOrder, abandon,
  tick, advanceTime, rollOrder, isLocked, creditsOf, deliver, rollEasyTip,
  rollHardReward, eligibleRewards, awardCredits,
} = GnomeRestaurant._test;

let prompt = null;
let dialogueVariant = null;
const obtains = [];
init({
  core: {
    ...core,
    PluginManager: { emitNpcDialogueVariant: () => dialogueVariant },
  },
  emitCustomEvent: (name, event) => { if (name === "collection-log:obtain") obtains.push(event); },
  sendMultiChatboxPrompt: (player, title, ...pairs) => {
    const options = [];
    for (let i = 0; i < pairs.length; i += 2) options.push({ text: pairs[i], pick: pairs[i + 1] });
    prompt = { player, title, options };
    return true;
  },
});

beforeEach(() => {
  reset();
  prompt = null;
  dialogueVariant = null;
  obtains.length = 0;
});

function makeInventory(items = {}) {
  const store = new Map(Object.entries(items).map(([id, amount]) => [Number(id), amount]));
  return {
    store,
    contains: (id) => (store.get(id) ?? 0) > 0,
    getAmount: (id) => store.get(id) ?? 0,
    getFreeSlots: () => 28 - [...store.values()].filter((amount) => amount > 0).length,
    addItem: (item) => store.set(item.getId(), (store.get(item.getId()) ?? 0) + item.getAmount()),
    adds: (id, amount) => store.set(id, (store.get(id) ?? 0) + amount),
    deleteNumber: (id, amount) => store.set(id, (store.get(id) ?? 0) - amount),
  };
}

function player({ cooking = 99, items = {} } = {}) {
  // These older helper cases exercise orders after training; the native case
  // below will earn and test the prerequisite through the registered route.
  const attributes = new Map([["gnome-restaurant:tutorial-aluft", 6], ["gnome-restaurant:tutorial-blurberry", 6]]);
  const inventory = makeInventory(items);
  const p = {
    messages: [], xp: 0, dialogues: 0, builder: null, inventory,
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    getInventory: () => inventory,
    getSkillManager: () => ({
      getCurrentLevel: () => cooking,
      addExperiences: (_, xp) => { p.xp += xp; },
    }),
    getDialogueManager: () => ({ startDialogues: (builder) => { p.dialogues++; p.builder = builder; } }),
    sendMessage: (message) => p.messages.push(message),
  };
  return p;
}

/** The NPC lines of the dialogue the player was last sent. */
function dialogueTexts(p) {
  return [...(p.builder?.getDialogues?.().values() ?? [])]
    .map((dialogue) => dialogue.getText?.())
    .filter(Boolean);
}

function orderFor(tier, npcName, item = DATA.items[tier][0]) {
  return { tier, itemId: item.id, itemName: item.name, npcName, hint: item.name };
}

function deliverTo(p, npcName, itemId) {
  const event = {
    player: p,
    itemId,
    handled: false,
    target: { getCurrentDefinition: () => ({ getName: () => npcName }) },
  };
  deliver(event);
  return event;
}

function pickOption(text) {
  return prompt.options.find((option) => option.text === text);
}

/** An rng that lands inside the weight of one named tip entry for this customer. */
function fixedRng(npcName, itemName) {
  const entries = eligibleRewards(npcName);
  const total = entries.reduce((sum, entry) => sum + entry.rate[0] / entry.rate[1], 0);
  let acc = 0;
  for (const entry of entries) {
    const weight = entry.rate[0] / entry.rate[1];
    if (entry.items[0].name === itemName) return () => (acc + weight / 2) / total;
    acc += weight;
  }
  throw new Error(`${npcName} cannot give ${itemName}`);
}

// --- Talking to Gianne jnr.

test("under 29 Cooking Gianne refuses; at 29 he offers easy and hard", () => {
  const weak = player({ cooking: 10 });
  talkTo({ player: weak });
  assert.ok(dialogueTexts(weak).some((line) => /required cooking experience/i.test(line)));

  const cook = player({ cooking: 29 });
  talkTo({ player: cook });
  assert.equal(prompt.player, cook);
  assert.deepEqual(prompt.options.map((option) => option.text), [
    "I think I'll warm up with an easy one.",
    "The edge of the world is no limit for Aluft Aloft Food Deliveries!",
    "I've changed my mind, there's something else I need to do now.",
  ]);
});

test("declining a tier locks it for five minutes and hides it from the choice", () => {
  const cook = player();
  declineOrder(cook, "easy");
  assert.equal(isLocked(cook, "easy"), true);
  talkTo({ player: cook });
  assert.equal(pickOption("I think I'll warm up with an easy one."), undefined);
  assert.ok(pickOption("The edge of the world is no limit for Aluft Aloft Food Deliveries!"));
});

test("a quest-owned Gianne dialogue falls through to the transcript runtime", () => {
  dialogueVariant = "yewnock-s-legacy-talking-to-gianne-jnr";
  const cook = player();
  assert.equal(talkTo({ player: cook }), false, "not handled, so the transcript plays");
  dialogueVariant = null;
  talkTo({ player: cook });
  assert.ok(prompt, "the minigame offers a job again");
});

test("only one order at a time: a second order is refused", () => {
  const cook = player();
  acceptOrder(cook, orderFor("easy", "Burkor"));
  const first = sessionOf(cook);
  assert.ok(first);
  assert.equal(cook.inventory.getAmount(BOX), 1, "the order box");
  acceptOrder(cook, orderFor("hard", "Wingstone"));
  assert.equal(sessionOf(cook), first, "the original order stays");
  assert.equal(cook.inventory.getAmount(BOX), 1, "no second box");
});

// --- Time limit

test("an expired order discards the box and the order", () => {
  const cook = player();
  acceptOrder(cook, orderFor("easy", "Burkor"));
  sessionOf(cook).deadline = Date.now() - 1;
  tick();
  assert.equal(sessionOf(cook), undefined);
  assert.equal(cook.inventory.getAmount(BOX), 0, "the box is discarded");
  assert.ok(cook.messages.some((message) => /delivery is too late/i.test(message)));
});

test("agent:advance-time moves the deadline and expires the order", () => {
  const cook = player();
  acceptOrder(cook, orderFor("easy", "Burkor"));
  const event = { player: cook, ms: 7 * 60_000, handledBy: [] };
  advanceTime(event);
  assert.deepEqual(event.handledBy, ["GnomeRestaurant"]);
  assert.equal(sessionOf(cook), undefined);
  assert.ok(cook.messages.some((message) => /delivery is too late/i.test(message)));
});

// --- Delivery

test("the correct dish to the assigned gnome pays the easy coin tip once", () => {
  const cook = player({ items: { 2217: 1 } });
  acceptOrder(cook, orderFor("easy", "Burkor", { id: 2217, name: "Toad crunchies" }));
  const event = deliverTo(cook, "Burkor", 2217);
  assert.equal(event.handled, true);
  assert.equal(sessionOf(cook), undefined);
  assert.equal(cook.inventory.getAmount(2217), 0);
  assert.equal(cook.inventory.getAmount(BOX), 0);
  assert.equal(cook.xp, 150);
  assert.equal(creditsOf(cook), 1);
  assert.ok(cook.inventory.getAmount(COINS) >= 2 && cook.inventory.getAmount(COINS) <= 500);
  assert.ok(cook.messages.some((message) => message === "You hand over your delivery of Toad crunchies to Burkor."));

  const again = deliverTo(cook, "Burkor", 2217);
  assert.equal(again.handled, false, "no order left to deliver");
  assert.equal(cook.xp, 150, "no second reward");
});

test("a wrong dish, a premade dish, a wrong recipient and a missing box all give nothing", () => {
  const cook = player({ items: { 2217: 1, 2213: 1, 2219: 1 } });
  acceptOrder(cook, orderFor("easy", "Burkor", { id: 2217, name: "Toad crunchies" }));

  const wrongDish = deliverTo(cook, "Burkor", 2213);
  assert.equal(wrongDish.handled, true);
  assert.equal(cook.inventory.getAmount(2213), 1);
  assert.ok(cook.messages.some((message) => /correct food/i.test(message)));

  const premade = deliverTo(cook, "Burkor", 2219);
  assert.equal(premade.handled, true);
  assert.equal(cook.inventory.getAmount(2219), 1);
  assert.ok(cook.messages.some((message) => /premade dishes will not do/i.test(message)));

  const wrongGnome = deliverTo(cook, "Dalila", 2217);
  assert.equal(wrongGnome.handled, false);
  assert.equal(cook.inventory.getAmount(2217), 1);
  assert.ok(sessionOf(cook), "the order survives");

  const missingBox = player({ items: { 2217: 1 } });
  sessions.set(missingBox, { ...sessionOf(cook) });
  const noBox = deliverTo(missingBox, "Burkor", 2217);
  assert.equal(noBox.handled, true);
  assert.equal(missingBox.inventory.getAmount(2217), 1);
  assert.ok(missingBox.messages.some((message) => /aluft aloft box/i.test(message)));
});

test("logout abandons the order and the box with no reward", () => {
  const cook = player();
  acceptOrder(cook, orderFor("easy", "Burkor"));
  abandon({ player: cook });
  assert.equal(sessionOf(cook), undefined);
  assert.equal(cook.inventory.getAmount(BOX), 0);
  assert.equal(creditsOf(cook), 0);
  assert.equal(cook.xp, 0);
});

test("a new order after a delivery starts with no leftover state", () => {
  const cook = player({ items: { 2217: 1 } });
  acceptOrder(cook, orderFor("easy", "Burkor", { id: 2217, name: "Toad crunchies" }));
  deliverTo(cook, "Burkor", 2217);
  acceptOrder(cook, orderFor("easy", "Dalila", { id: 2277, name: "Fruit batta" }));
  assert.equal(sessionOf(cook).npcName, "Dalila");
  assert.equal(sessionOf(cook).itemId, 2277);
  assert.equal(cook.inventory.getAmount(BOX), 1, "one fresh box");
  assert.equal(cook.inventory.getAmount(2217), 0, "the old dish is gone");
});

// --- Hard tip table

test("hard tip entries are restricted to their customers", () => {
  const ninto = eligibleRewards("Captain Ninto").map((entry) => entry.items[0].name);
  assert.ok(ninto.includes("Gnome goggles") && ninto.includes("Gnome scarf"));
  assert.ok(!ninto.includes("Goutweed") && !ninto.includes("Raw oomlie") && !ninto.includes("Law rune"));

  const imblewyn = eligibleRewards("Professor Imblewyn").map((entry) => entry.items[0].name);
  assert.ok(imblewyn.includes("Law rune") && imblewyn.includes("Pure essence"));
  assert.ok(!imblewyn.includes("Gnome goggles"));

  const brambickle = eligibleRewards("Brambickle").map((entry) => entry.items[0].name);
  assert.ok(brambickle.includes("Goutweed") && brambickle.includes("Grand seed pod") && brambickle.includes("Mint cake"));
  assert.ok(!brambickle.includes("Raw oomlie") && !brambickle.includes("Snake charm"));

  const penwie = eligibleRewards("Penwie").map((entry) => entry.items[0].name);
  assert.ok(penwie.includes("Raw oomlie") && penwie.includes("Mint cake"));
  assert.ok(!penwie.includes("Snake charm") && !penwie.includes("Goutweed"));

  const manglethorp = eligibleRewards("Professor Manglethorp").map((entry) => entry.items[0].name);
  assert.ok(manglethorp.includes("Gold ore"));
  const roll = rollHardReward("Professor Manglethorp", fixedRng("Professor Manglethorp", "Gold ore"));
  assert.deepEqual(roll.items.map((item) => [item.id, item.name]), [[444, "Gold ore"], [453, "Coal"]],
    "gold ore and coal are one tip");
  assert.ok(roll.items[0].amount >= 6 && roll.items[0].amount <= 11);
  assert.ok(roll.items[1].amount >= 12 && roll.items[1].amount <= 22);
});

test("a hard roll only ever picks entries its customer can give", () => {
  for (const entry of DATA.rewards) {
    if (!entry.only) continue;
    for (const recipient of DATA.recipients) {
      if (entry.only.includes(recipient.name)) continue;
      assert.ok(!eligibleRewards(recipient.name).includes(entry),
        `${recipient.name} must not roll ${entry.items[0].name}`);
    }
  }
  assert.equal(rollHardReward("Captain Ninto", () => 0).items[0].name, "Gnome goggles");
  assert.equal(rollHardReward("Wingstone", () => 0).items[0].name, "Gnomeball");
  assert.equal(rollEasyTip(() => 0), 2);
  assert.equal(rollEasyTip(() => 0.999999), 500);
});

// --- Credits and the reward token

test("every 12 credits earns a reward token", () => {
  const cook = player();
  for (let delivery = 0; delivery < 4; delivery++) awardCredits(cook, 3);
  assert.equal(creditsOf(cook), 12);
  assert.equal(cook.inventory.getAmount(TOKEN), 1);
  for (let delivery = 0; delivery < 4; delivery++) awardCredits(cook, 3);
  assert.equal(creditsOf(cook), 24);
  assert.equal(cook.inventory.getAmount(TOKEN), 2);
});

// --- Every recipient in the data

test("every recipient in the data accepts its ordered dish", () => {
  for (const recipient of DATA.recipients) {
    const item = DATA.items[recipient.tier][0];
    const cook = player({ items: { [item.id]: 1 } });
    acceptOrder(cook, { tier: recipient.tier, itemId: item.id, itemName: item.name, npcName: recipient.name, hint: "" });
    assert.ok(sessionOf(cook), `${recipient.name} gets an order`);
    const event = deliverTo(cook, recipient.name, item.id);
    assert.equal(event.handled, true, `${recipient.name} accepts ${item.name}`);
    assert.equal(sessionOf(cook), undefined, `${recipient.name} receives the delivery`);
    assert.ok(cook.messages.some((message) => message.includes(`to ${recipient.name}.`)), `${recipient.name} hand-over line`);
    if (recipient.tier === "hard") {
      assert.ok(obtains.some((event) => event.player === cook && event.itemId !== TOKEN),
        `${recipient.name}: the hard tip is credited to the collection log`);
    } else {
      assert.equal(obtains.some((event) => event.player === cook), false, `${recipient.name}: no item tip to credit`);
    }
  }
});

test("rollOrder always lands on a recipient and item of the right tier", () => {
  for (const tier of ["easy", "hard"]) {
    const names = new Set(DATA.recipients.filter((entry) => entry.tier === tier).map((entry) => entry.name));
    const ids = new Set(DATA.items[tier].map((item) => item.id));
    for (let roll = 0; roll <= 1; roll += 0.05) {
      const order = rollOrder(tier, () => Math.min(roll, 0.999999));
      assert.ok(names.has(order.npcName), `${tier} recipient ${order.npcName}`);
      assert.ok(ids.has(order.itemId), `${tier} item ${order.itemId}`);
    }
  }
});

// The legacy helpers above are not native-action proof. The registered route
// below exercises training with the documented fixture adaptations.
test("registered tutor training gates all Gianne order entry paths", async (t) => {
  const path = require("node:path");
  const { CachePipeline } = require("../dist/game/cache/CachePipeline");
  const { Player } = require("../dist/game/entity/impl/player/Player");
  const { PlayerSession } = require("../dist/net/PlayerSession");
  const { ClientConnection } = require("../dist/net/NetworkBuilder");
  const { PlayerSave } = require("../dist/game/entity/impl/player/persistence/PlayerSave");
  const { MultiChatboxPrompt } = require("../dist/game/model/menu/MultiChatboxPrompt");
  const { UseItemPacketListener } = require("../dist/net/packet/impl/UseItemPacketListener");
  const { ItemActionPacketListener } = require("../dist/net/packet/impl/ItemActionPacketListener");
  const oldBots = process.env.DISABLE_PLAYER_BOTS, oldSubmit = core.TaskManager.submit, oldError = console.error;
  const ownedTasks = new Set(), players = [], npcs = [], clients = new Map(), messages = new Map(), errors = [];
  let started = false, range = null, rangeAdded = false, rangeClipping = [], reopenDuringClose = null;
  process.env.DISABLE_PLAYER_BOTS = "1";
  core.TaskManager.submit = function (task, ...args) { ownedTasks.add(task); return oldSubmit.call(this, task, ...args); };
  console.error = (...args) => { errors.push(args.map(String).join(" ")); oldError(...args); };
  t.after(() => {
    const cleanupErrors = [];
    const safely = (fn) => { try { fn(); } catch (error) { cleanupErrors.push(String(error)); } };
    try {
      reopenDuringClose = null;
      for (const player of players) safely(() => { if (player.isRegistered()) core.World.getPlayers().removes(player); });
      for (const npc of npcs) safely(() => { if (npc.isRegistered()) core.World.getNpcs().removes(npc); });
      if (rangeAdded) safely(() => {
        assert.equal(core.MapObjects.exists(range), true, "fixture still owns its added range");
        core.MapObjects.remove(range);
        for (const [x, y, z, before] of rangeClipping) assert.equal(core.RegionManager.getClipping(x, y, z, null), before);
      });
      if (started) safely(() => PluginManager.emitServerShutdown({}));
      for (const task of ownedTasks) safely(() => { if (task?.isRunning?.()) task.stop(); });
      safely(() => core.World.process());
      for (const task of ownedTasks) safely(() => { if (task?.isRunning?.()) task.stop(); });
    } finally {
      core.TaskManager.submit = oldSubmit;
      console.error = oldError;
      if (oldBots === undefined) delete process.env.DISABLE_PLAYER_BOTS; else process.env.DISABLE_PLAYER_BOTS = oldBots;
    }
    assert.deepEqual(cleanupErrors, [], "owned cleanup completed");
    assert.deepEqual(errors, [], "no captured engine or hook errors, including cleanup");
  });
  // This inert, one-shot test listener is registered before plugin discovery
  // solely to exercise a synchronous reopen during the real close event.
  function reopenEarlier(event) {
    if (!reopenDuringClose || event.player !== reopenDuringClose.player || event.interfaceId !== 49) return;
    const reopen = reopenDuringClose.run;
    reopenDuringClose = null;
    reopen();
  }
  PluginManager.createApi("GnomeCloseControl").onCustomEvent("interface:closed", reopenEarlier);
  await CachePipeline.initialize();
  const WorldDefinition = require("../dist/game/definition/WorldDefinition");
  const readWorldConfig = WorldDefinition.readWorldConfig;
  function pvpDisabled(config) {
    if (config.disabledPlugins !== undefined) {
      return Array.isArray(config.disabledPlugins) && config.disabledPlugins.some((name) => String(name).toLowerCase() === "pvpmode");
    }
    const entry = Object.entries(config.plugins ?? {}).find(([name]) => name.toLowerCase() === "pvpmode");
    return entry?.[1] === false;
  }
  function readFixtureWorld() {
    const previousCwd = process.cwd();
    try { process.chdir(worldTemp); return readWorldConfig(); }
    finally { process.chdir(previousCwd); }
  }
  assert.deepEqual(readFixtureWorld(), offWorld, "the real parser reads the complete private configuration");
  assert.equal(pvpDisabled(readFixtureWorld()), true, "the private configuration disables PvP mode");
  WorldDefinition.readWorldConfig = readFixtureWorld;
  try {
    require("./helpers/pvp-mode-on.cjs");
    assert.equal(pvpDisabled(WorldDefinition.readWorldConfig()), false, "the helper enables PvP mode for discovery");
    PluginManager.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  } finally { WorldDefinition.readWorldConfig = readWorldConfig; }
  assert.equal(WorldDefinition.readWorldConfig, readWorldConfig, "the temporary PvP configuration reader is restored");
  assert.deepEqual(readFixtureWorld(), offWorld, "the private PvP-off configuration remains unchanged");
  assert.deepEqual(WorldDefinition.readWorldConfig(), originalWorld, "the original cwd configuration remains unchanged");
  assert.equal(process.cwd(), originalCwd);
  assert.ok(PluginManager.loadedPlugins.includes("GnomeRestaurant"));
  assert.ok(PluginManager.loadedPlugins.includes("Cooking"));
  core.RegionManager.init(); core.RegionManager.loadMapFiles(3222, 3218);
  PluginManager.emitServerStartup({}); started = true;
  const { World, Location, NPC, Skill, NpcIdentifiers: N } = core;
  assert.equal(core.GameConstants.EXPERIENCE_MULTIPLIER, 1, "the selected world uses the expected base XP rate");
  const channel = () => ({ kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true,
    send: () => true, close() {}, onData() {}, onError() {}, onClose() {} });
  function actor(name, cooking, loadedSave = null) {
    assert.match(name, /^[a-z0-9]{1,12}$/);
    const wire = channel(), p = new Player(new PlayerSession(wire)); players.push(p);
    const client = new ClientConnection(wire); client.player = p; clients.set(p, client);
    const originalSend = p.sendMessage.bind(p); messages.set(p, []);
    p.sendMessage = (message, ...args) => { messages.get(p).push(String(message)); return originalSend(message, ...args); };
    p.setUsername(name); p.setLongUsername(core.Misc.stringToLongBigInt(name));
    if (loadedSave) loadedSave.applyToPlayer(p);
    p.setAttribute("bot-skip-persistence", true); p.setLocation(range.getLocation().clone().add(-1, 0));
    assert.equal(World.getPlayers().add(p), true); p.needsPlacement = false;
    if (!loadedSave) {
      const skills = p.getSkillManager();
      skills.setExperiences(Skill.COOKING, core.SkillManager.getExperienceForLevel(cooking), false);
      skills.setMaxLevel(Skill.COOKING, cooking); skills.setCurrentLevels(Skill.COOKING, cooking);
      assert.equal(skills.getCurrentLevel(Skill.COOKING), cooking);
    }
    return p;
  }
  function npc(id, expectedName) {
    const n = NPC.create(id, new Location(3221, 3219, 0)); npcs.push(n); n.setScriptedMovement(true);
    assert.equal(World.getNpcs().add(n), true); n.needsPlacement = false;
    assert.equal(n.getCurrentDefinition().getName(), expectedName);
    return n;
  }
  // NPCs are registered cache-backed actors placed for this fixture; this is
  // not a claim about the natural Grand Tree NPC spawn or walking route.
  const junior = npc(N.GIANNE_JNR_, "Gianne jnr.");
  const senior = npc(N.ALUFT_GIANNE_SNR_, "Aluft Gianne snr.");
  const blurberry = npc(N.BLURBERRY, "Blurberry");
  const rangeId = core.CacheDefinitions.getLocId("fai_varrock_range");
  const rangeDefinition = core.ObjectDefinition.forId(rangeId);
  assert.equal(rangeDefinition.getName(), "Range");
  assert.ok(rangeDefinition.getActions().includes("Cook"));
  // Select an empty, unclipped fixture footprint; never remove a preexisting
  // map object that merely has the same signature as our temporary range.
  let rangeLocation = null;
  for (let x = 3222; x <= 3234 && !rangeLocation; x++) for (let y = 3218; y <= 3230 && !rangeLocation; y++) {
    const footprint = [];
    for (let dx = 0; dx < rangeDefinition.getSizeX(); dx++) for (let dy = 0; dy < rangeDefinition.getSizeY(); dy++) {
      const tile = new Location(x + dx, y + dy, 0);
      footprint.push([tile, core.RegionManager.getClipping(tile.getX(), tile.getY(), tile.getZ(), null)]);
    }
    const standing = new Location(x - 1, y, 0);
    if (footprint.every(([tile, clipping]) => clipping === 0 && core.MapObjects.getObjectsAt(tile, null).length === 0)
      && !core.RegionManager.blocked(standing, null) && core.MapObjects.getObjectsAt(standing, null).length === 0) {
      rangeLocation = new Location(x, y, 0);
      rangeClipping = footprint.map(([tile, clipping]) => [tile.getX(), tile.getY(), tile.getZ(), clipping]);
    }
  }
  assert.ok(rangeLocation, "an empty range footprint and adjacent standing tile exist in the loaded region");
  range = new core.GameObject(rangeId, rangeLocation, 10, 0);
  assert.equal(core.MapObjects.get(rangeId, rangeLocation, null), null, "no same-id map object is replaced");
  try { core.MapObjects.add(range); rangeAdded = true; }
  catch (error) { rangeAdded = core.MapObjects.exists(range); throw error; }
  assert.equal(core.MapObjects.get(rangeId, range.getLocation(), null), range);
  function click(p, n, action) {
    const definition = n.getCurrentDefinition(p), clickType = definition.getActions().indexOf(action) + 1;
    const at = n.getLocation();
    assert.ok(clickType > 0, `active cache exposes ${action} on ${n.getId()}`);
    assert.equal(PluginManager.emitNpcInteraction({ player: p, npc: n, npcId: n.getId(), npcIndex: n.getIndex(),
      location: { x: at.getX(), y: at.getY(), z: at.getZ() }, definition, clickType, handled: false }), true);
  }
  function currentNpc(p, n, text) {
    const current = p.getDialogueManager().getCurrent();
    assert.ok(current instanceof core.NpcDialogue);
    assert.equal(p.getPacketSender().isChatboxInterface(231), true);
    assert.equal(current.getNpcId(), n.getId());
    assert.equal(String(current.getText()).replace(/\s+/g, " ").trim(), text.replace(/\s+/g, " ").trim());
  }
  async function drive(p, n, choice = null, stopMessage = null) {
    const manager = p.getDialogueManager(), sender = p.getPacketSender();
    const choices = choice ? (Array.isArray(choice) ? [...choice] : [choice]) : [];
    const normalized = (value) => String(value).replace(/\s+/g, " ").trim();
    const firstMessage = messages.get(p).length;
    for (let step = 0; step < 100 && (manager.isActive() || MultiChatboxPrompt.getPending(p)); step++) {
      if (stopMessage && messages.get(p).slice(firstMessage).some((text) => normalized(text) === normalized(stopMessage))) {
        assert.deepEqual(choices, []);
        return;
      }
      const prompt = MultiChatboxPrompt.getPending(p);
      if (prompt) {
        const next = choices.shift();
        assert.ok(next, "only an expected actor-owned prompt is presented");
        assert.equal(sender.isChatboxInterface(219), true);
        assert.equal(prompt.title, next.title ?? "Select an option");
        assert.deepEqual(prompt.options, next.options);
        await clients.get(p).dispatch([{ type: "dialogue_continue", widgetId: (219 << 16) | 1, childIndex: next.index }]);
        clients.get(p).processTurnPackets();
        continue;
      }
      const current = manager.getCurrent();
      let group;
      if (current instanceof core.NpcDialogue) { group = 231; assert.equal(current.getNpcId(), n.getId()); }
      else if (current instanceof core.PlayerDialogue) group = 217;
      else if (current instanceof core.StatementDialogue) group = 229;
      else if (current instanceof core.ItemStatementDialogue) group = 193;
      else if (current instanceof core.DoubleItemStatementDialogue) group = 11;
      else assert.fail(`unexpected native dialogue ${current?.constructor?.name}`);
      assert.equal(sender.isChatboxInterface(group), true, "the current actor owns the matching mounted dialogue");
      assert.ok(String(current.getText()).replace(/\s+/g, " ").trim(), "the native dialogue has text");
      assert.equal(manager.handleResume(group << 16, 0), true);
    }
    assert.equal(manager.isActive(), false);
    assert.equal(MultiChatboxPrompt.getPending(p), null);
    assert.deepEqual(choices, [], "each expected prompt was actually offered");
    if (stopMessage) assert.ok(messages.get(p).slice(firstMessage).some((text) => normalized(text) === normalized(stopMessage)), "the expected terminal message was reached before finishing");
  }
  const obj = (name) => { const value = core.CacheDefinitions.getObjId(name); assert.ok(Number.isInteger(value), name); return value; };
  function slot(p, value) {
    const itemId = typeof value === "number" ? value : obj(value), result = p.getInventory().getSlotForItemId(itemId);
    assert.ok(result >= 0, `carried ${value}`); return result;
  }
  function use(p, first, second) { UseItemPacketListener.itemOnItem(p, slot(p, first), slot(p, second)); }
  function action(p, value, option) {
    const itemId = typeof value === "number" ? value : obj(value), itemSlot = slot(p, itemId);
    const definition = core.CacheDefinitions.getItem(itemId), index = definition.inventoryActions.indexOf(option) + 1;
    assert.ok(index > 0, `active cache exposes ${option} on ${itemId}`);
    assert.equal(ItemActionPacketListener.handleAction(p, core.Inventory.INTERFACE_ID, itemId, itemSlot, index), true);
  }
  async function widget(p, widgetId, child, row) {
    await clients.get(p).dispatch([{ type: "widget_action", widgetId, groupId: 49, childId: child, slot: row, buttonNum: 1 }]);
    clients.get(p).processTurnPackets();
  }
  const unrelatedWidget = (999 << 16) | 1;
  let unrelatedClicks = 0;
  function observeUnrelatedClick(event) { if (event.buttonId === unrelatedWidget) unrelatedClicks++; }
  PluginManager.createApi("GnomeWidgetControl").onInterfaceActionClick(observeUnrelatedClick);
  async function assertUnrelatedWidgetDoesNotResolveCuisine(p) {
    const cache = core.CacheDefinitions, names = ["getInterfaceId", "getComponentId", "getVarbitId"], originals = new Map();
    let lookups = 0;
    try {
      for (const name of names) {
        const original = cache[name]; originals.set(name, original);
        cache[name] = function (value, ...args) {
          if (String(value).includes("aluft_cooking") || value === "gnome_chosen_cuisine"
            || value === "toplevel_osrs_stretch:mainmodal") lookups++;
          return original.call(this, value, ...args);
        };
        assert.notEqual(cache[name], original, `the ${name} observation is installed`);
      }
      const before = unrelatedClicks;
      await clients.get(p).dispatch([{ type: "widget_action", widgetId: unrelatedWidget, groupId: 999, childId: 1, buttonNum: 1 }]);
      clients.get(p).processTurnPackets();
      assert.equal(unrelatedClicks, before + 1, "the registered interface route received the unrelated click");
      assert.equal(lookups, 0, "an unrelated click performs no cuisine definition lookup");
    } finally { for (const [name, original] of originals) cache[name] = original; }
  }
  async function prepare(p, source, option, row, output) {
    const expectedPhaseXp = source === "half_baked_batta" ? 40 : 30;
    const xpGate = PluginManager.emitCanGainExperience(p, Skill.COOKING, expectedPhaseXp);
    assert.notEqual(xpGate.allow, false); assert.equal(xpGate.multiplier, 1);
    assert.notEqual(p.getAttribute(core.SkillManager.XP_LOCKED_ATTRIBUTE), true);
    const recipes = {
      half_baked_crunchy: { 0: [["toads_legs", 2]], 3: [["chocolate_bar", 2]] },
      half_baked_batta: { 1: [["equa_leaves", 1], ["toads_legs", 1], ["cheese", 1]], 4: [["tomato", 1], ["cheese", 1]] },
      cocktail_shaker: { 0: [["pineapple", 1], ["lemon", 1], ["orange", 1]],
        1: [["pineapple", 2], ["lemon", 1], ["orange", 1]],
        2: [["vodka", 2], ["gin", 1], ["lime", 1], ["lemon", 1], ["orange", 1]],
        3: [["vodka", 1], ["lime", 3]] },
    };
    const inputs = [[source, 1], ...recipes[source][row]], before = inputs.map(([name]) => p.getInventory().getAmount(obj(name)));
    const spice = p.getInventory().getAmount(obj("gnome_spice"));
    const beforeXp = p.getSkillManager().getExperience(Skill.COOKING);
    const sender = p.getPacketSender(), flags = [], forward = sender.sendInterfaceFlagsRange;
    sender.sendInterfaceFlagsRange = function (...args) { flags.push(args); return forward.apply(this, args); };
    try { action(p, source, option); } finally { sender.sendInterfaceFlagsRange = forward; }
    const group = core.CacheDefinitions.getInterfaceId("aluft_cooking");
    const clickId = core.CacheDefinitions.getComponentId("aluft_cooking:cuisine_clickzone");
    const createId = core.CacheDefinitions.getComponentId("aluft_cooking:confirmation");
    const main = core.CacheDefinitions.getComponentId("toplevel_osrs_stretch:mainmodal");
    assert.deepEqual([group, clickId, createId], [49, (49 << 16) | 4, (49 << 16) | 9]);
    assert.equal(p.getInterfaceId(), group); assert.equal(sender.getSubInterfaceAt(main)?.groupId, group);
    const lastRow = source === "cocktail_shaker" ? 6 : source === "half_baked_batta" ? 4 : 3;
    assert.ok(flags.some(([uid, first, last, mask]) => uid === clickId && first === 0 && last === lastRow && mask === 2),
      "every displayed row can replace the prior server selection");
    if (source === "half_baked_batta" && row === 1) {
      const before = p.getInventory().getItems().map((item) => [item.getId(), item.getAmount(), item.getMeta()]);
      const xp = p.getSkillManager().getExperience(Skill.COOKING);
      await widget(p, clickId, 4, row);
      await widget(p, clickId, 4, 0); // displayed fruit batta is outside this selected producer
      await widget(p, createId, 9, undefined);
      assert.deepEqual(p.getInventory().getItems().map((item) => [item.getId(), item.getAmount(), item.getMeta()]), before,
        "unsupported selection clears the prior supported recipe without consumption");
      assert.equal(p.getSkillManager().getExperience(Skill.COOKING), xp);
      assert.equal(p.getInventory().getAmount(9482), 0);
      assert.equal(sender.getSubInterfaceAt(main)?.groupId, group);
    }
    await widget(p, clickId, 4, row);
    await widget(p, createId, 9, undefined);
    assert.equal(p.getInventory().getAmount(typeof output === "number" ? output : obj(output)), 1);
    inputs.forEach(([name, amount], index) => assert.equal(p.getInventory().getAmount(obj(name)), before[index] - amount,
      `the selected recipe consumed ${amount} ${name}`));
    assert.equal(p.getInventory().getAmount(obj("gnome_spice")), spice, "reusable spice remains");
    assert.equal(p.getSkillManager().getExperience(Skill.COOKING) - beforeXp, expectedPhaseXp);
  }
  function cook(p, source, output) {
    const itemId = typeof source === "number" ? source : obj(source), outputId = typeof output === "number" ? output : obj(output);
    const sourceSlot = slot(p, itemId);
    UseItemPacketListener.itemOnObject(p, core.Inventory.INTERFACE_ID, rangeId, itemId, sourceSlot,
      rangeLocation.getX(), rangeLocation.getY());
    for (let tick = 0; tick < 40 && p.getInventory().getAmount(outputId) === 0; tick++) World.process();
    assert.equal(p.getInventory().getAmount(outputId), 1, `cooked ${source} into ${output}`);
  }
  async function handIn(p, tutor, key, value, expectedText) {
    const before = messages.get(p).length;
    click(p, tutor, "Talk-to"); await drive(p, tutor);
    assert.equal(p.getAttribute(key), value);
    assert.ok(messages.get(p).slice(before).some((text) => text.replace(/\s+/g, " ").trim() === expectedText));
  }
  async function cut(p, fruit, choice, output) {
    use(p, "knife", fruit);
    const prompt = MultiChatboxPrompt.getPending(p);
    assert.ok(prompt); assert.equal(p.getPacketSender().isChatboxInterface(219), true);
    assert.equal(prompt.title, "How would you like to cut the fruit?");
    assert.deepEqual(prompt.options, ["Dice", "Slice"]);
    await clients.get(p).dispatch([{ type: "dialogue_continue", widgetId: (219 << 16) | 1, childIndex: choice === "Dice" ? 1 : 2 }]);
    clients.get(p).processTurnPackets();
    assert.equal(MultiChatboxPrompt.getPending(p), null);
    assert.ok(p.getInventory().getAmount(obj(output)) > 0);
  }
  function pour(p, mixed, product, garnish, xp) {
    const xpGate = PluginManager.emitCanGainExperience(p, Skill.COOKING, xp);
    assert.notEqual(xpGate.allow, false); assert.equal(xpGate.multiplier, 1);
    assert.notEqual(p.getAttribute(core.SkillManager.XP_LOCKED_ATTRIBUTE), true);
    const inventory = p.getInventory(), names = [[mixed, 1], ["cocktail_glass_empty", 1], ...garnish];
    const before = names.map(([name]) => inventory.getAmount(typeof name === "number" ? name : obj(name)));
    const beforeXp = p.getSkillManager().getExperience(Skill.COOKING);
    action(p, mixed, "Pour");
    names.forEach(([name, amount], index) => assert.equal(inventory.getAmount(typeof name === "number" ? name : obj(name)), before[index] - amount));
    assert.equal(inventory.getAmount(obj(product)), 1);
    assert.equal(inventory.getAmount(obj("cocktail_shaker")), 1);
    assert.equal(p.getSkillManager().getExperience(Skill.COOKING) - beforeXp, xp);
  }
  async function missingRecommendations(p) {
    for (const option of ["Talk-to", "Get job (easy)", "Get job (hard)"]) {
      click(p, junior, option);
      assert.equal(MultiChatboxPrompt.getPending(p), null, `${option} offers no order`);
      currentNpc(p, junior, "First of all you will need some basic Gnome Cooking and Cocktail making training. Go and talk to my Father, Aluft Gianne snr. and Blurberry, if you haven't already, and they'll tell you what you need to do.");
      await drive(p, junior);
    }
  }
  const ordinary = actor("gnomebread", 99);
  await assertUnrelatedWidgetDoesNotResolveCuisine(ordinary);
  assert.equal(core.RegionManager.blocked(ordinary.getLocation(), null), false);
  const dough = core.CacheDefinitions.getObjId("bread_dough"), bread = core.CacheDefinitions.getObjId("bread");
  assert.ok(Number.isInteger(dough) && Number.isInteger(bread));
  ordinary.getInventory().add(new core.Item(dough, 1), true);
  const doughSlot = ordinary.getInventory().getSlotForItemId(dough);
  assert.ok(doughSlot >= 0);
  UseItemPacketListener.itemOnObject(ordinary, core.Inventory.INTERFACE_ID, rangeId, dough, doughSlot,
    rangeLocation.getX(), rangeLocation.getY());
  for (let tick = 0; tick < 40 && ordinary.getInventory().getAmount(bread) === 0; tick++) World.process();
  assert.equal(ordinary.getInventory().getAmount(bread), 1, "ordinary bread is cooked without tutorial progress");
  assert.equal(ordinary.getAttribute("gnome-restaurant:tutorial-aluft") ?? 0, 0);
  assert.equal(ordinary.getAttribute("gnome-restaurant:tutorial-blurberry") ?? 0, 0);
  const weak = actor("gnomeweak", 28);
  for (const option of ["Talk-to", "Get job (easy)", "Get job (hard)"]) {
    click(weak, junior, option);
    currentNpc(weak, junior, "I'm afraid you don't have the required cooking experience for this job. If you want to work for me you'll have to train up to level 29 Cooking.");
    await drive(weak, junior);
  }
  // The Barcrawl's quest stage is set up directly; the real registered Talk-to
  // consumer must still win Blurberry's conversation when the card is held.
  const barQuest = require("../plugins/quests/QuestRuntime").getRegisteredQuests()
    .filter((quest) => quest.key === "alfred-grimhands-barcrawl").at(-1);
  assert.ok(barQuest);
  const bar = actor("gnomebar", 29); barQuest.setStage(bar, 1);
  bar.getInventory().add(new core.Item(core.ItemIdentifiers.BARCRAWL_CARD, 1), true);
  click(bar, blurberry, "Talk-to");
  const opening = bar.getDialogueManager().getCurrent();
  assert.ok(opening instanceof core.PlayerDialogue);
  assert.equal(bar.getPacketSender().isChatboxInterface(217), true);
  assert.equal(opening.getText(), "I'm doing Alfred Grimhand's Barcrawl.");
  assert.equal(bar.getDialogueManager().handleResume(217 << 16, 0), true);
  currentNpc(bar, blurberry, "Ah, you've come to the best stop on your list! I'll give you my famous Fire Toad Blast! It'll cost you 10 coins.");
  await drive(bar, blurberry);
  assert.equal(bar.getInventory().getAmount(core.ItemIdentifiers.BARCRAWL_CARD), 1);
  assert.equal(bar.getAttribute("gnome-restaurant:tutorial-blurberry") ?? 0, 0);
  const learner = actor("gnomelearner", 29);
  assert.equal(learner.getAttribute("gnome-restaurant:tutorial-aluft") ?? 0, 0);
  assert.equal(learner.getAttribute("gnome-restaurant:tutorial-blurberry") ?? 0, 0);
  assert.equal(PluginManager.emitNpcDialogueVariant({ player: learner, npc: junior, npcId: junior.getId(),
    definition: junior.getCurrentDefinition(learner), pages: [] }) == null, true, "no other quest owns this initial Gianne conversation");
  click(learner, junior, "Talk-to");
  // Intended old-source red: the original source offers a job here.
  assert.equal(MultiChatboxPrompt.getPending(learner), null, "without recommendations, no order menu is offered");
  currentNpc(learner, junior, "First of all you will need some basic Gnome Cooking and Cocktail making training. Go and talk to my Father, Aluft Gianne snr. and Blurberry, if you haven't already, and they'll tell you what you need to do.");
  await drive(learner, junior);
  await missingRecommendations(learner);
  // Primary Creation tables give level 1 for the final garnish itself; this
  // seeded intermediate isolates that phase, not the normal earned recipe.
  const finisher = actor("gnomefinish", 1), finishXp = finisher.getSkillManager().getExperience(Skill.COOKING);
  const finishGate = PluginManager.emitCanGainExperience(finisher, Skill.COOKING, 40);
  assert.notEqual(finishGate.allow, false); assert.equal(finishGate.multiplier, 1);
  assert.notEqual(finisher.getAttribute(core.SkillManager.XP_LOCKED_ATTRIBUTE), true);
  finisher.getInventory().add(new core.Item(9582, 1), true);
  finisher.getInventory().add(new core.Item(obj("equa_leaves"), 1), true);
  use(finisher, 9582, "equa_leaves");
  assert.equal(finisher.getInventory().getAmount(obj("toad_crunchies")), 1);
  assert.equal(finisher.getSkillManager().getExperience(Skill.COOKING) - finishXp, 40);
  // Adapt just the world-policy query around the registered range action; this
  // is not a separately booted F2P world or an F2P gameplay capture.
  const free = actor("gnomefree", 99), rawCrunchy = obj("raw_crunchies");
  free.getInventory().add(new core.Item(rawCrunchy, 1), true);
  const freeXp = free.getSkillManager().getExperience(Skill.COOKING), members = core.WorldDefinition.isMembersWorld;
  try {
    core.WorldDefinition.isMembersWorld = () => false;
    assert.equal(core.WorldDefinition.isMembersWorld(), false);
    const definition = range.getDefinition(), clickType = definition.getActions().indexOf("Cook") + 1, at = range.getLocation();
    assert.ok(clickType > 0);
    assert.equal(PluginManager.emitObjectInteraction({ player: free, object: range, objectId: rangeId, definition,
      location: { x: at.getX(), y: at.getY(), z: at.getZ() }, clickType, handled: false }), true);
    assert.equal(require("../plugins/skills/Cooking.plugin").isCookingActive(free), false);
    assert.equal(free.getInventory().getAmount(rawCrunchy), 1);
    assert.equal(free.getInventory().getAmount(obj("half_baked_crunchy")), 0);
    assert.equal(free.getSkillManager().getExperience(Skill.COOKING), freeXp);
  } finally { core.WorldDefinition.isMembersWorld = members; }
  // A synthetic stage isolates restricted-copy handling; it is not counted
  // as evidence that this actor earned the tutorial.
  // The production preset factory marks the fixture items using an actual
  // registered preset identity; their inclusion in that preset is adapted.
  const Presets = require("../plugins/modes/pvp/Presets.PvpMode");
  assert.equal(Presets.isEnabled(), true);
  const preset = Presets.getGlobalPresetPool()[0]; assert.ok(preset);
  function presetCopy(p, itemId) {
    assert.equal(p.isPlayerBot(), false);
    const item = Presets._test.spawnPresetItem(new core.Item(itemId, 1), preset, p);
    assert.equal(item.isPresetItem(), true); assert.equal(item.isUntradeable(), true); assert.equal(item.isUnbankable(), true);
    return item;
  }
  const restricted = actor("gnomerestr", 29), foodId = obj("toad_crunchies"), trayId = obj("crunchy_tray");
  restricted.setAttribute("gnome-restaurant:tutorial-aluft", 2);
  restricted.getInventory().add(new core.Item(trayId, 1), true);
  restricted.getInventory().add(presetCopy(restricted, foodId), true);
  const restrictedBefore = restricted.getInventory().getItems().map((item) => [item.getId(), item.getAmount(), item.getMeta()]);
  click(restricted, senior, "Talk-to"); await drive(restricted, senior);
  assert.equal(restricted.getAttribute("gnome-restaurant:tutorial-aluft"), 2);
  assert.deepEqual(restricted.getInventory().getItems().map((item) => [item.getId(), item.getAmount(), item.getMeta()]), restrictedBefore);
  restricted.getInventory().add(new core.Item(foodId, 1), true);
  const matching = restricted.getInventory().getItems().filter((item) => item.getId() === foodId);
  assert.equal(matching.length, 2); assert.equal(matching[0].isPresetItem(), true); assert.equal(matching[1].isPresetItem(), false);
  await handIn(restricted, senior, "gnome-restaurant:tutorial-aluft", 3, "You give Aluft the toad crunchies. He takes a bite...");
  const remainingFood = restricted.getInventory().getItems().filter((item) => item.getId() === foodId);
  assert.equal(remainingFood.length, 1); assert.equal(remainingFood[0].isPresetItem(), true);
  // Restriction flags belong to the instance, not the cache's tradeability.
  // Exercise the real item-on-item route with a restricted copy first.
  const restrictedCook = actor("gnomeinput", 29), doughId = obj("gianne_dough");
  const cookInventory = restrictedCook.getInventory();
  let restrictedProduced = 0;
  function observeRestrictedProduction(event) { if (event.player === restrictedCook) restrictedProduced++; }
  PluginManager.createApi("GnomeInputControl").onCustomEvent("skills:produced", observeRestrictedProduction);
  cookInventory.add(presetCopy(restrictedCook, doughId), true);
  cookInventory.add(new core.Item(trayId, 1), true);
  const originalInputs = cookInventory.getItems().map((item) => [item.getId(), item.getAmount(), item.getMeta()]);
  use(restrictedCook, doughId, trayId);
  assert.deepEqual(cookInventory.getItems().map((item) => [item.getId(), item.getAmount(), item.getMeta()]), originalInputs);
  assert.equal(cookInventory.getAmount(rawCrunchy), 0);
  cookInventory.add(new core.Item(doughId, 1), true);
  const plainDoughSlot = cookInventory.getItems().findIndex((item) => item.getId() === doughId && !item.isPresetItem());
  assert.ok(plainDoughSlot > slot(restrictedCook, doughId), "the restricted copy precedes the selected plain copy");
  const mixedBefore = cookInventory.getItems().map((item) => [item.getId(), item.getAmount(), item.getMeta()]);
  const restrictedXp = restrictedCook.getSkillManager().getExperience(Skill.COOKING);
  UseItemPacketListener.itemOnItem(restrictedCook, slot(restrictedCook, doughId), slot(restrictedCook, trayId));
  assert.deepEqual(cookInventory.getItems().map((item) => [item.getId(), item.getAmount(), item.getMeta()]), mixedBefore);
  assert.equal(restrictedCook.getSkillManager().getExperience(Skill.COOKING), restrictedXp);
  assert.equal(restrictedProduced, 0, "a restricted click cannot fall back to a different plain copy");
  UseItemPacketListener.itemOnItem(restrictedCook, plainDoughSlot, slot(restrictedCook, trayId));
  assert.equal(cookInventory.getAmount(rawCrunchy), 1);
  assert.equal(cookInventory.getAmount(doughId), 1);
  assert.equal(cookInventory.getItems()[slot(restrictedCook, doughId)].isPresetItem(), true);
  assert.equal(restrictedProduced, 1);
  // These adapted mutations test session ownership after an actual menu opens;
  // they are not a claim that a retail client sends such stale clicks.
  const clickId = core.CacheDefinitions.getComponentId("aluft_cooking:cuisine_clickzone");
  const createId = core.CacheDefinitions.getComponentId("aluft_cooking:confirmation");
  const modalId = core.CacheDefinitions.getComponentId("toplevel_osrs_stretch:mainmodal");
  const crunchyId = obj("half_baked_crunchy");
  function menuActor(name) {
    const p = actor(name, 29);
    for (const [value, amount] of [[crunchyId, 1], [obj("toads_legs"), 2], [obj("gnome_spice"), 1]]) {
      p.getInventory().add(new core.Item(value, amount), true);
    }
    return p;
  }
  const staleItem = menuActor("gnomestale"), staleInventory = staleItem.getInventory();
  action(staleItem, crunchyId, "Prepare");
  await widget(staleItem, clickId, 4, 0);
  const staleSlot = slot(staleItem, crunchyId), originalItem = staleInventory.getItems()[staleSlot];
  staleInventory.deleteAtSlot(staleSlot, 1, true);
  staleInventory.add(new core.Item(crunchyId, 1), true);
  assert.notEqual(staleInventory.getItems()[slot(staleItem, crunchyId)], originalItem);
  const staleBefore = staleInventory.getItems().map((item) => [item.getId(), item.getAmount(), item.getMeta()]);
  const staleXp = staleItem.getSkillManager().getExperience(Skill.COOKING);
  await widget(staleItem, createId, 9, undefined);
  assert.deepEqual(staleInventory.getItems().map((item) => [item.getId(), item.getAmount(), item.getMeta()]), staleBefore);
  assert.equal(staleInventory.getAmount(9581), 0);
  assert.equal(staleItem.getSkillManager().getExperience(Skill.COOKING), staleXp);
  const replaced = menuActor("gnomemount"), replacedSender = replaced.getPacketSender();
  action(replaced, crunchyId, "Prepare");
  await widget(replaced, clickId, 4, 0);
  const originalMount = replacedSender.getSubInterfaceAt(modalId);
  assert.equal(originalMount?.groupId, 49);
  const replacementMount = replacedSender.mountSubInterface(modalId, 49, 0);
  assert.notEqual(replacementMount, originalMount);
  assert.equal(replacedSender.getSubInterfaceAt(modalId), replacementMount);
  const replacedBefore = replaced.getInventory().getItems().map((item) => [item.getId(), item.getAmount(), item.getMeta()]);
  const replacedXp = replaced.getSkillManager().getExperience(Skill.COOKING);
  await widget(replaced, createId, 9, undefined);
  assert.deepEqual(replaced.getInventory().getItems().map((item) => [item.getId(), item.getAmount(), item.getMeta()]), replacedBefore);
  assert.equal(replaced.getInventory().getAmount(9581), 0);
  assert.equal(replaced.getSkillManager().getExperience(Skill.COOKING), replacedXp);
  assert.equal(replacedSender.getSubInterfaceAt(modalId), replacementMount, "a stale session does not close the replacement");
  assert.equal(replacedSender.closeSubInterfaceMount(replacementMount), true);
  const reopened = menuActor("gnomereopen"), reopenSender = reopened.getPacketSender();
  action(reopened, crunchyId, "Prepare");
  const oldMount = reopenSender.getSubInterfaceAt(modalId);
  assert.equal(oldMount?.groupId, 49);
  reopenDuringClose = { player: reopened, run: () => action(reopened, crunchyId, "Prepare") };
  reopenSender.closeInterface(49);
  assert.equal(reopenDuringClose, null, "the earlier registered close listener ran once");
  assert.equal(reopened.getInterfaceId(), 49);
  assert.notEqual(reopenSender.getSubInterfaceAt(modalId), oldMount);
  assert.equal(reopenSender.getSubInterfaceAt(modalId)?.groupId, 49);
  await widget(reopened, clickId, 4, 0);
  await widget(reopened, createId, 9, undefined);
  assert.equal(reopened.getInventory().getAmount(9581), 1, "the new menu session survives the old close event");
  // Synthetic burn override exercises the registered range consumer and
  // subsequent Empty action, without asserting a natural burn probability.
  const capacity = actor("gnomefull", 99), burning = actor("gnomeburn", 99);
  let capacityBurnEvents = 0, forcedBurnEvents = 0;
  function observeGnomeBurn(event) {
    if (event.player === capacity) capacityBurnEvents++;
    if (event.player === burning && event.rawId === 9581) { forcedBurnEvents++; event.burn = true; }
  }
  PluginManager.createApi("GnomeBakeControl").onCustomEvent("cooking:burn", observeGnomeBurn);
  const capacityInventory = capacity.getInventory(), fillerId = obj("bread");
  capacityInventory.add(new core.Item(9581, 1), true);
  assert.equal(new core.Item(fillerId, 1).getDefinition().isStackable(), false);
  capacityInventory.add(new core.Item(fillerId, capacityInventory.getFreeSlots()), true);
  assert.equal(capacityInventory.getFreeSlots(), 0);
  const fullBefore = capacityInventory.getItems().map((item) => [item.getId(), item.getAmount(), item.getMeta()]);
  const fullXp = capacity.getSkillManager().getExperience(Skill.COOKING);
  UseItemPacketListener.itemOnObject(capacity, core.Inventory.INTERFACE_ID, rangeId, 9581, slot(capacity, 9581),
    rangeLocation.getX(), rangeLocation.getY());
  for (let tick = 0; tick < 40; tick++) World.process();
  assert.deepEqual(capacityInventory.getItems().map((item) => [item.getId(), item.getAmount(), item.getMeta()]), fullBefore);
  assert.equal(capacity.getSkillManager().getExperience(Skill.COOKING), fullXp);
  assert.equal(capacityBurnEvents, 0, "capacity is checked before the burn roll and callback");
  capacityInventory.deleteNumber(fillerId, 1);
  cook(capacity, 9581, 9582);
  assert.equal(capacityInventory.getAmount(trayId), 1, "the successful bake returns its tray");
  const burnXp = burning.getSkillManager().getExperience(Skill.COOKING);
  burning.getInventory().add(new core.Item(9581, 1), true);
  cook(burning, 9581, "burnt_crunchies");
  assert.equal(forcedBurnEvents, 1);
  assert.equal(burning.getInventory().getAmount(trayId), 0, "the burnt item retains the tray until emptied");
  assert.equal(burning.getSkillManager().getExperience(Skill.COOKING), burnXp);
  action(burning, "burnt_crunchies", "Empty Tray");
  assert.equal(burning.getInventory().getAmount(obj("burnt_crunchies")), 0);
  assert.equal(burning.getInventory().getAmount(trayId), 1);
  // Set up deterministic cooking without claiming a potion or a 29-base playthrough.
  const skills = learner.getSkillManager();
  skills.setExperiences(Skill.COOKING, core.SkillManager.getExperienceForLevel(99), false);
  skills.setMaxLevel(Skill.COOKING, 99); skills.setCurrentLevels(Skill.COOKING, 99);
  click(learner, senior, "Talk-to");
  await drive(learner, senior, { options: ["No thanks, I'm no cook.", "Ok, I'll give it a go."], index: 2 });
  assert.equal(learner.getAttribute("gnome-restaurant:tutorial-aluft"), 1);
  click(learner, senior, "Talk-to"); await drive(learner, senior);
  assert.equal(learner.getAttribute("gnome-restaurant:tutorial-aluft"), 2);
  use(learner, "gianne_dough", "crunchy_tray");
  cook(learner, "raw_crunchies", "half_baked_crunchy");
  await prepare(learner, "half_baked_crunchy", "Prepare", 0, 9581);
  await assertUnrelatedWidgetDoesNotResolveCuisine(learner);
  cook(learner, 9581, 9582);
  assert.equal(learner.getInventory().getAmount(obj("crunchy_tray")), 1);
  use(learner, 9582, "equa_leaves");
  assert.equal(learner.getInventory().getAmount(obj("toad_crunchies")), 1);
  // The following handout needs four slots; handing in the food frees one.
  // Fill with a plain unrelated food to exercise one-short and exact-space paths.
  const inventory = learner.getInventory(), filler = obj("bread"), available = inventory.getFreeSlots();
  assert.ok(available >= 4); assert.equal(new core.Item(filler, 1).getDefinition().isStackable(), false);
  const fillerCount = available - 2;
  inventory.add(new core.Item(filler, fillerCount), true);
  assert.equal(inventory.getFreeSlots(), 2);
  const beforeFull = inventory.getItems().map((item) => [item.getId(), item.getAmount(), item.getMeta()]);
  const beforeAwards = learner.getAttribute("gnome-restaurant:tutorial-awards"), beforeXp = skills.getExperience(Skill.COOKING);
  const beforeFailure = messages.get(learner).length;
  click(learner, senior, "Talk-to"); await drive(learner, senior);
  assert.ok(messages.get(learner).slice(beforeFailure).includes("You need more inventory space."));
  assert.equal(learner.getAttribute("gnome-restaurant:tutorial-aluft"), 2);
  assert.equal(learner.getAttribute("gnome-restaurant:tutorial-awards"), beforeAwards);
  assert.equal(skills.getExperience(Skill.COOKING), beforeXp);
  assert.deepEqual(inventory.getItems().map((item) => [item.getId(), item.getAmount(), item.getMeta()]), beforeFull);
  inventory.deleteNumber(filler, 1);
  assert.equal(inventory.getFreeSlots(), 3);
  click(learner, senior, "Talk-to");
  await drive(learner, senior, null, "You give Aluft the toad crunchies. He takes a bite...");
  assert.equal(learner.getAttribute("gnome-restaurant:tutorial-aluft"), 3);
  assert.equal(learner.getInventory().getAmount(obj("toad_crunchies")), 0);
  const nextGift = ["chocolate_bar", "chocolate_dust", "gianne_dough"].map((name) => learner.getInventory().getAmount(obj(name)));
  assert.deepEqual(nextGift, [2, 1, 1]);
  assert.equal(inventory.getFreeSlots(), 0, "the hand-in plus gift fits exactly");
  // Interrupt after the hand-in but before its later canonical receive action.
  const chatbox = learner.getPacketSender().getChatboxGroupId();
  assert.ok(chatbox >= 0); learner.getPacketSender().closeInterface(chatbox);
  click(learner, senior, "Talk-to"); await drive(learner, senior);
  assert.equal(learner.getAttribute("gnome-restaurant:tutorial-aluft"), 3);
  assert.deepEqual(["chocolate_bar", "chocolate_dust", "gianne_dough"].map((name) => learner.getInventory().getAmount(obj(name))), nextGift,
    "reopening neither consumes the old food again nor repeats the handout");
  inventory.deleteNumber(filler, fillerCount - 1);
  use(learner, "gianne_dough", "crunchy_tray");
  cook(learner, "raw_crunchies", "half_baked_crunchy");
  await prepare(learner, "half_baked_crunchy", "Prepare", 3, 9577);
  cook(learner, 9577, 9578);
  assert.equal(learner.getInventory().getAmount(obj("crunchy_tray")), 1);
  use(learner, 9578, "chocolate_dust");
  assert.equal(learner.getInventory().getAmount(obj("chocchip_crunchies")), 1);
  await handIn(learner, senior, "gnome-restaurant:tutorial-aluft", 4, "You give Aluft the chocolate crunchies. He takes a bite...");
  click(learner, senior, "Talk-to");
  await drive(learner, senior, { options: ["I'm afraid I've lost the batta tin you gave to me.", "Goodbye."], index: 1 });
  assert.equal(learner.getAttribute("gnome-restaurant:tutorial-aluft"), 4);
  assert.equal(learner.getInventory().getAmount(obj("batta_tin")), 1, "the registered missing-tin dialogue supplies the tin");
  use(learner, "gianne_dough", "batta_tin");
  cook(learner, "raw_batta", "half_baked_batta");
  await prepare(learner, "half_baked_batta", "Prepare", 1, 9482);
  cook(learner, 9482, "toad_batta");
  assert.equal(learner.getInventory().getAmount(obj("batta_tin")), 1);
  await handIn(learner, senior, "gnome-restaurant:tutorial-aluft", 5, "You give Aluft the toad batta. He takes a bite...");
  use(learner, "gianne_dough", "batta_tin");
  cook(learner, "raw_batta", "half_baked_batta");
  await prepare(learner, "half_baked_batta", "Prepare", 4, 9483);
  cook(learner, 9483, 9484);
  assert.equal(learner.getInventory().getAmount(obj("batta_tin")), 1);
  use(learner, 9484, "equa_leaves");
  assert.equal(learner.getInventory().getAmount(obj("cheese+tom_batta")), 1);
  await handIn(learner, senior, "gnome-restaurant:tutorial-aluft", 6, "You give Aluft the batta. He sniffs it then takes a bite...");
  assert.equal(learner.getAttribute("gnome-restaurant:tutorial-blurberry") ?? 0, 0);
  await missingRecommendations(learner);
  click(learner, blurberry, "Talk-to");
  await drive(learner, blurberry, { options: ["No thanks, I prefer to stay this side of the bar.", "Ok then I'll give it a go."], index: 2 });
  assert.equal(learner.getAttribute("gnome-restaurant:tutorial-blurberry"), 1);
  click(learner, blurberry, "Talk-to"); await drive(learner, blurberry);
  assert.equal(learner.getAttribute("gnome-restaurant:tutorial-blurberry"), 2);
  // Funch's source stock includes glasses; this fixture supplies the three
  // extra raw containers directly, not finished cocktails or a shop purchase.
  assert.ok(learner.getInventory().getFreeSlots() >= 3);
  learner.getInventory().add(new core.Item(obj("cocktail_glass_empty"), 3), true);
  await prepare(learner, "cocktail_shaker", "Mix-cocktail", 0, 9568);
  await cut(learner, "lemon", "Slice", "lemon_slices");
  pour(learner, 9568, "fruit_blast", [["lemon_slices", 1]], 20);
  await handIn(learner, blurberry, "gnome-restaurant:tutorial-blurberry", 3, "You give Blurberry the Fruit Blast. He takes a sip...");
  await prepare(learner, "cocktail_shaker", "Mix-cocktail", 1, 9569);
  await cut(learner, "pineapple", "Dice", "pineapple_chunks");
  await cut(learner, "lime", "Dice", "lime_chunks");
  await cut(learner, "orange", "Slice", "orange_slices");
  pour(learner, 9569, "pineapple_punch", [["lime_chunks", 1], ["pineapple_chunks", 1], ["orange_slices", 1]], 40);
  await handIn(learner, blurberry, "gnome-restaurant:tutorial-blurberry", 4, "You give Blurberry the Pineapple Punch. He takes a sip...");
  await prepare(learner, "cocktail_shaker", "Mix-cocktail", 2, 9566);
  await cut(learner, "pineapple", "Dice", "pineapple_chunks");
  await cut(learner, "lime", "Slice", "lime_slices");
  pour(learner, 9566, "wizard_blizzard", [["pineapple_chunks", 1], ["lime_slices", 1]], 80);
  await handIn(learner, blurberry, "gnome-restaurant:tutorial-blurberry", 5, "You give Blurberry the Wizard Blizzard. He takes a sip...");
  await prepare(learner, "cocktail_shaker", "Mix-cocktail", 3, 9567);
  await cut(learner, "lime", "Slice", "lime_slices");
  pour(learner, 9567, "sgg", [["lime_slices", 1], ["equa_leaves", 1]], 90);
  await handIn(learner, blurberry, "gnome-restaurant:tutorial-blurberry", 6, "You give Blurberry the SGG. He takes a sip...");
  // Current 29 is an adapted drain from the deterministic level-99 producer setup.
  skills.setCurrentLevels(Skill.COOKING, 29);
  let codec;
  require("../plugins/persistence/JsonPlayerPersistence.plugin").register({
    getSkillManager: () => core.SkillManager, setPlayerPersistence: (backend) => { codec = backend; }, log() {},
  });
  const snapshot = JSON.parse(JSON.stringify(PlayerSave.fromPlayer(learner), codec.replacer.bind(codec)), codec.reviver.bind(codec));
  assert.equal(snapshot.attributes["gnome-restaurant:tutorial-aluft"], 6);
  assert.equal(snapshot.attributes["gnome-restaurant:tutorial-blurberry"], 6);
  World.getPlayers().removes(learner);
  const reloaded = actor("gnomereload", null, codec.hydratePlayerSave(snapshot));
  PluginManager.emitPlayerLogin({ player: reloaded, username: reloaded.getUsername(), isNewAccount: false });
  reloaded.needsPlacement = false;
  assert.equal(reloaded.getAttribute("gnome-restaurant:tutorial-aluft"), 6);
  assert.equal(reloaded.getAttribute("gnome-restaurant:tutorial-blurberry"), 6);
  assert.equal(reloaded.getSkillManager().getCurrentLevel(Skill.COOKING), 29);
  // Synthetic reverse half-state isolates the other missing recommendation;
  // the unmodified saved actor above earned both tutorials through actions.
  const reverse = actor("gnomerev", null, codec.hydratePlayerSave(snapshot));
  PluginManager.emitPlayerLogin({ player: reverse, username: reverse.getUsername(), isNewAccount: false }); reverse.needsPlacement = false;
  reverse.setAttribute("gnome-restaurant:tutorial-aluft", 0);
  assert.equal(reverse.getAttribute("gnome-restaurant:tutorial-blurberry"), 6);
  await missingRecommendations(reverse);
  World.getPlayers().removes(reverse);
  const offer = { title: "Do you want to take on an easy or a hard delivery?", options: [
    "I think I'll warm up with an easy one.", "The edge of the world is no limit for Aluft Aloft Food Deliveries!",
    "I've changed my mind, there's something else I need to do now."], index: 1 };
  const take = (tier) => ({ title: "Take this order?", options: [tier === "easy" ? "Easy-peasy! I'll get started." : "Easy-peasy! I'm on the job.",
    tier === "easy" ? "I don't think I can complete this one." : "I won't be able to do this order."], index: 1 });
  async function createAndAbandon(p, option, tier) {
    assert.equal(p.getInventory().getAmount(BOX), 0);
    const coins = p.getInventory().getAmount(COINS), xp = p.getSkillManager().getExperience(Skill.COOKING);
    assert.ok(p.getInventory().getFreeSlots() > 0);
    click(p, junior, option);
    await drive(p, junior, option === "Talk-to" ? [offer, take(tier)] : [take(tier)]);
    assert.equal(sessionOf(p)?.tier, tier, `${option} created a real order`);
    assert.equal(p.getInventory().getAmount(BOX), 1);
    assert.equal(p.getInventory().getAmount(COINS), coins);
    assert.equal(p.getSkillManager().getExperience(Skill.COOKING), xp);
    World.getPlayers().removes(p);
    assert.equal(sessionOf(p), undefined, "logout abandons the actual order");
    assert.equal(p.getInventory().getAmount(BOX), 0);
    assert.equal(p.getInventory().getAmount(COINS), coins);
    assert.equal(p.getSkillManager().getExperience(Skill.COOKING), xp);
  }
  await createAndAbandon(reloaded, "Talk-to", "easy");
  const easy = actor("gnomeeasy", null, codec.hydratePlayerSave(snapshot));
  PluginManager.emitPlayerLogin({ player: easy, username: easy.getUsername(), isNewAccount: false }); easy.needsPlacement = false;
  await createAndAbandon(easy, "Get job (easy)", "easy");
  const hard = actor("gnomehard", null, codec.hydratePlayerSave(snapshot));
  PluginManager.emitPlayerLogin({ player: hard, username: hard.getUsername(), isNewAccount: false }); hard.needsPlacement = false;
  await createAndAbandon(hard, "Get job (hard)", "hard");
});
