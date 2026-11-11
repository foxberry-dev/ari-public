use std::{convert::Infallible, time::Duration};

use axum::{
    Json, Router,
    extract::{DefaultBodyLimit, Path, Request, State},
    http::{HeaderMap, StatusCode, header},
    middleware::{self, Next},
    response::{
        IntoResponse, Response, Sse,
        sse::{Event, KeepAlive},
    },
    routing::{get, post},
};
use futures_util::stream;
use rust_embed::RustEmbed;

use crate::{
    mcp,
    model::*,
    service::{Error, Service},
};

#[derive(RustEmbed)]
#[folder = "frontend/dist/"]
struct Assets;

#[derive(Clone)]
struct AppState {
    service: Service,
    base_url: String,
}

impl IntoResponse for Error {
    fn into_response(self) -> Response {
        let (status, message) = match self {
            Error::Invalid(message) => (StatusCode::BAD_REQUEST, message),
            Error::Missing => (
                StatusCode::NOT_FOUND,
                "Clarification or event not found".into(),
            ),
            Error::Conflict(message) => (StatusCode::CONFLICT, message),
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
) -> Result<Json<Workspace>, Error> {
    Ok(Json(s.service.get(&id).await?))
}
async fn action(
    State(s): State<AppState>,
    Path(id): Path<String>,
    Json(input): Json<Action>,
) -> Result<Json<Workspace>, Error> {
    Ok(Json(s.service.act(&id, input).await?))
}
async fn agent(
    State(s): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<crate::service::AgentStatus>, Error> {
    s.service.get(&id).await?;
    Ok(Json(s.service.agent_status(&id).await?))
}
async fn poll(
    State(s): State<AppState>,
    Json(input): Json<mcp::Poll>,
) -> Result<Json<Option<Claim>>, Error> {
    Ok(Json(mcp::tracked_poll(s.service, input).await?))
}
async fn reply(
    State(s): State<AppState>,
    Json(input): Json<Reply>,
) -> Result<Json<Workspace>, Error> {
    Ok(Json(s.service.reply(input).await?))
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
    headers.insert(header::CONTENT_SECURITY_POLICY, "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'".parse().unwrap());
    (headers, file.data).into_response()
}

pub fn router(service: Service, port: u16) -> Router {
    let base_url =
        std::env::var("ARI_PUBLIC_URL").unwrap_or_else(|_| format!("http://127.0.0.1:{port}"));
    Router::new()
        .route(
            "/api/health",
            get(|| async { Json(serde_json::json!({ "ok": true })) }),
        )
        .route("/api/context", get(context))
        .route("/api/workspaces", get(list))
        .route("/api/workspaces/{id}", get(detail))
        .route("/api/workspaces/{id}/actions", post(action))
        .route("/api/workspaces/{id}/agent", get(agent))
        .route("/api/poll", post(poll))
        .route("/api/reply", post(reply))
        .route("/api/events", get(events))
        .with_state(AppState {
            service: service.clone(),
            base_url: base_url.clone(),
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
        let app = router(service, 38477);
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
