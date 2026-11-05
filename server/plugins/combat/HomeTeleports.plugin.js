"use strict";

/**
 * Home teleports (https://oldschool.runescape.wiki/w/Home_Teleport): the standard, Ancient, Lunar
 * and Arceuus spellbooks' free teleport home. It plays the long home teleport cast
 * (HomeTeleportSequence) and has one 30-minute cooldown shared by all four, kept as the minute
 * of the last one (varp 892, as OSRS sends varp 888 for the minigame teleports).
 */

const { CacheDefinitions } = require("../../src/main/typescript/elvarg/game/cache/CacheDefinitions");
const { startHomeTeleport, dateMinutes, TOGGLES_ATTRIBUTE } = require("./HomeTeleportSequence");

const COOLDOWN_MINUTES = 30;
const LAST_HOME_TELEPORT_VARP = 892;
const LAST_HOME_TELEPORT_ATTRIBUTE = "home-teleport:last-minute";
// Cache: animation_picker, CS2 7707/1196/1197, home_tele_anim_toggle_list.
const ANIMATION_PICKER = 525;
const ANIMATION_PICKER_INIT = 7707;
const ANIMATION_TOGGLE_CHILD = 8;
const LAST_ANIMATION_SLOT = 10;
const TRANSMIT_OP1 = 1 << 1;
const ANIMATION_CATEGORY_VARP = 4559;
const HOME_ANIMATION_CATEGORY = 4093;
const HOME_ANIMATION_TOGGLES_VARP = 4560;
const UNLOCKED_ATTRIBUTE = "home-teleport:animations-unlocked";

/**
 * The league scrolls (Read): picker bit (CS2 7758), unlock varbit, read animation, and the Wiki's
 * texts (Twisted/Trailblazer/Shattered teleport scroll pages).
 */
const SCROLLS = [
  { item: "TWISTED_TELEPORT_SCROLL", bit: 4, varbit: 10112, animation: 8535,
    incantation: "a Xerician incantation", name: "Leagues I - Twisted" },
  { item: "TRAILBLAZER_TELEPORT_SCROLL", bit: 5, varbit: 11761, animation: 8890,
    incantation: "an incantation", name: "Leagues II - Trailblazer" },
  { item: "SHATTERED_TELEPORT_SCROLL", bit: 6, varbit: 13343, animation: 9247,
    incantation: "an incantation", name: "Leagues III - Shattered Relics" },
];

/** Destinations (Wiki): a tile, or a random tile in an area. */
const HOMES = new Map([
  ["lumbridge home teleport", { x: 3222, y: 3218, members: false }],
  ["edgeville home teleport", { x: 3087, y: 3501, width: 4, height: 4 }],
  ["lunar home teleport", { x: 2094, y: 3913 }],
  ["arceuus home teleport", { x: 1698, y: 3880, width: 5, height: 5 }],
]);

let core;

function spellName(event) {
  const itemId = event.itemId ?? -1;
  const packed = Number.isInteger(event.groupId) && Number.isInteger(event.childId)
    ? (event.groupId << 16) | (event.childId & 0xffff)
    : -1;
  return (CacheDefinitions.getSpellName(event.buttonId, itemId)
    ?? CacheDefinitions.getSpellName(packed, itemId)
    ?? "").toLowerCase();
}

function destinationFor(home) {
  const dx = home.width ? Math.floor(Math.random() * home.width) : 0;
  const dy = home.height ? Math.floor(Math.random() * home.height) : 0;
  return new core.Location(home.x + dx, home.y + dy, 0);
}

/** Minutes left of the cooldown that started at `lastMinute`; 0 when it has passed. */
function minutesLeft(lastMinute, cooldown, now = dateMinutes()) {
  if (!Number.isFinite(lastMinute) || lastMinute <= 0) return 0;
  return Math.max(0, cooldown - (now - lastMinute));
}

function castHomeTeleport(event) {
  const home = HOMES.get(spellName(event));
  if (!home) return;
  event.handled = true;
  const { player } = event;
  const op = event.opId ?? event.action ?? 1;
  if (op === 10) {
    player.getPacketSender()
      .sendConfig(ANIMATION_CATEGORY_VARP, HOME_ANIMATION_CATEGORY)
      .sendConfig(HOME_ANIMATION_TOGGLES_VARP, toggles(player))
      .sendInterface(ANIMATION_PICKER)
      .sendInterfaceFlagsRange((ANIMATION_PICKER << 16) | ANIMATION_TOGGLE_CHILD, 0, LAST_ANIMATION_SLOT, TRANSMIT_OP1)
      .sendClientScript(ANIMATION_PICKER_INIT);
    return;
  }
  if (op !== 1) return;
  const left = minutesLeft(Number(player.getAttribute(LAST_HOME_TELEPORT_ATTRIBUTE)), COOLDOWN_MINUTES);
  if (left > 0) {
    player.sendMessage(`You need to wait another ${left} minutes to cast this spell.`);
    return;
  }
  if (home.members !== false && !core.WorldDefinition.isMembersWorld()) {
    player.sendMessage("You need to be on a members' world to use this spell.");
    return;
  }
  const destination = destinationFor(home);
  if (!core.TeleportHandler.checkReqs(player, destination)) return;
  if (core.CombatFactory.inCombat(player)) {
    player.sendMessage("You can't use this spell during combat.");
    return;
  }
  startHomeTeleport(core, player, destination, () => {
    const minute = dateMinutes();
    player.setAttribute(LAST_HOME_TELEPORT_ATTRIBUTE, minute);
    player.getPacketSender().sendConfig(LAST_HOME_TELEPORT_VARP, minute);
  });
}

const toggles = (player) => Number(player.getAttribute(TOGGLES_ATTRIBUTE) ?? 1);
const unlocked = (player) => Number(player.getAttribute(UNLOCKED_ATTRIBUTE) ?? 0);

/** Read: the scroll's text, then "learn the incantation?"; Yes consumes it and unlocks its animation. */
function readScroll({ player, itemId }) {
  const scroll = SCROLLS.find((entry) => core.ItemIdentifiers[entry.item] === itemId);
  const { DialogueChainBuilder, ItemStatementDialogue, OptionDialogue } = core;
  if (unlocked(player) & (1 << scroll.bit)) {
    player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(new ItemStatementDialogue(0, itemId,
      `This scroll contains ${scroll.incantation} which unlocks the ${scroll.name} home teleport animation. `
      + "However you have already unlocked this animation.")));
    return;
  }
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(
    new ItemStatementDialogue(0, itemId,
      `This scroll contains ${scroll.incantation} which will unlock a new home teleport animation.`),
    new OptionDialogue(1, {
      executeOption(option) {
        player.getPacketSender().sendInterfaceRemoval();
        if (Number(option) === 1) learnIncantation(player, scroll, itemId);
      },
    }, "Yes.", "No.").setTitle("Would you like to learn the incantation?"),
  ));
}

function learnIncantation(player, scroll, itemId) {
  const inventory = player.getInventory();
  if (!inventory.contains(itemId)) return;
  inventory.deleteNumber(itemId, 1);
  player.performAnimation(new core.Animation(scroll.animation));
  player.setAttribute(UNLOCKED_ATTRIBUTE, unlocked(player) | (1 << scroll.bit));
  player.getPacketSender().sendVarbit(scroll.varbit, 1);
}

/** The picker's "Toggle" on animation `slot`: as CS2 7756, a locked one, or the last one enabled, stays. */
function toggleAnimation(event) {
  if (event.groupId !== ANIMATION_PICKER || event.childId !== ANIMATION_TOGGLE_CHILD
      || (event.opId ?? event.action ?? 1) !== 1
      || !Number.isInteger(event.slot) || event.slot < 0 || event.slot > LAST_ANIMATION_SLOT) return;
  event.handled = true;
  const { player, slot } = event;
  const next = toggles(player) ^ (1 << slot);
  if (next <= 0 || (slot > 0 && !(unlocked(player) & (1 << slot)))) return;
  player.setAttribute(TOGGLES_ATTRIBUTE, next);
  player.getPacketSender().sendConfig(HOME_ANIMATION_TOGGLES_VARP, next);
}

function sendLastHomeTeleport({ player }) {
  const minute = Number(player.getAttribute(LAST_HOME_TELEPORT_ATTRIBUTE) ?? 0);
  if (minute > 0) player.getPacketSender().sendConfig(LAST_HOME_TELEPORT_VARP, minute);
  player.getPacketSender().sendConfig(HOME_ANIMATION_TOGGLES_VARP, toggles(player));
  for (const scroll of SCROLLS) {
    if (unlocked(player) & (1 << scroll.bit)) player.getPacketSender().sendVarbit(scroll.varbit, 1);
  }
}

module.exports = {
  name: "HomeTeleports",
  register(api) {
    core = api.core;
    api.persistAttribute(LAST_HOME_TELEPORT_ATTRIBUTE);
    api.persistAttribute(UNLOCKED_ATTRIBUTE, 0);
    api.persistAttribute(TOGGLES_ATTRIBUTE, 1);
    api.onInterfaceActionClick(castHomeTeleport);
    api.onInterfaceActionClick(toggleAnimation);
    api.onItemAction("Twisted teleport scroll", { Read: readScroll });
    api.onItemAction("Trailblazer teleport scroll", { Read: readScroll });
    api.onItemAction("Shattered teleport scroll", { Read: readScroll });
    api.onPlayerLogin(sendLastHomeTeleport);
  },
};

module.exports._test = { castHomeTeleport, minutesLeft, HOMES, LAST_HOME_TELEPORT_ATTRIBUTE };
