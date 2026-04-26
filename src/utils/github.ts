export const GITHUB_REST_API_VERSION = process.env.GITHUB_REST_API_VERSION || '2026-03-10';

export const GITHUB_REST_API_HEADERS = {
  'X-GitHub-Api-Version': GITHUB_REST_API_VERSION
};
