// Run after `yarn build`: node --test tests/construction-second-skill-experience.test.cjs
// Wiki (Armour space: each stand 25 Smithing; Rune case space: Runecraft XP 25 for each case). Building
// them paid only the Construction experience. The piece's second skill is paid too now. Real engine: every plugin
// loaded, a real Player, the plugin's own completeFurniture.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");

let core;
let House;
let Data;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  House = require("../plugins/skills/construction/House.Construction");
  Data = require("../plugins/skills/construction/Data.Construction");
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

function gained(t, key) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(9200); p.setUsername("builder9200"); p.setRegistered(true); p.setAttribute("bot-skip-persistence", true);
  t.after(() => { core.TaskManager.cancelTasks(p); p.setRegistered(false); });
  const skills = p.getSkillManager();
  const watched = [core.Skill.CONSTRUCTION, core.Skill.SMITHING, core.Skill.RUNECRAFTING, core.Skill.COOKING];
  const before = watched.map((skill) => skills.getExperience(skill));
  const house = { setFurniture() {} };
  House.completeFurniture(p, house, {}, Data.BUILDABLE_BY_KEY.get(key), new Map());
  return Object.fromEntries(watched.map((skill, i) => [skill.getName(), skills.getExperience(skill) - before[i]]));
}

// Wiki (Armour space): Mithril 135 + 25 Smithing, Adamant 150 + 25, Rune 165 + 25.
test("each armour stand pays its Construction and 25 Smithing", (t) => {
  for (const [key, construction] of [["MITHRIL_ARMOUR", 135], ["ADAMANTITE_ARMOUR", 150], ["RUNITE_ARMOUR", 165]]) {
    assert.deepEqual(gained(t, key), { Construction: construction, Smithing: 25, Runecrafting: 0, Cooking: 0 }, key);
  }
});

test("each rune case pays 25 Runecraft on top of its Construction", (t) => {
  for (const [key, construction] of [["RUNE_CASE_1", 190], ["RUNE_CASE_2", 212], ["RUNE_CASE_3", 247]]) {
    assert.deepEqual(gained(t, key), { Construction: construction, Smithing: 0, Runecrafting: 25, Cooking: 0 }, key);
  }
});

test("a beer barrel's Cooking requirement pays no Cooking (Wiki: 0)", (t) => {
  assert.deepEqual(gained(t, "BEER_BARREL"), { Construction: 87, Smithing: 0, Runecrafting: 0, Cooking: 0 });
});
