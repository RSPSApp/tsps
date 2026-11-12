/**
 * The combat mastery interface (league_combat_mastery, 311), as captured: the league side panel's
 * mastery button opens it as the main modal with the click events on its node clickzones, menu
 * frame and style tabs, and clears the panel's highlight; a tab click records the tab
 * (varbit league_combat_mastery_tab); a clickzone click records the node viewed (varbit
 * league_combat_mastery_last_viewed) and runs the client's view script with the node's struct and
 * its tier's passive struct; the confirm button unlocks the viewed node; the close button closes.
 */
const Common = require("./Common.LeagueCombatMasteries");
const Unlock = require("./Unlock.LeagueCombatMasteries");

/** if_setevents OP1 (as SideJournalDefaults sends it). */
const FLAGS_OP1 = 1 << 1;

/** Players who opened the interface through the panel's button, and the clickzone slot they last viewed (-1 none); other clicks are ignored. */
const viewing = new WeakMap();

function ui() {
  return Common.data.interface;
}

/** The style and tier a clickzone slot stands for (slots run per style from its `slotBase`), or null. */
function nodeOf(slot) {
  const index = Number(slot);
  if (!Number.isInteger(index) || index < 0) return null;
  const { slotsPerStyle } = ui();
  for (const styleKey of Common.STYLE_KEYS) {
    const { slotBase } = Common.style(styleKey);
    if (index >= slotBase && index < slotBase + slotsPerStyle) return { styleKey, tier: index - slotBase + 1 };
  }
  return null;
}

function open({ player }) {
  if (!Common.isEchoes(player)) return false;
  const { group, clickzones, clickzoneSlots, menuFrame, menuFrameSlots, tabs, tabSlots, highlight, highlightScript } = ui();
  const sender = player.getPacketSender();
  sender.sendInterface(group);
  sender.sendInterfaceFlagsRange(Common.uid(group, clickzones), clickzoneSlots[0], clickzoneSlots[1], FLAGS_OP1);
  sender.sendInterfaceFlagsRange(Common.uid(group, menuFrame), menuFrameSlots[0], menuFrameSlots[1], FLAGS_OP1);
  sender.sendInterfaceFlagsRange(Common.uid(group, tabs), tabSlots[0], tabSlots[1], FLAGS_OP1);
  sender.sendInterfaceScript(highlightScript, [Common.uid(highlight[0], highlight[1])]);
  viewing.set(player, -1);
  return true;
}

function tab({ player, slot }) {
  const index = Number(slot);
  const { tabStride, tabSlots } = ui();
  if (!viewing.has(player) || !Number.isInteger(index) || index < tabSlots[0] || index > tabSlots[1]) return false;
  player.getPacketSender().sendVarbit(Common.data.varbits.tab, Math.floor(index / tabStride));
  return true;
}

function view({ player, slot }) {
  const node = viewing.has(player) ? nodeOf(slot) : null;
  if (!node) return false;
  const { group, viewScript, viewScriptComponents } = ui();
  const sender = player.getPacketSender();
  viewing.set(player, Number(slot));
  sender.sendVarbit(Common.data.varbits.lastViewed, Number(slot));
  sender.sendInterfaceScript(viewScript, [
    ...viewScriptComponents.map((child) => Common.uid(group, child)),
    Common.mastery(node.styleKey, node.tier).struct,
    Common.data.passiveStructs[node.tier - 1],
  ]);
  return true;
}

function confirm({ player }) {
  if (!viewing.has(player)) return false;
  const node = nodeOf(viewing.get(player));
  if (!node) {
    player.sendMessage(Common.message("selectFirst"));
    return true;
  }
  if (Unlock.unlock(player, node.styleKey, node.tier)) viewing.delete(player);
  return true;
}

function close({ player }) {
  if (!viewing.has(player)) return false;
  viewing.delete(player);
  player.getPacketSender().sendInterfaceRemoval();
  return true;
}

/** The modal closed another way (another interface, a logout): later clicks need the button again. */
function closed({ player, interfaceId }) {
  if (interfaceId === ui().group) viewing.delete(player);
}

module.exports = function attach(api) {
  const { group, openButton, clickzones, tabs, confirm: confirmChild, close: closeChild } = ui();
  // A locked player (mid-teleport, on an obstacle) is told to finish first, and nothing opens.
  api.refuseWhileBusy(Common.uid(openButton[0], openButton[1]));
  api.onInterfaceActionButton(Common.uid(openButton[0], openButton[1]), open);
  api.onInterfaceActionButton(Common.uid(group, tabs), tab);
  api.onInterfaceActionButton(Common.uid(group, clickzones), view);
  api.onInterfaceActionButton(Common.uid(group, confirmChild), confirm);
  api.onInterfaceActionButton(Common.uid(group, closeChild), close);
  api.onCustomEvent("interface:closed", closed);
};

module.exports.nodeOf = nodeOf;
