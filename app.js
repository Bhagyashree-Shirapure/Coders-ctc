// Simple in-browser data layer to make pages feel live without a backend.
const STORE_KEY = 'carecompass-data-v1';

const defaultData = {
    selectedPatient: 'alex',
    patients: [
        { id: 'alex', name: 'Alex Doe', diagnosis: 'ASD Level 2', status: 'risk', sleepHours: [7, 6.5, 5, 6, 8, 8.5, 7.5] },
        { id: 'sarah', name: 'Sarah Smith', diagnosis: 'Down Syndrome', status: 'stable', sleepHours: [8, 8, 8, 7.5, 8, 8, 7] },
        { id: 'mike', name: 'Mike Jones', diagnosis: 'ADHD / SPD', status: 'stable', sleepHours: [7, 6, 6.5, 7, 6.5, 7, 7.5] },
        { id: 'emily', name: 'Emily Clark', diagnosis: 'Global Delay', status: 'risk', sleepHours: [6, 5, 5.5, 6, 6.5, 6, 6] }
    ],
    logs: [], // {patientId, mood, antecedent, behavior, consequence, note, createdAt}
    shareLinks: {}, // patientId -> { code, url, expiresAt }
    clinicianNotes: [] // {patientId, note, createdAt}
};

function loadStore() {
    try {
        const raw = localStorage.getItem(STORE_KEY);
        if (!raw) return structuredClone(defaultData);
        const parsed = JSON.parse(raw);
        // Merge with defaults to ensure we always have patients if none saved
        if (!parsed.patients || parsed.patients.length === 0) {
            parsed.patients = structuredClone(defaultData.patients);
        }
        return { ...structuredClone(defaultData), ...parsed };
    } catch {
        return structuredClone(defaultData);
    }
}

function saveStore(store) {
    localStorage.setItem(STORE_KEY, JSON.stringify(store));
}

function setSelectedPatient(id) {
    const store = loadStore();
    store.selectedPatient = id;
    saveStore(store);
}

function getSelectedPatient() {
    return loadStore().selectedPatient || defaultData.selectedPatient;
}

function getPatients() {
    return loadStore().patients;
}

function getPatient(id) {
    return getPatients().find(p => p.id === id);
}

function addPatient(patient) {
    const store = loadStore();
    const exists = store.patients.some(p => p.id === patient.id);
    if (exists) throw new Error('Patient ID already exists');
    store.patients.push(patient);
    saveStore(store);
}

function removePatient(patientId) {
    const store = loadStore();
    store.patients = store.patients.filter(p => p.id !== patientId);
    store.logs = store.logs.filter(l => l.patientId !== patientId);
    store.clinicianNotes = store.clinicianNotes.filter(n => n.patientId !== patientId);
    delete store.shareLinks[patientId];
    if (store.selectedPatient === patientId) {
        store.selectedPatient = store.patients[0]?.id || defaultData.selectedPatient;
    }
    saveStore(store);
}

function addLog(patientId, payload) {
    const store = loadStore();
    const log = { patientId, createdAt: Date.now(), ...payload };
    store.logs.push(log);
    saveStore(store);
    return log;
}

function getLogs(patientId) {
    const { logs } = loadStore();
    return logs
        .filter(l => l.patientId === patientId)
        .sort((a, b) => b.createdAt - a.createdAt);
}

function addClinicianNote(patientId, note) {
    const store = loadStore();
    store.clinicianNotes.push({ patientId, note, createdAt: Date.now() });
    saveStore(store);
}

function getClinicianNotes(patientId) {
    return loadStore().clinicianNotes
        .filter(n => n.patientId === patientId)
        .sort((a, b) => b.createdAt - a.createdAt);
}

function upsertShareLink(patientId) {
    const code = generateCode(6);
    const url = `carecompass.app/share/${code}`;
    const expiresAt = Date.now() + 24 * 60 * 60 * 1000;
    const store = loadStore();
    store.shareLinks[patientId] = { code, url, expiresAt };
    saveStore(store);
    return store.shareLinks[patientId];
}

function getShareLink(patientId) {
    const store = loadStore();
    const link = store.shareLinks[patientId];
    if (!link) return null;
    if (link.expiresAt < Date.now()) {
        delete store.shareLinks[patientId];
        saveStore(store);
        return null;
    }
    return link;
}

function generateCode(len = 6) {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let out = '';
    for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
    return out;
}

function formatTimeAgo(ts) {
    const diff = Date.now() - ts;
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
}

function formatDateTime(ts) {
    return new Date(ts).toLocaleString([], { hour: '2-digit', minute: '2-digit', month: 'short', day: 'numeric' });
}

function minutesUntil(ts) {
    const diff = ts - Date.now();
    return Math.max(0, Math.round(diff / 60000));
}

function computeStatusFromLogs(patientId) {
    const logs = getLogs(patientId);
    const recent = logs.slice(0, 3);
    const hasAggression = recent.some(l => (l.behavior || '').toLowerCase().includes('aggression') || (l.behavior || '').toLowerCase().includes('outburst'));
    return hasAggression ? 'risk' : 'stable';
}

function aggregateWeekly(patientId) {
    // Build 7-day arrays for sleep (from caregiver logs) and incidents, oldest -> newest
    const logs = getLogs(patientId);
    const labels = [];
    const sleeps = [];
    const behaviors = [];

    for (let offset = 6; offset >= 0; offset--) {
        const d = new Date();
        d.setDate(d.getDate() - offset);
        const key = d.toDateString();
        const label = d.toLocaleDateString([], { day: 'numeric', month: 'short' }); // e.g. 12 Jan
        labels.push(label);

        const dayLogs = logs.filter(l => {
            const ld = new Date(l.createdAt);
            return ld.toDateString() === key;
        });

        // Sleep: only if caregiver provided sleepStart/sleepEnd for that day
        let sleepHours = null;
        const sleepLog = dayLogs.find(l => l.sleepStart || l.sleepEnd);
        if (sleepLog && (sleepLog.sleepStart || sleepLog.sleepEnd)) {
            const start = sleepLog.sleepStart || '22:00';
            const end = sleepLog.sleepEnd || '06:00';
            const [sh, sm] = start.split(':').map(Number);
            const [eh, em] = end.split(':').map(Number);
            let startMins = sh * 60 + sm;
            let endMins = eh * 60 + em;
            if (!isNaN(startMins) && !isNaN(endMins)) {
                if (endMins <= startMins) endMins += 24 * 60; // crossed midnight
                sleepHours = (endMins - startMins) / 60;
            }
        }
        sleeps.push(sleepHours);

        // Incidents: count any log with behavior/consequence that day
        const incidents = dayLogs.filter(l => l.behavior || l.consequence).length;
        behaviors.push(incidents);
    }

    return { sleeps, behaviors, labels };
}

// Simple water-intake aggregation: count "drank" hydration events per day
function aggregateHydrationWeekly(patientId) {
    const logs = getLogs(patientId);
    const labels = [];
    const water = [];

    for (let offset = 6; offset >= 0; offset--) {
        const d = new Date();
        d.setDate(d.getDate() - offset);
        const key = d.toDateString();
        const label = d.toLocaleDateString([], { day: 'numeric', month: 'short' });
        labels.push(label);

        const dayLogs = logs.filter(l => {
            const ld = new Date(l.createdAt);
            return ld.toDateString() === key;
        });

        const drankCount = dayLogs.filter(l => l.hydration === 'drank').length;
        water.push(drankCount);
    }

    return { water, labels };
}

// Food aggregation: count meals eaten (full or partial) per day
function aggregateFoodWeekly(patientId) {
    const logs = getLogs(patientId);
    const labels = [];
    const food = [];

    for (let offset = 6; offset >= 0; offset--) {
        const d = new Date();
        d.setDate(d.getDate() - offset);
        const key = d.toDateString();
        const label = d.toLocaleDateString([], { day: 'numeric', month: 'short' });
        labels.push(label);

        const dayLogs = logs.filter(l => {
            const ld = new Date(l.createdAt);
            return ld.toDateString() === key;
        });

        const mealCount = dayLogs.filter(l => l.food === 'full' || l.food === 'partial').length;
        food.push(mealCount);
    }

    return { food, labels };
}

// Medication aggregation: count doses given on time per day
function aggregateMedsWeekly(patientId) {
    const logs = getLogs(patientId);
    const labels = [];
    const meds = [];

    for (let offset = 6; offset >= 0; offset--) {
        const d = new Date();
        d.setDate(d.getDate() - offset);
        const key = d.toDateString();
        const label = d.toLocaleDateString([], { day: 'numeric', month: 'short' });
        labels.push(label);

        const dayLogs = logs.filter(l => {
            const ld = new Date(l.createdAt);
            return ld.toDateString() === key;
        });

        const givenCount = dayLogs.filter(l => l.meds === 'given').length;
        meds.push(givenCount);
    }

    return { meds, labels };
}

// --- API sync helpers ---
const API_BASE = '';
let apiAvailable = false;

async function checkApi() {
    try {
        const res = await fetch(`${API_BASE}/api/ping`);
        if (res.ok) {
            apiAvailable = true;
            return true;
        }
    } catch (e) {
        // offline or not available
    }
    apiAvailable = false;
    return false;
}

async function syncFromServer() {
    if (!(await checkApi())) return false;
    try {
        const patientsRes = await fetch(`${API_BASE}/api/patients`);
        if (!patientsRes.ok) return false;
        const patients = await patientsRes.json();
        const store = loadStore();
        // Only sync if server has patients; otherwise keep local defaults
        if (patients.length > 0) {
            store.patients = patients;
            store.logs = [];
            store.clinicianNotes = [];
            store.shareLinks = store.shareLinks || {};

            // fetch logs & notes for each patient
            await Promise.all(patients.map(async p => {
                try {
                    const lres = await fetch(`${API_BASE}/api/logs/${encodeURIComponent(p.id)}`);
                    if (lres.ok) {
                        const logs = await lres.json();
                        store.logs.push(...logs);
                    }
                } catch (e) {}
                try {
                    const nres = await fetch(`${API_BASE}/api/notes/${encodeURIComponent(p.id)}`);
                    if (nres.ok) {
                        const notes = await nres.json();
                        store.clinicianNotes.push(...notes);
                    }
                } catch (e) {}
                try {
                    const sres = await fetch(`${API_BASE}/api/share/${encodeURIComponent(p.id)}`);
                    if (sres.ok) {
                        const sl = await sres.json();
                        store.shareLinks[p.id] = sl;
                    }
                } catch (e) {}
            }));
        }
        saveStore(store);
        return true;
    } catch (e) {
        return false;
    }
}

// Augmented functions that sync to server in background but keep localStorage instantaneous
async function addPatient(patient) {
    const store = loadStore();
    const exists = store.patients.some(p => p.id === patient.id);
    if (exists) throw new Error('Patient ID already exists');
    store.patients.push(patient);
    saveStore(store);

    // background sync
    (async () => {
        try {
            if (await checkApi()) {
                await fetch(`${API_BASE}/api/patients`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patient)
                });
            }
        } catch (e) {}
    })();
}

async function removePatient(patientId) {
    const store = loadStore();
    store.patients = store.patients.filter(p => p.id !== patientId);
    store.logs = store.logs.filter(l => l.patientId !== patientId);
    store.clinicianNotes = store.clinicianNotes.filter(n => n.patientId !== patientId);
    delete store.shareLinks[patientId];
    if (store.selectedPatient === patientId) {
        store.selectedPatient = store.patients[0]?.id || defaultData.selectedPatient;
    }
    saveStore(store);

    // background delete
    (async () => {
        try {
            if (await checkApi()) {
                await fetch(`${API_BASE}/api/patients/${encodeURIComponent(patientId)}`, { method: 'DELETE' });
            }
        } catch (e) {}
    })();
}

function addLog(patientId, payload) {
    const store = loadStore();
    const log = { patientId, createdAt: Date.now(), ...payload };
    store.logs.push(log);
    saveStore(store);

    // background post
    (async () => {
        try {
            if (await checkApi()) {
                await fetch(`${API_BASE}/api/logs/${encodeURIComponent(patientId)}`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
                });
            }
        } catch (e) {}
    })();

    return log;
}

function getLogs(patientId) {
    const { logs } = loadStore();
    return logs
        .filter(l => l.patientId === patientId)
        .sort((a, b) => b.createdAt - a.createdAt);
}

function addClinicianNote(patientId, note) {
    const store = loadStore();
    const obj = { patientId, note, createdAt: Date.now() };
    store.clinicianNotes.push(obj);
    saveStore(store);

    (async () => {
        try {
            if (await checkApi()) {
                await fetch(`${API_BASE}/api/notes/${encodeURIComponent(patientId)}`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ note })
                });
            }
        } catch (e) {}
    })();
}

async function upsertShareLink(patientId) {
    // If server available, request server-generated link and store it. Otherwise fallback to local generator.
    if (await checkApi()) {
        try {
            const res = await fetch(`${API_BASE}/api/share/${encodeURIComponent(patientId)}`, { method: 'POST' });
            if (res.ok) {
                const link = await res.json();
                const store = loadStore();
                store.shareLinks = store.shareLinks || {};
                store.shareLinks[patientId] = link;
                saveStore(store);
                return link;
            }
        } catch (e) {}
    }
    // fallback
    const code = generateCode(6);
    const url = `carecompass.app/share/${code}`;
    const expiresAt = Date.now() + 24 * 60 * 60 * 1000;
    const store = loadStore();
    store.shareLinks[patientId] = { code, url, expiresAt };
    saveStore(store);
    return store.shareLinks[patientId];
}

function getShareLink(patientId) {
    const store = loadStore();
    const link = store.shareLinks[patientId];
    if (!link) return null;
    if (link.expiresAt < Date.now()) {
        delete store.shareLinks[patientId];
        saveStore(store);
        return null;
    }
    return link;
}

// Expose globally for inline scripts
window.CareData = {
    loadStore,
    saveStore,
    getPatients,
    getPatient,
    addPatient,
    removePatient,
    getLogs,
    addLog,
    setSelectedPatient,
    getSelectedPatient,
    upsertShareLink,
    getShareLink,
    formatTimeAgo,
    formatDateTime,
    minutesUntil,
    computeStatusFromLogs,
    aggregateWeekly,
    aggregateHydrationWeekly,
    aggregateFoodWeekly,
    aggregateMedsWeekly,
    addClinicianNote,
    getClinicianNotes,
    generateCode,
    // debugging / control
    checkApi,
    syncFromServer
};

// Attempt to sync once on load (best-effort)
(async () => { await syncFromServer(); })();

