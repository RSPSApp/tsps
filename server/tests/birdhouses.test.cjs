const assert = require("node:assert/strict");
const {test} = require("node:test");
const {Server} = require("../dist/Server");
Server.installProductionPathResolver();
require("../dist/game/cache/CachePipeline").CachePipeline.initialize();
const core = require("../dist/plugins/PluginManager").PluginManager.getCoreApi();
const {Inventory} = require("../dist/game/model/container/impl/Inventory");
const C = require("../plugins/skills/hunter/Context.Hunter");
const Birdhouses = require("../plugins/skills/hunter/Birdhouses.Hunter");
const I = core.ItemIdentifiers;

function fixture() {
  const dropped = [], messages = [], attributes = new Map(), area = null;
  let location = new core.Location(3677, 3882, 0);
  const sender = new Proxy({}, {get: () => () => {}});
  const player = {
    getAttribute: key => attributes.get(key), setAttribute: (key, value) => attributes.set(key, value),
    getPacketSender: () => sender, sendMessage: message => messages.push(message),
    getEquipment: () => ({getItems: () => []}),
    getSkillManager: () => ({getCurrentLevel: () => 99, getMaxLevel: () => 99, addExperiences() {}, stopSkillable() {}}),
    getCombat: () => ({getTarget: () => null, getAttacker: () => null}),
    isRegistered: () => true, getHitpoints: () => 99, busy: () => false, performAnimation() {},
    getLocation: () => location, moveTo: to => { location = to; }, getPrivateArea: () => area, getUsername: () => "BirdhouseTest",
  };
  const inventory = new Inventory(player);
  player.getInventory = () => inventory;
  C.H.core = {...core, ItemOnGroundManager: {registerLocation: (_, item) => dropped.push([item.getId(), item.getAmount()])}};
  C.H.api = {emitCustomEvent() {}};
  C.H.data = require("../plugins/skills/hunter/Data.Hunter").build(core);
  C.H.tick = 0; C.H.actions.clear(); C.H.players.clear();
  Birdhouses.initialize();
  const id = [...Birdhouses.bases.keys()][0];
  const at = location, object = {getId: () => id, getLocation: () => at, getPrivateArea: () => area};
  return {player, inventory, object, dropped, messages};
}

/** A ready oak house and a full bag: oak logs, hammer, chisel and 25 other items, no spare clockwork. */
function fullBagReset(f, logs = I.OAK_LOGS, walkAfter = Infinity) {
  f.player.getAttribute(Birdhouses.ATTRIBUTE) ?? f.player.setAttribute(Birdhouses.ATTRIBUTE, {});
  f.player.getAttribute(Birdhouses.ATTRIBUTE)[f.object.getId()] = {tier: 1, seeds: 10, filled: Date.now() - Birdhouses.DURATION};
  f.inventory.setItem(0, new core.Item(logs));
  f.inventory.setItem(1, new core.Item(I.HAMMER));
  f.inventory.setItem(2, new core.Item(I.CHISEL));
  f.inventory.setItem(3, new core.Item(I.FEATHER, 100));
  for (let slot = 4; slot < 28; slot++) f.inventory.setItem(slot, new core.Item(I.BRONZE_BAR));
  const random = Math.random;
  Math.random = () => 0.99; // no nests
  try {
    Birdhouses.reset({player: f.player, object: f.object});
    for (let i = 0; i < 6; i++) {
      if (i === walkAfter) f.player.moveTo(new core.Location(3680, 3882, 0));
      C.H.tick++; C.processActions();
    }
  } finally { Math.random = random; }
}

test("reset with a full bag reuses the emptied house's clockwork", () => {
  const f = fixture();
  fullBagReset(f);
  const house = f.player.getAttribute(Birdhouses.ATTRIBUTE)[f.object.getId()];
  assert.deepEqual(house && {tier: house.tier, seeds: house.seeds}, {tier: 1, seeds: 0});
  assert.equal(f.inventory.getAmount(I.OAK_LOGS), 0);
  assert.equal(f.inventory.getAmount(I.CLOCKWORK), 0);
  assert.equal(f.inventory.getAmount(I.OAK_BIRD_HOUSE), 0);
  assert.ok(!f.dropped.some(([id]) => id === I.CLOCKWORK), "the clockwork must not be dropped");
  assert.ok(!f.messages.includes("You need a clockwork to make a birdhouse."));
});

test("reset gives the clockwork back when the rebuild cannot finish", () => {
  const f = fixture();
  fullBagReset(f, I.BRONZE_BAR); // no logs: the rebuild stops and the bag is still full
  assert.equal(f.player.getAttribute(Birdhouses.ATTRIBUTE)[f.object.getId()], undefined);
  assert.ok(f.messages.includes("You need logs to make a birdhouse."));
  assert.deepEqual(f.dropped.filter(([id]) => id === I.CLOCKWORK), [[I.CLOCKWORK, 1]]);
});

test("walking off before the rebuild gives the held clockwork back", () => {
  const f = fixture();
  fullBagReset(f, I.OAK_LOGS, 1); // emptied on tick 1, then walks away before the logs are checked
  assert.equal(f.player.getAttribute(Birdhouses.ATTRIBUTE)[f.object.getId()], undefined);
  assert.equal(f.inventory.getAmount(I.OAK_LOGS), 1);
  assert.deepEqual(f.dropped.filter(([id]) => id === I.CLOCKWORK), [[I.CLOCKWORK, 1]]);
});

// rsprox_transcripts/227/00545.txt, 00549.txt, 00550.txt: a tool on logs plays birdhouse_make and synth 2605 on the
// click's tick, and the birdhouse and its Crafting XP come the next tick with no chat line. The inventory craft sent
// "You craft a birdhouse." and no sound.
test("making a birdhouse in the inventory plays the make sound and says nothing", () => {
  const f = fixture();
  const sounds = [];
  const sender = new Proxy({}, {get: (_, key) => key === "sendSound" ? (id) => { sounds.push(id); return sender; } : () => sender});
  f.player.getPacketSender = () => sender;
  f.inventory.setItem(0, new core.Item(I.LOGS));
  f.inventory.setItem(1, new core.Item(I.HAMMER));
  f.inventory.setItem(2, new core.Item(I.CHISEL));
  f.inventory.setItem(3, new core.Item(I.CLOCKWORK));
  Birdhouses.craft({player: f.player, usedItemId: I.CHISEL, usedWithItemId: I.LOGS, handled: false});
  assert.deepEqual(sounds, [2605], "the make sound on the click");
  for (let i = 0; i < 3; i++) { C.H.tick++; C.processActions(); }
  assert.equal(f.inventory.getAmount(I.BIRD_HOUSE), 1);
  assert.deepEqual(f.messages, [], "no chat line");
});
