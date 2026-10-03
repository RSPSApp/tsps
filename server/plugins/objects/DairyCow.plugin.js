/**
 * Dairy cow (a scenery loc, not a killable NPC), as per OSRS:
 *
 *   Dairy cow > Milk            empty bucket -> bucket of milk (milking animation)
 *   Dairy cow > Steal-cowbell   15 Thieving, 16 XP; success 50%@1 -> 78%@99,
 *                               stuns you on failure
 *
 * The Cold War quest gate on stealing isn't modelled (this server has no Cold
 * War); the Thieving level requirement is enforced.
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

let TaskManager;

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
  player.performAnimation(MILKING_ANIMATION);
  player.getInventory().deleteNumber(ItemIdentifiers.BUCKET, 1);
  player.getInventory().adds(ItemIdentifiers.BUCKET_OF_MILK, 1);
  player.sendMessage("You milk the cow.");
}

function stealCowbell(event) {
  const { player } = event;
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
          CombatFactory.stun(player, STEAL_STUN_TICKS, true);
          player.getMovementQueue().reset();
        }
      }
      this.stop();
    }
  })());
}

module.exports = {
  name: "DairyCow",
  register(api) {
    TaskManager = api.getTaskManager();
    const actions = { Milk: milkCow, "Steal-cowbell": stealCowbell };
    api.onObjectInteraction("Dairy cow", actions);
    api.onObjectInteraction("Dairy Cow", actions);
  },
};
