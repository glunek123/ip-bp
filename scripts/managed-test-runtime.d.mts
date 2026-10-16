export type ManagedTestMode = 'api' | 'ui';

export interface ManagedTestLayout {
  root: string;
  cwd: string;
  mode: ManagedTestMode;
  origin: string;
  baseURL: string;
  apiProxyTarget?: string;
  webServer: Array<{
    cwd: string;
    url: string;
    reuseExistingServer: false;
  }>;
}

export function planManagedTestRuntime(layout: ManagedTestLayout): Readonly<{
  cwd: string;
  mode: ManagedTestMode;
  origin: string;
  baseURL: string;
}>;

export interface StoppedR2Input {
  target: {
    hostname: string;
    username: string;
    database: string;
    port: number;
  };
  binding: { project: string; containerId: string };
  container: {
    Id: string;
    Name: string;
    Image: string;
    Config: {
      Image: string;
      Labels: Record<string, string>;
      Env: string[];
    };
    HostConfig: {
      PortBindings: Record<string, Array<{ HostIp: string; HostPort: string }>>;
      Tmpfs?: Record<string, string>;
    };
    NetworkSettings?: {
      Ports?: Record<
        string,
        Array<{ HostIp: string; HostPort: string }> | null
      >;
    };
    Mounts: Array<{
      Destination: string;
      Type: string;
      Name: string;
      RW: boolean;
    }>;
    State: { Running: boolean };
  };
}

export function admitStoppedTestContainer(input: StoppedR2Input): Readonly<{
  containerId: string;
  project: string;
  port: number;
  volume: string;
}>;

export function planStoppedTestContainerStart(input: StoppedR2Input): Readonly<{
  command: 'docker';
  args: readonly ['start', string];
  containerId: string;
  requiresE2eResourceLock: true;
  requiresHealthyCapture: true;
}>;
