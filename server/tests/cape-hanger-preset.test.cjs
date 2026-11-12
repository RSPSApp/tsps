// Run after `yarn build`: node --test tests/cape-hanger-preset.test.cjs
// The POH cape hanger keeps only the cape's id: a preset fire cape (in the global presets) mounted by id came back
// plain on Take, worth 39,004 coins at high alchemy. Only plain copies are mounted now. Real engine: every plugin
// loaded, a real Player and Inventory, the hanger's own item-on-object path (the house lookup stood in).
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");

let core;
let I;
let House;
let Ids;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  I = core.ItemIdentifiers;
  House = require("../plugins/skills/construction/House.Construction");
  Ids = require("../plugins/skills/construction/Ids.Construction");
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

function setup(t) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(8940); p.setUsername("host8940"); p.setRegistered(true); p.setAttribute("bot-skip-persistence", true);
  const messages = [];
  t.mock.method(p.getPacketSender(), "sendMessage", (message) => { messages.push(message); return p.getPacketSender(); });
  t.after(() => p.setRegistered(false));
  const furniture = { buildableKey: "CAPE_HANGER" };
  const house = { owner: p, getFurnitureAt: () => furniture, redrawFurniture() {}, };
  t.mock.method(House, "houseFor", () => house);
  t.mock.method(House, "saveHouse", () => {});
  const hanger = Ids.loc("poh_mounted_capestand_blank");
  const use = (itemId) => PM.emitItemOnObject({ player: p, itemId, item: p.getInventory().getItems().find((i) => i?.getId() === itemId), slot: 0,
    objectId: hanger, object: { getId: () => hanger, getType: () => 10, getLocation: () => p.getLocation(), getDefinition: () => null }, location: { x: 0, y: 0, z: 0 }, handled: false });
  return { p, messages, furniture, use };
}

test("a preset fire cape is not mounted, and a plain one is", (t) => {
  const f = setup(t);
  const cape = new core.Item(I.FIRE_CAPE, 1);
  for (const meta of [core.Item.UNTRADEABLE_META, core.Item.UNBANKABLE_META, core.Item.PRESET_META]) cape.setMetaValue(meta, true);
  f.p.getInventory().setItem(0, cape);
  f.use(I.FIRE_CAPE);
  assert.equal(f.furniture.mountedCape, undefined, "nothing mounted");
  assert.equal(f.p.getInventory().getAmount(I.FIRE_CAPE), 1, "the preset cape stays in the pack");
  assert.ok(f.messages.includes("Preset items cannot be used for this."));
  f.p.getInventory().setItem(0, new core.Item(I.FIRE_CAPE, 1));
  f.use(I.FIRE_CAPE);
  assert.deepEqual(f.furniture.mountedCape, { cape: I.FIRE_CAPE }, "a plain cape is mounted as before");
});
