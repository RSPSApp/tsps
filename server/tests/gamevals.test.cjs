// Run after `yarn build`: node --test tests/gamevals.test.cjs
const assert = require("node:assert/strict");
const path = require("node:path");
const { test, before } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { Gamevals, GamevalKind, decodeGamevalInterface, decodeGamevalTable } = require("../dist/game/cache/Gamevals");

let gamevals;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  gamevals = new Gamevals();
});

test("interface gamevals name every component, as rsprox prints them", () => {
  const chatmodal = (162 << 16) | 568; // 567 before rev 241 added a chatbox component
  assert.equal(gamevals.componentName(chatmodal), "chatbox:chatmodal");
  assert.equal(gamevals.componentId("chatbox:chatmodal"), chatmodal);
  assert.equal(gamevals.componentId("chatbox:no_such_component"), null);
  assert.equal(gamevals.componentName((164 << 16) | 1), "toplevel_pre_eoc:overlay_atmosphere");
});

test("other gamevals name ids the way the Slayer Tower capture shows them", () => {
  assert.equal(gamevals.namesOf(GamevalKind.SEQ).get(828), "human_reachforladder");
  assert.equal(gamevals.namesOf(GamevalKind.LOC).get(2108), "slayertower_door");
  assert.equal(gamevals.namesOf(GamevalKind.VARBIT).get(12393), "busy");
});

test("an interface file decodes to its name and components, ending at 0xFFFF", () => {
  const bytes = Int8Array.from([...Buffer.from("demo\0"), 0, 3, ...Buffer.from("close\0"), 0xff, 0xff]);
  const { name, components } = decodeGamevalInterface(bytes);
  assert.equal(name, "demo");
  assert.deepEqual([...components], [[3, "close"]]);
});

test("DB table gamevals name every column; rev 241 inserted sail_pattern_option into sailing_boat", () => {
  assert.equal(gamevals.allTables().get(166).name, "sailing_boat");
  assert.equal(gamevals.tableColumn(166, "sail_pattern_option"), 27);
  assert.equal(gamevals.tableColumn(166, "hotspot"), 32);
  assert.equal(gamevals.tableColumn(166, "no_such_column"), null);
  const bytes = Int8Array.from([0, ...Buffer.from("demo\0"), 1, ...Buffer.from("first\0"), 1, ...Buffer.from("second\0"), 0]);
  assert.deepEqual(decodeGamevalTable(bytes), { name: "demo", columns: ["first", "second"] });
});

test("sailing reads its DB tables at the columns the cache names", () => {
  const parts = require("../plugins/skills/sailing/boatParts");
  const facilities = require("../plugins/skills/sailing/boatFacilities");
  const column = (table, name) => gamevals.tableColumn(table, name);
  // sailing_boat (166): each part's option list, the recovery fee and the hotspots.
  assert.deepEqual(
    ["keel", "hull", "sails", "helm"].map((part) => parts.PART_COLUMNS[part].list),
    ["keel_option", "hull_option", "sail_option", "steering_option"].map((name) => column(166, name)),
  );
  assert.equal(parts.TYPE_RECOVERY_FEE, column(166, "retrieval_cost"));
  assert.equal(facilities.TYPE_HOTSPOTS, column(166, "hotspot"));
  // The sail options (179): its loc and stats row.
  assert.equal(parts.PART_COLUMNS.sails.loc[0], column(179, "loc"));
  assert.equal(parts.PART_COLUMNS.sails.stats, column(179, "facility_stats"));
});
