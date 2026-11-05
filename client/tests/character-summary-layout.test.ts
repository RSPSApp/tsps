import assert from "node:assert/strict";
import { layoutWidgets } from "../widgets/layout/WidgetLayout";
import { setCustomInterface } from "../common/gamemode/GamemodeContentStore";
import { WidgetLoader } from "../widgets/WidgetLoader";
import { WidgetManager } from "../widgets/WidgetManager";
import { FONT_BOLD_12, FONT_PLAIN_11 } from "../ui/fonts";

const Layout = require("../../server/plugins/interface/sidejournaldefaults/Layout.SideJournalDefaults");
setCustomInterface(Layout.DEFINITION);

for (const [width, height] of [[180, 261], [184, 261], [190, 261], [190, 399], [212, 350]]) {
    const cache = { getIndex: () => undefined } as never;
    const manager = new WidgetManager(cache, new WidgetLoader(cache));
    const group = manager.getGroup(Layout.GROUP_ID)!;
    assert.ok(group, "the actual client loader accepts the definition");
    const byId = group.widgetsByUid;
    const widgets = Array.from(byId.values());
    const root = group.root;
    layoutWidgets(root, width, height, parent => widgets.filter((widget: any) => widget.parentUid === parent));
    assert.equal(byId.size, widgets.length);
    assert.equal(root.width, width);
    assert.equal(root.height, height);
    let right = 0;
    const drawOrder = manager.getStaticChildrenByParentUid(root.uid);
    for (const component of [Layout.COMPONENT.TELEPORTS, Layout.COMPONENT.PRESETS, Layout.COMPONENT.COMMANDS, Layout.COMPONENT.XP]) {
        const button = byId.get(Layout.uid(component));
        const label = byId.get(Layout.uid(component + 10));
        const border = byId.get(Layout.uid(component + 6));
        assert.ok(button && label && border);
        assert.equal(button.type, 3, "the button background is a rectangle");
        assert.equal(label.type, 4, "dynamic button text targets a text widget");
        assert.ok(drawOrder.indexOf(label) > drawOrder.indexOf(button), "button text draws above its background");
        assert.equal(border.type, 3);
        assert.equal(border.filled, false, "the button has a visible outline");
        assert.notEqual(border.color, button.color);
        assert.deepEqual([border.x, border.y, border.width, border.height], [button.x, button.y, button.width, button.height]);
        assert.ok(drawOrder.indexOf(border) > drawOrder.indexOf(button));
        assert.ok(drawOrder.indexOf(label) > drawOrder.indexOf(border), "labels remain clickable above the decorative border");
        assert.ok(button.x >= 0 && button.x + button.width <= width, "buttons fit within the sidebar");
        assert.deepEqual([label.x, label.y, label.width, label.height], [button.x, button.y, button.width, button.height]);
        assert.equal(button.flags & 2, 2);
        assert.equal(label.flags & 2, 2);
        if (component !== Layout.COMPONENT.XP) {
            assert.ok(button.x >= right, "navigation buttons do not overlap");
            right = button.x + button.width;
        }
    }
    assert.match(byId.get(Layout.uid(Layout.COMPONENT.XP + 10))?.text ?? "", /Combat XP:.*On/, "the toggle has a label before its first socket update");
    const view = byId.get(Layout.uid(Layout.COMPONENT.VIEW));
    const scrollbar = byId.get(Layout.uid(Layout.COMPONENT.SCROLLBAR));
    assert.ok(view && scrollbar);
    assert.ok(view.x + view.width <= scrollbar.x);
    assert.equal(view.y, scrollbar.y);
    assert.equal(view.height, scrollbar.height);
    assert.ok(view.y + view.height <= height);
    assert.ok(Layout.DEFINITION.scroll[0].contentHeight > view.height);
    for (const row of Layout.ROWS) {
        const widget = byId.get(Layout.uid(row.component));
        assert.ok(widget);
        assert.equal(widget.fontId, FONT_PLAIN_11, `${row.label} uses the normal body font`);
        assert.ok(widget.y + widget.height <= Layout.DEFINITION.scroll[0].contentHeight);
        assert.equal(widget.width, view.width, "rows wrap within the scroll view");
    }
}

// Real widget alignment, including each host/per-player restriction combination.
for (const [width, height] of [[180, 261], [184, 261], [190, 399], [212, 350]]) {
    for (let mask = 0; mask < 16; mask++) {
        const commands = new Set<string>(Layout.BUTTONS.filter((_: unknown, index: number) => mask & (1 << index)).map((button: any) => button.command));
        const cache = { getIndex: () => undefined } as never;
        const manager = new WidgetManager(cache, new WidgetLoader(cache));
        const group = manager.getGroup(Layout.GROUP_ID)!;
        const widgets = Array.from(group.widgetsByUid.values());
        for (const button of Layout.BUTTONS) {
            for (const offset of [0, 6, 10]) group.widgetsByFileId.get(button.component + offset)!.isHidden = !commands.has(button.command);
        }
        for (const { component, x, y } of Layout.buttonPositions(commands)) {
            for (const offset of [0, 6, 10]) {
                const widget = group.widgetsByFileId.get(component + offset)!;
                widget.rawX = x; widget.rawY = y;
            }
        }
        layoutWidgets(group.root, width, height, parent => widgets.filter(widget => widget.parentUid === parent));
        const visible = Layout.BUTTONS.filter((button: any) => button.event && commands.has(button.command))
            .map((button: any) => group.widgetsByFileId.get(button.component)!);
        if (visible.length) {
            assert.ok(Math.abs(visible[0].x - (width - visible.at(-1)!.x - visible.at(-1)!.width)) <= 1, "equal outer margins");
            for (let index = 0; index < visible.length; index++) {
                const widget = visible[index];
                assert.equal(widget.width, 56);
                assert.ok(widget.x >= 0 && widget.x + widget.width <= width);
                if (index) assert.equal(widget.x - visible[index - 1].x - visible[index - 1].width, 4, "uniform gaps");
            }
        }
    }
}

// A reconnect can keep a previously loaded group even after the server's definition changes.
const oldGroupId = 30012;
const oldDefinition = structuredClone(Layout.DEFINITION);
oldDefinition.groupId = oldGroupId;
for (const widget of oldDefinition.widgets) {
    widget.groupId = oldGroupId;
    widget.uid = widget.id = (oldGroupId << 16) | widget.fileId;
    if (widget.parentUid >= 0) widget.parentUid = (oldGroupId << 16) | (widget.parentUid & 0xffff);
}
const botRow = Layout.ROWS.find((row: any) => row.key === "botKillstreak");
oldDefinition.widgets.find((widget: any) => widget.fileId === botRow.component).fontId = FONT_BOLD_12;
setCustomInterface(oldDefinition);
const cache = { getIndex: () => undefined } as never;
const manager = new WidgetManager(cache, new WidgetLoader(cache));
assert.ok(manager.getGroup(oldGroupId));
setCustomInterface(Layout.DEFINITION);
const current = manager.getGroup(Layout.GROUP_ID)!;
assert.equal(current.widgetsByFileId.get(botRow.component)?.fontId, FONT_PLAIN_11,
    "the updated layout cannot reuse a cached section-heading font for Bot Killstreak");
console.log("character summary layout: all feature combinations, fixed, resized and wider sidebars passed");
