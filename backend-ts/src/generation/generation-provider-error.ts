export type GenerationFailureCode =
  | "QUEUE_DELIVERY_FAILED" | "QUEUE_TIMEOUT" | "QUEUE_CONSUMPTION_FAILED"
  | "PROVIDER_CALL_OUTCOME_UNKNOWN" | "PROVIDER_CONNECTION_FAILED" | "PROVIDER_RATE_LIMITED"
  | "PROVIDER_SERVICE_UNAVAILABLE" | "PROVIDER_QUOTA_UNAVAILABLE" | "PROVIDER_CONTENT_REJECTED"
  | "PROVIDER_CONFIGURATION_ERROR" | "IMAGE_TRANSFER_PARTIAL_FAILURE" | "IMAGE_TRANSFER_FAILED";

/** 百炼已明确返回的 HTTP/业务错误。原始文案只用于服务端日志。 */
export class BailianProviderError extends Error {
  constructor(
    readonly httpStatus: number,
    readonly providerCode: string | null,
    readonly requestId: string | null,
    message: string,
  ) { super(message); this.name = "BailianProviderError"; }
}

/** 能确认 HTTP 请求尚未发出时的建连失败。 */
export class BailianConnectionError extends Error {
  constructor(readonly cause: unknown) { super("Bailian connection failed", { cause }); this.name = "BailianConnectionError"; }
}

export function providerFailureCode(error: BailianProviderError): GenerationFailureCode {
  if (error.providerCode === "DataInspectionFailed") return "PROVIDER_CONTENT_REJECTED";
  if (error.providerCode === "Throttling" || error.providerCode === "Throttling.RateQuota"
    || error.providerCode === "Throttling.BurstRate") return "PROVIDER_RATE_LIMITED";
  if (error.providerCode === "Throttling.AllocationQuota" || error.providerCode === "CommodityNotPurchased") {
    return "PROVIDER_QUOTA_UNAVAILABLE";
  }
  if (error.httpStatus >= 500) return "PROVIDER_SERVICE_UNAVAILABLE";
  if ([400, 401, 403, 404].includes(error.httpStatus)) return "PROVIDER_CONFIGURATION_ERROR";
  return "PROVIDER_CALL_OUTCOME_UNKNOWN";
}
