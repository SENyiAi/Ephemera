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
                try {
                    switch (message.command) {
                        case 'create': await this._handleCreate(message.data); break;
                        case 'refresh': await this._update(); break;
                        case 'powerOp': await this._handlePowerOp(message.instanceId, message.operation); break;
                        case 'sync': vscode.commands.executeCommand('ephemera.syncWorkspace', { instance: message.instance }); break;
                        case 'bindDomain': await this._handleBindDomain(message.instance, message.subdomain); break;
                        case 'applySsl': await this._handleApplySsl(message.instance, message.subdomain, message.method); break;
                        case 'quickInstall': await this._handleQuickInstall(message.instance, message.tool); break;
                        case 'renew': await this._handleRenew(message.instanceId); break;
                        case 'openTerminal': this._handleOpenTerminal(message.instance); break;
                        case 'copy': vscode.env.clipboard.writeText(message.text); vscode.window.showInformationMessage('已复制到剪贴板'); break;
                        case 'rebuild': await this._handleRebuild(message.instanceId); break;
                        case 'openFileManager':
                            this._currentInstance = message.instance;
                            this._currentPath = `/home/${this._currentInstance?.user || 'root'}`;
                            await this._renderFileManager();
                            break;
                        case 'closeFileManager': this._currentInstance = null; await this._update(); break;
                        case 'ls': this._currentPath = message.path; await this._renderFileManager(); break;
                        case 'cat': await this._handleCat(message.path); break;
                        case 'fileOp': await this._handleFileOp(message.op, message.path, message.name); break;
                    }
                } catch (e: any) {
                    vscode.window.showErrorMessage(`操作失败: ${e.message}`);
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
        if (!zoneId || !domain) throw new Error('请先在设置中配置 Cloudflare Zone ID 和 Domain');
        await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `解析域名: ${subdomain}.${domain}` }, async () => {
            await this.cfClient.updateDnsRecord(zoneId, domain, subdomain, instance.ipv4);
        });
        vscode.window.showInformationMessage(`域名解析成功`);
    }

    private async _handleApplySsl(instance: EphemeraInstance, subdomain: string, method: 'dns' | 'http') {
        const config = vscode.workspace.getConfiguration('ephemera');
        const domain = config.get<string>('cloudflareDomain');
        const token = await this.cfClient.getToken();
        if (!domain) throw new Error('请先配置 Cloudflare Domain');
        const fullDomain = subdomain ? `${subdomain}.${domain}` : domain;
        await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `下发证书: ${fullDomain}` }, async (p) => {
            p.report({ message: "准备 acme.sh..." });
            await this.apiClient.runCommandAndWait(instance.id, `if [ ! -d "$HOME/.acme.sh" ]; then curl https://get.acme.sh | sh -s email=admin@${domain}; fi`);
            p.report({ message: "执行申请..." });
            const cmd = method === 'dns' ? `export CF_Token="${token}"; $HOME/.acme.sh/acme.sh --issue --dns dns_cf -d ${fullDomain} --force` : `$HOME/.acme.sh/acme.sh --issue --standalone -d ${fullDomain} --force`;
            const res = await this.apiClient.runCommandAndWait(instance.id, cmd, 180000);
            if (!res.includes("Cert success")) throw new Error(res);
        });
        vscode.window.showInformationMessage(`证书签发成功`);
    }

    private async _handleRenew(instanceId: number) {
        const res = await this.apiClient.renewInstance(instanceId, 24);
        if (res.code === 200) { vscode.window.showInformationMessage('续期成功'); this._update(); } else throw new Error(res.message);
    }

    private async _handleRebuild(instanceId: number) {
        if (await vscode.window.showWarningMessage('重装系统将清空数据，是否继续？', { modal: true }, '确定') !== '确定') return;
        await this.apiClient.rebuildInstance(instanceId, { os_id: 1 });
        vscode.window.showInformationMessage('正在重装...');
        setTimeout(() => this._update(), 3000);
    }

    private async _handlePowerOp(instanceId: number, operation: string) {
        let action: any = operation === 'start' ? 'boot' : (operation === 'reboot' ? 'restart' : 'shutdown');
        const res = await this.apiClient.powerOperation(instanceId, action);
        if (res.code === 200) {
            vscode.window.showInformationMessage('指令已下发');
            setTimeout(() => this._update(), 2000);
        } else throw new Error(res.message);
    }

    private async _handleCat(path: string) {
        if (!this._currentInstance) return;
        const content = await this.apiClient.runCommandAndWait(this._currentInstance.id, `cat "${path}" | head -c 10000`);
        const doc = await vscode.workspace.openTextDocument({ content });
        await vscode.window.showTextDocument(doc, { preview: true, viewColumn: vscode.ViewColumn.Beside });
    }

    private async _handleFileOp(op: string, path: string, name?: string) {
        if (!this._currentInstance) return;
        const cmd = op === 'delete' ? `rm -rf "${path}"` : `mkdir -p "${this._currentPath}/${name}"`;
        await this.apiClient.runCommandAndWait(this._currentInstance.id, cmd);
        await this._renderFileManager();
    }

    private async _handleQuickInstall(instance: EphemeraInstance, tool: string) {
        const cmds: Record<string, string> = {
            docker: 'curl -fsSL https://get.docker.com | bash && systemctl enable --now docker',
            nginx: 'apt-get update && apt-get install -y nginx && systemctl enable --now nginx',
            nodejs: 'curl -fsSL https://deb.nodesource.com/setup_lts.x | bash - && apt-get install -y nodejs',
            'docker-compose': 'curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose && chmod +x /usr/local/bin/docker-compose',
            'bt-panel': 'wget -O install.sh http://download.bt.cn/install/install-ubuntu_6.0.sh && bash install.sh ed8484bec'
        };
        await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `部署 ${tool}` }, async () => {
            await this.apiClient.runCommandAndWait(instance.id, cmds[tool], 300000);
        });
        vscode.window.showInformationMessage('安装完成');
    }

    private _handleOpenTerminal(instance: EphemeraInstance) {
        const t = vscode.window.createTerminal(`SSH: ${instance.hostname}`);
        t.show(); t.sendText(`ssh ${instance.user || 'root'}@${instance.ipv4}`);
    }

    private async _handleCreate(data: any) {
        const res = await this.apiClient.deployInstance({ product_id: parseInt(data.plan), os_id: parseInt(data.os), time: parseInt(data.time) });
        if (res.code === 200) { vscode.window.showInformationMessage('开始创建实例'); setTimeout(() => this._update(), 3000); } else throw new Error(res.message);
    }

    private _getCommonStyles() {
        return `
            :root{--card-bg:var(--vscode-sideBar-background);--border:var(--vscode-panel-border);--input-bg:var(--vscode-input-background);}
            body{font-family:var(--vscode-font-family);color:var(--vscode-foreground);padding:15px;background:var(--vscode-editor-background);margin:0;font-size:12px;}
            button{cursor:pointer;background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:none;padding:5px 10px;border-radius:3px;transition:opacity 0.2s;}
            button:hover{background:var(--vscode-button-hoverBackground);}
            button:disabled{opacity:0.4;cursor:not-allowed;}
            input, select{background:var(--input-bg);color:inherit;border:1px solid var(--border);padding:4px 8px;border-radius:3px;width:100%;box-sizing:border-box;}
            .grid{display:grid;grid-template-columns:repeat(auto-fill, minmax(280px, 1fr));gap:15px;}
            .card{background:var(--card-bg);border:1px solid var(--border);border-radius:6px;display:flex;flex-direction:column;transition:transform 0.1s;}
            .card-header{padding:10px;background:rgba(255,255,255,0.03);display:flex;align-items:center;gap:8px;border-bottom:1px solid var(--border);}
            .card-body{padding:12px;flex-grow:1;}
            .card-footer{padding:8px 12px;background:rgba(0,0,0,0.05);border-top:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;}
            .status{width:8px;height:8px;border-radius:50%;}
            .status.active{background:#4caf50;box-shadow:0 0 4px #4caf50;}
            .status.stopped{background:#f44336;}
            .badge{font-size:10px;opacity:0.7;margin-left:auto;background:var(--vscode-badge-background);padding:2px 5px;border-radius:10px;}
            .toolbox button{padding:4px;background:transparent;font-size:16px;}
            .actions{display:flex;gap:5px;}
        `;
    }

    private async _update() {
        const [instancesRes, plansRes] = await Promise.all([this.apiClient.listInstances(), this.apiClient.getPlans()]);
        const cfDomain = vscode.workspace.getConfiguration('ephemera').get<string>('cloudflareDomain') || '未配域名';
        const instanceList = instancesRes.data.map(i => {
            const memUsage = Math.round(((i.state?.memory?.memtotal || 1) - (i.state?.memory?.memavailable || 0)) / (i.state?.memory?.memtotal || 1) * 100);
            return `
            <div class="card">
                <div class="card-header"><span class="status ${i.status}"></span><b onclick="copy('${i.hostname}')">${i.hostname}</b><code onclick="copy('${i.ipv4}')">${i.ipv4}</code><span class="badge">CPU ${i.state?.cpu || 0}% | MEM ${memUsage}%</span></div>
                <div class="card-body">
                    <div style="opacity:0.7;margin-bottom:8px">到期: ${i.expiration_at}</div>
                    <div style="background:rgba(0,0,0,0.15);padding:8px;border-radius:4px">
                        <div style="display:flex;gap:4px;margin-bottom:6px"><input type="text" id="sub-${i.id}" placeholder="子域名"><code>.${cfDomain}</code></div>
                        <div style="display:flex;gap:4px">
                            <button onclick="bindDomain('${i.id}', ${JSON.stringify(i)})" style="flex:1">解析</button>
                            <select id="method-${i.id}" style="width:70px"><option value="dns">DNS</option><option value="http">HTTP</option></select>
                            <button onclick="applySsl('${i.id}', ${JSON.stringify(i)})" style="flex:1" class="secondary">SSL</button>
                        </div>
                    </div>
                </div>
                <div class="card-footer">
                    <div class="toolbox">
                        <button onclick="quickInstall(${JSON.stringify(i)}, 'docker')" title="Docker">🐳</button>
                        <button onclick="quickInstall(${JSON.stringify(i)}, 'nginx')" title="Nginx">🌐</button>
                        <button onclick="quickInstall(${JSON.stringify(i)}, 'bt-panel')" title="宝塔">🏰</button>
                    </div>
                    <div class="actions">
                        <button onclick="renew(${i.id})">⏳</button>
                        <button onclick='openTerminal(${JSON.stringify(i)})'>📟</button>
                        <button onclick="powerOp(${i.id}, 'reboot')">🔄</button>
                        <button onclick="openFileManager(${JSON.stringify(i)})" style="background:var(--vscode-button-hoverBackground)">文件</button>
                    </div>
                </div>
            </div>`;
        }).join('');

        this._panel.webview.html = `<!DOCTYPE html><html><head><style>${this._getCommonStyles()}
            .create-bar{background:var(--card-bg);padding:15px;border-radius:6px;margin-bottom:20px;display:flex;gap:15px;align-items:flex-end;}
            .create-bar div{flex:1;}
        </style></head><body>
            <h2 style="margin:0 0 20px 0"><span>🚀 控制台</span> <button onclick="refresh()">刷新</button></h2>
            <div class="create-bar">
                <div><label>套餐</label><select id="n-p">${plansRes.data.map(p => `<option value="${p.id}">${p.name}</option>`).join('')}</select></div>
                <div><label>镜像</label><select id="n-o"><option value="1">Ubuntu 22</option><option value="2">Debian 11</option></select></div>
                <div><label>时长(H)</label><input type="number" id="n-t" value="1"></div>
                <button onclick="create()" style="background:var(--vscode-button-hoverBackground);font-weight:bold;height:30px">创建</button>
            </div>
            <div class="grid">${instanceList || '<div style="grid-column:1/-1;text-align:center;padding:50px;opacity:0.5">暂无实例</div>'}</div>
            <script>
                const v=acquireVsCodeApi();
                function refresh(){v.postMessage({command:'refresh'});}
                function copy(t){v.postMessage({command:'copy',text:t});}
                function create(){v.postMessage({command:'create',data:{plan:document.getElementById('n-p').value,os:document.getElementById('n-o').value,time:document.getElementById('n-t').value}});}
                function powerOp(id,op){v.postMessage({command:'powerOp',instanceId:id,operation:op});}
                function renew(id){v.postMessage({command:'renew',instanceId:id});}
                function openTerminal(i){v.postMessage({command:'openTerminal',instance:i});}
                function openFileManager(i){v.postMessage({command:'openFileManager',instance:i});}
                function bindDomain(id,i){v.postMessage({command:'bindDomain',instance:i,subdomain:document.getElementById('sub-'+id).value});}
                function applySsl(id,i){v.postMessage({command:'applySsl',instance:i,subdomain:document.getElementById('sub-'+id).value,method:document.getElementById('method-'+id).value});}
                function quickInstall(i,tool){v.postMessage({command:'quickInstall',instance:i,tool:tool});}
            </script></body></html>`;
    }

    private async _renderFileManager() {
        const i = this._currentInstance!;
        let files: string[] = [];
        try { files = (await this.apiClient.runCommandAndWait(i.id, `ls -F -1 "${this._currentPath}"`)).split('\n').filter(f => f.trim()); } catch {}
        const items = files.map(f => {
            const isD = f.endsWith('/'); const n = isD ? f.slice(0, -1) : f; const p = `${this._currentPath}/${n}`.replace(/\/+/g, '/');
            return `<div style="display:flex;padding:5px;border-bottom:1px solid var(--border);align-items:center;">
                <span style="margin-right:8px">${isD ? '📁' : '📄'}</span>
                <span style="flex:1;cursor:pointer" onclick="${isD ? `ls('${p}')` : `cat('${p}')`}">${n}</span>
                <button onclick="fop('delete','${p}')" style="background:#d32f2f;padding:2px 6px">删</button>
            </div>`;
        }).join('');

        this._panel.webview.html = `<!DOCTYPE html><html><head><style>${this._getCommonStyles()}
            .path{background:var(--input-bg);padding:5px 10px;border-radius:3px;font-family:monospace;flex:1;overflow:hidden;text-overflow:ellipsis;}
        </style></head><body>
            <div style="display:flex;gap:10px;margin-bottom:15px;align-items:center;">
                <button onclick="closeF()">返回</button>
                <button onclick="ls('${this._currentPath.split('/').slice(0, -1).join('/') || '/'}')">UP</button>
                <div class="path">${this._currentPath}</div>
                <button onclick="mkdir()">新📁</button>
            </div>
            <div>${items || '<div style="text-align:center;padding:40px;opacity:0.4">空</div>'}</div>
            <script>
                const v=acquireVsCodeApi();
                function ls(p){v.postMessage({command:'ls',path:p});}
                function cat(p){v.postMessage({command:'cat',path:p});}
                function closeF(){v.postMessage({command:'closeFileManager'});}
                function fop(o,p,n){if(o==='delete'&&!confirm('确定?'))return;v.postMessage({command:'fileOp',op:o,path:p,name:n});}
                function mkdir(){const n=prompt('名:');if(n)fop('mkdir','',n);}
            </script></body></html>`;
    }

    public dispose() {
        EphemeraPanel.currentPanel = undefined; this._panel.dispose();
        while (this._disposables.length) { const x = this._disposables.pop(); if (x) x.dispose(); }
    }
}
