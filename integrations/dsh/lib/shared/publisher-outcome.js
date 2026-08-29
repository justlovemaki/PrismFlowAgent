// Generated from src/core/publishing/PublisherOutcome.ts by integrations/dsh/scripts/sync-shared.mjs.
/**
 * Describes whether the destination mutation is known not to have committed.
 * A publisher may explicitly downgrade an unknown external result to a retryable
 * local failure while preserving `externalOutcomeUnknown` in the durable audit.
 */
export class PublisherOutcomeError extends Error {
    outcome;
    operation;
    externalOutcomeUnknown;
    constructor(outcome, operation, message = 'Publisher operation failed', options = {}) {
        super(message);
        this.name = 'PublisherOutcomeError';
        this.outcome = outcome;
        this.operation = operation;
        this.externalOutcomeUnknown = options.externalOutcomeUnknown === true;
    }
}
export function isPublisherOutcomeError(value) {
    return value instanceof PublisherOutcomeError
        || !!value && typeof value === 'object'
            && (value.outcome === 'not-committed' || value.outcome === 'unknown')
            && ['token', 'body-upload', 'material-upload', 'draft-create'].includes(String(value.operation));
}
