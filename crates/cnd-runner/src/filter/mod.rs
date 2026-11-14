//! Shared credential filtering before persistence and report byte limits.

mod fields;
pub mod service;
mod streaming;
mod text;

#[cfg(test)]
#[path = "_tests_/filter_tests.rs"]
mod filter_tests;

#[cfg(test)]
#[path = "_tests_/fields_tests.rs"]
mod fields_tests;
