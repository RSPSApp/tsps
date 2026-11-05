/**
 * The Overseer and his book (Wiki: The Overseer, Transcript:The Overseer, Overseer's book):
 * - Talk-to plays the transcript; asking "What can I do here?" sets him wanting a spine, a claw
 *   and an axon from the Sires;
 * - components the player carries are handed over (he keeps them, varbit 3262) once he has asked
 *   for them - "I did not ask you to bring me anything, human." before that;
 * - with all three he makes the first abyssal bludgeon, says his piece and leaves: varbit 3261
 *   turns his loc into the slimy residue and the boils beside it into his book;
 * - the book is taken from there ("Take"), and the three components used on it fuse into another
 *   bludgeon: "The book's power allows you to fuse the components into an Abyssal Bludgeon."
 * No capture has him: his chathead is his own model (29518) with overseer_talk_1, and the lore
 * values are this plugin's: 0 not met, 1 met, 2 asked for the parts, 3 parts all given, 4 gone.
 */
const Common = require("./Common.AbyssalSire");

const LORE = Object.freeze({ UNMET: 0, MET: 1, ASKED: 2, GIVEN: 3, DEPARTED: 4 });
const CHATHEAD_MODEL = 29518;
const TALK_ANIM = 7117;
const CHAT_GROUP = 231;
const OVERSEER = "<col=ffff00>The Overseer</col>";
const BOOK = "<col=ff9040>Overseer's book</col>";
const FUSED = "The book's power allows you to fuse the components into an Abyssal Bludgeon.";

const PIECE_NAMES = new Map();

const LINES = {
  greeting: ["How curious? I have not seen a creature of your kind for many years. You have ventured into the Nexus human - I should warn you to be aware of the Abyssal Sires."],
  aboutSelf: [
    "Ah... Time does not pass in the Abyss at the same rate that it does in your realm, but nevertheless I have been in this place for aeons.",
    "Indeed, when I was last in your realm, the armies of Zamorak were battling the other gods for control, and we sought reinforcements from any plane we could reach.",
    "That was how I came here. We broke through to the Abyss, seeking allies for our cause, but instead I ended up a prisoner in this place, unable to leave, while the God Wars continued without me.",
  ],
  aboutSires: [
    "The Sires are the engineers of this living pocket universe known to you and I as the Abyss.",
    "At the hands of the 'Chaos God', Zamorak, like myself, they too were cast down and imprisoned in this living tomb.",
    "They worked for centuries attempting to escape the pull of the Abyss but as food resources began to deplete they knew that their only chance for survival was to construct this Nexus.",
    "They absorb flesh and bone of their demon kin, weaving it into the fabric of these very walls. Here they have remained in deep stasis, asleep.",
    "If you succeed in awakening them, they will no doubt unleash their full fury upon you. Someone of your calibre should be able to deal with them though, especially with the shadows on your side...",
    "If you succeed in killing a Sire, you may be fortunate enough to find one of its unsired offspring among its remains. Bring the Unsired here, to the Font of Consumption.",
    "By placing the Unsired into the Font, I will be able to consume its flesh and perhaps you will receive something worth having.",
  ],
  whatCanIDo: [
    "There is something you can do here, human. In fact it may perhaps benefit us both.",
    "Bring me a spine, a claw and an axon from the Abyssal Sires, and I shall construct them into a mighty weapon for you. Yes, we shall both benefit from this.",
  ],
  harvested: "Have you harvested any components for me?",
  whatsThisFor: "I shall use the components to construct a mighty weapon for you. Rest assured, the process will be beneficial to both of us.",
  final: [
    "You have served me well, it is good to see that you humans are still as gullible as ever!",
    "Bringing me those body parts from the Sires has now granted me enough teleportation energy to leave this living hell hole. Perhaps I will pay your realm a visit and there will be much to harvest!",
  ],
  finalAfterPlayer: [
    "Have you not learned yet, appearances can be deceiving. You hold in your hands a living weapon whose power is rivalled by few weapons from your world, use it wisely.",
    "Do not think that I am ungrateful for my freedom human. I will leave you this ancient tome that will instruct you in creating more of these weapons in future.",
    "Just use the three components on the book, and it will do the rest. You can get spare copies here any time you need.",
  ],
};

let OverseerLine = null;

/** One of the Overseer's lines, with his own model as the chathead. */
function overseerLine(index, text) {
  if (!OverseerLine) {
    const { NpcDialogue } = Common.core;
    OverseerLine = class extends NpcDialogue {
      send(player) {
        const head = (CHAT_GROUP << 16) | 2;
        player.getPacketSender()
          .sendChatboxInterface(CHAT_GROUP)
          .sendInterfaceRawModel(head, CHATHEAD_MODEL)
          .sendInterfaceAnimation(head, TALK_ANIM)
          .sendString("The Overseer", (CHAT_GROUP << 16) | 4);
        NpcDialogue.sendChatText(player, this.getText(), (CHAT_GROUP << 16) | 6, (CHAT_GROUP << 16) | 5);
      }
    };
  }
  return new OverseerLine(index, -1, text, "The Overseer");
}

/** Plays `script` (["o", text] the Overseer, ["p", text] the player, ["s", text] a statement), then `then`. */
function play(player, script, then = null) {
  const { DialogueChainBuilder, PlayerDialogue, StatementDialogue, ActionDialogue } = Common.core;
  const chain = new DialogueChainBuilder();
  script.forEach(([who, text], index) => {
    if (who === "o") chain.add(overseerLine(index, text));
    else if (who === "p") chain.add(new PlayerDialogue(index, text));
    else chain.add(new StatementDialogue(index, text));
  });
  if (then) chain.add(new ActionDialogue(script.length, { execute: then }));
  player.getDialogueManager().startDialogues(chain);
}

const says = (lines) => lines.map((text) => ["o", text]);

function lore(player) {
  return Number(player.getAttribute(Common.LORE_ATTRIBUTE)) || 0;
}

function setLore(player, value) {
  player.setAttribute(Common.LORE_ATTRIBUTE, value);
  player.getPacketSender().sendVarbit(Common.data.overseer.loreVarbit, value);
}

function parts(player) {
  return Number(player.getAttribute(Common.PARTS_ATTRIBUTE)) || 0;
}

function setParts(player, value) {
  player.setAttribute(Common.PARTS_ATTRIBUTE, value);
  player.getPacketSender().sendVarbit(Common.data.overseer.partsVarbit, value);
}

function pieceNames() {
  if (PIECE_NAMES.size === 0) {
    const { ItemDefinition } = Common.core;
    for (const id of Common.data.font.bludgeonPieces) PIECE_NAMES.set(id, ItemDefinition.forId(id)?.getName?.()?.toLowerCase() ?? "component");
  }
  return PIECE_NAMES;
}

/** "a bludgeon spine and a bludgeon axon": what he still wants. */
function stillWanted(player) {
  const held = parts(player);
  const wanted = Common.data.font.bludgeonPieces.filter((_, index) => !(held & (1 << index))).map((id) => `a ${pieceNames().get(id)}`);
  return wanted.length <= 1 ? wanted.join("") : `${wanted.slice(0, -1).join(", ")} and ${wanted[wanted.length - 1]}`;
}

function topics(player, first) {
  const options = [];
  if (first) options.push("What can I do here?", () => whatCanIDo(player));
  options.push("Tell me about yourself.", () => aboutSelf(player));
  options.push("Tell me about the Abyssal Sires.", () => aboutSires(player));
  options.push("I'll be off for now.", () => play(player, [["p", "I'll be off for now."]]));
  Common.api.sendMultiChatboxPrompt(player, "Select an Option", ...options);
}

function aboutSelf(player) {
  play(player, [["p", "Tell me about yourself."], ...says(LINES.aboutSelf)], () => topics(player, lore(player) < LORE.ASKED));
}

function aboutSires(player) {
  play(player, [["p", "Tell me about the Abyssal Sires."], ...says(LINES.aboutSires)], () => topics(player, lore(player) < LORE.ASKED));
}

function whatCanIDo(player) {
  setLore(player, LORE.ASKED);
  play(player, [["p", "What can I do here?"], ...says(LINES.whatCanIDo)]);
}

/** Hands over the components carried that he hasn't got: true if any changed hands. */
function handOver(player) {
  const pieces = Common.data.font.bludgeonPieces;
  let held = parts(player);
  let given = 0;
  pieces.forEach((id, index) => {
    if (held & (1 << index) || !player.getInventory().contains(id)) return;
    player.getInventory().delete(id, 1);
    held |= 1 << index;
    given++;
  });
  if (given > 0) setParts(player, held);
  return given;
}

function harvested(player) {
  const given = handOver(player);
  if (given > 0) {
    const handed = given === 1 ? "You hand over the component to the Overseer." : "You hand over the components to the Overseer.";
    if (parts(player) === (1 << Common.data.font.bludgeonPieces.length) - 1) {
      setLore(player, LORE.GIVEN);
      play(player, [["o", LINES.harvested], ["s", handed]], () => present(player));
      return;
    }
    play(player, [["o", LINES.harvested], ["s", handed], ["o", `I still require ${stillWanted(player)} from an Abyssal Sire.`]]);
    return;
  }
  play(player, [["o", LINES.harvested]], () => Common.api.sendMultiChatboxPrompt(player, "Select an Option",
    "What's this stuff for?", () => play(player, [["p", "What's this stuff for?"], ["o", LINES.whatsThisFor]]),
    "Tell me about yourself.", () => aboutSelf(player),
    "Tell me about the Abyssal Sires.", () => aboutSires(player),
    "No, sorry.", () => play(player, [["p", "No, sorry."], ["o", `I still require ${stillWanted(player)} from an Abyssal Sire.`]])));
}

/** All three given: the first bludgeon, and his farewell. */
function present(player) {
  const { overseer } = Common.data;
  if (lore(player) === LORE.GIVEN && !player.getAttribute(Common.BLUDGEON_GIVEN_ATTRIBUTE)) {
    // He holds the components, so with no room he keeps the weapon for the next talk. Our wording.
    if (player.getInventory().getAddableAmount(new Common.core.Item(overseer.bludgeon, 1)) < 1) {
      player.sendMessage("You don't have enough inventory space.");
      player.getPacketSender().sendInterfaceRemoval();
      return;
    }
    player.setAttribute(Common.BLUDGEON_GIVEN_ATTRIBUTE, true);
    player.getInventory().adds(overseer.bludgeon, 1);
  }
  play(player, [
    ["o", "I now have all the components I require, so here is the weapon I promised you."],
    ["s", "The Overseer presents you with an Abyssal Bludgeon."],
    ...says(LINES.final),
    ["p", "Yuck! This is disgusting. What use is this? It's unwieldly!"],
    ...says(LINES.finalAfterPlayer),
  ], () => Common.api.sendMultiChatboxPrompt(player, "Select an Option",
    "Thank you.", () => play(player, [["p", "Thank you."], ["o", "Farewell..."]], () => depart(player)),
    "Perhaps I shall use it to slay you, demon.", () => play(player,
      [["p", "Perhaps I shall use it to slay you, demon."], ["o", "So be it... I will await you on the fields of blood!"]], () => depart(player))));
}

function depart(player) {
  setLore(player, LORE.DEPARTED);
  setParts(player, 0);
  player.getPacketSender().sendInterfaceRemoval();
}

function talk({ player }) {
  switch (lore(player)) {
    case LORE.UNMET:
      setLore(player, LORE.MET);
      play(player, says(LINES.greeting), () => topics(player, true));
      return true;
    case LORE.MET:
      play(player, [["o", "Yes, human?"]], () => topics(player, true));
      return true;
    case LORE.ASKED:
      harvested(player);
      return true;
    case LORE.GIVEN:
      present(player);
      return true;
    default:
      return true;
  }
}

function useOnOverseer(event) {
  const { player, itemId } = event;
  if (!Common.data.font.bludgeonPieces.includes(itemId)) return false;
  const value = lore(player);
  if (value < LORE.ASKED) play(player, [["o", "I did not ask you to bring me anything, human."]]);
  else if (value === LORE.GIVEN) play(player, [["o", "I do not require anything further from you, human."]]);
  else harvested(player);
  return true;
}

function takeBook({ player }) {
  const { overseer } = Common.data;
  if (lore(player) < LORE.DEPARTED) return true;
  if (!player.getInventory().contains(overseer.book) && player.getInventory().getFreeSlots() > 0) player.getInventory().adds(overseer.book, 1);
  return true;
}

/** The three components used on the book fuse into a bludgeon. */
function useOnBook(event) {
  const { player } = event;
  const { overseer, font } = Common.data;
  const ids = [event.usedItemId, event.usedWithItemId];
  if (!ids.includes(overseer.book) || !ids.some((id) => font.bludgeonPieces.includes(id))) return false;
  if (!font.bludgeonPieces.every((id) => player.getInventory().contains(id))) return true;
  for (const id of font.bludgeonPieces) player.getInventory().delete(id, 1);
  player.getInventory().adds(overseer.bludgeon, 1);
  player.sendMessage(FUSED);
  return true;
}

function sendLore({ player }) {
  const { overseer } = Common.data;
  player.getPacketSender().sendVarbit(overseer.loreVarbit, lore(player));
  player.getPacketSender().sendVarbit(overseer.partsVarbit, parts(player));
}

function attachOverseer(api) {
  api.persistAttribute(Common.LORE_ATTRIBUTE, 0);
  api.persistAttribute(Common.PARTS_ATTRIBUTE, 0);
  api.persistAttribute(Common.BLUDGEON_GIVEN_ATTRIBUTE, false);
  api.onObjectInteraction(OVERSEER, { "Talk-to": talk });
  api.onObjectInteraction(BOOK, { Take: takeBook });
  for (const piece of ["Bludgeon spine", "Bludgeon claw", "Bludgeon axon"]) {
    api.onItemOnObject(piece, OVERSEER, useOnOverseer);
    api.onItemOnItem(piece, "Overseer's book", useOnBook);
  }
  api.onPlayerLogin(sendLore);
}

module.exports = { attachOverseer, LORE, stillWanted };
