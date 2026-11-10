// Run after `yarn build`: node --test tests/chat-text-layout.test.cjs
//
// Issue 3976: the chatbox's line breaks and pages. Live breaks chat_left/chat_right/objectbox text
// in font 497 at 380 pixels and fills four lines a page (Plague City capture 20261110T113734-5ab63b4,
// the if_settext <br>s); a 53-character wrap split Bravek's four-line box (tick 630) into two pages.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { ChatTextLayout } = require("../dist/game/model/dialogues/ChatTextLayout");

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
});

/** Captured lines, as the client was sent them (<br> where live broke). */
const CAPTURED = [
  "I can't possibly speak to you with my head spinning like<br>this... I went a bit heavy on the drink again last night.<br>Curse my herbalist, she made the best hang over cures.<br>Darn inconvenient of her catching the plague.",
  "Really, would you? I've been working on a plan to get<br>into West Ardougne, but I'm too old and tired to carry<br>it through. But you on the other hand, you should have<br>no problem.",
  "I've tied a rope to the grill over there, will you help me<br>pull it off?",
  "I'm a friend of Jethick's, I have come to return a book<br>he borrowed.",
  "Thank you, thank you! Elena beat you back by<br>minutes. Now I said I'd give you a reward. What can<br>I give you as a reward I wonder? Here take this magic<br>scroll, I have little use for it but it may help you.",
  "You give Bravek the hangover cure. Bravek gulps down<br>the foul-looking liquid.",
];

test("lines break where live breaks them", () => {
  for (const live of CAPTURED) {
    assert.deepEqual(ChatTextLayout.wrap(live.split("<br>").join(" ")), live.split("<br>"));
  }
});

test("a four-line box is one page, a fifth line starts another", () => {
  const bravek = CAPTURED[0].split("<br>").join(" ");
  assert.equal(ChatTextLayout.pages(bravek).length, 1, "tick 630 is one box");
  assert.equal(ChatTextLayout.pages(`${bravek} ${bravek}`).length, 2);
});

test("an explicit break is kept and tags draw nothing", () => {
  assert.deepEqual(ChatTextLayout.pages("You pour water onto the soil.<br>The soil softens slightly."),
    ["You pour water onto the soil.<br>The soil softens slightly."]);
  assert.equal(ChatTextLayout.width("<col=800000>Edmond</col>"), ChatTextLayout.width("Edmond"));
});
