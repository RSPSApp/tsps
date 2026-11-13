"use strict";

const {
  api, Animation, CacheDefinitions, DialogueChainBuilder, NpcDialogue, PlayerDialogue, ActionDialogue, ItemDefinition, Skill,
  ItemIdentifiers: Items, ChatType, resolveChatHighlights,
} = require("./Core.Construction");
const Ids = require("./Ids.Construction");
const House = require("./House.Construction");
const CarpenterOutfit = require("./CarpenterOutfit.Construction");

// Mahogany Homes (Wiki; rsprox captures: the user's rev 241/242 contract runs, see docs/construction.md,
// for Amy's introduction, the tier menu, assignments, reminders, hotspot displays and their areas, the
// last-job line, the completion message and the cup of tea, and the reward shop's prices; one Leagues
// capture, recording 1863, for Jeff's worklist and "I'd better leave this alone right now."): Amy in Falador, then also Marlo (Varrock),
// Ellie (East Ardougne) and Angelo (Hosidius) give contracts at four tiers (Beginner, Novice,
// Adept, Expert: levels 1/20/50/70, planks, oak, teak, mahogany) for a random client's home in
// any of the four cities (HOMES below, from the cache). A home's hotspot shows 1 broken (Repair: a
// plank of the tier, or a steel bar for a sink, range or bath; repaired it shows 2), 3 old furniture
// (Remove), 4 an empty space (Build: the Wiki's planks per piece) and 5-8 the new piece in plain, oak,
// teak or mahogany wood; 0 is the home as it stands. The eight display varbits are shared by every
// home, so they carry the contract's states only while the player is in its home's area.
// Speaking to the client when the work is done gives the tier's experience and Carpenter points
// and a cup of tea (run energy to 100%). The captured experience per plank, per repair and per
// contract is used, with the Carpenter's outfit's bonus. Layouts.Construction holds the
// Wiki's tier-specific per-client work orders. Amy's Rewards opens the reward shop (673).
// The homes, from the cache: each con_contract_<home>_hotspot<n> multiloc, the display varbit it
// reads (con_contract_hotspot_<n>_display), and its piece of furniture, named by its empty-space
// form (or its broken form for the pieces that are only ever repaired). ./data has the clients
// and the Wiki's planks per piece.
const MAHOGANY = require("./data/mahogany-homes.json");
const LAYOUTS = require("./data/Layouts.Construction");
const WORKLIST = require("./data/Worklist.Construction");
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
  for (const home of homes.values()) {
    home.hotspots.sort((a, b) => a.index - b.index);
    const [minX, minY, maxX, maxY] = MAHOGANY.areas[home.key] ?? [];
    if (minX != null) home.area = { minX, minY, maxX, maxY };
  }
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
const BROKEN = 1, REPAIRED = 2, OLD = 3, EMPTY = 4, BUILT = 5;
const REMOVE = Ids.seq("human_throw_away");
const REMOVE_SOUNDS = [2097, 2098];
// rsprox captures: the tea is drunk with human_eat and synth liquid (2401), and an overhead line.
const DRINK = Ids.seq("human_eat");
const TEA_SOUND = 2401;
// Chathead animations the captures play on each line (chatquiz1, chathap1-3).
const QUIZ = 554, HAPPY1 = 567, HAPPY2 = 568, HAPPY3 = 569;
const DISCUSSED_VARBIT = Ids.varbit("con_contract_discussed");
const CHATBOX_TRANSPARENCY = Ids.varbit("chatbox_transparency");
const HOTSPOT_VARBITS = Array.from({ length: 8 }, (_, index) => Ids.varbit(`con_contract_hotspot_${index + 1}_display`));
const AMY = ["con_contractor", "con_contractor_1op", "con_contractor_3op"].map(Ids.npc); // and the forms it shows
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
// Picking an entry is client-side (script 3530 redraws with it selected); the Confirm button is
// created in child 6 at the selected entry's index, so its click carries the reward's index. Live
// enables child 6's slots 0-7 and sends the prices as inv 247's counts (script 3528 reads them).
const SHOP_CONFIRM = 6;
const POINTS_VARP = Ids.varp("if1");
const PRICES_INV = 247;
const PRICE_OBJ = Ids.obj("burntfish1"); // the captured placeholder object; only its count is read
const REWARDS = [
  ["construction_hat", 400], ["construction_shirt", 800], ["construction_trousers", 600], ["construction_boots", 200],
  ["plank_sack", 350], ["construction_supply_crate", 25], ["wearable_saw", 500], ["hosidius_blueprints", 2000],
].map(([name, cost]) => ({ itemId: Ids.obj(name), cost }));
// The supply crate: one roll of the Wiki's table (Drop Rate Project), noted.
const CRATE = [
  ["cloth", 9, 5], ["cloth", 10, 1], ["limestonebrick", 9, 5], ["limestonebrick", 10, 1], ["plank_mahogany", 6, 15],
  ["plank_mahogany", 7, 3], ["plank_oak", 28, 10], ["plank_oak", 29, 15], ["plank_oak", 30, 5], ["softclay", 45, 5],
  ["softclay", 46, 10], ["softclay", 47, 10], ["softclay", 48, 5], ["steel_bar", 23, 5], ["steel_bar", 24, 20],
  ["steel_bar", 25, 5], ["plank_teak", 15, 20], ["plank_teak", 16, 4],
].map(([name, amount, weight]) => [Ids.obj(name), amount, weight]);

const HOME_BY_KEY = new Map(HOMES.map(home => [home.key, home]));
const HOTSPOT_BY_LOC = new Map(HOMES.flatMap(home => home.hotspots.map(hotspot => [hotspot.loc, { home, hotspot }])));
/** player -> the keys of the homes whose area holds them */
const insideHomes = new WeakMap();
/** player -> the contract just rewarded: live keeps showing its finished home until they leave it */
const finished = new WeakMap();

function contractOf(player) {
  return player.getAttribute(CONTRACT_ATTRIBUTE) ?? null;
}

function setContract(player, contract) {
  player.setAttribute(CONTRACT_ATTRIBUTE, contract);
  sendHotspots(player);
}

/** The states the shared display varbits carry: the contract's (or the one just finished), in its home only. */
function shownStates(player) {
  const contract = contractOf(player) ?? finished.get(player);
  return contract && insideHomes.get(player)?.has(contract.home) ? contract.states : null;
}

function sendHotspots(player) {
  const states = shownStates(player);
  const sender = player.getPacketSender();
  HOTSPOT_VARBITS.forEach((varbit, index) => sender.sendVarbit(varbit, states?.[index + 1] ?? 0));
  sender.sendVarbit(DISCUSSED_VARBIT, player.getAttribute(DISCUSSED_ATTRIBUTE) ? 1 : 0);
}

function homeOfZone(zone) {
  return HOMES.find(home => home.area === zone);
}

function enterHome({ player, zone }) {
  const home = homeOfZone(zone);
  if (!home) return;
  const inside = insideHomes.get(player) ?? new Set();
  inside.add(home.key);
  insideHomes.set(player, inside);
  sendHotspots(player);
}

function leaveHome({ player, zone }) {
  const home = homeOfZone(zone);
  if (!home) return;
  insideHomes.get(player)?.delete(home.key);
  if (finished.get(player)?.home === home.key) finished.delete(player);
  sendHotspots(player);
}

function clientName(home) {
  return CacheDefinitions.getNpc(home.client)?.name ?? "the client";
}

function say(player, npcId, lines, then) {
  chat(player, npcId, [...lines.map(text => ({ npc: text })), ...(then ? [{ open: then }] : [])]);
}

/**
 * Plays a conversation: `{ npc }` and `{ player }` lines (with an optional chathead `anim`), and
 * `{ run }` steps that act when the line before is continued, then move on; an `{ open }` step
 * acts last and leaves the chatbox to whatever it opens.
 */
function chat(player, npcId, steps) {
  const chain = new DialogueChainBuilder();
  const dialogue = player.getDialogueManager();
  for (let index = 0; index < steps.length; index++) {
    const step = steps[index];
    if (step.run) {
      chain.add(new ActionDialogue(index, { execute: () => { step.run(); dialogue.advance(); } }));
    } else if (step.open) {
      chain.add(new ActionDialogue(index, { execute: step.open }));
    } else if (step.player != null) {
      chain.add(new PlayerDialogue(index, step.player, step.anim ?? HAPPY1));
    } else {
      chain.add(new NpcDialogue(index, npcId, step.npc, undefined, step.anim ?? HAPPY3));
    }
  }
  dialogue.startDialogues(chain);
}

/** rsprox captures (Amy's Talk-to on a new account): her introduction, then the contract menu. */
function introduction(player, npcId) {
  chat(player, npcId, [
    { npc: "Hey I'm Amy, how may I help you?", anim: HAPPY1 },
    { player: "What do you do here?", anim: QUIZ },
    { npc: "I'm the founder of Mahogany Homes, Gielinor's first Construction company!", anim: HAPPY2 },
    { npc: "We've currently got branches in Falador, Varrock, Hosidius and Ardougne.", anim: HAPPY2 },
    { player: "So people contact you for help with their homes?", anim: QUIZ },
    { npc: "Yep! They'll get in contact if they want assistance, whether it's fixing parts of their house or requesting nicer furniture, and then we will go and help them out." },
    { player: "That sounds quite enjoyable and satisfying to do, are you hiring at all?", anim: HAPPY2 },
    { npc: "If you have the supplies, I can tell you where one of our clients is that needs some work doing.", anim: HAPPY2 },
    { npc: "I'll keep track of the work you do as well and give you some points for our company reward shop.", anim: HAPPY2 },
    { npc: "Also there are assistants in Varrock, Ardougne, and Hosidius that can give you work, if Falador is inconvienent for you." },
    { npc: "The clients that I would offer you to go help could be in any of those cities, it might be a bit of a journey to get there!" },
    { open: () => {
      player.setAttribute(DISCUSSED_ATTRIBUTE, true);
      sendHotspots(player);
      api.sendMultiChatboxPrompt(player, "Select an option",
        "I'd like a construction contract.", () => askForContract(player, npcId),
        // Ours: not captured; closes the chatbox.
        "Thanks for the information.", () => {});
    } },
  ]);
}

function askForContract(player, npcId) {
  chat(player, npcId, [
    { player: "I'd like a construction contract." },
    { npc: "What kind of contract would you like?", anim: QUIZ },
    { open: () => chooseTier(player, npcId) },
  ]);
}

function talkToContractor(event) {
  const player = event.player;
  const npcId = event.npcId;
  if (!player.getAttribute(DISCUSSED_ATTRIBUTE)) {
    if (!AMY.includes(event.npc.getId()) && !AMY.includes(npcId)) {
      // Ours: not captured. Marlo's own first Talk-to is Daddy's Home's welcome (DaddysHome.Quest.js);
      // its "Tell me about working for Mahogany Homes." answer is not captured either.
      return say(player, npcId, ["You'll want to speak to Amy in Falador first. She runs Mahogany Homes."]), true;
    }
    return introduction(player, npcId), true;
  }
  // Ours: a later Talk-to is not captured; it offers the contracts.
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
  if (contractOf(player)) return remind(player, event.npcId), true;
  const tier = player.getAttribute(LAST_TIER_ATTRIBUTE);
  if (tier == null) return chooseTier(player, event.npcId), true;
  assign(player, event.npcId, tier);
  return true;
}

function article(word) {
  return /^[aeiou]/i.test(word) ? "an" : "a";
}

function clientWord(home) {
  return MAHOGANY.pronouns[clientName(home)] === "him" ? "his" : "her";
}

/**
 * rsprox captures (Last-tier contract with work unfinished): the player asks and the contractor
 * repeats the job. Contract with work unfinished is not captured and does the same (ours).
 */
function remind(player, npcId) {
  const contract = contractOf(player);
  const home = HOME_BY_KEY.get(contract.home);
  const tier = TIERS[contract.tier];
  chat(player, npcId, [
    { player: "What's my current construction contract?", anim: QUIZ },
    { npc: `You're currently on ${article(tier.name)} <col=ff0000>${tier.name} Contract</col>. Go see ${MAHOGANY.descriptions[clientName(home)]}. You can get another job once you have furnished ${clientWord(home)} home.` },
  ]);
}

/**
 * rsprox captures (Contract, and Amy's "What kind of contract would you like?"): every tier is
 * offered, "Select an option", struck through (<str>) above the player's level, "I'll pass actually." last.
 * A struck-through tier is refused on the pick (ours: not captured).
 */
function chooseTier(player, npcId) {
  if (contractOf(player)) return remind(player, npcId);
  if (House.houseStateFor(player).owned === false) {
    // Ours: not captured.
    return say(player, npcId, ["You'll need a house of your own before we can give you work."]);
  }
  const level = player.getSkillManager().getCurrentLevel(Skill.CONSTRUCTION);
  api.sendMultiChatboxPrompt(player, "Select an option",
    ...TIERS.flatMap((tier, index) => [
      `${level < tier.level ? "<str>" : ""}${tier.name} Contract${tier.level > 1 ? ` (Requires ${tier.level} Construction)` : ""}`,
      () => pickTier(player, npcId, index),
    ]),
    "I'll pass actually.", () => {});
}

function pickTier(player, npcId, tierIndex) {
  const tier = TIERS[tierIndex];
  chat(player, npcId, [
    { player: `Could I have ${article(tier.name)} ${tier.name.toLowerCase()} contract please?` },
    { open: () => assign(player, npcId, tierIndex) },
  ]);
}

function planksName(tier) {
  return tier.planks;
}

/** Choose a home and one of its tier-specific work orders; never replace a saved contract. */
function assign(player, npcId, tierIndex) {
  if (contractOf(player) || House.houseStateFor(player).owned === false) return chooseTier(player, npcId);
  const tier = TIERS[tierIndex];
  if (player.getSkillManager().getCurrentLevel(Skill.CONSTRUCTION) < tier.level) {
    // Ours: not captured.
    return say(player, npcId, [`You'll need a Construction level of ${tier.level} for ${tier.name.toLowerCase()} contracts.`]);
  }
  const home = HOMES[Math.floor(Math.random() * HOMES.length)];
  const layouts = LAYOUTS[clientName(home)][tierIndex];
  const layout = layouts[Math.floor(Math.random() * layouts.length)];
  const states = {};
  home.hotspots.forEach(hotspot => {
    const state = Number(layout[hotspot.index - 1]);
    if (state) states[hotspot.index] = state;
  });
  player.setAttribute(LAST_TIER_ATTRIBUTE, tierIndex);
  finished.delete(player);
  setContract(player, { home: home.key, tier: tierIndex, states });
  // rsprox captures: the job as a game message, then the contractor's line, in the same tick.
  const where = MAHOGANY.descriptions[clientName(home)];
  player.sendMessage(`<col=ff0000>${tier.name} Contract</col>: Go see ${where}.`);
  chat(player, npcId, [
    { npc: `Please could you go see ${where} for us? You can get another job once you have furnished ${clientWord(home)} home.` },
  ]);
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
    return finishJob(player, contract, hotspot, REPAIRED, material === STEEL_BAR ? STEEL_REPAIR_XP : tier.repairXp), true;
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
  // Wiki (Imcando hammer): it "can be used as a hammer, both while equipped and unequipped, in any way that a normal
  // hammer can be used"; Mahogany Homes: "Amy's saw or the Imcando hammer can be worn in the off-hand". House.hasHammer
  // and House.hasSaw take the tools carried or wielded, as building at home does.
  return House.hasHammer(player) && House.hasSaw(player);
}

/**
 * Planks come from the inventory, then the plank sack, and content may keep some
 * ("construction:materials", a league fragment's planks saved "whilst training Construction"), as building at home does.
 */
function take(player, itemId, amount) {
  if (player.getInventory().getAmount(itemId) + House.storedAmount(player, itemId) < amount) return false;
  House.useMaterials(player, null, new Map([[itemId, amount]]));
  return true;
}

function finishJob(player, contract, hotspot, state, experience) {
  contract.states[hotspot.index] = state;
  setContract(player, contract);
  if (experience) player.getSkillManager().addExperiences(Skill.CONSTRUCTION, CarpenterOutfit.withBonus(player, experience));
  if (remaining(contract)) return;
  // rsprox captures: live's green highlight, which follows the chatbox's transparency.
  const client = clientName(HOME_BY_KEY.get(contract.home));
  const transparent = player.getPacketSender().getVarbit(CHATBOX_TRANSPARENCY) === 1;
  player.sendMessage(resolveChatHighlights(`@mes_hl_gre@${client} seems happy with your work. Talk to ${MAHOGANY.pronouns[client] ?? "them"} for your reward.</col>`, transparent));
}

function remaining(contract) {
  return Object.values(contract.states).filter(state => state === BROKEN || state === OLD || state === EMPTY).length;
}

/** The client lists only unfinished work, in hotspot order, also after removing furniture. */
function describeWork(player, npcId, home, contract) {
  const chain = new DialogueChainBuilder()
    .add(new PlayerDialogue(0, "Hey, I'm your contractor from Mahogany Homes, what did you want done?"));
  const work = new Map();
  for (const hotspot of home.hotspots) {
    const state = contract.states[hotspot.index];
    if (![BROKEN, OLD, EMPTY].includes(state)) continue;
    const key = `${state === BROKEN ? "repair" : "build"}:${hotspot.kind}`;
    const entry = work.get(key) ?? { hotspot, state, count: 0 };
    entry.count++;
    work.set(key, entry);
  }
  let index = 1;
  for (const { hotspot, state, count } of work.values()) {
    let line;
    if (state === BROKEN) {
      // Individually rolled legacy contracts can contain broken buildable pieces.
      const transforms = CacheDefinitions.getObject(hotspot.loc).transforms;
      const name = WORKLIST.repairs[hotspot.kind]
        ?? CacheDefinitions.getObject(transforms[BROKEN]).name.replace(/^broken /i, "").toLowerCase();
      line = `I'd like my ${name} fixed.`;
    } else {
      const names = WORKLIST.furniture[hotspot.kind];
      const quantity = count === 1 ? "a" : count === 2 ? "two" : String(count);
      const wood = WORKLIST.woods[contract.tier];
      // rsprox captures: "I'd like an Oak table built."
      line = `I'd like ${count === 1 ? article(wood) : quantity} ${wood} ${names[count === 1 ? 0 : 1]} built.`;
    }
    chain.add(new NpcDialogue(index++, npcId, line));
  }
  player.getDialogueManager().startDialogues(chain);
}

function talkToClient(event) {
  const player = event.player;
  const npcId = event.npcId;
  const home = HOMES.find(entry => entry.client === npcId || entry.client === event.npc.getId());
  if (!home) return false;
  const contract = contractOf(player);
  // Ours: not captured.
  if (contract?.home !== home.key) return say(player, npcId, ["Hello there. Mahogany Homes looks after my house, you know."]), true;
  const left = remaining(contract);
  if (left) return describeWork(player, npcId, home, contract), true;
  // rsprox captures: the reward lands as the player's line is continued, the tea as theirs is.
  chat(player, npcId, [
    { player: "I've finished with the work you wanted." },
    { run: () => reward(player, contract) },
    { npc: "Thank you so much! Would you like a cup of tea before you go?", anim: HAPPY2 },
    { player: "Yes, I'd love a cuppa." },
    { run: () => drinkTea(player) },
  ]);
  return true;
}

function reward(player, contract) {
  if (contractOf(player) !== contract) return;
  const tier = TIERS[contract.tier];
  const award = { player, minigame: "mahogany-homes", points: tier.points };
  api.emitCustomEvent("minigame:points", award);
  const points = (player.getAttribute(POINTS_ATTRIBUTE) ?? 0) + award.points;
  const completed = Math.min(COMPLETED_CAP, (player.getAttribute(COMPLETED_ATTRIBUTE) ?? 0) + 1);
  player.setAttribute(POINTS_ATTRIBUTE, points);
  player.setAttribute(COMPLETED_ATTRIBUTE, completed);
  finished.set(player, contract);
  setContract(player, null);
  // rsprox captures: the running totals, with the points the player now holds (ours: points
  // spent in the shop are not captured between two completions).
  player.sendMessage(`You have completed <col=ef1020>${completed.toLocaleString("en-US")}</col> contract${completed === 1 ? "" : "s"} with a total of <col=ef1020>${points.toLocaleString("en-US")}</col> points.`);
  player.getSkillManager().addExperiences(Skill.CONSTRUCTION, CarpenterOutfit.withBonus(player, tier.contractXp));
}

function drinkTea(player) {
  player.getPacketSender().sendTypedMessage(ChatType.SPAM, "You drink the tea, you feel energized!");
  player.performAnimation(new Animation(DRINK));
  player.forceChat("Aaah, nothing like a nice cuppa tea!");
  player.getPacketSender().sendSound(TEA_SOUND, 0, 0);
  player.setRunEnergy(100);
}

function rewards(event) {
  const player = event.player;
  const sender = player.getPacketSender();
  sender.sendConfig(POINTS_VARP, player.getAttribute(POINTS_ATTRIBUTE) ?? 0);
  sender.sendInventory(PRICES_INV, REWARDS.length, REWARDS.map(({ cost }) => ({ id: PRICE_OBJ, amount: cost })), SHOP);
  sender.sendInterface(SHOP);
  sender.sendInterfaceFlagsRange((SHOP << 16) | SHOP_CONFIRM, 0, REWARDS.length - 1, 1 << 1);
  return true;
}

function shopClick(event) {
  if (event.groupId !== SHOP) return;
  event.handled = true;
  const player = event.player;
  // Only while Amy's shop is open: a click on it closed bought rewards anywhere.
  if (player.getInterfaceId?.() !== SHOP) return;
  if (event.childId !== SHOP_CONFIRM) return;
  const reward = REWARDS[event.slot];
  if (!reward) return;
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
  for (const home of HOMES) api.onZoneEnter(home.area, enterHome);
  for (const home of HOMES) api.onZoneExit(home.area, leaveHome);
}

Object.assign(module.exports, { attachMahoganyHomes, finishJob, HOMES });
