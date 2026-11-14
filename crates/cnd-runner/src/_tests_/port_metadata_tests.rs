//! Socket filtering and complete selected labels protect the private metadata boundary.

use std::path::Path;

use crate::ports::metadata::{port_folder, port_name};
use crate::ports::sockets::listening_sockets;

#[test]
fn selects_only_same_user_loopback_and_wildcard_listeners_and_excludes_image_services() {
    let rows = [
        ("00000000", 5000, "0A", "1000", "1"),
        ("0100007F", 3000, "0A", "1000", "2"),
        ("0200007F", 3001, "0A", "1000", "3"),
        ("0100A8C0", 3002, "0A", "1000", "4"),
        ("00000000", 3003, "0A", "0", "5"),
        ("00000000", 3004, "01", "1000", "6"),
        ("00000000", 7681, "0A", "1000", "7"),
        ("00000000", 7682, "0A", "1000", "8"),
        ("00000000", 8911, "0A", "1000", "9"),
        ("00000000", 47984, "0A", "1000", "10"),
        ("00000000", 47989, "0A", "1000", "11"),
        ("00000000", 47990, "0A", "1000", "12"),
        ("00000000", 48010, "0A", "1000", "13"),
        ("00000000", 8912, "0A", "1000", "14"),
        ("00000000", 0, "0A", "1000", "15"),
        ("00000000", 3006, "0A", "+1000", "16"),
    ];
    let table = rows
        .iter()
        .map(|(address, port, state, uid, inode)| {
            format!("0: {address}:{port:04X} 0:0 {state} 0:0 0:0 0 {uid} 0 {inode}\n")
        })
        .collect::<String>();
    assert_eq!(
        listening_sockets(&table, false, 1000)
            .iter()
            .map(|socket| socket.port)
            .collect::<Vec<_>>(),
        [5000, 3000, 3001, 8912]
    );
    let ipv6 = [
        "00000000000000000000000000000000",
        "00000000000000000000000001000000",
        "0000000000000000FFFF00000100007F",
        "0000000000000000FFFF000000000000",
        "B80D0120000000000000000001000000",
    ];
    let table = ipv6
        .iter()
        .enumerate()
        .map(|(index, address)| {
            format!("0: {address}:0FA0 0:0 0A 0:0 0:0 0 1000 0 {}\n", index + 1)
        })
        .collect::<String>();
    assert_eq!(listening_sockets(&table, true, 1000).len(), 4);
    assert!(
        listening_sockets(
            "bad row\n0: ZZZZZZZZ:1234 0:0 0A 0:0 0:0 0 1000 0 9",
            false,
            1000
        )
        .is_empty()
    );
}

#[test]
fn keeps_complete_program_or_script_labels_and_only_repository_relative_folders() {
    let cases = [
        (
            "node\0/repo/node_modules/.bin/vite\0dev\0--token=Secret42",
            "/usr/bin/node",
            Some("vite dev"),
        ),
        (
            "python3\0-m\0http.server\08000",
            "/usr/bin/python3.12",
            Some("http.server"),
        ),
        (
            "deno\0run\0--allow-net\0/repo/server.ts\0serve",
            "/usr/bin/deno",
            Some("server.ts serve"),
        ),
        (
            "bun\0run\0/repo/server.ts\0dev",
            "/usr/bin/bun",
            Some("server.ts dev"),
        ),
        (
            "/repo/program\0--password=secret",
            "/repo/program",
            Some("program"),
        ),
        (
            "node\0/repo/server.js\0dev2",
            "/usr/bin/node",
            Some("server.js"),
        ),
        (
            "node\0/repo/server.js\0Secret",
            "/usr/bin/node",
            Some("server.js"),
        ),
        ("node\0-e\0Secret42", "/usr/bin/node", None),
        ("vite --token FAKE_TOKEN_42", "/usr/bin/node", None),
        ("node\0--require\0secret", "/usr/bin/node", None),
    ];
    for (command, executable, expected) in cases {
        assert_eq!(
            port_name(command, executable).as_deref(),
            expected,
            "{command:?}"
        );
    }
    let long = format!("development-{} secretpass", "x".repeat(60));
    assert_eq!(
        port_name(
            &format!("node\0/repo/{long}\0--token=UNSELECTED"),
            "/usr/bin/node"
        ),
        Some(long)
    );
    let home = Path::new("/home/user");
    let root = Path::new("/home/user/code/web");
    for (cwd, expected) in [
        ("/home/user/code/web", None),
        ("/home/user/code/web/apps/web", Some("apps/web")),
        ("/home/user/code/api", Some("api")),
        ("/home/user/code/api/server", Some("api/server")),
        ("/home/user/code", None),
        ("/home/user/code-other/private", None),
        ("/tmp/private", None),
    ] {
        assert_eq!(port_folder(cwd, home, root).as_deref(), expected);
    }
    let long = format!("secretpass/{}", "z".repeat(115));
    assert_eq!(
        port_folder(&format!("/home/user/code/web/{long}"), home, root),
        Some(long)
    );
}
