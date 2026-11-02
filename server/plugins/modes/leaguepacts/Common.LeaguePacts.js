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
/** Pact points earned (the pact tasks', the tutorial's two among them). */
const POINTS_ATTRIBUTE = "league:pact-points";
/** Full resets left. */
const RESETS_ATTRIBUTE = "league:pact-resets";
/** One-off grants already given: { freeReset, secondFreeReset, hueycoatl, resetTasks: [task ids] }. */
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

/**
 * Everything the client reads for the tree, in the recorded login order (237/01170, 238/01223):
 * the points earned, the free resets' and the Hueycoatl's flags, the resets, the points spent, the
 * unlock bits, then each effect's value.
 */
function sendState(player) {
  const sender = player.getPacketSender();
  const owned = pacts(player);
  const given = rewards(player);
  sender.sendConfig(ids.varps.earned, earned(player));
  sender.sendVarbit(ids.varbits.freeReset, given.freeReset ? 1 : 0);
  sender.sendVarbit(ids.varbits.hueycoatlReset, given.hueycoatl ? 1 : 0);
  // A character that joined before the second flag was kept got both free resets at once.
  sender.sendVarbit(ids.varbits.secondFreeReset, (given.secondFreeReset ?? given.freeReset) ? 1 : 0);
  sender.sendVarbit(ids.varbits.resets, resets(player));
  sender.sendConfig(ids.varps.spent, owned.length);
  unlockBits(owned).forEach((value, slot) => sender.sendConfig(ids.unlocked[slot], value));
  const values = effects(player);
  for (const [name, id] of effectVarbits) sender.sendVarbit(id, values.get(name) ?? 0);
}

/** A shield, by name (the cache has no category plugins can read for it): shields, bucklers, wards, the Toktz-ket-xil, Dinh's bulwark. */
const SHIELD_NAME = /shield|buckler|\bward\b|toktz-ket-xil|bulwark/i;

function slotDefinition(player, slot) {
  const item = player?.getEquipment?.()?.getItems?.()[slot];
  const id = Number(item?.getId?.() ?? -1);
  return id > 0 ? core.ItemDefinition.forId(id) : null;
}

function isShield(definition) {
  return definition != null && SHIELD_NAME.test(definition.getName?.() ?? "");
}

/** A two-handed shield (Dinh's bulwark) wielded. */
function twoHandedShield(player) {
  const held = slotDefinition(player, core.Equipment.WEAPON_SLOT);
  return held !== null && held.isDoubleHanded() && isShield(held);
}

/** A shield worn: one in the shield slot, or a two-handed one wielded (Thorns, reflect). */
function hasShield(player) {
  return isShield(slotDefinition(player, core.Equipment.SHIELD_SLOT)) || twoHandedShield(player);
}

/**
 * An off-hand: a shield-slot item that is not a shield (a defender, a book). The block-heal pact
 * names "a two-handed shield or an off-hand", so a shield is not one; the off-hand pact reads it the same.
 */
function hasOffhand(player) {
  const offhand = slotDefinition(player, core.Equipment.SHIELD_SLOT);
  return offhand !== null && !isShield(offhand);
}

/**
 * Tiles between two footprints (adjacent 1, overlapping 0),
 * or Infinity when either has no tile or they stand on different planes. The pacts' distances.
 */
function distance(a, b) {
  const from = a?.getLocation?.();
  const to = b?.getLocation?.();
  if (!from || !to || from.getZ() !== to.getZ()) return Number.POSITIVE_INFINITY;
  const sizeA = Math.max(1, a.getSize?.() | 0);
  const sizeB = Math.max(1, b.getSize?.() | 0);
  return Math.max(0,
    to.getX() - (from.getX() + sizeA - 1), from.getX() - (to.getX() + sizeB - 1),
    to.getY() - (from.getY() + sizeA - 1), from.getY() - (to.getY() + sizeB - 1));
}

function message(key, values = {}) {
  return data.messages[key].text.replace(/\{(\w+)\}/g, (match, name) => values[name] ?? match);
}

function uid(group, child) {
  return (group << 16) | child;
}

module.exports = {
  init, isPacts, forgetLeague, distance, slotDefinition, isShield, twoHandedShield, hasShield, hasOffhand, pacts, earned, resets, rewards, spendable, effects, effect, save, unlockBits, sendState, message, uid,
  PACTS_ATTRIBUTE, POINTS_ATTRIBUTE, RESETS_ATTRIBUTE, REWARDS_ATTRIBUTE,
  get nodes() { return nodes; },
  get ids() { return ids; },
  get effectVarbits() { return effectVarbits; },
  get data() { return data; },
  get api() { return api; },
  get core() { return core; },
};
