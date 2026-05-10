use std::{io, net::SocketAddr, process::Command, time::Duration};

use tokio::{net::TcpListener, time::sleep};

const DEMO_BACKEND_PROCESS_NAME: &str = "cardforge-backend";

pub(crate) type DynError = Box<dyn std::error::Error>;

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct PortListener {
    pid: u32,
    command: String,
}

pub(crate) async fn bind_demo_listener(bind_addr: SocketAddr) -> Result<TcpListener, DynError> {
    match TcpListener::bind(bind_addr).await {
        Ok(listener) => Ok(listener),
        Err(error) if error.kind() == io::ErrorKind::AddrInUse => {
            stop_previous_cardforge_backend(bind_addr, "-TERM")?;
            wait_for_released_port(bind_addr).await
        }
        Err(error) => Err(error.into()),
    }
}

async fn wait_for_released_port(bind_addr: SocketAddr) -> Result<TcpListener, DynError> {
    for attempt in 0..20 {
        sleep(Duration::from_millis(100)).await;

        match TcpListener::bind(bind_addr).await {
            Ok(listener) => return Ok(listener),
            Err(error) if error.kind() == io::ErrorKind::AddrInUse => {
                if attempt == 9 {
                    stop_previous_cardforge_backend(bind_addr, "-KILL")?;
                }
            }
            Err(error) => return Err(error.into()),
        }
    }

    Err(io::Error::new(
        io::ErrorKind::AddrInUse,
        format!("port {bind_addr} stayed busy after replacing the old CardForge backend"),
    )
    .into())
}

fn stop_previous_cardforge_backend(bind_addr: SocketAddr, signal: &str) -> Result<(), DynError> {
    let listeners = listeners_on_port(bind_addr.port())?;
    let matching: Vec<_> = listeners
        .iter()
        .filter(|listener| is_cardforge_backend_command(&listener.command))
        .cloned()
        .collect();

    if matching.is_empty() {
        return Err(io::Error::new(
            io::ErrorKind::AddrInUse,
            format!(
                "port {bind_addr} is occupied, but no {DEMO_BACKEND_PROCESS_NAME} listener was found: {}",
                listener_summary(&listeners)
            ),
        )
        .into());
    }

    for listener in matching {
        println!(
            "CardForge backend port {bind_addr} is occupied by PID {}; sending {signal}.",
            listener.pid
        );
        signal_process(listener.pid, signal)?;
    }

    Ok(())
}

fn listeners_on_port(port: u16) -> Result<Vec<PortListener>, DynError> {
    let port_filter = format!("-iTCP:{port}");
    let output = Command::new("lsof")
        .args(["-nP", &port_filter, "-sTCP:LISTEN", "-t"])
        .output()?;

    if !output.status.success() && output.stdout.is_empty() {
        return Ok(Vec::new());
    }

    let mut pids = parse_lsof_pids(&output.stdout);
    pids.sort_unstable();
    pids.dedup();

    let listeners = pids
        .into_iter()
        .filter_map(|pid| {
            let command = process_command(pid).ok()?;
            (!command.is_empty()).then_some(PortListener { pid, command })
        })
        .collect();

    Ok(listeners)
}

pub(crate) fn parse_lsof_pids(stdout: &[u8]) -> Vec<u32> {
    String::from_utf8_lossy(stdout)
        .lines()
        .filter_map(|line| line.trim().parse().ok())
        .collect()
}

fn process_command(pid: u32) -> Result<String, DynError> {
    let output = Command::new("ps")
        .args(["-p", &pid.to_string(), "-o", "command="])
        .output()?;

    if !output.status.success() {
        return Ok(String::new());
    }

    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn signal_process(pid: u32, signal: &str) -> Result<(), DynError> {
    let status = Command::new("kill")
        .args([signal, &pid.to_string()])
        .status()?;

    if status.success() {
        Ok(())
    } else {
        Err(io::Error::other(format!("failed to send {signal} to PID {pid}")).into())
    }
}

pub(crate) fn is_cardforge_backend_command(command: &str) -> bool {
    command.contains(DEMO_BACKEND_PROCESS_NAME)
}

fn listener_summary(listeners: &[PortListener]) -> String {
    if listeners.is_empty() {
        return "no visible listener".to_string();
    }

    listeners
        .iter()
        .map(|listener| format!("PID {} ({})", listener.pid, listener.command))
        .collect::<Vec<_>>()
        .join(", ")
}
