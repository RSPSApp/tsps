/**
 * The Alchemists' Playground (Wiki: Mage_Training_Arena/Alchemist's_Playground, Coin_Collector,
 * Alchemy_Guardian, Coins_(Mage_Training_Arena)):
 * - Low Level Alchemy (Magic 21) to go in; no coins may be taken in;
 * - six cupboards hold boots, a kiteshield, a helm, an emerald, a longsword and nothing, always in
 *   that clockwise order, the order turning round the cupboards; Search takes one, Take-5 five;
 * - every 60 seconds the items move and each takes one of the values 1, 5, 8, 15 and 30 coins,
 *   shown on the overlay; sometimes one is free to convert - its alchemy uses no runes;
 * - alching one gives that many of the arena's coins (low or high alchemy alike, with the
 *   spell's own XP); the Coin Collector takes them: 1 Alchemist Pizazz Point per 100 (the rest
 *   a chance of one more), 10 real coins per 100 to the bank (the inventory for an Ultimate
 *   Ironman) and 2 Magic XP per coin;
 * - both alchemies take 5 ticks here (Wiki), so a cast inside that is refused;
 * - leaving deposits the arena's coins first, then the room's items and coins are gone; logging
 *   out keeps both (since 8 May 2024).
 */
const Common = require("./Common.MageTrainingArena");

const playground = {
  area: null,
  task: null,
  tickCount: 0,
  /** Where the item order starts this turn: the cupboard holding the boots. */
  offset: 0,
  /** Coins per item key this turn. */
  values: {},
  free: null,
};

const inPlayground = (location) => Common.inBox(location, Common.data.alchemists.bounds);
const itemKeys = () => Common.data.alchemists.items.filter(Boolean);
const keyOf = (itemId) => itemKeys().find((key) => Common.ids.items[key] === itemId) ?? null;

/** What cupboard `index` holds this turn (null: the empty one). */
function cupboardItem(index) {
  const { items } = Common.data.alchemists;
  return items[(index - playground.offset + items.length * 2) % items.length];
}

// --- The changes

/** New positions, new values, and maybe a free item, announced by the guardian. */
function change(random = Math.random) {
  const { alchemists } = Common.data;
  playground.offset = Math.floor(random() * alchemists.items.length);
  const values = [...alchemists.values];
  for (let i = values.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [values[i], values[j]] = [values[j], values[i]];
  }
  playground.values = Object.fromEntries(itemKeys().map((key, i) => [key, values[i]]));
  playground.free = random() < alchemists.freeChance ? itemKeys()[Math.floor(random() * itemKeys().length)] : null;
  const guardian = guardianNpc();
  guardian?.forceChat?.(Common.message("costsChanging"));
  if (playground.free) Common.later(2, () => guardian?.forceChat?.(Common.message("free", { item: alchemists.freeNames[playground.free] })));
  for (const player of players()) updateOverlay(player);
}

function guardianNpc() {
  const id = Common.ids.npcs.alchemyGuardian;
  return Common.core.World.getNpcs().search((npc) => npc?.getId?.() === id && inPlayground(npc.getLocation())) ?? null;
}

function players() {
  return playground.area ? playground.area.getPlayers().filter((player) => player?.isRegistered?.() !== false) : [];
}

function tick() {
  playground.tickCount += 1;
  if (players().length === 0) {
    playground.task?.stop?.();
    playground.task = null;
    return;
  }
  if (playground.tickCount % Common.data.alchemists.changeTicks === 0) change();
}

function ensureRunning() {
  if (playground.task) return;
  if (!Object.keys(playground.values).length) change();
  const { Task, TaskManager } = Common.core;
  playground.task = new (class extends Task {
    constructor() {
      super(1, "mage-training-arena:alchemists", false);
    }
    execute() {
      tick();
    }
  })();
  TaskManager.submit(playground.task);
}

// --- The overlay

function updateOverlay(player) {
  const { components } = Common.ids;
  const sender = player.getPacketSender();
  sender.sendString(Common.points(player, "alchemist").toLocaleString("en-GB"), components.alchemistPoints);
  itemKeys().forEach((key, i) => {
    sender.sendString(String(playground.values[key] ?? 0), components[`cost${i + 1}`]);
    sender.sendInterfaceDisplayState(components[`free${i + 1}`], key !== playground.free);
  });
}

// --- The cupboards

function takeFrom(player, objectId, many) {
  const index = Common.data.alchemists.cupboards.findIndex((key) => Common.ids.locs[key] === objectId);
  if (index < 0) return false;
  const key = cupboardItem(index);
  if (!key) {
    player.sendMessage(Common.message("cupboardEmpty"));
    return true;
  }
  const inventory = player.getInventory();
  const amount = Math.min(many ? Common.data.alchemists.takeMany : 1, inventory.getFreeSlots());
  if (amount <= 0) {
    player.sendMessage(Common.message("inventoryFull"));
    return true;
  }
  for (let i = 0; i < amount; i++) inventory.adds(Common.ids.items[key], 1);
  return true;
}

const search = ({ player, objectId }) => takeFrom(player, objectId, false);
const takeFive = ({ player, objectId }) => takeFrom(player, objectId, true);

// --- Alchemy on the room's items

/**
 * "magic:alchemy-policy": the room's items alch for this turn's value in the arena's coins, one
 * cast per 5 ticks (low alchemy as slow as high here, Wiki).
 */
function alchemyPolicy(policy) {
  const { player, itemId } = policy;
  const key = keyOf(itemId);
  if (!key || !inPlayground(player.getLocation())) return;
  const cycle = Common.core.World.getProcessCycle();
  if ((player.__mtaNextAlch ?? -1) > cycle) {
    policy.allowed = false;
    return;
  }
  policy.allowed = true;
  policy.coins = 0;
  player.__mtaAlch = { itemId, coins: playground.values[key] ?? 0, free: key === playground.free, spellId: policy.spellId, cycle };
}

/** The free item's alchemy takes no runes (only for the cast its policy just allowed). */
function runeBypass(event) {
  const pending = event.player?.__mtaAlch;
  if (!pending?.free || pending.spellId !== event.spellId || pending.cycle !== Common.core.World.getProcessCycle()) return;
  event.bypass = true;
}

function alchemyCompleted({ player, itemId }) {
  const pending = player.__mtaAlch;
  player.__mtaAlch = null;
  if (!pending || pending.itemId !== itemId) return;
  player.__mtaNextAlch = Common.core.World.getProcessCycle() + Common.data.alchemists.alchemyTicks;
  if (pending.coins > 0) player.getInventory().adds(Common.ids.items.arenaCoins, pending.coins);
  updateOverlay(player);
}

// --- The Coin Collector

function isUltimateIronman(player) {
  const query = { player, mode: null };
  Common.api.emitCustomEvent("ironman:mode", query);
  return query.mode === "ultimate";
}

/** Pays in every arena coin carried; returns the points earned. */
function depositCoins(player, random = Math.random) {
  const { alchemists } = Common.data;
  const { items } = Common.ids;
  const coins = player.getInventory().getAmount(items.arenaCoins);
  if (coins <= 0) return 0;
  player.getInventory().deleteNumber(items.arenaCoins, coins);
  const whole = Math.floor(coins / alchemists.coinsPerPoint);
  const rest = coins % alchemists.coinsPerPoint;
  const points = whole + (random() < rest / alchemists.coinsPerPoint ? 1 : 0);
  Common.addPoints(player, "alchemist", points);
  player.getSkillManager().addExperiences(Common.core.Skill.MAGIC, coins * alchemists.depositXp);
  const real = whole * alchemists.coinsBack;
  if (real > 0) payCoins(player, real);
  player.sendMessage(Common.message("deposited", { coins: coins.toLocaleString("en-GB"), cs: coins === 1 ? "" : "s", points, s: points === 1 ? "" : "s" }));
  if (inPlayground(player.getLocation())) updateOverlay(player);
  return points;
}

/**
 * The real coins: to the bank, or the inventory for an Ultimate Ironman (Wiki). What the bank
 * can't take goes to the pack, and what the pack can't take to the floor.
 */
function payCoins(player, amount) {
  const { Bank, Item, ItemOnGroundManager } = Common.core;
  const coins = Common.ids.items.coins;
  let left = amount;
  if (!isUltimateIronman(player) && Bank && player.getBank) {
    const bank = player.getBank(Bank.getTabForItem(player, coins));
    const room = Math.min(left, Number(bank?.getAddableAmount?.(new Item(coins, left))) || 0);
    if (room > 0) {
      bank.add(new Item(coins, room));
      left -= room;
      player.sendMessage(Common.message("coinsToBank", { coins: room.toLocaleString("en-GB") }));
    }
  }
  if (left <= 0) return;
  const inventory = player.getInventory();
  const carried = Math.min(left, Number(inventory.getAddableAmount?.(new Item(coins, left)) ?? left) || 0);
  if (carried > 0) {
    inventory.adds(coins, carried);
    left -= carried;
  }
  if (left > 0) ItemOnGroundManager.registerLocation(player, new Item(coins, left), player.getLocation().clone());
}

function collector({ player, objectId }) {
  if (objectId !== Common.ids.locs.coinCollector) return false;
  if (player.getInventory().getAmount(Common.ids.items.arenaCoins) <= 0) player.sendMessage(Common.message("nothingToDeposit"));
  else depositCoins(player);
  return true;
}

/** The room's items and coins stay in the room. */
function removeRoomItems(player) {
  const { items } = Common.ids;
  let removed = 0;
  for (const id of [...itemKeys().map((key) => items[key]), items.arenaCoins]) {
    const amount = player.getInventory().getAmount(id);
    if (amount > 0) {
      player.getInventory().deleteNumber(id, amount);
      removed += amount;
    }
  }
  return removed;
}

/** The Alchemists Teleport: Magic 21 (boostable), and no coins (Wiki). */
function enter({ player, objectId }) {
  if (objectId !== Common.ids.locs.alchemistsPortal) return false;
  const { level, arrive } = Common.data.alchemists;
  if (player.getSkillManager().getCurrentLevel(Common.core.Skill.MAGIC) < level) {
    player.sendMessage(Common.message("level", { level, room: "Alchemists' Playground" }));
    return true;
  }
  if (player.getInventory().contains(Common.ids.items.coins)) {
    player.sendMessage(Common.message("noCoins"));
    return true;
  }
  player.moveTo(Common.toLocation(arrive));
  return true;
}

// --- The area

function defineArea() {
  const { Area, Boundary } = Common.core;
  const [minX, maxX, minY, maxY, z] = Common.data.alchemists.bounds;
  return class AlchemistsPlayground extends Area {
    constructor() {
      super([new Boundary(minX, maxX, minY, maxY, z)]);
    }

    getName() {
      return "Alchemists' Playground";
    }

    postEnter(mobile) {
      if (!mobile?.isPlayer?.()) return;
      const player = mobile.getAsPlayer();
      ensureRunning();
      Common.sendOverlay(player, Common.ids.interfaces.alchemists);
      updateOverlay(player);
    }

    /** Coins are paid in on any way out but a logout (that keeps them, since 8 May 2024); then the items go. */
    postLeave(mobile, logout) {
      if (!mobile?.isPlayer?.()) return;
      const player = mobile.getAsPlayer();
      Common.closeOverlay(player);
      if (logout) return;
      depositCoins(player);
      if (removeRoomItems(player) > 0) player.sendMessage(Common.message("itemsTaken"));
    }
  };
}

function attach(api) {
  playground.area = new (defineArea())();
  api.registerArea(playground.area);
  api.onObjectInteraction("Alchemists Teleport", { Enter: enter });
  api.onObjectInteraction("Cupboard", { Search: search, "Take-5": takeFive });
  api.onObjectInteraction("Coin Collector", { Deposit: collector });
  api.onCustomEvent("magic:alchemy-policy", alchemyPolicy);
  api.onCustomEvent("magic:alchemy-completed", alchemyCompleted);
  api.onSpellRuneBypass(runeBypass);
}

module.exports = {
  attach, playground, inPlayground, cupboardItem, change, takeFrom, alchemyPolicy, runeBypass, alchemyCompleted,
  depositCoins, removeRoomItems, enter, updateOverlay, defineArea,
};
