//! Serialized chat excerpts, applied after the caller's complete-source filter.

use std::collections::HashSet;

use cnd_runner_interface::chat_events::{
    AgentChatEvent, TOOL_DETAIL_MAX_BYTES, TURN_COMPLETED_FILES_MAX_BYTES, TURN_COMPLETED_MAX_FILES,
};
use cnd_runner_interface::runner::RunnerEvent;

use crate::error::{Error, Result};
use crate::json::codec;
use crate::port_limits;

/// Bound chat excerpts and whole private port labels like the Node runner.
/// Rust strings already contain Unicode scalar values, including repaired U+FFFD.
pub fn bound_event(mut event: RunnerEvent) -> Result<RunnerEvent> {
    match &mut event {
        RunnerEvent::AgentChatEvent(AgentChatEvent::ToolUpdated { tool, .. }) => {
            if let Some(detail) = &mut tool.detail {
                let (end, omitted) = detail_prefix(detail);
                detail.truncate(end);
                tool.omitted_detail_bytes = add_count(tool.omitted_detail_bytes, omitted)?;
            } else {
                tool.omitted_detail_bytes = 0;
            }
        }
        RunnerEvent::AgentChatEvent(AgentChatEvent::TurnCompleted {
            files,
            omitted_file_count,
            ..
        }) => {
            let mut paths = HashSet::new();
            files.retain(|file| paths.insert(file.path.clone()));
            let full = files.len();
            let mut bytes = 2;
            let mut kept = 0;
            for file in files.iter() {
                let next = codec::encode(file)?.len() + usize::from(kept != 0);
                if kept as u64 == TURN_COMPLETED_MAX_FILES
                    || (bytes + next) as u64 > TURN_COMPLETED_FILES_MAX_BYTES
                {
                    break;
                }
                kept += 1;
                bytes += next;
            }
            files.truncate(kept);
            *omitted_file_count = add_count(*omitted_file_count, (full - kept) as u64)?;
        }
        RunnerEvent::RunnerPortsUpdated(report) => port_limits::bound(report)?,
        _ => {}
    }
    Ok(event)
}

fn add_count(previous: u64, added: u64) -> Result<u64> {
    previous
        .checked_add(added)
        .filter(|count| *count <= codec::MAX_SAFE_INTEGER)
        .ok_or(Error::InvalidNumber)
}

fn detail_prefix(detail: &str) -> (usize, u64) {
    let mut bytes = 2;
    let mut end = 0;
    for point in detail.chars() {
        let next = match point {
            '"' | '\\' | '\u{08}' | '\u{0c}' | '\n' | '\r' | '\t' => 2,
            '\u{00}'..='\u{1f}' => 6,
            point => point.len_utf8(),
        };
        if (bytes + next) as u64 > TOOL_DETAIL_MAX_BYTES {
            break;
        }
        bytes += next;
        end += point.len_utf8();
    }
    (end, (detail.len() - end) as u64)
}

#[cfg(test)]
#[path = "_tests_/limits_tests.rs"]
mod limits_tests;
