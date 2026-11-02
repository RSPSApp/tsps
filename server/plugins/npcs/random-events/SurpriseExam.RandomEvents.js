"use strict";

// Surprise Exam (random event, Dunce / Mr. Mordaut): three right answers pass, three wrong
// fail, mixing "what comes next" patterns (cache interface 103) with "find three related
// cards" sets (cache interface 559). The doors leave at any time; the Book of Knowledge is
// paid on leaving after a pass. See SOURCES.md.
// Dialogue and packets: rsprox 4051, 1104 (r237), 571, 91, 1843, 553 (r227). All six pass, so
// the wrong-answer lines and the owned-book lines are Transcript:Mr._Mordaut.
const Flow = require("./DialogueFlow.RandomEvents");
const Teleports = require("./Teleports.RandomEvents");

const NEXT_GROUP = 103;
const CARDS_GROUP = 559;
// Cache scripts 51 and 52 set a component's model and start it spinning.
const NEXT_MODEL_SCRIPT = 51;
const CARD_MODEL_SCRIPT = 52;
const NEXT_MODELS = { SEQUENCE: [10, 11, 12], CHOICES: [15, 17, 19, 21] };
const CARDS = { MODELS: Array.from({ length: 15 }, (_, i) => 21 + i), SELECTS: Array.from({ length: 15 }, (_, i) => 52 + i),
  HINT: 67, CONFIRM: 68 };
// The cards' selected-state bitmask, read by cache scripts 115 and 121 (varp 1037 in 571).
const SELECTED_VARP = 1037;
const DOORS = [9316, 9317, 9318, 9319];
const QUESTIONS = 3;
const WRONG_ALLOWED = 3;
const BOOK = 11640;
const RIGHT_SOUND = 2274;
const PASS_JINGLE = 269;
const ARRIVAL = { x: 1886, y: 5025, z: 0 };
const PICK_PATTERN = "Pick the object that should come next in the pattern.";
const PICK_CARDS = "Examine the hint on the right and find three objects that are related to it.";
const CARDS_MESSAGE = "Look at the hint on the right and find three objects related to it.";
const TO_EXIT = "To exit, use any of the doors in this room.";
const FALLBACK = [[995, 20], [995, 40], [995, 80], [995, 160], [995, 320], [995, 640],
  [1454, 1], [1623, 1], [1621, 1], [1619, 1], [1617, 1], [985, 1], [987, 1]];

// The questions seen in the six recordings, as the raw models live sends. Live has more than
// this (the server holds them, the cache does not), so the pool is what has been observed.
const PATTERNS = [
  { sequence: [41203, 41190, 41202], answer: 41172, others: [41212, 41153, 41170] },
  { sequence: [41222, 41226, 41214], answer: 41156, others: [41204, 41194, 41224] },
  { sequence: [41222, 41230, 41207], answer: 41214, others: [41183, 27091, 41177] },
  { sequence: [41172, 41202, 41205], answer: 41185, others: [41231, 41177, 41220] },
  { sequence: [41210, 41213, 41155], answer: 41212, others: [41202, 41215, 41231] },
  { sequence: [41150, 41178, 41200], answer: 27094, others: [41202, 41157, 41153] },
  { sequence: [41216, 41148, 41159], answer: 27091, others: [41183, 41152, 41193] },
  { sequence: [41162, 28421, 41219], answer: 41152, others: [41205, 41171, 41164] },
];
const CARD_SETS = [
  { hint: "The pen may be mightier than the sword, but against a dragon? I'll take a melee weapon.",
    related: [41150, 41192, 41176],
    others: [2674, 41232, 41223, 27104, 41212, 41175, 41199, 41153, 41146, 41152, 41163, 41182] },
  { hint: "There are many ways to hide one's face; much like the way that this pattern is hidden.",
    related: [41191, 41195, 27101],
    others: [41201, 41225, 41176, 41163, 41218, 41198, 41192, 41229, 41149, 41153, 41226, 41155] },
  { hint: "I'm feeling dehydrated.",
    related: [41152, 41162, 27097],
    others: [41217, 41197, 41181, 41208, 41170, 41158, 41163, 41154, 41232, 41171, 41151, 41150] },
  { hint: "I feel like a fish out of water!",
    related: [41163, 41217, 41158],
    others: [41176, 41168, 27091, 41226, 41167, 41160, 41183, 41152, 41189, 41212, 41229, 41216] },
  { hint: "I tip my hat to this pattern.",
    related: [41187, 41196, 41164],
    others: [41179, 41170, 41154, 41163, 41166, 41223, 41177, 41202, 41216, 2674, 41150, 41184] },
  { hint: "Some professions use such strange headgear.",
    related: [41187, 41196, 41164],
    others: [41179, 41170, 41154, 41163, 41166, 41223, 41177, 41202, 41216, 2674, 41150, 41184] },
  { hint: "This pattern prefers a Ranged attack.",
    related: [41146, 41198, 41177],
    others: [41176, 41227, 41154, 41192, 41150, 41187, 41202, 41210, 27097, 41175, 41225, 27101] },
  { hint: "This pattern is as sharp as an arrow.",
    related: [41146, 41198, 41177],
    others: [27097, 41187, 41154, 41227, 27101, 41210, 41225, 41150, 41192, 41202, 41175, 41176] },
];

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
  const N = api.core.NpcIdentifiers;

  const definition = {
    id: N.DUNCE_2,
    kind: "exam",
    // 4051, 571, 91, 1104, 1843 and 553 greet with this; Transcript:Dunce has the waiting lines.
    greet: name => `Surprise exam, ${name}!`,
    nags: [name => `Surprise exam, ${name}!`, name => `Come to school, ${name}!`,
      name => `You're getting tested, ${name}!`, name => `The teacher wants you, ${name}!`,
      name => `Teacher gets angry when he's kept waiting, ${name}!`],
    goodbye: "Maybe later.",
    linger: true,
    otherPlayerLine: () => "Nope, you're not the one the teacher wanted me to find!",
    leavingLine: () => "Goodbye.",
    talk(active, { teleport, leave }) {
      const { player } = active;
      Flow.chat(api, {
        player,
        npcId: definition.id,
        title: "What would you like to say?",
        lines: [`Hey, ${player.getUsername()}, the teacher wants you to come to school for a test.`],
        options: [
          ["Sure, I fancy an exam.", () => Flow.chat(api, {
            player,
            pages: [{ player: true, text: "Sure, I fancy an exam." }],
            onEnd: () => teleport({ kind: "exam", arrive: ARRIVAL, onStart: start }),
          })],
          ["I don't want to.", () => {
            leave(active);
            Flow.chat(api, { player, pages: [{ player: true, text: "I don't want to." }] });
          }],
        ],
      });
    },
  };

  function start(session) {
    const { player } = session;
    session.data.correct = 0;
    session.data.wrong = 0;
    session.data.passed = false;
    session.data.finished = false;
    player.getPacketSender().sendInterfaceRemoval();
    player.sendMessage(" <br>Welcome to ScapeRune.");
    player.sendMessage("Answer three out of six questions correctly to succeed.");
    pickQuestion(session);
    Flow.chat(api, {
      player,
      npcId: N.MR_MORDAUT,
      lines: [`Ah, it's you ${player.getUsername()}. You've been slacking in your studies, so it's time for an exam.`,
        "There are two types of question. One type requires you to find the next object in a pattern.",
        "In the second type I will present you with fifteen cards and a hint. Discover three cards related to the hint, select them and confirm.",
        questionLine(session)],
      onEnd: () => openQuestion(session),
    });
  }

  function pickQuestion(session) {
    session.data.question = Math.random() < 0.5
      ? { cards: true, set: pick(CARD_SETS) }
      : { cards: false, pattern: pick(PATTERNS) };
  }

  function questionLine(session) {
    return session.data.question.cards ? PICK_CARDS : PICK_PATTERN;
  }

  function ask(session, praise = []) {
    Flow.chat(api, {
      player: session.player,
      npcId: N.MR_MORDAUT,
      lines: [...praise, questionLine(session)],
      onEnd: () => openQuestion(session),
    });
  }

  function openQuestion(session) {
    const sender = session.player.getPacketSender();
    sender.sendInterfaceRemoval();
    if (session.data.question.cards) openCards(session);
    else openNext(session);
  }

  function openNext(session) {
    const { player } = session;
    const { sequence, answer, others } = session.data.question.pattern;
    const choices = shuffled([answer, ...others]);
    session.data.pattern = { sequence, answer, choices };
    session.interfaceId = NEXT_GROUP;
    player.sendMessage(PICK_PATTERN);
    const sender = player.getPacketSender();
    sender.sendInterface(NEXT_GROUP);
    sequence.forEach((model, index) =>
      sender.sendClientScript(NEXT_MODEL_SCRIPT, (NEXT_GROUP << 16) | NEXT_MODELS.SEQUENCE[index], model));
    choices.forEach((model, index) =>
      sender.sendClientScript(NEXT_MODEL_SCRIPT, (NEXT_GROUP << 16) | NEXT_MODELS.CHOICES[index], model));
  }

  function chooseNext(event) {
    const { player, buttonId } = event;
    if ((buttonId >>> 16) !== NEXT_GROUP) return;
    const index = NEXT_MODELS.CHOICES.indexOf(buttonId & 0xffff);
    if (index < 0) return;
    event.handled = true;
    const session = Teleports.sessionOf(player);
    if (event.action !== 1 || !session || session.kind !== "exam" || !session.data.pattern) return;
    const { choices, answer: right } = session.data.pattern;
    session.data.pattern = null;
    if (player.getInterfaceId?.() === NEXT_GROUP) player.getPacketSender().sendInterfaceRemoval();
    answer(session, choices[index] === right);
  }

  function openCards(session) {
    const { player } = session;
    const { hint, related, others } = session.data.question.set;
    const cards = shuffled([...related, ...others]);
    session.data.cards = { related, cards, selected: [] };
    session.interfaceId = CARDS_GROUP;
    player.sendMessage(CARDS_MESSAGE);
    const sender = player.getPacketSender();
    sender.sendConfig(SELECTED_VARP, 0);
    sender.sendInterface(CARDS_GROUP);
    sender.sendString(hint, (CARDS_GROUP << 16) | CARDS.HINT);
    cards.forEach((model, index) =>
      sender.sendClientScript(CARD_MODEL_SCRIPT, (CARDS_GROUP << 16) | CARDS.MODELS[index], model));
  }

  function chooseCard(event) {
    const { player, buttonId } = event;
    if ((buttonId >>> 16) !== CARDS_GROUP) return;
    const child = buttonId & 0xffff;
    const select = CARDS.SELECTS.indexOf(child);
    const confirm = child === CARDS.CONFIRM;
    if (select < 0 && !confirm) return;
    event.handled = true;
    const session = Teleports.sessionOf(player);
    if (event.action !== 1 || !session || session.kind !== "exam" || !session.data.cards) return;
    const state = session.data.cards;
    if (select >= 0) {
      const index = state.selected.indexOf(select);
      if (index >= 0) state.selected.splice(index, 1);
      else if (state.selected.length < 3) state.selected.push(select);
      player.getPacketSender().sendConfig(SELECTED_VARP,
        state.selected.reduce((mask, card) => mask | (1 << card), 0));
      return;
    }
    if (state.selected.length !== 3) return;
    const chosen = state.selected.map(index => state.cards[index]);
    const right = chosen.every(item => state.related.includes(item));
    session.data.cards = null;
    if (player.getInterfaceId?.() === CARDS_GROUP) player.getPacketSender().sendInterfaceRemoval();
    answer(session, right);
  }

  function praise(player) {
    const pronoun = player.getAppearance?.()?.isMale?.() === false ? "her" : "his";
    return pick(["Wonderful! Keep up the good work. Next question.",
      `Finally, a pupil using ${pronoun} brains rather than trying to eat them. Next question.`,
      "That's correct! Next question."]);
  }

  const SCOLD = ["No. No, that's not right at all. Okay, next question.",
    "That's WRONG. Take your time and think about the next question.",
    "No, no, no... That's WRONG! Okay, next question."];
  const FIRST_WRONG_HINT = "Remember, the goal here is to find the pattern. Look for objects that would have a connection to each other.";

  function answer(session, correct) {
    const player = session.player;
    const sender = player.getPacketSender();
    if (correct) {
      session.data.correct++;
      if (session.data.correct >= QUESTIONS) {
        session.data.passed = true;
        session.data.finished = true;
        sender.sendJingle(PASS_JINGLE);
        const lines = Teleports.owns(player, BOOK)
          ? ["WELL DONE! You've proven your aptitude for pattern recognition.",
            "Hmm, you already appear to have a Book of Knowledge. You should read that! Still, I will reward you for your work once you leave the room."]
          : ["WELL DONE!<br>You've proven your aptitude for pattern recognition.<br>You'll receive a book once you leave the classroom. It is<br>a Book of Knowledge to further your education."];
        Flow.chat(api, { player, npcId: N.MR_MORDAUT, lines: [...lines, TO_EXIT] });
        return;
      }
      sender.sendSound(RIGHT_SOUND, 1, 0);
      const line = praise(player);
      pickQuestion(session);
      ask(session, [line]);
      return;
    }
    session.data.wrong++;
    if (session.data.wrong >= WRONG_ALLOWED) {
      session.data.finished = true;
      Flow.chat(api, { player, npcId: N.MR_MORDAUT,
        lines: ["How unfortunate, you FAILED. You'd better hit the books and study up for next time.", TO_EXIT] });
      return;
    }
    // Wiki: a wrong answer repeats the same question, with a hint after the first one.
    const lines = [pick(SCOLD)];
    if (session.data.wrong === 1) lines.push(FIRST_WRONG_HINT);
    ask(session, lines);
  }

  function talkToMordaut(event) {
    const session = Teleports.sessionOf(event.player);
    if (!session || session.kind !== "exam") return false;
    event.handled = true;
    if (session.data.finished) {
      Flow.chat(api, { player: event.player, npcId: N.MR_MORDAUT, lines: [TO_EXIT] });
      return true;
    }
    ask(session);
    return true;
  }

  api.onCustomEvent(Events.DEFINITIONS_EVENT, payload => payload.definitions.push(definition));
  api.onInterfaceActionClick(chooseNext);
  api.onInterfaceActionClick(chooseCard);
  api.onNpcInteraction("Mr. Mordaut", { "Talk-to": talkToMordaut });
  api.onObjectInteraction("Door", { Open: leave });
  api.onObjectInteraction("Door", { Walk: leave });

  function leave(event) {
    const session = Teleports.sessionOf(event.player);
    if (!session || session.kind !== "exam") return false;
    if (!DOORS.includes(event.object.getId?.())) return false;
    event.handled = true;
    if (session.data.passed) reward(session);
    else Teleports.finish(session);
    return true;
  }

  function reward(session) {
    const player = session.player;
    if (!Teleports.owns(player, BOOK)) {
      Teleports.finish(session, { reward: [{ id: BOOK, amount: 1 }] });
      return;
    }
    const [id, amount] = pick(FALLBACK);
    Teleports.finish(session, { reward: [{ id, amount }] });
  }
};
