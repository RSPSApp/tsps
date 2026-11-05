/**
 * Completing a task: the client's completion bit (script 9470 reads bit position % 32 of the
 * completion varps) goes out first, so the redraw LeaguePoints' points varp causes shows the
 * tick, then LeaguePoints awards the points (its varps and popup), then the captured game
 * message, then `league:task-completed` { player, league, id, pactTask } for what else it gives.
 * Other plugins complete a task with `league:complete-task` { player, id }; the award itself stays
 * LeaguePoints' and is idempotent. Every points change re-syncs the bits from the
 * saved tasks, whatever awarded them (an ad-hoc `::leaguetask` id has no bit).
 */
const Common = require("./Common.LeagueTasks");

const BITS_PER_VARP = 32;
/** Player -> the completion varp values last sent, by varp position. */
const lastSent = new WeakMap();
/** The completion varps in position order (set once at attach). */
let VARPS = [];

function completionVarps() {
  const varps = [];
  for (const [first, last] of Common.data.completionVarps) {
    for (let id = first; id <= last; id++) varps.push(id);
  }
  return varps;
}

/** The completion varp values for a set of task ids. */
function bitsOf(type, ids) {
  const { byId } = Common.catalog(type);
  const values = new Array(VARPS.length).fill(0);
  for (const id of ids) {
    const task = byId.get(String(id));
    if (!task) continue;
    const slot = Math.floor(task.index / BITS_PER_VARP);
    if (slot < values.length) values[slot] |= 1 << (task.index % BITS_PER_VARP);
  }
  return values;
}

/** Sends the varps whose value changed since the last send (every one on `all`). */
function sendBits(player, values, { all = false } = {}) {
  const previous = lastSent.get(player) ?? [];
  const sender = player.getPacketSender();
  VARPS.forEach((varp, slot) => {
    if (all || previous[slot] !== values[slot]) sender.sendConfig(varp, values[slot]);
  });
  lastSent.set(player, values);
}

function syncBits(player, type, options) {
  sendBits(player, bitsOf(type, Common.completedIds(player)), options);
}

/**
 * Completes a task of the character's league once; false when it isn't one, isn't in the league or
 * is done. `type` is the league a caller already looked up, else it is asked for here.
 */
function complete(player, id, type = Common.leagueOf(player)) {
  if (type === null) return false;
  const task = Common.task(type, id);
  if (!task) return false;
  const completed = Common.completedIds(player);
  if (completed.includes(task.id)) return false;
  sendBits(player, bitsOf(type, [...completed, task.id]));
  const award = { player, id: task.id, points: task.points, name: task.name, awarded: false };
  Common.api.emitCustomEvent("league:award-task", award);
  if (!award.awarded) return false;
  const tier = Common.tierName(task.tier).toLowerCase();
  player.sendMessage(Common.message("completed", {
    article: /^[aeiou]/.test(tier) ? "an" : "a", tier, colour: Common.colourOf(type), name: task.name,
  }));
  // After the captured line: what a task's completion gives beyond its points (Demonic Pacts' pact point).
  Common.api.emitCustomEvent("league:task-completed", { player, league: type, id: task.id, pactTask: task.pactTask === true });
  return true;
}

/** `league:complete-task` { player, id } -> found (the id is a task of the character's league), completed (awarded now). */
function completeRequest(request) {
  if (!request?.player) return;
  const type = Common.leagueOf(request.player);
  request.found = type !== null && Common.task(type, request.id) !== null;
  request.completed = request.found ? complete(request.player, request.id, type) : false;
}

function pointsChanged({ player }) {
  const type = Common.leagueOf(player);
  if (type !== null) syncBits(player, type);
}

function login({ player, league }) {
  if (Common.catalog(league)) syncBits(player, league, { all: true });
}

module.exports = function attach(api) {
  VARPS = completionVarps();
  api.onCustomEvent("league:complete-task", completeRequest);
  api.onCustomEvent("league:points-changed", pointsChanged);
  api.onCustomEvent("league:login", login);
};

module.exports.complete = complete;
