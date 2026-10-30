// Resolves the "@/..." path alias (tsconfig paths) when running TS sources directly in Node.
import { pathToFileURL } from "node:url";
import path from "node:path";
import fs from "node:fs";
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
export async function resolve(specifier, context, next) {
  if (specifier.startsWith("@/")) {
    let p = path.join(root, specifier.slice(2));
    if (!fs.existsSync(p)) p += ".ts";
    return { url: pathToFileURL(p).href, shortCircuit: true };
  }
  return next(specifier, context);
}
