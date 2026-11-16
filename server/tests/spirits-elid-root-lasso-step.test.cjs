// Run after `yarn build`: node --test tests/spirits-elid-root-lasso-step.test.cjs
//
// The rope on the root above the waterfall: live steps the player onto 3371,3129 the tick after the
// rope is used, and the lasso (with its camera) comes the tick after that. From 3372,3129
// (rsprox_transcripts/227/01788.txt ticks 5027-5029) and 3372,3130 (231/03019.txt ticks 53-55); already on
// 3371,3129 there is no step and the lasso still comes two ticks on (231/03019.txt ticks 571-573).
// The lasso (elid_rope_lasso 2910 and synth 1258, both 30 cycles in) is followed four ticks on by the climb
// (elid_climb_rope 2909), the fade three ticks after that and the move into the cave four after the fade
// (01788 ticks 5029, 5033, 5036, 5040; 03019 ticks 55, 59, 62, 66 and 573, 577, 580, 584).
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

async function useRope(t, from, { during, stage = 0 } = {}) {
  const f = h.actor(t, { at: from, items: [ROPE], done: [], stage });
  const sender = f.player.getPacketSender();
  const cameraTicks = [];
  const moveCamera = sender.sendCameraMoveTo.bind(sender);
  sender.sendCameraMoveTo = (...args) => { cameraTicks.push(f.tick); return moveCamera(...args); };
  const anims = [], sounds = [], fades = [];
  const perform = f.player.performAnimation.bind(f.player);
  f.player.performAnimation = (animation) => { anims.push([f.tick, animation.getId(), animation.getDelay()]); return perform(animation); };
  const sound = sender.sendSound.bind(sender);
  sender.sendSound = (id, volume, delay) => { sounds.push([f.tick, id, delay]); return sound(id, volume, delay); };
  const mount = sender.mountSubInterface.bind(sender);
  sender.mountSubInterface = (uid, id, ...rest) => { if (id === 174) fades.push(f.tick); return mount(uid, id, ...rest); };
  const closes = [];
  const close = sender.closeSubInterface.bind(sender);
  sender.closeSubInterface = (uid, ...rest) => { closes.push([f.tick, uid]); return close(uid, ...rest); };
  // The player's own update block as built for the client each tick (the exactmove, the animation).
  const views = [];
  const session = f.player.getSession();
  const createView = session.createPlayerView;
  session.createPlayerView = function (target, ...rest) {
    const view = createView.call(this, target, ...rest);
    if (target === f.player) views.push([f.tick, view]);
    return view;
  };
  const ropeLocs = [], stages = [];
  const slot = f.player.getInventory().getItems().findIndex((item) => item?.getId?.() === ROPE);
  await h.dispatch(f, { type: "item_on_object", objectId: ROOT, x: ROOT_TILE[0], y: ROOT_TILE[1], itemId: ROPE, slot,
    widgetId: h.core.Inventory.INTERFACE_ID << 16 });
  // tiles[tick]: where the player stands once that tick has run.
  const tiles = [];
  tiles[f.tick] = at(f);
  const ropeLoc = h.core.CacheDefinitions.getLocId("elid_climbing_rope_up_3x3");
  for (let i = 0; i < 14; i++) {
    if (during) await during(f, i);
    h.tick(f);
    tiles[f.tick] = at(f);
    stages[f.tick] = h.stage(f);
    ropeLocs[f.tick] = h.core.ObjectManager.objectsAt(new h.core.Location(3371, 3130, 0))
      .filter((o) => o.getId() === ropeLoc).map((o) => [o.getType(), o.getFace()]);
  }
  const used = f.messages.find((m) => m.text === "You tie the rope to the root and climb down into the cave.")?.tick ?? -1;
  const busy = f.calls.filter((c) => c.name === "sendVarbit" && c.args[0] === h.core.CacheDefinitions.getVarbitId("busy"))
    .map((c) => [c.tick, c.args[1]]);
  return { f, used, tiles, cameraTicks, anims, sounds, fades, closes, views, ropeLocs, busy, stages };
}

test("from 3372,3129 the player steps onto 3371,3129 the tick after the use, and the lasso's camera comes the tick after (01788 5027-5029)", async (t) => {
  const { f, used, tiles, cameraTicks } = await useRope(t, [3372, 3129, 0]);
  assert.ok(used > 0, "the rope was used");
  assert.deepEqual(tiles[used], [3372, 3129, 0], "still on the click tile as the rope is used");
  assert.deepEqual(tiles[used + 1], [3371, 3129, 0], "one step, the tick after");
  assert.equal(cameraTicks[0] - used, 2, "the camera with the lasso, two ticks on");
  assert.deepEqual(at(f), [3349, 9536, 0], "and down into the cave");
});

test("the lasso, then the climb four ticks on, the fade three after and the cave four after that (01788 5029-5040)", async (t) => {
  const { used, tiles, anims, sounds, fades } = await useRope(t, [3372, 3129, 0]);
  const lasso = used + 2;
  const seq = (name) => h.core.CacheDefinitions.getSeqId(name);
  assert.deepEqual(anims.filter(([, id]) => id === seq("elid_rope_lasso") || id === seq("elid_climb_rope")),
    [[lasso, 2910, 30], [lasso + 4, 2909, 0]], "elid_rope_lasso 30 cycles in, then elid_climb_rope");
  assert.deepEqual(sounds.filter(([, id]) => id === 1258), [[lasso, 1258, 30]], "synth 1258 with the lasso");
  assert.deepEqual(fades.slice(0, 1), [lasso + 7], "the fade three ticks after the climb");
  assert.deepEqual(tiles[lasso + 10], [3371, 3132, 0], "on the rope (the climb's tile) the tick before");
  assert.deepEqual(tiles[lasso + 11], [3349, 9536, 0], "into the cave four ticks after the fade");
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
  assert.deepEqual(tiles[used + 13], [3349, 9536, 0], "the same timing from there (03019 573-584)");
});

// Live sets busy (12393) from the step on (01788 tick 5028); here a descent under way is guarded.
test("a teleport the tick after the use cancels the descent: the player is not pulled into the cave", async (t) => {
  const { f } = await useRope(t, [3372, 3129, 0], {
    during: (g, i) => { if (i === 0) g.player.moveTo(new h.core.Location(3220, 3218, 0)); },
  });
  for (let i = 0; i < 6; i++) h.tick(f);
  assert.deepEqual(at(f), [3220, 3218, 0]);
});

for (const [when, i] of [["the lasso", 2], ["the fade", 10]]) {
  test(`a teleport during ${when} leaves the player where they went, with movement free again`, async (t) => {
    const { f, used, anims } = await useRope(t, [3371, 3129, 0], {
      during: (g, tick) => { if (tick === i) g.player.moveTo(new h.core.Location(3220, 3218, 0)); },
    });
    assert.ok(used > 0);
    assert.deepEqual(at(f), [3220, 3218, 0]);
    assert.equal(f.player.getMovementQueue().isMovementBlocked(), false, "movement is free again");
    if (i < 4) assert.equal(anims.some(([, id]) => id === 2909), false, "no climb off the root");
  });
}

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

// 227/01788 tick 5033 and 231/03019 ticks 59 and 577: the climb moves the player to 3371,3132 with
// exactmove to1=(3371,3129) delay1=15, to2=(3371,3131) delay2=120, angle=1024 and elid_climb_rope; it adds
// elid_climbing_rope_up_3x3 (10392) at 3371,3130 (shape 10, rotation 2), deleted five ticks on (5038, 64),
// and plays synth 2482 twice. busy (12393) goes 0 to 1 on the step tick (5028) and back at the cave (5040).
test("the climb moves the player to 3371,3132 with the captured exactmove, rope loc, synths and busy (01788 5028-5040)", async (t) => {
  const { used, tiles, sounds, views, ropeLocs, busy } = await useRope(t, [3372, 3129, 0]);
  const lasso = used + 2, climb = lasso + 4;
  assert.deepEqual(tiles[climb - 1], [3371, 3129, 0]);
  assert.deepEqual(tiles[climb], [3371, 3132, 0], "moved to 3371,3132 at the climb");
  const exactmoves = views.filter(([, view]) => view.forcedMovement);
  assert.equal(exactmoves.length, 1, "one exactmove");
  const [tick, view] = exactmoves[0];
  assert.equal(tick, climb);
  const { x, y } = view;
  const move = view.forcedMovement;
  assert.deepEqual([x + move.startDeltaX, y + move.startDeltaY, move.startCycleOffset, x + move.endDeltaX, y + move.endDeltaY,
    move.endCycleOffset, move.direction], [3371, 3129, 15, 3371, 3131, 120, 1024], "to1, delay1, to2, delay2, angle as captured");
  assert.equal(view.animation?.id, 2909, "elid_climb_rope with it");
  // Until the cave the client keeps the player at the exactmove's end: no walk from 3371,3131 to 3371,3132.
  for (let k = climb; k < lasso + 11; k++) {
    const [, later] = views.find(([at]) => at === k);
    assert.deepEqual([later.forcedMovementEnd?.x, later.forcedMovementEnd?.y], [3371, 3131], `tick ${k - lasso}`);
  }
  assert.deepEqual(sounds.filter(([, id]) => id === 2482), [[climb, 2482, 0], [climb, 2482, 0]], "synth 2482 twice at the climb");
  for (let k = used; k <= lasso + 11; k++) {
    const expected = k >= climb && k < climb + 5 ? [[10, 2]] : [];
    assert.deepEqual(ropeLocs[k] ?? [], expected, `rope loc at tick ${k - lasso}`);
  }
  assert.deepEqual(busy, [[used + 1, 1], [lasso + 11, 0]], "busy from the step to the cave");
});

test("already on the lasso tile, busy still comes on the tick after the use (03019 571-584)", async (t) => {
  const { used, busy, tiles } = await useRope(t, [3371, 3129, 0]);
  assert.deepEqual(busy, [[used + 1, 1], [used + 13, 0]]);
  assert.deepEqual(tiles[used + 6], [3371, 3132, 0]);
});

// A teleport after the climb or into the fade (L+7 to L+11): the fade closes, the camera resets and the climb's
// exactmove and animation are cleared on the next tick, not left until the next step; busy is cleared too.
for (const i of [7, 9, 11]) {
  test(`a teleport ${i - 2} ticks after the lasso closes the fade and clears the climb at once`, async (t) => {
    const away = new h.core.Location(3220, 3218, 0);
    const { f, used, anims, closes, busy } = await useRope(t, [3371, 3129, 0], {
      during: (g, tick) => { if (tick === i) g.player.moveTo(away); },
    });
    const teleported = used + i;
    assert.deepEqual(at(f), [3220, 3218, 0]);
    assert.ok(closes.some(([tick, uid]) => tick === teleported + 1 && uid === ((161 << 16) | 1)), JSON.stringify(closes));
    assert.equal(f.player.getForceMovement(), null, "the climb's exactmove is cleared");
    assert.ok(anims.some(([tick, id]) => tick === teleported + 1 && id === 65535), "the climb animation is reset");
    assert.deepEqual(busy.at(-1), [teleported + 1, 0]);
    assert.equal(f.player.getMovementQueue().isMovementBlocked(), false);
  });
}

test("a second use on the rope after the climb is ignored: no walk off it, one descent", async (t) => {
  const { f, tiles, used } = await useRope(t, [3372, 3129, 0], {
    during: async (g, i) => {
      if (i !== 7) return;
      const slot = g.player.getInventory().getItems().findIndex((item) => item?.getId?.() === ROPE);
      await g.connection.dispatch([{ type: "item_on_object", objectId: ROOT, x: ROOT_TILE[0], y: ROOT_TILE[1], itemId: ROPE, slot,
        widgetId: h.core.Inventory.INTERFACE_ID << 16 }]);
    },
  });
  for (let k = used + 6; k < used + 13; k++) assert.deepEqual(tiles[k], [3371, 3132, 0], `tick ${k - used}`);
  assert.deepEqual(at(f), [3349, 9536, 0]);
  assert.equal(f.player.getMovementQueue().isMovementBlocked(), false);
});

// 227/01788 tick 5036: elidquest goes 20 to 25 at the fade (L+7); the key was grabbed earlier with the stage at 20.
test("the descent advances the quest from 20 to 25 at the fade, and a teleport before it does not", async (t) => {
  const { used, stages } = await useRope(t, [3371, 3129, 0], { stage: 20 });
  const lasso = used + 2;
  assert.equal(stages[lasso + 6], 20, "still 20 the tick before the fade");
  assert.equal(stages[lasso + 7], 25, "25 at the fade");
  const away = await useRope(t, [3371, 3129, 0], {
    stage: 20, during: (g, tick) => { if (tick === 7) g.player.moveTo(new h.core.Location(3220, 3218, 0)); },
  });
  assert.equal(h.stage(away.f), 20, "a teleport at L+5 leaves it at 20");
  const early = await useRope(t, [3371, 3129, 0], { stage: 10 });
  assert.equal(h.stage(early.f), 10, "before the ballad the descent leaves the stage alone");
});

// Two players climbing within five ticks of each other: one rope loc stands on the tile until the later climb's
// five ticks are over, rather than the first climb's delete taking the second's rope with it.
test("a second player's climb keeps the rope loc for its own five ticks", async (t) => {
  const ropeLoc = h.core.CacheDefinitions.getLocId("elid_climbing_rope_up_3x3");
  const ropes = () => h.core.ObjectManager.objectsAt(new h.core.Location(3371, 3130, 0)).filter((o) => o.getId() === ropeLoc).length;
  let second = null, secondUsed = -1;
  const first = await useRope(t, [3371, 3129, 0], {
    during: async (g, i) => {
      if (i !== 2) return;
      second = h.actor(t, { at: [3371, 3129, 0], items: [ROPE], done: [] });
      second.tick = g.tick;
      const slot = second.player.getInventory().getItems().findIndex((item) => item?.getId?.() === ROPE);
      await h.dispatch(second, { type: "item_on_object", objectId: ROOT, x: ROOT_TILE[0], y: ROOT_TILE[1], itemId: ROPE, slot,
        widgetId: h.core.Inventory.INTERFACE_ID << 16 });
      secondUsed = g.tick;
    },
  });
  // The first climbs at use+6, the second (used two ticks later) at use+8; its rope must stand to use+12.
  assert.equal(secondUsed, first.used + 2);
  for (let k = first.used + 6; k <= first.used + 12; k++) {
    assert.deepEqual(first.ropeLocs[k], [[10, 2]], `one rope at tick ${k - first.used}`);
  }
  assert.equal(first.ropeLocs[first.used + 13]?.length, 0, "gone five ticks after the second climb");
  assert.equal(ropes(), 0);
  assert.ok(second);
});
