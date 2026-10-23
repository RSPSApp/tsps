"use strict";

// Pinball (random event): tag the pillar whose rings are glowing ten times. Tagging a pillar
// without rings resets the score. Leaving through the cave exit pays out noted gems.
// The posts, cave and room ship in the world data; the glow swaps object ids. See SOURCES.md.
const Flow = require("./DialogueFlow.RandomEvents");
const Teleports = require("./Teleports.RandomEvents");

// tile -> [inactive id, active id]
const POSTS = [
  [[1967, 5046], 8982, 8983],
  [[1969, 5049], 8984, 8994],
  [[1972, 5050], 9079, 8995],
  [[1975, 5049], 9081, 9080],
  [[1977, 5046], 9258, 9259],
];
const EXIT = 9293;
// Noted sapphire/emerald/ruby: 3/10 each; noted diamond: 1/10 (cumulative roll limits).
const GEM_TABLE = [[1608, 5, 3], [1606, 5, 6], [1604, 5, 9], [1602, 2, 10]];

// The room is shared: one glowing post, one object per tile, restored when the last player leaves.
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
      Flow.chat(api, {
        player,
        npcId: active.definition.id,
        lines: [`You want play game of pinball, ${player.getUsername()}?`],
        options: [
          ["Yes, pinball is fun.", () => teleport({
            kind: "pinball",
            arrive: { x: 1973, y: 5046, z: 0 },
            teleportRefusal: "Poke dem flashing pillars - you can't leave yet!",
            onStart: start,
          })],
          ["No thanks.", () => {}],
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
    Teleports.onEnd(session, () => {
      if (--room.owners > 0) return;
      for (const entry of room.objects.values()) {
        const current = findPost(entry.location, [entry.active]);
        if (current) Teleports.replaceObject(current, entry.inactive);
      }
      room.objects.clear();
      room.glow = -1;
    });
  }

  function pickGlow() {
    let next = room.glow;
    while (next === room.glow && POSTS.length > 1) next = Math.floor(Math.random() * POSTS.length);
    room.glow = next;
    room.objects.forEach((entry, key) => {
      const index = POSTS.findIndex(([tile]) => `${tile[0]},${tile[1]}` === key);
      const wanted = index === room.glow ? entry.active : entry.inactive;
      const current = findPost(entry.location, [entry.active, entry.inactive]);
      if (current && current.getId() !== wanted) {
        const replaced = Teleports.replaceObject(current, wanted);
        room.objects.set(key, { ...entry, object: replaced });
      }
    });
  }

  function start(session) {
    ensureRoom(session);
    session.data.score = 0;
    session.data.done = false;
    session.player.sendMessage("You poke 10 flashing pillars, right? You NOT poke other pillars, right? Okay, you go play now.");
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
    const player = event.player;
    if (session.data.done) {
      player.sendMessage("You've poked enough pillars - head for the cave exit.");
      return true;
    }
    if (index === room.glow) {
      session.data.score++;
      player.sendMessage(`You poke a flashing pillar. ${session.data.score}/10`);
      if (session.data.score >= 10) {
        session.data.done = true;
        player.sendMessage("You've finished! Flippa says: Yer, get going. We get break now.");
        return true;
      }
    } else {
      session.data.score = 0;
      player.sendMessage("That pillar wasn't flashing - your score resets to zero!");
    }
    pickGlow();
    return true;
  }

  api.onObjectInteraction("Cave Exit", { Exit: exit });
  api.onObjectInteraction("Cave Exit", { Use: exit });

  function exit(event) {
    const session = Teleports.sessionOf(event.player);
    if (!session || session.kind !== "pinball") return false;
    event.handled = true;
    if (!session.data.done) {
      Teleports.finish(session, { message: "You leave the pinball room without a prize." });
      return true;
    }
    const roll = Math.floor(Math.random() * 10);
    const reward = GEM_TABLE.find(([, , limit]) => roll < limit);
    Teleports.finish(session, { reward: [{ id: reward[0], amount: reward[1] }],
      message: "You cash in your pinball prize." });
    return true;
  }
};

module.exports._test = { room, POSTS };
