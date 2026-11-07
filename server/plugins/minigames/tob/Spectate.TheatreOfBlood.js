"use strict";

/**
 * Spectating the Theatre of Blood: from the entrance without a party, or Abigaila's scrying ball.
 *
 * Wiki (Theatre of Blood, Spectating; Transcript:Abigaila): by a team member's or a spectator's name,
 * or the most recently formed party; the same world; a private chat set to friends only needs the
 * viewer on their friends list; nothing carried (the oculus orb excepted), not poisoned or diseased.
 * Captured (227/01764): the entrance's "You are not in a party..." with both Observe options (struck
 * through there, on a Leagues world). Estimates (no capture spectates): where they stand (the room's
 * `spectate` tile, its entrance where there is none), teleporting away being how they leave, and the
 * message when no party is found. Not built: right-clicking the ledges for a better view, the
 * camera's chatbox buttons and the war table.
 */

const Shared = require("./Shared.TheatreOfBlood");
const Raid = require("./RaidState.TheatreOfBlood");

const ABIGAILA = 8368;
const ORB = "Oculus orb";
const NOT_READY = "I'm afraid I can't let you use my scrying ball now, dear. Clear out everything you're carrying, and make sure you're not sick or poisoned.";

function carriesAnything(player) {
  const { ItemDefinition } = Shared.core();
  const isOrb = (item) => ItemDefinition.forId(item.getId())?.getName?.() === ORB;
  for (const container of [player.getInventory(), player.getEquipment()]) {
    for (const item of container.getItems()) if (item && item.getId() > 0 && !isOrb(item)) return true;
  }
  return false;
}

function isSick(player) {
  return !!player.isPoisoned?.() || !!player.isDiseased?.();
}

function mayWatch(player) {
  return !carriesAnything(player) && !isSick(player) && !Raid.raidOf(player);
}

function recentRaid() {
  let latest = null;
  for (const raid of Raid.raids.values()) if (!raid.over && (!latest || raid.id > latest.id)) latest = raid;
  return latest;
}

function selectionOfName(name) {
  const wanted = String(name ?? "").trim().toLowerCase();
  for (const raid of Raid.raids.values()) {
    if (raid.over) continue;
    const player = [...raid.players, ...raid.spectators].find((candidate) =>
      Shared.displayName(candidate).toLowerCase() === wanted || candidate.getUsername().toLowerCase() === wanted);
    if (player) return { raid, player };
  }
  return null;
}

function raidOfName(name) {
  return selectionOfName(name)?.raid ?? null;
}

/** A named subject owns the list; Recent Party retains its existing admission events. */
function mayWatchRaid(viewer, raid, subject) {
  return (subject ? [subject] : raid.players).every((member) => {
    const request = { player: member, viewer, allowed: true, namedSubject: !!subject };
    Shared.api().emitCustomEvent("tob:may-spectate", request);
    return request.allowed;
  });
}

function friendsOnlyAdmission(request) {
  if (!request.namedSubject) return;
  const { PrivateChatStatus } = Shared.core();
  const relations = request.player.getRelations();
  if (relations.getStatus() === PrivateChatStatus.FRIENDS_ONLY && !relations.hasFriend(request.viewer.getLongUsername())) {
    request.allowed = false;
  }
}

function placeIn(viewer, raid, room) {
  const tile = room?.def.spectate ?? room?.def.entrance;
  if (!tile) return;
  viewer.moveTo(Shared.loc(tile, tile.z ?? room.def.entrance.z));
  // Not held in place: a blocked player can't teleport, and teleporting is how they leave.
  viewer.getMovementQueue().reset();
  Shared.fade(viewer, 255, room.def.name);
  raid.openHud(viewer);
}

function watch(viewer, raid, subject) {
  if (!raid || raid.over) {
    viewer.sendMessage("There's no such party in the Theatre right now.");
    return;
  }
  if (!mayWatchRaid(viewer, raid, subject)) {
    viewer.sendMessage("That party's members aren't accepting spectators.");
    return;
  }
  raid.spectators.add(viewer);
  viewer.setUntargetable(true);
  raid.area.enter(viewer);
  placeIn(viewer, raid, raid.room);
}

function stopWatching(player, raid) {
  raid.spectators.delete(player);
  player.getMovementQueue().setBlockMovement(false);
  player.setUntargetable(false);
  raid.closeHud(player);
}

/** The party reached another room: the spectators follow it. */
function roomBuilt({ raid, room }) {
  for (const viewer of raid.spectators) placeIn(viewer, raid, room);
}

/** Spectators leave when the party is gone. */
function raidOver({ raid }) {
  for (const viewer of [...raid.spectators]) {
    stopWatching(viewer, raid);
    if (viewer.getArea?.() === raid.area) raid.area.leave(viewer, false);
    viewer.moveTo(Shared.loc(Shared.OUTSIDE));
  }
}

function observe({ player, recent }) {
  if (!mayWatch(player)) {
    player.sendMessage("You can't bring any items with you to spectate, or be poisoned or diseased.");
    return;
  }
  if (recent) {
    watch(player, recentRaid());
    return;
  }
  player.getPacketSender().sendInterfaceRemoval();
  player.setEnteredSyntaxAction?.({ execute: (name) => {
    const selection = selectionOfName(name);
    watch(player, selection?.raid, selection?.player);
  } });
  player.getPacketSender().sendEnterInputPrompt?.("Enter a player's name:");
}

function scry(player) {
  const { DialogueChainBuilder, ActionDialogue } = Shared.core();
  if (!mayWatch(player)) {
    Shared.npcSay(player, ABIGAILA, NOT_READY);
    return;
  }
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(
    new ActionDialogue(0, {
      execute: () => Shared.options(player, "Select an Option",
        "Observe a specific party", () => observe({ player, recent: false }),
        "Observe recent party", () => observe({ player, recent: true }),
        "Cancel", () => {}),
    }),
  ));
}

function clickScry({ player }) {
  scry(player);
  return true;
}

/** Talk-to: Transcript:Abigaila, its story trimmed to the option that matters here. */
function talkTo({ player }) {
  Shared.options(player, "What can I help you with, dear?",
    "I'd like to look in your scrying ball.", () => scry(player),
    "I'll leave you be.", () => {});
  return true;
}

module.exports = function registerTheatreSpectate(api) {
  Shared.bind(api);
  api.onCustomEvent("tob:observe", observe);
  api.onCustomEvent("tob:may-spectate", friendsOnlyAdmission);
  api.onCustomEvent("tob:room-built", roomBuilt);
  api.onCustomEvent("tob:raid-over", raidOver);
  api.onNpcInteraction("Abigaila", { "Talk-to": talkTo, Scry: clickScry });
};

Object.assign(module.exports, { mayWatch, watch, stopWatching, observe, recentRaid, raidOfName, roomBuilt, raidOver, carriesAnything });
