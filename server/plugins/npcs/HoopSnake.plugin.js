"use strict";

/**
 * Hoop Snakes in Fossil Island's Tar Swamp (docs/hoop-snake.md): Stun one with a blunt attack,
 * pick the stunned snake up, then Roll or Release the hoop snake item.
 *
 * rsprox captures (rev 231-232: 708, 709, 710, 3038, 3215):
 * - Stun answers on arrival, with no player animation. A crush style (unarmed counts) is needed,
 *   or "You need to use a blunt attack to stun the snake." A miss says "The movement of the
 *   snake causes you to miss." A stun turns the snake into Stunned Hoop Snake (7803) with the
 *   stunned spotanim (80), and it stands still.
 * - If no one picks it up, 10 ticks later it turns back into a Hoop Snake at its spawn tile
 *   (telejump; 708 ticks 294 -> 304, 882 -> 892).
 * - Pick-up: human_pickupfloor (827), sound 2582 (delay 10), the snake leaves and the hoop snake item
 *   (21624) is added. The snake comes back at its spawn 17 ticks later (709 66 -> 83; 708 2237
 *   -> 2254, 2360 -> 2377, 3115 -> 3132, 3466 -> 3483). The Wiki gives the same 17-tick respawn.
 * - Roll asks "Roll the hoop snake forward?" Yes./No. On Yes: human_pickupfloor (827), the item
 *   leaves, and projectile 1408 goes from the player's tile to the tile 7 squares ahead in the
 *   direction they face (start 0, end 105, angle 127, progress 0, heights 0; 708 ticks 1866,
 *   2249, 2464, 3150, 3475; 709 82; 710 434). One went diagonally, 7 on each axis (708 3475).
 * - Release: "You let the snake go." and the item leaves, with nothing else (708 2367, 3215 657).
 *
 * Ours:
 * - The stun chance. The Wiki gives none ("Crush attack bonus does not seem to have a noticeable
 *   impact"); the recordings have 11 stuns and 17 misses in 28 blunt attempts, so 40%.
 * - The blunt check comes before the roll, so a non-crush style never stuns.
 * - With a full inventory the hoop snake is dropped where the snake lay. The Wiki says the item
 *   "can appear on the ground" then; no recording shows it.
 * - A player who faces no direction yet (just logged in, not moved) rolls it south.
 * Not built: a rolled snake stunning the Tar Monsters it hits. The Tar Swamp's tar monsters
 * (7801, 7804, 7805) have no plugin yet.
 */

const SNAKE_NAME = "Hoop Snake";
const STUNNED_NAME = "Stunned Hoop Snake";
const ITEM_NAME = "Hoop snake";

const STUNNED_GRAPHIC = 80; // stunned
const PICKUP_ANIMATION = 827; // human_pickupfloor
const PICKUP_SOUND = 2582;
const PICKUP_SOUND_DELAY = 10;
const ROLL_PROJECTILE = 1408; // fossil_projectile_hoopsnake
const ROLL_DISTANCE = 7;
const ROLL_START = 0;
const ROLL_END = 105;
const ROLL_ANGLE = 127;
const ROLL_PROGRESS = 0;
const ROLL_HEIGHT = 0;
const STUN_TICKS = 10;
const RESPAWN_TICKS = 17;
/** Ours: 11 stuns in 28 blunt attempts across the recordings. */
const STUN_CHANCE = 0.4;

const BLUNT_MESSAGE = "You need to use a blunt attack to stun the snake.";
const MISS_MESSAGE = "The movement of the snake causes you to miss.";
const RELEASE_MESSAGE = "You let the snake go.";
const ROLL_QUESTION = "Roll the hoop snake forward?";

let core = null;
/** Snakes that are stunned or picked up, with the movement block they had before. */
const held = new WeakMap();

function initialize(api) {
  core = api.core;
}

function usesBluntAttack(player) {
  return player.getFightType?.()?.getBonusType?.() === core.BonusManager.ATTACK_CRUSH;
}

function freeSnake(npc) {
  return npc?.isRegistered?.() === true && npc.isVisible() && !held.has(npc);
}

/** Stops the snake where it is, remembering how it moved, until it is reset. */
function hold(npc) {
  const queue = npc.getMovementQueue();
  held.set(npc, { blocked: queue.isMovementBlocked(), untargetable: npc.untargetable });
  queue.reset();
  queue.setBlockMovement(true);
  npc.getCombat().reset();
  npc.untargetable = true;
}

/** Back to an ordinary Hoop Snake at its spawn tile, seen again if it was picked up. */
function reset(npc) {
  const state = held.get(npc);
  held.delete(npc);
  if (!state || !npc.isRegistered()) return;
  npc.setNpcTransformationId(-1);
  npc.moveTo(npc.getSpawnPosition());
  npc.getMovementQueue().setBlockMovement(state.blocked);
  npc.untargetable = state.untargetable;
  npc.setVisible(true);
}

function stunSnake({ player, npc }) {
  if (!freeSnake(npc)) return true;
  if (!usesBluntAttack(player)) {
    player.sendMessage(BLUNT_MESSAGE);
    return true;
  }
  if (Math.random() >= STUN_CHANCE) {
    player.sendMessage(MISS_MESSAGE);
    return true;
  }
  hold(npc);
  npc.setNpcTransformationId(core.NpcIdentifiers.STUNNED_HOOP_SNAKE);
  npc.performGraphic(new core.Graphic(STUNNED_GRAPHIC));
  const state = held.get(npc);
  core.TaskManager.submit(new core.CountdownTask(npc, STUN_TICKS, () => wakeUp(npc, state)));
  return true;
}

/** The stun wears off, unless the snake was picked up meanwhile. */
function wakeUp(npc, state) {
  if (held.get(npc) !== state || state.taken) return;
  reset(npc);
}

function pickUpSnake({ player, npc }) {
  const state = held.get(npc);
  if (!state || state.taken || !npc.isRegistered() || !npc.isVisible()) return true;
  state.taken = true;
  const item = new core.Item(core.ItemIdentifiers.HOOP_SNAKE, 1);
  const inventory = player.getInventory();
  if (inventory.getAddableAmount(item) > 0) inventory.add(item, true);
  else core.ItemOnGroundManager.registerLocation(player, item, npc.getLocation().clone(), npc.getPrivateArea?.() ?? null);
  player.performAnimation(new core.Animation(PICKUP_ANIMATION));
  player.getPacketSender().sendSoundEffect(PICKUP_SOUND, 1, PICKUP_SOUND_DELAY);
  npc.setVisible(false);
  core.TaskManager.submit(new core.CountdownTask(npc, RESPAWN_TICKS, () => respawn(npc, state)));
  return true;
}

/** Live deletes the snake and adds a new one, so it comes back at full health and cured. */
function respawn(npc, state) {
  if (held.get(npc) !== state) return;
  reset(npc);
  // After the reset: the stunned form's own hitpoints are not the snake's.
  npc.setHitpoints(npc.getMaxHitpoints());
  npc.setPoisonDamage(0);
}

function holdsSnake(player, slot) {
  return player.getInventory().get(slot)?.getId?.() === core.ItemIdentifiers.HOOP_SNAKE;
}

function rollTarget(player) {
  const { Direction, Location } = core;
  const facing = player.getFacingDirection();
  const direction = facing === Direction.NONE ? Direction.SOUTH : facing;
  const at = player.getLocation();
  return new Location(at.getX() + direction.getX() * ROLL_DISTANCE, at.getY() + direction.getY() * ROLL_DISTANCE, at.getZ());
}

function rollSnake(player, slot) {
  if (!holdsSnake(player, slot)) return;
  player.getInventory().setItem(slot, new core.Item(-1, 0)).refreshItems();
  player.performAnimation(new core.Animation(PICKUP_ANIMATION));
  new core.Projectile(
    player.getLocation(), rollTarget(player), null, ROLL_PROJECTILE, ROLL_START, ROLL_END,
    ROLL_HEIGHT, ROLL_HEIGHT, player.getPrivateArea?.() ?? null,
  ).withAngle(ROLL_ANGLE).withProgress(ROLL_PROGRESS).sendProjectile();
}

function askToRoll({ player, slot }) {
  const { DialogueChainBuilder, OptionDialogue } = core;
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(
    new OptionDialogue(0, {
      executeOption(option) {
        player.getPacketSender().sendInterfaceRemoval();
        if (Number(option) === 1) rollSnake(player, slot);
      },
    }, "Yes.", "No.").setTitle(ROLL_QUESTION),
  ));
  return true;
}

function releaseSnake({ player, slot }) {
  if (!holdsSnake(player, slot)) return true;
  player.getInventory().setItem(slot, new core.Item(-1, 0)).refreshItems();
  player.sendMessage(RELEASE_MESSAGE);
  return true;
}

module.exports = {
  name: "HoopSnake",
  description: "Fossil Island's Hoop Snakes: stun one with a blunt attack, pick it up, then roll or release it.",
  members: true,
  register(api) {
    initialize(api);
    api.onNpcInteraction(SNAKE_NAME, { Stun: stunSnake });
    api.onNpcInteraction(STUNNED_NAME, { "Pick-up": pickUpSnake });
    api.onItemAction(ITEM_NAME, { Roll: askToRoll, Release: releaseSnake });
  },
  _test: { STUN_CHANCE, STUN_TICKS, RESPAWN_TICKS, rollTarget },
};
