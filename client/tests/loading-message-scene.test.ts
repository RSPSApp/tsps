import "./browser-self";
import assert from "node:assert/strict";
import { test } from "node:test";

import { GameState } from "../game/login";
import { LoadingMessageOverlay } from "../ui/devoverlay/LoadingMessageOverlay";

// Enough of a 2D context for the overlay to render its box: every call is recorded.
function recordingContext(calls: string[]): any {
    return new Proxy({}, {
        get: (_target, key) => key === "measureText"
            ? () => ({ width: 100 })
            : key === "canvas" ? { width: 765, height: 503 } : (...args: unknown[]) => calls.push(`${String(key)}`),
        set: () => true,
    });
}

(globalThis as any).document ??= {
    createElement: () => ({ width: 0, height: 0, getContext: () => recordingContext([]) }),
};

function overlay(sceneLoading: () => boolean) {
    const machine: any = { getState: () => GameState.LOGGED_IN, subscribe: () => () => {} };
    const loading = new LoadingMessageOverlay(machine);
    loading.setSceneLoadingSource(sceneLoading);
    return loading;
}

const at = (time: number): any => ({ time, delta: 16, resolution: { width: 765, height: 503 }, state: {}, helpers: {} });

test("a scene still loading in game shows the box over the game, once it lasts (issue #1858)", () => {
    let loading = true;
    const box = overlay(() => loading);
    box.update(at(1000));
    assert.equal(box.isVisible(), false, "a load shorter than a moment doesn't flicker the box");
    box.update(at(1200));
    assert.equal(box.isVisible(), true);
    const calls: string[] = [];
    box.drawTo2D(recordingContext(calls));
    assert.deepEqual(calls.filter((call) => call !== "save" && call !== "restore"), ["drawImage"],
        "the box alone: the login screen's black cover stays off the game");
    loading = false;
    box.update(at(1300));
    assert.equal(box.isVisible(), false);
});
