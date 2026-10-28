// Generates RS256 keypair for JWT signing → ./keys/
// Usage: node scripts/generate-keys.mjs
import { generateKeyPairSync } from "node:crypto";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";

const dir = new URL("../keys/", import.meta.url);
mkdirSync(dir, { recursive: true });

const priv = new URL("jwt-private.pem", dir);
const pub = new URL("jwt-public.pem", dir);

if (existsSync(priv)) {
  console.log("keys/jwt-private.pem already exists — not overwriting");
  process.exit(0);
}

const { publicKey, privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

writeFileSync(priv, privateKey);
writeFileSync(pub, publicKey);
console.log("wrote keys/jwt-private.pem and keys/jwt-public.pem");
