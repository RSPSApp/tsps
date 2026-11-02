// node --test tests/bounty-hunter-extras.test.cjs
// Bounty Hunter supply crates, Teleport to Target, risk skulls and the crater pool, on a fake api.
const assert = require("node:assert/strict");
const { test } = require("node:test");

const BH = "../plugins/minigames/bountyhunter";
const Fort = require(`${BH}/Fort.BountyHunter`);
const SupplyCrates = require(`${BH}/SupplyCrates.BountyHunter`);
const TargetTeleport = require(`${BH}/TargetTeleport.BountyHunter`);
const RiskSkulls = require(`${BH}/RiskSkulls.BountyHunter`);
const Entry = require(`${BH}/Entry.BountyHunter`);
const Hud = require(`${BH}/Hud.BountyHunter`);
const bh = require(`${BH}/State.BountyHunter`);

const Items = {
  COINS: 995, LAW_RUNE: 563, DEATH_RUNE: 560, CHAOS_RUNE: 562, TARGET_TELEPORT_SCROLL: 12846,
  BLIGHTED_MANTA_RAY: 24589, BLIGHTED_ANGLERFISH: 24592, BLIGHTED_KARAMBWAN: 24595,
  BLIGHTED_SUPER_RESTORE_4_: 24598, BOUNTY_SUPPLY_CRATE_MANTA_RAY_: 30616, BOUNTY_SUPPLY_CRATE_ANGLERFISH_: 30619,
};

const location = (x, y, z = 0) => ({ getX: () => x, getY: () => y, getZ: () => z });
const IN_CRATER = location(3420, 4080);
const OUTSIDE = location(3200, 3200);

test("target hints track distant tiles, switch to nearby players, and clear when the target is gone", () => {
  const hints = [];
  const varps = new Map();
  const varbits = new Map();
  const sender = new Proxy({
    getVarp: (id) => varps.get(id) ?? 0,
    sendConfig: (id, value) => varps.set(id, value),
    getVarbit: (id) => varbits.get(id) ?? 0,
    sendVarbit: (id, value) => varbits.set(id, value),
    sendPositionalHint: (at) => hints.push([at.getX(), at.getY()]),
    sendPlayerHint: (target) => hints.push(target),
    clearHintArrow: () => hints.push(null),
  }, { get: (object, key) => object[key] ?? (() => {}) });
  let at = location(3510, 4140);
  const target = { getLocation: () => at, getUsername: () => 'BhBot1', getDisplayName: () => 'BhBot1', getIndex: () => 1 };
  let assigned = target;
  const locals = [];
  const viewer = { getLocation: () => location(3330, 3970), getLocalPlayers: () => locals, getPacketSender: () => sender };
  Hud({ core: { CacheDefinitions: { getVarbitId: (name) => name, getVarpId: (name) => name } } }, { inCrater: () => true, inLobby: () => false, inArena: () => true, targetOf: () => assigned });
  Hud.sync(viewer);
  Hud.sync(viewer);
  assert.deepEqual(hints, [[3510, 4140]], 'a target over 200 tiles away uses one positional hint');
  at = location(3509, 4140);
  Hud.sync(viewer);
  assert.deepEqual(hints.at(-1), [3509, 4140], 'the distant arrow follows movement');
  locals.push(target);
  Hud.sync(viewer);
  assert.equal(hints.at(-1), target, 'a visible player gets the smooth actor hint');
  locals.length = 0;
  Hud.sync(viewer);
  assert.deepEqual(hints.at(-1), [3509, 4140], 'losing visibility restores the positional hint');
  assigned = null;
  Hud.sync(viewer);
  Hud.sync(viewer);
  assert.equal(hints.at(-1), null);
  assert.equal(hints.filter((hint) => hint === null).length, 1);
});

class ItemStatementDialogue { constructor(index, itemId, text) { Object.assign(this, { itemId, text }); } }
class DialogueChainBuilder { constructor() { this.list = []; } add(d) { this.list.push(d); return this; } }
const RED_SKULL = {};
const updatedBars = [];
const events = {};
const core = {
  ItemIdentifiers: Items, ItemStatementDialogue, DialogueChainBuilder,
  ItemDefinition: { forId: (id) => ({ getNoteId: () => id + 1 }) },
  SkullType: { RED_SKULL },
  CombatSpecial: { updateBar: (player) => updatedBars.push(player) },
};
const api = new Proxy({
  core,
  emitCustomEvent: (name, payload) => events[name]?.(payload),
  onCustomEvent: (name, handler) => { events[name] = handler; },
  emitShouldKeepItemOnDeath: () => null,
  getPrayerHandler: () => ({ PROTECT_ITEM: "protect", isActivated: (player, prayer) => player.prayers?.has(prayer) === true }),
}, { get: (target, key) => target[key] ?? (() => {}) });

Fort(api);
SupplyCrates(api);
TargetTeleport(api, bh);
Entry(api, bh);
RiskSkulls(api);

/** Unnoted, one item per slot unless stacked; 28 slots. */
function inventory(contents = {}) {
  const amounts = new Map(Object.entries(contents).map(([id, n]) => [Number(id), n]));
  const slots = [];
  const api = {
    amounts,
    getAmount: (id) => amounts.get(id) ?? 0,
    deleteNumber: (id, n) => (amounts.set(id, api.getAmount(id) - n), api),
    adds: (id, n) => (amounts.set(id, api.getAmount(id) + n), slots.push(id), api),
    deleteAtSlot: (slot, n) => (amounts.set(slot, api.getAmount(slot) - n), api),
    getFreeSlots: () => 28 - [...amounts.entries()].filter(([id, n]) => n > 0 && id !== Items.COINS).reduce((sum, [, n]) => sum + n, 0),
    getItems: () => [],
    added: slots,
  };
  return api;
}

function player({ at = IN_CRATER, items = {}, attributes = {} } = {}) {
  const messages = [];
  const attrs = new Map(Object.entries(attributes));
  const p = {
    messages,
    inventory: inventory(items),
    getLocation: () => at,
    getInventory: () => p.inventory,
    sendMessage: (m) => messages.push(m),
    getAttribute: (k) => attrs.get(k),
    setAttribute: (k, v) => attrs.set(k, v),
    isPlayer: () => true,
    getDialogueManager: () => ({ startDialogues: (chain) => { p.dialogue = chain.list; } }),
    setEnteredAmountAction: (action) => { p.amountAction = action; },
    getPacketSender: () => ({ sendEnterAmountPrompt: (text) => { p.prompt = text; } }),
    getCombat: () => ({ getTeleblockTimer: () => ({ finished: () => true }) }),
  };
  return p;
}

const crate = (n) => ({
  [Items.BLIGHTED_SUPER_RESTORE_4_]: n, [Items.BLIGHTED_KARAMBWAN]: 2 * n, [Items.BLIGHTED_MANTA_RAY]: 8 * n, [Items.COINS]: 1000 * n,
});

test("the supply crate fills up to what the inventory has and asks how many", () => {
  const p = player({ items: { ...crate(3), [Items.BLIGHTED_KARAMBWAN]: 5 } });
  SupplyCrates._test.take(p, { restore: Items.BLIGHTED_SUPER_RESTORE_4_, karambwan: Items.BLIGHTED_KARAMBWAN, fish: Items.BLIGHTED_MANTA_RAY, crate: Items.BOUNTY_SUPPLY_CRATE_MANTA_RAY_ });
  assert.equal(p.prompt, "How many supply crates would you like to take? (Up to 2)");
  p.amountAction.execute(5);
  const inv = p.inventory;
  assert.equal(inv.getAmount(Items.BOUNTY_SUPPLY_CRATE_MANTA_RAY_), 2);
  assert.equal(inv.getAmount(Items.BLIGHTED_SUPER_RESTORE_4_), 1);
  assert.equal(inv.getAmount(Items.BLIGHTED_KARAMBWAN), 1);
  assert.equal(inv.getAmount(Items.BLIGHTED_MANTA_RAY), 8);
  assert.equal(inv.getAmount(Items.COINS), 1000);
  assert.equal(p.dialogue[0].text, "You fill and take 2 Bounty Hunter supply crates.");
});

test("a supply crate opens only in the crater, into 8 fish, 2 karambwan and a restore", () => {
  const outside = player({ at: OUTSIDE, items: { [Items.BOUNTY_SUPPLY_CRATE_ANGLERFISH_]: 1 } });
  SupplyCrates._test.open({ player: outside, itemId: Items.BOUNTY_SUPPLY_CRATE_ANGLERFISH_, slot: Items.BOUNTY_SUPPLY_CRATE_ANGLERFISH_ });
  assert.equal(outside.inventory.added.length, 0);

  const p = player({ items: { [Items.BOUNTY_SUPPLY_CRATE_ANGLERFISH_]: 1 } });
  SupplyCrates._test.open({ player: p, itemId: Items.BOUNTY_SUPPLY_CRATE_ANGLERFISH_, slot: Items.BOUNTY_SUPPLY_CRATE_ANGLERFISH_ });
  assert.equal(p.inventory.getAmount(Items.BOUNTY_SUPPLY_CRATE_ANGLERFISH_), 0);
  assert.equal(p.inventory.getAmount(Items.BLIGHTED_ANGLERFISH), 8);
  assert.equal(p.inventory.getAmount(Items.BLIGHTED_KARAMBWAN), 2);
  assert.equal(p.inventory.getAmount(Items.BLIGHTED_SUPER_RESTORE_4_), 1);

  const full = player({ items: { [Items.BOUNTY_SUPPLY_CRATE_ANGLERFISH_]: 1, 1: 18 } });
  SupplyCrates._test.open({ player: full, itemId: Items.BOUNTY_SUPPLY_CRATE_ANGLERFISH_, slot: Items.BOUNTY_SUPPLY_CRATE_ANGLERFISH_ });
  assert.equal(full.inventory.getAmount(Items.BOUNTY_SUPPLY_CRATE_ANGLERFISH_), 1, "9 free slots are not enough");
});

test("no more than two supply crates, noted or not, go into the arena", () => {
  const ask = (items) => {
    const request = { player: player({ items }), allowed: true, reason: null };
    api.emitCustomEvent("bounty-hunter:can-enter", request);
    return request;
  };
  assert.equal(ask({ [Items.BOUNTY_SUPPLY_CRATE_MANTA_RAY_]: 1, [Items.BOUNTY_SUPPLY_CRATE_ANGLERFISH_ + 1]: 1 }).allowed, true);
  const refused = ask({ [Items.BOUNTY_SUPPLY_CRATE_MANTA_RAY_]: 2, [Items.BOUNTY_SUPPLY_CRATE_ANGLERFISH_ + 1]: 1 });
  assert.equal(refused.allowed, false);
  assert.match(refused.reason, /two supply crates/);
});

test("Teleport to Target lands only on tiles walkable from the target, within 12", () => {
  // A wall along x = 105: nothing east of it is reachable.
  const canStep = (x, y, nx) => nx < 105;
  const tiles = TargetTeleport._test.reachableTiles(location(100, 100), 12, canStep);
  assert.ok(tiles.length > 0);
  assert.ok(tiles.every(([x, y]) => x < 105 && x >= 88 && Math.abs(y - 100) <= 12));
  assert.ok(!tiles.some(([x, y]) => x === 100 && y === 100), "never the target's own tile");
});

test("Teleport to Target needs the spell, the crater, a target and 12 s out of combat", () => {
  const { refusal, noteCombat, UNLOCKED_ATTRIBUTE } = TargetTeleport._test;
  const target = player();
  assert.match(refusal(player(), target), /learn this spell/);
  const caster = player({ attributes: { [UNLOCKED_ATTRIBUTE]: true } });
  assert.match(refusal(player({ at: OUTSIDE, attributes: { [UNLOCKED_ATTRIBUTE]: true } }), target), /only cast this spell/);
  assert.match(refusal(caster, null), /target/);
  assert.equal(refusal(caster, target), null);
  noteCombat({ attacker: target, target: caster });
  assert.match(refusal(caster, target), /combat/);
});

test("Teleport to Target from the lobby into the arena needs what the Arena gates need", (t) => {
  const { refusal, UNLOCKED_ATTRIBUTE } = TargetTeleport._test;
  const unlocked = { [UNLOCKED_ATTRIBUTE]: true };
  const target = player();
  let balance = 0;
  events["bounty-hunter:minimum-deposit"] = (request) => { request.amount = 100_000; };
  events["bounty-hunter:coffer-balance"] = (request) => { request.balance = balance; };
  t.after(() => {
    bh.lobby.clear();
    delete events["bounty-hunter:minimum-deposit"];
    delete events["bounty-hunter:coffer-balance"];
  });
  const caster = player({ attributes: unlocked });
  bh.lobby.add(caster);
  assert.match(refusal(caster, target), /100,000 coins in your coffer/);
  balance = 100_000;
  assert.equal(refusal(caster, target), null);
  const crates = player({ attributes: unlocked, items: { [Items.BOUNTY_SUPPLY_CRATE_MANTA_RAY_]: 3 } });
  bh.lobby.add(crates);
  assert.match(refusal(crates, target), /two supply crates/);
  bh.lobby.add(target);
  balance = 0;
  assert.equal(refusal(caster, target), null, "a target in the lobby too: the cast stays in the lobby");
});

test("reading the target teleport scroll unlocks the spell after the confirmation", () => {
  const p = player({ items: { [Items.TARGET_TELEPORT_SCROLL]: 1 } });
  p.inventory.getItems = () => ({ 3: { getId: () => Items.TARGET_TELEPORT_SCROLL } });
  p.inventory.deleteAtSlot = () => p.inventory.amounts.set(Items.TARGET_TELEPORT_SCROLL, 0);
  p.getPacketSender = () => ({ sendVarbit: () => {} });
  core.CacheDefinitions = { getVarbitId: () => 2010 };
  TargetTeleport._test.learn(p, 3);
  assert.equal(p.getAttribute(TargetTeleport._test.UNLOCKED_ATTRIBUTE), true);
  assert.equal(p.inventory.getAmount(Items.TARGET_TELEPORT_SCROLL), 0);
  assert.equal(p.dialogue[0].text, "You have learnt the 'Teleport to Target' spell.");
});

test("risk skulls step bronze, iron, green, blue, red, golden-eyed when skulled", () => {
  const { skullIcon } = RiskSkulls._test;
  assert.deepEqual([0, 200_000, 200_001, 800_001, 2_000_001, 8_000_001].map((r) => skullIcon(r, false)), [21, 21, 22, 23, 24, 25]);
  assert.equal(skullIcon(8_000_001, true), 32);
  assert.equal(skullIcon(0, true), 28);
});

test("risk is what a death would drop: kept items and untradeables don't count", (t) => {
  const item = (id, value, amount, tradeable = true) => ({
    getId: () => id, getAmount: () => amount, isTradeable: () => tradeable, value,
  });
  const [stack, cheap, untradeable, worn] = [item(1, 1_000_000, 2), item(2, 50, 100), item(3, 9_999_999, 1, false), item(4, 300_000, 1)];
  const p = {
    kept: [stack, untradeable, worn],
    getInventory: () => ({ getItems: () => [stack, cheap, untradeable, null] }),
    getEquipment: () => ({ getItems: () => [worn] }),
  };
  core.PlayerDeathTask = { getItemsToKeep: (player) => player.kept, keepValue: (it) => it.value };
  t.after(() => delete core.PlayerDeathTask);
  assert.equal(RiskSkulls._test.riskOf(p), 5_000);
  p.kept = [];
  assert.equal(RiskSkulls._test.riskOf(p), 2_305_000);
  p.kept = [stack];
  assert.equal(RiskSkulls._test.riskOf(p), 305_000);
});

test("only the crater's Pool of Refreshment restores special attack", () => {
  const drink = (at) => {
    const p = { special: 10, setSpecialPercentage(v) { this.special = v; } };
    api.emitCustomEvent("pool-of-refreshment:drunk", { player: p, object: { getLocation: () => at } });
    return p.special;
  };
  assert.equal(drink(location(3128, 3638)), 10, "Ferox Enclave's does not");
  assert.equal(drink(location(3417, 4061)), 100);
});
