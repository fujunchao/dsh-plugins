import test from "node:test";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { buildImageFilename, detectImageFormat, extensionFor, slugify } from "../lib/images.js";

const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

test("detectImageFormat recognizes PNG / JPEG / WebP / GIF magic bytes", () => {
  assert.deepEqual(detectImageFormat(PNG_1X1), { mime: "image/png", ext: "png" });
  assert.deepEqual(detectImageFormat(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0])), {
    mime: "image/jpeg",
    ext: "jpg",
  });
  const webp = Buffer.alloc(12);
  webp.write("RIFF", 0, "ascii");
  webp.write("WEBP", 8, "ascii");
  assert.deepEqual(detectImageFormat(webp), { mime: "image/webp", ext: "webp" });
  const gif = Buffer.alloc(12);
  gif.write("GIF89a", 0, "ascii");
  assert.deepEqual(detectImageFormat(gif), { mime: "image/gif", ext: "gif" });
  assert.equal(detectImageFormat(Buffer.from("not an image at all!!")), undefined);
  assert.equal(detectImageFormat(Buffer.alloc(8)), undefined);
});

test("slugify keeps CJK and folds unsafe characters", () => {
  assert.equal(slugify("城市夜景 skyline"), "城市夜景-skyline");
  assert.equal(slugify('a/b\\c:d*e?f"g<h>i|j#k'), "abcdefghijk");
  assert.equal(slugify("   ---   "), "image");
  assert.equal(slugify(undefined), "image");
  assert.ok(slugify("很长的提示词".repeat(20)).length <= 30);
});

test("buildImageFilename embeds prefix, stamp and index", () => {
  const name = buildImageFilename("城市夜景", 2, "png", new Date(2026, 9, 15, 8, 5, 3));
  assert.match(name, /^城市夜景-20261015-080503-2\.png$/);
});

test("extensionFor prefers configured format then magic bytes then png", () => {
  assert.equal(extensionFor(PNG_1X1, "jpeg"), "jpg");
  assert.equal(extensionFor(PNG_1X1, "webp"), "webp");
  assert.equal(extensionFor(PNG_1X1, "auto"), "png");
  assert.equal(extensionFor(Buffer.from("????"), undefined), "png");
  assert.equal(extensionFor(PNG_1X1, undefined), "png");
});
