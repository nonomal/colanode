import fs from 'fs';
import path from 'path';
import { Block, generateId, generateNodeIndex, IdType } from '@colanode/core';
import { NotionFieldType } from './types';
import AdmZip from 'adm-zip'; // Use adm-zip for better cross-platform compatibility

// Logger interface matching the one from index.ts
interface Logger {
  info: (message: string) => void;
  success: (message: string) => void;
  step: (message: string) => void;
  error: (message: string, error?: any) => void;
  warn: (message: string) => void;
  debug: (message: string) => void;
}

// Default logger that will be replaced when imported
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

/**
 * Extract a Notion export zip file using adm-zip
 * @param zipPath Path to the Notion export zip file
 * @returns Path to the extracted directory
 */
export async function extractZip(zipPath: string): Promise<string> {
  const extractBase = path.join(
    path.dirname(zipPath),
    `notion_extract_${Date.now()}`
  );
  let extractPath = extractBase; // Start with base path

  logger.info(`Extracting ZIP: ${zipPath}`);
  logger.debug(`Target directory: ${extractBase}`);

  try {
    // Create base extraction directory
    await fs.promises.mkdir(extractBase, { recursive: true });

    // Use adm-zip for extraction
    const zip = new AdmZip(zipPath);
    zip.extractAllTo(extractBase, /*overwrite*/ true);
    logger.debug(`Extracted contents to ${extractBase}`);

    // Check for common Notion export structure: a single folder inside the extract path
    const items = await fs.promises.readdir(extractBase);
    if (items.length === 1) {
      const singleItemPath = path.join(extractBase, items[0]!);
      const stats = await fs.promises.stat(singleItemPath);
      if (stats.isDirectory()) {
        logger.debug(`Found single directory structure: ${items[0]}`);
        extractPath = singleItemPath; // Update extractPath to the inner folder
      }
    }

    // Check for nested zip files within the (potentially updated) extractPath
    const currentItems = await fs.promises.readdir(extractPath, {
      withFileTypes: true,
    });
    const nestedZipFiles = currentItems.filter(
      (item) =>
        item.isFile() && path.extname(item.name).toLowerCase() === '.zip'
    );

    if (nestedZipFiles.length > 0) {
      logger.info(
        `Found ${nestedZipFiles.length} nested ZIP file(s), extracting...`
      );
      // Assuming the primary content is in the first nested zip found
      const nestedZipPath = path.join(extractPath, nestedZipFiles[0]!.name);
      const nestedExtractPath = path.join(extractPath, 'nested_extract');
      await fs.promises.mkdir(nestedExtractPath, { recursive: true });

      try {
        const nestedZip = new AdmZip(nestedZipPath);
        nestedZip.extractAllTo(nestedExtractPath, true);
        logger.debug(`Extracted nested ZIP to ${nestedExtractPath}`);

        // Check if nested extraction resulted in a single directory again
        const nestedItems = await fs.promises.readdir(nestedExtractPath);
        if (nestedItems.length === 1) {
          const nestedSingleItemPath = path.join(
            nestedExtractPath,
            nestedItems[0]!
          );
          const nestedStats = await fs.promises.stat(nestedSingleItemPath);
          if (nestedStats.isDirectory()) {
            logger.debug(
              `Found single directory in nested zip: ${nestedItems[0]}`
            );
            extractPath = nestedSingleItemPath; // Update extractPath to the deepest relevant folder
          } else {
            extractPath = nestedExtractPath; // Use the direct extraction path if single item is not a dir
          }
        } else {
          extractPath = nestedExtractPath; // Use the nested extraction path directly if multiple items
        }
      } catch (nestedError) {
        logger.error(`Error extracting nested ZIP file`, nestedError);
        // Continue with the current extractPath if nested fails
      }
    }

    logger.success(`Extraction complete: ${extractPath}`);
    return extractPath;
  } catch (error) {
    logger.error(`ZIP extraction failed`, error);
    // Clean up potentially incomplete extraction directory
    try {
      await fs.promises.rm(extractBase, { recursive: true, force: true });
    } catch (cleanupError) {}
    throw new Error(
      `Failed to extract Notion ZIP: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Upload a file (Placeholder - replace with actual cloud storage upload)
 * @param filePath Path to the local file
 * @param fileId Colanode file ID (used for naming in this placeholder)
 * @param type MIME type
 * @returns Object containing URL or path info (adapt to actual uploader needs)
 */
export async function uploadFile(
  filePath: string,
  fileId: string,
  type: string
): Promise<{ url: string; path?: string }> {
  // Return structure example
  // --- Placeholder Implementation ---
  // Copies file to a local 'uploads' directory. Replace with S3, GCS, etc.
  try {
    const uploadsDir = path.resolve(process.cwd(), 'uploads'); // Use absolute path
    await fs.promises.mkdir(uploadsDir, { recursive: true });

    // Create a unique filename based on fileId and original extension
    const fileExtension = path.extname(filePath);
    const uniqueFileName = `${fileId}${fileExtension}`; // Use Colanode ID for name
    const destinationPath = path.join(uploadsDir, uniqueFileName);

    await fs.promises.copyFile(filePath, destinationPath);

    logger.debug(`Placeholder upload: copied file to ${destinationPath}`);

    // Return a relative URL assuming a static server serves the 'uploads' dir
    const relativeUrl = `/uploads/${uniqueFileName}`;
    return { url: relativeUrl, path: destinationPath };
  } catch (error) {
    logger.error(`File upload failed for ${filePath}`, error);
    throw new Error(
      `File copy failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  // --- End Placeholder ---

  /* --- Example S3 Upload (requires aws-sdk) ---
  const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3"); // Use v3 SDK
  const s3 = new S3Client({ region: "your-region" }); // Configure client
  const bucketName = "your-bucket-name";
  const fileStream = fs.createReadStream(filePath);
  const uniqueKey = `notion-imports/${fileId}${path.extname(filePath)}`;

  try {
    const command = new PutObjectCommand({
      Bucket: bucketName,
      Key: uniqueKey,
      Body: fileStream,
      ContentType: type || 'application/octet-stream',
      // Add ACL, CacheControl etc. as needed
    });
    await s3.send(command);
    const fileUrl = `https://${bucketName}.s3.your-region.amazonaws.com/${uniqueKey}`;
    console.log(`Successfully uploaded ${filePath} to S3: ${fileUrl}`);
    return { url: fileUrl, path: uniqueKey }; // Return URL and S3 key
  } catch (error) {
    console.error(`S3 upload failed for ${filePath}:`, error);
    throw error;
  }
  */
}

/**
 * Clean a Notion filename by removing potential trailing GUID and extension.
 * @param filename Notion filename (e.g., "Page Title aabbccddeeff.md")
 * @returns Cleaned name (e.g., "Page Title")
 */
export function cleanNotionName(filename: string): string {
  // Remove file extension first
  const nameWithoutExt = filename.includes('.')
    ? filename.substring(0, filename.lastIndexOf('.'))
    : filename;

  // Updated regex for matching Notion GUIDs, allowing for more character types
  const NOTION_GUID_REGEX = / ([a-zA-Z0-9]{32})$/i;
  const cleanedName = nameWithoutExt.replace(NOTION_GUID_REGEX, '').trim();

  // Return the cleaned name, or the original if no changes were made
  return cleanedName || filename; // Ensure non-empty return
}

/**
 * Get Colanode field type from Notion field type string
 * @param notionType Notion field type string
 * @returns Colanode field type string
 */
export function getColanodeFieldType(
  notionType: NotionFieldType | string
): string {
  // This is duplicated in mapper.ts, consider moving to a shared types/helpers file if possible
  const typeMap: Partial<Record<NotionFieldType, string>> = {
    text: 'text',
    number: 'number',
    select: 'select',
    multi_select: 'multi_select',
    date: 'date',
    checkbox: 'boolean',
    url: 'url',
    email: 'email',
    phone_number: 'phone',
    person: 'text',
    files: 'text',
    formula: 'text',
    relation: 'text',
    rollup: 'text',
    created_time: 'date',
    created_by: 'text',
    last_edited_time: 'date',
    last_edited_by: 'text',
  };
  if (typeof notionType === 'string' && notionType in typeMap) {
    return typeMap[notionType as NotionFieldType] || 'text';
  }
  return 'text';
}

/**
 * Build a paragraph block for rich text content
 * @param parentId Parent node ID (Colanode ID)
 * @param text Block text content
 * @param blockId Optional: specific block ID to use
 * @param index Optional: Node index (or generated if not provided)
 * @returns Block object
 */
export function buildParagraphBlock(
  parentId: string,
  text: string,
  blockId?: string, // Allow providing ID
  index?: string
): Block {
  const id = blockId || generateId(IdType.Block);
  return {
    id: id,
    type: 'paragraph',
    parentId,
    content: [{ type: 'text', text: text.substring(0, 10000) }], // Limit text length
    index: index || generateNodeIndex(),
    attrs: {}, // Ensure attrs object exists
  };
}

/**
 * Build a heading block for rich text content
 * @param parentId Parent node ID (Colanode ID)
 * @param text Heading text content
 * @param level Heading level (1-3)
 * @param blockId Optional: specific block ID to use
 * @param index Optional: Node index (or generated if not provided)
 * @returns Block object
 */
export function buildHeadingBlock(
  parentId: string,
  text: string,
  level: 1 | 2 | 3,
  blockId?: string, // Allow providing ID
  index?: string
): Block {
  const id = blockId || generateId(IdType.Block);
  return {
    id: id,
    type: `heading${level}`,
    parentId,
    content: [{ type: 'text', text: text.substring(0, 5000) }], // Limit text length
    index: index || generateNodeIndex(),
    attrs: {}, // Ensure attrs object exists
  };
}

/**
 * Build a list item block for rich text content
 * @param parentId Parent node ID
 * @param text List item text content
 * @param listType Type of list ('bullet' or 'ordered')
 * @param index Node index (or generated if not provided)
 * @returns Block object
 */
export function buildListItemBlock(
  parentId: string,
  text: string,
  listType: 'bullet' | 'ordered',
  index?: string
): Block {
  const blockId = generateId(IdType.Block);
  return {
    id: blockId,
    type: 'list_item',
    parentId,
    content: [{ type: 'text', text }],
    attrs: { listType },
    index: index || generateNodeIndex(),
  };
}

/**
 * Build a code block for rich text content
 * @param parentId Parent node ID
 * @param text Code content
 * @param language Programming language
 * @param blockId Optional: specific block ID to use
 * @param index Node index (or generated if not provided)
 * @returns Block object
 */
export function buildCodeBlock(
  parentId: string,
  text: string,
  language: string | undefined, // Language might be undefined
  blockId?: string,
  index?: string
): Block {
  const id = blockId || generateId(IdType.Block);
  return {
    id: id,
    type: 'code',
    parentId,
    content: [{ type: 'text', text }], // Code blocks often need full content
    attrs: { language: language || 'plaintext' }, // Default language
    index: index || generateNodeIndex(),
  };
}

/**
 * Build a quote block for rich text content
 * @param parentId Parent node ID
 * @param text Quote content (often handled by nested paragraph)
 * @param blockId Optional: specific block ID to use
 * @param index Node index (or generated if not provided)
 * @returns Block object
 */
export function buildQuoteBlock(
  parentId: string,
  text: string, // Text might not be directly on quote, but in nested blocks
  blockId?: string,
  index?: string
): Block {
  const id = blockId || generateId(IdType.Block);
  return {
    id: id,
    type: 'blockquote',
    parentId,
    // Quote content is typically nested blocks, not direct text content
    content: [],
    index: index || generateNodeIndex(),
    attrs: {}, // Ensure attrs object exists
  };
}

/**
 * Build a horizontal rule block for rich text content
 * @param parentId Parent node ID
 * @param blockId Optional: specific block ID to use
 * @param index Optional: Node index (or generated if not provided)
 * @returns Block object
 */
export function buildHorizontalRuleBlock(
  parentId: string,
  blockId?: string,
  index?: string
): Block {
  const id = blockId || generateId(IdType.Block);
  return {
    id: id,
    type: 'horizontalRule',
    parentId,
    content: [], // Horizontal rules don't have content
    index: index || generateNodeIndex(),
    attrs: {}, // No specific attributes
  };
}

/**
 * Extract parent-child relationships from file paths in the Notion export
 * This is helpful when markdown links don't provide enough information
 * @param filePaths Array of file paths from the Notion export
 * @param guidToEntityMap Map of GUIDs to their entity information
 * @returns Map of child GUIDs to parent GUIDs
 */
export function extractHierarchyFromPaths(
  filePaths: string[],
  guidToEntityMap: Map<string, { guid: string; filePath: string; name: string }>
): Map<string, string> {
  const relationshipMap = new Map<string, string>();

  // First, organize files by their directory paths
  const dirToFilesMap = new Map<string, string[]>();

  for (const filePath of filePaths) {
    const dir = path.dirname(filePath);
    if (!dirToFilesMap.has(dir)) {
      dirToFilesMap.set(dir, []);
    }
    const files = dirToFilesMap.get(dir);
    if (files) {
      files.push(filePath);
    }
  }

  // For each file, check if it's in a directory that indicates it's a child
  for (const [guid, entity] of guidToEntityMap.entries()) {
    const filePath = entity.filePath;
    const dir = path.dirname(filePath);

    // Skip root level files
    const parentDir = path.dirname(dir);
    const parentDirFiles = dirToFilesMap.get(parentDir) || [];

    // For each potential parent file
    for (const potentialParentFile of parentDirFiles) {
      // Skip self
      if (potentialParentFile === filePath) continue;

      // Extract GUID from potential parent
      const parentFilename = path.basename(potentialParentFile);
      const parentGuidMatch = parentFilename.match(
        / ([a-f0-9]{32})\.[a-zA-Z]+$/
      );

      if (!parentGuidMatch) continue;

      const parentGuid = parentGuidMatch[1];

      // If the directory name contains the parent's name, it's likely a parent-child relationship
      // Notion often names nested page directories like "Parent Page abc123/Child Page def456"
      if (dir.includes(path.basename(parentDir)) && parentGuid) {
        relationshipMap.set(guid, parentGuid);
        break;
      }
    }
  }

  return relationshipMap;
}
