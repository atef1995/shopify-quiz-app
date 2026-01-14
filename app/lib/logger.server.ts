/**
 * Production-Ready Logger Utility
 *
 * Provides structured logging with different levels and environment awareness.
 * In production, only warnings and errors are logged.
 * In development, all levels are logged.
 *
 * Usage:
 *   import { logger } from "~/lib/logger.server";
 *   logger.info("Quiz created", { quizId: "123", shop: "store.myshopify.com" });
 *   logger.error("Failed to fetch products", error, { quizId: "123" });
 */

type LogLevel = "debug" | "info" | "warn" | "error";

interface LogContext {
  [key: string]: unknown;
}

// Determine environment
const isDevelopment = process.env.NODE_ENV === "development";
const isTest = process.env.NODE_ENV === "test";

// Log level hierarchy (lower number = more verbose)
const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

// Minimum log level based on environment
// In production: only warn and error
// In development: all levels
const MIN_LOG_LEVEL: LogLevel = isDevelopment ? "debug" : "warn";

/**
 * Format log message with timestamp and context
 */
function formatLogMessage(
  level: LogLevel,
  message: string,
  context?: LogContext,
): string {
  const timestamp = new Date().toISOString();
  const contextStr = context ? ` ${JSON.stringify(context)}` : "";
  return `[${timestamp}] [${level.toUpperCase()}] ${message}${contextStr}`;
}

/**
 * Check if a log level should be output based on current environment
 */
function shouldLog(level: LogLevel): boolean {
  if (isTest) return false; // Suppress logs in tests
  return LOG_LEVELS[level] >= LOG_LEVELS[MIN_LOG_LEVEL];
}

/**
 * Sanitize context to remove sensitive data
 */
function sanitizeContext(context?: LogContext): LogContext | undefined {
  if (!context) return undefined;

  const sanitized = { ...context };

  // List of keys that should be redacted
  const sensitiveKeys = [
    "password",
    "secret",
    "token",
    "apiKey",
    "api_key",
    "accessToken",
    "access_token",
    "authorization",
    "cookie",
    "session",
  ];

  for (const key of Object.keys(sanitized)) {
    const lowerKey = key.toLowerCase();
    if (sensitiveKeys.some((sensitive) => lowerKey.includes(sensitive))) {
      sanitized[key] = "[REDACTED]";
    }
  }

  return sanitized;
}

/**
 * Extract error information safely
 */
function extractErrorInfo(error: unknown): LogContext {
  if (error instanceof Error) {
    return {
      errorName: error.name,
      errorMessage: error.message,
      // Only include stack in development
      ...(isDevelopment && { stack: error.stack }),
    };
  }
  return { errorValue: String(error) };
}

export const logger = {
  /**
   * Debug level - verbose development logging
   * Only shown in development
   */
  debug(message: string, context?: LogContext): void {
    if (shouldLog("debug")) {
      console.debug(formatLogMessage("debug", message, sanitizeContext(context)));
    }
  },

  /**
   * Info level - general operational logging
   * Only shown in development
   */
  info(message: string, context?: LogContext): void {
    if (shouldLog("info")) {
      console.info(formatLogMessage("info", message, sanitizeContext(context)));
    }
  },

  /**
   * Warn level - potential issues that don't break functionality
   * Shown in all environments
   */
  warn(message: string, context?: LogContext): void {
    if (shouldLog("warn")) {
      console.warn(formatLogMessage("warn", message, sanitizeContext(context)));
    }
  },

  /**
   * Error level - errors that need attention
   * Shown in all environments
   */
  error(message: string, error?: unknown, context?: LogContext): void {
    if (shouldLog("error")) {
      const errorInfo = error ? extractErrorInfo(error) : {};
      const fullContext = { ...sanitizeContext(context), ...errorInfo };
      console.error(formatLogMessage("error", message, fullContext));
    }
  },

  /**
   * Create a child logger with preset context
   * Useful for adding shop/quiz context to all logs in a request
   */
  child(baseContext: LogContext) {
    return {
      debug: (message: string, context?: LogContext) =>
        logger.debug(message, { ...baseContext, ...context }),
      info: (message: string, context?: LogContext) =>
        logger.info(message, { ...baseContext, ...context }),
      warn: (message: string, context?: LogContext) =>
        logger.warn(message, { ...baseContext, ...context }),
      error: (message: string, error?: unknown, context?: LogContext) =>
        logger.error(message, error, { ...baseContext, ...context }),
    };
  },

  /**
   * Log webhook events with standard format
   */
  webhook(topic: string, shop: string, action: string, context?: LogContext): void {
    logger.info(`[Webhook] ${topic}: ${action}`, { shop, topic, ...context });
  },

  /**
   * Log API requests with standard format
   */
  api(method: string, path: string, context?: LogContext): void {
    logger.debug(`[API] ${method} ${path}`, context);
  },

  /**
   * Log billing events
   */
  billing(action: string, shop: string, context?: LogContext): void {
    logger.info(`[Billing] ${action}`, { shop, ...context });
  },
};

export default logger;
