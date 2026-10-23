import assert from "node:assert/strict";
import { test } from "node:test";

import { JSDOM } from "jsdom";

test("mobile chat keeps its native caret above the keyboard and preserves chat input", async () => {
    const dom = new JSDOM("", { url: "http://localhost/?mobile=1", pretendToBeVisual: true });
    const originals = ["window", "document"].map((name) =>
        Object.getOwnPropertyDescriptor(globalThis, name),
    );
    Object.assign(globalThis, { window: dom.window, document: dom.window.document });
    dom.window.HTMLCanvasElement.prototype.getContext = (() => null) as any;
    try {
        const { MobileChatKeyboard } = await import("../game/chat/MobileChatKeyboard");
        const typed: number[] = [];
        const keys: number[] = [];
        let varc = "seed";
        const keyboard = new MobileChatKeyboard({
            inputManager: {
                enqueueTypedChar: (char: number) => typed.push(char),
                enqueueOsrsKeyPress: (key: number) => keys.push(key),
            },
            varManager: {
                getVarcString: (id: number) => {
                    assert.equal(id, 335);
                    return varc;
                },
            },
        } as any);
        const focusArgs: Array<FocusOptions | undefined> = [];
        const nativeFocus = dom.window.HTMLInputElement.prototype.focus;
        let rejectPreventScroll = false;
        dom.window.HTMLInputElement.prototype.focus = function (options) {
            focusArgs.push(options);
            if (rejectPreventScroll && options) throw new Error("unsupported focus options");
            nativeFocus.call(this);
        };

        keyboard.show("Chat", 1);
        const input = document.querySelector("input")!;
        assert.equal(document.activeElement, input);
        assert.deepEqual(focusArgs, [{ preventScroll: true }]);
        assert.equal(input.style.top, "0px", "the native caret stays at the uncovered viewport top");
        assert.equal(input.style.bottom, "", "the keyboard must not cover a bottom-anchored caret");
        assert.equal(input.style.height, "16px");
        assert.equal(input.style.fontSize, "16px");
        assert.equal(input.style.padding, "0px");
        assert.equal(input.style.borderWidth, "0px");
        assert.equal(input.placeholder, "Chat");
        assert.equal(input.inputMode, "numeric");
        assert.equal(input.value, "seed");
        assert.equal(keyboard.isOpen, true);

        input.value += "a".repeat(1024);
        input.dispatchEvent(new dom.window.Event("input"));
        assert.equal(String.fromCharCode(...typed), "a".repeat(1024));
        input.value = input.value.slice(0, -3);
        input.dispatchEvent(new dom.window.Event("input"));
        assert.deepEqual(keys, [85, 85, 85]);
        const enter = new dom.window.KeyboardEvent("keydown", { key: "Enter", cancelable: true });
        input.dispatchEvent(enter);
        assert.equal(enter.defaultPrevented, true);
        assert.deepEqual(keys, [85, 85, 85, 84]);

        keyboard.hide();
        assert.notEqual(document.activeElement, input);
        assert.equal(keyboard.isOpen, false);
        input.value += "ignored";
        input.dispatchEvent(new dom.window.Event("input"));
        assert.equal(typed.length, 1024, "a closed keyboard cannot enqueue input");

        varc = "reply";
        rejectPreventScroll = true;
        keyboard.show();
        assert.deepEqual(focusArgs.slice(-2), [{ preventScroll: true }, undefined]);
        assert.equal(document.activeElement, input, "older browsers still focus through the fallback");
        assert.equal(document.querySelectorAll("input").length, 1);
        assert.equal(input.value, "reply", "reopening resynchronizes the chat varc");
        assert.equal(input.inputMode, "text");
        keyboard.hide();
    } finally {
        ["window", "document"].forEach((name, index) => {
            const original = originals[index];
            if (original) Object.defineProperty(globalThis, name, original);
            else delete (globalThis as Record<string, unknown>)[name];
        });
        dom.window.close();
    }
});
