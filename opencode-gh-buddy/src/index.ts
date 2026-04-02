import { logger } from "./utils/logger.ts";
import { startDaemon } from "./startDaemon.ts";

void startDaemon().catch((error: any) => {
  logger.error("Daemon failed", { error: error.message });
  process.exit(1);
});
