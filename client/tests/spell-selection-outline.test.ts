import assert from "node:assert/strict";
import { ClientState } from "../game/ClientState";
import { SpellSelectionController } from "../game/widgets/SpellSelectionController";
import { menuAction, setSpellSelectionClearHandler } from "../ui/menu/MenuAction";
import { MenuOpcode } from "../ui/menu/MenuState";
import { CANCEL_SELECTION_HANDLER } from "../widgets/gl/widgetsGl/constants";

// Spam-clicking between Ancient spells left several outlined (#2052). A selected spell's
// onTargetEnter (script 2617) outlines it and its onTargetLeave takes the outline off. A click on
// an op-less widget, such as the gap between two spells, cancels the selection, and that cancel
// cleared the client's state without running onTargetLeave: the spell kept its outline, and the
// next selection had no source widget left to take it off. OSRS clears every selection through
// clearWidgetSelection, which runs onTargetLeave first.
const { createCacheVm } = require("../scripts/cache/cs2-sweep");
const { vm: cacheVm } = createCacheVm();
const wm = cacheVm.context.widgetManager;
wm.rootInterface = 161;
wm.onLoadListener = (_id: number, widget: any) => cacheVm.runScriptEvent({ args: widget.onLoad, widget });
wm.getGroup(218);
const spellbook = wm.getWidgetByUid(218 << 16);
cacheVm.context.varManager.setVarbit(4070, 1); // Ancient Magicks
cacheVm.runScriptEvent({ args: spellbook.onLoad, widget: spellbook });

const controller = new SpellSelectionController({
    getWidgetManager: () => wm,
    getObjTypeLoader: () => cacheVm.context.objTypeLoader,
    getCs2Vm: () => cacheVm,
    executeScriptListener: (widget, args) => cacheVm.runScriptEvent({ args, widget }),
});
setSpellSelectionClearHandler(() => controller.clearSelectedSpell());

const iceRush = wm.getWidgetByUid((218 << 16) | 84);
const smokeRush = wm.getWidgetByUid((218 << 16) | 92);
const look = (w: any) => w.borderType | 0;
const iceRushIdle = look(iceRush);
const smokeRushIdle = look(smokeRush);

const select = (spell: any) =>
    controller.setSelectedSpell({ spellId: spell.uid & 0xffff, spellName: spell.opBase ?? "" }, spell);

select(iceRush);
assert.notEqual(look(iceRush), iceRushIdle, "selecting Ice Rush outlines it");

CANCEL_SELECTION_HANDLER();
assert.equal(ClientState.isSpellSelected, false);
assert.equal(look(iceRush), iceRushIdle, "a cancel click takes Ice Rush's outline off");

select(smokeRush);
select(iceRush);
assert.equal(look(smokeRush), smokeRushIdle, "selecting another spell takes the old outline off");

// Closing an interface through the menu clears the selection the same way.
menuAction(0, 0, MenuOpcode.WidgetClose, 0, -1, "Close", "", 0, 0);
assert.equal(ClientState.isSpellSelected, false);
assert.equal(look(iceRush), iceRushIdle, "closing an interface takes the outline off");

console.log("Spell selection outline regression passed");
