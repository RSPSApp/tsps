// Run after `yarn build`: node --test tests/slug-menace-prince-death.test.cjs
//
// The Slug Menace, the scene after the Slug Prince dies (issue 5238; RSProx capture TheSlugMenace,
// rev 242.1, ticks 4744-4790): the copy is the 8x8 chunks from 2304,5056, and the Mother Mallum
// (4796, size 4) walks from 2358,5080 round the rock to 2349,5092 as live does instead of stopping
// at the first blocked tile of a straight line. Real Player, PlayerSession and ClientConnection, the
// real plugins, cache and map: the fifth rune goes on the door as an item_on_object packet, every
// line is continued as a packet and each tick runs as World.process does
// (tests/between-a-rock-harness.cjs). No client ran.
const assert = require("node:assert/strict");
const { before, after, test } = require("node:test");
const H = require("./between-a-rock-harness.cjs");
const QuestRuntime = require("../plugins/quests/QuestRuntime");

const DOOR = 18413; // the queen's door, 2348,5093
const DOOR_TILE = [2348, 5093];
const PRINCE_FIGHTING = 4797; // slug2_the_slug_prince
const QUEEN = 4796; // slug2_the_slug_queen
const STAGE_RUNES = 11;
const FLAGS_ATTRIBUTE = "the-slug-menace:flags";
const USED_RUNES_ATTRIBUTE = "quest.the_slug_menace.used-runes";

// Her tiles in the capture (ticks 4762-4790), from the spawn.
const LIVE_QUEEN_PATH = [
  [2358, 5080], [2357, 5081], [2356, 5082], [2355, 5083], [2354, 5083], [2353, 5083], [2352, 5083],
  [2351, 5084], [2350, 5084], [2349, 5084], [2349, 5085], [2349, 5086], [2349, 5087], [2349, 5088],
  [2349, 5089], [2349, 5090], [2349, 5091], [2349, 5092],
];

before(async () => {
  await H.boot();
  H.core.RegionManager.loadMapFiles(...DOOR_TILE);
});
after(H.shutdown);

const npcWithId = (id) => [...H.core.World.getNpcs()].find((npc) => npc && npc.getId() === id) ?? null;

/** Opens the door, plays its scene to the fight, then kills the Prince the way NPCDeathTask reports it. */
async function killThePrince(t) {
  const f = H.actor(t, { at: [2348, 5092, 0], items: [H.core.ItemIdentifiers.COMMORB_V2, H.core.ItemIdentifiers.FIRE_RUNE_6] });
  QuestRuntime.questNamed("The Slug Menace").setStage(f.player, STAGE_RUNES);
  f.player.setAttribute("the-slug-menace:stage-format", 1);
  f.player.setAttribute(FLAGS_ATTRIBUTE, 1 << 6);
  f.player.setAttribute(USED_RUNES_ATTRIBUTE, 31 & ~4);
  await H.useOnObject(f, H.core.ItemIdentifiers.FIRE_RUNE_6, DOOR, DOOR_TILE);
  let prince = null;
  for (let i = 0; i < 200 && !prince; i++) {
    if (H.shown(f)) await H.continueLine(f);
    else H.tick(f);
    prince = npcWithId(PRINCE_FIGHTING);
  }
  assert.ok(prince, "the fight starts");
  H.core.World.getNpcs().remove(prince);
  H.PM.emitNpcDeath({ npc: prince, killer: f.player });
  return f;
}

/** Plays the death scene line by line, recording each tile the Queen stands on (source tiles). */
async function playTheDeathScene(f) {
  const tiles = [];
  const ticks = [];
  for (let i = 0; i < 160; i++) {
    if (H.shown(f)) await H.continueLine(f);
    else H.tick(f);
    const queen = npcWithId(QUEEN);
    const area = queen?.getPrivateArea?.();
    if (!queen || typeof area?.toSource !== "function") continue;
    const at = area.toSource(queen.getLocation());
    const tile = [at.getX(), at.getY()];
    if (tiles.at(-1)?.join() !== tile.join()) {
      tiles.push(tile);
      ticks.push(f.tick);
    }
  }
  return { tiles, ticks };
}

test("the Mother Mallum walks the captured path round the rock to the player", async (t) => {
  const f = await killThePrince(t);
  let area = null;
  const tiles = [];
  for (let i = 0; i < 40 && !area; i++) {
    H.tick(f);
    const copy = f.player.getPrivateArea?.();
    if (copy?.toSource && copy.getName?.() === "prince-death scene") area = copy;
  }
  assert.ok(area, "the death scene opens in a copy");
  // rebuild_region at tick 4744: the 8x8 chunks from 2304,5056.
  assert.equal(area.widthChunks, 8);
  assert.equal(area.heightChunks, 8);
  const corner = area.toSource(new H.core.Location(area.getBaseX(), area.getBaseY(), 0));
  assert.deepEqual([corner.getX(), corner.getY()], [2304, 5056]);
  const walked = await playTheDeathScene(f);
  tiles.push(...walked.tiles);
  assert.deepEqual(tiles, LIVE_QUEEN_PATH);
  // She stands a tick on her spawn tile (ticks 4762-4763), and holds at 2349,5084 until her first
  // line, "Calm yourself" (4771-4775).
  assert.equal(walked.ticks[1] - walked.ticks[0], 1, "one tick on the spawn tile");
  const turn = LIVE_QUEEN_PATH.findIndex(([x, y]) => x === 2349 && y === 5084);
  const calm = f.said.find((line) => String(line.text).startsWith("Calm yourself"));
  assert.ok(calm, "her first line shows");
  // This test continues every line at once, so the line can come before she reaches the corner;
  // either way she goes north only once it has shown.
  assert.ok(walked.ticks[turn + 1] > calm.tick, "she leaves the corner only after her line");
});

test("the camera on the Mother Mallum looks at rate 1/10 while it moves at 1/1", async (t) => {
  const f = await killThePrince(t);
  await playTheDeathScene(f);
  const look = H.callsNamed(f, "sendCameraLookAt").find((call) => call.args[2] === 300);
  const move = H.callsNamed(f, "sendCameraMoveTo").find((call) => call.args[2] === 400);
  assert.ok(look && move, "the camera turns to the Queen");
  assert.deepEqual(move.args[3], { rate: 1, rate2: 1 });
  assert.deepEqual(look.args[3], { rate: 1, rate2: 10 });
});
