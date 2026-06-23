import { performance } from "node:perf_hooks";
import { setTimeout as sleep } from "node:timers/promises";
import { LRUCache } from "lru-cache";
import hash from "object-hash";
import type { StandardSchemaV1 } from "./standard-schema.ts";

export type { StandardSchemaV1 } from "./standard-schema.ts";

const VOID_KEY = "~void";

function getCacheKeyString(value: unknown): string {
  if (value === undefined) return VOID_KEY;
  if (value === null) {
    throw new Error("cache key cannot be null");
  }
  try {
    if (typeof value === "string") return value;
    return hash(value as object, { unorderedObjects: true, unorderedArrays: true });
  } catch (error) {
    throw new Error(
      `cache key cannot be hashed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

export function range(n: number): number[];
export function range(start: number, end: number): number[];
export function range(n: number, fn: (i: number) => number): number[];
export function range(a: number, b?: number | ((i: number) => number)): number[] {
  if (b === undefined) {
    return Array.from({ length: a }, (_, i) => i);
  }
  if (typeof b === "function") {
    return Array.from({ length: a }, (_, i) => b(i));
  }
  return Array.from({ length: b - a + 1 }, (_, i) => a + i);
}

export function schedule(fn: (i: number) => number, count: number): number[] {
  return Array.from({ length: count }, (_, i) => fn(i));
}

type InferInput<S> = S extends StandardSchemaV1<infer I, any> ? I : never;
type InferOutput<S> = S extends StandardSchemaV1<any, infer O> ? O : never;

function validateSchema<S extends StandardSchemaV1>(
  schema: S,
  value: unknown
): InferOutput<S> | Promise<InferOutput<S>> {
  const result = schema["~standard"].validate(value);

  if (result instanceof Promise) {
    return result.then((res) => {
      if (res.issues) {
        const messages = res.issues.map((i) => i.message).join(", ");
        throw new Error(`validation failed: ${messages}`);
      }
      return res.value as InferOutput<S>;
    });
  }

  if (result.issues) {
    const messages = result.issues.map((i) => i.message).join(", ");
    throw new Error(`validation failed: ${messages}`);
  }
  return result.value as InferOutput<S>;
}

export interface OpOptions<TReturn = any> {
  name?: string;
  ttl?: number;
  maxItems?: number;
  retries?: number[];
  cacheHit?: ((key: string) => void) | null;
  cacheMiss?: ((key: string) => void) | null;
  skipCache?: (result: TReturn) => boolean;
  bail?: (error: unknown) => boolean;
}

export interface OpObjectOptions<
  TInputSchema extends StandardSchemaV1 | undefined = undefined,
  TOutputSchema extends StandardSchemaV1 | undefined = undefined,
  TRun extends (
    input: TInputSchema extends StandardSchemaV1 ? InferOutput<TInputSchema> : any,
    ctx?: any
  ) => Promise<TOutputSchema extends StandardSchemaV1 ? InferInput<TOutputSchema> : any> = (
    input: TInputSchema extends StandardSchemaV1 ? InferOutput<TInputSchema> : any,
    ctx?: any
  ) => Promise<TOutputSchema extends StandardSchemaV1 ? InferInput<TOutputSchema> : any>,
> extends OpOptions<
    TOutputSchema extends StandardSchemaV1 ? InferOutput<TOutputSchema> : Awaited<ReturnType<TRun>>
  > {
  input?: TInputSchema;
  output?: TOutputSchema;
  run: TRun;
}

type AnyAsyncFn = (...args: any[]) => Promise<any>;
type Input<F extends AnyAsyncFn> = Parameters<F>[0];

// MUST be a function intersection (`F & { ... }`), not an interface with a call
// signature. interfaces erase the original function type, which breaks
// "Go to Definition" in IDEs — clicking the call jumps to the interface instead
// of the actual implementation. the intersection preserves F's declaration site.
export type OpFunction<F extends AnyAsyncFn> = F & {
  clear: (key?: Input<F>) => void;
  has: (key: Input<F>) => boolean;
  invalidate: (predicate: (key: Input<F>) => boolean) => number;
};

const log = {
  info: (...args: unknown[]) => console.log(...args),
  error: (...args: unknown[]) => console.error(...args),
  debug: (...args: unknown[]) => {
    if (process.env.LOG_LEVEL === "debug") console.log(...args);
  },
  prod: (...args: unknown[]) => {
    if (process.env.NODE_ENV === "production") console.log(...args);
  },
};

// overload: function form
export function op<F extends AnyAsyncFn>(
  fn: F,
  options?: OpOptions<Awaited<ReturnType<F>>>
): OpFunction<F>;
// overload: object form with optional StandardSchema validation
export function op<
  TInputSchema extends StandardSchemaV1 | undefined = undefined,
  TOutputSchema extends StandardSchemaV1 | undefined = undefined,
  TRun extends (
    input: TInputSchema extends StandardSchemaV1 ? InferOutput<TInputSchema> : any,
    ctx?: any
  ) => Promise<TOutputSchema extends StandardSchemaV1 ? InferInput<TOutputSchema> : any> = (
    input: TInputSchema extends StandardSchemaV1 ? InferOutput<TInputSchema> : any,
    ctx?: any
  ) => Promise<TOutputSchema extends StandardSchemaV1 ? InferInput<TOutputSchema> : any>,
>(
  options: OpObjectOptions<TInputSchema, TOutputSchema, TRun>
): OpFunction<
  (
    input: TInputSchema extends StandardSchemaV1 ? InferInput<TInputSchema> : Parameters<TRun>[0],
    ctx?: TRun extends (input: any, ctx: infer C, ...rest: any[]) => any ? C : never
  ) => Promise<
    TOutputSchema extends StandardSchemaV1 ? InferOutput<TOutputSchema> : Awaited<ReturnType<TRun>>
  >
>;
// implementation
export function op(
  fnOrOptions: AnyAsyncFn | OpObjectOptions<any, any, any>,
  options?: OpOptions<any>
): OpFunction<AnyAsyncFn> {
  if (typeof fnOrOptions === "function") {
    return _op(fnOrOptions, options ?? {});
  }

  const { input: inputSchema, output: outputSchema, run, ...opOptions } = fnOrOptions;

  const wrappedFn = async (rawInput: any, ctx: any) => {
    let input = rawInput;
    if (inputSchema) {
      const validated = validateSchema(inputSchema, rawInput);
      input = validated instanceof Promise ? await validated : validated;
    }

    const result = await run(input, ctx);

    if (outputSchema) {
      const validated = validateSchema(outputSchema, result);
      return validated instanceof Promise ? await validated : validated;
    }

    return result;
  };

  return _op(wrappedFn, opOptions);
}

function _op(fn: AnyAsyncFn, options: OpOptions): OpFunction<AnyAsyncFn> {
  const shouldCache = options.ttl !== undefined;

  const lruCache = shouldCache
    ? new LRUCache<string, {}>({
        max: options.maxItems ?? 1000,
        ttl: options.ttl!,
      })
    : null;

  const keyMap = shouldCache
    ? new LRUCache<string, {}>({
        max: options.maxItems ?? 1000,
        ttl: options.ttl!,
      })
    : null;

  const inFlightPromises = new Map<string, Promise<unknown>>();

  const namePrefix = options.name ? `[${options.name}] ` : "";
  // gate default cache-event logs on `shouldCache`: without a cache every call
  // is structurally a miss, which is noise for ops that use `name` purely for
  // retry-log labeling.
  const defaultCacheHit =
    options.cacheHit === null
      ? () => {}
      : (options.cacheHit ??
        (() => {
          if (options.name && shouldCache) log.prod(`${namePrefix}cache hit`);
        }));
  const defaultCacheMiss =
    options.cacheMiss === null
      ? () => {}
      : (options.cacheMiss ??
        (() => {
          if (options.name && shouldCache) log.prod(`${namePrefix}cache miss`);
        }));

  const acceptsCtx = fn.length === 2;

  const cachedFn = async (input: any, ctx?: any): Promise<any> => {
    let key: string;
    try {
      key = getCacheKeyString(input);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      // do NOT include `input` value — see #742; ops can correlate via the
      // op name + caller stack trace.
      throw new Error(
        `failed to create cache key${namePrefix ? ` for ${options.name}` : ""}: ${errorMessage}`
      );
    }
    const startTime = performance.now();
    const timestamp = new Date().toISOString();

    log.debug(`${namePrefix}[${timestamp}] cache lookup started`, { key });

    if (shouldCache && lruCache) {
      const cached = lruCache.get(key);
      if (cached !== undefined) {
        if (keyMap?.get(key) === undefined) keyMap?.set(key, input);
        const runtime = performance.now() - startTime;
        log.debug(`${namePrefix}[${timestamp}] cache hit (from lru)`, {
          key,
          runtime: `${Math.round(runtime)}ms`,
        });
        defaultCacheHit(key);
        return cached;
      }
    }

    const inFlight = inFlightPromises.get(key);
    if (inFlight) {
      log.debug(`${namePrefix}[${timestamp}] cache hit (in-flight)`, { key });
      defaultCacheHit(key);
      return inFlight;
    }

    log.debug(`${namePrefix}[${timestamp}] cache miss, executing function`, { key });
    defaultCacheMiss(key);

    const retries = options.retries ?? [];
    let lastError: unknown;
    const execStartTime = performance.now();

    const promise = (async () => {
      for (let attempt = 0; attempt <= retries.length; attempt++) {
        try {
          const result = acceptsCtx ? await fn(input, ctx) : await fn(input);
          const execRuntime = performance.now() - execStartTime;

          const skip = options.skipCache ? options.skipCache(result) : false;
          if (shouldCache && lruCache && result !== null && result !== undefined && !skip) {
            lruCache.set(key, result);
            keyMap?.set(key, input);
          }

          log.debug(`${namePrefix}[${timestamp}] function executed successfully`, {
            key,
            runtime: `${Math.round(execRuntime)}ms`,
            attempt: attempt + 1,
            cached: shouldCache && result !== null && result !== undefined && !skip,
          });

          return result;
        } catch (error) {
          if (options.bail?.(error)) throw error;

          lastError = error;

          const isLastAttempt = attempt >= retries.length;
          // do NOT log `input` — it can carry secrets (`token`, `apiKey`, …)
          // through generic op wrappers into log drains. `key` is the SHA-1
          // hash of input (sufficient for retry correlation) and `error`
          // already carries request URL / status. see pullfrog/app#742.
          if (isLastAttempt) {
            if (namePrefix) {
              log.info(
                `${namePrefix}attempt ${attempt + 1}/${retries.length + 1} failed, no more retries`
              );
              log.info(`${namePrefix}`, { key, error, attempt });
            } else {
              log.info(`attempt ${attempt + 1}/${retries.length + 1} failed, no more retries`);
              log.info({ key, error, attempt });
            }
          } else {
            const delay = retries[attempt]!;
            if (namePrefix) {
              log.info(
                `${namePrefix}attempt ${attempt + 1}/${retries.length + 1} failed, retrying in ${delay}ms`
              );
              log.info(`${namePrefix}`, { key, error, attempt });
            } else {
              log.info(
                `attempt ${attempt + 1}/${retries.length + 1} failed, retrying in ${delay}ms`
              );
              log.info({ key, error, attempt });
            }
            await sleep(delay);
          }
        }
      }

      const execRuntime = performance.now() - execStartTime;
      log.debug(`${namePrefix}[${timestamp}] function failed after all retries`, {
        key,
        runtime: `${Math.round(execRuntime)}ms`,
        attempts: retries.length + 1,
        error: lastError instanceof Error ? lastError.message : lastError,
      });

      throw lastError;
    })();

    inFlightPromises.set(key, promise);

    try {
      return await promise;
    } finally {
      inFlightPromises.delete(key);
    }
  };

  cachedFn.clear = (key?: any) => {
    if (shouldCache && lruCache) {
      if (key !== undefined) {
        let stringKey: string;
        try {
          stringKey = getCacheKeyString(key);
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          throw new Error(
            `failed to hash cache key for clear()${namePrefix ? ` in ${options.name}` : ""}: ${errorMessage}`
          );
        }
        lruCache.delete(stringKey);
        keyMap!.delete(stringKey);
      } else {
        lruCache.clear();
        keyMap!.clear();
      }
    }
  };

  cachedFn.has = (key: any) => {
    if (!shouldCache || !lruCache) return false;
    try {
      const stringKey = getCacheKeyString(key);
      return lruCache.has(stringKey);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(
        `failed to hash cache key for has()${namePrefix ? ` in ${options.name}` : ""}: ${errorMessage}`
      );
    }
  };

  cachedFn.invalidate = (predicate: (key: any) => boolean) => {
    if (!shouldCache || !lruCache) return 0;
    let count = 0;
    for (const [stringKey, originalKey] of keyMap!) {
      if (predicate(originalKey)) {
        lruCache.delete(stringKey);
        keyMap!.delete(stringKey);
        count++;
      }
    }
    return count;
  };

  return cachedFn as OpFunction<AnyAsyncFn>;
}
