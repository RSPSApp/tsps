/**
 * Idle achievements (plugins/modes/data/idle-mode.json "achievements"): permanent milestones, in
 * tracks of tiers (Gatherer I, II, III...). What each track counts:
 *
 * - gathered / made: items an idle gathering or production skill brought in, playing or away
 *   (`Offline.onTotals`);
 * - hours: time idle, playing or away (`Offline.onTotals`);
 * - kills: kills of idle combat's target (online), and bosses: those of a boss (Bosses);
 * - goals: daily goals done (`Goals.onGoalDone`).
 *
 * Reaching a tier pays its points in idle points once, and says so. Saved as
 * `idle-mode:records` { counts: { gathered, made, kills, goals, hours }, tiers: { track: tier } }.
 * The Idle screen's Feats tab shows each track: its tier and the next one's progress.
 */
const Common = require("./Common.IdleMode");
const Offline = require("./Offline.IdleMode");
const Progression = require("./Progression.IdleMode");
const Goals = require("./Goals.IdleMode");

const RECORDS_ATTRIBUTE = "idle-mode:records";
const ROMAN = ["I", "II", "III", "IV", "V"];

function config() {
  return Common.data.achievements;
}

function records(player) {
  const saved = player.getAttribute(RECORDS_ATTRIBUTE) ?? {};
  return { counts: { ...saved.counts }, tiers: { ...saved.tiers } };
}

function tierName(track, tier) {
  return `${track.name} ${ROMAN[tier - 1] ?? tier}`;
}

const number = (value) => Math.floor(value).toLocaleString("en-US");

/** Adds to the counts; each track whose next tier is reached pays it (several, after a long time away). */
function add(player, gains) {
  if (!config().enabled || !Common.isIdle(player)) return;
  const record = records(player);
  let changed = false;
  for (const [key, amount] of Object.entries(gains)) {
    if (!(amount > 0)) continue;
    record.counts[key] = (record.counts[key] ?? 0) + amount;
    changed = true;
  }
  if (!changed) return;
  for (const track of config().tracks) {
    const count = record.counts[track.counts] ?? 0;
    let tier = record.tiers[track.id] ?? 0;
    while (tier < track.tiers.length && count >= track.tiers[tier]) {
      const points = track.points[tier] ?? 0;
      tier += 1;
      Progression.addPoints(player, points);
      player.sendMessage(`<col=ff981f>Achievement unlocked:</col> ${tierName(track, tier)} (${number(track.tiers[tier - 1])} ${track.unit}). +${number(points)} idle points.`);
    }
    record.tiers[track.id] = tier;
  }
  player.setAttribute(RECORDS_ATTRIBUTE, record);
  Common.changed(player);
}

const sum = (values) => Object.values(values ?? {}).reduce((total, value) => total + (Number(value) || 0), 0);

/** `Offline.onTotals`: items by activity, and time idle. */
function totalsGrew(player, { activity, workedMs, offlineMs, items }) {
  const gains = { hours: (workedMs + offlineMs) / 3600000 };
  if (activity && Common.idleSkill(Common.core.Skill[activity])) gains.gathered = sum(items);
  else if (Common.data.production.skills.includes(activity)) gains.made = sum(items);
  add(player, gains);
}

function killed({ player, npc }) {
  const target = player?.getAttribute?.(Common.COMBAT_TARGET_ATTRIBUTE);
  const name = npc?.getDefinition?.()?.getName?.();
  if (!target || name !== target.name) return;
  add(player, Common.data.bosses.names.includes(name) ? { kills: 1, bosses: 1 } : { kills: 1 });
}

/** How many of a count (`gathered`, `kills`, `bosses`...) the player has. */
function count(player, key) {
  return records(player).counts[key] ?? 0;
}

function goalDone(player) {
  add(player, { goals: 1 });
}

/** The Feats tab: each track's tier reached and the next tier's progress and reward. */
function lines(player) {
  const record = records(player);
  return config().tracks.map((track) => {
    const tier = record.tiers[track.id] ?? 0;
    const count = record.counts[track.counts] ?? 0;
    const next = track.tiers[tier];
    return {
      title: tier > 0 ? tierName(track, tier) : `${track.name} (not yet)`,
      done: next === undefined,
      progress: next === undefined
        ? `Every tier done: ${number(count)} ${track.unit}`
        : `${tierName(track, tier + 1)}: ${number(Math.min(count, next))} / ${number(next)} ${track.unit} - reward ${number(track.points[tier] ?? 0)} idle points`,
      // The same thing as numbers, for a screen that draws a bar rather than printing the line.
      name: track.name,
      unit: track.unit,
      tier,
      tiers: track.tiers.length,
      count,
      next: next ?? null,
      nextName: next === undefined ? null : tierName(track, tier + 1),
      points: next === undefined ? 0 : (track.points[tier] ?? 0),
    };
  });
}

module.exports = function attach(api) {
  api.persistAttribute(RECORDS_ATTRIBUTE, null);
  api.onCustomEvent("npc-drops:generated", killed);
  Offline.onTotals(totalsGrew);
  Goals.onGoalDone(goalDone);
};

module.exports.RECORDS_ATTRIBUTE = RECORDS_ATTRIBUTE;
module.exports.add = add;
module.exports.lines = lines;
module.exports.count = count;
