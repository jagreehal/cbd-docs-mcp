// Speaks real MCP to the handler, in-process, over the official client. The
// docs come from the live cbd-catalog site, so this also checks the contract this
// server consumes: the manifest and the .md twins.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { handler } from '../api/mcp.ts';

const client = new Client({ name: 'cbd-docs-mcp-test', version: '1.0.0' });
const text = (result: { content: unknown }) => (result.content as { text: string }[])[0].text;

before(async () => {
  const transport = new StreamableHTTPClientTransport(new URL('http://localhost/api/mcp'), {
    fetch: (url, init) => handler(new Request(url, init)),
  });
  await client.connect(transport);
});
after(() => client.close());

test('exposes three read-only tools', async () => {
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((tool) => tool.name).sort(), ['get_doc', 'list_docs', 'search_docs']);
  assert.ok(tools.every((tool) => tool.annotations?.readOnlyHint));
});

test('tells the model to cite owner, date and URL', () => {
  assert.match(client.getInstructions() ?? '', /owning team and last-changed date/);
});

test('the 02:40 question finds the payments runbook first', async () => {
  const hits = JSON.parse(text(await client.callTool({ name: 'search_docs', arguments: { query: 'replay stuck payment' } })));
  assert.equal(hits[0].id, 'cbd-payments-service/runbook');
  assert.equal(hits[0].owner, 'payments-platform');
  assert.match(hits[0].url, /\/cbd-payments-service\/runbook\/$/);
});

test('get_doc returns the markdown twin with provenance', async () => {
  const markdown = text(await client.callTool({ name: 'get_doc', arguments: { id: 'cbd-payments-service/runbook' } }));
  assert.match(markdown, /^owner: payments-platform$/m);
  assert.match(markdown, /^source: https:\/\/github\.com\/jagreehal\/cbd-payments-service\/blob\/HEAD\/docs\/runbook\.md$/m);
  assert.match(markdown, /replay from the last acknowledged event/);
});

test('an unknown id is an error that points at search', async () => {
  const result = await client.callTool({ name: 'get_doc', arguments: { id: 'cbd-payments-service/nope' } });
  assert.equal(result.isError, true);
  assert.match(text(result), /search_docs/);
});

test('list_docs filters by repository', async () => {
  const docs = JSON.parse(text(await client.callTool({ name: 'list_docs', arguments: { repo: 'cbd-handbook' } })));
  assert.deepEqual(docs.map((doc: { id: string }) => doc.id).sort(), [
    'cbd-handbook/incident-communications',
    'cbd-handbook/repository-layout',
  ]);
});
