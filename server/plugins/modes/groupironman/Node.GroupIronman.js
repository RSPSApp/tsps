"use strict";

/**
 * The Node, the Group Ironman islands south of Tutorial Island (Wiki: The Node, Group Ironman
 * tutor, Group Storage tutor; launch post). Its NPCs are ordinary spawns (npc-spawns.json).
 *
 * - Getting there: a Group Ironman who finishes Tutorial Island arrives here instead of the
 *   mainland ("tutorial-island:destination"); from Lumbridge, the portal by the general store
 *   (gim_portal_lumbridge, a loc only Group Ironmen see) leads here; so does the Group ironman
 *   helm's Teleport. The Node's own portal (gim_portal) leads back to it. Going to the mainland
 *   the first time makes them a player who has played before (Variants.EXPERIENCED_ATTRIBUTE).
 * - Tony (Group Ironman tutor): his transcript plays on Talk-to; "Yes, leave my group." starts
 *   leaving, and a leader's "Rename group." asks for the new name. Armour, and the armour crates,
 *   hand out the set of the player's mode, the platebody showing their group's size (II to V).
 * - Maggie (Group Storage tutor): her bank, and the chest beside her, are for players who haven't
 *   gone to the mainland yet ("This bank is for new adventurers only, ...").
 */

const Common = require("./Common.GroupIronman");
const Variants = require("./Variants.GroupIronman");

/** Ours: a walkable tile beside each portal (the Wiki gives none; The Node's checked in game). */
const NODE_ARRIVAL = Object.freeze({ x: 3095, y: 3039, z: 0 });
const LUMBRIDGE_ARRIVAL = Object.freeze({ x: 3217, y: 3233, z: 0 });
const TONY = "Group Ironman tutor";
const MAGGIE = "Group Storage tutor";
const ARMOUR_LINE = "There you go. Wear it with pride.";
const ARMOUR_ALREADY = "I think you've already got the whole set.";
const BANK_REFUSED = "This bank is for new adventurers only, you cannot access it as you've already started your Group Ironman journey.";
const MESSAGE = Object.freeze({
  NOT_GROUP_IRONMAN: "Only Group Ironmen can use this.",
  ARRIVED: "Welcome to The Node. Form your group here before you set out.",
  RENAME_PROMPT: "Enter your group's new name:",
});

const locId = (name) => Common.api.core.CacheDefinitions.getLocId(name);
const location = ({ x, y, z }) => new Common.api.core.Location(x, y, z);

function teleport(player, destination) {
  const { TeleportHandler, TeleportType } = Common.api.core;
  const to = location(destination);
  if (TeleportHandler.checkReqs(player, to)) TeleportHandler.teleport(player, to, TeleportType.NORMAL, false);
}

/** "tutorial-island:destination" { player, location, welcome }: a Group Ironman goes to The Node. */
function tutorialDestination(request) {
  if (!Common.isGroupIronman(request.player)) return;
  request.location = NODE_ARRIVAL;
  request.welcome = MESSAGE.ARRIVED;
}

/** "Portal" Enter: the Lumbridge one leads to The Node, The Node's back to Lumbridge. */
function portal(event) {
  const { player, objectId } = event;
  const toNode = objectId === locId("gim_portal_lumbridge") || objectId === locId("gim_portal_lumbridge_portal");
  const toMainland = objectId === locId("gim_portal");
  if (!toNode && !toMainland) return false;
  if (!Common.isGroupIronman(player)) {
    player.getPacketSender().sendMessage(MESSAGE.NOT_GROUP_IRONMAN);
    return true;
  }
  if (toMainland) player.setAttribute(Variants.EXPERIENCED_ATTRIBUTE, true);
  teleport(player, toNode ? NODE_ARRIVAL : LUMBRIDGE_ARRIVAL);
  return true;
}

/** The Group ironman helm's Teleport: to The Node. */
function helmTeleport({ player }) {
  if (!Common.isGroupIronman(player)) {
    player.getPacketSender().sendMessage(MESSAGE.NOT_GROUP_IRONMAN);
    return true;
  }
  teleport(player, NODE_ARRIVAL);
  return true;
}

/** The armour of the player's mode, the platebody numbered by their group's size (2-5). */
function armourFor(player) {
  const { ItemIdentifiers } = Common.api.core;
  const hardcore = Common.modeOf(player) === Common.modeOfVariant("hardcore");
  const prefix = hardcore ? "HARDCORE_GROUP_IRONMAN" : "GROUP_IRONMAN";
  const size = Math.max(2, Math.min(5, Common.groupOf(player).group?.members.length ?? 2));
  const platebody = ItemIdentifiers[`${prefix}_PLATEBODY`] + (size - 2) * 2;
  return [ItemIdentifiers[`${prefix}_HELM`], platebody, ItemIdentifiers[`${prefix}_PLATELEGS`], ItemIdentifiers[`${prefix}_BRACERS`]];
}

/** Hands out what the player lacks of their set; returns Tony's line. */
function giveArmour(player) {
  if (!Common.isGroupIronman(player)) return MESSAGE.NOT_GROUP_IRONMAN;
  const inventory = player.getInventory();
  const missing = armourFor(player).filter((id) => !inventory.contains(id) && !player.getEquipment().contains(id));
  if (!missing.length) return ARMOUR_ALREADY;
  if (inventory.getFreeSlots() < missing.length) return "You don't have enough inventory space.";
  for (const id of missing) inventory.adds(id, 1);
  return ARMOUR_LINE;
}

/** Tony's Armour option. */
function tonyArmour({ player, npc }) {
  const { DialogueChainBuilder, NpcDialogue } = Common.api.core;
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(new NpcDialogue(0, npc?.getId?.() ?? 0, giveArmour(player))));
  return true;
}

/** The armour crates' Take: the Hardcore crate only for a Hardcore Group Ironman. */
function crate(event) {
  const { player, objectId } = event;
  if (objectId === locId("gim_armour_crate_hardcore") && Common.modeOf(player) !== Common.modeOfVariant("hardcore")) {
    player.getPacketSender().sendMessage(MESSAGE.NOT_GROUP_IRONMAN);
    return true;
  }
  player.getPacketSender().sendMessage(giveArmour(player));
  return true;
}

/** The chest beside Maggie (gim_bank_chest); other chests named "Chest" aren't this unit's. */
function chest(event) {
  if (event.objectId !== locId("gim_bank_chest")) return false;
  return bank(event);
}

/** Maggie's Bank, and the chest beside her: only before the mainland. */
function bank({ player }) {
  if (Variants.isExperienced(player)) {
    player.getPacketSender().sendMessage(BANK_REFUSED);
    return true;
  }
  player.getBank(player.getCurrentBankTab()).open();
  return true;
}

/** "npc-dialogue:choice" on Tony's and Maggie's transcripts. */
function choice(event) {
  const { player, option } = event;
  const npcName = String(event.definition?.getName?.() ?? event.npc?.getDefinition?.()?.getName?.() ?? "");
  if (npcName === TONY && option === "Yes, leave my group.") {
    Common.api.emitCustomEvent("grouping:leave", { player });
  } else if (npcName === TONY && option === "Rename group." && Common.groupOf(player).member?.role === "leader") {
    event.end = true;
    player.getPacketSender().sendInterfaceRemoval();
    player.setEnteredSyntaxAction({ execute: (name) => Common.api.emitCustomEvent("grouping:rename", { player, name }) });
    player.getPacketSender().sendEnterInputPrompt(MESSAGE.RENAME_PROMPT);
  } else if (npcName === MAGGIE && option === "I'd like to access my bank account please." && !Variants.isExperienced(player)) {
    event.end = true;
    bank({ player });
  }
}

module.exports = {
  NODE_ARRIVAL, LUMBRIDGE_ARRIVAL, MESSAGE, BANK_REFUSED,
  tutorialDestination, portal, helmTeleport, armourFor, giveArmour, tonyArmour, crate, chest, bank, choice,
};
