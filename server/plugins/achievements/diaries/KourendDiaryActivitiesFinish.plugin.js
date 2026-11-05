"use strict";

/**
 * Kourend & Kebos diary, activities-finish batch: credits only the five tasks whose ordinary
 * gameplay is owned by this group, from the success events their real handlers emit.
 *
 *   hand-in-a-book-at-the-arceuus-library        ArceuusLibrary (requested book accepted)
 *   repair-a-piscarilius-crane                   FishingCrane (successful repair)
 *   deliver-some-intelligence-to-captain-ginea   IntelligenceGathering (hand-in)
 *   catch-a-bluegill-on-molch-island             Aerial.Hunter's fishing:success
 *   deliver-an-artefact-to-captain-khaled        StealingArtefacts hand-in
 *
 * Every event carries the actor and the qualifier that made the action succeed; this consumer
 * re-checks the player state and the location/NPC/object so a matching action elsewhere cannot
 * credit. It leaves the other Kourend tasks to the dedicated consumers.
 */

const DIARY = "kourend";

const TASKS = {
  libraryBook: "hand-in-a-book-at-the-arceuus-library",
  crane: "repair-a-piscarilius-crane",
  intelligence: "deliver-some-intelligence-to-captain-ginea",
  bluegill: "catch-a-bluegill-on-molch-island",
  artefact: "deliver-an-artefact-to-captain-khaled",
};

/** Molch Island's aerial-fishing shoreline (the same bounds Aerial.Hunter uses to end a trip). */
const MOLCH_ISLAND = { minX: 1350, maxX: 1400, minY: 3600, maxY: 3650, z: 0 };
const GINEA = 6895;
const BROKEN_FISHING_CRANE = 27555;
/** Sam, Professor Gracklebone and Villia: the Arceuus Library customers. */
const LIBRARY_CUSTOMERS = new Set([7049, 7048, 7047]);

let api;
let core;

function point(location) {
  if (!location) return null;
  const get = (method, prop) => typeof location[method] === "function" ? location[method]() : location[prop];
  const x = get("getX", "x");
  const y = get("getY", "y");
  const z = get("getZ", "z");
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y, z: Number.isFinite(z) ? z : 0 } : null;
}

function inside(location, area) {
  const at = point(location);
  return !!at && at.z === area.z && at.x >= area.minX && at.x <= area.maxX
    && at.y >= area.minY && at.y <= area.maxY;
}

function eligible(player) {
  return player?.isRegistered?.() === true && player.getHitpoints?.() > 0
    && !player.isDyingReturn?.() && player.getPrivateArea?.() == null;
}

function complete(player, task) {
  if (!eligible(player)) return false;
  api.emitCustomEvent("diary:task", { player, diary: DIARY, task });
  return true;
}

function fished({ player, itemId } = {}) {
  if (itemId !== core.ItemIdentifiers.BLUEGILL || !inside(player?.getLocation?.(), MOLCH_ISLAND)) return;
  complete(player, TASKS.bluegill);
}

function craneRepaired({ player, objectId } = {}) {
  if (objectId !== BROKEN_FISHING_CRANE) return;
  complete(player, TASKS.crane);
}

function intelligenceDelivered({ player, npcId, count } = {}) {
  if (npcId !== GINEA || !Number.isInteger(count) || count <= 0) return;
  complete(player, TASKS.intelligence);
}

function artefactDelivered({ player } = {}) {
  complete(player, TASKS.artefact);
}

function bookHandedIn({ player, npcId } = {}) {
  if (!LIBRARY_CUSTOMERS.has(npcId)) return;
  complete(player, TASKS.libraryBook);
}

module.exports = {
  name: "KourendDiaryActivitiesFinish",
  members: true,
  dependsOn: ["AchievementDiaries"],
  register(pluginApi) {
    api = pluginApi;
    core = pluginApi.core;
    pluginApi.onCustomEvent("fishing:success", fished);
    pluginApi.onCustomEvent("piscarilius-crane:repaired", craneRepaired);
    pluginApi.onCustomEvent("intelligence-gathering:delivered", intelligenceDelivered);
    pluginApi.onCustomEvent("stealing-artefacts:handed-in", artefactDelivered);
    pluginApi.onCustomEvent("arceuus-library:book-handed-in", bookHandedIn);
  },
  _test: {
    DIARY, TASKS, MOLCH_ISLAND, GINEA, BROKEN_FISHING_CRANE, LIBRARY_CUSTOMERS,
    inside, eligible, fished, craneRepaired, intelligenceDelivered, artefactDelivered, bookHandedIn,
  },
};
