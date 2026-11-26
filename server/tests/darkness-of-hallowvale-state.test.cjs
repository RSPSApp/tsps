// node --test tests/darkness-of-hallowvale-state.test.cjs
//
// Darkness of Hallowvale's state module against the live capture (revision 242): live's stage values,
// the quest varbits each stage implies, the one-time migration of pre-capture saves (old stage numbers,
// old bit field; the old 310 was complete), transient varbits that are never saved, and outside stage
// jumps (::quest) bringing the varbits in line.
const assert = require("node:assert/strict");
const { test } = require("node:test");
const {
  STAGE, VARBIT, createState, impliedVarbits, migratedStage, legacyVarbits, VARS_ATTRIBUTE, SAVE_VERSION_ATTRIBUTE,
  LEGACY_BITS_ATTRIBUTE,
} = require("../plugins/quests/hallowvale/State.DarknessOfHallowvale");

function harness() {
  const listeners = {};
  const events = [];
  const api = {
    persistAttribute() {},
    onCustomEvent(name, fn) { (listeners[name] ??= []).push(fn); },
    emitCustomEvent(name, payload) {
      events.push({ name, payload });
      for (const fn of listeners[name] ?? []) fn(payload);
    },
  };
  const stages = new Map();
  const quest = {
    key: "darkness_of_hallowvale",
    getStage: (player) => stages.get(player) ?? 0,
    setStage: (player, value) => {
      stages.set(player, value);
      api.emitCustomEvent("quest:stage-changed", { player, key: "darkness_of_hallowvale", stage: value });
    },
  };
  const state = createState(api, () => quest);
  state.register();
  return { api, quest, state, events, stages };
}

function player() {
  const attributes = new Map();
  const varbits = [];
  return {
    varbits,
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    getPacketSender: () => ({ sendVarbit: (id, value) => varbits.push([id, value]) }),
  };
}

test("live's stage ladder: 36 values from 10 to 320 after 0, in the capture's order", () => {
  const values = Object.values(STAGE);
  assert.deepEqual(values, [...values].sort((a, b) => a - b));
  assert.equal(values.length, 37);
  for (const value of [10, 20, 30, 40, 50, 52, 54, 60, 65, 70, 80, 90, 100, 110, 120, 130, 140, 150, 160, 170, 180, 190,
    195, 200, 210, 220, 230, 240, 250, 260, 270, 280, 290, 300, 310, 320]) {
    assert.ok(values.includes(value), `stage ${value}`);
  }
  assert.equal(STAGE.COMPLETE, 320);
});

test("implied varbits follow the capture's ticks (bush only between Drezel and the cutscene, Sarius only 240-249)", () => {
  assert.deepEqual(impliedVarbits(STAGE.CHUTE_FIXED), { [VARBIT.BOAT_BROKEN]: 1, [VARBIT.CHUTE_BROKEN]: 1 });
  assert.equal(impliedVarbits(STAGE.BOAT_RIDE)[VARBIT.BOAT_BROKEN], 2);
  assert.equal(impliedVarbits(STAGE.DREZEL_TALKED)[VARBIT.BUSH], 1);
  assert.equal(impliedVarbits(STAGE.WEREWOLVES_SEEN)[VARBIT.BUSH], undefined);
  assert.equal(impliedVarbits(STAGE.SARIUS_SAVED)[VARBIT.SARIUS_VISIBLE], 1);
  assert.equal(impliedVarbits(STAGE.SARIUS_TALKED)[VARBIT.SARIUS_VISIBLE], undefined);
  assert.equal(impliedVarbits(STAGE.NORTH_SKETCHED)[VARBIT.SAFALAAN_VISIBLE], 2);
  const lab = impliedVarbits(STAGE.LAB_OPENED);
  assert.equal(lab[VARBIT.TAPESTRY], 1);
  assert.equal(lab[VARBIT.STATUE], 1);
  assert.equal(lab[VARBIT.SKETCHES_GIVEN], 1);
  assert.equal(lab[VARBIT.SARIUS_MESSAGE_GIVEN], 1);
  // Transient varbits are never implied (the trapdoor shuts, the hassle clears at logout).
  for (const value of Object.values(STAGE)) {
    const vars = impliedVarbits(value);
    assert.equal(vars[VARBIT.HIDEOUT_TRAPDOOR], undefined);
    assert.equal(vars[VARBIT.VAMP_HASSLE], undefined);
  }
});

test("old stage numbers map onto live's (the old 310 was complete; 160/170 were the client's 170/180)", () => {
  assert.equal(migratedStage(0), 0);
  assert.equal(migratedStage(10), STAGE.STARTED);
  assert.equal(migratedStage(40), STAGE.CHUTE_FIXED);
  assert.equal(migratedStage(54), STAGE.ARRIVED);
  assert.equal(migratedStage(100), STAGE.SENT_TO_DREZEL);
  assert.equal(migratedStage(110), STAGE.DREZEL_TALKED);
  assert.equal(migratedStage(160), STAGE.BACK_AT_PATERDOMUS);
  assert.equal(migratedStage(170), STAGE.SENT_BACK);
  assert.equal(migratedStage(180), STAGE.SENT_BACK);
  assert.equal(migratedStage(250), STAGE.SARIUS_TALKED);
  assert.equal(migratedStage(300), STAGE.SEALED_MESSAGE);
  assert.equal(migratedStage(310), STAGE.COMPLETE);
});

test("the old bit field becomes live's varbits", () => {
  const vars = legacyVarbits((1 << 0) | (1 << 1) | (1 << 2) | (1 << 3) | (1 << 9) | (1 << 13) | (1 << 26) | (2 << 16), 60);
  assert.equal(vars[VARBIT.BOAT_BROKEN], 2);
  assert.equal(vars[VARBIT.SEA_BOAT_VISIBLE], 1);
  assert.equal(vars[VARBIT.WALL_FLOORBOARDS], 1);
  assert.equal(vars[VARBIT.GHETTO_DOOR], 1);
  assert.equal(vars[VARBIT.LADDERTOP_WALL], 2);
  assert.equal(vars[VARBIT.PUSHWALL_4], 2);
  assert.equal(vars[VARBIT.PORTRAIT], 2);
});

test("migrate runs once, maps the stage and the bits, and is not mistaken for an outside jump", () => {
  const h = harness();
  const p = player();
  h.stages.set(p, 40); // the old "boat pushed"
  p.setAttribute(LEGACY_BITS_ATTRIBUTE, (1 << 0) | (1 << 1) | (1 << 2));
  assert.equal(h.state.migrate(p), true);
  assert.equal(h.stages.get(p), STAGE.CHUTE_FIXED);
  assert.equal(h.state.get(p, VARBIT.BOAT_BROKEN), 2);
  assert.equal(h.state.get(p, VARBIT.SEA_BOAT_VISIBLE), 1);
  assert.equal(p.getAttribute(LEGACY_BITS_ATTRIBUTE), 0);
  assert.equal(p.getAttribute(SAVE_VERSION_ATTRIBUTE), 1);
  assert.equal(h.state.migrate(p), false);
  // A completed old save (310) is live's 320.
  const done = player();
  h.stages.set(done, 310);
  h.state.migrate(done);
  assert.equal(h.stages.get(done), STAGE.COMPLETE);
  // Live's 310 on a migrated save stays 310.
  const live = player();
  live.setAttribute(SAVE_VERSION_ATTRIBUTE, 1);
  h.stages.set(live, STAGE.SEALED_MESSAGE);
  assert.equal(h.state.migrate(live), false);
  assert.equal(h.stages.get(live), STAGE.SEALED_MESSAGE);
});

test("transient varbits are sent but never saved; clearTransient drops them", () => {
  const h = harness();
  const p = player();
  h.state.set(p, VARBIT.HIDEOUT_TRAPDOOR, 2);
  h.state.set(p, VARBIT.VAMP_HASSLE, 1);
  h.state.set(p, VARBIT.WALL_FLOORBOARDS, 1);
  assert.deepEqual(p.varbits, [[VARBIT.HIDEOUT_TRAPDOOR, 2], [VARBIT.VAMP_HASSLE, 1], [VARBIT.WALL_FLOORBOARDS, 1]]);
  assert.deepEqual(p.getAttribute(VARS_ATTRIBUTE), { [VARBIT.WALL_FLOORBOARDS]: 1 });
  assert.equal(h.state.get(p, VARBIT.HIDEOUT_TRAPDOOR), 2);
  h.state.clearTransient(p);
  assert.equal(h.state.get(p, VARBIT.HIDEOUT_TRAPDOOR), 0);
  assert.equal(h.state.get(p, VARBIT.WALL_FLOORBOARDS), 1);
});

test("advance only moves forward and emits darkness-of-hallowvale:stage; an outside jump resets the varbits", () => {
  const h = harness();
  const p = player();
  assert.equal(h.state.advance(p, STAGE.STARTED), true);
  assert.equal(h.state.advance(p, STAGE.STARTED), false);
  assert.ok(h.events.some((e) => e.name === "darkness-of-hallowvale:stage" && e.payload.stage === STAGE.STARTED));
  h.state.set(p, VARBIT.BOAT_BROKEN, 1);
  assert.equal(h.state.get(p, VARBIT.BOAT_BROKEN), 1, "own advance keeps the varbits");
  h.quest.setStage(p, STAGE.DREZEL_TALKED); // ::quest
  assert.deepEqual(p.getAttribute(VARS_ATTRIBUTE), impliedVarbits(STAGE.DREZEL_TALKED));
  h.quest.setStage(p, 0);
  assert.deepEqual(p.getAttribute(VARS_ATTRIBUTE), {});
  assert.ok(p.varbits.some(([id, value]) => id === VARBIT.BUSH && value === 0), "a dropped varbit is cleared on the client");
});
