//! JSON snapshots of the current runner protocol, including omitted and null fields.

use cnd_runner_interface::runner_handshake::{RunnerToWorkspace, WorkspaceToRunner};

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
    model,
    WorkspaceToRunner,
    r#"{"type":"model","commandId":"command-4","sessionId":"session-1","choice":{"agent":"codex","model":"test-model","effort":"xhigh"}}"#
);

wire_message!(
    file_read,
    WorkspaceToRunner,
    r#"{"type":"file.read","requestId":"request-1","path":"a.txt","maxBytes":5242880}"#
);

wire_message!(
    file_diff,
    WorkspaceToRunner,
    r#"{"type":"file.diff","requestId":"request-2","path":"a.txt","defaultBranch":"main"}"#
);

wire_message!(
    refresh_files_snapshot,
    WorkspaceToRunner,
    r#"{"type":"report.refresh","commandId":"command-5","kind":"files.snapshot"}"#
);

wire_message!(
    refresh_changes_updated,
    WorkspaceToRunner,
    r#"{"type":"report.refresh","commandId":"command-5","kind":"changes.updated"}"#
);

wire_message!(
    refresh_start_updated,
    WorkspaceToRunner,
    r#"{"type":"report.refresh","commandId":"command-5","kind":"start.updated"}"#
);

wire_message!(
    refresh_workspace_title,
    WorkspaceToRunner,
    r#"{"type":"report.refresh","commandId":"command-5","kind":"workspace.title"}"#
);

wire_message!(
    refresh_ports_updated,
    WorkspaceToRunner,
    r#"{"type":"report.refresh","commandId":"command-5","kind":"ports.updated"}"#
);

wire_message!(
    file_read_result_ok,
    RunnerToWorkspace,
    r#"{"type":"file.read.result","requestId":"request-1","result":{"ok":true,"file":{"path":"a.txt","displayPath":"masked.txt","mediaType":"text/plain","sizeBytes":3,"encoding":"utf-8","content":"hi\n"}}}"#
);

wire_message!(
    file_read_result_file_not_found,
    RunnerToWorkspace,
    r#"{"type":"file.read.result","requestId":"request-1","result":{"ok":false,"error":{"code":"file_not_found","message":"Cannot read the file."}}}"#
);

wire_message!(
    file_read_result_file_unavailable,
    RunnerToWorkspace,
    r#"{"type":"file.read.result","requestId":"request-1","result":{"ok":false,"error":{"code":"file_unavailable","message":"Cannot read the file."}}}"#
);

wire_message!(
    file_read_result_file_too_large,
    RunnerToWorkspace,
    r#"{"type":"file.read.result","requestId":"request-1","result":{"ok":false,"error":{"code":"file_too_large","message":"Cannot read the file.","sizeBytes":5242881,"limitBytes":5242880}}}"#
);
