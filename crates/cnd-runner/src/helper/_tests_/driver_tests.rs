//! EOF closes the request registry before later callers can insert work.

use std::sync::Arc;

use cnd_runner_interface::agents::{Agent, AgentChoice, Effort};
use cnd_runner_interface::provider_events::ProviderEvent;
use cnd_runner_interface::sdk_helper::HelperOutput;
use tokio::sync::mpsc;
use unimock::{MockFn, Unimock, matching};

use crate::error::Error;
use crate::helper::boundary::{Helper, HelperEvents, HelperPortMock};
use crate::helper::driver::HelperConnection;

struct Output(mpsc::UnboundedSender<HelperOutput>);
impl HelperEvents for Output {
    fn output(&self, output: HelperOutput) {
        let _ = self.0.send(output);
    }
}

#[tokio::test]
async fn refuses_new_requests_after_eof_without_writing_private_input()
-> Result<(), Box<dyn std::error::Error>> {
    let port = Arc::new(Unimock::new((
        HelperPortMock::read
            .some_call(matching!())
            .returns(Ok(None)),
        HelperPortMock::terminate
            .each_call(matching!())
            .answers(&|_| Ok(())),
        HelperPortMock::exited
            .some_call(matching!())
            .returns(Ok(())),
    )));
    let (sender, mut receiver) = mpsc::unbounded_channel();
    let helper = HelperConnection::new(port, Arc::new(Output(sender)));
    assert_eq!(
        receiver.recv().await,
        Some(HelperOutput::Event {
            event: ProviderEvent::Failed {
                code: "agent_exited".into(),
                message: "The SDK helper process ended.".into()
            }
        })
    );
    let choice = AgentChoice {
        agent: Agent::Claude,
        model: "unused".into(),
        effort: Effort::High,
        fast: false,
    };
    assert!(matches!(
        helper.model(choice).await,
        Err(Error::HelperExited)
    ));
    helper.close().await?;
    Ok(())
}
