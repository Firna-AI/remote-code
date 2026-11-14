//! Select only a program, script, module, allowed command word, and repository folder.

use std::path::{Component, Path, PathBuf};

fn interpreter(name: &str) -> Option<&str> {
    match name {
        "node" | "nodejs" => Some("node"),
        "bun" | "deno" | "ruby" | "perl" | "php" | "bash" | "sh" | "zsh" | "dash" => Some(name),
        "python" => Some("python"),
        _ if name.strip_prefix("python").is_some_and(|version| {
            !version.is_empty()
                && version
                    .split('.')
                    .all(|part| !part.is_empty() && part.bytes().all(|byte| byte.is_ascii_digit()))
        }) =>
        {
            Some("python")
        }
        _ => None,
    }
}

fn basename(path: &str) -> &str {
    path.trim_end_matches('/').rsplit('/').next().unwrap_or("")
}
fn command_word(word: &str) -> bool {
    (1..=20).contains(&word.len())
        && word.as_bytes()[0].is_ascii_lowercase()
        && word
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte == b'-')
}
fn safe_flag(flag: &str) -> bool {
    matches!(
        flag,
        "--no-warnings" | "--enable-source-maps" | "--watch" | "--inspect" | "--inspect-brk"
    ) || flag.strip_prefix("--allow-").is_some_and(|tail| {
        !tail.is_empty()
            && tail
                .bytes()
                .all(|byte| byte.is_ascii_lowercase() || byte == b'-')
    }) || flag
        .strip_prefix("--")
        .and_then(|tail| tail.split_once('='))
        .is_some_and(|(name, _)| {
            !name.is_empty()
                && name
                    .bytes()
                    .all(|byte| byte.is_ascii_lowercase() || byte == b'-')
        })
}

/// Keep complete selected labels. Rewritten interpreter titles have no inferred script.
pub fn port_name(command: &str, executable: &str) -> Option<String> {
    if !Path::new(executable).is_absolute() {
        return None;
    }
    let words: Vec<_> = command.split('\0').collect();
    let executable = basename(executable);
    let invoked = basename(words.first().copied().unwrap_or(""));
    if invoked.is_empty() {
        return None;
    }
    let runtime = interpreter(executable);
    let original = invoked == executable || (runtime.is_some() && runtime == interpreter(invoked));
    let Some(runtime) = runtime else {
        let next = words.get(1).copied().unwrap_or("");
        return Some(format!(
            "{executable}{}",
            if original && command_word(next) {
                format!(" {next}")
            } else {
                String::new()
            }
        ));
    };
    if !original {
        return None;
    }
    let mut index = 1;
    if matches!(runtime, "deno" | "bun") && words.get(index) == Some(&"run") {
        index += 1;
    }
    while let Some(flag) = words.get(index).filter(|flag| flag.starts_with('-')) {
        if (runtime == "python" && *flag == "-m") || *flag == "--" {
            index += 1;
            break;
        }
        let python = runtime == "python"
            && matches!(
                *flag,
                "-u" | "-B" | "-E" | "-I" | "-s" | "-S" | "-q" | "-v" | "-O" | "-OO"
            );
        if !python && !(runtime == "deno" && *flag == "-A") && !safe_flag(flag) {
            return None;
        }
        index += 1;
    }
    let program = words
        .get(index)
        .filter(|program| !program.is_empty() && !program.starts_with('-'))?;
    let next = words.get(index + 1).copied().unwrap_or("");
    Some(format!(
        "{}{}",
        basename(program),
        if command_word(next) {
            format!(" {next}")
        } else {
            String::new()
        }
    ))
}

fn normalize(path: &Path) -> PathBuf {
    let mut result = PathBuf::new();
    for component in path.components() {
        match component {
            Component::ParentDir => {
                result.pop();
            }
            Component::CurDir => {}
            _ => result.push(component.as_os_str()),
        }
    }
    result
}

/// Keep a complete folder only within the user's repository folders.
pub fn port_folder(value: &str, home: &Path, repository: &Path) -> Option<String> {
    if !Path::new(value).is_absolute() {
        return None;
    }
    let path = normalize(Path::new(value));
    let code = normalize(&home.join("code"));
    let in_code = path
        .strip_prefix(code)
        .ok()
        .filter(|folder| !folder.as_os_str().is_empty())?;
    let root = normalize(repository);
    let folder = path.strip_prefix(root).unwrap_or(in_code);
    (!folder.as_os_str().is_empty()).then(|| folder.to_string_lossy().into_owned())
}

#[cfg(test)]
#[path = "../_tests_/port_metadata_tests.rs"]
mod port_metadata_tests;
