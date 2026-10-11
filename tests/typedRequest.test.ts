import { describe, it, expect } from "vitest";
import { z } from "zod";
import type { TypedRequest, TypedRequestBody, TypedRequestQuery } from "@core/utils/typedRequest.js";

describe("typedRequest utility", () => {
  it("infers types from compound Zod schema", () => {
    const compoundSchema = z.object({
      params: z.object({ id: z.string() }),
      query: z.object({ filter: z.string().optional() }),
      body: z.object({ name: z.string(), age: z.number() }),
    });

    type CompoundReq = TypedRequest<typeof compoundSchema>;

    const fakeReq: Partial<CompoundReq> = {
      params: { id: "123" },
      query: { filter: "active" },
      body: { name: "Alice", age: 30 },
    };

    expect(fakeReq.params?.id).toBe("123");
    expect(fakeReq.body?.name).toBe("Alice");
    expect(fakeReq.body?.age).toBe(30);
    expect(fakeReq.query?.filter).toBe("active");
  });

  it("infers types from direct body schema", () => {
    const bodySchema = z.object({
      email: z.string().email(),
      role: z.enum(["admin", "user"]),
    });

    type DirectReq = TypedRequestBody<typeof bodySchema>;

    const fakeReq: Partial<DirectReq> = {
      body: { email: "test@example.com", role: "admin" },
    };

    expect(fakeReq.body?.email).toBe("test@example.com");
    expect(fakeReq.body?.role).toBe("admin");
  });

  it("infers types from query schema", () => {
    const querySchema = z.object({
      page: z.string(),
      limit: z.string(),
    });

    type QueryReq = TypedRequestQuery<typeof querySchema>;

    const fakeReq: Partial<QueryReq> = {
      query: { page: "1", limit: "10" },
    };

    expect(fakeReq.query?.page).toBe("1");
    expect(fakeReq.query?.limit).toBe("10");
  });
});
