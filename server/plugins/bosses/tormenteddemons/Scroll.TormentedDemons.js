"use strict";

/**
 * The Guthixian temple teleport (Wiki): a scroll the demons drop that teleports to the temple
 * entrance at the bottom of the Chasm of Tears, once While Guthix Sleeps is complete. The chasm
 * itself belongs to the quest (plugins/quests/wgs/Chasm.WhileGuthixSleeps.js), which takes the
 * player in on arrival ("wgs:enter-chasm").
 *
 * No capture reads the scroll, so it reads like the other teleport scrolls (the Revenant cave
 * teleport's animation, graphic and sound).
 */

const Shared = require("./Shared.TormentedDemons");

const SCROLL_NAME = "Guthixian temple teleport";
const SCROLL = 29684;
const QUEST_KEY = "while_guthix_sleeps";
const LOCKED_MESSAGE = "You need to complete the While Guthix Sleeps quest before you can teleport to Ancient Guthixian Temple.";
/** Wiki: the scroll's destination, before the skulls at the foot of the temple walls. */
const DESTINATION = Object.freeze([4063, 4557, 0]);
const SCROLL_ANIMATION = 3864;
const SCROLL_GRAPHIC = 1039;
const SCROLL_SOUND = 200;

let teleportType = null;

function scrollTeleport() {
  if (teleportType) return teleportType;
  const { TeleportType, Animation, Priority, Sound } = Shared.core();
  teleportType = new TeleportType(3, new Animation(SCROLL_ANIMATION, Priority.HIGH), null,
    Animation.DEFAULT_RESET_ANIMATION, null, null, null, { sound: new Sound(SCROLL_SOUND, 1, 0, 0), busy: true });
  return teleportType;
}

function questComplete(player) {
  const request = { player, key: QUEST_KEY, complete: false };
  Shared.api().emitCustomEvent("quest:is-complete", request);
  return request.complete === true;
}

function readScroll({ player, slot }) {
  const { Location, TeleportHandler, Graphic } = Shared.core();
  if (!questComplete(player)) {
    player.sendMessage(LOCKED_MESSAGE);
    return;
  }
  const to = new Location(...DESTINATION);
  if (!TeleportHandler.checkReqs(player, to)) return;
  TeleportHandler.confirm(player, to, () => {
    const inventory = player.getInventory();
    const at = inventory.getItems()[slot]?.getId?.() === SCROLL ? slot : inventory.getSlotForItemId(SCROLL);
    if (at < 0) return;
    inventory.deleteAtSlot(at, 1);
    player.getPacketSender().sendGlobalGraphic(new Graphic(SCROLL_GRAPHIC), player.getLocation().clone());
    TeleportHandler.teleport(player, to, scrollTeleport(), false, () => {
      Shared.api().emitCustomEvent("wgs:enter-chasm", { player, tile: to });
    });
  });
}

function attach(api) {
  api.onItemAction(SCROLL_NAME, { Teleport: readScroll });
}

module.exports = { attach, _test: { readScroll, questComplete } };
