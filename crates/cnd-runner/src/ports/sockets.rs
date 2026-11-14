//! Decode Linux little-endian socket words and exclude the image's own services.

/// Stable identity for one IPv4 or IPv6 listener.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ListeningSocket {
    /// Address, port, and inode identify metadata's lifetime.
    pub identity: String,
    /// Socket inode used to find an owning process descriptor.
    pub inode: String,
    /// TCP port.
    pub port: u64,
}

fn preview_address(address: &str, ipv6: bool) -> bool {
    if address.len() != if ipv6 { 32 } else { 8 }
        || !address.bytes().all(|byte| byte.is_ascii_hexdigit())
    {
        return false;
    }
    let mut bytes = Vec::new();
    for word in address.as_bytes().chunks(8) {
        for pair in word.chunks(2).rev() {
            let Ok(pair) = std::str::from_utf8(pair) else {
                return false;
            };
            let Ok(value) = u8::from_str_radix(pair, 16) else {
                return false;
            };
            bytes.push(value);
        }
    }
    if bytes.iter().all(|byte| *byte == 0) {
        return true;
    }
    if !ipv6 {
        return bytes[0] == 127;
    }
    (bytes[..15].iter().all(|byte| *byte == 0) && bytes[15] == 1)
        || (bytes[..10].iter().all(|byte| *byte == 0)
            && bytes[10..12] == [255, 255]
            && (bytes[12] == 127 || bytes[12..].iter().all(|byte| *byte == 0)))
}

/// Select same-user wildcard or loopback TCP listeners. Malformed rows are ignored.
pub fn listening_sockets(table: &str, ipv6: bool, uid: u32) -> Vec<ListeningSocket> {
    let mut result = vec![];
    for row in table.lines() {
        let fields: Vec<_> = row.split_whitespace().collect();
        if fields.len() < 10
            || !fields[3].eq_ignore_ascii_case("0A")
            || (!fields[7].bytes().all(|byte| byte.is_ascii_digit())
                || fields[7].parse::<u32>() != Ok(uid))
        {
            continue;
        }
        let Some((address, port)) = fields[1].split_once(':') else {
            continue;
        };
        if port.len() != 4
            || !port.bytes().all(|byte| byte.is_ascii_hexdigit())
            || !preview_address(address, ipv6)
        {
            continue;
        }
        let Ok(port) = u64::from_str_radix(port, 16) else {
            continue;
        };
        let inode = fields[9];
        if port == 0
            || [7681, 7682, 8911, 47984, 47989, 47990, 48010].contains(&port)
            || !inode.starts_with(|c: char| c.is_ascii_digit() && c != '0')
            || !inode.bytes().all(|byte| byte.is_ascii_digit())
        {
            continue;
        }
        result.push(ListeningSocket {
            identity: format!("{ipv6}:{}:{port}:{inode}", address.to_ascii_uppercase()),
            inode: inode.into(),
            port,
        });
    }
    result
}
