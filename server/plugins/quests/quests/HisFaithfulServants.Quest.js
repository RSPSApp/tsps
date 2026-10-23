/**
 * His Faithful Servants (miniquest, DT2 prerequisite).
 *
 * Quest Helper progression (helpers/miniquests/hisfaithfulservants):
 *   stage 0   talk to the Strange Old Man
 *   stage 2/4 defeat the six Barrows brothers and take the strange icon
 *   stage 6/8 return to the Strange Old Man
 *   complete  the icon is destroyed and the lamp/map are handed over
 *
 * The cache's quest row 3250 uses varbit 14973 ("hfs", varp 3894) and ends at 10.
 * Words come from the canonical "His Faithful Servants" transcript imported from
 * companion PR9 75d42c9589. The Barrows plugin owns the brothers
 * and chest, so the icon is added on its collection-log loot event.
 */
module.exports = function registerHisFaithfulServantsQuest(api) {
  const { DialogueChainBuilder, ItemStatementDialogue, ItemIdentifiers: Items, NpcIdentifiers: Npcs, Skill } = api.core;
  const { registerQuest, startTranscript } = require("../QuestRuntime");

  const VARP_HFS = 3894;
  const VARBIT_HFS = 14973;
  const STAGE_STARTED = 2;
  const STAGE_ICON = 4;
  const STAGE_HANDED_IN = 6;
  const STAGE_DESTROYED = 8;
  const STAGE_COMPLETE = 10;

  const STRANGE_OLD_MAN = Npcs.STRANGE_OLD_MAN;
  const STRANGE_ICON = Items.STRANGE_ICON; // 28130
  const SHATTERED_ICON = 28131; // graphic in "the icon disintegrates" message
  const DUSTY_LAMP = Items.DUSTY_LAMP; // 28132
  const CRYPT_MAP = Items.CRYPT_MAP; // 28133
  const CRUMBLING_TOME = Items.CRUMBLING_TOME; // 4707
  const CRUMBLING_TOME_2 = Items.CRUMBLING_TOME_2; // 15731
  const PRAYER_XP = 20000;

  // Canonical miniquest transcript (companion PR9 / osrsreboxed-db 75d42c9589).
  const PAGE = "His Faithful Servants";
  const INTRO = "starting-out-talking-to-the-strange-old-man";
  const WITHOUT_ICON = "starting-out-talking-to-him-again-without-the-icon";
  const WITH_ICON = "giving-the-strange-icon";
  const GIVEN_ICON_RECOVERY = "giving-the-strange-icon-if-the-player-gives-the-strange-old-man-the-icon";
  const DESTROYED_ICON_RECOVERY = "giving-the-strange-icon-if-the-strange-old-man-destroyed-the-icon";
  const CLAIM_LATER = "giving-the-strange-icon-if-the-player-claims-the-lamp-or-map-later";

  const MESSAGE_GIVE_TOME = "MykpJe";
  const MESSAGE_GIVE_ICON = "UbCs8y";
  const MESSAGE_ICON_DESTROYED = "F5Q98i";
  const MESSAGE_REWARD = "ShNyAX";
  const MESSAGE_CLAIM_BOTH = "QxZGeY";
  const MESSAGE_CLAIM_LAMP = "PSnOhU";
  const MESSAGE_CLAIM_MAP = "I0bAY_";

  const BARROWS_ATTRIBUTE = "barrows";
  // The cache has two server-side reward bits in varp 3894: 14974 hfs_reward_lamp
  // and 14975 barrows_map. Neither the cache nor the pinned helper exposes their
  // polarity/reset contract, so the durable used state is kept here instead of
  // guessing a varbit value. The map key keeps the earlier plugin save.
  const LAMP_USED = "his-faithful-servants:lamp-used";
  const MAP_USED = "his-faithful-servants:crypt-map-studied";
  const iconChestAttempts = new WeakMap();
  let quest;

  const inventory = (player) => player.getInventory();
  const has = (player, itemId) => inventory(player).getAmount(itemId) > 0;
  const banked = (player, itemId) => {
    const banks = player.getBanks?.() ?? (player.getBank ? [player.getBank()] : []);
    return banks.some((bank) => Number(bank?.getAmount?.(itemId) ?? 0) > 0);
  };
  const owns = (player, itemId) => has(player, itemId) || banked(player, itemId);
  const ownsIcon = (player) => owns(player, STRANGE_ICON);
  const ownsTome = (player) => owns(player, CRUMBLING_TOME) || owns(player, CRUMBLING_TOME_2);
  const ownsLamp = (player) => owns(player, DUSTY_LAMP);
  const ownsMap = (player) => owns(player, CRYPT_MAP);
  const used = (player, key) => Number(player.getAttribute(key)) === 1;
  const lampUsed = (player) => used(player, LAMP_USED);
  const mapUsed = (player) => used(player, MAP_USED);

  function questComplete(player, key) {
    const request = { player, key, complete: false };
    api.emitCustomEvent("quest:is-complete", request);
    return request.complete === true;
  }

  function missingRewards(player) {
    const missing = [];
    if (!lampUsed(player) && !ownsLamp(player)) missing.push(DUSTY_LAMP);
    if (!mapUsed(player) && !ownsMap(player)) missing.push(CRYPT_MAP);
    return missing;
  }

  function giveRewards(player, missing) {
    if (player.getInventory().getFreeSlots() < missing.length) {
      player.getInventory().full();
      return false;
    }
    for (const itemId of missing) player.getInventory().adds(itemId, 1);
    return true;
  }

  function play(player, variant) {
    return startTranscript(api, player, STRANGE_OLD_MAN, PAGE, variant);
  }

  function selectVariant({ npcId, player }) {
    if (npcId !== STRANGE_OLD_MAN) return null;
    const stage = quest.getStage(player);
    if (stage >= STAGE_STARTED && stage < STAGE_HANDED_IN) {
      return { page: PAGE, variant: ownsIcon(player) ? WITH_ICON : WITHOUT_ICON };
    }
    if (stage === STAGE_HANDED_IN) return { page: PAGE, variant: GIVEN_ICON_RECOVERY };
    if (stage === STAGE_DESTROYED) return { page: PAGE, variant: DESTROYED_ICON_RECOVERY };
    if (stage >= STAGE_COMPLETE && missingRewards(player).length > 0) {
      return { page: PAGE, variant: CLAIM_LATER };
    }
    if (stage === 0 && questComplete(player, "priest_in_peril")) {
      return { page: PAGE, variant: INTRO };
    }
    return null;
  }

  function answerCondition({ npcId, player, text }) {
    if (npcId !== STRANGE_OLD_MAN) return null;
    const value = String(text).toLowerCase();
    if (value.includes("does not have the crumbling tome")) return !ownsTome(player);
    if (value.includes("has the crumbling tome")) return ownsTome(player);
    const missing = missingRewards(player);
    if (value.includes("has not claimed the lamp nor the map")) {
      return missing.includes(DUSTY_LAMP) && missing.includes(CRYPT_MAP);
    }
    if (value.includes("has not claimed the lamp")) return missing.includes(DUSTY_LAMP);
    if (value.includes("has not claimed the map")) return missing.includes(CRYPT_MAP);
    return null;
  }

  function handleLine(event) {
    if (event.npcId !== STRANGE_OLD_MAN || event.text !== "It's time.") return;
    event.before = () => {
      if (quest.getStage(event.player) !== 0 || !questComplete(event.player, "priest_in_peril")) return;
      quest.setStage(event.player, STAGE_STARTED);
      event.player.sendMessage("You've started a new miniquest: <col=081190>His Faithful Servants</col>");
    };
  }

  function handleNpcTalk(event) {
    const stage = quest.getStage(event.player);
    if (stage === 0) {
      return questComplete(event.player, "priest_in_peril") ? play(event.player, INTRO) : false;
    }
    if (stage >= STAGE_STARTED && stage < STAGE_HANDED_IN) {
      return play(event.player, ownsIcon(event.player) ? WITH_ICON : WITHOUT_ICON);
    }
    if (stage === STAGE_HANDED_IN) return play(event.player, GIVEN_ICON_RECOVERY);
    if (stage === STAGE_DESTROYED) return play(event.player, DESTROYED_ICON_RECOVERY);
    if (stage >= STAGE_COMPLETE && missingRewards(event.player).length > 0) {
      return play(event.player, CLAIM_LATER);
    }
    return false;
  }

  function handleDialogueAction(event) {
    if (event.npcId !== STRANGE_OLD_MAN) return;
    const { player, stepId } = event;

    if (stepId === MESSAGE_GIVE_TOME) {
      if (ownsTome(player)) return;
      if (player.getInventory().getFreeSlots() < 1) {
        player.getInventory().full();
        event.handled = true;
        event.end = true;
        return;
      }
      player.getInventory().adds(CRUMBLING_TOME, 1);
      event.box = { items: [CRUMBLING_TOME] };
      return;
    }

    if (stepId === MESSAGE_GIVE_ICON) {
      if (quest.getStage(player) < STAGE_ICON || quest.isComplete(player) || !has(player, STRANGE_ICON)) {
        event.handled = true;
        event.end = true;
        return;
      }
      inventory(player).deleteNumber(STRANGE_ICON, 1);
      quest.setStage(player, STAGE_HANDED_IN);
      event.box = { items: [STRANGE_ICON] };
      return;
    }

    if (stepId === MESSAGE_ICON_DESTROYED) {
      if (quest.getStage(player) < STAGE_HANDED_IN || quest.isComplete(player)) {
        event.handled = true;
        event.end = true;
        return;
      }
      quest.setStage(player, STAGE_DESTROYED);
      event.box = { items: [SHATTERED_ICON] };
      return;
    }

    if (stepId === MESSAGE_REWARD) {
      if (quest.isComplete(player)) {
        event.box = { items: [DUSTY_LAMP, CRYPT_MAP] };
        event.handled = true;
        event.end = true;
        return;
      }
      const missing = missingRewards(player);
      if (!giveRewards(player, missing)) {
        event.handled = true;
        event.end = true;
        return;
      }
      event.box = { items: [DUSTY_LAMP, CRYPT_MAP] };
      quest.complete(player);
      return;
    }

    const claimBox = stepId === MESSAGE_CLAIM_BOTH
      ? [DUSTY_LAMP, CRYPT_MAP]
      : stepId === MESSAGE_CLAIM_LAMP
        ? [DUSTY_LAMP]
        : stepId === MESSAGE_CLAIM_MAP
          ? [CRYPT_MAP]
          : null;
    if (!claimBox) return;
    const missing = missingRewards(player);
    if (!giveRewards(player, missing)) {
      event.handled = true;
      event.end = true;
      return;
    }
    event.box = { items: claimBox };
    if (quest.getStage(player) < STAGE_COMPLETE) {
      if (has(player, STRANGE_ICON)) inventory(player).deleteNumber(STRANGE_ICON, 1);
      quest.complete(player);
    }
  }

  function handleChestLoot(event) {
    const { player } = event;
    if (!player) return;
    const run = player.getAttribute(BARROWS_ATTRIBUTE);
    if (!run?.looted || !Array.isArray(run.killed) || run.killed.length !== 6) return;
    const stage = quest.getStage(player);
    if (stage < STAGE_STARTED || stage >= STAGE_HANDED_IN || ownsIcon(player)) return;
    const chest = Number(run.chests) || 0;
    if (iconChestAttempts.get(player) === chest) return;
    iconChestAttempts.set(player, chest);
    const before = player.getInventory().getAmount(STRANGE_ICON);
    if (player.getInventory().getFreeSlots() < 1) {
      player.getInventory().full();
      return;
    }
    player.getInventory().adds(STRANGE_ICON, 1);
    if (player.getInventory().getAmount(STRANGE_ICON) <= before) return;
    quest.setStage(player, STAGE_ICON);
  }

  function rubLamp(event) {
    if (event.itemId !== DUSTY_LAMP) return false;
    const { player, item, slot } = event;
    if (lampUsed(player)) {
      player.sendMessage("You have already used the dusty lamp.");
      return true;
    }
    if (!has(player, DUSTY_LAMP) || inventory(player).get(slot) !== item) return false;
    api.sendMultiChatboxPrompt(player, "Use the lamp to receive 20,000 Prayer experience?",
      "Yes.", () => {
        if (lampUsed(player) || !has(player, DUSTY_LAMP) || inventory(player).get(slot) !== item) return;
        const before = player.getSkillManager().getExperience(Skill.PRAYER);
        player.getSkillManager().addExperience(Skill.PRAYER, PRAYER_XP, false);
        if (player.getSkillManager().getExperience(Skill.PRAYER) === before) return;
        if (!inventory(player).deleteAtSlot(slot, 1)) return;
        player.setAttribute(LAMP_USED, 1);
        player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(
          new ItemStatementDialogue(0, DUSTY_LAMP, "Your wish has been granted! You have been awarded 20,000 Prayer experience!")));
      }, "No.", () => player.getPacketSender().sendInterfaceRemoval());
    return true;
  }

  function studyMap(event) {
    if (event.itemId !== CRYPT_MAP) return false;
    const { player, item, slot } = event;
    if (mapUsed(player)) {
      player.sendMessage("You have already studied the crypt map.");
      return true;
    }
    if (inventory(player).get(slot) !== item) return false;
    if (!inventory(player).deleteAtSlot(slot, 1)) return false;
    player.setAttribute(MAP_USED, 1);
    api.emitCustomEvent("barrows:minimap-reveal", { player });
    player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(
      new ItemStatementDialogue(0, CRYPT_MAP,
        "It's a map of the Barrows Crypt. You carefully study it and memorise all the details. You then discard it.")));
    return true;
  }

  function preventLampBanking(event) {
    if (event.item?.getId?.() !== DUSTY_LAMP) return;
    event.allow = false;
    event.player.sendMessage("The dusty lamp cannot be placed in the bank.");
  }

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      return [
        "<str>I retrieved the strange icon from the Barrows for the</str>",
        "<str>Strange Old Man, who destroyed it.</str>",
        "<str>He gave me a dusty lamp and a crypt map.</str>",
        "",
        "<col=ff0000>MINIQUEST COMPLETE!</col>",
      ];
    }
    if (stage >= STAGE_HANDED_IN) {
      return ["I should return to the <col=800000>Strange Old Man</col> for my reward."];
    }
    if (stage >= STAGE_ICON) {
      return ["I have the <col=800000>strange icon</col>; I should take it to the",
        "<col=800000>Strange Old Man</col> at the Barrows."];
    }
    if (stage >= STAGE_STARTED) {
      return ["I need to defeat all six <col=800000>Barrows brothers</col> and",
        "search the chest for the <col=800000>strange icon</col>."];
    }
    return [
      "I can start this miniquest by talking to the",
      "<col=800000>Strange Old Man</col> at the Barrows, east of Mort'ton.",
      "",
      "I must have completed <col=800000>Priest in Peril</col>.",
    ];
  }

  api.persistAttribute(LAMP_USED, 0);
  api.persistAttribute(MAP_USED, 0);

  quest = registerQuest(api, {
    key: "his_faithful_servants",
    name: "His Faithful Servants",
    varpId: VARP_HFS,
    varbitId: VARBIT_HFS,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 0,
    scrollItemId: DUSTY_LAMP,
    otherRewards: ["Dusty lamp (20,000 Prayer XP)", "Crypt map"],
    buildJournal,
  });

  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onNpcInteraction("Strange Old Man", { "Talk-to": handleNpcTalk });
  api.onCustomEvent("npc-dialogue:line", handleLine);
  api.onCustomEvent("npc-dialogue:action", handleDialogueAction);
  api.onCustomEvent("collection-log:obtain", handleChestLoot);
  api.onItemAction("Dusty lamp", { Rub: rubLamp });
  api.onItemAction("Crypt map", { Study: studyMap });
  api.onCanBankItem(preventLampBanking);
};
