"use strict";

const CHARGES_ATTRIBUTE = "camulet:charges";
const UNLIMITED_ATTRIBUTE = "quest.enakhras_lament.camulet-unlimited";
const DEFAULT_CHARGES = 4;
const WORN_OPTION_PARAM = 451;
const FIRST_WORN_OPTION_CLICK = 2;

const TEMPLE = [3105, 9315, 0];
const TEMPLE_TASK = "teleport-to-enakhra-s-temple-with-the-camulet";

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

function teleport(player) {
  if (!unlimited(player) && charges(player) <= 0) {
    player.sendMessage("Your Camulet has no charges left.");
    return;
  }
  const [x, y, z] = TEMPLE;
  const target = new core.Location(x, y, z);
  if (!core.TeleportHandler.checkReqs(player, target)) return;
  core.TeleportHandler.teleport(player, target, core.TeleportType.NORMAL, false, () => {
    if (!unlimited(player)) setCharges(player, charges(player) - 1);
    api.emitCustomEvent("camulet:teleported", { player, destination: "temple" });
    api.emitCustomEvent("diary:task", { player, diary: "desert", task: TEMPLE_TASK });
  });
}

function onItemAction(event) {
  if (!camuletIds().includes(event.itemId) || !event.item) return;
  const equipped = event.interfaceId === core.Equipment.INVENTORY_INTERFACE_ID;
  const option = normalise(equipped
    ? (event.option ?? wornOptionName(event.itemId, event.clickType))
    : event.option);
  if (option !== "rub" && option !== "teleport") return;
  event.handled = true;
  teleport(event.player);
}

module.exports = {
  name: "Camulet",
  members: true,
  register(pluginApi) {
    api = pluginApi;
    core = pluginApi.core;
    api.persistAttribute(CHARGES_ATTRIBUTE, DEFAULT_CHARGES);
    api.onItemAction(onItemAction);
  },
  _test: { charges, setCharges, unlimited, teleport, onItemAction, TEMPLE, TEMPLE_TASK },
};
