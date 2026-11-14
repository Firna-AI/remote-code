//! JSON escaping, safe number forms, and tolerant command text.

#![allow(clippy::unwrap_used, clippy::panic)]

use cnd_runner_interface::runner_commands::{RunnerCommand, RunnerTurn};
use cnd_runner_interface::runner_handshake::WorkspaceToRunner;

use crate::error::Error;
use crate::json::codec::{decode, encode};
use crate::json::commands::workspace_message;

const TURN: &str = r#"{"type":"turn","commandId":"c","sessionId":"s","turnId":"t","message":{"id":"m","sessionId":"s","sender":{"id":"member","githubLogin":"alice","displayName":null,"avatarUrl":null},"text":"hello","attachments":[],"choice":{"agent":"claude","model":"model","effort":"high"},"createdAt":100,"state":"sent"},"attachments":[],"credential":{"agent":"claude","kind":"api-key","token":"temporary","promptCacheTtl":"unsupported"},"commitAuthor":"invalid"}"#;

#[test]
fn repairs_lone_surrogates_in_a_command_without_changing_pairs_or_literal_escapes() {
    let input = TURN.replace("hello", r#"\ud800A\udc00\uD83D\uDE00\\ud800\"\ud800"#);
    let parsed = workspace_message(input.as_bytes()).unwrap();
    let WorkspaceToRunner::RunnerCommand(command) = parsed else {
        panic!("expected a command");
    };
    let RunnerCommand::RunnerTurn(RunnerTurn::Turn {
        message,
        credential,
        commit_author,
        ..
    }) = *command
    else {
        panic!("expected a turn");
    };
    assert_eq!(message.text, "�A�😀\\ud800\"�");
    assert_eq!(commit_author, None);
    assert_eq!(
        encode(&credential).unwrap(),
        br#"{"agent":"claude","kind":"api-key","token":"temporary"}"#
    );
    for (input, expected) in [
        (r#""\ud800\ud800\udc00""#, "�𐀀"),
        (r#""\udc00\ud800""#, "��"),
        (r#""\\ud800""#, "\\ud800"),
    ] {
        assert_eq!(decode::<String>(input.as_bytes()).unwrap(), expected);
    }
    assert!(matches!(
        workspace_message(
            TURN.replace(
                "\"sessionId\":\"s\",\"sender\"",
                "\"sessionId\":\"other\",\"sender\""
            )
            .as_bytes()
        ),
        Err(Error::InvalidCommand)
    ));
}

#[test]
fn counts_node_json_escapes_and_accepts_integral_exponent_numbers() {
    assert_eq!(
        encode(&"\u{0}\u{8}\u{c}\n\r\t\"\\/é😀\u{2028}\u{2029}").unwrap(),
        "\"\\u0000\\b\\f\\n\\r\\t\\\"\\\\/é😀\u{2028}\u{2029}\"".as_bytes()
    );
    assert_eq!(decode::<u64>(b"1e2").unwrap(), 100);
    assert_eq!(decode::<u64>(b"-0").unwrap(), 0);
    assert_eq!(
        decode::<u64>(b"9007199254740991").unwrap(),
        9_007_199_254_740_991
    );
    assert!(matches!(
        decode::<u64>(b"9007199254740992"),
        Err(Error::InvalidNumber)
    ));
    for input in [b"-1".as_slice(), b"1.5", b"NaN", br#""\ud80z""#] {
        assert!(matches!(decode::<u64>(input), Err(Error::Internal(_))));
    }
    assert!(matches!(
        workspace_message(
            br#"{"type":"welcome","protocolVersion":1,"streamId":"s","confirmedThrough":0}"#
        ),
        Err(Error::Internal(_))
    ));
}
