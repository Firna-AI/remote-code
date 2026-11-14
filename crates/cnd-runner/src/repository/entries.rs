//! NUL-delimited Git records preserve literal whitespace and pathspec characters.

use super::error::{Error, Result};

#[derive(Debug, Clone)]
pub(super) struct GitEntry {
    pub mode: String,
    pub oid: String,
    pub stage: String,
    pub path: String,
}

pub(super) fn zero_paths(bytes: &[u8]) -> Vec<String> {
    String::from_utf8_lossy(bytes)
        .split('\0')
        .filter(|path| !path.is_empty())
        .map(str::to_owned)
        .collect()
}

pub(super) fn path_input(paths: &[String]) -> Vec<u8> {
    paths
        .iter()
        .flat_map(|path| path.bytes().chain([0]))
        .collect()
}

fn mode(value: &str) -> bool {
    matches!(value, "100644" | "100755" | "120000" | "160000")
}

fn oid(value: &str) -> bool {
    !value.is_empty()
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || matches!(byte, b'a'..=b'f'))
}

pub(super) fn index_entries(bytes: &[u8]) -> Result<Vec<GitEntry>> {
    zero_paths(bytes)
        .into_iter()
        .map(|record| {
            let (header, path) = record.split_once('\t').ok_or(Error::InvalidOutput)?;
            let fields: Vec<_> = header.split(' ').collect();
            if fields.len() != 3
                || !mode(fields[0])
                || !oid(fields[1])
                || path.is_empty()
                || !matches!(fields[2], "0" | "1" | "2" | "3")
            {
                return Err(Error::InvalidOutput);
            }
            Ok(GitEntry {
                mode: fields[0].into(),
                oid: fields[1].into(),
                stage: fields[2].into(),
                path: path.into(),
            })
        })
        .collect()
}

pub(super) fn tree_entries(bytes: &[u8]) -> Vec<GitEntry> {
    zero_paths(bytes)
        .into_iter()
        .filter_map(|record| {
            let (header, path) = record.split_once('\t')?;
            let fields: Vec<_> = header.split(' ').collect();
            if fields.len() != 3
                || !mode(fields[0])
                || !oid(fields[2])
                || path.is_empty()
                || !matches!(fields[1], "blob" | "commit")
            {
                return None;
            }
            Some(GitEntry {
                mode: fields[0].into(),
                oid: fields[2].into(),
                stage: "0".into(),
                path: path.into(),
            })
        })
        .collect()
}
