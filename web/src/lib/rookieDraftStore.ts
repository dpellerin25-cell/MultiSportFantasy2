import { open, readFile, rename, unlink, mkdir } from "node:fs/promises";
import path from "node:path";
import { randomUUID, createHash, timingSafeEqual } from "node:crypto";
import { applyTransfer, parseLedger, type DraftLedger, type TransferInput } from "./rookieDraft";

function storePath() {
  const configured = process.env.ROOKIE_DRAFT_STORE_PATH;
  if (configured && !path.isAbsolute(configured)) throw new Error("Draft storage must use an absolute path.");
  return configured || path.join(process.cwd(), "data", "rookie-draft.json");
}

export function canWriteDrafts() {
  return Boolean(process.env.ROOKIE_DRAFT_COMMISSIONER_PASSWORD) &&
    (process.env.NODE_ENV !== "production" || Boolean(process.env.ROOKIE_DRAFT_STORE_PATH));
}

export function isCommissioner(request: Request) {
  const password = process.env.ROOKIE_DRAFT_COMMISSIONER_PASSWORD;
  const authorization = request.headers.get("authorization");
  if (!password || !authorization?.startsWith("Bearer ")) return false;
  const hash = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(hash(password), hash(authorization.slice(7)));
}

export async function readDraftLedger(): Promise<DraftLedger> {
  try {
    const configured = process.env.ROOKIE_DRAFT_STORE_PATH;
    const contents = configured
      // An externally provisioned durable file is not part of the deployment bundle.
      ? await readFile(/* turbopackIgnore: true */ storePath(), "utf8")
      : await readFile(path.join(process.cwd(), "data", "rookie-draft.json"), "utf8");
    return parseLedger(JSON.parse(contents));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT" && process.env.ROOKIE_DRAFT_STORE_PATH) {
      return parseLedger(JSON.parse(await readFile(path.join(process.cwd(), "data", "rookie-draft.json"), "utf8")));
    }
    throw error;
  }
}

export async function saveDraftTransfer(input: TransferInput) {
  const filename = storePath();
  await mkdir(path.dirname(filename), { recursive: true });
  // One writer at a time; a second commissioner tab must retry using fresh data.
  const lock = await open(`${filename}.lock`, "wx");
  const temporary = `${filename}.${randomUUID()}.tmp`;
  try {
    const ledger = await readDraftLedger();
    const updated = applyTransfer(ledger, input, randomUUID(), new Date().toISOString());
    const output = await open(temporary, "wx");
    try {
      await output.writeFile(JSON.stringify(updated, null, 2) + "\n", "utf8");
      await output.sync();
    } finally {
      await output.close();
    }
    await rename(temporary, filename);
    return updated;
  } finally {
    await unlink(temporary).catch(() => {});
    await lock.close();
    await unlink(`${filename}.lock`);
  }
}
