/**
 * Web Compatibility Layer
 * 
 * This module provides mock implementations of Tauri APIs for browser-only mode.
 * When running in a browser (not Tauri), these mocks allow the app to function
 * without the native Tauri backend.
 */

// Detect if we're running in Tauri
export const isTauri = (): boolean => {
  return typeof window !== 'undefined' && '__TAURI__' in window;
};

// Web mode detection
export const isWebMode = (): boolean => !isTauri();

/**
 * Mock implementation of Tauri's invoke function for web mode
 */
export const webInvoke = async <T>(cmd: string, args?: Record<string, unknown>): Promise<T> => {
  console.log(`[WebCompat] Mock invoke: ${cmd}`, args);
  
  switch (cmd) {
    case 'get_node_path':
      return '/usr/local/bin/node' as T;
    case 'get_claude_path':
      return '/usr/local/bin/claude' as T;
    case 'get_kiro_path':
      return '/usr/local/bin/kiro' as T;
    case 'create_interactive_terminal':
      return undefined as T;
    case 'close_terminal':
      return undefined as T;
    case 'terminal_input':
      return undefined as T;
    case 'start_background_process':
      return 0 as T; // Mock PID
    case 'kill_process':
      return undefined as T;
    default:
      console.warn(`[WebCompat] Unhandled invoke command: ${cmd}`);
      return undefined as T;
  }
};

/**
 * Mock event listener for web mode
 */
export const webListen = async <T>(
  event: string,
  handler: (event: { payload: T }) => void
): Promise<() => void> => {
  console.log(`[WebCompat] Mock listen: ${event}`);
  // Return a no-op unsubscribe function
  return () => {};
};

/**
 * Web-compatible file picker using the File System Access API
 */
export const webSelectFolder = async (): Promise<string | null> => {
  try {
    // Check if File System Access API is available
    if ('showDirectoryPicker' in window) {
      const dirHandle = await (window as any).showDirectoryPicker({
        mode: 'readwrite'
      });
      // Store the handle for later use
      (window as any).__selectedDirHandle = dirHandle;
      return dirHandle.name;
    } else {
      // Fallback: prompt for a folder name
      const folderName = prompt('Enter a project folder name:', 'my-project');
      return folderName || 'my-project';
    }
  } catch (error) {
    if ((error as Error).name === 'AbortError') {
      return null; // User cancelled
    }
    console.error('[WebCompat] Folder selection failed:', error);
    return null;
  }
};

/**
 * Mock Tauri dialog for folder selection
 */
export const webOpenDialog = async (options?: {
  directory?: boolean;
  multiple?: boolean;
  title?: string;
}): Promise<string | string[] | null> => {
  if (options?.directory) {
    const folder = await webSelectFolder();
    return folder;
  }
  return null;
};

/**
 * Mock store for session persistence (uses localStorage)
 */
export class WebStore {
  private storeName: string;

  constructor(name: string) {
    this.storeName = `voltcode_${name}`;
  }

  async get<T>(key: string): Promise<T | null> {
    try {
      const data = localStorage.getItem(`${this.storeName}_${key}`);
      return data ? JSON.parse(data) : null;
    } catch {
      return null;
    }
  }

  async set(key: string, value: unknown): Promise<void> {
    try {
      localStorage.setItem(`${this.storeName}_${key}`, JSON.stringify(value));
    } catch (error) {
      console.error('[WebStore] Failed to save:', error);
    }
  }

  async delete(key: string): Promise<void> {
    localStorage.removeItem(`${this.storeName}_${key}`);
  }

  async save(): Promise<void> {
    // localStorage saves immediately, no-op
  }
}

/**
 * Get the appropriate invoke function based on environment
 */
export const getInvoke = async (): Promise<typeof webInvoke> => {
  if (isTauri()) {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke;
  }
  return webInvoke;
};

/**
 * Get the appropriate listen function based on environment
 */
export const getListen = async (): Promise<typeof webListen> => {
  if (isTauri()) {
    const { listen } = await import('@tauri-apps/api/event');
    return listen;
  }
  return webListen;
};

/**
 * Get the appropriate dialog open function based on environment
 */
export const getDialogOpen = async (): Promise<typeof webOpenDialog> => {
  if (isTauri()) {
    const { open } = await import('@tauri-apps/plugin-dialog');
    return open;
  }
  return webOpenDialog;
};

/**
 * Get the appropriate store based on environment
 */
export const getStore = async (name: string): Promise<WebStore | any> => {
  if (isTauri()) {
    const { Store } = await import('@tauri-apps/plugin-store');
    return new Store(name);
  }
  return new WebStore(name);
};

