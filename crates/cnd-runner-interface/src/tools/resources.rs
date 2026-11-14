//! Repository, section, and model tool contracts.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::agents::{Agent, AgentChoice, Effort};
use crate::wire::ReadonlyVec;

/// A selected agent and model without an effort override.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct AgentRequestModel {
    /// agent.
    pub agent: Agent,
    /// model.
    pub model: String,
}

/// One available model and its supported effort levels.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct AgentModel {
    /// agent.
    pub agent: Agent,
    /// model.
    pub model: String,
    /// label.
    pub label: String,
    /// efforts.
    #[ts(as = "ReadonlyVec<Effort>")]
    pub efforts: Vec<Effort>,
    /// Whether this model offers fast mode.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub fast: Option<bool>,
}

/// A repository that workspace creation accepts.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct AgentRepository {
    /// id.
    pub id: String,
    /// full name.
    pub full_name: String,
    /// default branch.
    pub default_branch: String,
    /// current.
    pub current: bool,
}

/// One section in sidebar order.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct AgentSection {
    /// id.
    pub id: String,
    /// name.
    pub name: String,
    /// default.
    pub default: bool,
}

/// AgentListRepositoriesResponse wire fields.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct AgentListRepositoriesResponse {
    /// repositories.
    #[ts(as = "ReadonlyVec<AgentRepository>")]
    pub repositories: Vec<AgentRepository>,
}

/// AgentListSectionsResponse wire fields.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct AgentListSectionsResponse {
    /// sections.
    #[ts(as = "ReadonlyVec<AgentSection>")]
    pub sections: Vec<AgentSection>,
}

/// AgentListModelsResponse wire fields.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct AgentListModelsResponse {
    /// models.
    #[ts(as = "ReadonlyVec<AgentModel>")]
    pub models: Vec<AgentModel>,
    /// default choice.
    pub default_choice: Option<AgentChoice>,
}

/// AgentCreateSectionRequest wire fields.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct AgentCreateSectionRequest {
    /// name.
    pub name: String,
}

/// AgentCreateSectionResponse wire fields.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct AgentCreateSectionResponse {
    /// section.
    pub section: AgentSection,
}

/// AgentDeleteSectionResponse wire fields.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct AgentDeleteSectionResponse {
    /// deleted.
    pub deleted: bool,
}

/// A public tool failure code and message.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct AgentToolFailure {
    /// code.
    pub code: String,
    /// message.
    pub message: String,
}
