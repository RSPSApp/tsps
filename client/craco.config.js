// `homepage: "/play"` in package.json is where the LIVE site is mounted, and
// CRA applies it in development too — which redirects localhost:3000 to
// /play/ and moves the cache to /play/caches/, while the dev server only
// serves it at /caches/ (see devServer.setupMiddlewares below). Serve dev from
// the root instead. PUBLIC_URL wins over homepage in CRA's
// getPublicUrlOrPath, and this must run before react-scripts/config/paths is
// required below, since that resolves the public path once at import time.
// Not an .env file: .env* is gitignored, so it would not reach a deploy build.
if (process.env.NODE_ENV === "development" && !process.env.PUBLIC_URL) {
    process.env.PUBLIC_URL = "/";
}

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const JsonMinimizerPlugin = require("json-minimizer-webpack-plugin");
const evalSourceMapMiddleware = require("react-dev-utils/evalSourceMapMiddleware");
const noopServiceWorkerMiddleware = require("react-dev-utils/noopServiceWorkerMiddleware");
const redirectServedPath = require("react-dev-utils/redirectServedPathMiddleware");
const paths = require("react-scripts/config/paths");
const express = require("express");

// This package IS the CRA app root (sibling of ../server and ../docs).
const appRoot = __dirname;
paths.appPath = appRoot;
paths.appSrc = appRoot;
paths.appPublic = path.resolve(appRoot, "public");
paths.appHtml = path.resolve(appRoot, "public/index.html");
paths.appIndexJs = path.resolve(appRoot, "index.tsx");
paths.appTypeDeclarations = path.resolve(appRoot, "react-app-env.d.ts");
paths.appTsConfig = path.resolve(appRoot, "tsconfig.json");
paths.appBuild = path.resolve(appRoot, "build");

// WebRTC clients cannot fetch custom interfaces from the signalling relay.
// Export the same definitions that the server plugins register, rather than maintaining
// a second list in the browser build.
const interfaceOutput = path.join(paths.appPublic, "browser-host/interfaces");
fs.mkdirSync(interfaceOutput, { recursive: true });
const browserHostInterfaces = JSON.parse(
    execFileSync(process.execPath, [path.join(appRoot, "node_modules/tsx/dist/cli.mjs"), "scripts/browser-host-interface-definitions.ts"], {
        cwd: path.resolve(appRoot, "../server"),
        encoding: "utf8",
    }),
);
for (const definition of browserHostInterfaces) {
    fs.writeFileSync(path.join(interfaceOutput, `${definition.groupId}.json`), JSON.stringify(definition));
}

module.exports = {
    paths: (existingPaths) => {
        existingPaths.appPath = paths.appPath;
        existingPaths.appSrc = paths.appSrc;
        existingPaths.appPublic = paths.appPublic;
        existingPaths.appHtml = paths.appHtml;
        existingPaths.appIndexJs = paths.appIndexJs;
        existingPaths.appTypeDeclarations = paths.appTypeDeclarations;
        existingPaths.appTsConfig = paths.appTsConfig;
        existingPaths.appBuild = paths.appBuild;
        return existingPaths;
    },
    webpack: {
        configure: (webpackConfig) => {
            const jsXxhashPath = path.resolve(appRoot, "node_modules/js-xxhash");
            const glslLoader = {
                test: /\.(glsl|vs|fs)$/,
                loader: "ts-shader-loader",
            };

            for (const rule of webpackConfig.module.rules) {
                if (
                    rule &&
                    rule.enforce === "pre" &&
                    Array.isArray(rule.use) &&
                    rule.use.some((use) =>
                        typeof use === "object"
                            ? use.loader?.includes("source-map-loader")
                            : String(use).includes("source-map-loader"),
                    )
                ) {
                    const existingExclude = rule.exclude;
                    rule.exclude = Array.isArray(existingExclude)
                        ? [...existingExclude, jsXxhashPath]
                        : existingExclude
                          ? [existingExclude, jsXxhashPath]
                          : [jsXxhashPath];
                }
                if (rule.oneOf) {
                    // appSrc is the package root (not src/), so without this
                    // babel-preset-react-app also rewrites node_modules CJS
                    // (e.g. threads) into broken ESM and browsers throw
                    // "exports is not defined".
                    for (const oneOfRule of rule.oneOf) {
                        const loader =
                            typeof oneOfRule.loader === "string"
                                ? oneOfRule.loader
                                : "";
                        if (
                            loader.includes("babel-loader") &&
                            oneOfRule.include === paths.appSrc
                        ) {
                            oneOfRule.exclude = /node_modules/;
                        }
                    }
                    rule.oneOf.unshift(glslLoader);
                    break;
                }
            }

            // Worktrees symlink client/node_modules here, so they share
            // node_modules/.cache. Webpack caches asset paths relative to the
            // checkout ("../../tsps/client/..."), and a cache written by another
            // checkout fails with "conflicting asset info for sourceFilename".
            if (webpackConfig.cache) {
                const checkout = require("crypto").createHash("md5").update(appRoot).digest("hex").slice(0, 8);
                webpackConfig.cache.name = `${webpackConfig.mode}-${checkout}`;
            }

            webpackConfig.module.rules.push({
                resourceQuery: /url/,
                type: "asset/resource",
            });
            webpackConfig.module.rules.push({
                resourceQuery: /source/,
                type: "asset/source",
            });

            webpackConfig.resolve.fallback = {
                fs: false,
                module: false,
            };

            webpackConfig.resolve.extensions = [".web.js", ...webpackConfig.resolve.extensions];

            // RuneLite-shaped plugin API lives in runelite/ (mirrors the Java packages).
            webpackConfig.resolve.alias = {
                ...(webpackConfig.resolve.alias ?? {}),
                "@runelite": path.resolve(appRoot, "runelite"),
            };

            webpackConfig.optimization.minimizer.push(new JsonMinimizerPlugin());
            webpackConfig.ignoreWarnings = [
                ...(webpackConfig.ignoreWarnings ?? []),
                (warning) =>
                    typeof warning?.message === "string" &&
                    warning.message.includes("Failed to parse source map") &&
                    typeof warning?.module?.resource === "string" &&
                    (warning.module.resource.includes(
                        `${path.sep}node_modules${path.sep}js-xxhash${path.sep}`,
                    ) ||
                        warning.module.resource.includes(
                            `${path.sep}node_modules${path.sep}wasm-gzip${path.sep}`,
                        ) ||
                        warning.module.resource.includes(
                            `${path.sep}node_modules${path.sep}typescript${path.sep}`,
                        )),
                (warning) =>
                    typeof warning?.message === "string" &&
                    warning.message.includes("Critical dependency") &&
                    typeof warning?.module?.resource === "string" &&
                    warning.module.resource.includes(
                        `${path.sep}node_modules${path.sep}typescript${path.sep}`,
                    ),
            ];

            return webpackConfig;
        },
    },
    devServer: (devServerConfig) => {
        delete devServerConfig.onBeforeSetupMiddleware;
        delete devServerConfig.onAfterSetupMiddleware;

        const cachesDir = path.resolve(appRoot, "../server/caches");

        return {
            ...devServerConfig,
            hot: false,
            liveReload: false,
            headers: (req) => {
                const params = new URL(req.url, "http://localhost").searchParams;
                // Browser hosts need their cross-origin opener for editor messages.
                const browserHost = params.has("browser-host-origin") || params.get("browser-host-client") === "1";
                return {
                    "Cross-Origin-Opener-Policy": browserHost ? "same-origin-allow-popups" : "same-origin",
                    "Cross-Origin-Embedder-Policy": "require-corp",
                    "Cross-Origin-Resource-Policy": "cross-origin",
                };
            },
            client: {
                ...devServerConfig.client,
                overlay: {
                    ...devServerConfig.client?.overlay,
                    errors: true,
                    warnings: false,
                    runtimeErrors: (error) => {
                        if (error instanceof DOMException && error.name === "AbortError") {
                            return false;
                        }
                        return true;
                    },
                },
            },
            setupMiddlewares: (middlewares, devServer) => {
                if (!devServer) {
                    throw new Error("webpack-dev-server is not defined");
                }

                devServer.app.use(evalSourceMapMiddleware(devServer));

                if (fs.existsSync(paths.proxySetup)) {
                    require(paths.proxySetup)(devServer.app);
                }

                devServer.app.use(redirectServedPath(paths.publicUrlOrPath));
                devServer.app.use(noopServiceWorkerMiddleware(paths.publicUrlOrPath));
                if (fs.existsSync(cachesDir)) {
                    devServer.app.use("/caches", express.static(cachesDir));
                }

                return middlewares;
            },
        };
    },
};
