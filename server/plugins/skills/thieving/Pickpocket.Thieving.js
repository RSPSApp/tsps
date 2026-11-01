/**
 * Pickpocketing, driven by plugins/skills/data/pickpocketing.json (OSRS Wiki: Thieving#Pickpocketing,
 * each target's page, Coin pouch, Rogue equipment, Gloves of silence, Dodgy necklace, Thieving cape).
 *
 * The click sends the attempt message and starts the two-tick cooldown. On the next tick a success
 * plays the animation with its loot; a failure sends its message, and the 9-tick stun (8 without
 * pickpocketing) lands a tick later, the stun message and damage a tick after that.
 * Not modelled: the Wealthy citizen's urchin distraction, the H.A.M. camp's concussion and
 * ejection on a failure, and the Ardougne diary's +10% success and 56/84/140 coin pouches (its
 * medium tier is scoped to Ardougne, and nothing here defines that region yet).
 *
 * rsprox captures (recordings 335, 338, 339, 691, 2601, 3059, 3228 and Leagues/Grid Master 95,
 * 1723, 3275): every line is a spam message except a target's own `channel` (the Digsite
 * workman's are game messages); the success line is followed by the loot's own lines: the
 * Master Farmer counts his seeds (`lootLines: "count"`), an entry's `steal` names its item,
 * and a clue scroll is always announced.
 */
const fs = require("fs");
const path = require("path");

const THIEVING_ANIMATION = 881;
const PICKPOCKET_COOLDOWN_MS = 1200;
const PICKPOCKET_STUN_TICKS = 9;
const PICKPOCKET_STUN_LOCK_TICKS = 8;
const DEFAULT_CATCH_LINE = "What do you think you're doing?";
const CLUE_LINE = "You steal a clue scroll.";
// Capture (a hero, 2026-10-05): the stun graphic is stunned_thieving at height 124.
const STUN_GRAPHIC_ID = 245;

// Wiki (Coin pouch): 28 of a kind, then they must be opened.
const MAX_COIN_POUCHES = 28;
// Wiki (Gloves of silence): +5% success; a pair breaks after 62 failed pickpockets.
const GLOVES_OF_SILENCE_BONUS = 105;
const GLOVES_OF_SILENCE_FAILURES = 62;
const GLOVES_OF_SILENCE_ATTRIBUTE = "thieving.gloves-of-silence-failures";
// Wiki (Thieving cape): +10% success, multiplied with the gloves; the max cape carries the perk.
const THIEVING_CAPE_BONUS = 110;
// Wiki (Dodgy necklace): 25% to avoid the stun and damage; 10 charges, kept on the player.
const DODGY_NECKLACE_CHANCE = 0.25;
const DODGY_NECKLACE_CHARGES = 10;
const DODGY_NECKLACE_ATTRIBUTE = "thieving.dodgy-necklace-charges";
// Wiki (Shadow Veil): 15% to avoid the stun, rolled before the necklace.
const SHADOW_VEIL_CHANCE = 0.15;
// Wiki (Rogue equipment): 15% double loot per piece; all five always double.
const ROGUE_PIECES = ["rogue mask", "rogue top", "rogue trousers", "rogue gloves", "rogue boots"];
const ROGUE_SLOTS = ["HEAD_SLOT", "BODY_SLOT", "LEG_SLOT", "HANDS_SLOT", "FEET_SLOT"];
const ROGUE_CHANCE_PER_PIECE = 0.15;
const FIRE_CAPES = new Set(["fire cape", "fire max cape", "infernal cape", "infernal max cape"]);
function clueItems() { return {
  easy: [core.ItemIdentifiers.CLUE_SCROLL_EASY_, core.ItemIdentifiers.SCROLL_BOX_EASY_],
  medium: [core.ItemIdentifiers.CLUE_SCROLL_MEDIUM_, core.ItemIdentifiers.SCROLL_BOX_MEDIUM_],
  hard: [core.ItemIdentifiers.CLUE_SCROLL_HARD_, core.ItemIdentifiers.SCROLL_BOX_HARD_],
  elite: [core.ItemIdentifiers.CLUE_SCROLL_ELITE_, core.ItemIdentifiers.SCROLL_BOX_ELITE_],
}; }

const DATA = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "pickpocketing.json"), "utf8"));
const TARGETS = DATA.targets;
/** NPC name -> the targets that list it; a target with `ids` only claims those NPC ids. */
const TARGETS_BY_NAME = new Map();
for (const target of TARGETS) {
  for (const name of target.npcs) {
    if (!TARGETS_BY_NAME.has(name)) TARGETS_BY_NAME.set(name, []);
    TARGETS_BY_NAME.get(name).push(target);
  }
}
/** Coin pouch item id -> its coins (a number or [min, max]). */
const POUCH_COINS = new Map(TARGETS.filter((t) => t.coinPouch).map((t) => [t.coinPouch.id, t.coinPouch.coins]));

/**
 * When each player was last caught: no new attempt until the stun lands a tick later. A
 * timestamp rather than a flag, so a lost stun can never lock pickpocketing for good.
 */
const caughtAt = new WeakMap();
const CAUGHT_HOLD_TICKS = 3;

let core;
let pluginApi;

/** "5/128", "1/5.65", "Always" or "0" as a probability. */
function rateOf(rate) {
  if (rate === "Always") return 1;
  const [numerator, denominator] = String(rate).split("/").map(Number);
  return denominator ? numerator / denominator : Number(numerator) || 0;
}

function roll(amount, random = Math.random) {
  return Array.isArray(amount) ? amount[0] + Math.floor(random() * (amount[1] - amount[0] + 1)) : amount;
}

function wornName(player, slot) {
  const id = player.getEquipment().get(slot)?.getId?.() ?? -1;
  return id > 0 ? String(core.ItemDefinition.forId(id)?.getName?.() ?? "").toLowerCase() : "";
}

function questComplete(player, key) {
  const request = { player, key, complete: null };
  pluginApi.emitCustomEvent("quest:is-complete", request);
  return typeof request.complete === "boolean" ? request.complete : Number(player.getAttribute(`quest.${key}.stage`)) >= 2;
}

function wearsThievingCape(player) {
  const request = { player, skill: "THIEVING", result: false };
  pluginApi?.emitCustomEvent("skillcape:has-perk", request);
  return request.result === true;
}

function hasFireCape(player) {
  if (FIRE_CAPES.has(wornName(player, core.Equipment.CAPE_SLOT))) return true;
  return player.getInventory().getItems().some((item) =>
    item?.getId?.() > 0 && FIRE_CAPES.has(String(core.ItemDefinition.forId(item.getId())?.getName?.() ?? "").toLowerCase()));
}

/** The target an NPC belongs to: one listing its id first, then one by name without an id list. */
function targetFor(name, npcId) {
  const targets = TARGETS_BY_NAME.get(name) ?? [];
  return targets.find((t) => t.ids?.includes(npcId)) ?? targets.find((t) => !t.ids) ?? null;
}

/**
 * How the messages name the NPC: "the man", "the Master Farmer", or a named NPC's own name.
 * `messageNames` names single NPCs, by id or by name ("Martin", "the woman").
 */
function messageName(target, npcName, npcId) {
  const named = target.messageNames?.[npcId] ?? target.messageNames?.[npcName];
  if (named) return named;
  if (target.properNames) return npcName;
  return `the ${target.messageName ?? npcName.toLowerCase()}`;
}

/** A line in the target's channel: spam, or the game channel for a target with `channel: "game"`. */
function say(player, target, text) {
  if (target.channel === "game") player.sendMessage(text);
  else player.getPacketSender().sendTypedMessage(core.ChatType.SPAM, text);
}

/** The line a piece of loot is announced with, or null. */
function lootLine(target, given) {
  if (given.clue) return CLUE_LINE;
  if (given.steal) return Array.isArray(given.steal) ? given.steal[given.amount === 1 ? 0 : 1] : given.steal;
  if (target.lootLines !== "count" || !given.name) return null;
  const name = given.stealName ?? given.name.charAt(0).toLowerCase() + given.name.slice(1);
  return `You steal ${given.amount} ${name}${given.amount === 1 ? "" : "s"}.`;
}

/** The loot entry's fields its line needs, carried with the rolled item. */
function rolled(entry, amount) {
  const item = { id: entry.id, amount };
  for (const key of ["name", "steal", "stealName"]) if (entry[key] !== undefined) item[key] = entry[key];
  return item;
}

/** Wiki (Module:Skilling success chart): low/high out of 256, scaled by each bonus and rounded down. */
function successChance(player, target) {
  const level = player.getSkillManager().getCurrentLevel(core.Skill.THIEVING);
  let low = target.low;
  let high = target.high;
  const bonuses = [];
  if (wornName(player, core.Equipment.HANDS_SLOT) === "gloves of silence") bonuses.push(GLOVES_OF_SILENCE_BONUS);
  if (wearsThievingCape(player)) bonuses.push(THIEVING_CAPE_BONUS);
  // Content's bonus percent ("thieving:pickpocket-target" `chanceBonus`, a league fragment), stacking as the gloves do.
  if (target.chanceBonus > 0) bonuses.push(100 + target.chanceBonus);
  for (const bonus of bonuses) {
    low = Math.floor((low * bonus) / 100);
    high = Math.floor((high * bonus) / 100);
  }
  const value = Math.floor((low * (99 - level)) / 98 + (high * (level - 1)) / 98 + 0.5);
  return Math.max(0, Math.min(1, (1 + value) / 256));
}

function requirementMessage(player, target) {
  if (target.quest && !questComplete(player, target.quest.key)) {
    return `You need to complete ${target.quest.name} before you can do that.`;
  }
  if (target.requirement === "fireCape" && !hasFireCape(player)) {
    return "You need a fire cape to do that.";
  }
  return null;
}

/** Only coins (as a coin pouch) can come from this target. */
function onlyPouchLoot(target) {
  const entries = [...(target.always ?? []), ...(target.first ?? []), ...(target.table ?? [])];
  return Boolean(target.coinPouch) && entries.every((entry) => entry.id === core.ItemIdentifiers.COINS);
}

function tableRate(player, target, entry) {
  if (entry.farmingRate) {
    const farming = Math.min(85, player.getSkillManager().getMaxLevel(core.Skill.FARMING));
    return entry.farmingRate.base + entry.farmingRate.perLevel * farming;
  }
  if (entry.rateAfterQuest !== undefined && target.lootQuest && questComplete(player, target.lootQuest.key)) {
    return rateOf(entry.rateAfterQuest);
  }
  return rateOf(entry.rate);
}

/** Wiki (Clue scroll): one clue of each tier at a time, in any form, carried or banked. */
function ownsClue(player, tier) {
  const names = new Set(["clue scroll", "clue bottle", "clue nest", "scroll box"].map((kind) => `${kind} (${tier})`));
  const holds = (container) => container?.getItems?.().some((item) => item?.getAmount?.() > 0 && item.getId() > 0 &&
    names.has(String(core.ItemDefinition.forId(item.getId())?.getName?.() ?? "").toLowerCase()));
  return holds(player.getInventory()) || Array.from({ length: core.Bank.TOTAL_BANK_TABS }, (_, tab) => player.getBank(tab)).some(holds);
}

/** The loot of one successful pickpocket: [{ id, amount, clue? }]. */
function rollLoot(player, target, random = Math.random) {
  const loot = (target.always ?? []).map((entry) => rolled(entry, roll(entry.amount, random)));
  for (const entry of target.first ?? []) {
    if (random() >= rateOf(entry.rate)) continue;
    if (entry.clue) {
      // Wiki: rolling a clue while already holding one of that tier gives nothing.
      if (ownsClue(player, entry.clue)) return loot;
      const [scroll, box] = clueItems()[entry.clue];
      return [...loot, { id: questComplete(player, "x_marks_the_spot") ? box : scroll, amount: 1, clue: true }];
    }
    return [...loot, rolled(entry, roll(entry.amount, random))];
  }
  let pick = random();
  for (const entry of target.table ?? []) {
    pick -= tableRate(player, target, entry);
    if (pick < 0) return [...loot, rolled(entry, roll(entry.amount, random))];
  }
  return loot;
}

function rogueDoubleChance(player) {
  const pieces = ROGUE_SLOTS.filter((slot, i) => wornName(player, core.Equipment[slot]) === ROGUE_PIECES[i]).length;
  return pieces === ROGUE_PIECES.length ? 1 : pieces * ROGUE_CHANCE_PER_PIECE;
}

/**
 * Hands the loot over: coins as the target's coin pouch; the rogue outfit may double it, and
 * content's `multiplier` (a league fragment's double loot) multiplies it again. Clues are never more.
 * What the inventory has no room for (a doubled pouch's coins, a doubled item) falls to the floor.
 * Returns the loot as given (amounts doubled), for its lines.
 */
function giveLoot(player, target, loot, random = Math.random, multiplier = 1) {
  const times = (random() < rogueDoubleChance(player) ? 2 : 1) * Math.max(1, multiplier | 0);
  const inventory = player.getInventory();
  const given = [];
  for (const item of loot) {
    const { id, amount, clue } = item;
    if (id === core.ItemIdentifiers.COINS && target.coinPouch) {
      inventory.adds(target.coinPouch.id, 1);
      // Wiki (Coin pouch): a doubled pouch gives one pouch plus its coins directly.
      const coins = (times - 1) * (Array.isArray(target.coinPouch.coins) ? target.coinPouch.coins[0] : target.coinPouch.coins);
      if (coins > 0) inventory.forceAdd(player, new core.Item(core.ItemIdentifiers.COINS, coins));
      given.push({ ...item, amount: 1 });
      continue;
    }
    const total = clue ? amount : amount * times;
    inventory.forceAdd(player, new core.Item(id, total));
    given.push({ ...item, amount: total });
  }
  return given;
}

function wearOutGloves(player) {
  if (wornName(player, core.Equipment.HANDS_SLOT) !== "gloves of silence") return;
  const failures = (Number(player.getAttribute(GLOVES_OF_SILENCE_ATTRIBUTE)) || 0) + 1;
  if (failures < GLOVES_OF_SILENCE_FAILURES) {
    player.setAttribute(GLOVES_OF_SILENCE_ATTRIBUTE, failures);
    return;
  }
  player.setAttribute(GLOVES_OF_SILENCE_ATTRIBUTE, 0);
  player.getEquipment().set(core.Equipment.HANDS_SLOT, new core.Item(-1));
  player.getEquipment().refreshItems();
  player.sendMessage("Your gloves of silence have worn out.");
}

/** Wiki (Dodgy necklace): one charge per stun it prevents; the last one crumbles it. */
function dodgyNecklaceProtects(player, random = Math.random) {
  if (wornName(player, core.Equipment.AMULET_SLOT) !== "dodgy necklace" || random() >= DODGY_NECKLACE_CHANCE) return false;
  const stored = player.getAttribute(DODGY_NECKLACE_ATTRIBUTE);
  const charges = (stored === undefined || stored === null ? DODGY_NECKLACE_CHARGES : Number(stored)) - 1;
  if (charges <= 0) {
    player.setAttribute(DODGY_NECKLACE_ATTRIBUTE, DODGY_NECKLACE_CHARGES);
    player.getEquipment().set(core.Equipment.AMULET_SLOT, new core.Item(-1));
    player.getEquipment().refreshItems();
    player.sendMessage("Your dodgy necklace protects you. It then crumbles to dust.");
  } else {
    player.setAttribute(DODGY_NECKLACE_ATTRIBUTE, charges);
    player.sendMessage(`Your dodgy necklace protects you. It has ${charges} charge${charges === 1 ? "" : "s"} left.`);
  }
  return true;
}

function succeed(player, npc, target, name) {
  player.performAnimation(new core.Animation(target.pickpocketAnimation ?? THIEVING_ANIMATION));
  // Content may change the loot before it is handed over ("thieving:loot", a league relic's doubled or noted loot),
  // or multiply it as the rogue outfit does (`multiplier`, a league fragment's double loot).
  const loot = { player, npc, target: target.name, loot: rollLoot(player, target), multiplier: 1 };
  pluginApi.emitCustomEvent("thieving:loot", loot);
  const given = giveLoot(player, target, loot.loot, Math.random, loot.multiplier);
  say(player, target, target.successLine ?? `You pick ${name}'s pocket.`);
  for (const item of given) {
    const line = lootLine(target, item);
    if (line) say(player, target, line);
  }
  core.Sounds.sendSound(player, core.Sound.THIEVING_PICKPOCKET);
  player.getSkillManager().addExperiences(core.Skill.THIEVING, target.xp);
  pluginApi.emitCustomEvent("thieving:success", { player, skill: core.Skill.THIEVING, petBase: target.petBase, method: "pickpocket", target: target.name });
}

/** Caught: the message and the NPC's line now (no pickpocket animation); the stun follows. */
function fail(player, npc, target, name) {
  if (core.ArceuusSpells.hasShadowVeil(player) && Math.random() < SHADOW_VEIL_CHANCE) {
    player.sendMessage("Your shadow veil prevents you from being noticed.");
    return;
  }
  say(player, target, `You fail to pick ${name}'s pocket.`);
  npc.forceChat(target.catchLine ?? DEFAULT_CATCH_LINE);
  wearOutGloves(player);
  caughtAt.set(player, core.World.getProcessCycle());
  core.TaskManager.submit(caughtTask(player, npc, target));
}

/**
 * Capture (a hero, 2026-10-05): a tick after the failure the NPC turns and strikes, and the
 * player blocks under the stun graphic as the 9-tick stun starts; "You've been stunned!" and the
 * damage come a tick after that.
 */
function caughtTask(player, npc, target) { return new (class extends core.Task {
  constructor(player, npc, target) {
    // Not keyed to the player: a new click cancels the player's keyed tasks, but OSRS still
    // resolves an attempt (and its stun) while the player clicks on.
    super(1);
    this.player = player;
    this.npc = npc;
    this.target = target;
    this.stunned = false;
  }

  execute() {
    const { player, npc, target } = this;
    if (!player.isRegistered() || player.getHitpoints() <= 0) {
      caughtAt.delete(player);
      this.stop();
      return;
    }
    if (this.stunned) {
      player.getPacketSender().sendTypedMessage(core.ChatType.SPAM, "You've been stunned!");
      if (!target.painless) player.getCombat().getHitQueue().addPendingDamage([new core.HitDamage(roll(target.stunDamage), core.HitMask.RED)]);
      this.stop();
      return;
    }
    if (npc.isRegistered()) {
      npc.setPositionToFace(player.getLocation());
      npc.performAnimation(new core.Animation(npc.getAttackAnim()));
    }
    caughtAt.delete(player);
    if (dodgyNecklaceProtects(player)) {
      this.stop();
      return;
    }
    player.performAnimation(new core.Animation(player.getBlockAnim()));
    core.Sounds.sendSound(player, core.Sound.THIEVING_STUNNED);
    core.CombatFactory.stunTicks(player, PICKPOCKET_STUN_TICKS, true, { graphic: new core.Graphic(STUN_GRAPHIC_ID, 0, 124), message: false });
    this.stunned = true;
  }
})(player, npc, target); }

/** The attempt message goes out on the click; the outcome follows a tick later. */
function pickpocketTask(player, npc, target, name, event) { return new (class extends core.Task {
  constructor(player, npc, target, name, event) {
    // Not keyed to the player: a new click cancels the player's keyed tasks, but OSRS still
    // resolves an attempt (and its stun) while the player clicks on.
    super(1);
    this.player = player;
    this.npc = npc;
    this.target = target;
    this.name = name;
    this.event = event;
  }

  execute() {
    this.stop();
    const { player, npc, target, name, event } = this;
    if (!player.isRegistered() || !npc.isRegistered() || player.getHitpoints() <= 0) return;
    // Capture (a hero): with the outcome the player stops tracking the NPC and keeps facing the
    // tile it stood on, so a walking NPC isn't followed round.
    if (player.getInteractingMobile?.() === npc) player.setMobileInteraction(null);
    player.setPositionToFace(npc.getLocation());
    const succeeded = Math.random() < successChance(player, target);
    if (succeeded) succeed(player, npc, target, name);
    else fail(player, npc, target, name);
    // Content may ask for another go ("thieving:done", a league relic that keeps pickpocketing): the same click, a tick later.
    const done = { player, kind: "pickpocket", npc, succeeded, again: false };
    pluginApi.emitCustomEvent("thieving:done", done);
    // A repeat only while neither has moved: the player on the tile they pickpocketed from, the NPC still within reach.
    const inReach = event && samePlace(player.getLocation(), event.from) && npc.getLocation().getDistance?.(player.getLocation()) <= Math.max(1, npc.getSize?.() ?? 1);
    // Keyed by the player's index, as their other actions: walking off (MovementQueue.walkToReset) cancels it; and
    // checked again when it fires, in case they moved another way.
    if (done.again && inReach) core.TaskManager.submit(new core.CountdownTask(player.getIndex(), 1, () => {
      const stillThere = samePlace(player.getLocation(), event.from) && npc.isRegistered()
        && npc.getLocation().getDistance?.(player.getLocation()) <= Math.max(1, npc.getSize?.() ?? 1);
      if (stillThere && player.getMovementQueue?.()?.isMovings?.() !== true) pickpocket({ ...event, repeat: true });
    }));
  }
})(player, npc, target, name, event); }

/** Where something stands, as plain coordinates. */
function tile(location) {
  return { x: location?.getX?.(), y: location?.getY?.(), z: location?.getZ?.() };
}

function samePlace(location, from) {
  const here = tile(location);
  return !!from && here.x !== undefined && here.x === from.x && here.y === from.y && here.z === from.z;
}

function pickpocket(event) {
  const { player, npc } = event;
  const npcName = event.definition.getName();
  const request = { ...event, target: targetFor(npcName, event.npcId), unconscious: false, alwaysSucceeds: false, pouchLimit: MAX_COIN_POUCHES,
    chanceBonus: 0, painless: false };
  pluginApi.emitCustomEvent("thieving:pickpocket-target", request);
  const target = request.target;
  if (!target) return false;
  event.handled = true;

  if (!event.repeat && !player.getClickDelay().elapsedTime(PICKPOCKET_COOLDOWN_MS)) return;
  if (player.getSkillManager().getCurrentLevel(core.Skill.THIEVING) < target.level) {
    player.sendMessage(`You need a Thieving level of at least ${target.level} to do this.`);
    return;
  }
  const missing = requirementMessage(player, target);
  if (missing) {
    player.sendMessage(missing);
    return;
  }
  // The stun's last tick still holds the player in place but no longer stops a pickpocket.
  if (core.World.getProcessCycle() - (caughtAt.get(player) ?? -Infinity) < CAUGHT_HOLD_TICKS || player.getTimers().getTicks(core.TimerKey.STUN) > PICKPOCKET_STUN_TICKS - PICKPOCKET_STUN_LOCK_TICKS) return;
  if (core.CombatFactory.inCombat(player)) {
    player.sendMessage("You must wait a few seconds after being in combat to do this.");
    return;
  }
  if (core.CombatFactory.inCombat(npc)) {
    player.sendMessage("That npc is currently in combat and cannot be pickpocketed.");
    return;
  }
  const pouches = target.coinPouch ? player.getInventory().getAmount(target.coinPouch.id) : 0;
  if (!request.unconscious && pouches >= Math.max(1, request.pouchLimit | 0)) {
    player.sendMessage("You need to empty your coin pouches before you can continue pickpocketing.");
    return;
  }
  if (player.getInventory().isFull() && !(pouches > 0 && onlyPouchLoot(target)) && !(request.unconscious && player.getInventory().getAmount(core.ItemIdentifiers.COINS) > 0)) {
    player.getInventory().full();
    return;
  }

  request.onAttempt?.();
  player.getMovementQueue().reset();
  player.setPositionToFace(npc.getLocation());
  const name = messageName(target, npcName, event.npcId);
  say(player, target, target.attemptLine ?? `You attempt to pick ${name}'s pocket.`);
  player.getClickDelay().reset();
  npc.getTimers().registers(core.TimerKey.ATTACK_IMMUNITY, 10);
  // `alwaysSucceeds` (a league relic) lands every attempt as an unconscious target does, coin pouches kept;
  // `chanceBonus` raises the success chance by that percent and `painless` stuns without the damage (a league fragment).
  const tuned = request.chanceBonus > 0 || request.painless ? { ...target, chanceBonus: Math.max(0, request.chanceBonus | 0), painless: request.painless === true } : target;
  const rolled = request.unconscious ? { ...tuned, low: 256, high: 256, coinPouch: null } : request.alwaysSucceeds ? { ...tuned, low: 256, high: 256 } : tuned;
  core.TaskManager.submit(pickpocketTask(player, npc, rolled, name, { ...event, from: event.from ?? tile(player.getLocation()) }));
}

/** Coins in one pouch of this kind (a range rolls per pouch). */
function pouchCoins(pouchId, random = Math.random) {
  const coins = POUCH_COINS.get(pouchId);
  return coins === undefined ? 0 : roll(coins, random);
}

function register(api) {
  core = api.core;
  pluginApi = api;
  api.onNpcsInteraction([...new Set(TARGETS.filter((t) => !t.option).flatMap((t) => t.npcs))], { Pickpocket: pickpocket });
  api.onNpcInteraction("Digsite workman", { "Steal-from": pickpocket });
}

module.exports = {
  register,
  pouchCoins,
  POUCH_COINS,
  TARGETS,
  targetFor,
  _test: { pickpocket, successChance, rollLoot, giveLoot, lootLine, targetFor, messageName, dodgyNecklaceProtects, wearOutGloves, rateOf },
};
