"use strict";

// Skill-level reward/slot consumption adapted from Void RandomEventGift.kt (BSD-3).
// The skill is chosen on the xpreward interface (plugins/interface/XpReward.plugin.js), as
// captured: "Your wish has been granted! You have been awarded 980 Runecraft XP!" (10 x level),
// sent as a type 115 game message as well as in the message box (3467 tick 4038).
// The Book of Knowledge uses the same flow at 15 x level.
const pending = new WeakMap();
const MESSAGE_BOX_CHAT_TYPE = 115;

function openReward(api, { player, item, itemId, slot }, multiplier) {
  if (itemId !== api.core.ItemIdentifiers.LAMP && itemId !== api.core.ItemIdentifiers.BOOK_OF_KNOWLEDGE) {
    return false;
  }
  if (!player.isRegistered() || player.getInventory().get(slot) !== item) return true;
  const request = { item, itemId, slot, multiplier };
  pending.set(player, request);
  api.emitCustomEvent("xpreward:open", { player, onConfirm: (skill, name) => grant(api, player, request, skill, name) });
  return true;
}

function rub(api, event) {
  return openReward(api, event, 10);
}

function read(api, event) {
  return openReward(api, event, 15);
}

/** The message box text, or null when the lamp/book is kept. */
function grant(api, player, request, skill, name = skill.getName()) {
  if (pending.get(player) !== request) return null;
  pending.delete(player);
  if (!player.isRegistered()) return null;
  const inventory = player.getInventory();
  if (inventory.get(request.slot) !== request.item || request.item.getId() !== request.itemId) return null;
  const manager = player.getSkillManager();
  const before = manager.getExperience(skill);
  const xp = manager.getMaxLevel(skill) * request.multiplier;
  // Keep the lamp when a world/account rule blocks XP (F2P member skill, XP lock).
  manager.addExperience(skill, xp, false);
  if (manager.getExperience(skill) === before) return null;
  inventory.deleteAtSlot(request.slot, 1);
  if (request.itemId !== api.core.ItemIdentifiers.LAMP) return `You have been awarded ${xp} ${name} XP!`;
  player.getPacketSender().sendTypedMessage(MESSAGE_BOX_CHAT_TYPE,
    `Your wish has been granted! You have been awarded ${xp} ${name} XP!`);
  return `Your wish has been granted!<br>You have been awarded ${xp} ${name} XP!`;
}

function cleanup({ player }) { pending.delete(player); }

module.exports = { rub, read, grant, cleanup };
