const Pickpocket = require("./thieving/Pickpocket.Thieving");
const CoinPouch = require("./thieving/CoinPouch.Thieving");

let core;
const THIEVING_ANIMATION = 881;

const STALLS = new Map([
  [
    "Bakery stall",
    {
      petBase: 124066,
      level: 5,
      xp: 16,
      rewards: [
        ["CAKE", 1, 13],
        ["BREAD", 1, 5],
        ["CHOCOLATE_SLICE", 1, 2],
      ],
    },
  ],
  ["Silk stall", { petBase: 68926, level: 20, xp: 24, rewards: [["SILK", 1, 1]] }],
  ["Tea stall", { petBase: 68926, level: 5, xp: 16, rewards: [["CUP_OF_TEA", 1, 1]] }],
  ["Fur stall", { petBase: 36490, level: 35, xp: 45, rewards: [["GREY_WOLF_FUR", 1, 1]] }],
  [
    "Gem stall",
    {
      petBase: 36490,
      level: 75,
      xp: 408,
      rewards: [
        ["UNCUT_SAPPHIRE", 1, 105],
        ["UNCUT_EMERALD", 1, 17],
        ["UNCUT_RUBY", 1, 5],
        ["UNCUT_DIAMOND", 1, 1],
      ],
    },
  ],
  [
    "Seed Stall",
    {
      petBase: 36490,
      level: 27,
      xp: 10,
      rewards: [
        ["HAMMERSTONE_SEED", 1, 120],
        ["POTATO_SEED", 1, 119],
        ["MARIGOLD_SEED", 1, 119],
        ["BARLEY_SEED", 1, 118],
        ["ONION_SEED", 1, 89],
        ["ASGARNIAN_SEED", 1, 83],
        ["CABBAGE_SEED", 1, 71],
        ["YANILLIAN_SEED", 1, 47],
        ["ROSEMARY_SEED", 1, 36],
        ["NASTURTIUM_SEED", 1, 35],
        ["TOMATO_SEED", 1, 35],
        ["JUTE_SEED", 1, 35],
        ["SWEETCORN_SEED", 1, 30],
        ["KRANDORIAN_SEED", 1, 24],
        ["STRAWBERRY_SEED", 1, 18],
        ["WILDBLOOD_SEED", 1, 12],
        ["WATERMELON_SEED", 1, 9],
      ],
    },
  ],
]);

STALLS.set("Baker's stall", STALLS.get("Bakery stall"));
STALLS.set("Baker's Stall", STALLS.get("Bakery stall"));
STALLS.set("Gem Stall", STALLS.get("Gem stall"));

function randomReward(rewards) {
  const totalWeight = rewards.reduce((sum, [, , weight]) => sum + weight, 0);
  let roll = Math.floor(Math.random() * totalWeight);
  for (const reward of rewards) {
    roll -= reward[2];
    if (roll < 0) {
      return new core.Item(core.ItemIds[reward[0]], reward[1]);
    }
  }
  const [itemId, amount] = rewards[rewards.length - 1];
  return new core.Item(core.ItemIds[itemId], amount);
}

let pluginApi;

function handleStealFromStall(event) {
  const stall = STALLS.get(event.definition.getName());
  if (!stall) {
    return;
  }

  const player = event.player;
  if (player.getSkillManager().getCurrentLevel(core.Skill.THIEVING) < stall.level) {
    player.sendMessage(`You need a Thieving level of at least ${stall.level} to do this.`);
    event.handled = true;
    return;
  }
  if (!player.getClickDelay().elapsedTime(1000)) {
    event.handled = true;
    return;
  }
  if (player.getInventory().isFull()) {
    player.getInventory().full();
    event.handled = true;
    return;
  }

  player.getClickDelay().reset();
  player.setPositionToFace(event.object.getLocation());
  player.performAnimation(new core.Animation(THIEVING_ANIMATION));
  const reward = randomReward(stall.rewards);
  // An open gem bag takes stolen gems first ("storage:gather").
  const request = { player, itemId: reward.getId(), amount: reward.getAmount(), stored: 0 };
  pluginApi.emitCustomEvent("storage:gather", request);
  if (reward.getAmount() > request.stored) player.getInventory().addItem(new core.Item(reward.getId(), reward.getAmount() - request.stored));
  player.getSkillManager().addExperiences(core.Skill.THIEVING, stall.xp);
  player.sendMessage(`You steal ${reward.getAmount()} x ${reward.getDefinition().getName()}.`);
  pluginApi.emitCustomEvent("thieving:success", { player, skill: core.Skill.THIEVING, petBase: stall.petBase });
  event.handled = true;
}

module.exports = {
  name: "Thieving",
  members: true,
  register(api) {
    core = api.core;
    pluginApi = api;
    Pickpocket.register(api);
    CoinPouch.register(api);
    require("./thieving/Blackjacking.Thieving")(api);

    api.onObjectInteraction("Bakery stall", { "Steal-from": handleStealFromStall });
    api.onObjectInteraction("Silk stall", { "Steal-from": handleStealFromStall });
    api.onObjectInteraction("Tea stall", { "Steal-from": handleStealFromStall });
    api.onObjectInteraction("Fur stall", { "Steal-from": handleStealFromStall });
    api.onObjectInteraction("Gem stall", { "Steal-from": handleStealFromStall });
    api.onObjectInteraction("Gem Stall", { "Steal-from": handleStealFromStall });
    api.onObjectInteraction("Baker's stall", { "Steal-from": handleStealFromStall });
    api.onObjectInteraction("Baker's Stall", { "Steal-from": handleStealFromStall });
    api.onObjectInteraction("Seed Stall", { "Steal from": handleStealFromStall });
  },
};

module.exports._test = Pickpocket._test;
