use std::{io::Read, time::Duration};

use reqwest::{Url, blocking::Client, redirect::Policy};

const DOWNLOAD_ERROR: &str = "無法下載公開試算表。請確認連結有效且分享權限允許檢視。";

pub(crate) fn is_external_http_url(value: &str) -> bool {
    if value.chars().any(char::is_whitespace) {
        return false;
    }
    Url::parse(value).is_ok_and(|url| {
        matches!(url.scheme(), "http" | "https")
            && url.host_str().is_some()
            && url.username().is_empty()
            && url.password().is_none()
    })
}

pub(crate) fn open_external_url(url: &str) -> Result<(), String> {
    if !is_external_http_url(url) {
        return Err("只支援 http 或 https 雲端連結".into());
    }
    open::that_detached(url).map_err(|_| "無法使用預設瀏覽器開啟連結".into())
}

fn is_public_download_url(url: &Url) -> bool {
    url.scheme() == "https"
        && url.username().is_empty()
        && url.password().is_none()
        && url.port().is_none()
        && url.host_str().is_some_and(|host| {
            host.contains('.')
                && !host.ends_with(".local")
                && host.parse::<std::net::IpAddr>().is_err()
        })
}

fn read_bounded(reader: impl Read, max_bytes: usize) -> Result<Vec<u8>, String> {
    // Read one extra byte so the cap also applies without a Content-Length header.
    let mut bytes = Vec::new();
    reader
        .take(max_bytes as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| DOWNLOAD_ERROR.to_string())?;
    if bytes.len() > max_bytes {
        return Err("試算表不可超過 5 MB。".into());
    }
    Ok(bytes)
}

pub(crate) fn download_spreadsheet(url: &str, max_bytes: usize) -> Result<Vec<u8>, String> {
    let url = Url::parse(url).map_err(|_| DOWNLOAD_ERROR.to_string())?;
    if !is_public_download_url(&url) {
        return Err("只支援 HTTPS 公開試算表連結。".into());
    }
    let client = Client::builder()
        .https_only(true)
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(20))
        .user_agent(concat!("Dessert-Treasurer/", env!("CARGO_PKG_VERSION")))
        .redirect(Policy::custom(|attempt| {
            if attempt.previous().len() >= 10 || !is_public_download_url(attempt.url()) {
                attempt.error("Unsupported spreadsheet redirect")
            } else {
                attempt.follow()
            }
        }))
        .build()
        .map_err(|_| DOWNLOAD_ERROR.to_string())?;
    let response = client
        .get(url)
        .send()
        .and_then(|response| response.error_for_status())
        .map_err(|_| DOWNLOAD_ERROR.to_string())?;
    if response
        .content_length()
        .is_some_and(|size| size > max_bytes as u64)
    {
        return Err("試算表不可超過 5 MB。".into());
    }
    read_bounded(response, max_bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn external_urls_must_be_valid_web_links() {
        for value in [
            "https://drive.google.com/file/d/example",
            "http://localhost:4173",
        ] {
            assert!(is_external_http_url(value));
        }
        for value in [
            "file:///etc/passwd",
            "javascript:alert(1)",
            "https://",
            "https://example.com/has a space",
            "https://user:password@example.com",
            "open -a Calculator",
        ] {
            assert!(!is_external_http_url(value));
        }
    }

    #[test]
    fn downloads_and_redirects_require_public_https_destinations() {
        assert!(is_public_download_url(
            &Url::parse("https://docs.google.com/example").unwrap()
        ));
        for value in [
            "http://example.com/file.csv",
            "https://localhost/file.csv",
            "https://example.local/file.csv",
            "https://127.0.0.1/file.csv",
            "https://[::1]/file.csv",
            "https://user:password@example.com/file.csv",
            "https://example.com:8443/file.csv",
        ] {
            assert!(!is_public_download_url(&Url::parse(value).unwrap()));
        }
    }

    #[test]
    fn bounded_reads_reject_oversized_bodies_without_truncating_valid_files() {
        assert_eq!(read_bounded(&b"abc"[..], 3).unwrap(), b"abc");
        assert!(read_bounded(&b"abcd"[..], 3).is_err());
        assert!(read_bounded(std::io::repeat(0), 3).is_err());
        assert_eq!(read_bounded(&b""[..], 3).unwrap(), Vec::<u8>::new());
    }
}
