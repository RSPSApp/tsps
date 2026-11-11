// The buff bar's combat effects that keep their timer in a client varc: the freeze, the Staff of the dead
// special, poison and venom, and the Abyssal Sire stun. Only `buff_bar_start` (cache script 5931: a buff's
// struct and a value) writes those varcs, through script 5927; script 5923 then draws each against map_clock,
// the tick count the server sends every tick:
// - freeze ("Bound.", struct 3092): the map_clock tick it ends on (script 4678: varc - map_clock);
// - Staff of the dead (3093), poison (3740) and venom (3741): the tick the timer started, drawn for the struct's
//   param 1541 ticks (script 5940: varc + param - map_clock), 100 for the special and 30 for a poison hit;
// - the Sire stun (3091): the client stamps its own clock and draws 30 seconds from it, whatever the value.
// A value of 0 hides the buff (except the Sire stun, which runs out by itself).
// Ours: live has not been recorded sending buff_bar_start for these buffs, only to clear burn and bleed.
const BUFF_BAR_START_SCRIPT = 5931;
const SIRE_STUN_STRUCT = 3091;
const FREEZE_STRUCT = 3092;
const POWER_OF_DEATH_STRUCT = 3093;
const POISON_STRUCT = 3740;
const VENOM_STRUCT = 3741;
/** The ticks the Staff of the dead special and a poison pulse are drawn for (param 1541 of their structs). */
const POWER_OF_DEATH_TICKS = 100;
const POISON_PULSE_TICKS = 30;
const POWER_OF_DEATH_ATTRIBUTE = "power-of-death:until";

let core = null;
/** The last value sent per player: [freeze, Staff of the dead, poison or venom]. */
const sentValues = new WeakMap();

function startBuff(player, struct, value) {
  player.getPacketSender().sendClientScript(BUFF_BAR_START_SCRIPT, struct, value);
}

/** The tick the freeze ends on, or 0 when not frozen. */
function freezeEnd(player, now) {
  const ticks = Math.max(0, Number(player.getTimers?.()?.getTicks?.(core.TimerKey.FREEZE) ?? 0));
  return ticks > 0 ? now + ticks : 0;
}

/** The tick the Staff of the dead special started on, or 0 when it is not running. */
function powerOfDeathStart(player, now) {
  const until = Number(player.getAttribute(POWER_OF_DEATH_ATTRIBUTE) ?? 0);
  return until > now ? until - POWER_OF_DEATH_TICKS : 0;
}

/**
 * [struct, value] for the time to the next poison or venom hit: the tick the current 30-tick pulse started,
 * or 0 when neither is on. A pulse held back by an open interface keeps the value it had.
 */
function poisonPulse(player, now, prior) {
  if (!(player.getPoisonDamage?.() > 0)) return [POISON_STRUCT, 0];
  const struct = player.isVenomed?.() ? VENOM_STRUCT : POISON_STRUCT;
  const ticksUntilPulse = Number(player.getCombat().getPoisonClock().snapshot().ticksUntilPulse);
  if (ticksUntilPulse <= 0 && prior?.[0] === struct && prior[1] > 0) return prior;
  return [struct, now + ticksUntilPulse - POISON_PULSE_TICKS];
}

function sync(player, force = false) {
  const now = core.World.getProcessCycle();
  const prior = sentValues.get(player);
  if (!prior) force = true;
  const freeze = freezeEnd(player, now);
  const powerOfDeath = powerOfDeathStart(player, now);
  const poison = poisonPulse(player, now, prior?.[2]);
  if (force || prior[0] !== freeze) startBuff(player, FREEZE_STRUCT, freeze);
  if (force || prior[1] !== powerOfDeath) startBuff(player, POWER_OF_DEATH_STRUCT, powerOfDeath);
  if (force || prior[2][0] !== poison[0] || prior[2][1] !== poison[1]) {
    // Poison and venom share one varc: clearing one would clear the other, so a switch only starts the new one.
    startBuff(player, poison[0], poison[1]);
  }
  sentValues.set(player, [freeze, powerOfDeath, poison]);
}

/** A login sends every one, 0 included, since the client's varcs outlive a logout. */
function onLogin({ player }) {
  sync(player, true);
}

function onProcess({ player }) {
  sync(player);
}

function onLogout({ player }) {
  sentValues.delete(player);
}

/** The Sire stun buff: 30 seconds on the bar from now, restarted by a restun. */
function onSireStunned({ player }) {
  if (player) startBuff(player, SIRE_STUN_STRUCT, 1);
}

function register(api) {
  core = api.core;
  api.onPlayerLogin(onLogin);
  api.onPlayerProcess(onProcess);
  api.onPlayerLogout(onLogout);
  api.onCustomEvent("abyssal-sire:stunned", onSireStunned);
}

module.exports = {
  name: "Buff Bar Start",
  description: "Starts the buff bar's freeze, Staff of the dead, poison and Abyssal Sire stun timers.",
  register,
};
