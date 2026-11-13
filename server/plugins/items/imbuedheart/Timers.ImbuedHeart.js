/**
 * The imbued and saturated hearts' clocks, as live OSRS runs them (rsprox 1763, 1696, 1702, 238/04152):
 * `imbued_heart_timer` is the wait in six-second steps (70 for seven minutes, 50 for five) and drops
 * one every ten ticks; `saturated_heart_time` is the saturated boost's ticks left (500) and drops
 * every tick, with `saturated_heart_base` holding the boosted Magic level for as long as it lasts.
 * Both clocks reach 0 on the same tick, with a chat line for each. The wait is kept per player as a
 * time (so it survives logging out) and the varbits are derived from it every tick.
 */
const READY_AT_ATTRIBUTE = "imbued-heart:ready-at";
const SATURATED_UNTIL_ATTRIBUTE = "imbued-heart:saturated-until";

// The saturated heart's flat Magic boost, plus 10% of the base level.
const SATURATED_FLAT = 4;
const TICK_MS = 600;
const TIMER_STEP_MS = 6000;
const TIMER_VARBIT = "imbued_heart_timer";
const TIME_VARBIT = "saturated_heart_time";
const BASE_VARBIT = "saturated_heart_base";

const REGAINED_MESSAGE = (heart) => `<col=ff3045>Your ${heart} heart has regained its magical power.</col>`;
const WORN_OFF_MESSAGE = "<col=ff3045>The effects of the saturated heart have worn off.";

let core = null;

function timestamp(player, key) {
  const saved = Number(player.getAttribute(key));
  return Number.isFinite(saved) && saved > 0 ? saved : 0;
}

/** When the next activation is allowed; 0 (never used, or reset by death) means now. */
function readyAt(player) {
  return timestamp(player, READY_AT_ATTRIBUTE);
}

/** When the saturated heart's held boost ends; 0 when none is running. */
function saturatedUntil(player) {
  return timestamp(player, SATURATED_UNTIL_ATTRIBUTE);
}

/** The Magic level a boost of `flat` + 10% reaches from `base`, as the heart's own formula gives it. */
function boostedLevel(base, flat) {
  return base + Math.floor(base * 0.1) + flat;
}

function sendIfChanged(player, name, value) {
  const id = core.CacheDefinitions.getVarbitId(name);
  const sender = player.getPacketSender();
  if (id == null || sender.getVarbit(id) === value) return false;
  sender.sendVarbit(id, value);
  return true;
}

function sentValue(player, name) {
  const id = core.CacheDefinitions.getVarbitId(name);
  return id == null ? 0 : player.getPacketSender().getVarbit(id);
}

/**
 * Wiki: "After five minutes, the player's Magic level will return to normal." Only the heart's own
 * boost ends: a stronger one from another source, above the heart's cap, is left to its own decay.
 */
function endSaturation(player) {
  player.setAttribute(SATURATED_UNTIL_ATTRIBUTE, 0);
  const skills = player.getSkillManager();
  const { MAGIC } = core.Skill;
  const max = skills.getMaxLevel(MAGIC);
  const current = skills.getCurrentLevel(MAGIC);
  if (current > max && current <= boostedLevel(max, SATURATED_FLAT)) skills.setCurrentLevels(MAGIC, max);
}

/** Per tick: keep the three varbits true to the saved times, and say when each clock runs out. */
function process({ player }) {
  const now = Date.now();
  const ready = readyAt(player);
  const until = saturatedUntil(player);
  const steps = ready > now ? Math.ceil((ready - now) / TIMER_STEP_MS) : 0;
  const ticks = until > now ? Math.ceil((until - now) / TICK_MS) : 0;

  const waited = sentValue(player, TIMER_VARBIT) > 0;
  const held = sentValue(player, TIME_VARBIT) > 0;
  sendIfChanged(player, TIMER_VARBIT, steps);
  if (waited && steps === 0) player.sendMessage(REGAINED_MESSAGE(until > 0 ? "saturated" : "imbued"));

  if (until > 0 && ticks === 0) endSaturation(player);
  sendIfChanged(player, TIME_VARBIT, ticks);
  if (held && ticks === 0) player.sendMessage(WORN_OFF_MESSAGE);
  const max = player.getSkillManager().getMaxLevel(core.Skill.MAGIC);
  sendIfChanged(player, BASE_VARBIT, ticks > 0 ? boostedLevel(max, SATURATED_FLAT) : 0);
}

/** Potions' minute-by-minute boost decay skips the Magic level while the saturated heart holds it. */
function holdMagic({ player, held }) {
  const { MAGIC } = core.Skill;
  const skills = player.getSkillManager();
  const cap = boostedLevel(skills.getMaxLevel(MAGIC), SATURATED_FLAT);
  if (saturatedUntil(player) > Date.now() && skills.getCurrentLevel(MAGIC) <= cap) held.add(MAGIC.getIndex());
}

/** Death restores the stats, so the heart's wait and held boost go with them (Wiki). */
function reset(player) {
  player.setAttribute(READY_AT_ATTRIBUTE, 0);
  player.setAttribute(SATURATED_UNTIL_ATTRIBUTE, 0);
  for (const name of [TIMER_VARBIT, TIME_VARBIT, BASE_VARBIT]) sendIfChanged(player, name, 0);
}

function attach(api) {
  core = api.core;
  api.persistAttribute(READY_AT_ATTRIBUTE, 0);
  api.persistAttribute(SATURATED_UNTIL_ATTRIBUTE, 0);
  api.onPlayerProcess(process);
  api.onCustomEvent("stats:boost-held", holdMagic);
}

module.exports = {
  READY_AT_ATTRIBUTE,
  SATURATED_UNTIL_ATTRIBUTE,
  SATURATED_FLAT,
  TICK_MS,
  readyAt,
  saturatedUntil,
  boostedLevel,
  process,
  holdMagic,
  reset,
  attach,
};
