/**
 * Family Crest (members).
 *
 * The words come from the "Family Crest" transcript page. Dimintheis, Caleb, Avan
 * (as "Man", id 385), Boot, Johnathon and the Gem trader are indexed, so this plugin
 * supplies the by-stage variant selector, the prose-condition answers, the start
 * hook and the crest hand-in completion action. Stage machine (varp 148) ported from
 * xrsps: 1 Dimintheis, 2 Caleb, 3 Caleb's piece, 4 seeking Avan, 5 gem trader,
 * 6 Avan, 7 Boot, 8 Avan's piece, 9 Johnathon, 10 cured, 11 complete.
 *
 * Ported interactions: crest-piece assembly (item on item), antipoison on Johnathon,
 * mining perfect gold (object 11371), the fish/jewellery exchanges and the stage
 * transitions driven by the transcript's choice/condition/message steps. Chronozon's
 * four Blast spells print the wiki weakening message (the "returns to full health"
 * gate is not simulated). The Witchaven lever/doors puzzle (aux varp 149) and the
 * post-quest gauntlet enchantment are not wired.
 */
module.exports = function registerFamilyCrestQuest(api) {
  const { Skill, CombatType, ItemIdentifiers, NpcIdentifiers, ObjectIdentifiers } = api.core;
  const { registerQuest, refreshQuestList } = require("../QuestRuntime");

  const PAGE = "Family Crest";

  const VARP_FAMILY_CREST = 148;

  const STAGE_SPOKEN_DIMINTHEIS = 1;
  const STAGE_SPOKEN_CALEB = 2;
  const STAGE_CALEB_PIECE = 3;
  const STAGE_SEEKING_AVAN = 4;
  const STAGE_SPOKEN_GEM_TRADER = 5;
  const STAGE_SPOKEN_AVAN = 6;
  const STAGE_SPOKEN_BOOT = 7;
  const STAGE_AVAN_PIECE = 8;
  const STAGE_SPOKEN_JOHNATHON = 9;
  const STAGE_CURED_JOHNATHON = 10;
  const STAGE_COMPLETE = 11;

  const START_HOOK = "quest:family-crest:start";
  /** "Congratulations! Quest complete!" in the-crest-reassembled-talking-to-dimintheis. */
  const COMPLETE_ACTION_ID = "QH4WTh";
  const WITCHAVEN_GOLD_ROCK_REGION_X = 42;
  const WITCHAVEN_GOLD_ROCK_REGION_Y = 151;

  // Choice texts (the transcript dump gives these options no ids) and the message /
  // condition step ids that carry the stage transitions or item hand-ins.
  const CALEB_FISH_TASK_CHOICE = "ok, i will get those";
  const CALEB_BROTHERS_CHOICE = "what happened to the rest of it";
  const GEM_TRADER_AVAN_CHOICE = "avan fitzharmon";
  const AVAN_INTRO_CHOICE = "looking for a man named avan";
  const BOOT_PERFECT_GOLD_CHOICE = "high quality gold";
  const CALEB_FISH_EXCHANGE_MESSAGE_ID = "1xC7CR";
  const CALEB_PIECE_RETURN_MESSAGE_ID = "OvmzYQ";
  const AVAN_JEWELLERY_MESSAGE_ID = "S9wqPO";
  const JOHNATHON_INTRO_MESSAGE_ID = "gvVeH_";
  const CALEB_AVAN_CONDITION_ID = "wAM0xw";

  // Spell ids from CombatSpells.ts; Chronozon's weakening is per element.
  const BLAST_SPELL_ELEMENTS = new Map([
    [1172, "wind"],
    [1175, "water"],
    [1177, "earth"],
    [1181, "fire"],
  ]);
  const weakenedByPlayer = new WeakMap();

  const DIMINTHEIS_NPC_IDS = new Set([NpcIdentifiers.DIMINTHEIS, NpcIdentifiers.DIMINTHEIS_2]);
  const CALEB_NPC_IDS = new Set([NpcIdentifiers.CALEB, NpcIdentifiers.CALEB_2]);
  const AVAN_NPC_IDS = new Set([NpcIdentifiers.MAN, NpcIdentifiers.AVAN, NpcIdentifiers.AVAN_2]);
  const JOHNATHON_NPC_IDS = new Set([NpcIdentifiers.JOHNATHON, NpcIdentifiers.JOHNATHON_2]);

  const CALEB_CREST = ItemIdentifiers.CREST_PART;
  const AVAN_CREST = ItemIdentifiers.CREST_PART_2;
  const JOHNATHON_CREST = ItemIdentifiers.CREST_PART_3;
  const CREST_PARTS = [CALEB_CREST, AVAN_CREST, JOHNATHON_CREST];
  const FAMILY_CREST = ItemIdentifiers.FAMILY_CREST;
  const PERFECT_RING = ItemIdentifiers.PERFECT_RING;
  const PERFECT_NECKLACE = ItemIdentifiers.PERFECT_NECKLACE;

  const FISH = [ItemIdentifiers.SHRIMPS, ItemIdentifiers.SALMON, ItemIdentifiers.TUNA, ItemIdentifiers.BASS, ItemIdentifiers.SWORDFISH];

  const ANTIPOISONS = new Set([
    ItemIdentifiers.ANTIPOISON_1_, ItemIdentifiers.ANTIPOISON_2_, ItemIdentifiers.ANTIPOISON_3_, ItemIdentifiers.ANTIPOISON_4_,
    ItemIdentifiers.SUPERANTIPOISON_1_, ItemIdentifiers.SUPERANTIPOISON_2_, ItemIdentifiers.SUPERANTIPOISON_3_, ItemIdentifiers.SUPERANTIPOISON_4_,
    ItemIdentifiers.SANFEW_SERUM_1_, ItemIdentifiers.SANFEW_SERUM_2_, ItemIdentifiers.SANFEW_SERUM_3_, ItemIdentifiers.SANFEW_SERUM_4_,
  ]);

  const PICKAXES = new Set([
    ItemIdentifiers.BRONZE_PICKAXE, ItemIdentifiers.IRON_PICKAXE, ItemIdentifiers.STEEL_PICKAXE,
    ItemIdentifiers.BLACK_PICKAXE, ItemIdentifiers.MITHRIL_PICKAXE, ItemIdentifiers.ADAMANT_PICKAXE,
    ItemIdentifiers.RUNE_PICKAXE,
  ]);

  const page = (p, variant) => ({ page: p, variant });
  const has = (player, itemId, quantity = 1) => player.getInventory().getAmount(itemId) >= quantity;

  let quest;

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage === 0) {
      return [
        "I can start this quest by speaking to <col=800000>Dimintheis</col> in south-east Varrock.",
        "",
        "I will need level 40 Mining, Smithing and Crafting, and level 59 Magic.",
      ];
    }
    if (stage >= STAGE_COMPLETE) {
      return ["<str>I restored the Fitzharmon family crest.</str>", "", "<col=ff0000>QUEST COMPLETE!</col>"];
    }
    const lines = ["<str>I agreed to restore the Fitzharmon family crest.</str>", ""];
    if (stage === STAGE_SPOKEN_DIMINTHEIS) lines.push("I should find <col=800000>Caleb</col>, a chef beyond White Wolf Mountain.");
    else if (stage === STAGE_SPOKEN_CALEB) lines.push("Caleb needs cooked shrimp, salmon, tuna, bass and swordfish.");
    else if (stage === STAGE_CALEB_PIECE) lines.push("I have Caleb's piece. I should ask him where his brothers went.");
    else if (stage === STAGE_SEEKING_AVAN) lines.push("A trader in <col=800000>Al Kharid</col> may know where Avan is.");
    else if (stage === STAGE_SPOKEN_GEM_TRADER) lines.push("I should find <col=800000>Avan</col> near the Al Kharid mine.");
    else if (stage === STAGE_SPOKEN_AVAN) lines.push("I should ask <col=800000>Boot</col> in the Dwarven Mine about perfect gold.");
    else if (stage === STAGE_SPOKEN_BOOT) lines.push("I need a perfect ruby ring and necklace for Avan.");
    else if (stage === STAGE_AVAN_PIECE) lines.push("I should cure <col=800000>Johnathon</col> at the Jolly Boar Inn.");
    else if (stage === STAGE_SPOKEN_JOHNATHON) lines.push("Johnathon needs a dose of poison cure.");
    else if (stage === STAGE_CURED_JOHNATHON) lines.push("I must weaken Chronozon with all four Blast spells, kill him, and restore the crest.");
    return lines;
  }

  function grantReward(player) {
    // Family Crest's listed reward is the gauntlets (granted by registerQuest); no XP.
  }

  function selectVariant({ npcId, player }) {
    const stage = quest.getStage(player);

    if (DIMINTHEIS_NPC_IDS.has(npcId)) {
      if (stage >= STAGE_COMPLETE) return page("Dimintheis", "standard-dialogue-after-completing-family-crest");
      if (has(player, FAMILY_CREST)) return page(PAGE, "the-crest-reassembled-talking-to-dimintheis");
      if (stage >= STAGE_CALEB_PIECE) return page(PAGE, "starting-off-dimintheis-talking-to-dimintheis-again-after-obtaining-a-crest-piece");
      if (stage >= STAGE_SPOKEN_DIMINTHEIS) return page(PAGE, "starting-off-dimintheis-talking-to-dimintheis-again");
      return page(PAGE, "starting-off-dimintheis");
    }

    if (CALEB_NPC_IDS.has(npcId)) {
      if (stage >= STAGE_COMPLETE) return page(PAGE, "post-quest-dialogue-talking-to-caleb-after-the-quest");
      if (has(player, FAMILY_CREST)) return page(PAGE, "caleb-talking-to-caleb-after-assembling-the-family-crest");
      if (stage >= STAGE_CALEB_PIECE) return page(PAGE, "caleb-talking-to-caleb-again-after-obtaining-the-first-crest-piece");
      if (stage >= STAGE_SPOKEN_CALEB) return page(PAGE, "caleb-talking-to-caleb-again");
      if (stage >= STAGE_SPOKEN_DIMINTHEIS) return page(PAGE, "caleb");
      return null;
    }

    if (npcId === NpcIdentifiers.GEM_TRADER && stage === STAGE_SEEKING_AVAN) {
      return page(PAGE, "avan-talking-to-the-gem-trader");
    }

    if (AVAN_NPC_IDS.has(npcId)) {
      if (stage >= STAGE_COMPLETE) return page(PAGE, "post-quest-dialogue-talking-to-avan-after-the-quest");
      if (stage >= STAGE_AVAN_PIECE) return page(PAGE, "avan-talking-to-avan-after-getting-his-crest-piece");
      if (stage >= STAGE_SPOKEN_BOOT) {
        return page(PAGE, has(player, PERFECT_RING) && has(player, PERFECT_NECKLACE)
          ? "avan-talking-to-avan-after-talking-to-boot-if-the-player-has-the-jewellery"
          : "avan-talking-to-avan-after-talking-to-boot-if-the-player-has-not-made-the-jewellery");
      }
      if (stage >= STAGE_SPOKEN_AVAN) return page(PAGE, "avan-talking-to-avan-talking-to-avan-again");
      if (stage >= STAGE_SPOKEN_GEM_TRADER) return page(PAGE, "avan-talking-to-avan");
      if (stage >= STAGE_SEEKING_AVAN) return page(PAGE, "avan-talking-to-avan-man-before-talking-to-the-gem-trader");
      return null;
    }

    if (npcId === NpcIdentifiers.BOOT && stage === STAGE_SPOKEN_AVAN) {
      return page(PAGE, "avan-boot");
    }

    if (JOHNATHON_NPC_IDS.has(npcId)) {
      if (stage >= STAGE_COMPLETE) return page(PAGE, "post-quest-dialogue-talking-to-johnathon-after-the-quest");
      if (stage >= STAGE_CURED_JOHNATHON) return page(PAGE, "johnathon-talking-to-johnathon-again-2");
      if (stage >= STAGE_SPOKEN_JOHNATHON) return page(PAGE, "johnathon-talking-to-johnathon-again");
      if (stage >= STAGE_AVAN_PIECE) return page(PAGE, "johnathon");
      return null;
    }

    return null;
  }

  function answerCondition({ player, text }) {
    const value = String(text).toLowerCase();
    const stage = quest.getStage(player);
    if (value.includes("lacks one or more requirements")) return false;
    if (value.includes("does not have all the fish")) return !FISH.every((id) => has(player, id));
    if (value.includes("has all the fish")) return FISH.every((id) => has(player, id));
    if (value.includes("before finding avan")) return stage < STAGE_SEEKING_AVAN;
    if (value.includes("player has the first piece")) return has(player, CALEB_CREST);
    if (value.includes("player has lost the crest piece")) return !has(player, CALEB_CREST) && !has(player, FAMILY_CREST);
    if (value.includes("player has all the crest pieces")) return CREST_PARTS.every((id) => has(player, id));
    if (value.includes("player has lost avan's crest piece")) return !has(player, AVAN_CREST) && !has(player, FAMILY_CREST);
    if (value.includes("player has lost the fragment")) return !has(player, JOHNATHON_CREST) && !has(player, FAMILY_CREST);
    if (value.includes("crest isn't assembled")) return !has(player, FAMILY_CREST);
    if (value.includes("crest is assembled")) return has(player, FAMILY_CREST);
    return null;
  }

  function handleStartHook({ player, npcId, hook }) {
    if (!DIMINTHEIS_NPC_IDS.has(npcId) || hook !== START_HOOK) return;
    if (quest.getStage(player) < STAGE_SPOKEN_DIMINTHEIS) quest.setStage(player, STAGE_SPOKEN_DIMINTHEIS);
  }

  /** The quest choices the transcript dump left without an id, matched on text. */
  function handleChoice({ player, npcId, option }) {
    const stage = quest.getStage(player);
    const text = String(option ?? "").toLowerCase();
    if (CALEB_NPC_IDS.has(npcId)) {
      if (stage === STAGE_SPOKEN_DIMINTHEIS && text.includes(CALEB_FISH_TASK_CHOICE)) {
        quest.setStage(player, STAGE_SPOKEN_CALEB);
      } else if (stage === STAGE_CALEB_PIECE && text.includes(CALEB_BROTHERS_CHOICE)) {
        quest.setStage(player, STAGE_SEEKING_AVAN);
      }
      return;
    }
    if (npcId === NpcIdentifiers.GEM_TRADER && stage === STAGE_SEEKING_AVAN && text.includes(GEM_TRADER_AVAN_CHOICE)) {
      quest.setStage(player, STAGE_SPOKEN_GEM_TRADER);
      return;
    }
    if (AVAN_NPC_IDS.has(npcId) && stage === STAGE_SPOKEN_GEM_TRADER && text.includes(AVAN_INTRO_CHOICE)) {
      quest.setStage(player, STAGE_SPOKEN_AVAN);
      return;
    }
    if (npcId === NpcIdentifiers.BOOT && stage === STAGE_SPOKEN_AVAN && text.includes(BOOT_PERFECT_GOLD_CHOICE)) {
      quest.setStage(player, STAGE_SPOKEN_BOOT);
    }
  }

  /** Caleb's "Before finding Avan" branch tells the player where Avan went. */
  function handleCondition({ player, stepId }) {
    if (stepId !== CALEB_AVAN_CONDITION_ID) return;
    if (quest.getStage(player) === STAGE_CALEB_PIECE) quest.setStage(player, STAGE_SEEKING_AVAN);
  }

  /** The crest pieces combine on each other once all three are held. */
  function handleItemOnItem(event) {
    const ids = [event.usedItemId, event.usedWithItemId];
    if (!ids.some((id) => CREST_PARTS.includes(id))) return;
    const { player } = event;
    if (!CREST_PARTS.every((id) => has(player, id))) {
      player.sendMessage("You still need one more piece of the crest.");
      event.handled = true;
      return;
    }
    for (const id of CREST_PARTS) player.getInventory().deleteNumber(id, 1);
    player.getInventory().adds(FAMILY_CREST, 1);
    player.sendMessage("You have restored the Family Crest.");
    event.handled = true;
  }

  /** Cure Johnathon with any antipoison. */
  function handleItemOnNpc(event) {
    if (!ANTIPOISONS.has(event.itemId)) return;
    if (!JOHNATHON_NPC_IDS.has(event.npcId ?? event.target?.getId?.())) return;
    const { player } = event;
    if (quest.getStage(player) !== STAGE_SPOKEN_JOHNATHON) {
      player.sendMessage("Johnathon does not need that now.");
      event.handled = true;
      return;
    }
    player.getInventory().deleteNumber(event.itemId, 1);
    quest.setStage(player, STAGE_CURED_JOHNATHON);
    player.sendMessage("Johnathon drinks the potion and is completely cured.");
    event.handled = true;
  }

  /** Mine perfect gold from the Witchaven rock once Boot has told you where it is. */
  function handleObjectInteraction(event) {
    if (event.objectId !== ObjectIdentifiers.GOLD_ROCKS_2) return;
    const { x, y, z } = event.location ?? {};
    if (z !== 0 || Math.floor(x / 64) !== WITCHAVEN_GOLD_ROCK_REGION_X ||
        Math.floor(y / 64) !== WITCHAVEN_GOLD_ROCK_REGION_Y) return;
    const option = String(event.definition?.getInteractions?.()?.[event.clickType - 1] ?? "").toLowerCase();
    if (!option.includes("mine")) return;
    const { player } = event;
    if (quest.getStage(player) < STAGE_SPOKEN_BOOT) {
      player.sendMessage("This gold does not look special to you.");
      event.handled = true;
      return;
    }
    if (player.getSkillManager().getCurrentLevel(Skill.MINING) < 40) {
      player.sendMessage("You need level 40 Mining to mine this rock.");
    } else if (![...PICKAXES].some((id) => has(player, id))) {
      player.sendMessage("You need a pickaxe to mine this rock.");
    } else {
      player.getInventory().adds(ItemIdentifiers.PERFECT_GOLD_ORE, 1);
      player.sendMessage("You mine some perfect gold ore.");
    }
    event.handled = true;
  }

  /** Chronozon drops Johnathon's crest piece once cured. */
  function handleNpcDeath({ killer, npcId }) {
    if (!killer || npcId !== NpcIdentifiers.CHRONOZON) return;
    if (quest.getStage(killer) !== STAGE_CURED_JOHNATHON) return;
    if (has(killer, JOHNATHON_CREST) || has(killer, FAMILY_CREST)) return;
    killer.getInventory().adds(JOHNATHON_CREST, 1);
    killer.sendMessage("You tear Johnathon's crest piece from the demon's claws.");
  }

  /**
   * Action/message steps: the item exchanges and the final completion. Hand-ins leave
   * `handled` false so the transcript's own message still prints.
   */
  function handleDialogueAction({ player, npcId, stepId }) {
    switch (stepId) {
      case CALEB_FISH_EXCHANGE_MESSAGE_ID:
        if (quest.getStage(player) !== STAGE_SPOKEN_CALEB || !FISH.every((id) => has(player, id))) return;
        for (const id of FISH) player.getInventory().deleteNumber(id, 1);
        if (!has(player, CALEB_CREST)) player.getInventory().adds(CALEB_CREST, 1);
        quest.setStage(player, STAGE_CALEB_PIECE);
        return;
      case CALEB_PIECE_RETURN_MESSAGE_ID:
        if (!has(player, CALEB_CREST) && !has(player, FAMILY_CREST)) player.getInventory().adds(CALEB_CREST, 1);
        return;
      case AVAN_JEWELLERY_MESSAGE_ID:
        if (quest.getStage(player) !== STAGE_SPOKEN_BOOT) return;
        if (!has(player, PERFECT_RING) || !has(player, PERFECT_NECKLACE)) return;
        player.getInventory().deleteNumber(PERFECT_RING, 1);
        player.getInventory().deleteNumber(PERFECT_NECKLACE, 1);
        if (!has(player, AVAN_CREST)) player.getInventory().adds(AVAN_CREST, 1);
        quest.setStage(player, STAGE_AVAN_PIECE);
        return;
      case JOHNATHON_INTRO_MESSAGE_ID:
        if (quest.getStage(player) === STAGE_AVAN_PIECE) quest.setStage(player, STAGE_SPOKEN_JOHNATHON);
        return;
      case COMPLETE_ACTION_ID:
        if (!DIMINTHEIS_NPC_IDS.has(npcId) || quest.isComplete(player)) return;
        if (quest.getStage(player) < STAGE_CURED_JOHNATHON) return;
        if (has(player, FAMILY_CREST)) player.getInventory().deleteNumber(FAMILY_CREST, 1);
        quest.complete(player);
        return;
      default:
        return;
    }
  }

  /** The spell behind a player's pending hit (manual casts sit in previousCast). */
  function blastElement(player) {
    const combat = player.getCombat?.();
    const spell = combat?.getSelectedSpell?.() ?? combat?.getPreviousCast?.();
    return BLAST_SPELL_ELEMENTS.get(spell?.spellId?.());
  }

  /**
   * The wiki confirms each of the four Blast spells on Chronozon with "Chronozon
   * weakens...". ponytail: message-only; the wiki's "returns to full health when
   * nearly dead" gate is not simulated so the quest cannot be soft-locked by it.
   */
  function handleNpcHitModify({ npc, hit }) {
    if (npc?.getId?.() !== NpcIdentifiers.CHRONOZON) return;
    if (hit?.getCombatType?.() !== CombatType.MAGIC || hit.isAccurate?.() !== true || hit.getTotalDamage?.() <= 0) return;
    const attacker = hit.getAttacker?.();
    if (attacker?.isPlayer?.() !== true) return;
    const player = attacker.getAsPlayer();
    if (quest.getStage(player) !== STAGE_CURED_JOHNATHON) return;
    const element = blastElement(player);
    if (!element) return;
    let weakened = weakenedByPlayer.get(player);
    if (!weakened) {
      weakened = new Set();
      weakenedByPlayer.set(player, weakened);
    }
    if (weakened.has(element)) return;
    weakened.add(element);
    player.sendMessage("Chronozon weakens...");
  }

  function handleLogin({ player }) {
    refreshQuestList(player);
  }

  quest = registerQuest(api, {
    key: "family_crest",
    name: "Family Crest",
    varpId: VARP_FAMILY_CREST,
    startedValue: STAGE_SPOKEN_DIMINTHEIS,
    completionValue: STAGE_COMPLETE,
    questPoints: 1,
    rewardItemId: ItemIdentifiers.STEEL_GAUNTLETS,
    rewardItemLabel: "Steel gauntlets",
    otherRewards: ["The ability to enchant the gauntlets"],
    buildJournal,
    onReward: grantReward,
  });

  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("npc-dialogue:choice", handleChoice);
  api.onCustomEvent("npc-dialogue:condition", handleCondition);
  api.onCustomEvent("npc-dialogue:action", handleDialogueAction);
  api.onItemOnItem(handleItemOnItem);
  api.onItemOnNpc(handleItemOnNpc);
  api.onObjectInteraction(handleObjectInteraction);
  api.onNpcHitModify(handleNpcHitModify);
  api.onNpcDeath(handleNpcDeath);
  api.onPlayerLogin(handleLogin);
};
