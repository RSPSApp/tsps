/**
 * Pickpocketing, driven by data/definitions/pickpocketing.json (OSRS Wiki: Thieving#Pickpocketing,
 * each target's page, Coin pouch, Rogue equipment, Gloves of silence, Dodgy necklace, Thieving cape).
 *
 * The click sends the attempt message and starts the two-tick cooldown. On the next tick a success
 * plays the animation with its loot; a failure sends its message, and the 9-tick stun (8 without
 * pickpocketing) lands a tick later, the stun message and damage a tick after that.
 * Not modelled: blackjacking, the Wealthy citizen's urchin distraction, and the Ardougne diary
 * (+10% success, 56/84/140 coin pouches) as there is no diary system yet.
 */
const fs = require("fs");
const path = require("path");
const { GameConstants } = require("../../../src/main/typescript/elvarg/game/GameConstants");
const { Skill } = require("../../../src/main/typescript/elvarg/game/model/Skill");
const { Item } = require("../../../src/main/typescript/elvarg/game/model/Item");
const { Animation } = require("../../../src/main/typescript/elvarg/game/model/Animation");
const { Graphic } = require("../../../src/main/typescript/elvarg/game/model/Graphic");
const { Task } = require("../../../src/main/typescript/elvarg/game/task/Task");
const { HitDamage } = require("../../../src/main/typescript/elvarg/game/content/combat/hit/HitDamage");
const { HitMask } = require("../../../src/main/typescript/elvarg/game/content/combat/hit/HitMask");
const { Sound } = require("../../../src/main/typescript/elvarg/game/Sound");
const { Sounds } = require("../../../src/main/typescript/elvarg/game/Sounds");
const { TimerKey } = require("../../../src/main/typescript/elvarg/util/timers/TimerKey");
const { Equipment } = require("../../../src/main/typescript/elvarg/game/model/container/impl/Equipment");
const { ItemDefinition } = require("../../../src/main/typescript/elvarg/game/definition/ItemDefinition");
const { ItemIdentifiers } = require("../../../src/main/typescript/elvarg/util/ItemIdentifiers");
const { Bank } = require("../../../src/main/typescript/elvarg/game/model/container/impl/Bank");
const { ArceuusSpells } = require("../../../src/main/typescript/elvarg/game/content/combat/magic/ArceuusSpells");

const THIEVING_ANIMATION = new Animation(881);
const PICKPOCKET_COOLDOWN_MS = 1200;
const PICKPOCKET_STUN_TICKS = 9;
const PICKPOCKET_STUN_LOCK_TICKS = 8;
const DEFAULT_CATCH_LINE = "What do you think you're doing?";
// Capture (a hero, 2026-10-05): the stun graphic is stunned_thieving at height 124.
const STUN_GRAPHIC = new Graphic(245, 0, 124);

// Wiki (Coin pouch): 28 of a kind, then they must be opened.
const MAX_COIN_POUCHES = 28;
// Wiki (Gloves of silence): +5% success; a pair breaks after 62 failed pickpockets.
const GLOVES_OF_SILENCE_BONUS = 105;
const GLOVES_OF_SILENCE_FAILURES = 62;
const GLOVES_OF_SILENCE_ATTRIBUTE = "thieving.gloves-of-silence-failures";
// Wiki (Thieving cape): +10% success, multiplied with the gloves; the max cape carries the perk.
const THIEVING_CAPE_BONUS = 110;
const THIEVING_CAPES = new Set(["thieving cape", "thieving cape(t)", "max cape"]);
// Wiki (Dodgy necklace): 25% to avoid the stun and damage; 10 charges, kept on the player.
const DODGY_NECKLACE_CHANCE = 0.25;
const DODGY_NECKLACE_CHARGES = 10;
const DODGY_NECKLACE_ATTRIBUTE = "thieving.dodgy-necklace-charges";
// Wiki (Shadow Veil): 15% to avoid the stun, rolled before the necklace.
const SHADOW_VEIL_CHANCE = 0.15;
// Wiki (Rogue equipment): 15% double loot per piece; all five always double.
const ROGUE_PIECES = ["rogue mask", "rogue top", "rogue trousers", "rogue gloves", "rogue boots"];
const ROGUE_SLOTS = [Equipment.HEAD_SLOT, Equipment.BODY_SLOT, Equipment.LEG_SLOT, Equipment.HANDS_SLOT, Equipment.FEET_SLOT];
const ROGUE_CHANCE_PER_PIECE = 0.15;
const FIRE_CAPES = new Set(["fire cape", "fire max cape", "infernal cape", "infernal max cape"]);
const CLUE_ITEMS = {
  easy: [ItemIdentifiers.CLUE_SCROLL_EASY_, ItemIdentifiers.SCROLL_BOX_EASY_],
  medium: [ItemIdentifiers.CLUE_SCROLL_MEDIUM_, ItemIdentifiers.SCROLL_BOX_MEDIUM_],
  hard: [ItemIdentifiers.CLUE_SCROLL_HARD_, ItemIdentifiers.SCROLL_BOX_HARD_],
  elite: [ItemIdentifiers.CLUE_SCROLL_ELITE_, ItemIdentifiers.SCROLL_BOX_ELITE_],
};

const DATA = JSON.parse(fs.readFileSync(path.join(GameConstants.DEFINITIONS_DIRECTORY, "pickpocketing.json"), "utf8"));
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
const CAUGHT_HOLD_MS = 1800;

let pluginApi;
let TaskManager;
let CombatFactory;

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
  return id > 0 ? String(ItemDefinition.forId(id)?.getName?.() ?? "").toLowerCase() : "";
}

function questComplete(player, key) {
  const request = { player, key, complete: null };
  pluginApi.emitCustomEvent("quest:is-complete", request);
  return typeof request.complete === "boolean" ? request.complete : Number(player.getAttribute(`quest.${key}.stage`)) >= 2;
}

function hasFireCape(player) {
  if (FIRE_CAPES.has(wornName(player, Equipment.CAPE_SLOT))) return true;
  return player.getInventory().getItems().some((item) =>
    item?.getId?.() > 0 && FIRE_CAPES.has(String(ItemDefinition.forId(item.getId())?.getName?.() ?? "").toLowerCase()));
}

/** The target an NPC belongs to: one listing its id first, then one by name without an id list. */
function targetFor(name, npcId) {
  const targets = TARGETS_BY_NAME.get(name) ?? [];
  return targets.find((t) => t.ids?.includes(npcId)) ?? targets.find((t) => !t.ids) ?? null;
}

/** How the messages name the NPC: "the man", "the H.A.M. member", or a named NPC's own name. */
function messageName(target, npcName) {
  if (target.properNames) return npcName;
  return `the ${target.messageName ?? npcName.toLowerCase()}`;
}

/** Wiki (Module:Skilling success chart): low/high out of 256, scaled by each bonus and rounded down. */
function successChance(player, target) {
  const level = player.getSkillManager().getCurrentLevel(Skill.THIEVING);
  let low = target.low;
  let high = target.high;
  const bonuses = [];
  if (wornName(player, Equipment.HANDS_SLOT) === "gloves of silence") bonuses.push(GLOVES_OF_SILENCE_BONUS);
  if (THIEVING_CAPES.has(wornName(player, Equipment.CAPE_SLOT))) bonuses.push(THIEVING_CAPE_BONUS);
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
  return Boolean(target.coinPouch) && entries.every((entry) => entry.id === ItemIdentifiers.COINS);
}

function tableRate(player, target, entry) {
  if (entry.farmingRate) {
    const farming = Math.min(85, player.getSkillManager().getMaxLevel(Skill.FARMING));
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
    names.has(String(ItemDefinition.forId(item.getId())?.getName?.() ?? "").toLowerCase()));
  return holds(player.getInventory()) || Array.from({ length: Bank.TOTAL_BANK_TABS }, (_, tab) => player.getBank(tab)).some(holds);
}

/** The loot of one successful pickpocket: [{ id, amount, clue? }]. */
function rollLoot(player, target, random = Math.random) {
  const loot = (target.always ?? []).map((entry) => ({ id: entry.id, amount: roll(entry.amount, random) }));
  for (const entry of target.first ?? []) {
    if (random() >= rateOf(entry.rate)) continue;
    if (entry.clue) {
      // Wiki: rolling a clue while already holding one of that tier gives nothing.
      if (ownsClue(player, entry.clue)) return loot;
      const [scroll, box] = CLUE_ITEMS[entry.clue];
      return [...loot, { id: questComplete(player, "x_marks_the_spot") ? box : scroll, amount: 1, clue: true }];
    }
    return [...loot, { id: entry.id, amount: roll(entry.amount, random) }];
  }
  let pick = random();
  for (const entry of target.table ?? []) {
    pick -= tableRate(player, target, entry);
    if (pick < 0) return [...loot, { id: entry.id, amount: roll(entry.amount, random) }];
  }
  return loot;
}

function rogueDoubleChance(player) {
  const pieces = ROGUE_SLOTS.filter((slot, i) => wornName(player, slot) === ROGUE_PIECES[i]).length;
  return pieces === ROGUE_PIECES.length ? 1 : pieces * ROGUE_CHANCE_PER_PIECE;
}

/** Hands the loot over: coins as the target's coin pouch; the rogue outfit may double it. */
function giveLoot(player, target, loot, random = Math.random) {
  const doubled = random() < rogueDoubleChance(player);
  for (const { id, amount, clue } of loot) {
    if (id === ItemIdentifiers.COINS && target.coinPouch) {
      player.getInventory().adds(target.coinPouch.id, 1);
      // Wiki (Coin pouch): a doubled pouch gives one pouch plus its coins directly.
      if (doubled) player.getInventory().adds(ItemIdentifiers.COINS, Array.isArray(target.coinPouch.coins) ? target.coinPouch.coins[0] : target.coinPouch.coins);
      continue;
    }
    player.getInventory().adds(id, doubled && !clue ? amount * 2 : amount);
  }
}

function wearOutGloves(player) {
  if (wornName(player, Equipment.HANDS_SLOT) !== "gloves of silence") return;
  const failures = (Number(player.getAttribute(GLOVES_OF_SILENCE_ATTRIBUTE)) || 0) + 1;
  if (failures < GLOVES_OF_SILENCE_FAILURES) {
    player.setAttribute(GLOVES_OF_SILENCE_ATTRIBUTE, failures);
    return;
  }
  player.setAttribute(GLOVES_OF_SILENCE_ATTRIBUTE, 0);
  player.getEquipment().set(Equipment.HANDS_SLOT, new Item(-1));
  player.getEquipment().refreshItems();
  player.sendMessage("Your gloves of silence have worn out.");
}

/** Wiki (Dodgy necklace): one charge per stun it prevents; the last one crumbles it. */
function dodgyNecklaceProtects(player, random = Math.random) {
  if (wornName(player, Equipment.AMULET_SLOT) !== "dodgy necklace" || random() >= DODGY_NECKLACE_CHANCE) return false;
  const stored = player.getAttribute(DODGY_NECKLACE_ATTRIBUTE);
  const charges = (stored === undefined || stored === null ? DODGY_NECKLACE_CHARGES : Number(stored)) - 1;
  if (charges <= 0) {
    player.setAttribute(DODGY_NECKLACE_ATTRIBUTE, DODGY_NECKLACE_CHARGES);
    player.getEquipment().set(Equipment.AMULET_SLOT, new Item(-1));
    player.getEquipment().refreshItems();
    player.sendMessage("Your dodgy necklace protects you. It then crumbles to dust.");
  } else {
    player.setAttribute(DODGY_NECKLACE_ATTRIBUTE, charges);
    player.sendMessage(`Your dodgy necklace protects you. It has ${charges} charge${charges === 1 ? "" : "s"} left.`);
  }
  return true;
}

function succeed(player, target, name) {
  player.performAnimation(THIEVING_ANIMATION);
  giveLoot(player, target, rollLoot(player, target));
  player.sendMessage(`You pick ${name}'s pocket.`);
  Sounds.sendSound(player, Sound.THIEVING_PICKPOCKET);
  player.getSkillManager().addExperiences(Skill.THIEVING, target.xp);
  pluginApi.emitCustomEvent("thieving:success", { player, skill: Skill.THIEVING, petBase: target.petBase });
}

/** Caught: the message and the NPC's line now (no pickpocket animation); the stun follows. */
function fail(player, npc, target, name) {
  if (ArceuusSpells.hasShadowVeil(player) && Math.random() < SHADOW_VEIL_CHANCE) {
    player.sendMessage("Your shadow veil prevents you from being noticed.");
    return;
  }
  player.sendMessage(`You fail to pick ${name}'s pocket.`);
  npc.forceChat(target.catchLine ?? DEFAULT_CATCH_LINE);
  wearOutGloves(player);
  caughtAt.set(player, Date.now());
  TaskManager.submit(new CaughtTask(player, npc, target));
}

/**
 * Capture (a hero, 2026-10-05): a tick after the failure the NPC turns and strikes, and the
 * player blocks under the stun graphic as the 9-tick stun starts; "You've been stunned!" and the
 * damage come a tick after that.
 */
class CaughtTask extends Task {
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
      player.sendMessage("You've been stunned!");
      player.getCombat().getHitQueue().addPendingDamage([new HitDamage(roll(target.stunDamage), HitMask.RED)]);
      this.stop();
      return;
    }
    if (npc.isRegistered()) {
      npc.setPositionToFace(player.getLocation());
      npc.performAnimation(new Animation(npc.getAttackAnim()));
    }
    caughtAt.delete(player);
    if (dodgyNecklaceProtects(player)) {
      this.stop();
      return;
    }
    player.performAnimation(new Animation(player.getBlockAnim()));
    Sounds.sendSound(player, Sound.THIEVING_STUNNED);
    CombatFactory.stunTicks(player, PICKPOCKET_STUN_TICKS, true, { graphic: STUN_GRAPHIC, message: false });
    this.stunned = true;
  }
}

/** The attempt message goes out on the click; the outcome follows a tick later. */
class PickpocketTask extends Task {
  constructor(player, npc, target, name) {
    // Not keyed to the player: a new click cancels the player's keyed tasks, but OSRS still
    // resolves an attempt (and its stun) while the player clicks on.
    super(1);
    this.player = player;
    this.npc = npc;
    this.target = target;
    this.name = name;
  }

  execute() {
    this.stop();
    const { player, npc, target, name } = this;
    if (!player.isRegistered() || !npc.isRegistered() || player.getHitpoints() <= 0) return;
    // Capture (a hero): with the outcome the player stops tracking the NPC and keeps facing the
    // tile it stood on, so a walking NPC isn't followed round.
    if (player.getInteractingMobile?.() === npc) player.setMobileInteraction(null);
    player.setPositionToFace(npc.getLocation());
    if (Math.random() < successChance(player, target)) succeed(player, target, name);
    else fail(player, npc, target, name);
  }
}

function pickpocket(event) {
  const { player, npc } = event;
  const npcName = event.definition.getName();
  const target = targetFor(npcName, event.npcId);
  if (!target) return false;
  event.handled = true;

  if (!player.getClickDelay().elapsedTime(PICKPOCKET_COOLDOWN_MS)) return;
  if (player.getSkillManager().getCurrentLevel(Skill.THIEVING) < target.level) {
    player.sendMessage(`You need a Thieving level of at least ${target.level} to do this.`);
    return;
  }
  const missing = requirementMessage(player, target);
  if (missing) {
    player.sendMessage(missing);
    return;
  }
  // The stun's last tick still holds the player in place but no longer stops a pickpocket.
  if (Date.now() - (caughtAt.get(player) ?? 0) < CAUGHT_HOLD_MS || player.getTimers().getTicks(TimerKey.STUN) > PICKPOCKET_STUN_TICKS - PICKPOCKET_STUN_LOCK_TICKS) return;
  if (CombatFactory.inCombat(player)) {
    player.sendMessage("You must wait a few seconds after being in combat to do this.");
    return;
  }
  if (CombatFactory.inCombat(npc)) {
    player.sendMessage("That npc is currently in combat and cannot be pickpocketed.");
    return;
  }
  const pouches = target.coinPouch ? player.getInventory().getAmount(target.coinPouch.id) : 0;
  if (pouches >= MAX_COIN_POUCHES) {
    player.sendMessage("You need to empty your coin pouches before you can continue pickpocketing.");
    return;
  }
  if (player.getInventory().isFull() && !(pouches > 0 && onlyPouchLoot(target))) {
    player.getInventory().full();
    return;
  }

  player.getMovementQueue().reset();
  player.setPositionToFace(npc.getLocation());
  const name = messageName(target, npcName);
  player.sendMessage(`You attempt to pick ${name}'s pocket.`);
  player.getClickDelay().reset();
  npc.getTimers().registers(TimerKey.ATTACK_IMMUNITY, 10);
  TaskManager.submit(new PickpocketTask(player, npc, target, name));
}

/** Coins in one pouch of this kind (a range rolls per pouch). */
function pouchCoins(pouchId, random = Math.random) {
  const coins = POUCH_COINS.get(pouchId);
  return coins === undefined ? 0 : roll(coins, random);
}

function register(api) {
  pluginApi = api;
  TaskManager = api.getTaskManager();
  CombatFactory = api.getCombatFactory();
  const registered = new Set();
  for (const target of TARGETS) {
    for (const name of target.npcs) {
      const option = target.option ?? "Pickpocket";
      if (registered.has(`${name}|${option}`)) continue;
      registered.add(`${name}|${option}`);
      api.onNpcInteraction(name, { [option]: pickpocket });
    }
  }
}

module.exports = {
  register,
  pouchCoins,
  POUCH_COINS,
  TARGETS,
  _test: { pickpocket, successChance, rollLoot, giveLoot, targetFor, messageName, dodgyNecklaceProtects, wearOutGloves, rateOf },
};
