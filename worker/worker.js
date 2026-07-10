// Cloudflare Worker: accepts edit suggestions from the website and opens
// a pull request against gh-pages for the owner to approve.
//
// Secrets (set via `wrangler secret put`):
//   GITHUB_TOKEN - fine-grained PAT for the repo below
//                  (Contents: read/write, Pull requests: read/write)

const REPO = 'grumpynight/d3network';
const BASE_BRANCH = 'gh-pages';
const POINTS_PATH = 'Points.txt';
const LINKS_PATH = 'Links.txt';

const ALLOWED_ORIGINS = new Set([
    'https://grumpynight.github.io',
    'http://localhost:8932',
    'http://127.0.0.1:8932',
]);

const LINK_TYPES = { '1': 'draugai', '2': 'šeima', '3': 'romantiniai santykiai' };
const MAX_BODY_BYTES = 10_000;
const MAX_IMAGE_WIDTH = 400;
const MAX_IMAGE_HEIGHT = 640;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

export default {
    async fetch(request, env) {
        const origin = request.headers.get('Origin') || '';
        const cors = corsHeaders(origin);

        if (request.method === 'OPTIONS') {
            return new Response(null, { status: 204, headers: cors });
        }

        const url = new URL(request.url);
        if (request.method !== 'POST' || url.pathname !== '/submit') {
            return json({ error: 'Not found' }, 404, cors);
        }
        if (origin && !ALLOWED_ORIGINS.has(origin)) {
            return json({ error: 'Origin not allowed' }, 403, cors);
        }

        let body;
        try {
            const raw = await request.text();
            if (raw.length > MAX_BODY_BYTES) return json({ error: 'Payload too large' }, 413, cors);
            body = JSON.parse(raw);
        } catch {
            return json({ error: 'Invalid JSON' }, 400, cors);
        }

        try {
            const result = await handleSubmission(body, env);
            return json(result, 200, cors);
        } catch (err) {
            if (err instanceof ValidationError) {
                return json({ error: err.message }, 400, cors);
            }
            console.error(err.stack || String(err));
            return json({ error: 'Server error while creating the suggestion' }, 502, cors);
        }
    },
};

class ValidationError extends Error {}

function corsHeaders(origin) {
    const allowed = ALLOWED_ORIGINS.has(origin) ? origin : 'https://grumpynight.github.io';
    return {
        'Access-Control-Allow-Origin': allowed,
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Max-Age': '86400',
    };
}

function json(obj, status, cors) {
    return new Response(JSON.stringify(obj), {
        status,
        headers: { 'Content-Type': 'application/json', ...cors },
    });
}

// ---------------------------------------------------------------------------
// Validation helpers

function cleanName(value, field) {
    if (typeof value !== 'string') throw new ValidationError(`${field}: name is required`);
    const name = value.trim().toUpperCase().replace(/\s+/g, ' ');
    if (!name || name.length > 80 || /[\t\r\n]/.test(name)) {
        throw new ValidationError(`${field}: invalid name`);
    }
    return name;
}

function cleanImageUrl(value) {
    if (typeof value !== 'string' || value.length > 500) throw new ValidationError('Invalid image URL');
    let parsed;
    try {
        parsed = new URL(value.trim());
    } catch {
        throw new ValidationError('Invalid image URL');
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new ValidationError('Image URL must be http(s)');
    }
    return parsed.href;
}

function cleanLinkType(value) {
    const type = String(value);
    if (!(type in LINK_TYPES)) throw new ValidationError('Invalid link type');
    return type;
}

function cleanSubmitter(value) {
    if (value == null) return '';
    return String(value).replace(/[\t\r\n]/g, ' ').trim().slice(0, 60);
}

// Fetch the image and enforce the size limit (max 400x640)
async function checkImageSize(url) {
    let res;
    try {
        res = await fetch(url, { headers: { 'User-Agent': 'd3network-edit-worker' } });
    } catch {
        throw new ValidationError('Image could not be loaded');
    }
    if (!res.ok) throw new ValidationError(`Image could not be loaded (HTTP ${res.status})`);
    const length = Number(res.headers.get('Content-Length') || 0);
    if (length > MAX_IMAGE_BYTES) throw new ValidationError('Image file is too large');

    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.length > MAX_IMAGE_BYTES) throw new ValidationError('Image file is too large');

    const dims = imageDimensions(bytes);
    if (!dims) throw new ValidationError('Unsupported image format (use PNG, JPEG, GIF or WebP)');
    if (dims.width > MAX_IMAGE_WIDTH || dims.height > MAX_IMAGE_HEIGHT) {
        throw new ValidationError(
            `Image is ${dims.width}x${dims.height}; maximum allowed is ${MAX_IMAGE_WIDTH}x${MAX_IMAGE_HEIGHT}`);
    }
}

// Read dimensions from PNG / JPEG / GIF / WebP headers; null if unrecognized
function imageDimensions(b) {
    const be32 = i => (b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3];
    const be16 = i => (b[i] << 8) | b[i + 1];
    const le16 = i => b[i] | (b[i + 1] << 8);
    const le24 = i => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);
    const ascii = (i, n) => String.fromCharCode(...b.slice(i, i + n));

    // PNG: 8-byte signature, IHDR width/height at offsets 16/20
    if (b.length > 24 && b[0] === 0x89 && ascii(1, 3) === 'PNG') {
        return { width: be32(16) >>> 0, height: be32(20) >>> 0 };
    }
    // GIF: GIF87a/GIF89a, logical screen size at offsets 6/8
    if (b.length > 10 && ascii(0, 4) === 'GIF8') {
        return { width: le16(6), height: le16(8) };
    }
    // JPEG: scan segments for a start-of-frame marker
    if (b.length > 4 && b[0] === 0xFF && b[1] === 0xD8) {
        let i = 2;
        while (i + 9 < b.length) {
            if (b[i] !== 0xFF) { i++; continue; }
            const marker = b[i + 1];
            if (marker >= 0xC0 && marker <= 0xCF && marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC) {
                return { width: be16(i + 7), height: be16(i + 5) };
            }
            if (marker === 0xD8 || (marker >= 0xD0 && marker <= 0xD9) || marker === 0xFF) { i += 2; continue; }
            i += 2 + be16(i + 2);
        }
        return null;
    }
    // WebP: RIFF....WEBP, then VP8 / VP8L / VP8X chunk
    if (b.length > 30 && ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') {
        const chunk = ascii(12, 4);
        if (chunk === 'VP8 ') return { width: le16(26) & 0x3FFF, height: le16(28) & 0x3FFF };
        if (chunk === 'VP8L') {
            return {
                width: 1 + (b[21] | ((b[22] & 0x3F) << 8)),
                height: 1 + ((b[22] >> 6) | (b[23] << 2) | ((b[24] & 0x0F) << 10)),
            };
        }
        if (chunk === 'VP8X') return { width: 1 + le24(24), height: 1 + le24(27) };
    }
    return null;
}

// ---------------------------------------------------------------------------
// TSV helpers (Points.txt: NAME\tIMAGE, Links.txt: SOURCE\tTARGET\tTYPE)

function parseRows(text) {
    return text.split('\n').filter(line => line.trim()).map(line => line.split('\t'));
}

function serializeRows(rows) {
    return rows.map(cols => cols.join('\t')).join('\n') + '\n';
}

function findLinkIndex(rows, a, b) {
    return rows.findIndex(([s, t]) => (s === a && t === b) || (s === b && t === a));
}

// ---------------------------------------------------------------------------
// Submission handling

// Pure per-action field validation; throws ValidationError on malformed input
function cleanFields(action, payload) {
    if (action === 'add_character') {
        // Links are optional: new characters may form their own group that
        // connects to nobody yet ("link" is the legacy single-link shape)
        const rawLinks = payload.links || (payload.link ? [payload.link] : []);
        if (!Array.isArray(rawLinks)) throw new ValidationError('Invalid links');
        if (rawLinks.length > 5) throw new ValidationError('Too many links (max 5)');
        const links = rawLinks.map((l, i) => ({
            partner: cleanName(l && l.partner, `link ${i + 1} partner`),
            type: cleanLinkType(l && l.type),
        }));
        if (new Set(links.map(l => l.partner)).size !== links.length) {
            throw new ValidationError('Duplicate link partners');
        }
        return {
            name: cleanName(payload.name, 'name'),
            image: cleanImageUrl(payload.image),
            links,
        };
    }
    if (action === 'change_image') {
        return {
            name: cleanName(payload.name, 'name'),
            image: cleanImageUrl(payload.image),
        };
    }
    if (action === 'add_link' || action === 'remove_link' || action === 'change_link_type') {
        const source = cleanName(payload.source, 'source');
        const target = cleanName(payload.target, 'target');
        if (source === target) throw new ValidationError('Cannot link a character to themselves');
        const fields = { source, target };
        if (action !== 'remove_link') fields.type = cleanLinkType(payload.type);
        return fields;
    }
    throw new ValidationError('Unknown action');
}

async function handleSubmission(body, env) {
    const action = String(body.action || '');
    const payload = body.payload || {};
    const submitter = cleanSubmitter(body.submitter);
    const suffix = submitter ? ` (pasiūlė ${submitter})` : '';

    // Cheap field validation first — no GitHub calls for malformed input
    const fields = cleanFields(action, payload);
    if (fields.image) await checkImageSize(fields.image);

    const gh = new GitHub(env.GITHUB_TOKEN);
    const points = await gh.getFile(POINTS_PATH, BASE_BRANCH);
    const pointRows = parseRows(points.text);
    const names = new Set(pointRows.map(([name]) => name));

    const requireExisting = (name, field) => {
        if (!names.has(name)) throw new ValidationError(`${field}: character "${name}" not found`);
        return name;
    };

    let change; // { files: [{path, text, base}], title, body, slug }

    if (action === 'add_character') {
        const { name, image } = fields;
        if (names.has(name)) throw new ValidationError(`Character "${name}" already exists`);
        pointRows.push([name, image]);

        const files = [{ path: POINTS_PATH, text: serializeRows(pointRows), base: points }];
        let linkNote = 'Be ryšių.';
        if (fields.links.length > 0) {
            fields.links.forEach(l => requireExisting(l.partner, 'link partner'));
            const links = await gh.getFile(LINKS_PATH, BASE_BRANCH);
            const linkRows = parseRows(links.text);
            fields.links.forEach(l => linkRows.push([name, l.partner, l.type]));
            files.push({ path: LINKS_PATH, text: serializeRows(linkRows), base: links });
            linkNote = 'Ryšiai:\n' + fields.links
                .map(l => `- **${name}** – **${l.partner}** (${LINK_TYPES[l.type]})`)
                .join('\n');
        }

        change = {
            files,
            slug: name,
            title: `Naujas veikėjas: ${name}${suffix}`,
            body: `Siūlomas naujas veikėjas **${name}**.\n\nNuotrauka: ${image}\n\n${linkNote}`,
        };
    } else if (action === 'change_image') {
        const { name, image } = fields;
        requireExisting(name, 'name');
        const row = pointRows.find(([n]) => n === name);
        if (row[1] === image) throw new ValidationError('This is already the current image');
        const oldImage = row[1];
        row[1] = image;
        change = {
            files: [{ path: POINTS_PATH, text: serializeRows(pointRows), base: points }],
            slug: name,
            title: `Nauja nuotrauka: ${name}${suffix}`,
            body: `Siūloma nauja **${name}** nuotrauka.\n\nSena: ${oldImage}\nNauja: ${image}`,
        };
    } else {
        const { source, target, type } = fields;
        requireExisting(source, 'source');
        requireExisting(target, 'target');

        const links = await gh.getFile(LINKS_PATH, BASE_BRANCH);
        const linkRows = parseRows(links.text);
        const idx = findLinkIndex(linkRows, source, target);
        const pair = `**${source}** – **${target}**`;

        if (action === 'add_link') {
            if (idx !== -1) throw new ValidationError('These characters are already linked');
            linkRows.push([source, target, type]);
            change = {
                title: `Naujas ryšys: ${source} – ${target}${suffix}`,
                body: `Siūlomas naujas ryšys ${pair}: **${LINK_TYPES[type]}**.`,
            };
        } else if (idx === -1) {
            throw new ValidationError('These characters are not linked');
        } else if (action === 'remove_link') {
            const [, , oldType] = linkRows[idx];
            linkRows.splice(idx, 1);
            change = {
                title: `Pašalinti ryšį: ${source} – ${target}${suffix}`,
                body: `Siūloma pašalinti ryšį ${pair} (${LINK_TYPES[oldType] || oldType}).`,
            };
        } else {
            if (linkRows[idx][2] === type) throw new ValidationError('The link already has this type');
            const oldType = linkRows[idx][2];
            linkRows[idx][2] = type;
            change = {
                title: `Ryšio tipas: ${source} – ${target}${suffix}`,
                body: `Siūloma pakeisti ryšio ${pair} tipą: ${LINK_TYPES[oldType] || oldType} → **${LINK_TYPES[type]}**.`,
            };
        }
        change.files = [{ path: LINKS_PATH, text: serializeRows(linkRows), base: links }];
        change.slug = `${source}-${target}`;
    }

    // Link changes apply immediately (still auditable as commits on
    // gh-pages); new characters and image changes need owner approval.
    if (action === 'add_link' || action === 'remove_link' || action === 'change_link_type') {
        for (const file of change.files) {
            await gh.putFile(file.path, file.text, file.base.sha, BASE_BRANCH, change.title);
        }
        return { ok: true, applied: true };
    }

    const prUrl = await openPullRequest(gh, action, change);
    return { ok: true, pr: prUrl };
}

async function openPullRequest(gh, action, change) {
    const slug = change.slug.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
    const branch = `suggest/${action.replaceAll('_', '-')}-${slug}-${Date.now()}`;

    const baseSha = await gh.getBranchSha(BASE_BRANCH);
    await gh.createBranch(branch, baseSha);
    for (const file of change.files) {
        await gh.putFile(file.path, file.text, file.base.sha, branch, change.title);
    }
    return gh.createPullRequest(change.title, change.body, branch, BASE_BRANCH);
}

// ---------------------------------------------------------------------------
// Minimal GitHub REST client

class GitHub {
    constructor(token) {
        if (!token) throw new Error('GITHUB_TOKEN is not configured');
        this.token = token;
    }

    async request(method, path, body) {
        const res = await fetch(`https://api.github.com${path}`, {
            method,
            headers: {
                'Authorization': `Bearer ${this.token}`,
                'Accept': 'application/vnd.github+json',
                'User-Agent': 'd3network-edit-worker',
                ...(body ? { 'Content-Type': 'application/json' } : {}),
            },
            body: body ? JSON.stringify(body) : undefined,
        });
        if (!res.ok) {
            const text = await res.text();
            throw new Error(`GitHub ${method} ${path} -> ${res.status}: ${text.slice(0, 300)}`);
        }
        return res.json();
    }

    async getFile(path, ref) {
        const data = await this.request('GET', `/repos/${REPO}/contents/${path}?ref=${ref}`);
        const bytes = Uint8Array.from(atob(data.content.replace(/\n/g, '')), c => c.charCodeAt(0));
        return { text: new TextDecoder().decode(bytes), sha: data.sha };
    }

    async getBranchSha(branch) {
        const data = await this.request('GET', `/repos/${REPO}/git/ref/heads/${branch}`);
        return data.object.sha;
    }

    async createBranch(name, sha) {
        await this.request('POST', `/repos/${REPO}/git/refs`, { ref: `refs/heads/${name}`, sha });
    }

    async putFile(path, text, sha, branch, message) {
        const bytes = new TextEncoder().encode(text);
        let binary = '';
        bytes.forEach(b => { binary += String.fromCharCode(b); });
        await this.request('PUT', `/repos/${REPO}/contents/${path}`, {
            message,
            content: btoa(binary),
            sha,
            branch,
        });
    }

    async createPullRequest(title, body, head, base) {
        const pr = await this.request('POST', `/repos/${REPO}/pulls`, { title, body, head, base });
        return pr.html_url;
    }
}
