// Run after `yarn build`: node --test tests/group-ironman-retrieval-wipes.test.cjs
// A leaver who stays a ranked Group Ironman loses what every item retrieval service holds that they
// lose (Wiki, Group Ironman Mode: "Items in an Item Retrieval Service"). Each service answers
// "group-ironman:wipe-tradeables" { player, lost(id, amount) } for its own store.
const assert = require("node:assert/strict");
const path = require("node:path");
const { test, before } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");

const WHIP = 4151; // tradeable: lost
const RANGER_BOOTS = 2577; // kept, as the test below says
const lost = (id) => id === WHIP;

const Zulrah = require("../plugins/bosses/zulrah/Shrine.Zulrah");
const ZulrahShared = require("../plugins/bosses/zulrah/Shared.Zulrah");
const Nightmare = require("../plugins/bosses/nightmare/Retrieval.Nightmare");
const NightmareCommon = require("../plugins/bosses/nightmare/Common.Nightmare");
const Yama = require("../plugins/bosses/yama/Voice.Yama");
const YamaCommon = require("../plugins/bosses/yama/Common.Yama");
const Vorkath = require("../plugins/bosses/vorkath/Retrieval.Vorkath");
const Tombs = require("../plugins/minigames/toa/Retrieval.TombsOfAmascut");
const Theatre = require("../plugins/minigames/tob/Retrieval.TheatreOfBlood");
const Mimic = require("../plugins/bosses/mimic/Retrieval.Mimic");
const Pete = require("../plugins/minigames/volcanicmine/Retrieval.VolcanicMine");
const VolcanicMine = require("../plugins/minigames/volcanicmine/Common.VolcanicMine");
// Farming's units need its core first (Core.Farming.init), so they load in before().
let Hespori;
let Patches;

let core;
const registered = new Map();

/** An api that records custom event handlers and does nothing for anything else. */
function stubApi() {
  const known = {
    core,
    onCustomEvent: (name, handler) => registered.set(name, [...(registered.get(name) ?? []), handler]),
    emitCustomEvent() {},
  };
  return new Proxy(known, { get: (target, key) => (key in target ? target[key] : () => () => {}) });
}

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  core = PluginManager.getCoreApi();
  VolcanicMine.init(stubApi());
  require("../plugins/skills/farming/Core.Farming").init({ core });
  Patches = require("../plugins/skills/farming/Patches.Farming");
  Hespori = require("../plugins/skills/farming/Hespori.Farming");
  for (const attach of [Nightmare.attachRetrieval, Yama.attachVoice, Vorkath.attach, Mimic.attach, Zulrah, Tombs, Theatre, Pete.attachRetrieval, (api) => Patches.attach(api)]) {
    try {
      attach(stubApi());
    } catch {
      // A register that needs more than the stub still registered what it reached.
    }
  }
});

function holder() {
  const attributes = new Map();
  return { getAttribute: (key) => attributes.get(key), setAttribute: (key, value) => attributes.set(key, value) };
}

test("every item retrieval service listens for the wipe", () => {
  const handlers = registered.get("group-ironman:wipe-tradeables") ?? [];
  for (const unit of [Zulrah, Nightmare, Yama, Vorkath, Tombs, Theatre, Mimic, Pete, Hespori]) {
    assert.ok(handlers.includes(unit.wipeForGroupIronman), "registered");
  }
});

test("Arno (Hespori) and Petrified Pete (Volcanic Mine): the Wiki's Item Retrieval Service list has them too", () => {
  const player = holder();
  const bank = [{ id: WHIP, amount: 1, meta: null }, { id: RANGER_BOOTS, amount: 1, meta: null }];
  player.setAttribute(Patches.FARM_ATTRIBUTE, { deathbank: bank, deathbankPaid: false });
  Hespori.wipeForGroupIronman({ player, lost });
  assert.equal(player.getAttribute(Patches.FARM_ATTRIBUTE).deathbank, bank, "the same bank, which a Hespori warning holds");
  assert.deepEqual(bank.map((entry) => entry.id), [RANGER_BOOTS]);

  const attribute = VolcanicMine.data.attributes.stored;
  player.setAttribute(attribute, [{ id: WHIP, amount: 1 }, { id: RANGER_BOOTS, amount: 1 }]);
  Pete.wipeForGroupIronman({ player, lost });
  assert.deepEqual(player.getAttribute(attribute).map((entry) => entry.id), [RANGER_BOOTS]);
  Pete.wipeForGroupIronman({ player, lost: () => true });
  assert.equal(player.getAttribute(attribute), null, "an emptied lot is cleared");
});

test("the Tombs of Amascut chest's unpaid fee is the fee for what the wipe leaves", () => {
  const player = holder();
  player.setAttribute(Tombs.ATTR_STORED, { items: [{ id: WHIP, amount: 1 }, { id: RANGER_BOOTS, amount: 1 }], paid: false, fee: 500 });
  Tombs.wipeForGroupIronman({ player, lost });
  const lot = player.getAttribute(Tombs.ATTR_STORED);
  assert.notEqual(lot.fee, 500, "not the fee the whip was part of");
  player.setAttribute(Tombs.ATTR_STORED, { items: [{ id: WHIP, amount: 1 }, { id: RANGER_BOOTS, amount: 1 }], paid: true, fee: 500 });
  Tombs.wipeForGroupIronman({ player, lost });
  assert.equal(player.getAttribute(Tombs.ATTR_STORED).fee, 500, "a paid one stays paid");
});

test("[id, amount, meta] stores: Zulrah's priestess, The Nightmare's keepers, Yama's Voice", () => {
  for (const [unit, attribute] of [
    [Zulrah, ZulrahShared.ATTR.RETRIEVAL],
    [Nightmare, NightmareCommon.HELD_ITEMS_ATTRIBUTE],
    [Yama, YamaCommon.HELD_ITEMS_ATTRIBUTE],
  ]) {
    const player = holder();
    player.setAttribute(attribute, { items: [[WHIP, 1, null], [RANGER_BOOTS, 1, null]], paid: false });
    unit.wipeForGroupIronman({ player, lost });
    assert.deepEqual(player.getAttribute(attribute).items, [[RANGER_BOOTS, 1, null]], attribute);
    assert.equal(player.getAttribute(attribute).paid, false, "the rest of the record stays");
    unit.wipeForGroupIronman({ player, lost: () => true });
    assert.equal(player.getAttribute(attribute), null, "an emptied store is cleared");
  }
});

test("{ id, amount } stores: Torfinn, the Tombs of Amascut and Theatre of Blood chests, the Mimic's chest", () => {
  for (const [unit, attribute] of [
    [Vorkath, Vorkath.ATTR],
    [Tombs, Tombs.ATTR_STORED],
    [Theatre, Theatre.ATTR_STORED],
    [Mimic, Mimic.ATTR],
  ]) {
    const player = holder();
    player.setAttribute(attribute, { items: [{ id: WHIP, amount: 1 }, { id: RANGER_BOOTS, amount: 1 }] });
    unit.wipeForGroupIronman({ player, lost });
    const left = player.getAttribute(attribute).items.filter(Boolean).map((entry) => entry.id);
    assert.deepEqual(left, [RANGER_BOOTS], attribute);
    unit.wipeForGroupIronman({ player, lost: () => true });
    assert.equal(player.getAttribute(attribute), null, `${attribute}: an emptied store is cleared`);
    unit.wipeForGroupIronman({ player });
  }
});
