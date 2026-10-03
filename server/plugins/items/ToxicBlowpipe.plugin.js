const { Animation } = require("../../src/main/typescript/elvarg/game/model/Animation");
const { CombatSpecial } = require("../../src/main/typescript/elvarg/game/content/combat/CombatSpecial");
const { Flag } = require("../../src/main/typescript/elvarg/game/model/Flag");
const { Equipment } = require("../../src/main/typescript/elvarg/game/model/container/impl/Equipment");
const { PendingHit } = require("../../src/main/typescript/elvarg/game/content/combat/hit/PendingHit");
const { Projectile } = require("../../src/main/typescript/elvarg/game/model/Projectile");
const { RangedCombatMethod } = require("../../src/main/typescript/elvarg/game/content/combat/method/impl/RangedCombatMethod");
const { RangedData, RangedWeapon, Ammunition } = require("../../src/main/typescript/elvarg/game/content/combat/ranged/RangedData");
const { Skill } = require("../../src/main/typescript/elvarg/game/model/Skill");
const { Sound } = require("../../src/main/typescript/elvarg/game/Sound");
const { Sounds } = require("../../src/main/typescript/elvarg/game/Sounds");
const { WeaponInterfaces } = require("../../src/main/typescript/elvarg/game/content/combat/WeaponInterfaces");
const { WeaponInterfaceManager } = require("../../src/main/typescript/elvarg/game/content/combat/WeaponInterfaceManager");
const { Item } = require("../../src/main/typescript/elvarg/game/model/Item");
const { ItemIdentifiers } = require("../../src/main/typescript/elvarg/util/ItemIdentifiers");
const { Misc } = require("../../src/main/typescript/elvarg/util/Misc");

const TOXIC_BLOWPIPE_EMPTY_ID = ItemIdentifiers.TOXIC_BLOWPIPE_EMPTY_;
const TOXIC_BLOWPIPE_ID = ItemIdentifiers.TOXIC_BLOWPIPE;
const ZULRAH_SCALES_ID = 12934;
const TOXIC_BLOWPIPE_MAX_SCALES = 16383;
const TOXIC_BLOWPIPE_MAX_DARTS = 16383;
const TOXIC_BLOWPIPE_META_KEY = "toxic-blowpipe";

const DART_RANGED_STRENGTHS = new Map([
  [ItemIdentifiers.BRONZE_DART, 1],
  [ItemIdentifiers.IRON_DART, 2],
  [ItemIdentifiers.STEEL_DART, 3],
  [ItemIdentifiers.BLACK_DART, 6],
  [ItemIdentifiers.MITHRIL_DART, 9],
  [ItemIdentifiers.ADAMANT_DART, 17],
  [ItemIdentifiers.RUNE_DART, 26],
  [ItemIdentifiers.AMETHYST_DART, 28],
  [ItemIdentifiers.DRAGON_DART, 35],
]);

const TOXIC_BLOWPIPE_DART_ID_SET = new Set(Array.from(DART_RANGED_STRENGTHS.keys()));
const EMPTY_STATE = Object.freeze({ scales: 0, dartId: -1, dartAmount: 0 });

function normalizeInt(value, fallback) {
  return Number.isFinite(value) ? Math.floor(Number(value)) : fallback;
}

function isToxicBlowpipeItemId(itemId) {
  return itemId === TOXIC_BLOWPIPE_EMPTY_ID || itemId === TOXIC_BLOWPIPE_ID;
}

function isToxicBlowpipeDartId(itemId) {
  return TOXIC_BLOWPIPE_DART_ID_SET.has(Number(itemId));
}

function sanitizeMeta(raw) {
  const value = raw && typeof raw === "object" ? raw : {};
  const rawDartId = normalizeInt(value.dartId, -1);
  const dartAmount = Math.max(0, normalizeInt(value.dartAmount, 0));
  const scales = Math.max(0, normalizeInt(value.scales, 0));
  const dartId = dartAmount > 0 && isToxicBlowpipeDartId(rawDartId) ? rawDartId : -1;
  return {
    scales: Math.min(TOXIC_BLOWPIPE_MAX_SCALES, scales),
    dartId,
    dartAmount: dartId > 0 ? Math.min(TOXIC_BLOWPIPE_MAX_DARTS, dartAmount) : 0,
  };
}

const BlowpipeState = {
  read(item) {
    if (!item || !isToxicBlowpipeItemId(item.getId())) {
      return EMPTY_STATE;
    }
    return sanitizeMeta(item.getMetaValue?.(TOXIC_BLOWPIPE_META_KEY));
  },
  write(item, next) {
    const state = sanitizeMeta(next);
    if (state.scales <= 0 && state.dartAmount <= 0) {
      item.setMetaValue(TOXIC_BLOWPIPE_META_KEY, undefined);
    } else {
      item.setMetaValue(TOXIC_BLOWPIPE_META_KEY, state);
    }
    if (item && isToxicBlowpipeItemId(item.getId())) {
      item.setId(state.scales > 0 || state.dartAmount > 0 ? TOXIC_BLOWPIPE_ID : TOXIC_BLOWPIPE_EMPTY_ID);
    }
    return item;
  },
  update(item, updater) {
    return this.write(item, updater(this.read(item)));
  },
  equipped(player) {
    const item = player?.getEquipment?.()?.get?.(Equipment.WEAPON_SLOT) ?? null;
    return item && isToxicBlowpipeItemId(item.getId()) ? item : null;
  },
  hasDarts(item) {
    const state = this.read(item);
    return isToxicBlowpipeDartId(state.dartId) && state.dartAmount > 0;
  },
  ammo(item) {
    const { dartId } = this.read(item);
    return dartId > 0 ? Ammunition.getForItem(dartId) : null;
  },
  addScales(item, amount) {
    return this.update(item, (state) => ({ ...state, scales: state.scales + amount }));
  },
  clear(item) {
    return this.write(item, EMPTY_STATE);
  },
  swapDarts(item, dartId, amount) {
    return this.update(item, (state) => ({ ...state, dartId, dartAmount: amount }));
  },
  addDarts(item, dartId, amount) {
    return this.update(item, (state) => ({ ...state, dartId, dartAmount: state.dartAmount + amount }));
  },
  consumeScale(item) {
    let remaining = 0;
    this.update(item, (state) => {
      remaining = Math.max(0, state.scales - 1);
      return { ...state, scales: remaining };
    });
    return remaining;
  },
  consumeDart(item) {
    let remaining = 0;
    this.update(item, (state) => {
      remaining = Math.max(0, state.dartAmount - 1);
      return { ...state, dartId: remaining > 0 ? state.dartId : -1, dartAmount: remaining };
    });
    return remaining;
  },
};

function getToxicBlowpipeDartStrength(itemId) {
  return DART_RANGED_STRENGTHS.get(Number(itemId)) ?? 0;
}

function getDefinitionBonus(item, index) {
  const bonuses = item?.getDefinition?.()?.getBonuses?.() ?? [];
  return Number(bonuses[index] ?? 0);
}

function getAmmo(player) {
  return BlowpipeState.ammo(BlowpipeState.equipped(player));
}

function getAmmoName(dartId) {
  if (!isToxicBlowpipeDartId(dartId)) {
    return "darts";
  }
  return new Item(dartId).getDefinition()?.getName?.()?.toLowerCase?.() ?? "darts";
}

function canAddStack(inventory, itemId) {
  return inventory.getFreeSlots() > 0 || inventory.contains(itemId);
}

function getItemContainer(player, item, preferredSlot = -1) {
  const inventory = player.getInventory();
  if (preferredSlot >= 0 && inventory.getItems()[preferredSlot] === item) {
    return inventory;
  }
  if (inventory.getItems().includes(item)) {
    return inventory;
  }
  const equipment = player.getEquipment();
  if (equipment.getItems().includes(item)) {
    return equipment;
  }
  return null;
}

function refreshBlowpipeState(player, item, preferredSlot = -1) {
  const container = getItemContainer(player, item, preferredSlot);
  if (container) {
    container.refreshItems();
    if (container === player.getEquipment()) {
      player.getUpdateFlag()?.flag?.(Flag.APPEARANCE);
    }
  }
  if (
    player.getWeapon?.() === WeaponInterfaces.BLOWPIPE ||
    player.getEquipment().get(Equipment.WEAPON_SLOT) === item
  ) {
    WeaponInterfaceManager.assign(player);
  }
  BonusManager.update(player);
}

function isReady(player, item, amountRequired = 1, silent = false) {
  const { scales, dartAmount } = BlowpipeState.read(item);
  if (scales <= 0) {
    if (!silent) {
      player.sendMessage("You must recharge your Toxic blowpipe using some Zulrah scales.");
      player.getCombat().reset();
    }
    return false;
  }
  if (dartAmount < amountRequired) {
    if (!silent) {
      player.sendMessage("You must load darts into the Toxic blowpipe.");
      player.getCombat().reset();
    }
    return false;
  }
  return true;
}

function isCharged(item, amountRequired = 1) {
  const { scales, dartAmount } = BlowpipeState.read(item);
  return scales > 0 && dartAmount >= amountRequired;
}

function chargeScales(player, blowpipeItem, blowpipeSlot, scaleItem) {
  const { scales: current } = BlowpipeState.read(blowpipeItem);
  if (current >= TOXIC_BLOWPIPE_MAX_SCALES) {
    player.sendMessage("Your blowpipe cannot hold any more scales.");
    return;
  }
  const add = Math.min(scaleItem.getAmount(), TOXIC_BLOWPIPE_MAX_SCALES - current);
  if (add <= 0) {
    return;
  }
  player.getInventory().deleteNumber(ZULRAH_SCALES_ID, add);
  BlowpipeState.addScales(blowpipeItem, add);
  refreshBlowpipeState(player, blowpipeItem, blowpipeSlot);
  player.sendMessage(`You add ${add} Zulrah scales to the blowpipe.`);
}

function chargeDarts(player, blowpipeItem, blowpipeSlot, dartItem) {
  const dartId = dartItem.getId();
  const { dartId: currentId, dartAmount: currentAmount } = BlowpipeState.read(blowpipeItem);

  if (currentAmount >= TOXIC_BLOWPIPE_MAX_DARTS && currentId === dartId) {
    player.sendMessage("Your blowpipe cannot hold any more darts.");
    return;
  }

  if (currentAmount > 0 && currentId !== dartId && !canAddStack(player.getInventory(), currentId)) {
    player.sendMessage("You need more inventory space to swap the loaded darts.");
    return;
  }

  if (currentAmount > 0 && currentId !== dartId) {
    player.getInventory().add(new Item(currentId, currentAmount), true);
    BlowpipeState.clear(blowpipeItem);
  }

  const add = Math.min(dartItem.getAmount(), TOXIC_BLOWPIPE_MAX_DARTS - BlowpipeState.read(blowpipeItem).dartAmount);
  if (add <= 0) {
    return;
  }

  player.getInventory().deleteNumber(dartId, add);
  BlowpipeState.addDarts(blowpipeItem, dartId, add);
  refreshBlowpipeState(player, blowpipeItem, blowpipeSlot);
  player.sendMessage(`You load ${add} ${getAmmoName(dartId)} into the blowpipe.`);
}

function unloadBlowpipe(player, blowpipeItem, slot) {
  const { scales, dartId, dartAmount } = BlowpipeState.read(blowpipeItem);

  if (scales <= 0 && dartAmount <= 0) {
    player.sendMessage("Your blowpipe is already empty.");
    return;
  }

  const inventory = player.getInventory();
  let requiredSlots = 0;
  if (scales > 0 && !inventory.contains(ZULRAH_SCALES_ID)) {
    requiredSlots++;
  }
  if (dartAmount > 0 && !inventory.contains(dartId)) {
    requiredSlots++;
  }
  if (inventory.getFreeSlots() < requiredSlots) {
    player.sendMessage("You need more inventory space to unload the blowpipe.");
    return;
  }

  if (scales > 0) {
    inventory.add(new Item(ZULRAH_SCALES_ID, scales), true);
  }
  if (dartAmount > 0 && isToxicBlowpipeDartId(dartId)) {
    inventory.add(new Item(dartId, dartAmount), true);
  }

  BlowpipeState.clear(blowpipeItem);
  refreshBlowpipeState(player, blowpipeItem, slot);
  player.sendMessage("You unload your blowpipe.");
}

function sendStatus(player, blowpipeItem) {
  const { scales, dartId, dartAmount } = BlowpipeState.read(blowpipeItem);
  if (dartAmount <= 0 || !isToxicBlowpipeDartId(dartId)) {
    player.sendMessage(
      `Your Toxic blowpipe has ${scales} Zulrah scales and no darts loaded.`
    );
    return;
  }
  player.sendMessage(
    `Your Toxic blowpipe has ${scales} Zulrah scales and ${dartAmount} ${getAmmoName(dartId)} loaded.`
  );
}

function maybeConsumeLoadedDart(player, blowpipeItem) {
  if (player.getEquipment().get(Equipment.CAPE_SLOT).getId() === ItemIdentifiers.AVAS_ACCUMULATOR) {
    if (Misc.getRandom(12) <= 9) {
      return false;
    }
  }
  if (BlowpipeState.consumeDart(blowpipeItem) <= 0) {
    player.sendMessage("Your Toxic blowpipe has run out of darts!");
    player.getCombat().reset();
    return true;
  }
  return false;
}

function maybeConsumeScale(player, blowpipeItem) {
  if (Misc.getRandom(2) !== 0) {
    if (BlowpipeState.consumeScale(blowpipeItem) <= 0) {
      player.sendMessage("Your Toxic blowpipe has run out of scales!");
      player.getCombat().reset();
      return true;
    }
  }
  return false;
}

class ToxicBlowpipeCombatMethod extends RangedCombatMethod {
  constructor(special) {
    super();
    this.special = special === true;
  }

  canAttack(character, target) {
    if (!character?.isPlayer?.()) {
      return false;
    }
    const player = character.getAsPlayer();
    const blowpipeItem = BlowpipeState.equipped(player);
    if (!blowpipeItem || blowpipeItem.getId() !== TOXIC_BLOWPIPE_ID) {
      return false;
    }
    return isReady(player, blowpipeItem);
  }

  attackSpeed(character) {
    const target = character?.getCombat?.()?.getTarget?.() ?? null;
    return target?.isPlayer?.() ? 4 : 3;
  }

  hits(character, target) {
    const distance = character.getLocation().getDistance(target.getLocation());
    const delay = RangedData.hitDelay(distance, character.getCombat().getRangedWeapon());
    return [new PendingHit(character, target, this, delay)];
  }

  start(character, target) {
    const player = character.getAsPlayer();
    const blowpipeItem = BlowpipeState.equipped(player);
    if (!blowpipeItem) {
      player.getCombat().reset();
      return;
    }
    const ammo = getAmmo(player);
    if (!ammo) {
      player.sendMessage("You must load darts into the Toxic blowpipe.");
      player.getCombat().reset();
      return;
    }

    const animation = character.getAttackAnim();
    if (animation !== -1) {
      character.performAnimation(new Animation(animation));
    }

    Projectile.createProjectile(character, target, ammo.getProjectileId(), 40, 60, 40, 35)
      .sendProjectile();
    Sounds.sendSound(character, Sound.THROW_DART);

    if (this.special) {
      const drainAmount = player.getCombatSpecial?.()?.getDrainAmount?.() ?? 50;
      CombatSpecial.drain(player, drainAmount);
    }

    const dartsDepleted = maybeConsumeLoadedDart(player, blowpipeItem);
    const scalesDepleted = maybeConsumeScale(player, blowpipeItem);
    if (dartsDepleted || scalesDepleted) {
      refreshBlowpipeState(player, blowpipeItem);
    }
  }

  handleAfterHitEffects(hit) {
    const attacker = hit?.getAttacker?.();
    const target = hit?.getTarget?.();
    if (!attacker?.isPlayer?.() || !target) {
      return;
    }

    const player = attacker.getAsPlayer();
    const totalDamage = Number(hit.getTotalDamage?.() ?? 0);
    if (totalDamage <= 0 || hit.isAccurate?.() !== true) {
      return;
    }

    if (Misc.getRandom(3) === 0) {
      CombatFactory.poisonEntity(target, 12, 2);
    }

    if (!this.special) {
      return;
    }

    const heal = Math.floor(totalDamage * 0.5);
    if (heal <= 0) {
      return;
    }

    const skillManager = player.getSkillManager();
    const maxHp = skillManager.getMaxLevel(Skill.HITPOINTS);
    const nextHp = Math.min(maxHp, skillManager.getCurrentLevel(Skill.HITPOINTS) + heal);
    skillManager.setCurrentLevels(Skill.HITPOINTS, nextHp);
    skillManager.updateSkill(Skill.HITPOINTS);
  }
}

const REGULAR_COMBAT_METHOD = new ToxicBlowpipeCombatMethod(false);
const SPECIAL_COMBAT_METHOD = new ToxicBlowpipeCombatMethod(true);

let BonusManager;
let CombatFactory;

module.exports = {
  name: "ToxicBlowpipe",
  members: true,
  register(api) {
    BonusManager = api.getBonusManager();
    CombatFactory = api.getCombatFactory();
    api.registerRangedAmmoResolver({
      resolve(player) {
        const blowpipeItem = BlowpipeState.equipped(player);
        if (!blowpipeItem || blowpipeItem.getId() !== TOXIC_BLOWPIPE_ID) {
          return null;
        }
        return BlowpipeState.ammo(blowpipeItem);
      },
    });

    api.registerRangedAmmoHandler({
      checkAmmo(player, amountRequired, silent = false) {
        const rangedWeapon = player?.getCombat?.()?.getRangedWeapon?.();
        if (rangedWeapon !== RangedWeapon.TOXIC_BLOWPIPE) {
          return null;
        }
        return isReady(player, BlowpipeState.equipped(player), amountRequired, silent);
      },
      decrementAmmo(player, pos, amount) {
        const rangedWeapon = player?.getCombat?.()?.getRangedWeapon?.();
        if (rangedWeapon !== RangedWeapon.TOXIC_BLOWPIPE) {
          return false;
        }
        const blowpipeItem = BlowpipeState.equipped(player);
        if (!blowpipeItem) {
          player.getCombat().reset();
          return true;
        }
        let depleted = false;
        for (let i = 0; i < amount; i++) {
          if (BlowpipeState.consumeScale(blowpipeItem) <= 0) {
            depleted = true;
            break;
          }
        }
        if (depleted) {
          refreshBlowpipeState(player, blowpipeItem);
          player.sendMessage("Your Toxic blowpipe has run out of scales!");
          player.getCombat().reset();
        }
        return true;
      },
    });

    api.registerBonusProvider({
      apply(event) {
        const { player, bonuses } = event;
        const blowpipeItem = BlowpipeState.equipped(player);
        if (!blowpipeItem || blowpipeItem.getId() !== TOXIC_BLOWPIPE_ID) {
          return;
        }
        if (!isCharged(blowpipeItem)) {
          return;
        }
        const { dartId } = BlowpipeState.read(blowpipeItem);
        if (!isToxicBlowpipeDartId(dartId)) {
          return;
        }
        bonuses[BonusManager.ATTACK_RANGE] += 30 - getDefinitionBonus(blowpipeItem, BonusManager.ATTACK_RANGE);
        bonuses[10 + BonusManager.RANGED_STRENGTH] +=
          20 + getToxicBlowpipeDartStrength(dartId) - getDefinitionBonus(blowpipeItem, 10 + BonusManager.RANGED_STRENGTH);
      },
    });

    api.registerCombatMethodResolver({
      resolve(attacker) {
        if (!attacker?.isPlayer?.()) {
          return null;
        }
        const player = attacker.getAsPlayer();
        const blowpipeItem = BlowpipeState.equipped(player);
        if (!blowpipeItem || blowpipeItem.getId() !== TOXIC_BLOWPIPE_ID) {
          return null;
        }
        if (player.isSpecialActivated?.() === true && player.getCombatSpecial?.()?.getId?.() === "toxic_blowpipe") {
          return SPECIAL_COMBAT_METHOD;
        }
        return REGULAR_COMBAT_METHOD;
      },
    });

    api.onItemOnItem((event) => {
      const { player, usedItemId, usedWithItemId, usedItemSlot, usedWithItemSlot, usedItem, usedWithItem } = event;
      const blowpipeOnLeft = isToxicBlowpipeItemId(usedItemId);
      const blowpipeOnRight = isToxicBlowpipeItemId(usedWithItemId);
      if (!blowpipeOnLeft && !blowpipeOnRight) {
        return;
      }

      const blowpipeSlot = blowpipeOnLeft ? usedItemSlot : usedWithItemSlot;
      const blowpipeItem = blowpipeOnLeft ? usedItem : usedWithItem;
      const otherItem = blowpipeOnLeft ? usedWithItem : usedItem;
      const otherItemId = blowpipeOnLeft ? usedWithItemId : usedItemId;

      if (otherItemId === ZULRAH_SCALES_ID) {
        event.handled = true;
        chargeScales(player, blowpipeItem, blowpipeSlot, otherItem);
        return;
      }

      if (isToxicBlowpipeDartId(otherItemId)) {
        event.handled = true;
        chargeDarts(player, blowpipeItem, blowpipeSlot, otherItem);
      }
    });

    api.onItemAction((event) => {
      if (!isToxicBlowpipeItemId(event.itemId)) {
        return;
      }
      if (event.clickType === 2) {
        event.handled = true;
        unloadBlowpipe(event.player, event.item, event.slot);
        return;
      }
      if (event.clickType === 3) {
        event.handled = true;
        sendStatus(event.player, event.item);
        return;
      }
      if (event.clickType === 4 && event.interfaceId === Equipment.INVENTORY_INTERFACE_ID) {
        event.handled = true;
        sendStatus(event.player, event.item);
      }
    });
  },
};
