// Run after `yarn build`: node --test tests/edgeville-dungeon.test.cjs
const assert = require("node:assert/strict");
const { test, before, beforeEach } = require("node:test");
const path = require("node:path");
const fs = require("node:fs");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { CacheDefinitions } = require("../dist/game/cache/CacheDefinitions");
const { RegionManager } = require("../dist/game/collision/RegionManager");
const { Location } = require("../dist/game/model/Location");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { TaskManager } = require("../dist/game/task/TaskManager");
const { ObjectManager } = require("../dist/game/entity/impl/object/ObjectManager");
const { ItemOnGroundManager } = require("../dist/game/entity/impl/grounditem/ItemOnGroundManager");
const ObstacleRunner = require("../plugins/skills/agility/ObstacleRunner");
const NpcDrops = require("../plugins/npcs/NpcDrops.plugin");
const Dungeon = require("../plugins/areas/EdgevilleDungeon.plugin");
const DungeonCommon = require("../plugins/areas/edgevilledungeon/Common.EdgevilleDungeon");
const BrassKeyDoor = require("../plugins/areas/edgevilledungeon/BrassKeyDoor.EdgevilleDungeon");
const GiantLairs = require("../plugins/bosses/GiantLairs.plugin");
const Common = require("../plugins/bosses/giantlairs/Common.GiantLairs");
const Lair = require("../plugins/bosses/giantlairs/Lair.GiantLairs");
const Obor = require("../plugins/bosses/giantlairs/Obor.GiantLairs");
const Bryophyta = require("../plugins/bosses/giantlairs/Bryophyta.GiantLairs");
const GiantBones = require("../plugins/bosses/giantlairs/GiantBones.GiantLairs");

// The data is loaded when the plugins register (before()).
let DATA = null;
let OBOR = null;
let BRYOPHYTA = null;
const core = PluginManager.getCoreApi();

const prompts = [];
const events = [];
const spawned = [];
const grounded = [];
const placed = [];
const customHandlers = new Map();
const deathHandlers = [];
const api = new Proxy({
  core,
  getTaskManager: () => TaskManager,
  getItemOnGroundManager: () => ({ registerLocation: (player, item, at, area) => grounded.push({ id: item.getId(), amount: item.getAmount(), x: at.getX(), y: at.getY(), area }) }),
  sendMultiChatboxPrompt: (player, title, ...pairs) => prompts.push({ player, title, pairs }),
  emitCustomEvent: (name, payload) => {
    events.push({ name, ...payload });
    for (const handler of customHandlers.get(name) ?? []) handler(payload);
  },
  onNpcDeath: (handler) => deathHandlers.push(handler),
  onCustomEvent: (name, handler) => customHandlers.set(name, [...(customHandlers.get(name) ?? []), handler]),
  spawnNpc: (definition) => {
    const npc = createNpc(definition);
    spawned.push(npc);
    return npc;
  },
}, { get: (target, key) => target[key] ?? (() => {}) });

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  RegionManager.init();
  for (const [x, y] of [[3091, 9805], [3220, 9933], [3115, 3450]]) RegionManager.loadMapFiles(x, y);
  ObstacleRunner.init(api);
  Dungeon.register(api);
  GiantLairs.register(api);
  DATA = Common.data;
  OBOR = DATA.lairs.obor;
  BRYOPHYTA = DATA.lairs.bryophyta;
  NpcDrops.register(api);
  ObjectManager.register = (object) => placed.push({ id: object.getId(), x: object.getLocation().getX(), y: object.getLocation().getY(), face: object.getFace() });
  ObjectManager.deregister = (object) => placed.push({ removed: object.getId() });
  ItemOnGroundManager.deregister = (item) => item.setPendingRemoval?.(true);
});

beforeEach(() => {
  for (const list of [prompts, events, spawned, grounded, placed]) list.length = 0;
});

let nextIndex = 1;
function createNpc({ id, x, y }) {
  let hitpoints = 100;
  let location = new Location(x, y, 0);
  const attacks = [];
  return {
    id, attacks, area: null,
    getId: () => id,
    getIndex: () => nextIndex++,
    isPlayer: () => false,
    isNpc: () => true,
    getAsNpc() { return this; },
    setFace() {},
    setArea(area) { this.area = area; },
    getArea() { return this.area; },
    getSize: () => CacheDefinitions.getNpc(id).size,
    getLocation: () => location,
    getHitpoints: () => hitpoints,
    setHitpoints: (value) => { hitpoints = value; },
    isRegistered: () => hitpoints > 0,
    getDefinition: () => ({ getName: () => CacheDefinitions.getNpc(id).name }),
    getCombat: () => ({ attack: (target) => attacks.push(target) }),
  };
}

function createPlayer({ x = 3095, y = 9832, items = [], weapon = -1 } = {}) {
  const log = [];
  const attributes = new Map();
  const inventory = [...items];
  let location = new Location(x, y, 0);
  let chain = null;
  let at = 0;
  let area = null;
  const sender = new Proxy({}, {
    get: (_target, method) => (...args) => {
      if (["sendVarbit", "sendConfig", "sendSound", "sendSoundEffect"].includes(method)) log.push(`${method} ${args.slice(0, 2).join(" ")}`);
      if (method === "sendInterfaceRemoval") log.push("close");
      if (method === "sendSubInterface") log.push(`fade ${args[3]?.postScripts?.[0]?.args?.[1]}`);
      return sender;
    },
  });
  const player = {
    log, inventory,
    getIndex: () => 1,
    getUsername: () => "tester",
    isPlayer: () => true,
    isPlayerBot: () => false,
    isNpc: () => false,
    getAsPlayer() { return player; },
    isRegistered: () => true,
    getHitpoints: () => 99,
    getArea: () => area,
    setArea: (value) => { area = value; },
    getPrivateArea: () => area,
    getPacketSender: () => sender,
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    getLocation: () => location,
    setLocation: (to) => { location = to; },
    moveTo: (to) => { location = to; log.push(`move ${to.getX()},${to.getY()}`); },
    sendMessage: (message) => log.push(message),
    performAnimation: (animation) => log.push(`anim ${animation.getId()}`),
    performGraphic: () => {},
    setWalkingDirection() {},
    setSkillAnimation() {},
    getUpdateFlag: () => ({ flag() {} }),
    setPositionToFace() {},
    setForceMovement() {},
    getForceMovement: () => null,
    getMovementQueue: () => ({ reset() {}, setBlockMovement() {}, handleRegionChange() {} }),
    getEquipment: () => ({ getItems: () => Object.assign([], { 3: { getId: () => weapon } }) }),
    getInventory: () => ({
      contains: (id) => inventory.includes(id),
      delete: (id) => { inventory.splice(inventory.indexOf(id), 1); },
      adds: (id) => inventory.push(id),
      getFreeSlots: () => 28 - inventory.length,
      getItems: () => inventory.map((id) => ({ getId: () => id })),
      full() {},
    }),
    getSkillManager: () => ({ addExperiences: (skill, xp) => log.push(`xp ${skill.getName?.() ?? skill} ${xp}`) }),
    getDialogueManager: () => manager,
    next: () => manager.advance(),
  };
  const show = () => {
    const entry = chain?.[at];
    if (!entry) return;
    if (entry.text != null) log.push(`say ${entry.text}`);
    else entry.send?.(player);
  };
  const manager = {
    startDialogues: (builder) => { chain = [...builder.getDialogues().values()]; at = 0; show(); },
    advance: () => { at++; show(); },
  };
  return player;
}

const runTicks = (n = 1) => { for (let i = 0; i < n; i++) TaskManager.process(); };
const lastPrompt = () => prompts[prompts.length - 1];
const choose = (prompt, label) => prompt.pairs[prompt.pairs.indexOf(label) + 1]();
const object = (id, x, y) => ({ objectId: id, location: { x, y, z: 0 } });

test("the data: every id as the cache names it, Bryophyta no longer in the open world", () => {
  const loc = (id) => CacheDefinitions.getObject(id).name;
  const item = (id) => CacheDefinitions.getItem(id).name;
  const npc = (id) => CacheDefinitions.getNpc(id).name;
  for (const lair of [OBOR, BRYOPHYTA]) {
    assert.equal(npc(lair.boss), lair.name);
    assert.equal(item(lair.key), lair.keyName);
    for (const id of lair.gates) assert.equal(loc(id), "Gate");
    assert.equal(loc(lair.chest.closed), "Chest");
    assert.equal(loc(lair.chest.open), "Chest");
    const main = lair.chestTable.entries.filter((entry) => !entry.always).reduce((sum, entry) => sum + entry.weight, 0);
    assert.equal(main, lair.chestTable.main_max_roll, `${lair.name}'s chest table adds up`);
    for (const entry of lair.chestTable.entries) if (entry.item_id) assert.equal(item(entry.item_id), entry.name);
  }
  assert.deepEqual(OBOR.exits.map(loc), ["Gate", "Gate"]);
  assert.equal(loc(BRYOPHYTA.exits[0]), "Rock Pile");
  assert.equal(loc(DATA.obor.pitRocks), "Rocks");
  assert.equal(loc(DATA.bryophyta.logs.withAxe), "Logs");
  assert.equal(npc(DATA.bryophyta.growthling), "Growthling");
  assert.equal(loc(DungeonCommon.data.brassKeyDoor.door), "Door");
  assert.equal(item(DungeonCommon.data.brassKeyDoor.key), "Brass key");
  assert.equal(item(DATA.giantBones.item), "Giant bones");
  const spawns = fs.readFileSync(path.resolve(__dirname, "../data/definitions/npc-spawns.json"), "utf8");
  assert.ok(!spawns.includes('"name":"Bryophyta"'), "she lives only in each player's lair");
});

test("as captured: the brass key door is locked without the key; with it, the player steps through and it shuts", () => {
  const door = DungeonCommon.data.brassKeyDoor;
  const without = createPlayer({ x: 3115, y: 3449 });
  BrassKeyDoor.open({ player: without, ...object(door.door, 3115, 3450) });
  assert.deepEqual(without.log, ["The door is locked."]);

  const player = createPlayer({ x: 3115, y: 3449, items: [door.key] });
  BrassKeyDoor.open({ player, ...object(door.door, 3115, 3450) });
  assert.deepEqual(player.log, ["You unlock the door.", "sendSound 2402 1"]);
  runTicks();
  assert.deepEqual(placed.slice(0, 2), [
    { id: 38848, x: 3115, y: 3450, face: 3 },
    { id: 1539, x: 3115, y: 3449, face: 0 },
  ]);
  assert.ok(player.log.includes("sendSound 62 1"));
  runTicks(3);
  assert.equal(player.getLocation().getY(), 3450, "through the door");
  assert.deepEqual(placed.slice(-2), [{ removed: 1539 }, { id: 1804, x: 3115, y: 3450, face: 3 }]);
  assert.deepEqual(player.inventory, [door.key], "the key is kept");
});

test("as captured: Obor's gate - locked, then the question, the fade, the lair and Obor; unlocked for good", () => {
  const locked = createPlayer();
  Lair.gate({ player: locked, ...object(29487, 3095, 9832) });
  assert.deepEqual(locked.log, ["The gate is locked shut."]);

  const player = createPlayer({ items: [OBOR.key] });
  Lair.gate({ player, ...object(29487, 3095, 9832) });
  assert.equal(lastPrompt().title, "Enter Obor's Lair?");
  choose(lastPrompt(), "Yes.");
  assert.ok(player.log.includes("fade 255"));
  runTicks(2);
  assert.ok(player.log.includes("move 3091,9815"));
  assert.equal(spawned.length, 1);
  assert.equal(spawned[0].id, OBOR.boss);
  runTicks();
  assert.ok(player.log.includes("Your key fits the gate, causing it to swing open."));
  assert.deepEqual(player.inventory, [OBOR.key], "the gate keeps the key");
  assert.equal(player.getAttribute(Common.UNLOCKED_ATTRIBUTE.obor), true);

  // Unlocked once: no key needed.
  player.inventory.length = 0;
  prompts.length = 0;
  Lair.gate({ player, ...object(29487, 3095, 9832) });
  assert.equal(lastPrompt().title, "Enter Obor's Lair?");
  Lair.sessionOf(player)?.end();
});

test("as captured: Bryophyta's gate warns first, then she attacks on arrival", () => {
  const player = createPlayer({ x: 3174, y: 9900, items: [BRYOPHYTA.key] });
  Lair.gate({ player, ...object(32534, 3174, 9901) });
  assert.ok(player.log[0].startsWith("say <col=7f0000>Warning!</col>"));
  player.next();
  assert.equal(lastPrompt().title, "Are you sure you wish to open it?");
  choose(lastPrompt(), "Yes, let's go!");
  assert.ok(player.log.includes("move 3214,9937"));
  assert.ok(player.log.includes("Your key fits the gate, causing it to swing open."));
  assert.equal(spawned[0].id, BRYOPHYTA.boss);
  assert.deepEqual(spawned[0].attacks, [player]);
  Lair.sessionOf(player).end();
});

function inLair(lair, items = []) {
  const player = createPlayer({ x: lair.inside.x, y: lair.inside.y, items });
  Lair.enter(player, lair, false);
  runTicks(4);
  const session = Lair.sessionOf(player);
  player.log.length = 0;
  return { player, session };
}

test("as captured: the chest - not while the boss lives; after a kill the stir, a key, the loot and the count; the boss back 15 ticks later", () => {
  const { player, session } = inLair(OBOR);
  const chest = () => Lair.openChest({ player, ...object(OBOR.chest.closed, OBOR.chest.x, OBOR.chest.y) });
  chest();
  assert.deepEqual(player.log, ["You can't loot the chest whilst Obor is still attacking you!"]);

  const boss = session.boss;
  boss.setHitpoints(0);
  Lair.onBossDeath({ npc: boss });
  player.log.length = 0;
  chest();
  assert.deepEqual(player.log, ["You hear the ground rumble...", "You need a Giant key to open this chest."]);
  player.log.length = 0;
  chest();
  assert.deepEqual(player.log, ["You need a Giant key to open this chest."], "the stir once a kill");

  player.inventory.push(OBOR.key);
  player.log.length = 0;
  chest();
  assert.deepEqual(player.log, ["anim 536", "sendSound 52 1"]);
  assert.deepEqual(player.inventory, [], "the chest uses the key");
  runTicks();
  assert.deepEqual(player.log.filter((line) => !line.startsWith("anim") && !line.startsWith("sendSound")), [
    "sendConfig 1529 1",
    "The loot spills out as you open the chest.",
    "Your Obor chests opened count is: <col=ff0000>1</col>.",
  ]);
  assert.equal(player.getAttribute(Common.CHESTS_ATTRIBUTE.obor), 1);
  const loot = grounded.map((drop) => drop.id);
  assert.ok(loot.includes(23182) && loot.includes(13475), "the clue and the ensouled head always");
  assert.ok(grounded.every((drop) => drop.x === OBOR.loot.x && drop.y === OBOR.loot.y && drop.area === session.area));
  assert.ok(events.some((event) => event.name === "collection-log:obtain" && event.itemId === 13475));
  assert.deepEqual(placed.at(-1), { id: OBOR.chest.open, x: OBOR.chest.x, y: OBOR.chest.y, face: OBOR.chest.face });

  player.inventory.push(OBOR.key);
  player.log.length = 0;
  chest();
  assert.deepEqual(player.log, [], "once a kill");
  spawned.length = 0;
  runTicks(13);
  assert.equal(spawned.length, 0);
  runTicks();
  assert.equal(spawned.length, 1, "Obor back 15 ticks after the first click");
  runTicks(5);
  assert.deepEqual(placed.at(-1), { id: OBOR.chest.closed, x: OBOR.chest.x, y: OBOR.chest.y, face: OBOR.chest.face });
  session.end();
});

test("the collection log counts chests opened", () => {
  const player = createPlayer();
  player.setAttribute(Common.CHESTS_ATTRIBUTE.bryophyta, 4);
  const request = { player, category: "Bryophyta", count: null };
  Lair.collectionLogCount(request);
  assert.equal(request.count, 4);
});

test("Obor: knocked back up to 5 tiles, stopped by the pit's walls; Protect from Missiles halves his ranged", () => {
  const obor = createNpc({ id: OBOR.boss, x: 3092, y: 9799 });
  const open = createPlayer({ x: 3091, y: 9800 });
  assert.equal(Obor.knockbackPath(obor, open).moved, 5);
  const walled = createPlayer({ x: 3082, y: 9800 });
  const near = createNpc({ id: OBOR.boss, x: 3083, y: 9800 });
  assert.ok(Obor.knockbackPath(near, walled).moved < 5, "the slide stops at a wall");

  const { CombatFactory, PrayerHandler } = core;
  const style = CombatFactory.applyStyleDamage;
  const prayer = PrayerHandler.isActivated;
  const hits = [{ damage: 0, setDamage(value) { this.damage = value; }, getDamage() { return this.damage; } }];
  const hit = { getHits: () => hits, updateTotalDamage() {} };
  CombatFactory.applyStyleDamage = (rolled, max, options) => {
    assert.equal(options.bypassProtectionPrayer, true);
    rolled.getHits()[0].setDamage(max - 1);
  };
  try {
    PrayerHandler.isActivated = () => false;
    Obor.rangedDamage(hit, { isPlayer: () => true });
    assert.equal(hits[0].damage, 25);
    PrayerHandler.isActivated = (_target, id) => id === PrayerHandler.PROTECT_FROM_MISSILES;
    Obor.rangedDamage(hit, { isPlayer: () => true });
    assert.equal(hits[0].damage, 12, "half through Protect from Missiles");
  } finally {
    CombatFactory.applyStyleDamage = style;
    PrayerHandler.isActivated = prayer;
  }
});

test("Bryophyta: immune while growthlings live; an axe prunes one at once, anything else is told to", () => {
  const { player, session } = inLair(BRYOPHYTA);
  const hitOn = (npc, attacker) => {
    const hits = [{ damage: 7, setDamage(value) { this.damage = value; }, getDamage() { return this.damage; } }];
    return { hits, getHits: () => hits, updateTotalDamage() {}, getAttacker: () => attacker, isAccurate: () => true };
  };
  const growthling = createNpc({ id: DATA.bryophyta.growthling, x: 3218, y: 9935 });
  growthling.setHitpoints(10);
  session.bryophyta = { growthlings: [growthling], lastSummon: 0 };
  const onBoss = hitOn(session.boss, player);
  Bryophyta.modifyHit({ npc: session.boss, hit: onBoss });
  assert.equal(onBoss.hits[0].damage, 0);

  const bare = hitOn(growthling, player);
  Bryophyta.modifyHit({ npc: growthling, hit: bare });
  assert.equal(bare.hits[0].damage, 7);
  growthling.setHitpoints(3);
  const finishing = hitOn(growthling, player);
  Bryophyta.modifyHit({ npc: growthling, hit: finishing });
  assert.equal(finishing.hits[0].damage, 2, "without an axe it never dies");
  growthling.setHitpoints(10);
  assert.ok(player.log.includes("Cut the growthling down with an axe or secateurs."));

  const axed = createPlayer({ weapon: 1351 });
  const pruned = hitOn(growthling, axed);
  Bryophyta.modifyHit({ npc: growthling, hit: pruned });
  assert.equal(pruned.hits[0].damage, 10);
  assert.ok(axed.log.includes("You prune the Growthling."));

  growthling.setHitpoints(0);
  const free = hitOn(session.boss, player);
  Bryophyta.modifyHit({ npc: session.boss, hit: free });
  assert.equal(free.hits[0].damage, 7, "hurt again once they are gone");
  session.end();
});

test("as captured: the stamp splashes on Obor's tile, then rocks fall on every tile to the player, who doesn't block", () => {
  const obor = createNpc({ id: OBOR.boss, x: 3093, y: 9800 });
  const player = createPlayer({ x: 3090, y: 9798 });
  const { origin, tiles } = Obor.rockLine(obor, player);
  assert.deepEqual([origin.getX(), origin.getY()], [3093, 9800]);
  assert.equal(tiles.length, 3);
  assert.deepEqual([tiles.at(-1).getX(), tiles.at(-1).getY()], [3090, 9798], "the last rock on the player");
  const method = new (Obor.defineOborCombatMethod())();
  for (const [action, knocked, blocks] of [["stamp", false, false], ["boulder", false, false], ["melee", true, false], ["melee", false, true]]) {
    Object.assign(method, { action, knocked });
    assert.equal(method.playsBlockAnimation(), blocks, `${action}${knocked ? " (knockback)" : ""}`);
  }
});

test("Bryophyta's earth blast flies at the captured heights (172/124, in the server's quarter units)", () => {
  assert.deepEqual([DATA.bryophyta.projectile.startHeight * 4, DATA.bryophyta.projectile.endHeight * 4], [172, 124]);
});

test("only woodcutting axes and magic secateurs prune (Wiki)", () => {
  const prunes = (weapon) => Bryophyta.canPrune(createPlayer({ weapon }));
  assert.equal(prunes(1351), true, "bronze axe");
  assert.equal(prunes(6739), true, "dragon axe");
  assert.equal(prunes(7409), true, "magic secateurs");
  assert.equal(prunes(1373), false, "rune battleaxe");
  assert.equal(prunes(-1), false);
});

test("as captured: the logs give a bronze axe once, then grow it back", () => {
  const { player, session } = inLair(BRYOPHYTA);
  Bryophyta.takeAxe({ player, ...object(DATA.bryophyta.logs.withAxe, 3228, 9932) });
  assert.deepEqual(player.inventory, [1351]);
  assert.ok(player.log.includes(`say ${DATA.bryophyta.logs.take}`));
  assert.equal(placed.at(-1).id, DATA.bryophyta.logs.withoutAxe);
  player.log.length = 0;
  Bryophyta.takeAxe({ player, ...object(DATA.bryophyta.logs.withAxe, 3228, 9932) });
  assert.deepEqual(player.log, ["say You already have an axe."]);
  runTicks(DATA.bryophyta.logs.returnTicks);
  assert.equal(placed.at(-1).id, DATA.bryophyta.logs.withAxe);
  session.end();
});

test("as captured: giant bones can't be taken; Bury asks, then buries them for 150 Prayer XP", () => {
  const player = createPlayer();
  const groundItem = { getItem: () => ({ getId: () => 30898 }), isPendingRemoval: () => false, setPendingRemoval() {} };
  const take = { player, groundItem, groundItemId: 30898, handled: false };
  GiantBones.take(take);
  assert.equal(take.handled, true);
  assert.deepEqual(player.log, ["I don't think those will fit in my backpack..."]);

  player.log.length = 0;
  GiantBones.bury({ player, groundItem, groundItemId: 30898, handled: false });
  assert.equal(lastPrompt().title, "Bury the bones? (This grants Prayer XP)");
  choose(lastPrompt(), "Yes, and don't ask again.");
  assert.ok(player.log.includes("anim 827"));
  assert.ok(player.log.some((line) => line.startsWith("xp ") && line.endsWith(" 150")));
  prompts.length = 0;
  GiantBones.bury({ player, groundItem, groundItemId: 30898, handled: false });
  assert.equal(prompts.length, 0, "not asked again");
});

test("the area's diary tasks: the obstacle pipe, a task from Vannaka, an Earth warrior beneath Edgeville", () => {
  const player = createPlayer();
  const tasks = () => events.filter((event) => event.name === "diary:task").map((event) => `${event.diary}:${event.task}`);
  for (const handler of customHandlers.get("agility:obstacle")) handler({ player, objectId: 16511, location: { x: 3150, y: 9906, z: 0 } });
  for (const handler of customHandlers.get("slayer:task-assigned")) handler({ player, master: 403, task: "hill-giants" });
  for (const handler of customHandlers.get("slayer:task-assigned")) handler({ player, master: 401, task: "hill-giants" });
  const warrior = (x, y) => deathHandlers[0]({ killer: player, npc: createNpc({ id: 2840, x, y }) });
  warrior(3120, 9990);
  warrior(3220, 3420);
  assert.deepEqual(tasks(), [
    "varrock:squeeze-through-an-obstacle-pipe-in-edgeville-du",
    "varrock:get-a-slayer-task-from-vannaka",
    "wilderness:kill-an-earth-warrior-in-the-wilderness-beneath",
  ]);
});

test("the chests' tables roll through the drop roller and its shared tables", () => {
  const request = { player: createPlayer(), table: BRYOPHYTA.chestTable, drops: [] };
  for (let i = 0; i < 50; i++) for (const handler of customHandlers.get("npc-drops:roll-table")) handler(request);
  assert.equal(request.drops.filter((drop) => drop.itemId === 23182).length, 50, "a clue every time");
  assert.ok(request.drops.length > 50, "and a roll on the table");
});
