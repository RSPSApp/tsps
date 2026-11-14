/**
 * Soul Wars bots, so a world without twenty players can still have a game (world config
 * `SoulWars:seedBots`, off by default as Castle Wars' is):
 * - while a real player waits, bots join the waiting area up to the minimum (reusing the ones
 *   already in the lobby);
 * - in a game each bot has a role, and fights any enemy close by first:
 *   - fragments: hunts Forgotten Souls, then charges the obelisk with what it carries;
 *   - capture: holds the first of the obelisk and graveyards its team doesn't;
 *   - attack: goes for the enemy avatar once it is weak, else captures;
 * - a bot leaves its base and its sanctuary through the barriers, bandages itself when hurt and
 *   is never removed for inactivity.
 * Bots pocket their kills' fragments rather than picking them off the floor.
 */
const Common = require("./Common.SoulWars");
const Match = require("./Match.SoulWars");
const Control = require("./Control.SoulWars");
const Souls = require("./Souls.SoulWars");
const Death = require("./Death.SoulWars");
const Supplies = require("./Supplies.SoulWars");
const Lobby = require("./Lobby.SoulWars");
const { createBotPlayer } = require("../../bots/behaviours/spawn/PlayerFactory.PlayerBots");
const { ATTR_SKIP_PERSISTENCE } = require("../../bots/runtime/PersistenceConstants.PlayerBots");
const { applyGeneratedPvpLoadout } = require("../../bots/behaviours/policies/PvpLoadoutPolicy.PlayerBots");
const { buildRoamingPvpMetadata } = require("../../bots/behaviours/pvp/PvpAssignment.PlayerBots");
const { isFoodItem } = require("../../items/Food.plugin");
const { planRoute } = require("../../bots/behaviours/navigation/LongRoutePlanner.PlayerBots");

const SEED_BOTS_CONFIG = "SoulWars:seedBots";
const BOT_ATTRIBUTE = "soul-wars:bot";
const ROLES = ["fragments", "capture", "attack"];
/** Where a bot leaves its base: the barrier, the tile inside it, and which side is inside. */
const BASE_EXITS = {
  blue: { barrier: [2140, 2911], inside: [2140, 2910], within: ([x, y]) => x >= 2137 && x <= 2142 && y >= 2899 && y <= 2910 },
  red: { barrier: [2279, 2919], inside: [2278, 2919], within: ([x, y]) => x >= 2272 && x <= 2278 && y >= 2914 && y <= 2924 },
};
const ENGAGE = 5;
const WALK_RETRY = 3;
const REPLAN_TICKS = 50;
/** Collision: a loc or a blocked floor (as the route planner reads them). */
const BLOCKED = 0x200000;
const STAND_BLOCKED = 0x100 | 0x200000 | 0x40000;
const FRAGMENTS_TO_CHARGE = 6;
const GIVE_UP_TICKS = 30;
const SKIP_TICKS = 200;
const ATTACK_BELOW = 50;
const HEAL_BELOW = 0.5;
const START_BANDAGES = 5;

const states = new Map();
/** Bots made for the queue that the world hasn't added yet (they count as waiting). */
const spawned = new Map();
const PENDING_TICKS = 10;
/** How a bot is made and walked (a test swaps them). */
const engine = {
  create: (username, at) => createBotPlayer(username, at, { api: Common.api, activity: "soul-wars", loadPersistence: false, saveRandomizedAppearance: false }),
  walk: (player, location) => Common.core.PathFinder.calculateWalkRoute(player, location.getX(), location.getY()),
  plan: (game, from, to) => planRoute({ from, to, getFlag: (x, y, z) => flag(game, x, y, z) }),
  gear: (bot) => applyGeneratedPvpLoadout(bot, { pvp: buildRoamingPvpMetadata({ excludeF2p: true }) }, { api: Common.api }),
};
let serial = 0;
let roles = 0;
let clock = 0;

function isBot(player) {
  return player?.isPlayerBot?.() === true && player.getAttribute?.(BOT_ATTRIBUTE) === true;
}

function seeding() {
  return Common.api.getPluginConfig?.(SEED_BOTS_CONFIG, false) === true;
}

function spawnBot(at) {
  const username = `SWBot${++serial}`;
  const bot = engine.create(username, at);
  if (!bot) return null;
  spawned.set(bot, clock);
  bot.setPlayerBot(true);
  bot.setAttribute(ATTR_SKIP_PERSISTENCE, true);
  bot.setAttribute(BOT_ATTRIBUTE, true);
  bot.setRunning?.(true);
  engine.gear(bot);
  stripFood(bot);
  Common.api.emitPlayerLogin?.({ player: bot, username });
  return bot;
}

/** An instance tile's collision; past the arena's edge is blocked (the map there is empty). */
function flag(game, x, y, z) {
  const [cx, cy] = Common.data.arena.chunk;
  const [w, h] = Common.data.arena.size;
  const [tx, ty] = game.area.templateOf(new Common.core.Location(x, y, z));
  if (tx < cx * 8 || ty < cy * 8 || tx >= (cx + w) * 8 || ty >= (cy + h) * 8) return BLOCKED;
  return Common.core.RegionManager.getClipping(x, y, z, game.area);
}

/** A template tile in the box [x0, y0, x1, y1] a bot can stand on, picked at random (so bots spread). */
function standTile(game, [x0, y0, x1, y1]) {
  const open = [];
  for (let x = x0; x <= x1; x++) {
    for (let y = y0; y <= y1; y++) {
      const at = game.area.at([x, y, 0]);
      if ((flag(game, at.getX(), at.getY(), 0) & STAND_BLOCKED) === 0) open.push([x, y]);
    }
  }
  return open.length ? Common.pick(open) : [Math.round((x0 + x1) / 2), Math.round((y0 + y1) / 2)];
}

/** No food or potions in Soul Wars (the entry rules): the arena's bandages are what a bot heals with. */
function stripFood(bot) {
  const inventory = bot.getInventory();
  const potion = (id) => /\(\d\)$/.test(Common.core.ItemDefinition.forId(id)?.getName?.() ?? "");
  for (const item of inventory.getValidItems?.() ?? []) {
    const id = item?.getId?.() ?? -1;
    if (id > 0 && (isFoodItem(id) || potion(id))) inventory.delete(id, inventory.getAmount(id));
  }
}

/** Called by the lobby each tick: fill the waiting area to `min` while a real player waits. */
function seed(queued, min, lobbyPlayers) {
  // A new bot counts as waiting until the lobby sees it there (or it never arrives).
  for (const [bot, at] of spawned) if (queued.includes(bot) || clock - at > PENDING_TICKS) spawned.delete(bot);
  if (!seeding() || queued.length + spawned.size >= min || !queued.some((player) => !isBot(player))) return;
  const [x0, y0, x1, y1] = Common.data.lobby.waiting;
  const spot = () => new Common.core.Location(Common.randomInt(x0, x1), Common.randomInt(y0, y1), 0);
  let missing = min - queued.length - spawned.size;
  for (const player of lobbyPlayers) {
    if (missing <= 0) return;
    if (isBot(player) && !queued.includes(player)) {
      player.moveTo(spot());
      missing--;
    }
  }
  for (; missing > 0; missing--) spawnBot(spot());
}

function inside(game, player) {
  return game.area.templateOf(player.getLocation());
}

function near([x, y], [tx, ty], range) {
  return Math.max(Math.abs(x - tx), Math.abs(y - ty)) <= range;
}

/**
 * Toward [x, y]: the whole route is planned once over the arena's collision (the walls round the
 * obelisk defeat the pather's short search), then walked a waypoint at a time; a move under way is
 * left alone, and a bot that stops getting closer plans again.
 */
function walk(game, player, state, [x, y]) {
  if (clock < state.nextWalk || player.getMovementQueue?.().size?.() > 0) return;
  state.nextWalk = clock + WALK_RETRY;
  const here = player.getLocation();
  const goal = game.area.at([x, y, 0]);
  if (!state.route || state.route.goal !== `${x},${y}` || clock > state.route.until) {
    const plan = engine.plan(game, { x: here.getX(), y: here.getY(), z: here.getZ() }, { x: goal.getX(), y: goal.getY() });
    state.route = { goal: `${x},${y}`, waypoints: plan?.waypoints ?? [], until: clock + REPLAN_TICKS };
  }
  const { waypoints } = state.route;
  while (waypoints.length && Math.max(Math.abs(waypoints[0].x - here.getX()), Math.abs(waypoints[0].y - here.getY())) <= 1) waypoints.shift();
  const next = waypoints[0];
  engine.walk(player, next ? new Common.core.Location(next.x, next.y, here.getZ()) : goal);
}

/** A barrier click as a player would make it (the bot stands beside it). */
function pass(game, player, tile, id) {
  const object = { getLocation: () => game.area.at([tile[0], tile[1], 0]), getId: () => id };
  Death.pass({ player, object });
}

function enemies(game, player, range) {
  const team = game.teamOf(player);
  const here = player.getLocation();
  return game.players().filter((other) => {
    if (game.teamOf(other) === team || game.isGhost?.(other)) return false;
    const there = other.getLocation();
    return there.getZ() === here.getZ() && Math.max(Math.abs(there.getX() - here.getX()), Math.abs(there.getY() - here.getY())) <= range;
  });
}

function attack(player, target) {
  const combat = player.getCombat?.();
  if (!combat || combat.getTarget?.() === target) return true;
  combat.attack?.(target);
  return true;
}

/** Fragments: hunt the nearest Forgotten Soul; with enough, take them to the obelisk. */
function hunt(game, player, state) {
  if (player.getInventory().getAmount(Common.data.items.fragment) >= FRAGMENTS_TO_CHARGE) {
    const [x, y] = Common.data.obelisk.tile;
    if (near(inside(game, player), [x, y], 3)) {
      Souls.sacrifice({ player });
      return;
    }
    state.altar ??= standTile(game, [x - 3, y - 3, x + 3, y + 3]);
    walk(game, player, state, state.altar);
    return;
  }
  const here = player.getLocation();
  // A soul it can't get at (across the water) is given up on for a while.
  const prey = state.prey;
  if (prey && clock - prey.since > GIVE_UP_TICKS && prey.npc.getHitpoints?.() === prey.hp) {
    state.skip = { npc: prey.npc, until: clock + SKIP_TICKS };
    state.prey = null;
  }
  let best = null;
  for (const [npc, found] of Souls.CREATURE_OF) {
    if (found.game !== game || found.kind === "wolf" || !npc.isRegistered?.()) continue;
    if (state.skip?.npc === npc && clock < state.skip.until) continue;
    const d = Math.abs(npc.getLocation().getX() - here.getX()) + Math.abs(npc.getLocation().getY() - here.getY());
    if (!best || d < best[1]) best = [npc, d];
  }
  if (!best) return;
  const [npc] = best;
  if (state.prey?.npc !== npc || npc.getHitpoints?.() !== state.prey.hp) state.prey = { npc, since: clock, hp: npc.getHitpoints?.() };
  attack(player, npc);
}

/** Capture: the first place the team doesn't hold, held by standing in it. */
function capture(game, player, state) {
  const team = game.teamOf(player);
  const place = Control.PLACES.find((name) => Control.holder(game, name) !== team) ?? "obelisk";
  const zone = Common.data.control[place].zone;
  if (Common.inBox(player.getLocation(), boxIn(game, zone))) return;
  if (state.post?.place !== place) state.post = { place, tile: standTile(game, zone) };
  walk(game, player, state, state.post.tile);
}

/** A template box's instance bounds. */
function boxIn(game, [x0, y0, x1, y1]) {
  const a = game.area.at([x0, y0, 0]);
  const b = game.area.at([x1, y1, 0]);
  return [a.getX(), a.getY(), b.getX(), b.getY()];
}

function assault(game, player, state) {
  const enemy = Common.other(game.teamOf(player));
  const avatar = game.avatars?.[enemy];
  if (!avatar?.alive || avatar.strength > ATTACK_BELOW) {
    capture(game, player, state);
    return;
  }
  attack(player, avatar.npc);
}

function act(game, player) {
  const team = game.teamOf(player);
  let state = states.get(player);
  if (!state) {
    state = { role: ROLES[roles++ % ROLES.length], nextWalk: 0 };
    states.set(player, state);
  }
  game.active?.(player);
  if (game.isGhost?.(player)) return;
  const at = inside(game, player);
  for (const yard of Object.values(Common.data.graveyards)) {
    if (yard.respawn.some(([x, y]) => x === at[0] && y === at[1])) {
      const distance = ([x, y]) => Math.abs(x - at[0]) + Math.abs(y - at[1]);
      const [bx, by] = yard.barrierTiles.reduce((best, tile) => (distance(tile) < distance(best) ? tile : best));
      pass(game, player, [bx, by], yard.barriers.neutral);
      return;
    }
  }
  const exit = BASE_EXITS[team];
  if (exit.within(at)) {
    // Its own barrier lets it straight through, as the Pass option would (Death.pass).
    if (at[0] === exit.inside[0] && at[1] === exit.inside[1]) player.moveTo(game.area.at([2 * exit.barrier[0] - at[0], 2 * exit.barrier[1] - at[1], 0]));
    else walk(game, player, state, exit.inside);
    return;
  }
  const hp = player.getHitpoints?.() ?? 1;
  const max = Common.maxLevel(player, "HITPOINTS");
  if (hp < max * HEAL_BELOW && player.getInventory().contains(Common.data.items.bandages)) {
    Supplies.heal({ player, itemId: Common.data.items.bandages });
  }
  const [foe] = enemies(game, player, ENGAGE);
  if (foe) {
    attack(player, foe);
    return;
  }
  if (state.role === "fragments") hunt(game, player, state);
  else if (state.role === "attack") assault(game, player, state);
  else capture(game, player, state);
}

function tick() {
  clock++;
  const game = Match.current;
  if (!game || game.over) return;
  for (const player of game.players()) if (isBot(player)) act(game, player);
}

/** A bot's kill: the fragments (or bones) go straight into its pack. */
function pocketDrops(event) {
  const player = event.player;
  if (!isBot(player)) return;
  for (const { itemId, amount } of event.drops) player.getInventory().add(new Common.core.Item(itemId, amount), true);
  event.drops.length = 0;
}

/** What a player would take from their base's table first (bots never click it). */
function supply(game) {
  for (const player of game.players()) {
    if (!isBot(player)) continue;
    const inventory = player.getInventory();
    const count = Math.min(START_BANDAGES, inventory.getFreeSlots());
    for (let i = 0; i < count; i++) inventory.add(new Common.core.Item(Common.data.items.bandages, 1), false);
    inventory.refreshItems?.();
  }
}

function forget({ player }) {
  states.delete(player);
}

function attachBots(api) {
  Lobby.bots.isBot = isBot;
  Lobby.bots.seed = seed;
  Souls.onDrops(pocketDrops);
  Match.onStart(supply);
  api.onPlayerLogout(forget);
  Common.every(tick);
}

module.exports = { attachBots, seed, isBot, act, pocketDrops, spawnBot, engine, states, ROLES, BASE_EXITS, BOT_ATTRIBUTE, START_BANDAGES };
