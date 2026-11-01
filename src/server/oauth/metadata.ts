import { OAUTH_SCOPE, oauthUrls } from '@server/oauth/config';

// RFC 9728. Static document built from SITE_URL; the request is never inspected.
export const protectedResourceMetadata = () => ({
  resource: oauthUrls.mcpResource,
  authorization_servers: [oauthUrls.issuer],
  scopes_supported: [OAUTH_SCOPE],
  bearer_methods_supported: ['header'],
});

const AUTH_METHODS = ['none', 'client_secret_post', 'client_secret_basic'];

// RFC 8414.
export const authorizationServerMetadata = () => ({
  issuer: oauthUrls.issuer,
  authorization_endpoint: `${oauthUrls.issuer}/oauth/authorize`,
  token_endpoint: `${oauthUrls.issuer}/oauth/token`,
  registration_endpoint: `${oauthUrls.issuer}/oauth/register`,
  revocation_endpoint: `${oauthUrls.issuer}/oauth/revoke`,
  revocation_endpoint_auth_methods_supported: AUTH_METHODS,
  response_types_supported: ['code'],
  grant_types_supported: ['authorization_code', 'refresh_token'],
  code_challenge_methods_supported: ['S256'],
  token_endpoint_auth_methods_supported: AUTH_METHODS,
  scopes_supported: [OAUTH_SCOPE],
  authorization_response_iss_parameter_supported: true,
  client_id_metadata_document_supported: false,
});
