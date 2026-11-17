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
 * companion PR9 75d42c9589. The Barrows plugin owns the brothers, the chest and the
 * tunnel warnings; this quest refuses the mounds' dig until it is started
 * (barrows:dig) and adds the icon to the chest's loot (barrows:chest-rewards).
 *
 * Timing and packets follow the user's rsprox capture of the whole miniquest
 * (BarrowsMiniQuest.bin, revision 242.1; ticks cited below): see
 * docs/quests/his-faithful-servants/README.md.
 */
module.exports = function registerHisFaithfulServantsQuest(api) {
  const { DialogueChainBuilder, NpcDialogue, StatementDialogue, ItemIdentifiers: Items, NpcIdentifiers: Npcs, Skill } = api.core;
  const { registerQuest, startTranscript } = require("../QuestRuntime");

  const VARP_HFS = 3894;
  const VARBIT_HFS = 14973;
  // The reward bits beside the stage in varp 3894: 1 once used (tick 1077, 1065), and so at login
  // (StrangeOldLockpickBarrows.bin, a finished account: hfs 10, both 1).
  const VARBIT_LAMP_USED = 14974; // hfs_reward_lamp
  const VARBIT_MAP_STUDIED = 14975; // barrows_map
  const STAGE_STARTED = 2;
  const STAGE_ICON = 4;
  const STAGE_HANDED_IN = 6;
  const STAGE_DESTROYED = 8;
  const STAGE_COMPLETE = 10;

  const STRANGE_OLD_MAN = Npcs.STRANGE_OLD_MAN;
  const STRANGE_ICON = Items.STRANGE_ICON; // 28130
  const SHATTERED_ICON = 28131; // barrows_icon_dust, the "icon disintegrates" box (tick 997)
  const DUSTY_LAMP = Items.DUSTY_LAMP; // 28132
  const CRYPT_MAP = Items.CRYPT_MAP; // 28133
  const CRUMBLING_TOME = Items.CRUMBLING_TOME; // 4707
  const CRUMBLING_TOME_2 = Items.CRUMBLING_TOME_2; // 15731
  const PRAYER_XP = 20000;
  /** The spell that destroys the icon (tick 997): snare_impact, then lore_fire_titan_death 30 client cycles on. */
  const DESTROY_SOUNDS = [[3002, 0], [4759, 30]];
  /** found_gem, as the lamp grants its wish (tick 1077). */
  const LAMP_SOUND = 2655;
  /** chathap2: the Strange Old Man's head on his dig refusal (tick 16). */
  const CHATHAP2 = 568;
  /** Tick 16: a spade on a mound before the miniquest is started; the dig doesn't happen. */
  const TALK_FIRST = "You want to dig? Good, good! But we talk first. Talk then dig!";
  /** Tick 1077: a message box (229), not an item box. */
  const LAMP_WISH = "<col=0000ff>Your wish has been granted!</col><br>You have been awarded 20,000 Prayer experience!";

  // Canonical miniquest transcript (companion PR9 / osrsreboxed-db 75d42c9589).
  const PAGE = "His Faithful Servants";
  const INTRO = "starting-out-talking-to-the-strange-old-man";
  const WITHOUT_ICON = "starting-out-talking-to-him-again-without-the-icon";
  const WITH_ICON = "giving-the-strange-icon";
  const GIVEN_ICON_RECOVERY = "giving-the-strange-icon-if-the-player-gives-the-strange-old-man-the-icon";
  const DESTROYED_ICON_RECOVERY = "giving-the-strange-icon-if-the-strange-old-man-destroyed-the-icon";
  const CLAIM_LATER = "giving-the-strange-icon-if-the-player-claims-the-lamp-or-map-later";
  /** The player's acceptance: the miniquest starts as it shows (varbit 0 -> 2 at tick 79). */
  const ACCEPT_LINE = "Okay...";

  const MESSAGE_GIVE_TOME = "MykpJe";
  const MESSAGE_GIVE_ICON = "UbCs8y";
  const MESSAGE_ICON_DESTROYED = "F5Q98i";
  const MESSAGE_REWARD = "ShNyAX";
  const MESSAGE_CLAIM_BOTH = "QxZGeY";
  const MESSAGE_CLAIM_LAMP = "PSnOhU";
  const MESSAGE_CLAIM_MAP = "I0bAY_";

  // Saved use of the two rewards; their varbits are sent from these. The map key keeps the
  // earlier plugin save, and the Barrows plugin reads it for the crypt minimap.
  const LAMP_USED = "his-faithful-servants:lamp-used";
  const MAP_USED = "his-faithful-servants:crypt-map-studied";
  /** The live completion has no jingle, scroll or chat line, only the lamp-and-map box (tick 1007). */
  const QUIET_COMPLETION = { scroll: false, announce: false };
  let quest;

  const inventory = (player) => player.getInventory();
  const has = (player, itemId) => inventory(player).getAmount(itemId) > 0;
  const banked = (player, itemId) => {
    const banks = player.getBanks?.() ?? (player.getBank ? [player.getBank()] : []);
    return banks.some((bank) => Number(bank?.getAmount?.(itemId) ?? 0) > 0);
  };
  const owns = (player, itemId) => has(player, itemId) || banked(player, itemId);
  const ownsIcon = (player) => owns(player, STRANGE_ICON);
  // Wiki transcript: "If the player has the crumbling tome in their inventory".
  const carriesTome = (player) => has(player, CRUMBLING_TOME) || has(player, CRUMBLING_TOME_2);
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

  /** Talking to the Strange Old Man starts the miniquest only after Priest in Peril. */
  const canStart = (player) => quest.getStage(player) === 0 && questComplete(player, "priest_in_peril");

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

  function sendRewardVarbits({ player }) {
    const sender = player.getPacketSender();
    sender.sendVarbit(VARBIT_LAMP_USED, lampUsed(player) ? 1 : 0);
    sender.sendVarbit(VARBIT_MAP_STUDIED, mapUsed(player) ? 1 : 0);
  }

  function play(player, variant) {
    return startTranscript(api, player, STRANGE_OLD_MAN, PAGE, variant);
  }

  /** The variant this stage plays, or null for his ordinary chat. */
  function variantFor(player) {
    const stage = quest.getStage(player);
    // Live asks "Icon?" and, with it carried (tick 991), takes it at once.
    if (stage >= STAGE_STARTED && stage < STAGE_HANDED_IN) return has(player, STRANGE_ICON) ? WITH_ICON : WITHOUT_ICON;
    if (stage === STAGE_HANDED_IN) return GIVEN_ICON_RECOVERY;
    if (stage === STAGE_DESTROYED) return DESTROYED_ICON_RECOVERY;
    if (stage >= STAGE_COMPLETE && missingRewards(player).length > 0) return CLAIM_LATER;
    if (canStart(player)) return INTRO;
    return null;
  }

  function selectVariant({ npcId, player }) {
    if (npcId !== STRANGE_OLD_MAN) return null;
    const variant = variantFor(player);
    return variant ? { page: PAGE, variant } : null;
  }

  function answerCondition({ npcId, player, text }) {
    if (npcId !== STRANGE_OLD_MAN) return null;
    const value = String(text).toLowerCase();
    if (value.includes("does not have the crumbling tome")) return !carriesTome(player);
    if (value.includes("has the crumbling tome")) return carriesTome(player);
    const missing = missingRewards(player);
    if (value.includes("has not claimed the lamp nor the map")) {
      return missing.includes(DUSTY_LAMP) && missing.includes(CRYPT_MAP);
    }
    if (value.includes("has not claimed the lamp")) return missing.includes(DUSTY_LAMP);
    if (value.includes("has not claimed the map")) return missing.includes(CRYPT_MAP);
    return null;
  }

  /** The miniquest starts as the player's "Okay..." shows, with no chat line (tick 79). */
  function handleLine(event) {
    if (event.npcId !== STRANGE_OLD_MAN || event.step?.player !== ACCEPT_LINE) return;
    const playing = event.pages?.[0];
    if (playing?.page !== PAGE || !playing.variants?.includes(INTRO)) return;
    const previous = event.before;
    event.before = () => {
      previous?.();
      if (canStart(event.player)) quest.setStage(event.player, STAGE_STARTED);
    };
  }

  function handleNpcTalk(event) {
    const variant = variantFor(event.player);
    return variant ? play(event.player, variant) : false;
  }

  /** A spade on a brother's mound before the miniquest: his line, and no dig (tick 16). */
  function refuseDig(request) {
    if (!canStart(request.player)) return;
    request.blocked = true;
    request.player.getDialogueManager().startDialogues(new DialogueChainBuilder()
      .add(new NpcDialogue(0, STRANGE_OLD_MAN, TALK_FIRST, undefined, CHATHAP2)));
  }

  function handleDialogueAction(event) {
    if (event.npcId !== STRANGE_OLD_MAN) return;
    const { player, stepId } = event;

    if (stepId === MESSAGE_GIVE_TOME) {
      if (carriesTome(player)) return;
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
      const sender = player.getPacketSender();
      for (const [sound, delay] of DESTROY_SOUNDS) sender.sendSoundEffect(sound, 1, delay, 255);
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
      quest.complete(player, QUIET_COMPLETION);
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
      quest.complete(player, QUIET_COMPLETION);
    }
  }

  /** Inventory slots the chest's loot takes: a stack already held takes none. */
  function slotsForLoot(player, rewards) {
    const inv = inventory(player);
    return rewards.reduce((total, item) => {
      if (item.getDefinition().isStackable()) return total + (inv.getAmount(item.getId()) > 0 ? 0 : 1);
      return total + Math.max(1, item.getAmount());
    }, 0);
  }

  /**
   * The icon is the chest's first reward, in its window with the loot (tick 885), and the stage
   * moves to 4 with it. Wiki: "You MUST have enough inventory space to receive the strange icon when
   * looting the chest" (it is not dropped, and the brothers have to be killed again; it advises six free
   * slots). Ours: the space is a slot left over once the loot itself is in.
   */
  function addIconToLoot({ player, run, rewards }) {
    if (!player || !Array.isArray(rewards)) return;
    if (!Array.isArray(run?.killed) || run.killed.length !== 6) return;
    const stage = quest.getStage(player);
    if (stage < STAGE_STARTED || stage >= STAGE_HANDED_IN || ownsIcon(player)) return;
    if (inventory(player).getFreeSlots() < slotsForLoot(player, rewards) + 1) return;
    rewards.unshift(new api.core.Item(STRANGE_ICON, 1));
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
        player.getSkillManager().addExperience(Skill.PRAYER, PRAYER_XP, true);
        if (player.getSkillManager().getExperience(Skill.PRAYER) === before) return;
        if (!inventory(player).deleteAtSlot(slot, 1)) return;
        player.setAttribute(LAMP_USED, 1);
        player.getPacketSender().sendVarbit(VARBIT_LAMP_USED, 1);
        player.getPacketSender().sendSoundEffect(LAMP_SOUND, 1, 0, 255);
        player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(new StatementDialogue(0, LAMP_WISH)));
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
    player.getPacketSender().sendVarbit(VARBIT_MAP_STUDIED, 1);
    api.emitCustomEvent("barrows:minimap-reveal", { player });
    player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(
      new api.core.ItemStatementDialogue(0, CRYPT_MAP,
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
  api.onCustomEvent("barrows:dig", refuseDig);
  api.onCustomEvent("barrows:chest-rewards", addIconToLoot);
  api.onPlayerLogin(sendRewardVarbits);
  api.onItemAction("Dusty lamp", { Rub: rubLamp });
  api.onItemAction("Crypt map", { Study: studyMap });
  api.onCanBankItem(preventLampBanking);
};
