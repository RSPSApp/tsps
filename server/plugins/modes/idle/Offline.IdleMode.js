/**
 * Offline progress for idle accounts (plugins/modes/data/idle-mode.json "offline"). While an idle
 * player gathers, the rate they really get is measured from the skills' own `storage:gather`: the
 * items and the XP between the first gather of a session and the latest. Logging out mid-session
 * keeps that rate with the account; logging back in pays the time away at that rate (up to the
 * cap, at the efficiency), the XP to the skill and the items to the bank, and says so.
 */
const Common = require("./Common.IdleMode");

/** Saved at logout: { skill (its core.Skill key), durationMs, xp, items: { itemId: amount }, loggedOutAt }. */
const AWAY_ATTRIBUTE = "idle-mode:away";

/** player -> the gathering session being measured. */
const sessions = new Map();

/**
 * Adds one gather to a session, or starts a new one (another skill, or too long since the last).
 * The first gather only sets the start: what it gave lies before the measured time.
 */
function addGather(session, { skill, itemId, amount }, now, xp, config) {
  if (!session || session.skill !== skill || now - session.lastAt > config.maxGapSeconds * 1000) {
    return { skill, firstAt: now, lastAt: now, firstXp: xp, lastXp: xp, items: {} };
  }
  session.items[itemId] = (session.items[itemId] ?? 0) + amount;
  session.lastAt = now;
  session.lastXp = xp;
  return session;
}

/** What a session at logout leaves for the time away, or null when it is too short or has ended. */
function awayFromSession(session, now, config) {
  if (!session) return null;
  const durationMs = session.lastAt - session.firstAt;
  if (durationMs < config.minSampleSeconds * 1000 || now - session.lastAt > config.maxGapSeconds * 1000) return null;
  if (Object.keys(session.items).length === 0) return null;
  return {
    skill: session.skill,
    durationMs,
    xp: Math.max(0, session.lastXp - session.firstXp),
    items: { ...session.items },
    loggedOutAt: now,
  };
}

/** The time away paid at the session's rate: { elapsedMs, paidMs, xp, items }. */
function offlineReward(away, now, config) {
  const elapsedMs = Math.max(0, now - away.loggedOutAt);
  const paidMs = Math.min(elapsedMs, config.capHours * 3600 * 1000);
  const factor = away.durationMs > 0 ? (paidMs / away.durationMs) * config.efficiency : 0;
  const items = {};
  for (const [itemId, amount] of Object.entries(away.items)) {
    const earned = Math.floor(amount * factor);
    if (earned > 0) items[itemId] = earned;
  }
  return { elapsedMs, paidMs, xp: Math.floor(away.xp * factor), items };
}

function formatDuration(ms) {
  const minutes = Math.floor(ms / 60000);
  const hours = Math.floor(minutes / 60);
  return hours > 0 ? `${hours}h ${minutes % 60}m` : `${minutes}m`;
}

function formatNumber(value) {
  return Math.floor(value).toLocaleString("en-US");
}

function measure(request) {
  const config = Common.data.offline;
  if (!config.enabled || !Common.idleGather(request.player, request.skill)) return;
  const { player } = request;
  const xp = player.getSkillManager().getExperience(request.skill);
  sessions.set(player, addGather(sessions.get(player), request, Date.now(), xp, config));
}

function logout({ player }) {
  const session = sessions.get(player);
  sessions.delete(player);
  const away = Common.data.offline.enabled ? awayFromSession(session, Date.now(), Common.data.offline) : null;
  player.setAttribute(AWAY_ATTRIBUTE, away && { ...away, skill: Common.skillKey(away.skill) });
}

/** Pays the time away, to the skill and the bank; what the bank had no room for is lost, and said. */
function login({ player }) {
  const away = player.getAttribute(AWAY_ATTRIBUTE);
  if (!away) return;
  player.setAttribute(AWAY_ATTRIBUTE, null);
  const skill = Common.core.Skill[away.skill];
  if (!skill) return;
  const reward = offlineReward(away, Date.now(), Common.data.offline);
  if (reward.xp > 0) player.getSkillManager().addExperience(skill, reward.xp, false);
  const banked = [];
  let lost = 0;
  for (const [itemId, amount] of Object.entries(reward.items)) {
    if (Common.bank(player, Number(itemId), amount)) banked.push(`${formatNumber(amount)} x ${Common.itemName(Number(itemId))}`);
    else lost += amount;
  }
  if (reward.xp <= 0 && banked.length === 0) return;
  const capped = reward.paidMs < reward.elapsedMs ? ` (capped at ${Common.data.offline.capHours}h)` : "";
  player.sendMessage(`While you were away for ${formatDuration(reward.elapsedMs)}${capped}, you kept ${Common.skillName(away.skill).toLowerCase()}:`);
  player.sendMessage(`${formatNumber(reward.xp)} ${Common.skillName(away.skill)} XP${banked.length ? `, ${banked.join(", ")} to your bank` : ""}.`);
  if (lost > 0) player.sendMessage(`Your bank was full: ${formatNumber(lost)} items were lost.`);
}

module.exports = function attach(api) {
  api.persistAttribute(AWAY_ATTRIBUTE, null);
  api.onCustomEvent("storage:gather", measure);
  api.onPlayerLogout(logout);
  api.onPlayerLogin(login);
};

module.exports.AWAY_ATTRIBUTE = AWAY_ATTRIBUTE;
module.exports.addGather = addGather;
module.exports.awayFromSession = awayFromSession;
module.exports.offlineReward = offlineReward;
module.exports.formatDuration = formatDuration;
module.exports.sessions = sessions;
