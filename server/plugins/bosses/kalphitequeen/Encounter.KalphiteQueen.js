// Kalphite Queen encounter. Evidence: docs/kalphite-queen.md.
let core;
let api;
let CRAWLING, AIRBORNE, KQ_IDS, KQ_WORKER;
let KqWorker, WorkerDespawnTask, KalphiteQueenCombat, MoltStartTask, TransformTask, RevertTask;
const rangedPrayerDrains = new WeakSet();
/** Queens between the first form's death and the airborne form taking over (MOLT_DELAY_TICKS + TRANSFORMATION_TICKS). */
const molting = new WeakSet();

const KQ_HITPOINTS = 255;
const KQ_AGGRESSION = { aggressive: true, aggressiveTolerance: false, combatFollowDistance: 9, huntRange: 9 };
// Wiki: Kalphite Queen: the transition takes 20 game ticks from the first form's death. rsprox
// (docs/kalphite-queen.md): the molt (sequence 6270) starts 7 or 8 ticks after her last hitsplat, then
// she can be hit 12 ticks into it. Sequence 6270 and molt graphic 1055's sequence 6269 both last
// 345 client cycles, or 11.5 ticks at 30 cycles per tick.
const MOLT_DELAY_TICKS = 8;
const TRANSFORMATION_TICKS = 12;
const AIRBORNE_TIMEOUT_TICKS = 2_000;
const WORKER_LIFETIME_TICKS = 100;
const ROPE_LIFETIME_TICKS = 200;
const SURFACE_ENTRANCE = [3227, 3108, 0];
const LAIR_ENTRANCE = [3483, 9510, 2];
// Live (rsprox 95, 96, 545, 1757, 1864): the Queen's tunnel lands at (3508, 9493, 0) and her rope
// climbs back to (3508, 9497, 2); docs/kalphite-queen.md.
const CHAMBER_ENTRANCE = [3508, 9493, 0];
const CHAMBER_EXIT = [3508, 9497, 2];
const SURFACE_TUNNEL = 3827;
const ROPE_TUNNEL = 3828;
/**
 * The Queen's tunnel as the map places it: multiloc kalphite_chamber_entrance_update (23609), whose
 * varbit 11705 shows kalphite_chamber_entrance_norope (19053) until a rope goes in. A rope on it is
 * used with the map's id, so both are matched.
 */
const CHAMBER_TUNNELS = new Set([23609, 19053]);
const CHAMBER_ROPE_TUNNEL = 10230;
/** The Queen's chamber, under the lair: map square 54,148 on level 0 (the lair is level 2). */
const CHAMBER_AREA = { minX: 3456, maxX: 3519, minY: 9472, maxY: 9535, z: 0 };
const SURFACE_EXIT_ROPE = 3829;
const CHAMBER_EXIT_ROPE = 3832;
const MOLT_ANIMATION = 6270;
const MOLT_GRAPHIC = 1055;
const MAGIC_PROJECTILE = 280;
const MAGIC_IMPACT = 281;
const RANGED_PROJECTILE = 289;
// Both styles' flight (cycles); docs/kalphite-queen.md asks for captures before changing it.
const PROJECTILE_DELAY = 40;
const PROJECTILE_END = 70;
// Cache kalphite_update_* attack sequences.
const ATTACK_ANIMATION = Object.freeze({
  crawlingMelee: 6241,
  crawlingProjectile: 6240,
  airborneMagic: 6235,
  airborneOther: 6234,
});
const KILL_COUNT_ATTRIBUTE = "boss:kalphite-queen:kills";
/**
 * The Hard Desert Diary's ropes (Wiki, Kalphite Lair): after the diary, both ropes are placed once and
 * then stay, for that player only. The cache draws them per player: the surface tunnel
 * (kalphite_burrow_entrance) is a multiloc on varbit kalphite_rope_1 and the Queen's
 * (kalphite_chamber_entrance_update) on kalphite_chamber_entrance. Diary accounts log in with
 * kalphite_rope_1, kalphite_rope_2 and kalphite_chamber_entrance at 1 (rsprox 224/1510, 225/910132).
 * Without the diary a rope is the shared, timed loc swap below (rsprox 227/95: loc_add_change).
 */
const SURFACE_ROPE_ATTRIBUTE = "kalphite-queen:surface-rope-placed";
const CHAMBER_ROPE_ATTRIBUTE = "kalphite-queen:chamber-rope-placed";
const ROPE_VARBITS = { surface: ["kalphite_rope_1"], chamber: ["kalphite_rope_2", "kalphite_chamber_entrance"] };
const COCOONS = [
  [3502, 9501, 0, -2, 0], [3502, 9504, 0, -2, 0], [3482, 9502, 0, -2, 0],
  [3486, 9498, 0, 0, -2], [3486, 9518, 0, 0, -2], [3488, 9518, 0, 0, -2],
  [3464, 9495, 0, 2, 0], [3472, 9508, 0, 2, 0], [3477, 9481, 0, 0, 2],
  [3480, 9481, 0, 0, 2], [3486, 9506, 0, 0, 2], [3490, 9502, 0, 2, 0],
  [3493, 9483, 0, 0, 2],
];

function isKq(npc) {
  return KQ_IDS.includes(npc?.getId?.()) || KQ_IDS.includes(npc?.getRealId?.());
}

function isAirborne(npc) {
  return npc?.getId?.() === AIRBORNE || npc?.getId?.() === core.NpcIdentifiers.KALPHITE_QUEEN_5;
}

/**
 * An Echo Queen (Echo.KalphiteQueen) is re-dressed as each form she takes. The Wiki gives her
 * three attack maxima rather than one, refreshed with every form. Answers whether EchoBosses
 * accepted her.
 */
function configureEcho(npc, role) {
  const session = npc.__echoKq;
  if (!session) return false;
  const request = { player: session.player, boss: "kalphite-queen", role, npc, token: session.token, configured: false };
  api.emitCustomEvent("echo-boss:configure", request);
  npc.__echoKqMaxHits = request.maxHits ?? [];
  return request.configured;
}

function configureAggression() {
  for (const id of KQ_IDS) {
    Object.assign(core.NpcDefinition.forId(id), KQ_AGGRESSION);
  }
  Object.assign(core.NpcDefinition.forId(KQ_WORKER), { aggressive: true, aggressiveTolerance: false });
}

/** Keep the ranged roll before protection, while PendingHit still applies all damage reductions. */
function createHit(character, target, method, delay) {
  const style = method.type() === core.CombatType.MELEE ? "melee" : method.type() === core.CombatType.RANGED ? "ranged" : "magic";
  const maximum = character.__echoKqMaxHits?.find(entry => entry.label === style)?.maxHit;
  const hasStyleMaximum = character.__echoKq && Number.isInteger(maximum) && maximum >= 0;
  const drainsPrayer = method.type() === core.CombatType.RANGED && target.isPlayer();
  if (!hasStyleMaximum && !drainsPrayer) {
    return new core.PendingHit(character, target, method, delay);
  }
  const rolled = core.Misc.randomInclusive(0, hasStyleMaximum ? maximum : core.DamageFormulas.sourceMaxHit(character, core.CombatType.RANGED));
  const hit = new core.PendingHit(character, target, method, { delay, damage: rolled });
  // The Wiki specifies a positive roll, even when Protect from Missiles blocks it.
  if (drainsPrayer && rolled > 0) rangedPrayerDrains.add(hit);
  return hit;
}

function defineTypes() {
  class KqWorker extends core.NPC {
    isAggressiveTo() { return true; }
  }

  class WorkerDespawnTask extends core.Task {
    constructor(worker) { super(WORKER_LIFETIME_TICKS, worker); this.worker = worker; }
    execute() {
      if (this.worker.isRegistered?.()) {
        core.World.getRemoveNPCQueue().push(this.worker);
      }
      this.stop();
    }
  }

  class KalphiteQueenCombat extends core.CombatMethod {
    constructor() {
      super();
      this.attackType = core.CombatType.MAGIC;
    }

    type() { return this.attackType; }
    attackDistance() { return 8; }

    start(character, target) {
      // The provider constructs a fresh method each attack, so choose at launch.
      if (character.calculateDistance(target) <= 1) {
        const roll = core.Misc.randomInclusive(0, 3);
        this.attackType = roll < 2 ? core.CombatType.MELEE : roll === 2 ? core.CombatType.RANGED : core.CombatType.MAGIC;
      } else {
        this.attackType = core.Misc.randomInclusive(0, 1) === 0 ? core.CombatType.RANGED : core.CombatType.MAGIC;
      }
      const animation = isAirborne(character)
        ? this.attackType === core.CombatType.MAGIC ? ATTACK_ANIMATION.airborneMagic : ATTACK_ANIMATION.airborneOther
        : this.attackType === core.CombatType.MELEE ? ATTACK_ANIMATION.crawlingMelee : ATTACK_ANIMATION.crawlingProjectile;
      character.performAnimation(new core.Animation(animation));
    }

    hits(character, target) {
      // Projectile hits land with the flight's end (70 cycles: 3 ticks), not before it (#1862).
      const delay = this.attackType === core.CombatType.MELEE ? 1 : core.Projectile.ticksToLand(PROJECTILE_END);
      const hits = [createHit(character, target, this, delay)];
      if (!target.isPlayer?.() || this.attackType === core.CombatType.MELEE) {
        return hits;
      }

      if (this.attackType === core.CombatType.RANGED) {
        core.Projectile.createProjectile(character, target, RANGED_PROJECTILE, PROJECTILE_DELAY, PROJECTILE_END, 43, 31).sendProjectile();
        for (const player of character.getAsNpc().getPlayersWithinDistance(10)) {
          if (core.CombatFactory.canAttackSecondaryTarget(character, target, player, 1)) {
            hits.push(createHit(character, player, this, delay));
          }
        }
        return hits;
      }

      let previous = character;
      let current = target;
      const hitTargets = new Set([target]);
      while (current) {
        core.Projectile.createProjectile(previous, current, MAGIC_PROJECTILE, PROJECTILE_DELAY, PROJECTILE_END, 43, 31).sendProjectile();
        const next = character.getAsNpc().getPlayersWithinDistance(10).find((player) =>
          !hitTargets.has(player) && core.CombatFactory.canAttackSecondaryTarget(character, current, player, 1)
        );
        if (!next) {
          break;
        }
        hits.push(createHit(character, next, this, delay));
        hitTargets.add(next);
        previous = current;
        current = next;
      }
      return hits;
    }

    handleAfterHitEffects(hit) {
      const target = hit?.getTarget?.();
      if (hit?.getCombatType?.() === core.CombatType.MAGIC && target?.isPlayer?.()) {
        target.performGraphic(new core.Graphic(MAGIC_IMPACT));
      }
      if (!rangedPrayerDrains.delete(hit) || !target?.isPlayer?.()) {
        return;
      }
      const player = target.getAsPlayer();
      const drain = core.applyPrayerDrainModifiers(player, 1, { attacker: hit.getAttacker?.() });
      const skills = player.getSkillManager();
      const prayer = skills.getCurrentLevel?.(core.Skill.PRAYER);
      if (Number.isFinite(prayer) && prayer > 0 && drain > 0) {
        skills.setCurrentLevels(core.Skill.PRAYER, prayer - drain);
      }
    }
  }

  class MoltStartTask extends core.Task {
    constructor(npc) { super(MOLT_DELAY_TICKS, npc); this.npc = npc; }
    execute() {
      if (this.npc.isRegistered?.() && this.npc.getHitpoints?.() > 0) {
        this.npc.setNpcTransformationId(AIRBORNE);
        configureEcho(this.npc, "air");
        this.npc.performAnimation(new core.Animation(MOLT_ANIMATION));
        this.npc.performGraphic(new core.Graphic(MOLT_GRAPHIC));
        core.TaskManager.submit(new TransformTask(this.npc));
      } else {
        molting.delete(this.npc);
      }
      this.stop();
    }
  }

  class TransformTask extends core.Task {
    constructor(npc) { super(TRANSFORMATION_TICKS, npc); this.npc = npc; }
    execute() {
      molting.delete(this.npc);
      if (this.npc.isRegistered?.() && this.npc.getHitpoints?.() > 0) {
        this.npc.setNpcTransformationId(AIRBORNE);
        configureEcho(this.npc, "air");
        this.npc.performAnimation(core.Animation.DEFAULT_RESET_ANIMATION);
        this.npc.setHitpoints(this.npc.__echoKq ? this.npc.getMaxHitpoints() : KQ_HITPOINTS);
        this.npc.setUntargetable(false);
        core.TaskManager.submit(new RevertTask(this.npc));
      }
      this.stop();
    }
  }

  class RevertTask extends core.Task {
    constructor(npc) { super(AIRBORNE_TIMEOUT_TICKS, npc); this.npc = npc; }
    execute() {
      if (this.npc.isRegistered?.() && isAirborne(this.npc) && this.npc.getHitpoints?.() > 0) {
        this.npc.setNpcTransformationId(CRAWLING);
        configureEcho(this.npc, "ground");
      }
      this.stop();
    }
  }

  return { KqWorker, WorkerDespawnTask, KalphiteQueenCombat, MoltStartTask, TransformTask, RevertTask };
}

function transformFirstForm(event) {
  const npc = event.npc;
  if (!isKq(npc) || isAirborne(npc)) {
    return;
  }
  event.preventDeath = true;
  molting.add(npc);
  npc.setUntargetable(true);
  npc.setHitpoints(1);
  npc.getCombat().reset();
  npc.getCombat().getHitQueue().clear();
  core.TaskManager.submit(new MoltStartTask(npc));
}

/**
 * Nothing hurts the Queen while she molts. Untargetable stops attacks and clearing the hit queue
 * drops those in flight, but direct damage (a burn's tick, poison, venom) is queued straight
 * onto her and used to take her last hitpoint, killing the airborne form before it took over
 * (#4548). In the rsprox captures no hitsplat lands on her in the 12 ticks after any of 154
 * molts (recordings 95, 96, 545, 1757, 1864, 3276); none of them has status damage on her.
 * Ours: damage that still arrives is zeroed, so it shows as a 0 splat, and burn stacks keep
 * running down meanwhile, the rest carrying over to the airborne form.
 */
function holdMoltDamage({ target, hit }) {
  if (molting.has(target) && hit.getDamage() > 0) hit.setDamage(0);
}

function forceKqAccuracy(event) {
  if (!isKq(event.attacker) || event.combatType === core.CombatType.MELEE) {
    return;
  }
  event.forceAccurate = true;
}

function hatchWorker(event) {
  const queen = event.target;
  if (!isKq(queen) || core.Misc.randomInclusive(1, 20) !== 1) {
    return;
  }
  const queenLocation = queen.getLocation?.();
  if (!queenLocation) {
    return;
  }
  const nearbyCocoons = COCOONS.filter(([x, y, z]) => queenLocation.calculateDistance(new core.Location(x, y, z)) <= 10);
  if (nearbyCocoons.length === 0) {
    return;
  }
  const [x, y, z, offsetX, offsetY] = nearbyCocoons[core.Misc.randomInclusive(0, nearbyCocoons.length - 1)];
  const worker = new KqWorker(KQ_WORKER, new core.Location(x + offsetX, y + offsetY, z));
  if (queen.getPrivateArea?.()) queen.getPrivateArea().add(worker);
  worker.__skipDefaultRespawn = true;
  if (event.attacker?.isPlayer?.()) {
    worker.getCombat().attack(event.attacker);
  }
  core.World.getAddNPCQueue().push(worker);
  core.TaskManager.submit(new WorkerDespawnTask(worker));
}

function hardDiaryDone(player) {
  const request = { player, diary: "desert", tier: "hard", complete: null };
  api.emitCustomEvent("diary:is-complete", request);
  return request.complete === true;
}

function ropePlaced(player, chamber) {
  return player?.getAttribute?.(chamber ? CHAMBER_ROPE_ATTRIBUTE : SURFACE_ROPE_ATTRIBUTE) === true;
}

function sendRopes(player, chamber) {
  const value = ropePlaced(player, chamber) ? 1 : 0;
  for (const name of ROPE_VARBITS[chamber ? "chamber" : "surface"]) {
    player.getPacketSender().sendVarbit(core.CacheDefinitions.getVarbitId(name), value);
  }
}

/** A diary player's rope stays tied on, seen by that player only. */
function placeDiaryRope(player, chamber) {
  player.setAttribute(chamber ? CHAMBER_ROPE_ATTRIBUTE : SURFACE_ROPE_ATTRIBUTE, true);
  sendRopes(player, chamber);
}

function attachSurfaceRope(event) {
  const { player, object, item } = event;
  const objectId = object.getId?.();
  const chamber = CHAMBER_TUNNELS.has(objectId);
  if ((objectId !== SURFACE_TUNNEL && !chamber) || item.getId?.() !== core.ItemIdentifiers.ROPE) {
    return;
  }
  // Already tied on for good: the rope has nothing to go on.
  if (ropePlaced(player, chamber)) return;
  const inventory = player.getInventory();
  if (!inventory.contains(core.ItemIdentifiers.ROPE)) {
    return;
  }
  inventory.delete(core.ItemIdentifiers.ROPE, 1);
  if (hardDiaryDone(player)) {
    placeDiaryRope(player, chamber);
    event.handled = true;
    if (chamber) return;
    player.moveTo(new core.Location(...LAIR_ENTRANCE));
    enterHive(player);
    return;
  }
  const ropeId = chamber ? CHAMBER_ROPE_TUNNEL : ROPE_TUNNEL;
  const replacement = new core.GameObject(
    ropeId,
    object.getLocation().clone(),
    object.getType(),
    object.getFace(),
    object.getPrivateArea()
  );
  // Replace the chamber tunnel now so a second player cannot use a rope on it in the same tick.
  core.TaskManager.submit(new core.TimedObjectReplacementTask(object, replacement, ROPE_LIFETIME_TICKS, chamber));
  event.handled = true;
  // Live: the surface rope takes the player down with it; the Queen's only ties the rope on
  // (kalphite_chamber_entrance_withrope, Climb-down), and climbing it is a separate click.
  if (chamber) return;
  player.moveTo(new core.Location(...LAIR_ENTRANCE));
  enterHive(player);
}

function enterLair(event) {
  const { player, object } = event;
  const id = object.getId();
  // A diary player's own rope: the map's loc, drawn roped through its varbit.
  if (CHAMBER_TUNNELS.has(id) && ropePlaced(player, true)) return enterChamber(event);
  if (id !== ROPE_TUNNEL && !(id === SURFACE_TUNNEL && ropePlaced(player, false))) return false;
  player.moveTo(new core.Location(...LAIR_ENTRANCE));
  enterHive(player);
}

/** The easy Desert Diary's "Enter the Kalphite Hive." */
function enterHive(player) {
  api.emitCustomEvent("diary:task", { player, diary: "desert", task: "enter-the-kalphite-hive" });
}
function climbRope({ player, object }) {
  const id = object.getId();
  if (id === SURFACE_EXIT_ROPE) player.moveTo(new core.Location(...SURFACE_ENTRANCE));
  else if (id === CHAMBER_EXIT_ROPE) player.moveTo(new core.Location(...CHAMBER_EXIT));
  else return false;
}
function inChamber(at) {
  return at.getZ() === CHAMBER_AREA.z && at.getX() >= CHAMBER_AREA.minX && at.getX() <= CHAMBER_AREA.maxX
    && at.getY() >= CHAMBER_AREA.minY && at.getY() <= CHAMBER_AREA.maxY;
}

/**
 * Look-inside on the Queen's tunnel, with or without the rope, counts the players in her
 * chamber only. Captured (rsprox 1864 ticks 1162 and 1166): "You peek down and see one adventurer
 * inside the lair." with the recorder at the tunnel and a knife thrower at (3504, 9525, 2), both on
 * the hive level, so a whole-lair count (2) is ruled out.
 *
 * Two readings fit that capture: the chamber only, with someone unseen there who left before the
 * recorder climbed down at tick 1195 (the Queen was untouched then), or the whole lair minus the
 * clicker (the thrower). They differ with a busy hive and an empty chamber; no capture shows that.
 * The chamber is used, after the Wiki's 2015 update note ("other players currently in the boss
 * room"); its 2017 note ("currently inside the lair") fits either reading.
 *
 * Ours: none and two or more fill the same sentence (digits, as the scrying pool's captured count
 * does).
 */
function lookInsideText(count) {
  if (count === 0) return "You peek down and see no adventurers inside the lair.";
  if (count === 1) return "You peek down and see one adventurer inside the lair.";
  return `You peek down and see ${count} adventurers inside the lair.`;
}

function lookInside({ player, object }) {
  const id = object.getId();
  if (!CHAMBER_TUNNELS.has(id) && id !== CHAMBER_ROPE_TUNNEL) return false;
  let count = 0;
  core.World.getPlayers().forEach((other) => {
    if (other && inChamber(other.getLocation())) count++;
  });
  player.sendMessage(lookInsideText(count));
}

/** Down the Queen's roped tunnel; a league character carrying the echo orb is asked first ("echo-boss:entry"). */
function enterChamber({ player, object }) {
  const at = object?.getLocation?.();
  // The menu's No comes later: the rope may have gone by then.
  const roped = () => !at || ropePlaced(player, true)
    || core.ObjectManager.objectsAt(at).some((loc) => loc.getId() === CHAMBER_ROPE_TUNNEL);
  const entry = { player, boss: "kalphite-queen", enter: () => roped() && player.moveTo(new core.Location(...CHAMBER_ENTRANCE)), handled: false };
  api.emitCustomEvent("echo-boss:entry", entry);
  if (!entry.handled) entry.enter();
}

function onLogin({ player }) {
  if (ropePlaced(player, false)) sendRopes(player, false);
  if (ropePlaced(player, true)) sendRopes(player, true);
}

function awardConditionalDrops({ killer, npc }) {
  if (npc?.__echoKq) return;
  if (!killer?.isPlayer?.() || !isAirborne(npc)) {
    return;
  }
  npc.getDefinition().setRespawn(50);
  const player = killer.getAsPlayer();
  const kills = Math.max(0, Number(player.getAttribute(KILL_COUNT_ATTRIBUTE)) || 0) + 1;
  player.setAttribute(KILL_COUNT_ATTRIBUTE, kills);
  const drops = [];
  if (kills === 256) {
    drops.push(core.ItemIdentifiers.KQ_HEAD_TATTERED_);
  }
  for (const itemId of drops) {
    core.ItemOnGroundManager.registerLocation(player, new core.Item(itemId, 1), npc.getLocation());
  }
}

/** The collection log's "Kalphite Queen kills" are this plugin's own count. */
function collectionLogCount(request) {
  if (request.category === "Kalphite Queen") request.count = Math.max(0, Number(request.player.getAttribute(KILL_COUNT_ATTRIBUTE)) || 0);
}

/** Combat Achievements at login: the kill count kept here (plugins/achievements/combatachievements/). */
function combatAchievementsKillCount({ player, counts }) {
  const kills = Math.max(0, Number(player.getAttribute(KILL_COUNT_ATTRIBUTE)) || 0);
  if (kills > 0) counts["Kalphite Queen"] = kills;
}

function attach(pluginApi) {
  api = pluginApi;
  core = api.core;
  CRAWLING = core.NpcIdentifiers.KALPHITE_QUEEN_2;
  AIRBORNE = core.NpcIdentifiers.KALPHITE_QUEEN_3;
  KQ_IDS = [CRAWLING, AIRBORNE, core.NpcIdentifiers.KALPHITE_QUEEN_4, core.NpcIdentifiers.KALPHITE_QUEEN_5];
  KQ_WORKER = core.NpcIdentifiers.KALPHITE_WORKER_3;
  ({ KqWorker, WorkerDespawnTask, KalphiteQueenCombat, MoltStartTask, TransformTask, RevertTask } = defineTypes());
  configureAggression();
  core.NpcDefinition.forId(CRAWLING).setRespawn(50);
  api.onCustomEvent("collection-log:category-count", collectionLogCount);
  api.onCustomEvent("combat-achievements:kill-count", combatAchievementsKillCount);
  api.persistAttribute(KILL_COUNT_ATTRIBUTE, 0);
  api.persistAttribute(SURFACE_ROPE_ATTRIBUTE, false);
  api.persistAttribute(CHAMBER_ROPE_ATTRIBUTE, false);
  api.onPlayerLogin(onLogin);
  api.onNpcBeforeDeath(transformFirstForm);
  api.onCustomEvent("combat:damage-apply", holdMoltDamage);
  api.onNpcDeath(awardConditionalDrops);
  api.onCombatHitRoll(forceKqAccuracy);
  api.onCombatHitRoll(hatchWorker);
  api.onItemOnObject(attachSurfaceRope, { noted: false });
  api.onObjectInteraction("Tunnel entrance", { "Climb-down": enterLair, "Look-inside": lookInside });
  api.onObjectInteraction("Rope", { "Climb-up": climbRope });
  api.onObjectFirstClick(CHAMBER_ROPE_TUNNEL, enterChamber);
  api.registerNpcCombatMethodProvider(KQ_IDS, KalphiteQueenCombat, { singleton: false });
}

module.exports = attach;
module.exports.isAirborne = isAirborne;
module.exports.configureEcho = configureEcho;
module.exports._test = { createHit };
