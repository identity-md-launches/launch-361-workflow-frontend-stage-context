import { readFile, readdir, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { keccak256, toHex } from "viem";
const root = fileURLToPath(new URL("../../", import.meta.url));
const read = async (p) => JSON.parse(await readFile(root + p, "utf8"));
const m = await read("dist/imd-deployment.json"),
  d = await read("web/config/deployment-handoff.json"),
  n = await read("web/config/network-handoff.json");
for (const field of [
  "version",
  "launchId",
  "chainId",
  "sourceCommit",
  "attestationHash",
])
  assert.deepEqual(m[field], d[field]);
assert.deepEqual(m.network, n.network);
assert.deepEqual(m.walletAddChain, n.walletAddChain);
assert.deepEqual(
  m.contracts.map(({ abiPath, ...c }) => c),
  d.contracts.map(({ name, address, abiHash }) => ({ name, address, abiHash })),
);
const files = [];
async function walk(dir = "") {
  for (const item of await readdir(root + "dist/" + dir, {
    withFileTypes: true,
  })) {
    const p = dir + item.name;
    if (item.isDirectory()) await walk(p + "/");
    else {
      assert(item.isFile());
      if (p !== "imd-deployment.json") files.push(p);
    }
  }
}
await walk();
assert.deepEqual(m.assets.map((a) => a.path).sort(), files.sort());
assert(m.assets.length <= 128);
let total = 0;
for (const asset of m.assets) {
  assert(
    !asset.path.startsWith("/") &&
      !asset.path.includes("..") &&
      !asset.path.includes(":"),
  );
  const bytes = await readFile(root + "dist/" + asset.path);
  assert(bytes.length <= 8388608);
  total += bytes.length;
  assert.match(asset.sha256, /^[a-f0-9]{64}$/);
  assert.equal(asset.sha256, createHash("sha256").update(bytes).digest("hex"));
}
assert(total < 32 * 1024 * 1024);
const sort = (v) =>
  Array.isArray(v)
    ? v.map(sort)
    : v && typeof v === "object"
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, sort(v[k])]),
        )
      : v;
for (const c of m.contracts) {
  const abi = await read("dist/" + c.abiPath);
  assert(Array.isArray(abi));
  assert.equal(keccak256(toHex(JSON.stringify(sort(abi)))).slice(2), c.abiHash);
}
const html = await readFile(root + "dist/index.html", "utf8");
assert(html.includes("./assets/"));
console.log(
  `PASS: handoff, network, wallet-add-chain, ${m.contracts.length} ABIs, ${files.length} assets, ${total} asset bytes; relative entrypoint.`,
);
