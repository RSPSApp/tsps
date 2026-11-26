"use strict";

/**
 * The preform's temperature: the lava pool heats it, the waterfall cools it, and it cools on its
 * own while worn.
 *
 * rsprox captures (all four recordings):
 * - Dunk-preform / Quench-preform change the temperature every tick by a step that grows the
 *   longer the player holds it there. Both sixteenth dips are at the lava pool (227/96 and 227/101).
 * - Heat-preform / Cool-preform first dip with no temperature change (227/96).
 * - Each dip plays human_pickupfloor at the lava with synth 1019, or human_pickuptable at the
 *   waterfall with synth 1006.
 * - A worn preform loses a degree every second tick, also while it is being heated or worked.
 */

const Shared = require("./Shared.GiantsFoundry");

// The 16th dip is 95 (227/96 and 227/101). Repeating it on later dips is an estimate.
const FAST_STEPS = [27, 30, 33, 37, 41, 45, 49, 53, 57, 62, 67, 72, 77, 83, 89, 95];
// 227/96 records five Heat-preform steps and two Cool-preform steps. Later steps are estimates.
const SLOW_STEPS = [0, 7, 8, 9, 11, 12, 13, 15, 16, 17, 18, 20, 21, 23, 25, 26, 28];
const MAX_TEMPERATURE = 1000;
const PASSIVE_PERIOD = 2;

const SOURCE = {
  LAVA: { direction: 1, anim: 827, sound: 1019 },
  WATERFALL: { direction: -1, anim: 832, sound: 1006 },
};

function start(player, source, steps) {
  if (!Shared.questComplete(player) || !Shared.wornPreform(player)) return false;
  Shared.stopWork(player);
  Shared.setWork(player, { kind: "temperature", source, steps, step: 0, origin: player.getLocation().clone() });
  return true;
}

function heat({ player }) {
  return start(player, SOURCE.LAVA, SLOW_STEPS);
}

function dunk({ player }) {
  return start(player, SOURCE.LAVA, FAST_STEPS);
}

function cool({ player }) {
  return start(player, SOURCE.WATERFALL, SLOW_STEPS);
}

function quench({ player }) {
  return start(player, SOURCE.WATERFALL, FAST_STEPS);
}

function stop(player) {
  const state = Shared.workOf(player);
  if (state?.kind !== "temperature") return;
  Shared.setWork(player, null);
  Shared.animate(player, -1);
}

function change(player, delta) {
  const temperature = Shared.get(player, Shared.VARBIT.TEMPERATURE);
  Shared.set(player, Shared.VARBIT.TEMPERATURE, Math.max(0, Math.min(MAX_TEMPERATURE, temperature + delta)));
}

function tick(player, now) {
  if (!Shared.wornPreform(player)) return;
  if (now % PASSIVE_PERIOD === 0) change(player, -1);
  const state = Shared.workOf(player);
  if (state?.kind !== "temperature") return;
  if (!player.getLocation().equals(state.origin)) {
    stop(player);
    return;
  }
  const temperature = Shared.get(player, Shared.VARBIT.TEMPERATURE);
  const done = state.source.direction > 0 ? temperature >= MAX_TEMPERATURE : temperature <= 0;
  if (done) {
    stop(player);
    return;
  }
  const step = state.steps[Math.min(state.step, state.steps.length - 1)];
  state.step++;
  Shared.animate(player, state.source.anim);
  Shared.sound(player, state.source.sound);
  change(player, state.source.direction * step);
}

module.exports = function attachTemperature(api) {
  api.onObjectInteraction(Shared.OBJECT.LAVA_POOL, { "Heat-preform": heat, "Dunk-preform": dunk });
  api.onObjectInteraction(Shared.OBJECT.WATERFALL, { "Cool-preform": cool, "Quench-preform": quench });
  Shared.onTick(tick);
  Shared.onStopWork(stop);
};

Object.assign(module.exports, { FAST_STEPS, SLOW_STEPS });
