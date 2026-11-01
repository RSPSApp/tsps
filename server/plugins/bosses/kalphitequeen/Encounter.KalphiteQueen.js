// Kalphite Queen encounter. Evidence: docs/kalphite-queen.md.
let core;
let CRAWLING, AIRBORNE, KQ_IDS, KQ_WORKER;
let KqWorker, WorkerDespawnTask, KalphiteQueenCombat, TransformTask, RevertTask;
const rangedPrayerDrains = new WeakSet();

const KQ_HITPOINTS = 255;
const KQ_AGGRESSION = { aggressive: true, aggressiveTolerance: false, combatFollowDistance: 9, huntRange: 9 };
const TRANSFORMATION_TICKS = 20;
const AIRBORNE_TIMEOUT_TICKS = 2_000;
const WORKER_LIFETIME_TICKS = 100;
const ROPE_LIFETIME_TICKS = 200;
const SURFACE_ENTRANCE = [3227, 3108, 0];
const LAIR_ENTRANCE = [3483, 9510, 2];
const CHAMBER_ENTRANCE = [3508, 9494, 0];
const CHAMBER_EXIT = [3508, 9494, 2];
const SURFACE_TUNNEL = 3827;
const ROPE_TUNNEL = 3828;
const CHAMBER_TUNNEL = 19053;
const CHAMBER_ROPE_TUNNEL = 10230;
const SURFACE_EXIT_ROPE = 3829;
const CHAMBER_EXIT_ROPE = 3832;
const MOLT_ANIMATION = 6270;
const MOLT_GRAPHIC = 1055;
const MAGIC_PROJECTILE = 280;
const MAGIC_IMPACT = 281;
const RANGED_PROJECTILE = 289;
// Cache kalphite_update_* attack sequences.
const ATTACK_ANIMATION = Object.freeze({
  crawlingMelee: 6241,
  crawlingProjectile: 6240,
  airborneMagic: 6235,
  airborneOther: 6234,
});
const KILL_COUNT_ATTRIBUTE = "boss:kalphite-queen:kills";
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

function configureAggression() {
  for (const id of KQ_IDS) {
    Object.assign(core.NpcDefinition.forId(id), KQ_AGGRESSION);
  }
  Object.assign(core.NpcDefinition.forId(KQ_WORKER), { aggressive: true, aggressiveTolerance: false });
}

/** Keep the ranged roll before protection, while PendingHit still applies all damage reductions. */
function createHit(character, target, method, delay) {
  if (method.type() !== core.CombatType.RANGED || !target.isPlayer()) {
    return new core.PendingHit(character, target, method, delay);
  }
  const rolled = core.Misc.randomInclusive(0, core.DamageFormulas.sourceMaxHit(character, core.CombatType.RANGED));
  const hit = new core.PendingHit(character, target, method, { delay, damage: rolled });
  // The Wiki specifies a positive roll, even when Protect from Missiles blocks it.
  if (rolled > 0) rangedPrayerDrains.add(hit);
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
      const delay = this.attackType === core.CombatType.MELEE ? 1 : 2;
      const hits = [createHit(character, target, this, delay)];
      if (!target.isPlayer?.() || this.attackType === core.CombatType.MELEE) {
        return hits;
      }

      if (this.attackType === core.CombatType.RANGED) {
        core.Projectile.createProjectile(character, target, RANGED_PROJECTILE, 40, 70, 43, 31).sendProjectile();
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
        core.Projectile.createProjectile(previous, current, MAGIC_PROJECTILE, 40, 70, 43, 31).sendProjectile();
        const next = character.getAsNpc().getPlayersWithinDistance(10).find((player) =>
          !hitTargets.has(player) && core.CombatFactory.canAttackSecondaryTarget(character, current, player, 1)
        );
        if (!next) {
          break;
        }
        hits.push(new core.PendingHit(character, next, this, delay));
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

  class TransformTask extends core.Task {
    constructor(npc) { super(TRANSFORMATION_TICKS, npc); this.npc = npc; }
    execute() {
      if (this.npc.isRegistered?.() && this.npc.getHitpoints?.() > 0) {
        this.npc.setNpcTransformationId(AIRBORNE);
        this.npc.performAnimation(core.Animation.DEFAULT_RESET_ANIMATION);
        this.npc.setHitpoints(KQ_HITPOINTS);
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
      }
      this.stop();
    }
  }

  return { KqWorker, WorkerDespawnTask, KalphiteQueenCombat, TransformTask, RevertTask };
}

function transformFirstForm(event) {
  const npc = event.npc;
  if (!isKq(npc) || isAirborne(npc)) {
    return;
  }
  event.preventDeath = true;
  npc.setUntargetable(true);
  npc.setHitpoints(1);
  npc.getCombat().reset();
  npc.getCombat().getHitQueue().clear();
  npc.setNpcTransformationId(AIRBORNE);
  npc.performAnimation(new core.Animation(MOLT_ANIMATION));
  npc.performGraphic(new core.Graphic(MOLT_GRAPHIC));
  core.TaskManager.submit(new TransformTask(npc));
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
  worker.__skipDefaultRespawn = true;
  if (event.attacker?.isPlayer?.()) {
    worker.getCombat().attack(event.attacker);
  }
  core.World.getAddNPCQueue().push(worker);
  core.TaskManager.submit(new WorkerDespawnTask(worker));
}

function attachSurfaceRope(event) {
  const { player, object, item } = event;
  const objectId = object.getId?.();
  if ((objectId !== SURFACE_TUNNEL && objectId !== CHAMBER_TUNNEL) || item.getId?.() !== core.ItemIdentifiers.ROPE) {
    return;
  }
  const inventory = player.getInventory();
  if (!inventory.contains(core.ItemIdentifiers.ROPE)) {
    return;
  }
  inventory.delete(core.ItemIdentifiers.ROPE, 1);
  const ropeId = objectId === SURFACE_TUNNEL ? ROPE_TUNNEL : CHAMBER_ROPE_TUNNEL;
  const replacement = new core.GameObject(
    ropeId,
    object.getLocation().clone(),
    object.getType(),
    object.getFace(),
    object.getPrivateArea()
  );
  core.TaskManager.submit(new core.TimedObjectReplacementTask(object, replacement, ROPE_LIFETIME_TICKS));
  player.moveTo(objectId === SURFACE_TUNNEL ? new core.Location(...LAIR_ENTRANCE) : new core.Location(...CHAMBER_ENTRANCE));
  event.handled = true;
}

function enterLair({ player, object }) {
  if (object.getId() !== ROPE_TUNNEL) return false;
  player.moveTo(new core.Location(...LAIR_ENTRANCE));
}
function climbRope({ player, object }) {
  const id = object.getId();
  if (id === SURFACE_EXIT_ROPE) player.moveTo(new core.Location(...SURFACE_ENTRANCE));
  else if (id === CHAMBER_EXIT_ROPE) player.moveTo(new core.Location(...CHAMBER_EXIT));
  else return false;
}
function enterChamber({ player }) { player.moveTo(new core.Location(...CHAMBER_ENTRANCE)); }

function awardConditionalDrops({ killer, npc }) {
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

function attach(api) {
  core = api.core;
  CRAWLING = core.NpcIdentifiers.KALPHITE_QUEEN_2;
  AIRBORNE = core.NpcIdentifiers.KALPHITE_QUEEN_3;
  KQ_IDS = [CRAWLING, AIRBORNE, core.NpcIdentifiers.KALPHITE_QUEEN_4, core.NpcIdentifiers.KALPHITE_QUEEN_5];
  KQ_WORKER = core.NpcIdentifiers.KALPHITE_WORKER_3;
  ({ KqWorker, WorkerDespawnTask, KalphiteQueenCombat, TransformTask, RevertTask } = defineTypes());
  configureAggression();
  core.NpcDefinition.forId(CRAWLING).setRespawn(50);
  api.onCustomEvent("collection-log:category-count", collectionLogCount);
  api.onCustomEvent("combat-achievements:kill-count", combatAchievementsKillCount);
  api.persistAttribute(KILL_COUNT_ATTRIBUTE, 0);
  api.onNpcBeforeDeath(transformFirstForm);
  api.onNpcDeath(awardConditionalDrops);
  api.onCombatHitRoll(forceKqAccuracy);
  api.onCombatHitRoll(hatchWorker);
  api.onItemOnObject(attachSurfaceRope, { noted: false });
  api.onObjectInteraction("Tunnel entrance", { "Climb-down": enterLair });
  api.onObjectInteraction("Rope", { "Climb-up": climbRope });
  api.onObjectFirstClick(CHAMBER_ROPE_TUNNEL, enterChamber);
  api.registerNpcCombatMethodProvider(KQ_IDS, KalphiteQueenCombat, { singleton: false });
}

module.exports = attach;
