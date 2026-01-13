import * as vscode from 'vscode';
import { EphemeraAPIClient, EphemeraInstance } from '../api/client';
import { CloudflareClient } from '../api/cloudflare';

export class EphemeraPanel {
    public static currentPanel: EphemeraPanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private _disposables: vscode.Disposable[] = [];
    private _currentInstance: EphemeraInstance | null = null;
    private _currentPath: string = '/home';

    private constructor(panel: vscode.WebviewPanel, private apiClient: EphemeraAPIClient, private cfClient: CloudflareClient) {
        this._panel = panel;
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
        this._panel.webview.onDidReceiveMessage(message => this._handleMessage(message), null, this._disposables);
        this._update();
    }

    public static async createOrShow(uri: vscode.Uri, apiClient: EphemeraAPIClient, cfClient: CloudflareClient) {
        if (EphemeraPanel.currentPanel) return EphemeraPanel.currentPanel._panel.reveal(vscode.ViewColumn.One);
        const panel = vscode.window.createWebviewPanel('ephemera', 'Ephemera 控制台', vscode.ViewColumn.One, { enableScripts: true, retainContextWhenHidden: true });
        EphemeraPanel.currentPanel = new EphemeraPanel(panel, apiClient, cfClient);
    }

    private async _handleMessage(m: any) {
        try {
            switch (m.command) {
                case 'create': await this._handleCreate(m.data); break;
                case 'refresh': await this._update(); break;
                case 'powerOp': await this._handlePowerOp(m.instanceId, m.operation); break;
                case 'bindDomain': await this._handleBindDomain(m.instance, m.subdomain); break;
                case 'applySsl': await this._handleApplySsl(m.instance, m.subdomain, m.method); break;
                case 'quickInstall': await this._handleQuickInstall(m.instance, m.tool); break;
                case 'renew': await this._handleRenew(m.instanceId); break;
                case 'openTerminal': this._handleOpenTerminal(m.instance); break;
                case 'copy': vscode.env.clipboard.writeText(m.text); vscode.window.showInformationMessage('已复制'); break;
                case 'openFileManager': this._currentInstance = m.instance; this._currentPath = `/home/${m.instance.user || 'root'}`; await this._renderFileManager(); break;
                case 'closeFileManager': this._currentInstance = null; await this._update(); break;
                case 'ls': this._currentPath = m.path; await this._renderFileManager(); break;
                case 'cat': await this._handleCat(m.path); break;
                case 'fileOp': await this._handleFileOp(m.op, m.path, m.name); break;
            }
        } catch (e: any) { vscode.window.showErrorMessage(`失败: ${e.message}`); }
    }

    private async _handleBindDomain(i: EphemeraInstance, sub: string) {
        const conf = vscode.workspace.getConfiguration('ephemera');
        const zid = conf.get<string>('cloudflareZoneId');
        const dom = conf.get<string>('cloudflareDomain');
        if (!zid || !dom) throw new Error('未配置 CF Zone/Domain');
        await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `解析 ${sub}.${dom}` }, () => this.cfClient.updateDnsRecord(zid, dom, sub, i.ipv4));
        vscode.window.showInformationMessage('解析成功');
    }

    private async _handleApplySsl(i: EphemeraInstance, sub: string, method: 'dns' | 'http') {
        const dom = vscode.workspace.getConfiguration('ephemera').get<string>('cloudflareDomain');
        const tok = await this.cfClient.getToken();
        if (!dom) throw new Error('未配置域名');
        const fullDom = sub ? `${sub}.${dom}` : dom;
        await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `签发 SSL: ${fullDom}` }, async (p) => {
            p.report({ message: "准备环境..." });
            await this.apiClient.runCommandAndWait(i.id, `if [ ! -d "$HOME/.acme.sh" ]; then curl https://get.acme.sh | sh -s email=admin@${dom}; fi`);
            p.report({ message: "下发证书..." });
            const cmd = method === 'dns' ? `export CF_Token="${tok}"; $HOME/.acme.sh/acme.sh --issue --dns dns_cf -d ${fullDom} --force` : `$HOME/.acme.sh/acme.sh --issue --standalone -d ${fullDom} --force`;
            const out = await this.apiClient.runCommandAndWait(i.id, cmd, 180000);
            if (!out.includes("Cert success")) throw new Error(out);
        });
        vscode.window.showInformationMessage('SSL 签发成功');
    }

    private async _handleRenew(id: number) { const res = await this.apiClient.renewInstance(id, 24); if (res.code === 200) { vscode.window.showInformationMessage('续期成功'); this._update(); } }
    private async _handlePowerOp(id: number, op: string) {
        const action: any = op === 'start' ? 'boot' : (op === 'reboot' ? 'restart' : 'shutdown');
        const res = await this.apiClient.powerOperation(id, action);
        if (res.code === 200) { vscode.window.showInformationMessage('已下发'); setTimeout(() => this._update(), 2000); }
    }
    private async _handleCat(p: string) {
        const out = await this.apiClient.runCommandAndWait(this._currentInstance!.id, `cat "${p}" | head -c 10000`);
        const doc = await vscode.workspace.openTextDocument({ content: out });
        await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside);
    }
    private async _handleFileOp(op: string, p: string, n?: string) {
        await this.apiClient.runCommandAndWait(this._currentInstance!.id, op === 'delete' ? `rm -rf "${p}"` : `mkdir -p "${this._currentPath}/${n}"`);
        await this._renderFileManager();
    }
    private async _handleQuickInstall(i: EphemeraInstance, tool: string) {
        const cmds: any = { docker: 'curl -fsSL https://get.docker.com | bash', nginx: 'apt update && apt install -y nginx', bt: 'wget -O i.sh http://download.bt.cn/install/install-ubuntu_6.0.sh && bash i.sh ed8484bec' };
        await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `安装 ${tool}` }, () => this.apiClient.runCommandAndWait(i.id, cmds[tool] || tool, 300000));
        vscode.window.showInformationMessage('部署完成');
    }
    private _handleOpenTerminal(i: EphemeraInstance) { const t = vscode.window.createTerminal(`SSH: ${i.hostname}`); t.show(); t.sendText(`ssh ${i.user || 'root'}@${i.ipv4}`); }
    private async _handleCreate(d: any) { const res = await this.apiClient.deployInstance({ product_id: parseInt(d.plan), os_id: parseInt(d.os), time: parseInt(d.time) }); if (res.code === 200) { vscode.window.showInformationMessage('创建中'); setTimeout(() => this._update(), 3000); } }

    private _html(body: string, script: string = '') {
        return `<!DOCTYPE html><html><head><style>
            :root{--bg:var(--vscode-sideBar-background);--border:var(--vscode-panel-border);--input:var(--vscode-input-background);}
            body{font-family:var(--vscode-font-family);color:var(--vscode-foreground);background:var(--vscode-editor-background);padding:15px;margin:0;font-size:12px;}
            button{cursor:pointer;background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:none;padding:5px 10px;border-radius:3px;}
            button:hover{background:var(--vscode-button-hoverBackground);}
            input,select{background:var(--input);color:inherit;border:1px solid var(--border);padding:4px 8px;border-radius:3px;box-sizing:border-box;}
            .card{background:var(--bg);border:1px solid var(--border);border-radius:6px;margin-bottom:12px;display:flex;flex-direction:column;}
            .ch{padding:10px;display:flex;align-items:center;gap:8px;border-bottom:1px solid var(--border);background:rgba(255,255,255,0.02);}
            .cb{padding:12px;flex:1;}
            .cf{padding:8px 12px;border-top:1px solid var(--border);display:flex;justify-content:space-between;background:rgba(0,0,0,0.05);}
            .st{width:8px;height:8px;border-radius:50%;}
            .st.active{background:#4caf50;box-shadow:0 0 5px #4caf50;}
            .st.stopped{background:#f44336;}
            .grid{display:grid;grid-template-columns:repeat(auto-fill, minmax(280px, 1fr));gap:12px;}
        </style></head><body>${body}<script>const v=acquireVsCodeApi();${script}</script></body></html>`;
    }

    private async _update() {
        const [insRes, pRes] = await Promise.all([this.apiClient.listInstances(), this.apiClient.getPlans()]);
        const dom = vscode.workspace.getConfiguration('ephemera').get<string>('cloudflareDomain') || '未配域名';
        const list = insRes.data.map(i => {
            const mem = Math.round(((i.state?.memory?.memtotal || 1)-(i.state?.memory?.memavailable||0))/(i.state?.memory?.memtotal||1)*100);
            return `<div class="card">
                <div class="ch"><span class="st ${i.status}"></span><b onclick="v.postMessage({command:'copy',text:'${i.hostname}'})">${i.hostname}</b><code>${i.ipv4}</code> <span style="margin-left:auto;opacity:0.6">CPU ${i.state?.cpu||0}% MEM ${mem}%</span></div>
                <div class="cb">
                    <div style="opacity:0.6;margin-bottom:8px">到期: ${i.expiration_at}</div>
                    <div style="background:rgba(0,0,0,0.1);padding:8px;border-radius:4px;display:flex;flex-direction:column;gap:5px">
                        <div style="display:flex;gap:5px"><input style="flex:1" type="text" id="s-${i.id}" placeholder="子域名"><code>.${dom}</code></div>
                        <div style="display:flex;gap:5px">
                            <button onclick="v.postMessage({command:'bindDomain',instance:${JSON.stringify(i)},subdomain:document.getElementById('s-${i.id}').value})" style="flex:1">解析</button>
                            <select id="m-${i.id}"><option value="dns">DNS</option><option value="http">HTTP</option></select>
                            <button onclick="v.postMessage({command:'applySsl',instance:${JSON.stringify(i)},subdomain:document.getElementById('s-${i.id}').value,method:document.getElementById('m-${i.id}').value})" style="flex:1">SSL</button>
                        </div>
                    </div>
                </div>
                <div class="cf">
                    <div style="display:flex;gap:5px">
                        <button onclick="v.postMessage({command:'quickInstall',instance:${JSON.stringify(i)},tool:'docker'})">🐳</button>
                        <button onclick="v.postMessage({command:'quickInstall',instance:${JSON.stringify(i)},tool:'nginx'})">🌐</button>
                    </div>
                    <div style="display:flex;gap:5px">
                        <button onclick='v.postMessage({command:"openTerminal",instance:${JSON.stringify(i)}})'>📟</button>
                        <button onclick="v.postMessage({command:'powerOp',instanceId:${i.id},operation:'reboot'})">🔄</button>
                        <button onclick="v.postMessage({command:'openFileManager',instance:${JSON.stringify(i)}})">文件</button>
                    </div>
                </div>
            </div>`;
        }).join('');
        this._panel.webview.html = this._html(`
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:15px"><h2>控制台</h2><button onclick="v.postMessage({command:'refresh'})">刷新</button></div>
            <div class="card cb" style="display:flex;gap:10px;align-items:flex-end;flex-direction:row">
                <div style="flex:1"><label>套餐</label><select style="width:100%" id="np">${pRes.data.map(p=>`<option value="${p.id}">${p.name}</option>`).join('')}</select></div>
                <div style="flex:1"><label>系统</label><select style="width:100%" id="no"><option value="1">Ubuntu 22</option><option value="2">Debian 11</option></select></div>
                <div style="flex:0.5"><label>时长</label><input style="width:100%" type="number" id="nt" value="1"></div>
                <button onclick="v.postMessage({command:'create',data:{plan:document.getElementById('np').value,os:document.getElementById('no').value,time:document.getElementById('nt').value}})">创建</button>
            </div>
            <div class="grid">${list || '<div style="grid-column:1/-1;text-align:center;padding:50px;opacity:0.3">无数据</div>'}</div>
        `);
    }

    private async _renderFileManager() {
        let f: string[] = []; try { f = (await this.apiClient.runCommandAndWait(this._currentInstance!.id, `ls -F -1 "${this._currentPath}"`)).split('\n').filter(x=>x.trim()); } catch {}
        const items = f.map(x => {
            const isD = x.endsWith('/'); const n = isD ? x.slice(0,-1) : x; const p = `${this._currentPath}/${n}`.replace(/\/+/g,'/');
            return `<div style="display:flex;padding:5px;border-bottom:1px solid var(--border);align-items:center;">
                <span style="margin-right:8px">${isD?'📁':'📄'}</span><span style="flex:1;cursor:pointer" onclick="v.postMessage({command:'${isD?'ls':'cat'}',path:'${p}'})">${n}</span>
                <button style="background:#d32f2f;padding:2px 6px" onclick="if(confirm('删?'))v.postMessage({command:'fileOp',op:'delete',path:'${p}'})">删</button>
            </div>`;
        }).join('');
        this._panel.webview.html = this._html(`
            <div style="display:flex;gap:10px;margin-bottom:15px;align-items:center;">
                <button onclick="v.postMessage({command:'closeFileManager'})">返回</button>
                <div style="background:var(--input);padding:5px;border-radius:3px;flex:1;overflow:hidden;text-overflow:ellipsis;font-family:monospace">${this._currentPath}</div>
                <button onclick="const n=prompt('名');if(n)v.postMessage({command:'fileOp',op:'mkdir',name:n})">新📁</button>
            </div><div>${items || '空'}</div>
        `);
    }

    public dispose() {
        EphemeraPanel.currentPanel = undefined; this._panel.dispose();
        while (this._disposables.length) { const x = this._disposables.pop(); if (x) x.dispose(); }
    }
}
