"use strict";

/**
 * The optional puzzle doors and the 10-coin chest. The gear door is the non-reward side room.
 *
 * The mosaic door opens the cache's roguesden_mosaic (688) modal. Its clientscript (4119) shows
 * each of the four Select buttons only while that tile is in the inventory, so the button
 * clicked is the tile placed. Only roguesden_puzzle_mosaic_tile1 ("Tile", not "Tiles") fits
 * (Wiki: Tiles (Rogues' Den)). As recorded (local 1001658 tick 19519, local 1001704 tick
 * 5308): busy is set on the click; the next tick sends "A perfect match!", the enchant-door
 * animation, the door's own loc animation, the tile taken, the modal closed and the door
 * synth; two ticks later busy clears and the player steps through. The player is held from the
 * click (busy), and a player no longer at the door or in a run places nothing. Facts in
 * docs/rogues-den.md.
 */
const Common = require("./Common.RoguesDen");
const Run = require("./Run.RoguesDen");
const Interactions = require("./Interactions.RoguesDen");

const MOSAIC = Common.DATA.mosaic;
/** Players with a placed tile still resolving, so a second click in the same tick is ignored. */
const placing = new WeakSet();
/** The mosaic door each player opened the modal from. */
const doors = new WeakMap();

function location(x, y, z) {
  return new (Common.core().Location)(x, y, z);
}

function cacheId(lookup, name) {
  const id = Common.core().CacheDefinitions[lookup](name);
  if (id === null || id === undefined) throw new Error(`Rogues' Den: the cache has no ${name}`);
  return id;
}

const mosaicInterface = () => cacheId("getInterfaceId", MOSAIC.interface);
const mosaicButtons = () => MOSAIC.buttons.map((name) => cacheId("getComponentId", name));

function heldTile(player) {
  return Common.itemIds.tiles.some((id) => Common.hasItem(player, id));
}

function mosaicDoor(event) {
  const { player, object } = event;
  if (String(event.option).toLowerCase() !== "open") return false;
  event.handled = true;
  // Ours: no recording opens the door without a tile; the message is not a captured one.
  if (!heldTile(player)) {
    player.sendMessage(Common.message("noTile"));
    return true;
  }
  doors.set(player, object);
  player.getPacketSender().sendInterface(mosaicInterface());
  return true;
}

/** Wall rotation -> the side of its tile the wall stands on: 0 west, 1 north, 2 east, 3 south. */
const WALL_SIDE = [[-1, 0], [0, 1], [1, 0], [0, -1]];

/**
 * Where the open door lets the player through: from the door's own tile, one step past the
 * wall (east for this door, as recorded: 3023 -> 3024 at local 1001704 tick 5311); from the
 * far side, onto the door's tile.
 */
function throughDoor(object, player) {
  const at = object.getLocation();
  const here = player.getLocation();
  if (here.getX() !== at.getX() || here.getY() !== at.getY()) return location(at.getX(), at.getY(), at.getZ());
  const [dx, dy] = WALL_SIDE[object.getFace() & 3];
  return location(at.getX() + dx, at.getY() + dy, at.getZ());
}

/** Still at the door, on its plane and in a run: a moved or ejected player places nothing. */
function atDoor(player, object) {
  const at = object.getLocation();
  const here = player.getLocation();
  return Boolean(Run.runOf(player)) && here.getZ() === at.getZ()
    && Math.abs(here.getX() - at.getX()) <= 1 && Math.abs(here.getY() - at.getY()) <= 1;
}

/** A Select click on 688:5-8: places that tile, if the player still holds it. */
function placeTile(event) {
  const { player } = event;
  const index = mosaicButtons().indexOf(event.buttonId);
  if (index < 0) return;
  event.handled = true;
  if (player.getInterfaceId?.() !== mosaicInterface() || placing.has(player)) return;
  const tile = Common.itemIds.tiles[index];
  const object = doors.get(player);
  if (!Common.hasItem(player, tile) || !object) return;
  const core = Common.core();
  const sender = player.getPacketSender();
  const busy = cacheId("getVarbitId", MOSAIC.busyVarbit);
  if (!atDoor(player, object)) return;
  // The player is held for the resolve (busy, as recorded), so the step's tile is fixed now.
  const to = throughDoor(object, player);
  const movement = player.getMovementQueue();
  movement.reset();
  movement.setBlockMovement?.(true);
  // Only this hold is released at the end, not one another system took in the meantime.
  const hold = movement.getBlockMovementGeneration?.();
  placing.add(player);
  sender.sendVarbit(busy, 1);
  let ticks = 0;
  core.TaskManager.submit(new (class extends core.Task {
    constructor() { super(1, player, false); }
    execute() {
      ticks++;
      if (!player.isRegistered?.() || !atDoor(player, object)) {
        if (ticks === 1 && player.isRegistered?.()) sender.sendInterfaceRemoval();
        this.stop();
        return;
      }
      if (ticks === 1) {
        sender.sendInterfaceRemoval();
        if (!Common.hasItem(player, tile)) {
          this.stop();
          return;
        }
        if (tile !== Common.itemIds.tile) {
          // Ours: no recording places a wrong tile; the Wiki only says it does not open the door.
          player.sendMessage(Common.message("mosaicWrong"));
          this.stop();
          return;
        }
        player.sendMessage(Common.message("mosaicRight"));
        player.performAnimation(new core.Animation(cacheId("getSeqId", MOSAIC.playerAnimation)));
        object.performAnimation(new core.Animation(cacheId("getSeqId", MOSAIC.doorAnimation)));
        Common.take(player, tile, 1);
        sender.sendSound(MOSAIC.sound, 1, 0);
        return;
      }
      if (ticks === 2) {
        const run = Run.runOf(player);
        if (run) run.ignoreTrapUntil = (run.ticks ?? 0) + 2;
        return;
      }
      // The step, as Interactions.moveThrough does it, but behind the same door/run check.
      this.stop();
      player.moveTo(to);
      const run = Run.runOf(player);
      if (run) {
        run.prev = to.clone();
        run.moves = [];
      }
    }
    stop() {
      super.stop();
      placing.delete(player);
      if (hold === undefined || movement.getBlockMovementGeneration() === hold) movement.setBlockMovement?.(false);
      if (player.isRegistered?.()) sender.sendVarbit(busy, 0);
    }
  })());
}

/** The gear door: four turns and the door opens; it is the optional room the Wiki calls harmless. */
function gearDoor(event) {
  const { player, object } = event;
  if (String(event.option).toLowerCase() !== "open") return false;
  event.handled = true;
  const api = Common.api();
  api.sendMultiChatboxPrompt(player, "The gears are jammed. What do you do?",
    "Turn the gears.", () => {
      player.getPacketSender().sendInterfaceRemoval();
      player.sendMessage("You turn the gears...");
      const core = Common.core();
      core.TaskManager.submit(new (class extends core.Task {
        constructor() { super(2); }
        execute() {
          this.stop();
          if (!player.isRegistered?.()) return;
          player.sendMessage(Common.message("gearRight"));
          const to = Interactions.across(object, player, 3);
          if (to) Interactions.moveThrough(player, to, 1);
        }
      })());
    },
    "Leave it alone.", () => player.getPacketSender().sendInterfaceRemoval());
  return true;
}

function chest(event) {
  const { player } = event;
  const option = String(event.option).toLowerCase();
  if (option === "search for traps") {
    event.handled = true;
    player.sendMessage("You search the chest for traps...");
    return true;
  }
  if (option !== "open") return false;
  event.handled = true;
  if (!Common.give(player, Common.itemIds.coins, 10)) {
    player.sendMessage(Common.message("full"));
    return true;
  }
  player.sendMessage(Common.message("chestCoins"));
  return true;
}

/** Spawns the four tiles at their recorded spots (local 1001704 tick 5271: obj_add_specific). */
function tileSpawns() {
  return MOSAIC.spawns.map(([id, x, y]) => [id, x, y, 1]);
}

function attach(api) {
  api.onInterfaceActionButton(mosaicButtons(), placeTile);
}

module.exports = { attach, mosaicDoor, placeTile, mosaicButtons, tileSpawns, gearDoor, chest };
