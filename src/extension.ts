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
    console.log('Ephemera: Activating...');
    try {
        const config = vscode.workspace.getConfiguration('ephemera');
        const baseUrl = config.get<string>('apiBaseUrl') || 'https://app.alice.ws';
        
        apiClient = new EphemeraAPIClient(baseUrl);
        cfClient = new CloudflareClient(context);

        const secretStorage = context.secrets;
        const clientId = await secretStorage.get('ephemera.clientId');
        const secret = await secretStorage.get('ephemera.clientSecret');

        if (clientId && secret) {
            apiClient.setCredentials({ clientId, secret });
        }

        instancesProvider = new InstancesProvider(apiClient);
        plansProvider = new PlansProvider(apiClient);
        vscode.window.registerTreeDataProvider('ephemeraInstances', instancesProvider);
        vscode.window.registerTreeDataProvider('ephemeraPlans', plansProvider);

        statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
        statusBarItem.command = 'ephemera.openConsole';
        context.subscriptions.push(statusBarItem);
        
        registerCommands(context, secretStorage);
        setupAutoRefresh();
        updateStatusBar();
        
        console.log('Ephemera: Activated successfully');
    } catch (e) {
        console.error('Ephemera: Activation failed', e);
        vscode.window.showErrorMessage(`Ephemera 扩展激活失败: ${e}`);
    }
}

function registerCommands(context: vscode.ExtensionContext, secretStorage: vscode.SecretStorage) {
    const commands = {
        'ephemera.setCredentials': async () => {
            const newClientId = await vscode.window.showInputBox({ prompt: 'Ephemera Client ID', value: await secretStorage.get('ephemera.clientId') || '' });
            if (!newClientId) return;
            const newSecret = await vscode.window.showInputBox({ prompt: 'Ephemera Client Secret', password: true });
            if (!newSecret) return;
            apiClient.setCredentials({ clientId: newClientId, secret: newSecret });
            await secretStorage.store('ephemera.clientId', newClientId);
            await secretStorage.store('ephemera.clientSecret', newSecret);
            vscode.window.showInformationMessage('凭据设置成功');
            refreshAll();
        },
        'ephemera.setCloudflareToken': async () => {
            const token = await vscode.window.showInputBox({ prompt: 'Cloudflare API Token', password: true });
            if (token) { await cfClient.setToken(token); vscode.window.showInformationMessage('Cloudflare Token 设置成功'); }
        },
        'ephemera.openConsole': () => EphemeraPanel.createOrShow(context.extensionUri, apiClient, cfClient),
        'ephemera.viewInstanceDetails': (item: InstanceTreeItem) => {
            EphemeraPanel.createOrShow(context.extensionUri, apiClient, cfClient);
            // 这里可以添加逻辑让 Panel 自动滚动到该实例，但目前列表较小时直接打开即可
        },
        'ephemera.refreshInstances': () => { refreshAll(); vscode.window.showInformationMessage('已刷新'); },
        'ephemera.createInstance': () => vscode.commands.executeCommand('ephemera.openConsole'),
        'ephemera.copyIP': (item: InstanceTreeItem) => { vscode.env.clipboard.writeText(item.instance.ipv4); vscode.window.showInformationMessage('IP 已复制'); },
        'ephemera.copyPassword': (item: InstanceTreeItem) => { vscode.env.clipboard.writeText(item.instance.password); vscode.window.showInformationMessage('密码已复制'); },
        'ephemera.connectSSH': (item: InstanceTreeItem) => {
            const t = vscode.window.createTerminal(`SSH: ${item.instance.hostname}`);
            t.show(); t.sendText(`ssh ${item.instance.user}@${item.instance.ipv4}`);
        },
        'ephemera.openRemoteSSH': (item: InstanceTreeItem) => {
            const uri = vscode.Uri.parse(`vscode-remote://ssh-remote+${item.instance.user}@${item.instance.ipv4}/home/${item.instance.user}`);
            vscode.commands.executeCommand('vscode.openFolder', uri, true);
        },
        'ephemera.syncWorkspace': async (item: InstanceTreeItem | { instance: any }) => {
            const inst = (item instanceof InstanceTreeItem) ? item.instance : item.instance;
            const folders = vscode.workspace.workspaceFolders;
            if (!folders) return;
            const remotePath = `/home/${inst.user}/project`;
            const terminal = getOrCreateSyncTerminal();
            terminal.show();
            const exclude = vscode.workspace.getConfiguration('ephemera').get<string[]>('syncExclude') || [];
            const excludeArgs = exclude.map(e => `--exclude="${e}"`).join(' ');
            terminal.sendText(`ssh ${inst.user}@${inst.ipv4} "mkdir -p ${remotePath}"`);
            terminal.sendText(`rsync -avz -e ssh ${excludeArgs} "${folders[0].uri.fsPath}/" ${inst.user}@${inst.ipv4}:${remotePath}`);
        },
        'ephemera.executeCommand': async (item: InstanceTreeItem) => {
            const cmd = await vscode.window.showInputBox({ prompt: '输入命令' });
            if (cmd) { const res = await apiClient.executeCommand(item.instance.id, cmd); vscode.window.showInformationMessage(res.code === 200 ? `提交成功: ${res.data.command_uid}` : `失败: ${res.message}`); }
        },
        'ephemera.deleteInstance': async (item: InstanceTreeItem) => {
            if (await vscode.window.showWarningMessage(`确定删除 ${item.instance.hostname}？`, { modal: true }, '确定') === '确定') {
                const res = await apiClient.deleteInstance(item.instance.id);
                if (res.code === 200) { vscode.window.showInformationMessage('已删除'); instancesProvider.refresh(); } else vscode.window.showErrorMessage(res.message);
            }
        },
        'ephemera.renewInstance': async (item: InstanceTreeItem) => {
            const h = await vscode.window.showInputBox({ prompt: '续费时长(H)', value: '24' });
            if (h) { const res = await apiClient.renewInstance(item.instance.id, parseInt(h)); if (res.code === 200) { vscode.window.showInformationMessage('成功'); instancesProvider.refresh(); } else vscode.window.showErrorMessage(res.message); }
        },
        'ephemera.rebuildInstance': async (item: InstanceTreeItem) => {
            if (await vscode.window.showWarningMessage('确定重装？', { modal: true }, '确定') === '确定') {
                const res = await apiClient.rebuildInstance(item.instance.id, { os_id: 1 });
                if (res.code === 200) { vscode.window.showInformationMessage('重装中'); setTimeout(() => instancesProvider.refresh(), 5000); } else vscode.window.showErrorMessage(res.message);
            }
        }
    };

    Object.entries(commands).forEach(([id, handler]) => {
        context.subscriptions.push(vscode.commands.registerCommand(id, handler));
    });

    ['start', 'stop', 'restart'].forEach(op => {
        const action: any = op === 'start' ? 'boot' : (op === 'stop' ? 'shutdown' : 'restart');
        context.subscriptions.push(vscode.commands.registerCommand(`ephemera.${op}Instance`, async (item: InstanceTreeItem) => {
            const res = await apiClient.powerOperation(item.instance.id, action);
            if (res.code === 200) { vscode.window.showInformationMessage('已下发'); setTimeout(() => instancesProvider.refresh(), 2000); } else vscode.window.showErrorMessage(res.message);
        }));
    });
}

function refreshAll() {
    instancesProvider.refresh();
    plansProvider.refresh();
    updateStatusBar();
}

function updateStatusBar() {
    apiClient.listInstances().then(res => {
        if (res.code === 200) { statusBarItem.text = `$(cloud) Ephemera: ${res.data.length}`; statusBarItem.show(); }
    }).catch(() => {});
}

function setupAutoRefresh() {
    if (autoRefreshInterval) clearInterval(autoRefreshInterval);
    autoRefreshInterval = setInterval(() => refreshAll(), 60000);
}

let syncTerminal: vscode.Terminal | undefined;
function getOrCreateSyncTerminal(): vscode.Terminal {
    if (!syncTerminal || syncTerminal.exitStatus !== undefined) syncTerminal = vscode.window.createTerminal('Ephemera Sync');
    return syncTerminal;
}

export function deactivate() { if (autoRefreshInterval) clearInterval(autoRefreshInterval); }
