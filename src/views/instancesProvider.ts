import * as vscode from 'vscode';
import { EphemeraAPIClient, EphemeraInstance } from '../api/client';

export class InstanceTreeItem extends vscode.TreeItem {
    constructor(
        public readonly instance: EphemeraInstance,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState
    ) {
        super(instance.hostname, collapsibleState);
        
        this.tooltip = this.getTooltip();
        this.description = this.getShortDescription();
        this.contextValue = 'instance';
        this.iconPath = this.getIcon();
    }

    private getShortDescription(): string {
        const i = this.instance;
        // 计算剩余时间
        const expDate = new Date(i.expiration_at);
        const now = new Date();
        const diffMs = expDate.getTime() - now.getTime();
        const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
        
        let timeLeftStr = '';
        if (diffHours < 0) {
            timeLeftStr = '已过期';
        } else if (diffHours < 24) {
            timeLeftStr = `${diffHours}h`;
        } else {
            timeLeftStr = `${Math.floor(diffHours / 24)}d`;
        }

        return `${i.ipv4} | ${i.plan} | ${timeLeftStr}`;
    }

    private getIcon(): vscode.ThemeIcon {
        const status = this.instance.status.toLowerCase();
        switch (status) {
            case 'active':
                return new vscode.ThemeIcon('circle-filled', new vscode.ThemeColor('debugIcon.startForeground'));
            case 'stopped':
                return new vscode.ThemeIcon('circle-outline', new vscode.ThemeColor('debugIcon.stopForeground'));
            case 'suspending':
                return new vscode.ThemeIcon('warning', new vscode.ThemeColor('charts.orange'));
            default:
                return new vscode.ThemeIcon('question', new vscode.ThemeColor('disabledForeground'));
        }
    }

    private getTooltip(): string {
        const i = this.instance;
        return `ID: ${i.id}
主机名: ${i.hostname}
IPv4: ${i.ipv4}
IPv6: ${i.ipv6}
套餐: ${i.plan}
操作系统: ${i.os}
区域: ${i.region}
CPU: ${i.cpu} 核 ${i.cpu_name}
内存: ${i.memory} MB
磁盘: ${i.disk} GB ${i.disk_type}
状态: ${i.status}
创建时间: ${i.creation_at}
到期时间: ${i.expiration_at}`;
    }
}

export class InstancesProvider implements vscode.TreeDataProvider<InstanceTreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<InstanceTreeItem | undefined | null | void> = 
        new vscode.EventEmitter<InstanceTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<InstanceTreeItem | undefined | null | void> = 
        this._onDidChangeTreeData.event;

    constructor(private apiClient: EphemeraAPIClient) {}

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: InstanceTreeItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: InstanceTreeItem): Promise<InstanceTreeItem[]> {
        if (!this.apiClient.hasCredentials()) {
            vscode.window.showInformationMessage('请先设置 Ephemera API 凭据', '设置').then(selection => {
                if (selection === '设置') {
                    vscode.commands.executeCommand('ephemera.setCredentials');
                }
            });
            return [];
        }

        if (element) {
            return [];
        }

        try {
            const result = await this.apiClient.listInstances();
            if (result.code === 200) {
                return result.data.map(instance => 
                    new InstanceTreeItem(instance, vscode.TreeItemCollapsibleState.None)
                );
            } else {
                vscode.window.showErrorMessage(`获取实例列表失败: ${result.message}`);
                return [];
            }
        } catch (error: any) {
            vscode.window.showErrorMessage(`获取实例列表出错: ${error.message}`);
            return [];
        }
    }
}
