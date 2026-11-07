import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";

test("configured disk preserves application records across independent processes", t => {
  const directory = mkdtempSync(join(tmpdir(), "nestly-disk-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const env = { ...process.env, NODE_ENV: "test", NESTLY_DATA_DIRECTORY: directory };
  const run = source => execFileSync(process.execPath, ["--input-type=module", "-e", source], { env, encoding: "utf8" });
  run("import {createDb} from './server.js'; const db=createDb(); db.prepare('INSERT INTO inquiries(listing_id,name,phone,message,created_at) VALUES(1,?,?,?,?)').run('Disk probe','+79990000000','Synthetic fixture','2026-11-07T00:00:00Z'); db.close();");
  assert.equal(existsSync(join(directory, "nestly.db")), true);
  assert.equal(run("import {createDb} from './server.js'; const db=createDb(); console.log(db.prepare(\"SELECT count(*) n FROM inquiries i JOIN inquiry_events e ON e.inquiry_id=i.id WHERE i.name='Disk probe'\").get().n); db.close();").trim(), "1");
});

test("persistent data cannot be served as public static files", () => {
  for (const directory of [resolve("public"), resolve("public/private")])
    assert.throws(() => execFileSync(process.execPath, ["--input-type=module", "-e", "import {dataDirectory} from './storage.js'; dataDirectory();"], { env: { ...process.env, NESTLY_DATA_DIRECTORY: directory }, stdio: "pipe" }));
});
