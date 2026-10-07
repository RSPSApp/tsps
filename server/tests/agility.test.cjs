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

const hooks = { route: [], click: new Map(), logout: [], teleport: [], events: [], npcs: {}, answers: {} };
const groundItems = [];
const Agility = require("../plugins/skills/Agility.plugin");
Agility.register({
  core: PluginManager.getCoreApi(),
  getTaskManager: () => taskManager,
  getItemOnGroundManager: () => ({ registerNonGlobals: (player, item, position) => groundItems.push({ item, position }) }),
  persistAttribute() {},
  onObjectRoute: (handler) => hooks.route.push(handler),
  onObjectFirstClick: (ids, handler) => ids.forEach((id) => hooks.click.set(id, handler)),
  onCanTeleport: (handler) => hooks.teleport.push(handler),
  onPlayerLogout: (handler) => hooks.logout.push(handler),
  onNpcInteraction: (name, actions) => { hooks.npcs[name] = actions; },
  emitCustomEvent: (name, payload) => {
    hooks.events.push({ name, payload });
    hooks.answers[name]?.(payload);
  },
  log() {},
});

const { COURSES } = require("../plugins/skills/agility/courses");
const { SHORTCUTS } = require("../plugins/skills/agility/shortcuts");
const { build } = require("../plugins/skills/agility/shortcuts/ShortcutData");
const SHORTCUT_DATA = require("../data/definitions/agility-shortcuts.json");

function createPlayer(x, y, z, level = 99, { skills = {}, worn = [], held = [] } = {}) {
  let location = new Location(x, y, z);
  let forceMovement = null;
  const attributes = new Map();
  const state = { xp: 0, messages: [], varbits: new Map(), animations: [], hits: 0, blocked: false, walked: 0 };
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
    setPositionToFace() {},
    forceChat() {},
    sendMessage: (message) => state.messages.push(message),
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    getSkillManager: () => ({
      getCurrentLevel: (skill) => (skill === Skill.AGILITY ? level : skills[skill.getName?.().toLowerCase?.()] ?? 99),
      getMaxLevel: () => level,
      addExperiences: (skill, amount) => { assert.equal(skill, Skill.AGILITY); state.xp += amount; },
    }),
    getPacketSender: () => ({
      sendVarbit: (id, value) => state.varbits.set(id, value),
      sendRunEnergy: () => { state.energyUpdates = (state.energyUpdates ?? 0) + 1; },
      sendSound() {},
      sendSoundEffect() {},
      sendObjectAnimation() {},
    }),
    getCombat: () => ({ getHitQueue: () => ({ addPendingDamage: () => { state.hits++; } }) }),
    getInventory: () => ({ isFull: () => false, addItem() {}, contains: (id) => held.includes(id) }),
    getEquipment: () => ({ getItems: () => worn }),
    isRegistered: () => true,
    getHitpoints: () => 99,
  };
  return player;
}

function gameObject(id, x, y, z, face = 0) {
  return { getId: () => id, getFace: () => face, getLocation: () => new Location(x, y, z) };
}

function tileOf(player) {
  const location = player.getLocation();
  return [location.getX(), location.getY(), location.getZ()];
}

/** Routes the player the way the object packet would, clicks, and plays the obstacle out. */
function operate(player, objectId, objectTile) {
  const object = gameObject(objectId, ...objectTile);
  const route = { player, object, objectId, clickType: 1, destination: null };
  hooks.route.forEach((handler) => handler(route));
  if (route.destination) {
    player.setLocation(new Location(route.destination.x, route.destination.y, route.destination.z));
  }
  const handler = hooks.click.get(objectId);
  assert.ok(handler, `no click handler for object ${objectId}`);
  const handled = handler({
    player,
    object,
    objectId,
    clickType: 1,
    location: { x: objectTile[0], y: objectTile[1], z: objectTile[2] },
    handled: false,
  });
  for (let ticks = 0; player.getAttribute("agility.obstacle") != null; ticks++) {
    assert.ok(ticks < 100, `obstacle ${objectId} never finished`);
    tick();
  }
  return handled;
}

/** One lap in index order, using each index's first obstacle; the object sits beside the player. */
function runLap(course, player) {
  const byIndex = new Map();
  for (const obstacle of course.obstacles) {
    if (obstacle.index != null && !byIndex.has(obstacle.index)) byIndex.set(obstacle.index, obstacle);
  }
  for (const index of [...byIndex.keys()].sort((a, b) => a - b)) {
    const obstacle = byIndex.get(index);
    const objectId = Array.isArray(obstacle.object) ? obstacle.object[0] : obstacle.object;
    const [x, y, z] = obstacle.at ?? tileOf(player);
    assert.notEqual(operate(player, objectId, obstacle.at ?? [x, y + 1, z]), false, `${course.key} obstacle ${index} was not handled`);
  }
}

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
});

/** A loc the cache has: named, or a nameless multiloc (Wyrmscraig's cliff top) drawn as one. */
function isCacheLoc(id) {
  const loc = Number.isInteger(id) ? CacheDefinitions.getObject(id) : null;
  return !!loc && ((loc.name && loc.name !== "null") || (loc.transforms ?? []).some((other) => other >= 0));
}

test("every obstacle and shortcut uses an object id from the cache", () => {
  for (const entry of [...COURSES.flatMap((course) => course.obstacles), ...SHORTCUTS]) {
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
    assert.deepEqual(indices, indices.map((_, i) => i + 1), course.key);
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
};

for (const course of COURSES) {
  test(`${course.name}: a full lap counts once and pays the course's lap experience`, () => {
    groundItems.length = 0;
    const player = createPlayer(3200, 3200, 0);
    runLap(course, player);

    assert.equal(player.getAttribute("agility.laps")?.[course.key], 1);
    assert.ok(
      player.state.messages.some((message) => message.startsWith(`Your ${course.name} lap count is:`)),
      "lap count message"
    );
    if (course.lapXp > 0) {
      assert.equal(Math.round(player.state.xp * 10) / 10, course.lapXp);
    }
    if (LAP_ENDS[course.key]) {
      assert.deepEqual(tileOf(player), LAP_ENDS[course.key]);
    }
    assert.equal(player.state.blocked, false, "movement unblocked after the lap");
    assert.equal(player.state.animations.at(-1), 65535, "transient obstacle animation cleared");
    if (course.name.includes("Rooftop")) {
      assert.equal(player.state.energyUpdates, course.finalIndex, "energy updated after every successful rooftop obstacle");
      assert.equal(player.state.energy, 50 + course.finalIndex);
    } else {
      assert.equal(player.state.energyUpdates, undefined, "no invented energy restore on other courses");
    }
  });
}

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
  const falls = (player) => player.state.animations.includes(4455);
  const bare = createPlayer(3033, 3390, 0, 40, { skills: { strength: 37, ranged: 19 } });
  operate(bare, ObjectIds.ROUGH_WALL_8, wall);
  assert.deepEqual(tileOf(bare), [3033, 3390, 0], "refused: no crossbow, and short of the barehanded 52");
  assert.ok(bare.state.messages.includes("You need a crossbow equipped to do that."));

  const geared = createPlayer(3033, 3390, 0, 11, { skills: { strength: 37, ranged: 19 }, worn: grappleGear() });
  operate(geared, ObjectIds.ROUGH_WALL_8, wall);
  assert.deepEqual(tileOf(geared), [3033, 3389, 1]);
  assert.ok(falls(geared), "fires the grapple");

  const weak = createPlayer(3033, 3390, 0, 11, { skills: { strength: 36, ranged: 19 }, worn: grappleGear() });
  operate(weak, ObjectIds.ROUGH_WALL_8, wall);
  assert.deepEqual(tileOf(weak), [3033, 3390, 0]);
  assert.ok(weak.state.messages.includes("You need a Strength level of at least 37 to attempt this."));

  const climber = createPlayer(3033, 3390, 0, 52);
  operate(climber, ObjectIds.ROUGH_WALL_8, wall);
  assert.deepEqual(tileOf(climber), [3033, 3389, 1], "barehanded at 52");
  assert.ok(!falls(climber), "no grapple fired");
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
  assert.deepEqual(tileOf(player), [3090, 3277, 3]);
  assert.equal(player.getAttribute("agility.obstacle"), null);
  assert.equal(player.state.xp, 8);
});

test("a move lands after exactly its ticks (Rocks, Ralos' Rise: 10)", () => {
  const player = createPlayer(1455, 3128, 0);
  hooks.click.get(ObjectIds.ROCKS_151)({ player, object: gameObject(ObjectIds.ROCKS_151, 1456, 3128, 0), objectId: ObjectIds.ROCKS_151, clickType: 1, location: { x: 1456, y: 3128, z: 0 }, handled: false });
  let ticks = 0;
  while (tileOf(player)[0] !== 1465 && ticks < 60) {
    tick();
    ticks++;
  }
  assert.equal(ticks, 10);
  for (let more = 0; player.getAttribute("agility.obstacle") != null && more < 5; more++) tick();
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
  const { faceLoc } = require("../plugins/skills/agility/steps");
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
