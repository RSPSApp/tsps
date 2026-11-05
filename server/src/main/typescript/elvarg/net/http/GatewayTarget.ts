/**
 * What RSProx needs to point the official client at this server's gateway (gateway/README.md):
 * a jav_config and the binary world list it names. Served next to the game socket so a
 * worktree's RSProx target follows its own ports.
 *
 * RSProx connects to the world whose host matches the jav_config's codebase, on the target's
 * `game_server_port` (the gateway's GATEWAY_PORT). The host is `PUBLIC_HOST` (an IP or domain name
 * players reach this server at), or 127.0.0.1 when it isn't set.
 */
export class GatewayTarget {
    public static readonly JAV_CONFIG_PATH = "/gateway/jav_config.ws";
    public static readonly WORLD_LIST_PATH = "/gateway/worldlist.ws";

    private static readonly DEFAULT_HOST = "127.0.0.1";
    /** A bare host name or address: no scheme, port, path or spaces. */
    private static readonly HOST_PATTERN = /^[A-Za-z0-9.-]+$/;
    private static readonly REVISION = 241;
    private static readonly WORLD_ID = 1;
    private static readonly WORLD_FLAG_MEMBERS = 0x1;

    private static warnedHost: string | null = null;

    /**
     * The host the jav_config and world list give the client: `PUBLIC_HOST`, or 127.0.0.1. A value
     * that isn't a bare host (a URL, say) is reported once and ignored.
     */
    public static host(): string {
        const configured = process.env.PUBLIC_HOST?.trim();
        if (!configured) return GatewayTarget.DEFAULT_HOST;
        if (!GatewayTarget.HOST_PATTERN.test(configured)) {
            if (GatewayTarget.warnedHost !== configured) {
                GatewayTarget.warnedHost = configured;
                console.warn(`[gateway] PUBLIC_HOST "${configured}" isn't a host name or IP address; using ${GatewayTarget.DEFAULT_HOST}`);
            }
            return GatewayTarget.DEFAULT_HOST;
        }
        return configured;
    }

    /** The response for [url], or null when it isn't a gateway path. */
    public static resolve(url: string, websocketPort: number): { contentType: string; body: Buffer } | null {
        const path = url.split("?")[0];
        if (path === GatewayTarget.JAV_CONFIG_PATH) {
            return { contentType: "text/plain; charset=iso-8859-1", body: Buffer.from(GatewayTarget.javConfig(websocketPort), "latin1") };
        }
        if (path === GatewayTarget.WORLD_LIST_PATH) {
            return { contentType: "application/octet-stream", body: GatewayTarget.worldList() };
        }
        return null;
    }

    /** Revision 241's jav_config keys, with the codebase and world list pointed here. */
    private static javConfig(websocketPort: number): string {
        const host = GatewayTarget.host();
        const worldList = `http://${host}:${websocketPort}${GatewayTarget.WORLD_LIST_PATH}`;
        return [
            "title=tsps",
            `codebase=http://${host}/`,
            "cachedir=tsps",
            "storebase=0",
            "initial_jar=gamepack.jar",
            "initial_class=client.class",
            "viewerversion=124",
            "win_sub_version=1",
            "mac_sub_version=2",
            "other_sub_version=2",
            "window_preferredwidth=800",
            "window_preferredheight=600",
            "advert_height=96",
            "applet_minwidth=765",
            "applet_minheight=503",
            "applet_maxwidth=5760",
            "applet_maxheight=2160",
            "param=2=",
            "param=3=true",
            "param=4=1",
            "param=5=1",
            "param=7=0",
            "param=8=true",
            "param=9=",
            "param=10=5",
            "param=11=",
            `param=12=${GatewayTarget.WORLD_ID}`,
            "param=13=.runescape.com",
            "param=14=0",
            "param=15=0",
            "param=16=false",
            `param=17=${worldList}`,
            "param=18=",
            "param=19=",
            "param=20=",
            "param=21=0",
            "param=22=",
            `param=25=${GatewayTarget.REVISION}`,
            "param=28=",
            "param=29=1",
            "",
        ].join("\n");
    }

    /** One world: `u32 length, u16 count`, then `u16 id, u32 flags, host, activity, u8 location, u16 population`. */
    private static worldList(): Buffer {
        const world = Buffer.concat([
            Buffer.from([GatewayTarget.WORLD_ID >> 8, GatewayTarget.WORLD_ID & 0xff]),
            Buffer.from([0, 0, 0, GatewayTarget.WORLD_FLAG_MEMBERS]),
            Buffer.from(`${GatewayTarget.host()}\0`, "latin1"),
            Buffer.from("tsps\0", "latin1"),
            Buffer.from([0]),
            Buffer.from([0, 0]),
        ]);
        const header = Buffer.alloc(6);
        header.writeUInt32BE(2 + world.length, 0);
        header.writeUInt16BE(1, 4);
        return Buffer.concat([header, world]);
    }
}
