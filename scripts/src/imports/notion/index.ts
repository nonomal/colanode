import fs from 'fs';
import axios from 'axios';
import { Command } from 'commander';
import { generateId, IdType, Mutation } from '@colanode/core';

import { buildPageHierarchy } from './notion-parser';
import { ImportResult, PageBlueprint, DatabaseBlueprint } from './types';
import { extractZip } from './utils';
import {
  mapPageFromBlueprint,
  mapPageContentFromBlueprint,
  mapDatabase,
  createDatabaseView,
  mapDatabaseRecords,
} from './mapper';

// Default server configuration
const DEFAULT_SERVER = 'http://localhost:3000';

// Define login success response type
interface LoginSuccessOutput {
  type: 'success';
  token: string;
  account: {
    id: string;
    name: string;
    email: string;
    avatar?: string;
  };
  workspaces: Array<{
    id: string;
    name: string;
    description?: string;
    avatar?: string;
    user: {
      id: string;
      role: string;
    };
  }>;
}

// Logger to centralize and control log output
const logger = {
  info: (message: string) => console.log(`[INFO] ${message}`),
  success: (message: string) => console.log(`[✓] ${message}`),
  step: (message: string) => console.log(`\n=== ${message} ===`),
  error: (message: string, error?: any) => {
    console.error(`[ERROR] ${message}`);
    if (error && process.env.DEBUG) {
      console.error(error);
    }
  },
  warn: (message: string) => console.warn(`[WARN] ${message}`),
  debug: (message: string) => {
    if (process.env.DEBUG) {
      console.log(`[DEBUG] ${message}`);
    }
  },
};

/**
 * Authenticate with Colanode server and retrieve an auth token
 * @param email User email
 * @param password User password
 * @param serverUrl Server URL
 * @returns Authentication token
 */
async function getAuthToken(
  email: string,
  password: string,
  serverUrl: string = DEFAULT_SERVER
): Promise<LoginSuccessOutput> {
  const url = `${serverUrl}/client/v1/accounts/emails/login`;

  try {
    const { data } = await axios.post<LoginSuccessOutput>(url, {
      email,
      password,
      platform: 'node',
      version: '0.0.4',
    });

    if (data.type !== 'success') {
      throw new Error('Login failed');
    }

    return data;
  } catch (error) {
    if (axios.isAxiosError(error) && error.response) {
      logger.error('Login error:', error.response.data);
    } else {
      logger.error('Login error:', error);
    }
    throw new Error('Failed to authenticate with Colanode server');
  }
}

/**
 * Send mutations to Colanode server
 * @param mutations Array of mutations
 * @param workspaceId Target workspace ID
 * @param apiToken API token for authentication
 * @param serverUrl Server URL
 */
async function sendMutations(
  orderedMutations: Mutation[],
  workspaceId: string,
  apiToken: string,
  serverUrl: string = DEFAULT_SERVER
): Promise<void> {
  const url = `${serverUrl}/client/v1/workspaces/${workspaceId}/mutations`;
  const delayBetweenMutations = 200;

  const totalMutations = orderedMutations.length;
  logger.info(`Sending ${totalMutations} mutations...`);

  let processedCount = 0;
  let nodeCreatedCount = 0;
  let documentUpdatedCount = 0;
  let documentFailedCount = 0;

  for (let i = 0; i < orderedMutations.length; i++) {
    const mutation = orderedMutations[i];
    if (!mutation) continue;

    const mutationNumber = i + 1;
    const targetId =
      (mutation.data as any).nodeId || (mutation.data as any).documentId;

    logger.debug(
      `Processing mutation ${mutationNumber}/${totalMutations}: type=${mutation.type}, id=${targetId}`
    );

    let retries = 0;
    const maxRetries = 3;
    let success = false;

    while (!success && retries <= maxRetries) {
      try {
        if (retries > 0) {
          logger.warn(`Retry ${retries} for mutation (target: ${targetId})`);
          await new Promise((resolve) => setTimeout(resolve, 1000 * retries));
        }

        const response = await axios.post(
          url,
          { mutations: [mutation] },
          {
            headers: {
              Authorization: `Bearer ${apiToken}`,
              'Content-Type': 'application/json',
            },
            timeout: 10000,
          }
        );

        const result = response.data?.results?.[0];
        if (!result || result.status !== 'success') {
          const errorMsg =
            result?.error || response.data?.message || 'Unknown server error';
          logger.error(
            `Server rejected mutation (target: ${targetId}): ${errorMsg}`
          );

          if (mutation.type === 'update_document') {
            documentFailedCount++;
            break;
          }

          throw new Error(`Server rejected mutation: ${errorMsg}`);
        }

        success = true;
        processedCount++;
        if (mutation.type === 'create_node') {
          nodeCreatedCount++;
        } else if (mutation.type === 'update_document') {
          documentUpdatedCount++;
        }

        logger.debug(`Processed mutation ${mutationNumber}/${totalMutations}`);
      } catch (error) {
        retries++;
        logger.error(
          `Error processing mutation ${mutationNumber}/${totalMutations} (target: ${targetId}) - Attempt ${retries}/${maxRetries}`
        );

        if (retries >= maxRetries) {
          logger.warn(
            `Max retries reached for mutation (target: ${targetId}). Skipping.`
          );
          if (mutation.type === 'update_document' && !success) {
            documentFailedCount++;
          }
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 500 * retries));
      }
    }

    await new Promise((resolve) => setTimeout(resolve, delayBetweenMutations));
  }

  logger.success(`Mutations processed: ${processedCount}/${totalMutations}`);
  logger.debug(
    `Nodes Created: ${nodeCreatedCount}, Documents Updated: ${documentUpdatedCount}, Document Updates Failed: ${documentFailedCount}`
  );

  if (documentFailedCount > 0) {
    logger.warn(`${documentFailedCount} document updates failed`);
  }
}

// Options for importNotion function
export interface ImportNotionOptions {
  zipPath: string;
  workspaceId?: string;
  userId?: string;
  apiToken?: string;
  email?: string;
  password?: string;
  parentId?: string;
  serverUrl?: string;
}

/**
 * Import Notion data into Colanode
 * @param options Import options
 * @returns Import result
 */
export async function importNotion(
  options: ImportNotionOptions
): Promise<ImportResult> {
  const result: ImportResult = {
    importedNodes: 0,
    importedDocuments: 0,
    importedFiles: 0,
    errors: [],
  };

  let tempExtractPath: string | null = null;

  try {
    let apiToken = options.apiToken;
    let workspaceId = options.workspaceId;
    let userId = options.userId;

    if (options.email && options.password) {
      logger.info(`Authenticating as ${options.email}...`);
      const loginResponse = await getAuthToken(
        options.email,
        options.password,
        options.serverUrl
      );
      apiToken = loginResponse.token;
      logger.success('Authentication successful');

      if (!workspaceId && loginResponse.workspaces.length > 0) {
        const firstWorkspace = loginResponse.workspaces[0];
        if (firstWorkspace) {
          workspaceId = firstWorkspace.id;
          userId = firstWorkspace.user?.id;
          logger.info(
            `Using workspace: ${firstWorkspace.name || 'Unnamed'} (ID: ${workspaceId})`
          );
        }
      } else if (workspaceId) {
        const targetWorkspace = loginResponse.workspaces.find(
          (ws) => ws.id === workspaceId
        );
        if (targetWorkspace) {
          userId = targetWorkspace.user?.id;
          logger.info(`Using provided workspace ID: ${workspaceId}`);
        } else {
          logger.error(
            `Specified workspace ID ${workspaceId} not found or not accessible`
          );
          throw new Error(`Workspace ${workspaceId} not accessible.`);
        }
      }
    }

    if (!apiToken) throw new Error('API token is required');
    if (!workspaceId) throw new Error('Workspace ID is required');
    if (!userId) throw new Error('User ID is required for mapping');

    logger.info('Extracting Notion export...');
    const extractPath = await extractZip(options.zipPath);
    tempExtractPath = extractPath;

    logger.step('PHASE 1: Building page hierarchy');
    const blueprints = await buildPageHierarchy(extractPath);
    logger.success(`Discovered ${blueprints.size} pages`);

    if (blueprints.size === 0) {
      logger.warn('No pages found in Notion export. Nothing to import.');
      return result;
    }

    logger.step('PHASE 2: Resolving parent-child relationships');
    const notionIdToColanodeIdMap = new Map<string, string>();

    // Map Notion IDs to Colanode IDs
    for (const [identifier, blueprint] of blueprints.entries()) {
      notionIdToColanodeIdMap.set(blueprint.entity.id, blueprint.colanodeId);
    }

    // Resolve parent IDs
    for (const blueprint of blueprints.values()) {
      if (blueprint.parentNotionIdentifier) {
        const parentBlueprint = blueprints.get(
          blueprint.parentNotionIdentifier
        );

        if (parentBlueprint) {
          blueprint.parentColanodeId = parentBlueprint.colanodeId;
        } else if (options.parentId) {
          blueprint.parentColanodeId = options.parentId;
        } else {
          blueprint.parentColanodeId = null;
        }
      } else if (options.parentId) {
        blueprint.parentColanodeId = options.parentId;
      } else {
        blueprint.parentColanodeId = null;
      }
    }

    logger.success(
      `Resolved parent relationships for ${blueprints.size} pages`
    );

    logger.step('PHASE 3: Creating nodes level-by-level');

    // Group blueprints by depth
    const blueprintsByDepth = new Map<
      number,
      (PageBlueprint | DatabaseBlueprint)[]
    >();
    let maxDepth = 0;

    for (const blueprint of blueprints.values()) {
      if (!blueprintsByDepth.has(blueprint.depth)) {
        blueprintsByDepth.set(blueprint.depth, []);
      }
      blueprintsByDepth.get(blueprint.depth)?.push(blueprint);
      maxDepth = Math.max(maxDepth, blueprint.depth);
    }

    // Store record document updates separately to process in the final phase
    const recordDocumentMutations: Mutation[] = [];
    let totalNodesCreated = 0; // Count page/database nodes
    let totalViewsCreated = 0;
    let totalRecordsCreated = 0;

    // Process each depth level sequentially
    for (let currentDepth = 0; currentDepth <= maxDepth; currentDepth++) {
      const blueprintsAtDepth = blueprintsByDepth.get(currentDepth) || [];
      if (blueprintsAtDepth.length === 0) continue;

      logger.info(
        `Processing level ${currentDepth} with ${blueprintsAtDepth.length} entities...`
      );

      // Mutations for nodes/views/records created at this level
      const levelMutations: Mutation[] = [];
      // Temporary store for record document updates from this level
      const currentLevelRecordDocMutations: Mutation[] = [];
      let viewsCreatedThisLevel = 0;
      let recordsCreatedThisLevel = 0;
      let pagesOrDbCreatedThisLevel = 0;

      for (const blueprint of blueprintsAtDepth) {
        try {
          // --- Handle Page Blueprints ---
          if (blueprint.type === 'page_blueprint') {
            const mappedNodeEntity = await mapPageFromBlueprint(blueprint);
            if (
              mappedNodeEntity &&
              mappedNodeEntity.type === 'create_node' &&
              mappedNodeEntity.data.nodeId &&
              mappedNodeEntity.data.update
            ) {
              levelMutations.push({
                id: generateId(IdType.Mutation),
                type: 'create_node',
                data: {
                  nodeId: mappedNodeEntity.data.nodeId,
                  updateId: generateId(IdType.Update),
                  createdAt: new Date().toISOString(),
                  data: mappedNodeEntity.data.update,
                },
                createdAt: new Date().toISOString(),
              });
              pagesOrDbCreatedThisLevel++;
            } else {
              logger.warn(
                `Invalid mapped node entity for page ${blueprint.cleanName}. Skipping node creation.`
              );
            }
          }
          // --- Handle Database Blueprints ---
          else if (blueprint.type === 'database_blueprint') {
            const dbId = blueprint.colanodeId;
            const dbParentId = blueprint.parentColanodeId;

            // 1. Map Database Node
            const mappedDbNodeEntity = await mapDatabase(
              blueprint.entity,
              dbId,
              dbParentId || undefined
            );
            if (
              mappedDbNodeEntity &&
              mappedDbNodeEntity.type === 'create_node' &&
              mappedDbNodeEntity.data.nodeId &&
              mappedDbNodeEntity.data.update
            ) {
              levelMutations.push({
                id: generateId(IdType.Mutation),
                type: 'create_node',
                data: {
                  nodeId: mappedDbNodeEntity.data.nodeId,
                  updateId: generateId(IdType.Update),
                  createdAt: new Date().toISOString(),
                  data: mappedDbNodeEntity.data.update,
                },
                createdAt: new Date().toISOString(),
              });
              pagesOrDbCreatedThisLevel++;
            } else {
              logger.warn(
                `Invalid mapped node entity for database ${blueprint.cleanName}. Skipping node creation.`
              );
            }

            // 2. Map Default Database View
            const mappedViewEntity = createDatabaseView(dbId);
            if (
              mappedViewEntity &&
              mappedViewEntity.type === 'create_node' &&
              mappedViewEntity.data.nodeId &&
              mappedViewEntity.data.update
            ) {
              levelMutations.push({
                id: generateId(IdType.Mutation),
                type: 'create_node',
                data: {
                  nodeId: mappedViewEntity.data.nodeId,
                  updateId: generateId(IdType.Update),
                  createdAt: new Date().toISOString(),
                  data: mappedViewEntity.data.update,
                },
                createdAt: new Date().toISOString(),
              });
              viewsCreatedThisLevel++;
            } else {
              logger.warn(
                `Invalid mapped view entity for database ${blueprint.cleanName}. Skipping view creation.`
              );
            }

            // 3. Map Database Records
            const recordMappedEntities = await mapDatabaseRecords(
              blueprint.entity,
              dbId,
              userId, // Pass userId
              notionIdToColanodeIdMap // Pass map
            );

            // Separate record mutations
            recordMappedEntities.forEach((entity) => {
              if (
                entity.type === 'create_node' &&
                entity.data.update &&
                entity.data.nodeId
              ) {
                levelMutations.push({
                  id: generateId(IdType.Mutation),
                  type: 'create_node',
                  data: {
                    nodeId: entity.data.nodeId,
                    updateId: generateId(IdType.Update),
                    createdAt: new Date().toISOString(),
                    data: entity.data.update, // The CRDT update payload
                  },
                  createdAt: new Date().toISOString(),
                });
                recordsCreatedThisLevel++;
              } else if (
                entity.type === 'update_document' &&
                entity.data.update &&
                entity.data.nodeId
              ) {
                currentLevelRecordDocMutations.push({
                  id: generateId(IdType.Mutation),
                  type: 'update_document',
                  data: {
                    documentId: entity.data.nodeId, // Use nodeId as documentId
                    updateId: generateId(IdType.Update),
                    createdAt: new Date().toISOString(),
                    data: entity.data.update, // The CRDT update payload
                  },
                  createdAt: new Date().toISOString(),
                });
              } else {
                logger.warn(
                  `Invalid mapped entity from mapDatabaseRecords for ${blueprint.cleanName}: Type=${entity.type}, NodeId=${entity.data.nodeId}`
                );
              }
            });
          }
        } catch (err) {
          logger.error(
            `Error processing blueprint for ${blueprint.cleanName} at level ${currentDepth}`,
            err
          );
          result.errors.push(
            `Error processing ${blueprint.cleanName}: ${err instanceof Error ? err.message : String(err)}`
          );
        }
      }

      // Send mutations for this level if any were generated
      if (levelMutations.length > 0) {
        logger.info(
          `Sending ${levelMutations.length} node/view/record mutations for level ${currentDepth}...`
        );
        try {
          await sendMutations(
            levelMutations,
            workspaceId,
            apiToken,
            options.serverUrl
          );
          // Update totals based on counts for this level
          totalNodesCreated += pagesOrDbCreatedThisLevel;
          totalViewsCreated += viewsCreatedThisLevel;
          totalRecordsCreated += recordsCreatedThisLevel;
          // Add record document mutations to the final list
          recordDocumentMutations.push(...currentLevelRecordDocMutations);

          logger.success(
            `Sent ${levelMutations.length} mutations for level ${currentDepth} (Nodes: ${pagesOrDbCreatedThisLevel}, Views: ${viewsCreatedThisLevel}, Records: ${recordsCreatedThisLevel})`
          );
        } catch (levelError) {
          logger.error(
            `Error sending mutations for level ${currentDepth}`,
            levelError
          );
          result.errors.push(
            `Failed to create nodes/views/records at level ${currentDepth}: ${levelError instanceof Error ? levelError.message : String(levelError)}`
          );
          // Consider stopping or continuing based on severity
        }
      } else {
        logger.warn(
          `No valid mutations generated for level ${currentDepth}. Skipping send.`
        );
      }
    }

    logger.success(
      `Created ${totalNodesCreated} page/database nodes, ${totalViewsCreated} views, and ${totalRecordsCreated} records.`
    );

    logger.step('PHASE 4: Updating document content for pages and records');
    const allDocumentMutations: Mutation[] = [];

    // Generate page document updates (Iterate through all blueprints again)
    for (const blueprint of blueprints.values()) {
      // --- Map Page Document Content ---
      if (blueprint.type === 'page_blueprint') {
        try {
          const documentEntity = await mapPageContentFromBlueprint(
            blueprint, // Type is known here
            notionIdToColanodeIdMap,
            blueprints // Pass the full blueprints map
          );

          if (
            documentEntity &&
            documentEntity.type === 'update_document' &&
            documentEntity.data.nodeId &&
            documentEntity.data.update
          ) {
            allDocumentMutations.push({
              id: generateId(IdType.Mutation),
              type: 'update_document',
              data: {
                documentId: documentEntity.data.nodeId,
                updateId: generateId(IdType.Update),
                createdAt: new Date().toISOString(),
                data: documentEntity.data.update,
              },
              createdAt: new Date().toISOString(),
            });
          }
        } catch (docError) {
          logger.error(
            `Error mapping document content for page ${blueprint.cleanName}`,
            docError
          );
          result.errors.push(
            `Failed map document for ${blueprint.cleanName}: ${docError instanceof Error ? docError.message : String(docError)}`
          );
        }
      }
      // Database records' document mutations were collected during level processing
    }

    // Add the previously collected record document mutations
    allDocumentMutations.push(...recordDocumentMutations);

    logger.info(
      `Generated ${allDocumentMutations.length} total document updates (pages + records)`
    );

    // Send all document updates (pages + records) together
    if (allDocumentMutations.length > 0) {
      logger.info(`Sending document updates...`);
      try {
        await sendMutations(
          allDocumentMutations,
          workspaceId,
          apiToken,
          options.serverUrl
        );
        // Count successful document updates (sendMutations logs details)
        // Use the length as an approximation, sendMutations logs failures
        result.importedDocuments = allDocumentMutations.length;
        logger.success(`Sent ${allDocumentMutations.length} document updates`);
      } catch (docUpdateError) {
        logger.error(`Error sending document updates`, docUpdateError);
        result.errors.push(
          `Failed to send document updates: ${docUpdateError instanceof Error ? docUpdateError.message : String(docUpdateError)}`
        );
      }
    }

    // Update final result counts
    // Total nodes includes pages, databases, views, and records
    result.importedNodes =
      totalNodesCreated + totalViewsCreated + totalRecordsCreated;
    // importedDocuments is set after the sendMutations call above

    logger.success('Import process completed');
  } catch (error) {
    logger.error('Error during import:', error);
    result.errors.push(error instanceof Error ? error.message : String(error));
  } finally {
    if (tempExtractPath) {
      try {
        logger.debug(`Cleaning up temporary directory: ${tempExtractPath}`);
        await fs.promises.rm(tempExtractPath, { recursive: true, force: true });
      } catch (error) {
        logger.warn('Could not clean up temporary files');
      }
    }
  }

  return result;
}

// CLI implementation
function main() {
  try {
    logger.debug('Starting CLI with arguments: ' + process.argv.join(' '));

    const program = new Command();

    // WORKAROUND: Override Commander's internal missing options check
    program._checkForMissingMandatoryOptions = () => {};

    program
      .name('notion-import')
      .description('Import Notion export into Colanode')
      .version('1.0.0');

    program
      .option('-z, --zip <path>', 'Path to Notion export ZIP file')
      .option(
        '-w, --workspace <id>',
        'Target Colanode workspace ID (required if not authenticating with email)'
      )
      .option(
        '-u, --user <id>',
        'Colanode user ID (required if not authenticating with email)'
      )
      .option(
        '-t, --token <token>',
        'API token for authentication (alternative to email/password)'
      )
      .option('-e, --email <email>', 'Colanode account email')
      .option('-p, --password <password>', 'Colanode account password')
      .option('-r, --parent <id>', 'Parent node ID (optional)')
      .option('-s, --server <url>', 'Colanode server URL', DEFAULT_SERVER)
      .option('-d, --debug', 'Enable verbose debug logging');

    // Parse arguments
    program.parse(process.argv);

    // Get parsed options
    const options = program.opts();

    // Set debug mode if specified
    if (options.debug) {
      process.env.DEBUG = 'true';
    }

    // Manually check for the mandatory ZIP option
    if (!options.zip) {
      logger.error('ZIP file path is required (-z, --zip)');
      process.exit(1);
    }

    // Validate zip file exists
    if (!fs.existsSync(options.zip)) {
      logger.error(`ZIP file not found at path: ${options.zip}`);
      process.exit(1);
    }

    if (!options.token && (!options.email || !options.password)) {
      logger.error(
        'You must provide either an API token or email/password credentials'
      );
      process.exit(1);
    }

    logger.info('Starting Notion import...');

    // Run the import
    return importNotion({
      zipPath: options.zip,
      workspaceId: options.workspace,
      userId: options.user,
      apiToken: options.token,
      email: options.email,
      password: options.password,
      parentId: options.parent,
      serverUrl: options.server,
    })
      .then((result) => {
        logger.step('IMPORT SUMMARY');
        logger.info(`Imported nodes: ${result.importedNodes}`);
        logger.info(`Imported documents: ${result.importedDocuments}`);
        logger.info(`Imported files: ${result.importedFiles}`);

        if (result.errors.length > 0) {
          logger.error('Errors encountered:');
          result.errors.forEach((err, i) => logger.error(`${i + 1}. ${err}`));
          process.exit(1);
        }
      })
      .catch((error) => {
        logger.error('Fatal error:', error);
        process.exit(1);
      });
  } catch (error) {
    logger.error('CLI initialization error:', error);
    process.exit(1);
  }
}

// Run the CLI if this file is executed directly
if (require.main === module) {
  main();
}
