const { Area } = require("../../src/main/typescript/elvarg/game/model/areas/Area");
const { PrivateArea } = require("../../src/main/typescript/elvarg/game/model/areas/impl/PrivateArea");
const { Boundary } = require("../../src/main/typescript/elvarg/game/model/Boundary");
const { Location } = require("../../src/main/typescript/elvarg/game/model/Location");
const { Animation } = require("../../src/main/typescript/elvarg/game/model/Animation");
const { Graphic } = require("../../src/main/typescript/elvarg/game/model/Graphic");
const { Projectile } = require("../../src/main/typescript/elvarg/game/model/Projectile");
const { GameObject } = require("../../src/main/typescript/elvarg/game/entity/impl/object/GameObject");
const { MapObjects } = require("../../src/main/typescript/elvarg/game/entity/impl/object/MapObjects");
const { OperationType } = require("../../src/main/typescript/elvarg/game/entity/impl/object/ObjectManager");
const { NPC } = require("../../src/main/typescript/elvarg/game/entity/impl/npc/NPC");
const { CombatMethod } = require("../../src/main/typescript/elvarg/game/content/combat/method/CombatMethod");
const { CombatType } = require("../../src/main/typescript/elvarg/game/content/combat/CombatType");
const { PendingHit } = require("../../src/main/typescript/elvarg/game/content/combat/hit/PendingHit");
const { HitDamage } = require("../../src/main/typescript/elvarg/game/content/combat/hit/HitDamage");
const { HitMask } = require("../../src/main/typescript/elvarg/game/content/combat/hit/HitMask");
const { LocModelType } = require("../../src/main/typescript/elvarg/game/cache/codec/rs/config/loctype/LocModelType");
const { PathFinder } = require("../../src/main/typescript/elvarg/game/model/movement/path/PathFinder");
const { ActionNode, BotController, SelectorNode } = require("../../src/main/typescript/elvarg/game/bot/BehaviorTree");
const { Skill } = require("../../src/main/typescript/elvarg/game/model/Skill");
const { ItemIdentifiers } = require("../../src/main/typescript/elvarg/util/ItemIdentifiers");
const { NpcIdentifiers } = require("../../src/main/typescript/elvarg/util/NpcIdentifiers");
const { ObjectIdentifiers } = require("../../src/main/typescript/elvarg/util/ObjectIdentifiers");
const { createBotPlayer } = require("../bots/behaviours/spawn/BotPlayerFactory");
const { buildRoamingPvpMetadata } = require("../bots/behaviours/pvp/PvpAssignment");
const { applyGeneratedPvpLoadout } = require("../bots/behaviours/policies/PvpLoadoutPolicy");
const { ATTR_SKIP_PERSISTENCE } = require("../bots/runtime/BotPersistenceConstants");
const { ShopManager } = require("../../src/main/typescript/elvarg/game/model/container/shop/ShopManager");

const CURRENT_PET_ATTRIBUTE = "pets:current";

const OVERLAY_HUD_UID = (161 << 16) | 8;
const LANDER_OVERLAY = 407;
const GAME_OVERLAY = 408;
const ACTIVITY_VARBIT = 5662;
const OUTPOST = new Boundary(2626, 2682, 2632, 2681, 0);
const GAME_BOUNDS = new Boundary(2616, 2691, 2556, 2624, 0);
const OUTPOST_RETURN = new Location(2657, 2639, 0);
const GAME_START = new Location(2657, 2611, 0);
const KNIGHT_LOCATION = new Location(2656, 2592, 0);
const GAME_SQUIRE_LOCATION = new Location(2655, 2607, 0);
const MIN_PLAYERS = 5;
const MAX_PLAYERS = 25;
const LANDER_WAIT_TICKS = 500; // Five minutes at 600 ms per game tick.
const GAME_TICKS = 2000; // Twenty minutes.
const FIRST_SHIELD_TICK = 25;
const SHIELD_INTERVAL_TICKS = 50;
const PEST_SPAWN_INTERVAL_TICKS = 10;
const MAX_PESTS = 100;
const MIN_REWARD_ACTIVITY = 1;
const MAX_ACTIVITY = 100;
const MAX_COMMENDATIONS = 4000;
const POINTS_ATTRIBUTE = "pest-control:points";

function getPoints(player) {
  const points = Number(player?.getAttribute?.(POINTS_ATTRIBUTE));
  return Number.isFinite(points) ? points : 0;
}

function setPoints(player, points) {
  player.setAttribute(POINTS_ATTRIBUTE, Math.max(0, Math.min(MAX_COMMENDATIONS, Math.trunc(points))));
}
const ATTR_WAITING_BOAT = "pest-control:waiting-boat";
const PEST_CONTROL_POINTS = "PEST_CONTROL_POINTS";
const VOID_KNIGHT_SHOP = 11;
const BOT_DEFEND_OFFSETS = [
  [-2, 1], [-1, 1], [0, 1], [1, 1], [2, 1],
  [-2, 0], [-1, 0], [1, 0], [2, 0],
  [-2, -1], [-1, -1], [0, -1], [1, -1], [2, -1],
];

const BOATS = [
  {
    key: "novice",
    name: "Novice",
    level: 40,
    points: 3,
    gangplankId: ObjectIdentifiers.GANGPLANK_27,
    exitId: ObjectIdentifiers.LADDER_175,
    waitingLocation: new Location(2661, 2639, 0),
    waitingBounds: new Boundary(2660, 2663, 2638, 2643, 0),
    squireId: NpcIdentifiers.SQUIRE_NOVICE_,
    portalHp: 200,
    unshieldedIds: [
      NpcIdentifiers.PORTAL_9,
      NpcIdentifiers.PORTAL_10,
      NpcIdentifiers.PORTAL_11,
      NpcIdentifiers.PORTAL_12,
    ],
    shieldedIds: [
      NpcIdentifiers.PORTAL_13,
      NpcIdentifiers.PORTAL_14,
      NpcIdentifiers.PORTAL_15,
      NpcIdentifiers.PORTAL_16,
    ],
    pestTier: 0,
  },
  {
    key: "intermediate",
    name: "Intermediate",
    level: 70,
    points: 4,
    gangplankId: ObjectIdentifiers.GANGPLANK_48,
    exitId: ObjectIdentifiers.LADDER_326,
    waitingLocation: new Location(2640, 2644, 0),
    waitingBounds: new Boundary(2638, 2641, 2642, 2647, 0),
    squireId: NpcIdentifiers.SQUIRE_INTERMEDIATE_,
    portalHp: 250,
    unshieldedIds: [
      NpcIdentifiers.PORTAL,
      NpcIdentifiers.PORTAL_2,
      NpcIdentifiers.PORTAL_3,
      NpcIdentifiers.PORTAL_4,
    ],
    shieldedIds: [
      NpcIdentifiers.PORTAL_5,
      NpcIdentifiers.PORTAL_6,
      NpcIdentifiers.PORTAL_7,
      NpcIdentifiers.PORTAL_8,
    ],
    pestTier: 1,
  },
  {
    key: "veteran",
    name: "Veteran",
    level: 100,
    points: 5,
    gangplankId: ObjectIdentifiers.GANGPLANK_49,
    exitId: ObjectIdentifiers.LADDER_327,
    waitingLocation: new Location(2634, 2653, 0),
    waitingBounds: new Boundary(2632, 2635, 2651, 2656, 0),
    squireId: NpcIdentifiers.SQUIRE_VETERAN_,
    portalHp: 250,
    unshieldedIds: [
      NpcIdentifiers.PORTAL,
      NpcIdentifiers.PORTAL_2,
      NpcIdentifiers.PORTAL_3,
      NpcIdentifiers.PORTAL_4,
    ],
    shieldedIds: [
      NpcIdentifiers.PORTAL_5,
      NpcIdentifiers.PORTAL_6,
      NpcIdentifiers.PORTAL_7,
      NpcIdentifiers.PORTAL_8,
    ],
    pestTier: 2,
  },
];

const PORTALS = [
  { key: "purple", name: "western, purple", colour: "a533ff", x: 2628, y: 2591, spawnX: 2631, spawnY: 2592 },
  { key: "blue", name: "eastern, blue", colour: "33d7ff", x: 2680, y: 2588, spawnX: 2679, spawnY: 2589 },
  { key: "yellow", name: "south-eastern, yellow", colour: "fff333", x: 2669, y: 2570, spawnX: 2670, spawnY: 2573 },
  { key: "red", name: "south-western, red", colour: "e32a2a", x: 2645, y: 2569, spawnX: 2646, spawnY: 2572 },
];

const PORTAL_ORDERS = [
  ["blue", "red", "yellow", "purple"],
  ["blue", "purple", "red", "yellow"],
  ["purple", "blue", "yellow", "red"],
  ["purple", "yellow", "blue", "red"],
  ["yellow", "red", "purple", "blue"],
  ["yellow", "purple", "red", "blue"],
];

const PEST_IDS = {
  splatter: [
    [NpcIdentifiers.SPLATTER, NpcIdentifiers.SPLATTER_2, NpcIdentifiers.SPLATTER_3],
    [NpcIdentifiers.SPLATTER_2, NpcIdentifiers.SPLATTER_3, NpcIdentifiers.SPLATTER_4],
    [NpcIdentifiers.SPLATTER_3, NpcIdentifiers.SPLATTER_4, NpcIdentifiers.SPLATTER_5],
  ],
  shifter: [
    [NpcIdentifiers.SHIFTER, NpcIdentifiers.SHIFTER_3, NpcIdentifiers.SHIFTER_5],
    [NpcIdentifiers.SHIFTER_3, NpcIdentifiers.SHIFTER_5, NpcIdentifiers.SHIFTER_7],
    [NpcIdentifiers.SHIFTER_5, NpcIdentifiers.SHIFTER_7, NpcIdentifiers.SHIFTER_9],
  ],
  ravager: [
    [NpcIdentifiers.RAVAGER, NpcIdentifiers.RAVAGER_2, NpcIdentifiers.RAVAGER_3],
    [NpcIdentifiers.RAVAGER_2, NpcIdentifiers.RAVAGER_3, NpcIdentifiers.RAVAGER_4],
    [NpcIdentifiers.RAVAGER_3, NpcIdentifiers.RAVAGER_4, NpcIdentifiers.RAVAGER_5],
  ],
  spinner: [
    [NpcIdentifiers.SPINNER, NpcIdentifiers.SPINNER_2, NpcIdentifiers.SPINNER_3],
    [NpcIdentifiers.SPINNER_2, NpcIdentifiers.SPINNER_3, NpcIdentifiers.SPINNER_5],
    [NpcIdentifiers.SPINNER_3, NpcIdentifiers.SPINNER_5, NpcIdentifiers.SPINNER_4],
  ],
  torcher: [
    [NpcIdentifiers.TORCHER, NpcIdentifiers.TORCHER_3, NpcIdentifiers.TORCHER_5],
    [NpcIdentifiers.TORCHER_3, NpcIdentifiers.TORCHER_5, NpcIdentifiers.TORCHER_7],
    [NpcIdentifiers.TORCHER_5, NpcIdentifiers.TORCHER_7, NpcIdentifiers.TORCHER_9, NpcIdentifiers.TORCHER_10],
  ],
  defiler: [
    [NpcIdentifiers.DEFILER, NpcIdentifiers.DEFILER_3, NpcIdentifiers.DEFILER_5],
    [NpcIdentifiers.DEFILER_3, NpcIdentifiers.DEFILER_5, NpcIdentifiers.DEFILER_7],
    [NpcIdentifiers.DEFILER_5, NpcIdentifiers.DEFILER_7, NpcIdentifiers.DEFILER_9],
  ],
  brawler: [
    [NpcIdentifiers.BRAWLER, NpcIdentifiers.BRAWLER_2, NpcIdentifiers.BRAWLER_3],
    [NpcIdentifiers.BRAWLER_2, NpcIdentifiers.BRAWLER_3, NpcIdentifiers.BRAWLER_4],
    [NpcIdentifiers.BRAWLER_3, NpcIdentifiers.BRAWLER_4],
  ],
};

// OSRS waves are weighted toward the common melee pests; special pests remain
// present without making every wave a uniform lottery.
const SPAWN_WEIGHTS = [
  ["shifter", 3], ["splatter", 3], ["ravager", 2], ["spinner", 2],
  ["defiler", 1], ["torcher", 1], ["brawler", 1],
];
const PEST_COMBAT_LEVELS = {
  splatter: [22, 33, 44], shifter: [36, 57, 76], ravager: [36, 53, 71],
  spinner: [37, 55, 74], torcher: [33, 49, 67], defiler: [33, 50, 66], brawler: [51, 76, 101],
};
const SPINNER_IDS = new Set(PEST_IDS.spinner.flat());
const TORCHER_IDS = PEST_IDS.torcher.flat();
const DEFILER_IDS = PEST_IDS.defiler.flat();
const STRUCTURE_MIN_ID = ObjectIdentifiers.BARRICADE_6;
const STRUCTURE_MAX_ID = ObjectIdentifiers.GATE_135;

function formatTicks(ticks) {
  const seconds = Math.max(0, Math.ceil(ticks * 0.6));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function randomOf(values) {
  return values[Math.floor(Math.random() * values.length)];
}

function randomPestType() {
  const total = SPAWN_WEIGHTS.reduce((sum, [, weight]) => sum + weight, 0);
  let roll = Math.floor(Math.random() * total);
  for (const [type, weight] of SPAWN_WEIGHTS) {
    roll -= weight;
    if (roll < 0) return type;
  }
  return "shifter";
}

function applyPortalCombatStats(npc, key) {
  const stats = npc.getDefinition().getStats();
  stats[2] = 120;
  for (let index = 10; index <= 14; index++) stats[index] = 100;
  const weakBonus = { purple: 14, blue: 13, yellow: 11, red: 12 }[key];
  if (weakBonus !== undefined) stats[weakBonus] = 0;
}

function applyPestStats(npc, type, tier) {
  const definition = npc.getDefinition();
  const level = PEST_COMBAT_LEVELS[type]?.[tier] ?? 1;
  definition.combatLevel = level;
  const stats = definition.getStats();
  stats[0] = level;
  stats[1] = level;
  stats[2] = level;
  definition.setMaxHitpoints(Math.max(definition.getHitpoints(), level * 2));
  npc.setHitpoints(definition.getHitpoints());
}

function routePest(npc, x, y) {
  const movement = npc.getMovementQueue();
  if (movement.lastDestX === x && movement.lastDestY === y && (movement.size() > 0 || movement.isMovings())) {
    return;
  }
  PathFinder.calculateWalkRoute(npc, x, y);
}

function choosePortalOrder(random = Math.random) {
  return [...PORTAL_ORDERS[Math.floor(random() * PORTAL_ORDERS.length)]];
}

function clampActivity(value) {
  return Math.max(0, Math.min(MAX_ACTIVITY, value | 0));
}

class DefilerCombatMethod extends CombatMethod {
  type() { return CombatType.RANGED; }
  attackDistance() { return 6; }
  hits(character, target) { return [new PendingHit(character, target, this, 1)]; }
  start(character, target) {
    const animation = character.getAttackAnim?.();
    if (animation >= 0) character.performAnimation(new Animation(animation));
    Projectile.createProjectile(character, target, 656, 62, 80, 35, 43).sendProjectile();
  }
}

class TorcherCombatMethod extends CombatMethod {
  type() { return CombatType.MAGIC; }
  attackDistance() { return 10; }
  hits(character, target) { return [new PendingHit(character, target, this, 1)]; }
  start(character, target) {
    const animation = character.getAttackAnim?.();
    if (animation >= 0) character.performAnimation(new Animation(animation));
    Projectile.createProjectile(character, target, 647, 62, 80, 50, 43).sendProjectile();
  }
}

let AreaManager;
let ObjectManager;
let RegionManager;
let World;

function moveBetweenAreas(player, area, location) {
  const current = player.getArea?.();
  if (current && current !== area) {
    current.leave(player, false);
    if (player.getArea?.() === current) player.setArea(null);
  }
  if (player.getArea?.() !== area) {
    area.enter(player);
    if (player.getArea?.() !== area) player.setArea(area);
  }
  player.moveTo(location);
}

function closeOverlay(player) {
  player.getPacketSender().closeSubInterface(OVERLAY_HUD_UID);
}

function restorePlayer(player) {
  player.getCombat().reset();
  player.resetAttributes();
  player.setSpecialPercentage(100);
  player.getPacketSender().updateSpecialAttackOrb();
}

function botsNeeded(queueLength) {
  return Math.max(0, MAX_PLAYERS - queueLength);
}

function adoptPendingBots(state, players) {
  for (const bot of players) {
    if (bot.isPlayerBot?.() !== true
      || bot.getAttribute?.(ATTR_WAITING_BOAT) !== state.boat.key
      || bot.getArea?.() === state.area) continue;
    moveBetweenAreas(bot, state.area, state.boat.waitingLocation.clone());
  }
}

function chooseDefenceTarget(knight, npcs, random = Math.random) {
  const combat = knight.getCombat();
  const attacker = combat.getAttacker?.();
  const hitQueue = combat.getHitQueue();
  const engaged = [];
  for (const npc of npcs) {
    if (!npc.__pcType
      || npc.getHitpoints() <= 0
      || npc.isRegistered?.() === false
      || npc.getPrivateArea?.() !== knight.getPrivateArea?.()
      || npc.getCombat?.().getTarget?.() !== knight
      || (npc !== attacker && !hitQueue.hasPendingHitFrom(npc))) continue;
    engaged.push(npc);
  }
  return engaged[Math.floor(random() * engaged.length)] ?? null;
}

function createDefenderTree(match) {
  return new SelectorNode([
    new ActionNode(({ player }) => match.defendKnight(player)),
    new ActionNode((context) => match.holdDefencePosition(context)),
  ]);
}

function gateGroupKey(location) {
  if (location.getX() === 2643) return "west";
  if (location.getX() === 2670) return "east";
  if (location.getY() === 2585) return "south";
  return null;
}

function logoutBot(player) {
  player.setAttribute(ATTR_SKIP_PERSISTENCE, true);
  player.getForcedLogoutTimer().start(0);
  player.requestLogout();
}

function releaseMatchPlayer(player, area) {
  if (player.isPlayerBot?.() === true) return logoutBot(player);
  area.leave(player, false);
  player.moveTo(OUTPOST_RETURN.clone());
}

function cleanupMatchNpcs(npcs, world) {
  const addQueue = world.getAddNPCQueue();
  const removeQueue = world.getRemoveNPCQueue();
  for (const npc of npcs) {
    npc.getCombat?.().reset?.();
    npc.getMovementQueue?.().reset?.();
    npc.setVisible?.(false);
    for (let index = addQueue.indexOf(npc); index !== -1; index = addQueue.indexOf(npc)) addQueue.splice(index, 1);
    if (npc.isRegistered?.() && !removeQueue.includes(npc)) removeQueue.push(npc);
  }
  npcs.clear();
}

function resetStructures(structures, replace) {
  for (const state of structures.values()) {
    if (state.damage === 0 && !state.open) continue;
    state.damage = 0;
    state.open = false;
    replace(state);
  }
}

class PestControlMatchArea extends PrivateArea {
  constructor(match) {
    super([GAME_BOUNDS]);
    this.match = match;
  }

  getName() { return `Pest Control (${this.match.boat.name})`; }
  allowSummonPet() { return false; }

  postEnter(mobile) {
    super.postEnter(mobile);
    if (!mobile.isPlayer?.()) return;
    const player = mobile.getAsPlayer();
    this.match.onPlayerEnter(player);
  }

  postLeave(mobile, logout) {
    if (mobile.isPlayer?.()) this.match.onPlayerLeave(mobile.getAsPlayer(), logout);
    super.postLeave(mobile, logout);
  }

  process(mobile) {
    this.match.processOnce();
    if (mobile.isNpc?.()) {
      const npc = mobile.getAsNpc();
      if (npc !== this.match.knight) npc.getCombat().getLastAttack().reset();
      this.match.processPest(npc);
    }
    if (mobile.isPlayer?.()) {
      const player = mobile.getAsPlayer();
      if (player.isPlayerBot?.() === true) this.match.processBot(player);
      this.match.updatePlayerOverlay(player);
    }
  }
}

class PestControlMatch {
  constructor(boat, players, onFinished) {
    this.boat = boat;
    this.onFinished = onFinished;
    this.area = new PestControlMatchArea(this);
    this.players = new Map();
    this.npcs = new Set();
    this.portalByNpc = new Map();
    this.portals = new Map();
    this.structures = new Map();
    this.botControllers = new Map();
    this.elapsedTicks = 0;
    this.lastCycle = -1;
    this.ended = false;
    this.shieldOrder = choosePortalOrder();
    this.shieldsDropped = 0;

    this.initializeStructures();
    this.knight = this.spawnNpc(randomOf([
      NpcIdentifiers.VOID_KNIGHT_5,
      NpcIdentifiers.VOID_KNIGHT_6,
      NpcIdentifiers.VOID_KNIGHT_7,
      NpcIdentifiers.VOID_KNIGHT_8,
    ]), KNIGHT_LOCATION);
    this.knight.__pcKind = "knight";
    this.knight.getMovementQueue().setBlockMovement(true).reset();
    this.squire = this.spawnNpc(NpcIdentifiers.SQUIRE_12, GAME_SQUIRE_LOCATION);
    this.squire.__pcKind = "squire";

    PORTALS.forEach((data, index) => {
      const npc = this.spawnNpc(boat.shieldedIds[index], new Location(data.x, data.y, 0));
      npc.setHitpoints(boat.portalHp);
      applyPortalCombatStats(npc, data.key);
      npc.__pcKind = "portal";
      npc.setFlag("combat:no-retaliate");
      const state = { ...data, index, npc, shielded: true, dead: false, hp: boat.portalHp };
      this.portals.set(data.key, state);
      this.portalByNpc.set(npc, state);
    });

    let defenderIndex = 0;
    for (const player of players) {
      this.players.set(player, { activity: 100, damage: 0, sent: new Map() });
      if (player.isPlayerBot?.() === true) {
        const [offsetX, offsetY] = BOT_DEFEND_OFFSETS[defenderIndex++ % BOT_DEFEND_OFFSETS.length];
        const defendAt = KNIGHT_LOCATION.clone().add(offsetX, offsetY);
        this.botControllers.set(player, new BotController(
          player,
          defendAt.getX(),
          defendAt.getY(),
          defendAt.getZ(),
          createDefenderTree(this)
        ));
      }
      moveBetweenAreas(player, this.area, GAME_START.clone());
    }
  }

  defendKnight(player) {
    const combat = player.getCombat();
    const current = combat.getTarget?.();
    const target = chooseDefenceTarget(this.knight, current ? [current] : [])
      ?? chooseDefenceTarget(this.knight, this.npcs);
    if (!target) {
      if (current?.__pcType) combat.reset();
      return "failure";
    }
    if (current !== target) combat.attack(target);
    return "running";
  }

  holdDefencePosition({ player, spawnX, spawnY, spawnZ }) {
    if (player.getHitpoints() <= 0 || player.getPrivateArea?.() !== this.area) return "failure";
    const destination = new Location(spawnX, spawnY, spawnZ);
    if (player.getLocation().getDistance(destination) <= 1) return "running";
    if (player.getMovementQueue().size() === 0) {
      PathFinder.calculateWalkRoute(player, spawnX, spawnY);
    }
    return "running";
  }

  processBot(player) {
    this.botControllers.get(player)?.tick(Date.now());
  }

  spawnNpc(id, location) {
    const npc = NPC.create(id, location.clone());
    npc.__skipDefaultRespawn = true;
    this.area.enter(npc);
    this.npcs.add(npc);
    World.getAddNPCQueue().push(npc);
    return npc;
  }

  initializeStructures() {
    RegionManager.loadMapFiles(2656, 2592);
    for (const list of MapObjects.mapObjects.values()) {
      for (const base of list) {
        const id = base.getId();
        const location = base.getLocation();
        if (!GAME_BOUNDS.inside(location) || id < STRUCTURE_MIN_ID || id > STRUCTURE_MAX_ID) continue;
        if (id >= ObjectIdentifiers.BARRICADE_6 && id <= ObjectIdentifiers.BARRICADE_14) {
          const shape = (id - ObjectIdentifiers.BARRICADE_6) % 3;
          this.addStructure("barricade", ObjectIdentifiers.BARRICADE_6 + shape, base);
        } else if (id >= ObjectIdentifiers.GATE_120 && id <= ObjectIdentifiers.GATE_123) {
          const closedId = id % 2 === 0 ? id - 1 : id;
          this.addStructure("gate", closedId, base, gateGroupKey(location));
        }
      }
    }
  }

  addStructure(kind, fullId, base, group = null) {
    const object = new GameObject(fullId, base.getLocation().clone(), base.getType(), base.getFace(), this.area);
    ObjectManager.register(object, false);
    this.structures.set(this.structureKey(object), {
      kind,
      object,
      fullId,
      damage: 0,
      maxDamage: kind === "gate" ? 3 : 2,
      open: false,
      baseFace: base.getFace(),
      baseType: base.getType(),
      baseLocation: base.getLocation().clone(),
      group,
    });
  }

  structureKey(object) {
    const location = object.getLocation();
    return `${location.getX()},${location.getY()},${object.getType()}`;
  }

  replaceStructure(state) {
    const old = state.object;
    const damageOffset = state.kind === "gate" ? state.damage * 4 : state.damage * 3;
    const openOffset = state.kind === "gate" && state.open ? 1 : 0;
    const face = state.kind === "gate" && state.open
      ? (state.baseFace + (state.fullId === ObjectIdentifiers.GATE_120 ? 1 : 3)) & 3
      : state.baseFace;
    const location = state.baseLocation.clone();
    if (state.kind === "gate" && state.open) {
      if (location.getX() === 2643) location.addX(-1);
      else if (location.getX() === 2670) location.addX(1);
      else if (location.getY() === 2585) location.addY(-1);
    }
    const replacement = new GameObject(
      state.fullId + damageOffset + openOffset,
      location,
      state.damage >= state.maxDamage ? LocModelType.FLOOR_DECORATION : state.baseType,
      face,
      this.area
    );
    ObjectManager.deregister(old, true);
    this.area.detach(old);
    state.object = replacement;
    ObjectManager.register(replacement, true);
  }

  resetStructures() {
    resetStructures(this.structures, (state) => this.replaceStructure(state));
  }

  cleanupStructures() {
    const objects = [...this.structures.values()].map((state) => state.object);
    for (const object of [...World.getObjects()]) {
      if (object.getPrivateArea?.() === this.area && !objects.includes(object)) objects.push(object);
    }
    for (const state of this.structures.values()) {
      ObjectManager.deregister(state.object, false);
      this.area.detach(state.object);
    }
    // Replacements are registered globally but are not re-added to area.entities;
    // remove any leaked match-owned objects as well (notably offset open gates).
    for (const object of [...World.getObjects()]) {
      if (object.getPrivateArea?.() === this.area) ObjectManager.deregister(object, false);
    }
    for (const object of objects) ObjectManager.perform(object, OperationType.DESPAWN);
    this.structures.clear();
  }

  onPlayerEnter(player) {
    const state = this.players.get(player);
    if (!state || this.ended) return;
    player.setAttribute("pest-control:match", this);
    player.getPacketSender().sendSubInterface(OVERLAY_HUD_UID, GAME_OVERLAY, 1);
    player.sendMessage("You must defend the Void Knight and destroy the four portals!");
    this.updatePlayerOverlay(player, true);
  }

  onPlayerLeave(player, logout) {
    closeOverlay(player);
    player.setAttribute("pest-control:match", null);
    if (!this.players.has(player)) return;
    this.players.delete(player);
    if (logout) player.setLocation(OUTPOST_RETURN.clone());
    if (!this.ended && this.players.size === 0) this.finish(false, "All players left the island.");
  }

  processOnce() {
    if (this.ended) return;
    const cycle = World.getProcessCycle();
    if (cycle === this.lastCycle) return;
    this.lastCycle = cycle;
    this.elapsedTicks++;

    if (this.knight.getHitpoints() <= 0) {
      this.finish(false, "The Void Knight was killed. The island is lost.");
      return;
    }
    if ([...this.portals.values()].every((portal) => portal.dead)) {
      this.finish(true, "All four portals have been destroyed!");
      return;
    }
    if (this.elapsedTicks >= GAME_TICKS) {
      this.finish(true, "The Void Knight completed the ritual!");
      return;
    }

    const nextShieldTick = FIRST_SHIELD_TICK + this.shieldsDropped * SHIELD_INTERVAL_TICKS;
    if (this.shieldsDropped < 4 && this.elapsedTicks >= nextShieldTick) this.dropNextShield();
    if (this.elapsedTicks % PEST_SPAWN_INTERVAL_TICKS === 0) this.spawnWave();
    if (this.elapsedTicks % 5 === 0) {
      for (const state of this.players.values()) state.activity = clampActivity(state.activity - 1);
    }
  }

  dropNextShield() {
    const portal = this.portals.get(this.shieldOrder[this.shieldsDropped++]);
    if (!portal || portal.dead || !portal.shielded) return;
    portal.shielded = false;
    portal.npc.setNpcTransformationId(this.boat.unshieldedIds[portal.index]);
    applyPortalCombatStats(portal.npc, portal.key);
    for (const player of this.players.keys()) {
      player.sendMessage(
        `The <col=${portal.colour}>${portal.name}</col> portal shield has dropped!`
      );
    }
  }

  spawnWave() {
    const live = [...this.portals.values()].filter((portal) => !portal.dead);
    const pests = [...this.npcs].filter((npc) => npc.__pcType && npc.getHitpoints() > 0);
    if (live.length === 0 || pests.length >= MAX_PESTS) return;
    for (let i = 0; i < live.length && pests.length + i < MAX_PESTS; i++) {
      const portal = live[i];
      const type = randomPestType();
      const ids = PEST_IDS[type][this.boat.pestTier];
      const npc = this.spawnNpc(randomOf(ids), new Location(portal.spawnX, portal.spawnY, 0));
      npc.__pcType = type;
      npc.__pcPortal = portal.key;
      npc.__pcNextAction = this.elapsedTicks;
      // Pests move as a horde: other mobiles must not make their static route stall.
      npc.canWalkThroughNPCs = () => true;
      // These pests have a fixed objective. Radius zero disables the generic
      // random-wander coordinator without disabling their explicit routes.
      npc.getMovementCoordinator().setRadius(
        type === "ravager" || type === "splatter" || type === "spinner" ? 0 : 64
      );
      applyPestStats(npc, type, this.boat.pestTier);
    }
  }

  processPest(npc) {
    if (this.ended || !npc.__pcType || npc.getHitpoints() <= 0) return;
    const type = npc.__pcType;
    if (type === "spinner") return this.processSpinner(npc);
    if (type === "splatter" || type === "ravager") return this.processStructurePest(npc, type);

    const target = this.knight;
    if (!target || target.getHitpoints() <= 0) return;

    if (type === "shifter" && this.elapsedTicks >= (npc.__pcNextTeleport || 0)
      && npc.getLocation().getDistance(target.getLocation()) > 1) {
      npc.performGraphic(new Graphic(654));
      npc.moveTo(target.getLocation().clone().add(Math.random() < 0.5 ? 1 : -1, 0));
      npc.performGraphic(new Graphic(654));
      npc.__pcNextTeleport = this.elapsedTicks + 15;
    }
    if (npc.getCombat().getTarget?.() !== target) npc.getCombat().attack(target);
  }

  processSpinner(npc) {
    npc.getCombat().reset();
    const portal = this.portals.get(npc.__pcPortal);
    if (!portal || portal.dead) return;
    const distance = npc.getLocation().getDistance(portal.npc.getLocation());
    if (distance > 3) {
      routePest(npc, portal.x, portal.y);
      return;
    }
    if (this.elapsedTicks < npc.__pcNextAction || portal.npc.getHitpoints() >= this.boat.portalHp) return;
    npc.__pcNextAction = this.elapsedTicks + 4;
    npc.setMobileInteraction(portal.npc);
    npc.performGraphic(new Graphic(658));
    npc.performAnimation(new Animation(3911));
    portal.npc.heal(10 + Math.floor(Math.random() * 11));
  }

  processStructurePest(npc, type) {
    npc.getCombat().reset();
    let structure = npc.__pcStructure;
    if (!structure || structure.damage >= structure.maxDamage) {
      structure = this.closestStandingStructure(npc);
      npc.__pcStructure = structure;
    }
    if (!structure) return;
    const distance = npc.getLocation().getDistance(structure.object.getLocation());
    if (distance > 1) {
      const at = structure.object.getLocation();
      routePest(npc, at.getX(), at.getY());
      return;
    }
    if (type === "splatter") {
      this.explodeSplatter(npc);
      npc.setHitpoints(0);
      return;
    }
    if (this.elapsedTicks >= npc.__pcNextAction) {
      npc.__pcNextAction = this.elapsedTicks + 6;
      const animation = npc.getAttackAnim?.();
      if (animation >= 0) npc.performAnimation(new Animation(animation));
      structure.damage = Math.min(structure.maxDamage, structure.damage + 1);
      this.replaceStructure(structure);
    }
  }

  closestPlayer(npc) {
    let closest = null;
    let distance = Infinity;
    for (const player of this.players.keys()) {
      const current = npc.getLocation().getDistance(player.getLocation());
      if (player.getHitpoints() > 0 && current < distance) {
        closest = player;
        distance = current;
      }
    }
    return closest;
  }

  closestStandingStructure(npc) {
    let closest = null;
    let distance = Infinity;
    for (const state of this.structures.values()) {
      if (state.damage >= state.maxDamage) continue;
      const current = npc.getLocation().getDistance(state.object.getLocation());
      if (current < distance) {
        closest = state;
        distance = current;
      }
    }
    return closest;
  }

  handleDamage(player, target, damage) {
    const state = this.players.get(player);
    if (!state || damage <= 0 || target.getPrivateArea?.() !== this.area) return;
    state.damage += damage;
    const priority = this.portalByNpc.has(target) || SPINNER_IDS.has(target.getId?.());
    state.activity = clampActivity(state.activity + damage * (priority ? 2 : 1));
  }

  handleNpcDeath(npc) {
    if (!this.npcs.has(npc)) return;
    npc.__skipDefaultRespawn = true;
    const portal = this.portalByNpc.get(npc);
    if (portal && !portal.dead) {
      portal.dead = true;
      portal.shielded = false;
      this.knight.heal(50);
      this.burstSpinners(portal.key);
      return;
    }
    if (npc.__pcType === "splatter") this.explodeSplatter(npc);
  }

  explodeSplatter(npc) {
    if (npc.__pcExploded) return;
    npc.__pcExploded = true;
    npc.performGraphic(new Graphic(650));
    for (const structure of this.structures.values()) {
      if (structure.damage >= structure.maxDamage
        || structure.object.getLocation().getDistance(npc.getLocation()) > 1) continue;
      structure.damage = Math.min(structure.maxDamage, structure.damage + 1);
      this.replaceStructure(structure);
    }
    for (const player of this.players.keys()) {
      if (player.getLocation().getDistance(npc.getLocation()) <= 1) {
        player.getCombat().getHitQueue().addPendingDamage([
          new HitDamage(5 + Math.floor(Math.random() * 20), HitMask.RED),
        ]);
      }
    }
    for (const other of this.npcs) {
      if (other === npc || other === this.knight || other === this.squire || other.getHitpoints() <= 0) continue;
      if (this.portalByNpc.get(other)?.shielded) continue;
      if (other.getLocation().getDistance(npc.getLocation()) <= 1) {
        other.getCombat().getHitQueue().addPendingDamage([
          new HitDamage(5 + Math.floor(Math.random() * 20), HitMask.RED),
        ]);
      }
    }
  }

  burstSpinners(portalKey) {
    for (const npc of [...this.npcs]) {
      if (npc.__pcType !== "spinner" || npc.__pcPortal !== portalKey || npc.getHitpoints() <= 0) continue;
      npc.performAnimation(new Animation(3911));
      for (const player of this.players.keys()) {
        if (player.getLocation().getDistance(npc.getLocation()) <= 3) {
          player.getCombat().getHitQueue().addPendingDamage([new HitDamage(5, HitMask.GREEN)]);
          player.setPoisonDamage(1);
        }
      }
      npc.setHitpoints(0);
    }
  }

  handleObject(player, object, clickType) {
    const id = object.getId();
    if (id === ObjectIdentifiers.LADDER_174) {
      const at = object.getLocation();
      const face = object.getFace();
      const px = player.getLocation().getX();
      const py = player.getLocation().getY();
      const down = (face === 1 && px < at.getX()) || (face === 3 && px > at.getX()) || (face === 0 && py < at.getY());
      player.climb(down, down
        ? new Location(face === 0 ? at.getX() : face === 1 ? at.getX() + 1 : at.getX() - 1, face === 0 ? at.getY() + 1 : at.getY(), 0)
        : new Location(face === 1 ? at.getX() - 1 : face === 3 ? at.getX() + 1 : at.getX(), face === 0 ? at.getY() - 1 : at.getY(), 0));
      return true;
    }

    const state = [...this.structures.values()].find((entry) => entry.object.getId() === id
      && entry.object.getLocation().equals(object.getLocation()));
    if (!state) return false;

    if (state.kind === "gate" && clickType === 1 && state.damage < state.maxDamage) {
      const open = !state.open;
      for (const part of this.structures.values()) {
        if (part.kind !== "gate" || part.group !== state.group) continue;
        part.open = open;
        this.replaceStructure(part);
      }
      return true;
    }
    if (clickType === 3 && state.damage > 0) {
      const inventory = player.getInventory();
      if (!inventory.contains(ItemIdentifiers.HAMMER)) {
        player.sendMessage("You need a hammer to repair this.");
        return true;
      }
      if (!inventory.contains(ItemIdentifiers.LOGS)) {
        player.sendMessage("You need some logs to repair this.");
        return true;
      }
      inventory.delete(ItemIdentifiers.LOGS, 1);
      state.damage--;
      this.replaceStructure(state);
      player.getSkillManager().addExperiences(Skill.CRAFTING, 5);
      const activity = this.players.get(player);
      if (activity) activity.activity = clampActivity(activity.activity + 10);
      return true;
    }
    return false;
  }

  updatePlayerOverlay(player, force = false) {
    const state = this.players.get(player);
    if (!state) return;
    const sender = player.getPacketSender();
    const send = (key, value, action) => {
      if (!force && state.sent.get(key) === value) return;
      state.sent.set(key, value);
      action();
    };
    send("time", formatTicks(GAME_TICKS - this.elapsedTicks), () => sender.sendString(`Time remaining: ${formatTicks(GAME_TICKS - this.elapsedTicks)}`, (GAME_OVERLAY << 16) | 5));
    send("knight", this.knight.getHitpoints(), () => sender.sendString(`Void Knight: ${this.knight.getHitpoints()}`, (GAME_OVERLAY << 16) | 6));
    send("damage", state.damage, () => sender.sendString(`Damage: ${state.damage}`, (GAME_OVERLAY << 16) | 7));
    send("activity", state.activity, () => sender.sendVarbit(ACTIVITY_VARBIT, state.activity));
    for (const portal of this.portals.values()) {
      const hp = Math.max(0, portal.npc.getHitpoints());
      send(`portal-hp-${portal.index}`, hp, () => sender.sendString(String(hp), (GAME_OVERLAY << 16) | (21 + portal.index)));
      send(`portal-dead-${portal.index}`, portal.dead, () => sender.sendInterfaceDisplayState((GAME_OVERLAY << 16) | (17 + portal.index), !portal.dead));
      send(`portal-shield-${portal.index}`, portal.shielded, () => sender.sendInterfaceDisplayState((GAME_OVERLAY << 16) | (26 + portal.index * 2), !portal.shielded));
    }
  }

  finish(won, reason) {
    if (this.ended) return;
    this.ended = true;
    this.resetStructures();
    const players = [...this.players.keys()];
    for (const player of players) {
      const state = this.players.get(player);
      if (won && state.activity >= MIN_REWARD_ACTIVITY) {
        setPoints(player, getPoints(player) + this.boat.points);
        const coins = player.getSkillManager().getCombatLevel() * 10;
        player.getInventory().adds(ItemIdentifiers.COINS, coins);
        player.sendMessage(
          `Congratulations! You receive ${this.boat.points} Void Knight commendation points and ${coins} coins.`
        );
      } else if (won) {
        player.sendMessage("The Void Knights noticed your lack of activity, so you receive no reward.");
      } else {
        player.sendMessage(reason);
      }
      restorePlayer(player);
      closeOverlay(player);
      player.setAttribute("pest-control:match", null);
      this.players.delete(player);
      releaseMatchPlayer(player, this.area);
    }
    this.cleanupStructures();
    this.area.destroy();
    this.cleanupNpcs();
    this.onFinished(this);
  }

  cleanupNpcs() {
    cleanupMatchNpcs(this.npcs, World);
  }
}

class PestControlWaitingArea extends Area {
  constructor(state) {
    super([state.boat.waitingBounds]);
    this.state = state;
  }

  getName() { return `${this.state.boat.name} Pest Control lander`; }
  allowSummonPet() { return false; }

  postEnter(mobile) {
    if (!mobile.isPlayer?.()) return;
    const player = mobile.getAsPlayer();
    if (!this.state.queue.includes(player)) this.state.queue.push(player);
    if (player.isPlayerBot?.() === true && !this.state.queue.some((queued) => queued.isPlayerBot?.() !== true)) {
      logoutBot(player);
      return;
    }
    player.getPacketSender().sendSubInterface(OVERLAY_HUD_UID, LANDER_OVERLAY, 1);
    player.sendMessage(`You have joined the ${this.state.boat.name.toLowerCase()} Pest Control lander.`);
    player.sendMessage(`You currently have ${getPoints(player)} commendation points.`);
    this.updateOverlay(player);
  }

  postLeave(mobile) {
    if (!mobile.isPlayer?.()) return;
    const player = mobile.getAsPlayer();
    const index = this.state.queue.indexOf(player);
    if (index !== -1) this.state.queue.splice(index, 1);
    closeOverlay(player);
    if (this.state.queue.length < MIN_PLAYERS) this.state.countdown = LANDER_WAIT_TICKS;
    if (player.isPlayerBot?.() !== true && !this.state.queue.some((queued) => queued.isPlayerBot?.() !== true)) {
      this.state.queue.filter((queued) => queued.isPlayerBot?.() === true).forEach(logoutBot);
    }
  }

  process(mobile) {
    if (!mobile.isPlayer?.()) return;
    this.state.processOnce();
    this.updateOverlay(mobile.getAsPlayer());
  }

  updateOverlay(player) {
    const count = this.state.queue.length;
    const sender = player.getPacketSender();
    sender.sendString(count >= MIN_PLAYERS ? `Next Departure: ${formatTicks(this.state.countdown)}` : "Next Departure: --", (LANDER_OVERLAY << 16) | 3);
    sender.sendString(`Players Ready: ${count}`, (LANDER_OVERLAY << 16) | 4);
    sender.sendString(`Points: ${getPoints(player)}`, (LANDER_OVERLAY << 16) | 5);
    sender.sendString(`Combat level ${this.state.boat.level}+`, (LANDER_OVERLAY << 16) | 20);
  }
}

class PestControlOutpostArea extends Area {
  constructor() { super([OUTPOST]); }
  getName() { return "Void Knights' Outpost"; }
}

function createPestControl(api) {
  api.registerShopCurrency(PEST_CONTROL_POINTS, {
    name: "Void Knight commendation points",
    amount: getPoints,
    add: (player, amount) => setPoints(player, getPoints(player) + amount),
    remove: (player, amount) => setPoints(player, getPoints(player) - amount),
  });
  api.registerDefinitionSource("shops", {
    name: "pest-control",
    load: () => [{
      id: VOID_KNIGHT_SHOP,
      name: "Void Knight commendation shop",
      currency: PEST_CONTROL_POINTS,
      originalStock: [
        [ItemIdentifiers.VOID_KNIGHT_MACE, 250],
        [ItemIdentifiers.VOID_KNIGHT_TOP, 250],
        [ItemIdentifiers.VOID_KNIGHT_ROBE, 250],
        [ItemIdentifiers.VOID_KNIGHT_GLOVES, 150],
        [ItemIdentifiers.VOID_MELEE_HELM, 200],
        [ItemIdentifiers.VOID_MAGE_HELM, 200],
        [ItemIdentifiers.VOID_RANGER_HELM, 200],
        [ItemIdentifiers.VOID_SEAL_8_, 10],
        [ItemIdentifiers.ELITE_VOID_TOP, 200],
        [ItemIdentifiers.ELITE_VOID_ROBE, 200],
      ].map(([id, price]) => ({ id, amount: 1000, price })),
    }],
  });
  const matches = new Set();
  const stateByBoat = new Map();
  let botSerial = 0;
  const boatByGangplank = new Map(BOATS.map((boat) => [boat.gangplankId, boat]));
  const boatByExit = new Map(BOATS.map((boat) => [boat.exitId, boat]));

  for (const boat of BOATS) {
    const state = {
      boat,
      queue: [],
      countdown: LANDER_WAIT_TICKS,
      lastCycle: -1,
      processOnce() {
        const cycle = World.getProcessCycle();
        if (cycle === this.lastCycle) return;
        this.lastCycle = cycle;
        adoptPendingBots(this, World.getPlayers());
        this.queue = this.queue.filter((player) => player?.isRegistered?.() !== false && player.getArea?.() === this.area);
        if (this.queue.length >= MAX_PLAYERS) return this.launch();
        if (this.queue.length < MIN_PLAYERS) return;
        if (--this.countdown <= 0) this.launch();
      },
      launch() {
        if (this.queue.length < MIN_PLAYERS) return;
        const players = this.queue.splice(0, MAX_PLAYERS);
        for (const player of players) player.setAttribute(ATTR_WAITING_BOAT, null);
        this.countdown = LANDER_WAIT_TICKS;
        const match = new PestControlMatch(boat, players, (finished) => matches.delete(finished));
        matches.add(match);
      },
    };
    state.area = new PestControlWaitingArea(state);
    stateByBoat.set(boat.key, state);
  }

  const outpostArea = new PestControlOutpostArea();
  AreaManager.areas.push(...[...stateByBoat.values()].map((state) => state.area), outpostArea);

  function spawnLanderBot(state) {
    const username = `PCBot${++botSerial}`;
    const bot = createBotPlayer(username, state.boat.waitingLocation, {
      api,
      loadPersistence: false,
      saveRandomizedAppearance: false,
    });
    if (!bot) return;
    bot.setPlayerBot(true);
    bot.setRunning(true);
    bot.setAttribute(ATTR_SKIP_PERSISTENCE, true);
    bot.setAttribute(ATTR_WAITING_BOAT, state.boat.key);
    applyGeneratedPvpLoadout(
      bot,
      { pvp: buildRoamingPvpMetadata({ excludeF2p: true }) },
      { api }
    );
    api.emitPlayerLogin({ player: bot, username });
  }

  function joinBoat(player, boat) {
    const combatLevel = player.getSkillManager().getCombatLevel();
    if (combatLevel < boat.level) {
      player.sendMessage(`You need a combat level of ${boat.level} to board this lander.`);
      return;
    }
    if (player.getAttribute?.(CURRENT_PET_ATTRIBUTE)) {
      player.sendMessage("You cannot bring a follower onto the lander.");
      return;
    }
    const state = stateByBoat.get(boat.key);
    moveBetweenAreas(player, state.area, boat.waitingLocation.clone());
    if (player.isPlayerBot?.() !== true) {
      const pendingBots = World.getAddPlayerQueue().filter((queued) =>
        queued.isPlayerBot?.() === true && boat.waitingBounds.inside(queued.getLocation())
      ).length;
      for (let count = botsNeeded(state.queue.length + pendingBots); count > 0; count--) spawnLanderBot(state);
    }
  }

  api.onPlayerLogin(({ player }) => {
    if (GAME_BOUNDS.inside(player.getLocation())) player.moveTo(OUTPOST_RETURN.clone());
  });

  api.onObjectInteraction((event) => {
    const boat = boatByGangplank.get(event.objectId);
    if (boat) {
      joinBoat(event.player, boat);
      event.handled = true;
      return;
    }
    const exitBoat = boatByExit.get(event.objectId);
    if (exitBoat && event.player.getArea?.() === stateByBoat.get(exitBoat.key).area) {
      event.player.moveTo(OUTPOST_RETURN.clone());
      event.handled = true;
      return;
    }
    const match = event.player.getAttribute?.("pest-control:match");
    if (match instanceof PestControlMatch && match.handleObject(event.player, event.object, event.clickType)) event.handled = true;
  });

  api.onNpcInteraction("Void Knight", { Exchange: exchangeRewards });
  api.onNpcInteraction("Squire", { "Talk-to": talkToMatchSquire, Leave: leaveMatch });

  api.onCanAttack((event) => {
    const player = event.attacker?.getAsPlayer?.();
    const match = player?.getAttribute?.("pest-control:match");
    if (!(match instanceof PestControlMatch)) return;
    const target = event.target?.getAsNpc?.();
    if (!target || target.getPrivateArea?.() !== match.area) return;
    if (target === match.knight || target === match.squire) {
      player.sendMessage("You cannot attack the Void Knights.");
      event.allow = false;
      return;
    }
    const portal = match.portalByNpc.get(target);
    if (portal?.shielded) {
      player.sendMessage("The portal is protected by a magical shield.");
      event.allow = false;
    }
  });

  api.onPlayerDealtDamage(({ player, target, hit }) => {
    const match = player.getAttribute?.("pest-control:match");
    if (match instanceof PestControlMatch) match.handleDamage(player, target, hit.getTotalDamage());
  });

  api.onNpcDeath(({ npc }) => {
    const area = npc.getPrivateArea?.();
    if (area instanceof PestControlMatchArea) area.match.handleNpcDeath(npc);
  });

  api.onPlayerDeath((event) => {
    const match = event.player.getAttribute?.("pest-control:match");
    if (!(match instanceof PestControlMatch)) return;
    restorePlayer(event.player);
    event.player.moveTo(GAME_START.clone());
    event.handled = true;
  });

  api.onShouldDropItemsOnDeath((event) => {
    if (event.player.getAttribute?.("pest-control:match") instanceof PestControlMatch) event.shouldDrop = false;
  });

  api.onCanTeleport((event) => {
    if (!(event.player.getAttribute?.("pest-control:match") instanceof PestControlMatch)) return;
    event.player.sendMessage("You cannot teleport out of Pest Control.");
    event.allow = false;
  });

  api.onSpellDisabled((event) => {
    if (!(event.player.getAttribute?.("pest-control:match") instanceof PestControlMatch)) return;
    if (event.spellId === 1162 || event.spellId === 1178) {
      event.player.sendMessage("You cannot use alchemy in Pest Control.");
      event.disabled = true;
    }
  });
}

function exchangeRewards({ player }) {
  if (!OUTPOST.inside(player.getLocation())) return false;
  ShopManager.open(player, VOID_KNIGHT_SHOP);
}

function talkToMatchSquire({ player, npc }) {
  const match = player.getAttribute?.("pest-control:match");
  if (!(match instanceof PestControlMatch) || npc !== match.squire) return false;
  player.sendMessage("Destroy the portals while keeping the Void Knight alive.");
}

function leaveMatch({ player, npc }) {
  const match = player.getAttribute?.("pest-control:match");
  if (!(match instanceof PestControlMatch) || npc !== match.squire) return false;
  player.sendMessage("You leave the island before the battle is over.");
  match.area.leave(player, false);
  player.moveTo(OUTPOST_RETURN.clone());
}

module.exports = {
  name: "PestControl",
  members: true,
  register(api) {
    AreaManager = api.getAreaManager();
    ObjectManager = api.getObjectManager();
    RegionManager = api.getRegionManager();
    World = api.getWorld();
    api.registerNpcCombatMethodProvider(DEFILER_IDS, DefilerCombatMethod);
    api.registerNpcCombatMethodProvider(TORCHER_IDS, TorcherCombatMethod);
    createPestControl(api);
  },
  _test: {
    BOATS,
    PEST_IDS,
    PORTAL_ORDERS,
    choosePortalOrder,
    clampActivity,
    botsNeeded,
    moveBetweenAreas,
    adoptPendingBots,
    chooseDefenceTarget,
    gateGroupKey,
    releaseMatchPlayer,
    cleanupMatchNpcs,
    resetStructures,
    constants: {
      LANDER_OVERLAY,
      GAME_OVERLAY,
      ACTIVITY_VARBIT,
      MIN_PLAYERS,
      MAX_PLAYERS,
    },
  },
};
