// Run after `yarn build`: node --test tests/construction-stash-chart.test.cjs
//
// The study's wall chart space offers a fourth chart, the S.T.A.S.H chart (furniture row 5790,
// poh_wallchart_4 41434): Construction 40, a bolt of cloth and a S.T.A.S.H blueprint, 16 experience,
// human_poh_build_wall. The menu sentence-cases each row's name ("Spice Rack" -> "Spice rack",
// rec 271). Built, its View opens the same STASH units chart as Watson's noticeboard
// (hh_inv, toplevel_mainmodal_open, hidey_holes 493, hidey_build), and its Remove stays build mode's.
// All from rsprox.net rec 2804 (rev 229): the menu row at tick 4949, the build at 5330-5331, View at
// 5337-5338. Real engine: every plugin loaded, a real Player, a real seeded house with a study.
process.env.DISABLE_PLAYER_BOTS = "1";
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");

const WALL_CHART_SPACE = 15423, STASH_CHART = 41434;
let core, C, House, Instance, Stash, Skill;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  core = PM.getCoreApi();
  core.ObjectDefinition.init();
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core.RegionManager.init();
  PM.emitServerStartup({});
  C = core.CacheDefinitions;
  Skill = core.Skill;
  House = require("../plugins/skills/construction/House.Construction");
  Instance = require("../plugins/skills/construction/Instance.Construction");
  Stash = require("../plugins/treasuretrails/trails/Stash.TreasureTrails");
});
after(() => PM.emitServerShutdown({}));

let nextIndex = 5790;
function ownerInHouse(t, furniture, buildingMode) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const player = new Player(new PlayerSession(channel));
  player.getSession().setPlayer?.(player);
  player.setUsername(`charter${nextIndex++}`);
  player.setAttribute("bot-skip-persistence", true);
  assert.equal(core.World.getPlayers().add(player), true);
  const sent = [];
  const sender = player.getPacketSender();
  t.mock.method(sender, "sendInventory", (inventory, capacity, items, owner) => { sent.push({ inventory, owner }); return sender; });
  t.mock.method(sender, "sendInterfaceScript", (script, args) => { sent.push({ script, args }); return sender; });
  t.mock.method(sender, "sendInterface", (id) => { sent.push({ modal: id }); return sender; });
  t.after(() => {
    try { House.releaseHouse(player, true); } finally { core.TaskManager.cancelTasks(player); core.World.getPlayers().remove(player); }
  });
  const save = Instance.createDefaultHouseSave();
  save.rooms[1][4][6] = { roomKey: "STUDY", rotation: 0, furniture };
  player.setAttribute("construction:house", save);
  player.moveTo(new core.Location(2954, 3224, 0));
  player.setNeedsPlacement(false);
  assert.equal(House.enterHouse(player, buildingMode), true);
  return { player, sent, house: House.houseFor(player) };
}

function spaceTarget(house) {
  for (let x = house.allocation.baseX; x < house.allocation.baseX + 128; x++) {
    for (let y = house.allocation.baseY; y < house.allocation.baseY + 128; y++) {
      const target = house.getFurnitureTarget({ x, y, z: 1 }, WALL_CHART_SPACE);
      if (target) return target;
    }
  }
  return null;
}

function clickChart(player, object, clickType) {
  const at = object.getLocation();
  const event = { player, object, objectId: object.getId(), clickType, location: { x: at.getX(), y: at.getY(), z: at.getZ() }, handled: false };
  return { found: Stash.noticeboard(event), event };
}

test("the wall chart space lists the S.T.A.S.H chart fourth, at the cache's level and materials", () => {
  const choices = House.hotspotChoices("WALL_CHART");
  assert.deepEqual(choices.map((entry) => entry.key), ["ALCHEMICAL_CHART", "ASTRONOMICAL_CHART", "INFERNAL_CHART", "STASH_CHART"]);
  const chart = choices[3];
  assert.equal(chart.menuRowId, 5790);
  assert.equal(chart.level, 40);
  assert.equal(chart.experience, 16);
  assert.deepEqual(chart.objectIds, [STASH_CHART]);
  assert.deepEqual(chart.materials.map(({ itemId, amount }) => [itemId, amount]), [[core.ItemIdentifiers.BOLT_OF_CLOTH, 1], [C.getObjId("poh_wallchart_watson_material"), 1]]);
  assert.equal(chart.buildAnimationId, C.getSeqId("human_poh_build_wall"));
  // Live sentence-cases the row's name ("S.T.A.S.H chart") in the menu, as for every row.
  assert.equal(House.furnitureCreationText(chart), "S.t.a.s.h chart|Bolt of cloth: 1<br>S.t.a.s.h blueprint: 1<br><br>");
});

test("build menu names are the row names sentence-cased, as live sends them", () => {
  const [rack] = House.hotspotChoices("SPICE_RACK");
  assert.equal(rack.name, "Spice Rack"); // the furniture row's own name
  assert.match(House.furnitureCreationText(rack), /^Spice rack\|/); // rec 271
  const telescope = House.hotspotChoices("TELESCOPE").find((entry) => entry.menuRowId === 5791);
  assert.match(House.furnitureCreationText(telescope), /^Oak telescope\|/); // rec 2804
});

test("building it takes the cloth and the blueprint for 16 experience, and the study shows the chart", (t) => {
  const { player, house } = ownerInHouse(t, {}, true);
  const target = spaceTarget(house);
  assert.ok(target, "the study has a wall chart space");
  const chart = House.hotspotChoices("WALL_CHART")[3];
  const inventory = player.getInventory();
  for (const id of [core.ItemIdentifiers.HAMMER, core.ItemIdentifiers.SAW]) inventory.add(new core.Item(id, 1), false);
  inventory.add(new core.Item(core.ItemIdentifiers.BOLT_OF_CLOTH, 1), false);
  assert.equal(typeof House.getBuildMaterials(player, house, target, chart), "string", "no blueprint, no build");
  inventory.add(new core.Item(C.getObjId("poh_wallchart_watson_material"), 1), false);
  player.getSkillManager().setMaxLevel(Skill.CONSTRUCTION, 40).setCurrentLevel(Skill.CONSTRUCTION, 40);
  const materials = House.getBuildMaterials(player, house, target, chart);
  assert.ok(materials instanceof Map, String(materials));
  const before = player.getSkillManager().getExperience(Skill.CONSTRUCTION);
  House.completeFurniture(player, house, target, chart, materials);
  assert.equal(player.getSkillManager().getExperience(Skill.CONSTRUCTION) - before, 16);
  assert.equal(inventory.getAmount(core.ItemIdentifiers.BOLT_OF_CLOTH), 0);
  assert.equal(inventory.getAmount(C.getObjId("poh_wallchart_watson_material")), 0);
  assert.equal(house.getFurnitureAtTarget(target)?.buildableKey, "STASH_CHART");
});

test("View on the built chart opens the STASH chart; Remove is left to build mode", (t) => {
  const { player, sent, house } = ownerInHouse(t, { WALL_CHART: "STASH_CHART" }, false);
  const charts = house.furnitureObjects.filter((drawn) => drawn.getId() === STASH_CHART);
  assert.ok(charts.length > 0, "the built chart is drawn");
  const view = clickChart(player, charts[0], 1);
  assert.equal(view.found, true);
  assert.equal(view.event.handled, true);
  assert.deepEqual(sent.map((entry) => entry.inventory ?? entry.script ?? entry.modal), [C.getInventoryId("hh_inv"), 2524, C.getInterfaceId("hidey_holes"), 1475]);
  sent.length = 0;
  const remove = clickChart(player, charts[0], 5);
  assert.equal(remove.found, false);
  assert.equal(remove.event.handled, false);
  assert.deepEqual(sent, []);
});
