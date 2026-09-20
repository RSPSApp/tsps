//! Pure Rust rendering core for the Elvarg browser client.
//!
//! The migration boundary is intentionally narrow:
//!
//! TypeScript/cache code may continue to build scene geometry while Rust owns
//! packed-vertex semantics, draw planning and the WebGL2 GPU lifecycle. The
//! boundary is a renderer packet, not PicoGL objects or TypeScript classes.

pub mod draw;
pub mod packed_vertex;

#[cfg(target_arch = "wasm32")]
mod webgl;

pub use draw::{DrawRange, DrawStats, filter_draw_ranges};
pub use packed_vertex::{PackedVertex, VertexInput};

#[cfg(target_arch = "wasm32")]
pub use webgl::RustWebGlRenderer;

/// ABI version for the TS/Rust renderer packet contract.
pub const RENDERER_ABI_VERSION: u32 = 1;
