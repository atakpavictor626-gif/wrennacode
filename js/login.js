/**
 * WRENNA — login.js
 * Handles view switching (sign in / sign up) and GitHub OAuth redirect.
 */

document.addEventListener('DOMContentLoaded', () => {
    
    // ---- View switching ----
    const views = {
        signin: document.getElementById('view-signin'),
        signup: document.getElementById('view-signup')
    };
    
    document.querySelectorAll('[data-view]').forEach(btn => {
        btn.addEventListener('click', () => {
            const target = btn.dataset.view;
            
            // Hide all views
            Object.values(views).forEach(v => v.classList.add('hidden'));
            
            // Show target
            if (views[target]) {
                views[target].classList.remove('hidden');
            }
        });
    });
    
    // ---- GitHub OAuth ----
    // These redirect to your Cloudflare Function which handles
    // the OAuth flow and returns the user to the app with a token.
    const GITHUB_OAUTH_URL = '/api/github-oauth';
    
    document.getElementById('btn-github-signin').addEventListener('click', () => {
        window.location.href = `${GITHUB_OAUTH_URL}?action=signin&redirect=${encodeURIComponent('/app.html')}`;
    });
    
    document.getElementById('btn-github-signup').addEventListener('click', () => {
        window.location.href = `${GITHUB_OAUTH_URL}?action=signup&redirect=${encodeURIComponent('/app.html')}`;
    });
    
    // ---- Check for auth callback ----
    // After OAuth, the function redirects back with a token in the URL
    const urlParams = new URLSearchParams(window.location.search);
    const token = urlParams.get('token');
    
    if (token) {
        // Store token
        localStorage.setItem('wrenna_auth_token', token);
        
        // Clean URL
        window.history.replaceState({}, document.title, window.location.pathname);
        
        // Redirect to app
        window.location.href = '/app.html';
    }
    
    // ---- Email forms (placeholder — disabled) ----
    document.getElementById('email-signin-form').addEventListener('submit', (e) => {
        e.preventDefault();
        // Email auth is Phase 3+ — GitHub OAuth only for now
    });
    
    document.getElementById('email-signup-form').addEventListener('submit', (e) => {
        e.preventDefault();
    });
});
