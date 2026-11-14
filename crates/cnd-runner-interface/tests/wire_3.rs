//! JSON snapshots of the current runner protocol, including omitted and null fields.

use cnd_runner_interface::runner_handshake::RunnerToWorkspace;

macro_rules! wire_message {
    ($name:ident, $ty:ty, $json:literal) => {
        #[test]
        fn $name() {
            let message: $ty = serde_json::from_str($json).expect("valid current protocol fixture");
            insta::with_settings!({description => "Current protocol JSON. Optional fields stay absent; nullable fields stay null."}, {
                insta::assert_json_snapshot!(stringify!($name), message);
            });
        }
    };
}

wire_message!(
    file_diff_result_ok,
    RunnerToWorkspace,
    r#"{"type":"file.diff.result","requestId":"request-1","result":{"ok":true,"diff":{"path":"a.txt","displayPath":"masked.txt","baseBranch":"main","displayBaseBranch":"masked-main","oldContent":null,"newContent":"hi\n","patch":"patch text","binary":false}}}"#
);

wire_message!(
    file_diff_result_file_not_found,
    RunnerToWorkspace,
    r#"{"type":"file.diff.result","requestId":"request-1","result":{"ok":false,"error":{"code":"file_not_found","message":"Cannot read the file."}}}"#
);

wire_message!(
    file_diff_result_file_unavailable,
    RunnerToWorkspace,
    r#"{"type":"file.diff.result","requestId":"request-1","result":{"ok":false,"error":{"code":"file_unavailable","message":"Cannot read the file."}}}"#
);

wire_message!(
    file_diff_result_file_too_large,
    RunnerToWorkspace,
    r#"{"type":"file.diff.result","requestId":"request-1","result":{"ok":false,"error":{"code":"file_too_large","message":"Cannot read the file.","sizeBytes":5242881,"limitBytes":5242880}}}"#
);

wire_message!(
    turn_started,
    RunnerToWorkspace,
    r#"{"type":"event","streamId":"stream-1","eventNumber":9007199254740991,"occurredAt":1730000000000,"event":{"sessionId":"session-1","turnId":"turn-1","type":"turn.started","senderId":"member-1","choice":{"agent":"claude","model":"test-model","effort":"high"},"startedAt":1730000000000,"messageIds":["message-1"]}}"#
);

wire_message!(
    turn_thinking,
    RunnerToWorkspace,
    r#"{"type":"event","streamId":"stream-1","eventNumber":9007199254740991,"occurredAt":1730000000000,"event":{"sessionId":"session-1","turnId":"turn-1","type":"turn.thinking"}}"#
);

wire_message!(
    assistant_delta,
    RunnerToWorkspace,
    r#"{"type":"event","streamId":"stream-1","eventNumber":9007199254740991,"occurredAt":1730000000000,"event":{"sessionId":"session-1","turnId":"turn-1","type":"assistant.delta","messageId":"answer-1","text":"Text 😀\n"}}"#
);

wire_message!(
    assistant_completed,
    RunnerToWorkspace,
    r#"{"type":"event","streamId":"stream-1","eventNumber":9007199254740991,"occurredAt":1730000000000,"event":{"sessionId":"session-1","turnId":"turn-1","type":"assistant.completed","messageId":"answer-1","text":"Text 😀\n","userMessageIds":["message-1"]}}"#
);

wire_message!(
    tool_updated,
    RunnerToWorkspace,
    r#"{"type":"event","streamId":"stream-1","eventNumber":9007199254740991,"occurredAt":1730000000000,"event":{"sessionId":"session-1","turnId":"turn-1","type":"tool.updated","tool":{"id":"tool-1","kind":"run","target":"pwd","detail":"repository","omittedDetailBytes":0,"state":"done"}}}"#
);

wire_message!(
    tool_without_detail,
    RunnerToWorkspace,
    r#"{"type":"event","streamId":"stream-1","eventNumber":9007199254740991,"occurredAt":1730000000000,"event":{"sessionId":"session-1","turnId":"turn-1","type":"tool.updated","tool":{"id":"tool-1","kind":"run","target":"pwd","detail":null,"omittedDetailBytes":0,"state":"done"}}}"#
);

wire_message!(
    turn_completed,
    RunnerToWorkspace,
    r#"{"type":"event","streamId":"stream-1","eventNumber":9007199254740991,"occurredAt":1730000000000,"event":{"sessionId":"session-1","turnId":"turn-1","type":"turn.completed","state":"finished","durationMs":1000,"files":[{"path":"new.txt","displayPath":"masked.txt","previousPath":"old.txt","previousDisplayPath":"masked-old.txt","change":"renamed","added":2,"removed":1}],"omittedFileCount":2,"userMessageIds":["message-1"]}}"#
);

wire_message!(
    turn_stopped,
    RunnerToWorkspace,
    r#"{"type":"event","streamId":"stream-1","eventNumber":9007199254740991,"occurredAt":1730000000000,"event":{"sessionId":"session-1","turnId":"turn-1","type":"turn.completed","state":"stopped","durationMs":1000,"endReason":"background_work_limit","files":[],"filesUnavailable":true,"omittedFileCount":0,"userMessageIds":["message-1"]}}"#
);
