// Original concise lore adaptation; source and scope: docs/goblin-book.md (repository root).
const spreads = [
  [
    ["The first goblin armies", "", "During the gods' war, Bandos", "searched for followers.", "Other peoples already served", "rival gods."],
    ["The goblins offered to fight.", "Bandos trained and armed them,", "then organised twelve tribes.", "Some tribes served other gods;", "most remained his soldiers."],
  ],
  [
    ["A soldier's duties", "", "The goblins' faith demands", "obedience to their war god.", "They must defeat his enemies", "and stand firm in battle."],
    ["Their teachings condemn mercy", "and doubt. Soldiers follow", "orders instead of making", "plans of their own."],
  ],
  [
    ["A promise of return", "", "After the gods departed, the", "goblin tribes fought each", "other. Their losses threatened", "the survival of every tribe."],
    ["Hopespear reported a vision:", "the tribes should stop their", "feud and await a commander.", "Their faith promises conquest", "and their god's return.", "The tribes built a temple", "where their battle had raged."],
  ],
];
module.exports = {
  title: "The Book of the Big High War God",
  pages: spreads.map(([left, right]) => Object.fromEntries([
    ...left.map((text, line) => [44 + line, text]),
    ...right.map((text, line) => [60 + line, text]),
  ])),
};
