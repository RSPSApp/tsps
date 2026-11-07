// Summon boat tablets (https://oldschool.runescape.wiki/w/Summon_boat): bring a boat with a
// teleport focus to the dock or mooring point the player is near. As captured (rsprox, four
// breaks): Break opens the boat selection in its Summon mode (6); choosing a boat moves it, the
// player breaks the tablet (poh_smash_magic_tablet, sound 965), and two ticks later "Your boat has
// been summoned to <dock>." with teleport_other_casting, sound 199 and the tablet used up; busy
// clears two ticks after that. Like a shipwright's recovery, the hold loses its port task cargo,
// salvage and fish (Wiki). "Last boat" summons the boat last summoned without the interface.
// ponytail: how near "near a dock" is isn't in the client cache (table 194's zones are server
// side): within SUMMON_RANGE of the gangplank or landing here, which covers the captured breaks.
// "Last boat" isn't captured: it plays as Break's choice does; its refusals and the same-dock and
// no-focus messages are ours.
const { Sailing } = require("../../../src/main/typescript/elvarg/game/content/sailing/Sailing");
const { content, dockNear } = require("./SailingContent.Sailing");
const { teleportFocusOf } = require("./BoatFacilities.Sailing");
const { openBoatSelection, MODE } = require("./BoatSelection.plugin");
const { dropLostOnRecovery } = require("./Cargo.Sailing");
const { sendBoatVarbits } = require("./BoatVarbits.Sailing");

const LAST_SUMMONED_ATTRIBUTE = "sailing:last-summoned-boat";
const SUMMON_RANGE = 16;

function nearbyDock(player) {
  return dockNear(player, SUMMON_RANGE);
}
const VARBIT_BUSY = 12393;
const SEQ_BREAK_TABLET = 4069; // poh_smash_magic_tablet
const SOUND_BREAK_TABLET = 965;
const SEQ_CAST = 1818; // human_teleport_other_casting
const SPOT_CAST = 343; // teleport_other_casting
const SOUND_CAST = 199;
const CAST_TICKS = 2;
const BUSY_TICKS = 4;

const NOT_NEAR_DOCK = "You need to be near a dock or mooring point to use this tablet.";

let core;

function later(player, ticks, action) {
  core.TaskManager.submit(new (class extends core.Task {
    constructor() { super(ticks, player, false); }
    execute() {
      this.stop();
      action();
    }
  })());
}

/**
 * Whether a boat has a teleport focus, or a greater one, built: only those can be summoned (Wiki;
 * table 149's Summon mode `requires_teleport_focus`, which the client checks against the varbit).
 */
function hasFocus(boat) {
  return teleportFocusOf(boat) > 0;
}

function summonRefusal(player, boat, dock) {
  if (!boat) return "You can't choose that boat at the moment.";
  if (!hasFocus(boat)) return "That boat needs a teleport focus to be summoned.";
  if (boat.location.kind === "docked" && boat.location.dock === dock.id) return "That boat is already at the nearby dock.";
  return Sailing.recoverRefusal(player, boat.slot, dock.id);
}

/** Summons the boat in `slot` to `dock` with one tablet, as captured. */
function summon(player, itemId, dock, slot) {
  const sender = player.getPacketSender();
  const boat = player.getSailing().boats.find((owned) => owned.slot === slot);
  const refusal = player.getInventory().contains(itemId) ? summonRefusal(player, boat, dock) : "";
  if (refusal !== null) {
    if (refusal) player.sendMessage(refusal);
    sender.sendVarbit(VARBIT_BUSY, 0);
    return;
  }
  // The tablet goes with the boat's move, not with the cast two ticks later (when the captures show it leave the
  // pack): dropping or banking it in between summoned the boat for free and kept the tablet.
  player.getInventory().deleteNumber(itemId, 1);
  Sailing.recover(player, slot, dock.id);
  dropLostOnRecovery(boat);
  sendBoatVarbits(player);
  player.setAttribute(LAST_SUMMONED_ATTRIBUTE, slot);
  player.performAnimation(new core.Animation(SEQ_BREAK_TABLET, 16));
  sender.sendSoundEffect(SOUND_BREAK_TABLET, 1, 15);
  later(player, CAST_TICKS, () => {
    player.sendMessage(`Your boat has been summoned to ${dock.theName}.`);
    player.performGraphic(new core.Graphic(SPOT_CAST));
    player.performAnimation(new core.Animation(SEQ_CAST));
    const at = player.getLocation();
    core.Sounds.playAreaSound({ soundId: SOUND_CAST, x: at.getX(), y: at.getY(), level: at.getZ(), radius: 10 });
  });
  later(player, BUSY_TICKS, () => sender.sendVarbit(VARBIT_BUSY, 0));
}

function breakTablet({ player, itemId }) {
  const dock = !Sailing.instanceAboard(player) && nearbyDock(player);
  if (!dock) {
    player.sendMessage(NOT_NEAR_DOCK);
    return true;
  }
  openBoatSelection(player, MODE.SUMMON, dock, (slot) => summon(player, itemId, dock, slot));
  return true;
}

function lastBoat({ player, itemId }) {
  const dock = !Sailing.instanceAboard(player) && nearbyDock(player);
  if (!dock) {
    player.sendMessage(NOT_NEAR_DOCK);
    return true;
  }
  const slot = player.getAttribute(LAST_SUMMONED_ATTRIBUTE);
  if (!Number.isInteger(slot)) {
    player.sendMessage("You haven't summoned a boat yet.");
    return true;
  }
  player.getPacketSender().sendVarbit(VARBIT_BUSY, 1);
  summon(player, itemId, dock, slot);
  return true;
}

module.exports = {
  name: "SailingSummonBoat",
  members: true,
  register(api) {
    core = api.core;
    content();
    api.persistAttribute(LAST_SUMMONED_ATTRIBUTE);
    api.onItemAction("Summon boat", { Break: breakTablet, "Last boat": lastBoat });
  },
  _test: { nearbyDock, hasFocus, summon, SUMMON_RANGE, LAST_SUMMONED_ATTRIBUTE },
};
