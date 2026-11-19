import { WebError } from "@deepseek-ai/dsh-web";
import z from "@deepseek-ai/schemastery";
import { credentialRef } from "@deepseek-ai/dsh-credentials";
import { launchEnvironmentOf } from "@deepseek-ai/dsh-launch-environment";
import { describeError, fetchWithRetry } from "./retry.js";

const name = "web-search-multi";
const inject = ["web", "llm"];

function nonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

/**
 * URL tracking parameters worth stripping before a source is deduplicated.
 * OpenAI's citation URLs carry `?utm_source=openai` while the same page appears
 * bare in `web_search_call.action.sources`, so without this the one page that
 * the answer actually cites is counted twice and pushed past the result cap.
 */
const TRACKING_PARAM = /^(utm_.*|gclid|fbclid|mc_cid|mc_eid|ref_src|ref_url)$/i;

/**
 * Drop tracking parameters from a source URL so equal pages deduplicate.
 * @param rawUrl - the provider-supplied URL.
 * @returns the URL without tracking parameters, or the input when it has none
 *   or cannot be parsed.
 */
function canonicalSourceUrl(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return rawUrl;
  }
  const tracking = [...url.searchParams.keys()].filter((key) => TRACKING_PARAM.test(key));
  if (tracking.length === 0) return rawUrl;
  for (const key of tracking) url.searchParams.delete(key);
  return url.toString();
}

/**
 * Preserve a tool call's last non-empty id and name across streamed
 * continuation frames. Some OpenAI-compatible gateways emit empty strings or
 * nulls after the first valid frame; DSH rc.7 otherwise lets those values
 * erase the identity and attempts to execute an unknown tool named "".
 */
async function* stabilizeToolCallIdentity(stream) {
  const identities = new Map();

  for await (const chunk of stream) {
    if (chunk?.type === "tool-call-delta") {
      const previous = identities.get(chunk.index) ?? {};
      const id = nonEmptyString(chunk.id) ? chunk.id : previous.id;
      const toolName = nonEmptyString(chunk.name) ? chunk.name : previous.name;

      if (id !== undefined || toolName !== undefined) {
        identities.set(chunk.index, { id, name: toolName });
      }

      const repaired = { ...chunk };
      if (id !== undefined) repaired.id = id;
      if (toolName !== undefined) repaired.name = toolName;
      else if ("name" in repaired) delete repaired.name;
      yield repaired;
      continue;
    }

    if (chunk?.type === "block-end" && chunk.block?.type === "tool-call") {
      const previous = identities.get(chunk.index) ?? {};
      const id = nonEmptyString(chunk.block.id) ? chunk.block.id : previous.id;
      const toolName = nonEmptyString(chunk.block.name) ? chunk.block.name : previous.name;
      const block = { ...chunk.block };
      if (id !== undefined) block.id = id;
      if (toolName !== undefined) block.name = toolName;
      identities.delete(chunk.index);
      yield { ...chunk, block };
      continue;
    }

    yield chunk;
  }
}

const DEFAULTS = {
  tavilyBaseURL: "https://api.tavily.com",
  tavilyApiKeyEnv: "TAVILY_API_KEY",
  tavilyMaxResults: 8,
  tavilySearchDepth: "basic",
  tavilyIncludeAnswer: true,
  grokBaseURL: "https://api.x.ai/v1",
  grokApiKeyEnv: "XAI_API_KEY",
  grokModel: "grok-4.6",
  openaiBaseURL: "https://api.openai.com/v1",
  openaiApiKeyEnv: "OPENAI_API_KEY",
  openaiModel: "gpt-5.6",
  geminiBaseURL: "https://generativelanguage.googleapis.com/v1beta",
  geminiApiKeyEnv: "GEMINI_API_KEY",
  geminiModel: "gemini-3.6-flash",
};

const Config = z.object({
  provider: z.string().default("tavily").volatile(),
  tavilyApiKey: z.string().role("secret").volatile(),
  tavilyApiKeyEnv: z.string().role("credential-ref").default(DEFAULTS.tavilyApiKeyEnv).volatile(),
  tavilyBaseURL: z.string().default(DEFAULTS.tavilyBaseURL).volatile(),
  tavilyMaxResults: z.number().step(1).min(1).default(DEFAULTS.tavilyMaxResults).volatile(),
  tavilySearchDepth: z.string().default(DEFAULTS.tavilySearchDepth).volatile(),
  tavilyIncludeAnswer: z.boolean().default(DEFAULTS.tavilyIncludeAnswer).volatile(),
  grokApiKey: z.string().role("secret").volatile(),
  grokApiKeyEnv: z.string().role("credential-ref").default(DEFAULTS.grokApiKeyEnv).volatile(),
  grokBaseURL: z.string().default(DEFAULTS.grokBaseURL).volatile(),
  grokModel: z.string().default(DEFAULTS.grokModel).volatile(),
  openaiApiKey: z.string().role("secret").volatile(),
  openaiApiKeyEnv: z.string().role("credential-ref").default(DEFAULTS.openaiApiKeyEnv).volatile(),
  openaiBaseURL: z.string().default(DEFAULTS.openaiBaseURL).volatile(),
  openaiModel: z.string().default(DEFAULTS.openaiModel).volatile(),
  geminiApiKey: z.string().role("secret").volatile(),
  geminiApiKeyEnv: z.string().role("credential-ref").default(DEFAULTS.geminiApiKeyEnv).volatile(),
  geminiBaseURL: z.string().default(DEFAULTS.geminiBaseURL).volatile(),
  geminiModel: z.string().default(DEFAULTS.geminiModel).volatile(),
});

const MULTI_SETTINGS_NAMESPACE = "web-search-multi";

/**
 * Multi-backend search provider for the DeepSeek Harness web capability seam.
 * Registered as `ctx.web` provider id `multi`.
 */
class MultiSearchProvider {
  constructor(resolveOptions) {
    this.resolveOptions = resolveOptions;
    this.id = "multi";
  }

  available() {
    const options = this.resolveOptions();
    return options.provider !== undefined && URL.canParse(options[`${options.provider}BaseURL`] ?? "");
  }

  async search(request, signal) {
    const options = this.resolveOptions();
    switch (options.provider) {
      case "tavily":
        return this.searchTavily(request, options, signal);
      case "grok":
        return this.searchResponses(request, options, "grok", signal);
      case "openai":
        return this.searchResponses(request, options, "openai", signal);
      case "gemini":
        return this.searchGemini(request, options, signal);
      default:
        throw new WebError(`Unknown web search provider "${options.provider}"`, "WEB_PROVIDER_ERROR");
    }
  }

  async searchTavily(request, options, signal) {
    const apiKey = await this.apiKey(options, "tavily", signal);
    const maxResults = request.maxResults ?? options.tavilyMaxResults ?? DEFAULTS.tavilyMaxResults;
    const endpoint = `${(options.tavilyBaseURL ?? DEFAULTS.tavilyBaseURL).replace(/\/+$/, "")}/search`;
    const body = {
      query: request.query,
      max_results: maxResults,
      search_depth: options.tavilySearchDepth ?? DEFAULTS.tavilySearchDepth,
      include_answer: options.tavilyIncludeAnswer ?? DEFAULTS.tavilyIncludeAnswer,
      include_raw_content: false,
      include_images: false,
    };

    const data = await this.postJson(endpoint, body, apiKey, signal, "Tavily");
    const sources = (data.results ?? []).map((item) => ({
      url: item.url,
      ...(item.title ? { title: item.title } : {}),
      ...(item.content ? { snippet: item.content } : {}),
      ...(item.published_date ? { publishedAt: item.published_date } : {}),
    }));

    return {
      ...(data.answer ? { content: data.answer } : {}),
      sources,
      truncated: false,
    };
  }

  async searchResponses(request, options, kind, signal) {
    const apiKey = await this.apiKey(options, kind, signal);
    const baseURL = (options[`${kind}BaseURL`] ?? DEFAULTS[`${kind}BaseURL`]).replace(/\/+$/, "");
    const model = options[`${kind}Model`] ?? DEFAULTS[`${kind}Model`];
    const endpoint = `${baseURL}/responses`;
    const body = {
      model,
      input: request.query,
      tools: [{ type: "web_search" }],
      include: ["web_search_call.action.sources"],
    };

    const data = await this.postJson(endpoint, body, apiKey, signal, "Responses");
    const parsed = this.parseResponsesOutput(data, request.maxResults);
    return {
      ...(parsed.content ? { content: parsed.content } : {}),
      sources: parsed.sources,
      truncated: parsed.truncated,
    };
  }

  async searchGemini(request, options, signal) {
    const apiKey = await this.apiKey(options, "gemini", signal);
    const baseURL = (options.geminiBaseURL ?? DEFAULTS.geminiBaseURL).replace(/\/+$/, "");
    const model = options.geminiModel ?? DEFAULTS.geminiModel;
    const endpoint = `${baseURL}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

    const body = {
      contents: [{ role: "user", parts: [{ text: request.query }] }],
      tools: [{ google_search: {} }],
    };

    let data;
    try {
      const response = await fetchWithRetry(
        endpoint,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
        signal,
      );
      if (!response.ok) {
        let message = `Gemini API error (HTTP ${response.status})`;
        try {
          const parsed = await response.json();
          const detail = parsed.error?.message ?? parsed.message;
          if (detail) message = detail;
        } catch {}
        throw new WebError(message, "WEB_PROVIDER_ERROR");
      }
      data = await response.json();
    } catch (error) {
      if (signal?.aborted === true || isAbortError(error)) throw abortError(signal, error);
      if (error instanceof WebError) throw error;
      throw new WebError(`Gemini search request failed: ${describeError(error)}`, "WEB_PROVIDER_ERROR", { cause: error });
    }

    const candidate = data.candidates?.[0];
    let content = "";
    for (const part of candidate?.content?.parts ?? []) {
      // Gemini 3 returns its internal reasoning as `thought: true` parts. They are
      // not the answer: leaking them into `content` makes the search result read
      // as the model's deliberation instead of a summary of the sources.
      if (part.thought === true) continue;
      if (part.text) content += part.text;
    }
    const sources = (candidate?.groundingMetadata?.groundingChunks ?? [])
      .filter((chunk) => chunk.web?.uri)
      .map((chunk) => ({
        url: chunk.web.uri,
        ...(chunk.web.title ? { title: chunk.web.title } : {}),
      }));

    return {
      ...(content ? { content } : {}),
      sources,
      truncated: false,
    };
  }

  /**
   * Project one Responses payload into `{content, sources, truncated}`.
   *
   * Sources are ordered by usefulness under a result cap: URLs the answer cites
   * (`url_citation` annotations) come first, then the remaining
   * `web_search_call.action.sources`. Without that order the cap keeps the
   * search call's noisy head and drops the one page the answer actually quotes.
   * URLs are canonicalized before deduplication so a cited page also present in
   * the search results collapses into one entry, keeping whichever metadata
   * each side carried.
   *
   * @param data - the Responses API body.
   * @param maxResults - the caller's requested source cap, when any.
   * @returns the answer text, the capped source list, and whether sources were dropped.
   */
  parseResponsesOutput(data, maxResults) {
    const output = data.output ?? [];
    let content = "";
    const cited = [];
    const searched = [];

    for (const item of output) {
      if (item.type === "message") {
        for (const block of item.content ?? []) {
          if (block.type === "output_text") {
            if (block.text) content += block.text;
            for (const annotation of block.annotations ?? []) {
              if (annotation.type === "url_citation" && annotation.url) {
                cited.push({
                  url: canonicalSourceUrl(annotation.url),
                  ...(annotation.title ? { title: annotation.title } : {}),
                });
              }
            }
          }
        }
      }
      if (item.type === "web_search_call" && item.action?.sources) {
        for (const source of item.action.sources) {
          if (typeof source === "string") {
            searched.push({ url: canonicalSourceUrl(source) });
          } else if (source?.url) {
            searched.push({
              url: canonicalSourceUrl(source.url),
              ...(source.title ? { title: source.title } : {}),
              ...(source.description ? { snippet: source.description } : {}),
            });
          }
        }
      }
    }

    // Map insertion order is the precedence order: cited pages first.
    const merged = new Map();
    for (const source of [...cited, ...searched]) {
      const previous = merged.get(source.url);
      if (previous === undefined) {
        merged.set(source.url, source);
        continue;
      }
      merged.set(source.url, {
        ...previous,
        ...(previous.title === undefined && source.title !== undefined ? { title: source.title } : {}),
        ...(previous.snippet === undefined && source.snippet !== undefined ? { snippet: source.snippet } : {}),
      });
    }
    const all = [...merged.values()];
    const sources = maxResults !== undefined && all.length > maxResults ? all.slice(0, maxResults) : all;

    return { content, sources, truncated: sources.length < all.length };
  }

  async postJson(endpoint, body, apiKey, signal, label) {
    let response;
    try {
      response = await fetchWithRetry(
        endpoint,
        {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        },
        signal,
      );
    } catch (error) {
      if (signal?.aborted === true || isAbortError(error)) throw abortError(signal, error);
      throw new WebError(`${label} search request failed: ${describeError(error)}`, "WEB_PROVIDER_ERROR", { cause: error });
    }

    if (!response.ok) {
      let message = `${label} API error (HTTP ${response.status})`;
      try {
        const parsed = await response.json();
        const detail =
          typeof parsed.detail === "string"
            ? parsed.detail
            : parsed.detail?.error ?? parsed.error?.message ?? parsed.message;
        if (detail) message = detail;
      } catch {}
      throw new WebError(message, "WEB_PROVIDER_ERROR");
    }

    try {
      return await response.json();
    } catch (error) {
      throw new WebError(`${label} returned an unprocessable response body: ${describeError(error)}`, "WEB_PROVIDER_ERROR", { cause: error });
    }
  }

  async apiKey(options, kind, signal) {
    const literal = options[`${kind}ApiKey`];
    if (signal?.aborted) throw abortError(signal);
    if (literal !== undefined && literal.length > 0) return literal;

    const envRef = options[`${kind}ApiKeyEnv`] ?? DEFAULTS[`${kind}ApiKeyEnv`];
    let resolved;
    try {
      resolved = await abortable(options[`${kind}ResolveApiKey`]?.() ?? Promise.resolve(undefined), signal);
    } catch (error) {
      if (signal?.aborted === true || isAbortError(error)) throw abortError(signal, error);
      throw new WebError(`Search credential resolution failed: ${String(error)}`, "WEB_PROVIDER_ERROR", { cause: error });
    }

    if (resolved !== undefined && resolved.length > 0) return resolved;
    throw new WebError(
      `Search has no API key for "${envRef}"; store it through the credentials service, export it in the launching environment, or set a literal "${kind}ApiKey" in the web-search-multi config`,
      "WEB_PROVIDER_CREDENTIAL_MISSING",
    );
  }
}

function resolveKeyResolver(ctx, envRef) {
  const ref = credentialRef(envRef);
  return async () => {
    const credentials = ctx.get("credentials");
    if (credentials !== undefined) return (await credentials.resolve(ref))?.value;
    const ambient = launchEnvironmentOf(ctx).get(ref);
    return ambient !== undefined && ambient.value.length > 0 ? ambient.value : undefined;
  };
}

function resolveOptions(ctx, config) {
  const options = {
    provider: config.provider ?? "tavily",
    tavilyApiKey: config.tavilyApiKey,
    tavilyApiKeyEnv: config.tavilyApiKeyEnv ?? DEFAULTS.tavilyApiKeyEnv,
    tavilyBaseURL: config.tavilyBaseURL ?? DEFAULTS.tavilyBaseURL,
    tavilyMaxResults: config.tavilyMaxResults ?? DEFAULTS.tavilyMaxResults,
    tavilySearchDepth: config.tavilySearchDepth ?? DEFAULTS.tavilySearchDepth,
    tavilyIncludeAnswer: config.tavilyIncludeAnswer ?? DEFAULTS.tavilyIncludeAnswer,
    grokApiKey: config.grokApiKey,
    grokApiKeyEnv: config.grokApiKeyEnv ?? DEFAULTS.grokApiKeyEnv,
    grokBaseURL: config.grokBaseURL ?? DEFAULTS.grokBaseURL,
    grokModel: config.grokModel ?? DEFAULTS.grokModel,
    openaiApiKey: config.openaiApiKey,
    openaiApiKeyEnv: config.openaiApiKeyEnv ?? DEFAULTS.openaiApiKeyEnv,
    openaiBaseURL: config.openaiBaseURL ?? DEFAULTS.openaiBaseURL,
    openaiModel: config.openaiModel ?? DEFAULTS.openaiModel,
    geminiApiKey: config.geminiApiKey,
    geminiApiKeyEnv: config.geminiApiKeyEnv ?? DEFAULTS.geminiApiKeyEnv,
    geminiBaseURL: config.geminiBaseURL ?? DEFAULTS.geminiBaseURL,
    geminiModel: config.geminiModel ?? DEFAULTS.geminiModel,
  };
  for (const kind of ["tavily", "grok", "openai", "gemini"]) {
    const envRef = options[`${kind}ApiKeyEnv`];
    options[`${kind}ResolveApiKey`] = resolveKeyResolver(ctx, envRef);
  }
  return options;
}

const TEST_API_PREFIX = "/web-search-multi/api";
const TEST_QUERY = "DeepSeek";
const TEST_MAX_RESULTS = 3;
const TEST_TIMEOUT_MS = 20_000;
const TEST_BODY_LIMIT = 4 * 1024;
const PROVIDERS = ["tavily", "grok", "openai", "gemini"];

function writeJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
  });
  res.end(body);
}

function isLoopbackRequest(req) {
  const address = req.socket?.remoteAddress ?? "";
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

async function readJsonBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > TEST_BODY_LIMIT) throw new Error("request body too large");
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

/**
 * Loopback-only settings-page helper API. `POST {TEST_API_PREFIX}/test` runs
 * one real search against the requested backend using the currently saved
 * configuration, so the Web UI can verify credentials and endpoints without
 * leaving the settings panel. Deployments without a web server (headless
 * profiles) never mount this handler.
 */
function createTestApiHandler(resolveOptions) {
  return async (req, res) => {
    const pathname = new URL(req.url ?? "/", "http://dsh.local").pathname;

    if (!isLoopbackRequest(req)) {
      writeJson(res, 403, { ok: false, error: { code: "forbidden", message: "loopback requests only" } });
      return;
    }
    if (req.method !== "POST" || pathname !== `${TEST_API_PREFIX}/test`) {
      writeJson(res, 404, { ok: false, error: { code: "not-found", message: `unknown endpoint ${req.method} ${pathname}` } });
      return;
    }

    let provider;
    try {
      const body = await readJsonBody(req);
      provider = body.provider;
    } catch (error) {
      writeJson(res, 400, { ok: false, error: { code: "bad-request", message: describeError(error) } });
      return;
    }

    const options = resolveOptions();
    if (provider === undefined) provider = options.provider;
    if (!PROVIDERS.includes(provider)) {
      writeJson(res, 400, { ok: false, error: { code: "bad-provider", message: `unknown search backend "${String(provider)}"` } });
      return;
    }

    const search = new MultiSearchProvider(() => ({ ...options, provider }));
    const startedAt = Date.now();
    try {
      const result = await search.search(
        { query: TEST_QUERY, maxResults: TEST_MAX_RESULTS },
        AbortSignal.timeout(TEST_TIMEOUT_MS),
      );
      writeJson(res, 200, {
        ok: true,
        provider,
        latencyMs: Date.now() - startedAt,
        sourceCount: result.sources.length,
        sample: result.sources.slice(0, TEST_MAX_RESULTS).map((source) => ({
          url: source.url,
          ...(source.title ? { title: source.title } : {}),
        })),
        ...(result.content ? { content: result.content.slice(0, 200) } : {}),
      });
    } catch (error) {
      writeJson(res, 200, {
        ok: false,
        provider,
        latencyMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };
}

function apply(ctx, config) {
  ctx.on("llm/stream", (_options, next) => stabilizeToolCallIdentity(next()));

  // Resolved lazily on every call so settings-page edits apply without a reload.
  const resolveCurrentOptions = () => resolveOptions(ctx, {
    provider: config.provider.get(),
    tavilyApiKey: config.tavilyApiKey.get(),
    tavilyApiKeyEnv: config.tavilyApiKeyEnv.get(),
    tavilyBaseURL: config.tavilyBaseURL.get(),
    tavilyMaxResults: config.tavilyMaxResults.get(),
    tavilySearchDepth: config.tavilySearchDepth.get(),
    tavilyIncludeAnswer: config.tavilyIncludeAnswer.get(),
    grokApiKey: config.grokApiKey.get(),
    grokApiKeyEnv: config.grokApiKeyEnv.get(),
    grokBaseURL: config.grokBaseURL.get(),
    grokModel: config.grokModel.get(),
    openaiApiKey: config.openaiApiKey.get(),
    openaiApiKeyEnv: config.openaiApiKeyEnv.get(),
    openaiBaseURL: config.openaiBaseURL.get(),
    openaiModel: config.openaiModel.get(),
    geminiApiKey: config.geminiApiKey.get(),
    geminiApiKeyEnv: config.geminiApiKeyEnv.get(),
    geminiBaseURL: config.geminiBaseURL.get(),
    geminiModel: config.geminiModel.get(),
  });

  ctx.web.registerSearchProvider(new MultiSearchProvider(resolveCurrentOptions));

  // `inject` stays ["web", "llm"]: this plugin also runs in headless profiles
  // where the web server service never exists. A dynamic fiber waits for the
  // service instead (a one-shot `ctx.get` races service startup and silently
  // skips the route); in a deployment without a web server the fiber simply
  // never starts.
  ctx.effect(() => ctx.inject(["webServer"], (webCtx) => {
    const unregister = webCtx.webServer.register({
      kind: "prefix",
      path: TEST_API_PREFIX,
      handler: createTestApiHandler(resolveCurrentOptions),
    });
    return () => unregister();
  }), "web-search-multi: test api");
}

function abortable(operation, signal) {
  if (signal === undefined) return operation;
  if (signal.aborted) return Promise.reject(abortError(signal));
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(abortError(signal));
    signal.addEventListener("abort", onAbort, { once: true });
    Promise.resolve(operation).then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

function isAbortError(error) {
  return error instanceof DOMException && error.name === "AbortError";
}

function abortError(signal, cause) {
  return new WebError("Web search aborted", "WEB_PROVIDER_ABORTED", { cause });
}

export {
  Config,
  DEFAULTS,
  MULTI_SETTINGS_NAMESPACE,
  MultiSearchProvider,
  TEST_API_PREFIX,
  apply,
  createTestApiHandler,
  inject,
  name,
  stabilizeToolCallIdentity,
};
