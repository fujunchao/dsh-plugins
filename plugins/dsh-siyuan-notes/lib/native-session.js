// 保存思源签发的会话；Windows 使用当前用户的 DPAPI，不另存锁屏密码。
import { createHash, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

export const NATIVE_SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_RECORD_BYTES = 128 * 1024;

export function nativeConnectionKey(settings) {
  return createHash("sha256").update(JSON.stringify([settings.baseUrl, settings.token || ""])).digest("hex");
}

/** 只取登录 Cookie；尊重服务端期限，且本地最多保留 30 天。 */
export function readNativeLoginCookie(setCookies, now = Date.now()) {
  for (const header of setCookies || []) {
    const parts = header.split(";").map(part => part.trim());
    if (!/^siyuan=.+/.test(parts[0]) || /[\r\n]/.test(header)) continue;
    const maxAge = parts.find(part => /^max-age=/i.test(part));
    const expires = parts.find(part => /^expires=/i.test(part));
    let expiresAt = null;
    if (maxAge) {
      const raw = maxAge.slice(maxAge.indexOf("=") + 1);
      if (/^-?\d+$/.test(raw)) expiresAt = now + Number(raw) * 1000;
    } else if (expires) {
      const parsed = Date.parse(expires.slice(expires.indexOf("=") + 1));
      if (Number.isFinite(parsed)) expiresAt = parsed;
    }
    if (expiresAt !== null) expiresAt = Math.min(expiresAt, now + NATIVE_SESSION_MAX_AGE_MS);
    return { cookie: parts[0], expiresAt };
  }
  return null;
}

/** 凭据仅走标准输入/输出，不出现在进程命令行或错误日志中。 */
async function windowsProtect(operation, value, context) {
  if (process.platform !== "win32") throw new Error("当前平台尚不支持安全保存登录会话");
  const source = String.raw`
$ErrorActionPreference = 'Stop'
try {
  Add-Type -AssemblyName System.Security
  $request = [Console]::In.ReadToEnd() | ConvertFrom-Json
  $bytes = [Convert]::FromBase64String($request.data)
  $entropy = [Convert]::FromBase64String($request.context)
  if ($request.operation -eq 'protect') {
    $result = [Security.Cryptography.ProtectedData]::Protect($bytes, $entropy, [Security.Cryptography.DataProtectionScope]::CurrentUser)
  } else {
    $result = [Security.Cryptography.ProtectedData]::Unprotect($bytes, $entropy, [Security.Cryptography.DataProtectionScope]::CurrentUser)
  }
  [Console]::Out.Write([Convert]::ToBase64String($result))
} catch { [Console]::Error.Write('credential protection failed'); exit 1 }
`;
  // 系统盘位置从环境变量取，不写死：SystemRoot/windir 正常都有；都没有时交给 PATH 解析。
  const systemRoot = process.env.SystemRoot || process.env.windir || "";
  const executable = systemRoot
    ? path.join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
    : "powershell.exe";
  return new Promise((resolve, reject) => {
    const child = spawn(executable, ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", source], { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    const chunks = [];
    let size = 0;
    let failed = false;
    const fail = () => { failed = true; child.kill(); };
    const timer = setTimeout(fail, 15000);
    child.stdout.on("data", chunk => { size += chunk.length; if (size > MAX_RECORD_BYTES) fail(); else chunks.push(chunk); });
    child.stderr.resume();
    child.stdin.on("error", () => { failed = true; });
    child.on("error", () => { clearTimeout(timer); reject(new Error("无法启动系统凭据保护服务")); });
    child.on("close", code => {
      clearTimeout(timer);
      const encoded = Buffer.concat(chunks).toString("ascii").trim();
      if (failed || code !== 0 || !encoded || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) { reject(new Error("无法保护或读取当前 Windows 用户的登录会话")); return; }
      resolve(Buffer.from(encoded, "base64"));
    });
    child.stdin.end(JSON.stringify({ operation, data: Buffer.from(value).toString("base64"), context: Buffer.from(context).toString("base64") }));
  });
}

export const protectNativeSession = (value, context) => windowsProtect("protect", value, context);
export const unprotectNativeSession = (value, context) => windowsProtect("unprotect", value, context);

/** 接口只接收连接身份、Cookie 和期限；保存前加密，原子替换，写失败后仍可重试。 */
export function createNativeSessionStore({ directory, protect = protectNativeSession, unprotect = unprotectNativeSession, now = Date.now }) {
  let queue = Promise.resolve();
  const inOrder = (task) => {
    const result = queue.then(task);
    queue = result.catch(() => {});
    return result;
  };
  const fileFor = settings => path.join(directory, nativeConnectionKey(settings) + ".json");
  const entropyFor = settings => Buffer.from("dsh-siyuan-native:v1:" + nativeConnectionKey(settings));
  const valid = (record, settings) => record?.version === 1 && record.connection === nativeConnectionKey(settings) &&
    typeof record.cookie === "string" && /^siyuan=[^;\r\n]+$/.test(record.cookie) && record.cookie.length <= 32768 &&
    Number.isFinite(record.createdAt) && Number.isFinite(record.expiresAt) && record.createdAt <= now() &&
    record.expiresAt > now() && record.expiresAt - record.createdAt <= NATIVE_SESSION_MAX_AGE_MS;
  return {
    load(settings) {
      return inOrder(async () => {
        const file = fileFor(settings);
        let raw;
        try { raw = await readFile(file, "utf8"); }
        catch (error) { if (error.code === "ENOENT") return null; throw new Error("无法读取本地登录记录，请检查目录权限"); }
        try {
          if (raw.length > MAX_RECORD_BYTES) throw new Error("oversized");
          const stored = JSON.parse(raw);
          if (stored.version !== 1 || stored.protection !== "dpapi-current-user" || typeof stored.sealed !== "string") throw new Error("invalid record");
          const plaintext = await unprotect(Buffer.from(stored.sealed, "base64"), entropyFor(settings));
          let record;
          try { record = JSON.parse(plaintext.toString("utf8")); }
          finally { plaintext.fill(0); }
          if (!valid(record, settings)) throw new Error("invalid session");
          return { cookie: record.cookie, expiresAt: record.expiresAt };
        } catch {
          await rm(file, { force: true });
          return null;
        }
      });
    },
    save(settings, { cookie, expiresAt }) {
      return inOrder(async () => {
        const record = { version: 1, connection: nativeConnectionKey(settings), cookie, createdAt: now(), expiresAt };
        if (!valid(record, settings)) throw new Error("思源没有返回有效的持久登录期限");
        const plaintext = Buffer.from(JSON.stringify(record));
        let encrypted;
        try { encrypted = await protect(plaintext, entropyFor(settings)); }
        finally { plaintext.fill(0); }
        const file = fileFor(settings);
        const temporary = file + ".tmp-" + randomBytes(8).toString("hex");
        await mkdir(directory, { recursive: true, mode: 0o700 });
        try {
          await writeFile(temporary, JSON.stringify({ version: 1, protection: "dpapi-current-user", sealed: encrypted.toString("base64") }) + "\n", { mode: 0o600, flag: "wx" });
          await rename(temporary, file);
        } finally { await rm(temporary, { force: true }); }
      });
    },
    forget(settings) { return inOrder(() => rm(fileFor(settings), { force: true })); },
  };
}

/** 验证仅使用 Cookie，不能携带 API token，否则失效会话也会被误判为有效。 */
export async function validateNativeSession(settings, cookie) {
  let response;
  try {
    response = await fetch(settings.baseUrl + "/api/notebook/lsNotebooks", {
      method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie, Origin: new URL(settings.baseUrl).origin },
      body: "{}", redirect: "manual", signal: AbortSignal.timeout(10000),
    });
  } catch { throw new Error("暂时无法确认已保存的思源登录，请检查连接后重试"); }
  if ([401, 403].includes(response.status)) return false;
  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get("location") || "";
    if (location.includes("/check-auth")) return false;
  }
  if (!response.ok) throw new Error("思源暂时无法验证登录，已保留本地会话供稍后重试");
  let result;
  try { result = await response.json(); }
  catch { throw new Error("思源登录校验响应异常，请检查连接后重试"); }
  if (result.code === 0 && Array.isArray(result.data?.notebooks)) return true;
  // 普通业务故障不等同于登录失效，不清除用户的有效凭据。
  if (/unauthorized|unauthenticated|auth failed|鉴权失败|认证失败/i.test(result.msg || "")) return false;
  throw new Error("思源尚未确认登录状态，请稍后重试");
}
