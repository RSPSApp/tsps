import assert from "node:assert/strict";
import { test } from "node:test";

import { rectangleAlphas } from "../widgets/gl/widgetsGl/rectFill";

// OSRS rectangle fill modes: a plain gradient ignores transparency, an alpha gradient fades its
// two edges independently (so a top of 255 is a fade-in, not an invisible rectangle), and a
// solid fill or outline takes one alpha.
test("a plain gradient is solid whatever the transparency", () => {
    assert.deepEqual(rectangleAlphas(true, 1, 128, undefined), { draw: true, top: 255, bottom: 255 });
    assert.deepEqual(rectangleAlphas(true, 1, 255, undefined), { draw: true, top: 255, bottom: 255 });
});

test("an alpha gradient fades each edge on its own", () => {
    assert.deepEqual(rectangleAlphas(true, 2, 255, 0), { draw: true, top: 0, bottom: 255 });
    assert.deepEqual(rectangleAlphas(true, 2, 0, 200), { draw: true, top: 255, bottom: 55 });
    assert.deepEqual(rectangleAlphas(true, 2, 100, undefined), { draw: true, top: 155, bottom: 255 }, "the bottom is opaque unless set");
});

test("a solid fill or an outline takes the transparency, and vanishes at 255", () => {
    assert.deepEqual(rectangleAlphas(true, 0, 55, undefined), { draw: true, top: 200, bottom: 200 });
    assert.deepEqual(rectangleAlphas(false, 2, 55, 0), { draw: true, top: 200, bottom: 200 }, "an outline has no fill mode");
    assert.equal(rectangleAlphas(true, 0, 255, undefined).draw, false);
});

test("the bottom transparency can be read back (1610 / 2610)", async () => {
    const { createHandlerMap } = await import("../rs/cs2/handlers");
    const handlers = createHandlerMap();
    const widget: any = { uid: 5, transparencyBot: 90 };
    const out: number[] = [];
    handlers.get(1610)!({ activeWidget: widget, pushInt: (v: number) => out.push(v) } as any, 0, null as any);
    handlers.get(2610)!({ intStack: [5], intStackSize: 1, pushInt: (v: number) => out.push(v),
        widgetManager: { getWidgetByUid: () => widget, getGroup: () => ({}) } } as any, 0, null as any);
    assert.deepEqual(out, [90, 90]);
});
