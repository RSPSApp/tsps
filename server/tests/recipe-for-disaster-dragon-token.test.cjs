// Run after `yarn build`: node --test tests/recipe-for-disaster-dragon-token.test.cjs
// Wiki (Dragon token): "obtained by killing a Black dragon in the Evil Chicken's Lair". The token's
// row sits on the shared `black_dragon` table with only the subquest condition, and Taverley's
// dragons use the same ids as the lair's, so the table would roll it anywhere on the subquest.
// Recipe for Disaster hands the token out itself, gated on the lair, and declines the table's row.
process.env.DISABLE_PLAYER_BOTS = "1";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { before, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");

const DRAGON_TOKEN = 7478;
const BLACK_DRAGON_TABLE = "black_dragon";

let tokenRow;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  const drops = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../data/definitions/npc-drops.json"), "utf8"));
  tokenRow = (drops.tables[BLACK_DRAGON_TABLE]?.entries ?? []).find((entry) => entry.item_id === DRAGON_TOKEN);
});

/** The request NpcDrops.plugin.js emits for one row of a kill's table. */
function questItemRequest(itemId) {
  return { player: {}, npc: {}, npcId: 252, itemId, requirement: { key: "quest_recipefordisasterfreeingsiramikvarze", mode: "RequiresDuring" }, allowed: undefined };
}

test("the shared black dragon table's dragon token row is declined, so Taverley's dragons cannot drop it", () => {
  // The row is still in the generated data and carries only the quest condition — no place limit.
  assert.ok(tokenRow, "the black_dragon table still lists the dragon token");
  assert.ok(tokenRow.always);
  // The dump keeps the Wiki's prose and no typed quest note (its quest classifier only names known quest
  // pages), so NpcDrops gates the token by item id (QUEST_REQUIREMENT_BY_ITEM) to reach the handler below.
  assert.deepEqual(tokenRow.notes, [
    "The dragon token overrides normal drops, and is only dropped during the Sir Amik Varze subquest of Recipe for Disaster if the player doesn't have one already.",
  ]);
  assert.equal((tokenRow.notes ?? []).some((note) => /^Quest requirement:/.test(note)), false, "no typed requirement in the row");
  assert.equal((tokenRow.notes ?? []).some((note) => /^Only dropped/i.test(note)), false, "no place limit to read");

  const request = questItemRequest(DRAGON_TOKEN);
  PM.emitCustomEvent("npc-drops:quest-item", request);
  assert.equal(request.allowed, false, "the quest plugin is the token's only source");
});

test("other quest-gated rows are left to their own quest plugins", () => {
  const request = questItemRequest(536);
  PM.emitCustomEvent("npc-drops:quest-item", request);
  assert.equal(request.allowed, undefined, "Recipe for Disaster declines only its own token");
});

// The lair half isn't driven here: the grant runs on the global npc_death hook, and emitting that
// with a stand-in NPC makes every other plugin's death hook throw. It is the pre-existing code path
// this change leaves alone; what these tests pin is that the table no longer supplies a second,
// ungated source.
