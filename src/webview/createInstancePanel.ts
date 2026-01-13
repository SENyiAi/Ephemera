import * as vscode from 'vscode';
import { EphemeraAPIClient } from '../api/client';

export class CreateInstancePanel {
    public static currentPanel: CreateInstancePanel | undefined;
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
                }
            },
            null,
            this._disposables
        );
        this._update();
    }

    public static async createOrShow(extensionUri: vscode.Uri, apiClient: EphemeraAPIClient) {
        const column = vscode.window.activeTextEditor ? vscode.window.activeTextEditor.viewColumn : undefined;

        if (CreateInstancePanel.currentPanel) {
            CreateInstancePanel.currentPanel._panel.reveal(column);
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'createInstance',
            '创建 Ephemera 实例',
            column || vscode.ViewColumn.One,
            {
                enableScripts: true,
                localResourceRoots: [extensionUri]
            }
        );

        CreateInstancePanel.currentPanel = new CreateInstancePanel(panel, extensionUri, apiClient);
    }

    private async _handleCreate(data: any) {
        try {
            const response = await this.apiClient.deployInstance({
                plan_id: parseInt(data.plan),
                os_id: parseInt(data.os),
                hostname: data.hostname,
                time: parseInt(data.time),
                region_id: parseInt(data.region)
            });

            if (response.code === 200) {
                vscode.window.showInformationMessage(`实例 ${data.hostname} 创建成功！`);
                vscode.commands.executeCommand('ephemera.refreshInstances');
                this._panel.dispose();
            } else {
                vscode.window.showErrorMessage(`创建失败: ${response.message}`);
            }
        } catch (error: any) {
            vscode.window.showErrorMessage(`请求出错: ${error.message}`);
        }
    }

    private async _update() {
        const webview = this._panel.webview;
        this._panel.title = '创建 Ephemera 实例';
        webview.html = await this._getHtmlForWebview(webview);
    }

    private async _getHtmlForWebview(webview: vscode.Webview) {
        const plans = await this.apiClient.getPlans();
        const config = vscode.workspace.getConfiguration('ephemera');
        
        const planOptions = plans.data.map(p => `<option value="${p.id}" ${p.id === config.get('defaultPlan') ? 'selected' : ''}>${p.name} (${p.description})</option>`).join('');
        
        return `<!DOCTYPE html>
<html lang="zh-cn">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
        body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 20px; line-height: 1.6; }
        .form-group { margin-bottom: 15px; }
        label { display: block; font-weight: bold; margin-bottom: 5px; }
        input, select { width: 100%; padding: 8px; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); border-radius: 4px; box-sizing: border-box; }
        button { padding: 8px 16px; cursor: pointer; border: none; border-radius: 4px; font-weight: bold; transition: opacity 0.2s; }
        .btn-primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
        .btn-secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); margin-left: 10px; }
        button:hover { opacity: 0.8; }
        .header { margin-bottom: 25px; border-bottom: 1px solid var(--vscode-panel-border); padding-bottom: 10px; }
        .header h2 { margin: 0; display: flex; align-items: center; }
        .icon { margin-right: 10px; }
    </style>
</head>
<body>
    <div class="header">
        <h2>创建新实例</h2>
    </div>
    <div class="form-group">
        <label for="hostname">主机名</label>
        <input type="text" id="hostname" value="ephemera-dev" placeholder="输入实例主机名">
    </div>
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
    <div class="form-group">
        <label for="time">使用时长 (小时)</label>
        <input type="number" id="time" value="${config.get('defaultTime') || 24}" min="1">
    </div>
    <div class="form-group">
        <label for="region">区域</label>
        <select id="region">
            <option value="1">Global (Default)</option>
        </select>
    </div>
    <div style="margin-top: 30px;">
        <button class="btn-primary" onclick="create()">创建实例</button>
        <button class="btn-secondary" onclick="cancel()">取消</button>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        function create() {
            const data = {
                hostname: document.getElementById('hostname').value,
                plan: document.getElementById('plan').value,
                os: document.getElementById('os').value,
                time: document.getElementById('time').value,
                region: document.getElementById('region').value
            };
            vscode.postMessage({ command: 'create', data: data });
        }
        function cancel() {
            vscode.postMessage({ command: 'cancel' });
        }
    </script>
</body>
</html>`;
    }

    public dispose() {
        CreateInstancePanel.currentPanel = undefined;
        this._panel.dispose();
        while (this._disposables.length) {
            const x = this._disposables.pop();
            if (x) { x.dispose(); }
        }
    }
}
