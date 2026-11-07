// Brimstone ring (https://oldschool.runescape.wiki/w/Brimstone_ring, rsprox capture 1534):
// each time the wearer attacks the target they chose with a spell or magical attack (powered
// staves included), there is a 25% chance that the target's magic defence roll is cut by 10% for
// that attack. The chatbox then says so in red, on the tick of the cast, as a filterable (spam)
// message. Other targets hit by the same cast (barrage splash) are not affected.
const PROC_PERCENT = 25;
const DEFENCE_ROLL_PERCENT = 90;
const MESSAGE = "<col=ff0000>Your attack ignored 10% of your opponent's magic defence.</col>";
let core = null;
/** attacker -> { cycle, procced }: one decision per attack tick, however many rolls it makes. */
const decisions = new WeakMap();

function wearsBrimstoneRing(player) {
  return player.getEquipment().getItems()[core.Equipment.RING_SLOT]?.getId?.() === core.ItemIdentifiers.BRIMSTONE_RING;
}

function procced(player) {
  const cycle = core.World.getProcessCycle();
  const previous = decisions.get(player);
  if (previous?.cycle === cycle) return previous.procced;
  const result = Math.random() * 100 < PROC_PERCENT;
  decisions.set(player, { cycle, procced: result });
  if (result) player.getPacketSender().sendTypedMessage(core.ChatType.SPAM, MESSAGE);
  return result;
}

function ignoreMagicDefence(request) {
  const { attacker, target } = request;
  if (!attacker?.isPlayer?.() || target === attacker) return;
  const player = attacker.getAsPlayer();
  if (!wearsBrimstoneRing(player) || player.getCombat().getTarget() !== target) return;
  if (procced(player)) request.defenceRoll = Math.floor(request.defenceRoll * DEFENCE_ROLL_PERCENT / 100);
}

module.exports = function registerBrimstoneRingEffects(api) {
  core = api.core;
  api.onCustomEvent("combat:magic-defence-roll", ignoreMagicDefence);
};
module.exports._test = { PROC_PERCENT, MESSAGE, ignoreMagicDefence };
