use std::{convert::Infallible, time::Duration};

use axum::{
    Json, Router,
    extract::{DefaultBodyLimit, Path, Query, Request, State},
    http::{HeaderMap, StatusCode, header},
    middleware::{self, Next},
    response::{
        IntoResponse, Response, Sse,
        sse::{Event, KeepAlive},
    },
    routing::get,
};
use futures_util::stream;
use rust_embed::RustEmbed;

use crate::{
    mcp,
    model::Workspace,
    service::{Error, Service},
};

#[derive(RustEmbed)]
#[folder = "frontend/dist/"]
struct Assets;

#[derive(Clone)]
struct AppState {
    service: Service,
    base_url: String,
    cher_url: Option<String>,
}

impl IntoResponse for Error {
    fn into_response(self) -> Response {
        let (status, message) = match self {
            Error::Invalid(message) => (StatusCode::BAD_REQUEST, message),
            Error::Missing => (StatusCode::NOT_FOUND, "Clarification not found".into()),
            Error::Conflict(message) => (StatusCode::CONFLICT, message),
            Error::RevisionConflict(revision) => (
                StatusCode::CONFLICT,
                format!(
                    "Clarification is at revision {revision}; read the latest graph before publishing"
                ),
            ),
            Error::Storage(error) => {
                eprintln!("Storage error: {error:#}");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Storage error; check server logs".into(),
                )
            }
        };
        (status, Json(serde_json::json!({ "error": message }))).into_response()
    }
}

fn loopback_authority(value: &str, port: u16) -> bool {
    [
        format!("127.0.0.1:{port}"),
        format!("localhost:{port}"),
        "127.0.0.1:5175".into(),
        "localhost:5175".into(),
    ]
    .contains(&value.to_lowercase())
}

async fn guard(State(port): State<u16>, request: Request, next: Next) -> Response {
    let headers = request.headers();
    let host = headers
        .get(header::HOST)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    let origin_allowed = headers
        .get(header::ORIGIN)
        .map(|origin| {
            origin
                .to_str()
                .ok()
                .and_then(|s| s.strip_prefix("http://"))
                .is_some_and(|s| loopback_authority(s, port))
        })
        .unwrap_or(true);
    let cross_site = headers
        .get("sec-fetch-site")
        .is_some_and(|v| v == "cross-site");
    if !loopback_authority(host, port) || !origin_allowed || cross_site {
        return (StatusCode::FORBIDDEN, "Only local requests are allowed").into_response();
    }
    let mut response = next.run(request).await;
    response
        .headers_mut()
        .insert(header::X_CONTENT_TYPE_OPTIONS, "nosniff".parse().unwrap());
    response
        .headers_mut()
        .insert(header::REFERRER_POLICY, "no-referrer".parse().unwrap());
    response
        .headers_mut()
        .insert(header::CACHE_CONTROL, "no-store".parse().unwrap());
    response
}

async fn list(State(s): State<AppState>) -> Result<Json<Vec<Workspace>>, Error> {
    Ok(Json(s.service.list().await?))
}
async fn detail(
    State(s): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, Error> {
    let workspace = s.service.get(&id).await?;
    let mut document = serde_json::to_value(&workspace)?;
    document["nodeIndex"] = serde_json::to_value(workspace.node_index())?;
    Ok(Json(document))
}
async fn export_graph(
    State(s): State<AppState>,
    Path(id): Path<String>,
    Query(options): Query<crate::graph_export::Options>,
) -> Response {
    let workspace = match s.service.get(&id).await {
        Ok(workspace) => workspace,
        Err(error) => return error.into_response(),
    };
    match crate::graph_export::render(&workspace, options).await {
        Ok(download) => {
            let mut headers = HeaderMap::new();
            headers.insert(header::CONTENT_TYPE, download.mime.parse().unwrap());
            headers.insert(
                header::CONTENT_DISPOSITION,
                format!("attachment; filename=\"{}\"", download.filename)
                    .parse()
                    .unwrap(),
            );
            headers.insert(
                header::CONTENT_SECURITY_POLICY,
                "sandbox; default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'"
                    .parse()
                    .unwrap(),
            );
            (headers, download.bytes).into_response()
        }
        Err((status, message)) => {
            (status, Json(serde_json::json!({ "error": message }))).into_response()
        }
    }
}

async fn context(State(s): State<AppState>) -> Result<Json<serde_json::Value>, Error> {
    Ok(Json(mcp::context(&s.service, &s.base_url).await?))
}

async fn events(
    State(s): State<AppState>,
) -> Sse<impl futures_util::Stream<Item = Result<Event, Infallible>>> {
    let receiver = s.service.updates.subscribe();
    let events = stream::unfold((receiver, true), |(mut rx, initial)| async move {
        if !initial {
            match rx.recv().await {
                Ok(()) | Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {}
                Err(_) => return None,
            }
        }
        Some((Ok(Event::default().data("refresh")), (rx, false)))
    });
    Sse::new(events).keep_alive(KeepAlive::new().interval(Duration::from_secs(10)))
}

async fn asset(request: Request) -> Response {
    let path = request.uri().path().trim_start_matches('/');
    let path = if path.is_empty() { "index.html" } else { path };
    let Some(file) = Assets::get(path) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let mut headers = HeaderMap::new();
    headers.insert(
        header::CONTENT_TYPE,
        mime_guess::from_path(path)
            .first_or_octet_stream()
            .as_ref()
            .parse()
            .unwrap(),
    );
    headers.insert(header::CONTENT_SECURITY_POLICY, "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: http: https:; font-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'".parse().unwrap());
    (headers, file.data).into_response()
}

pub fn parse_cher_url(value: &str) -> Result<String, String> {
    let uri = value
        .parse::<axum::http::Uri>()
        .map_err(|_| "Cher URL must be an absolute HTTP(S) URL".to_string())?;
    if !matches!(uri.scheme_str(), Some("http" | "https"))
        || uri.host().is_none()
        || uri
            .authority()
            .is_some_and(|authority| authority.as_str().contains('@'))
    {
        return Err("Cher URL must be an absolute HTTP(S) URL without credentials".into());
    }
    Ok(value.to_string())
}

async fn navigation(State(state): State<AppState>) -> Json<serde_json::Value> {
    Json(serde_json::json!({ "cherUrl": state.cher_url }))
}

pub fn router(service: Service, port: u16, cher_url: Option<String>) -> Router {
    let base_url =
        std::env::var("ARI_PUBLIC_URL").unwrap_or_else(|_| format!("http://127.0.0.1:{port}"));
    Router::new()
        .route(
            "/api/health",
            get(|| async { Json(serde_json::json!({ "ok": true })) }),
        )
        .route("/api/navigation", get(navigation))
        .route("/api/context", get(context))
        .route("/api/workspaces", get(list))
        .route("/api/workspaces/{id}", get(detail))
        .route("/api/workspaces/{id}/export", get(export_graph))
        .route("/api/events", get(events))
        .with_state(AppState {
            service: service.clone(),
            base_url: base_url.clone(),
            cher_url,
        })
        .merge(mcp::router(service, base_url))
        .fallback(asset)
        .layer(DefaultBodyLimit::max(4 * 1024 * 1024))
        .layer(middleware::from_fn_with_state(port, guard))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tower::ServiceExt;

    #[tokio::test]
    async fn local_api_rejects_foreign_hosts_and_origins() {
        let temp = tempfile::tempdir().unwrap();
        let service = Service::open(&temp.path().join("ari.db")).await.unwrap();
        let app = router(service, 38477, None);
        for (host, origin, expected) in [
            ("127.0.0.1:38477", "http://127.0.0.1:5175", StatusCode::OK),
            (
                "attacker.test:38477",
                "http://127.0.0.1:38477",
                StatusCode::FORBIDDEN,
            ),
            (
                "127.0.0.1:38477",
                "https://attacker.test",
                StatusCode::FORBIDDEN,
            ),
            ("127.0.0.1:38477", "null", StatusCode::FORBIDDEN),
        ] {
            let request = Request::builder()
                .uri("/api/health")
                .header("host", host)
                .header("origin", origin)
                .body(axum::body::Body::empty())
                .unwrap();
            assert_eq!(
                app.clone().oneshot(request).await.unwrap().status(),
                expected
            );
        }
    }
}

#[cfg(test)]
mod cher_navigation_tests {
    use super::*;
    use tower::ServiceExt;

    #[test]
    fn cher_return_urls_require_http_without_credentials() {
        for url in ["https://cher.example/", "http://localhost:38476/"] {
            assert_eq!(parse_cher_url(url).unwrap(), url);
        }
        for url in [
            "javascript:alert(1)",
            "/relative",
            "https://user:secret@cher.example/",
        ] {
            assert!(parse_cher_url(url).is_err());
        }
    }

    #[tokio::test]
    async fn navigation_exposes_only_the_configured_return_destination() {
        let temp = tempfile::tempdir().unwrap();
        let service = Service::open(&temp.path().join("ari.db")).await.unwrap();
        let response = router(service, 38477, Some("https://cher.example/".into()))
            .oneshot(
                Request::builder()
                    .uri("/api/navigation")
                    .header("host", "127.0.0.1:38477")
                    .body(axum::body::Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let body = axum::body::to_bytes(response.into_body(), 1024)
            .await
            .unwrap();
        assert_eq!(
            serde_json::from_slice::<serde_json::Value>(&body).unwrap(),
            serde_json::json!({ "cherUrl": "https://cher.example/" })
        );
    }
}
