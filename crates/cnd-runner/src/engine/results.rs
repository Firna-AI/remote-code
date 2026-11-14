//! Exact result lists, background boundaries, and deferred input handoff.

use cnd_runner_interface::chat_events::{ToolCallState, TurnEndReason, TurnSpeed};
use cnd_runner_interface::provider_events::{ProviderEvent, ProviderResultState};
use cnd_runner_interface::sdk_helper::{HelperModelResult, HelperOutput};

use crate::error::{Error, Result};

use super::background::Disposition;
use super::types::{End, Session, identity};

impl Session {
    pub(super) async fn output(&mut self, output: HelperOutput) -> Result<()> {
        match output {
            HelperOutput::Warning { message } => {
                let message = self.dependencies.credentials.text(&message)?;
                tracing::warn!("{message}");
                Ok(())
            }
            HelperOutput::BackgroundNotes { ids } => {
                if let Some(turn) = &mut self.active {
                    turn.notes.extend(ids);
                }
                Ok(())
            }
            HelperOutput::Event { event } => self.event(event).await,
            _ => Ok(()),
        }
    }

    async fn event(&mut self, event: ProviderEvent) -> Result<()> {
        let Some(turn) = &mut self.active else {
            return Ok(());
        };
        if turn.control.stopped()
            && matches!(
                &event,
                ProviderEvent::Result { .. }
                    | ProviderEvent::Failed { .. }
                    | ProviderEvent::Conversation { .. }
            )
        {
            return Ok(());
        }
        match &event {
            ProviderEvent::Conversation { id } => {
                if let Some(saved) = &mut self.saved
                    && saved.provider_session_id.as_ref() != Some(id)
                {
                    saved.provider_session_id = Some(id.clone());
                    turn.control
                        .run(self.dependencies.store.remember(saved.clone()))
                        .await?;
                }
                return Ok(());
            }
            ProviderEvent::Speed { speed } => {
                if turn.speed.is_none()
                    || matches!(speed, TurnSpeed::Standard { .. })
                        && matches!(
                            &turn.speed,
                            Some(TurnSpeed::Fast | TurnSpeed::Standard { cause: None })
                        )
                {
                    turn.speed = Some(speed.clone());
                }
                return Ok(());
            }
            ProviderEvent::Background { live, idle } => {
                let done = turn
                    .background
                    .as_mut()
                    .is_some_and(|b| b.work(*live, *idle));
                if done && turn.message_ids.iter().all(|id| turn.resolved.contains(id)) {
                    return self
                        .result(ProviderResultState::Finished, vec![], None, true)
                        .await;
                }
                return Ok(());
            }
            ProviderEvent::Activity { idle } => {
                let done = turn.background.as_mut().is_some_and(|b| b.activity(*idle));
                if done && turn.message_ids.iter().all(|id| turn.resolved.contains(id)) {
                    return self
                        .result(ProviderResultState::Finished, vec![], None, true)
                        .await;
                }
                return Ok(());
            }
            _ => {}
        }
        let events = turn.output.accept(&event);
        self.emit(events).await?;
        let Some(turn) = &self.active else {
            return Ok(());
        };
        if turn.control.stopped() {
            return Ok(());
        }
        match event {
            ProviderEvent::Tool { tool }
                if tool.state == ToolCallState::Running && !turn.waiting.is_empty() =>
            {
                if let Some(helper) = &turn.helper {
                    turn.control.run(helper.interrupt()).await?;
                }
                Ok(())
            }
            ProviderEvent::Failed { code, message } => {
                self.finish(End::Failed(Error::Agent { code, message }))
                    .await
            }
            ProviderEvent::Result {
                state,
                user_message_ids,
                end_reason,
            } => {
                self.result(state, user_message_ids, end_reason, false)
                    .await
            }
            ProviderEvent::WakeUp { state } => self.result(state, vec![], None, true).await,
            _ => Ok(()),
        }
    }

    pub(super) async fn result(
        &mut self,
        state: ProviderResultState,
        messages: Vec<String>,
        reason: Option<TurnEndReason>,
        wake: bool,
    ) -> Result<()> {
        let Some(turn) = &mut self.active else {
            return Ok(());
        };
        if !wake {
            turn.resolved.extend(if messages.is_empty() {
                turn.message_ids.clone()
            } else {
                messages
            });
        }
        if turn
            .message_ids
            .iter()
            .any(|id| !turn.resolved.contains(id))
        {
            return Ok(());
        }
        let Some(next) = turn.waiting.pop_front() else {
            let disposition = if state == ProviderResultState::Finished {
                turn.background
                    .as_mut()
                    .map(|b| {
                        b.reply(
                            self.dependencies.clock.now().unwrap_or_default(),
                            self.dependencies.background_limit,
                        )
                    })
                    .unwrap_or(Disposition::Finish)
            } else {
                Disposition::Finish
            };
            if disposition == Disposition::Wait {
                return Ok(());
            }
            return self
                .finish(End::Result(
                    state,
                    if disposition == Disposition::Limit {
                        Some(TurnEndReason::BackgroundWorkLimit)
                    } else {
                        reason
                    },
                ))
                .await;
        };
        let events = turn.output.finish(ToolCallState::Stopped);
        if let Some(background) = &mut turn.background {
            background.restart();
        }
        self.emit(events).await?;
        self.generation += 1;
        let turn = self.active.as_mut().ok_or(Error::InvalidCommand)?;
        if let Some(helper) = &turn.helper {
            turn.control.run(helper.close()).await?;
        }
        turn.helper = None;
        let (_, _, message) = identity(&next);
        turn.message_ids.push(message.id.clone());
        turn.retry_message_id = message.id.clone();
        self.start(next).await?;
        loop {
            let next = self
                .active
                .as_mut()
                .and_then(|turn| turn.waiting.pop_front());
            let Some(next) = next else {
                break;
            };
            if self.deliver(next.clone()).await? == HelperModelResult::Deferred {
                if let Some(turn) = &mut self.active {
                    turn.waiting.push_front(next);
                }
                break;
            }
        }
        Ok(())
    }
}
