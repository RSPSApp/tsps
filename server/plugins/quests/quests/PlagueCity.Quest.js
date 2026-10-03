/**
 * Plague City (members).
 *
 * The words come from the "Plague City" transcript page. Edmond, Alrena,
 * Jethick, the Rehnison family, Milli, the Clerk, Bravek and Elena are all
 * indexed, so this plugin selects the variant by stage, answers the prose
 * conditions, completes the quest through Edmond's own action and mixes the
 * hangover cure from the transcript's item recipes.
 *
 * Stages (varp 165): 1 find dwellberries, 2 gas mask, 3 soften the mud, 4-7
 * one to four buckets of water, 8 tunnel open, 9 rope tied, 10 pipe open,
 * 20 shown picture, 21 returned book, 22 spoke to the Rehnisons, 23 spoke to
 * Milli, 24 need clearance, 25 clerk permission, 26 hangover cure, 27 warrant,
 * 28 freed Elena, 29 complete, 30 read scroll.
 *
 * Gaps: the mud/water/spade/rope object actions, the cupboard, the manhole and
 * the cell door are not wired here, so the transcript plays by stage but the
 * world edits and movement are missing. Elena and Edmond's main-world spawn ids
 * (6206/6204) are not the ids in npc-dialogue-index.json, so their Talk-to is
 * driven by the indexed ids only. The small key and scruffy note are not
 * handed out by this plugin.
 */
module.exports = function registerPlagueCityQuest(api) {
  const { Skill, Equipment, ItemIdentifiers, NpcIdentifiers } = api.core;
  const { registerQuest, refreshQuestList } = require("../QuestRuntime");

  const EDMOND_NPC_ID = NpcIdentifiers.EDMOND_2; // 4256
  const ALRENA_NPC_IDS = new Set([
    NpcIdentifiers.ALRENA,
    NpcIdentifiers.ALRENA_2,
    NpcIdentifiers.ALRENA_3,
  ]);
  const BRAVEK_NPC_IDS = new Set([NpcIdentifiers.BRAVEK, NpcIdentifiers.BRAVEK_2]);
  const CLERK_NPC_IDS = new Set([NpcIdentifiers.CLERK, NpcIdentifiers.CLERK_2]);
  const ELENA_NPC_IDS = new Set([
    NpcIdentifiers.ELENA, // 1102
    NpcIdentifiers.ELENA_2, // 4257
  ]);
  const TED_REHNISON_NPC_ID = NpcIdentifiers.TED_REHNISON; // 4263
  const MARTHA_REHNISON_NPC_ID = NpcIdentifiers.MARTHA_REHNISON; // 4264
  const MILLI_REHNISON_NPC_ID = NpcIdentifiers.MILLI_REHNISON; // 4266
  const JETHICK_NPC_IDS = new Set([
    NpcIdentifiers.JETHICK,
    NpcIdentifiers.JETHICK_2,
    NpcIdentifiers.JETHICK_3,
  ]);

  const VARP_PLAGUE_CITY = 165;
  const STAGE_FIND_DWELLBERRIES = 1;
  const STAGE_GAS_MASK = 2;
  const STAGE_SOFTEN_MUD = 3;
  const STAGE_WATER_4 = 7;
  const STAGE_TUNNEL_OPEN = 8;
  const STAGE_ROPE_TIED = 9;
  const STAGE_PIPE_OPEN = 10;
  const STAGE_SHOWN_PICTURE = 20;
  const STAGE_RETURNED_BOOK = 21;
  const STAGE_SPOKE_TO_REHNISONS = 22;
  const STAGE_SPOKE_TO_MILLI = 23;
  const STAGE_NEED_CLEARANCE = 24;
  const STAGE_CLERK_PERMISSION = 25;
  const STAGE_NEED_HANGOVER_CURE = 26;
  const STAGE_HAVE_WARRANT = 27;
  const STAGE_FREED_ELENA = 28;
  const STAGE_COMPLETE = 29;
  const STAGE_READ_SCROLL = 30;

  const DWELLBERRIES_ITEM_ID = ItemIdentifiers.DWELLBERRIES;
  const GAS_MASK_ITEM_ID = ItemIdentifiers.GAS_MASK;
  const HANGOVER_CURE_ITEM_ID = ItemIdentifiers.HANGOVER_CURE;
  const WARRANT_ITEM_ID = ItemIdentifiers.WARRANT;
  const ARDOUGNE_SCROLL_ITEM_ID = ItemIdentifiers.ARDOUGNE_TELEPORT_SCROLL;
  const CHOCOLATE_DUST_ITEM_ID = ItemIdentifiers.CHOCOLATE_DUST;
  const BUCKET_OF_MILK_ITEM_ID = ItemIdentifiers.BUCKET_OF_MILK;
  const CHOCOLATEY_MILK_ITEM_ID = ItemIdentifiers.CHOCOLATEY_MILK;
  const SNAPE_GRASS_ITEM_ID = ItemIdentifiers.SNAPE_GRASS;

  const START_HOOK = "quest:plague-city:start";
  const COMPLETE_ACTION_ID = "aGVmkR";

  let quest;

  const held = (player, itemId) => player.getInventory().getAmount(itemId) > 0;
  const wearingGasMask = (player) =>
    player.getEquipment().get(Equipment.HEAD_SLOT)?.getId?.() === GAS_MASK_ITEM_ID;

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage === 0) {
      return [
        "I can start this quest by speaking to <col=800000>Edmond</col>",
        "behind his house in <col=800000>East Ardougne</col>.",
        "",
        "There are no requirements for this quest.",
      ];
    }
    const lines = ["<str>Edmond asked me to find his missing daughter Elena.</str>", ""];
    if (stage === STAGE_FIND_DWELLBERRIES) {
      lines.push("I need <col=800000>dwellberries</col> so Alrena can make a gas mask.");
    } else if (stage === STAGE_GAS_MASK) {
      lines.push("<str>Alrena made me a gas mask.</str>", "I should speak to <col=800000>Edmond</col>.");
    } else if (stage >= STAGE_SOFTEN_MUD && stage < STAGE_WATER_4) {
      lines.push("I must pour four <col=800000>buckets of water</col> onto the mud patch.");
    } else if (stage === STAGE_WATER_4) {
      lines.push("The soil is soft. I should use a <col=800000>spade</col> on it.");
    } else if (stage === STAGE_TUNNEL_OPEN) {
      lines.push("I reached the sewers. The pipe grill needs a <col=800000>rope</col>.");
    } else if (stage === STAGE_ROPE_TIED) {
      lines.push("The rope is tied. I need <col=800000>Edmond</col> to help pull the grill away.");
    } else if (stage === STAGE_PIPE_OPEN) {
      lines.push("I should wear my gas mask, enter West Ardougne, and find <col=800000>Jethick</col>.");
    } else if (stage === STAGE_SHOWN_PICTURE) {
      lines.push("Jethick gave me a book to return to the <col=800000>Rehnison family</col>.");
    } else if (stage === STAGE_RETURNED_BOOK) {
      lines.push("I should ask <col=800000>Ted or Martha Rehnison</col> about Elena.");
    } else if (stage === STAGE_SPOKE_TO_REHNISONS) {
      lines.push("Their daughter <col=800000>Milli</col> saw what happened. She is upstairs.");
    } else if (stage === STAGE_SPOKE_TO_MILLI) {
      lines.push("I should investigate the plague house in southern West Ardougne.");
    } else if (stage === STAGE_NEED_CLEARANCE) {
      lines.push("I need clearance from <col=800000>Bravek</col> to enter the plague house.");
    } else if (stage === STAGE_NEED_HANGOVER_CURE) {
      lines.push("Bravek needs a <col=800000>hangover cure</col> before he can help me.");
    } else if (stage === STAGE_HAVE_WARRANT) {
      lines.push("I have a warrant. I must enter the plague house and free Elena.");
    } else if (stage === STAGE_FREED_ELENA) {
      lines.push("<str>I freed Elena.</str>", "I should return to <col=800000>Edmond</col>.");
    } else if (stage >= STAGE_COMPLETE) {
      lines.push(
        "<str>Edmond rewarded me for rescuing Elena.</str>",
        stage >= STAGE_READ_SCROLL
          ? "<str>I learned the Ardougne Teleport spell.</str>"
          : "I should read Edmond's magic scroll.",
        "",
        "<col=ff0000>QUEST COMPLETE!</col>"
      );
    }
    return lines;
  }

  function grantReward(player) {
    player.getSkillManager().addExperiences(Skill.MINING, 2425);
  }

  function edmondVariant(stage) {
    if (stage >= STAGE_COMPLETE) {
      return "after-freeing-elena-edmond-talking-to-edmond-again-before-using-the-ardougne-teleport-scroll";
    }
    if (stage >= STAGE_FREED_ELENA) return "after-freeing-elena-edmond";
    if (stage >= STAGE_PIPE_OPEN) return "entering-west-ardougne-talking-to-edmond-after-unlocking-west-ardougne";
    if (stage === STAGE_ROPE_TIED) {
      return "starting-the-quest-talking-to-edmond-after-tying-the-rope-to-the-grill-on-the-pipe";
    }
    if (stage === STAGE_TUNNEL_OPEN) return "starting-the-quest-talking-to-edmond-in-the-tunnel";
    if (stage === STAGE_WATER_4) return "starting-the-quest-talking-to-edmond-after-pouring-four-buckets-of-water-on-the-mud-patch";
    if (stage === 6) return "starting-the-quest-talking-to-edmond-after-pouring-three-buckets-of-water-on-the-mud-patch";
    if (stage === 5) return "starting-the-quest-talking-to-edmond-after-pouring-two-buckets-of-water-on-the-mud-patch";
    if (stage === 4) return "starting-the-quest-talking-to-edmond-after-pouring-one-bucket-of-water-on-the-mud-patch";
    if (stage === STAGE_SOFTEN_MUD) return "starting-the-quest-talking-to-edmond-before-pouring-water-on-the-mud-patch";
    if (stage === STAGE_GAS_MASK) return "starting-the-quest-talking-to-edmond-after-getting-the-gas-mask";
    if (stage === STAGE_FIND_DWELLBERRIES) return "starting-the-quest-talking-to-edmond-before-getting-dwellberries";
    return "starting-the-quest-talking-to-edmond";
  }

  function alrenaVariant(stage, player) {
    if (stage >= STAGE_FREED_ELENA) return "after-freeing-elena-talking-to-alrena-after-freeing-elena";
    if (stage >= STAGE_SHOWN_PICTURE) return "entering-west-ardougne-talking-to-alrena-after-jethick-asks-for-elena-s-picture";
    if (stage >= STAGE_PIPE_OPEN) return "entering-west-ardougne-talking-to-alrena-after-unlocking-west-ardougne";
    if (stage >= STAGE_TUNNEL_OPEN) return "starting-the-quest-talking-to-alrena-after-digging-the-tunnel";
    if (stage === STAGE_WATER_4) return "starting-the-quest-talking-to-alrena-after-pouring-four-buckets-of-water-on-the-mud-patch";
    if (stage >= STAGE_SOFTEN_MUD) return "starting-the-quest-talking-to-alrena-before-pouring-water-on-the-mud-patch";
    if (stage === STAGE_GAS_MASK) return "starting-the-quest-talking-to-alrena-after-getting-the-gas-mask";
    if (held(player, DWELLBERRIES_ITEM_ID)) {
      player.getInventory().deleteNumber(DWELLBERRIES_ITEM_ID, 1);
      quest.setStage(player, STAGE_GAS_MASK);
      return "starting-the-quest-talking-to-alrena-after-getting-dwellberries";
    }
    return "starting-the-quest-talking-to-alrena-before-getting-dwellberries";
  }

  function jethickVariant(stage, player) {
    if (stage >= STAGE_RETURNED_BOOK) return "finding-elena-talking-to-jethick-after-delivering-the-book";
    if (stage >= STAGE_SHOWN_PICTURE) {
      return "finding-elena-talking-to-jethick-after-getting-elena-s-picture-talking-to-jethick-again-before-delivering-the-book";
    }
    if (stage >= STAGE_PIPE_OPEN) {
      if (held(player, ItemIdentifiers.PICTURE)) {
        return "finding-elena-talking-to-jethick-after-getting-elena-s-picture";
      }
      return "entering-west-ardougne-talking-to-jethick-if-the-player-does-not-have-elena-s-picture";
    }
    return null;
  }

  function rehnisonVariant(stage, afterFreeingVariant) {
    if (stage >= STAGE_FREED_ELENA) return afterFreeingVariant;
    if (stage >= STAGE_SPOKE_TO_MILLI) return "finding-elena-talking-to-ted-rehnison-after-questioning-milli";
    if (stage === STAGE_RETURNED_BOOK || stage === STAGE_SPOKE_TO_REHNISONS) {
      return "finding-elena-talking-to-ted-rehnison";
    }
    return "entering-west-ardougne-talking-to-ted-rehnison-before-getting-the-book-from-jethick";
  }

  function selectVariant({ npcId, player }) {
    const stage = quest.getStage(player);
    if (npcId === EDMOND_NPC_ID) return edmondVariant(stage);
    if (ALRENA_NPC_IDS.has(npcId)) return alrenaVariant(stage, player);
    if (JETHICK_NPC_IDS.has(npcId)) return jethickVariant(stage, player);
    if (npcId === TED_REHNISON_NPC_ID) {
      if (stage === STAGE_RETURNED_BOOK || stage === STAGE_SPOKE_TO_REHNISONS) {
        quest.setStage(player, STAGE_SPOKE_TO_REHNISONS);
      }
      return rehnisonVariant(stage, "after-freeing-elena-talking-to-ted-rehnison-after-freeing-elena");
    }
    if (npcId === MARTHA_REHNISON_NPC_ID) {
      if (stage >= STAGE_SPOKE_TO_MILLI) {
        return "finding-elena-talking-to-martha-rehnison-after-questioning-milli";
      }
      if (stage >= STAGE_RETURNED_BOOK) {
        quest.setStage(player, STAGE_SPOKE_TO_REHNISONS);
        return "finding-elena-talking-to-martha-rehnison";
      }
      return null;
    }
    if (npcId === MILLI_REHNISON_NPC_ID) {
      if (stage >= STAGE_SPOKE_TO_MILLI) {
        return "finding-elena-talking-to-milli-rehnison-after-attempting-to-enter-the-plague-house";
      }
      if (stage === STAGE_SPOKE_TO_REHNISONS) {
        quest.setStage(player, STAGE_SPOKE_TO_MILLI);
        return "finding-elena-talking-to-milli-rehnison";
      }
      return null;
    }
    if (CLERK_NPC_IDS.has(npcId)) {
      if (stage >= STAGE_NEED_HANGOVER_CURE) return "finding-elena-talking-to-clerk-after-meeting-bravek";
      if (stage === STAGE_CLERK_PERMISSION) {
        return "finding-elena-talking-to-the-clerk-after-getting-permission-to-speak-to-bravek";
      }
      if (stage === STAGE_NEED_CLEARANCE) {
        quest.setStage(player, STAGE_CLERK_PERMISSION);
        return "finding-elena-talking-to-the-clerk-before-getting-permission-to-speak-to-bravek";
      }
      return "entering-west-ardougne-talking-to-main-clerk-in-west-ardougne";
    }
    if (BRAVEK_NPC_IDS.has(npcId)) {
      if (stage >= STAGE_HAVE_WARRANT) return "finding-elena-talking-to-bravek-after-receiving-the-warrant";
      if (stage === STAGE_NEED_HANGOVER_CURE) {
        if (held(player, HANGOVER_CURE_ITEM_ID)) {
          player.getInventory().deleteNumber(HANGOVER_CURE_ITEM_ID, 1);
          if (!held(player, WARRANT_ITEM_ID)) player.getInventory().adds(WARRANT_ITEM_ID, 1);
          quest.setStage(player, STAGE_HAVE_WARRANT);
          return "finding-elena-talking-to-bravek-after-getting-the-hangover-cure";
        }
        return "finding-elena-talking-to-bravek-talking-to-bravek-again-before-getting-the-hangover-cure";
      }
      if (stage === STAGE_CLERK_PERMISSION) {
        quest.setStage(player, STAGE_NEED_HANGOVER_CURE);
        return "finding-elena-talking-to-bravek";
      }
      return "finding-elena-attempting-to-open-the-door-to-bravek-before-the-clerk-lets-you-in";
    }
    if (ELENA_NPC_IDS.has(npcId)) {
      if (stage === STAGE_HAVE_WARRANT) {
        quest.setStage(player, STAGE_FREED_ELENA);
        return "freeing-elena-talking-to-elena-after-unlocking-the-basement-door";
      }
      if (stage < STAGE_HAVE_WARRANT) return null;
      return "freeing-elena-talking-to-elena-after-unlocking-the-basement-door";
    }
    return null;
  }

  function answerCondition({ player, text }) {
    const value = String(text).toLowerCase();
    const inventory = player.getInventory();
    if (value.includes("already has the gas mask")) return held(player, GAS_MASK_ITEM_ID);
    if (value.includes("does not have the gas mask") || value.includes("does not have a gas mask")) {
      return !held(player, GAS_MASK_ITEM_ID);
    }
    if (value.includes("has a gas mask")) return held(player, GAS_MASK_ITEM_ID);
    if (value.includes("has no inventory space")) return inventory.isFull();
    if (value.includes("edmond has not told the player to pour water")) return quest.getStage(player) < STAGE_SOFTEN_MUD;
    if (value.includes("first, second, or third bucket")) return quest.getStage(player) < STAGE_WATER_4;
    if (value.includes("fourth bucket of water")) return quest.getStage(player) >= STAGE_WATER_4;
    if (value.includes("grill has not been removed")) return quest.getStage(player) < STAGE_PIPE_OPEN;
    if (value.includes("not wearing a gas mask")) return !wearingGasMask(player);
    if (value.includes("has not talked to jethick before")) return quest.getStage(player) < STAGE_SHOWN_PICTURE;
    if (value.includes("has talked to jethick before")) return quest.getStage(player) >= STAGE_SHOWN_PICTURE;
    if (value.includes("lost the scruffy note")) return !held(player, ItemIdentifiers.A_SCRUFFY_NOTE);
    return null;
  }

  function handleStartHook({ player, npcId, hook }) {
    if (npcId !== EDMOND_NPC_ID || hook !== START_HOOK) return;
    if (quest.getStage(player) < STAGE_FIND_DWELLBERRIES) quest.setStage(player, STAGE_FIND_DWELLBERRIES);
  }

  function handleAction({ player, npcId, stepId }) {
    // "Jethick gives you a book." - he has shown the player Elena's picture.
    if (JETHICK_NPC_IDS.has(npcId) && stepId === "_dk_wV") {
      if (!held(player, ItemIdentifiers.BOOK_2)) player.getInventory().adds(ItemIdentifiers.BOOK_2, 1);
      quest.setStage(player, STAGE_SHOWN_PICTURE);
      return;
    }
    if (npcId === EDMOND_NPC_ID && stepId === COMPLETE_ACTION_ID) {
      if (quest.getStage(player) >= STAGE_FREED_ELENA && !quest.isComplete(player)) {
        quest.complete(player);
      }
    }
  }

  /** Bravek's hangover cure: chocolate dust + milk, then snape grass. */
  function handleItemOnItem(event) {
    const ids = [event.usedItemId, event.usedWithItemId];
    const hasPair = (a, b) => ids.includes(a) && ids.includes(b);
    if (hasPair(CHOCOLATE_DUST_ITEM_ID, BUCKET_OF_MILK_ITEM_ID)) {
      event.player.getInventory().deleteNumber(CHOCOLATE_DUST_ITEM_ID, 1);
      event.player.getInventory().deleteNumber(BUCKET_OF_MILK_ITEM_ID, 1);
      event.player.getInventory().adds(CHOCOLATEY_MILK_ITEM_ID, 1);
      event.player.sendMessage("You mix the chocolate dust into the bucket of milk.");
      event.handled = true;
      return;
    }
    if (hasPair(SNAPE_GRASS_ITEM_ID, CHOCOLATEY_MILK_ITEM_ID)) {
      event.player.getInventory().deleteNumber(SNAPE_GRASS_ITEM_ID, 1);
      event.player.getInventory().deleteNumber(CHOCOLATEY_MILK_ITEM_ID, 1);
      event.player.getInventory().adds(HANGOVER_CURE_ITEM_ID, 1);
      event.player.sendMessage("You mix the snape grass into the bucket and make a hangover cure.");
      event.handled = true;
    }
  }

  function handleLogin({ player }) {
    refreshQuestList(player);
  }

  quest = registerQuest(api, {
    key: "plague_city",
    name: "Plague City",
    varpId: VARP_PLAGUE_CITY,
    startedValue: STAGE_FIND_DWELLBERRIES,
    completionValue: STAGE_COMPLETE,
    questPoints: 1,
    xpRewards: [{ skillId: Skill.MINING.getIndex(), amount: 2425, label: "Mining" }],
    rewardItemId: ARDOUGNE_SCROLL_ITEM_ID,
    rewardItemLabel: "Magic scroll",
    otherRewards: ["Access to the Ardougne Teleport spell after reading the scroll"],
    buildJournal,
    onReward: grantReward,
  });

  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onItemOnItem(handleItemOnItem);
  api.onPlayerLogin(handleLogin);
};
