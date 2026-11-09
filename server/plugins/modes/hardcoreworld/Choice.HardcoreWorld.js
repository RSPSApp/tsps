"use strict";

/**
 * After a death that counts, the character chooses how to go on, on the cache's hc_death_choice
 * (982). The client draws it from two varbits: hc_death_option (1 Reset, 2 Transfer, 0 neither
 * picked: "Pick an option to read more about it.") and hc_reset_count, and its own texts say what
 * each does (scripts 10240-10249):
 * Either way the grave and Death's Office's items are destroyed (Wiki: "items that would normally
 * go to a gravestone are permanently deleted"; `gravestones:forfeit`).
 * - Reset: "You will lose all your items, quest progress and experience ... Your character will be
 *   set up as if it were a brand new character." The player is logged out and the Hardcore save
 *   unmade (PlayerSave.unmake): it keeps only the account's name, password and remembered logins,
 *   so nobody else can claim the name, and the next login is a brand-new character (Tutorial Island
 *   where the world runs it, then Death's Office). The reset count outlives it (Common's resets file).
 * - Transfer: "Continue as a Non-hardcore player ... You will keep all items still on your person,
 *   as well as in your bank". The save, as the death left it, becomes the account's main character
 *   (persistence copyProfile) and the Hardcore one is unmade too, so the next login here starts a
 *   new Hardcore character. An account that already has a main character can't transfer (ours).
 * UNVERIFIED (no capture of a death on a Hardcore world): when the screen opens (here the tick
 * after the respawn), its confirmation (here a chatbox Yes / choose again, data `ours`), that
 * closing it opens it again until the player has chosen, and that until then the player can't
 * walk or click anything in the world (here: as long as the choice is pending).
 */
const Common = require("./Common.HardcoreWorld");

/** The screen opens the tick after the death's respawn has moved the player. */
const OPEN_DELAY_TICKS = 1;
const REOPEN_CHECK_TICKS = 2;
const LOGOUT_WAIT_MS = 100;
const LOGOUT_WAIT_TRIES = 100;

/** Players with the screen up and a task keeping it there. */
const watching = new WeakSet();

function pending(player) {
  return player.getAttribute(Common.CHOICE_PENDING_ATTRIBUTE) === true && !player.getAttribute(Common.LEAVING_ATTRIBUTE);
}

function selected(player) {
  return Number(player.getAttribute(Common.DEATH_OPTION_ATTRIBUTE)) || 0;
}

/** The screen as the death left it, a couple of ticks after the respawn. */
function afterDeath(player) {
  Common.later(player, OPEN_DELAY_TICKS, () => open(player));
}

/** Logged in with the choice still to make. */
function resume(player) {
  Common.later(player, OPEN_DELAY_TICKS, () => open(player));
}

function open(player) {
  if (!pending(player) || !Number.isInteger(Common.ids.choiceInterface)) return;
  Common.setVarbit(player, "resetCount", Common.resetCount(player.getUsername()));
  Common.setVarbit(player, "deathOption", selected(player));
  player.getPacketSender().sendInterface(Common.ids.choiceInterface);
  watch(player);
}

/** While the choice is pending the screen stays up: closing it brings it back. */
function watch(player) {
  if (watching.has(player)) return;
  watching.add(player);
  const check = () => {
    if (!pending(player)) {
      watching.delete(player);
      return;
    }
    if (player.getInterfaceId?.() !== Common.ids.choiceInterface && !player.getDialogueManager?.()?.getCurrent?.()) {
      player.getPacketSender().sendInterface(Common.ids.choiceInterface);
    }
    Common.later(player, REOPEN_CHECK_TICKS, check);
  };
  Common.later(player, REOPEN_CHECK_TICKS, check);
}

/** `player:world-input`: with the choice to make, the world waits (walking, clicks on it). */
function holdWorldInput(event) {
  if (Common.isHardcore(event.player) && pending(event.player)) event.handled = true;
}

/** "Select" on Reset or Transfer: shows its text, then asks to confirm. */
function select(event) {
  const { player, buttonId } = event;
  if (!Common.isHardcore(player) || !pending(player)) return false;
  const { deathOption } = Common.DATA;
  const option = buttonId === Common.ids.resetButton ? deathOption.reset : buttonId === Common.ids.transferButton ? deathOption.transfer : 0;
  if (!option) return false;
  player.setAttribute(Common.DEATH_OPTION_ATTRIBUTE, option);
  Common.setVarbit(player, "deathOption", option);
  confirm(player, option);
  return true;
}

function confirm(player, option) {
  const { ours, deathOption } = Common.DATA;
  const reset = option === deathOption.reset;
  Common.api().sendMultiChatboxPrompt(player, ours.confirmTitle,
    reset ? ours.confirmReset : ours.confirmTransfer, () => (reset ? chooseReset(player) : chooseTransfer(player)),
    ours.chooseAgain, () => {},
  );
}

function persistence() {
  return Common.core().GameConstants.PLAYER_PERSISTENCE;
}

/** Waits for the account to be fully offline (its logout save queued and written), then runs `after`. */
function whenOffline(name, after) {
  const { World } = Common.core();
  let tries = 0;
  const poll = async () => {
    if (World.getPlayerByName(name) && ++tries < LOGOUT_WAIT_TRIES) {
      setTimeout(poll, LOGOUT_WAIT_MS);
      return;
    }
    try {
      await persistence().flush?.();
      await after();
    } catch (error) {
      console.error(`[hardcore-world] could not finish ${name}'s choice`, error);
    }
  };
  setTimeout(poll, LOGOUT_WAIT_MS);
}

/** The death's grave and Death's Office's items are gone, whatever the choice. */
function forfeitGrave(player) {
  Common.api().emitCustomEvent("gravestones:forfeit", { player });
}

/** The Hardcore save keeps only the account (PlayerSave.unmake): never none, or the name is free to take. */
function unmakeSave(name) {
  return persistence().updateOffline(name, (save) => save.unmake(), "hardcore-reset", Common.HARDCORE_PROFILE);
}

function chooseReset(player) {
  if (!pending(player)) return;
  const name = player.getUsername();
  Common.recordReset(name);
  player.setAttribute(Common.LEAVING_ATTRIBUTE, "reset");
  forfeitGrave(player);
  // The life is over: nothing of it is written again, and its save keeps only the account.
  player.setAttribute(Common.SKIP_PERSISTENCE_ATTRIBUTE, true);
  player.getPacketSender().sendInterfaceRemoval();
  player.requestLogout();
  whenOffline(name, () => unmakeSave(name));
}

function chooseTransfer(player) {
  if (!pending(player)) return;
  const name = player.getUsername();
  if (persistence().exists(name, Common.core().MAIN_PROFILE)) {
    player.sendMessage(Common.DATA.ours.transferTaken);
    return;
  }
  player.setAttribute(Common.LEAVING_ATTRIBUTE, "transfer");
  forfeitGrave(player);
  // The character goes on as it is: no longer Hardcore, nothing left to choose.
  player.setAttribute(Common.CHOICE_PENDING_ATTRIBUTE, false);
  player.setAttribute(Common.DEATH_OPTION_ATTRIBUTE, 0);
  player.setAttribute(Common.DIED_DATE_ATTRIBUTE, 0);
  player.getPacketSender().sendInterfaceRemoval();
  player.requestLogout();
  whenOffline(name, async () => {
    if (await persistence().copyProfile(name, Common.HARDCORE_PROFILE, Common.core().MAIN_PROFILE, "hardcore-transfer")) {
      await unmakeSave(name);
    }
  });
}

module.exports = function attach(api) {
  if (Number.isInteger(Common.ids.resetButton) && Number.isInteger(Common.ids.transferButton)) {
    api.onInterfaceActionButton([Common.ids.resetButton, Common.ids.transferButton], select);
  }
  api.onCustomEvent("player:world-input", holdWorldInput);
};

Object.assign(module.exports, { afterDeath, resume, open, select, chooseReset, chooseTransfer, pending, holdWorldInput });
