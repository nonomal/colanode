# Colanode Imports

This package provides import utilities for Colanode, allowing you to import data from various external sources into your Colanode workspaces.

## Supported Import Sources

- **Notion**: Import Notion exported workspaces (ZIP format)

## Usage

### Notion Import

The Notion importer converts Notion's exported ZIP files into Colanode nodes, documents, and files.

#### CLI Usage

```bash
npm run import:notion -- \
  --zip /path/to/notion-export.zip \
  --workspace YOUR_WORKSPACE_ID \
  --user YOUR_USER_ID \
  --token YOUR_API_TOKEN \
  [--parent PARENT_NODE_ID] \
  [--server http://your-server-url]
```

Required parameters:

- `--zip`: Path to the Notion export ZIP file
- `--workspace`: Target Colanode workspace ID
- `--user`: Your Colanode user ID
- `--token`: API token for authentication

Optional parameters:

- `--parent`: Parent node ID to import under (e.g., a space or page ID)
- `--server`: Colanode server URL (defaults to http://localhost:3000)

#### Programmatic Usage

You can also use the Notion importer programmatically:

```typescript
import { importNotion } from '@colanode/imports';

async function importMyNotionData() {
  const result = await importNotion({
    zipPath: '/path/to/notion-export.zip',
    workspaceId: 'your-workspace-id',
    userId: 'your-user-id',
    apiToken: 'your-api-token',
    parentId: 'optional-parent-id',
    serverUrl: 'optional-server-url',
  });

  console.log(`Imported ${result.importedNodes} nodes`);
  console.log(`Imported ${result.importedDocuments} documents`);
  console.log(`Imported ${result.importedFiles} files`);

  if (result.errors.length > 0) {
    console.error('Errors:', result.errors);
  }
}
```

## Supported Features

The Notion importer supports:

- Pages with Markdown content
- Databases with records
- Images and other files
- Hierarchical structure
- Basic formatting elements (headings, lists, code blocks, quotes, etc.)
- Field types in databases (text, number, select, multi-select, date, etc.)

## Development

### Building

```bash
npm run build
```

### Adding New Import Sources

To add support for additional data sources, create a new directory in the package with the necessary components:

1. Parser to read the source format
2. Mapper to convert to Colanode data structures
3. Utility functions for handling the import
4. Main index.ts file with CLI and API interfaces
