import assert from "node:assert/strict";
import { test } from "node:test";

import { createCacheVm } from "../scripts/cache/cs2-sweep";

// "Enable Minimap zoom" (row 166) is ticked while varbit 12983 is 0. Clicking the row runs the
// settings toggle (3965), which runs 5190; "Restore Minimap zoom" (row 167) runs 7028.
const SETTINGS_TOGGLE = 3965, RESTORE_ZOOM = 7028;
const ENABLE_MINIMAP_ZOOM = 166, LOCK_DISABLED = 12983;

function minimap() {
    const { vm } = createCacheVm();
    const zoomable: boolean[] = [];
    const zooms: number[] = [];
    // As the game client: the toplevel layout makes a ticked minimap zoomable, and a zoom set
    // while it isn't is ignored.
    let enabled = true;
    vm.context.setMinimapZoomable = (value: boolean) => { enabled = value; zoomable.push(value); };
    vm.context.setMinimapZoom = (zoom: number) => { if (enabled) zooms.push(zoom); };
    const varbit = () => vm.context.varManager.getVarbit(LOCK_DISABLED);
    const click = () => vm.run(vm.context.loadScript(SETTINGS_TOGGLE), [ENABLE_MINIMAP_ZOOM], []);
    const restore = () => vm.run(vm.context.loadScript(RESTORE_ZOOM), [], []);
    return { vm, zoomable, zooms, varbit, click, restore };
}

test("unticking Enable Minimap zoom locks the minimap zoom", () => {
    const m = minimap();
    assert.equal(m.varbit(), 0, "a new player starts ticked");
    m.click();
    assert.equal(m.varbit(), 1);
    assert.deepEqual(m.zoomable, [false]);
});

test("ticking it again lets the minimap zoom", () => {
    const m = minimap();
    m.vm.context.varManager.setVarbit(LOCK_DISABLED, 1);
    m.click();
    assert.equal(m.varbit(), 0);
    assert.deepEqual(m.zoomable, [true]);
});

test("Restore Minimap zoom resets the zoom only while the box is ticked", () => {
    const m = minimap();
    m.restore();
    assert.deepEqual(m.zooms, [4]);
    m.click();
    m.restore();
    assert.deepEqual(m.zooms, [4], "unticked: the zoom is locked, nothing to restore");
    m.click();
    m.restore();
    assert.deepEqual(m.zooms, [4, 4], "ticked again: Restore works");
});
