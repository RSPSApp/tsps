"use strict";

// Mime (random event, Mysterious Old Man): copy the mime's emote four times. The eight
// buttons of cache interface 188 (macro_mime_emotes) are built by the cache's own onLoad;
// the server only enables them and receives the "Perform" clicks. Outfit pieces in order,
// then lamps. See SOURCES.md.
// Copy / Cheer / Cry behaviour: https://oldschool.runescape.wiki/w/Mime_(Random_Event)
const Flow = require("./DialogueFlow.RandomEvents");
const Teleports = require("./Teleports.RandomEvents");

const GROUP = 188;
const FIRST_BUTTON = 2;
// Cache 241 dump:widget 188 / dump:cs2 3800: components 2..9 in onLoad order.
const EMOTES = [
  { name: "Think", animation: 857, cycles: 90 },
  { name: "Laugh", animation: 861, cycles: 88 },
  { name: "Climb rope", animation: 1130, cycles: 166 },
  { name: "Glass box", animation: 1131, cycles: 89 },
  { name: "Cry", animation: 860, cycles: 88 },
  { name: "Dance", animation: 866, cycles: 204 },
  { name: "Lean", animation: 1129, cycles: 154 },
  { name: "Glass wall", animation: 1128, cycles: 206 },
];
// Cache 241 dump:seq 857 861 1130 1131 860 866 1129 1128 862: frame-length sums
// (20 ms client cycles; 30 per game tick).
const CYCLES_PER_TICK = 30;
const CHEER = 862;
const CRY = 860;
const CHEER_CYCLES = 120;
const CRY_CYCLES = 88;
const OUTFIT = [3057, 3058, 3059, 3060, 3061];
const NEEDED = 4;
// Cache 241 region 8010: macro_spotlight (15625) is 3x3 at (2007,4761), physical plane 1;
// its center is (2008,4762). The other spotlight centers on the static Mime at (2011,4762).
// Stage tiles carry bridge bit 2, so actors use logical plane 0. This is a cache-supported
// stage position; an authentic teleport capture is still needed to certify the exact OSRS tile.
const STAGE_ARRIVAL = { x: 2008, y: 4762, z: 0 };

function animationTicks(cycles) {
  // The client advances the final frame when cycle > length (PlayerAnimController / tick3).
  return Math.ceil((cycles + 1) / CYCLES_PER_TICK);
}

module.exports = function attach(api, Events) {
  const I = api.core.ItemIdentifiers;
  const N = api.core.NpcIdentifiers;

  const definition = {
    id: N.MYSTERIOUS_OLD_MAN_5, // 6753, the mime invitation variant
    kind: "mime",
    greeting: "Hello?",
    talk(active, { teleport }) {
      const { player } = active;
      Flow.chat(api, {
        player,
        npcId: definition.id,
        lines: [`Hey, ${player.getUsername()}, would you like to come and perform in a mime show?`],
        options: [
          ["Yeah, I'd love to do a mime show.", () => teleport({
            kind: "mime",
            arrive: STAGE_ARRIVAL,
            teleportRefusal: "I need to finish my performance!",
            onStart: start,
          })],
          ["Sorry, I'm busy.", () => {}],
        ],
      });
    },
  };

  function start(session) {
    session.data.correct = 0;
    session.interfaceId = GROUP;
    Teleports.onEnd(session, () => {
      session.data.phase = "finished";
      closeChoices(session);
    });
    nextEmote(session);
  }

  function openChoices(session) {
    session.data.phase = "answering";
    const sender = session.player.getPacketSender();
    // Cache root188:0 is 512x85, with two rows of buttons and heads at either end.
    sender.sendChatboxInterface(GROUP);
    for (let component = FIRST_BUTTON; component < FIRST_BUTTON + EMOTES.length; component++) {
      sender.sendInterfaceFlagsRange((GROUP << 16) | component, -1, -1, 1 << 1);
    }
  }

  function closeChoices(session) {
    const sender = session.player.getPacketSender();
    if (sender.isChatboxInterface(GROUP)) sender.sendInterfaceRemoval();
  }

  function nextEmote(session) {
    session.data.phase = "demonstrating";
    closeChoices(session);
    const emote = EMOTES[Math.floor(Math.random() * EMOTES.length)];
    session.data.emote = emote;
    const mime = findMime(session);
    if (mime) mime.performAnimation(new api.core.Animation(emote.animation));
    else session.player.sendMessage(`The mime performs: ${emote.name}.`);
    Teleports.later(session, animationTicks(emote.cycles), () => openChoices(session));
  }

  function findMime(session) {
    const player = session.player;
    const location = player.getLocation();
    const npcs = api.getWorld?.()?.getNpcsNear?.(location, 15, player.getPrivateArea?.() ?? null) ?? [];
    return npcs.find(npc => npc.getId?.() === N.MIME);
  }

  function choose(event) {
    const { player, buttonId } = event;
    if ((buttonId >>> 16) !== GROUP) return;
    const index = (buttonId & 0xffff) - FIRST_BUTTON;
    if (index < 0 || index >= EMOTES.length) return;
    event.handled = true;
    const session = Teleports.sessionOf(player);
    if (event.action !== 1 || !session || session.kind !== "mime" || session.data.phase !== "answering" ||
        !player.getPacketSender().isChatboxInterface(GROUP)) return;
    session.data.phase = "reacting";
    closeChoices(session);
    if (EMOTES[index] !== session.data.emote) {
      player.performAnimation(new api.core.Animation(CRY));
      player.sendMessage("That's not the emote the mime is performing.");
      Teleports.later(session, animationTicks(CRY_CYCLES), () => openChoices(session));
      return;
    }
    player.performAnimation(new api.core.Animation(CHEER));
    session.data.correct++;
    Teleports.later(session, animationTicks(CHEER_CYCLES), () => {
      if (session.data.correct >= NEEDED) finish(session);
      else nextEmote(session);
    });
  }

  function finish(session) {
    const player = session.player;
    const rewards = [];
    const missing = OUTFIT.find(piece => !Teleports.owns(player, piece));
    if (missing !== undefined) {
      rewards.push({ id: missing, amount: 1 });
      player.sendMessage("The mime gives you a piece of the mime outfit.");
    } else {
      rewards.push({ id: I.LAMP, amount: 1 });
      player.sendMessage("The mime gives you a lamp.");
    }
    closeChoices(session);
    Teleports.finish(session, { reward: rewards });
  }

  api.onCustomEvent(Events.DEFINITIONS_EVENT, payload => payload.definitions.push(definition));
  api.onInterfaceActionClick(choose);

  api.onObjectInteraction("Large door", { Open: blockDoor, Close: blockDoor, Walk: blockDoor });

  function blockDoor(event) {
    const session = Teleports.sessionOf(event.player);
    if (!session || session.kind !== "mime") return false;
    event.handled = true;
    event.player.sendMessage("I need to finish my performance!");
    return true;
  }
};
