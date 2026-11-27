// Run after `yarn build`: node --test tests/shantay-pass.test.cjs
const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Location } = require("../dist/game/model/Location");

const Common = require("../plugins/areas/shantaypass/Common.ShantayPass");
const attachGate = require("../plugins/areas/shantaypass/Gate.ShantayPass");
const Shantay = require("../plugins/areas/shantaypass/Shantay.ShantayPass");
const Jail = require("../plugins/areas/shantaypass/Jail.ShantayPass");
// The desert warning is the WarningScreens plugin's (cws_warning_10).
const WarningScreens = require("../plugins/world/warningscreens/Screens.WarningScreens");

const SHANTAY_PASS = 1854;
const COINS = 995;
const WARNING = 565;

const tasks = [];
const hooks = {};
const answers = { quests: new Set(), diaries: new Set(), ultimate: false };
const events = [];
const core = { ...PluginManager.getCoreApi(), TaskManager: { submit: (task) => tasks.push(task) } };
const api = {
  core,
  persistAttribute() {},
  onObjectInteraction: (_name, actions) => { hooks.gate = actions; },
  onNpcInteraction: (name, actions) => { hooks[name] = actions; },
  onInterfaceActionClick: (handler) => { hooks.click = handler; },
  onPlayerLogin() {},
  emitCustomEvent(name, payload) {
    events.push({ name, payload });
    if (name === "quest:is-complete") payload.complete = answers.quests.has(payload.key);
    if (name === "quest:is-started") payload.started = answers.quests.has(payload.key);
    if (name === "diary:is-complete") payload.complete = answers.diaries.has(payload.tier);
    if (name === "ironman:mode") payload.mode = answers.ultimate ? "ultimate" : "none";
    if (name === "warning-screen:show") WarningScreens.show(payload);
  },
};
Common.init(api);
attachGate(api);
hooks.click = WarningScreens.click;

function runTasks() {
  for (let guard = 0; guard < 50 && tasks.length; guard++) {
    const due = tasks.splice(0);
    for (const task of due) task.execute();
  }
}

function createPlayer({ at = [3303, 3117], items = {}, bank = 0 } = {}) {
  const log = [];
  const attributes = new Map();
  let location = new Location(at[0], at[1], 0);
  const inventory = new Map(Object.entries(items).map(([id, amount]) => [Number(id), amount]));
  const sender = new Proxy({}, {
    get: (_target, name) => (...args) => {
      log.push(`${String(name)} ${args.filter((arg) => typeof arg !== "object").join(" ")}`.trim());
      return sender;
    },
  });
  return {
    log,
    getPacketSender: () => sender,
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    sendMessage: (message) => log.push(`message ${message}`),
    getLocation: () => location,
    setLocation: (to) => { location = to; },
    setWalkingDirection() {},
    setPositionToFace() {},
    getMovementQueue: () => ({ reset() {}, handleRegionChange() {}, setBlockMovement() {} }),
    getDialogueManager: () => ({ startDialogues: () => log.push("dialogue") }),
    getEquipment: () => ({ get: () => null }),
    getInventory: () => ({
      getAmount: (id) => inventory.get(id) ?? 0,
      deleteNumber: (id, amount) => inventory.set(id, (inventory.get(id) ?? 0) - amount),
      getFreeSlots: () => 27,
      refreshItems() {},
    }),
    getBanks: () => [{ getAmount: (id) => (id === COINS ? bank : 0) }],
    getAppearance: () => ({ isMale: () => true }),
    amount: (id) => inventory.get(id) ?? 0,
  };
}

const proceed = (player) => hooks.click({ player, groupId: WARNING, childId: 17 });

test("the gate guard turns back a player without a pass", () => {
  const player = createPlayer();
  hooks.gate["Go-through"]({ player });
  runTasks();
  assert.ok(player.log.includes("dialogue"));
  assert.deepEqual([player.getLocation().getX(), player.getLocation().getY()], [3303, 3117]);
});

test("the desert warning counts up to 6, then offers to stop; off at 7", () => {
  const player = createPlayer({ items: { [SHANTAY_PASS]: 10 } });
  for (let shown = 1; shown <= 6; shown++) {
    player.log.length = 0;
    player.setLocation(new Location(3303, 3117, 0));
    hooks.gate["Go-through"]({ player });
    runTasks();
    assert.ok(player.log.includes(`sendVarbit 3860 ${shown}`), `showing ${shown}`);
    assert.ok(player.log.includes(`sendInterface ${WARNING}`));
    proceed(player);
    runTasks();
  }
  assert.equal(player.amount(SHANTAY_PASS), 4);
  player.log.length = 0;
  player.setLocation(new Location(3303, 3117, 0));
  hooks.gate["Go-through"]({ player });
  runTasks();
  assert.ok(player.log.includes(`sendInterfaceDisplayState ${(WARNING << 16) | 21} false`), "offers Don't ask me this again");
  hooks.click({ player, groupId: WARNING, childId: 20 });
  assert.ok(player.log.includes("sendVarbit 3860 7"));
  proceed(player);
  runTasks();
  assert.deepEqual([player.getLocation().getX(), player.getLocation().getY()], [3303, 3115]);

  player.log.length = 0;
  player.setLocation(new Location(3303, 3117, 0));
  hooks.gate["Go-through"]({ player });
  runTasks();
  assert.ok(!player.log.includes(`sendInterface ${WARNING}`), "no warning once toggled off");
  assert.ok(player.log.includes("message The guard takes your Shantay Pass as you go through the gate."));
  assert.deepEqual([player.getLocation().getX(), player.getLocation().getY()], [3303, 3115]);
});

test("going north is free, and the elite Desert Diary needs no pass", () => {
  const north = createPlayer({ at: [3304, 3115] });
  hooks.gate["Go-through"]({ player: north });
  runTasks();
  assert.deepEqual([north.getLocation().getX(), north.getLocation().getY()], [3304, 3117]);
  assert.ok(!north.log.some((line) => line.startsWith("message")));

  answers.diaries.add("elite");
  const elite = createPlayer();
  elite.setAttribute("warning-screens:warning-10", 7);
  hooks.gate["Go-through"]({ player: elite });
  runTasks();
  assert.deepEqual([elite.getLocation().getX(), elite.getLocation().getY()], [3303, 3115]);
  answers.diaries.delete("elite");
});

/** The tiles a player stands on, one per forced step, through the gate from `at`. */
function goThroughFrom(at, items = {}) {
  const player = createPlayer({ at, items });
  const steps = [];
  const setLocation = player.setLocation;
  player.setLocation = (to) => {
    steps.push([to.getX(), to.getY()]);
    setLocation(to);
  };
  hooks.gate["Go-through"]({ player });
  runTasks();
  return { player, steps };
}

test("the Ruins of Unkah's east gate takes a pass out into the desert, three steps through", () => {
  const { player, steps } = goThroughFrom([3193, 2843], { [SHANTAY_PASS]: 1 });
  assert.ok(player.log.includes(`sendInterface ${WARNING}`), "the desert warning first");
  assert.deepEqual(steps, []);
  proceed(player);
  runTasks();
  assert.deepEqual(steps, [[3194, 2843], [3195, 2843], [3196, 2843]]);
  assert.equal(player.amount(SHANTAY_PASS), 0);
  assert.ok(player.log.includes("message The guard takes your Shantay Pass as you go through the gate."));

  const back = goThroughFrom([3196, 2843]);
  assert.deepEqual(back.steps, [[3195, 2843], [3194, 2843], [3193, 2843]]);
  assert.ok(!back.player.log.some((line) => line.startsWith("message")), "coming back is free");
});

test("the Ruins of Unkah's south gate leads south on its two open columns", () => {
  const out = createPlayer({ at: [3168, 2819], items: { [SHANTAY_PASS]: 1 } });
  out.setAttribute("warning-screens:warning-10", 7);
  hooks.gate["Go-through"]({ player: out });
  runTasks();
  assert.deepEqual([out.getLocation().getX(), out.getLocation().getY()], [3168, 2816]);
  assert.equal(out.amount(SHANTAY_PASS), 0);

  const back = goThroughFrom([3167, 2816]);
  assert.deepEqual(back.steps, [[3167, 2817], [3167, 2818], [3167, 2819]]);
  // Walls close the outer columns and rows; beside the gate is not at it either.
  for (const at of [[3166, 2819], [3169, 2819], [3169, 2816], [3170, 2819], [3193, 2841], [3193, 2844], [3196, 2844]]) {
    assert.equal(goThroughFrom(at).steps.length, 0, `no crossing from ${at}`);
  }
});

/** One tick's worth of the tasks due. */
function nextTick() {
  for (const task of tasks.splice(0)) task.execute();
}

test("a gate answers on the tick its op runs, then a step a tick", () => {
  const warned = createPlayer({ at: [3303, 3117], items: { [SHANTAY_PASS]: 1 } });
  hooks.gate["Go-through"]({ player: warned });
  assert.ok(warned.log.includes(`sendInterface ${WARNING}`), "the warning on the op's tick");
  tasks.length = 0;

  const player = createPlayer({ at: [3193, 2843], items: { [SHANTAY_PASS]: 1 } });
  player.setAttribute("warning-screens:warning-10", 7);
  const tile = () => [player.getLocation().getX(), player.getLocation().getY()];
  hooks.gate["Go-through"]({ player });
  assert.deepEqual(tile(), [3194, 2843], "the first step on the op's tick");
  assert.ok(player.log.includes("message The guard takes your Shantay Pass as you go through the gate."));
  nextTick();
  assert.deepEqual(tile(), [3195, 2843]);
  nextTick();
  assert.deepEqual(tile(), [3196, 2843]);
  runTasks();
});

test("without a pass, the Unkah guard turns the player back in their own words", (t) => {
  const lines = t.mock.method(Common, "npcLine", () => {});
  const { player, steps } = goThroughFrom([3193, 2842]);
  assert.deepEqual(steps, []);
  assert.ok(!player.log.includes(`sendInterface ${WARNING}`));
  assert.deepEqual(lines.mock.calls[0].arguments.slice(1), [
    10634,
    "You need a Shantay pass to get through this gate. I'll sell you one for a very reasonable price.",
  ]);
  goThroughFrom([3303, 3117]);
  assert.equal(lines.mock.calls[1].arguments[1], 4648, "the main gate keeps its own guard");
});

test("Look-at reads each gate's own billboard", () => {
  const read = (location) => {
    const texts = [];
    const original = core.StatementDialogue;
    core.StatementDialogue = class extends original {
      constructor(index, text) {
        super(index, text);
        texts.push(text);
      }
    };
    try {
      const player = createPlayer();
      player.getDialogueManager = () => ({ startDialogues() {} });
      hooks.gate["Look-at"]({ player, location });
    } finally {
      core.StatementDialogue = original;
    }
    return texts;
  };
  const east = read({ x: 3194, y: 2841, z: 0 });
  assert.equal(east[0], "You look at the huge dilapidated gate.<br>Near the gate is a large billboard poster, it reads:");
  assert.equal(east.length, 3);
  assert.match(east[1], /The Desert is a VERY Dangerous place/);
  assert.equal(east[2], "Despite this warning lots of people seem to pass through the gate.");
  assert.deepEqual(read({ x: 3166, y: 2817, z: 0 }), east);
  const main = read({ x: 3302, y: 3116, z: 0 });
  assert.match(main[0], /huge stone gate/);
  assert.deepEqual(main.slice(1), east.slice(1));
});

test("Shantay's conditions follow the player's coins, bank, visits and escapes", () => {
  const player = createPlayer({ items: { [COINS]: 3 }, bank: 100 });
  let answered = Shantay.conditions(player);
  assert.equal(answered["The first time talking to Shantay:"], true);
  assert.equal(answered["If the player does not have 5 coins in their inventory:"], true);
  assert.equal(answered["If the player has 5 coins in their bank:"], true);
  assert.equal(answered["If the player is not in trouble with Shantay:"], true);
  answers.ultimate = true;
  answered = Shantay.conditions(player);
  assert.equal(answered["If the player has 5 coins in their bank:"], false);
  assert.equal(answered["If the player does not have 5 coins in their bank, or they are an Ultimate Ironman:"], true);
  answers.ultimate = false;
  player.setAttribute(Common.MET_ATTRIBUTE, true);
  player.setAttribute(Common.ESCAPED_ATTRIBUTE, true);
  answered = Shantay.conditions(player);
  assert.equal(answered["Subsequent times talking to Shantay:"], true);
  assert.equal(answered["If the player has escaped from the \"Maximum security prison\" or from the Shantay Pass jail:"], true);
});

test("every condition and action in Shantay's transcript is one this plugin knows", () => {
  const dialogue = JSON.parse(fs.readFileSync(path.join(__dirname, "../data/definitions/npc-dialogues.json"), "utf8")).Shantay;
  const known = Object.keys(Shantay.conditions(createPlayer()));
  const texts = [...JSON.stringify(dialogue).matchAll(/"(?:text|condition)":"((?:If|The first|Subsequent|In Leagues)[^"\\]*(?:\\.[^"\\]*)*:)"/g)]
    .map((match) => JSON.parse(`"${match[1]}"`));
  assert.ok(texts.length > 10);
  for (const text of texts) assert.ok(known.includes(text), text);
  for (const variant of ["arrested", "buy-pass-dialogue", "interacting-with-the-prison-door-while-locked-in-the-shantay-pass-jail"]) {
    assert.ok(dialogue.variants[variant], variant);
  }
  assert.ok(!JSON.stringify(dialogue).includes('"reference":"above"'), "no jumps left to resolve");
});

test("several Pick-lock clicks pick the Port Sarim lock as one attempt chain, not one each", (t) => {
  t.mock.method(Math, "random", () => 1); // every attempt fails, however easy the lock gets
  const attempts = (clicks) => {
    const player = createPlayer({ at: [3014, 3181] });
    player.performAnimation = () => {};
    player.isRegistered = () => true;
    player.getSkillManager = () => ({ getCurrentLevel: () => 1, getMaxLevel: () => 1, addExperiences() {} }); // best chance 82%
    const door = { player, objectId: 9565, location: { x: 3014, y: 3182, z: 0 } };
    for (let i = 0; i < clicks; i++) Jail.pickPortSarimLock(door);
    runTasks();
    return player.log.filter((line) => line === "message You attempt to pick the lock on the door.").length;
  };
  const one = attempts(1);
  assert.ok(one > 0, "the attempts run");
  assert.equal(attempts(3), one, "three clicks make the same attempts as one");
});

test("the Port Sarim lock gets easier with each failure and with a lockpick", () => {
  const withLevel = (level, items = {}) => ({
    ...createPlayer({ items }),
    getSkillManager: () => ({ getCurrentLevel: () => level }),
  });
  assert.equal(Jail.pickChance(withLevel(1), 0), 0);
  assert.ok(Math.abs(Jail.pickChance(withLevel(99), 0) - 0.39) < 1e-9);
  assert.ok(Math.abs(Jail.pickChance(withLevel(1), 4) - 0.82) < 1e-9);
  assert.ok(Math.abs(Jail.pickChance(withLevel(1, { 1523: 1 }), 0) - 0.23) < 1e-9);
});


// The real Buy-pass producer and inventory capacity, separate from the legacy gate mocks above.
test("native Shantay purchases charge only when a pass can be delivered", async t => {
  process.env.DISABLE_PLAYER_BOTS = "1";
  const path = require("node:path");
  const { CachePipeline } = require("../dist/game/cache/CachePipeline");
  const { Player } = require("../dist/game/entity/impl/player/Player");
  const { PlayerSession } = require("../dist/net/PlayerSession");
  const { ClientConnection } = require("../dist/net/NetworkBuilder");
  await CachePipeline.initialize();
  const native = PluginManager.getCoreApi();
  PluginManager.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  native.RegionManager.init(); native.RegionManager.loadMapFiles(3226, 3218);
  PluginManager.emitServerStartup({});
  t.after(() => PluginManager.emitServerShutdown({}));
  const MAX = 0x7fffffff, PRICE = 5, PASS = native.ItemIdentifiers.SHANTAY_PASS;
  assert.equal(PASS, SHANTAY_PASS);
  assert.equal(native.ItemDefinition.forId(PASS).isStackable(), true, "active-cache pass is stackable");
  assert.equal(native.WorldDefinition.isMembersWorld(), true, "the real members-only service must be available");
  let nextIndex = 1940;
  for (const mode of ["ordinary", "last stack space", "short wallet", "full pack", "capped stack"]) await t.test(mode, async t => {
    const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
      close() {}, onData() {}, onError() {}, onClose() {} };
    const player = new Player(new PlayerSession(channel));
    player.setIndex(nextIndex++); player.setUsername("passbuyer" + player.getIndex());
    player.setRegistered(true); player.setLocation(new native.Location(3226, 3218, 0)); player.needsPlacement = false;
    const connection = new ClientConnection(channel); connection.player = player;
    const npc = native.NPC.create(native.NpcIdentifiers.SHANTAY, new native.Location(3227, 3218, 0));
    assert.equal(native.World.getNpcs().add(npc), true);
    assert.equal(npc.getId(), 4642); assert.equal(npc.getCurrentDefinition(player).getName(), "Shantay");
    t.after(() => {
      player.closeInterruptibleInterfaces();
      PluginManager.emitPlayerDisconnect({ player, username: player.getUsername() });
      PluginManager.emitPlayerLogout({ player, username: player.getUsername() });
      player.setRegistered(false); native.TaskManager.cancelTasks(player.getIndex()); native.TaskManager.cancelTasks(player);
      native.World.getNpcs().remove(npc);
      for (const ground of native.World.getItems().filter(g => g.getOwner() === player.getUsername())) native.ItemOnGroundManager.deregister(ground);
    });
    const inv = player.getInventory(), wallet = mode === "short wallet" ? PRICE - 1 : PRICE * 2;
    const capped = mode === "capped stack", near = mode === "last stack space" || capped;
    inv.add(new native.Item(COINS, wallet), false);
    if (near) inv.add(new native.Item(PASS, MAX - 1), false);
    if (mode === "full pack") while (inv.getFreeSlots() > 0) inv.add(new native.Item(native.ItemIdentifiers.LOGS), false);
    const gains = [], skills = player.getSkillManager(), addXp = skills.addExperiences.bind(skills);
    t.mock.method(skills, "addExperiences", (skill, amount) => { gains.push({ skill, amount }); return addXp(skill, amount); });
    const floor = id => native.World.getItems().filter(g => !g.isPendingRemoval() && g.getOwner() === player.getUsername()
      && g.getPrivateArea() === player.getPrivateArea() && g.getItem().getId() === id).reduce((n, g) => n + g.getItem().getAmount(), 0);
    const stores = id => ({ inventory: inv.getAmount(id), equipment: player.getEquipment().getAmount(id),
      bank: player.getBanks().reduce((n, b, tab) => n + (b && tab !== native.Bank.BANK_SEARCH_TAB_INDEX ? b.getAmount(id) : 0), 0), floor: floor(id) });
    const owned = id => Object.values(stores(id)).reduce((n, amount) => n + amount, 0);
    const state = () => ({ mode, coins: stores(COINS), passes: stores(PASS), free: inv.getFreeSlots(), gains: [...gains] });
    let turns = 0;
    const turn = () => {
      assert.ok(++turns <= 16, "bounded native phase budget"); player.resetUpdating();
      native.World.processCycle = (native.World.processCycle + 1) & MAX; native.TaskManager.process();
      connection.processTurnPackets(); const queue = player.getMovementQueue();
      queue.beginCycle(); queue.processEntityPursuit(); if (queue.hasPendingWork()) queue.process();
      native.TaskManager.processWalkTo(player.getIndex());
    };
    const send = async packet => { await connection.dispatch([packet]); turn(); };
    if (capped) {
      const at = player.getLocation(); native.ItemOnGroundManager.registerLocation(player, new native.Item(PASS), at.clone());
      assert.equal(floor(PASS), 1);
      await send({ type: "ground_item_action", itemId: PASS, x: at.getX(), y: at.getY(), option: "Take", optionIndex: 3 });
      for (let n = 0; n < 6 && floor(PASS); n++) turn();
      assert.equal(inv.getAmount(PASS), MAX, "actual native pickup fills the ordinary stack"); assert.equal(floor(PASS), 0);
    }
    assert.equal(player.getDialogueManager().getCurrent(), undefined);
    assert.equal(inv.getAmount(COINS), wallet); assert.deepEqual(gains, []);
    assert.equal(inv.getAddableAmount(new native.Item(PASS)), capped || mode === "full pack" ? 0 : 1);
    if (capped) assert.ok(inv.getFreeSlots() > 0, "a free slot must coexist with the saturated ordinary stack");
    const before = state(), coinsBefore = owned(COINS), passBefore = owned(PASS);
    const messages = [], sendMessage = player.sendMessage.bind(player);
    t.mock.method(player, "sendMessage", message => { messages.push(message); return sendMessage(message); });
    let purchaseActions = 0;
    const emit = PluginManager.emitCustomEvent.bind(PluginManager);
    t.mock.method(PluginManager, "emitCustomEvent", (name, payload) => {
      if (name === "npc-dialogue:action" && payload.player === player && payload.npc === npc
          && payload.kind === "message" && payload.stepId === "crT5RR") purchaseActions++;
      return emit(name, payload);
    });
    const buy = npc.getCurrentDefinition(player).getActions().indexOf("Buy-pass") + 1; assert.ok(buy > 0);
    await send({ type: "npc_option", index: npc.getIndex(), clickType: buy });
    for (let n = 0; n < 6 && !player.getDialogueManager().getCurrent(); n++) turn();
    const current = player.getDialogueManager().getCurrent();
    if (!capped) {
      assert.ok(current, "actual NPC Buy-pass must produce its native result/refusal");
      const sender = player.getPacketSender(), group = sender.getChatboxGroupId(), mount = sender.subInterfaceTargets.get(group);
      assert.ok(group >= 0); assert.ok(mount); assert.equal(sender.getSubInterfaceAt(mount.targetUid), mount, "terminal native chatbox remains mounted");
    }
    const after = state(), details = JSON.stringify({ before, after, dialogue: current?.constructor.name, text: current?.getText?.() });
    if (capped) assert.equal(purchaseActions, 1, "actual Buy-pass purchase action reached once");
    assert.equal(messages.filter(message => message === "You cannot hold any more Shantay passes.").length, capped ? 1 : 0, "capacity refusal message");
    // First target assertion: full-stack refusal must not consume a five-coin fee without delivery.
    assert.equal(owned(COINS) + PRICE * (owned(PASS) - passBefore), coinsBefore, "paid pass conservation: " + details);
    const success = mode === "ordinary" || mode === "last stack space";
    assert.equal(owned(PASS), passBefore + (success ? 1 : 0), details);
    assert.equal(owned(COINS), wallet - (success ? PRICE : 0), details);
    if (success) {
      assert.equal(current instanceof native.ItemStatementDialogue, true, "purchase uses the actual native item box");
      assert.equal(current.getText(), "You purchase a Shantay Pass.");
    }
    assert.deepEqual(gains, []);
  });
});
