import assert from "node:assert/strict";
import { test } from "node:test";
import React, { act } from "react";
import { JSDOM } from "jsdom";
import { ConfigManager } from "@runelite/client/config/ConfigManager";
import { PluginInjector, CLIENT_TOKEN } from "@runelite/client/plugins/PluginInjector";
import { ClientToolbar } from "@runelite/client/ui/ClientToolbar";
import { InventoryTagsPlugin, type InventoryTagGroup } from "../game/plugins/inventorytags/InventoryTagsPlugin";
import { InventoryTagsPanel } from "../game/plugins/inventorytags/InventoryTagsPanel";

const groups: InventoryTagGroup[] = [
    { name: "A", color: "#ff0000", itemIds: [4151] },
    { name: "B", color: "#0000ff", itemIds: [4151] },
    { name: "C", color: "#00ff00", itemIds: [11840] },
];

async function main() {
    const dom = new JSDOM("<!doctype html><div id='root'></div>", { url: "http://localhost" });
    Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
    const { createRoot } = await import("react-dom/client");
    async function editor(run: (plugin: InventoryTagsPlugin, host: HTMLElement) => Promise<void>) {
        const config = new ConfigManager();
        const injector = new PluginInjector(config).provide(ConfigManager, config)
            .provide(ClientToolbar, new ClientToolbar()).provide(CLIENT_TOKEN, {});
        const plugin = injector.runWith(() => new InventoryTagsPlugin());
        plugin.setGroups(groups);
        const host = document.getElementById("root")!;
        const root = createRoot(host);
        await act(async () => root.render(React.createElement(InventoryTagsPanel, { plugin })));
        try { await run(plugin, host); }
        finally { await act(async () => root.unmount()); config.destroy(); }
    }
    const edit = async (host: HTMLElement, index: number) => {
        await act(async () => (host.querySelectorAll("section")[index].querySelector("button") as HTMLButtonElement).click());
    };
    const remove = async (host: HTMLElement, name: string) => {
        await act(async () => (host.querySelector(`[aria-label="Remove ${name}"]`) as HTMLButtonElement).click());
    };
    const save = async (host: HTMLElement) => {
        await act(async () => host.querySelector("form")!.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true })));
    };
    const enter = async (host: HTMLElement, label: string, value: string) => {
        const input = host.querySelector(`[aria-label="${label}"]`) as HTMLInputElement | HTMLTextAreaElement;
        const prototype = input.tagName === "TEXTAREA" ? dom.window.HTMLTextAreaElement.prototype : dom.window.HTMLInputElement.prototype;
        await act(async () => {
            Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(input, value);
            input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
        });
    };

    await test("saving an unchanged edit preserves first-match tag priority", () => editor(async (plugin, host) => {
        await edit(host, 0); await save(host);
        assert.deepEqual(plugin.getGroups(), groups);
        assert.equal(plugin.colorForItem(4151), 0xff0000);
    }));
    await test("removing an earlier group preserves the edit target and unrelated groups", () => editor(async (plugin, host) => {
        await edit(host, 1); await remove(host, "A"); await save(host);
        assert.deepEqual(plugin.getGroups(), groups.slice(1));
    }));
    await test("saving changed names and item IDs replaces only the edited slot", () => editor(async (plugin, host) => {
        await edit(host, 1);
        await enter(host, "Group name", "Equipment");
        await enter(host, "Item IDs", "11840, 11802");
        await save(host);
        assert.deepEqual(plugin.getGroups(), [groups[0], { ...groups[1], name: "Equipment", itemIds: [11840, 11802] }, groups[2]]);
        assert.equal(plugin.colorForItem(4151), 0xff0000);
        assert.equal(plugin.colorForItem(11840), 0x0000ff);
    }));
    await test("invalid edited item IDs leave saved groups intact and retain the draft", () => editor(async (plugin, host) => {
        await edit(host, 1);
        await enter(host, "Item IDs", "-1");
        await save(host);
        assert.deepEqual(plugin.getGroups(), groups);
        assert.match(host.querySelector('[role="alert"]')?.textContent ?? "", /positive integer/i);
        assert.equal((host.querySelector('[aria-label="Item IDs"]') as HTMLTextAreaElement).value, "-1");
        assert.equal((host.querySelector('[aria-label="Group name"]') as HTMLInputElement).value, "B");
    }));
    await test("removing the edited group clears the form without replacing its neighbour", () => editor(async (plugin, host) => {
        await edit(host, 1); await remove(host, "B");
        assert.equal((host.querySelector('[aria-label="Group name"]') as HTMLInputElement).value, "");
        assert.equal((host.querySelector('[aria-label="Item IDs"]') as HTMLTextAreaElement).value, "");
        assert.deepEqual(plugin.getGroups(), [groups[0], groups[2]]);
    }));
    await test("bulk configuration changes abort a stale edit rather than overwrite another group", () => editor(async (plugin, host) => {
        await edit(host, 1);
        await act(async () => plugin.setGroups([groups[2], groups[0]]));
        await save(host);
        assert.deepEqual(plugin.getGroups(), [groups[2], groups[0]]);
        assert.match(host.querySelector('[role="alert"]')?.textContent ?? "", /changed|removed/i);
    }));
    dom.window.close();
}
main().catch(error => { console.error(error); process.exitCode = 1; });
