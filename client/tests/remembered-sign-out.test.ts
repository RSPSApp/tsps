import assert from "node:assert/strict";

import { LoginActions } from "../game/login/LoginAction";
import { REMEMBERED_SIGN_OUT_Y } from "../game/login/renderer/layout/geometry";
import { handleWelcomeDisplayNameClick } from "../game/login/renderer/input/mouseHandlers";

// The remembered-account screen's Sign out is a titlebutton centred under Play Now.
const host = { loginBoxX: 202, contentScale: 1, layoutConfig: { isTouch: false, minTouchTarget: 0 } } as any;
const centerX = host.loginBoxX + 180;

assert.equal(handleWelcomeDisplayNameClick(host, centerX, REMEMBERED_SIGN_OUT_Y), LoginActions.FORGET_REMEMBERED_LOGIN);
assert.equal(
    handleWelcomeDisplayNameClick(host, centerX - 70, REMEMBERED_SIGN_OUT_Y + 15),
    LoginActions.FORGET_REMEMBERED_LOGIN,
    "the whole button, not just its text",
);
assert.equal(handleWelcomeDisplayNameClick(host, centerX, 262), LoginActions.PLAY);
assert.equal(handleWelcomeDisplayNameClick(host, centerX + 120, REMEMBERED_SIGN_OUT_Y), undefined);

// A phone fitting the scene small widens the target to 44 screen px, but Play Now still wins
// where the two meet.
const phone = { ...host, contentScale: 0.6, layoutConfig: { isTouch: true, minTouchTarget: 44 } };
assert.equal(handleWelcomeDisplayNameClick(host, centerX, REMEMBERED_SIGN_OUT_Y + 35), undefined);
assert.equal(handleWelcomeDisplayNameClick(phone, centerX, REMEMBERED_SIGN_OUT_Y + 35), LoginActions.FORGET_REMEMBERED_LOGIN);
assert.equal(handleWelcomeDisplayNameClick(phone, centerX, 292), LoginActions.PLAY);

console.log("Remembered sign out test passed");
