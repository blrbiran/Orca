/**
 * Project registry spec §2/§3: the file is the person's project list, so its shape is strict (a typo is an invalid
 * file, never silently ignored), its writes are atomic and never widen its mode, and an id, once derived, is what
 * the control store and the review rows are keyed by -- so the derivation is pinned here.
 */
import { mkdtempSync, readFileSync, statSync, writeFileSync, chmodSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { deriveProjectId, projectsFilePath, readProjectsFile, sameSignature, writeProjectsFile, type ProjectsFileV1 } from "../../src/panel/projectsFile.js";

const dir = (): string => mkdtempSync(join(tmpdir(), "projects-file-"));
const config = (over: Partial<ProjectsFileV1> = {}): ProjectsFileV1 => ({ version: 1, projects: [{ id: "orca", name: "orca", path: "/abs/orca" }], ...over });

describe("projectsFilePath", () => {
  it("P1: is ORCA_PROJECTS_FILE when set, else ~/.orca/projects.json", () => {
    expect(projectsFilePath({ ORCA_PROJECTS_FILE: "/x/p.json" })).toBe("/x/p.json");
    expect(projectsFilePath({ ORCA_PROJECTS_FILE: "" }).endsWith(join(".orca", "projects.json"))).toBe(true);
  });
});

describe("deriveProjectId", () => {
  it("F1: lowercases and replaces every run outside [a-z0-9._-] with one dash, trimming dashes and dots", () => {
    expect(deriveProjectId("My Web App!", "/r/x", new Set())).toBe("my-web-app");
    expect(deriveProjectId("..Orca..", "/r/x", new Set())).toBe("orca");
  });
  it("F2: appends -2, -3 on collision", () => {
    expect(deriveProjectId("orca", "/r/x", new Set(["orca", "orca-2"]))).toBe("orca-3");
  });
  it("F3: falls back to the path's last segment, then to project", () => {
    expect(deriveProjectId("订单", "/repos/order-svc", new Set())).toBe("order-svc");
    expect(deriveProjectId("订单", "/repos/订单", new Set())).toBe("project");
  });
});

describe("readProjectsFile", () => {
  it("R1: a missing file is missing, not invalid", () => {
    expect(readProjectsFile(join(dir(), "projects.json"))).toEqual({ kind: "missing", signature: null, hash: null });
  });
  it("R2: reads a valid file with its signature and hash", () => {
    const file = join(dir(), "projects.json");
    writeFileSync(file, JSON.stringify(config({ controlStateDir: "/abs/state" })));
    const read = readProjectsFile(file);
    expect(read.kind).toBe("valid");
    if (read.kind !== "valid") return;
    expect(read.config.controlStateDir).toBe("/abs/state");
    expect(read.hash).toMatch(/^[0-9a-f]{64}$/);
  });
  it.each([
    ["not json", "{"],
    ["unknown top-level key", JSON.stringify({ ...config(), extra: 1 })],
    ["unknown project key", JSON.stringify({ version: 1, projects: [{ id: "a", name: "a", path: "/a", x: 1 }] })],
    ["wrong version", JSON.stringify({ ...config(), version: 2 })],
    ["relative path", JSON.stringify({ version: 1, projects: [{ id: "a", name: "a", path: "a" }] })],
    ["bad id", JSON.stringify({ version: 1, projects: [{ id: "A b", name: "a", path: "/a" }] })],
    ["blank name", JSON.stringify({ version: 1, projects: [{ id: "a", name: "  ", path: "/a" }] })],
    ["duplicate id", JSON.stringify({ version: 1, projects: [{ id: "a", name: "a", path: "/a" }, { id: "a", name: "b", path: "/b" }] })],
    ["duplicate name", JSON.stringify({ version: 1, projects: [{ id: "a", name: "x", path: "/a" }, { id: "b", name: "x", path: "/b" }] })],
    ["duplicate path", JSON.stringify({ version: 1, projects: [{ id: "a", name: "a", path: "/a" }, { id: "b", name: "b", path: "/a" }] })],
    ["relative controlStateDir", JSON.stringify({ ...config(), controlStateDir: "state" })],
  ])("R3: %s is invalid, with a reason", (_label, text) => {
    const file = join(dir(), "projects.json");
    writeFileSync(file, text);
    const read = readProjectsFile(file);
    expect(read.kind).toBe("invalid");
    if (read.kind === "invalid") expect(read.reason.length).toBeGreaterThan(0);
  });
});

describe("writeProjectsFile", () => {
  it("W1: creates the directory 0700 and the file 0600, and reads back what it wrote", () => {
    const file = join(dir(), "nested", "projects.json");
    const written = writeProjectsFile(file, config());
    expect(statSync(join(file, "..")).mode & 0o777).toBe(0o700);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    const read = readProjectsFile(file);
    expect(read.kind === "valid" && read.config).toEqual(config());
    expect(read.kind === "valid" && read.hash).toBe(written.hash);
    expect(sameSignature(read.signature, written.signature)).toBe(true);
  });
  it("W2: keeps an existing file's mode and an existing directory's mode", () => {
    const root = dir();
    chmodSync(root, 0o755);
    const file = join(root, "projects.json");
    writeFileSync(file, JSON.stringify(config()));
    chmodSync(file, 0o644);
    writeProjectsFile(file, config({ projects: [] }));
    expect(statSync(file).mode & 0o777).toBe(0o644);
    expect(statSync(root).mode & 0o777).toBe(0o755);
  });
  it("W3: leaves no temp file beside it", () => {
    const root = dir();
    writeProjectsFile(join(root, "projects.json"), config());
    expect(readdirSync(root)).toEqual(["projects.json"]);
  });
  it("W4: replaces the file atomically (a new inode), so a reader never sees half a file", () => {
    const file = join(dir(), "projects.json");
    writeProjectsFile(file, config());
    const before = statSync(file).ino;
    writeProjectsFile(file, config({ projects: [] }));
    expect(statSync(file).ino).not.toBe(before);
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual(config({ projects: [] }));
  });
});

it("S1: sameSignature compares all four fields", () => {
  const s = { mtimeNs: 1n, size: 2n, ino: 3n, ctimeNs: 4n };
  expect(sameSignature(s, { ...s })).toBe(true);
  for (const key of ["mtimeNs", "size", "ino", "ctimeNs"] as const) expect(sameSignature(s, { ...s, [key]: 9n })).toBe(false);
  expect(sameSignature(null, null)).toBe(true);
  expect(sameSignature(s, null)).toBe(false);
});
