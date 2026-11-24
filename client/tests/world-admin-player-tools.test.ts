import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { JSDOM } from "jsdom";

const panel = path.resolve(__dirname, "../../server/plugins/tools/worldadmin/panel");
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

function fixture(t: any, online = true) {
    const dom = new JSDOM("<!doctype html><div id='root'></div>", { url: "http://localhost:49601/", runScripts: "outside-only" });
    t.after(() => dom.window.close());
    const window = dom.window as any;
    window.eval(fs.readFileSync(path.join(panel, "panel.js"), "utf8"));
    window.eval(fs.readFileSync(path.join(panel, "PlayerTools.WorldAdmin.js"), "utf8"));
    const calls: any[] = [], flashes: any[] = [], refreshed: string[] = [];
    let resolveSearch: (value: any) => void = () => {};
    const api = (url: string, body?: any) => {
        calls.push({ url, body });
        if (body) return Promise.resolve({ ok: true, body: { message: "Changed selected player." } });
        return new Promise(resolve => { resolveSearch = resolve; });
    };
    const detail = { player: { id: "alice", username: "Alice", online }, tools: { enabled: true,
        position: { x: 3200, y: 3200, z: 0 }, destinations: [{ name: "Varrock", x: 3213, y: 3424, z: 0 }],
        skills: [{ name: "Attack", minimum: 1, maximum: 99, current: 12, level: 60, experience: 273742 },
            { name: "Hitpoints", minimum: 10, maximum: 99, current: 20, level: 50, experience: 101333 }],
        quests: [{ key: "cooks_assistant", name: "Cook's Assistant", stage: 0, complete: false }],
    } };
    const root = window.LocalPlayerTools.render(detail, true, window.LocalPluginPanel.el, api,
        (...args: any[]) => flashes.push(args), (name: string) => refreshed.push(name));
    window.document.getElementById("root").append(root);
    const button = (text: string): HTMLButtonElement => {
        const button = [...root.querySelectorAll("button")].find((node: any) => node.textContent === text);
        assert.ok(button, text);
        return button as HTMLButtonElement;
    };
    return { window, root: root as HTMLElement, button, calls, flashes, refreshed,
        resolveSearch: (value: any) => resolveSearch(value), detail };
}

test("player forms show live stats, target the selected player, and block duplicate submissions", async t => {
    const f = fixture(t);
    assert.match(f.root.textContent!, /Manage Alice/);
    assert.match(f.root.textContent!, /Current 12, base 60, XP 273742/);
    const skill = f.root.querySelector<HTMLSelectElement>('select[aria-label="Skill"]')!;
    skill.value = "Hitpoints";
    skill.dispatchEvent(new f.window.Event("change"));
    const level = f.button("Set skill level").form!.querySelector<HTMLInputElement>('input[type="number"]')!;
    assert.equal(level.min, "10");
    assert.equal(level.value, "50");
    level.value = "9";
    f.button("Set skill level").click();
    assert.equal(f.calls.length, 0, "invalid Hitpoints is rejected by form validity");
    level.value = "55";
    f.button("Set skill level").click();
    f.button("Set skill level").click();
    await settle();
    assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0].url, "/api/players/action?name=alice");
    assert.deepEqual(JSON.parse(JSON.stringify(f.calls[0].body)), { action: "skill", skill: "Hitpoints", level: 55 });
    assert.deepEqual(f.refreshed, ["alice"]);
    assert.equal(f.flashes[0][1], "Changed selected player.");
});

test("item search requires an explicit named result and ignores stale searches", async t => {
    const f = fixture(t);
    const search = f.root.querySelector<HTMLInputElement>('input[type="search"]')!;
    search.value = "arrow";
    f.button("Search items").click();
    search.value = "scimitar";
    search.dispatchEvent(new f.window.Event("input"));
    f.resolveSearch({ ok: true, body: { items: [{ id: 882, name: "Bronze arrow", stackable: true, noted: false }] } });
    await settle();
    assert.equal(f.root.querySelectorAll('select[aria-label="Matching items"] option').length, 0);
    assert.equal(f.button("Give selected item").disabled, true);
    f.button("Search items").click();
    f.resolveSearch({ ok: true, body: { items: [{ id: 1321, name: "Bronze scimitar", stackable: false, noted: false }] } });
    await settle();
    const results = f.root.querySelector<HTMLSelectElement>('select[aria-label="Matching items"]')!;
    assert.match(results.textContent!, /Bronze scimitar/);
    assert.equal(results.selectedIndex, -1, "no automatic item grant selection");
    results.value = "1321";
    results.dispatchEvent(new f.window.Event("change"));
    f.button("Give selected item").click();
    await settle();
    assert.equal(f.calls.at(-1).body.itemId, 1321);
    assert.equal(f.calls.at(-1).body.quantity, 1);
});

test("offline controls and unconfirmed quest changes cannot send mutations", async t => {
    const offline = fixture(t, false);
    offline.button("Teleport to destination").click();
    assert.equal(offline.calls.length, 0);
    assert.match(offline.root.textContent!, /Log this player into the running world/);
    const f = fixture(t);
    f.button("Apply quest change").click();
    assert.equal(f.calls.length, 0);
    f.root.querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked = true;
    f.button("Apply quest change").click();
    await settle();
    assert.equal(f.calls[0].body.quest, "cooks_assistant");
    assert.equal(f.calls[0].body.mode, "complete");
});
