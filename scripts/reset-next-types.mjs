import { lstatSync, readdirSync, realpathSync, rmSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export function resetNextTypes(root) {
  const base = realpathSync(root);
  const targets = [".next/types", ".next/dev/types"];
  function inspect(file, directory = false) {
    const stat = lstatSync(file, { throwIfNoEntry: false });
    if (!stat) return;
    if (stat.isSymbolicLink())
      throw new Error(`Symlinked generated-type path refused: ${file}`);
    if (directory && !stat.isDirectory())
      throw new Error(`Expected generated-type directory: ${file}`);
    if (!stat.isDirectory() && !stat.isFile())
      throw new Error(`Unsupported generated-type entry: ${file}`);
    return stat;
  }
  function inspectTree(file) {
    const stat = inspect(file);
    if (stat?.isDirectory())
      for (const name of readdirSync(file)) inspectTree(path.join(file, name));
  }
  // Validate both fixed generated trees before removing either one.
  for (const name of [".next", ".next/dev", ...targets])
    inspect(path.join(base, name), true);
  for (const name of targets) inspectTree(path.join(base, name));
  for (const name of targets)
    rmSync(path.join(base, name), { recursive: true, force: true });
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  resetNextTypes(process.cwd());
  console.log(
    "Generated Next.js type caches cleared; fresh type generation follows.",
  );
}
