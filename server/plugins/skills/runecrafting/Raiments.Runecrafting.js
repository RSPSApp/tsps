"use strict";

/**
 * Raiments of the Eye: extra runes when crafting at an altar (Wiki: Raiments of the Eye,
 * https://oldschool.runescape.wiki/w/Raiments_of_the_Eye).
 *
 * Each worn piece (hat, robe top, robe bottoms, boots, in any dye) is worth 10% and the full set
 * 20% more, 60% in all. The bonus is `floor(R / 10) * M` for the R runes made before it, with M
 * 1, 2, 3 or 6 for 1, 2, 3 or 4 pieces; when 10 does not divide R, the Wiki says there is a
 * chance of `floor(R / 10 + 1) * M` instead, "based on the remainder". The chance is taken as
 * `(R mod 10) / 10`, which makes the average bonus exactly `R * M / 10`. The Wiki's example: 28
 * runes with one piece give 2 or 3 bonus runes, with the full set 12 or 18.
 *
 * Bonus runes give no extra XP, and they count toward the rune totals of the Achievement Diary
 * tasks (the Wiki's diary tables), so the event reports them in `runeAmount`. The Ourania Altar
 * takes the full set's 60% "in the same way" (Wiki: Ourania Altar). No recording shows an altar
 * crafted in the raiments on a main-game world (the Hat of the Eye captures, rev 227, are Leagues).
 */

/** The pieces by equipment slot: the cache name each piece (and its dyed forms) starts with. */
let PIECES;
/** The multiplier M by pieces worn: 10% each, and the set's 20% on top of the fourth. */
const MULTIPLIER_BY_PIECES = [0, 1, 2, 3, 6];

let core;

function attach(pluginApi) {
  core = pluginApi.core;
  const { Equipment } = core;
  PIECES = [
    { slot: Equipment.HEAD_SLOT, prefix: "Hat of the Eye" },
    { slot: Equipment.BODY_SLOT, prefix: "Robe top of the Eye" },
    { slot: Equipment.LEG_SLOT, prefix: "Robe bottoms of the Eye" },
    { slot: Equipment.FEET_SLOT, prefix: "Boots of the Eye" },
  ];
}

function pieceName(item) {
  const id = item?.getId?.() ?? -1;
  return id > 0 ? core.ItemDefinition.forId(id)?.getName?.() ?? "" : "";
}

/** How many of the four pieces the player wears. */
function piecesWorn(player) {
  const worn = player?.getEquipment?.()?.getItems?.();
  if (!worn) return 0;
  return PIECES.filter(({ slot, prefix }) => pieceName(worn[slot]).startsWith(prefix)).length;
}

/** The bonus runes for `runes` made: a whole `floor(R / 10)` share per M, plus the remainder's chance of one more. */
function bonusFor(runes, pieces, random = Math.random) {
  const multiplier = MULTIPLIER_BY_PIECES[pieces] ?? 0;
  if (multiplier <= 0 || !(runes > 0)) return 0;
  const whole = Math.floor(runes / 10);
  const remainder = runes % 10;
  return (whole + (remainder > 0 && random() * 10 < remainder ? 1 : 0)) * multiplier;
}

/** The bonus runes a player's raiments add to `runes` made at an altar. */
function bonusRunes(player, runes, random = Math.random) {
  return bonusFor(runes, piecesWorn(player), random);
}

module.exports = { attach, bonusRunes, bonusFor, piecesWorn, MULTIPLIER_BY_PIECES };
