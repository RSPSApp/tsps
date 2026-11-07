// Run after `yarn build`: node --test tests/bot-f2p-tools.test.cjs
// A bot's equipTool action wields the best tool its world allows: no members axe or pickaxe on a free world.
const assert = require("node:assert/strict");
const path = require("node:path");
const { test, before } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { createEquipToolAction } = require("../plugins/bots/brain/actions/EquipTool.PlayerBots");

let core;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  core = PluginManager.getCoreApi();
});

function bot(t) {
  const player = new Player(null);
  player.setIndex(1900);
  t.mock.method(player, "getSession", () => ({ sendClientPacket: () => true, write: () => true }));
  const skills = player.getSkillManager();
  for (const skill of [core.Skill.WOODCUTTING, core.Skill.MINING]) {
    skills.setMaxLevel(skill, 99);
    skills.setCurrentLevel(skill, 99);
  }
  return player;
}

function wielded(player, tool) {
  assert.equal(createEquipToolAction({ tool }).update({ player }), "success");
  return player.getEquipment().getItems()[core.Equipment.WEAPON_SLOT].getId();
}

test("on a free world a 99 bot wields the rune axe and rune pickaxe, not the dragon ones", (t) => {
  const ids = core.ItemIdentifiers;
  assert.equal(core.CacheDefinitions.getItem(ids.DRAGON_AXE).isMembers, true, "SETUP: the Dragon axe is members-only");
  t.mock.method(core.WorldDefinition, "isMembersWorld", () => false);
  const player = bot(t);
  assert.equal(wielded(player, "axe"), ids.RUNE_AXE);
  assert.equal(wielded(player, "pickaxe"), ids.RUNE_PICKAXE);
});

test("on a members world the same bot wields the dragon tools, never the league's Echo pickaxe", (t) => {
  t.mock.method(core.WorldDefinition, "isMembersWorld", () => true);
  const player = bot(t);
  assert.equal(wielded(player, "axe"), core.ItemIdentifiers.DRAGON_AXE);
  assert.equal(wielded(player, "pickaxe"), core.ItemIdentifiers.DRAGON_PICKAXE);
});
