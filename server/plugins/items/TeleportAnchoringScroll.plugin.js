"use strict";

/**
 * Teleport anchoring scroll (Wiki: Teleport anchoring scroll; issue #6013).
 *
 * The scroll's Read dialogue and persistent varbit are transcribed from rsprox recording 444
 * (rev 233). Abyssal demon hit order and effects are transcribed from recordings 4099, 4093 and
 * 1143 (rev 237): an accurate player hit, including a zero, first rolls the demon's self-teleport
 * at 1/6; only if that fails does it roll the player's teleport at 1/3, with graphic 409 and demon
 * animation 2309.
 *
 * Landing (issue #6496, rsprox captures 96, 97, 1152, 1885, 3314, 3329, 4099, local 1000230,
 * 1000241, 1000456, 1001305 and 1001309, rev 227-237): whoever is teleported lands on one of the
 * free tiles around the other. 1,019 of 1,086 player teleports landed next to the demon the player
 * was attacking, including attacks from 4-10 tiles away, on all eight sides; 96% of them moved the
 * player 1-2 tiles and none more than 8. All 182 demon self-teleports landed next to the player.
 * The Wiki's 20-tile maximum (Mod Ash) stays as the cap on how far the move may go.
 *
 * Elder Chaos druid pulls honor the same unlock through the druid plugin's pre-move event.
 */
const UNLOCKED_ATTRIBUTE = "teleport-anchoring:unlocked";
const UNLOCKED_VARBIT = 10672;
const ITEM_ID = 29455;
const INTRO = "You can make out some faded words on the ancient<br>parchment, revealing the secrets of teleport negation.<br>Would you like to absorb their power?";
const REPEAT = "You can make out some faded words on the ancient<br>parchment, but there's nothing more for you to learn.";
const COMPLETE = "You study the scroll and become immune to the Abyssal demon and Elder Chaos druid teleportation attacks.";
const CONFIRM_TITLE = "This will consume the scroll.";
const CONFIRM_YES = "Become immune to the Abyssal demon and <br>Elder Chaos druid teleportation attacks.";
const CONFIRM_NO = "Cancel";
const ABYSSAL_IDS = new Set([415, 416, 7241, 11239, 14174, 14175, 12581]);
const MAX_TELEPORT_DISTANCE = 20; // Mod Ash, as cited by the OSRS Wiki.
const CONFIRM_CHATBOX = 219;
const READ_ANIMATION = 7403;
const READ_SOUND = 2655;
const DEMON_ANIMATION = 2309;
const TELEPORT_GRAPHIC = 409;

let api;
let core;

function unlocked(player) {
  return player.getAttribute(UNLOCKED_ATTRIBUTE) === true;
}

function sync(player) {
  player.getPacketSender().sendVarbit(UNLOCKED_VARBIT, unlocked(player) ? 1 : 0);
}

function say(player, dialogue) {
  player.getDialogueManager().startDialogues(new core.DialogueChainBuilder().add(dialogue));
}

function read({ player, item }) {
  if (unlocked(player)) {
    say(player, new core.ItemStatementDialogue(0, ITEM_ID, REPEAT));
    return;
  }
  const chain = new core.DialogueChainBuilder()
    .add(new core.ItemStatementDialogue(0, ITEM_ID, INTRO))
    .add(new core.OptionDialogue(1, {
      executeOption(option) {
        const sender = player.getPacketSender();
        if (Number(option) !== 1) {
          sender.closeInterface(CONFIRM_CHATBOX);
          return;
        }
        const inventory = player.getInventory();
        const slot = inventory.getItems().indexOf(item);
        if (slot < 0 || item.getId() !== ITEM_ID || unlocked(player)) {
          sender.closeInterface(CONFIRM_CHATBOX);
          return;
        }
        player.getDialogueManager().reset();
        inventory.deleteAtSlot(slot, 1);
        player.setAttribute(UNLOCKED_ATTRIBUTE, true);
        sync(player);
        player.performAnimation(new core.Animation(READ_ANIMATION));
        sender.sendSoundEffect(READ_SOUND, 1, 0);
        say(player, new core.ItemStatementDialogue(0, ITEM_ID, COMPLETE));
        // `teleport-anchoring:learnt` { player }: the scroll absorbed (the league's "Use a teleport anchoring scroll").
        api.emitCustomEvent("teleport-anchoring:learnt", { player });
      },
    }, CONFIRM_YES, CONFIRM_NO).setTitle(CONFIRM_TITLE));
  player.getDialogueManager().startDialogues(chain);
}

function sizeOf(mobile) {
  return Math.max(1, Number(mobile.getSize?.()) || 1);
}

/** -1, 0 or 1: the step from a footprint starting at `at` (`size` wide) towards one at `from`. */
function towards(at, size, from, fromSize) {
  if (at + size - 1 < from) return 1;
  if (at > from + fromSize - 1) return -1;
  return 0;
}

/**
 * Landing tiles for `mover` touching `anchor`'s footprint on any side, diagonals included. Each
 * must be free for the mover's size with no wall between it and the anchor, on the anchor's plane,
 * within the 20-tile maximum of the mover's start, and not the tile the mover already stands on.
 */
function landingTiles(mover, anchor) {
  const start = mover.getLocation(), base = anchor.getLocation();
  if (start.getZ() !== base.getZ()) return [];
  const size = sizeOf(mover), anchorSize = sizeOf(anchor);
  const ax = base.getX(), ay = base.getY(), z = base.getZ();
  const area = mover.getPrivateArea?.() ?? null;
  const tiles = [];
  for (let x = ax - size; x <= ax + anchorSize; x++) {
    for (let y = ay - size; y <= ay + anchorSize; y++) {
      const dx = towards(x, size, ax, anchorSize), dy = towards(y, size, ay, anchorSize);
      if (dx === 0 && dy === 0) continue; // overlaps the anchor
      if (x === start.getX() && y === start.getY()) continue;
      if (Math.max(Math.abs(x - start.getX()), Math.abs(y - start.getY())) > MAX_TELEPORT_DISTANCE) continue;
      if (!core.RegionManager.canMove(x + dx, y + dy, x, y, z, size, size, area)) continue;
      tiles.push(new core.Location(x, y, z));
    }
  }
  return tiles;
}

function teleport(mobile, anchor) {
  const tiles = landingTiles(mobile, anchor);
  if (!tiles.length) return false;
  const destination = tiles[core.Misc.getRandom(tiles.length - 1)];
  mobile.performGraphic(new core.Graphic(TELEPORT_GRAPHIC));
  mobile.moveTo(destination);
  return true;
}

function onHitResolved({ attacker, target, hit }) {
  if (!attacker?.isPlayer?.() || !target?.isNpc?.() || !hit?.isAccurate?.()) return;
  const demon = target.getAsNpc?.() ?? target;
  if (!ABYSSAL_IDS.has(demon.getId?.())) return;

  // Only roll the player's teleport when the demon's preceding self-teleport roll fails.
  if (core.Misc.getRandom(5) === 0) {
    demon.performAnimation(new core.Animation(DEMON_ANIMATION));
    teleport(demon, attacker);
    return;
  }
  if (core.Misc.getRandom(2) !== 0 || unlocked(attacker)) return;
  demon.performAnimation(new core.Animation(DEMON_ANIMATION));
  if (teleport(attacker, demon)) attacker.getCombat()?.reset?.();
}

function blockDruidPull(event) {
  const { npc, player } = event;
  const { ELDER_CHAOS_DRUID, ELDER_CHAOS_DRUID_2 } = core.NpcIdentifiers;
  const id = npc?.getId();
  if (player && (id === ELDER_CHAOS_DRUID || id === ELDER_CHAOS_DRUID_2) && unlocked(player)) {
    event.blocked = true;
  }
}

function login({ player }) {
  sync(player);
}

module.exports = {
  name: "TeleportAnchoringScroll",
  description: "Read the teleport anchoring scroll to unlock protection from Abyssal demon and Elder Chaos druid player teleports.",
  members: true,
  _test: { read, login, onHitResolved, landingTiles, unlocked, constants: { UNLOCKED_ATTRIBUTE, UNLOCKED_VARBIT, ITEM_ID, INTRO, REPEAT, COMPLETE, CONFIRM_TITLE, CONFIRM_YES, CONFIRM_NO } },
  register(pluginApi) {
    api = pluginApi;
    core = pluginApi.core;
    api.persistAttribute(UNLOCKED_ATTRIBUTE, false);
    api.onItemAction("Teleport anchoring scroll", { Read: read });
    api.onPlayerLogin(login);
    api.onCombatHitResolved(onHitResolved);
    api.onCustomEvent("combat:npc-teleports-player", blockDruidPull);
  },
};
