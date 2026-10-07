const { Skill } = require("../../src/main/typescript/elvarg/game/model/Skill");
const { Item } = require("../../src/main/typescript/elvarg/game/model/Item");
const { Animation } = require("../../src/main/typescript/elvarg/game/model/Animation");
const { ItemIds } = require("../../src/main/typescript/elvarg/util/IdEnums");
const Pickpocket = require("./thieving/Pickpocket.Thieving");
const CoinPouch = require("./thieving/CoinPouch.Thieving");

const THIEVING_ANIMATION = new Animation(881);

const STALLS = new Map([
  ["Bakery stall", { petBase: 124066, level: 5, xp: 16, rewards: [[ItemIds.COINS, 20]] }],
  ["Silk stall", { petBase: 68926, level: 20, xp: 24, rewards: [[ItemIds.COINS, 60]] }],
  ["Tea stall", { petBase: 68926, level: 5, xp: 16, rewards: [[ItemIds.COINS, 20]] }],
  ["Fur stall", { petBase: 36490, level: 35, xp: 36, rewards: [[ItemIds.COINS, 100]] }],
  ["Gem stall", { petBase: 36490, level: 75, xp: 160, rewards: [[ItemIds.UNCUT_SAPPHIRE, 1], [ItemIds.UNCUT_EMERALD, 1]] }],
  ["Seed Stall", { petBase: 36490, level: 27, xp: 10, rewards: [[ItemIds.POTATO_SEED, 1], [ItemIds.ONION_SEED, 1]] }],
]);

STALLS.set("Baker's stall", STALLS.get("Bakery stall"));
STALLS.set("Baker's Stall", STALLS.get("Bakery stall"));
STALLS.set("Gem Stall", STALLS.get("Gem stall"));

function randomReward(rewards) {
  const [itemId, maxAmount] = rewards[Math.floor(Math.random() * rewards.length)];
  const amount = Math.max(1, Math.floor(Math.random() * maxAmount) + 1);
  return new Item(itemId, amount);
}

let pluginApi;

function handleStealFromStall(event) {
  const stall = STALLS.get(event.definition.getName());
  if (!stall) {
    return;
  }

  const player = event.player;
  if (player.getSkillManager().getCurrentLevel(Skill.THIEVING) < stall.level) {
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
  player.performAnimation(THIEVING_ANIMATION);
  const reward = randomReward(stall.rewards);
  player.getInventory().addItem(reward);
  player.getSkillManager().addExperiences(Skill.THIEVING, stall.xp);
  player.sendMessage(`You steal ${reward.getAmount()} x ${reward.getDefinition().getName()}.`);
  pluginApi.emitCustomEvent("thieving:success", { player, skill: Skill.THIEVING, petBase: stall.petBase });
  event.handled = true;
}

module.exports = {
  name: "Thieving",
  members: true,
  register(api) {
    pluginApi = api;
    Pickpocket.register(api);
    CoinPouch.register(api);

    for (const name of STALLS.keys()) {
      api.onObjectInteraction(name, { [name === "Seed Stall" ? "Steal from" : "Steal-from"]: handleStealFromStall });
    }

    api.log("registered", {
      pickpocketTargets: Pickpocket.TARGETS.length,
      stallNames: STALLS.size,
    });
  },
};

module.exports._test = Pickpocket._test;
