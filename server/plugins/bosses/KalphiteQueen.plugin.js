const { Animation } = require("../../src/main/typescript/elvarg/game/model/Animation");
const { CombatFactory } = require("../../src/main/typescript/elvarg/game/content/combat/CombatFactory");
const { CombatMethod } = require("../../src/main/typescript/elvarg/game/content/combat/method/CombatMethod");
const { CombatType } = require("../../src/main/typescript/elvarg/game/content/combat/CombatType");
const { Graphic } = require("../../src/main/typescript/elvarg/game/model/Graphic");
const { GameObject } = require("../../src/main/typescript/elvarg/game/entity/impl/object/GameObject");
const { Item } = require("../../src/main/typescript/elvarg/game/model/Item");
const { ItemIdentifiers } = require("../../src/main/typescript/elvarg/util/ItemIdentifiers");
const { Location } = require("../../src/main/typescript/elvarg/game/model/Location");
const { Misc } = require("../../src/main/typescript/elvarg/util/Misc");
const { NpcIdentifiers } = require("../../src/main/typescript/elvarg/util/NpcIdentifiers");
const { NpcDefinition } = require("../../src/main/typescript/elvarg/game/definition/NpcDefinition");
const { NPC } = require("../../src/main/typescript/elvarg/game/entity/impl/npc/NPC");
const { PendingHit } = require("../../src/main/typescript/elvarg/game/content/combat/hit/PendingHit");
const { Projectile } = require("../../src/main/typescript/elvarg/game/model/Projectile");
const { Skill } = require("../../src/main/typescript/elvarg/game/model/Skill");
const { Task } = require("../../src/main/typescript/elvarg/game/task/Task");
const { TimedObjectReplacementTask } = require("../../src/main/typescript/elvarg/game/task/impl/TimedObjectReplacementTask");

const CRAWLING = NpcIdentifiers.KALPHITE_QUEEN_2;
const AIRBORNE = NpcIdentifiers.KALPHITE_QUEEN_3;
const KQ_IDS = [CRAWLING, AIRBORNE, NpcIdentifiers.KALPHITE_QUEEN_4, NpcIdentifiers.KALPHITE_QUEEN_5];
const KQ_WORKER = NpcIdentifiers.KALPHITE_WORKER_3;
const KQ_HITPOINTS = 255;
const KQ_AGGRESSION = { aggressive: true, aggressiveTolerance: false, combatFollowDistance: 9 };
const TRANSFORMATION_TICKS = 20;
const AIRBORNE_TIMEOUT_TICKS = 2_000;
const WORKER_LIFETIME_TICKS = 100;
const ROPE_LIFETIME_TICKS = 200;
const SURFACE_ENTRANCE = new Location(3227, 3108, 0);
const LAIR_ENTRANCE = new Location(3483, 9510, 2);
const CHAMBER_ENTRANCE = new Location(3508, 9494, 0);
const CHAMBER_EXIT = new Location(3508, 9494, 2);
const SURFACE_TUNNEL = 3827;
const ROPE_TUNNEL = 3828;
const CHAMBER_TUNNEL = 19053;
const CHAMBER_ROPE_TUNNEL = 10230;
const CHAMBER_EXIT_ROPE = 3832;
const ROPE = ItemIdentifiers.ROPE;
const MOLT_ANIMATION = new Animation(6270);
const MOLT_GRAPHIC = new Graphic(1055);
const MAGIC_PROJECTILE = 280;
const MAGIC_IMPACT = new Graphic(281);
const RANGED_PROJECTILE = 289;
const KILL_COUNT_ATTRIBUTE = "boss:kalphite-queen:kills";
const KONAR_ID = 8623;
const COCOONS = [
  [3502, 9501, 0, -2, 0], [3502, 9504, 0, -2, 0], [3482, 9502, 0, -2, 0],
  [3486, 9498, 0, 0, -2], [3486, 9518, 0, 0, -2], [3488, 9518, 0, 0, -2],
  [3464, 9495, 0, 2, 0], [3472, 9508, 0, 2, 0], [3477, 9481, 0, 0, 2],
  [3480, 9481, 0, 0, 2], [3486, 9506, 0, 0, 2], [3490, 9502, 0, 2, 0],
  [3493, 9483, 0, 0, 2],
];

let TaskManager;
let ItemOnGroundManager;
let World;

function isKq(npc) {
  return KQ_IDS.includes(npc?.getId?.()) || KQ_IDS.includes(npc?.getRealId?.());
}

function isAirborne(npc) {
  return npc?.getId?.() === AIRBORNE || npc?.getId?.() === NpcIdentifiers.KALPHITE_QUEEN_5;
}

function configureAggression() {
  for (const id of KQ_IDS) {
    Object.assign(NpcDefinition.forId(id), KQ_AGGRESSION);
  }
  Object.assign(NpcDefinition.forId(KQ_WORKER), { aggressive: true, aggressiveTolerance: false });
}

class KqWorker extends NPC {
  isAggressiveTo() { return true; }
}

class WorkerDespawnTask extends Task {
  constructor(worker) { super(WORKER_LIFETIME_TICKS, worker); this.worker = worker; }
  execute() {
    if (this.worker.isRegistered?.()) {
      World.getRemoveNPCQueue().push(this.worker);
    }
    this.stop();
  }
}

class KalphiteQueenCombat extends CombatMethod {
  constructor() {
    super();
    this.attackType = CombatType.MAGIC;
  }

  type() { return this.attackType; }
  attackDistance() { return 8; }

  start(character) {
    const animation = isAirborne(character)
      ? this.attackType === CombatType.MAGIC ? 6235 : 6234
      : this.attackType === CombatType.MELEE ? 6241 : 6240;
    character.performAnimation(new Animation(animation));
  }

  hits(character, target) {
    const delay = this.attackType === CombatType.MELEE ? 1 : 2;
    const hits = [new PendingHit(character, target, this, delay)];
    if (!target.isPlayer?.() || this.attackType === CombatType.MELEE) {
      return hits;
    }

    if (this.attackType === CombatType.RANGED) {
      Projectile.createProjectile(character, target, RANGED_PROJECTILE, 40, 70, 43, 31).sendProjectile();
      for (const player of character.getAsNpc().getPlayersWithinDistance(10)) {
        if (CombatFactory.canAttackSecondaryTarget(character, target, player, 1)) {
          hits.push(new PendingHit(character, player, this, delay));
        }
      }
      return hits;
    }

    let previous = character;
    let current = target;
    const hitTargets = new Set([target]);
    while (current) {
      Projectile.createProjectile(previous, current, MAGIC_PROJECTILE, 40, 70, 43, 31).sendProjectile();
      const next = character.getAsNpc().getPlayersWithinDistance(10).find((player) =>
        !hitTargets.has(player) && CombatFactory.canAttackSecondaryTarget(character, current, player, 1)
      );
      if (!next) {
        break;
      }
      hits.push(new PendingHit(character, next, this, delay));
      hitTargets.add(next);
      previous = current;
      current = next;
    }
    return hits;
  }

  finished(character, target) {
    if (character.calculateDistance(target) <= 1) {
      const roll = Misc.randomInclusive(0, 3);
      this.attackType = roll < 2 ? CombatType.MELEE : roll === 2 ? CombatType.RANGED : CombatType.MAGIC;
    } else {
      this.attackType = Misc.randomInclusive(0, 1) === 0 ? CombatType.RANGED : CombatType.MAGIC;
    }
  }

  handleAfterHitEffects(hit) {
    const target = hit?.getTarget?.();
    if (hit?.getCombatType?.() === CombatType.MAGIC && target?.isPlayer?.()) {
      target.performGraphic(MAGIC_IMPACT);
    }
    if (hit?.getCombatType?.() !== CombatType.RANGED || hit.getTotalDamage?.() <= 0 || !target?.isPlayer?.()) {
      return;
    }
    const player = target.getAsPlayer();
    if (player.getEquipment().getItems().some((item) => item?.getId?.() === ItemIdentifiers.SPECTRAL_SPIRIT_SHIELD)
      && Misc.randomInclusive(0, 1) === 0) {
      return;
    }
    const skills = player.getSkillManager();
    const prayer = skills.getCurrentLevel?.(Skill.PRAYER);
    if (Number.isFinite(prayer) && prayer > 0) {
      skills.setCurrentLevels(Skill.PRAYER, prayer - 1);
    }
  }
}

class TransformTask extends Task {
  constructor(npc) { super(TRANSFORMATION_TICKS, npc); this.npc = npc; }
  execute() {
    if (this.npc.isRegistered?.() && this.npc.getHitpoints?.() > 0) {
      this.npc.setNpcTransformationId(AIRBORNE);
      this.npc.performAnimation(Animation.DEFAULT_RESET_ANIMATION);
      this.npc.setHitpoints(KQ_HITPOINTS);
      this.npc.setUntargetable(false);
      TaskManager.submit(new RevertTask(this.npc));
    }
    this.stop();
  }
}

class RevertTask extends Task {
  constructor(npc) { super(AIRBORNE_TIMEOUT_TICKS, npc); this.npc = npc; }
  execute() {
    if (this.npc.isRegistered?.() && isAirborne(this.npc) && this.npc.getHitpoints?.() > 0) {
      this.npc.setNpcTransformationId(CRAWLING);
    }
    this.stop();
  }
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
  npc.performAnimation(MOLT_ANIMATION);
  npc.performGraphic(MOLT_GRAPHIC);
  TaskManager.submit(new TransformTask(npc));
}

function forceKqAccuracy(event) {
  if (!isKq(event.attacker) || event.combatType === CombatType.MELEE) {
    return;
  }
  event.forceAccurate = true;
}

function hatchWorker(event) {
  const queen = event.target;
  if (!isKq(queen) || Misc.randomInclusive(1, 20) !== 1) {
    return;
  }
  const queenLocation = queen.getLocation?.();
  if (!queenLocation) {
    return;
  }
  const nearbyCocoons = COCOONS.filter(([x, y, z]) => queenLocation.calculateDistance(new Location(x, y, z)) <= 10);
  if (nearbyCocoons.length === 0) {
    return;
  }
  const [x, y, z, offsetX, offsetY] = nearbyCocoons[Misc.randomInclusive(0, nearbyCocoons.length - 1)];
  const worker = new KqWorker(KQ_WORKER, new Location(x + offsetX, y + offsetY, z));
  worker.__skipDefaultRespawn = true;
  if (event.attacker?.isPlayer?.()) {
    worker.getCombat().attack(event.attacker);
  }
  World.getAddNPCQueue().push(worker);
  TaskManager.submit(new WorkerDespawnTask(worker));
}

function attachSurfaceRope(event) {
  const { player, object, item } = event;
  const objectId = object.getId?.();
  if ((objectId !== SURFACE_TUNNEL && objectId !== CHAMBER_TUNNEL) || item.getId?.() !== ROPE) {
    return;
  }
  const inventory = player.getInventory();
  if (!inventory.contains(ROPE)) {
    return;
  }
  inventory.delete(ROPE, 1);
  const ropeId = objectId === SURFACE_TUNNEL ? ROPE_TUNNEL : CHAMBER_ROPE_TUNNEL;
  const replacement = new GameObject(
    ropeId,
    object.getLocation().clone(),
    object.getType(),
    object.getFace(),
    object.getPrivateArea()
  );
  TaskManager.submit(new TimedObjectReplacementTask(object, replacement, ROPE_LIFETIME_TICKS));
  player.moveTo(objectId === SURFACE_TUNNEL ? LAIR_ENTRANCE : CHAMBER_ENTRANCE);
  event.handled = true;
}

function enterLair({ player }) { player.moveTo(LAIR_ENTRANCE); }
function leaveLair({ player }) { player.moveTo(SURFACE_ENTRANCE); }
function enterChamber({ player }) { player.moveTo(CHAMBER_ENTRANCE); }
function leaveChamber({ player }) { player.moveTo(CHAMBER_EXIT); }

function isKonarKalphiteTask(player) {
  const task = player.getAttribute("slayer:task");
  return task?.masterId === KONAR_ID && task?.slug === "kalphite";
}

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
    drops.push(ItemIdentifiers.KQ_HEAD_TATTERED_);
  }
  if (isKonarKalphiteTask(player) && Misc.randomInclusive(1, 54) === 1) {
    drops.push(ItemIdentifiers.BRIMSTONE_KEY);
  }
  for (const itemId of drops) {
    ItemOnGroundManager.registerLocation(player, new Item(itemId, 1), npc.getLocation());
  }
}

module.exports = {
  name: "KalphiteQueen",
  register(api) {
    TaskManager = api.getTaskManager();
    ItemOnGroundManager = api.getItemOnGroundManager();
    World = api.getWorld();
    configureAggression();
    NpcDefinition.forId(CRAWLING).setRespawn(50);
    api.persistAttribute(KILL_COUNT_ATTRIBUTE);
    api.onNpcBeforeDeath(transformFirstForm);
    api.onNpcDeath(awardConditionalDrops);
    api.onCombatHitRoll(forceKqAccuracy);
    api.onCombatHitRoll(hatchWorker);
    api.onItemOnObject(attachSurfaceRope, { noted: false });
    api.onObjectFirstClick(ROPE_TUNNEL, enterLair);
    api.onObjectFirstClick(3829, leaveLair);
    api.onObjectFirstClick(CHAMBER_ROPE_TUNNEL, enterChamber);
    api.onObjectFirstClick(CHAMBER_EXIT_ROPE, leaveChamber);
    api.registerNpcCombatMethodProvider(KQ_IDS, KalphiteQueenCombat, { singleton: false });
  },
};
