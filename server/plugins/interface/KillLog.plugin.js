/**
 * The Boss Kill Log (interface kill_log, 549): every boss's kill count and the player's streak,
 * opened from the ring of wealth's "Boss Log" and the POH adventure log's "Boss log".
 *
 *   api.emitCustomEvent("kill-log:open", { player, owner?, log: "boss" })  -> handled = true
 *
 * `owner` is whose log it is (a house's owner, for a visitor reading their adventure log).
 *
 * Rsprox captures (2905, 1001169, rev 230): the log opens as the main modal, IF_SETEVENTS gives
 * kill_log:reset op 1 on one slot per row, then script killcounts draws the rows from the names,
 * kill counts and streaks with the title "Boss Kill Log". Rev 242's script (9525) takes them as
 * a stringarray and two intarrays, plus the title and 1 to give each row its "Reset Streak" op.
 * The row list is the capture's; each row's count is its cache kill-count varp (what the boss
 * pages and the kill-count messages set). The script formats the numbers (commas, "Lots!") and a
 * negative streak as "---", which the Awakened rows have: script 1587 refuses their reset with
 * "The Awakened version of a boss shares its streak with the standard version."
 *
 * The streak is the kills since the player last reset it (the confirm box reads "Reset streak:
 * <boss>"); before any reset it is the whole count, as the capture's rows show. The client shows
 * that box itself when a row's Reset Streak is clicked; the click still reaches the server with
 * the row as its slot, and Confirm Reset then resets that row. Ours: no capture confirms a
 * reset, so the server's answer (redrawing the log) is ours.
 */
const DATA = require("./data/kill-log.json");

const STREAK_BASES_ATTRIBUTE = "kill-log:streak-bases";
/** Cache rev 242's killcounts (rsprox name; id 1584 through rev 237). */
const KILLCOUNTS_SCRIPT = 9525;
const FLAG_OP1 = 1 << 1;
const AWAKENED_STREAK = -1;

let core = null;
let ids = null;
/** The log each player has open: { owner, log, rows, pending } (pending: the row whose reset was clicked). */
const openLogs = new WeakMap();

function resolveIds() {
  if (ids) return ids;
  const defs = core.CacheDefinitions;
  ids = {
    interface: defs.getInterfaceId("kill_log"),
    reset: defs.getComponentId("kill_log:reset"),
    confirm: defs.getComponentId("kill_log:confirm_reset"),
    cancel: defs.getComponentId("kill_log:cancel_reset"),
    varps: new Map(),
  };
  for (const log of Object.values(DATA)) {
    for (const row of log.rows) ids.varps.set(row.varp, defs.getVarpId(row.varp));
  }
  return ids;
}

/** The owner's count for one row: the value of its kill-count varp. */
function kills(owner, row) {
  const varp = resolveIds().varps.get(row.varp);
  if (!Number.isInteger(varp)) return 0;
  return Math.max(0, Number(owner.getPacketSender().getVarp(varp)) || 0);
}

function streakBases(owner) {
  return owner.getAttribute(STREAK_BASES_ATTRIBUTE) ?? {};
}

/** A standard row's kills with its Awakened rows', which share its streak. */
function streakKills(owner, rows, row) {
  return rows
    .filter((other) => other === row || other.streakOf === row.name)
    .reduce((sum, other) => sum + kills(owner, other), 0);
}

function streak(owner, rows, row) {
  if (row.streakOf) return AWAKENED_STREAK;
  const base = Number(streakBases(owner)[row.name]) || 0;
  return Math.max(0, streakKills(owner, rows, row) - base);
}

function draw(player, state) {
  const { owner, rows } = state;
  const sender = player.getPacketSender();
  const canReset = owner === player ? 1 : 0;
  sender.sendClientScript(
    KILLCOUNTS_SCRIPT,
    rows.map((row) => row.name),
    rows.map((row) => kills(owner, row)),
    rows.map((row) => streak(owner, rows, row)),
    DATA[state.log].title,
    canReset,
  );
}

function openLog(event) {
  const { player, owner = player, log = "boss" } = event ?? {};
  const rows = DATA[log]?.rows;
  if (!player || !rows) return;
  const { interface: group, reset } = resolveIds();
  const sender = player.getPacketSender();
  const state = { owner, log, rows, pending: null };
  openLogs.set(player, state);
  sender.sendInterface(group);
  if (owner === player) sender.sendInterfaceFlagsRange(reset, 0, rows.length - 1, FLAG_OP1);
  draw(player, state);
  event.handled = true;
}

/** The open log, while the kill log is still the player's modal. */
function openState(player) {
  const state = openLogs.get(player);
  if (!state) return null;
  if (player.getPacketSender().isSubInterfaceOpen?.(resolveIds().interface) === false) {
    openLogs.delete(player);
    return null;
  }
  return state;
}

function chooseReset(event) {
  const state = openState(event.player);
  if (!state || state.owner !== event.player) return;
  event.handled = true;
  const row = state.rows[Number(event.slot)];
  // An Awakened row's reset is refused by the client (script 1587); it never opens the box.
  state.pending = row && !row.streakOf ? row : null;
}

function confirmReset(event) {
  const state = openState(event.player);
  if (!state) return;
  event.handled = true;
  const row = state.pending;
  state.pending = null;
  if (!row || state.owner !== event.player) return;
  const bases = { ...streakBases(event.player) };
  bases[row.name] = streakKills(event.player, state.rows, row);
  event.player.setAttribute(STREAK_BASES_ATTRIBUTE, bases);
  draw(event.player, state);
}

function cancelReset(event) {
  const state = openState(event.player);
  if (!state) return;
  event.handled = true;
  state.pending = null;
}

function init(api) {
  core = api.core;
}

module.exports = {
  name: "KillLog",
  description: "The Boss Kill Log: each boss's kill count and the player's resettable streak, opened from the ring of wealth and the POH adventure log.",
  members: true,
  STREAK_BASES_ATTRIBUTE,
  KILLCOUNTS_SCRIPT,
  register(api) {
    init(api);
    api.persistAttribute(STREAK_BASES_ATTRIBUTE, {});
    api.onCustomEvent("kill-log:open", openLog);
    api.onInterfaceActionButton(resolveIds().reset, chooseReset);
    api.onInterfaceActionButton(resolveIds().confirm, confirmReset);
    api.onInterfaceActionButton(resolveIds().cancel, cancelReset);
  },
  _test: { openLog, chooseReset, confirmReset, cancelReset, init, reset: () => { ids = null; } },
};
