// Run after `yarn build`: node --test tests/construction-spice-rack.test.cjs
//
// Issue 4186: the kitchen's spice rack space (poh_kitchen_8, 37620) was missing from the kitchen's
// hotspots, so Build found no server object ("Object with ID 37620 does not exist."). The rack it
// builds (poh_kitchen_rack_1, 37621) stores the owner's red, brown, yellow and orange spice doses:
// Store/Take/Check and spices used on it, as in rsprox captures (rev 229 recordings 271 and 272)
// and the Wiki's Transcript:Spice rack. Real engine: every plugin loaded, a real Player and a real
// seeded house with a kitchen.
process.env.DISABLE_PLAYER_BOTS = "1";
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { MultiChatboxPrompt } = require("../dist/game/model/menu/MultiChatboxPrompt");
const { PlayerSave } = require("../dist/game/entity/impl/player/persistence/PlayerSave");

const SPACE = 37620, RACK = 37621;
let core, I, House, Instance, Data, Kitchen;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  core = PM.getCoreApi();
  core.ObjectDefinition.init();
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core.RegionManager.init();
  PM.emitServerStartup({});
  I = core.ItemIdentifiers;
  House = require("../plugins/skills/construction/House.Construction");
  Instance = require("../plugins/skills/construction/Instance.Construction");
  Data = require("../plugins/skills/construction/Data.Construction");
  Kitchen = require("../plugins/skills/construction/Kitchen.Construction");
});
after(() => PM.emitServerShutdown({}));

let nextIndex = 4186;
function newPlayer(t, name) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const player = new Player(new PlayerSession(channel));
  player.getSession().setPlayer?.(player);
  player.setUsername(`${name}${nextIndex++}`);
  player.setAttribute("bot-skip-persistence", true);
  assert.equal(core.World.getPlayers().add(player), true);
  const seen = { boxes: [], messages: [], prompts: [] };
  const sender = player.getPacketSender();
  const sendString = sender.sendString.bind(sender);
  sender.sendString = (text, uid) => (text === "Click here to continue" || seen.boxes.push(text), sendString(text, uid));
  const sendPrompt = sender.sendEnterAmountPrompt.bind(sender);
  sender.sendEnterAmountPrompt = (title) => (seen.prompts.push(title), sendPrompt(title));
  player.sendMessage = (message) => seen.messages.push(message);
  t.after(() => {
    try { House.releaseHouse(player, true); } finally { core.TaskManager.cancelTasks(player); core.World.getPlayers().remove(player); }
  });
  return { player, seen };
}

/** The owner in their own house, a kitchen east of the parlour, with the given kitchen furniture. */
function ownerInHouse(t, furniture, buildingMode = false) {
  const owner = newPlayer(t, "spicer");
  const save = Instance.createDefaultHouseSave();
  save.rooms[1][4][6] = { roomKey: "KITCHEN", rotation: 0, furniture };
  owner.player.setAttribute("construction:house", save);
  owner.player.moveTo(new core.Location(2954, 3224, 0));
  owner.player.setNeedsPlacement(false);
  assert.equal(House.enterHouse(owner.player, buildingMode), true);
  const house = House.houseFor(owner.player);
  assert.ok(house instanceof Instance.PlayerHouseInstance);
  return { ...owner, house };
}

function rackObject(house) {
  const object = house.furnitureObjects.find((drawn) => drawn.getId() === RACK);
  assert.ok(object, "the built spice rack is drawn");
  return object;
}

function event(player, object, extra = {}) {
  const at = object.getLocation();
  return { player, object, objectId: object.getId(), location: { x: at.getX(), y: at.getY(), z: at.getZ() }, ...extra };
}

function choose(player, label) {
  const pending = MultiChatboxPrompt.getPending(player);
  assert.ok(pending, `a menu is open to pick ${label}`);
  const slot = pending.options.indexOf(label) + 1;
  assert.ok(slot > 0, `${label} is in ${pending.options}`);
  assert.equal(MultiChatboxPrompt.handleInterfaceActionClick({ player, buttonId: MultiChatboxPrompt.OPTIONS_WIDGET_ID, groupId: 219, slot }), true);
}

const stored = (player, colour) => player.getAttribute(`construction:spice-rack-${colour}`) ?? 0;
const give = (player, id, count) => { for (let i = 0; i < count; i++) player.getInventory().add(new core.Item(id, 1), false); };
const amount = (player, id) => player.getInventory().getAmount(id);

test("the kitchen's spice rack space offers the spice rack at the cache's level and materials", () => {
  assert.equal(Data.hotspotIn("KITCHEN", SPACE)?.key, "SPICE_RACK");
  const [rack, ...others] = House.hotspotChoices("SPICE_RACK");
  assert.deepEqual(others, []);
  assert.equal(rack.key, "SPICE_RACK");
  assert.equal(rack.name, "Spice Rack");
  assert.equal(rack.level, 60);
  assert.equal(rack.experience, 374); // Wiki
  assert.deepEqual(rack.objectIds, [RACK]);
  assert.deepEqual(rack.materials.map(({ itemId, amount }) => [itemId, amount]), [
    [I.TEAK_PLANK, 3], [I.SOFT_CLAY, 6], [I.ORANGE_SPICE_4_, 1], [I.RED_SPICE_4_, 1], [I.BROWN_SPICE_4_, 1], [I.YELLOW_SPICE_4_, 1],
  ]);
  assert.equal(rack.buildAnimationId, core.CacheDefinitions.getSeqId("human_poh_build_wall")); // captures
});

test("building mode resolves the spice rack space in a real kitchen (issue 4186)", (t) => {
  const { player, house } = ownerInHouse(t, {}, true);
  const [placement] = house.hotspotPlacements("KITCHEN", "SPICE_RACK");
  assert.ok(placement, "the kitchen template has the space");
  let found = null;
  for (let x = house.allocation.baseX; x < house.allocation.baseX + 128 && !found; x++) {
    for (let y = house.allocation.baseY; y < house.allocation.baseY + 128 && !found; y++) {
      const target = house.getFurnitureTarget({ x, y, z: 1 }, SPACE);
      if (target) found = { x, y, target };
    }
  }
  assert.ok(found, "a tile in the kitchen holds the space");
  assert.equal(found.target.hotspotKey, "SPICE_RACK");
  const object = core.MapObjects.getPrivateArea(player, SPACE, new core.Location(found.x, found.y, 1));
  assert.ok(object, "the server has an object for the clicked space");
  assert.equal(object.getType(), placement.type);
});

test("Check lists the stored doses; Store with no spices is refused", (t) => {
  const { player, seen, house } = ownerInHouse(t, { SPICE_RACK: "SPICE_RACK" });
  const rack = rackObject(house);
  assert.equal(Kitchen.checkRack(event(player, rack)), true);
  assert.equal(seen.boxes.at(-1), "0 x Red Spice.<br>0 x Brown Spice.<br>0 x Yellow Spice.<br>0 x Orange Spice.");
  assert.equal(Kitchen.storeOnRack(event(player, rack)), true);
  assert.equal(seen.boxes.at(-1), "You don't have any spices to store on the spice rack.");
  assert.equal(MultiChatboxPrompt.getPending(player), null);
});

test("Store takes every shaker of the chosen colour, or of all colours", (t) => {
  const { player, seen, house } = ownerInHouse(t, { SPICE_RACK: "SPICE_RACK" });
  const rack = rackObject(house);
  give(player, I.RED_SPICE_4_, 5); give(player, I.RED_SPICE_2_, 1);
  give(player, I.YELLOW_SPICE_3_, 1); give(player, I.ORANGE_SPICE_1_, 2);
  Kitchen.storeOnRack(event(player, rack));
  assert.deepEqual(MultiChatboxPrompt.getPending(player), { title: "Which Spice would you like to store?", options: ["Red.", "Brown.", "Yellow.", "Orange.", "All."] });
  choose(player, "Red.");
  assert.equal(seen.boxes.at(-1), "Your spices have been stored.");
  assert.equal(stored(player, "red"), 22);
  assert.equal(amount(player, I.RED_SPICE_4_) + amount(player, I.RED_SPICE_2_), 0);

  Kitchen.storeOnRack(event(player, rack));
  choose(player, "Brown.");
  assert.equal(seen.boxes.at(-1), "You have no brown spice to store.");

  Kitchen.storeOnRack(event(player, rack));
  choose(player, "All.");
  assert.equal(seen.boxes.at(-1), "Your spices have been stored.");
  assert.deepEqual(["red", "brown", "yellow", "orange"].map((colour) => stored(player, colour)), [22, 0, 3, 2]);
  assert.equal(player.getInventory().getFreeSlots(), 28);
  Kitchen.checkRack(event(player, rack));
  assert.equal(seen.boxes.at(-1), "22 x Red Spice.<br>0 x Brown Spice.<br>3 x Yellow Spice.<br>2 x Orange Spice.");
});

test("Take asks how much and fills four-dose shakers, the rest in one, as free slots allow", (t) => {
  const { player, seen, house } = ownerInHouse(t, { SPICE_RACK: "SPICE_RACK" });
  const rack = rackObject(house);
  player.setAttribute("construction:spice-rack-red", 22);
  Kitchen.takeFromRack(event(player, rack));
  assert.deepEqual(MultiChatboxPrompt.getPending(player), { title: "Which Spice would you like to take?", options: ["Red.", "Brown.", "Yellow.", "Orange."] });
  choose(player, "Brown.");
  assert.equal(seen.boxes.at(-1), "You don't have any brown spice on the shelf to take.");

  Kitchen.takeFromRack(event(player, rack));
  choose(player, "Red.");
  assert.equal(seen.prompts.at(-1), "How much spice would you like to take?:");
  player.getEnteredAmountAction().execute(3);
  assert.equal(amount(player, I.RED_SPICE_3_), 1);
  assert.equal(stored(player, "red"), 19);

  // 500 asked of 19 left: four (4)s and a (3) (captures: 500 of 22 gave five (4)s and a (2)).
  Kitchen.takeFromRack(event(player, rack));
  choose(player, "Red.");
  player.getEnteredAmountAction().execute(500);
  assert.equal(amount(player, I.RED_SPICE_4_), 4);
  assert.equal(amount(player, I.RED_SPICE_3_), 2);
  assert.equal(stored(player, "red"), 0);

  // Two free slots hold at most eight doses; a full inventory takes nothing.
  player.setAttribute("construction:spice-rack-red", 40);
  while (player.getInventory().getFreeSlots() > 2) player.getInventory().add(new core.Item(I.BUCKET, 1), false);
  Kitchen.takeFromRack(event(player, rack));
  choose(player, "Red.");
  player.getEnteredAmountAction().execute(50);
  assert.equal(amount(player, I.RED_SPICE_4_), 6);
  assert.equal(stored(player, "red"), 32);
  Kitchen.takeFromRack(event(player, rack));
  choose(player, "Red.");
  const boxes = seen.boxes.length;
  player.getEnteredAmountAction().execute(1);
  assert.equal(stored(player, "red"), 32);
  assert.equal(seen.boxes.length, boxes, "no message");
});

test("a spice used on the rack stores its colour; other items are refused", (t) => {
  const { player, seen, house } = ownerInHouse(t, { SPICE_RACK: "SPICE_RACK" });
  const rack = rackObject(house);
  give(player, I.BROWN_SPICE_4_, 2); give(player, I.BROWN_SPICE_2_, 1); give(player, I.RED_SPICE_4_, 1);
  const used = event(player, rack, { itemId: I.BROWN_SPICE_4_, handled: false });
  Kitchen.useOnSpiceRack(used);
  assert.equal(used.handled, true);
  assert.equal(seen.boxes.at(-1), "Your spices have been stored.");
  assert.equal(stored(player, "brown"), 10);
  assert.equal(amount(player, I.RED_SPICE_4_), 1, "other colours stay");

  give(player, I.BUCKET, 1);
  const bucket = event(player, rack, { itemId: I.BUCKET, handled: false });
  Kitchen.useOnSpiceRack(bucket);
  assert.equal(bucket.handled, true);
  assert.equal(seen.messages.at(-1), "You can't store this in the spice rack.");
});

test("a visitor can't use the owner's rack (captures, rec 272)", (t) => {
  const { player: owner, house } = ownerInHouse(t, { SPICE_RACK: "SPICE_RACK" });
  owner.setAttribute("construction:spice-rack-red", 8);
  const rack = rackObject(house);
  const { player: visitor, seen } = newPlayer(t, "guest");
  t.mock.method(visitor, "getPrivateArea", () => house);
  give(visitor, I.RED_SPICE_4_, 1);
  for (const option of [Kitchen.storeOnRack, Kitchen.takeFromRack, Kitchen.checkRack]) {
    assert.equal(option(event(visitor, rack)), true);
    assert.equal(seen.messages.at(-1), "You can only use this in your own house.");
  }
  assert.equal(MultiChatboxPrompt.getPending(visitor), null);
  assert.deepEqual(seen.boxes, []);
  assert.equal(stored(owner, "red"), 8);
  assert.equal(amount(visitor, I.RED_SPICE_4_), 1);
});

test("the stored doses are saved with the player", () => {
  for (const colour of ["red", "brown", "yellow", "orange"]) {
    assert.ok(PlayerSave.persistentAttributeKeys.has(`construction:spice-rack-${colour}`), colour);
  }
});
