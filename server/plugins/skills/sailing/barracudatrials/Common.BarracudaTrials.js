// What the Barracuda Trials units share (docs/barracuda-trials.md): the trials' data, their ranks
// from the cache, the variables the client draws them from, each player's saved progress, the
// runs in progress and the cache map's locs in each trial's area.
//   Ranks (cache DB table 143, column 22): per rank, unranked to Marlin, the time limit in ticks
//   (0 when unranked), the objectives (rum, jubblies or crystals), the lost supplies, the first
//   completion's bonus XP and the trial's XP, both in tenths. Columns 23-25: the rank rewards.
const DATA = require("../data/barracuda-trials.json");

const RANKS = DATA.ranks;
const RANK_KEYS = ["unranked", "swordfish", "shark", "marlin"];
const PROGRESS_ATTRIBUTE = "barracuda-trials:progress";
/** One tick: the client's timer counts 0.6 seconds a tick from these. */
const TICK_MS = 600;

const COLUMN_RANKS = 22;
const COLUMN_REWARDS = [23, 24, 25];

let core;
let pluginApi;
const trials = DATA.trials;
const byKey = new Map(trials.map((trial) => [trial.key, trial]));
/** Players in a trial: player -> run (Run.BarracudaTrials.js). */
const runs = new Map();
const locCache = new Map();

function init(api) {
  core = api.core;
  pluginApi = api;
}

function api() {
  return pluginApi;
}

const varbitIds = new Map();
function varbit(name) {
  if (!varbitIds.has(name)) varbitIds.set(name, core.CacheDefinitions.getVarbitId(name));
  const id = varbitIds.get(name);
  if (id === null || id === undefined) throw new Error(`no varbit ${name}`);
  return id;
}

function varp(name) {
  const id = core.CacheDefinitions.getVarpId(name);
  if (id === null || id === undefined) throw new Error(`no varp ${name}`);
  return id;
}

/** The trial's own variable, e.g. `sailing_bt_tempor_tantrum_master_state`. */
function trialVarbit(trial, suffix) {
  return varbit(`sailing_bt_${trial.key}_${suffix}`);
}

/**
 * A trial's ranks, unranked first: `{ limitTicks, objectives, supplies, bonusXp, xp, reward }`
 * (XP whole; the cache keeps tenths).
 */
function ranksOf(trial) {
  if (trial.ranks) return trial.ranks;
  const row = core.CacheDefinitions.getDbRow(trial.dbrow);
  const flat = (row?.column(COLUMN_RANKS) ?? []).map(Number);
  trial.ranks = RANKS.map((name, rank) => {
    const [limitTicks, objectives, supplies, bonusXp, xp] = flat.slice(rank * 5, rank * 5 + 5);
    const reward = rank > 0 ? Number(row?.column(COLUMN_REWARDS[rank - 1])?.[0] ?? -1) : -1;
    return { rank, name, key: RANK_KEYS[rank], limitTicks, objectives, supplies, bonusXp: bonusXp / 10, xp: xp / 10, reward };
  });
  return trial.ranks;
}

function trialByKey(key) {
  return byKey.get(key);
}

function trialByMaster(npcId) {
  return trials.find((trial) => trial.master.npc === npcId || masterForms(trial).includes(npcId));
}

/** A master's multinpc forms: before the intro (1 op), ready (3 ops), during a run (no ops). */
function masterForms(trial) {
  const parent = trial.master.npc;
  return [parent + 1, parent + 2, parent + 3];
}

/** A player's saved trial progress (persisted). */
function progress(player) {
  const saved = player.getAttribute(PROGRESS_ATTRIBUTE);
  return saved && typeof saved === "object" ? saved : {};
}

function trialProgress(player, trial) {
  const saved = progress(player)[trial.key] ?? {};
  return {
    intro: saved.intro === true,
    count: saved.count ?? 0,
    firsts: saved.firsts ?? [false, false, false],
    pbs: saved.pbs ?? [0, 0, 0],
    previous: saved.previous ?? 0,
    ...saved.extra && { extra: saved.extra },
  };
}

function updateProgress(player, trial, change) {
  const all = { ...progress(player) };
  const next = trialProgress(player, trial);
  change(next);
  all[trial.key] = next;
  player.setAttribute(PROGRESS_ATTRIBUTE, all);
  return next;
}

/** Whether the player has beaten a rank (1 Swordfish to 3 Marlin); unranked is always open. */
function rankBeaten(player, trial, rank) {
  return rank <= 0 || trialProgress(player, trial).firsts[rank - 1] === true;
}

function masterState(player, trial) {
  if (runs.get(player)?.trial === trial) return 2;
  return trialProgress(player, trial).intro ? 1 : 0;
}

/** All Settings' "Disable colourful fade effects" row (varbit settings_colourful_fade_disabled). */
const COLOURFUL_FADE_SETTING = 460;

/** A trial's own "effects off" flag, saved before the row existed, moves into that setting once. */
function migrateEffectsOff(player) {
  const legacy = trials.filter((trial) => trialProgress(player, trial).extra?.effectsOff);
  if (!legacy.length) return;
  for (const trial of legacy) {
    updateProgress(player, trial, (saved) => {
      const { effectsOff, ...extra } = saved.extra;
      saved.extra = extra;
    });
  }
  pluginApi.emitCustomEvent("settings:set", { player, settingId: COLOURFUL_FADE_SETTING, value: 1 });
}

/** The saved progress as the client's variables: masters' forms, ranks reached, bests, counts. */
function sendProgress(player) {
  const sender = player.getPacketSender();
  let intro = false;
  for (const trial of trials) {
    const saved = trialProgress(player, trial);
    intro ||= saved.intro;
    sender.sendVarbit(trialVarbit(trial, "master_state"), masterState(player, trial));
    sender.sendVarbit(trialVarbit(trial, "previous_attempt"), saved.previous);
    RANK_KEYS.slice(1).forEach((key, i) => {
      sender.sendVarbit(trialVarbit(trial, `${key}_first`), saved.firsts[i] ? 1 : 0);
      sender.sendVarbit(trialVarbit(trial, `pb_${key}`), saved.pbs[i]);
    });
    sender.sendConfig(varp(`sailing_bt_trial_${trial.key}_completed`), saved.count);
  }
  sender.sendVarbit(varbit("sailing_bt_barracuda_intro"), intro ? 1 : 0);
  migrateEffectsOff(player);
  const tempor = trials.find((trial) => trial.key === "tempor_tantrum");
  if (tempor && trialProgress(player, tempor).extra?.whirlpool) {
    sender.sendVarbit(varbit("sailing_bt_tempor_tantrum_collected_whirlpool_surprise"), 1);
  }
  // Live sends the trial data -1 at login (rsprox 3579).
  sender.sendConfig(varp("sailing_bt_trial_data_if"), -1);
}

/** The server tick: the base of the trial timer's varps and of the HUD's clock (script 8605). */
function clock() {
  return core.World.processCycle | 0;
}

/** "4:28.80": ticks as the completion message and the scoreboard show them. */
function formatTicks(ticks) {
  const hundredths = Math.round((ticks * TICK_MS) / 10);
  const minutes = Math.floor(hundredths / 6000);
  const seconds = Math.floor((hundredths % 6000) / 100);
  const fraction = hundredths % 100;
  return `${minutes}:${String(seconds).padStart(2, "0")}.${String(fraction).padStart(2, "0")}`;
}

const NUMBER_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];
/** Small counts spelt out, as the trials' messages have them ("You collect four balloon toads."). */
function numberWord(count) {
  return NUMBER_WORDS[count] ?? String(count);
}

function blue(text) {
  return `<col=0090bc>${text}</col>`;
}

/**
 * The cache map's locs in a trial's area with ids in `ids` (a Set): the lost supplies, rapids,
 * fetid pools, portals, motes. Read once per trial and id set.
 */
function mapLocs(trial, name, ids) {
  const key = `${trial.key}:${name}`;
  if (locCache.has(key)) return locCache.get(key);
  const { minX, maxX, minY, maxY } = trial.bounds;
  const found = [];
  for (let regionX = minX >> 6; regionX <= maxX >> 6; regionX++) {
    for (let regionY = minY >> 6; regionY <= maxY >> 6; regionY++) {
      const region = core.readTemplateRegion((regionX << 8) | regionY);
      for (const chunk of region?.chunks ?? []) {
        for (const loc of chunk ?? []) {
          if (loc.plane !== 0 || !ids.has(loc.id)) continue;
          const x = (regionX << 6) + loc.localX;
          const y = (regionY << 6) + loc.localY;
          if (x < minX || x > maxX || y < minY || y > maxY) continue;
          const definition = core.CacheDefinitions.getObject(loc.id);
          const turned = (loc.face & 1) === 1;
          const sizeX = (turned ? definition?.sizeY : definition?.sizeX) ?? 1;
          const sizeY = (turned ? definition?.sizeX : definition?.sizeY) ?? 1;
          found.push({ id: loc.id, x, y, sizeX, sizeY, type: loc.type, face: loc.face });
        }
      }
    }
  }
  locCache.set(key, found);
  return found;
}

/** Whether a tile lies on a loc's footprint (its south-west tile and size). */
function onLoc(loc, x, y) {
  return x >= loc.x && x < loc.x + loc.sizeX && y >= loc.y && y < loc.y + loc.sizeY;
}

/** The trial's lost supplies: objective k's crate is the k-th collectable loc, wherever the map has it. */
function crateTiles(trial) {
  const { first, count } = trial.collectables;
  const ids = new Set(Array.from({ length: count }, (_, k) => first + k));
  const tiles = new Array(count);
  for (const loc of mapLocs(trial, "collectables", ids)) tiles[loc.id - first] = { x: loc.x, y: loc.y };
  return tiles;
}

/** A run's start or end: whatever the courses put on the boat's speed goes. */
function clearSpeed(boat) {
  boat.speedBonuses.clear();
  boat.burstBonuses.clear();
  boat.speedLimits.clear();
}

function inBounds(trial, x, y) {
  const { minX, maxX, minY, maxY } = trial.bounds;
  return x >= minX && x <= maxX && y >= minY && y <= maxY;
}

module.exports = {
  clearSpeed,
  DATA,
  RANKS,
  RANK_KEYS,
  PROGRESS_ATTRIBUTE,
  trials,
  runs,
  init,
  api,
  core: () => core,
  varbit,
  varp,
  trialVarbit,
  ranksOf,
  trialByKey,
  trialByMaster,
  masterForms,
  progress,
  trialProgress,
  updateProgress,
  rankBeaten,
  masterState,
  sendProgress,
  COLOURFUL_FADE_SETTING,
  clock,
  formatTicks,
  numberWord,
  blue,
  mapLocs,
  onLoc,
  crateTiles,
  inBounds,
};
