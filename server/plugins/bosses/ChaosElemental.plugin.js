const { CombatMethod } = require("../../src/main/typescript/elvarg/game/content/combat/method/CombatMethod");
const { Animation } = require("../../src/main/typescript/elvarg/game/model/Animation");
const { Graphic } = require("../../src/main/typescript/elvarg/game/model/Graphic");
const { CombatType } = require("../../src/main/typescript/elvarg/game/content/combat/CombatType");
const { PendingHit } = require("../../src/main/typescript/elvarg/game/content/combat/hit/PendingHit");
const { Projectile } = require("../../src/main/typescript/elvarg/game/model/Projectile");
const { Misc } = require("../../src/main/typescript/elvarg/util/Misc");
const { Item } = require("../../src/main/typescript/elvarg/game/model/Item");
const { Equipment } = require("../../src/main/typescript/elvarg/game/model/container/impl/Equipment");
const { WeaponInterfaceManager } = require("../../src/main/typescript/elvarg/game/content/combat/WeaponInterfaceManager");
const { Flag } = require("../../src/main/typescript/elvarg/game/model/Flag");
const { Task } = require("../../src/main/typescript/elvarg/game/task/Task");
const { NpcIdentifiers } = require("../../src/main/typescript/elvarg/util/NpcIdentifiers");

const ChaosElementalAttackType = {
  DISCORD: 558,
  DISARM: 551,
  TELEPORT: 554,
};

const REGULAR_COMBAT_TYPES = [CombatType.MELEE, CombatType.RANGED, CombatType.MAGIC];
const SPECIAL_HIT_DELAY = 2;

class ChaosElementalTask extends Task {
  constructor(delay, execFunc, key, immediate) {
    super(delay, key, immediate);
    this.execFunc = execFunc;
  }

  execute() {
    this.execFunc();
    this.stop();
  }
}

class ChaosElementalCombatMethod extends CombatMethod {
  static MELEE_COMBAT_GFX = new Graphic(869, 0);
  static RANGED_COMBAT_GFX = new Graphic(867, 0);
  static MAGIC_COMBAT_GFX = new Graphic(868, 0);

  constructor() {
    super();
    this.currentAttack = ChaosElementalAttackType.DISCORD;
    this.currentCombatType = CombatType.MAGIC;
  }

  type() {
    return this.currentCombatType;
  }

  hits(character, target) {
    if (this.currentAttack !== ChaosElementalAttackType.DISCORD) {
      return [];
    }
    return [new PendingHit(character, target, this, 2)];
  }

  start(character, target) {
    this.selectAttack();
    character.performAnimation(new Animation(character.getAttackAnim()));
    Projectile.createProjectile(character, target, this.currentAttack, 40, 70, 31, 43).sendProjectile();

    if (this.currentAttack !== ChaosElementalAttackType.DISCORD) {
      const queuedAttack = this.currentAttack;
      TaskManager.submit(
        new ChaosElementalTask(
          SPECIAL_HIT_DELAY,
          () => applyChaosElementalSpecial(queuedAttack, character, target),
          target,
          false
        )
      );
    }
  }

  attackDistance() {
    return 8;
  }

  finished() {
  }

  selectAttack() {
    // OSRS strategy notes Confusion is less frequent than Madness, so weight teleport lower.
    const specialRoll = Misc.getRandom(19);
    if (specialRoll === 0) {
      this.currentAttack = ChaosElementalAttackType.TELEPORT;
      this.currentCombatType = CombatType.MAGIC;
      return;
    }
    if (specialRoll <= 3) {
      this.currentAttack = ChaosElementalAttackType.DISARM;
      this.currentCombatType = CombatType.MAGIC;
      return;
    }

    this.currentAttack = ChaosElementalAttackType.DISCORD;
    this.currentCombatType = REGULAR_COMBAT_TYPES[Misc.getRandom(REGULAR_COMBAT_TYPES.length - 1)];
  }

  handleAfterHitEffects(hit) {
    if (!hit || !hit.getTarget()) {
      return;
    }
    const target = hit.getTarget();
    switch (this.currentCombatType) {
      case CombatType.MELEE:
        target.performGraphic(ChaosElementalCombatMethod.MELEE_COMBAT_GFX);
        break;
      case CombatType.RANGED:
        target.performGraphic(ChaosElementalCombatMethod.RANGED_COMBAT_GFX);
        break;
      case CombatType.MAGIC:
        target.performGraphic(ChaosElementalCombatMethod.MAGIC_COMBAT_GFX);
        break;
      default:
        break;
    }

  }
}

function applyChaosElementalSpecial(attackType, character, target) {
  if (!target?.isPlayer?.()) {
    return;
  }

  const player = target.getAsPlayer();
  if (attackType === ChaosElementalAttackType.DISARM) {
    disarmChaosElemental(player);
    return;
  }

  if (attackType === ChaosElementalAttackType.TELEPORT) {
    const destination = findChaosTeleportDestination(character, player);
    if (!destination) {
      return;
    }
    player.moveTo(destination);
    player.sendMessage("The Chaos elemental has teleported you.");
  }
}

function disarmChaosElemental(player) {
  const inventory = player.getInventory();
  const equipment = player.getEquipment();
  const candidateSlots = getChaosDisarmSlots(player);

  let removedItems = 0;
  for (const slot of candidateSlots) {
    if (removedItems >= 4) {
      break;
    }

    const equippedItem = equipment.getItems()[slot];
    if (!equippedItem?.isValid?.() || !canInventoryReceive(inventory, equippedItem)) {
      continue;
    }

    equipment.set(slot, new Item(-1, 0));
    inventory.add(equippedItem.clone(), false);
    removedItems++;
  }

  if (removedItems <= 0) {
    return;
  }

  equipment.refreshItems();
  inventory.refreshItems();
  WeaponInterfaceManager.assign(player);
  BonusManager.update(player);
  player.getUpdateFlag().flag(Flag.APPEARANCE);
  player.sendMessage("The Chaos elemental disarms you.");
}

function getChaosDisarmSlots(player) {
  const equipmentItems = player.getEquipment().getItems();
  const orderedSlots = [];
  const randomSlots = [];

  if (equipmentItems[Equipment.WEAPON_SLOT]?.isValid?.()) {
    orderedSlots.push(Equipment.WEAPON_SLOT);
  }

  for (let slot = 0; slot < player.getEquipment().capacity(); slot++) {
    if (slot === Equipment.WEAPON_SLOT) {
      continue;
    }
    if (equipmentItems[slot]?.isValid?.()) {
      randomSlots.push(slot);
    }
  }

  shuffleInPlace(randomSlots);
  return orderedSlots.concat(randomSlots);
}

function canInventoryReceive(inventory, item) {
  return inventory.getFreeSlots() > 0 || (item.getDefinition().isStackable() && inventory.contains(item.getId()));
}

function findChaosTeleportDestination(character, player) {
  const current = player.getLocation();
  const npcLocation = character?.getLocation?.();
  const privateArea = player.getPrivateArea?.();
  const currentDistance = npcLocation ? current.getDistance(npcLocation) : -1;
  const preferred = [];
  const fallback = [];

  for (let offsetX = -4; offsetX <= 4; offsetX++) {
    for (let offsetY = -4; offsetY <= 4; offsetY++) {
      if (offsetX === 0 && offsetY === 0) {
        continue;
      }

      const candidate = current.transform(offsetX, offsetY);
      if (RegionManager.blocked(candidate, privateArea)) {
        continue;
      }
      if (npcLocation && candidate.equals(npcLocation)) {
        continue;
      }

      if (npcLocation && candidate.getDistance(npcLocation) > currentDistance) {
        preferred.push(candidate);
      } else {
        fallback.push(candidate);
      }
    }
  }

  const choices = preferred.length > 0 ? preferred : fallback;
  if (choices.length <= 0) {
    return null;
  }
  return choices[Misc.getRandom(choices.length - 1)];
}

function shuffleInPlace(values) {
  for (let i = values.length - 1; i > 0; i--) {
    const swapIndex = Misc.getRandom(i);
    const current = values[i];
    values[i] = values[swapIndex];
    values[swapIndex] = current;
  }
}

let BonusManager;
let RegionManager;
let TaskManager;

module.exports = {
  name: "ChaosElemental",
  members: true,
  register(api) {
    BonusManager = api.getBonusManager();
    RegionManager = api.getRegionManager();
    TaskManager = api.getTaskManager();
    api.registerNpcCombatMethodProvider(
      [
        NpcIdentifiers.CHAOS_ELEMENTAL,
        NpcIdentifiers.CHAOS_ELEMENTAL_JR_,
        NpcIdentifiers.CHAOS_ELEMENTAL_JR_2,
        NpcIdentifiers.CHAOS_ELEMENTAL_2,
      ],
      ChaosElementalCombatMethod,
      { singleton: false }
    );
  },
};
