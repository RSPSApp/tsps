/**
 * Pushes the idle state to the client so it can draw a HUD that is always on screen, instead of
 * only inside the Idle screen's widget group.
 *
 * It rides the content-data channel (`sendContentData`), which already carries keyed datasets to
 * the client at any moment, open interface or not. The client picks the `idle` dataset out before
 * the content store sees it: this is per-tick state, not cache content.
 *
 * Two things keep it cheap. The payload only goes when it differs from the last one sent, because
 * `Common.changed` fires every tick a character works. And the rate is a number the HUD rounds
 * itself, so a rate that drifts by a few XP an hour does not count as a change.
 */
const Common = require("./Common.IdleMode");
const Auto = require("./Auto.IdleMode");
const Combat = require("./Combat.IdleMode");
const Production = require("./Production.IdleMode");
const Offline = require("./Offline.IdleMode");
const Progression = require("./Progression.IdleMode");

const SOURCE = "idle";
const KEY = "state";
/** The last payload each player's client was given, so an unchanged tick sends nothing. */
const sent = new Map();

/** Why auto-resume has stopped, or null when it is running or switched off. */
function pausedFor(player) {
  if (player.getAttribute(Common.AUTO_ATTRIBUTE) === false) return null;
  if (player.getAttribute(Common.COMBAT_TARGET_ATTRIBUTE)) return Combat.pausedFor(player);
  if (player.getAttribute(Common.PRODUCTION_TARGET_ATTRIBUTE)) return Production.pausedFor(player);
  return Auto.pausedFor(player);
}

/** What the character is doing, as plain text, or null when nothing yet. */
function activity(player) {
  const fight = player.getAttribute(Common.COMBAT_TARGET_ATTRIBUTE);
  if (fight) return `Fighting ${fight.name.toLowerCase()}s`;
  const gather = player.getAttribute(Common.GATHER_TARGET_ATTRIBUTE);
  if (gather) return `${gather.option} ${gather.name.toLowerCase()}`;
  const make = player.getAttribute(Common.PRODUCTION_TARGET_ATTRIBUTE);
  if (make) return Production.doing(make);
  return null;
}

/**
 * The state the HUD draws. Rounded on purpose: the client decides how to word and colour it, and
 * an unrounded rate would make every tick look like a change.
 */
function state(player) {
  const { xpPerPoint } = Common.data.progression;
  const idle = Common.isIdle(player);
  const rate = Offline.currentRate(player);
  const progress = Progression.progress(player);
  return {
    idle,
    auto: player.getAttribute(Common.AUTO_ATTRIBUTE) !== false,
    paused: idle ? pausedFor(player) : null,
    activity: activity(player),
    xpPerHour: rate ? Math.round(rate.xpPerHour / 100) * 100 : null,
    points: Progression.points(player),
    // A whole percent: the bar cannot show finer than that anyway.
    nextPercent: xpPerPoint > 0 ? Math.min(100, Math.floor((progress / xpPerPoint) * 100)) : 0,
  };
}

function push(player) {
  const sender = player?.getPacketSender?.();
  // Not every connection carries the content channel (the agent MCP logs players in without a
  // client of their own), and a HUD nobody can see is not worth throwing over.
  if (typeof sender?.sendContentData !== "function") return;
  const next = state(player);
  const serialised = JSON.stringify(next);
  if (sent.get(player) === serialised) return;
  sent.set(player, serialised);
  sender.sendContentData(SOURCE, [{ key: KEY, rows: [next] }]);
}

function forget({ player }) {
  sent.delete(player);
}

module.exports = function attach(api) {
  sent.clear();
  Common.onChange(push);
  // A login has none of the attributes set yet when the handlers run, so the first push waits a
  // tick; after that `changed` carries it.
  api.onPlayerLogin(({ player }) => {
    sent.delete(player);
    push(player);
  });
  api.onPlayerLogout(forget);
};

module.exports.state = state;
module.exports.SOURCE = SOURCE;
module.exports.KEY = KEY;
