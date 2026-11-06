// Run after `yarn build`: node --test tests/tutors-claim-cooldown.test.cjs
const assert = require('node:assert/strict');
const { test } = require('node:test');

const plugin = require('../plugins/npcs/Tutors.plugin');

const AIR_RUNE = 556;
const MIND_RUNE = 558;
const CLAIM_ATTRIBUTE = 'tutors.combat_claim_at';
const MAGIC_TUTOR = 3218;

function item(id, amount = 1) {
  return {
    id,
    amount,
    getId() { return this.id; },
    getAmount() { return this.amount; },
    incrementAmountBy(delta) { this.amount += delta; },
  };
}

/** A real ItemContainer-shaped inventory: full means a new stack cannot be added. */
function makePlayer(items = []) {
  const slots = items.map(([id, amount]) => item(id, amount));
  const attributes = new Map();
  return {
    attributes,
    messages: [],
    getAttribute(key) { return attributes.get(key); },
    setAttribute(key, value) { attributes.set(key, value); },
    sendMessage(message) { this.messages.push(message); },
    getSkillManager() { return { getMaxLevel: () => 1 }; },
    getInventory() {
      return {
        getAmount(id) { return slots.filter((held) => held.getId() === id).reduce((sum, held) => sum + held.getAmount(), 0); },
        getItems() { return slots; },
        getFreeSlots() { return 28 - slots.length; },
        adds(id, amount) {
          const existing = slots.find((held) => held.getId() === id);
          if (existing) return existing.incrementAmountBy(amount);
          if (slots.length < 28) slots.push(item(id, amount));
        },
        deleteNumber(id, amount) {
          const at = slots.findIndex((held) => held.getId() === id);
          if (at >= 0) slots.splice(at, 1);
        },
      };
    },
    getEquipment() { return { contains: () => false, getItems: () => [] }; },
    getBanks() { return []; },
  };
}

function bindPlugin() {
  const events = {};
  const interactions = {};
  const core = {
    NpcIdentifiers: {
      MELEE_COMBAT_TUTOR: 3216, RANGED_COMBAT_TUTOR: 3215, MAGIC_COMBAT_TUTOR: MAGIC_TUTOR,
      COOKING_TUTOR: 3219, CRAFTING_TUTOR: 3220, FISHING_TUTOR: 3221, MINING_TUTOR: 3222,
      PRAYER_TUTOR: 3223, SMITHING_APPRENTICE: 3224, MASTER_SMITHING_TUTOR: 3225, WOODSMAN_TUTOR: 3226,
    },
    ItemIdentifiers: {
      AIR_RUNE, MIND_RUNE, TRAINING_BOW: 9705, TRAINING_ARROWS: 9706, TRAINING_SWORD: 9703,
      TRAINING_SHIELD: 9704, BRONZE_PICKAXE: 1265, BRONZE_AXE: 1351, SMALL_FISHING_NET: 303,
      TINDERBOX: 590, HAMMER: 2347,
    },
    Skill: {
      DEFENCE: 0, RANGED: 1, MAGIC: 6, COOKING: 7, CRAFTING: 8, FISHING: 9, MINING: 14,
      PRAYER: 5, SMITHING: 13, WOODCUTTING: 10, values: () => [],
    },
    DialogueChainBuilder: class { add() {} },
    NpcDialogue: class {},
    ActionDialogue: class {},
    Equipment: { AMMUNITION_SLOT: 13 },
    ItemDefinition: { forId: () => ({ getName: () => '' }) },
  };
  const api = {
    core,
    persistAttribute() {},
    onNpcDialogueVariant() {},
    onNpcDialogueCondition() {},
    onCustomEvent(type, handler) { (events[type] ??= []).push(handler); },
    emitCustomEvent(type, payload) { for (const handler of events[type] ?? []) handler(payload); },
    onGroundItemPickup() {},
    onPlayerLogin() {},
    onNpcInteraction(name, actions) { interactions[name] = actions; },
    onItemOnNpc() {},
  };
  plugin.register(api);
  return { api, events, interactions };
}

function receive(events, player, text) {
  for (const handler of events['npc-dialogue:action'] ?? []) {
    handler({
      player, npcId: MAGIC_TUTOR,
      step: { type: 'action', action: 'receive', text },
      text, action: 'receive', kind: 'action', handled: false,
    });
  }
}

test('a failed full-inventory rune grant does not spend the magic claim cooldown', () => {
  const { events } = bindPlugin();
  const player = makePlayer(Array.from({ length: 28 }, (_, index) => [1000 + index, 1]));

  receive(events, player, '30 mind runes');

  assert.equal(player.getInventory().getAmount(MIND_RUNE), 0);
  assert.equal(player.getAttribute(CLAIM_ATTRIBUTE), undefined);
});

test('a successful rune grant spends the cooldown and blocks the next claim', () => {
  const { api, events, interactions } = bindPlugin();
  const player = makePlayer(Array.from({ length: 27 }, (_, index) => [1000 + index, 1]));
  const started = [];
  api.onCustomEvent('npc-dialogue:start', (request) => started.push(request.variant));

  interactions['Magic combat tutor'].Claim({ player, npc: { getId: () => MAGIC_TUTOR }, npcId: MAGIC_TUTOR });
  assert.equal(started.at(-1), 'claim-dialogue-with-no-mind-runes-in-the-bank-or-inventory-with-an-open-inventory-space-with-only-one-inventory-space-open-for-mind-runes');

  receive(events, player, '30 mind runes');
  assert.equal(player.getInventory().getAmount(MIND_RUNE), 30);
  assert.ok(player.getAttribute(CLAIM_ATTRIBUTE));

  interactions['Magic combat tutor'].Claim({ player, npc: { getId: () => MAGIC_TUTOR }, npcId: MAGIC_TUTOR });
  assert.equal(started.at(-1), 'claim-dialogue-during-the-30-minute-cooldown');
});

test('a full inventory already selects the no-room transcript', () => {
  const { api, interactions } = bindPlugin();
  const player = makePlayer(Array.from({ length: 28 }, (_, index) => [1000 + index, 1]));
  const started = [];
  api.onCustomEvent('npc-dialogue:start', (request) => started.push(request.variant));

  interactions['Magic combat tutor'].Claim({ player, npc: { getId: () => MAGIC_TUTOR }, npcId: MAGIC_TUTOR });

  assert.equal(started.at(-1), 'claim-dialogue-with-no-mind-runes-in-the-bank-or-inventory-but-no-inventory-space');
  assert.equal(player.getAttribute(CLAIM_ATTRIBUTE), undefined);
});
