# Setup Guide

Get TSPS running locally.

The repository contains **`client/`**, **`server/`**, and **`docs/`** packages. The root commands install and run the server and client for you.

## Prerequisites

| Tool                                                | Version      | Why                                |
| --------------------------------------------------- | ------------ | ---------------------------------- |
| [Node.js](https://nodejs.org/)                      | v22.16+      | Runtime for both client and server |
| [Yarn](https://yarnpkg.com/) | 4.12.0 | Run the development commands below |
| [Git](https://git-scm.com/)                         | Any recent   | Clone the repo                     |

::: tip Node Version
Use [nvm](https://github.com/nvm-sh/nvm) or [fnm](https://github.com/Schniz/fnm) to manage Node versions easily:

```bash
nvm install 22
nvm use 22
```

:::

## 1. Clone the Repository

```bash
git clone https://github.com/RSPSApp/tsps.git
cd tsps
```

## 2. Set Up the Server and Client

```bash
npm run setup
```

This installs the root command runner, server dependencies, and client dependencies using the pinned Yarn 4.12.0 through `npm exec`. Setup itself does not require a separate Yarn or Corepack installation. It does not download the game cache or build collision data.

## 3. Start the Server and Client

The commands in this section require `yarn` on your PATH. Use Yarn 4.12.0, as pinned in the package manifests; `npm run setup` does not install a global `yarn` executable. Check `yarn --version` before continuing.

```bash
yarn start
```

This starts both processes in the same terminal. Press `Ctrl+C` to stop them.

To start only the game server:

```bash
yarn server
```

To start only the web client:

```bash
yarn client
```

The first start downloads the game cache to `server/caches/` if needed. This can take time depending on your connection. The server indexes cache regions at startup and loads their terrain and collision as regions are needed; there is no separate collision-build command.

## Server Startup

The server will:

1. Automatically download the OSRS cache if it hasn't been fetched yet (`server/caches/`)
2. Load collision data, spells, and game scripts
3. Start a WebSocket server (port `43594` by default, configured by `WEBSOCKET_PORT`)

You should see log output confirming the server is ready.

## Client Startup

This launches the React dev server (usually on `http://localhost:3000`). Your browser should open automatically. The client will also download the cache on first run if needed.

## You're In

In the web client, log in with an available username and a password of 8 to 20 characters. The first successful login creates the account; later password logins must use its current password.

---

## Troubleshooting

### Cache download hangs or fails

The cache is downloaded from the [OpenRS2 Archive](https://archive.openrs2.org/). If it stalls:

- Check your internet connection
- Delete the `server/caches/` folder and try again
- The target cache version is defined in `server/target.txt`

### Port 43594 already in use

Check whether another instance is using the port. For multiple local branches, follow the [worktree guide](./worktrees.md) so the server and client use matching, separate ports.

### Client shows a blank screen

- Make sure the server is running first
- Check the browser console for WebSocket connection errors
- Ensure the cache download completed (check `server/caches/` folder)

### Node version errors

Ensure you're on Node v22.16+:

```bash
node -v
```

---

## Useful Commands

Run these commands from the repository root. The Yarn commands require Yarn 4.12.0 on your PATH.

| Command | Description |
| ------- | ----------- |
| `npm run setup` | Install root, server and client dependencies using pinned Yarn |
| `yarn start` | Start the game server and web client together |
| `yarn server` | Start only the game server |
| `yarn client` | Start only the web client |
| `yarn --cwd server ensure-cache` | Download the OSRS cache if needed |
| `yarn --cwd client typecheck` | Typecheck the client |
| `yarn --cwd server build` | Compile the server TypeScript |
