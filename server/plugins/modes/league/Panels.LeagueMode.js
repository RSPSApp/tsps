/**
 * The side panel's Summary, Info and Rank buttons (data.panels), as captured: each opens its
 * interface as the main modal with the click events on its menu frame, and the client draws the
 * rest from the varps and the league struct (LeaguePoints' points, Rank's thresholds,
 * Statistics' counters). The Summary's Time Played row shows "(Click to reveal)" until it is
 * clicked, then the character's time played: the time a league character has been online,
 * counted here (`league:play-time`, milliseconds, saved every minute and at logout), since the
 * capture's tracking_playtime_leagues varp is the league's start, not a play time. Each screen
 * asks for the content payload again before it opens, in case the client reloaded.
 */
const Common = require("./Common.LeagueMode");
const { FLAG_OP1, eventFlags } = require("../../interface/widgetGroup");

/** Time online before this session, in milliseconds. */
const PLAY_TIME_ATTRIBUTE = "league:play-time";
/** Ticks between saves of the running session, so a crash loses at most a minute. */
const FLUSH_TICKS = 100;
const MINUTE = 60000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** When each online league character's session started. */
const sessionStart = new WeakMap();
/** Players who clicked the Time Played row this session. */
const revealed = new WeakSet();
/** The repeating save of a session's play time, defined once api.core.Task is reachable. */
let FlushTask = null;

function uid(group, child) {
  return (group << 16) | child;
}

/** Milliseconds online: the saved total plus this session. */
function playTime(player) {
  const saved = Number(player.getAttribute(PLAY_TIME_ATTRIBUTE)) || 0;
  const start = sessionStart.get(player);
  return saved + (start === undefined ? 0 : Math.max(0, Date.now() - start));
}

/** The captured shape: the two largest non-zero units of days, hours and minutes ("17 days, 58 minutes"). */
function formatPlayTime(ms) {
  const units = [["day", Math.floor(ms / DAY)], ["hour", Math.floor((ms % DAY) / HOUR)], ["minute", Math.floor((ms % HOUR) / MINUTE)]];
  const shown = units.filter(([, amount]) => amount > 0).slice(0, 2);
  if (!shown.length) shown.push(units[2]);
  return shown.map(([unit, amount]) => `${amount} ${unit}${amount === 1 ? "" : "s"}`).join(", ");
}

/** Moves the session so far into the saved total. */
function flush(player) {
  if (!sessionStart.has(player)) return;
  player.setAttribute(PLAY_TIME_ATTRIBUTE, playTime(player));
  sessionStart.set(player, Date.now());
}

function startFlushing(player) {
  const manager = Common.api.getTaskManager?.();
  if (FlushTask && typeof manager?.submit === "function") manager.submit(new FlushTask(player));
}

function openModal(player, panel) {
  Common.api.emitCustomEvent("league:send-content", { player });
  Common.api.emitCustomEvent("league:modal-opening", { player, group: panel.group });
  const sender = player.getPacketSender();
  sender.sendInterfaceScript(Common.data.panels.modalSizeScript, panel.modalSize);
  sender.sendInterface(panel.group);
  if (panel.sound !== undefined) sender.sendSound(panel.sound, 1, 0);
  if (panel.menuFrame !== undefined) {
    sender.sendInterfaceFlagsRange(uid(panel.group, panel.menuFrame), panel.menuFrameSlots[0], panel.menuFrameSlots[1], FLAG_OP1);
  }
}

function openSummary({ player }) {
  if (!Common.isLeagueProfile(player)) return false;
  const panel = Common.data.panels.summary;
  openModal(player, panel);
  const row = uid(panel.group, panel.statsContent);
  const sender = player.getPacketSender();
  sender.sendInterfaceFlagsRange(row, panel.playTimeRow, panel.playTimeRow, eventFlags(panel.playTimeFlags));
  sender.sendInterfaceScript(panel.revealScript, [row, panel.playTimeRow, revealed.has(player) ? formatPlayTime(playTime(player)) : panel.hiddenText]);
  return true;
}

/** The Time Played row's click: the summary re-opens with the time shown, as captured. */
function revealPlayTime({ player, slot }) {
  if (!Common.isLeagueProfile(player) || Number(slot) !== Common.data.panels.summary.playTimeRow) return false;
  revealed.add(player);
  player.getPacketSender().sendInterfaceRemoval();
  return openSummary({ player });
}

function openInfo({ player }) {
  if (!Common.isLeagueProfile(player)) return false;
  openModal(player, Common.data.panels.info);
  return true;
}

function openRank({ player }) {
  if (!Common.isLeagueProfile(player)) return false;
  openModal(player, Common.data.panels.rank);
  return true;
}

function login({ player }) {
  sessionStart.set(player, Date.now());
  startFlushing(player);
}

function logout({ player }) {
  if (!Common.isLeagueProfile(player) || !sessionStart.has(player)) return;
  flush(player);
  sessionStart.delete(player);
}

function bind(api) {
  FlushTask = class extends api.core.Task {
    constructor(player) {
      // Not keyed to the player: a click must not cancel it.
      super(FLUSH_TICKS);
      this.player = player;
    }

    execute() {
      if (this.player.isRegistered?.() === false || !sessionStart.has(this.player)) {
        this.stop();
        return;
      }
      flush(this.player);
    }
  };
}

module.exports = function attach(api) {
  const { summary, info, rank } = Common.data.panels;
  bind(api);
  api.persistAttribute(PLAY_TIME_ATTRIBUTE, 0);
  api.onCustomEvent("league:login", login);
  api.onPlayerLogout(logout);
  api.onInterfaceActionButton(uid(summary.button[0], summary.button[1]), openSummary);
  api.onInterfaceActionButton(uid(summary.group, summary.statsContent), revealPlayTime);
  api.onInterfaceActionButton(uid(info.button[0], info.button[1]), openInfo);
  api.onInterfaceActionButton(uid(rank.button[0], rank.button[1]), openRank);
};

module.exports.formatPlayTime = formatPlayTime;
module.exports.openInfo = openInfo;
module.exports.playTime = playTime;
