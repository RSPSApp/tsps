/**
 * Nature Spirit (members).
 *
 * The words come from the "Nature Spirit" transcript page. Drezel (9636),
 * Filliman Tarlock (943) and the Nature Spirit (944) are all indexed, so this
 * plugin supplies the variant selector, the prose-condition answers, the start
 * hook, the completion action and the key item interactions (mirror/journal on
 * Filliman, casting the Bloom spell, blessing the sickle).
 *
 * Stages (varp 307) step by 5: 5 started, 10 entered swamp, 15 failed talk,
 * 20 spoken to Filliman, 25 shown mirror, 30 given journal, 35 received spell,
 * 40 blessed, 45 cast spell, 50 picked fungi, 55 spoken again, 60 ritual,
 * 65 entered grotto, 70 full transform, 75 blessed sickle, then the three
 * ghast stages, 110 complete.
 *
 * Gaps: the swamp gate/bridge travel, the nature/spirit stone offerings
 * (varp 308 bits), the druid-pouch charges and the three ghast kills are not
 * wired to objects/combat here; the transcript still plays by stage, only the
 * world edits and the ghast counter are missing, so a human must finish the
 * ritual stages through the transcript.
 */
module.exports = function registerNatureSpiritQuest(api) {
  const { Skill, Equipment, ItemIdentifiers, NpcIdentifiers } = api.core;
  const { registerQuest, refreshQuestList } = require("../QuestRuntime");

  const DREZEL_NPC_ID = NpcIdentifiers.DREZEL; // 9636
  const FILLIMAN_NPC_ID = NpcIdentifiers.FILLIMAN_TARLOCK; // 943
  const NATURE_SPIRIT_NPC_ID = NpcIdentifiers.NATURE_SPIRIT; // 944

  const VARP_NATURE_SPIRIT = 307;

  const STAGE_STARTED = 5;
  const STAGE_ENTERED_SWAMP = 10;
  const STAGE_FAILED_TALK = 15;
  const STAGE_SPOKEN_FILLIMAN = 20;
  const STAGE_SHOWN_MIRROR = 25;
  const STAGE_GIVEN_JOURNAL = 30;
  const STAGE_RECEIVED_SPELL = 35;
  const STAGE_BLESSED = 40;
  const STAGE_CAST_SPELL = 45;
  const STAGE_PICKED_FUNGI = 50;
  const STAGE_SPOKEN_FILLIMAN_2 = 55;
  const STAGE_PERFORMED_RITUAL = 60;
  const STAGE_ENTERED_GROTTO = 65;
  const STAGE_FULL_TRANSFORM = 70;
  const STAGE_BLESSED_SICKLE = 75;
  const STAGE_CAST_SICKLE_BLOOM = 80;
  const STAGE_ADDED_POUCH = 90;
  const STAGE_KILLED_GHAST_3 = 105;
  const STAGE_COMPLETE = 110;

  const GHOSTSPEAK_AMULET_ITEM_ID = ItemIdentifiers.GHOSTSPEAK_AMULET;
  const SILVER_SICKLE_ITEM_ID = ItemIdentifiers.SILVER_SICKLE;
  const SILVER_SICKLE_BLESSED_ITEM_ID = ItemIdentifiers.SILVER_SICKLE_B_;
  const MIRROR_ITEM_ID = ItemIdentifiers.MIRROR;
  const JOURNAL_ITEM_ID = ItemIdentifiers.JOURNAL;
  const DRUIDIC_SPELL_ITEM_ID = ItemIdentifiers.DRUIDIC_SPELL;
  const USED_SPELL_ITEM_ID = ItemIdentifiers.A_USED_SPELL;

  const START_HOOK = "quest:nature-spirit:start";
  const COMPLETE_ACTION_ID = "b8LYWU";

  let quest;

  const held = (player, itemId) => player.getInventory().getAmount(itemId) > 0;
  const wearingGhostspeak = (player) =>
    player.getEquipment().get(Equipment.AMULET_SLOT)?.getId?.() === GHOSTSPEAK_AMULET_ITEM_ID;

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      return ["<str>I helped Filliman become a Nature Spirit.</str>", "", "<col=ff0000>QUEST COMPLETE!</col>"];
    }
    if (stage >= STAGE_ADDED_POUCH) {
      const killed = stage >= STAGE_KILLED_GHAST_3 ? 3 : stage >= 100 ? 2 : stage >= 95 ? 1 : 0;
      return [
        `I have released ${killed} of the 3 Ghasts.`,
        killed === 3
          ? "Return to the <col=800000>Nature Spirit</col>."
          : "Defeat Ghasts with charges from my druid pouch.",
      ];
    }
    if (stage >= STAGE_BLESSED_SICKLE) {
      return [
        "Use the blessed sickle to make swamp plants bloom,",
        "then fill the <col=800000>druid pouch</col> with their produce.",
      ];
    }
    if (stage >= STAGE_FULL_TRANSFORM) {
      return ["Bring the Nature Spirit a <col=800000>silver sickle</col> to bless."];
    }
    if (stage >= STAGE_ENTERED_GROTTO || stage >= STAGE_PERFORMED_RITUAL) {
      return ["Enter the grotto and speak to Filliman to complete his transformation."];
    }
    if (stage >= STAGE_SPOKEN_FILLIMAN_2 || stage >= STAGE_PICKED_FUNGI) {
      return [
        "Place the fungus on the nature stone and the used spell on",
        "the spirit stone, then speak to Filliman on the faith stone.",
      ];
    }
    if (stage >= STAGE_CAST_SPELL || stage >= STAGE_BLESSED) {
      return ["Pick <col=800000>Mort myre fungus</col> grown by the Bloom spell."];
    }
    if (stage >= STAGE_RECEIVED_SPELL) {
      return ["Ask <col=800000>Drezel</col> to bless me, then cast Filliman's spell in the swamp."];
    }
    if (stage >= STAGE_GIVEN_JOURNAL) {
      return ["Ask Filliman how I can help him become a nature spirit."];
    }
    if (stage >= STAGE_SHOWN_MIRROR) {
      return ["Find Filliman's <col=800000>journal</col> in the grotto tree and give it to him."];
    }
    if (stage >= STAGE_ENTERED_SWAMP) {
      return ["Wear an amulet of ghostspeak, find a mirror, and convince Filliman he is dead."];
    }
    if (stage >= STAGE_STARTED) {
      return ["Enter Mort Myre swamp and find <col=800000>Filliman Tarlock</col>."];
    }
    return ["Speak to <col=800000>Drezel</col> after completing Priest in Peril."];
  }

  function grantReward(player) {
    player.getSkillManager().addExperiences(Skill.CRAFTING, 3000);
    player.getSkillManager().addExperiences(Skill.HITPOINTS, 2000);
    player.getSkillManager().addExperiences(Skill.DEFENCE, 2000);
  }

  function drezelVariant(stage, player) {
    if (stage === STAGE_RECEIVED_SPELL) {
      quest.setStage(player, STAGE_BLESSED);
      return "talking-to-drezel";
    }
    if (stage >= STAGE_ENTERED_GROTTO) return "entering-filliman-s-grove-talking-to-drezel";
    if (stage >= STAGE_BLESSED) return "talking-to-drezel-subsequent-dialogue-with-drezel";
    if (stage === STAGE_FAILED_TALK) {
      return "finding-filliman-talking-to-drezel-after-talking-to-filliman-without-a-ghostspeak-amulet";
    }
    if (stage >= STAGE_STARTED) return "starting-off-talking-to-drezel-again";
    return "starting-off-talking-to-drezel";
  }

  function fillimanVariant(stage, player) {
    if (stage >= STAGE_COMPLETE) {
      return "returning-to-filliman-s-grove-attempting-to-talk-to-him-again-before-he-disappears";
    }
    if (stage >= STAGE_KILLED_GHAST_3) return "returning-to-filliman-s-grove";
    if (stage >= STAGE_FULL_TRANSFORM) return "entering-filliman-s-grove-subsequent-dialogue-with-filliman";
    if (stage >= STAGE_ENTERED_GROTTO) {
      quest.setStage(player, STAGE_FULL_TRANSFORM);
      return "entering-filliman-s-grove-talking-to-filliman-inside-his-grove";
    }
    if (stage >= STAGE_PERFORMED_RITUAL) {
      return "talking-to-filliman-talking-to-filliman-outside-the-grove-again";
    }
    if (stage === STAGE_SPOKEN_FILLIMAN_2) {
      quest.setStage(player, STAGE_PERFORMED_RITUAL);
      return "talking-to-filliman-talking-to-filliman-again-on-the-orange-stone";
    }
    if (stage >= STAGE_PICKED_FUNGI) {
      quest.setStage(player, STAGE_SPOKEN_FILLIMAN_2);
      return "talking-to-filliman";
    }
    if (stage >= STAGE_CAST_SPELL) return "talking-to-filliman";
    if (stage >= STAGE_RECEIVED_SPELL) return "finding-filliman-subsequent-dialogue-with-filliman-2";
    if (stage >= STAGE_GIVEN_JOURNAL) {
      quest.setStage(player, STAGE_RECEIVED_SPELL);
      return "finding-filliman-subsequent-dialogue-with-filliman-2";
    }
    if (stage >= STAGE_SHOWN_MIRROR) {
      return "finding-filliman-subsequent-dialogue-with-filliman";
    }
    if (stage >= STAGE_SPOKEN_FILLIMAN) {
      return "finding-filliman-talking-to-filliman-again-after-using-a-mirror-on-him";
    }
    if (stage >= STAGE_ENTERED_SWAMP) {
      if (!wearingGhostspeak(player)) {
        quest.setStage(player, STAGE_FAILED_TALK);
      } else {
        quest.setStage(player, STAGE_SPOKEN_FILLIMAN);
      }
      return "finding-filliman-talking-to-filliman";
    }
    return null;
  }

  function selectVariant({ npcId, player }) {
    const stage = quest.getStage(player);
    if (npcId === DREZEL_NPC_ID) return drezelVariant(stage, player);
    if (npcId === FILLIMAN_NPC_ID || npcId === NATURE_SPIRIT_NPC_ID) {
      return fillimanVariant(stage, player);
    }
    return null;
  }

  function answerCondition({ player, text }) {
    const value = String(text).toLowerCase();
    const inventory = player.getInventory();
    if (value.includes("does not meet the requirements")) return false;
    if (value.includes("meets the requirements")) return true;
    if (value.includes("not wearing the ghostspeak amulet")) return !wearingGhostspeak(player);
    if (value.includes("wearing the ghostspeak amulet")) return wearingGhostspeak(player);
    if (value.includes("not wearing their ghostspeak amulet")) return !wearingGhostspeak(player);
    if (value.includes("has the silver sickle in their inventory")) return held(player, SILVER_SICKLE_ITEM_ID);
    if (value.includes("does not have the sickle in their inventory")) return !held(player, SILVER_SICKLE_ITEM_ID);
    if (value.includes("does not have any inventory space")) return inventory.isFull();
    if (value.includes("has one free inventory space")) return !inventory.isFull();
    if (value.includes("does not have inventory space")) return inventory.isFull();
    if (value.includes("has killed 1 ghast")) return quest.getStage(player) >= 95;
    if (value.includes("has killed 2 ghasts")) return quest.getStage(player) >= 100;
    if (value.includes("has killed 3 ghass") || value.includes("has killed 3 ghasts")) {
      return quest.getStage(player) >= STAGE_KILLED_GHAST_3;
    }
    if (value.includes("does not have all three items")) {
      return !(held(player, MIRROR_ITEM_ID) && held(player, JOURNAL_ITEM_ID));
    }
    return null;
  }

  function handleStartHook({ player, npcId, hook }) {
    if (npcId !== DREZEL_NPC_ID || hook !== START_HOOK) return;
    if (quest.getStage(player) < STAGE_STARTED) quest.setStage(player, STAGE_STARTED);
  }

  function handleAction({ player, npcId, stepId }) {
    if (stepId !== COMPLETE_ACTION_ID) return;
    if (npcId !== FILLIMAN_NPC_ID && npcId !== NATURE_SPIRIT_NPC_ID) return;
    if (quest.getStage(player) >= STAGE_KILLED_GHAST_3 && !quest.isComplete(player)) {
      quest.complete(player);
    }
  }

  /** The mirror proves to Filliman that he is dead. */
  function handleMirrorOnFilliman(event) {
    if (event.itemId !== MIRROR_ITEM_ID) return;
    const target = event.target?.getId?.();
    if (target !== FILLIMAN_NPC_ID && target !== NATURE_SPIRIT_NPC_ID) return;
    if (quest.getStage(event.player) !== STAGE_SPOKEN_FILLIMAN) return;
    if (!wearingGhostspeak(event.player)) return;
    quest.setStage(event.player, STAGE_SHOWN_MIRROR);
    event.player.sendMessage("Filliman sees no reflection and finally accepts that he is dead.");
    event.handled = true;
  }

  /** Giving Filliman his journal earns the Bloom spell. */
  function handleJournalOnFilliman(event) {
    if (event.itemId !== JOURNAL_ITEM_ID) return;
    const target = event.target?.getId?.();
    if (target !== FILLIMAN_NPC_ID && target !== NATURE_SPIRIT_NPC_ID) return;
    if (quest.getStage(event.player) !== STAGE_SHOWN_MIRROR) return;
    if (!held(event.player, JOURNAL_ITEM_ID)) return;
    event.player.getInventory().deleteNumber(JOURNAL_ITEM_ID, 1);
    if (!held(event.player, DRUIDIC_SPELL_ITEM_ID)) event.player.getInventory().adds(DRUIDIC_SPELL_ITEM_ID, 1);
    quest.setStage(event.player, STAGE_GIVEN_JOURNAL);
    event.player.sendMessage("Filliman reads his journal and remembers his purpose.");
    event.handled = true;
  }

  /** Casting the Bloom spell while blessed turns it into the used spell. */
  function handleSpellAction(event) {
    if (event.itemId !== DRUIDIC_SPELL_ITEM_ID) return;
    if (!String(event.option ?? "").toLowerCase().includes("cast")) return;
    if (quest.getStage(event.player) !== STAGE_BLESSED) return;
    if (!held(event.player, DRUIDIC_SPELL_ITEM_ID)) return;
    event.player.getInventory().deleteNumber(DRUIDIC_SPELL_ITEM_ID, 1);
    event.player.getInventory().adds(USED_SPELL_ITEM_ID, 1);
    quest.setStage(event.player, STAGE_CAST_SPELL);
    event.player.sendMessage("The Bloom spell makes fungi erupt from the rotting logs.");
    event.handled = true;
  }

  /** The blessed sickle casts Bloom to grow the swamp produce. */
  function handleSickleAction(event) {
    if (event.itemId !== SILVER_SICKLE_BLESSED_ITEM_ID) return;
    if (!String(event.option ?? "").toLowerCase().includes("cast bloom")) return;
    if (quest.getStage(event.player) !== STAGE_BLESSED_SICKLE) return;
    quest.setStage(event.player, STAGE_CAST_SICKLE_BLOOM);
    event.player.sendMessage("The blessed sickle makes the swamp plants bloom.");
    event.handled = true;
  }

  function handleLogin({ player }) {
    refreshQuestList(player);
  }

  quest = registerQuest(api, {
    key: "nature_spirit",
    name: "Nature Spirit",
    varpId: VARP_NATURE_SPIRIT,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 2,
    xpRewards: [
      { skillId: Skill.CRAFTING.getIndex(), amount: 3000, label: "Crafting" },
      { skillId: Skill.HITPOINTS.getIndex(), amount: 2000, label: "Hitpoints" },
      { skillId: Skill.DEFENCE.getIndex(), amount: 2000, label: "Defence" },
    ],
    rewardItemId: SILVER_SICKLE_BLESSED_ITEM_ID,
    rewardItemLabel: "Silver sickle (b)",
    otherRewards: [
      "An altar of nature",
      "Ability to fight Ghasts",
      "Access to Mort Myre swamp produce",
    ],
    buildJournal,
    onReward: grantReward,
  });

  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onItemOnNpc(handleMirrorOnFilliman);
  api.onItemOnNpc(handleJournalOnFilliman);
  api.onItemAction(handleSpellAction);
  api.onItemAction(handleSickleAction);
  api.onPlayerLogin(handleLogin);
};
