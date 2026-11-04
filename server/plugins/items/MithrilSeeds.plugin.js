"use strict";

const FLOWER_LIFETIME_TICKS = 499;
const PLANT_MESSAGE = "You open the small mithril case.<br>You drop a seed by your feet.";
const PICK_MESSAGE = "Your inventory is too full to hold any more.";
const PICK_ANIMATION_ID = 827;
const DIRECTIONS = [
  { x: -1, y: 0 },
  { x: 1, y: 0 },
  { x: 0, y: -1 },
  { x: 0, y: 1 },
];
const REWARDS = [
  ["MIXED_FLOWERS", 150],
  ["RED_FLOWERS", 150],
  ["YELLOW_FLOWERS", 150],
  ["BLUE_FLOWERS", 150],
  ["ORANGE_FLOWERS", 150],
  ["PURPLE_FLOWERS", 148],
  ["ASSORTED_FLOWERS", 100],
  ["BLACK_FLOWERS", 2],
  ["WHITE_FLOWERS", 1],
];

let core;
const flowers = new WeakMap();

function removeFlower(object) {
  const state = flowers.get(object);
  if (!state?.active) return;
  state.active = false;
  flowers.delete(object);
  core.ObjectManager.deregister(object, true);
}

function expiryTask(object) {
  return new (class MithrilSeedFlowerExpiryTask extends core.Task {
    constructor() {
      super(FLOWER_LIFETIME_TICKS);
    }

    execute() {
      this.stop();
      removeFlower(object);
    }
  })();
}

function rollReward() {
  let roll = Math.floor(Math.random() * 1001);
  for (const [key, weight] of REWARDS) {
    if (roll < weight) return core.ItemIdentifiers[key];
    roll -= weight;
  }
  return core.ItemIdentifiers.WHITE_FLOWERS;
}

function chooseFlowers(player, object, option) {
  player.getDialogueManager().reset();
  player.getPacketSender().sendInterfaceRemoval();

  const state = flowers.get(object);
  if (!state?.active || state.owner !== player || !state.choiceOpen) return;
  if (Number(option) !== 1) {
    state.choiceOpen = false;
    return;
  }
  if (player.getInventory().getFreeSlots() <= 0) {
    player.sendMessage(PICK_MESSAGE);
    openFlowerChoice(player, object);
    return;
  }

  state.choiceOpen = false;
  player.performAnimation(new core.Animation(PICK_ANIMATION_ID));
  player.getInventory().adds(rollReward(), 1);
  removeFlower(object);
}

function openFlowerChoice(player, object) {
  player.getDialogueManager().startDialogues(new core.DialogueChainBuilder().add(
    new core.OptionDialogue(0, {
      executeOption(option) {
        chooseFlowers(player, object, option);
      },
    }, "Pick the flowers.", "Leave the flowers."),
  ));
}

function pickMithrilFlowers({ player, object }) {
  if (object?.getId?.() !== core.ObjectIdentifiers.FLOWERS_12 || !flowers.has(object)) return false;
  // Mithril flowers can only be picked through the planter's one-time dialogue choice.
  return true;
}

function hasObjectsAt(player, location) {
  const privateArea = player.getPrivateArea();
  const scenery = core.MapObjects.getObjectsAt(location, privateArea);
  const runtimeObjects = core.ObjectManager.objectsAt(location).some(
    (object) => object.getPrivateArea() === privateArea,
  );
  return scenery.length > 0 || runtimeObjects;
}

function plant({ player, item, itemId, slot }) {
  const inventory = player.getInventory();
  const seed = inventory.getItems()[slot];
  if (!seed || seed !== item || seed.getId() !== itemId || seed.getAmount() <= 0) return false;

  const plantedAt = player.getLocation().clone();
  if (hasObjectsAt(player, plantedAt)
      || player.getLocalNpcs().some((npc) => npc?.getLocation?.().equals(plantedAt))) {
    player.sendMessage("You cannot plant a seed right here.");
    return true;
  }

  const movement = player.getMovementQueue();
  movement.reset();
  const flower = new core.GameObject(
    core.ObjectIdentifiers.FLOWERS_12,
    plantedAt.clone(),
    10,
    0,
    player.getPrivateArea(),
  );

  inventory.deleteNumber(seed.getId(), 1);
  player.getSkillManager().stopSkillable();
  core.ObjectManager.register(flower, true);
  flowers.set(flower, { owner: player, active: true, choiceOpen: true });
  core.TaskManager.submit(expiryTask(flower));

  for (const direction of DIRECTIONS) {
    if (movement.walkStepIgnoringFreeze(direction.x, direction.y)) break;
  }
  player.setPositionToFace(plantedAt);
  player.sendMessage(PLANT_MESSAGE);
  openFlowerChoice(player, flower);
  return true;
}

module.exports = {
  name: "MithrilSeeds",
  members: true,
  register(api) {
    core = api.core;
    api.onItemAction("Mithril seeds", { Plant: plant });
    api.onObjectInteraction("Flowers", { Pick: pickMithrilFlowers });
  },
};
