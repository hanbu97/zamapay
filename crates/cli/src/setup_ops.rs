use std::env;
use std::fs;
use std::path::{Path, PathBuf};

use anyhow::{Context, Result, bail};
use serde::Serialize;

use crate::common::output;
use crate::{SetupAgentArgs, SetupArgs, SetupCommand};

#[derive(Debug, Serialize)]
struct AgentSetupResult {
    source: String,
    target_file: String,
}

pub(crate) async fn setup(args: SetupArgs) -> Result<()> {
    match args.command {
        SetupCommand::Agent(args) => setup_agent(args).await,
    }
}

async fn setup_agent(args: SetupAgentArgs) -> Result<()> {
    if args.print {
        println!("{}", read_skill(&args).await?);
        return Ok(());
    }

    if !args.yes {
        bail!("setup agent writes files; pass --yes or use --print")
    }

    let target_dir = args
        .target_dir
        .clone()
        .unwrap_or_else(default_codex_skill_dir);
    let skill = read_skill(&args).await?;
    let target_file = target_dir.join("SKILL.md");
    fs::create_dir_all(&target_dir)
        .with_context(|| format!("failed to create {}", target_dir.display()))?;
    fs::write(&target_file, skill)
        .with_context(|| format!("failed to write {}", target_file.display()))?;

    let result = AgentSetupResult {
        source: skill_source_label(&args),
        target_file: target_file.display().to_string(),
    };

    output(args.json, &result, || {
        println!("installed_zamapay_skill: {}", result.target_file);
        println!("source: {}", result.source);
        Ok(())
    })
}

async fn read_skill(args: &SetupAgentArgs) -> Result<String> {
    if let Some(path) = &args.source_file {
        return fs::read_to_string(path)
            .with_context(|| format!("failed to read {}", path.display()));
    }

    let response = reqwest::get(&args.source_url)
        .await
        .with_context(|| format!("failed to fetch {}", args.source_url))?;
    let status = response.status();
    if !status.is_success() {
        bail!("failed to fetch {}: {status}", args.source_url);
    }
    response
        .text()
        .await
        .with_context(|| format!("failed to read {}", args.source_url))
}

fn skill_source_label(args: &SetupAgentArgs) -> String {
    args.source_file
        .as_ref()
        .map(|path| path.display().to_string())
        .unwrap_or_else(|| args.source_url.clone())
}

fn default_codex_skill_dir() -> PathBuf {
    env::var_os("CODEX_HOME")
        .map(PathBuf::from)
        .or_else(|| env::var_os("HOME").map(|home| Path::new(&home).join(".codex")))
        .unwrap_or_else(|| PathBuf::from(".codex"))
        .join("skills")
        .join("zamapay")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_codex_skill_dir_falls_back_to_relative_path() {
        let path = default_codex_skill_dir_from(None, None);
        assert_eq!(path, PathBuf::from(".codex/skills/zamapay"));
    }

    #[test]
    fn default_codex_skill_dir_prefers_codex_home() {
        let path = default_codex_skill_dir_from(Some("/tmp/codex"), Some("/tmp/home"));
        assert_eq!(path, PathBuf::from("/tmp/codex/skills/zamapay"));
    }

    fn default_codex_skill_dir_from(codex_home: Option<&str>, home: Option<&str>) -> PathBuf {
        codex_home
            .map(PathBuf::from)
            .or_else(|| home.map(|value| Path::new(value).join(".codex")))
            .unwrap_or_else(|| PathBuf::from(".codex"))
            .join("skills")
            .join("zamapay")
    }
}
