//! Ordered streaming buffers and final tool state updates.

use cnd_runner_interface::chat_events::{
    AgentChatEvent, ToolCall, ToolCallState, TurnEventContext,
};
use cnd_runner_interface::provider_events::ProviderEvent;
use tokio::time::Instant;

pub(super) struct TurnOutput {
    context: TurnEventContext,
    deltas: Vec<(String, String)>,
    tools: Vec<ToolCall>,
    thinking: bool,
    pub(super) due: Option<Instant>,
}

impl TurnOutput {
    pub(super) fn new(context: TurnEventContext) -> Self {
        Self {
            context,
            deltas: vec![],
            tools: vec![],
            thinking: false,
            due: None,
        }
    }
    pub(super) fn accept(&mut self, event: &ProviderEvent) -> Vec<AgentChatEvent> {
        if let ProviderEvent::Delta { message_id, text } = event {
            if let Some((_, value)) = self.deltas.iter_mut().find(|(id, _)| id == message_id) {
                value.push_str(text);
            } else {
                self.deltas.push((message_id.clone(), text.clone()));
            }
            self.due
                .get_or_insert_with(|| Instant::now() + std::time::Duration::from_millis(40));
            return vec![];
        }
        let mut events = self.flush();
        let context = self.context.clone();
        match event {
            ProviderEvent::Thinking if !self.thinking => {
                self.thinking = true;
                events.push(AgentChatEvent::TurnThinking {
                    turn_event_context: context,
                });
            }
            ProviderEvent::Answer {
                message_id,
                text,
                user_message_ids,
            } => events.push(AgentChatEvent::AssistantCompleted {
                turn_event_context: context,
                message_id: message_id.clone(),
                text: text.clone(),
                user_message_ids: user_message_ids.clone(),
            }),
            ProviderEvent::Tool { tool } => {
                if let Some(saved) = self.tools.iter_mut().find(|t| t.id == tool.id) {
                    *saved = tool.clone();
                } else {
                    self.tools.push(tool.clone());
                }
                events.push(AgentChatEvent::ToolUpdated {
                    turn_event_context: context,
                    tool: tool.clone(),
                });
            }
            _ => {}
        }
        events
    }
    pub(super) fn flush(&mut self) -> Vec<AgentChatEvent> {
        self.due = None;
        std::mem::take(&mut self.deltas)
            .into_iter()
            .map(|(message_id, text)| AgentChatEvent::AssistantDelta {
                turn_event_context: self.context.clone(),
                message_id,
                text,
            })
            .collect()
    }
    pub(super) fn finish(&mut self, state: ToolCallState) -> Vec<AgentChatEvent> {
        let mut events = self.flush();
        for tool in &mut self.tools {
            if tool.state == ToolCallState::Running {
                tool.state = state.clone();
                events.push(AgentChatEvent::ToolUpdated {
                    turn_event_context: self.context.clone(),
                    tool: tool.clone(),
                });
            }
        }
        events
    }
}
