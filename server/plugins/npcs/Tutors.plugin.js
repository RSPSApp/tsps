/**
 * Lumbridge tutors (https://oldschool.runescape.wiki/w/Tutor).
 *
 * The words are the wiki transcripts NpcDialogues already plays; this plugin answers
 * their prose conditions and hands out what they say the tutor gives:
 *   Melee combat tutor  - training sword / shield (Talk-to).
 *   Ranged combat tutor - Claim: training bow + 25 training arrows.
 *   Magic combat tutor  - Claim: 30 mind runes + 30 air runes.
 *     Ranged and Magic share one claim every 30 minutes, and only top up what the
 *     player has none of (inventory, bank or worn).
 *   Fishing tutor - small fishing net. Mining tutor - bronze pickaxe.
 *   Woodsman tutor - bronze axe, tinderbox. Master smithing tutor - hammer.
 * Skill-level menus ("If the player has level 1-28 Fishing:") are answered for every tutor.
 */
const { getRegisteredQuests } = require("../quests/QuestRuntime");

const CLAIM_ATTRIBUTE = "tutors.combat_claim_at";
const AUTO_EQUIP_ATTRIBUTE = "ranged:equip-ammo-on-pickup";
const CLAIM_COOLDOWN_MS = 30 * 60 * 1000;
const TRAINING_ARROW_COUNT = 25;
const RUNE_COUNT = 30;

let core;
let pluginApi;
let NPC;
let ITEM;
/** npc id -> the skill a level condition without a skill name refers to. */
let TUTOR_SKILLS = new Map();
/** npc id -> that tutor's own condition answers. */
let CONDITIONS = new Map();
/** Players whose current magic claim also handed out air runes. */
const gaveAir = new WeakSet();

function init(api) {
  pluginApi = api;
  core = api.core;
  const { NpcIdentifiers: N, ItemIdentifiers: I, Skill } = core;
  NPC = {
    MELEE: N.MELEE_COMBAT_TUTOR, RANGED: N.RANGED_COMBAT_TUTOR, MAGIC: N.MAGIC_COMBAT_TUTOR,
    COOKING: N.COOKING_TUTOR, CRAFTING: N.CRAFTING_TUTOR, FISHING: N.FISHING_TUTOR,
    MINING: N.MINING_TUTOR, PRAYER: N.PRAYER_TUTOR, SMITHING_APPRENTICE: N.SMITHING_APPRENTICE,
    MASTER_SMITHING: N.MASTER_SMITHING_TUTOR, WOODSMAN: N.WOODSMAN_TUTOR,
  };
  ITEM = I;
  TUTOR_SKILLS = new Map([
    [NPC.MELEE, Skill.DEFENCE], [NPC.RANGED, Skill.RANGED], [NPC.MAGIC, Skill.MAGIC],
    [NPC.COOKING, Skill.COOKING], [NPC.CRAFTING, Skill.CRAFTING], [NPC.FISHING, Skill.FISHING],
    [NPC.MINING, Skill.MINING], [NPC.PRAYER, Skill.PRAYER], [NPC.SMITHING_APPRENTICE, Skill.SMITHING],
    [NPC.MASTER_SMITHING, Skill.SMITHING], [NPC.WOODSMAN, Skill.WOODCUTTING],
  ]);
  CONDITIONS = new Map([
    [NPC.MELEE, meleeCondition], [NPC.RANGED, rangedCondition], [NPC.MAGIC, magicCondition],
    [NPC.FISHING, fishingCondition], [NPC.MINING, miningCondition], [NPC.WOODSMAN, woodsmanCondition],
    [NPC.MASTER_SMITHING, smithingCondition], [NPC.SMITHING_APPRENTICE, smithingCondition],
    [NPC.COOKING, cookingCondition],
  ]);
}

// --- Player state.

function carried(player, itemId) {
  return player.getInventory().getAmount(itemId) > 0;
}

function worn(player, itemId) {
  return player.getEquipment().contains(itemId);
}

function banked(player, itemId) {
  return player.getBanks().some((bank) => bank?.getAmount(itemId) > 0);
}

function owns(player, itemId) {
  return carried(player, itemId) || worn(player, itemId) || banked(player, itemId);
}

/** Any carried (or, with `equipment`, worn) item whose cache name matches. */
function hasNamed(player, pattern, equipment = false) {
  const items = [...player.getInventory().getItems(), ...(equipment ? player.getEquipment().getItems() : [])];
  return items.some((item) => item && item.getId() > 0 && pattern.test(core.ItemDefinition.forId(item.getId()).getName() ?? ""));
}

function hasPickaxe(player) {
  return hasNamed(player, /pickaxe/i, true);
}

function hasAxe(player) {
  return hasNamed(player, /\baxe\b/i, true);
}

function freeSlots(player) {
  return player.getInventory().getFreeSlots();
}

function questNamed(name) {
  return getRegisteredQuests().find((quest) => quest.name === name);
}

function questStarted(player, name) {
  return questNamed(name)?.isStarted(player) ?? false;
}

function questComplete(player, name) {
  return questNamed(name)?.isComplete(player) ?? false;
}

function onClaimCooldown(player) {
  return Date.now() - (Number(player.getAttribute(CLAIM_ATTRIBUTE)) || 0) < CLAIM_COOLDOWN_MS;
}

function give(player, itemId, amount = 1) {
  player.getInventory().adds(itemId, amount);
}

function claimed(player) {
  player.setAttribute(CLAIM_ATTRIBUTE, Date.now());
}

/** Free slots the ranged claim needs: one each for whichever of bow/arrows is missing. */
function rangedSlotsNeeded(player) {
  return Number(!owns(player, ITEM.TRAINING_BOW)) + Number(!owns(player, ITEM.TRAINING_ARROWS));
}

// --- Generic conditions.

function skillNamed(word) {
  const name = String(word ?? "").toLowerCase();
  if (name.length < 4) return undefined;
  return core.Skill.values().find((skill) => skill.getName().toLowerCase().startsWith(name));
}

/**
 * "level 1-28 Fishing", "21-37 Smithing", "At level 26-36:", "level 1-? Cooking",
 * "has 99 prayer", "below 99 Crafting", "has level 25 fishing". A range without a
 * skill name means the tutor's own skill. Null when the text names no level.
 */
function levelCheck(player, npcId, text) {
  const level = (skill) => player.getSkillManager().getMaxLevel(skill);
  const range = /(\d+)\s*-\s*(\d+|\?)(?:\s+([a-z]+))?/i.exec(text);
  if (range) {
    const skill = skillNamed(range[3]) ?? TUTOR_SKILLS.get(npcId);
    if (!skill) return null;
    const max = range[2] === "?" ? 99 : Number(range[2]);
    return level(skill) >= Number(range[1]) && level(skill) <= max;
  }
  const single = /(below\s+)?(\d+)\s+([a-z]+)/i.exec(text);
  const skill = single && skillNamed(single[3]);
  if (!skill) return null;
  return single[1] ? level(skill) < Number(single[2]) : level(skill) >= Number(single[2]);
}

/** Members' world (this server runs members content) and level parts, ANDed. */
function genericCondition(player, npcId, text) {
  if (/adventure paths/i.test(text)) return /does not have/i.test(text);
  const world = /non-members|free-to-play|f2p/i.test(text) ? false : /member/i.test(text) ? true : null;
  const level = levelCheck(player, npcId, text);
  if (world === null && level === null) return null;
  return (world ?? true) && (level ?? true);
}

// --- Per-tutor conditions (null falls through to the generic answer).

function meleeCondition(player, text) {
  const sword = owns(player, ITEM.TRAINING_SWORD);
  const shield = owns(player, ITEM.TRAINING_SHIELD);
  if (/already has a training sword and shield/i.test(text)) return sword && shield;
  if (/training sword .*but not a shield/i.test(text)) return sword && !shield;
  if (/training shield .*but not a sword/i.test(text)) return shield && !sword;
  if (/does not have a training sword or shield/i.test(text)) return !sword && !shield;
  return null;
}

function rangedCondition(player, text) {
  const bow = owns(player, ITEM.TRAINING_BOW);
  const arrows = owns(player, ITEM.TRAINING_ARROWS);
  if (/past 30 minutes/i.test(text)) return onClaimCooldown(player);
  if (/does not have a training bow or arrows/i.test(text)) return !bow && !arrows;
  if (/does not have a training bow .*but has arrows/i.test(text)) return !bow && arrows;
  if (/does not have training arrows .*but has a training bow/i.test(text)) return !arrows && bow;
  if (/inventory is full/i.test(text)) return freeSlots(player) < rangedSlotsNeeded(player);
  if (/has room in their inventory/i.test(text)) return freeSlots(player) >= rangedSlotsNeeded(player);
  return null;
}

function magicCondition(player, text) {
  const airBank = banked(player, ITEM.AIR_RUNE);
  const airCarried = carried(player, ITEM.AIR_RUNE) || worn(player, ITEM.AIR_RUNE);
  if (/at least one air rune in the bank/i.test(text)) return airBank;
  if (/no air runes in the bank but at least 1/i.test(text)) return !airBank && airCarried;
  if (/no space in the inventory to receive air runes/i.test(text)) return freeSlots(player) === 0;
  if (/no air runes in the bank or inventory and has inventory space/i.test(text)) {
    return !airBank && !airCarried && freeSlots(player) > 0;
  }
  if (/before completing rune mysteries/i.test(text)) return !questComplete(player, "Rune Mysteries");
  if (/after completing rune mysteries/i.test(text)) return questComplete(player, "Rune Mysteries");
  return null;
}

function fishingCondition(player, text) {
  const net = carried(player, ITEM.SMALL_FISHING_NET);
  if (/inventory space and no small fishing net/i.test(text)) return freeSlots(player) > 0 && !net;
  if (/holding a small fishing net/i.test(text)) return net;
  if (/hasn't started fishing contest/i.test(text)) return !questStarted(player, "Fishing Contest");
  if (/hasn't started sea slug/i.test(text)) return !questStarted(player, "Sea Slug");
  if (/hasn't started tai bwo wannai trio/i.test(text)) return !questStarted(player, "Tai Bwo Wannai Trio");
  const told = !questStarted(player, "Sea Slug") || !questStarted(player, "Tai Bwo Wannai Trio");
  if (/was told about a quest/i.test(text)) return told;
  if (/had no quests available/i.test(text)) return !told;
  return null;
}

function miningCondition(player, text) {
  const pick = hasPickaxe(player);
  if (/does not have a pickaxe .*no inventory space/i.test(text)) return !pick && freeSlots(player) === 0;
  if (/does not have a pickaxe/i.test(text)) return !pick && freeSlots(player) > 0;
  if (/has a pickaxe/i.test(text)) return pick;
  return null;
}

function woodsmanCondition(player, text) {
  if (/not carrying an axe/i.test(text)) return !hasAxe(player);
  if (/inventory is full/i.test(text)) return freeSlots(player) === 0;
  if (/not carrying a tinderbox/i.test(text)) return !carried(player, ITEM.TINDERBOX) && freeSlots(player) > 0;
  return null;
}

function smithingCondition(player, text) {
  if (/without a hammer/i.test(text)) return !carried(player, ITEM.HAMMER);
  if (/with a hammer/i.test(text)) return carried(player, ITEM.HAMMER);
  if (/not started the knight's sword/i.test(text)) return !questStarted(player, "The Knight's Sword");
  if (/barbarian smithing/i.test(text)) return false;
  if (/no ore in their inventory/i.test(text)) return !hasNamed(player, /\bore$/i);
  if (/has ore in their inventory/i.test(text)) return hasNamed(player, /\bore$/i);
  return null;
}

function cookingCondition(player, text) {
  if (/hasn't completed cook's assistant/i.test(text)) return !questComplete(player, "Cook's Assistant");
  return null;
}

function answerCondition({ player, npcId, text }) {
  if (!TUTOR_SKILLS.has(npcId)) return null;
  const value = String(text ?? "");
  const answer = CONDITIONS.get(npcId)?.(player, value) ?? null;
  return answer ?? genericCondition(player, npcId, value);
}

/** The Cooking tutor's default transcript is the free-to-play one. */
function selectVariant({ npcId }) {
  return npcId === NPC.COOKING ? "dialogue-on-members-worlds" : null;
}

// --- Hand-outs.

/** Receive actions ("30 air runes", "a bronze pickaxe") and give-messages. */
function handleAction(event) {
  const { player, npcId, step } = event;
  if (!TUTOR_SKILLS.has(npcId) || !step) return;
  const text = String(event.text ?? step.text ?? "");
  // Message steps are emitted twice; act on the kind:"message" one so the text still shows.
  if (step.type === "message" && event.kind !== "message") return;
  if (step.type === "action" && step.action !== "receive") return;

  if (npcId === NPC.MELEE) {
    if (/training sword and shield/i.test(text)) {
      give(player, ITEM.TRAINING_SWORD);
      give(player, ITEM.TRAINING_SHIELD);
    } else if (/gives you a training shield/i.test(text)) give(player, ITEM.TRAINING_SHIELD);
    else if (/gives you a training sword/i.test(text)) give(player, ITEM.TRAINING_SWORD);
    else if (/give back you training (sword|shield)/i.test(text)) {
      const itemId = /sword/i.test(text) ? ITEM.TRAINING_SWORD : ITEM.TRAINING_SHIELD;
      player.getInventory().deleteNumber(itemId, 1);
    }
  } else if (npcId === NPC.RANGED) {
    if (/training shortbow and 25 arrows/i.test(text)) {
      give(player, ITEM.TRAINING_BOW);
      give(player, ITEM.TRAINING_ARROWS, TRAINING_ARROW_COUNT);
      claimed(player);
    } else if (/gives you a training shortbow/i.test(text)) {
      give(player, ITEM.TRAINING_BOW);
      claimed(player);
    } else if (/gives you 25 training arrows/i.test(text)) {
      give(player, ITEM.TRAINING_ARROWS, TRAINING_ARROW_COUNT);
      claimed(player);
    } else if (/give back you training (bow|arrows)/i.test(text)) {
      const itemId = /bow/i.test(text) ? ITEM.TRAINING_BOW : ITEM.TRAINING_ARROWS;
      player.getInventory().deleteNumber(itemId, player.getInventory().getAmount(itemId));
    }
  } else if (npcId === NPC.MAGIC) {
    if (step.action === "receive") handleRuneReceive(player, text);
    else if (/gives you 30 mind runes/i.test(text) && gaveAir.has(player)) {
      // The transcript has no "both" claim; say both hand-outs.
      event.handled = true;
      player.sendMessage(text);
      player.sendMessage(`Mikasi gives you ${RUNE_COUNT} air runes.`);
    }
  } else if (npcId === NPC.MINING && /bronze pickaxe/i.test(text)) give(player, ITEM.BRONZE_PICKAXE);
  else if (npcId === NPC.WOODSMAN && /bronze axe/i.test(text)) give(player, ITEM.BRONZE_AXE);
  else if (npcId === NPC.MASTER_SMITHING && /gives you a hammer/i.test(text)) give(player, ITEM.HAMMER);
}

/**
 * A claim with no runes at all and two free slots plays the "only one space" variant
 * (the transcript lists no both-runes claim); the second slot then takes the air runes.
 */
function handleRuneReceive(player, text) {
  if (/air runes/i.test(text)) {
    give(player, ITEM.AIR_RUNE, RUNE_COUNT);
  } else if (/mind runes/i.test(text)) {
    give(player, ITEM.MIND_RUNE, RUNE_COUNT);
    if (!owns(player, ITEM.AIR_RUNE) && freeSlots(player) > 0) {
      give(player, ITEM.AIR_RUNE, RUNE_COUNT);
      gaveAir.add(player);
    }
  } else {
    return;
  }
  claimed(player);
}

/** Hand-outs the transcript only implies through the condition that was chosen. */
function handleConditionChosen({ player, npcId, text }) {
  const value = String(text ?? "");
  if (npcId === NPC.FISHING && /inventory space and no small fishing net/i.test(value)) give(player, ITEM.SMALL_FISHING_NET);
  if (npcId === NPC.WOODSMAN && /not carrying a tinderbox/i.test(value)) give(player, ITEM.TINDERBOX);
}

/** Drop the "no room for air runes" line when the air runes were handed out after all. */
function handleLine(event) {
  if (event.npcId !== NPC.MAGIC || !gaveAir.has(event.player)) return;
  if (/give you some air runes, come back/i.test(event.text)) event.skip = true;
}

// --- Claim.

function playVariant(player, npc, npcId, variant) {
  pluginApi.emitCustomEvent("npc-dialogue:start", { player, npc, npcId, variant, handled: false });
}

function npcSays(player, npcId, text) {
  const chain = new core.DialogueChainBuilder();
  chain.add(new core.NpcDialogue(0, npcId, text));
  chain.add(new core.ActionDialogue(1, { execute: () => player.getPacketSender().sendInterfaceRemoval() }));
  player.getDialogueManager().startDialogues(chain);
}

function claimArrows({ player, npc, npcId }) {
  if (!onClaimCooldown(player) && owns(player, ITEM.TRAINING_BOW) && owns(player, ITEM.TRAINING_ARROWS)) {
    // ponytail: the transcript has no line for owning both; this one is unverified against live.
    npcSays(player, npcId, "You already have a training bow and training arrows. Save some for the other adventurers.");
    return true;
  }
  playVariant(player, npc, npcId, "claiming-arrows");
  return true;
}

/** Which claim transcript plays, by where the player's mind and air runes are. */
function runeClaimVariant(player) {
  if (onClaimCooldown(player)) return "claim-dialogue-during-the-30-minute-cooldown";
  if (banked(player, ITEM.MIND_RUNE)) return "claim-dialogue-with-at-least-one-mind-rune-in-the-bank";
  if (carried(player, ITEM.MIND_RUNE) || worn(player, ITEM.MIND_RUNE)) {
    return "claim-dialogue-with-no-mind-runes-in-the-bank-and-at-least-one-in-the-inventory";
  }
  if (freeSlots(player) === 0) return "claim-dialogue-with-no-mind-runes-in-the-bank-or-inventory-but-no-inventory-space";
  if (banked(player, ITEM.AIR_RUNE)) {
    return "claim-dialogue-with-no-mind-runes-in-the-bank-or-inventory-with-an-open-inventory-space-if-there-is-at-least-one-air-rune-in-the-bank";
  }
  if (carried(player, ITEM.AIR_RUNE) || worn(player, ITEM.AIR_RUNE)) {
    return "claim-dialogue-with-no-mind-runes-in-the-bank-or-inventory-with-an-open-inventory-space-if-there-are-no-air-runes-in-the-bank-but-at-least-1-in-the-player-s-inventory";
  }
  return "claim-dialogue-with-no-mind-runes-in-the-bank-or-inventory-with-an-open-inventory-space-with-only-one-inventory-space-open-for-mind-runes";
}

function claimRunes({ player, npc, npcId }) {
  gaveAir.delete(player);
  playVariant(player, npc, npcId, runeClaimVariant(player));
  return true;
}

// --- Ammo pickup toggle.

/** "Can you toggle my ammo to equip when I pick it up please?" on the Ranged combat tutor. */
function handleAmmoToggleChoice({ player, npcId, option }) {
  if (npcId !== NPC.RANGED) return;
  if (option === "Automatically equip it.") player.setAttribute(AUTO_EQUIP_ATTRIBUTE, true);
  else if (option === "Place it in my inventory.") player.setAttribute(AUTO_EQUIP_ATTRIBUTE, false);
}

/** With the toggle on, ground ammo matching the worn ammo slot stacks there, not in the bag. */
function autoEquipPickedUpAmmo(event) {
  const player = event.player;
  if (player?.getAttribute?.(AUTO_EQUIP_ATTRIBUTE) !== true) return;
  const equipment = player.getEquipment();
  const worn = equipment.get(core.Equipment.AMMUNITION_SLOT);
  if (!worn || worn.getId() !== event.groundItemId) return;
  const item = event.groundItem?.getItem?.();
  if (!item || item.getAmount() <= 0) return;
  core.ItemOnGroundManager.deregister(event.groundItem);
  worn.incrementAmountBy(item.getAmount());
  equipment.refreshItems();
  core.Sounds.sendSound(player, core.Sound.PICK_UP_ITEM);
  player.getLastItemPickup?.().reset?.();
  event.handled = true;
}

// --- Using items on the tutors.

function handleItemOnNpc(event) {
  const npcId = event.target.getId?.();
  const giveBack = {
    [NPC.MELEE]: {
      [ITEM.TRAINING_SWORD]: "using-items-on-melee-combat-tutor-training-sword",
      [ITEM.TRAINING_SHIELD]: "using-items-on-melee-combat-tutor-training-shield",
      other: "using-items-on-melee-combat-tutor-any-other-item",
    },
    [NPC.RANGED]: {
      [ITEM.TRAINING_BOW]: "using-items-on-ranged-combat-tutor-training-bow",
      [ITEM.TRAINING_ARROWS]: "using-items-on-ranged-combat-tutor-training-arrows",
      other: "using-items-on-ranged-combat-tutor-any-other-item",
    },
  }[npcId];
  if (!giveBack) return;
  playVariant(event.player, event.target, npcId, giveBack[event.itemId] ?? giveBack.other);
  event.handled = true;
}

module.exports = {
  name: "Tutors",
  register(api) {
    init(api);
    api.persistAttribute(CLAIM_ATTRIBUTE);
    api.persistAttribute(AUTO_EQUIP_ATTRIBUTE);
    api.onNpcDialogueVariant(selectVariant);
    api.onNpcDialogueCondition(answerCondition);
    api.onCustomEvent("npc-dialogue:action", handleAction);
    api.onCustomEvent("npc-dialogue:condition", handleConditionChosen);
    api.onCustomEvent("npc-dialogue:line", handleLine);
    api.onCustomEvent("npc-dialogue:choice", handleAmmoToggleChoice);
    api.onGroundItemPickup(autoEquipPickedUpAmmo);
    api.onNpcInteraction("Ranged combat tutor", { Claim: claimArrows });
    api.onNpcInteraction("Magic combat tutor", { Claim: claimRunes });
    api.onItemOnNpc(handleItemOnNpc);
  },
};
