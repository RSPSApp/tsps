// Run after `yarn build`: node --test tests/agility.test.cjs
const assert = require("node:assert/strict");
const { test, before } = require("node:test");
const path = require("node:path");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { Location } = require("../dist/game/model/Location");
const { Skill } = require("../dist/game/model/Skill");
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { CacheDefinitions } = require("../dist/game/cache/CacheDefinitions");
const { ObjectIds } = require("../dist/util/IdEnums");
const { PluginManager } = require("../dist/plugins/PluginManager");
const AchievementDiaries = require("../plugins/achievements/AchievementDiaries.plugin");
const DiaryData = require("../plugins/achievements/diaries/Data.AchievementDiaries");
const DiaryProgress = require("../plugins/achievements/diaries/Progress.AchievementDiaries");
const YanilleGrappleDiary = require("../plugins/achievements/diaries/ArdougneYanilleGrappleDiary.plugin");

/** Runs submitted tasks on demand instead of on the game loop. */
const tasks = [];
const taskManager = {
  submit(task) {
    if (task.isRunning()) return;
    task.setRunning(true);
    if (task.isImmediate()) task.execute();
    tasks.push(task);
  },
};

function tick() {
  for (const task of tasks.splice(0)) {
    if (task.tick()) tasks.push(task);
  }
}

const hooks = { persisted: {}, areas: [], route: [], click: new Map(), objectActions: new Map(), logout: [], login: [], teleport: [], events: [], npcs: {}, answers: {}, listeners: {} };
const groundItems = [];
/** Answers ItemOnGroundManager.ownedBy: the stacks a test has put on the floor. */
const floorStacks = [];
const Agility = require("../plugins/skills/Agility.plugin");
const agilityApi = {
  core: PluginManager.getCoreApi(),
  getTaskManager: () => taskManager,
  getItemOnGroundManager: () => ({
    registerLocation: (player, item, position, privateArea, options) => groundItems.push({ item, position, options }),
    ownedBy: () => floorStacks,
    inventoryCapacity: () => 1,
  }),
  onGroundItemPickup: (handler) => { hooks.pickup = handler; },
  persistAttribute: (key, value) => { hooks.persisted[key] = value; },
  onObjectRoute: (handler) => hooks.route.push(handler),
  onObjectFirstClick: (ids, handler) => ids.forEach((id) => hooks.click.set(id, handler)),
  onObjectInteraction: (name, actions) => hooks.objectActions.set(name, { ...(hooks.objectActions.get(name) ?? {}), ...actions }),
  onCanTeleport: (handler) => hooks.teleport.push(handler),
  registerArea: (area) => hooks.areas.push(area),
  onPlayerLogout: (handler) => hooks.logout.push(handler),
  onPlayerLogin: (handler) => hooks.login.push(handler),
  onNpcInteraction: (name, actions) => { hooks.npcs[name] = actions; },
  onCustomEvent: (name, handler) => { hooks.listeners[name] = handler; },
  emitCustomEvent: (name, payload) => {
    hooks.events.push({ name, payload });
    hooks.answers[name]?.(payload);
  },
  log() {},
};

const { COURSES } = require("../plugins/skills/agility/courses/Courses.Agility");
const { Anim } = require("../plugins/skills/agility/Constants.Agility");
const { SHORTCUTS } = require("../plugins/skills/agility/shortcuts/Shortcuts.Agility");
const { build } = require("../plugins/skills/agility/shortcuts/ShortcutData.Agility");
const SHORTCUT_DATA = require("../plugins/skills/data/agility-shortcuts.json");

function createPlayer(x, y, z, level = 99, { skills = {}, worn = [], held = [], boostedTo = level } = {}) {
  let location = new Location(x, y, z);
  let forceMovement = null;
  const attributes = new Map();
  const state = { xp: 0, otherXp: {}, messages: [], spam: [], varbits: new Map(), varbitLog: [], scripts: [], sounds: [], animations: [], hits: 0, blocked: false, walked: 0 };
  const player = {
    state,
    getRunEnergy: () => state.energy ?? 50,
    setRunEnergy: value => { state.energy = Math.min(100, value); },
    getLocation: () => location,
    setLocation: (next) => { location = next.clone(); return player; },
    moveTo: (next) => { location = next.clone(); return player; },
    setWalkingDirection: () => { state.walked++; },
    getMovementQueue: () => ({
      reset() {},
      setBlockMovement: (blocked) => { state.blocked = blocked; },
      handleRegionChange() {},
    }),
    getForceMovement: () => forceMovement,
    setForceMovement: (value) => { forceMovement = value; return player; },
    setSkillAnimation() {},
    getUpdateFlag: () => ({ flag() {} }),
    performAnimation: (animation) => state.animations.push(animation.getId()),
    performGraphic() {},
    mergeObject: (object, start, end, bounds) => { state.merges = [...(state.merges ?? []), { object, start, end, bounds }]; },
    setPositionToFace() {},
    forceChat() {},
    sendMessage: (message) => state.messages.push(message),
    getDialogueManager: () => ({ startDialogues: () => { state.mesboxes = (state.mesboxes ?? 0) + 1; } }),
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    getSkillManager: () => ({
      getCurrentLevel: (skill) => (skill === Skill.AGILITY ? boostedTo : skills[skill.getName?.().toLowerCase?.()] ?? 99),
      getMaxLevel: () => level,
      addExperiences: (skill, amount) => {
        if (skill === Skill.AGILITY) state.xp += amount;
        else state.otherXp[skill.getName()] = (state.otherXp[skill.getName()] ?? 0) + amount;
      },
      getExperience: () => state.xp,
    }),
    getPacketSender: () => ({
      sendVarbit: (id, value) => { state.varbits.set(id, value); state.varbitLog.push([id, value]); },
      sendRunEnergy: () => { state.energyUpdates = (state.energyUpdates ?? 0) + 1; },
      sendClientScript: (id, ...args) => state.scripts.push([id, ...args]),
      sendTypedMessage: (type, message) => { state.spam.push(message); state.messages.push(message); },
      sendSound() {},
      sendSoundEffect: (id, loops, delay) => state.sounds.push(id),
      sendObjectAnimation() {},
    }),
    getCombat: () => ({ getHitQueue: () => ({ addPendingDamage: () => { state.hits++; } }) }),
    getInventory: () => ({
      isFull: () => false,
      addItem() {},
      contains: (id) => held.includes(id),
      getAmount: (id) => held.filter((item) => item === id).length,
      delete: (id, amount) => {
        for (let i = 0; i < amount; i++) held.splice(held.indexOf(id), 1);
      },
    }),
    getEquipment: () => ({ getItems: () => worn }),
    isRegistered: () => true,
    getHitpoints: () => 99,
    getUsername: () => "agility tester",
    getPrivateArea: () => null,
  };
  return player;
}

function gameObject(id, x, y, z, face = 0) {
  const definition = CacheDefinitions.getObject(id);
  const actions = definition?.actions ?? [];
  return {
    getId: () => id,
    getFace: () => face,
    getLocation: () => new Location(x, y, z),
    getDefinition: () => ({
      getName: () => definition?.name,
      getSizeX: () => definition?.sizeX ?? 1,
      getSizeY: () => definition?.sizeY ?? 1,
      getActions: () => actions,
      getInteractions: () => actions,
    }),
  };
}

function tileOf(player) {
  const location = player.getLocation();
  return [location.getX(), location.getY(), location.getZ()];
}

/** Routes the player the way the object packet would, clicks, and plays the obstacle out. */
function operate(player, objectId, objectTile, face = 0, clickType = 1) {
  const object = gameObject(objectId, ...objectTile, face);
  const definition = object.getDefinition();
  const route = { player, object, definition, objectId, clickType, destination: null };
  hooks.route.forEach((handler) => handler(route));
  if (route.destination) {
    player.setLocation(new Location(route.destination.x, route.destination.y, route.destination.z));
  }
  const option = definition.getActions()?.[clickType - 1];
  const handler = clickType === 1
    ? hooks.click.get(objectId)
    : hooks.objectActions.get(definition.getName())?.[option];
  assert.ok(handler, `no click handler for object ${objectId}, option ${option}`);
  const handled = handler({
    player,
    object,
    definition,
    objectId,
    clickType,
    option,
    location: { x: objectTile[0], y: objectTile[1], z: objectTile[2] },
    handled: false,
  });
  for (let ticks = 0; player.getAttribute("agility.obstacle") != null; ticks++) {
    assert.ok(ticks < 100, `obstacle ${objectId} never finished`);
    tick();
  }
  return handled;
}

/**
 * One lap in index order, using each index's first obstacle; the object sits beside the player.
 * `beforeLast` runs just before the final obstacle is clicked.
 */
function runLap(course, player, { beforeLast } = {}) {
  const byIndex = new Map();
  // A course that shares its first obstacles runs those from the course they belong to.
  const shared = course.sharesWith ? COURSES.find((other) => other.key === course.sharesWith.course) : null;
  for (const obstacle of shared?.obstacles ?? []) {
    if (obstacle.index <= course.sharesWith.through && !byIndex.has(obstacle.index)) byIndex.set(obstacle.index, obstacle);
  }
  for (const obstacle of course.obstacles) {
    if (obstacle.index != null && !byIndex.has(obstacle.index)) byIndex.set(obstacle.index, obstacle);
  }
  const indices = [...byIndex.keys()].sort((a, b) => a - b);
  for (const index of indices) {
    const obstacle = byIndex.get(index);
    if (index === indices.at(-1)) beforeLast?.();
    if (obstacle.npc != null) {
      hooks.npcs["Agility Trainer"]["Give-Stick"]({ player, npc: { getId: () => obstacle.npc }, npcId: obstacle.npc });
      continue;
    }
    const objectId = Array.isArray(obstacle.object) ? obstacle.object[0] : obstacle.object;
    const [x, y, z] = obstacle.at ?? tileOf(player);
    assert.notEqual(operate(player, objectId, obstacle.at ?? [x, y + 1, z]), false, `${course.key} obstacle ${index} was not handled`);
  }
}

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  Agility.register(agilityApi);
});

/** A loc the cache has: named, or a nameless multiloc (Wyrmscraig's cliff top) drawn as one. */
function isCacheLoc(id) {
  const loc = Number.isInteger(id) ? CacheDefinitions.getObject(id) : null;
  return !!loc && ((loc.name && loc.name !== "null") || (loc.transforms ?? []).some((other) => other >= 0));
}

test("every obstacle and shortcut uses an object id from the cache", () => {
  for (const entry of [...COURSES.flatMap((course) => course.obstacles), ...SHORTCUTS]) {
    if (entry.npc != null) {
      assert.ok(CacheDefinitions.getNpc(entry.npc)?.name, `unknown npc id ${entry.npc} (${entry.course?.key})`);
      continue;
    }
    // Stepped on, not clicked: the Agility Pyramid's stone blocks.
    if (entry.tiles) continue;
    const ids = Array.isArray(entry.object) ? entry.object : [entry.object];
    for (const id of ids) {
      assert.ok(isCacheLoc(id), `unknown object id ${id} (${entry.course?.key ?? "shortcut"})`);
    }
  }
});

test("course indices run 1..n without gaps", () => {
  for (const course of COURSES) {
    const indices = [...new Set(course.obstacles.map((obstacle) => obstacle.index).filter((index) => index != null))];
    indices.sort((a, b) => a - b);
    // A course that shares its first obstacles with another starts after them.
    const first = (course.sharesWith?.through ?? 0) + 1;
    assert.deepEqual(indices, indices.map((_, i) => i + first), course.key);
  }
});

const LAP_ENDS = {
  gnome: [2484, 3437, 0],
  draynor: [3103, 3261, 0],
  alkharid: [3299, 3194, 0],
  canifis: [3510, 3485, 0],
  seers: [2704, 3464, 0],
  pollnivneach: [3363, 2998, 0],
  ardougne: [2668, 3297, 0],
  prifddinas: [3240, 6109, 0],
  barbarian: [2543, 3553, 0],
  pyramid: [3364, 2830, 0],
  "shayzien-basic": [1554, 3639, 0],
  "shayzien-advanced": [1522, 3626, 0],
  "wyrm-basic": [1645, 2933, 0],
  "wyrm-advanced": [1645, 2933, 0],
  werewolf: [3528, 9873, 0],
  "ape-atoll": [2770, 2747, 0],
};
/** Courses that need gear to finish a lap. */
const LAP_GEAR = { "shayzien-advanced": () => grappleGear() };
/** Courses that need an item carried to finish a lap: Werewolf's stick, fetched on the way. */
const LAP_ITEMS = { werewolf: [4179] };
/** Courses whose obstacles can fail even at 99 (the Wilderness course, Wiki): the lap rolls every success. */
const LAP_ALWAYS_SUCCEEDS = new Set(["wilderness"]);
/** XP a lap pays in other skills (Barbarian Outpost's Strength, Wiki). */
const LAP_OTHER_XP = { barbarian: { Strength: 41.3 } };
/** The greegree form a course needs to finish a lap (Greegrees.plugin.js answers in game). */
const LAP_FORMS = { "ape-atoll": "small-ninja-monkey" };

function answerForm(form) {
  if (form) hooks.answers["greegree:form"] = (request) => { request.form = form; };
  else delete hooks.answers["greegree:form"];
}

for (const course of COURSES) {
  test(`${course.name}: a full lap counts once and pays the course's lap experience`, () => {
    groundItems.length = 0;
    const player = createPlayer(3200, 3200, 0, 99, { worn: LAP_GEAR[course.key]?.() ?? [], held: [...(LAP_ITEMS[course.key] ?? [])] });
    answerForm(LAP_FORMS[course.key]);
    const random = Math.random;
    if (LAP_ALWAYS_SUCCEEDS.has(course.key)) Math.random = () => 0;
    try {
      runLap(course, player);
    } finally {
      Math.random = random;
      answerForm(null);
    }

    assert.equal(player.getAttribute("agility.laps")?.[course.key], 1);
    assert.ok(
      player.state.messages.some((message) => message.startsWith(`Your ${course.name} lap count is:`)),
      "lap count message"
    );
    if (course.lapXp > 0) {
      assert.equal(Math.round(player.state.xp * 10) / 10, course.lapXp);
    }
    assert.deepEqual(player.state.otherXp, LAP_OTHER_XP[course.key] ?? {});
    const busy = player.state.varbitLog.filter(([id]) => id === 12393).map(([, value]) => value);
    assert.ok(busy.length > 0 && busy.at(-1) === 0, "BUSY set while each obstacle plays and cleared after (rsprox 1788, 1885)");
    if (LAP_ENDS[course.key]) {
      assert.deepEqual(tileOf(player), LAP_ENDS[course.key]);
    }
    assert.equal(player.state.blocked, false, "movement unblocked after the lap");
    // Cleared, unless the last tick started a landing, which plays out.
    assert.ok([65535, Anim.LAND].includes(player.state.animations.at(-1)), "transient obstacle animation cleared");
    if (course.name.includes("Rooftop")) {
      assert.equal(player.state.energyUpdates, course.finalIndex, "energy updated after every successful rooftop obstacle");
      assert.equal(player.state.energy, 50 + Math.floor(1.5 * course.finalIndex), "1.5% an obstacle (rsprox 339, 3154)");
    } else {
      assert.equal(player.state.energyUpdates, undefined, "no invented energy restore on other courses");
    }
  });
}

test("a Draynor lap completes the Lumbridge & Draynor easy diary task", () => {
  hooks.events.length = 0;
  const draynor = COURSES.find((course) => course.key === "draynor");
  const player = createPlayer(3103, 3279, 0);
  runLap(draynor, player);
  const task = hooks.events.find((event) => event.name === "diary:task");
  assert.deepEqual(task?.payload, {
    player,
    diary: "lumbridge",
    task: "complete-a-lap-of-the-draynor-village-agility-co",
  });
});

test("every shortcut plays out from either side without leaving the player locked", () => {
  const random = Math.random;
  Math.random = () => 0.5;
  try {
    for (const shortcut of SHORTCUTS) {
      const objectId = Array.isArray(shortcut.object) ? shortcut.object[0] : shortcut.object;
      const [x, y, z] = shortcut.at ?? [3000, 3000, 0];
      for (const [dx, dy] of [[-2, -2], [2, 2]]) {
        const player = createPlayer(x + dx, y + dy, z);
        operate(player, objectId, [x, y, z]);
        assert.equal(player.getAttribute("agility.obstacle") ?? null, null);
        assert.equal(player.state.blocked, false);
      }
    }
  } finally {
    Math.random = random;
  }
});

test("shortcut audit: current directional Agility gates and captured no-sequence climbs", () => {
  const entry = (name, objectId) => SHORTCUTS.find((shortcut) =>
    shortcut.name === name && (Array.isArray(shortcut.object) ? shortcut.object.includes(objectId) : shortcut.object === objectId));
  const context = (obj, pos) => ({ obj: { ...obj, id: obj.id ?? 0 }, pos });

  assert.equal(entry("Strange floor (Fremennik Slayer Dungeon)", 16544).level, 43);
  assert.equal(entry("Pipe (Brimhaven Dungeon)", 21727).level, 1);
  assert.equal(entry("Pipe (Brimhaven Dungeon, toward demons)", 60840).level, 34);
  assert.equal(entry("Pipe (Brimhaven Dungeon Entrance)", 21728).level, 22);
  assert.equal(entry("Pipe (Brimhaven Dungeon Entrance, toward entrance)", 60841).level, 1);
  assert.equal(entry("Log balance (Brimhaven Dungeon, heading east)", 20882).level, 30);
  assert.equal(entry("Log balance (Brimhaven Dungeon, heading west)", 20884).level, 1);
  assert.equal(entry("Stepping stones (Western Brimhaven Dungeon)", 21738).level, 12);
  assert.equal(entry("Stepping stones (Western Brimhaven Dungeon)", 21739).level, 1);

  const river = entry("Stepping stones (Eastern Brimhaven Dungeon)", 19040);
  assert.deepEqual([
    river.level(context({ x: 2688, y: 9547 }, { x: 2690, y: 9547 })),
    river.level(context({ x: 2684, y: 9548 }, { x: 2682, y: 9548 })),
    river.level(context({ x: 2695, y: 9531 }, { x: 2695, y: 9533 })),
    river.level(context({ x: 2696, y: 9527 }, { x: 2697, y: 9525 })),
  ], [1, 56, 56, 1]);

  const pyramid = entry("Climbing rocks (Agility Pyramid)", 11948);
  assert.equal(pyramid.level(context({ x: 3335, y: 2827 }, { x: 3334, y: 2827 })), 1);
  assert.equal(pyramid.level(context({ x: 3335, y: 2827 }, { x: 3336, y: 2827 })), 30);

  const middleRailing = entry("Railing (Arceuus Library, middle floor)", 28373);
  const topRailing = entry("Railing (Arceuus Library, top floor)", 28373);
  assert.equal(middleRailing.level, 52);
  assert.equal(topRailing.level, 62);
  for (const [obj, from, landing] of [
    [{ x: 1628, y: 3806, z: 1, face: 3 }, [1627, 3806, 1], [1629, 3806, 0]],
    [{ x: 1637, y: 3804, z: 2, face: 1 }, [1638, 3804, 2], [1636, 3804, 0]],
    [{ x: 1629, y: 3803, z: 1, face: 2 }, [1629, 3802, 1], [1629, 3804, 0]],
    [{ x: 1631, y: 3812, z: 2, face: 0 }, [1631, 3813, 2], [1631, 3811, 0]],
  ]) {
    assert.deepEqual(middleRailing.route(context(obj, { x: from[0], y: from[1], z: from[2] })), from);
    assert.deepEqual(middleRailing.steps(context(obj, { x: from[0], y: from[1], z: from[2] })), [{ move: landing }]);
  }

  const yanille = entry("Climbing rocks (Yanille)", 23543);
  const yanilleObj = { x: 2561, y: 3108, z: 0 };
  assert.equal(yanille.precondition(context(yanilleObj, { x: 2561, y: 3106, z: 0 })), null);
  assert.match(yanille.precondition(context(yanilleObj, { x: 2561, y: 3111, z: 0 })), /this side/);
  assert.deepEqual(yanille.steps(context(yanilleObj, { x: 2561, y: 3108, z: 0 })), [
    { move: [2561, 3111, 0], speed: [0, 60], ticks: 1 },
    { sound: 2453 },
    { msg: "You climb over the wall." },
  ]);
  const townPlayer = createPlayer(2561, 3106, 0, 5);
  operate(townPlayer, 23543, [2561, 3108, 0]);
  assert.deepEqual(tileOf(townPlayer), [2561, 3111, 0]);
  assert.equal(townPlayer.state.xp, 25);
  const northPlayer = createPlayer(2561, 3111, 0, 5);
  operate(northPlayer, 23543, [2561, 3108, 0]);
  assert.deepEqual(tileOf(northPlayer), [2561, 3111, 0]);
  assert.equal(northPlayer.state.xp, 0);
  assert.ok(northPlayer.state.messages.some((message) => message.includes("this side")));
  const taverleySteps = entry("Climbing rocks (Taverley)", 53255).steps(
    context({ x: 2946, y: 3439, z: 0 }, { x: 2947, y: 3439, z: 0 })
  );
  assert.deepEqual(taverleySteps, [
    { move: [2943, 3439, 0], speed: [0, 60], ticks: 1 },
    { sound: 2453 },
    { msg: "You climb over the wall." },
  ]);
});

test("Arceuus railings use their cached Jump-down option and award Agility XP", () => {
  for (const [objectId, floor, level, xp] of [[28373, 1, 52, 3], [28374, 2, 62, 4]]) {
    const actions = CacheDefinitions.getObject(objectId)?.actions ?? [];
    assert.equal(actions[0], "Inspect", `object ${objectId} keeps its Inspect action first`);
    const clickType = actions.indexOf("Jump-down") + 1;
    assert.ok(clickType > 1, `object ${objectId} has a cached Jump-down action`);

    const inspect = createPlayer(1627, 3806, floor, level);
    assert.equal(operate(inspect, objectId, [1628, 3806, floor], 3, actions.indexOf("Inspect") + 1), false);
    assert.deepEqual(tileOf(inspect), [1627, 3806, floor], "Inspect does not route or jump");
    assert.equal(inspect.state.xp, 0, "Inspect does not award Agility XP");

    const player = createPlayer(1627, 3806, floor, level);
    operate(player, objectId, [1628, 3806, floor], 3, clickType);
    assert.deepEqual(tileOf(player), [1629, 3806, 0]);
    assert.equal(player.state.xp, xp);
  }

  const demonPipe = createPlayer(2698, 9492, 0, 34);
  operate(demonPipe, 60840, [2698, 9493, 0]);
  assert.deepEqual(tileOf(demonPipe), [2698, 9500, 0]);
  assert.equal(demonPipe.state.xp, 10);
});

test("the cache-backed Varrock broken fence crosses its clipped north-south edge", () => {
  const { RegionManager } = require("../dist/game/collision/RegionManager");
  const { MapObjects } = require("../dist/game/entity/impl/object/MapObjects");
  const core = PluginManager.getCoreApi();
  const objectId = core.ObjectIdentifiers.BROKEN_FENCE_2;
  const location = new Location(3308, 3492, 0);
  core.ObjectDefinition.init();
  RegionManager.init();
  RegionManager.loadMapFiles(location.getX(), location.getY());

  const fence = MapObjects.get(objectId, location, null);
  assert.ok(fence, "the cache places the Broken fence at the Quest Helper Lumber Yard route tile");
  assert.equal(fence.getType(), 10);
  assert.equal(fence.getFace(), 1, "cache rotation 1 blocks the north-south crossing");
  assert.equal(fence.getDefinition().getActions()[0], "Climb-over");
  assert.equal(RegionManager.canMove(3308, 3491, 3308, 3492, 0, 1, 1, null), false,
    "the south approach is clipped until the obstacle runs");

  const south = createPlayer(3308, 3491, 0, 1);
  assert.notEqual(operate(south, objectId, [3308, 3492, 0]), false);
  assert.deepEqual(tileOf(south), [3308, 3494, 0], "Climb-over lands north of the clipped fence");
  assert.ok(south.state.messages.includes("You climb over the broken fence."));
  assert.equal(south.getAttribute("agility.obstacle") ?? null, null);

  const north = createPlayer(3308, 3494, 0, 1);
  assert.notEqual(operate(north, objectId, [3308, 3492, 0]), false);
  assert.deepEqual(tileOf(north), [3308, 3491, 0], "the reverse interaction lands south of the fence");
  assert.equal(north.getAttribute("agility.obstacle") ?? null, null);
});

/** A loc's first option, or (for a multiloc like Wyrmscraig's cliff top) one of the locs it shows. */
function firstOption(id) {
  const loc = CacheDefinitions.getObject(id);
  return (loc?.actions ?? [])[0] ?? (loc?.transforms ?? []).filter((other) => other >= 0).map(firstOption).find(Boolean);
}

test("every shortcut in agility-shortcuts.json has a loc the player can click", () => {
  for (const entry of SHORTCUT_DATA.shortcuts) {
    assert.ok([].concat(entry.object).some(firstOption), `${entry.name}: no clickable loc`);
  }
});

test("the shortcut data refuses unknown kinds, scripts, animations and keys", () => {
  const base = { name: "Test", object: ObjectIds.STILE, level: 1 };
  assert.throws(() => build({ ...base }, 0), /needs one of/);
  assert.throws(() => build({ ...base, script: "nope" }, 0), /unknown script "nope"/);
  assert.throws(() => build({ ...base, steps: [{ anim: "NOT_AN_ANIM" }] }, 0)[0].steps, /unknown animation "NOT_AN_ANIM"/);
  assert.throws(() => build({ ...base, steps: [], colour: "red" }, 0), /unknown key "colour"/);
});

test("cache-rotated Kandarin stiles route to the near side and cross their long footprint (#2871)", () => {
  const { RegionManager } = require("../dist/game/collision/RegionManager");
  const { MapObjects } = require("../dist/game/entity/impl/object/MapObjects");
  RegionManager.init();
  const placements = [
    { at: [2761, 3436, 0], ends: [[2761, 3435, 0], [2761, 3438, 0]], approaches: [[2761, 3433, 0], [2761, 3440, 0]] },
    { at: [2638, 3350, 0], ends: [[2637, 3350, 0], [2640, 3350, 0]] },
    { at: [2647, 3375, 0], ends: [[2646, 3375, 0], [2649, 3375, 0]] },
    { at: [2655, 3347, 0], ends: [[2654, 3347, 0], [2657, 3347, 0]] },
    { at: [2917, 3438, 0], ends: [[2916, 3438, 0], [2919, 3438, 0]] },
  ];
  for (const { at, ends, approaches = ends } of placements) {
    RegionManager.loadMapFiles(at[0], at[1]);
    const object = MapObjects.get(ObjectIds.STILE, new Location(...at), null);
    assert.ok(object, `cache stile at ${at}`);
    for (const side of [0, 1]) {
      const from = ends[side], to = ends[1 - side];
      assert.equal(RegionManager.blocked(new Location(...from), null), false, "approach is walkable");
      assert.equal(RegionManager.blocked(new Location(...to), null), false, "landing is walkable");
      const player = createPlayer(...approaches[side], 1);
      const route = { player, object, objectId: ObjectIds.STILE, clickType: 1, destination: null };
      hooks.route.forEach(handler => handler(route));
      assert.deepEqual(route.destination, { x: from[0], y: from[1], z: from[2] },
        `the approach stays on side ${side} at ${at}`);
      // Arrival is fixtured here; live MCP covers the actual approach path.
      player.setLocation(new Location(...from));
      assert.notEqual(operate(player, ObjectIds.STILE, at, object.getFace()), false);
      assert.deepEqual(tileOf(player), to, `crossing from side ${side} at ${at}`);
      assert.equal(player.state.xp, 0, "a level-1 stile grants no XP");
    }
  }
});

test("native Lizardman Canyon handholds enter and leave both crossings at level 1", () => {
  const { RegionManager } = require("../dist/game/collision/RegionManager");
  const { MapObjects } = require("../dist/game/entity/impl/object/MapObjects");
  RegionManager.init();
  RegionManager.loadMapFiles(1470, 3687);
  for (const [upperLoc, lowerLoc, upper, lower] of [
    [[1474, 3687, 0], [1471, 3687, 0], [1475, 3687, 0], [1470, 3687, 0]],
    [[1459, 3690, 0], [1457, 3690, 0], [1460, 3690, 0], [1456, 3690, 0]],
  ]) {
    for (const [id, at, from, to, animation] of [
      [27362, upperLoc, upper, lower, "human_climbing_down"],
      [42009, lowerLoc, lower, upper, "human_climbing"],
    ]) {
      const object = MapObjects.get(id, new Location(...at), null);
      assert.ok(object, `the active map places handholds ${id} at ${at}`);
      assert.equal(CacheDefinitions.getObject(id).name, "Handholds");
      assert.equal(object.getDefinition().getActions()[0], "Climb");
      assert.equal(RegionManager.blocked(new Location(...from), null), false, "approach is walkable");
      assert.equal(RegionManager.blocked(new Location(...to), null), false, "landing is walkable");
      const player = createPlayer(...from, 1);
      const route = { player, object, objectId: id, clickType: 1, destination: null };
      hooks.route.forEach(handler => handler(route));
      assert.deepEqual([route.destination.x, route.destination.y, route.destination.z], from,
        "routing stays on this side of the clipped cliff");
      assert.notEqual(operate(player, id, at), false);
      assert.deepEqual(tileOf(player), to);
      assert.ok(player.state.animations.includes(CacheDefinitions.getSeqId(animation)));
      assert.equal(player.state.xp, 0, "a canyon entrance does not award Agility XP");
      assert.equal(player.state.blocked, false, "finishing the climb releases movement");
    }
  }
});

test("the native Draynor underwall tunnel crosses both ways in one click (rsprox 4001)", () => {
  const core = PluginManager.getCoreApi();
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(3067, 3257);
  for (const [id, tile, from, to] of [
    [19032, [3067, 3257, 0], [3066, 3257, 0], [3070, 3257, 0]],
    [19036, [3069, 3257, 0], [3070, 3257, 0], [3066, 3257, 0]],
  ]) {
    const object = core.MapObjects.get(id, new Location(...tile), null);
    assert.equal(object?.getDefinition().getActions()[0], "Climb-into");
    const player = createPlayer(...from, 42);
    const route = { player, object, objectId: id, clickType: 1, destination: null };
    hooks.route.forEach(handler => handler(route));
    assert.deepEqual(route.destination, { x: from[0], y: from[1], z: 0 });
    operate(player, id, tile);
    assert.deepEqual(tileOf(player), to);
    assert.ok(player.state.animations.includes(844));
    assert.equal(player.state.xp, 0);
    assert.equal(player.state.blocked, false);
    const low = createPlayer(...from, 41);
    operate(low, id, tile);
    assert.deepEqual(tileOf(low), from);
    assert.match(low.state.messages.at(-1), /42/);
  }
});

test("the native Draynor River Lum stone routes to this shore and finishes across the river", () => {
  const { RegionManager } = require("../dist/game/collision/RegionManager");
  const { MapObjects } = require("../dist/game/entity/impl/object/MapObjects");
  const DRAYNOR_STONE = 16533;
  const stoneTile = [3151, 3363, 0];
  const west = [3149, 3363, 0], east = [3154, 3363, 0];
  RegionManager.init();
  RegionManager.loadMapFiles(...stoneTile);
  const object = MapObjects.get(DRAYNOR_STONE, new Location(...stoneTile), null);
  assert.ok(object, "the active cache places a single clickable stone in the river");
  assert.equal(object.getDefinition().getName(), "Stepping stone");
  assert.equal(object.getDefinition().getActions()[0], "Jump-onto");
  assert.equal(RegionManager.blocked(new Location(...stoneTile), null), true, "the stone is not a walking destination");
  for (const shore of [west, east]) assert.equal(RegionManager.blocked(new Location(...shore), null), false);

  for (const [from, approach, to] of [[west, west, east], [east, east, west], [[3147, 3363, 0], west, east], [[3156, 3363, 0], east, west]]) {
    const player = createPlayer(...from, 31);
    const landings = [], moveTo = player.moveTo;
    player.moveTo = location => {
      landings.push([location.getX(), location.getY(), location.getZ()]);
      return moveTo(location);
    };
    const route = { player, object, objectId: DRAYNOR_STONE, clickType: 1, destination: null };
    hooks.route.forEach(handler => handler(route));
    assert.deepEqual(route.destination, { x: approach[0], y: approach[1], z: approach[2] }, "approach stays on the near shore");
    assert.notEqual(operate(player, DRAYNOR_STONE, stoneTile), false);
    assert.deepEqual(landings, [stoneTile, to], "the crossing uses the actual stone before reaching shore");
    assert.deepEqual(tileOf(player), to, "one click completes the crossing");
    assert.equal(player.state.xp, 3);
    assert.equal(player.state.blocked, false);
    assert.equal(player.getAttribute("agility.obstacle") ?? null, null);
  }

  const underLevel = createPlayer(...west, 30);
  assert.notEqual(operate(underLevel, DRAYNOR_STONE, stoneTile), false);
  assert.deepEqual(tileOf(underLevel), west);
  assert.equal(underLevel.state.xp, 0);
  assert.equal(underLevel.state.blocked, false);
  assert.match(underLevel.state.messages.at(-1), /31.*Agility|Agility.*31/);
});

test("a crossing's via tiles are walked in travel order, both ways", () => {
  const [crossing] = build({
    name: "Test stones", object: ObjectIds.STILE, level: 1,
    between: { ends: [[10, 10, 0], [10, 14, 0]], via: [[10, 11], [10, 12], [10, 13]], cross: [{ use: "hops", args: ["...via", "to"] }] },
  }, 0);
  const moves = (pos) => crossing.steps({ pos, obj: { x: 10, y: 12, z: 0 } }).filter((step) => step.move).map((step) => step.move);
  assert.deepEqual(moves({ x: 10, y: 10, z: 0 }), [[10, 11], [10, 12], [10, 13], [10, 14, 0]]);
  assert.deepEqual(moves({ x: 10, y: 14, z: 0 }), [[10, 13], [10, 12], [10, 11], [10, 10, 0]]);
});

/** The worn items for a crossbow and a mith grapple, in their equipment slots. */
function grappleGear() {
  const { Equipment } = PluginManager.getCoreApi();
  const worn = new Array(14).fill(null);
  worn[Equipment.WEAPON_SLOT] = { getId: () => 9183, getDefinition: () => ({ getName: () => "Mithril crossbow" }) };
  worn[Equipment.AMMUNITION_SLOT] = { getId: () => 9419, getDefinition: () => ({ getName: () => "Mith grapple" }) };
  return worn;
}

test("a grapple needs the gear and skills, or the barehanded Agility level (Wiki: Rough wall)", () => {
  const wall = [3033, 3390, 0];
  const fires = (player) => player.state.animations.includes(1779); // fire and climb (rsprox, rev 237)
  const bare = createPlayer(3033, 3390, 0, 40, { skills: { strength: 37, ranged: 19 } });
  operate(bare, ObjectIds.ROUGH_WALL_8, wall);
  assert.deepEqual(tileOf(bare), [3033, 3390, 0], "refused: no crossbow, and short of the barehanded 52");
  assert.ok(bare.state.messages.includes("You need a crossbow equipped to do that."));

  const geared = createPlayer(3033, 3390, 0, 11, { skills: { strength: 37, ranged: 19 }, worn: grappleGear() });
  operate(geared, ObjectIds.ROUGH_WALL_8, wall);
  assert.deepEqual(tileOf(geared), [3033, 3389, 1]);
  assert.ok(fires(geared), "fires the grapple");

  const weak = createPlayer(3033, 3390, 0, 11, { skills: { strength: 36, ranged: 19 }, worn: grappleGear() });
  operate(weak, ObjectIds.ROUGH_WALL_8, wall);
  assert.deepEqual(tileOf(weak), [3033, 3390, 0]);
  assert.ok(weak.state.messages.includes("You need a Strength level of at least 37 to attempt this."));

  const climber = createPlayer(3033, 3390, 0, 52);
  operate(climber, ObjectIds.ROUGH_WALL_8, wall);
  assert.deepEqual(tileOf(climber), [3033, 3389, 1], "barehanded at 52");
  assert.ok(!fires(climber), "no grapple fired");
});

test("Yanille's south-wall grapple updates Ardougne medium progress after crossing", () => {
  const wall = [2556, 3074, 0];
  const credits = () => hooks.events.filter((event) => event.name === "agility:yanille-grapple");
  const taskKey = "grapple-over-yanille-s-south-wall";
  const ardougne = DiaryData.BY_KEY.get("ardougne");
  const medium = ardougne.tiers.medium;
  const assertNoProgress = (player) => {
    assert.equal(player.getAttribute(DiaryProgress.TASKS_ATTRIBUTE)?.ardougne?.includes(taskKey) ?? false, false);
    assert.equal(player.state.varbits.get(medium.countVarbit), undefined);
  };

  DiaryProgress({
    core: PluginManager.getCoreApi(),
    persistAttribute() {},
    onPlayerLogin() {},
    getTaskManager: () => taskManager,
    emitCustomEvent() {},
  });
  hooks.answers["diary:task"] = AchievementDiaries._test.onTask;
  YanilleGrappleDiary.register({
    onCustomEvent: (name, handler) => { hooks.answers[name] = handler; },
    emitCustomEvent: (name, payload) => {
      hooks.events.push({ name, payload });
      hooks.answers[name]?.(payload);
    },
  });

  hooks.events.length = 0;
  const grappler = createPlayer(2556, 3075, 0, 39, {
    skills: { strength: 38, ranged: 21 },
    worn: grappleGear(),
  });
  operate(grappler, 17047, wall);
  assert.deepEqual(tileOf(grappler), [2556, 3074, 1]);
  assert.equal(credits().length, 1);
  assert.equal(credits()[0].payload.method, "grapple");
  assert.deepEqual(grappler.getAttribute(DiaryProgress.TASKS_ATTRIBUTE).ardougne, [taskKey]);
  assert.equal(grappler.state.varbits.get(medium.countVarbit), 1);
  assert.equal(grappler.state.varbits.get(ardougne.startedVarbit), 1);

  hooks.events.length = 0;
  const otherApproach = createPlayer(2556, 3072, 0, 39, {
    skills: { strength: 38, ranged: 21 },
    worn: grappleGear(),
  });
  operate(otherApproach, 17047, [2556, 3073, 0]);
  assert.deepEqual(tileOf(otherApproach), [2556, 3073, 1]);
  assert.equal(credits().length, 1);
  assert.deepEqual(otherApproach.getAttribute(DiaryProgress.TASKS_ATTRIBUTE).ardougne, [taskKey]);
  assert.equal(otherApproach.state.varbits.get(medium.countVarbit), 1);

  hooks.events.length = 0;
  const barehanded = createPlayer(2556, 3075, 0, 69, {
    skills: { strength: 37, ranged: 21 },
    worn: grappleGear(),
  });
  operate(barehanded, 17047, wall);
  assert.deepEqual(tileOf(barehanded), [2556, 3074, 1]);
  assert.equal(credits().length, 0, "the level-69 barehanded alternative does not count");
  assertNoProgress(barehanded);

  hooks.events.length = 0;
  const privateArea = createPlayer(2556, 3075, 0, 39, {
    skills: { strength: 38, ranged: 21 },
    worn: grappleGear(),
  });
  privateArea.getPrivateArea = () => ({});
  operate(privateArea, 17047, wall);
  assert.equal(credits().length, 0, "a private crossing does not count");
  assertNoProgress(privateArea);

  hooks.events.length = 0;
  const interrupted = createPlayer(2556, 3075, 0, 39, {
    skills: { strength: 38, ranged: 21 },
    worn: grappleGear(),
  });
  hooks.click.get(17047)({ player: interrupted, object: gameObject(17047, ...wall), objectId: 17047, clickType: 1, location: { x: wall[0], y: wall[1], z: wall[2] }, handled: false });
  interrupted.getAttribute("agility.obstacle").stop();
  assert.equal(credits().length, 0, "an interrupted action does not count");
  assertNoProgress(interrupted);

  hooks.events.length = 0;
  const otherWall = createPlayer(2556, 3072, 0, 39, {
    skills: { strength: 38, ranged: 21 },
    worn: grappleGear(),
  });
  otherWall.setLocation(new Location(3033, 3390, 0));
  operate(otherWall, 17047, [3033, 3390, 0]);
  assert.deepEqual(tileOf(otherWall), [3033, 3389, 1]);
  assert.equal(credits().length, 0, "a Falador wall crossing does not count");
  assertNoProgress(otherWall);

  hooks.events.length = 0;
  const loggedOut = createPlayer(2556, 3075, 0, 39, {
    skills: { strength: 38, ranged: 21 },
    worn: grappleGear(),
  });
  const object = gameObject(17047, ...wall);
  hooks.click.get(17047)({ player: loggedOut, object, objectId: 17047, clickType: 1, location: { x: wall[0], y: wall[1], z: wall[2] }, handled: false });
  tick();
  hooks.logout.forEach((handler) => handler({ player: loggedOut }));
  assert.equal(credits().length, 0, "logout fast-forward does not count");
  assertNoProgress(loggedOut);

  hooks.events.length = 0;
  const dead = createPlayer(2556, 3075, 0, 39, {
    skills: { strength: 38, ranged: 21 },
    worn: grappleGear(),
  });
  hooks.click.get(17047)({ player: dead, object: gameObject(17047, ...wall), objectId: 17047, clickType: 1, location: { x: wall[0], y: wall[1], z: wall[2] }, handled: false });
  dead.getHitpoints = () => 0;
  tick();
  assert.equal(credits().length, 0, "death interrupts the crossing");
  assertNoProgress(dead);

  delete hooks.answers["agility:yanille-grapple"];
  delete hooks.answers["diary:task"];
});

test("a quest gate refuses only when the quest plugin says it isn't done", () => {
  const window = [3290, 3158, 0];
  try {
    hooks.answers["quest:is-complete"] = (request) => {
      if (request.key === "prince_ali_rescue") request.complete = false;
    };
    const before = createPlayer(3290, 3157, 0);
    operate(before, ObjectIds.BIG_WINDOW, window);
    assert.ok(before.state.messages.includes("You need to complete Prince Ali Rescue to use this shortcut."));
    hooks.answers["quest:is-complete"] = (request) => {
      if (request.key === "prince_ali_rescue") request.complete = true;
    };
    const after = createPlayer(3290, 3157, 0);
    operate(after, ObjectIds.BIG_WINDOW, window);
    assert.ok(!after.state.messages.some((message) => message.includes("Prince Ali")));
  } finally {
    delete hooks.answers["quest:is-complete"];
  }
  const unknown = createPlayer(3290, 3157, 0);
  operate(unknown, ObjectIds.BIG_WINDOW, window);
  assert.ok(!unknown.state.messages.some((message) => message.includes("Prince Ali")), "a quest no plugin knows is no bar");
});

test("diary gates are recorded but not enforced until the diary's tasks can be done", () => {
  hooks.events.length = 0;
  const player = createPlayer(2898, 9902, 0);
  operate(player, ObjectIds.CREVICE_7, [2898, 9901, 0]);
  assert.ok(!hooks.events.some((event) => event.name === "diary:is-complete"));
  assert.ok(!player.state.messages.some((message) => message.includes("Diary")));
});

test("failures roll the OSRS low/high success chance the Wiki charts", () => {
  const random = Math.random;
  try {
    // Lumbridge Swamp Caves stones: low 51, high 252 -> 52/256 at level 1.
    const stones = [3207, 9572, 0];
    Math.random = () => 51.5 / 256;
    const lucky = createPlayer(3208, 9572, 0, 1);
    operate(lucky, ObjectIds.STEPPING_STONE_2, stones);
    assert.equal(lucky.state.xp, 3, "success: 3 XP");
    Math.random = () => 52.5 / 256;
    const unlucky = createPlayer(3208, 9572, 0, 1);
    operate(unlucky, ObjectIds.STEPPING_STONE_2, stones);
    assert.equal(unlucky.state.xp, 1, "failure: 1 XP");
    assert.equal(unlucky.state.hits, 1);
  } finally {
    Math.random = random;
  }
});

test("a failure that still crosses moves the player and hurts them (Wiki: Jutting wall)", () => {
  const random = Math.random;
  try {
    Math.random = () => 0.99;
    const player = createPlayer(2400, 4404, 0, 46);
    operate(player, ObjectIds.JUTTING_WALL_2, [2400, 4403, 0]);
    assert.deepEqual(tileOf(player), [2400, 4402, 0], "still crossed");
    assert.equal(player.state.hits, 1);
    assert.equal(player.state.xp, 6, "the failure's 6 XP");
  } finally {
    Math.random = random;
  }
});

test("shortcuts sharing an object id are told apart by their tile", () => {
  const dropTile = [3033, 3390, 1];
  const player = createPlayer(3033, 3389, 1);
  operate(player, ObjectIds.WALL_60, dropTile);
  assert.deepEqual(tileOf(player), [3033, 3390, 0]);
});

test("Shayzien: the shared start goes on into either course, and the beams need the grapple", () => {
  const basic = COURSES.find((course) => course.key === "shayzien-basic");
  const advanced = COURSES.find((course) => course.key === "shayzien-advanced");
  const shared = basic.obstacles.filter((obstacle) => obstacle.index <= 3);
  const beam = advanced.obstacles.find((obstacle) => obstacle.index === 4);

  const bare = createPlayer(1554, 3630, 0);
  for (const obstacle of shared) operate(bare, obstacle.object, [1554, 3631, 0]);
  operate(bare, beam.object, [1512, 3637, 2]);
  assert.ok(bare.state.messages.includes("You need a crossbow equipped to do that."));
  assert.deepEqual(bare.getAttribute("agility.progress"), { course: "shayzien-basic", index: 3 }, "still mid-lap");

  const geared = createPlayer(1554, 3630, 0, 99, { worn: grappleGear() });
  for (const obstacle of shared) operate(geared, obstacle.object, [1554, 3631, 0]);
  operate(geared, beam.object, [1512, 3637, 2]);
  assert.deepEqual(geared.getAttribute("agility.progress"), { course: "shayzien-advanced", index: 4 });
});

test("Shayzien's start ladder is claimed from the Ladders plugin and climbed as the course's obstacle", () => {
  const player = createPlayer(1554, 3630, 0);
  const request = { player, object: gameObject(42209, 1554, 3631, 0), objectId: 42209, clickType: 1, handled: false };
  hooks.listeners["ladders:climb"](request);
  assert.equal(request.handled, true);
  for (let ticks = 0; player.getAttribute("agility.obstacle") != null && ticks < 10; ticks++) tick();
  assert.deepEqual(tileOf(player), [1554, 3632, 3]);
  const other = { player, object: gameObject(16683, 3200, 3200, 0), objectId: 16683, clickType: 1, handled: false };
  hooks.listeners["ladders:climb"](other);
  assert.equal(other.handled, false, "other ladders stay the Ladders plugin's");
});

test("skipping an obstacle does not count a lap", () => {
  const course = COURSES.find((entry) => entry.key === "draynor");
  const player = createPlayer(3103, 3279, 3);
  for (const obstacle of course.obstacles.filter((entry) => entry.index !== 3)) {
    operate(player, obstacle.object, [...tileOf(player).slice(0, 1), tileOf(player)[1] + 1, tileOf(player)[2]]);
  }
  assert.equal(player.getAttribute("agility.laps")?.draynor, undefined);
});

test("an obstacle above the player's level is refused without moving them", () => {
  const course = COURSES.find((entry) => entry.key === "ardougne");
  const player = createPlayer(2673, 3297, 0, 50);
  operate(player, course.obstacles[0].object, [2673, 3298, 0]);
  assert.deepEqual(tileOf(player), [2673, 3297, 0]);
  assert.deepEqual(player.state.messages, ["You need an Agility level of at least 90 to attempt this."]);
  assert.equal(player.state.xp, 0);
});

test("Varrock's fallable obstacles stop failing at 46, the Wiki's no-fail level", () => {
  const obstacles = [
    { index: 2, object: ObjectIds.CLOTHES_LINE, start: [3214, 3414, 3], tile: [3213, 3414, 3], xp: 23 },
    { index: 4, object: ObjectIds.WALL_14, start: [3194, 3416, 1], tile: [3191, 3415, 1], xp: 28 },
  ];
  const random = Math.random;
  Math.random = () => 0.999;
  try {
    for (const { index, object, start, tile, xp } of obstacles) {
      const failing = createPlayer(...start, 45);
      operate(failing, object, tile);
      assert.equal(failing.state.xp, 0, `obstacle ${index} still fails at 45`);
      assert.equal(failing.state.hits, 1, `obstacle ${index} takes fall damage at 45`);

      const boundary = createPlayer(...start, 46);
      operate(boundary, object, tile);
      assert.equal(boundary.state.xp, xp, `obstacle ${index} succeeds at 46`);
      assert.equal(boundary.state.hits, 0, `obstacle ${index} takes no fall damage at 46`);

      const high = createPlayer(...start, 99);
      operate(high, object, tile);
      assert.equal(high.state.xp, xp, `obstacle ${index} succeeds at 99`);
      assert.equal(high.state.hits, 0, `obstacle ${index} takes no fall damage at 99`);

      const below = createPlayer(...start, 29);
      operate(below, object, tile);
      assert.deepEqual(below.state.messages, ["You need an Agility level of at least 30 to attempt this."], `obstacle ${index} refuses below 30`);
      assert.equal(below.state.xp, 0);
      assert.equal(below.getAttribute("agility.obstacle") ?? null, null);
    }
  } finally {
    Math.random = random;
  }
});

test("Al Kharid's zip line cannot fail after the 2024 fail-point removal", () => {
  const zipline = COURSES.find((entry) => entry.key === "alkharid").obstacles.find((entry) => entry.index === 4);
  const random = Math.random;
  Math.random = () => 0.999;
  try {
    const player = createPlayer(3301, 3163, 3, 20);
    operate(player, zipline.object, [3301, 3163, 3]);
    assert.deepEqual(tileOf(player), [3315, 3163, 1]);
    assert.equal(player.state.xp, 48);
    assert.equal(player.state.hits, 0);
  } finally {
    Math.random = random;
  }
});

test("a low-level Prifddinas runner can fall from a tightrope and take damage", () => {
  const rope = COURSES.find((entry) => entry.key === "prifddinas").obstacles.find((entry) => entry.index === 2);
  const random = Math.random;
  Math.random = () => 0.99;
  try {
    const player = createPlayer(3257, 6105, 2, 75);
    operate(player, rope.object, [3258, 6105, 2]);
    assert.deepEqual(tileOf(player), [3263, 6106, 0]);
    assert.equal(player.state.hits, 1);
    assert.equal(player.state.xp, 0);
  } finally {
    Math.random = random;
  }
});

test("logging out mid-obstacle lands the player on the far side", () => {
  const rope = COURSES.find((entry) => entry.key === "draynor").obstacles.find((entry) => entry.index === 2);
  const player = createPlayer(3099, 3277, 3);
  const object = gameObject(rope.object, 3098, 3277, 3);
  hooks.click.get(rope.object)({ player, object, objectId: rope.object, clickType: 1, location: { x: 3098, y: 3277, z: 3 }, handled: false });
  tick();
  hooks.logout.forEach((handler) => handler({ player }));
  // The rope's last tile, a step down off it (rsprox 1723).
  assert.deepEqual(tileOf(player), [3090, 3276, 3]);
  assert.equal(player.getAttribute("agility.obstacle"), null);
  assert.equal(player.state.xp, 8);
});

test("moves land after exactly their ticks (Rocks, Ralos' Rise: three 2-tick moves, as captured)", () => {
  const player = createPlayer(1455, 3128, 0);
  hooks.click.get(ObjectIds.ROCKS_151)({ player, object: gameObject(ObjectIds.ROCKS_151, 1456, 3128, 0), objectId: ObjectIds.ROCKS_151, clickType: 1, location: { x: 1456, y: 3128, z: 0 }, handled: false });
  let ticks = 0;
  while (tileOf(player)[0] !== 1465 && ticks < 60) {
    tick();
    ticks++;
  }
  assert.equal(ticks, 6);
  for (let more = 0; player.getAttribute("agility.obstacle") != null && more < 5; more++) tick();
});

test("the Mokhaiotl pillars swap sides: each jump sets varbit 16716 so the far pillar shows (as captured)", () => {
  const player = createPlayer(1311, 9506, 1);
  operate(player, 56608, [1311, 9509, 1]);
  assert.deepEqual(tileOf(player), [1311, 9509, 1]);
  assert.equal(player.state.varbits.get(16716), 1);
  operate(player, 56609, [1311, 9506, 1]);
  assert.deepEqual(tileOf(player), [1311, 9506, 1]);
  assert.equal(player.state.varbits.get(16716), 0);
});

test("the Chasm of Fire gaps land where the captures do: one long jump, then two hops", () => {
  // rsprox captures 817, 819: 1440,10098 -> 1446; 1448 -> 1453 -> 1456 a tick apart.
  const player = createPlayer(1440, 10098, 1);
  operate(player, 56372, [1443, 10097, 1]);
  assert.deepEqual(tileOf(player), [1446, 10097, 1]);
  operate(player, 56372, [1450, 10097, 1]);
  assert.deepEqual(tileOf(player), [1456, 10097, 1]);
  operate(player, 56372, [1450, 10097, 1]);
  assert.deepEqual(tileOf(player), [1448, 10097, 1], "the way back mirrors it");
  operate(player, 56372, [1443, 10097, 1]);
  assert.deepEqual(tileOf(player), [1440, 10098, 1]);
});

test("the Prifddinas course's second half is played south-west of the city, as captured", () => {
  // rsprox capture 1149: the first dark hole drops to 2269,3389, the last climbs back to the city.
  const course = COURSES.find((entry) => entry.key === "prifddinas");
  const darkHole = course.obstacles.find((entry) => entry.index === 5);
  const player = createPlayer(3269, 6117, 0);
  operate(player, darkHole.object, [3269, 6118, 0]);
  assert.deepEqual(tileOf(player), [2269, 3389, 0]);
  const ladder = course.obstacles.find((entry) => entry.index === 6);
  operate(player, ladder.object, [2270, 3393, 0]);
  assert.deepEqual(tileOf(player), [2269, 3393, 2]);
  const lastRope = course.obstacles.find((entry) => entry.index === 11);
  const roper = createPlayer(2253, 3418, 2);
  operate(roper, lastRope.object, [2253, 3418, 2]);
  assert.deepEqual(tileOf(roper), [2260, 3425, 0]);
});

test("teleports are refused while crossing an obstacle", () => {
  const rope = COURSES.find((entry) => entry.key === "draynor").obstacles.find((entry) => entry.index === 2);
  const player = createPlayer(3099, 3277, 3);
  operate(player, rope.object, [3098, 3277, 3]);
  const idle = { player, allow: null };
  hooks.teleport.forEach((handler) => handler(idle));
  assert.equal(idle.allow, null);

  hooks.click.get(rope.object)({ player, object: gameObject(rope.object, 3098, 3277, 3), objectId: rope.object, clickType: 1, location: { x: 3098, y: 3277, z: 3 }, handled: false });
  const busy = { player, allow: null };
  hooks.teleport.forEach((handler) => handler(busy));
  assert.equal(busy.allow, false);
  hooks.logout.forEach((handler) => handler({ player }));
});

test("a climb faces the loc: across a wall decoration's edge, or the loc's tile", () => {
  const { faceLoc } = require("../plugins/skills/agility/Steps.Agility");
  // Ardougne's wooden beams: a wall decoration (shape 5) on the start tile's north edge (rotation 1).
  const beams = { x: 2673, y: 3298, z: 0, face: 1, type: 5, id: ObjectIds.WOODEN_BEAMS };
  assert.deepEqual(faceLoc(beams), { face: [2673, 3299] });
  assert.deepEqual(faceLoc({ ...beams, face: 0 }), { face: [2672, 3298] }, "rotation 0: west");
  assert.deepEqual(faceLoc({ ...beams, face: 3 }), { face: [2673, 3297] }, "rotation 3: south");
  assert.deepEqual(faceLoc({ ...beams, type: 10 }), { face: [2673, 3298] }, "a centrepiece: its own tile");

  const ardougne = COURSES.find((course) => course.key === "ardougne");
  const first = ardougne.obstacles.find((obstacle) => obstacle.index === 1);
  const steps = first.steps({ player: null, obj: beams, pos: { x: 2673, y: 3298, z: 0 } });
  assert.deepEqual(steps[0], { face: [2673, 3299] }, "the player faces the beams (north) to climb");
});

test("Varrock's rough wall is climbed facing it (west, across its edge)", () => {
  // A wall decoration (shape 5) on the west edge of the start tile (rotation 0).
  const wall = { x: 3221, y: 3414, z: 0, face: 0, type: 5, id: ObjectIds.ROUGH_WALL_3 };
  const varrock = COURSES.find((course) => course.key === "varrock");
  const first = varrock.obstacles.find((obstacle) => obstacle.index === 1);
  const steps = first.steps({ player: null, obj: wall, pos: { x: 3221, y: 3414, z: 0 } });
  assert.deepEqual(steps[0], { face: [3220, 3414] });
});

test("Falador's rough wall is climbed facing it (north, across its edge)", () => {
  // A wall decoration (shape 5) on the north edge of the start tile (rotation 1).
  const wall = { x: 3036, y: 3341, z: 0, face: 1, type: 5, id: ObjectIds.ROUGH_WALL_4 };
  const falador = COURSES.find((course) => course.key === "falador");
  const first = falador.obstacles.find((obstacle) => obstacle.index === 1);
  const steps = first.steps({ player: null, obj: wall, pos: { x: 3036, y: 3341, z: 0 } });
  assert.deepEqual(steps[0], { face: [3036, 3342] });
});

test("Falador's handhold corner starts outside the house, with the wall path, end and XP unchanged", () => {
  const falador = COURSES.find((course) => course.key === "falador");
  const holds = falador.obstacles.find((obstacle) => obstacle.index === 3);
  assert.equal(holds.object, ObjectIds.HAND_HOLDS_4);

  const player = createPlayer(3050, 3350, 3);
  const landings = [];
  const moveTo = player.moveTo;
  player.moveTo = (location) => {
    landings.push([location.getX(), location.getY(), location.getZ()]);
    return moveTo(location);
  };
  hooks.events.length = 0;
  assert.notEqual(operate(player, holds.object, [3050, 3350, 3]), false);

  assert.deepEqual(landings[0], [3051, 3351, 2], "the initial corner lands outside the room");
  assert.deepEqual(landings.slice(1, 5), [
    [3051, 3352, 2],
    [3051, 3353, 2],
    [3051, 3354, 2],
    [3051, 3355, 2],
  ], "all four existing actor holds remain on the outside face");
  assert.deepEqual(landings.at(-1), [3050, 3357, 3], "the final roof landing is unchanged");
  assert.deepEqual(tileOf(player), [3050, 3357, 3]);

  assert.equal(player.state.xp, holds.xp, "one obstacle's XP, unchanged");
  assert.equal(
    hooks.events.filter((event) => event.name === "agility:obstacle" && event.payload.objectId === holds.object).length,
    1,
    "one completion"
  );
  assert.equal(player.getAttribute("agility.obstacle") ?? null, null);
});

test("Falador's diagonal tightrope follows the drawn span instead of the parallel click-anchor line", () => {
  const falador = COURSES.find((course) => course.key === "falador");
  const rope = falador.obstacles.find((obstacle) => obstacle.index === 6);
  const player = createPlayer(3035, 3362, 3);
  const tiles = [];
  const setLocation = player.setLocation;
  player.setLocation = (location) => {
    tiles.push([location.getX(), location.getY(), location.getZ()]);
    return setLocation(location);
  };
  hooks.events.length = 0;
  operate(player, rope.object, [3034, 3361, 3]);
  assert.deepEqual(tiles.slice(0, 2), [[3035, 3362, 3], [3034, 3362, 3]],
    "keep the roof approach, then step west onto the rope");
  // Cache loc 11397's visible span runs (3034,3362) -> (3028,3356).
  for (const [x, y, z] of tiles.slice(1)) {
    assert.equal(y - x, 328, `(${x},${y}) stays on the drawn diagonal`);
    assert.equal(z, 3);
  }
  assert.deepEqual(tileOf(player), [3027, 3355, 3]);
  assert.equal(player.state.xp, 61, "one obstacle's unchanged XP");
  assert.equal(hooks.events.filter((event) => event.name === "agility:obstacle"
    && event.payload.objectId === rope.object).length, 1);
  assert.equal(player.getAttribute("agility.obstacle") ?? null, null);
});

const MARK_OF_GRACE = 11849;
const MARK_COOLDOWN_ATTRIBUTE = "agility:mark-cooldown-minute";

/**
 * A lap of `key` with every obstacle roll passing, then `rolls` (Math.random values, 0 once they
 * run out) for the lap's end, at `minute` on the clock with the `diaries` tiers done. Returns the
 * marks spawned and how many were on the floor before the last obstacle.
 */
function lapWithMarkRolls(key, player, rolls, { minute = 1000, diaries = [] } = {}) {
  const course = COURSES.find((entry) => entry.key === key);
  const { random } = Math;
  const { now } = Date;
  const queue = [...rolls];
  let beforeLast = null;
  groundItems.length = 0;
  hooks.answers["diary:is-complete"] = (request) => { request.complete = diaries.includes(`${request.diary}:${request.tier}`); };
  Math.random = () => 0;
  Date.now = () => minute * 60_000 + 30_000;
  try {
    runLap(course, player, {
      beforeLast: () => {
        beforeLast = groundItems.length;
        Math.random = () => queue.shift() ?? 0;
      },
    });
  } finally {
    Math.random = random;
    Date.now = now;
    delete hooks.answers["diary:is-complete"];
  }
  return { marks: groundItems.filter((entry) => entry.item.getId() === MARK_OF_GRACE), beforeLast };
}

function markCount(key, level, rolls, options = {}) {
  const course = COURSES.find((entry) => entry.key === key);
  return lapWithMarkRolls(key, createPlayer(3200, 3200, 0, level ?? course.marks.level, options), rolls, options).marks.length;
}

test("a mark of grace is rolled when a lap is completed, and lasts 10 minutes for its player only (Wiki: Mark of Grace)", () => {
  const draynor = COURSES.find((course) => course.key === "draynor");
  const { marks, beforeLast } = lapWithMarkRolls("draynor", createPlayer(3103, 3279, 0, 10), [0]);
  assert.equal(beforeLast, 0, "nothing spawns while the lap is under way");
  assert.equal(marks.length, 1);
  assert.deepEqual(marks[0].options, { goesGlobal: false, despawnDelay: 1000 });
  const { x, y, z } = { x: marks[0].position.getX(), y: marks[0].position.getY(), z: marks[0].position.getZ() };
  assert.ok(draynor.marks.tiles.some((tile) => tile[0] === x && tile[1] === y && tile[2] === z), "on one of the course's mark tiles");
});

test("after a mark, laps can't roll another until the third clock minute on; the cooldown is saved (Wiki: Mark of Grace)", () => {
  assert.equal(hooks.persisted[MARK_COOLDOWN_ATTRIBUTE], 0, "saved, starting at 0");
  const player = createPlayer(3103, 3279, 0, 10);
  assert.equal(lapWithMarkRolls("draynor", player, [0], { minute: 1000 }).marks.length, 1);
  assert.equal(player.getAttribute(MARK_COOLDOWN_ATTRIBUTE), 1003);
  assert.equal(lapWithMarkRolls("draynor", player, [0], { minute: 1002 }).marks.length, 0, "still cooling down");
  assert.equal(player.getAttribute(MARK_COOLDOWN_ATTRIBUTE), 1003, "a lap in the cooldown doesn't restart it");
  assert.equal(lapWithMarkRolls("draynor", player, [0], { minute: 1003 }).marks.length, 1);
});

test("a lap's mark chance is 2/6, 2/5 at Rellekka and 2/3 at Canifis and Ardougne (Wiki: Mark of Grace)", () => {
  assert.equal(markCount("draynor", 10, [0.333]), 1);
  assert.equal(markCount("draynor", 10, [0.334]), 0);
  assert.equal(markCount("falador", null, [0.333]), 1);
  assert.equal(markCount("rellekka", null, [0.399]), 1);
  assert.equal(markCount("rellekka", null, [0.401]), 0);
  assert.equal(markCount("canifis", null, [0.666]), 1);
  assert.equal(markCount("canifis", null, [0.667]), 0);
  assert.equal(markCount("ardougne", null, [0.666]), 1);
  assert.equal(markCount("ardougne", null, [0.667]), 0);
});

test("20+ unboosted levels over a course cut its mark chance to a fifth, except at Canifis (Wiki: Mark of Grace)", () => {
  assert.equal(markCount("draynor", 21, [0.066]), 1);
  assert.equal(markCount("draynor", 21, [0.067]), 0);
  assert.equal(markCount("draynor", 20, [0.333], { boostedTo: 30 }), 1, "a boost doesn't count");
  assert.equal(markCount("seers", 80, [0.066]), 1);
  assert.equal(markCount("seers", 80, [0.067]), 0);
  assert.equal(markCount("canifis", 99, [0.666]), 1);
});

test("diaries reroll missed marks at Seers' and Ardougne and shorten cooldowns at Ardougne, Pollnivneach and Rellekka (Wiki: Mark of Grace)", () => {
  assert.equal(markCount("seers", null, [0.5, 0.04]), 0, "no reroll without the Kandarin diary");
  assert.equal(markCount("seers", null, [0.5, 0.04], { diaries: ["kandarin:easy"] }), 1);
  assert.equal(markCount("seers", null, [0.5, 0.06], { diaries: ["kandarin:easy"] }), 0);
  assert.equal(markCount("seers", null, [0.5, 0.09], { diaries: ["kandarin:easy", "kandarin:medium"] }), 1);
  assert.equal(markCount("seers", null, [0.5, 0.14], { diaries: ["kandarin:easy", "kandarin:medium", "kandarin:hard"] }), 1);
  assert.equal(markCount("seers", null, [0.5, 0.16], { diaries: ["kandarin:easy", "kandarin:medium", "kandarin:hard"] }), 0);
  assert.equal(markCount("ardougne", null, [0.9, 0.24], { diaries: ["ardougne:elite"] }), 1);
  assert.equal(markCount("ardougne", null, [0.9, 0.26], { diaries: ["ardougne:elite"] }), 0);

  const cooldown = (key, rolls, diaries) => {
    const course = COURSES.find((entry) => entry.key === key);
    const player = createPlayer(3200, 3200, 0, course.marks.level);
    assert.equal(lapWithMarkRolls(key, player, rolls, { diaries }).marks.length, 1);
    return player.getAttribute(MARK_COOLDOWN_ATTRIBUTE) - 1000;
  };
  assert.equal(cooldown("ardougne", [0, 0.49], ["ardougne:elite"]), 2);
  assert.equal(cooldown("ardougne", [0, 0.51], ["ardougne:elite"]), 3);
  assert.equal(cooldown("ardougne", [0, 0], []), 3);
  assert.equal(cooldown("pollnivneach", [0, 0.33], ["desert:hard"]), 2);
  assert.equal(cooldown("pollnivneach", [0, 0.34], ["desert:hard"]), 3);
  assert.equal(cooldown("rellekka", [0, 0.33], ["fremennik:hard"]), 2);
  assert.equal(cooldown("rellekka", [0, 0], ["fremennik:medium"]), 3);
  assert.equal(cooldown("seers", [0, 0], ["kandarin:hard"]), 3, "Kandarin rerolls only");
});

test("agility:mark-chance may set a lap's mark chance; unanswered, the course's own stands", () => {
  assert.equal(markCount("draynor", 10, [0.5]), 0);
  hooks.answers["agility:mark-chance"] = (request) => {
    assert.equal(request.course, "draynor");
    assert.ok(Math.abs(request.chance - 2 / 6) < 1e-9, "asked with the course's chance");
    request.chance = 0.6;
  };
  try {
    assert.equal(markCount("draynor", 10, [0.5]), 1);
  } finally {
    delete hooks.answers["agility:mark-chance"];
  }
});

test("a course mark picked up finishes a lap only when agility:mark-taken says so, with its items", () => {
  const player = createPlayer(3098, 3281, 3, 10);
  const added = [];
  const inventory = player.getInventory();
  player.getInventory = () => ({ ...inventory, getAddableAmount: (item) => item.getAmount(), adds: (id, amount) => added.push([id, amount]) });
  player.setAttribute("agility.progress", { course: "draynor", index: 2 });
  const mark = { getItem: () => ({ getId: () => MARK_OF_GRACE }), getgoesGlobal: () => false, getDespawnDelay: () => 1000 };
  const pickUp = (groundItem = mark, location = { x: 3098, y: 3281, z: 3 }) => hooks.pickup({ player, groundItem, groundItemId: MARK_OF_GRACE, clickType: 1, location, handled: false });
  hooks.events.length = 0;
  pickUp();
  assert.deepEqual(hooks.events.find((event) => event.name === "agility:mark-taken")?.payload.course, "draynor");
  assert.deepEqual(player.getAttribute("agility.progress"), { course: "draynor", index: 2 }, "unanswered: nothing but the pick-up");
  assert.equal(player.getAttribute("agility.laps")?.draynor, undefined);
  hooks.answers["agility:mark-taken"] = (request) => {
    request.completesLap = true;
    request.items.push([995, 10]);
  };
  try {
    hooks.events.length = 0;
    pickUp({ ...mark, getgoesGlobal: () => true });
    assert.equal(hooks.events.length, 0, "a dropped mark is not a course's");
    pickUp();
    assert.equal(player.getAttribute("agility.laps").draynor, 1);
    assert.equal(player.getAttribute("agility.progress"), null);
    assert.deepEqual(added, [[995, 10]]);
  } finally {
    delete hooks.answers["agility:mark-taken"];
  }
});

test("a player's course marks stop ageing while they're logged out; dropped marks don't (Wiki: Mark of Grace)", () => {
  const stack = (id, goesGlobal, despawnDelay) => ({
    paused: null,
    getItem: () => ({ getId: () => id }),
    getgoesGlobal: () => goesGlobal,
    getDespawnDelay: () => despawnDelay,
    setAgingPaused(paused) { this.paused = paused; },
  });
  const courseMark = stack(MARK_OF_GRACE, false, 1000);
  const droppedMark = stack(MARK_OF_GRACE, true, 300);
  const coins = stack(995, false, 1000);
  floorStacks.push(courseMark, droppedMark, coins);
  const player = createPlayer(3200, 3200, 0);
  try {
    hooks.logout.forEach((handler) => handler({ player }));
    assert.deepEqual([courseMark.paused, droppedMark.paused, coins.paused], [true, null, null]);
    hooks.login.forEach((handler) => handler({ player }));
    assert.equal(courseMark.paused, false);
  } finally {
    floorStacks.length = 0;
  }
});

test("a floor stack with ageing paused neither ages nor despawns", () => {
  const { ItemOnGround, State } = require("../dist/game/entity/impl/grounditem/ItemOnGround");
  const { Item } = require("../dist/game/model/Item");
  const stack = new ItemOnGround(State.SEEN_BY_PLAYER, "agility tester", new Location(3200, 3200, 0), new Item(MARK_OF_GRACE, 1), false, -1, null);
  stack.setDespawnDelay(1000).setAgingPaused(true);
  for (let i = 0; i < 1500; i++) stack.process();
  assert.equal(stack.getTick(), 0);
  stack.setAgingPaused(false);
  for (let i = 0; i < 10; i++) stack.process();
  assert.equal(stack.getTick(), 10);
});

test("Grace's Toggle Counter hides the lap count message, and laps still count", () => {
  const draynor = COURSES.find((course) => course.key === "draynor");
  const player = createPlayer(3103, 3279, 0);
  const lapMessages = () => player.state.messages.filter((message) => message.includes("lap count is")).length;
  runLap(draynor, player);
  assert.equal(lapMessages(), 1);

  hooks.npcs.Grace["Toggle Counter"]({ player });
  assert.equal(player.state.messages.at(-1), "Your lap count will no longer be shown when you complete a lap.");
  runLap(draynor, player);
  assert.equal(lapMessages(), 1, "no message for the second lap");
  assert.equal(player.getAttribute("agility.laps").draynor, 2, "but it counted");

  hooks.npcs.Grace["Toggle Counter"]({ player });
  runLap(draynor, player);
  assert.equal(lapMessages(), 2);
});

test("Grace sells the graceful outfit the game equips (11850-11861) and amylase packs", () => {
  const shops = require("../data/definitions/shops.json");
  const grace = shops.find((shop) => shop.name === "Grace's Graceful Clothing");
  assert.equal(grace.currency, "MARK OF GRACE");
  assert.deepEqual(grace.originalStock.map((entry) => entry.id), [11850, 11854, 11856, 11858, 11860, 11852, 12641]);
  const gameplay = require("../data/definitions/item-gameplay.json");
  const items = Array.isArray(gameplay) ? gameplay : Object.values(gameplay);
  for (const id of [11850, 11854, 11856, 11858, 11860, 11852]) {
    assert.ok(items.some((item) => item.id === id && item.weight < 0), `graceful ${id} is wearable and lightens`);
  }
});

const APE_ATOLL = () => COURSES.find((course) => course.key === "ape-atoll");
const apeObstacle = (index) => APE_ATOLL().obstacles.find((obstacle) => obstacle.index === index);
const APE_TILES = { 1: [2754, 2742, 0], 2: [2753, 2741, 0], 3: [2752, 2741, 2], 4: [2746, 2741, 0], 5: [2752, 2731, 0], 6: [2757, 2734, 0] };

/** A human's slip line on each Ape Atoll obstacle (Wiki: the obstacles' pages). */
const APE_HUMAN_SLIPS = {
  1: "The rock is covered in slime and you slip into the water... ...you're not monkey enough to try this!",
  2: "You reach for the tree trunk and lose your footing... ...you're not monkey enough to try this!",
  3: "Your hands slip from the rung... ...you're not monkey enough to try this!",
  4: "The hand holds are too small to hold onto... ...you're not monkey enough to try this!",
  6: "You jump up to seize the vine... ...and lose your grip!",
};

test("Ape Atoll: as a human every obstacle slips and hurts, and the rope drops them at the stepping stone (Wiki)", () => {
  answerForm(null);
  for (const index of [1, 2, 3, 4, 6]) {
    const player = createPlayer(3200, 3200, 0, 99);
    operate(player, apeObstacle(index).object, APE_TILES[index]);
    assert.ok(player.state.messages.includes(APE_HUMAN_SLIPS[index]), `obstacle ${index}`);
    assert.equal(player.state.hits, 1, `obstacle ${index} hurts`);
    assert.equal(player.state.xp, 0);
    assert.ok(!player.getAttribute("agility.progress"), "no lap progress");
  }
  const rope = createPlayer(3200, 3200, 0, 99);
  operate(rope, apeObstacle(5).object, APE_TILES[5]);
  assert.ok(rope.state.messages.includes("You lose your grip on the vine! ...you're not monkey enough to try this!"));
  assert.deepEqual(tileOf(rope), [2755, 2742, 0]);
});

test("Ape Atoll: any monkey but a ninja or Kruk is turned away, and a boost won't reach 48 (Wiki)", () => {
  try {
    answerForm("gorilla");
    const gorilla = createPlayer(2755, 2742, 0, 99);
    operate(gorilla, apeObstacle(1).object, APE_TILES[1]);
    assert.deepEqual(gorilla.state.messages, ["Only the stealthiest and most agile monkey can use this!"]);
    assert.deepEqual(tileOf(gorilla), [2755, 2742, 0]);

    answerForm("kruk");
    const boosted = createPlayer(2755, 2742, 0, 50);
    const skills = boosted.getSkillManager();
    boosted.getSkillManager = () => ({ ...skills, getMaxLevel: () => 45 });
    operate(boosted, apeObstacle(1).object, APE_TILES[1]);
    assert.deepEqual(boosted.state.messages, ["Your Agility boost won't help you here."]);

    const kruk = createPlayer(2755, 2742, 0, 48);
    operate(kruk, apeObstacle(1).object, APE_TILES[1]);
    assert.deepEqual(tileOf(kruk), [2753, 2742, 0], "Kruk jumps the stone");
    assert.equal(kruk.state.xp, 40);
  } finally {
    answerForm(null);
  }
});

test("Ape Atoll: a monkey under 75 can fall to the signpost; from 75, or on the stone and last tree, never (Wiki)", () => {
  const random = Math.random;
  Math.random = () => 0.999;
  answerForm("medium-ninja-monkey");
  try {
    const low = createPlayer(2753, 2742, 0, 48);
    operate(low, apeObstacle(2).object, APE_TILES[2]);
    assert.deepEqual(tileOf(low), [2757, 2745, 0]);
    assert.equal(low.state.hits, 1);
    assert.equal(low.state.xp, 0);

    const ropeFall = createPlayer(2751, 2731, 0, 48);
    operate(ropeFall, apeObstacle(5).object, APE_TILES[5]);
    assert.deepEqual(tileOf(ropeFall), [2753, 2742, 0], "a monkey falls by the first tree");

    for (const [index, level] of [[2, 75], [1, 48], [6, 48]]) {
      const player = createPlayer(3200, 3200, 0, level);
      operate(player, apeObstacle(index).object, APE_TILES[index]);
      assert.equal(player.state.hits, 0, `obstacle ${index} at ${level}`);
    }
  } finally {
    Math.random = random;
    answerForm(null);
  }
});

test("Ape Atoll: the rope won't take a pet across (Wiki)", () => {
  const player = createPlayer(2751, 2731, 0, 99);
  hooks.answers["pets:current"] = (request) => { request.pet = {}; };
  answerForm("small-ninja-monkey");
  try {
    operate(player, apeObstacle(5).object, APE_TILES[5]);
    assert.deepEqual(player.state.messages, ["Your little friend can't make it over the obstacle..."]);
    assert.deepEqual(tileOf(player), [2751, 2731, 0]);
  } finally {
    delete hooks.answers["pets:current"];
    answerForm(null);
  }
});

test("Wilderness Agility dispenser (Wiki): a paid lap started without Tag resets the streak but keeps the unclaimed ticket and reward; the payment stays", () => {
  const listeners = {};
  const Dispenser = require("../plugins/skills/AgilityDispenser.plugin");
  Dispenser.register(new Proxy({
    core: PluginManager.getCoreApi(),
    onCustomEvent: (name, handler) => { listeners[name] = handler; },
  }, { get: (target, key) => (key in target ? target[key] : () => {}) }));
  const answers = ["agility:lap", "agility:obstacle-start"];
  for (const name of answers) hooks.answers[name] = listeners[name];
  const random = Math.random;
  // The Wilderness obstacles can fail even at 99; this is about the dispenser, so the laps pass.
  Math.random = () => 0;
  try {
    const course = COURSES.find((entry) => entry.key === "wilderness");
    const player = createPlayer(3004, 3937, 0);
    player.setAttribute(Dispenser.ATTRIBUTES.deposit, 1);
    const varbit = (name) => player.state.varbits.get(CacheDefinitions.getVarbitId(name));
    runLap(course, player);
    assert.equal(varbit("wildy_agility_reward_lap_new"), 1, "a paid lap: streak 1");
    assert.equal(varbit("wildy_agility_reward_available"), 1);
    player.setLocation(new Location(3004, 3937, 0));
    runLap(course, player, {
      beforeLast: () => {
        assert.equal(player.getAttribute(Dispenser.ATTRIBUTES.ticket), 1,
          "starting another lap does not lose the pending ticket (#2711)");
        assert.equal(player.getAttribute(Dispenser.ATTRIBUTES.reward), 1, "nor the pending reward");
      },
    });
    assert.equal(varbit("wildy_agility_reward_lap_new"), 1, "the untagged lap's pipe reset it, so this lap starts again at 1");
    assert.equal(player.getAttribute(Dispenser.ATTRIBUTES.deposit), 1, "the payment stays");
    assert.equal(varbit("wildy_agility_token_available"), 1, "this lap's own ticket");
  } finally {
    Math.random = random;
    for (const name of answers) delete hooks.answers[name];
  }
});

/** A real Player whose packet sender records game messages; levels set through its SkillManager. */
function realPlayer(x, y, z, agility) {
  const { Player } = require("../dist/game/entity/impl/player/Player");
  const player = new Player(null);
  const messages = [];
  const sender = new Proxy({ sendMessage: (text) => (messages.push(text), sender) }, { get: (target, key) => target[key] ?? (() => sender) });
  player.getPacketSender = () => sender;
  player.setUsername(`crevice${Math.random()}`.slice(0, 12));
  player.setRegistered(true);
  player.setLocation(new Location(x, y, z));
  player.getSkillManager().setCurrentLevel(Skill.AGILITY, agility, false).setMaxLevels(Skill.AGILITY, agility, false);
  return { player, messages };
}

test("the Waterbirth crevice goes one way, from the crab room down; from below it's slippery", () => {
  const CREVICE = 53258;
  // From the crab room (rsprox 1057, 1851, 3433): crawl, then out at the foot.
  const down = realPlayer(1852, 4406, 3, 81);
  assert.notEqual(operate(down.player, CREVICE, [1853, 4406, 3]), false);
  assert.deepEqual(tileOf(down.player), [1862, 4406, 1]);
  assert.ok(down.messages.includes("You crawl through the narrow crevice."));
  assert.equal(down.player.getMovementQueue().isMovementBlocked(), false);

  // From below (rsprox 2950): the game message and the same line in a message box; no move.
  const slip = "You try to go up the crevice, but it's slippery and you slide back down. Looks like this is one way only.";
  const up = realPlayer(1862, 4406, 1, 99);
  operate(up.player, CREVICE, [1861, 4406, 1]);
  assert.deepEqual(tileOf(up.player), [1862, 4406, 1]);
  assert.deepEqual(up.messages, [slip]);
  assert.ok(up.player.getDialogueManager().getCurrent(), "the message box is open");
  // Clicking again only repeats the refusal; a low level below gets the same slip, not a level check.
  operate(up.player, CREVICE, [1861, 4406, 1]);
  assert.deepEqual(tileOf(up.player), [1862, 4406, 1]);
  assert.deepEqual(up.messages, [slip, slip]);
  const novice = realPlayer(1862, 4406, 1, 1);
  operate(novice.player, CREVICE, [1861, 4406, 1]);
  assert.deepEqual(novice.messages, [slip]);

  // Below the level, the crab room side refuses before anything moves.
  const low = realPlayer(1852, 4406, 3, 80);
  operate(low.player, CREVICE, [1853, 4406, 3]);
  assert.deepEqual(tileOf(low.player), [1852, 4406, 3]);
  assert.deepEqual(low.messages, ["You need an Agility level of at least 81 to attempt this."]);
});

test("a refuse entry is a message or a mesbox, and nothing else", () => {
  assert.throws(() => build({ name: "x", object: 1, level: 1, refuse: { text: "no" } }, 0), /refuse needs a message or a mesbox/);
});

/**
 * Clicks like `operate` and records what each tick sent: tick 0 is the click's handler, the tick
 * after the player arrives, so a capture's tick N from arrival is tick N - 1 here.
 */
function timeline(player, objectId, objectTile) {
  const { state } = player;
  const mark = () => ({ animations: state.animations.length, sounds: state.sounds.length, xp: state.xp, messages: state.messages.length, tile: tileOf(player) });
  const since = (from) => ({
    animations: state.animations.slice(from.animations),
    sounds: state.sounds.slice(from.sounds),
    xp: Math.round((state.xp - from.xp) * 10) / 10,
    messages: state.messages.slice(from.messages),
    moved: String(tileOf(player)) !== String(from.tile),
  });
  const ticks = [];
  let from = mark();
  const object = gameObject(objectId, ...objectTile);
  const route = { player, object, objectId, clickType: 1, destination: null };
  hooks.route.forEach((handler) => handler(route));
  if (route.destination) player.setLocation(new Location(route.destination.x, route.destination.y, route.destination.z));
  from = mark();
  hooks.click.get(objectId)({ player, object, objectId, clickType: 1, location: { x: objectTile[0], y: objectTile[1], z: objectTile[2] } });
  ticks.push(since(from));
  while (player.getAttribute("agility.obstacle") != null) {
    assert.ok(ticks.length < 100, `obstacle ${objectId} never finished`);
    from = mark();
    tick();
    ticks.push(since(from));
  }
  return ticks;
}

const course = (key) => COURSES.find((entry) => entry.key === key);
const HIGHLIGHT_VARBIT = 13140;
const [START_LAP, END_LAP, ADD_XP] = [5173, 5174, 5175];

test("Varrock: the course helper is highlighted for the lap and told each obstacle's XP in tenths (rsprox 339, 3154)", () => {
  const player = createPlayer(3221, 3414, 0);
  runLap(course("varrock"), player);
  const scripts = player.state.scripts;
  assert.equal(scripts[0][0], START_LAP, "the lap starts as the rough wall ends");
  assert.deepEqual(scripts.filter(([id]) => id === ADD_XP).map(([, xp]) => xp), [135, 230, 190, 280, 100, 245, 45, 35, 1437]);
  assert.deepEqual(scripts.at(-1).slice(0, 1).concat(scripts.at(-1).slice(2)), [END_LAP, 0]);
  assert.ok(scripts.at(-1)[1] >= scripts[0][1], "the end clock is the start's or later");
  assert.deepEqual(player.state.varbitLog.filter(([id]) => id === HIGHLIGHT_VARBIT).map(([, value]) => value), [7, 0]);
  assert.equal(course("varrock").lapBonus, 0, "the Wiki's obstacle XP adds up to the lap");
  assert.equal(course("canifis").lapBonus, 0);
});

test("rooftop gaps: the jump two ticks after arriving, the landing (2588) a tick later, the XP the tick after (rsprox captures)", () => {
  const gaps = [
    ["varrock", ObjectIds.GAP_5, [3201, 3416, 3], [3197, 3416, 1]],
    ["canifis", ObjectIds.GAP_11, [3478, 3493, 3], [3478, 3486, 2]],
    ["draynor", ObjectIds.GAP_3, [3094, 3255, 3], [3096, 3256, 3]],
  ];
  for (const [key, object, from, landing] of gaps) {
    const player = createPlayer(...from);
    const ticks = timeline(player, object, [from[0], from[1] - 1, from[2]]);
    assert.deepEqual(ticks[2].animations, [Anim.LEAP], `${key}: jump`);
    assert.deepEqual(ticks[2].sounds, [2462], `${key}: sound`);
    assert.deepEqual(ticks[3].animations, [Anim.LAND], `${key}: landing`);
    assert.deepEqual(tileOf(player), landing, `${key}: landing tile`);
    assert.equal(ticks.findIndex((entry) => entry.xp > 0), 4, `${key}: XP tick`);
  }
});

test("Varrock's edge: a hop (741, sound 2461), the jump down and the landing with the lap on the next ticks (rsprox 339, 3154)", () => {
  const player = createPlayer(3236, 3415, 3);
  player.setAttribute("agility.progress", { course: "varrock", index: 8 });
  const ticks = timeline(player, ObjectIds.EDGE, [3236, 3416, 3]);
  assert.deepEqual(ticks[1].animations, [Anim.JUMP]);
  assert.deepEqual(ticks[1].sounds, [2461]);
  assert.deepEqual(ticks[2].animations, [Anim.LEAP]);
  assert.deepEqual(ticks[2].sounds, [2462]);
  assert.deepEqual(ticks[3].animations, [Anim.LAND], "the landing isn't cut off");
  assert.ok(ticks[3].messages.some((message) => message.startsWith("Your Varrock Rooftop lap count is:")));
  assert.equal(ticks[3].xp, 143.7);
  assert.deepEqual(tileOf(player), [3236, 3417, 0]);
});

test("Draynor's first tightrope: a tile a tick from the tick after arriving, creaking every four, paid on the last tile (rsprox 1723)", () => {
  const player = createPlayer(3100, 3278, 3);
  player.setAttribute("agility.progress", { course: "draynor", index: 1 });
  const ticks = timeline(player, ObjectIds.TIGHTROPE, [3098, 3277, 3]);
  assert.deepEqual(ticks.map((entry, index) => (entry.sounds.length ? index : null)).filter((index) => index != null), [2, 6]);
  assert.equal(ticks.length - 1, 10, "done ten ticks in");
  assert.equal(ticks[10].xp, 8);
  assert.ok(ticks[10].moved, "the XP comes on the last step");
  assert.deepEqual(tileOf(player), [3090, 3276, 3]);
});

test("Shayzien basic: shayzien_agility_low_progress follows the lap and resets when it's done (rsprox 1632)", () => {
  const player = createPlayer(1554, 3629, 0);
  runLap(course("shayzien-basic"), player);
  const progress = player.state.varbitLog.filter(([id]) => id === 12334).map(([, value]) => value);
  assert.deepEqual(progress.slice(0, 3), [1, 2, 3]);
  assert.equal(progress.at(-1), 0);
  assert.deepEqual(player.state.varbitLog.filter(([id]) => id === HIGHLIGHT_VARBIT).map(([, value]) => value), [21, 0]);
});

test("Agility Pyramid: the stairs set the floor and start the lap; its lines are spam, the doorway a message box (rsprox 2932, 1757)", () => {
  const pyramid = course("pyramid");
  const player = createPlayer(3354, 2830, 0);
  operate(player, ObjectIds.STAIRS_50, [3354, 2831, 0]);
  assert.equal(player.state.varbits.get(1550), 1, "agility_pyramid_level");
  assert.equal(player.state.varbits.get(HIGHLIGHT_VARBIT), 6);
  assert.equal(player.state.scripts[0][0], START_LAP);
  const wall = pyramid.obstacles.find((obstacle) => obstacle.object === ObjectIds.LOW_WALL_3);
  const ticks = timeline(player, wall.object, [3355, 2834, 1]);
  assert.deepEqual(ticks[1].messages, ["You climb the low wall..."]);
  assert.deepEqual(ticks[4].messages, ["... and make it over."]);
  assert.equal(ticks[4].xp, 8);
  assert.deepEqual(player.state.spam, ["You climb the low wall...", "... and make it over."]);
  player.setAttribute("agility.progress", { course: "pyramid", index: 6 });
  const mesboxes = player.state.mesboxes ?? 0;
  operate(player, ObjectIds.DOORWAY_15, [3365, 2830, 0]);
  assert.equal(player.state.mesboxes, mesboxes + 1, "You climb down the steep passage... is a message box");
  assert.equal(player.state.varbits.get(1550), 0);
  assert.equal(player.state.varbits.get(HIGHLIGHT_VARBIT), 0);
});

/** The area of the tile obstacles has the player stand on its tiles; plays what that triggers. */
function stepOnto(player, tile) {
  player.setLocation(new Location(...tile));
  const [area] = hooks.areas;
  area.process({ isPlayer: () => true, getAsPlayer: () => player });
  const ticks = [];
  while (player.getAttribute("agility.obstacle") != null) {
    assert.ok(ticks.length < 20, "the tile obstacle never finished");
    tick();
    ticks.push({ tile: tileOf(player), varbits: [...player.state.varbitLog] });
  }
  return ticks;
}

test("Agility Pyramid stone blocks: stepping on throws the player two tiles on for 12 XP, the tilt varbit on and off (rsprox 2932, 1757)", () => {
  const blocks = [
    [1551, [3355, 2841, 1], [3355, 2843, 1]],
    [1553, [3374, 2836, 1], [3374, 2834, 1]],
    [1552, [3368, 2849, 2], [3370, 2849, 2]],
    [1554, [3048, 4700, 2], [3048, 4698, 2]],
    [1555, [3044, 4699, 3], [3046, 4699, 3]],
  ];
  for (const [varbit, from, to] of blocks) {
    const player = createPlayer(...from);
    stepOnto(player, from);
    assert.deepEqual(tileOf(player), to, `tilt ${varbit}`);
    assert.equal(player.state.xp, 12);
    assert.deepEqual(player.state.varbitLog.filter(([id]) => id === varbit).map(([, value]) => value), [1, 0]);
    assert.ok(player.state.animations.includes(1115), "agilityarena_dive_player");
    assert.deepEqual(player.state.sounds.slice(0, 2), [1396, 2455]);
  }
});

test("Agility Pyramid stone blocks: a step on from the far side always drops the player a floor (Wiki)", () => {
  const player = createPlayer(3355, 2843, 1);
  stepOnto(player, [3355, 2842, 1]);
  assert.deepEqual(tileOf(player), [3353, 2842, 0]);
  assert.equal(player.state.hits, 1);
  assert.equal(player.state.xp, 0);
  assert.equal(player.state.varbits.get(1550), 0, "back on the ground floor");
});

test("Agility Pyramid stone blocks: standing still on one plays it once", () => {
  const player = createPlayer(3355, 2841, 1);
  stepOnto(player, [3355, 2841, 1]);
  player.setLocation(new Location(3355, 2841, 1));
  const xp = player.state.xp;
  hooks.areas[0].process({ isPlayer: () => true, getAsPlayer: () => player });
  assert.equal(player.getAttribute("agility.obstacle") ?? null, null);
  assert.equal(player.state.xp, xp);
});

test("Agility Pyramid: each staircase up lands on its captured tile from either side (rsprox 2932, 1757)", () => {
  const flights = [
    [[3354, 2831, 0], [[3354, 2830, 0], [3355, 2830, 0]], [3355, 2833, 1]],
    [[3356, 2833, 1], [[3357, 2832, 1]], [3356, 2835, 2]],
    [[3358, 2835, 2], [[3359, 2834, 2]], [3358, 2837, 3]],
    [[3360, 2837, 3], [[3361, 2836, 3]], [3041, 4695, 2]],
    [[3042, 4695, 2], [[3043, 4694, 2]], [3043, 4697, 3]],
  ];
  for (const [stairs, froms, landing] of flights) {
    for (const from of froms) {
      const player = createPlayer(...from);
      operate(player, ObjectIds.STAIRS_50, stairs);
      assert.deepEqual(tileOf(player), landing, `stairs at ${stairs} from ${from}`);
    }
  }
});

test("Agility Pyramid: jump gaps and low walls go straight over, never along (rsprox 2932, 1757)", () => {
  const crossings = [
    [ObjectIds.GAP_17, [3356, 2847, 2], [3357, 2846, 2], [3357, 2849, 2]],
    [ObjectIds.GAP_17, [3364, 2833, 2], [3366, 2834, 2], [3363, 2834, 2]],
    [ObjectIds.GAP_17, [3040, 4697, 2], [3041, 4696, 2], [3041, 4699, 2]],
    [ObjectIds.GAP_17, [3046, 4697, 3], [3046, 4699, 3], [3046, 4696, 3]],
    [ObjectIds.LOW_WALL_3, [3354, 2849, 1, 1], [3355, 2848, 1], [3355, 2850, 1]],
    [ObjectIds.LOW_WALL_3, [3370, 2833, 2, 2], [3371, 2834, 2], [3369, 2834, 2]],
  ];
  for (const [object, [x, y, z, face = 0], from, to] of crossings) {
    const player = createPlayer(...from);
    const loc = gameObject(object, x, y, z, face);
    hooks.click.get(object)({ player, object: loc, objectId: object, clickType: 1, location: { x, y, z } });
    for (let ticks = 0; player.getAttribute("agility.obstacle") != null; ticks++) {
      assert.ok(ticks < 20);
      tick();
    }
    assert.deepEqual(tileOf(player), to, `${object} at ${x},${y} from ${from}`);
  }
});

test("Agility Pyramid: the lap counts at the doorway whatever order the floors' obstacles came in", () => {
  const player = createPlayer(3354, 2830, 0);
  operate(player, ObjectIds.STAIRS_50, [3354, 2831, 0]);
  operate(player, ObjectIds.LOW_WALL_3, [3354, 2849, 1]);
  operate(player, ObjectIds.LEDGE_9, [3362, 2831, 1]);
  player.setLocation(new Location(3045, 4697, 3));
  operate(player, ObjectIds.DOORWAY_15, [3045, 4696, 3]);
  assert.ok(player.state.messages.some((message) => message.startsWith("Your Agility Pyramid lap count is")));
  assert.equal(player.state.scripts.at(-1)[0], END_LAP);
});

test("Agility Pyramid blocks slide out over two ticks, wait two, and slide back: every 15 ticks on floor 1, 13 on floor 3 (rsprox 2932, 1757)", () => {
  const { BLOCKS, offsetAt } = require("../plugins/areas/AgilityPyramid.plugin")._test;
  const [east, north] = BLOCKS;
  const cycle = (block) => Array.from({ length: block.period }, (_, tick) => offsetAt(block, tick));
  assert.deepEqual(cycle(east), [1, 2, 2, 2, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(cycle(north), [1, 2, 2, 2, 1, 0, 0, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual([east.npc, east.home, east.dir], [5788, [3372, 2847, 1], [1, 0]]);
  assert.deepEqual([north.npc, north.home, north.dir], [5787, [3366, 2845, 3], [0, 1]]);
});

test("course pipes replay the squeeze with every crawl", () => {
  const SQUEEZE_PIPE = 749; // human_doublepipesqueeze: both hands empty
  const pipes = [
    ["gnome", ObjectIds.OBSTACLE_PIPE_10, { x: 2484, y: 3430, z: 0 }],
    ["wilderness", ObjectIds.OBSTACLE_PIPE_9, { x: 3004, y: 3937, z: 0 }],
    ["werewolf", 11657, { x: 3538, y: 9904, z: 0 }],
  ];
  for (const [key, object, pos] of pipes) {
    const course = COURSES.find((entry) => entry.key === key);
    const obstacle = course.obstacles.find((entry) => entry.object === object);
    const steps = typeof obstacle.steps === "function" ? obstacle.steps({ player: null, obj: pos, pos }) : obstacle.steps;
    const moves = steps.filter((step) => step.move);
    assert.ok(moves.length >= 2, `${key}: the pipe is crawled in two halves`);
    for (const move of moves) assert.equal(move.anim, SQUEEZE_PIPE, `${key}: the crawl to ${move.move} squeezes`);
  }
  // rsprox 449-461: the Wilderness pipe skips unseen from 3940 to 3947 between its halves.
  const wildy = COURSES.find((entry) => entry.key === "wilderness").obstacles.find((entry) => entry.object === ObjectIds.OBSTACLE_PIPE_9);
  const route = wildy.steps({ player: null, obj: null, pos: { x: 3004, y: 3937, z: 0 } }).filter((step) => step.move || step.tele).map((step) => (step.move ?? step.tele)[1]);
  assert.deepEqual(route, [3940, 3947, 3950]);

  // rsprox 449 sends SEQUENCE 749 exactly twice, on the two crawl ticks; the unseen middle tick
  // has no sequence.
  const steps = wildy.steps({ player: null, obj: null, pos: { x: 3004, y: 3937, z: 0 } });
  assert.equal(steps.filter((step) => step.anim === SQUEEZE_PIPE).length, 2);
  const gap = steps.findIndex((step) => step.tele);
  assert.notEqual(gap, -1);
  assert.equal(steps[gap + 1].anim, undefined, "no third sequence on the unseen tick");

  // rsprox 449: each crawl's 30-cycle sequence delay and its exact-move start are the same cycle,
  // so the client's native hand-override gate empties the hands exactly as the crawl begins.
  for (const move of steps.filter((step) => step.anim === SQUEEZE_PIPE)) {
    assert.equal(move.delay, 30);
    assert.deepEqual(move.speed, [30, 126]);
  }
});

test("Wilderness ridge door: opening the south door and the north gates swaps the captured locs for two ticks (rsprox 449/450)", () => {
  const { RIDGE, openRidgeDoor, openRidgeGates } = require("../plugins/skills/agility/shortcuts/Wilderness.Agility")._test;
  const events = [];
  const placed = new Map();
  const key = (id, tile) => `${id}:${tile[0]},${tile[1]},${tile[2]}`;
  const place = (id, tile) => placed.set(key(id, tile), {
    getId: () => id,
    getLocation: () => new Location(tile[0], tile[1], tile[2]),
  });
  place(RIDGE.door, RIDGE.doorTile);
  place(RIDGE.gateLeft, RIDGE.gateLeftTile);
  place(RIDGE.gateRight, RIDGE.gateRightTile);
  const core = {
    Location,
    GameObject: class {
      constructor(id, location, type, face) { this.id = id; this.location = location; this.face = face; }
      getId() { return this.id; }
      getLocation() { return this.location; }
    },
    MapObjects: { get: (id, location) => placed.get(key(id, [location.getX(), location.getY(), location.getZ()])) ?? null },
    ObjectManager: {
      register: (object) => events.push(["register", object.getId()]),
      deregister: (object) => events.push(["deregister", object.getId()]),
    },
    Task: class { constructor(delay, key) { this.delay = delay; this.key = key; } stop() { this.stopped = true; } },
    TaskManager: { submit: (task) => events.push(["task", task]) },
  };
  const context = { core, player: { getPrivateArea: () => null } };

  assert.equal(openRidgeDoor(context), true);
  assert.deepEqual(events.slice(0, 3), [
    ["deregister", RIDGE.door], ["register", RIDGE.invisWall], ["register", RIDGE.prisonDoorOpen],
  ]);
  assert.equal(events[3][0], "task");
  const doorTask = events[3][1];
  assert.equal(doorTask.delay, 2);
  events.length = 0;
  doorTask.execute();
  assert.deepEqual(events, [
    ["deregister", RIDGE.invisWall], ["deregister", RIDGE.prisonDoorOpen], ["register", RIDGE.door],
  ]);

  events.length = 0;
  assert.equal(openRidgeGates(context), true);
  assert.deepEqual(events.filter(([kind]) => kind !== "task"), [
    ["deregister", RIDGE.gateLeft], ["deregister", RIDGE.gateRight],
    ["register", RIDGE.invisWall], ["register", RIDGE.invisWall],
    ["register", RIDGE.gateOpenLeft], ["register", RIDGE.gateOpenRight],
  ]);

  // A missing gate leaf leaves every closed loc in place: no partial swap.
  placed.delete(key(RIDGE.gateRight, RIDGE.gateRightTile));
  events.length = 0;
  assert.equal(openRidgeGates(context), false);
  assert.deepEqual(events, []);

  const enter = require("../plugins/skills/agility/shortcuts/Wilderness.Agility").wildernessRidgeIn();
  assert.deepEqual(enter.end, { spam: RIDGE.endIn });
  assert.deepEqual(enter.steps[0], { msg: { spam: RIDGE.start } });
  assert.deepEqual(enter.steps[2], { walk: [[2998, 3931]] });
  const leave = require("../plugins/skills/agility/shortcuts/Wilderness.Agility").wildernessRidgeOut();
  assert.deepEqual(leave.end, { spam: RIDGE.endOut });
  assert.deepEqual(leave.steps[2], { walk: [[2998, 3918]] });
  assert.deepEqual(leave.steps[4], { walk: [[2998, 3916]] });
});

test("Fossil Island sea-floor obstacles and holes each give 4.5 Agility XP (Wiki: Underwater Agility and Thieving)", () => {
  const obstacles = [
    [30962, [3758, 10260, 1], [3757, 10260, 1], 3759],
    [30962, [3726, 10245, 1], [3725, 10245, 1], 3727],
    [30962, [3824, 10264, 1], [3825, 10264, 1], 3823],
    [30964, [3754, 10244, 1], [3754, 10243, 1], null],
    [30964, [3808, 10253, 1], [3807, 10253, 1], 3809],
  ];
  for (const [object, at, from, landingX] of obstacles) {
    const player = createPlayer(...from);
    operate(player, object, at);
    assert.equal(player.state.xp, 4.5, `${object} at ${at}`);
    if (landingX != null) assert.equal(tileOf(player)[0], landingX, `${object} at ${at} crosses`);
  }
  const hole = createPlayer(3754, 10243, 1);
  operate(hole, 30966, [3754, 10241, 1]);
  assert.equal(hole.state.xp, 4.5);
  assert.deepEqual(tileOf(hole), [3779, 10241, 1]);
});
