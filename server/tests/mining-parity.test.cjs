// From server/: node --test tests/mining-parity.test.cjs (after yarn build).
// Mining a rock as live OSRS does it: rsprox recordings 3139 and 3182 (iron), 1105/3280 (mithril),
// 73 (no pickaxe), 403 (a gem), and the Wiki rock pages (level, XP, respawn, success chart), Pickaxe
// (ticks between rolls), Skilling success rate and Template:MiningPreGemDropTable.
const assert = require("node:assert/strict");
const path = require("node:path");
const { test, before } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { PluginManager } = require("../dist/plugins/PluginManager");
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { MapObjects } = require("../dist/game/entity/impl/object/MapObjects");
const { GameObject } = require("../dist/game/entity/impl/object/GameObject");
const { ItemIds } = require("../dist/util/IdEnums");

const core = PluginManager.getCoreApi();
const MINING_PLUGIN = require.resolve("../plugins/skills/Mining.plugin");
let Mining = require(MINING_PLUGIN);

const MINING_SUCCESS_SOUND = 3600;
const SMELT_SOUND = 2725;
const RESPAWN_TIMER_SCRIPT = 5474;
const ORE_MINED_VARP = 4526; // tracking_ore_mined
const RESET_ANIMATION = core.Animation.DEFAULT_RESET_ANIMATION.getId();
const noop = () => {};

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
});

function loc(name) {
  return core.CacheDefinitions.getLocId(name);
}

function createPlayer({ pickaxe = ItemIds.RUNE_PICKAXE, level = 99, full = false, amulet = -1 } = {}) {
  const attributes = new Map();
  const packets = { sounds: [], configs: [], scripts: [] };
  const added = [];
  const dialogues = [];
  const xp = [];
  const sender = {
    sendSoundEffect: (id) => packets.sounds.push(id),
    sendConfig: (id, value) => packets.configs.push([id, value]),
    sendClientScript: (...args) => packets.scripts.push(args),
    // Spam lines land in `messages` too; `spam` keeps which ones went to that channel.
    sendTypedMessage: (type, text) => {
      player.messages.push(text);
      if (type === core.ChatType.SPAM) player.spam.push(text);
    },
  };
  const player = {
    packets, added, dialogues, xp, messages: [], spam: [], animations: [], graphics: [],
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    getPacketSender: () => sender,
    getDialogueManager: () => ({ startDialogues: (chain) => dialogues.push(chain) }),
    getInventory: () => ({
      contains: (id) => id === pickaxe,
      isFull: () => full,
      adds: (id, amount) => added.push([id, amount]),
      getAddableAmount: (item) => item.getAmount(),
      add: (item) => added.push([item.getId(), item.getAmount()]),
      getItems: () => [],
    }),
    getEquipment: () => ({ getItems: () => (amulet > 0 ? [null, null, { getId: () => amulet }] : []) }),
    getSkillManager: () => ({
      getCurrentLevel: () => level,
      addExperiences: (skill, amount) => xp.push([skill, amount]),
    }),
    getMovementQueue: () => ({ size: () => 0 }),
    getForceMovement: () => null,
    getHitpoints: () => 10,
    isRegistered: () => true,
    getLocation: () => new core.Location(3285, 3367, 0),
    sendMessage(text) { player.messages.push(text); },
    performAnimation(animation) { player.animations.push(animation.getId()); },
    performGraphic(graphic) { player.graphics.push([graphic.id, graphic.height]); },
  };
  return player;
}

function harness({ emit = noop } = {}) {
  const interactions = new Map();
  const hooks = {};
  const tasks = [];
  const registered = [];
  const events = {};
  const api = new Proxy({
    core,
    getTaskManager: () => ({ submit(task) { task.setRunning(true); tasks.push(task); } }),
    getObjectManager: () => ({ register: (object) => registered.push(object), deregister: noop }),
    onObjectInteraction: (name, actions) => interactions.set(name, actions),
    onPlayerLogin: (fn) => { hooks.login = fn; },
    onCustomEvent: (key, fn) => { events[key] = fn; },
    emitCustomEvent: emit,
    persistAttribute: noop,
  }, { get: (target, key) => target[key] ?? noop });
  // The plugin keeps its tick counter at module level; each harness is a fresh server.
  delete require.cache[MINING_PLUGIN];
  Mining = require(MINING_PLUGIN);
  Mining.register(api);
  return {
    interactions, hooks, registered, events,
    tick(count = 1) { while (count-- > 0) [...tasks].forEach((task) => task.tick()); },
  };
}

function mineRock(h, player, name, rockId, x = 3285, y = 3368) {
  const rock = new GameObject(rockId, new core.Location(x, y, 0), 10, 0, null);
  const original = MapObjects.get;
  MapObjects.get = (id) => (id === rock.getId() ? rock : null);
  h.interactions.get(name).Mine({ player, object: rock, definition: { getName: () => name } });
  return { rock, restore: () => { MapObjects.get = original; } };
}

test("rock level, experience and respawn follow the Wiki rock pages", () => {
  const byName = new Map(Mining.ROCKS.map((rock) => [rock.objectName, rock]));
  // Wiki respawn seconds / 0.6 = ticks: iron 5.4 s, silver and gold 1 min, coal 30 s, mithril 2 min,
  // adamantite 4 min, runite 12 min, copper and tin 2.4 s, clay 2 ticks.
  const expected = {
    "Clay rocks": [1, 5, 2], "Copper rocks": [1, 17.5, 4], "Tin rocks": [1, 17.5, 4], "Iron rocks": [15, 35, 9],
    "Silver rocks": [20, 40, 100], "Coal rocks": [30, 50, 50], "Gold rocks": [40, 65, 100],
    "Mithril rocks": [55, 80, 200], "Adamantite rocks": [70, 95, 400], "Runite rocks": [85, 125, 1200],
  };
  for (const [name, [level, xp, respawn]] of Object.entries(expected)) {
    const rock = byName.get(name);
    assert.deepEqual([rock.level, rock.xp, rock.respawnTicks], [level, xp, respawn], name);
  }
});

test("mining iron: swing a tick after the click, live messages, sound, ore counter, rocks2 and the respawn timer", () => {
  const h = harness();
  const player = createPlayer();
  const originalRandom = Math.random;
  Math.random = () => 0;
  const { rock, restore } = mineRock(h, player, "Iron rocks", loc("ironrock2"));
  try {
    assert.deepEqual(player.messages, [], "nothing on the click's own tick");
    h.tick(1);
    assert.deepEqual(player.messages, ["You swing your pick at the rock."]);
    assert.equal(player.animations.length, 1);
    h.tick(8);
    assert.equal(player.messages.at(-1), "You manage to mine some iron.");
    assert.deepEqual(player.added, [[ItemIds.IRON_ORE, 1]]);
    assert.ok(player.packets.sounds.includes(MINING_SUCCESS_SOUND));
    assert.deepEqual(player.packets.configs, [[ORE_MINED_VARP, 1]]);
    assert.equal(player.xp.at(-1)[1], 35);

    const depleted = h.registered[0];
    assert.equal(depleted.getId(), loc("rocks2"), "ironrock2 is mined out as rocks2");
    const [script, coordinate, locId, shape, timer, ticks, colour, zero] = player.packets.scripts.at(-1);
    assert.equal(script, RESPAWN_TIMER_SCRIPT);
    assert.equal(coordinate, (0 << 28) | (rock.getLocation().getX() << 14) | rock.getLocation().getY());
    assert.deepEqual([locId, shape, timer, ticks, colour, zero], [loc("rocks2"), 10, 1, 9, 16765184, 0]);
  } finally {
    restore();
    Math.random = originalRandom;
  }
});

test("the first rock variant is mined out as rocks1", () => {
  const h = harness();
  const player = createPlayer();
  const originalRandom = Math.random;
  Math.random = () => 0;
  const { restore } = mineRock(h, player, "Copper rocks", loc("copperrock1"));
  try {
    h.tick(10);
    assert.equal(h.registered[0].getId(), loc("rocks1"));
    assert.equal(player.messages.at(-1), "You manage to mine some copper.");
  } finally {
    restore();
    Math.random = originalRandom;
  }
});

test("a mined-out rock says it has no ore", () => {
  const h = harness();
  const player = createPlayer();
  for (const name of ["rocks1", "rocks2"]) {
    const event = { player, object: { getId: () => loc(name) } };
    h.interactions.get("Rocks").Mine(event);
    assert.equal(event.handled, true, name);
  }
  assert.deepEqual(player.messages, Array(2).fill("There is currently no ore available in this rock."));
  const other = { player, object: { getId: () => loc("punishrocks") } };
  h.interactions.get("Rocks").Mine(other);
  assert.equal(other.handled, undefined, "other rocks are left to their own plugins");
});

test("failed starts are message boxes with the live wording", () => {
  const h = harness();
  const noPickaxe = createPlayer({ pickaxe: -1 });
  let mined = mineRock(h, noPickaxe, "Iron rocks", loc("ironrock1"));
  mined.restore();
  assert.equal(noPickaxe.dialogues.length, 1);
  assert.deepEqual(noPickaxe.messages, []);

  const lowLevel = createPlayer({ level: 50 });
  mined = mineRock(h, lowLevel, "Mithril rocks", loc("mithrilrock1"));
  mined.restore();
  assert.equal(lowLevel.dialogues.length, 1);

  const full = createPlayer({ full: true });
  mined = mineRock(h, full, "Iron rocks", loc("ironrock1"));
  mined.restore();
  assert.equal(full.dialogues.length, 1);

  const text = (player) => player.dialogues[0].getDialogues().get(0).getText();
  assert.match(text(noPickaxe), /You need a pickaxe to mine this rock\. You do not have a pickaxe which you have the Mining level to use\./);
  assert.match(text(lowLevel), /You need a Mining level of 55 to mine this rock\./);
  assert.match(text(full), /Your inventory is too full to hold any more iron ore\./);
});

test("an infernal pickaxe's smelted ore shows smoke and plays 2725, with the usual mining message", () => {
  const h = harness();
  const player = createPlayer({ pickaxe: ItemIds.INFERNAL_PICKAXE });
  const item = { getId: () => ItemIds.INFERNAL_PICKAXE, getMetaValue: () => undefined, setMetaValue: noop, setId: noop };
  player.getInventory = () => ({
    contains: (id) => id === ItemIds.INFERNAL_PICKAXE, isFull: () => false, adds: (id, amount) => player.added.push([id, amount]),
    getItems: () => [item], refreshItems: noop,
  });
  const originalRandom = Math.random;
  Math.random = () => 0;
  const { restore } = mineRock(h, player, "Iron rocks", loc("ironrock1"));
  try {
    h.tick(10);
    assert.deepEqual(player.added, [], "the ore is destroyed");
    assert.deepEqual(player.graphics.at(-1), [86, 150], "smokepuff");
    assert.ok(player.packets.sounds.includes(SMELT_SOUND));
    assert.ok(player.packets.sounds.includes(MINING_SUCCESS_SOUND));
    assert.equal(player.messages.at(-1), "You manage to mine some iron.");
    assert.deepEqual(player.packets.configs, [], "a smelted ore is not counted as mined");
  } finally {
    restore();
    Math.random = originalRandom;
  }
});

test("the ore counter is sent again on login", () => {
  const h = harness();
  const player = createPlayer();
  player.setAttribute("mining:ores-mined", 7);
  h.hooks.login({ player });
  assert.deepEqual(player.packets.configs, [[ORE_MINED_VARP, 7]]);
});

test("each pickaxe swings its own animation", () => {
  // human_mining_<pickaxe> sequences, as recorded (black 90, crystal 3276, dragon 561, infernal 1634, steel 69, mithril 1098).
  const expected = {
    [ItemIds.BRONZE_PICKAXE]: 625, [ItemIds.IRON_PICKAXE]: 626, [ItemIds.STEEL_PICKAXE]: 627,
    [ItemIds.BLACK_PICKAXE]: 3873, [ItemIds.MITHRIL_PICKAXE]: 629, [ItemIds.ADAMANT_PICKAXE]: 628,
    [ItemIds.RUNE_PICKAXE]: 624, [ItemIds.DRAGON_PICKAXE]: 7139, [ItemIds.CRYSTAL_PICKAXE]: 8347,
    [ItemIds.INFERNAL_PICKAXE]: 4482, [ItemIds.ECHO_PICKAXE]: 8347,
    // Cosmetic and uncharged variants: their own cache sequences.
    [ItemIds.GILDED_PICKAXE]: 8313, [ItemIds.DRAGON_PICKAXE_3]: 642, [ItemIds._3RD_AGE_PICKAXE]: 7283,
    [ItemIds.DRAGON_PICKAXE_OR_]: 8346, [ItemIds.DRAGON_PICKAXE_OR__3]: 8887, [ItemIds.DRAGON_PICKAXE_OR__5]: 11833,
    [ItemIds.INFERNAL_PICKAXE_OR_]: 11831, [ItemIds.INFERNAL_PICKAXE_OR__3]: 11832,
    [ItemIds.INFERNAL_PICKAXE_UNCHARGED_]: 4482, [ItemIds.INFERNAL_PICKAXE_UNCHARGED__2]: 11831,
    [ItemIds.INFERNAL_PICKAXE_UNCHARGED__4]: 11832, [ItemIds.CRYSTAL_PICKAXE_INACTIVE_]: 8347,
  };
  for (const pickaxe of Mining.PICKAXES) {
    assert.equal(pickaxe.animation.getId(), expected[pickaxe.id], `pickaxe ${pickaxe.id}`);
  }
});

test("every pickaxe variant can mine, and its wall swings are cache sequences (3rd age pickaxe, issue 1883)", () => {
  const variants = [
    ItemIds._3RD_AGE_PICKAXE, ItemIds.GILDED_PICKAXE, ItemIds.DRAGON_PICKAXE_3, ItemIds.DRAGON_PICKAXE_OR_,
    ItemIds.DRAGON_PICKAXE_OR__3, ItemIds.DRAGON_PICKAXE_OR__5, ItemIds.INFERNAL_PICKAXE_OR_, ItemIds.INFERNAL_PICKAXE_OR__3,
    ItemIds.INFERNAL_PICKAXE_UNCHARGED_, ItemIds.INFERNAL_PICKAXE_UNCHARGED__2, ItemIds.INFERNAL_PICKAXE_UNCHARGED__4,
    ItemIds.CRYSTAL_PICKAXE_INACTIVE_,
  ];
  for (const id of variants) {
    const found = Mining.findBestPickaxe(createPlayer({ pickaxe: id }));
    assert.equal(found?.id, id, `pickaxe ${id}`);
    assert.ok(core.CacheDefinitions.getSeqName(found.animation.getId()), `swing of ${id}`);
    for (const kind of ["wall", "sang"]) {
      const name = found.walls?.[kind]
        ?? (kind === "wall" ? `human_mining_${found.key}_pickaxe_wall` : `sang_mining_wall_${found.key}_pickaxe`);
      assert.notEqual(core.CacheDefinitions.getSeqId(name), null, `${kind} swing ${name}`);
    }
  }
});

const itemName = (id) => core.CacheDefinitions.getItem(id).name;

/** Math.random from a list (then `rest`), for one roll at a time: the gem pre-roll comes first. */
function scriptRandom(values, rest = 0.9) {
  const original = Math.random;
  Math.random = () => (values.length ? values.shift() : rest);
  return () => { Math.random = original; };
}

/** A random value on face `face` of the 256-sided roll. */
const face = (n) => (n + 0.5) / 256;

test("quarry sandstone (232/03162): one piece, \"You manage to quarry some sandstone.\", then rocks1 for 9 ticks", () => {
  const h = harness();
  const player = createPlayer();
  const restoreRandom = scriptRandom([], 0);
  const { restore } = mineRock(h, player, "Sandstone rocks", loc("enakh_sandstone_rocks"));
  try {
    h.tick(1);
    assert.deepEqual(player.messages, ["You swing your pick at the rock."]);
    h.tick(1);
    assert.equal(player.messages.at(-1), "You manage to quarry some sandstone.");
    assert.equal(itemName(player.added[0][0]), "Sandstone (10kg)", "the 10kg roll comes first");
    assert.equal(player.added.length, 1);
    assert.equal(player.xp.at(-1)[1], 60);
    assert.deepEqual(player.packets.configs, [[ORE_MINED_VARP, 1]], "sandstone counts as ore mined, as recorded");
    assert.equal(h.registered.at(-1).getId(), loc("rocks1"));
    assert.equal(player.packets.scripts.at(-1)[0], RESPAWN_TIMER_SCRIPT);
    assert.equal(player.packets.scripts.at(-1)[5], 9);
  } finally {
    restoreRandom();
    restore();
  }
});

test("quarry rocks (Wiki): sandstone 35 and granite 45 roll their cascading charts biggest piece first", () => {
  const byName = new Map(Mining.ROCKS.map((rock) => [rock.objectName, rock]));
  const sandstone = byName.get("Sandstone rocks");
  const granite = byName.get("Granite rocks");
  assert.deepEqual([sandstone.level, granite.level], [35, 45]);
  assert.deepEqual([sandstone.petBase, granite.petBase], [741600, 741600], 'Wiki: rock golem and clue geode base for both');
  assert.deepEqual(sandstone.cascade.map((o) => [o.xp, ...o.chance]), [[60, 4, 50], [50, 8, 75], [40, 16, 100], [30, 25, 200]]);
  assert.deepEqual(granite.cascade.map((o) => [o.xp, ...o.chance]), [[75, 6, 64], [60, 8, 75], [50, 16, 100]]);
  assert.equal(sandstone.gems, undefined, "no gem pre-roll on quarry rocks");

  // At 35 the numerators are 21 (10kg), 32 (5kg), 46 (2kg) and 87 (1kg): face 40 fails 10kg and 5kg, hits 2kg.
  const h = harness();
  const player = createPlayer({ pickaxe: ItemIds.MITHRIL_PICKAXE, level: 35 });
  const restoreRandom = scriptRandom([face(40), face(40), face(40)]);
  const { restore } = mineRock(h, player, "Sandstone rocks", loc("enakh_sandstone_rocks"));
  try {
    h.tick(2);
    assert.deepEqual(player.added.map(([id, amount]) => [itemName(id), amount]), [["Sandstone (2kg)", 1]]);
    assert.equal(player.xp.at(-1)[1], 40);
  } finally {
    restoreRandom();
    restore();
  }
  // Every size failed: nothing, and the rock stays.
  const h2 = harness();
  const miss = createPlayer({ pickaxe: ItemIds.MITHRIL_PICKAXE, level: 35 });
  const restoreMiss = scriptRandom([], face(200));
  const mined = mineRock(h2, miss, "Sandstone rocks", loc("enakh_sandstone_rocks"));
  try {
    h2.tick(2);
    assert.deepEqual(miss.added, []);
    assert.deepEqual(h2.registered, []);
  } finally {
    restoreMiss();
    mined.restore();
  }
});

test("each rock rolls the Wiki skilling success chart", () => {
  const charts = {
    "Clay rocks": [128, 400], "Copper rocks": [100, 350], "Tin rocks": [100, 350], "Blurite rocks": [90, 350],
    "Iron rocks": [96, 350], "Barronite rocks": [80, 100], "Silver rocks": [25, 200], "Coal rocks": [16, 100],
    "Gold rocks": [7, 75], "Mithril rocks": [4, 50], "Adamantite rocks": [2, 25], "Runite rocks": [1, 18],
    "Lead rocks": [112, 278], "Gem rocks": [28, 70], "Amethyst crystals": [-18, 10],
  };
  // Wiki pages without the pre-roll template: gem rocks, sunstone, Daeyalt.
  const noGems = new Set(["Gem rocks", "Sunstone rocks", "Daeyalt rocks"]);
  for (const rock of Mining.ROCKS.filter((entry) => !entry.cascade)) {
    if (charts[rock.objectName]) assert.deepEqual(rock.chance, charts[rock.objectName], rock.objectName);
    else assert.equal(rock.chance.length, 2, `${rock.objectName} has a chart`);
    assert.equal(rock.gems === true, !noGems.has(rock.objectName), `${rock.objectName} gem pre-roll`);
  }
  assert.deepEqual(Mining.ROCKS.find((rock) => rock.objectName === "Gem rocks").gloryChance, [84, 210]);
  // Wiki Runite rocks: 17/256 at level 85; the roll succeeds on faces 0-16 only.
  for (const [value, expected] of [[face(16), 1], [face(17), 0]]) {
    const h = harness();
    const player = createPlayer({ level: 85 });
    const restoreRandom = scriptRandom([0, value]);
    const { restore } = mineRock(h, player, "Runite rocks", loc("runiterock1"));
    try {
      h.tick(2);
      assert.equal(player.added.length, expected, `face ${Math.floor(value * 256)}`);
    } finally {
      restoreRandom();
      restore();
    }
  }
});

test("the pickaxe sets only how often the game rolls: a bronze pickaxe at 99 mines iron on the first roll", () => {
  // Iron at 99 is 351/256 (always): live 3139/3182 get the ore a tick after the swing, whatever the pickaxe's speed.
  const h = harness();
  const player = createPlayer({ pickaxe: ItemIds.BRONZE_PICKAXE });
  const restoreRandom = scriptRandom([], 0.5);
  const { restore } = mineRock(h, player, "Iron rocks", loc("ironrock1"));
  try {
    h.tick(1);
    assert.deepEqual(player.added, []);
    h.tick(1);
    assert.deepEqual(player.added, [[ItemIds.IRON_ORE, 1]]);
  } finally {
    restoreRandom();
    restore();
  }
});

/** The ticks (after the click) on which rolls land, while each one fails and costs one Math.random for the gem pre-roll. */
function rollTicks({ pickaxe, rest = face(100), members = true, ticks = 12 }) {
  const { WorldDefinition } = core;
  const originalMembers = WorldDefinition.isMembersWorld;
  WorldDefinition.isMembersWorld = () => members;
  const h = harness();
  const player = createPlayer({ pickaxe, level: 99 });
  const originalRandom = Math.random;
  let calls = 0;
  Math.random = () => { calls++; return rest; };
  const { restore } = mineRock(h, player, "Runite rocks", loc("runiterock1"));
  const rolls = [];
  try {
    for (let tick = 1; tick <= ticks; tick++) {
      const before = calls;
      h.tick(1);
      if (calls > before) rolls.push(tick);
    }
    assert.deepEqual(player.added, [], "every roll failed");
  } finally {
    Math.random = originalRandom;
    WorldDefinition.isMembersWorld = originalMembers;
    restore();
  }
  return rolls;
}

test("rolls land the tick after the swing, then every pickaxe interval (Wiki Pickaxe)", () => {
  assert.deepEqual(rollTicks({ pickaxe: ItemIds.BRONZE_PICKAXE, ticks: 20 }), [2, 10, 18]);
  assert.deepEqual(rollTicks({ pickaxe: ItemIds.ADAMANT_PICKAXE }), [2, 6, 10]);
  assert.deepEqual(rollTicks({ pickaxe: ItemIds.RUNE_PICKAXE }), [2, 5, 8, 11]);
});

test("dragon, infernal and crystal pickaxes sometimes roll a tick early on members worlds only", () => {
  // Face 40 (0.158): under the dragon's 1/6 and the crystal's 1/4, so every interval is 2 ticks.
  for (const pickaxe of [ItemIds.DRAGON_PICKAXE, ItemIds.INFERNAL_PICKAXE, ItemIds.CRYSTAL_PICKAXE]) {
    assert.deepEqual(rollTicks({ pickaxe, rest: face(40) }), [2, 4, 6, 8, 10, 12], `pickaxe ${pickaxe}`);
    assert.deepEqual(rollTicks({ pickaxe, rest: face(40), members: false }), [2, 5, 8, 11], `pickaxe ${pickaxe} on F2P`);
  }
  // Face 50 (0.197): past the dragon's 1/6, still under the crystal's 1/4.
  assert.deepEqual(rollTicks({ pickaxe: ItemIds.DRAGON_PICKAXE, rest: face(50) }), [2, 5, 8, 11]);
  assert.deepEqual(rollTicks({ pickaxe: ItemIds.CRYSTAL_PICKAXE, rest: face(50) }), [2, 4, 6, 8, 10, 12]);
});

test("\"mining:roll-interval\" answers other mining content with the pickaxe's interval and its early rolls", () => {
  const { WorldDefinition } = core;
  const originalMembers = WorldDefinition.isMembersWorld;
  const originalRandom = Math.random;
  WorldDefinition.isMembersWorld = () => true;
  const h = harness();
  const ask = (pickaxe) => {
    const request = { pickaxe, ticks: null };
    h.events["mining:roll-interval"](request);
    return request.ticks;
  };
  try {
    Math.random = () => 0.1;
    assert.equal(ask({ attemptIntervalTicks: 3, fastRollChance: 1 / 6 }), 2, "a dragon pickaxe's early roll");
    assert.equal(ask({ attemptIntervalTicks: 3 }), 3, "a rune pickaxe never rolls early");
    Math.random = () => 0.5;
    assert.equal(ask({ attemptIntervalTicks: 3, fastRollChance: 1 / 6 }), 3);
  } finally {
    Math.random = originalRandom;
    WorldDefinition.isMembersWorld = originalMembers;
  }
});

test("the skilling timer carries over to the next rock: no fresh roll before the last interval ends", () => {
  const h = harness();
  const player = createPlayer({ pickaxe: ItemIds.BRONZE_PICKAXE });
  const restoreRandom = scriptRandom([], 0.5);
  let mined = mineRock(h, player, "Iron rocks", loc("ironrock1"));
  try {
    h.tick(2);
    assert.equal(player.added.length, 1, "first ore at +2");
    mined.restore();
    mined = mineRock(h, player, "Iron rocks", loc("ironrock2"), 3286, 3368);
    h.tick(7);
    assert.equal(player.added.length, 1, "the bronze pickaxe's 8 ticks have not passed");
    h.tick(1);
    assert.equal(player.added.length, 2, "the next roll comes 8 ticks after the last");
  } finally {
    restoreRandom();
    mined.restore();
  }
});

test("invisible boosts count past 99, a visible boost does not (Wiki Skilling success rate)", () => {
  // Runite: 19/256 at 99; a visible 105 still rolls as 99, an invisible +4 on 99 gives 20/256.
  const cases = [[105, 0, 0], [99, 4, 1]];
  for (const [level, boost, expected] of cases) {
    const h = harness({ emit: (key, request) => { if (key === "mining:level-boost") request.boost += boost; } });
    const player = createPlayer({ level });
    const restoreRandom = scriptRandom([0, face(19)]);
    const { restore } = mineRock(h, player, "Runite rocks", loc("runiterock1"));
    try {
      h.tick(2);
      assert.equal(player.added.length, expected, `level ${level} + ${boost}`);
    } finally {
      restoreRandom();
      restore();
    }
  }
});

test("a gem pre-roll hit gives a gem instead of the ore: no XP, no sound, the rock stays (403)", () => {
  const h = harness();
  const player = createPlayer();
  // Gem roll on face 255, then the gem table (70 nothing, 32 sapphire, 16 emerald, 8 ruby, 2 diamond of 128): 0.6 -> sapphire.
  const restoreRandom = scriptRandom([face(255), 0.6], 0.99);
  const { restore } = mineRock(h, player, "Iron rocks", loc("ironrock1"));
  try {
    h.tick(2);
    assert.deepEqual(player.added, [[ItemIds.UNCUT_SAPPHIRE, 1]]);
    assert.equal(player.messages.at(-1), "You just found a Sapphire!");
    assert.deepEqual(player.xp, []);
    assert.deepEqual(player.packets.sounds, []);
    assert.deepEqual(h.registered, [], "the rock is not mined out");
    assert.equal(Mining.isMiningActive(player), true, "mining goes on");
  } finally {
    restoreRandom();
    restore();
  }
  const table = [[0.1, null], [0.85, ItemIds.UNCUT_EMERALD, "You just found an Emerald!"], [0.95, ItemIds.UNCUT_RUBY, "You just found a Ruby!"], [0.995, ItemIds.UNCUT_DIAMOND, "You just found a Diamond!"]];
  for (const [roll, itemId, message] of table) {
    const h2 = harness();
    const miner = createPlayer();
    const restoreGem = scriptRandom([face(255), roll], 0.99);
    const mined = mineRock(h2, miner, "Iron rocks", loc("ironrock1"));
    try {
      h2.tick(2);
      assert.deepEqual(miner.added, itemId ? [[itemId, 1]] : [], `table roll ${roll}`);
      if (message) assert.equal(miner.messages.at(-1), message);
      assert.deepEqual(h2.registered, [], "no ore either way");
    } finally {
      restoreGem();
      mined.restore();
    }
  }
});

test("a gem going into an open gem bag: the find line first, then the bag's (Wiki Transcript:Gem bag)", () => {
  const GemBag = require("../plugins/items/storage/GemBag.StorageItems");
  const player = createPlayer();
  // An open gem bag answering "storage:gather" as StorageItems does: it takes the gem and says so.
  const h = harness({
    emit: (key, request) => {
      if (key !== "storage:gather") return;
      request.stored = request.amount;
      request.player.sendMessage(GemBag.STRAIGHT_IN);
    },
  });
  const restoreRandom = scriptRandom([face(255), 0.6], 0.99);
  const { restore } = mineRock(h, player, "Iron rocks", loc("ironrock1"));
  try {
    h.tick(2);
    assert.deepEqual(player.messages.slice(-2), ["You just found a Sapphire!", GemBag.STRAIGHT_IN]);
    assert.deepEqual(player.added, [], "the bag took it");
  } finally {
    restoreRandom();
    restore();
  }
});

test("a charged amulet of glory adds a 3/256 gem roll when the first one misses", () => {
  const { ItemIdentifiers } = core;
  for (const [amulet, expected] of [[ItemIdentifiers.AMULET_OF_GLORY_4_, ItemIds.UNCUT_SAPPHIRE], [ItemIdentifiers.AMULET_OF_ETERNAL_GLORY, ItemIds.UNCUT_SAPPHIRE], [ItemIdentifiers.AMULET_OF_GLORY, ItemIds.IRON_ORE], [-1, ItemIds.IRON_ORE]]) {
    const h = harness();
    const player = createPlayer({ amulet });
    // First gem roll misses (face 100), the glory's roll hits on face 253, then 0.6 -> sapphire. Without a charged glory
    // the 253 is the ore roll instead, which iron at 99 always passes.
    const restoreRandom = scriptRandom([face(100), face(253), 0.6], 0.99);
    const { restore } = mineRock(h, player, "Iron rocks", loc("ironrock1"));
    try {
      h.tick(2);
      assert.deepEqual(player.added, [[expected, 1]], `amulet ${amulet}`);
    } finally {
      restoreRandom();
      restore();
    }
  }
});

test("rune essence: every roll gives essence and there is no gem pre-roll (Wiki Pure essence)", () => {
  const h = harness();
  const player = createPlayer({ pickaxe: ItemIds.BRONZE_PICKAXE, level: 1 });
  const restoreRandom = scriptRandom([], 0.999);
  const { restore } = mineRock(h, player, "Rune essence", core.ObjectIdentifiers.RUNE_ESSENCE);
  try {
    h.tick(10);
    assert.deepEqual(player.added, [[ItemIds.PURE_ESSENCE, 1], [ItemIds.PURE_ESSENCE, 1]], "rolls at +2 and +10");
  } finally {
    restoreRandom();
    restore();
  }
});

/** Mines `name` with every roll on face 0 (no gem, a hit, the first outcome), following a staged rock's new locs. */
function mineAll(h, player, name, rockId) {
  const rock = new GameObject(rockId, new core.Location(3285, 3368, 0), 10, 0, null);
  const original = MapObjects.get;
  MapObjects.get = (id) => [rock, ...h.registered].reverse().find((object) => object.getId() === id) ?? null;
  h.interactions.get(name).Mine({ player, object: rock, definition: { getName: () => name } });
  return { rock, restore: () => { MapObjects.get = original; } };
}

test("rune essence (70, 3027): sound 3600 and the ore counter with each essence, and no chat line", () => {
  const h = harness();
  const player = createPlayer({ level: 1, pickaxe: ItemIds.BRONZE_PICKAXE });
  const restoreRandom = scriptRandom([], 0.999);
  const { restore } = mineRock(h, player, "Rune essence", core.ObjectIdentifiers.RUNE_ESSENCE);
  try {
    h.tick(2);
    assert.deepEqual(player.added, [[ItemIds.PURE_ESSENCE, 1]]);
    assert.deepEqual(player.messages, ["You swing your pick at the rock."], "no essence line");
    assert.deepEqual(player.packets.sounds, [MINING_SUCCESS_SOUND]);
    assert.deepEqual(player.packets.configs, [[ORE_MINED_VARP, 1]]);
  } finally {
    restoreRandom();
    restore();
  }
});

test("mining lines are spam, and each roll replays the swing (3139, 3162, 468)", () => {
  const h = harness();
  const player = createPlayer({ pickaxe: ItemIds.BRONZE_PICKAXE });
  const swing = 625; // human_mining_bronze_pickaxe
  const restoreRandom = scriptRandom([], face(100));
  const { restore } = mineRock(h, player, "Runite rocks", loc("runiterock1"));
  try {
    h.tick(18);
    // The swing at +1, then a roll at +2, +10 and +18 (bronze: 8 ticks), each resending the sequence.
    assert.deepEqual(player.animations, [swing, swing, swing, swing]);
    assert.deepEqual(player.spam, ["You swing your pick at the rock."]);
  } finally {
    restoreRandom();
    restore();
  }
  const miner = createPlayer();
  const h2 = harness();
  const restoreHit = scriptRandom([], 0);
  const mined = mineRock(h2, miner, "Iron rocks", loc("ironrock1"));
  try {
    h2.tick(2);
    assert.deepEqual(miner.spam, ["You swing your pick at the rock.", "You manage to mine some iron."]);
    assert.equal(miner.animations.at(-1), RESET_ANIMATION, "the ore that empties the rock stops the swing");
  } finally {
    restoreHit();
    mined.restore();
  }
});

test("Mine on a mined-out rock stops the swing and plays 2661 (3139)", () => {
  const h = harness();
  const player = createPlayer();
  const event = { player, object: { getId: () => loc("rocks2") } };
  h.interactions.get("Rocks").Mine(event);
  assert.deepEqual(player.animations, [RESET_ANIMATION]);
  assert.deepEqual(player.packets.sounds, [2661]);
  assert.deepEqual(player.messages, ["There is currently no ore available in this rock."]);
  assert.deepEqual(player.spam, [], "a game message");
});

test("barronite (1636; Wiki): wall swings, the rock stays through its ores, then runs out after 20 seconds", () => {
  const { Sounds } = core;
  const original = Sounds.playAreaSound;
  const areaSounds = [];
  Sounds.playAreaSound = (options) => areaSounds.push(options);
  const h = harness();
  const player = createPlayer({ pickaxe: ItemIds.INFERNAL_PICKAXE });
  const item = { getId: () => ItemIds.INFERNAL_PICKAXE, getMetaValue: () => undefined };
  const inventory = player.getInventory();
  player.getInventory = () => ({ ...inventory, contains: (id) => id === ItemIds.INFERNAL_PICKAXE, getItems: () => [item] });
  // Face 50: no gem, under barronite's 101/256 at 99, and past the infernal's 1/6 early roll.
  const restoreRandom = scriptRandom([], face(50));
  const { rock, restore } = mineRock(h, player, "Barronite rocks", loc("camdozaalrock1"));
  try {
    h.tick(2);
    assert.equal(player.animations[0], core.CacheDefinitions.getSeqId("human_mining_infernal_pickaxe_wall"));
    assert.equal(player.added.length, 1, "an ore at +2");
    assert.deepEqual(h.registered, [], "the rock stays standing");
    assert.equal(Mining.isMiningActive(player), true);
    h.tick(30);
    assert.deepEqual(h.registered, [], "still standing at +32");
    h.tick(1);
    assert.equal(h.registered[0].getId(), loc("camdozaalrock1_empty"), "runs out 33 ticks (20 s) in");
    assert.deepEqual(areaSounds.map((sound) => [sound.soundId, sound.delay, sound.radius, sound.x, sound.y]), [[2661, 10, 1, rock.getLocation().getX(), rock.getLocation().getY()]]);
    assert.equal(player.animations.at(-1), RESET_ANIMATION);
    assert.equal(Mining.isMiningActive(player), false);
  } finally {
    Sounds.playAreaSound = original;
    restoreRandom();
    restore();
  }
});

test("a respawned barronite rock gets a fresh 20 seconds, and so does one content keeps standing", () => {
  const { Sounds } = core;
  const original = Sounds.playAreaSound;
  Sounds.playAreaSound = noop;
  const restoreRandom = scriptRandom([], 0.99);
  try {
    // Two full cycles on one rock: run out at 33, respawn after 100, run out again 33 mining ticks later.
    const h = harness();
    const player = createPlayer();
    const { rock, restore } = mineRock(h, player, "Barronite rocks", loc("camdozaalrock1"));
    try {
      h.tick(33);
      assert.equal(h.registered.length, 1, "first cycle runs out at 33");
      h.tick(100);
      assert.equal(h.registered.at(-1), rock, "the same rock respawns");
      h.interactions.get("Barronite rocks").Mine({ player, object: rock, definition: { getName: () => "Barronite rocks" } });
      h.tick(32);
      assert.equal(h.registered.length, 2, "standing through the second cycle's tick 32");
      assert.equal(Mining.isMiningActive(player), true);
      h.tick(1);
      assert.equal(h.registered.at(-1).getId(), loc("camdozaalrock1_empty"), "second cycle runs out at 33");
    } finally {
      restore();
    }

    // "mining:deplete-rock" keeps it standing: mining goes on, and the next try is 33 ticks later.
    const kept = [];
    const keeper = harness({ emit: (key, event) => { if (key === "mining:deplete-rock") { kept.push(event); event.handled = true; } } });
    const miner = createPlayer();
    const mined = mineRock(keeper, miner, "Barronite rocks", loc("camdozaalrock1"));
    try {
      keeper.tick(33);
      assert.equal(kept.length, 1);
      assert.equal(Mining.isMiningActive(miner), true, "a kept rock is mined on");
      keeper.tick(32);
      assert.equal(kept.length, 1, "no depletion every tick after the first");
      keeper.tick(1);
      assert.equal(kept.length, 2);
      assert.deepEqual(keeper.registered, []);
    } finally {
      mined.restore();
    }
  } finally {
    Sounds.playAreaSound = original;
    restoreRandom();
  }
});

test("a Mining cape's extra sandstone is the same size, with its line, XP and count (3165)", () => {
  const cape = "Your cape allows you to mine an additional ore.";
  const h = harness({ emit: (key, request) => { if (key === "mining:extra-ore") Object.assign(request, { extra: true, message: cape }); } });
  const player = createPlayer();
  const restoreRandom = scriptRandom([0.99, 0.99, 0.99, 0], 0.99);
  const { restore } = mineRock(h, player, "Sandstone rocks", loc("enakh_sandstone_rocks"));
  try {
    h.tick(2);
    assert.deepEqual(player.spam.slice(-2), ["You manage to quarry some sandstone.", cape]);
    assert.deepEqual(player.added.map(([id, amount]) => [itemName(id), amount]), [["Sandstone (1kg)", 1], ["Sandstone (1kg)", 1]]);
    assert.deepEqual(player.xp.map(([, amount]) => amount), [30, 30]);
    assert.deepEqual(player.packets.configs, [[ORE_MINED_VARP, 1], [ORE_MINED_VARP, 2]]);
  } finally {
    restoreRandom();
    restore();
  }
});

test("an ore handed over as it is mined (\"mining:hand-over\"): the line names who took it, no ore, sound or count (1757)", () => {
  const h = harness({ emit: (key, request) => { if (key === "mining:hand-over") request.taker = "Miner Magnus"; } });
  const player = createPlayer();
  const restoreRandom = scriptRandom([], 0);
  const { restore } = mineRock(h, player, "Coal rocks", loc("coalrock2"));
  try {
    h.tick(2);
    assert.equal(player.spam.at(-1), "You manage to mine some coal, and give it to Miner Magnus.");
    assert.deepEqual(player.added, []);
    assert.deepEqual(player.packets.sounds, []);
    assert.deepEqual(player.packets.configs, []);
    assert.equal(player.xp.at(-1)[1], 50, "the XP is still given");
    assert.equal(h.registered[0].getId(), loc("rocks2"));
  } finally {
    restoreRandom();
    restore();
  }
});

test("lead rocks (Wiki): 25 Mining, 40.5 XP, mined out as their own leadrock1_empty, which says it is empty", () => {
  const h = harness();
  const player = createPlayer();
  const restoreRandom = scriptRandom([], 0);
  const { restore } = mineAll(h, player, "Lead rocks", loc("leadrock1"));
  try {
    h.tick(2);
    assert.equal(player.messages.at(-1), "You manage to mine some lead.");
    assert.deepEqual(player.added, [[core.ItemIdentifiers.LEAD_ORE, 1]]);
    assert.equal(player.xp.at(-1)[1], 40.5);
    assert.equal(h.registered.at(-1).getId(), loc("leadrock1_empty"));
    assert.equal(player.packets.scripts.at(-1)[5], 10, "6 s respawn");
    assert.equal(Mining.isMiningActive(player), false);
  } finally {
    restoreRandom();
    restore();
  }
  const event = { player, object: { getId: () => loc("leadrock1_empty") } };
  h.interactions.get("Rocks").Mine(event);
  assert.equal(event.handled, true);
  assert.equal(player.messages.at(-1), "There is currently no ore available in this rock.");
});

test("nickel rocks (Wiki) give 2-16 ores before going, and no mining enhancer's extra ore", () => {
  let extraAsked = false;
  const h = harness({ emit: (key) => { if (key === "mining:extra-ore") extraAsked = true; } });
  const player = createPlayer();
  // Face 0 draws the least: two ores.
  const restoreRandom = scriptRandom([], 0);
  const { restore } = mineAll(h, player, "Nickel rocks", loc("nickelrock1"));
  try {
    h.tick(2);
    assert.equal(player.added.length, 1);
    assert.deepEqual(h.registered, [], "the rock holds a second ore");
    assert.equal(Mining.isMiningActive(player), true);
    h.tick(3);
    assert.deepEqual(player.added, [[core.ItemIdentifiers.NICKEL_ORE, 1], [core.ItemIdentifiers.NICKEL_ORE, 1]]);
    assert.equal(h.registered.at(-1).getId(), loc("nickelrock1_empty"));
    assert.equal(extraAsked, false);
  } finally {
    restoreRandom();
    restore();
  }
});

test("rubium rocks (Wiki): two splinters a success from 72, at least two successes, then a 1/6 chance each", () => {
  const h = harness();
  const player = createPlayer({ level: 72 });
  const restoreRandom = scriptRandom([], 0);
  const { restore } = mineAll(h, player, "Rubium rocks", loc("rubiumrock1"));
  try {
    h.tick(2);
    assert.deepEqual(player.added, [[core.ItemIdentifiers.RUBIUM_SPLINTERS, 2]]);
    assert.deepEqual(h.registered, [], "never after the first");
    h.tick(3);
    assert.equal(h.registered.at(-1).getId(), loc("rubiumrock1_empty"), "face 0 is under 1/6");
  } finally {
    restoreRandom();
    restore();
  }
  const low = createPlayer({ level: 71 });
  const h2 = harness();
  const restoreLow = scriptRandom([], 0);
  const mined = mineAll(h2, low, "Rubium rocks", loc("rubiumrock1"));
  try {
    h2.tick(2);
    assert.deepEqual(low.added, [[core.ItemIdentifiers.RUBIUM_SPLINTERS, 1]]);
  } finally {
    restoreLow();
    mined.restore();
  }
});

test("a full inventory still mines a stackable ore the player already holds", () => {
  const h = harness();
  const player = createPlayer({ full: true });
  const inventory = player.getInventory();
  player.getInventory = () => ({ ...inventory, contains: (id) => id === ItemIds.RUNE_PICKAXE || id === core.ItemIdentifiers.RUBIUM_SPLINTERS });
  const { restore } = mineAll(h, player, "Rubium rocks", loc("rubiumrock1"));
  restore();
  assert.deepEqual(player.dialogues, []);
  assert.equal(Mining.isMiningActive(player), true);
});

test("gem rocks (227/1846, 1858; Wiki table): the gem's line, sound 2655, 65 XP, gemrock -> rocks2, and a glory's chart", () => {
  const h = harness();
  const player = createPlayer();
  const restoreRandom = scriptRandom([], 0);
  const { restore } = mineAll(h, player, "Gem rocks", loc("gemrock"));
  try {
    h.tick(2);
    assert.equal(player.messages.at(-1), "You just mined an Opal!");
    assert.deepEqual(player.added, [[core.ItemIdentifiers.UNCUT_OPAL, 1]]);
    assert.ok(player.packets.sounds.includes(2655));
    assert.ok(!player.packets.sounds.includes(MINING_SUCCESS_SOUND));
    assert.equal(player.xp.at(-1)[1], 65);
    assert.deepEqual(player.packets.configs, [[ORE_MINED_VARP, 1]], "recorded: gems count as ore mined");
    assert.equal(h.registered.at(-1).getId(), loc("rocks2"));
    assert.equal(player.packets.scripts.at(-1)[5], 99);
  } finally {
    restoreRandom();
    restore();
  }
  // Level 41 (the rune pickaxe's): 46/256 plain, 136/256 with a charged glory; face 50 tells them apart.
  for (const [amulet, expected] of [[-1, 0], [core.ItemIdentifiers.AMULET_OF_GLORY_4_, 1]]) {
    const h2 = harness();
    const miner = createPlayer({ level: 41, amulet });
    const restoreRoll = scriptRandom([face(50)], 0);
    const mined = mineAll(h2, miner, "Gem rocks", loc("gemrock1"));
    try {
      h2.tick(2);
      assert.equal(miner.added.length, expected, `amulet ${amulet}`);
    } finally {
      restoreRoll();
      mined.restore();
    }
  }
  const byWeight = Mining.ROCKS.find((rock) => rock.objectName === "Gem rocks").outcomes.map((o) => [itemName(o.itemId), o.weight]);
  assert.deepEqual(byWeight, [["Uncut opal", 60], ["Uncut jade", 30], ["Uncut red topaz", 15], ["Uncut sapphire", 9], ["Uncut emerald", 5], ["Uncut ruby", 5], ["Uncut diamond", 4]]);
});

test("amethyst crystals (233-234, Leagues): wall swings, 240 XP, two or three before the empty wall, which says it is empty", () => {
  const h = harness();
  const player = createPlayer();
  const restoreRandom = scriptRandom([], 0);
  const wall = new GameObject(loc("amethystrock1"), new core.Location(3285, 3368, 0), 0, 0, null);
  const original = MapObjects.get;
  MapObjects.get = (id) => [wall, ...h.registered].reverse().find((object) => object.getId() === id) ?? null;
  h.interactions.get("Amethyst crystals").Mine({ player, object: wall, definition: { getName: () => "Amethyst crystals" } });
  try {
    h.tick(1);
    assert.equal(player.animations.at(-1), core.CacheDefinitions.getSeqId("human_mining_rune_pickaxe_wall"));
    h.tick(1);
    assert.equal(player.messages.at(-1), "You manage to mine some amethyst.");
    assert.equal(player.xp.at(-1)[1], 240);
    assert.deepEqual(h.registered, []);
    h.tick(3);
    const empty = h.registered.at(-1);
    assert.equal(empty.getId(), loc("amethystrock_empty"));
    const [, , locId, shape, , ticks] = player.packets.scripts.at(-1);
    assert.deepEqual([locId, shape, ticks], [loc("amethystrock_empty"), 0, 125], "the wall's own shape (recorded 0)");
  } finally {
    restoreRandom();
    MapObjects.get = original;
  }
  const event = { player, object: { getId: () => loc("amethystrock_empty") } };
  h.interactions.get("Empty wall").Mine(event);
  assert.equal(player.messages.at(-1), "There is currently no ore available in this rock.");
});

test("daeyalt rocks (226-231): sang wall swings, sound 2998, one stage down per ore, then empty, and back whole", () => {
  const h = harness();
  const player = createPlayer();
  const restoreRandom = scriptRandom([], 0);
  const { rock, restore } = mineAll(h, player, "Daeyalt rocks", loc("area_sanguine_mine_minerocks_01"));
  try {
    h.tick(1);
    assert.equal(player.animations.at(-1), core.CacheDefinitions.getSeqId("sang_mining_wall_rune_pickaxe"));
    h.tick(1);
    assert.equal(player.messages.at(-1), "You manage to mine some ore.");
    assert.deepEqual(player.added, [[core.ItemIdentifiers.DAEYALT_ORE, 1]]);
    assert.equal(core.CacheDefinitions.getObjId("sang_jas_ore"), core.ItemIdentifiers.DAEYALT_ORE);
    assert.ok(player.packets.sounds.includes(2998));
    assert.equal(h.registered.at(-1).getId(), loc("area_sanguine_mine_minerocks_02"));
    h.tick(3);
    assert.equal(h.registered.at(-1).getId(), loc("area_sanguine_mine_minerocks_03"));
    h.tick(3);
    assert.equal(h.registered.at(-1).getId(), loc("area_sanguine_mine_minerocks_04"));
    assert.equal(player.messages.at(-1), "This rock face is now empty.");
    assert.equal(player.added.length, 3);
    assert.equal(Mining.isMiningActive(player), false);
    h.tick(47);
    assert.equal(h.registered.at(-1).getId(), loc("area_sanguine_mine_minerocks_01"), "grows back whole");
    assert.equal(h.registered.at(-1).getLocation().getX(), rock.getLocation().getX());
  } finally {
    restoreRandom();
    restore();
  }
});

test("every loc named for mining in the cache has a handler (this plugin, or the content that owns it)", () => {
  // Rocks other plugins mine, by name: quests, minigames, bosses, stars, Motherlode.
  const elsewhere = new Set([
    "Ascension rocks", "Blockage", "Blocked Crevice", "Boulder", "Cave entrance", "Cave exit", "Corrupt Deposit",
    "Crashed Star", "Crystal Deposit", "Guardian parts", "Guardian remains", "Huge guardian remains",
    "Large guardian remains", "Magical rocks", "Ore vein", "Rock Formation (Glowing)", "Rock Formation", "Rock",
    "Rockfall", "Rocks", "Rockslide", "Rubble", "Salt Deposit", "Stalagmite", "Stalagmites", "Wall",
    // Quest locs handled by id.
    "Structural pillar", "Rock of Dalgroth", "Rock slide", "Sunstone monolith",
  ]);
  // Not mineable yet (docs/mining.md, Not done): each needs its own area or mechanic.
  const notYet = new Set([
    "Limestone rock", "Pile of rock", "Pile of Rock", "Rubium deposit", "Infernal shale deposit", "Calcified rocks",
    "Daeyalt Essence", "Gem Rock", "Easter egg rock", "Amalgamation", "Ancient essence crystals",
    "Adamant ore vein", "Clay ore vein", "Coal ore vein", "Copper ore vein", "Iron ore vein", "Mithril ore vein",
    "Tin ore vein", "Depleted vein", "Gold vein", "Ash pile", "Empty ash pile", "Giant Boulder", "Large Boulder",
    "Medium Boulder", "Small Boulder", "Blocked volcanic chamber", "Volcanic sulphur", "Fallen guardian",
    "Basalt rocks", "Efh salt rocks", "Te salt rocks", "Urt salt rocks",
  ]);
  const h = harness();
  const missing = new Set();
  const count = core.CacheDefinitions.getCounts().objects;
  for (let id = 0; id < count; id++) {
    const definition = core.CacheDefinitions.getObject(id);
    if (!definition?.actions?.some((action) => action && /^mine$/i.test(action))) continue;
    const name = (definition.name ?? "").replace(/<[^>]+>/g, "");
    if (!h.interactions.has(name) && !elsewhere.has(name) && !notYet.has(name)) missing.add(name);
  }
  assert.deepEqual([...missing], []);
});
