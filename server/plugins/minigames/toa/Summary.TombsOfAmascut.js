"use strict";

/**
 * Tombs of Amascut: the scoreboard in Osmumten's burial chamber (toa_vault_scoreboard,
 * "Scoreboard": Read). It isn't the lobby's records board: it shows this raid's summary,
 * interface toa_raid_summary.
 *
 * rsprox 227/01852, 00581, 01753 and 01845: Read runs toplevel_mainmodal_open [-1, -1], opens
 * toa_raid_summary on the main modal, and sets:
 * - the nine room times, "m:ss.cc": kephri_time, baba_time, akkha_time, zebak_time and
 *   wardens_time (the bosses, the Wardens' phases together), then scabaras_time, apmeken_time,
 *   crondis_time and het_time (the puzzle rooms);
 * - challenge_total, the nine added up (01852: 17:37.80), and overall_total, the whole raid
 *   (20:00.60);
 * - active (the invocations on, "23") and raid_level ("530").
 * It then runs script 6590 once per party member, most damage dealt first: [name, damage dealt, damage taken, deaths,
 * title struct, -1, slot, party size, is the reader]. The script prints the three numbers and
 * the title's name (struct param 1525, "The Brawler"), or "-" for a title of -1.
 *
 * Titles (Wiki's table; cache: structs 391-412 name them). The tick the Wardens fall, the varbits
 * toa_title_achieved_* mark those a player earned and toa_title_selected the one shown, an index
 * in those varbits' order (227/01852 tick 12909: seven earned, 16 selected, The Brawler in the row).
 * Which of several earned titles is chosen isn't known: random here, an estimate. So are "most"
 * and "least" being compared among the whole party, and solo raids earning them against nobody.
 */

const Shared = require("./Shared.TombsOfAmascut");
const Raid = require("./RaidState.TombsOfAmascut");

const LOC_NAME = "toa_vault_scoreboard";
const INTERFACE_NAME = "toa_raid_summary";
/** No title: the row's title cell reads "-". */
const NO_TITLE = -1;
const SWIMMER_TICKS = 50;
const LEECH_ROOMS = 5;
const BALLER_ORBS = 20;

/**
 * In the varbits' order, from TOA_TITLE_ACHIEVED_SWIMMER: each title's struct and who earns it,
 * given the whole party's `party`. (The second varbit, chocolate teapot, is no longer a title.)
 */
const most = (party, of) => party.length > 0 && Math.max(...party.map(of));
const least = (party, of) => party.length > 0 && Math.min(...party.map(of));
const TITLES = [
  { struct: 392, earned: (m) => tallyOf(m, "swimTicks") >= SWIMMER_TICKS }, // The Swimmer
  null,
  { struct: 391, earned: (m, party) => leech(m, party) }, // The Leech
  { struct: 393, earned: (m, party) => tallyOf(m, "specialEnergy") > 0 && tallyOf(m, "specialEnergy") === most(party, (o) => tallyOf(o, "specialEnergy")) }, // The Specialist
  { struct: 394, earned: (m, party) => tallyOf(m, "foodEaten") === least(party, (o) => tallyOf(o, "foodEaten")) }, // The Picky Eater
  { struct: 395, earned: (m, party) => m.loadoutValue === least(party, (o) => o.loadoutValue ?? 0) }, // The Peasant
  { struct: 396, earned: (m, party) => m.loadoutValue === most(party, (o) => o.loadoutValue ?? 0) }, // The Showoff
  { struct: 397, earned: (m, party) => m.damageTaken > 0 && m.damageTaken === most(party, (o) => o.damageTaken) }, // The Tank
  { struct: 398, earned: (m) => tallyOf(m, "orbsDropped") > BALLER_ORBS }, // The Baller
  { struct: 401, earned: (m, party) => tallyOf(m, "scarabsKilled") > 0 && tallyOf(m, "scarabsKilled") === most(party, (o) => tallyOf(o, "scarabsKilled")) }, // The Entomophobe
  { struct: 402, earned: (m) => tallyOf(m, "moth") > 0 }, // The Moth
  { struct: 403, earned: (m, party) => m.damageDone > 0 && m.damageDone === most(party, (o) => o.damageDone) }, // The Carry
  { struct: 406, earned: (m, party) => m.deaths > 0 && m.deaths === most(party, (o) => o.deaths) }, // The Anchor
  { struct: 407, earned: (m, party) => tallyOf(m, "foodEaten") > 0 && tallyOf(m, "foodEaten") === most(party, (o) => tallyOf(o, "foodEaten")) }, // The Glutton
  { struct: 408, earned: (m, party) => tallyOf(m, "magicDamage") > 0 && tallyOf(m, "magicDamage") === most(party, (o) => tallyOf(o, "magicDamage")) }, // The Sorcerer
  { struct: 409, earned: (m, party) => tallyOf(m, "rangedDamage") > 0 && tallyOf(m, "rangedDamage") === most(party, (o) => tallyOf(o, "rangedDamage")) }, // The Archer
  { struct: 411, earned: (m, party) => tallyOf(m, "meleeDamage") > 0 && tallyOf(m, "meleeDamage") === most(party, (o) => tallyOf(o, "meleeDamage")) }, // The Brawler
  { struct: 412, earned: (m) => tallyOf(m, "clutch") > 0 }, // The Clutch
];

function tallyOf(member, key) {
  return member.tallies?.[key] ?? 0;
}

/** Wiki: the least points in at least five rooms; never the top damager or an MVP (19 October 2022). */
function leech(member, party) {
  if (party.length < 2 || tallyOf(member, "mvpRooms") > 0 || member.damageDone === most(party, (o) => o.damageDone)) return false;
  const lowest = member.roomScores.filter((score, room) => score <= Math.min(...party.map((o) => o.roomScores[room] ?? Infinity)));
  return lowest.length >= LEECH_ROOMS;
}

function loadoutValue(player) {
  const { ItemDefinition } = Shared.core();
  return [...player.getEquipment().getValidItems(), ...player.getInventory().getValidItems()]
    .reduce((sum, item) => sum + Math.max(0, ItemDefinition.forId(item.getId()).getGrandExchangeValue?.() ?? 0) * item.getAmount(), 0);
}

/** The Wardens fell: each player's earned titles, and the one the summary shows. */
function awardTitles({ raid }) {
  const members = [...raid.members.entries()];
  for (const [player, member] of members) member.loadoutValue = loadoutValue(player);
  const party = members.map(([, member]) => member);
  for (const [player, member] of members) {
    const earned = [];
    TITLES.forEach((title, index) => {
      if (!title) return;
      const has = !!title.earned(member, party);
      player.getPacketSender().sendVarbit(Shared.VARBIT.TITLE_ACHIEVED_BASE + index, has ? 1 : 0);
      if (has) earned.push(index);
    });
    const selected = earned.length > 0 ? Shared.randomOf(earned) : -1;
    member.title = selected === -1 ? NO_TITLE : TITLES[selected].struct;
    player.getPacketSender().sendVarbit(Shared.VARBIT.TITLE_SELECTED, Math.max(0, selected));
  }
}

/** Each time component and the raid rooms (Shared.ROOMS keys) whose times it adds up. */
const ROOM_TIMES = [
  ["kephri_time", ["SCABARAS_BOSS"]],
  ["baba_time", ["APMEKEN_BOSS"]],
  ["akkha_time", ["HET_BOSS"]],
  ["zebak_time", ["CRONDIS_BOSS"]],
  ["wardens_time", ["WARDENS_P1", "WARDENS_P3"]],
  ["scabaras_time", ["SCABARAS_PUZZLE"]],
  ["apmeken_time", ["APMEKEN_PUZZLE"]],
  ["crondis_time", ["CRONDIS_PUZZLE"]],
  ["het_time", ["HET_PUZZLE"]],
];

const cache = () => Shared.core().CacheDefinitions;
const uid = (component) => cache().getComponentId(`${INTERFACE_NAME}:${component}`);

/** m:ss.cc (h:mm:ss.cc past an hour), as the summary prints times; "-" for a room not done. */
function formatTicks(ticks) {
  return ticks > 0 ? Shared.formatTicksHundredths(ticks) : "-";
}

/** The component texts for `raid`, in the recording's order. */
function texts(raid) {
  const ticksOf = (keys) => raid.results.filter((result) => keys.includes(result.key))
    .reduce((sum, result) => sum + result.ticks, 0);
  const rooms = ROOM_TIMES.map(([component, keys]) => [component, ticksOf(keys)]);
  const challenge = rooms.reduce((sum, [, ticks]) => sum + ticks, 0);
  return [
    ["overall_total", formatTicks(raid.totalTicks)],
    ["challenge_total", formatTicks(challenge)],
    ...rooms.map(([component, ticks]) => [component, formatTicks(ticks)]),
    ["active", String(raid.settings.activeCount)],
    ["raid_level", String(raid.raidLevel)],
  ];
}

/**
 * Script 6590's arguments for each member still in the raid. Every recording lists them by
 * damage dealt, most first, and numbers the slots in that order (in each, the reader also dealt
 * the most, so "reader first" would fit them as well).
 */
function rows(raid, reader) {
  const here = [...raid.members.entries()].map(([player, member]) => ({ name: Shared.displayName(player), member, player }));
  // Wiki (28 September 2022): those who left mid-raid are acknowledged too.
  const everyone = [...here, ...(raid.departed ?? [])].sort((a, b) => b.member.damageDone - a.member.damageDone);
  return everyone.map(({ name, member, player }, slot) => [
    name,
    Math.max(0, Math.trunc(member.damageDone)),
    Math.max(0, Math.trunc(member.damageTaken)),
    member.deaths,
    member.title ?? NO_TITLE,
    -1,
    slot,
    everyone.length,
    player === reader ? 1 : 0, // a clientscript boolean is an int
  ]);
}

function read(event) {
  if (event.objectId !== cache().getLocId(LOC_NAME)) return false;
  const { player } = event;
  const raid = Raid.raidOf(player);
  if (!raid) return false;
  const sender = player.getPacketSender();
  sender.sendInterfaceScript(Shared.SCRIPT.MAINMODAL_OPEN, [-1, -1]);
  sender.sendInterface(cache().getInterfaceId(INTERFACE_NAME));
  for (const [component, text] of texts(raid)) sender.sendString(text, uid(component));
  for (const row of rows(raid, player)) sender.sendInterfaceScript(Shared.SCRIPT.SUMMARY_MEMBER_ROW, row);
  return true;
}

module.exports = function registerTombsSummary(api) {
  Shared.bind(api);
  api.onObjectInteraction("Scoreboard", { Read: read });
  api.onCustomEvent("toa:raid-won", awardTitles);
};

Object.assign(module.exports, { read, texts, rows, formatTicks, awardTitles, TITLES, ROOM_TIMES, LOC_NAME, INTERFACE_NAME });
