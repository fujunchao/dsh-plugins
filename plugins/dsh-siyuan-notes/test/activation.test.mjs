// Plugin activation: apply() must survive a Cordis context that throws when a
// service is read without being injected. That is exactly how cordis behaves
// ("cannot get property \"x\" without inject"), and getting it wrong takes the
// whole Host half down — no routes, no tool, and the panel reports HTTP 405.
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { apply, inject as declaredInject, name, ROUTES } from "../lib/index.js";

/** Services this activation declares up front. */
const INJECTED = new Set(declaredInject);

/**
 * A context that mimics cordis: unknown/uninjected service reads throw.
 * @param {Record<string, any>} services available service instances.
 * @returns {any}
 */
function strictContext(services, injected = INJECTED) {
	const registeredTools = [];
	const registeredSections = [];
	const registeredContexts = [];
	const routes = [];
	const disposers = [];
	const ctx = {
		effect(fn) {
			const dispose = fn();
			if (typeof dispose === "function") disposers.push(dispose);
			return dispose;
		},
		inject(deps, callback) {
			// An absent service (undefined) never satisfies a dependency, so cordis
			// holds the callback back — the harness must behave the same way.
			for (const dep of deps) {
				if (services[dep] === undefined) return undefined;
			}
			// The child fiber inherits the parent's inject list plus its own, so the
			// services passed in the dependency array become readable inside.
			const child = strictContext(services, new Set([...injected, ...deps]));
			callback(child);
			return undefined;
		},
		get(serviceName) {
			return services[serviceName];
		},
	};
	// Any other property read is a programming error, exactly like cordis.
	const proxy = new Proxy(ctx, {
		get(target, prop, receiver) {
			if (typeof prop === "string" && !(prop in target)) {
				// An injected service resolves from the live service table, exactly like cordis.
				if (prop in services) return services[prop];
				if (!injected.has(prop)) throw new Error(`cannot get property "${prop}" without inject`);
				return undefined;
			}
			return Reflect.get(target, prop, receiver);
		},
	});
	Object.defineProperty(proxy, "__report", {
		value: { registeredTools, registeredSections, registeredContexts, routes },
		enumerable: false,
	});
	return proxy;
}

/** A systemPrompt face that records what the plugin registers. */
function recordingSystemPrompt(bucket, contexts) {
	return {
		section(section) {
			bucket.push(section);
			return () => {};
		},
		context(context) {
			if (contexts !== undefined) contexts.push(context);
			return () => {};
		},
	};
}

// ---------------------------------------------------------------- activation
{
	const services = { webServer: undefined, tools: undefined, systemPrompt: undefined };
	const ctx = strictContext(services);
	// Recording service faces: the plugin reaches them through the inject list.
	services.webServer = {
		register(route) {
			ctx.__report.routes.push(route);
			return () => {};
		},
	};
	services.tools = {
		register(definition) {
			ctx.__report.registeredTools.push(definition);
			return () => {};
		},
	};
	services.systemPrompt = recordingSystemPrompt(ctx.__report.registeredSections, ctx.__report.registeredContexts);

	assert.doesNotThrow(() => apply(ctx, {}), "apply() must not throw with the declared inject list");
	assert.ok(ctx.__report.routes.length >= 1, "the /siyuan route is registered");
	const route = ctx.__report.routes[0];
	assert.equal(route.path, "/siyuan");
	assert.equal(typeof route.handler, "function");
	assert.ok(ctx.__report.registeredTools.length >= 1, "the context tool is registered");
	assert.equal(ctx.__report.registeredTools[0].name, "siyuan_note_context");
	assert.ok(ctx.__report.registeredSections.length >= 1, "the prompt section is registered");
	assert.equal(ctx.__report.registeredSections[0].name, "siyuan-notes-editor-context");
	assert.equal(typeof ctx.__report.registeredSections[0].text, "function");
	// Nothing open yet, so the section contributes no text at all.
	assert.equal(ctx.__report.registeredSections[0].text(), "");
	// 七个工具：编辑器三项，以及四个记忆工具（search / read / write / distill）。
	// memory_topics / memory_checkup 在契约 v5 收掉：同主题状态自动取代，体检只在面板里做。
	// memory_confirm / memory_review 已随
	// 「写入即生效」契约删除（2026-11-11），模型不再有二次确认入口——这里同时守住
	// 「删掉的入口不许悄悄回来」这条边界。
	// 顺序就是注册顺序，动它的人要在这里同步（这条断言存在的意义就是逼你面对这个清单）。
	assert.deepEqual(
		ctx.__report.registeredTools.map((tool) => tool.name),
		["siyuan_note_context", "siyuan_note_insert_image", "siyuan_note_insert_text", "memory_search", "memory_read", "memory_write", "memory_distill"],
	);
	for (const removed of ["memory_confirm", "memory_review", "memory_topics", "memory_checkup"]) {
		assert.ok(
			!ctx.__report.registeredTools.some((tool) => tool.name === removed),
			removed + " 已删除：写入即生效，不再需要模型自行确认或复核",
		);
	}
	// 压力提醒走 runtime context，不占冻结的 section。
	const hint = ctx.__report.registeredContexts.find((entry) => entry.name === "siyuan-notes-memory-hint");
	assert.ok(hint, "压力提醒注册成 runtime context");
	assert.equal(typeof hint.text, "function");
	assert.equal(hint.text(), "", "没有压力时不产生任何文本");
	assert.ok(hint.order > 100 && hint.order < 200, "落在会话级 context 的区间里");
}

// ---------------------------------------------------------------- optional services
{
	// A profile without the tool registry or the prompt registry must still boot
	// the routes: those faces are optional, the web carrier is not.
	const services = { webServer: undefined, tools: undefined, systemPrompt: undefined };
	services.webServer = {
		register(route) {
			ctx.__report.routes.push(route);
			return () => {};
		},
	};
	const ctx = strictContext(services);
	assert.doesNotThrow(() => apply(ctx, {}), "apply() must tolerate a missing tools service");
	assert.equal(ctx.__report.routes.length, 1, "routes still register without a tool registry");
	assert.equal(ctx.__report.registeredTools.length, 0, "no tool is registered when the registry is absent");
}

// ---------------------------------------------------------------- route liveness
{
	const ctx = strictContext({ webServer: { register: (route) => (ctx.__report.routes.push(route), () => {}) } });
	apply(ctx, {});
	const handler = ctx.__report.routes[0].handler;

	const call = async (method, url, body) => {
		const text = body === undefined ? "" : JSON.stringify(body);
		const stream = Readable.from(text === "" ? [] : [Buffer.from(text, "utf8")]);
		stream.method = method;
		stream.url = url;
		const res = {
			statusCode: 0,
			body: "",
			writeHead(code) {
				this.statusCode = code;
				return this;
			},
			end(chunk) {
				this.body = chunk ?? "";
			},
		};
		await handler(stream, res);
		return { status: res.statusCode, json: res.body ? JSON.parse(res.body) : null };
	};

	const context = await call("POST", ROUTES.context, { docId: "d1", title: "文档" });
	assert.equal(context.status, 200, "the context route answers once the plugin activates");
	assert.equal(context.json.value.accepted, true);

	// /siyuan/memory 是给面板与排错用的：GET 返回运行中进程里那份常驻注入文本，
	// POST 用来撤销/恢复一条记忆。这里只验证路由挂上且参数校验生效——
	// 真正的 GET 会去连内核，测试环境没有内核，不该拖慢用例。
	assert.equal(typeof ROUTES.memory, "string");
	const badAction = await call("POST", ROUTES.memory, { id: "20261106115529-u2ccn40", action: "nonsense" });
	assert.equal(badAction.status, 400, "the memory route rejects an unknown action");
	assert.equal(badAction.json.error.code, "invalid_action");
}

console.log(`activation: apply() survives a strict cordis context (${name})`);
