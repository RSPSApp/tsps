"use strict";

/**
 * The dense runestones in the Arceuus essence mine (Wiki: Dense runestone, Dense essence block;
 * rsprox captures 1669, 1670, 1672 and 3899, docs/dense-runestone.md).
 *
 * The two pillars are cache multilocs (8981 on varbit arceuus_runestone_1, 10796 on
 * arceuus_runestone_2): 0 shows the Dense runestone (Chip), 1 the Depleted runestone (Check).
 * Depletion is the player's own (Wiki: "each player has a separate instance"), so it lives in their
 * varbits, and arceuus_runestones names the depleted pillar (0 none, 1 or 2).
 *
 * Chipping needs 38 Mining, 38 Crafting, a pickaxe and a chisel. Each block takes 9 ticks whatever
 * the pickaxe: the pickaxe's swing on arrival, arceuus_chisel_essence 3 ticks later, and the block,
 * 12 Mining and 8 Crafting XP and sound 3600 on the 9th, when the swing starts again. With the
 * medium Kourend & Kebos Diary a block is two blocks 5% of the time, with a spam line and no extra
 * XP. After each block the pillar stays with the Wiki's level-banded chance; otherwise it depletes
 * that tick: its varbits, the reset animation, the respawn overlay timer (25-29 ticks in the
 * captures) and sound 2661, then it comes back when the timer ends.
 */
const CHIP_TICKS = 9;
const CHISEL_AFTER_SWING = 3;
const MINING_LEVEL = 38;
const CRAFTING_LEVEL = 38;
const MINING_XP = 12;
const CRAFTING_XP = 8;
const EXTRA_BLOCK_CHANCE = 0.05;
const RESPAWN_MIN_TICKS = 25;
const RESPAWN_MAX_TICKS = 29;

const CHIP_SOUND = 3600;
const DEPLETED_SOUND = 2661;
const REFUSAL_SOUND = 2277;
const RESPAWN_TIMER_SCRIPT = 5474; // add_overlaytimer_loc: coord, loc, shape, timer id, ticks, colour, 0
const RESPAWN_TIMER_ID = 1;
const RESPAWN_TIMER_COLOUR = 16765184;

const NEED_TOOLS = "You need a pickaxe and chisel to chip anything off this.";
const NO_SPACE = "You don't have space to chip anything off.";
const DEPLETED = "The runestone has been mined to depletion.";
const EXTRA_BLOCK = "You mined an extra block of essence thanks to your completion of the Kourend & Kebos Medium Diary.";
// Ours: no capture or Wiki line for chipping under the levels.
const NEED_LEVELS = `You need a Mining level of ${MINING_LEVEL} and a Crafting level of ${CRAFTING_LEVEL} to chip anything off this.`;

const ACTIVE_NAME = "Dense runestone";
const DEPLETED_NAME = "Depleted runestone";
const DEPLETED_STONE_VARBIT = "arceuus_runestones";
const STONES = [
  { index: 1, multiloc: "arceuus_runestone_base_1", varbit: "arceuus_runestone_1" },
  { index: 2, multiloc: "arceuus_runestone_base_2", varbit: "arceuus_runestone_2" },
];

/** Wiki (Dense runestone): the chance a pillar is still standing after a block, by Mining level band. */
const KEEP_CHANCE_BY_LEVEL = [
  [97, 0.902], [92, 0.898], [87, 0.895], [82, 0.891], [77, 0.887], [73, 0.883], [68, 0.879],
  [63, 0.875], [58, 0.871], [53, 0.867], [48, 0.863], [43, 0.859], [38, 0.855],
];

let api;
let core;
let findBestPickaxe;
let xpMultiplier;
let chiselSequence = null;
const sessions = new Map();
const respawns = new WeakMap();

function varbitId(name) {
  return core.CacheDefinitions.getVarbitId(name);
}

function varbit(player, name) {
  return player.getPacketSender().getVarbit(varbitId(name));
}

function setVarbit(player, name, value) {
  player.getPacketSender().sendVarbit(varbitId(name), value);
}

function stoneFor(objectId) {
  return STONES.find((stone) => core.CacheDefinitions.getLocId(stone.multiloc) === objectId) ?? null;
}

function keepChance(level) {
  return (KEEP_CHANCE_BY_LEVEL.find(([from]) => level >= from) ?? KEEP_CHANCE_BY_LEVEL.at(-1))[1];
}

function respawnTicks(random = Math.random) {
  return RESPAWN_MIN_TICKS + Math.floor(random() * (RESPAWN_MAX_TICKS - RESPAWN_MIN_TICKS + 1));
}

function messageBox(player, text, sound) {
  if (sound) player.getPacketSender().sendSoundEffect(sound, 1, 0, 1);
  const { DialogueChainBuilder, StatementDialogue } = core;
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(new StatementDialogue(0, text)));
}

/** rsprox capture 1670 tick 13: objectbox_double with a bronze pickaxe and a chisel. */
function needTools(player) {
  player.getPacketSender().sendSoundEffect(REFUSAL_SOUND, 1, 0, 1);
  const { DialogueChainBuilder, DoubleItemStatementDialogue, ItemIdentifiers } = core;
  player.getDialogueManager().startDialogues(new DialogueChainBuilder()
    .add(new DoubleItemStatementDialogue(0, ItemIdentifiers.BRONZE_PICKAXE, ItemIdentifiers.CHISEL, NEED_TOOLS)));
}

function kourendMediumComplete(player) {
  const request = { player, diary: "kourend", tier: "medium", complete: false };
  api.emitCustomEvent("diary:is-complete", request);
  return request.complete === true;
}

function chiselAnimation() {
  chiselSequence ??= new core.Animation(core.CacheDefinitions.getSeqId("arceuus_chisel_essence"));
  return chiselSequence;
}

function level(player, skill) {
  return player.getSkillManager().getCurrentLevel(skill);
}

function stop(player) {
  sessions.delete(player);
}

function interrupt({ player }) {
  stop(player);
}

function stillChipping(player, session) {
  return sessions.get(player) === session && player.isRegistered() && player.getHitpoints() > 0
    && !player.isDyingReturn?.() && varbit(player, session.stone.varbit) === 0
    && session.object.isWithinInteractionDistance(player.getLocation());
}

function sendRespawnTimer(player, object, ticks) {
  const location = object.getLocation();
  const coordinate = (location.getZ() << 28) | (location.getX() << 14) | location.getY();
  player.getPacketSender().sendClientScript(RESPAWN_TIMER_SCRIPT, coordinate, object.getId(), object.getType(),
    RESPAWN_TIMER_ID, ticks, RESPAWN_TIMER_COLOUR, 0);
}

function restore(player, stone) {
  respawns.get(player)?.delete(stone.index);
  setVarbit(player, stone.varbit, 0);
  if (varbit(player, DEPLETED_STONE_VARBIT) === stone.index) setVarbit(player, DEPLETED_STONE_VARBIT, 0);
}

function scheduleRespawn(player, stone, ticks) {
  const token = {};
  if (!respawns.has(player)) respawns.set(player, new Map());
  respawns.get(player).set(stone.index, token);
  core.TaskManager.submit(new (class extends core.Task {
    constructor() {
      super(ticks);
    }
    execute() {
      this.stop();
      if (player.isRegistered() && respawns.get(player)?.get(stone.index) === token) restore(player, stone);
    }
  })());
}

/**
 * The pillar runs out. arceuus_runestones holds one pillar, and no capture shows both depleted, so
 * the other comes back now if it was still out (Ours: the captures never deplete one while the
 * other is out).
 */
function deplete(player, session, random) {
  const { stone, object } = session;
  for (const other of STONES) {
    if (other !== stone && varbit(player, other.varbit) !== 0) restore(player, other);
  }
  setVarbit(player, stone.varbit, 1);
  setVarbit(player, DEPLETED_STONE_VARBIT, stone.index);
  player.performAnimation(core.Animation.DEFAULT_RESET_ANIMATION);
  const ticks = respawnTicks(random);
  sendRespawnTimer(player, object, ticks);
  player.getPacketSender().sendSoundEffect(DEPLETED_SOUND, 1, 0, 1);
  scheduleRespawn(player, stone, ticks);
  stop(player);
}

/** One block (two, 5% of the time, with the medium diary), its XP and the depletion roll. */
function chipBlock(player, session, random = Math.random) {
  const inventory = player.getInventory();
  if (inventory.getFreeSlots() <= 0) {
    stop(player);
    messageBox(player, NO_SPACE, REFUSAL_SOUND);
    return;
  }
  let blocks = 1;
  if (kourendMediumComplete(player) && random() < EXTRA_BLOCK_CHANCE) {
    blocks = 2;
    player.getPacketSender().sendTypedMessage(core.ChatType.SPAM, EXTRA_BLOCK);
  }
  inventory.adds(core.ItemIdentifiers.DENSE_ESSENCE_BLOCK, Math.min(blocks, inventory.getFreeSlots()));
  inventory.refreshItems();
  player.getPacketSender().sendSoundEffect(CHIP_SOUND, 1, 0, 1);
  player.getSkillManager().addExperiences(core.Skill.MINING, MINING_XP * xpMultiplier(player));
  player.getSkillManager().addExperiences(core.Skill.CRAFTING, CRAFTING_XP);
  if (random() >= keepChance(level(player, core.Skill.MINING))) {
    deplete(player, session, random);
    return;
  }
  player.performAnimation(session.pickaxe.animation);
}

/** One tick of a session: the swing, the chisel 3 ticks on, and a block every 9 ticks. */
function tickSession(player, session, random = Math.random) {
  if (!stillChipping(player, session)) {
    stop(player);
    return false;
  }
  const tick = ++session.tick;
  const phase = (tick - 1) % CHIP_TICKS;
  if (phase === 0) {
    if (tick === 1) player.performAnimation(session.pickaxe.animation);
    else chipBlock(player, session, random);
  } else if (phase === CHISEL_AFTER_SWING) {
    player.performAnimation(chiselAnimation());
  }
  return sessions.get(player) === session;
}

function startSession(player, stone, object, pickaxe) {
  const session = { stone, object, pickaxe, tick: 0 };
  sessions.set(player, session);
  core.TaskManager.submit(new (class extends core.Task {
    constructor() {
      super(1, player.getIndex());
    }
    execute() {
      if (!tickSession(player, session)) this.stop();
    }
  })());
  return session;
}

function chip(event) {
  const { player, object } = event;
  const stone = stoneFor(object.getId());
  if (!stone) return false;
  event.handled = true;
  const pickaxe = findBestPickaxe(player);
  if (!pickaxe || !player.getInventory().contains(core.ItemIdentifiers.CHISEL)) {
    needTools(player);
    return true;
  }
  if (level(player, core.Skill.MINING) < MINING_LEVEL || level(player, core.Skill.CRAFTING) < CRAFTING_LEVEL) {
    messageBox(player, NEED_LEVELS);
    return true;
  }
  if (player.getInventory().getFreeSlots() <= 0) {
    messageBox(player, NO_SPACE, REFUSAL_SOUND);
    return true;
  }
  stop(player);
  startSession(player, stone, object, pickaxe);
  return true;
}

function check(event) {
  if (!stoneFor(event.object.getId())) return false;
  event.handled = true;
  messageBox(event.player, DEPLETED, DEPLETED_SOUND);
  return true;
}

function attach(pluginApi, helpers) {
  api = pluginApi;
  core = pluginApi.core;
  findBestPickaxe = helpers.findBestPickaxe;
  xpMultiplier = helpers.xpMultiplier;
  api.onObjectInteraction(ACTIVE_NAME, { Chip: chip });
  api.onObjectInteraction(DEPLETED_NAME, { Check: check });
  api.onCustomEvent("player:interaction-cleared", interrupt);
  api.onCustomEvent("player:emote", interrupt);
}

module.exports = {
  attach,
  _test: { chip, check, tickSession, chipBlock, keepChance, respawnTicks, sessions, STONES, CHIP_TICKS },
};
