import { html, raw } from 'hono/html';
import type { HtmlEscapedString } from 'hono/utils/html';
import type { AuthorizeRequest } from '@server/oauth/authorize_request';

// Server-rendered consent pages: no JavaScript and no external asset, so the global CSP
// (default-src 'self', inline styles allowed) fits as is. Dark only, like the app. Tokens are
// copied from src/web/index.css. Everything interpolated is escaped by hono/html.

const CSS = raw(`:root{color-scheme:dark;
--background:oklch(0.17 0.012 60);--foreground:oklch(0.96 0.01 85);--card:oklch(0.21 0.014 60);
--primary:oklch(0.83 0.16 85);--primary-foreground:oklch(0.2 0.02 60);
--muted:oklch(0.26 0.014 60);--muted-foreground:oklch(0.72 0.02 80);
--destructive:oklch(0.58 0.21 25);--error-text:oklch(0.78 0.13 25);
--border:oklch(1 0 0 / 12%);--input:oklch(1 0 0 / 16%);--radius:.75rem}
*{box-sizing:border-box}
body{margin:0;min-height:100dvh;padding:1rem;background:var(--background);color:var(--foreground);
font:16px/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased}
main{max-width:28rem;margin:0 auto}
@media(min-width:640px){main{margin-top:10vh}}
.card{background:var(--card);border:1px solid var(--border);border-radius:calc(var(--radius) + 4px);padding:1.25rem}
.brand{color:var(--primary);font-weight:600}
h1{font-size:1.375rem;line-height:1.25;margin:.25rem 0 1rem}
.btn{display:flex;align-items:center;justify-content:center;width:100%;height:2.75rem;padding:0 1rem;
border-radius:var(--radius);font:inherit;font-size:.875rem;font-weight:500;cursor:pointer;
border:1px solid var(--input);background:transparent;color:var(--foreground);touch-action:manipulation}
.btn-primary{background:var(--primary);color:var(--primary-foreground);border-color:transparent}
.btn:hover{filter:brightness(1.08)}
.field{width:100%;height:2.75rem;padding:0 .75rem;border-radius:var(--radius);border:1px solid var(--input);
background:transparent;color:var(--foreground);font:inherit;font-size:1rem}
.field[aria-invalid=true]{border-color:var(--destructive)}
:focus-visible{outline:2px solid var(--primary);outline-offset:2px}
.muted{color:var(--muted-foreground);font-size:.875rem}
.error{color:var(--error-text);border-left:3px solid var(--destructive);padding-left:.75rem;margin:.5rem 0}
.host{font-size:1.125rem;font-weight:600;overflow-wrap:anywhere}
.name{overflow-wrap:anywhere}
.member{display:flex;align-items:center;gap:.75rem;min-height:3.25rem;padding:.5rem .75rem;margin:.5rem 0;
border:1px solid var(--input);border-radius:var(--radius);cursor:pointer;overflow-wrap:anywhere}
.member input{width:1.375rem;height:1.375rem;flex:none;accent-color:var(--primary)}
.member:has(input:checked){border-color:var(--primary);background:var(--muted)}
.member:has(:focus-visible){outline:2px solid var(--primary);outline-offset:2px}
.vh{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
.stack>*+*{margin-top:.75rem}
/* Below the card: the Refuser form and the reassurance line. */
.after{margin-top:.75rem}
.center{text-align:center}
fieldset{border:0;margin:0;padding:0}
legend{padding:0;font-weight:500}
dl,ul{margin:0 0 1rem}
dt{font-size:.75rem;text-transform:uppercase;letter-spacing:.04em;color:var(--muted-foreground)}
dd{margin:0}
ul{padding-left:1.25rem}
@media(prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important}}`);

type Html = HtmlEscapedString | Promise<HtmlEscapedString>;

function shell(title: string, body: Html) {
  return html`<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<meta name="robots" content="noindex">
<link rel="icon" href="data:,">
<title>${title}</title>
<style>${CSS}</style>
</head>
<body>
<main>
${body}
</main>
</body>
</html>`;
}

// Re-emitted from the validated server-side copy, never from the raw POST body.
function hiddenFields(r: AuthorizeRequest) {
  return html`<input type="hidden" name="response_type" value="code">
<input type="hidden" name="client_id" value="${r.clientId}">
<input type="hidden" name="redirect_uri" value="${r.redirectUri}">
<input type="hidden" name="code_challenge" value="${r.codeChallenge}">
<input type="hidden" name="code_challenge_method" value="S256">
<input type="hidden" name="resource" value="${r.resource}">
${r.state === null ? '' : html`<input type="hidden" name="state" value="${r.state}">`}`;
}

const denyForm = (r: AuthorizeRequest, label: string) => html`<form method="post" action="/oauth/authorize" class="stack">
${hiddenFields(r)}
<button class="btn" type="submit" name="action" value="deny">${label}</button>
</form>`;

const backLabel = (r: AuthorizeRequest) => (r.redirectHost ? `Retourner à ${r.redirectHost}` : "Retourner à l'app");

function returnBlock(r: AuthorizeRequest, withName: boolean) {
  return html`<dl>
<dt>Retour vers</dt>
<dd class="host">${r.redirectHost ?? 'Une app sur cet ordinateur'}</dd>
${
  withName && r.clientName
    ? html`<dd class="muted name">Nom donné par l'app : « ${r.clientName} »</dd>`
    : ''
}
</dl>`;
}

export type SecretError = 'wrong' | 'expired';

export function secretStepPage(r: AuthorizeRequest, error?: SecretError) {
  const message =
    error === 'expired'
      ? 'Cette étape a expiré. Saisis à nouveau le code.'
      : 'Code incorrect. Vérifie que tu l’as copié en entier.';
  return shell(
    error === 'expired' ? 'Étape expirée - Popcorn' : error ? 'Code incorrect - Popcorn' : 'Connexion - Popcorn',
    html`<div class="card">
<div class="brand">Popcorn</div>
<h1>Connecter une app à Popcorn</h1>
${returnBlock(r, true)}
<p>Cette app pourra :</p>
<ul>
<li>voir ta liste</li>
<li>ajouter des titres et changer leur statut</li>
<li>retirer des titres</li>
</ul>
<p class="muted">Elle ne voit jamais les titres surprise.</p>
<form method="post" action="/oauth/authorize" class="stack">
${hiddenFields(r)}
<label for="connect-code">Code de connexion</label>
${error ? html`<p id="connect-error" class="error"><span class="vh">Erreur : </span>${message}</p>` : ''}
<input class="field" id="connect-code" name="connect_code" type="password" required autocomplete="current-password" autocapitalize="none" autocorrect="off" spellcheck="false" enterkeyhint="go" ${error ? raw('autofocus aria-invalid="true" aria-describedby="connect-error connect-hint"') : raw('aria-describedby="connect-hint"')}>
<p id="connect-hint" class="muted">C’est le code de connexion défini pour Popcorn. Colle-le ici.</p>
<button class="btn btn-primary" type="submit" name="action" value="unlock">Continuer</button>
</form>
</div>
<div class="stack after">${denyForm(r, 'Refuser')}
<p class="muted center">Tu n’as pas lancé cette connexion ? Refuse.</p></div>`,
  );
}

export function memberStepPage(
  r: AuthorizeRequest,
  ticket: string,
  members: { id: number; name: string }[],
  missing = false,
) {
  return shell(
    'Choisir un membre - Popcorn',
    html`<div class="card">
<div class="brand">Popcorn</div>
<h1>Qui se connecte ?</h1>
${returnBlock(r, false)}
<p class="muted">Les titres ajoutés par cette app seront à son nom.</p>
<form method="post" action="/oauth/authorize" class="stack">
${hiddenFields(r)}
<input type="hidden" name="ticket" value="${ticket}">
<fieldset ${missing ? raw('aria-describedby="member-error"') : ''}>
<legend>Membre</legend>
${missing ? html`<p id="member-error" class="error"><span class="vh">Erreur : </span>Choisis qui se connecte.</p>` : ''}
${members.map(
  (m, i) =>
    html`<label class="member"><input type="radio" name="member_id" value="${String(m.id)}" required ${members.length === 1 ? raw('checked') : ''} ${missing && i === 0 ? raw('autofocus') : ''}> ${m.name}</label>`,
)}
</fieldset>
<p class="muted">Cette étape expire au bout de 10 minutes.</p>
<button class="btn btn-primary" type="submit" name="action" value="approve">Autoriser</button>
</form>
</div>
<div class="stack after">${denyForm(r, 'Refuser')}</div>`,
  );
}

function messagePage(title: string, body: string, r?: AuthorizeRequest) {
  return shell(
    `${title} - Popcorn`,
    html`<div class="card">
<div class="brand">Popcorn</div>
<h1>${title}</h1>
<p class="muted">${body}</p>
${r ? denyForm(r, backLabel(r)) : ''}
</div>`,
  );
}

export const ratePage = (r: AuthorizeRequest, retryAfterSeconds: number) =>
  messagePage(
    'Trop d’essais',
    `Réessaie dans ${Math.max(1, Math.ceil(retryAfterSeconds / 60))} min. Cette limite protège ton code.`,
    r,
  );
export const noMembersPage = (r: AuthorizeRequest) =>
  messagePage(
    'Personne dans la liste pour l’instant',
    'Ajoute-toi d’abord dans l’app Popcorn, puis relance la connexion depuis l’app à connecter.',
    r,
  );
export const limitPage = (r: AuthorizeRequest) =>
  messagePage('Trop d’apps connectées', 'Il y a déjà 20 connexions actives. Retire-en une, puis recommence.', r);
export const invalidPage = () =>
  messagePage(
    'Lien de connexion invalide',
    'Cette demande est incomplète ou n’est plus valable. Ferme cet onglet et relance la connexion depuis l’app.',
  );
export const failPage = () => messagePage('Une erreur est survenue', 'Réessaie dans un instant.');
