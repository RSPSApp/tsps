/**
 * Keldagrim access: the entrance cave's way back out to Rellekka, the passage between the cave
 * and the city, the city's house stairs, and the ferrymen across the river (2 coins, through
 * their Wiki transcript or the Travel option). The way in from Rellekka is in Rellekka.plugin.js
 * and the Blast Furnace stairs are in minigames/BlastFurnace.plugin.js.
 *
 * Tiles are Offline_Scape's (RSPS); the locs are the cache's. OSRS requires starting The Giant
 * Dwarf to enter Keldagrim, so the cave-to-city passage is gated on that quest state.
 */

/** Loc id -> where it takes you. */
let PASSAGES = new Map();
/** The city's house stairs: each has its pair on the floor above or below. */
let HOUSE_STAIRS = new Set();

/** Ferryman npc -> his transcript variant and where he lands you (landing tiles: Offline_Scape). */
let FERRYMEN = new Map();
const FERRY_FARE = 2;
const FERRY_MESSAGE = "The dwarf ferries you across the river.";
/** The transcript's [Charm] crossings, which are free. */
const CHARM_CROSSINGS = new Set(["d9TbkS", "PJ6RxL"]);
const CITY_ZONE = { minX: 2790, maxX: 2940, minY: 10100, maxY: 10215, levels: [0] };

let core;
let pluginApi;

function init(api) {
  pluginApi = api;
  core = api.core;
  const Objects = core.ObjectIdentifiers;
  PASSAGES = new Map([
    [Objects.TUNNEL_10, [2730, 3713]], // entrance cave > Rellekka
    [Objects.CAVE_ENTRANCE_29, [2838, 10124]], // entrance cave > city
    [Objects.ENTRANCE_8, [2780, 10161]], // city > entrance cave
  ]);
  const Npcs = core.NpcIdentifiers;
  FERRYMEN = new Map([
    [Npcs.DWARVEN_FERRYMAN, { variant: "standard-dialogue-south-ferryman", to: [2836, 10140] }],
    [Npcs.DWARVEN_FERRYMAN_2, { variant: "standard-dialogue-north-ferryman", to: [2857, 10133] }],
  ]);
  HOUSE_STAIRS = new Set([Objects.STAIRS_32, Objects.STAIRS_33, Objects.STAIRS_34, Objects.STAIRS_35, Objects.STAIRS_36]);
}

function goThrough(event) {
  const to = PASSAGES.get(event.objectId);
  if (!to) return false;
  if (event.objectId === core.ObjectIdentifiers.CAVE_ENTRANCE_29 && !hasStartedGiantDwarf(event.player)) {
    event.player.sendMessage("You need to start The Giant Dwarf to enter Keldagrim.");
    return;
  }
  event.player.moveTo(new core.Location(to[0], to[1], 0));
}

function hasStartedGiantDwarf(player) {
  const request = { player, key: "giant_dwarf", started: false };
  pluginApi.emitCustomEvent("quest:is-started", request);
  return request.started === true;
}

function markKeldagrimVisited({ player }) {
  pluginApi.emitCustomEvent("keldagrim:entered-city", { player });
}

/** Hands the stairs to the generic ladder climb, which needs their pair on the next floor. */
function climbStairsUp(event) {
  if (!HOUSE_STAIRS.has(event.objectId)) return false;
  pluginApi.emitCustomEvent("ladders:climbUp", event);
}

function climbStairsDown(event) {
  if (!HOUSE_STAIRS.has(event.objectId)) return false;
  pluginApi.emitCustomEvent("ladders:climbDown", event);
}

// --- The ferrymen.

function coins(player) {
  return player.getInventory().getAmount(core.ItemIdentifiers.COINS);
}

function ferrymanVariant({ npcId }) {
  return FERRYMEN.get(npcId)?.variant ?? null;
}

function ferrymanCondition({ player, npcId, text }) {
  if (!FERRYMEN.has(npcId)) return null;
  const answers = {
    "If the player has 2 coins:": coins(player) >= FERRY_FARE,
    "If the player doesn't have 2 coins:": coins(player) < FERRY_FARE,
    "If the player has exactly 1 coin:": coins(player) === 1,
    "If the player has the Ring of Charos equipped:":
      player.getEquipment().getItems()[core.Equipment.RING_SLOT]?.getId?.() === core.ItemIdentifiers.RING_OF_CHAROS_A_,
  };
  return Object.hasOwn(answers, text) ? answers[text] : null;
}

/** Takes the fare, or whatever is short of it ("I suppose I could make an exception"), and crosses. */
function ferry(player, npcId, fare = Math.min(FERRY_FARE, coins(player))) {
  const [x, y] = FERRYMEN.get(npcId).to;
  if (fare > 0) player.getInventory().deleteNumber(core.ItemIdentifiers.COINS, fare);
  player.moveTo(new core.Location(x, y, 0));
}

/** The transcript's "The dwarf ferries you across the river." step is the crossing. */
function ferrymanCrosses({ player, npcId, text, stepId, kind }) {
  if (kind !== "message" || text !== FERRY_MESSAGE || !FERRYMEN.has(npcId)) return;
  ferry(player, npcId, CHARM_CROSSINGS.has(stepId) ? 0 : undefined);
}

function travel({ player, npcId }) {
  if (!FERRYMEN.has(npcId)) return false;
  ferry(player, npcId);
  player.sendMessage(FERRY_MESSAGE);
}

module.exports = {
  name: "Keldagrim",
  members: true,
  _test: { init, goThrough },
  register(api) {
    init(api);
    api.onObjectInteraction("Tunnel", { Enter: goThrough });
    api.onObjectInteraction("Cave entrance", { "Go-through": goThrough });
    api.onObjectInteraction("Entrance", { "Go-through": goThrough });
    api.onZoneEnter(CITY_ZONE, markKeldagrimVisited);
    api.onObjectInteraction("Stairs", { "Climb-up": climbStairsUp, "Climb-down": climbStairsDown });
    api.onNpcInteraction("Dwarven Ferryman", { Travel: travel });
    api.onNpcDialogueVariant(ferrymanVariant);
    api.onNpcDialogueCondition(ferrymanCondition);
    api.onCustomEvent("npc-dialogue:action", ferrymanCrosses);
  },
};
