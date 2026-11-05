/**
 * The Wilderness diary's two chests: the Muddy chest in the Lava Maze (Medium) and the Rogues' chest in
 * Rogues' Castle (Elite). Wiki: https://oldschool.runescape.wiki/w/Muddy_chest,
 * https://oldschool.runescape.wiki/w/Chest_(Rogues%27_Castle).
 *
 * Muddy chest (objects 170 closed, 171 open; not members-only, only its extra roll is): "Open" with a muddy key,
 * which is used up. It always gives an uncut ruby, 2 mithril bars (noted) and 5 law, 5 death and 15 chaos
 * runes; on a members world 3/40 of the time one more item: 25 blighted manta rays, 25 blighted karambwan
 * (noted), 25 blighted ancient ice sacks, 15 blighted anglerfish (noted), 3 blighted super restore(4) (noted),
 * each 3/280, or Larran's key, 6/280. The Wiki gives no reset for the chest and no capture shows it, so none is
 * modelled. Muddy keys come from chaos dwarves and crazy archaeologists (the generated drop tables). The diary
 * task is credited when the loot is handed over.
 *
 * Rogues' chest (objects 26757 closed, 26758 open), rsprox 462 and 463 (rev 233), by loc id:
 * - "Open" (oploc1): "You have activated a trap on the chest." with animation 537 (human_lockedchest) and
 *   sound 2400, then a hit the next tick (the Wiki: 16 to 43) with sound 518 (delay 20).
 * - "Search for traps" (oploc2), on the click tick "You search the chest for traps." and "You find a trap on the
 *   chest." with animation 537; 2 ticks on "You disable the trap." (sound 2402); 4 on "You open the chest."
 *   (animation 537, sound 52); 6 on "You find some <item> inside." (animation 536, human_openchest), the chest
 *   becoming 26758, and 702 Thieving experience (the Wiki: 701.7). The chest is back to 26757 34 ticks after
 *   that. Both captures show a Thieving level of 99; the 84 requirement is the Wiki's.
 * - One roll of the Wiki's table by diary tier (medium; hard once the Hard Wilderness diary is done, and for the
 *   Elite), plus a Hard clue scroll 1/99 (2/99 with an imbued ring of wealth; a 2-dose prayer potion in its
 *   place when a hard clue is already held). Since 28 January 2026 the Medium Wilderness diary must be complete
 *   for any loot (the Wiki). The captures' own player had the loot go somewhere other than the inventory (no
 *   inventory update on the loot tick); the Wiki says an open looting bag takes it, which is not modelled.
 * - Every step is checked again when it lands (still there, alive, the chest still closed, still room), and
 *   whether the loot fits is decided before the roll, by a rule that does not depend on it, so a refusal can
 *   never reveal what the chest would have given.
 *
 * Not modelled: the rogues turning aggressive ("Someone's stealing from us, get them!" in the captures; this
 * makes the chest much safer than live), the looting bag, the Muddy chest's reset, the plural wording for the
 * items the captures do not show (only coal and law runes do), and the Wiki's unspecified behaviour when the
 * Medium diary is not complete (here: nothing happens past the line "The chest is empty.", our wording).
 */
const DIARY = "wilderness";
const MUDDY_TASK = "open-the-muddy-chest-in-the-lava-maze";
const ROGUES_TASK = "steal-from-the-rogues-chest";

const MUDDY_CHEST = 170;
const ROGUES_CHEST = 26757;
const ROGUES_CHEST_OPEN = 26758;
const ROGUES_RESTOCK_TICKS = 34;
const ROGUES_THIEVING_LEVEL = 84;
const ROGUES_THIEVING_XP = 701.7;
const TRAP_DAMAGE = { min: 16, max: 43 };
/** Free slots a search needs before it starts and again when it lands: the loot and a possible clue. */
const ROGUES_FREE_SLOTS = 2;

const ANIM = { LOCKED_CHEST: 537, OPEN_CHEST: 536 };
const SOUND = { TRAP: 2400, TRAP_HIT: 518, DISABLE: 2402, OPEN: 52 };

const MUDDY_RARE_CHANCE = 3 / 40;
const HARD_CLUE_CHANCE = 1 / 99;
const HARD_CLUE_CHANCE_IMBUED = 2 / 99;

let api;
let core;
const restocking = new WeakMap();
const busy = new WeakMap();

function ids() {
  return core.ItemIdentifiers;
}

function noted(baseId) {
  const noteId = core.ItemDefinition.forId(baseId).getNoteId();
  return noteId > 0 ? noteId : baseId;
}

const membersWorld = () => core.WorldDefinition.isMembersWorld();

/** [item id, amount]. */
function muddyAlways() {
  const I = ids();
  return [[I.UNCUT_RUBY, 1], [noted(I.MITHRIL_BAR), 2], [I.LAW_RUNE, 5], [I.DEATH_RUNE, 5], [I.CHAOS_RUNE, 15]];
}

/** The 3/40 extra roll: [item id, amount, weight out of 280]. */
function muddyRare() {
  const I = ids();
  return [
    [noted(I.BLIGHTED_MANTA_RAY), 25, 3],
    [noted(I.BLIGHTED_KARAMBWAN), 25, 3],
    [I.BLIGHTED_ANCIENT_ICE_SACK, 25, 3],
    [noted(I.BLIGHTED_ANGLERFISH), 15, 3],
    [noted(I.BLIGHTED_SUPER_RESTORE_4_), 3, 3],
    [I.LARRANS_KEY_2, 1, 6],
  ];
}

/** [item id, amount (medium), amount (hard), weight out of 66, the item as "You find some ___ inside."]. */
function roguesTable() {
  const I = ids();
  return [
    [I.NATURE_RUNE, 40, 50, 11, "nature runes"],
    [noted(I.RED_SPIDERS_EGGS), 6, 7, 10, "red spiders' eggs"],
    [I.LAW_RUNE, 40, 50, 10, "law runes"],
    [noted(I.COAL), 20, 25, 8, "coal"],
    [I.COINS, 4500, 5625, 6, "coins"],
    [noted(I.VILE_ASHES), 15, 18, 3, "vile ashes"],
    [noted(I.UNCUT_DIAMOND), 3, 3, 3, "uncut diamonds"],
    [noted(I.UNCUT_DIAMOND), 5, 6, 2, "uncut diamonds"],
    [noted(I.UNCUT_EMERALD), 10, 12, 2, "uncut emeralds"],
    [I.BLIGHTED_ANCIENT_ICE_SACK, 13, 16, 2, "blighted ancient ice sacks"],
    [noted(I.IRON_ORE), 40, 50, 1, "iron ore"],
    [I.CHAOS_RUNE, 60, 75, 1, "chaos runes"],
    [I.DEATH_RUNE, 50, 62, 1, "death runes"],
    [noted(I.BLIGHTED_MANTA_RAY), 20, 25, 1, "blighted manta rays"],
    [noted(I.BLIGHTED_ANGLERFISH), 15, 18, 1, "blighted anglerfish"],
    [noted(I.UNCUT_SAPPHIRE), 15, 18, 1, "uncut sapphires"],
    [I.PRAYER_POTION_2_, 1, 1, 2, "prayer potions"],
    [noted(I.DRAGONSTONE), 2, 2, 1, "dragonstones"],
  ];
}

function pick(rows, weightIndex, random) {
  const total = rows.reduce((sum, row) => sum + row[weightIndex], 0);
  let roll = random() * total;
  for (const row of rows) {
    roll -= row[weightIndex];
    if (roll < 0) return row;
  }
  return rows[rows.length - 1];
}

function muddyLoot(random = Math.random, members = membersWorld()) {
  const loot = muddyAlways().map(([id, amount]) => new core.Item(id, amount));
  if (members && random() < MUDDY_RARE_CHANCE) {
    const [id, amount] = pick(muddyRare(), 2, random);
    loot.push(new core.Item(id, amount));
  }
  return loot;
}

function holds(player, tier) {
  const names = new Set(["clue scroll", "clue bottle", "clue nest", "scroll box"].map((kind) => `${kind} (${tier})`));
  const has = (container) => container?.getItems?.().some((item) => item?.getAmount?.() > 0 && item.getId() > 0
    && names.has(String(core.ItemDefinition.forId(item.getId())?.getName?.() ?? "").toLowerCase()));
  return has(player.getInventory()) || Array.from({ length: core.Bank.TOTAL_BANK_TABS }, (_, tab) => player.getBank(tab)).some(has);
}

/** One roll of the table: { loot: [Item], text } (and the clue, when it comes). */
function roguesLoot(player, hard, random = Math.random) {
  const [id, medium, hardAmount, , text] = pick(roguesTable(), 3, random);
  const loot = [new core.Item(id, hard ? hardAmount : medium)];
  const imbued = require("./RingOfWealth.plugin").isWearingImbuedRingOfWealth(player);
  if (random() < (imbued ? HARD_CLUE_CHANCE_IMBUED : HARD_CLUE_CHANCE)) {
    // Wiki: a hard clue rolled while one is already held gives a prayer potion(2) instead.
    loot.push(holds(player, "hard") ? new core.Item(ids().PRAYER_POTION_2_, 1) : new core.Item(ids().CLUE_SCROLL_HARD_, 1));
  }
  return { loot, text };
}

/**
 * Whether the guaranteed items fit with one slot to spare for the extra roll (whatever it turns out to be),
 * planned on a copy of the inventory with the key already gone, so a stack of the same id but another kind
 * (a preset rune stack) or one near its cap is counted as the add would find it.
 */
function muddyRoom(player) {
  const copy = new core.Inventory(player);
  copy.setItems(player.getInventory().getCopiedItems());
  copy.deleteNumber(ids().MUDDY_KEY, 1);
  for (const [id, amount] of muddyAlways()) {
    const item = new core.Item(id, amount);
    if (copy.getAddableAmount(item) < amount) return false;
    copy.add(item, false);
  }
  return copy.getFreeSlots() >= 1;
}

function give(player, items) {
  for (const item of items) player.getInventory().add(new core.Item(item.getId(), item.getAmount()), false);
  player.getInventory().refreshItems();
}

const credit = (player, task) => api.emitCustomEvent("diary:task", { player, diary: DIARY, task });

function tierComplete(player, tier) {
  const query = { player, diary: DIARY, tier, complete: false };
  api.emitCustomEvent("diary:is-complete", query);
  return query.complete === true;
}

const inWilderness = (object) => core.Wilderness.levelAt(object.getLocation().getX(), object.getLocation().getY()) > 0;

// ------------------------------------------------------------------ Muddy chest

function openMuddyChest(event, random = Math.random) {
  const { player } = event;
  const inventory = player.getInventory();
  if (!inventory.contains(ids().MUDDY_KEY)) {
    player.sendMessage("This chest is locked.");
    return true;
  }
  if (!muddyRoom(player)) {
    player.sendMessage("You need more inventory space to open the chest.");
    return true;
  }
  const loot = muddyLoot(random);
  inventory.deleteNumber(ids().MUDDY_KEY, 1);
  give(player, loot);
  credit(player, MUDDY_TASK);
  return true;
}

// ------------------------------------------------------------------ Rogues' chest

function restock(object) {
  if (restocking.has(object)) return;
  const opened = new core.GameObject(ROGUES_CHEST_OPEN, object.getLocation().clone(), object.getType(), object.getFace(), object.getPrivateArea())
    .setOwner(object.getOwner());
  restocking.set(object, opened);
  if (!object.getPrivateArea()?.isDestroyed()) {
    core.ObjectManager.deregister(object, true);
    core.ObjectManager.register(opened, true);
  }
  core.TaskManager.submit(new core.CountdownTask(object, ROGUES_RESTOCK_TICKS, () => {
    restocking.delete(object);
    if (object.getPrivateArea()?.isDestroyed()) return;
    core.ObjectManager.deregister(opened, true);
    object.getPrivateArea()?.add(object);
    core.ObjectManager.register(object, true);
  }));
}

const alive = (player) => player.isRegistered?.() !== false && player.getHitpoints?.() > 0;

/** The player is still where the sequence began, alive, and not doing something else with the chest. */
function stillThere(player, start) {
  const at = player.getLocation();
  return alive(player) && at.getX() === start.getX() && at.getY() === start.getY() && at.getZ() === start.getZ();
}

function later(player, ticks, action) {
  core.TaskManager.submit(new core.CountdownTask(player, ticks, action));
}

function trapChest(event, random = Math.random) {
  const { player } = event;
  player.sendMessage("You have activated a trap on the chest.");
  player.performAnimation(new core.Animation(ANIM.LOCKED_CHEST));
  player.getPacketSender().sendSound(SOUND.TRAP, 10, 0);
  later(player, 1, () => {
    if (!alive(player)) return;
    const damage = TRAP_DAMAGE.min + Math.floor(random() * (TRAP_DAMAGE.max - TRAP_DAMAGE.min + 1));
    player.getCombat().getHitQueue().addPendingDamage([new core.HitDamage(damage, core.HitMask.RED)]);
    player.getPacketSender().sendSound(SOUND.TRAP_HIT, 10, 20);
  });
  return true;
}

function searchRoguesChest(event, random = Math.random) {
  const { player, object } = event;
  if (busy.has(player) || restocking.has(object)) return true;
  if (player.getSkillManager().getCurrentLevel(core.Skill.THIEVING) < ROGUES_THIEVING_LEVEL) {
    player.sendMessage(`You need a Thieving level of at least ${ROGUES_THIEVING_LEVEL} to steal from this chest.`);
    return true;
  }
  // Wiki: since 28 January 2026 the Medium diary must be complete for any loot.
  if (!tierComplete(player, "medium")) {
    player.sendMessage("The chest is empty.");
    return true;
  }
  if (player.getInventory().getFreeSlots() < ROGUES_FREE_SLOTS) {
    player.sendMessage("You need more inventory space for the loot.");
    return true;
  }
  const start = player.getLocation().clone();
  const sequence = { start };
  busy.set(player, sequence);
  const step = (ticks, action) => later(player, ticks, () => {
    if (busy.get(player) !== sequence) return;
    if (!stillThere(player, start) || restocking.has(object)) {
      busy.delete(player);
      return;
    }
    action();
  });

  player.sendMessage("You search the chest for traps.");
  player.sendMessage("You find a trap on the chest.");
  player.performAnimation(new core.Animation(ANIM.LOCKED_CHEST));
  step(2, () => {
    player.sendMessage("You disable the trap.");
    player.getPacketSender().sendSound(SOUND.DISABLE, 10, 0);
  });
  step(4, () => {
    player.sendMessage("You open the chest.");
    player.performAnimation(new core.Animation(ANIM.LOCKED_CHEST));
    player.getPacketSender().sendSound(SOUND.OPEN, 10, 0);
  });
  step(6, () => {
    busy.delete(player);
    // Checked again as it lands: the diary, the room, and the chest still closed.
    if (!tierComplete(player, "medium") || player.getInventory().getFreeSlots() < ROGUES_FREE_SLOTS) return;
    const { loot, text } = roguesLoot(player, tierComplete(player, "hard") || tierComplete(player, "elite"), random);
    give(player, loot);
    player.sendMessage(`You find some ${text} inside.`);
    player.performAnimation(new core.Animation(ANIM.OPEN_CHEST));
    player.getSkillManager().addExperiences(core.Skill.THIEVING, ROGUES_THIEVING_XP);
    restock(object);
    credit(player, ROGUES_TASK);
  });
  return true;
}

function interact(event) {
  const { player, objectId, object } = event;
  if (!player || !object || (objectId !== MUDDY_CHEST && objectId !== ROGUES_CHEST)) return false;
  if (player.getPrivateArea?.() != null || !inWilderness(object)) return false;
  const option = event.definition?.getInteractions?.()?.[event.clickType - 1];
  if (objectId === MUDDY_CHEST) return option === "Open" ? openMuddyChest(event) : false;
  if (!membersWorld()) return false;
  if (option === "Search for traps") return searchRoguesChest(event);
  return option === "Open" ? trapChest(event) : false;
}

module.exports = {
  name: "WildernessChests",
  register(pluginApi) {
    api = pluginApi;
    core = pluginApi.core;
    pluginApi.onObjectInteraction((event) => {
      if (interact(event)) event.handled = true;
    });
  },
  _test: { muddyLoot, roguesLoot, muddyAlways, muddyRare, roguesTable, muddyRoom, restocking, busy, MUDDY_CHEST, ROGUES_CHEST, ROGUES_CHEST_OPEN, ROGUES_RESTOCK_TICKS, ROGUES_FREE_SLOTS },
};
