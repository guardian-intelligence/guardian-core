import path from 'path';
import { Context, Layer } from 'effect';

export interface AppConfigShape {
  readonly assistantName: string;
  readonly pollInterval: number;
  readonly schedulerPollInterval: number;
  readonly projectRoot: string;
  readonly homeDir: string;
  readonly mountAllowlistPath: string;
  readonly storeDir: string;
  readonly groupsDir: string;
  readonly dataDir: string;
  readonly mainGroupFolder: string;
  readonly containerImage: string;
  readonly containerTimeout: number;
  readonly containerMaxOutputSize: number;
  readonly ipcPollInterval: number;
  readonly timezone: string;
}

export class AppConfig extends Context.Tag('AppConfig')<
  AppConfig,
  AppConfigShape
>() {}

export const AppConfigLive = Layer.succeed(AppConfig, {
  assistantName: process.env.ASSISTANT_NAME || 'Andy',
  pollInterval: 2000,
  schedulerPollInterval: 60000,
  projectRoot: process.cwd(),
  homeDir: process.env.HOME || '/Users/user',
  get mountAllowlistPath() {
    return path.join(
      this.homeDir,
      '.config',
      'guardian-core',
      'mount-allowlist.json',
    );
  },
  get storeDir() {
    return path.resolve(this.projectRoot, 'store');
  },
  get groupsDir() {
    return path.resolve(this.projectRoot, 'groups');
  },
  get dataDir() {
    return path.resolve(this.projectRoot, 'data');
  },
  mainGroupFolder: 'main',
  containerImage: process.env.CONTAINER_IMAGE || 'guardian-core-agent:latest',
  containerTimeout: parseInt(process.env.CONTAINER_TIMEOUT || '300000', 10),
  containerMaxOutputSize: parseInt(
    process.env.CONTAINER_MAX_OUTPUT_SIZE || '10485760',
    10,
  ),
  ipcPollInterval: 1000,
  timezone:
    process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone,
});
