import pino from 'pino';
import { SERVER } from '../config/environment';

// Create a logger instance
const logger = pino({
  level: SERVER.LOG_LEVEL,
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: SERVER.NODE_ENV === 'development',
      translateTime: 'SYS:standard',
      ignore: 'pid,hostname',
    },
  },
  base: {
    env: SERVER.NODE_ENV,
  },
});

/**
 * Creates a child logger with component name and optional context
 */
export const createLogger = (component: string, context: Record<string, any> = {}) => {
  return logger.child({
    component,
    ...context,
  });
};

/**
 * Creates a request-scoped logger with a trace ID
 */
export const createRequestLogger = (traceId: string, component: string) => {
  return logger.child({
    traceId,
    component,
  });
};

export default logger;