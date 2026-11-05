/**
 * Daily goals (plugins/modes/data/idle-mode.json "goals"). An idle account gets `goalsPerDay`
 * goals a day, picked from the pool by its name and the day, so they stay the same all day and a
 * relog can't reroll them. The day turns at `resetUtcHour`. Goals:
 *
 * - xp: gain XP in a skill or a group of skills (combat, making things), bigger at higher levels;
 * - gather / make: items an idle gathering or production skill brought in;
 * - time: minutes working idle, playing or away;
 * - kill: monsters of idle combat's target (online only).
 *
 * XP, items and time come from the offline progress's totals (`Offline.onTotals`), so time away
 * counts too. A goal done pays its points in idle points and says so; all of a day's pay
 * `bonusPoints` more. Saved as `idle-mode:daily` { day, goals: [{ id, target, progress, done }],
 * bonus }. The Idle screen's Goals tab shows them.
 */
const Common = require("./Common.IdleMode");
const Offline = require("./Offline.IdleMode");
const Progression = require("./Progression.IdleMode");

const DAILY_ATTRIBUTE = "idle-mode:daily";
const DAY_MS = 24 * 60 * 60 * 1000;

function config() {
  return Common.data.goals;
}

/** The day a time falls in, turning at `resetUtcHour`. */
function dayOf(now) {
  return Math.floor((now - config().resetUtcHour * 3600 * 1000) / DAY_MS);
}

/** Milliseconds until the next day's goals. */
function untilNextDay(now) {
  return (dayOf(now) + 1) * DAY_MS + config().resetUtcHour * 3600 * 1000 - now;
}

/** A small seeded generator (FNV-1a hash into a xorshift), the same for a name and day. */
function seeded(seed) {
  let state = 2166136261;
  for (const char of seed) state = Math.imul(state ^ char.charCodeAt(0), 16777619) >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
}

function poolEntry(id) {
  return config().pool.find((entry) => entry.id === id) ?? null;
}

/** How big a goal is for this player: XP with the skills' level, kills with the combat level. */
function targetFor(player, entry) {
  const skills = player.getSkillManager();
  if (entry.type === "xp") {
    const level = Math.max(1, ...entry.skills.map((key) => (Common.core.Skill[key] ? skills.getMaxLevel(Common.core.Skill[key]) : 1)));
    return entry.amount * (1 + Math.floor(level / config().levelStep));
  }
  if (entry.type === "kill") return entry.amount * (1 + Math.floor(skills.getCombatLevel() / config().combatStep));
  return entry.amount;
}

/** Today's goals for the player, picked and saved the first time they are needed each day. */
function today(player, now = Date.now()) {
  const day = dayOf(now);
  const saved = player.getAttribute(DAILY_ATTRIBUTE);
  if (saved?.day === day) return saved;
  const random = seeded(`${String(player.getUsername?.() ?? "").toLowerCase()}:${day}`);
  const pool = [...config().pool];
  const goals = [];
  while (goals.length < config().goalsPerDay && pool.length > 0) {
    const [entry] = pool.splice(Math.floor(random() * pool.length), 1);
    goals.push({ id: entry.id, target: targetFor(player, entry), progress: 0, done: false });
  }
  const daily = { day, goals, bonus: false };
  player.setAttribute(DAILY_ATTRIBUTE, daily);
  return daily;
}

function describe(goal) {
  const entry = poolEntry(goal.id);
  return entry ? entry.text.replace("{amount}", Math.floor(goal.target).toLocaleString("en-US")) : goal.id;
}

/** Called with (player) for every daily goal done (Achievements counts them). */
const doneListeners = [];

function onGoalDone(listener) {
  doneListeners.push(listener);
}

/** Adds progress to today's goals of `type` (`matches` picks among them); pays the ones done. */
function advance(player, type, amountFor) {
  if (!config().enabled || !Common.isIdle(player)) return;
  const daily = today(player);
  let changed = false;
  const goals = daily.goals.map((goal) => {
    const entry = poolEntry(goal.id);
    if (goal.done || entry?.type !== type) return goal;
    const amount = amountFor(entry);
    if (!(amount > 0)) return goal;
    changed = true;
    const progress = Math.min(goal.target, goal.progress + amount);
    const done = progress >= goal.target;
    if (done) {
      Progression.addPoints(player, entry.points);
      player.sendMessage(`<col=ff981f>Daily goal done:</col> ${describe(goal)}. +${entry.points} idle points.`);
      for (const listener of doneListeners) listener(player);
    }
    return { ...goal, progress, done };
  });
  if (!changed) return;
  const bonus = daily.bonus || goals.every((goal) => goal.done);
  if (bonus && !daily.bonus) {
    Progression.addPoints(player, config().bonusPoints);
    player.sendMessage(`<col=ff981f>All of today's goals done!</col> +${config().bonusPoints} idle points.`);
  }
  player.setAttribute(DAILY_ATTRIBUTE, { ...daily, goals, bonus });
  Common.changed(player);
}

const sum = (values) => Object.values(values ?? {}).reduce((total, value) => total + (Number(value) || 0), 0);

function isProductionActivity(activity) {
  return Common.data.production.skills.includes(activity);
}

/** `Offline.onTotals`: XP, items and time worked, playing or away. */
function totalsGrew(player, { activity, workedMs, offlineMs, xp, items }) {
  advance(player, "xp", (entry) => entry.skills.reduce((total, key) => total + (xp[key] ?? 0), 0));
  const gathering = activity && Common.idleSkill(Common.core.Skill[activity]);
  if (gathering) advance(player, "gather", () => sum(items));
  if (isProductionActivity(activity)) advance(player, "make", () => sum(items));
  advance(player, "time", () => (workedMs + offlineMs) / 60000);
}

/** `npc-drops:generated`: a kill of idle combat's target. */
function killed({ player, npc }) {
  const target = player?.getAttribute?.(Common.COMBAT_TARGET_ATTRIBUTE);
  if (!target || npc?.getDefinition?.()?.getName?.() !== target.name) return;
  advance(player, "kill", () => 1);
}

/** On login, the day's goals are picked (a new day's, when it has turned) and said. */
function login({ player }) {
  if (!config().enabled || !Common.isIdle(player)) return;
  const saved = player.getAttribute(DAILY_ATTRIBUTE);
  const daily = today(player);
  if (saved?.day === daily.day) return;
  player.sendMessage(`<col=ff981f>Today's idle goals:</col> ${daily.goals.map(describe).join("; ")}.`);
}

/** The Goals tab: each goal's text, progress and reward, the bonus, and the time to the next day. */
function lines(player, now = Date.now()) {
  const daily = today(player, now);
  return {
    goals: daily.goals.map((goal) => {
      const entry = poolEntry(goal.id);
      return { text: describe(goal), progress: Math.floor(goal.progress), target: Math.floor(goal.target), points: entry?.points ?? 0, done: goal.done };
    }),
    bonus: { points: config().bonusPoints, done: daily.bonus, count: daily.goals.filter((goal) => goal.done).length, of: daily.goals.length },
    nextInMs: untilNextDay(now),
  };
}

module.exports = function attach(api) {
  api.persistAttribute(DAILY_ATTRIBUTE, null);
  api.onCustomEvent("npc-drops:generated", killed);
  api.onPlayerLogin(login);
  Offline.onTotals(totalsGrew);
};

module.exports.DAILY_ATTRIBUTE = DAILY_ATTRIBUTE;
module.exports.today = today;
module.exports.onGoalDone = onGoalDone;
module.exports.lines = lines;
module.exports.dayOf = dayOf;
module.exports.untilNextDay = untilNextDay;
