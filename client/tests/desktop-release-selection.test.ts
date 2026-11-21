import assert from "node:assert/strict";
import { desktopClientManifestUrl } from "../game/plugins/desktop/DesktopPlugin";

async function main() {
    const target = { address: "world.example/game", secure: true };
    const build = "a".repeat(64);
    let clientVersion: string | undefined = build;
    globalThis.fetch = async input => {
        assert.equal(String(input), "https://world.example/api/world-info");
        return Response.json({ clientVersion });
    };

    assert.equal(await desktopClientManifestUrl(target), `https://github.com/RSPSApp/tsps/releases/download/client-${build}/manifest.json`);
    clientVersion = undefined;
    await assert.rejects(desktopClientManifestUrl(target), /does not advertise/);
    clientVersion = "../../other-repository";
    await assert.rejects(desktopClientManifestUrl(target), /does not advertise/);
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
