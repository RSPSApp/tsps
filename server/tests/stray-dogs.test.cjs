const assert = require("node:assert/strict");
const { test, before } = require("node:test");
const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { NpcDefinition } = require("../dist/game/definition/NpcDefinition");
const { Inventory } = require("../dist/game/model/container/impl/Inventory");
let core;
before(() => {
  CachePipeline.initialize(require("node:path").resolve(__dirname, ".."));
  core = PluginManager.createApi("StrayDogs").core;
});

const names = [];

function scene(id = 2902) {
  const tasks = [], messages = [], chats = [], steps = [], events = [], fed = [], animations = [];
  let actions, feed, following, indoors = false, head = -1, registered = true;
  const player = {
    getLocation: () => new core.Location(3200, 3400, 0),
    getPrivateArea: () => null, getHitpoints: () => 10, isRegistered: () => registered,
    forceChat: text => chats.push(text), sendMessage: text => messages.push(text),
    performAnimation: animation => animations.push(animation.getId()),
    getPacketSender: () => ({ sendSoundEffect() {}, sendItemContainer() {} }),
    getEquipment: () => ({ get: () => new core.Item(head, 1) }),
  };
  const inventory = new Inventory(player);
  player.getInventory = () => inventory;
  const npc = {
    getLocation: () => new core.Location(3201, 3400, 0), getPrivateArea: () => null, isRegistered: () => true,
    setFollowing: target => { following = target; }, setMobileInteraction() {},
    getMovementQueue: () => ({ reset() {}, addSteps: tile => steps.push(tile) }),
    forceChat: text => chats.push(text),
  };
  require("../plugins/npcs/StrayDogs.plugin").register({
    core: { ...core, TaskManager: { submit: task => tasks.push(task) }, RegionManager: { getRegion: () => ({ isUnderRoof: () => indoors }) } },
    onNpcInteraction: (name, handlers) => { actions = handlers; names.push(name); },
    onItemOnNpc: handler => { feed = handler; },
    // The diary's events, and apart from them each "stray-dogs:fed".
    emitCustomEvent: (name, payload) => (name === "stray-dogs:fed" ? fed : events).push([name, payload]),
  });
  const definition = NpcDefinition.forId(id);
  return {
    player, npc, tasks, messages, chats, steps, events, fed, actions, animations,
    interact: action => actions[action]({ player, npc, definition }),
    feed: itemId => {
      inventory.setItem(3, new core.Item(itemId, 1));
      const event = { player, target: npc, definition, item: inventory.forSlot(3), itemId, slot: 3, handled: false };
      feed(event);
      return event;
    },
    get following() { return following; },
    set indoors(value) { indoors = value; },
    set head(value) { head = value; },
    set registered(value) { registered = value; },
  };
}

test("both public dogs Pet, temporarily follow, wait outside buildings, and Shoo-away cancels following", () => {
  for (const id of [2902, 2922]) {
    const s = scene(id);
    s.interact("Pet");
    assert.equal(s.following, s.player);
    assert.deepEqual(s.chats, ["Who's a good doggy!", "Woof!"]);
    s.indoors = true; s.tasks.at(-1).execute(); assert.equal(s.following, null);
    s.indoors = false; s.tasks.at(-1).execute(); assert.equal(s.following, s.player);
    s.interact("Shoo-away");
    assert.equal(s.following, null);
    assert.equal(s.tasks[0].isStopped(), true);
    assert.deepEqual(s.chats.slice(-2), ["Thbbbbt!", "Whine!"]);
    assert.ok(s.steps[0].getX() > s.npc.getLocation().getX());
  }
});

test("feeding consumes one bone or meat from its exact slot, and ordinary bones credit the diary", () => {
  for (const itemId of [526, 532, 536, 2132, 2134, 2136, 2138, 2142]) {
    const s = scene();
    s.player.getInventory().setItem(0, new core.Item(itemId, 1));
    assert.equal(s.feed(itemId).handled, true);
    // RSProx 227/1723 ticks 11458-11459: crouch on arrival, the food and the diary task a tick later.
    assert.deepEqual(s.animations, [core.CacheDefinitions.getSeqId("human_pickupfloor")]);
    assert.equal(s.events.length, 0);
    s.tasks.find((task) => task.getDelay() === 1).execute();
    assert.equal(s.messages.length, 1);
    assert.match(s.messages[0], /<br>/);
    assert.equal(s.player.getInventory().forSlot(3).getId(), -1);
    assert.equal(s.player.getInventory().forSlot(0).getId(), itemId);
    assert.equal(s.following, s.player);
    assert.equal(s.events.length, itemId === 526 ? 1 : 0);
    if (itemId === 526) assert.equal(s.events[0][1].task, "give-a-dog-a-bone");
    assert.deepEqual(s.fed.map(([, event]) => [event.player, event.npc, event.itemId, event.food]),
      [[s.player, s.npc, itemId, itemId >= 2132 ? "meat" : "bones"]], "one fed event, on the tick the dog eats");
  }
});

test("food the dog refuses, cat ears or food moved out of the slot feed no dog", () => {
  for (const itemId of [995, 527, 3123]) {
    const s = scene();
    s.feed(itemId);
    assert.deepEqual(s.fed, [], String(itemId));
  }
  const ears = scene();
  ears.head = core.ItemIdentifiers.CAT_EARS;
  ears.feed(526);
  assert.deepEqual(ears.fed, []);
  const moved = scene();
  moved.feed(526);
  assert.deepEqual(moved.fed, [], "nothing on the arrival tick");
  moved.player.getInventory().setItem(3, new core.Item(-1, 0));
  moved.tasks.find((task) => task.getDelay() === 1).execute();
  assert.deepEqual(moved.fed, []);
});

test("inedible, noted and forbidden bones are kept; quest dogs retain their handlers", () => {
  for (const itemId of [995, 527, 3123, 3130, 3133]) {
    const s = scene();
    assert.equal(s.feed(itemId).handled, true);
    assert.equal(s.player.getInventory().forSlot(3).getId(), itemId);
    assert.equal(s.tasks.length, 0);
    assert.ok(s.messages.length);
  }
  for (const id of [16504, 16505, 16529, 16530]) {
    const s = scene(id);
    assert.equal(s.interact("Pet"), false);
    assert.equal(s.feed(526).handled, false);
    assert.equal(s.player.getInventory().getAmount(526), 1);
  }
});

test("cat ears scare the dog without consuming food; following expires or ends on logout", () => {
  const s = scene();
  s.head = core.ItemIdentifiers.CAT_EARS;
  s.feed(526);
  assert.equal(s.player.getInventory().getAmount(526), 1);
  assert.equal(s.following, null);
  assert.match(s.messages[0], /ears/);
  s.head = -1; s.interact("Pet");
  for (let tick = 0; tick < 100; tick++) s.tasks.at(-1).execute();
  assert.equal(s.following, null);
  s.interact("Pet"); s.registered = false; s.tasks.at(-1).execute();
  assert.equal(s.following, null);
});

test("Varlamore's Molossus and Xolo pet as captured and shoo like stray dogs; the cabbage dogs can't be (#2449)", () => {
  const ids = core.CacheDefinitions;
  assert.ok(names.includes("Molossus") && names.includes("Xolo"));
  for (const gameval of ["varlamore_dog_molossus_1", "varlamore_dog_molossus_2", "varlamore_dog_xolo", "varlamore_dog_xolo_indoors"]) {
    const s = scene(ids.getNpcId(gameval));
    s.interact("Pet");
    // RSProx 237/1098: human_pickupfloor on arrival, the dog's Woof! two ticks later.
    assert.deepEqual(s.animations, [ids.getSeqId("human_pickupfloor")], gameval);
    assert.deepEqual(s.chats, ["Who's a good doggy!"]);
    assert.equal(s.following, s.player);
    const woof = s.tasks.find((task) => task.getDelay() === 2);
    assert.ok(woof, "the woof waits two ticks");
    woof.execute();
    assert.deepEqual(s.chats, ["Who's a good doggy!", "Woof!"]);
    s.interact("Shoo-away");
    assert.equal(s.following, null);
    assert.deepEqual(s.chats.slice(-2), ["Thbbbbt!", "Whine!"]);
    s.head = core.ItemIdentifiers.CAT_EARS;
    s.interact("Pet");
    assert.equal(s.messages.at(-1), "The dog doesn't approve of your ears.");
    assert.equal(s.feed(526).handled, true);
    assert.equal(s.events.length, 0, "only the stray dog's bone is the Varrock diary's");
  }
  for (const gameval of ["varlamore_dog_molossus_cabbage", "varlamore_dog_xolo_cabbage"]) {
    const s = scene(ids.getNpcId(gameval));
    assert.equal(s.interact("Pet"), false, `${gameval} has no options`);
  }
});

test("Chiribaya and Techichi pet and shoo like Molossus; their option-less forms can't be", () => {
  const ids = core.CacheDefinitions;
  assert.ok(names.includes("Chiribaya") && names.includes("Techichi"));
  for (const gameval of ["varlamore_dog_chiribaya_1", "varlamore_dog_chiribaya_2", "varlamore_dog_chiribaya_1_indoors",
    "varlamore_dog_chiribaya_2_indoors", "varlamore_dog_techichi", "varlamore_dog_techichi_2", "varlamore_dog_techichi_indoors"]) {
    const s = scene(ids.getNpcId(gameval));
    s.interact("Pet");
    // RSProx 237/1098 ticks 9807/9825 (Chiribaya): human_pickupfloor, "Woof!" and sound 652 two ticks later.
    assert.deepEqual(s.animations, [ids.getSeqId("human_pickupfloor")], gameval);
    assert.deepEqual(s.chats, ["Who's a good doggy!"]);
    s.tasks.find((task) => task.getDelay() === 2).execute();
    assert.deepEqual(s.chats, ["Who's a good doggy!", "Woof!"]);
    assert.equal(s.following, s.player);
    s.interact("Shoo-away");
    assert.equal(s.following, null);
    assert.deepEqual(s.chats.slice(-2), ["Thbbbbt!", "Whine!"]);
  }
  for (const gameval of ["varlamore_dog_chiribaya_cabbage", "varlamore_dog_chiribaya_corn",
    "varlamore_dog_techichi_aldarin_villa", "varlamore_dog_techichi_kastori"]) {
    const s = scene(ids.getNpcId(gameval));
    assert.equal(s.interact("Pet"), false, `${gameval} has no options`);
  }
});

test("Varlamore dogs eat as captured: crouch and Woof woof!, then one tick later the food, one joined message and synth 2393", () => {
  const ids = core.CacheDefinitions;
  for (const [itemId, message] of [
    [526, "You give the dog some nice bones.<br>It happily gnaws on them."],
    [2132, "You give the dog a nice piece of meat.<br>It gobbles it up."],
  ]) {
    const s = scene(ids.getNpcId("varlamore_dog_chiribaya_2"));
    const sounds = [];
    s.player.getPacketSender = () => ({ sendSoundEffect: (id) => sounds.push(id), sendItemContainer() {} });
    assert.equal(s.feed(itemId).handled, true);
    // RSProx 237/1098 tick 10200: arrival tick.
    assert.deepEqual(s.animations, [ids.getSeqId("human_pickupfloor")]);
    assert.deepEqual(s.chats, ["Woof woof!"]);
    assert.equal(s.player.getInventory().forSlot(3).getId(), itemId, "the food stays until the next tick");
    assert.equal(s.messages.length, 0);
    const eat = s.tasks.find((task) => task.getDelay() === 1);
    assert.ok(eat, "the dog takes it a tick later");
    eat.execute();
    assert.equal(s.player.getInventory().forSlot(3).getId(), -1);
    assert.deepEqual(s.messages, [message]);
    assert.deepEqual(sounds, [2393]);
    assert.equal(s.following, s.player);
    assert.equal(s.events.length, 0);
  }
  const s = scene(ids.getNpcId("varlamore_dog_techichi"));
  s.feed(526);
  s.player.getInventory().setItem(3, new core.Item(-1, 0));
  s.tasks.find((task) => task.getDelay() === 1).execute();
  assert.equal(s.messages.length, 0, "food moved out of the slot isn't eaten");
  assert.equal(s.following, undefined);
});

test("Chiribaya and Techichi spawns use the variant each tile shows in RSProx captures", () => {
  const spawns = JSON.parse(require("node:fs").readFileSync(require("node:path").join(__dirname, "../data/definitions/npc-spawns.json"), "utf8"));
  const at = (x, y) => spawns.find((row) => row.x === x && row.y === y && /^(Chiribaya|Techichi)$/.test(row.name));
  const ids = core.CacheDefinitions;
  for (const [x, y, gameval] of [
    [1353, 2962, "varlamore_dog_techichi"], [1388, 2936, "varlamore_dog_techichi"], [1235, 3092, "varlamore_dog_techichi"],
    [1381, 3068, "varlamore_dog_techichi"], [1388, 2955, "varlamore_dog_techichi_aldarin_villa"],
    [1353, 3039, "varlamore_dog_techichi_kastori"], [1496, 3231, "varlamore_dog_chiribaya_2"],
    [1587, 3127, "varlamore_dog_chiribaya_2_indoors"], [1597, 3111, "varlamore_dog_chiribaya_1"],
    [1421, 2973, "varlamore_dog_chiribaya_1"], [1376, 2938, "varlamore_dog_chiribaya_2"], [1368, 3309, "varlamore_dog_chiribaya_2"],
    [1371, 3062, "varlamore_dog_chiribaya_corn"], [1206, 3109, "varlamore_dog_chiribaya_1"],
    [1356, 3023, "varlamore_dog_chiribaya_2"], [1401, 3353, "varlamore_dog_chiribaya_2"],
  ]) assert.equal(at(x, y)?.id, ids.getNpcId(gameval), `${x},${y} ${gameval}`);
  for (const [x, y] of [[1388, 2955], [1353, 3039], [1371, 3062]]) assert.equal(at(x, y).wanderRadius, 0);
});
