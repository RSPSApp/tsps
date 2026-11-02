/**
 * The league screens' main modals, as the Leagues VI recordings send them (data `modals`): a
 * screen about to open asks `league:modal-opening` { player, group } first, which sets varbit busy
 * and lets an open league floater close (the task list listens); the modal's own unit then runs
 * script 2524, opens it and sends its events. Closing that modal, by any route, clears busy.
 */
const Common = require("./Common.LeagueMode");

/** Player -> the league modal open now. */
const open = new WeakMap();

function opening({ player, group }) {
  if (!player || !Number.isInteger(group)) return;
  open.set(player, group);
  player.getPacketSender().sendVarbit(Common.data.modals.busyVarbit, 1);
}

function closed({ player, interfaceId }) {
  if (!player || open.get(player) !== interfaceId) return;
  open.delete(player);
  player.getPacketSender().sendVarbit(Common.data.modals.busyVarbit, 0);
}

module.exports = function attach(api) {
  api.onCustomEvent("league:modal-opening", opening);
  api.onCustomEvent("interface:closed", closed);
};
