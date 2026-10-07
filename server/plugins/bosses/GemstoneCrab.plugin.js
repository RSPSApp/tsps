/**
 * Gemstone Crab (npc 14779) - a timed world boss in the Tlati Rainforest.
 *
 * It rises at one of three mines and stays about ten minutes; its hitpoints are that time, so
 * hits show but never lower it (OSRS Wiki: the bar is a timer, not damage). Then it burrows,
 * leaving a shell (npc 14780) that the 16 players who dealt it the most damage may mine once
 * each for three uncut gems, and rises at another mine. Each mine's cave leads to the crab.
 * It hits for at most 1 (crush, every 7 ticks), switching between players in reach; the
 * centre tile of its 5x5 is safe. Combat XP against it is 87.5%.
 *
 * Behaviour from the OSRS Wiki; the cave crawl, animations, HUD and one spot from a live
 * capture (docs/gemstone-crab.md); the rest of the design follows OpenRune-Server's
 * gemstone-crab module (https://github.com/OpenRune/OpenRune-Server, ISC).
 */
const { Location } = require("../../src/main/typescript/elvarg/game/model/Location");
const { Animation } = require("../../src/main/typescript/elvarg/game/model/Animation");
const { Graphic } = require("../../src/main/typescript/elvarg/game/model/Graphic");
const { GameObject } = require("../../src/main/typescript/elvarg/game/entity/impl/object/GameObject");
const { ObjectManager } = require("../../src/main/typescript/elvarg/game/entity/impl/object/ObjectManager");
const { Item } = require("../../src/main/typescript/elvarg/game/model/Item");
const { ItemDefinition } = require("../../src/main/typescript/elvarg/game/definition/ItemDefinition");
const { HitDamage } = require("../../src/main/typescript/elvarg/game/content/combat/hit/HitDamage");
const { HitMask } = require("../../src/main/typescript/elvarg/game/content/combat/hit/HitMask");
const { Task } = require("../../src/main/typescript/elvarg/game/task/Task");
const { TaskManager } = require("../../src/main/typescript/elvarg/game/task/TaskManager");
const { World } = require("../../src/main/typescript/elvarg/game/World");
const { PlayerRights } = require("../../src/main/typescript/elvarg/game/model/rights/PlayerRights");
const { findBestPickaxe } = require("../skills/Mining.plugin");

const CRAB = 14779;
const SHELL = 14780;
const CAVE = 57631;

/**
 * The three mines: the crab's south-west tile, the mine's cave, where crawling to it lands, and
 * the area whose players see the crab's HUD. Captured: every crab tile but none is a guess
 * (mines 1 and 2 match OpenRune's), and the landings at mines 1 and 3 (OpenRune's were a tile
 * off). Mine 2's landing and every area are OpenRune's.
 */
const SPOTS = [
  { crab: [1271, 3171], cave: [1278, 3167], exit: [1277, 3168], area: { minX: 1258, maxX: 1284, minY: 3158, maxY: 3184 } },
  { crab: [1351, 3110], cave: [1350, 3123], exit: [1351, 3122], area: { minX: 1338, maxX: 1364, minY: 3096, maxY: 3124 } },
  { crab: [1238, 3041], cave: [1245, 3035], exit: [1246, 3038], area: { minX: 1224, maxX: 1250, minY: 3029, maxY: 3055 } },
];

/** Its lifetime in ticks: about ten minutes (Wiki); captured 1073 and 1086, OpenRune 918-967. */
const LIFETIME_TICKS = [918, 1086];
/**
 * After it burrows (as captured): 2 ticks to the announcement and the shell's blocking loc,
 * 4 to the shell and who may mine it, 8 to the HUD fading, and 29 to the next crab rising
 * elsewhere - while the shell stays its 90 seconds (Wiki).
 */
const BURROW = { announce: 2, shell: 4, hudFadeIn: [1, 2, 3], hudFadeOut: 8, hudClear: 11, nextCrab: 29 };
const SHELL_TICKS = 150;
const SHELL_DISINTEGRATE_TICKS = 4;
/** OpenRune replays the shell's idle graphic 13 ticks in, then every 14 (not captured). */
const SHELL_SPOT_FIRST = 13;
const SHELL_SPOT_INTERVAL = 14;
const TOP_MINERS = 16;
const ATTACK_TICKS = 7;
const MAX_HIT = 1;
const HOLD_ATTACKS = [3, 6];
const SIZE = 5;
const COMBAT_XP_MULTIPLIER = 0.875;
/** Headbar 20 is 120 wide; the crab's bar is its time left. */
const HEALTH_BAR = { id: 20, width: 120 };

const ANIM = { spawn: 12481, burrow: 12482, attack: 12483, shellDisintegrate: 12484 };
/** vfx_crab_boss_death (on burrowing and on rising) and the shell's idle graphic. */
const GRAPHIC = { burrowOrRise: 3454, shellIdle: 3452 };
/** An invisible 5x5 blocking loc under the shell. */
const SHELL_BLOCKER = 32740;

/** The boss HUD (the BossHud plugin): faded out on leaving the mine, then hidden 2 ticks later. */
const HUD = { hideAfterFadeTicks: 2 };

const CRAWL = { anim: 11580, sound: 2454, soundLoops: 3, soundDelay: 4, fadeCycles: 50 };
const OVERLAY_ATMOSPHERE_UID = (161 << 16) | 1;
const FADE_OVERLAY = 174;
const SCRIPT_FADE = 948;
const VARBIT_MINIMAP_STATE = 6719;

/** Uncut gems: 3 rolls, uncut dragonstone 1/500, else by weight out of 32 (Wiki). */
const GEMS = [[1625, 9], [1627, 9], [1629, 6], [1623, 3], [1621, 2], [1619, 2], [1617, 1]];
const GEM_TOTAL = 32;
const UNCUT_DRAGONSTONE = 1631;
const DRAGONSTONE_CHANCE = 500;
const GEM_ROLLS = 3;
const MINE_TICKS = 3;

let pluginApi;
let ItemOnGroundManager;

const state = {
  tick: 0,
  /** The crab's mine, and the mine the next crab rises at (chosen as it burrows). */
  spot: -1,
  nextSpot: -1,
  crab: null,
  lifetime: 0,
  endsAt: 0,
  /** The burrow under way: its tick, mine and the damage it was ranked by. */
  burrow: null,
  /** username -> damage dealt to the current crab */
  damage: new Map(),
  /** The shell: its npc, blocking loc, timers and who may (and did) mine it. */
  shell: null,
  attack: { target: null, holdUntil: 0, nextAt: 0 },
};
/** Players in each spot's area, who see the HUD while the crab is there. */
const inArea = SPOTS.map(() => new Set());

function random(min, max) {
  return min + Math.floor(Math.random() * (max - min + 1));
}

function crabActive() {
  return state.crab != null && state.burrow == null;
}

function pickSpot(not) {
  let spot;
  do spot = Math.floor(Math.random() * SPOTS.length); while (spot === not && SPOTS.length > 1);
  return spot;
}

function spawnCrab() {
  state.spot = state.nextSpot >= 0 ? state.nextSpot : pickSpot(state.spot);
  state.nextSpot = -1;
  const [x, y] = SPOTS[state.spot].crab;
  const npc = pluginApi.spawnNpc({ id: CRAB, x, y, z: 0, wanderRadius: 0 });
  if (!npc) return;
  state.lifetime = random(...LIFETIME_TICKS);
  state.endsAt = state.tick + state.lifetime;
  state.damage = new Map();
  state.attack = { target: null, holdUntil: 0, nextAt: state.tick + ATTACK_TICKS };
  // Its own attacks below; core combat neither moves it nor attacks with it.
  npc.setScriptedMovement(true);
  npc.setHitpointsLocked(true);
  npc.setMaxHitpoints(state.lifetime);
  npc.setHitpoints(state.lifetime);
  npc.setHealthBar(HEALTH_BAR);
  npc.setCombatXpMultiplier(COMBAT_XP_MULTIPLIER);
  npc.performAnimation(new Animation(ANIM.spawn));
  npc.performGraphic(new Graphic(GRAPHIC.burrowOrRise));
  state.crab = npc;
  for (const player of inArea[state.spot]) showHud(player);
}

function startBurrow() {
  state.burrow = { at: state.tick, spot: state.spot, location: state.crab.getLocation().clone(), top: topDealers() };
  state.nextSpot = pickSpot(state.spot);
  // Its bar empties, but an NPC set to 0 hitpoints dies (NPC.setHitpoints), so it keeps 1.
  state.crab.setHitpoints(1);
  state.crab.performAnimation(new Animation(ANIM.burrow));
  state.crab.performGraphic(new Graphic(GRAPHIC.burrowOrRise));
  for (const player of inArea[state.spot]) updateHud(player);
}

function topDealers() {
  return [...state.damage].sort((a, b) => b[1] - a[1]).slice(0, TOP_MINERS).map(([name]) => name);
}

/** The messages go to the players at the crab's mine, not the whole world. */
function announceBurrow(burrow) {
  const tell = (text) => {
    for (const player of inArea[burrow.spot]) player.sendMessage(text);
  };
  tell("The gemstone crab burrows away, leaving a piece of its shell behind.");
  const names = burrow.top.slice(0, 3);
  if (names.length === 1) tell(`The top crab crusher was ${names[0]}!`);
  else if (names.length === 2) tell(`The top two crab crushers were ${names[0]} & ${names[1]}!`);
  else if (names.length === 3) tell(`The top three crab crushers were ${names[0]}, ${names[1]}, & ${names[2]}!`);
  if (state.shell) removeShell();
  const blocker = new GameObject(SHELL_BLOCKER, burrow.location.clone(), 10, 0, null);
  ObjectManager.register(blocker, true);
  state.shell = { npc: null, blocker, eligible: new Set(burrow.top), claimed: new Set(), expiresAt: 0, crumbling: false, nextSpotAt: 0 };
}

/** The crab goes and its shell is left where it was; the top dealers may mine it. */
function leaveShell(burrow) {
  pluginApi.removeNpc(state.crab);
  state.crab = null;
  const { location } = burrow;
  const shell = state.shell;
  shell.npc = pluginApi.spawnNpc({ id: SHELL, x: location.getX(), y: location.getY(), z: location.getZ(), wanderRadius: 0 });
  shell.npc?.setScriptedMovement(true);
  shell.npc?.performGraphic(new Graphic(GRAPHIC.shellIdle));
  shell.expiresAt = state.tick + SHELL_TICKS;
  shell.nextSpotAt = state.tick + SHELL_SPOT_FIRST;
  for (const name of shell.eligible) {
    World.getPlayerByName(name)?.sendMessage("<col=005f00>You gained enough understanding of the crab to mine from its remains.");
  }
}

function removeShell() {
  if (state.shell.npc) pluginApi.removeNpc(state.shell.npc);
  ObjectManager.deregister(state.shell.blocker, true);
  state.shell = null;
}

function tickBurrow() {
  const burrow = state.burrow;
  const since = state.tick - burrow.at;
  const watchers = inArea[burrow.spot];
  if (BURROW.hudFadeIn.includes(since)) for (const player of watchers) fadeHud(player, true);
  if (since === BURROW.hudFadeOut) for (const player of watchers) fadeHud(player, false);
  if (since === BURROW.hudClear) for (const player of watchers) hideHud(player);
  if (since === BURROW.announce) announceBurrow(burrow);
  if (since === BURROW.shell) leaveShell(burrow);
  if (since >= BURROW.nextCrab) {
    state.burrow = null;
    spawnCrab();
  }
}

function tickShell() {
  const shell = state.shell;
  if (!shell?.npc) return;
  if (state.tick >= shell.expiresAt) {
    removeShell();
  } else if (!shell.crumbling && state.tick >= shell.expiresAt - SHELL_DISINTEGRATE_TICKS) {
    shell.crumbling = true;
    shell.npc.performAnimation(new Animation(ANIM.shellDisintegrate));
  } else if (!shell.crumbling && state.tick >= shell.nextSpotAt) {
    shell.nextSpotAt = state.tick + SHELL_SPOT_INTERVAL;
    shell.npc.performGraphic(new Graphic(GRAPHIC.shellIdle));
  }
}

function tick() {
  state.tick++;
  tickShell();
  if (state.burrow) {
    tickBurrow();
    return;
  }
  if (!state.crab) return;
  const left = state.endsAt - state.tick;
  if (left <= 0) {
    startBurrow();
    return;
  }
  state.crab.setHitpoints(left);
  for (const player of inArea[state.spot]) updateHud(player);
  if (state.tick >= state.attack.nextAt) attack();
}

// --- Its attacks.

/** Whether a player is within the crab's reach: beside or under its 5x5, but not its centre. */
function inReach(player) {
  const crab = state.crab.getLocation();
  const at = player.getLocation();
  if (at.getZ() !== crab.getZ()) return false;
  const dx = at.getX() - crab.getX();
  const dy = at.getY() - crab.getY();
  if (dx === 2 && dy === 2) return false;
  return dx >= -1 && dx <= SIZE && dy >= -1 && dy <= SIZE;
}

function attackable() {
  return [...inArea[state.spot]].filter((player) =>
    player.isRegistered?.() !== false && player.getHitpoints() > 0 && inReach(player));
}

/**
 * Every 7 ticks it attacks the side (north, east, south or west) its target stands on, keeping
 * a target for 3-6 attacks. Each player in reach on that side is hit (Wiki: "its normal
 * attacks can target and damage players if they stand in the quadrant it is focusing its
 * attacks on"); the sides are OpenRune's, with the diagonals on both.
 */
function attack() {
  state.attack.nextAt = state.tick + ATTACK_TICKS;
  let target = state.attack.target;
  if (!target || state.tick >= state.attack.holdUntil || !inReach(target) || target.getHitpoints() <= 0) {
    const candidates = attackable().filter((player) => player !== target);
    target = candidates.length ? candidates[Math.floor(Math.random() * candidates.length)] : (target && inReach(target) ? target : null);
    state.attack.target = target;
    state.attack.holdUntil = state.tick + random(...HOLD_ATTACKS) * ATTACK_TICKS;
  }
  if (!target) return;
  state.crab.setPositionToFace(target.getLocation());
  state.crab.performAnimation(new Animation(ANIM.attack));
  for (const player of attackable().filter((player) => onSameSide(player, target))) {
    const damage = random(0, MAX_HIT);
    player.getCombat().getHitQueue().addPendingDamage([new HitDamage(damage, damage > 0 ? HitMask.RED : HitMask.BLUE)]);
  }
}

/** Whether a player is on the side of the crab its target is on, measured from its centre. */
function onSameSide(player, target) {
  const half = Math.floor(SIZE / 2);
  const centreX = state.crab.getLocation().getX() + half;
  const centreY = state.crab.getLocation().getY() + half;
  const tx = target.getLocation().getX() - centreX;
  const ty = target.getLocation().getY() - centreY;
  const vertical = Math.abs(ty) >= Math.abs(tx);
  const sign = Math.sign(vertical ? ty : tx);
  const dx = player.getLocation().getX() - centreX;
  const dy = player.getLocation().getY() - centreY;
  const [along, across] = vertical ? [dy, dx] : [dx, dy];
  return along * sign > 0 && Math.abs(across) <= Math.abs(along);
}

function recordDamage({ player, target, hit }) {
  if (target !== state.crab || !crabActive()) return;
  const damage = Number(hit?.getTotalDamage?.() ?? 0);
  if (damage <= 0) return;
  const name = player.getUsername();
  state.damage.set(name, (state.damage.get(name) ?? 0) + damage);
}

// --- The HUD: the crab's time left, for players at its mine.

/** The crab's time left against its lifetime: an NPC set to 0 hitpoints dies, so a burrow shows 0. */
function hudValues(player) {
  return { player, npcId: CRAB, current: state.burrow ? 0 : Math.max(0, state.crab.getHitpoints()), maximum: state.lifetime };
}

function showHud(player) {
  if (hudSpot() < 0) return;
  pluginApi.emitCustomEvent("boss-hud:show", hudValues(player));
}

function fadeHud(player, fadeIn) {
  pluginApi.emitCustomEvent("boss-hud:fade", { player, fadeIn });
}

/** The mine whose players see the HUD: the crab's, until it fades after the crab burrows. */
function hudSpot() {
  if (state.burrow) return state.tick - state.burrow.at < BURROW.hudClear ? state.burrow.spot : -1;
  return state.crab ? state.spot : -1;
}

function updateHud(player) {
  if (hudSpot() < 0) return;
  pluginApi.emitCustomEvent("boss-hud:update", hudValues(player));
}

function hideHud(player) {
  pluginApi.emitCustomEvent("boss-hud:hide", { player, fade: false, afterTicks: 0 });
}

/** Each mine's area, entered and left (players there see the crab's HUD). */
const AREA_HOOKS = SPOTS.map((spot, index) => ({
  zone: { ...spot.area, levels: [0] },
  enter: ({ player }) => enterArea(index, player),
  exit: ({ player }) => leaveArea(index, player),
}));

function enterArea(spot, player) {
  inArea[spot].add(player);
  if (hudSpot() === spot) showHud(player);
}

/** Leaving the mine (walking or teleporting away) fades the HUD out and then removes it. */
function leaveArea(spot, player) {
  inArea[spot].delete(player);
  if (hudSpot() !== spot) return;
  // Coming back (or into another crab's mine) shows it again, which cancels the hide.
  pluginApi.emitCustomEvent("boss-hud:hide", { player, afterTicks: HUD.hideAfterFadeTicks });
}

// --- Mining the shell.

function rollGem() {
  if (Math.random() < 1 / DRAGONSTONE_CHANCE) return UNCUT_DRAGONSTONE;
  let roll = Math.floor(Math.random() * GEM_TOTAL);
  for (const [gem, weight] of GEMS) {
    if (roll < weight) return gem;
    roll -= weight;
  }
  return GEMS[0][0];
}

function later(player, ticks, action) {
  TaskManager.submit(new (class extends Task {
    constructor() { super(ticks, player); }
    execute() { action(); this.stop(); }
  })());
}

/** The shell's Mine: once per eligible player, three gems after a swing. Guessed messages but two. */
function mineShell(event) {
  if (event.npc?.getId?.() !== SHELL || event.clickType !== 1) return;
  event.handled = true;
  const { player } = event;
  const shell = state.shell;
  const name = player.getUsername();
  if (!shell || shell.npc !== event.npc) return player.sendMessage("The crab shell has already crumbled away.");
  if (!shell.eligible.has(name)) {
    return player.sendMessage("Your understanding of the gemstone crab is not great enough to mine its shell.");
  }
  if (shell.claimed.has(name)) return player.sendMessage("You have already taken your share of this crab's shell.");
  if (player.getInventory().isFull()) return player.sendMessage("You don't have enough inventory space to mine this.");
  const pickaxe = findBestPickaxe(player);
  if (!pickaxe) return player.sendMessage("You need a pickaxe to mine this.");
  player.performAnimation(pickaxe.animation);
  player.sendMessage("You swing your pick at the crab shell.");
  later(player, MINE_TICKS, () => {
    if (state.shell !== shell) return player.sendMessage("The crab shell has already crumbled away.");
    if (shell.claimed.has(name)) return;
    shell.claimed.add(name);
    for (let roll = 0; roll < GEM_ROLLS; roll++) {
      const gem = rollGem();
      const gemName = ItemDefinition.forId(gem)?.getName?.() ?? "uncut gem";
      if (player.getInventory().isFull()) {
        ItemOnGroundManager.registerNonGlobals(player, new Item(gem, 1), player.getLocation().clone());
        player.sendMessage(`You mine an ${gemName.toLowerCase()}, but it falls to the floor.`);
      } else {
        player.getInventory().addItem(new Item(gem, 1));
        player.sendMessage(`You mine an ${gemName.toLowerCase()} from the crab shell.`);
      }
    }
  });
}

// --- The caves: each leads to the crab's current mine (or its next, while it's away).

function fade(player, out) {
  const args = out ? [0, 255, 0, 0, CRAWL.fadeCycles] : [0, 0, 0, 255, CRAWL.fadeCycles];
  player.getPacketSender().sendSubInterface(OVERLAY_ATMOSPHERE_UID, FADE_OVERLAY, 1, {
    postScripts: [{ scriptId: SCRIPT_FADE, args }],
  });
}

/** As captured: crawl and fade out, dim the minimap, land at the crab's mine, fade back in. */
function crawl({ player, objectId, location }) {
  if (objectId !== CAVE) return false;
  const spot = crabActive() ? state.spot : state.nextSpot;
  const destination = SPOTS[spot];
  if (!destination || (destination.cave[0] === location.x && destination.cave[1] === location.y)) {
    player.sendMessage("The gemstone crab is already nearby.");
    return;
  }
  player.setPositionToFace(new Location(location.x, location.y, location.z));
  player.performAnimation(new Animation(CRAWL.anim));
  player.getPacketSender().sendSoundEffect(CRAWL.sound, CRAWL.soundLoops, CRAWL.soundDelay, 10);
  fade(player, true);
  later(player, 1, () => player.getPacketSender().sendVarbit(VARBIT_MINIMAP_STATE, 2));
  later(player, 2, () => {
    const [x, y] = destination.exit;
    player.moveTo(new Location(x, y, 0));
    player.setPositionToFace(new Location(x, y + 1, 0));
  });
  later(player, 3, () => {
    fade(player, false);
    player.getPacketSender().sendVarbit(VARBIT_MINIMAP_STATE, 0);
  });
}

function start() {
  if (!state.crab && !state.burrow) spawnCrab();
  TaskManager.submit(new (class extends Task {
    constructor() { super(1); }
    execute() { tick(); }
  })());
}

/** ::gemstonecrab - the crab burrows now. */
function forceBurrow({ player }) {
  if (!crabActive()) return player.sendMessage("The gemstone crab isn't up.");
  state.endsAt = state.tick;
  player.sendMessage("The gemstone crab will burrow.");
}

module.exports = {
  name: "GemstoneCrab",
  members: true,
  _test: { state, tick, attack, inReach, rollGem, spawnCrab, startBurrow, topDealers, recordDamage, SPOTS },
  register(api) {
    pluginApi = api;
    ItemOnGroundManager = api.getItemOnGroundManager();
    api.onServerStartup(start);
    api.onPlayerDealtDamage(recordDamage);
    api.onNpcInteraction(mineShell);
    api.onObjectInteraction("Cave", { "Crawl-through": crawl });
    for (const { zone, enter, exit } of AREA_HOOKS) {
      api.onZoneEnter(zone, enter);
      api.onZoneExit(zone, exit);
    }
    api.registerCommand("gemstonecrab", forceBurrow, PlayerRights.DEVELOPER, "Force the gemstone crab to burrow");
  },
};
