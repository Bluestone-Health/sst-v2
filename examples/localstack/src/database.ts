import { RDSData } from "@aws-sdk/client-rds-data";
import { Kysely } from "kysely";
import { DataApiDialect } from "kysely-data-api";
import { RDSv2 } from "sst/node/rds";

export const target = {
  resourceArn: RDSv2.Database.clusterArn,
  secretArn: RDSv2.Database.secretArn,
  database: RDSv2.Database.defaultDatabaseName,
};
export const client = new RDSData({});
export const db = new Kysely<{
  items: { id: string; marker: string; source: string };
}>({
  dialect: new DataApiDialect({
    mode: "postgres",
    driver: { ...target, client },
  }),
});
