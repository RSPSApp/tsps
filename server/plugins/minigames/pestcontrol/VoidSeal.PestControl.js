"use strict";

/**
 * The Void seal's Rub, in the inventory and worn (docs/pest-control.md, "Void seal").
 *
 * rsprox.net recording 4017 (rev 237), eight rubs of one seal in a veteran game:
 * - With a pest on or next to the player's tile: "You unleash the power of the Void Knights!",
 *   the player plays pest_magic_attack with spotanim pest_spiral_attack_on_player, each of those
 *   pests takes a hit with pest_spiral_attack_on_enemy, and the seal loses a charge (seal(7) becomes
 *   seal(6) in the same slot). Pests two or more tiles away are left alone.
 * - The hitsplats are the "others" type (17) even to the player who rubbed it: the seal's damage
 *   is not the player's, so it does not raise their activity bar (Wiki: Void seal).
 * - With no pest that close: "There are no monsters near you!", and the charge is kept.
 * - Seal(1), worn and rubbed from the equipment tab: both messages, then "The seal dissolves as
 *   the last of its power is unleashed!", and the neck slot empties.
 * rsprox.net recording 4015: a rub off the island says "You can only use this whilst in Pest
 * Control." and keeps the charge.
 *
 * Wiki (Void seal): 8-12 damage. The three pests one rub hit in recording 4017 all took 11, so the
 * damage is rolled once per rub.
 */

const SEALS = [
  "VOID_SEAL_1_", "VOID_SEAL_2_", "VOID_SEAL_3_", "VOID_SEAL_4_",
  "VOID_SEAL_5_", "VOID_SEAL_6_", "VOID_SEAL_7_", "VOID_SEAL_8_",
];
const MIN_DAMAGE = 8;
const MAX_DAMAGE = 12;
/** How far from the player's tile a pest may stand and still be hit (rec 4017). */
const RANGE = 1;

const SEQ_RUB = 6887; // pest_magic_attack
const SPOTANIM_PLAYER = 1177; // pest_spiral_attack_on_player
const SPOTANIM_PEST = 1176; // pest_spiral_attack_on_enemy

const MESSAGES = {
  unleash: "You unleash the power of the Void Knights!",
  dissolve: "The seal dissolves as the last of its power is unleashed!",
  noMonsters: "There are no monsters near you!",
  outside: "You can only use this whilst in Pest Control.",
};

let core;

/** The charges a seal holds, from its name ("Void seal(7)"), or 0 for something else. */
function chargesOf(itemId) {
  const name = core.CacheDefinitions.getItem(itemId)?.name ?? "";
  const match = /^Void seal\(([1-8])\)$/.exec(name);
  return match ? Number(match[1]) : 0;
}

/** Tiles between the player's tile and the nearest tile under the NPC. */
function distanceTo(player, npc) {
  const p = player.getLocation();
  const n = npc.getLocation();
  const size = Math.max(1, npc.getSize?.() ?? 1);
  const dx = Math.max(n.getX() - p.getX(), 0, p.getX() - (n.getX() + size - 1));
  const dy = Math.max(n.getY() - p.getY(), 0, p.getY() - (n.getY() + size - 1));
  return Math.max(dx, dy);
}

/** The live pests of this game on or next to the player: not the knight, squire or portals. */
function pestsNear(match, player) {
  const z = player.getLocation().getZ();
  return [...match.npcs].filter((npc) => npc !== match.knight && npc !== match.squire
    && !match.portalByNpc.has(npc)
    && npc.isRegistered?.() !== false && npc.getHitpoints() > 0
    && npc.getLocation().getZ() === z && distanceTo(player, npc) <= RANGE);
}

/** Puts the seal with one charge fewer where it was, or empties that slot for the last one. */
function spendCharge(player, event, charges) {
  const next = charges > 1 ? new core.Item(core.ItemIdentifiers[SEALS[charges - 2]], 1) : new core.Item(-1, 0);
  if (event.interfaceId === core.Equipment.INVENTORY_INTERFACE_ID) {
    player.getEquipment().setItem(core.Equipment.AMULET_SLOT, next);
    player.getEquipment().refreshItems();
    core.BonusManager.update(player);
    player.getUpdateFlag().flag(core.Flag.APPEARANCE);
  } else {
    player.getInventory().setItem(event.slot, next).refreshItems();
  }
}

function rub(event, random = Math.random) {
  const { player } = event;
  const charges = chargesOf(event.itemId);
  if (charges === 0) return false;
  const match = player.getAttribute?.("pest-control:match");
  if (!match?.npcs) {
    player.sendMessage(MESSAGES.outside);
    return true;
  }
  const pests = pestsNear(match, player);
  if (pests.length === 0) {
    player.sendMessage(MESSAGES.noMonsters);
    return true;
  }
  player.sendMessage(MESSAGES.unleash);
  if (charges === 1) player.sendMessage(MESSAGES.dissolve);
  player.performAnimation(new core.Animation(SEQ_RUB));
  player.performGraphic(new core.Graphic(SPOTANIM_PLAYER));
  const damage = MIN_DAMAGE + Math.floor(random() * (MAX_DAMAGE - MIN_DAMAGE + 1));
  for (const npc of pests) {
    npc.performGraphic(new core.Graphic(SPOTANIM_PEST));
    // No source: live shows it as someone else's hit, and it is no damage of the player's.
    npc.getCombat().getHitQueue().addPendingDamage([new core.HitDamage(damage, core.HitMask.RED)]);
  }
  spendCharge(player, event, charges);
  return true;
}

module.exports = function registerVoidSeal(api) {
  core = api.core;
  for (let charges = 1; charges <= SEALS.length; charges++) {
    api.onItemAction(`Void seal(${charges})`, { Rub: (event) => rub(event) });
  }
};
module.exports._test = { rub, chargesOf, distanceTo, pestsNear, SEALS, MESSAGES, SEQ_RUB, SPOTANIM_PLAYER, SPOTANIM_PEST };
