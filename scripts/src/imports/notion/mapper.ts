import {
  Block,
  DocumentContent,
  FieldAttributes,
  FieldValue,
  NodeAttributes,
  SelectOptionAttributes,
  generateId,
  generateNodeIndex,
  IdType,
  databaseModel,
  databaseViewModel,
  fileModel,
  pageModel,
  recordModel,
  documentContentSchema,
} from '@colanode/core';

import {
  MappedEntity,
  NotionDatabase,
  NotionDatabaseField,
  NotionFile,
  NotionPage,
  ParsedBlock,
  PageBlueprint,
  DatabaseBlueprint,
} from './types';

import { parseMarkdown } from './notion-parser';
import {
  buildParagraphBlock,
  uploadFile,
  buildHorizontalRuleBlock,
} from './utils';
import { YDoc, encodeState } from '@colanode/crdt';
import path from 'path';

// Define logger interface (can be moved to a shared file)
interface Logger {
  info: (message: string) => void;
  success: (message: string) => void;
  step: (message: string) => void;
  error: (message: string, error?: any) => void;
  warn: (message: string) => void;
  debug: (message: string) => void;
}

// Basic logger implementation for mapper.ts
const logger: Logger = {
  info: (message: string) => console.log(`[INFO] ${message}`),
  success: (message: string) => console.log(`[✓] ${message}`),
  step: (message: string) => console.log(`\n=== ${message} ===`),
  error: (message: string, error?: any) => {
    console.error(`[ERROR] ${message}`);
    if (error && process.env.DEBUG) console.error(error);
  },
  warn: (message: string) => console.warn(`[WARN] ${message}`),
  debug: (message: string) => {
    if (process.env.DEBUG) console.log(`[DEBUG] ${message}`);
  },
};

// Define valid Colanode block types (adjust based on @colanode/core definitions)
type ColanodeBlockType =
  | 'paragraph'
  | 'heading1'
  | 'heading2'
  | 'heading3'
  | 'bulletList'
  | 'orderedList'
  | 'listItem'
  | 'taskList'
  | 'taskItem'
  | 'code'
  | 'blockquote'
  | 'horizontalRule'
  | 'image'
  | 'table'
  | 'file'
  | 'page';

/**
 * Map page content to document update mutation
 * @param page Notion page
 * @param pageId Colanode page ID
 * @param notionIdToColanodeIdMap Mapping from Notion IDs to Colanode IDs
 * @param childToParentMap Map of child GUIDs to parent GUIDs
 * @returns Document mutation entity, or null on failure
 */
export async function mapPageContent(
  page: NotionPage,
  pageId: string,
  notionIdToColanodeIdMap: Map<string, string>,
  blueprints: Map<string, PageBlueprint | DatabaseBlueprint>,
  childToParentMap?: Map<string, string>
): Promise<MappedEntity | null> {
  try {
    // If page content is too large, log warning but proceed (server might handle limits)
    const maxContentLength = 500000; // 500KB limit - adjust as needed
    let content = page.content || '';

    if (content.length > maxContentLength) {
      console.warn(
        `Page content for "${page.name}" (${pageId}) is large (${content.length} bytes). Parsing may be slow or fail.`
      );
    }

    // Process Notion links within the markdown *before* parsing blocks
    content = processNotionLinks(content, notionIdToColanodeIdMap);

    // Parse markdown content into hierarchical blocks
    let parsedBlocks: ParsedBlock[] = [];
    try {
      parsedBlocks = parseMarkdown(content);
    } catch (error) {
      console.error(
        `Error parsing markdown for page ${page.name} (${pageId}), creating fallback content: ${error}`
      );
      return createMinimalDocumentContent(
        pageId,
        `Error parsing content for page: ${page.name}`
      );
    }

    // Map parsed blocks to Colanode blocks recursively
    const colanodeBlocks = mapParsedBlocksToColanode(
      parsedBlocks,
      pageId,
      notionIdToColanodeIdMap,
      blueprints
    );

    // Add database blocks for direct children
    let lastChildIndex = Object.keys(colanodeBlocks).reduce(
      (lastIdx, blockId) => {
        const block = colanodeBlocks[blockId];
        // Find the lexicographically largest index among top-level blocks
        if (
          block &&
          block.parentId === pageId &&
          (!lastIdx || block.index > lastIdx)
        ) {
          return block.index;
        }
        return lastIdx;
      },
      ''
    ); // Start with empty string index

    for (const [identifier, childBlueprint] of blueprints.entries()) {
      if (
        childBlueprint.type === 'database_blueprint' &&
        childBlueprint.parentColanodeId === pageId
      ) {
        const dbBlockId = childBlueprint.colanodeId;
        // Ensure we don't overwrite existing blocks
        if (!colanodeBlocks[dbBlockId]) {
          const dbBlockIndex = lastChildIndex
            ? generateNodeIndex(lastChildIndex)
            : generateNodeIndex();
          colanodeBlocks[dbBlockId] = {
            id: dbBlockId,
            type: 'database', // The block type is 'database'
            parentId: pageId,
            index: dbBlockIndex,
            content: [], // Database blocks don't have direct content
            attrs: {}, // No specific attributes needed usually
          };
          lastChildIndex = dbBlockIndex; // Update last index for next potential child
          logger.debug(`Added database block ${dbBlockId} to page ${pageId}`);
        } else {
          logger.warn(
            `Block ID conflict: Database ${dbBlockId} already exists in page ${pageId}. Skipping block insertion.`
          );
        }
      }
    }

    // DEBUGGING: Check if blocks are empty after mapping
    if (Object.keys(colanodeBlocks).length === 0) {
      console.warn(
        `No Colanode blocks generated after mapping for page ${page.name} (${pageId}). Creating fallback.`
      );
      return createMinimalDocumentContent(
        pageId,
        `No content generated for page: ${page.name}`
      );
    }

    // Create document content structure
    const documentContent: DocumentContent = {
      type: 'rich_text',
      blocks: colanodeBlocks,
    };

    // DEBUGGING: Log document structure for troubleshooting
    console.log(
      `Document for ${page.name} (${pageId}) has ${Object.keys(colanodeBlocks).length} blocks`
    );

    // Validate document content structure
    if (!validateDocumentContent(documentContent)) {
      console.error(
        `Invalid document content structure for page ${page.name} (${pageId})`
      );
      return createMinimalDocumentContent(
        pageId,
        `Invalid document structure for page: ${page.name}`
      );
    }

    // Validate the document size isn't too large *after* structuring
    const docSize = JSON.stringify(documentContent).length;
    const maxDocSize = 1 * 1024 * 1024; // 1MB limit for the final JSON - adjust as needed
    if (docSize > maxDocSize) {
      console.warn(
        `Final document structure for page ${page.name} (${pageId}) is too large (${docSize} bytes > ${maxDocSize}). Creating simplified version.`
      );
      return createMinimalDocumentContent(
        pageId,
        `Imported content for ${page.name} was too large.`
      );
    }

    // Use YDoc encoding for document content CRDT update
    let ydoc, update, encodedUpdate;
    try {
      ydoc = new YDoc();
      // Check if documentContentSchema is defined
      if (!documentContentSchema) {
        console.error(
          `documentContentSchema is undefined for page ${page.name} (${pageId})`
        );
        return createMinimalDocumentContent(
          pageId,
          `Schema missing for document content: ${page.name}`
        );
      }

      update = ydoc.update(documentContentSchema, documentContent);

      if (!update) {
        console.error(
          `CRITICAL: Failed to create YDoc update for document content of ${page.name} (${pageId}). Document update will fail.`
        );
        return createMinimalDocumentContent(
          pageId,
          `Error generating document update for page: ${page.name}`
        );
      }

      encodedUpdate = encodeState(update);
      if (!encodedUpdate) {
        console.error(`Failed to encode state for ${page.name} (${pageId})`);
        return createMinimalDocumentContent(
          pageId,
          `Error encoding document update for page: ${page.name}`
        );
      }
    } catch (ydocError) {
      console.error(
        `YDoc error for ${page.name} (${pageId}): ${ydocError instanceof Error ? ydocError.message : String(ydocError)}`
      );
      return createMinimalDocumentContent(
        pageId,
        `Error in document structure for page: ${page.name}`
      );
    }

    // CRITICAL: Ensure the final structure is correct
    return {
      type: 'update_document',
      data: {
        nodeId: pageId,
        update: encodedUpdate,
      },
    };
  } catch (error) {
    // Detailed error logging for better debugging
    console.error(
      `Error creating document content mutation for ${page.name} (${pageId}): ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    if (error instanceof Error && error.stack) {
      console.error(`Stack trace: ${error.stack}`);
    }

    // Return a minimal valid document as fallback
    return createMinimalDocumentContent(
      pageId,
      `Error processing document content for page: ${page.name}`
    );
  }
}

// Improved implementation of createMinimalDocumentContent
async function createMinimalDocumentContent(
  nodeId: string,
  message: string
): Promise<MappedEntity | null> {
  try {
    // Generate a unique ID for the fallback block
    const fallbackBlockId = generateId(IdType.Block);

    // Create a simple paragraph block with error message
    const block = buildParagraphBlock(
      nodeId,
      message || 'Error processing document content',
      fallbackBlockId
    );

    // Create minimal document content
    const fallbackContent: DocumentContent = {
      type: 'rich_text',
      blocks: {
        [fallbackBlockId]: block,
      },
    };

    // Validate the fallback content structure
    if (!validateDocumentContent(fallbackContent)) {
      console.error(`Failed to create valid fallback content for ${nodeId}`);

      // Last resort: hardcoded minimal valid structure
      return {
        type: 'update_document',
        data: {
          nodeId: nodeId,
          update: '', // Empty update - server will handle this as empty document
        },
      };
    }

    // Create YDoc update
    try {
      const ydoc = new YDoc();

      if (!documentContentSchema) {
        console.error(
          `documentContentSchema is undefined for fallback content on ${nodeId}`
        );
        // Return minimal valid update structure
        return {
          type: 'update_document',
          data: {
            nodeId: nodeId,
            update: '', // Empty update
          },
        };
      }

      const update = ydoc.update(documentContentSchema, fallbackContent);

      if (!update) {
        console.error(
          `Failed to create YDoc update for fallback content for ${nodeId}`
        );
        // Return minimal valid update structure
        return {
          type: 'update_document',
          data: {
            nodeId: nodeId,
            update: '', // Empty update
          },
        };
      }

      // Encode the update
      const encodedUpdate = encodeState(update);

      // Return final document mutation
      return {
        type: 'update_document',
        data: {
          nodeId: nodeId,
          update: encodedUpdate,
        },
      };
    } catch (ydocError) {
      console.error(`YDoc error in fallback for ${nodeId}: ${ydocError}`);
      // Return minimal valid update structure as a last resort
      return {
        type: 'update_document',
        data: {
          nodeId: nodeId,
          update: '', // Empty update
        },
      };
    }
  } catch (fallbackError) {
    console.error(
      `Critical failure creating fallback document for ${nodeId}: ${fallbackError}`
    );
    // Return minimal update structure as a last resort
    return {
      type: 'update_document',
      data: {
        nodeId: nodeId,
        update: '', // Empty update as last resort
      },
    };
  }
}

/**
 * Process Notion links in markdown content (placeholder - adjust based on needs)
 * @param content Markdown content
 * @param notionIdToColanodeIdMap Mapping from Notion IDs to Colanode IDs
 * @returns Processed content with updated links where possible
 */
function processNotionLinks(
  content: string,
  notionIdToColanodeIdMap: Map<string, string>
): string {
  // Regex to find markdown links: [text](url)
  const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
  // Regex to find Notion GUID at the end of a URL path segment
  const NOTION_GUID_REGEX = /([a-f0-9]{32})(?:\.md)?$/i;

  return content.replace(linkRegex, (match, linkText, linkUrl) => {
    try {
      let decodedUrl = linkUrl;
      try {
        decodedUrl = decodeURIComponent(linkUrl);
      } catch (e) {
        // Ignore decoding errors for already encoded or malformed URLs
      }

      // Try to extract Notion GUID from the URL
      const guidMatch = decodedUrl.match(NOTION_GUID_REGEX);

      if (guidMatch && guidMatch[1]) {
        const notionGuid = guidMatch[1];
        const colanodeId = notionIdToColanodeIdMap.get(notionGuid);

        if (colanodeId) {
          // Leave the original link but add a reference to the Colanode ID for easier parsing
          return `[${linkText}](colanode-page:${colanodeId})`;
        }
      }

      return match;
    } catch (error) {
      console.warn(
        `Error processing link: [${linkText}](${linkUrl}) - ${error}`
      );
      return match;
    }
  });
}

/**
 * Recursively map ParsedBlocks (hierarchical) to Colanode Blocks (flat record)
 * @param parsedBlocks Array of blocks to map at the current level
 * @param parentId Colanode ID of the parent block (e.g., page, listItem, taskItem)
 * @param notionIdToColanodeIdMap Map for resolving links (if needed within blocks)
 * @param blueprints Map of all identified blueprints (pages and databases)
 * @param colanodeBlocks Accumulator object for the generated Colanode blocks
 * @param lastIndex The index of the last sibling block at this level
 * @returns The index of the last block created at this level
 */
function mapParsedBlocksToColanode(
  parsedBlocks: ParsedBlock[],
  parentId: string,
  notionIdToColanodeIdMap: Map<string, string>,
  blueprints: Map<string, PageBlueprint | DatabaseBlueprint>,
  colanodeBlocks: Record<string, Block> = {},
  lastIndex: string = ''
): Record<string, Block> {
  for (const parsedBlock of parsedBlocks) {
    const blockId = generateId(IdType.Block);
    const blockIndex = lastIndex
      ? generateNodeIndex(lastIndex)
      : generateNodeIndex();
    let currentBlock: Block | null = null;

    let safeText =
      typeof parsedBlock.text === 'string'
        ? parsedBlock.text.substring(0, 5000)
        : '';
    if (parsedBlock.type === 'taskItem') {
      safeText = safeText.replace(/^\s*\[\s*[xX ]?\s*\]\s*/, '').trim();
    }

    // Check if this is a paragraph that contains a link to a Notion page OR database
    if (parsedBlock.type === 'paragraph') {
      // Look for our special colanode-page links that we added in processNotionLinks
      const pageLinkRegex = /^\[([^\]]+)\]\(colanode-page:([a-zA-Z0-9]+)\)$/;
      const pageMatch = safeText.trim().match(pageLinkRegex);

      // Check for plain markdown links that might point to a CSV
      const markdownLinkRegex = /^\[([^\]]+)\]\(([^)]+)\)$/;
      const markdownMatch = safeText.trim().match(markdownLinkRegex);

      // If the paragraph is just a link to another page, convert it to a page block
      if (pageMatch && pageMatch[2]) {
        const colanodeId = pageMatch[2];
        if (colanodeId) {
          logger.debug(
            `Converting link "${pageMatch[1]}" to page block: ${colanodeId}`
          );
          colanodeBlocks[colanodeId] = {
            id: colanodeId,
            type: 'page',
            parentId,
            index: blockIndex,
            content: [],
            attrs: {},
          };
          lastIndex = blockIndex;
          continue; // Skip regular paragraph processing
        }
      }
      // NEW: Check if the paragraph is just a link to a known database CSV
      else if (markdownMatch && markdownMatch[2]) {
        const linkUrl = markdownMatch[2];
        try {
          const decodedUrl = decodeURIComponent(linkUrl);
          // Regex to find GUID followed by .csv at the end of a path segment
          const csvLinkRegex = /\/([^/]+?)\s([a-f0-9]{32})\.csv$/i;
          const csvMatch = decodedUrl.match(csvLinkRegex);

          if (csvMatch && csvMatch[2]) {
            const potentialDbGuid = csvMatch[2];
            const colanodeId = notionIdToColanodeIdMap.get(potentialDbGuid);

            // Check if this GUID corresponds to a known database blueprint
            if (colanodeId) {
              let foundDbBlueprint = false;
              for (const bp of blueprints.values()) {
                if (
                  bp.entity?.id === potentialDbGuid &&
                  bp.type === 'database_blueprint'
                ) {
                  foundDbBlueprint = true;
                  break;
                }
              }

              if (foundDbBlueprint) {
                logger.debug(
                  `Skipping paragraph block for database link: ${markdownMatch[1]}`
                );
                continue; // Skip creating a paragraph for this database link
              }
            }
          }
        } catch (e) {
          const errorMessage = e instanceof Error ? e.message : String(e);
          logger.warn(
            `Error decoding or checking potential database link URL: ${linkUrl}. Error: ${errorMessage}`
          );
        }
      }
    }

    try {
      switch (parsedBlock.type) {
        case 'paragraph':
        case 'heading1':
        case 'heading2':
        case 'heading3':
        case 'code':
        case 'blockquote':
          currentBlock = createSimpleColanodeBlock(
            parsedBlock,
            blockId,
            parentId,
            blockIndex,
            safeText
          );
          if (currentBlock) {
            colanodeBlocks[blockId] = currentBlock;
            lastIndex = blockIndex;
            if (parsedBlock.children && parsedBlock.children.length > 0) {
              mapParsedBlocksToColanode(
                parsedBlock.children,
                blockId,
                notionIdToColanodeIdMap,
                blueprints,
                colanodeBlocks,
                ''
              );
            }
          }
          break;

        // Special handling for divider/horizontal rule
        case 'divider':
        case 'horizontalRule':
          // Create a horizontal rule block with the Colanode type
          colanodeBlocks[blockId] = buildHorizontalRuleBlock(
            parentId,
            blockId,
            blockIndex
          );
          lastIndex = blockIndex;
          break;

        case 'taskList':
        case 'bulletList':
        case 'orderedList':
          currentBlock = {
            id: blockId,
            type: parsedBlock.type as ColanodeBlockType,
            parentId: parentId,
            index: blockIndex,
            content: [],
            attrs: parsedBlock.attrs || {},
          };
          colanodeBlocks[blockId] = currentBlock;
          lastIndex = blockIndex;

          if (parsedBlock.children && parsedBlock.children.length > 0) {
            mapParsedBlocksToColanode(
              parsedBlock.children,
              blockId,
              notionIdToColanodeIdMap,
              blueprints,
              colanodeBlocks,
              ''
            );
          }
          break;

        case 'listItem':
        case 'taskItem':
          currentBlock = {
            id: blockId,
            type: parsedBlock.type as ColanodeBlockType,
            parentId: parentId,
            index: blockIndex,
            content: [],
            attrs: parsedBlock.attrs || {},
          };
          if (
            currentBlock.type === 'taskItem' &&
            typeof currentBlock.attrs?.checked !== 'boolean'
          ) {
            currentBlock.attrs = { ...currentBlock.attrs, checked: false };
          }
          colanodeBlocks[blockId] = currentBlock;
          lastIndex = blockIndex;

          if (parsedBlock.children && parsedBlock.children.length > 0) {
            mapParsedBlocksToColanode(
              parsedBlock.children,
              blockId,
              notionIdToColanodeIdMap,
              blueprints,
              colanodeBlocks,
              ''
            );
          } else if (safeText) {
            const contentParagraphId = generateId(IdType.Block);
            const contentParagraph: Block = {
              id: contentParagraphId,
              type: 'paragraph',
              parentId: blockId,
              content: [{ type: 'text', text: safeText }],
              index: generateNodeIndex(),
            };
            colanodeBlocks[contentParagraphId] = contentParagraph;
          }
          break;

        case 'blockquote':
          currentBlock = {
            id: blockId,
            type: 'blockquote',
            parentId: parentId,
            index: blockIndex,
            content: [], // Children are handled below
            attrs: {},
          };
          colanodeBlocks[blockId] = currentBlock;
          lastIndex = blockIndex;
          // Recursively map children *within* the blockquote
          if (parsedBlock.children && parsedBlock.children.length > 0) {
            mapParsedBlocksToColanode(
              parsedBlock.children,
              blockId, // Parent is the blockquote block itself
              notionIdToColanodeIdMap,
              blueprints, // Pass blueprints down
              colanodeBlocks,
              '' // Reset index for children
            );
          }
          break;

        default:
          console.warn(
            `Unhandled parsed block type in mapper: ${parsedBlock.type}. Treating as paragraph.`
          );
          currentBlock = createSimpleColanodeBlock(
            { type: 'paragraph', text: safeText },
            blockId,
            parentId,
            blockIndex,
            safeText
          );
          if (currentBlock) {
            colanodeBlocks[blockId] = currentBlock;
            lastIndex = blockIndex;
          }
      }
    } catch (mapError) {
      console.error(
        `Error mapping block type ${parsedBlock.type} (ID ${blockId}):`,
        mapError
      );
      const errorBlockId = generateId(IdType.Block);
      colanodeBlocks[errorBlockId] = buildParagraphBlock(
        parentId,
        `Error importing block: ${parsedBlock.type}`,
        errorBlockId
      );
      lastIndex = errorBlockId;
    }
  }

  return colanodeBlocks;
}

// Helper for creating simple Colanode blocks (paragraph, heading, etc.)
function createSimpleColanodeBlock(
  parsedBlock: ParsedBlock,
  blockId: string,
  parentId: string,
  index: string,
  text: string
): Block | null {
  const type: ColanodeBlockType = [
    'paragraph',
    'heading1',
    'heading2',
    'heading3',
    'code',
    'blockquote',
  ].includes(parsedBlock.type)
    ? (parsedBlock.type as ColanodeBlockType)
    : 'paragraph';

  // Clean up text specifically for headings
  let cleanedText = text;
  if (type.startsWith('heading')) {
    cleanedText = text.trim(); // Remove extra whitespace for headings
  }

  // If we have raw markdown content, process it for inline formatting
  const content = processInlineFormatting(cleanedText, parsedBlock.raw);

  const attrs =
    type === 'code' ? parsedBlock.attrs || { language: 'plaintext' } : {};

  const block: Block = {
    id: blockId,
    type: type,
    parentId: parentId,
    content: content,
    index: index,
    attrs: attrs,
  };

  if (!block.id || !block.parentId || !block.index) {
    console.error(
      `Invalid simple block created: Missing required fields. Type: ${type}, ID: ${blockId}`
    );
    return null;
  }
  return block;
}

/**
 * Process inline formatting in markdown text
 * @param text The plain text content
 * @param rawMarkdown The original markdown content with potential formatting
 * @returns Properly formatted content array for Colanode blocks
 */
function processInlineFormatting(text: string, rawMarkdown?: string): any[] {
  // If no raw markdown or it matches the regular text, just return plain text
  if (!rawMarkdown) {
    return [{ type: 'text', text }];
  }

  // For headings, strip the leading # characters and any extra whitespace/newlines
  if (rawMarkdown.match(/^#{1,6}\s/) && rawMarkdown.startsWith('#')) {
    // If this is a heading, use the text param which already has the # stripped
    // by the marked parser, and remove trailing newlines
    return [{ type: 'text', text: text.trim() }];
  }

  // Check for bold text (**text**)
  const content = [];

  // Simple check for bold text between ** markers
  const boldRegex = /\*\*([^*]+)\*\*/g;
  let modifiedText = rawMarkdown;
  let lastProcessedIndex = 0;
  let match;

  // Reset regex state
  boldRegex.lastIndex = 0;

  while ((match = boldRegex.exec(modifiedText)) !== null) {
    // Add any text before this bold section
    if (match.index > lastProcessedIndex) {
      const beforeText = modifiedText.substring(
        lastProcessedIndex,
        match.index
      );
      if (beforeText) {
        content.push({
          type: 'text',
          text: beforeText,
        });
      }
    }

    // Add the bold text
    content.push({
      type: 'text',
      text: match[1],
      marks: [{ type: 'bold' }],
    });

    lastProcessedIndex = match.index + match[0].length;
  }

  // Add any remaining text after the last match
  if (lastProcessedIndex < modifiedText.length) {
    content.push({
      type: 'text',
      text: modifiedText.substring(lastProcessedIndex),
    });
  }

  // If we couldn't parse any formatting, fall back to plain text
  if (content.length === 0) {
    return [{ type: 'text', text }];
  }

  return content;
}

/**
 * Map a Notion database to a Colanode database node creation mutation
 * @param database Notion database
 * @param databaseId Colanode database ID
 * @param parentId Parent node ID
 * @returns Mapped entity
 */
export async function mapDatabase(
  database: NotionDatabase,
  databaseId: string,
  parentId?: string
): Promise<MappedEntity> {
  try {
    // Map database fields using the new function
    const fields = mapDatabaseFields(database.fields);

    // Ensure name is sanitized
    const sanitizedName = database.name
      ? database.name.substring(0, 500)
      : 'Untitled Database';

    const databaseAttributes: NodeAttributes = {
      type: 'database',
      name: sanitizedName,
      parentId: parentId || '',
      fields, // Use the mapped fields
      // icon and cover are handled by the node model defaults/schema
    };

    // Use YDoc for proper CRDT encoding
    const ydoc = new YDoc();
    // Ensure the schema is correctly referenced
    if (!databaseModel?.attributesSchema) {
      throw new Error('databaseModel.attributesSchema is undefined');
    }
    const update = ydoc.update(
      databaseModel.attributesSchema,
      databaseAttributes
    );

    if (!update) {
      console.error(
        `CRITICAL: Failed to create YDoc update for database ${database.name} (${databaseId}). Node creation will fail.`
      );
      // Return minimal structure without update payload
      return {
        type: 'create_node',
        data: { nodeId: databaseId, attributes: databaseAttributes },
      };
    }

    const encodedUpdate = encodeState(update);

    return {
      type: 'create_node',
      data: {
        nodeId: databaseId,
        attributes: databaseAttributes,
        update: encodedUpdate,
      },
    };
  } catch (error) {
    console.error(
      `Error mapping database ${database.name} (${databaseId}):`,
      error instanceof Error ? error.message : String(error)
    );
    // Return a simplified database as fallback
    const simpleAttributes: NodeAttributes = {
      type: 'database',
      name: `Import Error: ${database.name || 'Untitled'}`.substring(0, 500),
      parentId: parentId || '',
      fields: {}, // Empty fields on error
    };

    try {
      const ydoc = new YDoc();
      if (!databaseModel?.attributesSchema) {
        throw new Error(
          'databaseModel.attributesSchema is undefined during fallback'
        );
      }
      const update = ydoc.update(
        databaseModel.attributesSchema,
        simpleAttributes
      );
      if (!update) throw new Error('Failed fallback ydoc update for database');
      const encodedUpdate = encodeState(update);
      return {
        type: 'create_node',
        data: {
          nodeId: databaseId,
          attributes: simpleAttributes,
          update: encodedUpdate,
        },
      };
    } catch (fallbackError) {
      console.error(
        `Failed to create even fallback database node for ${databaseId}: ${fallbackError}`
      );
      // Last resort: return without update payload
      return {
        type: 'create_node',
        data: { nodeId: databaseId, attributes: simpleAttributes },
      };
    }
  }
}

/**
 * Create a default database view node creation mutation for a database
 * @param databaseId Database ID
 * @returns Mapped entity for the view
 */
export function createDatabaseView(databaseId: string): MappedEntity {
  const viewId = generateId(IdType.DatabaseView);

  const viewAttributes: NodeAttributes = {
    type: 'database_view',
    name: 'Default View',
    layout: 'table',
    parentId: databaseId,
    index: generateNodeIndex(), // Generate initial index
    filters: {}, // Initialize as empty object
    sorts: {}, // Initialize as empty object
    // visibility property is not part of base NodeAttributes, handled by schema/model
  };

  // Use YDoc for proper CRDT encoding
  const ydoc = new YDoc();
  if (!databaseViewModel?.attributesSchema) {
    console.error(
      `CRITICAL: databaseViewModel.attributesSchema is undefined. Cannot create view update.`
    );
    // Return minimal view node without update payload
    return {
      type: 'create_node',
      data: { nodeId: viewId, attributes: viewAttributes },
    };
  }
  const update = ydoc.update(
    databaseViewModel.attributesSchema,
    viewAttributes
  );

  if (!update) {
    console.error(
      `CRITICAL: Failed to create YDoc update for database view ${viewId} (parent ${databaseId}). View creation will fail.`
    );
    // Return minimal view node without update payload
    return {
      type: 'create_node',
      data: { nodeId: viewId, attributes: viewAttributes },
    };
  }

  const encodedUpdate = encodeState(update);

  return {
    type: 'create_node',
    data: {
      nodeId: viewId,
      attributes: viewAttributes,
      update: encodedUpdate,
    },
  };
}

/**
 * Map Notion database fields to Colanode fields structure
 * @param notionFields Notion database fields array from the parser
 * @returns Colanode fields record (Record<ColanodeFieldId, FieldAttributes>)
 */
function mapDatabaseFields(
  notionFields: NotionDatabaseField[]
): Record<string, FieldAttributes> {
  const fields: Record<string, FieldAttributes> = {};
  let lastIndex = ''; // For generating ordered indices

  // Limit number of fields to prevent oversized databases
  const MAX_FIELDS = 100; // Increased limit slightly
  const limitedFields = notionFields.slice(0, MAX_FIELDS);

  if (notionFields.length > MAX_FIELDS) {
    console.warn(
      `Limiting database fields to ${MAX_FIELDS} (original had ${notionFields.length})`
    );
  }

  for (const notionField of limitedFields) {
    try {
      // Use the stable ID generated in the parser as the Colanode Field ID
      const fieldId = notionField.id;
      if (!fieldId) {
        console.warn(`Skipping field with missing ID: ${notionField.name}`);
        continue;
      }
      // Basic check for duplicates based on the generated ID
      if (fields[fieldId]) {
        console.warn(
          `Duplicate field ID detected during mapping: ${fieldId} (${notionField.name}). Skipping.`
        );
        continue;
      }

      const fieldName = notionField.name
        ? notionField.name.substring(0, 100)
        : 'Unnamed Field';

      // Map NotionFieldType to Colanode field type string
      const colanodeType = getColanodeFieldType(notionField.type);

      // Generate index for ordering
      const currentIndex = lastIndex
        ? generateNodeIndex(lastIndex)
        : generateNodeIndex();

      // Create the Colanode FieldAttributes object
      const field: FieldAttributes = {
        id: fieldId,
        name: fieldName,
        type: colanodeType as any, // Base type assignment
        index: currentIndex,
        // Options will be added conditionally below
      };

      // Handle select and multi_select options
      if (
        (colanodeType === 'select' || colanodeType === 'multi_select') &&
        notionField.options &&
        Array.isArray(notionField.options) &&
        notionField.options.length > 0
      ) {
        // Cast field to a type that includes options WHEN needed
        const fieldWithOptions = field as FieldAttributes & {
          options?: Record<string, SelectOptionAttributes>;
        };
        fieldWithOptions.options = {}; // Initialize options map for Colanode
        let lastOptionIndex = '';

        const MAX_OPTIONS = 200;
        const limitedOptions = notionField.options.slice(0, MAX_OPTIONS);

        if (notionField.options.length > MAX_OPTIONS) {
          console.warn(
            `Limiting options for field "${fieldName}" to ${MAX_OPTIONS} (original had ${notionField.options.length})`
          );
        }

        for (const notionOption of limitedOptions) {
          const optionId = notionOption.id;
          if (!optionId) {
            console.warn(
              `Skipping option with missing ID in field "${fieldName}": ${notionOption.name}`
            );
            continue;
          }
          // Access options via the correctly typed variable
          if (fieldWithOptions.options[optionId]) {
            console.warn(
              `Duplicate option ID "${optionId}" in field "${fieldName}". Skipping.`
            );
            continue;
          }

          const optionName = notionOption.name
            ? notionOption.name.substring(0, 100)
            : 'Unnamed Option';

          const currentOptionIndex = lastOptionIndex
            ? generateNodeIndex(lastOptionIndex)
            : generateNodeIndex();

          const selectOption: SelectOptionAttributes = {
            id: optionId,
            name: optionName,
            color: notionOption.color || 'default',
            index: currentOptionIndex,
          };

          // Assign options via the correctly typed variable
          fieldWithOptions.options[optionId] = selectOption;
          lastOptionIndex = currentOptionIndex;
        }
      }

      // Assign the potentially modified field (with options) back to the main record
      fields[fieldId] = field;
      lastIndex = currentIndex;
    } catch (error) {
      console.warn(
        `Error mapping field "${notionField.name}": ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  return fields;
}

/**
 * Map Notion database records to Colanode record creation mutations
 * @param database Notion database object from the parser
 * @param databaseId Colanode database ID
 * @param userId User ID performing the import (currently unused, but good practice)
 * @param notionIdToColanodeIdMap Map for resolving potential relations (not used in this phase)
 * @returns Array of mapped entities (create_node for record, update_document for record content)
 */
export async function mapDatabaseRecords(
  database: NotionDatabase,
  databaseId: string,
  userId: string, // Keep userId parameter even if not used immediately
  notionIdToColanodeIdMap: Map<string, string> // Keep map for future use
): Promise<MappedEntity[]> {
  const results: MappedEntity[] = [];

  const MAX_RECORDS = 1000; // Limit number of records per database
  const limitedRecords = database.records.slice(0, MAX_RECORDS);

  if (database.records.length > MAX_RECORDS) {
    console.warn(
      `Limiting database "${database.name}" records to ${MAX_RECORDS} (original had ${database.records.length})`
    );
  }

  console.log(
    `Mapping ${limitedRecords.length} records for database ${database.name} (${databaseId})`
  );

  for (const record of limitedRecords) {
    try {
      const recordId = generateId(IdType.Record);
      logger.debug(`Processing record ${record.name} -> ${recordId}`);

      // Map field values based on the database's FIELDS definition
      const fieldValues: Record<string, FieldValue> = {};

      // Iterate over the *defined* fields in the database schema
      for (const dbField of database.fields) {
        const colanodeFieldId = dbField.id; // The Colanode Field ID
        if (!colanodeFieldId) {
          logger.warn(
            `Skipping field without ID: ${dbField.name} in record ${record.name}`
          );
          continue;
        }

        // Get the raw value from the NotionRecord using the Notion Field Name
        const notionValue = record.values[dbField.name];

        // Map the value using the defined Colanode field type
        const mappedValue = mapFieldValue(notionValue, dbField); // Pass the NotionDatabaseField

        // Only add the field value if mapping was successful (not null)
        if (mappedValue !== null) {
          fieldValues[colanodeFieldId] = mappedValue;
          logger.debug(
            `  Mapped field ${dbField.name} (${colanodeFieldId}) -> ${JSON.stringify(mappedValue)}`
          );
        } else {
          logger.debug(
            `  Skipped null/empty field ${dbField.name} (${colanodeFieldId})`
          );
          // Optionally set an explicit empty value if required by schema:
          // fieldValues[colanodeFieldId] = { type: 'text', value: '' };
        }
      }

      // Ensure record name is sanitized
      const recordName = record.name
        ? record.name.substring(0, 500)
        : `Record ${record.id}`; // Use Notion record ID in name if available

      const recordAttributes: NodeAttributes = {
        type: 'record',
        name: recordName,
        parentId: databaseId, // Record's parent is the database node
        databaseId: databaseId, // Link back to the database ID
        fields: fieldValues, // Use the mapped field values
        // icon, cover etc. are handled by schema defaults
      };

      // Create CRDT update for the record node itself
      const ydocNode = new YDoc();
      if (!recordModel?.attributesSchema) {
        logger.error(
          `CRITICAL: recordModel.attributesSchema is undefined. Skipping record ${recordId}`
        );
        continue; // Skip this record if schema is missing
      }
      const nodeUpdate = ydocNode.update(
        recordModel.attributesSchema,
        recordAttributes
      );

      if (!nodeUpdate) {
        console.error(
          `CRITICAL: Failed to create YDoc update for record node ${recordName} (${recordId}). Record node creation will fail.`
        );
        continue; // Skip this record if update generation fails
      }
      const encodedNodeUpdate = encodeState(nodeUpdate);

      // Add the create_node mutation for the record
      results.push({
        type: 'create_node',
        data: {
          nodeId: recordId,
          attributes: recordAttributes,
          update: encodedNodeUpdate,
        },
      });
      logger.debug(`  Added create_node mutation for record ${recordId}`);

      // Add the update_document mutation for the record's content (placeholder)
      // Use createMinimalDocumentContent which handles CRDT creation
      const recordDocEntity = await createMinimalDocumentContent(
        recordId,
        `Content for record: ${recordName}` // Placeholder message
      );

      if (recordDocEntity) {
        // Ensure the returned entity is valid before pushing
        if (
          recordDocEntity.type === 'update_document' &&
          recordDocEntity.data.nodeId === recordId &&
          typeof recordDocEntity.data.update === 'string' // Basic check for update payload
        ) {
          results.push(recordDocEntity);
          logger.debug(
            `  Added update_document mutation for record ${recordId}`
          );
        } else {
          logger.warn(
            `Invalid document entity returned by createMinimalDocumentContent for record ${recordName} (${recordId})`
          );
        }
      } else {
        // This case should be rare due to fallbacks in createMinimalDocumentContent
        logger.warn(
          `Could not create fallback document entity for record ${recordName} (${recordId})`
        );
      }
    } catch (error) {
      console.warn(
        `Error processing record "${record.name || record.id}" for database "${database.name}": ${error instanceof Error ? error.message : String(error)}`
      );
      if (error instanceof Error && error.stack) {
        console.warn(`Stack trace: ${error.stack}`);
      }
    }
  }

  logger.info(
    `Finished mapping ${limitedRecords.length} records for ${database.name}. Generated ${results.length} mutations.`
  );
  return results;
}

/**
 * Map a field value from Notion to Colanode FieldValue format
 * @param notionValue Raw value from Notion CSV/Record
 * @param dbField The corresponding NotionDatabaseField definition (contains Notion type and options)
 * @returns Colanode FieldValue object or null if empty/invalid
 */
function mapFieldValue(
  notionValue: any,
  dbField: NotionDatabaseField
): FieldValue | null {
  // Handle null, undefined, or empty string values early
  if (notionValue === null || notionValue === undefined || notionValue === '') {
    return null; // Represent empty/missing values as null
  }

  // Get the target Colanode field type using the mapping function
  const colanodeType = getColanodeFieldType(dbField.type);
  const valueStr = String(notionValue); // Work with string representation for most cases

  try {
    switch (colanodeType) {
      case 'text':
      case 'url': // Store URL as text, validation/rendering handled by frontend/core
      case 'email': // Store email as text
      case 'phone': // Store phone as text
        // Limit text length to prevent excessively large fields
        const MAX_TEXT_LENGTH = 50000;
        return {
          type: 'text',
          value: valueStr.substring(0, MAX_TEXT_LENGTH),
        };

      case 'number':
        // Attempt to clean and parse the number
        const cleanedStr = valueStr.replace(/[^0-9.-]+/g, ''); // Remove currency, commas etc.
        const num = Number(cleanedStr);
        if (isNaN(num)) {
          logger.warn(
            `Could not parse number from "${valueStr}" for field "${dbField.name}". Storing as 0 or null? Returning null for now.`
          );
          return null; // Return null if parsing fails
          // Alternative: return { type: 'number', value: 0 };
        }
        // Add checks for excessively large numbers if necessary
        if (!Number.isFinite(num)) {
          logger.warn(
            `Non-finite number encountered: "${valueStr}" for field "${dbField.name}". Returning null.`
          );
          return null;
        }
        return { type: 'number', value: num };

      case 'boolean':
        // Handle various truthy/falsy strings from Notion checkbox export
        const lowerVal = valueStr.toLowerCase().trim();
        const isTrue = [
          'true',
          'yes',
          'checked',
          '1',
          'x', // Common checkbox representation
          'on',
        ].includes(lowerVal);
        return { type: 'boolean', value: isTrue };

      case 'date':
        try {
          const date = new Date(valueStr);
          if (isNaN(date.getTime())) {
            throw new Error('Invalid date string');
          }
          // Store date as ISO string in a text field value
          return { type: 'text', value: date.toISOString() };
        } catch (error) {
          logger.warn(
            `Invalid date format "${valueStr}" for field "${dbField.name}". Storing as null.`
          );
          return null;
        }

      case 'select': {
        // Find the corresponding option ID from the field definition
        const trimmedValue = valueStr.trim();
        const selectedOption = dbField.options?.find(
          (opt) => opt.name === trimmedValue
        );
        if (selectedOption && selectedOption.id) {
          // Colanode stores the *option ID* for select types
          // The FieldValue type itself might be 'text' or a dedicated 'select_option' if defined
          // Assuming it should be stored as text containing the option ID:
          return { type: 'text', value: selectedOption.id };
        } else {
          logger.warn(
            `Select option "${trimmedValue}" not found in definitions for field "${dbField.name}". Storing as null.`
          );
          // Fallback: Store null if option doesn't match defined options
          return null;
          // Alternative: Store the raw text value? `{ type: 'text', value: trimmedValue.substring(0, 500) }` - less ideal for data integrity
        }
      }

      case 'multi_select': {
        const selectedOptionIds: string[] = [];
        // Split comma-separated values, trim whitespace, filter empty
        const values = valueStr
          .split(',')
          .map((v) => v.trim())
          .filter(Boolean);

        values.forEach((val) => {
          const selectedOption = dbField.options?.find(
            (opt) => opt.name === val
          );
          if (selectedOption && selectedOption.id) {
            selectedOptionIds.push(selectedOption.id);
          } else {
            console.warn(
              `Multi-select option "${val}" not found in definitions for field "${dbField.name}". Skipping option.`
            );
          }
        });

        // Limit array size to prevent excessively large fields
        const MAX_MULTI_SELECT_OPTIONS = 50;
        if (selectedOptionIds.length > MAX_MULTI_SELECT_OPTIONS) {
          console.warn(
            `Too many multi-select options mapped for field "${dbField.name}" (${selectedOptionIds.length}), limiting to ${MAX_MULTI_SELECT_OPTIONS}`
          );
          selectedOptionIds.length = MAX_MULTI_SELECT_OPTIONS; // Truncate array
        }

        // Colanode stores multi-select as an array of option IDs
        // Ensure the FieldValue type is 'string_array' or similar
        return { type: 'string_array', value: selectedOptionIds };
      }

      // Handle other potential Colanode types if they derive from Notion types
      // case 'collaborator': // Example - needs mapping logic if used
      //   return { type: 'collaborator', value: findUserId(valueStr) };

      default:
        // For any unhandled Colanode types derived from Notion types, store as text as a safe fallback
        logger.warn(
          `Unhandled mapped Colanode field type "${colanodeType}" (from Notion type "${dbField.type}") for field "${dbField.name}". Storing as text fallback.`
        );
        const MAX_FALLBACK_LENGTH = 10000;
        return {
          type: 'text',
          value: valueStr.substring(0, MAX_FALLBACK_LENGTH),
        };
    }
  } catch (error) {
    // Catch potential errors during value processing
    logger.error(
      `Error mapping field value for "${dbField.name}" (Notion type ${dbField.type}, Colanode type ${colanodeType}, Value: "${valueStr.substring(0, 100)}..."): ${error instanceof Error ? error.message : String(error)}. Storing null.`
    );
    return null; // Return null on error
  }
}

/**
 * Get Colanode field type for a Notion field type string
 * @param notionType Notion field type string
 * @returns Corresponding Colanode field type string (e.g., 'text', 'number')
 */
function getColanodeFieldType(notionType: string): string {
  // Change parameter type to string
  // Mapping based on expected Colanode core field types
  const typeMap: Record<string, string> = {
    // Change type to Record<string, string>
    text: 'text',
    number: 'number',
    select: 'select', // Assumes Colanode uses 'select' for single-select by ID
    multi_select: 'multi_select', // Assumes Colanode uses 'multi_select' for multi-select by IDs
    date: 'date', // Assumes Colanode 'date' type handles ISO strings or similar
    checkbox: 'boolean',
    url: 'url', // Use Colanode 'url' type if available, else 'text'
    email: 'email', // Use Colanode 'email' type if available, else 'text'
    phone_number: 'phone', // Use Colanode 'phone' type if available, else 'text'

    // Types that likely map to text or need special handling:
    person: 'text', // Map people names to text unless user mapping exists
    files: 'text', // Map file lists (usually just names/URLs in CSV) to text
    formula: 'text', // Store formula result as text
    relation: 'text', // Map relations to text unless relation mapping exists
    rollup: 'text', // Map rollup result to text
    created_time: 'date', // Map to date type
    created_by: 'text', // Map user to text
    last_edited_time: 'date', // Map to date type
    last_edited_by: 'text', // Map user to text
  };

  // Ensure notionType is a valid key before lookup
  if (typeof notionType === 'string' && notionType in typeMap) {
    return typeMap[notionType] || 'text';
  }

  console.warn(
    `Unknown Notion field type encountered: "${notionType}". Defaulting to 'text'.`
  );
  return 'text'; // Default to 'text' for unknown types
}

// Add a validation function to check document content structure
function validateDocumentContent(documentContent: DocumentContent): boolean {
  try {
    if (!documentContent || typeof documentContent !== 'object') {
      console.error('Document content is not an object');
      return false;
    }

    if (documentContent.type !== 'rich_text') {
      console.error(`Invalid document content type: ${documentContent.type}`);
      return false;
    }

    if (!documentContent.blocks || typeof documentContent.blocks !== 'object') {
      console.error('Document content blocks missing or invalid');
      return false;
    }

    // Check block structure
    const blocks = documentContent.blocks;
    const blockIds = Object.keys(blocks);

    if (blockIds.length === 0) {
      console.error('Document has no blocks');
      return false;
    }

    for (const blockId of blockIds) {
      const block = blocks[blockId];

      if (!block) {
        console.error(`Block ${blockId} is undefined`);
        return false;
      }

      if (!block.id || !block.type || !block.parentId) {
        console.error(`Block ${blockId} missing required fields`);
        return false;
      }

      if (!block.index) {
        console.error(`Block ${blockId} missing index`);
        return false;
      }

      // If type is page, make sure we've defined it in ColanodeBlockType
      if (block.type === 'page' && !['page'].includes(block.type)) {
        console.error(`Block ${blockId} has invalid type: ${block.type}`);
        return false;
      }
    }

    return true;
  } catch (error) {
    console.error('Validation error:', error);
    return false;
  }
}

/**
 * Map a page blueprint to a Colanode page create_node mutation
 * @param blueprint PageBlueprint object containing the resolved mapping information
 * @returns Mapped entity for node creation
 */
export async function mapPageFromBlueprint(
  blueprint: PageBlueprint
): Promise<MappedEntity> {
  // Create page attributes with required parentId property
  const pageAttributes: NodeAttributes = {
    type: 'page',
    name: blueprint.cleanName.substring(0, 500),
    parentId: blueprint.parentColanodeId || '', // Provide empty string if null
  };

  const ydoc = new YDoc();
  const update = ydoc.update(pageModel.attributesSchema, pageAttributes);

  if (!update) {
    console.error(
      `CRITICAL: Failed to create YDoc update for page ${blueprint.cleanName} (${blueprint.colanodeId}). Node creation will likely fail.`
    );
    return {
      type: 'create_node',
      data: {
        nodeId: blueprint.colanodeId,
        attributes: pageAttributes,
      },
    };
  }

  const encodedUpdate = encodeState(update);

  return {
    type: 'create_node',
    data: {
      nodeId: blueprint.colanodeId,
      attributes: pageAttributes,
      update: encodedUpdate,
    },
  };
}

/**
 * Map PageBlueprint content to document update mutation
 * @param blueprint PageBlueprint containing page information
 * @param notionIdToColanodeIdMap Mapping from Notion IDs to Colanode IDs (for links)
 * @param blueprints Map of all page blueprints
 * @returns Document mutation entity, or null on failure
 */
export async function mapPageContentFromBlueprint(
  blueprint: PageBlueprint,
  notionIdToColanodeIdMap: Map<string, string>,
  blueprints: Map<string, PageBlueprint | DatabaseBlueprint>
): Promise<MappedEntity | null> {
  try {
    // Get original Notion entity from the blueprint
    const page = blueprint.entity;
    const pageId = blueprint.colanodeId;

    // If page content is too large, log warning but proceed (server might handle limits)
    const maxContentLength = 500000; // 500KB limit - adjust as needed
    let content = page.content || '';

    if (content.length > maxContentLength) {
      console.warn(
        `Page content for "${blueprint.cleanName}" (${pageId}) is large (${content.length} bytes). Parsing may be slow or fail.`
      );
    }

    // Process Notion links within the markdown *before* parsing blocks
    content = processNotionLinks(content, notionIdToColanodeIdMap);

    // Parse markdown content into hierarchical blocks
    let parsedBlocks: ParsedBlock[] = [];
    try {
      parsedBlocks = parseMarkdown(content);
    } catch (error) {
      console.error(
        `Error parsing markdown for page ${blueprint.cleanName} (${pageId}), creating fallback content: ${error}`
      );
      return createMinimalDocumentContent(
        pageId,
        `Error parsing content for page: ${blueprint.cleanName}`
      );
    }

    // Map parsed blocks to Colanode blocks recursively
    const colanodeBlocks = mapParsedBlocksToColanode(
      parsedBlocks,
      pageId,
      notionIdToColanodeIdMap,
      blueprints
    );

    // Add database blocks for direct children
    let lastChildIndex = Object.keys(colanodeBlocks).reduce(
      (lastIdx, blockId) => {
        const block = colanodeBlocks[blockId];
        // Find the lexicographically largest index among top-level blocks
        if (
          block &&
          block.parentId === pageId &&
          (!lastIdx || block.index > lastIdx)
        ) {
          return block.index;
        }
        return lastIdx;
      },
      ''
    ); // Start with empty string index

    for (const [identifier, childBlueprint] of blueprints.entries()) {
      if (
        childBlueprint.type === 'database_blueprint' &&
        childBlueprint.parentColanodeId === pageId
      ) {
        const dbBlockId = childBlueprint.colanodeId;
        // Ensure we don't overwrite existing blocks
        if (!colanodeBlocks[dbBlockId]) {
          const dbBlockIndex = lastChildIndex
            ? generateNodeIndex(lastChildIndex)
            : generateNodeIndex();
          colanodeBlocks[dbBlockId] = {
            id: dbBlockId,
            type: 'database', // The block type is 'database'
            parentId: pageId,
            index: dbBlockIndex,
            content: [], // Database blocks don't have direct content
            attrs: {}, // No specific attributes needed usually
          };
          lastChildIndex = dbBlockIndex; // Update last index for next potential child
          logger.debug(`Added database block ${dbBlockId} to page ${pageId}`);
        } else {
          logger.warn(
            `Block ID conflict: Database ${dbBlockId} already exists in page ${pageId}. Skipping block insertion.`
          );
        }
      }
    }

    // DEBUGGING: Check if blocks are empty after mapping
    if (Object.keys(colanodeBlocks).length === 0) {
      console.warn(
        `No Colanode blocks generated after mapping for page ${blueprint.cleanName} (${pageId}). Creating fallback.`
      );
      return createMinimalDocumentContent(
        pageId,
        `No content generated for page: ${blueprint.cleanName}`
      );
    }

    // Create document content structure
    const documentContent: DocumentContent = {
      type: 'rich_text',
      blocks: colanodeBlocks,
    };

    // DEBUGGING: Log document structure for troubleshooting
    console.log(
      `Document for ${blueprint.cleanName} (${pageId}) has ${Object.keys(colanodeBlocks).length} blocks`
    );

    // Validate document content structure
    if (!validateDocumentContent(documentContent)) {
      console.error(
        `Invalid document content structure for page ${blueprint.cleanName} (${pageId})`
      );
      return createMinimalDocumentContent(
        pageId,
        `Invalid document structure for page: ${blueprint.cleanName}`
      );
    }

    // Validate the document size isn't too large *after* structuring
    const docSize = JSON.stringify(documentContent).length;
    const maxDocSize = 1 * 1024 * 1024; // 1MB limit for the final JSON - adjust as needed
    if (docSize > maxDocSize) {
      console.warn(
        `Final document structure for page ${blueprint.cleanName} (${pageId}) is too large (${docSize} bytes > ${maxDocSize}). Creating simplified version.`
      );
      return createMinimalDocumentContent(
        pageId,
        `Imported content for ${blueprint.cleanName} was too large.`
      );
    }

    // Use YDoc encoding for document content CRDT update
    let ydoc, update, encodedUpdate;
    try {
      ydoc = new YDoc();
      // Check if documentContentSchema is defined
      if (!documentContentSchema) {
        console.error(
          `documentContentSchema is undefined for page ${blueprint.cleanName} (${pageId})`
        );
        return createMinimalDocumentContent(
          pageId,
          `Schema missing for document content: ${blueprint.cleanName}`
        );
      }

      update = ydoc.update(documentContentSchema, documentContent);

      if (!update) {
        console.error(
          `CRITICAL: Failed to create YDoc update for document content of ${blueprint.cleanName} (${pageId}). Document update will fail.`
        );
        return createMinimalDocumentContent(
          pageId,
          `Error generating document update for page: ${blueprint.cleanName}`
        );
      }

      encodedUpdate = encodeState(update);
      if (!encodedUpdate) {
        console.error(
          `Failed to encode state for ${blueprint.cleanName} (${pageId})`
        );
        return createMinimalDocumentContent(
          pageId,
          `Error encoding document update for page: ${blueprint.cleanName}`
        );
      }
    } catch (ydocError) {
      console.error(
        `YDoc error for ${blueprint.cleanName} (${pageId}): ${ydocError instanceof Error ? ydocError.message : String(ydocError)}`
      );
      return createMinimalDocumentContent(
        pageId,
        `Error in document structure for page: ${blueprint.cleanName}`
      );
    }

    // CRITICAL: Ensure the final structure is correct
    return {
      type: 'update_document',
      data: {
        nodeId: pageId, // Use nodeId instead of documentId
        update: encodedUpdate,
      },
    };
  } catch (error) {
    // Detailed error logging for better debugging
    console.error(
      `Error creating document content mutation for ${blueprint.cleanName} (${blueprint.colanodeId}): ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    if (error instanceof Error && error.stack) {
      console.error(`Stack trace: ${error.stack}`);
    }

    // Return a minimal valid document as fallback
    return createMinimalDocumentContent(
      blueprint.colanodeId,
      `Error processing document content for page: ${blueprint.cleanName}`
    );
  }
}

/**
 * Map a Notion file to a Colanode file node creation mutation
 * @param file Notion file entity
 * @param fileId Colanode file ID
 * @param parentId Parent node ID
 * @returns Mapped entity
 */
async function mapFile(
  file: NotionFile,
  fileId: string,
  parentId?: string
): Promise<MappedEntity> {
  try {
    const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB limit

    if (file.size > MAX_FILE_SIZE) {
      logger.warn(
        `Skipping oversized file (${(file.size / 1024 / 1024).toFixed(1)}MB): ${file.name} (${file.filePath})`
      );
      // Use the placeholder function which handles YDoc encoding
      return createPlaceholderFileNode(
        fileId,
        parentId,
        file.name,
        'File Too Large'
      );
    }

    // Assume uploadFile exists and handles the upload process
    const uploadResult = await uploadFile(file.filePath, fileId, file.mimeType);
    if (!uploadResult || !uploadResult.url) {
      throw new Error(`File upload failed for ${file.name}`);
    }

    const fileExtension = path
      .extname(file.filePath)
      .toLowerCase()
      .substring(1);

    const fileName = file.name ? file.name.substring(0, 500) : 'Untitled File';

    const fileAttributes: NodeAttributes = {
      type: 'file',
      name: fileName,
      parentId: parentId || '',
      mimeType: file.mimeType || 'application/octet-stream',
      status: 1, // Assuming 1 means uploaded/success
      subtype: 'attachment', // Default subtype
      originalName: path.basename(file.filePath), // Keep original filename
      extension: fileExtension,
      size: file.size,
      version: '1', // Initial version
      // url is typically derived/managed by the server/core, not set directly here
    };

    const ydoc = new YDoc();
    if (!fileModel?.attributesSchema) {
      throw new Error('fileModel.attributesSchema is undefined');
    }
    const update = ydoc.update(fileModel.attributesSchema, fileAttributes);

    if (!update) {
      logger.error(
        `CRITICAL: Failed to create YDoc update for file ${fileName} (${fileId}). Node creation will likely fail.`
      );
      // Use placeholder on YDoc error as well
      return createPlaceholderFileNode(
        fileId,
        parentId,
        file.name,
        'YDoc Encoding Error'
      );
    }

    const encodedUpdate = encodeState(update);

    return {
      type: 'create_node',
      data: {
        nodeId: fileId,
        attributes: fileAttributes,
        update: encodedUpdate,
      },
    };
  } catch (error) {
    logger.error(
      `Error mapping file ${file.name} (${file.filePath}): ${error instanceof Error ? error.message : String(error)}`
    );
    // Use placeholder on general mapping error
    return createPlaceholderFileNode(
      fileId,
      parentId,
      file.name,
      'Import Error'
    );
  }
}

/**
 * Creates a placeholder file node when the actual file cannot be imported.
 * Includes YDoc encoding for consistency.
 * @param fileId Colanode file ID
 * @param parentId Parent node ID
 * @param originalName Original filename
 * @param reason Reason for creating a placeholder
 * @returns MappedEntity for the placeholder file node
 */
function createPlaceholderFileNode(
  fileId: string,
  parentId: string | undefined,
  originalName: string,
  reason: string
): MappedEntity {
  const fallbackName =
    `Import Failed: ${originalName || 'Unknown File'} (${reason})`.substring(
      0,
      500
    );
  // Ensure originalName is a string for path.extname
  const originalNameStr =
    typeof originalName === 'string' ? originalName : 'unknown.file';

  const fallbackAttributes: NodeAttributes = {
    type: 'file',
    name: fallbackName,
    parentId: parentId || '',
    mimeType: 'application/octet-stream',
    status: 0, // Indicate failure/placeholder status
    subtype: 'attachment',
    originalName: path.basename(originalNameStr), // Use basename of the string
    extension:
      path.extname(originalNameStr).substring(1).toLowerCase() || 'err',
    size: 0,
    version: '1',
  };
  try {
    const ydoc = new YDoc();
    if (!fileModel?.attributesSchema) {
      throw new Error(
        'fileModel.attributesSchema is undefined for placeholder'
      );
    }
    const update = ydoc.update(fileModel.attributesSchema, fallbackAttributes);
    if (!update) throw new Error('Failed placeholder ydoc update for file');
    const encodedUpdate = encodeState(update);
    return {
      type: 'create_node',
      data: {
        nodeId: fileId,
        attributes: fallbackAttributes,
        update: encodedUpdate,
      },
    };
  } catch (fallbackError) {
    logger.error(
      `Failed to create placeholder file node (with YDoc) for ${fileId}: ${fallbackError}`
    );
    // Last resort: return without update payload if even fallback fails
    return {
      type: 'create_node',
      data: { nodeId: fileId, attributes: fallbackAttributes },
    };
  }
}
