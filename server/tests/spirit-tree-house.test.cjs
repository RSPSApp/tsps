// Run after `yarn build`: node --test tests/spirit-tree-house.test.cjs
// The spirit tree network's "Your house" entry (rsprox captures): it names where the house
// stands, is offered once a spirit tree is built in it, and travel there loads the house two
// ticks after the bark message, with the player beside the house's tree.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { ObjectDefinition } = require("../dist/game/definition/ObjectDefinition");

let core, House, Instance, SpiritTrees;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  ObjectDefinition.init();
  core = PluginManager.getCoreApi();
  core.RegionManager.init();
  const api = PluginManager.createApi("SpiritTreeHouseTest");
  require("../plugins/skills/construction/Core.Construction").init(api);
  House = require("../plugins/skills/construction/House.Construction");
  Instance = require("../plugins/skills/construction/Instance.Construction");
  House.attach(api);
  SpiritTrees = require("../plugins/world/SpiritTrees.plugin");
  SpiritTrees.register(api);
});

const HOUSE_SLOT = 11;

/** A Yanille house; `tree` furnishes a superior garden's teleport space with that piece. */
function traveller({ owned = true, location = 6, tree = "SPIRIT_TREE_AND_FAIRY_RING" } = {}) {
  const player = new Player(null);
  player.setUsername(`housetree${Math.random()}`);
  const saved = Instance.createDefaultHouseSave();
  saved.owned = owned;
  saved.location = location;
  saved.rooms[1][4][5] = { roomKey: "SUPERIOR_GARDEN", rotation: 0, furniture: tree ? { TELEPORT_SPACE: tree } : {} };
  player.setAttribute("construction:house", saved);
  const ticks = [[]];
  const log = (entry) => ticks[ticks.length - 1].push(entry);
  const sender = new Proxy({}, {
    get: (_target, key) => {
      if (key === "sendClientScript") return (id, ...args) => (log(`script ${id} ${JSON.stringify(args)}`), sender);
      if (key === "sendSubInterface") return (uid, id) => (log(`open ${id}`), sender);
      if (key === "closeSubInterface") return (uid) => (log(`close ${uid >>> 16}:${uid & 0xffff}`), sender);
      if (key === "sendString") return (text, uid) => (log(`text ${uid >>> 16}:${uid & 0xffff} ${text}`), sender);
      if (key === "sendJingle") return (id) => (log(`jingle ${id}`), sender);
      if (key === "getVarbit" || key === "getVarp") return () => 0;
      return () => sender;
    },
  });
  player.getPacketSender = () => sender;
  player.getSession = () => ({ sendClientPacket: () => true });
  player.isRegistered = () => true;
  player.sendMessage = (text) => log(`message ${text}`);
  const spoken = [];
  player.getDialogueManager().startDialogues = (chain) => spoken.push([...chain.getDialogues().values()].map((entry) => entry.text ?? "").join(" / "));
  player.setLocation(new core.Location(3185, 3508, 0));
  return { player, ticks, spoken, nextTick: () => ticks.push([]) };
}

const geTree = { getLocation: () => new core.Location(3184, 3509, 0), getId: () => 0 };

function menuEntry(visit) {
  SpiritTrees._test.travelOption({ player: visit.player, object: geTree });
  const menu = visit.ticks.flat().filter((line) => line.startsWith("script 217")).pop();
  return JSON.parse(menu.slice("script 217 ".length))[1].split("|")[HOUSE_SLOT];
}

function choose(visit, slot) {
  SpiritTrees._test.chooseTree({ player: visit.player, groupId: 187, childId: 3, action: slot, handled: false });
}

function runTicks(visit, count) {
  for (let i = 0; i < count; i++) {
    visit.nextTick();
    core.TaskManager.process();
  }
}

test("the house entry names where the house stands, greyed until a spirit tree is built there", () => {
  assert.equal(menuEntry(traveller()), "Your house (Yanille)");
  assert.equal(menuEntry(traveller({ tree: "SPIRIT_TREE" })), "Your house (Yanille)", "the plain spirit tree too");
  assert.equal(menuEntry(traveller({ location: 4, tree: null })), "<col=5f5f5f>Your house (Rellekka)</col>");
  assert.equal(menuEntry(traveller({ owned: false, tree: null })), "<col=5f5f5f>Your house</col>", "no house to name");
});

test("a house without a spirit tree can't be travelled to", () => {
  const visit = traveller({ tree: null });
  menuEntry(visit);
  choose(visit, HOUSE_SLOT);
  runTicks(visit, 3);
  assert.match(visit.spoken[0], /You cannot travel to that land at this time\./);
  assert.equal(House.houseFor(visit.player), null);
});

test("travel into the house: the bark and reach, then two ticks later the house loads beside its tree", () => {
  const visit = traveller();
  menuEntry(visit);
  visit.ticks.length = 0;
  visit.nextTick();
  choose(visit, HOUSE_SLOT);
  assert.ok(visit.ticks[0].some((line) => line.startsWith("text 193:2 You place your hands on the dry tough bark")));
  runTicks(visit, 1);
  assert.equal(House.houseFor(visit.player), null, "still outside a tick later");
  runTicks(visit, 1);
  const house = House.houseFor(visit.player);
  assert.ok(house, "in the house two ticks after the choice");
  assert.ok(visit.ticks[2].includes("close 162:566"), "the bark message closes");
  assert.ok(visit.ticks[2].includes("open 71"), "the house's loading screen");
  assert.ok(visit.ticks[2].some((line) => line.startsWith("jingle ")), "and its jingle");
  const tree = house.furnitureEntries().find(({ furniture }) => furniture.buildableKey === "SPIRIT_TREE_AND_FAIRY_RING");
  const at = visit.player.getLocation();
  assert.deepEqual([at.getX(), at.getY(), at.getZ()], [tree.location.getX() + 2, tree.location.getY(), tree.location.getZ()], "east of the 2x2 tree");
  runTicks(visit, 2);
  assert.ok(visit.ticks[4].includes("close 161:1"), "the loading screen lifts two ticks later");
  assert.equal(visit.player.getMovementQueue().isMovementBlocked(), false, "free to move once loaded");
  assert.equal(visit.player.getAttribute("spirit-trees:last-destination"), "Your house", "Last-destination remembers it");
  House.releaseHouse(visit.player, false);
});
