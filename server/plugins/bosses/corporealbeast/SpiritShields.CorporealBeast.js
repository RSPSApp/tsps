"use strict";

/**
 * Spirit shields: blessing one with a holy elixir and attaching a sigil at an anvil.
 *
 * Wiki ("Blessed spirit shield", "Spectral sigil" and the shields' pages):
 * - A holy elixir used on a spirit shield blesses it; it needs 85 Prayer, which can't be
 *   boosted. Holy elixir transcript: "The spirit shield glows an eerie holy glow."
 * - A sigil used on an anvil, with a hammer and a blessed spirit shield in the inventory,
 *   attaches it: 90 Prayer (not boostable) and 85 Smithing (boostable), for 1,800 Smithing XP.
 *   Arcane, spectral and elysian sigils make the arcane, spectral and elysian spirit shields.
 * - The spectral shield halves most prayer-draining attacks; here that is the Corporeal Beast's
 *   drain (CorpAttacks.js) - other prayer drains don't share a path to hook yet.
 *   (The elysian shield's damage reduction is already in core combat.)
 * Estimates (no transcript): the sigil's message and the level messages.
 * Not done: Abbot Langley's paid service.
 */

const Shared = require("./CorpShared");

const ITEM = {
  SPIRIT_SHIELD: 12829,
  BLESSED_SPIRIT_SHIELD: 12831,
  HOLY_ELIXIR: 12833,
  HAMMER: 2347,
};
/** Sigil -> the shield it makes. */
const SIGILS = new Map([
  [12827, 12825], // arcane
  [12823, 12821], // spectral
  [12819, 12817], // elysian
]);
const LEVEL = { bless: 85, attachPrayer: 90, attachSmithing: 85 };
const ATTACH_XP = 1800;

function itemBox(player, itemId, text) {
  const { DialogueChainBuilder, ItemStatementDialogue } = Shared.core();
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(new ItemStatementDialogue(0, itemId, text)));
}

/** Holy elixir on a spirit shield. */
function bless({ player, usedItem, usedItemSlot, usedWithItem, usedWithItemSlot }) {
  const { Item, Skill } = Shared.core();
  const skills = player.getSkillManager();
  if (skills.getMaxLevel(Skill.PRAYER) < LEVEL.bless) {
    player.sendMessage(`You need a Prayer level of ${LEVEL.bless} to bless the spirit shield.`);
    return true;
  }
  const shieldSlot = usedItem.getId() === ITEM.SPIRIT_SHIELD ? usedItemSlot : usedWithItemSlot;
  const elixirSlot = shieldSlot === usedItemSlot ? usedWithItemSlot : usedItemSlot;
  const inventory = player.getInventory();
  inventory.setItem(elixirSlot, new Item(-1, 0));
  inventory.setItem(shieldSlot, new Item(ITEM.BLESSED_SPIRIT_SHIELD, 1));
  inventory.refreshItems();
  itemBox(player, ITEM.BLESSED_SPIRIT_SHIELD, "The spirit shield glows an eerie holy glow.");
  return true;
}

/** A sigil on an anvil, with a hammer and a blessed spirit shield. */
function attach({ player, itemId }) {
  const shield = SIGILS.get(itemId);
  if (shield == null) return false;
  const { Skill } = Shared.core();
  const inventory = player.getInventory();
  const skills = player.getSkillManager();
  if (!inventory.contains(ITEM.BLESSED_SPIRIT_SHIELD)) {
    player.sendMessage("You need a blessed spirit shield to attach the sigil to.");
    return true;
  }
  if (!inventory.contains(ITEM.HAMMER)) {
    player.sendMessage("You need a hammer to attach the sigil.");
    return true;
  }
  if (skills.getMaxLevel(Skill.PRAYER) < LEVEL.attachPrayer || skills.getCurrentLevel(Skill.SMITHING) < LEVEL.attachSmithing) {
    player.sendMessage(`You need ${LEVEL.attachPrayer} Prayer and ${LEVEL.attachSmithing} Smithing to attach the sigil.`);
    return true;
  }
  inventory.deleteNumber(itemId, 1);
  inventory.deleteNumber(ITEM.BLESSED_SPIRIT_SHIELD, 1);
  inventory.adds(shield, 1);
  inventory.refreshItems();
  skills.addExperience(Skill.SMITHING, ATTACH_XP);
  itemBox(player, shield, "You attach the sigil to the blessed spirit shield.");
  return true;
}

module.exports = function registerSpiritShields(api) {
  Shared.bind(api);
  api.onItemOnItem("Holy elixir", "Spirit shield", bless, { noted: false });
  for (const name of ["Arcane sigil", "Spectral sigil", "Elysian sigil"]) {
    api.onItemOnObject(name, "Anvil", attach, { noted: false });
  }
};

Object.assign(module.exports, { ITEM, SIGILS, LEVEL, ATTACH_XP, bless, attach });
