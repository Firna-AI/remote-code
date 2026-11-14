//! Runtime context keeps explicit values ahead of saved shell variables.

use crate::client::Configuration;
use crate::error::Result;

const NAMES: [&str; 3] = [
    "CONDUCTIVE_MACHINE_ORIGIN",
    "CONDUCTIVE_WORKSPACE_TOKEN",
    "CONDUCTIVE_TURN_ID",
];

/// Process environment and the sandbox's saved environment file.
#[cfg_attr(test, unimock::unimock(api = EnvironmentMock))]
pub trait Environment: Send + Sync {
    /// Return a variable, including an explicitly supplied empty string.
    fn variable(&self, name: &str) -> Option<String>;
    /// Read saved values using the shell syntax of the sandbox environment.
    fn saved(&self) -> Result<[Option<String>; 3]>;
    /// Resolve runtime fields before saved values can replace them.
    fn configuration(&self) -> Result<Configuration> {
        let mut values = NAMES.map(|name| self.variable(name));
        if values.iter().any(Option::is_none) {
            for (value, saved) in values.iter_mut().zip(self.saved()?) {
                if value.is_none() {
                    *value = saved;
                }
            }
        }
        let [origin, token, turn] = values;
        Configuration::new(origin, token, turn)
    }
}

#[cfg(test)]
#[path = "_tests_/environment_tests.rs"]
mod environment_tests;
