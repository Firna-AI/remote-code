//! Staged downloads and restart-time activation of sandbox releases.

pub mod disk;
mod download;
pub mod engine;
pub mod error;
pub mod http;
pub mod ports;
pub mod process;
pub mod staging;
mod state;

#[cfg(test)]
#[path = "_tests_/apply_tests.rs"]
mod apply_tests;
#[cfg(test)]
#[path = "_tests_/check_tests.rs"]
mod check_tests;
#[cfg(test)]
#[path = "_tests_/parts_tests.rs"]
mod parts_tests;

#[cfg(test)]
#[path = "_tests_/support.rs"]
mod test_support;

#[cfg(test)]
#[path = "_tests_/warning_tests.rs"]
mod warning_tests;
