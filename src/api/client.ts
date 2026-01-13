import axios, { AxiosInstance } from 'axios';

export interface EphemeraCredentials {
    clientId: string;
    secret: string;
}

export interface EphemeraInstance {
    id: number;
    uid: string;
    hostname: string;
    ipv4: string;
    ipv6: string;
    password: string;
    user: string;
    status: string;
    cpu: number;
    memory: number;
    disk: string;
    plan: string;
    plan_id: number;
    os: string;
    region: string;
    creation_at: string;
    expiration_at: string;
    cpu_name: string;
    disk_type: string;
}

export interface EphemeraPlan {
    id: number;
    name: string;
    cpu: number;
    memory: number;
    disk: number;
    disk_type: string;
    cpu_name: string;
    show_speed: string;
    stock: number;
    gpu?: string;
}

export interface EphemeraOS {
    id: number;
    name: string;
    port: number;
    username: string;
}

export interface EphemeraOSGroup {
    group_id: number;
    group_name: string;
    logo: string;
    os_list: EphemeraOS[];
}

export interface InstanceState {
    cpu: number;
    memory: number;
    disk: number;
    state: {
        state: string;
        cpu: number;
        memory: {
            memtotal: number;
            memfree: number;
            memavailable: number;
        };
        traffic: {
            in: number;
            out: number;
            total: number;
        };
    };
    ipv4: Array<{
        address: string;
        gateway: string;
        netmask: string;
    }>;
    ipv6: Array<{
        subnet: string;
        addresses: string[];
    }>;
}

export interface CommandResult {
    status: string; // pending, running, fetched
    result?: string; // success, error
    output?: string; // Base64 encoded
}

export class EphemeraAPIClient {
    private client: AxiosInstance;
    private credentials: EphemeraCredentials | null = null;

    constructor(baseURL: string = 'https://app.alice.ws') {
        this.client = axios.create({
            baseURL,
            timeout: 30000,
            headers: {
                'Content-Type': 'application/json'
            }
        });
    }

    setCredentials(credentials: EphemeraCredentials) {
        this.credentials = credentials;
        this.client.defaults.headers.common['Authorization'] = 
            `Bearer ${credentials.clientId}:${credentials.secret}`;
    }

    clearCredentials() {
        this.credentials = null;
        delete this.client.defaults.headers.common['Authorization'];
    }

    hasCredentials(): boolean {
        return this.credentials !== null;
    }

    // Account APIs
    async getUserProfile() {
        const response = await this.client.get('/cli/v1/account/profile');
        return response.data;
    }

    async getSSHKeys() {
        const response = await this.client.get('/cli/v1/account/ssh-keys');
        return response.data;
    }

    // EVO Instance APIs
    async getPermissions() {
        const response = await this.client.get('/cli/v1/evo/permissions');
        return response.data;
    }

    async getPlans(): Promise<{ code: number; data: EphemeraPlan[]; message: string }> {
        const response = await this.client.get('/cli/v1/evo/plans');
        return response.data;
    }

    async getOSImages(planId: number): Promise<{ code: number; data: EphemeraOSGroup[]; message: string }> {
        const response = await this.client.get(`/cli/v1/evo/plans/${planId}/os-images`);
        return response.data;
    }

    async deployInstance(params: {
        product_id: number;
        os_id: number;
        time: number;
        ssh_key_id?: number | null;
        boot_script?: string | null;
    }): Promise<{ code: number; data: EphemeraInstance; message: string }> {
        const response = await this.client.post('/cli/v1/evo/instances/deploy', params);
        return response.data;
    }

    async listInstances(): Promise<{ code: number; data: EphemeraInstance[]; message: string }> {
        const response = await this.client.get('/cli/v1/evo/instances');
        return response.data;
    }

    async deleteInstance(instanceId: number) {
        const response = await this.client.delete(`/cli/v1/evo/instances/${instanceId}`);
        return response.data;
    }

    async getInstanceState(instanceId: number): Promise<{ code: number; data: InstanceState; message: string | null }> {
        const response = await this.client.get(`/cli/v1/evo/instances/${instanceId}/state`);
        return response.data;
    }

    async powerOperation(instanceId: number, action: 'boot' | 'shutdown' | 'restart' | 'poweroff') {
        const response = await this.client.post(`/cli/v1/evo/instances/${instanceId}/power`, { action });
        return response.data;
    }

    async rebuildInstance(instanceId: number, params: {
        os_id: number;
        ssh_key_id?: number | null;
        boot_script?: string | null;
    }) {
        const response = await this.client.post(`/cli/v1/evo/instances/${instanceId}/rebuild`, params);
        return response.data;
    }

    async renewInstance(instanceId: number, hours: number) {
        const response = await this.client.post(`/cli/v1/evo/instances/${instanceId}/renewals`, { time: hours });
        return response.data;
    }

    async executeCommand(instanceId: number, command: string): Promise<{ code: number; data: { command_uid: string }; message: string }> {
        // Encode command to base64
        const encodedCommand = Buffer.from(command).toString('base64');
        const response = await this.client.post(`/cli/v1/evo/instances/${instanceId}/exec`, { 
            command: encodedCommand 
        });
        return response.data;
    }

    async getCommandResult(instanceId: number, commandUid: string): Promise<{ code: number; data: CommandResult; message: string }> {
        const response = await this.client.get(`/cli/v1/evo/instances/${instanceId}/exec/${commandUid}`);
        return response.data;
    }

    async runCommandAndWait(instanceId: number, command: string, timeoutMs: number = 10000): Promise<string> {
        const deployRes = await this.executeCommand(instanceId, command);
        if (deployRes.code !== 200) throw new Error(deployRes.message);
        const uid = deployRes.data.command_uid;
        
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
            const res = await this.getCommandResult(instanceId, uid);
            if (res.data.status === 'fetched') {
                return Buffer.from(res.data.output || '', 'base64').toString();
            }
            await new Promise(r => setTimeout(r, 1000));
        }
        throw new Error('Command timed out');
    }
}
