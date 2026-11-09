/**
 * Fossil Island's Magic Mushtrees (the Mycelium Transportation System;
 * https://oldschool.runescape.wiki/w/Mycelium_Transportation_System; docs/spirit-trees.md), as
 * live OSRS plays them (rsprox capture database):
 *
 * - Use opens fossil_mushtrees (608) in the main modal, with the four trees' names written in
 *   ("<col=8f8f8f>1.</col> House on the Hill" ...). Its buttons (608:4, 8, 12, 16) come back
 *   as pause buttons.
 * - Choosing one: the player crawls in (sound 2266), the screen fades out and the interface
 *   closes, three ticks later they come out of that mushtree, and the screen fades back in a
 *   tick after that (the overlay closed two ticks later).
 * - The mushtree they're at: "You are already at that Magic Mushtree."
 *
 * Discovery (Wiki: "they must be discovered by walking to their locations. After attempting to
 * use them, the location will be unlocked."): using a mushtree unlocks it, saved per player; one
 * not yet used can't be travelled to. The captures only have players who had all four, so the
 * menu still lists all four names, and the refusal's wording is calibrated.
 */
const fs = require("fs");
const path = require("path");

const INTERFACE = 608;
const MENU_ATTRIBUTE = "magic-mushtrees:from";
/** The mushtrees the player has used, one bit per tree in data order. */
const DISCOVERED_ATTRIBUTE = "magic-mushtrees:discovered";
/** The name components and buttons, one per tree in data order. */
const NAME_COMPONENTS = [5, 9, 13, 17];
const BUTTONS = [4, 8, 12, 16];
const MAIN_MODAL = (161 << 16) | 16;
const SCRIPT_MAINMODAL_OPEN = 2524;
/** chatdefault_restoreinput: the chatbox's input back after the menu, as the game sends it. */
const SCRIPT_RESTORE_INPUT = 2158;
const OVERLAY_ATMOSPHERE_UID = (161 << 16) | 1;
const FADE_OVERLAY = 174;
const FADE_SCRIPT = 948;
const FADE_CYCLES = 50;
const CRAWL_ANIMATION = 844;
const CRAWL_SOUND = 2266;
const MOVE_TICKS = 3;
const FADE_IN_TICKS = 4;
const CLOSE_OVERLAY_TICKS = 6;
const ALREADY_THERE = "You are already at that Magic Mushtree.";
/** Calibrated: no source gives the line. */
const UNDISCOVERED = "You haven't discovered that Magic Mushtree yet.";
const TREE_REACH = 3;

let core = null;
let mushtrees = [];

function loadMushtrees() {
  const file = path.join(__dirname, "data", "magic-mushtrees.json");
  return JSON.parse(fs.readFileSync(file, "utf8")).mushtrees;
}

/** The index of the mushtree at a location, or -1. */
function mushtreeAt(location) {
  return mushtrees.findIndex(({ tree }) => tree[2] === location.getZ()
    && Math.abs(tree[0] - location.getX()) <= TREE_REACH && Math.abs(tree[1] - location.getY()) <= TREE_REACH);
}

function fade(player, out) {
  const args = out ? [0, 255, 0, 0, FADE_CYCLES] : [0, 0, 0, 255, FADE_CYCLES];
  player.getPacketSender().sendSubInterface(OVERLAY_ATMOSPHERE_UID, FADE_OVERLAY, 1, { postScripts: [{ scriptId: FADE_SCRIPT, args }] });
}

function discovered(player, index) {
  return ((Number(player.getAttribute(DISCOVERED_ATTRIBUTE)) || 0) & (1 << index)) !== 0;
}

function discover(player, index) {
  if (index < 0) return;
  player.setAttribute(DISCOVERED_ATTRIBUTE, (Number(player.getAttribute(DISCOVERED_ATTRIBUTE)) || 0) | (1 << index));
}

function useMushtree(event) {
  const { player, object } = event;
  const sender = player.getPacketSender();
  const here = mushtreeAt(object.getLocation());
  discover(player, here);
  player.setAttribute(MENU_ATTRIBUTE, here);
  sender.sendInterfaceScript(SCRIPT_MAINMODAL_OPEN, [-1, -1]);
  player.setInterfaceId(INTERFACE);
  sender.sendSubInterface(MAIN_MODAL, INTERFACE, 0);
  mushtrees.forEach(({ name }, index) => sender.sendString(`<col=8f8f8f>${index + 1}.</col> ${name}`, (INTERFACE << 16) | NAME_COMPONENTS[index]));
}

/** The captured crawl: out, three ticks later the move, a tick later back in. */
function crawlTo(player, landing) {
  const { Task, TaskManager, Animation, Location } = core;
  const sender = player.getPacketSender();
  player.performAnimation(new Animation(CRAWL_ANIMATION));
  sender.sendSound(CRAWL_SOUND, 1, 0);
  fade(player, true);
  const movement = player.getMovementQueue();
  movement.setBlockMovement(true).reset();
  let tick = 0;
  TaskManager.submit(new (class extends Task {
    constructor() { super(1, player, false); }
    execute() {
      tick++;
      if (!player.isRegistered()) {
        this.stop();
        return;
      }
      if (tick === MOVE_TICKS) player.moveTo(new Location(landing[0], landing[1], landing[2]));
      if (tick === FADE_IN_TICKS) {
        movement.setBlockMovement(false);
        fade(player, false);
      }
      if (tick >= CLOSE_OVERLAY_TICKS) {
        sender.closeSubInterface(OVERLAY_ATMOSPHERE_UID);
        this.stop();
      }
    }
    stop() {
      movement.setBlockMovement(false);
      super.stop();
    }
  })());
}

function chooseMushtree(event) {
  const buttonId = Number(event.buttonId ?? 0);
  if ((event.groupId ?? (buttonId >>> 16)) !== INTERFACE) return;
  const index = BUTTONS.indexOf(event.childId ?? (buttonId & 0xffff));
  const { player } = event;
  const from = player.getAttribute(MENU_ATTRIBUTE);
  if (index < 0 || from === null || from === undefined) return;
  event.handled = true;
  if (index === from) {
    player.sendMessage(ALREADY_THERE);
    return;
  }
  if (!discovered(player, index)) {
    player.sendMessage(UNDISCOVERED);
    return;
  }
  player.setAttribute(MENU_ATTRIBUTE, null);
  crawlTo(player, mushtrees[index].landing);
  // As captured: the interface closes once the fade has started.
  player.getPacketSender().closeSubInterface(MAIN_MODAL);
  player.getPacketSender().sendInterfaceScript(SCRIPT_RESTORE_INPUT);
  player.setInterfaceId(-1);
}

function menuClosed({ player, interfaceId }) {
  if (interfaceId !== INTERFACE) return;
  player.setAttribute(MENU_ATTRIBUTE, null);
  player.getPacketSender().sendInterfaceScript(SCRIPT_RESTORE_INPUT);
}

module.exports = {
  name: "MagicMushtrees",
  description: "Fossil Island's Magic Mushtrees: the four-tree travel menu, with each tree unlocked per player once used.",
  members: true,
  _test: { mushtreeAt, useMushtree, chooseMushtree, discovered, DISCOVERED_ATTRIBUTE, get mushtrees() { return mushtrees; } },
  register(api) {
    core = api.core;
    mushtrees = loadMushtrees();
    api.persistAttribute(DISCOVERED_ATTRIBUTE, 0);
    api.onObjectInteraction("Magic Mushtree", { Use: useMushtree });
    api.onInterfaceActionClick(chooseMushtree);
    api.onCustomEvent("interface:closed", menuClosed);
  },
};
