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
  clans = new Map();
  let saved;
  try {
    saved = JSON.parse(fs.readFileSync(file(), "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return clans;
  }
  nextKey = saved.nextKey;
  for (const clan of saved.clans) clans.set(clan.key, clan);
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

module.exports = { create, byName, byMember, save, reset };
