/**
 * Falador achievement diary: the seven remaining gameplay tasks.
 *
 * This listens to the ordinary success actions from Sir Renitee, Sir Vyvin, farming, agility
 * and Rogues' Den. It never invents a shortcut: every task is credited only after the owning
 * action succeeded with the Wiki's location, item, NPC or rank condition.
 */
const DIARY = "falador";
const DiaryProgress = require("./Progress.AchievementDiaries");
const DIARY_DATA = require("./Data.AchievementDiaries").BY_KEY.get(DIARY);

const TASK = {
  crestIdentified: "find-out-what-your-family-crest-is-from-sir-reni",
  crestChanged: "change-your-family-crest-to-the-saradomin-symbol",
  scarecrow: "place-a-scarecrow-in-the-falador-farming-patch",
  grapple: "grapple-up-and-then-jump-off-the-north-falador-w",
  wallSafe: "crack-a-wall-safe-within-rogues-den",
  magicRoots: "find-at-least-3-magic-roots-at-once-when-digging",
  white2h: "purchase-a-white-2h-sword-from-sir-vyvin",
};

const FALADOR_FLOWER = { x: 3054, y: 3307, z: 0 };
const FALADOR_TREE = { x: 3003, y: 3372, z: 0 };
const NORTH_WALL = { minX: 3031, maxX: 3034, minY: 3387, maxY: 3391 };
const GRAPPLE_IDS = new Set([17047, 17049, 17050]);
const JUMP_DOWN_IDS = new Set([17048, 17051, 17052]);
const GRAPPLE_ATTRIBUTE = "falador-diary:north-wall-grappled";
const GRAPPLE_WINDOW_MS = 30 * 60 * 1000;
const WHITE_KNIGHT_MASTER_SHOP = 1376;
const WHITE_2H_SWORD = 6609;

let api;

function award(player, task) {
  api.emitCustomEvent("diary:task", { player, diary: DIARY, task });
}

function onCrestIdentified({ player }) {
  if (player) award(player, TASK.crestIdentified);
}

function onCrestChanged({ player, crest, previous }) {
  if (player && crest === "Saradomin" && previous !== "Saradomin") award(player, TASK.crestChanged);
}

function onScarecrow({ player, patch }) {
  if (!player || !patch) return;
  if (patch.x === FALADOR_FLOWER.x && patch.y === FALADOR_FLOWER.y && patch.z === FALADOR_FLOWER.z) {
    award(player, TASK.scarecrow);
  }
}

function onRoots({ player, crop, patch, amount }) {
  if (!player || !patch) return;
  if (crop !== "MAGIC" || Number(amount) < 3) return;
  if (patch.x === FALADOR_TREE.x && patch.y === FALADOR_TREE.y && patch.z === FALADOR_TREE.z) {
    award(player, TASK.magicRoots);
  }
}

function coordinate(location, axis) {
  const getter = `get${axis.toUpperCase()}`;
  return typeof location?.[getter] === "function" ? location[getter]() : location?.[axis];
}

function atNorthWall(location, z) {
  return coordinate(location, "z") === z
    && coordinate(location, "x") >= NORTH_WALL.minX && coordinate(location, "x") <= NORTH_WALL.maxX
    && coordinate(location, "y") >= NORTH_WALL.minY && coordinate(location, "y") <= NORTH_WALL.maxY;
}

function onAgilityObstacle({ player, objectId, method, location }) {
  if (!player || !location) return;
  if (GRAPPLE_IDS.has(objectId) && method === "grapple" && atNorthWall(location, 0)) {
    const previous = Number(player.getAttribute(GRAPPLE_ATTRIBUTE) ?? 0);
    player.setAttribute(GRAPPLE_ATTRIBUTE, Date.now());
    if (!previous) DiaryProgress.notifyTaskProgress(player, DIARY_DATA, TASK.grapple);
    return;
  }
  if (!JUMP_DOWN_IDS.has(objectId) || !atNorthWall(location, 1)) return;
  const grappledAt = Number(player.getAttribute(GRAPPLE_ATTRIBUTE) ?? 0);
  if (!grappledAt || Date.now() - grappledAt > GRAPPLE_WINDOW_MS) return;
  player.setAttribute(GRAPPLE_ATTRIBUTE, null);
  award(player, TASK.grapple);
}

function onWallSafe({ player }) {
  if (player) award(player, TASK.wallSafe);
}

function onShopPurchase({ player, shopId, itemId, originalStock }) {
  if (!player || shopId !== WHITE_KNIGHT_MASTER_SHOP || itemId !== WHITE_2H_SWORD || originalStock !== true) return;
  const quest = { player, key: "wanted", complete: null };
  api.emitCustomEvent("quest:is-complete", quest);
  if (quest.complete === true) award(player, TASK.white2h);
}

function bind(registry) {
  api = registry;
  api.onCustomEvent("sir-renitee:crest-identified", onCrestIdentified);
  api.onCustomEvent("sir-renitee:crest-changed", onCrestChanged);
  api.onCustomEvent("farming:scarecrow", onScarecrow);
  api.onCustomEvent("farming:roots", onRoots);
  api.onCustomEvent("agility:obstacle", onAgilityObstacle);
  api.onCustomEvent("rogues-den:lobby-safe-cracked", onWallSafe);
  api.onCustomEvent("shop:purchase", onShopPurchase);
}

module.exports = {
  name: "FaladorDiaryRemainder",
  members: true,
  dependsOn: ["AchievementDiaries"],
  register(registry) {
    bind(registry);
  },
  _test: {
    TASK, GRAPPLE_ATTRIBUTE, onCrestIdentified, onCrestChanged, onScarecrow, onRoots,
    onAgilityObstacle, onWallSafe, onShopPurchase,
  },
};
