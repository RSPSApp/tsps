/// Draw-range layout used by the current TypeScript renderer:
/// (index byte offset, element count, instance count).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DrawRange {
    pub offset_bytes: u32,
    pub elements: u32,
    pub instances: u32,
}

impl DrawRange {
    pub const fn new(offset_bytes: u32, elements: u32, instances: u32) -> Self {
        Self {
            offset_bytes,
            elements,
            instances,
        }
    }

    pub const fn is_empty(self) -> bool {
        self.elements == 0 || self.instances == 0
    }

    pub const fn submitted_indices(self) -> u64 {
        self.elements as u64 * self.instances as u64
    }
}

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct DrawStats {
    pub draw_calls: u32,
    pub submitted_indices: u64,
}

/// Applies the same roof-plane filtering semantics as the TypeScript renderer.
pub fn filter_draw_ranges(
    ranges: &[DrawRange],
    range_planes: Option<&[u8]>,
    roof_plane_limit: u8,
) -> Vec<DrawRange> {
    if roof_plane_limit >= 3 || range_planes.is_none() {
        return ranges
            .iter()
            .copied()
            .filter(|range| !range.is_empty())
            .collect();
    }

    let planes = range_planes.expect("checked above");
    ranges
        .iter()
        .copied()
        .enumerate()
        .filter(|(index, range)| {
            if range.is_empty() {
                return false;
            }
            // Match the existing renderer: missing metadata defaults visible.
            planes.get(*index).copied().unwrap_or(0) <= roof_plane_limit
        })
        .map(|(_, range)| range)
        .collect()
}

pub fn parse_draw_ranges(flat: &[u32]) -> Result<Vec<DrawRange>, &'static str> {
    if !flat.len().is_multiple_of(3) {
        return Err("draw range packet must contain triples");
    }

    let (chunks, remainder) = flat.as_chunks::<3>();
    debug_assert!(remainder.is_empty());
    Ok(chunks
        .iter()
        .map(|chunk| DrawRange::new(chunk[0], chunk[1], chunk[2]))
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roof_filter_keeps_missing_plane_metadata_visible() {
        let ranges = [
            DrawRange::new(0, 3, 1),
            DrawRange::new(12, 6, 1),
            DrawRange::new(36, 9, 1),
        ];

        assert_eq!(
            filter_draw_ranges(&ranges, Some(&[0, 2]), 0),
            vec![ranges[0], ranges[2]]
        );
    }

    #[test]
    fn parses_typescript_draw_range_packet() {
        assert_eq!(
            parse_draw_ranges(&[0, 6, 1, 24, 12, 2]).unwrap(),
            vec![DrawRange::new(0, 6, 1), DrawRange::new(24, 12, 2)]
        );
    }
}
