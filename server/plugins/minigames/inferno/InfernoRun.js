// A run of the Inferno: a private copy of the arena, its waves, the rocky supports, the
// JalTok-Jad waves and the hand-off to TzKal-Zuk (InfernoZuk.js).
// Rules: https://oldschool.runescape.wiki/w/The_Inferno
//
// Arena tiles (spawn points, supports, Jad and revival spots) follow the Near-Reality
// behaviour reference; this server has no capture of them. They sit in region 9043.
const { FINAL_WAVE, JAD_WAVE, TRIPLE_JAD_WAVE, ZUK_WAVE, waveAt } = require("./InfernoWaves");

let api;
let core;
let monsters;
let zuk;
let InfernoArea = null;
const sessions = new WeakMap();

const ATTR_WAVE = "inferno:wave";
/** ::infernowave outside a run: the wave the next run starts at (not saved). */
const ATTR_START_WAVE = "inferno:start-wave";
const ATTR_SUPPORTS = "inferno:supports";
const ATTR_COMPLETIONS = "inferno:completions";
const WAVE_MESSAGE_COLOUR = "ef1020";
const FIRST_WAVE_DELAY_TICKS = 10;
const WAVE_DELAY_TICKS = 8;
const ZUK_WAVE_DELAY_TICKS = 2;
const EXIT_DELAY_TICKS = 8;
const COMPLETION_TOKKUL = 16440;
const PET_CHANCE = 100;
// Tokkul for a failed run is half the hitpoints of every creature in the waves cleared.
const FAILED_RUN_TOKKUL_SHARE = 0.5;

const BOUNDS = { minX: 2240, maxX: 2303, minY: 5312, maxY: 5375 };
const CENTRE = { x: 2271, y: 5343 };
const EXIT = { x: 2495, y: 5111 };
const NIBBLER_NEST = { x: 2266, y: 5345 };
const NIBBLERS_PER_TILE = 2;
// South-west corners. Each wave's creatures take a different one, in shuffled order.
const SPAWNS = [
  { x: 2274, y: 5345 }, { x: 2268, y: 5341 }, { x: 2268, y: 5339 },
  { x: 2276, y: 5339 }, { x: 2278, y: 5347 }, { x: 2264, y: 5349 },
];
const REVIVAL_SPOTS = [
  { x: 2271, y: 5343 }, { x: 2274, y: 5339 }, { x: 2268, y: 5339 },
  { x: 2274, y: 5347 }, { x: 2268, y: 5347 }, { x: 2273, y: 5345 },
];
const SINGLE_JAD = { x: 2265, y: 5348 };
const TRIPLE_JADS = [{ x: 2274, y: 5346 }, { x: 2265, y: 5347 }, { x: 2268, y: 5335 }];
const TRIPLE_JAD_STAGGER_TICKS = 3;
const JAD_FIRST_ATTACK_TICKS = 4;
// Rocky supports: the loc is a multiloc whose varbit picks the damage stage the client draws.
const SUPPORTS = [
  { key: "west", objectId: 30353, x: 2257, y: 5349 }, // rocky_support_multi
  { key: "north", objectId: 30354, x: 2274, y: 5351 },
  { key: "south", objectId: 30355, x: 2267, y: 5335 },
];
const SUPPORT_HITPOINTS = 255;
const SUPPORT_COLLAPSE_ANIM = 7561;
const SUPPORT_COLLAPSE_TICKS = 3;
const SUPPORT_REACH = 1;
const JAD_HEAL_TICKS = 4;
const JAD_MAX_HEAL = 10;
const JAD_HEALERS_SINGLE = 5;
const JAD_HEALERS_EACH = 3;
const HEALER_COMBAT_REACH = 4;
const HEAL_GRAPHIC = 444; // TZHAAR_HEAL
const HEALER_HEAL_ANIM = 2639;
const MELEER_DIG_AFTER_TICKS = 15;
const MELEER_DIG_TICKS = 4;
const MELEER_DIG_ANIM = 7600;
const MELEER_RISE_ANIM = 7601;
const MAGER_REVIVE_COOLDOWN_TICKS = 60;
const MAGER_REVIVE_DELAY_TICKS = 2;

function init(pluginApi, combat, zukPhase) {
  api = pluginApi;
  core = pluginApi.core;
  monsters = combat;
  zuk = zukPhase;
}

function ids() {
  const Npcs = core.NpcIdentifiers;
  return {
    bat: Npcs.JAL_MEJRAH, blob: Npcs.JAL_AK, meleer: Npcs.JAL_IMKOT, ranger: Npcs.JAL_XIL,
    mager: Npcs.JAL_ZEK, jad: Npcs.JALTOK_JAD, nibbler: Npcs.JAL_NIB,
  };
}

const cycle = () => core.World.getProcessCycle();
const tile = ({ x, y }) => new core.Location(x, y, 0);
const sessionOf = (player) => sessions.get(player) ?? null;

function inArena(player) {
  const location = player.getLocation();
  return location.getZ() === 0
    && location.getX() >= BOUNDS.minX && location.getX() <= BOUNDS.maxX
    && location.getY() >= BOUNDS.minY && location.getY() <= BOUNDS.maxY;
}

function say(player, npcId, ...lines) {
  const { DialogueChainBuilder, EndDialogue, NpcDialogue } = core;
  const chain = new DialogueChainBuilder();
  lines.forEach((line, index) => chain.add(new NpcDialogue(index, npcId, line)));
  chain.add(new EndDialogue(lines.length));
  player.getDialogueManager().startDialogues(chain);
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

function createArea() {
  InfernoArea ??= class extends core.PrivateArea {
    constructor() {
      super([new core.Boundary(BOUNDS.minX, BOUNDS.maxX, BOUNDS.minY, BOUNDS.maxY, 0)]);
    }

    isMulti() {
      return true;
    }
  };
  return new InfernoArea();
}

/**
 * Spawns an Inferno NPC into the run. `wave` creatures are the ones the wave waits on;
 * supports, healers and the like are not.
 */
function spawn(session, id, at, { target = null, wave = true } = {}) {
  const npc = api.spawnNpc({ id, x: at.x, y: at.y, z: 0, owner: session.player, wanderRadius: 0 });
  if (!npc) return null;
  npc.__skipDefaultRespawn = true;
  npc.__infernoRun = session;
  npc.__infernoLastStrike = cycle();
  session.area.add(npc);
  if (wave) session.npcs.add(npc);
  if (target) npc.getCombat().attack(target);
  return npc;
}

function startRun(player, wave, supportHitpoints) {
  const area = createArea();
  area.enter(player);
  player.moveTo(tile(CENTRE));
  const session = {
    player,
    area,
    wave,
    npcs: new Set(),
    fallen: [],
    supports: [],
    nibblerTurn: 0,
    jads: [],
    zuk: null,
    nextWaveAt: cycle() + FIRST_WAVE_DELAY_TICKS,
    exitAt: -1,
  };
  sessions.set(player, session);
  player.setAttribute(ATTR_WAVE, wave);
  if (wave < JAD_WAVE) raiseSupports(session, supportHitpoints);
  else SUPPORTS.forEach((support) => removeSupport(session, support));
  return session;
}

// --- Rocky supports -------------------------------------------------------------------------

function raiseSupports(session, saved) {
  const { GameObject, ObjectManager, NpcIdentifiers: Npcs } = core;
  for (const support of SUPPORTS) {
    const hitpoints = saved?.[support.key];
    if (hitpoints != null && hitpoints <= 0) {
      removeSupport(session, support);
      continue;
    }
    const object = new GameObject(support.objectId, tile(support), 10, 0, session.area);
    ObjectManager.register(object, true);
    const npc = spawn(session, Npcs.COL_00FFFF_ROCKY_SUPPORT_COL, support, { wave: false });
    if (!npc) continue;
    npc.setHitpoints(Math.min(hitpoints ?? SUPPORT_HITPOINTS, SUPPORT_HITPOINTS));
    session.supports.push({ ...support, object, npc, stage: -1 });
  }
  session.supports.forEach((support) => drawSupport(session, support));
}

/**
 * The map has the supports standing, so one that is down when a run starts (collapsed before
 * a logout, or every one from the Jad waves on) is removed as a collapse removes it.
 */
function removeSupport(session, support) {
  const { GameObject, ObjectManager } = core;
  ObjectManager.deregister(new GameObject(support.objectId, tile(support), 10, 0, session.area), true);
}

// Picks the multiloc stage for the damage taken, from the loc's own transform list.
function drawSupport(session, support) {
  const loc = core.CacheDefinitions.getObject(support.objectId);
  if (!loc?.transforms || loc.transformVarbit === -1) return;
  const stages = Math.max(1, loc.transforms.length - 1);
  const damage = 1 - Math.max(0, support.npc.getHitpoints()) / SUPPORT_HITPOINTS;
  const stage = Math.min(stages - 1, Math.floor(damage * stages));
  if (stage === support.stage) return;
  support.stage = stage;
  session.player.getPacketSender().sendVarbit(loc.transformVarbit, stage);
}

function tendSupports(session) {
  for (const support of [...session.supports]) {
    // Supports never attack, so the out-of-combat regeneration would otherwise refill them.
    support.npc.getCombat().getLastAttack().reset();
    if (support.npc.getHitpoints() <= 0) collapse(session, support, true);
    else drawSupport(session, support);
  }
}

// A collapsing support crushes whatever stands next to it: Jal-Nib outright, everything else
// (the player included) for half its remaining hitpoints.
function collapse(session, support, crush) {
  const { Animation, HitDamage, HitMask, NpcIdentifiers: Npcs, ObjectManager } = core;
  session.supports = session.supports.filter((other) => other !== support);
  ObjectManager.deregister(support.object, true);
  if (crush) {
    for (const victim of [session.player, ...session.npcs]) {
      if (victim.getHitpoints() <= 0 || victim.calculateDistance(support.npc) > SUPPORT_REACH) continue;
      const damage = victim.isNpc() && victim.getId() === Npcs.JAL_NIB
        ? victim.getHitpoints()
        : Math.floor(victim.getHitpoints() / 2);
      if (damage > 0) victim.getCombat().getHitQueue().addPendingDamage([new HitDamage(damage, HitMask.RED)]);
    }
  }
  api.removeNpc(support.npc);
  const rubble = spawn(session, Npcs.COL_00FFFF_ROCKY_SUPPORT_COL_2, support, { wave: false });
  if (!rubble) return;
  rubble.performAnimation(new Animation(SUPPORT_COLLAPSE_ANIM));
  monsters.later(rubble, SUPPORT_COLLAPSE_TICKS, () => api.removeNpc(rubble));
}

function savedSupports(session) {
  const saved = {};
  for (const { key } of SUPPORTS) {
    const support = session.supports.find((standing) => standing.key === key);
    saved[key] = support ? support.npc.getHitpoints() : 0;
  }
  return saved;
}

// Each wave's Jal-Nib go for the next standing support in turn. They never go for the player,
// and with every support down they have nothing to attack.
function nibblerTarget(session) {
  if (session.supports.length === 0) return null;
  return session.supports[session.nibblerTurn++ % session.supports.length].npc;
}

function tendNibblers(session) {
  let target;
  for (const npc of session.npcs) {
    if (npc.getId() !== core.NpcIdentifiers.JAL_NIB || npc.getHitpoints() <= 0) continue;
    const current = npc.getCombat().getTarget();
    if (current && !current.isPlayer?.() && current.getHitpoints() > 0 && current.isRegistered()) continue;
    if (target === undefined) target = nibblerTarget(session);
    if (target) npc.getCombat().attack(target);
    else if (current) npc.getCombat().reset();
  }
}

// --- Waves ----------------------------------------------------------------------------------

function shuffled(list) {
  const copy = [...list];
  for (let index = copy.length - 1; index > 0; index--) {
    const swap = core.Misc.getRandom(index);
    [copy[index], copy[swap]] = [copy[swap], copy[index]];
  }
  return copy;
}

function spawnWave(session) {
  const { player } = session;
  session.nextWaveAt = -1;
  player.sendMessage(`<col=${WAVE_MESSAGE_COLOUR}>Wave: ${session.wave}</col>`);
  if (session.wave === ZUK_WAVE) {
    zuk.begin(session);
    return;
  }
  const npcIds = ids();
  const { nibblers, monsters: creatures } = waveAt(session.wave);
  if (session.wave === JAD_WAVE) {
    addJad(session, spawn(session, npcIds.jad, SINGLE_JAD, { target: player }), JAD_FIRST_ATTACK_TICKS, JAD_HEALERS_SINGLE);
    return;
  }
  if (session.wave === TRIPLE_JAD_WAVE) {
    TRIPLE_JADS.forEach((at, index) => {
      const jad = spawn(session, npcIds.jad, at, { target: player });
      addJad(session, jad, JAD_FIRST_ATTACK_TICKS + index * TRIPLE_JAD_STAGGER_TICKS, JAD_HEALERS_EACH);
    });
    return;
  }
  const nibblerTiles = new Map();
  const target = nibblers > 0 ? nibblerTarget(session) : null;
  for (let count = 0; count < nibblers; count++) {
    const at = nibblerTile(nibblerTiles);
    // Hitting a Jal-Nib doesn't turn it on the player.
    spawn(session, npcIds.nibbler, at, { target })?.setFlag("combat:no-retaliate");
  }
  const spawns = shuffled(SPAWNS);
  [...creatures].reverse().forEach((creature, index) => {
    spawn(session, npcIds[creature], spawns[index % spawns.length], { target: player });
  });
}

function nibblerTile(used) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const at = { x: NIBBLER_NEST.x - 1 + core.Misc.getRandom(2), y: NIBBLER_NEST.y - 1 + core.Misc.getRandom(2) };
    const key = `${at.x},${at.y}`;
    if ((used.get(key) ?? 0) >= NIBBLERS_PER_TILE) continue;
    used.set(key, (used.get(key) ?? 0) + 1);
    return at;
  }
  return NIBBLER_NEST;
}

/**
 * `session.npcs` is everything that has to die for the wave to end. A Jal-Ak's three blobs
 * join it as it dies. Creatures whose fight was called off (an unreachable spot, a fallen
 * glyph) go back after the player.
 */
function tendWave(session) {
  const Npcs = core.NpcIdentifiers;
  const revivable = new Set([Npcs.JAL_MEJRAH, Npcs.JAL_AK, Npcs.JAL_IMKOT, Npcs.JAL_XIL, Npcs.JAL_ZEK]);
  for (const npc of [...session.npcs]) {
    if (npc.getHitpoints() > 0) {
      const id = npc.getId();
      const target = npc.getCombat().getTarget();
      const idle = !target || target.getHitpoints() <= 0 || !target.isRegistered();
      if (idle && id !== Npcs.JAL_NIB && id !== Npcs.TZKAL_ZUK && !npc.__infernoDigging) npc.getCombat().attack(session.player);
      continue;
    }
    session.npcs.delete(npc);
    if (npc.getId() === Npcs.JAL_AK) splitBlob(session, npc);
    if (revivable.has(npc.getId()) && !npc.__infernoRevived && session.wave < ZUK_WAVE) {
      session.fallen.push(npc.getId());
    }
  }
}

// The blob breaks into a magic, a ranged and a melee blob around where it stood.
function splitBlob(session, blob) {
  const Npcs = core.NpcIdentifiers;
  const middle = { x: blob.getLocation().getX() + 1, y: blob.getLocation().getY() + 1 };
  const offsets = [[-1, 0], [1, 0], [0, 1]];
  [Npcs.JAL_AKREK_MEJ, Npcs.JAL_AKREK_XIL, Npcs.JAL_AKREK_KET].forEach((id, index) => {
    const [dx, dy] = offsets[index];
    spawn(session, id, { x: middle.x + dx, y: middle.y + dy }, { target: session.player });
  });
}

/** Called by Jal-Zek as an attack starts: raises one fallen creature at half health. */
function tryRevive(mager) {
  const session = mager.__infernoRun;
  if (!session || session.fallen.length === 0 || session.wave >= ZUK_WAVE) return false;
  const now = cycle();
  mager.__infernoNextRevive ??= now + MAGER_REVIVE_COOLDOWN_TICKS;
  if (now < mager.__infernoNextRevive || core.Misc.getRandom(2) !== 0) return false;
  mager.__infernoNextRevive = now + MAGER_REVIVE_COOLDOWN_TICKS;
  const id = session.fallen.splice(core.Misc.getRandom(session.fallen.length - 1), 1)[0];
  monsters.later(mager, MAGER_REVIVE_DELAY_TICKS, () => {
    const at = REVIVAL_SPOTS[core.Misc.getRandom(REVIVAL_SPOTS.length - 1)];
    const revived = spawn(session, id, at, { target: session.player });
    if (!revived) return;
    revived.__infernoRevived = true;
    revived.setHitpoints(Math.floor(revived.getDefinition().getHitpoints() / 2));
    revived.performGraphic(new core.Graphic(HEAL_GRAPHIC));
  });
  return true;
}

// Jal-ImKot that cannot get a hit in for a while burrow and come up beside the player.
function tendMeleers(session) {
  const { Animation, NpcIdentifiers: Npcs } = core;
  const now = cycle();
  for (const npc of session.npcs) {
    if (npc.getId() !== Npcs.JAL_IMKOT || npc.getHitpoints() <= 0 || npc.__infernoDigging) continue;
    if (now - npc.__infernoLastStrike < MELEER_DIG_AFTER_TICKS) continue;
    npc.__infernoDigging = true;
    npc.setUntargetable(true);
    npc.setScriptedMovement(true);
    npc.getMovementQueue().reset();
    npc.performAnimation(new Animation(MELEER_DIG_ANIM));
    monsters.later(npc, MELEER_DIG_TICKS, () => {
      const at = burrowExit(session, npc);
      if (!at) {
        riseMeleer(session, npc);
        return;
      }
      // A teleported NPC is out of players' views on the tick it moves, and that tick's
      // animation is never sent, so it rises the tick after.
      npc.moveTo(at);
      monsters.later(npc, 1, () => riseMeleer(session, npc));
    });
  }
}

function riseMeleer(session, npc) {
  const { Animation } = core;
  npc.performAnimation(new Animation(MELEER_RISE_ANIM));
  npc.setUntargetable(false);
  npc.setScriptedMovement(false);
  npc.__infernoDigging = false;
  npc.__infernoLastStrike = cycle();
  npc.getCombat().attack(session.player);
}

function burrowExit(session, npc) {
  const { RegionManager } = core;
  const size = npc.getSize();
  const player = session.player.getLocation();
  const px = player.getX();
  const py = player.getY();
  const candidates = shuffled([
    { x: px - size, y: py }, { x: px + 1, y: py }, { x: px, y: py + 1 }, { x: px, y: py - size },
  ]);
  return candidates.map(tile).find((corner) => {
    for (let dx = 0; dx < size; dx++) {
      for (let dy = 0; dy < size; dy++) {
        if (RegionManager.blocked(corner.transform(dx, dy), session.area)) return false;
      }
    }
    return true;
  }) ?? null;
}

// --- JalTok-Jad -------------------------------------------------------------------------------

function addJad(session, jad, firstAttackTicks, healerCount, healerSpots = null) {
  if (!jad) return null;
  jad.getCombat().setAttackDelay(firstAttackTicks);
  const entry = { jad, healerCount, healerSpots, healers: [], called: false };
  session.jads.push(entry);
  return entry;
}

// Yt-HurKot come when a Jad drops to half health and heal it until drawn off. If they bring
// it back to full, a fresh set comes the next time it drops.
function tendJads(session) {
  const { Animation, Graphic, NpcIdentifiers: Npcs, PathFinder } = core;
  const now = cycle();
  for (const entry of [...session.jads]) {
    const { jad } = entry;
    entry.healers = entry.healers.filter((healer) => healer.getHitpoints() > 0 && healer.isRegistered());
    if (jad.getHitpoints() <= 0) {
      entry.healers.forEach((healer) => api.removeNpc(healer));
      session.jads = session.jads.filter((other) => other !== entry);
      continue;
    }
    const max = jad.getDefinition().getHitpoints();
    if (jad.getHitpoints() >= max) entry.called = false;
    if (!entry.called && jad.getHitpoints() <= max / 2) {
      entry.called = true;
      const healerId = jad.getId() === Npcs.JALTOK_JAD_2 ? Npcs.YT_HURKOT_3 : Npcs.YT_HURKOT_2;
      for (let index = entry.healers.length; index < entry.healerCount; index++) {
        const at = entry.healerSpots?.[index] ?? healerSpot(jad, index);
        const healer = spawn(session, healerId, at, { wave: false });
        if (healer) entry.healers.push(healer);
      }
    }
    for (const healer of entry.healers) {
      const fighting = healer.getCombat().getTarget() != null;
      const distance = healer.calculateDistance(jad);
      if (distance <= 1 || (fighting && distance <= HEALER_COMBAT_REACH)) {
        if (now % JAD_HEAL_TICKS === 0 && jad.getHitpoints() < max) {
          healer.setMobileInteraction(jad);
          healer.performAnimation(new Animation(HEALER_HEAL_ANIM));
          jad.performGraphic(new Graphic(HEAL_GRAPHIC));
          jad.heal(core.Misc.randomInclusive(1, JAD_MAX_HEAL));
        }
      } else if (!fighting) {
        PathFinder.calculateWalkRoute(healer, jad.getLocation().getX(), jad.getLocation().getY());
      }
    }
  }
}

function healerSpot(jad, index) {
  const size = jad.getSize();
  const at = jad.getLocation();
  const ring = [[-3, -3], [size + 2, -3], [-3, size + 2], [size + 2, size + 2], [2, size + 3]];
  const [dx, dy] = ring[index % ring.length];
  return { x: at.getX() + dx, y: at.getY() + dy };
}

// --- Run lifecycle ------------------------------------------------------------------------------

function processRun({ player }) {
  const session = sessionOf(player);
  if (!session) return;
  if (session.area.isDestroyed()) {
    sessions.delete(player);
    return;
  }
  const now = cycle();
  if (session.exitAt !== -1) {
    if (now >= session.exitAt) finishRun(player, FINAL_WAVE, true);
    return;
  }
  tendSupports(session);
  tendWave(session);
  tendNibblers(session);
  tendMeleers(session);
  tendJads(session);
  if (session.zuk) {
    if (zuk.tend(session)) session.exitAt = now + EXIT_DELAY_TICKS;
    return;
  }
  if (session.nextWaveAt === -1 && session.npcs.size === 0) {
    session.wave = session.nextWave ?? session.wave + 1;
    session.nextWave = null;
    player.setAttribute(ATTR_WAVE, session.wave);
    // The supports come down before the Jads, however the run got there.
    if (session.wave >= JAD_WAVE) [...session.supports].forEach((support) => collapse(session, support, false));
    player.setAttribute(ATTR_SUPPORTS, savedSupports(session));
    session.nextWaveAt = now + (session.wave === ZUK_WAVE ? ZUK_WAVE_DELAY_TICKS : WAVE_DELAY_TICKS);
  }
  if (session.nextWaveAt !== -1 && now >= session.nextWaveAt) spawnWave(session);
}

function monsterHitpoints(wave) {
  const { NpcDefinition, NpcIdentifiers: Npcs } = core;
  const npcIds = ids();
  const hitpoints = (id) => NpcDefinition.forId(id).getHitpoints();
  return waveAt(wave).monsters.reduce((total, creature) => {
    if (creature === "zuk") return total;
    let sum = total + hitpoints(npcIds[creature]);
    if (creature === "blob") sum += [Npcs.JAL_AKREK_MEJ, Npcs.JAL_AKREK_XIL, Npcs.JAL_AKREK_KET].reduce((blobs, id) => blobs + hitpoints(id), 0);
    return sum;
  }, 0);
}

function failedRunTokkul(wavesCleared) {
  let total = 0;
  for (let wave = 1; wave <= wavesCleared; wave++) total += monsterHitpoints(wave);
  return Math.floor(total * FAILED_RUN_TOKKUL_SHARE);
}

// Ends the run outside, by TzHaar-Ket-Keh.
function finishRun(player, wavesCleared, won) {
  const { ItemIdentifiers: Items } = core;
  const session = sessionOf(player);
  sessions.delete(player);
  player.setAttribute(ATTR_WAVE, null);
  player.setAttribute(ATTR_SUPPORTS, null);
  if (session?.zuk) zuk.closeHud(player);
  if (session) {
    session.area.leave(player, false);
    if (player.getArea() === session.area) player.setArea(null);
    session.area.destroy();
  }
  player.getCombat().reset();
  player.getMovementQueue().setBlockMovement(false);
  player.moveTo(tile(EXIT));
  const keh = TZHAAR_KET_KEH;
  if (won) {
    player.setAttribute(ATTR_COMPLETIONS, Number(player.getAttribute(ATTR_COMPLETIONS) ?? 0) + 1);
    give(player, Items.INFERNAL_CAPE, 1);
    give(player, Items.TOKKUL, COMPLETION_TOKKUL);
    if (core.Misc.getRandom(PET_CHANCE - 1) === 0) {
      give(player, Items.JAL_NIB_REK, 1);
      player.sendMessage("You have a funny feeling like you're being followed.");
    }
    say(player, keh,
      "You are very impressive for a JalYt. You managed to defeat TzKal-Zuk, for now...",
      "Please accept this cape as a token of appreciation.");
    player.sendMessage(`TzHaar-Ket-Keh hands you an Infernal cape and ${COMPLETION_TOKKUL} TokKul.`);
    return;
  }
  const tokkul = failedRunTokkul(wavesCleared);
  give(player, Items.TOKKUL, tokkul);
  if (tokkul > 0) {
    say(player, keh, "Well done in the Inferno, you can have this TokKul as reward.");
  } else {
    say(player, keh, "Not a very good attempt JalYt. Better luck next time.");
  }
}

// TzHaar-Ket-Keh by the Inferno. The generated NpcIdentifiers has no entry for this id; it is
// the spawn at 2494, 5113 in data/definitions/npc-spawns.json.
const TZHAAR_KET_KEH = 7690;

function enter(player) {
  const wave = Number(player.getAttribute(ATTR_START_WAVE) ?? 1);
  player.setAttribute(ATTR_START_WAVE, null);
  startRun(player, wave, null);
  player.sendMessage("You hit the ground in the centre of The Inferno.");
}

function leave(player) {
  const session = sessionOf(player);
  finishRun(player, session ? session.wave - 1 : 0, false);
}

function runDeath(event) {
  const session = sessionOf(event.player);
  if (!session) return;
  event.handled = true;
  // Falling after TzKal-Zuk is already down still counts as the win.
  if (session.exitAt !== -1) finishRun(event.player, FINAL_WAVE, true);
  else finishRun(event.player, session.wave - 1, false);
}

function keepItemsInRun(event) {
  if (sessions.has(event.player)) event.shouldDrop = false;
}

function noTeleportOut(event) {
  if (!sessions.has(event.player)) return;
  event.player.sendMessage("You can't teleport out of the Inferno.");
  event.allow = false;
}

// Supports, their rubble and the Ancestral Glyph never fight and cannot be struck by the player.
// TzKal-Zuk and the Jal-MejJak act from the run's tick, never through the combat engine.
let passiveIds = null;
let untouchableIds = null;

function guardPassives(event) {
  const { attacker, target } = event;
  const Npcs = core.NpcIdentifiers;
  untouchableIds ??= new Set([Npcs.COL_00FFFF_ROCKY_SUPPORT_COL, Npcs.COL_00FFFF_ROCKY_SUPPORT_COL_2, Npcs.COL_00FFFF_ANCESTRAL_GLYPH_COL]);
  passiveIds ??= new Set([...untouchableIds, Npcs.TZKAL_ZUK, Npcs.JAL_MEJJAK]);
  const inRun = (mob) => mob?.isNpc?.() && mob.__infernoRun != null;
  if (inRun(attacker) && passiveIds.has(attacker.getId())) {
    event.allow = false;
  } else if (inRun(attacker) && attacker.getId() === Npcs.JAL_NIB && target?.isPlayer?.()) {
    // Jal-Nib only ever attack the rocky supports.
    event.allow = false;
  } else if (attacker?.isPlayer?.() && inRun(target) && untouchableIds.has(target.getId())) {
    event.allow = false;
  }
}

// A support at no hitpoints collapses on the run's next tick instead of dying like a creature.
function supportsCollapse(event) {
  const { npc } = event;
  if (npc?.__infernoRun && npc.getId() === core.NpcIdentifiers.COL_00FFFF_ROCKY_SUPPORT_COL) event.preventDeath = true;
}

/**
 * Logging out with a wave under way ends the run as dying does: outside, with the TokKul for the
 * waves cleared (or the win, once TzKal-Zuk is down). Between waves the run is kept for the
 * next login, as resumeRun picks up.
 */
function runLogout({ player }) {
  const session = sessionOf(player);
  if (!session) return;
  if (session.exitAt !== -1) finishRun(player, FINAL_WAVE, true);
  else if (session.nextWaveAt === -1) finishRun(player, session.wave - 1, false);
}

// A run kept over a logout between waves starts again at the next wave, from the middle of the
// arena, with the supports as they stood. Anyone left inside without a run is put back outside.
function resumeRun({ player }) {
  const wave = Number(player.getAttribute(ATTR_WAVE) ?? 0);
  if (wave >= 1 && wave <= FINAL_WAVE) {
    startRun(player, wave, player.getAttribute(ATTR_SUPPORTS) ?? null);
  } else if (inArena(player)) {
    player.moveTo(tile(EXIT));
  }
}

/**
 * ::infernowave <n> (developer): the next wave to spawn is n. In a run, a wave under way is
 * finished first; outside, the next run starts at it.
 */
function setNextWave({ player, parts }) {
  const wave = Number(parts?.[1]);
  if (!Number.isInteger(wave) || wave < 1 || wave > FINAL_WAVE) {
    player.sendMessage(`Usage: ::infernowave <1-${FINAL_WAVE}>`);
    return;
  }
  const session = sessionOf(player);
  if (!session) {
    player.setAttribute(ATTR_START_WAVE, wave);
    player.sendMessage(`Your next Inferno run starts at wave ${wave}.`);
    return;
  }
  if (session.nextWaveAt !== -1) {
    session.wave = wave;
    player.setAttribute(ATTR_WAVE, wave);
    if (wave >= JAD_WAVE) [...session.supports].forEach((support) => collapse(session, support, false));
    player.sendMessage(`The next wave is wave ${wave}.`);
    return;
  }
  session.nextWave = wave;
  player.sendMessage(`Once this wave is cleared, the next is wave ${wave}.`);
}

function completions(player) {
  return Number(player.getAttribute(ATTR_COMPLETIONS) ?? 0);
}

module.exports = {
  ATTR_WAVE, ATTR_SUPPORTS, ATTR_COMPLETIONS, TZHAAR_KET_KEH,
  init, spawn, say, tile, cycle, addJad, sessionOf,
  enter, leave, completions, setNextWave, processRun, runDeath, keepItemsInRun, noTeleportOut, guardPassives, supportsCollapse, resumeRun, runLogout,
  tryRevive, failedRunTokkul, monsterHitpoints,
};
