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
        const { InputManager } = await import("../game/InputManager");
        const typed: number[] = [];
        const keys: number[] = [];
        let varc = "seed";
        let chatKeyboardState = -1;
        const keyboard = new MobileChatKeyboard({
            inputManager: {
                enqueueTypedChar: (char: number) => typed.push(char),
                enqueueOsrsKeyPress: (key: number) => keys.push(key),
            },
            varManager: {
                getVarcInt: (id: number) => {
                    assert.equal(id, 1226);
                    return chatKeyboardState;
                },
                setVarcInt: (id: number, value: number) => {
                    assert.equal(id, 1226);
                    chatKeyboardState = value;
                },
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

        const canvas = document.createElement("canvas");
        canvas.width = 800;
        canvas.height = 400;
        canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 400 }) as DOMRect;
        document.body.appendChild(canvas);
        const inputManager = new InputManager();
        inputManager.init(canvas);
        let touchEvent = "";
        inputManager.onCanvasTouchTap = () => {
            assert.equal(touchEvent, "touchend", "iOS focus runs inside the activation event, before a frame");
            keyboard.show("Chat", 1);
        };
        const dispatchTouch = (type: string) => {
            touchEvent = type;
            const event = new dom.window.Event(type, { cancelable: true });
            Object.assign(event, {
                touches: type === "touchstart" ? [{ clientX: 100, clientY: 100, target: canvas }] : [],
                changedTouches: [{ clientX: 100, clientY: 100, target: canvas }],
            });
            canvas.dispatchEvent(event);
            touchEvent = "";
        };
        dispatchTouch("touchstart");
        assert.equal(document.querySelector("input"), null, "touchstart has no iOS activation yet");
        dispatchTouch("touchend");
        inputManager.cleanUp();
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
        assert.equal(chatKeyboardState, 0, "the first tap initializes the script toggle before it runs");
        chatKeyboardState = 1;
        keyboard.show("Chat", 1);
        assert.equal(chatKeyboardState, 1, "the later script show preserves its open state");

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
        assert.equal(chatKeyboardState, 0, "explicit hide lets the next tap open chat again");
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

        let blurs = 0;
        const nativeBlur = dom.window.HTMLInputElement.prototype.blur;
        dom.window.HTMLInputElement.prototype.blur = function () {
            blurs++;
            nativeBlur.call(this);
        };
        focusArgs.length = 0;
        varc = "fresh";
        rejectPreventScroll = false;
        keyboard.showFromGesture();
        assert.equal(blurs, 1, "an earlier untrusted focus is cleared inside the gesture");
        assert.deepEqual(focusArgs, [{ preventScroll: true }]);
        assert.equal(document.activeElement, input);
        assert.equal(input.value, "fresh");

        keyboard.hide();
        blurs = 0;
        focusArgs.length = 0;
        keyboard.showFromGesture();
        assert.equal(blurs, 0, "a fresh gesture only focuses");
        assert.deepEqual(focusArgs, [{ preventScroll: true }]);
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
