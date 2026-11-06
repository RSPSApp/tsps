/**
 * Keldagrim access: the entrance cave's way back out to Rellekka, the passage between the cave
 * and the city, the city's house stairs, and the ferrymen across the river (2 coins, through
 * their Wiki transcript or the Travel option). The way in from Rellekka is in Rellekka.plugin.js
 * and the Blast Furnace stairs are in minigames/BlastFurnace.plugin.js.
 *
 * Tiles are Offline_Scape's (RSPS); the locs are the cache's. The cave entrance leads to the
 * Dwarven Boatman on the river's near bank; talking to him starts The Giant Dwarf and the boat
 * ride is what takes you into the city, so the cave entrance itself cannot be quest-gated.
 */

/** Loc id -> where it takes you. */
let PASSAGES = new Map();
/** The city's house stairs: each has its pair on the floor above or below. */
let HOUSE_STAIRS = new Set();

/** Ferryman npc -> his transcript variant and where he lands you (landing tiles: Offline_Scape). */
let FERRYMEN = new Map();
const FERRY_FARE = 2;
const FERRY_MESSAGE = "The dwarf ferries you across the river.";
const NO_FARE_CONDITION = "If the player doesn't have 2 coins:";
/** The transcript's [Charm] crossings, which are free. */
const CHARM_CROSSINGS = new Set(["d9TbkS", "PJ6RxL"]);
/** The city's music regions (Tale of Keldagrim, Land of the Dwarves); the entrance mine and the
 * boatman's dock south of the river are "Time to Mine", not the city. */
const CITY_ZONE_EAST = { minX: 2880, maxX: 2943, minY: 10112, maxY: 10239, levels: [0] };
const CITY_ZONE_WEST = { minX: 2816, maxX: 2879, minY: 10177, maxY: 10239, levels: [0] };

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
  event.player.moveTo(new core.Location(to[0], to[1], 0));
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

/** The transcript's refusal when the player hasn't got a coin ("You don't even have 2 gold coins..."). */
function refuseFare(player, npc, npcId) {
  const request = {
    player, npc, npcId, variant: FERRYMEN.get(npcId).variant, exact: true, handled: false,
    select: (steps) => steps.flatMap(function find(step) {
      if (step?.type === "condition" && step.text === NO_FARE_CONDITION) return [step];
      return [...(step?.steps ?? []), ...(step?.options ?? []).flatMap((option) => option.steps ?? [])].flatMap(find);
    })[0]?.steps ?? [],
  };
  pluginApi.emitCustomEvent("npc-dialogue:start", request);
  return request.handled;
}

/** Travel: the fare, one coin as the transcript's exception, or with none the ferryman's refusal. */
function travel({ player, npc, npcId }) {
  if (!FERRYMEN.has(npcId)) return false;
  if (coins(player) < 1) {
    refuseFare(player, npc, npcId);
    return true;
  }
  ferry(player, npcId);
  player.sendMessage(FERRY_MESSAGE);
}

module.exports = {
  name: "Keldagrim",
  members: true,
  _test: { init, goThrough, travel },
  register(api) {
    init(api);
    api.onObjectInteraction("Tunnel", { Enter: goThrough });
    api.onObjectInteraction("Cave entrance", { "Go-through": goThrough });
    api.onObjectInteraction("Entrance", { "Go-through": goThrough });
    api.onZoneEnter(CITY_ZONE_EAST, markKeldagrimVisited);
    api.onZoneEnter(CITY_ZONE_WEST, markKeldagrimVisited);
    api.onObjectInteraction("Stairs", { "Climb-up": climbStairsUp, "Climb-down": climbStairsDown });
    api.onNpcInteraction("Dwarven Ferryman", { Travel: travel });
    api.onNpcDialogueVariant(ferrymanVariant);
    api.onNpcDialogueCondition(ferrymanCondition);
    api.onCustomEvent("npc-dialogue:action", ferrymanCrosses);
  },
};
