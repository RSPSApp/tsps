// Run after `yarn build`: node --test tests/special-orb-click.test.cjs
// The web client's special orb is a CS2 handler that toggles varp 301 locally and sends the
// new value, while live's orb sends an interface button and the server decides. A special
// that has just swung turns the bar off, so the client's next click sends 0 while the server
// is already off. The packet is the click; it must still toggle the server's state, or the
// click is dead.
const assert = require("node:assert/strict");
const { test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { CombatSpecial } = require("../dist/game/content/combat/CombatSpecial");
const { ClientConnection } = require("../dist/net/NetworkBuilder");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { ItemIdentifiers } = require("../dist/util/ItemIdentifiers");

require("../plugins/combat/specials/DragonWarhammer.SpecialAttack")({
  core: PluginManager.getCoreApi(),
  registerCombatSpecial: CombatSpecial.register,
});

const WEAPON_ID = ItemIdentifiers.DRAGON_WARHAMMER;

/** A player wielding the dragon warhammer, enough for CombatSpecial.activate to light it. */
function player() {
  return {
    activated: false,
    energy: 100,
    attributes: new Map(),
    isPlayer: () => true,
    getAsPlayer() {
      return this;
    },
    getCombatSpecial: () => CombatSpecial.getForWeaponId(WEAPON_ID),
    isSpecialActivated() {
      return this.activated;
    },
    setSpecialActivated(value) {
      this.activated = value;
    },
    getSpecialPercentage() {
      return this.energy;
    },
    decrementSpecialPercentage(amount) {
      this.energy -= amount;
    },
    isRecoveringSpecialAttack: () => true,
    getDueling: () => ({ inDuel: () => false }),
    getEquipment: () => ({ get: () => ({ getId: () => WEAPON_ID }) }),
    getWeapon: () => ({ getSpecialBar: () => -1, getSpecialMeter: () => -1 }),
    getPacketSender: () => ({
      updateSpecialAttackOrb() {},
      sendSpecialAttackState() {},
    }),
    getAttribute(key) {
      return this.attributes.get(key);
    },
    setAttribute(key, value) {
      this.attributes.set(key, value);
    },
    applyAudioSettingFromClient() {},
  };
}

function connectionFor(player) {
  const channel = {
    kind: "test",
    remoteAddress: "127.0.0.1",
    isOpen: () => true,
    send: () => true,
    close() {},
    onData() {},
    onError() {},
    onClose() {},
  };
  const connection = new ClientConnection(channel);
  connection.player = player;
  return connection;
}

test("a varp 301 packet toggles the special like the orb's click", async () => {
  const p = player();
  const connection = connectionFor(p);

  // The stale value right after a special swung: the client thinks the bar is on, so it
  // sends 0, while the server has already turned the special off.
  await connection.dispatch([{ type: "varp_transmit", varpId: 301, value: 0 }], true);
  assert.equal(p.isSpecialActivated(), true, "the click re-arms the special");

  // The next click turns it off, whichever value the client sends.
  await connection.dispatch([{ type: "varp_transmit", varpId: 301, value: 1 }], true);
  assert.equal(p.isSpecialActivated(), false, "a second click cancels it");
});

test("the old value check is not what decides: an off value still toggles", async () => {
  const p = player();
  const connection = connectionFor(p);

  await connection.dispatch([{ type: "varp_transmit", varpId: 301, value: 0 }], true);
  assert.equal(p.isSpecialActivated(), true);
  await connection.dispatch([{ type: "varp_transmit", varpId: 301, value: 0 }], true);
  assert.equal(p.isSpecialActivated(), false, "0 is still a click, not \"already off\"");
});
