const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PIN = process.env.ADMIN_PIN || '1234'; // Default PIN, change in environment variables

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public')); // Serve frontend if put in public folder

// Database Setup
const db = new sqlite3.Database('./database.sqlite', (err) => {
    if (err) console.error('Database opening error:', err);
    console.log('Connected to SQLite database.');
});

// Initialize Tables
db.serialize(() => {
    // Site Metadata Table
    db.run(`CREATE TABLE IF NOT EXISTS site_meta (
        id INTEGER PRIMARY KEY,
        title TEXT,
        special_tile_thumbnail TEXT,
        special_tile_label TEXT
    )`);

    // Insert default site meta if not exists
    db.get("SELECT COUNT(*) as count FROM site_meta", (err, row) => {
        if (row && row.count === 0) {
            db.run("INSERT INTO site_meta (id, title, special_tile_thumbnail, special_tile_label) VALUES (1, 'The Voice of Rockstar''z', '', 'SPECIAL COLLECTION')");
        }
    });

    // Episodes Table
    db.run(`CREATE TABLE IF NOT EXISTS episodes (
        id TEXT PRIMARY KEY,
        title TEXT,
        episode_number INTEGER,
        season INTEGER DEFAULT 1,
        thumbnail TEXT,
        genre TEXT,
        is_special INTEGER DEFAULT 0,
        embed_dailymotion TEXT,
        embed_rumble TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Comments Table
    db.run(`CREATE TABLE IF NOT EXISTS comments (
        id TEXT PRIMARY KEY,
        episode_id TEXT,
        nickname TEXT,
        body TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(episode_id) REFERENCES episodes(id)
    )`);
});

// --- PUBLIC API ---

// Get Site Metadata
app.get('/api/site', (req, res) => {
    db.get("SELECT * FROM site_meta WHERE id = 1", (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(row || {});
    });
});

// Get All Episodes
app.get('/api/episodes', (req, res) => {
    db.all("SELECT * FROM episodes ORDER BY episode_number DESC", (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// Get Comments for an Episode
app.get('/api/comments/:episodeId', (req, res) => {
    db.all("SELECT * FROM comments WHERE episode_id = ? ORDER BY created_at DESC", [req.params.episodeId], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// Post a Comment
app.post('/api/comments', (req, res) => {
    const { episode_id, nickname, body } = req.body;
    if (!episode_id || !nickname || !body) return res.status(400).json({ error: 'Missing fields' });
    
    const id = uuidv4();
    db.run("INSERT INTO comments (id, episode_id, nickname, body) VALUES (?, ?, ?, ?)", 
        [id, episode_id, nickname, body], 
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ id, episode_id, nickname, body, created_at: new Date() });
        }
    );
});

// --- ADMIN API ---

// Admin Auth
app.post('/api/admin/auth', (req, res) => {
    const { pin } = req.body;
    if (pin === ADMIN_PIN) {
        res.json({ success: true });
    } else {
        res.status(401).json({ error: 'Invalid PIN' });
    }
});

// Update Site Meta
app.put('/api/admin/site', (req, res) => {
    const { title, special_tile_thumbnail, special_tile_label } = req.body;
    db.run("UPDATE site_meta SET title = ?, special_tile_thumbnail = ?, special_tile_label = ? WHERE id = 1",
        [title, special_tile_thumbnail, special_tile_label],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true });
        }
    );
});

// Add Episode
app.post('/api/admin/episodes', (req, res) => {
    const { title, episode_number, season, thumbnail, genre, is_special, embed_dailymotion, embed_rumble } = req.body;
    const id = uuidv4();
    db.run(`INSERT INTO episodes (id, title, episode_number, season, thumbnail, genre, is_special, embed_dailymotion, embed_rumble) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, title, episode_number, season || 1, thumbnail, genre, is_special ? 1 : 0, embed_dailymotion, embed_rumble],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ id, success: true });
        }
    );
});

// Update Episode
app.put('/api/admin/episodes/:id', (req, res) => {
    const { title, episode_number, season, thumbnail, genre, is_special, embed_dailymotion, embed_rumble } = req.body;
    db.run(`UPDATE episodes SET title = ?, episode_number = ?, season = ?, thumbnail = ?, genre = ?, is_special = ?, embed_dailymotion = ?, embed_rumble = ? 
            WHERE id = ?`,
        [title, episode_number, season || 1, thumbnail, genre, is_special ? 1 : 0, embed_dailymotion, embed_rumble, req.params.id],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true });
        }
    );
});

// Delete Episode
app.delete('/api/admin/episodes/:id', (req, res) => {
    db.run("DELETE FROM episodes WHERE id = ?", [req.params.id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

// Start Server
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
