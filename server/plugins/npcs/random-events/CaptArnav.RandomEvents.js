"use strict";

const Flow = require("./DialogueFlow.RandomEvents");
// Capt' Arnav's Chest (random event): a three-column combination lock on interface 26. Varp 531
// holds the columns, two bits each; the cache's scripts draw the cylinders from it and predict
// the arrow clicks, and the server only echoes the varp (rsprox 91, 1108). Two wrong tries and
// Arnav gives up. One 1/4 roll of coins/gold ring/gold necklace/gold bar. See SOURCES.md.
const GROUP = 26;
const LOCK_VARP = 531;
// Column -> varp shift (varbits 9585, 9593, 9594 in scripts 3770-3773).
const COLUMN_SHIFT = [0, 2, 4];
const COLUMN_TEXT = [22, 23, 24];
// Arrow component -> [column, added to the column]. Scripts 2858/3770 add 1 and 3, modulo 4.
const ARROWS = new Map([[5, [0, 1]], [6, [0, 3]], [8, [1, 1]], [9, [1, 3]], [11, [2, 1]], [12, [2, 3]]]);
const CYLINDER_SIZE = 4;
const UNLOCK = 25;
const SELECT_ACTION = 1;
// Column value -> word. Every word in the recordings and the wiki's picture, solved at these
// values. Value 0 is the coins picture: no source shows a word for it, so it is never asked for.
const WORDS = { 1: "BOWL", 2: "BAR", 3: "RING" };
const SCRIPT_MAINMODAL_OPEN = 2524;
const MODAL_COLOUR = 5259561;
const MODAL_TRANSPARENCY = 125;
const SOLVED_SOUND = 2303;
// chathappy1 for Arnav's lines and the player's yes (rsprox 1108 ticks 7013-7020), chatneu1 for
// the failure lines, which no recording has.
const HAPPY_CHAT = 588;
const NEUTRAL_CHAT = 567;

module.exports = function attach(api, Events) {
  const I = api.core.ItemIdentifiers;

  function definition() {
    return {
      id: api.core.NpcIdentifiers.CAPT_ARNAV,
      kind: "arnav",
      greet: name => `Avast there, ${name}!`,
      nags: [name => `Ahoy, ${name}!`, () => "Parley wi' me, my old fruit!", name => `I needs yer help, ${name}!`,
        name => `I got treasure here, ${name}!`, () => "Shiver me' timbers, are you ignoring me?",
        name => `Will ye help an old pirate, ${name}?`, name => `I knows somethin' you should knows, ${name}.`],
      goodbye: "Maybe later.",
      linger: true,
      otherPlayerLine: () => "Arrr, you're not the person I be needin'.",
      leavingLine: () => "Arrr, I'd better be off.",
      talk: talk,
    };
  }

  const chat = (player, pages, onEnd) => Flow.chat(api, { player, pages, onEnd, anim: HAPPY_CHAT });

  function closeChat(player) {
    player.getDialogueManager().reset?.();
    player.getPacketSender().sendInterfaceRemoval();
  }

  function rollLock() {
    const words = Object.keys(WORDS).map(Number);
    return COLUMN_SHIFT.map(() => ({
      target: words[Math.floor(Math.random() * words.length)],
      value: Math.floor(Math.random() * CYLINDER_SIZE),
    }));
  }

  function lockVarp(lock) {
    return lock.reduce((varp, column, index) => varp | (column.value << COLUMN_SHIFT[index]), 0);
  }

  function open(active) {
    active.lock ??= rollLock();
    active.attempts ??= 0;
    active.interfaceId = GROUP;
    const sender = active.player.getPacketSender();
    closeChat(active.player);
    sender.sendConfig(LOCK_VARP, lockVarp(active.lock));
    sender.sendClientScript(SCRIPT_MAINMODAL_OPEN, MODAL_COLOUR, MODAL_TRANSPARENCY);
    sender.sendInterface(GROUP);
    active.lock.forEach((column, index) => sender.sendString(WORDS[column.target], (GROUP << 16) | COLUMN_TEXT[index]));
  }

  function greeting(player) {
    const male = player.getAppearance?.()?.isMale?.();
    if (male === undefined) return "Ah, hello there!";
    return `Ah, hello there, ${male ? "laddie" : "lassie"}!`;
  }

  function talk(active, { valid, leave }) {
    const { player } = active;
    const npcId = active.definition.id;
    chat(player, [
      { npcId, text: `${greeting(player)} I've just dug up an old treasure chest of mine.` },
      { npcId, text: "Problem is, these old hands o'mine aren't as useful as they used t'be, and the lock on that chest is a little bit too fiddly for ol' Cap'n Arnav. Could you help me out?" },
    ], () => api.sendMultiChatboxPrompt(player, "What would you like to say?",
      "Yes, I'll help you unlock your chest.", () => chat(player, [
        { text: "Yes, I'll help you unlock your chest." },
        { npcId, text: "There are three columns. What you need to do for me is to match up each picture with the word underneath the column, and then unlock the chest." },
      ], () => {
        if (valid(active, player)) open(active);
      }),
      "No, sorry.", () => { leave(active); chat(player, [{ text: "No, sorry." }], () => closeChat(player)); }));
  }

  // Transcript:Capt' Arnav: the first wrong try explains the lock and opens it again.
  function failedOnce(active) {
    const { player } = active;
    const npcId = active.definition.id;
    const anim = NEUTRAL_CHAT;
    closeChat(player);
    chat(player, [
      { npcId, anim, text: "Arrr! That be nowhere near close! Did ye not listen the first time around?" },
      { anim, text: "Sorry, I must have misunderstood your instructions. Could I hear them again please?" },
      { npcId, anim, text: "Right, right. What you need to do is click on the arrows to roll the cylinders round to the different items." },
      { npcId, anim, text: "When the items in the middle row all match the words written under the column then you'll have solved the lock." },
      { npcId, anim, text: "Is that a little clearer?" },
      { anim, text: "Certainly. Let me try again." },
    ], () => {
      if (Events.valid(active, player)) open(active);
    });
  }

  function failedTwice(active) {
    const { player } = active;
    const npcId = active.definition.id;
    player.getPacketSender().sendConfig(LOCK_VARP, 0);
    Events.finish(active);
    chat(player, [{ npcId, anim: NEUTRAL_CHAT, text: "Arrr! I'd better find someone else." }], () => closeChat(player));
  }

  function choose(event) {
    const { player, buttonId } = event;
    if ((buttonId >>> 16) !== GROUP) return;
    const child = buttonId & 0xffff;
    event.handled = true;
    if (event.action !== SELECT_ACTION) return;
    const active = Events.activeFor(player);
    if (!active || active.definition.kind !== "arnav" || !active.lock || player.getInterfaceId() !== GROUP) return;
    const arrow = ARROWS.get(child);
    if (arrow) {
      const column = active.lock[arrow[0]];
      column.value = (column.value + arrow[1]) % CYLINDER_SIZE;
      player.getPacketSender().sendConfig(LOCK_VARP, lockVarp(active.lock));
      return;
    }
    if (child !== UNLOCK) return;
    if (!active.lock.every(column => column.value === column.target)) {
      active.attempts++;
      if (active.attempts >= 2) failedTwice(active);
      else failedOnce(active);
      return;
    }
    const reward = [[I.COINS, 125], [I.GOLD_RING, 1], [I.GOLD_NECKLACE, 1], [I.GOLD_BAR, 1]]
      [Math.floor(Math.random() * 4)];
    const npcId = active.definition.id;
    active.gift = { id: reward[0], amount: reward[1] };
    player.getPacketSender().sendConfig(LOCK_VARP, 0);
    // The shared path closes the interface and pays first, as live does, then Arnav thanks them.
    if (!Events.serve(active, [active.gift])) return;
    player.getPacketSender().sendSound(SOLVED_SOUND, 1, 0);
    chat(player, [{ npcId, text: "Ah, well done matey, that's the right combination. Here, have a little somethin' for helpin' me out." }],
      () => closeChat(player));
  }

  api.onCustomEvent(Events.DEFINITIONS_EVENT, payload => payload.definitions.push(definition()));
  api.onInterfaceActionClick(choose);
  return { open };
};
