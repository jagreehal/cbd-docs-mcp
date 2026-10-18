# cbd-docs-mcp

A remote MCP server over the Acme docs index. Add it to Claude as a connector and
Claude can search the runbooks, team pages and policy that each team publishes
from its own repository.

**Endpoint:** `https://cbd-docs-mcp.vercel.app/api/mcp`

## Add it to Claude

- **claude.ai or Claude Desktop:** Settings → Connectors → Add custom connector,
  then paste the endpoint. On Team and Enterprise plans an owner can add it once
  for the whole organisation.
- **Claude Code:** `claude mcp add --transport http acme-docs https://cbd-docs-mcp.vercel.app/api/mcp`

## Tools

| Tool | Returns |
|---|---|
| `search_docs(query)` | Matching doc ids with title, owner, repo, last git change, URL and the matching line |
| `get_doc(id)` | The Markdown twin; its frontmatter names the owner, last change, source file and URL |
| `list_docs(repo?)` | Every doc, or one repository's docs |

The server instructions tell Claude to search before answering an operational
question, and to cite the title, owning team, date and URL of each doc it uses.

## How it gets the docs

The server reads the two files [cbd-catalog](https://github.com/jagreehal/cbd-catalog)
publishes: `contracts/docs-manifest.json` and the `.md` twin of each page. It
keeps them for five minutes. It holds no documents, and the publishing
repositories do not know it exists. It is one more consumer of a published
contract, like each publisher's docs check.

For private docs, the same server sits behind OAuth tied to company sign-in, and
Claude reads what the signed-in person can read. This public demo runs without
auth.

```sh
pnpm install
pnpm run check      # typecheck, then real MCP calls against the live docs site
vercel deploy --prod
```

The pattern and the argument behind it: [convention-based-design](https://github.com/jagreehal/convention-based-design).
