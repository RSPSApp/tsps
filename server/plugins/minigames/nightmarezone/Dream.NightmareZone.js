/**
 * The dreams, as recorded where they were (rsprox 224/01512 [235]-[252], 234/03279) and from the
 * Wiki otherwise (nightmare-zone.json `arena`, `bosses`):
 * - the enclosure: stepping in shows the nzone_lobby overlay and unlocks the coffer;
 * - the vial: "Start dream: <name>" (Proceed. / Not just now.); the fee comes out of the coffer
 *   now; the fade, "Welcome to the Nightmare Zone.", the dream's own copy of the arena (multi-way,
 *   the nzone_game overlay, its music);
 * - Practice: the chosen boss, once; Endurance: every unlocked boss in turn; Rumble: four at a time,
 *   in any order and over again (Wiki); bosses with several forms fight through them all;
 * - points (Endurance and Rumble): the Wiki's per-boss figure with every quest done, scaled by
 *   the share of bosses the player has unlocked (the Wiki's exact formula is not known); they
 *   gather on the dream's counter (varbit nzone_currentpoints, whose 20 bits are the Wiki's
 *   1,048,575 cap a dream) and are paid into the reward points as the dream ends;
 * - the arena's potion wakes the player at once, by Dominic, with no message (recorded); so do a
 *   death (safe: nothing is lost), a logout and the Wiki's 6-hour log.
 * Potions.NightmareZone and PowerUps.NightmareZone add the potions and the power-ups.
 * Not yet: Rumble groups, spectators, Customisable dreams.
 */
const Common = require("./Common.NightmareZone");
const Dominic = require("./Dominic.NightmareZone");
const Potions = require("./Potions.NightmareZone");
const PowerUps = require("./PowerUps.NightmareZone");

/** The lobby vial (a multiloc: empty, or full once a dream is prepared) and the arena's. */
const LOBBY_VIALS = ["nzone_lobby_vial", "nzone_lobby_vial_empty", "nzone_lobby_vial_full"];
const ARENA_VIAL = "nzone_arena_vial";
const VIAL_NAME = "<col=ff9040>Potion";
const EMPTY_VIAL_NAME = "<col=ff9040>Empty vial";
const FADE = { overlay: 174, script: 948, out: [0, 255, 0, 0, 50] };
const LOBBY_OVERLAY_SCRIPT = 264;

/** Where a dream is in its life: entering (fade), active (fighting), ending, ended. */
const PHASE = { ENTERING: "entering", ACTIVE: "active", ENDING: "ending", ENDED: "ended" };

/** Each dreamer's dream: { phase, area, dream, npcs, locs, queue, kills, points, tick, ended }. */
const { dreams, dreamOf } = Common;
let DreamArea = null;
let enclosure = null;

const sender = (player) => player.getPacketSender();

// ---------------------------------------------------------------- the enclosure

function enclosureClass() {
  return class NightmareZoneEnclosure extends Common.core.Area {
    getName() {
      return "Nightmare Zone enclosure";
    }

    postEnter(mobile) {
      if (mobile.isPlayer?.()) enterEnclosure(mobile.getAsPlayer?.() ?? mobile);
    }

    postLeave(mobile) {
      if (mobile.isPlayer?.()) closeOverlay(mobile.getAsPlayer?.() ?? mobile);
    }
  };
}

/** Recorded [19587]: the coffer unlocks, the nzone_lobby overlay opens with an empty control. */
function enterEnclosure(player) {
  require("./Coffer.NightmareZone").unlock(player);
  const id = Common.core.CacheDefinitions.getInterfaceId("nzone_lobby");
  sender(player).sendSubInterface(Common.component("toplevel_osrs_stretch:overlay_hud"), id, 1);
  sender(player).sendString("", Common.component("nzone_lobby:control"));
  sender(player).sendInterfaceScript(LOBBY_OVERLAY_SCRIPT, [0]);
}

function closeOverlay(player) {
  sender(player).closeSubInterface?.(Common.component("toplevel_osrs_stretch:overlay_hud"));
}

// ---------------------------------------------------------------- the arena

function areaClass() {
  if (DreamArea) return DreamArea;
  DreamArea = class NightmareZoneDream extends Common.core.TemplatedInstanceArea {
    constructor() {
      const { chunk, size } = Common.data.arena;
      super(size[0], size[1]);
      this.origin = [chunk[0] * 8, chunk[1] * 8];
      for (let z = 0; z < 4; z++) {
        for (let x = 0; x < size[0]; x++) {
          for (let y = 0; y < size[1]; y++) {
            this.setChunk(z, x, y, { sourceChunkX: chunk[0] + x, sourceChunkY: chunk[1] + y, sourcePlane: z, rotation: 0 });
          }
        }
      }
    }

    getName() {
      return "Nightmare Zone";
    }

    isMulti() {
      return true;
    }

    canTeleport() {
      return false;
    }

    /** No trading in the dream either (either trader's area can refuse it). */
    canTrade() {
      return false;
    }

    at([x, y, z]) {
      return this.tile(x - this.origin[0], y - this.origin[1], z ?? 0);
    }

    /** A logout ends the dream; the player is saved by Dominic. */
    postLeave(mobile, logout) {
      const player = mobile.isPlayer?.() ? mobile.getAsPlayer?.() ?? mobile : null;
      if (player && dreams.has(player)) {
        endDream(player);
        if (logout) player.setLocation?.(Common.toLocation(Common.data.lobby.afterDream));
      }
      super.postLeave(mobile, logout);
    }
  };
  return DreamArea;
}

/** What the engine does in the world (a test records it). */
const engine = {
  attack: (npc, player) => npc.getCombat?.().attack?.(player),
  free: (area, location) => (Common.core.RegionManager?.getClipping?.(location.getX(), location.getY(), location.getZ(), area) ?? 0) === 0,
};

function spawnTile(state) {
  const [x0, y0, x1, y1] = Common.data.arena.spawnBox;
  for (let tries = 0; tries < 30; tries++) {
    const location = state.area.at([Common.randomInt(x0, x1), Common.randomInt(y0, y1), 0]);
    if (engine.free(state.area, location)) return location;
  }
  return state.area.at(Common.data.arena.start);
}

function spawnBoss(player, state, boss, form = 0, at = null) {
  const id = Common.bossForms(boss, state.dream.difficulty)[form];
  if (id == null) return null;
  const npc = Common.core.NPC.create(id, at ?? spawnTile(state));
  npc.__skipDefaultRespawn = true;
  npc.__nightmareZone = { player, boss, form };
  state.area.add(npc);
  Common.core.World.getAddNPCQueue().push(npc);
  state.npcs.add(npc);
  Common.later(1, () => {
    if (state.npcs.has(npc)) engine.attack(npc, player);
  });
  return npc;
}

function despawn(state, npc) {
  if (!state.npcs.delete(npc)) return;
  state.area.detach(npc);
  Common.core.World.getRemoveNPCQueue().push(npc);
}

/** The dream's own locs (plinth, vial, rockslides): gone with it, not just its map. */
function cleanupLocs(state) {
  for (const object of state.locs.splice(0)) Common.core.ObjectManager.deregister(object, true);
}

// ---------------------------------------------------------------- starting

/** The lobby vial: "Start dream: <name>", or nothing prepared. */
const isVial = (object, names) => names.some((name) => Common.core.CacheDefinitions.getLocId(name) === object?.getId?.());

function drinkLobbyVial({ player, object }) {
  if (isVial(object, [ARENA_VIAL])) return wake({ player });
  if (!isVial(object, LOBBY_VIALS)) return false;
  const dream = Common.preparedDream(player);
  if (!dream) {
    player.sendMessage(Common.message("noDream"));
    return true;
  }
  Common.choose(player, Common.message("startDream", { name: dreamName(dream) }), [
    ["Proceed.", () => start(player)],
    ["Not just now.", () => {}],
  ]);
  return true;
}

function emptyVial({ player, object }) {
  if (!isVial(object, LOBBY_VIALS)) return false;
  player.sendMessage(Common.message("noDream"));
  return true;
}

function dreamName(dream) {
  if (dream.mode === "practice") return Common.bossName(dream.boss);
  return Dominic.describe(dream);
}

/** Recorded [239]-[243]: the fee, the fade, then 3 ticks on the dream. */
function start(player) {
  const dream = Common.preparedDream(player);
  if (!dream || dreams.has(player)) return;
  const unlocked = Common.unlockedBosses(player);
  if (unlocked.length < Common.data.questsNeeded) {
    player.sendMessage(Common.message("notEnoughQuests", { needed: Common.data.questsNeeded }));
    return;
  }
  const cost = Common.data.prices[dream.mode]?.[dream.difficulty] ?? 0;
  if (Common.coffer(player) < cost) {
    player.sendMessage(Common.message("notEnoughCoins", { cost: Common.commas(cost) }));
    return;
  }
  Common.setCoffer(player, Common.coffer(player) - cost);
  Common.setPreviousDream(player, dream);
  closeOverlay(player);
  sender(player).sendSubInterface(Common.component("toplevel_osrs_stretch:overlay_atmosphere"), FADE.overlay, 1, {
    postScripts: [{ scriptId: FADE.script, args: FADE.out }],
  });
  sender(player).sendSound?.(Common.data.sounds.prepared, 100, 0);
  const state = {
    phase: PHASE.ENTERING,
    area: new (areaClass())(),
    dream,
    npcs: new Set(),
    locs: [],
    queue: [],
    unlocked,
    kills: 0,
    points: 0,
    tick: 0,
    cost,
    ended: false,
  };
  dreams.set(player, state);
  Common.later(1, () => dreamOf(player) === state && Common.setPreparedDream(player, null));
  Common.later(3, () => enter(player, state));
}

/**
 * Gone before the fade ends (a logout): nothing was dreamt, so the fee goes back into the coffer
 * and the dream stays prepared.
 */
function cancelEntry(player) {
  const state = dreamOf(player);
  if (!state || state.phase !== PHASE.ENTERING || state.ended) return;
  state.ended = true;
  state.phase = PHASE.ENDING;
  dreams.delete(player);
  Common.setCoffer(player, Common.coffer(player) + state.cost);
  Common.setPreparedDream(player, state.dream);
  sender(player).closeSubInterface?.(Common.component("toplevel_osrs_stretch:overlay_atmosphere"));
  cleanupLocs(state);
  PowerUps.dreamEnded(state);
  for (const npc of [...state.npcs]) despawn(state, npc);
  Common.later(1, () => {
    if (!state.area.isDestroyed?.()) state.area.destroy?.();
  });
}

function enter(player, state) {
  if (dreamOf(player) !== state || state.ended || state.phase !== PHASE.ENTERING) return;
  if (player.isRegistered?.() === false) {
    cancelEntry(player);
    return;
  }
  state.phase = PHASE.ACTIVE;
  player.sendMessage(Common.message("welcome"));
  state.area.enter(player);
  placeLocs(state);
  player.moveTo(state.area.at(Common.data.arena.start));
  Common.varbit(player, "multiway_indicator", 1);
  sender(player).closeSubInterface?.(Common.component("toplevel_osrs_stretch:overlay_atmosphere"));
  sender(player).sendSubInterface(Common.component("toplevel_osrs_stretch:overlay_hud"), Common.core.CacheDefinitions.getInterfaceId("nzone_game"), 1);
  sender(player).sendSong?.(Common.data.music.dream);
  if (state.dream.mode === "endurance") state.queue = [...state.unlocked];
  Common.varbit(player, "nzone_currentpoints", 0);
  Common.every(() => {
    if (dreamOf(player) !== state || state.ended) return false;
    state.tick++;
    if (state.tick >= Common.data.arena.maxTicks) {
      finish(player);
      return false;
    }
    PowerUps.tick(player, state, () => spawnTile(state));
    return true;
  });
  Common.later(Common.data.arena.firstSpawnTicks, () => {
    if (dreamOf(player) !== state) return;
    if (state.dream.mode === "practice") spawnBoss(player, state, state.dream.boss);
    else if (state.dream.mode === "endurance") spawnBoss(player, state, state.queue.shift());
    else for (let i = 0; i < Common.data.rumbleBosses; i++) spawnBoss(player, state, rumbleBoss(state));
  });
}

/** Recorded: the plinth and its potion, the rockslides and a wall are added as the dream starts. */
function placeLocs(state) {
  const { GameObject, ObjectManager, CacheDefinitions } = Common.core;
  for (const [name, tile, shape, rotation] of Common.data.arena.locs) {
    const id = CacheDefinitions.getLocId(name);
    if (id != null) {
      const object = new GameObject(id, state.area.at(tile), shape, rotation, state.area);
      ObjectManager.register(object, true);
      state.locs.push(object);
    }
  }
}

function rumbleBoss(state) {
  return state.unlocked[Common.randomInt(0, state.unlocked.length - 1)];
}

// ---------------------------------------------------------------- kills and points

/** The Wiki's points with every quest done, scaled by the share of bosses unlocked (inferred). */
function pointsFor(state, boss) {
  const max = Common.data.bosses[boss].points[state.dream.difficulty === "hard" ? 1 : 0];
  return Math.floor((max * state.unlocked.length) / Common.data.bosses.length);
}

function bossDied({ npc }) {
  const owner = npc?.__nightmareZone;
  if (!owner) return;
  const { player, boss, form } = owner;
  const state = dreamOf(player);
  if (!state || !state.npcs.has(npc)) return;
  const tile = npc.getLocation();
  despawn(state, npc);
  if (spawnBoss(player, state, boss, form + 1, tile)) return;
  state.kills++;
  if (state.dream.mode !== "practice" && !npc.__noPoints) {
    state.points = Math.min(Common.data.dreamPointsCap, state.points + pointsFor(state, boss));
    Common.varbit(player, "nzone_currentpoints", state.points);
  }
  if (state.dream.mode === "practice") {
    Common.later(Common.data.practiceWakeTicks, () => dreamOf(player) === state && finish(player));
  } else if (state.dream.mode === "endurance") {
    if (state.queue.length === 0) Common.later(Common.data.practiceWakeTicks, () => dreamOf(player) === state && finish(player));
    else Common.later(Common.randomInt(...Common.data.rumbleRespawnTicks), () => dreamOf(player) === state && spawnBoss(player, state, state.queue.shift()));
  } else {
    Common.later(Common.randomInt(...Common.data.rumbleRespawnTicks), () => dreamOf(player) === state && spawnBoss(player, state, rumbleBoss(state)));
  }
}

// ---------------------------------------------------------------- waking

function endDream(player) {
  const state = dreamOf(player);
  if (!state || state.ended) return false;
  state.ended = true;
  state.phase = PHASE.ENDING;
  dreams.delete(player);
  // The dream's points (nzone_currentpoints, up to 1,048,575) are paid as it ends (Wiki's cap).
  if (state.points > 0) Common.addPoints(player, state.points);
  Common.varbit(player, "nzone_currentpoints", 0);
  Potions.dreamEnded(player);
  PowerUps.dreamEnded(state);
  for (const npc of [...state.npcs]) despawn(state, npc);
  cleanupLocs(state);
  Common.varbit(player, "multiway_indicator", 0);
  sender(player).closeSubInterface?.(Common.component("toplevel_osrs_stretch:overlay_atmosphere"));
  closeOverlay(player);
  state.phase = PHASE.ENDED;
  Common.later(1, () => {
    if (!state.area.isDestroyed?.()) state.area.destroy?.();
  });
  return true;
}

/** Recorded [252]: the arena's potion, and the player is by Dominic the same tick. */
function wake({ player }) {
  if (!dreams.has(player)) return false;
  endDream(player);
  player.moveTo(Common.toLocation(Common.data.lobby.afterDream));
  return true;
}

/** A dream overcome (or its 6-hour limit reached). */
function finish(player) {
  wake({ player });
  player.sendMessage(Common.message("dreamOver"));
}

/** A death in a dream is safe: the player wakes by Dominic with everything. */
function died(event) {
  if (!dreams.has(event.player)) return;
  event.handled = true;
  finish(event.player);
}

/** A logout mid-fade cancels the dream; one inside it ends it (the arena's postLeave saves them by Dominic). */
function loggedOut({ player }) {
  const state = dreamOf(player);
  if (!state) return;
  if (state.phase === PHASE.ENTERING) {
    cancelEntry(player);
    return;
  }
  endDream(player);
  player.setLocation?.(Common.toLocation(Common.data.lobby.afterDream));
}

/** A dropped connection is an end too: nothing is left in the instance for the next login. */
function disconnected({ player }) {
  const state = dreamOf(player);
  if (!state) return;
  if (state.phase === PHASE.ENTERING) {
    cancelEntry(player);
    return;
  }
  endDream(player);
  player.setLocation?.(Common.toLocation(Common.data.lobby.afterDream));
}

function keepItems(event) {
  if (dreams.has(event.player)) event.shouldDrop = false;
  return null;
}

/** Banks, chests and deposit boxes are not reachable inside a dream. */
function canBank(event) {
  if (!dreams.has(event.player)) return;
  event.allow = false;
  event.player.sendMessage(Common.message("noBank"));
}

/** agent:advance-time: testing's way of reaching the 6-hour limit without waiting. */
function advanceTime({ player, ms, handledBy }) {
  const state = dreamOf(player);
  if (!state || state.phase !== PHASE.ACTIVE) return;
  state.tick += Math.max(0, Math.floor(Number(ms) / 600));
  handledBy?.push("Nightmare Zone");
}

function loggedIn({ player }) {
  Common.varbit(player, "nzone_purchaseddream", Common.dreamCode(Common.preparedDream(player)));
  Common.varbit(player, "nzone_previousdream", Common.dreamCode(Common.previousDream(player)));
  const id = Common.core.CacheDefinitions.getVarpId(Common.data.pointsVarp);
  if (id != null) sender(player).sendConfig(id, Common.points(player));
}

function attachDream(api) {
  api.persistAttribute(Common.POINTS_ATTRIBUTE, 0);
  api.persistAttribute(Common.DREAM_ATTRIBUTE, "");
  api.persistAttribute(Common.PREVIOUS_ATTRIBUTE, "");
  api.onPlayerLogin(loggedIn);
  api.onPlayerLogout(loggedOut);
  api.onPlayerDisconnect(disconnected);
  const [x0, y0, x1, y1] = Common.data.lobby.enclosure;
  enclosure = new (enclosureClass())([new Common.core.Boundary(x0, x1, y0, y1, 0)]);
  api.registerArea(enclosure);
  // The cache's names carry their colour: "<col=ff9040>Potion", "<col=ff9040>Empty vial".
  api.onObjectInteraction(VIAL_NAME, { Drink: drinkLobbyVial });
  api.onObjectInteraction(EMPTY_VIAL_NAME, { Investigate: emptyVial });
  api.onNpcDeath(bossDied);
  api.onPlayerDeath(died);
  api.onShouldDropItemsOnDeath(keepItems);
  api.onCanBank(canBank);
  api.onCustomEvent("agent:advance-time", advanceTime);
}

module.exports = { attachDream, start, wake, finish, drinkLobbyVial, bossDied, pointsFor, dreams, engine, enterEnclosure, disconnected };
