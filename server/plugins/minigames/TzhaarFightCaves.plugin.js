// TzHaar Fight Cave: 63 single-player waves ending in TzTok-Jad.
// Rules: https://oldschool.runescape.wiki/w/TzHaar_Fight_Cave
// Lines: https://oldschool.runescape.wiki/w/Transcript:TzHaar-Mej-Jal
// Spawn and entry tiles were picked from the cache's collision map for region 9551.
let core;
let api;
let FightCaveArea = null;
const sessions = new WeakMap();

const ATTR_WAVE = "tzhaar:fight-cave-wave";
const ATTR_ROTATION = "tzhaar:fight-cave-rotation";
const ATTR_LEFT_AT = "tzhaar:fight-cave-left-at";
const WAVE_MESSAGE_COLOUR = "ef1020";
const FINAL_WAVE = 63;
const WAVE_DELAY_TICKS = 6;
const EXIT_DELAY_TICKS = 8;
const REENTRY_MS = 3 * 60 * 1000;
const JAD_KILL_BONUS = 4000;
const HEALER_HEAL = 5;
const HEALER_HEAL_TICKS = 4;
const HEALER_COMBAT_REACH = 4;
const HEAL_GRAPHIC = 444; // TZHAAR_HEAL
const LOGOUT_PAUSED = "Your logout request has been received. The minigame will be paused at the end of this wave. "
  + "If you try to log out before that, you will have to repeat this wave.";

const BOUNDS = { minX: 2368, maxX: 2431, minY: 5056, maxY: 5119 };
const ENTRY = { x: 2413, y: 5117 };
const RESUME = { x: 2400, y: 5088 }; // "you will spawn in the middle of the room"
const EXIT = { x: 2438, y: 5168 };

// South-west corner of each spawn, clear for a 5x5 Ket-Zek or Jad.
const SPAWNS = {
  NW: { x: 2378, y: 5106 },
  C: { x: 2398, y: 5084 },
  SE: { x: 2415, y: 5078 },
  SW: { x: 2374, y: 5066 },
  S: { x: 2395, y: 5067 },
};
// The wiki's spawn cycle; each wave's highest-level monster takes the next point and the rest
// follow it in order, highest to lowest.
const SPAWN_CYCLE = ["SE", "SW", "C", "NW", "SW", "SE", "S", "NW", "C", "SE", "SW", "S", "NW", "C", "S"];
const HEALER_SPAWNS = ["NW", "SE", "SW", "S"];

function waveMonsters(wave) {
  // Waves count in a mixed radix: Tz-Kih is 1, Tz-Kek 3, Tok-Xil 7, Yt-MejKot 15, Ket-Zek 31,
  // so wave 6 is two Tz-Kek, wave 7 one Tok-Xil and wave 62 two Ket-Zek.
  const { NpcIdentifiers: Npcs } = core;
  const values = [[Npcs.KET_ZEK, 31], [Npcs.YT_MEJKOT, 15], [Npcs.TOK_XIL_4, 7], [Npcs.TZ_KEK_3, 3], [Npcs.TZ_KIH_3, 1]];
  const monsters = [];
  let points = wave;
  for (const [id, value] of values) {
    for (; points >= value; points -= value) monsters.push(id);
  }
  return monsters;
}

function inCave(player) {
  const location = player.getLocation();
  return location.getZ() === 0
    && location.getX() >= BOUNDS.minX && location.getX() <= BOUNDS.maxX
    && location.getY() >= BOUNDS.minY && location.getY() <= BOUNDS.maxY;
}

function tile({ x, y }) {
  return new core.Location(x, y, 0);
}

function say(player, text) {
  const { DialogueChainBuilder, EndDialogue, NpcDialogue, NpcIdentifiers } = core;
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(
    new NpcDialogue(0, NpcIdentifiers.TZHAAR_MEJ_JAL, text),
    new EndDialogue(1),
  ));
}

function give(player, itemId, amount) {
  if (amount <= 0) return;
  const inventory = player.getInventory();
  if (inventory.contains(itemId) && core.ItemDefinition.forId(itemId).isStackable() || inventory.getFreeSlots() > 0) {
    inventory.adds(itemId, amount);
    return;
  }
  core.ItemOnGroundManager.registerLocation(player, new core.Item(itemId, amount), player.getLocation().clone(), null);
}

// Each run is its own private copy of the cave, built on first use once api.core exists.
function createArea() {
  FightCaveArea ??= class extends core.PrivateArea {
    constructor() {
      super([new core.Boundary(BOUNDS.minX, BOUNDS.maxX, BOUNDS.minY, BOUNDS.maxY, 0)]);
    }

    // Any way out but a logout (a teleport, a command) ends the run, so login won't resume it.
    // finishRun drops the session before leaving, so the exit and death skip this.
    postLeave(mobile, logout) {
      super.postLeave(mobile, logout);
      if (logout || sessions.get(mobile)?.area !== this) return;
      sessions.delete(mobile);
      mobile.setAttribute(ATTR_WAVE, null);
      mobile.setAttribute(ATTR_ROTATION, null);
    }
  };
  return new FightCaveArea();
}

function startRun(player, wave, rotation, at) {
  const area = createArea();
  area.enter(player);
  player.moveTo(tile(at));
  player.setAttribute(ATTR_WAVE, wave);
  player.setAttribute(ATTR_ROTATION, rotation);
  sessions.set(player, {
    area,
    wave,
    rotation,
    npcs: new Set(),
    nextWaveAt: core.World.getProcessCycle() + WAVE_DELAY_TICKS,
    exitAt: -1,
    jad: null,
    healers: [],
    healerWaves: 0,
    jadHealedToFull: false,
  });
}

function spawn(session, player, id, at, attack = true) {
  const npc = api.spawnNpc({ id, x: at.x, y: at.y, z: 0, owner: player });
  if (!npc) return null;
  npc.__skipDefaultRespawn = true;
  session.area.add(npc);
  session.npcs.add(npc);
  if (attack) npc.getCombat().attack(player);
  return npc;
}

function spawnWave(player, session) {
  const { NpcIdentifiers: Npcs } = core;
  session.nextWaveAt = -1;
  player.sendMessage(`<col=${WAVE_MESSAGE_COLOUR}>Wave: ${session.wave}</col>`);
  if (session.wave === FINAL_WAVE) {
    say(player, "Look out, here comes TzTok-Jad!");
    session.jad = spawn(session, player, Npcs.TZTOK_JAD, SPAWNS[SPAWN_CYCLE[(session.rotation + FINAL_WAVE) % SPAWN_CYCLE.length]]);
    return;
  }
  waveMonsters(session.wave).forEach((id, index) => {
    spawn(session, player, id, SPAWNS[SPAWN_CYCLE[(session.rotation + session.wave + index) % SPAWN_CYCLE.length]]);
  });
}

// Yt-HurKot come at half health. If they heal Jad back to full, a fresh set comes the next
// time he drops; healers that were drawn off and killed before then do not.
function tendJad(player, session) {
  const { NpcIdentifiers: Npcs, PathFinder, Graphic } = core;
  const jad = session.jad;
  if (!jad || jad.getHitpoints() <= 0) return;
  const maxHp = jad.getDefinition().getHitpoints();
  session.healers = session.healers.filter((healer) => healer.getHitpoints() > 0);
  if (session.healers.length > 0 && jad.getHitpoints() >= maxHp) session.jadHealedToFull = true;
  if (jad.getHitpoints() <= maxHp / 2 && session.healers.length === 0
      && (session.healerWaves === 0 || session.jadHealedToFull)) {
    session.healerWaves++;
    session.jadHealedToFull = false;
    session.healers = HEALER_SPAWNS
      .map((point) => spawn(session, player, Npcs.YT_HURKOT, SPAWNS[point], false))
      .filter(Boolean);
  }
  const cycle = core.World.getProcessCycle();
  for (const healer of session.healers) {
    const distance = healer.calculateDistance(jad);
    const fighting = healer.getCombat().getTarget() != null;
    if (distance <= 1 || (fighting && distance <= HEALER_COMBAT_REACH)) {
      if (cycle % HEALER_HEAL_TICKS === 0 && jad.getHitpoints() < maxHp) {
        healer.setMobileInteraction?.(jad);
        jad.performGraphic(new Graphic(HEAL_GRAPHIC));
        jad.heal(HEALER_HEAL);
      }
    } else if (!fighting) {
      PathFinder.calculateWalkRoute(healer, jad.getLocation().getX(), jad.getLocation().getY());
    }
  }
}

function processRun({ player }) {
  const session = sessions.get(player);
  if (!session) return;
  if (session.area.isDestroyed()) {
    sessions.delete(player);
    return;
  }
  const cycle = core.World.getProcessCycle();
  if (session.exitAt !== -1) {
    if (cycle >= session.exitAt) {
      finishRun(player, FINAL_WAVE, true);
      if (session.logoutRequested) player.getSession().logout();
    }
    return;
  }
  tendJad(player, session);
  for (const npc of session.npcs) {
    if (npc.getHitpoints() > 0) continue;
    session.npcs.delete(npc);
    splitTzKek(player, session, npc);
  }
  if (session.wave === FINAL_WAVE && session.jad?.getHitpoints() <= 0) {
    // Jad's fall ends the run; any healers still standing go with him.
    session.healers.forEach((healer) => api.removeNpc(healer));
    session.exitAt = cycle + EXIT_DELAY_TICKS;
    return;
  }
  if (session.nextWaveAt === -1 && session.npcs.size === 0 && session.wave < FINAL_WAVE) {
    session.wave++;
    player.setAttribute(ATTR_WAVE, session.wave);
    session.nextWaveAt = cycle + WAVE_DELAY_TICKS;
    if (session.logoutRequested) {
      session.logoutRequested = false;
      player.getSession().logout();
      return;
    }
  }
  if (session.nextWaveAt !== -1 && cycle >= session.nextWaveAt) spawnWave(player, session);
}

// Ends the run outside the cave. Tokkul is N(N+1) for N waves cleared, plus 4,000 for Jad.
function finishRun(player, wavesCleared, wonJad) {
  const { ItemIdentifiers: Items } = core;
  const session = sessions.get(player);
  sessions.delete(player);
  player.setAttribute(ATTR_WAVE, null);
  player.setAttribute(ATTR_ROTATION, null);
  if (session) {
    rescueGroundItems(player, session.area);
    session.area.leave(player, false);
    if (player.getArea() === session.area) player.setArea(null);
    session.area.destroy();
  }
  player.getCombat().reset();
  player.moveTo(tile(EXIT));
  give(player, Items.TOKKUL, wavesCleared * (wavesCleared + 1) + (wonJad ? JAD_KILL_BONUS : 0));
  if (wonJad) {
    give(player, Items.FIRE_CAPE, 1);
    api.emitCustomEvent("collection-log:obtain", { player, itemId: Items.FIRE_CAPE, amount: 1 });
    say(player, "You even defeated TzTok-Jad, I am most impressed! Please accept this gift. Give cape back to me if you not want it.");
  } else if (wavesCleared === 0) {
    say(player, "Well I suppose you tried... better luck next time.");
  } else {
    say(player, "Well done in the cave, here take TokKul as reward.");
  }
}

// Drops (a Jad pet roll included) would vanish with the instance; hand them over at the exit.
function rescueGroundItems(player, area) {
  const { ItemOnGroundManager, World } = core;
  for (const item of [...World.getItems()]) {
    if (item.getPrivateArea() !== area) continue;
    ItemOnGroundManager.deregister(item);
    ItemOnGroundManager.registerLocation(player, item.getItem(), tile(EXIT), null);
  }
}

function enterCave({ player }) {
  const leftAt = Number(player.getAttribute(ATTR_LEFT_AT) ?? 0);
  const waitMs = leftAt + REENTRY_MS - Date.now();
  if (waitMs > 0) {
    const minutes = Math.ceil(waitMs / 60000);
    const wait = minutes > 1 ? `${minutes} minutes` : waitMs > 30000 ? "a minute or so" : "a bit";
    say(player, `Hey, JalYt, you were in cave only a moment ago. You wait ${wait} before going in again.`);
    return true;
  }
  startRun(player, 1, core.Misc.getRandom(SPAWN_CYCLE.length - 1), ENTRY);
  say(player, "You're on your own now JalYt, prepare to fight for your life!");
  return true;
}

function leaveCave({ player }) {
  const session = sessions.get(player);
  player.setAttribute(ATTR_LEFT_AT, Date.now());
  finishRun(player, session ? session.wave - 1 : 0, false);
  return true;
}

function caveDeath(event) {
  const session = sessions.get(event.player);
  if (!session) return;
  event.handled = true;
  // Falling to a healer after Jad is already down still counts as the win.
  if (session.exitAt !== -1) finishRun(event.player, FINAL_WAVE, true);
  else finishRun(event.player, session.wave - 1, false);
}

function keepItemsInCave(event) {
  if (sessions.has(event.player)) event.shouldDrop = false;
}

function noTeleportOut(event) {
  if (!sessions.has(event.player)) return;
  event.player.sendMessage("You can't teleport out of the Fight Cave.");
  event.allow = false;
}

// The logout button mid-wave (or with Jad down) waits for the wave to end, then logs out with
// the next wave saved; between waves it goes straight through. A dropped connection can't wait,
// so it restarts the wave it happened in.
function holdLogout(event) {
  const session = sessions.get(event.player);
  if (!session || (session.nextWaveAt !== -1 && session.exitAt === -1)) return;
  session.logoutRequested = true;
  event.allow = false;
  event.reason = LOGOUT_PAUSED;
}

// A logout restarts the wave it happened in, from the middle of the room, with the same
// rotation. Anyone left inside without a run (an old save) is put back outside, and a run
// saved by someone who had already left the cave is dropped.
function resumeRun({ player }) {
  const wave = Number(player.getAttribute(ATTR_WAVE) ?? 0);
  if (wave >= 1 && wave <= FINAL_WAVE && inCave(player)) {
    startRun(player, wave, Number(player.getAttribute(ATTR_ROTATION) ?? 0), RESUME);
  } else if (inCave(player)) {
    player.moveTo(tile(EXIT));
  } else {
    player.setAttribute(ATTR_WAVE, null);
    player.setAttribute(ATTR_ROTATION, null);
  }
}

// A level-45 Tz-Kek splits into two level-22s as it falls. Done as its hitpoints hit zero,
// not on the death event, so the wave can't read as cleared in between.
function splitTzKek(player, session, npc) {
  const { NpcIdentifiers: Npcs } = core;
  if (npc.getId() !== Npcs.TZ_KEK_3 && npc.getId() !== Npcs.TZ_KEK_4) return;
  const at = { x: npc.getLocation().getX(), y: npc.getLocation().getY() };
  spawn(session, player, Npcs.TZ_KEK_5, at);
  spawn(session, player, Npcs.TZ_KEK_5, { x: at.x + 1, y: at.y });
}

module.exports = {
  name: "TzhaarFightCaves",
  members: true,
  register(pluginApi) {
    api = pluginApi;
    core = pluginApi.core;
    require("./tzhaar/TzhaarMonsters")(pluginApi);
    pluginApi.persistAttribute(ATTR_WAVE);
    pluginApi.persistAttribute(ATTR_ROTATION);
    pluginApi.persistAttribute(ATTR_LEFT_AT);
    pluginApi.onObjectFirstClick(core.ObjectIdentifiers.CAVE_ENTRANCE_44, enterCave);
    pluginApi.onObjectFirstClick(core.ObjectIdentifiers.CAVE_ENTRANCE_45, leaveCave);
    pluginApi.onObjectSecondClick(core.ObjectIdentifiers.CAVE_ENTRANCE_45, leaveCave);
    pluginApi.onPlayerLogin(resumeRun);
    pluginApi.onPlayerProcess(processRun);
    pluginApi.onPlayerDeath(caveDeath);
    pluginApi.onShouldDropItemsOnDeath(keepItemsInCave);
    pluginApi.onCanTeleport(noTeleportOut);
    pluginApi.onCanLogout(holdLogout);
  },
  waveMonsters,
};
