// The Fremennik log balance's river fall as the client is sent it (real PlayerSession):
// the exactmove onto 2724,3594, then a tile a tick down the river to 2725,3597 (local 1001653,
// ticks 3113-3116: a walk each tick), with no teleport as the crossing ends.
const assert = require("node:assert/strict");
const { before, after, test } = require("node:test");
const h = require("./quest-capture-harness.cjs");

before(async () => {
  await h.setup([[2722, 3592]]);
});
after(() => h.teardown());

test("the fall's exactmove is cleared before the river walk, so the synced tile follows the river a tile a tick", async (t) => {
  const f = h.actor(t, { at: [2722, 3592, 0] });
  const agility = h.core.Skill.AGILITY;
  f.player.getSkillManager().setLevel(agility, 48);
  const views = [];
  const session = f.player.getSession();
  const createView = session.createPlayerView;
  session.createPlayerView = function (target, ...rest) {
    const view = createView.call(this, target, ...rest);
    if (target === f.player) views.push([f.tick, view]);
    return view;
  };
  const random = Math.random;
  Math.random = () => 0.999;
  try {
    await h.clickObject(f, 16542, [2722, 3593]);
    h.ticks(f, 12);
  } finally {
    Math.random = random;
  }
  const at = f.player.getLocation();
  assert.deepEqual([at.getX(), at.getY()], [2725, 3597], "washed to the north bank");
  // The tile the client is told the player stands on each tick (the exactmove's end while one is held).
  const synced = views.map(([tick, view]) => {
    const tile = view.forcedMovementEnd && !view.forcedMovement ? view.forcedMovementEnd : view;
    return [tick, tile.x, tile.y, Boolean(view.forcedMovement)];
  });
  const fall = synced.findIndex(([, , , exact]) => exact);
  assert.ok(fall >= 0, "an exactmove was sent");
  assert.deepEqual(synced[fall].slice(1, 3), [2724, 3594]);
  const tiles = [];
  for (const [, x, y] of synced.slice(fall)) {
    const last = tiles[tiles.length - 1];
    if (!last || last[0] !== x || last[1] !== y) tiles.push([x, y]);
  }
  assert.deepEqual(tiles, [[2724, 3594], [2725, 3594], [2726, 3595], [2726, 3596], [2725, 3597]], JSON.stringify(synced));
});
