/**
 * The balloon controls: the flight that opens a route from Entrana, as rsprox recording 226/01702
 * plays it (the Crafting Guild, 57 moves) and the Wiki describes it:
 *
 * - Take-off: the logs are paid, zep_if_current_map / screen_dist / balloon_height / sandbags (8)
 *   / logs (10) are set, the first screen's obstacles drawn into zep_interface's 13x20 grid (the
 *   birds, storm creatures and sharks turned to their captured IF_SETANGLE), song 206, the side
 *   tabs closed, zep_interface in the main modal and zep_interface_side beside it.
 * - Every control moves the balloon one column right: sandbags +2 (one sandbag), logs +1 (one
 *   log), relax 0, the rope -1, the red rope -2 - the counters, the height and the column, the
 *   control's sound, the balloon's two parts placed and the whoosh (3246). One move per two
 *   ticks; clicks wait their turn.
 * - The balloon fills two cells (its envelope's row and the basket's below); an obstacle in either
 *   crashes it. From column 19 of screens 1 and 2 the next move draws the next screen, at column
 *   1, after clearing every cell's model and angle. It lands from screen 3's column 19 at height
 *   5, the basket on the pad.
 * - Landing: the interfaces close as the screen goes black; a tick later the tabs come back, the
 *   route opens and 2,000 Firemaking XP; three ticks after that "You arrive safely at <place>."
 *   and the landing; the fade back in a tick later.
 * - Bail over Entrana (screen 1) lands safely there; anything else is a crash (Wiki): the logs
 *   are gone, no XP, the route still shut. A logout mid-flight loses the logs too.
 * - Enlightened Journey's own flight to Taverley ("balloon-transport:quest-flight") flies the same
 *   controls without opening a route or giving XP; a landing is told to the quest
 *   ("balloon-transport:flight-landed") once the player is moved, a crash
 *   ("balloon-transport:flight-crashed") as the screen fades back in, and a route's crashSites can
 *   name where each screen's crash comes down.
 *
 * The routes' screens are plugins/world/data/balloon-routes.json: the Crafting Guild's captured,
 * Varrock's, Castle Wars', the Grand Tree's and Taverley's transcribed from the Wiki's Balloon
 * path images, their scenery's models matched against the client's renders of the cache's.
 */
const fs = require("fs");
const path = require("path");
const Common = require("./Common.BalloonTransport");
const Storage = require("./Storage.BalloonTransport");

const FLIGHT_INTERFACE = "zep_interface";
const SIDE_INTERFACE = "zep_interface_side";
const BALLOON = "zep_interface:zep_if_balloon";
const BASKET = "zep_interface:zep_if_balloon2";
const GRID = (row, col) => `zep_interface:zep_grid_${row}_${col}`;
const MAIN_MODAL = (161 << 16) | 16;
const SIDE_MODAL = (161 << 16) | 74;
const VARBITS = { sandbags: "zep_if_sandbags", logs: "zep_if_logs", dist: "zep_if_screen_dist", height: "zep_if_balloon_height", map: "zep_if_current_map" };
const CONTROLS = {
  zep_btn_sandbags: { rise: 2, uses: "sandbags", sound: 3249 },
  zep_btn_logs: { rise: 1, uses: "logs", sound: 3251 },
  zep_btn_relax: { rise: 0, sound: 3242 },
  zep_btn_tug: { rise: -1, sound: 3241 },
  zep_btn_tug_emerg: { rise: -2, sound: 3239 },
};
const BAIL = "zep_btn_close";
const MOVE_SOUND = 3246;
const FLIGHT_SONG = 206;
const START = { sandbags: 8, logs: 10 };
const ROWS = 13;
const OBSTACLE_ROWS = 11;
const COLUMNS = 20;
const LAST_COLUMN = COLUMNS - 1;
const PAD_HEIGHT = 5;
/** Calibrated: the cloud ceiling covers rows 11-12; nothing flies lower than the ground strip. */
const MAX_HEIGHT = 10;
const MIN_HEIGHT = 2;
const MOVE_TICKS = 2;
const EMPTY_MODEL = 65535;
/** The grid cells' angle x, angle y and zoom in the cache, which a screen change puts back. */
const DEFAULT_ANGLE = [0, 0, 2576];
const MINIMAP_STATE = "minimap_state";
const MINIMAP_OFF = 2;
/** The side tabs the flight closes (combat to magic, settings, emotes); friends, account and music stay. */
const CLOSED_TABS = [[76, 0, 593], [77, 77, 320], [78, 78, 629], [79, 79, 149], [80, 80, 387], [81, 5, 541], [82, 6, -1], [87, 87, 116], [88, 88, 216]];
const SUCCESS = { closeAt: 0, routeAt: 1, landAt: 4, fadeInAt: 5, overlayAt: 8 };
const BLACK_OUT = [0, 0, 0, 0, 0];
const FADE_IN = [0, 0, 0, 255, 50];

let routes = null;
/** Players at the controls -> their flight. */
const flights = new Map();

function data() {
  routes ??= JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "balloon-routes.json"), "utf8"));
  return routes;
}

function hasRoute(station) {
  return Boolean(data().routes[station?.key]);
}

function inFlight(player) {
  return flights.has(player);
}

function cache() {
  return Common.core.CacheDefinitions;
}

function component(name) {
  return cache().getComponentId(name);
}

function setVarbit(player, name, value) {
  const id = cache().getVarbitId(name);
  if (id != null) player.getPacketSender().sendVarbit(id, value);
}

function place(player, flight) {
  const sender = player.getPacketSender();
  const x = 13 + 24 * flight.dist;
  const y = 296 - 24 * flight.height;
  sender.sendInterfacePosition(component(BALLOON), x, y);
  sender.sendInterfacePosition(component(BASKET), x, y + 24);
}

/** A screen's cells: each model, the animated ones' camera angle (IF_SETANGLE), then their animation. */
function drawScreen(player, cells) {
  const sender = player.getPacketSender();
  const angles = data().angles;
  for (const [row, col, model, anim] of cells) {
    const uid = component(GRID(row, col));
    sender.sendInterfaceRawModel(uid, model);
    const angle = angles[model];
    if (angle) sender.sendInterfaceAngle(uid, ...angle);
    if (anim != null && anim >= 0) sender.sendInterfaceAnimation(uid, anim);
  }
}

/** The next screen wipes the grid row by row: every model, then every cell's angle back to the default. */
function clearScreen(player) {
  const sender = player.getPacketSender();
  for (let row = 0; row < OBSTACLE_ROWS; row++) {
    for (let col = 0; col < COLUMNS; col++) sender.sendInterfaceRawModel(component(GRID(row, col)), EMPTY_MODEL);
  }
  for (let row = 0; row < OBSTACLE_ROWS; row++) {
    for (let col = 0; col < COLUMNS; col++) sender.sendInterfaceAngle(component(GRID(row, col)), ...DEFAULT_ANGLE);
  }
}

function occupied(flight) {
  const cells = flight.route.screens[flight.screen];
  return (row, col) => cells.some(([r, c]) => r === row && c === col);
}

function sideTabs(player, open) {
  const sender = player.getPacketSender();
  for (const [slot, tab, group] of CLOSED_TABS) {
    if (!open) sender.closeSubInterface((161 << 16) | slot);
    else sender.sendTabInterface(tab, tab === 6 ? player.getSpellbook().getInterfaceId() : group);
  }
}

/**
 * Takes off from Entrana to open `station`'s route (or, with `opensRoute` false, only to fly
 * there); `logs` were checked by the caller.
 */
function takeOff(player, station, logs, source, { opensRoute = true } = {}) {
  const route = data().routes[station.key];
  if (!route || inFlight(player)) return false;
  if (!Storage.pay(player, station, logs, source)) return false;
  Storage.tellPaid(player, station, source);
  const flight = { station, route, opensRoute, screen: 0, dist: 0, height: route.startHeight, sandbags: START.sandbags, logs: START.logs, queue: [], waiting: 0, done: false };
  flights.set(player, flight);
  const sender = player.getPacketSender();
  setVarbit(player, VARBITS.map, route.maps[0]);
  setVarbit(player, VARBITS.dist, 0);
  setVarbit(player, VARBITS.height, flight.height);
  setVarbit(player, VARBITS.sandbags, flight.sandbags);
  setVarbit(player, VARBITS.logs, flight.logs);
  drawScreen(player, route.screens[0]);
  sender.sendSong(FLIGHT_SONG);
  sideTabs(player, false);
  sender.sendInterface(cache().getInterfaceId(FLIGHT_INTERFACE));
  sender.sendSubInterface(SIDE_MODAL, cache().getInterfaceId(SIDE_INTERFACE), 0);
  place(player, flight);
  sender.sendSound(MOVE_SOUND, 1, 0);
  setVarbit(player, MINIMAP_STATE, MINIMAP_OFF);
  const movement = player.getMovementQueue();
  movement.reset();
  movement.setBlockMovement(true);
  tickLoop(player, flight);
  return true;
}

/** One move per two ticks, clicks queued (the recording's cadence). */
function tickLoop(player, flight) {
  const { Task, TaskManager } = Common.core;
  TaskManager.submit(new (class extends Task {
    constructor() {
      super(1, player, false);
    }

    execute() {
      if (flight.done || !player.isRegistered()) {
        this.stop();
        return;
      }
      if (flight.waiting > 0) flight.waiting--;
      if (flight.waiting === 0 && flight.queue.length) move(player, flight, flight.queue.shift());
    }
  })());
}

function move(player, flight, name) {
  const control = CONTROLS[name];
  if (!control) return;
  if (control.uses && flight[control.uses] <= 0) return;
  const sender = player.getPacketSender();
  if (control.uses) {
    flight[control.uses]--;
    setVarbit(player, VARBITS[control.uses], flight[control.uses]);
  }
  if (control.rise) {
    flight.height += control.rise;
    setVarbit(player, VARBITS.height, flight.height);
  }
  let redraw = false;
  if (flight.dist === LAST_COLUMN && flight.screen < flight.route.screens.length - 1) {
    flight.screen++;
    flight.dist = 1;
    setVarbit(player, VARBITS.map, flight.route.maps[flight.screen]);
    redraw = true;
  } else {
    flight.dist++;
  }
  setVarbit(player, VARBITS.dist, flight.dist);
  sender.sendSound(control.sound, 1, 0);
  if (redraw) {
    clearScreen(player);
    place(player, flight);
    drawScreen(player, flight.route.screens[flight.screen]);
  }
  place(player, flight);
  sender.sendSound(MOVE_SOUND, 1, 0);
  flight.waiting = MOVE_TICKS;
  judge(player, flight);
}

/** After a move: a crash, the landing, or flying on. */
function judge(player, flight) {
  const blocked = occupied(flight);
  const lastScreen = flight.screen === flight.route.screens.length - 1;
  const out = flight.height > MAX_HEIGHT || flight.height < MIN_HEIGHT;
  if (out || blocked(flight.height, flight.dist) || blocked(flight.height - 1, flight.dist)) return crash(player, flight);
  if (lastScreen && flight.dist === LAST_COLUMN) {
    if (flight.height === PAD_HEIGHT) return land(player, flight);
    return crash(player, flight);
  }
  if (lastScreen && flight.dist > LAST_COLUMN) crash(player, flight);
}

function closeControls(player) {
  const sender = player.getPacketSender();
  sender.closeSubInterface(MAIN_MODAL);
  sender.closeSubInterface(SIDE_MODAL);
  player.setInterfaceId?.(-1);
}

/**
 * The controls are done, but the flight stays the player's until it has set them down: no other
 * flight starts meanwhile, and its delayed steps (`owns`) stand down if the player dies or leaves.
 */
function end(player, flight) {
  flight.done = true;
}

function owns(player, flight) {
  return flights.get(player) === flight && player.isRegistered?.() !== false
    && player.isDyingReturn?.() !== true && (player.getHitpoints?.() ?? 1) > 0;
}

/** The flight is over: the player may fly again. */
function finish(player, flight) {
  if (flights.get(player) === flight) flights.delete(player);
}

function release(player) {
  player.getMovementQueue().setBlockMovement(false);
  setVarbit(player, MINIMAP_STATE, 0);
}

/** The captured landing: black, the route at T+1, the arrival at T+4, the fade back at T+5. */
function land(player, flight) {
  end(player, flight);
  closeControls(player);
  Common.fade(player, BLACK_OUT);
  const { station } = flight;
  const open = () => {
    if (flight.opened) return;
    flight.opened = true;
    sideTabs(player, true);
    release(player);
    if (!flight.opensRoute) return;
    Common.openRoute(player, station);
    player.getSkillManager().addExperience(Common.core.Skill.FIREMAKING, Common.data.unlockXp, true);
  };
  flight.arrive = () => {
    if (flight.arrived) return;
    open();
    flight.arrived = true;
    player.sendMessage(flight.route.arrive);
    player.moveTo(Common.tile(station.land));
    Common.api.emitCustomEvent("balloon-transport:flight-landed", { player, station: station.key });
  };
  Common.later(SUCCESS.routeAt, () => owns(player, flight) && open());
  Common.later(SUCCESS.landAt, () => owns(player, flight) && flight.arrive());
  Common.later(SUCCESS.fadeInAt, () => owns(player, flight) && Common.fade(player, FADE_IN));
  Common.later(SUCCESS.overlayAt, () => {
    if (owns(player, flight)) Common.closeFade(player);
    finish(player, flight);
  });
}

/** Coming down off the route (Wiki): the logs are gone, nothing opens. `crashed` is told on. */
function comeDown(player, flight, message, site, crashed) {
  end(player, flight);
  closeControls(player);
  Common.fade(player, BLACK_OUT);
  player.sendMessage(message);
  flight.arrive = () => {
    if (flight.arrived) return;
    flight.arrived = true;
    sideTabs(player, true);
    release(player);
    player.moveTo(Common.tile(data().crashSites[site]));
  };
  Common.later(SUCCESS.routeAt, () => owns(player, flight) && flight.arrive());
  // Told as the screen fades back in: a conversation started on the teleport's tick is cleared.
  Common.later(SUCCESS.landAt, () => {
    if (!owns(player, flight)) return;
    Common.fade(player, FADE_IN);
    if (crashed) Common.api.emitCustomEvent("balloon-transport:flight-crashed", { player, station: flight.station.key, screen: flight.screen, site });
  });
  Common.later(SUCCESS.overlayAt, () => {
    if (owns(player, flight)) Common.closeFade(player);
    finish(player, flight);
  });
}

/** Down on Entrana from the first screen, else the route's crash site (per screen where given). */
function crash(player, flight) {
  const { route, screen } = flight;
  comeDown(player, flight, CRASHED, route.crashSites?.[screen] ?? (screen === 0 ? "entrana" : route.crashSite), true);
}

/** Bail: over Entrana it lands safely; past it the balloon crashes. */
function bail(player, flight) {
  if (flight.screen === 0) comeDown(player, flight, BAILED, "entrana");
  else crash(player, flight);
}

const CRASHED = "The balloon crashes.";
const BAILED = "You bail, but land safely on Entrana.";

function controlClick(event) {
  const buttonId = Number(event.buttonId ?? 0);
  const group = event.groupId ?? (buttonId >>> 16);
  if (group !== cache().getInterfaceId(SIDE_INTERFACE)) return;
  const flight = flights.get(event.player);
  if (!flight || flight.done) return;
  const child = event.childId ?? (buttonId & 0xffff);
  const name = [...Object.keys(CONTROLS), BAIL].find((button) => (component(`${SIDE_INTERFACE}:${button}`) & 0xffff) === child);
  if (!name) return;
  event.handled = true;
  if (name === BAIL) return bail(event.player, flight);
  flight.queue.push(name);
  if (flight.waiting === 0) move(event.player, flight, flight.queue.shift());
}

/**
 * Logging out at the controls loses the logs (Wiki); the player was never moved off Entrana. Mid
 * landing, they're set down at once, so the save is where the flight was taking them.
 */
function logout({ player }) {
  const flight = flights.get(player);
  if (!flight) return;
  if (flight.done) flight.arrive?.();
  end(player, flight);
  finish(player, flight);
}

/**
 * Enlightened Journey's flight ({ player, station, logs, source }): the quest checked the logs and
 * tinderbox; they are paid from `source`, or the other place if it hasn't enough. Its conversation
 * closes the main interface as it ends, so the balloon takes off the tick after.
 */
function questFlight({ player, station: key, logs, source }) {
  const station = Common.data.stations.find((entry) => entry.key === key);
  if (!station) return;
  const other = source === Storage.STORAGE ? Storage.INVENTORY : Storage.STORAGE;
  const options = { opensRoute: false };
  Common.later(1, () => {
    if (player.isRegistered()) takeOff(player, station, logs, source, options) || takeOff(player, station, logs, other, options);
  });
}

function attach(api) {
  api.onInterfaceActionClick(controlClick);
  api.onPlayerLogout(logout);
  api.onCustomEvent("balloon-transport:quest-flight", questFlight);
}

module.exports = { attach, takeOff, controlClick, logout, questFlight, inFlight, hasRoute, data, CONTROLS, ROWS, COLUMNS };
