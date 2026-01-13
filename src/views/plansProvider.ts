import * as vscode from 'vscode';
import { EphemeraAPIClient, EphemeraPlan } from '../api/client';

export class PlanTreeItem extends vscode.TreeItem {
    constructor(
        public readonly plan: EphemeraPlan,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState
    ) {
        super(plan.name, collapsibleState);
        
        this.tooltip = this.getTooltip();
        this.description = `${plan.cpu}C/${plan.memory/1024}G/${plan.disk}G`;
        this.contextValue = 'plan';
        this.iconPath = new vscode.ThemeIcon('server');
    }

    private getTooltip(): string {
        const p = this.plan;
        return `套餐: ${p.name}
CPU: ${p.cpu} 核 ${p.cpu_name}
内存: ${p.memory} MB (${(p.memory / 1024).toFixed(1)} GB)
磁盘: ${p.disk} GB ${p.disk_type}
网络: ${p.show_speed}
${p.gpu ? `GPU: ${p.gpu}` : ''}
库存: ${p.stock}`;
    }
}

export class PlansProvider implements vscode.TreeDataProvider<PlanTreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<PlanTreeItem | undefined | null | void> = 
        new vscode.EventEmitter<PlanTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<PlanTreeItem | undefined | null | void> = 
        this._onDidChangeTreeData.event;

    constructor(private apiClient: EphemeraAPIClient) {}

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: PlanTreeItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: PlanTreeItem): Promise<PlanTreeItem[]> {
        if (!this.apiClient.hasCredentials()) {
            return [];
        }

        if (element) {
            return [];
        }

        try {
            const result = await this.apiClient.getPlans();
            if (result.code === 200) {
                return result.data.map(plan => 
                    new PlanTreeItem(plan, vscode.TreeItemCollapsibleState.None)
                );
            } else {
                return [];
            }
        } catch (error: any) {
            return [];
        }
    }
}
