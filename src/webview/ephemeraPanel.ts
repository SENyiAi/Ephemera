import * as vscode from 'vscode';
import { EphemeraAPIClient, EphemeraInstance } from '../api/client';
import { CloudflareClient } from '../api/cloudflare';

export class EphemeraPanel {
    public static currentPanel: EphemeraPanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private _disposables: vscode.Disposable[] = [];
    private _currentInstance: EphemeraInstance | null = null;
    private _currentPath: string = '/home';

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, private apiClient: EphemeraAPIClient, private cfClient: CloudflareClient) {
        this._panel = panel;
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
        this._panel.webview.onDidReceiveMessage(
            async message => {
                switch (message.command) {
                    case 'create': await this._handleCreate(message.data); return;
                    case 'refresh': await this._update(); return;
                    case 'powerOp': await this._handlePowerOp(message.instanceId, message.operation); return;
                    case 'sync': vscode.commands.executeCommand('ephemera.syncWorkspace', { instance: message.instance }); return;
                    case 'bindDomain': await this._handleBindDomain(message.instance, message.subdomain); return;
                    case 'applySsl': await this._handleApplySsl(message.instance, message.subdomain, message.method); return;
                    case 'openFileManager':
                        this._currentInstance = message.instance;
                        this._currentPath = `/home/${this._currentInstance?.user || 'root'}`;
                        await this._renderFileManager();
                        return;
                    case 'closeFileManager': this._currentInstance = null; await this._update(); return;
                    case 'ls': this._currentPath = message.path; await this._renderFileManager(); return;
                    case 'fileOp': await this._handleFileOp(message.op, message.path, message.name); return;
                }
            },
            null,
            this._disposables
        );
        this._update();
    }

    public static async createOrShow(extensionUri: vscode.Uri, apiClient: EphemeraAPIClient, cfClient: CloudflareClient) {
        if (EphemeraPanel.currentPanel) { EphemeraPanel.currentPanel._panel.reveal(vscode.ViewColumn.One); return; }
        const panel = vscode.window.createWebviewPanel('ephemeraManager', 'Ephemera 管理控制台', vscode.ViewColumn.One, { enableScripts: true });
        EphemeraPanel.currentPanel = new EphemeraPanel(panel, extensionUri, apiClient, cfClient);
    }

    private async _handleBindDomain(instance: EphemeraInstance, subdomain: string) {
        const config = vscode.workspace.getConfiguration('ephemera');
        const zoneId = config.get<string>('cloudflareZoneId');
        const domain = config.get<string>('cloudflareDomain');

        if (!zoneId || !domain) {
            vscode.window.showErrorMessage('请先在设置中配置 Cloudflare Zone ID 和 Domain');
            return;
        }

        try {
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: `正在绑定域名: ${subdomain}.${domain} -> ${instance.ipv4}`,
                cancellable: false
            }, async () => {
                await this.cfClient.updateDnsRecord(zoneId, domain, subdomain, instance.ipv4);
            });
            vscode.window.showInformationMessage(`域名解析成功: ${subdomain}.${domain}`);
        } catch (error: any) {
            vscode.window.showErrorMessage(`域名绑定失败: ${error.message}`);
        }
    }

    private async _handleApplySsl(instance: EphemeraInstance, subdomain: string, method: 'dns' | 'http') {
        const config = vscode.workspace.getConfiguration('ephemera');
        const domain = config.get<string>('cloudflareDomain');
        const token = await this.cfClient.getToken();

        if (!domain) {
            vscode.window.showErrorMessage('请先配置 Cloudflare Domain');
            return;
        }

        if (method === 'dns' && !token) {
            vscode.window.showErrorMessage('DNS 方式申请需配置 Cloudflare API Token');
            return;
        }

        const fullDomain = subdomain ? `${subdomain}.${domain}` : domain;
        
        try {
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: `正在申请证书 (${method}): ${fullDomain}`,
                cancellable: false
            }, async (progress) => {
                progress.report({ message: "正在安装 acme.sh..." });
                
                // 1. 安装 acme.sh
                const setupCmd = `
                    if [ ! -d "$HOME/.acme.sh" ]; then
                        curl https://get.acme.sh | sh -s email=admin@${domain}
                    fi
                `;
                await this.apiClient.runCommandAndWait(instance.id, setupCmd);

                progress.report({ message: `正在申请证书 (${method === 'dns' ? 'DNS-01' : 'HTTP-01'})...` });
                
                // 2. 申请证书
                let issueCmd = '';
                if (method === 'dns') {
                    issueCmd = `
                        export CF_Token="${token}"
                        $HOME/.acme.sh/acme.sh --issue --dns dns_cf -d ${fullDomain} --force
                    `;
                } else {
                    // HTTP-01 方式使用 --standalone，需要 80 端口空闲
                    issueCmd = `
                        $HOME/.acme.sh/acme.sh --issue --standalone -d ${fullDomain} --force
                    `;
                }

                const result = await this.apiClient.runCommandAndWait(instance.id, issueCmd, 120000);
                
                if (result.includes("Cert success")) {
                    vscode.window.showInformationMessage(`证书申请成功: ${fullDomain}`);
                } else {
                    throw new Error(result);
                }
            });
        } catch (error: any) {
            vscode.window.showErrorMessage(`证书申请失败: ${error.message}`);
        }
    }

    private async _handlePowerOp(instanceId: number, operation: string) {
        try {
            let action: 'boot' | 'shutdown' | 'restart' | 'poweroff' = 'boot';
            if (operation === 'stop') action = 'shutdown';
            if (operation === 'reboot') action = 'restart';
            const response = await this.apiClient.powerOperation(instanceId, action);
            if (response.code === 200) { vscode.window.showInformationMessage(`操作已发送`); setTimeout(() => this._update(), 2000); }
        } catch (error: any) { vscode.window.showErrorMessage(`操作出错: ${error.message}`); }
    }

    private async _handleFileOp(op: string, path: string, name?: string) {
        if (!this._currentInstance) return;
        try {
            let cmd = '';
            if (op === 'delete') cmd = `rm -rf "${path}"`;
            if (op === 'mkdir') cmd = `mkdir -p "${this._currentPath}/${name}"`;
            await this.apiClient.runCommandAndWait(this._currentInstance.id, cmd);
            await this._renderFileManager();
        } catch (error: any) { vscode.window.showErrorMessage(`操作失败: ${error.message}`); }
    }

    private async _handleCreate(data: any) {
        try {
            const response = await this.apiClient.deployInstance({ product_id: parseInt(data.plan), os_id: parseInt(data.os), time: parseInt(data.time) });
            if (response.code === 200) { vscode.window.showInformationMessage(`实例已排队创建`); await this._update(); }
        } catch (error: any) { vscode.window.showErrorMessage(`创建出错: ${error.message}`); }
    }

    private async _update() { this._panel.webview.html = await this._getHtmlForWebview(); }
    private async _renderFileManager() { this._panel.webview.html = await this._getHtmlForFileManager(); }

    private async _getHtmlForFileManager() {
        const instance = this._currentInstance!;
        let files: string[] = [];
        try { files = (await this.apiClient.runCommandAndWait(instance.id, `ls -F -1 "${this._currentPath}"`)).split('\n').filter(f => f.trim() !== ''); } catch (e) {}

        const fileItems = files.map(f => {
            const isDir = f.endsWith('/');
            const name = isDir ? f.slice(0, -1) : f;
            const fullPath = `${this._currentPath}/${name}`.replace(/\/+/g, '/');
            return `<div class="file-item"><span class="file-icon">${isDir ? '📁' : '📄'}</span><span class="file-name" onclick="${isDir ? `ls('${fullPath}')` : ''}">${name}</span><button class="btn-danger" onclick="fileOp('delete', '${fullPath}')">删除</button></div>`;
        }).join('');

        return `<!DOCTYPE html><html><head><style>body{font-family:var(--vscode-font-family);color:var(--vscode-foreground);padding:15px;background:var(--vscode-editor-background);}.header{display:flex;align-items:center;gap:10px;margin-bottom:15px;}.path-bar{flex-grow:1;padding:5px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border);font-family:monospace;}.file-item{display:flex;align-items:center;padding:5px;border-bottom:1px solid var(--vscode-panel-border);}.file-item:hover{background:var(--vscode-list-hoverBackground);}.file-icon{margin-right:10px;}.file-name{flex-grow:1;cursor:pointer;}.btn-danger{background:#d32f2f;color:white;border:none;padding:2px 6px;border-radius:2px;cursor:pointer;}</style></head>
<body><div class="header"><button onclick="closeManager()">返回</button><button onclick="ls('${this._currentPath.substring(0, this._currentPath.lastIndexOf('/')) || '/'}')">⬆️</button><div class="path-bar">${this._currentPath}</div><button onclick="promptMkdir()">📁+</button></div>
<div class="file-list">${fileItems || '<div style="opacity:0.5">空</div>'}</div>
<script>const vscode = acquireVsCodeApi();function ls(path){vscode.postMessage({command:'ls',path:path});}function closeManager(){vscode.postMessage({command:'closeFileManager'});}function fileOp(op,path,name){if(op==='delete'&&!confirm('确定?'))return;vscode.postMessage({command:'fileOp',op:op,path:path,name:name});}function promptMkdir(){const n=prompt('名称:');if(n)fileOp('mkdir','',n);}</script></body></html>`;
    }

    private async _getHtmlForWebview() {
        const instances = await this.apiClient.listInstances();
        const plans = await this.apiClient.getPlans();
        const config = vscode.workspace.getConfiguration('ephemera');
        const cfDomain = config.get<string>('cloudflareDomain') || '未配置域名';

        const instanceList = instances.data.map((i: EphemeraInstance) => `
            <div class="card">
                <div class="card-header"><span class="status ${i.status}"></span><b>${i.hostname}</b> <code>${i.ipv4}</code></div>
                <div class="card-body">
                    <div><span>套餐:</span> ${i.plan}</div>
                    <div><span>到期:</span> ${i.expiration_at}</div>
                    <div class="domain-tool">
                        <input type="text" id="sub-${i.id}" placeholder="子域名" style="width:100px"><code>.${cfDomain}</code>
                        <div style="margin-top:5px;display:flex;gap:5px;align-items:center">
                            <button onclick="bindDomain('${i.id}', ${JSON.stringify(i)})">解析</button>
                            <select id="method-${i.id}" style="background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border);padding:2px">
                                <option value="dns">DNS (TXT)</option>
                                <option value="http">HTTP (80端口)</option>
                            </select>
                            <button class="secondary" onclick="applySsl('${i.id}', ${JSON.stringify(i)})">申请SSL</button>
                        </div>
                    </div>
                </div>
                <div class="actions">
                    <button onclick="powerOp(${i.id}, 'start')" ${i.status === 'active' ? 'disabled' : ''}>▶️</button>
                    <button onclick="powerOp(${i.id}, 'stop')" ${i.status !== 'active' ? 'disabled' : ''}>⏹️</button>
                    <button class="primary" onclick='openFileManager(${JSON.stringify(i)})'>文件</button>
                    <button onclick='sync(${JSON.stringify(i)})'>同步</button>
                </div>
            </div>
        `).join('');

        return `<!DOCTYPE html><html><head><style>body{font-family:var(--vscode-font-family);color:var(--vscode-foreground);padding:20px;background:var(--vscode-editor-background);}.card{background:var(--vscode-sideBar-background);border:1px solid var(--vscode-panel-border);padding:15px;border-radius:8px;margin-bottom:15px;}.card-header{display:flex;align-items:center;gap:10px;margin-bottom:10px;}.status{width:10px;height:10px;border-radius:50%;}.status.active{background:#4caf50;}.status.stopped{background:#f44336;}.domain-tool{margin-top:10px;padding:8px;background:var(--vscode-editor-background);border-radius:4px;}.actions{display:flex;gap:10px;margin-top:10px;justify-content:flex-end;}input{background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border);padding:4px;}button{cursor:pointer;padding:4px 8px;border:none;border-radius:4px;background:var(--vscode-button-background);color:var(--vscode-button-foreground);}button:disabled{opacity:0.3;}.primary{background:var(--vscode-button-hoverBackground);}.secondary{background:var(--vscode-badge-background);color:var(--vscode-badge-foreground);}</style></head>
<body><h2>实例管理</h2><div class="grid">${instanceList || '无实例'}</div>
<script>const vscode=acquireVsCodeApi();function refresh(){vscode.postMessage({command:'refresh'});}function powerOp(id,op){vscode.postMessage({command:'powerOp',instanceId:id,operation:op});}function sync(i){vscode.postMessage({command:'sync',instance:i});}function openFileManager(i){vscode.postMessage({command:'openFileManager',instance:i});}function bindDomain(id,i){const sub=document.getElementById('sub-'+id).value;vscode.postMessage({command:'bindDomain',instance:i,subdomain:sub});}function applySsl(id,i){const sub=document.getElementById('sub-'+id).value;const method=document.getElementById('method-'+id).value;vscode.postMessage({command:'applySsl',instance:i,subdomain:sub,method:method});}</script></body></html>`;
    }

    public dispose() {
        EphemeraPanel.currentPanel = undefined; this._panel.dispose();
        while (this._disposables.length) { const x = this._disposables.pop(); if (x) x.dispose(); }
    }
}
