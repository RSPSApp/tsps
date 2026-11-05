/**
 * Wilderness Diary tasks in the Resource Area (https://oldschool.runescape.wiki/w/Resource_Area, Wilderness
 * Diary): medium "Smith a Golden helmet", hard "Smith an Adamant scimitar", elite "Fish and Cook a Dark Crab"
 * and elite "Cut and burn some magic logs", each done inside the enclosure east of the Deserted Keep (Wiki map x 3174-3197, y 3924-3945;
 * its gate is on the north side at 3184,3944-3945).
 *
 * The Golden helmet is made by Between a Rock's anvil handling (gold bars on any anvil, from the quest step where
 * Dondakan wants the golden cannonball, also after the quest; the Wiki's "partial completion" names no step, so
 * that bound is inferred) and arrives here as the same smithing:success event, with the helmet as the item.
 *
 * Each credit rides the activity's own success event (smithing:success, fishing:success, cooking:success,
 * woodcutting:success, firemaking:success) with the player in the area. The two-step tasks keep their first
 * step in a saved attribute:
 * - cut and burn: Wiki, "completing or updating any other task in-between these steps will reset the progress
 *   for this task"; so another task completing, or taking a step, clears the cut step. The burn step is logs lit
 *   (firemaking:success), which an infernal axe's burning does not emit (Wiki: those do not count).
 * - fish and cook: INFERRED, the Wiki is silent: fish first, then cook, and no reset between.
 *
 * - rune scimitar from scratch: Wiki, "You must kill two separate Runite Golems and mine them each for runite
 *   ores, smelt two runite bars in the nearby furnace (Superheat Item does not work), then smith the rune
 *   scimitar on the anvil. The steps for mining the ores are still completed if the ores are destroyed by an
 *   infernal pickaxe. Completing or updating any other task in-between these steps will reset the progress".
 *   Steps are the actions, not the items: a bought bar can't stand in for a smelt, but two other bars can be
 *   the ones hammered. "You must kill" means this player's kill: another's rock gives ore, but no step. Ours: the
 *   steps in that order, "separate" as each golem's spawn tile, the killer being who did the most damage, and the saved
 *   progress surviving a logout (the Wiki is silent, as for the other two).
 *   Reset, also for the cut step: completing a task, or another task's step ("diary:task-progressed").
 *
 * Not here: the Golden helmet's lighting (it names the helmet, not a log), Piles, and Mandrith's
 * removal message. Logs fed to a Forester's Campfire DO count: tending emits firemaking:success
 * (Logs.Firemaking.js:584 -> :151). The gate and its fee are in areas/ResourceArea.plugin.js.
 */
const DIARY = "wilderness";
const DiaryProgress = require("./Progress.AchievementDiaries");
const DIARY_DATA = require("./Data.AchievementDiaries").BY_KEY.get(DIARY);
const ATTRIBUTE = "wilderness-diary:resource-area";
const AREA = { minX: 3174, maxX: 3197, minY: 3925, maxY: 3944 };
const TASKS = {
  helmet: "smith-a-golden-helmet-in-the-resource-area",
  scimitar: "smith-an-adamant-scimitar-in-the-resource-area",
  crab: "fish-and-cook-a-dark-crab-in-the-resource-area",
  logs: "cut-and-burn-some-magic-logs-in-the-resource-are",
  rune: "smith-a-rune-scimitar-from-scratch-in-the-resour",
};
const GOLEMS_NEEDED = 2;
const BARS_NEEDED = 2;

let api;

const credit = (player, task) => api.emitCustomEvent("diary:task", { player, diary: DIARY, task });

function inArea(player) {
  if ((player?.getPrivateArea?.() ?? null) !== null) return false;
  const location = player.getLocation();
  return location.getZ() === 0 && location.getX() >= AREA.minX && location.getX() <= AREA.maxX
    && location.getY() >= AREA.minY && location.getY() <= AREA.maxY;
}

function read(player) {
  const saved = player.getAttribute(ATTRIBUTE) ?? {};
  return {
    crab: saved.crab === true, cut: saved.cut === true,
    golems: Array.isArray(saved.golems) ? saved.golems : [], bars: Number(saved.bars) || 0,
  };
}

function write(player, state) {
  player.setAttribute(ATTRIBUTE, state);
}

function smithed({ player, itemId }) {
  if (!inArea(player)) return;
  if (itemId === api.core.ItemIdentifiers.RUNE_SCIMITAR) {
    const state = read(player);
    if (state.bars < BARS_NEEDED) return;
    write(player, { ...state, golems: [], bars: 0 });
    credit(player, TASKS.rune);
  } else if (itemId === api.core.ItemIdentifiers.ADAMANT_SCIMITAR) credit(player, TASKS.scimitar);
  else if (itemId === api.core.ItemIdentifiers.GOLD_HELMET) credit(player, TASKS.helmet);
}

/** A Runite Golem's rock mined. Mining's success fires for ore an infernal pickaxe destroys too (Wiki: it counts). */
function golemMined({ player, golem, killedIt }) {
  if (!killedIt || !inArea(player)) return;
  const state = read(player);
  if (state.golems.includes(golem)) return;
  write(player, { ...state, golems: [...state.golems, golem] });
  DiaryProgress.notifyTaskProgress(player, DIARY_DATA, TASKS.rune);
}

/** A furnace's bar: Superheat Item doesn't emit this. */
function smelted({ player, itemId }) {
  if (itemId !== api.core.ItemIdentifiers.RUNITE_BAR || !inArea(player)) return;
  const state = read(player);
  if (state.golems.length < GOLEMS_NEEDED || state.bars >= BARS_NEEDED) return;
  write(player, { ...state, bars: state.bars + 1 });
  DiaryProgress.notifyTaskProgress(player, DIARY_DATA, TASKS.rune);
}

function fished({ player, itemId }) {
  if (itemId !== api.core.ItemIdentifiers.RAW_DARK_CRAB || !inArea(player)) return;
  const state = read(player);
  if (state.crab) return;
  write(player, { ...state, crab: true });
  DiaryProgress.notifyTaskProgress(player, DIARY_DATA, TASKS.crab);
}

function cooked({ player, itemId }) {
  const state = read(player);
  if (itemId !== api.core.ItemIdentifiers.DARK_CRAB || !state.crab || !inArea(player)) return;
  write(player, { ...state, crab: false });
  credit(player, TASKS.crab);
}

function chopped({ player, logId, logAmount }) {
  if (logId !== api.core.ItemIdentifiers.MAGIC_LOGS || !(logAmount > 0) || !inArea(player)) return;
  const state = read(player);
  if (state.cut) return;
  write(player, { ...state, cut: true });
  DiaryProgress.notifyTaskProgress(player, DIARY_DATA, TASKS.logs);
}

function burnt({ player, itemId }) {
  const state = read(player);
  if (itemId !== api.core.ItemIdentifiers.MAGIC_LOGS || !state.cut || !inArea(player)) return;
  write(player, { ...state, cut: false });
  credit(player, TASKS.logs);
}

/** Another task of this diary newly completed between the cutting and the burning starts the pair again. */
function taskUpdated(request) {
  if (request.diary !== DIARY || request.completed !== true || request.player == null) return;
  const state = read(request.player);
  if (state.cut || state.golems.length > 0 || state.bars > 0) {
    write(request.player, { ...state, cut: false, golems: [], bars: 0 });
  }
}

/** Wiki: "Completing or updating any other task in-between these steps will reset the progress". */
function taskProgressed({ player, diary, task }) {
  if (diary !== DIARY || player == null) return;
  const state = read(player);
  const clearCut = task !== TASKS.logs && state.cut;
  const clearRune = task !== TASKS.rune && (state.golems.length > 0 || state.bars > 0);
  if (!clearCut && !clearRune) return;
  write(player, {
    ...state, cut: clearCut ? false : state.cut, golems: clearRune ? [] : state.golems, bars: clearRune ? 0 : state.bars,
  });
}

module.exports = {
  name: "WildernessResourceDiary",
  members: true,
  dependsOn: ["AchievementDiaries"],
  register(pluginApi) {
    api = pluginApi;
    api.persistAttribute(ATTRIBUTE, null);
    api.onCustomEvent("smithing:success", smithed);
    api.onCustomEvent("runite-golem:mined", golemMined);
    api.onCustomEvent("smelting:success", smelted);
    api.onCustomEvent("fishing:success", fished);
    api.onCustomEvent("cooking:success", cooked);
    api.onCustomEvent("woodcutting:success", chopped);
    api.onCustomEvent("firemaking:success", burnt);
    api.onCustomEvent("diary:task", taskUpdated);
    api.onCustomEvent("diary:task-progressed", taskProgressed);
  },
  _test: { inArea },
};
