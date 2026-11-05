"use strict";

// Permanent reward interactions: owning the toy, not an active holiday window, permits
// using it. The animations, swaps and rank checks live in data/holiday-toys.json with
// their sources; this file only resolves cache names and plays them.
const toys = require("./data/holiday-toys.json");
// PluginManager's worn option convention: worn ops are obj params 451.. from click 2.
const WORN_OPTION_PARAM = 451, FIRST_WORN_OPTION_CLICK = 2;
let core;
let actions;

function resolve(name, lookup, what) {
  const id = core.CacheDefinitions[lookup](name);
  if (id == null) throw new Error(`HolidayToys: ${what} ${name} is missing from the active cache`);
  return id;
}

function table() {
  if (actions) return actions;
  actions = new Map();
  const add = (itemId, option, action) => actions.set(`${itemId}:${option}`, action);
  for (const entry of toys.animations) {
    const action = {
      kind: "animation",
      seq: entry.seq ? resolve(entry.seq, "getSeqId", "sequence") : null,
      spotanim: entry.spotanim ? resolve(entry.spotanim, "getSpotanimId", "spotanim") : null,
      sound: entry.sound ?? null, say: entry.say ?? null, unlocks: entry.unlocks === true,
    };
    for (const item of entry.items) add(resolve(item, "getObjId", "item"), entry.option, action);
  }
  for (const swap of toys.swaps) {
    const ids = swap.cycle.map(item => resolve(item, "getObjId", "item"));
    ids.forEach((id, index) => add(id, swap.option, { kind: "swap", to: ids[(index + 1) % ids.length] }));
  }
  const rank = { kind: "rank", varbit: resolve(toys.ranks.varbit, "getVarbitId", "varbit") };
  for (const item of toys.ranks.items) for (const option of toys.ranks.options) add(resolve(item, "getObjId", "item"), option, rank);
  return actions;
}

function optionOf(event, worn) {
  if (event.option) return event.option;
  const definition = core.CacheDefinitions.getItem(event.itemId);
  if (!worn) return definition.inventoryActions?.[event.clickType - 1] ?? null;
  const option = definition.params?.get?.(WORN_OPTION_PARAM + event.clickType - FIRST_WORN_OPTION_CLICK);
  return typeof option === "string" ? option : null;
}

function rankTitle(player, action) {
  const hugs = player.getPacketSender().getVarbit(action.varbit);
  let title = toys.ranks.titles[0][1];
  for (const [minimum, name] of toys.ranks.titles) if (hugs >= minimum) title = name;
  return title;
}

function animate(player, action) {
  if (action.seq != null) player.performAnimation(new core.Animation(action.seq));
  if (action.spotanim != null) player.performGraphic(new core.Graphic(action.spotanim));
  if (action.sound != null) player.getPacketSender().sendSound(action.sound, 1, 0);
  if (action.say) player.forceChat(action.say);
}

function swap(player, container, item, to) {
  item.setId(to);
  container.refreshItems();
  if (container === player.getEquipment()) {
    core.BonusManager.update(player);
    player.getUpdateFlag().flag(core.Flag.APPEARANCE);
  }
}

function useToy(api, event) {
  const { player, item, slot } = event;
  if (!item || !player) return;
  const worn = event.interfaceId === core.Equipment.INVENTORY_INTERFACE_ID;
  const container = worn ? player.getEquipment() : event.interfaceId === core.Inventory.INTERFACE_ID ? player.getInventory() : null;
  if (!container || container.getItems()[slot] !== item || item.getId() !== event.itemId) return;
  const action = table().get(`${event.itemId}:${optionOf(event, worn)}`);
  if (!action) return;
  event.handled = true;
  if (player.getHitpoints() <= 0 || player.getStatus() !== core.PlayerStatus.NONE || player.isTeleportingReturn()) return;
  if (action.kind === "animation") {
    animate(player, action);
    // Rev 232 recording 3200: the first Play-with of a held toy unlocks it at Diango.
    if (action.unlocks) api.emitCustomEvent("holiday-rewards:used", { player, itemId: event.itemId });
  } else if (action.kind === "swap") swap(player, container, item, action.to);
  else {
    const { DialogueChainBuilder, StatementDialogue } = core;
    player.getDialogueManager().startDialogues(new DialogueChainBuilder()
      .add(new StatementDialogue(0, `${toys.ranks.message}${rankTitle(player, action)}`)));
  }
}

function lookAtSnowGlobe(api, { player, itemId }) {
  const cache = api.core.CacheDefinitions;
  if (itemId !== cache.getObjId("xmas16_snowglobe")) return false;
  player.getPacketSender().sendInterface(cache.getInterfaceId("xmas16_snow_globe"));
}

module.exports = {
  name: "HolidayToys",
  register(api) {
    core = api.core;
    api.onItemAction("Snow globe", { "Look at": lookAtSnowGlobe.bind(null, api) });
    api.onItemAction(useToy.bind(null, api));
  },
};
