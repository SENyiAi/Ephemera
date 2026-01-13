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
                    case 'quickInstall': await this._handleQuickInstall(message.instance, message.tool); return;
                    case 'renew': await this._handleRenew(message.instanceId); return;
                    case 'openTerminal': this._handleOpenTerminal(message.instance); return;
                    case 'copy': vscode.env.clipboard.writeText(message.text); vscode.window.showInformationMessage('已复制到剪贴板'); return;
                    case 'rebuild': await this._handleRebuild(message.instanceId); return;
                    case 'openFileManager':
                        this._currentInstance = message.instance;
                        this._currentPath = `/home/${this._currentInstance?.user || 'root'}`;
                        await this._renderFileManager();
                        return;
                    case 'closeFileManager': this._currentInstance = null; await this._update(); return;
                    case 'ls': this._currentPath = message.path; await this._renderFileManager(); return;
                    case 'cat': await this._handleCat(message.path); return;
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
        const panel = vscode.window.createWebviewPanel('ephemeraManager', 'Ephemera 管理控制台', vscode.ViewColumn.One, { enableScripts: true, retainContextWhenHidden: true });
        EphemeraPanel.currentPanel = new EphemeraPanel(panel, extensionUri, apiClient, cfClient);
    }

    private async _handleBindDomain(instance: EphemeraInstance, subdomain: string) {
        const config = vscode.workspace.getConfiguration('ephemera');
        const zoneId = config.get<string>('cloudflareZoneId');
        const domain = config.get<string>('cloudflareDomain');
        if (!zoneId || !domain) { vscode.window.showErrorMessage('请先在设置中配置 Cloudflare Zone ID 和 Domain'); return; }
        try {
            await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `正在绑定域名: ${subdomain}.${domain} -> ${instance.ipv4}` }, async () => {
                await this.cfClient.updateDnsRecord(zoneId, domain, subdomain, instance.ipv4);
            });
            vscode.window.showInformationMessage(`域名解析成功: ${subdomain}.${domain}`);
        } catch (error: any) { vscode.window.showErrorMessage(`域名绑定失败: ${error.message}`); }
    }

    private async _handleApplySsl(instance: EphemeraInstance, subdomain: string, method: 'dns' | 'http') {
        const config = vscode.workspace.getConfiguration('ephemera');
        const domain = config.get<string>('cloudflareDomain');
        const token = await this.cfClient.getToken();
        if (!domain) { vscode.window.showErrorMessage('请先配置 Cloudflare Domain'); return; }
        if (method === 'dns' && !token) { vscode.window.showErrorMessage('DNS 方式解析需要 API Token'); return; }
        const fullDomain = subdomain ? `${subdomain}.${domain}` : domain;
        try {
            await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `申请证书 (${method}): ${fullDomain}` }, async (p) => {
                p.report({ message: "准备环境..." });
                await this.apiClient.runCommandAndWait(instance.id, `if [ ! -d "$HOME/.acme.sh" ]; then curl https://get.acme.sh | sh -s email=admin@${domain}; fi`);
                p.report({ message: "开始申请..." });
                const cmd = method === 'dns' ? `export CF_Token="${token}"; $HOME/.acme.sh/acme.sh --issue --dns dns_cf -d ${fullDomain} --force` : `$HOME/.acme.sh/acme.sh --issue --standalone -d ${fullDomain} --force`;
                const res = await this.apiClient.runCommandAndWait(instance.id, cmd, 180000);
                if (res.includes("Cert success")) vscode.window.showInformationMessage(`证书申请成功: ${fullDomain}`); else throw new Error(res);
            });
        } catch (error: any) { vscode.window.showErrorMessage(`证书申请失败: ${error.message}`); }
    }

    private async _handleRenew(instanceId: number) {
        try {
            const response = await this.apiClient.renewInstance(instanceId, 24);
            if (response.code === 200) { vscode.window.showInformationMessage(`续期成功 (24h)`); this._update(); }
        } catch (error: any) { vscode.window.showErrorMessage(`续期失败: ${error.message}`); }
    }

    private async _handleRebuild(instanceId: number) {
        const confirm = await vscode.window.showWarningMessage('确定要重装系统吗？所有数据将会丢失！', { modal: true }, '确定');
        if (confirm !== '确定') return;
        try {
            await this.apiClient.rebuildInstance(instanceId, { os_id: 1 }); // Default to Ubuntu
            vscode.window.showInformationMessage('重装请求已发送');
            setTimeout(() => this._update(), 2000);
        } catch (error: any) { vscode.window.showErrorMessage(`重装失败: ${error.message}`); }
    }

    private async _handlePowerOp(instanceId: number, operation: string) {
        try {
            let action: any = operation === 'start' ? 'boot' : (operation === 'reboot' ? 'restart' : 'shutdown');
            await this.apiClient.powerOperation(instanceId, action);
            vscode.window.showInformationMessage(`操作 '${operation}' 已发送`);
            setTimeout(() => this._update(), 2000);
        } catch (error: any) { vscode.window.showErrorMessage(`操作失败: ${error.message}`); }
    }

    private async _handleCat(path: string) {
        if (!this._currentInstance) return;
        try {
            const content = await this.apiClient.runCommandAndWait(this._currentInstance.id, `cat "${path}" | head -c 5000`);
            const doc = await vscode.workspace.openTextDocument({ content, language: 'plaintext' });
            await vscode.window.showTextDocument(doc, { preview: true, viewColumn: vscode.ViewColumn.Beside });
        } catch (error: any) { vscode.window.showErrorMessage(`无法查看文件: ${error.message}`); }
    }

    private async _handleFileOp(op: string, path: string, name?: string) {
        if (!this._currentInstance) return;
        try {
            let cmd = op === 'delete' ? `rm -rf "${path}"` : `mkdir -p "${this._currentPath}/${name}"`;
            await this.apiClient.runCommandAndWait(this._currentInstance.id, cmd);
            await this._renderFileManager();
        } catch (error: any) { vscode.window.showErrorMessage(`文件操作失败: ${error.message}`); }
    }

    private async _handleQuickInstall(instance: EphemeraInstance, tool: string) {
        let cmd = '';
        if (tool === 'docker') cmd = `curl -fsSL https://get.docker.com | bash && systemctl enable --now docker`;
        else if (tool === 'nginx') cmd = `apt-get update && apt-get install -y nginx && systemctl enable --now nginx`;
        else if (tool === 'nodejs') cmd = `curl -fsSL https://deb.nodesource.com/setup_lts.x | bash - && apt-get install -y nodejs`;
        else if (tool === 'docker-compose') cmd = `curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose && chmod +x /usr/local/bin/docker-compose`;
        else if (tool === 'bt-panel') cmd = `wget -O install.sh http://download.bt.cn/install/install-ubuntu_6.0.sh && bash install.sh ed8484bec`;
        try {
            await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `正在安装 ${tool}` }, async () => {
                await this.apiClient.runCommandAndWait(instance.id, cmd, 300000);
            });
            vscode.window.showInformationMessage(`${tool} 安装成功`);
        } catch (error: any) { vscode.window.showErrorMessage(`${tool} 安装失败: ${error.message}`); }
    }

    private _handleOpenTerminal(instance: EphemeraInstance) {
        const terminal = vscode.window.createTerminal(`Ephemera: ${instance.hostname}`);
        terminal.show();
        terminal.sendText(`ssh ${instance.user || 'root'}@${instance.ipv4}`);
    }

    private async _handleCreate(data: any) {
        try {
            await this.apiClient.deployInstance({ product_id: parseInt(data.plan), os_id: parseInt(data.os), time: parseInt(data.time) });
            vscode.window.showInformationMessage(`实例创建请求已提交`);
            setTimeout(() => this._update(), 3000);
        } catch (error: any) { vscode.window.showErrorMessage(`创建失败: ${error.message}`); }
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
            return `<div class="file-item"><span class="file-icon">${isDir ? '📁' : '📄'}</span><span class="file-name" onclick="${isDir ? `ls('${fullPath}')` : `cat('${fullPath}')`}">${name}</span><button class="btn-danger" onclick="fileOp('delete', '${fullPath}')">删除</button></div>`;
        }).join('');
        return `<!DOCTYPE html><html><head><style>body{font-family:var(--vscode-font-family);color:var(--vscode-foreground);padding:15px;background:var(--vscode-editor-background);}.header{display:flex;align-items:center;gap:10px;margin-bottom:15px;}.path-bar{flex-grow:1;padding:5px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border);font-family:monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}.file-item{display:flex;align-items:center;padding:5px;border-bottom:1px solid var(--vscode-panel-border);}.file-item:hover{background:var(--vscode-list-hoverBackground);}.file-name{flex-grow:1;cursor:pointer;}.btn-danger{background:#d32f2f;color:white;border:none;padding:2px 6px;border-radius:2px;cursor:pointer;}</style></head>
<body><div class="header"><button onclick="closeManager()">返回</button><button onclick="ls('${this._currentPath.substring(0, this._currentPath.lastIndexOf('/')) || '/'}')">⬆️</button><div class="path-bar">${this._currentPath}</div><button onclick="promptMkdir()">📁+</button></div>
<div class="file-list">${fileItems || '<div style="opacity:0.5;padding:20px;text-align:center;">空目录</div>'}</div>
<script>const vscode = acquireVsCodeApi();function ls(path){vscode.postMessage({command:'ls',path:path});}function cat(path){vscode.postMessage({command:'cat',path:path});}function closeManager(){vscode.postMessage({command:'closeFileManager'});}function fileOp(op,path,name){if(op==='delete'&&!confirm('确定删除?'))return;vscode.postMessage({command:'fileOp',op:op,path:path,name:name});}function promptMkdir(){const n=prompt('目录名称:');if(n)fileOp('mkdir','',n);}</script></body></html>`;
    }

    private async _getHtmlForWebview() {
        const [instancesRes, plansRes] = await Promise.all([this.apiClient.listInstances(), this.apiClient.getPlans()]);
        const config = vscode.workspace.getConfiguration('ephemera');
        const cfDomain = config.get<string>('cloudflareDomain') || '未配置';

        const instanceList = instancesRes.data.map((i: EphemeraInstance) => {
            const cpu = i.state?.cpu || 0;
            const memTotal = i.state?.memory?.memtotal || 1;
            const memUsage = Math.round(((memTotal - (i.state?.memory?.memavailable || 0)) / memTotal) * 100);
            return `
            <div class="card">
                <div class="card-header">
                    <span class="status ${i.status}"></span>
                    <b onclick="copy('${i.hostname}')" title="点击复制">${i.hostname}</b>
                    <code onclick="copy('${i.ipv4}')" title="点击复制 IP">${i.ipv4}</code>
                    <span class="badge">CPU: ${cpu}% | MEM: ${memUsage}%</span>
                </div>
                <div class="card-body">
                    <div class="info-row"><span>到期:</span> ${i.expiration_at}</div>
                    <div class="tool-group">
                        <div class="input-wrap"><input type="text" id="sub-${i.id}" placeholder="子域名"><code>.${cfDomain}</code></div>
                        <div class="btn-row">
                            <button onclick="bindDomain('${i.id}', ${JSON.stringify(i)})">解析</button>
                            <select id="method-${i.id}"><option value="dns">DNS</option><option value="http">HTTP</option></select>
                            <button class="secondary" onclick="applySsl('${i.id}', ${JSON.stringify(i)})">SSL</button>
                        </div>
                    </div>
                </div>
                <div class="card-footer">
                    <div class="toolbox">
                        <button onclick="quickInstall(${JSON.stringify(i)}, 'docker')">🐳</button>
                        <button onclick="quickInstall(${JSON.stringify(i)}, 'nginx')">🌐</button>
                        <button onclick="quickInstall(${JSON.stringify(i)}, 'bt-panel')">🏰</button>
                    </div>
                    <div class="actions">
                        <button title="续期" onclick="renew(${i.id})">⏳</button>
                        <button title="终端" onclick='openTerminal(${JSON.stringify(i)})'>📟</button>
                        <button title="重启" onclick="powerOp(${i.id}, 'reboot')">🔄</button>
                        <button title="停止" onclick="powerOp(${i.id}, 'stop')" ${i.status !== 'active' ? 'disabled' : ''}>⏹️</button>
                        <button class="primary" onclick='openFileManager(${JSON.stringify(i)})'>文件</button>
                    </div>
                </div>
            </div>`;
        }).join('');

        const planOptions = plansRes.data.map((p: any) => `<option value="${p.id}">${p.name} - ${p.price_hour}点/时</option>`).join('');

        return `<!DOCTYPE html><html><head><style>
            :root{--card-bg:var(--vscode-sideBar-background);--border:var(--vscode-panel-border);--input-bg:var(--vscode-input-background);}
            body{font-family:var(--vscode-font-family);color:var(--vscode-foreground);padding:15px;background:var(--vscode-editor-background);margin:0;}
            h2{display:flex;align-items:center;justify-content:space-between;font-size:1.2em;margin-bottom:20px;}
            .grid{display:grid;grid-template-columns:repeat(auto-fill, minmax(300px, 1fr));gap:15px;}
            .card{background:var(--card-bg);border:1px solid var(--border);border-radius:6px;overflow:hidden;display:flex;flex-direction:column;}
            .card-header{padding:10px;background:rgba(0,0,0,0.1);display:flex;align-items:center;gap:8px;border-bottom:1px solid var(--border);}
            .card-body{padding:12px;flex-grow:1;}
            .card-footer{padding:8px 12px;background:rgba(0,0,0,0.05);border-top:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;}
            .status{width:8px;height:8px;border-radius:50%;}
            .status.active{background:#4caf50;box-shadow:0 0 5px #4caf50;}
            .status.stopped{background:#f44336;}
            .badge{font-size:10px;opacity:0.7;margin-left:auto;background:var(--vscode-badge-background);padding:2px 4px;border-radius:3px;}
            .info-row{font-size:11px;opacity:0.8;margin-bottom:8px;}
            .tool-group{background:rgba(0,0,0,0.2);padding:8px;border-radius:4px;margin-top:10px;}
            .input-wrap{display:flex;align-items:center;gap:4px;margin-bottom:6px;}
            .btn-row{display:flex;gap:4px;}
            input, select{background:var(--input-bg);color:inherit;border:1px solid var(--border);padding:3px 6px;font-size:11px;border-radius:2px;width:100%;}
            button{cursor:pointer;background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:none;padding:4px 8px;border-radius:3px;font-size:11px;}
            button:hover{background:var(--vscode-button-hoverBackground);}
            button:disabled{opacity:0.4;cursor:not-allowed;}
            .primary{background:var(--vscode-button-hoverBackground);font-weight:bold;}
            .secondary{background:var(--vscode-badge-background);color:var(--vscode-badge-foreground);}
            .create-form{background:var(--card-bg);border:1px solid var(--border);padding:15px;border-radius:6px;margin-bottom:20px;}
            .form-grid{display:grid;grid-template-columns:1fr 1fr 1fr auto;gap:10px;align-items:end;}
            .actions{display:flex;gap:4px;}
            .toolbox button{padding:4px;background:transparent;font-size:14px;}
            .toolbox button:hover{background:rgba(255,255,255,0.1);}
        </style></head><body>
            <h2><span>🚀 Ephemera 控制台</span><button onclick="refresh()">🔄 刷新</button></h2>
            <div class="create-form">
                <div style="font-weight:bold;margin-bottom:10px;">✨ 快速部署新实例</div>
                <div class="form-grid">
                    <div><label>选择套餐</label><select id="new-plan">${planOptions}</select></div>
                    <div><label>系统镜像</label><select id="new-os"><option value="1">Ubuntu 22.04</option><option value="2">Debian 11</option><option value="3">CentOS 7</option></select></div>
                    <div><label>时长 (H)</label><input type="number" id="new-time" value="1"></div>
                    <button class="primary" onclick="createInstance()">立即创建</button>
                </div>
            </div>
            <div class="grid">${instanceList || '<div style="grid-column:1/-1;text-align:center;padding:40px;opacity:0.5;">暂无活跃实例</div>'}</div>
            <script>
                const vscode = acquireVsCodeApi();
                function refresh(){vscode.postMessage({command:'refresh'});}
                function copy(t){vscode.postMessage({command:'copy',text:t});}
                function createInstance(){
                    const data = {plan:document.getElementById('new-plan').value, os:document.getElementById('new-os').value, time:document.getElementById('new-time').value};
                    vscode.postMessage({command:'create',data});
                }
                function powerOp(id,op){vscode.postMessage({command:'powerOp',instanceId:id,operation:op});}
                function renew(id){vscode.postMessage({command:'renew',instanceId:id});}
                function openTerminal(i){vscode.postMessage({command:'openTerminal',instance:i});}
                function openFileManager(i){vscode.postMessage({command:'openFileManager',instance:i});}
                function bindDomain(id,i){const sub=document.getElementById('sub-'+id).value;vscode.postMessage({command:'bindDomain',instance:i,subdomain:sub});}
                function applySsl(id,i){const sub=document.getElementById('sub-'+id).value;const method=document.getElementById('method-'+id).value;vscode.postMessage({command:'applySsl',instance:i,subdomain:sub,method:method});}
                function quickInstall(i,tool){vscode.postMessage({command:'quickInstall',instance:i,tool:tool});}
            </script>
        </body></html>`;
    }

    public dispose() {
        EphemeraPanel.currentPanel = undefined; this._panel.dispose();
        while (this._disposables.length) { const x = this._disposables.pop(); if (x) x.dispose(); }
    }
}
