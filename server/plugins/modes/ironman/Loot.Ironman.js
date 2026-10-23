/**
 * An Ironman takes nothing from other players, and no loot they helped with (captured messages):
 * - Picking up an item another player owns (their drop or kill, even once it has gone public):
 *   "You're an Ironman, so you can't take items that other players have dropped." Unowned world
 *   spawns are fine.
 * - A kill another player damaged gives no drop: "As an Ironman, you don't get loot if other
 *   players helped you kill the monster." (bar what its plugin keeps, such as Scurrius' clues)
 * - Attacking an npc another player has damaged warns once: "As an Ironman, you might not receive
 *   kill-credit for this monster."
 * - A player an Ironman kills drops loot the Ironman can't take: it's registered to the fallen
 *   player instead, so only non-Iron players get it once it goes public (Wiki).
 * - No combat experience from fighting players (Wiki).
 */
const Common = require("./Common.Ironman");

const WARNED_ATTRIBUTE = "ironman:kill-credit-warned";
const COMBAT_SKILLS = new Set(["ATTACK", "STRENGTH", "DEFENCE", "RANGED", "MAGIC", "HITPOINTS"]);

function pickup(event) {
  if (!cannotTake(event)) return;
  event.handled = true;
}

function take(event) {
  if (event.allow === false || !cannotTake(event)) return;
  event.allow = false;
}

function cannotTake(event) {
  const { player, groundItem } = event;
  if (!Common.isIron(player)) return false;
  const owner = groundItem?.getOwner?.();
  if (!owner || owner.toLowerCase() === player.getUsername().toLowerCase()) return false;
  player.sendMessage(Common.message("pickup"));
  return true;
}

/**
 * A shared kill's loot is lost, except what the monster's plugin keeps for Ironmen
 * (`ironman:shared-kill-keeps` { player, npc, npcId, keep }: item ids pushed onto `keep`).
 */
function rolledDrops(event) {
  const { player, drops, damagers } = event;
  if (!Common.isIron(player)) return;
  if (!(damagers ?? []).some((other) => other && other !== player)) return;
  const request = { player, npc: event.npc, npcId: event.npcId, keep: [] };
  Common.api.emitCustomEvent("ironman:shared-kill-keeps", request);
  const kept = drops.filter((drop) => request.keep.includes(drop.itemId));
  drops.splice(0, drops.length, ...kept);
  player.sendMessage(Common.message("sharedKill"));
}

function attacking(event) {
  const { attacker, target } = event;
  if (!attacker?.isPlayer?.() || !target?.isNpc?.() || !Common.isIron(attacker)) return;
  const others = target.getCombat?.().getRecentDamagers?.() ?? [];
  if (!others.some((other) => other !== attacker)) return;
  if (attacker.getAttribute(WARNED_ATTRIBUTE) === target) return;
  attacker.setAttribute(WARNED_ATTRIBUTE, target);
  attacker.sendMessage(Common.message("killCredit"));
}

function playerLoot(event) {
  const { player, killer, item, location } = event;
  if (!killer || !Common.isIron(killer) || !event.dropEligible) return;
  event.suppressDefaultDrop = true;
  Common.core.ItemOnGroundManager.registerLocation(player, item, location);
}

function experience(event) {
  const { player, skill } = event;
  if (!Common.isIron(player)) return;
  const name = Object.entries(Common.core.Skill).find(([, value]) => value === skill)?.[0];
  if (!COMBAT_SKILLS.has(name)) return;
  if (player.getCombat?.().getTarget?.()?.isPlayer?.()) event.allow = false;
}

module.exports = function attach(api) {
  api.onGroundItemPickup(pickup);
  api.onCustomEvent("ground-items:take", take);
  api.onCustomEvent("npc-drops:roll", rolledDrops);
  api.onCanAttack(attacking);
  api.onPlayerDeathItemDrop(playerLoot);
  api.onCanGainExperience(experience);
};
