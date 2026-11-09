"use strict";

/**
 * The Colossal Wyrm Agility Course's rewards (the courses themselves are
 * plugins/skills/agility/courses/ColossalWyrm*.Agility.js): the termites found on the course, and
 * Worm Tongue's Wares, the anteater's shop that takes them.
 *
 * Termites (Wiki: Colossal Wyrm Agility Course, Termites; rsprox 237/01106, 237/01108):
 * - A finished lap may put termites on one of that course's eight markers (the
 *   `varlamore_wyrm_agility_*_termites` locs, shown while varbit
 *   `varlamore_wyrm_agility_termite_obstacle` holds the marker's number). The varbit is set
 *   straight after the lap count line; a new spawn replaces one not yet collected, and a lap
 *   without one leaves it (1106: marker 4, set by a basic lap, stays through six advanced laps).
 *   It is kept across logins (other recordings log in with it set).
 * - Finishing the obstacle that ends at the marker scoops them automatically: "You managed to
 *   scoop up N termites!", the varbit back to 0, "You also find N piles of bone shards they
 *   chipped off!" when shards come with them, human_pickupfloor, area sound 9703, synth sound
 *   2581 and wyrm_agility_termite_despawn on the marker.
 * - Amounts (Wiki): 11-14 a scoop on the basic course's markers, the two shared ones included,
 *   16-21 on the advanced course's own; an 80% chance of 22-38 blessed bone shards with them.
 * - The spawn chance is not on the Wiki ("currently unknown"), which gives 5.6 termites a lap on
 *   the advanced course on average. SPAWN_CHANCE is worked out from that and the scoop sizes; the
 *   recordings (3 spawns in 11 laps) agree with it. Which marker is picked (one of the course's
 *   own, evenly) is ours: the recordings only show basic laps picking a basic marker and advanced
 *   laps a shared one.
 * - Ours: the tightrope and the edges jumped after it, the basic rope and its long jumps, and the
 *   advanced tightrope and the rope after it are one obstacle each here
 *   (ColossalWyrmBasic.Agility.js), so termites on the first of those markers are scooped as the
 *   whole obstacle ends.
 *
 * Worm Tongue's Wares is the cache's omnishop row `wyrm_agility_rewards_shop` (rsprox 237/01106
 * opens it): amylase packs 100 termites, teleport scrolls 40, the graceful crafting kit 650 and a
 * calcified acorn 900, as the Wiki lists. The kit (wyrm_agility_graceful_dummyitem) also costs
 * one of each plain graceful piece: buying it swaps the six for their Varlamore versions instead
 * of handing over a kit (Wiki: "Requires full graceful set").
 */

const { Loc } = require("../skills/agility/courses/ColossalWyrmSteps.Agility");

const TERMITE_MARKER_ATTRIBUTE = "colossal-wyrm-agility:termite-marker";
const TERMITE_MARKER_VARBIT = "varlamore_wyrm_agility_termite_obstacle";

const COURSE = Object.freeze({ BASIC: "wyrm-basic", ADVANCED: "wyrm-advanced" });

const BASIC_SCOOP = [11, 14];
const ADVANCED_SCOOP = [16, 21];

/** The markers (cache loc placements), by the varbit value that shows them, and their scoop sizes. */
const MARKERS = Object.freeze({
  1: { tile: [1655, 2918, 1], termites: BASIC_SCOOP }, // varlamore_wyrm_agility_balance_1_termites
  2: { tile: [1649, 2910, 1], termites: BASIC_SCOOP }, // varlamore_wyrm_agility_multijump_termites
  3: { tile: [1635, 2910, 1], termites: BASIC_SCOOP }, // varlamore_wyrm_agility_basic_balance_1_termites
  4: { tile: [1627, 2914, 1], termites: BASIC_SCOOP }, // varlamore_wyrm_agility_basic_monkeybars_1_termites
  5: { tile: [1627, 2931, 1], termites: BASIC_SCOOP }, // varlamore_wyrm_agility_basic_jump_1_termites
  8: { tile: [1635, 2907, 2], termites: ADVANCED_SCOOP }, // varlamore_wyrm_agility_advanced_jump_1_termites
  9: { tile: [1625, 2916, 2], termites: ADVANCED_SCOOP }, // varlamore_wyrm_agility_advanced_balance_1_termites
  10: { tile: [1624, 2931, 2], termites: ADVANCED_SCOOP }, // varlamore_wyrm_agility_advanced_monkeybars_1_termites
});

/** The markers on each course's route; the first two are shared. */
const COURSE_MARKERS = Object.freeze({
  [COURSE.BASIC]: [1, 2, 3, 4, 5],
  [COURSE.ADVANCED]: [1, 2, 8, 9, 10],
});

/** The obstacle (by its trigger loc) that ends on each marker. */
const OBSTACLE_MARKERS = new Map([
  [Loc.TIGHTROPE, [1, 2]],
  [Loc.BASIC_TIGHTROPE, [3]],
  [Loc.BASIC_ROPE, [4, 5]],
  [Loc.ADVANCED_EDGE, [8]],
  [Loc.ADVANCED_TIGHTROPE, [9, 10]],
]);

/** The Wiki's average for an advanced lap. */
const ADVANCED_LAP_TERMITES = 5.6;

function averageScoop(markers) {
  return markers.reduce((sum, marker) => sum + (MARKERS[marker].termites[0] + MARKERS[marker].termites[1]) / 2, 0)
    / markers.length;
}

/** The chance a lap spawns termites: 5.6 / 16.1, the advanced route's average scoop (about 35%). */
const SPAWN_CHANCE = ADVANCED_LAP_TERMITES / averageScoop(COURSE_MARKERS[COURSE.ADVANCED]);

const BONE_SHARD_CHANCE = 0.8;
const BONE_SHARDS = [22, 38];

const PICKUP_ANIMATION = 827; // human_pickupfloor
const SCOOP_AREA_SOUND = 9703;
const SCOOP_AREA_RADIUS = 5;
const SCOOP_SOUND = 2581;
const DESPAWN_MAP_ANIM = 2967; // wyrm_agility_termite_despawn

const MESSAGE = {
  TERMITES: (amount) => `You managed to scoop up <col=ff3045>${amount} termites</col>!`,
  BONE_SHARDS: (amount) => `You also find <col=ff3045>${amount} piles of bone shards</col> they chipped off!`,
};

const SHOP = "wyrm_agility_rewards_shop";
const GRACEFUL_KIT_STOCK = "wyrm_agility_rewards_shop_stock_3";
/** The info panel's text for each stock row, as rsprox 237/01106 sends it. */
const DESCRIPTIONS = Object.freeze({
  wyrm_agility_rewards_shop_stock_1: "A pack containing 100 crystals of amylase.",
  wyrm_agility_rewards_shop_stock_2: "A teleport to the Colossal Wyrm Remains in the Avium Savannah.",
  [GRACEFUL_KIT_STOCK]: "Gives your graceful kit a Varlamore-themed makeover.",
  wyrm_agility_rewards_shop_stock_4: "A brittle looking acorn. Perhaps a squirrel would be interested in this?",
});
/** The plain graceful pieces the kit takes (its other currencies) and the Varlamore pieces given for them. */
const GRACEFUL_MAKEOVER = Object.freeze([
  ["GRACEFUL_HOOD", "GRACEFUL_HOOD_34"],
  ["GRACEFUL_CAPE", "GRACEFUL_CAPE_34"],
  ["GRACEFUL_TOP", "GRACEFUL_TOP_34"],
  ["GRACEFUL_LEGS", "GRACEFUL_LEGS_34"],
  ["GRACEFUL_GLOVES", "GRACEFUL_GLOVES_34"],
  ["GRACEFUL_BOOTS", "GRACEFUL_BOOTS_34"],
]);

let api;
let core;

function roll([min, max]) {
  return min + Math.floor(Math.random() * (max - min + 1));
}

function markerVarbit() {
  return core.CacheDefinitions.getVarbitId(TERMITE_MARKER_VARBIT);
}

function markerOf(player) {
  const marker = Number(player.getAttribute(TERMITE_MARKER_ATTRIBUTE));
  return MARKERS[marker] ? marker : 0;
}

function setMarker(player, marker) {
  player.setAttribute(TERMITE_MARKER_ATTRIBUTE, marker);
  player.getPacketSender().sendVarbit(markerVarbit(), marker);
}

function syncMarker({ player }) {
  player.getPacketSender().sendVarbit(markerVarbit(), markerOf(player));
}

/** A finished Wyrm lap may spawn termites on one of its course's markers. */
function spawnTermites({ player, course }) {
  const markers = COURSE_MARKERS[course];
  if (!markers || Math.random() >= SPAWN_CHANCE) return;
  setMarker(player, markers[Math.floor(Math.random() * markers.length)]);
}

/** A course find, through "agility:course-item" so content can change it; the floor takes what has no room. */
function give(player, course, itemId, rolled) {
  const request = { player, course, itemId, amount: rolled };
  api.emitCustomEvent("agility:course-item", request);
  const amount = Math.max(0, request.amount | 0);
  if (amount <= 0) return 0;
  const item = new core.Item(itemId, amount);
  const inventory = player.getInventory();
  const added = Math.min(amount, inventory.getAddableAmount(item));
  if (added > 0) inventory.adds(itemId, added);
  if (amount > added) {
    api.getItemOnGroundManager().registerLocation(player, new core.Item(itemId, amount - added), player.getLocation().clone());
  }
  return amount;
}

/** Finishing the obstacle that ends at the termites' marker scoops them up. */
function scoopTermites({ player, objectId }) {
  const marker = markerOf(player);
  if (!marker || !OBSTACLE_MARKERS.get(objectId)?.includes(marker)) return;
  const course = COURSE_MARKERS[COURSE.BASIC].includes(marker) ? COURSE.BASIC : COURSE.ADVANCED;
  const spot = MARKERS[marker];
  const { ItemIdentifiers } = core;
  const termites = give(player, course, ItemIdentifiers.TERMITES, roll(spot.termites));
  if (termites > 0) player.sendMessage(MESSAGE.TERMITES(termites));
  setMarker(player, 0);
  if (Math.random() < BONE_SHARD_CHANCE) {
    const shards = give(player, course, ItemIdentifiers.BLESSED_BONE_SHARDS, roll(BONE_SHARDS));
    if (shards > 0) player.sendMessage(MESSAGE.BONE_SHARDS(shards));
  }
  player.getInventory().refreshItems();
  player.performAnimation(new core.Animation(PICKUP_ANIMATION));
  const location = player.getLocation();
  core.Sounds.playAreaSound({
    soundId: SCOOP_AREA_SOUND, x: location.getX(), y: location.getY(), level: location.getZ(), radius: SCOOP_AREA_RADIUS,
  });
  player.getPacketSender().sendSoundEffect(SCOOP_SOUND, 1, 0);
  const [x, y, z] = spot.tile;
  player.getPacketSender().sendGraphic(new core.Graphic(DESPAWN_MAP_ANIM), new core.Location(x, y, z));
}

function openShop({ player }) {
  const request = { player, shop: SHOP, handled: false };
  api.emitCustomEvent("omnishop:open", request);
  return request.handled;
}

function describe(request) {
  if (request.shop !== SHOP) return;
  request.description = DESCRIPTIONS[request.stock] ?? request.description;
}

/** The kit's graceful pieces are paid as currencies; what it gives is their Varlamore versions. */
function purchase(request) {
  if (request.shop !== SHOP || request.stock !== GRACEFUL_KIT_STOCK) return;
  request.handled = true;
  const inventory = request.player.getInventory();
  for (const [, varlamore] of GRACEFUL_MAKEOVER) inventory.adds(core.ItemIdentifiers[varlamore], 1);
  inventory.refreshItems();
}

function init(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
}

module.exports = {
  name: "ColossalWyrmAgility",
  description: "Colossal Wyrm Agility Course rewards: termites spawning on the course and scooped up, and Worm Tongue's Wares.",
  members: true,
  register(pluginApi) {
    init(pluginApi);
    pluginApi.persistAttribute(TERMITE_MARKER_ATTRIBUTE, 0);
    pluginApi.onPlayerLogin(syncMarker);
    pluginApi.onCustomEvent("agility:lap", spawnTermites);
    pluginApi.onCustomEvent("agility:obstacle", scoopTermites);
    pluginApi.onNpcInteraction("Worm Tongue", { Shop: openShop });
    pluginApi.onCustomEvent("omnishop:describe", describe);
    pluginApi.onCustomEvent("omnishop:purchase", purchase);
  },
};

Object.assign(module.exports, {
  SPAWN_CHANCE, MARKERS, COURSE_MARKERS, OBSTACLE_MARKERS, GRACEFUL_MAKEOVER, TERMITE_MARKER_ATTRIBUTE, SHOP,
});
