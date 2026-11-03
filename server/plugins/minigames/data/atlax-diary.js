// Atlax's diary (obj gotr_book), a Rewards Guardian reward. The text isn't in the cache: transcribe
// it from the OSRS Wiki's "Transcript:Atlax's diary" (24 pages) in plugins/items/data/goblin-book.js's
// shape, one [left lines, right lines] pair a spread, up to 15 lines a page.
const spreads = [];
module.exports = {
  title: "Atlax's diary",
  pages: spreads.map(([left, right]) => Object.fromEntries([
    ...left.map((text, line) => [44 + line, text]),
    ...right.map((text, line) => [60 + line, text]),
  ])),
};
