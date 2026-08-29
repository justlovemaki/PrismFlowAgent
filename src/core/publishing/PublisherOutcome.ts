export type ProviderOutcome = 'not-committed' | 'unknown';
export type PublisherOperation = 'token' | 'body-upload' | 'material-upload' | 'draft-create';

/**
 * Describes whether the destination mutation is known not to have committed.
 * A publisher may explicitly downgrade an unknown external result to a retryable
 * local failure while preserving `externalOutcomeUnknown` in the durable audit.
 */
export class PublisherOutcomeError extends Error {
  readonly outcome: ProviderOutcome;
  readonly operation: PublisherOperation;
  readonly externalOutcomeUnknown: boolean;

  constructor(outcome: ProviderOutcome, operation: PublisherOperation, message = 'Publisher operation failed', options: { externalOutcomeUnknown?: boolean } = {}) {
    super(message);
    this.name = 'PublisherOutcomeError';
    this.outcome = outcome;
    this.operation = operation;
    this.externalOutcomeUnknown = options.externalOutcomeUnknown === true;
  }
}

export function isPublisherOutcomeError(value: unknown): value is PublisherOutcomeError {
  return value instanceof PublisherOutcomeError
    || !!value && typeof value === 'object'
      && ((value as { outcome?: unknown }).outcome === 'not-committed' || (value as { outcome?: unknown }).outcome === 'unknown')
      && ['token', 'body-upload', 'material-upload', 'draft-create'].includes(String((value as { operation?: unknown }).operation));
}
