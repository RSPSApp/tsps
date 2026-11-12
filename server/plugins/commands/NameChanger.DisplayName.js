/**
 * The Account tab's Name Changer: the cache's display name screen (displayname_menu, 980), as the
 * Wiki's Account Management page describes it ("the in-game name changer"). The client's
 * displaynames_status/check/claim/cancel ops come here on the "display-names" plugin channel, and
 * each reply is the matching *_result op's values, which the screen's scripts poll:
 *   status (state, reason, message, -, maxChecks, secondsLeft): 0 none, 200 a session (script10213)
 *   check (state, reason, message, availCode, available, used, max): availCode 0 available,
 *     1 taken or reserved, 2 invalid, 3 unavailable; 403 with available = not eligible (script10202)
 *   claim (state, reason, message, code): 200 with code 0 is a changed name (script10234)
 *   cancel (state, ...): 1 while ending, then status 0 back to the start panel
 * Reasons are enum_1654's: 7 "Not eligible to change its name now", 9 invalid, 11 taken or reserved.
 * There is no recording of the screen; the states are the cache scripts'. The rules are the
 * ::displayname ones (DisplayName.plugin), passed in by the plugin.
 */
const CHANNEL = "display-names";
const INTERFACE_ID = 980; // displayname_menu
const FREE_CHANGE_UID = (INTERFACE_ID << 16) | 7; // displayname_menu:freechange
const EXTRA_CHANGES_UID = (INTERFACE_ID << 16) | 9; // displayname_menu:extrachanges
const SUBTITLES_VARBIT = "displayname_showsubtitles"; // script9775: the info rows' labels show at 1
const SESSION_MINUTES_CONFIG = "DisplayName:sessionMinutes";
const MAX_CHECKS = 250; // script10224: -1 means 250

const STATUS_NONE = 0;
const OK = 200;
const FORBIDDEN = 403;
const CONFLICT = 409;
const SESSION_ENDED = 429;
const REASON_NOT_ELIGIBLE_NOW = 7;
const REASON_INVALID = 9;
const REASON_TAKEN = 11;
const AVAILABLE = 0;
const TAKEN = 1;
const INVALID = 2;
const UNAVAILABLE = 3;

let api = null;
let rules = null;
/** Player -> { startedAt, used }: a name-check session from "Look up names" to its end. */
const sessions = new WeakMap();

/** The plugin's rules: { cleanName, problemOf(player, name, now) -> {kind, text}|null, cooldownLeft, change(player, name) -> boolean, daysText }. */
function useRules(given) {
  rules = given;
}

function attach(pluginApi) {
  api = pluginApi;
}

function reply(player, op, result) {
  player.getSession?.()?.sendClientPacket(api.core.encodePluginMessage(CHANNEL, { op, result }));
}

function sessionMs() {
  const minutes = Number(api.getPluginConfig(SESSION_MINUTES_CONFIG, 10));
  return (Number.isFinite(minutes) && minutes > 0 ? minutes : 10) * 60 * 1000;
}

function secondsLeft(session, now) {
  return Math.max(0, Math.ceil((session.startedAt + sessionMs() - now) / 1000));
}

/** Every result back to "nothing yet", so a reopened screen starts at its first panel. */
function resetResults(player) {
  reply(player, "status", [STATUS_NONE, 0, "", false, 0, 0]);
  reply(player, "check", [0, 0, "", 0, false, 0, 0]);
  reply(player, "claim", [0, 0, "", 0]);
  reply(player, "cancel", [0, 0, ""]);
}

function openNameChanger({ player }) {
  const now = Date.now();
  sessions.delete(player);
  resetResults(player);
  const sender = player.getPacketSender();
  const subtitles = api.core.CacheDefinitions.getVarbitId(SUBTITLES_VARBIT);
  if (subtitles != null) sender.sendVarbit(subtitles, 1);
  const wait = rules.cooldownLeft(player, now);
  sender.sendInterface(INTERFACE_ID);
  sender.sendString(wait > 0 ? rules.daysText(wait) : "Now", FREE_CHANGE_UID);
  sender.sendString("0", EXTRA_CHANGES_UID);
  return true;
}

function status(player, now) {
  let session = sessions.get(player);
  if (!session) {
    session = { startedAt: now, used: 0 };
    sessions.set(player, session);
  }
  reply(player, "status", [OK, 0, "", false, MAX_CHECKS, secondsLeft(session, now)]);
}

/** The session, or null after replying that it has ended. */
function liveSession(player, op, now, result) {
  const session = sessions.get(player);
  if (session && secondsLeft(session, now) > 0) return session;
  reply(player, op, result(SESSION_ENDED, "Your session has ended."));
  return null;
}

function check(player, raw, now) {
  const ended = (state, text) => [state, 0, text, 0, false, MAX_CHECKS, MAX_CHECKS];
  const session = liveSession(player, "check", now, ended);
  if (!session) return;
  session.used = Math.min(MAX_CHECKS, session.used + 1);
  const name = rules.cleanName(raw);
  const problem = rules.problemOf(player, name, now);
  const answer = (state, reason, text, code, available) => reply(player, "check",
    [state, reason, text, code, available, session.used, MAX_CHECKS]);
  if (!problem) answer(OK, 0, "", AVAILABLE, true);
  else if (problem.kind === "cooldown") answer(FORBIDDEN, REASON_NOT_ELIGIBLE_NOW, problem.text, AVAILABLE, true);
  else if (problem.kind === "invalid") answer(OK, REASON_INVALID, problem.text, INVALID, false);
  else if (problem.kind === "unavailable") answer(OK, 0, problem.text, UNAVAILABLE, false);
  else answer(OK, REASON_TAKEN, problem.text, TAKEN, false);
}

function claim(player, raw, now) {
  const ended = (state, text) => [state, 0, text, 0];
  if (!liveSession(player, "claim", now, ended)) return;
  const name = rules.cleanName(raw);
  const problem = rules.problemOf(player, name, now);
  if (problem?.kind === "cooldown") reply(player, "claim", [FORBIDDEN, REASON_NOT_ELIGIBLE_NOW, problem.text, 1]);
  else if (problem?.kind === "taken") reply(player, "claim", [CONFLICT, REASON_TAKEN, problem.text, 1]);
  else if (problem) reply(player, "claim", [FORBIDDEN, REASON_INVALID, problem.text, 1]);
  else if (rules.change(player, name)) reply(player, "claim", [OK, 0, "", 0]);
  else reply(player, "claim", [OK, 0, "", 1]);
}

function cancel(player) {
  sessions.delete(player);
  reply(player, "cancel", [1, 0, ""]);
  reply(player, "status", [STATUS_NONE, 0, "", false, 0, 0]);
  reply(player, "cancel", [0, 0, ""]);
}

function receiveRequest(event) {
  if (event.channel !== CHANNEL) return;
  event.handled = true;
  const { player, data } = event;
  const now = Date.now();
  const name = typeof data?.name === "string" ? data.name.slice(0, 64) : "";
  if (data?.op === "status") status(player, now);
  else if (data?.op === "check") check(player, name, now);
  else if (data?.op === "claim") claim(player, name, now);
  else if (data?.op === "cancel") cancel(player);
}

/** script10237: closing the screen ends its session. */
function closed({ player, interfaceId }) {
  if (interfaceId === INTERFACE_ID) sessions.delete(player);
}

function loggedOut({ player }) {
  sessions.delete(player);
}

/** "Redeem bonds" (980:11): this world has no bonds to spend on extra changes. */
function redeemBonds({ player }) {
  player.sendMessage("You have no bonds to redeem.");
  return true;
}

module.exports = {
  CHANNEL, INTERFACE_ID, BONDS_UID: (INTERFACE_ID << 16) | 11, SESSION_MINUTES_CONFIG,
  useRules, attach, openNameChanger, receiveRequest, closed, loggedOut, redeemBonds,
};
