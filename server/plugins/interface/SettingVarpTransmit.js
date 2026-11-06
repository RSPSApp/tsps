/**
 * One click on an All Settings row changes the varbit locally and transmits the whole shared varp,
 * then sends the row click. Both reach the server. Remember the transmission so the click handler
 * does not toggle the same change a second time; the Client's transmitted value is authoritative.
 *
 * `tick` is World.getProcessCycle(); an entry is only consumed within one tick so a later,
 * separate click still toggles normally.
 */
const recent = new WeakMap();

function remember(player, varpId, value, tick) {
  if (!player) return;
  recent.set(player, { varpId, value, tick });
}

/** The remembered whole-varp value for this player, or undefined when none is pending. */
function take(player, varpId, tick, withinTicks = 1) {
  const entry = recent.get(player);
  if (!entry || entry.varpId !== varpId) return undefined;
  if (tick - entry.tick > withinTicks) {
    recent.delete(player);
    return undefined;
  }
  recent.delete(player);
  return entry.value;
}

module.exports = { remember, take };
