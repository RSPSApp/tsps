import { useEffect, useState } from "react";
import { MOBILE_GAMEFRAME_MEDIA_QUERY, prefersMobileGameframe } from "../common/utils/DeviceUtil";
import { send } from "../network/serverConnection/connection/send";
import { subscribeWidgetEvents } from "../network/serverConnection/subscriptions/ui";
import type { OsrsClient } from "./OsrsClient";

const GAMEFRAME_ROOTS = new Set([161, 164, 165, 548, 601]);

export function useResponsiveGameframe(client: OsrsClient): boolean {
    const [mobile, setMobile] = useState(prefersMobileGameframe);
    useEffect(() => {
        const media = window.matchMedia(MOBILE_GAMEFRAME_MEDIA_QUERY);
        let lastRequested: boolean | undefined;
        const change = (root = client.widgetManager?.rootInterface) => {
            const next = prefersMobileGameframe();
            setMobile(next);
            if (!client.isLoggedIn() || !GAMEFRAME_ROOTS.has(root)) return;
            if (next === lastRequested) return;
            if (lastRequested === undefined && next === (root === 601)) return;
            lastRequested = next;
            send({
                type: "plugin_message",
                payload: { channel: "gameframe:layout", data: { mobile: next } },
            });
        };
        const onChange = () => change();
        const unsubscribe = subscribeWidgetEvents((payload) => {
            if (payload.action !== "set_root" || !GAMEFRAME_ROOTS.has(payload.groupId)) return;
            if (lastRequested === (payload.groupId === 601)) lastRequested = undefined;
            change(payload.groupId);
        });
        media.addEventListener("change", onChange);
        // Device emulation can change its user agent without crossing the size breakpoint.
        window.addEventListener("resize", onChange);
        return () => {
            media.removeEventListener("change", onChange);
            window.removeEventListener("resize", onChange);
            unsubscribe();
        };
    }, [client]);
    return mobile;
}
