/**
 * The tephra loop (Wiki: Tephra, Refined_tephra, Imbued_tephra, Rock_Formation, Zalcano):
 * - mine tephra from the rock formations, far faster from the glowing one (35.2 Mining XP each,
 *   1 in 65 a few crystal shards);
 * - refine it at the furnace (10 Smithing XP) and imbue it at the altar (5 Runecraft XP), one a
 *   tick;
 * - throw imbued tephra at Zalcano or a golem (range 10, every 3 ticks; max hit
 *   5 + (Smithing + Runecraft) / 14, half as much again from a blue symbol). Nothing else hurts
 *   them;
 * - once she has fallen, mine her: up to 30-33 by Mining level, +1 a dragon pickaxe, +2 crystal,
 *   35.2 Mining XP a hit.
 * Each player has one action at a time, driven by the prison's tick and dropped when they move.
 * The messages, the throw and mining animations and the blue symbol's spotanim are recorded
 * (rsprox 4057, 1073-1075; zalcano.json `messages`).
 */
const Common = require("./Common.Zalcano");
const { actionInterval } = require("../../skills/SkillActions");

const actions = new Map();

function bestPickaxe(player) {
  const request = { player, pickaxe: null };
  Common.api.emitCustomEvent("mining:best-pickaxe", request);
  return request.pickaxe ?? null;
}

/**
 * Ticks to the next swing, as Mining rolls anywhere (Wiki, Pickaxe: dragon, infernal and crystal "3 ticks by default,
 * 1/6 [1/4] chance to be 2 ticks", members only), then content's pace (a league relic's).
 */
function swingTicks(player, pickaxe) {
  const request = { pickaxe, ticks: null };
  Common.api.emitCustomEvent("mining:roll-interval", request);
  return actionInterval(Common.api, player, Common.core.Skill.MINING, "mine", request.ticks ?? pickaxe.attemptIntervalTicks ?? 3);
}

function pickaxeLevel(pickaxe) {
  return Number(pickaxe?.requiredLevel) || 1;
}

function level(player, skill) {
  return player.getSkillManager().getCurrentLevel(Common.core.Skill[skill]);
}

function addXp(player, skill, xp) {
  player.getSkillManager().addExperiences(Common.core.Skill[skill], xp);
}

function begin(player, kind, extra = {}) {
  actions.set(player, { kind, from: player.getLocation(), next: 0, ...extra });
}

/** The recorded Zalcano mining animation for a pickaxe (human_mining_zalcano_<pickaxe>), else its usual one. */
function miningAnimation(pickaxe) {
  const { CacheDefinitions, Animation } = Common.core;
  const name = CacheDefinitions.getObjNames?.().get(pickaxe?.id);
  const seq = name ? CacheDefinitions.getSeqId(`human_mining_zalcano_${name}`) : null;
  if (seq !== null && seq !== undefined) return new Animation(seq);
  return pickaxe?.animation ?? new Animation(624);
}

function stop(player) {
  if (!actions.delete(player)) return;
  player.performAnimation?.(Common.core.Animation.DEFAULT_RESET_ANIMATION);
}

// --- Starting each action

function fightOf(prison) {
  return prison?.fight ?? null;
}

function mineRock(prison, { player, objectId }) {
  const { locs } = Common.ids;
  if (objectId !== locs.rockGlowing && objectId !== locs.rock) return false;
  if (!bestPickaxe(player)) {
    player.sendMessage(Common.message("noPickaxe"));
    return true;
  }
  begin(player, "rock");
  Common.spam(player, Common.message("swingRock"));
  return true;
}

function refine(prison, { player, objectId }) {
  if (objectId !== Common.ids.locs.furnace) return false;
  if (!player.getInventory().contains(Common.ids.items.tephra)) {
    player.sendMessage(Common.message("noTephra"));
    return true;
  }
  begin(player, "refine");
  return true;
}

function imbue(prison, { player, objectId }) {
  if (objectId !== Common.ids.locs.altar) return false;
  if (!player.getInventory().contains(Common.ids.items.refined)) {
    player.sendMessage(Common.message("noRefined"));
    return true;
  }
  begin(player, "imbue");
  return true;
}

function mineZalcano(prison, { player, npc }) {
  const fight = fightOf(prison);
  if (!fight || npc !== fight.npc || fight.phase !== "down") return false;
  if (!bestPickaxe(player)) {
    player.sendMessage(Common.message("noPickaxe"));
    return true;
  }
  begin(player, "zalcano");
  Common.spam(player, Common.message("swingZalcano"));
  return true;
}

// --- Each tick

/** The glowing rock under the player's hands, or an ordinary one. */
function rockBeside(prison, player) {
  const fight = fightOf(prison);
  if (!fight) return null;
  const rocks = Common.data.prison.rocks;
  for (let i = 0; i < rocks.length; i++) {
    const corner = Common.toLocation(rocks[i]);
    const centre = corner.transform(1, 1);
    if (Common.chebyshev(player.getLocation(), centre) <= 2) return { index: i, glowing: i === fight.glowing };
  }
  return null;
}

function tickActions(prison, players, random = Math.random) {
  const tick = prison.tickCount;
  for (const [player, action] of [...actions]) {
    const moved = player.getLocation().getX() !== action.from.getX() || player.getLocation().getY() !== action.from.getY();
    if (!players.includes(player) || moved || player.getCombat?.().getTarget?.()) {
      actions.delete(player);
      continue;
    }
    if (tick < action.next) continue;
    if (action.kind === "rock") tickRock(prison, player, action, random);
    else if (action.kind === "refine") tickConvert(player, action, "tephra", "refined", "SMITHING", Common.data.tephra.refineXp, Common.ids.seqs.refine, "refined");
    else if (action.kind === "imbue") tickConvert(player, action, "refined", "imbued", "RUNECRAFTING", Common.data.tephra.imbueXp, Common.ids.seqs.imbue, "imbued");
    else if (action.kind === "zalcano") tickMineZalcano(prison, player, action);
  }
}

function tickRock(prison, player, action, random) {
  const { tephra } = Common.data;
  const pickaxe = bestPickaxe(player);
  const rock = rockBeside(prison, player);
  if (!pickaxe || !rock || fightOf(prison)?.phase === "dead") { stop(player); return; }
  const inventory = player.getInventory();
  if (inventory.getFreeSlots() <= 0) {
    stop(player);
    Common.box(player, Common.message("full"));
    return;
  }
  player.performAnimation(miningAnimation(pickaxe));
  action.next = prison.tickCount + swingTicks(player, pickaxe);
  if (random() >= (rock.glowing ? tephra.glowingChance : tephra.rockChance)) return;
  let ore = rock.glowing && random() < tephra.glowingExtra ? 2 : 1;
  while (ore-- > 0 && inventory.getFreeSlots() > 0) {
    inventory.adds(Common.ids.items.tephra, 1);
    addXp(player, "MINING", tephra.miningXp);
  }
  // Tephra is level 1 in the Wiki's Mining enhancers table. Ask once per
  // successful action: charged celestial jewellery spends a charge even if its
  // bonus fails or the base yield filled the last slot.
  const extra = { player, oreId: Common.ids.items.tephra, rockLevel: 1, bonuses: [] };
  Common.api.emitCustomEvent("mining:extra-ore", extra);
  for (const bonus of extra.bonuses) {
    if (inventory.getFreeSlots() <= 0) break;
    const before = inventory.getAmount(Common.ids.items.tephra);
    inventory.adds(Common.ids.items.tephra, 1);
    if (inventory.getAmount(Common.ids.items.tephra) <= before) break;
    addXp(player, "MINING", tephra.miningXp);
    if (bonus.message) Common.spam(player, bonus.message);
  }
  Common.spam(player, Common.message("mined"));
  // Recorded: the full-pack box comes the tick after the ore that filled it.
  if (inventory.getFreeSlots() <= 0) action.next = prison.tickCount + 1;
  if (random() < 1 / tephra.shardChance) {
    inventory.adds(Common.ids.items.crystalShard, Common.randomInt(1, 3));
    player.sendMessage(Common.message("shard"));
  }
}

function tickConvert(player, action, fromKey, toKey, skill, xp, seq, messageKey) {
  const { items } = Common.ids;
  const inventory = player.getInventory();
  if (!inventory.contains(items[fromKey])) { stop(player); return; }
  inventory.deleteNumber(items[fromKey], 1);
  inventory.adds(items[toKey], 1);
  addXp(player, skill, xp);
  player.performAnimation(new Common.core.Animation(seq));
  Common.spam(player, Common.message(messageKey));
  action.next = 0;
}

/** Max hit mining her: by Mining level, plus a pickaxe above level 40. */
function miningMaxHit(miningLevel, pickaxe) {
  const row = Common.data.mining.maxHit.find(([min]) => miningLevel >= min);
  const bonus = Math.max(Math.floor((pickaxeLevel(pickaxe) - 40) / 15), 0);
  return (row ? row[1] : 30) + bonus;
}

function tickMineZalcano(prison, player, action) {
  const fight = fightOf(prison);
  const pickaxe = bestPickaxe(player);
  if (!fight || fight.phase !== "down" || fight.finished() || !pickaxe) { stop(player); return; }
  player.performAnimation(miningAnimation(pickaxe));
  action.next = prison.tickCount + swingTicks(player, pickaxe);
  // Recorded: the first swing only swings; each later one chips, her hit landing a tick after.
  if (!action.swung) {
    action.swung = true;
    return;
  }
  Common.spam(player, Common.message("chipped"));
  const damage = Common.randomInt(1, miningMaxHit(level(player, "MINING"), pickaxe));
  const { PendingHit, CombatFactory } = Common.core;
  CombatFactory.addPendingHit(new PendingHit(player, fight.npc, miningMethod(), { delay: 1, damage, experience: false, rollAccuracy: false }));
  addXp(player, "MINING", Common.data.mining.xp);
}

// --- Throwing

/** Imbued tephra carried, or wielded. */
function imbuedCount(player) {
  const { Equipment } = Common.core;
  const id = Common.ids.items.imbued;
  const weapon = player.getEquipment?.()?.get?.(Equipment.WEAPON_SLOT);
  return player.getInventory().getAmount(id) + (weapon?.getId?.() === id ? weapon.getAmount() : 0);
}

/** All of it, carried or wielded: tephra can't leave the prison. */
function removeTephra(player) {
  const { items } = Common.ids;
  let removed = [items.tephra, items.refined, items.imbued].reduce((sum, id) => sum + Common.removeAll(player, id), 0);
  const { Equipment, Item } = Common.core;
  const equipment = player.getEquipment?.();
  const weapon = equipment?.get?.(Equipment.WEAPON_SLOT);
  if (weapon?.getId?.() === items.imbued) {
    removed += weapon.getAmount();
    equipment.set(Equipment.WEAPON_SLOT, new Item(-1));
    equipment.refreshItems?.();
  }
  return removed;
}

function spendImbued(player) {
  const { Equipment, Item } = Common.core;
  const id = Common.ids.items.imbued;
  if (player.getInventory().getAmount(id) > 0) {
    player.getInventory().deleteNumber(id, 1);
    return true;
  }
  const equipment = player.getEquipment();
  const weapon = equipment.get(Equipment.WEAPON_SLOT);
  if (weapon?.getId?.() !== id) return false;
  weapon.decrementAmountBy(1);
  if (weapon.getAmount() <= 0) equipment.set(Equipment.WEAPON_SLOT, new Item(-1));
  equipment.refreshItems?.();
  return true;
}

/** 5 + (Smithing + Runecraft) / 14 (Mod Ash on the Wiki), half as much again on a blue symbol. */
function throwMaxHit(smithing, runecraft, empowered) {
  const max = Math.floor(5 + (smithing + runecraft) / 14);
  return empowered ? Math.floor(max * Common.data.tephra.blueMultiplier) : max;
}

let methods = null;

function defineMethods() {
  const { CombatMethod, CombatType, PendingHit, Projectile } = Common.core;
  const { tephra } = Common.data;

  class TephraThrow extends CombatMethod {
    canAttack(character) {
      return imbuedCount(character.getAsPlayer()) > 0;
    }

    start(character, target) {
      const player = character.getAsPlayer();
      this.empowered = player.__zalPrison?.fight?.empowered(player) === true;
      spendImbued(player);
      player.performAnimation(new Common.core.Animation(Common.ids.seqs.throw));
      if (imbuedCount(player) === 0) player.sendMessage(Common.message("lastOne"));
      const distance = Common.distanceToNpc(player.getLocation(), target);
      this.delay = 1 + Math.floor((3 + distance) / 6);
      new Projectile(player.getLocation(), target.getLocation().transform(1, 1), target, Common.ids.spotanims.oreThrow, 30, this.delay * 30, 40, 31, null).sendProjectile();
    }

    hits(character, target) {
      const player = character.getAsPlayer();
      const max = throwMaxHit(level(player, "SMITHING"), level(player, "RUNECRAFTING"), this.empowered);
      return [new PendingHit(character, target, this, { delay: this.delay ?? 1, damage: Common.randomInt(0, max), experience: false, rollAccuracy: false })];
    }

    attackSpeed() {
      return tephra.throwSpeed;
    }

    attackDistance() {
      return tephra.throwRange;
    }

    type() {
      return CombatType.RANGED;
    }
  }

  /** Without imbued tephra (or once she has fallen) an attack does nothing: a message and no fight. */
  class Refused extends CombatMethod {
    constructor(key) {
      super();
      this.key = key;
    }

    canAttack(character) {
      character.getAsPlayer().sendMessage(Common.message(this.key));
      character.getCombat().reset();
      return false;
    }

    attackDistance() {
      return tephra.throwRange;
    }

    hits() {
      return [];
    }

    type() {
      return CombatType.RANGED;
    }
  }

  /** Her mining hits (Tephra's own, not a combat style). */
  class Mining extends CombatMethod {
    hits() {
      return [];
    }

    type() {
      return CombatType.MELEE;
    }
  }

  return { throwing: new TephraThrow(), none: new Refused("noImbued"), fallen: new Refused("mineHer"), mining: new Mining() };
}

function miningMethod() {
  methods ??= defineMethods();
  return methods.mining;
}

function isThrow(method) {
  methods ??= defineMethods();
  return method === methods.throwing;
}

function isMining(method) {
  return method === miningMethod();
}

/** registerCombatMethodResolver: a player attacking armoured Zalcano or a golem throws tephra. */
function resolveMethod(attacker) {
  if (!attacker?.isPlayer?.()) return null;
  const target = attacker.getCombat?.().getTarget?.();
  const npc = target?.isNpc?.() ? target.getAsNpc() : null;
  const { npcs } = Common.ids;
  if (!npc || ![npcs.armoured, npcs.weakened, npcs.golem].includes(npc.getId())) return null;
  methods ??= defineMethods();
  if (npc.getId() === npcs.weakened) return methods.fallen;
  return imbuedCount(attacker.getAsPlayer()) > 0 ? methods.throwing : methods.none;
}

module.exports = {
  actions, begin, stop, mineRock, refine, imbue, mineZalcano, tickActions, rockBeside,
  miningMaxHit, throwMaxHit, imbuedCount, spendImbued, removeTephra, resolveMethod, isThrow, isMining, miningMethod,
};
