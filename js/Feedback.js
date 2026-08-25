/**
 * WRENNA — feedback.js
 * Handles the feedback form: selection states, submission, views.
 */

document.addEventListener('DOMContentLoaded', () => {
    
    const form = document.getElementById('feedback-form');
    const views = {
        form: document.getElementById('view-form'),
        success: document.getElementById('view-success'),
        error: document.getElementById('view-error')
    };
    
    // Track selections
    let selectedType = 'vibe-coder';
    let selectedRating = null;
    
    // ---- Segmented selector (user type) ----
    document.querySelectorAll('.seg-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.seg-btn').forEach(b => {
                b.classList.remove('active');
                b.setAttribute('aria-checked', 'false');
            });
            btn.classList.add('active');
            btn.setAttribute('aria-checked', 'true');
            selectedType = btn.dataset.value;
        });
    });
    
    // ---- Rating selector ----
    document.querySelectorAll('.rating-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.rating-btn').forEach(b => {
                b.classList.remove('active');
                b.setAttribute('aria-checked', 'false');
            });
            btn.classList.add('active');
            btn.setAttribute('aria-checked', 'true');
            selectedRating = btn.dataset.value;
        });
    });
    
    // ---- View switching ----
    function showView(name) {
        Object.values(views).forEach(v => v.classList.add('hidden'));
        views[name].classList.remove('hidden');
    }
    
    // ---- Form submission ----
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const message = document.getElementById('feedback-message').value.trim();
        const email = document.getElementById('feedback-email').value.trim();
        const submitBtn = document.getElementById('btn-submit');
        
        if (!message) {
            document.getElementById('feedback-message').focus();
            return;
        }
        
        // Loading state
        submitBtn.disabled = true;
        submitBtn.querySelector('.btn-label').textContent = 'Sending...';
        
        try {
            const response = await fetch('/api/feedback', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    type: selectedType,
                    rating: selectedRating,
                    message,
                    email: email || null,
                    // Helpful context for prioritization
                    meta: {
                        userAgent: navigator.userAgent,
                        language: navigator.language,
                        viewport: `${window.innerWidth}x${window.innerHeight}`,
                        timestamp: new Date().toISOString(),
                        referrer: document.referrer || 'direct'
                    }
                })
            });
            
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            
            showView('success');
            
        } catch (err) {
            console.error('Feedback submission failed:', err);
            showView('error');
        } finally {
            submitBtn.disabled = false;
            submitBtn.querySelector('.btn-label').textContent = 'Send your note';
        }
    });
    
    // ---- Retry from error view ----
    document.getElementById('btn-retry').addEventListener('click', () => {
        showView('form');
    });
});
