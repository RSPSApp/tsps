"use strict";

// Drill Demon (random event, Sergeant Damien): do five ordered exercises in a row on the mat
// whose sign shows the order (RSProx 1846 and 1852: five correct exercises each, the Wiki says
// four). The four sign posts are multilocs on varbits 1335-1338, so each player sees their own
// signs; they are reshuffled before every order. A wrong mat breaks the streak. Camouflage
// pieces (top first), then a lamp with the exercise emotes, then lamps. Every mat is a 1x2 pair
// of ground decorations at y=4819/4820 with its sign at y=4821, so the player is walked onto the
// north tile and faces the sign before the exercise. See SOURCES.md.
const Flow = require("./DialogueFlow.RandomEvents");
const Teleports = require("./Teleports.RandomEvents");
const Rewards = require("./Rewards.RandomEvents");

// sign: the varbit value showing that exercise (locs 20805, 9314, 9315, 16506). ticks: from the
// animation to the next order. icon: the model item on the order's objbox.
const EXERCISES = [
  { name: "star jumps", sign: 4, animation: 2761, ticks: 8, icon: 10949,
    line: "I want to see you on that mat doing star jumps, private!",
    box: "Go to this mat and do some star jumps!" },
  { name: "push ups", sign: 3, animation: 2762, ticks: 6, icon: 10946,
    line: "Drop and give me push ups on that mat, private!",
    box: "Go to this mat and do some push ups!" },
  { name: "sit ups", sign: 2, animation: 2763, ticks: 7, icon: 10948,
    line: "Get on that mat and give me sit ups, private!",
    box: "Go to this mat and do some sit ups!" },
  { name: "jogging", sign: 1, animation: 2764, ticks: 5, icon: 10947,
    line: "Get yourself over there and jog on that mat, private!",
    box: "Go to this mat and jog on the spot!" },
];
// [x, mat loc, the varbit of the sign post behind it]
const MATS = [[3160, 20810, 1335], [3162, 16508, 1336], [3164, 9313, 1337], [3166, 20801, 1338]];
const MAT_IDS = new Set(MATS.map(([, id]) => id));
const SIGNS_Y = 4821;
// The mat tile under each sign post; the player exercises on it, facing the sign.
const MAT_ROW_Y = SIGNS_Y - 1;
const OUTFIT = [6654, 6656, 6655];
const NEEDED = 5;
const FACE_DELAY = 2;
const ANIMATION_DELAY = 3;
const STOP_ANIMATION = 65535;
// Chathead animations as sent live (1846).
const PLAYER_EXPRESSION = 567;
const INVITE_EXPRESSION = 616;
const SPEECH_EXPRESSION = 615;
const ORDER_EXPRESSION = 614;
const BOX_MESSAGE_TYPE = 115;

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
  const { Location } = api.core;

  const definition = {
    id: N.SERGEANT_DAMIEN_2,
    kind: "drill",
    greet: name => `Private ${name}, atten-SHUN!`,
    nags: [name => `Private ${name}, atten-SHUN!`, name => `Stop day-dreaming, Private ${name}!`,
      name => `Get your rear in gear, Private ${name}!`, name => `I want you for my corps, Private ${name}!`],
    goodbye: "Maybe later.",
    linger: true,
    leavingLine: () => "As you were, soldier.",
    talk(active, { teleport, leave }) {
      const { player } = active;
      Flow.chat(api, {
        player,
        npcId: active.definition.id,
        title: "What would you like to say?",
        lines: [{ text: `Private ${player.getUsername()}, atten-SHUN! You've been recommended for my corps. ` +
          "Do you think you can be the best?", expression: INVITE_EXPRESSION }],
        options: [
          ["Sir, yes sir!", () => reply(player, "Sir, yes sir!", () => teleport({
            kind: "drill",
            arrive: { x: 3163, y: 4820, z: 0 },
            hideTabs: true,
            onStart: start,
          }))],
          ["No thanks, I'm not interested.", () => { leave(active); reply(player, "No thanks, I'm not interested."); }],
        ],
      });
    },
  };

  function reply(player, text, onEnd = null) {
    Flow.chat(api, { player, pages: [{ player: true, text, expression: PLAYER_EXPRESSION }], onEnd });
  }

  function start(session) {
    session.data.streak = 0;
    session.data.matExercise = new Map();
    session.data.order = null;
    session.data.exercising = false;
    shuffleSigns(session);
    const release = () => session.player.getMovementQueue?.()?.setBlockMovement?.(false);
    Teleports.onEnd(session, release);
    Flow.chat(api, {
      player: session.player,
      npcId: N.SERGEANT_DAMIEN,
      lines: [{ text: "Move yourself, Private! Follow my orders and you may, just may, leave here in a fit state for my corps!",
        expression: SPEECH_EXPRESSION }],
      onEnd: () => firstOrder(session),
    });
  }

  function firstOrder(session) {
    shuffleSigns(session);
    order(session);
  }

  function shuffleSigns(session) {
    const exercises = shuffled(EXERCISES);
    const sender = session.player.getPacketSender();
    MATS.forEach(([x, , varbit], index) => {
      session.data.matExercise.set(x, exercises[index]);
      sender.sendVarbit(varbit, exercises[index].sign);
    });
  }

  function order(session, prefix = "") {
    session.data.order = EXERCISES[Math.floor(Math.random() * EXERCISES.length)];
    showOrder(session, prefix);
  }

  // Damien's line, the objbox with the exercise, then the choice to stay or leave.
  function showOrder(session, prefix = "") {
    const { player } = session;
    const exercise = session.data.order;
    Flow.chat(api, {
      player,
      npcId: N.SERGEANT_DAMIEN,
      lines: [{ text: `${prefix}${exercise.line}`, expression: ORDER_EXPRESSION }],
      onEnd: () => showOrderBox(session, exercise),
    });
  }

  function showOrderBox(session, exercise) {
    const { player } = session;
    const { DialogueChainBuilder, ItemStatementDialogue, ActionDialogue } = api.core;
    player.getPacketSender().sendTypedMessage(BOX_MESSAGE_TYPE, exercise.box);
    player.getDialogueManager().startDialogues(new DialogueChainBuilder()
      .add(new ItemStatementDialogue(0, exercise.icon, exercise.box))
      .add(new ActionDialogue(1, { execute: () => api.sendMultiChatboxPrompt(player, "Select an option",
        "Okay.", () => reply(player, "Okay."),
        "I want to leave.", () => reply(player, "I want to leave.", () => leave(session))) })));
  }

  function leave(session) {
    const { player } = session;
    Flow.chat(api, {
      player,
      npcId: N.SERGEANT_DAMIEN,
      lines: ["Pathetic. Get out of here then."],
      onEnd: () => {
        player.getPacketSender().sendInterfaceRemoval();
        Teleports.finish(session);
      },
    });
  }

  function useMat(event) {
    const session = Teleports.sessionOf(event.player);
    if (!session || session.kind !== "drill") return false;
    const object = event.object;
    const exercise = session.data.matExercise?.get(object.getLocation().getX());
    if (!exercise) return false;
    event.handled = true;
    if (session.data.exercising) return true;
    const player = event.player;
    player.getPacketSender().sendInterfaceRemoval();
    if (!session.data.order) {
      Flow.chat(api, {
        player,
        npcId: N.SERGEANT_DAMIEN,
        lines: ["I haven't given you the order yet, worm!"],
        onEnd: () => firstOrder(session),
      });
      return true;
    }
    session.data.exercising = true;
    player.getMovementQueue?.()?.setBlockMovement?.(true);
    // Route-to-mat has already walked the player onto the tile under the sign.
    const sign = new Location(object.getLocation().getX(), SIGNS_Y, object.getLocation().getZ());
    Teleports.later(session, FACE_DELAY, () => player.setPositionToFace(sign));
    Teleports.later(session, ANIMATION_DELAY, () => {
      player.performAnimation(new api.core.Animation(exercise.animation));
      Teleports.later(session, exercise.ticks, () => {
        player.performAnimation(new api.core.Animation(STOP_ANIMATION));
        player.getMovementQueue?.()?.setBlockMovement?.(false);
        session.data.exercising = false;
        judgement(session, exercise);
      });
    });
    return true;
  }

  // Both halves of a mat are 1x1 ground decorations with the sign directly north. Walk the
  // player onto the north tile instead of stopping in the gap between two mats, then the
  // interaction runs on arrival. Live capture: rsprox 1846, event area 3128,4768.
  function routeToMat(event) {
    if (event.clickType !== 1 || !MAT_IDS.has(event.objectId)) return;
    const location = event.object.getLocation();
    event.destination = { x: location.getX(), y: MAT_ROW_Y, z: location.getZ() };
  }

  function judgement(session, exercise) {
    if (exercise !== session.data.order) {
      session.data.streak = 0;
      shuffleSigns(session);
      order(session, "Wrong exercise, worm! ");
      return;
    }
    session.data.streak++;
    if (session.data.streak >= NEEDED) {
      complete(session);
      return;
    }
    shuffleSigns(session);
    order(session);
  }

  function complete(session) {
    const { player } = session;
    Flow.chat(api, {
      player,
      npcId: N.SERGEANT_DAMIEN,
      lines: [{ text: "Well I'll be, you actually did it, Private. Now take this and get out of my sight.",
        expression: SPEECH_EXPRESSION }],
      onEnd: () => {
        player.getPacketSender().sendInterfaceRemoval();
        const missing = OUTFIT.find(piece => !Teleports.owns(player, piece));
        if (missing === undefined) Rewards.unlockEmote(api, player, ["emote_drilldemon"]);
        Teleports.finish(session, { reward: [{ id: missing ?? I.LAMP, amount: 1 }] });
      },
    });
  }

  // Talking to Damien (337) again repeats the standing order and its choice to leave.
  function talkInArea(event) {
    const session = Teleports.sessionOf(event.player);
    if (!session || session.kind !== "drill" || event.npc.getId?.() !== N.SERGEANT_DAMIEN) return false;
    event.handled = true;
    if (session.data.exercising) return true;
    if (session.data.order) showOrder(session);
    else firstOrder(session);
    return true;
  }

  api.onCustomEvent(Events.DEFINITIONS_EVENT, payload => payload.definitions.push(definition));
  api.onObjectRoute(routeToMat);
  api.onObjectInteraction("Exercise mat", { Use: useMat });
  api.onNpcInteraction("Sergeant Damien", { "Talk-to": talkInArea });
};
