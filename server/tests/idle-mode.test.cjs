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

const Skill = {
  ATTACK: skill(0), DEFENCE: skill(1), STRENGTH: skill(2), HITPOINTS: skill(3), RANGED: skill(4), MAGIC: skill(6),
  COOKING: skill(7), WOODCUTTING: skill(8), FISHING: skill(10), MINING: skill(14),
};
const SHARK = 385;
const BONES = 526;
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
  const handlers = { login: [], logout: [], events: {}, commands: {}, buttons: {} };
  const api = {
    core: {
      Skill,
      Item,
      Bank: { getTabForItem: () => 0 },
      ItemDefinition: { forId: (id) => ({ getName: () => ({ [YEW_LOGS]: "Yew logs", [BONES]: "Bones" })[id] ?? "Logs" }) },
      PlayerRights: { NONE: { name: "none" } },
      Location: FakeLocation,
      MapObjects: {
        getHash: (x, y, z) => `${x},${y},${z}`,
        mapObjects: { get: (key) => world.objects.filter((o) => `${o.at.x},${o.at.y},${o.at.z}` === key) },
      },
      World: { getNpcsNear: (location, radius) => world.npcs.filter((n) => Math.max(Math.abs(n.at.x - location.getX()), Math.abs(n.at.y - location.getY())) <= radius) },
      Task: class { constructor(delay) { this.delay = delay; } stop() { this.stopped = true; } },
      CanAttackResponse: { CAN_ATTACK: "can" },
      CombatFactory: { getMethod: () => "melee", canAttackPermission: (player, npc) => (npc.protectedFrom === player ? "no" : "can") },
      CacheDefinitions: { getItem: (id) => ({ inventoryActions: id === SHARK ? ["Eat", null, null, null, "Drop"] : [null, null, null, null, "Drop"] }) },
      Inventory: { INTERFACE_ID: 3214 },
      TeleportType: { NORMAL: "normal", ANCIENT: "ancient" },
      TeleportHandler: {
        checkReqs: (player) => !player.teleblocked,
        teleport: (player, location, type) => { api.teleports.push({ player, x: location.getX(), y: location.getY(), z: location.getZ(), type }); },
      },
      WorldDefinition: { isMembersWorld: () => world.members },
      UseItemPacketListener: {
        itemOnObject: (player, interfaceType, objectId, itemId, slot, x, y) => api.uses.push({ kind: "item-object", player, objectId, itemId, slot, x, y }),
        itemOnItem: (player, usedSlot, withSlot) => api.uses.push({ kind: "item-item", player, usedSlot, withSlot }),
      },
      ItemActionPacketListener: { handleAction: (player, interfaceId, itemId, slot, clickType, option) => api.itemActions.push({ player, interfaceId, itemId, slot, clickType, option }) },
      TaskManager: { submit: (task) => world.tasks.push(task) },
    },
    interactions: [],
    interfaces: [],
    itemActions: [],
    uses: [],
    teleports: [],
    persisted: {},
    getPluginConfig: (key, fallback) => (key in config ? config[key] : fallback),
    persistAttribute: (key, value) => { api.persisted[key] = value; },
    onPlayerLogin: (handler) => handlers.login.push(handler),
    onPlayerLogout: (handler) => handlers.logout.push(handler),
    onCustomEvent: (name, handler) => (handlers.events[name] ??= []).push(handler),
    onBeforeObjectInteraction: (handler) => (handlers.events["before-object"] ??= []).push(handler),
    onBeforeNpcInteraction: (handler) => (handlers.events["before-npc"] ??= []).push(handler),
    onServerStartup: (handler) => (handlers.events.startup ??= []).push(handler),
    onNpcAttackOption: (handler) => (handlers.events["attack-option"] ??= []).push(handler),
    onItemOnObject: (handler) => (handlers.events["item-on-object"] ??= []).push(handler),
    onItemOnItem: (handler) => (handlers.events["item-on-item"] ??= []).push(handler),
    onCanLogout: (handler) => (handlers.events["can-logout"] ??= []).push(handler),
    registerCustomInterface: (definition) => { api.interfaces.push(definition); },
    onInterfaceActionButton: (ids, handler) => [ids].flat().forEach((id) => { handlers.buttons[id] = handler; }),
    click: (player, buttonId) => handlers.buttons[buttonId]({ player, buttonId, action: 1, opId: 1 }),
    onPlayerDisconnect: (handler) => (handlers.events.disconnect ??= []).push(handler),
    onExperienceGained: (handler) => (handlers.events.xp ??= []).push(handler),
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
const world = { objects: [], npcs: [], tasks: [], members: true };

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
    getAmount: (id) => bank.get(id) ?? 0,
    deleteNumber: (id, amount) => {
      const left = (bank.get(id) ?? 0) - amount;
      if (left > 0) bank.set(id, left);
      else bank.delete(id);
    },
  };
  let self;
  let interfaceId = -1;
  const screen = { opened: [], texts: new Map(), hidden: new Map() };
  const walks = [];
  let location = new FakeLocation(3200, 3200, 0);
  return self = {
    bank,
    xp,
    messages,
    walks,
    moving: 0,
    isBusy: false,
    hitpoints: 99,
    inventory: [],
    combat: {
      target: null,
      attacker: null,
      getTarget() { return this.target; },
      getAttacker() { return this.attacker; },
      attack(target) { this.target = target; },
    },
    getHitpoints() { return this.hitpoints; },
    screen,
    getInterfaceId: () => interfaceId,
    setInterfaceId: (id) => { interfaceId = id; },
    creationMenu: null,
    getCreationMenu() { return this.creationMenu; },
    getPacketSender: () => ({
      closeCreationMenu: () => { self.creationMenu = null; },
      sendSubInterface: (parent, groupId, type, options) => screen.opened.push({ parent, groupId, options }),
      sendString(text, id) { screen.texts.set(id, text); return this; },
      sendInterfaceDisplayState: (id, hidden) => screen.hidden.set(id, hidden),
      sendInterfaceRemoval: () => { interfaceId = -1; },
      clearItemOnInterface: () => {},
    }),
    getInventory() {
      const items = this.inventory;
      return {
        getItems: () => items,
        getAddableAmount: (item) => (items.length < (this.inventorySlots ?? 28) ? item.getAmount() : 0),
        add: (item) => items.push(item),
        getAmount: (id) => items.filter((item) => item.getId() === id).reduce((total, item) => total + item.getAmount(), 0),
        deleteNumber: (id, amount) => {
          for (const item of items.filter((entry) => entry.getId() === id)) {
            const taken = Math.min(amount, item.amount);
            item.amount -= taken;
            amount -= taken;
          }
          items.splice(0, items.length, ...items.filter((item) => item.amount > 0));
        },
      };
    },
    // Tests pass numbers; the server passes a Location, as the real Player.moveTo takes.
    moveTo(x, y, z = 0) { location = typeof x === "object" ? new FakeLocation(x.getX(), x.getY(), x.getZ()) : new FakeLocation(x, y, z); },
    getLocation: () => location,
    isRegistered: () => true,
    busy() { return this.isBusy; },
    getCombat() { return this.combat; },
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
      getMaxLevel: (s) => self.levels?.[Object.keys(Skill).find((key) => Skill[key] === s)] ?? 99,
      getCombatLevel: () => self.combatLevel ?? 3,
      addExperience(s, amount) {
        xp.set(s, (xp.get(s) ?? 0) + amount);
        api.emit("xp", { player: self, skill: s, experience: amount });
      },
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
  world.members = true;
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
  api.command(player, "idle status");
  assert.match(player.messages.pop(), /off/);
  api.command(player, "idle on");
  assert.equal(player.getAttribute("idle-mode:enabled"), true);
  assert.match(player.messages.pop(), /Press Travel on the Idle screen/, "the first time: the welcome");
  api.command(player, "idle on");
  assert.match(player.messages.pop(), /Idle Mode is on/, "afterwards: the state");
  api.command(player, "idle off");
  assert.equal(player.getAttribute("idle-mode:enabled"), false);
  api.command(player, "idle maybe");
  assert.match(player.messages.pop(), /Use ::idle, ::idle \[on\|off\|status\], ::idle auto/);
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
  assert.deepEqual(away, { activity: "WOODCUTTING", durationMs: 120_000, xp: { WOODCUTTING: 500 }, items: { [LOGS]: 20 }, loggedOutAt: now });

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
  const away = { activity: "WOODCUTTING", durationMs: 60_000, xp: { WOODCUTTING: 100 }, items: { [YEW_LOGS]: 2 }, loggedOutAt: 0 };
  const config = { capHours: 12, efficiency: 1 };
  const reward = offlineReward(away, 48 * 3600 * 1000, config);
  assert.equal(reward.paidMs, 12 * 3600 * 1000);
  assert.equal(reward.items[YEW_LOGS], 1440);
  assert.deepEqual(reward.xp, { WOODCUTTING: 72_000 });
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

test("offline: a long gap or another activity starts a new session", () => {
  const { addResult } = require(OFFLINE);
  const config = { maxGapSeconds: 60 };
  const logs = { activity: "WOODCUTTING", items: { [LOGS]: 1 } };
  let session = addResult(null, logs, 0, { WOODCUTTING: 0 }, config);
  session = addResult(session, logs, 5000, { WOODCUTTING: 25 }, config);
  assert.deepEqual(session.items, { [LOGS]: 1 });
  assert.deepEqual(session.lastXp, { WOODCUTTING: 25 });
  const fishing = addResult(session, { activity: "FISHING", items: { 317: 1 } }, 6000, { FISHING: 0 }, config);
  assert.equal(fishing.activity, "FISHING");
  assert.deepEqual(fishing.items, {});
  const late = addResult(fishing, { activity: "FISHING", items: { 317: 1 } }, 6000 + 61_000, { FISHING: 0 }, config);
  assert.equal(late.firstAt, 67_000);
  // An activity with its own gap (combat's slower kills) keeps its session longer.
  const kill = addResult(null, { activity: "COMBAT", items: {}, maxGapSeconds: 180 }, 0, { ATTACK: 0 }, config);
  assert.equal(addResult(kill, { activity: "COMBAT", items: { 526: 1 }, maxGapSeconds: 180 }, 150_000, { ATTACK: 40 }, config), kill);
});

test("offline: a full bank loses what does not fit, and says so", (t) => {
  let now = 0;
  t.mock.method(Date, "now", () => now);
  const player = fakePlayer({ bankSlots: 0 });
  player.setAttribute("idle-mode:away", { activity: "WOODCUTTING", durationMs: 60_000, xp: { WOODCUTTING: 100 }, items: { [LOGS]: 10 }, loggedOutAt: 0 });
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
  player.combat.target = {};
  assert.equal(resume(player, Date.now()), "busy");
  player.combat.target = null;
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
  assert.equal(world.tasks.length, 3, "auto-resume, idle combat and production");
  assert.deepEqual(world.tasks.map((task) => task.delay), [2, 2, 2]);
  api.logout({ player });
  assert.equal(tracked.has(player), false);
  api.login({ player });
  assert.ok(tracked.has(player), "a saved target is tracked again on login");
});

const PROGRESSION = "../plugins/modes/idle/Progression.IdleMode";

test("points: one per 250 idle-skill XP, carried over, online and offline", (t) => {
  const player = fakePlayer();
  player.setAttribute("idle-mode:enabled", true);
  assert.equal(api.persisted["idle-mode:points"], 0);
  assert.deepEqual(api.persisted["idle-mode:upgrades"], {});
  api.emit("xp", { player, skill: Skill.WOODCUTTING, experience: 600 });
  assert.equal(player.getAttribute("idle-mode:points"), 2);
  assert.equal(player.getAttribute("idle-mode:point-progress"), 100);
  api.emit("xp", { player, skill: Skill.WOODCUTTING, experience: 150 });
  assert.equal(player.getAttribute("idle-mode:points"), 3);
  api.emit("xp", { player, skill: Skill.COOKING, experience: 10_000 });
  assert.equal(player.getAttribute("idle-mode:points"), 3, "not an idle skill");
  const normal = fakePlayer();
  api.emit("xp", { player: normal, skill: Skill.WOODCUTTING, experience: 10_000 });
  assert.equal(normal.getAttribute("idle-mode:points"), undefined, "not idle");

  // The offline XP lands through the same hook.
  let now = 0;
  t.mock.method(Date, "now", () => now);
  player.setAttribute("idle-mode:away", { activity: "WOODCUTTING", durationMs: 60_000, xp: { WOODCUTTING: 500 }, items: { [LOGS]: 10 }, loggedOutAt: 0 });
  now = 60_000;
  api.login({ player });
  assert.equal(player.getAttribute("idle-mode:points"), 5);
});

test("shop: buying levels spends points, refuses when short or maxed", () => {
  const player = fakePlayer();
  player.setAttribute("idle-mode:enabled", true);
  player.setAttribute("idle-mode:points", 300);
  api.command(player, "idle shop");
  const shop = player.messages.splice(0).join("\n");
  assert.match(shop, /You have 300 idle points\./);
  assert.match(shop, /Quick Hands \(quick-hands\) 0\/5: .*next level 100 points\./);
  api.command(player, "idle buy quick-hands");
  assert.equal(player.messages.pop(), "Quick Hands is now level 1.");
  assert.equal(player.getAttribute("idle-mode:points"), 200);
  api.command(player, "idle buy quick-hands");
  assert.match(player.messages.pop(), /level 2 costs 250 points; you have 200/);
  api.command(player, "idle buy nothing");
  assert.match(player.messages.pop(), /no upgrade called nothing/);
  player.setAttribute("idle-mode:upgrades", { "long-dreams": 4 });
  api.command(player, "idle buy long-dreams");
  assert.match(player.messages.pop(), /already at its highest level/);
  api.command(player, "idle points");
  assert.equal(player.messages.pop(), "You have 200 idle points.");
});

test("upgrades: Quick Hands takes a tick off by chance; Long Dreams and Bountiful Harvest reach offline", (t) => {
  const player = fakePlayer();
  player.setAttribute("idle-mode:enabled", true);
  player.setAttribute("idle-mode:upgrades", { "quick-hands": 3, "long-dreams": 2, "bountiful-harvest": 5 });
  t.mock.method(Math, "random", () => 0.25);
  assert.equal(api.emit("skills:action-interval", { player, skill: Skill.WOODCUTTING, kind: "chop", ticks: 4 }).ticks, 3, "0.25 < 30%");
  assert.equal(api.emit("fishing:interval", { player, ticks: 5 }).ticks, 4);
  assert.equal(api.emit("skills:action-interval", { player, skill: Skill.MAGIC ?? Skill.COOKING, kind: "enchant", ticks: 5 }).ticks, 5, "not a gathering action");
  assert.equal(api.emit("skills:action-interval", { player, skill: Skill.MINING, kind: "mine", ticks: 1 }).ticks, 1, "never under one tick");
  t.mock.method(Math, "random", () => 0.35);
  assert.equal(api.emit("skills:action-interval", { player, skill: Skill.WOODCUTTING, kind: "chop", ticks: 4 }).ticks, 4);

  const { capHours, bountyChance } = require(PROGRESSION);
  assert.equal(capHours(player), 18);
  assert.ok(Math.abs(bountyChance(player) - 0.2) < 1e-9);

  // Bountiful Harvest online: 0.35 >= 20%, no extra; 0.1 < 20%, one extra log in the bank.
  chop(player);
  assert.equal(player.bank.get(LOGS), 1);
  t.mock.method(Math, "random", () => 0.1);
  chop(player);
  assert.equal(player.bank.get(LOGS), 3);

  // Offline: the cap is 18h and a fifth more items.
  let now = 0;
  t.mock.method(Date, "now", () => now);
  const away = fakePlayer();
  away.setAttribute("idle-mode:enabled", true);
  away.setAttribute("idle-mode:upgrades", { "long-dreams": 2, "bountiful-harvest": 5 });
  away.setAttribute("idle-mode:onboarded", true);
  away.setAttribute("idle-mode:away", { activity: "WOODCUTTING", durationMs: 3_600_000, xp: { WOODCUTTING: 1000 }, items: { [LOGS]: 100 }, loggedOutAt: 0 });
  now = 48 * 3_600_000;
  api.login({ player: away });
  assert.equal(away.bank.get(LOGS), 2160, "18h x 100 x 1.2");
  assert.equal(away.xp.get(Skill.WOODCUTTING), 18_000, "no XP for the extras");
  assert.match(away.messages[0], /capped at 18h/);
});

const COMBAT = "../plugins/modes/idle/Combat.IdleMode";

function fakeMonster(name, x, y, hitpoints = 10) {
  const npc = fakeNpc(name, ["Attack"], x, y);
  npc.hp = hitpoints;
  npc.attacker = null;
  npc.getHitpoints = () => npc.hp;
  npc.getCombat = () => ({ getAttacker: () => npc.attacker });
  npc.isNpc = () => true;
  return npc;
}

/** An idle player who chose to attack a cow at (3201, 3200) and killed it. */
function killingCows(t) {
  let now = 1_000_000;
  t.mock.method(Date, "now", () => now);
  const player = fakePlayer();
  player.setAttribute("idle-mode:enabled", true);
  const cow = fakeMonster("Cow", 3201, 3200);
  api.emit("attack-option", { player, npc: cow, npcId: 2790, clickType: 2, handled: false });
  const drops = [{ itemId: BONES, amount: 1 }, { itemId: 1739, amount: 1 }];
  api.emit("npc-drops:generated", { player, npc: cow, npcId: 2790, drops, handled: false });
  return { player, cow, drops, advance: (ms) => (now += ms), now: () => now };
}

test("combat: a chosen monster's kill becomes the target, its loot goes to the bank", (t) => {
  assert.equal(api.persisted["idle-mode:combat-target"], null);
  const { player, drops } = killingCows(t);
  assert.deepEqual(player.getAttribute("idle-mode:combat-target"), { name: "Cow", anchor: { x: 3200, y: 3200, z: 0 } });
  assert.equal(player.bank.get(BONES), 1);
  assert.equal(player.bank.get(1739), 1);
  assert.equal(drops.length, 0, "nothing left for the ground");
  api.command(player, "idle auto");
  assert.match(player.messages.pop(), /fight the nearest cow here/);
});

test("combat: it attacks the nearest one it may, not one another player fights", (t) => {
  const { player, advance } = killingCows(t);
  const { fight } = require(COMBAT);
  const taken = fakeMonster("Cow", 3200, 3201);
  taken.attacker = { isPlayer: () => true };
  const guarded = fakeMonster("Cow", 3201, 3201);
  guarded.protectedFrom = player;
  const dead = fakeMonster("Cow", 3199, 3200, 0);
  const near = fakeMonster("Cow", 3203, 3203);
  const far = fakeMonster("Cow", 3210, 3210);
  const goblin = fakeMonster("Goblin", 3200, 3199);
  world.npcs.push(taken, guarded, dead, near, far, goblin);
  advance(5000);
  assert.equal(fight(player, Date.now()), "attacking");
  assert.equal(player.combat.target, near);
  assert.equal(fight(player, Date.now()), "fighting");
  player.combat.target = null;
  assert.equal(fight(player, Date.now()), "waiting", "a moment before the next one");
});

test("combat: it eats below half hitpoints, fights back, and waits when out of food", (t) => {
  const { player, advance } = killingCows(t);
  const { fight } = require(COMBAT);
  player.inventory = [new Item(BONES), new Item(SHARK)];
  player.hitpoints = 40;
  assert.equal(fight(player, Date.now()), "ate");
  assert.deepEqual(api.itemActions.at(-1), { player, interfaceId: 3214, itemId: SHARK, slot: 1, clickType: 1, option: "Eat" });

  player.hitpoints = 80;
  const angry = fakeMonster("Cow", 3202, 3202);
  player.combat.attacker = angry;
  assert.equal(fight(player, Date.now()), "retaliating");
  assert.equal(player.combat.target, angry);
  player.combat.target = null;
  player.combat.attacker = null;

  player.inventory = [];
  player.hitpoints = 20;
  assert.equal(fight(player, Date.now()), "low");
  assert.equal(fight(player, Date.now()), "low");
  assert.equal(player.messages.filter((m) => /out of food/.test(m)).length, 1, "said once");
  player.hitpoints = 45;
  advance(5000);
  world.npcs.push(fakeMonster("Cow", 3201, 3201));
  assert.equal(fight(player, Date.now()), "attacking", "low, but above the stop line: keeps going");
});

test("combat: away, turned off or not idle leaves the player be; a gather takes over", (t) => {
  const { player, cow, advance } = killingCows(t);
  const { fight } = require(COMBAT);
  world.npcs.push(fakeMonster("Cow", 3201, 3201));
  advance(5000);
  player.moveTo(3300, 3300);
  assert.equal(fight(player, Date.now()), "away");
  player.moveTo(3200, 3200);
  api.command(player, "idle auto off");
  assert.equal(fight(player, Date.now()), "off");
  api.command(player, "idle auto on");

  // Chopping a tree now makes gathering the activity.
  const willow = fakeObject("Willow tree", ["Chop down"], 3200, 3201);
  api.emit("before-object", { player, object: willow, objectId: 1276, clickType: 1, handled: false });
  chop(player);
  assert.equal(player.getAttribute("idle-mode:combat-target"), null);
  assert.equal(fight(player, Date.now()), "off");

  // And a cow killed again makes it combat.
  api.emit("attack-option", { player, npc: cow, npcId: 2790, clickType: 2, handled: false });
  api.emit("npc-drops:generated", { player, npc: cow, npcId: 2790, drops: [], handled: false });
  assert.equal(player.getAttribute("idle-mode:auto-target"), null);
});

test("combat: a monster that came at a gatherer, or a non-idle kill, changes nothing", (t) => {
  let now = 0;
  t.mock.method(Date, "now", () => now);
  const player = fakePlayer();
  player.setAttribute("idle-mode:enabled", true);
  const drops = [{ itemId: BONES, amount: 1 }];
  api.emit("npc-drops:generated", { player, npc: fakeMonster("Goblin", 3201, 3200), npcId: 1, drops, handled: false });
  assert.equal(player.getAttribute("idle-mode:combat-target"), undefined);
  assert.equal(drops.length, 1, "its loot stays on the ground");
  const normal = fakePlayer();
  const cow = fakeMonster("Cow", 3201, 3200);
  api.emit("attack-option", { player: normal, npc: cow, npcId: 2790, clickType: 2, handled: false });
  api.emit("npc-drops:generated", { player: normal, npc: cow, npcId: 2790, drops, handled: false });
  assert.equal(normal.getAttribute("idle-mode:combat-target"), undefined);
});

test("combat offline: kills measure the combat XP and loot, paid on login; combat XP earns points", (t) => {
  const { player, cow, advance } = killingCows(t);
  // A kill every 20 seconds for two minutes: 6 measured kills, 40 Attack and 13 Hitpoints XP each.
  for (let i = 1; i <= 6; i++) {
    advance(20_000);
    player.getSkillManager().addExperience(Skill.ATTACK, 40);
    player.getSkillManager().addExperience(Skill.HITPOINTS, 13);
    api.emit("npc-drops:generated", { player, npc: cow, npcId: 2790, drops: [{ itemId: BONES, amount: 1 }], handled: false });
  }
  assert.equal(player.getAttribute("idle-mode:points"), 1, "318 combat XP: a point");
  api.logout({ player });
  const away = player.getAttribute("idle-mode:away");
  assert.equal(away.activity, "COMBAT");
  assert.deepEqual(away.xp, { ATTACK: 240, HITPOINTS: 78 });
  assert.deepEqual(away.items, { [BONES]: 6 });

  advance(60 * 60 * 1000);
  const bones = player.bank.get(BONES);
  api.login({ player });
  assert.equal(player.xp.get(Skill.ATTACK), 240 + 240 * 30);
  assert.equal(player.bank.get(BONES) - bones, 180);
  assert.match(player.messages.join("\n"), /you kept fighting:\n7,200 Attack XP, 2,340 Hitpoints XP, 180 x Bones to your bank\./);
});

test("level-ups: an idle account's pop-up does not hold its work, set with the flag and on login", () => {
  const player = fakePlayer();
  api.command(player, "idle on");
  assert.equal(player.getAttribute("level-up:keep-actions"), true);
  api.command(player, "idle off");
  assert.equal(player.getAttribute("level-up:keep-actions"), false);
  // The flag is saved, the level-up setting is not: a login puts it back in step.
  const returning = fakePlayer();
  returning.setAttribute("idle-mode:enabled", true);
  api.login({ player: returning, isNewAccount: false });
  assert.equal(returning.getAttribute("level-up:keep-actions"), true);
});

test("auto: clicking something else pauses it until the next gather", (t) => {
  const { player, willow, advance } = choppingWillow(t);
  const { resume } = require(AUTO);
  const booth = fakeObject("Bank booth", ["Bank"], 3205, 3205);
  api.emit("before-object", { player, object: booth, objectId: 10355, clickType: 1, handled: false });
  advance(20_000);
  assert.equal(resume(player, Date.now()), "paused");
  // Its own clicks on the target do not pause it; a gather lifts the pause.
  api.emit("before-object", { player, object: willow, objectId: 1276, clickType: 1, handled: false });
  chop(player);
  advance(20_000);
  assert.equal(resume(player, Date.now()), "resumed");
  // An attack is something else too.
  api.emit("attack-option", { player, npc: fakeMonster("Man", 3201, 3201), npcId: 3106, clickType: 2, handled: false });
  advance(20_000);
  assert.equal(resume(player, Date.now()), "paused");
});

test("auto: a try that gathers nothing moves on to the next nearest; a few in a row pause it", (t) => {
  const { player, willow, advance } = choppingWillow(t);
  const { resume } = require(AUTO);
  // The willow by the anchor, then two more further off: one out of reach is left for the next.
  const second = fakeObject("Willow tree", ["Chop down"], 3204, 3204);
  const third = fakeObject("Willow tree", ["Chop down"], 3208, 3208);
  world.objects.push(second, third);
  const used = [];
  const results = [];
  for (let i = 0; i < 5; i++) {
    advance(20_000);
    results.push(resume(player, Date.now()));
    used.push(api.interactions.at(-1)?.object);
  }
  assert.deepEqual(results, ["resumed", "resumed", "resumed", "paused", "paused"]);
  assert.deepEqual(used.slice(0, 3), [willow, second, third], "each failed one is left alone");
  assert.equal(player.messages.filter((m) => /Auto-resume has paused: your character can't chop down the willow tree/.test(m)).length, 1);
  api.command(player, "idle auto on");
  advance(20_000);
  assert.equal(resume(player, Date.now()), "resumed");
  assert.equal(api.interactions.at(-1).object, willow, "turning it on forgets the skips");
});

test("auto: a skipped one is tried again after a while, and a gather keeps it", (t) => {
  const { player, willow, advance } = choppingWillow(t);
  const { resume } = require(AUTO);
  advance(20_000);
  assert.equal(resume(player, Date.now()), "resumed");
  advance(20_000);
  assert.equal(resume(player, Date.now()), "none", "the only willow failed: left alone");
  advance(120_000);
  assert.equal(resume(player, Date.now()), "resumed");
  assert.equal(api.interactions.at(-1).object, willow);
  chop(player);
  advance(20_000);
  assert.equal(resume(player, Date.now()), "resumed", "a gather in between: no failure counted");
});

test("combat: another click or attacks that never kill pause it, until a kill of the target", (t) => {
  const { player, cow, advance } = killingCows(t);
  const { fight } = require(COMBAT);
  world.npcs.push(fakeMonster("Cow", 3201, 3201));
  api.emit("before-object", { player, object: fakeObject("Bank booth", ["Bank"], 3205, 3205), objectId: 1, clickType: 1, handled: false });
  advance(5000);
  assert.equal(fight(player, Date.now()), "paused");
  api.emit("npc-drops:generated", { player, npc: cow, npcId: 2790, drops: [], handled: false });
  // Six cows in reach; each attack never takes (out of reach), so each is left for the next.
  for (let i = 0; i < 5; i++) world.npcs.push(fakeMonster("Cow", 3202 + i, 3202));
  const results = [];
  const attacked = new Set();
  for (let i = 0; i < 7; i++) {
    advance(5000);
    player.combat.target = null;
    results.push(fight(player, Date.now()));
    if (player.combat.target) attacked.add(player.combat.target);
  }
  assert.deepEqual(results, ["attacking", "attacking", "attacking", "attacking", "attacking", "paused", "paused"]);
  assert.equal(attacked.size, 5, "a different cow each time");
  assert.equal(player.messages.filter((m) => /Idle combat has paused/.test(m)).length, 1);
  api.command(player, "idle auto on");
  advance(5000);
  player.combat.target = null;
  assert.equal(fight(player, Date.now()), "attacking");
});

test("combat: pressing logout or a lost connection starts no new fights, so the player can leave", (t) => {
  for (const event of ["can-logout", "disconnect"]) {
    const { player, advance } = killingCows(t);
    const { fight } = require(COMBAT);
    world.npcs.push(fakeMonster("Cow", 3201, 3201));
    const request = api.emit(event, { player, allow: null });
    assert.equal(request.allow, null, "the logout itself is the game's to answer");
    advance(5000);
    assert.equal(fight(player, Date.now()), "paused", event);
    t.mock.restoreAll();
  }
});

const SCREEN = "../plugins/modes/idle/Screen.IdleMode";

/** The screen's text at a component, its markup removed. */
function screenText(player, component) {
  const { uid } = require(SCREEN);
  return String(player.screen.texts.get(uid(component)) ?? "").replace(/<[^>]+>/g, "");
}

test("screen: ::idle opens it, a server-defined interface with the frame's title", () => {
  const { GROUP_ID, COMPONENT } = require(SCREEN);
  const definition = api.interfaces.find((entry) => entry.groupId === GROUP_ID);
  assert.ok(definition, "registered");
  assert.ok(definition.widgets.length > 30);
  const player = fakePlayer();
  api.command(player, "idle");
  assert.equal(player.getInterfaceId(), GROUP_ID);
  const opened = player.screen.opened.at(-1);
  assert.equal(opened.groupId, GROUP_ID);
  assert.deepEqual(opened.options.postScripts[0].args[1], "Idle Mode");
  assert.equal(screenText(player, COMPONENT.STATUS_LINE_START), "Idle Mode: Off");
  assert.equal(screenText(player, COMPONENT.STATUS_LINE_START + 1), "Auto-resume: needs Idle Mode");
  assert.equal(screenText(player, COMPONENT.IDLE_LABEL), "Start idle");
});

test("screen: the status lines follow the account", (t) => {
  const { COMPONENT } = require(SCREEN);
  const { player } = choppingWillow(t);
  player.setAttribute("idle-mode:points", 1234);
  player.setAttribute("idle-mode:point-progress", 80);
  player.setAttribute("idle-mode:upgrades", { "long-dreams": 1 });
  player.setAttribute("idle-mode:last-away", "1h 0m woodcutting: 15,000 Woodcutting XP, 600 x Logs to your bank.");
  api.command(player, "idle");
  const lines = Array.from({ length: 8 }, (_, line) => screenText(player, COMPONENT.STATUS_LINE_START + line));
  assert.deepEqual(lines, [
    "Idle Mode: On",
    "Auto-resume: On",
    "Activity: Chop down willow tree",
    "XP per hour: -",
    "Idle points: 1,234",
    "Next point: 80 / 250 XP",
    "Offline: up to 15h at 100%",
    "Last time away: 1h 0m woodcutting: 15,000 Woodcutting XP, 600 x Logs to your bank.",
  ]);
  assert.equal(screenText(player, COMPONENT.AUTO_LABEL), "Stop auto");
});

test("screen: the switches turn Idle Mode and auto-resume on and off, and it redraws", () => {
  const { COMPONENT, uid } = require(SCREEN);
  const player = fakePlayer();
  api.command(player, "idle");
  api.click(player, uid(COMPONENT.IDLE_BUTTON));
  assert.equal(player.getAttribute("idle-mode:enabled"), true);
  assert.equal(screenText(player, COMPONENT.STATUS_LINE_START), "Idle Mode: On");
  assert.equal(screenText(player, COMPONENT.IDLE_LABEL), "Stop idle");
  api.click(player, uid(COMPONENT.AUTO_LABEL));
  assert.equal(player.getAttribute("idle-mode:auto"), false);
  assert.equal(screenText(player, COMPONENT.STATUS_LINE_START + 1), "Auto-resume: Off");
  api.click(player, uid(COMPONENT.AUTO_BUTTON));
  assert.equal(player.getAttribute("idle-mode:auto"), true);
  // A closed screen ignores its buttons.
  player.setInterfaceId(-1);
  api.click(player, uid(COMPONENT.IDLE_BUTTON));
  assert.equal(player.getAttribute("idle-mode:enabled"), true);
});

test("screen: upgrades show level, price and Buy; buying spends points and redraws", () => {
  const { COMPONENT, SLOT, uid, slotComponent } = require(SCREEN);
  const player = fakePlayer();
  player.setAttribute("idle-mode:enabled", true);
  player.setAttribute("idle-mode:points", 120);
  player.setAttribute("idle-mode:upgrades", { "bountiful-harvest": 5 });
  api.command(player, "idle");
  assert.equal(screenText(player, COMPONENT.POINTS), "You have 120 idle points");
  assert.equal(screenText(player, slotComponent(0, SLOT.NAME)), "Quick Hands 0/5");
  assert.match(screenText(player, slotComponent(0, SLOT.DESCRIPTION)), /^Each level: a 10% chance/);
  assert.equal(screenText(player, slotComponent(0, SLOT.PRICE)), "Next: 100 points");
  assert.equal(screenText(player, slotComponent(1, SLOT.PRICE)), "Next: 150 points");
  assert.equal(screenText(player, slotComponent(2, SLOT.PRICE)), "Max level");
  assert.equal(player.screen.hidden.get(uid(slotComponent(2, SLOT.BUY_BUTTON))), true, "no Buy at max level");
  const { GROUP_ID } = require(SCREEN);
  const widgets = api.interfaces.find((entry) => entry.groupId === GROUP_ID).widgets.map((widget) => widget.uid);
  assert.ok(widgets.includes(uid(slotComponent(2, SLOT.BUY_BUTTON))) && !widgets.includes(uid(slotComponent(3, SLOT.NAME))), "a slot per upgrade in the data");

  api.click(player, uid(slotComponent(0, SLOT.BUY_BUTTON)));
  assert.equal(player.messages.pop(), "Quick Hands is now level 1.");
  assert.equal(screenText(player, COMPONENT.POINTS), "You have 20 idle points");
  assert.equal(screenText(player, slotComponent(0, SLOT.NAME)), "Quick Hands 1/5");
  api.click(player, uid(slotComponent(1, SLOT.BUY_LABEL)));
  assert.match(player.messages.pop(), /Long Dreams level 1 costs 150 points; you have 20/);
});

test("screen: it redraws while open as points come in, and a pause shows", (t) => {
  const { COMPONENT } = require(SCREEN);
  const { player, advance } = choppingWillow(t);
  api.command(player, "idle");
  api.emit("xp", { player, skill: Skill.WOODCUTTING, experience: 300 });
  assert.equal(screenText(player, COMPONENT.STATUS_LINE_START + 4), "Idle points: 1");
  assert.equal(screenText(player, COMPONENT.POINTS), "You have 1 idle point");
  api.emit("before-object", { player, object: fakeObject("Bank booth", ["Bank"], 3205, 3205), objectId: 1, clickType: 1, handled: false });
  assert.equal(screenText(player, COMPONENT.STATUS_LINE_START + 1), "Auto-resume: Paused (you're doing something else)");
  advance(1000);
  chop(player);
  assert.equal(screenText(player, COMPONENT.STATUS_LINE_START + 1), "Auto-resume: On");
});

const TRAVEL = "../plugins/modes/idle/Travel.IdleMode";
const TRAVEL_SCREEN = "../plugins/modes/idle/TravelScreen.IdleMode";

function idlePlayer(levels = {}) {
  const player = fakePlayer();
  player.setAttribute("idle-mode:enabled", true);
  player.levels = levels;
  return player;
}

test("travel: ::idle go teleports to the site and makes it the gathering target, at once", (t) => {
  t.mock.method(Date, "now", () => 5_000_000);
  const player = idlePlayer();
  api.command(player, "idle go draynor-willows");
  assert.deepEqual(api.teleports.at(-1), { player, x: 3087, y: 3234, z: 0, type: "normal" });
  assert.deepEqual(player.getAttribute("idle-mode:auto-target"), {
    skill: "WOODCUTTING", kind: "object", name: "Willow tree", option: "Chop down", anchor: { x: 3087, y: 3234, z: 0 },
  });
  assert.equal(player.getAttribute("idle-mode:combat-target"), null);
  assert.match(player.messages.pop(), /You travel to Draynor Village: willow trees\. You'll need: any axe\./);

  // Arrived: the next look walks to the nearest willow and chops, with no wait.
  player.moveTo(3087, 3234);
  const willow = fakeObject("Willow tree", ["Chop down"], 3089, 3236);
  world.objects.push(willow);
  assert.equal(require(AUTO).resume(player, Date.now()), "resumed");
  assert.equal(api.interactions.at(-1).object, willow);
});

test("travel: a combat site makes the monster the target; auto-resume comes on", (t) => {
  t.mock.method(Date, "now", () => 5_000_000);
  const player = idlePlayer();
  player.setAttribute("idle-mode:auto-target", { skill: "WOODCUTTING", kind: "object", name: "Tree", option: "Chop down", anchor: { x: 1, y: 1, z: 0 } });
  api.command(player, "idle auto off");
  api.command(player, "idle go lumbridge-cows");
  assert.deepEqual(player.getAttribute("idle-mode:combat-target"), { name: "Cow", anchor: { x: 3258, y: 3275, z: 0 } });
  assert.equal(player.getAttribute("idle-mode:auto-target"), null, "one activity at a time");
  assert.equal(player.getAttribute("idle-mode:auto"), true);
  player.moveTo(3258, 3275);
  world.npcs.push(fakeMonster("Cow", 3260, 3276));
  assert.equal(require(COMBAT).fight(player, Date.now()), "attacking");
});

test("travel: refused without Idle Mode, below the level, or by the teleport rules", () => {
  const off = fakePlayer();
  api.command(off, "idle go lumbridge-trees");
  assert.match(off.messages.pop(), /Turn Idle Mode on first/);
  const novice = idlePlayer({ WOODCUTTING: 29 });
  api.command(novice, "idle go draynor-willows");
  assert.equal(novice.messages.pop(), "You need Woodcutting level 30 for willow trees.");
  const blocked = idlePlayer();
  blocked.teleblocked = true;
  api.command(blocked, "idle go lumbridge-trees");
  assert.equal(api.teleports.length, 0);
  assert.equal(blocked.getAttribute("idle-mode:auto-target"), undefined, "nothing changes");
  // A combat level is advice: a weak account can still go.
  const weak = idlePlayer();
  weak.combatLevel = 3;
  api.command(weak, "idle go hill-giants");
  assert.equal(api.teleports.length, 1);
  api.command(weak, "idle go nowhere");
  assert.match(weak.messages.pop(), /Use ::idle go <site>/);
  api.command(weak, "idle sites");
  assert.match(weak.messages.pop(), /Idle travel sites: lumbridge-trees, draynor-oaks/);
});

test("travel: a free-to-play world leaves out members sites", () => {
  const { sites } = require(TRAVEL);
  assert.ok(sites().some((site) => site.id === "seers-maples"));
  world.members = false;
  assert.ok(!sites().some((site) => site.id === "seers-maples"));
  const player = idlePlayer();
  api.command(player, "idle go seers-maples");
  assert.match(player.messages.pop(), /Use ::idle go <site>/);
});

test("travel screen: rows per site with level and panel, tabs per activity, opened on the current one", (t) => {
  const { GROUP_ID, COMPONENT, uid } = require(TRAVEL_SCREEN);
  assert.ok(api.interfaces.find((entry) => entry.groupId === GROUP_ID), "registered");
  const player = idlePlayer({ WOODCUTTING: 30, MINING: 20 });
  player.setAttribute("idle-mode:auto-target", { skill: "MINING", kind: "object", name: "Iron rocks", option: "Mine", anchor: { x: 1, y: 1, z: 0 } });
  api.command(player, "idle travel");
  assert.equal(player.getInterfaceId(), GROUP_ID);
  const rows = JSON.parse(player.screen.texts.get(uid(COMPONENT.DATA)));
  const willows = rows.find((row) => row.name === "Willow trees");
  assert.equal(willows.icon, 1519);
  assert.equal(willows.detail, " - Lvl 30", "plain text: the runtime strips markup from details");
  assert.match(willows.panel.level, /Woodcutting level: <col=00ff00>30/);
  assert.equal(willows.panel.tool, "Bring: <col=ffffff>Any axe</col>");
  const yews = rows.find((row) => row.name === "Yew trees");
  assert.equal(yews.detail, " - Lvl 60 (you: 30)", "short of the level: says so");
  const layout = JSON.parse(player.screen.texts.get(uid(COMPONENT.LAYOUT)));
  assert.equal(layout.active, 2, "the Mining tab, the current activity");
  assert.deepEqual(layout.tabs[0][0], { header: "Woodcutting" });
  assert.equal(layout.tabs[4].length, 6, "six combat sites");
});

test("travel screen: Travel on a row or the panel's button goes there", (t) => {
  const { COMPONENT, uid, ROW_UIDS, OP } = require(TRAVEL_SCREEN);
  const player = idlePlayer();
  api.command(player, "idle travel");
  const rows = JSON.parse(player.screen.texts.get(uid(COMPONENT.DATA)));
  const cows = rows.find((row) => row.name === "Cows");
  // Select fills the panel client-side; the server keeps the pick for the button.
  api.handlers.buttons[ROW_UIDS[0]]({ player, buttonId: ROW_UIDS[0], slot: cows.id, opId: OP.SELECT });
  assert.equal(api.teleports.length, 0);
  api.click(player, uid(COMPONENT.TRAVEL_BUTTON));
  assert.deepEqual(api.teleports.at(-1), { player, x: 3258, y: 3275, z: 0, type: "normal" });
  assert.equal(player.getInterfaceId(), -1, "the screen closes to teleport");

  api.command(player, "idle travel");
  const shrimps = rows.find((row) => row.name === "Shrimps and anchovies");
  api.handlers.buttons[ROW_UIDS[3]]({ player, buttonId: ROW_UIDS[3], slot: shrimps.id, opId: OP.TRAVEL });
  assert.deepEqual(api.teleports.at(-1), { player, x: 3243, y: 3152, z: 0, type: "normal" });
});

test("idle screen: its Travel button opens the travel screen", () => {
  const { COMPONENT, uid } = require(SCREEN);
  const player = idlePlayer();
  api.command(player, "idle");
  assert.equal(screenText(player, COMPONENT.TRAVEL_LABEL), "Travel");
  api.click(player, uid(COMPONENT.TRAVEL_BUTTON));
  assert.equal(player.getInterfaceId(), require(TRAVEL_SCREEN).GROUP_ID);
});

const ONBOARDING = "../plugins/modes/idle/Onboarding.IdleMode";

test("onboarding: the first ::idle on gives the kit, welcomes and opens the Idle screen, once", () => {
  const { GROUP_ID } = require(SCREEN);
  assert.equal(api.persisted["idle-mode:onboarded"], false);
  const player = fakePlayer();
  api.command(player, "idle on");
  assert.deepEqual(player.inventory.map((item) => [item.getId(), item.getAmount()]), [[1351, 1], [1265, 1], [303, 1], [1277, 1], [315, 10]]);
  assert.equal(player.getInventory().getItems().length, 5);
  assert.match(player.messages.join("\n"), /Welcome to Idle Mode!.*\n.*axe, a pickaxe, a fishing net, a sword and some food/);
  assert.equal(player.getInterfaceId(), GROUP_ID, "the Idle screen opens");
  assert.equal(player.getAttribute("idle-mode:onboarded"), true);
  api.command(player, "idle off");
  api.command(player, "idle on");
  assert.equal(player.inventory.length, 5, "no second kit");
});

test("onboarding: a full inventory sends the kit to the bank", () => {
  const player = fakePlayer();
  player.inventorySlots = 0;
  api.command(player, "idle on");
  assert.equal(player.inventory.length, 0);
  assert.equal(player.bank.get(1351), 1);
  assert.equal(player.bank.get(315), 10);
});

test("onboarding: a new account on an idle world starts in Lumbridge, idle, and the screen opens a few ticks in", () => {
  const { GROUP_ID } = require(SCREEN);
  load({ "IdleMode:newAccounts": true });
  const player = fakePlayer();
  api.login({ player, isNewAccount: true });
  assert.equal(player.getAttribute("idle-mode:enabled"), true);
  assert.deepEqual([player.getLocation().getX(), player.getLocation().getY(), player.getLocation().getZ()], [3222, 3218, 0]);
  assert.equal(player.inventory.length, 5);
  assert.notEqual(player.getInterfaceId(), GROUP_ID, "not at once: the game frame is still loading");
  const task = world.tasks.at(-1);
  assert.equal(task.delay, 3);
  task.execute();
  assert.equal(player.getInterfaceId(), GROUP_ID);
});

test("onboarding: an idle account from before is onboarded on its next login; a plain one is not", () => {
  const old = fakePlayer();
  old.setAttribute("idle-mode:enabled", true);
  api.login({ player: old, isNewAccount: false });
  assert.equal(old.getAttribute("idle-mode:onboarded"), true);
  assert.equal(old.inventory.length, 5);
  assert.deepEqual([old.getLocation().getX(), old.getLocation().getY()], [3200, 3200], "only new accounts are moved");
  const plain = fakePlayer();
  api.login({ player: plain, isNewAccount: true });
  assert.notEqual(plain.getAttribute("idle-mode:onboarded"), true);
  assert.equal(plain.inventory.length, 0);
});

test("journal: the Idle button's idle:open opens the Idle screen", () => {
  const { GROUP_ID, COMPONENT } = require(SCREEN);
  const player = idlePlayer();
  api.emit("idle:open", { player });
  assert.equal(player.getInterfaceId(), GROUP_ID);
  assert.equal(screenText(player, COMPONENT.STATUS_LINE_START + 2), "Activity: None yet: press Travel");
});

test("offline: a server restart (a save, no logout) still pays the time away on the next login", (t) => {
  let now = 1_000_000;
  t.mock.method(Date, "now", () => now);
  const player = fakePlayer();
  player.setAttribute("idle-mode:enabled", true);
  player.setAttribute("idle-mode:onboarded", true);
  for (let i = 0; i <= 20; i++) {
    chop(player);
    if (i < 20) now += 6000;
  }
  // No logout: the attribute a shutdown save (or the last autosave) writes is already current.
  assert.deepEqual(player.getAttribute("idle-mode:away"), {
    activity: "WOODCUTTING", durationMs: 120_000, xp: { WOODCUTTING: 500 }, items: { [LOGS]: 20 }, loggedOutAt: now,
  });
  // The server comes back: fresh modules, nothing in memory, the saved attribute kept.
  load();
  now += 60 * 60 * 1000;
  const logsBefore = player.bank.get(LOGS);
  api.login({ player });
  assert.equal(player.bank.get(LOGS) - logsBefore, 600, "an hour at the rate it had");
  assert.equal(player.getAttribute("idle-mode:away"), null);
});

test("panel: XP per hour from the session played, totals of time idle, and the journal's rows", (t) => {
  const { COMPONENT } = require(SCREEN);
  let now = 1_000_000;
  t.mock.method(Date, "now", () => now);
  const player = idlePlayer();
  player.setAttribute("idle-mode:onboarded", true);
  // A log (25 XP) every 6 seconds for two minutes: 15,000 XP an hour.
  for (let i = 0; i <= 20; i++) {
    chop(player);
    if (i < 20) now += 6000;
  }
  api.command(player, "idle");
  assert.equal(screenText(player, COMPONENT.STATUS_LINE_START + 3), "XP per hour: 15,000");
  assert.deepEqual(player.getAttribute("idle-mode:totals"), {
    workedMs: 120_000, offlineMs: 0, xp: 500, items: 20, bySkill: { WOODCUTTING: 500 }, byItem: { [LOGS]: 20 },
  });
  const request = api.emit("idle:summary", { player, summary: null });
  assert.deepEqual(request.summary, { idleMode: "On", idleActivity: "None yet", idleXpRate: "15,000", idlePoints: 0, idleTime: "2m" });
  // Stopped for longer than the gap: no rate to show.
  now += 120_000;
  assert.equal(api.emit("idle:summary", { player, summary: null }).summary.idleXpRate, "-");
  // Time away paid adds to the totals.
  api.logout({ player });
  player.setAttribute("idle-mode:away", { activity: "WOODCUTTING", durationMs: 60_000, xp: { WOODCUTTING: 100 }, items: { [LOGS]: 10 }, loggedOutAt: now });
  now += 3_600_000;
  api.login({ player });
  const totals = player.getAttribute("idle-mode:totals");
  assert.equal(totals.offlineMs, 3_600_000);
  assert.equal(totals.items, 20 + 600);
  assert.deepEqual(totals.byItem, { [LOGS]: 620 });
  assert.equal(totals.bySkill.WOODCUTTING, 500 + 6000);
  assert.equal(api.emit("idle:summary", { player, summary: null }).summary.idleTime, "1h 2m");
});

test("return: a login that paid time away opens the Idle screen a few ticks in, or after Play", (t) => {
  const { GROUP_ID } = require(SCREEN);
  let now = 0;
  t.mock.method(Date, "now", () => now);
  const away = () => ({ activity: "WOODCUTTING", durationMs: 60_000, xp: { WOODCUTTING: 100 }, items: { [LOGS]: 10 }, loggedOutAt: 0 });
  // No welcome screen (a mobile login): it opens when the task runs.
  const direct = idlePlayer();
  direct.setAttribute("idle-mode:onboarded", true);
  direct.setAttribute("idle-mode:away", away());
  now = 60_000;
  api.login({ player: direct });
  assert.notEqual(direct.getInterfaceId(), GROUP_ID);
  world.tasks.at(-1).execute();
  assert.equal(direct.getInterfaceId(), GROUP_ID);
  // Behind the welcome screen: the task waits, Play opens it.
  const welcomed = idlePlayer();
  welcomed.setAttribute("idle-mode:onboarded", true);
  welcomed.setAttribute("idle-mode:away", away());
  api.login({ player: welcomed });
  api.emit("welcome-screen:shown", { player: welcomed });
  world.tasks.at(-1).execute();
  assert.notEqual(welcomed.getInterfaceId(), GROUP_ID);
  api.emit("gameframe:ready", { player: welcomed });
  assert.equal(welcomed.getInterfaceId(), GROUP_ID);
  // Nothing paid: nothing opens.
  const plain = idlePlayer();
  plain.setAttribute("idle-mode:onboarded", true);
  const tasks = world.tasks.length;
  api.login({ player: plain });
  assert.equal(world.tasks.length, tasks);
});

test("screens: every widget has its own id, and none runs into another's", () => {
  for (const definition of api.interfaces) {
    const uids = definition.widgets.map((widget) => widget.uid);
    assert.equal(new Set(uids).size, uids.length, `group ${definition.groupId} repeats a widget id`);
  }
  const { COMPONENT } = require(SCREEN);
  assert.ok(COMPONENT.STATUS_LINE_START + 8 <= COMPONENT.IDLE_BUTTON, "the status lines end before the buttons");
});

const PRODUCTION = "../plugins/modes/idle/Production.IdleMode";
const RAW_SHRIMPS = 317;
const SHRIMPS = 315;
const BURNT_SHRIMP = 323;

/** An idle cook who used 27 raw shrimps on a range at (3201, 3200) and cooked the first one. */
function cookingShrimps(t, { bankRaw = 100 } = {}) {
  let now = 2_000_000;
  t.mock.method(Date, "now", () => now);
  const player = idlePlayer();
  player.setAttribute("idle-mode:onboarded", true);
  player.inventory = [new Item(RAW_SHRIMPS, 27)];
  if (bankRaw) player.bank.set(RAW_SHRIMPS, bankRaw);
  const range = fakeObject("Range", ["Cook"], 3201, 3200);
  world.objects.push(range);
  api.emit("item-on-object", { player, object: range, objectId: 1276, item: player.inventory[0], itemId: RAW_SHRIMPS, itemSlot: 0, interfaceType: 0, handled: false });
  api.emit("skills:produced", { player, skill: Skill.COOKING, itemId: SHRIMPS, amount: 1, xp: 30, kind: "cook" });
  return { player, range, advance: (ms) => (now += ms) };
}

test("production: a use by hand that made something becomes the target, with the inventory as the loadout", (t) => {
  assert.equal(api.persisted["idle-mode:production-target"], null);
  const { player } = cookingShrimps(t);
  assert.deepEqual(player.getAttribute("idle-mode:production-target"), {
    kind: "item-object", usedItemId: RAW_SHRIMPS, objectName: "Range", interfaceType: 0, loadout: { [RAW_SHRIMPS]: 27 },
    skill: "COOKING", productId: SHRIMPS, anchor: { x: 3200, y: 3200, z: 0 },
  });
  assert.equal(player.getAttribute("idle-mode:auto-target"), null, "one activity at a time");
  api.command(player, "idle");
  assert.equal(screenText(player, require(SCREEN).COMPONENT.STATUS_LINE_START + 2), "Activity: Making logs", "the product's name");
});

test("production: when it stops, products to the bank, the loadout topped up, the same use and the same product", (t) => {
  const { player, range, advance } = cookingShrimps(t);
  const { work } = require(PRODUCTION);
  advance(3000);
  assert.equal(work(player, Date.now()), "producing");
  // The batch is done: 20 cooked, 7 burnt, no raw left.
  player.inventory = [new Item(SHRIMPS, 20), new Item(BURNT_SHRIMP, 7)];
  advance(10_000);
  assert.equal(work(player, Date.now()), "repeated");
  assert.equal(player.bank.get(SHRIMPS), 20);
  assert.equal(player.bank.get(BURNT_SHRIMP), 7);
  assert.equal(player.bank.get(RAW_SHRIMPS), 73);
  assert.equal(player.getInventory().getAmount(RAW_SHRIMPS), 27);
  assert.deepEqual(api.uses.at(-1), { kind: "item-object", player, objectId: 1276, itemId: RAW_SHRIMPS, slot: 0, x: 3201, y: 3200 });
  // The range's creation menu: the same product, all of it.
  const picked = [];
  player.creationMenu = { getItems: () => [SHRIMPS], execute: (itemId, amount) => picked.push([itemId, amount]) };
  assert.equal(work(player, Date.now()), "chose");
  assert.deepEqual(picked, [[SHRIMPS, 28]]);
  assert.equal(player.creationMenu, null, "the menu closes");
});

test("production: out of materials in the bank, or tries that make nothing, pause it and say so", (t) => {
  const { player, advance } = cookingShrimps(t, { bankRaw: 0 });
  const { work } = require(PRODUCTION);
  player.inventory = [new Item(SHRIMPS, 27)];
  advance(10_000);
  assert.equal(work(player, Date.now()), "paused");
  assert.match(player.messages.pop(), /out of logs\. Bank some more/, "the fake names every item Logs");
  api.command(player, "idle");
  assert.equal(screenText(player, require(SCREEN).COMPONENT.STATUS_LINE_START + 1), "Auto-resume: Paused (out of materials)");
  api.command(player, "idle auto on");

  player.bank.set(RAW_SHRIMPS, 500);
  const results = [];
  for (let i = 0; i < 4; i++) {
    advance(10_000);
    results.push(work(player, Date.now()));
  }
  assert.deepEqual(results, ["repeated", "repeated", "repeated", "paused"], "three tries that make nothing");
  assert.match(player.messages.at(-1), /can't make logs here/);
});

test("production: a knife on logs repeats item on item; gathering replaces it", (t) => {
  t.mock.method(Date, "now", () => 3_000_000);
  const KNIFE = 946;
  const ARROW_SHAFT = 52;
  const player = idlePlayer();
  player.setAttribute("idle-mode:onboarded", true);
  player.inventory = [new Item(KNIFE, 1), new Item(LOGS, 27)];
  player.bank.set(LOGS, 50);
  api.emit("item-on-item", { player, usedItemId: KNIFE, usedItemSlot: 0, usedWithItemId: LOGS, usedWithItemSlot: 1, handled: false });
  api.emit("skills:produced", { player, skill: Skill.FLETCHING ?? Skill.COOKING, itemId: ARROW_SHAFT, amount: 15, xp: 5, kind: "arrow" });
  const target = player.getAttribute("idle-mode:production-target");
  assert.equal(target.kind, "item-item");
  assert.deepEqual(target.loadout, { [KNIFE]: 1, [LOGS]: 27 });
  player.inventory = [new Item(KNIFE, 1), new Item(ARROW_SHAFT, 405)];
  const { work } = require(PRODUCTION);
  t.mock.method(Date, "now", () => 3_100_000);
  assert.equal(work(player, Date.now()), "repeated");
  assert.equal(player.bank.get(ARROW_SHAFT), 405);
  assert.equal(player.getInventory().getAmount(KNIFE), 1, "the tool stays");
  assert.equal(player.getInventory().getAmount(LOGS), 27);
  assert.equal(api.uses.at(-1).kind, "item-item");
  // Chopping a tree now: gathering is the activity.
  const willow = fakeObject("Willow tree", ["Chop down"], 3200, 3201);
  api.emit("before-object", { player, object: willow, objectId: 1276, clickType: 1, handled: false });
  chop(player);
  assert.equal(player.getAttribute("idle-mode:production-target"), null);
});

test("production offline: pays at the rate made, using the bank's materials, only as far as they last", (t) => {
  const { player, advance } = cookingShrimps(t, { bankRaw: 40 });
  const { work } = require(PRODUCTION);
  // Two minutes of cooking: a shrimp every 4 seconds, then a batch of 27 raw used up and restocked.
  for (let i = 0; i < 30; i++) {
    advance(4000);
    api.emit("skills:produced", { player, skill: Skill.COOKING, itemId: SHRIMPS, amount: 1, xp: 30, kind: "cook" });
  }
  player.inventory = [new Item(SHRIMPS, 27)];
  advance(7000);
  work(player, Date.now());
  assert.equal(player.bank.get(RAW_SHRIMPS), 13, "40 - 27 restocked");
  api.logout({ player });
  const away = player.getAttribute("idle-mode:away");
  assert.deepEqual(away.consumed, { [RAW_SHRIMPS]: 27 });
  assert.deepEqual(away.items, { [SHRIMPS]: 30 });
  // An hour away would cook 900, but the bank holds 13 raw (and 27 in the pack, not the bank).
  advance(3_600_000);
  const cookedBefore = player.bank.get(SHRIMPS) ?? 0;
  api.login({ player });
  assert.equal(player.bank.get(RAW_SHRIMPS), undefined, "the bank's raw shrimps are used up");
  assert.equal(player.bank.get(SHRIMPS) - cookedBefore, 14, "30 made per 27 used: 13 raw make 14");
  assert.match(player.messages.join("\n"), /using 13 x Logs, until you ran out of logs/);
});

test("production: a menu listing what is used (cooking's raw food) or one entry is answered too; one it can't read is closed", (t) => {
  const { player, advance } = cookingShrimps(t);
  const { work } = require(PRODUCTION);
  const answer = (items) => {
    player.inventory = [new Item(SHRIMPS, 27)];
    advance(10_000);
    assert.equal(work(player, Date.now()), "repeated");
    const picked = [];
    player.creationMenu = { getItems: () => items, execute: (itemId, amount) => picked.push([itemId, amount]) };
    const result = work(player, Date.now());
    // Each answered batch made something, so the next is not a failed try.
    api.emit("skills:produced", { player, skill: Skill.COOKING, itemId: SHRIMPS, amount: 1, xp: 30, kind: "cook" });
    return { result, picked, open: player.creationMenu };
  };
  assert.deepEqual(answer([RAW_SHRIMPS, 999]), { result: "chose", picked: [[RAW_SHRIMPS, 28]], open: null });
  assert.deepEqual(answer([777]), { result: "chose", picked: [[777, 28]], open: null });
  assert.deepEqual(answer([777, 888]), { result: "unanswerable", picked: [], open: null });
});

test("production: mid-batch (materials left) it waits for a stall, not the short restart", (t) => {
  const { player, advance } = cookingShrimps(t);
  const { work } = require(PRODUCTION);
  // 20 raw shrimps left: a run of failed tries (burnt, an impure ore) makes nothing for a while.
  player.inventory = [new Item(RAW_SHRIMPS, 20), new Item(SHRIMPS, 7)];
  advance(10_000);
  assert.equal(work(player, Date.now()), "producing", "10s without a product, materials left: still the batch");
  advance(15_000);
  assert.equal(work(player, Date.now()), "repeated", "25s: stalled, so it restarts");
});

test("travel: a production site takes you there; a production target that suits it carries on there", (t) => {
  const { player } = cookingShrimps(t);
  api.command(player, "idle go al-kharid-range");
  assert.deepEqual(api.teleports.at(-1), { player, x: 3272, y: 3180, z: 0, type: "normal" });
  // Cooking on a "Range": it suits, and carries on at Al Kharid's.
  assert.deepEqual(player.getAttribute("idle-mode:production-target").anchor, { x: 3272, y: 3180, z: 0 });
  assert.match(player.messages.pop(), /carries on making logs here/);
  // A furnace doesn't suit cooking: the player is told what to do, and nothing drags them back.
  api.command(player, "idle go al-kharid-furnace");
  assert.equal(player.getAttribute("idle-mode:production-target"), null);
  assert.match(player.messages.pop(), /Use an ore on the furnace and pick the bar/);
  // Gathering first: a production site clears it.
  const gatherer = idlePlayer();
  gatherer.setAttribute("idle-mode:auto-target", { skill: "WOODCUTTING", kind: "object", name: "Tree", option: "Chop down", anchor: { x: 1, y: 1, z: 0 } });
  api.command(gatherer, "idle go al-kharid-crafting");
  assert.equal(gatherer.getAttribute("idle-mode:auto-target"), null);
});

test("travel screen: a Making tab lists the production sites, and opens on them while making", (t) => {
  const { COMPONENT, uid } = require(TRAVEL_SCREEN);
  const { player } = cookingShrimps(t);
  api.command(player, "idle travel");
  const layout = JSON.parse(player.screen.texts.get(uid(COMPONENT.LAYOUT)));
  assert.equal(layout.active, 5, "the Making tab");
  const rows = JSON.parse(player.screen.texts.get(uid(COMPONENT.DATA)));
  const making = layout.tabs[5].map((id) => rows.find((row) => row.id === id).name);
  assert.deepEqual(making, ["Cooking range", "Cooking range", "Furnace", "Furnace", "Fletching, crafting, herblore"]);
  const range = rows.find((row) => row.name === "Cooking range");
  assert.equal(range.detail, " - Al Kharid, by the bank");
  assert.equal(range.panel.level, "Cooking: <col=00ff00>any level</col>");
  assert.match(range.panel.description, /Use a raw fish on the range/);
});

test("screen tabs: Stats shows the totals and hides the Overview; Overview brings it back; Travel opens travel", (t) => {
  const { COMPONENT, uid } = require(SCREEN);
  let now = 1_000_000;
  t.mock.method(Date, "now", () => now);
  const player = idlePlayer();
  player.setAttribute("idle-mode:onboarded", true);
  for (let i = 0; i <= 10; i++) {
    chop(player);
    now += 6000;
  }
  player.setAttribute("idle-mode:totals", {
    ...player.getAttribute("idle-mode:totals"), offlineMs: 3_600_000, bySkill: { WOODCUTTING: 250, MINING: 900 }, byItem: { [LOGS]: 10, [YEW_LOGS]: 3 },
  });
  api.command(player, "idle");
  assert.equal(player.screen.hidden.get(uid(COMPONENT.STATS_BOX)), true, "Overview first");
  assert.equal(player.screen.hidden.get(uid(COMPONENT.STATUS_BOX)), false);
  api.click(player, uid(COMPONENT.TAB_LABEL_START + 1));
  assert.equal(player.screen.hidden.get(uid(COMPONENT.STATS_BOX)), false);
  assert.equal(player.screen.hidden.get(uid(COMPONENT.STATUS_BOX)), true);
  assert.equal(player.screen.hidden.get(uid(require(SCREEN).slotComponent(0, require(SCREEN).SLOT.BUY_BUTTON))), true);
  assert.deepEqual([0, 1].map((line) => screenText(player, COMPONENT.SKILL_LINE_START + line)), ["Mining: 900 XP", "Woodcutting: 250 XP"]);
  assert.deepEqual([0, 1].map((line) => screenText(player, COMPONENT.ITEM_LINE_START + line)), ["Logs: 10", "Yew logs: 3"]);
  assert.equal(screenText(player, COMPONENT.STATS_TIME), "Time idle: 1m playing, 1h 0m away");
  assert.equal(screenText(player, COMPONENT.TAB_LABEL_START + 1), "Stats", "the active tab is white");
  assert.match(player.screen.texts.get(uid(COMPONENT.TAB_LABEL_START + 1)), /<col=ffffff>/);
  // Points coming in redraw the Stats tab, not the hidden Overview.
  api.emit("xp", { player, skill: Skill.WOODCUTTING, experience: 300 });
  assert.equal(player.screen.hidden.get(uid(COMPONENT.STATUS_BOX)), true);
  api.click(player, uid(COMPONENT.TAB_START));
  assert.equal(player.screen.hidden.get(uid(COMPONENT.STATUS_BOX)), false);
  assert.equal(player.screen.hidden.get(uid(COMPONENT.STATS_BOX)), true);
  api.click(player, uid(COMPONENT.TAB_START + 3));
  assert.equal(player.getInterfaceId(), require(TRAVEL_SCREEN).GROUP_ID);
});

test("screen tabs: a new account's Stats say nothing yet", () => {
  const { COMPONENT, uid } = require(SCREEN);
  const player = idlePlayer();
  api.command(player, "idle");
  api.click(player, uid(COMPONENT.TAB_START + 1));
  assert.equal(screenText(player, COMPONENT.SKILL_LINE_START), "Nothing yet");
  assert.equal(screenText(player, COMPONENT.ITEM_LINE_START), "Nothing yet");
  assert.equal(screenText(player, COMPONENT.SKILL_LINE_START + 1), "");
});

const GOALS = "../plugins/modes/idle/Goals.IdleMode";
const DAY = 24 * 60 * 60 * 1000;

/** Today's goals replaced by these (pool ids), for a test to steer. */
function setGoals(player, ids, now = Date.now()) {
  const { dayOf } = require(GOALS);
  const daily = { day: dayOf(now), bonus: false, goals: ids.map(([id, target]) => ({ id, target, progress: 0, done: false })) };
  player.setAttribute("idle-mode:daily", daily);
  return daily;
}

test("goals: three a day, the same for a name all day, new ones the next day; the day turns at 03:00 UTC", (t) => {
  const { today, dayOf, untilNextDay } = require(GOALS);
  const at = Date.UTC(2026, 10, 5, 12, 0, 0);
  const player = idlePlayer();
  player.getUsername = () => "Goaltest";
  const first = today(player, at);
  assert.equal(first.goals.length, 3);
  assert.equal(new Set(first.goals.map((goal) => goal.id)).size, 3, "three different goals");
  assert.deepEqual(today(player, at + 3_600_000), first, "the same all day");
  const other = idlePlayer();
  other.getUsername = () => "Goaltest";
  assert.deepEqual(today(other, at).goals.map((goal) => goal.id), first.goals.map((goal) => goal.id), "the same name, the same goals: no rerolls");
  const next = today(player, at + DAY);
  assert.equal(next.day, first.day + 1);
  assert.equal(dayOf(Date.UTC(2026, 10, 5, 2, 59)), dayOf(Date.UTC(2026, 10, 4, 12, 0)), "before 03:00 UTC it is still yesterday");
  assert.equal(untilNextDay(Date.UTC(2026, 10, 5, 2, 0)), 3_600_000);
});

test("goals: XP and gathering count, also offline; done pays points and says so; all three pay the bonus", (t) => {
  let now = 5_000_000;
  t.mock.method(Date, "now", () => now);
  const player = idlePlayer();
  player.setAttribute("idle-mode:onboarded", true);
  setGoals(player, [["woodcutting-xp", 500], ["gather", 20], ["time", 2]]);
  for (let i = 0; i <= 20; i++) {
    chop(player);
    now += 6000;
  }
  const daily = player.getAttribute("idle-mode:daily");
  assert.deepEqual(daily.goals.map((goal) => goal.done), [true, true, true]);
  assert.equal(daily.bonus, true);
  const said = player.messages.join("\n");
  assert.match(said, /Daily goal done:<\/col> Gain 500 Woodcutting XP\. \+25 idle points\./);
  assert.match(said, /All of today's goals done!<\/col> \+50 idle points\./);
  assert.equal(player.getAttribute("idle-mode:points"), 25 + 20 + 20 + 50, "the goals and the bonus (the fake chop's XP pays no points)");

  // Offline time away counts as well.
  setGoals(player, [["time", 60], ["woodcutting-xp", 1_000_000], ["make", 10]]);
  api.logout({ player });
  player.setAttribute("idle-mode:away", { activity: "WOODCUTTING", durationMs: 60_000, xp: { WOODCUTTING: 100 }, items: { [LOGS]: 10 }, loggedOutAt: now });
  now += 3_600_000;
  api.login({ player });
  const after = player.getAttribute("idle-mode:daily").goals;
  assert.equal(after[0].done, true, "an hour away does the 60 minutes");
  assert.equal(after[1].progress, 6000, "offline XP counts");
  assert.equal(after[2].progress, 0, "gathered items aren't made items");
});

test("goals: making and kills count by their own activities", (t) => {
  const { player, advance } = cookingShrimps(t);
  setGoals(player, [["make", 3], ["kills", 2], ["production-xp", 60]]);
  for (let i = 0; i < 3; i++) {
    advance(4000);
    api.emit("skills:produced", { player, skill: Skill.COOKING, itemId: SHRIMPS, amount: 1, xp: 30, kind: "cook" });
  }
  let goals = player.getAttribute("idle-mode:daily").goals;
  assert.equal(goals[0].progress, 3);
  const fighter = idlePlayer();
  setGoals(fighter, [["kills", 2]]);
  const cow = fakeMonster("Cow", 3201, 3200);
  api.emit("attack-option", { player: fighter, npc: cow, npcId: 2790, clickType: 2, handled: false });
  api.emit("npc-drops:generated", { player: fighter, npc: cow, npcId: 2790, drops: [], handled: false });
  api.emit("npc-drops:generated", { player: fighter, npc: fakeMonster("Goblin", 3201, 3200), npcId: 1, drops: [], handled: false });
  api.emit("npc-drops:generated", { player: fighter, npc: cow, npcId: 2790, drops: [], handled: false });
  goals = fighter.getAttribute("idle-mode:daily").goals;
  assert.equal(goals[0].progress, 2, "the cows, not the goblin that came at it");
  assert.equal(goals[0].done, true);
});

test("goals: bigger at higher levels; not for accounts that aren't idle", () => {
  const { today } = require(GOALS);
  const at = Date.UTC(2026, 10, 5, 12);
  const strong = idlePlayer({ WOODCUTTING: 99, MINING: 99, FISHING: 99, ATTACK: 99, STRENGTH: 99, DEFENCE: 99, RANGED: 99, MAGIC: 99, HITPOINTS: 99, COOKING: 99 });
  strong.combatLevel = 126;
  strong.getUsername = () => "Strong";
  const weak = idlePlayer({ WOODCUTTING: 1, MINING: 1, FISHING: 1, ATTACK: 1, STRENGTH: 1, DEFENCE: 1, RANGED: 1, MAGIC: 1, HITPOINTS: 10, COOKING: 1 });
  weak.combatLevel = 3;
  weak.getUsername = () => "Strong";
  const big = today(strong, at).goals;
  const small = today(weak, at).goals;
  for (let i = 0; i < big.length; i++) {
    if (["gather", "make", "time"].includes(big[i].id)) assert.equal(big[i].target, small[i].target);
    else assert.ok(big[i].target > small[i].target, `${big[i].id}: ${big[i].target} > ${small[i].target}`);
  }
  const plain = fakePlayer();
  setGoals(plain, [["woodcutting-xp", 10]]);
  chop(plain);
  chop(plain);
  assert.equal(plain.getAttribute("idle-mode:daily").goals[0].progress, 0);
});

test("goals tab: today's goals with progress and reward, the bonus and the next day", (t) => {
  const { COMPONENT, uid } = require(SCREEN);
  const at = Date.UTC(2026, 10, 5, 20, 30);
  t.mock.method(Date, "now", () => at);
  const player = idlePlayer();
  const daily = setGoals(player, [["woodcutting-xp", 2000], ["gather", 150], ["kills", 30]], at);
  daily.goals[0].progress = 2000;
  daily.goals[0].done = true;
  daily.goals[1].progress = 42.7;
  player.setAttribute("idle-mode:daily", daily);
  api.command(player, "idle");
  api.click(player, uid(COMPONENT.TAB_START + 2));
  assert.equal(player.screen.hidden.get(uid(COMPONENT.GOALS_BOX)), false);
  assert.equal(player.screen.hidden.get(uid(COMPONENT.STATS_BOX)), true);
  assert.equal(screenText(player, COMPONENT.GOAL_START), "Done Gain 2,000 Woodcutting XP");
  assert.equal(screenText(player, COMPONENT.GOAL_START + 3), "42 / 150 - reward 20 idle points");
  assert.equal(screenText(player, COMPONENT.GOAL_START + 4), "Defeat 30 monsters");
  assert.equal(screenText(player, COMPONENT.GOALS_BONUS), "Do all 3 for 50 more idle points (1/3 done).");
  assert.equal(screenText(player, COMPONENT.GOALS_NEXT), "New goals in 6h 30m.");
});

test("goals: a login on a new day says the day's goals", (t) => {
  const at = Date.UTC(2026, 10, 5, 12);
  t.mock.method(Date, "now", () => at);
  const player = idlePlayer();
  player.setAttribute("idle-mode:onboarded", true);
  player.getUsername = () => "Sayer";
  api.login({ player });
  assert.match(player.messages.at(-1), /Today's idle goals:<\/col> .+; .+; .+\./);
  const said = player.messages.length;
  api.login({ player });
  assert.equal(player.messages.length, said, "the same day: not said again");
});

test("work: an open Idle screen is closed to go back to work; any other interface waits", (t) => {
  const { GROUP_ID } = require(SCREEN);
  const { player, advance } = cookingShrimps(t);
  const { work } = require(PRODUCTION);
  player.isBusy = true;
  // busy() is true while an interface is open: the fake follows its interface id.
  player.busy = function busy() { return this.getInterfaceId() > 0; };
  api.command(player, "idle");
  assert.equal(player.getInterfaceId(), GROUP_ID);
  player.inventory = [new Item(SHRIMPS, 27)];
  advance(10_000);
  assert.equal(work(player, Date.now()), "repeated", "the Idle screen gave way");
  assert.equal(player.getInterfaceId(), -1);
  player.setInterfaceId(12);
  player.inventory = [new Item(SHRIMPS, 27)];
  advance(10_000);
  assert.equal(work(player, Date.now()), "busy", "the bank (or anything else) is left alone");
});
