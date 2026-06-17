import { App, FuzzySuggestModal } from "obsidian";
import { ProtectedPath } from "./types";
import type StoneGatePlugin from "./main";

export class UnlockPathModal extends FuzzySuggestModal<ProtectedPath> {
  plugin: StoneGatePlugin;

  constructor(app: App, plugin: StoneGatePlugin) {
    super(app);
    this.plugin = plugin;
    this.setPlaceholder("Search for a locked path to unlock...");
  }

  getItems(): ProtectedPath[] {
    // Return only paths that are currently locked and either Ghosted or marked for the menu
    return this.plugin.settings.protectedPaths.filter(p => 
      this.plugin.lockManager.isLocked(p.path) && 
      (p.enableGhostMode === true || p.showInUnlockMenu === true)
    );
  }

  getItemText(item: ProtectedPath): string {
    return item.label ? `${item.label} (${item.path})` : item.path;
  }

  onChooseItem(item: ProtectedPath, evt: MouseEvent | KeyboardEvent): void {
    // Trigger the overlay to unlock that specific path
    this.plugin.lockManager.triggerLock(item.path);
  }
}
