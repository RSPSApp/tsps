import assert from "node:assert/strict";

// #6067: the Camera plugin's "Right click moves camera". Held and moved, the right button turns
// the camera like the middle one; a quick right-click still opens the menu.

const noop = () => {};
const listeners = new Map<string, (event: any) => void>();
const canvas: any = {
    style: {},
    addEventListener: (name: string, callback: (event: any) => void) => listeners.set(name, callback),
    removeEventListener: noop,
    contains: (node: unknown) => node === canvas,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 640, height: 480 }),
    clientWidth: 640,
    clientHeight: 480,
    width: 640,
    height: 480,
};
(globalThis as any).window ??= { addEventListener: noop, removeEventListener: noop, devicePixelRatio: 1 };
(globalThis as any).document ??= { addEventListener: noop, removeEventListener: noop };

async function main() {
    const { ClickMode, InputManager } = await import("../game/InputManager");

    function mouse(type: string, button: number, x: number, y: number) {
        listeners.get(type)!({ type, button, clientX: x, clientY: y, target: canvas, shiftKey: false, preventDefault: noop });
    }

    function setup(rightDragCamera: boolean) {
        const input = new InputManager();
        input.init(canvas);
        input.rightDragCamera = rightDragCamera;
        const presses: number[] = [];
        input.addMouseHandler({ onMouseDown: (event) => presses.push(event.button) });
        return { input, presses };
    }

    // Off (the default): a right press opens the menu on the press, as before.
    {
        const { input, presses } = setup(false);
        assert.equal(new InputManager().rightDragCamera, false, "off by default");
        mouse("mousedown", 2, 100, 100);
        assert.equal(input.clickMode1, ClickMode.RIGHT, "the press is the right-click");
        assert.deepEqual(presses, [2]);
        mouse("mousemove", 2, 160, 100);
        assert.equal(input.getDeltaCameraX(), 0, "dragging the right button doesn't turn the camera");
        mouse("mouseup", 2, 160, 100);
    }

    // On, a quick click: nothing on the press, the right-click on the release, at the press spot.
    {
        const { input, presses } = setup(true);
        mouse("mousedown", 2, 100, 100);
        assert.equal(input.clickMode1, ClickMode.NONE, "the press waits to see if it drags");
        assert.deepEqual(presses, [], "mouse handlers wait too");
        mouse("mousemove", 2, 102, 101); // under the drag threshold: still a click
        assert.equal(input.isCameraDragging(), false);
        mouse("mouseup", 2, 102, 101);
        assert.equal(input.clickMode1, ClickMode.RIGHT, "the release plays the right-click");
        assert.deepEqual([input.clickX, input.clickY], [100, 100], "where the button went down");
        assert.deepEqual(presses, [2], "mouse handlers see the press once");
        input.onFrameStart();
        assert.deepEqual([input.pickX, input.pickY], [100, 100], "the frame picks the menu there");
        assert.equal(input.isCameraDragging(), false);
    }

    // On, held and moved: the camera turns, and no menu opens on the release.
    {
        const { input, presses } = setup(true);
        mouse("mousedown", 2, 100, 100);
        mouse("mousemove", 2, 130, 90);
        assert.equal(input.isCameraDragging(), true, "past the threshold it is a camera drag");
        assert.deepEqual([input.getDeltaCameraX(), input.getDeltaCameraY()], [-30, 10],
            "measured from the press, like a middle drag");
        input.consumeCameraDrag();
        mouse("mousemove", 2, 140, 90);
        assert.equal(input.getDeltaCameraX(), -10);
        mouse("mousedown", 0, 140, 90);
        mouse("mouseup", 0, 140, 90);
        assert.equal(input.isCameraDragging(), true, "a left click doesn't end the right drag");
        mouse("mouseup", 2, 140, 90);
        assert.equal(input.isCameraDragging(), false, "lifting the right button ends it");
        input.onFrameStart();
        assert.notEqual(input.clickMode3, ClickMode.RIGHT, "no right-click after a drag");
        assert.deepEqual(presses, [0], "only the left press reached the handlers");
    }

    // The middle button still turns the camera with the option on.
    {
        const { input } = setup(true);
        mouse("mousedown", 1, 100, 100);
        mouse("mousemove", 1, 120, 100);
        assert.equal(input.getDeltaCameraX(), -20);
        mouse("mouseup", 1, 120, 100);
        assert.equal(input.isCameraDragging(), false);
    }

    console.log("right-drag-camera ok");
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
