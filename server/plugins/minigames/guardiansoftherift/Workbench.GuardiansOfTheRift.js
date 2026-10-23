"use strict";

/**
 * The workbench: guardian fragments become guardian essence, one a tick.
 *
 * rsprox captures (rev 241): each tick the gotr_chisel_essence animation and sound 2586, one
 * fragment out and one essence in, until "You have no more guardian fragments to combine." or a
 * full inventory (mesbox "Your inventory is too full to hold any more essence.", sound 2277).
 * Without fragments: objectbox with the fragments, "You'll need at least one guardian fragment
 * to craft guardian essence."
 * Wiki: Crafting XP a level/10 an essence, between 1 and 5.
 */

const Shared = require("./Shared.GuardiansOfTheRift");

const SOUND = 2586;
const FULL_SOUND = 2277;

function craftingXp(player) {
  const level = player.getSkillManager().getMaxLevel(Shared.core().Skill.CRAFTING);
  return Math.max(1, Math.min(5, Math.floor(level / 10)));
}

function workAt(event) {
  const { player, objectId } = event;
  if (!Shared.isLoc(objectId, "gotr_workbench") || !Shared.inTemple(player.getLocation()) || !Shared.questComplete(player)) {
    return false;
  }
  if (Shared.count(player, Shared.ITEM.FRAGMENTS) <= 0) {
    Shared.itemStatement(player, Shared.ITEM.FRAGMENTS, "You'll need at least one guardian fragment to craft guardian essence.");
    return true;
  }
  if (!full(player)) Shared.startAction(player, "workbench", () => chisel(player));
  return true;
}

function full(player) {
  if (player.getInventory().getFreeSlots() > 0) return false;
  Shared.statement(player, "Your inventory is too full to hold any more essence.");
  Shared.sound(player, FULL_SOUND);
  return true;
}

function chisel(player) {
  if (Shared.count(player, Shared.ITEM.FRAGMENTS) <= 0) {
    player.sendMessage("You have no more guardian fragments to combine.");
    return false;
  }
  if (full(player)) return false;
  const inventory = player.getInventory();
  inventory.delete(Shared.obj(Shared.ITEM.FRAGMENTS), 1);
  inventory.adds(Shared.obj(Shared.ITEM.ESSENCE), 1);
  Shared.animate(player, "gotr_chisel_essence");
  Shared.sound(player, SOUND);
  Shared.addXp(player, "CRAFTING", craftingXp(player));
  return true;
}

module.exports = {
  craftingXp,
  attach(api) {
    api.onObjectInteraction("Workbench", { "Work-at": workAt });
  },
};
