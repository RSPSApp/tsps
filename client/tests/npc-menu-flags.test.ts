import assert from "node:assert/strict";
import { test } from "node:test";

import { buildNpcMenuEntries } from "../game/menu/WorldMenuBuilder";

// OSRS: an NPC flagged non-interactable (opcode 107) adds nothing to the menu, and the
// "follower options lower down" setting applies only to NPCs with opcode 123, not to every follower.

const ctx: any = { activeSpell: null, selectedItem: null, debugId: false, npcAttackOption: 2, localPlayerCombatLevel: 50, followerOpsLowPriority: true, followerIndex: 7 };
const callbacks: any = new Proxy({}, { get: () => () => {} });
const npc = (flags: object): any => ({ id: 1, name: "Cat", combatLevel: 0, actions: ["Pick-up", "Talk-to", null, null, null], isInteractable: true, isFollower: false, lowPriorityFollowerOps: false, ...flags });
const build = (flags: object) => buildNpcMenuEntries(npc(flags), 0, 0, ctx, callbacks, () => undefined, 7);

test("a non-interactable NPC has no options and no Examine", () => {
    assert.deepEqual(build({ isInteractable: false }), { actions: [], examine: null });
});

test("a follower without the low-priority flag keeps normal options", () => {
    const { actions, examine } = build({ isFollower: true });
    assert.deepEqual(actions.map((a) => [a.option, !!a.deprioritized]), [["Pick-up", false], ["Talk-to", false]]);
    assert.equal(examine?.option, "Examine");
});

test("a follower with the flag gets Examine first and lowered options", () => {
    const { actions, examine } = build({ isFollower: true, lowPriorityFollowerOps: true });
    assert.equal(actions[0].option, "Examine");
    assert.ok(actions.slice(1).every((a) => a.deprioritized));
    assert.equal(examine, null);
});

test("\"Depends on combat levels\" lowers only Attack on a higher-level NPC", () => {
    // The Wiki's NPC 'Attack' options: only Attack moves below Walk here, so a low-level player
    // still left-clicks Pickpocket on a Knight of Ardougne.
    const knight = npc({ name: "Knight of Ardougne", combatLevel: 46, actions: ["Talk-to", "Attack", "Pickpocket", null, null] });
    const lowered = (npcAttackOption: number, localPlayerCombatLevel: number) =>
        buildNpcMenuEntries(knight, 0, 0, { ...ctx, npcAttackOption, localPlayerCombatLevel }, callbacks, () => undefined, 7)
            .actions.filter((a) => a.deprioritized).map((a) => a.option).sort();
    assert.deepEqual(lowered(0, 3), ["Attack"]);
    assert.deepEqual(lowered(0, 70), []);
    assert.deepEqual(lowered(2, 3), []);
    assert.deepEqual(lowered(1, 3), ["Attack"]);
});
