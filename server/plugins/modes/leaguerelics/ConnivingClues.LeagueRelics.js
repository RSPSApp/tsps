/**
 * Conniving Clues (https://oldschool.runescape.wiki/w/Demonic_Pacts_League/Relics), Demonic Pacts'
 * tier 4 relic: the shared clue perks (1 in 15 clue scrolls from creatures and impling jars, 10
 * times the clue vessels, the fewest steps, the most casket rolls), emote, Falo the Bard and
 * Charlie the Tramp steps that ask for no items (the cache's relic text names Charlie; the Wiki
 * does not), and an opened reward casket has a 1 in 3 chance of clue contracts (by its tier: 0-2
 * beginner up to 1-10 master) and, apart, a 1 in 4 chance of a scroll box of its tier. A clue
 * contract's Teleport-to-clue spends one and goes to where the clue read last leads, in the
 * cache's own words when it cannot (league_relic_clue_direct_teleport_item); a step that asks
 * for a kill or a hot-cold spot is refused as the clue compass refuses it.
 */
const Common = require("./Common.LeagueRelics");
const Teleports = require("./Teleports.LeagueRelics");
const attachClues = require("./Clues.LeagueRelics");

const KEY = "clue-contract";
const CONTRACT_ROW = "league_clue_teleport_item_clue_contract";

let core;
let effect;

function active(player) {
  return Common.effectActive(player, effect);
}

function waive(request) {
  if (effect.waived.includes(request.kind) && active(request.player)) request.waived = true;
}

function roll(low, high) {
  return low + Math.floor(Math.random() * (high - low + 1));
}

/** To the inventory, else the bank; false when neither has room. */
function give(player, itemId, amount) {
  const item = new core.Item(itemId, amount);
  if (player.getInventory().getAddableAmount(item) >= amount) {
    player.getInventory().adds(itemId, amount);
    return true;
  }
  return Common.bank(player, itemId, amount);
}

function casketOpened({ player, tier }) {
  if (!active(player)) return;
  const range = effect.contracts[tier];
  if (range && Math.floor(Math.random() * effect.contractChance) === 0) {
    const amount = roll(range[0], range[1]);
    if (amount > 0 && !give(player, core.ItemIdentifiers[effect.contract], amount)) player.sendMessage(Common.message("noRoom"));
  }
  const box = core.ItemIdentifiers[`SCROLL_BOX_${String(tier).toUpperCase()}_`];
  if (Number.isInteger(box) && Math.floor(Math.random() * effect.scrollBoxOneIn) === 0 && !give(player, box, 1)) {
    player.sendMessage(Common.message("noRoom"));
  }
}

/** The cache's lines for the contract: [no clue read, a step it cannot reach]. */
function contractLines() {
  const { CacheDefinitions } = core;
  const row = CacheDefinitions.getDbRow(CacheDefinitions.getDbRowId(CONTRACT_ROW));
  const column = (name) => CacheDefinitions.getDbColumn(row.tableId, name);
  return [row.string(column("null_clue_text")), row.string(column("null_clue_coord_text"))];
}

function teleportToClue(event) {
  const { player } = event;
  if (!active(player)) return false;
  event.handled = true;
  const [noClue, unreachable] = contractLines();
  const step = { player, location: null, target: null, family: null };
  Common.api.emitCustomEvent("treasure-trails:current-step", step);
  if (!step.location) {
    player.sendMessage(noClue);
    return true;
  }
  if (step.target === "kill" || step.family === "hotcold") {
    player.sendMessage(unreachable);
    return true;
  }
  const contract = core.ItemIdentifiers[effect.contract];
  if (!player.getInventory().contains(contract)) return true;
  const { x, y, z } = step.location;
  if (Teleports.go(player, KEY, { label: "Current step", location: new core.Location(x, y, z ?? 0), remember: false })) {
    player.getInventory().deleteNumber(contract, 1);
  }
  return true;
}

module.exports = function attach(api) {
  core = api.core;
  effect = Common.data.effects.connivingClues;
  attachClues(api, effect);
  api.onCustomEvent("treasure-trails:requirement-waived", waive);
  api.onCustomEvent("treasure-trails:casket-opened", casketOpened);
  api.onItemAction(effect.contractName, { "Teleport-to-clue": teleportToClue });
};
