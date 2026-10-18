// A remote MCP server over the Acme docs index. It reads the two files
// cbd-catalog publishes, the manifest and each page's Markdown twin, and
// holds no documents of its own. Publishing repos never hear about it.
import { createMcpHandler } from 'mcp-handler';
import { z } from 'zod';

const SITE = (process.env.DOCS_SITE ?? 'https://jagreehal.github.io/cbd-catalog').replace(/\/$/, '');

interface ManifestEntry {
  owner: string;
  title: string;
  updated: string | null;
  linkedFrom: string[];
}

export interface Doc extends ManifestEntry {
  id: string;
  repo: string;
  url: string;
  markdown: string;
}

// ponytail: every cold start fetches the manifest and each .md twin, then keeps
// them for five minutes. Fine to a few hundred docs; past that, have
// cbd-catalog publish a search index and read that instead.
const TTL = 5 * 60 * 1000;
let cache: { at: number; docs: Doc[] } | undefined;

async function get(url: string): Promise<Response> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response;
}

export async function loadDocs(): Promise<Doc[]> {
  if (cache && Date.now() - cache.at < TTL) return cache.docs;
  const manifest: Record<string, ManifestEntry> = await (await get(`${SITE}/contracts/docs-manifest.json`)).json();
  const docs = await Promise.all(
    Object.entries(manifest).map(async ([id, entry]) => ({
      ...entry,
      id,
      repo: id.split('/')[0],
      url: `${SITE}/${id}/`,
      markdown: await (await get(`${SITE}/${id}.md`)).text(),
    }))
  );
  cache = { at: Date.now(), docs };
  return docs;
}

// Keyword scoring. A doc that matches more of the query words ranks first, so
// a long page that repeats one common word cannot bury a short runbook that
// matches all of them. Title hits and repeats (capped at three) break ties.
// Returns the line of the first hit so the caller can judge relevance unread.
export function search(docs: Doc[], query: string, limit = 5) {
  const terms = query.toLowerCase().split(/\W+/).filter((term) => term.length > 1);
  return docs
    .map((doc) => {
      const title = doc.title.toLowerCase();
      const body = doc.markdown.toLowerCase();
      const score = terms.reduce((sum, term) => {
        const count = body.split(term).length - 1;
        return sum + (count > 0 ? 10 : 0) + (title.includes(term) ? 5 : 0) + Math.min(count, 3);
      }, 0);
      const line = doc.markdown.split('\n').find((text) => terms.some((term) => text.toLowerCase().includes(term)));
      return { doc, score, snippet: line?.trim() };
    })
    .filter((hit) => hit.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

const summary = ({ id, title, owner, repo, updated, url }: Doc) => ({ id, title, owner, repo, updated, url });
const json = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] });

export const handler = createMcpHandler(
  (server) => {
    server.registerTool(
      'search_docs',
      {
        title: 'Search Acme docs',
        description:
          'Keyword search across runbooks, team pages and policy that each Acme team publishes from its own repository. Returns doc ids with owner, last git change and URL. Call get_doc for the full text.',
        inputSchema: z.object({ query: z.string().min(1).describe('Words to look for, e.g. "replay stuck payment"') }),
        annotations: { readOnlyHint: true, openWorldHint: false },
      },
      async ({ query }) => {
        const hits = search(await loadDocs(), query);
        return json(hits.map(({ doc, snippet }) => ({ ...summary(doc), snippet })));
      }
    );

    server.registerTool(
      'get_doc',
      {
        title: 'Read an Acme doc',
        description:
          'Returns one document as Markdown. Its frontmatter names the owning team, the last git change, the source file and the page URL.',
        inputSchema: z.object({ id: z.string().describe('Doc id from search_docs or list_docs, e.g. "cbd-payments-service/runbook"') }),
        annotations: { readOnlyHint: true, openWorldHint: false },
      },
      async ({ id }) => {
        const doc = (await loadDocs()).find((entry) => entry.id === id);
        if (!doc) {
          return { ...json({ error: `No doc with id "${id}". Use search_docs or list_docs to find one.` }), isError: true };
        }
        return { content: [{ type: 'text' as const, text: doc.markdown }] };
      }
    );

    server.registerTool(
      'list_docs',
      {
        title: 'List Acme docs',
        description: 'Lists every document, or those from one repository, with owner, last git change and URL.',
        inputSchema: z.object({ repo: z.string().optional().describe('Repository name, e.g. "cbd-handbook"') }),
        annotations: { readOnlyHint: true, openWorldHint: false },
      },
      async ({ repo }) => {
        const docs = await loadDocs();
        return json(docs.filter((doc) => !repo || doc.repo === repo).map(summary));
      }
    );
  },
  {
    serverInfo: { name: 'acme-docs', version: '1.0.0' },
    instructions: [
      'Acme operational and technical docs. Each team writes and owns its docs in its own repository; this server reads the company index built from them.',
      'Search these docs before answering an operational question, such as how to replay a payment or who to tell during an incident.',
      'When you answer from a doc, name its title, owning team and last-changed date, and link its URL. If a doc disagrees with what you remember, the doc wins.',
    ].join(' '),
  }
);

export { handler as GET, handler as POST, handler as DELETE };
