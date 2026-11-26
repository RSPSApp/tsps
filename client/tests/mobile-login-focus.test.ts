import assert from "node:assert/strict";
import { test } from "node:test";

import { JSDOM } from "jsdom";

// A mobile browser can refuse a programmatic focus or caret move on the hidden login input. The
// call sits in the per-frame login render, so an uncaught refusal aborted the frame and looked
// like a client crash ("Script error." with focus -> syncMobileLoginInput in the stack).
test("a refused login input focus or caret move never escapes the render frame", async () => {
    const dom = new JSDOM("<!doctype html><body></body>", {
        url: "http://localhost/?mobile=1",
        pretendToBeVisual: true,
    });
    const originals = ["window", "document"].map((name) =>
        Object.getOwnPropertyDescriptor(globalThis, name),
    );
    Object.assign(globalThis, { window: dom.window, document: dom.window.document });
    const warnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => warnings.push(args.map(String).join(" "));
    try {
        const { syncMobileLoginInput } = await import("../render/render/mobileLogin");
        const input = document.createElement("input");
        input.type = "text";
        document.body.appendChild(input);

        const host = {
            mobileLoginInput: input,
            shouldUseMobileLoginInput: () => true,
            ensureMobileLoginInput: () => input,
            getActiveLoginFieldValue: () => "player",
            syncMobileLoginInputPosition: () => {},
            osrsClient: { loginState: { extension: undefined, currentLoginField: 0 } },
        } as any;

        // Refusal case: both focus attempts and the caret move throw.
        const focusCalls: Array<FocusOptions | undefined> = [];
        input.focus = ((options?: FocusOptions) => {
            focusCalls.push(options);
            throw new Error("focus refused");
        }) as any;
        input.setSelectionRange = (() => {
            throw new Error("selection refused");
        }) as any;
        assert.doesNotThrow(() => syncMobileLoginInput(host, true));
        assert.doesNotThrow(() => syncMobileLoginInput(host, true), "a second frame stays safe too");
        assert.deepEqual(focusCalls, [
            { preventScroll: true },
            undefined,
            { preventScroll: true },
            undefined,
        ]);
        assert.equal(
            warnings.filter((line) => line.includes("focus refused")).length,
            1,
            "the refusal is logged once, not once per frame",
        );
        assert.equal(warnings.filter((line) => line.includes("selection refused")).length, 1);

        // Success case: the normal path still focuses and puts the caret after the text.
        input.focus = dom.window.HTMLInputElement.prototype.focus;
        const selections: Array<[number, number]> = [];
        input.setSelectionRange = ((start: number, end: number) => {
            selections.push([start, end]);
        }) as any;
        syncMobileLoginInput(host, true);
        assert.equal(document.activeElement, input);
        assert.deepEqual(selections.at(-1), [6, 6]);
    } finally {
        console.warn = originalWarn;
        for (const [index, name] of ["window", "document"].entries()) {
            const descriptor = originals[index];
            if (descriptor) Object.defineProperty(globalThis, name, descriptor);
            else delete (globalThis as any)[name];
        }
    }
});
