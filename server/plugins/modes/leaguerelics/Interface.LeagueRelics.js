/**
 * The relic interface (league_relics, 655), as captured: the side panel's View Relics opens it as
 * the main modal with the click events on its tier slots; a slot click records the relic viewed
 * (varbit league_relic_last_viewed = tier x 3 + slot) and runs the client's redraw scripts;
 * the confirm button unlocks the viewed relic.
 */
const Common = require("./Common.LeagueRelics");
const Unlock = require("./Unlock.LeagueRelics");

const { FLAG_OP1 } = require("../../interface/widgetGroup");
const SLOTS_PER_TIER = 3;
/** if_setevents IF_SCRIPT_TRIGGER (bit 23, as RSProx names it): the relic effect toggles' script triggers. */
const FLAG_SCRIPT_TRIGGER = 1 << 23;

/**
 * Players who opened the interface through View Relics: the slot they last viewed (-1 none) and
 * whether their bank was open then. The modal replaces the bank as the main interface, so a
 * relic that hands out an item is allowed on what was open when View Relics was clicked.
 */
const viewing = new WeakMap();

function ui() {
  return Common.data.interface;
}

function open({ player }) {
  const type = Common.leagueOf(player);
  if (type === null) return false;
  const { group, clickzones, clickzoneSlots, menuFrame, menuFrameSlots } = ui();
  // Read before the modal replaces the bank as the main interface.
  const bankOpen = Common.core.Bank.isOpen(player);
  Common.api.emitCustomEvent("league:send-content", { player });
  Common.api.emitCustomEvent("league:modal-opening", { player, group });
  const sender = player.getPacketSender();
  sender.sendInterfaceScript(ui().modalSize[0], ui().modalSize[1]);
  sender.sendInterface(group);
  sender.sendInterfaceFlagsRange(Unlock.uid(group, clickzones), clickzoneSlots[0], clickzoneSlots[1], FLAG_OP1);
  sender.sendInterfaceFlagsRange(Unlock.uid(group, menuFrame), menuFrameSlots[0], menuFrameSlots[1], FLAG_OP1);
  sender.sendInterfaceFlagsRange(Unlock.uid(group, ui().toggles), -1, -1, FLAG_SCRIPT_TRIGGER);
  viewing.set(player, { slot: -1, bankOpen });
  return true;
}

/**
 * What the relic is to the viewer, as 3193 takes it (the interface data's `viewStates`): their own (the tier's pick,
 * or Reloaded's), another of a chosen tier (unless Reloaded may still take it), out of reach of
 * their points, or theirs to choose.
 */
function viewState(player, type, tier, relicSlot) {
  const states = ui().viewStates;
  const picked = Common.chosen(player)[tier];
  const reloaded = Common.reloadedPick(player, type);
  if (picked === relicSlot || reloaded === Common.relic(type, tier, relicSlot)) return states.unlocked;
  if (picked !== undefined) {
    // Reloaded's extra pick may still take it: chosen tiers stay open to that one choice.
    const reloadedWhy = Unlock.reloadedRefusal(player, type, tier, relicSlot, true);
    return reloadedWhy === null || reloadedWhy === "alreadyChosen" ? states.tierTaken : states.available;
  }
  if (Common.points(player) < Common.catalog(type).tiers[tier].cost) return states.locked;
  return states.available;
}

function view({ player, slot }) {
  const type = Common.leagueOf(player);
  const index = Number(slot);
  const state = viewing.get(player);
  if (type === null || !state || !Number.isInteger(index) || index < 0) return false;
  const tier = Math.floor(index / SLOTS_PER_TIER);
  const relicSlot = (index % SLOTS_PER_TIER) + 1;
  if (!Common.relic(type, tier, relicSlot)) return false;
  const { group, viewScript, viewScriptComponents, toggleScript, toggleScriptComponents } = ui();
  const structs = Common.structIds(type, tier, relicSlot);
  const sender = player.getPacketSender();
  state.slot = index;
  sender.sendVarbit(Common.data.lastViewedVarbit, index);
  // This cache's script takes the relic's description and the tier's passive text after the structs.
  const relic = Common.relic(type, tier, relicSlot);
  const passive = Common.catalog(type).tiers[tier]?.passive ?? "";
  sender.sendInterfaceScript(viewScript, [
    ...viewScriptComponents.map((child) => Unlock.uid(group, child)),
    viewState(player, type, tier, relicSlot),
    structs.relicStruct,
    structs.passiveStruct,
    String(relic.description ?? ""),
    String(passive),
  ]);
  sender.sendInterfaceScript(toggleScript, [...toggleScriptComponents.map((child) => Unlock.uid(group, child)), 0, 1]);
  return true;
}

function confirm({ player }) {
  const state = viewing.get(player);
  if (!state) return false;
  if (player.getInterfaceId() !== ui().group) {
    // The modal is gone (closed, or walked away from): the click is stale.
    viewing.delete(player);
    return false;
  }
  if (state.slot < 0) {
    player.sendMessage(Common.message("selectFirst"));
    return true;
  }
  // The bank counts while the player is still banking behind the modal (closing it resets the status).
  const bankOpen = state.bankOpen && player.getStatus() === Common.core.PlayerStatus.BANKING;
  if (Unlock.unlock(player, Math.floor(state.slot / SLOTS_PER_TIER), (state.slot % SLOTS_PER_TIER) + 1, { bankOpen })) viewing.delete(player);
  return true;
}

module.exports = function attach(api) {
  const { group, openButton, clickzones, confirm: confirmChild } = ui();
  api.onInterfaceActionButton(Unlock.uid(openButton[0], openButton[1]), open);
  api.onInterfaceActionButton(Unlock.uid(group, clickzones), view);
  api.onInterfaceActionButton(Unlock.uid(group, confirmChild), confirm);
};
