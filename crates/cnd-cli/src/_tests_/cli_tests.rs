//! Command parsing for the implemented relay.

use crate::cli::Cli;
use clap::Parser;

#[test]
fn relay_uses_the_private_socket_without_address_options() {
    let cli = Cli::try_parse_from(["conductive", "relay"]);
    assert!(cli.is_ok());
    let error = Cli::try_parse_from(["conductive", "relay", "--port", "7682"]).err();
    assert_eq!(
        error.map(|value| value.kind()),
        Some(clap::error::ErrorKind::UnknownArgument)
    );
}
