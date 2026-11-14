//! Saved settings never supply a stale turn ID.

use unimock::{MockFn, Unimock, matching};

use crate::error::Result;
use crate::ports::{Environment, EnvironmentMock};

#[test]
fn uses_only_the_callers_turn_with_saved_machine_settings() -> Result<()> {
    for turn in ["current-turn", ""] {
        let environment = Unimock::new_partial((
            EnvironmentMock::caller_turn
                .some_call(matching!())
                .returns(turn.to_string()),
            EnvironmentMock::saved
                .some_call(matching!())
                .returns(Ok(["https://saved.test".into(), "saved-token".into()])),
        ));
        let context = environment.context()?;
        assert_eq!(context.turn, turn);
        assert_eq!(context.origin, "https://saved.test");
        assert_eq!(context.token, "saved-token");
    }
    Ok(())
}
