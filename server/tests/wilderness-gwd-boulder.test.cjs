// Run after `yarn build`: node --test tests/wilderness-gwd-boulder.test.cjs
// The Wilderness God Wars Dungeon boulder (Wiki): Move at 60 Strength, 5.5 Strength XP going into the hallway. The move
// is instant and the far tile is next to the boulder, so every queued click moved the player across again: back and
// forth in one tick for 5.5 XP each way in. One move a tick. Real Player, the plugin's own registered handler.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");

let core, move;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  core = PluginManager.getCoreApi();
  require("../plugins/areas/WildernessGodWarsBoulder.plugin").register({ core, onNpcInteraction: (handler) => { move = handler; } });
});

function strongPlayer() {
  const p = new Player(null);
  p.getSession = () => ({ sendClientPacket: () => true, write: () => true });
  p.setUsername("boulder");
  p.getSkillManager().setMaxLevels(core.Skill.STRENGTH, 99, false).setCurrentLevel(core.Skill.STRENGTH, 99, false);
  p.setLocation(new core.Location(3055, 10165, 3)); // the cavern side
  return p;
}
const boulder = { getRealId: () => 6621 };
const click = (player) => move({ player, npc: boulder, clickType: 1, handled: false });

test("several Move clicks in one tick move the player once, with one 5.5 XP", () => {
  const p = strongPlayer();
  const before = p.getSkillManager().getExperience(core.Skill.STRENGTH);
  for (let i = 0; i < 6; i++) click(p);
  assert.equal(p.getLocation().getX(), 3052, "across to the hallway, once");
  const gained = p.getSkillManager().getExperience(core.Skill.STRENGTH) - before;
  assert.ok(gained > 0 && gained < 11, `one crossing's XP, not six: ${gained}`);
});
