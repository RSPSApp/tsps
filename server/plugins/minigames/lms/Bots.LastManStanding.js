/**
 * Last Man Standing bots, so a world without 24 players can still have a game (world config
 * `LastManStanding:seedBots`, on by default: a game needs a full waiting area):
 * - while a real player waits for a mode, PvP bots join its waiting area up to the minimum;
 * - in the arena they fight on the PlayerBots runtime's own PvP brain (specs, switches, prayers,
 *   freezes, eating), as Bounty Hunter's do; this unit picks their fights (the nearest free
 *   survivor) and, once the fog closes in, walks them back into the safe zone;
 * - they never retreat or teleport out, and log out once their game is over for them.
 */
const Common = require("./Common.LastManStanding");
const Match = require("./Match.LastManStanding");
const Lobby = require("./Lobby.LastManStanding");
const Fog = require("./Fog.LastManStanding");
const Loot = require("./Loot.LastManStanding");
const Stash = require("./Stash.LastManStanding");
const { getActiveBotRuntime } = require("../../bots/runtime/RuntimeRegistry.PlayerBots");
const { startActivity } = require("../../bots/brain/BrainActivities.PlayerBots");
const { setModePvp } = require("../../bots/behaviours/state/State.PlayerBots");

const SEED_BOTS_CONFIG = "LastManStanding:seedBots";
const BOT_ATTRIBUTE = "last-man-standing:bot";
const MODE_ATTRIBUTE = "last-man-standing:bot-mode";
const LOGGING_OUT_ATTRIBUTE = "last-man-standing:bot-logging-out";
const PVP_ACTIVITY = "pvp";
const HOLD_MS = 2 * 60 * 1000;
const DECIDE_MS = 1800;
const ENGAGE_DISTANCE = 12;
const CHASE_STEP = 20;
const WANDER_RADIUS = 10;
const KEY_DELAY = 5;
/** Spawned bots the lobby hasn't seen in the waiting area yet (they count as waiting). */
const pending = new Map();
const PENDING_TICKS = 10;
const nextDecisionAt = new WeakMap();
let serial = 0;
let clock = 0;

function isBot(player) {
  return player?.getAttribute?.(BOT_ATTRIBUTE) === true;
}

function seeding() {
  return Common.api.getPluginConfig(SEED_BOTS_CONFIG, true) !== false;
}

function stateOf(player) {
  return getActiveBotRuntime().runtime?.botStatesByName?.get(player.getUsername()) ?? null;
}

function spawnBot(at) {
  const { runtime, behaviorMode } = getActiveBotRuntime();
  if (!runtime) return null;
  const bot = runtime.spawnPvpBot(at, { username: `LmsBot${++serial}`, activity: "last-man-standing", mode: behaviorMode.PVP });
  if (!bot) return null;
  bot.setAttribute(BOT_ATTRIBUTE, true);
  Lobby.follow({ player: bot, location: at });
  // Waiting like a player: nothing carried, and no brain (which would wander off to the
  // Wilderness and re-gear an empty bot) until the game starts.
  Stash.save(bot);
  bot.getMovementQueue().setBlockMovement(true);
  return bot;
}

function waitingTile(mode) {
  const [x0, y0, x1, y1] = mode.waiting;
  return new Common.core.Location(Common.randomInt(x0 + 1, x1 - 1), Common.randomInt(y0 + 1, y1 - 1), mode.plane);
}

/** Called by the lobby each tick for each mode: fill its waiting area to `min` while a real player waits. */
function seed(mode, queued, min) {
  for (const [bot, entry] of pending) {
    if (entry.mode === mode && (queued.includes(bot) || clock - entry.at > PENDING_TICKS)) pending.delete(bot);
  }
  const waitingFor = [...pending.values()].filter((entry) => entry.mode === mode).length;
  if (!seeding() || queued.length + waitingFor >= min || !queued.some((player) => !isBot(player))) return;
  // One a tick: the waiting area fills over a few seconds, as players arrive.
  const bot = spawnBot(waitingTile(mode));
  if (bot) {
    bot.setAttribute(MODE_ATTRIBUTE, mode.key);
    pending.set(bot, { at: clock, mode });
  }
}

/**
 * Once a tick, after the modes: bots that wander out of their waiting area are put back while a
 * real player waits for that mode; otherwise they leave.
 */
function tidy(about) {
  clock++;
  for (const player of about) {
    if (!isBot(player) || pending.has(player) || Match.gameOf(player)) continue;
    const mode = Lobby.modeOf(player.getAttribute(MODE_ATTRIBUTE));
    if (!mode || !Lobby.queued(mode).some((other) => !isBot(other))) logout(player);
    else if (Lobby.waitingMode(player) !== mode) player.moveTo(waitingTile(mode));
  }
}

function alive(mobile) {
  return Boolean(mobile) && mobile.isRegistered?.() !== false && mobile.getHitpoints?.() > 0;
}

function fighting(player) {
  const combat = player.getCombat();
  return alive(combat.getTarget?.()) || alive(combat.getAttacker?.());
}

function distance(a, b) {
  const p = a.getLocation();
  const q = b.getLocation();
  return Math.max(Math.abs(p.getX() - q.getX()), Math.abs(p.getY() - q.getY()));
}

/** Single combat: someone fighting another is not up for grabs. */
function engagedElsewhere(other, bot) {
  const combat = other.getCombat();
  return [combat.getTarget?.(), combat.getAttacker?.()].some((mobile) => mobile !== bot && alive(mobile));
}

function quarryOf(game, bot) {
  let best = null;
  for (const other of game.alive) {
    if (other === bot || !alive(other) || engagedElsewhere(other, bot)) continue;
    if (!best || distance(bot, other) < distance(bot, best)) best = other;
  }
  return best;
}

function walkToward(bot, x, y, step) {
  const from = bot.getLocation();
  const dx = x - from.getX();
  const dy = y - from.getY();
  const scale = Math.min(1, step / Math.max(Math.abs(dx), Math.abs(dy), 1));
  bot.setRunning(true);
  Common.core.PathFinder.calculateWalkRoute(bot, from.getX() + Math.round(dx * scale), from.getY() + Math.round(dy * scale));
}

/** Out of a fight: back into the safe zone if the fog has them, else the nearest free survivor. */
function act(game, bot, nowMs) {
  if (!game.begun || nowMs < (nextDecisionAt.get(bot) ?? 0) || fighting(bot)) return;
  nextDecisionAt.set(bot, nowMs + DECIDE_MS);
  if (game.fog && Fog.depthOf(game, bot) > 0) {
    const centre = game.area.at([...game.zone.centre, 0]);
    walkToward(bot, centre.getX(), centre.getY(), CHASE_STEP);
    return;
  }
  const state = stateOf(bot);
  const quarry = quarryOf(game, bot);
  if (!state?.pvp || !quarry) {
    if (bot.getMovementQueue().size() === 0) {
      const here = bot.getLocation();
      walkToward(bot, here.getX() + Common.randomInt(-WANDER_RADIUS, WANDER_RADIUS), here.getY() + Common.randomInt(-WANDER_RADIUS, WANDER_RADIUS), WANDER_RADIUS);
    }
    return;
  }
  if (state.pvp.targetPlayer !== quarry) {
    setModePvp(bot, state, quarry, nowMs, HOLD_MS, getActiveBotRuntime().behaviorMode, { allowInCombatTransition: true });
  }
  if (distance(bot, quarry) > ENGAGE_DISTANCE) walkToward(bot, quarry.getLocation().getX(), quarry.getLocation().getY(), CHASE_STEP);
}

function tick(game) {
  // Nobody real left to watch it: the game ends there, the bots leave.
  if (game.begun && [...game.alive].every(isBot)) {
    game.finish();
    return;
  }
  const nowMs = Date.now();
  for (const player of game.alive) {
    if (isBot(player) && alive(player)) act(game, player, nowMs);
  }
}

/** No retreat or teleport home in the arena: they fight to the end. */
function defensiveAction(request) {
  if (!isBot(request.player) || !Match.gameOf(request.player)) return;
  request.result = { handled: false, status: "running" };
}

/** Out of the game (dead or done): the bot leaves the world; it is replaced next game. */
function released(game) {
  for (const player of game.players) {
    if (isBot(player) && !Match.gameOf(player)) logout(player);
  }
}

function logout(bot) {
  if (bot.getAttribute?.("last-man-standing:logging-out")) return;
  bot.setAttribute?.("last-man-standing:logging-out", true);
  Common.later(2, () => {
    bot.getForcedLogoutTimer().start(0);
    bot.requestLogout();
  });
}

/** A bot spends its key straight away (it doesn't go looking for a chest), and wears what it finds. */
function killed(game, killer) {
  if (!isBot(killer)) return;
  Common.later(KEY_DELAY, () => {
    if (game.over || !game.alive.has(killer) || !Loot.claim(game, killer)) return;
    wearFinds(killer);
  });
}

/** Equips loot that's better than nothing in its slot (the brain switches weapons itself). */
function wearFinds(bot) {
  const { Item } = Common.core;
  const inventory = bot.getInventory();
  const equipment = bot.getEquipment();
  inventory.getItems().forEach((item, slot) => {
    if (!item || item.getId() <= 0) return;
    const type = Common.core.ItemDefinition.forId(item.getId())?.getEquipmentType();
    const at = type?.getSlot() ?? -1;
    const { Equipment } = Common.core;
    if (at < 0 || at === Equipment.WEAPON_SLOT || at === Equipment.SHIELD_SLOT || at === Equipment.AMMUNITION_SLOT) return;
    const worn = equipment.getItems()[at];
    inventory.setItem(slot, worn && worn.getId() > 0 ? new Item(worn.getId(), worn.getAmount()) : new Item(-1, 0));
    equipment.setItem(at, new Item(item.getId(), item.getAmount()));
  });
  inventory.refreshItems();
  equipment.refreshItems();
  Common.core.BonusManager.update(bot);
  bot.getUpdateFlag().flag(Common.core.Flag.APPEARANCE);
}

/** The game starts: each bot's PvP brain, from where it stands. */
function gameStarted(game) {
  for (const bot of game.players) {
    if (!isBot(bot)) continue;
    const at = bot.getLocation();
    startActivity(bot, PVP_ACTIVITY, { home: { x: at.getX(), y: at.getY(), z: at.getZ() } });
  }
}

function gameEnded(game) {
  Common.later(1, () => released(game));
}

function died(game, victim) {
  if (isBot(victim)) Common.later(1, () => logout(victim));
}

function forget({ player }) {
  pending.delete(player);
}

function attachBots(api) {
  Lobby.bots.seed = seed;
  Lobby.bots.tidy = tidy;
  Lobby.bots.isBot = isBot;
  Match.onTick(tick);
  Match.onDeath(died);
  Match.onKill(killed);
  Match.onStart(gameStarted);
  Match.onEnd(gameEnded);
  api.onCustomEvent("player-bots:pvp-defensive-action", defensiveAction);
  api.onPlayerLogout(forget);
}

module.exports = { attachBots, seed, tidy, isBot, spawnBot, act };
