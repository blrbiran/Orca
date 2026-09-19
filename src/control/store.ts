import { createRequire } from "node:module";
import type { DatabaseSync } from "node:sqlite";
import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ControlError } from "./errors.js";
import { assertRegular, privateDirectory, syncDirectory } from "./paths.js";
import { initialSchema, schemaVersion } from "./migrations.js";

interface Owner { nonce:string; pid:number; started:string; host:string; path:string }
function machineIdentity(): string {
  let raw: string;
  if (process.platform === "darwin") {
    raw = execFileSync("/usr/sbin/ioreg", ["-rd1", "-c", "IOPlatformExpertDevice"], {encoding:"utf8"}).match(/"IOPlatformUUID"\s*=\s*"([^"]+)"/)?.[1] ?? "";
  } else if (process.platform === "linux") raw = readFileSync("/etc/machine-id", "utf8").trim();
  else throw new ControlError("control-host-identity-unavailable");
  if (!/^[a-fA-F0-9-]{32,36}$/.test(raw)) throw new ControlError("control-host-identity-unavailable");
  return createHash("sha256").update(raw).digest("hex");
}
function readOwner(path: string): Owner {
  assertRegular(path);
  const owner = JSON.parse(readFileSync(path,"utf8")) as Owner;
  if (!owner.nonce || !Number.isSafeInteger(owner.pid) || owner.pid <= 0 || !owner.started || !owner.host || !owner.path) throw new ControlError("control-owner-invalid");
  return owner;
}
function definitelyDead(pid: number): boolean {
  try { process.kill(pid,0); return false; }
  catch (error) { return (error as NodeJS.ErrnoException).code === "ESRCH"; }
}
function privateIO<T>(fn:()=>T):T {
  const old = process.umask(0o077);
  try { return fn(); } finally { process.umask(old); }
}
export interface ControlStore {
  readonly stateDir:string;
  readonly db:DatabaseSync;
  dispatchBlocked:boolean;
  transaction<T>(fn:()=>T):T;
  assertOwner():void;
  beginOperation():()=>void;
  close():void;
}
export async function openControlStore(options:{stateDir:string;recovery?:boolean}):Promise<ControlStore> {
  const [major,minor,patch] = process.versions.node.split(".").map(Number);
  if (major < 22 || (major === 22 && (minor < 13 || (minor === 13 && patch < 1)))) throw new ControlError("control-node-unsupported");
  const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");
  const stateDir = privateDirectory(options.stateDir);
  const host = machineIdentity();
  const lock = join(stateDir,"service-lock");
  const ownerFile = join(lock,"owner.json");
  const owner:Owner = {nonce:randomUUID(),pid:process.pid,started:execFileSync("ps",["-p",String(process.pid),"-o","lstart="],{encoding:"utf8"}).trim(),host,path:stateDir};
  let recovered = false;
  try { mkdirSync(lock,{mode:0o700}); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    if (!options.recovery) throw new ControlError("control-writer-active");
    const recoveryLock = join(stateDir,"recovery-lock");
    try { mkdirSync(recoveryLock,{mode:0o700}); } catch { throw new ControlError("control-recovery-busy"); }
    try {
      const old = readOwner(ownerFile);
      if (old.host !== host || old.path !== stateDir) throw new ControlError("control-host-mismatch");
      if (!definitelyDead(old.pid)) throw new ControlError("control-writer-active");
      if (readOwner(ownerFile).nonce !== old.nonce) throw new ControlError("control-owner-changed");
      renameSync(lock,join(stateDir,"retired-lock-"+randomUUID()));
      mkdirSync(lock,{mode:0o700});
      recovered = true;
    } finally { rmSync(recoveryLock,{recursive:true}); }
  }
  let db:DatabaseSync|undefined;
  const release = () => {
    if (existsSync(ownerFile) && readOwner(ownerFile).nonce === owner.nonce) { rmSync(lock,{recursive:true}); syncDirectory(stateDir); }
  };
  try {
    const fd = openSync(ownerFile,"wx",0o600);
    try { writeFileSync(fd,JSON.stringify(owner)); fsyncSync(fd); } finally { closeSync(fd); }
    syncDirectory(lock); syncDirectory(stateDir);
    const dbPath = join(stateDir,"control.sqlite");
    if (existsSync(dbPath)) {
      assertRegular(dbPath);
      // Read-only validation leaves unknown schemas byte-for-byte unchanged.
      const probe = new DatabaseSync(dbPath,{readOnly:true});
      try {
        const version = probe.prepare("SELECT value FROM meta WHERE key='schemaVersion'").get()?.value;
        if (version !== schemaVersion) throw new ControlError("control-schema-unsupported");
        const identity = probe.prepare("SELECT value FROM meta WHERE key='identity'").get()?.value;
        if (identity !== JSON.stringify({host,path:stateDir})) throw new ControlError("control-host-mismatch");
      } finally { probe.close(); }
    } else {
      const fd = openSync(dbPath,"wx",0o600); closeSync(fd); syncDirectory(stateDir);
    }
    db = new DatabaseSync(dbPath);
    const connection = db;
    privateIO(() => {
      connection.exec("PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000; PRAGMA journal_mode=DELETE;");
      if (!connection.prepare("SELECT name FROM sqlite_master WHERE name='meta'").get()) {
        connection.exec("BEGIN IMMEDIATE");
        try {
          connection.exec(initialSchema);
          connection.prepare("INSERT INTO meta VALUES ('schemaVersion',?)").run(schemaVersion);
          connection.prepare("INSERT INTO meta VALUES ('identity',?)").run(JSON.stringify({host,path:stateDir}));
          connection.exec("COMMIT");
        } catch(error) { connection.exec("ROLLBACK"); throw error; }
      }
    });
    let closed = false;
    let inTransaction = false;
    let operationActive = false;
    const assertOwner=()=>{if(closed || readOwner(ownerFile).nonce!==owner.nonce) throw new ControlError("control-owner-changed");};
    return {
      stateDir, db:connection, dispatchBlocked:recovered || !!connection.prepare("SELECT id FROM runs WHERE active=1 LIMIT 1").get(),
      assertOwner,
      beginOperation() {
        assertOwner();if(operationActive) throw new ControlError("control-operation-in-progress");
        operationActive=true;let released=false;
        return ()=>{if(!released){released=true;operationActive=false;}};
      },
      transaction<T>(fn:()=>T):T {
        if (closed) throw new ControlError("control-store-closed");
        if (inTransaction) throw new ControlError("control-nested-transaction");
        return privateIO(() => {
          connection.exec("BEGIN IMMEDIATE"); inTransaction = true;
          try {
            const result = fn();
            if (result && typeof (result as {then?:unknown}).then === "function") throw new ControlError("control-async-transaction");
            connection.exec("COMMIT"); return result;
          } catch (error) { connection.exec("ROLLBACK"); throw error; }
          finally { inTransaction = false; }
        });
      },
      close() { if (closed) return; connection.close(); closed = true; release(); },
    };
  } catch(error) { db?.close(); release(); throw error; }
}
