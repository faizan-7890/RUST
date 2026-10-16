//! In-Wasm Undo / Redo History Ring Buffer Engine.
//!
//! Maintains high-speed snapshots of image and mask buffers directly inside
//! WebAssembly linear memory, providing instant O(1) multi-level Undo/Redo
//! without costly round-trip data serialization to JavaScript.

#[derive(Clone, Debug)]
pub struct HistoryEntry {
    pub label: String,
    pub width: u32,
    pub height: u32,
    pub base_pixels: Vec<u8>,
    pub current_pixels: Vec<u8>,
    pub mask_pixels: Vec<u8>,
    pub mask_enabled: bool,
}

pub struct HistoryManager {
    entries: Vec<HistoryEntry>,
    cursor: usize,
    max_entries: usize,
}

impl HistoryManager {
    pub fn new(max_entries: usize) -> Self {
        Self {
            entries: Vec::with_capacity(max_entries),
            cursor: 0,
            max_entries: max_entries.max(2),
        }
    }

    /// Clears all history snapshots and resets cursor.
    pub fn clear(&mut self) {
        self.entries.clear();
        self.cursor = 0;
    }

    /// Records a new snapshot. If currently in an undone state,
    /// future redo history is truncated (standard branch commit).
    pub fn push_snapshot(
        &mut self,
        label: String,
        width: u32,
        height: u32,
        base_pixels: &[u8],
        current_pixels: &[u8],
        mask_pixels: &[u8],
        mask_enabled: bool,
    ) {
        // If we previously undid steps, truncate future redo chain
        if !self.entries.is_empty() && self.cursor + 1 < self.entries.len() {
            self.entries.truncate(self.cursor + 1);
        }

        // If ring buffer is full, remove oldest entry to prevent memory bloat
        if self.entries.len() >= self.max_entries {
            self.entries.remove(0);
        }

        self.entries.push(HistoryEntry {
            label,
            width,
            height,
            base_pixels: base_pixels.to_vec(),
            current_pixels: current_pixels.to_vec(),
            mask_pixels: mask_pixels.to_vec(),
            mask_enabled,
        });

        self.cursor = self.entries.len() - 1;
    }

    #[inline(always)]
    pub fn can_undo(&self) -> bool {
        self.cursor > 0 && !self.entries.is_empty()
    }

    #[inline(always)]
    pub fn can_redo(&self) -> bool {
        !self.entries.is_empty() && self.cursor + 1 < self.entries.len()
    }

    pub fn undo(&mut self) -> Option<&HistoryEntry> {
        if self.can_undo() {
            self.cursor -= 1;
            Some(&self.entries[self.cursor])
        } else {
            None
        }
    }

    pub fn redo(&mut self) -> Option<&HistoryEntry> {
        if self.can_redo() {
            self.cursor += 1;
            Some(&self.entries[self.cursor])
        } else {
            None
        }
    }

    pub fn jump_to(&mut self, index: usize) -> Option<&HistoryEntry> {
        if index < self.entries.len() {
            self.cursor = index;
            Some(&self.entries[self.cursor])
        } else {
            None
        }
    }

    pub fn current_entry(&self) -> Option<&HistoryEntry> {
        self.entries.get(self.cursor)
    }

    pub fn count(&self) -> usize {
        self.entries.len()
    }

    pub fn cursor(&self) -> usize {
        self.cursor
    }

    pub fn label_at(&self, index: usize) -> Option<&str> {
        self.entries.get(index).map(|e| e.label.as_str())
    }

    /// Serializes current history list to a compact JSON string for UI timeline rendering.
    pub fn to_json_summary(&self) -> String {
        let mut json = String::from("[");
        for (i, entry) in self.entries.iter().enumerate() {
            if i > 0 {
                json.push(',');
            }
            let is_active = i == self.cursor;
            // Escape any quotes in label
            let escaped_label = entry.label.replace('\"', "\\\"");
            json.push_str(&format!(
                "{{\"index\":{},\"label\":\"{}\",\"active\":{},\"w\":{},\"h\":{}}}",
                i, escaped_label, is_active, entry.width, entry.height
            ));
        }
        json.push(']');
        json
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_history_undo_redo_lifecycle() {
        let mut mgr = HistoryManager::new(5);
        assert!(!mgr.can_undo());
        assert!(!mgr.can_redo());

        // Snapshot 0
        mgr.push_snapshot("Init".to_string(), 1, 1, &[0], &[0], &[0], false);
        assert_eq!(mgr.count(), 1);
        assert_eq!(mgr.cursor(), 0);
        assert!(!mgr.can_undo());
        assert!(!mgr.can_redo());

        // Snapshot 1
        mgr.push_snapshot("Filter 1".to_string(), 1, 1, &[1], &[1], &[0], false);
        assert_eq!(mgr.count(), 2);
        assert_eq!(mgr.cursor(), 1);
        assert!(mgr.can_undo());
        assert!(!mgr.can_redo());

        // Undo
        let undone = mgr.undo().unwrap();
        assert_eq!(undone.label, "Init");
        assert_eq!(mgr.cursor(), 0);
        assert!(!mgr.can_undo());
        assert!(mgr.can_redo());

        // Redo
        let redone = mgr.redo().unwrap();
        assert_eq!(redone.label, "Filter 1");
        assert_eq!(mgr.cursor(), 1);
        assert!(mgr.can_undo());
        assert!(!mgr.can_redo());
    }

    #[test]
    fn test_history_branch_truncation() {
        let mut mgr = HistoryManager::new(5);
        mgr.push_snapshot("A".to_string(), 1, 1, &[0], &[0], &[0], false);
        mgr.push_snapshot("B".to_string(), 1, 1, &[1], &[1], &[0], false);
        mgr.push_snapshot("C".to_string(), 1, 1, &[2], &[2], &[0], false);
        assert_eq!(mgr.count(), 3);

        // Undo back to A
        mgr.undo();
        mgr.undo();
        assert_eq!(mgr.cursor(), 0);

        // Push new D -> should truncate B and C
        mgr.push_snapshot("D".to_string(), 1, 1, &[3], &[3], &[0], false);
        assert_eq!(mgr.count(), 2);
        assert_eq!(mgr.label_at(0).unwrap(), "A");
        assert_eq!(mgr.label_at(1).unwrap(), "D");
        assert_eq!(mgr.cursor(), 1);
        assert!(!mgr.can_redo());
    }

    #[test]
    fn test_history_ring_buffer_eviction() {
        let mut mgr = HistoryManager::new(3);
        mgr.push_snapshot("1".to_string(), 1, 1, &[1], &[1], &[0], false);
        mgr.push_snapshot("2".to_string(), 1, 1, &[2], &[2], &[0], false);
        mgr.push_snapshot("3".to_string(), 1, 1, &[3], &[3], &[0], false);
        assert_eq!(mgr.count(), 3);

        // 4th snapshot should evict "1"
        mgr.push_snapshot("4".to_string(), 1, 1, &[4], &[4], &[0], false);
        assert_eq!(mgr.count(), 3);
        assert_eq!(mgr.label_at(0).unwrap(), "2");
        assert_eq!(mgr.label_at(1).unwrap(), "3");
        assert_eq!(mgr.label_at(2).unwrap(), "4");
        assert_eq!(mgr.cursor(), 2);
    }
}
