/**
 * The Quetzal Transport System (https://oldschool.runescape.wiki/w/Quetzal_Transport_System), as
 * RSProx recording 1695 plays it (Twilight's Promise and The Heart of Darkness, revision 226):
 *
 * - The landing sites are the cache's quetzal table (dbtable 64): an id, a name and a landing
 *   coord per row, in the order the map (interface 874) lists them; its button 874:15 comes
 *   back with the row's index as the sub.
 * - Each site's quetzal is a multi-NPC on its site's varbit (quetzal_fortis, quetzal_teomat ...):
 *   0 hidden (Fortis: no ops), 1 Renu wants feeding (Fortis only), then a colour of Renu with
 *   Travel / Last-destination. Twilight's Promise sets them through `quetzal:introduce` (Regulus
 *   hands over the feed) and `quetzal:unlock` (Renu is fed), and opens the map with
 *   `quetzal:open`.
 * - Travel opens the map in the main modal (script 2524, sound 8413). A site sets
 *   quetzal_last_destination to its id, closes the map, plays the flight sound and fades out;
 *   the minimap goes a tick later, the player lands four ticks after the click and the screen
 *   fades back in on the fifth (the overlay closed two ticks later).
 *
 * The quetzal varps are saved as one snapshot and sent again on login.
 *
 * Not modelled: building landing sites (Hunter level and materials), Renu's appearance and the
 * whistle; only the sites the table marks auto-unlocked open with the system.
 */
const INTERFACE = 874;
const SITES_BUTTON = 15;
const SITE_TABLE = 64;
const MAIN_MODAL = (161 << 16) | 16;
const OVERLAY_ATMOSPHERE_UID = (161 << 16) | 1;
const FADE_OVERLAY = 174;
const FADE_SCRIPT = 948;
const FADE_CYCLES = 50;
const SCRIPT_MAINMODAL_OPEN = 2524;
const OPEN_SOUND = 8413;
const FLIGHT_SOUND = 8501;
const FLIGHT_SOUND_LOOPS = 3;
const FLIGHT_SOUND_DELAY = 55;
const MINIMAP_STATE_VARBIT = 6719;
const MINIMAP_OFF = 2;
const MINIMAP_TICKS = 1;
const LAND_TICKS = 4;
const FADE_IN_TICKS = 5;
const CLOSE_OVERLAY_TICKS = 7;
/** Interface event flags: op1 on every site slot. */
const OP1_FLAGS = 1 << 1;

const VARPS_ATTRIBUTE = "quetzals:varps";
const PERSISTED_VARPS = ["quetzals_1", "quetzals_2", "quetzals_3"];
const BASE_APPEARANCE = "quetzal_base_appearance";
const LAST_DESTINATION = "quetzal_last_destination";
const VARLAMORE_VISITED = "varlamore_visited";
const FIRST_TRIP_STATE = "vmq2_first_travel";
const CHILDREN_OF_THE_SUN = "children_of_the_sun";
const FIRST_TRIP_VARIANT = "talking-in-varrock-talking-to-take-the-first-trip";
const REPEAT_FIRST_TRIP_VARIANT = "talking-in-varrock-talking-again-before-taking-the-first-trip";
const REGULUS_VARROCK_ID = 12884;
const REGULUS_FORTIS_ID = 12885;
const PRIMIO_VARROCK_ID = 12888;
const PRIMIO_FORTIS_ID = 12889;
const VARROCK_LANDING = { id: 0, x: 3281, y: 3413, z: 0 };
/** Each site's varbit, by the table's site id. */
const SITE_VARBITS = {
  1: "quetzal_fortis",
  2: "quetzal_teomat",
  3: "quetzal_sunsetcoast",
  4: "quetzal_hunterguild",
  5: "quetzal_camtorum",
  6: "quetzal_colossalwyrm",
  7: "quetzal_outerfortis",
  8: "quetzal_colosseum",
  9: "quetzal_aldarin",
  10: "quetzal_quetzacalligorge",
  11: "quetzal_salvageroverlook",
  12: "quetzal_talteklan",
  13: "quetzal_auburnvalley",
  14: "quetzal_kastori",
};
const FORTIS_SITE = 1;
/** The Fortis quetzal: 1 is Renu waiting for her feed, 2 the travelling Renu. */
const FORTIS_FEED = 1;
const FORTIS_TRAVEL = 2;

let core = null;
let pluginApi = null;
let sites = null;
const flights = new WeakSet();

function varbitId(name) {
  return core.CacheDefinitions.getVarbitId(name);
}

/** The table's landing sites in row order: { id, name, x, y, z, autoUnlocked }. */
function landingSites() {
  if (sites) return sites;
  const { CacheDefinitions } = core;
  const column = (name, fallback) => CacheDefinitions.getDbColumn(SITE_TABLE, name) ?? fallback;
  const [idColumn, nameColumn, coordColumn, autoColumn] = [column("id", 0), column("name", 1), column("coord", 2), column("auto_unlocked", 6)];
  sites = CacheDefinitions.getDbTableRows(SITE_TABLE).map((row) => {
    const coord = Number(row.columns.get(coordColumn)?.[0]) | 0;
    return {
      id: Number(row.columns.get(idColumn)?.[0]),
      name: String(row.columns.get(nameColumn)?.[0] ?? ""),
      x: (coord >>> 14) & 0x3fff,
      y: coord & 0x3fff,
      z: (coord >>> 28) & 0x3,
      autoUnlocked: Number(row.columns.get(autoColumn)?.[0]) === 1,
    };
  });
  return sites;
}

function save(player) {
  const sender = player.getPacketSender();
  const snapshot = {};
  for (const name of PERSISTED_VARPS) {
    const id = core.CacheDefinitions.getVarpId(name);
    const value = id == null ? 0 : sender.getVarp(id);
    if (value !== 0) snapshot[id] = value;
  }
  player.setAttribute(VARPS_ATTRIBUTE, Object.keys(snapshot).length ? snapshot : null);
}

function setVarbits(player, values) {
  const sender = player.getPacketSender();
  for (const [name, value] of Object.entries(values)) {
    const id = varbitId(name);
    if (id != null) sender.sendVarbit(id, value);
  }
  save(player);
}

function restore({ player }) {
  if (!player || player.isPlayerBot?.() === true) return;
  const snapshot = player.getAttribute(VARPS_ATTRIBUTE);
  if (!snapshot || typeof snapshot !== "object") return;
  const sender = player.getPacketSender();
  for (const [id, value] of Object.entries(snapshot)) {
    if (Number.isInteger(value)) sender.sendConfig(Number(id), value);
  }
}

/** Regulus hands over the feed: the Fortis quetzal becomes Renu, waiting to be fed. */
function introduce({ player }) {
  const current = player.getPacketSender().getVarbit(varbitId(SITE_VARBITS[FORTIS_SITE]));
  if (current < FORTIS_FEED) setVarbits(player, { [SITE_VARBITS[FORTIS_SITE]]: FORTIS_FEED });
}

/** Renu is fed: her appearance, the sites that come with the system, and the Fortis Renu travels. */
function unlock({ player }) {
  const values = { [BASE_APPEARANCE]: 1 };
  for (const site of landingSites()) {
    const name = SITE_VARBITS[site.id];
    if (!site.autoUnlocked || !name || site.id === FORTIS_SITE) continue;
    if (player.getPacketSender().getVarbit(varbitId(name)) === 0) values[name] = 1;
  }
  values[SITE_VARBITS[FORTIS_SITE]] = FORTIS_TRAVEL;
  setVarbits(player, values);
}

function openMap({ player }) {
  const sender = player.getPacketSender();
  sender.sendInterfaceScript(SCRIPT_MAINMODAL_OPEN, [-1, -1]);
  player.setInterfaceId(INTERFACE);
  sender.sendSubInterface(MAIN_MODAL, INTERFACE, 0);
  sender.sendSound(OPEN_SOUND, 1, 0);
  sender.sendInterfaceFlagsRange((INTERFACE << 16) | SITES_BUTTON, 0, landingSites().length - 1, OP1_FLAGS);
}

function fade(player, out) {
  const args = out ? [0, 255, 0, 0, FADE_CYCLES] : [0, 0, 0, 255, FADE_CYCLES];
  player.getPacketSender().sendSubInterface(OVERLAY_ATMOSPHERE_UID, FADE_OVERLAY, 1, { postScripts: [{ scriptId: FADE_SCRIPT, args }] });
}

/** The captured flight: fade out on the click, land four ticks later, fade back in a tick after. */
function fly(player, site, { recordDestination = true, onLand } = {}) {
  if (flights.has(player)) return;
  flights.add(player);
  const { Task, TaskManager, Location } = core;
  const sender = player.getPacketSender();
  if (recordDestination) setVarbits(player, { [LAST_DESTINATION]: site.id });
  sender.closeSubInterface(MAIN_MODAL);
  player.setInterfaceId(-1);
  sender.sendSoundEffect(FLIGHT_SOUND, FLIGHT_SOUND_LOOPS, FLIGHT_SOUND_DELAY, 255);
  fade(player, true);
  const movement = player.getMovementQueue();
  movement.setBlockMovement(true).reset();
  let tick = 0;
  TaskManager.submit(new (class extends Task {
    constructor() { super(1, player, false); }
    execute() {
      tick++;
      if (!player.isRegistered()) {
        this.stop();
        return;
      }
      if (tick === MINIMAP_TICKS) sender.sendVarbit(MINIMAP_STATE_VARBIT, MINIMAP_OFF);
      if (tick === LAND_TICKS) {
        player.moveTo(new Location(site.x, site.y, site.z));
        onLand?.();
      }
      if (tick === FADE_IN_TICKS) {
        movement.setBlockMovement(false);
        sender.sendVarbit(MINIMAP_STATE_VARBIT, 0);
        fade(player, false);
      }
      if (tick >= CLOSE_OVERLAY_TICKS) {
        sender.closeSubInterface(OVERLAY_ATMOSPHERE_UID);
        this.stop();
      }
    }
    stop() {
      flights.delete(player);
      movement.setBlockMovement(false);
      super.stop();
    }
  })());
}

function childrenOfTheSunComplete(player) {
  const request = { player, key: CHILDREN_OF_THE_SUN, complete: false };
  pluginApi?.emitCustomEvent?.("quest:is-complete", request);
  return request.complete === true;
}

function startFirstTripMenu(player, firstTime) {
  const varbit = varbitId(FIRST_TRIP_STATE);
  const current = player.getPacketSender().getVarbit(varbit);
  if (current < 2) setVarbits(player, { [FIRST_TRIP_STATE]: 2 });
  pluginApi?.emitCustomEvent?.("npc-dialogue:start", {
    player,
    npcId: REGULUS_VARROCK_ID,
    variant: firstTime ? FIRST_TRIP_VARIANT : REPEAT_FIRST_TRIP_VARIANT,
  });
}

function firstTripArrivalTail(steps) {
  for (const step of steps ?? []) {
    if (step.type !== "choice") continue;
    for (const option of step.options ?? []) {
      const actionIndex = option.steps?.findIndex((entry) => entry.type === "action" && entry.id === "Kectpl") ?? -1;
      if (actionIndex >= 0) return option.steps.slice(actionIndex + 1);
    }
  }
  return [];
}

function startFirstTripArrival(player) {
  pluginApi?.emitCustomEvent?.("npc-dialogue:start", {
    player,
    npcId: REGULUS_FORTIS_ID,
    variant: FIRST_TRIP_VARIANT,
    select: firstTripArrivalTail,
  });
}

function arriveInFortis(player) {
  setVarbits(player, { [VARLAMORE_VISITED]: 1, [FIRST_TRIP_STATE]: 3 });
  startFirstTripArrival(player);
}

function destinationForNpc(npcId) {
  if (npcId === PRIMIO_VARROCK_ID || npcId === REGULUS_VARROCK_ID) {
    const fortis = landingSites().find((site) => site.id === FORTIS_SITE);
    return fortis ? { site: fortis, firstTrip: true } : null;
  }
  if (npcId === PRIMIO_FORTIS_ID || npcId === REGULUS_FORTIS_ID) {
    return { site: VARROCK_LANDING, firstTrip: false };
  }
  return null;
}

function travelWithPrimio(event) {
  const { player, npcId } = event;
  const destination = destinationForNpc(npcId);
  if (!destination) return false;
  event.handled = true;
  if (!childrenOfTheSunComplete(player)) {
    player.sendMessage("You need to complete Children of the Sun before travelling to Varlamore.");
    return true;
  }

  const firstTripState = player.getPacketSender().getVarbit(varbitId(FIRST_TRIP_STATE));
  const firstTime = destination.firstTrip
    && player.getPacketSender().getVarbit(varbitId(VARLAMORE_VISITED)) === 0;
  if (firstTime && firstTripState < 3) {
    startFirstTripMenu(player, firstTripState < 2);
    return true;
  }
  fly(player, destination.site, {
    recordDestination: false,
    onLand: firstTime ? () => arriveInFortis(player) : undefined,
  });
  return true;
}

function handleFirstTripAction(event) {
  if (event.stepId !== "Kectpl" || event.npcId !== REGULUS_VARROCK_ID) return;
  event.handled = true;
  event.end = true;
  const fortis = landingSites().find((site) => site.id === FORTIS_SITE);
  if (!fortis) return;
  fly(event.player, fortis, { recordDestination: false, onLand: () => arriveInFortis(event.player) });
}

function finishFirstTripDialogue(event) {
  if (event.npcId !== REGULUS_FORTIS_ID
    || !String(event.text).endsWith("Why don't you head on over and introduce yourself?")) return;
  event.after = () => setVarbits(event.player, { [FIRST_TRIP_STATE]: 4 });
}

function siteUnlocked(player, site) {
  const name = SITE_VARBITS[site.id];
  return !!name && player.getPacketSender().getVarbit(varbitId(name)) > 0;
}

function chooseSite(event) {
  const buttonId = Number(event.buttonId ?? 0);
  if ((event.groupId ?? (buttonId >>> 16)) !== INTERFACE) return;
  if ((event.childId ?? (buttonId & 0xffff)) !== SITES_BUTTON) return;
  const site = landingSites()[event.slot ?? -1];
  event.handled = true;
  if (event.player.getInterfaceId() !== INTERFACE || flights.has(event.player)) return;
  if (!site || !siteUnlocked(event.player, site)) return;
  fly(event.player, site);
}

function travel({ player }) {
  openMap({ player });
  return true;
}

function travelToLastDestination({ player }) {
  const last = player.getPacketSender().getVarbit(varbitId(LAST_DESTINATION));
  const site = landingSites().find((entry) => entry.id === last);
  if (!site || !siteUnlocked(player, site)) {
    openMap({ player });
    return true;
  }
  fly(player, site);
  return true;
}

function mapClosed({ player, interfaceId }) {
  if (interfaceId === INTERFACE) player.setInterfaceId(-1);
}

module.exports = {
  name: "Quetzals",
  members: true,
  _test: { landingSites, introduce, unlock, chooseSite, VARPS_ATTRIBUTE },
  register(api) {
    pluginApi = api;
    core = api.core;
    api.persistAttribute(VARPS_ATTRIBUTE, null);
    api.onPlayerLogin(restore);
    api.onNpcInteraction("Renu", { Travel: travel, "Last-destination": travelToLastDestination });
    api.onNpcInteraction("Primio", { Travel: travelWithPrimio });
    api.onNpcInteraction("Regulus Cento", { Travel: travelWithPrimio });
    api.onCustomEvent("npc-dialogue:action", handleFirstTripAction);
    api.onCustomEvent("npc-dialogue:line", finishFirstTripDialogue);
    api.onInterfaceActionClick(chooseSite);
    api.onCustomEvent("interface:closed", mapClosed);
    api.onCustomEvent("quetzal:introduce", introduce);
    api.onCustomEvent("quetzal:unlock", unlock);
    api.onCustomEvent("quetzal:open", openMap);
  },
};
