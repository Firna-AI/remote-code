//! Repair only unpaired surrogate escapes inside JSON strings.

pub(super) fn repair(bytes: &[u8]) -> Vec<u8> {
    let mut output = Vec::with_capacity(bytes.len());
    let mut index = 0;
    let mut quoted = false;
    while index < bytes.len() {
        let byte = bytes[index];
        if byte == b'"' {
            quoted = !quoted;
        }
        if quoted && byte == b'\\' {
            if let Some(unit) = escaped_unit(bytes, index) {
                if (0xd800..=0xdbff).contains(&unit) {
                    if escaped_unit(bytes, index + 6)
                        .is_some_and(|low| (0xdc00..=0xdfff).contains(&low))
                    {
                        output.extend_from_slice(&bytes[index..index + 12]);
                        index += 12;
                        continue;
                    }
                    output.extend_from_slice(b"\\ufffd");
                    index += 6;
                    continue;
                }
                if (0xdc00..=0xdfff).contains(&unit) {
                    output.extend_from_slice(b"\\ufffd");
                    index += 6;
                    continue;
                }
            }
            if let Some(next) = bytes.get(index + 1) {
                output.extend_from_slice(&[byte, *next]);
                index += 2;
                continue;
            }
        }
        output.push(byte);
        index += 1;
    }
    output
}

fn escaped_unit(bytes: &[u8], index: usize) -> Option<u16> {
    let escape = bytes.get(index..index + 6)?;
    if &escape[..2] != b"\\u" {
        return None;
    }
    let mut value = 0;
    for byte in &escape[2..] {
        value = value * 16 + char::from(*byte).to_digit(16)? as u16;
    }
    Some(value)
}
