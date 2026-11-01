"use strict";

/**
 * The Den's lobby and the way in: the pub trapdoor, Brian O'Richard's transcript variants and
 * the doorway checks, the mystic jewel, and the flash powder/tile spawns the cache's ground-item
 * file places on the wrong plane.
 */
const Common = require("./Common.RoguesDen");
const Run = require("./Run.RoguesDen");

const PET_ATTRIBUTE = "pets:current";

function location(x, y, z) {
  return new (Common.core().Location)(x, y, z);
}

function inventoryItems(player) {
  return player.getInventory().getValidItems();
}

function hasDisallowedItems(player) {
  return inventoryItems(player).some((item) => item.getId() !== Common.itemIds.mysticJewel)
    || player.getEquipment().getValidItems().length > 0;
}

function hasFollower(player) {
  return Boolean(player.getAttribute?.(PET_ATTRIBUTE));
}

function inventoryAllowed(player) {
  return !hasDisallowedItems(player);
}

function enterMaze(event) {
  const { player } = event;
  if (String(event.option).toLowerCase() !== "open") return false;
  if (Run.runOf(player)) return false;
  if (Common.maxLevel(player, "THIEVING") < 50 || Common.maxLevel(player, "AGILITY") < 50) {
    player.sendMessage(Common.message("needLevels"));
    event.handled = true;
    return true;
  }
  const access = player.getAttribute(Run.ACCESS_ATTRIBUTE) === true;
  const allowed = inventoryAllowed(player);
  const pet = hasFollower(player);
  if (!access || !allowed || pet) {
    Run.startBrian(player, "entering-the-maze");
    event.handled = true;
    return true;
  }
  Run.startBrian(player, "entering-the-maze");
  event.handled = true;
  return true;
}

function startEntry(player) {
  const run = Run.runOf(player) ?? Run.start(player);
  if (!Common.hasItem(player, Common.itemIds.mysticJewel)) Common.give(player, Common.itemIds.mysticJewel, 1);
  const [x, y, z] = [3056, 4992, 1];
  player.moveTo(location(x, y, z));
  run.prev = player.getLocation().clone();
}

function brianVariant({ player, npcId }) {
  if (npcId !== Common.npcIds.brian) return null;
  if (player.getAttribute(Run.ACCESS_ATTRIBUTE) === true) {
    return "standard-dialogue-after-having-access-to-the-rogues-den-minigame";
  }
  return null;
}

function usedSlots(player) {
  return 28 - player.getInventory().getFreeSlots();
}

function condition(event) {
  if (event.npcId !== Common.npcIds.brian) return null;
  const { player } = event;
  const text = String(event.text ?? "");
  const access = player.getAttribute(Run.ACCESS_ATTRIBUTE) === true;
  const allowed = inventoryAllowed(player);
  const pet = hasFollower(player);
  const run = Run.runOf(player);

  if (text.includes("under level 50 Thieving")) return Common.maxLevel(player, "THIEVING") < 50;
  if (text.includes("over level 50 Thieving but under level 50 Agility")) {
    return Common.maxLevel(player, "THIEVING") >= 50 && Common.maxLevel(player, "AGILITY") < 50;
  }
  if (text.includes("over level 50 Thieving and Agility")) {
    return Common.maxLevel(player, "THIEVING") >= 50 && Common.maxLevel(player, "AGILITY") >= 50;
  }
  if (text.includes("doesn't have a mystic jewel")) return !Common.hasItem(player, Common.itemIds.mysticJewel);
  if (text.includes("has a mystic jewel")) return Common.hasItem(player, Common.itemIds.mysticJewel);

  if (text.includes("not been granted access to the maze")) return !access;
  if (text.includes("granted access to the maze, but has items")) return access && !allowed;
  if (text.includes("has an empty inventory, but has a follower")) return access && allowed && pet;
  if (text.includes("has an empty inventory, and no follower")) return access && allowed && !pet;

  if (text.includes("three or less items in their inventory")) return usedSlots(player) <= 3;
  if (text.includes("four or more items in their inventory")) return usedSlots(player) >= 4;

  if (text.includes("not past the first pendulum")) return !run || !run.pastFirstPendulum;
  if (text.includes("past the first pendulum")) return Boolean(run?.pastFirstPendulum) && !Common.inSafeRoom(player.getLocation());
  if (text.includes("in the wall safe room")) return Common.inSafeRoom(player.getLocation());
  return null;
}

function choice(event) {
  if (event.npcId !== Common.npcIds.brian) return;
  if (event.option === "Ok that sounds good!") event.player.setAttribute(Run.ACCESS_ATTRIBUTE, true);
}

function fillXp(player, text) {
  const numbers = Run.lastXp(player);
  return String(text)
    .replace("[number]", String(numbers.thieving ?? 0))
    .replace("[number]", String(numbers.agility ?? 0))
    .replace("%THIEVING%", String(numbers.thieving ?? 0))
    .replace("%AGILITY%", String(numbers.agility ?? 0));
}

function dialogueAction(event) {
  if (event.npcId !== Common.npcIds.brian) return;
  const { player } = event;
  const text = String(event.text ?? "");

  if (event.kind === "message" && text.includes("gives you a jewel as you enter the maze")) {
    startEntry(player);
    return;
  }
  if (event.kind === "message" && text.includes("You gained:")) {
    player.sendMessage(fillXp(player, text));
    event.handled = true;
    Run.clearXp(player);
    return;
  }
  if (event.action === "receive" && text.toLowerCase().includes("mystic jewel")) {
    if (!Common.hasItem(player, Common.itemIds.mysticJewel)) Common.give(player, Common.itemIds.mysticJewel, 1);
    event.handled = true;
    return;
  }
  if (event.action === "The player exits the maze") {
    // The jewel's own menu does the leaving; a transcript action only closes the chat.
    event.handled = true;
  }
}

function activateJewel(event) {
  const { player } = event;
  const run = Run.runOf(player);
  if (!run) {
    player.sendMessage(Common.message("jewelOutside"));
    return true;
  }
  const api = Common.api();
  api.sendMultiChatboxPrompt(
    player,
    "Want to come out then? Giving up are you? You know there's no time limit here.",
    "Yes I'd like to leave!", () => {
      const zone = run.zone();
      Run.finish(player, { reason: zone === 0 ? "firstPendulum" : zone === 2 ? "safe" : "caught", reward: zone === 2 });
    },
    "No I'm fine thanks.", () => player.getPacketSender().sendInterfaceRemoval(),
  );
  return true;
}

/** Flash powder and tiles: ground-items.json has them on plane 0, the maze is plane 1. */
function spawnItems() {
  const core = Common.core();
  if (!core.ItemOnGround || !core.GroundItemState) return;
  const manager = Common.api().getItemOnGroundManager();
  const spots = [
    [Common.itemIds.flashPowder, 2969, 4999, 5],
    [Common.itemIds.flashPowder, 2970, 5000, 5],
    [Common.itemIds.flashPowder, 3009, 5063, 5],
    [Common.itemIds.flashPowder, 3009, 5070, 5],
    [Common.itemIds.tile, 3018, 5080, 1],
    [Common.itemIds.tile, 3018, 5086, 1],
    [Common.itemIds.tile, 3011, 5082, 1],
    [Common.itemIds.tile, 3013, 5090, 1],
  ];
  for (const [id, x, y, amount] of spots) {
    manager.register(new core.ItemOnGround(
      core.GroundItemState.SEEN_BY_EVERYONE, undefined,
      new core.Location(x, y, 1), new core.Item(id, amount),
      false, 10, null, true,
    ));
  }
}

function attach(api) {
  api.onServerStartup(spawnItems);
  api.onNpcDialogueVariant(brianVariant);
  api.onNpcDialogueCondition(condition);
  api.onCustomEvent("npc-dialogue:choice", choice);
  api.onCustomEvent("npc-dialogue:action", dialogueAction);
  api.onItemAction((event) => {
    const definition = Common.core().CacheDefinitions.getItem(event.itemId);
    const option = String(event.option ?? definition?.inventoryActions?.[event.clickType - 1] ?? "").toLowerCase();
    if (event.itemId === Common.itemIds.mysticJewel && option === "activate") {
      event.handled = activateJewel(event) === true;
    }
  });
  api.onItemOnNpc(require("./Traps.RoguesDen").useFlashPowder, { noted: false });
}

module.exports = {
  attach, enterMaze, startEntry, condition, choice, dialogueAction, activateJewel, spawnItems,
};
