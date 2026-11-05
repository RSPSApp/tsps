/**
 * Renu, the player's quetzal, as RSProx recordings 1695 (revision 226) and 237/1105 play her:
 *
 * - Each site's quetzal is a multi-NPC on its site's varbit (quetzal_fortis, quetzal_teomat ...):
 *   0 hidden (Fortis: no ops), 1 Renu wants feeding (Fortis only), then a colour of Renu with
 *   Travel / Last-destination. Twilight's Promise sets them through `quetzal:introduce` (Regulus
 *   hands over the feed) and `quetzal:unlock` (Renu is fed), and opens the map with
 *   `quetzal:open`.
 * - Travel opens the map (quetzal_menu) in the main modal; busy follows a tick later. Its icons
 *   (quetzal_menu:icons, 874:12 in rev 237 and the current cache) come back with the row's
 *   index as the sub. A site sets quetzal_last_destination to its id, closes the map, plays the
 *   flight sound and fades out; the minimap goes a tick later, the player lands four ticks after
 *   the click and the screen fades back in on the fifth (the overlay closed two ticks later).
 */
const Common = require("./Common.Quetzals");

const MENU = "quetzal_menu";
const FLIGHT_SOUND = 8501;
const FLIGHT_SOUND_LOOPS = 3;
const FLIGHT_SOUND_DELAY = 55;
const FADE_CYCLES = 50;
const MINIMAP_TICKS = 1;
const LAND_TICKS = 4;
const FADE_IN_TICKS = 5;
const CLOSE_OVERLAY_TICKS = 7;
const TWILIGHTS_PROMISE = "twilights_promise";
const FORTIS_SITE = 1;
/** The Fortis quetzal: 1 is Renu waiting for her feed, 2 the travelling Renu. */
const FORTIS_FEED = 1;
const FORTIS_TRAVEL = 2;

const flights = new WeakSet();

/** Regulus hands over the feed: the Fortis quetzal becomes Renu, waiting to be fed. */
function introduce({ player }) {
  const current = Common.varbit(player, Common.SITE_VARBITS[FORTIS_SITE]);
  if (current < FORTIS_FEED) Common.setVarbits(player, { [Common.SITE_VARBITS[FORTIS_SITE]]: FORTIS_FEED });
}

/** Renu is fed: her appearance, the sites that come with the system, and the Fortis Renu travels. */
function unlock({ player }) {
  const values = { [Common.BASE_APPEARANCE]: 1 };
  for (const site of Common.landingSites()) {
    const name = Common.SITE_VARBITS[site.id];
    if (!name || site.id === FORTIS_SITE) continue;
    if ((site.autoUnlocked || Common.siteBuilt(player, site)) && Common.varbit(player, name) === 0) values[name] = 1;
  }
  values[Common.SITE_VARBITS[FORTIS_SITE]] = FORTIS_TRAVEL;
  Common.setVarbits(player, values);
}

/** A finished Twilight's Promise means Renu is the player's, however the quest was finished. */
function unlockOnLogin({ player }) {
  if (!player || player.isPlayerBot?.() === true) return;
  if (!Common.renuUnlocked(player)) {
    if (Common.questComplete(player, TWILIGHTS_PROMISE)) unlock({ player });
    return;
  }
  const appearance = Common.varbit(player, Common.BASE_APPEARANCE);
  const values = {};
  for (const site of Common.landingSites()) {
    const name = Common.SITE_VARBITS[site.id];
    if (!site.autoUnlocked || site.id === FORTIS_SITE || !name || Common.varbit(player, name) !== 0) continue;
    values[name] = appearance;
  }
  if (Object.keys(values).length > 0) Common.setVarbits(player, values);
}

function openMap({ player }) {
  Common.openMenu(player, MENU);
  Common.later(player, 1, () => {
    if (player.getInterfaceId() === Common.menu(MENU).group) Common.busy(player, true);
  });
}

/** Renu flies to the sites the system has (client script 5015), once she is the player's. */
function canFly(player, site) {
  return Common.renuUnlocked(player) && Common.siteUsable(player, site);
}

/**
 * The captured flight: fade out on the click, land four ticks later, fade back in a tick after.
 * Primio's trips (Primio.Quetzals.js) fly the same way without a last destination, and the first
 * one carries on with Regulus on landing.
 */
function fly(player, site, { recordDestination = true, onLand } = {}) {
  if (flights.has(player)) return;
  flights.add(player);
  const sender = player.getPacketSender();
  if (recordDestination) Common.setVarbits(player, { [Common.LAST_DESTINATION]: site.id });
  Common.closeMenu(player);
  sender.sendSoundEffect(FLIGHT_SOUND, FLIGHT_SOUND_LOOPS, FLIGHT_SOUND_DELAY, 255);
  Common.fade(player, true, FADE_CYCLES);
  Common.timeline(player, {
    [MINIMAP_TICKS]: () => Common.minimap(player, true),
    [LAND_TICKS]: () => {
      player.moveTo(new Common.core.Location(site.x, site.y, site.z));
      onLand?.();
    },
    [FADE_IN_TICKS]: () => {
      Common.minimap(player, false);
      Common.busy(player, false);
      player.getMovementQueue().setBlockMovement(false);
      Common.fade(player, false, FADE_CYCLES);
    },
    [CLOSE_OVERLAY_TICKS]: () => sender.closeSubInterface(Common.OVERLAY_ATMOSPHERE_UID),
  }, {
    onCancel: () => {
      Common.minimap(player, false);
      Common.busy(player, false);
      sender.closeSubInterface(Common.OVERLAY_ATMOSPHERE_UID);
    },
    onEnd: () => flights.delete(player),
  });
}

function chooseSite(event) {
  const site = Common.clickedSite(event, MENU);
  if (site === undefined) return;
  if (!site || flights.has(event.player) || !canFly(event.player, site)) return;
  fly(event.player, site);
}

function travel({ player }) {
  openMap({ player });
  return true;
}

function travelToLastDestination({ player }) {
  const site = Common.siteById(Common.varbit(player, Common.LAST_DESTINATION));
  if (!site || !canFly(player, site)) {
    openMap({ player });
    return true;
  }
  fly(player, site);
  return true;
}

function mapClosed({ player, interfaceId }) {
  if (interfaceId !== Common.menu(MENU).group) return;
  player.setInterfaceId(-1);
  if (!flights.has(player)) Common.busy(player, false);
}

function attach(api) {
  api.onPlayerLogin(unlockOnLogin);
  api.onNpcInteraction("Renu", { Travel: travel, "Last-destination": travelToLastDestination });
  api.onInterfaceActionClick(chooseSite);
  api.onCustomEvent("interface:closed", mapClosed);
  api.onCustomEvent("quetzal:introduce", introduce);
  api.onCustomEvent("quetzal:unlock", unlock);
  api.onCustomEvent("quetzal:open", openMap);
}

module.exports = { attach, introduce, unlock, unlockOnLogin, openMap, chooseSite, fly, canFly, travelToLastDestination, flying: (player) => flights.has(player) };
