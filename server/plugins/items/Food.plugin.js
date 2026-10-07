const { TimerKey } = require("../../src/main/typescript/elvarg/util/timers/TimerKey");
const { Skill } = require("../../src/main/typescript/elvarg/game/model/Skill");
const { Sound } = require("../../src/main/typescript/elvarg/game/Sound");
const { Sounds } = require("../../src/main/typescript/elvarg/game/Sounds");
const { Animation } = require("../../src/main/typescript/elvarg/game/model/Animation");
const { ItemDefinition } = require("../../src/main/typescript/elvarg/game/definition/ItemDefinition");
let pluginApi;
const { restoreRunEnergy, curePoisonAndVenom } = require("./ConsumableEffects");
const { ItemIds } = require("../../src/main/typescript/elvarg/util/IdEnums");
const { Item } = require("../../src/main/typescript/elvarg/game/model/Item");
const { ItemIdentifiers } = require("../../src/main/typescript/elvarg/util/ItemIdentifiers");
const { Wilderness } = require("../../src/main/typescript/elvarg/game/content/wilderness/Wilderness");

const EAT_ANIMATION = new Animation(829);
// Ticks eating adds to the attack timer; combo foods add 2 (Wiki: Food).
const ATTACK_DELAY = 3;
const COMBO_ATTACK_DELAY = 2;

const FOOD = new Map([
  [ItemIds.KEBAB, { heal: 4 }],
  [ItemIdentifiers.BAGUETTE, { heal: 6 }],
  [ItemIdentifiers.TRIANGLE_SANDWICH, { heal: 6 }],
  [ItemIdentifiers.SQUARE_SANDWICH, { heal: 6 }],
  [ItemIdentifiers.ROLL, { heal: 6 }],
  [ItemIdentifiers.CHOCOLATE_BAR, { heal: 3 }],
  [ItemIdentifiers.SPINACH_ROLL, { heal: 2 }],
  [ItemIdentifiers.STRANGE_FRUIT, { heal: 0, energy: 30, poisonProtection: 18,
    message: "You eat the fruit. It tastes great, some of your energy is restored!" }],
  [ItemIdentifiers.MEAT_PIE, { heal: 6, replacementId: ItemIdentifiers.HALF_A_MEAT_PIE }],
  [ItemIdentifiers.HALF_A_MEAT_PIE, { heal: 6, replacementId: ItemIdentifiers.PIE_DISH }],
  [ItemIds.CHEESE, { heal: 4 }],
  [ItemIds.CAKE, { heal: 5, replacementId: ItemIds._2_3_CAKE }],
  [ItemIds._2_3_CAKE, { heal: 5, replacementId: ItemIds.SLICE_OF_CAKE }],
  [ItemIds.SLICE_OF_CAKE, { heal: 5 }],
  [ItemIds.NULL_2422, { heal: 12, verb: "use" }],
  [ItemIds.JANGERBERRIES, { heal: 2 }],
  [ItemIds.WORM_CRUNCHIES, { heal: 8, karambwan: true }],
  [ItemIdentifiers.CHOCCHIP_CRUNCHIES, { heal: 7, karambwan: true }],
  [ItemIdentifiers.SPICY_CRUNCHIES, { heal: 7, karambwan: true }],
  [ItemIdentifiers.TOAD_CRUNCHIES, { heal: 8, karambwan: true }],
  [ItemIdentifiers.WORM_BATTA, { heal: 11, karambwan: true }],
  [ItemIdentifiers.TOAD_BATTA, { heal: 11, karambwan: true }],
  [ItemIdentifiers.CHEESE_TOM_BATTA, { heal: 11, karambwan: true }],
  [ItemIdentifiers.FRUIT_BATTA, { heal: 11, karambwan: true }],
  [ItemIdentifiers.VEGETABLE_BATTA, { heal: 11, karambwan: true }],
  [ItemIds.EDIBLE_SEAWEED, { heal: 4 }],
  [ItemIds.ANCHOVIES, { heal: 1 }],
  [ItemIds.SHRIMPS, { heal: 3 }],
  [ItemIdentifiers.COOKED_CHICKEN, { heal: 3 }],
  [ItemIdentifiers.COOKED_MEAT, { heal: 3 }],
  [ItemIdentifiers.STEW, { heal: 11, replacementId: ItemIdentifiers.BOWL }],
  [ItemIdentifiers.CURRY, { heal: 19, replacementId: ItemIdentifiers.BOWL }],
  [ItemIds.SARDINE, { heal: 4 }],
  [ItemIds.COD, { heal: 7 }],
  [ItemIds.TROUT, { heal: 7 }],
  [ItemIds.PIKE, { heal: 8 }],
  [ItemIds.SALMON, { heal: 9 }],
  [ItemIds.TUNA, { heal: 10 }],
  [ItemIds.LOBSTER, { heal: 12 }],
  [ItemIds.BASS, { heal: 13 }],
  [ItemIds.SWORDFISH, { heal: 14 }],
  [ItemIds.MEAT_PIZZA, { heal: 14 }],
  [ItemIds.MONKFISH, { heal: 16 }],
  [ItemIds.SHARK, { heal: 20 }],
  [ItemIdentifiers.HALIBUT, { heal: 20, karambwan: true }],
  [ItemIds.SEA_TURTLE, { heal: 21 }],
  [ItemIds.DARK_CRAB, { heal: 22 }],
  [ItemIds.MANTA_RAY, { heal: 22 }],
  [ItemIdentifiers.MARLIN, { heal: 24 }],
  [ItemIds.COOKED_KARAMBWAN, { heal: 18, karambwan: true }],
  // The Gauntlet: crystal and corrupted paddlefish combo-eat like karambwan (Wiki).
  [ItemIdentifiers.PADDLEFISH, { heal: 20 }],
  [ItemIdentifiers.CRYSTAL_PADDLEFISH, { heal: 16, karambwan: true }],
  [ItemIdentifiers.CORRUPTED_PADDLEFISH, { heal: 16, karambwan: true }],
  [ItemIds.ANGLERFISH, { heal: 22, anglerfish: true }],
  [ItemIdentifiers.BLIGHTED_MANTA_RAY, { heal: 22 }],
  [ItemIdentifiers.BLIGHTED_ANGLERFISH, { heal: 22, anglerfish: true }],
  [ItemIdentifiers.BLIGHTED_KARAMBWAN, { heal: 18, karambwan: true }],
  [ItemIdentifiers.BANANA, { heal: 2 }],
  [ItemIdentifiers.PEACH, { heal: 8 }],
  [ItemIdentifiers.BANDAGES, { heal: 12, verb: "use" }],
  [ItemIds.POTATO, { heal: 1 }],
  [ItemIds.BAKED_POTATO, { heal: 4 }],
  [ItemIds.POTATO_WITH_BUTTER, { heal: 14 }],
  [ItemIds.CHILLI_POTATO, { heal: 14 }],
  [ItemIds.EGG_POTATO, { heal: 16 }],
  [ItemIds.POTATO_WITH_CHEESE, { heal: 16 }],
  [ItemIds.MUSHROOM_POTATO, { heal: 20 }],
  [ItemIds.TUNA_POTATO, { heal: 20 }],
  [ItemIdentifiers.MEAT_PIZZA, { heal: 8, replacementId: ItemIdentifiers._1_2_MEAT_PIZZA }],
  [ItemIdentifiers._1_2_MEAT_PIZZA, { heal: 8 }],
  [ItemIdentifiers.ANCHOVY_PIZZA, { heal: 9, replacementId: ItemIdentifiers._1_2_ANCHOVY_PIZZA }],
  [ItemIdentifiers._1_2_ANCHOVY_PIZZA, { heal: 9 }],
  [ItemIdentifiers.PINEAPPLE_PIZZA, { heal: 11, replacementId: ItemIdentifiers._1_2_PINEAPPLE_PIZZA }],
  [ItemIdentifiers._1_2_PINEAPPLE_PIZZA, { heal: 11 }],
  [ItemIdentifiers.APPLE_PIE, { heal: 7, replacementId: ItemIdentifiers.HALF_AN_APPLE_PIE }],
  [ItemIdentifiers.HALF_AN_APPLE_PIE, { heal: 7, replacementId: ItemIdentifiers.PIE_DISH }],
  [ItemIdentifiers.ADMIRAL_PIE, { heal: 8, replacementId: ItemIdentifiers.HALF_AN_ADMIRAL_PIE }],
  [ItemIdentifiers.HALF_AN_ADMIRAL_PIE, { heal: 8, replacementId: ItemIdentifiers.PIE_DISH }],
  [ItemIdentifiers.WILD_PIE, { heal: 11, replacementId: ItemIdentifiers.HALF_A_WILD_PIE }],
  [ItemIdentifiers.HALF_A_WILD_PIE, { heal: 11, replacementId: ItemIdentifiers.PIE_DISH }],
  [ItemIdentifiers.SUMMER_PIE, { heal: 11, replacementId: ItemIdentifiers.HALF_A_SUMMER_PIE }],
  [ItemIdentifiers.HALF_A_SUMMER_PIE, { heal: 11, replacementId: ItemIdentifiers.PIE_DISH }],
  [ItemIdentifiers.CHOCOLATE_CAKE, { heal: 5, replacementId: ItemIdentifiers._2_3_CHOCOLATE_CAKE }],
  [ItemIdentifiers._2_3_CHOCOLATE_CAKE, { heal: 5, replacementId: ItemIdentifiers.CHOCOLATE_SLICE }],
  [ItemIdentifiers.CHOCOLATE_SLICE, { heal: 5 }],
  [ItemIdentifiers.STRAWBERRY, { heal: 1, strawberry: true }],
  [ItemIdentifiers.COOKED_SWEETCORN, { heal: 0, sweetcorn: true }],
]);

const FOOD_ITEM_IDS = [...FOOD.keys()];

function getAnglerfishHeal(currentHp) {
  let c = 2;
  if (currentHp >= 25) c = 4;
  if (currentHp >= 50) c = 6;
  if (currentHp >= 75) c = 8;
  if (currentHp >= 93) c = 13;

  const heal = Math.floor(currentHp / 10 + c);
  return Math.min(22, heal);
}

/** Wiki: 1 + 6% of the player's maximum hitpoints, capped at 6. */
function getStrawberryHeal(maxHp) {
  return Math.min(6, 1 + Math.floor(maxHp * 0.06));
}

function canEat(player, itemId) {
  return pluginApi.emitCanEat(player, itemId) !== false;
}

/**
 * Wiki: anglerfish cannot overheal while its eater is in combat in a PvP
 * area, with either a player or an NPC; everywhere else the heal may raise
 * Hitpoints above the base maximum.
 */
function canAnglerfishOverheal(player) {
  if (!Wilderness.isPvpArea(player?.getLocation?.())) {
    return true;
  }
  const combat = player.getCombat?.();
  return combat?.getTarget?.() == null && combat?.getAttacker?.() == null;
}

module.exports = {
  name: "Food",
  FOOD,
  FOOD_ITEM_IDS,
  ATTACK_DELAY,
  COMBO_ATTACK_DELAY,
  isFoodItem(itemId) {
    return Number.isInteger(itemId) && FOOD.has(itemId);
  },
  _test: { getAnglerfishHeal, getStrawberryHeal, canAnglerfishOverheal },
  register(api) {
    pluginApi = api;
    api.onItemFirstAction((event) => {
      const { player, itemId, slot } = event;
      const food = FOOD.get(itemId);
      if (!food) {
        return false;
      }

      if (!canEat(player, itemId)) {
        player.sendMessage("You cannot eat here.");
        return true;
      }

      const timers = player.getTimers();
      if (timers.has(TimerKey.STUN)) {
        player.sendMessage("You're currently stunned!");
        return true;
      }

      if (food.karambwan) {
        if (timers.has(TimerKey.KARAMBWAN)) {
          return true;
        }
      } else if (timers.has(TimerKey.FOOD)) {
        return true;
      }

      const inventory = player.getInventory();
      if (
        slot < 0 ||
        slot >= inventory.capacity() ||
        inventory.getItems()[slot]?.getId?.() !== itemId
      ) {
        return true;
      }

      timers.extendOrRegister(TimerKey.FOOD, 3);
      player.getCombat().delayAttack(food.karambwan ? COMBO_ATTACK_DELAY : ATTACK_DELAY);
      if (food.karambwan) {
        timers.registers(TimerKey.KARAMBWAN, 3);
        timers.registers(TimerKey.POTION, 3);
      }

      player.getPacketSender().sendInterfaceRemoval();
      player.getSkillManager().stopSkillable();
      Sounds.sendSound(player, Sound.FOOD_EAT);
      player.performAnimation(EAT_ANIMATION);

      inventory.deleteAtSlot(slot, 1, false);
      if (food.replacementId) {
        inventory.setItem(slot, new Item(food.replacementId, 1));
      }
      inventory.refreshItems();

      const currentHp = player.getSkillManager().getCurrentLevel(Skill.HITPOINTS);
      let maxHp = player.getSkillManager().getMaxLevel(Skill.HITPOINTS);
      let healAmount = food.heal;

      if (food.anglerfish) {
        healAmount = getAnglerfishHeal(currentHp);
        if (canAnglerfishOverheal(player)) {
          maxHp += healAmount;
        }
      } else if (food.sweetcorn) {
        healAmount = Math.floor(maxHp / 10) + 1;
      } else if (food.strawberry) {
        healAmount = getStrawberryHeal(maxHp);
      }

      if (healAmount > 0) player.setHitpoints(Math.max(0, Math.min(currentHp + healAmount, maxHp)));
      if (food.energy) restoreRunEnergy(player, food.energy);
      if (food.poisonProtection) {
        curePoisonAndVenom(player);
        const immunity = player.getCombat().getPoisonImmunityTimer();
        if (immunity.secondsRemaining() < food.poisonProtection) immunity.start(food.poisonProtection);
      }

      const verb = food.verb || "eat";
      const itemName = ItemDefinition.forId(itemId).getName().toLowerCase();
      player.sendMessage(food.message ?? `You ${verb} the ${itemName}.`);
      api.emitCustomEvent("food:eaten", { player, itemId, heal: healAmount });
      return true;
    });

    api.log("registered", { foods: FOOD.size });
  },
};
