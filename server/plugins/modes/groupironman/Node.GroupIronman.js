"use strict";

/**
 * The Node, the Group Ironman islands south of Tutorial Island (Wiki: The Node, Group Ironman
 * tutor, Group Storage tutor; launch post). Its NPCs are ordinary spawns (npc-spawns.json).
 *
 * - Getting there: a Group Ironman who finishes Tutorial Island arrives here instead of the
 *   mainland ("tutorial-island:destination"); from Lumbridge, the portal by the general store
 *   (gim_portal_lumbridge, a loc only Group Ironmen see) leads here; so does the Group ironman
 *   helm's Teleport, and the rowboat at Tutorial Island's south end (gim_boat, The Node page's "boat
 *   on southern end of Tutorial Island"). A Group Ironman still on the tutorial takes that boat after the
 *   Ironman tutor (Wiki: Tutorial Island), so it ends the tutorial ("tutorial-island:leave"), which
 *   lands them here. The Node's own portal (gim_portal) leads back to it. Going to the mainland
 *   the first time makes them a player who has played before (Variants.EXPERIENCED_ATTRIBUTE).
 *   A Group Ironman with no formed group (none, or one still forming) chooses another game mode
 *   before the portal takes them (Update:Group Ironman: "you can just leave The Node without a
 *   group. You'll need to choose between the other game modes before being teleported to the
 *   mainland."); a group still forming is left first.
 * - Tony (Group Ironman tutor): his transcript plays on Talk-to; "Yes, leave my group." starts
 *   leaving, and a leader's "Rename group." asks for the new name. His Armour and the armour
 *   crates are Armour.GroupIronman.js.
 * - Maggie (Group Storage tutor): her bank, and the chest beside her, are for players who haven't
 *   gone to the mainland yet ("This bank is for new adventurers only, ...").
 */

const Common = require("./Common.GroupIronman");
const Store = require("./Store.GroupIronman");
const Variants = require("./Variants.GroupIronman");

/**
 * Ours: a walkable tile beside each portal (the Wiki gives none; The Node's checked in game). The
 * Lumbridge portal (3216,3235, 4 wide) is set in a wall along y 3234: its arrival is the open side,
 * north towards the general store.
 */
const NODE_ARRIVAL = Object.freeze({ x: 3095, y: 3039, z: 0 });
const LUMBRIDGE_ARRIVAL = Object.freeze({ x: 3217, y: 3236, z: 0 });
const TONY = "Group Ironman tutor";
const MAGGIE = "Group Storage tutor";
const BANK_REFUSED = "This bank is for new adventurers only, you cannot access it as you've already started your Group Ironman journey.";
const MESSAGE = Object.freeze({
  NOT_GROUP_IRONMAN: "Only Group Ironmen can use this.",
  // Learning the Ropes' transcript: a regular account at the way to The Node.
  BOAT_REFUSED: "Only Group Ironmen can cross over to The Node. If you wish to become a Group Ironman, speak to the Ironman tutor north-east of here.",
  ARRIVED: "Welcome to The Node. Form your group here before you set out.",
  RENAME_PROMPT: "Enter your group's new name:",
  // Ours: leaving The Node without a formed group.
  CHOOSE_MODE: "You aren't in a group. Choose a game mode for the mainland.",
});

/** The game modes a Group Ironman with no group may leave The Node as: the prompt's options. */
const LEAVING_MODES = Object.freeze([
  ["Become an Ironman.", "ironman"],
  ["Become a Hardcore Ironman.", "hardcore"],
  ["Become an Ultimate Ironman.", "ultimate"],
  ["Play without Ironman mode.", "none"],
]);

const locId = (name) => Common.api.core.CacheDefinitions.getLocId(name);
const location = ({ x, y, z }) => new Common.api.core.Location(x, y, z);

/** Asks first (TeleportHandler.confirm: a boat at sea, the Wilderness), then teleports. */
function teleport(player, destination) {
  const { TeleportHandler, TeleportType } = Common.api.core;
  const to = location(destination);
  if (!TeleportHandler.checkReqs(player, to)) return;
  TeleportHandler.confirm(player, to, () => TeleportHandler.teleport(player, to, TeleportType.NORMAL, false));
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
  if (toMainland && !inFormedGroup(player)) return chooseMode(player), true;
  if (toMainland) player.setAttribute(Variants.EXPERIENCED_ATTRIBUTE, true);
  teleport(player, toNode ? NODE_ARRIVAL : LUMBRIDGE_ARRIVAL);
  return true;
}

function inFormedGroup(player) {
  const { group } = Common.groupOf(player);
  return Boolean(group && Store.get(group.id)?.formed);
}

/** No formed group: another game mode first, then the mainland. */
function chooseMode(player) {
  Common.api.sendMultiChatboxPrompt(player, MESSAGE.CHOOSE_MODE,
    ...LEAVING_MODES.flatMap(([label, mode]) => [label, () => leaveAs(player, mode)]),
    "Stay on The Node.", () => {});
}

function leaveAs(player, mode) {
  if (Common.groupOf(player).group) {
    const request = { player, left: false };
    Common.api.emitCustomEvent("grouping:leave", request);
    // Grouping says why it couldn't (group storage holding items, say).
    if (!request.left) return;
  }
  Common.setMode(player, mode);
  if (Common.isGroupIronman(player)) return;
  player.setAttribute(Variants.EXPERIENCED_ATTRIBUTE, true);
  teleport(player, LUMBRIDGE_ARRIVAL);
}

/** The rowboat's Travel (gim_boat): a Group Ironman rows over to The Node; other "Rowboat"s aren't this unit's. */
function rowboat(event) {
  const { player, objectId } = event;
  if (objectId !== locId("gim_boat")) return false;
  if (!Common.isGroupIronman(player)) {
    player.getPacketSender().sendMessage(MESSAGE.BOAT_REFUSED);
    return true;
  }
  // On the tutorial, the crossing ends it, and its destination (above) is The Node.
  const leave = { player, handled: false };
  Common.api.emitCustomEvent("tutorial-island:leave", leave);
  if (!leave.handled) teleport(player, NODE_ARRIVAL);
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
  NODE_ARRIVAL, LUMBRIDGE_ARRIVAL, MESSAGE, LEAVING_MODES, BANK_REFUSED,
  tutorialDestination, portal, rowboat, helmTeleport, chest, bank, choice,
};
