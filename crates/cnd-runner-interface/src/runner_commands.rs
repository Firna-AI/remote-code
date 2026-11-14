//! RunnerCommands wire contracts.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::agents::AgentChoice;
use crate::commit_author::CommitAuthor;
use crate::messages::UserMessage;
use crate::runner_credentials::RunnerTurnCredential;
use crate::runner_files::RunnerFileCommand;
use crate::wire::ReadonlyVec;

/// RunnerCommand wire alternatives.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(untagged)]
pub enum RunnerCommand {
    /// RunnerTurn.
    RunnerTurn(RunnerTurn),
    /// RunnerMessageDuringTurn.
    RunnerMessageDuringTurn(RunnerMessageDuringTurn),
    /// RunnerControlCommand.
    RunnerControlCommand(RunnerControlCommand),
}

/// Current Worker branches. Older command producers can omit them.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "type", rename_all_fields = "camelCase")]
pub enum RunnerTurn {
    /// turn.
    #[serde(rename = "turn")]
    Turn {
        /// commandId.
        command_id: String,
        /// sessionId.
        session_id: String,
        /// turnId.
        turn_id: String,
        /// message.
        message: UserMessage,
        /// Current Worker branches. Older command producers can omit them.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        branches: Option<RunnerBranches>,
        /// attachments.
        #[ts(as = "ReadonlyVec<RunnerAttachment>")]
        attachments: Vec<RunnerAttachment>,
        /// credential.
        credential: RunnerTurnCredential,
        /// commitAuthor.
        commit_author: Option<CommitAuthor>,
    },
}

/// RunnerBranches wire fields.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct RunnerBranches {
    /// workspaceBranch.
    pub workspace_branch: String,
    /// targetBranch.
    pub target_branch: String,
}

/// Absolute path in the workspace repository, after the backend copies the file.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct RunnerAttachment {
    /// attachmentId.
    pub attachment_id: String,
    /// Absolute path in the workspace repository, after the backend copies the file.
    pub path: String,
}

/// RunnerMessageDuringTurn.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "type", rename_all_fields = "camelCase")]
pub enum RunnerMessageDuringTurn {
    /// message.
    #[serde(rename = "message")]
    Message {
        /// commandId.
        command_id: String,
        /// sessionId.
        session_id: String,
        /// turnId.
        turn_id: String,
        /// message.
        message: UserMessage,
        /// branches.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        branches: Option<RunnerBranches>,
        /// attachments.
        #[ts(as = "ReadonlyVec<RunnerAttachment>")]
        attachments: Vec<RunnerAttachment>,
    },
}

/// RunnerControlCommand wire alternatives.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(untagged)]
pub enum RunnerControlCommand {
    /// RunnerInterrupt.
    RunnerInterrupt(RunnerInterrupt),
    /// RunnerChangeModel.
    RunnerChangeModel(RunnerChangeModel),
    /// RunnerFileCommand.
    RunnerFileCommand(RunnerFileCommand),
    /// RunnerReportRefresh.
    RunnerReportRefresh(RunnerReportRefresh),
}

/// RunnerInterrupt.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "type", rename_all_fields = "camelCase")]
pub enum RunnerInterrupt {
    /// interrupt.
    #[serde(rename = "interrupt")]
    Interrupt {
        /// commandId.
        command_id: String,
        /// sessionId.
        session_id: String,
        /// turnId.
        turn_id: String,
    },
}

/// Only the session's current agent. Another agent creates another session.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "type", rename_all_fields = "camelCase")]
pub enum RunnerChangeModel {
    /// model.
    #[serde(rename = "model")]
    Model {
        /// commandId.
        command_id: String,
        /// sessionId.
        session_id: String,
        /// Only the session's current agent. Another agent creates another session.
        choice: AgentChoice,
    },
}

/// Request a complete current report. Transport redelivery keeps the command ID.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "type", rename_all_fields = "camelCase")]
pub enum RunnerReportRefresh {
    /// report.refresh.
    #[serde(rename = "report.refresh")]
    ReportRefresh {
        /// commandId.
        command_id: String,
        /// kind.
        kind: RunnerReportKind,
    },
}

/// RunnerReportKind wire values.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub enum RunnerReportKind {
    /// files.snapshot.
    #[serde(rename = "files.snapshot")]
    FilesSnapshot,
    /// changes.updated.
    #[serde(rename = "changes.updated")]
    ChangesUpdated,
    /// start.updated.
    #[serde(rename = "start.updated")]
    StartUpdated,
    /// workspace.title.
    #[serde(rename = "workspace.title")]
    WorkspaceTitle,
    /// ports.updated.
    #[serde(rename = "ports.updated")]
    PortsUpdated,
}
