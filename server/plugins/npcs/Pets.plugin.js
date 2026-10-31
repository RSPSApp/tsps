/**
 * Followers, ownership, storage and pet-specific behaviour.
 *
 * Ownership is item-backed: a pet item in the inventory, any bank tab, or an active
 * follower is the durable record; `pets.owned` remembers which pets Probita insures
 * for reclaim. Variants chosen with Metamorphosis persist in `pets:variant` keyed by
 * pet family, and are re-applied when the follower is summoned.
 */
const { NPC } = require("../../src/main/typescript/elvarg/game/entity/impl/npc/NPC");
const { Animation } = require("../../src/main/typescript/elvarg/game/model/Animation");
const { Item } = require("../../src/main/typescript/elvarg/game/model/Item");
const { Sound } = require("../../src/main/typescript/elvarg/game/Sound");
const { Sounds } = require("../../src/main/typescript/elvarg/game/Sounds");
const { Skill } = require("../../src/main/typescript/elvarg/game/model/Skill");
const { Bank } = require("../../src/main/typescript/elvarg/game/model/container/impl/Bank");
const { Misc } = require("../../src/main/typescript/elvarg/util/Misc");
const { NpcIdentifiers } = require("../../src/main/typescript/elvarg/util/NpcIdentifiers");
const { ItemIdentifiers } = require("../../src/main/typescript/elvarg/util/ItemIdentifiers");
const Recovery = require("./pets/Recovery.Pets");
const Acquisition = require("./pets/Acquisition.Pets");
const Dust = require("./pets/Dust.Pets");
const Call = require("./pets/Call.Pets");
const CatchUp = require("./pets/CatchUp.Pets");
const Dialogue = require("./pets/Dialogue.Pets");
const RiftGuardian = require("./pets/RiftGuardian.Pets");

const CURRENT_PET_ATTRIBUTE = "pets:current";
/** The item of the follower the player logged out with; re-summoned on login. */
const LAST_PET_ATTRIBUTE = "pets:last";
/** Durable active follower, independent of physical inventory/bank item copies. */
const ACTIVE_PET_ATTRIBUTE = "pets:active-item";
const VARIANT_ATTRIBUTE = "pets:variant";
/** Pet families whose Metamorphosis forms the player has permanently unlocked. */
const MORPH_UNLOCK_ATTRIBUTE = "pets:morph-unlocks";
/** The kitten/cat growth, hunger and attention record; see the cat section. */
const CAT_ATTRIBUTE = "pets:cat";
/** How many fish the player has fed Gull toward its Gulliver metamorphosis (Wiki). */
const GULL_FED_ATTRIBUTE = "pets:gull-fed";
/** Every pet item the player has ever been awarded; Probita reclaims from it. */
const OWNED_ATTRIBUTE = "pets.owned";

const INTERACTION_ANIM = new Animation(827);
// RSProx229/2783 and239/4288: Lil' Zik pickup queues synth2582 with delay20.
// Keep the delay local to pet pickup; other uses of PICK_UP_ITEM are unchanged.
const PET_PICKUP_SOUND = new Sound(Sound.PICK_UP_ITEM.getId(), Sound.PICK_UP_ITEM.getVolume(), 20, Sound.PICK_UP_ITEM.getLoopType());
const FOLLOWER_INDEX_VARP = 447;
const FOLLOWER_ITEM_VARP = 448;
const MAX_XP = 200000000;
// RSProx229/2783 and239/4288: locked Lil' Zik Metamorphosis, on arrival.
const SANGUINE_DUST_UNLOCK = {permanent: true, name: "sanguine dust",
  message: "You need to earn sanguine dust from the Theatre of Blood Challenge Mode to do that."};
let pluginApi = null;
let TaskClass = null;
let TaskManagerRef = null;
let NPCRespawnTaskRef = null;
let ItemDefinitionClass = null;
/** Per-player task keys, so cancelling the cat clock never touches another plugin's tasks. */
const CAT_TASK_KEY = new WeakMap();

const PETS = [
  { enumName: "WISP", petId: NpcIdentifiers.WISP_2, houseNpcId: NpcIdentifiers.WISP, morphId: 0, itemId: 28246, dialogue: -1 },
  { enumName: "BUTCH", petId: NpcIdentifiers.BUTCH_2, houseNpcId: NpcIdentifiers.BUTCH, morphId: 0, itemId: 28248, dialogue: -1 },
  { enumName: "BARON", petId: NpcIdentifiers.BARON_2, houseNpcId: NpcIdentifiers.BARON, morphId: 0, itemId: 28250, dialogue: -1 },
  { enumName: "LILVIATHAN", petId: NpcIdentifiers.LILVIATHAN_2, houseNpcId: NpcIdentifiers.LILVIATHAN, morphId: 0, itemId: 28252, dialogue: -1 },
  // Araxxor: coagulated venom metamorphoses Nid into Rax (Wiki).
  { enumName: "NID", petId: 13683, morphId: 13684, itemId: 29836, dialogue: -1 },
  { enumName: "RAX", petId: 13684, morphId: 13683, itemId: 29836, dialogue: -1,
    morphUnlock: { itemId: ItemIdentifiers.COAGULATED_VENOM, consume: true, name: "coagulated venom" } },
  { enumName: "SCURRY", petId: NpcIdentifiers.SCURRY_2, houseNpcId: NpcIdentifiers.SCURRY, morphId: 0, itemId: 28801, dialogue: -1 },
  // Cache241:8336 is poh_verzik_pet;8337 verzik_pet is the normal follower.
  { enumName: "LIL_ZIK", petId: NpcIdentifiers.LIL_ZIK_2, morphId: NpcIdentifiers.LIL_MAIDEN_2, itemId: ItemIdentifiers.LIL_ZIK, familyItemId: ItemIdentifiers.LIL_ZIK, dialogue: -1 },
  { enumName: "LIL_MAIDEN", petId: NpcIdentifiers.LIL_MAIDEN_2, morphId: NpcIdentifiers.LIL_BLOAT_2, itemId: ItemIdentifiers.LIL_MAIDEN, familyItemId: ItemIdentifiers.LIL_ZIK, dialogue: -1, morphUnlock: SANGUINE_DUST_UNLOCK },
  { enumName: "LIL_BLOAT", petId: NpcIdentifiers.LIL_BLOAT_2, morphId: NpcIdentifiers.LIL_NYLO_2, itemId: ItemIdentifiers.LIL_BLOAT, familyItemId: ItemIdentifiers.LIL_ZIK, dialogue: -1, morphUnlock: SANGUINE_DUST_UNLOCK },
  { enumName: "LIL_NYLO", petId: NpcIdentifiers.LIL_NYLO_2, morphId: NpcIdentifiers.LIL_SOT_2, itemId: ItemIdentifiers.LIL_NYLO, familyItemId: ItemIdentifiers.LIL_ZIK, dialogue: -1, morphUnlock: SANGUINE_DUST_UNLOCK },
  { enumName: "LIL_SOT", petId: NpcIdentifiers.LIL_SOT_2, morphId: NpcIdentifiers.LIL_XARP_2, itemId: ItemIdentifiers.LIL_SOT, familyItemId: ItemIdentifiers.LIL_ZIK, dialogue: -1, morphUnlock: SANGUINE_DUST_UNLOCK },
  { enumName: "LIL_XARP", petId: NpcIdentifiers.LIL_XARP_2, morphId: NpcIdentifiers.LIL_ZIK_2, itemId: ItemIdentifiers.LIL_XARP, familyItemId: ItemIdentifiers.LIL_ZIK, dialogue: -1, morphUnlock: SANGUINE_DUST_UNLOCK },
  // Tombs of Amascut: each form uses its boss remnant (Wiki, Metamorphosis).
  { enumName: "TUMEKENS_GUARDIAN", petId: 11812, morphId: 11813, itemId: 27352, dialogue: -1 },
  { enumName: "ELIDINIS_GUARDIAN", petId: 11813, morphId: 11849, itemId: 27352, dialogue: -1,
    morphUnlock: { itemId: ItemIdentifiers.ANCIENT_REMNANT, consume: true, name: "an ancient remnant" } },
  { enumName: "ZEBO", petId: 11849, morphId: 11848, itemId: 27352, dialogue: -1,
    morphUnlock: { itemId: ItemIdentifiers.REMNANT_OF_ZEBAK, consume: true, name: "a remnant of Zebak" } },
  { enumName: "KEPHRITI", petId: 11848, morphId: 11847, itemId: 27352, dialogue: -1,
    morphUnlock: { itemId: ItemIdentifiers.REMNANT_OF_KEPHRI, consume: true, name: "a remnant of Kephri" } },
  { enumName: "BABI", petId: 11847, morphId: 11846, itemId: 27352, dialogue: -1,
    morphUnlock: { itemId: ItemIdentifiers.REMNANT_OF_BA_BA, consume: true, name: "a remnant of Ba-Ba" } },
  { enumName: "AKKHITO", petId: 11846, morphId: 11850, itemId: 27352, dialogue: -1,
    morphUnlock: { itemId: ItemIdentifiers.REMNANT_OF_AKKHA, consume: true, name: "a remnant of Akkha" } },
  { enumName: "TUMEKENS_DAMAGED_GUARDIAN", petId: 11850, morphId: 11812, itemId: 27352, dialogue: -1 },
  { enumName: "SMOL_HEREDIT", petId: NpcIdentifiers.SMOL_HEREDIT_2, morphId: 0, itemId: 28960, dialogue: -1, mainDrop: true },
  { enumName: "NEXLING", petId: NpcIdentifiers.NEXLING_2, houseNpcId: NpcIdentifiers.NEXLING, morphId: 0, itemId: 26348, dialogue: -1 },
  { enumName: "VORKI", petId: NpcIdentifiers.VORKI_2, houseNpcId: NpcIdentifiers.VORKI, morphId: 0, itemId: 21992, dialogue: -1 },
  // Phantom Muspah: each form change uses charged ice (Wiki, Metamorphosis).
  { enumName: "MUPHIN", petId: 12014, morphId: 12015, itemId: 27590, dialogue: -1,
    morphUnlock: { itemId: ItemIdentifiers.CHARGED_ICE, consume: true, name: "charged ice" } },
  { enumName: "MUPHIN_MELEE", petId: 12015, morphId: 12016, itemId: 27590, dialogue: -1,
    morphUnlock: { itemId: ItemIdentifiers.CHARGED_ICE, consume: true, name: "charged ice" } },
  { enumName: "MUPHIN_SHIELDED", petId: 12016, morphId: 12014, itemId: 27590, dialogue: -1,
    morphUnlock: { itemId: ItemIdentifiers.CHARGED_ICE, consume: true, name: "charged ice" } },
  // Soul Wars pets: free metamorphosis between two items (Wiki).
  { enumName: "LIL_CREATOR", petId: NpcIdentifiers.LIL_CREATOR_2, morphId: NpcIdentifiers.LIL_DESTRUCTOR_2, itemId: 25348, dialogue: -1, morphGroup: "lil-creator" },
  { enumName: "LIL_DESTRUCTOR", petId: NpcIdentifiers.LIL_DESTRUCTOR_2, morphId: NpcIdentifiers.LIL_CREATOR_2, itemId: 25350, dialogue: -1, morphGroup: "lil-creator" },
  { enumName: "JAL_NIB_REK", petId: 7675, morphId: 8011, itemId: 21291, dialogue: -1 },
  { enumName: "TZREK_ZUK", petId: 8011, morphId: 7675, itemId: 21291, dialogue: -1 },
  // Noon and Midnight are separate items but one free metamorphosis (Wiki).
  { enumName: "MIDNIGHT", petId: 7893, morphId: 7892, itemId: 21750, dialogue: -1, morphGroup: "noon" },
  { enumName: "NOON", petId: 7892, morphId: 7893, itemId: 21748, dialogue: -1, morphGroup: "noon" },
  { enumName: "HERBI", petId: NpcIdentifiers.HERBI_2, houseNpcId: NpcIdentifiers.HERBI, morphId: 0, itemId: 21509, dialogue: -1 },
  { enumName: "ABYSSAL_ORPHAN", petId: 5884, morphId: 0, itemId: 13262, dialogue: 202, mainDrop: true,
    getDialogue(player) {
      if (!player?.getAppearance?.()?.isMale?.()) return 206;
      const ids = [202, 209];
      return ids[Misc.getRandom(ids.length - 1)];
    } },
  { enumName: "DARK_CORE", petId: 318, morphId: 8010, itemId: 12816, dialogue: 123 },
  { enumName: "CORPOREAL_CRITTER", petId: 8010, morphId: 318, itemId: 12816, dialogue: 123 },
  { enumName: "VENENATIS_SPIDERLING", petId: 5557, morphId: 11985, itemId: 13177, dialogue: 126 },
  { enumName: "VENENATIS_SPIDERLING_LEGACY", petId: 11985, morphId: 5557, itemId: 13177, dialogue: 126 },
  { enumName: "CALLISTO_CUB", petId: 5558, morphId: 11986, itemId: 13178, dialogue: 130 },
  { enumName: "CALLISTO_CUB_LEGACY", petId: 11986, morphId: 5558, itemId: 13178, dialogue: 130 },
  {
    enumName: "HELLPUPPY",
    // Cache241 distinguishes the world follower from its menagerie definition.
    petId: NpcIdentifiers.HELLPUPPY_2,
    houseNpcId: NpcIdentifiers.HELLPUPPY,
    morphId: 0,
    itemId: 13247,
    dialogue: 138,
    getDialogue() {
      const ids = [138, 143, 145, 150, 154];
      return ids[Misc.getRandom(ids.length - 1)];
    },
  },
  { enumName: "CHAOS_ELEMENTAL_JR", petId: 2055, morphId: 0, itemId: 11995, dialogue: 158 },
  { enumName: "SNAKELING", petId: NpcIdentifiers.SNAKELING_7, morphId: NpcIdentifiers.SNAKELING_8, itemId: ItemIdentifiers.PET_SNAKELING, familyItemId: ItemIdentifiers.PET_SNAKELING, dialogue: 162 },
  { enumName: "MAGMA_SNAKELING", petId: NpcIdentifiers.SNAKELING_8, morphId: NpcIdentifiers.SNAKELING_9, itemId: ItemIdentifiers.PET_SNAKELING_2, familyItemId: ItemIdentifiers.PET_SNAKELING, dialogue: 169 },
  { enumName: "TANZANITE_SNAKELING", petId: NpcIdentifiers.SNAKELING_9, morphId: NpcIdentifiers.SNAKELING_7, itemId: ItemIdentifiers.PET_SNAKELING_3, familyItemId: ItemIdentifiers.PET_SNAKELING, dialogue: 176 },
  { enumName: "VETION_JR", petId: 5536, morphId: 5537, itemId: 13179, dialogue: 183 },
  { enumName: "VETION_JR_REBORN", petId: 5537, morphId: 5536, itemId: 13179, dialogue: 189 },
  { enumName: "SCORPIAS_OFFSPRING", petId: 5561, morphId: 0, itemId: 13181, dialogue: 195 },
  {
    enumName: "TZREK_JAD",
    petId: 5893,
    morphId: 10625,
    itemId: 13225,
    dialogue: 212,
    getDialogue() {
      const ids = [212, 217];
      return ids[Misc.getRandom(ids.length - 1)];
    },
  },
  { enumName: "JALREK_JAD", petId: 10625, morphId: 5893, itemId: 13225, dialogue: 212, morphUnlock: { unlockFlag: "tzhaar-ket-rak:challenge-6", name: "TzHaar-Ket-Rak's sixth challenge" } },
  { enumName: "SUPREME_HATCHLING", petId: 6628, morphId: 0, itemId: 12643, dialogue: 220 },
  { enumName: "PRIME_HATCHLING", petId: 6629, morphId: 0, itemId: 12644, dialogue: 223 },
  { enumName: "REX_HATCHLING", petId: 6630, morphId: 0, itemId: 12645, dialogue: 231 },
  { enumName: "CHICK_ARRA", petId: 6631, morphId: 0, itemId: 12649, dialogue: 239 },
  { enumName: "GENERAL_AWWDOR", petId: 6632, morphId: 0, itemId: 12650, dialogue: 247 },
  {
    enumName: "COMMANDER_MINIANA",
    petId: 6633,
    morphId: 0,
    itemId: 12651,
    dialogue: 250,
    getDialogue(player) {
      if (player?.getEquipment?.()?.contains?.(11806)) return 252;
      return 250;
    },
  },
  { enumName: "KRIL_TINYROTH", petId: 6634, morphId: 0, itemId: 12652, dialogue: 254 },
  { enumName: "BABY_MOLE", petId: 6635, morphId: 10651, itemId: 12646, dialogue: 261 },
  { enumName: "BABY_MOLE_RAT", petId: 10651, morphId: 6635, itemId: 12646, dialogue: 261,
    morphUnlock: { items: [ItemIdentifiers.MOLE_CLAW, ItemIdentifiers.MOLE_SKIN], consume: true, name: "a mole claw and mole skin" } },
  { enumName: "PRINCE_BLACK_DRAGON", petId: 6636, morphId: 0, itemId: 12653, dialogue: 267 },
  // The cache's Kalphite princess item is 12647; 12654 is the duplicate id drops never use.
  { enumName: "KALPHITE_PRINCESS", petId: 6637, morphId: 6638, itemId: 12647, dialogue: 271 },
  { enumName: "MORPHED_KALPHITE_PRINCESS", petId: 6638, morphId: 6637, itemId: 12647, dialogue: 279 },
  { enumName: "SMOKE_DEVIL", petId: NpcIdentifiers.SMOKE_DEVIL_2, morphId: NpcIdentifiers.SMOKE_DEVIL_5, itemId: ItemIdentifiers.PET_SMOKE_DEVIL, familyItemId: ItemIdentifiers.PET_SMOKE_DEVIL, dialogue: 288 },
  { enumName: "SMOKE_DEVIL_NORMAL", petId: NpcIdentifiers.SMOKE_DEVIL_5, morphId: NpcIdentifiers.SMOKE_DEVIL_2, itemId: ItemIdentifiers.PET_SMOKE_DEVIL_2, familyItemId: ItemIdentifiers.PET_SMOKE_DEVIL, dialogue: 288 },
  { enumName: "KRAKEN", petId: 6640, morphId: 0, itemId: 12655, dialogue: 291 },
  { enumName: "PENANCE_PRINCESS", petId: NpcIdentifiers.PENANCE_PET_2, houseNpcId: NpcIdentifiers.PENANCE_PET, morphId: 0, itemId: 12703, dialogue: 296 },
  // Cache241 enum1711 identifies the physical items; keep the legacy family key for dust/saves.
  { enumName: "OLMLET", petId: NpcIdentifiers.OLMLET_2, morphId: NpcIdentifiers.PUPPADILE_2, itemId: ItemIdentifiers.OLMLET, familyItemId: ItemIdentifiers.OLMLET, dialogue: 298 },
  { enumName: "PUPPADILE", petId: NpcIdentifiers.PUPPADILE_2, morphId: NpcIdentifiers.TEKTINY_2, itemId: ItemIdentifiers.PUPPADILE, familyItemId: ItemIdentifiers.OLMLET, dialogue: 298, morphUnlock: { permanent: true, name: "metamorphic dust" } },
  { enumName: "TEKTINY", petId: NpcIdentifiers.TEKTINY_2, morphId: NpcIdentifiers.ENRAGED_TEKTINY_2, itemId: ItemIdentifiers.TEKTINY, familyItemId: ItemIdentifiers.OLMLET, dialogue: 298, morphUnlock: { permanent: true, name: "metamorphic dust" } },
  { enumName: "ENRAGED_TEKTINY", petId: NpcIdentifiers.ENRAGED_TEKTINY_2, morphId: NpcIdentifiers.VANGUARD_7, itemId: ItemIdentifiers.ENRAGED_TEKTINY, familyItemId: ItemIdentifiers.OLMLET, dialogue: 298, morphUnlock: { permanent: true, name: "metamorphic dust" } },
  { enumName: "VANGUARD_PET", petId: NpcIdentifiers.VANGUARD_7, morphId: NpcIdentifiers.VASA_MINIRIO_2, itemId: ItemIdentifiers.VANGUARD, familyItemId: ItemIdentifiers.OLMLET, dialogue: 298, morphUnlock: { permanent: true, name: "metamorphic dust" } },
  { enumName: "VASA_MINIRIO", petId: NpcIdentifiers.VASA_MINIRIO_2, morphId: NpcIdentifiers.VESPINA_2, itemId: ItemIdentifiers.VASA_MINIRIO, familyItemId: ItemIdentifiers.OLMLET, dialogue: 298, morphUnlock: { permanent: true, name: "metamorphic dust" } },
  { enumName: "VESPINA", petId: NpcIdentifiers.VESPINA_2, morphId: NpcIdentifiers.FLYING_VESPINA_2, itemId: ItemIdentifiers.VESPINA, familyItemId: ItemIdentifiers.OLMLET, dialogue: 298, morphUnlock: { permanent: true, name: "metamorphic dust" } },
  { enumName: "FLYING_VESPINA", petId: NpcIdentifiers.FLYING_VESPINA_2, morphId: NpcIdentifiers.OLMLET_2, itemId: ItemIdentifiers.FLYING_VESPINA, familyItemId: ItemIdentifiers.OLMLET, dialogue: 298, morphUnlock: { permanent: true, name: "metamorphic dust" } },
  { enumName: "SKOTOS", petId: NpcIdentifiers.SKOTOS_2, houseNpcId: NpcIdentifiers.SKOTOS, morphId: 0, itemId: 21273, dialogue: 298 },
  { enumName: "IKKLE_HYDRA", petId: NpcIdentifiers.IKKLE_HYDRA, morphId: NpcIdentifiers.IKKLE_HYDRA_2, itemId: 22746, dialogue: -1 },
  { enumName: "IKKLE_HYDRA_ELECTRIC", petId: NpcIdentifiers.IKKLE_HYDRA_2, morphId: NpcIdentifiers.IKKLE_HYDRA_3, itemId: 22746, dialogue: -1 },
  { enumName: "IKKLE_HYDRA_FIRE", petId: NpcIdentifiers.IKKLE_HYDRA_3, morphId: NpcIdentifiers.IKKLE_HYDRA_4, itemId: 22746, dialogue: -1 },
  { enumName: "IKKLE_HYDRA_EXTINGUISHED", petId: NpcIdentifiers.IKKLE_HYDRA_4, morphId: NpcIdentifiers.IKKLE_HYDRA, itemId: 22746, dialogue: -1 },
  // Cache `isFollower` ids: 2144/11159/11160 are the pet; 2143/11157/11158 are static copies.
  { enumName: "SRARACHA", petId: 2144, morphId: 11159, itemId: 23495, dialogue: -1 },
  { enumName: "SRARACHA_2", petId: 11159, morphId: 11160, itemId: 23495, dialogue: -1, morphUnlock: { itemId: ItemIdentifiers.BLUE_EGG_SAC, consume: true, name: "blue egg sac" } },
  { enumName: "SRARACHA_3", petId: 11160, morphId: 2144, itemId: 23495, dialogue: -1, morphUnlock: { itemId: ItemIdentifiers.ORANGE_EGG_SAC, consume: true, name: "orange egg sac" } },
  { enumName: "SMOLCANO", petId: NpcIdentifiers.SMOLCANO_2, morphId: 0, itemId: 23760, dialogue: -1 },
  { enumName: "LITTLE_NIGHTMARE", petId: NpcIdentifiers.LITTLE_NIGHTMARE_2, morphId: NpcIdentifiers.LITTLE_PARASITE_2, itemId: 24491, dialogue: -1 },
  // The metamorph keeps the Little nightmare item (24491); the cache's separate Little
  // parasite item is not what the metamorphosis returns.
  { enumName: "LITTLE_PARASITE_PET", petId: NpcIdentifiers.LITTLE_PARASITE_2, morphId: NpcIdentifiers.LITTLE_NIGHTMARE_2, itemId: 24491, dialogue: -1,
    morphUnlock: { itemId: ItemIdentifiers.PARASITIC_EGG, consume: true, name: "a parasitic egg" } },
  { enumName: "YOUNGLLEF", petId: NpcIdentifiers.YOUNGLLEF_2, morphId: NpcIdentifiers.CORRUPTED_YOUNGLLEF_2, itemId: 23757, dialogue: -1 },
  { enumName: "CORRUPTED_YOUNGLLEF", petId: NpcIdentifiers.CORRUPTED_YOUNGLLEF_2, morphId: NpcIdentifiers.YOUNGLLEF_2, itemId: 23757, dialogue: -1, morphUnlock: { attribute: "gauntlet:stats", path: ["completions", "corrupted"], min: 1, name: "a Corrupted Gauntlet completion" } },
  { enumName: "TINY_TEMPOR", petId: NpcIdentifiers.TINY_TEMPOR_2, morphId: 0, itemId: 25602, dialogue: -1 },
  { enumName: "ABYSSAL_PROTECTOR", petId: NpcIdentifiers.ABYSSAL_PROTECTOR_2, morphId: 0, itemId: 26901, dialogue: -1 },
  { enumName: "HUBERTE", petId: NpcIdentifiers.HUBERTE_2, morphId: 0, itemId: 30152, dialogue: -1 },
  { enumName: "MOXI", petId: NpcIdentifiers.MOXI_2, morphId: 0, itemId: 30154, dialogue: -1 },
  { enumName: "BRAN", petId: NpcIdentifiers.BRAN_2, morphId: 12595, itemId: 30622, dialogue: -1 },
  { enumName: "RIC", petId: 12595, morphId: NpcIdentifiers.BRAN_2, itemId: 30622, dialogue: -1 },
  { enumName: "YAMI", petId: NpcIdentifiers.YAMI_2, morphId: 0, itemId: 30888, dialogue: -1 },
  { enumName: "DOM", petId: NpcIdentifiers.DOM_2, morphId: 0, itemId: 31130, dialogue: -1 },
  // The follower Gulldamar look: 14931 carries the Metamorph option live.
  { enumName: "GULL", petId: NpcIdentifiers.GULL_7, morphId: 14932, itemId: 31285, dialogue: -1 },
  { enumName: "GULLIVER", petId: 14932, morphId: NpcIdentifiers.GULL_7, itemId: 31285, dialogue: -1,
    morphUnlock: { attribute: "pets:gull-fed", path: [], min: 50, name: "to feed Gull 50 raw or cooked fish" } },
  // Beef, Maggot marquess, Mr McGroot and Aggy: the base NPC is the world follower (`isFollower`)
  // and the `_2` id is the menagerie copy, the reverse of the older pet pairs (cache 241).
  { enumName: "BEEF", petId: NpcIdentifiers.BEEF, houseNpcId: NpcIdentifiers.BEEF_2, morphId: 0, itemId: ItemIdentifiers.BEEF, dialogue: -1 },
  { enumName: "MAGGOT_MARQUESS", petId: NpcIdentifiers.MAGGOT_MARQUESS, houseNpcId: NpcIdentifiers.MAGGOT_MARQUESS_2, morphId: 0, itemId: ItemIdentifiers.MAGGOT_MARQUESS, dialogue: -1 },
  { enumName: "MR_MCGROOT", petId: NpcIdentifiers.MR_MCGROOT, houseNpcId: NpcIdentifiers.MR_MCGROOT_2, morphId: 0, itemId: ItemIdentifiers.MR_MCGROOT, dialogue: -1 },
  { enumName: "AGGY", petId: NpcIdentifiers.AGGY, houseNpcId: NpcIdentifiers.AGGY_2, morphId: 0, itemId: ItemIdentifiers.AGGY, dialogue: -1 },
  // The Wiki requires claiming the elite Western Provinces reward, not just task completion.
  { enumName: "CHOMPY_CHICK", petId: NpcIdentifiers.CHOMPY_CHICK_2, morphId: 0, itemId: 13071, dialogue: -1,
    requiredDiaryReward: { diary: "western", tier: "elite" } },
  { enumName: "BLOODHOUND", petId: NpcIdentifiers.BLOODHOUND_2, morphId: 0, itemId: 19730, dialogue: -1 },

  // Wintertodt's reward cart (followers are 7370, as in live captures). The four colour
  // forms (3081-3084) each need their firelighter; the Wiki colour order is used.
  { enumName: "PHOENIX", petId: NpcIdentifiers.PHOENIX_2, morphId: NpcIdentifiers.PHOENIX_7, itemId: 20693, dialogue: -1 },
  { enumName: "PHOENIX_BLUE", petId: NpcIdentifiers.PHOENIX_7, morphId: NpcIdentifiers.PHOENIX_8, itemId: 20693, dialogue: -1,
    morphUnlock: { itemId: ItemIdentifiers.BLUE_FIRELIGHTER, consume: true, name: "a blue firelighter" } },
  { enumName: "PHOENIX_GREEN", petId: NpcIdentifiers.PHOENIX_8, morphId: NpcIdentifiers.PHOENIX_9, itemId: 20693, dialogue: -1,
    morphUnlock: { itemId: ItemIdentifiers.GREEN_FIRELIGHTER, consume: true, name: "a green firelighter" } },
  { enumName: "PHOENIX_PURPLE", petId: NpcIdentifiers.PHOENIX_9, morphId: NpcIdentifiers.PHOENIX_10, itemId: 20693, dialogue: -1,
    morphUnlock: { itemId: ItemIdentifiers.PURPLE_FIRELIGHTER, consume: true, name: "a purple firelighter" } },
  { enumName: "PHOENIX_WHITE", petId: NpcIdentifiers.PHOENIX_10, morphId: NpcIdentifiers.PHOENIX_2, itemId: 20693, dialogue: -1,
    morphUnlock: { itemId: ItemIdentifiers.WHITE_FIRELIGHTER, consume: true, name: "a white firelighter" } },
  { enumName: "HERON", petId: 6722, morphId: 10636, itemId: 13320, dialogue: -1, skill: Skill.FISHING, chance: 5000 },
  { enumName: "GREAT_BLUE_HERON", petId: 10636, morphId: 6722, itemId: 13320, dialogue: -1, skill: Skill.FISHING, chance: 5000, morphUnlock: { itemId: ItemIdentifiers.SPIRIT_FLAKES, permanent: true, name: "spirit flakes" } },
  {
    enumName: "BEAVER",
    petId: NpcIdentifiers.BEAVER_11,
    dialogueVariant: "standard-dialogue-normal-variant",
    morphId: 0,
    itemId: 13322,
    dialogue: -1,
    skill: Skill.WOODCUTTING,
    chance: 5000,
  },
  {
    enumName: "GREY_CHINCHOMPA",
    petId: NpcIdentifiers.BABY_CHINCHOMPA_6,
    houseNpcId: NpcIdentifiers.BABY_CHINCHOMPA_2,
    morphId: NpcIdentifiers.BABY_CHINCHOMPA_7,
    familyItemId: ItemIdentifiers.BABY_CHINCHOMPA,
    dialogueVariant: "standard-dialogue-black-grey-red",
    itemId: 13324,
    dialogue: -1,
    skill: Skill.HUNTER,
    chance: 3000,
  },
  {
    enumName: "RED_CHINCHOMPA",
    petId: NpcIdentifiers.BABY_CHINCHOMPA_5,
    houseNpcId: NpcIdentifiers.BABY_CHINCHOMPA,
    morphId: NpcIdentifiers.BABY_CHINCHOMPA_6,
    familyItemId: ItemIdentifiers.BABY_CHINCHOMPA,
    dialogueVariant: "standard-dialogue-black-grey-red",
    itemId: 13323,
    dialogue: -1,
    skill: Skill.HUNTER,
    chance: 4000,
  },
  {
    enumName: "BLACK_CHINCHOMPA",
    petId: NpcIdentifiers.BABY_CHINCHOMPA_7,
    houseNpcId: NpcIdentifiers.BABY_CHINCHOMPA_3,
    morphId: NpcIdentifiers.BABY_CHINCHOMPA_5,
    familyItemId: ItemIdentifiers.BABY_CHINCHOMPA,
    dialogueVariant: "standard-dialogue-black-grey-red",
    itemId: 13325,
    dialogue: -1,
    skill: Skill.HUNTER,
    chance: 5000,
  },
  {
    enumName: "ROCK_GOLEM",
    petId: NpcIdentifiers.ROCK_GOLEM_20,
    houseNpcId: NpcIdentifiers.ROCK_GOLEM_8,
    dialogueVariant: "standard-dialogue-normal-variant",
    morphId: 0,
    itemId: 13321,
    dialogue: -1,
    skill: Skill.MINING,
    chance: 5000,
  },
  {
    enumName: "GIANT_SQUIRREL",
    petId: NpcIdentifiers.GIANT_SQUIRREL_2,
    houseNpcId: NpcIdentifiers.GIANT_SQUIRREL,
    morphId: 0,
    itemId: 20659,
    dialogue: -1,
    skill: Skill.AGILITY,
    chance: 5000,
  },
  {
    enumName: "TANGLEROOT",
    petId: NpcIdentifiers.TANGLEROOT_2,
    houseNpcId: NpcIdentifiers.TANGLEROOT,
    morphId: 0,
    itemId: 20661,
    dialogue: -1,
    dialogueVariant: "standard-dialogue",
    dialogueForm: "normal",
    skill: Skill.FARMING,
    chance: 5000,
  },
  {
    enumName: "ROCKY",
    petId: 7336,
    morphId: 0,
    itemId: 20663,
    dialogue: -1,
    skill: Skill.THIEVING,
    chance: 5000,
  },
  {
    enumName: "SOUP",
    petId: NpcIdentifiers.SOUP,
    morphId: 0,
    itemId: 31283,
    dialogue: -1,
    skill: Skill.SAILING,
    // Sailors roll Soup per action's own chance (Salvaging passes petChance); the flat
    // base keeps the entry resolvable for the skill event registration.
    chance: 800000,
  },

  // Kitten items 1555-1560: the quest grants the kitten; the item is the durable form.
  // The cache gives the six kitten followers ids 5591-5596 but does not link item colour
  // to npc, so the parallel item/npc order is used and a colour mismatch is possible.
  // ponytail: no kitten growth timer; a kitten stays a kitten until grown elsewhere.
  { enumName: "PET_KITTEN", petId: 5591, morphId: 0, itemId: 1555, dialogue: -1, reclaimable: false },
  { enumName: "PET_KITTEN_2", petId: 5592, morphId: 0, itemId: 1556, dialogue: -1, reclaimable: false },
  { enumName: "PET_KITTEN_3", petId: 5593, morphId: 0, itemId: 1557, dialogue: -1, reclaimable: false },
  { enumName: "PET_KITTEN_4", petId: 5594, morphId: 0, itemId: 1558, dialogue: -1, reclaimable: false },
  { enumName: "PET_KITTEN_5", petId: 5595, morphId: 0, itemId: 1559, dialogue: -1, reclaimable: false },
  { enumName: "PET_KITTEN_6", petId: 5596, morphId: 0, itemId: 1560, dialogue: -1, reclaimable: false },

  // Adult, overgrown and hell cat stages. The Wiki infobox lists kitten NPCs/items, adult
  // NPCs/items and overgrown NPCs/items in the same colour order, so the parallel order is
  // the mapping. Wily/lazy cats need Ratcatchers, which is not implemented.
  { enumName: "PET_CAT", petId: 1619, morphId: 0, itemId: 1561, dialogue: -1, reclaimable: false },
  { enumName: "PET_CAT_2", petId: 1620, morphId: 0, itemId: 1562, dialogue: -1, reclaimable: false },
  { enumName: "PET_CAT_3", petId: 1621, morphId: 0, itemId: 1563, dialogue: -1, reclaimable: false },
  { enumName: "PET_CAT_4", petId: 1622, morphId: 0, itemId: 1564, dialogue: -1, reclaimable: false },
  { enumName: "PET_CAT_5", petId: 1623, morphId: 0, itemId: 1565, dialogue: -1, reclaimable: false },
  { enumName: "PET_CAT_6", petId: 1624, morphId: 0, itemId: 1566, dialogue: -1, reclaimable: false },
  { enumName: "OVERGROWN_CAT", petId: 5598, morphId: 0, itemId: 1567, dialogue: -1, reclaimable: false },
  { enumName: "OVERGROWN_CAT_2", petId: 5599, morphId: 0, itemId: 1568, dialogue: -1, reclaimable: false },
  { enumName: "OVERGROWN_CAT_3", petId: 5600, morphId: 0, itemId: 1569, dialogue: -1, reclaimable: false },
  { enumName: "OVERGROWN_CAT_4", petId: 5601, morphId: 0, itemId: 1570, dialogue: -1, reclaimable: false },
  { enumName: "OVERGROWN_CAT_5", petId: 5602, morphId: 0, itemId: 1571, dialogue: -1, reclaimable: false },
  { enumName: "OVERGROWN_CAT_6", petId: 5603, morphId: 0, itemId: 1572, dialogue: -1, reclaimable: false },
  { enumName: "HELL_KITTEN", petId: 5597, morphId: 0, itemId: 7583, dialogue: -1, reclaimable: false },
  { enumName: "HELLCAT", petId: 1625, morphId: 0, itemId: 7582, dialogue: -1, reclaimable: false },
  { enumName: "OVERGROWN_HELLCAT", petId: 5604, morphId: 0, itemId: 7581, dialogue: -1, reclaimable: false },

  {
    enumName: "FIRE_RIFT_GUARDIAN",
    petId: NpcIdentifiers.RIFT_GUARDIAN_15,
    houseNpcId: NpcIdentifiers.RIFT_GUARDIAN,
    morphId: 0,
    itemId: 20665,
    familyItemId: ItemIdentifiers.RIFT_GUARDIAN,
    dialogue: -1,
    skill: Skill.RUNECRAFTING,
    chance: 8000,
  },
  {
    enumName: "AIR_RIFT_GUARDIAN",
    petId: NpcIdentifiers.RIFT_GUARDIAN_16,
    houseNpcId: NpcIdentifiers.RIFT_GUARDIAN_2,
    morphId: 0,
    itemId: 20667,
    familyItemId: ItemIdentifiers.RIFT_GUARDIAN,
    dialogue: -1,
    skill: Skill.RUNECRAFTING,
    chance: 8000,
  },
  {
    enumName: "MIND_RIFT_GUARDIAN",
    petId: NpcIdentifiers.RIFT_GUARDIAN_17,
    houseNpcId: NpcIdentifiers.RIFT_GUARDIAN_3,
    morphId: 0,
    itemId: 20669,
    familyItemId: ItemIdentifiers.RIFT_GUARDIAN,
    dialogue: -1,
    skill: Skill.RUNECRAFTING,
    chance: 8000,
  },
  {
    enumName: "WATER_RIFT_GUARDIAN",
    petId: NpcIdentifiers.RIFT_GUARDIAN_18,
    houseNpcId: NpcIdentifiers.RIFT_GUARDIAN_4,
    morphId: 0,
    itemId: 20671,
    familyItemId: ItemIdentifiers.RIFT_GUARDIAN,
    dialogue: -1,
    skill: Skill.RUNECRAFTING,
    chance: 8000,
  },
  {
    enumName: "EARTH_RIFT_GUARDIAN",
    petId: NpcIdentifiers.RIFT_GUARDIAN_19,
    houseNpcId: NpcIdentifiers.RIFT_GUARDIAN_5,
    morphId: 0,
    itemId: 20673,
    familyItemId: ItemIdentifiers.RIFT_GUARDIAN,
    dialogue: -1,
    skill: Skill.RUNECRAFTING,
    chance: 8000,
  },
  {
    enumName: "BODY_RIFT_GUARDIAN",
    petId: NpcIdentifiers.RIFT_GUARDIAN_20,
    houseNpcId: NpcIdentifiers.RIFT_GUARDIAN_6,
    morphId: 0,
    itemId: 20675,
    familyItemId: ItemIdentifiers.RIFT_GUARDIAN,
    dialogue: -1,
    skill: Skill.RUNECRAFTING,
    chance: 8000,
  },
  {
    enumName: "COSMIC_RIFT_GUARDIAN",
    petId: NpcIdentifiers.RIFT_GUARDIAN_21,
    houseNpcId: NpcIdentifiers.RIFT_GUARDIAN_7,
    morphId: 0,
    itemId: 20677,
    familyItemId: ItemIdentifiers.RIFT_GUARDIAN,
    dialogue: -1,
    skill: Skill.RUNECRAFTING,
    chance: 8000,
  },
  {
    enumName: "CHAOS_RIFT_GUARDIAN",
    petId: NpcIdentifiers.RIFT_GUARDIAN_22,
    houseNpcId: NpcIdentifiers.RIFT_GUARDIAN_8,
    morphId: 0,
    itemId: 20679,
    familyItemId: ItemIdentifiers.RIFT_GUARDIAN,
    dialogue: -1,
    skill: Skill.RUNECRAFTING,
    chance: 8000,
  },
  {
    enumName: "NATURE_RIFT_GUARDIAN",
    petId: NpcIdentifiers.RIFT_GUARDIAN_23,
    houseNpcId: NpcIdentifiers.RIFT_GUARDIAN_9,
    morphId: 0,
    itemId: 20681,
    familyItemId: ItemIdentifiers.RIFT_GUARDIAN,
    dialogue: -1,
    skill: Skill.RUNECRAFTING,
    chance: 8000,
  },
  {
    enumName: "LAW_RIFT_GUARDIAN",
    petId: NpcIdentifiers.RIFT_GUARDIAN_24,
    houseNpcId: NpcIdentifiers.RIFT_GUARDIAN_10,
    morphId: 0,
    itemId: 20683,
    familyItemId: ItemIdentifiers.RIFT_GUARDIAN,
    dialogue: -1,
    skill: Skill.RUNECRAFTING,
    chance: 8000,
  },
  {
    enumName: "DEATH_RIFT_GUARDIAN",
    petId: NpcIdentifiers.RIFT_GUARDIAN_25,
    houseNpcId: NpcIdentifiers.RIFT_GUARDIAN_11,
    morphId: 0,
    itemId: 20685,
    familyItemId: ItemIdentifiers.RIFT_GUARDIAN,
    dialogue: -1,
    skill: Skill.RUNECRAFTING,
    chance: 8000,
  },
  {
    enumName: "SOUL_RIFT_GUARDIAN",
    petId: NpcIdentifiers.RIFT_GUARDIAN_26,
    houseNpcId: NpcIdentifiers.RIFT_GUARDIAN_12,
    morphId: 0,
    itemId: 20687,
    familyItemId: ItemIdentifiers.RIFT_GUARDIAN,
    dialogue: -1,
    skill: Skill.RUNECRAFTING,
    chance: 8000,
  },
  {
    enumName: "ASTRAL_RIFT_GUARDIAN",
    petId: NpcIdentifiers.RIFT_GUARDIAN_27,
    houseNpcId: NpcIdentifiers.RIFT_GUARDIAN_13,
    morphId: 0,
    itemId: 20689,
    familyItemId: ItemIdentifiers.RIFT_GUARDIAN,
    dialogue: -1,
    skill: Skill.RUNECRAFTING,
    chance: 8000,
  },
  {
    enumName: "BLOOD_RIFT_GUARDIAN",
    petId: NpcIdentifiers.RIFT_GUARDIAN_28,
    houseNpcId: NpcIdentifiers.RIFT_GUARDIAN_14,
    morphId: 0,
    itemId: 20691,
    familyItemId: ItemIdentifiers.RIFT_GUARDIAN,
    dialogue: -1,
    skill: Skill.RUNECRAFTING,
    chance: 8000,
  },
  { enumName: "WRATH_RIFT_GUARDIAN", petId: NpcIdentifiers.RIFT_GUARDIAN_30, houseNpcId: NpcIdentifiers.RIFT_GUARDIAN_29, morphId: 0, itemId: ItemIdentifiers.RIFT_GUARDIAN_15, familyItemId: ItemIdentifiers.RIFT_GUARDIAN, dialogue: -1, skill: Skill.RUNECRAFTING, chance: 8000 },
];

// Cache puppy followers and their inventory forms have the same colour order;
// each real item is followed by its bank placeholder.
const FIRST_PUPPY_NPC_ID = NpcIdentifiers.LABRADOR_PUPPY;
const LAST_PUPPY_NPC_ID = NpcIdentifiers.YORKIE_PUPPY_3;
const FIRST_PUPPY_ITEM_ID = ItemIdentifiers.LABRADOR_PUPPY;
for (let npcId = FIRST_PUPPY_NPC_ID; npcId <= LAST_PUPPY_NPC_ID; npcId++) {
  PETS.push({ enumName: `SHELTER_PUPPY_${npcId}`, petId: npcId, morphId: 0,
    itemId: FIRST_PUPPY_ITEM_ID + (npcId - FIRST_PUPPY_NPC_ID) * 2,
    dialogue: -1, reclaimable: false, puppy: true });
}

const PET_BY_ID = new Map();
const PET_BY_HOUSE_ID = new Map();
const PET_BY_ITEM_ID = new Map();
const PET_BY_NAME = new Map();

for (const pet of PETS) {
  PET_BY_ID.set(pet.petId, pet);
  if (Number.isInteger(pet.houseNpcId)) PET_BY_HOUSE_ID.set(pet.houseNpcId, pet);
  PET_BY_NAME.set(pet.enumName, pet);
  if (Number.isInteger(pet.itemId) && !PET_BY_ITEM_ID.has(pet.itemId)) {
    PET_BY_ITEM_ID.set(pet.itemId, pet);
  }
}

const SKILLING_PETS = [
  PET_BY_NAME.get("HERON"),
  PET_BY_NAME.get("BEAVER"),
  PET_BY_NAME.get("GREY_CHINCHOMPA"),
  PET_BY_NAME.get("RED_CHINCHOMPA"),
  PET_BY_NAME.get("BLACK_CHINCHOMPA"),
  PET_BY_NAME.get("ROCK_GOLEM"),
  PET_BY_NAME.get("GIANT_SQUIRREL"),
  PET_BY_NAME.get("TANGLEROOT"),
  PET_BY_NAME.get("ROCKY"),
  PET_BY_NAME.get("SOUP"),
  ...PETS.filter((pet) => pet.enumName.endsWith("_RIFT_GUARDIAN")),
].filter((pet) => pet != null);

/** A skill has one pet whatever its colour; a morph group one pet across items; otherwise its item. */
function petFamily(pet) {
  if (pet.morphGroup) return `group:${pet.morphGroup}`;
  return pet.skill != null ? `skill:${normalizeSkillName(pet.skill)}` : `item:${pet.familyItemId ?? pet.itemId}`;
}

function getOwnedPetItems(player) {
  const owned = player.getAttribute(OWNED_ATTRIBUTE);
  return Array.isArray(owned) ? owned.filter((itemId) => getPetForItemId(itemId)).map((itemId) => {
    const pet = getPetForItemId(itemId);
    // Legacy ownership only stored the base item, even when the lost pet had a form.
    if (pet.familyItemId === itemId) {
      const variant = getPetByNpcId(getStoredVariant(player, pet));
      if (variant) return variant.itemId;
    }
    return itemId;
  }) : [];
}

function ownsPetFamily(player, pet) {
  const family = petFamily(pet);
  return getOwnedPetItems(player).some((itemId) => {
    const owned = getPetForItemId(itemId);
    return owned != null && petFamily(owned) === family;
  });
}

function recordOwnership(player, pet) {
  if (pet?.reclaimable === false) return;
  const family = petFamily(pet);
  const owned = getOwnedPetItems(player);
  // One ownership record per pet family: a metamorphosis that changes the item (a
  // rift guardian's colour) replaces the old record instead of insuring both.
  const others = owned.filter((itemId) => {
    const other = getPetForItemId(itemId);
    return other == null || petFamily(other) !== family;
  });
  if (others.length === owned.length && owned.includes(pet.itemId)) return;
  player.setAttribute(OWNED_ATTRIBUTE, [...others, pet.itemId]);
  pluginApi.emitCustomEvent("persistence:save", { player, reason: "pet-insurance" });
  syncCollectionLog(player, { silent: false });
}

/** The collection log lists one item per pet: a skilling pet's base colour, never a morph. */
function collectionLogItemId(pet) {
  // A physical family's insurance/menagerie base need not be its Collection Log
  // item: chinchompas store under red, but the log lists grey.
  if (pet?.skill != null) {
    const base = SKILLING_PETS.find((candidate) => candidate.skill === pet.skill);
    return base?.itemId ?? pet.familyItemId ?? pet.itemId;
  }
  return pet?.familyItemId ?? pet?.itemId;
}

/**
 * Makes sure every owned pet is in the collection log (plugins/achievements/collectionlog/). Only a newly
 * recorded pet announces itself; login and reclaiming re-sync silently.
 */
function syncCollectionLog(player, { silent = true } = {}) {
  if (!player || !pluginApi) return;
  for (const itemId of getOwnedPetItems(player)) {
    const logId = collectionLogItemId(getPetForItemId(itemId));
    if (Number.isInteger(logId)) pluginApi.emitCustomEvent("collection-log:obtain", { player, itemId: logId, ensure: true, silent });
  }
}

/** One pet item into the backpack, or the ground when there is no space. */
function deliverPetItem(player, itemId) {
  if (!player.getInventory().isFull()) {
    player.getInventory().adds(itemId, 1);
    return true;
  }
  ItemOnGroundManager.registerNonGlobal(player, new Item(itemId));
  return false;
}

/**
 * Awards a pet the way OSRS does: a follower if there is none, otherwise into the
 * backpack; a pet the player already owns is a "would have been followed" miss,
 * unless the pet is a main drop (Abyssal orphan, Smol Heredit) which always lands.
 */
function awardPet(player, itemId) {
  const pet = getPetForItemId(itemId);
  if (!pet) return false;
  // Conditions the drop table cannot express (a diary gate) are enforced here; the roll is
  // consumed without a pet so the source can never grant it early.
  if (!Acquisition.eligible(player, pet)) return false;
  if (ownsPetFamily(player, pet)) {
    if (pet.mainDrop) {
      deliverPetItem(player, pet.itemId);
      return true;
    }
    player.sendMessage("You have a funny feeling like you would have been followed...");
    return false;
  }
  recordOwnership(player, pet);
  const following = player.getAttribute?.(CURRENT_PET_ATTRIBUTE)?.isRegistered?.() === true;
  if (following && player.getInventory().isFull()) {
    // OSRS then loses the pet to Probita; the owned record lets her return it.
    player.sendMessage("You have a funny feeling like you would have been followed... Probita can help.");
    return true;
  }
  if (following) {
    player.getInventory().adds(pet.itemId, 1);
    player.sendMessage("You feel something weird sneaking into your backpack.");
    return true;
  }
  return drop(player, pet.itemId, true);
}

/**
 * `pets:award` { player, itemId, source }: content-owned sources (a minigame reward,
 * a gamble) ask the follower system to deliver a pet through the normal award path.
 */
function awardPetRequest(request) {
  if (!request?.player || !Number.isInteger(request.itemId)) return;
  request.awarded = awardPet(request.player, request.itemId);
}

/** Does the player hold this pet item anywhere (follower, inventory, bank)? */
function holdsPetItem(player, itemId) {
  const current = player.getAttribute?.(CURRENT_PET_ATTRIBUTE);
  if (current?.isRegistered?.() && getPetByNpcId(current.getId())?.itemId === itemId) return true;
  if (player.getInventory?.()?.contains?.(itemId)) return true;
  const banks = player.getBanks?.() ?? [];
  for (let tab = 0; tab < Bank.TOTAL_BANK_TABS; tab++) {
    if (tab !== Bank.BANK_SEARCH_TAB_INDEX && banks[tab]?.contains?.(itemId)) return true;
  }
  // Somewhere else that keeps pets (a player-owned house's menagerie) answers for its own.
  const request = { player, itemId, held: false };
  pluginApi?.emitCustomEvent("pets:held-elsewhere", request);
  return request.held;
}

/** Probita's "Let's have a look...": every insured pet the player no longer has comes back. */
/**
 * "pets:current" { player, pet }: answers with the player's follower in the world, if any
 * (Temple Trekking's followers won't leave while one wanders).
 */
function answerCurrentPet(request) {
  const pet = request?.player?.getAttribute?.(CURRENT_PET_ATTRIBUTE);
  if (pet?.isRegistered?.()) request.pet = pet;
}

/**
 * "pets:owns" { player, itemId, owns }: whether the player owns the pet that item is (or one of
 * its family), as the Font of Consumption asks before it rolls an unsired.
 */
function answerOwnsPet(request) {
  const pet = getPetForItemId(request?.itemId);
  if (pet && request.player && ownsPetFamily(request.player, pet)) request.owns = true;
}

function answerPetDefinitions(request) {
  request.pets = PETS;
}
function answerPetEligibility(request) {
  request.eligible = Acquisition.eligible(request.player, getPetForItemId(request.itemId));
}

function releasePet(request) {
  const { player, npc } = request;
  if (!npc || !getPetByNpcId(npc.getId()) || player?.getAttribute?.(CURRENT_PET_ATTRIBUTE) !== npc
      || npc.getOwner?.() !== player) return;
  despawnPetNpc(npc);
  player.setAttribute(CURRENT_PET_ATTRIBUTE, null);
  player.setAttribute(LAST_PET_ATTRIBUTE, null);
  player.setAttribute(ACTIVE_PET_ATTRIBUTE, null);
  syncFollowerIndex(player, null);
  request.released = true;
}

function reclaimPets(event) {
  if (event.npcId !== NpcIdentifiers.PROBITA || event.action !== "open_interface" || event.target !== "Pet Insurance") {
    return;
  }
  event.handled = true;
  event.end = true;
  Recovery.open(event);
}

/** Boss pets come straight to the killer instead of landing on the floor. */
function awardDroppedPets({ player, drops }) {
  if (!player || !Array.isArray(drops)) return;
  for (let index = drops.length - 1; index >= 0; index--) {
    const itemId = drops[index]?.itemId ?? drops[index]?.id;
    if (!getPetForItemId(itemId)) continue;
    drops.splice(index, 1);
    awardPet(player, itemId);
  }
}

function getPetByNpcId(id) {
  return PET_BY_ID.get(id) ?? null;
}

function getPetForItemId(itemId) {
  return PET_BY_ITEM_ID.get(itemId) ?? null;
}

function getPetDisplayName(pet) {
  if (!pet) {
    return "pet";
  }
  const name = ItemDefinitionClass?.forId?.(pet.itemId)?.getName?.();
  if (typeof name === "string" && name.trim() && name.toLowerCase() !== "null") return name;
  return Misc.capitalizeWords(pet.enumName.toLowerCase().replace(/_/g, " "));
}

function normalizeSkillName(skill) {
  const skillName =
    skill?.getName?.() ??
    skill?.name ??
    (typeof skill === "number" && typeof Skill?.[skill] === "string" ? Skill[skill] : null);
  if (typeof skillName === "string" && skillName.length > 0) {
    return skillName.toLowerCase().replace(/_/g, " ");
  }
  if (typeof skill === "number" && typeof Skill?.[skill] === "string") {
    return Skill[skill].toLowerCase().replace(/_/g, " ");
  }
  return String(skill).toLowerCase().replace(/_/g, " ");
}

function log(event, extra = {}) {
  if (pluginApi && typeof pluginApi.log === "function") {
    pluginApi.log(event, extra);
    return;
  }
  try {
    console.log(`[plugin:Pets] ${event}`, extra);
  } catch {
    // Best-effort logging only.
  }
}

// ---------------------------------------------------------------- variants

function getVariantMap(player) {
  const stored = player.getAttribute?.(VARIANT_ATTRIBUTE);
  return stored && typeof stored === "object" && !Array.isArray(stored) ? stored : {};
}

/** The stored npc id of the chosen metamorphosis form for this pet's family. */
function getStoredVariant(player, pet) {
  const variant = getVariantMap(player)[petFamily(pet)];
  // Older saves used the house definition as the follower. Resolve that legacy
  // form without registering actual menagerie NPCs as owned world pets.
  const variantPet = Number.isInteger(variant) ? getPetByNpcId(variant) ?? PET_BY_HOUSE_ID.get(variant) : null;
  return variantPet && petFamily(variantPet) === petFamily(pet) ? variantPet.petId : 0;
}

function setStoredVariant(player, pet, npcId) {
  player.setAttribute(VARIANT_ATTRIBUTE, { ...getVariantMap(player), [petFamily(pet)]: npcId });
}

/** Re-applies the chosen form to a freshly summoned follower. */
function applyStoredVariant(player, npc, pet) {
  if (pet.familyItemId) {
    // Old saves encoded every form as the base item plus a variant. Once ownership
    // records the real item, physical item identity wins over a family's later preference.
    const owned = player.getAttribute(OWNED_ATTRIBUTE);
    const legacy = pet.itemId === pet.familyItemId && Array.isArray(owned) && owned.includes(pet.familyItemId);
    const chosen = legacy ? getStoredVariant(player, pet) || pet.petId : pet.petId;
    setStoredVariant(player, pet, chosen);
    if (chosen !== npc.getRealId?.()) npc.setNpcTransformationId(chosen);
    return;
  }
  const variant = getStoredVariant(player, pet);
  if (variant && variant !== npc.getRealId?.()) {
    npc.setNpcTransformationId(variant);
  }
}

// ---------------------------------------------------------------- metamorphosis unlocks

function getMorphUnlocks(player) {
  const unlocks = player.getAttribute?.(MORPH_UNLOCK_ATTRIBUTE);
  return Array.isArray(unlocks) ? unlocks : [];
}

function unlockMorphFamily(player, family) {
  const unlocks = getMorphUnlocks(player);
  if (!unlocks.includes(family)) player.setAttribute(MORPH_UNLOCK_ATTRIBUTE, [...unlocks, family]);
}

/**
 * The Wiki Metamorphosis requirements. A form without a `morphUnlock` is free to change to;
 * item forms need the item (consumed unless `permanent`), `permanent` forms record the family
 * unlock once, and flag/attribute forms need the unlock content to have been completed.
 * Denied morphs never change the pet.
 */
function checkMorphUnlock(player, next) {
  const req = next?.morphUnlock;
  if (!req) return { ok: true };
  const family = petFamily(next);
  if (req.permanent && getMorphUnlocks(player).includes(family)) return { ok: true };
  if (req.unlockFlag && player.getAttribute?.(req.unlockFlag) === true) return { ok: true };
  if (req.attribute) {
    let value = player.getAttribute?.(req.attribute);
    for (const key of req.path ?? []) value = value?.[key];
    if (Number(value) >= (req.min ?? 1)) return { ok: true };
    return { ok: false, message: `You need ${req.name} to metamorphose your pet like that.` };
  }
  const itemIds = req.items ?? (req.itemId ? [req.itemId] : null);
  if (itemIds) {
    const missing = itemIds.filter((itemId) => !player.getInventory?.()?.contains?.(itemId));
    if (missing.length === 0) {
      return {
        ok: true,
        itemIds,
        consume: req.consume !== false,
        permanent: req.permanent === true,
      };
    }
    return { ok: false, message: `You need ${req.name} to metamorphose your pet like that.` };
  }
  return { ok: false, message: req.message ?? `You need to unlock ${req.name} first.` };
}

// ---------------------------------------------------------------- cats

/** The Wiki growth clock: one event per 90 s of following, three hours to an adult. */
const CAT_GROWTH_TICK = 150;
const CAT_KITTEN_GROWTH = 120;
/** The Wiki gives five to six hours for adult to overgrown; the upper bound is used. */
const CAT_ADULT_GROWTH = 240;
const CAT_FEED_MS = 24 * 60 * 1000;
const CAT_FEED_WARN_MS = 3 * 60 * 1000;
const CAT_ATTENTION_MS = 25 * 60 * 1000;
const CAT_ATTENTION_WARN_MS = 7 * 60 * 1000;
const CAT_WOOL_MS = 51 * 60 * 1000;
const CAT_STROKE_MS = 18 * 60 * 1000;
const CAT_STROKE_SATIATED_MS = 25 * 60 * 1000;
const CAT_RAT_CHANCE = {
  kitten: 0.1, hellkitten: 0.1,
  cat: 0.5, hellcat: 0.5,
  overgrown: 0.75, overgrown_hellcat: 0.75,
};
const CAT_NEXT_STAGE = {
  kitten: "cat",
  cat: "overgrown",
  hellkitten: "hellcat",
  hellcat: "overgrown_hellcat",
};
const CAT_HELL_STAGES = new Set(["hellkitten", "hellcat", "overgrown_hellcat"]);

/**
 * Stage -> colour -> npc/item ids. The Wiki infobox lists the kitten NPCs/items, the adult
 * cat NPCs/items and the overgrown cat NPCs/items in the same colour order, so the parallel
 * order is the mapping. Wily/lazy cats need Ratcatchers, which the server does not have.
 */
const CAT_STAGES = {
  kitten: { npcs: [5591, 5592, 5593, 5594, 5595, 5596], items: [1555, 1556, 1557, 1558, 1559, 1560] },
  cat: { npcs: [1619, 1620, 1621, 1622, 1623, 1624], items: [1561, 1562, 1563, 1564, 1565, 1566] },
  overgrown: { npcs: [5598, 5599, 5600, 5601, 5602, 5603], items: [1567, 1568, 1569, 1570, 1571, 1572] },
  hellkitten: { npcs: [5597], items: [7583] },
  hellcat: { npcs: [1625], items: [7582] },
  overgrown_hellcat: { npcs: [5604], items: [7581] },
};

const CAT_BY_NPC = new Map();
const CAT_BY_ITEM = new Map();
for (const [stage, { npcs, items }] of Object.entries(CAT_STAGES)) {
  npcs.forEach((npcId, colour) => CAT_BY_NPC.set(npcId, { stage, colour }));
  items.forEach((itemId, colour) => CAT_BY_ITEM.set(itemId, { stage, colour }));
}

/** The cat stage a pet entry belongs to, or null for every other pet. */
function catInfoOf(pet) {
  if (!pet) return null;
  return CAT_BY_ITEM.get(pet.itemId) ?? CAT_BY_NPC.get(pet.petId) ?? null;
}

function getCatState(player) {
  const state = player.getAttribute?.(CAT_ATTRIBUTE);
  return state && typeof state === "object" && !Array.isArray(state) ? state : null;
}

function setCatState(player, state) {
  player.setAttribute?.(CAT_ATTRIBUTE, state);
}

function clearCatState(player) {
  player.setAttribute?.(CAT_ATTRIBUTE, null);
}

function stopCatTask(player) {
  const key = CAT_TASK_KEY.get(player);
  if (key) {
    TaskManagerRef?.cancelTasks?.(key);
    CAT_TASK_KEY.delete(player);
  }
}

function scheduleCatTask(player) {
  if (!TaskClass || !TaskManagerRef || typeof TaskManagerRef.submit !== "function") return;
  stopCatTask(player);
  const key = {};
  CAT_TASK_KEY.set(player, key);
  const task = new (class extends TaskClass {
    constructor() {
      super(CAT_GROWTH_TICK, key, false);
    }
    execute() {
      if (catTick(player) === false) this.stop();
    }
  })();
  TaskManagerRef.submit(task);
}

/** Starts (or resumes) the growth clock for a cat follower that just spawned. */
function trackCatFollower(player, npc, pet) {
  const info = catInfoOf(pet);
  if (!info) return;
  let state = getCatState(player);
  if (!state || state.stage !== info.stage) {
    // A traded or fresh cat gets a new record; a normal re-summon keeps the old one.
    state = {
      stage: info.stage,
      colour: info.colour,
      growth: 0,
      hungerAt: info.stage === "kitten" ? Date.now() + CAT_FEED_MS : 0,
      attentionAt: info.stage === "kitten" ? Date.now() + CAT_ATTENTION_MS : 0,
      lastStrokeAt: 0,
    };
  } else if (CAT_HELL_STAGES.has(info.stage)) {
    // The hell stages have one NPC; the base colour lives in the record.
    state.colour = Number.isInteger(state.colour) ? state.colour : 0;
  } else {
    state.colour = info.colour;
  }
  // Picking a pet up pauses the needs clock; give the full period back on re-summon.
  if (state.stage === "kitten" || state.stage === "hellkitten") {
    const now = Date.now();
    if (!(state.hungerAt > now)) {
      state.hungerAt = now + CAT_FEED_MS;
      state.hungerStage = 0;
    }
    if (!(state.attentionAt > now)) {
      state.attentionAt = now + CAT_ATTENTION_MS;
      state.attentionStage = 0;
    }
  }
  setCatState(player, state);
  scheduleCatTask(player);
}

function catTick(player) {
  if (!player || player.getHitpoints?.() <= 0) return false;
  const npc = player.getAttribute?.(CURRENT_PET_ATTRIBUTE);
  const pet = npc?.isRegistered?.() ? getPetByNpcId(npc.getId()) : null;
  const info = pet ? catInfoOf(pet) : null;
  if (!info || player.getAttribute?.(CURRENT_PET_ATTRIBUTE) !== npc) return false;
  const state = getCatState(player);
  if (!state || state.stage !== info.stage) return false;
  // Fully grown cats need no clock: no further stage and no needs.
  if (!CAT_NEXT_STAGE[info.stage]) return false;

  state.growth = (Number(state.growth) || 0) + 1;
  const now = Date.now();
  if (info.stage === "kitten" || info.stage === "hellkitten") {
    if (catNeedsTick(player, state, now) === false) return false;
  }
  const threshold = info.stage === "kitten" || info.stage === "hellkitten"
    ? CAT_KITTEN_GROWTH
    : CAT_ADULT_GROWTH;
  if (state.growth >= threshold) advanceCatStage(player, npc, info, state);
  setCatState(player, state);
  return true;
}

/** Hunger and attention, per the Wiki timers; false when the kitten runs away. */
function catNeedsTick(player, state, now) {
  if (state.hungerAt && now >= state.hungerAt) {
    if (!state.hungerStage) {
      state.hungerStage = 1;
      state.hungerAt = now + CAT_FEED_WARN_MS;
      player.sendMessage("Your kitten is hungry.");
    } else if (state.hungerStage === 1) {
      state.hungerStage = 2;
      state.hungerAt = now + CAT_FEED_WARN_MS;
      player.sendMessage("Meeeooowww!");
    } else {
      runAwayCat(player);
      return false;
    }
  }
  if (state.attentionAt && now >= state.attentionAt) {
    if (!state.attentionStage) {
      state.attentionStage = 1;
      state.attentionAt = now + CAT_ATTENTION_WARN_MS;
      player.sendMessage("Your kitten wants attention.");
    } else if (state.attentionStage === 1) {
      state.attentionStage = 2;
      state.attentionAt = now + CAT_ATTENTION_WARN_MS;
      player.sendMessage("Meeeooowww...");
    } else {
      runAwayCat(player);
      return false;
    }
  }
  return true;
}

function stagePetIds(stage, colour) {
  const table = CAT_STAGES[stage];
  const index = Math.max(0, Math.min(colour | 0, table.npcs.length - 1));
  return { npcId: table.npcs[index], itemId: table.items[index] };
}

/** Swaps the follower for the next stage in place, keeping owner, area and variant. */
function replaceFollowerNpc(player, npc, npcId, itemId, location = npc.getLocation().clone()) {
  despawnPetNpc(npc);
  const replacement = NPC.create(npcId, location);
  replacement.setPet(true);
  replacement.setOwner(player);
  replacement.setFollowing(player);
  replacement.setMobileInteraction(player);
  replacement.setArea(player.getArea());
  spawnPetNpc(replacement);
  player.setAttribute(CURRENT_PET_ATTRIBUTE, replacement);
  player.setAttribute(LAST_PET_ATTRIBUTE, itemId);
  player.setAttribute(ACTIVE_PET_ATTRIBUTE, itemId);
  syncFollowerIndex(player, replacement);
}

function advanceCatStage(player, npc, info, state) {
  const nextStage = CAT_NEXT_STAGE[info.stage];
  if (!nextStage) return;
  const { npcId, itemId } = stagePetIds(nextStage, state.colour);
  state.stage = nextStage;
  state.growth = 0;
  state.hungerAt = 0;
  state.attentionAt = 0;
  setCatState(player, state);
  replaceFollowerNpc(player, npc, npcId, itemId);
  const grown = { cat: "a cat", overgrown: "an overgrown cat", hellcat: "a hellcat", overgrown_hellcat: "an overgrown hellcat" }[nextStage];
  player.sendMessage(`Your kitten has grown into ${grown}.`);
}

function runAwayCat(player) {
  const npc = player.getAttribute?.(CURRENT_PET_ATTRIBUTE);
  if (npc) despawnPetNpc(npc);
  player.setAttribute?.(CURRENT_PET_ATTRIBUTE, null);
  player.setAttribute?.(LAST_PET_ATTRIBUTE, null);
  player.setAttribute?.(ACTIVE_PET_ATTRIBUTE, null);
  clearCatState(player);
  stopCatTask(player);
  syncFollowerIndex(player, null);
  player.sendMessage("Your kitten runs away.");
}

function shooCat(player, npc) {
  despawnPetNpc(npc);
  player.setAttribute?.(CURRENT_PET_ATTRIBUTE, null);
  player.setAttribute?.(LAST_PET_ATTRIBUTE, null);
  player.setAttribute?.(ACTIVE_PET_ATTRIBUTE, null);
  clearCatState(player);
  stopCatTask(player);
  syncFollowerIndex(player, null);
  player.sendMessage("You shoo your pet away.");
}

/** The Wiki's kitten food: any raw or cooked fish except the eel family. */
function catItemIsFood(itemId) {
  const name = ItemDefinitionClass?.forId?.(itemId)?.getName?.() ?? "";
  if (!name || /eel/i.test(name)) return false;
  return /\b(shrimps?|anchovies|sardine|herring|mackerel|trout|pike|salmon|tuna|lobster|swordfish|monkfish|shark|karambwanjis?|karambwans?|anglerfish|dark crab|manta ray|sea turtle|frog spawn|cod|bass|minnows?)\b/i.test(name);
}

function catNoun(info) {
  return CAT_HELL_STAGES.has(info.stage) ? "hell-kitten" : info.stage === "kitten" ? "kitten" : "cat";
}

function handleItemOnCat(event) {
  const { player, target: npc, itemId } = event;
  const pet = getPetByNpcId(npc?.getId?.());
  const info = catInfoOf(pet);
  if (!info || !player || player.getAttribute?.(CURRENT_PET_ATTRIBUTE) !== npc) return;
  const state = getCatState(player);
  if (!state || state.stage !== info.stage) return;

  if (itemId === ItemIdentifiers.BUCKET_OF_MILK) {
    if (CAT_HELL_STAGES.has(state.stage)) {
      event.handled = true;
      player.getInventory().deleteNumber(itemId, 1);
      player.getInventory().adds(ItemIdentifiers.BUCKET, 1);
      const baseStage = { hellkitten: "kitten", hellcat: "cat", overgrown_hellcat: "overgrown" }[state.stage];
      const { npcId, itemId: baseItemId } = stagePetIds(baseStage, state.colour);
      state.stage = baseStage;
      setCatState(player, state);
      replaceFollowerNpc(player, npc, npcId, baseItemId);
      player.sendMessage("Your cat returns to its original colour.");
      return;
    }
    if (state.stage === "kitten") {
      event.handled = true;
      player.getInventory().deleteNumber(itemId, 1);
      player.getInventory().adds(ItemIdentifiers.BUCKET, 1);
      state.hungerAt = Date.now() + CAT_FEED_MS;
      state.hungerStage = 0;
      setCatState(player, state);
      player.sendMessage("Your kitten drinks the milk.");
    }
    return;
  }

  if ((state.stage !== "kitten" && state.stage !== "hellkitten") || !catItemIsFood(itemId)) return;
  event.handled = true;
  player.getInventory().deleteNumber(itemId, 1);
  state.hungerAt = Date.now() + CAT_FEED_MS;
  state.hungerStage = 0;
  setCatState(player, state);
  const name = ItemDefinitionClass?.forId?.(itemId)?.getName?.() ?? "fish";
  player.sendMessage(`Your kitten eats the ${name.toLowerCase()}.`);
}

/** Feeding Gull raw or cooked fish counts toward the 50 needed for Gulliver (Wiki). */
function handleGullFeed(event) {
  const { player, target: npc, itemId } = event;
  const pet = getPetByNpcId(npc?.getId?.());
  if (!pet || pet.enumName !== "GULL" || !player) return;
  if (player.getAttribute?.(CURRENT_PET_ATTRIBUTE) !== npc || !catItemIsFood(itemId)) return;
  const fed = Math.min(50, (Number(player.getAttribute(GULL_FED_ATTRIBUTE)) || 0) + 1);
  player.setAttribute(GULL_FED_ATTRIBUTE, fed);
  player.getInventory().deleteNumber(itemId, 1);
  event.handled = true;
  player.sendMessage(fed >= 50
    ? "Gull has eaten enough and is ready to metamorphose."
    : `Gull eats the fish. (${fed}/50)`);
}

function strokeCat(player, npc) {
  const pet = getPetByNpcId(npc?.getId?.());
  const info = catInfoOf(pet);
  const state = getCatState(player);
  if (!info || !state || state.stage !== info.stage) return;
  const now = Date.now();
  const satiated = state.lastStrokeAt && now - state.lastStrokeAt < 60_000;
  state.lastStrokeAt = now;
  state.attentionAt = now + (satiated ? CAT_STROKE_SATIATED_MS : CAT_STROKE_MS);
  state.attentionStage = 0;
  setCatState(player, state);
  player.sendMessage(`You stroke the ${catNoun(info)}.`);
}

function guessCatAge(player) {
  const state = getCatState(player);
  if (!state) {
    player.sendMessage("You don't have a kitten.");
    return;
  }
  if (state.stage === "cat" || state.stage === "hellcat") {
    const remaining = Math.max(0, CAT_ADULT_GROWTH - (Number(state.growth) || 0));
    player.sendMessage(`Your cat will become overgrown in about ${Math.ceil(remaining * 1.5)} minutes.`);
    return;
  }
  if (state.stage === "kitten" || state.stage === "hellkitten") {
    const remaining = Math.max(0, CAT_KITTEN_GROWTH - (Number(state.growth) || 0));
    player.sendMessage(`Your kitten will grow into a cat in about ${Math.ceil(remaining * 1.5)} minutes.`);
    return;
  }
  player.sendMessage("Your cat is fully grown.");
}

function findVermin(npc) {
  if (!World?.getNpcs) return null;
  let best = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const other of World.getNpcs()) {
    if (!other || other === npc || other.isRegistered?.() === false) continue;
    const name = other.getDefinition?.()?.getName?.();
    if (name !== "Rat" && name !== "Hell-Rat") continue;
    const distance = npc.getLocation().getDistance(other.getLocation());
    if (distance <= 8 && distance < bestDistance) {
      best = other;
      bestDistance = distance;
    }
  }
  return best;
}

function chaseVermin(player, npc, pet) {
  const info = catInfoOf(pet);
  if (!info || player.getAttribute?.(CURRENT_PET_ATTRIBUTE) !== npc) return false;
  const vermin = findVermin(npc);
  if (!vermin) {
    player.sendMessage("There is nothing nearby for your pet to chase.");
    return true;
  }
  const name = vermin.getDefinition?.()?.getName?.() ?? "rat";
  if (Math.random() >= (CAT_RAT_CHANCE[info.stage] ?? 0.1)) {
    player.sendMessage(`Your ${catNoun(info)} pounces, but the ${name.toLowerCase()} gets away.`);
    return true;
  }
  const caughtLocation = vermin.getLocation?.().clone?.();
  despawnPetNpc(vermin);
  const respawnTicks = vermin.getDefinition?.()?.getRespawn?.() ?? 0;
  if (respawnTicks > 0 && TaskManagerRef?.submit && NPCRespawnTaskRef) {
    TaskManagerRef.submit(new NPCRespawnTaskRef(vermin, respawnTicks));
  }
  pluginApi?.emitCustomEvent?.("pets:vermin-caught", {
    player,
    cat: npc,
    verminName: name,
    location: caughtLocation,
  });
  if (name === "Hell-Rat" && info.stage === "kitten") {
    // Chasing a hell-rat turns any kitten into the generic Hell-kitten (Wiki, Cat).
    const state = getCatState(player);
    const { npcId, itemId } = stagePetIds("hellkitten", state?.colour ?? 0);
    if (state) {
      state.stage = "hellkitten";
      state.growth = 0;
      setCatState(player, state);
    }
    replaceFollowerNpc(player, npc, npcId, itemId);
    player.sendMessage("Your kitten catches the hell-rat and turns into a hell-kitten.");
    return true;
  }
  player.sendMessage(`Your ${catNoun(info)} catches the ${name.toLowerCase()}.`);
  return true;
}

function openCatInteract(player, npc, pet) {
  if (!catInfoOf(pet)) return false;
  if (typeof pluginApi?.sendMultiChatboxPrompt !== "function") return true;
  // Recall and growth replace the NPC while this non-interrupting prompt stays
  // open. Keep the logical cat session, then resolve its live follower per choice.
  const state = getCatState(player);
  const withCurrentCat = (action) => () => {
    const current = player.getAttribute?.(CURRENT_PET_ATTRIBUTE);
    const entry = getPetByNpcId(current?.getId?.());
    if (!current?.isRegistered?.() || !current.isPet?.() || current.getOwner?.() !== player
        || World.getRemoveNPCQueue().includes(current) || !catInfoOf(entry)
        || getCatState(player) !== state || (!state && current !== npc)) return;
    action(current, entry);
  };
  const opened = pluginApi.sendMultiChatboxPrompt(
    player,
    "Interact",
    "Stroke", withCurrentCat(current => strokeCat(player, current)),
    "Chase vermin", withCurrentCat((current, entry) => chaseVermin(player, current, entry)),
    "Guess age", withCurrentCat(() => guessCatAge(player)),
    "Shoo away", withCurrentCat(current => shooCat(player, current))
  );
  return opened !== false;
}

/** Cats are generic pets: they run off on death rather than waiting to catch up. */
function onCatOwnerDeath({ player }) {
  const npc = player?.getAttribute?.(CURRENT_PET_ATTRIBUTE);
  if (!npc) return;
  const pet = getPetByNpcId(npc.getId?.());
  if (!pet || pet.reclaimable !== false) return;
  despawnPetNpc(npc);
  player.setAttribute?.(CURRENT_PET_ATTRIBUTE, null);
  player.setAttribute?.(LAST_PET_ATTRIBUTE, null);
  player.setAttribute?.(ACTIVE_PET_ATTRIBUTE, null);
  clearCatState(player);
  stopCatTask(player);
  syncFollowerIndex(player, null);
  player.sendMessage("Your pet runs off.");
}

// ---------------------------------------------------------------- follower

function chooseSpawnLocation(player) {
  const tiles = [];
  const outterTiles = player?.outterTiles?.() ?? [];
  for (const tile of outterTiles) {
    if (RegionManager.blocked(tile, player.getPrivateArea())) {
      continue;
    }
    tiles.push(tile);
  }
  if (tiles.length === 0) {
    return player.getLocation().clone();
  }
  return tiles[Misc.getRandom(tiles.length - 1)];
}

function canSummonPetHere(player, reward) {
  if (reward) {
    return true;
  }
  const area = player.getArea?.();
  if (!area || typeof area.allowSummonPet !== "function") {
    return true;
  }
  return area.allowSummonPet(player) !== false;
}

function findOwnedPetItemSource(player) {
  if (!player) {
    return null;
  }

  const petItems = Array.from(PET_BY_ITEM_ID.values()).filter(
    (pet) => Number.isInteger(pet?.itemId) && pet.itemId > 0
  );

  const inventory = player.getInventory?.();
  for (const pet of petItems) {
    if (inventory?.contains?.(pet.itemId)) {
      return { itemId: pet.itemId, source: "inventory", bankTab: -1 };
    }
  }

  const banks = player.getBanks?.() ?? [];
  for (let tab = 0; tab < Bank.TOTAL_BANK_TABS; tab++) {
    if (tab === Bank.BANK_SEARCH_TAB_INDEX) {
      continue;
    }
    const bank = banks[tab];
    if (!bank) {
      continue;
    }
    for (const pet of petItems) {
      if (bank.contains?.(pet.itemId)) {
        return { itemId: pet.itemId, source: "bank", bankTab: tab };
      }
    }
  }

  return null;
}

function spawnPetNpc(npc) {
  if (World.getNpcs().add(npc)) {
    return {
      mode: "direct",
      alreadyQueued: false,
      addNpcQueueSize: World.getAddNPCQueue().length,
    };
  }

  const addQueue = World.getAddNPCQueue();
  const alreadyQueued = addQueue.includes(npc);
  if (!alreadyQueued) {
    addQueue.push(npc);
  }

  return {
    mode: "queued",
    alreadyQueued,
    addNpcQueueSize: addQueue.length,
  };
}

function despawnPetNpc(npc) {
  if (!npc) {
    return {
      removedFromAddQueue: false,
      queuedForRemoval: false,
      registered: false,
    };
  }

  const addQueue = World.getAddNPCQueue();
  let removedFromAddQueue = false;
  for (let index = addQueue.indexOf(npc); index !== -1; index = addQueue.indexOf(npc)) {
    addQueue.splice(index, 1);
    removedFromAddQueue = true;
  }

  let queuedForRemoval = false;
  const registered = typeof npc.isRegistered === "function" ? npc.isRegistered() : false;
  if (registered) {
    const removeQueue = World.getRemoveNPCQueue();
    if (!removeQueue.includes(npc)) {
      removeQueue.push(npc);
      queuedForRemoval = true;
    }
  }

  return {
    removedFromAddQueue,
    queuedForRemoval,
    registered,
  };
}

function syncFollowerIndex(player, pet) {
  const index = pet?.isRegistered?.() ? pet.getIndex?.() ?? -1 : -1;
  const definition = pet ? getPetByNpcId(pet.getId()) : null;
  player?.getPacketSender?.().sendConfig(FOLLOWER_INDEX_VARP, index > 0 ? (pet.getId() << 16) | index : -1);
  player?.getPacketSender?.().sendConfig(FOLLOWER_ITEM_VARP, index > 0 ? definition?.itemId ?? -1 : -1);
}

function drop(player, itemId, reward, { silent = false } = {}) {
  const username = player?.getUsername?.() ?? null;
  const pet = getPetForItemId(itemId);
  if (!pet) {
    log("drop_not_pet_item", { username, itemId, reward });
    return false;
  }

  const existingPet = player.getAttribute?.(CURRENT_PET_ATTRIBUTE);
  if (existingPet && !existingPet.isRegistered?.()) {
    log("drop_clear_stale_current_pet", {
      username,
      itemId,
      stalePetId: existingPet.getId?.() ?? null,
    });
    player.setAttribute?.(CURRENT_PET_ATTRIBUTE, null);
  }

  if (!player.getAttribute(CURRENT_PET_ATTRIBUTE)) {
    if (!canSummonPetHere(player, reward)) {
      log("drop_blocked_by_area", {
        username,
        itemId,
        petNpcId: pet.petId,
        area: player.getArea?.()?.getName?.() ?? null,
        reward,
      });
      return false;
    }

    const location = chooseSpawnLocation(player);
    const npc = NPC.create(pet.petId, location);
    npc.setPet(true);
    npc.setOwner(player);
    npc.setFollowing(player);
    npc.setMobileInteraction(player);
    npc.setArea(player.getArea());
    applyStoredVariant(player, npc, pet);
    const spawnResult = spawnPetNpc(npc);
    log(spawnResult.mode === "direct" ? "drop_spawn_added" : "drop_spawn_queued", {
      username,
      itemId: pet.itemId,
      petNpcId: pet.petId,
      x: location.getX?.() ?? null,
      y: location.getY?.() ?? null,
      z: location.getZ?.() ?? null,
      addNpcQueueSize: spawnResult.addNpcQueueSize,
      spawnMode: spawnResult.mode,
      alreadyQueued: spawnResult.alreadyQueued,
      npcRegistered: npc.isRegistered?.() ?? null,
      npcIndex: npc.getIndex?.() ?? null,
    });

    player.setAttribute(CURRENT_PET_ATTRIBUTE, npc);
    const activeItemId = getPetByNpcId(npc.getId())?.itemId ?? pet.itemId;
    player.setAttribute(LAST_PET_ATTRIBUTE, activeItemId);
    player.setAttribute(ACTIVE_PET_ATTRIBUTE, activeItemId);
    syncFollowerIndex(player, npc);
    setTimeout(() => {
      const index = npc.getIndex?.() ?? -1;
      const inWorld = index > 0 ? World.getNpcs().get(index) === npc : false;
      log("drop_spawn_postcheck", {
        username,
        itemId: pet.itemId,
        petNpcId: pet.petId,
        spawnMode: spawnResult.mode,
        npcRegistered: npc.isRegistered?.() ?? null,
        npcIndex: index,
        inWorld,
        addNpcQueueSize: World.getAddNPCQueue().length,
        removeNpcQueueSize: World.getRemoveNPCQueue().length,
      });
      if (player.getAttribute?.(CURRENT_PET_ATTRIBUTE) === npc) {
        syncFollowerIndex(player, npc);
      }
    }, 1200);

    recordOwnership(player, getPetByNpcId(npc.getId()) ?? pet);
    trackCatFollower(player, npc, pet);
    if (reward) {
      if (!silent) player.sendMessage("You have a funny feeling like you're being followed.");
    } else {
      player.getInventory().deleteNumber(pet.itemId, 1);
      Sounds.sendSound(player, Sound.DROP_ITEM);
      if (!pet.puppy) player.sendMessage("You drop your pet..");
      player.performAnimation(pet.puppy ? new Animation(-1) : INTERACTION_ANIM);
      player.setPositionToFace(npc.getLocation());
    }
  } else if (reward) {
    if (!player.getInventory().isFull()) {
      player.getInventory().adds(pet.itemId, 1);
    } else {
      ItemOnGroundManager.registerNonGlobal(player, new Item(pet.itemId));
    }
    if (!silent) player.sendMessage("@dre@You've received a pet!");
  } else {
    const currentPet = player.getAttribute(CURRENT_PET_ATTRIBUTE);
    log("drop_already_has_pet", {
      username,
      itemId,
      currentPetId: currentPet?.getId?.() ?? null,
      currentPetRegistered: currentPet?.isRegistered?.() ?? null,
    });
    player.sendMessage("You already have a pet following you.");
  }

  return true;
}

function pickup(player, npc, { auto = false } = {}) {
  if (!npc || !player) {
    return false;
  }

  const pet = getPetByNpcId(npc.getId());
  if (
    !pet ||
    !npc.isPet?.() ||
    npc.getOwner?.()?.getIndex?.() !== player.getIndex?.() ||
    // NPC removal is queued until the world update. A second click on the same
    // follower can arrive before that removal; only the active follower may
    // transfer its item, so the queued duplicate cannot mint another copy.
    player.getAttribute(CURRENT_PET_ATTRIBUTE) !== npc
  ) {
    return false;
  }

  if (player.getInventory().isFull()) {
    if (!auto) {
      player.sendMessage("You don't have enough inventory space.");
      return true;
    }
    // A logout cannot leave the follower behind: OSRS banks a pet with no inventory room.
    const bank = player.getBank?.(Bank.getTabForItem(player, pet.itemId));
    if (!bank || bank.adds(pet.itemId, 1) === false) {
      player.sendMessage("You don't have enough inventory or bank space for your pet.");
      return true;
    }
  } else {
    player.getInventory().adds(pet.itemId, 1);
  }

  if (pet.puppy && !auto) player.getPacketSender().sendInterfaceRemoval();
  player.getMovementQueue().reset();
  player.performAnimation(INTERACTION_ANIM);
  const despawnResult = despawnPetNpc(npc);
  log("pickup_despawn", {
    username: player?.getUsername?.() ?? null,
    petNpcId: npc.getId?.() ?? null,
    petIndex: npc.getIndex?.() ?? null,
    removedFromAddQueue: despawnResult.removedFromAddQueue,
    queuedForRemoval: despawnResult.queuedForRemoval,
    registered: despawnResult.registered,
    addNpcQueueSize: World.getAddNPCQueue().length,
    removeNpcQueueSize: World.getRemoveNPCQueue().length,
  });

  if (!pet.puppy) player.sendMessage("You pick up your pet..");
  if (pet.puppy) player.getPacketSender().sendSoundEffect(2582, 1, 20);
  else Sounds.sendSound(player, PET_PICKUP_SOUND);
  // The physical item now represents the pet; snapshots must not also restore a follower.
  player.setAttribute(ACTIVE_PET_ATTRIBUTE, null);
  // The item now in hand is the current form; a cross-item morph replaces the record.
  recordOwnership(player, pet);
  if (catInfoOf(pet)) stopCatTask(player);
  player.setAttribute(CURRENT_PET_ATTRIBUTE, null);
  if (!auto) player.setAttribute(LAST_PET_ATTRIBUTE, null);
  syncFollowerIndex(player, null);
  return true;
}

/** Logout/disconnect detaches the runtime NPC; the active descriptor needs no storage slot. */
function returnFollowerOnLogout(player) {
  const npc = player.getAttribute?.(CURRENT_PET_ATTRIBUTE);
  const pet = npc ? getPetByNpcId(npc.getId()) : null;
  if (!pet || npc.getOwner?.() !== player) return;
  player.setAttribute(LAST_PET_ATTRIBUTE, pet.itemId);
  player.setAttribute(ACTIVE_PET_ATTRIBUTE, pet.itemId);
  despawnPetNpc(npc);
  if (catInfoOf(pet)) stopCatTask(player);
  player.setAttribute(CURRENT_PET_ATTRIBUTE, null);
  syncFollowerIndex(player, null);
}

function morph(player, npc) {
  if (!npc || !player?.getAttribute?.(CURRENT_PET_ATTRIBUTE)) {
    return false;
  }

  const pet = getPetByNpcId(npc.getId());
  if (!pet) {
    return false;
  }

  if (player.getAttribute(CURRENT_PET_ATTRIBUTE) !== npc) {
    return false;
  }

  if (npc.getOwner?.() !== player || player.isRegistered?.() === false || player.busy?.()) return true;

  const request = {player, npc, pet, action: "Metamorphosis", handled: false};
  pluginApi?.emitCustomEvent?.("pets:interact", request);
  if (request.handled) return true;
  if (pet.morphId === 0) return false;

  const next = getPetByNpcId(pet.morphId);
  if (!next || petFamily(next) !== petFamily(pet)) {
    // A cycle must stay within the pet's family so the item and ownership never change.
    player.sendMessage("Your pet can't change like that.");
    return true;
  }
  const unlock = checkMorphUnlock(player, next);
  if (!unlock.ok) {
    // A denied morph must leave the active pet form unchanged.
    player.sendMessage(unlock.message);
    return true;
  }
  npc.setNpcTransformationId(pet.morphId);
  setStoredVariant(player, pet, pet.morphId);
  player.setAttribute(ACTIVE_PET_ATTRIBUTE, next.itemId);
  player.setAttribute(LAST_PET_ATTRIBUTE, next.itemId);
  if (pet.familyItemId) {
    recordOwnership(player, next);
    syncFollowerIndex(player, npc);
  }
  if (unlock.consume && unlock.itemIds) {
    for (const itemId of unlock.itemIds) player.getInventory().deleteNumber(itemId, 1);
    if (unlock.permanent) unlockMorphFamily(player, petFamily(next));
  }
  player.sendMessage("Your pet endures metamorphosis and transforms.");
  return true;
}

function interact(player, npc, action = "Interact") {
  if (!npc || !player?.getAttribute?.(CURRENT_PET_ATTRIBUTE)) {
    return false;
  }

  const pet = getPetByNpcId(npc.getId());
  if (!pet) {
    return false;
  }

  if (player.getAttribute(CURRENT_PET_ATTRIBUTE) !== npc) {
    return false;
  }

  const request = { player, npc, pet, action, handled: false };
  pluginApi?.emitCustomEvent?.("pets:interact", request);
  if (request.handled) return true;

  // Cats get the OSRS Interact menu (Stroke / Chase vermin / Guess age / Shoo away).
  if (catInfoOf(pet)) {
    return openCatInteract(player, npc, pet);
  }

  // Missing or ambiguous source variants remain a no-op; never guess a quest,
  // item-use or Menagerie overhead branch from an NPC-index candidate.
  return true;
}

/** Which pet action a click maps to, from the NPC's cached options, then the click index. */
function handlePetClick(event) {
  if (!event?.player || !event.npc || !getPetByNpcId(event.npcId)) {
    return false;
  }
  // Pickup queues removal until the World tick; late native clicks can still
  // resolve that NPC. Consume them here instead of falling through to generic
  // NPC dialogue. Ordinary non-pet world NPCs keep their existing handlers.
  if (event.npc.isPet?.() && (event.player.getAttribute(CURRENT_PET_ATTRIBUTE) !== event.npc
      || event.npc.getOwner?.() !== event.player || !event.npc.isRegistered?.()
      || World.getRemoveNPCQueue().includes(event.npc))) return true;
  const action = String(event.definition?.getActions?.()?.[event.clickType - 1] ?? "");
  const lower = action.toLowerCase();
  if (lower === "pick-up") return pickup(event.player, event.npc);
  if (lower === "pet") return interact(event.player, event.npc, "Pet");
  if (lower === "metamorphosis" || lower === "metamorph") return morph(event.player, event.npc);
  if (lower === "talk-to" || lower === "interact" || lower === "stroke" || lower === "locking") {
    return interact(event.player, event.npc, action);
  }
  if (lower === "chase") {
    const pet = getPetByNpcId(event.npcId);
    return catInfoOf(pet) ? chaseVermin(event.player, event.npc, pet) : false;
  }
  if (action) return false;
  // The client injects Talk-to/Metamorphosis/Pick-up on pet definitions that predate them.
  if (event.clickType === 1) return interact(event.player, event.npc);
  if (event.clickType === 2) return morph(event.player, event.npc) || pickup(event.player, event.npc);
  return pickup(event.player, event.npc);
}

function pickUpAction(event) {
  return pickup(event.player, event.npc);
}

function morphAction(event) {
  return morph(event.player, event.npc);
}

/** Re-summons the pet the player logged out with; a normal relog rebuilds at most one. */
function restoreFollowerOnLogin(player) {
  if (!player) return false;
  const existing = player.getAttribute?.(CURRENT_PET_ATTRIBUTE);
  if (existing && !existing.isRegistered?.()) {
    player.setAttribute(CURRENT_PET_ATTRIBUTE, null);
  }
  if (player.getAttribute?.(CURRENT_PET_ATTRIBUTE)) return false;

  const activeItem = player.getAttribute?.(ACTIVE_PET_ATTRIBUTE);
  if (Number.isInteger(activeItem) && getPetForItemId(activeItem)) {
    // An existing duplicate item is separate property, not a temporary logout copy.
    return drop(player, activeItem, true, { silent: true });
  }
  if (activeItem != null) player.setAttribute(ACTIVE_PET_ATTRIBUTE, null);
  // Legacy saves represented the follower as pets:last plus a temporary physical item.
  const last = player.getAttribute?.(LAST_PET_ATTRIBUTE);
  const itemId = Number.isInteger(last) ? last : null;
  if (itemId && player.getInventory?.().contains?.(itemId)) {
    if (drop(player, itemId, true, { silent: true })) {
      player.getInventory().deleteNumber(itemId, 1);
      return true;
    }
  }
  // A logout with a full backpack banks the follower; take it back out on login.
  const banks = player.getBanks?.() ?? [];
  for (let tab = 0; itemId && tab < Bank.TOTAL_BANK_TABS; tab++) {
    if (tab === Bank.BANK_SEARCH_TAB_INDEX) continue;
    const bank = banks[tab];
    if (!bank?.contains?.(itemId)) continue;
    if (drop(player, itemId, true, { silent: true })) {
      player.getBank(tab).deleteNumber(itemId, 1);
      return true;
    }
    break;
  }
  return summonOwnedPetOnBotLogin(player);
}

function summonOwnedPetOnBotLogin(player) {
  if (!player?.isPlayerBot?.() || !player.isPlayerBot()) {
    return false;
  }
  if (player.getAttribute?.(CURRENT_PET_ATTRIBUTE)) {
    return false;
  }

  const ownedPet = findOwnedPetItemSource(player);
  if (!ownedPet) {
    return false;
  }

  // Use reward summon path to avoid interaction-side effects while auto-restoring bots.
  const summoned = drop(player, ownedPet.itemId, true, { silent: true });
  if (!summoned) {
    return false;
  }

  if (ownedPet.source === "inventory") {
    player.getInventory().deleteNumber(ownedPet.itemId, 1);
  } else {
    player.getBank(ownedPet.bankTab).deleteNumber(ownedPet.itemId, 1);
  }
  return true;
}

/** rune id -> rift guardian colour, chinchompa npc id -> baby chinchompa colour; filled at register. */
const SKILL_PET_VARIANTS = new Map();

function skillPetHandler(skill) {
  return (event) => onSkill(event.player, skill, event);
}

function onPetItemDropPolicy(event) {
  if (!event?.player) return;
  if (drop(event.player, event.itemId, false)) {
    event.handled = true;
  }
}

function onPetPlayerLogout({ player }) {
  returnFollowerOnLogout(player);
}

function onPetPlayerDisconnect({ player }) {
  returnFollowerOnLogout(player);
}

function onPetPlayerLogin({ player }) {
  syncFollowerIndex(player, player.getAttribute?.(CURRENT_PET_ATTRIBUTE));
  restoreFollowerOnLogin(player);
  syncCollectionLog(player);
}

/**
 * Rolls a skill's pet at the Wiki rate, 1 in (base - level * 25), fifteen times as
 * likely at 200M XP. Emitters pass the action's base as petBase (or a finished
 * petChance), how many rolls it earned (rift guardians roll per essence), and the
 * runeId / npcId that picks the pet's colour. No rate means the action can't roll.
 */
function onSkill(player, skill, { petBase, petChance, rolls = 1, runeId, npcId, petRolled = false } = {}) {
  if (petRolled) return false;
  const pet =
    SKILL_PET_VARIANTS.get(`rune:${runeId}`) ??
    SKILL_PET_VARIANTS.get(`npc:${npcId}`) ??
    SKILLING_PETS.find((candidate) => candidate.skill === skill);
  if (!pet || !player) return false;
  // Activity plugins may exclude a source even if a generic gatherer emitted a rate.
  const eligibility = {player, skill, eligible: true};
  pluginApi?.emitCustomEvent?.("pets:skilling-eligibility", eligibility);
  if (eligibility.eligible !== true) return false;
  let chance = petChance;
  if (!(Number.isFinite(chance) && chance > 0) && Number.isFinite(petBase) && petBase > 0) {
    const skills = player.getSkillManager();
    chance = (petBase - skills.getMaxLevel(skill) * 25) / (skills.getExperience(skill) >= MAX_XP ? 15 : 1);
  }
  if (!(Number.isFinite(chance) && chance > 0)) return false;
  let hit = false;
  for (let roll = 0; roll < Math.max(1, rolls | 0) && !hit; roll++) {
    hit = Math.random() < 1 / chance;
  }
  if (!hit) return false;
  if (!ownsPetFamily(player, pet)) {
    World.sendMessage(
      `@dre@${player.getUsername()} just found a stray ${getPetDisplayName(pet)} while ${normalizeSkillName(skill)}!`
    );
  }
  awardPet(player, pet.itemId);
  return true;
}

/** A gatherer may resolve its normal pet opportunity before delivering the resource. */
function rollSkillingPet(event) {
  if (event.handled) return;
  event.handled = true;
  onSkill(event.player, event.skill, event);
}

function fillSkillPetVariants({ ItemIdentifiers, NpcIdentifiers: Npcs }) {
  if (!PET_BY_NAME.has("QUETZIN")) {
    const pet = { enumName: "QUETZIN", petId: Npcs.QUETZIN_2, houseNpcId: Npcs.QUETZIN, morphId: 0, itemId: ItemIdentifiers.QUETZIN, dialogue: -1 };
    PETS.push(pet); PET_BY_ID.set(pet.petId, pet); PET_BY_NAME.set(pet.enumName, pet); PET_BY_ITEM_ID.set(pet.itemId, pet);
    PET_BY_HOUSE_ID.set(pet.houseNpcId, pet);
  }
  for (const pet of PETS) {
    if (!pet.enumName.endsWith("_RIFT_GUARDIAN")) continue;
    const runeId = ItemIdentifiers[pet.enumName.replace("_RIFT_GUARDIAN", "_RUNE")];
    if (Number.isInteger(runeId)) SKILL_PET_VARIANTS.set(`rune:${runeId}`, pet);
  }
  SKILL_PET_VARIANTS.set(`npc:${Npcs.HERBIBOAR}`, PET_BY_NAME.get("HERBI"));
  SKILL_PET_VARIANTS.set(`npc:${Npcs.QUETZIN}`, PET_BY_NAME.get("QUETZIN"));
  SKILL_PET_VARIANTS.set(`npc:${Npcs.CHINCHOMPA}`, PET_BY_NAME.get("GREY_CHINCHOMPA"));
  SKILL_PET_VARIANTS.set(`npc:${Npcs.CARNIVOROUS_CHINCHOMPA}`, PET_BY_NAME.get("RED_CHINCHOMPA"));
  SKILL_PET_VARIANTS.set(`npc:${Npcs.BLACK_CHINCHOMPA}`, PET_BY_NAME.get("BLACK_CHINCHOMPA"));
}

let World;
let RegionManager;
let ItemOnGroundManager;

module.exports = {
  name: "Pets",
  register(api) {
    World = api.getWorld();
    RegionManager = api.getRegionManager();
    ItemOnGroundManager = api.getItemOnGroundManager();
    pluginApi = api;
    Recovery.attach(api, {pets: PETS, getOwnedPetItems, getPetForItemId, petFamily, getPetDisplayName, syncCollectionLog});
    Acquisition.attach(api);
    Dust.attach(api, {getPetByNpcId, petFamily, getMorphUnlocks, unlockMorphFamily});
    Call.attach(api, {currentAttribute: CURRENT_PET_ATTRIBUTE, getPetByNpcId, canSummonPetHere, replaceFollowerNpc});
    CatchUp.attach(api, {currentAttribute: CURRENT_PET_ATTRIBUTE, getPetByNpcId, canSummonPetHere});
    Dialogue.attach(api, {currentAttribute: CURRENT_PET_ATTRIBUTE, catInfoOf, getPetByNpcId});
    TaskClass = api.core?.Task ?? null;
    TaskManagerRef = api.core?.TaskManager ?? null;
    NPCRespawnTaskRef = api.core?.NPCRespawnTask ?? null;
    ItemDefinitionClass = api.core?.ItemDefinition ?? null;
    fillSkillPetVariants(api.core);
    api.persistAttribute(OWNED_ATTRIBUTE);
    api.persistAttribute(LAST_PET_ATTRIBUTE);
    api.persistAttribute(ACTIVE_PET_ATTRIBUTE, null);
    api.persistAttribute(VARIANT_ATTRIBUTE);
    api.persistAttribute(MORPH_UNLOCK_ATTRIBUTE);
    api.persistAttribute(CAT_ATTRIBUTE);
    api.persistAttribute(GULL_FED_ATTRIBUTE);

    for (const skill of new Set(SKILLING_PETS.map((pet) => pet.skill))) {
      api.onCustomEvent(`${normalizeSkillName(skill)}:success`, skillPetHandler(skill));
    }
    api.onCustomEvent("npc-drops:roll", awardDroppedPets);
    api.onCustomEvent("pets:skilling-roll", rollSkillingPet);
    api.onCustomEvent("npc-dialogue:action", reclaimPets);
    api.onCustomEvent("pets:current", answerCurrentPet);
    api.onCustomEvent("pets:owns", answerOwnsPet);
    api.onCustomEvent("pets:definitions", answerPetDefinitions);
    api.onCustomEvent("pets:eligible", answerPetEligibility);
    api.onCustomEvent("pets:release", releasePet);
    api.onCustomEvent("pets:award", awardPetRequest);
    api.onItemDropPolicy(onPetItemDropPolicy);
    api.onItemOnNpc(handleItemOnCat);
    api.onItemOnNpc(handleGullFeed);

    const petNpcIds = Array.from(PET_BY_ID.keys());
    for (let clickType = 1; clickType <= 5; clickType++) {
      api.onNpcClick(petNpcIds, clickType, handlePetClick);
    }
    api.onAnyNpcInteraction({ "Pick-up": pickUpAction, Metamorphosis: morphAction, Metamorph: morphAction });

    api.onPlayerLogout(onPetPlayerLogout);
    api.onPlayerDisconnect(onPetPlayerDisconnect);
    api.onPlayerLogin(onPetPlayerLogin);
    api.onPlayerDeath(onCatOwnerDeath);
    RiftGuardian.attach(api, {pets: PETS, skill: Skill.RUNECRAFTING, world: World, currentAttribute: CURRENT_PET_ATTRIBUTE,
      activeAttribute: ACTIVE_PET_ATTRIBUTE, lastAttribute: LAST_PET_ATTRIBUTE, getPetByNpcId, setStoredVariant, recordOwnership, syncFollowerIndex});

    api.log("registered", {
      pets: PETS.length,
      skillingPets: SKILLING_PETS.length,
    });
  },

  // Exposed for tests/pets.test.cjs; nothing else reads them.
  __internals: {
    PETS,
    PET_BY_ID,
    PET_BY_ITEM_ID,
    petFamily,
    getStoredVariant,
    applyStoredVariant,
    checkMorphUnlock,
    morph,
    interact,
    pickup,
    handlePetClick,
    awardPet,
    getOwnedPetItems,
    catInfoOf,
    getCatState,
    setCatState,
    catTick,
    trackCatFollower,
    handleItemOnCat,
    handleGullFeed,
    strokeCat,
    guessCatAge,
    chaseVermin,
    shooCat,
    runAwayCat,
    stagePetIds,
    CAT_STAGES,
  },
};
