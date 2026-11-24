import assert from "node:assert/strict";

// OSRS: with "Middle mouse button controls camera" off, a middle click is a left click (it
// runs the top menu entry and presses widgets). With it on, the middle button turns the camera.

const noop = () => {};
const listeners = new Map<string, (event: any) => void>();
const canvas: any = {
    style: {},
    addEventListener: (name: string, callback: (event: any) => void) => listeners.set(name, callback),
    removeEventListener: noop,
    contains: (node: unknown) => node === canvas,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 640, height: 480 }),
    clientWidth: 640, clientHeight: 480, width: 640, height: 480,
};
(globalThis as any).window ??= { addEventListener: noop, removeEventListener: noop, devicePixelRatio: 1 };
(globalThis as any).document = { addEventListener: noop, removeEventListener: noop };

async function main() {
    const { ClickMode, InputManager } = await import("../game/InputManager");
    const press = (input: any, button: number) =>
        listeners.get("mousedown")!({ type: "mousedown", button, buttons: button === 1 ? 4 : 1, clientX: 100, clientY: 120, target: canvas, shiftKey: false, preventDefault: noop });

    const off = new InputManager();
    off.init(canvas);
    off.mouseCamEnabled = false;
    press(off, 1);
    assert.equal(off.clickMode1, ClickMode.LEFT, "the middle press is a left click");
    assert.equal(off.clickMode2, ClickMode.LEFT, "and holds like one");
    assert.equal(off.isMiddleMouseDown?.() ?? off.mouseWheelDown, false, "the camera does not turn");

    const on = new InputManager();
    on.init(canvas);
    press(on, 1);
    assert.equal(on.clickMode1, ClickMode.NONE, "with the option on it is not a click");
    assert.equal(on.mouseWheelDown, true, "it turns the camera");
}
main().then(() => console.log("ok"), (error) => { console.error(error); process.exit(1); });
