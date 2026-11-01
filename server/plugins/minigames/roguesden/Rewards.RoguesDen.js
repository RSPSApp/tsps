"use strict";

/**
 * The two reward items: the Rogue's equipment crate's choice of one piece (or a kit) and the
 * Rogue kit's build menu, both exactly as the Wiki transcripts print them. Choosing a piece also
 * feeds the collection log; all five set the minigame's collection varbit.
 */
const Common = require("./Common.RoguesDen");

const PIECES_ATTRIBUTE = "rogues-den:pieces";
const COLLECTION_VARBIT = 12012;
const PIECES = [
  { label: "Mask", id: 5554, bit: 1, line: "Opening the crate, you find a Rogue mask." },
  { label: "Top", id: 5553, bit: 2, line: "Opening the crate, you find a Rogue top... how convenient." },
  { label: "Trousers", id: 5555, bit: 4, line: "Opening the crate, you find a pair of Rogue trousers." },
  { label: "Boots", id: 5557, bit: 8, line: "Opening the crate, you find a pair of Rogue boots." },
  { label: "Gloves", id: 5556, bit: 16, line: "Opening the crate, you find a pair of Rogue gloves." },
];
const KITS = [
  { label: "Spade", id: 952 },
  { label: "Chisel", id: 1755 },
  { label: "Rope", id: 954 },
  { label: "Tinderbox", id: 590 },
];

function removeOne(player, id) {
  if (!Common.hasItem(player, id)) return false;
  Common.take(player, id, 1);
  return true;
}

function givePiece(player, piece) {
  if (!removeOne(player, Common.itemIds.rogueCrate)) return false;
  if (Common.freeSlots(player) <= 0 || !Common.give(player, piece.id, 1)) {
    Common.give(player, Common.itemIds.rogueCrate, 1);
    player.sendMessage(Common.message("full"));
    return false;
  }
  player.sendMessage(piece.line);
  Common.api().emitCustomEvent("collection-log:obtain", { player, itemId: piece.id });
  const mask = (Number(player.getAttribute(PIECES_ATTRIBUTE)) || 0) | piece.bit;
  player.setAttribute(PIECES_ATTRIBUTE, mask);
  if ((mask & 31) === 31) player.getPacketSender().sendVarbit(COLLECTION_VARBIT, 1);
  return true;
}

function giveKitFromCrate(player) {
  if (!removeOne(player, Common.itemIds.rogueCrate)) return false;
  if (!Common.give(player, Common.itemIds.rogueKit, 1)) {
    // Put the crate back if the kit would not fit.
    Common.give(player, Common.itemIds.rogueCrate, 1);
    player.sendMessage(Common.message("full"));
    return false;
  }
  player.sendMessage("Opening the crate, you find a Rogue kit.");
  return true;
}

function openCrate(event) {
  const { player } = event;
  if (!Common.hasItem(player, Common.itemIds.rogueCrate)) return false;
  const api = Common.api();
  api.sendMultiChatboxPrompt(player, "What can you see in the crate?",
    "A piece of Rogue equipment.", () => {
      player.getPacketSender().sendInterfaceRemoval();
      api.sendMultiChatboxPrompt(player, "Which outfit piece do you want?",
        ...PIECES.flatMap((piece) => [piece.label, () => {
          player.getPacketSender().sendInterfaceRemoval();
          givePiece(player, piece);
        }]));
    },
    "A Rogue kit.", () => {
      player.getPacketSender().sendInterfaceRemoval();
      giveKitFromCrate(player);
    });
  return true;
}

function buildKit(event) {
  const { player } = event;
  if (!Common.hasItem(player, Common.itemIds.rogueKit)) return false;
  const api = Common.api();
  api.sendMultiChatboxPrompt(player, "What do you want to make?",
    ...KITS.flatMap((kit) => [kit.label, () => {
      player.getPacketSender().sendInterfaceRemoval();
      if (Common.freeSlots(player) <= 0) {
        player.sendMessage(Common.message("full"));
        return;
      }
      Common.take(player, Common.itemIds.rogueKit, 1);
      Common.give(player, kit.id, 1);
      player.sendMessage(`You make a ${kit.label.toLowerCase()}.`);
    }]));
  return true;
}

function itemAction(event) {
  const definition = Common.core().CacheDefinitions.getItem(event.itemId);
  const option = String(event.option ?? definition?.inventoryActions?.[event.clickType - 1] ?? "").toLowerCase();
  if (event.itemId === Common.itemIds.rogueCrate && option === "search") {
    event.handled = openCrate(event) === true;
    return;
  }
  if (event.itemId === Common.itemIds.rogueKit && option === "build") {
    event.handled = buildKit(event) === true;
  }
}

function attach(api) {
  api.persistAttribute(PIECES_ATTRIBUTE, 0);
  api.onItemAction(itemAction);
}

module.exports = { attach, openCrate, buildKit, PIECES_ATTRIBUTE };
