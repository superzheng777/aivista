import type { ColumnType, Generated } from "kysely";

type DbDate = ColumnType<Date, Date | string, Date | string>;

export interface DatabaseSchema {
  generation_tasks: GenerationTaskTable;
  image_assets: ImageAssetTable;
  generation_task_input_assets: GenerationTaskInputAssetTable;
  user_generation_daily_usage: UserGenerationDailyUsageTable;
  outbox_events: OutboxEventTable;
  generation_worker_executions: GenerationWorkerExecutionTable;
  agent_worker_executions: AgentWorkerExecutionTable;
}
export interface GenerationTaskTable {
  id:Generated<bigint>; user_id:bigint; session_id:bigint; creation_task_id:bigint; operation:string; model:string;
  status:string; task_version:Generated<number>; attempt_count:number;
  final_prompt:string; final_negative_prompt:string|null; width:number; height:number; prompt_extend:boolean;
  requested_image_count:number; completed_image_count:number; quota_refunded_at:DbDate|null;
  provider_request_id:string|null;
  failure_code:string|null; created_at:ColumnType<Date,Date|string|undefined,Date|string>;
  updated_at:ColumnType<Date,Date|string|undefined,Date|string>; completed_at:DbDate|null;
}

export interface ImageAssetTable {
  id:Generated<bigint>; user_id:bigint; origin:string; lifecycle:string; origin_task_id:bigint|null;
  source_index:number|null; object_key:string; original_object_key:string; content_type:string;
  file_size:bigint; width:number; height:number; is_favorited:boolean; deleted_at:DbDate|null;
  expires_at:DbDate|null; oss_cleanup_status:string|null; oss_cleanup_attempt_count:number;
  oss_cleanup_available_at:DbDate|null; oss_cleanup_last_error:string|null;
  created_at:ColumnType<Date,Date|string|undefined,Date|string>;
}

export interface GenerationTaskInputAssetTable {task_id:bigint;asset_id:bigint;source_index:number;created_at:ColumnType<Date,Date|string|undefined,Date|string>}
export interface UserGenerationDailyUsageTable {user_id:bigint;usage_date:string;requested_image_count:number;updated_at:DbDate}
export interface OutboxEventTable {
  id:Generated<bigint>;event_type:string;aggregate_type:string;aggregate_id:bigint;aggregate_version:bigint;
  payload_json:string|null;status:string;retry_count:number;available_at:DbDate;locked_at:DbDate|null;
  published_at:DbDate|null;last_error:string|null;created_at:ColumnType<Date,Date|string|undefined,Date|string>;updated_at:DbDate;
}
export interface GenerationWorkerExecutionTable {
  task_id: bigint; phase: string; task_version: number; state: string; result_json: string | null;
  created_at: ColumnType<Date, Date | string | undefined, Date | string>;
  updated_at: DbDate;
}
export interface AgentWorkerExecutionTable {
  creation_task_id: bigint;
  state: string;
  result_json: string | null;
  started_at: DbDate;
  completed_at: DbDate | null;
  updated_at: DbDate;
}
