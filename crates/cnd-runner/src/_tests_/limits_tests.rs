//! Exact chat excerpt budgets, Unicode boundaries, and whole-file prefixes.

#![allow(clippy::unwrap_used, clippy::panic)]

use cnd_runner_interface::chat_events::{
    AgentChatEvent, ToolCall, ToolCallKind, ToolCallState, TurnEventContext,
};
use cnd_runner_interface::file_changes::{ChangeKind, ChangedFile};
use cnd_runner_interface::runner::RunnerEvent;
use serde_json::json;

use crate::json::codec;
use crate::limits::bound_event;

fn context() -> TurnEventContext {
    TurnEventContext {
        session_id: "s".into(),
        turn_id: "t".into(),
    }
}

#[test]
fn bounds_escaped_tool_details_without_splitting_unicode_and_counts_source_bytes() {
    let cases = [
        (None, None, 0, 4),
        (
            Some("\n".repeat(32_765) + "😀�\"\\tail"),
            Some("\n".repeat(32_765) + "😀"),
            9,
            65_536,
        ),
        (
            Some("\"\\".repeat(16_383) + "\u{0}😀"),
            Some("\"\\".repeat(16_383)),
            5,
            65_534,
        ),
        (
            Some("a".repeat(65_533) + "😀"),
            Some("a".repeat(65_533)),
            4,
            65_535,
        ),
        (Some("ok�😀�".into()), Some("ok�😀�".into()), 0, 14),
    ];
    for (detail, expected, omitted, bytes) in cases {
        let event = RunnerEvent::AgentChatEvent(AgentChatEvent::ToolUpdated {
            turn_event_context: context(),
            tool: ToolCall {
                id: "tool".into(),
                kind: ToolCallKind::Read,
                target: "file".into(),
                detail,
                omitted_detail_bytes: 0,
                state: ToolCallState::Done,
            },
        });
        let RunnerEvent::AgentChatEvent(AgentChatEvent::ToolUpdated { tool, .. }) =
            bound_event(event).unwrap()
        else {
            panic!("expected tool");
        };
        assert_eq!(tool.detail, expected);
        assert_eq!(tool.omitted_detail_bytes, omitted);
        assert_eq!(codec::encode(&tool.detail).unwrap().len(), bytes);
    }
}

fn file(path: String) -> ChangedFile {
    ChangedFile {
        path,
        display_path: None,
        previous_path: None,
        previous_display_path: None,
        change: ChangeKind::Modified,
        added: 1,
        removed: 0,
    }
}

#[test]
fn keeps_only_a_whole_unique_file_prefix_under_both_caps() {
    let mut count_files: Vec<_> = (0..202).map(|i| file(format!("file-{i}"))).collect();
    count_files.push(count_files[0].clone());
    let byte_files: Vec<_> = ['a', 'b', 'c']
        .into_iter()
        .map(|c| file(format!("{c}{}", "\n".repeat(50_000))))
        .chain([file("short".into())])
        .collect();
    for (files, kept, omitted) in [(count_files, 200, 2), (byte_files, 2, 2)] {
        let event: RunnerEvent = serde_json::from_value(json!({"type":"turn.completed","sessionId":"s","turnId":"t","state":"finished","durationMs":0,"files":files,"omittedFileCount":0,"userMessageIds":[]})).unwrap();
        let RunnerEvent::AgentChatEvent(AgentChatEvent::TurnCompleted {
            files: bounded,
            omitted_file_count,
            ..
        }) = bound_event(event).unwrap()
        else {
            panic!("expected completion");
        };
        assert_eq!(bounded, files[..kept]);
        assert_eq!(omitted_file_count, omitted);
        assert!(codec::encode(&bounded).unwrap().len() <= 262_144);
    }
}

#[test]
fn omits_whole_port_labels_that_exceed_the_private_budget_and_keeps_later_labels() {
    let event: RunnerEvent = serde_json::from_value(json!({"type":"ports.updated","ports":[
        {"port":3000,"name":"é".repeat(262_144),"folder":"/repo"},
        {"port":4000,"name":"a".repeat(80),"folder":""}
    ]}))
    .unwrap();
    let bounded = bound_event(event).unwrap();
    assert_eq!(
        serde_json::to_value(&bounded).unwrap(),
        json!({"type":"ports.updated","ports":[
            {"port":3000,"name":null,"folder":"/repo"},
            {"port":4000,"name":"a".repeat(80),"folder":""}
        ]})
    );
}
