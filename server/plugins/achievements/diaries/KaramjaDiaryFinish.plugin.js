/**
 * The Karamja Diary tasks that the earlier pass left as "no base action": the Musa Point ferry,
 * the Crandor secret wall and surface route, Vigroy and Hajedy's cart, the Lady of the Waves,
 * the Strong Tree grapple, palm leaves, and the Brimhaven/farming tasks.
 *
 * Every handler only credits after the producer's own success event, so a failed or partial
 * action (a refused fare, a burned leaf, a dead crop) never counts. OSRS Wiki: Karamja Diary,
 * Strong Tree (Karamja), Lady of the Waves, Shilo Village cart system, Leafy Palm Tree.
 */
const DIARY = "karamja";
const DIARY_DATA = require("./Data.AchievementDiaries").BY_KEY.get(DIARY);
const DiaryProgress = require("./Progress.AchievementDiaries");

const TASK = {
  musaFerry: "travel-to-port-sarim-via-the-dock-east-of-musa-p",
  hiddenWall: "discover-hidden-wall-in-the-dungeon-below-the-vo",
  crandor: "visit-the-isle-of-crandor-via-the-dungeon-below",
  cart: "use-vigroy-and-hajedy-s-cart-service",
  ladyOfWaves: "charter-the-lady-of-the-waves-from-cairn-isle-to",
  crossbow: "use-the-crossbow-shortcut-south-of-the-volcano",
  palmLeaves: "collect-5-palm-leaves",
  fruitTree: "grow-a-healthy-fruit-tree-in-the-patch-near-brim",
  vines: "chop-the-vines-to-gain-deeper-access-to-brimhave",
  steppingStones: "cross-the-lava-using-the-stepping-stones-within",
  stairs: "climb-the-stairs-within-brimhaven-dungeon",
  palmHealth: "check-the-health-of-a-palm-tree-in-brimhaven",
  calquat: "check-the-health-of-your-calquat-tree-patch",
};

const PALM_LEAVES = 5;
const PALM_LEAVES_ATTRIBUTE = "karamja-diary:palm-leaves-collected";

/** Brimhaven's fruit-tree patch (plugins/skills/data/farming-data.json: id 7964 at 2764,3212). */
const BRIMHAVEN_FRUIT_PATCH = { id: 7964, x: 2764, y: 3212 };
/** Imiago's Calquat patch (farming-data.json: id 7807 at 2795,3100). */
const CALQUAT_PATCH = { x: 2795, y: 3100 };
/** karam_dungeon_cavestairs2 (Walk-up) and karam_dungeon_cavestairs_lev2_down2 (Walk-down). */
const BRIMHAVEN_STAIRS = new Set([21725, 21726]);
/** The vine immediately inside Brimhaven Dungeon's main entrance. */
const ENTRANCE_VINE = "karam_dungeon_vineblocking1";

let core;
let api;

function complete(player, task) {
  if (!player) return;
  api.emitCustomEvent("diary:task", { player, diary: DIARY, task });
}

function count(player, attribute, target, task) {
  const total = (Number(player.getAttribute(attribute)) || 0) + 1;
  player.setAttribute(attribute, Math.min(total, target));
  if (total >= target) complete(player, task);
  else DiaryProgress.notifyTaskProgress(player, DIARY_DATA, task);
}

/** PiratesTreasure's Musa Point <-> Port Sarim voyage, after the ship lands. */
function ferried({ player, route }) {
  if (route === "musa-point-port-sarim") complete(player, TASK.musaFerry);
}

function wallDiscovered({ player }) {
  complete(player, TASK.hiddenWall);
}

function crandorVisited({ player }) {
  complete(player, TASK.crandor);
}

function cartArrived({ player }) {
  complete(player, TASK.cart);
}

function sailed({ player, destination }) {
  if (destination === "port-khazard") complete(player, TASK.ladyOfWaves);
}

function obstacle({ player, shortcut, method }) {
  if (shortcut === "Strong Tree (Karamja)" && method === "grapple") complete(player, TASK.crossbow);
  if (shortcut === "Stepping stones (Western Brimhaven Dungeon)") complete(player, TASK.steppingStones);
}

function palmTaken({ player, itemId }) {
  if (itemId === core.ItemIdentifiers.PALM_LEAF) count(player, PALM_LEAVES_ATTRIBUTE, PALM_LEAVES, TASK.palmLeaves);
}

function vinesCut({ player, vine, inward }) {
  if (inward && vine === ENTRANCE_VINE) complete(player, TASK.vines);
}

function stairsArrived({ player, objectId }) {
  if (BRIMHAVEN_STAIRS.has(objectId)) complete(player, TASK.stairs);
}

function healthChecked({ player, crop, type, patch }) {
  if (patch?.id === BRIMHAVEN_FRUIT_PATCH.id) {
    if (type === "FRUIT_TREE") complete(player, TASK.fruitTree);
    if (crop === "PALM") complete(player, TASK.palmHealth);
  }
  if (type === "CALQUAT" && patch?.x === CALQUAT_PATCH.x && patch?.y === CALQUAT_PATCH.y) {
    complete(player, TASK.calquat);
  }
}

module.exports = {
  name: "KaramjaDiaryFinish",
  members: true,
  dependsOn: ["AchievementDiaries"],
  register(pluginApi) {
    api = pluginApi;
    core = pluginApi.core;
    api.persistAttribute(PALM_LEAVES_ATTRIBUTE, 0);
    api.onCustomEvent("ferries:arrived", ferried);
    api.onCustomEvent("dragon-slayer:crandor-wall", wallDiscovered);
    api.onCustomEvent("dragon-slayer:crandor-visited", crandorVisited);
    api.onCustomEvent("shilo-cart:arrived", cartArrived);
    api.onCustomEvent("lady-of-the-waves:sailed", sailed);
    api.onCustomEvent("agility:obstacle", obstacle);
    api.onCustomEvent("ground-items:taken", palmTaken);
    api.onCustomEvent("brimhaven-dungeon:vines-cut", vinesCut);
    api.onCustomEvent("loc-teleports:arrived", stairsArrived);
    api.onCustomEvent("farming:check-health", healthChecked);
  },
  _test: {
    TASK, PALM_LEAVES_ATTRIBUTE, BRIMHAVEN_FRUIT_PATCH, CALQUAT_PATCH, BRIMHAVEN_STAIRS, ENTRANCE_VINE,
    ferried, wallDiscovered, crandorVisited, cartArrived, sailed, obstacle, palmTaken, vinesCut,
    stairsArrived, healthChecked,
  },
};
