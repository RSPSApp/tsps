"use strict";

/**
 * The Alliance records (tfa_stats, 979): a player's attempts, completions, deaths, wipes,
 * failures and best times, overall and per boss. The Record Keeper's "View Stats?" and the
 * lobby's Alliance records open it.
 *
 * Captured: opening 979 asks for each category's rows with a script trigger on 979:34
 * ([category dbrow]), answered with script 10125 per row (category, stat, party size or -1,
 * current or blank, 0, personal, global, global today, world today) and 10124. The rows each
 * category lists and which are split by party size are as captured. Only the personal column is
 * kept here: there are no world-wide records, so the others stay blank.
 */

const Shared = require("./Shared.FracturedArchive");
const Raid = require("./RaidState.FracturedArchive");

const ATTR = "fractured-archive:records";
/** Saved: the strange door was permanently unlocked with the archive key. */
const ATTR_UNLOCKED = "fractured-archive:records-room-unlocked";
/** Cache param 2722 on each Living record item is its completion requirement. */
const CLAIM_REQUIREMENT_PARAM = 2722;
const LIVING_RECORD_ITEMS = [
  "LIVING_RECORD_TIER_1_", "LIVING_RECORD_TIER_2_", "LIVING_RECORD_TIER_3_", "LIVING_RECORD_TIER_4_", "LIVING_RECORD_TIER_5_",
];
const LIVING_RECORD_OBJECTS = [
  "LIVING_RECORD_TIER_1_", "LIVING_RECORD_TIER_2_", "LIVING_RECORD_TIER_3_", "LIVING_RECORD_TIER_4_", "LIVING_RECORD_TIER_5_",
];
const LIVING_RECORD_VARBITS = [
  "tfa_cape_claim_t1_visible", "tfa_cape_claim_t2_visible", "tfa_cape_claim_t3_visible", "tfa_cape_claim_t4_visible", "tfa_cape_claim_t5_visible",
];
const RECORD_INSPECT = [
  "These ancient capes were awarded to the archivists of this place. Today they are used to honour those who defend them.",
  "While many archivists travelled the world, some remained behind in the Archive. This cape was given to recognise their work.",
];
/** Wiki: the first Archive Guardian kill after 100 completions drops the key. */
const KEY_DROP_MESSAGE = "A small object falls out of the defeated Archive Guardian.";
const DOOR_SEALED_MESSAGE = "The door has sealed itself while the Archive Guardian is active.";
const KEY_UNLOCK_MESSAGE = "As you insert the key into the door, the vines on the key shift and intertwine with the lock itself. You hear a click as the door unlocks.";
/** Records room door (4123,5573) and exit (4109,5573) placements; each plane's room is one up. */
const ROOM_ARRIVAL = { x: 4108, y: 5573 };
const ROOM_DEPARTURE = { x: 4124, y: 5573 };
/** -2147483648 leaves a cell blank. */
const BLANK = -2147483648;
const STATS_SCRIPT = 10125;
const STATS_DONE_SCRIPT = 10124;
const STATS_OPEN_SCRIPT = 10102;

/** The categories (dbrows tfa_stats_category_*), keyed by what the raid calls them. */
const CATEGORIES = {
  overall: "tfa_stats_category_overall",
  GUARDIAN: "tfa_stats_category_guardian",
  BORK: "tfa_stats_category_bork",
  DAGONHAI: "tfa_stats_category_dagonhai",
  EZEKIEL: "tfa_stats_category_ezekiel",
  MOIA: "tfa_stats_category_moia",
  OCELLUS: "tfa_stats_category_ocellus",
  DREADNOTH: "tfa_stats_category_jelly",
  XARTH: "tfa_stats_category_xarth",
};
const ROWS = {
  attempts: "tfa_stats_row_attempts",
  completions: "tfa_stats_row_completions",
  practice: "tfa_stats_row_completions_practice",
  deaths: "tfa_stats_row_deaths",
  wipes: "tfa_stats_row_wipes",
  failures: "tfa_stats_row_failures",
  time: "tfa_stats_row_time",
};
/** As captured: overall lists wipes and failures; the bosses list practice completions. */
const OVERALL_ROWS = ["attempts", "completions", "deaths", "wipes", "failures", "time"];
const BOSS_ROWS = ["attempts", "completions", "practice", "deaths", "time"];

function itemIds() {
  const { ItemIdentifiers } = Shared.core();
  return LIVING_RECORD_ITEMS.map((key) => ItemIdentifiers[key]);
}

function keyItemId() {
  return Shared.named("obj", "tfa_records_room_key");
}

/** Cache param 2722: 100, 500, 1000, 1500 and 2000. */
function claimRequirement(itemId) {
  const params = Shared.core().CacheDefinitions.getItem(itemId)?.params;
  return Number(params?.get?.(CLAIM_REQUIREMENT_PARAM));
}

function completionsOf(player) {
  return Number(entry(recordsOf(player), "overall").completions) || 0;
}

/** A Living record item by the object's shown id or its base id (whose transforms show it). */
function livingRecordItem(objectId) {
  const { CacheDefinitions, ObjectIdentifiers } = Shared.core();
  const shown = LIVING_RECORD_OBJECTS.map((key) => ObjectIdentifiers[key]);
  const transforms = CacheDefinitions.getObject(objectId)?.transforms ?? [];
  const index = shown.findIndex((id) => id === objectId || transforms.includes(id));
  return index >= 0 ? itemIds()[index] : null;
}

function ownsItem(player, itemId) {
  const { Bank } = Shared.core();
  const held = (container) => Number(container?.getAmount?.(itemId) ?? (container?.contains?.(itemId) ? 1 : 0)) > 0;
  if (held(player.getInventory()) || held(player.getEquipment())) return true;
  const banks = player.getBanks?.() ?? [];
  for (let tab = 0; tab < Bank.TOTAL_BANK_TABS; tab++) {
    if (tab !== Bank.BANK_SEARCH_TAB_INDEX && held(banks[tab])) return true;
  }
  return false;
}

function recordsUnlocked(player) {
  return player.getAttribute(ATTR_UNLOCKED) === true;
}

/** The door's transform and each cape's visibility follow the saved unlock and completions. */
function updateVisibility(player) {
  const unlocked = recordsUnlocked(player);
  const completed = completionsOf(player);
  const sender = player.getPacketSender();
  sender.sendVarbit(Shared.named("varbit", "tfa_records_room_unlocked"), unlocked ? 1 : 0);
  LIVING_RECORD_VARBITS.forEach((name, index) => {
    const eligible = unlocked && completed >= claimRequirement(itemIds()[index]);
    sender.sendVarbit(Shared.named("varbit", name), eligible ? 1 : 0);
  });
}

function itemBox(player, itemId, lines) {
  const { DialogueChainBuilder, ItemStatementDialogue, EndDialogue } = Shared.core();
  const chain = new DialogueChainBuilder();
  lines.forEach((text, index) => chain.add(new ItemStatementDialogue(index, itemId, text)));
  chain.add(new EndDialogue(lines.length));
  player.getDialogueManager().startDialogues(chain);
}

function onLogin({ player }) {
  updateVisibility(player);
}

/** The key is consumed at the strange door; the unlock is permanent. */
function useKeyOnDoor(event) {
  const { player } = event;
  if (recordsUnlocked(player)) return false;
  if (!player.getInventory().contains(keyItemId())) return false;
  player.getInventory().deleteNumber(keyItemId(), 1);
  player.setAttribute(ATTR_UNLOCKED, true);
  updateVisibility(player);
  itemBox(player, keyItemId(), [KEY_UNLOCK_MESSAGE]);
  event.handled = true;
  return true;
}

function guardianActive(player) {
  const room = Raid.raidOf(player)?.room;
  return room?.key === "GUARDIAN" && room.isStarted() && !room.isCompleted();
}

function enterRecordsRoom(event) {
  const { player, object } = event;
  if (!recordsUnlocked(player)) return false;
  if (guardianActive(player)) {
    player.sendMessage(DOOR_SEALED_MESSAGE);
    return true;
  }
  const z = object.getLocation().getZ() >= 2 ? 3 : 1;
  player.moveTo(Shared.loc({ ...ROOM_ARRIVAL, z }));
  return true;
}

/** The room's own exit, by its cache id: other "Exit" objects fall through. */
function exitRecordsRoom(event) {
  const { player, object } = event;
  const { ObjectIdentifiers } = Shared.core();
  if (object.getId?.() !== ObjectIdentifiers.EXIT_38) return false;
  const z = object.getLocation().getZ() >= 3 ? 2 : 0;
  player.moveTo(Shared.loc({ ...ROOM_DEPARTURE, z }));
  return true;
}

/** Wiki: the first Guardian kill after 100 completions drops the key; each player still needs one. */
function onRoomComplete(event) {
  if (event?.room !== "GUARDIAN") return;
  const required = claimRequirement(itemIds()[0]);
  if (!Number.isFinite(required)) return;
  const key = keyItemId();
  for (const player of event.players ?? []) {
    if (recordsUnlocked(player) || completionsOf(player) < required || ownsItem(player, key)) continue;
    const { Item, ItemOnGroundManager } = Shared.core();
    const guardian = event.raid?.rooms?.get?.("GUARDIAN")?.guardian;
    const at = (guardian?.getLocation?.() ?? player.getLocation()).clone();
    ItemOnGroundManager.registerNonGlobals(player, new Item(key, 1), at);
    player.sendMessage(KEY_DROP_MESSAGE);
  }
}

/** Claim is free and repeatable only while the cape is missing; a claim is the only log credit. */
function claimRecord(event) {
  const { player, objectId } = event;
  const itemId = livingRecordItem(objectId);
  if (!itemId) return false;
  const required = claimRequirement(itemId);
  if (!Number.isFinite(required) || completionsOf(player) < required || ownsItem(player, itemId)) return true;
  if (player.getInventory().getFreeSlots() <= 0) {
    player.sendMessage("You don't have enough inventory space.");
    return true;
  }
  player.getInventory().adds(itemId, 1);
  const query = { player, itemId, count: 0 };
  Shared.api().emitCustomEvent("collection-log:obtained", query);
  if (!query.count) Shared.api().emitCustomEvent("collection-log:obtain", { player, itemId, amount: 1 });
  return true;
}

/** Wiki transcript: two lore boxes, then "[x] completions required." */
function inspectRecord(event) {
  const itemId = livingRecordItem(event.objectId);
  if (!itemId) return false;
  const required = claimRequirement(itemId);
  itemBox(event.player, itemId, [...RECORD_INSPECT, `${required} completions required.`]);
  return true;
}

function recordsOf(player) {
  const records = player.getAttribute(ATTR);
  return records && typeof records === "object" ? records : {};
}

function entry(records, category) {
  return (records[category] ??= { attempts: 0, completions: 0, practice: 0, deaths: 0, wipes: 0, failures: 0, time: {} });
}

/** Adds one to a counter: record(player, "GUARDIAN", "deaths"). */
function record(player, category, field) {
  const records = recordsOf(player);
  entry(records, category)[field] += 1;
  player.setAttribute(ATTR, records);
}

/** A completion time for a party size, kept when it's the best. */
function recordTime(player, category, size, ticks) {
  const records = recordsOf(player);
  const times = entry(records, category).time;
  if (!(times[size] > 0) || ticks < times[size]) times[size] = ticks;
  player.setAttribute(ATTR, records);
}

function open(player) {
  const sender = player.getPacketSender();
  sender.sendInterface(Shared.core().CacheDefinitions.getInterfaceId("tfa_stats"));
  sender.sendClientScript(STATS_OPEN_SCRIPT, 0);
}

/** The client building a category's table asks for its rows. */
function sendCategory(player, categoryRow) {
  const { CacheDefinitions } = Shared.core();
  const key = Object.keys(CATEGORIES).find((name) => CacheDefinitions.getDbRowId(CATEGORIES[name]) === categoryRow);
  if (!key) return;
  const stats = entry(recordsOf(player), key);
  const sender = player.getPacketSender();
  for (const row of key === "overall" ? OVERALL_ROWS : BOSS_ROWS) {
    const rowId = CacheDefinitions.getDbRowId(ROWS[row]);
    if (row === "time") {
      for (let size = 1; size <= Shared.MAX_PARTY_SIZE; size++) {
        sender.sendClientScript(STATS_SCRIPT, categoryRow, rowId, size, BLANK, 0, stats.time[size] ?? 0, BLANK, BLANK, BLANK);
      }
      continue;
    }
    sender.sendClientScript(STATS_SCRIPT, categoryRow, rowId, -1, BLANK, 0, stats[row] ?? 0, BLANK, BLANK, BLANK);
  }
  sender.sendClientScript(STATS_DONE_SCRIPT);
}

function tableTrigger(event) {
  if (!event.scriptTrigger || event.buttonId !== Shared.core().CacheDefinitions.getComponentId("tfa_stats:all_stats_tables")) return;
  event.handled = true;
  const [category] = Shared.triggerInts(event.argsData);
  sendCategory(event.player, category);
}

function readRecords({ player }) {
  open(player);
  return true;
}

/** The cache's one Fractured Archive log category counts finished raids. */
function collectionLogCount(request) {
  if (request?.category !== "The Fractured Archive") return;
  request.count = Number(entry(recordsOf(request.player), "overall").completions) || 0;
}

/** "fractured-archive:record" { player, category, field }: the raid counting something. */
function onRecord({ player, category, field }) {
  if (!player || !category || !field) return;
  record(player, category, field);
  if (category === "overall" && field === "completions") updateVisibility(player);
}

/** "fractured-archive:record-time" { player, category, size, ticks }: a completion time. */
function onRecordTime({ player, category, size, ticks }) {
  if (player && category && size > 0 && ticks > 0) recordTime(player, category, Math.min(size, Shared.MAX_PARTY_SIZE), ticks);
}

/** The Record Keeper's "View Stats?" - "Yes.": once the conversation has closed itself. */
function keeperChoice({ player, stepId }) {
  if (stepId === "tfa-record-keeper-view-stats") Shared.later(player, 1, () => open(player));
}

module.exports = function registerRecords(api) {
  Shared.bind(api);
  api.persistAttribute(ATTR);
  api.persistAttribute(ATTR_UNLOCKED, false);
  api.onPlayerLogin(onLogin);
  api.onItemOnObject("Archive key", "Strange door", useKeyOnDoor, { noted: false });
  api.onObjectInteraction("Records room", { Enter: enterRecordsRoom });
  api.onObjectInteraction("Exit", { Enter: exitRecordsRoom });
  api.onObjectInteraction("Living Record (tier 1)", { Claim: claimRecord, Inspect: inspectRecord });
  api.onObjectInteraction("Living Record (tier 2)", { Claim: claimRecord, Inspect: inspectRecord });
  api.onObjectInteraction("Living Record (tier 3)", { Claim: claimRecord, Inspect: inspectRecord });
  api.onObjectInteraction("Living Record (tier 4)", { Claim: claimRecord, Inspect: inspectRecord });
  api.onObjectInteraction("Living Record (tier 5)", { Claim: claimRecord, Inspect: inspectRecord });
  api.onCustomEvent("fractured-archive:room-complete", onRoomComplete);
  api.onObjectInteraction("Alliance records", { Read: readRecords });
  api.onInterfaceActionClick(tableTrigger);
  api.onCustomEvent("npc-dialogue:choice", keeperChoice);
  api.onCustomEvent("fractured-archive:record", onRecord);
  api.onCustomEvent("fractured-archive:record-time", onRecordTime);
  api.onCustomEvent("collection-log:category-count", collectionLogCount);
};

Object.assign(module.exports, {
  ATTR, ATTR_UNLOCKED, CATEGORIES, record, recordTime, recordsOf, open, sendCategory, collectionLogCount,
  itemIds, keyItemId, claimRequirement, completionsOf, updateVisibility, useKeyOnDoor, enterRecordsRoom,
  exitRecordsRoom, onRoomComplete, claimRecord, inspectRecord,
});
