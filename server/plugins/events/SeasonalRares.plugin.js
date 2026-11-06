"use strict";

/**
 * Seasonal rares: a server feature, not OSRS behaviour. Live OSRS no longer hands out the discontinued rares; this
 * world gives them out during its own event windows, as data says. Each row of data/seasonal-rares.json names a
 * rare (cache obj symbol plus id, checked against the cache at startup), the EventScheduler key whose window owns it
 * (events.json), how many one account may claim (perAccount) and an optional world-wide cap (stock). Nothing is
 * sold, so no price exists here. No shop stocks them either: the configured rares are not in custom-shops.json.
 *
 * ::rares lists what the player may claim right now. Window state is always asked of the scheduler
 * ("events:status"), at listing and again at the pick, so a closed window (or ::forceevent off) leaves nothing to
 * claim, and calendar changes are data only. Claims are keyed by row, so every window of an event shares one
 * allowance and a later window cannot give a second; a yearly re-issue is a new row key.
 *
 * Two records guard a claim, and the larger count wins: the account's own "seasonal-rares:claims" attribute, and the
 * world file data/saves/seasonal-rares.json, which also counts the stock cap and survives a player-save rollback.
 * The world file is written first: if that write fails nothing is given, and a crash after it can lose a claimed rare
 * but never duplicate one. An unreadable world file stops all claims (and is left as it is) rather than starting the
 * counts over.
 *
 * Claims are refused away from the main character (a league profile) and while the player is in an area, busy or in
 * combat, as minigames such as LMS and the Gauntlet replace the inventory on exit.
 */

const fs = require("fs");
const path = require("path");
const configuredRows = require("./data/seasonal-rares.json");

const CLAIMS_ATTRIBUTE = "seasonal-rares:claims";
const MAIN_PROFILE = "main";
const MENU_SIZE = 5;
const KEY_PATTERN = /^[a-z][a-z0-9-]*$/;

let api = null;
let rows = [];
let storeFile = path.join(process.cwd(), "data", "saves", "seasonal-rares.json");
let store = {};
let storeReadable = true;

/** The world record, or null when the file exists but cannot be used (claims then stay shut until it is fixed). */
function readStore() {
  try {
    const saved = JSON.parse(fs.readFileSync(storeFile, "utf8"));
    if (saved && typeof saved === "object" && !Array.isArray(saved)) return saved;
    throw new Error("not a JSON object");
  } catch (error) {
    if (error.code === "ENOENT") return {};
    api.log(`SeasonalRares: ${storeFile} unreadable (${error.message}); claims are off until it is fixed`);
    return null;
  }
}

function writeStore(next) {
  fs.mkdirSync(path.dirname(storeFile), { recursive: true });
  fs.writeFileSync(`${storeFile}.tmp`, JSON.stringify(next));
  fs.renameSync(`${storeFile}.tmp`, storeFile);
}

const isCount = (value) => Number.isSafeInteger(value) && value >= 0;

/** A row that is safe to serve, or the reason it is not. */
function checkRow(row, seen) {
  if (!row || typeof row !== "object") return "not an object";
  if (typeof row.key !== "string" || !KEY_PATTERN.test(row.key) || seen.has(row.key)) return "key must be a unique lowercase name";
  if (typeof row.event !== "string" || !KEY_PATTERN.test(row.event)) return "event must be an events.json key";
  if (typeof row.enabled !== "boolean") return "enabled must be true or false";
  if (!isCount(row.perAccount) || row.perAccount < 1) return "perAccount must be a whole number of at least 1";
  if (row.stock !== null && (!isCount(row.stock) || row.stock < 1)) return "stock must be null or a whole number of at least 1";
  const { CacheDefinitions, ItemDefinition } = api.core;
  if (typeof row.item !== "string" || CacheDefinitions.getObjId(row.item) !== row.id) return `cache obj ${row.item} is not id ${row.id}`;
  const definition = ItemDefinition.forId(row.id);
  if (!definition || !definition.isTradeable()) return `item ${row.id} is not a tradeable item`;
  return null;
}

function load(source = configuredRows) {
  const seen = new Set();
  rows = [];
  for (const row of Array.isArray(source) ? source : []) {
    const problem = checkRow(row, seen);
    if (problem) {
      api.log(`SeasonalRares: skipping ${row?.key ?? "row"}: ${problem}`);
      continue;
    }
    seen.add(row.key);
    rows.push(Object.freeze({ ...row }));
  }
  const saved = readStore();
  storeReadable = saved !== null;
  store = saved ?? {};
}

function eventActive(key) {
  const request = { key, active: false };
  api.emitCustomEvent("events:status", request);
  return request.active === true;
}

const accountName = (player) => String(player.getUsername?.() ?? "").toLowerCase();

function accountClaims(player) {
  const value = player.getAttribute(CLAIMS_ATTRIBUTE);
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

/** How many of this row the account has had: the larger of its own record and the world's. */
function claimedBy(player, row) {
  const own = accountClaims(player)[row.key];
  const world = store[row.key]?.by?.[accountName(player)];
  return Math.max(isCount(own) ? own : 0, isCount(world) ? world : 0);
}

const worldClaimed = (row) => (isCount(store[row.key]?.claimed) ? store[row.key].claimed : 0);

/** How many more of this row this player may take now: 0 when its window is shut, it is off, or it is used up. */
function remaining(player, row) {
  if (!row.enabled || !eventActive(row.event)) return 0;
  const own = row.perAccount - claimedBy(player, row);
  const world = row.stock === null ? Infinity : row.stock - worldClaimed(row);
  return Math.max(0, Math.min(own, world));
}

function claimable(player) {
  return storeReadable ? rows.filter((row) => remaining(player, row) > 0) : [];
}

/** Why this player cannot claim anything where they are, or null. */
function refusal(player) {
  if ((player.getProfile?.() ?? MAIN_PROFILE) !== MAIN_PROFILE) return "Seasonal rares can only be claimed on your main character.";
  if (player.getArea?.() != null || player.busy?.() || api.getCombatFactory().inCombat(player)) {
    return "You can't claim a seasonal rare right now.";
  }
  return null;
}

function itemName(row) {
  return api.core.ItemDefinition.forId(row.id).getName();
}

/** One rare, re-checked at the pick: the menu may be stale, the window may have closed since. */
function claim(player, key) {
  const blocked = refusal(player);
  if (blocked) {
    player.sendMessage(blocked);
    return false;
  }
  const row = rows.find((entry) => entry.key === key);
  if (!storeReadable || !row || remaining(player, row) <= 0) {
    player.sendMessage("That rare is not available to you right now.");
    return false;
  }
  const inventory = player.getInventory();
  if (inventory.getFreeSlots() <= 0) {
    player.sendMessage("You don't have enough inventory space to take that.");
    return false;
  }
  // The world record is the rollback and stock guard, so it is written before anything is given.
  const count = claimedBy(player, row) + 1;
  const name = accountName(player);
  const entry = store[row.key] ?? { claimed: 0, by: {} };
  const next = { ...store, [row.key]: { claimed: worldClaimed(row) + 1, by: { ...entry.by, [name]: count } } };
  try {
    writeStore(next);
  } catch (error) {
    api.log(`SeasonalRares: could not record ${row.key} for ${name} (${error.message}); nothing given`);
    player.sendMessage("That rare can't be claimed right now. Please try again later.");
    return false;
  }
  store = next;
  inventory.adds(row.id, 1);
  player.setAttribute(CLAIMS_ATTRIBUTE, { ...accountClaims(player), [row.key]: count });
  api.core.GameConstants.PLAYER_PERSISTENCE.requestSave(player, "seasonal-rares-claim");
  const claimed = itemName(row);
  player.sendMessage(`You claim ${/^[aeiou]/i.test(claimed) ? "an" : "a"} ${claimed}.`);
  return true;
}

function showPage(player, page) {
  const blocked = refusal(player);
  if (blocked) {
    player.sendMessage(blocked);
    return;
  }
  const available = claimable(player);
  if (available.length === 0) {
    player.sendMessage("No seasonal rares are being given out to you right now.");
    return;
  }
  // Room for Cancel always, and for More... when the rares need more than one menu.
  const perPage = available.length <= MENU_SIZE - 1 ? MENU_SIZE - 1 : MENU_SIZE - 2;
  const pages = Math.ceil(available.length / perPage);
  const index = Math.min(Math.max(0, page), pages - 1);
  const options = [];
  for (const row of available.slice(index * perPage, (index + 1) * perPage)) {
    options.push(`${itemName(row)} (${remaining(player, row)} left for you)`, () => claim(player, row.key));
  }
  if (pages > 1) options.push("More...", () => showPage(player, (index + 1) % pages));
  options.push("Cancel", () => {});
  api.sendMultiChatboxPrompt(player, "Claim a seasonal rare", ...options);
}

function openMenu({ player }) {
  showPage(player, 0);
  return true;
}

/** A newly opened window is announced to everyone online who has something to claim from it. */
function announce({ key, active }) {
  if (!active || !rows.some((row) => row.event === key)) return;
  for (const player of api.core.World.getPlayers()) {
    if (player && rows.some((row) => row.event === key && remaining(player, row) > 0)) {
      player.sendMessage("Seasonal rares are being given out. Type ::rares to claim yours.");
    }
  }
}

function greet({ player }) {
  if (api && claimable(player).length > 0) player.sendMessage("Seasonal rares are being given out. Type ::rares to claim yours.");
}

function start(pluginApi) {
  api = pluginApi;
  load();
}

module.exports = {
  name: "SeasonalRares",
  CLAIMS_ATTRIBUTE,
  /** Tests: point the world file elsewhere, load other rows, and read what a player may claim. */
  testing: {
    setStoreFile(file) { storeFile = file; },
    load,
    claimable,
    claim,
  },
  register(pluginApi) {
    pluginApi.persistAttribute(CLAIMS_ATTRIBUTE, {});
    pluginApi.onServerStartup(start.bind(null, pluginApi));
    pluginApi.registerCommand("rares", openMenu, pluginApi.core.PlayerRights.NONE, "Claim a seasonal rare while its event window is open");
    pluginApi.onCustomEvent("events:active", announce);
    pluginApi.onPlayerLogin(greet);
  },
};
