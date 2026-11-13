"use strict";

const SKILL_XP_PREFIX = "xp:";

function routineOf(bot) { return bot?.activityId ?? bot?.mode ?? "Unassigned"; }
function metricValue(bot, metric) {
  if (metric === "healthPercent") {
    const current = Number(bot?.hitpoints), maximum = Number(bot?.maxHitpoints);
    return Number.isFinite(current) && Number.isFinite(maximum) && maximum > 0
      ? Math.max(0, Math.min(100, current / maximum * 100))
      : null;
  }
  if (metric === "hitpoints") {
    const value = Number(bot?.hitpoints);
    return Number.isFinite(value) ? value : null;
  }
  if (metric === "totalXp") {
    const skills = Array.isArray(bot?.skills) ? bot.skills : [];
    if (skills.length === 0) return null;
    const values = skills.map(skill => Number(skill?.xp));
    return values.every(Number.isFinite) ? values.reduce((sum, value) => sum + value, 0) : null;
  }
  if (typeof metric === "string" && metric.startsWith(SKILL_XP_PREFIX)) {
    const name = metric.slice(SKILL_XP_PREFIX.length).toLowerCase();
    const skill = bot?.skills?.find?.(entry => String(entry?.name ?? "").toLowerCase() === name);
    const value = Number(skill?.xp);
    return skill && Number.isFinite(value) ? value : null;
  }
  return null;
}
function inCategory(bot, category) {
  if (category === "all") return true;
  if (category === "managed") return bot?.managed === true;
  if (category === "unmanaged") return bot?.managed !== true;
  if (category.startsWith("routine:")) return routineOf(bot) === category.slice("routine:".length);
  if (category.startsWith("status:")) return String(bot?.status ?? "unknown") === category.slice("status:".length);
  return false;
}
function aggregateSwarm(bots, { category = "all", type = "average", metric = "healthPercent" } = {}) {
  const rows = (Array.isArray(bots) ? bots : [])
    .filter(bot => inCategory(bot, category))
    .map(bot => ({
      username: String(bot?.displayName ?? bot?.username ?? "Unknown bot"),
      routine: String(routineOf(bot)),
      value: metricValue(bot, metric),
    }))
    .filter(row => Number.isFinite(row.value));
  if (type === "top10" || type === "bottom10") {
    rows.sort((left, right) => (type === "top10" ? right.value - left.value : left.value - right.value) || left.username.localeCompare(right.username));
    return { type, category, metric, sampleCount: rows.length, rows: rows.slice(0, 10) };
  }
  if (rows.length === 0) return { type, category, metric, sampleCount: 0, value: null };
  const values = rows.map(row => row.value).sort((left, right) => left - right);
  let value;
  if (type === "median") {
    const middle = Math.floor(values.length / 2);
    value = values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2;
  } else if (type === "min") value = values[0];
  else if (type === "max") value = values.at(-1);
  else if (type === "average") value = values.reduce((sum, current) => sum + current, 0) / values.length;
  else return { type, category, metric, sampleCount: 0, value: null };
  return { type, category, metric, sampleCount: values.length, value };
}

if (typeof module !== "undefined" && module.exports) module.exports = { aggregateSwarm, metricValue, inCategory, routineOf };
else if (typeof window !== "undefined") window.LocalBotSwarmAggregates = { aggregateSwarm, metricValue, inCategory, routineOf };
