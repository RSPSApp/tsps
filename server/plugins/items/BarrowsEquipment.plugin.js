const { PrayerHandler } = require("../../src/main/typescript/elvarg/game/content/PrayerHandler");
const { Barrows } = require("../../src/main/typescript/elvarg/game/content/combat/Barrows");
const { Equipment } = require("../../src/main/typescript/elvarg/game/model/container/impl/Equipment");
const { Flag } = require("../../src/main/typescript/elvarg/game/model/Flag");
const { Skill } = require("../../src/main/typescript/elvarg/game/model/Skill");
const { Task } = require("../../src/main/typescript/elvarg/game/task/Task");
const { Item } = require("../../src/main/typescript/elvarg/game/model/Item");
const { CombatType } = require("../../src/main/typescript/elvarg/game/content/combat/CombatType");
const { PendingHit } = require("../../src/main/typescript/elvarg/game/content/combat/hit/PendingHit");
const { HitDamage } = require("../../src/main/typescript/elvarg/game/content/combat/hit/HitDamage");
const { HitMask } = require("../../src/main/typescript/elvarg/game/content/combat/hit/HitMask");
const { Graphic } = require("../../src/main/typescript/elvarg/game/model/Graphic");
const { WeaponInterfaceManager } = require("../../src/main/typescript/elvarg/game/content/combat/WeaponInterfaceManager");

const META_KEY = "barrows";
const MAX_DURABILITY = 1000;
const TICKS_PER_DEGRADE = 90;
const REPAIR_COSTS = [60, 100, 90, 80]; // helm, weapon, body, legs
const BARROWS_WEAPONS = new Set([4710, 4718, 4726, 4734, 4747, 4755]);

function durability(item) {
  const id = item?.getId?.();
  const base = Barrows.baseItemId(id);
  if (base == null) return null;
  const saved = Number(item.getMetaValue?.(META_KEY)?.remaining);
  if (Number.isInteger(saved)) return Math.max(0, Math.min(MAX_DURABILITY, saved));
  if (Barrows.isBroken(id)) return 0;
  if (id >= 4856 && id < 5000) return [MAX_DURABILITY, 750, 500, 250][(id - 4856) % 6] ?? 0;
  return MAX_DURABILITY;
}

function setDurability(item, remaining) {
  const base = Barrows.baseItemId(item?.getId?.());
  if (base == null) return false;
  const value = Math.max(0, Math.min(MAX_DURABILITY, Math.floor(remaining)));
  const stage = value > 750 ? 0 : value > 500 ? 1 : value > 250 ? 2 : value > 0 ? 3 : 4;
  item.setId(Barrows.stageItemId(base, stage));
  item.setMetaValue(META_KEY, { remaining: value });
  return true;
}

function barrowsItems(player) {
  return [...player.getEquipment().getItems(), ...player.getInventory().getItems()]
    .filter((item) => Barrows.isBarrowsItem(item?.getId?.()));
}

function repairCost(item) {
  const base = Barrows.baseItemId(item?.getId?.());
  if (base == null) return 0;
  const index = [4708, 4710, 4712, 4714, 4716, 4718, 4720, 4722, 4724, 4726, 4728, 4730, 4732, 4734, 4736, 4738, 4745, 4747, 4749, 4751, 4753, 4755, 4757, 4759].indexOf(base);
  return index === -1 ? 0 : (MAX_DURABILITY - durability(item)) * REPAIR_COSTS[index % 4];
}

function refresh(player, weaponChanged = false) {
  player.getInventory().refreshItems();
  player.getEquipment().refreshItems();
  player.getUpdateFlag()?.flag?.(Flag.APPEARANCE);
  BonusManager.update(player);
  if (weaponChanged) WeaponInterfaceManager.assign(player);
}

function degradeEquipment(player) {
  let changed = false;
  let weaponChanged = false;
  for (const item of player.getEquipment().getItems()) {
    if (!Barrows.isBarrowsItem(item?.getId?.())) continue;
    weaponChanged ||= BARROWS_WEAPONS.has(Barrows.baseItemId(item.getId()));
    changed ||= setDurability(item, durability(item) - 1);
  }

  const amulet = player.getEquipment().get(Equipment.AMULET_SLOT);
  if (amulet?.getId?.() === Barrows.AMULET_OF_THE_DAMNED_FULL || amulet?.getId?.() === Barrows.AMULET_OF_THE_DAMNED) {
    const remaining = Math.max(0, Math.min(MAX_DURABILITY, Math.floor(Number(amulet.getMetaValue?.(META_KEY)?.remaining) || MAX_DURABILITY))) - 1;
    if (remaining <= 0) {
      player.getEquipment().set(Equipment.AMULET_SLOT, new Item(-1));
      player.sendMessage("Your amulet of the damned crumbles to dust.");
    } else {
      amulet.setId(Barrows.AMULET_OF_THE_DAMNED);
      amulet.setMetaValue(META_KEY, { remaining });
    }
    changed = true;
  }
  if (changed) refresh(player, weaponChanged);
  return changed;
}

function startDegradation(player, TaskManager, CombatFactory, tasks) {
  if (tasks.has(player)) return;
  let inCombat = false;
  let ticks = 0;
  const task = new (class extends Task {
    constructor() { super(1, player); }
    execute() {
      if (player.isRegistered?.() === false) {
        tasks.delete(player);
        this.stop();
        return;
      }
      if (!CombatFactory.inCombat(player)) {
        inCombat = false;
        ticks = 0;
        return;
      }
      if (!inCombat) {
        inCombat = true;
        ticks = TICKS_PER_DEGRADE;
        degradeEquipment(player);
        return;
      }
      if (--ticks <= 0) {
        ticks = TICKS_PER_DEGRADE;
        degradeEquipment(player);
      }
    }
  })();
  tasks.set(player, task);
  TaskManager.submit(task);
}

function repairAll(player) {
  const items = barrowsItems(player);
  const cost = items.reduce((total, item) => total + repairCost(item), 0);
  if (cost <= 0) {
    player.sendMessage("You have no damaged Barrows equipment to repair.");
    return;
  }
  if (player.getInventory().getAmount(995) < cost) {
    player.sendMessage(`You need ${cost.toLocaleString("en-US")} coins to repair your Barrows equipment.`);
    return;
  }
  player.getInventory().deleteNumber(995, cost);
  let weaponChanged = false;
  for (const item of items) {
    const base = Barrows.baseItemId(item.getId());
    weaponChanged ||= BARROWS_WEAPONS.has(base);
    item.setId(base).setMetaValue(META_KEY, undefined);
  }
  refresh(player, weaponChanged);
  player.sendMessage(`Your Barrows equipment has been repaired for ${cost.toLocaleString("en-US")} coins.`);
}

function toragDefence(entity, effectiveDefence) {
  if (!entity?.isPlayer?.() || !Barrows.hasDamnedSet(entity.getAsPlayer(), "torags")) return effectiveDefence;
  const skills = entity.getAsPlayer().getSkillManager();
  const missingHitpoints = Math.max(0, skills.getMaxLevel(Skill.HITPOINTS) - skills.getCurrentLevel(Skill.HITPOINTS));
  return Math.floor(effectiveDefence * (100 + missingHitpoints) / 100);
}

function chance(probability = 0.25) {
  return Math.random() < probability;
}

function applyAhrimDamage(hit, target) {
  let remaining = target.getHitpoints();
  for (const damage of hit.getHits()) {
    damage.setDamage(Math.min(remaining, Math.floor(damage.getDamage() * 1.3)));
    remaining -= damage.getDamage();
  }
  hit.updateTotalDamage();
}

let BonusManager;

let pluginApi;

function repairEquipment(event) {
  const { player } = event;
  const cost = barrowsItems(player).reduce((total, item) => total + repairCost(item), 0);
  if (cost <= 0) {
    player.sendMessage("You have no damaged Barrows equipment to repair.");
    event.handled = true;
    return true;
  }
  pluginApi.sendMultiChatboxPrompt(player, `Repair all Barrows equipment for ${cost.toLocaleString("en-US")} coins?`, "Repair", () => repairAll(player), "Cancel", () => {});
  event.handled = true;
  return true;
}

module.exports = {
  name: "BarrowsEquipment",
  members: true,
  register(api) {
    pluginApi = api;
    BonusManager = api.getBonusManager();
    const tasks = new WeakMap();
    const TaskManager = api.getTaskManager();
    const CombatFactory = api.getCombatFactory();

    api.registerBonusProvider({
      apply({ player, bonuses }) {
        if (Barrows.hasDamnedSet(player, "veracs")) bonuses[13] += 7;
      },
    });
    api.registerMeleeDefenseModifier(toragDefence);
    api.registerRangedDefenseModifier(toragDefence);
    api.registerMagicDefenseModifier(toragDefence);

    api.registerMeleeHitModifier((attacker, maxHit) => {
      if (!attacker.isNpc() || !CombatFactory.fullVeracs(attacker)) return maxHit;
      const target = attacker.getCombat().getTarget();
      return target && PrayerHandler.isActivated(target, PrayerHandler.PROTECT_FROM_MELEE)
        ? Math.floor(maxHit * 2 / 3) : maxHit;
    });
    api.onCombatHitRoll((event) => {
      if (event.combatType === CombatType.MELEE && CombatFactory.fullVeracs(event.attacker) && chance()) {
        event.forceAccurate = true;
        event.bypassProtectionPrayer = true;
      }
    });
    api.onPlayerDealtDamage(({ player, target, hit }) => {
      if (!hit.getHandleAfterHitEffects() || !hit.isAccurate()) return;
      if (hit.getCombatType() === CombatType.MAGIC && Barrows.hasDamnedSet(player, "ahrims") && chance()) {
        applyAhrimDamage(hit, target);
      }
      if (hit.getCombatType() === CombatType.RANGED && Barrows.hasDamnedSet(player, "karils") && chance()) {
        const secondHit = new PendingHit(player, target, hit.getCombatMethod(), {
          delay: hit.getDelay() + 1,
          handleAfterHitEffects: false,
          rollAccuracy: false,
        });
        secondHit.setTotalDamage(Math.floor(hit.getTotalDamage() / 2));
        api.getCombatFactory().addPendingHit(secondHit);
      }
    });
    api.onCombatHitResolved(({ attacker, target, hit }) => {
      if (!hit.getHandleAfterHitEffects() || !hit.isAccurate()) return;
      const damage = hit.getTotalDamage();
      if (target.isPlayer?.() && damage > 0 && Barrows.hasDamnedSet(target.getAsPlayer(), "dharoks") && chance()) {
        attacker.getCombat().getHitQueue().addPendingDamage([new HitDamage(Math.floor(damage * 0.15), HitMask.RED).setSource(target)]);
      }
      if (!chance(attacker.isNpc() && CombatFactory.fullAhrims(attacker) ? 0.2 : 0.25)) return;
      const player = attacker.isPlayer() ? attacker.getAsPlayer() : null;
      if (CombatFactory.fullGuthans(attacker) && damage > 0) {
        target.performGraphic(new Graphic(398));
        const maximum = player
          ? player.getSkillManager().getMaxLevel(Skill.HITPOINTS) + (Barrows.hasDamnedSet(player, "guthans") ? 10 : 0)
          : attacker.getAsNpc().getDefinition().getHitpoints();
        attacker.setHitpoints(Math.min(maximum, attacker.getHitpoints() + damage));
      } else if (target.isPlayer?.() && hit.getCombatType() === CombatType.MAGIC && CombatFactory.fullAhrims(attacker)) {
        const skills = target.getAsPlayer().getSkillManager();
        skills.setCurrentLevels(Skill.STRENGTH, Math.max(0, skills.getCurrentLevel(Skill.STRENGTH) - 5));
      } else if (target.isPlayer?.() && hit.getCombatType() === CombatType.RANGED && CombatFactory.fullKarils(attacker)) {
        const skills = target.getAsPlayer().getSkillManager();
        skills.setCurrentLevels(Skill.AGILITY, Math.floor(skills.getCurrentLevel(Skill.AGILITY) * 0.8));
      } else if (target.isPlayer?.() && hit.getCombatType() === CombatType.MELEE && CombatFactory.fullTorags(attacker)) {
        const playerTarget = target.getAsPlayer();
        playerTarget.setRunEnergy(Math.floor(playerTarget.getRunEnergy() * 0.8));
      }
    });

    api.onPlayerLogin(({ player }) => startDegradation(player, TaskManager, CombatFactory, tasks));
    api.onPlayerLogout(({ player }) => tasks.delete(player));
    api.onCanEquip((event) => {
      if (Barrows.isBroken(event.item?.getId?.())) {
        event.allow = false;
        event.player.sendMessage("This Barrows item is broken and must be repaired before you can wear it.");
      }
    });
    api.onItemDropPolicy((event) => {
      if (Barrows.isBarrowsItem(event.item?.getId?.())) setDurability(event.item, 0);
      if (event.item?.getId?.() === Barrows.AMULET_OF_THE_DAMNED_FULL || event.item?.getId?.() === Barrows.AMULET_OF_THE_DAMNED) {
        event.item.setId(-1);
        event.handled = true;
      }
    });
    api.onPlayerDeathItemDrop((event) => {
      if (Barrows.isBarrowsItem(event.item?.getId?.())) setDurability(event.item, 0);
      if (event.item?.getId?.() === Barrows.AMULET_OF_THE_DAMNED_FULL || event.item?.getId?.() === Barrows.AMULET_OF_THE_DAMNED) {
        event.item.setId(-1);
        event.handled = true;
      }
    });
    api.onNpcInteraction("Bob", { Repair: repairEquipment });
    api.onNpcInteraction("Aneirin", { Repair: repairEquipment });
    api.onNpcInteraction("Dunstan", { "Talk-to": repairEquipment });
    api.onNpcInteraction("Tindel Marchant", { "Talk-to": repairEquipment });
  },
};
