"use strict";

const CHARGES_ATTRIBUTE = "camulet:charges";
const UNLIMITED_ATTRIBUTE = "quest.enakhras_lament.camulet-unlimited";
const DEFAULT_CHARGES = 4;
const WORN_OPTION_PARAM = 451;
const FIRST_WORN_OPTION_CLICK = 2;

const TEMPLE = [3105, 9315, 0];
/** Wiki (Camulet): the entrance near the quarry, unlocked by the hard Desert Diary. */
const ENTRANCE = [3191, 2924, 0];
const TEMPLE_TASK = "teleport-to-enakhra-s-temple-with-the-camulet";

/** The rub and no-charge texts are from rsprox recordings 3021, 3160, 3165. */
const RUB_MESSAGE = "You rub the amulet...";
const OUT_OF_CHARGES_BOX = "Your Camulet has run out of teleport charges. You can renew them by applying camel dung.";
const CHECK_EMPTY_MESSAGE = "Your Camulet has no charges left.<br>You can recharge it by applying camel dung.";
const DESTINATION_PROMPT = "Where would you like to teleport to?";

let api = null;
let core = null;

function camuletIds() {
  return [core.ItemIdentifiers.CAMULET, core.ItemIdentifiers.CAMULET_2];
}

function normalise(text) {
  return String(text ?? "").toLowerCase().trim();
}

function charges(player) {
  const value = player.getAttribute(CHARGES_ATTRIBUTE);
  return Number.isInteger(value) ? value : DEFAULT_CHARGES;
}

function unlimited(player) {
  return Number(player.getAttribute(UNLIMITED_ATTRIBUTE)) > 0;
}

function setCharges(player, amount) {
  player.setAttribute(CHARGES_ATTRIBUTE, Math.max(0, amount));
}

function wornOptionName(itemId, clickType) {
  const index = clickType - FIRST_WORN_OPTION_CLICK;
  if (index < 0) return null;
  return core.CacheDefinitions.getItem(itemId)?.params?.get?.(WORN_OPTION_PARAM + index) ?? null;
}

function hardDiaryDone(player) {
  const request = { player, diary: "desert", tier: "hard", complete: false };
  api.emitCustomEvent("diary:is-complete", request);
  return request.complete === true;
}

function hasCharges(player) {
  return unlimited(player) || charges(player) > 0;
}

function teleport(player, destination = TEMPLE) {
  const [x, y, z] = destination;
  const target = new core.Location(x, y, z);
  if (!core.TeleportHandler.checkReqs(player, target)) return;
  core.TeleportHandler.confirm(player, target, () => core.TeleportHandler.teleport(player, target, core.TeleportType.NORMAL, false, () => {
    if (!unlimited(player)) setCharges(player, charges(player) - 1);
    api.emitCustomEvent("camulet:teleported", { player, destination: destination === ENTRANCE ? "entrance" : "temple" });
    if (destination === TEMPLE) api.emitCustomEvent("diary:task", { player, diary: "desert", task: TEMPLE_TASK });
  }));
}

/** Every rub says so first; an empty Camulet then explains how to renew it. */
function startRub(player) {
  player.getPacketSender().sendTypedMessage(core.ChatType.SPAM, RUB_MESSAGE);
  if (hasCharges(player)) return true;
  const { DialogueChainBuilder, StatementDialogue } = core;
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(new StatementDialogue(0, OUT_OF_CHARGES_BOX)));
  return false;
}

/** Rub and the worn Teleport (the rev 241 cache has only Check and Teleport worn): the hard diary asks where. */
function rub(player) {
  if (!startRub(player)) return;
  if (!hardDiaryDone(player)) {
    teleport(player, TEMPLE);
    return;
  }
  api.sendMultiChatboxPrompt(player, DESTINATION_PROMPT,
    "Enakhra's Temple.", () => teleport(player, TEMPLE),
    "Enakhra's Temple Entrance.", () => teleport(player, ENTRANCE),
    "Nowhere.", () => player.getPacketSender().sendInterfaceRemoval());
}

function checkCharges(player) {
  if (!hasCharges(player)) player.sendMessage(CHECK_EMPTY_MESSAGE);
  return !hasCharges(player);
}

/** Wiki: a bucket of ugthanki dung fully recharges the Camulet, and none is wasted on a full one. */
function rechargeWithDung(event) {
  const { player } = event;
  const usedIsDung = event.usedItemId === core.ItemIdentifiers.UGTHANKI_DUNG;
  const dungSlot = usedIsDung ? event.usedItemSlot : event.usedWithItemSlot;
  event.handled = true;
  if (unlimited(player) || charges(player) >= DEFAULT_CHARGES) return;
  setCharges(player, DEFAULT_CHARGES);
  player.getInventory().setItem(dungSlot, new core.Item(core.ItemIdentifiers.BUCKET, 1)).refreshItems();
}

function onItemAction(event) {
  if (!camuletIds().includes(event.itemId) || !event.item) return;
  const equipped = event.interfaceId === core.Equipment.INVENTORY_INTERFACE_ID;
  const option = normalise(equipped
    ? (event.option ?? wornOptionName(event.itemId, event.clickType))
    : event.option);
  if (option === "check-charge" || (equipped && option === "check")) {
    event.handled = checkCharges(event.player);
    return;
  }
  if (option !== "rub" && option !== "teleport") return;
  event.handled = true;
  rub(event.player);
}

module.exports = {
  name: "Camulet",
  description: "Camulet: teleports to Enakhra's Temple or the quarry entrance using charges, recharged with ugthanki dung.",
  members: true,
  register(pluginApi) {
    api = pluginApi;
    core = pluginApi.core;
    api.persistAttribute(CHARGES_ATTRIBUTE, DEFAULT_CHARGES);
    api.onItemAction(onItemAction);
    api.onItemOnItem("Ugthanki dung", "Camulet", rechargeWithDung, { noted: false });
  },
  _test: { charges, setCharges, unlimited, teleport, onItemAction, rechargeWithDung, TEMPLE, ENTRANCE, TEMPLE_TASK },
};
