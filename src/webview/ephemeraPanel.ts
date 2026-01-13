import * as vscode from 'vscode';
import { EphemeraAPIClient, EphemeraInstance } from '../api/client';

export class EphemeraPanel {
    public static currentPanel: EphemeraPanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private _disposables: vscode.Disposable[] = [];

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, private apiClient: EphemeraAPIClient) {
        this._panel = panel;
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
        this._panel.webview.onDidReceiveMessage(
            async message => {
                switch (message.command) {
                    case 'create':
                        await this._handleCreate(message.data);
                        return;
                    case 'cancel':
                        this._panel.dispose();
                        return;
                    case 'refresh':
                        await this._update();
                        return;
                    case 'powerOp':
                        await this._handlePowerOp(message.instanceId, message.operation);
                        return;
                    case 'sync':
                        vscode.commands.executeCommand('ephemera.syncWorkspace', { instance: message.instance });
                        return;
                }
            },
            null,
            this._disposables
        );
        this._update();
    }

    public static async createOrShow(extensionUri: vscode.Uri, apiClient: EphemeraAPIClient) {
        const column = vscode.window.activeTextEditor ? vscode.window.activeTextEditor.viewColumn : undefined;

        if (EphemeraPanel.currentPanel) {
            EphemeraPanel.currentPanel._panel.reveal(column);
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'ephemeraManager',
            'Ephemera 管理控制台',
            column || vscode.ViewColumn.One,
            {
                enableScripts: true,
                localResourceRoots: [extensionUri]
            }
        );

        EphemeraPanel.currentPanel = new EphemeraPanel(panel, extensionUri, apiClient);
    }

    private async _handlePowerOp(instanceId: number, operation: string) {
        try {
            let response;
            switch (operation) {
                case 'start': response = await this.apiClient.startInstance(instanceId); break;
                case 'stop': response = await this.apiClient.stopInstance(instanceId); break;
                case 'reboot': response = await this.apiClient.rebootInstance(instanceId); break;
                default: return;
            }

            if (response.code === 200) {
                vscode.window.showInformationMessage(`操作 '${operation}' 已发送`);
                setTimeout(() => this._update(), 2000); 
            } else {
                vscode.window.showErrorMessage(`操作失败: ${response.message}`);
            }
        } catch (error: any) {
            vscode.window.showErrorMessage(`请求出错: ${error.message}`);
        }
    }

    private async _handleCreate(data: any) {
        try {
            const response = await this.apiClient.deployInstance({
                product_id: parseInt(data.plan),
                os_id: parseInt(data.os),
                time: parseInt(data.time),
                ssh_key_id: null,
                boot_script: null
            });

            if (response.code === 200) {
                vscode.window.showInformationMessage(`实例创建成功！`);
                vscode.commands.executeCommand('ephemera.refreshInstances');
                await this._update();
            } else {
                vscode.window.showErrorMessage(`创建失败: ${response.message}`);
            }
        } catch (error: any) {
            vscode.window.showErrorMessage(`请求出错: ${error.message}`);
        }
    }

    private async _update() {
        const webview = this._panel.webview;
        this._panel.title = 'Ephemera 管理控制台';
        webview.html = await this._getHtmlForWebview(webview);
    }

    private async _getHtmlForWebview(webview: vscode.Webview) {
        const instances = await this.apiClient.listInstances();
        const plans = await this.apiClient.getPlans();
        const config = vscode.workspace.getConfiguration('ephemera');
        
        const planOptions = plans.data.map(p => 
            `<option value="${p.id}" ${p.id === config.get('defaultPlan') ? 'selected' : ''}>${p.name} (${p.description})</option>`
        ).join('');
        
        const instanceList = instances.data.map((i: EphemeraInstance) => `
            <div class="instance-card">
                <div class="instance-header">
                    <span class="status-dot ${i.status.toLowerCase()}"></span>
                    <span class="hostname">${i.hostname}</span>
                    <span class="instance-ip">${i.ipv4}</span>
                </div>
                <div class="instance-details">
                    <div><span>套餐:</span> ${i.plan}</div>
                    <div><span>系统:</span> ${i.os}</div>
                    <div><span>性能:</span> ${i.cpu}C (${i.cpu_name})</div>
                    <div><span>到期:</span> ${i.expiration_at}</div>
                </div>
                <div class="instance-actions">
                    <button class="btn-icon" onclick="powerOp(${i.id}, 'start')" title="启动" ${i.status === 'active' ? 'disabled' : ''}>▶️</button>
                    <button class="btn-icon" onclick="powerOp(${i.id}, 'stop')" title="停止" ${i.status !== 'active' ? 'disabled' : ''}>⏹️</button>
                    <button class="btn-primary" onclick='sync(${JSON.stringify(i)})'>同步代码</button>
                    <button class="btn-secondary" onclick="copyIp('${i.ipv4}')">IP</button>
                </div>
            </div>
        `).join('');

        return `<!DOCTYPE html>
<html lang="zh-cn">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
        body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 20px; line-height: 1.6; background-color: var(--vscode-editor-background); }
        .container { max-width: 1000px; margin: 0 auto; }
        .section { margin-bottom: 30px; background: var(--vscode-sideBar-background); padding: 20px; border-radius: 8px; border: 1px solid var(--vscode-panel-border); }
        h2 { margin-top: 0; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid var(--vscode-panel-border); padding-bottom: 10px; }
        .form-group { margin-bottom: 15px; }
        label { display: block; font-weight: bold; margin-bottom: 5px; color: var(--vscode-foreground); }
        input, select { width: 100%; padding: 8px; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); border-radius: 4px; box-sizing: border-box; }
        button { padding: 8px 16px; cursor: pointer; border: none; border-radius: 4px; font-weight: bold; transition: opacity 0.2s; }
        .btn-primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
        .btn-secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
        .btn-icon { background: transparent; font-size: 1.2em; padding: 4px 8px; }
        .btn-icon:disabled { opacity: 0.3; cursor: not-allowed; }
        button:hover { opacity: 0.8; }
        
        .instance-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 15px; }
        .instance-card { background: var(--vscode-editor-background); border: 1px solid var(--vscode-panel-border); padding: 15px; border-radius: 6px; }
        .instance-header { display: flex; align-items: center; margin-bottom: 10px; }
        .status-dot { width: 10px; height: 10px; border-radius: 50%; margin-right: 8px; }
        .status-dot.active { background: #4caf50; box-shadow: 0 0 5px #4caf50; }
        .status-dot.stopped { background: #f44336; }
        .hostname { font-weight: bold; flex-grow: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-right: 10px; }
        .instance-ip { font-size: 0.9em; opacity: 0.7; font-family: monospace; }
        .instance-details { font-size: 0.85em; margin-bottom: 12px; display: grid; grid-template-columns: 1fr 1fr; gap: 5px; }
        .instance-details div { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .instance-details span { opacity: 0.6; }
        .instance-actions { display: flex; gap: 8px; justify-content: flex-end; border-top: 1px solid var(--vscode-panel-border); padding-top: 10px; }
    </style>
</head>
<body>
    <div class="container">
        <div class="section">
            <h2>
                您的实例 
                <button class="btn-secondary" onclick="refresh()" style="font-size: 0.8em;">刷新</button>
            </h2>
            <div class="instance-grid">
                ${instanceList || '<div style="opacity: 0.5;">暂无活跃实例</div>'}
            </div>
        </div>

        <div class="section">
            <h2>快速创建</h2>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px;">
                <div class="form-group">
                    <label for="plan">套餐方案</label>
                    <select id="plan">${planOptions}</select>
                </div>
                <div class="form-group">
                    <label for="os">操作系统</label>
                    <select id="os">
                        <option value="1">Debian 12</option>
                        <option value="2">Ubuntu 22.04</option>
                        <option value="3">CentOS 7</option>
                    </select>
                </div>
            </div>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px;">
                <div class="form-group">
                    <label for="time">时长 (h)</label>
                    <input type="number" id="time" value="${config.get('defaultTime') || 24}" min="1">
                </div>
                <div class="form-group">
                    <label for="region">区域</label>
                    <select id="region"><option value="1">Global</option></select>
                </div>
            </div>
            <div style="margin-top: 20px;">
                <button class="btn-primary" onclick="create()">立即创建</button>
            </div>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        function create() {
            const data = {
                plan: document.getElementById('plan').value,
                os: document.getElementById('os').value,
                time: document.getElementById('time').value,
                region: document.getElementById('region').value
            };
            vscode.postMessage({ command: 'create', data: data });
        }
        function refresh() {
            vscode.postMessage({ command: 'refresh' });
        }
        function powerOp(instanceId, operation) {
            vscode.postMessage({ command: 'powerOp', instanceId: instanceId, operation: operation });
        }
        function sync(instance) {
            vscode.postMessage({ command: 'sync', instance: instance });
        }
        function copyIp(ip) {
            navigator.clipboard.writeText(ip);
        }
    </script>
</body>
</html>`;
    }

    public dispose() {
        EphemeraPanel.currentPanel = undefined;
        this._panel.dispose();
        while (this._disposables.length) {
            const x = this._disposables.pop();
            if (x) { x.dispose(); }
        }
    }
}
