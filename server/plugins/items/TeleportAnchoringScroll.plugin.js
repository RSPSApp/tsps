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
const DEMON_TELEPORT_RADIUS = 3;
const PLAYER_TELEPORT_RADIUS = 20; // Mod Ash, as cited by the OSRS Wiki.
const CONFIRM_CHATBOX = 219;
const READ_ANIMATION = 7403;
const READ_SOUND = 2655;
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

/** Reachable destinations within the supplied radius, respecting collision and plane. */
function reachableTiles(mobile, radius) {
  const origin = mobile.getLocation();
  const x = origin.getX(), y = origin.getY(), z = origin.getZ();
  const size = Math.max(1, Number(mobile.getSize?.()) || 1);
  const area = mobile.getPrivateArea?.() ?? null;
  const reached = new Map([[`${x},${y}`, origin.clone()]]);
  const queue = [[x, y]];
  for (let i = 0; i < queue.length; i++) {
    const [fromX, fromY] = queue[i];
    for (const [dx, dy] of STEPS) {
      const toX = fromX + dx, toY = fromY + dy;
      const key = `${toX},${toY}`;
      if (Math.abs(toX - x) > radius || Math.abs(toY - y) > radius || reached.has(key)) continue;
      if (!core.RegionManager.canMove(fromX, fromY, toX, toY, z, size, size, area)) continue;
      reached.set(key, new core.Location(toX, toY, z));
      queue.push([toX, toY]);
    }
  }
  return [...reached.values()].slice(1);
}

function teleport(mobile, radius) {
  const tiles = reachableTiles(mobile, radius);
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
    teleport(demon, DEMON_TELEPORT_RADIUS);
    return;
  }
  if (core.Misc.getRandom(2) !== 0 || unlocked(attacker)) return;
  demon.performAnimation(new core.Animation(DEMON_ANIMATION));
  if (teleport(attacker, PLAYER_TELEPORT_RADIUS)) attacker.getCombat()?.reset?.();
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
  _test: { read, login, onHitResolved, reachableTiles, unlocked, constants: { UNLOCKED_ATTRIBUTE, UNLOCKED_VARBIT, ITEM_ID, INTRO, REPEAT, COMPLETE, CONFIRM_TITLE, CONFIRM_YES, CONFIRM_NO } },
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
