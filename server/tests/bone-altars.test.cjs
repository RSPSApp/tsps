// Run after `yarn build`: node --test tests/bone-altars.test.cjs
// Bones offered on the Chaos Temple altar: which altar, the two keep-the-bone rolls, the graphic's
// tile (docs/bone-altars.md); and Prayer's "prayer:bone" lookup it reads the bones from.
const assert = require("node:assert/strict");
const path = require("node:path");
const { test, before, afterEach } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { Location } = require("../dist/game/model/Location");
const { CacheDefinitions } = require("../dist/game/cache/CacheDefinitions");

const BoneAltars = require("../plugins/skills/BoneAltars.plugin");
const DATA = require("../plugins/skills/data/bone-altars.json");
const { altarAt, spared, zealotPieces, graphicTile } = BoneAltars._test;

const handlers = new Map();
const api = {
  core: { Location, CacheDefinitions },
  emitCustomEvent: (name, payload) => (handlers.get(name) ?? []).forEach((handler) => handler(payload)),
  onCustomEvent: (name, handler) => handlers.set(name, [...(handlers.get(name) ?? []), handler]),
  onItemFirstAction() {},
  onItemOnObject() {},
  onCanUseItem() {},
  onPlayerLogout() {},
  onPlayerDisconnect() {},
  onPlayerDeath() {},
};
const CHAOS_ALTAR = { x: 2947, y: 3820, z: 0 };
const random = Math.random;

before(async () => {
  const { CachePipeline } = require("../dist/game/cache/CachePipeline");
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  require("../plugins/skills/Prayer.plugin").register(api);
  BoneAltars.register(api);
});

afterEach(() => {
  Math.random = random;
});

const wearing = (...names) => ({
  getEquipment: () => ({ getItems: () => names.map((name) => ({ getId: () => CacheDefinitions.getObjId(name) })) }),
});

test("prayer:bone gives the bone's row, and nothing for other items", () => {
  const request = { itemId: CacheDefinitions.getObjId("dragon_bones"), bone: null };
  api.emitCustomEvent("prayer:bone", request);
  assert.equal(request.bone.xp, 72);
  const logs = { itemId: CacheDefinitions.getObjId("logs"), bone: null };
  api.emitCustomEvent("prayer:bone", logs);
  assert.equal(logs.bone, null);
});

test("only the Chaos Temple's altar takes bones", () => {
  const id = CacheDefinitions.getLocId("chaosaltar");
  assert.equal(altarAt(id, CHAOS_ALTAR).name, "Chaos altar");
  // The same altar elsewhere (the Wilderness chaos temple at 3239, 3608) does not.
  assert.equal(altarAt(id, { x: 3239, y: 3608, z: 0 }), null);
  assert.equal(altarAt(CacheDefinitions.getLocId("trappedchaosaltar"), CHAOS_ALTAR), null);
});

test("the altar spares half, then the Zealot's robes roll 1.25% a piece", () => {
  const altar = DATA.altars[0];
  const none = wearing();
  Math.random = () => 0.49;
  assert.equal(spared(none, altar), "altar");
  Math.random = () => 0.5;
  assert.equal(spared(none, altar), null);

  const full = wearing("shades_prayer_helm", "shades_prayer_top", "shades_prayer_bottom", "shades_prayer_boots");
  assert.equal(zealotPieces(full), 4);
  const rolls = [0.9, 0.049];
  Math.random = () => rolls.shift();
  assert.equal(spared(full, altar), "robes");
  const misses = [0.9, 0.05];
  Math.random = () => misses.shift();
  assert.equal(spared(full, altar), null);
  assert.equal(zealotPieces(wearing("shades_prayer_helm", "logs")), 1);
});

test("the offering graphic plays on the altar tile nearest the player", () => {
  const object = {
    getLocation: () => new Location(CHAOS_ALTAR.x, CHAOS_ALTAR.y, 0),
    getDefinition: () => ({ sizeX: 2, sizeY: 1 }),
    getFace: () => 0,
  };
  const at = (x, y) => ({ getLocation: () => new Location(x, y, 0) });
  const tile = (player) => { const t = graphicTile(player, object); return [t.getX(), t.getY()]; };
  assert.deepEqual(tile(at(2950, 3821)), [2948, 3820]);
  assert.deepEqual(tile(at(2946, 3819)), [2947, 3820]);
});
