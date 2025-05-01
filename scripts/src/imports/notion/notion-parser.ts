import fs from 'fs';
import path from 'path';
import { parse as parseCSV } from 'csv-parse/sync';
import { marked } from 'marked';
import mime from 'mime-types';
import {
  NotionEntity,
  NotionPage,
  NotionDatabase,
  NotionFile,
  NotionDatabaseField,
  NotionRecord,
  ParsedBlock,
  NotionFieldType,
  IdentifiedEntity,
  PageBlueprint,
  DatabaseBlueprint,
} from './types';
import { cleanNotionName } from './utils';
import { generateId, IdType } from '@colanode/core';

// Regular expression to extract the Notion GUID from filenames
const NOTION_GUID_REGEX = / ([a-zA-Z0-9]{32})(\.md|\.csv)?$/i;

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

// Interface for CSV record
interface CSVRecord {
  [key: string]: string;
}

/**
 * Scan directory to identify actual Notion content files
 * @param directoryPath Path to the directory
 * @returns Map of GUIDs to identified entities
 */
async function scanDirectory(
  directoryPath: string
): Promise<Map<string, IdentifiedEntity>> {
  const entityMap = new Map<string, IdentifiedEntity>();

  // Helper function to recursively scan directories
  async function scan(currentPath: string) {
    const items = await fs.promises.readdir(currentPath, {
      withFileTypes: true,
    });

    for (const item of items) {
      const itemPath = path.join(currentPath, item.name);

      // Skip known irrelevant files/folders
      if (
        item.name.toLowerCase() === 'home' ||
        item.name === 'index.html' ||
        item.name.startsWith('.')
      ) {
        continue;
      }

      if (item.isDirectory()) {
        // Recursively scan subdirectories
        await scan(itemPath);
      } else {
        const ext = path.extname(item.name).toLowerCase();

        // Only process .md and .csv files
        if (ext === '.md' || ext === '.csv') {
          const nameWithoutExt = path.basename(item.name, ext);
          const guidMatch = nameWithoutExt.match(NOTION_GUID_REGEX);

          if (guidMatch && guidMatch[1]) {
            const guid = guidMatch[1];
            const cleanName = nameWithoutExt
              .replace(NOTION_GUID_REGEX, '')
              .trim();

            // Store in our entity map
            entityMap.set(guid, {
              id: guid,
              type: ext === '.md' ? 'page' : 'database',
              name: cleanName,
              cleanName,
              filePath: itemPath,
            });

            logger.debug(
              `Found ${ext === '.md' ? 'page' : 'database'}: ${cleanName}`
            );
          }
        }
      }
    }
  }

  await scan(directoryPath);
  return entityMap;
}

/**
 * Recursively process a directory from Notion export
 * @param directoryPath Path to the directory
 * @returns Array of NotionEntity objects and hierarchy map
 */
export async function processDirectory(directoryPath: string): Promise<{
  entities: NotionEntity[];
  childToParentGuidMap: Map<string, string>;
}> {
  const absoluteDirectoryPath = path.resolve(directoryPath); // Use absolute path
  logger.info(`Processing directory: ${absoluteDirectoryPath}`);

  // Step 1: Identify all content entities (.md, .csv)
  const entityMap = await scanDirectory(absoluteDirectoryPath);
  logger.info(`Found ${entityMap.size} content entities (pages/databases)`);

  // Step 2: Build hierarchy based *primarily* on folder structure
  const childToParentGuidMap = new Map<string, string>();
  const guidToFolderMap = new Map<string, string>(); // Map page GUID -> path of its sub-page folder

  // Identify folders associated with pages
  logger.debug('Identifying folders associated with pages...');
  for (const [guid, entity] of entityMap.entries()) {
    if (entity.type === 'page') {
      // Construct the expected folder name based on the page's filename (before cleaning)
      const pageBaseName = path.basename(entity.filePath, '.md');
      const possibleFolderPath = path.join(
        path.dirname(entity.filePath),
        pageBaseName // The folder name includes the GUID in Notion exports
      );

      try {
        const stats = await fs.promises.stat(possibleFolderPath);
        if (stats.isDirectory()) {
          // Found a directory matching the page's name (including GUID)
          guidToFolderMap.set(guid, possibleFolderPath);
          logger.debug(`Found matching folder for page: ${entity.cleanName}`);
        }
      } catch (err) {
        // Folder doesn't exist, normal for pages without subpages
      }
    }
  }

  // Determine parent for each entity based on directory containment
  logger.debug('Determining parent-child relationships...');
  for (const [childGuid, childEntity] of entityMap.entries()) {
    const childDirPath = path.dirname(childEntity.filePath);
    let bestMatchParentGuid: string | null = null;
    let maxMatchLength = -1;

    // Check if the child's directory is inside any of the identified page folders
    for (const [parentGuid, parentFolderPath] of guidToFolderMap.entries()) {
      if (childGuid === parentGuid) continue; // Skip self

      // Check if childDirPath starts with parentFolderPath + path separator
      if (childDirPath.startsWith(parentFolderPath + path.sep)) {
        // This child is inside this parent's folder
        const matchLength = parentFolderPath.length;
        // Use the most specific (longest path) matching parent folder
        if (matchLength > maxMatchLength) {
          maxMatchLength = matchLength;
          bestMatchParentGuid = parentGuid;
        }
      }
    }

    if (bestMatchParentGuid) {
      const parentEntity = entityMap.get(bestMatchParentGuid);
      childToParentGuidMap.set(childGuid, bestMatchParentGuid);
      logger.debug(`Assigned parent for ${childEntity.cleanName}`);
    }
  }

  // Safety Check - Detect and break cycles
  logger.debug('Checking for cycles in hierarchy...');
  let cyclesBroken = false;
  const visitedInCycleCheck = new Set<string>();
  const pathInCycleCheck = new Set<string>();

  function detectAndBreakCycle(guid: string): boolean {
    visitedInCycleCheck.add(guid);
    pathInCycleCheck.add(guid);

    const parentGuid = childToParentGuidMap.get(guid);
    if (parentGuid) {
      if (pathInCycleCheck.has(parentGuid)) {
        // Cycle detected! Break it.
        logger.warn(`Cycle detected in hierarchy. Breaking link.`);
        childToParentGuidMap.delete(guid); // Remove the link causing the cycle
        cyclesBroken = true;
        return true; // Indicate cycle found
      }
      if (!visitedInCycleCheck.has(parentGuid)) {
        if (detectAndBreakCycle(parentGuid)) {
          // If a cycle was found deeper, propagate the finding
          return true;
        }
      }
    }

    pathInCycleCheck.delete(guid); // Remove from current path before returning
    return false; // No cycle found in this branch
  }

  for (const guid of entityMap.keys()) {
    if (!visitedInCycleCheck.has(guid)) {
      detectAndBreakCycle(guid);
    }
  }

  if (cyclesBroken) {
    logger.warn('Some cycles were detected and fixed in the hierarchy');
  }

  // Parse entity details and find associated files
  logger.info('Parsing content and finding associated files...');
  const entities: NotionEntity[] = [];
  const fileEntities: NotionFile[] = [];

  // Helper to find files (non .md, non .csv) recursively
  async function findFilesRecursively(currentPath: string) {
    const items = await fs.promises.readdir(currentPath, {
      withFileTypes: true,
    });
    for (const item of items) {
      const itemPath = path.join(currentPath, item.name);
      if (item.isDirectory()) {
        // Skip __MACOSX directory which contains duplicates
        if (item.name === '__MACOSX') {
          logger.debug(`Skipping Mac OS artifact directory`);
          continue;
        }
        await findFilesRecursively(itemPath);
      } else {
        const ext = path.extname(item.name).toLowerCase();
        // Ignore primary content files and known artifacts
        if (
          ext !== '.md' &&
          ext !== '.csv' &&
          item.name !== 'index.html' &&
          !item.name.startsWith('.')
        ) {
          try {
            // Treat as a potential file attachment
            const fileEntity = await parseFile(itemPath);
            // Store the directory path for potential parent association later
            fileEntity.parentPath = path.dirname(itemPath);
            fileEntities.push(fileEntity);
          } catch (fileError) {
            logger.warn(`Could not parse file ${itemPath}`);
          }
        }
      }
    }
  }

  // Parse primary entities first
  for (const [guid, entityInfo] of entityMap.entries()) {
    try {
      if (entityInfo.type === 'page') {
        const page = await parseMarkdownFile(
          entityInfo.filePath,
          guid,
          entityInfo.cleanName
        );
        entities.push(page);
      } else if (entityInfo.type === 'database') {
        const database = await parseCSVFile(
          entityInfo.filePath,
          guid,
          entityInfo.cleanName
        );
        entities.push(database);
      }
    } catch (parseError) {
      logger.error(`Error parsing entity ${entityInfo.cleanName}`, parseError);
    }
  }

  // Now find and process associated files
  await findFilesRecursively(absoluteDirectoryPath);
  logger.info(`Found ${fileEntities.length} file attachments`);

  // Add file entities to the main list and associate parents
  for (const fileEntity of fileEntities) {
    let fileParentGuid: string | null = null;
    let maxMatchLength = -1;

    // Find the most specific page folder this file resides in
    for (const [pageGuid, pageFolderPath] of guidToFolderMap.entries()) {
      if (
        fileEntity.parentPath &&
        fileEntity.parentPath.startsWith(pageFolderPath + path.sep)
      ) {
        const matchLength = pageFolderPath.length;
        if (matchLength > maxMatchLength) {
          maxMatchLength = matchLength;
          fileParentGuid = pageGuid;
        }
      }
    }

    if (fileParentGuid) {
      childToParentGuidMap.set(fileEntity.id, fileParentGuid); // Use file's ID
      logger.debug(`Associated file ${fileEntity.name} with parent page`);
    }
    entities.push(fileEntity); // Add file to the list
  }

  logger.success(
    `Processing complete: ${entities.length} entities, ${childToParentGuidMap.size} relationships`
  );
  return { entities, childToParentGuidMap };
}

/**
 * Parse a Markdown file from Notion export
 * @param filePath Path to the Markdown file
 * @param guid The Notion GUID for this page
 * @param cleanName The clean page name
 * @returns NotionPage object
 */
async function parseMarkdownFile(
  filePath: string,
  guid: string,
  cleanName: string
): Promise<NotionPage> {
  const content = await fs.promises.readFile(filePath, 'utf-8');

  return {
    id: guid,
    type: 'page',
    name: cleanName,
    filePath,
    content,
    children: [],
  };
}

/**
 * Parse a CSV file from Notion export
 * @param filePath Path to the CSV file
 * @param guid The Notion GUID for this database
 * @param cleanName The clean database name
 * @returns NotionDatabase object
 */
async function parseCSVFile(
  filePath: string,
  guid: string,
  cleanName: string
): Promise<NotionDatabase> {
  logger.debug(`Parsing CSV: ${filePath}`);
  const content = await fs.promises.readFile(filePath, 'utf-8');

  // Ensure empty_lines_excluded is false or omitted to handle sparse CSVs potentially
  let records: CSVRecord[] = [];
  try {
    records = parseCSV(content, {
      columns: true, // Use headers as keys
      skip_empty_lines: true, // Skip lines that are truly empty
      trim: true, // Trim whitespace around headers and values
      relax_column_count: true, // Allow varying column counts
    }) as CSVRecord[];
    logger.debug(`Parsed ${records.length} records from ${cleanName}`);
  } catch (csvError) {
    logger.error(`Failed to parse CSV file ${filePath}`, csvError);
    // Return a minimal database structure on error
    return {
      id: guid,
      type: 'database',
      name: `PARSE ERROR: ${cleanName}`,
      filePath,
      fields: [],
      records: [],
      children: [],
    };
  }

  // Extract fields from headers
  const fields: NotionDatabaseField[] = [];
  // Use the headers from the parser results which respect the actual CSV content
  // Handle case where CSV might be empty or only have headers
  const headers =
    records.length > 0
      ? Object.keys(records[0]!) // Headers from the first record
      : parseCSV(content, {
          columns: false,
          to: 1,
          skip_empty_lines: true,
        })[0] || []; // Read only the header row if no records

  if (headers.length === 0) {
    logger.warn(`CSV file ${filePath} has no headers or content.`);
    // Return minimal structure if no headers found
    return {
      id: guid,
      type: 'database',
      name: cleanName,
      filePath,
      fields: [],
      records: [],
      children: [],
    };
  }

  logger.debug(`Headers found: ${headers.join(', ')}`);

  const fieldValuesPerField: { [key: string]: string[] } = {};
  headers.forEach((header: string) => (fieldValuesPerField[header] = []));

  // Collect all values for type inference
  records.forEach((record) => {
    headers.forEach((header: string) => {
      const value = record[header];
      if (value !== null && value !== undefined) {
        // Ensure the key exists before pushing
        if (fieldValuesPerField[header]) {
          fieldValuesPerField[header].push(String(value));
        } else {
          logger.warn(
            `Header key '${header}' unexpectedly missing in fieldValuesPerField`
          );
        }
      }
    });
  });

  for (const fieldName of headers) {
    // Handle potential duplicate or empty header names
    if (!fieldName) {
      logger.warn(`Skipping empty field header name in database ${cleanName}`);
      continue;
    }
    if (fields.some((f) => f.name === fieldName)) {
      logger.warn(
        `Skipping duplicate field name: "${fieldName}" in ${cleanName}`
      );
      continue;
    }

    // Generate stable field ID
    let fieldId = fieldName
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, '_') // Replace non-alphanumeric with underscore
      .replace(/^_+|_+$/g, '') // Trim leading/trailing underscores
      .substring(0, 50); // Limit length
    if (!fieldId) {
      // Handle cases where name becomes empty after sanitization
      fieldId = `field_${generateId(IdType.Field).substring(0, 8)}`;
    }

    // Ensure ID uniqueness within this database
    let originalId = fieldId;
    let counter = 1;
    while (fields.some((f) => f.id === fieldId)) {
      fieldId = `${originalId}_${counter++}`.substring(0, 50);
    }

    const fieldValues = fieldValuesPerField[fieldName] || [];
    const fieldType = inferFieldType(fieldValues); // Use existing inferFieldType

    const field: NotionDatabaseField = {
      id: fieldId,
      name: fieldName,
      type: fieldType,
    };

    if (fieldType === 'select' || fieldType === 'multi_select') {
      field.options = extractSelectOptions(fieldValues); // Use existing extractSelectOptions
    }

    fields.push(field);
    logger.debug(
      `Defined field: ${fieldName} (ID: ${fieldId}, Type: ${fieldType})`
    );
  }

  // Map records to NotionRecord objects
  const parsedRecords: NotionRecord[] = records.map(
    (record: CSVRecord, index: number) => {
      // Use the value from the first field as the record name, or default
      const firstFieldName = fields[0]?.name;
      let recordName = `Record ${index + 1}`; // Default name

      if (
        firstFieldName &&
        record[firstFieldName] !== undefined &&
        record[firstFieldName] !== null &&
        String(record[firstFieldName]).trim() !== ''
      ) {
        recordName = String(record[firstFieldName]).trim();
      }

      // Ensure all defined fields exist in the record values map, using Notion field names as keys
      const recordValues: Record<string, any> = {};
      for (const field of fields) {
        // Use null if the value is missing or undefined in the CSV row
        recordValues[field.name] = record[field.name] ?? null;
      }

      return {
        id: `record_${guid}_${index}`, // Generate unique record ID
        name: recordName.substring(0, 500), // Limit name length
        values: recordValues, // Map of Notion Field Name -> Value
      };
    }
  );

  return {
    id: guid,
    type: 'database',
    name: cleanName,
    filePath,
    fields, // Array of NotionDatabaseField
    records: parsedRecords, // Array of NotionRecord
    children: [], // Ensure children property exists
  };
}

/**
 * Parse a file (image, PDF, etc.) from Notion export
 * @param filePath Path to the file
 * @returns NotionFile object
 */
async function parseFile(filePath: string): Promise<NotionFile> {
  const stats = await fs.promises.stat(filePath);
  const mimeType = mime.lookup(filePath) || 'application/octet-stream';
  const fileName = path.basename(filePath);
  // Use the filename itself as the ID for file entities before mapping
  const fileId = fileName;
  // Clean the name displayed to the user
  const cleanName = cleanNotionName(fileName); // Use utility to clean name

  return {
    id: fileId, // Use filename as ID initially
    type: 'file',
    name: cleanName,
    filePath,
    mimeType,
    size: stats.size,
  };
}

/**
 * Infer field type from values
 * @param values Array of field values
 * @returns NotionFieldType
 */
function inferFieldType(values: string[]): NotionFieldType {
  // Filter out null/undefined/empty values
  const nonEmptyValues = values.filter(
    (v) => v !== null && v !== undefined && v !== ''
  );

  if (nonEmptyValues.length === 0) {
    return 'text'; // Default to text for empty fields
  }

  // Checkbox: Look for specific strings often used by Notion export
  const checkboxStrings = [
    'Yes',
    'No',
    'Checked',
    'Unchecked',
    'true',
    'false',
  ];
  if (nonEmptyValues.every((v) => checkboxStrings.includes(v))) {
    return 'checkbox';
  }

  // Check if all values are numbers (handle potential currency symbols, commas)
  if (
    nonEmptyValues.every((v) => {
      const num = Number(v.replace(/[^0-9.-]+/g, '')); // Strip non-numeric characters except dot and minus
      return !isNaN(num);
    })
  ) {
    return 'number';
  }

  // Check if values look like dates
  if (nonEmptyValues.every((v) => !isNaN(Date.parse(v)))) {
    return 'date';
  }

  // Check if values look like URLs
  const urlRegex = /^(https?|ftp):\/\/[^\s/$.?#].[^\s]*$/i;
  if (nonEmptyValues.every((v) => urlRegex.test(v))) {
    return 'url';
  }

  // Check if values look like emails
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (nonEmptyValues.every((v) => emailRegex.test(v))) {
    return 'email';
  }

  // Check if values look like phone numbers (more lenient regex)
  const phoneRegex = /^[+]?[(]?\d{1,4}[)]?[-\s./]?\d{1,4}[-\s./]?\d{1,9}$/;
  if (nonEmptyValues.every((v) => phoneRegex.test(v))) {
    return 'phone_number';
  }

  // Check if values look like multi-select (comma-separated values)
  // Be more strict: only if MOST values have commas, otherwise could be long text
  const multiSelectThreshold = 0.3; // 30% of non-empty values must have a comma
  if (
    nonEmptyValues.filter((v) => typeof v === 'string' && v.includes(','))
      .length /
      nonEmptyValues.length >
    multiSelectThreshold
  ) {
    return 'multi_select';
  }

  // Check if values look like select (limited unique values relative to total)
  const uniqueValues = new Set(nonEmptyValues);
  const selectThreshold = 0.7; // If unique values are less than 70% of total non-empty count
  const maxSelectOptions = 50; // And if total unique values are reasonable
  if (
    uniqueValues.size < nonEmptyValues.length * selectThreshold &&
    uniqueValues.size <= maxSelectOptions
  ) {
    return 'select';
  }

  // Default to text
  return 'text';
}

/**
 * Extract select options from field values
 * @param values Array of field values
 * @returns Array of select options
 */
function extractSelectOptions(
  values: string[]
): { id: string; name: string; color: string }[] {
  // Extract unique values, handling multi-select commas
  const uniqueValues = new Set<string>();

  values.forEach((value) => {
    if (typeof value === 'string') {
      if (value.includes(',')) {
        // Handle multi-select values
        value
          .split(',')
          .map((v) => v.trim())
          .forEach((v) => {
            if (v) uniqueValues.add(v.substring(0, 100)); // Limit option name length
          });
      } else {
        // Handle single select value
        if (value.trim()) uniqueValues.add(value.trim().substring(0, 100)); // Limit option name length
      }
    } else if (value !== null && value !== undefined) {
      const strVal = String(value);
      if (strVal.trim()) uniqueValues.add(strVal.trim().substring(0, 100)); // Limit option name length
    }
  });

  // Convert to option objects
  // Notion's default colors
  const colors = [
    'gray',
    'brown',
    'orange',
    'yellow',
    'green',
    'blue',
    'purple',
    'pink',
    'red',
  ];

  return Array.from(uniqueValues).map((value, index) => {
    // Generate a more robust ID
    const optionId =
      value
        .toLowerCase()
        .replace(/[^a-z0-9_]/g, '_')
        .substring(0, 50) || `option_${index}`;
    return {
      id: optionId,
      name: value,
      color: colors[index % colors.length] || 'gray', // Cycle through colors
    };
  });
}

/**
 * Parse markdown content into blocks using marked
 * @param markdown Markdown content
 * @returns Array of parsed blocks representing the hierarchical structure
 */
export function parseMarkdown(markdown: string): ParsedBlock[] {
  // Use marked extensions for better list/task handling if needed
  // const marked = new Marked(gfmHeadingId()); // Example: using an extension
  const options = {
    gfm: true, // Enable GitHub Flavored Markdown
    breaks: true, // Treat single newlines as <br> (might affect paragraph merging)
    pedantic: false,
  };
  const tokens = marked.lexer(markdown, options);
  return tokensToBlocks(tokens);
}

/**
 * Convert marked tokens to a hierarchical ParsedBlock structure
 * @param tokens Tokens from marked lexer
 * @returns Array of parsed blocks
 */
function tokensToBlocks(tokens: any[]): ParsedBlock[] {
  // Replace marked.Token with any to fix the type error
  const blocks: ParsedBlock[] = [];

  for (const token of tokens) {
    let block: ParsedBlock | null = null;

    switch (token.type) {
      case 'heading':
        block = {
          type: `heading${token.depth}`,
          text: token.text.trim(), // Trim the text to remove extra whitespace
          raw: token.raw.trim(), // Also trim the raw markdown
        };
        break;

      case 'paragraph':
        block = {
          type: 'paragraph',
          text: token.text,
          raw: token.raw, // Store raw markdown for later processing of inline formatting
        };
        break;

      case 'text':
        // Handle standalone text tokens - convert them to paragraphs
        block = {
          type: 'paragraph',
          text: token.text || '',
          raw: token.raw, // Store raw markdown for later processing
        };
        break;

      case 'list': {
        // Determine if it's a task list by checking the first item
        const isTaskList = token.items.length > 0 && token.items[0]?.task;
        const listType = isTaskList
          ? 'taskList'
          : token.ordered
            ? 'orderedList'
            : 'bulletList';

        block = {
          type: listType,
          text: '', // Container blocks don't have direct text
          children: [],
          attrs: token.ordered ? { start: token.start || 1 } : {},
        };

        token.items.forEach((item: any) => {
          // Replace marked.Tokens.ListItem with any
          // Process each list item
          const itemBlockType = item.task ? 'taskItem' : 'listItem';
          const itemBlock: ParsedBlock = {
            type: itemBlockType,
            // Use item.text for the primary content of the item
            // The 'text' property on ListItem includes text from its nested tokens
            text: item.text,
            // Raw includes checkbox markdown "[ ] " and any inline formatting
            raw: item.raw,
            attrs: item.task ? { checked: !!item.checked } : {}, // Ensure boolean
            // Recursively process nested tokens within the list item
            // item.tokens contains the content blocks *inside* the list item
            children: item.tokens ? tokensToBlocks(item.tokens) : [],
          };
          block!.children!.push(itemBlock);
        });
        break; // End of list case
      }

      case 'code':
        block = {
          type: 'codeBlock',
          text: token.text,
          attrs: { language: token.lang || 'plaintext' },
        };
        break;

      case 'blockquote':
        // Blockquotes can contain other blocks
        block = {
          type: 'blockquote',
          text: token.text, // Fallback text if no nested tokens
          raw: token.raw, // Store raw markdown
          children: token.tokens ? tokensToBlocks(token.tokens) : [],
        };
        break;

      case 'hr':
        block = {
          type: 'horizontalRule',
          text: '',
        };
        break;

      case 'table': {
        // Represent table as structured data or fallback to markdown text
        // Option 1: Structured data (preferred if Colanode supports table blocks)
        // block = {
        //     type: 'table',
        //     text: '', // No single text representation
        //     attrs: {
        //         header: token.header.map(h => h.text),
        //         rows: token.rows.map(row => row.map(cell => cell.text))
        //     }
        // };

        // Option 2: Fallback to markdown text in a code block or paragraph
        let tableText = '';
        const headers = token.header.map((h: any) => h.text);
        const rows = token.rows.map((row: any[]) =>
          row.map((cell: any) => cell.text)
        );

        tableText += `| ${headers.join(' | ')} |\n`;
        tableText += `| ${headers.map(() => '---').join(' | ')} |\n`;
        rows.forEach((row: any[]) => {
          tableText += `| ${row.join(' | ')} |\n`;
        });

        block = {
          type: 'codeBlock', // Use code block for better formatting preservation
          text: tableText.trim(),
          attrs: { language: 'markdown' }, // Indicate it's markdown
        };
        break;
      }

      case 'html':
        // Try to handle basic HTML, otherwise treat as text
        // Note: Complex HTML might not map well. Consider a sanitizer/parser if needed.
        block = {
          type: 'paragraph', // Or potentially 'html' if supported downstream
          text: token.text, // Raw HTML content
          raw: token.raw, // Store original HTML
        };
        break;

      case 'space':
        // Ignore space tokens, they usually represent empty lines between blocks
        break;

      default:
        logger.warn(`Unhandled marked token type: ${token.type}`);
        // Fallback for unknown token types that have text
        if ('text' in token && token.text) {
          block = { type: 'paragraph', text: token.text, raw: token.raw };
        }
    }

    if (block) {
      blocks.push(block);
    }
  }

  return blocks;
}

/**
 * Build page hierarchy based purely on folder structure and identify entities
 * @param directoryPath Path to the extracted Notion export directory
 * @returns Map of Notion identifiers to PageBlueprint or DatabaseBlueprint objects
 */
export async function buildPageHierarchy(
  directoryPath: string
): Promise<Map<string, PageBlueprint | DatabaseBlueprint>> {
  let absoluteDirectoryPath = path.resolve(directoryPath);
  logger.info(`Building hierarchy from: ${absoluteDirectoryPath}`);

  // Check directory structure
  try {
    const dirStats = await fs.promises.stat(absoluteDirectoryPath);
    if (!dirStats.isDirectory()) {
      logger.error(`The path is not a directory: ${absoluteDirectoryPath}`);
      throw new Error(`Not a directory: ${absoluteDirectoryPath}`);
    }

    // Check for 'zipi' directory
    try {
      const dirContents = await fs.promises.readdir(absoluteDirectoryPath, {
        withFileTypes: true,
      });
      logger.debug(`Found ${dirContents.length} items at the top level`);

      const zipiDir = dirContents.find(
        (item) => item.isDirectory() && item.name === 'zipi'
      );
      if (zipiDir) {
        logger.debug(
          `Found a 'zipi' directory, checking if it contains content`
        );
        const zipiPath = path.join(absoluteDirectoryPath, 'zipi');
        const zipiContents = await fs.promises.readdir(zipiPath);
        if (zipiContents.length > 0) {
          absoluteDirectoryPath = zipiPath;
          logger.info(
            `Using content from zipi directory: ${absoluteDirectoryPath}`
          );
        }
      }
    } catch (innerErr) {
      logger.warn(
        `Could not read top-level directory contents immediately, proceeding...`
      );
    }
  } catch (err) {
    logger.error(`Error checking directory structure`, err);
    throw err;
  }

  // Map to store all blueprints by their Notion identifier
  const blueprints = new Map<string, PageBlueprint | DatabaseBlueprint>();

  // Function to recursively scan the directory and identify Markdown/CSV files
  async function scanForEntities(
    currentPath: string,
    relativePath: string = '',
    depth: number = 0
  ) {
    let items;
    try {
      items = await fs.promises.readdir(currentPath, {
        withFileTypes: true,
      });
    } catch (readErr) {
      logger.warn(`Could not read directory ${currentPath}, skipping.`);
      return; // Skip directories that can't be read
    }

    for (const item of items) {
      const itemPath = path.join(currentPath, item.name);
      const itemRelativePath = relativePath
        ? path.join(relativePath, item.name)
        : item.name;

      // Skip known irrelevant files/folders
      if (
        item.name.toLowerCase() === 'home' ||
        item.name === 'index.html' ||
        item.name.startsWith('.') ||
        item.name === '__MACOSX'
      ) {
        logger.debug(`Skipping irrelevant item: ${itemPath}`);
        continue;
      }

      if (item.isDirectory()) {
        // Recursively scan subdirectories
        await scanForEntities(itemPath, itemRelativePath, depth + 1);
      } else if (item.name.endsWith('.md') || item.name.endsWith('.csv')) {
        // Found a Markdown or CSV file
        const isPage = item.name.endsWith('.md');
        const fileExt = isPage ? '.md' : '.csv';
        logger.debug(
          `Found ${isPage ? 'page' : 'database'} file: ${item.name}`
        );

        // Get filename without extension
        const nameWithoutExt = path.basename(item.name, fileExt);
        const guidMatch =
          nameWithoutExt.match(NOTION_GUID_REGEX) ||
          item.name.match(NOTION_GUID_REGEX);

        if (guidMatch && guidMatch[1]) {
          const guid = guidMatch[1];
          const cleanName = cleanNotionName(nameWithoutExt);

          // Determine the Notion identifier for this entity
          const notionIdentifier = itemRelativePath
            .replace(/\.(md|csv)$/, '') // Remove extension
            .replace(NOTION_GUID_REGEX, '') // Remove GUID part
            .trim();

          // Determine parent Notion identifier
          const parentPath = path.dirname(itemRelativePath);
          const parentNotionIdentifier =
            parentPath === '.' || parentPath === ''
              ? null
              : cleanNotionName(parentPath); // Use cleaned directory name

          // Pre-generate Colanode ID
          const colanodeId = generateId(isPage ? IdType.Page : IdType.Database);

          try {
            if (isPage) {
              const page = await parseMarkdownFile(itemPath, guid, cleanName);
              const pageBlueprint: PageBlueprint = {
                type: 'page_blueprint',
                notionIdentifier,
                colanodeId,
                parentNotionIdentifier,
                parentColanodeId: null,
                depth,
                mdFilePath: itemPath,
                cleanName,
                entity: page,
              };
              blueprints.set(notionIdentifier, pageBlueprint);
            } else {
              const database = await parseCSVFile(itemPath, guid, cleanName);
              const databaseBlueprint: DatabaseBlueprint = {
                type: 'database_blueprint',
                notionIdentifier,
                colanodeId,
                parentNotionIdentifier,
                parentColanodeId: null,
                depth,
                csvFilePath: itemPath,
                cleanName,
                entity: database,
              };
              blueprints.set(notionIdentifier, databaseBlueprint);
            }

            logger.debug(
              `Discovered ${isPage ? 'page' : 'database'}: ${cleanName}, depth: ${depth}`
            );
          } catch (parseError) {
            logger.error(
              `Error parsing ${isPage ? 'page' : 'database'} ${cleanName} (${itemPath})`,
              parseError
            );
            // Optionally create a placeholder or skip
          }
        } else {
          logger.warn(`Could not extract GUID from filename: ${item.name}`);
        }
      }
    }
  }

  // Start the recursive scan
  await scanForEntities(absoluteDirectoryPath);

  // If no pages or databases found after standard scan, try listing all files for debugging
  if (blueprints.size === 0) {
    logger.warn(
      'No pages or databases found in standard scan, checking all files'
    );

    // Try to find MD or CSV files directly
    async function listAllFiles(dir: string) {
      try {
        const items = await fs.promises.readdir(dir, { withFileTypes: true });
        for (const item of items) {
          const itemPath = path.join(dir, item.name);
          if (item.isDirectory()) {
            // For key directories like 'zipi', automatically scan them
            if (item.name === 'zipi') {
              logger.debug(`Trying to scan zipi directory: ${itemPath}`);
              await scanForEntities(itemPath, '', 0);
            }
            await listAllFiles(itemPath);
          } else if (item.name.endsWith('.md') || item.name.endsWith('.csv')) {
            logger.debug(`Found potential MD or CSV file: ${itemPath}`);
          }
        }
      } catch (err) {
        logger.error(`Error listing files in ${dir}`, err);
      }
    }

    await listAllFiles(absoluteDirectoryPath);
  }

  logger.success(`Found ${blueprints.size} pages/databases in hierarchy`);
  return blueprints;
}
