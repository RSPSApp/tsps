import assert from "node:assert/strict";
import { SpellSelectionController, spellWidgetChildSlot } from "../game/widgets/SpellSelectionController";
import { ClickRegistry } from "../widgets/gl/click-registry";

// Tapping High or Low Level Alchemy on mobile selects that spell (#1696). A tap selects through
// the direct press path, which once passed the component id as a child slot. In the mobile
// layout the spellbook also fills a dynamic list (218:201), and the selection read that list's
// slot instead: High Level Alchemy (218:47) became Wind Wave (218:58), Low Level Alchemy (218:24)
// Wind Blast (218:35). The server got Wind Wave on an inventory item and did nothing.
{
    const { createCacheVm } = require("../scripts/cache/cs2-sweep");
    const { vm: cacheVm } = createCacheVm();
    const wm = cacheVm.context.widgetManager;
    wm.rootInterface = 601; // toplevel_osm, the mobile layout
    wm.onLoadListener = (_id: number, widget: any) => cacheVm.runScriptEvent({ args: widget.onLoad, widget });
    wm.getGroup(218);
    const spellbook = wm.getWidgetByUid(218 << 16);
    cacheVm.context.varManager.setVarbit(4070, 0);
    cacheVm.runScriptEvent({ args: spellbook.onLoad, widget: spellbook });
    assert.ok(wm.getWidgetByUid((218 << 16) | 201)?.children?.[47], "the mobile spellbook fills its list");

    const controller = new SpellSelectionController({
        getWidgetManager: () => wm,
        getObjTypeLoader: () => cacheVm.context.objTypeLoader,
        getCs2Vm: () => cacheVm,
        executeScriptListener: () => {},
    });
    for (const [name, child] of [["Low Level Alchemy", 24], ["High Level Alchemy", 47]] as const) {
        const spell = wm.getWidgetByUid((218 << 16) | child);
        assert.equal(spellWidgetChildSlot(spell), -1, `${name} is a static component`);
        const selection = controller.resolveSpellSelectionFromWidget(spell, spell.uid, spellWidgetChildSlot(spell), -1);
        assert.equal(selection.widgetId, spell.uid, `${name} selects itself`);
    }
}

// Selecting a spell happens on the press, which the widget click path consumes before the UI
// click registry sees it. The release then landed on an op-less panel (601:134) that, with a
// spell now selected, cancels the selection on click: the spell was dropped on the same tap.
{
    const clicks = new ClickRegistry();
    let cancels = 0;
    clicks.register({
        id: "widget:panel",
        rect: { x: 0, y: 0, w: 100, h: 100 },
        onClick: () => cancels++,
        requiresPress: true,
    });
    assert.equal(clicks.onPointerUp(10, 10), false, "a release without its press clicks nothing");
    assert.equal(cancels, 0);

    assert.equal(clicks.onPointerDown(10, 10), true);
    assert.equal(clicks.onPointerUp(10, 10), true, "a tap on the panel still cancels");
    assert.equal(cancels, 1);
}

console.log("Spell selection tap regression passed");
