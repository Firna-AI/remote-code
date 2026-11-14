//! Runtime values override saved context, including explicitly empty values.

use unimock::{MockFn, Unimock, matching};

use crate::environment::{Environment, EnvironmentMock};
use crate::error::{Error, ErrorResultExt, InputError, Result};

#[test]
fn keeps_runtime_context_and_uses_saved_values_only_when_absent() -> Result<()> {
    let environment = Unimock::new((
        EnvironmentMock::variable
            .some_call(matching!("CONDUCTIVE_MACHINE_ORIGIN"))
            .returns(Some("https://active.test".into())),
        EnvironmentMock::variable
            .some_call(matching!("CONDUCTIVE_WORKSPACE_TOKEN"))
            .returns(Some("active-token".into())),
        EnvironmentMock::variable
            .some_call(matching!("CONDUCTIVE_TURN_ID"))
            .returns(None),
        EnvironmentMock::saved.some_call(matching!()).returns(Ok([
            Some("https://stale.test".into()),
            Some("stale-token".into()),
            Some("saved-turn".into()),
        ])),
    ));
    let result = environment.configuration().internal()?;
    assert_eq!(
        result.context(),
        ("https://active.test", "active-token", Some("saved-turn"))
    );
    let empty = Unimock::new((
        EnvironmentMock::variable
            .some_call(matching!("CONDUCTIVE_MACHINE_ORIGIN"))
            .returns(Some("".into())),
        EnvironmentMock::variable
            .some_call(matching!("CONDUCTIVE_WORKSPACE_TOKEN"))
            .returns(Some("".into())),
        EnvironmentMock::variable
            .some_call(matching!("CONDUCTIVE_TURN_ID"))
            .returns(Some("".into())),
    ));
    assert!(matches!(
        empty.configuration(),
        Err(Error::Input(InputError::Credentials))
    ));
    Ok(())
}
