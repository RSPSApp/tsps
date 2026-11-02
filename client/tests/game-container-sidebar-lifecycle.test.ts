import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import * as React from "react";
import { createRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { useSidebarVisible } from "../game/useSubscribedGameState";
import { GameState } from "../game/login/GameState";
import { GameStateMachine } from "../game/state/GameStateMachine";

const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", {
    pretendToBeVisual: true,
    url: "http://localhost/",
});
Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    IS_REACT_ACT_ENVIRONMENT: true,
});
Object.defineProperty(globalThis, "navigator", { configurable: true, value: dom.window.navigator });

function SidebarLifecycle({ machine, hideUi }: {
    machine: GameStateMachine;
    hideUi: boolean;
}): React.ReactElement {
    const visible = useSidebarVisible(machine, hideUi);
    return React.createElement(
        React.Fragment,
        null,
        visible ? React.createElement("aside", { "data-testid": "sidebar" }) : null,
        visible ? React.createElement("button", { "data-testid": "toggle" }) : null,
    );
}

const rootNode = document.getElementById("root")!;
const root = createRoot(rootNode);
const machine = new GameStateMachine(GameState.DOWNLOADING);

assert.equal(
    renderToString(React.createElement(SidebarLifecycle, { machine, hideUi: false })),
    "",
    "server rendering hides the sidebar before login",
);
assert.equal(machine.getListenerCount(), 0, "server rendering does not subscribe");

void (async () => {
    await React.act(async () => {
        root.render(React.createElement(SidebarLifecycle, { machine, hideUi: false }));
    });
    assert.equal(rootNode.querySelector("[data-testid=sidebar]"), null, "downloading hides sidebar");
    assert.equal(machine.getListenerCount(), 1, "mounted component subscribes to game state");

    await React.act(async () => {
        machine.transition(GameState.LOADING);
        machine.transition(GameState.LOGIN_SCREEN);
    });
    assert.ok(rootNode.querySelector("[data-testid=sidebar]"), "login state mounts sidebar");
    assert.ok(rootNode.querySelector("[data-testid=toggle]"), "login state mounts toggle");

    for (const next of [GameState.CONNECTING, GameState.LOADING_GAME, GameState.LOGGED_IN]) {
        await React.act(async () => machine.transition(next));
        assert.ok(rootNode.querySelector("[data-testid=sidebar]"), `${GameState[next]} keeps sidebar mounted`);
        assert.ok(rootNode.querySelector("[data-testid=toggle]"), `${GameState[next]} keeps toggle mounted`);
    }

    await React.act(async () => {
        root.render(React.createElement(SidebarLifecycle, { machine, hideUi: true }));
    });
    assert.equal(rootNode.querySelector("[data-testid=sidebar]"), null, "hideUi hides sidebar");
    assert.equal(rootNode.querySelector("[data-testid=toggle]"), null, "hideUi hides toggle");

    const replacement = new GameStateMachine(GameState.LOGIN_SCREEN);
    await React.act(async () => {
        root.render(React.createElement(SidebarLifecycle, { machine: replacement, hideUi: false }));
    });
    assert.equal(machine.getListenerCount(), 0, "replacing the state machine unsubscribes the old one");
    assert.equal(replacement.getListenerCount(), 1, "replacing the state machine subscribes to the new one");
    assert.ok(rootNode.querySelector("[data-testid=sidebar]"), "replacement snapshot controls visibility");

    await React.act(async () => root.unmount());
    assert.equal(replacement.getListenerCount(), 0, "unmount releases the game-state subscription");
})();
