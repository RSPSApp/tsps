// Run after `yarn build`: node --test tests/mithril-seeds.test.cjs
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { GameObject } = require("../dist/game/entity/impl/object/GameObject");
const { MapObjects } = require("../dist/game/entity/impl/object/MapObjects");
const { ObjectManager } = require("../dist/game/entity/impl/object/ObjectManager");
const { PrivateArea } = require("../dist/game/model/areas/impl/PrivateArea");
const { Boundary } = require("../dist/game/model/Boundary");
const { Location } = require("../dist/game/model/Location");
const { RegionManager } = require("../dist/game/collision/RegionManager");
const { PluginManager } = require("../dist/plugins/PluginManager");
const MithrilSeeds = require("../plugins/items/MithrilSeeds.plugin");

let core;
let plant;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  RegionManager.init();

  core = PluginManager.createApi("MithrilSeedsTest").core;
  MithrilSeeds.register({
    core: { ...core, TaskManager: { submit() {} } },
    onItemAction(name, actions) {
      if (name === "Mithril seeds") plant = actions.Plant;
    },
    onObjectInteraction() {},
  });
});

function makePlayer(location, privateArea = null) {
  const seed = {
    id: core.ItemIdentifiers.MITHRIL_SEEDS,
    amount: 1,
    getId() { return this.id; },
    getAmount() { return this.amount; },
  };
  const messages = [];
  const inventory = {
    getItems: () => [seed],
    getFreeSlots: () => 1,
    deleteNumber(id, amount) {
      assert.equal(id, seed.id);
      seed.amount -= amount;
    },
    adds() {},
  };
  const player = {
    getInventory: () => inventory,
    getLocation: () => location,
    getLocalNpcs: () => [],
    getMovementQueue: () => ({ reset() {}, walkStepIgnoringFreeze: () => true }),
    getSkillManager: () => ({ stopSkillable() {} }),
    getPrivateArea: () => privateArea,
    setPositionToFace() {},
    sendMessage: (message) => messages.push(message),
    getDialogueManager: () => ({ reset() {}, startDialogues() {} }),
    getPacketSender: () => ({ sendInterfaceRemoval() {} }),
  };
  return { player, inventory, messages, seed };
}

function makeCountDraynorArea() {
  return new (class extends PrivateArea {
    constructor() {
      super([new Boundary(3072, 3084, 9766, 9779, 0)]);
    }
  })();
}

test("planting is refused on walkable map scenery before consuming the seed", () => {
  const tile = new Location(3208, 3236, 0);
  const mapFlower = MapObjects.get(1195, tile.clone(), null);
  assert.ok(mapFlower?.isMapOriginal(), "the cache has the shape-10 Flowers object on this tile");
  assert.equal(mapFlower.getType(), 10);

  const { player, seed, messages } = makePlayer(tile);
  assert.equal(plant({ player, item: seed, itemId: seed.id, slot: 0 }), true);
  assert.equal(seed.amount, 1, "a blocked tile does not consume its mithril seed");
  assert.deepEqual(messages, ["You cannot plant a seed right here."]);
  assert.equal(ObjectManager.objectsAt(tile).some((object) => object.getId() === core.ObjectIdentifiers.FLOWERS_12), false);
});

test("planting is refused on base-map scenery in a normal-map private encounter", () => {
  const tile = new Location(3077, 9772, 0);
  const mapCandle = MapObjects.get(11473, tile.clone(), null);
  assert.ok(mapCandle?.isMapOriginal(), "the cache has the Count Draynor entrance candle on this tile");
  assert.equal(mapCandle.getType(), 10);

  const area = makeCountDraynorArea();
  try {
    assert.ok(MapObjects.getObjectsAt(tile, area).includes(mapCandle),
      "a normal-map private encounter displays its underlying cache scenery");
    const { player, seed, messages } = makePlayer(tile, area);
    assert.equal(plant({ player, item: seed, itemId: seed.id, slot: 0 }), true);
    assert.equal(seed.amount, 1, "base-map scenery blocks planting before consuming the seed");
    assert.deepEqual(messages, ["You cannot plant a seed right here."]);
    assert.equal(ObjectManager.objectsAt(tile).some((object) => object.getId() === core.ObjectIdentifiers.FLOWERS_12), false);
  } finally {
    area.destroy();
  }
});

test("runtime scenery in another private area does not block planting at the same coordinates", () => {
  const tile = new Location(3072, 9766, 0);
  const otherArea = makeCountDraynorArea();
  const playerArea = makeCountDraynorArea();
  assert.deepEqual(MapObjects.getObjectsAt(tile, playerArea), [], "the shared cache tile is empty here");
  const blocker = new GameObject(core.ObjectIdentifiers.FLOWERS_12, tile.clone(), 10, 0, otherArea);
  ObjectManager.register(blocker, true);

  try {
    const { player, seed } = makePlayer(tile, playerArea);
    assert.equal(plant({ player, item: seed, itemId: seed.id, slot: 0 }), true);
    assert.equal(seed.amount, 0, "the seed is consumed when only another instance has scenery there");
    assert.ok(ObjectManager.objectsAt(tile).some((object) =>
      object.getPrivateArea() === playerArea && object.getId() === core.ObjectIdentifiers.FLOWERS_12));
    assert.ok(ObjectManager.objectsAt(tile).includes(blocker), "the other instance's flower remains registered");

    const sameAreaAttempt = makePlayer(tile, playerArea);
    assert.equal(plant({
      player: sameAreaAttempt.player,
      item: sameAreaAttempt.seed,
      itemId: sameAreaAttempt.seed.id,
      slot: 0,
    }), true);
    assert.equal(sameAreaAttempt.seed.amount, 1, "scenery in the player's own instance still blocks planting");
    assert.deepEqual(sameAreaAttempt.messages, ["You cannot plant a seed right here."]);
  } finally {
    otherArea.destroy();
    playerArea.destroy();
  }
});
