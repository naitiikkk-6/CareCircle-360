/**
 * CareCircle 360 - Structured Application Logger
 */

export const logger = {
  info: (...args) => {
    console.info(...args);
  },
  warn: (...args) => {
    console.warn(...args);
  },
  error: (...args) => {
    console.error(...args);
  }
};
