"use strict";

/**
 * Group Ironman armour (Wiki: Group ironman armour, Group ironman platebody; Tony's transcript; the cache).
 *
 * - The set is the cache's for the player's mode: group_ironman_*, hardcore_group_ironman_*, or the
 *   "(unranked)" group_ironman_*_unranked. The platebody is numbered by the group's size, II to V
 *   (platebody02 to 05); the cache has no I, so fewer than two in the group still gets II (ours, the
 *   user's choice).
 * - Tony's Armour hands out what the player lacks; Adam in Lumbridge asks "ironman:armour" for the set.
 * - A numbered platebody that doesn't match the group's size crumbles as the player equips it
 *   (Wiki: "The platebody crumbles to dust as you attempt to equip it. You can get a new one from an
 *   Ironman tutor.").
 * - The armour crates (Armour crate, Hardcore armour crate; Take): the crate of the player's own mode
 *   hands out its set, the Armour crate serving Unranked players too. The other crate changes the
 *   player's Group Iron mode to its own, which only a player who hasn't been to the mainland may do
 *   (Tony's transcript, at the crates: "You can only change your Group Iron mode if you haven't been
 *   to the mainland."; Update:Group Ironman: the Hardcore Armour Crate lets a player "re-select Hardcore"). Ours: the question first, only outside a group, Unranked can't change, and
 *   the other modes' armour (carried, worn or banked) crumbles when the mode changes.
 */

const Common = require("./Common.GroupIronman");
const Variants = require("./Variants.GroupIronman");

const SIZES = [2, 3, 4, 5];
const VARIANTS = ["ranked", "hardcore", "unranked"];
const LINE = Object.freeze({
  GIVEN: "There you go. Wear it with pride.",
  ALREADY: "I think you've already got the whole set.",
  MAINLAND: "You can only change your Group Iron mode if you haven't been to the mainland.",
});
const MESSAGE = Object.freeze({
  NOT_GROUP_IRONMAN: "Only Group Ironmen can use this.",
  NO_SPACE: "You don't have enough inventory space.",
  CRUMBLED: "The platebody crumbles to dust as you attempt to equip it. You can get a new one from an Ironman tutor.",
  // Ours: the crates' question (saying so when the old mode's armour will go), an Unranked player at
  // the Hardcore crate, and the old mode's armour going.
  SWITCH: (label, losesArmour) => `Become a ${label}?${losesArmour ? " Your old armour will crumble." : ""}`,
  UNRANKED: "An Unranked Group Ironman can't change their Group Iron mode.",
  OLD_ARMOUR: "The armour of your old Group Iron mode crumbles to dust.",
});

const objId = (name) => Common.api.core.CacheDefinitions.getObjId(name);
const locId = (name) => Common.api.core.CacheDefinitions.getLocId(name);
const variantOf = (player) => Common.variantOfMode(Common.modeOf(player));

function names(variant) {
  const prefix = variant === "hardcore" ? "hardcore_group_ironman" : "group_ironman";
  const suffix = variant === "unranked" ? "_unranked" : "";
  return (piece) => `${prefix}_${piece}${suffix}`;
}

/** The group's size as the platebody shows it: 2 to 5. */
function groupSize(player) {
  return Math.max(2, Math.min(5, Common.groupOf(player).group?.members.length ?? 0));
}

/** The set of `variant` ("ranked", "hardcore", "unranked") for a group of `size`. */
function setOf(variant, size) {
  const name = names(variant);
  return ["helm", `platebody0${size}`, "platelegs", "gloves"].map((piece) => objId(name(piece)));
}

function armourFor(player) {
  return setOf(variantOf(player), groupSize(player));
}

let platebodies = null;
/** Every numbered platebody: id -> the group size it shows. */
function platebodySize(itemId) {
  if (!platebodies) {
    platebodies = new Map();
    for (const variant of VARIANTS) {
      for (const size of SIZES) platebodies.set(objId(names(variant)(`platebody0${size}`)), size);
    }
  }
  return platebodies.get(itemId) ?? null;
}

/** Hands out what the player lacks of their set; returns the line to say. */
function giveArmour(player) {
  if (!Common.isGroupIronman(player)) return MESSAGE.NOT_GROUP_IRONMAN;
  const inventory = player.getInventory();
  const missing = armourFor(player).filter((id) => !inventory.contains(id) && !player.getEquipment().contains(id));
  if (!missing.length) return LINE.ALREADY;
  if (inventory.getFreeSlots() < missing.length) return MESSAGE.NO_SPACE;
  for (const id of missing) inventory.adds(id, 1);
  return LINE.GIVEN;
}

function tonySays(player, text, npcId = Common.api.core.CacheDefinitions.getNpcId("ironman_tutor_node") ?? 0) {
  const { DialogueChainBuilder, NpcDialogue } = Common.api.core;
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(new NpcDialogue(0, npcId, text)));
}

/** Tony's Armour option. */
function tonyArmour({ player, npc }) {
  tonySays(player, giveArmour(player), npc?.getId?.());
  return true;
}

/** The armour crates' Take. */
function crate({ player, objectId }) {
  const say = (text) => player.getPacketSender().sendMessage(text);
  if (!Common.isGroupIronman(player)) return say(MESSAGE.NOT_GROUP_IRONMAN), true;
  const crateVariant = objectId === locId("gim_armour_crate_hardcore") ? "hardcore" : "ranked";
  const variant = variantOf(player);
  if (variant === crateVariant || (variant === "unranked" && crateVariant === "ranked")) return say(giveArmour(player)), true;
  if (variant === "unranked") return say(MESSAGE.UNRANKED), true;
  if (Variants.isExperienced(player)) return tonySays(player, LINE.MAINLAND), true;
  if (Common.groupOf(player).group) return Common.tell(player, "unrankedInGroup"), true;
  const label = Common.data.variants[crateVariant].label;
  Common.api.sendMultiChatboxPrompt(player, MESSAGE.SWITCH(label, holdsOtherArmour(player, crateVariant)),
    "Yes.", () => {
      Common.setMode(player, Common.modeOfVariant(crateVariant));
      if (destroyOtherArmour(player, crateVariant)) say(MESSAGE.OLD_ARMOUR);
      say(giveArmour(player));
    },
    "No.", () => {});
  return true;
}

/** Every piece of the sets of the modes other than `keep`. */
function otherModesArmour(keep) {
  const ids = new Set();
  for (const variant of VARIANTS) {
    if (variant === keep) continue;
    for (const size of SIZES) for (const id of setOf(variant, size)) ids.add(id);
  }
  return ids;
}

/** The containers the other modes' armour goes from: carried, worn or banked. */
function armourContainers(player) {
  return [player.getInventory(), player.getEquipment(), ...(player.getBanks?.() ?? [])].filter(Boolean);
}

/** Whether the player has any of the other modes' armour, carried, worn or banked. */
function holdsOtherArmour(player, keep) {
  const ids = otherModesArmour(keep);
  return armourContainers(player).some((container) => container.getItems().some((item) => item && ids.has(item.getId())));
}

/** Removes the other modes' armour, carried, worn or banked; true when any went. */
function destroyOtherArmour(player, keep) {
  const ids = otherModesArmour(keep);
  const strip = (container) => {
    let removed = false;
    container.getItems().forEach((item, slot) => {
      if (item && ids.has(item.getId())) {
        container.deleteAtSlot(slot, item.getAmount(), false);
        removed = true;
      }
    });
    return removed;
  };
  let removed = false;
  if (strip(player.getInventory())) {
    removed = true;
    player.getInventory().refreshItems();
  }
  if (strip(player.getEquipment())) {
    removed = true;
    player.getEquipment().refreshItems();
  }
  for (const bank of player.getBanks?.() ?? []) {
    if (bank && strip(bank)) {
      removed = true;
      bank.sortItems?.();
    }
  }
  return removed;
}

/** onCanEquip: a numbered platebody for another group size crumbles. */
function crumble(event) {
  const { player, item } = event;
  if (event.allow === false || !item || !Common.isGroupIronman(player)) return;
  const size = platebodySize(item.getId());
  if (size === null || size === groupSize(player)) return;
  event.allow = false;
  player.getInventory().delete(item.getId(), 1);
  player.getPacketSender().sendMessage(MESSAGE.CRUMBLED);
}

/** "ironman:armour" { player, items }: Adam's set for a Group Ironman, numbered for their group. */
function adamArmour(request) {
  if (!request.items && Common.isGroupIronman(request.player)) request.items = armourFor(request.player);
}

module.exports = {
  LINE, MESSAGE, groupSize, setOf, armourFor, platebodySize, giveArmour, tonyArmour, crate, crumble, adamArmour,
};
