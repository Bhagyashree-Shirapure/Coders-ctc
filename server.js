const express = require('express');
const path = require('path');
const bodyParser = require('body-parser');
const low = require('lowdb');
const FileSync = require('lowdb/adapters/FileSync');

const app = express();
const port = process.env.PORT || 3000;

const dbFile = path.join(__dirname, 'db.json');
const adapter = new FileSync(dbFile);
const db = low(adapter);

db.defaults({ users: [], history: [], admins: [], patients: [], logs: [], clinicianNotes: [], shareLinks: {} }).write();

app.use(bodyParser.json());

// Serve frontend static files from project root
app.use(express.static(path.join(__dirname)));

app.get('/api/ping', (req, res) => res.json({ ok: true }));

// Patients
app.get('/api/patients', (req, res) => {
	const patients = db.get('patients').value();
	res.json(patients);
});

app.post('/api/patients', (req, res) => {
	const p = req.body;
	if (!p || !p.id) return res.status(400).json({ error: 'id required' });
	const exists = db.get('patients').find({ id: p.id }).value();
	if (exists) return res.status(409).json({ error: 'patient exists' });
	db.get('patients').push(p).write();
	res.status(201).json(p);
});

app.delete('/api/patients/:id', (req, res) => {
	const id = req.params.id;
	db.get('patients').remove({ id }).write();
	db.get('logs').remove({ patientId: id }).write();
	db.get('clinicianNotes').remove({ patientId: id }).write();
	db.unset(`shareLinks.${id}`).write();
	res.json({ ok: true });
});

// Logs
app.get('/api/logs/:patientId', (req, res) => {
	const logs = db.get('logs').filter({ patientId: req.params.patientId }).sortBy('createdAt').reverse().value();
	res.json(logs);
});

app.post('/api/logs/:patientId', (req, res) => {
	const payload = req.body || {};
	const log = Object.assign({ patientId: req.params.patientId, createdAt: Date.now() }, payload);
	db.get('logs').push(log).write();
	res.status(201).json(log);
});

// Share links (24h)
app.post('/api/share/:patientId', (req, res) => {
	const id = req.params.patientId;
	const code = (Math.random().toString(36).slice(2, 8)).toUpperCase();
	const url = `http://localhost:${port}/share/${code}`;
	const expiresAt = Date.now() + 24 * 60 * 60 * 1000;
	db.set(`shareLinks.${id}`, { code, url, expiresAt }).write();
	res.json(db.get(`shareLinks.${id}`).value());
});

app.get('/api/share/:patientId', (req, res) => {
	const link = db.get(`shareLinks.${req.params.patientId}`).value();
	if (!link) return res.status(404).json({});
	if (link.expiresAt < Date.now()) {
		db.unset(`shareLinks.${req.params.patientId}`).write();
		return res.status(404).json({});
	}
	res.json(link);
});

// Clinician notes
app.get('/api/notes/:patientId', (req, res) => {
	const notes = db.get('clinicianNotes').filter({ patientId: req.params.patientId }).sortBy('createdAt').reverse().value();
	res.json(notes);
});

app.post('/api/notes/:patientId', (req, res) => {
	const note = { patientId: req.params.patientId, note: req.body.note || '', createdAt: Date.now() };
	db.get('clinicianNotes').push(note).write();
	res.status(201).json(note);
});

// Fallback for share links (simple redirect page)
app.get('/share/:code', (req, res) => {
	res.send(`<h2>Shared CareCompass Link</h2><p>Code: ${req.params.code}</p><p>This demo link would show shared patient data.</p>`);
});

app.listen(port, () => {
	console.log(`Server started on http://localhost:${port}`);
});
