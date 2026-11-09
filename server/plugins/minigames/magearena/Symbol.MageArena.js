"use strict";

/**
 * The Enchanted symbol (https://oldschool.runescape.wiki/w/Enchanted_symbol), Mage Arena II's
 * locator. It "works similarly to the strange device" (Wiki): Activate reads how near the chosen
 * god's follower is, and hurts.
 *
 * As a live run shows it (rsprox_transcripts/235/03344.txt):
 * - "Select an option" lists the followers it can still track, with Cancel; with one left there's
 *   no menu.
 * - "The enchanted symbol is <temperature>[, and warmer than last time | , but colder than last
 *   time | , and the same temperature as last time]." then "The power of the enchanted symbol
 *   hurts you in the process.", the shaking one too ("...visibly shaking and burns to the touch,
 *   and warmer than last time."). Measured to where each follower then appeared, the run's 58
 *   readings fit the strange device's bands (Wiki Strange_device: ice cold 500+ tiles, very cold
 *   200-499, cold 150-199, warm 100-149, hot 70-99, very hot 30-69, incredibly hot from 4) except
 *   visibly shaking, read at 11 and 12 tiles with incredibly hot at 18 and 20 (the Justiciar,
 *   Derwen). The edge is taken at 15 tiles, inside that range: inferred, not recorded.
 * - The reading is to the follower's own spawn tile, inside the Wiki map's 5-tile circle round its
 *   point; measured to the points, the Justiciar's and Derwen's readings contradict each other.
 * - The follower locations rotate on `ma2_timer_remaining` (6062), 250 at the first use. The Wiki
 *   (Mage_Arena_II) says they "change approximately every 45 minutes", only while the player is in
 *   the Wilderness, so it steps down one every 18 ticks (250 x 18 x 0.6 s = 45 minutes); the run
 *   stepped it every 10 ticks (25 minutes), and the Wiki wins. Once it runs out, the
 *   next use only says "It appears the creatures have moved locations, ..." (a box and the chat
 *   line, no damage), then asks again.
 * - At "visibly shaking and burns to the touch" the follower appears at its spawn tile
 *   (Followers.MageArena.js).
 *
 * Wiki: only in the above-ground Wilderness; "randomly deals up to 16 damage", and the run's 58
 * hits were 8-12, so 8 to 16; a follower already handed in, or whose remains are carried, isn't
 * tracked. With nothing left to track the Wiki says the symbol tells you so, but not in what words
 * (none recorded), so it does nothing.
 * The locations are the Wiki's spawn map (Map:God_followers_spawn_locations, 17 points, which
 * doesn't say which god uses which), so each follower draws its own point from all of them.
 */
const MageArenaII = require("./MageArenaII.MageArena");
const Followers = require("./Followers.MageArena");

const TIMER_VARBIT = 6062;
const TIMER_START = 250;
/** Wiki: about 45 minutes for the 250 steps (the recorded run stepped every 10 ticks, 235/03344). */
const TIMER_STEP_TICKS = 18;
const MIN_DAMAGE = 8;
const MAX_DAMAGE = 16;
/** ma2_timer_remaining, and each follower's spawn point index and tile, saved per player. */
const TIMER_ATTRIBUTE = "mage-arena-ii:location-timer";
const LOCATIONS_ATTRIBUTE = "mage-arena-ii:locations";
const SPAWN_POINTS = Object.freeze([
  [3172, 3898], [3304, 3942], [3296, 3876], [3260, 3886], [3233, 3909], [3215, 3883],
  [3231, 3873], [3276, 3842], [3248, 3831], [3261, 3800], [3168, 3796], [3158, 3842],
  [3022, 3831], [3150, 3878], [3334, 3903], [3172, 3866], [3282, 3821],
]);
/** The Wilderness above ground (the underground half starts at y 9920). */
const UNDERGROUND_Y = 9920;

const MESSAGES = Object.freeze({
  notHere: "The symbol doesn't seem to work here, I should try using it in the Wilderness.",
  moved: "It appears the creatures have moved locations, the symbol glows slightly as it locates their new positions.",
  hurts: "The power of the enchanted symbol hurts you in the process.",
});
const CANCEL = "Cancel";
/** [below this many tiles, the temperature], hottest first; ice cold beyond. */
const BANDS = Object.freeze([[15, "visibly shaking and burns to the touch"], [30, "incredibly hot"], [70, "very hot"], [100, "hot"],
  [150, "warm"], [200, "cold"], [500, "very cold"]]);

function temperature(distance) {
  return BANDS.find(([below]) => distance < below)?.[1] ?? "ice cold";
}

let api;
/** Player -> { follower key -> last distance read }, for "warmer/colder than last time". */
const lastReadings = new WeakMap();
/** Players whose location timer is counting down this session. */
const ticking = new WeakSet();

function inWilderness(player) {
  const location = player.getLocation();
  return api.core.Wilderness.isInLocation(location) && location.getY() < UNDERGROUND_Y;
}

/** The followers the symbol tracks now (Wiki): not yet with Kolodion during the miniquest, and never one whose remains are carried. */
function trackable(player) {
  const stage = MageArenaII.stageOf(player);
  if (stage !== MageArenaII.STAGE.HUNTING && stage !== MageArenaII.STAGE.COMPLETE) return [];
  return MageArenaII.getFollowers().filter((follower) => !MageArenaII.carries(player, follower) &&
    (stage === MageArenaII.STAGE.COMPLETE || !MageArenaII.holds(player, follower)));
}

function timerOf(player) {
  return Math.max(0, Number(player.getAttribute(TIMER_ATTRIBUTE)) || 0);
}

function setTimer(player, value) {
  player.setAttribute(TIMER_ATTRIBUTE, value);
  player.getPacketSender().sendVarbit(TIMER_VARBIT, value);
}

function locations(player) {
  const saved = player.getAttribute(LOCATIONS_ATTRIBUTE);
  return saved && typeof saved === "object" ? saved : null;
}

/** A fresh point for each follower, distinct from each other, and its spawn tile there. */
function rotate(player, random = Math.random) {
  const indices = SPAWN_POINTS.map((_point, index) => index);
  const chosen = {};
  for (const follower of MageArenaII.getFollowers()) {
    const [index] = indices.splice(Math.floor(random() * indices.length), 1);
    const tile = Followers.spawnTile(SPAWN_POINTS[index], random);
    chosen[follower.key] = { point: index, tile: tile ? [tile.getX(), tile.getY()] : [...SPAWN_POINTS[index]] };
  }
  player.setAttribute(LOCATIONS_ATTRIBUTE, chosen);
  // "The creatures have moved locations": a follower still up at its old place goes.
  Followers.dismissFor(player);
  lastReadings.delete(player);
  setTimer(player, TIMER_START);
  startTimer(player);
}

/** { point, tile: [x, y] } for a follower, or null (none chosen yet). */
function locationOf(player, follower) {
  const saved = locations(player)?.[follower.key];
  return Array.isArray(saved?.tile) ? saved : null;
}

/** Counts the location timer down by one every 18 ticks the player spends in the Wilderness. */
function startTimer(player) {
  if (ticking.has(player) || timerOf(player) <= 0) return;
  ticking.add(player);
  const { Task } = api.core;
  api.getTaskManager().submit(new (class extends Task {
    constructor() {
      super(TIMER_STEP_TICKS);
    }
    execute() {
      if (!player.isRegistered() || timerOf(player) <= 0) {
        ticking.delete(player);
        this.stop();
        return;
      }
      if (inWilderness(player)) setTimer(player, timerOf(player) - 1);
    }
  })());
}

function readingFor(player, follower) {
  const [x, y] = locationOf(player, follower).tile;
  const at = player.getLocation();
  const current = Math.max(Math.abs(at.getX() - x), Math.abs(at.getY() - y));
  const readings = lastReadings.get(player) ?? {};
  const previous = readings[follower.key];
  readings[follower.key] = current;
  lastReadings.set(player, readings);
  const now = temperature(current);
  const change = previous == null ? "" : current < previous ? ", and warmer than last time" :
    current > previous ? ", but colder than last time" : ", and the same temperature as last time";
  return { current, text: `The enchanted symbol is ${now}${change}.` };
}

/** One reading for a follower: the temperature, the blood sacrifice, and the follower at the spot. */
function locate(player, follower, random = Math.random) {
  const { current, text } = readingFor(player, follower);
  player.sendMessage(text);
  player.sendMessage(MESSAGES.hurts);
  const damage = MIN_DAMAGE + Math.floor(random() * (MAX_DAMAGE - MIN_DAMAGE + 1));
  player.getCombat().getHitQueue().addPendingDamage([new api.core.HitDamage(damage, api.core.HitMask.RED)]);
  if (current < BANDS[0][0]) {
    const { point, tile } = locationOf(player, follower);
    Followers.summon(player, follower, point, tile);
  }
}

function choose(player, options) {
  const { DialogueChainBuilder, OptionDialogue } = api.core;
  const labels = [...options.map((follower) => follower.god), CANCEL];
  const menu = new OptionDialogue(0, {
    executeOption: (option) => {
      player.getPacketSender().sendInterfaceRemoval();
      const follower = options[option - 1];
      if (follower) locate(player, follower);
    },
  }, ...labels).setTitle("Select an option");
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(menu));
}

function askOrLocate(player) {
  const options = trackable(player);
  if (options.length === 1) return locate(player, options[0]);
  choose(player, options);
}

function moved(player) {
  const { DialogueChainBuilder, StatementDialogue, ActionDialogue } = api.core;
  player.sendMessage(MESSAGES.moved);
  const chain = new DialogueChainBuilder();
  chain.add(new StatementDialogue(0, MESSAGES.moved));
  chain.add(new ActionDialogue(1, { execute: () => askOrLocate(player) }));
  player.getDialogueManager().startDialogues(chain);
}

function activate(event) {
  const { player } = event;
  if (event.itemId !== api.core.ItemIdentifiers.ENCHANTED_SYMBOL) return false;
  if (!inWilderness(player)) {
    player.sendMessage(MESSAGES.notHere);
    return true;
  }
  if (!trackable(player).length) return true;
  if (!MageArenaII.getFollowers().every((follower) => locationOf(player, follower))) {
    rotate(player);
  } else if (timerOf(player) <= 0) {
    rotate(player);
    moved(player);
    return true;
  }
  askOrLocate(player);
  return true;
}

/** Destroy, as the Wiki words it. */
function destroyPrompt(prompt) {
  if (prompt.item?.getId?.() !== api.core.ItemIdentifiers.ENCHANTED_SYMBOL) return;
  prompt.warning = "Kolodion will offer you a replacement at the Mage Arena bank.";
}

function resumeTimer({ player }) {
  player.getPacketSender().sendVarbit(TIMER_VARBIT, timerOf(player));
  startTimer(player);
}

module.exports = function registerSymbol(pluginApi) {
  api = pluginApi;
  api.persistAttribute(TIMER_ATTRIBUTE, 0);
  api.persistAttribute(LOCATIONS_ATTRIBUTE);
  api.onItemAction("Enchanted symbol", { Activate: activate });
  api.onCustomEvent("destroy-item:prompt", destroyPrompt);
  api.onPlayerLogin(resumeTimer);
};

Object.assign(module.exports, {
  _test: {
    SPAWN_POINTS, BANDS, TIMER_START, TIMER_STEP_TICKS, TIMER_ATTRIBUTE, LOCATIONS_ATTRIBUTE, MESSAGES, MIN_DAMAGE, MAX_DAMAGE,
    inWilderness, trackable, temperature, rotate, locationOf, readingFor, locate, activate, timerOf, startTimer, destroyPrompt,
  },
});
