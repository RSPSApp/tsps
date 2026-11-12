// Repairing a boat with a repair kit (Wiki: Repair kit). Apply on any kit, by anyone aboard the
// boat (its owner or a guest; the Wiki has several players repairing at once): the player plays
// human_repairkit (not while steering at the helm, where the helmsman's pose stays) and sound 2101
// three times (15, 30 and 45 cycles in), "You use the repair kit to fix up the boat.", the kit
// goes and the boat gets its hitpoints back (wooden 5 up to rosewood 50), up to its maximum. A
// boat already at full health still uses up the kit. One kit at most every 3 ticks: a click
// before then does nothing. Like eating, it holds off the player's next cannon shot (Wiki; ours:
// 3 ticks, as food).
const common = require("./Common.SeaCombat");
const cargo = require("../Cargo.Sailing");
const BoatHp = require("./BoatHp.SeaCombat");
const { playSound, VARBIT } = require("../SailingContent.Sailing");

const ANIM_REPAIR = 13252;
const SOUND_REPAIR = 2101;
const SOUND_DELAYS = [15, 30, 45];
const REPAIR_DELAY_TICKS = 3;
const ATTACK_DELAY_TICKS = 3;
const REPAIRED = "You use the repair kit to fix up the boat.";
const NOT_ABOARD = "You need to be on a boat to use a repair kit.";
/** The repair kits by name (Cargo.Sailing.js REPAIR_KITS has what each repairs). */
const KIT_NAMES = Object.freeze([
  "Repair kit", "Oak repair kit", "Teak repair kit", "Mahogany repair kit", "Camphor repair kit",
  "Ironwood repair kit", "Rosewood repair kit",
]);

/** player -> the tick their last kit went on. */
const lastRepairTick = new WeakMap();

/** The boat the player stands on, their own or one they visit: `{ boat, owned, owner }`, or undefined. */
function boatAboard(player) {
  const { Sailing, BoatManager } = common.core();
  const boat = BoatManager.getBoatAboard(player);
  const owner = boat && Sailing.ownerOf(boat);
  const owned = boat && Sailing.ownedOf(boat);
  return boat && owner && owned ? { boat, owned, owner } : undefined;
}

function apply(event) {
  const heals = cargo.REPAIR_KITS[event.itemId];
  if (heals === undefined) return false;
  event.handled = true;
  const { player } = event;
  const aboard = boatAboard(player);
  if (!aboard) {
    player.sendMessage(NOT_ABOARD);
    return true;
  }
  const now = common.core().World.getProcessCycle();
  const last = lastRepairTick.get(player);
  if (last !== undefined && now >= last && now < last + REPAIR_DELAY_TICKS) return true;
  const inventory = player.getInventory();
  if (!inventory.contains(event.itemId)) return true;
  inventory.deleteNumber(event.itemId, 1);
  lastRepairTick.set(player, now);
  if (aboard.boat.helmPlayerId !== player.getIndex()) {
    player.performAnimation(new (common.core().Animation)(ANIM_REPAIR));
  }
  for (const delay of SOUND_DELAYS) playSound(player, SOUND_REPAIR, delay);
  common.spam(player, REPAIRED);
  BoatHp.heal(aboard.owner, aboard.owned, heals);
  const hitpoints = BoatHp.hitpointsOf(aboard.owned);
  for (const guest of common.core().Sailing.guestsOf(aboard.boat)) {
    guest.getPacketSender().sendVarbit(VARBIT.SIDEPANEL_BOAT_HP, hitpoints);
  }
  const gunner = require("./Cannon.SeaCombat").mannedBy(player);
  if (gunner) {
    gunner.nextAttackTick = Math.max(gunner.nextAttackTick, now + ATTACK_DELAY_TICKS);
  }
  return true;
}

function attach(api) {
  common.init(api);
  for (const name of KIT_NAMES) api.onItemAction(name, { Apply: apply });
}

module.exports = attach;
module.exports.apply = apply;
