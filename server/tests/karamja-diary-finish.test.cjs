const assert = require("node:assert/strict");
const path = require("node:path");
const { before, test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const Diaries = require("../plugins/achievements/AchievementDiaries.plugin");
const DiaryData = require("../plugins/achievements/diaries/Data.AchievementDiaries");
const Progress = require("../plugins/achievements/diaries/Progress.AchievementDiaries");
const Finish = require("../plugins/achievements/diaries/KaramjaDiaryFinish.plugin");
const Cart = require("../plugins/world/ShiloCart.plugin");
const Lady = require("../plugins/world/LadyOfTheWaves.plugin");
const Palm = require("../plugins/objects/LeafyPalmTree.plugin");

let core;
const diary = DiaryData.BY_KEY.get("karamja");
const F = Finish._test;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  core = PluginManager.getCoreApi();
});

/** A tiny event bus/proxy good enough for the diary plugin and the gameplay plugins. */
function bus({ quests = {}, elite = false } = {}) {
  const listeners = new Map();
  const ground = { items: [], registerLocation(player, item, location) { this.items.push({ player, item, location }); } };
  const api = new Proxy({
    core,
    persistAttribute() {},
    getItemOnGroundManager: () => ground,
    getTaskManager: () => ({ submit() {} }),
    onCustomEvent(name, handler) {
      const list = listeners.get(name) ?? [];
      list.push(handler);
      listeners.set(name, list);
    },
    onNpcDialogueVariant(handler) { listeners.set("variant", [...(listeners.get("variant") ?? []), handler]); },
    onNpcDialogueCondition(handler) { listeners.set("condition", [...(listeners.get("condition") ?? []), handler]); },
    onObjectInteraction(name, handlers) {
      for (const [option, handler] of Object.entries(handlers)) {
        listeners.set(`object:${name}:${option}`, [...(listeners.get(`object:${name}:${option}`) ?? []), handler]);
      }
    },
    onNpcInteraction(name, handlers) {
      for (const [option, handler] of Object.entries(handlers)) {
        listeners.set(`npc:${name}:${option}`, [...(listeners.get(`npc:${name}:${option}`) ?? []), handler]);
      }
    },
    emitCustomEvent(name, event) {
      if (name === "quest:is-complete") event.complete = quests[event.key] === true;
      if (name === "quest:is-started") event.started = quests[`${event.key}:started`] === true;
      if (name === "diary:is-complete") event.complete = elite;
      for (const handler of listeners.get(name) ?? []) handler(event);
    },
    fire(name, event) {
      if (name === "variant") {
        for (const handler of listeners.get("variant") ?? []) {
          const result = handler(event);
          if (result) return result;
        }
        return null;
      }
      if (name === "condition") {
        for (const handler of listeners.get("condition") ?? []) {
          const result = handler(event);
          if (result !== null && result !== undefined) return result;
        }
        return null;
      }
      for (const handler of listeners.get(name) ?? []) handler(event);
    },
  }, { get: (target, key) => key in target ? target[key] : () => {} });
  return api;
}

function playerAt(x, y, z = 0, { coins = 0, items = {}, area = null } = {}) {
  const attributes = new Map();
  const counts = new Map(Object.entries(items).map(([id, amount]) => [Number(id), amount]));
  if (coins) counts.set(core.ItemIdentifiers.COINS, coins);
  const messages = [];
  const sender = { sendVarbit() { return sender; } };
  const inventory = {
    getAmount: (id) => counts.get(id) ?? 0,
    contains: (id) => (counts.get(id) ?? 0) > 0,
    isFull: () => false,
    deleteNumber(id, amount) {
      const left = (counts.get(id) ?? 0) - amount;
      if (left > 0) counts.set(id, left); else counts.delete(id);
    },
    adds(id, amount) { counts.set(id, (counts.get(id) ?? 0) + amount); },
    refreshItems() {},
  };
  return {
    attributes, messages, counts, inventory,
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    getLocation: () => new core.Location(x, y, z),
    getPrivateArea: () => area,
    isPlayer: () => true,
    isRegistered: () => true,
    sendMessage: (message) => messages.push(message),
    moveTo: (location) => { attributes.set("moved", location); },
    getInventory: () => inventory,
    getPacketSender: () => sender,
    getEquipment: () => ({ get: () => null }),
  };
}

const done = (player) => Progress.doneTasks(player, diary);
const task = (key) => key;

function diaryBus() {
  const api = bus();
  Progress(api);
  api.onCustomEvent("diary:task", Diaries._test.onTask);
  Finish.register(api);
  return api;
}

test("Musa Point ferry credits the Port Sarim task on arrival only", () => {
  const api = diaryBus();
  const player = playerAt(2956, 3143);
  api.emitCustomEvent("pirate-s-treasure:arrived", { player, route: "musa" });
  assert.equal(done(player).size, 0);
  api.emitCustomEvent("ferries:arrived", { player, route: "musa-point-port-sarim" });
  assert.ok(done(player).has(F.TASK.musaFerry));
});

test("the Crandor wall and surface route are separate credits", () => {
  const api = diaryBus();
  const player = playerAt(2836, 9600);
  api.emitCustomEvent("dragon-slayer:crandor-wall", { player });
  assert.ok(done(player).has(F.TASK.hiddenWall));
  assert.equal(done(player).has(F.TASK.crandor), false);
  api.emitCustomEvent("dragon-slayer:crandor-visited", { player });
  assert.ok(done(player).has(F.TASK.crandor));
});

test("cart and Lady of the Waves credit their own tasks", () => {
  const api = diaryBus();
  const player = playerAt(2777, 3211);
  api.emitCustomEvent("shilo-cart:arrived", { player });
  assert.ok(done(player).has(F.TASK.cart));
  assert.equal(done(player).has(F.TASK.ladyOfWaves), false);
  api.emitCustomEvent("lady-of-the-waves:sailed", { player, destination: "port-sarim" });
  assert.equal(done(player).has(F.TASK.ladyOfWaves), false);
  api.emitCustomEvent("lady-of-the-waves:sailed", { player, destination: "port-khazard" });
  assert.ok(done(player).has(F.TASK.ladyOfWaves));
});

test("the Strong Tree grapple, not the barehanded swim, credits the crossbow task", () => {
  const api = diaryBus();
  const bare = playerAt(2874, 3142);
  api.emitCustomEvent("agility:obstacle", { player: bare, shortcut: "Strong Tree (Karamja)", method: "barehanded" });
  assert.equal(done(bare).has(F.TASK.crossbow), false);
  const grapple = playerAt(2874, 3142);
  api.emitCustomEvent("agility:obstacle", { player: grapple, shortcut: "Strong Tree (Karamja)", method: "grapple" });
  assert.ok(done(grapple).has(F.TASK.crossbow));

  const wrong = playerAt(2874, 3142);
  api.emitCustomEvent("agility:obstacle", { player: wrong, shortcut: "Stepping stones (Eastern Brimhaven Dungeon)" });
  assert.equal(done(wrong).has(F.TASK.steppingStones), false);
  api.emitCustomEvent("agility:obstacle", { player: wrong, shortcut: "Stepping stones (Western Brimhaven Dungeon)" });
  assert.ok(done(wrong).has(F.TASK.steppingStones));
});

test("five palm-leaf pickups count; other items do not", () => {
  const api = diaryBus();
  const player = playerAt(2790, 2910);
  for (let i = 0; i < 4; i++) {
    api.emitCustomEvent("ground-items:taken", { player, itemId: core.ItemIdentifiers.PALM_LEAF, amount: 1 });
    assert.equal(done(player).has(F.TASK.palmLeaves), false);
  }
  api.emitCustomEvent("ground-items:taken", { player, itemId: core.ItemIdentifiers.SEAWEED, amount: 1 });
  assert.equal(done(player).has(F.TASK.palmLeaves), false);
  api.emitCustomEvent("ground-items:taken", { player, itemId: core.ItemIdentifiers.PALM_LEAF, amount: 1 });
  assert.ok(done(player).has(F.TASK.palmLeaves));
});

test("only the entrance vine, going deeper, credits the vines task", () => {
  const api = diaryBus();
  const player = playerAt(2690, 9564);
  api.emitCustomEvent("brimhaven-dungeon:vines-cut", { player, vine: "karam_dungeon_vineblocking2", inward: true });
  api.emitCustomEvent("brimhaven-dungeon:vines-cut", { player, vine: "karam_dungeon_vineblocking1", inward: false });
  assert.equal(done(player).has(F.TASK.vines), false);
  api.emitCustomEvent("brimhaven-dungeon:vines-cut", { player, vine: "karam_dungeon_vineblocking1", inward: true });
  assert.ok(done(player).has(F.TASK.vines));
});

test("the Brimhaven stairs credit only from the stair locs", () => {
  const api = diaryBus();
  const player = playerAt(2635, 9514);
  api.emitCustomEvent("loc-teleports:arrived", { player, objectId: 20878, location: { x: 2714, y: 9564, z: 0 } });
  assert.equal(done(player).has(F.TASK.stairs), false);
  api.emitCustomEvent("loc-teleports:arrived", { player, objectId: 21725, location: { x: 2635, y: 9514, z: 0 } });
  assert.ok(done(player).has(F.TASK.stairs));
});

test("health checks credit the Brimhaven fruit tree and palm and Imiago's calquat", () => {
  const api = diaryBus();
  const fruit = playerAt(2764, 3212);
  api.emitCustomEvent("farming:check-health", {
    player: fruit, crop: "APPLE", type: "FRUIT_TREE", patch: { id: 7964, x: 2764, y: 3212, z: 0 },
  });
  assert.ok(done(fruit).has(F.TASK.fruitTree));
  assert.equal(done(fruit).has(F.TASK.palmHealth), false);

  const palm = playerAt(2764, 3212);
  api.emitCustomEvent("farming:check-health", {
    player: palm, crop: "PALM", type: "FRUIT_TREE", patch: { id: 7964, x: 2764, y: 3212, z: 0 },
  });
  assert.ok(done(palm).has(F.TASK.palmHealth));

  const wrong = playerAt(2764, 3212);
  api.emitCustomEvent("farming:check-health", {
    player: wrong, crop: "APPLE", type: "FRUIT_TREE", patch: { id: 34007, x: 1242, y: 3758, z: 0 },
  });
  assert.equal(done(wrong).has(F.TASK.fruitTree), false);

  const calquat = playerAt(2795, 3100);
  api.emitCustomEvent("farming:check-health", {
    player: calquat, crop: "CALQUAT", type: "CALQUAT", patch: { id: 7807, x: 2795, y: 3100, z: 0 },
  });
  assert.ok(done(calquat).has(F.TASK.calquat));
});

test("cart fare is about 5% clamped to 10-200, free after the elite diary", () => {
  const ordinary = bus({ quests: { shilo_village: true } });
  Cart.register(ordinary);
  assert.equal(Cart._test.fareFor(playerAt(0, 0, 0, { coins: 0 })), 10);
  assert.equal(Cart._test.fareFor(playerAt(0, 0, 0, { coins: 500 })), 25);
  assert.equal(Cart._test.fareFor(playerAt(0, 0, 0, { coins: 100000 })), 200);
  const elite = bus({ quests: { shilo_village: true }, elite: true });
  Cart.register(elite);
  assert.equal(Cart._test.fareFor(playerAt(0, 0, 0, { coins: 100000 })), 0);
});

test("a cart ride takes the quoted fare and moves to the other cart; a poor player stays", () => {
  const api = bus({ quests: { shilo_village: true } });
  Cart.register(api);
  const driver = Cart._test.DRIVERS.get(5356);
  const rider = playerAt(2777, 3211, 0, { coins: 500 });
  assert.equal(Cart._test.ride(rider, driver, 25), true);
  assert.equal(rider.getInventory().getAmount(core.ItemIdentifiers.COINS), 475);
  assert.equal(rider.getAttribute("moved").getX(), 2834);
  assert.equal(rider.getAttribute("moved").getY(), 2951);

  const poor = playerAt(2777, 3211, 0, { coins: 10 });
  assert.equal(Cart._test.ride(poor, driver, 25), false);
  assert.equal(poor.getAttribute("moved"), undefined);
});

test("Vigroy's exported message charges and arrives, without a speech-line event", () => {
  const api = bus({ quests: { shilo_village: true } });
  Cart.register(api);
  const player = playerAt(2831, 2952, 0, { coins: 500 });
  const definition = { getName: () => "Vigroy" };
  api.fire("variant", { player, definition });
  const transcript = require("../data/definitions/npc-dialogues.json").Vigroy;
  const variant = transcript.variants[Cart._test.DRIVERS.get(5357).normal];
  const message = variant[1].options[0].steps[1].steps[0];
  assert.equal(message.type, "message");
  api.fire("npc-dialogue:action", { player, definition, kind: message.type, text: message.text });
  assert.equal(player.getAttribute("moved").getY(), 3214);
  assert.equal(player.getInventory().getAmount(core.ItemIdentifiers.COINS), 475);
});

test("cart Pay-fare refuses players who have not completed Shilo Village", () => {
  const api = bus();
  Cart.register(api);
  for (const use of [
    player => Cart._test.payFareCart({ player, objectId: 2230 }),
    player => Cart._test.payFareNpc({ player, definition: { getName: () => "Hajedy" } }),
  ]) {
    const player = playerAt(2777, 3211, 0, { coins: 500 });
    use(player);
    assert.equal(player.getAttribute("moved"), undefined);
    assert.equal(player.getInventory().getAmount(core.ItemIdentifiers.COINS), 500);
  }
});

test("Lady of the Waves sells its ticket, refuses without coins, and credits Port Khazard only", () => {
  const api = bus({ quests: { shilo_village: true } });
  Lady.register(api);
  const poor = playerAt(2763, 2961, 0, { coins: 0 });
  const shanks = { getName: () => "Captain Shanks" };
  assert.equal(api.fire("variant", { player: poor, definition: shanks }), "after-completion-of-shilo-village-if-the-player-does-not-have-a-ship-ticket");
  assert.equal(api.fire("condition", { player: poor, definition: shanks, text: "If the player does not have enough money:" }), true);

  const buyer = playerAt(2763, 2961, 0, { coins: 50 });
  api.fire("variant", { player: buyer, definition: shanks });
  const line = { player: buyer, definition: shanks, text: "It's a good deal and no mistake. Here you go, me old shipmate, here's your ticket." };
  api.fire("npc-dialogue:line", line);
  assert.equal(buyer.getInventory().getAmount(Lady._test.SHIP_TICKET), 1);
  assert.ok(buyer.getInventory().getAmount(core.ItemIdentifiers.COINS) < 50);

  const arrival = { player: buyer, definition: shanks, kind: "message", text: "You arrive safely in the quiet fishing port of Khazard." };
  api.fire("npc-dialogue:action", arrival);
  assert.equal(buyer.getAttribute("moved").getX(), 2680);
  assert.equal(buyer.getInventory().getAmount(Lady._test.SHIP_TICKET), 0);

  const wrong = playerAt(2763, 2961, 0, { coins: 50, items: { 621: 1 } });
  api.fire("variant", { player: wrong, definition: shanks });
  api.fire("npc-dialogue:action", { player: wrong, definition: shanks, kind: "message", text: "The ship arrives in busy Port Sarim." });
  assert.equal(wrong.getAttribute("moved").getY(), 3192);
});

test("shaking a leafy palm drops one leaf on a 35-second cooldown", () => {
  const api = bus();
  Palm.register(api);
  const tree = { getLocation: () => new core.Location(2777, 2906, 0) };
  const player = playerAt(2777, 2907);
  const manager = api.getItemOnGroundManager();
  assert.equal(Palm._test.shake({ player, object: tree }), true);
  assert.equal(manager.items.length, 1);
  assert.equal(manager.items[0].item.getId(), core.ItemIdentifiers.PALM_LEAF);
  assert.equal(Palm._test.shake({ player, object: tree }), true);
  assert.equal(manager.items.length, 1);
});


test("Captain Shanks cannot charge for a ticket that will not fit or sail without one", () => {
  const api = bus({ quests: { shilo_village: true } });
  Lady.register(api);
  const definition = { getName: () => "Captain Shanks" };
  const player = playerAt(2763, 2961, 0, { coins: 100 });
  player.inventory.isFull = () => true;
  api.fire("npc-dialogue:line", { player, definition, text: "It's a good deal and no mistake. Here you go, me old shipmate, here's your ticket." });
  assert.equal(player.inventory.getAmount(core.ItemIdentifiers.COINS), 100);
  assert.equal(player.inventory.getAmount(Lady._test.SHIP_TICKET), 0);
  api.fire("npc-dialogue:action", { player, definition, kind: "message", text: "You arrive safely in the quiet fishing port of Khazard." });
  assert.equal(player.getAttribute("moved"), undefined);
});
