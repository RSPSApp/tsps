// The trials' intros (rsprox: Tempor Tantrum 3467, Jubbly Jive 907, Gwenith Glide 936): on a
// master's first talk, the transcript's course lines play over a tour of the course.
//   At the first course line: in_trial 1, time_generated, the demo's lost supplies
//   (objective0..N-1) and its outcrops or crystals, the HUD (script 8605 with [-1, 0.., "", clock]
//   every tick) and the camera on the roaming camera NPC (15110) at the master's end of the course.
//   Each line then moves the camera to its stop (an exact_move of 150-210 client cycles, or a jump
//   after a portal) with a hint arrow at what it's about: a tile, or the rum or toad boat; some
//   lines do more a few ticks in (the jubbly hopping outcrops, a portal's effect), some clear the
//   arrow.
//   Before the player's "I see. Do you have any tips or tricks for me?": in_trial 0, the demo
//   cleared, the arrow and HUD gone, the camera back, barracuda_intro 1 and the master's form 0->1.
//   While the camera moves, a line shows without "Click here to continue" for 3 ticks.
// Ours: the camera glides along a tile target, not an NPC, since our NPC updates reach 127 tiles
// and the tours go further (the scene follows the target in our client as it does live); the NPCs
// near a far stop (storm clouds, birds) aren't shown; closing the conversation ends the tour as if
// finished.
const common = require("./Common.BarracudaTrials");
const run = require("./Run.BarracudaTrials");
const ships = require("./Ships.BarracudaTrials");
const { fade } = require("../SailingContent.Sailing");

const END_LINE = "I see. Do you have any tips or tricks for me?";
const SCRIPT_HUD_UPDATE = 8605;
const HINT_SLOT = 6;
const POSITIONS = { centre: 2, west: 3, east: 4, south: 5, north: 6 };
const PORTAL_HUD_TICKS = 5;
const HOLD_TICKS = 3;
const FADE_CYCLES = 15;
const OVERLAY_ATMOSPHERE = (161 << 16) | 1;

/** Players about to see an intro (first talk) or in one: player -> { trial, started, timers }. */
const tours = new Map();

function out(player) {
  return player.getPacketSender();
}

function later(player, tour, ticks, action) {
  const { CountdownTask, TaskManager } = common.core();
  const task = new CountdownTask(player, ticks, () => tours.get(player) === tour && action());
  TaskManager.submit(task);
}

function hint(player, spec) {
  const sender = out(player);
  sender.sendVarbit(common.varbit("current_hint_arrow"), HINT_SLOT);
  if (spec.ship) {
    const index = ships.entityIndex(spec.ship);
    if (index !== undefined) sender.sendWorldEntityHint(index, spec.height);
    return;
  }
  const { Location } = common.core();
  const [x, y] = spec.tile;
  sender.sendPositionalHint(new Location(x, y, 1), POSITIONS[spec.position] ?? 2, spec.height, 1);
}

/** The Gwenith Glide's portal shown: the HUD off, the portal's effect, the HUD back 5 ticks on. */
function portal(player, tour) {
  run.closeHud(player);
  const effectsOff = out(player).getVarbit(common.varbit("settings_colourful_fade_disabled")) === 1;
  if (effectsOff) {
    fade(player, true, FADE_CYCLES, { minimap: false });
    later(player, tour, 2, () => fade(player, false, FADE_CYCLES, { minimap: false }));
  } else {
    out(player).sendSubInterface(OVERLAY_ATMOSPHERE, 745, 1, { postScripts: [{ scriptId: 5984, args: [54330, 16316664] }] });
    later(player, tour, 2, () => out(player).sendClientScript(5985));
  }
  later(player, tour, PORTAL_HUD_TICKS, () => {
    out(player).closeSubInterface(OVERLAY_ATMOSPHERE);
    run.openHud(player);
  });
}

function play(player, tour, event) {
  const sender = out(player);
  const { Graphic, Location } = common.core();
  if (event.camera) {
    const [x, y, cycles] = event.camera;
    sender.sendCameraTarget({ x, y, level: 0, ...(cycles > 0 && { cycles }) });
  }
  if (event.clearHint) {
    sender.sendVarbit(common.varbit("current_hint_arrow"), 0);
    sender.clearHintArrow();
  }
  if (event.hint) hint(player, event.hint);
  for (const [name, value] of Object.entries(event.varbits ?? {})) sender.sendVarbit(common.varbit(name), value);
  if (event.portal) portal(player, tour);
  if (event.graphic) {
    const [id, x, y, height] = event.graphic;
    sender.sendGraphic(new Graphic(id, 0, height ?? 0), new Location(x, y, 0));
  }
}

function step(player, tour, line) {
  for (const event of line.events ?? []) {
    if (event.at > 0) later(player, tour, event.at, () => play(player, tour, event));
    else play(player, tour, event);
  }
}

function begin(player, tour) {
  const { trial } = tour;
  const intro = trial.intro;
  tour.started = true;
  common.updateProgress(player, trial, (saved) => { saved.intro = true; });
  const sender = out(player);
  sender.sendVarbit(common.varbit("sailing_bt_in_trial"), 1);
  sender.sendConfig(common.varp("sailing_bt_time_generated"), common.clock());
  for (let k = 0; k < intro.objectives; k++) sender.sendVarbit(common.varbit(`sailing_bt_objective${k}`), 1);
  for (const [name, value] of Object.entries(intro.varbits ?? {})) sender.sendVarbit(common.varbit(name), value);
  const [x, y] = intro.camera;
  sender.sendCameraTarget({ x, y, level: 0 });
  run.openHud(player);
  demoHud(player);
  watch(player, tour);
}

function demoHud(player) {
  out(player).sendClientScript(SCRIPT_HUD_UPDATE, -1, 0, 0, 0, 0, 0, 0, 0, 0, "", common.clock());
}

/** The tour's end, as live: the demo off, the camera back, the master's new form. */
function finish(player, tour) {
  if (tours.get(player) !== tour) return;
  tours.delete(player);
  if (!tour.started) return;
  const sender = out(player);
  const intro = tour.trial.intro;
  sender.sendVarbit(common.varbit("sailing_bt_in_trial"), 0);
  for (let k = 0; k < intro.objectives; k++) sender.sendVarbit(common.varbit(`sailing_bt_objective${k}`), 0);
  for (const name of demoVarbits(intro)) sender.sendVarbit(common.varbit(name), 0);
  sender.sendVarbit(common.varbit("current_hint_arrow"), 0);
  sender.clearHintArrow();
  run.closeHud(player);
  sender.closeSubInterface(OVERLAY_ATMOSPHERE);
  sender.sendCameraReset();
  common.sendProgress(player);
}

function demoVarbits(intro) {
  const names = new Set(Object.keys(intro.varbits ?? {}));
  for (const line of intro.steps) for (const event of line.events ?? []) for (const name of Object.keys(event.varbits ?? {})) names.add(name);
  return names;
}

/** A conversation closed mid-tour ends it there. */
function watch(player, tour) {
  const { Task, TaskManager } = common.core();
  TaskManager.submit(new (class extends Task {
    constructor() { super(1, player, false); }
    execute() {
      if (tours.get(player) !== tour) return this.stop();
      if (player.isRegistered?.() === false || !player.getDialogueManager().getCurrent?.()) {
        finish(player, tour);
        this.stop();
        return;
      }
      demoHud(player);
    }
  })());
}

function onLine(request) {
  const tour = tours.get(request.player);
  if (!tour) return;
  const intro = tour.trial.intro;
  const text = String(request.text ?? "");
  if (text === END_LINE) {
    request.before = () => finish(request.player, tour);
    return;
  }
  const line = intro.steps.find((candidate) => text.startsWith(candidate.line));
  if (!line) return;
  // While the camera moves the line shows without "Click here to continue", which comes 3 ticks
  // later (rsprox 3467, 907, 936).
  if (line.events?.some((event) => event.camera) && (tour.started || text.startsWith(intro.start))) request.holdTicks = HOLD_TICKS;
  request.before = () => {
    if (tours.get(request.player) !== tour) return;
    if (!tour.started) {
      if (!text.startsWith(intro.start)) return;
      begin(request.player, tour);
    }
    step(request.player, tour, line);
  };
}

function attach(api) {
  common.init(api);
  api.onCustomEvent("barracuda-trials:intro", onIntro);
  api.onCustomEvent("npc-dialogue:line", onLine);
  api.onPlayerLogout(forget);
}

function onIntro({ player, trial }) {
  if (trial.intro) tours.set(player, { trial, started: false });
}

function forget({ player }) {
  tours.delete(player);
}

module.exports = attach;
module.exports.onLine = onLine;
module.exports.tours = tours;
module.exports.finish = finish;
