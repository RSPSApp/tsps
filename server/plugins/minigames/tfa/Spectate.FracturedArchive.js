"use strict";

/**
 * Spectating a party from outside, from the lobby's Strategy board (63083, "Spectate").
 *
 * Captured (docs/fractured-archive.md):
 * - The board asks "Spectate a specific party." / "Spectate a recent party." / "Cancel.".
 * - Specific: "Who would you like to spectate?" by name. If they aren't in the Archive: "<name>
 *   does not appear to be defending the Archive."; offline: "That player is offline, or has
 *   privacy mode enabled."
 * - Recent: "There aren't any recent raids to spectate."
 * - Carrying anything: "Spectators cannot bring anything into the Archive. Please visit the bank
 *   to deposit your items."
 * - In: parked out of sight in the party's room with the HUD (RaidState addWatcher). Clicking a
 *   fighter's health follows them. The party's moves are followed; Leave, a wipe or the party
 *   leaving sends the spectator back to the lobby.
 * Estimates: "recent" picks the raid that started last, and the item check is shown as a message
 * (live strikes out the menu option).
 */

const Shared = require("./Shared.FracturedArchive");
const Raid = require("./RaidState.FracturedArchive");

const TEXT = {
  NOT_IN: (name) => `${name} does not appear to be defending the Archive.`,
  OFFLINE: "That player is offline, or has privacy mode enabled.",
  NO_RECENT: "There aren't any recent raids to spectate.",
  ITEMS: "Spectators cannot bring anything into the Archive. Please visit the bank to deposit your items.",
};

function carriesAnything(player) {
  const has = (container) => container.getItems().some((item) => item && item.getId() > 0 && item.getAmount() > 0);
  return has(player.getInventory()) || has(player.getEquipment());
}

/** Whether a player can start spectating: in the lobby, and not in a raid or watching one. */
function canSpectate(player) {
  return Shared.inLobby(player.getLocation()) && !Raid.raidOf(player) && !Raid.watchedBy(player);
}

/** After the prompt or menu choice, so the board's checks are made again (they may have moved). */
function watch(player, raid) {
  if (!canSpectate(player)) return;
  if (carriesAnything(player)) {
    Shared.mesbox(player, TEXT.ITEMS);
    return;
  }
  if (!raid || raid.over || !raid.room || raid.players.length === 0) {
    Shared.mesbox(player, TEXT.NO_RECENT);
    return;
  }
  player.getPacketSender().sendInterfaceRemoval();
  raid.addWatcher(player);
}

function specific(player) {
  player.setEnteredSyntaxAction({
    execute: (input) => {
      const name = String(input ?? "").trim();
      const target = Shared.core().World.getPlayerByName(name);
      if (!target) {
        Shared.mesbox(player, TEXT.OFFLINE);
        return;
      }
      const raid = Raid.raidOf(target);
      if (!raid || raid.over || !raid.players.includes(target)) {
        Shared.mesbox(player, TEXT.NOT_IN(Shared.displayName(target)));
        return;
      }
      watch(player, raid);
    },
  });
  player.getPacketSender().sendEnterInputPrompt("Who would you like to spectate?");
}

function recent(player) {
  const running = [...Raid.raids.values()].filter((raid) => !raid.over && raid.players.length > 0 && raid.raidStart >= 0);
  running.sort((a, b) => b.raidStart - a.raidStart);
  if (running.length === 0) {
    Shared.mesbox(player, TEXT.NO_RECENT);
    return;
  }
  watch(player, running[0]);
}

function spectateBoard({ player }) {
  if (!Shared.inLobby(player.getLocation())) return false;
  if (!canSpectate(player)) return true;
  Shared.options(player, "Select an option", "Spectate a specific party.", () => specific(player), "Spectate a recent party.", () => recent(player), "Cancel.", () => {});
  return true;
}

module.exports = function registerSpectate(api) {
  Shared.bind(api);
  api.onObjectInteraction("Strategy board", { Spectate: spectateBoard });
};
