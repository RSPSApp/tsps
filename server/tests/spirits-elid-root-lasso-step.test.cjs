// Run after `yarn build`: node --test tests/spirits-elid-root-lasso-step.test.cjs
//
// The rope on the root above the waterfall: live steps the player onto 3371,3129 the tick after the
// rope is used, and the lasso (with its camera) comes the tick after that. From 3372,3129
// (rsprox_transcripts/227/01788.txt ticks 5027-5029) and 3372,3130 (231/03019.txt ticks 53-55); already on
// 3371,3129 there is no step and the lasso still comes two ticks on (231/03019.txt ticks 571-573).
// Real Player, MovementQueue and plugins through the quest capture harness; the use is a packet.
const assert = require("node:assert/strict");
const { before, after, test } = require("node:test");
const h = require("./quest-capture-harness.cjs");

const ROOT = 6382;
const ROOT_TILE = [3369, 3132];
const ROPE = 954;

before(async () => {
  h.key = "spirits_of_the_elid";
  await h.setup([[3371, 3129], [3349, 9536]]);
});
after(() => h.teardown());

const at = (f) => [f.player.getLocation().getX(), f.player.getLocation().getY(), f.player.getLocation().getZ()];

async function useRope(t, from, { during } = {}) {
  const f = h.actor(t, { at: from, items: [ROPE], done: [] });
  const sender = f.player.getPacketSender();
  const cameraTicks = [];
  const moveCamera = sender.sendCameraMoveTo.bind(sender);
  sender.sendCameraMoveTo = (...args) => { cameraTicks.push(f.tick); return moveCamera(...args); };
  const slot = f.player.getInventory().getItems().findIndex((item) => item?.getId?.() === ROPE);
  await h.dispatch(f, { type: "item_on_object", objectId: ROOT, x: ROOT_TILE[0], y: ROOT_TILE[1], itemId: ROPE, slot,
    widgetId: h.core.Inventory.INTERFACE_ID << 16 });
  // tiles[tick]: where the player stands once that tick has run.
  const tiles = [];
  tiles[f.tick] = at(f);
  for (let i = 0; i < 6; i++) {
    if (during) await during(f, i);
    h.tick(f);
    tiles[f.tick] = at(f);
  }
  const used = f.messages.find((m) => m.text === "You tie the rope to the root and climb down into the cave.")?.tick ?? -1;
  return { f, used, tiles, cameraTicks };
}

test("from 3372,3129 the player steps onto 3371,3129 the tick after the use, and the lasso's camera comes the tick after (01788 5027-5029)", async (t) => {
  const { f, used, tiles, cameraTicks } = await useRope(t, [3372, 3129, 0]);
  assert.ok(used > 0, "the rope was used");
  assert.deepEqual(tiles[used], [3372, 3129, 0], "still on the click tile as the rope is used");
  assert.deepEqual(tiles[used + 1], [3371, 3129, 0], "one step, the tick after");
  assert.equal(cameraTicks[0] - used, 2, "the camera with the lasso, two ticks on");
  for (let i = 0; i < 6; i++) h.tick(f);
  assert.deepEqual(at(f), [3349, 9536, 0], "and down into the cave");
});

test("from 3372,3130 the step is the same diagonal one (03019 53-55)", async (t) => {
  const { used, tiles } = await useRope(t, [3372, 3130, 0]);
  assert.ok(used > 0, "the rope was used");
  assert.deepEqual(tiles[used], [3372, 3130, 0]);
  assert.deepEqual(tiles[used + 1], [3371, 3129, 0]);
});

test("already on 3371,3129 the player stays put until the descent (03019 571-573)", async (t) => {
  const { used, tiles, cameraTicks } = await useRope(t, [3371, 3129, 0]);
  assert.ok(used > 0, "the rope was used");
  assert.deepEqual(tiles[used], [3371, 3129, 0]);
  assert.deepEqual(tiles[used + 1], [3371, 3129, 0]);
  assert.deepEqual(tiles[used + 2], [3371, 3129, 0]);
  assert.equal(cameraTicks[0] - used, 2);
});

// Live sets busy (12393) from the step on (01788 tick 5028); here a descent under way is guarded.
test("a teleport the tick after the use cancels the descent: the player is not pulled into the cave", async (t) => {
  const { f } = await useRope(t, [3372, 3129, 0], {
    during: (g, i) => { if (i === 0) g.player.moveTo(new h.core.Location(3220, 3218, 0)); },
  });
  for (let i = 0; i < 6; i++) h.tick(f);
  assert.deepEqual(at(f), [3220, 3218, 0]);
});

test("a teleport during the fade leaves the player where they went, with the fade closed", async (t) => {
  const { f, used } = await useRope(t, [3371, 3129, 0], {
    during: (g, i) => { if (i === 2) g.player.moveTo(new h.core.Location(3220, 3218, 0)); },
  });
  assert.ok(used > 0);
  for (let i = 0; i < 6; i++) h.tick(f);
  assert.deepEqual(at(f), [3220, 3218, 0]);
  assert.equal(f.player.getMovementQueue().isMovementBlocked(), false, "movement is free again");
});

test("walking away before the lasso cancels the descent", async (t) => {
  const { f } = await useRope(t, [3372, 3129, 0], {
    during: async (g, i) => {
      if (i === 0) await g.connection.dispatch([{ type: "move", worldX: 3374, worldY: 3128, modifierFlags: 0, run: false }]);
    },
  });
  for (let i = 0; i < 6; i++) h.tick(f);
  assert.notDeepEqual(at(f), [3349, 9536, 0], "not pulled into the cave");
  assert.equal(at(f)[1] < 4000, true);
});

test("a second use during the lasso is ignored: one camera, one descent", async (t) => {
  const { f, cameraTicks } = await useRope(t, [3372, 3129, 0], {
    during: async (g, i) => {
      if (i !== 0) return;
      const slot = g.player.getInventory().getItems().findIndex((item) => item?.getId?.() === ROPE);
      await g.connection.dispatch([{ type: "item_on_object", objectId: ROOT, x: ROOT_TILE[0], y: ROOT_TILE[1], itemId: ROPE, slot,
        widgetId: h.core.Inventory.INTERFACE_ID << 16 }]);
    },
  });
  for (let i = 0; i < 6; i++) h.tick(f);
  assert.equal(cameraTicks.length, 1, JSON.stringify(cameraTicks));
  assert.deepEqual(at(f), [3349, 9536, 0]);
  assert.equal(f.messages.filter((m) => m.text === "You tie the rope to the root and climb down into the cave.").length, 1);
});
