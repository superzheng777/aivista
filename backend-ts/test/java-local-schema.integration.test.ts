import { readFile } from "node:fs/promises";
import { createConnection, type RowDataPacket } from "mysql2/promise";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";

const localYaml = process.env.AIVISTA_JAVA_LOCAL_YAML;
const run = localYaml ? describe : describe.skip;

run("Java local MySQL compatibility", () => {
  it("reads the migrated schema needed by the current TypeScript slices without mutation", async () => {
    const config = parse(await readFile(localYaml!, "utf8"));
    const source = config.spring.datasource as { url:string; username:string; password:string };
    const url = new URL(resolveSpringValue(source.url).replace(/^jdbc:/, ""));
    const connection = await createConnection({host:url.hostname,port:Number(url.port||3306),database:url.pathname.slice(1),user:resolveSpringValue(source.username),password:resolveSpringValue(source.password),supportBigNumbers:true,bigNumberStrings:true});
    try {
      const [versions] = await connection.query<(RowDataPacket&{version:string})[]>("SELECT version FROM flyway_schema_history WHERE success=1 ORDER BY installed_rank DESC LIMIT 1");
      expect(versions[0]?.version).toBe("18");
      const requiredTables=["generation_tasks","image_assets","generation_task_input_assets","user_generation_daily_usage","outbox_events","generation_worker_executions"];
      const [tables] = await connection.query<(RowDataPacket&{TABLE_NAME:string})[]>("SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (?)",[requiredTables]);
      expect(new Set(tables.map(r=>r.TABLE_NAME))).toEqual(new Set(requiredTables));
      const [taskColumns]=await connection.query<(RowDataPacket&{COLUMN_NAME:string})[]>("SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='generation_tasks'");
      const taskColumnNames=new Set(taskColumns.map(r=>r.COLUMN_NAME));
      for(const name of ["creation_task_id","status","task_version","attempt_count","final_prompt","final_negative_prompt","prompt_extend","requested_image_count","completed_image_count","failure_code","completed_at"]) expect(taskColumnNames.has(name)).toBe(true);
      expect(taskColumnNames.has("idempotency_key")).toBe(false);
      expect(taskColumnNames.has("request_fingerprint")).toBe(false);
      const [outboxColumns]=await connection.query<(RowDataPacket&{COLUMN_NAME:string})[]>("SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='outbox_events'");
      const outboxColumnNames=new Set(outboxColumns.map(r=>r.COLUMN_NAME));
      for(const name of ["event_type","aggregate_type","aggregate_id","aggregate_version","payload_json","status","retry_count","available_at","published_at"]) expect(outboxColumnNames.has(name)).toBe(true);
    } finally { await connection.end(); }
  });
});

function resolveSpringValue(value:string):string {
  const match=value.match(/^\$\{([^:}]+):([\s\S]*)\}$/);
  if(!match) return value;
  return process.env[match[1]!] ?? match[2]!;
}
