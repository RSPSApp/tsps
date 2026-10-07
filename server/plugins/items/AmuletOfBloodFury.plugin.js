const { CombatType } = require("../../src/main/typescript/elvarg/game/content/combat/CombatType");
const { CombatMethod } = require("../../src/main/typescript/elvarg/game/content/combat/method/CombatMethod");
const { Equipment } = require("../../src/main/typescript/elvarg/game/model/container/impl/Equipment");
const { Flag } = require("../../src/main/typescript/elvarg/game/model/Flag");
const { ItemIdentifiers } = require("../../src/main/typescript/elvarg/util/ItemIdentifiers");
const { Misc } = require("../../src/main/typescript/elvarg/util/Misc");

const AMULET_OF_FURY_ID = ItemIdentifiers.AMULET_OF_FURY;
const AMULET_OF_BLOOD_FURY_ID = ItemIdentifiers.AMULET_OF_BLOOD_FURY;
const BLOOD_SHARD_ID = ItemIdentifiers.BLOOD_SHARD;
const BLOOD_FURY_META_KEY = "blood-fury";
const BLOOD_FURY_CHARGES_PER_SHARD = 10000;
const BLOOD_FURY_MAX_CHARGES = 30000;

function clampCharges(charges) {
  const value = Number.isFinite(Number(charges))
    ? Math.floor(Number(charges))
    : BLOOD_FURY_CHARGES_PER_SHARD;
  return Math.max(0, Math.min(BLOOD_FURY_MAX_CHARGES, value));
}

function bloodFuryCharges(item) {
  if (!item || item.getId() !== AMULET_OF_BLOOD_FURY_ID) {
    return 0;
  }
  return clampCharges(item.getMetaValue?.(BLOOD_FURY_META_KEY)?.charges);
}

function setBloodFuryCharges(item, charges) {
  if (!item) {
    return item;
  }
  const next = clampCharges(charges);
  item.setId(next > 0 ? AMULET_OF_BLOOD_FURY_ID : AMULET_OF_FURY_ID);
  item.setMetaValue(BLOOD_FURY_META_KEY, next > 0 ? { charges: next } : undefined);
  return item;
}

function getBloodFury(player) {
  const item = player?.getEquipment?.()?.get?.(Equipment.AMULET_SLOT);
  return item?.getId?.() === AMULET_OF_BLOOD_FURY_ID ? item : null;
}

function asPlayer(entity) {
  return entity?.isPlayer?.() ? entity.getAsPlayer() : null;
}

function refresh(player) {
  player.getInventory().refreshItems();
  player.getEquipment().refreshItems();
  player.getUpdateFlag()?.flag?.(Flag.APPEARANCE);
  BonusManager.update(player);
}

function sendChargesMessage(player, item) {
  player
    .sendMessage(`Your amulet has ${bloodFuryCharges(item).toLocaleString("en-US")} charges left.`);
}

function createBloodFury(player, furyItem) {
  player.getInventory().deleteNumber(BLOOD_SHARD_ID, 1);
  setBloodFuryCharges(furyItem, BLOOD_FURY_CHARGES_PER_SHARD);
  refresh(player);
  player.sendMessage("You combine the blood shard with the amulet of fury.");
}

function chargeBloodFury(player, amuletItem) {
  const charges = bloodFuryCharges(amuletItem);
  if (charges >= BLOOD_FURY_MAX_CHARGES) {
    player.sendMessage("Your amulet of blood fury cannot hold any more charges.");
    return;
  }

  const maxShards = Math.floor((BLOOD_FURY_MAX_CHARGES - charges) / BLOOD_FURY_CHARGES_PER_SHARD);
  const addShards = Math.min(player.getInventory().getAmount(BLOOD_SHARD_ID), maxShards);
  if (addShards <= 0) {
    return;
  }

  player.getInventory().deleteNumber(BLOOD_SHARD_ID, addShards);
  setBloodFuryCharges(amuletItem, charges + addShards * BLOOD_FURY_CHARGES_PER_SHARD);
  refresh(player);
  player.sendMessage(
    addShards === 1
      ? "You charge the amulet of blood fury with 1 blood shard."
      : `You charge the amulet of blood fury with ${addShards} blood shards.`
  );
}

function revertBloodFury(player, item) {
  setBloodFuryCharges(item, 0);
  refresh(player);
  player.sendMessage("You remove the blood magic from the amulet.");
}

function applyBloodFuryEffect(hit) {
  const player = asPlayer(hit?.getAttacker?.());
  const amuletItem = getBloodFury(player);
  if (!amuletItem) {
    return;
  }

  const startingCharges = bloodFuryCharges(amuletItem);
  let charges = startingCharges;
  for (const resolvedHit of Array.isArray(hit.getHits?.()) ? hit.getHits() : []) {
    const damage = Number(resolvedHit?.getDamage?.() ?? 0);
    if (damage <= 0 || charges <= 0) {
      continue;
    }

    charges -= 1;
    if (Misc.getRandom(4) === 0) {
      const heal = Math.floor(damage * 0.3);
      if (heal > 0) {
        player.heal(heal);
      }
    }
  }

  if (charges === startingCharges) {
    return;
  }

  setBloodFuryCharges(amuletItem, charges);
  refresh(player);
  if (charges <= 0) {
    player.sendMessage("Your amulet of blood fury has run out of charges.");
  }
}

function resolveBaseMethod(player) {
  if (!player) {
    return null;
  }

  const combat = player.getCombat?.();
  if (
    combat?.getCastSpell?.() != null ||
    (combat?.getAutocastSpell?.() != null && player.getEquipment?.()?.hasStaffEquipped?.())
  ) {
    return null;
  }

  if (combat?.getRangedWeapon?.() != null) {
    return null;
  }

  const special = player.getCombatSpecial?.();
  if (
    player.isSpecialActivated?.() === true &&
    special &&
    special.getCombatMethod?.()?.type?.() === CombatType.MELEE
  ) {
    return special.getCombatMethod();
  }

  return CombatFactory.MELEE_COMBAT;
}

class BloodFuryCombatMethod extends CombatMethod {
  constructor(baseMethod) {
    super();
    this.baseMethod = baseMethod;
  }

  handleAfterHitEffects(hit) {
    this.baseMethod.handleAfterHitEffects(hit);
    applyBloodFuryEffect(hit);
  }
}

for (const methodName of [
  "start",
  "finished",
  "onCombatBegan",
  "onCombatEnded",
  "canAttack",
  "attackSpeed",
  "attackDistance",
  "type",
  "hits",
]) {
  BloodFuryCombatMethod.prototype[methodName] = function (...args) {
    return this.baseMethod[methodName](...args);
  };
}

const WRAPPED_METHODS = new WeakMap();

function getWrappedMethod(baseMethod) {
  let wrapped = WRAPPED_METHODS.get(baseMethod);
  if (!wrapped) {
    wrapped = new BloodFuryCombatMethod(baseMethod);
    WRAPPED_METHODS.set(baseMethod, wrapped);
  }
  return wrapped;
}

let BonusManager;
let CombatFactory;

function createFromShard({ player, usedItem, usedWithItem }) {
  createBloodFury(player, usedItem.getId() === AMULET_OF_FURY_ID ? usedItem : usedWithItem);
}

function chargeFromShard({ player, usedItem, usedWithItem }) {
  chargeBloodFury(player, usedItem.getId() === AMULET_OF_BLOOD_FURY_ID ? usedItem : usedWithItem);
}

module.exports = {
  name: "AmuletOfBloodFury",
  members: true,
  register(api) {
    BonusManager = api.getBonusManager();
    CombatFactory = api.getCombatFactory();
    api.onItemOnItem("Blood shard", "Amulet of fury", createFromShard, { noted: false });
    api.onItemOnItem("Blood shard", "Amulet of blood fury", chargeFromShard, { noted: false });

    api.onItemAction((event) => {
      if (event.itemId !== AMULET_OF_BLOOD_FURY_ID) {
        return;
      }

      if (event.clickType === 2) {
        event.handled = true;
        sendChargesMessage(event.player, event.item);
        return;
      }

      if (event.clickType === 3 && event.interfaceId === Equipment.INVENTORY_INTERFACE_ID) {
        event.handled = true;
        revertBloodFury(event.player, event.item);
      }
    });

    api.registerCombatMethodResolver({
      resolve(attacker) {
        const player = asPlayer(attacker);
        if (!getBloodFury(player)) {
          return null;
        }

        const baseMethod = resolveBaseMethod(player);
        return baseMethod?.type?.() === CombatType.MELEE ? getWrappedMethod(baseMethod) : null;
      },
    });
  },
};
