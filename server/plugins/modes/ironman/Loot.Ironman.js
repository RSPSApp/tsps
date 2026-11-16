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
 *   player instead, so only non-Iron players get it once it goes public (Wiki). The same answer,
 *   `player-death:loot-owner`, covers what other plugins drop for the killer (repair coins, ether, fees).
 * - No combat experience from fighting players (Wiki).
 * The two kill messages are the loot restriction messages All Settings can turn off (varbit 13040).
 *
 * A Group Ironman's group mates aren't "other players" here (Wiki, Group Ironman Mode): their drops
 * can be picked up, a kill only group mates helped with still drops (to whoever the killer is, the
 * top damager), and a group mate killed in the Wilderness can be looted. Anyone outside the group
 * helping still means no loot.
 */
const Common = require("./Common.Ironman");

const WARNED_ATTRIBUTE = "ironman:kill-credit-warned";
/** iron_noloot_message_disabled: All Settings "Iron loot restriction messages" off. */
const LOOT_MESSAGES_DISABLED_VARBIT = 13040;
const COMBAT_SKILLS = new Set(["ATTACK", "STRENGTH", "DEFENCE", "RANGED", "MAGIC", "HITPOINTS"]);
/** The share of PvP combat experience a Group Ironman keeps (Wiki: 1/8). */
const GROUP_PVP_EXPERIENCE = 1 / 8;

function pickup(event) {
  if (cannotTake(event)) event.handled = true;
}

function telegrab(event) {
  if (event.allow !== false && cannotTake(event)) event.allow = false;
}

function cannotTake(event) {
  const { player, groundItem } = event;
  if (!Common.isIron(player)) return false;
  const owner = groundItem?.getOwner?.();
  if (!owner || owner.toLowerCase() === player.getUsername().toLowerCase()) return false;
  if (Common.groupMate(player, owner)) return false;
  player.sendMessage(Common.message("pickup"));
  return true;
}

/**
 * A shared kill's loot is lost, except what the monster's plugin keeps for Ironmen
 * (`ironman:shared-kill-keeps` { player, npc, npcId, drops, keep }: item ids pushed onto `keep`).
 */
function rolledDrops(event) {
  const { player, drops, damagers } = event;
  if (!Common.isIron(player)) return;
  if (!(damagers ?? []).some((other) => other && other !== player && !Common.groupMate(player, other))) return;
  const request = { player, npc: event.npc, npcId: event.npcId, drops, keep: [] };
  Common.api.emitCustomEvent("ironman:shared-kill-keeps", request);
  const kept = drops.filter((drop) => request.keep.includes(drop.itemId));
  if (kept.length === drops.length) return;
  drops.splice(0, drops.length, ...kept);
  restrictionMessage(player, "sharedKill");
}

function restrictionMessage(player, key) {
  if (player.getPacketSender?.()?.getVarbit?.(LOOT_MESSAGES_DISABLED_VARBIT) === 1) return;
  player.sendMessage(Common.message(key));
}

function attacking(event) {
  const { attacker, target } = event;
  if (!attacker?.isPlayer?.() || !target?.isNpc?.() || !Common.isIron(attacker)) return;
  const others = target.getCombat?.().getRecentDamagers?.() ?? [];
  if (!others.some((other) => other !== attacker && !Common.groupMate(attacker, other))) return;
  if (attacker.getAttribute(WARNED_ATTRIBUTE) === target) return;
  attacker.setAttribute(WARNED_ATTRIBUTE, target);
  restrictionMessage(attacker, "killCredit");
}

function playerLoot(event) {
  const { player, killer, item, location } = event;
  if (!killer || !Common.isIron(killer) || !event.dropEligible || Common.groupMate(killer, player)) return;
  event.suppressDefaultDrop = true;
  // Handled: the item is on the floor for its owner now, so a loot key (the killer's setting) must not take it too.
  event.handled = true;
  Common.core.ItemOnGroundManager.registerLocation(player, item, location);
}

/** `player-death:loot-owner` (PlayerDeathTask.lootOwner): an Ironman killer's PvP loot is the victim's. */
function lootOwner(event) {
  const { killer, player } = event ?? {};
  if (killer && killer !== player && Common.isIron(killer) && !Common.groupMate(killer, player)) event.owner = player;
}

function experience(event) {
  const { player, skill } = event;
  if (!Common.isIron(player)) return;
  const name = Object.entries(Common.core.Skill).find(([, value]) => value === skill)?.[0];
  if (!COMBAT_SKILLS.has(name) || !player.getCombat?.().getTarget?.()?.isPlayer?.()) return;
  // Wiki (Group Ironman Mode, Combat): Group Ironmen get 1/8 of the combat experience in PvP.
  if (Common.isGroup(player)) event.multiplier = (Number(event.multiplier) || 1) * GROUP_PVP_EXPERIENCE;
  else event.allow = false;
}

module.exports = function attach(api) {
  api.onGroundItemPickup(pickup);
  api.onCustomEvent("magic:can-telekinetic-grab", telegrab);
  api.onCustomEvent("ground-item:can-store", telegrab);
  api.onCustomEvent("npc-drops:roll", rolledDrops);
  api.onCanAttack(attacking);
  api.onPlayerDeathItemDrop(playerLoot);
  api.onCustomEvent("player-death:loot-owner", lootOwner);
  api.onCanGainExperience(experience);
};
