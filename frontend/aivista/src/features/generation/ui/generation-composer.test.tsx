import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { GenerationComposer } from "@/features/generation/ui/generation-composer";
import { createGenerationTask } from "@/features/generation/api/generation-api";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/features/auth/model/auth-dialog-provider", () => ({ useAuthDialog: () => ({ open: vi.fn() }) }));
vi.mock("@/features/auth/model/session-provider", () => ({
  useSession: () => ({ status: "authenticated", user: { id: "user-1" } }),
}));
vi.mock("@/features/generation/model/generation-event-stream-provider", () => ({
  useGenerationEventStream: () => ({ ensureReady: vi.fn().mockResolvedValue(true) }),
}));
vi.mock("@/shared/api/use-user-agreement-consent", () => ({
  useUserAgreementConsent: () => ({
    consentQuery: { isLoading: false, isError: false, data: { consented: true } },
    confirmConsent: { isPending: false, error: null, mutate: vi.fn() },
  }),
}));
vi.mock("@/features/generation/ui/generation-reference-images", () => ({
  GenerationReferenceImages: () => null,
  GenerationReferenceImagePicker: () => null,
}));
vi.mock("@/components/ui/user-agreement-consent-dialog", () => ({ UserAgreementConsentDialog: () => null }));
vi.mock("@/features/generation/api/generation-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/features/generation/api/generation-api")>();
  return { ...actual, createGenerationTask: vi.fn() };
});

describe("GenerationComposer", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    vi.mocked(createGenerationTask).mockReset();
  });

  it("does not mistake a submission from the current page for a request that needs recovery", async () => {
    vi.mocked(createGenerationTask).mockImplementation(() => new Promise(() => undefined));
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={queryClient}><GenerationComposer sessionId="session-1" /></QueryClientProvider>);

    await waitFor(() => expect(window.sessionStorage.getItem("aivista.pending-generation-submission")).toBeNull());
    fireEvent.change(screen.getByLabelText("创作提示"), { target: { value: "一座山" } });
    fireEvent.submit(screen.getByRole("button", { name: "开始生成" }).closest("form")!);

    await waitFor(() => expect(createGenerationTask).toHaveBeenCalledTimes(1));
    await Promise.resolve();
    expect(screen.queryByText("检测到未确认的生成请求，正在恢复任务状态。")).not.toBeInTheDocument();
  });
});
