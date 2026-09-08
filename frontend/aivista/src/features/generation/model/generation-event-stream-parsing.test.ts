import { describe, expect, it, vi } from "vitest";

import {
  consumeSseStream,
  isPublicationStatusUpdateEvent,
  isTaskUpdateEvent,
  isTerminalStatus,
  parseSseBlock,
  reconnectDelayMs,
} from "@/features/generation/model/generation-event-stream-parsing";

describe("parseSseBlock", () => {
  it("解析事件名与单行 data", () => {
    expect(parseSseBlock("event: publication.updated\ndata: {\"imageId\":\"img-1\"}")).toEqual({
      eventName: "publication.updated",
      data: '{"imageId":"img-1"}',
    });
  });

  it("多行 data 以换行拼接,没有 data 行返回 null", () => {
    expect(parseSseBlock("event: m\ndata: line1\ndata: line2")).toEqual({
      eventName: "m",
      data: "line1\nline2",
    });
    expect(parseSseBlock("event: ready\n:comment")).toBeNull();
  });

  it("无 event 行时默认为 message", () => {
    expect(parseSseBlock("data: hello")).toEqual({ eventName: "message", data: "hello" });
  });
});

describe("isTaskUpdateEvent", () => {
  const valid = {
    sessionId: "s1",
    taskId: "t1",
    taskVersion: 3,
    status: "SUCCEEDED",
    retryCount: 0,
    maxRetryCount: 2,
  };

  it("接受合法任务事件", () => {
    expect(isTaskUpdateEvent(valid)).toBe(true);
  });

  it("拒绝缺失字段或非法状态", () => {
    expect(isTaskUpdateEvent({ ...valid, taskId: undefined })).toBe(false);
    expect(isTaskUpdateEvent({ ...valid, taskVersion: "3" })).toBe(false);
    expect(isTaskUpdateEvent(null)).toBe(false);
    expect(isTaskUpdateEvent("payload")).toBe(false);
  });
});

describe("isPublicationStatusUpdateEvent", () => {
  const valid = {
    imageId: "img-1",
    publicationVersion: 2,
    status: "APPROVED",
    publicAt: "2026-08-10T00:00:00Z",
  };

  it("接受合法发布终态事件", () => {
    expect(isPublicationStatusUpdateEvent(valid)).toBe(true);
    expect(isPublicationStatusUpdateEvent({ ...valid, status: "REJECTED", publicAt: null })).toBe(true);
    expect(isPublicationStatusUpdateEvent({ ...valid, status: "FAILED" })).toBe(true);
  });

  it("拒绝非终态、非整数版本号或缺失 imageId", () => {
    expect(isPublicationStatusUpdateEvent({ ...valid, status: "PENDING" })).toBe(false);
    expect(isPublicationStatusUpdateEvent({ ...valid, publicationVersion: 1.5 })).toBe(false);
    expect(isPublicationStatusUpdateEvent({ ...valid, imageId: undefined })).toBe(false);
    expect(isPublicationStatusUpdateEvent({ ...valid, publicAt: 123 })).toBe(false);
  });
});

describe("isTerminalStatus", () => {
  it("识别生成终态", () => {
    for (const status of ["SUCCEEDED", "PARTIALLY_SUCCEEDED", "FAILED"]) {
      expect(isTerminalStatus(status as never)).toBe(true);
    }
    for (const status of ["QUEUED"]) {
      expect(isTerminalStatus(status as never)).toBe(false);
    }
  });
});

describe("reconnectDelayMs", () => {
  it("指数退避并封顶 3000ms", () => {
    expect(reconnectDelayMs(1)).toBe(1_000);
    expect(reconnectDelayMs(2)).toBe(2_000);
    expect(reconnectDelayMs(3)).toBe(3_000);
    expect(reconnectDelayMs(10)).toBe(3_000);
  });
});

describe("consumeSseStream", () => {
  function streamOf(blocks: string[]): Response {
    return new Response(new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();
        for (const block of blocks) controller.enqueue(encoder.encode(block));
        controller.close();
      },
    }));
  }

  it("触发 ready,解析 task 与 publication 事件并分发", async () => {
    const onReady = vi.fn();
    const onTaskUpdate = vi.fn();
    const onPublicationUpdate = vi.fn();
    const body = [
      "event: generation.stream.ready\ndata: {}\n\n",
      "event: generation.task.updated\ndata: {\"sessionId\":\"s1\",\"taskId\":\"t1\",\"taskVersion\":1,\"status\":\"SUCCEEDED\",\"retryCount\":0,\"maxRetryCount\":2}\n\n",
      "event: publication.updated\ndata: {\"imageId\":\"img-1\",\"publicationVersion\":1,\"status\":\"APPROVED\",\"publicAt\":\"2026-08-10T00:00:00Z\"}\n\n",
    ];
    await consumeSseStream(streamOf(body), onReady, onTaskUpdate, onPublicationUpdate);
    expect(onReady).toHaveBeenCalledTimes(1);
    expect(onTaskUpdate).toHaveBeenCalledWith(expect.objectContaining({ taskId: "t1", status: "SUCCEEDED" }));
    expect(onPublicationUpdate).toHaveBeenCalledWith(expect.objectContaining({ imageId: "img-1", status: "APPROVED" }));
  });

  it("跨 chunk 拼接多行事件,并忽略非法事件与坏 JSON", async () => {
    const onReady = vi.fn();
    const onTaskUpdate = vi.fn();
    const onPublicationUpdate = vi.fn();
    const stream = new Response(new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();
        controller.enqueue(encoder.encode("event: publication.up"));
        controller.enqueue(encoder.encode("dated\ndata: {\"imageId\":\"img-"));
        controller.enqueue(encoder.encode("2\",\"publicationVersion\":1,\"status\":\"FAILED\",\"publicAt\":null}\n"));
        controller.enqueue(encoder.encode("\n"));
        controller.enqueue(encoder.encode("event: publication.updated\ndata: not-json\n\n"));
        controller.enqueue(encoder.encode("event: publication.updated\ndata: {\"status\":\"PENDING\"}\n\n"));
        controller.close();
      },
    }));
    await consumeSseStream(stream, onReady, onTaskUpdate, onPublicationUpdate);
    expect(onPublicationUpdate).toHaveBeenCalledTimes(1);
    expect(onPublicationUpdate).toHaveBeenCalledWith(expect.objectContaining({ imageId: "img-2", status: "FAILED" }));
    expect(onReady).not.toHaveBeenCalled();
    expect(onTaskUpdate).not.toHaveBeenCalled();
  });

  it("无响应体时抛错", async () => {
    const response = new Response(null);
    await expect(consumeSseStream(response, vi.fn(), vi.fn(), vi.fn()))
      .rejects.toThrow("no response body");
  });
});
