use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use url::Url;

#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RelatedLink {
    /// Nonblank plain-text name for this clarification-wide reference.
    #[schemars(length(min = 1, max = 32768), regex(pattern = r"\S"))]
    pub label: String,
    /// Absolute HTTP/HTTPS viewer or source URL. No credentials, whitespace, control characters, backslashes, or secrets.
    #[schemars(length(min = 1, max = 4096))]
    pub url: String,
}

pub fn validate(links: &[RelatedLink]) -> Result<(), String> {
    if links.len() > 50 {
        return Err("links supports at most 50 references".into());
    }
    for (index, link) in links.iter().enumerate() {
        crate::model::validate_text(&link.label, &format!("links[{index}].label"), true)?;
        let invalid = || {
            format!(
                "links[{index}].url must be absolute HTTP/HTTPS with a host, at most 4096 bytes, and no credentials, whitespace, control characters, or backslashes"
            )
        };
        if link.url.len() > 4096
            || link
                .url
                .chars()
                .any(|c| c.is_whitespace() || c.is_control() || c == '\\')
        {
            return Err(invalid());
        }
        let url = Url::parse(&link.url).map_err(|_| invalid())?;
        let prefix = format!("{}://", url.scheme());
        if !matches!(url.scheme(), "http" | "https")
            || !url.has_host()
            || !url.username().is_empty()
            || url.password().is_some()
            || !link.url.to_ascii_lowercase().starts_with(&prefix)
            || link.url[prefix.len()..].starts_with('/')
        {
            return Err(invalid());
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn references_allow_multiple_safe_destinations_and_reject_unsafe_urls() {
        let link = |url: &str| RelatedLink {
            label: "Related artifact".into(),
            url: url.into(),
        };
        assert!(
            validate(&[
                link("https://ari.example/#/clarifications/lunch"),
                link("https://esi.example/designs/lunch/index.html")
            ])
            .is_ok()
        );
        for url in [
            "javascript:alert(1)",
            "https://user:secret@example.com",
            "https:///example.com",
            "https://example.com/a b",
            "https://example.com/\\test",
            "data:text/plain,test",
            "//example.com",
        ] {
            assert!(validate(&[link(url)]).is_err(), "Accepted {url}");
        }
        assert!(
            validate(&[RelatedLink {
                label: " ".into(),
                url: "https://example.com".into()
            }])
            .is_err()
        );
        assert!(
            validate(
                &(0..51)
                    .map(|_| link("https://example.com"))
                    .collect::<Vec<_>>()
            )
            .is_err()
        );
    }
}
