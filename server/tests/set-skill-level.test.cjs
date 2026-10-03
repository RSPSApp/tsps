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

const nonCombatSkills = [
  [7, Skill.RUNECRAFTING], [8, Skill.CONSTRUCTION], [10, Skill.AGILITY],
  [11, Skill.HERBLORE], [12, Skill.THIEVING], [13, Skill.CRAFTING],
  [14, Skill.FLETCHING], [15, Skill.SLAYER], [16, Skill.HUNTER],
  [17, Skill.MINING], [18, Skill.SMITHING], [19, Skill.FISHING],
  [20, Skill.COOKING], [21, Skill.FIREMAKING], [22, Skill.WOODCUTTING],
  [23, Skill.FARMING],
];

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

test("only developers can set non-combat skills regardless of presets", (t) => {
  for (const enabled of [true, false]) {
    t.mock.method(Presets, "isEnabled", () => enabled);
    for (const rights of [0, 1, 2, 3, 4]) {
      for (const [childId, skill] of nonCombatSkills) {
        const account = player({ rights });
        assert.equal(click(account, childId).handled, rights === 4);
        if (rights === 4) {
          assert.deepEqual(account.prompts, [`Set ${skill.getName()} Level (1-99)`]);
          account.getEnteredAmountAction().execute(99);
          assert.deepEqual(account.levels, [[skill, 99]]);
        } else {
          assert.deepEqual(account.prompts, []);
          assert.equal(account.getEnteredAmountAction(), null);
          assert.deepEqual(account.levels, []);
        }
      }
    }
    t.mock.restoreAll();
  }
});

test("a pending skilling prompt cannot outlive developer permission", () => {
  const developer = player({ rights: 4 });
  click(developer, 8);
  developer.getRights = () => ({ getId: () => 3 });
  developer.getEnteredAmountAction().execute(99);
  assert.deepEqual(developer.levels, []);
  assert.deepEqual(developer.messages, ["Only Developers can set non-combat skill levels."]);
});

test("developer skilling levels stay within 1-99 and ignore non-skill buttons", () => {
  const developer = player({ rights: 4 });
  click(developer, 8);
  for (const level of [0, -1, 100, 1.5, NaN, Infinity]) {
    developer.getEnteredAmountAction().execute(level);
  }
  assert.deepEqual(developer.levels, []);
  developer.getEnteredAmountAction().execute(1);
  assert.deepEqual(developer.levels, [[Skill.CONSTRUCTION, 1]]);
  for (const childId of [0, 25, -1]) {
    assert.equal(click(developer, childId).handled, false);
  }
  // Component 24 is Sailing, the skills tab's 24th skill.
  assert.equal(click(developer, 24).handled, true);
  developer.getEnteredAmountAction().execute(50);
  assert.deepEqual(developer.levels.at(-1), [Skill.SAILING, 50]);
  const event = { player: developer, groupId: 321, childId: 8, handled: false };
  clickHandler(event);
  assert.equal(event.handled, false);
});

test("combat stat setting retains preset restrictions and rechecks them on submission", (t) => {
  const regular = player();
  click(regular, 1);
  t.mock.method(Presets, "isEnabled", () => false);
  regular.getEnteredAmountAction().execute(99);
  assert.deepEqual(regular.levels, []);
  const blocked = player();
  click(blocked, 1);
  assert.deepEqual(blocked.prompts, []);
  assert.deepEqual(blocked.messages, ["Setting skill levels requires enabled presets."]);
  const developer = player({ rights: 4 });
  click(developer, 1);
  developer.getEnteredAmountAction().execute(99);
  assert.deepEqual(developer.levels, [[Skill.ATTACK, 99]]);
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
