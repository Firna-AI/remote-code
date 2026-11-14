//! Runner core exercised through a fake workspace endpoint and real state storage.

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

#[path = "core/connection_tests.rs"]
mod connection_tests;
#[path = "core/disk_tests.rs"]
mod disk_tests;
#[path = "core/envelope_tests.rs"]
mod envelope_tests;
#[path = "core/recovery_tests.rs"]
mod recovery_tests;
#[path = "core/reports/mod.rs"]
mod reports;
#[path = "core/runtime_tests.rs"]
mod runtime_tests;
mod support;
