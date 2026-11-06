const assert = require("node:assert/strict");
const path = require("node:path");
const { before, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { GameObject } = require("../dist/game/entity/impl/object/GameObject");
const { ObjectDefinition } = require("../dist/game/definition/ObjectDefinition");

let core;
let House;
let Instance;
let Progress;
let diary;
let yanillePortalId;
let tasks;
let api;
let blockBuildingModeWithPin = false;
let pinResume;
const YANILLE_PORTAL_TILE = [2542, 3097, 0];

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  ObjectDefinition.init();
  core = PluginManager.getCoreApi();
  api = PluginManager.createApi("ArdougnePohDiaryTest");

  Progress = require("../plugins/achievements/diaries/Progress.AchievementDiaries");
  diary = require("../plugins/achievements/diaries/Data.AchievementDiaries").BY_KEY.get("ardougne");
  tasks = require("../plugins/achievements/AchievementDiaries.plugin")._test.onTask;
  api.onCustomEvent("diary:task", tasks);
  api.onCustomEvent("bank-pin:guard", (event) => {
    if (blockBuildingModeWithPin) {
      event.locked = true;
      pinResume = event.resume;
    }
  });
  Progress(api);
  require("../plugins/skills/construction/Core.Construction").init(api);
  House = require("../plugins/skills/construction/House.Construction");
  Instance = require("../plugins/skills/construction/Instance.Construction");
  House.attach(api);
  require("../plugins/modes/ironman/Common.Ironman").init(api);
  require("../plugins/modes/ironman/Setup.Ironman")(api);
  yanillePortalId = require("../plugins/skills/construction/Estate.Construction").HOUSE_LOCATIONS
    .find(({ id }) => id === 6).portal;
});

function playerFixture() {
  const player = new Player(null);
  const saved = require("../plugins/skills/construction/Instance.Construction").createDefaultHouseSave();
  saved.location = 6;
  player.setAttribute("construction:house", saved);
  const varbits = new Map();
  const sender = new Proxy({}, { get: (_target, key) => key === "sendVarbit"
    ? (id, value) => { varbits.set(id, value); return sender; }
    : key === "getVarbit" || key === "getVarp" ? () => 0 : () => sender });
  player.getPacketSender = () => sender;
  player.varbits = varbits;
  player.getSession = () => ({ sendClientPacket: () => true });
  player.setEnteredSyntaxAction = (action) => { player.enteredSyntaxAction = action; };
  return player;
}

function click(player, objectId, clickType, coordinates, source = [coordinates[0], coordinates[1] - 1, coordinates[2]]) {
  const location = new core.Location(...coordinates);
  const sourceLocation = new core.Location(...source);
  player.moveTo(sourceLocation);
  const object = new GameObject(objectId, location, 10, 2, null);
  const cached = core.CacheDefinitions.getObject(objectId);
  const definition = ObjectDefinition.forPlayer(objectId, player)
    ?? ObjectDefinition.forId(cached.transforms?.[0] ?? objectId);
  return PluginManager.emitObjectInteraction({
    player,
    object,
    definition,
    objectId,
    clickType,
    location: { x: location.getX(), y: location.getY(), z: location.getZ() },
    sourceLocation: { x: sourceLocation.getX(), y: sourceLocation.getY(), z: sourceLocation.getZ() },
    handled: false,
  });
}

function assertUncredited(player) {
  assert.equal(Progress.tierCount(player, diary, "hard"), 0);
  assert.equal(player.varbits.get(diary.tiers.hard.countVarbit) ?? 0, 0);
}

test("entering the owned house through Yanille's portal credits Ardougne Hard #10", () => {
  const player = playerFixture();
  assert.equal(yanillePortalId, 15482, "Yanille's scene portal keeps its base object id");
  const portalDefinition = core.CacheDefinitions.getObject(yanillePortalId);
  assert.ok(portalDefinition, "Yanille's base portal definition is available in the cache");
  assert.equal(portalDefinition.sizeX, 5);
  assert.equal(portalDefinition.sizeY, 2);

  click(player, yanillePortalId, 1, YANILLE_PORTAL_TILE);

  const task = "enter-your-poh-from-yanille";
  assert.equal(House.houseFor(player)?.owner, player);
  assert.ok(Progress.doneTasks(player, diary).has(task));
  assert.equal(Progress.tierCount(player, diary, "hard"), 1);
  assert.equal(player.varbits.get(diary.tiers.hard.countVarbit), 1);

  for (const source of [[2544, 3096, 0], [2541, 3097, 0], [2547, 3098, 0], [2544, 3099, 0]]) {
    const sidePlayer = playerFixture();
    click(sidePlayer, yanillePortalId, 1, YANILLE_PORTAL_TILE, source);
    assert.equal(House.houseFor(sidePlayer)?.owner, sidePlayer, `entry from ${source.join(",")}`);
    assert.equal(Progress.tierCount(sidePlayer, diary, "hard"), 1, `credit from ${source.join(",")}`);
  }
});

test("other portals, a house located elsewhere, and failed entry do not credit Ardougne Hard #10", () => {
  const task = "enter-your-poh-from-yanille";
  const player = playerFixture();
  const rimmingtonId = require("../plugins/skills/construction/Estate.Construction").HOUSE_LOCATIONS[0].portal;

  click(player, rimmingtonId, 1, [2954, 3224, 0]);
  assertUncredited(player);

  const elsewhere = playerFixture();
  elsewhere.getAttribute("construction:house").location = 1;
  click(elsewhere, yanillePortalId, 1, YANILLE_PORTAL_TILE);
  assertUncredited(elsewhere);

  const wrongYanilleTile = playerFixture();
  click(wrongYanilleTile, yanillePortalId, 1, [2543, 3097, 0]);
  assertUncredited(wrongYanilleTile);

  const farSide = playerFixture();
  click(farSide, yanillePortalId, 1, YANILLE_PORTAL_TILE, [2540, 3098, 0]);
  assertUncredited(farSide);

  const transformedPortal = playerFixture();
  const transformedId = core.CacheDefinitions.getLocId("poh_portal_op");
  click(transformedPortal, transformedId, 1, YANILLE_PORTAL_TILE);
  assertUncredited(transformedPortal);

  player.setArea(null);
  click(player, yanillePortalId, 2, YANILLE_PORTAL_TILE);
  assert.ok(Progress.doneTasks(player, diary).has(task));
  assert.equal(Progress.tierCount(player, diary, "hard"), 1);
  assert.equal(player.varbits.get(diary.tiers.hard.countVarbit), 1);

  const buildingModeEntry = playerFixture();
  click(buildingModeEntry, yanillePortalId, 3, YANILLE_PORTAL_TILE);
  assert.equal(Progress.tierCount(buildingModeEntry, diary, "hard"), 1);
  assert.equal(buildingModeEntry.varbits.get(diary.tiers.hard.countVarbit), 1);

  const blocked = playerFixture();
  const original = Instance.PlayerHouseInstance.prototype.enterHouse;
  Instance.PlayerHouseInstance.prototype.enterHouse = () => false;
  try {
    click(blocked, yanillePortalId, 1, YANILLE_PORTAL_TILE);
  } finally {
    Instance.PlayerHouseInstance.prototype.enterHouse = original;
  }
  assertUncredited(blocked);

  const teleportArrival = playerFixture();
  api.emitCustomEvent("spell:teleport-arrival", { player: teleportArrival, name: "teleport to house" });
  assertUncredited(teleportArrival);

  const pinBlocked = playerFixture();
  pinResume = null;
  blockBuildingModeWithPin = true;
  try {
    click(pinBlocked, yanillePortalId, 3, YANILLE_PORTAL_TILE);
  } finally {
    blockBuildingModeWithPin = false;
  }
  assertUncredited(pinBlocked);
  assert.equal(typeof pinResume, "function");
  pinResume();
  assert.ok(Progress.doneTasks(pinBlocked, diary).has(task));
  assert.equal(pinBlocked.varbits.get(diary.tiers.hard.countVarbit), 1);

  const stalePin = playerFixture();
  blockBuildingModeWithPin = true;
  try {
    click(stalePin, yanillePortalId, 3, YANILLE_PORTAL_TILE);
  } finally {
    blockBuildingModeWithPin = false;
  }
  const staleResume = pinResume;
  assert.equal(typeof staleResume, "function");
  assertUncredited(stalePin);
  stalePin.getAttribute("construction:house").location = 1;
  staleResume();
  assert.equal(House.houseFor(stalePin)?.owner, stalePin);
  assertUncredited(stalePin);

  const movedPin = playerFixture();
  blockBuildingModeWithPin = true;
  try {
    click(movedPin, yanillePortalId, 3, YANILLE_PORTAL_TILE);
  } finally {
    blockBuildingModeWithPin = false;
  }
  const movedResume = pinResume;
  movedPin.moveTo(new core.Location(2954, 3224, 0));
  movedResume();
  assert.equal(House.houseFor(movedPin)?.owner, movedPin);
  assertUncredited(movedPin);

  const menuOnly = playerFixture();
  menuOnly.getUsername = () => "HouseOwner";
  const getPlayerByName = core.World.getPlayerByName;
  core.World.getPlayerByName = () => menuOnly;
  try {
    click(menuOnly, yanillePortalId, 4, YANILLE_PORTAL_TILE);
    assertUncredited(menuOnly);
    menuOnly.enteredSyntaxAction.execute("HouseOwner");
  } finally {
    core.World.getPlayerByName = getPlayerByName;
  }
  assert.equal(House.houseFor(menuOnly)?.owner, menuOnly);
  assert.ok(Progress.doneTasks(menuOnly, diary).has(task));

  const owner = playerFixture();
  owner.getUsername = () => "HouseOwner";
  owner.getDisplayName = () => "HouseOwner";
  owner.getRelations = () => ({ canReceivePrivateMessageFrom: () => true });
  click(owner, yanillePortalId, 1, YANILLE_PORTAL_TILE);
  const visitor = playerFixture();
  core.World.getPlayerByName = () => owner;
  try {
    click(visitor, yanillePortalId, 4, YANILLE_PORTAL_TILE);
    visitor.enteredSyntaxAction.execute("HouseOwner");
  } finally {
    core.World.getPlayerByName = getPlayerByName;
  }
  assert.equal(House.houseFor(visitor)?.owner, owner);
  assertUncredited(visitor);
});


// The registered players and real mode query travel through the portal's name prompt.
function registeredHousePlayer(t, name, mode = "none") {
  const player = playerFixture();
  player.setUsername(name);
  player.setAttribute("bot-skip-persistence", true);
  player.getSession = () => ({ sendClientPacket: () => true, getChannel: () => null });
  t.after(() => {
    try {
      House.releaseHouse(player, true);
    } finally {
      core.World.getPlayers().remove(player);
    }
  });
  assert.equal(core.World.getPlayers().add(player), true);
  require("../plugins/modes/ironman/Common.Ironman").setMode(player, mode);
  const query = { player, mode: "none" };
  api.emitCustomEvent("ironman:mode", query);
  assert.equal(query.mode, mode);
  return player;
}

function visitByPortal(player, name) {
  click(player, yanillePortalId, 4, YANILLE_PORTAL_TILE);
  assert.ok(player.enteredSyntaxAction);
  player.enteredSyntaxAction.execute(name);
}

for (const mode of ["ironman", "ultimate", "hardcore"]) {
  test(`${mode} may enter their own house but not another player's house`, (t) => {
    const host = registeredHousePlayer(t, "host" + mode);
    const guest = registeredHousePlayer(t, "gst" + mode, mode);
    click(host, yanillePortalId, 1, YANILLE_PORTAL_TILE);
    assert.equal(House.houseFor(host)?.owner, host);
    visitByPortal(guest, guest.getUsername());
    assert.equal(House.houseFor(guest)?.owner, guest, "self name enters own house");
    House.releaseHouse(guest, true);
    assert.equal(House.houseFor(guest), null);
    visitByPortal(guest, host.getUsername());
    assert.equal(House.houseFor(guest) === null, true, "another player's house is unavailable");
    assert.equal(House.houseFor(host)?.owner, host);
  });
}

test("ordinary guest can visit an Ironman host, subject to host settings and presence", (t) => {
  const host = registeredHousePlayer(t, "ironhost", "ironman");
  const guest = registeredHousePlayer(t, "normalguest");
  click(host, yanillePortalId, 1, YANILLE_PORTAL_TILE);
  const house = House.houseFor(host);
  assert.equal(house?.owner, host);
  visitByPortal(guest, host.getUsername());
  assert.equal(House.houseFor(guest), house, "ordinary guest enters Ironman host house");
  House.releaseHouse(guest, true);
  host.getRelations().setChatModes(0, 2, 0);
  visitByPortal(guest, host.getUsername());
  assert.equal(House.houseFor(guest), null, "private chat off prevents entry");
  host.getRelations().setChatModes(0, 0, 0);
  house.save.locked = true;
  visitByPortal(guest, host.getUsername());
  assert.equal(House.houseFor(guest), null, "locked house prevents entry");
  house.save.locked = false;
  house.buildingMode = true;
  visitByPortal(guest, host.getUsername());
  assert.equal(House.houseFor(guest), null, "building mode prevents entry");
  house.buildingMode = false;
  core.World.getPlayers().remove(host);
  try {
    visitByPortal(guest, host.getUsername());
    assert.equal(House.houseFor(guest), null, "offline host prevents entry");
  } finally {
    assert.equal(core.World.getPlayers().add(host), true);
  }
});
