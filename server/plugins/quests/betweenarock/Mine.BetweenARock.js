/**
 * Between a Rock...: inside the rock, as the user's rsprox capture BetweenARock.bin (rev 242.1) has it
 * (plugins/quests/data/between-a-rock.json; docs/quests/between-a-rock/README.md).
 *
 * - The helmet's time: dwarfrock_inside_timeleft starts at 800 when the warning box is continued
 *   and drops by 25 every 25 ticks, each warning message coming as it reaches its value. At 0 the
 *   helmet comes off.
 * - Taking the helmet off (or the time running out) ends the visit: "The world turns black...",
 *   the player is outside next to Dondakan, and any gold ore they carried is gone, with its box six
 *   ticks later (3679, 5751-5757).
 * - The Being speaks up while the player mines gold, the room shaking (cam_shake, demon_shakeroom),
 *   the camera back as its line goes (3381-3454). Ours: one in two gold ores.
 * - The gold rocks and veins come back after 9 ticks in here (3379-3388, 3389-3398).
 * - Wall of flame, Jump-through: a leap over it (human_longjump, fire_jump, "You close your eyes and
 *   leap through the flames! Ouch!"), held for 23 ticks, then 5 damage; the two recorded jumps into the
 *   Being's ring pan the camera. The flames in the centre are "too hot"; Talk-to on them is the Being.
 * - After the Being's speech the Avatar appears at 2375,4951 with a hint arrow (3574). Killing it
 *   takes the player out at once with the quest at its next step; a helmet that does not fit the
 *   inventory is dropped there (5751).
 */
const DATA = require("../data/between-a-rock.json");

const TIMER_VARBIT = 309; // dwarfrock_inside_timeleft
const BUSY_VARBIT = 12393;
const TIMER_ATTRIBUTE = "quest.between_a_rock.helmet-time";
const TAUNT_CHANCE = 0.5;
const GOLD_ABSORBED_DELAY = 6;
const GOLD_ABSORBED = "You suddenly notice all the gold in your inventory has disappeared! It must have been absorbed into the rock!";
const SUCKED_OUT = "The world turns black and you feel as if you're being sucked out of the rock.";
const HELMET_DROPPED = "You don't have any space in your inventory, so you drop your helmet.";
const ARZINIAN_MINE = { minX: 2300, maxX: 2431, minY: 4920, maxY: 5010, z: 0 };
const CENTRE_FLAMES = new Set(["dwarf_firewall_centre_straight", "dwarf_firewall_centre_diagonal"]);
const ROCKS = new Set(["Gold rocks", "Gold vein"]);
const SHAKE = [0, 10, 0, 0];
const SHAKE_SOUND = 1405;
const FIRE_JUMP_SOUND = 1407;

let api;
let core;
let ctx;
/** Players inside with the timer running -> { ticks }. */
const timers = new WeakMap();
/** Players mid-leap -> that leap (its tasks do nothing once it is not the player's current one). */
const leaping = new WeakMap();

function inside(player) {
  const at = player.getLocation?.();
  if (!at) return false;
  return at.getZ() === ARZINIAN_MINE.z && at.getX() >= ARZINIAN_MINE.minX && at.getX() <= ARZINIAN_MINE.maxX
    && at.getY() >= ARZINIAN_MINE.minY && at.getY() <= ARZINIAN_MINE.maxY;
}

function questInside(player) {
  return ctx.stageOf(player) === ctx.stages.MINE && !ctx.quest.isComplete(player);
}

// ----------------------------------------------------------------------------
// The helmet's time
// ----------------------------------------------------------------------------

function startTimer(player) {
  timers.set(player, { ticks: 0 });
  player.setAttribute(TIMER_ATTRIBUTE, DATA.timer.start);
  player.getPacketSender().sendVarbit(TIMER_VARBIT, DATA.timer.start).sendVarbit(BUSY_VARBIT, 0);
}

function stopTimer(player) {
  timers.delete(player);
  player.setAttribute(TIMER_ATTRIBUTE, 0);
}

function timeLeft(player) {
  return Number(player.getAttribute(TIMER_ATTRIBUTE)) || 0;
}

function tickTimer(player) {
  const timer = timers.get(player);
  if (!timer) return;
  timer.ticks++;
  if (timer.ticks % DATA.timer.step !== 0) return;
  const left = Math.max(0, timeLeft(player) - DATA.timer.step);
  player.setAttribute(TIMER_ATTRIBUTE, left);
  player.getPacketSender().sendVarbit(TIMER_VARBIT, left);
  const message = DATA.timer.messages.find(([at]) => at === left);
  if (message) player.sendMessage(message[1]);
  if (left === 0) {
    player.sendMessage(DATA.timer.end);
    leave(player, { helmetOff: true });
  }
}

// ----------------------------------------------------------------------------
// Leaving
// ----------------------------------------------------------------------------

/**
 * Out of the rock: the helmet off (into the inventory, or dropped on the landing tile when it is
 * full), the gold ore gone, outside next to Dondakan.
 */
function leave(player, { helmetOff = false, killed = false } = {}) {
  stopTimer(player);
  // A leap in progress ends here: its landing and its damage would put the player back inside.
  if (leaping.has(player)) {
    leaping.delete(player);
    player.setForceMovement?.(null);
    player.getPacketSender().sendVarbit(BUSY_VARBIT, 0);
  }
  // A box still up (the helmet's warning) goes with the visit.
  player.getDialogueManager().reset?.();
  player.getPacketSender().sendInterfaceRemoval();
  ctx.removeAvatar(player);
  const equipment = player.getEquipment();
  const [x, y] = killed ? DATA.exits.avatarKilled : DATA.exits.helmetOff;
  const landing = new core.Location(x, y, 0);
  let dropHelmet = false;
  if (ctx.wearingHelmet(player)) {
    equipment.setItem(core.Equipment.HEAD_SLOT, new core.Item(-1, 0));
    equipment.refreshItems?.();
    player.getUpdateFlag?.().flag(core.Flag.APPEARANCE);
    if (player.getInventory().isFull()) {
      dropHelmet = true;
      player.sendMessage(HELMET_DROPPED);
    } else {
      player.getInventory().add(new core.Item(ctx.ids.goldHelmet, 1));
    }
  }
  player.sendMessage(SUCKED_OUT);
  const gold = player.getInventory().getAmount(ctx.ids.goldOre);
  if (gold > 0) player.getInventory().deleteNumber(ctx.ids.goldOre, gold);
  player.getPacketSender().sendCameraReset();
  player.getMovementQueue().reset().setBlockMovement(false);
  player.moveTo(landing);
  if (dropHelmet) api.getItemOnGroundManager().registerLocation(player, new core.Item(ctx.ids.goldHelmet, 1), landing);
  ctx.left(player, { killed });
  if (gold > 0) {
    core.TaskManager.submit(new core.CountdownTask(player, GOLD_ABSORBED_DELAY, () => {
      if (player.isRegistered?.() === false) return;
      core.StatementDialogue.send(player, GOLD_ABSORBED);
    }));
  }
}

// ----------------------------------------------------------------------------
// The Being's voice
// ----------------------------------------------------------------------------

function taunt(player) {
  const options = ctx.transcriptSteps("between-a-rock-randomly-while-mining-gold", null, null)[0]?.options ?? [];
  const line = options[Math.floor(Math.random() * options.length)]?.steps?.[0];
  if (!line?.text) return;
  const { ActionDialogue, DialogueChainBuilder, NpcDialogue } = core;
  shake(player);
  player.getDialogueManager().startDialogues(new DialogueChainBuilder()
    .add(new NpcDialogue(0, ctx.ids.arzinianBeing, line.text, "Arzinian Being of Bordanzan", 614))
    .add(new ActionDialogue(1, { execute: () => {
      player.getPacketSender().sendInterfaceRemoval().sendCameraReset();
    } })));
}

function shake(player) {
  player.getPacketSender().sendCameraShake(...SHAKE).sendSound(SHAKE_SOUND, 0, 0);
}

function minedGold({ player, itemId }) {
  if (itemId !== ctx.ids.goldOre || !inside(player) || !questInside(player) || ctx.avatarKilled(player)) return;
  if (Math.random() >= TAUNT_CHANCE) return;
  core.TaskManager.submit(new core.CountdownTask(player, 1, () => {
    if (player.isRegistered?.() !== false && inside(player) && !player.getDialogueManager().isActive?.()) taunt(player);
  }));
}

/** Gold rocks and veins in here come back after 9 ticks (3379-3388, 3389-3398). */
function respawnTicks(request) {
  if (!ROCKS.has(request.rock)) return;
  const at = request.object?.getLocation?.();
  if (!at || at.getZ() !== 0 || at.getX() < ARZINIAN_MINE.minX || at.getX() > ARZINIAN_MINE.maxX
    || at.getY() < ARZINIAN_MINE.minY || at.getY() > ARZINIAN_MINE.maxY) return;
  request.ticks = 9;
}

// ----------------------------------------------------------------------------
// The walls of flame
// ----------------------------------------------------------------------------

let centreFlameIds = new Set();
let longJump = -1;

function jumpThrough(event) {
  const { player, objectId } = event;
  const location = event.location ?? event.object?.getLocation?.();
  if (!location || leaping.has(player)) return true;
  if (centreFlameIds.has(objectId)) {
    player.sendMessage(DATA.fireWalls.tooHot);
    return true;
  }
  const wall = [location.x ?? location.getX(), location.y ?? location.getY()];
  const from = [player.getLocation().getX(), player.getLocation().getY()];
  const recorded = DATA.fireWalls.jumps.find((jump) => jump.wall[0] === wall[0] && jump.wall[1] === wall[1]
    && jump.from[0] === from[0] && jump.from[1] === from[1]);
  // Ours: a wall the capture does not jump lands the player as far past it as they stood before it.
  const to = recorded?.to ?? [2 * wall[0] - from[0], 2 * wall[1] - from[1]];
  const angle = recorded?.angle ?? angleOf(to[0] - from[0], to[1] - from[1]);
  leap(player, from, to, angle, recorded?.pan ?? null);
  return true;
}

/** Client orientations 0 south, 512 west, 1024 north, 1536 east. */
function angleOf(dx, dy) {
  if (Math.abs(dx) >= Math.abs(dy)) return dx < 0 ? 512 : 1536;
  return dy < 0 ? 0 : 1024;
}

function leap(player, from, to, angle, pan) {
  const { ForceMovement, Location, Animation, HitDamage, HitMask } = core;
  const leapToken = {};
  leaping.set(player, leapToken);
  const current = () => leaping.get(player) === leapToken && player.isRegistered?.() !== false;
  const out = player.getPacketSender();
  player.getMovementQueue().reset().setBlockMovement(true);
  player.sendMessage(DATA.fireWalls.leap);
  player.setForceMovement(new ForceMovement(new Location(from[0], from[1], 0), new Location(to[0] - from[0], to[1] - from[1]), 30, 60, angle, -1));
  player.performAnimation(new Animation(longJump, 20));
  out.sendSound(FIRE_JUMP_SOUND, 0, 20);
  core.TaskManager.submit(new core.CountdownTask(player, 1, () => { if (current()) out.sendVarbit(BUSY_VARBIT, 1); }));
  core.TaskManager.submit(new core.CountdownTask(player, 2, () => {
    if (!current()) return;
    player.setForceMovement(null);
    player.moveTo(new Location(to[0], to[1], 0));
  }));
  for (const [at, move, look, move2] of pan ?? []) {
    core.TaskManager.submit(new core.CountdownTask(player, at, () => {
      if (!current()) return;
      if (move) out.sendCameraMoveTo(move[0], move[1], move[2], { rate: 232, rate2: 232 });
      if (look) out.sendCameraLookAt(look[0], look[1], look[2], { rate: move ? 232 : 2, rate2: move ? 232 : 2 });
      if (move2) out.sendCameraMoveTo(move2[0], move2[1], move2[2], { rate: 2, rate2: 2 });
    }));
  }
  core.TaskManager.submit(new core.CountdownTask(player, DATA.fireWalls.landTicks, () => {
    if (!current()) return;
    leaping.delete(player);
    player.getMovementQueue().setBlockMovement(false);
    out.sendVarbit(BUSY_VARBIT, 0);
    if (pan) out.sendCameraReset();
    player.getCombat().getHitQueue().addPendingDamage([new HitDamage(DATA.fireWalls.damage, HitMask.RED)]);
  }));
}

function attach(pluginApi, context) {
  api = pluginApi;
  core = api.core;
  ctx = context;
  centreFlameIds = new Set([...CENTRE_FLAMES].map((name) => core.CacheDefinitions.getLocId(name)).filter(Number.isInteger));
  longJump = core.CacheDefinitions.getSeqId("human_longjump");
  api.onCustomEvent("mining:success", minedGold);
  api.onCustomEvent("mining:respawn-ticks", respawnTicks);
  api.onObjectInteraction("Wall of flame", { "Jump-through": jumpThrough });
  api.persistAttribute(TIMER_ATTRIBUTE, 0);
}

module.exports = {
  attach, inside, startTimer, stopTimer, tickTimer, timeLeft, leave, taunt, shake, jumpThrough, minedGold,
  timing: (player) => timers.has(player), TIMER_VARBIT,
};
