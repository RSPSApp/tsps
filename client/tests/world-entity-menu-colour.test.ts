import assert from "node:assert/strict";
import { test } from "node:test";

import { MenuTargetType } from "../rs/MenuEntry";
import { osrsTargetLabel } from "../ui/menu/MenuBridge";

// OSRS colours a world entity's (a boat's) name pink, eda6ed, in the menu.
test("a boat's menu target is pink", () => {
    const label = osrsTargetLabel({ option: "Board", targetType: MenuTargetType.WORLD_ENTITY, targetName: "Raft", targetId: 1 } as any);
    assert.equal(label, "<col=eda6ed>Raft");
});
