"use strict";

// Wiki: Amulet_of_the_eye and the original Transcript:Lumbridge_Guide.
// GOTR's cache flags distinguish finding the locket from actually exchanging it.
const Shared = require("./Shared.GuardiansOfTheRift");
const Records = require("./Records.GuardiansOfTheRift");
const Game = require("./Game.GuardiansOfTheRift");
const PAGE = "Lumbridge Guide";
const QUEST_KEY = "temple_of_the_eye";
const UNLOCK = "gotr_amulet_of_the_eye_obtained";
const OPENED = "gotr_locket_opened";
const AMULETS = ["gotr_amulet_of_the_eye", "gotr_amulet_of_the_eye_red", "gotr_amulet_of_the_eye_green", "gotr_amulet_of_the_eye_blue"];
const LOCKET = "gotr_tarnished_locket";
/** Wiki (Amulet of the Eye): "just south of the portal" (43692 at 3613,9468); TeleportLocationLine 3615,9460. */
const ARRIVAL_TILE = { x: 3615, y: 9460 };
// Cache params for equipment actions, shared with Jewellery.plugin.js.
const WORN_OPTION_PARAM = 451;
const FIRST_WORN_OPTION_CLICK = 2;
const NO_SPACE = "9nafop";
const RECLAIM = "xm3rMD";
const EXCHANGE = "HnwS8y";

function owns(player) {
  const { Bank } = Shared.core();
  return AMULETS.some(name => {
    const id = Shared.obj(name);
    return player.getInventory().contains(id) || player.getEquipment().contains(id)
      || player.getBanks().some((bank, tab) => tab !== Bank.BANK_SEARCH_TAB_INDEX && bank?.contains(id));
  });
}
function questDone(player) {
  const request = { player, key: QUEST_KEY, complete: false };
  Shared.api().emitCustomEvent("quest:is-complete", request);
  return request.complete === true;
}
function canReclaim(player) {
  return Records.setting(player, UNLOCK) === 1 && questDone(player) && !owns(player);
}
function status(request) {
  request.reclaim = canReclaim(request.player);
}
function onPage(event) {
  return event.pages?.some(({ page }) => page === PAGE);
}
function condition(event) {
  if (!onPage(event) || event.stepId !== NO_SPACE) return null;
  return event.player.getInventory().getFreeSlots() < 1;
}
function action(event) {
  if (!onPage(event) || event.kind !== "message" || ![RECLAIM, EXCHANGE].includes(event.stepId)) return;
  const { player } = event;
  const inventory = player.getInventory();
  const exchange = event.stepId === EXCHANGE;
  const locket = Shared.obj(LOCKET);
  const eligible = exchange ? questDone(player) && Records.setting(player, OPENED) === 1 && !owns(player) && inventory.contains(locket) : canReclaim(player);
  event.handled = true;
  if (!eligible || inventory.getFreeSlots() + (exchange ? 1 : 0) < 1) {
    event.end = true;
    return;
  }
  if (exchange) inventory.deleteNumber(locket, 1);
  const amulet = Shared.obj(AMULETS[0]);
  inventory.adds(amulet, 1);
  if (exchange) Records.setSetting(player, UNLOCK, 1);
  event.box = { items: exchange ? [locket, amulet] : [amulet] };
}
function locketOnGuide(event) {
  if (event.itemId !== Shared.obj(LOCKET) || (event.definition ?? event.target?.getDefinition?.())?.getName?.() !== PAGE) return;
  if (!questDone(event.player) || Records.setting(event.player, OPENED) !== 1 || owns(event.player)) return;
  Shared.api().emitCustomEvent("npc-dialogue:start", {
    player: event.player, npc: event.target, npcId: event.target.getId(),
    variant: "giving-him-the-tarnished-locket-first-time",
  });
  event.handled = true;
}
/** The Wiki gives the amulet unlimited teleports to the Temple of the Eye, just south of its portal. */
function teleport(player) {
  const { Location, TeleportHandler, TeleportType } = Shared.core();
  const target = new Location(ARRIVAL_TILE.x, ARRIVAL_TILE.y, 0);
  if (!TeleportHandler.checkReqs(player, target)) return;
  // Leave the game on arrival, as walking out through the barrier does: a teleport from inside the
  // rift does not always pass the temple Area's postLeave (the arrival, by the portal, is south of it).
  TeleportHandler.confirm(player, target, () => TeleportHandler.teleport(player, target, TeleportType.NORMAL, false, () => Game.leave(player)));
}
function wornOption(event) {
  const { CacheDefinitions, Equipment } = Shared.core();
  if (event.interfaceId !== Equipment.INVENTORY_INTERFACE_ID || event.clickType < FIRST_WORN_OPTION_CLICK) return null;
  return CacheDefinitions.getItem(event.itemId)?.params?.get(WORN_OPTION_PARAM + event.clickType - FIRST_WORN_OPTION_CLICK);
}
function amuletAction(event) {
  if (!event.item || !AMULETS.some(name => Shared.obj(name) === event.itemId)) return;
  if (String(event.option ?? wornOption(event) ?? "").toLowerCase() !== "teleport") return;
  event.handled = true;
  teleport(event.player);
}
function inspectLocket({ player }) {
  Records.setSetting(player, OPENED, 1);
  player.sendMessage("The locket opens, revealing a note inside.");
}
module.exports = {
  attach(api) {
    api.onCustomEvent("lumbridge-guide:amulet-status", status);
    api.onNpcDialogueCondition(condition);
    api.onCustomEvent("npc-dialogue:action", action);
    api.onItemOnNpc(locketOnGuide);
    api.onItemAction(amuletAction);
    api.onItemAction("Tarnished locket", { Inspect: inspectLocket });
  },
};
