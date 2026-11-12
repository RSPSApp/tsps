import assert from "node:assert/strict";

import { widgetEntriesToSimple } from "../ui/menu/MenuBridge";
import { deriveMenuEntriesForWidget, withStackedIf1ButtonEntries } from "../widgets/menu/utils";

// The tanner's interface (324) stacks four IF1 buttons over each hide: Tan All (124-131),
// Tan X (132-139), Tan 5 (140-147) and Tan 1 (148-155), later children drawn on top.
const button = (fileId: number, text: string) => ({
    uid: (324 << 16) | fileId,
    groupId: 324,
    fileId,
    isIf3: false,
    buttonType: 1,
    buttonText: text,
    actions: [text],
    flags: 0x400000 | (1 << 1),
});
const softLeather = [button(124, "Tan All"), button(132, "Tan X"), button(140, "Tan 5"), button(148, "Tan 1")];
const background = { uid: (324 << 16) | 1, groupId: 324, fileId: 1, isIf3: false, buttonType: 0 };
const hits = [background, ...softLeather]; // back to front
const tanOne = softLeather[3];
const derive = (w: any) => deriveMenuEntriesForWidget(w);

const entries = withStackedIf1ButtonEntries(tanOne, derive(tanOne), hits, derive);
assert.deepEqual(entries.map((entry) => entry.option), ["Tan 1", "Tan 5", "Tan X", "Tan All", "Cancel"],
    "every stacked button adds its option, topmost first, above Cancel");
assert.deepEqual(entries.map((entry) => entry.widget?.fileId), [undefined, 140, 132, 124, undefined],
    "added options carry the button they click");

// Buttons of another interface, IF3 components and widgets without an IF1 button add nothing.
const other = { ...button(10, "Ok"), uid: (12 << 16) | 10, groupId: 12 };
const if3 = { ...button(160, "Select"), isIf3: true };
assert.deepEqual(
    withStackedIf1ButtonEntries(tanOne, derive(tanOne), [other, if3, background, tanOne], derive).map((entry) => entry.option),
    ["Tan 1", "Cancel"],
);
// A button reached twice (the same interface mounted twice) adds its option once.
assert.deepEqual(
    withStackedIf1ButtonEntries(tanOne, derive(tanOne), [softLeather[0], ...hits], derive).map((entry) => entry.option),
    ["Tan 1", "Tan 5", "Tan X", "Tan All", "Cancel"],
);
// Only an IF1 button's menu takes stacked buttons in.
const if3Widget = { uid: (324 << 16) | 200, isIf3: true, actions: ["Open"], flags: 1 << 1 };
assert.equal(withStackedIf1ButtonEntries(if3Widget, derive(if3Widget), hits, derive).length, derive(if3Widget).length);

// Choosing a stacked option clicks its own button.
const clicked: any[] = [];
const ui: any = { onWidgetAction: (event: any) => clicked.push(event.widget.fileId) };
const menu = widgetEntriesToSimple(entries as any, { ui, chosenWidget: tanOne, scheduleRender: () => {} });
assert.deepEqual(menu.slice(0, 4).map((entry) => (entry.param1 ?? 0) & 0xffff), [148, 140, 132, 124]);
for (const entry of menu.slice(0, 4)) entry.onClick?.();
assert.deepEqual(clicked, [148, 140, 132, 124]);

console.log("if1 stacked buttons: ok");
