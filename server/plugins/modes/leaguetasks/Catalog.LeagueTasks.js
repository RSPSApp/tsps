/**
 * The task catalog the client draws. The list interface reads its rows from the cache's task enum
 * (position -> a row of the `action` DB table) and a tier's points from the points enum, but the
 * cache only carries the current league's, so this answers LeagueMode's `league:content-rows` with a
 * league's own enum rows and DB rows (sent with the other units' as one enumOverrides /
 * dbRowOverrides payload at login and before the list opens). A task's position in the enum is its
 * completion bit (Complete.LeagueTasks). The league the cache carries (`fromCache`, Demonic Pacts)
 * needs none: its catalog is the cache's own list.
 */
const Common = require("./Common.LeagueTasks");

function enumRows(type) {
  const { taskEnum, pointsEnum } = Common.data;
  const { tasks } = Common.catalog(type);
  const points = new Map();
  for (const task of tasks) points.set(task.tier, task.points);
  return [
    { enumId: taskEnum, valueType: "J", defaultValue: -1, entries: tasks.map((task) => [task.index, Common.rowId(type, task.index)]) },
    { enumId: pointsEnum, valueType: "i", defaultValue: 0, entries: [...points.entries()].sort((a, b) => a[0] - b[0]) },
  ];
}

function dbRows(type) {
  const { table, columns } = Common.data;
  return Common.catalog(type).tasks.map((task) => ({
    rowId: Common.rowId(type, task.index),
    tableId: table,
    columns: {
      [columns.name]: [task.name],
      [columns.description]: [task.description],
      [columns.difficulty]: [task.tier],
      [columns.inCurrentLeague]: [1],
      [columns.category]: [task.category],
      [columns.area]: [task.area],
    },
  }));
}

/** `league:content-rows` { league, enums, dbRows }: this league's task list. */
function content(query) {
  const type = query?.league;
  const catalog = Common.catalog(type);
  if (!catalog || catalog.fromCache) return;
  query.enums.push(...enumRows(type));
  query.dbRows.push(...dbRows(type));
}

module.exports = function attach(api) {
  api.onCustomEvent("league:content-rows", content);
};
