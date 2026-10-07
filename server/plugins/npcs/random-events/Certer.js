"use strict";

// Question flow adapted from Void Certer.kt (BSD-3-Clause), using OSRS widgets
// and cache presentation items instead of RS3 enums/gift bags. See SOURCES.md.
const Gift = require("./GiftRewards");
const GROUP = 184;
const MODEL = (GROUP << 16) | 7;
const FIRST_OPTION = 8;
const SELECT_ACTION = 1;
// Cache 237's unnamed macro-quiz items; RuneLite's generated ItemID labels
// identify their categories. Fish variants share an answer, so use one.
const FISH = 6189, SWORD = 6191, BATTLEAXE = 6192, HELMET = 6193, SHIELD = 6194;
const SHEARS = 6195, SPADE = 6196, RING = 6197, NECKLACE = 6198;
const ITEMS = [[FISH, "Fish"], [SWORD, "Sword"], [BATTLEAXE, "Battleaxe"],
  [HELMET, "Helmet"], [SHIELD, "Shield"], [SHEARS, "Shears"],
  [SPADE, "Spade"], [RING, "Ring"], [NECKLACE, "Necklace"]];

function open(api, active) {
  if (!active.question) {
    const answer = ITEMS[Math.floor(Math.random() * ITEMS.length)];
    const alternatives = ITEMS.filter(item => item !== answer);
    const choices = [answer];
    while (choices.length < 3) choices.push(alternatives.splice(Math.floor(Math.random() * alternatives.length), 1)[0]);
    for (let i = choices.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [choices[i], choices[j]] = [choices[j], choices[i]];
    }
    active.question = { answer, choices };
  }
  active.interfaceId = GROUP;
  const sender = active.player.getPacketSender();
  sender.sendInterface(GROUP);
  sender.sendItemOnInterfaces(MODEL, active.question.answer[0], 1);
  active.question.choices.forEach((item, index) => {
    sender.sendString(item[1], (GROUP << 16) | (1 + index));
    sender.sendInterfaceFlagsRange((GROUP << 16) | (FIRST_OPTION + index), -1, -1, 1 << SELECT_ACTION);
  });
}

function choose(api, active, event, { valid, serve, finish }) {
  const index = (event.buttonId & 0xffff) - FIRST_OPTION;
  if ((event.buttonId >>> 16) !== GROUP || index < 0 || index > 2) return;
  event.handled = true;
  if (event.action !== SELECT_ACTION || !active?.question || active.definition.kind !== "certer" ||
      active.player.getInterfaceId() !== GROUP || !valid(active, event.player)) return;
  if (active.question.choices[index] !== active.question.answer) {
    finish(active);
    active.player.sendMessage("That's not right. Better luck next time!");
    return;
  }
  active.gift ??= Gift.roll(api);
  if (serve(active, [active.gift])) active.player.sendMessage("Correct! The certer gives you a reward.");
}

module.exports = { open, choose };
