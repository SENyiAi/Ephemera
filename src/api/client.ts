import axios, { AxiosInstance, AxiosResponse } from 'axios';

export interface EphemeraCredentials { clientId: string; secret: string; }
export interface EphemeraInstance {
    id: number; uid: string; hostname: string; ipv4: string; ipv6: string; password: string; user: string; status: string;
    cpu: number; memory: number; disk: string; plan: string; plan_id: number; os: string; region: string;
    creation_at: string; expiration_at: string; cpu_name: string; disk_type: string;
    state?: { cpu: number; memory?: { memtotal: number; memavailable: number; } };
}
export interface EphemeraPlan { id: number; name: string; cpu: number; memory: number; disk: number; disk_type: string; cpu_name: string; show_speed: string; stock: number; gpu?: string; }
export interface EphemeraOS { id: number; name: string; port: number; username: string; }
export interface EphemeraOSGroup { group_id: number; group_name: string; logo: string; os_list: EphemeraOS[]; }
export interface CommandResult { status: string; result?: string; output?: string; }

export class EphemeraAPIClient {
    private client: AxiosInstance;
    private credentials: EphemeraCredentials | null = null;

    constructor(baseURL: string = 'https://app.alice.ws') {
        this.client = axios.create({ baseURL, timeout: 30000, headers: { 'Content-Type': 'application/json' } });
        this.client.interceptors.response.use(
            (res) => res,
            (err) => {
                const msg = err.response?.data?.message || err.message;
                return Promise.reject(new Error(msg));
            }
        );
    }

    setCredentials(cred: EphemeraCredentials) {
        this.credentials = cred;
        this.client.defaults.headers.common['Authorization'] = `Bearer ${cred.clientId}:${cred.secret}`;
    }

    hasCredentials(): boolean { return !!this.credentials; }

    private async request<T>(method: 'get' | 'post' | 'delete', path: string, data?: any): Promise<{ code: number; data: T; message: string }> {
        const res: AxiosResponse = await this.client.request({ method, url: path, data });
        return res.data;
    }

    getPlans() { return this.request<EphemeraPlan[]>('get', '/cli/v1/evo/plans'); }
    getOSImages(planId: number) { return this.request<EphemeraOSGroup[]>('get', `/cli/v1/evo/plans/${planId}/os-images`); }
    deployInstance(params: any) { return this.request<EphemeraInstance>('post', '/cli/v1/evo/instances/deploy', params); }
    listInstances() { return this.request<EphemeraInstance[]>('get', '/cli/v1/evo/instances'); }
    deleteInstance(id: number) { return this.request<any>('delete', `/cli/v1/evo/instances/${id}`); }
    powerOperation(id: number, action: string) { return this.request<any>('post', `/cli/v1/evo/instances/${id}/power`, { action }); }
    rebuildInstance(id: number, params: any) { return this.request<any>('post', `/cli/v1/evo/instances/${id}/rebuild`, params); }
    renewInstance(id: number, hours: number) { return this.request<any>('post', `/cli/v1/evo/instances/${id}/renewals`, { time: hours }); }
    
    async executeCommand(id: number, command: string) {
        const encoded = Buffer.from(command).toString('base64');
        return this.request<{ command_uid: string }>('post', `/cli/v1/evo/instances/${id}/exec`, { command: encoded });
    }

    getCommandResult(id: number, uid: string) { return this.request<CommandResult>('get', `/cli/v1/evo/instances/${id}/exec/${uid}`); }

    async runCommandAndWait(id: number, cmd: string, timeout: number = 30000): Promise<string> {
        const { data: { command_uid } } = await this.executeCommand(id, cmd);
        const start = Date.now();
        while (Date.now() - start < timeout) {
            const { data: res } = await this.getCommandResult(id, command_uid);
            if (res.status === 'fetched') return Buffer.from(res.output || '', 'base64').toString();
            await new Promise(r => setTimeout(r, 1000));
        }
        throw new Error('Command timeout');
    }
}
