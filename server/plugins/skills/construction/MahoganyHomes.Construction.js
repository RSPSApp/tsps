"use strict";

const {
  api, Animation, CacheDefinitions, DialogueChainBuilder, NpcDialogue, ActionDialogue, Equipment, ItemDefinition, Skill,
  ItemIdentifiers: Items,
} = require("./Core.Construction");
const Ids = require("./Ids.Construction");
const House = require("./House.Construction");

// Mahogany Homes (Wiki, and one Leagues rsprox capture, recording 1863, for the tier menu, the
// hotspot sounds and the last-job line; the other dialogue lines and messages here are ours
// except "I'd better leave this alone right now."): Amy in Falador, then also Marlo (Varrock),
// Ellie (East Ardougne) and Angelo (Hosidius) give contracts at four tiers (Beginner, Novice,
// Adept, Expert: levels 1/20/50/70, planks, oak, teak, mahogany) for a random client's home in
// any of the four cities (HOMES below, from the cache). A home's hotspot shows 1 broken (Repair: a
// plank of the tier, or a steel bar for a sink, range or bath), 3 old furniture (Remove), 4 an
// empty space (Build: the Wiki's planks per piece) and 5-8 the new piece in plain, oak, teak or
// mahogany wood; 0 is the home as it stands.
// Speaking to the client when the work is done gives the tier's experience and Carpenter points
// and a cup of tea (run energy to 100%). The Wiki's experience per plank, per repair and per
// contract is used; the full Carpenter's outfit adds 2.5%. Which pieces need work is our
// approximation of the Wiki's per-client layouts. Amy's Rewards opens the reward shop (673).
// The homes, from the cache: each con_contract_<home>_hotspot<n> multiloc, the display varbit it
// reads (con_contract_hotspot_<n>_display), and its piece of furniture, named by its empty-space
// form (or its broken form for the pieces that are only ever repaired). ./data has the clients
// and the Wiki's planks per piece.
const MAHOGANY = require("./data/mahogany-homes.json");
const HOMES = (() => {
  const names = CacheDefinitions.getLocNames();
  const homes = new Map();
  for (const [loc, name] of [...names].sort(([a], [b]) => a - b)) {
    const match = /^con_contract_(.+)_hotspot(\d)$/.exec(name);
    if (!match) continue;
    const transforms = CacheDefinitions.getObject(loc)?.transforms ?? [];
    const buildable = transforms[3] > 0;
    const kind = (names.get(buildable ? transforms[4] : transforms[1]) ?? "").replace(/^con_contract_/, "")
      .replace(/_(empty|broken)$/, "").replace(/^(varrock|falador|ardy|hosidius)_[a-z]+_/, "");
    const home = homes.get(match[1]) ?? { key: match[1], city: match[1].split("_")[0], client: CacheDefinitions.getNpcId(MAHOGANY.clients[match[1]]), hotspots: [] };
    homes.set(match[1], home);
    const index = Number(match[2]);
    home.hotspots.push(buildable
      ? { index, loc, kind, buildable, planks: MAHOGANY.planks[kind] ?? 2 }
      : { index, loc, kind, buildable, repair: MAHOGANY.steelRepairs.includes(kind) ? "steel bar" : "plank" });
  }
  for (const home of homes.values()) home.hotspots.sort((a, b) => a.index - b.index);
  return [...homes.values()].filter(home => home.client != null);
})();
const TIERS = [
  { name: "Beginner", level: 1, plank: Items.PLANK, planks: "planks", buildXp: 22.5, repairXp: 127.5, contractXp: 500, points: 2 },
  { name: "Novice", level: 20, plank: Items.OAK_PLANK, planks: "oak planks", buildXp: 48, repairXp: 160, contractXp: 1250, points: 3 },
  { name: "Adept", level: 50, plank: Items.TEAK_PLANK, planks: "teak planks", buildXp: 72, repairXp: 190, contractXp: 2250, points: 4 },
  { name: "Expert", level: 70, plank: Items.MAHOGANY_PLANK, planks: "mahogany planks", buildXp: 112, repairXp: 240, contractXp: 2750, points: 5 },
];
const STEEL_BAR = Items.STEEL_BAR;
const STEEL_REPAIR_XP = 120;
const BROKEN = 1, OLD = 3, EMPTY = 4, BUILT = 5;
const REMOVE = Ids.seq("human_throw_away");
const REMOVE_SOUNDS = [2097, 2098];
const DISCUSSED_VARBIT = Ids.varbit("con_contract_discussed");
const HOTSPOT_VARBITS = Array.from({ length: 8 }, (_, index) => Ids.varbit(`con_contract_hotspot_${index + 1}_display`));
const AMY = ["con_contractor", "con_contractor_1op", "con_contractor_3op"].map(Ids.npc); // and the forms it shows
const CITIES = { varrock: "Varrock", falador: "Falador", ardy: "East Ardougne", hosidius: "Hosidius" };
const PARTS = { north: "north", south: "south", east: "east", west: "west", mid: "middle", southeast: "south-east" };
const OUTFIT = ["construction_hat", "construction_shirt", "construction_trousers", "construction_boots"].map(Ids.obj);
const OUTFIT_BONUS = 1.025;
const CONTRACT_ATTRIBUTE = "construction:contract";
const LAST_TIER_ATTRIBUTE = "construction:contract-last-tier";
const POINTS_ATTRIBUTE = "construction:carpenter-points";
const COMPLETED_ATTRIBUTE = "construction:contracts-completed";
const DISCUSSED_ATTRIBUTE = "construction:contract-discussed";
const COMPLETED_CAP = 30000;
// The reward shop (construction_contract_shop, cache scripts 3146 and 3524-3528): the entries in enum 2645's
// order and the Wiki's prices; each entry draws four children and the heading two, in the order
// 5, 6, 4, 7, (heading), 1, 0, 2, 3, so its clickable child is at these slots.
const SHOP = Ids.iface("construction_contract_shop");
const SHOP_OPTIONS = 3;
const SHOP_CONFIRM = 6;
const POINTS_VARP = Ids.varp("if1");
const REWARDS = [
  ["construction_hat", 400], ["construction_shirt", 800], ["construction_trousers", 600], ["construction_boots", 200],
  ["plank_sack", 350], ["construction_supply_crate", 25], ["wearable_saw", 500], ["hosidius_blueprints", 2000],
].map(([name, cost]) => ({ itemId: Ids.obj(name), cost }));
const SHOP_SLOTS = { 0: 5, 4: 6, 8: 4, 12: 7, 18: 1, 22: 0, 26: 2, 30: 3 };
// The supply crate: one roll of the Wiki's table (Drop Rate Project), noted.
const CRATE = [
  ["cloth", 9, 5], ["cloth", 10, 1], ["limestonebrick", 9, 5], ["limestonebrick", 10, 1], ["plank_mahogany", 6, 15],
  ["plank_mahogany", 7, 3], ["plank_oak", 28, 10], ["plank_oak", 29, 15], ["plank_oak", 30, 5], ["softclay", 45, 5],
  ["softclay", 46, 10], ["softclay", 47, 10], ["softclay", 48, 5], ["steel_bar", 23, 5], ["steel_bar", 24, 20],
  ["steel_bar", 25, 5], ["plank_teak", 15, 20], ["plank_teak", 16, 4],
].map(([name, amount, weight]) => [Ids.obj(name), amount, weight]);

const HOME_BY_KEY = new Map(HOMES.map(home => [home.key, home]));
const HOTSPOT_BY_LOC = new Map(HOMES.flatMap(home => home.hotspots.map(hotspot => [hotspot.loc, { home, hotspot }])));
/** player -> the reward they picked in the shop */
const picked = new WeakMap();

function contractOf(player) {
  return player.getAttribute(CONTRACT_ATTRIBUTE) ?? null;
}

function setContract(player, contract) {
  player.setAttribute(CONTRACT_ATTRIBUTE, contract);
  sendHotspots(player);
}

function sendHotspots(player) {
  const contract = contractOf(player);
  const sender = player.getPacketSender();
  HOTSPOT_VARBITS.forEach((varbit, index) => sender.sendVarbit(varbit, contract?.states?.[index + 1] ?? 0));
  sender.sendVarbit(DISCUSSED_VARBIT, player.getAttribute(DISCUSSED_ATTRIBUTE) ? 1 : 0);
}

function homeName(home) {
  const [city, part] = [home.key.split("_")[0], home.key.split("_").slice(1).join("_")];
  return `${PARTS[part] ?? part} ${CITIES[city]}`;
}

function clientName(home) {
  return CacheDefinitions.getNpc(home.client)?.name ?? "the client";
}

function say(player, npcId, lines, then) {
  const chain = new DialogueChainBuilder();
  lines.forEach((line, index) => chain.add(new NpcDialogue(index, npcId, line)));
  if (then) chain.add(new ActionDialogue(lines.length, { execute: then }));
  player.getDialogueManager().startDialogues(chain);
}

function talkToContractor(event) {
  const player = event.player;
  const npcId = event.npcId;
  if (!player.getAttribute(DISCUSSED_ATTRIBUTE)) {
    if (!AMY.includes(event.npc.getId()) && !AMY.includes(npcId)) {
      return say(player, npcId, ["You'll want to speak to Amy in Falador first. She runs Mahogany Homes."]), true;
    }
    return say(player, npcId, [
      "Welcome to Mahogany Homes! We fix and furnish homes all over the land.",
      "Take a contract, go to the client's home and repair or rebuild what they ask for, then speak to them.",
      "You'll need a hammer, a saw, planks and the odd steel bar. Come back to any of us for your next contract.",
    ], () => {
      player.setAttribute(DISCUSSED_ATTRIBUTE, true);
      sendHotspots(player);
      chooseTier(player, npcId);
    }), true;
  }
  chooseTier(player, npcId);
  return true;
}

function contractOption(event) {
  if (!event.player.getAttribute(DISCUSSED_ATTRIBUTE)) return talkToContractor(event);
  chooseTier(event.player, event.npcId);
  return true;
}

function lastTier(event) {
  const player = event.player;
  if (!player.getAttribute(DISCUSSED_ATTRIBUTE)) return talkToContractor(event);
  const tier = player.getAttribute(LAST_TIER_ATTRIBUTE);
  if (tier == null) return chooseTier(player, event.npcId), true;
  assign(player, event.npcId, tier);
  return true;
}

/**
 * rsprox captures (Contract on con_contractor_varrock, recording 1863, Leagues): every tier is
 * offered, "Select an option", with the levels in the labels and "I'll pass actually." last, as
 * the Wiki transcripts (npc-dialogues.json) have it. A tier above the player's level is refused on the pick.
 */
function chooseTier(player, npcId) {
  const current = contractOf(player);
  if (current) {
    const home = HOME_BY_KEY.get(current.home);
    return say(player, npcId, [`You're already working for ${clientName(home)} in ${homeName(home)}. Finish that first.`]);
  }
  if (House.houseStateFor(player).owned === false) {
    return say(player, npcId, ["You'll need a house of your own before we can give you work."]);
  }
  api.sendMultiChatboxPrompt(player, "Select an option",
    ...TIERS.flatMap((tier, index) => [`${tier.name} Contract${tier.level > 1 ? ` (Requires ${tier.level} Construction)` : ""}`, () => assign(player, npcId, index)]),
    "I'll pass actually.", () => {});
}

function planksName(tier) {
  return tier.planks;
}

/** A random home and the work it needs: each piece is fine, broken, or old and due a rebuild. */
function assign(player, npcId, tierIndex) {
  const tier = TIERS[tierIndex];
  if (player.getSkillManager().getCurrentLevel(Skill.CONSTRUCTION) < tier.level) {
    return say(player, npcId, [`You'll need a Construction level of ${tier.level} for ${tier.name.toLowerCase()} contracts.`]);
  }
  const home = HOMES[Math.floor(Math.random() * HOMES.length)];
  const states = {};
  for (const hotspot of home.hotspots) {
    if (!hotspot.buildable) {
      if (Math.random() < 0.5) states[hotspot.index] = BROKEN;
    } else if (Math.random() < 0.65) {
      states[hotspot.index] = Math.random() < 0.3 ? BROKEN : OLD;
    }
  }
  if (!Object.keys(states).length) {
    const hotspot = home.hotspots[Math.floor(Math.random() * home.hotspots.length)];
    states[hotspot.index] = hotspot.buildable ? OLD : BROKEN;
  }
  player.setAttribute(LAST_TIER_ATTRIBUTE, tierIndex);
  setContract(player, { home: home.key, tier: tierIndex, states });
  say(player, npcId, [`${clientName(home)} in ${homeName(home)} needs some work done. Take ${planksName(tier)} and a few steel bars, just in case.`]);
}

/** The house contract hotspots: Repair (op3), Remove (op2), Build (op4). */
function hotspotOption(event) {
  const found = HOTSPOT_BY_LOC.get(event.objectId);
  if (!found) return false;
  const { home, hotspot } = found;
  const player = event.player;
  const contract = contractOf(player);
  const state = contract?.home === home.key ? contract.states[hotspot.index] ?? 0 : 0;
  if (!contract || contract.home !== home.key || ![BROKEN, OLD, EMPTY].includes(state)) {
    player.sendMessage("I'd better leave this alone right now.");
    return true;
  }
  const tier = TIERS[contract.tier];
  if (!hasTools(player)) return player.sendMessage("You need a hammer and a saw to do that."), true;
  if (state === OLD) {
    // rsprox captures (recording 1863): human_throw_away with synth 2097 or 2098, 20 client ticks late.
    player.performAnimation(new Animation(REMOVE));
    player.getPacketSender().sendSound(REMOVE_SOUNDS[Math.floor(Math.random() * REMOVE_SOUNDS.length)], 0, 20);
    return finishJob(player, contract, hotspot, EMPTY, 0), true;
  }
  if (state === BROKEN) {
    const material = hotspot.repair === "steel bar" ? STEEL_BAR : tier.plank;
    if (!take(player, material, 1)) return player.sendMessage(`You need ${material === STEEL_BAR ? "a steel bar" : `a ${planksName(tier).replace(/s$/, "")}`} to repair that.`), true;
    House.hammer(player);
    return finishJob(player, contract, hotspot, 0, material === STEEL_BAR ? STEEL_REPAIR_XP : tier.repairXp), true;
  }
  if (player.getSkillManager().getCurrentLevel(Skill.CONSTRUCTION) < tier.level) {
    return player.sendMessage(`You need a Construction level of ${tier.level} to build that.`), true;
  }
  if (!take(player, tier.plank, hotspot.planks)) return player.sendMessage(`You need ${hotspot.planks} ${planksName(tier)} to build that.`), true;
  House.hammer(player);
  finishJob(player, contract, hotspot, BUILT + contract.tier, hotspot.planks * tier.buildXp);
  return true;
}

function hasTools(player) {
  const inventory = player.getInventory();
  const offhand = player.getEquipment().getItems()[Equipment.SHIELD_SLOT]?.getId?.();
  return inventory.contains(Items.HAMMER) && [Items.SAW, Items.CRYSTAL_SAW, Items.AMYS_SAW].some(id => inventory.contains(id) || offhand === id);
}

/** Planks come from the inventory, then the plank sack (as building at home does). */
function take(player, itemId, amount) {
  if (player.getInventory().getAmount(itemId) + House.storedAmount(player, itemId) < amount) return false;
  House.useMaterial(player, itemId, amount);
  return true;
}

function outfitBonus(player) {
  const worn = new Set(player.getEquipment().getItems().map(item => item?.getId?.()));
  return OUTFIT.every(id => worn.has(id)) ? OUTFIT_BONUS : 1;
}

function finishJob(player, contract, hotspot, state, experience) {
  contract.states[hotspot.index] = state;
  if (state === 0) delete contract.states[hotspot.index];
  setContract(player, contract);
  if (experience) player.getSkillManager().addExperiences(Skill.CONSTRUCTION, experience * outfitBonus(player));
  if (remaining(contract)) return;
  // rsprox captures (recording 1863 and the message index): the client, in green.
  const client = clientName(HOME_BY_KEY.get(contract.home));
  player.sendMessage(`<col=229628>${client} seems happy with your work. Talk to ${MAHOGANY.pronouns[client] ?? "them"} for your reward.</col>`);
}

function remaining(contract) {
  return Object.values(contract.states).filter(state => state === BROKEN || state === OLD || state === EMPTY).length;
}

function talkToClient(event) {
  const player = event.player;
  const npcId = event.npcId;
  const home = HOMES.find(entry => entry.client === npcId || entry.client === event.npc.getId());
  if (!home) return false;
  const contract = contractOf(player);
  if (contract?.home !== home.key) return say(player, npcId, ["Hello there. Mahogany Homes looks after my house, you know."]), true;
  const left = remaining(contract);
  if (left) return say(player, npcId, [`There's still ${left === 1 ? "one thing" : `${left} things`} left to sort out.`]), true;
  const tier = TIERS[contract.tier];
  const award = { player, minigame: "mahogany-homes", points: tier.points };
  api.emitCustomEvent("minigame:points", award);
  const points = (player.getAttribute(POINTS_ATTRIBUTE) ?? 0) + award.points;
  player.setAttribute(POINTS_ATTRIBUTE, points);
  player.setAttribute(COMPLETED_ATTRIBUTE, Math.min(COMPLETED_CAP, (player.getAttribute(COMPLETED_ATTRIBUTE) ?? 0) + 1));
  setContract(player, null);
  player.getSkillManager().addExperiences(Skill.CONSTRUCTION, tier.contractXp * outfitBonus(player));
  player.setRunEnergy(100);
  say(player, npcId, ["Wonderful, it all looks lovely! Here, have a cup of tea before you go."], () => {
    player.sendMessage(`You have completed a ${tier.name.toLowerCase()} contract and earned ${tier.points} Carpenter points. You now have ${points.toLocaleString("en-US")}.`);
  });
  return true;
}

function rewards(event) {
  const player = event.player;
  player.getPacketSender().sendConfig(POINTS_VARP, player.getAttribute(POINTS_ATTRIBUTE) ?? 0);
  player.getPacketSender().sendInterface(SHOP);
  player.getPacketSender().sendInterfaceFlagsRange((SHOP << 16) | SHOP_OPTIONS, 0, 31, 1 << 1);
  picked.delete(player);
  return true;
}

function shopClick(event) {
  if (event.groupId !== SHOP) return;
  event.handled = true;
  const player = event.player;
  if (event.childId === SHOP_OPTIONS && SHOP_SLOTS[event.slot] !== undefined) return picked.set(player, SHOP_SLOTS[event.slot]);
  if (event.childId !== SHOP_CONFIRM) return;
  const reward = REWARDS[picked.get(player)];
  if (!reward) return player.sendMessage("Choose a reward first.");
  const points = player.getAttribute(POINTS_ATTRIBUTE) ?? 0;
  if (points < reward.cost) return player.sendMessage(`You need ${reward.cost} Carpenter points to claim that reward.`);
  if (player.getInventory().getFreeSlots() === 0) return player.sendMessage("You don't have enough inventory space.");
  player.setAttribute(POINTS_ATTRIBUTE, points - reward.cost);
  const inventory = player.getInventory();
  const before = inventory.getAmount(reward.itemId);
  inventory.adds(reward.itemId, 1);
  const credited = Math.max(0, inventory.getAmount(reward.itemId) - before);
  if (credited > 0) api.emitCustomEvent("collection-log:obtain", { player, itemId: reward.itemId, amount: credited });
  player.getPacketSender().sendConfig(POINTS_VARP, points - reward.cost);
}

function openCrate(event) {
  const player = event.player;
  const total = CRATE.reduce((sum, [, , weight]) => sum + weight, 0);
  let roll = Math.random() * total;
  const [itemId, amount] = CRATE.find(([, , weight]) => (roll -= weight) < 0) ?? CRATE[0];
  const noted = ItemDefinition.forId(itemId)?.getNoteId?.() ?? -1;
  player.getInventory().delete(event.itemId, 1);
  player.getInventory().adds(noted > 0 ? noted : itemId, amount);
  return true;
}

function attachMahoganyHomes(api) {
  api.persistAttribute(CONTRACT_ATTRIBUTE, null);
  api.persistAttribute(LAST_TIER_ATTRIBUTE, null);
  api.persistAttribute(POINTS_ATTRIBUTE, 0);
  api.persistAttribute(COMPLETED_ATTRIBUTE, 0);
  api.persistAttribute(DISCUSSED_ATTRIBUTE, false);
  api.onNpcsInteraction(["Amy", "Marlo", "Ellie", "Angelo"], {
    "Talk-to": talkToContractor, Contract: contractOption, "Last-tier contract": lastTier, Rewards: rewards,
  });
  api.onNpcsInteraction([...new Set(HOMES.map(clientName))], { "Talk-to": talkToClient });
  api.onObjectInteraction((event) => { if (hotspotOption(event)) event.handled = true; });
  api.onInterfaceActionClick(shopClick);
  api.onItemAction("Supply crate", { Open: openCrate });
  api.onPlayerLogin(({ player }) => sendHotspots(player));
}

Object.assign(module.exports, { attachMahoganyHomes });
