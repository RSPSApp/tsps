// Run after `yarn build`: node --test tests/skill-xp-cap.test.cjs
// Wiki (Experience): a skill's experience is capped at 200,000,000. The cap was Elvarg's 1,000,000,000, so lamps,
// tomes and training all went past it.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { Skill } = require("../dist/game/model/Skill");

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
});

function player() {
  const p = new Player(null);
  p.getSession = () => ({ sendClientPacket: () => true, write: () => true });
  p.setUsername("xpcap");
  return p;
}

test("experience stops at 200,000,000", () => {
  const p = player();
  const skills = p.getSkillManager();
  skills.addExperience(Skill.WOODCUTTING, 199_999_990, false);
  assert.equal(skills.getExperience(Skill.WOODCUTTING), 199_999_990);
  skills.addExperience(Skill.WOODCUTTING, 50_000, false);
  assert.equal(skills.getExperience(Skill.WOODCUTTING), 200_000_000);
  skills.addExperience(Skill.WOODCUTTING, 1_000_000, false);
  assert.equal(skills.getExperience(Skill.WOODCUTTING), 200_000_000, "no more once capped");
  assert.equal(skills.getMaxLevel(Skill.WOODCUTTING), 99);
});
