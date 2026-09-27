import { readFile, writeFile, mkdir, readdir, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { keccak256, toHex } from "viem";
const root = fileURLToPath(new URL("../../", import.meta.url));
const read = async (p) => JSON.parse(await readFile(root + p, "utf8"));
export const canonical = (value) => JSON.stringify(sort(value));
function sort(v) {
  return Array.isArray(v)
    ? v.map(sort)
    : v && typeof v === "object"
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, sort(v[k])]),
        )
      : v;
}
const d = await read("web/config/deployment-handoff.json");
const n = await read("web/config/network-handoff.json");
if (
  d.chainId !== n.network.chainId ||
  Number(n.walletAddChain.chainId) !== d.chainId
)
  throw Error("Handoff chain mismatch");
await mkdir(root + "dist/abi", { recursive: true });
const contracts = [];
for (const c of d.contracts) {
  const bytes = await readFile(root + `web/config/abi/${c.name}.json`);
  const pinned = execFileSync(
    "git",
    ["show", `${d.sourceCommit}:docs/abi/${c.name}.json`],
    { cwd: root },
  );
  if (!bytes.equals(pinned))
    throw Error(`ABI differs from pinned source: ${c.name}`);
  const abi = JSON.parse(bytes);
  const hash = keccak256(toHex(canonical(abi))).slice(2);
  if (!Array.isArray(abi) || hash !== c.abiHash)
    throw Error(`ABI hash mismatch: ${c.name}: ${hash}`);
  const abiPath = `abi/${c.name}.json`;
  await writeFile(root + "dist/" + abiPath, bytes);
  contracts.push({
    name: c.name,
    address: c.address,
    abiHash: c.abiHash,
    abiPath,
  });
}
const assets = [];
async function walk(dir = "") {
  for (const e of await readdir(root + "dist/" + dir, {
    withFileTypes: true,
  })) {
    const p = dir + e.name;
    if (e.isDirectory()) await walk(p + "/");
    else if (p !== "imd-deployment.json") {
      if (!e.isFile()) throw Error("Unexpected export entry");
      const bytes = await readFile(root + "dist/" + p);
      if (bytes.length > 8388608) throw Error("Asset too large");
      assets.push({
        path: p,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      });
    }
  }
}
await walk();
assets.sort((a, b) => a.path.localeCompare(b.path));
if (assets.length > 128) throw Error("Too many exported assets");
const manifest = {
  version: 1,
  launchId: d.launchId,
  chainId: d.chainId,
  sourceCommit: d.sourceCommit,
  attestationHash: d.attestationHash,
  contracts,
  assets,
  network: n.network,
  walletAddChain: n.walletAddChain,
  pool: d.manifest.pool,
  token: d.manifest.token,
  deploymentBlock: Math.min(...d.contracts.map((c) => c.blockNumber)),
};
await writeFile(
  root + "dist/imd-deployment.json",
  JSON.stringify(manifest, null, 2) + "\n",
);
const size = (
  await Promise.all(assets.map((a) => stat(root + "dist/" + a.path)))
).reduce((n, s) => n + s.size, 0);
console.log(
  `Verified ${contracts.length} pinned ABIs; inventoried ${assets.length} assets (${size} bytes).`,
);
