import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ConfigManager } from "@runelite/client/config/ConfigManager";
import { CameraConfig } from "../game/plugins/camera/CameraConfig";
import { ControlsHelp } from "../game/controls/ControlsHelp";
import { processWidgetScrollWheelInput } from "../game/widgets/input/widgetScrollWheelInput";
import { buildWidgetInputFrame } from "../game/widgets/input/widgetInputSetup";
import { InputManager } from "../game/InputManager";

let invoked: number[] = [];
const deps: any = { getCs2Vm: () => ({ invokeEventHandler: (widget: any) => invoked.push(widget.uid) }), executeScriptListener: (widget: any) => invoked.push(widget.uid) };
const manager: any = { isEffectivelyHidden: (uid: number) => uid === 99 };
const viewport = { uid: 1, type: 0, eventHandlers: { onScroll: { scriptId: 39 } } };
const scroll = (hits: any[]) => {
    invoked = [];
    const frame: any = { input: { wheelDeltaY: 120 }, mx: 20, hits };
    processWidgetScrollWheelInput(deps, frame, manager, { isDraggingWidget: false } as any);
    return frame.input.wheelDeltaY;
};
const settings = { uid: 2, type: 0, isIf3: true, noScrollThrough: true, eventHandlers: { onScroll: { scriptId: 36 } } };
assert.equal(scroll([viewport, settings]), 0);
assert.deepEqual(invoked, [2], "foreground native scroll blocker runs its OWN scrollbar listener");
assert.equal(scroll([viewport, { uid: 3, type: 0, isIf3: true, noScrollThrough: true }]), 0, "blank blocker consumes camera wheel");
assert.deepEqual(invoked, [], "viewport zoom never runs behind settings");
assert.equal(scroll([viewport, { uid: 99, noScrollThrough: true }]), 0);
assert.deepEqual(invoked, [1], "hidden blocker does not steal scroll");
assert.equal(scroll([{ uid: 4, type: 0 }]), 120, "listener-only transparent layer preserves free camera wheel");
assert.equal(scroll([viewport]), 0); assert.deepEqual(invoked, [1], "native viewport zoom script still runs");
assert.equal(scroll([{ uid: 5, type: 0, isIf3: true, noScrollThrough: true, onScroll: [36, 10, 5] }]), 0);
assert.deepEqual(invoked, [5], "raw cache listener also runs on its owning blocker");

// A modal can open beneath a stationary pointer. Wheel must pick the current tree,
// rather than the cached viewport hit collected before Settings opened.
const modal = { ...settings, x: 0, y: 0, width: 200, height: 200, noClickThrough: true };
const pickingManager: any = { getInputRoots: () => [modal], getStaticChildrenByParentUid: () => [], interfaceParents: new Map(), getWidgetFlags: () => 0 };
const pickingState: any = { lastHoverHitX: 20, lastHoverHitY: 20, cachedHoverHits: [viewport] };
const picked = buildWidgetInputFrame({} as any, pickingState, { mouseX: 20, mouseY: 20, wheelDeltaY: 120 } as any, pickingManager, {} as any)!;
assert.ok(picked.hits.includes(modal), "wheel repicks a newly opened Settings modal at an unchanged pointer position");

const input = new InputManager();
input.viewportWheelDeltaY = 120; input.wheelDeltaY = 120;
input.onFrameStart();
assert.equal(input.viewportWheelDeltaY, 0, "viewport grant is local to the current UI dispatch");
assert.equal(input.wheelDeltaY, 120, "incoming wheel survives frame start for UI ownership");
input.viewportWheelDeltaY = 120; input.onFrameEnd();
assert.equal(input.viewportWheelDeltaY, 0, "viewport grant cannot leak into a later frame");
input.element = { width: 800, height: 400, getBoundingClientRect: () => ({ left: 10, top: 20, width: 400, height: 200 }) } as any;
input.isPointerLock = () => false;
input.mouseX = 40; input.mouseY = 50;
input.setInteractionPointerOverride(40, 50, true);
(input as any).onWheel({ clientX: 210, clientY: 120, deltaY: 120, preventDefault() {} });
assert.deepEqual([input.mouseX, input.mouseY], [400, 200], "stationary wheel targets the physical cursor, not the close-camera keyboard selection");
input.isPointerLock = () => true;
input.mouseX = 40; input.mouseY = 50;
(input as any).onWheel({ clientX: 210, clientY: 120, deltaY: 120, preventDefault() {} });
assert.deepEqual([input.mouseX, input.mouseY], [40, 50], "captured mouse look keeps its world interaction pointer");

const config = new ConfigManager(undefined);
const props = { configManager: config, closeCameraActive: true, onExitCloseCamera() {} };
let markup = renderToStaticMarkup(React.createElement(ControlsHelp, props));
assert.match(markup, /Controls/);
assert.match(markup, /Exit close camera/);
assert.match(markup, /aria-expanded="false"/);
config.setConfigValue(CameraConfig, "controlsExpanded", true);
markup = renderToStaticMarkup(React.createElement(ControlsHelp, props));
assert.match(markup, /aria-expanded="true"/);
assert.match(markup, /Backquote/);
assert.match(markup, /above Tab/);
assert.match(markup, /Tab/);
assert.match(markup, /WASD/);
assert.match(markup, /Settings/);
console.log("settings wheel and controls tests passed");
