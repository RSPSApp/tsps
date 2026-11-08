// A Barracuda Trial run, as live (rsprox, all three trials; docs/barracuda-trials.md):
//   start (rank chosen at tick T): T fade out; T+1 the timer varps, the rank, the lost supplies,
//   the master's form, "You prepare to begin the X..." and "The timer will start as soon as your
//   boat begins to move.", the boat teleported to the start and stopped, the hint arrow, "Test
//   Your Sails" (unlocked the first time), fade in and the first HUD update; T+2 the HUD (931) and
//   its reset button. The boat waits moored (move mode 4: sound 10833 and the sail button off if
//   it was sailing); the timer starts on the tick the player sets the sails.
//   every tick: the HUD (script 8605: trial, its two counters, crates, its flag, rank, target,
//   objectives and crates needed, its string, the clock), lost supplies, the trial's own goings-on,
//   out of bounds.
//   completion (all objectives and crates, last one at F): F+2 the HUD closes and the screen
//   fades (the HUD updates go on to F+2); F+3 the boat moored, the count, the rank's first time, the best time, "You have completed the X (and
//   achieved the Y rank).", "Time: M:SS.ss (new personal best).", the count message, the first
//   rank's bonus XP and reward, then the boat back at the start, stopped. The trial's XP is paid
//   whatever the time; the rank only within its limit (ticks from the timer's start, at most).
//   "Test Your Sails" then the area's track again; F+4 the boat stopped (sound 10837), fade gone.
//   An exit: the HUD closes and the screen fades a tick after the answer, and the next tick the
//   variables clear, the area's track plays and the screen fades back in.
//   reset button: op1 a menu (restart, exit, stay), op2 an instant restart ("You reset your
//   progress in the X."), op3 an exit menu.
// Ours (not captured): out of bounds for 17 ticks (10 seconds) ends the run as an exit would.
const common = require("./Common.BarracudaTrials");
const ships = require("./Ships.BarracudaTrials");
const { fade, MOVE_MODE, VARBIT } = require("../SailingContent.Sailing");
const { BoatMoveMode } = require("../../../../src/main/typescript/elvarg/game/content/sailing/Boat");
const OVERLAY_ATMOSPHERE = (161 << 16) | 1;
const helm = require("../Helm.plugin");

const HUD_GROUP = 931;
const HUD_RESET = 7;
const OVERLAY_HUD = (161 << 16) | 8;
const SCRIPT_HUD_UPDATE = 8605;
const FADE_CYCLES = 15;
const SONG_TRIALS = 835;
const SOUND_UNMOOR = 10837;
const SOUND_COMPLETE = [10833, 2655];
/** current_hint_arrow: 6 while the trial's arrow is up (rsprox). */
const HINT_SLOT = 6;
const OUT_OF_BOUNDS_TICKS = 17;
const IF_EVENT_OP = (op) => 1 << op;

/** Each trial's own mechanics (Tempor/Jubbly/Gwenith units), by trial key. */
const mechanics = new Map();

function registerMechanic(key, mechanic) {
  mechanics.set(key, mechanic);
}

function sender(player) {
  return player.getPacketSender();
}

function later(player, ticks, action) {
  const { CountdownTask, TaskManager } = common.core();
  TaskManager.submit(new CountdownTask(player, ticks, action));
}

function ownBoat(player) {
  return common.core().Sailing.instanceAboard(player);
}

function message(player, text) {
  player.sendMessage(text);
}

/** The trial's arrow over its boat (the rum or toad boat), or none (the Gwenith Glide). */
function sendHint(player, run) {
  const hint = run.trial.hint;
  const index = hint && ships.entityIndex(hint.ship);
  if (index === undefined) return;
  sender(player).sendVarbit(common.varbit("current_hint_arrow"), HINT_SLOT);
  sender(player).sendWorldEntityHint(index, hint.height);
}

function clearHint(player) {
  sender(player).sendVarbit(common.varbit("current_hint_arrow"), 0);
  sender(player).clearHintArrow();
}

/** The run's state variables at the start (or a restart). */
function sendStart(player, run) {
  const out = sender(player);
  const { trial, rank } = run;
  out.sendConfig(common.varp("sailing_bt_time_generated"), run.generated);
  out.sendVarbit(common.varbit("sailing_bt_in_trial"), rank + 1);
  for (let k = 0; k < run.rankData.supplies; k++) out.sendVarbit(common.varbit(`sailing_bt_objective${k}`), 1);
  out.sendVarbit(common.trialVarbit(trial, "master_state"), 2);
  common.updateProgress(player, trial, (saved) => { saved.previous = rank + 1; });
  out.sendVarbit(common.trialVarbit(trial, "previous_attempt"), rank + 1);
}

/**
 * The boat waits moored (move mode 4) for the run: the sails come down with their sound and the
 * sail button off only if they were up (rsprox: a stopped boat just goes 0 -> 4).
 */
function moor(player, boat) {
  if (boat.moveMode !== BoatMoveMode.Stopped) {
    helm.setSailMode(player, boat, "stop");
  }
  sender(player).sendVarbit(VARBIT.SIDEPANEL_BOAT_MOVE_MODE, MOVE_MODE.MOORED);
}

function placeBoat(player, run) {
  const boat = ownBoat(player);
  if (!boat) return;
  run.boat = boat;
  moor(player, boat);
  // The catcher's motes go at the start (rsprox 907 11701).
  require("../WindCatcher.Helm").empty(player);
  common.core().BoatManager.teleport(boat, run.trial.start);
  // Moored at the start: the way it had under full sail is lost, or it drifts before the timer starts.
  boat.velocity = 0;
  common.clearSpeed(boat);
}

/**
 * Start-trial, Start-previous-rank and the scoreboards stop the boat on the click (rsprox: move
 * mode to 0, with the sails' lowering only if they were up).
 */
function stopBoat(player) {
  const boat = ownBoat(player);
  if (!boat) return;
  if (boat.moveMode !== BoatMoveMode.Stopped) helm.setSailMode(player, boat, "stop");
  else sender(player).sendVarbit(VARBIT.SIDEPANEL_BOAT_MOVE_MODE, MOVE_MODE.STOPPED);
}

/** The area's own track again after "Test Your Sails" (rsprox: right after 835 at the end). */
function areaSong(player) {
  const { BoatManager, Music } = common.core();
  const at = BoatManager.rootLocation(player);
  const track = Music.forRegion(((at.getX() >> 6) << 8) | (at.getY() >> 6));
  if (track !== undefined) sender(player).sendSong(track);
}

function freshRun(trial, rank) {
  return {
    trial,
    rank,
    rankData: common.ranksOf(trial)[rank],
    generated: common.clock(),
    timerStart: 0,
    crates: 0,
    remaining: new Set(),
    finishing: false,
    outOfBounds: 0,
    state: {},
  };
}

/** Starts a run at a rank (0 unranked to 3 Marlin): fades, places the boat, opens the HUD. */
function start(player, trial, rank, { restart = false } = {}) {
  const run = freshRun(trial, rank);
  for (let k = 0; k < run.rankData.supplies; k++) run.remaining.add(k);
  common.runs.set(player, run);
  const out = sender(player);
  out.sendInterfaceRemoval();
  fade(player, true, FADE_CYCLES);
  later(player, 1, () => {
    if (common.runs.get(player) !== run) return;
    run.generated = common.clock();
    sendStart(player, run);
    if (restart) message(player, `You reset your progress in the ${common.blue(trial.name)}.`);
    else {
      message(player, `You prepare to begin the ${common.blue(trial.name)}...`);
      message(player, "The timer will start as soon as your boat begins to move.");
    }
    placeBoat(player, run);
    mechanics.get(trial.key)?.start?.(player, run);
    sendHint(player, run);
    common.api().emitCustomEvent("music:unlock-track", { player, trackId: SONG_TRIALS });
    out.sendSong(SONG_TRIALS);
    fade(player, false, FADE_CYCLES);
    run.started = true;
    sendHud(player, run);
  });
  later(player, 2, () => {
    if (common.runs.get(player) !== run) return;
    out.closeSubInterface(OVERLAY_ATMOSPHERE);
    openHud(player);
  });
  return run;
}

/** The timer starts on the tick the player gets the boat moving (rsprox: time_start with move mode 4 -> 2). */
function startTimer(player, run, boat) {
  if (run.timing || !run.started || boat.moveMode === BoatMoveMode.Stopped) return;
  run.timing = true;
  run.timerStart = common.clock();
  sender(player).sendConfig(common.varp("sailing_bt_time_start"), run.timerStart);
}

/** Script 8605 with the run's progress (the trial's counters, flag and string from its mechanic). */
function sendHud(player, run) {
  const { trial, rankData, rank } = run;
  if (!run.started || run.hudAt === common.clock()) return;
  run.hudAt = common.clock();
  const [first = 0, second = 0, flag = 0, text = ""] = mechanics.get(trial.key)?.hud?.(player, run) ?? [];
  sender(player).sendClientScript(SCRIPT_HUD_UPDATE, trial.dbrow, first, second, run.crates, flag, rank,
    rankData.limitTicks, rankData.objectives, rankData.supplies, text, common.clock());
}

/** Clears the run's variables and HUD: on completion, an exit, leaving the boat or logging out. */
function clear(player, run, { packets = true } = {}) {
  if (common.runs.get(player) === run) common.runs.delete(player);
  mechanics.get(run.trial.key)?.end?.(player, run, { packets });
  const boat = ownBoat(player);
  if (boat) common.clearSpeed(boat);
  if (!packets) return;
  const out = sender(player);
  out.sendConfig(common.varp("sailing_bt_time_start"), 0);
  out.sendConfig(common.varp("sailing_bt_time_generated"), 0);
  out.sendVarbit(common.varbit("sailing_bt_in_trial"), 0);
  for (let k = 0; k < run.rankData.supplies; k++) out.sendVarbit(common.varbit(`sailing_bt_objective${k}`), 0);
  out.sendVarbit(common.trialVarbit(run.trial, "master_state"), common.masterState(player, run.trial));
  clearHint(player);
  closeHud(player);
}

/** The HUD (931) and its reset button. */
function openHud(player) {
  const out = sender(player);
  out.sendSubInterface(OVERLAY_HUD, HUD_GROUP, 1);
  out.sendInterfaceFlagsRange((HUD_GROUP << 16) | HUD_RESET, 0, 1, IF_EVENT_OP(1) | IF_EVENT_OP(2) | IF_EVENT_OP(3));
}

function closeHud(player) {
  sender(player).closeSubInterface(OVERLAY_HUD);
}

/** Leaves the trial where the boat is (the reset menu's exit, out of bounds too long). */
function exit(player, run, text) {
  run.finishing = true;
  later(player, 1, () => {
    if (common.runs.get(player) !== run) return;
    closeHud(player);
    fade(player, true, FADE_CYCLES);
  });
  later(player, 2, () => {
    if (common.runs.get(player) !== run) return;
    clear(player, run);
    if (text) message(player, text);
    out(player).sendSong(SONG_TRIALS);
    areaSong(player);
    fade(player, false, FADE_CYCLES);
  });
  later(player, 4, () => sender(player).closeSubInterface(OVERLAY_ATMOSPHERE));
}

function out(player) {
  return sender(player);
}

/** An instant restart from the start (the reset button's op2, or the menu's yes). */
function restart(player, run) {
  clear(player, run);
  start(player, run.trial, run.rank, { restart: true });
}

/** The objectives are done: the HUD closes 2 ticks later, the completion comes on the 3rd. */
function finish(player, run) {
  if (run.finishing) return;
  run.finishing = true;
  later(player, 2, () => {
    if (common.runs.get(player) !== run) return;
    closeHud(player);
    fade(player, true, FADE_CYCLES);
  });
  later(player, 3, () => {
    if (common.runs.get(player) !== run) return;
    complete(player, run, common.clock() - run.timerStart);
  });
}

function complete(player, run, ticks) {
  const { Item, Skill } = common.core();
  const { trial, rank, rankData } = run;
  const out = sender(player);
  const achieved = rank > 0 && ticks <= rankData.limitTicks;
  const before = common.trialProgress(player, trial);
  const firstTime = achieved && !before.firsts[rank - 1];
  const best = achieved && (before.pbs[rank - 1] === 0 || ticks < before.pbs[rank - 1]);
  const saved = common.updateProgress(player, trial, (next) => {
    next.count += 1;
    if (firstTime) next.firsts[rank - 1] = true;
    if (best) next.pbs[rank - 1] = ticks;
  });
  out.sendConfig(common.varp(`sailing_bt_trial_${trial.key}_completed`), saved.count);
  if (firstTime) out.sendVarbit(common.trialVarbit(trial, `${common.RANK_KEYS[rank]}_first`), 1);
  if (best) out.sendVarbit(common.trialVarbit(trial, `pb_${common.RANK_KEYS[rank]}`), ticks);
  message(player, achieved
    ? `You have completed the ${common.blue(trial.name)} and achieved the ${common.blue(`${rankData.name} rank`)}.`
    : `You have completed the ${common.blue(trial.name)}.`);
  message(player, `Time: ${common.blue(common.formatTicks(ticks))}${best ? " (new personal best)" : ""}.`);
  message(player, `Your ${trial.name} completion count is: ${common.blue(saved.count)}`);
  let xp = rankData.xp;
  if (firstTime) {
    xp += rankData.bonusXp;
    message(player, `You receive an additional ${common.blue(`${rankData.bonusXp.toLocaleString("en-GB")} XP`)} for reaching a new Barracuda rank!`);
  }
  if (firstTime && rankData.reward > 0) {
    common.api().emitCustomEvent("collection-log:obtain", { player, itemId: rankData.reward });
    const name = common.core().CacheDefinitions.getItem(rankData.reward)?.name ?? "a reward";
    message(player, `You receive a reward for reaching a new Barracuda rank: ${common.blue(name)}!`);
    const inventory = player.getInventory();
    // Ours: with no room it waits with the master ("Do I have any rewards to claim?").
    if (inventory.getFreeSlots() > 0) inventory.addItem(new Item(rankData.reward, 1));
  }
  common.api().emitCustomEvent("barracuda-trials:completed", { player, trial, rank, ticks, achieved });
  clear(player, run);
  const boat = ownBoat(player);
  if (boat) {
    boat.moveMode = BoatMoveMode.Stopped;
    out.sendVarbit(VARBIT.SIDEPANEL_BOAT_MOVE_MODE, MOVE_MODE.MOORED);
    out.sendVarbit(VARBIT.SIDEPANEL_SAIL_BUTTON_TOGGLED, 0);
    common.core().BoatManager.teleport(boat, { fineX: trial.start.fineX, fineY: trial.start.fineY });
    boat.velocity = 0;
  }
  for (const sound of SOUND_COMPLETE) out.sendSoundEffect(sound, 1, 0);
  out.sendSong(SONG_TRIALS);
  areaSong(player);
  fade(player, false, FADE_CYCLES);
  player.getSkillManager().addExperiences(Skill.SAILING, xp);
  later(player, 1, () => {
    if (common.runs.has(player)) return;
    out.sendVarbit(VARBIT.SIDEPANEL_BOAT_MOVE_MODE, MOVE_MODE.STOPPED);
    out.sendSoundEffect(SOUND_UNMOOR, 1, 0);
    out.closeSubInterface(OVERLAY_ATMOSPHERE);
  });
}

/** One tick of every run: supplies, the trial's own tick, bounds, completion, the HUD. */
function tickRuns() {
  for (const [player, run] of [...common.runs]) {
    if (!player.isRegistered?.() || ownBoat(player) === undefined) {
      clear(player, run, { packets: player.isRegistered?.() !== false });
      continue;
    }
    if (run.finishing) {
      runTimers(run);
      sendHud(player, run);
      continue;
    }
    const boat = ownBoat(player);
    startTimer(player, run, boat);
    if (run.timing) {
      require("./Supplies.BarracudaTrials").collect(player, run, boat);
      mechanics.get(run.trial.key)?.tick?.(player, run, boat);
      if (!checkBounds(player, run, boat)) continue;
    }
    if (common.runs.get(player) !== run) continue;
    if (run.remaining.size === 0 && mechanics.get(run.trial.key)?.done?.(player, run)) finish(player, run);
    sendHud(player, run);
  }
}

/** A finishing run's mechanic timers (the portal overlay's close, a bird flying off) still fire. */
function runTimers(run) {
  const timers = run.state?.timers;
  if (!timers?.length) return;
  const now = common.clock();
  run.state.timers = timers.filter((timer) => timer.due > now);
  for (const timer of timers) if (timer.due <= now) timer.action();
}

/** Out of bounds: the warning once, and ours: back within 10 seconds or the run ends. */
function checkBounds(player, run, boat) {
  if (common.inBounds(run.trial, boat.tileX, boat.tileY)) {
    run.outOfBounds = 0;
    return true;
  }
  run.outOfBounds++;
  if (run.outOfBounds === 1) {
    message(player, `<col=ff3045>You are out of bounds for the ${run.trial.name}. Return within 10 seconds or your progress will be lost.`);
    sender(player).sendSong(SONG_TRIALS);
  }
  if (run.outOfBounds < OUT_OF_BOUNDS_TICKS) return true;
  exit(player, run, `<col=ff3045>You didn't return in time, so your progress in the ${run.trial.name} has been lost.`);
  return false;
}

const RESET_TITLE = "Restart this Barracuda Trial? Your progress will be lost.";
const EXIT_TITLE = "Exit this Barracuda Trial? Your progress will be lost.";

function clickHud(event) {
  if (event.groupId !== HUD_GROUP || event.childId !== HUD_RESET) return;
  const { player } = event;
  const run = common.runs.get(player);
  event.handled = true;
  if (!run || run.finishing) return;
  const op = event.action;
  if (op === 2) return restart(player, run);
  const api = common.api();
  if (op === 3) {
    api.sendMultiChatboxPrompt(player, EXIT_TITLE,
      "Yes.", () => common.runs.get(player) === run && exit(player, run),
      "No.", () => {});
    return;
  }
  api.sendMultiChatboxPrompt(player, RESET_TITLE,
    "Yes, restart the trial.", () => common.runs.get(player) === run && restart(player, run),
    "No, exit the trial instead.", () => common.runs.get(player) === run && exit(player, run),
    "No, remain in the trial.", () => {});
}

function onLogin({ player }) {
  common.sendProgress(player);
}

function onLogout({ player }) {
  const run = common.runs.get(player);
  if (run) clear(player, run, { packets: false });
}

function onLeft({ player }) {
  const run = common.runs.get(player);
  if (!run) return;
  clear(player, run);
  // A tick on, from wherever they ended up (a sunk boat's player is back at the dock).
  later(player, 1, () => areaSong(player));
}

function attach(api) {
  common.init(api);
  api.persistAttribute(common.PROGRESS_ATTRIBUTE, {});
  api.onPlayerLogin(onLogin);
  api.onPlayerLogout(onLogout);
  api.onCustomEvent("sailing:left", onLeft);
  api.onInterfaceActionClick(clickHud);
  common.core().BoatManager.onAfterTick(tickRuns);
}

module.exports = attach;
module.exports.start = start;
module.exports.finish = finish;
module.exports.exit = exit;
module.exports.restart = restart;
module.exports.registerMechanic = registerMechanic;
module.exports.sendHint = sendHint;
module.exports.clearHint = clearHint;
module.exports.sendHud = sendHud;
module.exports.stopBoat = stopBoat;
module.exports.openHud = openHud;
module.exports.closeHud = closeHud;
module.exports.tickRuns = tickRuns;
module.exports.complete = complete;
