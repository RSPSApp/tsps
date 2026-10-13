/**
 * The boat on route 3 (captured): bubbles, then four tentacles one after another and the head
 * of the swamp creature, each rising for a few ticks before it fights, the follower narrating.
 * Killing a tentacle weakens the creature; the head heals in full while a tentacle lives
 * (Wiki). The head's death takes the boat on (4000 points); the boat's Escape-event ends the
 * trek.
 */
const Common = require("./Common.TempleTrekking");
const Trek = require("./Trek.TempleTrekking");
const Combat = require("./Combat.TempleTrekking");

const BUBBLES_SOUND = 852;
const TENTACLE_SOUND = 1811;
const HEAD_SOUND = 1814;
const RISE_TICKS = 4;
const HEAD_RISE_TICKS = 6;
/** The head heals in full when it would drop below this share with a tentacle alive. */
const HEAD_HEAL_SHARE = 0.25;
const AFTER_HEAD_TICKS = 2;

/** The captured script, in ticks from arrival: lines, tentacles and the head. */
const SCRIPT = [
  [3, "line", "Wh...what are those bubbles?"],
  [9, "line", "This is scary!"],
  [13, "line", "Ahhh, that would be a tentacle..."], [13, "tentacle", 0],
  [19, "line", "Ahhh, two tentacles!"], [19, "tentacle", 1],
  [25, "line", "...three tentacles!"], [25, "tentacle", 2],
  [31, "tentacle", 3],
  [36, "line", "I think I'm going to faint!"], [36, "head"],
  [43, "line", "Blimey! Look at that beast! You're gonna have to sort that thing out on your own!"],
];

/** A follower's line in the chatbox with nothing to click: it moves on by itself. */
function say(trek, text) {
  Common.chat(trek.player, [["npc", trek.follower.id, text]]);
}

function rise(trek, room, spawning, fighting, [x, y], ticks, sound) {
  // The boat is on the room's top plane, where the player stands.
  const npc = trek.spawn(spawning, [x, y, room.spec.entry[2]]);
  if (!npc) return null;
  npc.__trekMonster = true;
  npc.__trekReadyAt = Number.MAX_SAFE_INTEGER;
  // They rise out of the water by the boat and stay there.
  npc.getMovementQueue().setBlockMovement(true);
  Common.sound(trek.player, sound);
  room.monsters.add(npc);
  trek.schedule(ticks, () => {
    if (!npc.isRegistered?.()) return;
    npc.setNpcTransformationId(fighting);
    npc.__trekReadyAt = trek.tickCount;
  });
  return npc;
}

function start(trek, room) {
  const { npcs } = Common.data;
  const { spec } = room;
  room.total = 0;
  room.state = { tentacles: new Set(), head: null };
  Common.varbit(trek.player, "busy", 1);
  Common.sound(trek.player, BUBBLES_SOUND);
  for (const [at, kind, value] of SCRIPT) {
    trek.schedule(at, () => {
      if (kind === "line") say(trek, value);
      else if (kind === "tentacle") {
        const npc = rise(trek, room, npcs.templetrek_tentacle_arm_spawning, npcs.templetrek_tentacle_arm, spec.tentacles[value], RISE_TICKS, TENTACLE_SOUND);
        if (npc) room.state.tentacles.add(npc);
      } else if (kind === "head") {
        room.state.head = rise(trek, room, npcs.templetrek_tentacle_head_spawning, npcs.templetrek_tentacle_head, spec.head, HEAD_RISE_TICKS, HEAD_SOUND);
      }
    });
  }
  trek.schedule(SCRIPT[SCRIPT.length - 1][0] + 5, () => {
    Common.closeChat(trek.player);
    Common.varbit(trek.player, "busy", 0);
  });
}

function tick(trek, room) {
  // The tentacles and head go for whoever is in front of them, as the other monsters do.
  for (const npc of room.monsters) {
    if (!npc.isRegistered?.() || npc.getHitpoints() <= 0 || trek.tickCount < npc.__trekReadyAt) continue;
    const combat = npc.getCombat();
    if (!combat.getTarget?.()) combat.attack(Combat.pickTarget(trek));
  }
}

/** Kills on the boat: no kill points; a tentacle weakens the head, the head ends it. */
function boatDeath(event) {
  const npc = event.npc;
  const trek = npc?.__templeTrek;
  const room = trek?.room;
  if (room?.key !== "boat") return;
  if (room.state.tentacles.delete(npc)) {
    room.monsters.delete(npc);
    trek.player.sendMessage("You slay a tentacle... the swamp creature seems to weaken.");
    return;
  }
  if (npc !== room.state.head) return;
  room.monsters.delete(npc);
  room.complete = true;
  room.points = Common.data.points.tentacles;
  trek.schedule(AFTER_HEAD_TICKS, () => trek.succeed());
}

/** The head won't go down while a tentacle still lives. */
function headHeals({ npc, hit }) {
  const trek = npc?.__templeTrek;
  const room = trek?.room;
  if (room?.key !== "boat" || npc !== room.state.head || room.state.tentacles.size === 0) return;
  const left = npc.getHitpoints() - (hit?.getTotalDamage?.() ?? 0);
  if (left < npc.getMaxHitpoints() * HEAD_HEAL_SHARE) {
    for (const damage of hit.getHits?.() ?? []) damage.setDamage(0);
    hit.updateTotalDamage?.();
    npc.setHitpoints(npc.getMaxHitpoints());
  }
}

function continueTrek(event) {
  const trek = Trek.trekOf(event.player);
  if (trek?.room?.key !== "boat") return false;
  trek.succeed();
  return true;
}

function escapeEvent(event) {
  const trek = Trek.trekOf(event.player);
  if (trek?.room?.key !== "boat") return false;
  trek.escape();
  return true;
}

function attachBoat(api) {
  Trek.registerEvent("boat", { room: () => Common.data.rooms.boat, start, tick });
  api.onNpcBeforeDeath(boatDeath);
  api.onNpcHitModify(headHeals);
  api.onObjectInteraction("Boat", { "Continue-trek": continueTrek, "Escape-event": escapeEvent });
}

module.exports = { attachBoat };
