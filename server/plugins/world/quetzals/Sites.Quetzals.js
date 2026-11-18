/**
 * Building the six landing sites that don't come with the system (Wiki: Landing_Site,
 * Transcript:Landing_Site). Each is a multi-loc on its site's varbit (quetzal_landing_site_camtorum
 * on quetzal_camtorum ...): 0 is the "Unbuilt Landing Site" with Build, built is the
 * "Landing Site". Build takes 10 quetzal feed, 3 limestone bricks and 4 soft clay, unnoted, and
 * six ticks; it needs Twilight's Promise. A built site sets its bit in quetzals_unlocked, which
 * is what the maps' client script 5015 reads, and its varbit to Renu's appearance as the
 * others show it (rsprox 223/3, a login with the Cam Torum site built).
 *
 * Without the materials: the mesbox rsprox 238/1205 captured. Before the quest, and once built:
 * the transcript's lines.
 */
const Common = require("./Common.Quetzals");

const LOC_PREFIX = "quetzal_landing_site_";
const VARBIT_PREFIX = "quetzal_";
const TWILIGHTS_PROMISE = "twilights_promise";
/** How far from a site's landing tile its landing-site loc may stand. */
const SITE_RADIUS = 16;

const building = new WeakSet();

function siteForVarbit(name) {
  const entry = Object.entries(Common.SITE_VARBITS).find(([, varbit]) => varbit === name);
  return entry ? Common.siteById(Number(entry[0])) : null;
}

/** The site of a clicked landing-site loc: by its multi-loc's name, else the nearest site. */
function siteOf(event) {
  const id = event.object?.getId?.() ?? event.objectId;
  const name = Common.core.CacheDefinitions.getLocNames().get(id) ?? "";
  if (name.startsWith(LOC_PREFIX)) {
    const site = siteForVarbit(VARBIT_PREFIX + name.slice(LOC_PREFIX.length));
    if (site) return site;
  }
  const { x, y } = event.location ?? {};
  return Common.landingSites()
    .filter((site) => !site.autoUnlocked)
    .map((site) => ({ site, distance: Math.max(Math.abs(site.x - x), Math.abs(site.y - y)) }))
    .filter((entry) => entry.distance <= SITE_RADIUS)
    .sort((a, b) => a.distance - b.distance)[0]?.site ?? null;
}

function materials() {
  return Object.entries(Common.data.landingSite.materials).map(([name, amount]) => ({ id: Common.obj(name), amount }));
}

function hasMaterials(player) {
  const inventory = player.getInventory();
  return materials().every(({ id, amount }) => inventory.getAmount(id) >= amount);
}

/** The value the site varbits show: Renu's appearance (1 until Regulus changes it). */
function appearance(player) {
  return Math.max(1, Common.varbit(player, Common.BASE_APPEARANCE));
}

function build(event) {
  const { player } = event;
  const site = siteOf(event);
  if (!site || site.autoUnlocked || building.has(player)) return true;
  if (!Common.questComplete(player, TWILIGHTS_PROMISE)) {
    Common.box(player, Common.message("buildNotReady"));
    return true;
  }
  if (Common.siteBuilt(player, site)) return true;
  if (!hasMaterials(player)) {
    Common.box(player, Common.message("buildNeeds"));
    return true;
  }
  building.add(player);
  Common.timeline(player, {
    [Common.data.landingSite.ticks]: () => finish(player, site),
  }, { onEnd: () => building.delete(player) });
  return true;
}

function finish(player, site) {
  if (Common.siteBuilt(player, site) || !hasMaterials(player)) return;
  const inventory = player.getInventory();
  for (const { id, amount } of materials()) inventory.delete(id, amount);
  inventory.refreshItems?.();
  Common.markBuilt(player, site);
  // `quetzals:site-built` { player, site, all }: all is every site that has to be built now built ("Build all").
  const all = Common.landingSites().filter((each) => !each.autoUnlocked && Common.SITE_VARBITS[each.id]).every((each) => Common.siteBuilt(player, each));
  Common.api.emitCustomEvent("quetzals:site-built", { player, site: site.name, all });
  const varbit = Common.SITE_VARBITS[site.id];
  if (varbit) Common.setVarbits(player, { [varbit]: appearance(player) });
  Common.box(player, Common.message("built"));
}

function attach(api) {
  api.onObjectInteraction("Unbuilt Landing Site", { Build: build });
}

module.exports = { attach, build, siteOf, hasMaterials };
