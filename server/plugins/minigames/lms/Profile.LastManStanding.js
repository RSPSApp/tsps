/**
 * A player's saved Last Man Standing figures, as captured:
 * - finishing Lisa's introduction sets varbit br_tutorial and the rank (varp br_rank) to 500;
 * - the preferred build is varbit br_preferred_build (the settings' choice: 0 Max/Med,
 *   1 Zerker, 2 1 Def Pure);
 * - the three load-outs are varbits br_loadout_{a,b,c}_*: each slot holds an index into its
 *   build's enum (4629-4631), the spellbook an index into enum 4389;
 * - the coffer is varbit br_coffer, in thousands of coins;
 * - wins, kills and games played are the scoreboard's (395).
 */
const Common = require("./Common.LastManStanding");

const BUILD_LETTERS = ["a", "b", "c"];
const INVENTORY_SIZE = 28;

function tutorialDone(player) {
  return player.getAttribute(Common.ATTRIBUTES.tutorial) === true;
}

/** Recorded on "Now that you know more...": the varbit, and the starting rank. */
function finishTutorial(player) {
  if (tutorialDone(player)) return;
  player.setAttribute(Common.ATTRIBUTES.tutorial, true);
  player.setAttribute(Common.ATTRIBUTES.rank, Common.data.rank.start);
  Common.varbit(player, "br_tutorial", 1);
  Common.varp(player, "br_rank", Common.data.rank.start);
}

function setRank(player, rank) {
  const value = Math.max(0, Math.round(rank));
  player.setAttribute(Common.ATTRIBUTES.rank, value);
  Common.varp(player, "br_rank", value);
  return value;
}

function preferredBuild(player) {
  return Common.number(player, Common.ATTRIBUTES.preferredBuild);
}

function setPreferredBuild(player, build) {
  player.setAttribute(Common.ATTRIBUTES.preferredBuild, build);
  Common.varbit(player, "br_preferred_build", build);
}

function copyLoadout(loadout) {
  return { spellbook: loadout.spellbook ?? 0, worn: { ...loadout.worn }, inventory: [...loadout.inventory] };
}

/** The player's load-out for a build (0-2), the captured default until they change it. */
function loadout(player, build) {
  const saved = player.getAttribute(Common.ATTRIBUTES.loadouts);
  const letter = BUILD_LETTERS[build];
  if (saved?.[letter]) return saved[letter];
  return copyLoadout(Common.data.builds[build].default);
}

function saveLoadout(player, build, value) {
  const saved = { ...(player.getAttribute(Common.ATTRIBUTES.loadouts) ?? {}) };
  saved[BUILD_LETTERS[build]] = value;
  player.setAttribute(Common.ATTRIBUTES.loadouts, saved);
}

/** Every load-out varbit, as Lisa sends them before the first game (and the chest reads). */
function sendLoadouts(player) {
  BUILD_LETTERS.forEach((letter, build) => {
    const value = loadout(player, build);
    Common.varbit(player, `br_loadout_${letter}_spellbook`, value.spellbook ?? 0);
    for (const slot of Object.keys(Common.data.wornSlots)) Common.varbit(player, `br_loadout_${letter}_worn_${slot}`, value.worn[slot] ?? 0);
    for (let i = 0; i < INVENTORY_SIZE; i++) Common.varbit(player, `br_loadout_${letter}_inv_${String(i).padStart(2, "0")}`, value.inventory[i] ?? 0);
  });
}

function coffer(player) {
  return Common.number(player, Common.ATTRIBUTES.coffer);
}

function setCoffer(player, coins) {
  player.setAttribute(Common.ATTRIBUTES.coffer, coins);
  Common.varbit(player, "br_coffer", Math.floor(coins / 1000));
}

function login({ player }) {
  if (tutorialDone(player)) Common.varbit(player, "br_tutorial", 1);
  if (player.getAttribute(Common.ATTRIBUTES.rank) != null) Common.varp(player, "br_rank", Common.rankOf(player));
  if (preferredBuild(player)) Common.varbit(player, "br_preferred_build", preferredBuild(player));
  if (coffer(player)) Common.varbit(player, "br_coffer", Math.floor(coffer(player) / 1000));
}

/** The collection log's "Last Man Standing" page counts the reader's games played. */
function collectionLogCount(request) {
  if (request?.category !== "Last Man Standing" || !request.player || Number.isFinite(request.count)) return;
  request.count = Common.number(request.player, Common.ATTRIBUTES.games);
}

function attachProfile(api) {
  const { ATTRIBUTES } = Common;
  api.persistAttribute(ATTRIBUTES.tutorial, false);
  api.persistAttribute(ATTRIBUTES.rank, null);
  api.persistAttribute(ATTRIBUTES.wins, 0);
  api.persistAttribute(ATTRIBUTES.kills, 0);
  api.persistAttribute(ATTRIBUTES.games, 0);
  api.persistAttribute(ATTRIBUTES.preferredBuild, 0);
  api.persistAttribute(ATTRIBUTES.loadouts, null);
  api.persistAttribute(ATTRIBUTES.coffer, 0);
  api.onCustomEvent("collection-log:category-count", collectionLogCount);
  api.onPlayerLogin(login);
}

module.exports = {
  attachProfile,
  collectionLogCount,
  tutorialDone,
  finishTutorial,
  setRank,
  preferredBuild,
  setPreferredBuild,
  loadout,
  saveLoadout,
  copyLoadout,
  sendLoadouts,
  coffer,
  setCoffer,
  BUILD_LETTERS,
  INVENTORY_SIZE,
};
