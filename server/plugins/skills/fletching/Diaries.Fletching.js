/**
 * Achievement diary tasks done by fletching something in a place (data/fletching.json
 * diaryTasks, task keys from the diary data): an oak shortbow in the Gnome Stronghold and a magic
 * longbow in Tirannwn (Western Provinces), dragon darts at the Bedabin Camp (Desert), a maple
 * shortbow inside the Seers' Village bank (Kandarin: its hall and doorway on the ground floor).
 */
const Shared = require("./Shared.Fletching");
const DATA = require("../data/fletching.json");

let api = null;
let tasks = [];

// An area is [minX, maxX, minY, maxY] on any plane, or [minX, maxX, minY, maxY, z] on one plane.
function inside(location, [minX, maxX, minY, maxY, z]) {
  const x = location.getX();
  const y = location.getY();
  if (z !== undefined && location.getZ() !== z) return false;
  return x >= minX && x <= maxX && y >= minY && y <= maxY;
}

function made({ player, itemId }) {
  const location = player.getLocation();
  for (const task of tasks) {
    if (!task.itemIds.has(itemId) || !task.areas.some((area) => inside(location, area))) continue;
    api.emitCustomEvent("diary:task", { player, diary: task.diary, task: task.task });
  }
}

function init(pluginApi) {
  api = pluginApi;
  tasks = DATA.diaryTasks.map((task) => ({ ...task, itemIds: new Set(task.items.map(Shared.itemId)) }));
}

function attach(pluginApi) {
  pluginApi.onCustomEvent("fletching:made", made);
}

module.exports = { init, attach };
