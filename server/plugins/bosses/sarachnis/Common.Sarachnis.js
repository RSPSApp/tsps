/**
 * What every Sarachnis unit shares: the lair's tiles, the captured ids, and small helpers.
 * Facts and their sources are in docs/sarachnis.md.
 */
const DATA = require("../data/sarachnis.json");

/** Cache: sarachnis (public, 400 hp). Minions share the same ids in every fight. */
const BOSS_ID = DATA.npcs.boss;
const MELEE_SPAWN_ID = DATA.npcs.meleeSpawn;
const MAGE_SPAWN_ID = DATA.npcs.mageSpawn;

/**
 * Cache: hosdun_sarachnis_entrance/exit, the sarachnis_web she leaves behind, the peekable
 * web on the path, and the dungeon webs on the way down.
 */
const WEB_ID = DATA.locs.web;
const ENTRANCE_ID = DATA.locs.entrance;
const EXIT_ID = DATA.locs.exit;
const PEEK_WEB_ID = DATA.locs.peekWeb;
const DUNGEON_WEB_ID = DATA.locs.dungeonWeb;

/** The burial tomb south of the Spider Den (NR polygon, extended one tile to the inside tile). */
const LAIR = Object.freeze({ ...DATA.lair });
/** World spawn, the ::teleports landing, and the tile outside the thick web. */
const SPAWN_TILE = Object.freeze([...DATA.spawnTile]);
const TELEPORT_TILE = Object.freeze([...DATA.teleportTile]);
const OUTSIDE_TILE = Object.freeze([...DATA.outsideTile]);
/** The peekable web and the slashable dungeon webs on the Forthos path, as captured. */
const PEEK_WEB_TILE = Object.freeze([...DATA.peekWebTile]);
const DUNGEON_WEB_TILES = Object.freeze(DATA.dungeonWebTiles.map((tile) => Object.freeze([...tile])));
/** Captured sprint nodes (boss base tiles, 1835/1844 x 9895/9904): she always moves to one of these. */
const CORNERS = Object.freeze(DATA.corners.map((tile) => Object.freeze([...tile])));

/** Cache sequences (hosdun_spider_boss_*): 8339 is the SotE gauntlet spider, not her. */
const ANIM = Object.freeze({ ...DATA.anims });
/** Captured heal gfx on her (reuses the sanguinesti heal asset), height 92. */
const HEAL_GFX = 1542;
/** Cache spotanims. */
const PROJECTILE_ID = Object.freeze({ ...DATA.projectiles });
/**
 * Captured projectile flights (map_projanim_v2, submission 3932): fixed start cycle 39 and
 * per-type heights/angle/progress, with the end cycle growing 10 a tile of travel
 * (ranged 66-186, web 51-116, minion bolt 56-126). The exact live ends vary a little
 * capture to capture, so the fit below is an estimate; the hit lands from the end.
 */
const PROJECTILE_SHAPE = Object.freeze({
  ranged: Object.freeze({ ...DATA.projectileShapes.ranged }),
  web: Object.freeze({ ...DATA.projectileShapes.web }),
  minionMage: Object.freeze({ ...DATA.projectileShapes.minionMage }),
});
/** Captured synth/area sounds (submission 3932; impact 281x are the engine's, not wired). */
const SOUND = Object.freeze({
  ranged: DATA.sounds.ranged,
  melee: Object.freeze([...DATA.sounds.melee]),
  web: DATA.sounds.web,
  deathArea1: DATA.sounds.deathArea1,
  deathArea2: DATA.sounds.deathArea2,
  deathSynth: Object.freeze([...DATA.sounds.deathSynth]),
  minionMageCast: DATA.sounds.minionMageCast,
  minionMageImpact: DATA.sounds.minionMageImpact,
  minionMageImpactDelay: DATA.sounds.minionMageImpactDelay,
});

/** Wiki: max 31 either way; 5 a melee heal, 10 a ranged heal, on a damaging hit. */
const MAX_HIT = DATA.combat.maxHit;
const HEAL = Object.freeze({ melee: DATA.combat.healMelee, ranged: DATA.combat.healRanged });
/** Captured heal hitsplat. */
const HEAL_SPLAT = Object.freeze({ mine: 6, others: 6 });
/** Wiki: every fourth attack is the web; the web binds 6 ticks (Aranea boots negate it). */
const WEB_EVERY = DATA.combat.webEveryAttacks;
const WEB_FREEZE_TICKS = DATA.combat.webFreezeTicks;
const WEB_MESSAGE = DATA.combat.webMessage;
const WEB_SAY = DATA.combat.webSay;
/** Captured: boots avoid the web with this spam message; the bind message is NR/Wiki. */
const BOOTS_MESSAGE = "Your Aranea boots let you avoid the spider-based attack.";
const LEECH_MESSAGE = "Sarachnis leeches some health as she damages you.";
/** Cache: aranea boots in all of their variants. */
const ARANEA_BOOT_IDS = [29806, 29807, 29808, 33202, 33203];
/** Wiki: the waves fire at 66% and 33%. */
const SPAWN_THRESHOLDS = Object.freeze([...DATA.combat.spawnThresholds]);
/** Captured attack speed and reach;captured removal and respawn. */
const ATTACK_SPEED = DATA.combat.attackSpeed;
const ATTACK_DISTANCE = DATA.combat.attackDistance;
const RESPAWN_TICKS = DATA.combat.respawnTicks;
const DEATH_TICKS = DATA.combat.deathTicks;

/** Wiki: a private instance costs 25k from the bank, 12.5k with the hard tier done. */
const INSTANCE_FEE = DATA.instance.fee;
const INSTANCE_DISCOUNTED_FEE = DATA.instance.discountedFee;
/** Cache varbit ca_tier_status_hard: 1 unlocked (done), 2 claimed. */
const HARD_TIER_VARBIT = DATA.instance.hardTierVarbit;

/** NPC attribute keys (kebab-case, namespaced) for the Combat Achievement rules. */
const ATTR_RANGED_TWICE = "sarachnis:ranged-twice";
const ATTR_DEALT_DAMAGE = "sarachnis:dealt-damage";
/** Player attribute: in a private instance, so a login there puts them outside. */
const INSTANCE_ATTRIBUTE = "sarachnis:in-instance";

let api = null;
let core = null;
let BonusManager = null;

function init(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
  BonusManager = pluginApi.getBonusManager?.() ?? null;
}

const location = ([x, y, z]) => new core.Location(x, y, z ?? 0);

function within(bounds, at) {
  if (!at || (at.getZ?.() ?? 0) !== 0) return false;
  const x = at.getX();
  const y = at.getY();
  return x >= bounds.minX && x <= bounds.maxX && y >= bounds.minY && y <= bounds.maxY;
}

const inLair = (at) => within(LAIR, at);

function isSarachnis(npc) {
  return npc?.getId?.() === BOSS_ID;
}

function isMinion(npc) {
  const id = npc?.getId?.();
  return id === MELEE_SPAWN_ID || id === MAGE_SPAWN_ID;
}

/** Players fighting in the same room as `npc`: in the lair and alive. */
function playersInRoom(npc) {
  const area = npc.getPrivateArea?.() ?? null;
  return npc.getPlayersWithinDistance(24).filter((player) =>
    player.getPrivateArea?.() === area && inLair(player.getLocation()) && player.getHitpoints() > 0);
}

/** The boots that negate the web, by equipment id. */
function wearsAraneaBoots(player) {
  const boots = player?.getEquipment?.()?.get?.(core.Equipment.FEET_SLOT);
  const id = boots?.getId?.() ?? -1;
  return ARANEA_BOOT_IDS.includes(id);
}

/** A slash weapon wielded, or any knife carried, for the webs. This is a plain reading
 * of the Wiki's "a slash weapon or a knife": a weapon swung in a slash style counts as
 * the former, and knives count from anywhere carried since that is how the slash tool is
 * normally to hand for webs. No capture shows the interaction (every log wears Aranea
 * boots), so both halves are deliberately permissive rather than exact. */
function hasSlashTool(player) {
  const slash = BonusManager?.ATTACK_SLASH ?? 1;
  const fightType = player?.getFightType?.();
  if (fightType?.getBonusType?.() === slash) return true;
  const equipment = player?.getEquipment?.()?.getItems?.() ?? [];
  for (const item of equipment) {
    if (item?.isValid?.() === false) continue;
    if (/knife$/i.test(String(item?.getDefinition?.()?.getName?.() ?? ""))) return true;
  }
  const inventory = player?.getInventory?.()?.getItems?.() ?? [];
  for (const item of inventory) {
    if (!item) continue;
    const name = String(core.CacheDefinitions.getItem(item.getId?.() ?? -1)?.name ?? "");
    if (/knife$/i.test(name)) return true;
  }
  return false;
}

/** Projectile end cycle for a shape at `distance` tiles of travel. */
function projectileEnd(shape, distance) {
  const end = shape.base + shape.perTile * Math.max(0, distance);
  return shape.cap === undefined ? end : Math.min(end, shape.cap);
}

/** Ticks until a projectile ending at `end` cycles lands (30 cycles a tick). */
function landingTicks(end) {
  return Math.max(1, Math.ceil(end / 30));
}

/** Chebyshev distance between two tiles. */
function tileDistance(a, b) {
  return Math.max(Math.abs(a.getX() - b.getX()), Math.abs(a.getY() - b.getY()));
}

/** Runs `action` after `ticks` game ticks. */
function later(ticks, action, key = null) {
  const task = new (class extends core.Task {
    constructor() {
      super(Math.max(1, ticks), key, false);
    }
    execute() {
      this.stop();
      action();
    }
  })();
  core.TaskManager.submit(task);
  return task;
}

module.exports = {
  DATA, BOSS_ID, MELEE_SPAWN_ID, MAGE_SPAWN_ID, WEB_ID, ENTRANCE_ID, EXIT_ID, PEEK_WEB_ID, DUNGEON_WEB_ID,
  LAIR, SPAWN_TILE, TELEPORT_TILE, OUTSIDE_TILE, PEEK_WEB_TILE, DUNGEON_WEB_TILES, CORNERS,
  ANIM, PROJECTILE_ID, PROJECTILE_SHAPE, SOUND,
  MAX_HIT, HEAL, HEAL_SPLAT, HEAL_GFX, WEB_EVERY, WEB_FREEZE_TICKS, WEB_MESSAGE, WEB_SAY,
  BOOTS_MESSAGE, LEECH_MESSAGE, ARANEA_BOOT_IDS, SPAWN_THRESHOLDS,
  ATTACK_SPEED, ATTACK_DISTANCE, RESPAWN_TICKS, DEATH_TICKS,
  INSTANCE_FEE, INSTANCE_DISCOUNTED_FEE, HARD_TIER_VARBIT,
  ATTR_RANGED_TWICE, ATTR_DEALT_DAMAGE, INSTANCE_ATTRIBUTE,
  init, location, within, inLair, isSarachnis, isMinion, playersInRoom,
  wearsAraneaBoots, hasSlashTool, projectileEnd, landingTicks, tileDistance, later,
  get api() { return api; },
  get core() { return core; },
};
