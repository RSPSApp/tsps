/**
 * Generic household chests: "Open" swaps a closed chest for its open loc, "Shut"/"Close" swaps
 * it back, and searching an open one finds nothing. Only the cache's generic chest family is
 * paired, by gameval name (chestclosed -> chestopen, chestclosed_khazard -> chestopen_khazard),
 * so a special chest (Barrows, raids, key chests, quests) never matches. Plugins with their own
 * "Chest" handlers load first. The Wiki quotes no chest messages; the search line follows the
 * crate one in ScenerySearch.
 */
const GENERIC_CLOSED = /^chestclosed(?:_|$)/;

let core;
let openByClosed = null;
let closedByOpen = null;

function buildPairs() {
  openByClosed = new Map();
  closedByOpen = new Map();
  for (const [id, name] of core.CacheDefinitions.getLocNames()) {
    if (!GENERIC_CLOSED.test(name)) continue;
    const openId = core.CacheDefinitions.getLocId(name.replace("chestclosed", "chestopen"));
    if (openId == null) continue;
    openByClosed.set(id, openId);
    if (!closedByOpen.has(openId)) closedByOpen.set(openId, id);
  }
}

function pairs() {
  if (!openByClosed) buildPairs();
  return { openByClosed, closedByOpen };
}

function swap(event, map) {
  const nextId = map.get(event.objectId);
  if (nextId == null) return false;
  const { object } = event;
  core.ObjectManager.deregister(object, true);
  core.ObjectManager.register(new core.GameObject(nextId, object.getLocation().clone(), object.getType(),
    object.getFace(), object.getPrivateArea?.() ?? null), true);
}

const openChest = (event) => swap(event, pairs().openByClosed);
const shutChest = (event) => swap(event, pairs().closedByOpen);

function searchChest(event) {
  if (!pairs().closedByOpen.has(event.objectId)) return false;
  event.player.sendMessage("You search the chest, but find nothing of interest.");
}

module.exports = {
  name: "Chests",
  dependsOn: ["Quests", "KeyChests", "Clans", "TheatreOfBlood", "RandomEvents", "GiantLairs"],
  register(api) {
    core = api.core;
    api.onObjectInteraction("Closed chest", { Open: openChest });
    api.onObjectInteraction("Chest", { Open: openChest, Search: searchChest, Shut: shutChest, Close: shutChest });
    api.onObjectInteraction("Open chest", { Search: searchChest, Shut: shutChest, Close: shutChest });
  },
};
