/**
 * Whether this file is the process entry point.
 *
 * A name comparison is not enough. Through a bin shim — `npx`, or any global install — `argv[1]`
 * is a symlink whose basename is the command (`writing-flow`), while the module itself resolves to
 * `install.mjs`. A name check reports "not the entry point", and the CLI exits `0` having done
 * nothing at all: the failure is silent, so `npx -y <package>` looks like it worked.
 *
 * Compare real paths instead. Node resolves the module path to its target, so both sides agree
 * whether the process was started as `node bin/install.mjs`, through a symlink, or through a
 * Windows `.cmd` shim.
 */
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const isEntryPoint = (importMetaUrl) => {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(importMetaUrl));
  } catch {
    // A path that cannot be resolved is not this file.
    return false;
  }
};
