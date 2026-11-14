//! Git comparisons, safe file access, and captured repository reports.

mod access;
mod changes;
mod checkpoint;
mod context;
mod diff;
mod entries;
pub mod error;
pub mod git;
mod index;
pub mod io;
pub mod paths;
pub mod service;
mod setup;
mod snapshot;
