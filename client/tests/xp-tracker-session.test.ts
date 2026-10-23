import assert from "node:assert/strict";
import { test } from "node:test";
import { ConfigManager } from "@runelite/client/config/ConfigManager";
import { PluginInjector, CLIENT_TOKEN } from "@runelite/client/plugins/PluginInjector";
import { ClientToolbar } from "@runelite/client/ui/ClientToolbar";
import { XPTrackerPlugin, XPTrackerConfig, XPSession } from "../game/plugins/xptracker/XPTrackerPlugin";

function harness() {
    let now = 0, xp = 1000, name = "Alice";
    const client: any = {
        gameState: 30, controlledPlayerServerId: 1,
        playerEcs: { getIndexForServerId: () => 0, getName: () => name },
        cs2Vm: { context: { getStatXp: (skill: number) => skill === 0 ? xp : 0 } },
    };
    const config = new ConfigManager(undefined);
    const injector = new PluginInjector(config).provide(ConfigManager, config)
        .provide(ClientToolbar, new ClientToolbar()).provide(CLIENT_TOKEN, client);
    const plugin = injector.runWith(() => new XPTrackerPlugin(undefined, () => now));
    return {
        plugin, config,
        tick(at: number, nextXp: number) { now = at; xp = nextXp; plugin.onGameTick(); },
        state(state: number, at: number) { now = at; client.gameState = state; plugin.onGameStateChanged(); },
        account(account: string) { name = account; },
        row: () => plugin.getState().rows[0],
    };
}

test("region loading retains gains and online time across repeated 25 -> 30 transitions", async () => {
    const h = harness(); await h.plugin.start();
    h.config.setConfigValue(XPTrackerConfig, "resetOnLogout", true);
    h.tick(60000, 1100);
    h.state(25, 60000);
    h.tick(90000, 1200); // Snapshot cannot be consumed until the scene is ready.
    h.state(30, 120000); h.tick(120000, 1200);
    assert.equal(h.row().gained, 200, "100 XP during region loading must remain part of the session");
    assert.equal(h.row().perHour, 6000, "region loading counts as online session time");
    h.state(25, 120000); h.state(30, 180000); h.tick(180000, 1300);
    assert.equal(h.row().gained, 300);
    assert.equal(h.row().perHour, 6000);
    await h.plugin.stop();
});

test("real logout preserves prior gains, excludes offline time and rebases login snapshots", async () => {
    const h = harness(); await h.plugin.start();
    h.tick(60000, 1100);
    h.state(10, 60000); h.state(20, 120000); h.state(25, 180000);
    h.state(30, 180000); h.tick(180000, 5100);
    assert.equal(h.row().gained, 100, "offline XP is excluded");
    h.tick(240000, 5200);
    assert.equal(h.row().gained, 200);
    assert.equal(h.row().perHour, 6000, "two active minutes exclude two offline minutes");
    await h.plugin.stop();
});

test("reconnection rebases its snapshot even when it passes through region loading", async () => {
    const h = harness(); await h.plugin.start(); h.tick(60000, 1100);
    h.state(40, 60000); h.state(25, 180000); h.state(30, 180000); h.tick(180000, 5100);
    assert.equal(h.row().gained, 100);
    h.tick(240000, 5200);
    assert.equal(h.row().perHour, 6000);
    await h.plugin.stop();
});

test("initial loading and account changes establish fresh baselines; reset-on-logout remains opt-in", async () => {
    const h = harness(); h.state(25, 0); await h.plugin.start();
    h.state(30, 60000); h.tick(60000, 5000);
    assert.equal(h.row(), undefined);
    h.tick(120000, 5100); h.account("Bob"); h.tick(180000, 50000);
    assert.equal(h.row(), undefined, "another account cannot inherit the previous session");
    h.tick(240000, 50100); assert.equal(h.row().gained, 100);
    h.config.setConfigValue(XPTrackerConfig, "resetOnLogout", true);
    h.state(25, 240000); h.state(30, 300000); h.tick(300000, 50200);
    assert.equal(h.row().gained, 200, "region loading does not trigger logout reset");
    h.state(50, 300000); assert.equal(h.row(), undefined, "special login screen resets when configured");
    h.state(30, 360000); h.tick(360000, 90000); assert.equal(h.row(), undefined);
    h.tick(420000, 90100); h.state(10, 420000); assert.equal(h.row(), undefined);
    await h.plugin.stop();
});

test("rates use the pinned RuneLite 60-second minimum before and after skill reset", () => {
    const session = new XPSession();
    session.update("alice", [1000, 2000], 0);
    session.update("alice", [1061, 2061], 1000);
    assert.equal(session.rows(1000)[0].perHour, 3660);
    assert.equal(session.rows(59999)[0].perHour, 3660);
    assert.equal(session.rows(60000)[0].perHour, 3660);
    assert.equal(session.rows(61000)[0].perHour, 3600);
    session.reset(0, 61000);
    assert.deepEqual(session.rows(61000).map(row => row.skill), [1], "per-skill reset preserves other skill");
    session.update("alice", [1122, 2061], 62000);
    assert.equal(session.rows(62000)[0].perHour, 3660, "reset restarts the 60-second minimum");
    assert.equal(session.rows(121000)[0].perHour, 3660);
    assert.equal(session.rows(122000)[0].perHour, 3600);
    session.reset(undefined, 122000);
    assert.deepEqual(session.rows(122000), []);
});
