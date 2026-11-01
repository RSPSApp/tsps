"use strict";

// Pinball (random event): tag the pillar whose rings are glowing ten times. Tagging a pillar
// without rings resets the score. Leaving through the cave exit pays out noted gems.
// The posts, cave and room ship in the world data; the glow is the post animation 4005,
// stopped with 4006, not an object-id swap. See SOURCES.md.
const Flow = require("./DialogueFlow.RandomEvents");
const Teleports = require("./Teleports.RandomEvents");
const Rewards = require("./Rewards.RandomEvents");

// tile -> [inactive id, active id]. The map places the inactive id; 4005 animates it.
const POSTS = [
  [[1967, 5046], 8982, 8983],
  [[1969, 5049], 8984, 8994],
  [[1972, 5050], 9079, 8995],
  [[1975, 5049], 9081, 9080],
  [[1977, 5046], 9258, 9259],
];
const GLOW_ON = 4005; // pinball_post
const GLOW_OFF = 4006; // pinball_post_inactive
const FLIPPA_TILE = [1973, 5041];
const TILT_TILE = [1971, 5041];
// Noted sapphire/emerald/ruby: 3/10 each; noted diamond: 1/10 (cumulative roll limits).
const GEM_TABLE = [
  [1608, 5, 3, "five sapphires"],
  [1606, 5, 6, "five emeralds"],
  [1604, 5, 9, "five rubies"],
  [1602, 2, 10, "two diamonds"],
];
const TILT_INTRO = "You poke 10 flashing pillars, right? You NOT poke other pillars, " +
  "right? Okay, you go play now.";
const BEFORE_FINISH = [
  { player: true, text: "Err...what am I supposed to do here again?" },
  { text: "You gotta poke dem pillars." },
  { player: true, text: "What? All of them?" },
  { text: "No, no. If you poke dem ones dat don't have a dem flashin' rings, den dats bad." },
  { player: true, text: "So I have to poke the pillars that are flashing?" },
  { text: "Yer. You do dat ten times, you get prize." },
];
const AFTER_FINISH = [
  { player: true, text: "So...I'm free to go now, right?" },
  { text: "Yer, get going. We get break now." },
  { player: true, text: "Ok. Err...have a nice break." },
];

// The room is shared: one glowing post, one object per tile, cleared when the last player leaves.
const room = { objects: new Map(), glow: -1, owners: 0 };

module.exports = function attach(api, Events) {
  const N = api.core.NpcIdentifiers;
  const { Location, ObjectManager } = api.core;

  const definition = {
    id: N.FLIPPA_2,
    kind: "pinball",
    greeting: "Come play game,",
    talk(active, { teleport }) {
      const { player } = active;
      if (active.declined) {
        Flow.chat(api, { player, npcId: active.definition.id, lines: ["Going away now."] });
        return;
      }
      Flow.chat(api, {
        player,
        npcId: active.definition.id,
        lines: [`You want play game of pinball, ${player.getUsername()}?`],
        options: [
          ["Yes, pinball is fun.", () => teleport({
            kind: "pinball",
            arrive: { x: 1972, y: 5046, z: 0 },
            teleportRefusal: "Poke dem flashing pillars - you can't leave yet!",
            onStart: start,
          })],
          ["No thanks.", () => { active.declined = true; }],
        ],
      });
    },
  };

  // The posts are cache map objects: they live in MapObjects until a runtime copy replaces them.
  function findPost(location, ids) {
    const runtime = ObjectManager.objectsAt(location).find(object => ids.includes(object.getId()));
    if (runtime) return runtime;
    for (const id of ids) {
      const found = api.core.MapObjects.get(id, location.clone(), null);
      if (found) return found;
    }
    return null;
  }

  function ensureRoom(session) {
    if (room.owners === 0) {
      for (const [tile, inactive, active] of POSTS) {
        const location = new Location(tile[0], tile[1], 0);
        const found = findPost(location, [inactive, active]);
        if (found) room.objects.set(`${tile[0]},${tile[1]}`, { object: found, location, inactive, active });
      }
      pickGlow();
    }
    room.owners++;
    animatePosts(session);
    Teleports.onEnd(session, () => {
      if (--room.owners > 0) return;
      room.objects.clear();
      room.glow = -1;
    });
  }

  function animate(session, object, sequence) {
    session.player.getPacketSender?.()?.sendObjectAnimation?.(object, new api.core.Animation(sequence));
  }

  function pickGlow() {
    let next = room.glow;
    while (next === room.glow && POSTS.length > 1) next = Math.floor(Math.random() * POSTS.length);
    room.glow = next;
  }

  function animatePosts(session) {
    room.objects.forEach((entry, key) => {
      const index = POSTS.findIndex(([tile]) => `${tile[0]},${tile[1]}` === key);
      const current = findPost(entry.location, [entry.active, entry.inactive]);
      if (!current) return;
      room.objects.set(key, { ...entry, object: current });
      animate(session, current, index === room.glow ? GLOW_ON : GLOW_OFF);
    });
  }

  function start(session) {
    ensureRoom(session);
    session.data.score = 0;
    session.data.done = false;
    session.flippa = Teleports.spawnNpc(session, { id: N.FLIPPA, x: FLIPPA_TILE[0], y: FLIPPA_TILE[1],
      z: 0, wanderRadius: 0, face: 3, ownerOnly: true });
    session.tilt = Teleports.spawnNpc(session, { id: N.TILT, x: TILT_TILE[0], y: TILT_TILE[1],
      z: 0, wanderRadius: 0, face: 4, ownerOnly: true });
    Flow.chat(api, { player: session.player, npcId: N.TILT, lines: [TILT_INTRO] });
  }

  api.onCustomEvent(Events.DEFINITIONS_EVENT, payload => payload.definitions.push(definition));

  api.onObjectInteraction("Pinball Post", { Tag: tag });

  function tag(event) {
    const session = Teleports.sessionOf(event.player);
    if (!session || session.kind !== "pinball") return false;
    event.handled = true;
    const location = event.object.getLocation();
    const index = POSTS.findIndex(([tile]) => tile[0] === location.getX() && tile[1] === location.getY());
    if (index < 0) return true;
    if (session.data.done) return true;
    if (index === room.glow) {
      session.data.score++;
      if (session.data.score >= 10) {
        session.data.done = true;
        animate(session, event.object, GLOW_OFF);
        event.player.sendMessage("Congratulations, you have won!");
        event.player.sendMessage("You may now leave the game area.");
        return true;
      }
      pickGlow();
      animatePosts(session);
    } else {
      session.data.score = 0;
    }
    return true;
  }

  // 6744 spells the action "Talk-to"; the two-tile room NPCs 5427/5428 spell it "Talk-To".
  api.onNpcInteraction("Flippa", { "Talk-to": talkFlippa, "Talk-To": talkFlippa });
  api.onNpcInteraction("Tilt", { "Talk-to": talkTilt, "Talk-To": talkTilt });

  function talkFlippa(event) {
    return talkRoomNpc(event, "flippa");
  }

  function talkTilt(event) {
    return talkRoomNpc(event, "tilt");
  }

  function talkRoomNpc(event, key) {
    const session = Teleports.sessionOf(event.player);
    if (!session || session.kind !== "pinball" || event.npc !== session[key]) return false;
    event.handled = true;
    Flow.chat(api, {
      player: event.player,
      npcId: event.npc.getId(),
      pages: session.data.done ? AFTER_FINISH : BEFORE_FINISH,
    });
    return true;
  }

  api.onObjectInteraction("Cave Exit", { Exit: exit });
  api.onObjectInteraction("Cave Exit", { Use: exit });

  function exit(event) {
    const session = Teleports.sessionOf(event.player);
    if (!session || session.kind !== "pinball") return false;
    event.handled = true;
    if (!session.data.done) {
      Teleports.finish(session);
      return true;
    }
    const roll = Math.floor(Math.random() * 10);
    const reward = GEM_TABLE.find(([, , limit]) => roll < limit);
    if (!Teleports.finish(session)) return true;
    event.player.sendMessage(`You were awarded ${reward[3]}!`);
    Rewards.give(api, event.player, [{ id: reward[0], amount: reward[1] }]);
    return true;
  }
};

module.exports._test = { room, POSTS, GLOW_ON, GLOW_OFF };
