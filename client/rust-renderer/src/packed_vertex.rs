use std::collections::HashMap;

/// Exact 12-byte packed vertex consumed by the current WebGL renderer.
#[repr(C)]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct PackedVertex {
    pub v0: u32,
    pub v1: u32,
    pub v2: u32,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct VertexInput {
    pub x: i32,
    pub y: i32,
    pub z: i32,
    pub hsl: i32,
    pub alpha: i32,
    pub u: f32,
    pub v: f32,
    pub texture_id: i32,
    pub priority: i32,
    pub priority_is_packed: bool,
}

impl PackedVertex {
    pub const STRIDE_BYTES: usize = 12;

    /// Port of VertexBuffer.ts::addVertex.
    pub fn encode(input: VertexInput) -> Self {
        let mut texture_id = input.texture_id;
        if texture_id >= 1024 {
            texture_id = -1;
        }

        let is_textured = texture_id != -1;
        let mut hsl = input.hsl;
        if is_textured {
            hsl &= 127;
            hsl |= (texture_id & 0x1ff) << 7;
        }

        let x_pos = clamp_i32(input.x + 0x4000, 0, 0x8000) as u32;
        let y_pos = clamp_i32(-input.y + 0x4000, 0, 0x8000) as u32;
        let z_pos = clamp_i32(input.z + 0x4000, 0, 0x8000) as u32;

        let u_packed = clamp_i32(pack_float11(input.u), 0, 0x7ff) as u32;
        let v_packed = clamp_i32(pack_float11(input.v), 0, 0x7ff) as u32;

        let v0 = x_pos.wrapping_shl(17) | ((u_packed & 0x3f) << 11) | v_packed;
        let v1 = y_pos | ((hsl as u32).wrapping_shl(15)) | ((is_textured as u32) << 31);

        let packed_priority = if input.priority_is_packed {
            clamp_i32(input.priority, 0, 7)
        } else {
            compress_priority(input.priority)
        } as u32;

        // Keep signed right-shift semantics for -1 exactly like JavaScript.
        let texture_high_bit = (((texture_id >> 9) & 0x1) as u32) << 5;
        let alpha = clamp_i32(input.alpha, 0, 0xff) as u32;

        let v2 = z_pos.wrapping_shl(17)
            | (alpha << 9)
            | ((packed_priority & 0x7) << 6)
            | texture_high_bit
            | (u_packed >> 6);

        Self { v0, v1, v2 }
    }

    pub fn position(self) -> [i32; 3] {
        let x = (((self.v0 >> 17) & 0x7fff) as i32) - 0x4000;
        let y = -((((self.v1) & 0x7fff) as i32) - 0x4000);
        let z = (((self.v2 >> 17) & 0x7fff) as i32) - 0x4000;
        [x, y, z]
    }

    pub fn alpha(self) -> u8 {
        ((self.v2 >> 9) & 0xff) as u8
    }

    pub fn priority(self) -> u8 {
        ((self.v2 >> 6) & 0x7) as u8
    }

    pub fn is_textured(self) -> bool {
        ((self.v1 >> 31) & 1) != 0
    }

    pub fn packed_hsl(self) -> u16 {
        ((self.v1 >> 15) & 0xffff) as u16
    }

    pub fn texture_id(self) -> Option<u16> {
        if !self.is_textured() {
            return None;
        }
        let hsl = self.packed_hsl() as u32;
        Some(((hsl >> 7) | (((self.v2 >> 5) & 1) << 9)) as u16)
    }

    pub fn tex_coord(self) -> [f32; 2] {
        let u_packed = ((self.v0 >> 11) & 0x3f) | ((self.v2 & 0x1f) << 6);
        let v_packed = self.v0 & 0x7ff;
        [unpack_float11(u_packed), unpack_float11(v_packed)]
    }
}

/// Rust-side equivalent of the TypeScript complete-packed-vertex cache.
#[derive(Default)]
pub struct PackedVertexDeduper {
    indices: HashMap<PackedVertex, u32>,
    vertices: Vec<PackedVertex>,
}

impl PackedVertexDeduper {
    pub fn push(&mut self, input: VertexInput, reuse: bool) -> u32 {
        let vertex = PackedVertex::encode(input);
        if reuse && let Some(index) = self.indices.get(&vertex) {
            return *index;
        }

        let index = self.vertices.len() as u32;
        self.vertices.push(vertex);
        if reuse {
            self.indices.insert(vertex, index);
        }
        index
    }

    pub fn vertices(&self) -> &[PackedVertex] {
        &self.vertices
    }

    pub fn into_vertices(self) -> Vec<PackedVertex> {
        self.vertices
    }
}

fn compress_priority(priority: i32) -> i32 {
    if priority < 0 {
        0
    } else if priority <= 3 {
        priority
    } else if priority <= 7 {
        4 + ((priority - 4) >> 1)
    } else {
        6 + ((priority - 8) >> 1)
    }
}

fn pack_float11(value: f32) -> i32 {
    // JavaScript Math.round(x) is floor(x + 0.5).
    1024 - ((value * 64.0 + 0.5).floor() as i32)
}

fn unpack_float11(value: u32) -> f32 {
    16.0 - value as f32 / 64.0
}

const fn clamp_i32(value: i32, min: i32, max: i32) -> i32 {
    if value < min {
        min
    } else if value > max {
        max
    } else {
        value
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input(texture_id: i32) -> VertexInput {
        VertexInput {
            x: 128,
            y: -32,
            z: 256,
            hsl: 0x1234,
            alpha: 255,
            u: 1.5,
            v: 2.25,
            texture_id,
            priority: 11,
            priority_is_packed: false,
        }
    }

    #[test]
    fn packed_vertex_round_trips_position_alpha_priority_and_uv() {
        let packed = PackedVertex::encode(input(-1));
        assert_eq!(packed.position(), [128, -32, 256]);
        assert_eq!(packed.alpha(), 255);
        assert_eq!(packed.priority(), 7);
        assert_eq!(packed.tex_coord(), [1.5, 2.25]);
        assert_eq!(packed.texture_id(), None);
    }

    #[test]
    fn texture_id_uses_same_split_bits_as_glsl_decoder() {
        let packed = PackedVertex::encode(input(700));
        assert_eq!(packed.texture_id(), Some(700));
        assert!(packed.is_textured());
    }

    #[test]
    fn deduper_uses_complete_packed_vertex_identity() {
        let mut deduper = PackedVertexDeduper::default();
        let first = deduper.push(input(-1), true);
        let same = deduper.push(input(-1), true);
        let mut changed = input(-1);
        changed.alpha = 127;
        let different = deduper.push(changed, true);

        assert_eq!(first, same);
        assert_ne!(first, different);
        assert_eq!(deduper.vertices().len(), 2);
    }
}
