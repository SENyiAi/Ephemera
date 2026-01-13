import * as vscode from 'vscode';
import { EphemeraAPIClient, EphemeraPlan } from '../api/client';

export class PlanTreeItem extends vscode.TreeItem {
    constructor(public readonly plan: EphemeraPlan) {
        super(plan.name, vscode.TreeItemCollapsibleState.None);
        this.description = `${plan.cpu}C/${plan.memory/1024}G/${plan.disk}G`;
        this.tooltip = `套餐: ${plan.name}\nCPU: ${plan.cpu}核\n内存: ${plan.memory}MB\n磁盘: ${plan.disk}G\n库存: ${plan.stock}`;
        this.iconPath = new vscode.ThemeIcon('package');
        this.contextValue = 'plan';
        this.command = {
            command: 'ephemera.openConsole',
            title: '创建实例',
            arguments: [plan]
        };
    }
}

export class PlansProvider implements vscode.TreeDataProvider<PlanTreeItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<PlanTreeItem | undefined | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    constructor(private apiClient: EphemeraAPIClient) {}
    refresh(): void { this._onDidChangeTreeData.fire(); }
    getTreeItem(el: PlanTreeItem): vscode.TreeItem { return el; }

    async getChildren(): Promise<PlanTreeItem[]> {
        if (!this.apiClient.hasCredentials()) return [];
        try {
            const res = await this.apiClient.getPlans();
            return res.code === 200 ? res.data.map(p => new PlanTreeItem(p)) : [];
        } catch { return []; }
    }
}
