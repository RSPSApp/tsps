import { strict as assert } from "node:assert";
import { XpState } from "../game/plugins/xptracker/xpState";
import { SkillId } from "../rs/skill/skills";

// Proposed timeout-bearing state API: the current one-argument implementation ignores
// now/resetAfter in JavaScript. This fixture tests the state API, not plugin wiring or config.
function tickOverall(state: XpState, delta: number, now: number, resetAfter: number): void {
    const tick = state.tickOverall as (delta: number, now: number, resetAfter: number) => void;
    tick.call(state, delta, now, resetAfter);
}

function gainedState(): XpState {
    const state = new XpState();
    state.updateSkill(SkillId.Mining, 1000, -1, -1, 1000, false);
    state.initializeOverall(1000);
    state.updateSkill(SkillId.Mining, 1050, -1, -1, 1000, false);
    state.updateOverall(1050, 1000);
    return state;
}

// Existing skill timeout is the control for the same gain, deadline and setting.
const skillControl = gainedState();
skillControl.tick(SkillId.Mining, 60_000, 61_000, 1);
const skill = skillControl.get(SkillId.Mining)!;
assert.equal(skill.totalXpGained, 50);
assert.equal(skill.xpGainedSinceReset, 0);
assert.equal(skill.actionsSinceReset, 0);
assert.equal(skill.actions, 1);
assert.equal(skill.skillTime, 0);
assert.equal(skill.xpPerHour, 0);

// Zero disables automatic reset, even after the one-minute deadline.
const disabled = gainedState();
tickOverall(disabled, 60_000, 61_000, 0);
assert.equal(disabled.overall.totalXpGained, 50);
assert.equal(disabled.overall.xpGainedSinceReset, 50);
assert.equal(disabled.overall.actionsSinceReset, 1);
assert.equal(disabled.overall.skillTime, 60_000);
assert.ok(disabled.overall.xpPerHour > 0);

const deadline = gainedState();
tickOverall(deadline, 59_999, 60_999, 1);
assert.equal(deadline.overall.totalXpGained, 50);
assert.equal(deadline.overall.xpGainedSinceReset, 50);
assert.equal(deadline.overall.actionsSinceReset, 1);
assert.equal(deadline.overall.skillTime, 59_999);
assert.ok(deadline.overall.xpPerHour > 0, "before the deadline the rate remains active");

tickOverall(deadline, 1, 61_000, 1);
assert.equal(deadline.overall.xpPerHour, 0, "overall rate resets at the idle deadline");
assert.equal(deadline.overall.totalXpGained, 50, "reset preserves the session gain");
assert.equal(deadline.overall.xpGainedSinceReset, 0);
assert.equal(deadline.overall.actionsSinceReset, 0);
assert.equal(deadline.overall.actions, 1);
assert.equal(deadline.overall.skillTime, 0);

console.log("xp tracker overall reset state tests passed");
