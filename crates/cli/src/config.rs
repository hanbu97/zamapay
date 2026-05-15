use std::collections::BTreeMap;
use std::env;
use std::fs;
use std::path::{Path, PathBuf};

use anyhow::{Context, Result, bail};
use serde::{Deserialize, Serialize};

pub const DEFAULT_API_URL: &str = "http://127.0.0.1:18080";
const CONFIG_PATH_ENV: &str = "ZAMAPAY_CONFIG_PATH";
const API_URL_ENV: &str = "ZAMAPAY_API_URL";
const CONTROL_SESSION_ENV: &str = "ZAMAPAY_CONTROL_SESSION";
const PROJECT_ID_ENV: &str = "ZAMAPAY_PROJECT_ID";

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CliConfig {
    pub api_url: Option<String>,
    pub owner_address: Option<String>,
    pub session_id: Option<String>,
    #[serde(default)]
    pub linked_projects: BTreeMap<String, LinkedProject>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkedProject {
    pub project_id: String,
    #[serde(default)]
    pub project_name: Option<String>,
}

impl CliConfig {
    pub fn load() -> Result<Self> {
        let path = config_path()?;
        if !path.exists() {
            return Ok(Self::default());
        }
        let raw = fs::read_to_string(&path)
            .with_context(|| format!("failed to read {}", path.display()))?;
        serde_json::from_str(&raw).with_context(|| format!("failed to parse {}", path.display()))
    }

    pub fn save(&self) -> Result<()> {
        let path = config_path()?;
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)
                .with_context(|| format!("failed to create {}", parent.display()))?;
        }
        let tmp = path.with_extension("json.tmp");
        let body = serde_json::to_string_pretty(self)?;
        fs::write(&tmp, body).with_context(|| format!("failed to write {}", tmp.display()))?;
        fs::rename(&tmp, &path).with_context(|| {
            format!(
                "failed to replace {} with {}",
                path.display(),
                tmp.display()
            )
        })?;
        Ok(())
    }

    pub fn set_login(&mut self, api_url: &str, owner_address: &str, session_id: &str) {
        self.api_url = Some(clean_api_url(api_url));
        self.owner_address = Some(owner_address.to_string());
        self.session_id = Some(session_id.to_string());
    }

    pub fn clear_login(&mut self) {
        self.owner_address = None;
        self.session_id = None;
    }

    pub fn link_project(&mut self, cwd: &Path, project_id: &str, project_name: Option<&str>) {
        self.linked_projects.insert(
            normalize_path(cwd),
            LinkedProject {
                project_id: project_id.to_string(),
                project_name: project_name.map(str::to_string),
            },
        );
    }

    pub fn unlink_project(&mut self, cwd: &Path) -> Option<LinkedProject> {
        self.linked_projects.remove(&normalize_path(cwd))
    }

    pub fn linked_project_for_cwd(&self, cwd: &Path) -> Option<LinkedProject> {
        let mut cursor = Some(cwd);
        while let Some(path) = cursor {
            if let Some(link) = self.linked_projects.get(&normalize_path(path)) {
                return Some(link.clone());
            }
            cursor = path.parent();
        }
        None
    }
}

pub fn config_path() -> Result<PathBuf> {
    if let Ok(path) = env::var(CONFIG_PATH_ENV) {
        let path = path.trim();
        if !path.is_empty() {
            return Ok(PathBuf::from(path));
        }
    }
    let home = env::var("HOME").context("HOME is required to locate ~/.zamapay/config.json")?;
    Ok(PathBuf::from(home).join(".zamapay").join("config.json"))
}

pub fn effective_api_url(explicit: Option<&str>, config: &CliConfig) -> String {
    explicit
        .filter(|value| !value.trim().is_empty())
        .map(clean_api_url)
        .or_else(|| {
            env::var(API_URL_ENV)
                .ok()
                .map(|value| clean_api_url(&value))
        })
        .or_else(|| config.api_url.as_deref().map(clean_api_url))
        .unwrap_or_else(|| DEFAULT_API_URL.to_string())
}

pub fn control_session(config: &CliConfig) -> Result<String> {
    if let Ok(session) = env::var(CONTROL_SESSION_ENV) {
        let session = session.trim();
        if !session.is_empty() {
            return Ok(session.to_string());
        }
    }
    config
        .session_id
        .as_deref()
        .filter(|session| !session.trim().is_empty())
        .map(str::to_string)
        .ok_or_else(|| anyhow::anyhow!("not logged in; run `zamapay login --private-key-stdin`"))
}

pub fn resolve_project_id(explicit: Option<&str>, config: &CliConfig) -> Result<String> {
    if let Some(project_id) = explicit.filter(|value| !value.trim().is_empty()) {
        return Ok(project_id.to_string());
    }
    if let Ok(project_id) = env::var(PROJECT_ID_ENV) {
        let project_id = project_id.trim();
        if !project_id.is_empty() {
            return Ok(project_id.to_string());
        }
    }
    let cwd = current_dir()?;
    config
        .linked_project_for_cwd(&cwd)
        .map(|link| link.project_id)
        .ok_or_else(|| {
            anyhow::anyhow!(
                "missing project context; pass --project-id or run `zamapay project link`"
            )
        })
}

pub fn current_dir() -> Result<PathBuf> {
    env::current_dir().context("failed to read current directory")
}

pub fn clean_api_url(api_url: &str) -> String {
    api_url.trim().trim_end_matches('/').to_string()
}

pub fn require(condition: bool, message: &str) -> Result<()> {
    if condition {
        Ok(())
    } else {
        bail!("{message}")
    }
}

fn normalize_path(path: &Path) -> String {
    path.canonicalize()
        .unwrap_or_else(|_| path.to_path_buf())
        .to_string_lossy()
        .to_string()
}
