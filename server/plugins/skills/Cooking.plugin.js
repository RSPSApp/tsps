const { Task } = require("../../src/main/typescript/elvarg/game/task/Task");
const { Skill } = require("../../src/main/typescript/elvarg/game/model/Skill");
const { Animation } = require("../../src/main/typescript/elvarg/game/model/Animation");
const { Item } = require("../../src/main/typescript/elvarg/game/model/Item");
const { ItemDefinition } = require("../../src/main/typescript/elvarg/game/definition/ItemDefinition");
const { MapObjects } = require("../../src/main/typescript/elvarg/game/entity/impl/object/MapObjects");
const { Sound } = require("../../src/main/typescript/elvarg/game/Sound");
const { Sounds } = require("../../src/main/typescript/elvarg/game/Sounds");
const { ItemIds } = require("../../src/main/typescript/elvarg/util/IdEnums");

const COOK_ANIMATION = new Animation(896);
const COOK_INTERVAL_TICKS = 4;

const COOKABLES = Object.freeze([
  { raw: ItemIds.RAW_BEEF, cooked: ItemIds.COOKED_MEAT, burnt: ItemIds.BURNT_MEAT, level: 1, xp: 30, stopBurn: 34, name: "meat" },
  { raw: ItemIds.RAW_RAT_MEAT, cooked: ItemIds.COOKED_MEAT, burnt: ItemIds.BURNT_MEAT, level: 1, xp: 30, stopBurn: 34, name: "rat meat" },
  { raw: ItemIds.RAW_CHICKEN, cooked: ItemIds.COOKED_CHICKEN, burnt: ItemIds.BURNT_CHICKEN, level: 1, xp: 30, stopBurn: 34, name: "chicken" },
  { raw: ItemIds.RAW_RABBIT, cooked: ItemIds.COOKED_RABBIT, burnt: ItemIds.BURNT_RABBIT, level: 1, xp: 30, stopBurn: 37, name: "rabbit" },
  { raw: ItemIds.RAW_SHRIMPS, cooked: ItemIds.SHRIMPS, burnt: ItemIds.BURNT_SHRIMP, level: 1, xp: 30, stopBurn: 33, name: "shrimp" },
  { raw: ItemIds.RAW_ANCHOVIES, cooked: ItemIds.ANCHOVIES, burnt: ItemIds.BURNT_FISH, level: 1, xp: 30, stopBurn: 34, name: "anchovies" },
  { raw: ItemIds.RAW_SARDINE, cooked: ItemIds.SARDINE, burnt: ItemIds.BURNT_FISH, level: 1, xp: 40, stopBurn: 38, name: "sardine" },
  { raw: ItemIds.RAW_KARAMBWANJI, cooked: ItemIds.POISON_KARAMBWAN, burnt: ItemIds.POISON_KARAMBWAN, level: 1, xp: 80, stopBurn: 1, name: "poison karambwan" },
  { raw: ItemIds.RAW_UGTHANKI_MEAT, cooked: ItemIds.UGTHANKI_MEAT, burnt: ItemIds.BURNT_MEAT, level: 1, xp: 40, stopBurn: 64, name: "ugthanki meat" },
  { raw: ItemIds.RAW_HERRING, cooked: ItemIds.HERRING, burnt: ItemIds.BURNT_FISH_3, level: 5, xp: 50, stopBurn: 42, name: "herring" },
  { raw: ItemIds.RAW_GUPPY, cooked: ItemIds.GUPPY, burnt: ItemIds.RUINED_GUPPY, level: 7, xp: 12, stopBurn: 34, name: "guppy" },
  { raw: ItemIds.RAW_MACKEREL, cooked: ItemIds.MACKEREL, burnt: ItemIds.BURNT_FISH_5, level: 10, xp: 60, stopBurn: 45, name: "mackerel" },
  { raw: ItemIds.RAW_BIRD_MEAT, cooked: ItemIds.ROAST_BIRD_MEAT, burnt: ItemIds.BURNT_BIRD_MEAT, level: 11, xp: 60, stopBurn: 47, name: "bird meat" },
  { raw: ItemIds.THIN_SNAIL, cooked: ItemIds.THIN_SNAIL_MEAT, burnt: ItemIds.BURNT_SNAIL, level: 12, xp: 70, stopBurn: 38, name: "snail" },
  { raw: ItemIds.RAW_TROUT, cooked: ItemIds.TROUT, burnt: ItemIds.BURNT_FISH_3, level: 15, xp: 70, stopBurn: 50, name: "trout" },
  { raw: ItemIds.SPIDER_ON_SHAFT, cooked: ItemIds.SPIDER_ON_SHAFT_5, burnt: ItemIds.BURNT_SPIDER, level: 16, xp: 80, stopBurn: 34, name: "spider on shaft" },
  { raw: ItemIds.LEAN_SNAIL, cooked: ItemIds.LEAN_SNAIL_MEAT, burnt: ItemIds.BURNT_SNAIL, level: 17, xp: 80, stopBurn: 42, name: "snail" },
  { raw: ItemIds.RAW_COD, cooked: ItemIds.COD, burnt: ItemIds.BURNT_FISH_3, level: 18, xp: 75, stopBurn: 52, name: "cod" },
  { raw: ItemIds.RAW_PIKE, cooked: ItemIds.PIKE, burnt: ItemIds.BURNT_FISH_5, level: 20, xp: 80, stopBurn: 54, name: "pike" },
  { raw: ItemIds.RAW_CAVEFISH, cooked: ItemIds.CAVEFISH, burnt: ItemIds.RUINED_CAVEFISH, level: 20, xp: 23, stopBurn: 50, name: "cavefish" },
  { raw: ItemIds.RAW_BEAST_MEAT, cooked: ItemIds.ROAST_BEAST_MEAT, burnt: ItemIds.BURNT_BEAST_MEAT, level: 21, xp: 82.5, stopBurn: 58, name: "beast meat" },
  { raw: ItemIds.CRAB_MEAT, cooked: ItemIds.COOKED_CRAB_MEAT, burnt: ItemIds.BURNT_CRAB_MEAT, level: 21, xp: 100, stopBurn: 21, name: "crab meat" },
  { raw: ItemIds.FAT_SNAIL, cooked: ItemIds.FAT_SNAIL_MEAT, burnt: ItemIds.BURNT_SNAIL, level: 22, xp: 95, stopBurn: 45, name: "snail" },
  { raw: ItemIds.RAW_SALMON, cooked: ItemIds.SALMON, burnt: ItemIds.BURNT_FISH_3, level: 25, xp: 90, stopBurn: 58, name: "salmon" },
  { raw: ItemIds.RAW_SLIMY_EEL, cooked: ItemIds.COOKED_SLIMY_EEL, burnt: ItemIds.BURNT_EEL, level: 28, xp: 95, stopBurn: 58, name: "slimy eel" },
  { raw: ItemIds.RAW_TUNA, cooked: ItemIds.TUNA, burnt: ItemIds.BURNT_FISH_7, level: 30, xp: 100, stopBurn: 58, name: "tuna" },
  { raw: ItemIds.RAW_KARAMBWAN, cooked: ItemIds.COOKED_KARAMBWAN, burnt: ItemIds.BURNT_KARAMBWAN, level: 30, xp: 190, stopBurn: 99, name: "karambwan" },
  { raw: ItemIds.RAW_CHOMPY, cooked: ItemIds.COOKED_CHOMPY, burnt: ItemIds.BURNT_CHOMPY, level: 30, xp: 100, stopBurn: 46, name: "chompy" },
  { raw: ItemIds.RAW_TETRA, cooked: ItemIds.TETRA, burnt: ItemIds.RUINED_TETRA, level: 33, xp: 31, stopBurn: 58, name: "tetra" },
  { raw: ItemIds.RAW_RAINBOW_FISH, cooked: ItemIds.RAINBOW_FISH, burnt: ItemIds.BURNT_RAINBOW_FISH, level: 35, xp: 110, stopBurn: 65, name: "rainbow fish" },
  { raw: ItemIds.RAW_CAVE_EEL, cooked: ItemIds.CAVE_EEL, burnt: ItemIds.BURNT_CAVE_EEL, level: 38, xp: 115, stopBurn: 64, name: "cave eel" },
  { raw: ItemIds.RAW_LOBSTER, cooked: ItemIds.LOBSTER, burnt: ItemIds.BURNT_LOBSTER, level: 40, xp: 120, stopBurn: 74, name: "lobster" },
  { raw: ItemIds.RAW_JUBBLY, cooked: ItemIds.COOKED_JUBBLY, burnt: ItemIds.BURNT_JUBBLY, level: 41, xp: 160, stopBurn: 70, name: "jubbly" },
  { raw: ItemIds.RAW_BASS, cooked: ItemIds.BASS, burnt: ItemIds.BURNT_FISH_7, level: 43, xp: 130, stopBurn: 74, name: "bass" },
  { raw: ItemIds.RAW_SWORDFISH, cooked: ItemIds.SWORDFISH, burnt: ItemIds.BURNT_SWORDFISH, level: 45, xp: 140, stopBurn: 86, name: "swordfish" },
  { raw: ItemIds.RAW_CATFISH, cooked: ItemIds.CATFISH, burnt: ItemIds.RUINED_CATFISH, level: 46, xp: 43, stopBurn: 65, name: "catfish" },
  { raw: ItemIds.RAW_LAVA_EEL, cooked: ItemIds.LAVA_EEL, burnt: ItemIds.BURNT_EEL, level: 53, xp: 30, stopBurn: 53, name: "lava eel" },
  { raw: ItemIds.RAW_MONKFISH, cooked: ItemIds.MONKFISH, burnt: ItemIds.BURNT_MONKFISH, level: 62, xp: 150, stopBurn: 92, name: "monkfish" },
  { raw: ItemIds.RAW_SHARK, cooked: ItemIds.SHARK, burnt: ItemIds.BURNT_SHARK, level: 80, xp: 210, stopBurn: 94, name: "shark" },
  { raw: ItemIds.RAW_SEA_TURTLE, cooked: ItemIds.SEA_TURTLE, burnt: ItemIds.BURNT_SEA_TURTLE, level: 82, xp: 211.3, stopBurn: 99, name: "sea turtle" },
  { raw: ItemIds.RAW_ANGLERFISH, cooked: ItemIds.ANGLERFISH, burnt: ItemIds.BURNT_ANGLERFISH, level: 84, xp: 230, stopBurn: 98, name: "anglerfish" },
  { raw: ItemIds.RAW_DARK_CRAB, cooked: ItemIds.DARK_CRAB, burnt: ItemIds.BURNT_DARK_CRAB, level: 90, xp: 215, stopBurn: 99, name: "dark crab" },
  { raw: ItemIds.RAW_MANTA_RAY, cooked: ItemIds.MANTA_RAY, burnt: ItemIds.BURNT_MANTA_RAY, level: 91, xp: 216.2, stopBurn: 99, name: "manta ray" },
]);

const COOKABLE_BY_RAW = new Map(COOKABLES.map((cookable) => [cookable.raw, cookable]));

const COOKABLE_OBJECT_NAMES = new Set(["Cooking range", "Range", "Stove", "Fire"]);

function isSuccess(player, cookable) {
  const cookingLevel = player.getSkillManager().getCurrentLevel(Skill.COOKING);
  if (cookingLevel >= cookable.stopBurn) {
    return true;
  }
  if (cookable.stopBurn <= cookable.level) {
    return true;
  }

  const burnBonus = 3;
  let burnChance = 45.0 - burnBonus;
  const burnDec = burnChance / (cookable.stopBurn - cookable.level);
  burnChance -= (cookingLevel - cookable.level) * burnDec;
  const roll = Math.random() * 100.0;
  return burnChance <= roll;
}

function stopCooking(activeSessions, player, resetAnimation = true) {
  if (!activeSessions.has(player)) {
    return;
  }
  activeSessions.delete(player);
  if (resetAnimation) {
    player.performAnimation(Animation.DEFAULT_RESET_ANIMATION);
  }
}

function startCooking(player, object, cookable, activeSessions) {
  if (player.getSkillManager().getCurrentLevel(Skill.COOKING) < cookable.level) {
    player.sendMessage(`You need a Cooking level of at least ${cookable.level} to cook this.`);
    return false;
  }

  if (!player.getInventory().contains(cookable.raw)) {
    return false;
  }

  stopCooking(activeSessions, player, false);
  activeSessions.set(player, {
    cookable,
    objectId: object.getId(),
    location: object.getLocation().clone(),
    privateArea: object.getPrivateArea(),
    nextCookTick: 0,
  });

  Sounds.sendSound(player, Sound.COOKING_COOK);
  player.performAnimation(COOK_ANIMATION);
  return true;
}

class CookingTask extends Task {
  constructor(activeSessions) {
    super(1);
    this.activeSessions = activeSessions;
    this.cycle = 0;
  }

  execute() {
    this.cycle++;

    for (const [player, session] of this.activeSessions) {
      if (!player || !player.isRegistered() || player.getHitpoints() <= 0) {
        this.activeSessions.delete(player);
        continue;
      }

      if (player.getMovementQueue().size() > 0 || player.getForceMovement() != null) {
        stopCooking(this.activeSessions, player);
        continue;
      }

      if (!player.getInventory().contains(session.cookable.raw)) {
        stopCooking(this.activeSessions, player);
        continue;
      }

      const object = MapObjects.get(
        session.objectId,
        session.location,
        session.privateArea
      );
      if (!object) {
        stopCooking(this.activeSessions, player);
        continue;
      }

      if (!player.getLocation().isWithinInteractionDistance(object.getLocation())) {
        stopCooking(this.activeSessions, player);
        continue;
      }

      if (this.cycle < session.nextCookTick) {
        continue;
      }
      session.nextCookTick = this.cycle + COOK_INTERVAL_TICKS;
      Sounds.sendSound(player, Sound.COOKING_COOK);
      player.performAnimation(COOK_ANIMATION);

      player.getInventory().deleteNumber(session.cookable.raw, 1);
      if (isSuccess(player, session.cookable)) {
        player.getInventory().addItem(new Item(session.cookable.cooked, 1));
        Sounds.sendSound(player, Sound.COOKING_FOOD);
        player.sendMessage(`You cook the ${session.cookable.name}.`);
        const levelBefore = player
          .getSkillManager()
          .getMaxLevel(Skill.COOKING);
        player.getSkillManager().addExperiences(Skill.COOKING, session.cookable.xp);
        const levelAfter = player
          .getSkillManager()
          .getMaxLevel(Skill.COOKING);
        if (levelAfter > levelBefore) {
          stopCooking(this.activeSessions, player);
          continue;
        }
      } else {
        player.getInventory().addItem(new Item(session.cookable.burnt, 1));
        Sounds.sendSound(player, Sound.COOKING_BURN);
        const rawName =
          ItemDefinition.forId(session.cookable.raw)?.getName?.()?.toLowerCase?.() ||
          session.cookable.name;
        player.sendMessage(`You burn the ${rawName}.`);
      }
    }
  }
}

let TaskManager;

function handleCook(activeSessions, event) {
  const definition = event.object.getDefinition();
  const actions = definition.getInteractions() ?? [];
  if (!COOKABLE_OBJECT_NAMES.has(definition.getName())
    || (actions.some(Boolean) && !actions.includes("Cook"))) {
    return;
  }

  const cookable = COOKABLE_BY_RAW.get(event.itemId);
  if (!cookable) {
    return;
  }

  const started = startCooking(
    event.player,
    event.object,
    cookable,
    activeSessions
  );
  if (started) {
    event.handled = true;
  }
}

function handleRangeCook(activeSessions, event) {
  const item = event.player.getInventory().getItems().find((inventoryItem) =>
    inventoryItem
    && !ItemDefinition.forId(inventoryItem.getId()).isNoted()
    && COOKABLE_BY_RAW.has(inventoryItem.getId())
  );
  if (!item) {
    event.player.sendMessage("You don't have anything to cook.");
    return;
  }

  startCooking(
    event.player,
    event.object,
    COOKABLE_BY_RAW.get(item.getId()),
    activeSessions
  );
}

module.exports = {
  name: "Cooking",
  register(api) {
    TaskManager = api.getTaskManager();
    const activeSessions = new Map();
    TaskManager.submit(new CookingTask(activeSessions));

    api.onPlayerDisconnect(({ player }) => {
      stopCooking(activeSessions, player, false);
    });
    api.onPlayerLevelUp(({ player }) => {
      stopCooking(activeSessions, player, false);
    });

    api.onItemOnObject(handleCook.bind(null, activeSessions), { noted: false });
    api.onObjectInteraction("Range", { Cook: handleRangeCook.bind(null, activeSessions) });

    api.log("registered", {
      cookables: COOKABLES.length,
      cookObjectNames: COOKABLE_OBJECT_NAMES.size,
    });
  },
};
