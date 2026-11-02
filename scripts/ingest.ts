// Standalone ingestion runner: npx tsx scripts/ingest.ts
// Reads every knowledge/*.md file and upserts it through ingestKnowledgeFile.
import { config as loadEnv } from "dotenv";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { ingestKnowledgeFile } from "../lib/ingest";

loadEnv({ path: join(process.cwd(), ".env.local") });

async function main() {
  const knowledgeDir = join(process.cwd(), "knowledge");
  // ":Zone.Identifier" sidecar files from Windows downloads are not real Markdown.
  const files = readdirSync(knowledgeDir)
    .filter((name) => name.endsWith(".md"))
    .sort();

  let ingested = 0;
  let skipped = 0;
  let failed = 0;
  let totalChunks = 0;

  for (const name of files) {
    try {
      const raw = readFileSync(join(knowledgeDir, name), "utf-8");
      const result = await ingestKnowledgeFile(raw, name);
      if (result.skipped) {
        skipped++;
        console.log(`${name}: skipped (ingest: false)`);
      } else {
        ingested++;
        totalChunks += result.chunkCount;
        console.log(`${name}: ${result.chunkCount} chunks (document ${result.documentId})`);
      }
    } catch (error) {
      // One bad file must not stop the run.
      failed++;
      console.error(`${name}: ERROR ${String(error)}`);
    }
  }

  console.log(
    `\nTotals: ${ingested} ingested (${totalChunks} chunks), ${skipped} skipped, ${failed} failed, ${files.length} files found`,
  );
  if (failed > 0) process.exitCode = 1;
}

main();
