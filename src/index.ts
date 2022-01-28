import { logger } from "./logger";
import { BunnyOperator } from "./operator";

const operator = new BunnyOperator(logger);

operator
  .start()
  .then(() => {
    logger.debug("Operator started");
  })
  .catch(e => logger.error("Failed to start operator", e));

const exit = (reason: string): void => {
  logger.debug("Shutting down, " + reason);
  operator.stop();
  process.exit(0);
};

process.on("SIGTERM", () => exit("SIGTERM")).on("SIGINT", () => exit("SIGINT"));
