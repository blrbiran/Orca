import { createHash } from "node:crypto";
import { ControlError } from "./errors.js";

function fail(): never {
  throw new ControlError("control-non-canonical-json");
}

function hasLoneSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return true;
    }
  }
  return false;
}

function encode(value: unknown, stack: Set<object>): string {
  if (value === null || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "string") {
    if (hasLoneSurrogate(value)) fail();
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || Object.is(value, -0)) fail();
    return JSON.stringify(value);
  }
  if (typeof value !== "object") fail();
  if (stack.has(value)) fail();

  stack.add(value);
  try {
    if (Array.isArray(value)) {
      const ownKeys = Reflect.ownKeys(value);
      if (
        ownKeys.some(
          (key) =>
            typeof key !== "string" ||
            (key !== "length" && (!/^(?:0|[1-9]\d*)$/.test(key) || Number(key) >= value.length)),
        )
      ) {
        fail();
      }
      const items: string[] = [];
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.hasOwn(value, index)) fail();
        items.push(encode(value[index], stack));
      }
      return `[${items.join(",")}]`;
    }

    if (Object.getPrototypeOf(value) !== Object.prototype) fail();
    const keys = Reflect.ownKeys(value);
    if (keys.some((key) => typeof key !== "string")) fail();
    const stringKeys = keys as string[];
    for (const key of stringKeys) {
      if (hasLoneSurrogate(key)) fail();
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor?.enumerable || !("value" in descriptor)) fail();
    }
    stringKeys.sort();
    return `{${stringKeys
      .map((key) => `${JSON.stringify(key)}:${encode((value as Record<string, unknown>)[key], stack)}`)
      .join(",")}}`;
  } finally {
    stack.delete(value);
  }
}

export function canonicalBytes(value: unknown): Buffer {
  return Buffer.from(encode(value, new Set()), "utf8");
}

export function sha256Canonical(value: unknown): string {
  return createHash("sha256").update(canonicalBytes(value)).digest("hex");
}
