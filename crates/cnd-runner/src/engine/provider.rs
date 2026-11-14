//! Start options and cancelable helper requests preserve original turn authority.

use std::sync::Arc;

use cnd_runner_interface::agents::Agent;
use cnd_runner_interface::runner_commands::RunnerTurn;
use cnd_runner_interface::sdk_helper::{HelperModelResult, HelperOutput};
use cnd_runner_interface::sdk_helper_options::{
    HelperCredential, HelperOptions, ProviderInput, WorkspaceToolContext,
};
use tokio::sync::mpsc;
use url::Url;

use crate::error::{Error, ErrorResultExt, Result};
use crate::helper::boundary::HelperEvents;

use super::control::Control;
use super::types::{Session, Work, identity};

struct ForwardOutput {
    mailbox: mpsc::UnboundedSender<Work>,
    generation: u64,
    control: Control,
}
impl HelperEvents for ForwardOutput {
    fn output(&self, output: HelperOutput) {
        if !self.control.stopped() {
            let _ = self.mailbox.send(Work::Output(self.generation, output));
        }
    }
}

impl Session {
    pub(super) async fn start(&mut self, input: ProviderInput) -> Result<()> {
        let (_, _, message) = identity(&input);
        self.choice = Some(message.choice.clone());
        self.generation += 1;
        let saved = self.saved.as_ref().ok_or(Error::InvalidCommand)?;
        let turn = self.active.as_mut().ok_or(Error::InvalidCommand)?;
        let control = turn.control.clone();
        let helper = self.dependencies.helpers.open(Arc::new(ForwardOutput {
            mailbox: self.mailbox.clone(),
            generation: self.generation,
            control: control.clone(),
        }))?;
        turn.helper = Some(helper.clone());
        let mut origin = Url::parse(&self.dependencies.configuration.request.url).internal()?;
        if origin.scheme() == "wss" {
            let _ = origin.set_scheme("https");
        }
        origin.set_path("");
        origin.set_query(None);
        origin.set_fragment(None);
        let endpoint = origin
            .join(if saved.agent == Agent::Claude {
                "/v1/model/claude"
            } else {
                "/v1/model/codex"
            })
            .internal()?
            .to_string();
        let RunnerTurn::Turn {
            credential,
            commit_author,
            turn_id,
            ..
        } = &turn.first;
        let options = HelperOptions {
            cwd: self
                .dependencies
                .configuration
                .cwd
                .to_string_lossy()
                .into_owned(),
            home: self
                .dependencies
                .configuration
                .home
                .to_string_lossy()
                .into_owned(),
            session_id: saved.session_id.clone(),
            endpoint,
            credential: HelperCredential::Gateway {
                credential: credential.clone(),
            },
            commit_author: commit_author.clone(),
            choice: message.choice.clone(),
            conversation_id: saved.provider_session_id.clone(),
            instructions: saved.instructions.clone().unwrap_or_default(),
            instruction_branches: saved.instruction_branches.clone().flatten(),
            tools: WorkspaceToolContext {
                machine_origin: origin.origin().ascii_serialization(),
                workspace_token: self
                    .dependencies
                    .configuration
                    .request
                    .workspace_token
                    .clone(),
                turn_id: turn_id.clone(),
            },
            background_note_ids: turn.notes.iter().cloned().collect(),
        };
        control.run(helper.start(options)).await?;
        control.run(helper.send(input)).await
    }

    pub(super) async fn deliver(&mut self, input: ProviderInput) -> Result<HelperModelResult> {
        let turn = self.active.as_mut().ok_or(Error::InvalidCommand)?;
        let helper = turn.helper.clone().ok_or(Error::HelperExited)?;
        let (_, _, message) = identity(&input);
        let id = message.id.clone();
        self.choice = Some(message.choice.clone());
        let result = turn.control.run(helper.model(message.choice.clone())).await;
        if matches!(result, Ok(HelperModelResult::Deferred)) {
            return result;
        }
        turn.message_ids.push(id);
        result?;
        turn.control.run(helper.send(input)).await?;
        Ok(HelperModelResult::Applied)
    }
}
