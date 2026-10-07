// Teleport to boat tablets (https://oldschool.runescape.wiki/w/Teleport_to_boat_(tablet)): to a
// moored boat with a greater teleport focus built, landing at its dock and boarding it. With more
// than one such boat the player picks one; the boat they were last on comes first.
// ponytail: the pick is a chatbox menu, not the boat selection interface (its teleport mode isn't
// captured); breaking one aboard is refused rather than losing the boat as OSRS does; the
// no-focus message is ours, the Wiki doesn't give it.
const { Sailing } = require("../../../src/main/typescript/elvarg/game/content/sailing/Sailing");
const { content, boatName, playSound } = require("./sailingContent");
const { hotspotsOf, facilityAt, facilityNamed } = require("./boatFacilities");

const SOUND_BOARD_BOAT = 10754;

let pluginApi;
let core;

function hasGreaterFocus(boat) {
  const focus = facilityNamed("Greater teleport focus");
  return hotspotsOf(boat.type).some((hotspot) => facilityAt(boat, hotspot.id) === focus);
}

/** The player's moored boats with a greater teleport focus, the last one sailed first. */
function reachableBoats(player) {
  const active = Sailing.activeBoat(player);
  return player.getSailing().boats
    .filter((boat) => boat.location.kind === "docked" && hasGreaterFocus(boat))
    .sort((a, b) => (b === active) - (a === active));
}

function teleportToBoat(player, itemId, boat) {
  const dock = Sailing.getDock(boat.location.dock);
  if (!dock) return;
  const landing = new core.Location(dock.landing.x, dock.landing.y, dock.landing.z);
  if (!player.getInventory().contains(itemId) || !core.TeleportHandler.checkReqs(player, landing)) return;
  const useTablet = () => player.getInventory().deleteNumber(itemId, 1);
  core.TeleportHandler.teleport(player, landing, core.TeleportType.TELE_TAB, false, () => {
    const refusal = Sailing.board(player, dock.id, boat.slot);
    if (refusal) {
      player.sendMessage(refusal);
      return;
    }
    playSound(player, SOUND_BOARD_BOAT);
    player.sendMessage("You board your boat.");
  }, useTablet);
}

function breakTablet({ player, itemId }) {
  if (Sailing.instanceAboard(player)) {
    player.sendMessage("You're already on a boat.");
    return true;
  }
  const boats = reachableBoats(player);
  if (boats.length === 0) {
    player.sendMessage("You need a moored boat with a greater teleport focus to use this tablet.");
    return true;
  }
  if (boats.length === 1) {
    teleportToBoat(player, itemId, boats[0]);
    return true;
  }
  const options = boats.flatMap((boat) => [
    `${boatName(boat)} (${Sailing.getDock(boat.location.dock)?.name ?? "unknown"})`,
    () => teleportToBoat(player, itemId, boat),
  ]);
  pluginApi.sendMultiChatboxPrompt(player, "Teleport to which boat?", ...options);
  return true;
}

module.exports = {
  name: "SailingBoatTeleport",
  members: true,
  register(api) {
    pluginApi = api;
    core = api.core;
    content();
    api.onItemAction("Teleport to boat", { Break: breakTablet });
  },
  _test: { reachableBoats, hasGreaterFocus },
};
