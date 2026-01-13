import * as vscode from 'vscode';
import { EphemeraAPIClient } from './api/client';
import { InstancesProvider, InstanceTreeItem } from './views/instancesProvider';
import { PlansProvider } from './views/plansProvider';
import { EphemeraPanel } from './webview/ephemeraPanel';

let apiClient: EphemeraAPIClient;
let instancesProvider: InstancesProvider;
let plansProvider: PlansProvider;
let statusBarItem: vscode.StatusBarItem;
let autoRefreshInterval: NodeJS.Timeout | undefined;

export async function activate(context: vscode.ExtensionContext) {
    const config = vscode.workspace.getConfiguration('ephemera');
    const baseUrl = config.get<string>('apiBaseUrl') || 'https://app.alice.ws';
    
    apiClient = new EphemeraAPIClient(baseUrl);

    // Initial credentials load
    const secretStorage = context.secrets;
    const clientId = await secretStorage.get('ephemera.clientId');
    const secret = await secretStorage.get('ephemera.clientSecret');

    if (clientId && secret) {
        apiClient.setCredentials({ clientId, secret });
    } else {
        vscode.window.showInformationMessage('请先配置 Ephemera API 凭据', '立即配置').then(selection => {
            if (selection === '立即配置') {
                vscode.commands.executeCommand('ephemera.setCredentials');
            }
        });
    }

    // Register Views
    instancesProvider = new InstancesProvider(apiClient);
    plansProvider = new PlansProvider(apiClient);
    vscode.window.registerTreeDataProvider('ephemeraInstances', instancesProvider);
    vscode.window.registerTreeDataProvider('ephemeraPlans', plansProvider);

    // Status Bar
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBarItem.command = 'ephemera.openConsole';
    context.subscriptions.push(statusBarItem);
    updateStatusBar();

    // Commands
    context.subscriptions.push(
        vscode.commands.registerCommand('ephemera.setCredentials', async () => {
            const newClientId = await vscode.window.showInputBox({ 
                prompt: '请输入 Ephemera Client ID',
                placeHolder: 'Client ID',
                ignoreFocusOut: true,
                value: await secretStorage.get('ephemera.clientId') || ''
            });
            if (!newClientId) return;

            const newSecret = await vscode.window.showInputBox({ 
                prompt: '请输入 Ephemera Client Secret',
                placeHolder: 'Client Secret',
                password: true,
                ignoreFocusOut: true
            });
            if (!newSecret) return;

            try {
                apiClient.setCredentials({ clientId: newClientId, secret: newSecret });
                await secretStorage.store('ephemera.clientId', newClientId);
                await secretStorage.store('ephemera.clientSecret', newSecret);
                
                vscode.window.showInformationMessage('凭据同步保存成功');
                instancesProvider.refresh();
                plansProvider.refresh();
                updateStatusBar();
                setupAutoRefresh();
            } catch (error: any) {
                vscode.window.showErrorMessage(`凭据设置失败: ${error.message}`);
                apiClient.clearCredentials();
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('ephemera.refreshInstances', () => {
            instancesProvider.refresh();
            plansProvider.refresh();
            updateStatusBar();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('ephemera.openConsole', () => {
            EphemeraPanel.createOrShow(context.extensionUri, apiClient);
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('ephemera.connectSSH', (item: InstanceTreeItem) => {
            const terminal = vscode.window.createTerminal(`SSH: ${item.instance.hostname}`);
            terminal.show();
            vscode.window.showInformationMessage(`正在连接 ${item.instance.ipv4}，密码已复制到剪贴板`);
            vscode.env.clipboard.writeText(item.instance.password);
            terminal.sendText(`ssh ${item.instance.user}@${item.instance.ipv4}`);
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('ephemera.syncWorkspace', async (item: InstanceTreeItem | { instance: any }) => {
            const instance = (item instanceof InstanceTreeItem) ? item.instance : item.instance;
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders) {
                vscode.window.showErrorMessage('请先打开文件夹');
                return;
            }

            const folder = workspaceFolders[0].uri.fsPath;
            const remotePath = `/home/${instance.user}/project`;
            const terminal = getOrCreateSyncTerminal();
            terminal.show();
            
            const exclude = vscode.workspace.getConfiguration('ephemera').get<string[]>('syncExclude') || ['.git', 'node_modules', 'out', 'dist', '.vscode'];
            const excludeArgs = exclude.map(e => `--exclude="${e}"`).join(' ');
            
            vscode.window.showInformationMessage(`开始同步到 ${instance.ipv4}`, '复制密码').then(sel => {
                if (sel === '复制密码') vscode.env.clipboard.writeText(instance.password);
            });

            terminal.sendText(`ssh ${instance.user}@${instance.ipv4} "mkdir -p ${remotePath}"`);
            terminal.sendText(`rsync -avz -e ssh ${excludeArgs} "${folder}/" ${instance.user}@${instance.ipv4}:${remotePath}`);
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('ephemera.openRemoteSSH', async (item: InstanceTreeItem) => {
            const remoteSshExt = vscode.extensions.getExtension('ms-vscode-remote.remote-ssh');
            if (!remoteSshExt) {
                const install = await vscode.window.showErrorMessage('请安装 Remote-SSH 扩展', '去安装');
                if (install === '去安装') vscode.commands.executeCommand('extension.open', 'ms-vscode-remote.remote-ssh');
                return;
            }

            const instance = item.instance;
            vscode.window.showInformationMessage(`正在连接 Remote-SSH: ${instance.ipv4}`);
            vscode.env.clipboard.writeText(instance.password);
            
            const uri = vscode.Uri.parse(`vscode-remote://ssh-remote+${instance.user}@${instance.ipv4}/home/${instance.user}/project`);
            vscode.commands.executeCommand('vscode.openFolder', uri, true);
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('ephemera.copyIP', (item: InstanceTreeItem) => {
            vscode.env.clipboard.writeText(item.instance.ipv4);
            vscode.window.showInformationMessage('IP已复制');
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('ephemera.copyPassword', (item: InstanceTreeItem) => {
            vscode.env.clipboard.writeText(item.instance.password);
            vscode.window.showInformationMessage('密码已复制');
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('ephemera.deleteInstance', async (item: InstanceTreeItem) => {
            const confirm = await vscode.window.showWarningMessage(`确认删除 ${item.instance.hostname}?`, { modal: true }, '删除');
            if (confirm === '删除') {
                await apiClient.deleteInstance(item.instance.id);
                instancesProvider.refresh();
                updateStatusBar();
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('ephemera.rebuildInstance', async (item: InstanceTreeItem) => {
            const confirm = await vscode.window.showWarningMessage(`确认重装 ${item.instance.hostname}?`, { modal: true }, '重装');
            if (confirm === '重装') {
                await apiClient.rebuildInstance(item.instance.id, { os_id: 1 });
                vscode.window.showInformationMessage('重装已启动');
                instancesProvider.refresh();
            }
        })
    );

    setupAutoRefresh();
}

function updateStatusBar() {
    apiClient.listInstances().then(res => {
        if (res.code === 200) {
            statusBarItem.text = `$(cloud) Ephemera: ${res.data.length}`;
            statusBarItem.show();
        } else {
            statusBarItem.hide();
        }
    }).catch(() => statusBarItem.hide());
}

function setupAutoRefresh() {
    if (autoRefreshInterval) clearInterval(autoRefreshInterval);
    autoRefreshInterval = setInterval(() => {
        instancesProvider.refresh();
        updateStatusBar();
    }, 60000);
}

let syncTerminal: vscode.Terminal | undefined;
function getOrCreateSyncTerminal(): vscode.Terminal {
    if (!syncTerminal || syncTerminal.exitStatus !== undefined) {
        syncTerminal = vscode.window.createTerminal('Ephemera Sync');
    }
    return syncTerminal;
}

export function deactivate() {
    if (autoRefreshInterval) clearInterval(autoRefreshInterval);
}
