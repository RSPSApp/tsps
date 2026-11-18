/**
 * Barbarian smithing (https://oldschool.runescape.wiki/w/Barbarian_Training#Smithing): a bar
 * and a matching log make a spear or a hasta, only at a barbarian anvil (Otto's Grotto and
 * Barbarian Village), which works nothing else. Otto owns separate spear/hasta teaching
 * permissions through smithing:unlocked. An absent lesson responder never grants permission.
 *
 * Captured (rsprox recs 1530, 1533): Smith says "You should select a suitable metal bar from
 * your inventory and use it on the anvil."; without a hammer, "You need a hammer in order to
 * smith here."
 */
const Core = require("./Core.Smithing");
const Data = require("./Data.Smithing");
const Sessions = require("./Sessions.Smithing");
const { messageBox, hasHammer, smithingLevel, animation, restricted, PRESET_TEXT } = require("./Common.Smithing");

const BARBARIAN_ANVIL = "Barbarian anvil";
const INTERVAL_TICKS = 4;
const FIRST_OUTPUT_DELAY_TICKS = 3;
const SELECT_BAR_MESSAGE = "You should select a suitable metal bar from your inventory and use it on the anvil.";
const NO_HAMMER_MESSAGE = "You need a hammer in order to smith here.";
const UNFAMILIAR_MESSAGE = "This anvil is unfamiliar and barbaric, you can't seem to use it.";

function allowed(player, recipe = null, itemId = null) {
  const request = { player, unlock: recipe && itemId === recipe.hastaId ? "barbarian_hasta" : "barbarian_spear", allowed: null };
  Core.api.emitCustomEvent("smithing:unlocked", request);
  return request.allowed === true;
}

function stationSnapshot(player, object) {
  if (!object?.getId || !object.getLocation || !player.getTeleportSerial) return null;
  return { object, objectId: object.getId(), location: object.getLocation().clone(),
    startLocation: player.getLocation().clone(), teleportSerial: player.getTeleportSerial(), area: player.getArea() };
}

/** A menu or pending cycle never carries permission to smith after a teleport, even back to the same tile. */
function remainsAtStation(player, station) {
  return station != null && player.isRegistered() && player.getHitpoints() > 0
    && player.getLocation().equals(station.startLocation) && player.getTeleportSerial() === station.teleportSerial
    && player.getArea() === station.area && player.getMovementQueue().size() === 0 && player.getForceMovement() == null
    && Core.MapObjects.stillStands(player, station.objectId, station.location, station.object, true);
}

function inputSlot(inventory, id) {
  return inventory.getItems().findIndex(item => item?.getId() === id && item.getAmount() > 0 && !restricted(item));
}

function barbarianHammering(player) {
  const ids = [Core.ItemIdentifiers.IMCANDO_HAMMER, Core.ItemIdentifiers.IMCANDO_HAMMER_OFF_HAND_];
  const inventory = player.getInventory();
  const wielded = [Core.Equipment.WEAPON_SLOT, Core.Equipment.SHIELD_SLOT].map(slot => player.getEquipment()?.get?.(slot)?.getId?.());
  const imcando = ids.some(id => inventory.getAmount(id) > 0 || wielded.includes(id));
  return animation(imcando ? "brut_human_smithing_imcando_hammer" : "brut_human_smithing");
}

function prepareOne(player, recipe, itemId, station) {
  if (!remainsAtStation(player, station) || !allowed(player, recipe, itemId)) return false;
  const inventory = player.getInventory();
  if (!hasHammer(player)) {
    player.sendMessage(NO_HAMMER_MESSAGE);
    return false;
  }
  if (smithingLevel(player) < recipe.level) {
    messageBox(player, `You need a Smithing level of ${recipe.level} to make that.`);
    return false;
  }
  if (!inventory.contains(recipe.barId) || !inventory.contains(recipe.logId)) {
    player.sendMessage(`You need a ${Core.ItemDefinition.forId(recipe.barId).getName().toLowerCase()} and some ${Core.ItemDefinition.forId(recipe.logId).getName().toLowerCase()} to make that.`);
    return false;
  }
  const barSlot = inputSlot(inventory, recipe.barId), logSlot = inputSlot(inventory, recipe.logId);
  if (barSlot < 0 || logSlot < 0) { player.sendMessage(PRESET_TEXT); return false; }
  // Inputs free space before the output is added. Preview through the same container policy.
  if (typeof inventory.getCopiedItems === "function") {
    const preview = new Core.Inventory(player).setItems(inventory.getCopiedItems());
    preview.deleteAtSlot(barSlot, 1, false); preview.deleteAtSlot(logSlot, 1, false);
    if (preview.getAddableAmount(new Core.Item(itemId, 1)) < 1) return false;
  }
  return { inventory, barSlot, logSlot };
}

function makeOne(player, recipe, itemId, station) {
  const ready = prepareOne(player, recipe, itemId, station);
  if (!ready) return false;
  const { inventory, barSlot, logSlot } = ready;
  inventory.deleteAtSlot(barSlot, 1, false);
  inventory.deleteAtSlot(logSlot, 1, false);
  inventory.addItem(new Core.Item(itemId, 1));
  player.performAnimation(barbarianHammering(player));
  player.sendMessage(`You make ${/^[aeiou]/i.test(Core.ItemDefinition.forId(itemId).getName()) ? "an" : "a"} ${Core.ItemDefinition.forId(itemId).getName()}.`);
  player.getSkillManager().addExperiences(Core.Skill.SMITHING, recipe.xp);
  // `metal` as the anvil's: the bar's name without " bar", lower-cased ("runite").
  const metal = String(Core.ItemDefinition.forId(recipe.barId).getName() ?? "").replace(/ bar$/i, "").toLowerCase();
  Core.api.emitCustomEvent("smithing:success", { player, skill: Core.Skill.SMITHING, itemId, metal, source: "barbarian-anvil",
    objectId: station.objectId, location: { x: station.location.getX(), y: station.location.getY(), z: station.location.getZ() } });
  return true;
}

function start(player, recipe, itemId, amount, station) {
  if (!Number.isInteger(amount) || amount <= 0) return;
  if (!remainsAtStation(player, station)) return;
  if (!allowed(player, recipe, itemId)) return messageBox(player, UNFAMILIAR_MESSAGE);
  if (!prepareOne(player, recipe, itemId, station)) return;
  const inventory = player.getInventory();
  const most = Math.min(inventory.getAmount(recipe.barId), inventory.getAmount(recipe.logId));
  if (most <= 0) return;
  Sessions.start(player, {
    type: "spears",
    remaining: Math.min(amount, most),
    interval: INTERVAL_TICKS,
    // Capture224/01530: selection/animation1777, outputs1780/1784/1788. World tasks
    // precede native input; Sessions' next cycle is already one task tick after admission.
    firstDelay: FIRST_OUTPUT_DELAY_TICKS - 1,
    step: (smith) => makeOne(smith, recipe, itemId, station),
  });
  player.performAnimation(barbarianHammering(player));
}

function smith({ player }) {
  messageBox(player, allowed(player) ? SELECT_BAR_MESSAGE : UNFAMILIAR_MESSAGE);
}

function useBar(event) {
  if (event.object?.getDefinition?.().getName() !== BARBARIAN_ANVIL) return;
  const recipe = Data.spears().find((candidate) => candidate.barId === event.itemId);
  if (!recipe) return;
  event.handled = true;
  const { player } = event;
  if (!allowed(player)) return messageBox(player, UNFAMILIAR_MESSAGE);
  if (!hasHammer(player)) return player.sendMessage(NO_HAMMER_MESSAGE);
  const station = stationSnapshot(player, event.object);
  if (!remainsAtStation(player, station)) return;
  const { CreationMenu } = Core;
  const most = Math.max(1, Math.min(player.getInventory().getAmount(recipe.barId), player.getInventory().getAmount(recipe.logId)));
  player.getPacketSender().sendCreationMenu(
    new CreationMenu("What would you like to make?", [recipe.spearId, recipe.hastaId], {
      execute: (itemId, amount) => start(player, recipe, itemId, amount, station),
    }, { maxAmount: most })
  );
}

module.exports = function attach(api) {
  api.onObjectInteraction(BARBARIAN_ANVIL, { Smith: smith });
  api.onItemOnObject(useBar, { noted: false });
};
