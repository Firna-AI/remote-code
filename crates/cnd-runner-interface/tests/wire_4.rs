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
    turn_failed,
    RunnerToWorkspace,
    r#"{"type":"event","streamId":"stream-1","eventNumber":9007199254740991,"occurredAt":1730000000000,"event":{"sessionId":"session-1","turnId":"turn-1","type":"turn.failed","error":{"code":"agent_failed","message":"Agent failed."},"retryMessageId":"message-1","durationMs":1000}}"#
);

wire_message!(
    files_snapshot,
    RunnerToWorkspace,
    r#"{"type":"event","streamId":"stream-1","eventNumber":9007199254740991,"occurredAt":1730000000000,"event":{"type":"files.snapshot","tree":{"revision":1,"partNumber":1,"partCount":1,"entries":[{"path":"new.txt","displayPath":"masked.txt","name":"new.txt","kind":"file","change":null}]}}}"#
);

wire_message!(
    files_snapshot_unavailable,
    RunnerToWorkspace,
    r#"{"type":"event","streamId":"stream-1","eventNumber":9007199254740991,"occurredAt":1730000000000,"event":{"type":"files.snapshot","tree":{"revision":1,"partNumber":1,"partCount":1,"entries":[],"unavailable":true}}}"#
);

wire_message!(
    files_unavailable,
    RunnerToWorkspace,
    r#"{"type":"event","streamId":"stream-1","eventNumber":9007199254740991,"occurredAt":1730000000000,"event":{"type":"files.unavailable"}}"#
);

wire_message!(
    files_changed,
    RunnerToWorkspace,
    r#"{"type":"event","streamId":"stream-1","eventNumber":9007199254740991,"occurredAt":1730000000000,"event":{"type":"files.changed","delta":{"revision":2,"changes":[{"operation":"upsert","entry":{"path":"new.txt","displayPath":"masked.txt","name":"new.txt","kind":"file","change":null}},{"operation":"remove","path":"gone.txt"},{"operation":"move","previousPath":"old.txt","entry":{"path":"new.txt","displayPath":"masked.txt","name":"new.txt","kind":"file","change":null}}]}}}"#
);

wire_message!(
    changes_updated,
    RunnerToWorkspace,
    r#"{"type":"event","streamId":"stream-1","eventNumber":9007199254740991,"occurredAt":1730000000000,"event":{"type":"changes.updated","changes":{"revision":1,"partNumber":1,"partCount":1,"baseBranch":"main","displayBaseBranch":"masked-main","unpushedCommits":2,"uncommittedFileCount":1,"files":[{"path":"new.txt","displayPath":"masked.txt","previousPath":"old.txt","previousDisplayPath":"masked-old.txt","change":"renamed","added":2,"removed":1,"uncommitted":true}],"summary":{"files":1,"added":2,"removed":1}}}}"#
);

wire_message!(
    changes_without_counts,
    RunnerToWorkspace,
    r#"{"type":"event","streamId":"stream-1","eventNumber":9007199254740991,"occurredAt":1730000000000,"event":{"type":"changes.updated","changes":{"revision":1,"partNumber":1,"partCount":1,"baseBranch":"main","files":[{"path":"new.txt","displayPath":"masked.txt","previousPath":"old.txt","previousDisplayPath":"masked-old.txt","change":"renamed","added":2,"removed":1,"uncommitted":true}],"summary":{"files":1,"added":2,"removed":1}}}}"#
);

wire_message!(
    ports_updated,
    RunnerToWorkspace,
    r#"{"type":"event","streamId":"stream-1","eventNumber":9007199254740991,"occurredAt":1730000000000,"event":{"type":"ports.updated","ports":[{"port":5173,"name":"Web app","folder":null}]}}"#
);

wire_message!(
    runner_ready,
    RunnerToWorkspace,
    r#"{"type":"event","streamId":"stream-1","eventNumber":9007199254740991,"occurredAt":1730000000000,"event":{"type":"runner.ready"}}"#
);

wire_message!(
    start_updated,
    RunnerToWorkspace,
    r#"{"type":"event","streamId":"stream-1","eventNumber":9007199254740991,"occurredAt":1730000000000,"event":{"type":"start.updated","start":{"kind":"resume","startedAt":1730000000000,"steps":[{"id":"start","label":"Start","state":"running","startedAt":1730000000000,"completedAt":null}]}}}"#
);

wire_message!(
    workspace_title,
    RunnerToWorkspace,
    r#"{"type":"event","streamId":"stream-1","eventNumber":9007199254740991,"occurredAt":1730000000000,"event":{"type":"workspace.title","name":"Runner types"}}"#
);
