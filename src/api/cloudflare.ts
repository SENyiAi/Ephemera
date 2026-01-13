import axios from 'axios';
import * as vscode from 'vscode';

export class CloudflareClient {
    private token: string | undefined;

    constructor(private context: vscode.ExtensionContext) {}

    async getToken(): Promise<string | undefined> {
        if (!this.token) {
            this.token = await this.context.secrets.get('ephemera.cloudflareToken');
        }
        return this.token;
    }

    async setToken(token: string) {
        this.token = token;
        await this.context.secrets.store('ephemera.cloudflareToken', token);
    }

    async updateDnsRecord(zoneId: string, domain: string, subdomain: string, ip: string) {
        const token = await this.getToken();
        if (!token) throw new Error('Cloudflare Token 未配置');

        const client = axios.create({
            baseURL: 'https://api.cloudflare.com/client/v4',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });

        const fullDomain = subdomain ? `${subdomain}.${domain}` : domain;

        // 1. 查找是否存在记录
        const listRes = await client.get(`/zones/${zoneId}/dns_records`, {
            params: { name: fullDomain, type: 'A' }
        });

        const records = listRes.data.result;
        if (records && records.length > 0) {
            // 2. 更新
            const recordId = records[0].id;
            await client.put(`/zones/${zoneId}/dns_records/${recordId}`, {
                type: 'A',
                name: fullDomain,
                content: ip,
                ttl: 1,
                proxied: false
            });
        } else {
            // 2. 创建
            await client.post(`/zones/${zoneId}/dns_records`, {
                type: 'A',
                name: fullDomain,
                content: ip,
                ttl: 1,
                proxied: false
            });
        }
    }
}
