import assert from "node:assert/strict";
import { layoutWidgets } from "../widgets/layout/WidgetLayout";

const Layout = require("../../server/plugins/modes/pvp/PresetsWidget.PvpMode");
for (const [width, height] of [[512, 334], [960, 600]]) {
    const { widgets } = Layout.buildPresetsWidgetGroup();
    const byId = new Map<number, any>(widgets.map((widget: any) => [widget.uid, widget]));
    assert.equal(byId.size, widgets.length, "widget components do not overlap IDs");
    const root = byId.get(Layout.uid(Layout.COMPONENT.ROOT));
    layoutWidgets(root, width, height, (parent) => widgets.filter((widget: any) => widget.parentUid === parent));
    const bar = byId.get(Layout.uid(Layout.COMPONENT.TAB_BAR));
    let right = 0;
    Layout.PRESET_TABS.forEach((name: string, index: number) => {
        const button = byId.get(Layout.uid(Layout.TAB_BUTTON_START + index));
        const label = byId.get(Layout.uid(Layout.TAB_LABEL_START + index));
        const left = bar.x + button.x;
        assert.ok(left >= right, "tabs do not overlap");
        right = left + button.width;
        assert.ok(right <= root.width - 34, "tabs leave the frame close button accessible");
        assert.ok(bar.y + button.y + button.height <= 40, "tabs stay above the preset content");
        assert.equal(button.flags & 2, 2, "each tab transmits its click");
        assert.equal(button.mouseOverColor, Layout.TAB_ACTIVE_COLOUR, "hover uses the selected dark brown");
        assert.equal(button.color, index === 0 ? Layout.TAB_ACTIVE_COLOUR : Layout.TAB_COLOUR);
        assert.equal(button.textColor, button.color);
        assert.deepEqual([label.x, label.y, label.width, label.height], [button.x, button.y, button.width, button.height]);
        assert.equal(label.text, name);
    });
}
console.log("preset tab layout: fixed and resized modes passed");
