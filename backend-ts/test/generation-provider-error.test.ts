import { describe, expect, it } from "vitest";
import { BailianProviderError, providerFailureCode } from "../src/generation/generation-provider-error.js";

describe("generation provider error mapping", () => {
  it.each([
    [400, "DataInspectionFailed", "PROVIDER_CONTENT_REJECTED"],
    [429, "Throttling", "PROVIDER_RATE_LIMITED"],
    [429, "Throttling.RateQuota", "PROVIDER_RATE_LIMITED"],
    [429, "Throttling.BurstRate", "PROVIDER_RATE_LIMITED"],
    [429, "Throttling.AllocationQuota", "PROVIDER_QUOTA_UNAVAILABLE"],
    [400, "CommodityNotPurchased", "PROVIDER_QUOTA_UNAVAILABLE"],
    [503, "InternalError", "PROVIDER_SERVICE_UNAVAILABLE"],
    [401, "InvalidApiKey", "PROVIDER_CONFIGURATION_ERROR"],
    [409, "Unknown", "PROVIDER_CALL_OUTCOME_UNKNOWN"],
  ] as const)("maps HTTP %i / %s", (status, providerCode, expected) => {
    const error = new BailianProviderError(status, providerCode, "request-1", "provider detail");
    expect(providerFailureCode(error)).toBe(expected);
  });
});
