import {
  Block,
  FieldAttributes,
  FieldValue,
  NodeAttributes,
} from '@colanode/core';

/**
 * Notion exported entity types
 */
export type NotionEntityType = 'page' | 'database' | 'file';

/**
 * Base structure for any Notion entity
 */
export interface NotionEntity {
  id: string;
  type: NotionEntityType;
  name: string;
  filePath: string;
  parentPath?: string;
}

/**
 * Notion page entity with markdown content
 */
export interface NotionPage extends NotionEntity {
  type: 'page';
  content: string;
  children: NotionEntity[];
}

/**
 * Notion database entity with fields and records
 */
export interface NotionDatabase extends NotionEntity {
  type: 'database';
  fields: NotionDatabaseField[];
  records: NotionRecord[];
  children: NotionEntity[];
}

/**
 * Notion file entity (image, PDF, etc.)
 */
export interface NotionFile extends NotionEntity {
  type: 'file';
  mimeType: string;
  size: number;
}

/**
 * Database field from Notion
 */
export interface NotionDatabaseField {
  id: string;
  name: string;
  type: NotionFieldType;
  options?: NotionSelectOption[];
}

/**
 * Database record from Notion
 */
export interface NotionRecord {
  id: string;
  name: string;
  values: Record<string, any>;
}

/**
 * Select option for select/multi-select fields
 */
export interface NotionSelectOption {
  id: string;
  name: string;
  color: string;
}

/**
 * Supported field types in Notion
 */
export type NotionFieldType =
  | 'text'
  | 'number'
  | 'select'
  | 'multi_select'
  | 'date'
  | 'person'
  | 'files'
  | 'checkbox'
  | 'url'
  | 'email'
  | 'phone_number'
  | 'formula'
  | 'relation'
  | 'rollup'
  | 'created_time'
  | 'created_by'
  | 'last_edited_time'
  | 'last_edited_by';

/**
 * Mapping between Notion field types and Colanode field types
 */
export const fieldTypeMapping: Record<NotionFieldType, string> = {
  text: 'text',
  number: 'number',
  select: 'select',
  multi_select: 'multi_select',
  date: 'date',
  person: 'collaborator',
  files: 'text', // Will store as text links
  checkbox: 'boolean',
  url: 'url',
  email: 'email',
  phone_number: 'phone',
  formula: 'text', // Store formula result as text
  relation: 'text', // Store as text reference
  rollup: 'text', // Store rollup result as text
  created_time: 'date',
  created_by: 'text',
  last_edited_time: 'date',
  last_edited_by: 'text',
};

/**
 * Parsed Markdown block from Notion
 */
export interface ParsedBlock {
  type: string;
  text: string;
  raw?: string; // Original markdown content to preserve inline formatting
  attrs?: Record<string, any>;
  children?: ParsedBlock[];
}

/**
 * Import result object
 */
export interface ImportResult {
  importedNodes: number;
  importedDocuments: number;
  importedFiles: number;
  errors: string[];
}

/**
 * Mapped entity ready for creation in Colanode
 */
export interface MappedEntity {
  type: 'create_node' | 'update_document';
  data: {
    nodeId: string;
    attributes?: NodeAttributes;
    documentContent?: {
      type: 'rich_text';
      blocks: Record<string, Block>;
    };
    update?: string;
  };
}

export interface IdentifiedEntity {
  id: string;
  type: string;
  name: string;
  cleanName: string;
  filePath: string;
  folderPath?: string;
  size?: number;
  mimeType?: string;
}

/**
 * PageBlueprint represents a discovered page during the import process
 * Used for the multi-pass approach to ensure correct hierarchy
 */
export interface PageBlueprint {
  type: 'page_blueprint'; // Discriminator
  notionIdentifier: string; // Unique identifier for the page (e.g., "Page A/Sub Page B")
  colanodeId: string; // Pre-generated Colanode ID
  parentNotionIdentifier: string | null; // Identifier of the parent page
  parentColanodeId: string | null; // Resolved Colanode ID of the parent (filled in Pass 2)
  depth: number; // Nesting depth (0 = root, 1 = direct child, etc.)
  mdFilePath: string; // Path to the actual .md file
  cleanName: string; // Page name cleaned of Notion artifacts
  entity: NotionPage; // Original Notion entity
}

/**
 * DatabaseBlueprint represents a discovered database during the import process
 * Used for the multi-pass approach to ensure correct hierarchy
 */
export interface DatabaseBlueprint {
  type: 'database_blueprint'; // Discriminator
  notionIdentifier: string; // Unique identifier for the database
  colanodeId: string; // Pre-generated Colanode ID
  parentNotionIdentifier: string | null; // Identifier of the parent page/database
  parentColanodeId: string | null; // Resolved Colanode ID of the parent (filled in Pass 2)
  depth: number; // Nesting depth
  csvFilePath: string; // Path to the actual .csv file
  cleanName: string; // Database name cleaned of Notion artifacts
  entity: NotionDatabase; // Original Notion entity
}
