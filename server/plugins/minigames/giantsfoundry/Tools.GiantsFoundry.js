"use strict";

/**
 * Working the preform on the trip hammer, grindstone and polishing wheel.
 *
 * rsprox captures (all four recordings), per machine tick:
 * - Trip hammer: every 5th tick, completion +20 and temperature -25, synth 5601. Its ticks are the
 *   room's own hammer cycle (every tick whose count is a multiple of 5), not five ticks from the
 *   click: recording 101's hits all land on ticks 94, 99, 104, 109, 114, 209, 214, 354, 359, 364
 *   (every one a multiple of 5 plus 4) however long the player had been swinging.
 * - Grindstone: every 2nd tick, completion +10 and temperature +15, synth 5604.
 * - Polishing wheel: every 2nd tick, completion +10 and temperature -17, synth 5608.
 *   These two count from the click instead (recording 101: the grindstone works on even ticks in
 *   one stretch and odd ticks in the next, so the phase follows the player, not the room).
 * - The player lifts the preform (human_preform_lift_start/_start02, then the loop every tick).
 * - A tick that damages the preform (the stage needs another tool, or the preform is outside
 *   the tool's heat zone) makes no progress, costs 5 quality and plays synth 2724.
 * - Sweet spots: on a machine tick the HUD's border turns gold (script 6122 [1]). Clicking the
 *   machine within it turns it green ([2]) and works the preform at once with 50 extra
 *   progress, synth 2192 and "Your quick reactions allow you to find the perfect position to
 *   work the preform!", then clears ([0]). Unclicked, it clears after 9 ticks.
 * - Clicking the machine again outside a sweet spot: "Your attempt to overwork the preform
 *   causes you to miss the action altogether." and the next machine tick does nothing.
 *
 * The heat zones and the stage the completion bar is in are the HUD's own (scripts 6120 and
 * 6121), so the server judges a tick exactly as the HUD draws it. XP per tick, the sweet spot
 * count and quality regain and the Smiths' uniform's bonus are the Wiki's.
 */

const Shared = require("./Shared.GiantsFoundry");
const { smithsUniformChance } = require("../../skills/smithing/Common.Smithing");

const TOOL = { HAMMER: 0, GRIND: 1, POLISH: 2 };

const TOOLS = [
  {
    tool: TOOL.HAMMER, object: Shared.OBJECT.TRIP_HAMMER, cycle: Shared.HAMMER_PERIOD, progress: 20, heat: -25,
    sound: 5601, animStart: 9453, animLoop: 9455, xp: 4.5, uniformBonus: 1, step: "hammered",
  },
  {
    tool: TOOL.GRIND, object: Shared.OBJECT.GRINDSTONE, period: 2, progress: 10, heat: 15,
    sound: 5604, animStart: 9452, animLoop: 9454, xp: 3.2, uniformBonus: 1, step: "ground",
  },
  {
    tool: TOOL.POLISH, object: Shared.OBJECT.POLISHING_WHEEL, period: 2, progress: 10, heat: -17,
    sound: 5608, animStart: 9452, animLoop: 9454, xp: 3.3, uniformBonus: 1, step: "polished",
  },
];

/** Script 6121: each tool's heat zone is centred here, 333 wide, narrowing with difficulty. */
const ZONE_CENTRE = [832, 499, 166];
const MAX_TEMPERATURE = 1000;
const MAX_COMPLETION = 1000;
const DAMAGE = 5;
const SOUND_DAMAGE = 2724;
const SWEET_SPOT = { CLEAR: 0, OPEN: 1, HIT: 2 };
const SCRIPT_SWEET_SPOT = 6122;
const SWEET_SPOT_TICKS = 9;
const SWEET_SPOT_BONUS = 50;
const SOUND_SWEET_SPOT = 2192;

/** Persisted per preform. */
const FIELD = { SWEET_PLAN: "sweetSpots", DOUBLE_XP: "doubleXp" };

const MESSAGE = {
  SWEET_SPOT: "<col=229628>Your quick reactions allow you to find the perfect position to work the preform!",
  OVERWORK: "<col=ff3045>Your attempt to overwork the preform causes you to miss the action altogether.",
  FINISHED: "Looks like the sword is finished. I should take it to Kovac.",
  RUINED: "<col=ff3045>This sword is too damaged to keep working. You should give it to Kovac and try again.",
};

// ============================================================================
// The HUD's rules
// ============================================================================

/** Script 6119. */
function stageCount(difficulty) {
  if (difficulty < 20) return 3;
  if (difficulty < 60) return 4;
  if (difficulty < 90) return 5;
  if (difficulty < 120) return 6;
  return 7;
}

/** Script 6120: the completion bar's stage. */
function stageOf(completion, stages) {
  return Math.min(stages - 1, Math.floor((completion * stages) / MAX_COMPLETION));
}

/** The tool a stage needs: stage 0 the trip hammer, the rest their seed (13940-13945). */
function stageTool(player, stage) {
  return stage === 0 ? TOOL.HAMMER : Shared.get(player, Shared.VARBIT.SEED_FIRST + stage - 1);
}

/** Script 6121: [start, start + range] is the tool's heat zone. */
function heatZone(tool, difficulty) {
  const range = 333 - Math.trunc((difficulty * 167) / 130);
  const start = ZONE_CENTRE[tool] - Math.trunc(range / 2);
  return { start, end: start + range };
}

function inZone(tool, difficulty, temperature) {
  const zone = heatZone(tool, difficulty);
  return temperature >= zone.start && temperature <= zone.end;
}

/** 6 and 7 section swords get three sweet spots, the rest two (Wiki). */
function sweetSpotCount(stages) {
  return stages >= 6 ? 3 : 2;
}

/**
 * Where this preform's sweet spots come: distinct stages, each at a point a little way into
 * its stage (captures: gold borders came in all stages, rarely right at a stage's start).
 */
function planSweetSpots(stages) {
  const order = Array.from({ length: stages }, (_, stage) => stage).sort(() => Math.random() - 0.5);
  return order.slice(0, sweetSpotCount(stages)).sort((a, b) => a - b).map((stage) => {
    const from = (stage * MAX_COMPLETION) / stages;
    const width = MAX_COMPLETION / stages;
    return { stage, at: Math.floor(from + width * (0.15 + Math.random() * 0.55)) };
  });
}

// ============================================================================
// Working a machine
// ============================================================================

function sweetSpot(player, value) {
  player.getPacketSender().sendClientScript(SCRIPT_SWEET_SPOT, value);
}

function closeSweetSpot(player, state, value = SWEET_SPOT.CLEAR) {
  if (!state?.sweet) return;
  if (value !== SWEET_SPOT.CLEAR) sweetSpot(player, value);
  sweetSpot(player, SWEET_SPOT.CLEAR);
  state.sweet = null;
}

function finished(player) {
  return Shared.get(player, Shared.VARBIT.COMPLETION) >= MAX_COMPLETION;
}

function ruined(player) {
  return Shared.get(player, Shared.VARBIT.PREFORM_QUALITY) <= 0;
}

function setTemperature(player, value) {
  Shared.set(player, Shared.VARBIT.TEMPERATURE, Math.max(0, Math.min(MAX_TEMPERATURE, value)));
}

function damage(player) {
  const quality = Math.max(0, Shared.get(player, Shared.VARBIT.PREFORM_QUALITY) - DAMAGE);
  Shared.set(player, Shared.VARBIT.PREFORM_QUALITY, quality);
  Shared.sound(player, SOUND_DAMAGE);
  if (quality <= 0 && Shared.field(player, "tutorial", false) !== true) {
    player.sendMessage(MESSAGE.RUINED);
    stop(player);
  }
}

/** One machine tick: heat changes either way; progress only with the right tool and heat. */
function machineTick(player, state, bonus = 0) {
  const spec = TOOLS[state.tool];
  const difficulty = Shared.get(player, Shared.VARBIT.PREFORM_DIFFICULTY);
  const stages = stageCount(difficulty);
  const completion = Shared.get(player, Shared.VARBIT.COMPLETION);
  const temperature = Shared.get(player, Shared.VARBIT.TEMPERATURE);
  const right = stageTool(player, stageOf(completion, stages)) === state.tool && inZone(state.tool, difficulty, temperature);
  if (state.overworked) {
    state.overworked = false;
    setTemperature(player, temperature + spec.heat);
    return;
  }
  if (!right) {
    setTemperature(player, temperature + spec.heat);
    damage(player);
    const requiredTool = stageTool(player, stageOf(completion, stages));
    const zone = heatZone(state.tool, difficulty);
    const request = { player, tool: state.tool, requiredTool, temperature, minimum: zone.start, maximum: zone.end, rightTool: requiredTool === state.tool, rightTemperature: inZone(state.tool, difficulty, temperature), stop: false };
    Shared.api().emitCustomEvent("giants-foundry:tool-check", request);
    if (request.stop) stop(player);
    return;
  }
  let progress = spec.progress + bonus;
  if (Math.random() < smithsUniformChance(player)) progress += spec.uniformBonus;
  const next = Math.min(MAX_COMPLETION, completion + progress);
  Shared.sound(player, spec.sound);
  Shared.set(player, Shared.VARBIT.COMPLETION, next);
  setTemperature(player, temperature + spec.heat);
  const doubled = Shared.field(player, FIELD.DOUBLE_XP, false) === true;
  Shared.addXp(player, "SMITHING", doubled ? spec.xp * 2 : spec.xp);
  Shared.setField(player, FIELD.DOUBLE_XP, null);
  const finishedStage = stageOf(next, stages) !== stageOf(completion, stages) || next >= MAX_COMPLETION;
  if (finishedStage) Shared.step(player, spec.step);
  if (next >= MAX_COMPLETION) {
    Shared.step(player, "finished");
    closeSweetSpot(player, state);
    stop(player);
    Shared.playerSays(player, MESSAGE.FINISHED);
    return;
  }
  if (bonus === 0) maybeOpenSweetSpot(player, state, next, stages);
}

function maybeOpenSweetSpot(player, state, completion, stages) {
  const plan = Shared.field(player, FIELD.SWEET_PLAN, []);
  if (!Array.isArray(plan) || plan.length === 0 || state.sweet) return;
  const stage = stageOf(completion, stages);
  // A stage left behind loses its sweet spot.
  const live = plan.filter((spot) => spot.stage >= stage);
  const due = live.find((spot) => spot.stage === stage && completion >= spot.at);
  if (due) live.splice(live.indexOf(due), 1);
  Shared.setField(player, FIELD.SWEET_PLAN, live);
  if (!due) return;
  state.sweet = { openedAt: state.ticks };
  sweetSpot(player, SWEET_SPOT.OPEN);
}

/** Clicking the machine in a gold window: works it now with the bonus, and wins back quality. */
function hitSweetSpot(player, state) {
  closeSweetSpot(player, state, SWEET_SPOT.HIT);
  Shared.sound(player, SOUND_SWEET_SPOT);
  player.sendMessage(MESSAGE.SWEET_SPOT);
  const quality = Shared.get(player, Shared.VARBIT.PREFORM_QUALITY);
  const start = Shared.get(player, Shared.VARBIT.PREFORM_START_QUALITY);
  if (quality < start) Shared.set(player, Shared.VARBIT.PREFORM_QUALITY, Math.min(start, quality + DAMAGE));
  state.sinceAction = 0;
  machineTick(player, state, SWEET_SPOT_BONUS);
  Shared.setField(player, FIELD.DOUBLE_XP, true);
}

function stop(player) {
  const state = Shared.workOf(player);
  if (!state || state.kind !== "tool") return;
  closeSweetSpot(player, state);
  Shared.setWork(player, null);
  Shared.animate(player, -1);
}

function useTool(player, tool) {
  if (!Shared.questComplete(player) || !Shared.wornPreform(player)) return false;
  if (finished(player)) {
    Shared.playerSays(player, MESSAGE.FINISHED);
    return true;
  }
  if (ruined(player) && Shared.field(player, "tutorial", false) !== true) {
    player.sendMessage(MESSAGE.RUINED);
    return true;
  }
  const current = Shared.workOf(player);
  if (current?.kind === "tool" && current.tool === tool) {
    if (current.sweet) hitSweetSpot(player, current);
    else {
      current.overworked = true;
      player.sendMessage(MESSAGE.OVERWORK);
    }
    return true;
  }
  Shared.stopWork(player);
  if (!Array.isArray(Shared.field(player, FIELD.SWEET_PLAN, null))) {
    const stages = stageCount(Shared.get(player, Shared.VARBIT.PREFORM_DIFFICULTY));
    Shared.setField(player, FIELD.SWEET_PLAN, planSweetSpots(stages));
  }
  Shared.setWork(player, { kind: "tool", tool, origin: player.getLocation().clone(), ticks: 0, sinceAction: 0, overworked: false, sweet: null });
  Shared.animate(player, TOOLS[tool].animStart);
  return true;
}

function useTripHammer({ player }) {
  return useTool(player, TOOL.HAMMER);
}

function useGrindstone({ player }) {
  return useTool(player, TOOL.GRIND);
}

function usePolishingWheel({ player }) {
  return useTool(player, TOOL.POLISH);
}

/**
 * Whether the machine works this tick: the trip hammer with the room's hammer, so its progress
 * and XP land on the tick the hammer comes down, the grindstone and polishing wheel every
 * `period` ticks from the click.
 */
function due(state, now) {
  const spec = TOOLS[state.tool];
  return spec.cycle ? now % spec.cycle === 0 : state.sinceAction >= spec.period;
}

function tick(player, now) {
  const state = Shared.workOf(player);
  if (!state || state.kind !== "tool") return;
  if (!Shared.wornPreform(player) || !player.getLocation().equals(state.origin)) {
    stop(player);
    return;
  }
  const spec = TOOLS[state.tool];
  state.ticks++;
  state.sinceAction++;
  Shared.animate(player, spec.animLoop);
  if (state.sweet && state.ticks - state.sweet.openedAt >= SWEET_SPOT_TICKS) closeSweetSpot(player, state);
  if (due(state, now)) {
    state.sinceAction = 0;
    machineTick(player, state);
  }
}

/** A new preform starts with a fresh sweet spot plan and no doubled XP. */
function resetPreform(player) {
  Shared.setField(player, FIELD.SWEET_PLAN, null);
  Shared.setField(player, FIELD.DOUBLE_XP, null);
}

module.exports = function attachTools(api) {
  api.onObjectInteraction(Shared.OBJECT.TRIP_HAMMER, { Use: useTripHammer });
  api.onObjectInteraction(Shared.OBJECT.GRINDSTONE, { Use: useGrindstone });
  api.onObjectInteraction(Shared.OBJECT.POLISHING_WHEEL, { Use: usePolishingWheel });
  Shared.onTick(tick);
  Shared.onStopWork(stop);
};

Object.assign(module.exports, {
  TOOL, TOOLS, stageCount, stageOf, stageTool, heatZone, inZone, sweetSpotCount, planSweetSpots,
  resetPreform, due, MESSAGE, DAMAGE,
});
