pub struct ProcessTree {
    pub pid: Option<u32>,
}

#[cfg(target_os = "linux")]
fn stop_descendants(
    pid: u32,
    visited: &mut std::collections::HashSet<u32>,
    deadline: std::time::Instant,
) -> Vec<u32> {
    use nix::{
        sys::signal::{Signal, kill},
        unistd::Pid,
    };
    if pid <= 1 || pid == std::process::id() || !visited.insert(pid) {
        return vec![];
    }
    // Freeze each parent before reading its children so detached browser groups
    // cannot spawn more descendants while cancellation is cleaning them up.
    let _ = kill(Pid::from_raw(pid as i32), Signal::SIGSTOP);
    while std::time::Instant::now() < deadline {
        let stopped = std::fs::read_dir(format!("/proc/{pid}/task"))
            .map(|tasks| {
                tasks.flatten().all(|task| {
                    std::fs::read_to_string(task.path().join("stat"))
                        .map(|stat| {
                            stat.rsplit_once(')')
                                .and_then(|(_, rest)| rest.split_whitespace().next())
                                .is_some_and(|state| matches!(state, "T" | "t" | "Z" | "X"))
                        })
                        .unwrap_or(true)
                })
            })
            .unwrap_or(true);
        if stopped {
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(2));
    }
    let mut result = vec![];
    if let Ok(tasks) = std::fs::read_dir(format!("/proc/{pid}/task")) {
        for task in tasks.flatten() {
            if let Ok(children) = std::fs::read_to_string(task.path().join("children")) {
                for child in children
                    .split_whitespace()
                    .filter_map(|value| value.parse::<u32>().ok())
                {
                    let stat =
                        std::fs::read_to_string(format!("/proc/{child}/stat")).unwrap_or_default();
                    let parent = stat
                        .rsplit_once(')')
                        .and_then(|(_, rest)| rest.split_whitespace().nth(1))
                        .and_then(|value| value.parse::<u32>().ok());
                    if parent == Some(pid) {
                        result.extend(stop_descendants(child, visited, deadline));
                    }
                }
            }
        }
    }
    result.push(pid);
    result
}

impl Drop for ProcessTree {
    fn drop(&mut self) {
        #[cfg(unix)]
        if let Some(pid) = self
            .pid
            .filter(|pid| *pid > 1 && *pid != std::process::id())
        {
            use nix::{
                sys::signal::{Signal, kill, killpg},
                unistd::{Pid, getpgid},
            };
            #[cfg(target_os = "linux")]
            for child in stop_descendants(
                pid,
                &mut std::collections::HashSet::new(),
                std::time::Instant::now() + std::time::Duration::from_millis(200),
            ) {
                let process = Pid::from_raw(child as i32);
                if getpgid(Some(process)).ok() == Some(process) {
                    let _ = killpg(process, Signal::SIGKILL);
                }
                let _ = kill(process, Signal::SIGKILL);
            }
            let _ = killpg(Pid::from_raw(pid as i32), Signal::SIGKILL);
        }
    }
}

#[cfg(all(test, target_os = "linux"))]
mod tests {
    use super::*;
    use tokio::io::{AsyncBufReadExt, BufReader};

    #[tokio::test]
    async fn cancellation_terminates_detached_renderer_descendants() {
        let mut child = tokio::process::Command::new("node")
            .args(["-e", "const {spawn}=require('node:child_process'); const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{detached:true,stdio:'ignore'}); console.log(child.pid); setInterval(()=>{},1000)"])
            .process_group(0).stdout(std::process::Stdio::piped()).kill_on_drop(true).spawn().unwrap();
        let tree = ProcessTree { pid: child.id() };
        let mut line = String::new();
        tokio::time::timeout(
            std::time::Duration::from_secs(5),
            BufReader::new(child.stdout.take().unwrap()).read_line(&mut line),
        )
        .await
        .unwrap()
        .unwrap();
        let detached: u32 = line.trim().parse().unwrap();
        drop(tree);
        child.wait().await.unwrap();
        for _ in 0..20 {
            let stat = std::fs::read_to_string(format!("/proc/{detached}/stat"));
            let terminated = match stat {
                Err(_) => true,
                Ok(value) => value
                    .rsplit_once(')')
                    .is_some_and(|(_, rest)| rest.trim_start().starts_with('Z')),
            };
            if terminated {
                return;
            }
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        }
        panic!("Detached renderer process remained alive after cancellation");
    }
}
