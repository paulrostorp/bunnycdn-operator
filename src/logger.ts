import winston from "winston";
const { combine, errors, simple } = winston.format;
export const logger = winston.createLogger({
  level: "debug",
  format: combine(errors({ stack: true }), simple()),
  transports: [new winston.transports.Console()],
});
