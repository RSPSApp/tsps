/**
 * Achievement diary tasks done by fletching something in a place (data/fletching.json
 * diaryTasks, task keys from the diary data): an oak shortbow in the Gnome Stronghold and a magic
 * longbow in Tirannwn (Western Provinces), dragon darts at the Bedabin Camp (Desert).
 */
const Shared = require("./Shared.Fletching");
const DATA = require("../data/fletching.json");

let api = null;
let tasks = [];

function inside(location, [minX, maxX, minY, maxY]) {
  const x = location.getX();
  const y = location.getY();
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
