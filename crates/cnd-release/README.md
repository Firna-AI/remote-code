# cnd-release

This crate owns the release parts format and writes Conductive release
files. The deploy command uses its filesystem boundary. The `conductive`
build script uses the same parts reader. Depend on this crate to read or
write that format.

## Responsibilities

- Validate versioned parts files, HTTPS URLs, and required SHA-256 digests.
- Write reproducible program archives, parts files, and updater metadata.
- Compare commit-count versions before a deploy replaces the newest version.

## What This Crate Does

`PartsList` schema version 1 holds a list of parts. Each part has a stable
`name`, an absolute HTTPS `url`, and a `sha256` digest. A new part needs one
entry. Readers accept added JSON fields. Incompatible schema versions,
duplicate names, and invalid downloads fail. Each release program checks
that its embedded list contains the roles that it needs. Older updaters
keep no fixed list of required roles.

`ReleaseFiles` owns the filesystem boundary. `DiskReleaseFiles` writes
files below the supplied output folder, with paths that match their R2
keys. Each archive holds one executable named `conductive`. The archive
headers have fixed timestamps and permissions. The program archive and
the parts filename hold the SHA-256 digest of their bytes.

The deploy also runs `bash image/package-system.sh OUTPUT`. That command
writes the digest-named system archive and prints its digest. The system
part carries the sandbox scripts, units, GitHub CLI wrapper, and udev rule.
The deploy also runs `node runner/sdk-helper/scripts/package.mjs OUTPUT`.
That command writes `sdk-helper-<sha256>.tar.gz` and prints its digest.
The helper part holds its Node bundle, runtime npm packages, and agent programs.
Its Node runtime stays in the separate `node` part.
The Rust executable starts the helper from the same pinned release folder.
The complete parts list holds `node`, `sdk-helper`, and `system`.

The updater reads the parts embedded in the checked new executable.

The `parts` command writes an input file for the program build. Repeat
`--part NAME URL SHA256` for each part. The `package` command writes the
release files. Build its program with the same version and parts file.
The `newer` command prints `true` or `false`. Invalid metadata fails the
command. These commands upload nothing.

## Quick Start

Run from the repository root. Supply the real SDK helper, Node, and system URLs and digests:

```sh
cargo run -p cnd-release -- parts \
  --part node "$NODE_URL" "$NODE_SHA256" \
  --part sdk-helper "$SDK_HELPER_URL" "$SDK_HELPER_SHA256" \
  --part system "$SYSTEM_URL" "$SYSTEM_SHA256" \
  --output "$PWD/.context/release-input/parts.json"
CONDUCTIVE_RELEASE_VERSION=0.0.42 \
CONDUCTIVE_PARTS_FILE="$PWD/.context/release-input/parts.json" \
  cargo build --release --target x86_64-unknown-linux-musl -p cnd-cli
cargo run -p cnd-release -- package --version 0.0.42 \
  --program target/x86_64-unknown-linux-musl/release/conductive \
  --parts .context/release-input/parts.json --output .context/release-artifact
```

## Development

```sh
cargo test -p cnd-release
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
```

The disk integration test reads the written metadata as `ReleaseAssetInfo`
and installs its archive through `cli-updater` with the required digest.

### Key Code

- [parts.rs](src/parts.rs) defines and validates the shared parts format.
- [files.rs](src/files.rs) defines `ReleaseFiles` and the deterministic writer.
- [version.rs](src/version.rs) owns the release identity and version ordering.
- [main.rs](src/main.rs) defines the packaging command interface.
- [package_tests.rs](tests/package_tests.rs) checks the written release through the updater installer.

### Related Docs

- [Deployment release files](../../docs/deployment/runner-archive.md#the-release-in-each-deploy) gives the R2 paths and publication rules.
- [Sandbox software](../../image/README.md) describes the installed software.
- [Architecture](../../docs/architecture.md) describes the system.
