/** The clans on disk, written whole on every change: there are few of them and they rarely change. */

const fs = require("fs");
const path = require("path");

const FILE_ENV = "TSPS_CLANS_FILE";
const DEFAULT_FILE = path.join("data", "saves", "clans.json");

let clans = null;
let nextKey = 1;

function file() {
  return process.env[FILE_ENV] || path.join(process.cwd(), DEFAULT_FILE);
}

function load() {
  if (clans) return clans;
  const loaded = new Map();
  let saved;
  try {
    saved = JSON.parse(fs.readFileSync(file(), "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    clans = loaded;
    return clans;
  }
  for (const clan of saved.clans) loaded.set(clan.key, clan);
  // Only once it has all been read: a file that can't be keeps throwing, so save() can't replace it.
  clans = loaded;
  nextKey = saved.nextKey;
  return clans;
}

function save() {
  const target = file();
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temporary = `${target}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify({ nextKey, clans: [...load().values()] }, null, 2));
  fs.renameSync(temporary, target);
}

function create(fields) {
  load();
  const clan = { key: nextKey++, ...fields };
  clans.set(clan.key, clan);
  save();
  return clan;
}

function remove(clan) {
  load().delete(clan.key);
  save();
}

function all() {
  return load().values();
}

function byName(name) {
  const wanted = name.toLowerCase();
  for (const clan of all()) if (clan.name.toLowerCase() === wanted) return clan;
  return undefined;
}

function byMember(account) {
  for (const clan of all()) if (clan.members.some((member) => member.account === account)) return clan;
  return undefined;
}

/** Forgets what is in memory, so tests can read the file again as a restart would. */
function reset() {
  clans = null;
  nextKey = 1;
}

module.exports = { all, create, remove, byName, byMember, save, reset };
