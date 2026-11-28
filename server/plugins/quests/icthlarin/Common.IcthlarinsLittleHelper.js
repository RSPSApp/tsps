/**
 * Icthlarin's Little Helper: what every unit shares (ids, chatbox boxes, timing, the cat, live's fades).
 *
 * Boxes are the chatbox kinds live sends: `mesbox` (messagebox 229), `itemBox` (objectbox 193 with the item's
 * model). A box's `then` runs as the player continues it. `chain` plays several in a row with the callback as
 * the chain's last entry (an ActionDialogue mid-chain stalls the client).
 */
const PAGE = "Icthlarin's Little Helper";

/** Live's fade_overlay (174) values, script 948 [from colour, from alpha, to colour, to alpha, cycles]. */
const FADE = Object.freeze({
  TO_BLACK: [0, 255, 0, 0, 50], // t485, t1033: the screen goes black
  FROM_BLACK: [0, 0, 0, 255, 50], // t493: back from black
  TO_PAST: [0, 0, 3283739, 120, 50], // t1043: from black into the flashback's sepia
  FROM_PAST: [3283739, 120, 0, 0, 50], // t1072: from the flashback's sepia to black
});
/** The flashback's own overlay (ics_flashback 146) in the atmosphere slot (t1046). */
const FLASHBACK_OVERLAY = 146;
const FADE_OVERLAY = 174;
const FADE_SCRIPT = 948;
/** toplevel's overlay_atmosphere slot (164:1 fixed, 161:1 resizable); QuestScenes mounts the same. */
const ATMOSPHERE_UID = (161 << 16) | 1;
const MINIMAP_STATE_VARBIT = 6719;

/** The capture's synths (gamevals with their ids, rev 243). */
const SOUND = Object.freeze({
  hypnotise: 1164, pick2: 2582, happy_meeoow: 1163, sad_meeoow: 1176, scrape: 2410, unlock: 2419, tile_move: 1178,
  tile_reset: 1179, pit_jump: 1172, pit_land: 1174, pit_fall: 1171, pit_shoot: 1175, scarabs_appear: 1478,
  put_down: 2739, quick_teleport: 198, locust_attack: 614, grate_open: 69, clock_tick_1: 3120,
});
/** The capture's sequences. */
const SEQ = Object.freeze({
  drop_to_knee: 1332, // viking_drop_to_knee_and_backtoready (t492)
  pickup_floor: 827, // human_pickupfloor
  reach_for_ladder: 828, // human_reachforladder
  ic_running: 1995, ic_pit_jump: 1992, ic_up_ons: 1993, ic_pit_fall: 1994,
  scarab_spiral: 1949,
});
/** The capture's spotanims. */
const SPOTANIM = Object.freeze({ abyssal_demon_teleport: 409 });

function createCommon(api, state) {
  const {
    ActionDialogue, Animation, CountdownTask, DialogueChainBuilder, Item, ItemIdentifiers, ItemStatementDialogue,
    Location, NpcDialogue, NpcIdentifiers, PlayerDialogue, ObjectIdentifiers, StatementDialogue, TaskManager, CacheDefinitions,
  } = api.core;
  const { startTranscript } = require("../QuestRuntime");

  const seq = (name) => SEQ[name] ?? CacheDefinitions.getSeqId?.(name) ?? -1;
  const sound = (name) => SOUND[name] ?? -1;

  const ITEM = Object.freeze({
    TINDERBOX: ItemIdentifiers.TINDERBOX,
    WATERSKINS: [ItemIdentifiers.WATERSKIN_4_, ItemIdentifiers.WATERSKIN_4__2].filter(Number.isInteger),
    KNIFE: ItemIdentifiers.KNIFE,
    BUCKET: ItemIdentifiers.BUCKET,
    WILLOW_LOGS: ItemIdentifiers.WILLOW_LOGS,
    BAG_OF_SALT: ItemIdentifiers.BAG_OF_SALT,
    PILE_OF_SALT: ItemIdentifiers.PILE_OF_SALT,
    BUCKET_OF_SAP: ItemIdentifiers.BUCKET_OF_SAP,
    BUCKET_OF_SALTWATER: ItemIdentifiers.BUCKET_OF_SALTWATER,
    LINEN: ItemIdentifiers.LINEN,
    HOLY_SYMBOL: ItemIdentifiers.HOLY_SYMBOL_3, // ics_little_holy_symbol
    UNHOLY_SYMBOL: ItemIdentifiers.UNHOLY_SYMBOL_3, // ics_little_unholy_symbol
    TOKEN: ItemIdentifiers.SPHINXS_TOKEN, // ics_little_sphinxstatue
    CATSPEAK: ItemIdentifiers.CATSPEAK_AMULET,
    COINS: ItemIdentifiers.COINS,
    GHOSTSPEAK: [ItemIdentifiers.GHOSTSPEAK_AMULET, ItemIdentifiers.GHOSTSPEAK_AMULET_2, ItemIdentifiers.GHOSTSPEAK_AMULET_3,
      ItemIdentifiers.GHOSTSPEAK_AMULET_4].filter(Number.isInteger),
  });

  /** Live's cats and kittens: the follower npc and its item (Gertrude's Cat's family, hellcats, overgrown). */
  const CAT_ITEMS = Object.freeze([1555, 1556, 1557, 1558, 1559, 1560, 1561, 1562, 1563, 1564, 1565, 1566, 1567, 1568, 1569,
    1570, 1571, 1572, 7581, 7582, 7583]);
  const CAT_NPCS = Object.freeze(new Set([1619, 1620, 1621, 1622, 1623, 1624, 1625, 5591, 5592, 5593, 5594, 5595, 5596, 5597,
    5598, 5599, 5600, 5601, 5602, 5603, 5604, 6662, 6663, 6664, 6665, 6666, 6667, 6668]));

  const held = (player, itemId, amount = 1) => player.getInventory().getAmount(itemId) >= amount;
  const holdsAny = (player, ids) => ids.some((id) => held(player, id));

  function freeSlots(player) {
    const inventory = player.getInventory();
    return typeof inventory.getFreeSlots === "function" ? inventory.getFreeSlots() : inventory.isFull() ? 0 : 28;
  }

  function slotOf(player, itemId) {
    return player.getInventory().getItems().findIndex((item) => item && item.getId() === itemId);
  }

  /** Swaps an item in its own slot, as live does for the jar and the flashback's symbol (t489, t1042). */
  function replaceInSlot(player, fromId, toId) {
    const slot = slotOf(player, fromId);
    if (slot < 0) return false;
    const inventory = player.getInventory();
    inventory.set(slot, new Item(toId >= 0 ? toId : -1, toId >= 0 ? 1 : 0));
    inventory.refreshItems();
    return true;
  }

  function take(player, itemId, amount = 1) {
    if (!held(player, itemId, amount)) return false;
    player.getInventory().deleteNumber(itemId, amount);
    return true;
  }

  /** Plays a variant of the quest's transcript page. */
  function play(player, npcId, variant, select, npc = null) {
    return startTranscript(api, player, npcId, PAGE, variant, select, npc);
  }

  /** Plays a variant of another page (an NPC's own transcript). */
  function playPage(player, npcId, page, variant, select, npc = null) {
    return startTranscript(api, player, npcId, page, variant, select, npc);
  }

  /** `{ text }` messagebox, `{ item, text }` objectbox, then `then` as the last is continued. */
  function chain(player, entries, then) {
    const builder = new DialogueChainBuilder();
    let index = 0;
    for (const entry of entries) {
      if (entry.item !== undefined) builder.add(new ItemStatementDialogue(index++, entry.item, entry.text));
      else if (entry.player !== undefined) builder.add(new PlayerDialogue(index++, entry.player, entry.expression));
      else if (entry.npc !== undefined) builder.add(new NpcDialogue(index++, entry.npc, entry.text, entry.name, entry.expression));
      else builder.add(new StatementDialogue(index++, entry.text));
    }
    if (then) builder.add(new ActionDialogue(index++, { execute: () => then(player) }));
    player.getDialogueManager().startDialogues(builder);
  }
  const mesbox = (player, text, then) => chain(player, [{ text }], then);
  const itemBox = (player, item, text, then) => chain(player, [{ item, text }], then);

  /** Runs `fn` after `ticks`, unless the player has logged out by then. */
  function later(player, ticks, fn) {
    if (ticks <= 0) return fn(player);
    TaskManager.submit(new CountdownTask({ player, unit: "icthlarins-little-helper" }, ticks, () => {
      if (player.isRegistered?.() === false) return;
      fn(player);
    }));
  }

  /** Live's fade_overlay with its own values (FADE); `close` takes it down after `close` ticks. */
  function fade(player, values, { close } = {}) {
    const sender = player.getPacketSender();
    const mount = sender.mountSubInterface(ATMOSPHERE_UID, FADE_OVERLAY, 1, { postScripts: [{ scriptId: FADE_SCRIPT, args: values }] });
    if (close) later(player, close, () => sender.closeSubInterfaceMount?.(mount));
    return mount;
  }

  /** The flashback's sepia overlay, which stays up until the flashback ends. */
  function flashbackOverlay(player, on) {
    const sender = player.getPacketSender();
    if (on) sender.mountSubInterface(ATMOSPHERE_UID, FLASHBACK_OVERLAY, 1);
    else sender.closeSubInterface(ATMOSPHERE_UID);
  }

  function minimap(player, off) {
    player.getPacketSender().sendVarbit(MINIMAP_STATE_VARBIT, off ? 2 : 0);
  }

  function sfx(player, name, delay = 0) {
    const id = sound(name);
    if (id >= 0) player.getPacketSender().sendSoundEffect(id, 1, delay, 255);
  }

  function animate(mobile, name) {
    const id = seq(name);
    if (id >= 0) mobile.performAnimation(new Animation(id));
  }

  /** An empty chatbox the player cannot continue (t485: the messagebox with no continue). */
  function hold(player) {
    player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(
      new ActionDialogue(0, { execute: () => StatementDialogue.send(player, "", false) }, true)
    ));
  }

  function release(player) {
    player.getPacketSender().sendInterfaceRemoval?.();
  }

  /** Live's movement lock across a scene (busy and the walk queue). */
  function lock(player, on) {
    player.getMovementQueue().reset().setBlockMovement(on);
  }

  // ---------------------------------------------------------------------------
  // The cat
  // ---------------------------------------------------------------------------

  /** The player's cat following them, if any (Pets answers "pets:current"). */
  function catFollower(player) {
    const request = { player, pet: null };
    api.emitCustomEvent("pets:current", request);
    const pet = request.pet;
    return pet && CAT_NPCS.has(pet.getId?.()) ? pet : null;
  }

  function catItemSlot(player) {
    return player.getInventory().getItems().findIndex((item) => item && CAT_ITEMS.includes(item.getId()));
  }

  const hasCat = (player) => !!catFollower(player) || catItemSlot(player) >= 0;

  /** The follower's item (the Pets definitions pair each npc with its item). */
  function catItemFor(npc) {
    const request = { pets: [] };
    api.emitCustomEvent("pets:definitions", request);
    const id = npc?.getId?.();
    const pet = (request.pets ?? []).find((entry) => entry.petId === id || entry.morphId === id);
    return pet?.itemId ?? null;
  }

  /** "You pick up your cat." (t466): the follower goes into the inventory, with live's pick2 sound. */
  function pickUpCat(player) {
    const npc = catFollower(player);
    if (!npc) return false;
    const itemId = catItemFor(npc);
    if (!itemId || freeSlots(player) < 1) return false;
    const request = { player, npc, released: false };
    api.emitCustomEvent("pets:release", request);
    if (!request.released) return false;
    player.getInventory().adds(itemId, 1);
    sfx(player, "pick2");
    return true;
  }

  /** The cat comes out of the inventory to follow again (the Sphinx's "Good day.", t585). */
  function dropCat(player) {
    if (catFollower(player)) return true;
    const slot = catItemSlot(player);
    if (slot < 0) return false;
    const itemId = player.getInventory().getItems()[slot].getId();
    const request = { player, itemId, summoned: false, following: false };
    api.emitCustomEvent("pets:summon", request);
    if (!request.following) return false;
    player.getInventory().set(slot, new Item(-1, 0));
    player.getInventory().refreshItems();
    return true;
  }

  /** The Sphinx keeps the cat (Wiki): every cat the player carries or leads goes. */
  function loseCat(player) {
    const npc = catFollower(player);
    if (npc) api.emitCustomEvent("pets:release", { player, npc, released: false });
    for (const id of CAT_ITEMS) {
      const amount = player.getInventory().getAmount(id);
      if (amount > 0) player.getInventory().deleteNumber(id, amount);
    }
  }

  function wearingGhostspeak(player) {
    const amulet = player.getEquipment().get(api.core.Equipment.AMULET_SLOT);
    return ITEM.GHOSTSPEAK.includes(amulet?.getId?.());
  }

  function hasSupplies(player) {
    return holdsAny(player, ITEM.WATERSKINS) && held(player, ITEM.TINDERBOX);
  }

  return {
    PAGE, FADE, SOUND, SEQ, SPOTANIM, ITEM, CAT_ITEMS, CAT_NPCS, Location, NpcIdentifiers, ObjectIdentifiers,
    held, holdsAny, freeSlots, slotOf, replaceInSlot, take, play, playPage, chain, mesbox, itemBox, later, fade, flashbackOverlay,
    minimap, sfx, seq, sound, animate, hold, release, lock,
    catFollower, hasCat, pickUpCat, dropCat, loseCat, catItemSlot, wearingGhostspeak, hasSupplies,
  };
}

module.exports = { PAGE, FADE, SOUND, SEQ, SPOTANIM, createCommon };
