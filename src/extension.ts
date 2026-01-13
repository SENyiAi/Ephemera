import * as vscode from 'vscode';
import { EphemeraAPIClient } from './api/client';
import { CloudflareClient } from './api/cloudflare';
import { InstancesProvider, InstanceTreeItem } from './views/instancesProvider';
import { PlansProvider } from './views/plansProvider';
import { EphemeraPanel } from './webview/ephemeraPanel';

let apiClient: EphemeraAPIClient;
let cfClient: CloudflareClient;
let instancesProvider: InstancesProvider;
let plansProvider: PlansProvider;
let statusBarItem: vscode.StatusBarItem;
let autoRefreshInterval: NodeJS.Timeout | undefined;

export async function activate(context: vscode.ExtensionContext) {
    const config = vscode.workspace.getConfiguration('ephemera');
    const baseUrl = config.get<string>('apiBaseUrl') || 'https://app.alice.ws';
    
    apiClient = new EphemeraAPIClient(baseUrl);
    cfClient = new CloudflareClient(context);

    // Load credentials
    const secretStorage = context.secrets;
    const clientId = await secretStorage.get('ephemera.clientId');
    const secret = await secretStorage.get('ephemera.clientSecret');

    if (clientId && secret) {
        apiClient.setCredentials({ clientId, secret });
    }

    // Register Views
    instancesProvider = new InstancesProvider(apiClient);
    plansProvider = new PlansProvider(apiClient);
    vscode.window.registerTreeDataProvider('ephemeraInstances', instancesProvider);
    vscode.window.registerTreeDataProvider('ephemeraPlans', plansProvider);

    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBarItem.command = 'ephemera.openConsole';
    context.subscriptions.push(statusBarItem);
    updateStatusBar();

    // Commands
    context.subscriptions.push(
        vscode.commands.registerCommand('ephemera.setCredentials', async () => {
            const newClientId = await vscode.window.showInputBox({ prompt: 'Ephemera Client ID', value: await secretStorage.get('ephemera.clientId') || '' });
            if (!newClientId) return;
            const newSecret = await vscode.window.showInputBox({ prompt: 'Ephemera Client Secret', password: true });
            if (!newSecret) return;

            apiClient.setCredentials({ clientId: newClientId, secret: newSecret });
            await secretStorage.store('ephemera.clientId', newClientId);
            await secretStorage.store('ephemera.clientSecret', newSecret);
            vscode.window.showInformationMessage('凭据设置成功');
            instancesProvider.refresh();
            plansProvider.refresh();
            updateStatusBar();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('ephemera.setCloudflareToken', async () => {
            const token = await vscode.window.showInputBox({ prompt: 'Cloudflare API Token', password: true });
            if (token) {
                await cfClient.setToken(token);
                vscode.window.showInformationMessage('Cloudflare Token 设置成功');
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('ephemera.openConsole', () => {
            EphemeraPanel.createOrShow(context.extensionUri, apiClient, cfClient);
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('ephemera.syncWorkspace', async (item: InstanceTreeItem | { instance: any }) => {
            const instance = (item instanceof InstanceTreeItem) ? item.instance : item.instance;
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders) return;
            const folder = workspaceFolders[0].uri.fsPath;
            const remotePath = `/home/${instance.user}/project`;
            const terminal = getOrCreateSyncTerminal();
            terminal.show();
            const exclude = vscode.workspace.getConfiguration('ephemera').get<string[]>('syncExclude') || [];
            const excludeArgs = exclude.map(e => `--exclude="${e}"`).join(' ');
            terminal.sendText(`ssh ${instance.user}@${instance.ipv4} "mkdir -p ${remotePath}"`);
            terminal.sendText(`rsync -avz -e ssh ${excludeArgs} "${folder}/" ${instance.user}@${instance.ipv4}:${remotePath}`);
        })
    );

    setupAutoRefresh();
}

function updateStatusBar() {
    apiClient.listInstances().then(res => {
        if (res.code === 200) {
            statusBarItem.text = `$(cloud) Ephemera: ${res.data.length}`;
            statusBarItem.show();
        }
    }).catch(() => {});
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
    if (!syncTerminal || syncTerminal.exitStatus !== undefined) syncTerminal = vscode.window.createTerminal('Ephemera Sync');
    return syncTerminal;
}

export function deactivate() {
    if (autoRefreshInterval) clearInterval(autoRefreshInterval);
}
