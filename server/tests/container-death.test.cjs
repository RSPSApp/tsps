// Run after `yarn build`: node --test tests/container-death.test.cjs
// What a death does with the contents of the rune pouch, essence pouches, herb sack, seed box and
// tackle box, through the real death (PlayerDeathTask.dropItems) and every plugin's hooks. Each
// case counts every item the player owns before and after: nothing is created or destroyed.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");

let core;
let PlayerDeathTask;
let Storage;
let next = 3900;

const COINS = 995;
const AIR_RUNE = 556;
const LAW_RUNE = 563;
const PURE_ESSENCE = 7936;
const GRIMY_RANARR = 207;
const RANARR_SEED = 5295;
const FISHING_BAIT = 313;
/** Every death leaves bones; they are not the player's. */
const BONES = 526;

/** Each container, how to fill it, and where its contents live while it holds them. */
const CONTAINERS = [
  {
    name: "rune pouch", id: 12791, contents: [[AIR_RUNE, 100], [LAW_RUNE, 50]],
    fill: (player) => player.setAttribute("rune-pouch:runes", [[AIR_RUNE, 100], [LAW_RUNE, 50], null, null]),
    stored: (player) => (player.getAttribute("rune-pouch:runes") ?? []).filter(Boolean),
  },
  {
    name: "small pouch", id: 5509, contents: [[PURE_ESSENCE, 3]],
    fill: (player) => player.setAttribute("runecrafting:pouches", { small: { amount: 3, type: 2, decay: 0 } }),
    stored: (player) => {
      const small = player.getAttribute("runecrafting:pouches")?.small;
      return small?.amount > 0 ? [[PURE_ESSENCE, small.amount]] : [];
    },
  },
  {
    name: "herb sack", id: 13226, contents: [[GRIMY_RANARR, 20]], meta: { "farming:stored": { [GRIMY_RANARR]: 20 } },
  },
  {
    name: "seed box", id: 13639, contents: [[RANARR_SEED, 10]], meta: { "farming:stored": { [RANARR_SEED]: 10 } },
    toBankInPvp: true,
  },
  {
    name: "tackle box", id: 25580, contents: [[FISHING_BAIT, 40]],
    fill: (player) => Storage.store(player, Storage.FAMILIES.get("tackle-box"), FISHING_BAIT, 40),
    stored: (player) => Storage.contents(player, Storage.FAMILIES.get("tackle-box")).map(({ id, amount }) => [id, amount]),
  },
];

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PluginManager.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PluginManager.getCoreApi();
  PlayerDeathTask = require("../dist/game/task/impl/PlayerDeath").PlayerDeathTask;
  Storage = require("../plugins/items/storage/Common.StorageItems");
});

function actor(t, name) {
  const channel = {
    kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {},
  };
  const player = new Player(new PlayerSession(channel));
  player.setIndex(next++);
  player.setUsername(name + player.getIndex());
  player.setRegistered(true);
  player.setLocation(new core.Location(3222, 3218, 0));
  player.needsPlacement = false;
  t.mock.method(player.getPacketSender(), "sendMessage", () => player.getPacketSender());
  return player;
}

/** A player carrying `container`, full, plus coins; `kept` decides whether the death keeps it. */
function loadout(t, container, kept) {
  const player = actor(t, "cdeath");
  player.getInventory().addItem(new core.Item(container.id, 1, container.meta && JSON.parse(JSON.stringify(container.meta))));
  player.getInventory().addItem(new core.Item(COINS, 1000));
  container.fill?.(player);
  // Unskulled the death keeps three items; skulled, none.
  if (!kept) player.setSkullTimer(100);
  return player;
}

/** Item id -> amount, from `[id, amount]` pairs and items (counting what a herb sack or seed box stores). */
function tally(into, entries) {
  for (const entry of entries) {
    const [id, amount, meta] = Array.isArray(entry) ? entry : [entry.id ?? entry.getId(), entry.amount ?? entry.getAmount(), entry.meta ?? entry.getMeta?.()];
    into.set(id, (into.get(id) ?? 0) + amount);
    for (const [stored, count] of Object.entries(meta?.["farming:stored"] ?? {})) into.set(+stored, (into.get(+stored) ?? 0) + count);
  }
  return into;
}

function bankItems(player) {
  const items = [];
  for (let tab = 0; tab < 10; tab++) items.push(...player.getBank(tab).getValidItems());
  return items;
}

/** Where everything the player owns is: carried, in the grave, on the floor, in the bank, in a container's own storage. */
function owned(player, container, floor) {
  const grave = player.getAttribute("gravestones:grave")?.items ?? [];
  const places = {
    carried: tally(new Map(), [...player.getInventory().getValidItems(), ...player.getEquipment().getValidItems()]),
    grave: tally(new Map(), grave),
    floor: tally(new Map(), floor.filter((item) => item.getId() !== BONES)),
    bank: tally(new Map(), bankItems(player)),
    stored: tally(new Map(), container.stored?.(player) ?? []),
  };
  const all = new Map();
  for (const place of Object.values(places)) for (const [id, amount] of place) all.set(id, (all.get(id) ?? 0) + amount);
  return { ...places, all };
}

/** Dies as `kind` ("pve", "pvp" or "safe") and returns where everything went. */
function die(t, container, { kept, kind }) {
  const player = loadout(t, container, kept);
  const floor = [];
  t.mock.method(core.ItemOnGroundManager, "registerLocation", (owner, item) => floor.push(item));
  const before = owned(player, container, floor).all;
  if (kind === "safe") {
    // The whole death, on the tick it lands, where content says nothing is lost (a safe minigame).
    t.mock.method(PluginManager, "emitShouldDropItemsOnDeath", () => false);
    const death = new PlayerDeathTask(player);
    death.ticks = 0;
    death.execute();
  } else {
    const killer = kind === "pvp" ? actor(t, "killer") : null;
    PlayerDeathTask.returnKeptItems(player, PlayerDeathTask.dropItems(player, killer, player.getLocation()));
  }
  const after = owned(player, container, floor);
  assert.deepEqual([...after.all].sort(), [...before].sort(), "nothing created or destroyed");
  t.mock.restoreAll();
  return { player, after };
}

const amount = (place, id) => place.get(id) ?? 0;
const total = (contents) => contents.reduce((sum, [, n]) => sum + n, 0);
/** How much of the container's contents is in `place`. */
const held = (place, container) => total(container.contents.map(([id]) => [id, amount(place, id)]));

for (const container of CONTAINERS) {
  const all = total(container.contents);
  // Herb sacks and seed boxes keep their contents on the item; the rest keep them on the player.
  const insideItem = !!container.meta;

  test(`${container.name}: a safe death changes nothing`, (t) => {
    for (const kept of [true, false]) {
      const { after } = die(t, container, { kept, kind: "safe" });
      assert.equal(amount(after.carried, container.id), 1);
      assert.equal(held(insideItem ? after.carried : after.stored, container), all);
    }
  });

  test(`${container.name}: kept on a PvM death, it keeps its contents`, (t) => {
    const { after } = die(t, container, { kept: true, kind: "pve" });
    assert.equal(amount(after.carried, container.id), 1);
    assert.equal(held(insideItem ? after.carried : after.stored, container), all);
    assert.equal(held(after.grave, container), 0);
  });

  test(`${container.name}: lost on a PvM death, it goes to the grave with its contents still in it`, (t) => {
    const { after } = die(t, container, { kept: false, kind: "pve" });
    assert.equal(amount(after.grave, container.id), 1);
    assert.equal(amount(after.carried, container.id), 0);
    // Reclaimed, the container still holds them (Wiki: Rune pouch, 21 June 2023; Herb sack).
    assert.equal(held(insideItem ? after.grave : after.stored, container), all);
  });

  for (const kept of [true, false]) {
    test(`${container.name}: ${kept ? "kept" : "lost"} on a PvP death, ${container.keptInPvp && kept ? "it keeps its contents" : "its contents go to the killer"}`, (t) => {
      const { after } = die(t, container, { kept, kind: "pvp" });
      // Untradeable, the container stays with the player either way.
      assert.equal(amount(after.carried, container.id), 1);
      assert.equal(after.grave.size, 0, "a PvP death makes no grave");
      if (container.keptInPvp && kept) {
        assert.equal(held(after.stored, container), all);
        return;
      }
      assert.equal(held(after.stored, container), 0);
      assert.equal(held(after.carried, container), 0, "the container is empty");
      assert.equal(held(container.toBankInPvp ? after.bank : after.floor, container), all);
    });
  }
}

test("a seed box's seeds the bank has no room for go to the killer", (t) => {
  const container = CONTAINERS.find((entry) => entry.name === "seed box");
  const player = loadout(t, container, false);
  const bank = player.getBank(core.Bank.getTabForItem(player, RANARR_SEED));
  bank.add(new core.Item(RANARR_SEED, 2147483647 - 4), false);
  const floor = [];
  t.mock.method(core.ItemOnGroundManager, "registerLocation", (owner, item) => floor.push(item));
  PlayerDeathTask.dropItems(player, actor(t, "killer"), player.getLocation());
  assert.equal(bank.getAmount(RANARR_SEED), 2147483647);
  assert.equal(amount(tally(new Map(), floor), RANARR_SEED), 6);
});
