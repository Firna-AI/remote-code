//! Ignored context files join only the tree; paths use English case ordering.

use icu_collator::{Collator, CollatorBorrowed};
use icu_locale::locale;

use super::entries::zero_paths;
use super::error::{ErrorResultExt, Result};
use super::index::TemporaryIndex;
use super::io::PathKind;
use super::service::GitRepository;

pub(super) fn path_order() -> Result<CollatorBorrowed<'static>> {
    Collator::try_new(locale!("en").into(), Default::default()).internal()
}

impl GitRepository {
    pub(super) async fn context_files(&self, index: &mut TemporaryIndex) -> Result<Vec<String>> {
        let folder = index.classifier.classify(".context").await?;
        if folder.kind != PathKind::Directory || folder.submodule {
            return Ok(vec![]);
        }
        match self
            .run(&["ls-files", "--others", "-z", "--", ".context/"])
            .await
        {
            Ok(bytes) => Ok(zero_paths(&bytes)
                .into_iter()
                .map(|path| path.trim_end_matches('/').to_owned())
                .collect()),
            Err(error) => {
                self.cancellation.check()?;
                tracing::warn!("The context folder files could not be listed.");
                let _ = error;
                Ok(vec![])
            }
        }
    }
}
