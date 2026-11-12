/**
 * Dairy cow (a scenery loc, not a killable NPC), as per OSRS:
 *
 *   Dairy cow > Milk            empty bucket -> bucket of milk (milking animation); with no
 *                               empty bucket, a bottomless milk bucket fills a use every 7 ticks
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
const STUNNED_THIEVING_GRAPHIC = 245;
const COLD_WAR_QUEST_KEY = "cold_war";
// rsprox 227/00090.txt:200368, 232/00424.txt:88405.
const NO_BUCKET_MESSAGE = "You'll need an empty bucket to collect the milk.";
const BOTTOMLESS_FULL_MESSAGE = "Your bottomless milk bucket, surprisingly, is full.";
const COLD_WAR_REQUIRED_MESSAGE = "You need to have started Cold War to steal a cowbell.";

let TaskManager;
let pluginApi;
const milking = new WeakMap();

/** Mod Ash: 50% at level 1, 78% at level 99, interpolated. */
function stealChance(level) {
  return Math.min(0.78, 0.5 + (0.28 * (level - 1)) / 98);
}

function wearsCowbell(player) {
  const amulet = player.getEquipment().get(pluginApi.core.Equipment.AMULET_SLOT)?.getId();
  return amulet === ItemIdentifiers.COWBELL_AMULET || amulet === ItemIdentifiers.COWBELL_AMULET_2;
}

function milkCow(event) {
  const { player } = event;
  if (!player.getInventory().containsNumber(ItemIdentifiers.BUCKET)) {
    milkIntoBottomless(player);
    return;
  }
  const from = player.getLocation().clone();
  const token = {};
  const faster = wearsCowbell(player);
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
    // rsprox: a spam line (10 recordings).
    player.getPacketSender().sendTypedMessage(pluginApi.core.ChatType.SPAM, "You milk the cow.");
  }));
}

/**
 * Wiki (Bottomless milk bucket): with no empty bucket, a bottomless milk bucket fills from the
 * cow a use every 7 ticks (6 with the cowbell amulet) until it is full or the player stops.
 */
function milkIntoBottomless(player) {
  const request = { player, bucket: null, full: false };
  pluginApi.emitCustomEvent("bottomless-milk:fillable", request);
  if (!request.bucket) {
    player.sendMessage(request.full ? BOTTOMLESS_FULL_MESSAGE : NO_BUCKET_MESSAGE);
    return;
  }
  const from = player.getLocation().clone();
  const token = {};
  milking.set(player, token);
  player.performAnimation(MILKING_ANIMATION);
  TaskManager.submit(new (class extends Task {
    constructor() { super(wearsCowbell(player) ? 6 : 7, player); }
    execute() {
      if (milking.get(player) !== token || !player.isRegistered() || !player.getLocation().equals(from)) {
        this.stop();
        return;
      }
      const added = { player, bucket: request.bucket, added: false, full: false };
      pluginApi.emitCustomEvent("bottomless-milk:add-milk", added);
      if (!added.added || added.full) {
        milking.delete(player);
        player.performAnimation(Animation.DEFAULT_RESET_ANIMATION);
        if (added.full) player.sendMessage(BOTTOMLESS_FULL_MESSAGE);
        this.stop();
        return;
      }
      player.performAnimation(MILKING_ANIMATION);
    }
  })());
}

/** Using the bottomless bucket itself on the cow fills it even with an empty bucket carried. */
function bottomlessOnCow(event) {
  milkIntoBottomless(event.player);
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
          // rsprox 227/00075.txt:338001-338002, :338122-338123 (Leagues V): both lines, then the cow's
          // "MOO" as a chathead line two ticks later (not modelled: the cow is a loc, not an NPC).
          player.sendMessage("You fail to steal a cowbell.");
          player.sendMessage("The cow kicks you and stuns you!");
          Sounds.sendSound(player, Sound.THIEVING_STUNNED);
          // As recorded: stunned_thieving (245) at height 124, and no "You've been stunned!" line.
          CombatFactory.stunTicks(player, STEAL_STUN_TICKS, true, { graphic: new pluginApi.core.Graphic(STUNNED_THIEVING_GRAPHIC, 0, 124), message: false });
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
    api.onItemOnObject("Bottomless milk bucket", "Dairy cow", bottomlessOnCow);
    api.onItemOnObject("Bottomless milk bucket", "Dairy Cow", bottomlessOnCow);
    api.onItemOnObject("Bottomless milk bucket (empty)", "Dairy cow", bottomlessOnCow);
    api.onItemOnObject("Bottomless milk bucket (empty)", "Dairy Cow", bottomlessOnCow);
  },
};
