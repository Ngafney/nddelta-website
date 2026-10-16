/** node:fs / node:path / node:url for the browser: nothing in solo touches the disk. */
const noop = () => {};
const fail = () => {
  throw new Error("no filesystem in solo mode");
};

export const readFileSync = fail;
export const writeFileSync = noop;
export const mkdirSync = noop;
export const existsSync = () => false;
export const statSync = fail;
export const createReadStream = fail;
export const join = (...p) => p.join("/");
export const dirname = (p) => String(p).replace(/\/[^/]*$/, "");
export const resolve = (...p) => p.join("/");
export const extname = (p) => (String(p).match(/\.[^./]*$/) || [""])[0];
export const fileURLToPath = (u) => String(u);
export const pathToFileURL = (p) => new URL(`file://${p}`);

const all = { readFileSync, writeFileSync, mkdirSync, existsSync, statSync, createReadStream, join, dirname, resolve, extname, fileURLToPath, pathToFileURL, promises: {} };
export default all;
