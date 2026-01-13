import * as vscode from 'vscode';
import { EphemeraAPIClient, EphemeraInstance } from '../api/client';

export class EphemeraPanel {
    public static currentPanel: EphemeraPanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private _disposables: vscode.Disposable[] = [];
    private _currentInstance: EphemeraInstance | null = null;
    private _currentPath: string = '/home';

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, private apiClient: EphemeraAPIClient) {
        this._panel = panel;
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
        this._panel.webview.onDidReceiveMessage(
            async message => {
                switch (message.command) {
                    case 'create':
                        await this._handleCreate(message.data);
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
                    case 'openFileManager':
                        this._currentInstance = message.instance;
                        this._currentPath = `/home/${this._currentInstance?.user || 'root'}`;
                        await this._renderFileManager();
                        return;
                    case 'closeFileManager':
                        this._currentInstance = null;
                        await this._update();
                        return;
                    case 'ls':
                        this._currentPath = message.path;
                        await this._renderFileManager();
                        return;
                    case 'fileOp':
                        await this._handleFileOp(message.op, message.path, message.name);
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
        const panel = vscode.window.createWebviewPanel('ephemeraManager', 'Ephemera 管理控制台', column || vscode.ViewColumn.One, {
            enableScripts: true,
            localResourceRoots: [extensionUri]
        });
        EphemeraPanel.currentPanel = new EphemeraPanel(panel, extensionUri, apiClient);
    }

    private async _handlePowerOp(instanceId: number, operation: string) {
        try {
            let action: 'boot' | 'shutdown' | 'restart' | 'poweroff' = 'boot';
            if (operation === 'stop') action = 'shutdown';
            if (operation === 'reboot') action = 'restart';
            
            const response = await this.apiClient.powerOperation(instanceId, action);
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

    private async _handleFileOp(op: string, path: string, name?: string) {
        if (!this._currentInstance) return;
        try {
            let cmd = '';
            if (op === 'delete') cmd = `rm -rf "${path}"`;
            if (op === 'mkdir') cmd = `mkdir -p "${this._currentPath}/${name}"`;
            if (op === 'touch') cmd = `touch "${this._currentPath}/${name}"`;

            await this.apiClient.runCommandAndWait(this._currentInstance.id, cmd);
            await this._renderFileManager();
        } catch (error: any) {
            vscode.window.showErrorMessage(`文件操作失败: ${error.message}`);
        }
    }

    private async _handleCreate(data: any) {
        try {
            const response = await this.apiClient.deployInstance({
                product_id: parseInt(data.plan),
                os_id: parseInt(data.os),
                time: parseInt(data.time)
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
        this._panel.webview.html = await this._getHtmlForWebview();
    }

    private async _renderFileManager() {
        if (!this._currentInstance) return;
        this._panel.webview.html = await this._getHtmlForFileManager();
    }

    private async _getHtmlForFileManager() {
        const instance = this._currentInstance!;
        let files: string[] = [];
        let errorMsg = '';
        try {
            const output = await this.apiClient.runCommandAndWait(instance.id, `ls -F -1 "${this._currentPath}"`);
            files = output.split('\n').filter(f => f.trim() !== '');
        } catch (e: any) {
            errorMsg = e.message;
        }

        const fileItems = files.map(f => {
            const isDir = f.endsWith('/');
            const name = isDir ? f.slice(0, -1) : f;
            const fullPath = `${this._currentPath}/${name}`.replace(/\/+/g, '/');
            return `
                <div class="file-item">
                    <span class="file-icon">${isDir ? '📁' : '📄'}</span>
                    <span class="file-name" onclick="${isDir ? `ls('${fullPath}')` : ''}">${name}</span>
                    <div class="file-actions">
                        <button onclick="fileOp('delete', '${fullPath}')">删除</button>
                    </div>
                </div>
            `;
        }).join('');

        const parentPath = this._currentPath.substring(0, this._currentPath.lastIndexOf('/')) || '/';

        return `<!DOCTYPE html>
<html lang="zh-cn">
<head>
    <style>
        body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 20px; background-color: var(--vscode-editor-background); }
        .header { display: flex; align-items: center; gap: 15px; margin-bottom: 20px; border-bottom: 1px solid var(--vscode-panel-border); padding-bottom: 10px; }
        .path-bar { flex-grow: 1; padding: 5px 10px; background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border); font-family: monospace; }
        .file-list { display: flex; flex-direction: column; gap: 2px; }
        .file-item { display: flex; align-items: center; padding: 5px 10px; border-radius: 4px; }
        .file-item:hover { background: var(--vscode-list-hoverBackground); }
        .file-icon { margin-right: 10px; font-size: 1.2em; }
        .file-name { flex-grow: 1; cursor: pointer; }
        .file-actions { display: none; gap: 5px; }
        .file-item:hover .file-actions { display: flex; }
        button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 4px 8px; border-radius: 2px; cursor: pointer; }
        button:hover { opacity: 0.8; }
        .btn-secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
    </style>
</head>
<body>
    <div class="header">
        <button class="btn-secondary" onclick="closeManager()">返回</button>
        <button onclick="ls('${parentPath}')">⬆️</button>
        <div class="path-bar">${this._currentPath}</div>
        <button onclick="promptMkdir()">新建文件夹</button>
    </div>
    ${errorMsg ? `<div style="color: var(--vscode-errorForeground)">${errorMsg}</div>` : ''}
    <div class="file-list">
        ${fileItems || '<div style="opacity: 0.5; padding: 20px;">空目录</div>'}
    </div>
    <script>
        const vscode = acquireVsCodeApi();
        function ls(path) { vscode.postMessage({ command: 'ls', path: path }); }
        function closeManager() { vscode.postMessage({ command: 'closeFileManager' }); }
        function fileOp(op, path, name) { 
            if (op === 'delete' && !confirm('确定删除吗？')) return;
            vscode.postMessage({ command: 'fileOp', op: op, path: path, name: name }); 
        }
        function promptMkdir() {
            const name = prompt('请输入文件夹名称:');
            if (name) fileOp('mkdir', '', name);
        }
    </script>
</body>
</html>`;
    }

    private async _getHtmlForWebview() {
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
                    <button class="btn-primary" onclick='openFileManager(${JSON.stringify(i)})'>管理文件</button>
                    <button class="btn-secondary" onclick='sync(${JSON.stringify(i)})'>同步</button>
                </div>
            </div>
        `).join('');

        return `<!DOCTYPE html>
<html lang="zh-cn">
<head>
    <meta charset="UTF-8">
    <style>
        body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 20px; line-height: 1.6; background-color: var(--vscode-editor-background); }
        .section { margin-bottom: 30px; background: var(--vscode-sideBar-background); padding: 20px; border-radius: 8px; border: 1px solid var(--vscode-panel-border); }
        h2 { margin-top: 0; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid var(--vscode-panel-border); padding-bottom: 10px; }
        .form-group { margin-bottom: 15px; }
        label { display: block; font-weight: bold; margin-bottom: 5px; }
        input, select { width: 100%; padding: 8px; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); border-radius: 4px; box-sizing: border-box; }
        button { padding: 8px 16px; cursor: pointer; border: none; border-radius: 4px; font-weight: bold; }
        .btn-primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
        .btn-secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
        .btn-icon { background: transparent; font-size: 1.2em; padding: 4px 8px; }
        .btn-icon:disabled { opacity: 0.3; cursor: not-allowed; }
        .instance-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 15px; }
        .instance-card { background: var(--vscode-editor-background); border: 1px solid var(--vscode-panel-border); padding: 15px; border-radius: 6px; }
        .instance-header { display: flex; align-items: center; margin-bottom: 10px; }
        .status-dot { width: 10px; height: 10px; border-radius: 50%; margin-right: 8px; }
        .status-dot.active { background: #4caf50; box-shadow: 0 0 5px #4caf50; }
        .status-dot.stopped { background: #f44336; }
        .hostname { font-weight: bold; flex-grow: 1; }
        .instance-details { font-size: 0.85em; margin-bottom: 12px; display: grid; grid-template-columns: 1fr 1fr; gap: 5px; }
        .instance-details span { opacity: 0.6; }
        .instance-actions { display: flex; gap: 8px; justify-content: flex-end; border-top: 1px solid var(--vscode-panel-border); padding-top: 10px; }
    </style>
</head>
<body>
    <div class="section">
        <h2>您的实例 <button class="btn-secondary" onclick="refresh()">刷新</button></h2>
        <div class="instance-grid">${instanceList || '<div style="opacity: 0.5;">暂无活跃实例</div>'}</div>
    </div>
    <div class="section">
        <h2>快速创建</h2>
        <div class="form-group">
            <label>套餐方案</label>
            <select id="plan">${planOptions}</select>
        </div>
        <div class="form-group">
            <label>操作系统</label>
            <select id="os"><option value="1">Debian 12</option><option value="2">Ubuntu 22.04</option></select>
        </div>
        <div class="form-group">
            <label>时长 (h)</label>
            <input type="number" id="time" value="24">
        </div>
        <button class="btn-primary" onclick="create()">立即创建</button>
    </div>
    <script>
        const vscode = acquireVsCodeApi();
        function create() { vscode.postMessage({ command: 'create', data: { plan: document.getElementById('plan').value, os: document.getElementById('os').value, time: document.getElementById('time').value } }); }
        function refresh() { vscode.postMessage({ command: 'refresh' }); }
        function powerOp(id, op) { vscode.postMessage({ command: 'powerOp', instanceId: id, operation: op }); }
        function sync(inst) { vscode.postMessage({ command: 'sync', instance: inst }); }
        function openFileManager(inst) { vscode.postMessage({ command: 'openFileManager', instance: inst }); }
    </script>
</body>
</html>`;
    }

    public dispose() {
        EphemeraPanel.currentPanel = undefined;
        this._panel.dispose();
        while (this._disposables.length) {
            const x = this._disposables.pop();
            if (x) x.dispose();
        }
    }
}
