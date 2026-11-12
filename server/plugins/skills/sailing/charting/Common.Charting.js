// What the sea charting units share (docs/sea-charting.md): the spots and seas from the cache, each
// player's saved charts, the variables the client draws the Captain's log and the rapids from, and
// the one way every kind of spot is charted (complete).
//   Spots: cache DB table 154 (sailing_charting_core, 358 rows): unique_id, hint (the task),
//   sailing_sea, sailing_sea_secondary, give_repeat_xp (current ducks), charting_type (the type's
//   table, 155-160). Seas: table 201 (sailing_sea): unique_id, ocean_id, name, type (0 sea,
//   1 ocean, 2 bonus group, 3 the Miscellaneous groups' "ocean"), ocean, required_level, xp_level,
//   has_charting_rapids. Per spot, data/charting.json adds what the cache leaves out.
const DATA = require("../data/charting.json");

const CORE_TABLE = 154;
const SEA_TABLE = 201;
const TYPES = Object.freeze({
  155: "generic",
  156: "spyglass",
  157: "current_duck",
  158: "drink_crate",
  159: "weather_troll",
  160: "mermaid_guide",
});
const SEA_TYPE = Object.freeze({ SEA: 0, OCEAN: 1, GROUP: 2, MISCELLANEOUS: 3 });

/** A player's charts (persisted): the spots' unique ids, and the oceans whose bonus is owed or paid. */
const PROGRESS_ATTRIBUTE = "charting:progress";

/** sailing_charting_completion_0..11: spot uid n is bit n & 31 of varp 5016 + (n >> 5) (script 9004). */
const VARP_SPOTS = 5016;
const SPOT_WORDS = 12;
/** sailing_charting_sea_completion_0..2 and sea_ever_complete_0..2, interleaved: sea uid n is bit n & 31. */
const VARP_SEA_COMPLETE = 5028;
const VARP_SEA_EVER_COMPLETE = 5029;
const SEA_WORDS = 3;
/** sailing_charting_sea_xp_owed_0: bit = an ocean's ocean_id (the bonus Chartin' Charles pays out). */
const VARP_XP_OWED = 5034;
const VARP_TOTAL_ENTRIES = 5037;

const VARBIT = Object.freeze({
  FULL_COMPLETION: 18564,
  FULL_COMPLETION_EVER: 18565,
  FULL_COMPLETION_XP_OWED: 18571,
});

const SOUND_CHARTED = 11166;
const NOTIFICATION_TITLE = "Charting Complete!";
/** settings_sailing_charting_popup: All Settings "Charting popups" off. */
const POPUP_DISABLED_VARBIT = 18142;

let core;
let pluginApi;
let spots;
let seas;

function init(api) {
  core = api.core;
  pluginApi = api;
}

function api() {
  return pluginApi;
}

function coreApi() {
  return core;
}

function blue(text) {
  return `<col=0090bc>${text}</col>`;
}

/** The seas, oceans and groups by their DB row id, each with its ocean and spot counts filled in. */
function allSeas() {
  if (seas) return seas;
  const definitions = core.CacheDefinitions;
  const column = (name) => definitions.getDbColumn(SEA_TABLE, name);
  const cols = Object.fromEntries(["unique_id", "ocean_id", "name", "type", "ocean", "required_level", "xp_level",
    "has_charting_rapids"].map((name) => [name, column(name)]));
  seas = new Map();
  for (const row of definitions.getDbTableRows(SEA_TABLE)) {
    const rowName = definitions.getDbRowName(row.id) ?? "";
    seas.set(row.id, {
      row: row.id,
      uid: row.int(cols.unique_id, -1),
      oceanId: row.int(cols.ocean_id, -1),
      key: rowName.replace(/^sailing_sea_/, ""),
      varbitPrefix: rowName,
      name: row.string(cols.name) ?? "",
      type: row.int(cols.type, SEA_TYPE.SEA),
      oceanRow: row.int(cols.ocean, -1),
      level: row.int(cols.required_level, 1),
      xpLevel: row.int(cols.xp_level, -1),
      rapids: row.int(cols.has_charting_rapids, 0) === 1,
      spots: [],
    });
  }
  for (const sea of seas.values()) sea.ocean = seas.get(sea.oceanRow) ?? null;
  return seas;
}

/** Every spot, by unique id: `{ uid, key, type, hint, sea, secondarySea, repeatXp, ...data }`. */
function allSpots() {
  if (spots) return spots;
  const definitions = core.CacheDefinitions;
  const column = (name) => definitions.getDbColumn(CORE_TABLE, name);
  const cols = Object.fromEntries(["unique_id", "hint", "sailing_sea", "sailing_sea_secondary", "give_repeat_xp",
    "charting_type"].map((name) => [name, column(name)]));
  const seaRows = allSeas();
  spots = new Map();
  for (const row of definitions.getDbTableRows(CORE_TABLE)) {
    const key = (definitions.getDbRowName(row.id) ?? "").replace(/^sailing_charting_/, "").replace(/_core$/, "");
    const sea = seaRows.get(row.int(cols.sailing_sea, -1)) ?? null;
    const spot = {
      ...(DATA.spots[key] ?? {}),
      uid: row.int(cols.unique_id, -1),
      key,
      type: TYPES[row.int(cols.charting_type, -1)] ?? "generic",
      hint: row.string(cols.hint) ?? "",
      sea,
      secondarySea: seaRows.get(row.int(cols.sailing_sea_secondary, -1)) ?? null,
      repeatXp: row.int(cols.give_repeat_xp, 0) === 1,
    };
    spots.set(spot.uid, spot);
    sea?.spots.push(spot);
  }
  return spots;
}

function spotByKey(key) {
  for (const spot of allSpots().values()) if (spot.key === key) return spot;
  return undefined;
}

function spotsOfType(type) {
  return [...allSpots().values()].filter((spot) => spot.type === type);
}

/** The spots charted towards an ocean (or the Miscellaneous groups): those of its seas. */
function oceanSpots(ocean) {
  return [...allSeas().values()].filter((sea) => sea.ocean === ocean).flatMap((sea) => sea.spots);
}

function progress(player) {
  const saved = player.getAttribute(PROGRESS_ATTRIBUTE);
  return {
    charted: Array.isArray(saved?.charted) ? saved.charted : [],
    owed: Array.isArray(saved?.owed) ? saved.owed : [],
    paid: Array.isArray(saved?.paid) ? saved.paid : [],
    fullOwed: saved?.fullOwed === true,
    fullPaid: saved?.fullPaid === true,
  };
}

function updateProgress(player, change) {
  const next = progress(player);
  change(next);
  player.setAttribute(PROGRESS_ATTRIBUTE, next);
  return next;
}

function chartedSet(player) {
  return new Set(progress(player).charted);
}

function isCharted(player, spot) {
  return chartedSet(player).has(spot.uid);
}

function countCharted(charted, list) {
  return list.reduce((count, spot) => count + (charted.has(spot.uid) ? 1 : 0), 0);
}

function seaComplete(charted, sea) {
  return sea.spots.length > 0 && sea.spots.every((spot) => charted.has(spot.uid));
}

function oceanComplete(charted, ocean) {
  const list = oceanSpots(ocean);
  return list.length > 0 && list.every((spot) => charted.has(spot.uid));
}

function words(count, bits) {
  const out = new Array(count).fill(0);
  for (const bit of bits) if (bit >= 0 && bit < count * 32) out[bit >> 5] |= 1 << (bit & 31);
  return out;
}

/** The saved charts as the client's variables: spots, seas, oceans, owed bonuses, the entry count. */
function sendProgress(player) {
  const sender = player.getPacketSender();
  const saved = progress(player);
  const charted = new Set(saved.charted);
  // Bits a quest set before this plugin's login hook ran (Current Affairs, Prying Times) are kept.
  words(SPOT_WORDS, charted).forEach((word, i) => sender.sendConfig(VARP_SPOTS + i, word | sender.getVarp(VARP_SPOTS + i)));
  const complete = [];
  const ever = [];
  for (const sea of allSeas().values()) {
    const done = sea.type === SEA_TYPE.SEA || sea.type === SEA_TYPE.GROUP ? seaComplete(charted, sea) : oceanComplete(charted, sea);
    if (!done) continue;
    complete.push(sea.uid);
    if (sea.type === SEA_TYPE.OCEAN || sea.type === SEA_TYPE.MISCELLANEOUS) ever.push(sea.uid);
  }
  words(SEA_WORDS, complete).forEach((word, i) => sender.sendConfig(VARP_SEA_COMPLETE + i * 2, word));
  words(SEA_WORDS, ever).forEach((word, i) => sender.sendConfig(VARP_SEA_EVER_COMPLETE + i * 2, word));
  const owedOceans = saved.owed.map((row) => allSeas().get(row)?.oceanId ?? -1);
  sender.sendConfig(VARP_XP_OWED, words(1, owedOceans)[0]);
  const full = charted.size >= allSpots().size;
  sender.sendVarbit(VARBIT.FULL_COMPLETION, full ? 1 : 0);
  sender.sendVarbit(VARBIT.FULL_COMPLETION_EVER, full ? 1 : 0);
  sender.sendVarbit(VARBIT.FULL_COMPLETION_XP_OWED, saved.fullOwed && !saved.fullPaid ? 1 : 0);
  sender.sendConfig(VARP_TOTAL_ENTRIES, charted.size);
}

function setSpotBit(player, spot) {
  const sender = player.getPacketSender();
  const varp = VARP_SPOTS + (spot.uid >> 5);
  sender.sendConfig(varp, sender.getVarp(varp) | (1 << (spot.uid & 31)));
}

function setSeaBit(player, sea, ever) {
  const sender = player.getPacketSender();
  const varp = (ever ? VARP_SEA_EVER_COMPLETE : VARP_SEA_COMPLETE) + (sea.uid >> 5) * 2;
  sender.sendConfig(varp, sender.getVarp(varp) | (1 << (sea.uid & 31)));
}

/** The bonus for fully charting a sea or a group, by its XP level (the Wiki's table; rsprox agrees). */
function seaBonusXp(sea) {
  const level = sea.xpLevel > 0 ? sea.xpLevel : sea.level;
  const levels = Object.keys(DATA.seaBonusXp).map(Number).sort((a, b) => a - b);
  const at = levels.filter((each) => each <= level).pop() ?? levels[0];
  return DATA.seaBonusXp[String(at)] ?? 0;
}

function xpFor(spot) {
  return DATA.xp[spot.type] ?? 0;
}

function addXp(player, xp) {
  if (xp > 0) player.getSkillManager().addExperiences(core.Skill.SAILING, xp);
}

/**
 * Charts a spot, as every kind of spot does on success (rsprox, e.g. 1009, 944): its variable, the
 * task, the sea's and ocean's counts, then a sea, group, ocean or the whole map completed with its
 * messages and the sea's bonus XP; the popups, the sound and the spot's XP. A spot already charted
 * gives only a current duck's repeat XP. `lines` are the spot's own messages, sent first.
 */
function complete(player, spot, { lines = spot.flavour ?? [], xp = xpFor(spot) } = {}) {
  const before = chartedSet(player);
  if (before.has(spot.uid)) {
    for (const line of lines) player.sendMessage(line);
    if (spot.repeatXp) addXp(player, xp);
    return false;
  }
  updateProgress(player, (saved) => { saved.charted = [...saved.charted, spot.uid].sort((a, b) => a - b); });
  const charted = chartedSet(player);
  const sender = player.getPacketSender();
  for (const line of lines) player.sendMessage(line);
  setSpotBit(player, spot);
  sender.sendConfig(VARP_TOTAL_ENTRIES, charted.size);
  player.sendMessage(`Charting complete: ${blue(spot.hint)}`);
  const sea = spot.sea;
  const ocean = sea?.ocean;
  if (sea) player.sendMessage(`${sea.name} charting completion: ${blue(`${countCharted(charted, sea.spots)}/${sea.spots.length}`)}`);
  if (ocean) {
    const list = oceanSpots(ocean);
    player.sendMessage(`${ocean.name} charting completion: ${blue(`${countCharted(charted, list)}/${list.length}`)}`);
  }
  let bonus = 0;
  const completed = [];
  if (sea && seaComplete(charted, sea)) {
    const group = sea.type === SEA_TYPE.GROUP;
    player.sendMessage(`You have completed charting ${group ? "a group" : "a sea"}: ${blue(sea.name)}`);
    if (sea.rapids) player.sendMessage(`Fully charting this sea has unlocked the use of some ${blue("rapids")} within it.`);
    bonus = seaBonusXp(sea);
    player.sendMessage(`You are awarded an additional ${blue(bonus.toLocaleString("en-US"))} Sailing XP.`);
    setSeaBit(player, sea, false);
    completed.push(sea.name);
  }
  if (ocean && oceanComplete(charted, ocean)) {
    // The Miscellaneous groups' "ocean" is called a group in its lines.
    const [kind, article] = ocean.type === SEA_TYPE.MISCELLANEOUS ? ["group", "a"] : ["ocean", "an"];
    player.sendMessage(`You have completed charting ${article} ${kind}: ${blue(ocean.name)}`);
    setSeaBit(player, ocean, true);
    updateProgress(player, (saved) => {
      if (!saved.owed.includes(ocean.row) && !saved.paid.includes(ocean.row)) saved.owed = [...saved.owed, ocean.row];
    });
    sender.sendConfig(VARP_XP_OWED, sender.getVarp(VARP_XP_OWED) | (1 << ocean.oceanId));
    player.sendMessage(`For fully charting this ${kind}, Chartin' Charles McAtless on the Pandemonium will provide you with some training when you next speak to him.`);
    setSeaBit(player, ocean, false);
    completed.push(ocean.name);
  }
  const every = allSpots();
  if (countCharted(charted, [...every.values()]) === every.size) {
    updateProgress(player, (saved) => { saved.fullOwed = !saved.fullPaid; });
    sender.sendVarbit(VARBIT.FULL_COMPLETION, 1);
    // Live leaves this colour tag open.
    player.sendMessage("<col=0090bc>You have fully charted the entire sea!");
    player.sendMessage("For fully charting the entire sea, Chartin' Charles McAtless on the Pandemonium will provide you with some final training when you next speak to him.");
    sender.sendVarbit(VARBIT.FULL_COMPLETION_XP_OWED, 1);
    sender.sendVarbit(VARBIT.FULL_COMPLETION_EVER, 1);
    completed.push("Entire sea");
  }
  // The spot's popup, then one per sea, group or ocean it completed, queued one after another.
  if (sender.getVarbit(POPUP_DISABLED_VARBIT) !== 1) {
    for (const text of [spot.hint, ...completed.map((name) => `${name} fully charted!`)]) {
      pluginApi.emitCustomEvent("notification:show", { player, title: NOTIFICATION_TITLE, text });
    }
  }
  sender.sendSoundEffect(SOUND_CHARTED, 1, 0);
  addXp(player, xp + bonus);
  pluginApi.emitCustomEvent("charting:complete", { player, spot: spot.key, uid: spot.uid, type: spot.type });
  return true;
}

/**
 * Marks a task charted without its messages or XP: one charted before these charts were kept (a
 * quest's own flag), sent to the client as it is.
 */
function mark(player, spot) {
  if (isCharted(player, spot)) return;
  updateProgress(player, (saved) => { saved.charted = [...saved.charted, spot.uid].sort((a, b) => a - b); });
  setSpotBit(player, spot);
  player.getPacketSender().sendConfig(VARP_TOTAL_ENTRIES, chartedSet(player).size);
}

/**
 * Releases the helm for a charting action. True when the player was at it: live then answers a
 * tick later (rsprox 1009: the helm on the click, the charting the next tick).
 */
function leaveHelm(player) {
  const event = { player, left: false };
  pluginApi.emitCustomEvent("sailing:leave-helm", event);
  return event.left === true;
}

/** Runs `action` now, or on the next tick when the player just let go of the helm. */
function afterHelm(player, action) {
  if (!leaveHelm(player)) {
    action();
    return;
  }
  // Keyed to the player, so a click in between cancels it, as it does live.
  core.TaskManager.submit(new core.CountdownTask(player, 1, () => player.isRegistered?.() !== false && action()));
}

module.exports = {
  init,
  api,
  core: coreApi,
  blue,
  allSeas,
  allSpots,
  spotByKey,
  spotsOfType,
  oceanSpots,
  progress,
  updateProgress,
  isCharted,
  sendProgress,
  complete,
  mark,
  seaBonusXp,
  xpFor,
  addXp,
  leaveHelm,
  afterHelm,
  DATA,
  SEA_TYPE,
  PROGRESS_ATTRIBUTE,
  VARP_SPOTS,
};
