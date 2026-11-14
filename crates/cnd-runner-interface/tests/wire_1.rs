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
    hello_without_capabilities,
    RunnerToWorkspace,
    r#"{"type":"hello","protocolVersion":2,"workspaceId":"workspace-1","streamId":"stream-1"}"#
);

wire_message!(
    hello_with_capabilities,
    RunnerToWorkspace,
    r#"{"type":"hello","protocolVersion":2,"workspaceId":"workspace-1","streamId":"stream-1","loginKinds":[{"agent":"claude","kind":"token"},{"agent":"claude","kind":"api-key"},{"agent":"codex","kind":"token"},{"agent":"codex","kind":"api-key"}]}"#
);

wire_message!(
    welcome,
    WorkspaceToRunner,
    r#"{"type":"welcome","streamId":"stream-1","protocolVersion":2,"confirmedThrough":12}"#
);

wire_message!(
    confirm,
    WorkspaceToRunner,
    r#"{"type":"confirm","streamId":"stream-1","throughEventNumber":12}"#
);

wire_message!(
    resend,
    WorkspaceToRunner,
    r#"{"type":"resend","streamId":"stream-1","fromEventNumber":13}"#
);

wire_message!(
    turn,
    WorkspaceToRunner,
    r#"{"type":"turn","commandId":"command-1","sessionId":"session-1","turnId":"turn-1","message":{"id":"message-1","sessionId":"session-1","sender":{"id":"member-1","githubLogin":"member","displayName":null,"avatarUrl":null},"text":"Read the file.","attachments":[{"id":"attachment-1","name":"sample.txt","path":"attachments/sample.txt","kind":"file","mediaType":"text/plain","sizeBytes":3}],"choice":{"agent":"claude","model":"test-model","effort":"high"},"createdAt":1730000000000,"state":"sent"},"attachments":[{"attachmentId":"attachment-1","path":"/repo/attachments/sample.txt"}],"credential":{"agent":"claude","kind":"api-key","token":"temporary-token","promptCacheTtl":"1h"},"commitAuthor":{"name":"Member","email":"member@example.test"},"branches":{"workspaceBranch":"feature","targetBranch":"main"}}"#
);

wire_message!(
    turn_without_optional_fields,
    WorkspaceToRunner,
    r#"{"type":"turn","commandId":"command-1","sessionId":"session-1","turnId":"turn-1","message":{"id":"message-1","sessionId":"session-1","sender":{"id":"member-1","githubLogin":"member","displayName":null,"avatarUrl":null},"text":"Read the file.","attachments":[{"id":"attachment-1","name":"sample.txt","path":"attachments/sample.txt","kind":"file","mediaType":"text/plain","sizeBytes":3}],"choice":{"agent":"claude","model":"test-model","effort":"high"},"createdAt":1730000000000,"state":"sent"},"attachments":[{"attachmentId":"attachment-1","path":"/repo/attachments/sample.txt"}],"credential":{"agent":"claude","kind":"token","token":"temporary-token"},"commitAuthor":null}"#
);

wire_message!(
    turn_codex_api_key,
    WorkspaceToRunner,
    r#"{"type":"turn","commandId":"command-1","sessionId":"session-1","turnId":"turn-1","message":{"id":"message-1","sessionId":"session-1","sender":{"id":"member-1","githubLogin":"member","displayName":null,"avatarUrl":null},"text":"Read the file.","attachments":[{"id":"attachment-1","name":"sample.txt","path":"attachments/sample.txt","kind":"file","mediaType":"text/plain","sizeBytes":3}],"choice":{"agent":"claude","model":"test-model","effort":"high"},"createdAt":1730000000000,"state":"sent"},"attachments":[{"attachmentId":"attachment-1","path":"/repo/attachments/sample.txt"}],"credential":{"agent":"codex","kind":"api-key","token":"temporary-token"},"commitAuthor":{"name":"Member","email":"member@example.test"},"branches":{"workspaceBranch":"feature","targetBranch":"main"}}"#
);

wire_message!(
    turn_codex_token,
    WorkspaceToRunner,
    r#"{"type":"turn","commandId":"command-1","sessionId":"session-1","turnId":"turn-1","message":{"id":"message-1","sessionId":"session-1","sender":{"id":"member-1","githubLogin":"member","displayName":null,"avatarUrl":null},"text":"Read the file.","attachments":[{"id":"attachment-1","name":"sample.txt","path":"attachments/sample.txt","kind":"file","mediaType":"text/plain","sizeBytes":3}],"choice":{"agent":"claude","model":"test-model","effort":"high"},"createdAt":1730000000000,"state":"sent"},"attachments":[{"attachmentId":"attachment-1","path":"/repo/attachments/sample.txt"}],"credential":{"agent":"codex","kind":"token","token":"temporary-token","account":{"accountId":"account-1","email":null,"planType":null,"userId":null}},"commitAuthor":{"name":"Member","email":"member@example.test"},"branches":{"workspaceBranch":"feature","targetBranch":"main"}}"#
);

wire_message!(
    message_during_turn,
    WorkspaceToRunner,
    r#"{"type":"message","commandId":"command-2","sessionId":"session-1","turnId":"turn-1","message":{"id":"message-1","sessionId":"session-1","sender":{"id":"member-1","githubLogin":"member","displayName":null,"avatarUrl":null},"text":"Read the file.","attachments":[{"id":"attachment-1","name":"sample.txt","path":"attachments/sample.txt","kind":"file","mediaType":"text/plain","sizeBytes":3}],"choice":{"agent":"claude","model":"test-model","effort":"high"},"createdAt":1730000000000,"state":"sent"},"attachments":[],"branches":{"workspaceBranch":"feature","targetBranch":"main"}}"#
);

wire_message!(
    message_without_branches,
    WorkspaceToRunner,
    r#"{"type":"message","commandId":"command-2","sessionId":"session-1","turnId":"turn-1","message":{"id":"message-1","sessionId":"session-1","sender":{"id":"member-1","githubLogin":"member","displayName":null,"avatarUrl":null},"text":"Read the file.","attachments":[{"id":"attachment-1","name":"sample.txt","path":"attachments/sample.txt","kind":"file","mediaType":"text/plain","sizeBytes":3}],"choice":{"agent":"claude","model":"test-model","effort":"high"},"createdAt":1730000000000,"state":"sent"},"attachments":[]}"#
);

wire_message!(
    interrupt,
    WorkspaceToRunner,
    r#"{"type":"interrupt","commandId":"command-3","sessionId":"session-1","turnId":"turn-1"}"#
);
