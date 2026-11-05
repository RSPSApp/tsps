"use strict";

/**
 * The optional puzzle doors and the 10-coin chest. The mosaic door needs the correct tile (the
 * Wiki's bottom-right image); the gear door is the non-reward side room. The mosaic choice is a
 * chat menu because the cache's puzzle interface is not the one a server can safely drive.
 */
const Common = require("./Common.RoguesDen");
const Run = require("./Run.RoguesDen");
const Interactions = require("./Interactions.RoguesDen");

function location(x, y, z) {
  return new (Common.core().Location)(x, y, z);
}

function mosaicDoor(event) {
  const { player, object } = event;
  if (String(event.option).toLowerCase() !== "open") return false;
  event.handled = true;
  if (!Common.hasItem(player, Common.itemIds.tile)) {
    player.sendMessage(Common.message("noTile"));
    return true;
  }
  const api = Common.api();
  const place = (correct) => () => {
    player.getPacketSender().sendInterfaceRemoval();
    if (!correct) {
      player.sendMessage(Common.message("mosaicWrong"));
      return;
    }
    Common.take(player, Common.itemIds.tile, 1);
    player.sendMessage(Common.message("mosaicRight"));
    const to = Interactions.across(object, player, 3);
    if (to) Interactions.moveThrough(player, to, 1);
  };
  api.sendMultiChatboxPrompt(player, "Which tile do you place in the mosaic?",
    "Top left", place(false),
    "Top right", place(false),
    "Bottom left", place(false),
    "Bottom right", place(true));
  return true;
}

/** The gear door: four turns and the door opens; it is the optional room the Wiki calls harmless. */
function gearDoor(event) {
  const { player, object } = event;
  if (String(event.option).toLowerCase() !== "open") return false;
  event.handled = true;
  const api = Common.api();
  api.sendMultiChatboxPrompt(player, "The gears are jammed. What do you do?",
    "Turn the gears.", () => {
      player.getPacketSender().sendInterfaceRemoval();
      player.sendMessage("You turn the gears...");
      const core = Common.core();
      core.TaskManager.submit(new (class extends core.Task {
        constructor() { super(2); }
        execute() {
          this.stop();
          if (!player.isRegistered?.()) return;
          player.sendMessage(Common.message("gearRight"));
          const to = Interactions.across(object, player, 3);
          if (to) Interactions.moveThrough(player, to, 1);
        }
      })());
    },
    "Leave it alone.", () => player.getPacketSender().sendInterfaceRemoval());
  return true;
}

function chest(event) {
  const { player } = event;
  const option = String(event.option).toLowerCase();
  if (option === "search for traps") {
    event.handled = true;
    player.sendMessage("You search the chest for traps...");
    return true;
  }
  if (option !== "open") return false;
  event.handled = true;
  if (!Common.give(player, Common.itemIds.coins, 10)) {
    player.sendMessage(Common.message("full"));
    return true;
  }
  player.sendMessage(Common.message("chestCoins"));
  return true;
}

module.exports = { mosaicDoor, gearDoor, chest };
