import * as vscode from 'vscode';
import { EphemeraAPIClient, EphemeraInstance } from './api/client';
import { InstancesProvider, InstanceTreeItem } from './views/instancesProvider';
import { PlansProvider } from './views/plansProvider';
import { CreateInstancePanel } from './webview/createInstancePanel';

let apiClient: EphemeraAPIClient;
let instancesProvider: InstancesProvider;
let plansProvider: PlansProvider;
let statusBarItem: vscode.StatusBarItem;
let autoRefreshTimer: NodeJS.Timeout | undefined;

export function activate(context: vscode.ExtensionContext) {
    console.log('Ephemera Manager extension is now active');

    // Initialize API client
    const config = vscode.workspace.getConfiguration('ephemera');
    const apiBaseUrl = config.get<string>('apiBaseUrl') || 'https://app.alice.ws';
    apiClient = new EphemeraAPIClient(apiBaseUrl);

    // Load saved credentials
    loadCredentials(context);

    // Initialize providers
    instancesProvider = new InstancesProvider(apiClient);
    plansProvider = new PlansProvider(apiClient);

    // Register tree views
    vscode.window.registerTreeDataProvider('ephemeraInstances', instancesProvider);
    vscode.window.registerTreeDataProvider('ephemeraPlans', plansProvider);

    // Create status bar item
    createStatusBar();

    // Register commands
    registerCommands(context);

    // Setup auto-refresh
    setupAutoRefresh();

    // Initial refresh
    if (apiClient.hasCredentials()) {
        instancesProvider.refresh();
        plansProvider.refresh();
        updateStatusBar();
    }
}

function createStatusBar() {
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    statusBarItem.command = 'ephemera.refreshInstances';
    statusBarItem.text = '$(cloud) Ephemera: --';
    statusBarItem.tooltip = '点击刷新实例列表';
    
    const config = vscode.workspace.getConfiguration('ephemera');
    if (config.get<boolean>('showStatusBar')) {
        statusBarItem.show();
    }
}

function setupAutoRefresh() {
    const config = vscode.workspace.getConfiguration('ephemera');
    const interval = config.get<number>('autoRefreshInterval') || 0;
    
    if (autoRefreshTimer) {
        clearInterval(autoRefreshTimer);
    }
    
    if (interval > 0 && apiClient.hasCredentials()) {
        autoRefreshTimer = setInterval(() => {
            instancesProvider.refresh();
            updateStatusBar();
        }, interval * 1000);
    }
}

async function updateStatusBar() {
    try {
        const result = await apiClient.listInstances();
        if (result.code === 200) {
            const count = result.data.length;
            const activeCount = result.data.filter(i => i.status === 'active').length;
            statusBarItem.text = `$(cloud) Ephemera: ${activeCount}/${count}`;
            statusBarItem.tooltip = `活跃实例: ${activeCount}\n总实例: ${count}\n点击刷新`;
        }
    } catch (error) {
        statusBarItem.text = '$(cloud) Ephemera: ??';
    }
}

function registerCommands(context: vscode.ExtensionContext) {
    // Set Credentials
    context.subscriptions.push(
        vscode.commands.registerCommand('ephemera.setCredentials', async () => {
            const clientId = await vscode.window.showInputBox({
                prompt: '输入 API Client ID',
                placeHolder: 'cli_xxxxxxxxxx',
                ignoreFocusOut: true
            });

            if (!clientId) {
                return;
            }

            const secret = await vscode.window.showInputBox({
                prompt: '输入 API Secret',
                password: true,
                ignoreFocusOut: true
            });

            if (!secret) {
                return;
            }

            try {
                apiClient.setCredentials({ clientId, secret });
                
                // Test credentials
                await apiClient.getUserProfile();
                
                // Save credentials
                await context.secrets.store('ephemera.clientId', clientId);
                await context.secrets.store('ephemera.secret', secret);
                
                vscode.window.showInformationMessage('API 凭据设置成功！');
                
                instancesProvider.refresh();
                plansProvider.refresh();
                updateStatusBar();
                setupAutoRefresh();
            } catch (error: any) {
                vscode.window.showErrorMessage(`凭据验证失败: ${error.message}`);
                apiClient.clearCredentials();
            }
        })
    );

    // Refresh Instances
    context.subscriptions.push(
        vscode.commands.registerCommand('ephemera.refreshInstances', () => {
            instancesProvider.refresh();
            plansProvider.refresh();
            updateStatusBar();
            vscode.window.showInformationMessage('已刷新实例列表');
        })
    );

    // Create Instance
    context.subscriptions.push(
        vscode.commands.registerCommand('ephemera.createInstance', async () => {
            await CreateInstancePanel.createOrShow(context.extensionUri, apiClient);
        })
    );

    // Delete Instance
    context.subscriptions.push(
        vscode.commands.registerCommand('ephemera.deleteInstance', async (item: InstanceTreeItem) => {
            const confirm = await vscode.window.showWarningMessage(
                `确定要删除实例 "${item.instance.hostname}" 吗？\n此操作不可恢复！`,
                { modal: true },
                '删除'
            );

            if (confirm === '删除') {
                try {
                    await vscode.window.withProgress({
                        location: vscode.ProgressLocation.Notification,
                        title: '正在删除实例...',
                        cancellable: false
                    }, async () => {
                        const result = await apiClient.deleteInstance(item.instance.id);
                        if (result.code === 200) {
                            vscode.window.showInformationMessage('实例已删除');
                            instancesProvider.refresh();
                            updateStatusBar();
                        } else {
                            vscode.window.showErrorMessage(`删除失败: ${result.message}`);
                        }
                    });
                } catch (error: any) {
                    vscode.window.showErrorMessage(`删除出错: ${error.message}`);
                }
            }
        })
    );

    // View Instance Details
    context.subscriptions.push(
        vscode.commands.registerCommand('ephemera.viewInstanceDetails', async (item: InstanceTreeItem) => {
            try {
                const result = await apiClient.getInstanceState(item.instance.id);
                if (result.code === 200) {
                    const state = result.data;
                    const info = `
### 实例详情

**基本信息**
- ID: ${item.instance.id}
- 主机名: ${item.instance.hostname}
- 状态: ${state.state.state}

**网络信息**
- IPv4: ${item.instance.ipv4}
- IPv6: ${item.instance.ipv6}
- 用户名: ${item.instance.user}
- 密码: ${item.instance.password}

**资源配置**
- CPU: ${state.cpu} 核 ${item.instance.cpu_name}
- 内存: ${state.memory} MB
- 磁盘: ${state.disk} GB

**当前状态**
- CPU 使用: ${state.state.cpu}%
- 内存总量: ${(state.state.memory.memtotal / 1024).toFixed(2)} GB
- 内存可用: ${(state.state.memory.memavailable / 1024).toFixed(2)} GB
- 网络流入: ${(state.state.traffic.in / 1024 / 1024).toFixed(2)} MB
- 网络流出: ${(state.state.traffic.out / 1024 / 1024).toFixed(2)} MB

**时间信息**
- 创建时间: ${item.instance.creation_at}
- 到期时间: ${item.instance.expiration_at}
                    `.trim();

                    const doc = await vscode.workspace.openTextDocument({
                        content: info,
                        language: 'markdown'
                    });
                    await vscode.window.showTextDocument(doc, { preview: true });
                } else {
                    vscode.window.showErrorMessage(`获取详情失败: ${result.message}`);
                }
            } catch (error: any) {
                vscode.window.showErrorMessage(`获取详情出错: ${error.message}`);
            }
        })
    );

    // Power Operations
    registerPowerCommand(context, 'ephemera.startInstance', 'boot', '启动');
    registerPowerCommand(context, 'ephemera.stopInstance', 'shutdown', '关机');
    registerPowerCommand(context, 'ephemera.restartInstance', 'restart', '重启');

    // Renew Instance
    context.subscriptions.push(
        vscode.commands.registerCommand('ephemera.renewInstance', async (item: InstanceTreeItem) => {
            const hours = await vscode.window.showInputBox({
                prompt: '续费时长（小时）',
                value: '24',
                validateInput: (value) => {
                    const num = parseInt(value);
                    if (isNaN(num) || num <= 0) {
                        return '请输入有效的小时数';
                    }
                    return null;
                }
            });

            if (!hours) {
                return;
            }

            try {
                const result = await apiClient.renewInstance(item.instance.id, parseInt(hours));
                if (result.code === 200) {
                    vscode.window.showInformationMessage(
                        `续费成功！新到期时间: ${result.data.expiration_at}`
                    );
                    instancesProvider.refresh();
                } else {
                    vscode.window.showErrorMessage(`续费失败: ${result.message}`);
                }
            } catch (error: any) {
                vscode.window.showErrorMessage(`续费出错: ${error.message}`);
            }
        })
    );

    // Execute Command
    context.subscriptions.push(
        vscode.commands.registerCommand('ephemera.executeCommand', async (item: InstanceTreeItem) => {
            const command = await vscode.window.showInputBox({
                prompt: '输入要执行的命令',
                placeHolder: 'apt update && apt upgrade -y'
            });

            if (!command) {
                return;
            }

            try {
                const execResult = await apiClient.executeCommand(item.instance.id, command);
                if (execResult.code === 200) {
                    const commandUid = execResult.data.command_uid;
                    
                    // Poll for result
                    await vscode.window.withProgress({
                        location: vscode.ProgressLocation.Notification,
                        title: '正在执行命令...',
                        cancellable: false
                    }, async (progress) => {
                        let attempts = 0;
                        const maxAttempts = 60; // 5 minutes
                        
                        while (attempts < maxAttempts) {
                            await new Promise(resolve => setTimeout(resolve, 5000));
                            
                            const result = await apiClient.getCommandResult(item.instance.id, commandUid);
                            if (result.code === 200 && result.data.status === 'fetched') {
                                const output = result.data.output ? 
                                    Buffer.from(result.data.output, 'base64').toString('utf-8') : 
                                    '(无输出)';
                                
                                const doc = await vscode.workspace.openTextDocument({
                                    content: `# 命令执行结果\n\n**命令**: ${command}\n**结果**: ${result.data.result}\n**实例**: ${item.instance.hostname}\n\n## 输出\n\n\`\`\`\n${output}\n\`\`\``,
                                    language: 'markdown'
                                });
                                await vscode.window.showTextDocument(doc);
                                return;
                            }
                            
                            attempts++;
                            progress.report({ 
                                message: `等待执行完成... (${attempts * 5}s)` 
                            });
                        }
                        
                        vscode.window.showWarningMessage('命令执行超时，请稍后手动查看结果');
                    });
                } else {
                    vscode.window.showErrorMessage(`执行失败: ${execResult.message}`);
                }
            } catch (error: any) {
                vscode.window.showErrorMessage(`执行出错: ${error.message}`);
            }
        })
    );

    // Connect SSH
    context.subscriptions.push(
        vscode.commands.registerCommand('ephemera.connectSSH', async (item: InstanceTreeItem) => {
            const sshCommand = `ssh ${item.instance.user}@${item.instance.ipv4}`;
            
            const action = await vscode.window.showQuickPick([
                { label: '在终端打开', value: 'terminal' },
                { label: '复制 SSH 命令', value: 'copy' },
                { label: '使用 Remote-SSH 连接', value: 'remote' }
            ], {
                placeHolder: '选择连接方式'
            });

            if (!action) {
                return;
            }

            if (action.value === 'terminal') {
                const terminal = vscode.window.createTerminal(`SSH: ${item.instance.hostname}`);
                terminal.sendText(sshCommand);
                terminal.show();
            } else if (action.value === 'copy') {
                await vscode.env.clipboard.writeText(sshCommand);
                vscode.window.showInformationMessage('SSH 命令已复制到剪贴板');
            } else if (action.value === 'remote') {
                vscode.window.showInformationMessage('Remote-SSH 集成功能开发中...');
                // TODO: Integrate with Remote-SSH extension
            }
        })
    );

    // Copy IP
    context.subscriptions.push(
        vscode.commands.registerCommand('ephemera.copyIP', async (item: InstanceTreeItem) => {
            await vscode.env.clipboard.writeText(item.instance.ipv4);
            vscode.window.showInformationMessage('IP 地址已复制到剪贴板');
        })
    );

    // Copy Password
    context.subscriptions.push(
        vscode.commands.registerCommand('ephemera.copyPassword', async (item: InstanceTreeItem) => {
            await vscode.env.clipboard.writeText(item.instance.password);
            vscode.window.showInformationMessage('密码已复制到剪贴板');
        })
    );

    // Rebuild Instance
    context.subscriptions.push(
        vscode.commands.registerCommand('ephemera.rebuildInstance', async (item: InstanceTreeItem) => {
            const confirm = await vscode.window.showWarningMessage(
                `确定要重装实例 "${item.instance.hostname}" 吗？\n所有数据将被清除！`,
                { modal: true },
                '重装'
            );

            if (confirm !== '重装') {
                return;
            }

            try {
                // Get OS images
                const osResult = await apiClient.getOSImages(item.instance.plan_id);
                if (osResult.code !== 200) {
                    vscode.window.showErrorMessage('获取操作系统列表失败');
                    return;
                }

                const osItems: Array<{label: string; description: string; osId: number}> = [];
                osResult.data.forEach(group => {
                    group.os_list.forEach(os => {
                        osItems.push({
                            label: os.name,
                            description: group.group_name,
                            osId: os.id
                        });
                    });
                });

                const selectedOS = await vscode.window.showQuickPick(osItems, {
                    placeHolder: '选择新的操作系统'
                });

                if (!selectedOS) {
                    return;
                }

                await vscode.window.withProgress({
                    location: vscode.ProgressLocation.Notification,
                    title: '正在重装系统...',
                    cancellable: false
                }, async () => {
                    const result = await apiClient.rebuildInstance(item.instance.id, {
                        os_id: selectedOS.osId,
                        ssh_key_id: null,
                        boot_script: null
                    });

                    if (result.code === 200) {
                        vscode.window.showInformationMessage(
                            `系统重装成功！\n新密码: ${result.data.password}`,
                            '复制密码'
                        ).then(selection => {
                            if (selection === '复制密码') {
                                vscode.env.clipboard.writeText(result.data.password);
                            }
                        });
                        instancesProvider.refresh();
                    } else {
                        vscode.window.showErrorMessage(`重装失败: ${result.message}`);
                    }
                });
            } catch (error: any) {
                vscode.window.showErrorMessage(`重装出错: ${error.message}`);
            }
        })
    );
}

function registerPowerCommand(
    context: vscode.ExtensionContext,
    commandId: string,
    action: 'boot' | 'shutdown' | 'restart' | 'poweroff',
    actionName: string
) {
    context.subscriptions.push(
        vscode.commands.registerCommand(commandId, async (item: InstanceTreeItem) => {
            try {
                const result = await apiClient.powerOperation(item.instance.id, action);
                if (result.code === 200) {
                    vscode.window.showInformationMessage(`${actionName}操作已发送`);
                    setTimeout(() => instancesProvider.refresh(), 2000);
                } else {
                    vscode.window.showErrorMessage(`${actionName}失败: ${result.message}`);
                }
            } catch (error: any) {
                vscode.window.showErrorMessage(`${actionName}出错: ${error.message}`);
            }
        })
    );
}

async function loadCredentials(context: vscode.ExtensionContext) {
    const clientId = await context.secrets.get('ephemera.clientId');
    const secret = await context.secrets.get('ephemera.secret');
    
    if (clientId && secret) {
        apiClient.setCredentials({ clientId, secret });
    }
}

export function deactivate() {
    if (autoRefreshTimer) {
        clearInterval(autoRefreshTimer);
    }
    if (statusBarItem) {
        statusBarItem.dispose();
    }
}
