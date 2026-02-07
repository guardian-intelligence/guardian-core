import { Layer, Logger, LogLevel } from 'effect';

import { logger as pinoLogger } from './logger.js';

type LogLevelLiteral = Parameters<typeof LogLevel.fromLiteral>[0];

const PinoLogLevel: Record<string, string> = {
  All: 'trace',
  Trace: 'trace',
  Debug: 'debug',
  Info: 'info',
  Warning: 'warn',
  Error: 'error',
  Fatal: 'fatal',
  None: 'silent',
};

const PinoLogger = Logger.make(({ logLevel, message }) => {
  const level = PinoLogLevel[logLevel.label] ?? 'info';
  const msg = typeof message === 'string' ? message : JSON.stringify(message);
  const fn = (pinoLogger as unknown as Record<string, (m: string) => void>)[
    level
  ];
  fn?.(msg);
});

export const AppLoggerLive = Layer.merge(
  Logger.replace(Logger.defaultLogger, PinoLogger),
  Logger.minimumLogLevel(
    LogLevel.fromLiteral(
      (process.env.LOG_LEVEL ?? 'Info') as LogLevelLiteral,
    ),
  ),
);
