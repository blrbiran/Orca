/**
 * Multi-directory projects spec §4.1 (M1): `multiDirProjects` is an optional top-level list whose SHAPE the file schema
 * checks -- ids, a non-blank name, 2..8 distinct member ids in order, and ids and names unique across both lists. A file
 * without the key re-saves byte for byte, and a member whose reference is broken is the loader's problem, never the
 * schema's, so a file naming an unknown member still parses.
 */
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readProjectsFile, writeProjectsFile, type ProjectsFileV1 } from "../../src/panel/projectsFile.js";

const dir = (): string => mkdtempSync(join(tmpdir(), "projects-multi-file-"));
const single = { id: "alpha", name: "Alpha", path: "/abs/alpha" };
const file = (over: Partial<ProjectsFileV1> = {}): ProjectsFileV1 => ({ version: 1, projects: [single], ...over });
const text = (value: ProjectsFileV1): string => `${JSON.stringify(value, null, 2)}\n`;
const read = (value: ProjectsFileV1) => {
  const path = join(dir(), "projects.json");
  writeFileSync(path, text(value));
  return readProjectsFile(path);
};

describe("multiDirProjects schema", () => {
  it("M1: accepts 2..8 distinct member ids in order and keeps that order", () => {
    const config = file({ multiDirProjects: [{ id: "shop", name: "Shop (web + api)", dirs: ["zeta", "alpha", "beta"] }] });
    const parsed = read(config);
    expect(parsed.kind).toBe("valid");
    if (parsed.kind === "valid") expect(parsed.config.multiDirProjects).toEqual(config.multiDirProjects);
    expect(read(file({ multiDirProjects: [{ id: "two", name: "Two", dirs: ["a", "b"] }] })).kind).toBe("valid");
    expect(read(file({ multiDirProjects: [{ id: "eight", name: "Eight", dirs: ["a", "b", "c", "d", "e", "f", "g", "h"] }] })).kind).toBe("valid");
  });

  it("M1: a file without the key re-saves byte for byte and is never given one", () => {
    const path = join(dir(), "projects.json");
    writeFileSync(path, text(file()));
    const before = readFileSync(path);
    const parsed = readProjectsFile(path);
    expect(parsed.kind).toBe("valid");
    if (parsed.kind !== "valid") return;
    expect("multiDirProjects" in parsed.config).toBe(false);
    writeProjectsFile(path, parsed.config);
    expect(readFileSync(path).equals(before)).toBe(true);
  });

  it("M1: a file with the key re-saves byte for byte too", () => {
    const path = join(dir(), "projects.json");
    const config = file({ multiDirProjects: [{ id: "shop", name: "Shop", dirs: ["alpha", "beta"] }] });
    writeFileSync(path, text(config));
    const before = readFileSync(path);
    const parsed = readProjectsFile(path);
    expect(parsed.kind).toBe("valid");
    if (parsed.kind !== "valid") return;
    writeProjectsFile(path, parsed.config);
    expect(readFileSync(path).equals(before)).toBe(true);
  });

  it("M1: an id clash across the two lists is invalid by name", () => {
    const parsed = read(file({ multiDirProjects: [{ id: "alpha", name: "Shop", dirs: ["x", "y"] }] }));
    expect(parsed.kind).toBe("invalid");
    if (parsed.kind === "invalid") expect(parsed.reason).toMatch(/duplicate id/);
  });

  it("M1: a name clash across the two lists is invalid by name", () => {
    const parsed = read(file({ multiDirProjects: [{ id: "shop", name: "Alpha", dirs: ["x", "y"] }] }));
    expect(parsed.kind).toBe("invalid");
    if (parsed.kind === "invalid") expect(parsed.reason).toMatch(/duplicate name/);
  });

  it("M1: two multi entries sharing an id or a name are invalid by name", () => {
    const idClash = read(file({ multiDirProjects: [
      { id: "shop", name: "Shop", dirs: ["x", "y"] },
      { id: "shop", name: "Shop Two", dirs: ["x", "y"] },
    ] }));
    expect(idClash.kind).toBe("invalid");
    if (idClash.kind === "invalid") expect(idClash.reason).toMatch(/duplicate id/);
    const nameClash = read(file({ multiDirProjects: [
      { id: "shop", name: "Shop", dirs: ["x", "y"] },
      { id: "store", name: "Shop", dirs: ["x", "y"] },
    ] }));
    expect(nameClash.kind).toBe("invalid");
    if (nameClash.kind === "invalid") expect(nameClash.reason).toMatch(/duplicate name/);
  });

  it("M1: fewer than 2 or more than 8 members is invalid", () => {
    expect(read(file({ multiDirProjects: [{ id: "one", name: "One", dirs: ["alpha"] }] })).kind).toBe("invalid");
    expect(read(file({ multiDirProjects: [{ id: "nine", name: "Nine", dirs: ["a", "b", "c", "d", "e", "f", "g", "h", "i"] }] })).kind).toBe("invalid");
  });

  it("M1: a member id listed twice is invalid", () => {
    const parsed = read(file({ multiDirProjects: [{ id: "shop", name: "Shop", dirs: ["alpha", "alpha"] }] }));
    expect(parsed.kind).toBe("invalid");
    if (parsed.kind === "invalid") expect(parsed.reason).toMatch(/duplicate member/);
  });

  it("M1: a member id outside the id pattern is invalid", () => {
    expect(read(file({ multiDirProjects: [{ id: "shop", name: "Shop", dirs: ["alpha", "Beta"] }] })).kind).toBe("invalid");
  });

  it("M1: an unknown member is accepted by the schema; the loader decides", () => {
    expect(read(file({ multiDirProjects: [{ id: "shop", name: "Shop", dirs: ["alpha", "ghost"] }] })).kind).toBe("valid");
  });

  it("M1: nested members are accepted by the schema; the loader decides", () => {
    const nested = { id: "inner", name: "Inner", path: "/abs/alpha/inner" };
    expect(read({ version: 1, projects: [single, nested], multiDirProjects: [{ id: "shop", name: "Shop", dirs: ["alpha", "inner"] }] }).kind).toBe("valid");
  });

  it("M1: the multi entry is strict about unknown keys", () => {
    expect(read({ version: 1, projects: [single], multiDirProjects: [{ id: "shop", name: "Shop", dirs: ["a", "b"], extra: 1 }] } as never).kind).toBe("invalid");
  });
});
