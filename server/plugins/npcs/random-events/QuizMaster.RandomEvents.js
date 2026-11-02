"use strict";

const Flow = require("./DialogueFlow.RandomEvents");
// Quiz Master (random event): "Odd One Out". Four correct answers in a row wins 1,000 coins or
// a mystery box; a wrong answer restarts the streak, so the quiz cannot be failed and holds the
// player until it is completed. Live (rsprox 4156, 558, 1158, 579, 1858, 86, 941) opens chatbox
// interface 191 and draws the three spinning models with cache script 3799; the host's lines
// have no continue button and move on by themselves. See SOURCES.md.
const Teleports = require("./Teleports.RandomEvents");
const MysteryBox = require("./MysteryBox.RandomEvents");
const Rewards = require("./Rewards.RandomEvents");

const GROUP = 191;
const OPTIONS_UID = (GROUP << 16) | 1;
const SELECT_ACTION = 1;
const SCRIPT_DRAW_QUESTION = 3799;
const SCRIPT_CHATBOX_RESET = 2379;
const SCRIPT_TEXT_ALIGN = 600;
const NPC_CHAT_TEXT_UID = (231 << 16) | 6;
const LINE_HEIGHT = { 1: 16, 2: 28, 3: 20, 4: 16 };
// chatneu1-4: live's head and player animation by number of lines (rsprox 4156 ticks 2012-2025).
const NEUTRAL_CHAT = 567;
// [model, zoom] pairs that belong together. The zooms never change between recordings; the
// odd one out is the pick that makes the pairing clear in rsprox 4156, 558, 1858 and 941.
const PAIRS = [
  [[8828, 700], [8836, 600]], [[8829, 800], [8830, 800]], [[8831, 400], [8834, 400]],
  [[8832, 800], [8833, 400]], [[8835, 500], [8837, 1000]],
];
// The contestant's tile: the walled single tile on plane 1 facing the Quiz Master (rsprox 4156 tick 2014).
const ARRIVAL = { x: 1952, y: 4764, z: 1 };
const HOST_TILE = { x: 1952, y: 4768, z: 1 };
const WINS_NEEDED = 4;
const SIT_ANIMATION = 2378;
const SIT_REPEAT_TICKS = 10;
const TELEPORT_SOUND = 1930;
const CORRECT_SOUND = 2309;
const WIN_JINGLE = 110;
const RULES = "Answer four questions correctly in a row to be teleported back where you came from.";
const NEXT = "Okay, next question!";
// Word for word from the recordings, with live's line breaks.
const RIGHT = [
  ["DING DING DING!", "That's RIGHT! Good for you!", NEXT],
  ["Absolutely RIGHT!", "Keep going for the win!", NEXT],
  ["COR-RECT!", NEXT],
  ["Hey, you're good at this!", "CORRECT!", NEXT],
  ["Wow, you're a smart one!", "You're absolutely RIGHT!", NEXT],
  ["YES!", "You're RIGHT!", NEXT],
];
// Transcript:Quiz Master: no recording has a wrong answer, so the line breaks are ours.
const WRONG = [
  ["WRONG! That's just WRONG!", NEXT],
  ["BZZZZZZZ! WRONG!", NEXT],
  ["No, you're WRONG!", NEXT],
  ["No, sorry. Try harder!", NEXT],
  ["Better luck next time!", NEXT],
  ["Nope, that's not it.", NEXT],
  ["Huh...? Didn't you know that one?", NEXT],
  ["No, no, no... That's completely WRONG!", NEXT],
  ["WRONG WRONG WRONG!", NEXT],
];
const CONGRATULATIONS = ["<col=000080>CONGRATULATIONS<col=000000>!", "You are a <col=800000>WINNER<col=000000>!",
  "Please choose your <col=000080>PRIZE<col=000000>!"];
const WELCOME = ["WELCOME to the GREATEST QUIZ SHOW in the", "entire of Gielinor!"];
const ODD_ONE_OUT = ["<col=800000>O <col=000080>D <col=800000>D <col=000000>!",
  "<col=000080>O <col=800000>N <col=000080>E <col=000000>!", "<col=800000>O <col=000080>U <col=800000>T <col=000000>!"];
// Ticks after arrival (rsprox 4156: arrival 2014, rules 2016, lines 2019/2022/2025, question 2030).
const RULES_DELAY = 2;
const WELCOME_DELAY = 5;
const ODD_ONE_OUT_DELAY = 8;
const CONTESTANT_DELAY = 11;
const FIRST_QUESTION_DELAY = 16;
const REPLY_TICKS = 3;
// Transcript:Mystery box and rsprox 941, 4156, 558, 86, 579: what the box says per item id.
const BETTER_LUCK = "Better luck next time!";
const BOX_MESSAGES = new Map([
  [2528, "a lamp! Rub it!"], [1965, `a cabbage! ${BETTER_LUCK}`], [1601, "a diamond! Excellent!"],
  [1925, `a bucket! ${BETTER_LUCK}`], [956, `a flyer! ${BETTER_LUCK}`], [1119, "a steel plate! Excellent!"],
  [685, `a boot! ${BETTER_LUCK}`], [559, `a body rune! ${BETTER_LUCK}`], [1957, `an onion! ${BETTER_LUCK}`],
  [1329, "a mithril scimitar! Excellent!"], [405, "a casket! Excellent!"], [561, "20 nature runes! Excellent!"],
  [20590, "a baguette! Make of it what you will."],
  // The Wiki's Entrana rows; their noted ids.
  [2360, "5 mithril bars! Excellent!"], [2354, "5 steel bars! Excellent!"],
]);

function shuffled(values) {
  const copy = [...values];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function pick(values) {
  return values[Math.floor(Math.random() * values.length)];
}

module.exports = function attach(api, Events) {
  const I = api.core.ItemIdentifiers;
  const N = api.core.NpcIdentifiers;

  const definition = {
    id: N.QUIZ_MASTER_2,
    kind: "quiz",
    // Transcript:Quiz Master and rsprox 4156 tick 2001.
    greet: name => `Hey ${name}! It's your lucky day!`,
    nags: [name => `Wakey-wakey, ${name}!`, name => `You're in for a treat, ${name}!`,
      name => `Come along with me, ${name}!`, name => `Hey ${name}! It's your lucky day!`],
    goodbye: "Maybe later.",
    linger: true,
    otherPlayerLine: owner => `Sorry, it's ${owner.getUsername()} that's having the lucky day.`,
    talk(active, { teleport, valid, leave }) {
      const { player } = active;
      chat(player, [{ npcId: active.definition.id, text:
        `It's your lucky day, ${player.getUsername()}! You've got a chance to win big prizes in my quiz show. Would you like to play?` }],
      () => api.sendMultiChatboxPrompt(player, "What would you like to say?",
        "Yes please, I'm so excited!", () => chat(player, [{ text: "Yes please, I'm so excited!" }], () => {
          closeChat(player);
          if (valid(active, player)) teleport({ kind: "quiz", arrive: ARRIVAL, tick: holdInQuiz, onStart: start });
        }),
        "Quiz shows are stupid. Go away.", () => { leave(active); }));
    },
  };

  const chat = (player, pages, onEnd) => Flow.chat(api, { player, pages, onEnd, anim: NEUTRAL_CHAT });

  function closeChat(player) {
    player.getDialogueManager().reset?.();
    player.getPacketSender().sendInterfaceRemoval();
  }

  function sit(session) {
    session.player.performAnimation(new api.core.Animation(SIT_ANIMATION));
    Teleports.later(session, SIT_REPEAT_TICKS, () => sit(session));
  }

  function start(session) {
    const { player } = session;
    const { Animation, Location } = api.core;
    session.data.streak = 0;
    session.data.phase = "intro";
    Teleports.hideTabs(player);
    Teleports.onEnd(session, () => {
      player.performAnimation(Animation.DEFAULT_RESET_ANIMATION ?? new Animation(65535));
      if (!player.isRegistered()) return;
      closeChat(player);
      Teleports.restoreTabs(player);
    });
    player.setPositionToFace(new Location(HOST_TILE.x, HOST_TILE.y, HOST_TILE.z));
    player.getPacketSender().sendSound(TELEPORT_SOUND, 1, 0);
    sit(session);
    Teleports.later(session, RULES_DELAY, () => player.sendMessage(RULES));
    Teleports.later(session, WELCOME_DELAY, () => host(session, WELCOME));
    Teleports.later(session, ODD_ONE_OUT_DELAY, () => host(session, ODD_ONE_OUT));
    Teleports.later(session, CONTESTANT_DELAY, () => host(session, ["Please welcome our newest contestant:",
      `<col=800000>${player.getUsername()}<col=000000>!`, "Four questions right, and then you win!",
      "You know the rules, so let's begin!"]));
    Teleports.later(session, FIRST_QUESTION_DELAY, () => question(session));
  }

  // A host's line: no continue button, with live's own line breaks (NpcDialogue would rewrap them).
  function host(session, lines) {
    const { player } = session;
    const sender = player.getPacketSender();
    player.getDialogueManager().reset?.();
    sender.sendInterfaceScript(SCRIPT_CHATBOX_RESET);
    new api.core.NpcDialogue(0, N.QUIZ_MASTER, lines.join(" "), "Quiz Master", NEUTRAL_CHAT + lines.length - 1).sendHeld(player);
    sender.sendString(lines.join("<br>"), NPC_CHAT_TEXT_UID);
    sender.sendClientScript(SCRIPT_TEXT_ALIGN, 1, 1, LINE_HEIGHT[lines.length], NPC_CHAT_TEXT_UID);
  }

  // Wiki: "Each question has two of one item type and one of another."
  function question(session) {
    const pair = pick(PAIRS);
    const odd = pick(PAIRS.filter(other => other !== pair).flat());
    session.data.models = shuffled([...pair, odd]);
    session.data.odd = odd;
    session.data.phase = "question";
    drawQuestion(session);
  }

  function drawQuestion(session) {
    const sender = session.player.getPacketSender();
    sender.sendInterfaceScript(SCRIPT_CHATBOX_RESET);
    sender.sendChatboxInterface(GROUP);
    sender.sendClientScript(SCRIPT_DRAW_QUESTION, OPTIONS_UID, ...session.data.models.flat());
    sender.sendInterfaceFlagsRange(OPTIONS_UID, 0, 2, 1 << SELECT_ACTION);
  }

  function choose(event) {
    const { player, buttonId, slot } = event;
    if (buttonId !== OPTIONS_UID) return;
    event.handled = true;
    if (event.action !== SELECT_ACTION) return;
    const session = Teleports.sessionOf(player);
    if (session?.kind !== "quiz" || session.data.phase !== "question" || !session.data.models[slot]) return;
    const correct = session.data.models[slot] === session.data.odd;
    session.data.streak = correct ? session.data.streak + 1 : 0;
    session.data.phase = "reply";
    if (session.data.streak >= WINS_NEEDED) {
      player.getPacketSender().sendJingle(WIN_JINGLE);
      host(session, CONGRATULATIONS);
      Teleports.later(session, REPLY_TICKS, () => prize(session));
      return;
    }
    if (correct) player.getPacketSender().sendSound(CORRECT_SOUND, 1, 0);
    host(session, pick(correct ? RIGHT : WRONG));
    Teleports.later(session, REPLY_TICKS, () => question(session));
  }

  function prize(session) {
    session.data.phase = "prize";
    api.sendMultiChatboxPrompt(session.player, "Select Your Prize",
      "1,000 Coins", () => Teleports.finish(session, { reward: [{ id: I.COINS, amount: 1000 }] }),
      "Mystery Box", () => Teleports.finish(session, { reward: [{ id: I.MYSTERY_BOX, amount: 1 }] }));
  }

  // The quiz holds the player until it is completed: a chatbox closed by a click comes back.
  function holdInQuiz(session) {
    const sender = session.player.getPacketSender();
    if (session.data.phase === "question" && !sender.isChatboxInterface(GROUP)) drawQuestion(session);
    if (session.data.phase === "prize" && !sender.isChatboxInterface(219)) prize(session);
  }

  function openBox(event) {
    const { player } = event;
    if (!player.getInventory().containsNumber(I.MYSTERY_BOX)) return false;
    player.getInventory().delete(I.MYSTERY_BOX, 1);
    const rewards = MysteryBox.roll(api, player);
    if (!rewards.length) player.sendMessage("Inside the box you find absolutely nothing! What a shame.");
    for (const reward of rewards) {
      const message = (reward.clue ? "a clue scroll! Amazing!" : BOX_MESSAGES.get(reward.id)) ??
        `something rare: ${reward.amount} x ${new api.core.Item(reward.id, reward.amount).getDefinition().getName()}.`;
      player.sendMessage(`Inside the box you find ${message}`);
    }
    Rewards.give(api, player, rewards);
    api.emitCustomEvent("persistence:save", { player, reason: "mystery-box" });
    return true;
  }

  api.onCustomEvent(Events.DEFINITIONS_EVENT, payload => payload.definitions.push(definition));
  api.onInterfaceActionClick(choose);
  api.onItemAction("Mystery box", { Open: openBox });
  api.onItemAction("MysteryBox", { Open: openBox });
};
