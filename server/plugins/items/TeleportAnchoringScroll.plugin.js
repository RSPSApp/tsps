"use strict";

/**
 * Teleport anchoring scroll (Wiki: Teleport anchoring scroll; issue #6013).
 *
 * The scroll's Read dialogue and persistent varbit are transcribed from rsprox recording 444
 * (rev 233). Abyssal demon hit order and effects are transcribed from recordings 4099, 4093 and
 * 1143 (rev 237): an accurate player hit, including a zero, first rolls the demon's self-teleport
 * at 1/6; only if that fails does it roll the player's teleport at 1/3. The captures show local
 * moves (up to three tiles), graphic 409 and demon animation 2309. We choose a reachable local
 * landing tile; the retail landing distribution has not been established.
 *
 * Elder Chaos druid pulls are deliberately not implemented: no indexed capture established their
 * trigger timing or targeting behavior. See server/docs/teleport-anchoring-scroll.md.
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
const TELEPORT_RADIUS = 3;
const DEMON_ANIMATION = 2309;
const TELEPORT_GRAPHIC = 409;
const STEPS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

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
        player.getDialogueManager().reset();
        if (Number(option) !== 1) return;
        const inventory = player.getInventory();
        const slot = inventory.getItems().indexOf(item);
        if (slot < 0 || item.getId() !== ITEM_ID || unlocked(player)) return;
        inventory.deleteAtSlot(slot, 1);
        player.setAttribute(UNLOCKED_ATTRIBUTE, true);
        sync(player);
        say(player, new core.ItemStatementDialogue(0, ITEM_ID, COMPLETE));
      },
    }, CONFIRM_YES, CONFIRM_NO).setTitle(CONFIRM_TITLE));
  player.getDialogueManager().startDialogues(chain);
}

/** Reachable destinations up to three tiles from the starting tile, respecting collision and plane. */
function reachableTiles(mobile) {
  const origin = mobile.getLocation();
  const x = origin.getX(), y = origin.getY(), z = origin.getZ();
  const size = Math.max(1, Number(mobile.getSize?.()) || 1);
  const area = mobile.getPrivateArea?.() ?? null;
  const reached = new Map([[`${x},${y}`, origin.clone()]]);
  const queue = [[x, y]];
  while (queue.length) {
    const [fromX, fromY] = queue.shift();
    for (const [dx, dy] of STEPS) {
      const toX = fromX + dx, toY = fromY + dy;
      const key = `${toX},${toY}`;
      if (Math.abs(toX - x) > TELEPORT_RADIUS || Math.abs(toY - y) > TELEPORT_RADIUS || reached.has(key)) continue;
      if (!core.RegionManager.canMove(fromX, fromY, toX, toY, z, size, size, area)) continue;
      reached.set(key, new core.Location(toX, toY, z));
      queue.push([toX, toY]);
    }
  }
  return [...reached.values()].slice(1);
}

function teleport(mobile) {
  const tiles = reachableTiles(mobile);
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
    teleport(demon);
    return;
  }
  if (core.Misc.getRandom(2) !== 0 || unlocked(attacker)) return;
  demon.performAnimation(new core.Animation(DEMON_ANIMATION));
  if (teleport(attacker)) attacker.getCombat()?.reset?.();
}

function login({ player }) {
  sync(player);
}

module.exports = {
  name: "TeleportAnchoringScroll",
  description: "Read the teleport anchoring scroll to unlock protection from Abyssal demon player teleports.",
  members: true,
  _test: { read, login, onHitResolved, reachableTiles, unlocked, constants: { UNLOCKED_ATTRIBUTE, UNLOCKED_VARBIT, ITEM_ID, INTRO, REPEAT, COMPLETE, CONFIRM_TITLE, CONFIRM_YES, CONFIRM_NO } },
  register(pluginApi) {
    api = pluginApi;
    core = pluginApi.core;
    api.persistAttribute(UNLOCKED_ATTRIBUTE, false);
    api.onItemAction("Teleport anchoring scroll", { Read: read });
    api.onPlayerLogin(login);
    api.onCombatHitResolved(onHitResolved);
  },
};
