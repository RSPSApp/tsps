/**
 * Butler's Bell (https://oldschool.runescape.wiki/w/Butler's_Bell_(Demonic_Pacts_League)), Demonic
 * Pacts' tier 4 relic: the Butler's bell's Ring summons the Demon butler (the cache's
 * league_butler, Talk-to and Collect) beside its owner; refused in an instance, and with the
 * butler already in view he asks to be spoken to instead (Wiki). He works one job at a time, a
 * row of the cache's butlers_bell_actions table: its gather rate a minute (ores 8, fish 14, logs
 * 10, flax 50, herbs 10), or half that when he processes them (bars, cooked fish, planks, bow
 * strings, unfinished potions), each item rolled on the Wiki's weighted table for the job
 * (data/league-butlers-bell.json). His work runs on the clock, offline too: what is owed is
 * reckoned whenever he is spoken to, from the minutes since the job began, the fraction carried.
 * A processed item shares its 10 XP (the row's processed_xp) in the row's skill as it is
 * collected. Talk-to and Collect follow the Wiki transcript word for word: a new job only once
 * the last is collected, the job's process-or-raw choice with both rates, "Show me what you've
 * collected so far." when he holds anything, and the collection shown on "The Fruits of Your
 * Butler's Labour" (954, inventory butlers_bell_collection).
 *
 * Ours, with no source (no recording of the bell exists): the job menu (the rows' raw nouns in
 * action_id order, the default title), where he stands (the random events' free tile beside the
 * player) and that he leaves at logout or out of view, and that the collection goes to the bank
 * (what it can't take stays with him). Not here: the bell's Check (its line is in no source).
 */
const Common = require("./Common.LeagueRelics");
const DATA = require("../data/league-butlers-bell.json");

const JOB_ATTRIBUTE = "league:butler-job";
const STORE_ATTRIBUTE = "league:butler-store";
const MINUTE_MS = 60_000;
const MAIN_MODAL = (161 << 16) | 16;
const SCRIPT_MAINMODAL_OPEN = 2524;
const COLLECTION_INTERFACE = 954;
const WATCH_TICKS = 5;

let api;
let core;
let effect;
let jobs = null;
/** The butler a player rang for, by player. */
const butlers = new Map();

function active(player) {
  return Common.effectActive(player, effect);
}

/** The cache's jobs by action id: { action, raw, processed, xp, skill, rate }. */
function jobTable() {
  if (jobs) return jobs;
  const { CacheDefinitions } = core;
  const table = CacheDefinitions.getDbTableId(DATA.table);
  const column = (name) => CacheDefinitions.getDbColumn(table, DATA.columns[name]);
  jobs = new Map();
  for (const row of CacheDefinitions.getDbTableRows(table)) {
    const action = row.int(column("action"));
    jobs.set(action, {
      action, raw: row.string(column("raw")), processed: row.string(column("processed")),
      xp: row.int(column("xp")), skill: row.int(column("skill")), rate: row.int(column("rate")),
    });
  }
  return jobs;
}

/** The transcript's "[sir/madam/neutral]" alternatives for this player, and its {placeholders}. */
function line(player, key, values = {}) {
  const male = player.getAppearance?.()?.isMale?.() !== false;
  return DATA.lines[key]
    .replace(/\[([^\]]*\/[^\]]*)\]/g, (match, group) => group.split("/")[male ? 0 : 1])
    .replace(/\{(\w+)\}/g, (match, name) => values[name] ?? match);
}

function job(player) {
  const saved = player.getAttribute(JOB_ATTRIBUTE);
  return saved && typeof saved === "object" ? saved : null;
}

function store(player) {
  const saved = player.getAttribute(STORE_ATTRIBUTE);
  return Array.isArray(saved) ? saved : [];
}

function rateOf(row, processing) {
  return processing ? row.rate / DATA.processRateDivisor : row.rate;
}

function roll(table) {
  const total = table.reduce((sum, [, weight]) => sum + weight, 0);
  let pick = Math.random() * total;
  for (const [name, weight] of table) {
    pick -= weight;
    if (pick < 0) return name;
  }
  return table.at(-1)[0];
}

/**
 * Brings the job up to now: every whole item its rate has earned since it began goes into the
 * butler's store (the fraction carried by moving the start on), and a processed item's XP is owed.
 */
function catchUp(player, now = Date.now()) {
  const current = job(player);
  const row = current && jobTable().get(current.action);
  if (!row) return;
  const rate = rateOf(row, current.processing);
  const items = Math.floor(((now - current.since) / MINUTE_MS) * rate);
  if (items <= 0) return;
  const counts = new Map(store(player));
  const table = DATA.jobs[row.action][current.processing ? "process" : "gather"];
  for (let item = 0; item < items; item++) {
    const name = roll(table);
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  player.setAttribute(STORE_ATTRIBUTE, [...counts]);
  player.setAttribute(JOB_ATTRIBUTE, {
    ...current, since: current.since + (items / rate) * MINUTE_MS,
    xp: (current.xp ?? 0) + (current.processing ? items * row.xp : 0),
  });
}

function holds(player) {
  return store(player).some(([, amount]) => amount > 0);
}

/** The collection: to the bank as far as it takes it, shown on 954; the XP shared. */
function collect(player) {
  const current = job(player);
  const row = current && jobTable().get(current.action);
  const left = [];
  const collected = [];
  for (const [name, amount] of store(player)) {
    const id = core.ItemIdentifiers[name];
    if (Common.bank(player, id, amount)) collected.push({ id, amount });
    else left.push([name, amount]);
  }
  player.setAttribute(STORE_ATTRIBUTE, left);
  if (row && current.xp > 0) {
    player.getSkillManager().addExperiences(core.Skill.values()[row.skill], current.xp);
    player.setAttribute(JOB_ATTRIBUTE, { ...current, xp: 0 });
  }
  const sender = player.getPacketSender();
  sender.sendInventory(core.CacheDefinitions.getInventoryId("butlers_bell_collection"), collected.length, collected);
  sender.sendInterfaceScript(SCRIPT_MAINMODAL_OPEN, [-1, -1]);
  player.setInterfaceId(COLLECTION_INTERFACE);
  sender.sendSubInterface(MAIN_MODAL, COLLECTION_INTERFACE, 0);
}

function chain(player, entries) {
  const builder = new core.DialogueChainBuilder();
  entries.forEach((make, index) => builder.add(make(index)));
  player.getDialogueManager().startDialogues(builder);
}

function npcSays(player, text) {
  return (index) => new core.NpcDialogue(index, butlerId(), text);
}

function playerSays(text) {
  return (index) => new core.PlayerDialogue(index, text);
}

function then(fn) {
  return (index) => new core.ActionDialogue(index, { execute: fn });
}

function menu(player, title, options) {
  return (index) => {
    const dialogue = new core.OptionDialogue(index, { executeOption: (option) => options[option - 1]?.[1]() }, ...options.map(([label]) => label));
    if (title) dialogue.setTitle(title);
    return dialogue;
  };
}

function startJob(player, row, processing) {
  player.setAttribute(JOB_ATTRIBUTE, { action: row.action, processing, since: Date.now(), xp: 0 });
  chain(player, [npcSays(player, line(player, "started"))]);
}

function chooseProcessing(player, row) {
  const raw = rateOf(row, false);
  chain(player, [menu(player, line(player, "processTitle", { raw: row.raw, processed: row.processed }), [
    [line(player, "processYes", { rate: rateOf(row, true) }), () => startJob(player, row, true)],
    [line(player, "processNo", { rate: raw }), () => startJob(player, row, false)],
  ])]);
}

function newJob(player) {
  catchUp(player);
  if (holds(player)) {
    chain(player, [playerSays(line(player, "newJob")), npcSays(player, line(player, "collectFirst")), then(() => collect(player))]);
    return;
  }
  const rows = [...jobTable().values()].sort((a, b) => a.action - b.action);
  chain(player, [playerSays(line(player, "newJob")), menu(player, null, rows.map((row) => [row.raw, () => chooseProcessing(player, row)]))]);
}

function showCollection(player, said) {
  catchUp(player);
  const opening = said ? [playerSays(line(player, "show"))] : [];
  if (holds(player)) chain(player, [...opening, then(() => collect(player))]);
  else chain(player, [...opening, npcSays(player, line(player, "nothingYet"))]);
}

function butlerId() {
  return core.CacheDefinitions.getNpcId(DATA.npc);
}

/** His owner's own butler: true when it is, and the click is theirs to answer. */
function own(event) {
  const npc = event.npc;
  return npc && butlers.get(event.player) === npc && active(event.player);
}

function talk(event) {
  if (!own(event)) return false;
  const { player } = event;
  catchUp(player);
  const options = [[line(player, "newJob"), () => newJob(player)]];
  if (holds(player)) options.push([line(player, "show"), () => showCollection(player, true)]);
  options.push([line(player, "nothing"), () => chain(player, [playerSays(line(player, "nothingSaid")), npcSays(player, line(player, "excellent"))])]);
  chain(player, [npcSays(player, line(player, "greeting")), menu(player, null, options)]);
  return true;
}

function collectOption(event) {
  if (!own(event)) return false;
  showCollection(event.player, false);
  return true;
}

function visible(player, npc) {
  return npc && npc.isRegistered?.() !== false && (player.getLocalNpcs?.() ?? []).includes(npc);
}

function dismiss(player) {
  const npc = butlers.get(player);
  butlers.delete(player);
  if (npc && npc.isRegistered?.() !== false) api.removeNpc(npc);
}

/** A free tile beside the player, as the random events choose one. */
function tileBeside(player) {
  const origin = player.getLocation();
  const region = api.getRegionManager();
  const area = player.getPrivateArea?.();
  return [[1, 0], [-1, 0], [0, 1], [0, -1]]
    .map(([dx, dy]) => new core.Location(origin.getX() + dx, origin.getY() + dy, origin.getZ()))
    .find((tile) => !region.blocked(tile, area) && region.canMovestart(origin, tile, 1, 1, area)) ?? null;
}

function ring(event) {
  const { player } = event;
  if (!active(player)) return false;
  event.handled = true;
  if (player.getPrivateArea?.() != null) {
    player.sendMessage(line(player, "noInstances"));
    return true;
  }
  const current = butlers.get(player);
  if (visible(player, current)) {
    chain(player, [npcSays(player, line(player, "useVoice"))]);
    return true;
  }
  dismiss(player);
  const tile = tileBeside(player);
  if (!tile) return true;
  const npc = api.spawnNpc({ id: butlerId(), x: tile.getX(), y: tile.getY(), z: tile.getZ(), owner: player, wanderRadius: 0 });
  if (!npc) return true;
  butlers.set(player, npc);
  npc.setPositionToFace?.(player.getLocation());
  watch(player, npc);
  return true;
}

/** He leaves once his owner loses sight of him (checked every few ticks while he stands). */
function watch(player, npc) {
  core.TaskManager.submit(new core.CountdownTask(npc, WATCH_TICKS, () => {
    if (butlers.get(player) !== npc) return;
    if (!player.isRegistered?.() || !visible(player, npc)) dismiss(player);
    else watch(player, npc);
  }));
}

function logout({ player }) {
  dismiss(player);
}

module.exports = function attach(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
  effect = Common.data.effects.butlersBell;
  api.persistAttribute(JOB_ATTRIBUTE, null);
  api.persistAttribute(STORE_ATTRIBUTE, null);
  api.onItemAction(DATA.bell, { Ring: ring });
  api.onNpcInteraction(DATA.npcName, { "Talk-to": talk, Collect: collectOption });
  api.onPlayerLogout(logout);
};

Object.assign(module.exports, { JOB_ATTRIBUTE, STORE_ATTRIBUTE, catchUp, collect, talk, ring, butlers });
