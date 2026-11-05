"use strict";

// Per-tier rules. Step counts are from each tier's Wiki "Clue scroll (<tier>)" page, STASH
// costs from the Wiki "STASH" page; the difficulty is the cache clue-helper `difficulty` column.
const META_PREFIX = "treasure-trails:";
const completedAttribute = tier => `${META_PREFIX}${tier.name}-completed`;

const TIERS = [
  { name: "easy", label: "Easy", difficulty: 1, length: [2, 4], stash: { level: 27, xp: 150, plank: "PLANK" } },
  { name: "medium", label: "Medium", difficulty: 2, length: [3, 5], stash: { level: 42, xp: 250, plank: "OAK_PLANK" },
    // Ordinary-world rev235 recordings 1063/1064/1067 use this fixed icon, not the next clue.
    uriClueDisplay: "trail_medium_emote_exp9", uriClueMessage: "You've been given a clue!" },
  // Puzzle images are interface 306's varp 261 values: hard's castle, tree and troll (Wiki "Puzzle box").
  { name: "hard", label: "Hard", difficulty: 3, length: [4, 6], stash: { level: 55, xp: 400, plank: "TEAK_PLANK" }, puzzleImages: [1, 2, 3] },
  { name: "elite", label: "Elite", difficulty: 4, length: [5, 7], stash: { level: 77, xp: 600, plank: "MAHOGANY_PLANK" } },
  // Master's puzzle images are enum 1864's Zulrah, Cerberus, gnome child and Theatre of Blood, each
  // with its own box item. Its STASH units also take a gold leaf.
  { name: "master", label: "Master", difficulty: 5, length: [6, 8], stash: { level: 88, xp: 1500, plank: "MAHOGANY_PLANK", extra: [["GOLD_LEAF", 1]] },
    puzzleImages: [4, 5, 6, 9], puzzleBoxes: { 4: "trail_master_zulrah_puzzlebox", 5: "trail_master_cerberus_puzzlebox",
      6: "trail_master_gnomechild_puzzlebox", 9: "trail_master_tob_puzzlebox" } },
];

const byName = new Map(TIERS.map(tier => [tier.name, tier]));

function sharedCompletedCount(player) {
  const beginner = Number(player.getAttribute(completedAttribute({ name: "beginner" }))) || 0;
  return TIERS.reduce((sum, tier) => sum + (Number(player.getAttribute(completedAttribute(tier))) || 0), beginner);
}

module.exports = { TIERS, byName, META_PREFIX, completedAttribute, sharedCompletedCount };
