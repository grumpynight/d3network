// "Siūlyti pakeitimą" modal: lets visitors suggest edits, which the worker
// turns into pull requests for the owner to approve.
//
// After deploying the worker (see worker/README.md), put its URL here.
// (localStorage override is for local development against `wrangler dev`.)
const WORKER_URL = localStorage.getItem('d3n-worker-url')
    || 'https://d3network-edit.grumpynight.workers.dev/submit';

const MAX_IMAGE_WIDTH = 400;
const MAX_IMAGE_HEIGHT = 640;

(function () {
    const openButton = document.querySelector('.edit-open-button');
    const overlay = document.querySelector('.edit-overlay');
    const form = document.querySelector('.edit-form');
    const actionSelect = form.querySelector('[name="action"]');
    const statusBox = form.querySelector('.edit-status');
    const submitButton = form.querySelector('.edit-submit');
    const imageInput = form.querySelector('[name="image"]');
    const imagePreview = form.querySelector('.edit-image-preview');

    // Which fields each action needs (rows are marked with data-field)
    const FIELDS = {
        add_character: ['name', 'image', 'partner-optional', 'type'],
        change_image: ['character', 'image'],
        add_link: ['source', 'target', 'type'],
        remove_link: ['source', 'target'],
    };

    function showFieldsFor(action) {
        form.querySelectorAll('[data-field]').forEach(row => {
            row.style.display = FIELDS[action].includes(row.dataset.field) ? '' : 'none';
        });
        setStatus('', '');
    }

    function setStatus(kind, message) {
        statusBox.className = 'edit-status' + (kind ? ' ' + kind : '');
        statusBox.textContent = message;
    }

    // "MALIA MYLLÄRI" -> "Malia Mylläri" (also after hyphens)
    function titleCase(name) {
        return name.toLocaleLowerCase('lt')
            .replace(/(^|[\s-])(\S)/g, (m, sep, ch) => sep + ch.toLocaleUpperCase('lt'));
    }

    function populateDatalist() {
        // nodes is loaded by main.js; by the time the modal opens it is ready
        const datalist = document.getElementById('character-names');
        if (datalist.children.length === nodes.length) return;
        datalist.innerHTML = nodes
            .map(n => titleCase(n.name))
            .sort((a, b) => a.localeCompare(b, 'lt'))
            .map(name => `<option value="${name.replace(/"/g, '&quot;')}"></option>`)
            .join('');
    }

    openButton.addEventListener('click', () => {
        populateDatalist();
        overlay.classList.add('open');
        showFieldsFor(actionSelect.value);
    });

    overlay.addEventListener('mousedown', e => {
        if (e.target === overlay) overlay.classList.remove('open');
    });
    form.querySelector('.edit-close').addEventListener('click', () => {
        overlay.classList.remove('open');
    });
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape') overlay.classList.remove('open');
    });

    actionSelect.addEventListener('change', () => showFieldsFor(actionSelect.value));

    imageInput.addEventListener('input', () => {
        const url = imageInput.value.trim();
        if (/^https?:\/\/\S+$/.test(url)) {
            imagePreview.src = url;
            imagePreview.style.display = 'block';
        } else {
            imagePreview.style.display = 'none';
        }
    });
    imagePreview.addEventListener('error', () => {
        imagePreview.style.display = 'none';
    });

    function value(name) {
        const el = form.querySelector(`[name="${name}"]`);
        return el ? el.value.trim() : '';
    }

    function checkedType() {
        return form.querySelector('[name="type"]:checked').value;
    }

    function knownName(input) {
        return nodes.find(n => n.name.toLowerCase() === input.toLowerCase());
    }

    function requireCharacter(name, label) {
        if (!name) throw new Error(`Įvesk lauką: ${label}`);
        const node = knownName(name);
        if (!node) throw new Error(`Veikėjas „${name}“ nerastas`);
        return node;
    }

    // The preview <img> must have loaded and be within the size limit
    function requireValidImage() {
        if (!/^https?:\/\//.test(value('image'))) {
            throw new Error('Įvesk nuotraukos nuorodą (http…)');
        }
        if (imagePreview.style.display === 'none' || !imagePreview.complete || !imagePreview.naturalWidth) {
            throw new Error('Nepavyko įkelti nuotraukos — patikrink nuorodą');
        }
        const w = imagePreview.naturalWidth, h = imagePreview.naturalHeight;
        if (w > MAX_IMAGE_WIDTH || h > MAX_IMAGE_HEIGHT) {
            throw new Error(`Nuotrauka per didelė (${w}×${h}) — maksimalus dydis ${MAX_IMAGE_WIDTH}×${MAX_IMAGE_HEIGHT}`);
        }
        return value('image');
    }

    function existingLink(a, b) {
        return links.find(l =>
            (l.source.id === a.id && l.target.id === b.id) ||
            (l.source.id === b.id && l.target.id === a.id));
    }

    // Client-side validation mirrors the worker; build the payload.
    // The "add_link" form doubles as change-type: if the pair is already
    // linked with a different type, it becomes a change_link_type suggestion.
    function buildSubmission() {
        let action = actionSelect.value;
        const payload = {};

        if (action === 'add_character') {
            const name = value('name');
            if (!name) throw new Error('Įvesk veikėjo vardą');
            if (knownName(name)) throw new Error(`Veikėjas „${name}“ jau egzistuoja`);
            payload.name = name;
            payload.image = requireValidImage();
            const partner = value('partner');
            if (partner) {
                const partnerNode = requireCharacter(partner, 'ryšio partneris');
                payload.link = { partner: partnerNode.name, type: checkedType() };
            }
        } else if (action === 'change_image') {
            const node = requireCharacter(value('character'), 'veikėjas');
            payload.name = node.name;
            payload.image = requireValidImage();
        } else {
            const source = requireCharacter(value('source'), 'pirmas veikėjas');
            const target = requireCharacter(value('target'), 'antras veikėjas');
            if (source === target) throw new Error('Pasirink du skirtingus veikėjus');
            const link = existingLink(source, target);
            if (action === 'remove_link') {
                if (!link) throw new Error('Šie veikėjai neturi ryšio');
            } else if (link) {
                if (link.type === checkedType()) throw new Error('Šie veikėjai jau turi tokį ryšį');
                action = 'change_link_type';
            }
            payload.source = source.name;
            payload.target = target.name;
            if (action !== 'remove_link') payload.type = checkedType();
        }

        return { action, payload };
    }

    form.addEventListener('submit', async e => {
        e.preventDefault();
        let submission;
        try {
            submission = buildSubmission();
        } catch (err) {
            setStatus('error', err.message);
            return;
        }

        submitButton.disabled = true;
        setStatus('', 'Siunčiama…');
        try {
            const res = await fetch(WORKER_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(submission),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.error || `Klaida (${res.status})`);
            form.reset();
            imagePreview.style.display = 'none';
            showFieldsFor(actionSelect.value);
            setStatus('success', 'Pasiūlymas pateiktas, pokyčiai bus matomi po admin patvirtinimo.');
        } catch (err) {
            const offline = err instanceof TypeError;
            setStatus('error', offline ? 'Nepavyko pasiekti serverio — bandyk vėliau' : err.message);
        } finally {
            submitButton.disabled = false;
        }
    });
})();
