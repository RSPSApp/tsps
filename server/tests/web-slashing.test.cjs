// Run after `yarn build`: node --test tests/web-slashing.test.cjs
const assert = require("node:assert/strict");
const { test, before } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Location } = require("../dist/game/model/Location");
const { MapObjects } = require("../dist/game/entity/impl/object/MapObjects");
const { GameObject } = require("../dist/game/entity/impl/object/GameObject");
const Wilderness = require("../plugins/areas/Wilderness.plugin");

const WEB = 733;
const SLASHED_WEB = 734;
const WEB_TILE = [3158, 3951, 0]; // the Wilderness web captured in recording 4155

let core;

before(async () => {
  await CachePipeline.initialize();
  require("../plugins/items/ItemDefinitionLoader.plugin").register({ log() {}, onPlayerLogin() {}, registerContentEndpoint() {} });
  core = PluginManager.getCoreApi();
  MapObjects.add(new GameObject(WEB, new Location(...WEB_TILE), 10, 1, null));
});

const item = (name) => new core.Item(core.ItemIdentifiers[name], 1);
const empty = () => new core.Item(-1, 0);

/** A player holding `wielded` (or nothing) and carrying `carried`, recording what they are shown. */
function fakePlayer({ wielded = null, carried = [], feet = null } = {}) {
  const worn = Array.from({ length: 14 }, empty);
  if (wielded) worn[core.Equipment.WEAPON_SLOT] = item(wielded);
  if (feet) worn[core.Equipment.FEET_SLOT] = item(feet);
  const player = {
    messages: [],
    animations: [],
    sounds: [],
    busy: () => false,
    getEquipment: () => ({ getItems: () => worn }),
    getInventory: () => ({ getItems: () => carried.map(item) }),
    getPacketSender: () => ({ sendSoundEffect: (id) => player.sounds.push(id) }),
    sendMessage: (text) => player.messages.push(text),
    performAnimation: (animation) => player.animations.push(animation.getId()),
  };
  return player;
}

/** The plugin API a slash needs, with the tasks it queues and the objects it swaps recorded. */
function fakeApi() {
  const tasks = [];
  const swaps = [];
  return {
    tasks,
    swaps,
    core,
    getTaskManager: () => ({ submit: (task) => tasks.push(task) }),
    getObjectManager: () => ({
      register: (object) => swaps.push(`+${object.getId()}`),
      deregister: (object) => swaps.push(`-${object.getId()}`),
    }),
  };
}

function slashEvent(player) {
  const object = MapObjects.get(WEB, new Location(...WEB_TILE), null);
  assert.ok(object, "the web stands on the captured tile");
  return { player, object, objectId: WEB };
}

function withRoll(roll, run) {
  const real = Math.random;
  Math.random = () => roll;
  try { run(); } finally { Math.random = real; }
}

test("a knife chops and a weapon swings its own slash, as captured", () => {
  const { webSlashAnimation } = Wilderness._test;
  assert.equal(webSlashAnimation(item("KNIFE")), 911); // human_knife_chop, recordings 457 and 4155
  assert.equal(webSlashAnimation(item("RUNE_SCIMITAR")), 390); // human_sword_slash, recordings 358 and 1702
  assert.equal(webSlashAnimation(item("RUNE_BATTLEAXE")), 395); // human_axe_hack, recording 1440
});

test("the best cutting item wins, carried or wielded, and nothing else cuts", () => {
  const { webTool } = Wilderness._test;
  assert.equal(webTool(fakePlayer({ wielded: "RUNE_SCIMITAR", carried: ["KNIFE"] }))?.chance, 0.5);
  assert.equal(webTool(fakePlayer({ carried: ["KNIFE"] }))?.item.getId(), core.ItemIdentifiers.KNIFE);
  assert.equal(webTool(fakePlayer({ wielded: "WILDERNESS_SWORD_1" }))?.chance, 1);
  assert.equal(webTool(fakePlayer({ carried: ["AMULET_OF_GLORY"] })), null);
});

test("a slash tells the player, swings, and turns the web two ticks later", () => {
  const { slashWeb, websBeingSlashed } = Wilderness._test;
  const api = fakeApi();
  const player = fakePlayer({ carried: ["KNIFE"] });
  withRoll(0.1, () => slashWeb(api, slashEvent(player)));
  assert.deepEqual(player.messages, ["You slash the web apart."]);
  assert.deepEqual(player.animations, [911]);
  assert.deepEqual(player.sounds, [2500]);
  assert.deepEqual(api.swaps, [], "the web is still there on the slash tick");
  assert.equal(api.tasks.length, 1);
  assert.equal(api.tasks[0].getDelay(), 2);
  // Clicking again while it is being cut does nothing.
  withRoll(0.1, () => slashWeb(api, slashEvent(player)));
  assert.equal(api.tasks.length, 1);
  assert.equal(player.messages.length, 1);
  api.tasks[0].execute();
  assert.deepEqual(api.swaps, [`-${WEB}`, `+${SLASHED_WEB}`]);
  assert.equal(websBeingSlashed.size, 0);
});

test("a slashed web grows back 99 ticks after it was cut, as recording 4155 shows", () => {
  const { slashWeb } = Wilderness._test;
  const api = fakeApi();
  withRoll(0.1, () => slashWeb(api, slashEvent(fakePlayer({ carried: ["KNIFE"] }))));
  api.tasks[0].execute();
  assert.equal(api.tasks.length, 2);
  assert.equal(api.tasks[1].getDelay(), 99);
  api.swaps.length = 0;
  api.tasks[1].execute();
  assert.deepEqual(api.swaps.slice(-1), [`+${WEB}`]);
});

// Wiki (Web): aranea boots "pass through webs without needing any other tools". Recorded at the Forthos web
// (rsprox 236/03927.txt:5035-5038, 236/03932.txt:4939): a wade, human_aranea_boots_wade (11511) with a one-tile
// exactmove, the web left standing and no message.
test("aranea boots wade through a web on Slash, blade or not, and leave it standing", () => {
  const { slashWeb } = Wilderness._test;
  const { ForceMovementTask } = core;
  const wade = (player, object) => {
    const api = fakeApi();
    slashWeb(api, { player, object, objectId: WEB });
    return api;
  };
  const mover = (player, at) => {
    let tile = new Location(...at);
    Object.assign(player, {
      forced: null,
      getLocation: () => tile,
      moveTo: (to) => { tile = to; },
      getCombat: () => ({ reset() {} }),
      getMovementQueue: () => ({ reset() {} }),
      setForceMovement: (movement) => { player.forced = movement; },
      getForceMovement: () => player.forced,
    });
    return player;
  };
  const centre = MapObjects.get(WEB, new Location(...WEB_TILE), null);
  for (const carried of [[], ["KNIFE"]]) {
    const player = mover(fakePlayer({ feet: "ARANEA_BOOTS", carried }), [3158, 3950, 0]);
    const api = wade(player, centre);
    assert.deepEqual(player.messages, [], "no slash message");
    assert.deepEqual(api.swaps, [], "the web stays");
    assert.equal(api.tasks.length, 1);
    const task = api.tasks[0];
    assert.ok(task instanceof ForceMovementTask);
    assert.equal(player.forced.getAnimation(), 11511);
    assert.equal(player.forced.getReverseSpeed(), 30);
    assert.equal(player.forced.getDirection(), 0, "north (angle 1024, as recorded)");
    task.execute();
    assert.deepEqual([player.getLocation().getX(), player.getLocation().getY()], [3158, 3951], "onto the web's tile");
  }
  // A wall web, as at the Forthos web: from its tile across the edge, and back onto it.
  const wall = new GameObject(WEB, new Location(3000, 3000, 0), 0, 1, null);
  MapObjects.add(wall);
  const player = mover(fakePlayer({ feet: "ARANEA_BOOTS" }), [3000, 3000, 0]);
  wade(player, wall).tasks[0].execute();
  assert.deepEqual([player.getLocation().getX(), player.getLocation().getY()], [3000, 3001]);
  const back = wade(player, wall);
  assert.equal(player.forced.getDirection(), 2, "south (angle 0, as recorded)");
  back.tasks[0].execute();
  assert.deepEqual([player.getLocation().getX(), player.getLocation().getY()], [3000, 3000]);
  // Using a blade on the web still slashes it, boots or not; with neither, the refusal.
  const knife = fakePlayer({ feet: "ARANEA_BOOTS", carried: ["KNIFE"] });
  const api = fakeApi();
  withRoll(0.1, () => slashWeb(api, { ...slashEvent(knife), objectId: WEB }, item("KNIFE")));
  assert.deepEqual(knife.messages, ["You slash the web apart."]);
  for (const task of api.tasks.splice(0)) task.execute();
  const without = fakePlayer();
  withRoll(0.1, () => slashWeb(fakeApi(), slashEvent(without)));
  assert.deepEqual(without.messages, ["Only a sharp blade can cut through this sticky web."]);
});

test("a failed cut says so, swings, and leaves the web alone", () => {
  const { slashWeb } = Wilderness._test;
  const api = fakeApi();
  const player = fakePlayer({ carried: ["KNIFE"] });
  withRoll(0.9, () => slashWeb(api, slashEvent(player)));
  assert.deepEqual(player.messages, ["You fail to cut through it."]);
  assert.deepEqual(player.animations, [911]);
  assert.deepEqual(player.sounds, [2500]);
  assert.equal(api.tasks.length, 0);
});

test("without a blade the web only says so", () => {
  const { slashWeb } = Wilderness._test;
  const api = fakeApi();
  const player = fakePlayer();
  slashWeb(api, slashEvent(player));
  assert.deepEqual(player.messages, ["Only a sharp blade can cut through this sticky web."]);
  assert.deepEqual(player.animations, []);
  assert.deepEqual(player.sounds, []);
  assert.equal(api.tasks.length, 0);
});
