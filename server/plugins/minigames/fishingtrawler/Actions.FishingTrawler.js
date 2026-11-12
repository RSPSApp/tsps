"use strict";

/**
 * What the crew does at sea (Wiki: Fishing Trawler; points from its contribution table):
 * - Fill a leak with swamp paste (5);
 * - Bail-with a bailing bucket on the lower deck (2), then Empty it;
 * - use rope on the trawler net when it is ripped (7, 5 Crafting XP), more often successful with
 *   a higher Crafting level;
 * - Chop an attacking tentacle with an axe (10 and 5 Woodcutting XP a hit), surer with a better
 *   axe and Woodcutting level;
 * - Fix a broken rail with a hammer (10);
 * - Take buckets, hammers and axes from the crates on the deck.
 * Each only counts on the trawler during a trip.
 */

const Shared = require("./Shared.FishingTrawler");
const Sea = require("./Sea.FishingTrawler");

let hullSpots = null;
let rails = null;
let tentacleIds = null;
/** The tentacles rise beyond the rails: chopped from the deck, within this range. */
const TENTACLE_REACH = 3;

/** The 16 hull spots and the two rails by their parent loc ids. */
function resolveSpots() {
  const cache = Shared.core().CacheDefinitions;
  hullSpots = new Map();
  for (let i = 0; i < 16; i++) hullSpots.set(cache.getLocId(`trawler_hull_${String(i).padStart(2, "0")}`), i);
  tentacleIds = new Set(["trawler_tentacle", "trawler_tentacle_op", "trawler_tentacle_port", "trawler_tentacle_starboard"].map((name) => cache.getNpcId(name)));
  rails = new Map([
    [cache.getLocId("shiprail_port"), "port"],
    [cache.getLocId("shiprail_port_floor"), "port"],
    [cache.getLocId("shiprail_starboard"), "starboard"],
    [cache.getLocId("shiprail_starboard_floor"), "starboard"],
  ]);
}

function voyageFor(player) {
  const voyage = Sea.sea.voyage;
  return voyage && voyage.crew.has(player) ? voyage : null;
}

/**
 * Wiki (Fishing Trawler, contribution table): filling a leak and fixing a rail each give 5 Construction XP, only to a
 * player who owns a house (Construction answers "construction:owns-house").
 */
function constructionXp(player, amount) {
  const request = { player, owns: true };
  Shared.api()?.emitCustomEvent?.("construction:owns-house", request);
  if (request.owns !== false) Shared.addXp(player, "CONSTRUCTION", amount);
}

function fillLeak({ player, objectId }) {
  const index = hullSpots.get(objectId);
  if (index === undefined) return false;
  const voyage = voyageFor(player);
  if (!voyage) return true;
  const paste = Shared.ids().items.swampPaste;
  if (!Shared.carries(player, paste)) {
    player.sendMessage(Shared.message("noPaste"));
    return true;
  }
  if (voyage.leaks[index] !== Shared.DATA.values.hull.leak) return true;
  // Captured: human_pickuptable with synth 2581, the paste used a tick later.
  Shared.animate(player, Shared.ids().seqs.fill);
  player.getPacketSender().sendSound(Shared.DATA.sounds.fill, 255, 0);
  Shared.later(Shared.DATA.timing.fillDelay, () => {
    if (Sea.sea.voyage !== voyage || !Shared.carries(player, paste) || !voyage.patch(player, index)) return;
    player.getInventory().deleteNumber(paste, 1);
    constructionXp(player, Shared.DATA.xp.patchConstruction);
    player.sendMessage(Shared.message("filled"));
    voyage.sync(player);
  });
  return true;
}

function bail({ player }) {
  const voyage = voyageFor(player);
  if (!voyage) return false;
  const { bucket, bucketFull } = Shared.ids().items;
  if (player.getLocation().getZ() !== 0 || !voyage.bail(player)) {
    player.sendMessage(Shared.message("noBucketWater"));
    return true;
  }
  replaceOne(player, bucket, bucketFull);
  Shared.animate(player, Shared.ids().seqs.bail);
  player.sendMessage(Shared.message("bailed"));
  return true;
}

function emptyBucket({ player }) {
  const { bucket, bucketFull } = Shared.ids().items;
  replaceOne(player, bucketFull, bucket);
  player.sendMessage(Shared.message("emptied"));
  return true;
}

function replaceOne(player, fromId, toId) {
  const inventory = player.getInventory();
  inventory.deleteNumber(fromId, 1);
  inventory.addItem(new (Shared.core().Item)(toId, 1));
}

/** Rope on a ripped net: success rises with Crafting (a calibrated curve; the Wiki gives none). */
function mendNet({ player, object }, random = Math.random) {
  const voyage = voyageFor(player);
  if (!voyage) return false;
  if (!voyage.netRipped) {
    player.sendMessage(Shared.message("netFine"));
    return true;
  }
  const chance = Math.min(0.95, 0.4 + Shared.level(player, "CRAFTING") / 150);
  if (random() >= chance) {
    player.sendMessage(Shared.message("netFailed"));
    return true;
  }
  player.getInventory().deleteNumber(Shared.ids().items.rope, 1);
  voyage.mendNet(player);
  Shared.addXp(player, "CRAFTING", Shared.DATA.xp.netCrafting);
  player.sendMessage(Shared.message("netFixed"));
  return true;
}

function inspectBoatNet({ player, objectId }) {
  const { netLeft, netRight } = Shared.ids().locs;
  if (objectId !== netLeft && objectId !== netRight) return false;
  const voyage = voyageFor(player);
  player.sendMessage(voyage?.netRipped ? Shared.message("netRipped") : Shared.message("netFine"));
  return true;
}

/** Which side a tentacle is on: the port one rises north of the deck. */
function tentacleSide(npc) {
  return npc.getLocation().getY() >= Shared.DATA.portFromY ? "port" : "starboard";
}

/** The trawler's own hack animation for this axe (human_trawler_hack_axe_<axe>), else its chop. */
function hackAnimation(axe) {
  const cache = Shared.core().CacheDefinitions;
  const name = cache.getObjNames().get(axe.id) ?? "";
  const kind = name.replace(/_axe.*$/, "").replace(/^trailblazer$/, "trailblazer");
  return cache.getSeqId(`human_trawler_hack_axe_${kind}`) ?? axe.animationId ?? null;
}

function chopTentacle({ player, npc }, random = Math.random) {
  const voyage = voyageFor(player);
  if (!voyage) return false;
  const request = { player, axe: null };
  Shared.api().emitCustomEvent("woodcutting:axe", request);
  // A blessed axe can't chop it (Wiki).
  if (!request.axe || request.axe.id === Shared.ids().items.blessedAxe) {
    player.sendMessage(Shared.message("noAxe"));
    return true;
  }
  // A calibrated curve: the Wiki says only that the axe and Woodcutting level matter.
  const chance = Math.min(0.9, 0.3 + Shared.level(player, "WOODCUTTING") / 200 + (request.axe.tier ?? 0) * 0.04);
  const animation = hackAnimation(request.axe);
  if (animation !== null) Shared.animate(player, animation);
  if (random() >= chance) {
    player.sendMessage(Shared.message("chopFail"));
    return true;
  }
  const result = voyage.chop(player, tentacleSide(npc));
  if (!result) return true;
  Shared.addXp(player, "WOODCUTTING", Shared.DATA.xp.chopWoodcutting);
  player.sendMessage(result === "drove" ? Shared.message("chopDrove") : Shared.message("chopHit"));
  voyage.sync(player);
  return true;
}

/** A tentacle is out of walking reach beyond the rail: let the deck reach it. */
function tentacleRoute(event) {
  if (!tentacleIds.has(event.npcId) && !tentacleIds.has(event.npc?.getId?.())) return;
  event.range = TENTACLE_REACH;
  event.ignoreProjectileClip = true;
}

function fixRail({ player, objectId }) {
  const side = rails.get(objectId);
  if (!side) return false;
  const voyage = voyageFor(player);
  if (!voyage) return true;
  if (!Shared.carries(player, Shared.ids().items.hammer)) {
    player.sendMessage(Shared.message("noHammer"));
    return true;
  }
  if (!voyage.fixRail(player, side)) return true;
  constructionXp(player, Shared.DATA.xp.railConstruction);
  Shared.animate(player, Shared.ids().seqs.hammer);
  player.sendMessage(Shared.message("railFixed"));
  voyage.sync(player);
  return true;
}

/** Up to `count` of the crate's item, one per free slot. */
function takeFromCrate(player, itemId, count) {
  const inventory = player.getInventory();
  const room = Math.min(count, inventory.getFreeSlots());
  if (room <= 0) {
    inventory.full?.();
    return true;
  }
  for (let i = 0; i < room; i++) inventory.addItem(new (Shared.core().Item)(itemId, 1));
  return true;
}

/** Only the trawler's own crates: other "Hammers" crates (Tempoross, Tombs of Amascut) are theirs. */
const isCrate = (objectId, key) => objectId === Shared.ids().locs[key];

const takeBucket = ({ player, objectId }) => isCrate(objectId, "crateBuckets") && takeFromCrate(player, Shared.ids().items.bucket, 1);
const takeBuckets5 = ({ player, objectId }) => isCrate(objectId, "crateBuckets") && takeFromCrate(player, Shared.ids().items.bucket, 5);
const takeBuckets10 = ({ player, objectId }) => isCrate(objectId, "crateBuckets") && takeFromCrate(player, Shared.ids().items.bucket, 10);
const takeHammer = ({ player, objectId }) => isCrate(objectId, "crateHammers") && takeFromCrate(player, Shared.ids().items.hammer, 1);
const takeAxe = ({ player, objectId }) => isCrate(objectId, "crateAxes") && takeFromCrate(player, Shared.ids().items.bronzeAxe, 1);

function takeBucketsX({ player, objectId }) {
  if (!isCrate(objectId, "crateBuckets")) return false;
  player.setEnteredAmountAction({ execute: (amount) => takeFromCrate(player, Shared.ids().items.bucket, Math.max(0, Math.floor(amount))) });
  player.getPacketSender().sendEnterAmountPrompt("Enter amount:");
  return true;
}

function attachActions(api) {
  Shared.bind(api);
  resolveSpots();
  api.onObjectInteraction("Leak", { Fill: fillLeak });
  api.onItemAction("Bailing bucket", { "Bail-with": bail, Empty: emptyBucket });
  api.onItemOnObject("Rope", "Trawler net", mendNet);
  api.onObjectInteraction("Trawler net", { Inspect: inspectBoatNet });
  api.onNpcInteraction("Enormous Tentacle", { Chop: chopTentacle });
  api.onNpcRoute(tentacleRoute);
  api.onObjectInteraction("Broken rail", { Fix: fixRail });
  api.onObjectInteraction("Bailing buckets", {
    Take: takeBucket, "Take-5": takeBuckets5, "Take-10": takeBuckets10, "Take-X": takeBucketsX,
  });
  api.onObjectInteraction("Hammers", { Take: takeHammer });
  api.onObjectInteraction("Axes", { Take: takeAxe });
}

module.exports = { attachActions, tentacleRoute, hackAnimation, fillLeak, bail, emptyBucket, mendNet, chopTentacle, fixRail, tentacleSide, takeFromCrate, resolveSpots };
module.exports._crates = { takeBucket, takeBuckets5, takeBuckets10, takeBucketsX, takeHammer, takeAxe };
