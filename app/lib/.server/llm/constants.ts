// see https://docs.anthropic.com/en/docs/about-claude/models
// Lower cap speeds up typical turns; very long artifacts may continue via api.chat segment switching.
export const MAX_TOKENS = 4096;

// limits the number of model responses that can be returned in a single request
export const MAX_RESPONSE_SEGMENTS = 15;
