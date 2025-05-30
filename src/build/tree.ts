import * as path from "node:path";
import * as vscode from "vscode";
import type { XcodeScheme } from "../common/cli/scripts";
import type { ExtensionContext } from "../common/commands";
import { commonLogger } from "../common/logger";
import type { BuildManager } from "./manager";
import { getCurrentXcodeWorkspacePath, getWorkspacePath } from "./utils";
import { detectXcodeWorkspacesPaths } from "./utils";
import { ExtensionError } from "../common/errors";

type WorkspaceEventData = WorkspaceGroupTreeItem | undefined | null;
type BuildEventData = BuildTreeItem | undefined | null;

export class WorkspaceGroupTreeItem extends vscode.TreeItem {
  public provider: WorkspaceTreeProvider;
  public workspacePath: string;

  constructor(options: { workspacePath: string; provider: WorkspaceTreeProvider }) {

    // Extract just the xcodeproj name from the full path
    const match = options.workspacePath.match(/([^/]+)\.xcodeproj/);
    const displayName = match ? match[1] : path.basename(options.workspacePath);

    // What contructs the diplsy of the tree item
    super(displayName, vscode.TreeItemCollapsibleState.Expanded);



    this.workspacePath = options.workspacePath;
    this.provider = options.provider;


    let description = "";
    let color: vscode.ThemeColor;

    if (this.workspacePath === this.provider.defaultWorkspacePath) {
      description = `${description} ✓`;
      color = new vscode.ThemeColor("sweetpad.workspace");
      this.collapsibleState = vscode.TreeItemCollapsibleState.Expanded; // if the workspace is the current workspace, show it expanded

    } else {
      color = new vscode.Color(128, 128, 128, 1);
      this.collapsibleState = vscode.TreeItemCollapsibleState.None; // if the workspace is not the current workspace, show it collapsed
    }

    if (description) {
      this.description = description;
    }
    
    //is bazel project
    if (!this.workspacePath.includes("DoorDash.xcodeproj")) {
      this.iconPath = new vscode.ThemeIcon("folder", color);
    } else {
      this.iconPath = vscode.Uri.joinPath(vscode.Uri.file(this.provider.context?.extensionPath || ""), "images", "bazel.png");
    }

    this.contextValue = "workspace-group";
    this.tooltip = this.workspacePath;
  }
}


export class WorkspaceTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<WorkspaceEventData>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  public context: ExtensionContext | undefined;
  public buildManager: BuildManager;

  public defaultWorkspacePath: string | undefined;
  public defaultSchemeForBuild: string | undefined;
  public defaultSchemeForTesting: string | undefined;

  constructor(options: { context: ExtensionContext; buildManager: BuildManager}) {
    this.context = options.context;
    this.buildManager = options.buildManager;
    this.defaultWorkspacePath = getCurrentXcodeWorkspacePath(this.context);

    this.buildManager.on("updated", () => {
      this.refresh();
    });
    this.buildManager.on("currentWorkspacePathUpdated", (workspacePath) => {
      this.defaultWorkspacePath = workspacePath;
      this.buildManager.clearSchemesCache();
      this.buildManager.refresh();
      this.refresh();
    });
    this.buildManager.on("defaultSchemeForBuildUpdated", (scheme) => {
      this.defaultSchemeForBuild = scheme;
      this.refresh();
    });
    this.buildManager.on("defaultSchemeForTestingUpdated", (scheme) => {
      this.defaultSchemeForTesting = scheme;
      this.refresh();
    });
    this.defaultSchemeForBuild = this.buildManager.getDefaultSchemeForBuild();
    this.defaultSchemeForTesting = this.buildManager.getDefaultSchemeForTesting();
  }

  private refresh(): void {
    this._onDidChangeTreeData.fire(null);
    this.getChildren();
  }

  async getChildren(element?: WorkspaceGroupTreeItem | BuildTreeItem): Promise<vscode.TreeItem[]> {
    // Root level - show all workspaces
    if (!element) {
      try {
        const workspaces = await this.getWorkspacePaths();
        if (workspaces.length === 0) {
          void vscode.commands.executeCommand("setContext", "sweetpad.workspaces.noWorkspaces", true);
          return [];
        }
        void vscode.commands.executeCommand("setContext", "sweetpad.workspaces.noWorkspaces", false);
        return workspaces;
      } catch (error) {
        commonLogger.error("Failed to get workspaces", { error });
        void vscode.commands.executeCommand("setContext", "sweetpad.workspaces.noWorkspaces", true);
        return [];
      }
    }

    if (element instanceof WorkspaceGroupTreeItem) {

      const schemes = await this.getSchemes();

      return schemes;
    }

    return [];
  }

  async getTreeItem(element: WorkspaceGroupTreeItem): Promise<WorkspaceGroupTreeItem> {
    return element;
  }

  async getWorkspacePaths(): Promise<WorkspaceGroupTreeItem[]> {
    // Get all files that end with .xcworkspace (4 depth)
    const paths: string[] = await detectXcodeWorkspacesPaths();

    // No files, nothing to do
    if (paths.length === 0) {
      throw new ExtensionError("No xcode workspaces found", {
        context: {
          cwd: getWorkspacePath(),
        },
      });
    }

    // return list of workspace paths with just the xcodeproj name
    return paths.map(
      (workspacePath) => {
        return new WorkspaceGroupTreeItem({
          workspacePath: workspacePath,
          provider: this,
        });
      },
    );
  }

  async getSchemes(): Promise<BuildTreeItem[]> {
    let schemes: XcodeScheme[] = [];
    try {
      schemes = await this.buildManager.getSchemas();
    } catch (error) {
      commonLogger.error("Failed to get schemes", {
        error: error,
      });
    }

    if (schemes.length === 0) {
      // Display welcome screen with explanation what to do.
      // See "viewsWelcome": [ {"view": "sweetpad.build.view", ...} ] in package.json
      vscode.commands.executeCommand("setContext", "sweetpad.build.noSchemes", true);
    }

    // return list of schemes
    return schemes.map(
      (scheme) =>
        new BuildTreeItem({
          scheme: scheme.name,
          collapsibleState: vscode.TreeItemCollapsibleState.None,
          provider: this,
        }),
    );
  }
}

export class BuildTreeItem extends vscode.TreeItem {
  public provider: WorkspaceTreeProvider;
  public scheme: string;

  constructor(options: {
    scheme: string;
    collapsibleState: vscode.TreeItemCollapsibleState;
    provider: WorkspaceTreeProvider;
  }) {
    super(options.scheme, options.collapsibleState);
    this.provider = options.provider;
    this.scheme = options.scheme;

    const color = new vscode.ThemeColor("sweetpad.scheme");
    this.iconPath = new vscode.ThemeIcon("sweetpad-package", color);
    this.contextValue = "sweetpad.build.view.item";

    let description = "";
    if (this.scheme === this.provider.defaultSchemeForBuild) {
      description = `${description} ✓`;
    }
    if (this.scheme === this.provider.defaultSchemeForTesting) {
      description = `${description} (t)`;
    }
    if (description) {
      this.description = description;
    }
  }
}
// export class BuildTreeProvider implements vscode.TreeDataProvider<BuildTreeItem> {
//   private _onDidChangeTreeData = new vscode.EventEmitter<BuildEventData>();
//   readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
//   public context: ExtensionContext | undefined;
//   public buildManager: BuildManager;
//   public defaultSchemeForBuild: string | undefined;
//   public defaultSchemeForTesting: string | undefined;

//   constructor(options: { context: ExtensionContext; buildManager: BuildManager }) {
//     this.context = options.context;
//     this.buildManager = options.buildManager;
//     this.buildManager.on("updated", () => {
//       this.refresh();
//     });
//     this.buildManager.on("currentWorkspacePathUpdated", (workspacePath) => {
//       this.refresh();
//     });
//     this.buildManager.on("defaultSchemeForBuildUpdated", (scheme) => {
//       this.defaultSchemeForBuild = scheme;
//       this.refresh();
//     });
//     this.buildManager.on("defaultSchemeForTestingUpdated", (scheme) => {
//       this.defaultSchemeForTesting = scheme;
//       this.refresh();
//     });
//     this.defaultSchemeForBuild = this.buildManager.getDefaultSchemeForBuild();
//     this.defaultSchemeForTesting = this.buildManager.getDefaultSchemeForTesting();
//   }

//   private refresh(): void {
//     this._onDidChangeTreeData.fire(null);
//   }

//   async getChildren(element?: BuildTreeItem | undefined): Promise<BuildTreeItem[]> {
//     // get elements only for root
//     if (!element) {
//       const schemes = await this.getSchemes();
//       return schemes;
//     }

//     return [];
//   }

//   async getTreeItem(element: BuildTreeItem): Promise<BuildTreeItem> {
//     return element;
//   }

//   async getSchemes(): Promise<BuildTreeItem[]> {
//     let schemes: XcodeScheme[] = [];
//     try {
//       schemes = await this.buildManager.getSchemas();
//     } catch (error) {
//       commonLogger.error("Failed to get schemes", {
//         error: error,
//       });
//     }

//     if (schemes.length === 0) {
//       // Display welcome screen with explanation what to do.
//       // See "viewsWelcome": [ {"view": "sweetpad.build.view", ...} ] in package.json
//       vscode.commands.executeCommand("setContext", "sweetpad.build.noSchemes", true);
//     }

//     // return list of schemes
//     return schemes.map(
//       (scheme) =>
//         new BuildTreeItem({
//           scheme: scheme.name,
//           collapsibleState: vscode.TreeItemCollapsibleState.None,
//           provider: this.provider,
//         }),
//     );
//   }
// }
