import path from "node:path";
import { fileURLToPath } from "node:url";

// Resolving from the built module keeps storage paths stable whether the
// server is started by the development workflow or from the repository root.
const apiPackageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

export const UPLOADS_DIR = path.join(apiPackageRoot, "uploads");
export const OUTPUT_DIR = path.join(apiPackageRoot, "output");
