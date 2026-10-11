import type { Request } from "express";
import type { ZodTypeAny, z } from "zod";

/**
 * Flattens complex object/intersection types into a single clean type for IDE inspection.
 */
export type Prettify<T> = { [K in keyof T]: T[K] } & {};

/**
 * Strongly typed Express Request inferred from a Zod schema.
 * Supports both compound schemas ({ body, query, params }) and direct body schemas.
 */
export type TypedRequest<T extends ZodTypeAny, Inferred = z.infer<T>> = Inferred extends
  { body: infer _B } | { query: infer _Q } | { params: infer _P }
  ? Prettify<
      Request<
        Inferred extends { params: infer P } ? (P extends Record<string, any> ? P : any) : any,
        unknown,
        Inferred extends { body: infer B } ? B : any,
        Inferred extends { query: infer Q } ? (Q extends Record<string, any> ? Q : any) : any
      >
    >
  : Prettify<Request<any, unknown, Inferred, any>>;

export type TypedRequestBody<T extends ZodTypeAny> = Prettify<Request<any, unknown, z.infer<T>, any>>;

export type TypedRequestQuery<T extends ZodTypeAny> = Prettify<Request<any, unknown, any, z.infer<T>>>;
