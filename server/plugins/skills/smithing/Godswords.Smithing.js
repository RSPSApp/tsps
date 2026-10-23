/**
 * Godsword blades (https://oldschool.runescape.wiki/w/Godsword_blade): two different shard
 * pieces are forged together at an anvil (80 Smithing, 100 XP each), shards into pairs and a
 * pair with the last shard into the blade. The blade and a hilt make the godsword, no skill.
 *
 * Captured (rsprox recs 1515, 1517; docs/smithing.md): Smith (or a piece used on the anvil)
 * opens "You set to work, trying to fix the ancient sword..." with human_smithing, again 3
 * ticks later; 6 ticks in the pieces become the result, shown in an item box "Even for an
 * experienced smith it is not an easy task, but eventually it is done.", with 100 XP.
 */
const Core = require("./Core.Smithing");
const Sessions = require("./Sessions.Smithing");
const { messageBox, itemBox, hasHammer, smithingLevel, hammering } = require("./Common.Smithing");

const LEVEL = 80;
const XP = 100;
const START_MESSAGE = "You set to work, trying to fix the ancient sword...";
const DONE_MESSAGE = "Even for an experienced smith it is not an easy task, but eventually it is done.";
const NEED_TWO_MESSAGE = "You need at least two different Godsword blade pieces in your inventory to reforge them.";
const NO_HAMMER_MESSAGE = "You'll need a hammer if you wish to repair the Godsword.";
const ON_EACH_OTHER_MESSAGE = "Those pieces of the Godsword can't be joined together like that - try forging them on an anvil.";

/** Each piece and the shards it holds. */
function pieces() {
  const Items = Core.ItemIdentifiers;
  return [
    [Items.GODSWORD_SHARD_1, [1]],
    [Items.GODSWORD_SHARD_2, [2]],
    [Items.GODSWORD_SHARD_3, [3]],
    [Items.GODSWORD_SHARDS_1_2, [1, 2]],
    [Items.GODSWORD_SHARDS_1_3, [1, 3]],
    [Items.GODSWORD_SHARDS_2_3, [2, 3]],
    [Items.GODSWORD_BLADE, [1, 2, 3]],
  ];
}

function hilts() {
  const Items = Core.ItemIdentifiers;
  return new Map([
    [Items.ARMADYL_HILT, Items.ARMADYL_GODSWORD],
    [Items.BANDOS_HILT, Items.BANDOS_GODSWORD],
    [Items.SARADOMIN_HILT, Items.SARADOMIN_GODSWORD],
    [Items.ZAMORAK_HILT, Items.ZAMORAK_GODSWORD],
    [Items.ANCIENT_HILT, Items.ANCIENT_GODSWORD],
  ]);
}

function isPiece(itemId) {
  return pieces().some(([id, shards]) => id === itemId && shards.length < 3);
}

/** The first two carried pieces that hold different shards, and what they forge into. */
function combination(player) {
  const inventory = player.getInventory();
  const carried = pieces().filter(([id, shards]) => shards.length < 3 && inventory.contains(id));
  for (let i = 0; i < carried.length; i++) {
    for (let j = i + 1; j < carried.length; j++) {
      const shards = [...carried[i][1], ...carried[j][1]].sort();
      if (new Set(shards).size !== shards.length) continue;
      const result = pieces().find(([, held]) => held.join() === shards.join());
      return { from: [carried[i][0], carried[j][0]], into: result[0] };
    }
  }
  return null;
}

function holdsPiece(player) {
  return pieces().some(([id, shards]) => shards.length < 3 && player.getInventory().contains(id));
}

function forge(player) {
  const pair = combination(player);
  if (!pair) {
    messageBox(player, NEED_TWO_MESSAGE);
    return;
  }
  if (!hasHammer(player)) {
    messageBox(player, NO_HAMMER_MESSAGE);
    return;
  }
  if (smithingLevel(player) < LEVEL) {
    messageBox(player, `You need a Smithing level of ${LEVEL} to repair the Godsword.`);
    return;
  }
  const animate = () => player.performAnimation(hammering());
  Sessions.timeline(player, "godsword", [
    { at: 0, run: () => { messageBox(player, START_MESSAGE); animate(); } },
    { at: 3, run: animate },
    { at: 6, run: () => finish(player, pair) },
  ]);
}

function finish(player, pair) {
  const inventory = player.getInventory();
  if (!pair.from.every((id) => inventory.contains(id))) return false;
  for (const id of pair.from) inventory.deleteNumber(id, 1);
  inventory.addItem(new Core.Item(pair.into, 1));
  player.getSkillManager().addExperiences(Core.Skill.SMITHING, XP);
  itemBox(player, pair.into, DONE_MESSAGE);
  Core.api.emitCustomEvent("smithing:success", { player, skill: Core.Skill.SMITHING, itemId: pair.into });
  return true;
}

/** Smith on an anvil: the godsword takes it when the player holds two pieces that fit. */
function smithAtAnvil(player) {
  if (!combination(player)) return false;
  forge(player);
  return true;
}

function useOnAnvil(event) {
  if (!isPiece(event.itemId)) return false;
  event.handled = true;
  forge(event.player);
  return true;
}

function joinByHand(event) {
  const { player, usedItemId: used, usedWithItemId: target } = event;
  const hilt = hilts().get(used) != null ? used : target;
  const other = hilt === used ? target : used;
  const godsword = hilts().get(hilt);
  if (godsword != null && other === Core.ItemIdentifiers.GODSWORD_BLADE) {
    const inventory = player.getInventory();
    inventory.deleteNumber(Core.ItemIdentifiers.GODSWORD_BLADE, 1);
    inventory.deleteNumber(hilt, 1);
    inventory.addItem(new Core.Item(godsword, 1));
    event.handled = true;
    return;
  }
  if (isPiece(used) && isPiece(target)) {
    player.sendMessage(ON_EACH_OTHER_MESSAGE);
    event.handled = true;
  }
}

module.exports = function attach(api) {
  api.onItemOnItem(joinByHand, { noted: false });
};

Object.assign(module.exports, { smithAtAnvil, useOnAnvil, holdsPiece });
