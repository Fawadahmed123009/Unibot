// Manual retrieval check: npx tsx scripts/search.ts "question"
// Embeds the question and calls the match_chunks RPC (no LLM involved yet).
import { config as loadEnv } from "dotenv";
import { join } from "node:path";

import { embed } from "../lib/embed";
import { createAdminClient } from "../lib/supabase/admin";

loadEnv({ path: join(process.cwd(), ".env.local") });

async function main() {
  const question = process.argv.slice(2).join(" ").trim();
  if (!question) {
    console.error('Usage: npx tsx scripts/search.ts "question"');
    process.exit(1);
  }

  const [queryVector] = await embed([question]);
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("match_chunks", {
    query_embedding: JSON.stringify(queryVector),
    match_count: 5,
  });
  if (error) {
    console.error(`match_chunks failed: ${error.message}`);
    process.exit(1);
  }

  for (const match of data ?? []) {
    const meta = (match.metadata ?? {}) as {
      document_name?: string;
      section_heading?: string;
    };
    console.log(
      `${match.similarity.toFixed(4)}  ${meta.document_name ?? "?"}  >  ${meta.section_heading ?? "?"}`,
    );
    console.log(`        ${match.content.slice(0, 120)}\n`);
  }
}

main();
