/**
 * Dairy cow (a scenery loc, not a killable NPC), as per OSRS:
 *
 *   Dairy cow > Milk            empty bucket -> bucket of milk (milking animation)
 *   Dairy cow > Steal-cowbell   15 Thieving, 16 XP; success 50%@1 -> 78%@99,
 *                               stuns you on failure
 *
 * The wiki's Cowbells page requires the Cold War quest to have been started;
 * completed players may keep stealing more. The option is in the cache before
 * the quest, so the handler refuses it until stage >= 1.
 */
const { Skill } = require("../../src/main/typescript/elvarg/game/model/Skill");
const { Animation } = require("../../src/main/typescript/elvarg/game/model/Animation");
const { Location } = require("../../src/main/typescript/elvarg/game/model/Location");
const { Task } = require("../../src/main/typescript/elvarg/game/task/Task");
const { TimerKey } = require("../../src/main/typescript/elvarg/util/timers/TimerKey");
const { Sound } = require("../../src/main/typescript/elvarg/game/Sound");
const { Sounds } = require("../../src/main/typescript/elvarg/game/Sounds");
const { CombatFactory } = require("../../src/main/typescript/elvarg/game/content/combat/CombatFactory");
const { ItemIdentifiers } = require("../../src/main/typescript/elvarg/util/ItemIdentifiers");

const MILKING_ANIMATION = new Animation(2305);
const THIEVING_ANIMATION = new Animation(881);

const STEAL_LEVEL = 15;
const STEAL_XP = 16;
const STEAL_STUN_TICKS = 8;
const COLD_WAR_QUEST_KEY = "cold_war";
const COLD_WAR_REQUIRED_MESSAGE = "You need to have started Cold War to steal a cowbell.";

let TaskManager;
let pluginApi;
const milking = new WeakMap();

/** Mod Ash: 50% at level 1, 78% at level 99, interpolated. */
function stealChance(level) {
  return Math.min(0.78, 0.5 + (0.28 * (level - 1)) / 98);
}

function milkCow(event) {
  const { player } = event;
  if (!player.getInventory().containsNumber(ItemIdentifiers.BUCKET)) {
    player.sendMessage("You need an empty bucket to milk the cow.");
    return;
  }
  const from = player.getLocation().clone();
  const token = {};
  const amulet = player.getEquipment().get(pluginApi.core.Equipment.AMULET_SLOT)?.getId();
  const faster = amulet === ItemIdentifiers.COWBELL_AMULET || amulet === ItemIdentifiers.COWBELL_AMULET_2;
  milking.set(player, token);
  player.performAnimation(MILKING_ANIMATION);
  TaskManager.submit(new pluginApi.core.CountdownTask(player, faster ? 6 : 7, () => {
    if (milking.get(player) !== token) return;
    milking.delete(player);
    if (!player.isRegistered() || !player.getLocation().equals(from) ||
        !player.getInventory().containsNumber(ItemIdentifiers.BUCKET)) return;
    player.getInventory().deleteNumber(ItemIdentifiers.BUCKET, 1);
    player.getInventory().adds(ItemIdentifiers.BUCKET_OF_MILK, 1);
    player.performAnimation(Animation.DEFAULT_RESET_ANIMATION);
    player.sendMessage("You milk the cow.");
  }));
}

function coldWarStarted(player) {
  const request = { player, key: COLD_WAR_QUEST_KEY, started: false };
  pluginApi.emitCustomEvent("quest:is-started", request);
  return request.started === true;
}

function stealCowbell(event) {
  const { player } = event;
  if (!coldWarStarted(player)) {
    player.sendMessage(COLD_WAR_REQUIRED_MESSAGE);
    return;
  }
  const level = player.getSkillManager().getCurrentLevel(Skill.THIEVING);
  if (level < STEAL_LEVEL) {
    player.sendMessage(`You need a Thieving level of at least ${STEAL_LEVEL} to do this.`);
    return;
  }
  if (!player.getClickDelay().elapsedTime(1000)) return;
  if (player.getTimers().has(TimerKey.STUN)) return;
  if (player.getInventory().isFull()) {
    player.getInventory().full();
    return;
  }

  player.getMovementQueue().reset();
  player.setPositionToFace(new Location(event.location.x, event.location.y, event.location.z));
  player.performAnimation(THIEVING_ANIMATION);
  player.sendMessage("You attempt to steal a cowbell...");
  player.getClickDelay().reset();

  TaskManager.submit(new (class extends Task {
    constructor() { super(2, player); }
    execute() {
      if (player.isRegistered()) {
        if (Math.random() < stealChance(level)) {
          player.getInventory().adds(ItemIdentifiers.COWBELLS, 1);
          player.getSkillManager().addExperiences(Skill.THIEVING, STEAL_XP);
          player.sendMessage("You steal a cowbell.");
        } else {
          player.sendMessage("The cow kicks you and stuns you.");
          player.sendMessage("MOO");
          Sounds.sendSound(player, Sound.THIEVING_STUNNED);
          CombatFactory.stunTicks(player, STEAL_STUN_TICKS, true);
          player.getMovementQueue().reset();
        }
      }
      this.stop();
    }
  })());
}

module.exports = {
  name: "DairyCow",
  description: "Dairy cows: Milk fills an empty bucket, and Steal-cowbell is a 15 Thieving action unlocked once Cold War is started.",
  register(api) {
    pluginApi = api;
    TaskManager = api.getTaskManager();
    const actions = { Milk: milkCow, "Steal-cowbell": stealCowbell };
    api.onObjectInteraction("Dairy cow", actions);
    api.onObjectInteraction("Dairy Cow", actions);
    api.onItemOnObject("Bucket", "Dairy cow", milkCow, { noted: false });
    api.onItemOnObject("Bucket", "Dairy Cow", milkCow, { noted: false });
  },
};
