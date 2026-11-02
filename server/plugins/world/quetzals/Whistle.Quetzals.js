/**
 * Quetzal whistles (Wiki: Basic/Enhanced/Perfected quetzal whistle and their blueprints), as
 * RSProx recording 237/4002 plays them:
 *
 * - Signal opens the whistle's own map (quetzalwhistle_menu) the way Renu's opens, with busy set
 *   at once. With the Gameplay setting settings_quetzalwhistle_default_tp on, it flies straight
 *   to the Hunter Guild. Last-destination flies to quetzal_last_destination.
 * - A site plays the whistle animation and its spotanim and closes the map; seven ticks later
 *   the minimap goes and the screen fades out fast, the player lands on the eighth, and on the
 *   ninth the charge is told, quetzal_last_destination set, busy cleared and the screen fades back
 *   in (the overlay closed two ticks later).
 * - The whistle reaches every site the system has (client script 5015) without Renu, and works
 *   up to level 20 Wilderness. A whistle holds 5 / 20 / 50 charges by tier, the (i) unlimited;
 *   charges are kept per tier. Soar Leader Pitri recharges them (Pitri.Quetzals.js).
 * - Craft on a blueprint makes a whistle from a knife and one set of logs; the enhanced and
 *   perfected blueprints upgrade the whistle before them, keeping its charges.
 */
const Common = require("./Common.Quetzals");

const MENU = "quetzalwhistle_menu";
const CHARGES_ATTRIBUTE = "quetzals:whistle-charges";
const DEFAULT_TP_VARBIT = "settings_quetzalwhistle_default_tp";
const WHISTLE_SEQ = "human_quetzal_whistle";
const WHISTLE_SPOTANIM = "spotanim_whistle_quetzal_backpack01";
const HUNTER_GUILD_SITE = 4;
const WILDERNESS_LIMIT = 20;
const FADE_OUT_TICKS = 7;
const LAND_TICKS = 8;
const ARRIVE_TICKS = 9;
const CLOSE_OVERLAY_TICKS = 11;
const FADE_OUT_CYCLES = 15;
const FADE_IN_CYCLES = 50;

const flights = new WeakSet();
/** The whistle each player is choosing a site for. */
const signalling = new WeakMap();

/** The whistle tiers by item id: { id, obj, tier, charges }. */
function whistles() {
  return Common.data.whistles.map((entry) => ({ ...entry, id: Common.obj(entry.obj) }));
}

function whistleOf(itemId) {
  return whistles().find((entry) => entry.id === itemId) ?? null;
}

function chargesOf(player, whistle) {
  if (whistle.charges == null) return Infinity;
  const charges = Number(player.getAttribute(CHARGES_ATTRIBUTE)?.[whistle.tier] ?? 0);
  return Number.isFinite(charges) ? charges : 0;
}

function setCharges(player, whistle, charges) {
  if (whistle.charges == null) return;
  const stored = { ...(player.getAttribute(CHARGES_ATTRIBUTE) ?? {}) };
  stored[whistle.tier] = Number.isFinite(charges) ? Math.max(0, Math.min(whistle.charges, charges)) : 0;
  player.setAttribute(CHARGES_ATTRIBUTE, stored);
}

function tellCharges(player, whistle) {
  player.sendMessage(Common.message("charges", { charges: chargesOf(player, whistle) }));
}

/** Wiki: not above level 20 Wilderness, with the whistle's own two lines. */
function tooDeep(player) {
  if (Number(player.getWildernessLevel?.() ?? 0) <= WILDERNESS_LIMIT) return false;
  player.sendMessage(Common.message("wildernessFar"));
  player.sendMessage(Common.message("wildernessLevel"));
  return true;
}

/** The Wilderness limit, then the usual teleport rules (busy, teleblock). */
function mayTeleport(player, site) {
  if (tooDeep(player)) return false;
  return Common.core.TeleportHandler.checkReqs(player, new Common.core.Location(site.x, site.y, site.z), WILDERNESS_LIMIT);
}

function charged(player, whistle) {
  if (chargesOf(player, whistle) > 0) return true;
  tellCharges(player, whistle);
  return false;
}

function signal(event) {
  const { player } = event;
  const whistle = whistleOf(event.itemId);
  if (!whistle || flights.has(player) || tooDeep(player) || !charged(player, whistle)) return true;
  if (Common.varbit(player, DEFAULT_TP_VARBIT) === 1) {
    const guild = Common.siteById(HUNTER_GUILD_SITE);
    if (guild && mayTeleport(player, guild)) fly(player, whistle, guild);
    return true;
  }
  signalling.set(player, whistle);
  Common.busy(player, true);
  Common.openMenu(player, MENU);
  return true;
}

function check(event) {
  const whistle = whistleOf(event.itemId);
  if (whistle) tellCharges(event.player, whistle);
  return true;
}

function lastDestination(event) {
  const { player } = event;
  const whistle = whistleOf(event.itemId);
  if (!whistle || flights.has(player) || !charged(player, whistle)) return true;
  const site = Common.siteById(Common.varbit(player, Common.LAST_DESTINATION));
  if (!Common.siteUsable(player, site)) return signal(event);
  if (mayTeleport(player, site)) fly(player, whistle, site);
  return true;
}

function chooseSite(event) {
  const site = Common.clickedSite(event, MENU);
  if (site === undefined) return;
  const { player } = event;
  const whistle = signalling.get(player);
  if (!site || !whistle || flights.has(player) || !Common.siteUsable(player, site)) return;
  if (!player.getInventory().contains(whistle.id) || !charged(player, whistle)) return;
  Common.closeMenu(player);
  if (!mayTeleport(player, site)) {
    Common.busy(player, false);
    return;
  }
  fly(player, whistle, site);
}

/** The captured whistle flight; the charge goes as the player lands. */
function fly(player, whistle, site) {
  if (flights.has(player)) return;
  flights.add(player);
  signalling.delete(player);
  const { core } = Common;
  const sender = player.getPacketSender();
  if (player.getInterfaceId() === Common.menu(MENU).group) Common.closeMenu(player);
  Common.busy(player, true);
  const seq = core.CacheDefinitions.getSeqId(WHISTLE_SEQ);
  const spotanim = core.CacheDefinitions.getSpotanimId(WHISTLE_SPOTANIM);
  if (seq != null) player.performAnimation(new core.Animation(seq));
  if (spotanim != null) player.performGraphic(new core.Graphic(spotanim));
  let faded = false;
  Common.timeline(player, {
    [FADE_OUT_TICKS]: () => {
      faded = true;
      Common.minimap(player, true);
      Common.fade(player, true, FADE_OUT_CYCLES);
    },
    [LAND_TICKS]: () => {
      Common.minimap(player, false);
      // Content may keep the charge ("quetzals:whistle-charge" { player, itemId, kept }, a league relic).
      const charge = { player, itemId: whistle.id, kept: false };
      Common.api?.emitCustomEvent("quetzals:whistle-charge", charge);
      if (!charge.kept) setCharges(player, whistle, chargesOf(player, whistle) - 1);
      player.moveTo(new core.Location(site.x, site.y, site.z));
    },
    [ARRIVE_TICKS]: () => {
      if (whistle.charges != null) tellCharges(player, whistle);
      Common.setVarbits(player, { [Common.LAST_DESTINATION]: site.id });
      Common.busy(player, false);
      player.getMovementQueue().setBlockMovement(false);
      Common.fade(player, false, FADE_IN_CYCLES);
    },
    [CLOSE_OVERLAY_TICKS]: () => sender.closeSubInterface(Common.OVERLAY_ATMOSPHERE_UID),
  }, {
    // Ended before landing (a death, another move): no charge goes, and the flight lets go.
    onCancel: () => {
      Common.busy(player, false);
      if (!faded) return;
      Common.minimap(player, false);
      sender.closeSubInterface(Common.OVERLAY_ATMOSPHERE_UID);
    },
    onEnd: () => flights.delete(player),
  });
}

function menuClosed({ player, interfaceId }) {
  if (interfaceId !== Common.menu(MENU).group) return;
  player.setInterfaceId(-1);
  signalling.delete(player);
  if (!flights.has(player)) Common.busy(player, false);
}

/** The blueprints by item id, with their logs, the whistle they upgrade and the one they make. */
function blueprintOf(itemId) {
  const entry = Common.data.blueprints.find((blueprint) => Common.obj(blueprint.obj) === itemId);
  return entry ? { ...entry, id: itemId } : null;
}

function checkBlueprint(event) {
  const blueprint = blueprintOf(event.itemId);
  if (blueprint) event.player.sendMessage(blueprint.check);
  return true;
}

function article(name) {
  return /^[aeiou]/i.test(name) ? "an" : "a";
}

function craft(event) {
  const { player } = event;
  const blueprint = blueprintOf(event.itemId);
  if (!blueprint) return true;
  const inventory = player.getInventory();
  const [knife, logs] = [Common.obj("knife"), Common.obj(blueprint.logs)];
  if (!inventory.contains(knife) || !inventory.contains(logs)) {
    player.sendMessage(blueprint.check);
    return true;
  }
  const from = blueprint.from ? whistleOf(Common.obj(blueprint.from)) : null;
  if (from && !inventory.contains(from.id)) {
    const name = Common.core.CacheDefinitions.getItem(from.id)?.name?.toLowerCase() ?? "quetzal whistle";
    player.sendMessage(Common.message("needsWhistle", { article: article(name), whistle: name }));
    return true;
  }
  const made = whistleOf(Common.obj(blueprint.makes));
  const charges = from ? chargesOf(player, from) : 0;
  inventory.delete(blueprint.id, 1);
  inventory.delete(logs, 1);
  if (from) {
    inventory.delete(from.id, 1);
    setCharges(player, from, 0);
  }
  inventory.add(new Common.core.Item(made.id, 1), true);
  inventory.refreshItems?.();
  setCharges(player, made, charges);
  player.sendMessage(blueprint.made);
  return true;
}

function attach(api) {
  api.persistAttribute(CHARGES_ATTRIBUTE, null);
  for (const { name } of Common.data.whistles) api.onItemAction(name, { Signal: signal, Check: check, "Last-destination": lastDestination });
  for (const { name } of Common.data.blueprints) api.onItemAction(name, { Check: checkBlueprint, Craft: craft });
  api.onInterfaceActionClick(chooseSite);
  api.onCustomEvent("interface:closed", menuClosed);
}

module.exports = {
  attach, signal, check, lastDestination, chooseSite, craft, checkBlueprint, fly,
  whistles, whistleOf, chargesOf, setCharges, CHARGES_ATTRIBUTE,
};
