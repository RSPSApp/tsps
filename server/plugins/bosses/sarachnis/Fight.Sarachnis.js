/**
 * Sarachnis' fight (Wiki: Sarachnis, Sarachnis/Strategies, checked against rsprox
 * captures docs/sarachnis.md and the NR/ReasonPS reference implementations):
 * - melee (8147) next to her, ranged (4410, projectile 1686, sound 555) further out,
 *   every 4 ticks; the hit lands from the projectile's travel (30 cycles a tick);
 * - every four standard attacks she says "Hsss!" and shoots the web (1687, sound 543):
 *   it binds everyone in the room for 6 ticks under a web loc (Aranea boots avoid it
 *   with the captured message), then she sprints to another node at 2 tiles a tick
 *   (Wiki; the captures show the teleport hops) and keeps facing nobody;
 * - successful hits heal her, 5 for melee and 10 for ranged, even at 0 damage (captured
 *   leech message only on damage, magenta splat + gfx 1542 always);
 * - at 66% and 33% health she calls two spawns per player in the room (8714 melee,
 *   8715 magic with bolt 1682); they die with her and she is back 16 ticks later.
 */
const Common = require("./Common.Sarachnis");

const { ANIM, PROJECTILE_ID, PROJECTILE_SHAPE, SOUND, HEAL, HEAL_SPLAT } = Common;

/** Generic engine flags, as in the Scurrius walk. */
const NO_RETALIATE_FLAG = "combat:no-retaliate";

/** Ticks with nobody in the room before a fight counts as a new one. */
const RESET_IDLE_TICKS = 100;

/** Created NPCs go through here so tests can watch without touching the world. */
let createMinion = (id, tile) => core.NPC.create(id, tile);

const states = new WeakMap();

let api = null;
let core = null;

function stateOf(npc) {
  let state = states.get(npc);
  if (!state) {
    state = { attacks: 0, sprint: null, spawned: new Set(), minions: [], lastStyle: null };
    states.set(npc, state);
  }
  return state;
}

/** A fresh fight for a (re)spawned boss. */
function reset(npc) {
  states.delete(npc);
}

function maxHitpoints(npc) {
  return npc.getDefinition?.()?.getHitpoints?.() ?? 400;
}

function isAdjacent(npc, target) {
  const base = npc.getLocation();
  const pos = target.getLocation();
  const size = npc.getSize?.() ?? 5;
  const dx = pos.getX() < base.getX() ? base.getX() - pos.getX()
    : pos.getX() > base.getX() + size - 1 ? pos.getX() - (base.getX() + size - 1) : 0;
  const dy = pos.getY() < base.getY() ? base.getY() - pos.getY()
    : pos.getY() > base.getY() + size - 1 ? pos.getY() - (base.getY() + size - 1) : 0;
  return Math.max(dx, dy) <= 1;
}

/** Edge-to-edge distance between the 5x5 body and a 1x1 target. */
function edgeDistance(npc, target) {
  const base = npc.getLocation();
  const pos = target.getLocation();
  const size = npc.getSize?.() ?? 5;
  const dx = pos.getX() < base.getX() ? base.getX() - pos.getX()
    : pos.getX() > base.getX() + size - 1 ? pos.getX() - (base.getX() + size - 1) : 0;
  const dy = pos.getY() < base.getY() ? base.getY() - pos.getY()
    : pos.getY() > base.getY() + size - 1 ? pos.getY() - (base.getY() + size - 1) : 0;
  return Math.max(dx, dy);
}

/** Captured projectile flight: end cycle from travel, hit from the end. */
function sendShot(npc, target, kind) {
  const shape = PROJECTILE_SHAPE[kind];
  const id = PROJECTILE_ID[kind];
  const from = core.Projectile.centreOf(npc);
  const distance = Common.tileDistance(from, target.getLocation());
  const end = Common.projectileEnd(shape, distance);
  new core.Projectile(
    from, target.getLocation(), target, id, shape.start,
    end, shape.startHeight, shape.endHeight, npc.getPrivateArea(),
  ).withSource(npc).withAngle(shape.angle).withProgress(shape.progress).sendProjectile();
  return Common.landingTicks(end) - 1;
}

function castSound(npc, soundId, delay = 0) {
  for (const player of Common.playersInRoom(npc)) {
    player.getPacketSender().sendSound(soundId, 1, delay);
  }
}

function areaSound(npc, soundId, [x, y, z], delay, range) {
  for (const player of Common.playersInRoom(npc)) {
    player.getPacketSender().sendAreaSound(soundId, x, y, z, 1, delay, range);
  }
}

/** The web loc under a bound player (shape 10, rotation 2, as captured). */
function spawnWeb(npc, player) {
  const tile = player.getLocation().clone();
  const area = npc.getPrivateArea?.() ?? null;
  const object = new core.GameObject(Common.WEB_ID, tile, 10, 2, area);
  core.ObjectManager.register(object, true);
  area?.add?.(object);
  Common.later(Common.WEB_FREEZE_TICKS, () => {
    core.ObjectManager.deregister(object, true);
  });
}

/**
 * The web: "Hsss!" with no facing, the bolt at everyone, the bind (or the boots message)
 * and the web loc under the bound, then the sprint to another corner. Captured: the bolt's
 * delay is the travel, and the boots/bound message lands with it.
 */
function webRoom(npc) {
  npc.performAnimation(new core.Animation(ANIM.ranged));
  npc.forceChat?.(Common.WEB_SAY);
  npc.setMobileInteraction(null);
  npc.setPositionToFace(null);
  castSound(npc, SOUND.web);
  const players = Common.playersInRoom(npc);
  for (const player of players) {
    // The bind, the boots line and the web loc land with the visible bolt: the delay
    // is travel-based (1-3 ticks), not a fixed 2 - submission 3932 only ever showed it,
    // booted, at the far end.
    const delay = sendShot(npc, player, "web");
    Common.later(delay, () => {
      if (!npc.isRegistered?.() || (player.getHitpoints?.() ?? 1) <= 0) return;
      if (Common.wearsAraneaBoots(player)) {
        player.sendMessage(Common.BOOTS_MESSAGE);
        return;
      }
      player.sendMessage(Common.WEB_MESSAGE);
      core.CombatFactory.freeze(player, Common.WEB_FREEZE_TICKS * 0.6, Common.WEB_MESSAGE);
      spawnWeb(npc, player);
    }, npc);
  }
  sprintToCorner(npc, stateOf(npc));
}

function pickCorner(npc) {
  const base = npc.getLocation();
  const options = Common.CORNERS.filter(([x, y]) => Math.abs(x - base.getX()) + Math.abs(y - base.getY()) > 2);
  const pool = options.length > 0 ? options : Common.CORNERS;
  return Common.location(pool[core.Misc.randomInclusive(0, pool.length - 1)]);
}

function stopSprint(npc, state) {
  state.sprint = null;
  npc.setScriptedMovement(false);
  npc.removeFlag(core.NPC.WALK_THROUGH_ENTITIES_FLAG);
  npc.removeFlag(NO_RETALIATE_FLAG);
}

/**
 * Her sprint (Wiki: 2 tiles a tick, as the captures' teleport hops show): scripted hops
 * with no facing or retaliation while she moves; attacks pause until she arrives.
 */
function sprintToCorner(npc, state) {
  const { Task, TaskManager } = core;
  const target = pickCorner(npc);
  const sprint = {};
  state.sprint = sprint;
  // The sprint clears her fight; she picks it back up where she arrives.
  const opponent = npc.getCombat().getTarget?.() ?? null;
  npc.setScriptedMovement(true);
  npc.setFlag(core.NPC.WALK_THROUGH_ENTITIES_FLAG, true);
  npc.setFlag(NO_RETALIATE_FLAG, true);
  npc.getCombat().reset?.();
  npc.getMovementQueue().reset();
  let guard = 0;
  TaskManager.submit(new (class extends Task {
    constructor() {
      super(1, npc, false);
    }
    execute() {
      if (state.sprint !== sprint) {
        this.stop();
        return;
      }
      if (!npc.isRegistered?.() || npc.getHitpoints() <= 0) {
        stopSprint(npc, state);
        this.stop();
        return;
      }
      const at = npc.getLocation();
      if (at.equals(target) || ++guard > 12) {
        npc.getMovementQueue().reset();
        stopSprint(npc, state);
        this.stop();
        reengage(npc, opponent);
        return;
      }
      // Two tiles a tick toward the corner, diagonal-first like the engine.
      let x = at.getX();
      let y = at.getY();
      for (let step = 0; step < 2; step++) {
        if (x === target.getX() && y === target.getY()) break;
        x += Math.sign(target.getX() - x);
        y += Math.sign(target.getY() - y);
      }
      npc.moveTo(new core.Location(x, y, at.getZ()));
      // Captured: the 543 spider sound rides most of the hops (submission 3932).
      castSound(npc, SOUND.web);
    }
  })());
}

/** Back at her last opponent if they are still in the room. */
function reengage(npc, opponent) {
  if (npc.getHitpoints() <= 0 || !npc.isRegistered?.()) return;
  const players = Common.playersInRoom(npc);
  const target = players.includes(opponent) ? opponent : players[0];
  if (target) npc.getCombat().attack(target);
}

/** A random walkable tile in the lair for a spawn. */
function spawnTileNear(npc) {
  const { Misc, RegionManager } = core;
  for (let attempt = 0; attempt < 20; attempt++) {
    const tile = new core.Location(
      Misc.randomInclusive(Common.LAIR.minX, Common.LAIR.maxX),
      Misc.randomInclusive(Common.LAIR.minY, Common.LAIR.maxY), 0);
    if (!RegionManager.blocked(tile, npc.getPrivateArea?.() ?? null)) return tile;
  }
  return Common.location(Common.TELEPORT_TILE);
}

/** Captured: one of each per player in the room, on random lair tiles. Returns whether
 * the wave appeared: a threshold crossing with nobody around keeps its wave for whoever
 * shows up next instead of consuming it. */
function spawnMinions(npc, state, players = Common.playersInRoom(npc)) {
  if (players.length === 0) return false;
  const area = npc.getPrivateArea?.() ?? null;
  for (const player of players) {
    for (const id of [Common.MELEE_SPAWN_ID, Common.MAGE_SPAWN_ID]) {
      const minion = createMinion(id, spawnTileNear(npc));
      minion.__skipDefaultRespawn = true;
      minion.setMultiCombat?.(true);
      if (area) area.add(minion);
      core.World.getAddNPCQueue().push(minion);
      state.minions.push(minion);
      minion.getCombat().attack(player);
    }
  }
  return true;
}

/**
 * Wiki: the waves fire at 66% and 33% of her 400 hitpoints. Checked on the hit; the spawn
 * is immediate. (Submission 3932 sampled the waves a little lower, around half and a
 * quarter - likely tick attribution against her constant self-healing; the Wiki, NR and
 * ReasonPS all agree on 66%/33%, so the Wiki wins.)
 */
function checkSpawns(npc, incomingDamage = 0) {
  if (!Common.isSarachnis(npc)) return;
  let state = stateOf(npc);
  const now = core.World.getProcessCycle();
  const max = maxHitpoints(npc);
  const projected = (npc.getHitpoints?.() ?? 0) - (Number.isFinite(incomingDamage) ? incomingDamage : 0);
  if (projected <= 0) return;
  const players = Common.playersInRoom(npc);
  if (players.length > 0) {
    state.lastSeen = now;
  } else if (now - (state.lastSeen ?? now) > RESET_IDLE_TICKS && state.spawned.size > 0) {
    // Everyone left or died mid-fight: the next group starts fresh, without the
    // previous group's leftover minions piling onto the new waves.
    for (const minion of state.minions) {
      if (minion?.isRegistered?.() && (minion.getHitpoints?.() ?? 0) > 0) minion.setHitpoints(0);
    }
    states.delete(npc);
    state = stateOf(npc);
    state.lastSeen = now;
  }
  const ratio = projected / max;
  for (const threshold of Common.SPAWN_THRESHOLDS) {
    if (ratio > threshold || state.spawned.has(threshold)) continue;
    // The threshold is only consumed when the wave actually appears: crossing it
    // with an empty room keeps the wave for whoever shows up next.
    if (spawnMinions(npc, state, players)) state.spawned.add(threshold);
  }
}

function modifyHit(event) {
  const { npc, hit } = event;
  if (!npc || !Common.isSarachnis(npc)) return;
  const incoming = (hit.getHits?.() ?? []).reduce((sum, part) => sum + (part.getDamage?.() ?? 0), 0);
  checkSpawns(npc, incoming);
}

/** Wiki: the spawns die with her; the death sounds play per corpse, as captured. */
function onBossDeath({ npc }) {
  if (!Common.isSarachnis(npc)) return;
  const state = states.get(npc);
  const spots = [[npc.getLocation().getX(), npc.getLocation().getY(), 0]];
  if (state) {
    for (const minion of state.minions) {
      if (minion?.isRegistered?.()) {
        spots.push([minion.getLocation().getX(), minion.getLocation().getY(), 0]);
        if ((minion.getHitpoints?.() ?? 1) > 0) minion.setHitpoints(0);
      }
    }
    states.delete(npc);
  }
  for (const spot of spots) areaSound(npc, SOUND.deathArea1, spot, 0, 10);
  castSound(npc, SOUND.deathSynth[0]);
  castSound(npc, SOUND.deathSynth[1]);
  Common.later(1, () => {
    for (const spot of spots) areaSound(npc, SOUND.deathArea2, spot, 0, 10);
  });
}

function defineCombatMethod() {
  const { Animation, CombatMethod, CombatType, PendingHit } = core;

  return class SarachnisCombatMethod extends CombatMethod {
    constructor() {
      super();
      this.style = CombatType.MELEE;
    }

    type() {
      return this.style;
    }

    attackDistance() {
      return Common.ATTACK_DISTANCE;
    }

    attackSpeed() {
      return Common.ATTACK_SPEED;
    }

    start(character, target) {
      const npc = character?.getAsNpc?.() ?? null;
      if (!npc || !Common.isSarachnis(npc) || !target) return;
      const state = stateOf(npc);
      if (state.sprint) {
        character.getCombat().setAttackDelay(1);
        return;
      }
      // Every four standard attacks (Wiki): the web replaces the next one, then the count restarts.
      if (state.attacks >= Common.WEB_EVERY) {
        state.attacks = 0;
        // The web breaks the sequence: ranged on either side of it are not in a row.
        state.rangedStreak = false;
        webRoom(npc);
        state.lastStyle = null;
        return;
      }
      npc.setPositionToFace?.(target.getLocation());
      const player = target.isPlayer?.() ? target.getAsPlayer() : null;
      if (isAdjacent(npc, target)) {
        this.style = CombatType.MELEE;
        state.lastStyle = "melee";
        state.attacks++;
        npc.performAnimation(new Animation(ANIM.melee));
        for (const soundId of SOUND.melee) player?.getPacketSender()?.sendSound(soundId, 1, 0);
        return;
      }
      this.style = CombatType.RANGED;
      state.lastStyle = "ranged";
      if (state.rangedStreak === true) npc.setAttribute(Common.ATTR_RANGED_TWICE, true);
      state.rangedStreak = true;
      state.attacks++;
      npc.performAnimation(new Animation(ANIM.ranged));
      this.shotDelay = sendShot(npc, target, "ranged");
      player?.getPacketSender()?.sendSound(SOUND.ranged, 1, 0);
    }

    hits(character, target) {
      const npc = character?.getAsNpc?.() ?? null;
      if (!npc || !Common.isSarachnis(npc) || !target) return [];
      const state = states.get(npc);
      if (!state || !state.lastStyle) return [];
      const melee = state.lastStyle === "melee";
      if (melee) state.rangedStreak = false;
      const hit = new PendingHit(character, target, this, melee ? 0 : (this.shotDelay ?? Common.landingTicks(Common.projectileEnd(PROJECTILE_SHAPE.ranged, 4)) - 1));
      const rolled = hit.getTotalDamage();
      hit.setTotalDamage(Math.min(Common.MAX_HIT, rolled));
      // The heal reads the style from the hit, not from shared state: a ranged bolt
      // can still be in the air when the next attack (or the web, which clears
      // lastStyle) overwrites it, and must still heal 10.
      hit.sarachnisStyle = melee ? "melee" : "ranged";
      return [hit];
    }

    handleAfterHitEffects(hit) {
      const target = hit?.getTarget?.();
      const attacker = hit?.getAttacker?.()?.getAsNpc?.() ?? hit?.getAttacker?.();
      if (!target?.isPlayer?.() || !attacker || !Common.isSarachnis(attacker)) return;
      // Wiki: successful hits heal her, even for 0 damage; misses never do. The leech
      // message only lands with damage ("as she damages you", captured 10 times over
      // 419 heal gfx in submission 3932).
      if (hit.isAccurate?.() !== true) return;
      const damage = hit.getTotalDamage?.() ?? 0;
      // Inspect Repellent fails only on actual damage, not on blocked zeros.
      if (damage > 0) attacker.setAttribute(Common.ATTR_DEALT_DAMAGE, true);
      const style = hit.sarachnisStyle ?? states.get(attacker)?.lastStyle;
      const amount = style === "ranged" ? HEAL.ranged : HEAL.melee;
      attacker.heal(amount);
      attacker.performGraphic(new core.Graphic(Common.HEAL_GFX, 0, 92));
      attacker.showHitsplat(amount, HEAL_SPLAT);
      if ((hit.getTotalDamage?.() ?? 0) > 0) target.getAsPlayer().sendMessage(Common.LEECH_MESSAGE);
    }
  };
}

function attach(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
  pluginApi.onNpcHitModify(modifyHit);
  pluginApi.onNpcDeath(onBossDeath);
  pluginApi.registerNpcCombatMethodProvider(
    [core.NpcIdentifiers.SARACHNIS],
    defineCombatMethod(),
    { singleton: false },
  );
}

module.exports = {
  attach,
  reset,
  stateOf,
  isAdjacent,
  edgeDistance,
  checkSpawns,
  spawnMinions,
  webRoom,
  modifyHit,
  onBossDeath,
  defineCombatMethod,
  _test: { stateOf, isAdjacent, edgeDistance, checkSpawns, spawnMinions, setCreateMinion: (fn) => { createMinion = fn; }, resetCreateMinion: () => { createMinion = (id, tile) => core.NPC.create(id, tile); } },
};
