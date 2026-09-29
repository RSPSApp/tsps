// Run after `yarn build`: node --test tests/set-skill-level.test.cjs
const assert = require("node:assert/strict");
const { test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { Skill } = require("../dist/game/model/Skill");
const Presets = require("../plugins/modes/pvp/Presets");

Presets.register({
  persistAttribute() {},
  registerCustomInterface() {},
  onCanBankItem() {},
  onInterfaceActionButton() {},
});

let clickHandler;
require("../plugins/interface/SetSkillLevel.plugin").register({
  onInterfaceActionClick(handler) {
    clickHandler = handler;
  },
});

function player({ rights = 0, gear = [] } = {}) {
  let enteredAmount = null;
  const state = { prompts: [], messages: [], levels: [] };
  return {
    ...state,
    getRights: () => ({ getId: () => rights }),
    sendMessage: (message) => state.messages.push(message),
    getPacketSender: () => ({
      sendInterfaceRemoval() {},
      sendEnterAmountPrompt: (title) => state.prompts.push(title),
    }),
    setEnteredAmountAction: (action) => { enteredAmount = action; },
    getEnteredAmountAction: () => enteredAmount,
    getEquipment: () => ({ getItems: () => gear }),
    getCombat: () => ({ getTarget: () => null, getAttacker: () => null }),
    getLocation: () => undefined,
    busy: () => false,
    getSkillManager: () => ({ setLevel: (skill, level) => state.levels.push([skill, level]) }),
  };
}

function click(player, childId) {
  const event = { player, groupId: 320, childId, buttonId: (320 << 16) | childId, action: 0, handled: false };
  clickHandler(event);
  return event;
}

test("a regular player on a preset world gets the level prompt for a combat skill", () => {
  assert.equal(Presets.isEnabled(), true);
  const regular = player();
  const event = click(regular, 1);

  assert.equal(event.handled, true);
  assert.deepEqual(regular.prompts, ["Set Attack Level (1-99)"]);
  assert.deepEqual(regular.messages, []);

  regular.getEnteredAmountAction().execute(99);
  assert.deepEqual(regular.levels, [[Skill.ATTACK, 99]]);
});

test("hitpoints uses the 10-99 range", () => {
  const regular = player();
  click(regular, 9);
  assert.deepEqual(regular.prompts, ["Set Hitpoints Level (10-99)"]);

  regular.getEnteredAmountAction().execute(5);
  assert.deepEqual(regular.levels, []);
  assert.deepEqual(regular.messages, ["Invalid level. Please enter a level from 10 to 99."]);
});

test("non-combat components are left alone", () => {
  const regular = player();
  const event = click(regular, 7); // Runecrafting
  assert.equal(event.handled, false);
  assert.deepEqual(regular.prompts, []);
});

test("gear blocks a regular player but not a developer", () => {
  const geared = player({ gear: [{ getId: () => 4151 }] });
  click(geared, 1);
  assert.deepEqual(geared.prompts, []);
  assert.deepEqual(geared.messages, ["You must remove all of your gear to set stats."]);

  const developer = player({ rights: 4, gear: [{ getId: () => 4151 }] });
  const event = click(developer, 1);
  assert.equal(event.handled, true);
  assert.deepEqual(developer.prompts, ["Set Attack Level (1-99)"]);
});
