import type { LiveDecisionDiagnostics } from "../live/events.js";
import { inspectGameDecisionInput } from "../game/input.js";
import type {
  AgentDecision,
  DecisionSample,
  GameAgent,
  GameDecisionInput,
  GameObservation,
  TokenUsage,
} from "../types.js";
import { ACTION_SCHEMA_VERSION, canonicalInputPayload, createProviderDecisionRequest, PROMPT_VERSION, USAGE_MAPPING_VERSION } from "../providers/prompt.js";
import type { ResolvedModelDefinition } from "../providers/model-schema.js";
import {
  ProviderRequestError,
  type LlmProvider,
  type NormalizedUsage,
  type ProviderCallRecord,
  type ProviderDecisionRequest,
} from "../providers/types.js";

export interface ProviderCallAware {
  lastProviderCalls: ProviderCallRecord[] | undefined;
}

function abortError(): Error {
  const error = new Error("agent call aborted");
  error.name = "AbortError";
  return error;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError();
}

function usageForAgent(usage: NormalizedUsage | undefined): TokenUsage | undefined {
  if (!usage || (usage.inputTokens === undefined && usage.outputTokens === undefined)) return undefined;
  return {
    ...(usage.inputTokens === undefined ? {} : { inputTokens: usage.inputTokens }),
    ...(usage.outputTokens === undefined ? {} : { outputTokens: usage.outputTokens }),
  };
}

function metadataForResult(
  model: ResolvedModelDefinition,
  request: ProviderDecisionRequest,
  result: { metadata?: Record<string, unknown>; returnedModel?: string; finishReason?: string; providerCall?: ProviderCallRecord },
): Record<string, unknown> {
  return {
    provider: model.provider,
    providerId: model.provider,
    modelId: model.id,
    requestedModel: model.model,
    ...(result.providerCall?.endpointFamily ? { endpointFamily: result.providerCall.endpointFamily } : {}),
    ...(result.returnedModel ? { returnedModel: result.returnedModel } : {}),
    ...(result.finishReason ? { finishReason: result.finishReason } : {}),
    promptVersion: PROMPT_VERSION,
    actionSchemaVersion: ACTION_SCHEMA_VERSION,
    usageMappingVersion: USAGE_MAPPING_VERSION,
    canonicalInputBytes: request.canonicalInputBytes,
    registryHash: model.registryHash,
    modelFingerprint: model.fingerprint,
    inference: {
      ...(model.reasoningEffort ? { reasoningEffort: model.reasoningEffort } : {}),
      ...(model.maxOutputTokens !== undefined ? { maxOutputTokens: model.maxOutputTokens } : {}),
      ...(model.provider === "openai-compatible" ? { requestMode: model.requestMode ?? "json" } : {}),
    },
    ...(result.metadata ?? {}),
  };
}

function metadataForError(error: unknown, model?: ResolvedModelDefinition): Record<string, unknown> | undefined {
  if (!(error instanceof ProviderRequestError)) return undefined;
  const call = error.providerCall;
  return {
    provider: call.providerId,
    providerId: call.providerId,
    modelId: call.modelId,
    requestedModel: call.model,
    endpointFamily: call.endpointFamily,
    httpAttemptCount: call.httpAttemptCount,
    retryCount: call.retryCount,
    ...(call.requestIds?.length ? { requestIds: [...call.requestIds] } : {}),
    errorCategory: error.category,
    ...(model ? {
      promptVersion: PROMPT_VERSION,
      actionSchemaVersion: ACTION_SCHEMA_VERSION,
      usageMappingVersion: USAGE_MAPPING_VERSION,
      registryHash: model.registryHash,
      modelFingerprint: model.fingerprint,
    } : {}),
    ...(error.status === undefined ? {} : { status: error.status }),
    ...(error.code ? { code: error.code } : {}),
  };
}

function copyProviderCalls(calls: readonly ProviderCallRecord[] | undefined): ProviderCallRecord[] | undefined {
  return calls?.map((call) => structuredClone(call));
}

function illegalActionError(
  action: string,
  legalActionIds: readonly string[],
  call: ProviderCallRecord,
): ProviderRequestError {
  const invalidCall: ProviderCallRecord = { ...call, errorCategory: "invalid-response" };
  return new ProviderRequestError(
    `Provider returned illegal action "${action}"; expected one of ${legalActionIds.join(", ")}`,
    invalidCall,
    "invalid-response",
  );
}

interface AgentCallOptions {
  signal?: AbortSignal;
}

abstract class ProviderBackedAgent implements ProviderCallAware {
  abstract readonly id: string;
  lastProviderCalls: ProviderCallRecord[] | undefined;
  lastMetadata: Record<string, unknown> | undefined;
  lastUsage: TokenUsage | undefined;

  protected constructor(
    protected readonly provider: LlmProvider,
    protected readonly model: ResolvedModelDefinition,
    protected readonly idOverride?: string,
  ) {}

  protected resetCallState(): void {
    this.lastProviderCalls = undefined;
    this.lastMetadata = undefined;
    this.lastUsage = undefined;
  }

  protected async providerDecision(request: ProviderDecisionRequest, options: AgentCallOptions = {}): Promise<AgentDecision> {
    throwIfAborted(options.signal);
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    options.signal?.addEventListener("abort", onAbort, { once: true });
    try {
      const result = await this.provider.decide(request, this.model, controller.signal);
      throwIfAborted(options.signal);
      this.lastProviderCalls = [structuredClone(result.providerCall)];
      this.lastUsage = usageForAgent(result.usage);
      this.lastMetadata = metadataForResult(this.model, request, result);
      return {
        action: result.action,
        ...(result.usage ? { normalizedUsage: structuredClone(result.usage) } : {}),
        ...(this.lastUsage ? { usage: this.lastUsage } : {}),
        ...(this.lastProviderCalls ? { providerCalls: copyProviderCalls(this.lastProviderCalls)! } : {}),
        metadata: structuredClone(this.lastMetadata),
      };
    } catch (error) {
      if (options.signal?.aborted && !(error instanceof ProviderRequestError)) error = abortError();
      if (error instanceof ProviderRequestError) {
        this.lastProviderCalls = [structuredClone(error.providerCall)];
        this.lastMetadata = metadataForError(error, this.model);
        this.lastUsage = error.providerCall.usage
          ? usageForAgent(error.providerCall.usage)
          : undefined;
      }
      throw error;
    } finally {
      options.signal?.removeEventListener("abort", onAbort);
    }
  }

  protected validateAndReturn(
    decision: AgentDecision,
    legalActionIds: readonly string[],
  ): AgentDecision {
    const call = decision.providerCalls?.[0];
    if (!call) return decision;
    if (!legalActionIds.includes(decision.action)) {
      const error = illegalActionError(decision.action, legalActionIds, call);
      this.lastProviderCalls = [structuredClone(error.providerCall)];
      this.lastMetadata = metadataForError(error, this.model);
      throw error;
    }
    return decision;
  }

  cancel(): void {
    // Subclasses replace this with active controller tracking when they need it.
  }

  async close(): Promise<void> {
    const close = this.provider.close;
    if (close) await close.call(this.provider);
  }
}

export class GenericLlmAgent extends ProviderBackedAgent {
  readonly id: string;

  constructor(provider: LlmProvider, model: ResolvedModelDefinition, idOverride?: string) {
    super(provider, model, idOverride);
    this.id = idOverride ?? model.id;
  }

  async decide(sample: DecisionSample, signal?: AbortSignal): Promise<AgentDecision> {
    this.resetCallState();
    const request = createProviderDecisionRequest(sample);
    const decision = await this.providerDecision(request, signal ? { signal } : {});
    return this.validateAndReturn(decision, request.legalActionIds);
  }
}

export class GenericLlmGameAgent extends ProviderBackedAgent implements GameAgent {
  readonly id: string;
  lastDiagnostics: LiveDecisionDiagnostics | undefined;
  private readonly controllers = new Set<AbortController>();

  constructor(provider: LlmProvider, model: ResolvedModelDefinition, idOverride?: string) {
    super(provider, model, idOverride);
    this.id = idOverride ?? model.id;
  }

  private inputFromObservation(observation: GameObservation): GameDecisionInput {
    const input: GameDecisionInput = {
      id: `${observation.gameId}/${observation.turnIndex}/${observation.player}`,
      state: observation.state,
      legalActions: observation.legalActions,
    };
    inspectGameDecisionInput(input);
    return input;
  }

  async decideGame(input: GameDecisionInput, signal?: AbortSignal): Promise<AgentDecision> {
    this.resetCallState();
    this.lastDiagnostics = undefined;
    inspectGameDecisionInput(input);
    const request = createProviderDecisionRequest(input);
    const decision = await this.providerDecision(request, signal ? { signal } : {});
    const legal = this.validateAndReturn(decision, request.legalActionIds);
    this.lastDiagnostics = { providerMetadata: structuredClone(this.lastMetadata ?? {}) };
    return legal;
  }

  async act(observation: GameObservation, signal?: AbortSignal): Promise<string> {
    this.resetCallState();
    this.lastDiagnostics = undefined;
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    signal?.addEventListener("abort", onAbort, { once: true });
    this.controllers.add(controller);
    try {
      const decision = await this.decideGame(this.inputFromObservation(observation), controller.signal);
      if (controller.signal.aborted || signal?.aborted) throw abortError();
      return decision.action;
    } finally {
      signal?.removeEventListener("abort", onAbort);
      this.controllers.delete(controller);
    }
  }

  cancel(): void {
    for (const controller of this.controllers) controller.abort();
  }

  async close(): Promise<void> {
    this.cancel();
    await super.close();
  }
}

/** Backwards-compatible helper for callers that need the canonical payload. */
export function canonicalProviderPayload(input: DecisionSample | GameDecisionInput): Record<string, unknown> {
  return canonicalInputPayload(input);
}
