import * as vscode from 'vscode';
import { EphemeraAPIClient, EphemeraInstance } from '../api/client';

export class InstanceTreeItem extends vscode.TreeItem {
    constructor(public readonly instance: EphemeraInstance) {
        super(instance.hostname, vscode.TreeItemCollapsibleState.None);
        const diff = (new Date(instance.expiration_at).getTime() - Date.now()) / (1000 * 3600);
        const timeStr = diff < 0 ? '已过期' : (diff < 24 ? `${Math.floor(diff)}h` : `${Math.floor(diff/24)}d`);
        
        this.description = `${instance.ipv4} | ${timeStr}`;
        this.contextValue = 'instance';
        this.tooltip = `ID: ${instance.id}\nIP: ${instance.ipv4}\n套餐: ${instance.plan}\n系统: ${instance.os}\n状态: ${instance.status}\n到期: ${instance.expiration_at}`;
        
        const s = instance.status.toLowerCase();
        this.iconPath = s === 'active' ? new vscode.ThemeIcon('pass-filled', new vscode.ThemeColor('debugIcon.startForeground')) : 
                        s === 'stopped' ? new vscode.ThemeIcon('error', new vscode.ThemeColor('debugIcon.stopForeground')) : 
                        new vscode.ThemeIcon('history');

        this.command = {
            command: 'ephemera.viewInstanceDetails',
            title: '查看详情',
            arguments: [this]
        };
    }
}

export class InstancesProvider implements vscode.TreeDataProvider<InstanceTreeItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<InstanceTreeItem | undefined | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    constructor(private apiClient: EphemeraAPIClient) {}
    refresh(): void { this._onDidChangeTreeData.fire(); }
    getTreeItem(el: InstanceTreeItem): vscode.TreeItem { return el; }

    async getChildren(): Promise<InstanceTreeItem[]> {
        if (!this.apiClient.hasCredentials()) return [];
        try {
            const res = await this.apiClient.listInstances();
            return res.code === 200 ? res.data.map(i => new InstanceTreeItem(i)) : [];
        } catch { return []; }
    }
}
