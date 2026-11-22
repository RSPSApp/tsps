// The Barracuda Trials' key chests (docs/barracuda-trials.md): each trial's Swordfish key (its
// first rank reward) opens one chest on an island, with the trial's cruiser outfit inside.
//   rsprox 3461 (the Pandemonium Cave chest with the Stormy key), from the arrival tick: +2
//   human_openchest (delay 10), sounds 2419 and 52 (delay 10), the key taken; +3 sound 51 (delay
//   45), the open chest, the outfit and 10 noted uncut sapphires, varbit sailing_bt_stormy_key_used
//   1, "You unlock the chest with the key you're carrying and find some treasure inside." in an
//   objectbox_double with the hat and the top; +5 the chest closed again.
//   rsprox 936 (Anglers' Retreat, no key): +2 sound 2402 and "The chest is securely locked. It
//   looks like it needs a key to open it." in a messagebox.
// The Wiki (Chest (Pandemonium Cave), Chest (Anglers' Retreat), Chest (Laguna Aurorae), and the
// Stormy, Fetid and Serrated key pages): the first open also gives coins (10,000, 20,000 and
// 35,000; not in rsprox 3461, a rev 235 recording); 8 noted uncut emeralds and 8 noted uncut rubies
// at the other two; once the key is used the chest opens without one and gives the outfit pieces
// the player doesn't own ("You open the chest and find some treasure inside."), or "You open the
// chest, but find nothing of note inside." when they own them all. Since 26 November 2025 the key
// isn't used up when the loot doesn't fit.
const common = require("./Common.BarracudaTrials");

const ANIM_DELAY = 10;
const SOUND_UNLOCK = [[2419, 0], [52, 10]];
const SOUND_LOOT = [51, 45];
const SOUND_LOCKED = 2402;
const OPEN_TICKS = 2;
const LOCKED = "The chest is securely locked. It looks like it needs a key to open it.";
const UNLOCKED = "You unlock the chest with the key you're carrying and<br>find some treasure inside.";
const TREASURE = "You open the chest and find some treasure inside.";
const NOTHING = "You open the chest, but find nothing of note inside.";
/** Ours: the Wiki has no line for a full inventory. */
const NO_ROOM = "You don't have enough inventory space.";
const OPENING = new WeakSet();

/** Each trial's chest, its key and its loot (the Wiki chest pages; the gem amounts from them too). */
const CHESTS = Object.freeze([
  { trial: "tempor_tantrum", loc: "locked_chest_pandemonium", openLoc: "locked_chest_pandemonium_open", key: "stormy_key",
    outfit: "tempor_tantrum_cosmetic", coins: 10000, gems: ["cert_uncut_sapphire", 10] },
  { trial: "jubbly_jive", loc: "locked_chest_anglers_light", openLoc: "locked_chest_anglers_light_open", key: "fetid_key",
    outfit: "jubbly_jive_cosmetic", coins: 20000, gems: ["cert_uncut_emerald", 8] },
  { trial: "gwenith_glide", loc: "locked_chest_laguna_aurorae", openLoc: "locked_chest_laguna_aurorae_open", key: "serrated_key",
    outfit: "gwenith_glide_cosmetic", coins: 35000, gems: ["cert_uncut_ruby", 8] },
]);
const PIECES = ["head", "chest", "legs", "feet"];

let byLoc;
function chests() {
  if (byLoc) return byLoc;
  const { CacheDefinitions } = common.core();
  const obj = (name) => CacheDefinitions.getObjId(name);
  byLoc = new Map(CHESTS.map((chest) => [CacheDefinitions.getLocId(chest.loc), {
    ...chest,
    locId: CacheDefinitions.getLocId(chest.loc),
    openLocId: CacheDefinitions.getLocId(chest.openLoc),
    keyId: obj(chest.key),
    outfitIds: PIECES.map((piece) => obj(`${chest.outfit}_${piece}`)),
    coinsId: obj("coins"),
    gemsId: obj(chest.gems[0]),
  }]));
  return byLoc;
}

function markKeyUsed(player, chest) {
  common.updateProgress(player, common.trialByKey(chest.trial), (saved) => { saved.extra = { ...saved.extra, keyUsed: true }; });
  player.getPacketSender().sendVarbit(common.varbit(common.KEY_USED_VARBITS[chest.trial]), 1);
}

function later(ticks, action) {
  const { CountdownTask, TaskManager } = common.core();
  TaskManager.submit(new CountdownTask({}, ticks, action));
}

function box(player, dialogue) {
  const { DialogueChainBuilder, EndDialogue } = common.core();
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(dialogue, new EndDialogue(1)));
}

function setOpen(chest, object, open) {
  const { ObjectManager, GameObject } = common.core();
  const id = open ? chest.openLocId : chest.locId;
  ObjectManager.register(new GameObject(id, object.getLocation().clone(), object.getType(), object.getFace(), object.getPrivateArea?.() ?? null), true);
}

/**
 * Whether the whole loot fits: a stack already carried must take its full amount (no stack past its
 * cap), every other item needs a free slot, and `freed` slots (the key's) count as free.
 */
function fits(player, items, freed = 0) {
  const inventory = player.getInventory();
  const { Item, ItemDefinition } = common.core();
  let needed = 0;
  for (const [id, amount] of items) {
    if (ItemDefinition.forId(id).isStackable() && inventory.contains(id)) {
      if (inventory.getAddableAmount(new Item(id, amount)) < amount) return false;
    } else {
      needed++;
    }
  }
  return inventory.getFreeSlots() + freed >= needed;
}

function give(player, items) {
  const { Item } = common.core();
  for (const [id, amount] of items) {
    player.getInventory().addItem(new Item(id, amount));
    common.api().emitCustomEvent("collection-log:obtain", { player, itemId: id, amount });
  }
}

/** The pieces of the outfit the player doesn't own anywhere. */
function missingPieces(player, chest) {
  return chest.outfitIds.filter((id) => !common.owns(player, id));
}

function open(event) {
  const chest = chests().get(event.objectId);
  if (!chest) return false;
  const { player, object } = event;
  if (OPENING.has(player)) return true;
  const used = common.keyUsed(player, common.trialByKey(chest.trial));
  if (!used && !player.getInventory().contains(chest.keyId)) {
    player.getPacketSender().sendSoundEffect(SOUND_LOCKED, 1, 0);
    box(player, new (common.core().StatementDialogue)(0, LOCKED));
    return true;
  }
  const items = used
    ? missingPieces(player, chest).map((id) => [id, 1])
    : [...chest.outfitIds.map((id) => [id, 1]), [chest.coinsId, chest.coins], [chest.gemsId, chest.gems[1]]];
  if (items.length && !fits(player, items, used ? 0 : 1)) {
    player.sendMessage(NO_ROOM);
    return true;
  }
  const { Animation, CacheDefinitions, StatementDialogue, DoubleItemStatementDialogue } = common.core();
  OPENING.add(player);
  player.performAnimation(new Animation(CacheDefinitions.getSeqId("human_openchest"), ANIM_DELAY));
  for (const [sound, delay] of SOUND_UNLOCK) player.getPacketSender().sendSoundEffect(sound, 1, delay);
  if (!used) player.getInventory().deleteNumber(chest.keyId, 1);
  later(1, () => {
    // The bag may have changed since the check: nothing is given and the key goes back.
    if (items.length && !fits(player, items)) {
      if (!used) player.getInventory().addItem(new (common.core().Item)(chest.keyId, 1));
      player.sendMessage(NO_ROOM);
      OPENING.delete(player);
      return;
    }
    player.getPacketSender().sendSoundEffect(SOUND_LOOT[0], 1, SOUND_LOOT[1]);
    setOpen(chest, object, true);
    give(player, items);
    if (!used) {
      markKeyUsed(player, chest);
      box(player, new DoubleItemStatementDialogue(0, chest.outfitIds[0], chest.outfitIds[1], UNLOCKED));
    } else if (items.length) {
      // Ours: the box for a reopen isn't recorded; the first piece given is shown.
      box(player, new (common.core().ItemStatementDialogue)(0, items[0][0], TREASURE));
    } else {
      box(player, new StatementDialogue(0, NOTHING));
    }
    later(OPEN_TICKS, () => {
      setOpen(chest, object, false);
      OPENING.delete(player);
    });
  });
  return true;
}

function attach(api) {
  api.onObjectInteraction("Chest", { Open: open });
}

module.exports = attach;
module.exports.open = open;
module.exports.CHESTS = CHESTS;
