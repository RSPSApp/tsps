import assert from "node:assert/strict";

import { Opcodes } from "../rs/cs2/Opcodes";
import { createHandlerMap } from "../rs/cs2/handlers";

/**
 * cc_resume_pausebutton resumes the widget its operand picks, like every cc_ op: 1 is the one
 * found with cc_find 1. The ToA party panel's Accept/Decline and invocation buttons click
 * through that way (scripts 6746, 6754: cc_find 1 on 774:1, then cc_resume_pausebutton 1);
 * resuming the clicked button instead sent the server the wrong component.
 */
const sent: Array<[number, number]> = [];
const clicked: any = { uid: (774 << 16) | 60, id: (774 << 16) | 60, childIndex: -1 };
const pauseChild: any = { uid: -1, id: (774 << 16) | 1, childIndex: 36 };
const ctx: any = {
    activeWidget: clicked,
    dotWidget: pauseChild,
    sendResumePauseButton: (uid: number, child: number) => sent.push([uid, child]),
};
const handler = createHandlerMap().get(Opcodes.CC_RESUME_PAUSEBUTTON)!;

handler(ctx, 1);
assert.deepEqual(sent.at(-1), [(774 << 16) | 1, 36], ".cc_resume_pausebutton resumes the cc_find 1 widget");

handler(ctx, 0);
assert.deepEqual(sent.at(-1), [(774 << 16) | 60, -1], "cc_resume_pausebutton resumes the active widget");

console.log("cc_resume_pausebutton: ok");
