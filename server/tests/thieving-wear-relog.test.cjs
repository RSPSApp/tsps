// Run after `yarn build`: node --test tests/thieving-wear-relog.test.cjs
// The gloves of silence's failure count and the dodgy necklace's charges were kept only in memory, so a relog
// refilled the necklace to 10 and reset the gloves' 62-failure wear. Real engine: every plugin loaded, a real Player,
// a reload through the real PlayerSave and JSON codec.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSave } = require("../dist/game/entity/impl/player/persistence/PlayerSave");
const { PlayerSession } = require("../dist/net/PlayerSession");
const JsonPersistence = require("../plugins/persistence/JsonPlayerPersistence.plugin");

let core;
let codec;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
    PM.emitServerStartup({});
  JsonPersistence.register({
    getSkillManager: () => require("../dist/game/content/skill/SkillManager").SkillManager,
    setPlayerPersistence: (backend) => { codec = backend; }, log() {},
  });
});
after(() => PM.emitServerShutdown({}));

function thief(t, name) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(8961); p.setUsername(name); p.setRegistered(true);
  t.after(() => p.setRegistered(false));
  return p;
}

test("the gloves' wear and the necklace's charges survive a relog", (t) => {
  const p = thief(t, "thief8961");
  p.setAttribute("thieving.gloves-of-silence-failures", 61);
  p.setAttribute("thieving.dodgy-necklace-charges", 1);
  const raw = JSON.parse(JSON.stringify(PlayerSave.fromPlayer(p), codec.replacer.bind(codec)), codec.reviver.bind(codec));
  const again = thief(t, "thief8961");
  codec.hydratePlayerSave(raw).applyToPlayer(again);
  assert.equal(again.getAttribute("thieving.gloves-of-silence-failures"), 61, "one failure from wearing out");
  assert.equal(again.getAttribute("thieving.dodgy-necklace-charges"), 1, "one charge left");
});

/** Check, from the inventory (the cache's own option) or the equipment tab (`worn`). */
function check(t, p, itemId, { worn = false } = {}) {
  const messages = [];
  t.mock.method(p.getPacketSender(), "sendMessage", (message) => { messages.push(message); return p.getPacketSender(); });
  const item = new core.Item(itemId, 1);
  if (worn) {
    const slot = itemId === core.ItemIdentifiers.DODGY_NECKLACE ? core.Equipment.AMULET_SLOT : core.Equipment.HANDS_SLOT;
    p.getEquipment().setItem(slot, item);
    // Equipment-tab click 2 is the first worn option, the cache's param 451 ("Check").
    PM.emitItemAction({ player: p, itemId, slot, item, clickType: 2, interfaceId: core.Equipment.INVENTORY_INTERFACE_ID, handled: false });
  } else {
    p.getInventory().setItem(0, item);
    const clickType = (core.CacheDefinitions.getItem(itemId).inventoryActions ?? []).indexOf("Check") + 1;
    assert.ok(clickType > 0, "the cache's Check option");
    PM.emitItemAction({ player: p, itemId, slot: 0, item, clickType, handled: false });
  }
  t.mock.restoreAll();
  return messages;
}

test("Check shows the player's dodgy necklace charges, carried or worn (Wiki: every necklace shows the same)", (t) => {
  const p = thief(t, "thief8962");
  const necklace = core.ItemIdentifiers.DODGY_NECKLACE;
  assert.deepEqual(check(t, p, necklace), ["Your dodgy necklace has 10 charges left."], "a fresh count");
  p.setAttribute("thieving.dodgy-necklace-charges", 4);
  assert.deepEqual(check(t, p, necklace), ["Your dodgy necklace has 4 charges left."]);
  p.setAttribute("thieving.dodgy-necklace-charges", 1);
  assert.deepEqual(check(t, p, necklace, { worn: true }), ["Your dodgy necklace has 1 charge left."]);
});

test("Check names the gloves of silence's wear by failures left (Wiki), and one left warns", (t) => {
  const p = thief(t, "thief8963");
  const gloves = core.ItemIdentifiers.GLOVES_OF_SILENCE;
  const at = (failures) => { p.setAttribute("thieving.gloves-of-silence-failures", failures); return check(t, p, gloves)[0]; };
  assert.equal(at(0), "Your gloves are new.");
  assert.equal(at(1), "Your gloves are in good condition.");
  assert.equal(at(28), "Your gloves are in good condition.");
  assert.equal(at(29), "Your gloves are starting to look quite shabby.");
  assert.equal(at(43), "Your gloves are starting to need repair.");
  assert.equal(at(53), "Your gloves are in need of repair!");
  assert.equal(at(60), "Your gloves are in need of repair!");
  assert.equal(at(61), "Your gloves are about to fall apart!");

  // The 61st failure leaves one: the warning, and the gloves stay on.
  const Pickpocket = require("../plugins/skills/thieving/Pickpocket.Thieving")._test;
  p.getEquipment().setItem(core.Equipment.HANDS_SLOT, new core.Item(gloves, 1));
  p.setAttribute("thieving.gloves-of-silence-failures", 60);
  const said = [];
  t.mock.method(p.getPacketSender(), "sendMessage", (message) => { said.push(message); return p.getPacketSender(); });
  Pickpocket.wearOutGloves(p);
  assert.deepEqual(said, ["Your gloves of silence are going to fall apart!"]);
  assert.equal(p.getEquipment().get(core.Equipment.HANDS_SLOT)?.getId(), gloves);
  Pickpocket.wearOutGloves(p);
  assert.deepEqual(said.slice(1), ["Your gloves of silence have worn out."]);
});
