const FREEZE_TIMER_SECONDS_VARP = 7998;
const FREEZE_TIMER_SPELL_VARP = 7999;
const TICK_MILLIS = 600;

const states = new WeakMap();
const pendingSpellIds = new WeakMap();
let freezeKey = null;

function getFreezeTicks(player) {
  return Math.max(0, Number(player.getTimers?.()?.getTicks?.(freezeKey) ?? 0));
}

function sync(player, force = false) {
  const ticks = getFreezeTicks(player);
  const spellId = ticks > 0 ? pendingSpellIds.get(player) ?? 0 : 0;
  const seconds = Math.ceil((ticks * TICK_MILLIS) / 1000);
  const prior = states.get(player);
  if (!force && prior?.ticks === ticks && prior.spellId === spellId) {
    return;
  }
  states.set(player, { ticks, spellId });
  const sender = player.getPacketSender();
  sender.sendConfig(FREEZE_TIMER_SECONDS_VARP, seconds);
  sender.sendConfig(FREEZE_TIMER_SPELL_VARP, spellId);
  if (ticks === 0) {
    pendingSpellIds.delete(player);
  }
}

module.exports = {
  name: "Freeze Timer",
  register(api) {
    // Resolved once: a require() here ran per player per tick, and in a built server it
    // missed the resolve cache (the .ts path throws, then is rewritten to dist) at ~15us a call.
    freezeKey = api.core.TimerKey.FREEZE;
    api.onCombatHitResolved(({ attacker, target }) => {
      if (!target?.isPlayer?.() || states.get(target)?.ticks > 0 || getFreezeTicks(target) === 0) {
        return;
      }
      const spellId = attacker?.getCombat?.().getPreviousCast?.()?.spellId?.();
      if (Number.isInteger(spellId)) {
        pendingSpellIds.set(target, spellId);
      }
    });
    api.onPlayerLogin(({ player }) => sync(player, true));
    api.onPlayerProcess(({ player }) => sync(player));
    api.onPlayerLogout(({ player }) => {
      states.delete(player);
      pendingSpellIds.delete(player);
    });
  },
};
