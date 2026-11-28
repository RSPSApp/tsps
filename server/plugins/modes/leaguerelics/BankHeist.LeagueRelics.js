/**
 * Bank Heist (https://oldschool.runescape.wiki/w/Bank_Heist_(Raging_Echoes_League)), Raging Echoes'
 * tier 3 relic and Demonic Pacts': the Banker's briefcase teleports to any bank, bank chest or deposit
 * box, in unlocked areas, from any Wilderness level; Last-destination repeats the last.
 *
 * As live (rsprox 234/3278): Teleport opens the menu interface (187), "Bank Heist teleports", one list
 * of live's banks in live's order (plugins/modes/data/league-bank-heist.json, with each one's tile and
 * source); one in an area not unlocked, behind a quest not done (the Wiki's), or whose `requires` the
 * character doesn't meet (a guild's levels, the Cooks' Guild bank's diary: live strikes these too), is
 * struck through, and picking it says why. The teleport is the standard one, and as it starts the
 * destination's tile goes to varp league_bank_heist_last_destination (plane << 28 | x << 14 | y), as
 * live sends it.
 * Alchemy Guild's 70 Herblore is the recordings' (the Wiki says 60; live strikes it at 68 with the
 * quest done, and no recording shows 69).
 */
const Common = require("./Common.LeagueRelics");
const Teleports = require("./Teleports.LeagueRelics");
const DATA = require("../data/league-bank-heist.json");

const KEY = "bankers-briefcase";

let effect;
let list = null;

function active(player) {
  return Common.effectActive(player, effect);
}

/** Live's banks: { label, location, quest }. */
function banks() {
  if (list) return list;
  const { Location } = Common.core;
  list = DATA.destinations.map((bank) => ({
    label: bank.name, location: new Location(bank.x, bank.y, bank.z ?? 0), quest: bank.quest ?? null, requires: bank.requires ?? null,
  }));
  return list;
}

/** Whether the bank's quest is done (no quest, or nobody answering: no bar). */
function questDone(player, quest) {
  if (!quest) return true;
  const query = { player, name: quest, complete: null };
  Common.api.emitCustomEvent("quest:is-complete", query);
  return query.complete !== false;
}

/** The character's current level (boosts count, as a guild's door counts them). */
function level(player, skill) {
  const { Skill } = Common.core;
  return player.getSkillManager().getCurrentLevel(Skill[skill.toUpperCase()]);
}

/** One way in: its levels, combined total and diary tier, all met. */
function meetsOne(player, way) {
  if (way.levels && !Object.entries(way.levels).every(([skill, needed]) => level(player, skill) >= needed)) return false;
  if (way.combined && way.combined.skills.reduce((sum, skill) => sum + level(player, skill), 0) < way.combined.total) return false;
  if (way.diary) {
    const query = { player, diary: way.diary.key, tier: way.diary.tier, complete: null };
    Common.api.emitCustomEvent("diary:is-complete", query);
    if (query.complete === false) return false;
  }
  return true;
}

/** Whether the character meets one of the bank's `requires` (none: yes). */
function meets(player, bank) {
  return !bank.requires?.length || bank.requires.some((way) => meetsOne(player, way));
}

/** The destination's tile in the varp, as live sends it as the teleport starts. */
function sendLast(player, location) {
  const varp = Common.core.CacheDefinitions.getVarpId(effect.lastVarp);
  if (!Number.isInteger(varp)) return;
  player.getPacketSender().sendConfig(varp, ((location.getZ() << 28) | (location.getX() << 14) | location.getY()) >>> 0);
}

function choose(player, bank) {
  if (!questDone(player, bank.quest)) {
    player.sendMessage(Common.message("questNeeded", { quest: bank.quest }));
    return;
  }
  if (!meets(player, bank)) {
    player.sendMessage(Common.message("requirementsNeeded"));
    return;
  }
  Teleports.go(player, KEY, bank, { onStart: () => sendLast(player, Teleports.landing(bank.location)) });
}

function teleport(player) {
  Teleports.listMenu(player, Common.message("bankHeistTitle"), banks().map((bank) => ({
    label: bank.label,
    locked: !Teleports.areaOpen(player, bank.location) || !questDone(player, bank.quest) || !meets(player, bank),
    choose: () => choose(player, bank),
  })));
}

/** An option's handler for the relic's owner; anyone else's click goes on to the game's own (false). */
function only(fn) {
  return (event) => {
    if (!active(event.player)) return false;
    event.handled = true;
    fn(event.player);
  };
}

module.exports = function attach(api) {
  effect = Common.data.effects.bankHeist;
  api.persistAttribute(Teleports.lastAttribute(KEY), null);
  Teleports.attachMenu(api);
  api.onItemAction(effect.toolName, {
    Teleport: only(teleport),
    "Last-destination": only((player) => Teleports.goLast(player, KEY, { onStart: (location) => sendLast(player, location) })),
  });
};

module.exports._test = { banks };
