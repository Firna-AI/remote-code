//! Complete-source display filtering leaves operational identities and file data intact.

use cnd_runner_interface::runner::RunnerEvent;
use cnd_runner_interface::runner_files::RunnerFileResponse;
use serde_json::json;

use crate::filter::service::{CredentialFilter, Credentials};
use crate::reports::prepare::ReportFilter;

type TestResult = Result<(), Box<dyn std::error::Error>>;

#[test]
fn filters_reports_tools_errors_and_labels_without_changing_metadata() -> TestResult {
    let filter = CredentialFilter::default();
    filter.add("secret".into())?;
    let sources = [
        json!({"type":"workspace.title","name":"secret title"}),
        json!({"type":"start.updated","start":{"kind":"create","startedAt":90,"steps":[{"id":"secret-id","label":"secret step","state":"failed","startedAt":90,"completedAt":100}]}}),
        json!({"type":"ports.updated","ports":[{"port":3000,"name":"secret app","folder":"secret folder"}]}),
        json!({"type":"tool.updated","sessionId":"secret-session","turnId":"secret-turn","tool":{"id":"secret-tool","kind":"read","target":"secret.txt","detail":"secret body","omittedDetailBytes":12,"state":"done"}}),
        json!({"type":"turn.failed","sessionId":"secret-session","turnId":"secret-turn","error":{"code":"secret-code","message":"secret error"},"retryMessageId":"secret-message","durationMs":125}),
        json!({"type":"files.snapshot","tree":{"revision":1,"partNumber":1,"partCount":1,"entries":[{"path":"secret.txt","name":"secret.txt","kind":"file","change":"untracked"}]}}),
    ];
    let mut expected = sources.clone();
    expected[0]["name"] = json!("[redacted] title");
    expected[1]["start"]["steps"][0]["label"] = json!("[redacted] step");
    expected[2]["ports"][0]["name"] = json!("[redacted] app");
    expected[2]["ports"][0]["folder"] = json!("[redacted] folder");
    expected[3]["tool"]["target"] = json!("[redacted].txt");
    expected[3]["tool"]["detail"] = json!("[redacted] body");
    expected[4]["error"]["message"] = json!("[redacted] error");
    expected[5]["tree"]["entries"][0]["displayPath"] = json!("[redacted].txt");
    expected[5]["tree"]["entries"][0]["name"] = json!("[redacted].txt");
    for (source, expected) in sources.into_iter().zip(expected) {
        let event: RunnerEvent = serde_json::from_value(source)?;
        assert_eq!(serde_json::to_value(filter.report(event)?)?, expected);
    }
    Ok(())
}

#[test]
fn filters_file_and_diff_labels_without_rewriting_contents_paths_or_branches() -> TestResult {
    let filter = CredentialFilter::default();
    filter.add("secret".into())?;
    let source = json!({"type":"file.read.result","requestId":"read","result":{"ok":true,"file":{"path":"secret.txt","content":"secret bytes","encoding":"utf-8","sizeBytes":12,"mediaType":"text/plain"}}});
    let response: RunnerFileResponse = serde_json::from_value(source.clone())?;
    let mut expected = source;
    expected["result"]["file"]["displayPath"] = json!("[redacted].txt");
    assert_eq!(serde_json::to_value(filter.response(response)?)?, expected);
    Ok(())
}
