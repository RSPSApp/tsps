const DIARY = "ardougne";
const TASK = "make-a-rune-crossbow-yourself-from-scratch-withi";
const STAGE_EVENT = "ardougne-elite:task-stage";
const QUERY_EVENT = "ardougne-elite:task-stage-query";
const CLEAR_EVENT = "ardougne-elite:task-stage-clear";

// Approximate town rectangles inferred from cache-mapped tiles; the cache has no semantic town bounds.
const YANILLE = Object.freeze({ minX: 2528, maxX: 2610, minY: 3060, maxY: 3155, plane: 0 });
const WITCHAVEN = Object.freeze({ minX: 2690, maxX: 2760, minY: 3230, maxY: 3310, plane: 0 });
const WITCHAVEN_WHEEL = Object.freeze({ x: 2731, y: 3278, z: 0 });
const RUNITE_ANVILS = new Set(["2613,3078,0", "2613,3081,0", "2616,3081,0"]);
const ANVIL_ID = 2097;
const WHEEL_ID = 8748;
const FLAGS = Object.freeze({ STOCK: "stock", LIMBS: "limbs", STRING: "string", UNSTRUNG: "unstrung" });

let api;

function active(player) {
  return player?.isRegistered?.() === true && player.getHitpoints?.() > 0
    && !player.isDyingReturn?.() && !player.getPrivateArea?.();
}

function point(location) {
  if (!location || !["x", "y", "z"].every((key) => Number.isInteger(location[key]))) return null;
  return location;
}

function inside(location, bounds) {
  const tile = point(location);
  return tile !== null && tile.z === bounds.plane
    && tile.x >= bounds.minX && tile.x <= bounds.maxX
    && tile.y >= bounds.minY && tile.y <= bounds.maxY;
}

function inStockTown(location) {
  return inside(location, YANILLE) || inside(location, WITCHAVEN);
}

function atWheel(stationObjectId, location) {
  const tile = point(location);
  return stationObjectId === WHEEL_ID && tile?.x === WITCHAVEN_WHEEL.x
    && tile.y === WITCHAVEN_WHEEL.y && tile.z === WITCHAVEN_WHEEL.z;
}

function atRuniteAnvil(stationObjectId, location) {
  const tile = point(location);
  return stationObjectId === ANVIL_ID && tile !== null && RUNITE_ANVILS.has(`${tile.x},${tile.y},${tile.z}`);
}

function hasInput(event, itemId) {
  return Array.isArray(event?.inputs)
    && event.inputs.some((input) => input?.itemId === itemId && Number.isInteger(input.amount) && input.amount > 0);
}

function stage(player) {
  const request = { player, task: TASK, result: null };
  api.emitCustomEvent(QUERY_EVENT, request);
  if (typeof request.result?.stage !== "string") return new Set();
  try {
    const values = JSON.parse(request.result.stage);
    return Array.isArray(values) && values.every((value) => Object.values(FLAGS).includes(value))
      ? new Set(values) : new Set();
  } catch {
    return new Set();
  }
}

function saveStage(player, flags) {
  api.emitCustomEvent(STAGE_EVENT, { player, task: TASK, stage: JSON.stringify([...flags].sort()) });
}

function clearStage(player) {
  api.emitCustomEvent(CLEAR_EVENT, { player, task: TASK });
}

function updateFlag(player, flag, valid) {
  const flags = stage(player);
  if (!valid) flags.delete(flag);
  else flags.add(flag);
  if (flags.size === 0) clearStage(player);
  else saveStage(player, flags);
}

function madeStock(event = {}) {
  const { player, itemId, amount, location } = event;
  if (!player || itemId !== api.core.ItemIdentifiers.YEW_STOCK || !(amount > 0)) return;
  const logIds = new Set([api.core.ItemIdentifiers.YEW_LOGS, api.core.ItemIdentifiers.YEW_LOGS_2, api.core.ItemIdentifiers.YEW_LOGS_3]);
  updateFlag(player, FLAGS.STOCK, active(player) && inStockTown(location)
    && Array.isArray(event.inputs) && event.inputs.some((input) => logIds.has(input?.itemId) && input.amount > 0));
}

function madeLimbs(event = {}) {
  const { player, itemId, amount, skill, location, stationObjectId } = event;
  if (!player || itemId !== api.core.ItemIdentifiers.RUNITE_LIMBS || !(amount > 0)) return;
  updateFlag(player, FLAGS.LIMBS, active(player) && skill === api.core.Skill.SMITHING
    && atRuniteAnvil(stationObjectId, location) && hasInput(event, api.core.ItemIdentifiers.RUNITE_BAR));
}

function spunString(event = {}) {
  const { player, itemId, amount, location, stationObjectId } = event;
  if (!player || itemId !== api.core.ItemIdentifiers.CROSSBOW_STRING || !(amount > 0)) return;
  const items = api.core.ItemIdentifiers;
  const stringMaterials = new Set([
    items.SINEW, items.OAK_ROOTS, items.WILLOW_ROOTS, items.MAPLE_ROOTS, items.YEW_ROOTS,
  ]);
  updateFlag(player, FLAGS.STRING, active(player) && atWheel(stationObjectId, location)
    && Array.isArray(event.inputs)
    && event.inputs.some((input) => stringMaterials.has(input?.itemId) && Number.isInteger(input.amount) && input.amount > 0));
}

function assembledUnstrung(event = {}) {
  const { player, itemId, amount } = event;
  if (!player || itemId !== api.core.ItemIdentifiers.RUNITE_CROSSBOW_U_ || !(amount > 0)) return;
  const flags = stage(player);
  clearStage(player);
  if (!active(player) || !hasInput(event, api.core.ItemIdentifiers.YEW_STOCK)
    || !hasInput(event, api.core.ItemIdentifiers.RUNITE_LIMBS)
    || !flags.has(FLAGS.STOCK) || !flags.has(FLAGS.LIMBS)) return;
  saveStage(player, new Set([FLAGS.UNSTRUNG, ...(flags.has(FLAGS.STRING) ? [FLAGS.STRING] : [])]));
}

function stringCrossbow(event = {}) {
  const { player, itemId, amount, location } = event;
  if (!player || itemId !== api.core.ItemIdentifiers.RUNE_CROSSBOW || !(amount > 0)) return;
  const flags = stage(player);
  clearStage(player);
  if (!active(player) || !flags.has(FLAGS.UNSTRUNG) || !flags.has(FLAGS.STRING)
    || !hasInput(event, api.core.ItemIdentifiers.RUNITE_CROSSBOW_U_)
    || !hasInput(event, api.core.ItemIdentifiers.CROSSBOW_STRING)
    || !inStockTown(location)) return;
  api.emitCustomEvent("diary:task", { player, diary: DIARY, task: TASK });
}

function register(pluginApi) {
  api = pluginApi;
  api.onCustomEvent("fletching:made", madeStock);
  api.onCustomEvent("smithing:success", madeLimbs);
  api.onCustomEvent("crafting:spun", spunString);
  api.onCustomEvent("fletching:made", assembledUnstrung);
  api.onCustomEvent("fletching:made", stringCrossbow);
}

module.exports = {
  name: "ArdougneEliteRuneCrossbowDiary",
  members: true,
  dependsOn: ["AchievementDiaries", "Fletching", "Smithing", "Crafting", "ArdougneEliteTaskProgress"],
  register,
  _test: {
    TASK, YANILLE, WITCHAVEN, WITCHAVEN_WHEEL, RUNITE_ANVILS, FLAGS,
    active, inside, inStockTown, atWheel, atRuniteAnvil, hasInput,
    madeStock, madeLimbs, spunString, assembledUnstrung, stringCrossbow,
  },
};
