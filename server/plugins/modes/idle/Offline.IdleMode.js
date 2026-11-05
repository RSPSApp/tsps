/**
 * Offline progress for idle accounts (plugins/modes/data/idle-mode.json "offline"). While an idle
 * player works, the rate they really get is measured from their own results: each gather of an
 * idle skill (`storage:gather`) and each idle kill's loot (Combat) records the items and the
 * activity's skills' XP. A session runs from its first record to its latest. Logging out
 * mid-session keeps that rate with the account; logging back in pays the time away at that rate
 * (up to the cap, at the efficiency), the XP to the skills and the items to the bank, and says so.
 * The saved rate is also kept current on every result, so a server restart or crash (no logout)
 * still pays the time away from the last save.
 */
const Common = require("./Common.IdleMode");
const Progression = require("./Progression.IdleMode");

/**
 * Saved at logout: { activity, durationMs, xp: { skillKey: xp }, items: { itemId: amount },
 * loggedOutAt }. `activity` is the gathering skill's key ("WOODCUTTING") or "COMBAT".
 */
const AWAY_ATTRIBUTE = "idle-mode:away";
/** Saved: what the last time away paid, as the login message said it (the Idle screen shows it). */
const LAST_AWAY_ATTRIBUTE = "idle-mode:last-away";

/**
 * Saved: what idle play has added up to, for the Idle screen and the journal:
 * { workedMs (time spent gathering or fighting online), offlineMs (time away paid), xp, items,
 * bySkill: { skillKey: xp }, byItem: { itemId: amount } }.
 */
const TOTALS_ATTRIBUTE = "idle-mode:totals";

/** player -> the session being measured. */
const sessions = new Map();
/** Called with (player, reward) after a login paid time away (the Idle screen opens). */
const paidListeners = [];

function onPaid(listener) {
  paidListeners.push(listener);
}

const sum = (values) => Object.values(values ?? {}).reduce((total, value) => total + (Number(value) || 0), 0);

function totals(player) {
  const saved = player.getAttribute(TOTALS_ATTRIBUTE) ?? {};
  return { workedMs: 0, offlineMs: 0, xp: 0, items: 0, ...saved, bySkill: { ...saved.bySkill }, byItem: { ...saved.byItem } };
}

function addInto(target, values) {
  for (const [key, value] of Object.entries(values ?? {})) {
    if (value > 0) target[key] = (target[key] ?? 0) + value;
  }
}

/** Called with (player, { activity, workedMs, offlineMs, xp, items }) whenever the totals grow (Goals). */
const totalsListeners = [];

function onTotals(listener) {
  totalsListeners.push(listener);
}

/**
 * Adds to the totals: time, and the XP by skill ({ skillKey: xp }) and items ({ itemId: n }) of
 * `activity` (a skill's key, or "COMBAT"), and tells the listeners.
 */
function addTotals(player, { activity = null, workedMs = 0, offlineMs = 0, xp = {}, items = {} }) {
  for (const listener of totalsListeners) listener(player, { activity, workedMs, offlineMs, xp, items });
  const current = totals(player);
  addInto(current.bySkill, xp);
  addInto(current.byItem, items);
  player.setAttribute(TOTALS_ATTRIBUTE, {
    workedMs: current.workedMs + workedMs, offlineMs: current.offlineMs + offlineMs,
    xp: current.xp + sum(xp), items: current.items + sum(items), bySkill: current.bySkill, byItem: current.byItem,
  });
}

/** The XP per hour of the session being played now, or null when there is none long enough. */
function currentRate(player, now = Date.now()) {
  const session = sessions.get(player);
  const config = Common.data.offline;
  if (!session) return null;
  const durationMs = session.lastAt - session.firstAt;
  const maxGapSeconds = session.maxGapSeconds ?? config.maxGapSeconds;
  if (durationMs < config.minSampleSeconds * 1000 || now - session.lastAt > maxGapSeconds * 1000) return null;
  return { activity: session.activity, xpPerHour: ((sum(session.lastXp) - sum(session.firstXp)) / durationMs) * 3600000 };
}

/**
 * Adds one result to a session, or starts a new one (another activity, or more than the
 * activity's `maxGapSeconds` since the last). `xp` is { skillKey: total XP now } for the
 * activity's skills. The first result only
 * sets the start: what it gave lies before the measured time.
 */
function addResult(session, result, now, xp, config) {
  const { activity, items } = result;
  const maxGapSeconds = result.maxGapSeconds ?? config.maxGapSeconds;
  if (!session || session.activity !== activity || now - session.lastAt > session.maxGapSeconds * 1000) {
    return { activity, maxGapSeconds, firstAt: now, lastAt: now, firstXp: { ...xp }, lastXp: { ...xp }, items: {}, consumed: {} };
  }
  for (const [itemId, amount] of Object.entries(items)) {
    if (amount > 0) session.items[itemId] = (session.items[itemId] ?? 0) + amount;
  }
  session.lastAt = now;
  session.lastXp = { ...xp };
  return session;
}

/** What a session at logout leaves for the time away, or null when it is too short or has ended. */
function awayFromSession(session, now, config) {
  if (!session) return null;
  const durationMs = session.lastAt - session.firstAt;
  const maxGapSeconds = session.maxGapSeconds ?? config.maxGapSeconds;
  if (durationMs < config.minSampleSeconds * 1000 || now - session.lastAt > maxGapSeconds * 1000) return null;
  const xp = {};
  for (const [key, total] of Object.entries(session.lastXp)) {
    const gained = total - (session.firstXp[key] ?? total);
    if (gained > 0) xp[key] = gained;
  }
  if (Object.keys(session.items).length === 0 && Object.keys(xp).length === 0) return null;
  const away = { activity: session.activity, durationMs, xp, items: { ...session.items }, loggedOutAt: now };
  // Production's materials: what the session used, paid offline from the bank (Production).
  if (Object.keys(session.consumed ?? {}).length > 0) away.consumed = { ...session.consumed };
  return away;
}

/**
 * The time away paid at the session's rate: { elapsedMs, paidMs, xp, items, consumed, ranOut }.
 * `config.bonus` is an extra share of the items (Bountiful Harvest's expected extras), with no XP.
 * A session that used materials (`away.consumed`) is paid only as far as `config.stock` (what the
 * bank holds of each) lasts: `consumed` is what to take, `ranOut` the item that ran out first.
 */
function offlineReward(away, now, config) {
  const elapsedMs = Math.max(0, now - away.loggedOutAt);
  let paidMs = Math.min(elapsedMs, config.capHours * 3600 * 1000);
  let factor = away.durationMs > 0 ? (paidMs / away.durationMs) * config.efficiency : 0;
  let ranOut = null;
  for (const [itemId, used] of Object.entries(away.consumed ?? {})) {
    if (!(used > 0)) continue;
    const lasts = (config.stock?.[itemId] ?? 0) / used;
    if (lasts < factor) {
      factor = lasts;
      ranOut = Number(itemId);
    }
  }
  if (ranOut !== null) paidMs = Math.min(paidMs, Math.floor((factor / config.efficiency) * away.durationMs));
  const consumed = {};
  for (const [itemId, used] of Object.entries(away.consumed ?? {})) {
    const taken = Math.floor(used * factor);
    if (taken > 0) consumed[itemId] = taken;
  }
  const items = {};
  for (const [itemId, amount] of Object.entries(away.items)) {
    const earned = Math.floor(amount * factor * (1 + (config.bonus ?? 0)));
    if (earned > 0) items[itemId] = earned;
  }
  const xp = {};
  for (const [key, amount] of Object.entries(away.xp)) {
    const earned = Math.floor(amount * factor);
    if (earned > 0) xp[key] = earned;
  }
  return { elapsedMs, paidMs, xp, items, consumed, ranOut };
}

function formatDuration(ms) {
  const minutes = Math.floor(ms / 60000);
  const hours = Math.floor(minutes / 60);
  return hours > 0 ? `${hours}h ${minutes % 60}m` : `${minutes}m`;
}

function formatNumber(value) {
  return Math.floor(value).toLocaleString("en-US");
}

function xpNow(player, skills) {
  const xp = {};
  for (const skill of skills) {
    const key = Common.skillKey(skill);
    if (key) xp[key] = player.getSkillManager().getExperience(skill);
  }
  return xp;
}

/**
 * Production's materials used since the last restock ({ itemId: amount }), for the session of
 * `activity` being played; kept in the saved time away like the rest.
 */
function consume(player, activity, used) {
  const session = sessions.get(player);
  if (!session || session.activity !== activity) return;
  for (const [itemId, amount] of Object.entries(used)) {
    if (amount > 0) session.consumed[itemId] = (session.consumed[itemId] ?? 0) + amount;
  }
  player.setAttribute(AWAY_ATTRIBUTE, awayFromSession(session, Date.now(), Common.data.offline));
}

/**
 * Records a result of an idle activity: `activity` names it, `skills` are the core Skills whose XP
 * it gives, `items` what it gave ({ itemId: amount }), `maxGapSeconds` the activity's own longest
 * wait between two results (the offline setting when left out).
 */
function record(player, activity, skills, items, maxGapSeconds) {
  const config = Common.data.offline;
  if (!config.enabled || !Common.isIdle(player)) return;
  const now = Date.now();
  const previous = sessions.get(player);
  const previousAt = previous?.lastAt;
  const previousXp = { ...previous?.lastXp };
  const session = addResult(previous, { activity, items, maxGapSeconds }, now, xpNow(player, skills), config);
  sessions.set(player, session);
  // A result that carries the session on: the time since the last one is time worked.
  if (session === previous) {
    const gained = {};
    for (const [key, total] of Object.entries(session.lastXp)) gained[key] = total - (previousXp[key] ?? total);
    addTotals(player, { activity, workedMs: now - previousAt, xp: gained, items });
  }
  // Kept current while playing, so any save carries it: the server's shutdown save (which logs
  // no one out) and the periodic autosave before a crash pay the time away on the next login.
  player.setAttribute(AWAY_ATTRIBUTE, awayFromSession(session, now, config));
}

function gathered(request) {
  if (!Common.idleGather(request.player, request.skill)) return;
  record(request.player, Common.skillKey(request.skill), [request.skill], { [request.itemId]: request.amount });
}

function logout({ player }) {
  const session = sessions.get(player);
  sessions.delete(player);
  const away = Common.data.offline.enabled ? awayFromSession(session, Date.now(), Common.data.offline) : null;
  player.setAttribute(AWAY_ATTRIBUTE, away);
}

function doing(activity) {
  return activity === "COMBAT" ? "fighting" : Common.skillName(activity).toLowerCase();
}

/** Pays the time away, to the skills and the bank; what the bank had no room for is lost, and said. */
function login({ player }) {
  const away = player.getAttribute(AWAY_ATTRIBUTE);
  if (!away) return;
  player.setAttribute(AWAY_ATTRIBUTE, null);
  // Bountiful Harvest is gathering's; production pays what its materials in the bank allow.
  const gathering = Common.idleSkill(Common.core.Skill[away.activity]);
  const stock = {};
  for (const itemId of Object.keys(away.consumed ?? {})) stock[itemId] = Common.bankAmount(player, Number(itemId));
  const config = {
    ...Common.data.offline, capHours: Progression.capHours(player), bonus: gathering ? Progression.bountyChance(player) : 0, stock,
  };
  const reward = offlineReward(away, Date.now(), config);
  const used = [];
  for (const [itemId, amount] of Object.entries(reward.consumed)) {
    Common.bankTake(player, Number(itemId), amount);
    used.push(`${formatNumber(amount)} x ${Common.itemName(Number(itemId))}`);
  }
  const gained = [];
  for (const [key, amount] of Object.entries(reward.xp)) {
    const skill = Common.core.Skill[key];
    if (!skill) continue;
    player.getSkillManager().addExperience(skill, amount, false);
    gained.push(`${formatNumber(amount)} ${Common.skillName(key)} XP`);
  }
  const banked = [];
  let lost = 0;
  for (const [itemId, amount] of Object.entries(reward.items)) {
    if (Common.bank(player, Number(itemId), amount)) banked.push(`${formatNumber(amount)} x ${Common.itemName(Number(itemId))}`);
    else lost += amount;
  }
  if (gained.length === 0 && banked.length === 0 && lost === 0) return;
  const capped = reward.paidMs < reward.elapsedMs ? ` (capped at ${config.capHours}h)` : "";
  player.sendMessage(`While you were away for ${formatDuration(reward.elapsedMs)}${capped}, you kept ${doing(away.activity)}:`);
  const parts = [
    ...gained,
    ...(banked.length ? [`${banked.join(", ")} to your bank`] : []),
    ...(used.length ? [`using ${used.join(", ")}`] : []),
  ];
  if (reward.ranOut !== null) parts.push(`until you ran out of ${Common.itemName(reward.ranOut).toLowerCase()}`);
  if (parts.length) player.sendMessage(`${parts.join(", ")}.`);
  if (lost > 0) player.sendMessage(`Your bank was full: ${formatNumber(lost)} items were lost.`);
  player.setAttribute(LAST_AWAY_ATTRIBUTE,
    `${formatDuration(reward.elapsedMs)}${capped} ${doing(away.activity)}: ${parts.join(", ") || "nothing"}${lost > 0 ? ` (${formatNumber(lost)} lost, bank full)` : ""}.`);
  addTotals(player, { activity: away.activity, offlineMs: reward.paidMs, xp: reward.xp, items: reward.items });
  Common.changed(player);
  for (const listener of paidListeners) listener(player, reward);
}

module.exports = function attach(api) {
  api.persistAttribute(AWAY_ATTRIBUTE, null);
  api.persistAttribute(LAST_AWAY_ATTRIBUTE, "");
  // No fixed starting value worth comparing: an empty one is filled in by totals().
  api.persistAttribute(TOTALS_ATTRIBUTE, null);
  api.onCustomEvent("storage:gather", gathered);
  api.onPlayerLogout(logout);
  api.onPlayerLogin(login);
};

module.exports.AWAY_ATTRIBUTE = AWAY_ATTRIBUTE;
module.exports.LAST_AWAY_ATTRIBUTE = LAST_AWAY_ATTRIBUTE;
module.exports.TOTALS_ATTRIBUTE = TOTALS_ATTRIBUTE;
module.exports.totals = totals;
module.exports.currentRate = currentRate;
module.exports.onPaid = onPaid;
module.exports.consume = consume;
module.exports.onTotals = onTotals;
module.exports.addResult = addResult;
module.exports.awayFromSession = awayFromSession;
module.exports.offlineReward = offlineReward;
module.exports.formatDuration = formatDuration;
module.exports.record = record;
module.exports.sessions = sessions;
