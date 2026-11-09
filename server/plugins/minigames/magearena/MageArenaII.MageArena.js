"use strict";

/**
 * Mage Arena II (https://oldschool.runescape.wiki/w/Mage_Arena_II): the miniquest's state, shared
 * by Kolodion, the Enchanted symbol and the three followers.
 *
 * The stage is the cache quest row's varbit, `ma2_progress` (6067), as a live run moves it
 * (rsprox_transcripts/235/03344.txt): 1 on "Great, I've been waiting for an improvement!", 2 once
 * Kolodion hands over the symbol, 3 once he holds all three remains, 4 (the row's endstate) when he
 * imbues the first cape. The remains he holds are `ma2_saradomin/guthix/zamorak_component`
 * (6063-6065) and their sum `ma2_all_components` (6066, bits 1/2/4); the first imbue clears them.
 */
const QuestRuntime = require("../../quests/QuestRuntime");
const Spells = require("./Spells.MageArena");

const QUEST_NAME = "Mage Arena II";
const PROGRESS_VARBIT = 6067;
const ALL_COMPONENTS_VARBIT = 6066;
const STAGE = Object.freeze({ NOT_STARTED: 0, STARTED: 1, HUNTING: 2, ALL_REMAINS: 3, COMPLETE: 4 });
/** The remains Kolodion is holding, bits 1/2/4 (ma2_all_components). */
const COMPONENTS_ATTRIBUTE = "mage-arena-ii:components";
const ALL_COMPONENTS = 7;
const MAGE_ARENA_II_MAGIC = 75;

let api;
let quest = null;
/** The three followers, from the cache's ma2_* names (235/03344). */
let followers = [];

function createFollowers(core) {
  const Items = core.ItemIdentifiers;
  const Npcs = core.NpcIdentifiers;
  // Spells.GODS: Saradomin Strike, Claws of Guthix, Flames of Zamorak.
  const [strike, claws, flames] = Spells.GODS;
  const spellIds = { saradomin: strike.spellId, guthix: claws.spellId, zamorak: flames.spellId };
  return Object.freeze([
    Object.freeze({
      key: "saradomin", god: "Saradomin", bit: 1, varbit: 6063, spellId: spellIds.saradomin,
      npcId: Npcs.JUSTICIAR_ZACHARIAH_2, spawningId: Npcs.JUSTICIAR_ZACHARIAH,
      remainsId: Items.JUSTICIARS_HAND, capeIds: [Items.SARADOMIN_CAPE, Items.SARADOMIN_CAPE_2],
      imbuedId: Items.IMBUED_SARADOMIN_CAPE, handedIn: "the Saradominist justiciar",
      handInVariant: "starting-off-bringing-kolodion-the-justiciar-s-hand",
      capeVariant: "starting-off-using-unimbued-god-capes-on-kolodion-saradomin-cape",
    }),
    Object.freeze({
      key: "guthix", god: "Guthix", bit: 2, varbit: 6064, spellId: spellIds.guthix,
      npcId: Npcs.DERWEN_2, spawningId: Npcs.DERWEN,
      remainsId: Items.ENTS_ROOTS, capeIds: [Items.GUTHIX_CAPE, Items.GUTHIX_CAPE_2],
      imbuedId: Items.IMBUED_GUTHIX_CAPE, handedIn: "the Guthixian Ent",
      handInVariant: "starting-off-bringing-kolodion-the-ent-s-roots",
      capeVariant: "starting-off-using-unimbued-god-capes-on-kolodion-guthix-cape",
    }),
    Object.freeze({
      key: "zamorak", god: "Zamorak", bit: 4, varbit: 6065, spellId: spellIds.zamorak,
      npcId: Npcs.PORAZDIR_2, spawningId: null,
      remainsId: Items.DEMONS_HEART, capeIds: [Items.ZAMORAK_CAPE, Items.ZAMORAK_CAPE_2],
      imbuedId: Items.IMBUED_ZAMORAK_CAPE, handedIn: "the Zamorakian Demon",
      handInVariant: "starting-off-bringing-kolodion-the-demon-s-heart",
      capeVariant: "starting-off-using-unimbued-god-capes-on-kolodion-zamorak-cape",
    }),
  ]);
}

function getFollowers() {
  return followers;
}

function followerByKey(key) {
  return followers.find((follower) => follower.key === key) ?? null;
}

function followerByNpc(npcId) {
  return followers.find((follower) => follower.npcId === npcId) ?? null;
}

function followerByRemains(itemId) {
  return followers.find((follower) => follower.remainsId === itemId) ?? null;
}

function followerByCape(itemId) {
  return followers.find((follower) => follower.capeIds.includes(itemId)) ?? null;
}

function stageOf(player) {
  return quest ? quest.getStage(player) : STAGE.NOT_STARTED;
}

function setStage(player, stage) {
  quest?.setStage(player, stage);
}

function complete(player) {
  return quest?.complete(player) === true;
}

function components(player) {
  return (Number(player.getAttribute(COMPONENTS_ATTRIBUTE)) || 0) & ALL_COMPONENTS;
}

function holds(player, follower) {
  return (components(player) & follower.bit) !== 0;
}

/** Sets what Kolodion holds and its varbits (6063-6066), as the live run sends them. */
function setComponents(player, bits) {
  const value = bits & ALL_COMPONENTS;
  player.setAttribute(COMPONENTS_ATTRIBUTE, value);
  sendComponents(player, value);
}

function sendComponents(player, value = components(player)) {
  const sender = player.getPacketSender();
  for (const follower of followers) sender.sendVarbit(follower.varbit, (value & follower.bit) !== 0 ? 1 : 0);
  sender.sendVarbit(ALL_COMPONENTS_VARBIT, value);
}

function carries(player, follower) {
  return player.getInventory().contains(follower.remainsId);
}

/** Owned anywhere: carried, worn or banked (the Wiki's "only one enchanted symbol can be owned"). */
function owns(player, itemId) {
  const has = (container) => container?.contains?.(itemId) === true;
  return has(player.getInventory()) || has(player.getEquipment()) ||
    (player.getBanks?.() ?? []).some((bank, tab) => tab !== api.core.Bank.BANK_SEARCH_TAB_INDEX && has(bank));
}

function hasMageArenaMagic(player) {
  return player.getSkillManager().getMaxLevel(api.core.Skill.MAGIC) >= MAGE_ARENA_II_MAGIC;
}

const JOURNAL = Object.freeze({
  start: "I can start this miniquest by speaking to <col=800000>Kolodion</col> in the <col=800000>Mage Arena</col> bank.",
  hunt: "Kolodion has asked me to bring him the remains of three magical beings in the <col=800000>Wilderness</col>. The <col=800000>enchanted symbol</col> will guide me to them.",
  cape: "Kolodion holds all three remains. I should hand him the <col=800000>god cape</col> I wish to have imbued.",
});

function buildJournal(player) {
  const stage = stageOf(player);
  if (stage >= STAGE.COMPLETE) return [`<str>${JOURNAL.hunt}</str>`, `<str>${JOURNAL.cape}</str>`, "", "<col=ff0000>MINIQUEST COMPLETE!</col>"];
  if (stage >= STAGE.ALL_REMAINS) return [`<str>${JOURNAL.hunt}</str>`, JOURNAL.cape];
  if (stage >= STAGE.STARTED) return [JOURNAL.hunt];
  return [JOURNAL.start];
}

/** On login: Kolodion's held remains, which the client reads from their varbits. */
function syncOnLogin({ player }) {
  sendComponents(player);
}

const QUEST_DEFINITION = Object.freeze({
  key: "mage_arena_ii",
  name: QUEST_NAME,
  varbitId: PROGRESS_VARBIT,
  startedValue: STAGE.STARTED,
  completionValue: STAGE.COMPLETE,
  questPoints: 0,
  otherRewards: ["The ability to imbue the god capes"],
  buildJournal,
});

module.exports = function registerMageArenaII(pluginApi) {
  api = pluginApi;
  followers = createFollowers(api.core);
  quest = QuestRuntime.registerQuest(api, QUEST_DEFINITION);
  api.persistAttribute(COMPONENTS_ATTRIBUTE, 0);
  api.onPlayerLogin(syncOnLogin);
};

Object.assign(module.exports, {
  STAGE,
  ALL_COMPONENTS,
  COMPONENTS_ATTRIBUTE,
  getFollowers,
  followerByKey,
  followerByNpc,
  followerByRemains,
  followerByCape,
  stageOf,
  setStage,
  complete,
  components,
  holds,
  setComponents,
  carries,
  owns,
  hasMageArenaMagic,
  _test: { QUEST_DEFINITION, PROGRESS_VARBIT, ALL_COMPONENTS_VARBIT, buildJournal, createFollowers },
});
