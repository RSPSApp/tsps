"use strict";

const { api, ItemIdentifiers, DialogueChainBuilder, StatementDialogue, PlayerDialogue } = require("./Core.Construction");
const Ids = require("./Ids.Construction");
const House = require("./House.Construction");
const Menu = require("./Menu.Construction");

const BASEMENT = 0;

function say(player, text) {
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(new StatementDialogue(0, text)));
}

function furnitureAt(event) {
  const house = House.houseFor(event.player);
  return house?.getFurnitureAt(event.location, event.objectId, event.object?.getType() ?? 10) ?? null;
}

// Telescopes see the next shooting star coming: its region and a landing window as wide as the
// telescope is accurate (Wiki: oak 24, teak 9, mahogany 2 minutes). Messages from rsprox captures.
const TELESCOPE_ACCURACY = { WOODEN_TELESCOPE: 24, TEAK_TELESCOPE: 9, MAHOGANY_TELESCOPE: 2 };
// Regions the message names with "the" (the Kharidian Desert is captured; the rest by analogy).
const THE_REGIONS = new Set(["Kharidian Desert", "Wilderness", "Feldip Hills and the Isle of Souls", "Fremennik Lands and Lunar Isle", "Kebos Lowlands"]);

function observe(event) {
  const furniture = furnitureAt(event);
  const accuracy = furniture && TELESCOPE_ACCURACY[furniture.buildableKey];
  if (!accuracy) return false;
  const player = event.player;
  if (event.location.z === BASEMENT) {
    player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(
      new PlayerDialogue(0, "Hmm... This telescope doesn't seem to work underground.")));
    return true;
  }
  const forecast = { player, region: null, minutes: 0 };
  api.emitCustomEvent("shooting-stars:forecast", forecast);
  if (!forecast.region) {
    say(player, "You look through the telescope, but you don't see anything interesting.");
    return true;
  }
  const earliest = Math.max(0, Math.floor(forecast.minutes - Math.random() * accuracy));
  const region = THE_REGIONS.has(forecast.region) ? `the ${forecast.region}` : forecast.region;
  say(player, `You see a shooting star! The star looks like it will land in ${region} in the next ${earliest} to ${earliest + accuracy} minutes.`);
  return true;
}

// The study's crystal ball changes an elemental staff's element: ordinary staffs free, then
// battlestaffs (100 runes of the new element) on the elemental sphere and mystic staffs (1,000)
// on the crystal of power (Wiki). "Select an element" and the refusals are from captures.
const ELEMENTS = ["Earth", "Air", "Fire", "Water"];
function staves(name) {
  return Object.fromEntries(ELEMENTS.map((element) => [element, Ids.obj(name(element.toLowerCase()))]));
}
const STAVES = [
  { tier: 1, cost: 0, ids: staves((element) => `staff_of_${element}`) },
  { tier: 2, cost: 100, ids: staves((element) => `${element}_battlestaff`) },
  { tier: 3, cost: 1000, ids: staves((element) => `mystic_${element}_staff`) },
];
const RUNES = { Air: ItemIdentifiers.AIR_RUNE, Water: ItemIdentifiers.WATER_RUNE, Earth: ItemIdentifiers.EARTH_RUNE, Fire: ItemIdentifiers.FIRE_RUNE };
const BALLS = { CRYSTAL_BALL: 1, ELEMENTAL_SPHERE: 2, CRYSTAL_OF_POWER: 3 };
const BALL_REFUSALS = { 1: "That crystal ball can only change ordinary staffs.", 2: "That sphere can only change ordinary staffs and battlestaffs." };

function staffOn(event) {
  const furniture = furnitureAt(event);
  const ballTier = furniture && BALLS[furniture.buildableKey];
  if (!ballTier) return;
  event.handled = true;
  const player = event.player;
  const staff = STAVES.find(entry => Object.values(entry.ids).includes(event.itemId));
  if (!staff) return say(player, "Only ordinary elemental staffs, elemental battlestaffs and elemental mystic staffs can be switched using the sphere.");
  if (staff.tier > ballTier) return say(player, BALL_REFUSALS[ballTier]);
  api.sendMultiChatboxPrompt(player, "Select an element", ...ELEMENTS.flatMap(element => [element, () => changeStaff(player, event.itemId, staff, element)]));
}

function changeStaff(player, itemId, staff, element) {
  const into = staff.ids[element];
  if (into === itemId || !player.getInventory().contains(itemId)) return;
  if (staff.cost && player.getInventory().getAmount(RUNES[element]) < staff.cost) {
    return say(player, `You need ${staff.cost.toLocaleString("en-US")} ${element.toLowerCase()} runes to change that staff.`);
  }
  if (staff.cost) player.getInventory().delete(RUNES[element], staff.cost);
  player.getInventory().delete(itemId, 1);
  player.getInventory().adds(into, 1);
}

// Clocks: "It's Rune o'clock." (captures).
function readClock(event) {
  if (!House.houseFor(event.player)) return false;
  event.player.sendMessage("It's Rune o'clock.");
  return true;
}

// The achievement gallery's adventure log: the owner's logs (captured menu). Only the collection
// log exists on this server so far.
const LOGS = ["Slayer log", "Boss log", "Champions log", "Collection log", "Counters"];
const ADVENTURE_LOGS = ["Mahogany Adventure Log", "Gilded Adventure Log", "Marble adventure log"];

function readLog(event) {
  const house = House.houseFor(event.player);
  if (!house) return false;
  const player = event.player;
  Menu.openMenu(player, `The Exploits of ${house.owner?.getDisplayName() ?? player.getDisplayName()}`, LOGS, index => {
    if (LOGS[index] === "Collection log") api.emitCustomEvent("collection-log:open", { player });
    else player.sendMessage("Nothing interesting happens.");
  });
  return true;
}

function attachStudy(api) {
  api.onObjectInteraction("Telescope", { Observe: observe });
  api.onObjectInteraction("Clock", { Read: readClock });
  for (const name of ADVENTURE_LOGS) api.onObjectInteraction(name, { Read: readLog });
  api.onItemOnObject(staffOn, { noted: false });
}

Object.assign(module.exports, { attachStudy });
