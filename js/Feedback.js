/**
 * WRENNA — feedback.js (Firebase edition)
 * Live upvote board: Firestore + Anonymous Auth.
 * Vote dedup is structural: vote doc ID = "{uid}_{itemId}".
 */

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import {
    getFirestore, collection, doc, setDoc, deleteDoc, addDoc,
    onSnapshot, query, orderBy, limit, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

// ============================================================
// FIREBASE CONFIG — paste your values from Project Settings
// ============================================================
const firebaseConfig = {
    apiKey: "YOUR_API_KEY",                // ← paste yours
    authDomain: "YOUR_PROJECT.firebaseapp.com",
    projectId: "YOUR_PROJECT_ID",
    storageBucket: "YOUR_PROJECT.appspot.com",
    messagingSenderId: "YOUR_SENDER_ID",
    appId: "YOUR_APP_ID"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// ============================================================
// CONFIG
// ============================================================
const STATUS_LABELS = {
    review: 'Under Review',
    planned: 'Planned',
    progress: 'In Progress',
    shipped: 'Shipped'
};

// ============================================================
// STATE
// ============================================================
let uid = null;
let items = [];
let votes = [];
let currentFilter = 'all';
let currentSort = 'top';
let authReady = false;
let userVotes = new Set();

// ============================================================
// DOM
// ============================================================
const $ = (id) => document.getElementById(id);
const boardList = $('board-list');

// ============================================================
// AUTH
// ============================================================
onAuthStateChanged(auth, (user) => {
    if (user) {
        uid = user.uid;
        authReady = true;
        renderBoard();
    }
});

signInAnonymously(auth).catch((err) => {
    console.warn('Anonymous auth failed — is it enabled in the console?', err);
});

// ============================================================
// TOAST
// ============================================================
function showToast(msg, type = 'info', duration = 3000) {
    const container = $('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = msg;
    container.appendChild(toast);
    setTimeout(() => {
        toast.classList.add('closing');
        toast.addEventListener('animationend', () => toast.remove());
    }, duration);
}

// ============================================================
// REALTIME LISTENERS
// ============================================================
onSnapshot(
    query(collection(db, 'feedback_items'), orderBy('createdAt', 'desc'), limit(200)),
    (snap) => {
        items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        renderBoard();
    },
    (err) => {
        console.error('Items listener failed:', err);
        boardList.innerHTML = `<div class="board-empty"><p>Could not load the board. Check Firestore rules.</p></div>`;
    }
);

onSnapshot(
    query(collection(db, 'feedback_votes'), limit(2000)),
    (snap) => {
        votes = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        userVotes = new Set(votes.filter(v => v.voterId === uid).map(v => v.itemId));
        renderBoard();
    },
    (err) => console.warn('Votes listener failed:', err)
);

// ============================================================
// VOTE HELPERS
// ============================================================
function voteCountFor(itemId) {
    return votes.filter(v => v.itemId === itemId).length;
}

function hasVoted(itemId) {
    return uid !== null && userVotes.has(itemId);
}

// ============================================================
// RENDER
// ============================================================
function renderBoard() {
    if (!boardList) return;

    boardList.innerHTML = '';

    let visible = currentFilter === 'all'
        ? items.slice()
        : items.filter(i => (i.status || 'review') === currentFilter);

    if (currentSort === 'top') {
        visible.sort((a, b) => voteCountFor(b.id) - voteCountFor(a.id));
    }

    if (visible.length === 0) {
        if (items.length === 0) {
            boardList.innerHTML = `
                <div class="board-loading">
                    <div class="loading-dot"></div>
                    <div class="loading-dot"></div>
                    <div class="loading-dot"></div>
                </div>
            `;
            // Give listeners a moment; if still empty after 3s, show empty state
            setTimeout(() => {
                if (items.length === 0 && boardList.querySelector('.board-loading')) {
                    boardList.innerHTML = `
                        <div class="board-empty">
                            <div class="empty-icon">🪶</div>
                            <p>No notes yet. Be the first to leave one.</p>
                        </div>
                    `;
                }
            }, 3000);
        } else {
            boardList.innerHTML = `
                <div class="board-empty">
                    <div class="empty-icon">🪶</div>
                    <p>No notes in this status yet.</p>
                </div>
            `;
        }
        return;
    }

    visible.forEach(item => {
        const el = document.createElement('div');
        el.className = 'board-item';
        el.dataset.id = item.id;

        const voted = hasVoted(item.id);
        const status = item.status || 'review';

        el.innerHTML = `
            <div class="vote-col">
                <button class="vote-btn ${voted ? 'voted' : ''}"
                        data-item-id="${item.id}"
                        aria-label="Upvote"
                        aria-pressed="${voted}">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                        <line x1="12" y1="19" x2="12" y2="5"/>
                        <polyline points="5 12 12 5 19 12"/>
                    </svg>
                </button>
                <span class="vote-count" data-count-for="${item.id}">${voteCountFor(item.id)}</span>
            </div>
            <div class="item-content">
                <span class="item-title">${escapeHtml(item.title)}</span>
                <div class="item-meta">
                    <span class="status-badge" data-status="${status}">${STATUS_LABELS[status] || 'Under Review'}</span>
                    <span class="item-date">${formatDate(item.createdAt)}</span>
                </div>
            </div>
        `;
        boardList.appendChild(el);
    });
}

// ============================================================
// VOTING
// ============================================================
async function toggleVote(itemId) {
    if (!authReady || !uid) {
        showToast('Connecting… try again in a second', 'info');
        return;
    }

    const voteDocRef = doc(db, 'feedback_votes', `${uid}_${itemId}`);
    const voted = hasVoted(itemId);

    const countEl = boardList.querySelector(`[data-count-for="${itemId}"]`);
    if (countEl) {
        const current = voteCountFor(itemId);
        countEl.textContent = voted ? Math.max(0, current - 1) : current + 1;
        countEl.classList.add('bump');
        setTimeout(() => countEl.classList.remove('bump'), 300);
    }

    try {
        if (voted) {
            await deleteDoc(voteDocRef);
        } else {
            await setDoc(voteDocRef, {
                itemId,
                voterId: uid,
                createdAt: serverTimestamp()
            });
        }
    } catch (err) {
        console.error('Vote failed:', err);
        showToast('Vote failed — try again', 'error');
    }
}

// ============================================================
// SUBMIT
// ============================================================
async function submitIdea() {
    const input = $('new-idea-title');
    const title = input.value.trim();
    const submitBtn = $('btn-submit-idea');

    if (!title) { input.focus(); return; }
    if (title.length < 5) {
        showToast('Give us a bit more detail (5+ characters)', 'error');
        input.focus();
        return;
    }
    if (!authReady) {
        showToast('Connecting… try again in a second', 'info');
        return;
    }

    submitBtn.disabled = true;
    try {
        await addDoc(collection(db, 'feedback_items'), {
            title,
            authorId: uid,
            status: 'review',
            createdAt: serverTimestamp()
        });
        input.value = '';
        showToast('Note posted! Thanks 🪶', 'success');
    } catch (err) {
        console.error('Submit failed:', err);
        showToast('Could not post — try again', 'error');
    } finally {
        submitBtn.disabled = false;
    }
}

// ============================================================
// HELPERS
// ============================================================
function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
}

function formatDate(timestamp) {
    if (!timestamp) return 'just now';
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    const diff = Date.now() - date.getTime();
    const mins = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 30) return `${days}d ago`;
    return date.toLocaleDateString();
}

// ============================================================
// EVENTS
// ============================================================
document.addEventListener('DOMContentLoaded', () => {

    boardList.addEventListener('click', (e) => {
        const voteBtn = e.target.closest('.vote-btn');
        if (voteBtn) toggleVote(voteBtn.dataset.itemId);
    });

    $('btn-submit-idea').addEventListener('click', submitIdea);
    $('new-idea-title').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') submitIdea();
    });

    document.querySelectorAll('.filter-pill').forEach(pill => {
        pill.addEventListener('click', () => {
            document.querySelectorAll('.filter-pill').forEach(p => p.classList.remove('active'));
            pill.classList.add('active');
            currentFilter = pill.dataset.filter;
            renderBoard();
        });
    });

    $('btn-sort').addEventListener('click', () => {
        currentSort = currentSort === 'top' ? 'new' : 'top';
        $('sort-label').textContent = currentSort === 'top' ? 'Top' : 'New';
        renderBoard();
    });
});
