import { StateGraph } from '@langchain/langgraph';
import { Document } from '@langchain/core/documents';
import { CallbackHandler } from 'langfuse-langchain';
import {
  DatabaseAttributes,
  getNodeModel,
  RecordAttributes,
  RecordNode,
  NodeType,
} from '@colanode/core';

import { database } from '@/data/database';
import { configuration } from '@/lib/configuration';
import { fetchNode, fetchNodeDescendants } from '@/lib/nodes';
import {
  rewriteQuery,
  assessUserIntent,
  generateNoContextAnswer,
  rerankDocuments,
  generateFinalAnswer,
  generateDatabaseFilters,
  evaluateAndRefine as evaluateAndRefineService,
} from '@/services/llm-service';
import { nodeRetrievalService } from '@/services/node-retrieval-service';
import { documentRetrievalService } from '@/services/document-retrieval-service';
import { recordsRetrievalService } from '@/services/records-retrieval-service';
import {
  AssistantChainState,
  ResponseState,
  DatabaseFilters,
  DatabaseContextItem,
  AssistantResponse,
  AssistantInput,
} from '@/types/assistant';
import { RewrittenQuery } from '@/types/llm';
import { fetchMetadataForContextItems } from '@/lib/metadata';
import { SelectNode } from '@/data/schema';
import {
  formatChatHistory,
  formatContextDocuments,
  selectTopContext,
  formatMetadataForPrompt,
} from '@/lib/ai-utils';

async function generateRewrittenQuery(
  state: AssistantChainState
): Promise<Partial<AssistantChainState>> {
  // Format chat history for context
  const formattedChatHistory = formatChatHistory(state.chatHistory);

  const rewrittenQuery = await rewriteQuery(
    state.userInput,
    formattedChatHistory
  );
  return { rewrittenQuery };
}

async function assessIntent(state: AssistantChainState) {
  const chatHistory = formatChatHistory(state.chatHistory);
  const intent = await assessUserIntent(state.userInput, chatHistory);
  return { intent };
}

async function generateNoContextResponse(state: AssistantChainState) {
  const chatHistory = formatChatHistory(state.chatHistory);
  const finalAnswer = await generateNoContextAnswer(
    state.userInput,
    chatHistory
  );
  return { finalAnswer };
}

async function fetchContextDocuments(state: AssistantChainState) {
  const [nodeResults, documentResults] = await Promise.all([
    nodeRetrievalService.retrieve(
      state.rewrittenQuery,
      state.workspaceId,
      state.userId,
      configuration.ai.retrieval.hybridSearch.maxResults,
      state.selectedContextNodeIds
    ),
    documentRetrievalService.retrieve(
      state.rewrittenQuery,
      state.workspaceId,
      state.userId,
      configuration.ai.retrieval.hybridSearch.maxResults,
      state.selectedContextNodeIds
    ),
  ]);
  let databaseResults: Document[] = [];
  if (state.databaseFilters.shouldFilter) {
    const filteredRecords = await Promise.all(
      state.databaseFilters.filters.map(async (filter) => {
        const records = await recordsRetrievalService.retrieveByFilters(
          filter.databaseId,
          state.workspaceId,
          state.userId,
          { filters: filter.filters, sorts: [], page: 1, count: 10 }
        );
        const dbNode = await fetchNode(filter.databaseId);
        if (!dbNode || dbNode.type !== 'database') return [];
        return records.map((record) => {
          const fields = Object.entries(
            (record.attributes as RecordAttributes).fields || {}
          )
            .map(([key, value]) => `${key}: ${value}`)
            .join('\n');
          const content = `Database Record from ${dbNode.type === 'database' ? (dbNode.attributes as DatabaseAttributes).name || 'Database' : 'Database'}:\n${fields}`;
          return new Document({
            pageContent: content,
            metadata: {
              id: record.id,
              type: 'record',
              createdAt: record.created_at,
              author: record.created_by,
              databaseId: filter.databaseId,
            },
          });
        });
      })
    );
    databaseResults = filteredRecords.flat();
  }
  return {
    contextDocuments: [...nodeResults, ...documentResults, ...databaseResults],
  };
}

async function fetchChatHistory(state: AssistantChainState) {
  const messages = await database
    .selectFrom('nodes')
    .where('parent_id', '=', state.parentMessageId)
    .where('type', '=', 'message')
    .where('id', '!=', state.currentMessageId)
    .where('workspace_id', '=', state.workspaceId)
    .orderBy('created_at', 'asc')
    .selectAll()
    .execute();
  const chatHistory = messages.map((message) => {
    const isAI = message.created_by === 'colanode_ai';
    const extracted = (message &&
      message.attributes &&
      getNodeModel(message.type)?.extractNodeText(
        message.id,
        message.attributes
      )) || { attributes: '' };
    const text = extracted.attributes;
    return new Document({
      pageContent: text || '',
      metadata: {
        id: message.id,
        type: 'message',
        createdAt: message.created_at,
        author: message.created_by,
        authorName: isAI ? 'Colanode AI' : 'User',
      },
    });
  });

  return { chatHistory };
}

async function rerankContextDocuments(state: AssistantChainState) {
  const docsForRerank = state.contextDocuments.map((doc) => ({
    content: doc.pageContent,
    type: doc.metadata.type,
    sourceId: doc.metadata.id,
  }));

  const rerankedContext = await rerankDocuments(state);

  return { rerankedContext };
}

async function selectRelevantDocuments(state: AssistantChainState) {
  if (state.rerankedContext.length === 0) {
    return { topContext: [] };
  }

  const maxContext = 10;
  const topContext = selectTopContext(
    state.rerankedContext,
    maxContext,
    state.contextDocuments
  );

  const contextItemsWithType = topContext.map((doc) => ({
    id: doc.metadata.id,
    type: doc.metadata.type,
  }));

  const metadata = await fetchMetadataForContextItems(contextItemsWithType);

  topContext.forEach((doc) => {
    const id = doc.metadata.id;
    if (metadata[id]) {
      doc.metadata.formattedMetadata = formatMetadataForPrompt(metadata[id]);
    }
  });

  return { topContext };
}

async function fetchWorkspaceDetails(workspaceId: string) {
  return database
    .selectFrom('workspaces')
    .where('id', '=', workspaceId)
    .select(['name', 'id'])
    .executeTakeFirst();
}

async function generateResponse(state: AssistantChainState) {
  const workspace = await fetchWorkspaceDetails(state.workspaceId);
  const formattedChatHistory = formatChatHistory(state.chatHistory);
  const formattedContext = formatContextDocuments(state.topContext);

  const result = await generateFinalAnswer({
    currentTimestamp: new Date().toISOString(),
    workspaceName: workspace?.name || state.workspaceId,
    userName: state.userDetails.name,
    userEmail: state.userDetails.email,
    formattedChatHistory,
    formattedMessages: '',
    formattedDocuments: formattedContext,
    question: state.userInput,
  });

  return { finalAnswer: result.answer, citations: result.citations };
}

async function fetchDatabaseContext(state: AssistantChainState) {
  const databases = await database
    .selectFrom('nodes as n')
    .innerJoin('collaborations as c', 'c.node_id', 'n.root_id')
    .where('n.type', '=', 'database')
    .where('n.workspace_id', '=', state.workspaceId)
    .where('c.collaborator_id', '=', state.userId)
    .where('c.deleted_at', 'is', null)
    .selectAll()
    .execute();

  const databaseContext: DatabaseContextItem[] = await Promise.all(
    databases.map(async (db) => {
      const dbNode = db as SelectNode;
      const retrievedRecords = await recordsRetrievalService.retrieveByFilters(
        db.id,
        state.workspaceId,
        state.userId,
        { filters: [], sorts: [], page: 1, count: 5 }
      );

      const sampleRecords: RecordNode[] = retrievedRecords
        .filter((record) => record.parent_id !== null)
        .map((record) => ({
          id: record.id,
          parentId: record.parent_id!,
          rootId: record.root_id,
          workspaceId: record.workspace_id,
          type: 'record',
          attributes: record.attributes as RecordAttributes,
          createdAt: record.created_at.toISOString(),
          createdBy: record.created_by,
          updatedAt: record.updated_at?.toISOString() || null,
          updatedBy: record.updated_by,
          deletedAt: record.deleted_at?.toISOString() || null,
          deletedBy: record.deleted_by,
        }));

      const dbAttrs = dbNode.attributes as DatabaseAttributes;
      const fields = dbAttrs.fields || {};
      const formattedFields = Object.entries(fields).reduce(
        (acc, [id, field]) => ({
          ...acc,
          [id]: {
            type: (field as { type: string; name: string }).type,
            name: (field as { type: string; name: string }).name,
          },
        }),
        {}
      );

      return {
        id: db.id,
        name: dbAttrs.name || 'Untitled Database',
        fields: formattedFields,
        sampleRecords,
      };
    })
  );

  return { databaseContext };
}

async function generateDatabaseFilterAttributes(state: AssistantChainState) {
  if (state.intent === 'no_context' || !state.databaseContext.length) {
    return {
      databaseFilters: { shouldFilter: false, filters: [] } as DatabaseFilters,
    };
  }
  const databaseFilters = await generateDatabaseFilters({
    query: state.userInput,
    databases: state.databaseContext,
  });

  return { databaseFilters };
}

// NEW combined evaluation and refinement node
async function evaluateAndRefine(
  state: AssistantChainState
): Promise<Partial<AssistantChainState>> {
  console.log(
    `Iteration ${state.iteration + 1}: Evaluating context sufficiency.`
  );
  // Format the top context documents for the prompt
  const formattedSources = formatContextDocuments(state.topContext);
  // Format chat history for context
  const formattedChatHistory = formatChatHistory(state.chatHistory);

  // Guard against calling evaluateAndRefineService with empty sources
  if (!formattedSources || formattedSources.trim() === '') {
    console.warn(
      'evaluateAndRefine called with empty formatted sources. Assuming sufficient.'
    );
    return {
      iteration: state.iteration + 1,
      coverage: 'sufficient' as const,
    };
  }

  // Call the service which now uses the updated prompt and schema
  const result = await evaluateAndRefineService({
    query: state.userInput,
    sources: formattedSources,
    chatHistory: formattedChatHistory,
  });
  console.log('EvaluateAndRefine Result:', result);

  // Prepare the state update
  const newStateUpdate: Partial<AssistantChainState> = {
    iteration: state.iteration + 1, // Always increment iteration if we reached this node
  };

  // Logic based on the combined result
  if (result.decision === 'sufficient') {
    console.log('Evaluation result: Sufficient.');
    // If sufficient, stop the loop by setting coverage to sufficient
    newStateUpdate.coverage = 'sufficient' as const;
  } else {
    console.log('Evaluation result: Insufficient.');
    // If insufficient...
    newStateUpdate.coverage = 'insufficient' as const; // Explicitly set to insufficient to continue loop

    // Update query if a new one is provided
    if (result.newSemantic) {
      console.log('Refining semantic query to:', result.newSemantic);
      newStateUpdate.rewrittenQuery = {
        ...state.rewrittenQuery,
        semanticQuery: result.newSemantic,
      };
    } else {
      console.log('No new semantic query suggested.');
    }

    // If the LLM suggested specific sources to expand, update selectedContextNodeIds
    if (result.expandSourceIds && result.expandSourceIds.length > 0) {
      console.log(
        'Suggesting expansion for Source IDs:',
        result.expandSourceIds
      );

      try {
        // Get the full set of node IDs (including descendants) for the suggested expansion IDs
        const expandedNodesWithDescendants = await getFullContextNodeIds(
          result.expandSourceIds
        );
        console.log(
          `Expanded ${result.expandSourceIds.length} source IDs to ${expandedNodesWithDescendants.length} nodes (with descendants)`
        );

        // Create a set from current selectedContextNodeIds (if any) to avoid duplicates
        const fullExpandedIds = new Set<string>(
          state.selectedContextNodeIds || []
        );

        // Add all the expanded IDs (including descendants) to the set
        expandedNodesWithDescendants.forEach((id) => fullExpandedIds.add(id));

        // Update selectedContextNodeIds in the state
        newStateUpdate.selectedContextNodeIds = Array.from(fullExpandedIds);
        console.log(
          'Updated selectedContextNodeIds:',
          newStateUpdate.selectedContextNodeIds.length
        );
      } catch (error) {
        console.error('Error expanding source IDs:', error);
        // If expansion fails, fall back to just adding the original IDs
        const fallbackIds = new Set<string>(state.selectedContextNodeIds || []);
        result.expandSourceIds.forEach((id) => fallbackIds.add(id));
        newStateUpdate.selectedContextNodeIds = Array.from(fallbackIds);
        console.log('Fallback: Using original source IDs without expansion');
      }
    }

    // Check if refinement seems futile (insufficient but no new query or source IDs to expand)
    if (
      !result.newSemantic &&
      (!result.expandSourceIds || result.expandSourceIds.length === 0)
    ) {
      console.log('Refinement/expansion seems futile. Stopping iteration.');
      // LLM judged further refinement/expansion futile, stop the loop
      newStateUpdate.coverage = 'sufficient' as const;
    }
  }

  // Safety check: Ensure max iterations is respected
  if (
    newStateUpdate.iteration !== undefined &&
    newStateUpdate.iteration >= state.maxIterations &&
    newStateUpdate.coverage === 'insufficient'
  ) {
    console.log(
      `Max iterations (${state.maxIterations}) reached. Forcing coverage to sufficient.`
    );
    newStateUpdate.coverage = 'sufficient';
  }

  return newStateUpdate;
}

const assistantResponseChain = new StateGraph(ResponseState)
  .addNode('generateRewrittenQuery', generateRewrittenQuery)
  .addNode('fetchContextDocuments', fetchContextDocuments)
  .addNode('fetchChatHistory', fetchChatHistory)
  .addNode('rerankContextDocuments', rerankContextDocuments)
  .addNode('selectRelevantDocuments', selectRelevantDocuments)
  .addNode('generateResponse', generateResponse)
  .addNode('assessIntent', assessIntent)
  .addNode('generateNoContextResponse', generateNoContextResponse)
  .addNode('fetchDatabaseContext', fetchDatabaseContext)
  .addNode('generateDatabaseFilterAttributes', generateDatabaseFilterAttributes)
  .addNode('evaluateAndRefine', evaluateAndRefine)
  .addEdge('__start__', 'fetchChatHistory')
  .addEdge('fetchChatHistory', 'assessIntent')
  .addConditionalEdges('assessIntent', (state) =>
    state.intent === 'no_context'
      ? 'generateNoContextResponse'
      : 'generateRewrittenQuery'
  )
  .addEdge('generateRewrittenQuery', 'fetchContextDocuments')
  .addEdge('fetchContextDocuments', 'rerankContextDocuments')
  .addEdge('rerankContextDocuments', 'selectRelevantDocuments')
  .addConditionalEdges('selectRelevantDocuments', (state) =>
    state.mode === 'deep_search' ? 'evaluateAndRefine' : 'generateResponse'
  )
  .addConditionalEdges('evaluateAndRefine', (state) =>
    state.coverage === 'sufficient' || state.iteration >= state.maxIterations
      ? 'generateResponse'
      : 'fetchContextDocuments'
  )
  .addEdge('generateResponse', '__end__')
  .addEdge('generateNoContextResponse', '__end__')
  .compile();

const langfuseCallback = configuration.ai.langfuse.enabled
  ? new CallbackHandler({
      publicKey: configuration.ai.langfuse.publicKey,
      secretKey: configuration.ai.langfuse.secretKey,
      baseUrl: configuration.ai.langfuse.baseUrl,
    })
  : undefined;

async function getFullContextNodeIds(selectedIds: string[]): Promise<string[]> {
  const fullSet = new Set<string>();
  for (const id of selectedIds) {
    fullSet.add(id);
    try {
      const descendants = await fetchNodeDescendants(id);
      descendants.forEach((descId) => fullSet.add(descId));
    } catch (error) {
      console.error(`Error fetching descendants for node ${id}:`, error);
    }
  }

  return Array.from(fullSet);
}

export async function runAssistantResponseChain(
  input: AssistantInput
): Promise<AssistantResponse> {
  let fullContextNodeIds: string[] = [];
  if (input.selectedContextNodeIds && input.selectedContextNodeIds.length > 0) {
    fullContextNodeIds = await getFullContextNodeIds(
      input.selectedContextNodeIds
    );
  }

  // Initialize state for the chain, including new fields
  const chainInput = {
    // Fields from AssistantInput
    userInput: input.userInput,
    workspaceId: input.workspaceId,
    userId: input.userId,
    userDetails: input.userDetails,
    parentMessageId: input.parentMessageId,
    currentMessageId: input.currentMessageId,
    selectedContextNodeIds: fullContextNodeIds, // Use processed IDs
    // New state fields
    mode: input.mode ?? 'default',
    iteration: 0,
    maxIterations: input.mode === 'deep_search' ? 3 : 1,
    coverage: 'unknown' as const,
    // Default intent and databaseFilters (nodes will overwrite if needed)
    intent: 'retrieve' as const,
    databaseFilters: { shouldFilter: false, filters: [] },
    // Ensure isDeepSearch is set based on mode for potential legacy needs
    isDeepSearch: input.mode === 'deep_search',
  };

  const callbacks = langfuseCallback ? [langfuseCallback] : undefined;

  // Invoke the chain with the initial state subset
  const result = await assistantResponseChain.invoke(chainInput, {
    callbacks,
  });

  return { finalAnswer: result.finalAnswer, citations: result.citations };
}
