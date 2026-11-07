"use strict";

/** Shared player charges, not item metadata (Wiki: Expeditious bracelet; docs/slayer.md). */
const CHARGES_ATTRIBUTE = "slayer:expeditious-charges";
const MAX_CHARGES = 30;
const ACTIVATION_CHANCE = 0.25;
const REGENERATION_CHANCE = 0.1;
const ACTIVATION_MESSAGE = "Your expeditious bracelet helps you progress your slayer task faster.";

let api = null;
let core = null;

function init(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
}

function charges(player) {
  const saved = player.getAttribute(CHARGES_ATTRIBUTE);
  return Number.isInteger(saved) && saved > 0 && saved <= MAX_CHARGES ? saved : MAX_CHARGES;
}

/** 21178 and 21179 share the name, but the cache makes them the note and bank placeholder: neither is worn or used. */
function isBracelet(item) {
  return item?.getId() === core.ItemIdentifiers.EXPEDITIOUS_BRACELET;
}

function chargesLeft(remaining) {
  return `${remaining} charge${remaining === 1 ? "" : "s"} left`;
}

/**
 * Called for an eligible task kill, after its Slayer XP, where the count would fall by one:
 * returns the extra kills the bracelet credits (0 or 1). The Wiki lists no excluded monsters.
 */
function extraKills(player, npc, random = Math.random) {
  const equipment = player.getEquipment();
  if (!isBracelet(equipment.getItems()[core.Equipment.HANDS_SLOT])) return 0;
  if (random() >= ACTIVATION_CHANCE) return 0;
  const remaining = charges(player) - 1;
  player.setAttribute(CHARGES_ATTRIBUTE, remaining || MAX_CHARGES);
  let suffix;
  if (remaining > 0) {
    suffix = `It has ${chargesLeft(remaining)}.`;
  } else {
    // Wiki (Expeditious bracelet): the claimed Elite Combat Achievement rewards add a 10% chance to
    // regenerate instead of disappearing.
    const reward = { player, tier: "Elite", claimed: false };
    api.emitCustomEvent("combat-achievements:tier", reward);
    if (reward.claimed && random() < REGENERATION_CHANCE) {
      suffix = "It then regenerates itself to full charge!";
    } else {
      equipment.set(core.Equipment.HANDS_SLOT, new core.Item(-1));
      equipment.refreshItems();
      suffix = "It then crumbles to dust.";
    }
  }
  player.getPacketSender().sendTypedMessage(core.ChatType.SPAM, `${ACTIVATION_MESSAGE} ${suffix}`);
  return 1;
}

function check({ player, item }) {
  if (!isBracelet(item)) return false;
  player.sendMessage(`Your expeditious bracelet has ${chargesLeft(charges(player))}.`);
}

function breakBracelet({ player, item, slot, interfaceId }) {
  if (!isBracelet(item) || interfaceId === core.Equipment.INVENTORY_INTERFACE_ID) return false;
  const inventory = player.getInventory();
  if (!isBracelet(inventory.get(slot))) return false;
  inventory.deleteAtSlot(slot, 1);
  player.setAttribute(CHARGES_ATTRIBUTE, MAX_CHARGES);
  player.sendMessage(`You break the expeditious bracelet. Your next bracelet will start with ${MAX_CHARGES} charges.`);
}

function attach(pluginApi) {
  pluginApi.persistAttribute(CHARGES_ATTRIBUTE, MAX_CHARGES);
  pluginApi.onItemAction("Expeditious bracelet", { Check: check, Break: breakBracelet });
}

module.exports = { init, attach, extraKills, charges, CHARGES_ATTRIBUTE };
