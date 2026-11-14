//! The parts boundary refuses unsupported or unverifiable downloads.

use crate::error::Error;
use crate::parts::{Part, PartsList};

#[test]
fn parts_require_a_supported_schema_unique_roles_and_verifiable_https_downloads()
-> Result<(), Box<dyn std::error::Error>> {
    let part = Part {
        name: "runner".to_owned(),
        url: "https://runner.conductive.build/runner.tar.gz".to_owned(),
        sha256: "a".repeat(64),
    };
    let mut list = PartsList::new(vec![part.clone()])?;
    list.schema_version = 2;
    assert!(matches!(
        list.validate(),
        Err(Error::UnsupportedSchema { version: 2 })
    ));
    assert!(
        matches!(PartsList::new(vec![part.clone(), part.clone()]), Err(Error::InvalidPart { name }) if name == "runner")
    );
    let mut invalid = part.clone();
    invalid.sha256.clear();
    assert!(
        matches!(PartsList::new(vec![invalid]), Err(Error::InvalidPart { name }) if name == "runner")
    );
    let mut invalid = part;
    invalid.url = "http://runner.conductive.build/runner.tar.gz".to_owned();
    assert!(
        matches!(PartsList::new(vec![invalid]), Err(Error::InvalidPart { name }) if name == "runner")
    );
    Ok(())
}

#[test]
fn parts_accept_additive_fields_from_later_releases() -> Result<(), Box<dyn std::error::Error>> {
    let decoded = serde_json::from_str::<PartsList>(
        r#"{"schema_version":1,"future":true,"parts":[{"name":"sdk-helper","url":"https://runner.conductive.build/helper.tar.gz","sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","future":42}]}"#,
    );
    assert!(decoded.is_ok(), "additive fields were refused: {decoded:?}");
    let list = decoded?;
    assert_eq!(list.parts[0].name, "sdk-helper");
    list.validate()?;
    Ok(())
}

#[test]
fn release_requires_its_helper_before_it_can_publish_parts()
-> Result<(), Box<dyn std::error::Error>> {
    let list = PartsList::new(
        ["node", "system"]
            .into_iter()
            .map(|name| Part {
                name: name.to_owned(),
                url: format!("https://runner.conductive.build/{name}.tar.gz"),
                sha256: "a".repeat(64),
            })
            .collect(),
    )?;
    assert!(
        matches!(list.require(&["node", "sdk-helper", "system"]), Err(Error::MissingPart { name }) if name == "sdk-helper")
    );
    Ok(())
}
