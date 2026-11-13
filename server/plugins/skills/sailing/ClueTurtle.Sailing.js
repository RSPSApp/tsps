/**
 * The clue turtle, an ocean encounter (OSRS Wiki: Clue turtle, Ocean encounters).
 *
 * Encounters: while a player's own boat is moving with them aboard, a 120 tick timer (115 with a
 * keg of kraken ink stout on the boat) counts down. At zero an encounter spawns on a 1/6 chance,
 * 2/6 after one failed roll and so on, sure after six. The timer pauses while the boat is still,
 * restarts on a spawn, gets 20 ticks back (up to its full length) each time the player
 * disembarks, and starts over on login. The encounter is one of the Wiki's list by its share;
 * the clue turtle is about 2.5% of them. Ours: the other encounters don't exist yet, so their
 * share spawns nothing. It appears ahead of the bow and is gone after a minute.
 *
 * Retrieve: from the boat's deck, within reach of it. A player at the helm lets go of it (the
 * boat stops as leaving the helm does), walks to the deck tile nearest the turtle and faces it.
 * Then the turtle swims three tiles towards them; on its last stroke the player plays
 * human_pickupfloor_and_wave and the turtle dives. A tick later the clue (a scroll box after X
 * Marks the Spot) is in the inventory with 50 Sailing XP and the box "You find a bottle attached
 * to the turtle. ..." showing it; the turtle is gone the tick after.
 * - The tier, by Sailing level: easy only from 5; at 30 easy 8/20, medium 12/20; at 50 easy 9/20,
 *   medium 6/20, hard 5/20; at 70 easy 9/20, medium 6/20, hard 3/20, elite 2/20.
 * - Under the boat: "You can't interact with something under the boat!"
 * - Another player's turtle, or a tier at its clue limit: the clue warning (if set) and "You can't
 *   take that clue scroll from this turtle." Ours: as a game message; the turtle stays, no XP.
 */
const { hasKeg } = require("./Kegs.Sailing");
const seaCommon = require("./seacombat/Common.SeaCombat");
const Creatures = require("./seacombat/Creatures.SeaCombat");

const CLUE_TURTLE = 15124;
const ENCOUNTER_TICKS = 120;
const STOUT_ENCOUNTER_TICKS = 115;
const DISEMBARK_TICKS = 20;
const ROLL_SIDES = 6;
/** Ocean encounters by their share of spawns (Wiki: Ocean encounters). Only the turtle exists. */
const ENCOUNTERS = Object.freeze([
  { key: "strong_winds", share: 60 },
  { key: "mysterious_glow", share: 12 },
  { key: "lost_crate", share: 12 },
  { key: "castaway", share: 6 },
  { key: "giant_clam", share: 6 },
  { key: "clue_turtle", share: 2.5 },
  { key: "ocean_man", share: 1.2 },
  { key: "lost_casket", share: 0.1 },
]);
/** An encounter's lifetime: a minute. */
const LIFETIME_TICKS = 100;
/** Ours, as live spawns them: 22 to 28 tiles ahead of the bow, near its line. */
const SPAWN_AHEAD = Object.freeze({ min: 22, max: 28 });
const SPAWN_SIDEWAYS = 4;
/** Ours: how far off the boat a turtle can be retrieved (live took one 8 tiles off, refused at 10). */
const REACH = 8;
const SWIM_STEPS = 3;
const XP = 50;
const MIN_LEVEL = 5;
const ANIM_PICK_UP_AND_WAVE = 13078;
const ANIM_DIVE = 13552;
const IGNORE_CLIPPING_FLAG = "movement:ignore-clipping";
const TIERS = Object.freeze([
  { level: 70, weights: { easy: 9, medium: 6, hard: 3, elite: 2 } },
  { level: 50, weights: { easy: 9, medium: 6, hard: 5 } },
  { level: 30, weights: { easy: 8, medium: 12 } },
  { level: MIN_LEVEL, weights: { easy: 1 } },
]);
const UNDER_THE_BOAT = "You can't interact with something under the boat!";
const REFUSED = "You can't take that clue scroll from this turtle.";

let api;
let core;
/** player -> their encounter timer: `{ ticks, failures }`. */
const timers = new WeakMap();
/** turtle npc -> `{ owner, expiresAt, retrieving, walking }`: `walking` is the player on their way to it. */
const turtles = new Map();
let tick = 0;

/** The clue tier a turtle has for this Sailing level, or null below level 5. */
function rollTier(level, random = Math.random) {
  const row = TIERS.find((candidate) => level >= candidate.level);
  if (!row) return null;
  const entries = Object.entries(row.weights);
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
  let roll = random() * total;
  for (const [tier, weight] of entries) {
    if ((roll -= weight) < 0) return tier;
  }
  return entries[entries.length - 1][0];
}

/** Which encounter a successful roll spawns, by share. */
function rollEncounter(random = Math.random) {
  const total = ENCOUNTERS.reduce((sum, encounter) => sum + encounter.share, 0);
  let roll = random() * total;
  for (const encounter of ENCOUNTERS) {
    if ((roll -= encounter.share) < 0) return encounter.key;
  }
  return ENCOUNTERS[ENCOUNTERS.length - 1].key;
}

function timerOf(player, interval = ENCOUNTER_TICKS) {
  let timer = timers.get(player);
  if (!timer) timers.set(player, timer = { ticks: interval, failures: 0 });
  return timer;
}

/**
 * One tick of a moving boat's encounter timer. True when an encounter spawns; the timer starts
 * again either way, a failed roll raising the next one's chance.
 */
function countDown(timer, interval, random = Math.random) {
  timer.ticks = Math.min(timer.ticks, interval) - 1;
  if (timer.ticks > 0) return false;
  timer.ticks = interval;
  if (random() * ROLL_SIDES < timer.failures + 1) {
    timer.failures = 0;
    return true;
  }
  timer.failures = Math.min(ROLL_SIDES - 1, timer.failures + 1);
  return false;
}

function intervalFor(owned) {
  return hasKeg(owned, "kraken_ink_stout") ? STOUT_ENCOUNTER_TICKS : ENCOUNTER_TICKS;
}

/** A sea tile ahead of the boat's bow for an encounter, or null if none there is open water. */
function spawnTile(boat, random = Math.random) {
  const radians = (boat.angle * Math.PI) / 1024;
  const ahead = { x: -Math.sin(radians), y: -Math.cos(radians) };
  for (let attempt = 0; attempt < 8; attempt++) {
    const distance = SPAWN_AHEAD.min + random() * (SPAWN_AHEAD.max - SPAWN_AHEAD.min);
    const sideways = (random() * 2 - 1) * SPAWN_SIDEWAYS;
    const x = Math.round(boat.tileX + ahead.x * distance - ahead.y * sideways);
    const y = Math.round(boat.tileY + ahead.y * distance + ahead.x * sideways);
    if (core.BoatManager.isSailable(x, y, boat.level)) return { x, y, z: boat.level };
  }
  return null;
}

/** Spawns a clue turtle for a player ahead of their boat. */
function spawnTurtle(player, boat, random = Math.random) {
  const tile = spawnTile(boat, random);
  if (!tile) return null;
  const npc = api.spawnNpc({ id: CLUE_TURTLE, ...tile, wanderRadius: 0 });
  if (!npc) return null;
  turtles.set(npc, { owner: player, expiresAt: tick + LIFETIME_TICKS, retrieving: false });
  return npc;
}

function remove(npc) {
  turtles.delete(npc);
  npc.setScriptedMovement?.(false);
  npc.setFlag?.(IGNORE_CLIPPING_FLAG, false);
  if (npc.isRegistered?.()) core.World.getRemoveNPCQueue().push(npc);
}

/** Every moving boat's encounter timer, and turtles whose minute is up. */
function onTick(random = Math.random) {
  tick++;
  for (const [npc, turtle] of turtles) {
    if (!npc.isRegistered?.()) turtles.delete(npc);
    else if (!turtle.retrieving && tick >= turtle.expiresAt) remove(npc);
  }
  for (const boat of core.BoatManager.all()) {
    if (boat.static || boat.moveMode === core.BoatMoveMode.Stopped) continue;
    const player = core.World.getPlayers().get(boat.ownerPlayerId);
    if (!player || core.Sailing.instanceAboard(player) !== boat) continue;
    const interval = intervalFor(core.Sailing.activeBoat(player));
    if (!countDown(timerOf(player, interval), interval, random)) continue;
    if (rollEncounter(random) !== "clue_turtle") continue;
    if (player.getSkillManager().getCurrentLevel(core.Skill.SAILING) < MIN_LEVEL) continue;
    spawnTurtle(player, boat, random);
  }
}

/** Disembarking gives 20 ticks back to the timer; logging out starts it over. */
function onLeft({ player, reason }) {
  if (reason === "logout") return void timers.delete(player);
  if (reason !== "disembark") return;
  const timer = timers.get(player);
  if (timer) timer.ticks = Math.min(ENCOUNTER_TICKS, timer.ticks + DISEMBARK_TICKS);
}

/**
 * Whether an NPC lies under the hull of the boat the player is aboard (any sea NPC can: its
 * options then answer "You can't interact with something under the boat!").
 */
function underTheBoat(player, npc) {
  const boat = core.BoatManager.getBoatAboard(player);
  return !!boat && seaCommon.distanceToBoat(npc, boat) === 0;
}

function later(entity, ticks, action) {
  const { Task, TaskManager } = core;
  TaskManager.submit(new (class extends Task {
    constructor() { super(Math.max(1, ticks), entity, false); }
    execute() {
      this.stop();
      action();
    }
  })());
}

/** Retrieve is reached from the deck. */
function route(event) {
  if (event.npc?.getId?.() !== CLUE_TURTLE || !turtles.has(event.npc)) return;
  event.range = REACH;
  event.ignoreProjectileClip = true;
}

function retrieve(event) {
  const { player, npc } = event;
  const turtle = turtles.get(npc);
  if (npc?.getId?.() !== CLUE_TURTLE || !turtle) return false;
  event.handled = true;
  if (turtle.retrieving || turtle.walking === player || !core.BoatManager.getBoatAboard(player)) return true;
  api.emitCustomEvent("sailing:leave-helm", { player });
  walkThenRetrieve(player, npc, turtle);
  return true;
}

/** The player walks to the deck tile nearest the turtle, then takes the bottle. */
function walkThenRetrieve(player, npc, turtle) {
  const tile = core.BoatManager.deckTileToward(player, npc);
  if (!tile) return void arrive(player, npc, turtle);
  const movement = player.getMovementQueue();
  movement.reset();
  core.PathFinder.calculateWalkRoute(player, tile.getX(), tile.getY());
  const { Task, TaskManager } = core;
  const start = player.getLocation();
  turtle.walking = player;
  TaskManager.submit(new (class extends Task {
    constructor() { super(1, player, false); }
    stop() {
      if (turtle.walking === player) turtle.walking = undefined;
      super.stop();
    }
    execute() {
      if (!turtles.has(npc) || !core.BoatManager.getBoatAboard(player)) return void this.stop();
      const at = player.getLocation();
      if (movement.isMovings?.() || movement.size?.() > 0) return;
      this.stop();
      // Walking elsewhere (a click on the deck) drops it.
      const arrived = at.getX() === tile.getX() && at.getY() === tile.getY();
      if (arrived || (at.getX() === start.getX() && at.getY() === start.getY())) arrive(player, npc, turtle);
    }
  })());
}

function arrive(player, npc, turtle) {
  if (turtles.get(npc) !== turtle || turtle.retrieving) return;
  player.setPositionToFace(npc.getLocation());
  if (underTheBoat(player, npc)) return void player.sendMessage(UNDER_THE_BOAT);
  const tier = rollTier(player.getSkillManager().getCurrentLevel(core.Skill.SAILING));
  const allowed = { player, tier, allowed: null };
  if (tier) api.emitCustomEvent("treasure-trails:can-receive", allowed);
  if (!tier || turtle.owner !== player || allowed.allowed === false) {
    if (tier) api.emitCustomEvent("treasure-trails:missed-clue", { player, tier });
    player.sendMessage(REFUSED);
    return;
  }
  turtle.retrieving = true;
  npc.setScriptedMovement?.(true);
  npc.setFlag?.(IGNORE_CLIPPING_FLAG, true);
  for (let stroke = 1; stroke <= SWIM_STEPS; stroke++) {
    later(npc, stroke, () => {
      if (turtles.get(npc) !== turtle) return;
      const towards = core.BoatManager.rootLocation(player);
      Creatures.step(npc, towards.getX(), towards.getY());
      if (stroke !== SWIM_STEPS) return;
      player.setPositionToFace(npc.getLocation());
      player.performAnimation(new core.Animation(ANIM_PICK_UP_AND_WAVE));
      npc.performAnimation(new core.Animation(ANIM_DIVE));
    });
  }
  later(player, SWIM_STEPS + 1, () => reward(player, tier));
  later(npc, SWIM_STEPS + 2, () => remove(npc));
}

/** The bottle's clue: a scroll box once X Marks the Spot is done. */
function reward(player, tier) {
  const award = { player, itemId: core.ItemIdentifiers[`CLUE_SCROLL_${tier.toUpperCase()}_`], box: false };
  api.emitCustomEvent("treasure-trails:clue-item", award);
  player.getInventory().forceAdd(player, new core.Item(award.itemId, 1));
  player.getSkillManager().addExperiences(core.Skill.SAILING, XP);
  const article = tier === "easy" || tier === "elite" ? "an" : "a";
  const { DialogueChainBuilder, ItemStatementDialogue } = core;
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(new ItemStatementDialogue(0, award.itemId,
    `You find a bottle attached to the turtle. It has ${article} ${tier} clue scroll inside! You take the bottle and the turtle dives away. You give it a wave goodbye!`)));
}

/** ::clueturtle - a clue turtle ahead of the boat you're aboard. */
function command({ player }) {
  const boat = core.Sailing.instanceAboard(player) ?? core.BoatManager.getBoatAboard(player);
  if (!boat) return void player.sendMessage("Board a boat first.");
  if (!spawnTurtle(player, boat)) player.sendMessage("No open water ahead.");
}

function onLogout({ player }) {
  timers.delete(player);
}

/** The encounter timers and turtle lifetimes run every tick. */
function startTicking() {
  const { Task, TaskManager } = core;
  TaskManager.submit(new (class extends Task {
    constructor() { super(1, false); }
    execute() { onTick(); }
  })());
}

function attach(pluginApi) {
  api = pluginApi;
  core = api.core;
  seaCommon.init(api);
}

module.exports = {
  CLUE_TURTLE,
  ENCOUNTERS,
  rollTier,
  rollEncounter,
  countDown,
  underTheBoat,
  turtles,
  timers,
  onTick,
  attach,
  register(pluginApi) {
    attach(pluginApi);
    api.onServerStartup(startTicking);
    api.onNpcRoute(route);
    api.onAnyNpcInteraction({ Retrieve: retrieve });
    api.onCustomEvent("sailing:left", onLeft);
    api.onPlayerLogout(onLogout);
    api.registerCommand("clueturtle", command, core.PlayerRights.DEVELOPER, "Spawn a clue turtle ahead of your boat");
  },
};
