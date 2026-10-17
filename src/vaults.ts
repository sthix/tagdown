// Vaults: the folders Tagdown keeps notes in. One is open at a time; opening
// another relaunches the app in it, so the index, watcher and images follow.

import { invoke } from '@tauri-apps/api/core';
import { message, open } from '@tauri-apps/plugin-dialog';

export type VaultEntry = {
  path: string;
  name: string;
  active: boolean;
  available: boolean;
};

let beforeSwitch: () => Promise<void> = async () => {};

/** Run `settle` (save pending edits) before the app relaunches in another vault. */
export function onBeforeVaultSwitch(settle: () => Promise<void>) {
  beforeSwitch = settle;
}

export async function listVaults(): Promise<VaultEntry[]> {
  try {
    return await invoke<VaultEntry[]>('list_vaults');
  } catch {
    // Outside the app (the browser preview) there are no vaults to list.
    return [];
  }
}

/** Open the vault at `path`, making the folder one if it isn't yet. */
export async function switchVault(path: string) {
  try {
    await beforeSwitch();
    await invoke('open_vault', { path });
  } catch (error) {
    await message(String(error), { title: 'Couldn’t open that vault', kind: 'error' });
  }
}

/** Ask for a folder and open it as the vault. */
export async function chooseVaultFolder() {
  const path = await open({ directory: true, title: 'Choose a folder for your vault' });
  if (typeof path === 'string') await switchVault(path);
}

export async function forgetVault(path: string) {
  await invoke('forget_vault', { path });
}

/** `/Users/me/Notes` → `~/Notes`. */
export function shortPath(path: string) {
  return path.replace(/^\/Users\/[^/]+/, '~');
}
