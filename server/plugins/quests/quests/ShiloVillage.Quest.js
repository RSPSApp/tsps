/**
 * Shilo Village (members; Jungle Potion, 20 Crafting, 32 Agility), aligned with the user's
 * whole-quest capture (RSProx capture ShiloVillage, revision 242.1; ticks cited in the unit files
 * are that recording's, and the facts are collected in docs/quests/shilo-village/README.md).
 *
 * The words come from the "Shilo Village", "Mosol Rei", "Trufitus" and "Yanni Salika" transcript
 * pages (npc-dialogues.json, osrsreboxed-db, with the capture's corrections there); the unit files
 * pick the variants, answer the prose conditions and do what the capture shows between the lines:
 *   Village    the broken cart, the village's metal gate and wooden gate, the green mist, Mosol
 *              Rei's undead and his way into the village;
 *   Npcs       Trufitus, Mosol Rei and Yanni Salika: their variants, items shown to them, the start;
 *   AhZaRhoon  the mound, fissure and temple, the scrolls, Zadimus' corpse and the bone shard;
 *   Bervirius  Cairn Isle's bridge, Bervirius' tomb, the crafting, the crystal and the ending;
 *   Rashiliyia the hidden doors, Rashiliyia's tomb, the bones, Nazastarool and her remains.
 * The stages are the native zombiequeen varp (116); State.ShiloVillage.js lists them.
 */
const createState = require("../shilovillage/State.ShiloVillage");
const { buildJournal } = require("../shilovillage/Journal.ShiloVillage");

/** Transcript messages live sends to the chatbox although the same text is boxed elsewhere. */
const CHAT_NOT_BOX = new Set(["dBR0dC"]);
const SHILO_PAGES = new Set(["Shilo Village", "Mosol Rei", "Trufitus", "Yanni Salika", "Bervirius notes"]);

module.exports = function registerShiloVillageQuest(api) {
  const { Skill } = api.core;
  const { registerQuest, refreshQuestList } = require("../QuestRuntime");
  const sv = createState(api);

  /** A Shilo transcript message live shows in a box (Boxes.ShiloVillage.js); the rest stay game messages. */
  function boxMessage(event) {
    if (event.kind !== "message" || event.box || !event.player) return;
    const pages = event.pages ?? [];
    if (!pages.some?.((entry) => SHILO_PAGES.has(entry?.page ?? entry))) return;
    // The curse's chat line shares its text with the box after it (t4837-4840): only the box is boxed.
    if (CHAT_NOT_BOX.has(event.stepId)) return;
    const box = sv.boxFor(event.text);
    if (box) event.box = box;
  }

  function grantReward(player) {
    player.getSkillManager().addExperiences(Skill.CRAFTING, 3875);
  }

  function handleLogin({ player }) {
    if (player) refreshQuestList(player);
  }

  api.persistAttribute(sv.MECH_ATTRIBUTE, 0);

  sv.quest = registerQuest(api, {
    key: "shilo_village",
    name: "Shilo Village",
    varpId: sv.VARP,
    startedValue: sv.STAGE.STARTED,
    completionValue: sv.STAGE.COMPLETE,
    questPoints: 2,
    xpRewards: [{ skillId: Skill.CRAFTING.getIndex(), amount: 3875, label: "Crafting" }],
    scrollItemId: sv.ITEM.BEADS_OF_THE_DEAD,
    otherRewards: ["Access to Shilo Village"],
    // The scroll's order at t5257: "2 Quest Points", "Access to Shilo Village", "3,875 Crafting XP".
    rewardOrder: ["other", "xp"],
    buildJournal: (player) => buildJournal(sv, player),
    onReward: grantReward,
  });

  api.onCustomEvent("npc-dialogue:action", boxMessage);
  api.onPlayerLogin(handleLogin);
  sv.units = {
    Village: require("../shilovillage/Village.ShiloVillage")(api, sv),
    Npcs: require("../shilovillage/Npcs.ShiloVillage")(api, sv),
    AhZaRhoon: require("../shilovillage/AhZaRhoon.ShiloVillage")(api, sv),
    Bervirius: require("../shilovillage/Bervirius.ShiloVillage")(api, sv),
    Rashiliyia: require("../shilovillage/Rashiliyia.ShiloVillage")(api, sv),
  };
  // The tests reach the units' helpers through the registered quest.
  sv.quest.state = sv;
};
