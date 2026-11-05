"use strict";

/**
 * The first death that loses items brings the player straight to Death, who explains graves
 * (the Wiki's transcript, "upon losing any items while dying for the first time"):
 * - the grave's timer holds (1501) until the player leaves through the portal, which then leads
 *   to the respawn point and starts it;
 * - the topics already heard are struck through, and "I think I'm done here." and the portal
 *   wait until all four are;
 * - talking to Death again resumes the tutorial ("I believe I was explaining gravestones to
 *   you."); a relog inside resumes it too. Once every topic is heard he greets as usual, so the
 *   grave can be collected early (ours: the Wiki has him offer a reminder until the player
 *   leaves).
 * UNVERIFIED (no capture): the chathead moods, and the item shown beside the explanations (the
 * gravestone).
 */
const Common = require("./Common.DeathsOffice");
const Instance = require("./Instance.DeathsOffice");
const Entrances = require("./Entrances.DeathsOffice");
const Death = require("./Death.DeathsOffice");

const HEARD_ATTRIBUTE = "deaths-office:tutorial-heard";
const TOPIC = { gravestones: 1, fees: 2, timer: 4, keptOnDeath: 8 };
const ALL_TOPICS = TOPIC.gravestones | TOPIC.fees | TOPIC.timer | TOPIC.keptOnDeath;
const INTRODUCED = 16;
const SIDEBUTTON_SWITCH = 915;
const WORN_TAB = 4;
const SPEAK_DELAY = 2;
const GRAVESTONE_OBJ = "sirens_tome";
const SELECT = "Select an option";

/** Players whose death just made their first grave, until the death moves them. */
const arriving = new Set();

function heard(player) {
  return Number(player.getAttribute(HEARD_ATTRIBUTE)) || 0;
}

function hear(player, bit) {
  player.setAttribute(HEARD_ATTRIBUTE, heard(player) | bit);
}

function heardAll(player) {
  return (heard(player) & ALL_TOPICS) === ALL_TOPICS;
}

function inTutorial(player) {
  return Common.state(player).inTutorial === true;
}

function gravestoneObj() {
  return Common.core().CacheDefinitions.getObjId(GRAVESTONE_OBJ);
}

/** Options already heard are struck through; picking one plays it again. */
function option(player, bit, text) {
  return (heard(player) & bit) !== 0 ? `<str>${text}</str>` : text;
}

// ---------------------------------------------------------------- arriving

/** The Gravestones plugin asks whether the office takes a first grave's owner. */
function firstGrave(request) {
  if (request.accepted || Common.state(request.player).ironman === "ultimate") return;
  request.accepted = true;
  arriving.add(request.player);
}

/** The death's respawn goes to Death's Office instead. */
function arriveAtDeath(event) {
  const { player } = event;
  if (!arriving.delete(player) || event.handled) return;
  event.handled = true;
  player.setAttribute(HEARD_ATTRIBUTE, null);
  Common.api().emitCustomEvent("gravestones:met-death", { player });
  Instance.enter(player, Common.DATA.loginArrival);
  Instance.approachDesk(player, () => {});
  Common.later(player, SPEAK_DELAY, () => introduction(player));
}

// ---------------------------------------------------------------- Death's explanations

function explainGravestones(again) {
  const lead = again ? "Gladly..." : "Let me explain...";
  const obj = gravestoneObj();
  return [
    { npc: `${lead} Across most of the land of Gielinor, when you die, some of the items you're carrying are dropped.`, mood: again ? "happy" : "bored" },
    { item: obj, text: "A gravestone appears on the ground near where you died. You can go there and retrieve your items by clicking on it." },
    { item: obj, text: "Your gravestone would be marked with an arrow to help to spot it. A grave icon appears on the world map too, if your grave is in a mapped area." },
    { item: obj, text: "Gravestones charge a small fee to return especially valuable items, but most things are returned free of charge. Conveniently, a gravestone can take its fee straight from your bank." },
    { item: obj, text: "A gravestone does not last forever. After about 15 minutes, a gravestone will collapse. Anything in it will be sent here, to me." },
    { npc: "I will look after such items, without a time limit. However, I do charge more for my services. It would be cheaper to retrieve them from the gravestone directly, if you can reach it in time.", mood: "bored" },
  ];
}

function introduction(player) {
  if (!Instance.inOffice(player)) return;
  hear(player, INTRODUCED);
  Common.talk(player, [
    { npc: "So, mortal... you have died, as all mortals do. As you have suffered the loss of some items on this occasion, I have brought you here to explain for you how that works.", mood: "bored" },
    { player: "I lost items? Can I get them back?", mood: "quiz" },
    ...explainGravestones(false),
  ], () => {
    hear(player, TOPIC.gravestones);
    menu(player);
  });
}

function menu(player) {
  Common.choose(player, SELECT,
    [option(player, TOPIC.gravestones, "Tell me about gravestones again."), () => Common.talk(player, [
      { player: "Tell me about gravestones again.", mood: "happy" },
      ...explainGravestones(true),
    ], () => {
      hear(player, TOPIC.gravestones);
      menu(player);
    })],
    [option(player, TOPIC.fees, "How do I pay a gravestone fee?"), () => Common.talk(player, [
      { player: "How do I pay a gravestone fee?", mood: "quiz" },
      { npc: "Cash is always acceptable. Also, a gravestone can take it directly from you bank, in case you didn't have enough with you.", mood: "happy" },
      { npc: "Besides that, take a look at my Coffer here. You can bring your unwanted possessions, and sacrifice them into my Coffer. I'll count their value against any future gravestone fees you're charged.", mood: "shifty" },
      { item: gravestoneObj(), text: "Death's Coffer won't accept items worth less than 10,000 coins per item - Death doesn't want cheap junk! But more valuable items can be sacrificed to pay down future reclamation fees." },
    ], () => {
      hear(player, TOPIC.fees);
      menu(player);
    })],
    [option(player, TOPIC.timer, "How long do I have to return to my gravestone?"), () => Common.talk(player, [
      { player: "How long do I have to return to my gravestone?", mood: "quiz" },
      { item: gravestoneObj(), text: "A gravestone lasts for at least 15 minutes before it collapses. However, that timer pauses if you become inactive, in case you have lost your connection to the world." },
      { item: gravestoneObj(), text: "A timer on your head-up display shows the remaining time before your gravestone will collapse." },
    ], () => {
      hear(player, TOPIC.timer);
      menu(player);
    })],
    [option(player, TOPIC.keptOnDeath, "How do I know what will happen to my items when I die?"), () => keptOnDeath(player)],
    ["I think I'm done here.", () => done(player)],
  );
}

/** Death opens the Worn Items tab, where the Items Kept on Death menu is. */
function keptOnDeath(player) {
  Common.talk(player, [
    { player: "How do I know what will happen to my items when I die?", mood: "quiz" },
    { npc: "There is a menu to predict these things for you. Take a look at your Worn Items side-panel...", mood: "happy" },
  ], () => {
    player.getPacketSender().sendInterfaceScript(SIDEBUTTON_SWITCH, [WORN_TAB]);
    Common.talk(player, [{ item: gravestoneObj(), text: "The Items Kept on Death menu tells you roughly what your items will do when you next die, including estimating gravestone fees." }], () => {
      hear(player, TOPIC.keptOnDeath);
      menu(player);
    });
  });
}

function done(player) {
  const finished = heardAll(player);
  Common.talk(player, [
    { player: "I think I'm done here.", mood: "bored" },
    finished
      ? { npc: "Very well. Once you pass through my portal, you will have 15 minutes to reach your gravestone.", mood: "happy" }
      : { npc: "I'm afraid we have more topics to cover before you leave. Speak to me when you are ready to continue.", mood: "sad" },
  ]);
}

// ---------------------------------------------------------------- talking again, leaving

/** Talk-to (and the greeting on reaching the desk) during the tutorial, until every topic is heard. */
function talk(player) {
  if (!inTutorial(player) || heardAll(player)) return false;
  if ((heard(player) & INTRODUCED) === 0) {
    introduction(player);
    return true;
  }
  Common.talk(player, [{ npc: "I believe I was explaining gravestones to you. We still have some more topics to cover.", mood: "angry" }], () => menu(player));
  return true;
}

/**
 * Collect during the tutorial: Death keeps talking until every topic is heard, then opens his
 * item retrieval as usual. UNVERIFIED (the Wiki is silent).
 */
function collect(player) {
  return talk(player);
}

/** The portal waits for the last topic: "it will wait until you leave this place". */
function keepInOffice(player) {
  if (!inTutorial(player) || heardAll(player)) return false;
  Common.talk(player, [{ npc: `I haven't finished talking to you yet, ${player.getDisplayName()}. Please don't worry about your gravestone - it will wait until you leave this place.`, mood: "neutral" }]);
  return true;
}

/** After the tutorial the portal leads to the respawn point. */
function exitAfterTutorial(player) {
  return inTutorial(player) ? Common.core().GameConstants.DEFAULT_LOCATION : null;
}

/** Leaving the office (the portal, or a teleport) ends the tutorial: the grave's timer starts. */
function leftOffice(player) {
  if (inTutorial(player)) Common.api().emitCustomEvent("gravestones:tutorial-end", { player });
}

function attach(api) {
  Common.bind(api);
  api.persistAttribute(HEARD_ATTRIBUTE);
  api.onCustomEvent("gravestones:first-grave", firstGrave);
  api.onPlayerDeath(arriveAtDeath);
  Death.setOverride({ talk, collect });
  Entrances.setExitGuard(keepInOffice);
  Entrances.setExitOverride(exitAfterTutorial);
  Instance.onLeave(leftOffice);
}

module.exports = { attach };
