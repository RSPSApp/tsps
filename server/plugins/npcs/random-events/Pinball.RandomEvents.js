"use strict";

// Pinball (random event): tag the pillar whose rings are glowing ten times. Tagging a pillar
// without rings resets the score. Leaving through the cave exit pays out noted gems.
// The posts, cave and room ship in the world data; the glow is the post animation 4005,
// stopped with 4006, not an object-id swap. Live is an instance, and the animations are sent
// to one player only, so every player keeps their own glowing post. See SOURCES.md.
const Flow = require("./DialogueFlow.RandomEvents");
const Teleports = require("./Teleports.RandomEvents");
const Rewards = require("./Rewards.RandomEvents");

// tile, inactive id, active id, the post's sound. The map places the inactive id; 4005 animates it.
const POSTS = [
  [[1967, 5046], 8982, 8983, 2279],
  [[1969, 5049], 8984, 8994, 2280],
  [[1972, 5050], 9079, 8995, 2281],
  [[1975, 5049], 9081, 9080, 2282],
  [[1977, 5046], 9258, 9259, 2283],
];
const GLOW_ON = 4005; // pinball_post
const GLOW_OFF = 4006; // pinball_post_inactive
const TAG_ANIMATION = 832;
const TAG_ANIMATION_DELAY = 1;
const TAG_RESULT_DELAY = 3;
const NEEDED = 10;
// Chathead animations as sent live (1098).
const PLAYER_EXPRESSION = 567;
const INVITE_EXPRESSION = 554;
const TILT_EXPRESSION = 590;
const NAGS = [name => `Come play game, ${name}!`, name => `We got good game, ${name}!`,
  name => `You want play game, ${name}!`, name => `You like hitting things, ${name}?`];
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

module.exports = function attach(api, Events) {
  const N = api.core.NpcIdentifiers;
  const { Location, ObjectManager } = api.core;

  const definition = {
    id: N.FLIPPA_2,
    kind: "pinball",
    greet: name => NAGS[Math.floor(Math.random() * NAGS.length)](name),
    nags: NAGS,
    goodbye: "Maybe later.",
    linger: true,
    otherPlayerLine: () => "Nope, you wrong person.",
    leavingLine: () => "Going away now.",
    talk(active, { teleport, leave }) {
      const { player } = active;
      Flow.chat(api, {
        player,
        npcId: active.definition.id,
        title: "What would you like to say?",
        lines: [{ text: `You want play game of pinball, ${player.getUsername()}?`, expression: INVITE_EXPRESSION }],
        options: [
          ["Yes, pinball is fun.", () => reply(player, "Yes, pinball is fun.", () => teleport({
            kind: "pinball",
            arrive: { x: 1972, y: 5046, z: 0 },
            hideTabs: true,
            onStart: start,
          }))],
          ["No thanks.", () => { leave(active); reply(player, "No thanks."); }],
        ],
      });
    },
  };

  function reply(player, text, onEnd = null) {
    Flow.chat(api, { player, pages: [{ player: true, text, expression: PLAYER_EXPRESSION }], onEnd });
  }

  // The posts are cache map objects: they live in MapObjects until a runtime copy replaces them.
  function findPost(index) {
    const [tile, inactive, active] = POSTS[index];
    const location = new Location(tile[0], tile[1], 0);
    const runtime = ObjectManager.objectsAt(location).find(object => [inactive, active].includes(object.getId()));
    if (runtime) return runtime;
    for (const id of [inactive, active]) {
      const found = api.core.MapObjects.get(id, location.clone(), null);
      if (found) return found;
    }
    return null;
  }

  function animate(session, index, sequence) {
    const sender = session.player.getPacketSender?.();
    const post = findPost(index);
    if (post) sender?.sendObjectAnimation?.(post, new api.core.Animation(sequence));
    sender?.sendSound?.(POSTS[index][3], 0, 0);
  }

  // Live moves the glow to a different post every time, sending only the two that change.
  function moveGlow(session) {
    const previous = session.data.glow;
    const others = POSTS.map((_, index) => index).filter(index => index !== previous);
    const next = others[Math.floor(Math.random() * others.length)];
    session.data.glow = next;
    if (previous >= 0) animate(session, previous, GLOW_OFF);
    animate(session, next, GLOW_ON);
  }

  function start(session) {
    session.data.score = 0;
    session.data.done = false;
    session.data.glow = -1;
    session.data.tagging = false;
    moveGlow(session);
    Teleports.onEnd(session, () => session.player.getMovementQueue?.()?.setBlockMovement?.(false));
    session.flippa = Teleports.spawnNpc(session, { id: N.FLIPPA, x: FLIPPA_TILE[0], y: FLIPPA_TILE[1],
      z: 0, wanderRadius: 0, face: 3, ownerOnly: true });
    session.tilt = Teleports.spawnNpc(session, { id: N.TILT, x: TILT_TILE[0], y: TILT_TILE[1],
      z: 0, wanderRadius: 0, face: 4, ownerOnly: true });
    Flow.chat(api, { player: session.player, npcId: N.TILT,
      lines: [{ text: TILT_INTRO, expression: TILT_EXPRESSION }] });
  }

  api.onCustomEvent(Events.DEFINITIONS_EVENT, payload => payload.definitions.push(definition));

  api.onObjectInteraction("Pinball Post", { Tag: tag });

  function tag(event) {
    const session = Teleports.sessionOf(event.player);
    if (!session || session.kind !== "pinball") return false;
    event.handled = true;
    const location = event.object.getLocation();
    const index = POSTS.findIndex(([tile]) => tile[0] === location.getX() && tile[1] === location.getY());
    if (index < 0 || session.data.done || session.data.tagging) return true;
    const { player } = event;
    session.data.tagging = true;
    player.getMovementQueue?.()?.setBlockMovement?.(true);
    player.setPositionToFace(location);
    Teleports.later(session, TAG_ANIMATION_DELAY, () => player.performAnimation(new api.core.Animation(TAG_ANIMATION)));
    Teleports.later(session, TAG_RESULT_DELAY, () => {
      session.data.tagging = false;
      player.getMovementQueue?.()?.setBlockMovement?.(false);
      resolveTag(session, index);
    });
    return true;
  }

  function resolveTag(session, index) {
    if (index !== session.data.glow) {
      session.data.score = 0;
      return;
    }
    session.data.score++;
    if (session.data.score < NEEDED) {
      moveGlow(session);
      return;
    }
    session.data.done = true;
    session.player.sendMessage("Congratulations, you have won!");
    session.player.sendMessage("You may now leave the game area.");
    animate(session, index, GLOW_OFF);
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

module.exports._test = { POSTS, GLOW_ON, GLOW_OFF };
