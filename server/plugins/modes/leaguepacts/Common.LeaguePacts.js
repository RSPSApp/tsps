/**
 * Shared by the LeaguePacts units: the data (data/league-pacts.json), the tree as the cache's
 * `talent_tree` table defines it (node index -> links and effect), a character's league
 * (LeagueMode's `league:profile`), its saved pacts, points and resets, the values its pacts give
 * each effect, and what the client is sent for them.
 */
const fs = require("fs");
const path = require("path");

/** The pacts bought: node indices in buying order. */
const PACTS_ATTRIBUTE = "league:pacts";
/** Pact points earned (the tutorial's, the pact tasks', Yama's extras). */
const POINTS_ATTRIBUTE = "league:pact-points";
/** Full resets left. */
const RESETS_ATTRIBUTE = "league:pact-resets";
/** One-off grants already given: { hueycoatl: true }. */
const REWARDS_ATTRIBUTE = "league:pact-rewards";

const BITS_PER_VARP = 32;

let api = null;
let core = null;
let data = null;
/** The nodes in index order: { index, row, links: [index], effect, value, varbit }. */
let nodes = [];
/** Effect varbit name -> varbit id. */
const effectVarbits = new Map();
/** Varp / varbit gameval names -> ids. */
const ids = { varps: {}, unlocked: [], varbits: {} };
/** Player -> whether it plays Demonic Pacts (isPacts). */
const leagueKnown = new WeakMap();
/** Player -> effect varbit name -> value, rebuilt when the pacts change. */
const effectCache = new WeakMap();

function init(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
  data = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "league-pacts.json"), "utf8"));
  resolveIds();
  loadNodes();
}

function varbitId(name) {
  const id = core.CacheDefinitions.getVarbitId(name);
  if (id === null) throw new Error(`league pacts: the cache has no varbit ${name}`);
  return id;
}

function varpId(name) {
  const id = core.CacheDefinitions.getVarpId(name);
  if (id === null) throw new Error(`league pacts: the cache has no varp ${name}`);
  return id;
}

function resolveIds() {
  ids.varps.earned = varpId(data.varps.earned);
  ids.varps.spent = varpId(data.varps.spent);
  ids.unlocked = data.varps.unlocked.map(varpId);
  for (const [key, name] of Object.entries(data.varbits)) ids.varbits[key] = varbitId(name);
  for (const name of Object.values(data.effects)) effectVarbits.set(name, varbitId(name));
}

/** The tree from the cache's `talent_tree` table, in row order (a node's index is its bit). */
function loadNodes() {
  const { CacheDefinitions } = core;
  const tableId = CacheDefinitions.getDbTableId(data.table.name);
  if (tableId === null) throw new Error(`league pacts: the cache has no ${data.table.name} table`);
  const column = (name) => {
    const id = CacheDefinitions.getDbColumn(tableId, name);
    if (id === null) throw new Error(`league pacts: ${data.table.name} has no ${name} column`);
    return id;
  };
  const linked = column(data.table.linked);
  const effect = column(data.table.effect);
  const rows = [...CacheDefinitions.getDbTableRows(tableId)].sort((a, b) => a.id - b.id);
  const indexOfRow = new Map(rows.map((row, index) => [row.id, index]));
  nodes = rows.map((row, index) => {
    const [effectId, value] = row.column(effect).map(Number);
    const varbit = data.effects[effectId];
    if (!varbit) throw new Error(`league pacts: node ${index} has effect ${effectId}, which the data does not map`);
    return {
      index, row: row.id, effect: effectId, value: value || 0, varbit,
      links: row.column(linked).map((id) => indexOfRow.get(Number(id))).filter((each) => each !== undefined),
    };
  });
  if (nodes.length > ids.unlocked.length * BITS_PER_VARP) throw new Error(`league pacts: ${nodes.length} nodes exceed the unlock varps`);
}

/** Whether the character plays the league the tree belongs to. */
/**
 * Whether the character plays the league the tree belongs to. A character's league is fixed once
 * it joins, and the effects ask on every roll, so the answer is kept per player for the session
 * (a login asks again).
 */
function isPacts(player) {
  if (!player) return false;
  const known = leagueKnown.get(player);
  if (known !== undefined) return known;
  const query = { player, league: null };
  api.emitCustomEvent("league:profile", query);
  const answer = query.league !== null && Number(query.league) === data.league;
  // Only a settled answer is kept: before the login names the league, ask again next time.
  if (query.league !== null) leagueKnown.set(player, answer);
  return answer;
}

/** Forgets the kept answer (a login: the profile may have changed since the last session). */
function forgetLeague(player) {
  leagueKnown.delete(player);
}

function list(player, key) {
  const value = player.getAttribute(key);
  return Array.isArray(value) ? value.map(Number).filter((index) => nodes[index] !== undefined) : [];
}

function pacts(player) {
  return list(player, PACTS_ATTRIBUTE);
}

function earned(player) {
  return Number(player.getAttribute(POINTS_ATTRIBUTE)) || 0;
}

function resets(player) {
  return Number(player.getAttribute(RESETS_ATTRIBUTE)) || 0;
}

function rewards(player) {
  const value = player.getAttribute(REWARDS_ATTRIBUTE);
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

/** Points the character may still spend: earned less spent, within the cap on spending. */
function spendable(player) {
  const spent = pacts(player).length;
  return Math.max(0, Math.min(earned(player), data.spendCap) - spent);
}

/** Effect varbit name -> the summed value of the character's pacts (only effects it has). */
function effects(player) {
  const cached = effectCache.get(player);
  if (cached) return cached;
  const values = new Map();
  for (const index of pacts(player)) {
    const node = nodes[index];
    values.set(node.varbit, (values.get(node.varbit) ?? 0) + node.value);
  }
  effectCache.set(player, values);
  return values;
}

/** The value the character's pacts give an effect (its varbit's gameval name), 0 for none or another league's character. */
function effect(player, varbit) {
  if (!player || !isPacts(player)) return 0;
  return effects(player).get(varbit) ?? 0;
}

function save(player, list) {
  player.setAttribute(PACTS_ATTRIBUTE, [...list]);
  effectCache.delete(player);
}

/** The unlock varps' values for a set of nodes (bit index % 32 of varp index / 32). */
function unlockBits(list) {
  const values = new Array(ids.unlocked.length).fill(0);
  for (const index of list) values[Math.floor(index / BITS_PER_VARP)] |= 1 << (index % BITS_PER_VARP);
  return values;
}

/** Everything the client reads for the tree: points, the unlock bits, each effect's value, the resets. */
function sendState(player) {
  const sender = player.getPacketSender();
  const owned = pacts(player);
  sender.sendConfig(ids.varps.earned, earned(player));
  sender.sendConfig(ids.varps.spent, owned.length);
  unlockBits(owned).forEach((value, slot) => sender.sendConfig(ids.unlocked[slot], value));
  const values = effects(player);
  for (const [name, id] of effectVarbits) sender.sendVarbit(id, values.get(name) ?? 0);
  sender.sendVarbit(ids.varbits.resets, resets(player));
  sender.sendVarbit(ids.varbits.freeReset, rewards(player).freeReset ? 1 : 0);
  sender.sendVarbit(ids.varbits.hueycoatlReset, rewards(player).hueycoatl ? 1 : 0);
}

function message(key, values = {}) {
  return data.messages[key].text.replace(/\{(\w+)\}/g, (match, name) => values[name] ?? match);
}

function uid(group, child) {
  return (group << 16) | child;
}

module.exports = {
  init, isPacts, forgetLeague, pacts, earned, resets, rewards, spendable, effects, effect, save, unlockBits, sendState, message, uid,
  PACTS_ATTRIBUTE, POINTS_ATTRIBUTE, RESETS_ATTRIBUTE, REWARDS_ATTRIBUTE,
  get nodes() { return nodes; },
  get ids() { return ids; },
  get effectVarbits() { return effectVarbits; },
  get data() { return data; },
  get api() { return api; },
  get core() { return core; },
};
