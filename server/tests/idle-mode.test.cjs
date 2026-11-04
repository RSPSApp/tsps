// Idle Mode (docs/idle-mode.md) against a stand-in plugin api: the account flag and ::idle, the
// endless gathering's answers to the skills' events, and the offline progress measured from
// `storage:gather` and paid on the next login. It needs no cache, so it runs anywhere.
const assert = require("node:assert/strict");
const { test, beforeEach } = require("node:test");

const PLUGIN = "../plugins/modes/IdleMode.plugin";
const OFFLINE = "../plugins/modes/idle/Offline.IdleMode";

function skill(index) {
  return { getIndex: () => index };
}

const Skill = { WOODCUTTING: skill(8), FISHING: skill(10), MINING: skill(14), COOKING: skill(7) };
const LOGS = 1511;
const YEW_LOGS = 1515;

class Item {
  constructor(id, amount = 1) {
    this.id = id;
    this.amount = amount;
  }
  getId() { return this.id; }
  getAmount() { return this.amount; }
}

function fakeApi(config = {}) {
  const handlers = { login: [], logout: [], events: {}, commands: {} };
  const api = {
    core: {
      Skill,
      Item,
      Bank: { getTabForItem: () => 0 },
      ItemDefinition: { forId: (id) => ({ getName: () => (id === YEW_LOGS ? "Yew logs" : "Logs") }) },
      PlayerRights: { NONE: { name: "none" } },
      Location: FakeLocation,
      ObjectManager: { objectsAt: (location) => world.objects.filter((o) => o.at.x === location.getX() && o.at.y === location.getY() && o.at.z === location.getZ()) },
      World: { getNpcsNear: (location, radius) => world.npcs.filter((n) => Math.max(Math.abs(n.at.x - location.getX()), Math.abs(n.at.y - location.getY())) <= radius) },
      Task: class { constructor(delay) { this.delay = delay; } },
      TaskManager: { submit: (task) => world.tasks.push(task) },
    },
    interactions: [],
    persisted: {},
    getPluginConfig: (key, fallback) => (key in config ? config[key] : fallback),
    persistAttribute: (key, value) => { api.persisted[key] = value; },
    onPlayerLogin: (handler) => handlers.login.push(handler),
    onPlayerLogout: (handler) => handlers.logout.push(handler),
    onCustomEvent: (name, handler) => (handlers.events[name] ??= []).push(handler),
    onBeforeObjectInteraction: (handler) => (handlers.events["before-object"] ??= []).push(handler),
    onBeforeNpcInteraction: (handler) => (handlers.events["before-npc"] ??= []).push(handler),
    onServerStartup: (handler) => (handlers.events.startup ??= []).push(handler),
    emitObjectInteraction: (event) => { api.interactions.push({ kind: "object", ...event }); return true; },
    emitNpcInteraction: (event) => { api.interactions.push({ kind: "npc", ...event }); return true; },
    registerCommand: (name, handler, rights) => { handlers.commands[name] = { handler, rights }; },
    emit(name, payload) {
      for (const handler of handlers.events[name] ?? []) handler(payload);
      return payload;
    },
    login: (event) => handlers.login.forEach((handler) => handler(event)),
    logout: (event) => handlers.logout.forEach((handler) => handler(event)),
    command: (player, raw) => handlers.commands[raw.split(" ")[0]].handler({ player, raw, parts: raw.split(" ") }),
    handlers,
  };
  return api;
}

class FakeLocation {
  constructor(x, y, z = 0) {
    this.x = x;
    this.y = y;
    this.z = z;
  }
  getX() { return this.x; }
  getY() { return this.y; }
  getZ() { return this.z; }
}

/** The stand-in world the auto-resume searches: objects and NPCs by name, with their options. */
const world = { objects: [], npcs: [], tasks: [] };

function fakeObject(name, options, x, y, z = 0) {
  const at = { x, y, z };
  return { at, getId: () => 1276, getLocation: () => new FakeLocation(x, y, z), getDefinition: () => ({ getName: () => name, getInteractions: () => options }) };
}

function fakeNpc(name, actions, x, y, z = 0) {
  const at = { x, y, z };
  return { at, getId: () => 1530, getIndex: () => 7, isRegistered: () => true, getLocation: () => new FakeLocation(x, y, z), getDefinition: () => ({ getName: () => name, getActions: () => actions }) };
}

function fakePlayer({ bankSlots = 800 } = {}) {
  const attributes = new Map();
  const bank = new Map();
  const xp = new Map();
  const messages = [];
  const container = {
    getFreeSlots: () => bankSlots - bank.size,
    contains: (id) => bank.has(id),
    add: (item) => bank.set(item.getId(), (bank.get(item.getId()) ?? 0) + item.getAmount()),
  };
  const walks = [];
  let location = new FakeLocation(3200, 3200, 0);
  return {
    bank,
    xp,
    messages,
    walks,
    moving: 0,
    isBusy: false,
    fighting: false,
    moveTo(x, y, z = 0) { location = new FakeLocation(x, y, z); },
    getLocation: () => location,
    isRegistered: () => true,
    busy() { return this.isBusy; },
    getCombat() { return { getTarget: () => (this.fighting ? {} : null), getAttacker: () => null }; },
    setPositionToFace() {},
    getMovementQueue() {
      const player = this;
      return {
        size: () => player.moving,
        walkToObject: (object, action) => { walks.push(object); action.execute(); },
        walkToEntity: (npc, arrive) => { walks.push(npc); arrive(); },
      };
    },
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    getBank: () => container,
    getSkillManager: () => ({
      getExperience: (s) => xp.get(s) ?? 0,
      addExperience: (s, amount) => xp.set(s, (xp.get(s) ?? 0) + amount),
    }),
    sendMessage: (message) => messages.push(message),
  };
}

let api;

function load(config) {
  for (const key of Object.keys(require.cache)) if (key.includes("/plugins/modes/")) delete require.cache[key];
  api = fakeApi(config);
  world.objects = [];
  world.npcs = [];
  world.tasks = [];
  require(PLUGIN).register(api);
  return api;
}

beforeEach(() => load());

/** One chop: the XP lands, then the skill's `storage:gather` for the log. */
function chop(player, itemId = LOGS, xp = 25) {
  player.xp.set(Skill.WOODCUTTING, (player.xp.get(Skill.WOODCUTTING) ?? 0) + xp);
  return api.emit("storage:gather", { player, itemId, amount: 1, stored: 0, skill: Skill.WOODCUTTING, xp });
}

test("the flag is saved with the account, off by default, and ::idle switches it", () => {
  assert.equal(api.persisted["idle-mode:enabled"], false);
  assert.equal(api.persisted["idle-mode:away"], null);
  const player = fakePlayer();
  api.command(player, "idle");
  assert.match(player.messages.pop(), /off/);
  api.command(player, "idle on");
  assert.equal(player.getAttribute("idle-mode:enabled"), true);
  assert.match(player.messages.pop(), /Idle Mode is on/);
  api.command(player, "idle off");
  assert.equal(player.getAttribute("idle-mode:enabled"), false);
  api.command(player, "idle maybe");
  assert.match(player.messages.pop(), /::idle on, ::idle off or ::idle auto/);
  assert.equal(api.handlers.commands.idle.rights, api.core.PlayerRights.NONE, "every player may run it");
});

test("an idle world makes new accounts idle; old accounts and plain worlds are left alone", () => {
  const plain = fakePlayer();
  api.login({ player: plain, isNewAccount: true });
  assert.notEqual(plain.getAttribute("idle-mode:enabled"), true);

  load({ "IdleMode:newAccounts": true });
  const fresh = fakePlayer();
  api.login({ player: fresh, isNewAccount: true });
  assert.equal(fresh.getAttribute("idle-mode:enabled"), true);
  const returning = fakePlayer();
  api.login({ player: returning, isNewAccount: false });
  assert.notEqual(returning.getAttribute("idle-mode:enabled"), true);
});

test("an idle player's gathering goes to the bank, and the bank's room keeps a full inventory going", () => {
  const player = fakePlayer();
  player.setAttribute("idle-mode:enabled", true);
  const request = chop(player);
  assert.equal(request.stored, 1);
  assert.equal(player.bank.get(LOGS), 1);
  assert.equal(api.emit("storage:room", { player, itemId: LOGS, skill: Skill.WOODCUTTING, room: false }).room, true);

  // What an open container already took stays there; only the rest is banked.
  const partial = api.emit("storage:gather", { player, itemId: LOGS, amount: 3, stored: 2, skill: Skill.WOODCUTTING, xp: 0 });
  assert.equal(partial.stored, 3);
  assert.equal(player.bank.get(LOGS), 2);
});

test("a full bank, another skill or a non-idle player gathers as usual", () => {
  const full = fakePlayer({ bankSlots: 0 });
  full.setAttribute("idle-mode:enabled", true);
  assert.equal(chop(full).stored, 0);
  assert.equal(api.emit("storage:room", { player: full, itemId: LOGS, skill: Skill.WOODCUTTING, room: false }).room, false);

  const idle = fakePlayer();
  idle.setAttribute("idle-mode:enabled", true);
  assert.equal(api.emit("storage:gather", { player: idle, itemId: 315, amount: 1, stored: 0, skill: Skill.COOKING, xp: 0 }).stored, 0);

  const normal = fakePlayer();
  assert.equal(chop(normal).stored, 0);
  assert.equal(normal.bank.size, 0);
});

test("trees, rocks and fishing spots stay for idle players, and random events skip them", () => {
  const idle = fakePlayer();
  idle.setAttribute("idle-mode:enabled", true);
  const normal = fakePlayer();
  for (const name of ["woodcutting:deplete-tree", "mining:deplete-rock", "fishing:spot-stays"]) {
    assert.equal(api.emit(name, { player: idle, handled: false }).handled, true, name);
    assert.equal(api.emit(name, { player: normal, handled: false }).handled, false, name);
  }
  assert.equal(api.emit("random-events:eligibility", { player: idle, allowed: null }).allowed, false);
  assert.equal(api.emit("random-events:eligibility", { player: normal, allowed: null }).allowed, null);
  // Another plugin's answer stands.
  assert.equal(api.emit("random-events:eligibility", { player: idle, allowed: true }).allowed, true);
  // An idle skill's level-up pop-up does not hold the gathering; others' still do.
  assert.equal(api.emit("level-up:interrupts", { player: idle, skill: Skill.MINING, interrupts: true }).interrupts, false);
  assert.equal(api.emit("level-up:interrupts", { player: idle, skill: Skill.COOKING, interrupts: true }).interrupts, true);
  assert.equal(api.emit("level-up:interrupts", { player: normal, skill: Skill.MINING, interrupts: true }).interrupts, true);
});

test("offline: logging out mid-session pays the time away at the measured rate", (t) => {
  let now = 1_000_000;
  t.mock.method(Date, "now", () => now);
  const player = fakePlayer();
  player.setAttribute("idle-mode:enabled", true);
  // A log every 6 seconds for two minutes: 20 measured logs, 500 XP, after the first.
  for (let i = 0; i <= 20; i++) {
    chop(player);
    if (i < 20) now += 6000;
  }
  api.logout({ player });
  const away = player.getAttribute("idle-mode:away");
  assert.deepEqual(away, { skill: "WOODCUTTING", durationMs: 120_000, xp: 500, items: { [LOGS]: 20 }, loggedOutAt: now });

  now += 60 * 60 * 1000; // one hour away: 30 times the session
  const xpBefore = player.xp.get(Skill.WOODCUTTING);
  const bankBefore = player.bank.get(LOGS);
  api.login({ player });
  assert.equal(player.xp.get(Skill.WOODCUTTING) - xpBefore, 15_000);
  assert.equal(player.bank.get(LOGS) - bankBefore, 600);
  assert.equal(player.getAttribute("idle-mode:away"), null, "paid once");
  assert.match(player.messages.join("\n"), /While you were away for 1h 0m, you kept woodcutting:\n15,000 Woodcutting XP, 600 x Logs to your bank\./);

  api.login({ player });
  assert.equal(player.bank.get(LOGS) - bankBefore, 600, "a second login pays nothing");
});

test("offline: the cap limits the time paid and says so", (t) => {
  const { offlineReward } = require(OFFLINE);
  const away = { skill: "WOODCUTTING", durationMs: 60_000, xp: 100, items: { [YEW_LOGS]: 2 }, loggedOutAt: 0 };
  const config = { capHours: 12, efficiency: 1 };
  const reward = offlineReward(away, 48 * 3600 * 1000, config);
  assert.equal(reward.paidMs, 12 * 3600 * 1000);
  assert.equal(reward.items[YEW_LOGS], 1440);
  assert.equal(reward.xp, 72_000);
  assert.equal(offlineReward(away, 3600 * 1000, { capHours: 12, efficiency: 0.5 }).items[YEW_LOGS], 60, "efficiency scales it");

  let now = 0;
  t.mock.method(Date, "now", () => now);
  const player = fakePlayer();
  player.setAttribute("idle-mode:away", away);
  now = 48 * 3600 * 1000;
  api.login({ player });
  assert.match(player.messages[0], /capped at 12h/);
});

test("offline: too short, stale or interrupted sessions leave nothing", (t) => {
  let now = 0;
  t.mock.method(Date, "now", () => now);
  const player = fakePlayer();
  player.setAttribute("idle-mode:enabled", true);
  chop(player);
  now += 30_000;
  chop(player);
  api.logout({ player });
  assert.equal(player.getAttribute("idle-mode:away"), null, "under a minute measured");

  for (let i = 0; i <= 20; i++) {
    chop(player);
    now += 6000;
  }
  now += 120_000;
  api.logout({ player });
  assert.equal(player.getAttribute("idle-mode:away"), null, "stopped gathering two minutes before logging out");

  const normal = fakePlayer();
  for (let i = 0; i <= 20; i++) {
    chop(normal);
    now += 6000;
  }
  api.logout({ player: normal });
  assert.equal(normal.getAttribute("idle-mode:away"), null, "not idle");
});

test("offline: a long gap or another skill starts a new session", () => {
  const { addGather } = require(OFFLINE);
  const config = { maxGapSeconds: 60 };
  let session = addGather(null, { skill: Skill.WOODCUTTING, itemId: LOGS, amount: 1 }, 0, 0, config);
  session = addGather(session, { skill: Skill.WOODCUTTING, itemId: LOGS, amount: 1 }, 5000, 25, config);
  assert.deepEqual(session.items, { [LOGS]: 1 });
  const fishing = addGather(session, { skill: Skill.FISHING, itemId: 317, amount: 1 }, 6000, 0, config);
  assert.equal(fishing.skill, Skill.FISHING);
  assert.deepEqual(fishing.items, {});
  const late = addGather(fishing, { skill: Skill.FISHING, itemId: 317, amount: 1 }, 6000 + 61_000, 0, config);
  assert.equal(late.firstAt, 67_000);
});

test("offline: a full bank loses what does not fit, and says so", (t) => {
  let now = 0;
  t.mock.method(Date, "now", () => now);
  const player = fakePlayer({ bankSlots: 0 });
  player.setAttribute("idle-mode:away", { skill: "WOODCUTTING", durationMs: 60_000, xp: 100, items: { [LOGS]: 10 }, loggedOutAt: 0 });
  now = 60_000;
  api.login({ player });
  assert.equal(player.xp.get(Skill.WOODCUTTING), 100, "the XP is still paid");
  assert.match(player.messages.join("\n"), /bank was full: 10 items were lost/);
});

const AUTO = "../plugins/modes/idle/Auto.IdleMode";

/** An idle player who clicked "Chop down" on a willow at (3200, 3201) and got a log from it. */
function choppingWillow(t) {
  let now = 1_000_000;
  t.mock.method(Date, "now", () => now);
  const player = fakePlayer();
  player.setAttribute("idle-mode:enabled", true);
  const willow = fakeObject("Willow tree", ["Chop down", null, null, null, "Examine"], 3200, 3201);
  world.objects.push(willow);
  api.emit("before-object", { player, object: willow, objectId: 1276, clickType: 1, handled: false });
  chop(player);
  return { player, willow, advance: (ms) => (now += ms), now: () => now };
}

test("auto: the click that led to a gather becomes the target, saved with the account", (t) => {
  assert.equal(api.persisted["idle-mode:auto-target"], null);
  assert.equal(api.persisted["idle-mode:auto"], true, "on unless turned off");
  const { player } = choppingWillow(t);
  assert.deepEqual(player.getAttribute("idle-mode:auto-target"), {
    skill: "WOODCUTTING", kind: "object", name: "Willow tree", option: "Chop down", anchor: { x: 3200, y: 3200, z: 0 },
  });
  api.command(player, "idle auto");
  assert.match(player.messages.pop(), /Auto-resume is on: chop down the nearest willow tree here\./);
});

test("auto: when the gathering stops it walks to the nearest same tree and chops it", (t) => {
  const { player, advance } = choppingWillow(t);
  const { resume } = require(AUTO);
  const far = fakeObject("Willow tree", ["Chop down"], 3210, 3210);
  const near = fakeObject("Willow tree", ["Chop down"], 3198, 3199);
  const oak = fakeObject("Oak tree", ["Chop down"], 3200, 3199);
  world.objects.push(far, near, oak);
  player.moveTo(3199, 3200);

  advance(5000);
  assert.equal(resume(player, Date.now()), "gathering", "a log 5s ago: still chopping");
  advance(10_000);
  assert.equal(resume(player, Date.now()), "resumed");
  assert.equal(player.walks.at(-1), near);
  const used = api.interactions.at(-1);
  assert.equal(used.object, near);
  assert.equal(used.clickType, 1, "Chop down, as a click would send it");
  assert.equal(resume(player, Date.now()), "gathering", "waits before trying again");
});

test("auto: busy, moving, fighting, walked away or turned off leaves the player be", (t) => {
  const { player, advance } = choppingWillow(t);
  const { resume } = require(AUTO);
  advance(20_000);
  player.isBusy = true;
  assert.equal(resume(player, Date.now()), "busy");
  player.isBusy = false;
  player.moving = 3;
  assert.equal(resume(player, Date.now()), "busy");
  player.moving = 0;
  player.fighting = true;
  assert.equal(resume(player, Date.now()), "busy");
  player.fighting = false;
  player.moveTo(3300, 3300);
  assert.equal(resume(player, Date.now()), "away", "too far from where it started");
  player.moveTo(3200, 3200, 1);
  assert.equal(resume(player, Date.now()), "away", "another floor");
  player.moveTo(3200, 3200);
  api.command(player, "idle auto off");
  assert.equal(resume(player, Date.now()), "off");
  api.command(player, "idle auto on");
  player.setAttribute("idle-mode:enabled", false);
  assert.equal(resume(player, Date.now()), "off", "not idle");
  player.setAttribute("idle-mode:enabled", true);
  assert.equal(resume(player, Date.now()), "resumed");
  assert.equal(api.interactions.length, 1);
});

test("auto: no tree of that name in reach waits for one", (t) => {
  const { player, willow, advance } = choppingWillow(t);
  const { resume } = require(AUTO);
  world.objects.splice(world.objects.indexOf(willow), 1);
  advance(20_000);
  assert.equal(resume(player, Date.now()), "none");
});

test("auto: a fishing spot is used with the same option, by its own action list", (t) => {
  let now = 0;
  t.mock.method(Date, "now", () => now);
  const player = fakePlayer();
  player.setAttribute("idle-mode:enabled", true);
  const spot = fakeNpc("Fishing spot", ["Lure", "Bait", null, null, null], 3201, 3200);
  api.emit("before-npc", { player, npc: spot, npcId: 1530, npcIndex: 7, clickType: 2, handled: false });
  api.emit("storage:gather", { player, itemId: 335, amount: 1, stored: 0, skill: Skill.FISHING, xp: 50 });
  assert.equal(player.getAttribute("idle-mode:auto-target").option, "Bait");

  const moved = fakeNpc("Fishing spot", ["Net", "Bait"], 3204, 3203);
  world.npcs.push(moved);
  now += 20_000;
  assert.equal(require(AUTO).resume(player, now), "resumed");
  assert.equal(api.interactions.at(-1).npc, moved);
  assert.equal(api.interactions.at(-1).clickType, 2);
});

test("auto: an old click, a non-idle player or a non-idle skill sets nothing", (t) => {
  let now = 0;
  t.mock.method(Date, "now", () => now);
  const willow = fakeObject("Willow tree", ["Chop down"], 3200, 3201);
  const idle = fakePlayer();
  idle.setAttribute("idle-mode:enabled", true);
  api.emit("before-object", { player: idle, object: willow, objectId: 1276, clickType: 1, handled: false });
  now += 31_000;
  chop(idle);
  assert.equal(idle.getAttribute("idle-mode:auto-target"), undefined, "the click was too long ago");

  const normal = fakePlayer();
  api.emit("before-object", { player: normal, object: willow, objectId: 1276, clickType: 1, handled: false });
  chop(normal);
  assert.equal(normal.getAttribute("idle-mode:auto-target"), undefined);

  const range = fakeObject("Range", ["Cook"], 3200, 3201);
  api.emit("before-object", { player: idle, object: range, objectId: 1, clickType: 1, handled: false });
  api.emit("storage:gather", { player: idle, itemId: 315, amount: 1, stored: 0, skill: Skill.COOKING, xp: 30 });
  assert.equal(idle.getAttribute("idle-mode:auto-target"), undefined);
});

test("auto: a task looks at tracked players from server start, and logout forgets them", (t) => {
  const { player } = choppingWillow(t);
  const { tracked } = require(AUTO);
  assert.ok(tracked.has(player));
  api.emit("startup", {});
  assert.equal(world.tasks.length, 1);
  assert.equal(world.tasks[0].delay, 2);
  api.logout({ player });
  assert.equal(tracked.has(player), false);
  api.login({ player });
  assert.ok(tracked.has(player), "a saved target is tracked again on login");
});
