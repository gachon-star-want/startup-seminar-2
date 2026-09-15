import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import * as schema from "./schema";

export function getDb(databaseUrl: string) {
  return drizzle(neon(databaseUrl), { schema });
}

export type DB = ReturnType<typeof getDb>;
