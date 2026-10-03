const { Skill } = require("../../src/main/typescript/elvarg/game/model/Skill");
const { Item } = require("../../src/main/typescript/elvarg/game/model/Item");
const { Animation } = require("../../src/main/typescript/elvarg/game/model/Animation");
const { Task } = require("../../src/main/typescript/elvarg/game/task/Task");
const { HitDamage } = require("../../src/main/typescript/elvarg/game/content/combat/hit/HitDamage");
const { HitMask } = require("../../src/main/typescript/elvarg/game/content/combat/hit/HitMask");
const { Sound } = require("../../src/main/typescript/elvarg/game/Sound");
const { Sounds } = require("../../src/main/typescript/elvarg/game/Sounds");
const { TimerKey } = require("../../src/main/typescript/elvarg/util/timers/TimerKey");
const { ItemIds } = require("../../src/main/typescript/elvarg/util/IdEnums");
const { ArceuusSpells } = require("../../src/main/typescript/elvarg/game/content/combat/magic/ArceuusSpells");

const THIEVING_ANIMATION = new Animation(881);
const PICKPOCKET_COOLDOWN_MS = 1200;

class PickpocketResolveTask extends Task {
  constructor(player, onResolve) {
    super(2, player.getIndex());
    this.player = player;
    this.location = player.getLocation().clone();
    this.onResolve = onResolve;
  }

  canResolve() {
    return this.player.isRegistered() && this.player.getHitpoints() > 0 &&
      this.player.getLocation().equals(this.location) && this.player.getMovementQueue().size() === 0 &&
      this.player.getForceMovement() == null;
  }

  execute() {
    if (this.canResolve()) this.onResolve();
    this.stop();
  }

  onTick() {
    if (!this.canResolve()) this.stop();
  }

  stop() {
    super.stop();
    if (this.player.isRegistered()) this.player.performAnimation(Animation.DEFAULT_RESET_ANIMATION);
  }
}

const PICKPOCKETS = [
  {
    name: "Man",
    petBase: 257211,
    level: 1,
    xp: 8,
    stunTime: 8,
    stunDamage: 1,
    rewards: [[ItemIds.COINS, 3]],
  },
  {
    name: "Farmer",
    petBase: 257211,
    level: 10,
    xp: 14.5,
    stunTime: 8,
    stunDamage: 1,
    rewards: [[ItemIds.COINS, 9], [ItemIds.POTATO_SEED, 1]],
  },
  {
    name: "Rogue",
    petBase: 257211,
    level: 32,
    xp: 36.5,
    stunTime: 9,
    stunDamage: 2,
    rewards: [[ItemIds.COINS, 34], [ItemIds.LOCKPICK, 1], [ItemIds.JUG_OF_WINE, 1]],
  },
  {
    name: "Master Farmer",
    petBase: 257211,
    level: 38,
    xp: 43,
    stunTime: 9,
    stunDamage: 3,
    rewards: [[ItemIds.POTATO_SEED, 1], [ItemIds.ONION_SEED, 1], [ItemIds.MARRENTILL_SEED, 1], [ItemIds.RANARR_SEED, 1]],
  },
  {
    name: "Guard",
    petBase: 257211,
    level: 40,
    xp: 47,
    stunTime: 9,
    stunDamage: 2,
    rewards: [[ItemIds.COINS, 30]],
  },
  {
    name: "Paladin",
    petBase: 127056,
    level: 70,
    xp: 152,
    stunTime: 10,
    stunDamage: 3,
    rewards: [[ItemIds.COINS, 80], [ItemIds.CHAOS_RUNE, 2]],
  },
  {
    name: "Gnome",
    petBase: 108718,
    level: 75,
    xp: 199,
    stunTime: 10,
    stunDamage: 1,
    rewards: [[ItemIds.COINS, 300], [ItemIds.GOLD_ORE, 1], [ItemIds.EARTH_RUNE, 1]],
  },
];

const PICKPOCKET_BY_NAME = new Map(PICKPOCKETS.map((entry) => [entry.name, entry]));
PICKPOCKET_BY_NAME.set("Woman", PICKPOCKET_BY_NAME.get("Man"));

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

function pickpocketSucceeded(player, def) {
  const level = player.getSkillManager().getCurrentLevel(Skill.THIEVING);
  const factor = Math.floor(Math.random() * (level + 5));
  const fluke = Math.floor(Math.random() * (def.level + 1));
  return factor > fluke;
}

let TaskManager;
let CombatFactory;
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

function pickpocket(event) {
  const { player, npc } = event;
  const def = PICKPOCKET_BY_NAME.get(event.definition.getName());
  if (!def) {
    return;
  }

  if (!player.getClickDelay().elapsedTime(PICKPOCKET_COOLDOWN_MS)) {
    event.handled = true;
    return;
  }
  if (player.getSkillManager().getCurrentLevel(Skill.THIEVING) < def.level) {
    player.sendMessage(`You need a Thieving level of at least ${def.level} to do this.`);
    event.handled = true;
    return;
  }
  if (player.getTimers().has(TimerKey.STUN)) {
    event.handled = true;
    return;
  }
  if (CombatFactory.inCombat(player)) {
    player.sendMessage("You must wait a few seconds after being in combat to do this.");
    event.handled = true;
    return;
  }
  if (CombatFactory.inCombat(npc)) {
    player.sendMessage("That npc is currently in combat and cannot be pickpocketed.");
    event.handled = true;
    return;
  }
  if (player.getInventory().isFull()) {
    player.getInventory().full();
    event.handled = true;
    return;
  }

  player.getMovementQueue().reset();
  player.setPositionToFace(npc.getLocation());
  player.performAnimation(THIEVING_ANIMATION);
  player.sendMessage("You attempt to pick the npc's pocket..");
  player.getClickDelay().reset();
  npc.getTimers().registers(TimerKey.ATTACK_IMMUNITY, 10);

  TaskManager.submit(
    new PickpocketResolveTask(player, () => {
      if (!player.isRegistered() || !npc.isRegistered()) {
        return;
      }

      if (pickpocketSucceeded(player, def)) {
        const loot = randomReward(def.rewards);
        if (!player.getInventory().isFull()) {
          player.getInventory().addItem(loot);
        }
        player.sendMessage(`You steal ${loot.getAmount()} x ${loot.getDefinition().getName()}.`);
        player.getSkillManager().addExperiences(Skill.THIEVING, def.xp);
        pluginApi.emitCustomEvent("thieving:success", { player, skill: Skill.THIEVING, petBase: def.petBase });
        return;
      }

      if (ArceuusSpells.hasShadowVeil(player) && Math.random() < 0.15) {
        player.sendMessage("Your shadow veil prevents you from being noticed.");
        return;
      }

      npc.setPositionToFace(player.getLocation());
      npc.forceChat("What do you think you're doing?");
      npc.performAnimation(new Animation(npc.getAttackAnim()));
      player.sendMessage("You fail to pick the pocket.");
      Sounds.sendSound(player, Sound.THIEVING_STUNNED);
      CombatFactory.stun(player, def.stunTime, true);
      player
        .getCombat()
        .getHitQueue()
        .addPendingDamage([new HitDamage(def.stunDamage, HitMask.RED)]);
      player.getMovementQueue().reset();
    })
  );

  event.handled = true;
}

module.exports = {
  name: "Thieving",
  members: true,
  register(api) {
    pluginApi = api;
    TaskManager = api.getTaskManager();
    CombatFactory = api.getCombatFactory();
    for (const name of PICKPOCKET_BY_NAME.keys()) {
      api.onNpcInteraction(name, { Pickpocket: pickpocket });
    }

    for (const name of STALLS.keys()) {
      api.onObjectInteraction(name, { [name === "Seed Stall" ? "Steal from" : "Steal-from"]: handleStealFromStall });
    }

    api.log("registered", {
      pickpocketNames: PICKPOCKET_BY_NAME.size,
      stallNames: STALLS.size,
    });
  },
};
