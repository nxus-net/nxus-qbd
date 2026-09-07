import dotenv from "dotenv";

const envFile =
  process.env.NXUS_ENV_FILE ??
  (process.env.NXUS_DEV_MODE === "true" ? ".env.dev" : ".env");

dotenv.config({ path: envFile });
