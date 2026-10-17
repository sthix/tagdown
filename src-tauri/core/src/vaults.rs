// The vaults the app knows about and which one is open. Kept outside any vault
// so the app can find its way back, and shared with the CLI / MCP server so
// they follow whichever vault the app last opened.

use std::{fs, path::{Path, PathBuf}};

use serde::{Deserialize, Serialize};

use crate::vault::Vault;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct VaultList {
    /// The vault the app opens on launch; `None` means the default one.
    pub active: Option<PathBuf>,
    /// Every vault opened so far, in the order they were added.
    #[serde(default)]
    pub vaults: Vec<PathBuf>,
}

impl VaultList {
    /// The saved list; on first use, just the default vault.
    pub fn load() -> Self {
        let mut list: Self = config_path()
            .ok()
            .and_then(|path| fs::read_to_string(path).ok())
            .and_then(|text| serde_json::from_str(&text).ok())
            .unwrap_or_default();
        if list.vaults.is_empty() {
            list.vaults.extend(Vault::default_root());
        }
        list
    }

    pub fn save(&self) -> Result<(), String> {
        let path = config_path()?;
        if let Some(dir) = path.parent() {
            fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        }
        fs::write(path, serde_json::to_string_pretty(self).unwrap()).map_err(|e| e.to_string())
    }

    /// The vault to open: the active one while it's still there, else the default.
    pub fn active_root(&self) -> Result<PathBuf, String> {
        match &self.active {
            Some(root) if is_vault(root) => Ok(root.clone()),
            _ => Vault::default_root(),
        }
    }

    /// Remember `root` and make it the one to open.
    pub fn activate(&mut self, root: PathBuf) {
        if !self.vaults.contains(&root) {
            self.vaults.push(root.clone());
        }
        self.active = Some(root);
    }

    /// Forget `root`. Its files stay where they are.
    pub fn forget(&mut self, root: &Path) {
        self.vaults.retain(|v| v != root);
        if self.active.as_deref() == Some(root) {
            self.active = None;
        }
    }
}

/// True when `root` holds a Tagdown vault.
pub fn is_vault(root: &Path) -> bool {
    root.join(".tagdown").join("vault.json").is_file()
}

/// `~/Library/Application Support/Tagdown/vaults.json` on macOS,
/// `$XDG_CONFIG_HOME/tagdown/vaults.json` (or `~/.config/…`) elsewhere.
pub fn config_path() -> Result<PathBuf, String> {
    let home = PathBuf::from(std::env::var("HOME").map_err(|_| "HOME is not set".to_string())?);
    let dir = if cfg!(target_os = "macos") {
        home.join("Library").join("Application Support").join("Tagdown")
    } else {
        std::env::var("XDG_CONFIG_HOME").map(PathBuf::from).unwrap_or_else(|_| home.join(".config")).join("tagdown")
    };
    Ok(dir.join("vaults.json"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("tagdown-vaults-{name}-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn active_vault_falls_back_to_default_when_missing() {
        let mut list = VaultList::default();
        list.activate(temp_dir("missing").join("gone"));
        assert_eq!(list.active_root().unwrap(), Vault::default_root().unwrap());
    }

    #[test]
    fn activating_and_forgetting() {
        let root = temp_dir("work");
        Vault::open_or_create(root.clone()).unwrap();
        let mut list = VaultList::default();
        list.activate(root.clone());
        list.activate(root.clone());
        assert_eq!(list.vaults, vec![root.clone()]);
        assert_eq!(list.active_root().unwrap(), root);
        list.forget(&root);
        assert!(list.vaults.is_empty());
        assert_eq!(list.active, None);
    }
}
