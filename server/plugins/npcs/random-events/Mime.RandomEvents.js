"use strict";

// Mime (random event, Mysterious Old Man): copy the mime's emote four times. The eight
// buttons of cache interface 188 (macro_mime_emotes) are built by the cache's own onLoad;
// the server only enables them and receives the "Perform" clicks. See SOURCES.md.
// Packet order and timings: rsprox 1855, 1885, 127, 75 (r227) and 1098, 1104 (r237).
// Copy / Cheer / Cry behaviour: https://oldschool.runescape.wiki/w/Mime_(Random_Event)
const Flow = require("./DialogueFlow.RandomEvents");
const Teleports = require("./Teleports.RandomEvents");
const Rewards = require("./Rewards.RandomEvents");

const GROUP = 188;
const FIRST_BUTTON = 2;
// Cache 241 dump:widget 188 / dump:cs2 3800: components 2..9 in onLoad order. The player's
// animation for each button is confirmed by 1104 and 1885.
const EMOTES = [
  { name: "Think", animation: 857 },
  { name: "Laugh", animation: 861 },
  { name: "Climb rope", animation: 1130 },
  { name: "Glass box", animation: 1131 },
  { name: "Cry", animation: 860 },
  { name: "Dance", animation: 866 },
  { name: "Lean", animation: 1129 },
  { name: "Glass wall", animation: 1128 },
];
const CHEER = 862;
const CRY = 860;
const MIME_BOW = 858;
const OUTFIT = [3057, 3058, 3059, 3060, 3061];
const TELEPORT_SOUND = 1930;
/** The mime emotes' varbits and the names their unlock message uses (75, 127, 1098, 1855). */
const EMOTE_UNLOCKS = new Map([
  ["emote_glassbox", "Glass Box"], ["emote_climbrope", "Climb Rope"],
  ["emote_lean", "Lean"], ["emote_glasswall", "Glass Wall"],
]);
const NEEDED = 4;
// Live chat type of a line also shown in a message box (MessageGame type 115 in the captures).
const MESBOX_CHAT = 115;
// Every capture lands on (2008,4764), then moves the player onto the spotlight at (2008,4762)
// the tick the chat is continued; the mime stands at (2011,4762).
const ARRIVAL = { x: 2008, y: 4764, z: 0 };
const STAGE = { x: 2008, y: 4762, z: 0 };
const MIME_TILE = { x: 2011, y: 4762, z: 0 };
// Transcript:Mysterious_Old_Man's waiting lines; 75, 127, 1104, 1855 and 1885 open with them.
const OVERHEADS = [name => `${name}!`, name => `Hello? ${name}?`, name => `Talk to me, ${name}!`,
  name => `${name}? Are you there?`, name => `I'd like to talk to you, ${name}!`];
const NPC_CHAT = 231;
// The mime's loop runs on fixed ticks whatever the player does: it turns away, performs two
// ticks later, bows at the player six ticks after that, the buttons open two ticks later and
// it turns away again 19 ticks on, 29 ticks per performance in all six recordings.
const TURN_TO_EMOTE = 2;
const EMOTE_TO_BOW = 6;
const BOW_TO_BUTTONS = 2;
const BUTTONS_TO_TURN = 19;
// The player copies the moment they click, reacts seven ticks later, and a fourth correct
// copy is sent home two ticks after that.
const COPY_TO_REACTION = 7;
const REACTION_TO_RETURN = 2;

function pick(values) {
  return values[Math.floor(Math.random() * values.length)];
}

function shuffled(values) {
  const copy = [...values];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

module.exports = function attach(api, Events) {
  const I = api.core.ItemIdentifiers;
  const N = api.core.NpcIdentifiers;

  const definition = {
    id: N.MYSTERIOUS_OLD_MAN_5, // 6753, the mime invitation variant
    kind: "mime",
    greet: name => pick(OVERHEADS)(name),
    nags: OVERHEADS,
    goodbye: "Maybe later.",
    linger: true,
    otherPlayerLine: owner => `Sorry, I'm trying to speak to someone else, but ${owner.getAppearance().isMale() ? "he" : "she"} seems to be ignoring me.`,
    leavingLine: () => "Goodbye.",
    talk(active, { teleport, leave }) {
      const { player } = active;
      Flow.chat(api, {
        player,
        npcId: definition.id,
        title: "What would you like to say?",
        lines: [`Hey, ${player.getUsername()}, would you like to come and perform in a mime show?`],
        options: [
          ["Yeah, I'd love to do a mime show.", () => Flow.chat(api, {
            player,
            pages: [{ player: true, text: "Yeah, I'd love to do a mime show." }],
            onEnd: () => teleport({
              kind: "mime",
              arrive: ARRIVAL,
              teleportRefusal: "I need to finish my performance!",
              teleportRefusalOverhead: true,
              tick: awaitIntro,
              onStart: start,
            }),
          })],
          ["Sorry, I'm busy.", () => {
            leave(active);
            Flow.chat(api, { player, pages: [{ player: true, text: "Sorry, I'm busy." }] });
          }],
        ],
      });
    },
  };

  function start(session) {
    const { player } = session;
    session.data.correct = 0;
    session.data.phase = "intro";
    session.interfaceId = GROUP;
    Teleports.onEnd(session, () => {
      session.data.phase = "finished";
      closeChoices(session);
      Teleports.restoreTabs(player);
    });
    Teleports.hideTabs(player);
    const sender = player.getPacketSender();
    sender.sendSound(TELEPORT_SOUND, 1, 0);
    player.sendMessage("You need to copy the mime's performance, then you'll return to where you were.");
    Flow.chat(api, {
      player,
      npcId: definition.id,
      lines: ["You need to copy the mime's performance, then you'll be returned to where you were."],
      onEnd: () => perform(session),
    });
  }

  // Closing the chat without continuing must not strand the player on the stage.
  function awaitIntro(session) {
    if (session.data.phase !== "intro") return;
    if (!session.player.getPacketSender().isChatboxInterface(NPC_CHAT)) perform(session);
  }

  function perform(session) {
    if (session.data.phase !== "intro") return;
    const { player } = session;
    player.getPacketSender().sendInterfaceRemoval();
    player.moveTo(new api.core.Location(STAGE.x, STAGE.y, STAGE.z));
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

  // One performance. A wrong or missing answer does not touch the loop: the mime simply moves
  // on to another emote (1104's wrong first copy, Wiki: "the mime will perform another emote").
  function nextEmote(session) {
    if (session.data.correct >= NEEDED) return;
    session.data.phase = "demonstrating";
    closeChoices(session);
    const { Location, Animation } = api.core;
    const mime = findMime(session);
    mime?.setPositionToFace(new Location(MIME_TILE.x, MIME_TILE.y - 1, MIME_TILE.z));
    const emote = pick(EMOTES);
    session.data.emote = emote;
    Teleports.later(session, TURN_TO_EMOTE, () => {
      mime?.performAnimation(new Animation(emote.animation));
      Teleports.later(session, EMOTE_TO_BOW, () => {
        mime?.setPositionToFace(new Location(STAGE.x, STAGE.y, STAGE.z));
        mime?.performAnimation(new Animation(MIME_BOW));
        Teleports.later(session, BOW_TO_BUTTONS, () => {
          openChoices(session);
          Teleports.later(session, BUTTONS_TO_TURN, () => nextEmote(session));
        });
      });
    });
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
    const { Animation } = api.core;
    player.performAnimation(new Animation(EMOTES[index].animation));
    const correct = EMOTES[index] === session.data.emote;
    if (correct) session.data.correct++;
    Teleports.later(session, COPY_TO_REACTION, () => {
      player.performAnimation(new Animation(correct ? CHEER : CRY));
      if (session.data.correct >= NEEDED) Teleports.later(session, REACTION_TO_RETURN, () => finish(session));
    });
  }

  // 1885 paid two outfit pieces, 1104 one, 75, 127, 1098 and 1855 one emote, with outfit pieces
  // and emotes both outstanding; the wiki gives one or two pieces, or an emote, and a lamp once
  // everything is owned. The odds between them are not published, so each choice is even.
  function finish(session) {
    const { player } = session;
    const sender = player.getPacketSender();
    const missing = shuffled(OUTFIT.filter(piece => !Teleports.owns(player, piece)));
    const pieces = (count = Math.random() < 0.5 ? 1 : 2) =>
      missing.slice(0, count).map(id => ({ id, amount: 1 }));
    closeChoices(session);
    if (missing.length && Math.random() < 0.5) {
      Teleports.finish(session, { reward: pieces() });
      sender.sendSound(TELEPORT_SOUND, 1, 0);
      return;
    }
    const emote = Rewards.unlockEmote(api, player, shuffled([...EMOTE_UNLOCKS.keys()]));
    if (!emote) {
      Teleports.finish(session, { reward: missing.length ? pieces() : [{ id: I.LAMP, amount: 1 }] });
      sender.sendSound(TELEPORT_SOUND, 1, 0);
      return;
    }
    const line = `You can now use the ${EMOTE_UNLOCKS.get(emote)} emote!`;
    sender.sendTypedMessage(MESBOX_CHAT, line);
    Teleports.finish(session);
    sender.sendSound(TELEPORT_SOUND, 1, 0);
    Flow.statement(api, player, line);
  }

  api.onCustomEvent(Events.DEFINITIONS_EVENT, payload => payload.definitions.push(definition));
  api.onInterfaceActionClick(choose);

  api.onObjectInteraction("Large door", { Open: blockDoor, Close: blockDoor, Walk: blockDoor });

  // Wiki: "The large door in the room is inoperable and cannot be used to exit early."
  function blockDoor(event) {
    const session = Teleports.sessionOf(event.player);
    if (!session || session.kind !== "mime") return false;
    event.handled = true;
    return true;
  }
};
