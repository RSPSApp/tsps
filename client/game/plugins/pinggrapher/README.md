# Ping Grapher

Browser client adaptation of [yuh25/Ping-Grapher](https://github.com/yuh25/Ping-Grapher), licensed under BSD-2-Clause (see LICENSE). Disabled by default; enable Ping Grapher in the plugin list.

Records the latest 100 latency measurements, once a second while logged in, and the latest 100 game tick intervals. Includes ping/tick selection, min/max labels, range scaling, labels-only or graph-only display, optional timeout markers, timeout label, warning thresholds, persistent warnings, and warning-only display. Move the overlay with the client's overlay drag controls; set its width and height in plugin settings.

## API differences

- RuneLite reads `Client.getSocketFD()` and native `Ping.getTCPInfo()` to obtain TCP RTT. Browser WebSocket connections expose neither. This port measures an uncached `/api/world-info` request to the connected world's content service (HTTP for server worlds, content data channel for WebRTC worlds). This is **application request latency**, including server processing and browser scheduling, rather than TCP RTT. It does not measure the signalling relay.
- RuneLite uses WorldService to resolve OSRS worlds. This client uses its existing connection/content API, including browser-hosted worlds.
- Java scheduled executors and read/write locks become asynchronous requests with a one-second delay between samples; requests time out after three seconds. Late responses after logout, world change or disable are discarded. HTTP probes are aborted on timeout; content-channel requests retain the transport's existing timeout.
- GameTick is supported via the client's RuneLite event bridge. The first tick after login establishes the timing baseline; startup does not add a fictitious 600ms sample.
- Java2D and OverlayManager become a movable WidgetOverlay rendered with the existing WebGL renderer. Width/height settings replace Alt-resizing. The client's existing drag/reset behavior applies.
- This adaptation uses fixed yellow/red graph and warning colours and the client bitmap font. Upstream's custom corner labels (including FPS), font family/style, individual colour swaps, margin controls and hide-behind-interfaces option are not implemented.
