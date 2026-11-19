import test from "node:test";
import assert from "node:assert/strict";

import { redactSecrets } from "../lib/redact.js";

test("sk- 键被替换，保留长度", () => {
  const secret = `sk-${"a".repeat(24)}`;
  const output = redactSecrets(secret);
  assert.equal(output, "<redacted: api-key, 27 chars>");
  assert.ok(!output.includes(secret));
});

test("Bearer token 保留前缀", () => {
  const output = redactSecrets("Authorization: Bearer abcdefghijklmnopqrstuvwxyz012345");
  assert.equal(output, "Authorization: Bearer <redacted: auth-token, 32 chars>");
});

test("--password 保留命令行结构", () => {
  const output = redactSecrets("ssh --password hunter2 --host 1.2.3.4");
  assert.equal(output, "ssh --password <redacted: password, 7 chars> --host 1.2.3.4");
});

test("password= 的引号被保留", () => {
  assert.equal(redactSecrets('password="abc12345"'), 'password="<redacted: password, 8 chars>"');
});

test("URL 里的 user:password 只打码密码", () => {
  const output = redactSecrets("postgres://user:supersecret@db.local/app");
  assert.equal(output, "postgres://user:<redacted: password, 11 chars>@db.local/app");
});

test("环境变量赋值被识别", () => {
  const output = redactSecrets("DEEPSEEK_API_KEY=abcdef1234567890abcdef");
  assert.ok(output.startsWith("DEEPSEEK_API_KEY=<redacted: "), output);
  assert.ok(!output.includes("abcdef1234567890abcdef"), output);
});

test("JSON 形式的键被识别", () => {
  const output = redactSecrets('{"apiKey":"abcdef123456"}');
  assert.equal(output, '{"apiKey":"<redacted: json-secret, 12 chars>"}');
});

test("PEM 私钥整块收走", () => {
  const pem = "-----BEGIN OPENSSH PRIVATE KEY-----\nAAAA\nBBBB\n-----END OPENSSH PRIVATE KEY-----";
  const output = redactSecrets(pem);
  assert.ok(output.startsWith("<redacted: private-key, "), output);
  assert.ok(!output.includes("AAAA"));
});

test("无害文本不被误伤", () => {
  for (const text of [
    'const passwordField = "x"',
    "password=***",
    "the password policy is strict",
    "tokens are counted per request",
  ]) {
    assert.equal(redactSecrets(text), text, text);
  }
});

test("幂等：打过的码不会被二次打码", () => {
  const once = redactSecrets('password="abc12345" and sk-aaaaaaaaaaaaaaaaaaaa');
  assert.equal(redactSecrets(once), once);
});

test("Authorization: Token <value> 保留 scheme 名", () => {
  const output = redactSecrets("curl -H 'Authorization: Token s3cr3t-tk' http://x");
  assert.equal(output, "curl -H 'Authorization: Token <redacted: auth-token, 9 chars>' http://x");
});

test("裸 Token <value> 与散文里的 token <value> 都打码", () => {
  assert.ok(redactSecrets("Token abc123def0").includes("<redacted: auth-token, 10 chars>"));
  const prose = redactSecrets("SiYuan kernel at http://192.0.2.10:6806 with token s3cr3t-tk. I can fetch the doc.");
  assert.ok(prose.includes("<redacted: secret, 9 chars>"), prose);
  assert.ok(!prose.includes("s3cr3t-tk"), prose);
});

test("“token generation”这类普通词组不被误伤", () => {
  for (const text of ["token generation is slow", "the token budget grows", "password policy is strict"]) {
    assert.equal(redactSecrets(text), text, text);
  }
});

test("长文档里的多处命中都被处理", () => {
  const text = [
    "password=firstvalue",
    "normal line",
    '{"token":"zzzzzzzzzz"}',
  ].join("\n");
  const output = redactSecrets(text);
  assert.ok(!output.includes("firstvalue"), output);
  assert.ok(!output.includes("zzzzzzzzzz"), output);
  assert.ok(output.includes("normal line"), output);
});
