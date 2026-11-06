# RuneLite gateway

The gateway lives in the top-level [runelite-gateway/](https://github.com/RSPSApp/tsps/tree/main/runelite-gateway) folder. It connects RuneLite or the official OSRS client through RSProx to TSPS, with one server session per player.

Start TSPS with `yarn start`, then run `yarn gateway` in a second terminal. The gateway prints the connection settings to add to RSProx.

See the [gateway README](https://github.com/RSPSApp/tsps/blob/main/runelite-gateway/README.md) for Java requirements, RSProx setup, remote connections and supported features. Run `yarn gateway:test` for its checks; live integration tests also need the server running in the same checkout.
