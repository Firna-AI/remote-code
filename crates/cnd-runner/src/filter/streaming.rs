//! Held answer suffixes and already displayed continuation contexts.

use cnd_runner_interface::chat_events::{AgentChatEvent, TurnEventContext};
use cnd_runner_interface::runner::RunnerEvent;

use super::fields::clean;
use super::text::filter;

#[derive(Clone)]
struct Context {
    text: String,
    secrets: Vec<String>,
}

#[derive(Clone)]
struct Held {
    context: TurnEventContext,
    message_id: String,
    text: String,
    secrets: Vec<String>,
    contexts: Vec<Context>,
}

#[derive(Default, Clone)]
pub(super) struct Sanitizer {
    pub(super) secrets: Vec<String>,
    pending: Vec<Held>,
}

impl Sanitizer {
    pub(super) fn text(&self, text: &str) -> String {
        filter(text, true, &self.secrets, &[]).0
    }

    fn delta(
        &mut self,
        context: TurnEventContext,
        message_id: String,
        text: String,
        final_text: bool,
    ) -> Vec<RunnerEvent> {
        let previous = self
            .pending
            .iter()
            .position(|h| h.context == context && h.message_id == message_id)
            .map(|i| self.pending[i].clone());
        let mut secrets = self.secrets.clone();
        if let Some(held) = &previous {
            secrets.extend(held.secrets.clone());
            for c in &held.contexts {
                secrets.extend(c.secrets.clone());
            }
        }
        secrets.sort();
        secrets.dedup();
        let mut continuations = vec![];
        let contexts = previous
            .as_ref()
            .map(|h| h.contexts.clone())
            .unwrap_or_default();
        for c in &contexts {
            for (index, _) in c.text.char_indices() {
                let prefix = &c.text[index..];
                for secret in &c.secrets {
                    if secret.len() > prefix.len() && secret.starts_with(prefix) {
                        continuations.push(secret[prefix.len()..].to_owned());
                    }
                }
            }
        }
        let source = previous
            .as_ref()
            .map(|h| h.text.as_str())
            .unwrap_or_default()
            .to_owned()
            + &text;
        let (shown, held_text) = filter(&source, final_text, &secrets, &continuations);
        let mut texts: Vec<String> = contexts.iter().map(|c| c.text.clone() + &shown).collect();
        texts.push(shown.clone());
        self.retain(
            context.clone(),
            message_id.clone(),
            held_text,
            secrets,
            texts,
        );
        if shown.is_empty() {
            vec![]
        } else {
            vec![RunnerEvent::AgentChatEvent(
                AgentChatEvent::AssistantDelta {
                    turn_event_context: context,
                    message_id,
                    text: shown,
                },
            )]
        }
    }

    fn retain(
        &mut self,
        context: TurnEventContext,
        message_id: String,
        text: String,
        secrets: Vec<String>,
        texts: Vec<String>,
    ) {
        let mut contexts: Vec<Context> = vec![];
        for value in texts {
            let suffix = filter(&value, false, &secrets, &[]).1;
            if !suffix.is_empty() && !contexts.iter().any(|c| c.text == suffix) {
                let matched = secrets
                    .iter()
                    .filter(|s| !filter(&suffix, false, &[(*s).clone()], &[]).1.is_empty())
                    .cloned()
                    .collect();
                contexts.push(Context {
                    text: suffix,
                    secrets: matched,
                });
            }
        }
        if !text.is_empty() || !contexts.is_empty() {
            let secrets = secrets
                .into_iter()
                .filter(|s| {
                    !filter(&text, false, std::slice::from_ref(s), &[])
                        .1
                        .is_empty()
                })
                .collect();
            let held = Held {
                context,
                message_id,
                text,
                secrets,
                contexts,
            };
            if let Some(index) = self
                .pending
                .iter()
                .position(|h| h.context == held.context && h.message_id == held.message_id)
            {
                self.pending[index] = held;
            } else {
                self.pending.push(held);
            }
        } else {
            self.pending
                .retain(|h| h.context != context || h.message_id != message_id);
        }
    }

    fn flush(&mut self, context: &TurnEventContext, message: Option<&str>) -> Vec<RunnerEvent> {
        let held: Vec<_> = self
            .pending
            .iter()
            .filter(|h| {
                h.context == *context
                    && message.is_none_or(|id| id == h.message_id)
                    && !h.text.is_empty()
            })
            .cloned()
            .collect();
        let mut events = vec![];
        for h in held {
            events.extend(self.delta(h.context, h.message_id, String::new(), true));
        }
        events
    }

    pub(super) fn accept(&mut self, mut event: RunnerEvent) -> Vec<RunnerEvent> {
        let mut events = vec![];
        match &mut event {
            RunnerEvent::AgentChatEvent(AgentChatEvent::AssistantDelta {
                turn_event_context,
                message_id,
                text,
            }) => {
                return self.delta(
                    turn_event_context.clone(),
                    message_id.clone(),
                    text.clone(),
                    false,
                );
            }
            RunnerEvent::AgentChatEvent(AgentChatEvent::AssistantCompleted {
                turn_event_context,
                message_id,
                text,
                ..
            }) => {
                events.extend(self.flush(turn_event_context, Some(message_id)));
                let previous = self
                    .pending
                    .iter()
                    .position(|h| h.context == *turn_event_context && h.message_id == *message_id)
                    .map(|i| self.pending[i].clone());
                let mut secrets = self.secrets.clone();
                let mut texts = vec![];
                if let Some(h) = previous {
                    secrets.extend(h.secrets);
                    for c in h.contexts {
                        texts.push(c.text);
                        secrets.extend(c.secrets);
                    }
                }
                secrets.sort();
                secrets.dedup();
                *text = filter(text, true, &secrets, &[]).0;
                texts.push(text.clone());
                self.retain(
                    turn_event_context.clone(),
                    message_id.clone(),
                    String::new(),
                    secrets,
                    texts,
                );
                events.push(event);
                return events;
            }
            RunnerEvent::AgentChatEvent(
                AgentChatEvent::TurnCompleted {
                    turn_event_context, ..
                }
                | AgentChatEvent::TurnFailed {
                    turn_event_context, ..
                },
            ) => events.extend(self.flush(turn_event_context, None)),
            _ => {}
        }
        events.push(clean(event, &|s| self.text(s)));
        events
    }
}
