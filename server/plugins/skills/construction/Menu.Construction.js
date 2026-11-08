"use strict";

const { ActionDialogue, DialogueChainBuilder, StatementDialogue } = require("./Core.Construction");
const Ids = require("./Ids.Construction");

// The cache's generic option menu (interface "menu", script 217: title, "a|b|c", show numbers).
// A pick is a resume_pausebutton on menu:lj_layer1 with the option's index as sub.
const MENU_INTERFACE = Ids.iface("menu");
const MENU_OPTIONS = (MENU_INTERFACE << 16) | 3;
const MENU_SCRIPT = 217;
const PAUSE_BUTTON_EVENTS = 1;

const pendingMenus = new WeakMap();

/** Shows `labels` under `title`; `choose(index)` runs when the player picks one. */
function openMenu(player, title, labels, choose) {
  const sender = player.getPacketSender();
  sender.sendInterfaceRemoval();
  sender.sendInterface(MENU_INTERFACE);
  sender.sendClientScript(MENU_SCRIPT, 1, title, labels.join("|"));
  sender.sendInterfaceFlagsRange(MENU_OPTIONS, 0, labels.length - 1, PAUSE_BUTTON_EVENTS);
  pendingMenus.set(player, { count: labels.length, choose });
}

/** A refusal live OSRS shows in a message box rather than the chat (rsprox captures: mesbox). */
function messageBox(text) {
  return { messageBox: text };
}

/** Sends a refusal from a check: a plain string goes to the chat, a messageBox() opens the box. */
function refuse(player, problem) {
  if (typeof problem === "string") return player.sendMessage(problem);
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(new StatementDialogue(0, problem.messageBox)));
}

/** A message box whose "Click here to continue" carries on with `then` (rsprox captures: mesbox). */
function warn(player, text, then) {
  player.getDialogueManager().startDialogues(new DialogueChainBuilder()
    .add(new StatementDialogue(0, text))
    .add(new ActionDialogue(1, { execute: then })));
}

function chooseOption(event) {
  if (event.groupId !== MENU_INTERFACE || event.childId !== 3) return;
  const pending = pendingMenus.get(event.player);
  if (!pending) return;
  event.handled = true;
  pendingMenus.delete(event.player);
  if (event.player.getInterfaceId() !== MENU_INTERFACE) return;
  const index = event.slot ?? event.action;
  event.player.getPacketSender().sendInterfaceRemoval();
  if (Number.isInteger(index) && index >= 0 && index < pending.count) pending.choose(index);
}

function closeMenu({ player }) {
  pendingMenus.delete(player);
}

function attachMenus(api) {
  api.onInterfaceActionClick(chooseOption);
  api.onCustomEvent("interface:close", closeMenu);
  api.onPlayerLogout(closeMenu);
}

Object.assign(module.exports, { openMenu, messageBox, refuse, warn, attachMenus });
