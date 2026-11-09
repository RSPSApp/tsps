// Run after `yarn build`: node --test tests/rift-guardian-blood-bases.test.cjs
//
// Wiki (Rift guardian): 804,984 for "Blood runes (Arceuus)"; 1,795,758 for every other altar, the true Blood Altar
// (Altar 83) among them. Real plugins and a real Player, through "runecrafting:altar-rune".
const assert = require("node:assert/strict");
const path = require("node:path");
const { test, before } = require("node:test");
process.env.DISABLE_PLAYER_BOTS = "1";
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { BotPlayerSession } = require("../dist/net/BotPlayerSession");

let core;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
});

const baseAt = (objectId) => {
  const player = new Player(new BotPlayerSession());
  player.getSkillManager().setMaxLevel(core.Skill.RUNECRAFTING, 99).setCurrentLevel(core.Skill.RUNECRAFTING, 99);
  const request = { player, objectId, rune: null };
  PM.emitCustomEvent("runecrafting:altar-rune", request);
  return request.rune?.petBase;
};

test("the Arceuus blood altar rolls 804,984; the true Blood Altar the general 1,795,758", () => {
  const { BLOOD_ALTAR, ALTAR_83 } = core.ObjectIdentifiers;
  assert.equal(baseAt(BLOOD_ALTAR), 804984, "Arceuus");
  assert.equal(baseAt(ALTAR_83), 1795758, "true Blood Altar");
});
