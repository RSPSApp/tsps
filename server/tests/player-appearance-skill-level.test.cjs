// Run after `yarn build`: node --test tests/player-appearance-skill-level.test.cjs
// The appearance block's skill level: the client's right-click shows "(skill-N)" for a non-zero
// value and the combat level for 0 (RSProt PlayerAvatarExtendedInfo.setSkillLevel: "Set to 0 to
// render combat level instead"). Only a skill total world (world type bit 1 << 7, RuneLite
// WorldType.SKILL_TOTAL) shows total levels.
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { GameConstants } = require("../dist/game/GameConstants");
const { appearanceSkillLevel, SKILL_TOTAL_WORLD_FLAG } = require("../dist/net/PlayerSession");

const player = { getSkillManager: () => ({ getTotalLevel: () => 1750, getCombatLevel: () => 126 }) };

test("an ordinary world sends a skill level of 0, so players show their combat level", (t) => {
  const type = GameConstants.WORLD_TYPE;
  t.after(() => { GameConstants.WORLD_TYPE = type; });
  GameConstants.setWorldType({ flags: 0 });
  assert.equal(appearanceSkillLevel(player), 0);
  GameConstants.setWorldType({ flags: 1 << 11 }); // a Hardcore world is not a skill total world
  assert.equal(appearanceSkillLevel(player), 0);
});

test("a skill total world sends the total level", (t) => {
  const type = GameConstants.WORLD_TYPE;
  t.after(() => { GameConstants.WORLD_TYPE = type; });
  GameConstants.setWorldType({ flags: SKILL_TOTAL_WORLD_FLAG });
  assert.equal(appearanceSkillLevel(player), 1750);
});
