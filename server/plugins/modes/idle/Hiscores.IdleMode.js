/**
 * Idle hiscores (plugins/modes/data/idle-mode.json "hiscores"): every idle account ranked by its
 * idle XP (gained idle, playing or away), the idle points it has earned (spent or not) and its
 * hours idle. An account's scores are kept current while it plays (`Common.onChange`) and stay on
 * the board while it is away. Player bots are left off.
 *
 * Kept in data/saves/idle-hiscores.json ({ username: { name, xp, points, hours, at } }, `at` when
 * the scores last changed: of two equal scores the one reached first ranks higher), written to a
 * temporary file, then renamed, at most every `saveEverySeconds`, on logout and on shutdown.
 * `IDLE_HISCORES_FILE` points it elsewhere (the tests).
 *
 * `::idle top [xp|points|hours]` lists the top in chat with the player's own place; the Idle
 * screen's Ranks tab shows them too (Screen).
 */
const fs = require("node:fs");
const path = require("node:path");
const Common = require("./Common.IdleMode");
const Offline = require("./Offline.IdleMode");
const Progression = require("./Progression.IdleMode");

const FILE_ENV = "IDLE_HISCORES_FILE";
const DEFAULT_FILE = path.join("data", "saves", "idle-hiscores.json");
const TICK_MS = 600;

/** username -> { name, xp, points, hours, at }; read once. */
let board = null;
let dirty = false;

function config() {
  return Common.data.hiscores;
}

function file() {
  return process.env[FILE_ENV] || path.join(process.cwd(), DEFAULT_FILE);
}

function entries() {
  if (board) return board;
  board = new Map();
  try {
    for (const [key, entry] of Object.entries(JSON.parse(fs.readFileSync(file(), "utf8")))) board.set(key, entry);
  } catch {
    // No board yet: it starts empty.
  }
  return board;
}

function save() {
  if (!dirty) return;
  const target = file();
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(`${target}.tmp`, JSON.stringify(Object.fromEntries(entries())));
    fs.renameSync(`${target}.tmp`, target);
    dirty = false;
  } catch (error) {
    console.warn("[idle-hiscores] could not save the hiscores", error);
  }
}

/** The player's scores now. */
function scores(player) {
  const { xp, workedMs, offlineMs } = Offline.totals(player);
  return { xp: Math.floor(xp), points: Progression.earned(player), hours: (workedMs + offlineMs) / 3600000 };
}

function keyOf(player) {
  return String(player.getUsername?.() ?? "").toLowerCase();
}

/** Puts the player's scores on the board (an idle account that isn't a bot). */
function update(player, now = Date.now()) {
  if (!config().enabled || !Common.isIdle(player) || player.isPlayerBot?.() === true) return;
  const key = keyOf(player);
  if (!key) return;
  const current = scores(player);
  const previous = entries().get(key);
  if (previous && previous.xp === current.xp && previous.points === current.points && previous.hours === current.hours) return;
  entries().set(key, { name: player.getUsername(), ...current, at: now });
  dirty = true;
}

function category(id) {
  return config().categories.find((entry) => entry.id === id) ?? config().categories[0];
}

/** The board for a category: [{ key, name, value }], best first. */
function ranking(id) {
  const { id: field } = category(id);
  return [...entries()]
    .filter(([, entry]) => entry[field] > 0)
    .sort(([, a], [, b]) => b[field] - a[field] || a.at - b.at)
    .map(([key, entry]) => ({ key, name: entry.name, value: entry[field] }));
}

function format(id, value) {
  const { unit } = category(id);
  const amount = id === "hours" ? (value < 10 ? value.toFixed(1) : Math.floor(value).toLocaleString("en-US")) : Math.floor(value).toLocaleString("en-US");
  return `${amount} ${unit}`;
}

/** The top `size` and the player's own place: { title, rows: [{ place, name, value, you }], you }. */
function lines(player, id, size = config().size) {
  update(player);
  const { id: field, name } = category(id);
  const board = ranking(field);
  const key = keyOf(player);
  const place = board.findIndex((row) => row.key === key) + 1;
  return {
    title: `Idle hiscores: ${name}`,
    rows: board.slice(0, size).map((row, index) => ({ place: index + 1, name: row.name, value: format(field, row.value), you: row.key === key })),
    you: place > 0 ? `You are #${place} of ${board.length}: ${format(field, board[place - 1].value)}.` : "You aren't on this board yet: work idle to get on it.",
  };
}

/** `::idle top [xp|points|hours]`. */
function topCommand(player, parts) {
  const { id } = category(String(parts[2] ?? "").toLowerCase());
  const { title, rows, you } = lines(player, id, config().chatSize);
  player.sendMessage(`<col=ff981f>${title}</col>`);
  if (rows.length === 0) player.sendMessage("Nobody is on it yet.");
  for (const row of rows) player.sendMessage(`${row.place}. ${row.name} - ${row.value}`);
  player.sendMessage(you);
  return true;
}

function changed(player) {
  update(player);
}

function logout({ player }) {
  update(player);
  save();
}

function startTask() {
  const { Task, TaskManager } = Common.core;
  const ticks = Math.max(1, Math.round((config().saveEverySeconds * 1000) / TICK_MS));
  TaskManager.submit(new (class IdleHiscoresSaveTask extends Task {
    constructor() { super(ticks); }
    execute() { save(); }
  })());
}

module.exports = function attach(api) {
  board = null;
  dirty = false;
  Common.onChange(changed);
  api.onPlayerLogout(logout);
  api.onServerStartup(startTask);
  api.onServerShutdown(save);
};

module.exports.COMMANDS = ["top", "hiscores", "ranks"];
module.exports.update = update;
module.exports.ranking = ranking;
module.exports.lines = lines;
module.exports.save = save;
module.exports.topCommand = topCommand;
module.exports.categories = () => config().categories;
