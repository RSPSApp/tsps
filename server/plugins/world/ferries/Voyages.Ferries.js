/**
 * The five ways an NPC ferry travels, as rsprox recordings show them (tick 0 is the click, or
 * the player's arrival beside the NPC):
 *
 * - ship_journey (Monks of Entrana 239/4283, Void Knight squires 237/4012): the player alone on
 *   the ship at sea (an instance of the 3064,3208 chunk), interface 299 with script 1131's route,
 *   song 147 and jingle 172, the side tabs closed; the deck N ticks later with a message box.
 *   PiratesTreasure.Quest.js's Karamja boats are the same voyage.
 * - longship (Jarvald 229/2714, the Sailor 229/2703, Mord and Maria Gunnars 231/3027, 229/2722):
 *   the same ship at sea under misc_shipjourney (224), its model playing the route's animation;
 *   song 147 and jingle 171 on the Waterbirth and Miscellania ships only; no message box.
 * - galleon (Captain Bentley to Lunar Isle, 229/2710): quest_lunar_galleon (431) with its sail
 *   animation and jingle 171 while the player waits on deck, then Lunar Isle 11 ticks later.
 * - fade (Veos's ship 224/1434, Lokar and Bentley's return 231/3024, Torfinn 238/4136, the
 *   barge's Quick-Travel 239/4263): fade_overlay out, the move a few ticks later, back in.
 * - rowing (Jeb, 224/1434): fade out, then seaslug_boat_travel (461) over the platform with the
 *   route's layer, jingle 172 and the minimap off; six ticks later the message box and fade in.
 *
 * The player is held still for the trip; a logout or a server shutdown lands them.
 */
const Common = require("./Common.Ferries");

const TOPLEVEL = 161;
const MAIN_MODAL_OPEN = 2524;
const OVERLAY_ATMOSPHERE_UID = (TOPLEVEL << 16) | 1;
const FADE_OVERLAY = 174;
const FADE_SCRIPT = 948;
const FADE_CYCLES = 50;
const SHIP_AT_SEA_CHUNK = { sourceChunkX: 3064 >> 3, sourceChunkY: 3208 >> 3, sourcePlane: 1, rotation: 0 };
const SHIP_JOURNEY = { interface: 299, script: 1131, jingle: 172 };
const LONGSHIP = { interface: "misc_shipjourney", model: "misc_shipjourney:misc_shipmodel", open: [4404769, 0], jingle: 171 };
const GALLEON = { interface: "quest_lunar_galleon", model: "quest_lunar_galleon:lunar_galleon", open: [2631714, 0], jingle: 171 };
const ROWING = { interface: "seaslug_boat_travel", open: [3750175, 42], jingle: 172, travel: 2, arrive: 8, closeOverlay: 10 };
const SEA_SONG = 147;
const SEA_JINGLE = 171;
const MINIMAP_STATE_VARBIT = "minimap_state";
const MINIMAP_OFF = 2;
const BUSY_VARBIT = "busy";
/** Side tabs the ship at sea closes (combat to magic, logout to music), with the group each gets back. */
const SHIP_TABS = [[77, 320], [78, 629], [79, 149], [80, 387], [86, 182], [87, 116], [88, 216], [89, 239]];
const COMBAT_TAB = 76;
const PRAYER_TAB = 81;
const MAGIC_TAB = 82;

let ShipAtSea = null;

/** The ship at sea: one chunk, the player alone on it until the ship arrives. */
function shipClass() {
  if (ShipAtSea) return ShipAtSea;
  const { TemplatedInstanceArea, TaskManager } = Common.core;
  ShipAtSea = class extends TemplatedInstanceArea {
    constructor(player, land) {
      super(1, 1);
      this.owner = player;
      this.land = land;
      this.setChunk(0, 0, 0, SHIP_AT_SEA_CHUNK);
    }

    canTeleport() { return false; }

    canAttack() { return false; }

    postLeave(mobile, logout) {
      if (mobile === this.owner) {
        TaskManager.cancelTasks(this);
        if (Common.travelling(mobile)) this.land(logout);
      }
      super.postLeave(mobile, logout);
    }
  };
  return ShipAtSea;
}

function sender(player) {
  return player.getPacketSender();
}

function setMinimap(player, off) {
  const id = Common.core.CacheDefinitions.getVarbitId(MINIMAP_STATE_VARBIT);
  if (id != null) sender(player).sendVarbit(id, off ? MINIMAP_OFF : 0);
}

function setBusy(player, busy) {
  const id = Common.core.CacheDefinitions.getVarbitId(BUSY_VARBIT);
  if (id != null) sender(player).sendVarbit(id, busy ? 1 : 0);
}

function fade(player, out) {
  const args = out ? [0, 255, 0, 0, FADE_CYCLES] : [0, 0, 0, 255, FADE_CYCLES];
  sender(player).sendSubInterface(OVERLAY_ATMOSPHERE_UID, FADE_OVERLAY, 1, { postScripts: [{ scriptId: FADE_SCRIPT, args }] });
}

function hold(player, held) {
  const movement = player.getMovementQueue();
  if (held) movement.reset();
  movement.setBlockMovement(held);
  player.setUntargetable?.(held);
}

function message(player, text, spam = false) {
  if (!text) return;
  if (spam) sender(player).sendTypedMessage(Common.core.ChatType.SPAM, text);
  else player.sendMessage(text);
}

function messageBox(player, text) {
  if (text) Common.core.StatementDialogue.send(player, text);
}

function seaSounds(player, jingle) {
  sender(player).sendSong(SEA_SONG).sendJingle(jingle, 0);
}

function closeShipTabs(player) {
  for (const slot of [COMBAT_TAB, PRAYER_TAB, MAGIC_TAB, ...SHIP_TABS.map(([tab]) => tab)]) {
    sender(player).closeSubInterface((TOPLEVEL << 16) | slot);
  }
}

/** As PiratesTreasure.Quest.js gives them back: combat, prayer and the spellbook by tab index. */
function reopenShipTabs(player) {
  const out = sender(player);
  out.sendTabInterface(0, 593);
  out.sendTabInterface(5, 541);
  out.sendTabInterface(6, player.getSpellbook().getInterfaceId());
  for (const [slot, group] of SHIP_TABS) out.sendTabInterface(slot, group);
  player.getInventory().refreshItems();
  player.getEquipment().refreshItems();
}

function runTicks(player, steps) {
  for (const [tick, action] of Object.entries(steps)) Common.later(player, Number(tick), action);
}

/** Puts the player on the ship at sea with a modal over it; `land` brings them ashore. */
function boardShip(player, trip, modal, onLand) {
  const Ship = shipClass();
  let landed = false;
  const land = (logout) => {
    if (landed) return;
    landed = true;
    Common.end(player);
    player.moveTo(Common.toLocation(trip.to));
    hold(player, false);
    if (logout) return;
    reopenShipTabs(player);
    sender(player).sendInterfaceRemoval();
    onLand?.();
  };
  const ship = new Ship(player, land);
  player.getDialogueManager().reset();
  hold(player, true);
  player.moveTo(ship.tile(0, 0, 0));
  ship.enter(player);
  modal();
  closeShipTabs(player);
  Common.begin(player, { land });
  Common.core.TaskManager.submit(new Common.core.CountdownTask(ship, trip.ticks, () => {
    land(false);
    ship.leave(player, false);
  }));
}

function shipJourney(player, trip) {
  message(player, trip.board);
  boardShip(player, trip, () => {
    seaSounds(player, SHIP_JOURNEY.jingle);
    sender(player).sendInterface(SHIP_JOURNEY.interface).sendClientScript(SHIP_JOURNEY.script, trip.route);
  }, () => messageBox(player, trip.arrive));
}

function longship(player, trip) {
  const { CacheDefinitions } = Common.core;
  message(player, trip.board, true);
  boardShip(player, trip, () => {
    const out = sender(player);
    out.sendInterfaceScript(MAIN_MODAL_OPEN, LONGSHIP.open);
    out.sendInterface(CacheDefinitions.getInterfaceId(LONGSHIP.interface));
    out.sendInterfaceAnimation(CacheDefinitions.getComponentId(LONGSHIP.model), CacheDefinitions.getSeqId(trip.seq));
    if (trip.sea) seaSounds(player, SEA_JINGLE);
  }, () => message(player, trip.arrive, true));
}

/** The galleon sails with the player on deck; nothing moves them until it arrives. */
function galleon(player, trip) {
  const { CacheDefinitions } = Common.core;
  const out = sender(player);
  player.getDialogueManager().reset();
  hold(player, true);
  out.sendInterfaceScript(MAIN_MODAL_OPEN, GALLEON.open);
  out.sendInterface(CacheDefinitions.getInterfaceId(GALLEON.interface));
  out.sendInterfaceAnimation(CacheDefinitions.getComponentId(GALLEON.model), CacheDefinitions.getSeqId(trip.seq));
  seaSounds(player, GALLEON.jingle);
  const land = () => {
    if (!Common.travelling(player)) return;
    Common.end(player);
    player.moveTo(Common.toLocation(trip.to));
    hold(player, false);
    out.sendInterfaceRemoval();
  };
  Common.begin(player, { land });
  Common.later(player, trip.ticks, land);
}

function fadeTrip(player, trip) {
  const out = sender(player);
  const [minimapOff, minimapOn] = trip.minimap ?? [];
  const [busyOn, busyOff] = trip.busy ?? [];
  const land = () => {
    if (!Common.travelling(player)) return;
    player.moveTo(Common.toLocation(trip.to));
    if (trip.message?.at === trip.teleport) message(player, trip.message.text, trip.message.spam);
  };
  hold(player, true);
  if (trip.sea) seaSounds(player, SEA_JINGLE);
  if (trip.message?.at === 0) message(player, trip.message.text, trip.message.spam);
  fade(player, true);
  Common.begin(player, { land: () => { land(); finish(); } });
  const finish = () => {
    if (!Common.travelling(player)) return;
    Common.end(player);
    hold(player, false);
    if (minimapOn != null) setMinimap(player, false);
    if (busyOff != null) setBusy(player, false);
  };
  const steps = {
    [trip.teleport]: land,
    [trip.fadeIn]: () => {
      if (minimapOn === trip.fadeIn) setMinimap(player, false);
      fade(player, false);
      finish();
    },
    [trip.close]: () => out.closeSubInterface(OVERLAY_ATMOSPHERE_UID),
  };
  if (minimapOff != null) {
    const previous = steps[minimapOff];
    steps[minimapOff] = () => { previous?.(); setMinimap(player, true); };
  }
  if (busyOn != null) {
    const previous = steps[busyOn];
    steps[busyOn] = () => { previous?.(); setBusy(player, true); };
  }
  runTicks(player, steps);
}

/** Jeb's rowing boat: fade, the boat crossing over the platform's map, then the message box. */
function rowing(player, trip) {
  const { CacheDefinitions } = Common.core;
  const out = sender(player);
  hold(player, true);
  fade(player, true);
  const land = () => {
    if (!Common.travelling(player)) return;
    player.moveTo(Common.toLocation(trip.to));
  };
  const finish = () => {
    if (!Common.travelling(player)) return;
    Common.end(player);
    hold(player, false);
    setMinimap(player, false);
  };
  Common.begin(player, { land: () => { land(); finish(); } });
  runTicks(player, {
    [ROWING.travel]: () => {
      setMinimap(player, true);
      land();
      out.sendJingle(ROWING.jingle, 0);
      out.sendInterfaceScript(MAIN_MODAL_OPEN, ROWING.open);
      out.sendInterface(CacheDefinitions.getInterfaceId(ROWING.interface));
      out.sendInterfaceDisplayState(CacheDefinitions.getComponentId(trip.layer), false);
    },
    [ROWING.arrive]: () => {
      out.sendInterfaceRemoval();
      finish();
      fade(player, false);
      messageBox(player, trip.arrive);
    },
    [ROWING.closeOverlay]: () => out.closeSubInterface(OVERLAY_ATMOSPHERE_UID),
  });
}

const STYLES = { ship_journey: shipJourney, longship, galleon, fade: fadeTrip, rowing };

/** Sends the player on a route by name; false if they're already travelling or it's unknown. */
function travel(player, routeName) {
  const trip = Common.route(routeName);
  if (!trip || !player || Common.travelling(player)) return false;
  STYLES[trip.style](player, trip);
  return true;
}

/** A logout or shutdown mid-trip: the player lands where the trip was going. */
function landNow({ player }) {
  Common.trips.get(player)?.land?.(true);
}

function landEveryone() {
  for (const [player, trip] of [...Common.trips]) trip.land?.(true);
}

module.exports = { travel, landNow, landEveryone, STYLES };
