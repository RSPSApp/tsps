// Pushes the antifire, teleblock and stamina countdowns to the client's infobox timers
// (client/game/plugins/statustimer). Each value is read from the real state every tick, so a
// relog or any other source of the effect shows the right time left. Custom varps, mirrored
// in client/game/plugins/statustimer/StatusTimerOverlay.tsx; 7995-7999 are already taken.
const { ATTR_DRAGONFIRE_STATE, DragonfireProtectionTier } = require("../combat/DragonfireProtection");

const ANTIFIRE_TIMER_SECONDS_VARP = 7990;
/** 1: antifire or extended antifire, 2: super or extended super antifire. */
const ANTIFIRE_TIMER_TYPE_VARP = 7991;
const TELEBLOCK_TIMER_SECONDS_VARP = 7992;
const STAMINA_TIMER_SECONDS_VARP = 7993;

const ANTIFIRE_TYPE = 1;
const SUPER_ANTIFIRE_TYPE = 2;

/** Set by Potions.plugin.js: a Date.now() deadline, shifted by the time spent offline. */
const ATTR_STAMINA_END = "potions:stamina:end";

const states = new WeakMap();

function secondsUntil(endsAt, now) {
  return Number.isFinite(endsAt) && endsAt > now ? Math.ceil((endsAt - now) / 1000) : 0;
}

/**
 * The dragonfire protection state from DragonfireProtection.js, or the saved fire immunity timer
 * when the state is gone (it is not persisted, so a relog falls back to the timer as that module does).
 */
function getAntifire(player, now) {
  const state = player.getAttribute?.(ATTR_DRAGONFIRE_STATE);
  if (state && typeof state === "object") {
    const seconds = secondsUntil(state.endsAt, now);
    if (seconds === 0) return [0, 0];
    return [seconds, state.tier >= DragonfireProtectionTier.SUPER_ANTIFIRE ? SUPER_ANTIFIRE_TYPE : ANTIFIRE_TYPE];
  }
  const seconds = Math.max(0, Number(player.getCombat?.()?.getFireImmunityTimer?.()?.secondsRemaining?.() ?? 0));
  return seconds > 0 ? [seconds, ANTIFIRE_TYPE] : [0, 0];
}

/** secondsRemaining(), not finished(): finished() stops the timer as a side effect. */
function getTeleblockSeconds(player) {
  return Math.max(0, Number(player.getCombat?.()?.getTeleblockTimer?.()?.secondsRemaining?.() ?? 0));
}

function getStaminaSeconds(player, now) {
  return secondsUntil(Number(player.getAttribute?.(ATTR_STAMINA_END)), now);
}

function getState(player, now = Date.now()) {
  const [antifireSeconds, antifireType] = getAntifire(player, now);
  return [
    [ANTIFIRE_TIMER_SECONDS_VARP, antifireSeconds],
    [ANTIFIRE_TIMER_TYPE_VARP, antifireType],
    [TELEBLOCK_TIMER_SECONDS_VARP, getTeleblockSeconds(player)],
    [STAMINA_TIMER_SECONDS_VARP, getStaminaSeconds(player, now)],
  ];
}

function sync(player, force = false) {
  if (!player || player.isPlayerBot?.()) return;
  const state = getState(player);
  const prior = force ? undefined : states.get(player);
  states.set(player, state);
  let sender;
  for (let i = 0; i < state.length; i++) {
    const [varp, value] = state[i];
    if (prior && prior[i][1] === value) continue;
    sender ??= player.getPacketSender();
    sender.sendConfig(varp, value);
  }
}

module.exports = {
  name: "Buff Timers",
  _test: { getState, sync },
  register(api) {
    api.onPlayerLogin(({ player }) => sync(player, true));
    api.onPlayerProcess(({ player }) => sync(player));
    api.onPlayerLogout(({ player }) => states.delete(player));
  },
};
