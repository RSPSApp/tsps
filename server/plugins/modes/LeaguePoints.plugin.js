/**
 * League Points (https://oldschool.runescape.wiki/w/League_Points): the sum of a league
 * character's completed tasks, never a counter of its own, so a save can't drift from its tasks.
 *
 *   api.emitCustomEvent("league:award-task", { player, id, points, name })  -> awarded (once per id)
 *   api.emitCustomEvent("league:points", { player })                        -> points, tasks
 *   api.emitCustomEvent("league:saved-points", { save })                    -> points, tasks
 *   api.emitCustomEvent("league:completed-tasks", { player })               -> ids (the task ids)
 *   "league:points-changed" { player, points, previous, tasks, previousTasks } after an award
 *
 * As captured (227/00070): an award raises league_total_tasks_completed (10046) and
 * league_points_completed (2614), then league_points_claimed (2615), and shows the
 * "League Task Complete!" popup with jingle 283 in the league's colour. Only a league character
 * (LeagueMode's `league:profile`) can hold tasks.
 */
const fs = require("fs");
const path = require("path");

/** Completed tasks: task id -> the points it paid. */
const TASKS_ATTRIBUTE = "league:tasks";

let api;
let data;

function leagueOf(player) {
  const query = { player, league: null };
  api.emitCustomEvent("league:profile", query);
  return query.league;
}

function tasksOf(player) {
  const tasks = player.getAttribute(TASKS_ATTRIBUTE);
  return tasks && typeof tasks === "object" && !Array.isArray(tasks) ? tasks : {};
}

function sum(tasks) {
  return Object.values(tasks).reduce((total, points) => total + (Number(points) || 0), 0);
}

function sendPoints(player, tasks) {
  const { varbits, varps } = data;
  const points = sum(tasks);
  const sender = player.getPacketSender();
  sender.sendVarbit(varbits.totalTasks, Object.keys(tasks).length);
  sender.sendConfig(varps.pointsCompleted, points);
  sender.sendConfig(varps.pointsClaimed, points);
  sender.sendConfig(varps.pointsPrevious, 0);
  return points;
}

function award(request) {
  if (!request) return;
  const { player } = request;
  const id = String(request.id ?? "").trim();
  const points = Number(request.points);
  request.awarded = false;
  const league = leagueOf(player);
  if (league === null || !id || !Number.isInteger(points) || points < 0) return;
  const tasks = tasksOf(player);
  if (tasks[id] !== undefined) return;
  const previous = sum(tasks);
  const updated = { ...tasks, [id]: points };
  player.setAttribute(TASKS_ATTRIBUTE, updated);
  const total = sendPoints(player, updated);
  request.awarded = true;
  const popup = data.notifications.taskComplete;
  api.emitCustomEvent("notification:show", {
    player,
    title: popup.title,
    text: popup.text.replace("{name}", String(request.name ?? id)).replace("{points}", String(points)),
    colour: data.leagues[league].colour,
    jingle: popup.jingle,
  });
  api.emitCustomEvent("league:points-changed", {
    player, points: total, previous, tasks: Object.keys(updated).length, previousTasks: Object.keys(tasks).length,
  });
}

function query(request) {
  const { player } = request ?? {};
  if (!player || leagueOf(player) === null) {
    if (request) { request.points = 0; request.tasks = 0; }
    return;
  }
  const tasks = tasksOf(player);
  request.points = sum(tasks);
  request.tasks = Object.keys(tasks).length;
}

/** The same totals from a league character's save while it is offline (the main game's records read them). */
function savedQuery(request) {
  if (!request) return;
  const tasks = request.save?.attributes?.[TASKS_ATTRIBUTE];
  const valid = tasks && typeof tasks === "object" && !Array.isArray(tasks) ? tasks : {};
  request.points = sum(valid);
  request.tasks = Object.keys(valid).length;
}

/** The completed task ids, for the task list's completion bits (LeagueTasks). */
function completedTasks(request) {
  if (!request) return;
  const { player } = request;
  request.ids = player && leagueOf(player) !== null ? Object.keys(tasksOf(player)) : [];
}

/** The totals the client shows come from the saved tasks every login. */
function login({ player }) {
  sendPoints(player, tasksOf(player));
}

module.exports = {
  name: "LeaguePoints",
  description: "Tracks League Points as the total of a league character's completed tasks, and announces awards and changes to the other league plugins.",
  members: true,
  dependsOn: ["LeagueMode"],
  register(pluginApi) {
    api = pluginApi;
    data = JSON.parse(fs.readFileSync(path.join(__dirname, "data", "leagues.json"), "utf8"));
    api.persistAttribute(TASKS_ATTRIBUTE, {});
    api.onCustomEvent("league:award-task", award);
    api.onCustomEvent("league:points", query);
    api.onCustomEvent("league:saved-points", savedQuery);
    api.onCustomEvent("league:completed-tasks", completedTasks);
    api.onCustomEvent("league:login", login);
  },
};
