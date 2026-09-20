# Rust Renderer Migration

Status: Stage 0 started on feature/rust-renderer-core.

The renderer migration is intentionally incremental. TypeScript remains the producer of decoded scene data at first, while Rust/WASM takes ownership of the GPU rendering engine. The boundary is binary renderer data, not TypeScript class instances or PicoGL objects.

## Why WebGL2 first

The current client is already WebGL2 and has a large body of GLSL ES 3.00 behavior. Replacing both the implementation language and graphics API at the same time would make parity much harder to prove. The first Rust backend therefore uses web-sys WebGL2.

This gives us:

- Rust-owned GPU resource lifecycle
- WASM-safe browser execution
- compatibility with the current packed vertex format
- a path to preserve current GLSL behavior
- direct A/B comparison against the existing PicoGL renderer
- a later option to add WebGPU as a second Rust backend

## Initial boundary

During the first stages:

    cache + scene + model loaders (TypeScript)
                    |
                    | POD renderer packets
                    v
          elvarg-rust-renderer
                    |
                    v
                 WebGL2

The packet contract must stay numeric and versioned. No renderer call should require a React object, PicoGL object, TypeScript class graph, network object, or cache loader instance.

## Stage 0 implemented

The new client/rust-renderer crate currently owns:

- the exact 12-byte packed vertex codec used by VertexBuffer.ts
- complete packed-vertex identity and deduplication
- draw-range parsing
- roof-plane draw-range filtering primitives
- WebGL2 context ownership from Rust/WASM
- shader compile/link lifecycle
- VAO, VBO and index-buffer lifecycle
- packed geometry upload
- indexed and instanced draw submission
- draw statistics
- a geometry/HSL reference shader for validating the ABI

The production renderer has not been switched. This stage is a parity harness, not a partial replacement.

## Port sequence

### Stage 1: static scene parity

Move the static map pass behind the Rust renderer:

1. frame/scene uniforms
2. model-info textures and per-draw transforms
3. opaque and alpha passes
4. roof-plane filtering
5. texture arrays and texture ID mapping
6. material texture
7. height-map texture
8. water-mask texture
9. current main vertex/fragment shader semantics
10. framebuffer and final scene presentation

Acceptance: the same camera and same scene packet produce pixel-comparable output in TypeScript/PicoGL and Rust/WASM.

### Stage 2: dynamic geometry

Move GPU ownership for players, NPCs, projectiles, spot animations, ground items, animated locs, actor textures, transparency and priority depth.

### Stage 3: renderer services

Move renderer-owned picking data, render-distance and LOD filtering, profiler counters, framebuffer resizing, MSAA/FXAA, texture animation and 3D overlay geometry.

### Stage 4: delete PicoGL scene rendering

Keep both paths selectable until parity fixtures pass. Then make Rust the default and remove DrawBackend.ts plus the PicoGL scene-resource lifecycle.

### Stage 5: move geometry construction

After GPU parity, port the CPU-heavy renderer preparation: VertexBuffer, SceneBuffer, model face packing, model hashing, terrain/loc mesh construction, culling and draw-list construction. At that point decoded scene data can remain in Rust memory through GPU upload.

## What stays TypeScript for now

Do not port networking, CS2, widgets, login UI, audio, game simulation, pathfinding, cache transport or React just because WebGLOsrsRenderer currently imports them. The old renderer is a god object and this migration should separate renderer responsibilities rather than reproduce that coupling in Rust.

## Longer-term UI language

If the intended pure-Rust browser UI is Leptos, it fits this plan, but it should be a separate migration. The renderer crate must not depend on Leptos so React, Leptos, a desktop shell or tools can all drive the same renderer.

Lua is useful as a scripting/content layer. It is not a replacement for the browser rendering engine.