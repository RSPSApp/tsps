// Run after `yarn build`: node --test tests/npc-dialogues.test.cjs
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { pickVariant, aliasKeys, flatten, startDialogue } = require('../plugins/npcs/NpcDialogues.plugin');

const data = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/definitions/npc-dialogues.json'), 'utf8'));
const aliases = aliasKeys(data);
const talk = (name) => {
  const record = pickVariant(data[name]) ? data[name] : data[aliases.get(name)];
  return pickVariant(record);
};

test('a variant is chosen when the dump names no default', () => {
  assert.equal(pickVariant({ default: 'b', variants: { a: [{ npc: 'a' }], b: [{ npc: 'b' }] } })[0].npc, 'b');
  assert.equal(pickVariant({ default: null, variants: { 'overhead-x': [1], 'standard-y': [2] } })[0], 2);
  assert.equal(pickVariant({ default: null, variants: { 'if-poisoned': [3] } })[0], 3);
  // Overhead shouts are not a conversation; stay silent rather than yell at the player.
  assert.equal(pickVariant({ default: null, variants: { 'overhead-x': [1] } }), undefined);
  assert.equal(pickVariant(undefined), undefined);
  // Larran and Pox are variant-only records that used to resolve to nothing.
  for (const name of ['Larran', 'Pox', 'Emblem Trader', 'Ferox', 'Lisa']) assert.ok(talk(name)?.length, name);
});

test('cache names reach disambiguated wiki keys', () => {
  assert.equal(aliases.get('Hops'), 'Hops (Biohazard)');
  // A bare key wins when it is usable; "Guard" is overhead-only, so the alias takes over.
  assert.equal(pickVariant(data['Guard']), undefined);
  for (const name of ['Hops', 'Guard', 'Bartender', 'Wizard']) assert.ok(talk(name)?.length, name);
});

test('prose conditions take their first branch and dead jumps fall through', () => {
  const steps = flatten([
    { npc: 'hello' },
    { type: 'condition', text: 'If A:', steps: [{ npc: 'branch A' }, { type: 'jump', id: 'nowhere' }] },
    { type: 'condition', text: 'If B:', steps: [{ npc: 'branch B' }] },
    { npc: 'shared tail' },
  ]);
  assert.deepEqual(steps.map((step) => step.npc), ['hello', 'branch A', 'shared tail']);
  assert.deepEqual(flatten([{ type: 'condition', steps: [{ type: 'condition', steps: [{ npc: 'deep' }] }] }]),
    [{ npc: 'deep' }]);
  // Perdu opens on a condition, so the whole conversation used to be unreachable.
  assert.equal(flatten(talk('Perdu'))[0].npc,
    "It seems you're missing out on some valuable experience. Would you like it?");
});

test('a condition branch that continues reaches the next sibling check', () => {
  const steps = flatten([
    {
      type: 'condition', text: 'If high combat:', steps: [
        { npc: 'very strong' },
        {
          type: 'choice',
          options: [
            { text: 'no', steps: [{ player: 'no' }, { type: 'jump', reference: 'continues' }] },
            { text: 'yes', steps: [{ player: 'yes' }, { type: 'end' }] },
          ],
        },
      ],
    },
    { type: 'condition', text: "If no assignment:", steps: [{ npc: 'assigned' }] },
    { type: 'condition', text: 'If has assignment:', steps: [{ npc: 'still hunting' }] },
  ]);
  // The detour keeps its prompt, then falls through to the first following check.
  assert.deepEqual(steps.map((step) => step.npc).filter(Boolean), ['very strong', 'assigned']);
});

test('a nested "jump above" reaches an unselected sibling instead of looping', () => {
  // The nested option's jump is written "above"; its target is the sibling of the
  // same text on the outer menu, which has not been selected yet.
  const tree = [
    { npc: 'I need help.' },
    {
      type: 'choice', prompt: 'Q1', options: [
        {
          text: 'Outer', steps: [
            { npc: 'nested' },
            {
              type: 'choice', prompt: 'Q2', options: [
                { text: "What's wrong?", steps: [{ type: 'jump', reference: 'above' }] },
                { text: 'Nothing', steps: [{ type: 'end' }] },
              ],
            },
          ],
        },
        {
          text: "What's wrong?", steps: [
            { npc: 'detail' },
            {
              type: 'choice', prompt: 'Q3', options: [
                { text: 'Start?', steps: [{ npc: 'starting' }] },
                { text: 'No', steps: [{ type: 'end' }] },
              ],
            },
          ],
        },
      ],
    },
  ];

  const script = ['Outer', "What's wrong?", 'No'];
  const prompts = [];
  const player = {
    getDialogueManager: () => ({
      reset() {},
      startDialogues(chain) {
        for (const entry of [...chain.getDialogues().values()].sort((a, b) => a.getIndex() - b.getIndex())) {
          try { entry.send(player); } catch { /* unwired dialogue entries are fine here */ }
        }
      },
    }),
    getPacketSender: () => ({ sendInterfaceRemoval() {} }),
    sendMessage() {},
  };
  const definition = { getName: () => 'Cook', getId: () => 4626 };
  const api = {
    emitCustomEvent() {},
    sendMultiChatboxPrompt(_player, title, ...pairs) {
      assert.ok(prompts.length < 10, 'dialogue looped');
      const options = [];
      for (let i = 0; i < pairs.length; i += 2) options.push({ text: pairs[i], cb: pairs[i + 1] });
      prompts.push(title);
      const pick = options.find((option) => option.text === script[prompts.length - 1]) ?? options[0];
      pick.cb();
      return true;
    },
  };
  const event = { player, npc: { getId: () => 4626 }, npcId: 4626, definition };
  startDialogue(api, event, tree, {}, { player, npc: event.npc, npcId: 4626, definition, pages: [] });

  assert.deepEqual(prompts, ['Q1', 'Q2', 'Q3']);
});

test('a jump after a repeated question carries on as that question, judged when it is reached', () => {
  // Percy's unlocks: buying, then asking again, must not offer what was just bought, and the
  // branch that jumps back into itself ("That'll be 200 nuggets") must not recurse forever.
  const { PluginManager } = require('../dist/plugins/PluginManager');
  let unlocked = false;
  const condition = { pluginName: 'test', handler: ({ text }) => (text === 'If locked:' ? !unlocked : text === 'If unlocked:' ? unlocked : null) };
  PluginManager.npcDialogueConditionHooks.unshift(condition);
  const said = [];
  const picks = ['Anything to unlock?', 'Buy', 'Anything to unlock?'];
  const player = {
    getDialogueManager: () => ({
      reset() {},
      startDialogues(chain) {
        for (const entry of [...chain.getDialogues().values()].sort((a, b) => a.getIndex() - b.getIndex())) {
          if (entry.text) said.push(entry.text);
          try { entry.send(player); } catch { /* unwired dialogue entries are fine here */ }
        }
      },
    }),
    getPacketSender: () => ({ sendInterfaceRemoval() {} }),
    sendMessage() {},
  };
  const api = {
    emitCustomEvent(name, payload) {
      if (name === 'npc-dialogue:action' && payload.stepId === 'pay' && payload.kind === 'message') unlocked = true;
    },
    sendMultiChatboxPrompt(_player, _title, ...pairs) {
      const options = [];
      for (let i = 0; i < pairs.length; i += 2) options.push({ text: pairs[i], cb: pairs[i + 1] });
      const pick = options.find((option) => option.text === picks[0]);
      if (!pick) return true;
      picks.shift();
      pick.cb();
      return true;
    },
  };
  const question = (steps) => ({ text: 'Anything to unlock?', steps: [{ player: 'Anything to unlock?' }, ...steps] });
  const tree = [{
    type: 'choice', prompt: 'Top', options: [question([
      {
        type: 'condition', text: 'If locked:', steps: [{
          type: 'choice', prompt: 'Unlocks', options: [
            { text: 'Buy', steps: [{ type: 'message', text: 'You pay.', id: 'pay' }, { player: 'Anything to unlock?' }, { type: 'jump', reference: 'below' }] },
            { text: 'Too dear', steps: [{ npc: "That'll cost ye." }, { player: 'Anything to unlock?' }, { type: 'jump', reference: 'above' }] },
          ],
        }],
      },
      { type: 'condition', text: 'If unlocked:', steps: [{ npc: 'Ye have it all.' }] },
    ])],
  }];
  const definition = { getName: () => 'Percy', getId: () => 6562 };
  const event = { player, npc: { getId: () => 6562 }, npcId: 6562, definition };
  try {
    startDialogue(api, event, tree, {}, { player, npc: event.npc, npcId: 6562, definition, pages: [] });
  } finally {
    PluginManager.npcDialogueConditionHooks.splice(PluginManager.npcDialogueConditionHooks.indexOf(condition), 1);
  }
  assert.equal(unlocked, true);
  assert.deepEqual(said.filter((line) => line === 'Ye have it all.'), ['Ye have it all.'], 'the jump saw the purchase');
});

test('an unreplayable menu jump ends the branch instead of leaking the next step', () => {
  const steps = flatten([
    {
      type: 'condition', text: 'If A:', steps: [
        { npc: 'thanks' },
        { type: 'jump', reference: 'other', id: 'x' },
      ],
    },
    { type: 'unavailable' },
  ], { resolveJump: (step) => (/^other/i.test(step.reference) ? 'end' : null) });
  assert.deepEqual(steps.map((step) => step.npc ?? step.type), ['thanks', 'end']);
});

test('menu navigation jumps become replayable gomenu steps', () => {
  const steps = flatten([{ type: 'jump', reference: 'other' }], {
    resolveJump: (step) => (step.reference === 'other' ? { menu: { marker: true } } : null),
  });
  assert.equal(steps.length, 1);
  assert.equal(steps[0].type, 'gomenu');
  assert.deepEqual(steps[0].menu, { marker: true });
});

test('a slayer master assigns from a slugged action, not literal prose', () => {
  const steps = talk('Krystilia');
  const found = { action: false, tip: false, spoken: false };
  const walk = (nodes) => {
    for (const node of nodes ?? []) {
      if (node.action === 'slayer_assignment') {
        found.action = true;
        assert.equal(node.target, 'Krystilia');
      }
      if (node.action === 'slayer_task_tip') found.tip = true;
      if (typeof node.npc === 'string' && node.npc.includes('Your new task is to kill')) found.spoken = true;
      walk(node.steps);
      for (const option of node.options ?? []) walk(option.steps);
    }
  };
  walk(steps);
  assert.ok(found.action, 'the assignment step carries the slug');
  assert.ok(found.tip, 'the task tip step carries the slug');
  // The placeholder line must not survive as something a player can read.
  assert.equal(found.spoken, false);
});

test('Lumbridge tutors hand out what their transcripts say', () => {
  const { Skill } = require('../dist/game/model/Skill');
  const { ItemIdentifiers: I } = require('../dist/util/ItemIdentifiers');
  const { NpcIdentifiers: N } = require('../dist/util/NpcIdentifiers');
  const hooks = {};
  require('../plugins/npcs/Tutors.plugin').register({
    core: {
      Skill, ItemIdentifiers: I, NpcIdentifiers: N, ItemDefinition: { forId: () => ({ getName: () => 'Thing' }) },
      Equipment: require('../dist/game/model/container/impl/Equipment').Equipment,
      Sounds: { sendSound() {} }, Sound: { PICK_UP_ITEM: 0 },
      ItemOnGroundManager: { deregister(groundItem) { groundItem.deregistered = true; } },
    },
    persistAttribute() {}, onNpcDialogueVariant() {}, onItemOnNpc() {},
    onNpcDialogueCondition(handler) { hooks.condition = handler; },
    onCustomEvent(name, handler) { hooks[name] = handler; },
    onNpcInteraction(name, actions) { hooks[name] = actions; },
    onGroundItemPickup(handler) { hooks.pickup = handler; },
    emitCustomEvent(_name, request) { hooks.started = request.variant; },
  });
  const container = (items = {}) => {
    const map = new Map(Object.entries(items).map(([id, n]) => [Number(id), n]));
    return { getAmount: (id) => map.get(id) ?? 0, contains: (id) => map.has(id), adds: (id, n) => map.set(id, (map.get(id) ?? 0) + n),
      getFreeSlots: () => 28 - map.size, getItems: () => [] };
  };
  const player = (bank = {}) => {
    const attributes = {};
    const inventory = container();
    return { inventory, messages: [], getInventory: () => inventory, getEquipment: () => container(), getBanks: () => [container(bank)],
      getAttribute: (key) => attributes[key], setAttribute: (key, value) => { attributes[key] = value; },
      sendMessage(text) { this.messages.push(text); }, getSkillManager: () => ({ getMaxLevel: () => 1 }) };
  };
  // Plays a transcript the way startDialogue drives the hooks, taking the menu option `pick`.
  const play = (p, npcId, steps, pick) => {
    const queue = flatten(steps, { resolveCondition: (step) => hooks.condition({ player: p, npcId, text: step.text }) });
    for (const step of queue) {
      if (step.type === 'end') return;
      if (step.type === 'choice') return play(p, npcId, step.options.find((option) => option.text.startsWith(pick)).steps);
      const line = { player: p, npcId, text: step.npc, skip: false };
      if (step.npc) hooks['npc-dialogue:line'](line);
      if (step.type === 'action') hooks['npc-dialogue:action']({ player: p, npcId, step, text: step.text });
      if (step.type === 'message') {
        const message = { player: p, npcId, step, text: step.text, kind: 'message' };
        hooks['npc-dialogue:action'](message);
        if (!message.handled) p.sendMessage(step.text);
      }
    }
  };
  const transcript = (name, variant) => data[name].variants[variant];

  const melee = player({ [I.TRAINING_SWORD]: 1 });
  play(melee, N.MELEE_COMBAT_TUTOR, transcript('Melee combat tutor', 'standard-dialogue'), "I'd like a training");
  assert.equal(melee.inventory.getAmount(I.TRAINING_SHIELD), 1);
  assert.equal(melee.inventory.getAmount(I.TRAINING_SWORD), 0);

  // No runes and room for both: mind and air runes, then the shared 30-minute cooldown.
  const mage = player();
  hooks['Magic combat tutor'].Claim({ player: mage, npcId: N.MAGIC_COMBAT_TUTOR });
  play(mage, N.MAGIC_COMBAT_TUTOR, transcript('Magic combat tutor', hooks.started));
  assert.equal(mage.inventory.getAmount(I.MIND_RUNE), 30);
  assert.equal(mage.inventory.getAmount(I.AIR_RUNE), 30);
  assert.deepEqual(mage.messages, ['Mikasi gives you 30 mind runes.', 'Mikasi gives you 30 air runes.']);
  hooks['Ranged combat tutor'].Claim({ player: mage, npcId: N.RANGED_COMBAT_TUTOR });
  play(mage, N.RANGED_COMBAT_TUTOR, transcript('Ranged combat tutor', hooks.started));
  assert.equal(mage.inventory.getAmount(I.TRAINING_BOW), 0);

  const ranger = player();
  hooks['Ranged combat tutor'].Claim({ player: ranger, npcId: N.RANGED_COMBAT_TUTOR });
  play(ranger, N.RANGED_COMBAT_TUTOR, transcript('Ranged combat tutor', hooks.started));
  assert.equal(ranger.inventory.getAmount(I.TRAINING_BOW), 1);
  assert.equal(ranger.inventory.getAmount(I.TRAINING_ARROWS), 25);

  // The ranged tutor's pickup toggle: same ammo as the worn slot goes to the slot, not the bag.
  hooks['npc-dialogue:choice']({ player: ranger, npcId: N.RANGED_COMBAT_TUTOR, option: 'Automatically equip it.' });
  assert.equal(ranger.getAttribute('ranged:equip-ammo-on-pickup'), true);
  const { Equipment } = require('../dist/game/model/container/impl/Equipment');
  const { Item } = require('../dist/game/model/Item');
  const ammoSlot = new Item(I.BRONZE_ARROW, 5);
  ranger.getEquipment = () => ({
    get: (slot) => slot === Equipment.AMMUNITION_SLOT ? ammoSlot : new Item(-1, 0),
    refreshItems() {},
  });
  const matching = { player: ranger, groundItemId: I.BRONZE_ARROW, groundItem: { getItem: () => new Item(I.BRONZE_ARROW, 3) }, handled: false };
  hooks.pickup(matching);
  assert.equal(matching.handled, true);
  assert.equal(matching.groundItem.deregistered, true);
  assert.equal(ammoSlot.getAmount(), 8);
  const wrongAmmo = { player: ranger, groundItemId: I.IRON_ARROW, groundItem: { getItem: () => new Item(I.IRON_ARROW, 1) }, handled: false };
  hooks.pickup(wrongAmmo);
  assert.equal(wrongAmmo.handled, false, 'different ammo stays on the normal inventory pickup path');
  hooks['npc-dialogue:choice']({ player: ranger, npcId: N.RANGED_COMBAT_TUTOR, option: 'Place it in my inventory.' });
  assert.equal(ranger.getAttribute('ranged:equip-ammo-on-pickup'), false);
  const disabled = { player: ranger, groundItemId: I.BRONZE_ARROW, groundItem: { getItem: () => new Item(I.BRONZE_ARROW, 3) }, handled: false };
  hooks.pickup(disabled);
  assert.equal(disabled.handled, false);
});

test('"same as above" after an NPC line carries on as that line does elsewhere, never looping', () => {
  const { collectPageLines, collectPageOptions } = require('../plugins/npcs/NpcDialogues.plugin');
  // Bryn's page: the first-time answer says the opening line, then "jump above".
  const record = data.Bryn;
  const options = collectPageOptions(record);
  const context = { pages: [], pageLines: collectPageLines(record), pageOptions: options.byText, pageOptionList: options.list };
  const said = [];
  let steps = 0;
  const player = {
    getDialogueManager: () => ({
      reset() {},
      startDialogues(chain) {
        assert.ok(++steps < 20, 'dialogue looped');
        const entries = [...chain.getDialogues().values()].sort((a, b) => a.getIndex() - b.getIndex());
        for (const entry of entries) {
          if (entry.constructor.name === 'ActionDialogue') return entry.send(player);
          said.push(String(entry.text ?? ''));
        }
      },
    }),
    getPacketSender: () => ({ sendInterfaceRemoval() { said.push('<closed>'); } }),
    sendMessage() {},
  };
  const definition = { getName: () => 'Bryn', getId: () => 9020 };
  const api = {
    emitCustomEvent() {},
    sendMultiChatboxPrompt(_player, _title, ...pairs) { pairs[1](); return true; }, // "What is this place?"
  };
  const event = { player, npc: { getId: () => 9020 }, npcId: 9020, definition };
  startDialogue(api, event, record.variants['first-time-talking-to-him'], {}, { ...context, player, npc: event.npc, npcId: 9020, definition });
  assert.ok(said.includes('Train?'), 'the full explanation follows');
  assert.equal(said.filter((line) => line.startsWith('This here is the Gauntlet')).length, 1, 'said once');
  assert.equal(said.at(-1), '<closed>');
});

test('a random story skips alternatives a plugin rules out, and an action can splice in steps', () => {
  const { PluginManager } = require('../dist/plugins/PluginManager');
  const condition = { pluginName: 'test', handler: ({ text }) => (text === 'If done:' ? true : text === 'If not done:' ? false : null) };
  PluginManager.npcDialogueConditionHooks.unshift(condition);
  const said = [];
  const player = {
    getDialogueManager: () => ({
      reset() {},
      startDialogues(chain) {
        for (const entry of [...chain.getDialogues().values()].sort((a, b) => a.getIndex() - b.getIndex())) {
          if (entry.text) said.push(entry.text);
          try { entry.send(player); } catch { /* unwired dialogue entries are fine here */ }
        }
      },
    }),
    getPacketSender: () => ({ sendInterfaceRemoval() {} }),
    sendMessage() {},
  };
  const story = {
    type: 'random',
    options: [
      { text: 'a', condition: 'If not done:', steps: [{ player: 'Never happened.' }] },
      { text: 'b', condition: 'If done:', steps: [{ player: 'It happened.' }] },
    ],
  };
  const api = {
    emitCustomEvent(name, payload) {
      if (name === 'npc-dialogue:action' && payload.stepId === 'pick') {
        payload.steps = [story];
        payload.handled = true;
      }
    },
  };
  const definition = { getName: () => 'Juna', getId: () => 5785 };
  const event = { player, npc: null, npcId: 5785, definition };
  try {
    for (let i = 0; i < 10; i++) {
      startDialogue(api, event, [{ type: 'reference', id: 'pick' }, { npc: 'Your stories have entertained me.' }], {}, { player, npc: null, npcId: 5785, definition, pages: [] });
    }
  } finally {
    PluginManager.npcDialogueConditionHooks.splice(PluginManager.npcDialogueConditionHooks.indexOf(condition), 1);
  }
  assert.equal(said.filter((line) => line === 'Never happened.').length, 0);
  assert.equal(said.filter((line) => line === 'It happened.').length, 10);
  assert.equal(said.filter((line) => line === 'Your stories have entertained me.').length, 10);
});
