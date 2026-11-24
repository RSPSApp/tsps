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
// Document listeners are kept, so the grab that catches releases outside the canvas can be checked.
const docListeners = new Map<string, (event: any) => void>();
(globalThis as any).document = {
    addEventListener: (name: string, callback: (event: any) => void) => docListeners.set(name, callback),
    removeEventListener: (name: string, callback: (event: any) => void) => {
        if (docListeners.get(name) === callback) docListeners.delete(name);
    },
};
const outside = {}; // a page element that isn't the canvas

async function main() {
    const { ClickMode, InputManager } = await import("../game/InputManager");

    // `buttons` is what the browser reports held during the event (right = 2).
    const held = (button: number) => (button === 0 ? 1 : button === 1 ? 4 : 2);
    function event(type: string, button: number, x: number, y: number, buttons: number, target: unknown) {
        return { type, button, buttons, clientX: x, clientY: y, target, shiftKey: false, preventDefault: noop };
    }
    function mouse(type: string, button: number, x: number, y: number, buttons = type === "mouseup" ? 0 : held(button)) {
        const e = event(type, button, x, y, buttons, canvas);
        docListeners.get(type)?.(e); // capture-phase document listeners see it first
        listeners.get(type)!(e);
    }
    /** A release or move over another page element: only the document grab sees it. */
    function outsideMouse(type: string, button: number, x: number, y: number, buttons: number) {
        docListeners.get(type)?.(event(type, button, x, y, buttons, outside));
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

    // Review of #6070, finding 1: focus loss ends a pending press and a drag.
    {
        const { input, presses } = setup(true);
        mouse("mousedown", 2, 100, 100);
        listeners.get("focusout")!({});
        outsideMouse("mouseup", 2, 100, 100, 0); // the release lands elsewhere, unseen
        mouse("mousemove", 0, 160, 100, 0); // back over the canvas, no button held
        assert.equal(input.isCameraDragging(), false, "a stale press doesn't start a drag on hover");
        assert.equal(input.getDeltaCameraX(), 0);
        assert.deepEqual(presses, [], "and doesn't play as a click");

        mouse("mousedown", 2, 100, 100);
        mouse("mousemove", 2, 130, 100);
        assert.equal(input.isCameraDragging(), true);
        input.consumeCameraDrag();
        listeners.get("focusout")!({});
        assert.equal(input.isCameraDragging(), false, "focus loss ends a drag");
        mouse("mousemove", 0, 170, 100, 0);
        assert.equal(input.getDeltaCameraX(), 0);
    }

    // Finding 1: turning the option off while a press is held back cancels it.
    {
        const { input, presses } = setup(true);
        mouse("mousedown", 2, 100, 100);
        input.rightDragCamera = false;
        mouse("mousemove", 2, 160, 100);
        assert.equal(input.isCameraDragging(), false, "no drag once the option is off");
        assert.equal(input.getDeltaCameraX(), 0);
        mouse("mouseup", 2, 160, 100);
        assert.deepEqual(presses, [], "the cancelled press doesn't play either");
        assert.equal(docListeners.size, 0, "the grab is gone");

        input.rightDragCamera = true;
        mouse("mousedown", 2, 100, 100);
        mouse("mousemove", 2, 130, 100);
        input.rightDragCamera = false;
        assert.equal(input.isCameraDragging(), false, "turning it off ends a drag in progress");
        mouse("mouseup", 2, 130, 100);
    }

    // Finding 1: a move with the right button up means its release was missed: the drag ends.
    {
        const { input } = setup(true);
        mouse("mousedown", 2, 100, 100);
        mouse("mousemove", 2, 130, 100);
        input.consumeCameraDrag();
        mouse("mousemove", 0, 160, 100, 0);
        assert.equal(input.isCameraDragging(), false);
        assert.equal(input.getDeltaCameraX(), 0, "hovering doesn't turn the camera");
    }

    // Finding 2: a left click mid right-drag keeps the grab, so a right release outside is caught.
    {
        const { input } = setup(true);
        mouse("mousedown", 2, 100, 100);
        mouse("mousemove", 2, 130, 100);
        mouse("mousedown", 0, 130, 100, 3);
        mouse("mouseup", 0, 130, 100, 2);
        assert.ok(docListeners.has("mouseup"), "the grab outlives the left release");
        assert.equal(input.isCameraDragging(), true);
        outsideMouse("mouseup", 0, 700, 100, 2); // a stray left release outside doesn't end it
        assert.ok(docListeners.has("mouseup"));
        assert.equal(input.isCameraDragging(), true);
        outsideMouse("mouseup", 2, 700, 100, 0);
        assert.equal(input.isCameraDragging(), false, "the right release outside ends the drag");
        assert.equal(docListeners.size, 0);
        input.consumeCameraDrag();
        mouse("mousemove", 0, 160, 100, 0);
        assert.equal(input.getDeltaCameraX(), 0, "coming back without a button doesn't turn the camera");
    }

    // Moves outside the canvas (another page element, or past the browser window) keep turning
    // the camera while its button is held, like a drag on the world map keeps moving it.
    {
        const { input } = setup(false);
        mouse("mousedown", 1, 600, 100);
        mouse("mousemove", 1, 630, 100);
        assert.equal(input.getDeltaCameraX(), -30);
        outsideMouse("mousemove", 1, 700, 100, 4);
        assert.equal(input.getDeltaCameraX(), -100, "the middle drag keeps turning past the edge");
        outsideMouse("mousemove", 1, 900, 80, 4);
        assert.deepEqual([input.getDeltaCameraX(), input.getDeltaCameraY()], [-300, 20]);
        input.consumeCameraDrag();
        mouse("mousemove", 1, 880, 80); // back over the canvas: measured from the last outside move
        assert.equal(input.getDeltaCameraX(), 20);
        outsideMouse("mouseup", 1, 880, 80, 0);
        assert.equal(input.isCameraDragging(), false);
        input.consumeCameraDrag();
        outsideMouse("mousemove", 0, 950, 80, 0);
        assert.equal(input.getDeltaCameraX(), 0, "no grab after the release");
    }
    {
        const { input } = setup(true);
        mouse("mousedown", 2, 600, 100);
        outsideMouse("mousemove", 2, 700, 100, 2); // leaves the canvas before the threshold
        assert.equal(input.isCameraDragging(), true, "a right press that leaves the canvas drags");
        assert.equal(input.getDeltaCameraX(), -100);
        outsideMouse("mousemove", 2, 750, 100, 2);
        assert.equal(input.getDeltaCameraX(), -150);
        outsideMouse("mouseup", 2, 750, 100, 0);
        assert.equal(input.isCameraDragging(), false);
    }

    // Review of #6755: frames ending mid-drag, with the cursor outside, don't move the origin
    // (mouseX is clamped to the edge outside the canvas, and -1 just after it leaves).
    {
        const { input } = setup(false);
        const frame = () => { input.consumeCameraDrag(); input.onFrameEnd(); };
        mouse("mousedown", 1, 630, 100);
        frame();
        listeners.get("mouseleave")!({});
        frame();
        outsideMouse("mousemove", 1, 650, 100, 4);
        assert.equal(input.getDeltaCameraX(), -20, "the first move after leaving measures from the press");
        for (const x of [651, 652, 653]) {
            frame();
            outsideMouse("mousemove", 1, x, 100, 4);
            assert.equal(input.getDeltaCameraX(), -1, "one pixel per frame turns one pixel");
        }
        frame();
        mouse("mousemove", 1, 630, 100);
        assert.equal(input.getDeltaCameraX(), 23, "coming back measures from the last outside move");
        mouse("mouseup", 1, 630, 100);
    }

    console.log("right-drag-camera ok");
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
