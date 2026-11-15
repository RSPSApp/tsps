/**
 * Mourning's End Part II (members).
 *
 * The words come from the "Mourning's End Part II" transcript page (plus the
 * "Arianwyn" page's post-quest chat and the "Thorgel" page's post-quest list);
 * this plugin supplies the variant selection for Arianwyn, Essyllt and Thorgel,
 * the prose-condition answers, the key/journal/colour-wheel hand-outs, the
 * crystal chisel/charge/reseal steps, the altar light-door pass and Thorgel's
 * item-list hand-in.
 *
 * Stage varbit: 1103 "mourning_quest_main" (base varp 574 "mourning_quest_part2",
 * bits 0-7). Evidence: `lookup-gameval.ts varbit mourning` prints
 * "1103 mourning_quest_main varp=574 bits=0-7"; the cache quest DB (dbTable 0,
 * row 100 "Mourning's End Part II") stores completion 60 (column 19), 2 quest
 * points (column 17) and 600000/10 = 60,000 Agility XP (column 33), matching the
 * OSRS Wiki rewards. The stub's varp 574 is the same parent; writing the varbit
 * keeps the sibling bits (arianwyn_told, temple mirror trays) alive.
 *
 * Stages (varbit 1103):
 *   1  STARTED        Arianwyn agreed to the plan (hook quest:mourning-s-end-part-ii:start)
 *   2  TUNNEL_ACCESS  Essyllt's new key received
 *   3  TEMPLE_FOUND   the dig team found dead outside the temple (Vm3Uax)
 *   4  SAMPLE         blackened crystal chiselled off (sXEe4m path)
 *   5  CRYSTAL_MADE   Eluned's newly made crystal received (sbwN7P)
 *   6  PUZZLE         crystal dispenser reset; altar light door (varbit 1158) opens
 *   7  ALTAR          Thorgel met at the Death Altar (GOaSlo)
 *   8  LIST           Thorgel's item list received (w-k6Vo)
 *   9  TALISMAN       last of Thorgel's items handed in (D9BEmz)
 *   10 POWERED        newly made crystal charged on the altar (vExKj3)
 *   11 RESEALED       powered crystal placed among the shards (IvFJds)
 *   60 COMPLETE       Arianwyn told the temple is safe (uE8R1r; cache DB value)
 *
 * Object ids (cache placements): crystal dispenser 9748/9749 at 1914,4639,1;
 * blackened crystal loc 10014 at 1908,4638,0; altar-chamber loc 34823 at
 * 1859,4638,0 (no identifier; the cache has no interactive Death Altar loc);
 * Pillar of Light 9973; dead guards 9763 (inside, 1910,4635,1), 9764/9765
 * (outside the entrance), slaves 9766/9767; the altar light door is the varbit
 * 1158 door 9788 at 1865,4638-4640,0. Thorgel's appearance is varbit 8467
 * (varp 594 bits 27-28): the altar dwarf 6184 only transforms to Thorgel 4010
 * when it is 1, and the plugin sets it when the player passes the light door.
 *
 * Sources: OSRS Wiki "Mourning's End Part II" page, quick guide and transcript;
 * the cache for every id, varbit, placement and reward.
 *
 * Gaps / approximations:
 *  - The light-mirror puzzle itself is not simulated. The dispenser's transcript
 *    variant is `missing` in the dump, so resetting it sends two original game
 *    messages and opens the altar door via varbit 1158. Pillar of Light
 *    searches/uses replay the wiki crystal lines for flavour only.
 *  - The wiki's chisel and "searching the crystal" message text is an image alt
 *    ("Blackened crystal detail.png") in the dump; the plugin sends "You chip
 *    off a piece of the blackened crystal." instead. There is no Search option
 *    on loc 10014, so only the chisel path exists.
 *  - The cache has no interactive Death Altar loc, so charging the crystal is
 *    bound to the 3x3 altar-chamber loc 34823 at 1859,4638 (documented
 *    stand-in); the altar-door pass uses the real varbit-1158 door 9788.
 *  - Lletya's static Eluned covers the "Eluned appears" stage direction; if a
 *    transform or another state removes her, the plugin puts an owned copy beside
 *    Arianwyn and clears it on her closing line.
 *  - Essyllt's spawn (content id 9016, not in the dialogue index) is played with
 *    QuestRuntime's startTranscript; the lost-key "above" jump ends the branch
 *    there, so the key is granted by the branch's condition event instead.
 *  - No desk object with an action exists in the cache at the mourner HQ, so
 *    the "searching the desk" variant is unreachable; lost keys come from
 *    Essyllt's own conversation. Mourner-gear, agility, food and quest
 *    prerequisites are not enforced (consistent with the other quest plugins).
 *  - Thorgel's one-of-three tickets/books/keys are rolled per player and kept
 *    in the persisted quest.mournings_end_part_ii.thorgel-list attribute; the
 *    items handed in on earlier trips are tracked in the
 *    quest.mournings_end_part_ii.thorgel-turned-in attribute (the list is
 *    larger than a backpack, so it takes several trips).
 */
module.exports = function registerMourningsEndPartIIQuest(api) {
  const { ItemIdentifiers, Location, NpcIdentifiers, ObjectIdentifiers, Skill } = api.core;
  const { registerQuest, startTranscript } = require("../QuestRuntime");

  const PAGE = "Mourning's End Part II";
  const POST_QUEST_VARIANT = "after-mourning-s-end-part-ii";
  const START_HOOK = "quest:mourning-s-end-part-ii:start";

  // ==========================================================================
  // Ids
  // ==========================================================================

  const ARIANWYN_IDS = new Set([
    NpcIdentifiers.ARIANWYN, // 3432
    NpcIdentifiers.ARIANWYN_3, // 8866
    NpcIdentifiers.ARIANWYN_4, // 8867
    NpcIdentifiers.ARIANWYN_5, // 8868
    NpcIdentifiers.ARIANWYN_6, // 9014, the Lletya spawn 5292 transforms to this
  ]);
  const ARIANWYN_CHATHEAD = NpcIdentifiers.ARIANWYN; // 3432
  const ESSYLLT_IDS = new Set([NpcIdentifiers.ESSYLLT, NpcIdentifiers.ESSYLLT_6]); // 3415, 9016
  const THORGEL_ID = NpcIdentifiers.THORGEL; // 4010, the altar dwarf 6184 transforms to this

  const NEW_KEY = ItemIdentifiers.NEW_KEY; // 6104
  const EDERNS_JOURNAL = ItemIdentifiers.EDERNS_JOURNAL; // 6649
  const COLOUR_WHEEL = ItemIdentifiers.COLOUR_WHEEL; // 6638
  const SCRAWLED_NOTES = ItemIdentifiers.SCRAWLED_NOTES; // 23773
  const BLACKENED_CRYSTAL = ItemIdentifiers.BLACKENED_CRYSTAL; // 6650
  const NEWLY_MADE_CRYSTAL = ItemIdentifiers.NEWLY_MADE_CRYSTAL; // 6651
  const POWERED_CRYSTAL = ItemIdentifiers.NEWLY_MADE_CRYSTAL_2; // 6652 mourning_crystal_new_powered
  const ITEM_LIST = ItemIdentifiers.ITEM_LIST; // 6648
  const DEATH_TALISMAN = ItemIdentifiers.DEATH_TALISMAN; // 1456
  const CHISEL = ItemIdentifiers.CHISEL; // 1755
  const CRYSTAL_TRINKET = ItemIdentifiers.CRYSTAL_TRINKET; // 6653
  const FRACTURED_CRYSTALS = new Set([
    ItemIdentifiers.FRACTURED_CRYSTAL, // 6646
    ItemIdentifiers.FRACTURED_CRYSTAL_2, // 6647
  ]);
  const GREEN_CRYSTALS = new Set([
    ItemIdentifiers.GREEN_CRYSTAL_2, // 23778
    ItemIdentifiers.GREEN_CRYSTAL_3, // 23783
  ]);

  const CRYSTAL_DISPENSERS = new Set([
    ObjectIdentifiers.CRYSTAL_DISPENSER, // 9748
    ObjectIdentifiers.CRYSTAL_DISPENSER_2, // 9749
  ]);
  const BLACKENED_CRYSTAL_ROCK = ObjectIdentifiers.CRYSTAL_3; // 10014
  const TEMPLE_DEATH_ALTAR = 34823; // cache loc 34823, the 3x3 altar-chamber object at 1859,4638 (no identifier)
  const PILLAR_OF_LIGHT = ObjectIdentifiers.PILLAR_OF_LIGHT_41; // 9973
  const GUARD_INSIDE = ObjectIdentifiers.GUARD; // 9763, by the crystal dispenser
  const GUARDS_OUTSIDE = new Set([
    ObjectIdentifiers.GUARD_2, // 9764
    ObjectIdentifiers.GUARD_3, // 9765
  ]);
  const SLAVES = new Set([
    ObjectIdentifiers.SLAVE, // 9766
    ObjectIdentifiers.SLAVE_2, // 9767
  ]);
  const ALTAR_LIGHT_DOOR = 9788; // cache loc 9788 "Pass" at 1865,4638-4640 (no identifier)
  const ALTAR_DOOR_X = 1865;
  const ALTAR_DOOR_Y = [4638, 4639, 4640];
  const ALTAR_DOOR_OFFSET = 4;

  const VARP_MOURNINGS_END_PART_II = 574; // mourning_quest_part2
  const VARBIT_STAGE = 1103; // mourning_quest_main, base varp 574 bits 0-7
  const VARBIT_ALTAR_DOOR = 1158; // mourning_door_1_c, base varp 579 bit 9; 1 = light door open
  const VARBIT_THORGEL_APPEARS = 8467; // varp 594 bits 27-28; 1 = altar dwarf 6184 is Thorgel

  const STAGE_STARTED = 1;
  const STAGE_TUNNEL_ACCESS = 2;
  const STAGE_TEMPLE_FOUND = 3;
  const STAGE_SAMPLE = 4;
  const STAGE_CRYSTAL_MADE = 5;
  const STAGE_PUZZLE = 6;
  const STAGE_ALTAR = 7;
  const STAGE_LIST = 8;
  const STAGE_TALISMAN = 9;
  const STAGE_POWERED = 10;
  const STAGE_RESEALED = 11;
  const STAGE_COMPLETE = 60; // cache DB completion value

  const THORGEL_LIST_ATTRIBUTE = "quest.mournings_end_part_ii.thorgel-list";
  const THORGEL_TURNED_IN_ATTRIBUTE = "quest.mournings_end_part_ii.thorgel-turned-in";

  /** Lletya's Eluned (the cache spawn beside Arianwyn; the identifiers file stores no constant for it). */
  const ELUNED_LLETYA_ID = 6286;
  /** Only the copy this plugin spawns when the static Eluned is not there. */
  const elunedCopies = new WeakMap();

  // Thorgel's shopping list: 47 fixed items plus one of each trio (OSRS Wiki).
  const THORGEL_FIXED_ITEMS = [
    ItemIdentifiers.BABYDRAGON_BONES, // 534
    ItemIdentifiers.BALL_OF_WOOL, // 1759
    ItemIdentifiers.BRONZE_BAR, // 2349
    ItemIdentifiers.BRONZE_MED_HELM, // 1139
    ItemIdentifiers.BUCKET_OF_MILK, // 1927
    ItemIdentifiers.CAKE_TIN, // 1887
    ItemIdentifiers.CHEESE, // 1985
    CHISEL,
    ItemIdentifiers.COOKED_MEAT, // 2142
    ItemIdentifiers.EGG, // 1944
    ItemIdentifiers.FACEMASK, // 4164
    ItemIdentifiers.FISHING_ROD, // 307
    ItemIdentifiers.FLAX, // 1779
    ItemIdentifiers.GOLD_RING, // 1635
    ItemIdentifiers.HAMMER, // 2347
    ItemIdentifiers.IRON_AXE, // 1349
    ItemIdentifiers.IRON_NAILS, // 4820
    ItemIdentifiers.IRON_PICKAXE, // 1267
    ItemIdentifiers.JUG_OF_WINE, // 1993
    ItemIdentifiers.KEBAB, // 1971
    ItemIdentifiers.KNIFE, // 946
    ItemIdentifiers.LEATHER_BOOTS, // 1061
    ItemIdentifiers.LEATHER_GLOVES, // 1059
    ItemIdentifiers.LOBSTER_POT, // 301
    ItemIdentifiers.LOCKPICK, // 1523
    ItemIdentifiers.NECKLACE_MOULD, // 1597
    ItemIdentifiers.NEEDLE, // 1733
    ItemIdentifiers.OAK_LOGS, // 1521
    ItemIdentifiers.PIE_DISH, // 2313
    ItemIdentifiers.PLANK, // 960
    ItemIdentifiers.POT_OF_FLOUR, // 1933
    ItemIdentifiers.POTATO_CACTUS, // 3138
    ItemIdentifiers.POTATOES_10_, // 5438
    ItemIdentifiers.PURE_ESSENCE, // 7936
    ItemIdentifiers.REDBERRIES, // 1951
    ItemIdentifiers.ROPE, // 954
    ItemIdentifiers.ROTTEN_TOMATO, // 2518
    ItemIdentifiers.SHEARS, // 1735
    ItemIdentifiers.SKULL, // 964
    ItemIdentifiers.SPADE, // 952
    ItemIdentifiers.SWAMP_PASTE, // 1941
    ItemIdentifiers.THREAD, // 1734
    ItemIdentifiers.TINDERBOX, // 590
    ItemIdentifiers.UNICORN_HORN_DUST, // 235
    ItemIdentifiers.VIAL_OF_WATER, // 227
    ItemIdentifiers.WHITE_APRON, // 1005
    ItemIdentifiers.WHITE_BERRIES, // 239
  ];
  const THORGEL_TICKETS = [
    ItemIdentifiers.AGILITY_ARENA_TICKET, // 2996
    ItemIdentifiers.ARCHERY_TICKET, // 1464
    ItemIdentifiers.CASTLE_WARS_TICKET, // 4067
  ];
  const THORGEL_BOOKS = [
    ItemIdentifiers.CRUMBLING_TOME, // 4707
    ItemIdentifiers.BATTERED_BOOK, // 2886
    ItemIdentifiers.PRIFDDINAS_HISTORY, // 6073
  ];
  const THORGEL_KEYS = [
    ItemIdentifiers.DUSTY_KEY, // 1590
    ItemIdentifiers.JAIL_KEY, // 1591
    ItemIdentifiers.DOOR_KEY, // 2409
  ];
  // "What about/why do you want X?" option ids -> the item they ask about.
  const THORGEL_OPTION_ITEMS = new Map([
    ["XncX8h", ItemIdentifiers.AGILITY_ARENA_TICKET],
    ["LRqv-S", ItemIdentifiers.ARCHERY_TICKET],
    ["S6g98s", ItemIdentifiers.CRUMBLING_TOME],
    ["Lm7ZwZ", ItemIdentifiers.BATTERED_BOOK],
    ["6UEFn2", ItemIdentifiers.PRIFDDINAS_HISTORY],
    ["KjxesV", ItemIdentifiers.DUSTY_KEY],
    ["ch3K7N", ItemIdentifiers.JAIL_KEY],
    ["dcgLeO", ItemIdentifiers.DOOR_KEY],
  ]);

  // Action + condition step ids handled below (all from the ME2 transcript page).
  const ACTION_STEP_IDS = new Set([
    "_RGtoi", "8y9fFM", "hI2ckG", "vIeP1X", "whXSmi", "sbwN7P", "uE8R1r",
    "GOaSlo", "w-k6Vo", "Vm3Uax", "RkA8UR", "oF2-c3", "vExKj3", "IvFJds",
  ]);
  const CONDITION_STEP_IDS = new Set([
    "Dd-_Wd", "YLGj-v", "iQOpYQ", "mQu-Pn", "nKELKC", "EKz9kc", "PMOAnI",
    "CtRddU", "HMxi_o", "XK9eNO", "4mvfGW", "D9BEmz", "ax9rpu", "yACKOx",
    "yt4j4P",
  ]);

  let quest;

  // ==========================================================================
  // Small state helpers
  // ==========================================================================

  function stageOf(player) {
    return quest.getStage(player);
  }

  function setStage(player, value) {
    quest.setStage(player, value);
  }

  function hasItem(player, itemId, amount = 1) {
    return player.getInventory().getAmount(itemId) >= amount;
  }

  function freeSlots(player) {
    return player.getInventory().getFreeSlots();
  }

  function inventoryFull(player) {
    return freeSlots(player) === 0;
  }

  function giveItem(player, itemId, amount = 1) {
    if (freeSlots(player) < 1) {
      player.sendMessage("You need a free inventory space."); // original line: no wiki variant
      return false;
    }
    player.getInventory().adds(itemId, amount);
    return true;
  }

  function grantKey(player) {
    if (!hasItem(player, NEW_KEY) && freeSlots(player) < 1) {
      player.sendMessage("You need a free inventory space."); // original line: no wiki variant
      return;
    }
    if (!hasItem(player, NEW_KEY)) player.getInventory().adds(NEW_KEY, 1);
    if (stageOf(player) < STAGE_TUNNEL_ACCESS) setStage(player, STAGE_TUNNEL_ACCESS);
  }

  function giveNewCrystal(player) {
    if (hasItem(player, BLACKENED_CRYSTAL)) player.getInventory().deleteNumber(BLACKENED_CRYSTAL, 1);
    if (!hasItem(player, NEWLY_MADE_CRYSTAL)) {
      if (!giveItem(player, NEWLY_MADE_CRYSTAL)) return;
    }
    if (stageOf(player) < STAGE_CRYSTAL_MADE) setStage(player, STAGE_CRYSTAL_MADE);
  }

  function chargeCrystal(player) {
    if (!hasItem(player, NEWLY_MADE_CRYSTAL)) return;
    player.getInventory().deleteNumber(NEWLY_MADE_CRYSTAL, 1);
    player.getInventory().adds(POWERED_CRYSTAL, 1);
    if (stageOf(player) < STAGE_POWERED) setStage(player, STAGE_POWERED);
  }

  function resealTemple(player) {
    if (!hasItem(player, POWERED_CRYSTAL)) return;
    player.getInventory().deleteNumber(POWERED_CRYSTAL, 1);
    if (stageOf(player) < STAGE_RESEALED) setStage(player, STAGE_RESEALED);
  }

  function syncAltarDoor(player) {
    const open = stageOf(player) >= STAGE_PUZZLE ? 1 : 0;
    player.getPacketSender().sendVarbit(VARBIT_ALTAR_DOOR, open);
  }

  /**
   * The altar dwarf only transforms to Thorgel on the client while varbit 8467
   * is 1. Set on the door pass (re-sent on login/bootstrap so a relog after the
   * pass keeps him talkable); never cleared, so later stages keep it.
   */
  function syncThorgelAppearance(player) {
    if (stageOf(player) >= STAGE_PUZZLE) {
      player.getPacketSender().sendVarbit(VARBIT_THORGEL_APPEARS, 1);
    }
  }

  // ==========================================================================
  // Thorgel's item list
  // ==========================================================================

  function requiredIds(player) {
    const raw = String(player.getAttribute(THORGEL_LIST_ATTRIBUTE) ?? "");
    const parsed = raw
      .split(",")
      .map((value) => Number(value))
      .filter((value) => Number.isInteger(value) && value > 0);
    if (parsed.length > 0) return parsed;
    const roll = (items) => items[Math.floor(Math.random() * items.length)];
    const picks = [...THORGEL_FIXED_ITEMS, roll(THORGEL_TICKETS), roll(THORGEL_BOOKS), roll(THORGEL_KEYS)];
    player.setAttribute(THORGEL_LIST_ATTRIBUTE, picks.join(","));
    return picks;
  }

  function requiredSet(player) {
    return new Set(requiredIds(player));
  }

  function turnedInSet(player) {
    const raw = String(player.getAttribute(THORGEL_TURNED_IN_ATTRIBUTE) ?? "");
    const ids = raw
      .split(",")
      .map((value) => Number(value))
      .filter((value) => Number.isInteger(value) && value > 0);
    return new Set(ids);
  }

  /** The required items not yet handed in (the list is bigger than the backpack). */
  function outstandingIds(player) {
    const done = turnedInSet(player);
    return requiredIds(player).filter((itemId) => !done.has(itemId));
  }

  function hasAnyOutstanding(player) {
    return outstandingIds(player).some((itemId) => hasItem(player, itemId));
  }

  function hasAllOutstanding(player) {
    const outstanding = outstandingIds(player);
    return outstanding.length > 0 && outstanding.every((itemId) => hasItem(player, itemId));
  }

  function deleteHeldOutstanding(player) {
    const done = turnedInSet(player);
    for (const itemId of outstandingIds(player)) {
      if (!hasItem(player, itemId)) continue;
      player.getInventory().deleteNumber(itemId, 1);
      done.add(itemId);
    }
    player.setAttribute(THORGEL_TURNED_IN_ATTRIBUTE, [...done].join(","));
  }

  function issueList(player) {
    requiredIds(player);
    if (!hasItem(player, ITEM_LIST) && freeSlots(player) >= 1) player.getInventory().adds(ITEM_LIST, 1);
  }

  // ==========================================================================
  // Transcript helpers
  // ==========================================================================

  /** The steps after a top-level step id (for replaying only a variant's tail). */
  function selectAfter(steps, stepId) {
    if (!Array.isArray(steps)) return steps;
    const index = steps.findIndex((step) => step && step.id === stepId);
    return index === -1 ? steps : steps.slice(index + 1);
  }

  /**
   * Plays one transcript variant through NpcDialogues (so the page's speaker
   * heads, menus and jumps resolve), falling back to QuestRuntime's replay for
   * NPCs the dialogue index does not know (Essyllt's 9016).
   */
  function playVariant(player, npcId, variant, select) {
    const request = { player, npcId, variant, select, handled: false };
    api.emitCustomEvent("npc-dialogue:start", request);
    if (request.handled) return true;
    return startTranscript(api, player, npcId, PAGE, variant, select);
  }

  /** Lletya already places Eluned beside Arianwyn; only add her when that spawn is absent. */
  function elunedNear(player, npc) {
    const at = npc?.getLocation?.();
    if (!at) return null;
    for (const other of api.getWorld?.()?.getNpcs?.() ?? []) {
      const name = other?.getCurrentDefinition?.(player)?.getName?.() ?? other?.getDefinition?.()?.getName?.();
      if (other?.getId?.() !== ELUNED_LLETYA_ID && name !== "Eluned") continue;
      const there = other.getLocation?.();
      if (!there || there.getZ() !== at.getZ()) continue;
      if (Math.abs(there.getX() - at.getX()) <= 1 && Math.abs(there.getY() - at.getY()) <= 1) return other;
    }
    return null;
  }

  function clearEluned(player) {
    const npc = elunedCopies.get(player);
    if (npc) {
      try { api.removeNpc(npc); } catch { /* already gone */ }
    }
    elunedCopies.delete(player);
  }

  /**
   * The "Eluned appears next to Arianwyn" stage direction. The static Lletya spawn usually covers
   * it; if a transform or another state has removed her, this owned copy stands in and leaves on
   * her closing line.
   */
  function showEluned(player, arianwyn) {
    clearEluned(player);
    if (elunedNear(player, arianwyn)) return;
    const at = arianwyn?.getLocation?.();
    if (!at) return;
    const offsets = [[0, 1], [1, 0], [-1, 0], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]];
    for (const [dx, dy] of offsets) {
      const tile = new Location(at.getX() + dx, at.getY() + dy, at.getZ());
      if (api.core.RegionManager?.blocked?.(tile, null) === true) continue;
      const npc = api.spawnNpc({
        id: ELUNED_LLETYA_ID, x: tile.getX(), y: tile.getY(), z: tile.getZ(),
        owner: player, ownerOnly: true, wanderRadius: 0,
      });
      if (npc) {
        elunedCopies.set(player, npc);
        return;
      }
    }
  }

  function handleElunedLine(event) {
    if (!elunedCopies.has(event.player)) return;
    if (String(event.text ?? "").includes("Now I had better get going")) clearEluned(event.player);
  }

  function handleLogout(event) {
    clearEluned(event.player);
  }

  // ==========================================================================
  // NPC Talk-to handlers
  // ==========================================================================

  function talkToArianwyn(event) {
    const { player, npcId } = event;
    if (!ARIANWYN_IDS.has(npcId)) return false;
    clearEluned(player);
    const stage = stageOf(player);
    if (stage >= STAGE_COMPLETE) {
      const soteRequest = { player, npcId, handled: false };
      api.emitCustomEvent("quest-song-of-the-elves:claim-arianwyn", soteRequest);
      if (soteRequest.handled) return;
      playVariant(player, npcId, POST_QUEST_VARIANT);
      return;
    }
    if (stage >= STAGE_RESEALED) {
      playVariant(player, npcId, "informing-arianwyn");
      return;
    }
    if (stage >= STAGE_CRYSTAL_MADE) {
      playVariant(player, npcId, "returning-to-arianwyn-after-finding-the-mourner-excavation-team", (steps) =>
        selectAfter(steps, "sbwN7P")
      );
      return;
    }
    if (stage >= STAGE_TEMPLE_FOUND) {
      playVariant(player, npcId, "returning-to-arianwyn-after-finding-the-mourner-excavation-team");
      return;
    }
    if (stage >= STAGE_TUNNEL_ACCESS) {
      playVariant(player, npcId, "returning-to-arianwyn-after-being-given-access-to-the-mourner-tunnels");
      return;
    }
    if (stage >= STAGE_STARTED) {
      playVariant(player, npcId, "starting-the-quest-talking-to-arianwyn-again");
      return;
    }
    playVariant(player, npcId, "starting-the-quest");
  }

  function talkToEssyllt(event) {
    const { player, npcId } = event;
    if (!ESSYLLT_IDS.has(npcId)) return false;
    const stage = stageOf(player);
    if (stage === 0) return false;
    if (stage < STAGE_TUNNEL_ACCESS) {
      startTranscript(api, player, npcId, PAGE, "talking-to-essylt");
      return;
    }
    if (stage < STAGE_TEMPLE_FOUND || stage >= STAGE_COMPLETE) {
      startTranscript(api, player, npcId, PAGE, "talking-to-essylt-talking-to-essylt-again");
      return;
    }
    startTranscript(api, player, npcId, PAGE, "reaching-the-temple-talking-to-essylt-after-finding-the-temple");
  }

  function talkToThorgel(event) {
    const { player, npcId } = event;
    if (npcId !== THORGEL_ID) return false;
    const stage = stageOf(player);
    if (stage < STAGE_PUZZLE || stage >= STAGE_COMPLETE) return false;
    if (stage < STAGE_LIST) {
      playVariant(player, npcId, "the-temple-of-light-meeting-thorgel");
      return;
    }
    playVariant(player, npcId, "the-temple-of-light-retrieving-items-for-thorgel");
  }

  /** The "Yes." start option's quest hook. */
  function handleHook(event) {
    if (event.hook !== START_HOOK) return;
    if (!ARIANWYN_IDS.has(event.npcId)) return;
    if (stageOf(event.player) === 0) setStage(event.player, STAGE_STARTED);
  }

  // ==========================================================================
  // Condition answers
  // ==========================================================================

  function answerCondition(event) {
    const { player, stepId } = event;
    if (!CONDITION_STEP_IDS.has(stepId) && !THORGEL_OPTION_ITEMS.has(stepId)) return null;
    switch (stepId) {
      case "Dd-_Wd":
      case "YLGj-v":
        return inventoryFull(player);
      case "iQOpYQ":
      case "mQu-Pn":
        return !hasItem(player, NEW_KEY);
      case "nKELKC":
        return freeSlots(player) < 2;
      case "EKz9kc":
        return freeSlots(player) >= 2;
      case "PMOAnI":
        return !hasItem(player, BLACKENED_CRYSTAL);
      case "CtRddU":
        return hasItem(player, BLACKENED_CRYSTAL);
      case "HMxi_o":
        return hasItem(player, DEATH_TALISMAN);
      case "XK9eNO":
        return !hasItem(player, DEATH_TALISMAN);
      case "4mvfGW":
        return stageOf(player) >= STAGE_LIST && hasAnyOutstanding(player) && !hasAllOutstanding(player);
      case "D9BEmz":
        // "After the player has turned in all the items": true on the final trip
        // (all remaining items held) and on repeat visits once the list is done.
        return stageOf(player) >= STAGE_LIST && (hasAllOutstanding(player) || outstandingIds(player).length === 0);
      case "ax9rpu":
        return hasItem(player, ITEM_LIST);
      case "yACKOx":
        return !hasItem(player, ITEM_LIST) && freeSlots(player) >= 1;
      case "yt4j4P":
        return !hasItem(player, ITEM_LIST) && freeSlots(player) < 1;
      default:
        break;
    }
    const optionItem = THORGEL_OPTION_ITEMS.get(stepId);
    if (optionItem !== undefined) {
      return stageOf(player) >= STAGE_LIST && requiredSet(player).has(optionItem);
    }
    return null;
  }

  // ==========================================================================
  // Transcript side effects
  // ==========================================================================

  function handleCondition(event) {
    const { player, stepId } = event;
    if (!CONDITION_STEP_IDS.has(stepId)) return;
    if (stepId === "mQu-Pn") {
      grantKey(player);
      return;
    }
    if (stepId === "yACKOx") {
      if (!hasItem(player, ITEM_LIST)) player.getInventory().adds(ITEM_LIST, 1);
      return;
    }
    if (stepId === "4mvfGW") {
      deleteHeldOutstanding(player);
      return;
    }
    if (stepId === "D9BEmz") {
      if (stageOf(player) < STAGE_LIST) return;
      deleteHeldOutstanding(player);
      if (!hasItem(player, DEATH_TALISMAN)) player.getInventory().adds(DEATH_TALISMAN, 1);
      if (stageOf(player) < STAGE_TALISMAN) setStage(player, STAGE_TALISMAN);
    }
  }

  function handleAction(event) {
    const { player, stepId } = event;
    if (!ACTION_STEP_IDS.has(stepId)) return;
    switch (stepId) {
      case "_RGtoi":
      case "8y9fFM":
        grantKey(player);
        return;
      case "hI2ckG":
      case "whXSmi":
        event.handled = true;
        return;
      case "vIeP1X":
        showEluned(player, event.npc);
        event.handled = true;
        return;
      case "sbwN7P":
        giveNewCrystal(player);
        return;
      case "uE8R1r":
        event.handled = true;
        if (stageOf(player) >= STAGE_RESEALED && !quest.isComplete(player)) quest.complete(player);
        return;
      case "GOaSlo":
        event.handled = true;
        if (stageOf(player) < STAGE_ALTAR) setStage(player, STAGE_ALTAR);
        return;
      case "w-k6Vo":
        issueList(player);
        if (stageOf(player) < STAGE_LIST) setStage(player, STAGE_LIST);
        return;
      case "Vm3Uax":
        event.handled = true;
        if (stageOf(player) < STAGE_TEMPLE_FOUND) setStage(player, STAGE_TEMPLE_FOUND);
        return;
      case "RkA8UR":
        if (!hasItem(player, EDERNS_JOURNAL)) giveItem(player, EDERNS_JOURNAL);
        return;
      case "oF2-c3":
        if (!hasItem(player, COLOUR_WHEEL)) giveItem(player, COLOUR_WHEEL);
        if (!hasItem(player, SCRAWLED_NOTES)) giveItem(player, SCRAWLED_NOTES);
        return;
      case "vExKj3":
        chargeCrystal(player);
        return;
      case "IvFJds":
        resealTemple(player);
        return;
      default:
        return;
    }
  }

  // ==========================================================================
  // Object + item interactions
  // ==========================================================================

  function searchGuardOutside(player) {
    if (stageOf(player) < STAGE_TUNNEL_ACCESS) return;
    if (stageOf(player) < STAGE_TEMPLE_FOUND) {
      playVariant(player, ARIANWYN_CHATHEAD, "reaching-the-temple");
      return;
    }
    if (!hasItem(player, EDERNS_JOURNAL)) {
      playVariant(player, ARIANWYN_CHATHEAD, "reaching-the-temple-searching-the-dead-mourner-outside-the-temple");
    }
  }

  function searchGuardInside(player) {
    if (stageOf(player) < STAGE_TEMPLE_FOUND) return;
    // TEMPLE_FOUND > TUNNEL_ACCESS, so the quest is already under way.
    if (hasItem(player, COLOUR_WHEEL) && hasItem(player, SCRAWLED_NOTES)) return;
    playVariant(player, ARIANWYN_CHATHEAD, "reaching-the-temple-searching-the-dead-mourner-inside-the-temple");
  }

  function searchSlave(player) {
    if (stageOf(player) < STAGE_TUNNEL_ACCESS) return;
    playVariant(player, ARIANWYN_CHATHEAD, "reaching-the-temple-searching-the-slaves");
  }

  function searchPillar(player) {
    if (stageOf(player) < STAGE_PUZZLE) return;
    for (const itemId of GREEN_CRYSTALS) {
      if (hasItem(player, itemId)) {
        playVariant(
          player,
          ARIANWYN_CHATHEAD,
          "the-temple-of-light-searching-the-pillar-of-light-with-the-green-crystal"
        );
        return;
      }
    }
  }

  function collectFromDispenser(player) {
    if (stageOf(player) < STAGE_CRYSTAL_MADE) {
      player.sendMessage("The crystal dispenser hums quietly. Eluned's crystal is not ready yet."); // original line
      return;
    }
    player.sendMessage("You reset the light puzzle."); // original line: the wiki variant is missing
    if (stageOf(player) < STAGE_PUZZLE) {
      player.sendMessage("You collect four mirrors and a yellow crystal."); // original line: the wiki variant is missing
      setStage(player, STAGE_PUZZLE);
    }
  }

  function isAltarDoor(location) {
    return (
      !!location &&
      location.z === 0 &&
      location.x === ALTAR_DOOR_X &&
      ALTAR_DOOR_Y.includes(location.y)
    );
  }

  function passAltarDoor(event) {
    const { player, location } = event;
    if (stageOf(player) < STAGE_PUZZLE) {
      player.sendMessage("The light barrier blocks your way."); // original line: barrier state is not scripted
      return;
    }
    const fromWest = player.getLocation().getX() < location.x;
    const offset = fromWest ? ALTAR_DOOR_OFFSET : -ALTAR_DOOR_OFFSET;
    syncThorgelAppearance(player);
    player.moveTo(new Location(location.x + offset, location.y, 0));
  }

  function handleObjectInteraction(event) {
    const { player, objectId, location } = event;
    if (CRYSTAL_DISPENSERS.has(objectId)) {
      event.handled = true;
      collectFromDispenser(player);
      return;
    }
    if (GUARDS_OUTSIDE.has(objectId)) {
      event.handled = true;
      searchGuardOutside(player);
      return;
    }
    if (objectId === GUARD_INSIDE) {
      event.handled = true;
      searchGuardInside(player);
      return;
    }
    if (SLAVES.has(objectId)) {
      event.handled = true;
      searchSlave(player);
      return;
    }
    if (objectId === PILLAR_OF_LIGHT) {
      const claim = { location, claimed: false };
      api.emitCustomEvent("song-of-the-elves:claims-light-pillar", claim);
      if (claim.claimed) return;
      event.handled = true;
      searchPillar(player);
      return;
    }
    if (objectId === ALTAR_LIGHT_DOOR || isAltarDoor(location)) {
      event.handled = true;
      passAltarDoor(event);
    }
  }

  function chipBlackenedCrystal(player) {
    if (stageOf(player) < STAGE_TEMPLE_FOUND || quest.isComplete(player)) return;
    if (
      hasItem(player, BLACKENED_CRYSTAL) ||
      hasItem(player, NEWLY_MADE_CRYSTAL) ||
      hasItem(player, POWERED_CRYSTAL)
    ) {
      return;
    }
    if (freeSlots(player) < 1) {
      player.sendMessage("You need a free inventory space."); // original line: no wiki variant
      return;
    }
    player.getInventory().adds(BLACKENED_CRYSTAL, 1);
    if (stageOf(player) < STAGE_SAMPLE) setStage(player, STAGE_SAMPLE);
    // The wiki dump's message for this step is an image alt, not a line.
    player.sendMessage("You chip off a piece of the blackened crystal.");
  }

  function placeFracturedCrystal(event) {
    const fragment = FRACTURED_CRYSTALS.has(event.itemId);
    if (!fragment || stageOf(event.player) < STAGE_PUZZLE) return false;
    const z = event.location?.z ?? 0;
    if (z === 2) {
      playVariant(event.player, ARIANWYN_CHATHEAD, "the-temple-of-light-fractured-crystal-placing-the-horizontal-crystal");
    } else if (z === 0) {
      playVariant(event.player, ARIANWYN_CHATHEAD, "the-temple-of-light-fractured-crystal-placing-the-vertical-crystal");
    } else {
      playVariant(event.player, ARIANWYN_CHATHEAD, "the-temple-of-light-fractured-crystal-incompatible-pillar");
    }
    return true;
  }

  function handleItemOnObject(event) {
    const { player, itemId, objectId } = event;
    if (itemId === CHISEL && objectId === BLACKENED_CRYSTAL_ROCK) {
      event.handled = true;
      chipBlackenedCrystal(player);
      return;
    }
    if (itemId === NEWLY_MADE_CRYSTAL && objectId === TEMPLE_DEATH_ALTAR) {
      event.handled = true;
      if (stageOf(player) < STAGE_ALTAR) return;
      if (!hasItem(player, DEATH_TALISMAN)) {
        player.sendMessage("You need a death talisman to reach the altar."); // original line
        return;
      }
      playVariant(player, THORGEL_ID, "the-temple-of-light-charging-the-newly-made-crystal-on-the-death-altar");
      return;
    }
    if (itemId === POWERED_CRYSTAL && objectId === BLACKENED_CRYSTAL_ROCK) {
      event.handled = true;
      if (stageOf(player) < STAGE_POWERED) return;
      playVariant(player, THORGEL_ID, "the-temple-of-light-resealing-the-temple");
      return;
    }
    if (objectId === PILLAR_OF_LIGHT) {
      event.handled = placeFracturedCrystal(event);
    }
  }

  // ==========================================================================
  // Journal + rewards
  // ==========================================================================

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      return [
        "<str>I spoke to Arianwyn in Lletya and agreed to investigate</str>",
        "<str>the Temple of Light for the elves.</str>",
        "<str>I restored the temple's safeguards and told Arianwyn.</str>",
        "",
        "<col=ff0000>QUEST COMPLETE!</col>",
      ];
    }
    if (stage >= STAGE_RESEALED) {
      return [
        "<str>I spoke to Arianwyn in Lletya and agreed to investigate</str>",
        "<str>the Temple of Light for the elves.</str>",
        "",
        "I placed the powered crystal among the shards; the temple",
        "safeguards are restored.",
        "",
        "I should tell <col=800000>Arianwyn</col> the temple is safe.",
      ];
    }
    if (stage >= STAGE_POWERED) {
      return [
        "<str>I spoke to Arianwyn in Lletya and agreed to investigate</str>",
        "<str>the Temple of Light for the elves.</str>",
        "",
        "I charged the newly made crystal on the Death Altar.",
        "",
        "I must place it with the <col=800000>blackened crystal</col>.",
      ];
    }
    if (stage >= STAGE_TALISMAN) {
      return [
        "<str>I spoke to Arianwyn in Lletya and agreed to investigate</str>",
        "<str>the Temple of Light for the elves.</str>",
        "",
        "I have Thorgel's <col=800000>death talisman</col>.",
        "I must charge the newly made crystal on the <col=800000>Death Altar</col>.",
      ];
    }
    if (stage >= STAGE_LIST) {
      return [
        "<str>I spoke to Arianwyn in Lletya and agreed to investigate</str>",
        "<str>the Temple of Light for the elves.</str>",
        "",
        "Thorgel at the Death Altar wants supplies from his list.",
        "Give him the items in exchange for a <col=800000>death talisman</col>.",
      ];
    }
    if (stage >= STAGE_PUZZLE) {
      return [
        "<str>I spoke to Arianwyn in Lletya and agreed to investigate</str>",
        "<str>the Temple of Light for the elves.</str>",
        "",
        "I solved the light puzzle and can reach the Death Altar.",
      ];
    }
    if (stage >= STAGE_CRYSTAL_MADE) {
      return [
        "<str>I spoke to Arianwyn in Lletya and agreed to investigate</str>",
        "<str>the Temple of Light for the elves.</str>",
        "",
        "Eluned made me a <col=800000>newly made crystal</col>.",
        "I must take it to the <col=800000>Death Altar</col> at the end of the temple.",
      ];
    }
    if (stage >= STAGE_SAMPLE) {
      return [
        "<str>I spoke to Arianwyn in Lletya and agreed to investigate</str>",
        "<str>the Temple of Light for the elves.</str>",
        "",
        "I chiselled a sample of the <col=800000>blackened crystal</col>.",
        "I should show it to <col=800000>Arianwyn</col>.",
      ];
    }
    if (stage >= STAGE_TEMPLE_FOUND) {
      return [
        "<str>I spoke to Arianwyn in Lletya and agreed to investigate</str>",
        "<str>the Temple of Light for the elves.</str>",
        "",
        "I found the dig team dead outside the temple.",
        "I should search the temple for a black crystal.",
      ];
    }
    if (stage >= STAGE_TUNNEL_ACCESS) {
      return [
        "<str>I spoke to Arianwyn in Lletya and agreed to investigate</str>",
        "<str>the Temple of Light for the elves.</str>",
        "",
        "Essyllt gave me a <col=800000>new key</col> to the mourner tunnels.",
      ];
    }
    if (stage >= STAGE_STARTED) {
      return [
        "<str>Arianwyn asked me to find out how close the Iorwerth</str>",
        "<str>elves are to finding the Temple of Light.</str>",
        "",
        "I should gain access to the mourners' mine under",
        "<col=800000>West Ardougne</col>.",
      ];
    }
    return [
      "I can start this quest by talking to <col=800000>Arianwyn</col>",
      "in <col=800000>Lletya</col>.",
    ];
  }

  function grantReward(player) {
    player.getSkillManager().addExperiences(Skill.AGILITY, 60000);
  }

  // ==========================================================================
  // Login / stage sync
  // ==========================================================================

  function handleLogin({ player }) {
    syncAltarDoor(player);
    syncThorgelAppearance(player);
  }

  function handleBootstrap({ player }) {
    syncAltarDoor(player);
    syncThorgelAppearance(player);
  }

  function handleStageChanged(event) {
    if (!event || event.key !== "mournings_end_part_ii") return;
    if (event.stage === 0) {
      event.player.setAttribute(THORGEL_LIST_ATTRIBUTE, "");
      event.player.setAttribute(THORGEL_TURNED_IN_ATTRIBUTE, "");
    }
    syncAltarDoor(event.player);
  }

  // ==========================================================================
  // Registration
  // ==========================================================================

  api.persistAttribute(THORGEL_LIST_ATTRIBUTE);
  api.persistAttribute(THORGEL_TURNED_IN_ATTRIBUTE);

  quest = registerQuest(api, {
    key: "mournings_end_part_ii",
    name: "Mourning's End Part II",
    varpId: VARP_MOURNINGS_END_PART_II,
    varbitId: VARBIT_STAGE,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 2,
    xpRewards: [{ skillId: Skill.AGILITY.getIndex(), amount: 60000, label: "Agility" }],
    rewardItemId: CRYSTAL_TRINKET,
    rewardItemLabel: "Crystal trinket",
    otherRewards: ["Access to the Death Altar"],
    buildJournal,
    onReward: grantReward,
  });

  api.onNpcInteraction("Arianwyn", { "Talk-to": talkToArianwyn });
  api.onNpcInteraction("Essyllt", { "Talk-to": talkToEssyllt });
  api.onNpcInteraction("Thorgel", { "Talk-to": talkToThorgel });
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:hook", handleHook);
  api.onCustomEvent("npc-dialogue:condition", handleCondition);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onCustomEvent("npc-dialogue:line", handleElunedLine);
  api.onItemOnObject(handleItemOnObject, { noted: false });
  api.onObjectInteraction(handleObjectInteraction);
  api.onPlayerLogin(handleLogin);
  api.onPlayerLogout(handleLogout);
  api.onCustomEvent("player:bootstrap-complete", handleBootstrap);
  api.onCustomEvent("quest:stage-changed", handleStageChanged);
};
