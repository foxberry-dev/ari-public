mod http;
mod mcp;
mod model;
mod service;
#[cfg(test)]
mod tests;

use clap::Parser;
use std::path::PathBuf;

#[derive(Parser)]
#[command(
    name = "ari",
    version,
    about = "A local, agent-connected decision workspace"
)]
struct Cli {
    #[arg(long, env = "ARI_HOME")]
    home: Option<PathBuf>,
    #[arg(long, env = "ARI_PORT", default_value_t = 38477)]
    port: u16,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let cli = Cli::parse();
    let home = cli.home.unwrap_or_else(|| {
        dirs::data_local_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join("ari")
    });
    tokio::fs::create_dir_all(&home).await?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        tokio::fs::set_permissions(&home, std::fs::Permissions::from_mode(0o700)).await?;
    }
    let listener = tokio::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, cli.port)).await?;
    let port = listener.local_addr()?.port();
    let service = service::Service::open(&home.join("ari.sqlite3"))
        .await
        .map_err(|error| anyhow::anyhow!("Cannot open storage: {error:?}"))?;
    eprintln!(
        "Ari: http://127.0.0.1:{port}\nMCP: http://127.0.0.1:{port}/mcp\nData: {}",
        home.display()
    );
    axum::serve(listener, http::router(service, port))
        .with_graceful_shutdown(async {
            let _ = tokio::signal::ctrl_c().await;
        })
        .await?;
    Ok(())
}
