import winston from "winston";
const { combine, errors, json } = winston.format;
export const logger = winston.createLogger({
  level: "debug",
  format: combine(errors({ stack: true }), json()),
  transports: [new winston.transports.Console()],
});
