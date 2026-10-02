import type { HeterogeneousProviderConfig, HeterogeneousTopicPin } from './agencyConfig';
import { applyTopicModelToHeterogeneousProvider } from './agencyConfig';
import {
  getHeteroSelectorCapability,
  HETEROGENEOUS_AGENT_DEFAULT_SELECTION,
} from './heteroSelectorCapabilities';

/** The configuration layer that supplies one displayed runtime setting. */
export type HeterogeneousRuntimeConfigSource = 'task' | 'topic' | 'agent' | 'runtime';

/** One effective setting and the layer that supplied it. */
export interface HeterogeneousRuntimeConfigField {
  /** The user-facing configuration dimension. */
  key: 'runtime' | 'model' | 'effort' | 'speed';
  /** The winning configuration layer, including unresolved device defaults. */
  source: HeterogeneousRuntimeConfigSource;
  /** A runtime selection; `default` remains unresolved until the CLI starts. */
  value: string;
}

/**
 * Resolves the settings displayed for a Task or one of its Topics.
 *
 * Use when:
 * - Showing the next Task run's model override.
 * - Inspecting a particular Topic's pinned model and effort.
 *
 * Expects:
 * - The assignee's provider, and only the pin belonging to the displayed resource.
 * - Task and Topic pins use the runtime's existing auth-mode and capability rules.
 *
 * Returns:
 * - Runtime, model and supported effort/speed dimensions with per-field provenance.
 * - Unresolved CLI defaults remain explicit; device-selected values are never inferred.
 */
export const resolveHeterogeneousRuntimeConfig = (
  provider: HeterogeneousProviderConfig,
  pin?: HeterogeneousTopicPin,
  pinSource: 'task' | 'topic' = 'task',
): HeterogeneousRuntimeConfigField[] => {
  const capability = getHeteroSelectorCapability(provider.type);
  const withModel = applyTopicModelToHeterogeneousProvider(
    provider,
    pin?.model ? { model: pin.model, provider: pin.provider } : undefined,
  );
  const effective = applyTopicModelToHeterogeneousProvider(provider, pin);
  const model =
    (effective.authMode === 'api'
      ? effective.apiConfig?.model
      : (capability?.model?.resolve(effective) ?? effective.model)) ||
    HETEROGENEOUS_AGENT_DEFAULT_SELECTION;
  const fields: HeterogeneousRuntimeConfigField[] = [
    { key: 'runtime', source: 'agent', value: effective.type },
    {
      key: 'model',
      source: withModel !== provider ? pinSource : model === 'default' ? 'runtime' : 'agent',
      value: model,
    },
  ];

  if (capability?.effort) {
    const effort = capability.effort.resolve(effective);
    fields.push({
      key: 'effort',
      source: pin?.effort !== undefined ? pinSource : effort === 'default' ? 'runtime' : 'agent',
      value: effort,
    });
  }

  if (capability?.speed) {
    // Inspect the configured CLI value even if this model cannot select it in the
    // composer; hiding an existing flag would misrepresent the dispatched args.
    const speed = capability.speed.resolve(effective);
    fields.push({
      key: 'speed',
      source: speed === 'default' ? 'runtime' : 'agent',
      value: speed,
    });
  }

  return fields;
};
