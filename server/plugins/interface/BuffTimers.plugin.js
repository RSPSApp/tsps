// Pushes the antifire, teleblock and stamina countdowns to the client: to the buff bar's own varbits,
// which the cache scripts draw, and to the client's infobox timers (client/game/plugins/statustimer).
// Each value is read from the real state every tick, so a relog or any other source of the effect
// shows the right time left. The infobox timers use custom varps, mirrored in
// client/game/plugins/statustimer/StatusTimerOverlay.tsx; 7995-7999 are already taken.
const { ATTR_DRAGONFIRE_STATE, ATTR_DRAGONFIRE_TIER, DragonfireProtectionTier } = require("../combat/DragonfireProtection");

const ANTIFIRE_TIMER_SECONDS_VARP = 7990;
/** 1: antifire or extended antifire, 2: super or extended super antifire. */
const ANTIFIRE_TIMER_TYPE_VARP = 7991;
const TELEBLOCK_TIMER_SECONDS_VARP = 7992;
const STAMINA_TIMER_SECONDS_VARP = 7993;

/** antifire_potion: an antifire or extended antifire's time left, in steps of 30 ticks. */
const ANTIFIRE_VARBIT = 3981;
const ANTIFIRE_STEP_TICKS = 30;
/** super_antifire_potion: a super or extended super antifire's time left, in steps of 20 ticks. */
const SUPER_ANTIFIRE_VARBIT = 6101;
const SUPER_ANTIFIRE_STEP_TICKS = 20;
/** teleblock_cycles: the Tele Block's time left, in ticks. */
const TELEBLOCK_VARBIT = 4163;
/** stamina_duration: a stamina potion's time left, in steps of 10 ticks; stamina_active is 1 while it lasts. */
const STAMINA_DURATION_VARBIT = 24;
const STAMINA_STEP_TICKS = 10;
const STAMINA_ACTIVE_VARBIT = 25;

const ANTIFIRE_TYPE = 1;
const SUPER_ANTIFIRE_TYPE = 2;
const TICK_MS = 600;

/** Set by Potions.plugin.js: a Date.now() deadline, shifted by the time spent offline. */
const ATTR_STAMINA_END = "potions:stamina:end";

const states = new WeakMap();

function millisUntil(endsAt, now) {
  return Number.isFinite(endsAt) && endsAt > now ? endsAt - now : 0;
}

const seconds = (ms) => Math.ceil(ms / 1000);
/** Time left in the buff bar's steps: a step stays shown until the last of its ticks has passed. */
const steps = (ms, stepTicks) => Math.ceil(Math.ceil(ms / TICK_MS) / stepTicks);

/**
 * The dragonfire protection state from DragonfireProtection.js, or the saved fire immunity timer
 * and saved tier when the state is gone (it is not persisted, so a relog falls back to them as that
 * module does). [milliseconds left, type].
 */
function getAntifire(player, now) {
  const state = player.getAttribute?.(ATTR_DRAGONFIRE_STATE);
  if (state && typeof state === "object") {
    const ms = millisUntil(state.endsAt, now);
    if (ms === 0) return [0, 0];
    return [ms, state.tier >= DragonfireProtectionTier.SUPER_ANTIFIRE ? SUPER_ANTIFIRE_TYPE : ANTIFIRE_TYPE];
  }
  const secondsLeft = Math.max(0, Number(player.getCombat?.()?.getFireImmunityTimer?.()?.secondsRemaining?.() ?? 0));
  if (secondsLeft === 0) return [0, 0];
  const savedTier = player.getAttribute?.(ATTR_DRAGONFIRE_TIER)?.tier;
  return [secondsLeft * 1000, savedTier >= DragonfireProtectionTier.SUPER_ANTIFIRE ? SUPER_ANTIFIRE_TYPE : ANTIFIRE_TYPE];
}

/**
 * [whole seconds, milliseconds] left. secondsRemaining(), not finished(): finished() stops the
 * timer as a side effect.
 */
function getTeleblock(player) {
  const timer = player.getCombat?.()?.getTeleblockTimer?.();
  const secondsLeft = Math.max(0, Number(timer?.secondsRemaining?.() ?? 0));
  if (secondsLeft === 0) return [0, 0];
  return [secondsLeft, Math.max(0, Number(timer.millisRemaining?.() ?? secondsLeft * 1000))];
}

function getStaminaMillis(player, now) {
  return millisUntil(Number(player.getAttribute?.(ATTR_STAMINA_END)), now);
}

/** [kind, id, value]: "varp" for the infobox timers, "varbit" for the buff bar. */
function getState(player, now = Date.now()) {
  const [antifireMs, antifireType] = getAntifire(player, now);
  const [teleblockSeconds, teleblockMs] = getTeleblock(player);
  const staminaMs = getStaminaMillis(player, now);
  return [
    ["varp", ANTIFIRE_TIMER_SECONDS_VARP, seconds(antifireMs)],
    ["varp", ANTIFIRE_TIMER_TYPE_VARP, antifireType],
    ["varp", TELEBLOCK_TIMER_SECONDS_VARP, teleblockSeconds],
    ["varp", STAMINA_TIMER_SECONDS_VARP, seconds(staminaMs)],
    ["varbit", ANTIFIRE_VARBIT, antifireType === ANTIFIRE_TYPE ? steps(antifireMs, ANTIFIRE_STEP_TICKS) : 0],
    ["varbit", SUPER_ANTIFIRE_VARBIT, antifireType === SUPER_ANTIFIRE_TYPE ? steps(antifireMs, SUPER_ANTIFIRE_STEP_TICKS) : 0],
    ["varbit", TELEBLOCK_VARBIT, steps(teleblockMs, 1)],
    ["varbit", STAMINA_DURATION_VARBIT, steps(staminaMs, STAMINA_STEP_TICKS)],
    ["varbit", STAMINA_ACTIVE_VARBIT, staminaMs > 0 ? 1 : 0],
  ];
}

function sync(player, force = false) {
  if (!player || player.isPlayerBot?.()) return;
  const state = getState(player);
  const prior = force ? undefined : states.get(player);
  states.set(player, state);
  let sender;
  for (let i = 0; i < state.length; i++) {
    const [kind, id, value] = state[i];
    if (prior && prior[i][2] === value) continue;
    sender ??= player.getPacketSender();
    if (kind === "varbit") sender.sendVarbit(id, value);
    else sender.sendConfig(id, value);
  }
}

module.exports = {
  name: "Buff Timers",
  description: "Sends the antifire, Tele Block and stamina countdowns to the buff bar and the client's infobox timers.",
  _test: { getState, sync },
  register(api) {
    api.onPlayerLogin(({ player }) => sync(player, true));
    api.onPlayerProcess(({ player }) => sync(player));
    api.onPlayerLogout(({ player }) => states.delete(player));
  },
};
