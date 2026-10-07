// TzHaar Fight Pit: safe free-for-all, last player standing is champion.
// Rules: https://oldschool.runescape.wiki/w/TzHaar_Fight_Pit
// Overlay: interface 373 (TZHAAR_FIGHTPIT). Its script 70 renders varp 560 as
// "Foes Remaining: N", or "You're the Winner!" at 0.
// Room and arena tiles were read from the cache's collision map for region 9552.
let core;
let api;

const WAITING = { minX: 2394, maxX: 2404, minY: 5169, maxY: 5175 };
const ARENA = { minX: 2376, maxX: 2422, minY: 5129, maxY: 5167 };
// Mor Ul Rek and its outskirts; walking or teleporting out of it costs the champion skull.
const TZHAAR = { minX: 2368, maxX: 2559, minY: 5056, maxY: 5183 };
const WAITING_DROP = { x: 2399, y: 5170 };
const CITY_SIDE = { x: 2399, y: 5177 };
const ARENA_SIDE = { x: 2399, y: 5167 };

const OVERLAY_HUD_UID = (161 << 16) | 8;
/** The client shows "Attack" on players from player option slot 1 (sendPlayerOption). */
const ATTACK_OPTION_SLOT = 1;
const OVERLAY = 373;
const CHAMPION_TEXT_UID = (OVERLAY << 16) | 3;
const FOES_VARP = 560;
const DEFAULT_CHAMPION = "TzHaar-Xil-Huz";
const FIGHT_PIT_SKULL_ICON = 1;
const CHAMPION_SKULL_TICKS = 6000; // One hour.
const MIN_PLAYERS = 2;
const START_DELAY_TICKS = 20;
const GAS_TICKS = 1150; // 11.5 minutes.
const SPAWN_INTERVAL_TICKS = 50;
const MAX_MONSTERS = 10;

const state = {
  phase: "idle", // idle | countdown | active
  ticks: 0,
  lastCycle: -1,
  champion: DEFAULT_CHAMPION,
  participants: new Set(),
  defeatedLevels: 0,
  monsters: new Set(),
};
const present = new Set();
const shown = new WeakMap();
const champions = new WeakSet();

function inside(player, zone) {
  const location = player.getLocation();
  return location.getZ() === 0
    && location.getX() >= zone.minX && location.getX() <= zone.maxX
    && location.getY() >= zone.minY && location.getY() <= zone.maxY;
}

function tile({ x, y }) {
  return new core.Location(x, y, 0);
}

// Monsters join the arena on the wiki's timeline; past each mark the newest kind keeps
// arriving every 30 seconds. ponytail: one monster per interval and a cap of ten - the wiki
// gives the start times only, not how many come.
function monsterSchedule() {
  const { NpcIdentifiers: Npcs } = core;
  return [
    [950, Npcs.TZTOK_JAD], // 9.5 minutes
    [750, Npcs.KET_ZEK], // 7.5 minutes
    [550, Npcs.TOK_XIL_4], // 5.5 minutes
    [350, Npcs.TZ_KEK_3], // 3.5 minutes
    [150, Npcs.TZ_KIH_3], // 90 seconds
  ];
}

function randomArenaTile() {
  const { Misc, RegionManager } = core;
  for (let attempt = 0; attempt < 50; attempt++) {
    const x = Misc.randomInclusive(ARENA.minX, ARENA.maxX);
    const y = Misc.randomInclusive(ARENA.minY, ARENA.maxY);
    if (RegionManager.getClipping(x, y, 0, null) === 0) return { x, y };
  }
  return ARENA_SIDE;
}

function alive() {
  return [...state.participants].filter((player) =>
    player.isRegistered() && player.getHitpoints() > 0 && inside(player, ARENA));
}

function startGame(waiting, arena) {
  state.phase = "active";
  state.ticks = 0;
  state.defeatedLevels = 0;
  state.participants = new Set([...waiting, ...arena]);
  for (const player of waiting) player.moveTo(tile(randomArenaTile()));
}

function spawnMonster(id, fighters) {
  const at = randomArenaTile();
  const npc = api.spawnNpc({ id, x: at.x, y: at.y, z: 0 });
  if (!npc) return;
  npc.__skipDefaultRespawn = true;
  state.monsters.add(npc);
  npc.getCombat().attack(core.Misc.randomElement(fighters));
}

function runGame() {
  const { HitDamage, HitMask, Misc } = core;
  state.ticks++;
  const fighters = alive();
  if (fighters.length <= 1) {
    endGame(fighters[0] ?? null);
    return;
  }
  for (const npc of state.monsters) {
    if (npc.getHitpoints() <= 0 || !npc.isRegistered()) state.monsters.delete(npc);
    else if (npc.getCombat().getTarget() == null) npc.getCombat().attack(Misc.randomElement(fighters));
  }
  const unlocked = monsterSchedule().find(([at]) => state.ticks >= at);
  if (unlocked && (state.ticks - unlocked[0]) % SPAWN_INTERVAL_TICKS === 0 && state.monsters.size < MAX_MONSTERS) {
    spawnMonster(unlocked[1], fighters);
  }
  if (state.ticks >= GAS_TICKS) {
    for (const player of fighters) player.getCombat().getHitQueue().addPendingDamage([new HitDamage(1, HitMask.RED)]);
  }
}

// The last one standing takes Tokkul worth the combat levels of everyone beaten this game,
// and the red champion skull.
function endGame(winner) {
  const { ItemIdentifiers: Items } = core;
  // The final blow lands before its victim's death hook runs, so count anyone still falling.
  for (const player of state.participants) {
    if (player !== winner && player.isRegistered() && player.getHitpoints() <= 0) {
      state.defeatedLevels += player.getSkillManager().getCombatLevel();
    }
  }
  state.monsters.forEach((npc) => api.removeNpc(npc));
  state.monsters.clear();
  state.participants.clear();
  state.phase = "idle";
  if (!winner) return;
  state.champion = winner.getUsername();
  if (state.defeatedLevels > 0) winner.getInventory().adds(Items.TOKKUL, state.defeatedLevels);
  champions.add(winner);
  winner.setSkullTimer(CHAMPION_SKULL_TICKS);
  winner.setSkullIconOverride(FIGHT_PIT_SKULL_ICON);
}

function syncOverlay(player) {
  const fighters = state.phase === "active" ? alive() : [];
  const foes = state.participants.has(player) ? Math.max(0, fighters.length - 1) : fighters.length;
  const view = `${foes}|${state.champion}`;
  if (shown.get(player) === view) return;
  shown.set(player, view);
  player.getPacketSender()
    .sendConfig(FOES_VARP, foes)
    .sendString(`Current Champion: ${state.champion}`, CHAMPION_TEXT_UID);
}

function tick() {
  for (const player of present) {
    if (!player.isRegistered() || !(inside(player, WAITING) || inside(player, ARENA))) present.delete(player);
  }
  const waiting = [...present].filter((player) => inside(player, WAITING));
  const arena = [...present].filter((player) => inside(player, ARENA));
  if (state.phase === "active") {
    runGame();
  } else if (waiting.length + arena.length < MIN_PLAYERS) {
    state.phase = "idle";
  } else if (state.phase === "idle") {
    state.phase = "countdown";
    state.ticks = START_DELAY_TICKS;
  } else if (--state.ticks <= 0) {
    startGame(waiting, arena);
  }
  present.forEach(syncOverlay);
}

// Hooked per player but run once per game cycle: the pit is shared, and only matters while
// somebody is in it.
function processPits({ player }) {
  const cycle = core.World.getProcessCycle();
  if (!present.has(player) || state.lastCycle === cycle) return;
  state.lastCycle = cycle;
  tick();
}

function enterPit({ player }) {
  if (present.has(player)) return;
  present.add(player);
  shown.delete(player);
  player.getPacketSender().sendSubInterface(OVERLAY_HUD_UID, OVERLAY, 1);
}

function leavePit({ player }) {
  if (inside(player, WAITING) || inside(player, ARENA)) return;
  present.delete(player);
  player.getPacketSender().closeSubInterface(OVERLAY_HUD_UID);
}

function enterArena(event) {
  enterPit(event);
  event.player.getPacketSender().sendPlayerOption(ATTACK_OPTION_SLOT, "Attack", true);
}

function leaveArena(event) {
  event.player.getPacketSender().sendPlayerOption(ATTACK_OPTION_SLOT, "", false);
  leavePit(event);
}

function cityDoor({ player }) {
  player.moveTo(tile(inside(player, WAITING) ? CITY_SIDE : WAITING_DROP));
  return true;
}

// Fighters are let in by the game, not the door; the arena can only be left between games.
function arenaDoor({ player }) {
  if (inside(player, WAITING)) {
    player.sendMessage("You'll have to wait for the next fight to begin.");
  } else if (state.participants.has(player)) {
    player.sendMessage("You can't leave the pit in the middle of a fight.");
  } else {
    player.moveTo(tile(WAITING_DROP));
  }
  return true;
}

function pitDeath(event) {
  const player = event.player;
  if (!inside(player, ARENA)) return;
  event.handled = true;
  if (state.participants.delete(player)) state.defeatedLevels += player.getSkillManager().getCombatLevel();
  player.moveTo(tile(WAITING_DROP));
}

function keepItemsInPit(event) {
  if (inside(event.player, ARENA)) event.shouldDrop = false;
}

function pitCanAttack(event) {
  const attacker = event.attacker?.getAsPlayer?.();
  const target = event.target?.getAsPlayer?.();
  if (!attacker || !target || !(inside(attacker, ARENA) || inside(target, ARENA))) return;
  event.allow = state.phase === "active" && state.participants.has(attacker) && state.participants.has(target);
}

// ponytail: the skull also goes on gear swaps and overhead prayers in OSRS; only leaving
// Mor Ul Rek (which covers teleports) and logging out are handled.
function dropChampionSkull({ player }) {
  if (!champions.has(player)) return;
  champions.delete(player);
  player.setSkullTimer(0);
  player.setSkullIconOverride(null);
}

// Runs before the logout save: a fighter logging out comes back in the waiting room, not
// mid-fight in the arena.
function leaveArenaOnLogout({ player }) {
  if (inside(player, ARENA)) player.moveTo(tile(WAITING_DROP));
}

module.exports = {
  name: "TzhaarFightPits",
  members: true,
  _test: { enterArena, leaveArena, ATTACK_OPTION_SLOT },
  register(pluginApi) {
    api = pluginApi;
    core = pluginApi.core;
    pluginApi.onZoneEnter(WAITING, enterPit);
    pluginApi.onZoneExit(WAITING, leavePit);
    pluginApi.onZoneEnter(ARENA, enterArena);
    pluginApi.onZoneExit(ARENA, leaveArena);
    pluginApi.onZoneExit(TZHAAR, dropChampionSkull);
    pluginApi.onObjectFirstClick(core.ObjectIdentifiers.HOT_VENT_DOOR_3, cityDoor);
    pluginApi.onObjectFirstClick(core.ObjectIdentifiers.HOT_VENT_DOOR_2, arenaDoor);
    pluginApi.onPlayerProcess(processPits);
    pluginApi.onPlayerDeath(pitDeath);
    pluginApi.onShouldDropItemsOnDeath(keepItemsInPit);
    pluginApi.onCanAttack(pitCanAttack);
    pluginApi.onPlayerLogout(dropChampionSkull);
    pluginApi.onPlayerLogout(leaveArenaOnLogout);
  },
};
